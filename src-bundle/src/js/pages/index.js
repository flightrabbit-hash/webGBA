import { core, win, onCloseRequested, onMaximized, onOpenFile, onOsDrag, onOsFileDrop } from "../bridge.js";
import { bootHost, inspectModule, readEmbeddedRom, readRomPayload, SCREEN_H, SCREEN_W } from "../core/web-host.js";
import { compileCode, gameInfo, problemText, readWgba, screenOf, supportProblem, titleLine, wgbaErrorText } from "../core/wgba-read.js";
import { bootScript } from "../core/script-host.js";
import { readPatch, sha1Hex, WgbpError } from "../core/wgbp.js";
import { ZIP_MAX, zipFile, zipGames, zipName } from "../core/zip.js";
import { openLoader, runPatchJob } from "../app/patch-loader.js";
import { centerTexts, openCountLoader, shownNames, whyText, zipPicker } from "../app/zip-pick.js";
import { createExeUpdater } from "../app/update-exe.js";
import { createAppUpdater } from "../app/update-app.js";
import { ADMIN_APP_API, adminClient, readRecord } from "../core/admin.js";
import { createAdminFlow } from "../app/admin-ui.js";
import { AUTO_FIRE_LEVEL, autoFireLevel, buttonLabel, codeOf, DEFAULT_KEYS, DPAD_DEFAULT, DPAD_MODES, dpadFor, GB_LAYOUT, GBA_LAYOUT, gameDpadPatch, layoutKeys, macroBook, macroOf, normalizeMacro, PAD_CODE_RE, Player } from "../app/player.js";
import { GB_SCREEN, kindKey, romType, systemKind } from "../core/rom-kind.js";
import { resolveInput, sha256Hex } from "../core/wgba-format.js";
import { defaultNick, NetWindow, noticeLevel, noticeText, purposeName } from "../app/net-window.js";
import { BoardPanel, centerBoardInk, centerBoardNodes } from "../app/board-panel.js";
import { errorText, Journal } from "../app/journal.js";
import { APP_API, Signal } from "../core/net/signal.js";
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
  btnAdmin: $("btn-admin"),
  btnStar: $("btn-star"),
  btnStarIcon: $("btn-star-icon"),
  btnPause: $("btn-pause"),
  btnPauseIcon: $("btn-pause-icon"),
  btnReset: $("btn-reset"),
  btnFast: $("btn-fast"),
  btnStateSave: $("btn-state-save"),
  btnStateLoad: $("btn-state-load"),
  btnNet: $("btn-net"),
  btnNetDot: $("btn-net-dot"),
  mpPanel: $("mppanel"),
  btnMute: $("btn-mute"),
  btnMuteIcon: $("btn-mute-icon"),
  btnSettings: $("btn-settings"),
  winMax: $("win-max"),
  winMaxIcon: $("win-max-icon"),
};

const OPEN_EXT = new Set(["gba", "agb", "gb", "gbc", "zip", "wgba", "wasm", "wgbp"]);
const LIST_EXT = new Set(["gba", "gb", "gbc", "wgba", "wasm", "wgbp"]);
const WASM_EXT = new Set(["wgba", "wasm"]);
const PATCH_EXT = "wgbp";
const PATCH_ROM_EXT = ["gba", "agb", "bin", "zip"];
const RECENT_MAX = 10;
const LICENSE_LINE = "webGBA — MIT License, © 2026 flightrabbit";
const BLOG_URL = "https://flightrabbit.tistory.com";

const KEY_ORDER = ["A", "B", "L", "R", "START", "SELECT", "UP", "DOWN", "LEFT", "RIGHT", "FAST"];
// 키 설정 창(과 앱 전체 키 저장)에는 C·D 칸도 둔다 — 설명서가 C·D 를 정의하지 않은 게임·게임 없음에서도 미리 지정할 수 있게(기본 빈 상태,
// 사용자 2026-11-01). 설명서가 C·D 를 정의한 게임은 그 게임의 버튼 목록(keyLayout)을 쓰므로 이 칸은 안 보인다. GBA 게임은 C·D 가 버튼이 아니라 눌러도 입력 비트로 안 간다.
const SETTINGS_KEY_ORDER = [...KEY_ORDER, "C", "D", "RS"];

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
  // 지금 게임의 버튼 목록(resolveInput — 설명서 input, 없으면 GBA 10버튼)
  input: GBA_LAYOUT,
  // 지금 게임 화면 크기(screenOf — 설명서 screen, null = GBA 240×160)와 ② 격리 틀
  screen: null,
  scriptFrame: null,
  stateNote: "",
};

const player = new Player({
  canvas: el.screen,
  onStatus: (text, level) => status(text, level),
  onStatusClear: (text) => clearStatus(text),
  onStats: ({ fps, speed }) => {
    const stats = t("status.stats", { fps: fps.toFixed(1), speed, slot: slot() });
    el.statusRight.textContent = player.net.active ? `${netStatus()} · ${stats}` : stats;
  },
  onHalt: (why, trap) => {
    status(t("status.halted", { reason: why || t("status.haltUnknown") }), "error");
    journal.error("오류", `게임 멈춤 · ${trap ? `코어 trap ${errorText(trap)}` : why || "이유 없음"} · ${state.game?.path ?? ""}`);
    journal.watch(false);
    syncControls();
  },
  onChange: () => syncControls(),
  onNetWant: (request) => netWant(request),
  onNetChange: (snap) => {
    noteHold();
    netWin?.update(snap);
    syncControls();
    queueMp();
    if (snap.hostWait && !mp.clock) mp.clock = setInterval(queueMp, 1000);
    if (!snap.hostWait && mp.clock) {
      clearInterval(mp.clock);
      mp.clock = 0;
    }
  },
  onNetNotice: (info) => {
    const text = noticeText(info);
    if (text) status(text, noticeLevel(info));
    if ((info.kind === "rejoining" || info.kind === "hostWait") && !netLayer && !mp.open) openNet();
  },
  onNetBoard: () => queueMp(),
  netNick: () => netNick(),
  netEnabled: () => state.prefs.netOn !== false,
  hiddenClock: true,
  meter: true,
});

const journal = new Journal(player);
let heldLogged = false;

function noteHold() {
  if (player.netHold === heldLogged) return;
  heldLogged = player.netHold;
  journal.info("실행", heldLogged ? "일시정지 · 멀티플레이 방장 기다림" : "재개 · 멀티플레이 방장 기다림 끝");
}

const shaOf = (bytes) =>
  sha1Hex(bytes)
    .then((hex) => hex.slice(0, 8))
    .catch(() => "?");

const RUNTIME_TEXT = { core: "mGBA 코어", web: "내장 호스트(Web_*)", script: "자체 JS(격리 틀)", frame: "원래 페이지·글루(틀)" };

async function noteOpen(sha) {
  const game = state.game;
  if (!game) return;
  game.openedAt = performance.now();
  const hash = await sha;
  const info = game.info;
  const head = info ? `${info.gameId} ${info.version} · ${titleLine(info, "ko")} · .wgba SHA-1 ${hash} · 빌드 ${info.build.slice(0, 8)}` : `${game.kind === "core" ? romType(game.system).toUpperCase() : "WASM"} · ${game.name} · ${game.kind === "core" ? "롬" : "파일"} SHA-1 ${hash}`;
  journal.info("게임", `열기 · ${head} · runtime ${RUNTIME_TEXT[game.kind] ?? game.kind}${game.romEmbedded ? " · 롬 내장" : game.rom ? ` · 롬 ${game.rom}` : ""} · ${game.path}`);
}

function noteClose(game, why) {
  const ran = game.openedAt ? Math.round((performance.now() - game.openedAt) / 1000) : 0;
  journal.info("게임", `종료 · ${game.info ? `${game.info.gameId} ${game.info.version}` : game.name} · ${Math.floor(ran / 60)}분 ${ran % 60}초 · ${why}`);
}

function syncWatch() {
  journal.watch(player.running && document.visibilityState === "visible");
}

async function webviewVersion() {
  try {
    const list = (await navigator.userAgentData?.getHighEntropyValues(["fullVersionList"]))?.fullVersionList ?? [];
    const hit = list.find((item) => /WebView2/i.test(item.brand)) ?? list.find((item) => /Edge/i.test(item.brand));
    if (hit) return hit.version;
  } catch {}
  return /Edg\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "?";
}

function netNick() {
  let no = state.prefs.netNo;
  if (!/^\d{4}$/.test(String(no ?? ""))) {
    no = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    state.prefs.netNo = no;
    savePrefs({ netNo: no });
  }
  return String(state.prefs.netNick ?? "").trim() || defaultNick(no);
}

const clockText = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function netStatus() {
  const s = player.net.session;
  if (!s || s.closed) return "";
  if (s.rejoining) return t("net.state.rejoining");
  if (!s.open) return t("net.status", { n: s.count, max: s.max, role: s.host ? t("net.roleHost") : t("net.roleGuest", { slot: s.slot + 1 }) });
  const ms = s.memberList().filter((m) => !m.host && Number.isFinite(m.rtt)).map((m) => m.rtt);
  const n = s.max > 1 ? `${s.count}/${s.max}` : s.count;
  const accept = netWin?.acceptState();
  if (accept?.on) return t("net.statusAccept", { n, time: clockText(accept.left) });
  if (accept) return t("net.statusPaused", { n });
  if (player.net.waiting) return t("net.statusWait", { n });
  return ms.length ? t("board.summary", { n, ms: Math.round(Math.max(...ms)) }) : t("board.summaryHost", { n });
}

