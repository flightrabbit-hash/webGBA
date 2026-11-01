import { t } from "../shell/i18n.js";

export const SCREEN_W = 240;
export const SCREEN_H = 160;
export const ROM_BASE = 0x08000000;
export const FLASH_SIZE = 0x20000;

const REQUIRED_EXPORTS = ["memory", "Web_Init", "Web_RunFrame", "Web_GetFramebuffer"];

const ENV_FUNCTIONS = new Set([
  "emscripten_asm_const_int",
  "emscripten_resize_heap",
  "_emscripten_throw_longjmp",
  "emscripten_date_now",
  "emscripten_get_now",
  "emscripten_notify_memory_growth",
  "_abort_js",
  "abort",
]);

const WASI_FUNCTIONS = new Set([
  "fd_write",
  "fd_read",
  "fd_close",
  "fd_seek",
  "fd_sync",
  "fd_fdstat_get",
  "environ_get",
  "environ_sizes_get",
  "proc_exit",
  "clock_time_get",
  "random_get",
]);

const WASI_EBADF = 8;
const WASI_ENOSYS = 52;

function knownImport(item) {
  if (item.kind !== "function") return false;
  if (item.module === "env") return ENV_FUNCTIONS.has(item.name) || /^invoke_[a-z]+$/.test(item.name);
  if (item.module === "wasi_snapshot_preview1") return WASI_FUNCTIONS.has(item.name);
  // .wgba 규격 4.1.2: 이 규격을 아는 호스트만 여는 표시(아무것도 하지 않음)
  if (item.module === "webgba") return item.name === "v1";
  return false;
}

export function inspectModule(module) {
  const imports = WebAssembly.Module.imports(module);
  const exports = new Set(WebAssembly.Module.exports(module).map((item) => item.name));
  const unknown = imports.filter((item) => !knownImport(item)).map((item) => `${item.module}.${item.name}`);
  const missing = REQUIRED_EXPORTS.filter((name) => !exports.has(name));
  return {
    usable: unknown.length === 0 && missing.length === 0,
    webApi: missing.length === 0,
    unknown,
    missing,
    canState: exports.has("Web_StateSize") && exports.has("Web_StateSave") && exports.has("Web_StateLoad"),
    canPointer: exports.has("Web_Pointer"),
    canNet: NET_EXPORTS.every((name) => exports.has(name)),
  };
}

const NET_EXPORTS = ["Web_NetWanted", "Web_NetEvent", "Web_NetOut", "Web_NetOutLen", "Web_NetOutClear", "Web_NetInBuffer", "Web_NetIn"];

export const ROM_SECTION = "webgba.rom";
const ROM_MAGIC = "WGRM";
const ROM_HEADER = 36;
const ROM_STORE = 0;
const ROM_ZLIB = 1;

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// 목차 없는 옛 .wgba: 컴파일한 모듈의 webgba.rom 구획(여럿이면 마지막). 새 .wgba 는 목차의 rom 조각을 readRomPayload 로.
export async function readEmbeddedRom(module) {
  const found = WebAssembly.Module.customSections(module, ROM_SECTION);
  if (!found.length) return null;
  return readRomPayload(new Uint8Array(found[found.length - 1]));
}

export async function readRomPayload(payload) {
  const bad = (why) => new Error(t("host.embedBad", { why }));
  if (payload.length < ROM_HEADER || String.fromCharCode(...payload.subarray(0, 4)) !== ROM_MAGIC) throw bad(t("host.embedWhyHeader"));
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const headerSize = view.getUint16(4, true);
  const version = payload[6];
  const method = payload[7];
  const size = view.getUint32(8, true);
  const packed = view.getUint32(12, true);
  if (version !== 1 || (method !== ROM_STORE && method !== ROM_ZLIB)) throw new Error(t("host.embedFormat", { version, method }));
  if (headerSize < ROM_HEADER || headerSize + packed > payload.length || size === 0 || size > 0x02000000) throw bad(t("host.embedWhyHeader"));
  const sha1 = hexOf(payload.subarray(16, 36));
  const data = payload.subarray(headerSize, headerSize + packed);
  let rom;
  if (method === ROM_STORE) {
    rom = data.slice();
  } else {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
      rom = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw bad(t("host.embedWhyInflate"));
    }
  }
  if (rom.length !== size) throw bad(t("host.embedWhySize"));
  if (hexOf(new Uint8Array(await crypto.subtle.digest("SHA-1", rom))) !== sha1) throw bad(t("host.embedWhySha1"));
  return { rom, sha1, packed };
}

