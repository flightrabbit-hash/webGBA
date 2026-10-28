import { core, win, onCloseRequested, onMaximized, onOpenFile, onOsDrag, onOsFileDrop } from "../bridge.js";
import { bootHost, inspectModule, readEmbeddedRom, SCREEN_H, SCREEN_W } from "../core/web-host.js";
import { buildGame, readPatch, sha1Hex, WgbpError } from "../core/wgbp.js";
import { codeOf, DEFAULT_KEYS, DPAD_DEFAULT, DPAD_MODES, Player } from "../app/player.js";
import * as settings from "../app/settings.js";
import * as theme from "../shell/theme.js";
import * as i18n from "../shell/i18n.js";

const { t } = i18n;

const $ = (id) => document.getElementById(id);

const el = {
  title: $("title"),
  menu: $("menu"),
  rail: $("rail"),
  railToggle: $("rail-toggle"),
  railToggleIcon: $("rail-toggle-icon"),
  panel: $("sidepanel"),
  panelTitle: $("sidepanel-title"),
  panelCount: $("sidepanel-count"),
  panelList: $("sidepanel-list"),
  stage: $("stage"),
  screen: $("screen"),
  frame: $("webframe"),
  start: $("start"),
  startFavorites: $("start-favorites"),
  startFavoritesHead: $("start-favorites-head"),
  startRecent: $("start-recent"),
  startRecentHead: $("start-recent-head"),
  paused: $("paused"),
  status: $("status"),
  statusRight: $("status-right"),
  osdrag: $("osdrag"),
  osdragFrame: $("osdrag-frame"),
  layer: $("layer"),
  dialog: $("dialog"),
  dialogTitle: $("dialog-title"),
  dialogBody: $("dialog-body"),
  dialogActions: $("dialog-actions"),
  btnFiles: $("btn-files"),
  btnFavorites: $("btn-favorites"),
  btnStar: $("btn-star"),
  btnStarIcon: $("btn-star-icon"),
  btnPause: $("btn-pause"),
  btnPauseIcon: $("btn-pause-icon"),
  btnReset: $("btn-reset"),
  btnFast: $("btn-fast"),
  btnStateSave: $("btn-state-save"),
  btnStateLoad: $("btn-state-load"),
  btnMute: $("btn-mute"),
  btnMuteIcon: $("btn-mute-icon"),
  btnSettings: $("btn-settings"),
  winMax: $("win-max"),
  winMaxIcon: $("win-max-icon"),
};

const OPEN_EXT = new Set(["gba", "agb", "zip", "wgba", "wasm", "wgbp"]);
const LIST_EXT = new Set(["gba", "wgba", "wasm", "wgbp"]);
const WASM_EXT = new Set(["wgba", "wasm"]);
const PATCH_EXT = "wgbp";
const PATCH_ROM_EXT = ["gba", "agb", "bin", "zip"];
const RECENT_MAX = 10;
const LICENSE_LINE = "webGBA — MIT License, © 2026 flightrabbit";

const KEY_ORDER = ["A", "B", "L", "R", "START", "SELECT", "UP", "DOWN", "LEFT", "RIGHT", "FAST"];

const state = {
  info: null,
  prefs: {},
  game: null,
  root: "",
  entries: [],
  selected: -1,
  coreModule: null,
  autoPaused: false,
  opening: false,
  menuName: "",
  link: { linked: false, elsewhere: false },
};

const player = new Player({
  canvas: el.screen,
  onStatus: (text, level) => status(text, level),
  onStats: ({ fps, speed }) => {
    el.statusRight.textContent = t("status.stats", { fps: fps.toFixed(1), speed, slot: slot() });
  },
  onHalt: (why) => {
    status(t("status.halted", { reason: why || t("status.haltUnknown") }), "error");
    core.log("ERROR", `게임이 멈췄습니다 ${state.game?.path ?? ""}: ${why}`);
  },
});

const baseOf = (path) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
const dirOf = (path) => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
const extOf = (path) => {
  const name = baseOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};
const stemOf = (path) => {
  const name = baseOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};
const samePath = (a, b) => Boolean(a && b) && a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
const slot = () => state.prefs.slot ?? 1;
const reason = (error) => String(error?.message ?? error);

const PATH_IN_TEXT = /(?:\\\\\?\\)?[A-Za-z]:(?:[\\/][^\\/:*?"<>|\r\n]+?)*[\\/]([^\\/:*?"<>|\r\n]+?)(?=$|:\s|\s·\s|\s—\s|,\s)/g;

export function hidePaths(text) {
  return String(text).replace(PATH_IN_TEXT, (whole, name) => name);
}

function labels(paths) {
  const count = new Map();
  for (const path of paths) count.set(baseOf(path).toLowerCase(), (count.get(baseOf(path).toLowerCase()) ?? 0) + 1);
  return paths.map((path) => ({ path, name: baseOf(path), where: count.get(baseOf(path).toLowerCase()) > 1 ? baseOf(dirOf(path)) : "" }));
}

function icon(name) {
  const span = document.createElement("span");
  span.className = "icon";
  span.style.setProperty("--icon", `url("/icons/${name}.svg")`);
  return span;
}

function status(text, level = "info") {
  el.status.removeAttribute("data-i18n");
  el.status.textContent = hidePaths(text);
  el.status.classList.toggle("is-warn", level === "warn");
  el.status.classList.toggle("is-error", level === "error");
}

async function savePrefs(patch) {
  Object.assign(state.prefs, patch);
  try {
    await core.prefsSet(patch);
  } catch (error) {
    status(t("status.prefsFailed", { reason: reason(error) }), "error");
  }
}

function keysFromPrefs() {
  const saved = state.prefs.keys ?? {};
  const keys = {};
  for (const name of KEY_ORDER) keys[name] = Array.isArray(saved[name]) ? saved[name].slice(0, 2) : [...DEFAULT_KEYS[name]];
  return keys;
}

const KEY_CODES = ["ShiftRight", "ShiftLeft", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "Space", "Enter", "Backspace", "Tab", "NumpadEnter"];

function keyName(code) {
  if (!code) return "—";
  const arrows = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code]) return arrows[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (KEY_CODES.includes(code)) return t(`keyCode.${code}`);
  if (code.startsWith("Numpad")) return t("keyCode.numpad", { key: code.slice(6) });
  return code;
}

/* ── 화면 배치 ── */

const integerScale = () => state.prefs.scaleMode === "integer";

function layoutScreen() {
  const box = el.stage.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const fit = Math.min(box.width / SCREEN_W, box.height / SCREEN_H);
  const scale = integerScale() && fit >= 1 ? Math.floor(fit) : fit;
  const width = Math.max(1, Math.floor(SCREEN_W * scale));
  el.screen.style.width = `${width}px`;
  el.screen.style.height = `${Math.max(1, Math.round((width * SCREEN_H) / SCREEN_W))}px`;
}

new ResizeObserver(layoutScreen).observe(el.stage);
window.addEventListener("resize", layoutScreen);