const node = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};

const NET_ICONS = { people: "users", info: "info-circle", warn: "alert-triangle", refresh: "refresh", copy: "copy", plus: "plus", history: "history" };
const NET_EXE_TEXT = new Set(["net.anytimeNote", "net.accept.off", "net.notice.paused", "net.err.paused", "net.nearFail", "net.nearOffline", "net.err.server", "net.err.limit", "net.join.step1"]);

function netIcon(name) {
  const glyph = node("span", "icon");
  glyph.style.setProperty("--icon", `url("/icons/${NET_ICONS[name] ?? name}.svg")`);
  return glyph;
}

function netButton({ label, kind = "", big = false, block = false, grow = false, small = false, onClick, disabled = false, action = "" }) {
  const b = node("button", `${kind === "primary" ? "btn btn--go" : kind === "danger" ? "btn btn--danger" : kind === "warn" ? "btn btn--warn" : "btn"} net-btn${big ? " net-btn--big" : ""}${block ? " net-btn--block" : ""}${grow ? " net-btn--grow" : ""}${small ? " net-btn--small" : ""}`, label);
  b.type = "button";
  b.disabled = disabled;
  if (action) b.dataset.action = action;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const netKit = {
  touch: false,
  qrSize: 200,
  make: node,
  button: netButton,
  iconButton: ({ icon, title, action, onClick }) => {
    const b = node("button", "iconbtn iconbtn--xs");
    b.type = "button";
    b.dataset.action = action;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.append(netIcon(icon));
    b.addEventListener("click", onClick);
    return b;
  },
  icon: netIcon,
  signal: new Signal({ base: APP_API }),
  label: (code) => ({ copy: "COPY", copyCode: "COPY", qr: "QR", scan: "SCAN", paste: "PASTE", connect: "CONNECT", next: "NEXT", create: "CREATE", makeCode: "CREATE", join: "JOIN", enter: "JOIN", enterCode: "ENTER", offline: "OFFLINE", offlineLong: "OFFLINE", rejoin: "RETRY", solo: "SOLO", renew: "RENEW", nickEdit: "EDIT", nickDone: "OK", retry: "RETRY", home: "BACK", goBack: "RETURN" })[code] ?? code.toUpperCase(),
  action: ({ id, label: name = id, primary = false, danger = false, onClick }) => {
    const b = node("button", primary ? "btn btn--go" : danger ? "btn btn--danger" : "btn", { cancel: "CANCEL", close: "CLOSE", done: "OK", leave: "LEAVE", back: "BACK", closeRoom: "CLOSE ROOM", toGame: "DONE" }[name] ?? name.toUpperCase());
    b.type = "button";
    b.dataset.action = `net-${id}`;
    b.addEventListener("click", onClick);
    return b;
  },
  tabs: (items, active, onPick) => {
    const box = node("div", "net-tabset");
    box.setAttribute("role", "tablist");
    for (const { id, label, action } of items) {
      const b = node("button", "net-tab", label);
      b.type = "button";
      b.dataset.action = action;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(id === active));
      b.addEventListener("click", () => onPick(id));
      box.append(b);
    }
    return box;
  },
  textArea: ({ value = "", readOnly = false, rows = 3, label = "", placeholder = "", action = "", onInput }) => {
    const area = node("textarea", "net-code");
    area.value = value;
    area.rows = rows;
    area.readOnly = readOnly;
    area.spellcheck = false;
    area.setAttribute("aria-label", label);
    if (placeholder) area.placeholder = placeholder;
    if (action) area.dataset.action = action;
    if (readOnly) area.addEventListener("focus", () => area.select());
    if (onInput) area.addEventListener("input", () => onInput(area.value));
    return area;
  },
  textInput: ({ value = "", maxLength = 16, label = "", action = "", numeric = false, onInput, onEnter }) => {
    const input = node("input", numeric ? "cfg__input" : "cfg__input net-nick");
    input.type = "text";
    input.value = value;
    input.maxLength = maxLength;
    input.spellcheck = false;
    if (numeric) input.inputMode = "numeric";
    input.setAttribute("aria-label", label);
    if (action) input.dataset.action = action;
    if (onInput) input.addEventListener("input", () => onInput(input.value));
    if (onEnter) input.addEventListener("keydown", (event) => event.key === "Enter" && onEnter());
    return input;
  },
  nearRow: ({ name, meta, pips = null, dim = false, side = null }) => {
    const li = node("li", `net-near__row${dim ? " is-dim" : ""}`);
    const text = node("span", "net-near__text");
    const line = node("span", "net-near__meta");
    if (pips) line.append(pips);
    line.append(node("span", "", meta));
    text.append(node("span", "net-near__name", name), line);
    li.append(text);
    if (side) li.append(side);
    return li;
  },
  line: (...nodes) => {
    const row = node("div", "net-line");
    row.append(...nodes);
    return row;
  },
  entry: (text, button) => {
    const row = node("div", "net-line net-entry");
    row.append(node("span", "net-entry__label", text), button);
    return row;
  },
  list: (items, className) => {
    const ul = node("ul", className);
    for (const text of items) ul.append(node("li", "", text));
    return ul;
  },
  note: (text) => node("p", "net-note", text),
  step: (text) => node("p", "net-step", text),
  title: (text, chip = "") => {
    const full = chip ? `${text} · ${chip}` : text;
    if (el.dialogTitle.textContent !== full) el.dialogTitle.textContent = full;
  },
  mount: (body, actions) => {
    el.dialogBody.replaceChildren(...body);
    el.dialogActions.replaceChildren(...actions);
    el.dialogActions.hidden = !actions.length;
    centerBoardInk(el.dialogBody);
  },
  notice: (text, level) => status(text, level === "warn" ? "warn" : "info"),
  done: () => closeNetLayer(),
  nick: () => netNick(),
  setNick: (value) => {
    state.prefs.netNick = [...String(value)].slice(0, 12).join("");
    savePrefs({ netNick: state.prefs.netNick });
  },
  tab: () => state.prefs.netTab,
  setTab: (tab) => savePrefs({ netTab: tab }),
  openWindow: () => openNet(),
  awaitAway: true,
  backStore: {
    load: () => state.prefs.netBack ?? null,
    save: (rec) => savePrefs({ netBack: rec }),
    clear: (room) => (!room || state.prefs.netBack?.room === room ? savePrefs({ netBack: null }) : undefined),
  },
  seatStore: {
    load: () => state.prefs.netSeat ?? null,
    save: (rec) => savePrefs({ netSeat: rec }),
    clear: (room) => (!room || state.prefs.netSeat?.room === room ? savePrefs({ netSeat: null }) : undefined),
  },
  textKey: (key) => (NET_EXE_TEXT.has(key) ? key.replace(/^net\./, "net.exe.") : key),
};

const netWin = new NetWindow({ net: player.net, kit: netKit, onClosed: () => syncControls(), onState: () => syncControls() });
let netLayer = false;

const TAB_HOLD_MS = 250;
const mp = { open: false, frame: 0, tabAt: 0, tabOpened: false, clock: 0 };

function mpButton(icon, key, action, onClick) {
  const b = node("button", "iconbtn iconbtn--xs");
  b.type = "button";
  b.dataset.action = action;
  b.dataset.i18nTitle = key;
  b.title = t(key);
  const glyph = node("span", "icon");
  glyph.style.setProperty("--icon", `url("/icons/${icon}.svg")`);
  b.append(glyph);
  b.addEventListener("click", onClick);
  return b;
}

function mpText(key, className, action, onClick) {
  const b = node("button", className, t(key));
  b.type = "button";
  b.dataset.action = action;
  b.dataset.i18n = key;
  b.addEventListener("click", onClick);
  return b;
}

const netClose = mpButton("x", "win.close", "net-x", () => netWin.requestClose());
netClose.classList.add("net-x");
netClose.hidden = true;
el.dialog.append(netClose);

const mpTabKey = node("span", "mpb__key");
mpTabKey.append(node("span", "mpb__tagtext", "Tab"));
const mpTabHint = node("span", "mpb__text mpb__hint");
mpTabHint.dataset.i18n = "board.tabHint";
const mpLeave = netButton({ label: "LEAVE", kind: "danger", grow: true, action: "board-leave", onClick: () => player.net.leave() });
const mpInvite = netButton({ label: "INVITE", grow: true, action: "board-invite", onClick: () => mpToWindow() });
const mpBoard = new BoardPanel({
  root: el.mpPanel,
  head: [mpButton("x", "win.close", "board-close", () => closeMp())],
  actions: [mpLeave, mpInvite],
  invite: mpInvite,
  footHint: [mpTabKey, mpTabHint],
  rejoinButtons: [mpText("net.rejoinNow", "btn btn--go", "board-rejoin", () => player.net.rejoinNow()), mpText("net.solo", "btn btn--danger", "board-solo", () => player.net.solo())],
  textWidth: (text) => {
    const ctx = (mp.ctx ??= document.createElement("canvas").getContext("2d"));
    ctx.font = (mp.font ??= `11px ${getComputedStyle(document.body).fontFamily}`);
    return ctx.measureText(text).width + 2;
  },
});

const mpWanted = () => player.net.connected && (player.net.reached || player.net.session?.role === "join");

