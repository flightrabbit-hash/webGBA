import { context } from "./bridge.js";
import { bootHost, inspectModule, readEmbeddedRom, readRomPayload } from "./core/web-host.js";
import { compileCode, gameInfo, pickText, problemText, readWgba, screenOf, supportProblem, wgbaErrorText } from "./core/wgba-read.js";
import { bootScript } from "./core/script-host.js";
import { resolveInput, romHeader, updateAction, wasmSections } from "./core/wgba-format.js";
import { readPatch, sha1Hex, WgbpError } from "./core/wgbp.js";
import { openLoader, runPatchJob } from "./app/patch-loader.js";
import { audioSessionType, buttonLabel, codeOf, DEFAULT_KEYS, DPAD_MODES, GBA_LAYOUT, layoutKeys, Player } from "./app/player.js";
import * as i18n from "./shell/i18n.js";
import * as theme from "./shell/theme.js";
import * as store from "./store.js";
import { DIR_MODES, DIRS, VirtualPad } from "./pad.js";
import { extractRom, ZipError } from "./zip.js";
import { Skin } from "./skin.js";
import * as cartArt from "./cart.js";
import { BUILD } from "./build-info.js";

const { t } = i18n;
const $ = (id) => document.getElementById(id);

const el = {
  app: $("app"),
  bar: $("bar"),
  btnOpen: $("btnOpen"),
  btnLibrary: $("btnLibrary"),
  menuPanel: document.querySelector(".bar__group--files"),
  btnSaves: $("btnSaves"),
  btnQuick: $("btnQuick"),
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
  startAll: $("startAll"),
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
const QUICK_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const AUTO_SLOT = 9;
const AUTO_SAVE_MINUTES = [0, 1, 3, 5, 10, 15, 30];
const AUTO_SAVE_DEFAULT = 5;
const AUTO_TOAST_MS = 1600;

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
  quick: { tab: "save", info: new Map(), urls: [], busy: false, played: 0, lastTick: 0, syncMs: 0, lastMs: 0, autoCount: 0 },
  extra: null,
  // 지금 게임의 버튼 목록(resolveInput — 설명서 input, 없으면 GBA 10버튼)
  input: GBA_LAYOUT,
  // 라이브러리: sel = 꺼낸 롬팩(보관 키), refs = 지금 그린 책장 노드, savesFor = 세이브 창을 한 게임만 걸러 볼 때
  lib: { sel: "", refs: null, savesFor: null, token: 0 },
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
    if (this.audio && !this.audio.stuck) {
      if (this.audio.ac.state !== "running") this.wakeAudio(true);
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
  onChange: () => syncControls(),
});

const padCode = (name) => `Pad:${name}`;