function showView(view) {
  el.start.hidden = view !== "start";
  el.screen.hidden = view !== "screen";
  el.frame.hidden = view !== "frame";
  el.stage.classList.toggle("is-game", view !== "start");
  if (view !== "screen") el.paused.hidden = true;
  if (view === "start") renderStart();
  layoutScreen();
}

const favorites = () => state.prefs.favorites ?? [];
const isFavorite = (path) => favorites().some((item) => samePath(item, path));

function syncControls() {
  const hosted = player.active;
  el.btnPause.disabled = !hosted;
  el.btnReset.disabled = !state.game;
  el.btnFast.disabled = !hosted;
  el.btnStateSave.disabled = !player.canState;
  el.btnStateLoad.disabled = !player.canState;
  el.btnFast.setAttribute("aria-pressed", String(player.fast));
  el.btnPauseIcon.style.setProperty("--icon", `url("/icons/${player.paused ? "player-play" : "player-pause"}.svg")`);
  el.btnPause.title = t(player.paused ? "rail.resume" : "rail.pause");
  el.paused.hidden = !(hosted && player.paused);
  el.btnMute.setAttribute("aria-pressed", String(player.muted));
  el.btnMute.title = t(player.muted ? "rail.unmute" : "rail.mute");
  el.btnMuteIcon.style.setProperty("--icon", `url("/icons/${player.muted ? "volume-off" : "volume"}.svg")`);
  const starred = Boolean(state.game) && isFavorite(state.game.path);
  el.btnStar.disabled = !state.game;
  el.btnStar.setAttribute("aria-pressed", String(starred));
  el.btnStar.title = t(starred ? "rail.unstar" : "rail.star");
  el.btnStarIcon.style.setProperty("--icon", `url("/icons/${starred ? "star-filled" : "star"}.svg")`);
  el.btnFiles.setAttribute("aria-pressed", String(state.prefs.panel === "files"));
  el.btnFavorites.setAttribute("aria-pressed", String(state.prefs.panel === "favorites"));
  el.btnSettings.setAttribute("aria-pressed", String(settings.isOpen()));
  const collapsed = Boolean(state.prefs.railCollapsed);
  document.documentElement.classList.toggle("is-rail-collapsed", collapsed);
  el.railToggle.setAttribute("aria-pressed", String(collapsed));
  el.railToggle.title = t(collapsed ? "rail.expand" : "rail.collapse");
  el.railToggleIcon.style.setProperty("--icon", `url("/icons/${collapsed ? "layout-sidebar-left-expand" : "layout-sidebar-left-collapse"}.svg")`);
  el.title.textContent = state.game ? `webGBA — ${state.game.title || state.game.name}` : "webGBA";
  if (!state.game) el.statusRight.textContent = "";
  else if (state.game.kind === "frame") el.statusRight.textContent = t("status.frameKind", { mode: t(state.game.build.page ? "status.framePage" : "status.frameGlue") });
}

/* ── 열기 ── */

async function coreModule() {
  if (!state.coreModule) state.coreModule = await WebAssembly.compile(await core.coreRead());
  return state.coreModule;
}

function loadRomBytes(path) {
  return core.romRead(path);
}

function hostLog(level, line) {
  if (level === "error") core.log("WARN", `[코어] ${line}`);
}

async function rememberRecent(path) {
  const recent = (state.prefs.recent ?? []).filter((item) => !samePath(item, path));
  recent.unshift(path);
  await savePrefs({ recent: recent.slice(0, RECENT_MAX), lastDir: dirOf(path) });
}

async function openSave(path) {
  const name = baseOf(await core.savePath(path));
  const save = await core.saveRead(path);
  return { save, name };
}

const saveNote = (hadSave, name) => t(hadSave ? "status.saveLoaded" : "status.saveNone", { name });

const join = (...parts) => parts.filter(Boolean).join(" · ");

async function openPath(path, options = {}) {
  if (!path || state.opening) return false;
  let ext = extOf(path);
  if (!OPEN_EXT.has(ext)) {
    status(t("status.unsupported", { name: baseOf(path) }), "warn");
    return false;
  }
  state.opening = true;
  status(t("status.opening", { name: baseOf(path) }));
  try {
    await closeGame({ quiet: true });
    let made = null;
    if (ext === PATCH_EXT) {
      made = await makeFromPatch(path, options);
      if (!made) {
        showView("start");
        return false;
      }
      path = made.path;
      ext = extOf(path);
    }
    const ok = WASM_EXT.has(ext) ? await openWasm(path, options) : await openRom(path);
    if (!ok) return false;
    if (made?.note) status(join(made.note, el.status.textContent));
    await rememberRecent(path);
    state.root = dirOf(path);
    await loadRoot({ select: path });
    syncControls();
    return true;
  } catch (error) {
    status(t("status.openFailed", { reason: reason(error) }), "error");
    core.log("ERROR", `열지 못했습니다 ${path}: ${reason(error)}`);
    showView("start");
    return false;
  } finally {
    state.opening = false;
  }
}

async function startHosted(host, game) {
  state.game = { ...game, name: baseOf(game.path), title: host.title ? `${baseOf(game.path)} · ${host.title}` : baseOf(game.path) };
  showView("screen");
  layoutScreen();
  await player.start({ host, saveId: game.saveId, game: game.path });
  player.fastScale = state.prefs.fastScale ?? 4;
  syncControls();
  el.stage.focus();
}

async function openRom(path) {
  const rom = await loadRomBytes(path);
  const module = await coreModule();
  const saveId = `gba/${stemOf(path)}`;
  const { save, name } = await openSave(path);
  const { host, hadSave } = await bootHost({ module, rom, save, log: hostLog });
  await startHosted(host, { path, saveId, kind: "core" });
  status(join(baseOf(path), saveNote(hadSave, name)));
  return true;
}

async function exists(path) {
  try {
    await core.fileStat(path);
    return true;
  } catch {
    return false;
  }
}

const besideOf = (path, name) => {
  const dir = dirOf(path);
  const sep = path.charAt(dir.length) || "\\";
  return dir ? `${dir}${sep}${name}` : name;
};

const paint = () =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      setTimeout(resolve, 0);
    };
    const timer = setTimeout(done, 60);
    requestAnimationFrame(done);
  });

const patchNeed = (manifest) =>
  (manifest?.bases ?? [])
    .filter((base) => base.main !== false)
    .map((base) => base.name)
    .join(" · ");