function renderMp() {
  mp.frame = 0;
  if (!mp.open) return;
  if (!player.net.active) {
    closeMp();
    return;
  }
  mpTabHint.textContent = t("board.tabHint");
  for (const b of el.mpPanel.querySelectorAll(".mpb__rejoinActions [data-i18n]")) if (b.textContent !== t(b.dataset.i18n)) b.textContent = t(b.dataset.i18n);
  const title = t("board.titleOf", { purpose: purposeName(player.net.request?.purpose) });
  const snap = player.net.snapshot();
  const changed = mpBoard.render({ snap, data: player.net.boardData(), room: netWin.roomCode, title, invite: netWin.canInvite(snap) });
  if (changed?.nodes.length) centerBoardNodes(changed.nodes);
}

function mpInk() {
  centerBoardInk(el.mpPanel);
  cancelAnimationFrame(mp.inkFrame);
  mp.inkFrame = requestAnimationFrame(() => mp.open && centerBoardInk(el.mpPanel));
}

window.addEventListener("resize", () => mp.open && mpInk());

function queueMp() {
  if (mp.open && !mp.frame) mp.frame = requestAnimationFrame(renderMp);
}

function openMp() {
  if (!player.net.active || mp.open) return;
  mp.open = true;
  el.panel.hidden = true;
  el.mpPanel.hidden = false;
  mpBoard.reset();
  player.net.watchBoard(true);
  renderMp();
  layoutScreen();
  mpInk();
  syncControls();
}

function closeMp() {
  if (!mp.open) return;
  mp.open = false;
  mp.tabOpened = false;
  cancelAnimationFrame(mp.frame);
  mp.frame = 0;
  player.net.watchBoard(false);
  el.mpPanel.hidden = true;
  renderPanel();
  syncControls();
}

function mpToWindow() {
  closeMp();
  openNet(player.net.request);
}

function onNetRail() {
  if (mp.open) closeMp();
  else if (mpWanted()) openMp();
  else openNet();
}

function mpTabDown() {
  if (mp.open) {
    closeMp();
    return;
  }
  openMp();
  mp.tabOpened = mp.open;
  mp.tabAt = performance.now();
}

function mpTabUp() {
  if (!mp.tabOpened) return false;
  mp.tabOpened = false;
  if (performance.now() - mp.tabAt >= TAB_HOLD_MS) closeMp();
  return true;
}

function netWant(request) {
  if (!request) {
    if (netLayer) netWin.close();
    syncControls();
    return;
  }
  openNet(request);
}

function openNet(request = player.net.request) {
  const newer = !request && !player.net.active && player.net.newer;
  if (!request && !player.net.active && !newer) return;
  closeMenu();
  player.releaseAll();
  if (settings.isOpen()) settings.close();
  if (!netLayer && !el.layer.hidden) dialogDone?.(null);
  netLayer = true;
  dialogDone = () => netWin.requestClose();
  el.dialog.classList.remove("dialog--wide");
  el.dialog.classList.add("dialog--net");
  netClose.hidden = false;
  el.layer.hidden = false;
  if (newer) netWin.showNewer();
  else netWin.show(request);
}

function closeNetLayer() {
  if (!netLayer) return;
  netLayer = false;
  dialogDone = null;
  el.layer.hidden = true;
  el.dialog.classList.remove("dialog--net");
  el.dialogActions.hidden = false;
  netClose.hidden = true;
  if (state.game?.kind === "frame") focusFrame();
  else el.stage.focus();
}

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

function clearStatus(text) {
  if (text && el.status.textContent === hidePaths(text)) status("");
}

function stateProblem(text, level) {
  state.stateNote = text;
  status(text, level);
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
  for (const name of SETTINGS_KEY_ORDER) keys[name] = Array.isArray(saved[name]) ? saved[name].slice(0, 2) : [...DEFAULT_KEYS[name]];
  return keys;
}

// 키 배치: GBA 10버튼 게임(설명서 없음·preset gba 만)은 앱 전체 값(prefs.keys, 지금 그대로).
// 설명서가 버튼을 정한 게임은 게임 id 별 사용자 배치(prefs.gameKeys[id]) → 설명서 keys → role 기본(GBA role 은 앱 전체 GBA 키).
const savedGameKeys = (input) => (input.gba || !input.gameId ? null : (state.prefs.gameKeys?.[input.gameId] ?? null));
const keysFor = (input = state.input) => layoutKeys(input, keysFromPrefs(), savedGameKeys(input));

const rsKey = () => state.game?.saveId || "";
const rsBook = (input = state.input) => macroBook(input, rsKey() ? state.prefs.rsPresets?.[rsKey()] : null);
const rsSteps = (input = state.input) => macroOf(rsBook(input));

function applyInput(input) {
  state.input = input ?? GBA_LAYOUT;
  player.setLayout(state.input, keysFor(state.input));
  player.setDpadMode(dpadFor(state.input, state.prefs));
  player.setMacro(rsSteps());
}

/** 키 설정 창에 넘길 버튼 목록: 순서·이름·되돌릴 기본 키·안내 글(설명서가 버튼을 정한 게임만). */
function keyLayout(input = state.input) {
  if (input.gba) return null;
  if (input.system === "gb") {
    const order = [...KEY_ORDER.filter((name) => name !== "L" && name !== "R"), "RS"];
    return { order, labels: {}, defaults: Object.fromEntries(order.map((name) => [name, [...DEFAULT_KEYS[name]]])), note: t("cfg.keys.gb") };
  }
  const order = [...input.buttons.map((b) => b.id), "FAST", "RS"];
  const labels = Object.fromEntries(input.buttons.map((b) => [b.id, buttonLabel(b)]));
  return { order, labels, defaults: layoutKeys(input, DEFAULT_KEYS), note: t("cfg.keys.game", { name: state.game?.label || state.game?.name || input.gameId }) };
}

const KEY_CODES = ["ShiftRight", "ShiftLeft", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "Space", "Enter", "Backspace", "Tab", "NumpadEnter"];

function keyName(code) {
  if (!code) return "—";
  const arrows = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code]) return arrows[code];
  const pad = PAD_CODE_RE.exec(code);
  if (pad) return t("cfg.keys.padButton", { n: pad[1] });
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (KEY_CODES.includes(code)) return t(`keyCode.${code}`);
  if (code.startsWith("Numpad")) return t("keyCode.numpad", { key: code.slice(6) });
  return code;
}

/* ── 화면 배치 ── */

const integerScale = () => state.prefs.scaleMode === "integer";

// 게임 화면 크기: 설명서 screen(없으면 GBA 240×160). 배율은 사용자 설정이 정한다(결정 102-15) — 설정 "정수 배율"이면
// 영역에 들어가는 가장 큰 정수 배, 아니면 영역에 맞춤(비율 유지). 설명서 scale "integer" 는 권장일 뿐 설정을 이기지 않는다.
// ② 틀(iframe)도 같은 크기.
const screenSize = () => state.screen ?? { width: SCREEN_W, height: SCREEN_H, integer: false, aspect: [3, 2], stretch: false };

function layoutScreen() {
  const box = el.stage.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const { width: w, height: h, aspect, stretch } = screenSize();
  const shown = stretch ? (h * aspect[0]) / aspect[1] : w;
  const fit = Math.min(box.width / shown, box.height / h);
  const scale = integerScale() && fit >= 1 ? Math.floor(fit) : fit;
  let width = Math.max(1, Math.floor(w * scale));
  let height = Math.max(1, Math.round((width * h) / w));
  if (stretch) {
    height = Math.max(1, Math.floor(h * scale));
    width = Math.max(1, Math.min(Math.floor(box.width), Math.round((height * aspect[0]) / aspect[1])));
  }
  for (const node of [el.screen, state.scriptFrame]) {
    if (!node) continue;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
  }
}

new ResizeObserver(layoutScreen).observe(el.stage);
window.addEventListener("resize", layoutScreen);

function showView(view) {
  el.start.hidden = view !== "start";
  el.screen.hidden = view !== "screen";
  el.frame.hidden = view !== "frame";
  el.stage.classList.toggle("is-game", view !== "start");
  if (view !== "screen" && view !== "script") el.paused.hidden = true;
  if (view === "start") renderStart();
  layoutScreen();
}

const favorites = () => state.prefs.favorites ?? [];
const isFavorite = (path) => favorites().some((item) => samePath(item, path));

function netBlock(node, key, blocked) {
  if (blocked) node.setAttribute("aria-disabled", "true");
  else node.removeAttribute("aria-disabled");
  if (node.dataset.i18nTitle !== key) {
    node.dataset.i18nTitle = key;
    node.title = t(key);
  }
}

