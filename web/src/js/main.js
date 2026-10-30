import { context } from "./bridge.js";
import { bootHost, inspectModule, readEmbeddedRom } from "./core/web-host.js";
import { readPatch, sha1Hex, WgbpError } from "./core/wgbp.js";
import { openLoader, runPatchJob } from "./app/patch-loader.js";
import { codeOf, DEFAULT_KEYS, DPAD_MODES, Player } from "./app/player.js";
import * as i18n from "./shell/i18n.js";
import * as theme from "./shell/theme.js";
import * as store from "./store.js";
import { DIR_MODES, DIRS, PAD_KEYS, VirtualPad } from "./pad.js";
import { extractRom, ZipError } from "./zip.js";
import { Skin } from "./skin.js";
import { BUILD } from "./build-info.js";

const { t } = i18n;
const $ = (id) => document.getElementById(id);

const el = {
  app: $("app"),
  bar: $("bar"),
  btnOpen: $("btnOpen"),
  btnLibrary: $("btnLibrary"),
  btnSaves: $("btnSaves"),
  btnFast: $("btnFast"),
  btnSound: $("btnSound"),
  btnMenu: $("btnMenu"),
  btnSettings: $("btnSettings"),
  btnFull: $("btnFull"),
  stage: $("stage"),
  screen: $("screen"),
  canvas: $("canvas"),
  startOpen: $("startOpen"),
  startHint: $("startHint"),
  startList: $("startList"),
  frame: $("frame"),
  pauseVeil: $("pauseVeil"),
  veilResume: $("veilResume"),
  veilReset: $("veilReset"),
  veilClose: $("veilClose"),
  toast: $("toast"),
  pad: $("pad"),
  dpad: document.querySelector("[data-dpad]"),
  sheet: $("sheet"),
  sheetTitle: $("sheetTitle"),
  sheetBody: $("sheetBody"),
  sheetClose: $("sheetClose"),
  dialog: $("dialog"),
  dialogTitle: $("dialogTitle"),
  dialogBody: $("dialogBody"),
  dialogActions: $("dialogActions"),
  drop: $("drop"),
  notice: $("notice"),
  noticeText: $("noticeText"),
  noticeGo: $("noticeGo"),
  gate: $("gate"),
};

const OPEN_EXT = new Set(["gba", "agb", "zip", "wgba", "wasm", "wgbp"]);
const ROM_EXT = new Set(["gba", "agb", "bin", "zip"]);
const WASM_EXT = new Set(["wgba", "wasm"]);
const KEY_ORDER = ["A", "B", "L", "R", "START", "SELECT", "UP", "DOWN", "LEFT", "RIGHT", "FAST"];
const NAMED_CODES = ["ShiftRight", "ShiftLeft", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "Space", "Enter", "Backspace", "Tab", "NumpadEnter"];
const SPEEDS = [1, 1.5, 2, 3, 4];
const HOLD_SPEED = 4;
const LICENSE_LINE = "webGBA — MIT License, © 2026 flightrabbit";
const SAVE_IMPORT_MAX = 0x100000;
const TOAST_MS = 3200;
const NAME_MAX = 40;
const IOS_FILE_ACCEPT = "application/octet-stream";

const state = {
  prefs: store.loadPrefs(),
  game: null,
  opening: false,
  sheet: "",
  sheetHistory: false,
  dialogDone: null,
  wake: null,
  wakeBusy: false,
  storeBroken: false,
  saveFailNotified: false,
  coreModule: null,
  toastTimer: 0,
  dragDepth: 0,
};

const holds = new Set();