function patchError(error, { file, rom = "", manifest = null }) {
  if (!(error instanceof WgbpError)) return reason(error);
  const p = error.params ?? {};
  return t(`patch.err.${error.code}`, {
    name: baseOf(file),
    rom: rom ? baseOf(rom) : "",
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

async function makeFromPatch(path, { patchRom = "" } = {}) {
  const bytes = await core.fileReadBytes(path);
  let patch;
  try {
    patch = readPatch(bytes);
  } catch (error) {
    throw new Error(patchError(error, { file: path }));
  }
  const { manifest } = patch;
  const out = besideOf(path, `${stemOf(path)}.wgba`);
  const outName = baseOf(out);
  if (await exists(out)) {
    let same = false;
    try {
      same = (await sha1Hex(await core.fileReadBytes(out))) === manifest.wgba.sha1;
    } catch {
      same = false;
    }
    if (same) return { path: out, note: t("status.patchExisting", { name: outName }) };
    if (!(await confirmDialog(t("confirm.patchOverwriteTitle"), t("confirm.patchOverwriteText", { name: outName, patch: baseOf(path) })))) {
      status(t("status.patchCancelled"), "warn");
      return null;
    }
  }
  let rom = patchRom;
  if (!rom) {
    const go = await openDialog({
      title: t("patch.title", { title: manifest.title }),
      body: [t("patch.intro", { name: baseOf(path), out: outName }), t("patch.need", { need: patchNeed(manifest) })],
      actions: [
        { label: "CANCEL", value: false },
        { label: "OK", go: true, value: true },
      ],
    });
    if (go) rom = await core.pickFile({ title: t("pick.patchRom", { title: manifest.title }), filters: PATCH_ROM_EXT, filterName: t("pick.romFilter"), start: dirOf(path) });
    if (!rom) {
      status(t("status.patchCancelled"), "warn");
      return null;
    }
  }
  const started = performance.now();
  const romBytes = await loadRomBytes(rom);
  let made;
  try {
    made = await buildGame(patch, romBytes, {
      onStep: async (step) => {
        status(t("status.patchMaking", { name: outName, step: t(`patch.step.${step}`) }));
        await paint();
      },
    });
  } catch (error) {
    core.log("WARN", `패치로 만들지 못했습니다 ${path} + ${rom}: ${reason(error)}`);
    throw new Error(patchError(error, { file: path, rom, manifest }));
  }
  status(t("status.patchMaking", { name: outName, step: t("patch.step.write") }));
  await paint();
  let target = out;
  try {
    await core.fileWriteBytes(target, made.wgba);
  } catch (error) {
    core.log("WARN", `만든 게임을 쓰지 못했습니다 ${target}: ${reason(error)}`);
    const other = await core.pickSave({ title: t("pick.patchOut"), defaultName: outName, defaultExt: "wgba", filters: ["wgba"], filterName: t("pick.gameFilter"), start: dirOf(path) });
    if (!other) throw new Error(t("patch.err.write", { name: outName, reason: reason(error) }));
    await core.fileWriteBytes(other, made.wgba);
    target = other;
  }
  core.log("INFO", `패치로 만듦 ${path} + ${rom} → ${target} (${made.base.name}, ${made.wgba.length}바이트, SHA-1 ${made.sha1}${made.same ? "" : ", 기준 SHA-1 과 다름"}, ${Math.round(performance.now() - started)}ms)`);
  return { path: target, note: t("status.patchMade", { name: baseOf(target), base: made.base.name }) };
}

function isWasmBytes(bytes) {
  return bytes.length >= 8 && bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
}

async function rememberWebRom(build, rom) {
  const builds = { ...(state.prefs.webBuilds ?? {}) };
  builds[build.key] = { rom };
  await savePrefs({ webBuilds: builds });
}

async function resolveWebRom(build, ask) {
  const remembered = state.prefs.webBuilds?.[build.key]?.rom;
  if (remembered && (await exists(remembered))) return remembered;
  if (build.romGuess) return build.romGuess;
  if (!ask) return null;
  const picked = await core.pickFile({ title: t("pick.webRom"), filters: ["gba"], filterName: t("pick.romFilter"), start: build.dir });
  if (picked) await rememberWebRom(build, picked);
  return picked;
}

async function openWasm(path, { preferPage = false } = {}) {
  const bytes = await core.fileReadBytes(path);
  if (!isWasmBytes(bytes)) throw new Error(t("status.notWasm", { name: baseOf(path) }));
  const build = await core.webInspect(path, state.prefs.webRom || null);
  if (build.movedFrom) {
    const builds = { ...(state.prefs.webBuilds ?? {}) };
    if (builds[build.movedFrom] && !builds[build.key]) {
      builds[build.key] = builds[build.movedFrom];
      await savePrefs({ webBuilds: builds });
    }
    core.log("INFO", `.wasm 때의 상태 슬롯을 이어받음 ${build.movedFrom} → ${build.key} (${path})`);
  }
  let module = null;
  try {
    module = await WebAssembly.compile(bytes);
  } catch (error) {
    throw new Error(t("status.wasmUnreadable", { reason: reason(error) }));
  }
  const report = inspectModule(module);
  const embedded = await readEmbeddedRom(module);
  const romEmbedded = Boolean(embedded);
  const romNote = (rom) => (romEmbedded ? t("status.romEmbedded") : rom ? t("status.romUsed", { name: baseOf(rom) }) : "");
  if (report.usable && !(preferPage && build.page)) {
    const rom = romEmbedded ? null : await resolveWebRom(build, true);
    if (!romEmbedded && !rom) {
      status(t("status.noRomPicked"), "warn");
      showView("start");
      return false;
    }
    if (!romEmbedded) await core.webSetRom(build.key, rom);
    const { save, name } = await openSave(path);
    const { host, hadSave } = await bootHost({ module, rom: romEmbedded ? embedded.rom : await loadRomBytes(rom), save, log: hostLog });
    await startHosted(host, { path, saveId: build.saveId, kind: "web", build, rom, romEmbedded });
    status(join(baseOf(path), romNote(rom), saveNote(hadSave, name)));
    return true;
  }
  module = null;
  const rom = romEmbedded ? null : await resolveWebRom(build, false);
  if (!romEmbedded) await core.webSetRom(build.key, rom);
  if (build.page || build.glue) {
    if (build.page) {
      openFrame(`${build.origin}/${build.page.split("/").map(encodeURIComponent).join("/")}`, { path, build, rom, romEmbedded });
      status(join(t("status.openPage", { name: baseOf(path), page: build.page }), romEmbedded ? romNote(rom) : ""));
    } else {
      openFrame(`${build.origin}/__webgba__/wasm-host.html?js=${encodeURIComponent(build.glue)}&lang=${i18n.lang()}`, { path, build, rom, romEmbedded });
      status(join(t("status.openGlue", { name: baseOf(path), glue: build.glue }), romEmbedded ? romNote(rom) : ""));
    }
    return true;
  }
  const why = report.unknown.length ? t("status.unknownImports", { list: `${report.unknown.slice(0, 3).join(", ")}${report.unknown.length > 3 ? " …" : ""}` }) : "";
  throw new Error(t("status.needsGlue", { why }));
}

function openFrame(url, { path, build, rom, romEmbedded }) {
  state.game = { path, name: baseOf(path), title: baseOf(path), kind: "frame", build, rom, romEmbedded, saveId: build.saveId, origin: build.origin };
  el.frame.src = url;
  showView("frame");
  syncControls();
  el.frame.addEventListener("load", () => focusFrame(), { once: true });
}

function focusFrame() {
  if (state.game?.kind !== "frame") return;
  el.frame.focus();
  try {
    el.frame.contentWindow.postMessage({ type: "webgba:focus" }, state.game.origin);
  } catch {}
}

async function closeGame({ quiet = false } = {}) {
  if (!state.game) return "";
  const game = state.game;
  if (player.active) await player.stop();
  if (game.kind === "frame") el.frame.src = "about:blank";
  state.game = null;
  state.autoPaused = false;
  showView("start");
  syncControls();
  renderPanel();
  if (!quiet) status(t("status.closed"));
}

async function openDialogFile() {
  const start = state.game ? dirOf(state.game.path) : state.prefs.lastDir;
  const path = await core.pickFile({ title: t("pick.open"), filters: ["gba", "wgba", "wgbp", "wasm", "zip", "agb"], filterName: t("pick.gameFilter"), start });
  if (path) await openPath(path);
}

/* ── 옆 패널: 같은 폴더의 게임 · 즐겨찾기 ── */

function kindOf(path) {
  const ext = extOf(path);
  if (WASM_EXT.has(ext)) return "wasm";
  if (ext === PATCH_EXT) return "patch";
  if (ext === "zip") return "zip";
  return "rom";
}

const ROW_ICON = { wasm: "file-code", patch: "file-diff", zip: "file-zip", rom: "device-gamepad-2" };

async function loadRoot({ select = "" } = {}) {
  state.entries = [];
  if (state.root) {
    try {
      const items = await core.fileList(state.root);
      state.entries = items
        .filter((item) => !item.isDir && LIST_EXT.has(item.extension))
        .map((item) => item.path)
        .sort((a, b) => baseOf(a).localeCompare(baseOf(b), "ko"));
    } catch (error) {
      core.log("WARN", `폴더를 읽지 못했습니다 ${state.root}: ${reason(error)}`);
    }
  }
  const at = select ? state.entries.findIndex((path) => samePath(path, select)) : -1;
  state.selected = at >= 0 ? at : 0;
  if (state.prefs.panel === "files") renderPanel();
}

function panelItems() {
  return state.prefs.panel === "favorites" ? favorites() : state.entries;
}

function makeRow(item, { removable = false, missing = false } = {}) {
  const row = document.createElement("li");
  const kind = kindOf(item.path);
  row.className = `row row--${kind}`;
  row.classList.toggle("is-current", samePath(item.path, state.game?.path));
  row.classList.toggle("is-missing", missing);
  row.setAttribute("role", "option");
  const name = document.createElement("span");
  name.className = "row__name";
  name.textContent = item.name;
  row.append(icon(ROW_ICON[kind]), name);
  if (item.where) {
    const where = document.createElement("span");
    where.className = "row__where";
    where.textContent = item.where;
    row.append(where);
  }
  if (removable) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "iconbtn iconbtn--xs row__del";
    remove.title = t("panel.unfavorite");
    remove.append(icon("x"));
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(item.path, false);
    });
    row.append(remove);
  }
  if (missing) row.title = t("panel.missing");
  return row;
}