function syncControls() {
  const hosted = player.active;
  el.btnAdmin.hidden = !readRecord(state.prefs?.admin);
  el.btnPause.disabled = !hosted;
  el.btnReset.disabled = !state.game || player.net.locked;
  el.btnFast.disabled = !hosted || player.net.locked;
  el.btnStateSave.disabled = !player.canState;
  el.btnStateLoad.disabled = !player.canState;
  const stateBlocked = player.canState && player.net.locked;
  netBlock(el.btnStateSave, stateBlocked ? "rail.stateSaveNet" : "rail.stateSave", stateBlocked);
  netBlock(el.btnStateLoad, stateBlocked ? "rail.stateLoadNet" : "rail.stateLoad", stateBlocked);
  const netLive = hosted && Boolean(player.net.request || player.net.active);
  const netOn = netLive || (hosted && player.net.newer);
  el.btnNet.hidden = !netOn;
  el.btnNet.setAttribute("aria-pressed", String(player.net.active));
  const accept = netWin?.acceptState() ?? null;
  const dotTone = accept ? (accept.on ? "on" : "off") : player.net.waiting ? "wait" : "";
  el.btnNetDot.hidden = !dotTone;
  if ((el.btnNetDot.dataset.tone ?? "") !== dotTone) el.btnNetDot.dataset.tone = dotTone;
  const netLabel = !netLive && player.net.newer ? "net.newer" : accept ? (accept.on ? "net.buttonAccept" : "net.buttonPaused") : mpWanted() ? "board.open" : player.net.waiting ? "net.buttonWait" : "net.button";
  if (el.btnNet.dataset.i18nTitle !== netLabel) {
    el.btnNet.dataset.i18nTitle = netLabel;
    el.btnNet.title = t(netLabel);
  }
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
  else if (player.net.active) el.statusRight.textContent = netStatus();
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

async function readZip(path) {
  if ((await core.fileStat(path)).size > ZIP_MAX) throw new WgbpError("zipTooBig");
  return zipFile(await core.fileReadBytes(path));
}

const ZIP_ROM_MAX = 64 * 1024 * 1024;
const BAD_FILE_CHAR = /[\\/:*?"<>|\u0000-\u001f]/g;
const safeName = (name) => name.replace(BAD_FILE_CHAR, "_").replace(/[. ]+$/, "") || "game";
const sepOf = (path) => (path.includes("\\") ? "\\" : "/");
const zipFolder = (path) => besideOf(path, stemOf(path));

const zipFileName = (game, where) => {
  if (!where) return game.name;
  const dot = game.name.lastIndexOf(".");
  return `${game.name.slice(0, dot)} (${where})${game.name.slice(dot)}`;
};

async function openZip(path) {
  const items = await core.zipList(path);
  const games = zipGames(
    items.map((item) => ({ index: item.index, name: zipName(new Uint8Array(item.raw)), size: item.size, method: item.method, flags: item.encrypted ? 1 : 0 })),
    { romMax: ZIP_ROM_MAX },
  );
  if (!games.length) throw new Error(t("zip.noGame", { name: baseOf(path) }));
  if (games.length > 1) {
    core.log("INFO", `zip 안 게임 ${games.length}개 ${path}`);
    await pickZip(path, games);
    return null;
  }
  const [game] = games;
  if (!WASM_EXT.has(game.ext)) return path;
  if (game.problem) throw new Error(`${game.name}: ${whyText(game.problem)}`);
  const dir = zipFolder(path);
  const target = `${dir}${sepOf(path)}${safeName(game.name)}`;
  const loader = openCountLoader({ title: t("zip.load.unpack"), buttonClass: "btn" });
  loader.set({ fraction: 0, count: t("zip.load.count", { n: 1, total: 1 }), name: game.name });
  let result;
  try {
    result = await core.zipExtract(path, game.entry.index, target, false);
  } finally {
    loader.close();
  }
  if (result === "exists") {
    if (!(await confirmDialog(t("confirm.zipOverwriteTitle"), t("confirm.zipOverwriteOne", { folder: baseOf(dir), name: game.name })))) {
      status(t("status.zipPickCancelled"), "warn");
      return null;
    }
    result = await core.zipExtract(path, game.entry.index, target, true);
  }
  core.log("INFO", `zip 안 ${game.path} → ${target} (${result})`);
  return target;
}

async function pickZip(path, games) {
  const dir = zipFolder(path);
  let ok = null;
  const picker = zipPicker({ games, onChange: (count) => ok && (ok.disabled = count === 0) });
  const asked = openDialog({
    title: t("zip.pick.title", { count: games.length }),
    body: [t("zip.pick.textExe", { name: baseOf(path), folder: baseOf(dir) }), picker.node],
    kind: "pick",
    actions: [
      { label: "CANCEL", value: false },
      { label: "OK", go: true, value: true },
    ],
  });
  ok = el.dialogActions.querySelector(".btn--go");
  ok.disabled = picker.chosen().length === 0;
  picker.center();
  window.addEventListener("resize", picker.center);
  const go = await asked;
  window.removeEventListener("resize", picker.center);
  if (!go) {
    status(t("status.zipPickCancelled"), "warn");
    return;
  }
  await unpackZip(path, dir, picker.chosen());
}

async function unpackZip(path, dir, games) {
  const total = games.length;
  const where = shownNames(games);
  const loader = openCountLoader({ title: t("zip.load.unpack"), cancel: "CANCEL", buttonClass: "btn" });
  const done = [];
  const conflicts = [];
  const failed = [];
  let stopped = false;
  try {
    for (const [index, game] of games.entries()) {
      if (loader.aborted) {
        stopped = true;
        break;
      }
      const name = safeName(zipFileName(game, where[index]));
      const target = `${dir}${sepOf(path)}${name}`;
      const count = t("zip.load.count", { n: index + 1, total });
      loader.set({ fraction: index / total, count, name });
      try {
        const result = await core.zipExtract(path, game.entry.index, target, false);
        if (result === "exists") conflicts.push({ game, target, name });
        else done.push(target);
      } catch (error) {
        failed.push({ name, why: reason(error) });
        core.log("WARN", `zip 안 ${game.path} 풀기 실패 ${path}: ${reason(error)}`);
      }
      loader.set({ fraction: (index + 1) / total, count, name });
    }
  } finally {
    loader.close();
  }
  let kept = 0;
  if (conflicts.length && !stopped) {
    const names = `${conflicts
      .slice(0, 3)
      .map((item) => item.name)
      .join(", ")}${conflicts.length > 3 ? " …" : ""}`;
    const replace = await confirmDialog(t("confirm.zipOverwriteTitle"), t("confirm.zipOverwriteText", { folder: baseOf(dir), count: conflicts.length, names }));
    for (const item of conflicts) {
      if (replace) {
        try {
          await core.zipExtract(path, item.game.entry.index, item.target, true);
        } catch (error) {
          failed.push({ name: item.name, why: reason(error) });
          continue;
        }
      } else kept++;
      done.push(item.target);
    }
  }
  core.log("INFO", `zip 게임 풀기 ${done.length}/${total} → ${dir}${failed.length ? ` · 실패 ${failed.length}` : ""}${stopped ? " · 취소" : ""}`);
  if (done.length) {
    const rest = favorites().filter((item) => !done.some((target) => samePath(target, item)));
    await savePrefs({ favorites: [...rest, ...done] });
    if (state.prefs.panel === "favorites") renderPanel();
    else await showPanel("favorites");
    if (el.start.hidden === false) renderStart();
    syncControls();
  }
  const head = stopped ? t("status.zipStopped", { count: done.length }) : t("status.zipAdded", { count: done.length, folder: baseOf(dir) });
  const tail = failed.length ? t("status.zipFailed", { count: failed.length, name: failed[0].name, reason: failed[0].why }) : "";
  status(join(head, kept ? t("status.zipKept", { count: kept }) : "", tail), failed.length || stopped ? "warn" : "info");
}

function hostLog(level, line) {
  if (level === "error") journal.coreLine(line);
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
  let made = null;
  try {
    if (ext === "zip") {
      const picked = await openZip(path);
      if (!picked) return false;
      path = picked;
      ext = extOf(path);
    }
    await closeGame({ quiet: true, why: "다른 게임 열기" });
    if (ext === PATCH_EXT) {
      made = await makeFromPatch(path, options);
      if (!made) {
        showView("start");
        return false;
      }
      path = made.path;
      ext = extOf(path);
      made.loader?.set("open", 0);
    }
    const ok = WASM_EXT.has(ext) ? await openWasm(path, options) : await openRom(path);
    if (!ok) {
      made?.loader?.close();
      return false;
    }
    made?.loader?.finish();
    if (made?.note) status(join(made.note, el.status.textContent));
    await rememberRecent(path);
    state.root = dirOf(path);
    await loadRoot({ select: path });
    syncControls();
    return true;
  } catch (error) {
    status(t("status.openFailed", { reason: reason(error) }), "error");
    journal.error("게임", `열지 못함 · ${reason(error)} · ${path}`);
    if (!state.game) showView("start");
    if (made?.loader) await made.loader.fail(reason(error), "open");
    return false;
  } finally {
    state.opening = false;
  }
}

async function startHosted(host, game) {
  // 설명서가 있는 .wgba 는 창 제목도 "<이름> <버전>"
  state.game = { ...game, name: baseOf(game.path), title: game.label || (host.title ? `${baseOf(game.path)} · ${host.title}` : baseOf(game.path)) };
  // 설명서의 버튼 목록(없으면 GBA 10버튼 — 키·게임패드 지금 그대로)
  applyInput(game.input ?? null);
  state.screen = game.screen ?? null;
  showView(host.script ? "script" : "screen");
  layoutScreen();
  await player.start({ host, saveId: game.saveId, game: game.path, net: game.net ?? null });
  player.fastScale = state.prefs.fastScale ?? 4;
  player.pushScript();
  syncControls();
  el.stage.focus();
  netWin.offerBack();
  heldLogged = false;
  syncWatch();
}

/** 틀 안 게임에 초점이 있을 때 누른 키(script-host 가 넘김) — 본 창에서 누른 것과 같은 길로. */
function frameKey(event) {
  const fake = { ...event, target: document.body, preventDefault() {}, stopPropagation() {} };
  if (event.type === "keydown") onKeyDown(fake);
  else onKeyUp(fake);
}

// ② 자체 JS(runtime script): 격리 틀에서 돈다. 세이브는 다른 게임처럼 연 파일 옆 <이름>.sav, 퀵슬롯은 빌드 저장 칸.
async function openScript(path, wgba, info, label, sha) {
  const build = await core.webInspect(path, state.prefs.webRom || null, allowsNet(wgba));
  const { save, name } = await openSave(path);
  const input = resolveInput(wgba.manifest);
  state.screen = screenOf(wgba.manifest);
  showView("script");
  const { host, hadSave } = await bootScript({
    wgba,
    input,
    save,
    container: el.stage,
    before: el.start,
    lang: i18n.lang(),
    background: getComputedStyle(document.documentElement).getPropertyValue("--screen-bg").trim() || "#000",
    text: { frame: t("stage.scriptFrame"), tap: t("stage.scriptTap"), navigated: t("status.scriptNavigated"), noRunner: t("status.scriptNoRunner"), exited: t("status.scriptExited") },
    reserved: scriptReserved(),
    log: (level, line) => {
      if (level === "error" || level === "warn") core.log("WARN", `[게임 ${info.gameId}] ${line}`);
    },
    onFrame: (frame) => {
      state.scriptFrame = frame;
      layoutScreen();
    },
    onHostKey: frameKey,
  });
  await startHosted(host, { path, saveId: build.saveId, kind: "script", info, label, input, screen: state.screen, net: { manifest: wgba.manifest, build: wgba.build } });
  status(join(label || baseOf(path), saveNote(hadSave, name)));
  await noteOpen(sha);
  return true;
}

/** 틀에 초점이 있어도 호스트가 먼저 쓰는 키(규격 5.5): 빨리 감기·Tab·Pause·F1~F12. Ctrl·Alt 조합은 틀이 따로 넘김. */
const scriptReserved = () => [...new Set([...(keysFor().FAST ?? []), "Tab", "Pause", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])];

async function openRom(path) {
  const rom = await loadRomBytes(path);
  const sha = shaOf(rom);
  const module = await coreModule();
  const saveId = `gba/${stemOf(path)}`;
  const { save, name } = await openSave(path);
  const { host, hadSave } = await bootHost({ module, rom, save, log: hostLog });
  const system = systemKind(host.system, rom);
  const gb = system.system === "gb";
  await startHosted(host, { path, saveId, kind: "core", system, input: gb ? GB_LAYOUT : null, screen: gb ? GB_SCREEN : null });
  status(join(baseOf(path), gb ? t(kindKey(system)) : "", saveNote(hadSave, name)));
  await noteOpen(sha);
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

const patchNeed = (manifest) =>
  (manifest?.bases ?? [])
    .filter((base) => base.main !== false)
    .map((base) => base.name)
    .join(" · ");

function patchError(error, { file, rom = "", manifest = null }) {
  if (!(error instanceof WgbpError)) return reason(error);
  const p = error.params ?? {};
  const romName = rom ? baseOf(rom) : "";
  return t(`patch.err.${error.code}`, {
    name: baseOf(file),
    rom: romName && p.entry ? t("patch.inZip", { zip: romName, entry: p.entry }) : romName,
    method: p.method ?? "",
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
  const loader = openLoader({ title: t("loader.title", { name: outName }), stages: ["check", "patch", "verify", "pack", "write", "open"], buttonClass: "btn btn--go" });
  loader.set("check", 0);
  let made;
  try {
    const romBytes = extOf(rom) === "zip" ? await readZip(rom) : await loadRomBytes(rom);
    let shown = "";
    made = await runPatchJob(bytes, romBytes, (stage, fraction) => {
      loader.set(stage, fraction);
      if (stage === shown) return;
      shown = stage;
      status(t("status.patchMaking", { name: outName, step: t(`loader.step.${stage}`) }));
    });
  } catch (error) {
    core.log("WARN", `패치로 만들지 못했습니다 ${path} + ${rom}: ${reason(error)}`);
    const text = patchError(error, { file: path, rom, manifest });
    status(t("status.openFailed", { reason: text }), "error");
    await loader.fail(text);
    throw new Error(text);
  }
  loader.set("write", 0);
  status(t("status.patchMaking", { name: outName, step: t("loader.step.write") }));
  let target = out;
  try {
    try {
      await core.fileWriteBytes(target, made.wgba);
    } catch (error) {
      core.log("WARN", `만든 게임을 쓰지 못했습니다 ${target}: ${reason(error)}`);
      const other = await core.pickSave({ title: t("pick.patchOut"), defaultName: outName, defaultExt: "wgba", filters: ["wgba"], filterName: t("pick.gameFilter"), start: dirOf(path) });
      if (!other) throw new Error(t("patch.err.write", { name: outName, reason: reason(error) }));
      await core.fileWriteBytes(other, made.wgba);
      target = other;
    }
  } catch (error) {
    await loader.fail(reason(error), "write");
    throw error;
  }
  loader.set("write", 1);
  core.log("INFO", `패치로 만듦 ${path} + ${rom}${made.entry ? ` (${made.entry})` : ""} → ${target} (${made.base.name}, ${made.wgba.length}바이트, SHA-1 ${made.sha1}${made.same ? "" : ", 기준 SHA-1 과 다름"}, ${Math.round(performance.now() - started)}ms)`);
  return { path: target, loader, note: t("status.patchMade", { name: baseOf(target), base: made.base.name }) };
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

// 설명서에 multiplayer 가 있는 게임만 그 빌드 틀에서 WebRTC·DNS 미리 찾기를 쓸 수 있다(결정 102-3). 그 외(.wasm·폴더 빌드·옛 .wgba)는 막힘.
const allowsNet = (wgba) => Boolean(wgba?.manifest?.multiplayer);

async function openWasm(path, { preferPage = false } = {}) {
  const bytes = await core.fileReadBytes(path);
  if (!isWasmBytes(bytes)) throw new Error(t("status.notWasm", { name: baseOf(path) }));
  const sha = shaOf(bytes);
  // 목차(webgba.toc)가 있는 .wgba: 설명서를 보고 code 조각만 컴파일, 롬은 rom 조각에서. 없으면(옛 .wgba·.wasm) 지금 그대로.
  let wgba = null;
  try {
    wgba = await readWgba(bytes);
  } catch (error) {
    core.log("WARN", `.wgba 목차·설명서를 읽지 못했습니다 ${path}: ${reason(error)}`);
    throw new Error(wgbaErrorText(error));
  }
  const problem = wgba ? supportProblem(wgba.manifest) : null;
  if (problem) throw new Error(problemText(problem));
  const info = wgba ? gameInfo(wgba) : null;
  const label = info ? titleLine(info, i18n.lang()) : "";
  if (wgba?.manifest.runtime === "script") return openScript(path, wgba, info, label, sha);
  const build = await core.webInspect(path, state.prefs.webRom || null, allowsNet(wgba));
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
    module = await (wgba ? compileCode(wgba.code) : WebAssembly.compile(bytes));
  } catch (error) {
    throw new Error(t("status.wasmUnreadable", { reason: reason(error) }));
  }
  const report = inspectModule(module);
  const unknownWhy = () => (report.unknown.length ? t("status.unknownImports", { list: `${report.unknown.slice(0, 3).join(", ")}${report.unknown.length > 3 ? " …" : ""}` }) : "");
  if (wgba && !report.usable) throw new Error(t("wgba.badImports", { why: unknownWhy() }));
  const embedded = wgba ? (wgba.romPayload ? await readRomPayload(wgba.romPayload) : null) : await readEmbeddedRom(module);
  const romEmbedded = Boolean(embedded);
  // 롬 없는 ① 게임(설명서 rom.required: false)
  const romless = Boolean(wgba) && !romEmbedded && wgba.manifest.rom?.required === false;
  const romNote = (rom) => (romEmbedded ? t("status.romEmbedded") : rom ? t("status.romUsed", { name: baseOf(rom) }) : "");
  if (report.usable && (wgba || !(preferPage && build.page))) {
    const rom = romEmbedded || romless ? null : await resolveWebRom(build, true);
    if (!romEmbedded && !romless && !rom) {
      status(t("status.noRomPicked"), "warn");
      showView("start");
      return false;
    }
    if (rom) await core.webSetRom(build.key, rom);
    const { save, name } = await openSave(path);
    const screen = wgba ? screenOf(wgba.manifest) : null;
    const { host, hadSave } = await bootHost({ module, rom: romEmbedded ? embedded.rom : rom ? await loadRomBytes(rom) : null, save, log: hostLog, screen });
    await startHosted(host, { path, saveId: build.saveId, kind: "web", build, rom, romEmbedded, info, label, input: wgba ? resolveInput(wgba.manifest) : null, screen, net: { manifest: wgba?.manifest ?? null, build: wgba ? wgba.build : report.canNet ? await sha256Hex(bytes) : "" } });
    status(join(label || baseOf(path), romNote(rom), saveNote(hadSave, name)));
    await noteOpen(sha);
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
    await noteOpen(sha);
    return true;
  }
  throw new Error(t("status.needsGlue", { why: unknownWhy() }));
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

async function closeGame({ quiet = false, why = "닫기" } = {}) {
  if (!state.game) return "";
  const game = state.game;
  journal.watch(false);
  if (player.active) await player.stop();
  noteClose(game, why);
  if (game.kind === "frame") el.frame.src = "about:blank";
  state.game = null;
  state.screen = null;
  state.scriptFrame = null;
  state.autoPaused = false;
  if (!state.input.gba || state.input.dpad) applyInput(null);
  player.setMacro([]);
  showView("start");
  syncControls();
  renderPanel();
  if (!quiet) status(t("status.closed"));
}

async function openDialogFile() {
  const start = state.game ? dirOf(state.game.path) : state.prefs.lastDir;
  const path = await core.pickFile({ title: t("pick.open"), filters: ["gba", "gb", "gbc", "wgba", "wgbp", "wasm", "zip", "agb"], filterName: t("pick.gameFilter"), start });
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
  if (updater.pending(item.path)) {
    const update = document.createElement("button");
    update.type = "button";
    update.className = "btn btn--go row__upd";
    update.dataset.action = "update";
    const label = Object.assign(document.createElement("span"), { className: "upick__label", textContent: t("update.btn.one") });
    update.append(label);
    requestAnimationFrame(() => centerTexts([label]));
    update.addEventListener("click", (event) => {
      event.stopPropagation();
      openUpdate(item.path);
    });
    update.addEventListener("dblclick", (event) => event.stopPropagation());
    row.append(update);
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
  el.panel.hidden = !panel || mp.open;
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
  if (mp.open) closeMp();
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

async function toggleFavorite(path = state.game?.path, on = path ? !isFavorite(path) : false, { quiet = false } = {}) {
  if (!path) return;
  const list = favorites().filter((item) => !samePath(item, path));
  if (on) list.push(path);
  await savePrefs({ favorites: list });
  syncControls();
  renderPanel();
  if (el.start.hidden === false) renderStart();
  if (!quiet) status(t(on ? "status.starred" : "status.unstarred", { name: baseOf(path) }));
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

function openDialog({ title, body, actions, wide = false, kind = "" }) {
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
    el.dialog.dataset.kind = kind;
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
  const keys = keysFor();
  const list = document.createElement("dl");
  list.className = "help";
  // 설명서가 버튼을 정한 게임이면 그 게임의 버튼만(설명서 label)
  const order = state.input.gba ? KEY_ORDER : state.input.system === "gb" ? KEY_ORDER.filter((name) => name !== "L" && name !== "R") : [...state.input.buttons.map((b) => b.id), "FAST"];
  const nameOf = (id) => {
    const b = state.input.gba ? null : state.input.buttons.find((x) => x.id === id);
    return b ? buttonLabel(b) : t(`key.${id}`);
  };
  const rows = [
    ...order.map((name) => [nameOf(name), (keys[name] ?? []).map(keyName).join(" · ") || "—"]),
    [t("help.fastToggle"), "Tab"],
    [t("help.netBoard"), "Tab"],
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
  const lead = Object.assign(document.createElement("p"), { className: "dialog__lead", textContent: `webGBA V${state.info?.version ?? ""}${appUpdater.pending ? ` · ${t("appUpdate.infoNew", { version: appUpdater.pending.to })}` : ""}` });
  const blog = Object.assign(document.createElement("p"), { className: "dialog__link" });
  const blogLink = Object.assign(document.createElement("a"), { href: BLOG_URL, textContent: BLOG_URL });
  blogLink.addEventListener("click", (event) => {
    event.preventDefault();
    core.openLink(BLOG_URL).catch((error) => status(reason(error), "error"));
  });
  blog.append(Object.assign(document.createElement("span"), { textContent: `${t("info.blog")} ` }), blogLink);
  const sub = Object.assign(document.createElement("p"), { className: "dialog__sub", textContent: t("info.openSource") });
  // 설명서가 있는 .wgba 를 열고 있으면 그 게임: 이름·버전·id·만든 이·빌드 앞 8자리
  const game = state.game?.info;
  const gameLines = game
    ? [
        Object.assign(document.createElement("p"), { className: "dialog__lead", textContent: t("info.game", { name: state.game.label }) }),
        t("info.gameMeta", { id: game.gameId, author: game.author || "-", build: game.build.slice(0, 8) }),
        updater.pending(state.game.path) ? t("update.info.new", { version: updater.pending(state.game.path).to }) : "",
      ].filter(Boolean)
    : [];
  await openDialog({
    title: t("info.title"),
    wide: true,
    body: [
      ...gameLines,
      lead,
      LICENSE_LINE,
      blog,
      t("info.about"),
      sub,
      t("info.mgba"),
      t("info.mgbaSource"),
      t("info.others"),
      pre,
    ],
    actions: [...(appUpdater.pending ? [{ label: "UPDATE", run: () => appUpdater.open() }] : []), { label: "CLOSE", go: true, value: null }],
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
    autoFire: player.autoFire.on,
    autoFireLevel: player.autoFire.level,
    slot: slot(),
    netOn: state.prefs.netOn !== false,
    netNick: String(state.prefs.netNick ?? ""),
    wgbaLink: state.link.linked,
    webRom: state.prefs.webRom ?? "",
    favorites: [...favorites()],
    recent: [...(state.prefs.recent ?? [])],
    useDevelopKit: Boolean(ini.useDevelopKit),
    keys: keysFor(),
    keyLayout: keyLayout(),
    rs: state.game
      ? {
          book: rsBook(),
          fallback: state.input.rs ?? null,
          slots: state.input.buttons.map((b) => b.role?.toUpperCase()).filter(Boolean),
        }
      : null,
    theme: state.prefs.theme ?? { mode: "dark", colors: {} },
  };
}

const SETTING_HIDDEN = new Set(["netNick", "webRom", "favorites", "recent", "keys", "gameKeys", "rsPresets"]);

function settingChanges(patch, before) {
  const out = [];
  for (const [key, value] of Object.entries(patch)) {
    const old = before[key];
    if (JSON.stringify(old ?? null) === JSON.stringify(value ?? null)) continue;
    out.push(SETTING_HIDDEN.has(key) || typeof value === "object" ? `${key} 바뀜` : `${key} ${old ?? "기본"} → ${value}`);
  }
  return out;
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
    autoFire: next.autoFire === true,
    autoFireLevel: autoFireLevel(next.autoFireLevel),
    slot: next.slot,
    netOn: next.netOn !== false,
    netNick: [...String(next.netNick ?? "").trim()].slice(0, 12).join(""),
    webRom: String(next.webRom ?? "").trim(),
    favorites: next.favorites,
    recent: next.recent,
    keys: next.keys,
  };
  const input = state.input;
  if (input.system === "gb") patch.keys = { ...keysFromPrefs(), ...next.keys };
  if (!input.gba && input.gameId) {
    // 설명서가 버튼을 정한 게임: 버튼 키는 그 게임 id 에만, 빨리 감기(호스트 몫)는 앱 전체. 기본과 같으면 기록하지 않음.
    patch.keys = { ...keysFromPrefs(), FAST: next.keys.FAST ?? [], RS: next.keys.RS ?? [] };
    const own = Object.fromEntries(input.buttons.map((b) => [b.id, next.keys[b.id] ?? []]));
    const plain = layoutKeys(input, patch.keys);
    const same = input.buttons.every((b) => own[b.id].join() === (plain[b.id] ?? []).join());
    const gameKeys = { ...(state.prefs.gameKeys ?? {}) };
    if (same) delete gameKeys[input.gameId];
    else gameKeys[input.gameId] = own;
    patch.gameKeys = gameKeys;
  }
  const dpadPatch = gameDpadPatch(input, state.prefs, patch.dpadMode);
  if (dpadPatch) Object.assign(patch, dpadPatch, { dpadMode: DPAD_MODES.includes(state.prefs.dpadMode) ? state.prefs.dpadMode : DPAD_DEFAULT });
  if (next.rs?.changed && rsKey()) {
    const { active, slots } = next.rs.book;
    patch.rsPresets = { ...(state.prefs.rsPresets ?? {}), [rsKey()]: { active, slots: slots.map((slot) => slot && { name: slot.name, steps: normalizeMacro(slot.steps) }) } };
  }
  const changed = settingChanges(patch, state.prefs);
  await core.prefsSet(patch);
  Object.assign(state.prefs, patch);
  player.net.syncEnabled();

  const ini = state.info?.settings ?? {};
  const iniPatch = {};
  for (const key of ["pauseWhenHidden", "useDevelopKit"]) {
    if (Boolean(next[key]) !== Boolean(ini[key])) iniPatch[key] = Boolean(next[key]);
  }
  for (const [key, value] of Object.entries(iniPatch)) changed.push(`${key} ${!value} → ${value}`);
  if (Boolean(next.wgbaLink) !== state.link.linked) changed.push(`wgbaLink ${state.link.linked} → ${Boolean(next.wgbaLink)}`);
  if (changed.length) journal.info("설정", `저장 · ${changed.join(" · ")}`);
  if (Object.keys(iniPatch).length) state.info.settings = await core.settingsSave(iniPatch);

  if (Boolean(next.wgbaLink) !== state.link.linked) {
    state.link = await core.assocSet(Boolean(next.wgbaLink));
    state.prefs.wgbaLink = Boolean(next.wgbaLink);
  }

  player.setKeys(keysFor());
  player.setMacro(rsSteps());
  player.setVolume(next.volume / 100);
  player.setMuted(Boolean(next.muted));
  player.fastScale = next.fastScale;
  player.fastMute = patch.fastMute;
  player.setDpadMode(dpadFor(state.input, state.prefs));
  player.setAutoFire({ on: patch.autoFire, level: patch.autoFireLevel });
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
  if (state.game?.info && state.game.title === state.game.label) state.game.title = state.game.label = titleLine(state.game.info, next);
  refreshTexts();
  status(t("status.langChanged"));
}

function refreshTexts() {
  syncControls();
  renderPanel();
  mp.font = null;
  if (mp.open) {
    mpBoard.reset();
    renderMp();
    mpInk();
  }
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
  if (player.net.locked) {
    stateProblem(t("net.blockQuick"), "warn");
    return;
  }
  if (!player.canState) {
    stateProblem(t("status.noStateSupport"), "warn");
    return;
  }
  const begin = performance.now();
  player.lastStateSize = 0;
  try {
    if (await player.saveState(index)) {
      await rememberSlot(index);
      clearStatus(state.stateNote);
      noteState("저장", index, "성공", begin);
    } else {
      stateProblem(t("status.stateSaveFailed"), "error");
      noteState("저장", index, "실패(게임이 상태를 주지 않음)", begin);
    }
  } catch (error) {
    stateProblem(t("status.stateSaveFailedWhy", { reason: reason(error) }), "error");
    noteState("저장", index, `실패 ${reason(error)}`, begin);
  }
}

function noteState(action, index, result, begin) {
  const size = player.lastStateSize ? ` · ${Math.ceil(player.lastStateSize / 1024)}KB` : "";
  const line = `${action} ${index}번 · ${result}${size} · ${Math.round(performance.now() - begin)}ms`;
  if (result.startsWith("실패")) journal.warn("퀵슬롯", line);
  else journal.info("퀵슬롯", line);
}

async function loadStateFrom(index) {
  if (player.net.locked) {
    status(t("net.blockQuick"), "warn");
    return;
  }
  if (!player.canState) {
    status(t("status.noStateSupport"), "warn");
    return;
  }
  const saved = slotVersion(index);
  if (saved && gameVersion() && saved !== gameVersion()) {
    status(t("update.quick.other", { slot: t("update.quick.slot", { n: index }), saved, now: gameVersion() }), "warn");
    return;
  }
  const begin = performance.now();
  player.lastStateSize = 0;
  try {
    const result = await player.loadState(index);
    if (result === null) status(t("status.stateEmpty", { slot: index }), "warn");
    else if (result) status(t("status.stateLoaded", { slot: index }));
    else status(t("status.stateLoadFailed"), "error");
    noteState("불러오기", index, result === null ? "빈 칸" : result ? "성공" : "실패(게임이 상태를 받지 않음)", begin);
  } catch (error) {
    status(t("status.stateLoadFailedWhy", { reason: reason(error) }), "error");
    noteState("불러오기", index, `실패 ${reason(error)}`, begin);
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
  if (player.active) {
    journal.watch(false);
    await player.stop();
    noteClose(game, "세이브 가져오기");
  }
  const done = await core.saveImport(game.path, path);
  journal.info("세이브", `가져오기 ${path} → ${done.path}`);
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

function togglePause(source) {
  if (!player.active) return;
  player.setPaused(!player.paused);
  state.autoPaused = false;
  journal.info("실행", `${player.paused ? "일시정지" : "재개"} · 사용자(${source})`);
  syncControls();
  status(t(player.paused ? "status.paused" : "status.resumed"));
}

function toggleFast() {
  if (player.net.locked) {
    status(t("net.blockSpeed"), "warn");
    return;
  }
  if (!player.active) return;
  player.setFast(!player.fast);
  journal.info("실행", player.fast ? `빨리 감기 켬 · ${player.fastScale}배` : "빨리 감기 끔 · 1배");
  syncControls();
  status(player.fast ? t("status.fastOn", { scale: player.fastScale }) : t("status.fastOff"));
}

async function resetGame() {
  if (player.net.locked) {
    status(t("net.blockReset"), "warn");
    return;
  }
  if (!state.game) return;
  if (!(await confirmDialog(t("confirm.resetTitle"), t("confirm.resetText")))) return;
  journal.info("게임", `다시 시작 · ${state.game.info ? `${state.game.info.gameId} ${state.game.info.version}` : state.game.name}`);
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
    await netWin.pageHide();
    settings.close();
    await closeGame({ quiet: true, why: "앱 종료" });
  } finally {
    await core.logFlush();
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
      { label: t(player.paused ? "menu.resume" : "menu.pause"), keys: "Pause", run: () => togglePause("메뉴"), disabled: !hosted },
      { label: t("menu.reset"), keys: "Ctrl+R", run: resetGame, disabled: !game || player.net.locked },
      player.net.active ? { label: t("board.open"), keys: "Tab", run: () => (mp.open ? closeMp() : openMp()), disabled: !mpWanted(), checked: mp.open } : { label: t("menu.fast"), keys: "Tab", run: toggleFast, disabled: !hosted || player.net.locked, checked: player.fast },
      { sep: true },
      { label: t("menu.stateSave", { slot: slot() }), keys: `Shift+F${slot()}`, run: () => saveStateTo(slot()), disabled: !player.canState, blocked: player.net.locked },
      { label: t("menu.stateLoad", { slot: slot() }), keys: `F${slot()}`, run: () => loadStateFrom(slot()), disabled: !player.canState, blocked: player.net.locked },
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
      { label: t("menu.openLogDir"), run: () => core.revealPath(state.info.logDir) },
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
    if (item.blocked && !item.disabled) {
      button.setAttribute("aria-disabled", "true");
      button.title = t("net.blockQuick");
    }
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
    togglePause("Pause 키");
    return true;
  }
  if (event.key === "Tab" && player.active) {
    if (player.net.active) {
      if (!event.repeat) mpTabDown();
    } else toggleFast();
    return true;
  }
  return false;
}

function onKeyDown(event) {
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
    if (player.active && !typingTarget(event.target)) player.keyDown(code, event);
    return;
  }
  if (hotkey(event)) {
    event.preventDefault();
    return;
  }
  if (typingTarget(event.target)) return;
  if (player.active) {
    if (player.keyDown(code, event)) event.preventDefault();
  } else if (el.panelList.contains(event.target)) {
    return;
  } else if (state.game?.kind === "frame") {
    forwardKey(event);
    event.preventDefault();
  }
}

function onKeyUp(event) {
  const code = codeOf(event);
  if (event.key === "Tab" && mpTabUp()) {
    event.preventDefault();
    return;
  }
  if (player.active) {
    if (player.keyUp(code, event)) event.preventDefault();
  } else if (state.game?.kind === "frame" && el.layer.hidden && !settings.isOpen()) forwardKey(event);
}

document.addEventListener("keydown", onKeyDown, true);
document.addEventListener("keyup", onKeyUp, true);

let hiddenAt = 0;

document.addEventListener("visibilitychange", () => {
  if (document.hidden) player.releaseAll();
  syncWatch();
  if (!player.active) return;
  if (document.hidden) {
    hiddenAt = performance.now();
    journal.info("실행", `창 숨김(최소화·가려짐) · ${player.clockOn ? "멀티플레이 중이라 숨긴 창 시계로 계속" : "화면 갱신 멈춤"}`);
  } else if (hiddenAt) {
    journal.info("실행", `창 다시 보임 · ${((performance.now() - hiddenAt) / 1000).toFixed(1)}초 숨김`);
    hiddenAt = 0;
  }
});

window.addEventListener("pagehide", () => {
  journal.watch(false);
  netWin.pageHide();
});

window.addEventListener("error", (event) => journal.fault("예외", event.error ?? event.message, event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : ""));
window.addEventListener("unhandledrejection", (event) => journal.fault("처리되지 않은 Promise 오류", event.reason));

// ② 게임 틀을 눌러 초점이 틀로 가도 본 창 blur 가 온다 — 그때는 키를 놓거나 멈추지 않는다(틀이 키를 넘겨줌)
const focusInScript = () => Boolean(state.scriptFrame) && document.activeElement === state.scriptFrame;

let focusLost = false;

window.addEventListener("blur", () => {
  if (focusInScript()) return;
  player.releaseAll();
  if (player.active && !focusLost) {
    focusLost = true;
    journal.info("실행", "창 초점 잃음 · 누른 키 모두 놓음");
  }
  if (state.info?.settings?.pauseWhenHidden && player.active && !player.paused && !player.net.request && !player.net.active) {
    player.setPaused(true);
    state.autoPaused = true;
    journal.info("실행", "일시정지 · 창 초점 잃음(설정 pauseWhenHidden)");
    syncControls();
  }
});

window.addEventListener("focus", () => {
  if (focusLost) {
    focusLost = false;
    if (player.active) journal.info("실행", "창 초점 돌아옴");
  }
  if (state.autoPaused && player.active) {
    player.setPaused(false);
    state.autoPaused = false;
    journal.info("실행", "재개 · 창 초점 돌아옴(설정 pauseWhenHidden)");
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
    journal.fault("웹 빌드 오류", data.message, state.game.path);
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
el.btnAdmin.addEventListener("click", () => admin.importRoms());
el.btnStar.addEventListener("click", () => toggleFavorite());
el.railToggle.addEventListener("click", () => toggleRail());
el.btnPause.addEventListener("click", () => togglePause("버튼"));
el.btnReset.addEventListener("click", resetGame);
el.btnFast.addEventListener("click", toggleFast);
el.btnStateSave.addEventListener("click", () => saveStateTo(slot()));
el.btnStateLoad.addEventListener("click", () => loadStateFrom(slot()));
for (const node of [el.btnStateSave, el.btnStateLoad]) node.addEventListener("mousedown", (event) => node.getAttribute("aria-disabled") === "true" && event.preventDefault());
el.btnNet.addEventListener("click", onNetRail);
el.statusRight.addEventListener("click", () => {
  if (mpWanted() && !mp.open) openMp();
});
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
  confirm: (title, text, ok) => openDialog({ title, body: text, actions: [{ label: "CANCEL", value: false }, { label: ok, go: true, value: true }] }).then(Boolean),
  keyOrder: SETTINGS_KEY_ORDER,
  defaultKeys: DEFAULT_KEYS,
  adminOn: () => admin.isOn(),
  adminToggle: () => (admin.isOn() ? admin.leave() : admin.enter()),
  vars: (key) => (key === "netNick" ? { name: (netNick(), defaultNick(state.prefs.netNo)) } : {}),
  placeholder: (key) => (key === "netNick" ? (netNick(), defaultNick(state.prefs.netNo)) : undefined),
  hint: (key) => (key === "admin" ? adminHint() : key === "dpadMode" && state.input.dpad ? t("cfg.dpadMode.game", { name: state.game?.label || state.game?.name || state.input.gameId, value: t(`cfg.dpadMode.${state.input.dpad}`) }) : undefined),
  onClose: () => {
    syncControls();
    if (state.game?.kind === "frame") focusFrame();
    else el.stage.focus();
  },
  onError: (text) => status(text, "error"),
});

/* ── 온라인 업데이트 ── */

const gameVersion = () => state.game?.info?.version ?? "";
const slotVersion = (index) => (state.game?.saveId ? state.prefs.slotVersions?.[state.game.saveId]?.[index] ?? "" : "");

async function rememberSlot(index) {
  const id = state.game?.saveId;
  if (!id) return;
  const all = { ...(state.prefs.slotVersions ?? {}) };
  const own = { ...(all[id] ?? {}) };
  if (gameVersion()) own[index] = gameVersion();
  else delete own[index];
  all[id] = own;
  await savePrefs({ slotVersions: all });
}

const updateCache = new Map();

const appUpdater = createAppUpdater({
  t,
  core,
  el,
  log: (level, text) => core.log(level, text),
  info: () => state.info,
  testMode: () => Boolean(state.info?.settings?.useDevelopKit),
  cache: updateCache,
  openDialog,
  gameOpen: () => Boolean(state.game),
  closeGame: () => closeGame({ why: "webGBA 업데이트" }),
  shutdown: () => shutdown(),
});

const updater = createExeUpdater({
  t,
  core,
  el,
  cache: updateCache,
  log: (level, text) => core.log(level, text),
  status,
  lang: () => i18n.lang(),
  baseOf,
  prefs: () => state.prefs,
  savePrefs,
  openDialog,
  testMode: () => Boolean(state.info?.settings?.useDevelopKit),
  running: (path) => Boolean(state.game && samePath(state.game.path, path)),
  closeGame: () => closeGame(),
  pickRom: (item) => core.pickFile({ title: t("pick.patchRom", { title: item.name }), filters: PATCH_ROM_EXT, filterName: t("pick.romFilter"), start: dirOf(item.path) }),
  readRom: (rom) => (extOf(rom) === "zip" ? readZip(rom) : loadRomBytes(rom)),
  patchText: (error, rom) => patchError(error, { file: "", rom }),
  refresh: () => {
    renderPanel();
    if (!el.start.hidden) renderStart();
  },
});

/* ── 관리자 모드 롬 가져오기 ── */

// 시험 exe(개발 키트)만 다른 서버 주소: localStorage webgba.adminTest = {"base": "http://127.0.0.1:…/api/v1/admin/"}
function adminBase() {
  if (!state.info?.settings?.useDevelopKit) return ADMIN_APP_API;
  try {
    return JSON.parse(localStorage.getItem("webgba.adminTest") || "null")?.base || ADMIN_APP_API;
  } catch {
    return ADMIN_APP_API;
  }
}

function adminHint() {
  const rec = readRecord(state.prefs.admin);
  if (!rec) return t("cfg.admin.note");
  const d = new Date(rec.at);
  const pad2 = (n) => String(n).padStart(2, "0");
  return t("cfg.admin.on", { date: `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
}

const admin = createAdminFlow({
  get client() {
    return adminClient({ base: adminBase() });
  },
  load: () => state.prefs.admin ?? null,
  save: (rec) => savePrefs({ admin: rec ?? null }),
  dialog: ({ title, body, kind, actions }) => {
    const done = openDialog({ title, body, kind, actions: actions.map((action) => ({ label: action.label, value: action.value, go: action.primary, run: action.run })) });
    return { done, buttons: [...el.dialogActions.children] };
  },
  closeDialog: (value) => dialogDone?.(value),
  labels: { ok: "OK", cancel: "CANCEL", close: "CLOSE", get: "DOWNLOAD" },
  get listText() {
    return t("admin.list.textExe");
  },
  allText: (count) => t("admin.emptyAllExe", { count }),
  icon,
  notify: (text, level = "info") => status(text, level),
  changed: () => syncControls(),
  registeredIds: async () => {
    let inApp = [];
    try {
      inApp = (await core.fileList(state.info.appDir)).filter((item) => !item.isDir && item.extension === "wgba").map((item) => item.path);
    } catch {}
    return updater.ids([...updatePaths(), ...inApp]);
  },
  download: async (game, url, onFraction) => {
    const path = await core.adminFetch(url, game.file, game.size, ({ done, total }) => onFraction(total ? done / total : 0));
    if (!isFavorite(path)) await toggleFavorite(path, true, { quiet: true });
    core.log("INFO", `롬 가져오기 → ${path}`);
  },
  refresh: () => {
    renderPanel();
    if (!el.start.hidden) renderStart();
  },
  lang: () => i18n.lang(),
  log: (level, text) => core.log(level, text),
});

function openUpdate(path) {
  const item = updater.pending(path);
  if (!item || updater.showing) return;
  updater.open([item.key], { start: item.kind === "patch" && !(state.game && samePath(state.game.path, path)) });
}

const updatePaths = () => [...favorites(), ...(state.prefs.recent ?? []), ...state.entries];

const autoUpdate = () => !(state.info?.settings?.useDevelopKit && state.prefs?.updateCheck === false);

async function checkUpdates() {
  if (!autoUpdate()) return;
  if (await appUpdater.check()) await appUpdater.open();
  await updater.check(updatePaths());
}

/* ── 시작 ── */

async function boot() {
  state.info = await core.runtimeInfo();
  state.prefs = (await core.prefsGet()) ?? {};
  if (autoUpdate()) {
    updater.prepare();
    appUpdater.prepare();
  }
  theme.apply(theme.known(state.prefs.theme?.mode) ? state.prefs.theme : { mode: "dark" });
  await i18n.use(state.prefs.lang ?? "ko");
  if (state.info.settings?.useDevelopKit) {
    window.__WEBGBA_TEST__ = { state, player, settings, i18n, theme, updater, appUpdater, openPath, closeGame, stepGame, saveStateTo, loadStateFrom, openDropped, toggleFavorite, toggleRail, showPanel, toggleLink, refreshLink, hidePaths, openSettings, setLang, shutdown, importSave, exportSave, showInfo, netWin };
  }
  player.setKeys(keysFromPrefs());
  player.setVolume((state.prefs.volume ?? 80) / 100);
  player.setMuted(Boolean(state.prefs.muted));
  player.fastScale = state.prefs.fastScale ?? 4;
  player.fastMute = Boolean(state.prefs.fastMute);
  player.setDpadMode(state.prefs.dpadMode);
  player.setAutoFire({ on: state.prefs.autoFire === true, level: state.prefs.autoFireLevel ?? AUTO_FIRE_LEVEL });
  webviewVersion().then((version) => journal.info("앱", `화면 준비 · WebView2 ${version} · CPU ${navigator.hardwareConcurrency ?? "?"}개 · 화면 ${screen.width}×${screen.height} 배율 ${devicePixelRatio} · 언어 ${i18n.lang()} · pauseWhenHidden ${Boolean(state.info.settings?.pauseWhenHidden)}`));
  if (state.prefs.panel === undefined) state.prefs.panel = "files";
  setMaximized(await win.isMaximized());
  state.root = state.prefs.lastDir ?? "";
  await loadRoot();
  showView("start");
  syncControls();
  renderPanel();
  await refreshLink();
  status(t("status.ready"));
  if (state.info.updatedFrom) {
    status(t("appUpdate.done", { version: state.info.version }));
    journal.info("앱", `webGBA 업데이트 뒤 첫 실행 · ${state.info.updatedFrom} → ${state.info.version}`);
    core.appUpdateFinish().catch((error) => core.log("WARN", `지난 업데이트 파일 정리 실패: ${reason(error)}`));
  }
  if (state.info.launchFile) await openPath(state.info.launchFile);
  checkUpdates().catch((error) => core.log("WARN", `업데이트 확인 실패: ${reason(error)}`));
}

boot().catch((error) => {
  i18n.use("ko").catch(() => {});
  status(t("status.bootFailed", { reason: reason(error) }), "error");
  journal.error("앱", `화면을 시작하지 못함 · ${errorText(error)}`);
});