// 터치 버튼 자리 ← role(규격 5.2). 게임이 그 role 버튼을 정의했을 때만 그 자리가 보이고, 누르면 그 버튼(① bit)을 보낸다.
// C·D 는 c·d role 을 정의한 게임에서만 A·B 위에(키보드 기본 C·I / V·U — ROLE_KEYS). l2·r2·extra 는 터치 자리가 아직 없음(키보드·게임패드만).
const EXTRA_PAD = ["C", "D"];
const TOUCH_SLOT = { a: "A", b: "B", c: "C", d: "D", l: "L", r: "R", start: "START", select: "SELECT", up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT" };

function keyTable() {
  const keys = layoutKeys(state.input, DEFAULT_KEYS);
  for (const b of state.input.buttons) {
    const slot = TOUCH_SLOT[b.role];
    if (slot && b.touch !== "hide") keys[b.id] = [...(keys[b.id] ?? []), padCode(slot)];
  }
  return keys;
}

/** 지금 게임이 터치 화면에 쓰는 자리(TOUCH_SLOT 값) 묶음. */
function touchSlots(input = state.input) {
  return new Set(input.buttons.filter((b) => b.touch !== "hide").map((b) => TOUCH_SLOT[b.role]).filter(Boolean));
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

// C·D 터치 버튼을 켜고 끄는 곳(하나뿐): shown = { C: true, D: true } 처럼 게임이 c·d role 을 정의한 자리.
// 없거나 null 이면 A·B 만 = 지금 화면 그대로(.gba·설명서 없는 .wgba·.wasm·preset gba 만 쓰는 게임 — 설정 항목 없음).
// 화면만 바꾼다 — 보내는 비트·키는 setInput 이 버튼 목록으로 정한다. 바뀌었으면 true.
function setExtraButtons(shown) {
  const extra = EXTRA_PAD.filter((name) => shown?.[name]);
  const next = extra.length ? extra : null;
  if (JSON.stringify(next) === JSON.stringify(state.extra)) return false;
  state.extra = next;
  if (next) el.pad.dataset.extra = next.join(" ");
  else delete el.pad.dataset.extra;
  return true;
}

// 게임의 버튼 목록(resolveInput 결과, null = GBA 10버튼)을 입력·터치 화면에 잇는다(startHosted·closeGame·시험).
// 키보드·게임패드는 정의된 버튼 모두, 터치는 정의된 role 자리만(나머지 자리는 data-off 로 숨김), C·D 는 정의했을 때만.
function setInput(input) {
  const next = input ?? GBA_LAYOUT;
  pad.releaseAll();
  state.input = next;
  const slots = touchSlots(next);
  let changed = setExtraButtons({ C: slots.has("C"), D: slots.has("D") });
  for (const node of el.pad.querySelectorAll("[data-key]")) {
    if (EXTRA_PAD.includes(node.dataset.key)) continue;
    const off = !slots.has(node.dataset.key);
    if (off !== node.hasAttribute("data-off")) {
      node.toggleAttribute("data-off", off);
      changed = true;
    }
  }
  const dirOff = !DIRS.some((name) => slots.has(name));
  if (dirOff !== el.dpad.hasAttribute("data-off")) {
    el.dpad.toggleAttribute("data-off", dirOff);
    changed = true;
  }
  player.setLayout(next, keyTable());
  if (changed && document.documentElement.dataset.ready) layout();
}

/** 시험·개발용: 설명서 input 객체(또는 null)로 바로 setInput — window.webgba.setInput({ preset: "gba", buttons: [...] }). */
const setInputFrom = (input, runtime = "webapi") => setInput(input ? resolveInput({ runtime, input }) : null);

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
  if (!text) {
    hideLater(el.toast);
    return;
  }
  el.toast.replaceChildren(make("span", "toast__text", text));
  el.toast.classList.toggle("is-error", level === "error");
  el.toast.classList.toggle("is-warn", level === "warn");
  showNow(el.toast);
  if (level !== "error") state.toastTimer = setTimeout(() => hideLater(el.toast), level === "warn" ? ms * 1.6 : ms);
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

// 여닫는 창 시간(web.css --pop-ms 와 같은 값). 움직임 줄이기면 0.
const popMs = () => (reducedMotion() ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pop-ms")) || 200);

function stopHide(node) {
  clearTimeout(node.hideTimer);
  if (node.hideEnd) node.removeEventListener("animationend", node.hideEnd);
  node.hideEnd = null;
}

// 닫는 움직임(.is-closing 의 fade-out)이 끝난 뒤 숨긴다 — animationend, 오지 않으면(탭 숨김 등) 시간 + 여유로.
function hideLater(node, after) {
  stopHide(node);
  const finish = () => {
    stopHide(node);
    if (node.classList.contains("is-closing")) node.classList.remove("is-closing");
    if (!node.hidden) node.hidden = true;
    after?.();
  };
  if (reducedMotion() || node.hidden) {
    finish();
    return;
  }
  node.classList.add("is-closing");
  node.hideEnd = (event) => event.target === node && finish();
  node.addEventListener("animationend", node.hideEnd);
  node.hideTimer = setTimeout(finish, popMs() + 80);
}

function showNow(node) {
  stopHide(node);
  if (node.classList.contains("is-closing")) node.classList.remove("is-closing");
  node.hidden = false;
}

const FRAME_ROWS = 3;
const ART = { stick: 37, shoulderH: 17, pillH: 15, roundH: 27 };
const FACE = { portrait: { w: 23 * 2, h: 27 * 1.6 }, landscape: { w: 23 * 2.05, h: 27 * 1.75 } };
// C·D 가 있으면 A·B 묶음 위에 같은 모양 한 단(C 는 A 위, D 는 B 위): A·B 를 faceUp 만큼 내린다
// (C 아래 ↔ A 위 사이 = D 아래 ↔ B 위 사이 = faceUp − 버튼 높이).
// 세로: 대각선 단차(face.h − 버튼 높이) 2개 — 네 버튼이 같은 간격의 지그재그.
// 가로: 그 간격(빈 줄 13.5칸)이면 두 줄이 떨어져 보여서(사용자 2026-10-31 "AB버튼과 CD버튼 사이가 너무 멀어보여") 한 묶음으로
// 좁힌다 — C 아래 ↔ A 위 빈 줄(그림자 뺀 잉크: 면 23 + 옆면 2 = 25 아래)을 6칸으로. A·B 사이 가장 가까운 잉크 거리는
// 원으로 약 7.3칸이지만 픽셀 계단 때문에 실제 약 6.4칸이라, 그보다 넓지 않은 가장 큰 정수 줄 수(시험 web-ui C·D 가 잼).
const FACE_UP_LANDSCAPE = 25 + 6;
const faceUp = (face, landscape) => (landscape ? FACE_UP_LANDSCAPE : 2 * (face.h - ART.roundH));

function layout() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const landscape = width > height;
  const padOn = padVisible();
  const body = document.body;
  body.dataset.layout = landscape ? "landscape" : "portrait";
  body.dataset.pad = padOn ? "on" : "off";
  if (landscape && (state.menuOpen || el.menuPanel.dataset.open)) setMenu(false, { instant: true });
  const dpr = window.devicePixelRatio || 1;
  const inset = safeInsets();
  const innerW = Math.max(0, width - inset.l - inset.r);
  const innerH = Math.max(0, height - inset.t - inset.b);
  const root = document.documentElement.style;
  const icon = 2;
  const face = landscape ? FACE.landscape : FACE.portrait;
  const four = Boolean(state.extra);
  const faceH = face.h + (four ? faceUp(face, landscape) : 0);
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
    let padH = innerH - barH - sh - edge * 2;
    // 버튼 배율은 C·D 와 관계없이 A·B 만일 때와 같다(규격 5.4: 버튼을 줄여 그리지 않음).
    art = clamp(Math.floor(Math.min((innerW - 44) / (ART.stick + face.w), (padH - 44) / (ART.shoulderH + face.h + ART.pillH))), 2, 6);
    if (four) {
      // C·D 가 있으면 버튼 칸 = 위아래 여백 24 + 줄 간격 16 + L·R 줄 + 네 버튼 줄 + START 줄(+ 여유 4). 모자라면(좁은 세로 320·360 등)
      // 버튼 크기는 그대로 두고 게임 화면을 그만큼 줄인다(3:2 영역 맞춤). 화면이 가장 작은 값(96)이어도 모자랄 때만 배율을 낮춘다.
      const needPad = (a) => {
        const u = skin.px(a) / dpr;
        return 44 + (ART.shoulderH + ART.pillH) * u + Math.round(faceH * u);
      };
      if (needPad(art) > padH) {
        sh = Math.max(96, Math.min(sh, Math.floor(innerH - barH - edge * 2 - needPad(art))));
        sw = Math.floor(sh * 1.5);
        padH = innerH - barH - sh - edge * 2;
      }
      while (art > 2 && needPad(art) > padH) art--;
    }
    root.setProperty("--side", "0px");
  } else if (padOn && landscape) {
    art = clamp(Math.floor(Math.min((innerH - 30) / 95, innerW / 260)), 2, 5);
    if (four) {
      // 네 버튼 묶음은 오른쪽 세로줄 전체에서 R(위 여백 8) 아래 ~ START(아래 여백 10) 위 가운데(web.css) — 그 사이에 들어가는 배율까지.
      const fits = (a) => {
        const u = skin.px(a) / dpr;
        return Math.round(faceH * u) <= innerH - (ART.shoulderH * u + 8) - (ART.pillH * u + 10) - 4;
      };
      while (art > 2 && !fits(art)) art--;
    }
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
  const up = Math.round(faceUp(face, landscape) * unit);
  root.setProperty("--face-h", `${Math.round(face.h * unit) + (four ? up : 0)}px`);
  root.setProperty("--face-up", `${up}px`);
  // 가로 C·D 묶음은 세로줄 전체 가운데에 놓이므로 R 줄(8 + R)과 START 줄(START + 10)의 차이 절반만큼 내려 둘 사이 가운데로.
  root.setProperty("--face-shift", `${((ART.shoulderH - ART.pillH) * unit + 8 - 10) / 2}px`);
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
  fitRecent();
  requestAnimationFrame(() => {
    centerInk(document);
    centerIcons(document);
  });
}

const toolOff = (node) => node.disabled || node.getAttribute("aria-disabled") === "true";

function syncTools() {
  const running = Boolean(state.game);
  const full = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
  const size = 2;
  for (const node of el.bar.querySelectorAll(".tool")) {
    skin.tool(node, {
      size,
      disabled: toolOff(node),
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
  const view = running ? "game" : "start";
  const back = document.body.dataset.view !== view && !running;
  document.body.dataset.view = view;
  if (back) fitRecent();
  const userPaused = running && holds.has("user");
  el.btnFast.setAttribute("aria-pressed", String(player.gameSpeed !== 1));
  // 값이 같으면 쓰지 않는다: hidden·글자를 같은 값으로 다시 써도 MutationObserver 가 깨어 다음 프레임에
  // 문서 전체 centerInk 가 돌았다(햄버거·시트를 열 때마다 hold → syncControls).
  const badge = el.btnFast.querySelector(".tool__badge") ?? el.btnFast.appendChild(make("span", "tool__badge"));
  const badgeText = speedText(player.gameSpeed);
  if (badge.textContent !== badgeText) badge.textContent = badgeText;
  if (badge.hidden !== (player.gameSpeed === 1)) badge.hidden = player.gameSpeed === 1;
  el.btnSound.setAttribute("aria-pressed", String(Boolean(state.prefs.muted)));
  setLabel(el.btnSound, state.prefs.muted ? "rail.unmute" : "rail.mute");
  if (el.pauseVeil.hidden !== !userPaused) el.pauseVeil.hidden = !userPaused;
  const full = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
  setLabel(el.btnFull, full ? "web.fullscreenExit" : "web.fullscreen");
  el.btnMenu.setAttribute("aria-expanded", String(Boolean(state.menuOpen)));
  el.btnQuick.setAttribute("aria-disabled", String(!canQuick()));
  syncTools();
}

// 세로 햄버거 창. 예전에는 열고 닫을 때마다 layout()(가상 버튼·화면 테두리·기능 버튼 전부 다시 그리기 + 루트 CSS 변수)을
// 불러 그 프레임이 막혔고, 닫으면 display:none 으로 바로 사라졌다. 이제 data-open 만 바꿔 CSS transition(transform·opacity,
// 합성 층)으로 여닫고, 닫기는 transition 이 끝난 뒤(transitionend, 늦으면 시간으로) 숨긴다. instant = 가로로 바뀔 때 바로.
function setMenu(open, { instant = false } = {}) {
  const panel = el.menuPanel;
  clearTimeout(panel.menuTimer);
  if (panel.menuEnd) panel.removeEventListener("transitionend", panel.menuEnd);
  panel.menuEnd = null;
  if (open) panel.dataset.open = "open";
  else if (instant || reducedMotion() || !panel.dataset.open) delete panel.dataset.open;
  else {
    panel.dataset.open = "closing";
    const finish = () => {
      clearTimeout(panel.menuTimer);
      panel.removeEventListener("transitionend", panel.menuEnd);
      panel.menuEnd = null;
      if (panel.dataset.open === "closing") delete panel.dataset.open;
    };
    panel.menuEnd = (event) => event.target === panel && event.propertyName === "transform" && finish();
    panel.addEventListener("transitionend", panel.menuEnd);
    panel.menuTimer = setTimeout(finish, popMs() + 80);
  }
  if (state.menuOpen === open) return;
  state.menuOpen = open;
  document.body.dataset.menu = open ? "open" : "";
  hold("menu", open);
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

const INK_SINGLE = ".gate__digit, .toast__text, .gate__text, .btn__label, .loader__label, .loader__percent, .loader__time, .sheet__title, .group__title, .veil__title, .notice__text, .dialog__hint, .start__hint, .seg__label, .slot__time, .slot__tag, .slot__empty, .recent__name, .recent__meta, .recent__allLabel, .lib__name, .lib__meta, .lib__count, .lib__hint, .pack__chipText, .info__line";
const INK_BLOCK = ".item__main, .field__text, .pack__label";

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

const iconSvg = new Map();

// 아이콘은 늘 span.icon. 넣는 svg(태블러)도 class 에 "icon" 이 있어 그대로 두면 다시 잡혀 svg 안에 svg 를 끝없이 넣고,
// 그 변화가 MutationObserver 를 깨워 매 프레임 centerIcons 가 돌았다(안드로이드 프레임 떨어짐, 2026-10-30).
function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll?.("span.icon:not(.icon--svg)") ?? []) {
    const url = iconUrl(node);
    if (!url) continue;
    if (!iconSvg.has(url)) iconSvg.set(url, fetch(url).then((response) => (response.ok ? response.text() : "")).catch(() => ""));
    node.classList.add("icon--svg");
    iconSvg.get(url).then((text) => {
      if (!text || node.querySelector("svg")) return;
      const holder = document.createElement("template");
      holder.innerHTML = text.trim();
      const svg = holder.content.querySelector("svg");
      if (!svg) return;
      svg.classList.remove("icon");
      node.replaceChildren(svg);
    });
  }
}

function centerIcons(root = document) {
  hydrateIcons(root);
  for (const node of root.querySelectorAll?.("span.icon") ?? []) {
    const url = iconUrl(node);
    if (!url) continue;
    if (!iconInk.has(url)) {
      iconInk.set(url, null);
      loadIconInk(url);
      continue;
    }
    const ink = iconInk.get(url);
    if (!ink) continue;
    const dx = Math.round(ink.dx * node.offsetWidth);
    const dy = Math.round(ink.dy * node.offsetHeight);
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
    // 같은 이름이면 같은 항목(지금까지 규칙). 설명서가 있는 게임 항목(게임 id 로 묶임)은 이름으로 덮어쓰지 않는다.
    try {
      existing = (await store.list(store.KIND_ROM)).find((item) => store.sameName(item.name, name) && !item.gameId) ?? null;
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

// ── 설명서가 있는 .wgba(규격 1): 게임 id 로 묶기 ──
// 세이브·퀵슬롯을 묶는 id: 설명서가 있는 .wgba 는 게임 id(버전이 바뀌어도 같음), 그 밖(.gba·.wasm·옛 .wgba)은 보관 id.
const saveIdOf = (meta) => meta?.gameId || meta?.id || "";
const titleOf = (meta) => (meta?.gameId ? pickText(meta.title, i18n.lang()) || meta.name : meta?.name ?? "");
const byOpened = (a, b) => (b.opened ?? 0) - (a.opened ?? 0);
// 라이브러리에 보일 이름: 설명서 게임은 설명서 이름(사람이 이름을 바꿨으면 그 이름), 그 밖은 보관 이름(확장자 뺌).
const GAME_EXT = /\.(gba|agb|bin|zip|wgba|wasm)$/i;
const bareName = (name) => String(name ?? "").replace(GAME_EXT, "") || String(name ?? "");
const displayName = (rom) => (rom?.gameId && !rom.named ? titleOf(rom) || bareName(rom.name) : bareName(rom?.name));
// 옆면 세로 글: shortName → 이름
const spineName = (rom) => (rom?.gameId && !rom.named ? pickText(rom.shortName, i18n.lang()) || displayName(rom) : displayName(rom));
// 롬팩 아래 작은 글: .wgba 설명서 = v1.2.0, 옛 .wgba 로 되돌린 게임 = "옛 .wgba", 그 밖 = 형식
const kindText = (rom) => (rom.gameId ? (rom.version ? `v${rom.version}` : t("web.lib.oldWgba")) : `.${rom.type}`);

/** 목차가 있으면 readWgba 결과, 없으면 null. 망가졌으면 보일 문장으로 던짐. */
async function inspectWgba(bytes) {
  if (!isWasmBytes(bytes)) return null;
  try {
    return await readWgba(bytes);
  } catch (error) {
    logLine("WARN", `.wgba 목차·설명서를 읽지 못했습니다: ${reason(error)}`);
    throw new Error(wgbaErrorText(error));
  }
}

/** 보관한 .wgba 의 롬 구획 머리 SHA-1(풀지 않고 머리 36바이트만). 롬이 없으면 "". */
function storedRomSha1(bytes) {
  try {
    const rom = wasmSections(bytes)
      .filter((s) => s.id === 0 && s.name === "webgba.rom")
      .at(-1);
    return rom ? romHeader(bytes.subarray(rom.payload, rom.end)).sha1 : "";
  } catch {
    return "";
  }
}

/**
 * 옛 세이브를 옮길 옛 항목(설계 3절, 이번 한 번 예외): 그 게임 id 의 세이브·퀵슬롯이 아직 없을 때만, 게임 id 가 없는 .wgba 보관 항목 중
 * 롬 SHA-1 이 새 파일의 롬 조각과 같은 것 — 여럿이면 마지막에 연 것 하나. 롬이 없는 파일·.gba·.wasm 은 옮기지 않는다.
 */
async function oldSameGame(info, roms) {
  if (!info.romSha1) return null;
  try {
    if (await store.meta(store.saveKey(info.gameId))) return null;
    if ((await store.states(info.gameId)).length) return null;
  } catch {
    return null;
  }
  for (const rom of roms.filter((item) => item.type === "wgba" && !item.gameId).sort(byOpened)) {
    let sha = rom.romSha1;
    if (typeof sha !== "string") {
      const bytes = await store.bytes(rom.key).catch(() => null);
      sha = bytes ? storedRomSha1(bytes) : "";
      if (bytes) store.patch(rom.key, { romSha1: sha }).catch(() => {});
    }
    if (sha === info.romSha1) return rom;
  }
  return null;
}

/**
 * 게임 파일을 보관함에 넣기. 설명서가 없으면 지금 규칙(keepRom, 같은 이름 = 같은 항목). 설명서가 있으면 같은 게임 id = 같은 항목:
 * 같은 빌드 → 그대로 · 높은 버전/같은 버전 다른 빌드 → 묻지 않고 바꿈(알림 한 줄) · 낮은 버전 → 경고(기본 아니요) — 규격 3.4.
 * 같은 id 가 없으면 옛 .wgba 항목을 찾아 세이브·퀵슬롯을 게임 id 로 옮기고 그 항목을 새 것으로 바꾼다.
 * 돌려주는 값 { meta, note, wgba } · 사용자가 그만두면 null.
 */
// 라이브러리의 버전 글: 설명서 게임은 버전, 옛 .wgba 로 되돌린 게임은 "옛 .wgba"
const versionText = (rom) => (rom?.version ? rom.version : t("web.lib.oldWgba"));

/** 낮은 버전 경고(기본 단추 아니요). true = 이 파일로 바꾸기, false = 라이브러리에 있던 버전을 그대로 엶(결정 102-6). */
async function askOlder(shown, now, version, oldFile = false) {
  const go = await openDialog({
    title: t("web.wgba.olderTitle"),
    body: [oldFile ? t("web.wgba.olderOldText", { name: shown, now }) : t("web.wgba.olderText", { name: shown, now, version })],
    actions: [
      { label: t("web.wgba.olderUse"), value: true, danger: true, id: "older-use" },
      { label: t("web.wgba.olderKeep"), value: false, primary: true, id: "older-keep" },
    ],
  });
  return Boolean(go);
}

const keptStored = (same, shown) => ({ meta: same, note: t("web.wgba.olderKept", { name: shown, version: versionText(same) }), wgba: undefined, stored: true });

/**
 * 결정 102-4: 세이브를 옮긴 뒤 옛 .wgba(목차 없음)를 다시 열면 따로 한 줄 만들지 않고, 롬 구획 SHA-1 이 같은 게임 id 항목의 "낮은 버전"으로 본다.
 * 바꾸기 = 그 항목의 게임 파일만 옛 파일로(보관 id·게임 id 그대로라 세이브·퀵슬롯 이어짐, 버전·빌드·롬팩 그림은 비움).
 * 돌려주는 값: 처리했으면 importGame 과 같은 꼴, 해당 없으면 null.
 */
async function oldFileOfGame(name, bytes, { sha1, file, type }) {
  const romSha1 = storedRomSha1(bytes);
  if (!romSha1) return null;
  let roms = [];
  try {
    roms = await store.list(store.KIND_ROM);
  } catch {
    return null;
  }
  const same = roms.filter((item) => item.gameId && item.romSha1 === romSha1).sort(byOpened)[0] ?? null;
  if (!same) return null;
  const shown = displayName(same);
  if (!same.version) return { meta: same, note: t("web.wgba.same", { name: shown, version: versionText(same) }), wgba: undefined, stored: true };
  if (!(await askOlder(shown, same.version, "", true))) return keptStored(same, shown);
  const meta = { ...same, file, type, sha1, version: "", build: "", cart: {} };
  delete meta.key;
  delete meta.kind;
  delete meta.size;
  delete meta.opened;
  try {
    await store.persist();
    const saved = await store.putGame(meta, bytes);
    cartArt.forgetImages(same.id);
    logLine("INFO", `옛 .wgba 로 되돌림 ${same.gameId} ${same.version} → 옛 파일(${saved.record.key})`);
    return { meta: saved.record, note: t("web.wgba.downgraded", { name: shown, from: same.version, to: t("web.lib.oldWgba") }), wgba: null };
  } catch (error) {
    storeFailed(error);
    return { meta: { ...meta, key: store.romKey(meta.id), kind: store.KIND_ROM, size: bytes.length, transient: true }, note: "", wgba: null };
  }
}

async function importGame(name, bytes, { replace = null, sha1 = "", file = name, keepName = true, named = false } = {}) {
  const type = typeOf(file);
  const wgba = type === "wgba" || type === "wasm" ? await inspectWgba(bytes) : null;
  if (!wgba) {
    if (!replace && (type === "wgba" || type === "wasm")) {
      const old = await oldFileOfGame(name, bytes, { sha1, file, type });
      if (old) return old;
    }
    return { meta: await keepRom(name, bytes, { id: replace?.id ?? "", added: replace?.added ?? 0, sha1, file }), note: "", wgba: null };
  }
  const problem = supportProblem(wgba.manifest);
  if (problem) throw new Error(problemText(problem));
  const info = gameInfo(wgba);
  const shown = pickText(info.title, i18n.lang()) || name;
  let roms = [];
  try {
    roms = await store.list(store.KIND_ROM);
  } catch {}
  const same = roms.filter((item) => item.gameId === info.gameId).sort(byOpened)[0] ?? null;
  let note = "";
  let target = null;
  let moveFrom = "";
  if (same) {
    // 옛 .wgba 로 되돌려 둔 항목(버전 없음)은 어떤 새 파일이든 업데이트
    const action = same.version ? updateAction({ version: same.version, build: same.build }, { version: info.version, build: info.build }) : "update";
    if (action === "older") {
      if (!(await askOlder(shown, same.version, info.version))) return keptStored(same, shown);
      note = t("web.wgba.downgraded", { name: shown, from: same.version, to: info.version });
    } else if (action === "update") {
      note = same.version === info.version ? t("web.wgba.rebuilt", { name: shown, version: info.version }) : t("web.wgba.updated", { name: shown, from: versionText(same), to: info.version });
    } else {
      note = t("web.wgba.same", { name: shown, version: info.version });
    }
    target = same;
  } else {
    target = await oldSameGame(info, roms);
    if (target) moveFrom = target.id;
    else if (replace) target = replace;
  }
  // named = 사람이 정한 이름(이름 바꾸기·패치에서 고른 이름) → 라이브러리에 그 이름, 아니면 설명서 이름
  const meta = { ...info, id: target?.id || store.newId(), name: keepName && target?.name ? target.name : name, named: keepName ? Boolean(target?.named) : named, file, type, sha1, added: target?.added ?? 0 };
  const carts = Object.entries(wgba.images).map(([part, image]) => ({ part, bytes: image.bytes, format: image.format, width: image.width, height: image.height }));
  let saved = null;
  await store.persist();
  try {
    saved = await store.putGame(meta, bytes, { carts, moveFrom });
  } catch (error) {
    if (!moveFrom) {
      storeFailed(error);
      return { meta: { ...meta, key: store.romKey(meta.id), kind: store.KIND_ROM, size: bytes.length, transient: true }, note, wgba };
    }
    // 옮기다 실패: 트랜잭션째 되돌아가 옛 항목·세이브는 그대로 — 새 게임은 따로 넣는다
    logLine("WARN", `옛 세이브를 옮기지 못했습니다(옛 항목은 그대로): ${reason(error)}`);
    toast(t("web.wgba.moveFailed"), "warn");
    moveFrom = "";
    try {
      saved = await store.putGame({ ...meta, id: store.newId(), name, added: 0 }, bytes, { carts });
    } catch (again) {
      storeFailed(again);
      return { meta: { ...meta, key: store.romKey(meta.id), kind: store.KIND_ROM, size: bytes.length, transient: true }, note, wgba };
    }
  }
  if (moveFrom) {
    const { moved } = saved;
    logLine("INFO", `옛 .wgba 세이브를 게임 id 로 옮김 ${moveFrom} → ${info.gameId} (세이브 ${moved.save ? 1 : 0} · 퀵슬롯 ${moved.states})`);
    // 결정 102-7: 옮긴 것에 맞게 "세이브를" / "퀵슬롯을" / "세이브·퀵슬롯을"
    const what = moved.save && moved.states ? "web.wgba.migrated" : moved.save ? "web.wgba.migratedSave" : "web.wgba.migratedStates";
    if (moved.save || moved.states) note = t(what, { name: shown, version: info.version });
  }
  cartArt.forgetImages(saved.record.id);
  if (replace && replace.id !== saved.record.id) {
    await store.remove(replace.key).catch(() => {});
    await store.removeCarts(replace.id).catch(() => {});
    await store.removeStates(saveIdOf(replace)).catch(() => {});
  }
  logLine("INFO", `.wgba ${info.gameId} ${info.version} 빌드 ${info.build.slice(0, 8)} 보관 → ${saved.record.key}${note ? ` (${note})` : ""}`);
  return { meta: saved.record, note, wgba };
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

// input = 설명서의 버튼 목록(resolveInput). 없으면(.gba·설명서 없는 .wgba·.wasm) GBA 10버튼 — 화면·키 지금 그대로.
async function startHosted(host, meta, input = null) {
  const saveId = saveIdOf(meta);
  state.game = { id: meta.id, name: meta.name, type: meta.type, key: store.romKey(meta.id), saveId, gameId: meta.gameId ?? "", version: meta.version ?? "", title: titleOf(meta), author: meta.author ?? "", build: meta.build ?? "" };
  context.game = meta.name;
  state.quick.played = 0;
  holds.delete("user");
  // ② 자체 JS 게임은 격리 틀(#screen 안 iframe)이 화면 — 캔버스는 숨김(web.css)
  if (host.script) document.body.dataset.runtime = "script";
  else delete document.body.dataset.runtime;
  setInput(input);
  syncControls();
  layout();
  applyPlayerPrefs();
  await player.start({ host, saveId, game: saveId });
  applyPlayerPrefs();
  hold("sheet", Boolean(state.sheet));
  syncControls();
  updateWake();
}

// 틀 안 게임에 초점이 있을 때 누른 키(script-host 가 넘김) — 이 페이지에서 누른 것과 같은 길로.
function frameKey(event) {
  const fake = { ...event, target: document.body, preventDefault() {}, stopPropagation() {} };
  if (event.type === "keydown") onKeyDown(fake);
  else onKeyUp(fake);
}

/** 틀에 초점이 있어도 이 페이지가 먼저 쓰는 키: 빨리 감기(누르는 동안)·Tab·Pause·P. Ctrl·Alt 조합은 틀이 따로 넘김. */
const scriptReserved = () => [...new Set([...(keyTable().FAST ?? []), "Tab", "Pause", "KeyP"])];

// ② 자체 JS(runtime script): 격리 틀에서 돈다. 세이브·퀵슬롯은 다른 게임처럼 게임 id 키(saveIdOf).
async function openScript(meta, wgba) {
  const save = await readSave(saveIdOf(meta));
  const input = resolveInput(wgba.manifest);
  const { host } = await bootScript({
    wgba,
    input,
    save,
    container: el.screen,
    before: el.canvas.nextSibling,
    lang: i18n.lang(),
    background: getComputedStyle(el.screen).backgroundColor || "#000",
    text: { frame: t("stage.scriptFrame"), tap: t("stage.scriptTap"), navigated: t("status.scriptNavigated"), noRunner: t("status.scriptNoRunner"), exited: t("status.scriptExited") },
    reserved: scriptReserved(),
    log: (level, line) => {
      if (level === "error" || level === "warn") logLine("WARN", `[게임 ${wgba.manifest.id}] ${line}`);
    },
    onFrame: (frame) => (state.scriptFrame = frame),
    onHostKey: frameKey,
  });
  await startHosted(host, meta, input);
  return meta.name;
}

async function openRom(meta, bytes) {
  const module = await coreModule();
  const save = await readSave(saveIdOf(meta));
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

// wgba: 보관할 때 이미 읽은 목차 결과(없으면 여기서 읽음). 목차가 있으면 code 조각만 컴파일(롬은 엔진 메모리 밖), 롬은 rom 조각에서.
async function openWasm(meta, bytes, wgba) {
  if (!isWasmBytes(bytes)) throw new Error(t("status.notWasm", { name: meta.name }));
  if (wgba === undefined) wgba = await inspectWgba(bytes);
  const problem = wgba ? supportProblem(wgba.manifest) : null;
  if (problem) throw new Error(problemText(problem));
  if (wgba?.manifest.runtime === "script") return openScript(meta, wgba);
  let module;
  try {
    module = await (wgba ? compileCode(wgba.code) : WebAssembly.compile(bytes));
  } catch (error) {
    throw new Error(t("status.wasmUnreadable", { reason: reason(error) }));
  }
  const report = inspectModule(module);
  if (!report.usable) {
    const why = report.unknown.length ? t("status.unknownImports", { list: `${report.unknown.slice(0, 3).join(", ")}${report.unknown.length > 3 ? " …" : ""}` }) : "";
    throw new Error(wgba ? t("wgba.badImports", { why }) : t("web.needsGlue", { why }));
  }
  const embedded = wgba ? (wgba.romPayload ? await readRomPayload(wgba.romPayload) : null) : await readEmbeddedRom(module);
  // 롬 없는 ① 게임(설명서 rom.required: false)
  const romless = Boolean(wgba) && !embedded && wgba.manifest.rom?.required === false;
  const rom = embedded ? { bytes: embedded.rom } : romless ? { bytes: null } : await webRomFor(meta);
  if (!rom) {
    toast(t("status.noRomPicked"), "warn");
    return "";
  }
  const save = await readSave(saveIdOf(meta));
  const { host } = await bootHost({ module, rom: rom.bytes, save, log: hostLog, screen: wgba ? screenOf(wgba.manifest) : null });
  await startHosted(host, meta, wgba ? resolveInput(wgba.manifest) : null);
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
  let kept;
  try {
    kept = await importGame(chosen.name, made.wgba, { replace: chosen.replace, sha1: made.sha1, file: `${fallback}.wgba`, keepName: false, named: chosen.name !== fallback });
  } catch (error) {
    await loader.fail(reason(error), "store");
    state.loader = null;
    throw error;
  }
  if (!kept) {
    loader.close();
    state.loader = null;
    return null;
  }
  if (kept.stored) {
    const stored = await store.bytes(kept.meta.key).catch(() => null);
    if (!stored) {
      loader.close();
      state.loader = null;
      toast(t("web.lib.missing"), "warn");
      return null;
    }
    loader.set("store", 1);
    return { meta: kept.meta, bytes: stored, loader, wgba: undefined, note: kept.note };
  }
  loader.set("store", 1);
  logLine("INFO", `패치로 만듦 ${fileName} + ${file.name} → ${chosen.name} (${made.base.name}, ${made.wgba.length}바이트, SHA-1 ${made.sha1}${made.same ? "" : ", 기준 SHA-1 과 다름"})`);
  return { meta: kept.meta, bytes: made.wgba, loader, wgba: kept.wgba, note: join(t("status.patchMade", { name: chosen.name, base: made.base.name }), kept.note) };
}

async function launch(meta, bytes, { note = "", loader = null, wgba = undefined } = {}) {
  await closeGame({ quiet: true });
  loader?.set("open", 0);
  let text;
  try {
    text = meta.type === "wgba" || meta.type === "wasm" ? await openWasm(meta, bytes, wgba) : await openRom(meta, bytes);
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
  if (!note && meta.gameId) note = t("web.wgba.opened", { name: displayName(meta), version: versionText(meta) });
  if (!meta.transient) {
    savePrefs({ lastGame: store.romKey(meta.id) });
    store.patch(store.romKey(meta.id), { opened: Date.now() }).catch(() => {});
  }
  toast(note);
  // ② 자체 JS 게임은 틀 안 소리 — 잠겨 있으면 틀이 "눌러서 소리 켜기" 덮개를 띄운다
  const audio = player.audio;
  if (!player.host?.script && (!audio || audio.ac.state !== "running"))
    setTimeout(() => {
      if (state.game && !player.host?.script && (!player.audio || player.audio.ac.state !== "running")) toast(t("web.soundHint"));
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
      return launch(made.meta, made.bytes, { note: made.note, loader: made.loader, wgba: made.wgba });
    }
    const kept = await importGame(name, bytes);
    if (!kept) return false;
    if (kept.stored) return launchStored(kept);
    return launch(kept.meta, bytes, { note: kept.note, wgba: kept.wgba });
  });
}

// 낮은 버전 경고에서 "아니요" → 라이브러리에 있던 버전을 그대로 엶(결정 102-6)
async function launchStored(kept, loader = null) {
  const bytes = await store.bytes(kept.meta.key).catch(() => null);
  if (!bytes) {
    loader?.close();
    toast(t("web.lib.missing"), "warn");
    return false;
  }
  return launch(kept.meta, bytes, { note: kept.note, loader });
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
  state.scriptFrame = null;
  delete document.body.dataset.runtime;
  context.game = "";
  holds.delete("user");
  pad.releaseAll();
  setInput(null);
  syncControls();
  updateWake();
  if (!quiet) toast(t("status.closed"));
}

// ── 롬팩 그림 노드(라이브러리·첫 화면 같은 모양) ──

/** 그림 픽셀 → CSS px(정수 배율). */
const cssOf = (model, value) => (value * model.unit) / model.k;

/** rom → { model, images, body } — 그림 바이트는 IndexedDB 에서 한 번 풀어 둔다(cart.js 캐시). */
async function cartLook(rom, body) {
  const model = cartArt.cartModel(rom);
  const images = model.parts.length ? await cartArt.cartImages(rom, model, (part) => store.cartBytes(rom.id, part).catch(() => null)) : {};
  return { model, images, body };
}

function sizeCanvas(canvas, model) {
  canvas.className = "cart__art";
  canvas.style.width = `${cssOf(model, canvas.width)}px`;
  canvas.style.height = `${cssOf(model, canvas.height)}px`;
  return canvas;
}

/** 앞면(몸통 + 라벨). 라벨 그림이 없으면 라벨 자리에 이름(두 줄까지, 잉크 기준 가운데). */
function packNode(rom, look, { running = false } = {}) {
  const { model, images, body } = look;
  const { canvas, textBox, paper } = cartArt.drawFront(model, images, body);
  const node = make("span", "pack");
  node.style.width = `${cssOf(model, canvas.width)}px`;
  node.style.height = `${cssOf(model, canvas.height)}px`;
  node.append(sizeCanvas(canvas, model));
  if (textBox) {
    const label = make("span", "pack__label");
    Object.assign(label.style, { left: `${cssOf(model, textBox[0])}px`, top: `${cssOf(model, textBox[1])}px`, width: `${cssOf(model, textBox[2])}px`, height: `${cssOf(model, textBox[3])}px`, color: cartArt.LABEL_INK, backgroundColor: paper });
    label.append(make("span", "pack__text", displayName(rom)));
    node.append(label);
  }
  if (running) {
    // 칩 바탕은 그대로 두고 글만 잉크 가운데로 옮기게 안에 한 겹
    const chip = make("span", "pack__chip");
    chip.append(make("span", "pack__chipText", t("web.lib.current")));
    node.append(chip);
  }
  return node;
}

/** 옆면(등) — 책장에 꽂힌 모습. 이름은 textArea 에 세로 글. */
function spineArt(rom, look) {
  const { model, images, body } = look;
  const canvas = cartArt.drawSpine(model, images, body);
  const art = make("span", "spine__art");
  art.style.width = `${cssOf(model, canvas.width)}px`;
  art.style.height = `${cssOf(model, canvas.height)}px`;
  art.append(sizeCanvas(canvas, model));
  if (model.textArea) {
    const [x, y, w, h] = model.textArea.map((v) => cssOf(model, v));
    const name = make("span", "spine__name", spineName(rom));
    Object.assign(name.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, lineHeight: `${w}px`, color: cartArt.LABEL_INK });
    art.append(name);
  }
  return art;
}

async function loadRoms() {
  const roms = await store.list(store.KIND_ROM);
  let saves = new Set();
  try {
    saves = new Set((await store.list(store.KIND_SAVE)).map((save) => save.id));
  } catch {}
  return { roms, saves };
}

const RECENT_MAX = { portrait: 3, landscape: 5 };
const PACK_W = cartArt.FRONT[0] * cartArt.UNIT;

/** 첫 화면 최근 줄: 들어가는 만큼(세로 3개·가로 5개까지)만 보인다. layout() 이 화면 크기를 바꿀 때마다. */
// 롬팩 사이 간격은 10px 이 기본이고, 하나 더 들어갈 수 있으면 4px 까지 좁힌다(롬팩은 줄이지 않음).
const RECENT_GAP = { max: 10, min: 4 };

function fitRecent() {
  const items = [...el.startList.children];
  if (!items.length || el.startList.hidden) return;
  const width = el.startList.clientWidth;
  if (!width) return; // 게임 중(첫 화면 숨김) — 첫 화면으로 돌아올 때 syncControls 가 다시 부른다
  const fit = Math.max(1, Math.floor((width + RECENT_GAP.min) / (PACK_W + RECENT_GAP.min)));
  const want = Math.min(fit, items.length, RECENT_MAX[document.body.dataset.layout] ?? 3);
  const gap = want > 1 ? clamp(Math.floor((width - want * PACK_W) / (want - 1)), RECENT_GAP.min, RECENT_GAP.max) : RECENT_GAP.max;
  const gapText = `${gap}px`;
  if (el.startList.style.columnGap !== gapText) el.startList.style.columnGap = gapText;
  items.forEach((item, index) => {
    const hide = index >= want;
    if (item.hidden !== hide) item.hidden = hide;
  });
}

async function refreshStart() {
  let roms = [];
  let saves = new Set();
  try {
    ({ roms, saves } = await loadRoms());
    roms.sort(byOpened);
  } catch {}
  const token = (state.startToken = (state.startToken ?? 0) + 1);
  const body = cartArt.themeBody();
  const recent = roms.slice(0, RECENT_MAX.landscape);
  const looks = await Promise.all(recent.map((rom) => cartLook(rom, body)));
  if (token !== state.startToken) return;
  el.startHint.textContent = roms.length ? t("web.start.recent") : t(coarse.matches ? "web.start.pick" : "web.start.pickDrop");
  el.startList.replaceChildren(
    ...recent.map((rom, index) => {
      const node = make("button", "recent__item");
      node.type = "button";
      node.dataset.key = rom.key;
      node.setAttribute("aria-label", displayName(rom));
      node.append(packNode(rom, looks[index]), make("span", "recent__name", displayName(rom)), make("span", "recent__meta", join(kindText(rom), saves.has(saveIdOf(rom)) ? t("web.lib.hasSave") : "")));
      node.addEventListener("click", () => openStored(rom.key));
      return node;
    }),
  );
  el.startList.hidden = roms.length === 0;
  el.startAll.hidden = roms.length === 0;
  el.startAll.querySelector(".recent__allLabel").textContent = t("web.start.all", { count: roms.length });
  document.getElementById("start").classList.toggle("has-list", roms.length > 0);
  if (roms.length) el.startList.setAttribute("aria-label", t("web.start.recent"));
  fitRecent();
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
  if (name !== "saves") state.lib.savesFor = null;
  el.sheet.dataset.sheet = name;
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
  state.lib.savesFor = null;
  hideLater(el.sheet, () => {
    if (state.sheet) return;
    el.sheetBody.replaceChildren();
    state.lib.refs = null;
    revokeQuickUrls();
  });
  hold("sheet", false);
  if (state.sheetHistory) {
    state.sheetHistory = false;
    if (!fromHistory) history.back();
  }
}

function renderSheet() {
  const name = state.sheet;
  if (!name) return;
  const render = { library: renderLibrary, saves: renderSaves, quick: renderQuick, settings: renderSettings, help: renderHelp, info: renderInfo }[name];
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

// ── 라이브러리(책장) — 사용자 결정 100: 롬팩을 옆면(등)으로 꽂아 진열, 고르면 꺼내 앞면(몸통 + 라벨)과 동작 줄 ──
// 꺼내기·넣기 움직임은 transform·opacity 만(Web Animations, 햄버거·시트와 같은 --pop-ms·--pop-ease), 닫을 때는 움직임 뒤 숨김.

const popEase = () => getComputedStyle(document.documentElement).getPropertyValue("--pop-ease").trim() || "ease-out";
const LIFT = "translate3d(0, -16px, 0)";
const DROP = "translate3d(0, 16px, 0)";

/** transform·opacity 움직임. 움직임 줄이기면 바로 끝. 돌려주는 값 = 끝나는 Promise. */
function motion(node, frames, { fill = "none" } = {}) {
  const ms = popMs();
  if (!node || !ms || !node.animate) return Promise.resolve();
  const run = node.animate(frames, { duration: ms, easing: popEase(), fill });
  return run.finished.then(
    () => run,
    () => run,
  );
}

const libSort = () => (state.prefs.libSort === "name" ? "name" : "recent");

function sortRoms(roms) {
  if (libSort() === "name") {
    const collator = new Intl.Collator(i18n.locale(), { numeric: true, sensitivity: "base" });
    return roms.sort((a, b) => collator.compare(displayName(a), displayName(b)) || byOpened(a, b));
  }
  return roms.sort(byOpened);
}

async function renderLibrary() {
  el.sheetTitle.textContent = t("web.library");
  const token = ++state.lib.token;
  let roms = [];
  let saves = new Set();
  let failed = false;
  try {
    ({ roms, saves } = await loadRoms());
  } catch {
    failed = true;
  }
  sortRoms(roms);
  const body = cartArt.themeBody();
  const looks = await Promise.all(roms.map((rom) => cartLook(rom, body)));
  const total = roms.reduce((sum, rom) => sum + (rom.size ?? 0), 0);
  const line = await storageLine();
  if (state.sheet !== "library" || token !== state.lib.token) return;
  const lib = state.lib;
  if (!roms.some((rom) => rom.key === lib.sel)) lib.sel = (state.game && roms.find((rom) => rom.id === state.game.id)?.key) || roms[0]?.key || "";
  const byKey = new Map(roms.map((rom, index) => [rom.key, { rom, look: looks[index] }]));
  // 책장 한 칸 높이 = 위 표시 자리 14 + 가장 큰 옆면 + 선반 14(옆면 그림이 k 3·4 로 크면 그만큼)
  const spineH = Math.max(cartArt.SPINE[1] * cartArt.UNIT, ...looks.map((look) => cartArt.SPINE[1] * look.model.unit));

  const card = make("section", "lib__card");
  card.setAttribute("aria-live", "polite");
  const head = make("div", "lib__shelfHead");
  const sortBtn = button({ label: t(libSort() === "name" ? "web.lib.sortName" : "web.lib.sortRecent"), icon: "sort-descending", title: t("web.lib.sort"), kind: "small", action: "sort", onClick: () => {
    savePrefs({ libSort: libSort() === "name" ? "recent" : "name" });
    renderSheet();
  } });
  head.append(make("span", "lib__count", t("web.lib.count", { count: roms.length })), sortBtn);
  const shelf = make("div", "lib__case");
  shelf.style.setProperty("--slot-h", `${spineH + 28}px`);
  shelf.setAttribute("role", "group");
  shelf.setAttribute("aria-label", t("web.library"));
  const spines = new Map();
  for (const rom of roms) {
    const slot = make("button", "spine");
    slot.type = "button";
    slot.dataset.key = rom.key;
    slot.setAttribute("aria-label", displayName(rom));
    slot.title = displayName(rom);
    // 꺼내면 옆면 그림 자리에 점선 빈칸(.spine__gap), 실행 중이면 위에 작은 네모
    const art = spineArt(rom, byKey.get(rom.key).look);
    art.append(make("span", "spine__gap"));
    if (state.game?.id === rom.id) art.append(make("span", "spine__run"));
    slot.append(art);
    slot.addEventListener("click", () => pickSpine(rom.key));
    spines.set(rom.key, slot);
    shelf.append(slot);
  }
  const add = make("button", "spine spine--add");
  add.type = "button";
  add.dataset.action = "add-file";
  add.title = t("web.openShort");
  add.setAttribute("aria-label", t("web.openShort"));
  add.append(iconNode("plus"));
  add.addEventListener("click", () =>
    pickFile({ multiple: true }).then((files) => {
      if (!files.length) return;
      closeSheet();
      openFiles(files);
    }),
  );
  shelf.append(add);
  const shelfBox = make("div", "lib__shelf");
  // 책장 + 안내 줄을 한 굴림 칸에(낮은 화면에서도 안내 줄이 잘리지 않게). 게임이 적으면 책장이 빈 선반으로 칸을 채움.
  const scroller = make("div", "lib__scroll");
  const notes = [make("p", "note", join(t("web.lib.usage", { count: roms.length, size: fmtSize(total) }), line)), make("p", "note", t("web.lib.noExport"))];
  if (!roms.length) scroller.append(shelf, make("p", "lib__empty", failed ? t("web.noStore") : t("web.lib.empty")), ...notes);
  else scroller.append(shelf, ...notes);
  shelfBox.append(head, scroller);
  lib.refs = { card, spines, byKey, saves };
  for (const [key, slot] of spines) slot.classList.toggle("is-out", key === lib.sel);
  for (const [key, slot] of spines) slot.setAttribute("aria-pressed", String(key === lib.sel));
  fillCard(lib.sel);
  const children = roms.length ? [card, shelfBox] : [shelfBox];
  el.sheetBody.replaceChildren(...children);
  // 꺼낸 롬팩 자리가 책장 굴림 칸 밖이면 그 칸만 굴려 보이게(문서 전체는 굴리지 않음)
  const target = spines.get(lib.sel);
  if (target && target.offsetTop + target.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = Math.max(0, target.offsetTop - (scroller.clientHeight - target.offsetHeight) / 2);
}

/** 꺼낸 롬팩 칸: 앞면 + 이름·버전·크기 + 동작 줄. key 가 없으면 "롬팩을 누르면 꺼냅니다" 안내. */
function fillCard(key) {
  const refs = state.lib.refs;
  if (!refs) return null;
  const { card, byKey, saves } = refs;
  const entry = byKey.get(key);
  card.dataset.key = key || "";
  if (!entry) {
    card.dataset.state = "empty";
    card.replaceChildren(make("p", "lib__hint", t("web.lib.pick")));
    return null;
  }
  const { rom, look } = entry;
  const running = state.game?.id === rom.id;
  card.dataset.state = "open";
  const pack = make("button", "lib__pack");
  pack.type = "button";
  pack.dataset.action = running ? "resume" : "open";
  pack.setAttribute("aria-label", t(running ? "web.lib.resume" : "web.lib.open"));
  pack.append(packNode(rom, look, { running }));
  pack.addEventListener("click", () => openFromLibrary(rom));
  const side = make("div", "lib__text");
  const nameRow = make("div", "lib__line");
  nameRow.append(make("span", "lib__name", displayName(rom)), button({ kind: "tool", icon: "info-circle", title: t("web.lib.info"), action: "info", onClick: () => showGameInfo(rom) }));
  const meta = make("span", "lib__meta", join(kindText(rom), rom.gameId ? ".wgba" : "", fmtSize(rom.size), saves.has(saveIdOf(rom)) ? t("web.lib.hasSave") : ""));
  const btns = make("div", "lib__btns");
  const act = (label, icon, action, onClick, kind = "") => button({ label, icon, action, kind, onClick });
  const list = running
    ? [
        act(t("web.lib.resume"), "player-play", "resume", () => openFromLibrary(rom), "primary"),
        act(t("web.saves"), "device-floppy", "saves", () => openGameSaves(rom)),
        act(t("menu.reset"), "refresh", "reset", () => (closeSheet(), resetGame())),
        act(t("web.lib.close"), "x", "close-game", () => closeGame().then(() => renderSheet())),
        act(t("web.lib.rename"), "pencil", "rename", () => renameRom(rom)),
        act(t("web.lib.delete"), "trash", "delete", () => deleteRom(rom), "danger"),
      ]
    : [
        act(t("web.lib.open"), "player-play", "open", () => openFromLibrary(rom), "primary"),
        act(t("web.saves"), "device-floppy", "saves", () => openGameSaves(rom)),
        act(t("web.lib.rename"), "pencil", "rename", () => renameRom(rom)),
        act(t("web.lib.delete"), "trash", "delete", () => deleteRom(rom), "danger"),
      ];
  btns.style.setProperty("--btn-cols", String(running ? 3 : 4));
  btns.append(...list);
  side.append(nameRow, meta);
  // 격자: 좁으면 [롬팩 | 이름·버전] 아래 버튼 줄, 넓으면 롬팩 옆에 이름·버튼, 가로 화면 오른쪽 칸은 위아래로(web.css)
  const grid = make("div", "lib__grid");
  if (running) grid.dataset.running = "1";
  grid.append(pack, side, btns);
  card.replaceChildren(grid);
  return pack;
}

/** 옆면을 누름: 다른 롬팩이면 꺼내고(이전 것은 제자리에 넣음), 꺼낸 자리(빈칸)를 누르면 넣음. */
function pickSpine(key) {
  const lib = state.lib;
  const refs = lib.refs;
  if (!refs) return;
  const prev = lib.sel;
  const next = prev === key ? "" : key;
  lib.sel = next;
  const back = refs.spines.get(prev);
  const out = refs.spines.get(next);
  if (back) {
    back.classList.remove("is-out");
    back.setAttribute("aria-pressed", "false");
    motion(back.querySelector(".spine__art"), [
      { transform: LIFT, opacity: 0 },
      { transform: "none", opacity: 1 },
    ]);
  }
  if (out) {
    out.setAttribute("aria-pressed", "true");
    const art = out.querySelector(".spine__art");
    // 끝 모습을 붙잡아 두었다가(fill forwards) 빈칸으로 바꾼 뒤 풀어 한 프레임도 다시 보이지 않게
    motion(art, [
      { transform: "none", opacity: 1 },
      { transform: LIFT, opacity: 0 },
    ], { fill: "forwards" }).then((run) => {
      if (lib.sel === next && lib.refs === refs) out.classList.add("is-out");
      run?.cancel();
    });
    if (!popMs()) out.classList.add("is-out");
    const pack = fillCard(next);
    motion(pack, [
      { transform: DROP, opacity: 0 },
      { transform: "none", opacity: 1 },
    ]);
    return;
  }
  // 넣기만(꺼낸 롬팩 없음): 칸 내용이 움직임 뒤에 안내로 바뀜
  const card = refs.card;
  const shown = [...card.children];
  Promise.all(shown.map((node) => motion(node, [{ transform: "none", opacity: 1 }, { transform: DROP, opacity: 0 }], { fill: "forwards" }))).then(() => {
    if (lib.sel === "" && lib.refs === refs) {
      fillCard("");
      motion(card.firstElementChild, [{ opacity: 0 }, { opacity: 1 }]);
    }
  });
}

function openFromLibrary(rom) {
  closeSheet();
  if (state.game?.id === rom.id) {
    hold("user", false);
    return;
  }
  openStored(rom.key);
}

function openGameSaves(rom) {
  state.lib.savesFor = { id: saveIdOf(rom), name: rom.name, title: displayName(rom) };
  openSheet("saves");
}

function showGameInfo(rom) {
  const lines = [
    rom.gameId ? t("web.lib.infoVersion", { version: versionText(rom) }) : "",
    rom.gameId && rom.author ? t("web.lib.infoAuthor", { author: rom.author }) : "",
    rom.gameId ? t("web.lib.infoId", { id: rom.gameId }) : "",
    t("web.lib.infoFile", { file: rom.name, type: `.${rom.type}`, size: fmtSize(rom.size) }),
    rom.build ? t("web.lib.infoBuild", { build: rom.build.slice(0, 8) }) : "",
    t("web.lib.added", { date: fmtTime(rom.added) }),
    rom.opened ? t("web.start.lastPlayed", { time: fmtTime(rom.opened) }) : "",
  ];
  openDialog({ title: displayName(rom), body: lines, actions: [{ label: "OK", value: true, primary: true, id: "info-ok" }] });
}

async function renameRom(rom) {
  const chosen = await askName({ title: t("web.rename"), text: t("web.rename.text", { name: rom.name }), value: rom.name, fallback: rom.name, selfId: rom.id });
  if (!chosen || chosen.name === rom.name) return;
  try {
    if (chosen.replace) {
      if (state.game?.id === chosen.replace.id) await closeGame({ quiet: true });
      await store.remove(chosen.replace.key);
      await store.removeCarts(chosen.replace.id).catch(() => {});
      await store.removeStates(saveIdOf(chosen.replace)).catch(() => {});
    }
    await store.patch(rom.key, { name: chosen.name, named: true });
    await store.patch(store.saveKey(saveIdOf(rom)), { game: chosen.name });
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
    await store.removeCarts(rom.id);
    await store.removeStates(saveIdOf(rom));
    cartArt.forgetImages(rom.id);
    toast(t("web.deleted", { name: displayName(rom) }));
  } catch (error) {
    toast(reason(error), "error");
  }
  if (state.prefs.lastGame === rom.key) savePrefs({ lastGame: "" });
  if (state.lib.sel === rom.key) state.lib.sel = "";
  refreshStart();
  renderSheet();
}

async function leaveRow(key) {
  const row = [...el.sheetBody.querySelectorAll(".item")].find((node) => node.dataset.key === key);
  if (row) {
    row.classList.add("is-leaving");
    await wait(160);
    return;
  }
  // 라이브러리: 꺼낸 롬팩 칸 내용이 아래로 빠지며 사라짐(transform·opacity)
  const card = state.lib.refs?.card;
  if (card?.isConnected && card.dataset.key === key) await Promise.all([...card.children].map((node) => motion(node, [{ transform: "none", opacity: 1 }, { transform: DROP, opacity: 0 }], { fill: "forwards" })));
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
  // 라이브러리의 "세이브"로 열면 그 게임만(실행 중이 아니어도 내보내기·불러오기)
  const only = state.lib.savesFor;
  if (only) {
    saves = saves.filter((save) => save.id === only.id);
    const back = make("div", "start__actions start__actions--left");
    back.append(
      button({ label: t("web.library"), icon: "arrow-back-up", kind: "small", action: "back-library", onClick: () => openSheet("library") }),
      button({ label: t("web.save.all"), kind: "small", action: "all-saves", onClick: () => ((state.lib.savesFor = null), renderSheet()) }),
    );
    const row = make("div", "start__actions");
    row.append(
      button({ label: t("web.save.export"), icon: "download", action: "export-current", onClick: () => exportSave(only.id, only.name) }),
      button({ label: t("web.save.import"), icon: "upload", action: "import-current", onClick: () => importSave(only.id, only.name) }),
    );
    children.push(back, group(t("web.save.ofGame", { name: only.title }), row));
  } else if (state.game) {
    const { saveId: id, name } = state.game;
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

// ── 퀵슬롯(빠른 저장·불러오기) ──
// 게임 id 마다 칸 1~9(IndexedDB 키 state:<id>:<칸>). 9번은 자동 저장 전용 — 사람은 불러오기만.
// 상태 저장 내보내기(Web_State*)가 있는 코어(.gba = mGBA)만 된다. 상태에는 게임 안 세이브(.sav) 내용이 들어가지 않는다.

function canQuick() {
  return Boolean(state.game) && player.running && player.canState;
}

const slotLabel = (slot) => (slot === AUTO_SLOT ? t("web.quick.autoLabel") : t("web.quick.slotLabel", { n: slot }));
const pad2 = (n) => String(n).padStart(2, "0");

// 칸 글자는 날짜와 시각 사이를 줄바꿈으로 둔다: 넓은 칸(nowrap)은 한 줄, 좁은 칸(pre-line, web.css 컨테이너 조건)은 늘 두 줄
function fmtSlotTime(ms, sep = " ") {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}${sep}${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function autoMinutes() {
  const value = Number(state.prefs.autoSave);
  return AUTO_SAVE_MINUTES.includes(value) ? value : AUTO_SAVE_DEFAULT;
}

// 저장 순간 화면을 PNG 바이트로. 그림은 지금 바로 복사하고 인코딩만 나중에 한다.
function quickThumb() {
  const image = player.image;
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? blob.arrayBuffer() : null), "image/png"));
}

async function quickSave(slot, { auto = false } = {}) {
  if (!canQuick() || state.quick.busy || (slot === AUTO_SLOT) !== auto) return false;
  state.quick.busy = true;
  const started = performance.now();
  try {
    const pending = player.saveState(slot);
    state.quick.syncMs = performance.now() - started;
    const done = await pending;
    state.quick.lastMs = performance.now() - started;
    if (!done) toast(t("web.quick.saveFailedPlain"), auto ? "warn" : "error");
    return Boolean(done);
  } catch (error) {
    toast(t("web.quick.saveFailed", { reason: reason(error) }), auto ? "warn" : "error");
    return false;
  } finally {
    state.quick.busy = false;
  }
}

async function quickLoad(slot) {
  if (!canQuick()) return false;
  try {
    const result = await player.loadState(slot);
    if (result) {
      // 포트 .wgba: 다른 버전에서 저장한 칸은 그때의 게임 저장으로 필드에서 이어 한다(Web_StateLoadedKind 2)
      toast(t(player.host?.stateLoadedKind === 2 ? "web.quick.loadedSave" : "web.quick.loaded", { slot: slotLabel(slot) }));
      return true;
    }
    toast(t(result === null ? "web.quick.missing" : "web.quick.loadFailed"), "warn");
  } catch (error) {
    toast(t("web.quick.loadFailedWhy", { reason: reason(error) }), "error");
  }
  return false;
}

function openQuick() {
  if (state.menuOpen) setMenu(false);
  if (!state.game) {
    toast(t("web.quick.noGame"), "warn");
    return;
  }
  if (!canQuick()) {
    toast(t("web.quick.noState"), "warn");
    return;
  }
  openSheet("quick");
}

function revokeQuickUrls() {
  for (const url of state.quick.urls) URL.revokeObjectURL(url);
  state.quick.urls = [];
}

function slotUsable(slot) {
  return state.quick.tab === "save" ? slot !== AUTO_SLOT : state.quick.info.has(slot);
}

function applyQuickTab() {
  for (const node of el.sheetBody.querySelectorAll(".seg__btn")) node.setAttribute("aria-selected", String(node.dataset.tab === state.quick.tab));
  for (const node of el.sheetBody.querySelectorAll(".slot")) node.disabled = !slotUsable(Number(node.dataset.slot));
}

function quickTabs() {
  const tabs = make("div", "seg");
  tabs.setAttribute("role", "tablist");
  for (const [id, icon] of [
    ["save", "device-floppy"],
    ["load", "history"],
  ]) {
    const node = make("button", "seg__btn");
    node.type = "button";
    node.dataset.tab = id;
    node.dataset.action = `tab-${id}`;
    node.setAttribute("role", "tab");
    node.append(iconNode(icon), make("span", "seg__label", t(`web.quick.tab.${id}`)));
    node.addEventListener("click", () => {
      state.quick.tab = id;
      applyQuickTab();
    });
    tabs.append(node);
  }
  return tabs;
}

function slotCard(slot, info, latest) {
  const card = make("button", `slot${info && info.saved === latest ? " is-latest" : ""}`);
  card.type = "button";
  card.dataset.slot = String(slot);
  card.setAttribute("aria-label", info ? `${slotLabel(slot)} · ${fmtSlotTime(info.saved)}` : `${slotLabel(slot)} · ${t("web.quick.empty")}`);
  const shot = make("span", `slot__shot${info?.thumb ? "" : " is-empty"}`);
  if (info?.thumb) {
    const url = URL.createObjectURL(new Blob([info.thumb], { type: "image/png" }));
    state.quick.urls.push(url);
    const img = make("img", "slot__img");
    img.alt = "";
    img.draggable = false;
    img.src = url;
    shot.append(img);
  } else {
    shot.append(make("span", "slot__empty", info ? "" : t("web.quick.empty")));
  }
  const num = make("span", `slot__num${slot === AUTO_SLOT ? " is-auto" : ""}`);
  num.append(make("span", "slot__tag", slot === AUTO_SLOT ? t("web.quick.auto") : String(slot)));
  shot.append(num);
  card.append(shot, make("span", info ? "slot__time" : "slot__time is-empty", info ? fmtSlotTime(info.saved, "\n") : "—"));
  card.addEventListener("click", () => pickSlot(slot));
  return card;
}

async function renderQuick() {
  const game = state.game;
  el.sheetTitle.textContent = game ? join(t("web.quick"), game.name) : t("web.quick");
  if (!game || !player.canState) {
    el.sheetBody.replaceChildren(group("", make("p", "empty", t(game ? "web.quick.noState" : "web.quick.noGame"))));
    return;
  }
  let list = [];
  let failed = false;
  try {
    list = await store.states(game.saveId);
  } catch {
    failed = true;
  }
  if (state.sheet !== "quick" || state.game !== game) return;
  revokeQuickUrls();
  state.quick.info = new Map(list.filter((info) => QUICK_SLOTS.includes(info.slot)).map((info) => [info.slot, info]));
  const latest = Math.max(0, ...[...state.quick.info.values()].map((info) => info.saved ?? 0));
  const grid = make("ul", "slots");
  for (const slot of QUICK_SLOTS) {
    const li = make("li");
    li.append(slotCard(slot, state.quick.info.get(slot), latest));
    grid.append(li);
  }
  const minutes = autoMinutes();
  el.sheetBody.replaceChildren(
    group("", quickTabs(), grid),
    group(
      "",
      failed ? make("p", "note note--warn", t("web.noStore")) : null,
      make("p", "note", minutes ? t("web.quick.noteAuto", { n: minutes }) : t("web.quick.noteAutoOff")),
      make("p", "note", t("web.quick.noteSav")),
    ),
  );
  applyQuickTab();
}

async function pickSlot(slot) {
  if (!slotUsable(slot) || state.quick.busy) return;
  const info = state.quick.info.get(slot);
  const label = slotLabel(slot);
  if (state.quick.tab === "save") {
    if (info && !(await confirmDialog(t("web.quick.overTitle", { slot: label }), t("web.quick.overText", { time: fmtSlotTime(info.saved) }), t("web.quick.overOk")))) return;
    if (state.sheet !== "quick" || !(await quickSave(slot))) return;
    closeSheet();
    toast(t("web.quick.saved", { slot: label }));
    return;
  }
  if (!(await confirmDialog(t("web.quick.loadTitle", { slot: label }), t("web.quick.loadText", { time: fmtSlotTime(info.saved) }), t("web.quick.loadOk")))) return;
  if (state.sheet !== "quick" || !(await quickLoad(slot))) return;
  closeSheet();
}

// 자동 저장: 게임이 실제로 돈 시간(일시정지·화면 숨김·창 열림 동안은 안 셈)이 고른 분을 넘으면 9번 칸에 덮어쓴다.
function autoTick() {
  const now = performance.now();
  const dt = state.quick.lastTick ? Math.min(now - state.quick.lastTick, 2000) : 0;
  state.quick.lastTick = now;
  const minutes = autoMinutes();
  if (!minutes || !canQuick() || player.paused || holds.size || state.opening || document.visibilityState !== "visible") return;
  state.quick.played += dt;
  if (state.quick.played < minutes * 60000 || state.quick.busy) return;
  state.quick.played = 0;
  autoSave();
}

async function autoSave() {
  if (!(await quickSave(AUTO_SLOT, { auto: true }))) return;
  state.quick.autoCount++;
  toast(t("web.quick.autoSaved"), "info", AUTO_TOAST_MS);
  if (state.sheet === "quick") renderQuick();
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
  try {
    if (color) localStorage.setItem("webgba.bootBg", color);
  } catch {}
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  skin.refreshColors();
  if (document.documentElement.dataset.ready) {
    layout();
    // 기본 롬팩 몸통 색은 테마에서 만든다
    refreshStart();
  }
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
      selectField(
        t("web.autoSave"),
        t("web.autoSave.note"),
        AUTO_SAVE_MINUTES.map((value) => ({ value, label: value ? t("web.autoSave.min", { n: value }) : t("web.autoSave.off") })),
        autoMinutes(),
        (value) => savePrefs({ autoSave: Number(value) }),
      ),
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
  if (state.input.gba) {
    for (const name of KEY_ORDER) {
      list.append(make("dt", "", t(`key.${name}`)), make("dd", "", (DEFAULT_KEYS[name] ?? []).map(keyName).join(" · ")));
    }
  } else {
    // 설명서가 버튼을 정한 게임: 그 게임의 버튼만(설명서 label, 없으면 GBA 이름·id) + 빨리 감기
    const keys = layoutKeys(state.input, DEFAULT_KEYS);
    for (const b of state.input.buttons) list.append(make("dt", "", buttonLabel(b)), make("dd", "", (keys[b.id] ?? []).map(keyName).join(" · ") || "—"));
    list.append(make("dt", "", t("key.FAST")), make("dd", "", keys.FAST.map(keyName).join(" · ")));
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
  // 설명서가 있는 .wgba 를 열고 있으면 그 게임: 이름·버전·id·만든 이·빌드 앞 8자리
  const game = state.game?.gameId ? state.game : null;
  // 소리 확인 한 줄(iOS 무음 원인 찾기용): 상태 · 표본률 · 오디오 세션. 시트가 열려 있는 동안 0.5초마다 고침.
  // 글이 같으면 다시 쓰지 않는다(같은 값 쓰기도 MutationObserver 를 깨워 문서 전체 centerInk 가 돎).
  // 게임 줄·버전 줄·소리 줄은 상태 줄이라 잉크 세로 가운데(`.info__line`, INK_SINGLE) — 설명 글(.note)은 그대로.
  const audioLine = make("p", "note info__line", "");
  const paintAudio = () => {
    const audio = player.audio;
    const text = audio
      ? t("web.info.audio", { state: audio.stuck ? "stuck" : audio.ac.state, rate: audio.ac.sampleRate, session: audioSessionType() || "-" })
      : t("web.info.audioOff");
    if (audioLine.textContent !== text) audioLine.textContent = text;
    if (audioLine.isConnected) setTimeout(paintAudio, 500);
  };
  paintAudio();
  el.sheetBody.replaceChildren(
    ...(game ? [group(t("info.game", { name: `${game.title} ${game.version}` }), make("p", "note info__line", t("info.gameMeta", { id: game.gameId, author: game.author || "-", build: game.build.slice(0, 8) })))] : []),
    group("", make("p", "info__line", `webGBA ${BUILD.version} · ${BUILD.hash}`), audioLine, make("p", "note", t("web.info.about")), make("p", "note", t("web.privacy")), make("p", "note", LICENSE_LINE)),
    group(t("info.openSource"), make("p", "note", t("info.mgba")), make("p", "note", t("info.mgbaSource")), make("p", "note", t("info.others")), links),
  );
  setTimeout(paintAudio, 500);
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
  if (state.menuOpen && event.key === "Escape") {
    event.preventDefault();
    setMenu(false);
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
  if (player.keyDown(code, event)) event.preventDefault();
}

function onKeyUp(event) {
  if (player.keyUp(codeOf(event), event)) event.preventDefault();
}

function unlockAudio() {
  if (!player.audio || player.audio.stuck || player.audio.ac.state !== "running") player.ensureAudio();
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    if (player.active) player.flushSave();
    pad.releaseAll();
    player.releaseAll();
    if (state.prefs.pauseWhenHidden) hold("hidden", true);
  } else {
    hold("hidden", false);
    player.resumeAudio();
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
  el.btnSaves.addEventListener("click", () => ((state.lib.savesFor = null), openSheet("saves")));
  el.startAll.addEventListener("click", () => openSheet("library"));
  el.btnQuick.addEventListener("click", openQuick);
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
    const press = (on) => () => skin.tool(node, { pressed: on && !toolOff(node) });
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
  el.toast.addEventListener("click", () => hideLater(el.toast));
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
  window.addEventListener("pageshow", (event) => event.persisted && player.resumeAudio());
  // ② 게임 틀을 눌러 초점이 틀로 가도 blur 가 온다 — 그때는 키를 놓지 않는다(틀이 키를 넘겨줌)
  window.addEventListener("blur", () => {
    if (!(state.scriptFrame && document.activeElement === state.scriptFrame)) player.releaseAll();
  });
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
  context.stateExtra = (slot) => ({ auto: slot === AUTO_SLOT, thumb: quickThumb() });
  setInterval(autoTick, 1000);
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

const BOOT_LIMIT_MS = 5000;

function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const loads = ["15px Galmuri14", "12px Galmuri11", "700 12px Galmuri11", "30px Galmuri14"].map((font) => document.fonts.load(font).catch(() => []));
  return Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, BOOT_LIMIT_MS))]);
}

function revealApp() {
  if (!document.body.hasAttribute("data-booting")) return;
  document.body.removeAttribute("data-booting");
  const screen = document.getElementById("boot");
  if (!screen) return;
  requestAnimationFrame(() => {
    screen.classList.add("is-done");
    setTimeout(() => screen.remove(), reducedMotion() ? 0 : 220);
  });
}

async function settle() {
  state.glyphCache?.clear();
  state.baselineCache?.clear();
  centerInk(document);
  centerIcons(document);
  await Promise.race([Promise.allSettled([...iconSvg.values()]), new Promise((resolve) => setTimeout(resolve, 1500))]);
  centerIcons(document);
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

setTimeout(revealApp, BOOT_LIMIT_MS);

async function boot() {
  const fonts = fontsReady();
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
    await fonts;
    await settle();
    revealApp();
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
  await fonts;
  layout();
  await settle();
  revealApp();
  document.documentElement.dataset.ready = "1";
  registerWorker();
  if (!state.storeBroken) store.persist();
}

window.webgba = { player, pad, skin, store, state, layout, openFiles, openLoader, toast, refreshStart, textInk, setInput: setInputFrom, openSheet, renderSheet, applyTheme, version: BUILD };

boot().catch((error) => {
  console.error(error);
  toast(t("status.bootFailed", { reason: reason(error) }), "error");
});