function renderPanel() {
  const panel = state.prefs.panel;
  el.panel.hidden = !panel;
  layoutScreen();
  if (!panel) return;
  const isFav = panel === "favorites";
  el.panelTitle.textContent = t(isFav ? "panel.favorites" : "panel.files");
  const items = labels(panelItems());
  el.panelCount.textContent = items.length ? t("panel.count", { count: items.length }) : "";
  el.panelList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "sidepanel__empty";
    empty.textContent = t(isFav ? "panel.favoritesEmpty" : state.root ? "panel.filesEmpty" : "panel.filesNone");
    el.panelList.append(empty);
    return;
  }
  state.selected = Math.max(0, Math.min(items.length - 1, state.selected));
  items.forEach((item, index) => {
    const row = makeRow(item, { removable: isFav });
    row.setAttribute("aria-selected", String(index === state.selected));
    row.addEventListener("click", () => selectRow(index));
    row.addEventListener("dblclick", () => activateRow(index));
    el.panelList.append(row);
    if (isFav) {
      exists(item.path).then((ok) => {
        if (!ok) {
          row.classList.add("is-missing");
          row.title = t("panel.missing");
        }
      });
    }
  });
  el.panelList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function selectRow(index) {
  state.selected = index;
  for (const [i, row] of [...el.panelList.children].entries()) row.setAttribute("aria-selected", String(i === index));
  el.panelList.children[index]?.scrollIntoView({ block: "nearest" });
}

async function activateRow(index) {
  const path = panelItems()[index];
  if (path) await openPath(path);
}

async function showPanel(name) {
  const next = state.prefs.panel === name ? "" : name;
  await savePrefs({ panel: next });
  if (next === "files") await loadRoot({ select: state.game?.path });
  if (next && state.prefs.railCollapsed) await savePrefs({ railCollapsed: false });
  syncControls();
  renderPanel();
}

async function toggleRail(collapse = !state.prefs.railCollapsed) {
  await savePrefs({ railCollapsed: collapse });
  syncControls();
  renderPanel();
  requestAnimationFrame(layoutScreen);
}

async function toggleFavorite(path = state.game?.path, on = path ? !isFavorite(path) : false) {
  if (!path) return;
  const list = favorites().filter((item) => !samePath(item, path));
  if (on) list.push(path);
  await savePrefs({ favorites: list });
  syncControls();
  renderPanel();
  if (el.start.hidden === false) renderStart();
  status(t(on ? "status.starred" : "status.unstarred", { name: baseOf(path) }));
}

async function stepGame(by) {
  if (!state.game) {
    status(t("status.noGame"), "warn");
    return;
  }
  state.root = dirOf(state.game.path);
  await loadRoot({ select: state.game.path });
  const games = state.entries;
  if (games.length < 2) {
    status(t("status.noOtherGame"), "warn");
    return;
  }
  const at = games.findIndex((path) => samePath(path, state.game.path));
  const next = games[((at < 0 ? 0 : at) + by + games.length) % games.length];
  if (await openPath(next)) status(`${baseOf(next)} — ${games.indexOf(next) + 1}/${games.length}`);
}

el.panelList.addEventListener("keydown", (event) => {
  const count = panelItems().length;
  if (!count || event.defaultPrevented) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selectRow(Math.max(0, Math.min(count - 1, state.selected + (event.key === "ArrowDown" ? 1 : -1))));
  } else if (event.key === "Enter") {
    event.preventDefault();
    activateRow(state.selected);
  } else if (event.key === "Delete" && state.prefs.panel === "favorites") {
    event.preventDefault();
    toggleFavorite(panelItems()[state.selected], false);
  }
});

$("sidepanel-refresh").addEventListener("click", async () => {
  if (state.prefs.panel === "files") await loadRoot({ select: panelItems()[state.selected] });
  renderPanel();
});

/* ── 끌어 놓기(아비터 방식) ── */

