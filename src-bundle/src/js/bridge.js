const tauri = window.__TAURI__;
const invoke = (cmd, args, options) => tauri.core.invoke(cmd, args, options);

const bytesOf = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

const LOG_FLUSH_MS = 250;
const LOG_QUEUE_MAX = 2000;
const logQueue = [];
let logTimer = 0;
let logDropped = 0;

function sendLog(beat) {
  clearTimeout(logTimer);
  logTimer = 0;
  if (logDropped) {
    logQueue.push({ level: "WARN", text: `[기록] 화면 쪽 대기 줄이 넘쳐 ${logDropped}줄 버림`, at: Date.now() });
    logDropped = 0;
  }
  const lines = logQueue.splice(0, logQueue.length);
  if (!lines.length && beat === undefined) return Promise.resolve();
  return invoke("log_lines", { lines, beat }).catch(() => {});
}

function queueLog(level, text) {
  if (logQueue.length >= LOG_QUEUE_MAX) logDropped++;
  else logQueue.push({ level, text: String(text), at: Date.now() });
  if (!logTimer) logTimer = setTimeout(sendLog, LOG_FLUSH_MS);
  return Promise.resolve();
}

export const core = {
  runtimeInfo: () => invoke("runtime_info"),
  prefsGet: () => invoke("prefs_get"),
  prefsSet: (patch) => invoke("prefs_set", { patch }),
  settingsSave: (patch) => invoke("settings_save", { patch }),
  langSet: (lang) => invoke("lang_set", { lang }),
  fileList: (path) => invoke("file_list", { path }),
  fileStat: (path) => invoke("file_stat", { path }),
  fileReadBytes: async (path) => bytesOf(await invoke("file_read_bytes", { path })),
  fileWriteBytes: (path, bytes) => invoke("file_write_bytes", bytes, { headers: { "x-path": encodeURIComponent(path) } }),
  romRead: async (path) => bytesOf(await invoke("rom_read", { path })),
  zipList: (path) => invoke("zip_list", { path }),
  zipExtract: (path, index, target, overwrite = false) => invoke("zip_extract", { path, index, target, overwrite }),
  openLink: (url) => invoke("open_link", { url }),
  coreRead: async () => bytesOf(await invoke("core_read")),
  revealPath: (path) => invoke("reveal_path", { path }),
  pickFile: (options) => invoke("pick_file", { options }),
  pickSave: (options) => invoke("pick_save", { options }),
  pickFolder: (options) => invoke("pick_folder", { options }),
  saveRead: async (game) => bytesOf(await invoke("save_read", { game })),
  saveWrite: (game, bytes) => invoke("save_write", bytes, { headers: { "x-game": encodeURIComponent(game) } }),
  saveImport: (game, source) => invoke("save_import", { game, source }),
  savePath: (game) => invoke("save_path", { game }),
  storeRead: async (id, slot) => bytesOf(await invoke("store_read", { id, slot })),
  storeWrite: (id, slot, bytes) => invoke("store_write", bytes, { headers: { "x-store": encodeURIComponent(id), "x-slot": String(slot) } }),
  storeSlots: (id) => invoke("store_slots", { id }),
  assocStatus: () => invoke("assoc_status"),
  assocSet: (link) => invoke("assoc_set", { link }),
  webInspect: (path, romName = null, allowNet = false) => invoke("web_inspect", { path, romName, allowNet }),
  webSetRom: (key, rom) => invoke("web_set_rom", { key, rom }),
  appUpdateStage: (path, bytes, first) => invoke("app_update_stage", bytes, { headers: { "x-path": encodeURIComponent(path), "x-first": first ? "1" : "0" } }),
  appUpdateInstall: (version, from, files) => invoke("app_update_install", { version, from, files }),
  appUpdateFinish: () => invoke("app_update_finish"),
  log: queueLog,
  logFlush: () => sendLog(),
  logBeat: (on) => sendLog(Boolean(on)),
};

export const win = {
  minimize: () => invoke("window_minimize"),
  toggleMaximize: () => invoke("window_toggle_maximize"),
  isMaximized: () => invoke("window_is_maximized"),
  close: () => invoke("window_close"),
  toggleDevtools: () => invoke("toggle_devtools"),
  startResize: (direction) => tauri.window.getCurrentWindow().startResizeDragging(direction),
};

export const listen = (name, handler) => tauri.event.listen(name, handler);

export const onOpenFile = (handler) => listen("webgba://open-file", ({ payload }) => handler(payload?.path));

export const onCloseRequested = (handler) => listen("webgba://close-requested", handler);

export const onMaximized = (handler) => listen("webgba://window-maximized", ({ payload }) => handler(payload === true));

export const onOsFileDrop = (handler) => {
  const receive = (event) => handler(Array.isArray(event.detail?.paths) ? event.detail.paths : [], event.detail?.at ?? null);
  window.addEventListener("webgba:os-drop", receive);
  return () => window.removeEventListener("webgba:os-drop", receive);
};

export const onOsDrag = (handler) => {
  const receive = (event) => handler(event.detail?.phase, event.detail?.at ?? null);
  window.addEventListener("webgba:os-drag", receive);
  return () => window.removeEventListener("webgba:os-drag", receive);
};