const extOf = (name) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? "").toLowerCase();
const stemOf = (name) => name.replace(/\.[^./\\]+$/, "");
const reason = (error) => String(error?.message ?? error);
const join = (...parts) => parts.filter(Boolean).join(" · ");
const coarse = window.matchMedia("(pointer: coarse)");

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${(bytes / 1073741824).toFixed(1)}GB`;
}

function fmtTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString(i18n.locale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function iconNode(name) {
  const span = document.createElement("span");
  span.className = "icon";
  span.style.setProperty("--icon", `url("/icons/${name}.svg")`);
  return span;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button({ label = "", icon = "", title = "", kind = "", onClick, disabled = false, action = "" }) {
  const node = make("button", kind === "tool" ? "tool tool--small" : `btn${kind ? ` btn--${kind}` : ""}`);
  node.type = "button";
  if (icon) node.append(iconNode(icon));
  if (label) node.append(make("span", "btn__label", label));
  if (title) {
    node.title = title;
    node.setAttribute("aria-label", title);
  }
  if (action) node.dataset.action = action;
  node.disabled = disabled;
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

class WebPlayer extends Player {
  get speed() {
    const base = this.gameSpeed ?? 1;
    return this.fastHeld ? Math.max(HOLD_SPEED, base) : base;
  }

  ensureAudio() {
    if (this.audio) {
      if (this.audio.ac.state !== "running") this.audio.ac.resume().catch(() => {});
      return Promise.resolve(this.audio);
    }
    if (!this.audioBoot) this.audioBoot = super.ensureAudio().finally(() => (this.audioBoot = null));
    const started = performance.now();
    const ready = new Promise((resolve) => {
      const check = () => (this.audio || performance.now() - started > 1500 ? resolve() : setTimeout(check, 15));
      check();
    });
    return Promise.race([this.audioBoot, ready]).then(() => this.audio);
  }
}

const player = new WebPlayer({
  canvas: el.canvas,
  onStatus: (text, level) => toast(text, level ?? "info"),
  onHalt: (why) => {
    toast(t("status.halted", { reason: why || t("status.haltUnknown") }), "error");
    syncControls();
  },
});

const padCode = (name) => `Pad:${name}`;

function keyTable() {
  const keys = {};
  for (const [name, codes] of Object.entries(DEFAULT_KEYS)) keys[name] = [...codes];
  for (const name of [...PAD_KEYS, ...DIRS]) keys[name] = [...(keys[name] ?? []), padCode(name)];
  return keys;
}

const skin = new Skin({ pad: el.pad, dpad: el.dpad });

const pad = new VirtualPad({
  root: el.pad,
  diagonal: () => player.dpadMode !== "latest",
  vibrate: () => state.prefs.vibrate,
  onChange: (name, down) => (down ? player.keyDown(padCode(name)) : player.keyUp(padCode(name))),
  onVisual: (name, down) => skin.key(name, down),
  onStick: (x, y, active) => skin.stick(x, y, active),
});

function savePrefs(patch = {}) {
  Object.assign(state.prefs, patch);
  store.savePrefs(state.prefs);
}

function applyDirInput() {
  const mode = DIR_MODES.includes(state.prefs.dirInput) ? state.prefs.dirInput : "stick";
  pad.setMode(mode);
  el.dpad.dataset.mode = mode;
  skin.setMode(mode);
  pad.invalidate();
}

function applyPlayerPrefs() {
  const p = state.prefs;
  player.setDpadMode(DPAD_MODES.includes(p.dpadMode) ? p.dpadMode : "latest");
  player.setVolume(Number.isFinite(p.volume) ? p.volume : 0.8);
  player.setMuted(Boolean(p.muted));
  player.gameSpeed = SPEEDS.includes(p.gameSpeed) ? p.gameSpeed : 1;
  player.fast = player.gameSpeed !== 1;
  player.fastMute = Boolean(p.fastMute);
}

function toast(text, level = "info", ms = TOAST_MS) {
  clearTimeout(state.toastTimer);
  el.toast.replaceChildren(make("span", "toast__text", text));
  el.toast.classList.toggle("is-error", level === "error");
  el.toast.classList.toggle("is-warn", level === "warn");
  el.toast.hidden = !text;
  if (text && level !== "error") state.toastTimer = setTimeout(() => (el.toast.hidden = true), level === "warn" ? ms * 1.6 : ms);
}

function safeInsets() {
  const probe = state.probe ?? (state.probe = Object.assign(document.body.appendChild(document.createElement("div")), { style: "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)" }));
  const style = getComputedStyle(probe);
  return { t: parseFloat(style.paddingTop) || 0, r: parseFloat(style.paddingRight) || 0, b: parseFloat(style.paddingBottom) || 0, l: parseFloat(style.paddingLeft) || 0 };
}

function padVisible() {
  return state.prefs.pad !== "off";
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms));

function hideLater(node, after) {
  clearTimeout(node.hideTimer);
  if (reducedMotion()) {
    node.hidden = true;
    after?.();
    return;
  }
  node.classList.add("is-closing");
  node.hideTimer = setTimeout(() => {
    node.classList.remove("is-closing");
    node.hidden = true;
    after?.();
  }, 150);
}

function showNow(node) {
  clearTimeout(node.hideTimer);
  node.classList.remove("is-closing");
  node.hidden = false;
}

const FRAME_ROWS = 3;
const ART = { stick: 37, shoulderH: 17, pillH: 15 };
const FACE = { portrait: { w: 23 * 2, h: 27 * 1.6 }, landscape: { w: 23 * 2.05, h: 27 * 1.75 } };

function layout() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const landscape = width > height;
  const padOn = padVisible();
  const body = document.body;
  body.dataset.layout = landscape ? "landscape" : "portrait";
  body.dataset.pad = padOn ? "on" : "off";
  if (landscape && state.menuOpen) setMenu(false);
  const dpr = window.devicePixelRatio || 1;
  const inset = safeInsets();
  const innerW = Math.max(0, width - inset.l - inset.r);
  const innerH = Math.max(0, height - inset.t - inset.b);
  const root = document.documentElement.style;
  const icon = 2;
  const face = landscape ? FACE.landscape : FACE.portrait;
  let art = state.art ?? 3;
  skin.resize({ art, icon, dpr });
  syncTools();
  const ring = skin.px(2);
  const edge = (ring * FRAME_ROWS) / dpr;
  const sideEdge = landscape ? edge * 2 : 0;
  let sw;
  let sh;
  if (padOn && !landscape) {
    const barH = el.bar.offsetHeight;
    sw = innerW;
    sh = Math.floor((sw * 2) / 3);
    const minPad = Math.min(300, innerH * 0.4);
    if (innerH - barH - sh - edge * 2 < minPad) {
      sh = Math.max(96, Math.floor(innerH - barH - edge * 2 - minPad));
      sw = Math.floor(sh * 1.5);
    }
    const padH = innerH - barH - sh - edge * 2;
    art = clamp(Math.floor(Math.min((innerW - 44) / (ART.stick + face.w), (padH - 44) / (ART.shoulderH + face.h + ART.pillH))), 2, 6);
    root.setProperty("--side", "0px");
  } else if (padOn && landscape) {
    art = clamp(Math.floor(Math.min((innerH - 30) / 95, innerW / 260)), 2, 5);
    const rowH = Math.max(el.bar.offsetHeight + 4, ART.shoulderH * art + 12);
    const sideMin = Math.ceil(Math.max(face.w, ART.stick) * art + 16);
    const availW = innerW - sideMin * 2 - sideEdge;
    const availH = innerH - rowH - 8 - edge * 2;
    sw = Math.floor(Math.max(120, Math.min(availW, availH * 1.5)));
    sh = Math.floor((sw * 2) / 3);
    root.setProperty("--side", `${Math.floor((innerW - sw) / 2)}px`);
  } else {
    const availW = innerW - 16 - sideEdge;
    const availH = innerH - el.bar.offsetHeight - 16 - edge * 2;
    sw = Math.floor(Math.max(120, Math.min(availW, availH * 1.5)));
    sh = Math.floor((sw * 2) / 3);
    root.setProperty("--side", "0px");
  }
  state.art = art;
  skin.resize({ art, icon, dpr });
  const unit = skin.px(art) / dpr;
  root.setProperty("--face-w", `${Math.round(face.w * unit)}px`);
  root.setProperty("--face-h", `${Math.round(face.h * unit)}px`);
  root.setProperty("--sw", `${sw}px`);
  root.setProperty("--sh", `${sh}px`);
  root.setProperty("--stage-h", `${sh + edge * 2}px`);
  const frameW = Math.round(sw * dpr) + (landscape ? ring * FRAME_ROWS * 2 : 0);
  const frameH = Math.round(sh * dpr) + ring * FRAME_ROWS * 2;
  skin.frame(el.frame, { width: frameW, height: frameH, ring, full: landscape });
  el.frame.style.width = `${frameW / dpr}px`;
  el.frame.style.height = `${frameH / dpr}px`;
  pad.enabled = padOn;
  if (!padOn) pad.releaseAll();
  pad.invalidate();
  requestAnimationFrame(() => centerInk(document));
}

function syncTools() {
  const running = Boolean(state.game);
  const full = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
  const size = 2;
  for (const node of el.bar.querySelectorAll(".tool")) {
    skin.tool(node, {
      size,
      disabled: node.disabled,
      on: (node === el.btnFast && player.gameSpeed !== 1) || (node === el.btnSound && state.prefs.muted),
      fast: player.gameSpeed !== 1,
      muted: state.prefs.muted,
      full,
    });
  }
  skin.tool(el.btnMenu, { menu: true, size: 2, on: state.menuOpen });
}

function syncControls() {
  const running = Boolean(state.game);
  document.body.dataset.view = running ? "game" : "start";
  const userPaused = running && holds.has("user");
  el.btnFast.setAttribute("aria-pressed", String(player.gameSpeed !== 1));
  const badge = el.btnFast.querySelector(".tool__badge") ?? el.btnFast.appendChild(make("span", "tool__badge"));
  badge.textContent = speedText(player.gameSpeed);
  badge.hidden = player.gameSpeed === 1;
  el.btnSound.setAttribute("aria-pressed", String(Boolean(state.prefs.muted)));
  setLabel(el.btnSound, state.prefs.muted ? "rail.unmute" : "rail.mute");
  el.pauseVeil.hidden = !userPaused;
  const full = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
  setLabel(el.btnFull, full ? "web.fullscreenExit" : "web.fullscreen");
  el.btnMenu.setAttribute("aria-expanded", String(Boolean(state.menuOpen)));
  syncTools();
}

function setMenu(open) {
  state.menuOpen = open;
  document.body.dataset.menu = open ? "open" : "";
  hold("menu", open);
  layout();
}

function toggleSound() {
  savePrefs({ muted: !state.prefs.muted });
  applyPlayerPrefs();
  syncControls();
}

function textInk(node) {
  const isInput = node.tagName === "INPUT";
  const text = isInput ? "가名" : node.textContent.trim();
  if (!text) return null;
  const style = getComputedStyle(node);
  const ctx = (state.inkCtx ??= document.createElement("canvas").getContext("2d"));
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const m = ctx.measureText(text);
  const box = node.getBoundingClientRect();
  const pt = parseFloat(style.paddingTop) || 0;
  const pb = parseFloat(style.paddingBottom) || 0;
  const bt = parseFloat(style.borderTopWidth) || 0;
  const bb = parseFloat(style.borderBottomWidth) || 0;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const contentTop = box.top + bt + pt;
  const contentH = box.height - bt - bb - pt - pb;
  const lines = isInput ? 1 : Math.max(1, Math.round(contentH / lineHeight));
  const lineTop = isInput ? contentTop + (contentH - lineHeight) / 2 : contentTop;
  const firstBase = lineTop + baselineOffset(style, lineHeight);
  const parts = isInput ? [text] : lineTexts(node, lines) ?? [text];
  const alpha = visibleAlpha(node, style);
  const lastBase = firstBase + (lines - 1) * lineHeight;
  const head = glyphInk(ctx.font, parts[0], ctx.measureText(parts[0]), alpha, firstBase);
  const tail = glyphInk(ctx.font, parts[parts.length - 1], ctx.measureText(parts[parts.length - 1]), alpha, lastBase);
  return { top: firstBase + head.top, bottom: firstBase + (lines - 1) * lineHeight + tail.bottom, contentTop, contentBottom: contentTop + contentH };
}

function baselineOffset(style, lineHeight) {
  const key = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}|${lineHeight}`;
  const cache = (state.baselineCache ??= new Map());
  if (cache.has(key)) return cache.get(key);
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;white-space:nowrap;margin:0;padding:0;border:0;font-style:${style.fontStyle};font-weight:${style.fontWeight};font-size:${style.fontSize};font-family:${style.fontFamily};line-height:${lineHeight}px`;
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  probe.append("가A", marker);
  document.body.append(probe);
  const offset = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  cache.set(key, offset);
  return offset;
}

function lineTexts(node, count) {
  const textNode = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.data.trim());
  if (!textNode) return null;
  const data = textNode.data;
  if (count <= 1) {
    if (node.scrollWidth <= node.clientWidth + 1) return [data.trim()];
    const right = node.getBoundingClientRect().right - parseFloat(getComputedStyle(node).fontSize);
    const range = document.createRange();
    let shown = "";
    for (let i = 0; i < data.length; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);
      const rect = range.getClientRects()[0];
      if (rect && rect.right > right) break;
      shown += data[i];
    }
    return [`${shown.trim()}…`];
  }
  const range = document.createRange();
  const lines = [];
  let lastTop = null;
  for (let i = 0; i < data.length; i++) {
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    const rect = range.getClientRects()[0];
    if (!rect || !rect.height) continue;
    if (lastTop === null || Math.abs(rect.top - lastTop) > 2) {
      lines.push("");
      lastTop = rect.top;
    }
    lines[lines.length - 1] += data[i];
  }
  const visible = lines.slice(0, count).map((line) => line.trim()).filter(Boolean);
  return visible.length ? visible : null;
}

const INK_ALPHA = 48;
const INK_VISIBLE = 48;
const INPUT_TEXT_DROP = 1;

const rgbOf = (value) => (/rgba?\(([^)]+)\)/.exec(value)?.[1] ?? "0,0,0,0").split(/[ ,\/]+/).filter(Boolean).map(Number);

function visibleAlpha(node, style) {
  const color = rgbOf(style.color);
  let back = null;
  for (let at = node; at && at !== document.documentElement; at = at.parentElement) {
    const value = rgbOf(getComputedStyle(at).backgroundColor);
    if ((value[3] ?? 1) > 0.5) {
      back = value;
      break;
    }
  }
  back ??= rgbOf(getComputedStyle(document.body).backgroundColor);
  const diff = Math.max(1, ...[0, 1, 2].map((i) => Math.abs((color[i] ?? 0) - (back[i] ?? 0))));
  return Math.max(24, Math.min(230, Math.ceil((INK_VISIBLE / diff) * 255)));
}

function glyphInk(font, text, metrics, alpha = INK_ALPHA, baseY = 0) {
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const frac = Math.round((((baseY * scale) % 1) + 1) % 1 * 4) / 4;
  const key = `${font}|${alpha}|${scale}|${frac}|${text}`;
  const cache = (state.glyphCache ??= new Map());
  if (cache.has(key)) return cache.get(key);
  const above = Math.ceil(metrics.fontBoundingBoxAscent) + 4;
  const below = Math.ceil(metrics.fontBoundingBoxDescent) + 4;
  const width = Math.min(4096, Math.ceil((metrics.width + 8) * scale));
  const height = Math.ceil((above + below) * scale);
  const canvas = (state.glyphCanvas ??= document.createElement("canvas"));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  const baseline = above + frac / scale;
  ctx.fillText(text, 4, baseline);
  const data = ctx.getImageData(0, 0, width, height).data;
  let first = -1;
  let last = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 3; x < width * 4; x += 4) {
      if (data[y * width * 4 + x] > alpha) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  const result = first < 0 ? { top: -metrics.actualBoundingBoxAscent, bottom: metrics.actualBoundingBoxDescent } : { top: first / scale - baseline, bottom: (last + 1) / scale - baseline };
  cache.set(key, result);
  return result;
}

const INK_SINGLE = ".gate__digit, .toast__text, .gate__text, .btn__label, .loader__label, .loader__percent, .loader__time, .sheet__title, .group__title, .veil__title, .notice__text, .dialog__hint, .start__hint";
const INK_BLOCK = ".item__main, .field__text";

function inkShift(contentTop, contentBottom, ink) {
  const dpr = window.devicePixelRatio || 1;
  const free = Math.round((contentBottom - contentTop - (ink.bottom - ink.top)) * dpr);
  const want = contentTop + Math.floor(free / 2) / dpr;
  return Math.round((want - ink.top) * dpr) / dpr;
}

function centerInk(root = document) {
  const pick = (selector) => (root.matches?.(selector) ? [root] : [...(root.querySelectorAll?.(selector) ?? [])]);
  for (const node of pick(INK_SINGLE)) {
    node.style.translate = "";
    const ink = textInk(node);
    if (!ink) continue;
    const shift = inkShift(ink.contentTop, ink.contentBottom, ink);
    if (shift && Math.abs(shift) < (ink.contentBottom - ink.contentTop) / 2) node.style.translate = `0 ${shift}px`;
  }
  for (const node of pick(INK_BLOCK)) {
    node.style.translate = "";
    const inks = [...node.children].map((child) => (child.textContent.trim() ? textInk(child) : null)).filter(Boolean);
    if (!inks.length) continue;
    const box = node.getBoundingClientRect();
    const union = { top: Math.min(...inks.map((i) => i.top)), bottom: Math.max(...inks.map((i) => i.bottom)) };
    const shift = inkShift(box.top, box.bottom, union);
    if (shift && Math.abs(shift) < box.height / 2) node.style.translate = `0 ${shift}px`;
  }
  const dpr = window.devicePixelRatio || 1;
  for (const node of pick("input.dialog__input")) {
    node.style.paddingTop = "";
    node.style.paddingBottom = "";
    const ink = textInk(node);
    if (!ink) continue;
    const free = Math.round((ink.contentBottom - ink.contentTop - (ink.bottom - ink.top)) * dpr);
    const delta = Math.round((ink.contentTop + Math.floor(free / 2) / dpr - ink.top - INPUT_TEXT_DROP) * dpr) / dpr;
    if (delta > 0) node.style.paddingTop = `${delta * 2}px`;
    else if (delta < 0) node.style.paddingBottom = `${-delta * 2}px`;
  }
}

const iconInk = new Map();

function iconUrl(node) {
  const value = node.style.getPropertyValue("--icon") || getComputedStyle(node).getPropertyValue("--icon");
  return /url\(["']?([^"')]+)["']?\)/.exec(value)?.[1] ?? "";
}

async function loadIconInk(url) {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let top = size;
    let bottom = -1;
    let left = size;
    let right = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * 4 + 3] <= INK_ALPHA) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    iconInk.set(url, bottom < 0 ? { dx: 0, dy: 0 } : { dx: (size - 1 - right - left) / 2 / size, dy: (size - 1 - bottom - top) / 2 / size });
  } catch {
    iconInk.set(url, { dx: 0, dy: 0 });
  }
  centerIcons(document);
}

function centerIcons(root = document) {
  const dpr = window.devicePixelRatio || 1;
  for (const node of root.querySelectorAll?.(".icon") ?? []) {
    const url = iconUrl(node);
    if (!url) continue;
    if (!iconInk.has(url)) {
      iconInk.set(url, null);
      loadIconInk(url);
      continue;
    }
    const ink = iconInk.get(url);
    if (!ink) continue;
    const dx = Math.round(ink.dx * node.offsetWidth * dpr) / dpr;
    const dy = Math.round(ink.dy * node.offsetHeight * dpr) / dpr;
    node.style.translate = dx || dy ? `${dx}px ${dy}px` : "";
  }
}

function setLabel(node, key) {
  node.dataset.i18nTitle = key;
  node.dataset.i18nAria = key;
  node.title = t(key);
  node.setAttribute("aria-label", t(key));
}

function hold(reasonName, on) {
  if (on) holds.add(reasonName);
  else holds.delete(reasonName);
  if (player.active) {
    const want = holds.size > 0;
    if (player.paused !== want) player.setPaused(want);
  }
  syncControls();
  updateWake();
}

async function updateWake() {
  if (state.wakeBusy || !("wakeLock" in navigator)) return;
  const want = state.prefs.wakeLock && Boolean(state.game) && holds.size === 0 && document.visibilityState === "visible";
  state.wakeBusy = true;
  try {
    if (want && !state.wake) {
      state.wake = await navigator.wakeLock.request("screen");
      state.wake.addEventListener("release", () => (state.wake = null), { once: true });
    } else if (!want && state.wake) {
      const lock = state.wake;
      state.wake = null;
      await lock.release();
    }
  } catch {
    state.wake = null;
  } finally {
    state.wakeBusy = false;
  }
}

function pickFile({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (IOS_FILE_ACCEPT && isIos()) input.accept = IOS_FILE_ACCEPT;
    input.hidden = true;
    let done = false;
    const finish = (files) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])]));
    input.addEventListener("cancel", () => finish([]));
    document.body.append(input);
    input.click();
  });
}

function openDialog({ title, body = [], actions, input = null }) {
  if (state.dialogDone) state.dialogDone(null);
  el.dialogTitle.textContent = title;
  const nodes = body.filter(Boolean).map((text) => make("p", "", text));
  let field = null;
  let hint = null;
  if (input) {
    field = document.createElement("input");
    field.type = "text";
    field.className = "dialog__input";
    field.value = input.value ?? "";
    field.maxLength = input.maxLength ?? NAME_MAX;
    field.autocomplete = "off";
    field.spellcheck = false;
    field.enterKeyHint = "done";
    field.setAttribute("aria-label", title);
    hint = make("p", "dialog__hint");
    hint.hidden = true;
    nodes.push(field, hint);
  }
  el.dialogBody.replaceChildren(...nodes);
  el.dialog.classList.toggle("has-input", Boolean(input));
  hold("dialog", true);
  return new Promise((resolve) => {
    const done = (value) => {
      if (state.dialogDone !== done) return;
      state.dialogDone = null;
      hideLater(el.dialog, () => el.dialog.classList.remove("has-input"));
      hold("dialog", false);
      resolve(value);
    };
    done.check = (text) => {
      if (!hint) return;
      hint.textContent = text;
      hint.hidden = !text;
    };
    state.dialogDone = done;
    const press = (action) => {
      if (action.pick) {
        const picked = pickFile({ multiple: false });
        done(picked.then((files) => ({ files })));
        return;
      }
      if (action.takeInput) {
        const problem = input.validate?.(field.value) ?? "";
        if (problem) {
          done.check(problem);
          field.focus();
          return;
        }
        done({ value: field.value, action: action.value });
        return;
      }
      done(action.value);
    };
    el.dialogActions.replaceChildren(
      ...actions.map((action) =>
        button({
          label: action.label,
          kind: action.primary ? "primary" : action.danger ? "danger" : "",
          action: action.id ?? "",
          onClick: () => press(action),
        }),
      ),
    );
    showNow(el.dialog);
    if (field) {
      field.addEventListener("input", () => done.check(""));
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        const primary = actions.find((action) => action.primary);
        if (primary) press(primary);
      });
      field.addEventListener("focus", () => setTimeout(() => field.scrollIntoView({ block: "center" }), 250));
      field.focus({ preventScroll: true });
      field.select();
    } else {
      const primary = el.dialogActions.querySelector(".btn--primary") ?? el.dialogActions.lastElementChild;
      primary?.focus({ preventScroll: true });
    }
  });
}

const confirmDialog = (title, text, okLabel = "OK", danger = false) =>
  openDialog({
    title,
    body: [text],
    actions: [
      { label: "CANCEL", value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  });

const paint = () =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      setTimeout(resolve, 0);
    };
    const timer = setTimeout(finish, 60);
    requestAnimationFrame(finish);
  });

const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

function nameProblem(raw) {
  const name = String(raw).trim();
  if (!name) return "";
  if (BAD_NAME.test(name)) return t("web.name.bad");
  if (name.length > NAME_MAX) return t("web.name.long", { max: NAME_MAX });
  return "";
}

const cleanName = (raw, fallback) => String(raw).trim().replace(/\s+/g, " ") || fallback;

async function askName({ title, text, value, fallback, selfId = "" }) {
  let current = value;
  for (;;) {
    const result = await openDialog({
      title,
      body: [text, t("web.name.rule", { max: NAME_MAX })],
      input: { value: current, maxLength: NAME_MAX, validate: nameProblem },
      actions: [
        { label: "CANCEL", value: null },
        { label: "OK", value: "ok", primary: true, takeInput: true, id: "name-ok" },
      ],
    });
    if (!result?.action) return null;
    const name = cleanName(result.value, fallback);
    let same = null;
    try {
      same = await store.romByName(name);
    } catch {}
    if (!same || same.id === selfId) return { name, replace: null };
    const choice = await openDialog({
      title: t("web.name.takenTitle"),
      body: [t("web.name.takenText", { name })],
      actions: [
        { label: "CANCEL", value: null },
        { label: t("web.name.other"), value: "other", id: "name-other" },
        { label: t("web.name.overwrite"), value: "overwrite", danger: true, id: "name-overwrite" },
      ],
    });
    if (choice === "overwrite") return { name, replace: same };
    if (choice !== "other") return null;
    current = name;
  }
}

function storeFailed(error) {
  state.storeBroken = true;
  logLine("WARN", `보관하지 못했습니다: ${reason(error)}`);
  toast(t("web.storeFailed", { reason: error?.name === "QuotaExceededError" ? t("web.quota") : reason(error) }), "warn");
}

function logLine(level, text) {
  const line = `[webGBA] ${text}`;
  if (level === "WARN") console.warn(line);
  else console.info(line);
}

const typeOf = (name) => {
  const ext = extOf(name);
  return ext === "agb" || ext === "bin" ? "gba" : ext;
};

async function keepRom(name, bytes, { id = "", added = 0, sha1 = "", file = name } = {}) {
  let existing = null;
  if (!id) {
    try {
      existing = await store.romByName(name);
    } catch {}
  }
  const meta = { id: id || existing?.id || store.newId(), name, file, type: typeOf(file), sha1, added: added || existing?.added || 0 };
  try {
    await store.persist();
    return await store.putRom(meta, bytes);
  } catch (error) {
    storeFailed(error);
    return { ...meta, key: store.romKey(meta.id), kind: store.KIND_ROM, size: bytes.length, transient: true };
  }
}

function zipText(error) {
  if (!(error instanceof ZipError)) return reason(error);
  if (error.code === "noRom") return t("rs.zipNoRom");
  if (error.code === "tooBig") return t("rs.zipTooBig");
  return t("rs.zipRead", { 0: error.message });
}

function unzip(bytes) {
  try {
    return extractRom(bytes);
  } catch (error) {
    throw new Error(zipText(error));
  }
}

async function readPicked(file) {
  let name = file.name;
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (extOf(name) === "zip") ({ name, bytes } = unzip(bytes));
  return { name, bytes };
}

async function coreModule() {
  if (!state.coreModule) {
    const response = await fetch("/core/mgba_core.wasm");
    if (!response.ok) throw new Error(`mgba_core.wasm ${response.status}`);
    state.coreModule = await WebAssembly.compile(await response.arrayBuffer());
  }
  return state.coreModule;
}

const hostLog = (level, line) => {
  if (level === "error") console.warn(`[core] ${line}`);
};

async function readSave(id) {
  try {
    return await store.saveBytes(id);
  } catch (error) {
    storeFailed(error);
    return null;
  }
}

const saveFile = (name) => `${String(name).replace(/\.(gba|agb|bin|wgba|wasm)$/i, "")}.sav`;

async function startHosted(host, meta) {
  state.game = { id: meta.id, name: meta.name, type: meta.type, key: store.romKey(meta.id), saveId: meta.id };
  context.game = meta.name;
  holds.delete("user");
  syncControls();
  layout();
  applyPlayerPrefs();
  await player.start({ host, saveId: meta.id, game: meta.id });
  applyPlayerPrefs();
  hold("sheet", Boolean(state.sheet));
  syncControls();
  updateWake();
}

async function openRom(meta, bytes) {
  const module = await coreModule();
  const save = await readSave(meta.id);
  const { host } = await bootHost({ module, rom: bytes, save, log: hostLog });
  await startHosted(host, meta);
  return meta.name;
}

const isWasmBytes = (bytes) => bytes.length >= 8 && bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;

async function webRomFor(meta) {
  const remembered = state.prefs.webRoms?.[meta.id];
  if (remembered) {
    try {
      const info = await store.meta(store.romKey(remembered));
      const bytes = info ? await store.bytes(info.key) : null;
      if (bytes) return { info, bytes };
    } catch {}
  }
  let roms = [];
  try {
    roms = (await store.list(store.KIND_ROM)).filter((item) => item.type === "gba").sort((a, b) => (b.opened ?? 0) - (a.opened ?? 0));
  } catch {}
  const result = await openDialog({
    title: t("web.wasmRom.title"),
    body: [t("web.wasmRom.text", { name: meta.name }), t("web.privacy")],
    actions: [{ label: "CANCEL", value: null }, ...roms.slice(0, 4).map((item) => ({ label: item.name, value: item.key })), { label: t("web.pickRom"), primary: true, pick: true }],
  });
  if (!result) return null;
  let info;
  let bytes;
  if (typeof result === "string") {
    info = await store.meta(result);
    bytes = info ? await store.bytes(result) : null;
    if (!bytes) return null;
  } else {
    const file = result.files?.[0];
    if (!file) return null;
    const picked = await readPicked(file);
    bytes = picked.bytes;
    info = await keepRom(picked.name, bytes);
  }
  savePrefs({ webRoms: { ...(state.prefs.webRoms ?? {}), [meta.id]: info.id } });
  return { info, bytes };
}

async function openWasm(meta, bytes) {
  if (!isWasmBytes(bytes)) throw new Error(t("status.notWasm", { name: meta.name }));
  let module;
  try {
    module = await WebAssembly.compile(bytes);
  } catch (error) {
    throw new Error(t("status.wasmUnreadable", { reason: reason(error) }));
  }
  const report = inspectModule(module);
  if (!report.usable) {
    const why = report.unknown.length ? t("status.unknownImports", { list: `${report.unknown.slice(0, 3).join(", ")}${report.unknown.length > 3 ? " …" : ""}` }) : "";
    throw new Error(t("web.needsGlue", { why }));
  }
  const embedded = await readEmbeddedRom(module);
  const rom = embedded ? { bytes: embedded.rom } : await webRomFor(meta);
  if (!rom) {
    toast(t("status.noRomPicked"), "warn");
    return "";
  }
  const save = await readSave(meta.id);
  const { host } = await bootHost({ module, rom: rom.bytes, save, log: hostLog });
  await startHosted(host, meta);
  return meta.name;
}

const patchNeed = (manifest) =>
  (manifest?.bases ?? [])
    .filter((base) => base.main !== false)
    .map((base) => base.name)
    .join(" · ");

function patchError(error, { file, rom = "", manifest = null }) {
  if (!(error instanceof WgbpError)) return reason(error);
  const p = error.params ?? {};
  return t(`patch.err.${error.code}`, {
    name: file,
    rom,
    need: patchNeed(manifest),
    why: p.why ? t(`patch.why.${p.why}`) : "",
    version: p.version ?? "?",
    code: p.code || "?",
    title: p.title || "?",
    revision: p.revision ?? 0,
    sha1: String(p.sha1 ?? "").slice(0, 8),
    what: p.what ?? "",
  });
}

async function madeBefore(manifest) {
  let roms = [];
  try {
    roms = (await store.list(store.KIND_ROM)).filter((item) => item.type === "wgba");
  } catch {
    return null;
  }
  for (const info of roms) {
    if (info.sha1 && info.sha1 !== manifest.wgba.sha1) continue;
    if (!info.sha1 && info.size !== undefined && Math.abs(info.size - (manifest.wgba.size ?? info.size)) > 0) continue;
    const bytes = await store.bytes(info.key).catch(() => null);
    if (!bytes) continue;
    const sha1 = info.sha1 || (await sha1Hex(bytes));
    if (!info.sha1) store.patch(info.key, { sha1 }).catch(() => {});
    if (sha1 === manifest.wgba.sha1) return { info, bytes };
  }
  return null;
}

async function makeFromPatch(fileName, bytes, romFile) {
  let patch;
  try {
    patch = readPatch(bytes);
  } catch (error) {
    throw new Error(patchError(error, { file: fileName }));
  }
  const { manifest } = patch;
  const before = await madeBefore(manifest);
  if (before) return { meta: before.info, bytes: before.bytes, note: t("status.patchExisting", { name: before.info.name }) };
  const fallback = stemOf(fileName);
  let file = romFile;
  if (!file) {
    const result = await openDialog({
      title: t("patch.title", { title: manifest.title }),
      body: [t("web.patch.intro", { name: fileName }), t("patch.need", { need: patchNeed(manifest) }), t("web.privacy")],
      actions: [
        { label: "CANCEL", value: null },
        { label: t("web.pickRom"), primary: true, pick: true, id: "pick-rom" },
      ],
    });
    file = result?.files?.[0];
    if (!file) {
      toast(t("status.patchCancelled"), "warn");
      return null;
    }
  }
  const chosen = await askName({ title: t("web.name.title"), text: t("web.name.text", { patch: fileName }), value: fallback, fallback });
  if (!chosen) {
    toast(t("status.patchCancelled"), "warn");
    return null;
  }
  const loader = openLoader({ title: t("loader.title", { name: chosen.name }), stages: ["check", "patch", "verify", "pack", "store", "open"] });
  state.loader = loader;
  let made;
  let rom;
  try {
    loader.set("check", 0);
    rom = await readPicked(file);
    made = await runPatchJob(bytes, rom.bytes, (stage, fraction) => loader.set(stage, fraction));
  } catch (error) {
    const text = patchError(error, { file: fileName, rom: rom?.name ?? file.name, manifest });
    logLine("WARN", `패치로 만들지 못했습니다 ${fileName} + ${file.name}: ${reason(error)}`);
    await loader.fail(text);
    state.loader = null;
    throw new Error(text);
  }
  loader.set("store", 0);
  const meta = await keepRom(chosen.name, made.wgba, { id: chosen.replace?.id ?? "", added: chosen.replace?.added ?? 0, sha1: made.sha1, file: `${fallback}.wgba` });
  loader.set("store", 1);
  logLine("INFO", `패치로 만듦 ${fileName} + ${file.name} → ${chosen.name} (${made.base.name}, ${made.wgba.length}바이트, SHA-1 ${made.sha1}${made.same ? "" : ", 기준 SHA-1 과 다름"})`);
  return { meta, bytes: made.wgba, loader, note: t("status.patchMade", { name: chosen.name, base: made.base.name }) };
}

async function launch(meta, bytes, { note = "", loader = null } = {}) {
  await closeGame({ quiet: true });
  loader?.set("open", 0);
  let text;
  try {
    text = meta.type === "wgba" || meta.type === "wasm" ? await openWasm(meta, bytes) : await openRom(meta, bytes);
  } catch (error) {
    if (loader) {
      await loader.fail(reason(error), "open");
      state.loader = null;
    }
    throw error;
  }
  if (!text) {
    loader?.close();
    state.loader = null;
    syncControls();
    return false;
  }
  loader?.finish();
  state.loader = null;
  if (!meta.transient) {
    savePrefs({ lastGame: store.romKey(meta.id) });
    store.patch(store.romKey(meta.id), { opened: Date.now() }).catch(() => {});
  }
  toast(note);
  const audio = player.audio;
  if (!audio || audio.ac.state !== "running")
    setTimeout(() => {
      if (state.game && (!player.audio || player.audio.ac.state !== "running")) toast(t("web.soundHint"));
    }, 2600);
  refreshStart();
  return true;
}

async function busy(work) {
  if (state.opening) return false;
  state.opening = true;
  try {
    return await work();
  } catch (error) {
    toast(t("status.openFailed", { reason: reason(error) }), "error");
    logLine("WARN", `열지 못했습니다: ${reason(error)}`);
    syncControls();
    return false;
  } finally {
    state.opening = false;
  }
}

function openFile(file, patchRom = null) {
  return busy(async () => {
    let name = file.name;
    let ext = extOf(name);
    if (!OPEN_EXT.has(ext)) {
      toast(t("status.unsupported", { name }), "warn");
      return false;
    }
    await closeGame({ quiet: true });
    toast(t("status.opening", { name }));
    await paint();
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (ext === "zip") {
      ({ name, bytes } = unzip(bytes));
      ext = extOf(name);
    }
    if (ext === "wgbp") {
      const made = await makeFromPatch(name, bytes, patchRom);
      if (!made) return false;
      return launch(made.meta, made.bytes, { note: made.note, loader: made.loader });
    }
    const meta = await keepRom(name, bytes);
    return launch(meta, bytes);
  });
}

function openStored(key) {
  return busy(async () => {
    const info = await store.meta(key);
    const bytes = info ? await store.bytes(key) : null;
    if (!info || !bytes) {
      toast(t("web.lib.missing"), "warn");
      return false;
    }
    toast(t("status.opening", { name: info.name }));
    await paint();
    return launch(info, bytes);
  });
}

function openFiles(files) {
  const list = [...(files ?? [])];
  if (!list.length) return false;
  const games = list.filter((file) => OPEN_EXT.has(extOf(file.name)));
  if (!games.length) {
    toast(t("status.dropNothing"), "warn");
    return false;
  }
  const patchFile = games.find((file) => extOf(file.name) === "wgbp");
  if (patchFile) return openFile(patchFile, list.find((file) => file !== patchFile && ROM_EXT.has(extOf(file.name))) ?? null);
  return openFile(games[0]);
}

async function closeGame({ quiet = false } = {}) {
  if (!state.game) return;
  if (player.active) await player.stop();
  state.game = null;
  context.game = "";
  holds.delete("user");
  pad.releaseAll();
  syncControls();
  updateWake();
  if (!quiet) toast(t("status.closed"));
}

async function refreshStart() {
  let roms = [];
  let saves = new Set();
  try {
    roms = (await store.list(store.KIND_ROM)).sort((a, b) => (b.opened ?? 0) - (a.opened ?? 0));
    saves = new Set((await store.list(store.KIND_SAVE)).map((save) => save.id));
  } catch {}
  el.startHint.textContent = t(coarse.matches ? "web.start.pick" : "web.start.pickDrop");
  el.startList.replaceChildren(
    ...roms.slice(0, 20).map((rom) =>
      item({
        key: rom.key,
        name: rom.name,
        meta: join(fmtSize(rom.size), t("web.start.lastPlayed", { time: fmtTime(rom.opened) }), saves.has(rom.id) ? t("web.start.hasSave") : ""),
        onOpen: () => openStored(rom.key),
        actions: [(() => {
          const mark = make("span", "item__go");
          mark.append(iconNode("player-play"));
          return mark;
        })()],
      }),
    ),
  );
  el.startList.hidden = roms.length === 0;
  document.getElementById("start").classList.toggle("has-list", roms.length > 0);
  if (roms.length) el.startList.setAttribute("aria-label", t("web.start.recent"));
}

function togglePause() {
  if (!state.game) return;
  hold("user", !holds.has("user"));
}

const speedText = (value) => t("web.speed.value", { n: value });

function setSpeed(value) {
  savePrefs({ gameSpeed: SPEEDS.includes(value) ? value : 1 });
  applyPlayerPrefs();
  syncControls();
  toast(t("web.speed.changed", { speed: speedText(player.gameSpeed) }));
}

function toggleFast() {
  const at = SPEEDS.indexOf(SPEEDS.includes(state.prefs.gameSpeed) ? state.prefs.gameSpeed : 1);
  setSpeed(SPEEDS[(at + 1) % SPEEDS.length]);
}

async function resetGame() {
  if (!state.game) return;
  if (!(await confirmDialog(t("confirm.resetTitle"), t("confirm.resetText")))) return;
  hold("user", false);
  if (await player.reset()) toast(t("status.reset"));
}

function toggleFullscreen() {
  const doc = document;
  const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
  try {
    if (active) (doc.exitFullscreen ?? doc.webkitExitFullscreen).call(doc);
    else {
      const root = doc.documentElement;
      const result = (root.requestFullscreen ?? root.webkitRequestFullscreen).call(root, { navigationUI: "hide" });
      result?.catch?.(() => {});
    }
  } catch {}
}

function openSheet(name) {
  state.sheet = name;
  showNow(el.sheet);
  if (!state.sheetHistory) {
    history.pushState({ webgbaSheet: true }, "");
    state.sheetHistory = true;
  }
  hold("sheet", true);
  renderSheet();
  el.sheetClose.focus({ preventScroll: true });
}

function closeSheet({ fromHistory = false } = {}) {
  if (!state.sheet) return;
  state.sheet = "";
  hideLater(el.sheet, () => !state.sheet && el.sheetBody.replaceChildren());
  hold("sheet", false);
  if (state.sheetHistory) {
    state.sheetHistory = false;
    if (!fromHistory) history.back();
  }
}

function renderSheet() {
  const name = state.sheet;
  if (!name) return;
  const render = { library: renderLibrary, saves: renderSaves, settings: renderSettings, help: renderHelp, info: renderInfo }[name];
  render?.();
}

function group(title, ...children) {
  const node = make("section", "group");
  if (title) node.append(make("h3", "group__title", title));
  node.append(...children.filter(Boolean));
  return node;
}

function item({ name, meta, current = false, onOpen, actions = [], key = "" }) {
  const li = make("li", `item${current ? " is-current" : ""}`);
  if (key) li.dataset.key = key;
  const main = make("button", "item__main");
  main.type = "button";
  main.append(make("span", "item__name", name), make("span", "item__meta", meta));
  if (onOpen) main.addEventListener("click", onOpen);
  else main.disabled = true;
  const side = make("div", "item__actions");
  side.append(...actions);
  li.append(main, side);
  return li;
}

async function storageLine() {
  const estimate = await store.estimate();
  return estimate?.quota ? t("web.storageUse", { used: fmtSize(estimate.usage ?? 0), quota: fmtSize(estimate.quota) }) : "";
}

async function renderLibrary() {
  el.sheetTitle.textContent = t("web.library");
  let roms = [];
  let failed = false;
  try {
    roms = (await store.list(store.KIND_ROM)).sort((a, b) => (b.opened ?? 0) - (a.opened ?? 0));
  } catch {
    failed = true;
  }
  if (state.sheet !== "library") return;
  const list = make("ul", "list");
  list.dataset.kind = store.KIND_ROM;
  for (const rom of roms) {
    const current = state.game?.id === rom.id;
    list.append(
      item({
        key: rom.key,
        name: rom.name,
        meta: join(`.${rom.type}`, fmtSize(rom.size), t("web.lib.added", { date: fmtTime(rom.added) }), current ? t("web.lib.current") : ""),
        current,
        onOpen: () => {
          closeSheet();
          openStored(rom.key);
        },
        actions: [
          button({ kind: "tool", icon: "pencil", title: t("web.rename"), action: "rename", onClick: () => renameRom(rom) }),
          button({ kind: "tool", icon: "trash", title: t("web.delete"), action: "delete", onClick: () => deleteRom(rom) }),
        ],
      }),
    );
  }
  const total = roms.reduce((sum, rom) => sum + (rom.size ?? 0), 0);
  const line = await storageLine();
  if (state.sheet !== "library") return;
  const playing = state.game
    ? group(
        t("web.save.currentGame", { name: state.game.name }),
        (() => {
          const row = make("div", "start__actions");
          row.append(
            button({ label: t("menu.reset"), icon: "refresh", action: "reset", onClick: () => (closeSheet(), resetGame()) }),
            button({ label: t("web.closeGame"), icon: "x", action: "close-game", onClick: () => (closeSheet(), closeGame()) }),
          );
          return row;
        })(),
      )
    : null;
  el.sheetBody.replaceChildren(
    ...(playing ? [playing] : []),
    group(t("web.lib.files"), roms.length ? list : make("p", "empty", failed ? t("web.noStore") : t("web.lib.empty")), make("p", "note", t("web.lib.noExport"))),
    group(
      "",
      make("p", "note", join(t("web.lib.usage", { count: roms.length, size: fmtSize(total) }), line)),
    ),
  );
}

async function renameRom(rom) {
  const chosen = await askName({ title: t("web.rename"), text: t("web.rename.text", { name: rom.name }), value: rom.name, fallback: rom.name, selfId: rom.id });
  if (!chosen || chosen.name === rom.name) return;
  try {
    if (chosen.replace) {
      if (state.game?.id === chosen.replace.id) await closeGame({ quiet: true });
      await store.remove(chosen.replace.key);
    }
    await store.patch(rom.key, { name: chosen.name });
    await store.patch(store.saveKey(rom.id), { game: chosen.name });
    if (state.game?.id === rom.id) {
      state.game.name = chosen.name;
      context.game = chosen.name;
    }
    toast(t("web.renamed", { name: chosen.name }));
  } catch (error) {
    toast(reason(error), "error");
  }
  refreshStart();
  renderSheet();
}

async function deleteRom(rom) {
  const current = state.game?.id === rom.id;
  if (!(await confirmDialog(t("web.lib.deleteTitle"), t("web.lib.deleteText", { name: rom.name }), t("web.delete"), true))) return;
  if (current) await closeGame({ quiet: true });
  await leaveRow(rom.key);
  try {
    await store.remove(rom.key);
    toast(t("web.deleted", { name: rom.name }));
  } catch (error) {
    toast(reason(error), "error");
  }
  if (state.prefs.lastGame === rom.key) savePrefs({ lastGame: "" });
  refreshStart();
  renderSheet();
}

async function leaveRow(key) {
  const row = [...el.sheetBody.querySelectorAll(".item")].find((node) => node.dataset.key === key);
  if (!row) return;
  row.classList.add("is-leaving");
  await wait(160);
}

function downloadSave(fileName, bytes) {
  if (!/\.sav$/i.test(fileName)) throw new Error("save only");
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const isCurrentSave = (id) => Boolean(state.game) && state.game.saveId === id;

async function exportSave(id, name) {
  let bytes = null;
  if (isCurrentSave(id) && player.host) bytes = player.host.saveData();
  if (!bytes || !bytes.length) bytes = await store.saveBytes(id).catch(() => null);
  if (!bytes || !bytes.length) {
    toast(t("status.noSaveYet"), "warn");
    return;
  }
  downloadSave(saveFile(name), bytes);
  toast(t("status.saveExported", { name: saveFile(name) }));
}

async function importSave(id, name) {
  const files = await pickFile();
  const file = files[0];
  if (!file) return;
  const cap = isCurrentSave(id) && player.host ? player.host.saveCapacity : SAVE_IMPORT_MAX;
  if (file.size === 0 || file.size > cap) {
    toast(t("status.saveSizeBad", { kb: Math.round(cap / 1024) }), "warn");
    return;
  }
  if (!(await confirmDialog(t("confirm.importTitle"), t("web.save.importText", { name: saveFile(name), file: file.name })))) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const current = isCurrentSave(id) ? state.game : null;
  if (current) await closeGame({ quiet: true });
  try {
    await store.putSave(id, bytes, name);
  } catch (error) {
    toast(t("status.saveWriteFailed", { reason: error?.name === "QuotaExceededError" ? t("web.quota") : reason(error) }), "error");
    if (current) await openStored(current.key);
    return;
  }
  if (current) await openStored(current.key);
  toast(t("status.saveImportedFrom", { name: file.name }));
  renderSheet();
}

async function deleteSave(save, name) {
  if (!(await confirmDialog(t("web.save.deleteTitle"), t(isCurrentSave(save.id) ? "web.save.deleteRunning" : "web.save.deleteText", { name: saveFile(name) }), t("web.delete"), true))) return;
  await leaveRow(save.key);
  try {
    await store.remove(save.key);
    toast(t("web.deleted", { name: saveFile(name) }));
  } catch (error) {
    toast(reason(error), "error");
  }
  renderSheet();
}

async function renderSaves() {
  el.sheetTitle.textContent = t("web.saves");
  let saves = [];
  let failed = false;
  try {
    saves = (await store.list(store.KIND_SAVE)).sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
  } catch {
    failed = true;
  }
  if (state.sheet !== "saves") return;
  const children = [];
  if (state.game) {
    const { id, name } = state.game;
    const row = make("div", "start__actions");
    row.append(
      button({ label: t("web.save.export"), icon: "download", action: "export-current", onClick: () => exportSave(id, name) }),
      button({ label: t("web.save.import"), icon: "upload", action: "import-current", onClick: () => importSave(id, name) }),
    );
    children.push(group(t("web.save.currentGame", { name }), row));
  }
  const list = make("ul", "list");
  list.dataset.kind = store.KIND_SAVE;
  for (const save of saves) {
    const name = isCurrentSave(save.id) ? state.game.name : save.game || save.id;
    list.append(
      item({
        key: save.key,
        name: saveFile(name),
        meta: join(fmtSize(save.size), t("web.save.savedAt", { time: fmtTime(save.saved) }), isCurrentSave(save.id) ? t("web.lib.current") : ""),
        current: isCurrentSave(save.id),
        actions: [
          button({ kind: "tool", icon: "download", title: t("web.save.export"), action: "export", onClick: () => exportSave(save.id, name) }),
          button({ kind: "tool", icon: "upload", title: t("web.save.import"), action: "import", onClick: () => importSave(save.id, name) }),
          button({ kind: "tool", icon: "trash", title: t("web.delete"), action: "delete", onClick: () => deleteSave(save, name) }),
        ],
      }),
    );
  }
  const total = saves.reduce((sum, save) => sum + (save.size ?? 0), 0);
  const line = await storageLine();
  if (state.sheet !== "saves") return;
  children.push(
    group(t("web.save.files"), saves.length ? list : make("p", "empty", failed ? t("web.noStore") : t("web.save.empty"))),
    group("", make("p", "note", join(t("web.save.usage", { count: saves.length, size: fmtSize(total) }), line)), make("p", "note note--warn", t("web.storageNote"))),
  );
  el.sheetBody.replaceChildren(...children);
}

function field(label, note, control) {
  const row = make("div", "field");
  const text = make("div", "field__text");
  text.append(make("span", "field__label", label));
  if (note) text.append(make("span", "field__note", note));
  row.append(text, control);
  return row;
}

function selectField(label, note, options, value, onChange) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  for (const option of options) {
    const node = document.createElement("option");
    node.value = String(option.value);
    node.textContent = option.label;
    select.append(node);
  }
  select.value = String(value);
  select.addEventListener("change", () => onChange(select.value));
  return field(label, note, select);
}

function switchField(label, note, value, onChange) {
  const toggle = make("button", "switch");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("aria-checked", String(Boolean(value)));
  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-checked") !== "true";
    toggle.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return field(label, note, toggle);
}

function rangeField(label, note, value, onChange) {
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.step = "5";
  range.value = String(Math.round(value * 100));
  range.setAttribute("aria-label", label);
  range.addEventListener("input", () => onChange(Number(range.value) / 100));
  return field(label, note, range);
}

const CUSTOM_COLORS = [
  { id: "back", tokens: ["--bg-sunken", "--bg-deep"], fallback: "#070a14" },
  { id: "panel", tokens: ["--bg", "--bg-raised", "--bg-tint"], fallback: "#151d33" },
  { id: "text", tokens: ["--text", "--text-hi"], fallback: "#eef1f8" },
  { id: "accent", tokens: ["--accent", "--accent-hi"], fallback: "#6c93ff" },
  { id: "line", tokens: ["--line", "--line-strong"], fallback: "#3a4670" },
];

function customTokens() {
  const picked = state.prefs.customColors ?? {};
  const colors = {};
  for (const item of CUSTOM_COLORS) {
    const value = /^#[0-9a-f]{6}$/i.test(picked[item.id] ?? "") ? picked[item.id] : item.fallback;
    for (const token of item.tokens) colors[token] = value;
  }
  return colors;
}

function applyTheme(mode) {
  const id = theme.known(mode) ? mode : "dark";
  if (document.documentElement.dataset.ready && !reducedMotion()) {
    const veil = make("div", "theme-fade");
    veil.style.background = getComputedStyle(document.body).backgroundColor;
    document.body.append(veil);
    setTimeout(() => veil.remove(), 260);
  }
  theme.apply(id === "custom" ? { mode: "custom", colors: customTokens() } : { mode: id });
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg-sunken").trim();
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  skin.refreshColors();
  if (document.documentElement.dataset.ready) layout();
}

function colorField(item) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = customTokens()[item.tokens[0]];
  input.setAttribute("aria-label", t(`web.color.${item.id}`));
  input.addEventListener("input", () => {
    savePrefs({ customColors: { ...(state.prefs.customColors ?? {}), [item.id]: input.value } });
    applyTheme("custom");
  });
  return field(t(`web.color.${item.id}`), "", input);
}

async function setLang(id) {
  savePrefs({ lang: id });
  await i18n.use(id);
  context.quotaText = t("web.quota");
  syncControls();
  refreshStart();
  renderSheet();
}

function renderSettings() {
  el.sheetTitle.textContent = t("cfg.title");
  const p = state.prefs;
  const themeId = theme.known(p.theme) ? p.theme : "dark";
  const children = [
    group(
      t("cfg.group.screen"),
      selectField(t("cfg.lang.title"), "", i18n.LANGS.map((item) => ({ value: item.id, label: item.label })), i18n.lang(), (id) => setLang(id)),
      selectField(t("cfg.tab.theme"), "", theme.MODES.map((mode) => ({ value: mode.id, label: t(`theme.mode.${mode.id}`) })), themeId, (mode) => {
        savePrefs({ theme: mode });
        applyTheme(mode);
        renderSheet();
      }),
      ...(themeId === "custom" ? CUSTOM_COLORS.map(colorField) : []),
      selectField(t("web.dirInput"), t("web.dirInput.note"), DIR_MODES.map((value) => ({ value, label: t(`web.dirInput.${value}`) })), DIR_MODES.includes(p.dirInput) ? p.dirInput : "stick", (value) => {
        savePrefs({ dirInput: value });
        applyDirInput();
      }),
      selectField(
        t("web.pad"),
        t("web.pad.note"),
        ["on", "off"].map((value) => ({ value, label: t(`web.pad.${value}`) })),
        p.pad === "off" ? "off" : "on",
        (value) => {
          savePrefs({ pad: value });
          layout();
        },
      ),
      "vibrate" in navigator ? switchField(t("web.vibrate"), t("web.vibrate.note"), p.vibrate, (on) => savePrefs({ vibrate: on })) : null,
      "wakeLock" in navigator
        ? switchField(t("web.wakeLock"), t("web.wakeLock.note"), p.wakeLock, (on) => {
            savePrefs({ wakeLock: on });
            updateWake();
          })
        : null,
    ),
    group(
      t("cfg.group.sound"),
      switchField(t("cfg.muted"), "", p.muted, (on) => {
        savePrefs({ muted: on });
        applyPlayerPrefs();
      }),
      rangeField(t("cfg.volume"), t("cfg.volume.note"), Number.isFinite(p.volume) ? p.volume : 0.8, (volume) => {
        savePrefs({ volume });
        applyPlayerPrefs();
      }),
      switchField(t("cfg.fastMute"), t("cfg.fastMute.note"), p.fastMute, (on) => {
        savePrefs({ fastMute: on });
        applyPlayerPrefs();
      }),
    ),
    group(
      t("cfg.group.game"),
      selectField(t("web.speed"), t("web.speed.note"), SPEEDS.map((value) => ({ value, label: speedText(value) })), SPEEDS.includes(p.gameSpeed) ? p.gameSpeed : 1, (value) => setSpeed(Number(value))),
      selectField(t("cfg.dpadMode"), t("cfg.dpadMode.note"), DPAD_MODES.map((value) => ({ value, label: t(`cfg.dpadMode.${value}`) })), DPAD_MODES.includes(p.dpadMode) ? p.dpadMode : "latest", (value) => {
        savePrefs({ dpadMode: value });
        applyPlayerPrefs();
      }),
      switchField(t("web.pauseWhenHidden"), t("web.pauseWhenHidden.note"), p.pauseWhenHidden, (on) => savePrefs({ pauseWhenHidden: on })),
    ),
    group(
      "",
      (() => {
        const row = make("div", "start__actions");
        row.append(button({ label: t("help.title"), icon: "keyboard", onClick: () => openSheet("help") }), button({ label: t("info.title"), icon: "info-circle", onClick: () => openSheet("info") }));
        return row;
      })(),
    ),
  ];
  el.sheetBody.replaceChildren(...children.filter(Boolean));
}

function keyName(code) {
  if (NAMED_CODES.includes(code)) return t(`keyCode.${code}`);
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return t("keyCode.numpad", { key: code.slice(6) });
  const arrows = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  return arrows[code] ?? code;
}

function renderHelp() {
  el.sheetTitle.textContent = t("help.title");
  const list = make("dl", "keys");
  for (const name of KEY_ORDER) {
    list.append(make("dt", "", t(`key.${name}`)), make("dd", "", (DEFAULT_KEYS[name] ?? []).map(keyName).join(" · ")));
  }
  list.append(make("dt", "", t("web.speed")), make("dd", "", t("keyCode.Tab")), make("dt", "", t("help.pause")), make("dd", "", "P · Pause"));
  el.sheetBody.replaceChildren(group(t("web.help.keyboard"), list), group(t("web.help.touchTitle"), make("p", "note", t("web.help.touch")), make("p", "note", t("web.help.gamepad"))));
}

function renderInfo() {
  el.sheetTitle.textContent = t("info.title");
  const links = make("div", "links");
  for (const [href, label] of [
    ["/THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES"],
    ["/LICENSE.txt", "LICENSE (MIT)"],
    ["/licenses/mgba-LICENSE.txt", "mGBA (MPL-2.0)"],
    ["/licenses/blip_buf-LICENSE.txt", "blip_buf (LGPL-2.1)"],
    ["/licenses/inih-LICENSE.txt", "inih (BSD-3-Clause)"],
    ["/licenses/pako-LICENSE.txt", "pako (MIT AND Zlib)"],
    ["/fonts/Galmuri-OFL.txt", "Galmuri (OFL-1.1)"],
    ["https://github.com/flightrabbit-hash/webGBA", "GitHub"],
  ]) {
    const link = make("a", "", label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    links.append(link);
  }
  el.sheetBody.replaceChildren(
    group("", make("p", "", `webGBA ${BUILD.version} · ${BUILD.hash}`), make("p", "note", t("web.info.about")), make("p", "note", t("web.privacy")), make("p", "note", LICENSE_LINE)),
    group(t("info.openSource"), make("p", "note", t("info.mgba")), make("p", "note", t("info.mgbaSource")), make("p", "note", t("info.others")), links),
  );
}

function typing(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}

function onKeyDown(event) {
  if (state.dialogDone) {
    if (event.key === "Escape") {
      event.preventDefault();
      state.dialogDone(null);
    }
    return;
  }
  if (state.sheet) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
    }
    return;
  }
  if (typing(event.target)) return;
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyO") {
    event.preventDefault();
    pickFile({ multiple: true }).then(openFiles);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const code = codeOf(event);
  if (!state.game) return;
  if (code === "Tab") {
    event.preventDefault();
    if (!event.repeat) toggleFast();
    return;
  }
  if (code === "KeyP" || code === "Pause") {
    event.preventDefault();
    if (!event.repeat) togglePause();
    return;
  }
  if (player.keyDown(code)) event.preventDefault();
}

function onKeyUp(event) {
  if (player.keyUp(codeOf(event))) event.preventDefault();
}

function unlockAudio() {
  if (!player.audio || player.audio.ac.state !== "running") player.ensureAudio();
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    if (player.active) player.flushSave();
    pad.releaseAll();
    player.releaseAll();
    if (state.prefs.pauseWhenHidden) hold("hidden", true);
  } else {
    hold("hidden", false);
    state.reg?.update().catch(() => {});
  }
  updateWake();
}

function showUpdate(worker) {
  el.noticeText.textContent = t("web.update");
  el.noticeGo.textContent = t("web.updateGo");
  el.notice.hidden = false;
  el.noticeGo.onclick = async () => {
    el.noticeGo.disabled = true;
    if (player.active) await player.flushSave({ final: true });
    worker.postMessage("skipWaiting");
  };
}

async function registerWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    state.reg = reg;
    const watch = (worker) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(worker);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    watch(reg.installing);
    reg.addEventListener("updatefound", () => watch(reg.installing));
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !state.updateAsked) return;
      reloading = true;
      location.reload();
    });
    el.noticeGo.addEventListener("click", () => (state.updateAsked = true));
  } catch (error) {
    logLine("WARN", `서비스 워커를 등록하지 못했습니다: ${reason(error)}`);
  }
}

function wire() {
  el.btnOpen.addEventListener("click", () => pickFile({ multiple: true }).then(openFiles));
  el.startOpen.addEventListener("click", () => pickFile({ multiple: true }).then(openFiles));
  el.btnLibrary.addEventListener("click", () => openSheet("library"));
  el.btnSaves.addEventListener("click", () => openSheet("saves"));
  el.btnSettings.addEventListener("click", () => openSheet("settings"));
  el.btnSound.addEventListener("click", toggleSound);
  el.btnMenu.addEventListener("click", () => setMenu(!state.menuOpen));
  el.bar.addEventListener("click", (event) => {
    if (state.menuOpen && event.target.closest?.(".bar__group--files .tool")) setTimeout(() => state.menuOpen && setMenu(false), 0);
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!state.menuOpen || el.bar.contains(event.target) || el.btnMenu.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
    },
    { capture: true },
  );
  for (const node of [...el.bar.querySelectorAll(".tool"), el.btnMenu]) {
    const press = (on) => () => skin.tool(node, { pressed: on && !node.disabled });
    node.addEventListener("pointerdown", press(true));
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) node.addEventListener(type, press(false));
  }
  el.btnFast.addEventListener("click", toggleFast);
  el.btnFull.addEventListener("click", toggleFullscreen);
  el.btnFull.hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  el.veilResume.addEventListener("click", () => hold("user", false));
  el.veilReset.addEventListener("click", resetGame);
  el.veilClose.addEventListener("click", () => closeGame());
  el.sheetClose.addEventListener("click", () => closeSheet());
  el.sheet.addEventListener("click", (event) => event.target === el.sheet && closeSheet());
  el.dialog.addEventListener("click", (event) => event.target === el.dialog && state.dialogDone?.(null));
  el.toast.addEventListener("click", () => (el.toast.hidden = true));
  el.bar.addEventListener("click", (event) => event.target.closest?.("button")?.blur());
  el.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown", "click"]) window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", () => setTimeout(layout, 120));
  window.visualViewport?.addEventListener("resize", layout);
  coarse.addEventListener?.("change", layout);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", () => player.active && player.flushSave({ final: true }));
  window.addEventListener("blur", () => player.releaseAll());
  window.addEventListener("popstate", () => {
    if (state.sheet) closeSheet({ fromHistory: true });
  });
  for (const name of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(name, () => (syncControls(), setTimeout(layout, 60)));
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("dragstart", (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault();
  });
  document.addEventListener("selectstart", (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault();
  });
  document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });

  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth++;
    el.drop.hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", () => {
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) el.drop.hidden = true;
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    el.drop.hidden = true;
    if (state.sheet) closeSheet();
    openFiles(event.dataTransfer.files);
  });

  const viewport = window.visualViewport;
  const syncViewport = () => {
    const root = document.documentElement.style;
    root.setProperty("--vv-h", `${viewport ? viewport.height : window.innerHeight}px`);
    root.setProperty("--vv-top", `${viewport ? viewport.offsetTop : 0}px`);
  };
  syncViewport();
  viewport?.addEventListener("resize", syncViewport);
  viewport?.addEventListener("scroll", syncViewport);
  window.addEventListener("resize", syncViewport);

  let inkFrame = 0;
  new MutationObserver(() => {
    if (inkFrame) return;
    inkFrame = requestAnimationFrame(() => {
      inkFrame = 0;
      centerInk(document);
      centerIcons(document);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-state", "hidden", "class"] });

  context.onSaveFailed = (error) => {
    if (state.saveFailNotified) return;
    state.saveFailNotified = true;
    openDialog({ title: t("web.saveFail.title"), body: [t("web.saveFail.text", { reason: error.message })], actions: [{ label: "OK", value: true, primary: true }] }).then(() => openSheet("saves"));
  };
  context.onSaved = () => {
    state.saveFailNotified = false;
  };
}

let installEvent = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
  if (state.gate) renderGate();
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  state.installed = true;
  if (state.gate) renderGate();
});

const standalone = () => ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) || navigator.standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const DEV_KEY = "webgba.dev";

function devBypass() {
  try {
    if (new URLSearchParams(location.search).get("dev") === "1") sessionStorage.setItem(DEV_KEY, "1");
    return sessionStorage.getItem(DEV_KEY) === "1";
  } catch {
    return false;
  }
}

function platform() {
  const ua = navigator.userAgent;
  const inApp = /KAKAOTALK|NAVER\(|NAVER\/|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua);
  if (isIos()) return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) && !inApp ? "iosSafari" : "iosOther";
  if (/Android/i.test(ua)) return inApp ? "androidInApp" : "android";
  if (/Firefox\//.test(ua)) return "unsupported";
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return "macSafari";
  return "desktop";
}

const GATE_STEPS = {
  iosSafari: [
    ["share", "web.gate.iosShare"],
    ["square-plus", "web.gate.iosAdd"],
    ["app-window", "web.gate.iosOpen"],
  ],
  iosOther: [
    ["external-link", "web.gate.openSafari"],
    ["share", "web.gate.iosShare"],
    ["square-plus", "web.gate.iosAdd"],
    ["app-window", "web.gate.iosOpen"],
  ],
  androidInApp: [
    ["external-link", "web.gate.openChrome"],
    ["dots-vertical", "web.gate.androidMenu"],
    ["download", "web.gate.androidInstall"],
    ["app-window", "web.gate.openApp"],
  ],
  android: [
    ["dots-vertical", "web.gate.androidMenu"],
    ["download", "web.gate.androidInstall"],
    ["app-window", "web.gate.openApp"],
  ],
  desktop: [
    ["download", "web.gate.desktopInstall"],
    ["app-window", "web.gate.desktopOpen"],
  ],
  macSafari: [
    ["share", "web.gate.macDock"],
    ["app-window", "web.gate.macOpen"],
  ],
  unsupported: [["external-link", "web.gate.unsupported"]],
};

function renderGate() {
  const gate = el.gate;
  const kind = platform();
  gate.dataset.platform = kind;
  const card = make("div", "gate__card");
  const logo = document.createElement("img");
  logo.className = "gate__logo";
  logo.src = "/icons/icon-192.png";
  logo.alt = "";
  logo.width = 96;
  logo.height = 96;
  const steps = make("ol", "gate__steps");
  GATE_STEPS[kind].forEach(([icon, key], index) => {
    const row = make("li", "gate__step");
    const num = make("span", "gate__num");
    num.append(make("span", "gate__digit", String(index + 1)));
    row.append(num, iconNode(icon), make("span", "gate__text", t(key)));
    steps.append(row);
  });
  const actions = make("div", "gate__actions");
  if (installEvent && !state.installed) {
    actions.append(
      button({
        label: t("web.gate.install"),
        icon: "download",
        kind: "primary",
        action: "install",
        onClick: async () => {
          const event = installEvent;
          installEvent = null;
          await event.prompt();
          renderGate();
        },
      }),
    );
  }
  if (kind === "androidInApp") {
    const url = new URL(location.href);
    actions.append(
      button({
        label: t("web.gate.chrome"),
        icon: "external-link",
        action: "chrome",
        onClick: () => (location.href = `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end`),
      }),
    );
  }
  if (["iosOther", "androidInApp", "unsupported"].includes(kind)) {
    actions.append(
      button({
        label: t("web.gate.copy"),
        icon: "copy",
        action: "copy",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(location.href.replace(/[?&]dev=1/, ""));
            note.textContent = t("web.gate.copied");
          } catch {
            note.textContent = location.href;
          }
        },
      }),
    );
  }
  const note = make("p", "gate__note", state.installed ? t("web.gate.installed") : t("web.privacy"));
  card.append(logo, make("h1", "gate__title", t("web.gate.title")), make("p", "gate__lead", t("web.gate.lead")), steps);
  if (actions.childElementCount) card.append(actions);
  card.append(note);
  gate.replaceChildren(card);
}

function showGate() {
  state.gate = true;
  document.body.dataset.gate = "on";
  el.gate.hidden = false;
  renderGate();
}

async function boot() {
  applyTheme(state.prefs.theme);
  await i18n.use(i18n.known(state.prefs.lang) ? state.prefs.lang : "ko");
  document.fonts?.ready.then(() => {
    state.glyphCache?.clear();
    state.baselineCache?.clear();
    centerInk(document);
    centerIcons(document);
  });
  if (!standalone() && !devBypass()) {
    showGate();
    document.addEventListener(i18n.CHANGED, renderGate);
    document.documentElement.dataset.ready = "1";
    registerWorker();
    return;
  }
  context.quotaText = t("web.quota");
  player.setKeys(keyTable());
  applyPlayerPrefs();
  applyDirInput();
  wire();
  layout();
  syncControls();
  await refreshStart();
  try {
    await store.list(store.KIND_SAVE);
  } catch {
    state.storeBroken = true;
    toast(t("web.noStore"), "error");
  }
  document.documentElement.dataset.ready = "1";
  registerWorker();
  if (!state.storeBroken) store.persist();
}

window.webgba = { player, pad, skin, store, state, layout, openFiles, openLoader, toast, refreshStart, textInk, version: BUILD };

boot().catch((error) => {
  console.error(error);
  toast(t("status.bootFailed", { reason: reason(error) }), "error");
});