const OS_DRAG_IDLE_MS = 200;
const osDrag = { timer: 0 };

function showOsDrag() {
  const box = el.stage.getBoundingClientRect();
  Object.assign(el.osdragFrame.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  el.osdrag.classList.remove("is-instant");
  el.osdrag.classList.add("is-on");
  clearTimeout(osDrag.timer);
  osDrag.timer = setTimeout(() => hideOsDrag(false), OS_DRAG_IDLE_MS * 10);
}

function hideOsDrag(instant) {
  clearTimeout(osDrag.timer);
  el.osdrag.classList.toggle("is-instant", instant);
  el.osdrag.classList.remove("is-on");
}

onOsDrag((phase) => {
  if (phase === "over") showOsDrag();
  else hideOsDrag(true);
});

async function openDropped(paths) {
  let opened = false;
  let folders = 0;
  const files = [];
  for (const path of paths ?? []) {
    let stat = null;
    try {
      stat = await core.fileStat(path);
    } catch {
      stat = null;
    }
    if (!stat) continue;
    if (stat.isDir) folders++;
    else files.push({ path, ext: stat.extension });
  }
  const patch = files.find((file) => file.ext === PATCH_EXT);
  const rom = files.find((file) => PATCH_ROM_EXT.includes(file.ext));
  if (patch && rom) {
    await openPath(patch.path, { patchRom: rom.path });
    return;
  }
  for (const file of files) {
    if (!opened && OPEN_EXT.has(file.ext)) opened = await openPath(file.path);
  }
  if (opened) return;
  status(t(folders ? "status.dropFolder" : "status.dropNothing"), "warn");
}

onOsFileDrop((paths) => {
  hideOsDrag(true);
  openDropped(paths).catch((error) => status(reason(error), "error"));
});

/* ── 첫 화면 ── */

function renderList(list, head, paths) {
  list.replaceChildren();
  list.hidden = !paths.length;
  head.hidden = !paths.length;
  for (const item of labels(paths)) {
    const row = makeRow(item);
    row.addEventListener("click", () => openPath(item.path));
    list.append(row);
  }
}

function renderStart() {
  renderList(el.startFavorites, el.startFavoritesHead, favorites());
  renderList(el.startRecent, el.startRecentHead, state.prefs.recent ?? []);
}

/* ── 대화상자 ── */

let dialogDone = null;

function openDialog({ title, body, actions, wide = false }) {
  closeMenu();
  player.releaseAll();
  return new Promise((resolve) => {
    dialogDone?.(null);
    dialogDone = (value) => {
      dialogDone = null;
      el.layer.hidden = true;
      resolve(value);
      if (settings.isOpen()) return;
      if (state.game?.kind === "frame") focusFrame();
      else el.stage.focus();
    };
    el.dialog.classList.toggle("dialog--wide", wide);
    el.dialogTitle.textContent = title;
    el.dialogBody.replaceChildren(...(Array.isArray(body) ? body : [body]).map((part) => (typeof part === "string" ? Object.assign(document.createElement("p"), { textContent: part }) : part)));
    el.dialogActions.replaceChildren(
      ...actions.map((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action.go ? "btn btn--go" : "btn";
        button.textContent = action.label;
        button.addEventListener("click", () => {
          if (action.run) action.run();
          else dialogDone?.(action.value);
        });
        return button;
      }),
    );
    el.layer.hidden = false;
    (el.dialogActions.querySelector(".btn--go") ?? el.dialogActions.lastElementChild)?.focus();
  });
}

const confirmDialog = (title, text) =>
  openDialog({ title, body: text, actions: [{ label: "CANCEL", value: false }, { label: "OK", go: true, value: true }] }).then(Boolean);

function helpBody() {
  const keys = keysFromPrefs();
  const list = document.createElement("dl");
  list.className = "help";
  const rows = [
    ...KEY_ORDER.map((name) => [t(`key.${name}`), keys[name].map(keyName).join(" · ") || "—"]),
    [t("help.fastToggle"), "Tab"],
    [t("help.pause"), "Pause"],
    [t("help.state"), "Shift+F1~F9 / F1~F9"],
    [t("help.reset"), "Ctrl+R"],
    [t("help.openClose"), "Ctrl+O / Ctrl+W"],
    [t("help.star"), "Ctrl+D"],
    [t("help.rail"), "Ctrl+B"],
    [t("help.settings"), "Ctrl+,"],
    [t("help.step"), "Ctrl+PageUp / Ctrl+PageDown"],
  ];
  for (const [what, how] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = what;
    const dd = document.createElement("dd");
    dd.textContent = how;
    list.append(dt, dd);
  }
  const note = document.createElement("p");
  note.className = "keys__note";
  note.textContent = t("help.pageNote");
  return [list, note];
}

async function showInfo() {
  let license = "";
  try {
    license = await (await fetch("bin/core/licenses/mgba-LICENSE.txt")).text();
  } catch {
    license = "";
  }
  const pre = document.createElement("pre");
  pre.className = "license";
  pre.textContent = license || "MPL-2.0 — https://mozilla.org/MPL/2.0/";
  const lead = Object.assign(document.createElement("p"), { className: "dialog__lead", textContent: `webGBA V${state.info?.version ?? ""}` });
  const sub = Object.assign(document.createElement("p"), { className: "dialog__sub", textContent: t("info.openSource") });
  await openDialog({
    title: t("info.title"),
    wide: true,
    body: [
      lead,
      LICENSE_LINE,
      t("info.about"),
      sub,
      t("info.mgba"),
      t("info.mgbaSource"),
      t("info.others"),
      pre,
    ],
    actions: [{ label: "CLOSE", go: true, value: null }],
  });
}

/* ── 설정 창 ── */

function openSettings(tab = "general") {
  closeMenu();
  player.releaseAll();
  if (!el.layer.hidden) dialogDone?.(null);
  return settings.open(tab).then(syncControls);
}

async function settingsSnapshot() {
  await refreshLink();
  const ini = state.info?.settings ?? {};
  return {
    scaleMode: integerScale() ? "integer" : "fit",
    railCollapsed: Boolean(state.prefs.railCollapsed),
    pauseWhenHidden: Boolean(ini.pauseWhenHidden),
    muted: player.muted,
    volume: Math.round(player.volume * 100),
    fastMute: player.fastMute,
    fastScale: player.fastScale,
    dpadMode: player.dpadMode,
    slot: slot(),
    wgbaLink: state.link.linked,
    webRom: state.prefs.webRom ?? "",
    favorites: [...favorites()],
    recent: [...(state.prefs.recent ?? [])],
    useDevelopKit: Boolean(ini.useDevelopKit),
    keys: keysFromPrefs(),
    theme: state.prefs.theme ?? { mode: "dark", colors: {} },
  };
}

async function applySettings(next) {
  const patch = {
    scaleMode: next.scaleMode === "integer" ? "integer" : "fit",
    railCollapsed: Boolean(next.railCollapsed),
    muted: Boolean(next.muted),
    volume: next.volume,
    fastMute: Boolean(next.fastMute),
    fastScale: next.fastScale,
    dpadMode: DPAD_MODES.includes(next.dpadMode) ? next.dpadMode : DPAD_DEFAULT,
    slot: next.slot,
    webRom: String(next.webRom ?? "").trim(),
    favorites: next.favorites,
    recent: next.recent,
    keys: next.keys,
  };
  await core.prefsSet(patch);
  Object.assign(state.prefs, patch);

  const ini = state.info?.settings ?? {};
  const iniPatch = {};
  for (const key of ["pauseWhenHidden", "useDevelopKit"]) {
    if (Boolean(next[key]) !== Boolean(ini[key])) iniPatch[key] = Boolean(next[key]);
  }
  if (Object.keys(iniPatch).length) state.info.settings = await core.settingsSave(iniPatch);

  if (Boolean(next.wgbaLink) !== state.link.linked) {
    state.link = await core.assocSet(Boolean(next.wgbaLink));
    state.prefs.wgbaLink = Boolean(next.wgbaLink);
  }

  player.setKeys(next.keys);
  player.setVolume(next.volume / 100);
  player.setMuted(Boolean(next.muted));
  player.fastScale = next.fastScale;
  player.fastMute = patch.fastMute;
  player.setDpadMode(patch.dpadMode);
  syncControls();
  renderPanel();
  if (!el.start.hidden) renderStart();
  requestAnimationFrame(layoutScreen);
  status(t("status.settingsSaved"));
}

async function setTheme(value) {
  await savePrefs({ theme: value });
}

async function setLang(id) {
  const next = await i18n.use(id);
  await core.langSet(next);
  state.prefs.lang = next;
  refreshTexts();
  status(t("status.langChanged"));
}

function refreshTexts() {
  syncControls();
  renderPanel();
  if (!el.start.hidden) renderStart();
  setMaximized(document.documentElement.classList.contains("is-maximized"));
  if (state.menuName) closeMenu();
}

/* ── .wgba 연결 ── */

async function refreshLink() {
  try {
    state.link = await core.assocStatus();
  } catch {
    state.link = { linked: false, elsewhere: false };
  }
}

async function toggleLink() {
  const link = !state.link.linked;
  try {
    state.link = await core.assocSet(link);
    state.prefs.wgbaLink = link;
    status(t(link ? "status.linked" : "status.unlinked"));
  } catch (error) {
    status(t("status.linkFailed", { reason: reason(error) }), "error");
  }
}

/* ── 세이브·상태 ── */

async function saveStateTo(index) {
  if (!player.canState) {
    status(t("status.noStateSupport"), "warn");
    return;
  }
  try {
    if (await player.saveState(index)) status(t("status.stateSaved", { slot: index }));
    else status(t("status.stateSaveFailed"), "error");
  } catch (error) {
    status(t("status.stateSaveFailedWhy", { reason: reason(error) }), "error");
  }
}

async function loadStateFrom(index) {
  if (!player.canState) {
    status(t("status.noStateSupport"), "warn");
    return;
  }
  try {
    const result = await player.loadState(index);
    if (result === null) status(t("status.stateEmpty", { slot: index }), "warn");
    else if (result) status(t("status.stateLoaded", { slot: index }));
    else status(t("status.stateLoadFailed"), "error");
  } catch (error) {
    status(t("status.stateLoadFailedWhy", { reason: reason(error) }), "error");
  }
}

async function exportSave(target) {
  if (!state.game) return;
  await player.flushSave();
  const bytes = player.active ? player.host.saveData() : await core.saveRead(state.game.path);
  if (!bytes || !bytes.length) {
    status(t("status.noSaveYet"), "warn");
    return;
  }
  const path = typeof target === "string" ? target : await core.pickSave({ title: t("pick.exportSave"), defaultName: `${stemOf(state.game.path)}.sav`, defaultExt: "sav", filters: ["sav"], filterName: t("pick.saveFilter"), start: dirOf(state.game.path) });
  if (!path) return;
  await core.fileWriteBytes(path, bytes);
  status(t("status.saveExported", { name: baseOf(path) }));
}

async function importSave(source) {
  if (!state.game) return;
  const path = typeof source === "string" ? source : await core.pickFile({ title: t("pick.importSave"), filters: ["sav"], filterName: t("pick.saveFilter"), start: dirOf(state.game.path) });
  if (!path) return;
  const bytes = await core.fileReadBytes(path);
  const limit = state.game.kind === "core" ? 0x20000 : player.active && player.host ? player.host.saveCapacity : 0x100000;
  if (!bytes.length || bytes.length > limit) {
    status(t("status.saveSizeBad", { kb: limit / 1024 }), "error");
    return;
  }
  if (!(await confirmDialog(t("confirm.importTitle"), t("confirm.importText")))) return;
  const game = state.game;
  if (player.active) await player.stop();
  const done = await core.saveImport(game.path, path);
  core.log("INFO", `세이브 가져오기 ${path} → ${done.path}`);
  if (game.kind === "frame") {
    el.frame.src = el.frame.src;
    status(t("status.saveImported"));
    return;
  }
  state.game = null;
  await openPath(game.path, { preferPage: false });
  status(t("status.saveImportedFrom", { name: baseOf(path) }));
}

async function revealSave() {
  if (!state.game) return;
  const target = await core.savePath(state.game.path);
  await core.revealPath((await exists(target)) ? target : dirOf(target)).catch((error) => status(reason(error), "error"));
}

async function chooseWebRom() {
  const game = state.game;
  if (!game?.build || game.romEmbedded) return;
  const picked = await core.pickFile({ title: t("pick.webRom"), filters: ["gba"], filterName: t("pick.romFilter"), start: game.rom ? dirOf(game.rom) : game.build.dir });
  if (!picked) return;
  await rememberWebRom(game.build, picked);
  await openPath(game.path, { preferPage: game.kind === "frame" });
}

/* ── 게임 조작 ── */

function togglePause() {
  if (!player.active) return;
  player.setPaused(!player.paused);
  state.autoPaused = false;
  syncControls();
  status(t(player.paused ? "status.paused" : "status.resumed"));
}

function toggleFast() {
  if (!player.active) return;
  player.setFast(!player.fast);
  syncControls();
  status(player.fast ? t("status.fastOn", { scale: player.fastScale }) : t("status.fastOff"));
}

async function resetGame() {
  if (!state.game) return;
  if (!(await confirmDialog(t("confirm.resetTitle"), t("confirm.resetText")))) return;
  if (state.game.kind === "frame") {
    el.frame.src = el.frame.src;
    status(t("status.frameReloaded"));
    return;
  }
  if (await player.reset()) status(t("status.reset"));
}

async function toggleMute() {
  player.setMuted(!player.muted);
  syncControls();
  await savePrefs({ muted: player.muted });
}

async function setSlot(index) {
  await savePrefs({ slot: index });
  status(t("status.slot", { slot: index }));
}

async function shutdown() {
  try {
    settings.close();
    await closeGame({ quiet: true });
  } finally {
    await win.close();
  }
}

/* ── 메뉴 ── */

function pathItems(paths) {
  return labels(paths).map((item) => ({ label: item.where ? `${item.name} · ${item.where}` : item.name, run: () => openPath(item.path) }));
}

function menuItems(name) {
  const game = state.game;
  const hosted = player.active;
  const recent = state.prefs.recent ?? [];
  if (name === "file") {
    const starred = Boolean(game) && isFavorite(game.path);
    return [
      { label: t("menu.open"), keys: "Ctrl+O", run: openDialogFile },
      { label: t("menu.close"), keys: "Ctrl+W", run: () => closeGame(), disabled: !game },
      { sep: true },
      { label: t(starred ? "menu.unstar" : "menu.star"), keys: "Ctrl+D", run: () => toggleFavorite(), disabled: !game },
      { head: t("menu.favorites") },
      ...(favorites().length ? pathItems(favorites()) : [{ label: t("menu.none"), disabled: true }]),
      { head: t("menu.recent") },
      ...(recent.length ? pathItems(recent) : [{ label: t("menu.none"), disabled: true }]),
      { sep: true },
      { label: t("menu.importSave"), run: importSave, disabled: !game },
      { label: t("menu.exportSave"), run: exportSave, disabled: !game },
      { label: t("menu.revealSave"), run: revealSave, disabled: !game },
      { sep: true },
      { label: t("menu.quit"), keys: "Alt+F4", run: shutdown },
    ];
  }
  if (name === "game") {
    const build = game?.build;
    return [
      { label: t(player.paused ? "menu.resume" : "menu.pause"), keys: "Pause", run: togglePause, disabled: !hosted },
      { label: t("menu.reset"), keys: "Ctrl+R", run: resetGame, disabled: !game },
      { label: t("menu.fast"), keys: "Tab", run: toggleFast, disabled: !hosted, checked: player.fast },
      { sep: true },
      { label: t("menu.stateSave", { slot: slot() }), keys: `Shift+F${slot()}`, run: () => saveStateTo(slot()), disabled: !player.canState },
      { label: t("menu.stateLoad", { slot: slot() }), keys: `F${slot()}`, run: () => loadStateFrom(slot()), disabled: !player.canState },
      { head: t("menu.slots") },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => ({ label: t("menu.slot", { slot: index }), checked: slot() === index, run: () => setSlot(index) })),
      { sep: true },
      { label: t("menu.prevGame"), keys: "Ctrl+PageUp", run: () => stepGame(-1), disabled: !game },
      { label: t("menu.nextGame"), keys: "Ctrl+PageDown", run: () => stepGame(1), disabled: !game },
      { sep: true },
      { label: t("menu.openPage"), run: () => openPath(game.path, { preferPage: true }), disabled: !(game?.kind === "web" && build?.page) },
      { label: t("menu.openHosted"), run: () => openPath(game.path, { preferPage: false }), disabled: !(game?.kind === "frame") },
      { label: t("menu.pickRom"), run: chooseWebRom, disabled: !build || Boolean(game?.romEmbedded) },
    ];
  }
  if (name === "setting") {
    return [
      { label: t("menu.settings"), keys: "Ctrl+,", run: () => openSettings("general") },
      { label: t("menu.keys"), run: () => openSettings("keys") },
      { label: t("menu.theme"), run: () => openSettings("theme") },
      { label: t("menu.language"), run: () => openSettings("language") },
      { sep: true },
      { label: t("menu.railCollapse"), keys: "Ctrl+B", checked: Boolean(state.prefs.railCollapsed), run: () => toggleRail() },
      { label: t("menu.mute"), checked: player.muted, run: toggleMute },
      { sep: true },
      { label: t("menu.openIni"), run: () => core.revealPath(`${state.info.binDir}\\ini\\setting.ini`) },
      { label: t("menu.openAppDir"), run: () => core.revealPath(state.info.binDir) },
    ];
  }
  return [
    { label: t("menu.howto"), run: () => openDialog({ title: t("help.title"), body: helpBody(), actions: [{ label: "CLOSE", go: true, value: null }] }) },
    { label: t("menu.info"), run: showInfo },
    ...(state.info?.settings?.useDevelopKit ? [{ sep: true }, { label: t("menu.devtools"), keys: "Ctrl+Shift+I", run: () => win.toggleDevtools() }] : []),
  ];
}