function isBlank(bytes) {
  let zero = true;
  let full = true;
  for (let i = 0; i < bytes.length && (zero || full); i++) {
    if (bytes[i] !== 0) zero = false;
    if (bytes[i] !== 0xff) full = false;
  }
  return zero || full;
}

class WebHost {
  constructor(module, options) {
    this.module = module;
    this.log = options.log ?? (() => {});
    this.instance = null;
    this.ex = null;
    this.u8cache = null;
    this.rom = null;
    this.lines = new Map();
    this.halted = "";
    // 화면 크기(설명서 screen, 없으면 GBA). Web_GetFramebuffer 는 width × height × 4 바이트 RGBA.
    this.width = options.screen?.width ?? SCREEN_W;
    this.height = options.screen?.height ?? SCREEN_H;
  }

  get u8() {
    const buffer = this.ex.memory.buffer;
    if (!this.u8cache || this.u8cache.buffer !== buffer) this.u8cache = new Uint8Array(buffer);
    return this.u8cache;
  }

  get dv() {
    const buffer = this.ex.memory.buffer;
    if (!this.dvcache || this.dvcache.buffer !== buffer) this.dvcache = new DataView(buffer);
    return this.dvcache;
  }

  imports() {
    const host = this;
    const env = {
      emscripten_asm_const_int: () => 0,
      emscripten_notify_memory_growth: () => {},
      emscripten_date_now: () => Date.now(),
      emscripten_get_now: () => performance.now(),
      _emscripten_throw_longjmp: () => {
        throw Infinity;
      },
      _abort_js: () => {
        throw new Error("abort");
      },
      abort: () => {
        throw new Error("abort");
      },
      emscripten_resize_heap: (requested) => {
        const memory = host.ex.memory;
        const old = memory.buffer.byteLength;
        const want = requested >>> 0;
        if (want <= old) return 0;
        const pages = Math.ceil((want - old) / 65536);
        try {
          memory.grow(pages);
          return 1;
        } catch {
          return 0;
        }
      },
    };
    for (const item of WebAssembly.Module.imports(this.module)) {
      if (item.module !== "env" || !/^invoke_[a-z]+$/.test(item.name)) continue;
      env[item.name] = (index, ...args) => {
        const sp = host.ex.emscripten_stack_get_current();
        try {
          return host.ex.__indirect_function_table.get(index)(...args);
        } catch (error) {
          host.ex._emscripten_stack_restore(sp);
          if (error !== error + 0) throw error;
          host.ex.setThrew(1, 0);
        }
      };
    }
    const wasi = {
      fd_write: (fd, iov, count, written) => {
        const dv = host.dv;
        let total = 0;
        for (let i = 0; i < count; i++) {
          const ptr = dv.getUint32(iov + i * 8, true);
          const len = dv.getUint32(iov + i * 8 + 4, true);
          host.write(fd, host.u8.subarray(ptr, ptr + len));
          total += len;
        }
        dv.setUint32(written, total, true);
        return 0;
      },
      fd_read: () => WASI_ENOSYS,
      fd_close: () => WASI_EBADF,
      fd_seek: () => WASI_EBADF,
      fd_sync: () => WASI_EBADF,
      fd_fdstat_get: () => WASI_EBADF,
      environ_sizes_get: (countPtr, sizePtr) => {
        host.dv.setUint32(countPtr, 0, true);
        host.dv.setUint32(sizePtr, 0, true);
        return 0;
      },
      environ_get: () => 0,
      proc_exit: (code) => {
        throw new Error(`exit ${code}`);
      },
      clock_time_get: (id, precision, out) => {
        const nanos = id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1e6));
        host.dv.setBigUint64(out, nanos, true);
        return 0;
      },
      random_get: (ptr, len) => {
        crypto.getRandomValues(host.u8.subarray(ptr, ptr + len));
        return 0;
      },
    };
    return { env, wasi_snapshot_preview1: wasi, webgba: { v1: () => {} } };
  }

  write(fd, bytes) {
    const text = (this.lines.get(fd) ?? "") + new TextDecoder().decode(bytes);
    const parts = text.split("\n");
    this.lines.set(fd, parts.pop());
    for (const line of parts) this.log(fd === 2 ? "error" : "info", line);
  }

  async start() {
    this.instance = await WebAssembly.instantiate(this.module, this.imports());
    this.ex = this.instance.exports;
    this.u8cache = null;
    this.dvcache = null;
    if (this.ex.__wasm_call_ctors) this.ex.__wasm_call_ctors();
    else if (this.ex._initialize) this.ex._initialize();
    if (this.ex.Web_SetTimeZone) this.ex.Web_SetTimeZone(-new Date().getTimezoneOffset() * 60);
  }

  placeRom(bytes) {
    let at = ROM_BASE;
    if (this.ex.Web_RomBuffer) {
      at = this.ex.Web_RomBuffer(bytes.length) >>> 0;
      if (!at) throw new Error(t("host.romSlot"));
    } else {
      if (bytes.length > 0x02000000) throw new Error(t("host.romTooBig"));
      if (this.u8.length < ROM_BASE + bytes.length) throw new Error(t("host.romNoRoom"));
    }
    this.u8.set(bytes, at);
    this.rom = bytes;
  }

  placeSave(bytes) {
    if (!this.ex.Web_GetFlash) return false;
    if (this.ex.Web_FlashClear) this.ex.Web_FlashClear();
    if (!bytes || bytes.length === 0 || isBlank(bytes)) return false;
    const size = Math.min(bytes.length, this.saveCapacity);
    this.u8.set(bytes.subarray(0, size), this.ex.Web_GetFlash() >>> 0);
    if (this.ex.Web_SetSaveSize) this.ex.Web_SetSaveSize(size);
    return true;
  }

  get saveCapacity() {
    return Math.max(FLASH_SIZE, this.ex.Web_GetSaveSize ? this.ex.Web_GetSaveSize() >>> 0 : 0);
  }

  init() {
    if (this.ex.Web_Init()) return true;
    this.halted = this.reason() || t("host.initFailed");
    return false;
  }

  reason() {
    if (!this.ex.Web_GetHaltReason) return "";
    const at = this.ex.Web_GetHaltReason() >>> 0;
    return this.text(at);
  }

  text(at) {
    if (!at) return "";
    const u8 = this.u8;
    let end = at;
    while (u8[end] !== 0 && end - at < 512) end++;
    return new TextDecoder().decode(u8.subarray(at, end));
  }

  runFrame(keys) {
    if (this.ex.Web_RunFrame(keys)) return true;
    this.halted = this.reason() || t("host.stopped");
    return false;
  }

  framebuffer() {
    const at = this.ex.Web_GetFramebuffer() >>> 0;
    return new Uint8ClampedArray(this.ex.memory.buffer, at, this.width * this.height * 4);
  }

  setAudioRate(rate) {
    if (this.ex.Web_SetAudioRate) this.ex.Web_SetAudioRate(rate);
  }

  audio() {
    if (!this.ex.Web_GetAudioCount || !this.ex.Web_GetAudioBuffer) return null;
    const count = this.ex.Web_GetAudioCount();
    if (!count) return null;
    const at = this.ex.Web_GetAudioBuffer() >>> 0;
    return new Float32Array(this.ex.memory.buffer, at, count * 2).slice();
  }

  get hasSave() {
    return Boolean(this.ex.Web_GetFlash);
  }

  get hasPointer() {
    return Boolean(this.ex?.Web_Pointer);
  }

  get pointerWanted() {
    return Boolean(this.ex?.Web_PointerWanted && this.ex.Web_PointerWanted());
  }

  pointer(x, y, buttons, wheel) {
    if (this.ex?.Web_Pointer) this.ex.Web_Pointer(x, y, buttons, wheel);
  }

  takeSaveDirty() {
    return this.ex.Web_TakeFlashDirty ? Boolean(this.ex.Web_TakeFlashDirty()) : false;
  }

  saveData() {
    if (!this.ex.Web_GetFlash) return null;
    const size = this.ex.Web_GetSaveSize ? this.ex.Web_GetSaveSize() >>> 0 : FLASH_SIZE;
    const at = this.ex.Web_GetFlash() >>> 0;
    return this.u8.slice(at, at + size);
  }

  get canState() {
    return Boolean(this.ex.Web_StateSize && this.ex.Web_StateSave && this.ex.Web_StateLoad && this.ex.Web_Alloc);
  }

  // 코어가 쓴 길이를 알려 주면(Web_StateUsed, 포트 wasm) 그만큼만 남긴다 — 나머지는 0이다. mGBA 코어는 그대로 전체.
  stateSave() {
    if (!this.canState) return null;
    const size = this.ex.Web_StateSize() >>> 0;
    if (!size) return null;
    const at = this.ex.Web_Alloc(size) >>> 0;
    if (!at) return null;
    try {
      if (!this.ex.Web_StateSave(at)) return null;
      const used = this.ex.Web_StateUsed ? this.ex.Web_StateUsed() >>> 0 : 0;
      return this.u8.slice(at, at + (used > 0 && used <= size ? used : size));
    } finally {
      this.ex.Web_Free(at);
    }
  }

  // 길이는 Web_StateSize 그대로, 또는 쓴 길이를 알려 주는 코어면 그보다 짧은 것(뒤를 0으로 채움)
  stateLoad(bytes) {
    if (!this.canState) return false;
    const size = this.ex.Web_StateSize() >>> 0;
    const short = Boolean(this.ex.Web_StateUsed) && bytes.length > 0 && bytes.length < size;
    if (bytes.length !== size && !short) return false;
    const at = this.ex.Web_Alloc(size) >>> 0;
    if (!at) return false;
    try {
      this.u8.set(bytes, at);
      if (short) this.u8.fill(0, at + bytes.length, at + size);
      return Boolean(this.ex.Web_StateLoad(at));
    } finally {
      this.ex.Web_Free(at);
    }
  }

  // 마지막 불러오기: 1 그 순간 그대로, 2 다른 빌드라 그때의 게임 저장에서 이어 함, 0 알 수 없음(포트 wasm만)
  get stateLoadedKind() {
    return this.ex.Web_StateLoadedKind ? this.ex.Web_StateLoadedKind() >>> 0 : 0;
  }

  async reset() {
    if (this.ex.Web_Reset) {
      this.ex.Web_Reset();
      return true;
    }
    const save = this.saveData();
    const rom = this.rom;
    await this.start();
    if (rom) this.placeRom(rom);
    this.placeSave(save);
    return this.init();
  }

  get title() {
    return this.ex.Web_GetTitle ? this.text(this.ex.Web_GetTitle() >>> 0) : "";
  }

  get code() {
    return this.ex.Web_GetCode ? this.text(this.ex.Web_GetCode() >>> 0) : "";
  }
}

export async function bootHost({ module, rom, save, log, screen = null }) {
  const host = new WebHost(module, { log, screen });
  await host.start();
  // 롬 없는 ① 게임(설명서 rom.required: false)은 rom 이 null
  if (rom) host.placeRom(rom);
  const hadSave = host.placeSave(save);
  if (!host.init()) throw new Error(t("host.startFailed", { reason: host.halted }));
  return { host, hadSave };
}