function closeMenu() {
  el.menu.hidden = true;
  state.menuName = "";
  for (const item of document.querySelectorAll(".menubar__item")) item.setAttribute("aria-expanded", "false");
}

async function openMenu(name, anchor) {
  if (name === "setting") await refreshLink();
  state.menuName = name;
  for (const item of document.querySelectorAll(".menubar__item")) item.setAttribute("aria-expanded", String(item.dataset.menu === name));
  el.menu.replaceChildren();
  for (const item of menuItems(name)) {
    if (item.sep) {
      el.menu.append(Object.assign(document.createElement("div"), { className: "menu__sep" }));
      continue;
    }
    if (item.head) {
      el.menu.append(Object.assign(document.createElement("div"), { className: "menu__head", textContent: item.head }));
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu__item";
    button.setAttribute("role", "menuitem");
    button.disabled = Boolean(item.disabled);
    const check = Object.assign(document.createElement("span"), { className: "menu__check", textContent: item.checked ? "✓" : "" });
    const label = Object.assign(document.createElement("span"), { className: "menu__label", textContent: item.label });
    const keys = Object.assign(document.createElement("span"), { className: "menu__keys", textContent: item.keys ?? "" });
    button.append(check, label, keys);
    button.addEventListener("click", async () => {
      closeMenu();
      try {
        await item.run?.();
      } catch (error) {
        status(reason(error), "error");
      }
    });
    el.menu.append(button);
  }
  const box = anchor.getBoundingClientRect();
  el.menu.hidden = false;
  el.menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - el.menu.offsetWidth - 8))}px`;
  el.menu.style.top = `${box.bottom + 2}px`;
}

for (const item of document.querySelectorAll(".menubar__item")) {
  item.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.menuName === item.dataset.menu) closeMenu();
    else openMenu(item.dataset.menu, item);
  });
  item.addEventListener("mouseenter", () => {
    if (state.menuName && state.menuName !== item.dataset.menu) openMenu(item.dataset.menu, item);
  });
}

$("app-menu").addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.menuName) closeMenu();
  else openMenu("file", document.querySelector('.menubar__item[data-menu="file"]'));
});

document.addEventListener("mousedown", (event) => {
  if (state.menuName && !el.menu.contains(event.target) && !event.target.closest?.(".menubar__item")) closeMenu();
});

/* ── 키 ── */

function typingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function forwardKey(event) {
  if (state.game?.kind !== "frame") return;
  try {
    el.frame.contentWindow.postMessage(
      { type: "webgba:key", kind: event.type, code: event.code, key: event.key, keyCode: event.keyCode, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey },
      state.game.origin,
    );
  } catch {}
}

function hotkey(event) {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (ctrl && event.shiftKey && key === "i") {
    win.toggleDevtools();
    return true;
  }
  const actions = { o: openDialogFile, w: () => closeGame(), r: resetGame, d: () => toggleFavorite(), b: () => toggleRail(), ",": () => openSettings("general") };
  if (ctrl && actions[key]) {
    actions[key]();
    return true;
  }
  if (ctrl && event.key === "PageUp") {
    stepGame(-1);
    return true;
  }
  if (ctrl && event.key === "PageDown") {
    stepGame(1);
    return true;
  }
  if (ctrl) return false;
  const fn = /^F([1-9])$/.exec(event.key);
  if (fn && player.active) {
    const index = Number(fn[1]);
    if (event.shiftKey) saveStateTo(index);
    else loadStateFrom(index);
    return true;
  }
  if (event.key === "Pause" && player.active) {
    togglePause();
    return true;
  }
  if (event.key === "Tab" && player.active) {
    toggleFast();
    return true;
  }
  return false;
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!el.layer.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        dialogDone?.(null);
      }
      return;
    }
    if (settings.isOpen()) return;
    if (state.menuName) {
      if (event.key === "Escape") closeMenu();
      return;
    }
    const code = codeOf(event);
    if (event.repeat && player.keymap.has(code)) {
      event.preventDefault();
      if (player.active && !typingTarget(event.target)) player.keyDown(code);
      return;
    }
    if (hotkey(event)) {
      event.preventDefault();
      return;
    }
    if (typingTarget(event.target)) return;
    if (player.active) {
      if (player.keyDown(code)) event.preventDefault();
    } else if (el.panelList.contains(event.target)) {
      return;
    } else if (state.game?.kind === "frame") {
      forwardKey(event);
      event.preventDefault();
    }
  },
  true,
);

document.addEventListener(
  "keyup",
  (event) => {
    const code = codeOf(event);
    if (player.active) {
      if (player.keyUp(code)) event.preventDefault();
    } else if (state.game?.kind === "frame" && el.layer.hidden && !settings.isOpen()) forwardKey(event);
  },
  true,
);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) player.releaseAll();
});

window.addEventListener("blur", () => {
  player.releaseAll();
  if (state.info?.settings?.pauseWhenHidden && player.active && !player.paused) {
    player.setPaused(true);
    state.autoPaused = true;
    syncControls();
  }
});

window.addEventListener("focus", () => {
  if (state.autoPaused && player.active) {
    player.setPaused(false);
    state.autoPaused = false;
    syncControls();
  }
});

window.addEventListener("message", (event) => {
  if (state.game?.kind !== "frame" || event.origin !== state.game.origin) return;
  const data = event.data;
  if (data?.type === "webgba:title" && data.title) {
    state.game.title = `${state.game.name} · ${data.title}`;
    syncControls();
  } else if (data?.type === "webgba:error" && data.message) {
    status(t("status.webError", { message: data.message }), "error");
    core.log("WARN", `웹 빌드 오류 ${state.game.path}: ${data.message}`);
  }
});

el.stage.addEventListener("mousedown", () => {
  if (state.game?.kind !== "frame") el.stage.focus();
});

/* ── 창 ── */

$("btn-open").addEventListener("click", openDialogFile);
$("start-open").addEventListener("click", openDialogFile);
el.btnFiles.addEventListener("click", () => showPanel("files"));
el.btnFavorites.addEventListener("click", () => showPanel("favorites"));
el.btnStar.addEventListener("click", () => toggleFavorite());
el.railToggle.addEventListener("click", () => toggleRail());
el.btnPause.addEventListener("click", togglePause);
el.btnReset.addEventListener("click", resetGame);
el.btnFast.addEventListener("click", toggleFast);
el.btnStateSave.addEventListener("click", () => saveStateTo(slot()));
el.btnStateLoad.addEventListener("click", () => loadStateFrom(slot()));
el.btnMute.addEventListener("click", toggleMute);
$("btn-keys").addEventListener("click", () => openSettings("keys"));
el.btnSettings.addEventListener("click", () => (settings.isOpen() ? settings.close() : openSettings("general")));
$("win-min").addEventListener("click", () => win.minimize());
el.winMax.addEventListener("click", () => win.toggleMaximize());
$("win-close").addEventListener("click", shutdown);

for (const grip of document.querySelectorAll(".grip")) {
  grip.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    win.startResize(grip.dataset.dir).catch(() => {});
  });
}

function setMaximized(maximized) {
  document.documentElement.classList.toggle("is-maximized", maximized);
  el.winMaxIcon.style.setProperty("--icon", `url("/icons/${maximized ? "copy" : "square"}.svg")`);
  el.winMax.title = t(maximized ? "win.restore" : "win.max");
}

onMaximized(setMaximized);
onCloseRequested(shutdown);
onOpenFile((path) => openPath(path));

settings.setup({
  snapshot: settingsSnapshot,
  apply: applySettings,
  setTheme,
  setLang,
  keyName,
  keyOrder: KEY_ORDER,
  defaultKeys: DEFAULT_KEYS,
  onClose: () => {
    syncControls();
    if (state.game?.kind === "frame") focusFrame();
    else el.stage.focus();
  },
  onError: (text) => status(text, "error"),
});

/* ── 시작 ── */

async function boot() {
  state.info = await core.runtimeInfo();
  state.prefs = (await core.prefsGet()) ?? {};
  theme.apply(theme.known(state.prefs.theme?.mode) ? state.prefs.theme : { mode: "dark" });
  await i18n.use(state.prefs.lang ?? "ko");
  if (state.info.settings?.useDevelopKit) {
    window.__WEBGBA_TEST__ = { state, player, settings, i18n, theme, openPath, closeGame, stepGame, saveStateTo, loadStateFrom, openDropped, toggleFavorite, toggleRail, showPanel, toggleLink, refreshLink, hidePaths, openSettings, setLang, shutdown, importSave, exportSave };
  }
  player.setKeys(keysFromPrefs());
  player.setVolume((state.prefs.volume ?? 80) / 100);
  player.setMuted(Boolean(state.prefs.muted));
  player.fastScale = state.prefs.fastScale ?? 4;
  player.fastMute = Boolean(state.prefs.fastMute);
  player.setDpadMode(state.prefs.dpadMode);
  if (state.prefs.panel === undefined) state.prefs.panel = "files";
  setMaximized(await win.isMaximized());
  state.root = state.prefs.lastDir ?? "";
  await loadRoot();
  showView("start");
  syncControls();
  renderPanel();
  await refreshLink();
  status(t("status.ready"));
  if (state.info.launchFile) await openPath(state.info.launchFile);
}

boot().catch((error) => {
  i18n.use("ko").catch(() => {});
  status(t("status.bootFailed", { reason: reason(error) }), "error");
  core.log("ERROR", `시작하지 못했습니다: ${reason(error)}`);
});
