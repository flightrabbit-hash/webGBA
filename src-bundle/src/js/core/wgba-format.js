// .wgba 규격 1 — 목차 구획 `webgba.toc` 와 조각(설명서·롬팩 그림·JS·code·데이터·롬) 쓰기·읽기·검사.
// 앱(브라우저)·도구(tools/wgba.mjs, node 18+)·시험이 같은 코드를 쓴다. 바깥 의존: 저장소 안 pako(압축·풀기),
// SHA-256 은 crypto.subtle. 압축은 pako level 9 라 같은 입력이면 어느 PC 에서 묶어도 바이트까지 같다.
//
// 짜임(파일 전체가 올바른 wasm): wasm 머리 8 → webgba.toc → webgba.manifest → webgba.cart.label → webgba.cart.front →
// webgba.cart.spine → webgba.js → 원래 wasm 구획들(조각 "code") → webgba.data.<이름> … → webgba.rom(맨 끝, WGRM 1).
// 롬 구획은 옛 도구(pack-wgba·.wgbp)가 쓰던 것과 같은 바이트라, 옛 앱이 롬 구획을 빼고 다시 붙여도 결과가 같다.
import { Inflate, deflate } from "../vendor/pako.js";
import { concat, customSection, leb, romPayload, ROM_HEADER, ROM_MAGIC, ROM_SECTION } from "./wgbp.js";

export const SECTION_PREFIX = "webgba.";
export const TOC_SECTION = "webgba.toc";
export const TOC_MAGIC = "WGTC";
export const TOC_MAJOR = 1;
export const TOC_MINOR = 0;
export const TOC_HEAD = 16;
export const TOC_ENTRY = 80;
export const TOC_MAX_ENTRIES = 256;
export const KIND = Object.freeze({ code: 0, manifest: 1, cart: 2, js: 3, rom: 4, data: 5 });
export const KIND_NAME = Object.freeze(Object.fromEntries(Object.entries(KIND).map(([name, value]) => [value, name])));
export const METHOD = Object.freeze({ store: 0, zlib: 1 });
export const FLAG_REQUIRED = 1;
export const LIMITS = Object.freeze({
  file: 512 * 1024 * 1024,
  manifest: 64 * 1024,
  cart: 256 * 1024,
  cartRecommended: 64 * 1024,
  js: 16 * 1024 * 1024,
  rom: 32 * 1024 * 1024,
  data: 64,
});
/** 롬팩 그림 셋: 조각 이름과 격자 크기(가로·세로). 그림은 격자 × k(1~4, 셋이 같은 k). 권장 k = 2. */
export const CART_PARTS = Object.freeze({
  label: { chunk: "cart.label", unit: [48, 32] },
  front: { chunk: "cart.front", unit: [54, 44] },
  spine: { chunk: "cart.spine", unit: [18, 46] },
});
/** 앞면 기본 라벨 자리(격자 단위)와 옆면 기본 이름 자리(격자 단위 x, y, 가로, 세로). */
export const CART_DEFAULT_LABEL_AT = [3, 5];
export const CART_DEFAULT_TEXT_AREA = [2, 5, 14, 34];

/**
 * 그림 없는 롬팩(.gba·설명서 없는 .wasm·옛 .wgba, 설명서에 cart.color 없음)의 기본 몸통 색(결정 102-8).
 * 이름을 FNV-1a 로 해시해 팔레트에서 하나 고른다 — 같은 이름은 늘 같은 색(웹·exe 같은 계산). 색은 여기 JS 에만 둔다(CSS 금지).
 * 13개 테마 책장 바탕(밝음·어두움 모두)에서 구분되게 중간 채도로 고르고, 옆면 글자는 contrastInk 로 검정·흰색을 자동으로 고른다.
 */
export const ROMPACK_PALETTE = Object.freeze([
  "#c0392b", // 빨강
  "#cf6a1a", // 주황
  "#b7921a", // 금
  "#5a8f36", // 초록
  "#2f9488", // 청록
  "#3570c4", // 파랑
  "#5b54c0", // 남색
  "#9242b8", // 보라
  "#c04e79", // 분홍
  "#5f6b7a", // 회청
]);

/** 이름 → 팔레트 색(결정 102-8). 빈 이름도 안정된 색 하나. */
export function rompackColor(name) {
  let hash = 0x811c9dc5;
  const text = String(name ?? "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ROMPACK_PALETTE[hash % ROMPACK_PALETTE.length];
}

/** 바탕 색(#rgb·#rrggbb) 위에 읽기 좋은 글자 색: 상대 휘도로 검정·흰색 중 대비가 큰 쪽(결정 102-8 자동 전환). */
export const INK_DARK = "#10131c";
export const INK_LIGHT = "#f4f6fb";
export function contrastInk(color) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(String(color ?? "").replace(/^#/, "#")) ? String(color).replace("#", "") : null;
  const h = hex && hex.length === 6 ? hex : "808080";
  const lin = (v) => {
    const s = parseInt(v, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(h.slice(0, 2)) + 0.7152 * lin(h.slice(2, 4)) + 0.0722 * lin(h.slice(4, 6));
  // 흰색(1.0)·검정(0.0) 대비 = (L+0.05)/(0.0+0.05) vs (1.05)/(L+0.05)
  const withLight = (1.0 + 0.05) / (lum + 0.05);
  const withDark = (lum + 0.05) / 0.05;
  return withLight >= withDark ? INK_LIGHT : INK_DARK;
}
export const NEEDS = Object.freeze(["pointer", "net", "keyboard", "state"]);
export const RUNTIMES = Object.freeze(["webapi", "script"]);
export const ROLES = Object.freeze(["up", "down", "left", "right", "a", "b", "c", "d", "l", "r", "l2", "r2", "start", "select", "extra"]);
export const GBA_PRESET = Object.freeze([
  { id: "A", role: "a", bit: 0 },
  { id: "B", role: "b", bit: 1 },
  { id: "SELECT", role: "select", bit: 2 },
  { id: "START", role: "start", bit: 3 },
  { id: "RIGHT", role: "right", bit: 4 },
  { id: "LEFT", role: "left", bit: 5 },
  { id: "UP", role: "up", bit: 6 },
  { id: "DOWN", role: "down", bit: 7 },
  { id: "R", role: "r", bit: 8 },
  { id: "L", role: "l", bit: 9 },
]);
/** role 의 기본 키(규격 5.2, KeyboardEvent.code). a·b·select·start·방향·l·r 은 webGBA 기본 키와 같다 — 앱은 그 role 에
 *  사용자가 바꾼 GBA 버튼 키를 대신 쓴다(player.js layoutKeys). c·d 는 버튼 모드 묶음이 정한 키, extra 는 없음(사용자가 정함). */
export const ROLE_KEYS = Object.freeze({
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  a: ["KeyZ", "KeyK"],
  b: ["KeyX", "KeyJ"],
  c: ["KeyC", "KeyI"],
  d: ["KeyV", "KeyU"],
  l: ["KeyA"],
  r: ["KeyS"],
  l2: ["KeyQ"],
  r2: ["KeyW"],
  start: ["Enter", "NumpadEnter"],
  select: ["Backspace", "ShiftRight"],
});
/** role 의 기본 게임패드(표준 매핑 버튼 번호, 축은 "-axis0"·"+axis1"). l2·r2 가 있으면 l·r 은 4·5 만(resolveInput). */
export const ROLE_PAD = Object.freeze({
  up: [12, "-axis1"],
  down: [13, "+axis1"],
  left: [14, "-axis0"],
  right: [15, "+axis0"],
  a: [0],
  b: [1],
  c: [2],
  d: [3],
  l: [4, 6],
  r: [5, 7],
  l2: [6],
  r2: [7],
  start: [9],
  select: [8],
});
const PAD_AXIS_RE = /^[+-]?axis\d$/;

/**
 * 설명서 input → 이 게임의 버튼 목록(규격 5장). 설명서가 없으면(.gba·목차 없는 옛 .wgba·.wasm) GBA 10버튼.
 * preset 기본값은 ① "gba"·② "none". buttons 는 preset 뒤에 붙고 같은 id 면 preset 것을 바꾼다.
 * 돌려줌 { gameId, gba, buttons: [{ id, role, label, bit, code, keys, pad, touch }] }:
 *  - role: 아는 role 만(없거나 이미 쓴 role 이면 null — extra 처럼 기본 키·터치 자리 없음)
 *  - keys: 설명서가 적은 기본 키(4개까지) 또는 null(앱이 role 기본으로 채움) · pad: 설명서 값 또는 role 기본
 *  - gba: GBA 10버튼 그대로(바꾼 키·패드·이름·숨김 없음) — 앱은 키 설정을 앱 전체 값으로, 화면은 지금 그대로.
 * ① 은 bit(0~31)가 없는 버튼, ② 는 code 가 없는 버튼을 뺀다(readWgba 의 검사를 지난 설명서면 없음).
 */
export function resolveInput(manifest) {
  const script = manifest?.runtime === "script";
  const input = manifest?.input && typeof manifest.input === "object" ? manifest.input : {};
  const preset = input.preset ?? (script ? "none" : "gba");
  const list = preset === "gba" ? GBA_PRESET.map((b) => ({ ...b })) : [];
  for (const raw of Array.isArray(input.buttons) ? input.buttons : []) {
    if (!raw || typeof raw.id !== "string") continue;
    const at = list.findIndex((b) => b.id === raw.id);
    if (at >= 0) list[at] = { ...list[at], ...raw };
    else list.push({ ...raw });
  }
  const used = new Set();
  const buttons = [];
  for (const raw of list.slice(0, script ? 24 : 32)) {
    if (script ? typeof raw.code !== "string" || !raw.code : !Number.isInteger(raw.bit) || raw.bit < 0 || raw.bit > 31) continue;
    let role = ROLES.includes(raw.role) ? raw.role : null;
    if (role && role !== "extra" && used.has(role)) role = null;
    if (role && role !== "extra") used.add(role);
    if (role === "extra") role = null;
    const keys = Array.isArray(raw.keys) ? raw.keys.filter((code) => typeof code === "string" && code).slice(0, 4) : null;
    const pad = Array.isArray(raw.pad) ? raw.pad.filter((p) => (Number.isInteger(p) && p >= 0 && p < 32) || (typeof p === "string" && PAD_AXIS_RE.test(p))) : null;
    buttons.push({ id: raw.id, role, label: raw.label ?? null, bit: script ? null : raw.bit, code: script ? raw.code : null, keys, pad, touch: raw.touch === "hide" ? "hide" : "auto" });
  }
  const shoulders2 = used.has("l2") || used.has("r2");
  for (const b of buttons) {
    if (b.pad) continue;
    b.pad = b.role === "l" && shoulders2 ? [4] : b.role === "r" && shoulders2 ? [5] : [...(ROLE_PAD[b.role] ?? [])];
  }
  const gba =
    !script &&
    buttons.length === GBA_PRESET.length &&
    GBA_PRESET.every((p, i) => {
      const b = buttons[i];
      return b.id === p.id && b.role === p.role && b.bit === p.bit && !b.keys && !b.label && b.touch === "auto" && b.pad.join() === ROLE_PAD[p.role].join();
    });
  return { gameId: typeof manifest?.id === "string" ? manifest.id : "", gba, buttons };
}

/** ① 가 쓸 수 있는 가져오기(web-host.js 와 같은 목록 + webgba.v1). */
export const WEBAPI_ENV = Object.freeze(["emscripten_asm_const_int", "emscripten_resize_heap", "_emscripten_throw_longjmp", "emscripten_date_now", "emscripten_get_now", "emscripten_notify_memory_growth", "_abort_js", "abort"]);
export const WEBAPI_WASI = Object.freeze(["fd_write", "fd_read", "fd_close", "fd_seek", "fd_sync", "fd_fdstat_get", "environ_get", "environ_sizes_get", "proc_exit", "clock_time_get", "random_get"]);
export const WEBAPI_REQUIRED = Object.freeze(["memory", "Web_Init", "Web_RunFrame", "Web_GetFramebuffer"]);
export const WEBAPI_NET = Object.freeze(["Web_NetWanted", "Web_NetEvent", "Web_NetOut", "Web_NetOutLen", "Web_NetOutClear", "Web_NetInBuffer", "Web_NetIn"]);
/** 호스트 몫 키(게임 기본 배치에 넣지 말 것). Pause·KeyP = 일시정지(KeyP 는 웹 버전). */
export const HOST_KEYS = Object.freeze(["Space", "Tab", "Escape", "Pause", "KeyP", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);

export const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export const CHUNK_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export const DATA_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,26}$/;

export class WgbaError extends Error {
  constructor(message, code = "wgba") {
    super(message);
    this.name = "WgbaError";
    this.code = code;
  }
}

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const putU16 = (b, at, v) => {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
};
const putU32 = (b, at, v) => {
  for (let i = 0; i < 4; i++) b[at + i] = (v >>> (8 * i)) & 0xff;
};
const asBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength));

export async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}
export const sha256Hex = async (bytes) => hexOf(await sha256(bytes));

function readLeb(bytes, at) {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (at >= bytes.length) throw new WgbaError("wasm 이 중간에 끊겼습니다(LEB128)", "truncated");
    const byte = bytes[at++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [value, at];
    shift += 7;
    if (shift > 28) throw new WgbaError("wasm 구획 크기가 너무 깁니다(LEB128)", "leb");
  }
}

export const isWasm = (bytes) => bytes.length >= 8 && u32(bytes, 0) === 0x6d736100 && u32(bytes, 4) === 1;

/** wasm 구획 목록 { id, start, end, name, payload }. 사용자 정의 구획(id 0)만 name·payload(내용 첫 바이트)가 뜻이 있다. */
export function wasmSections(bytes) {
  bytes = asBytes(bytes);
  if (!isWasm(bytes)) throw new WgbaError("wasm 1 이 아닙니다(첫 8바이트)", "notWasm");
  const list = [];
  let at = 8;
  while (at < bytes.length) {
    const start = at;
    const id = bytes[at++];
    let size;
    [size, at] = readLeb(bytes, at);
    const end = at + size;
    if (end > bytes.length) throw new WgbaError(`구획 ${list.length}(id ${id})이 파일 끝을 넘습니다`, "truncated");
    let name = null;
    let payload = at;
    if (id === 0) {
      let len;
      [len, payload] = readLeb(bytes, at);
      if (payload + len > end) throw new WgbaError(`사용자 정의 구획 ${list.length} 의 이름이 구획을 넘습니다`, "badSection");
      try {
        name = utf8Strict.decode(bytes.subarray(payload, payload + len));
      } catch {
        name = "";
      }
      payload += len;
    }
    list.push({ id, start, end, name, payload });
    at = end;
  }
  return list;
}

const isOurs = (s) => s.id === 0 && typeof s.name === "string" && s.name.startsWith(SECTION_PREFIX);

/** 입력 wasm(또는 .wgba)에서 webgba.* 구획을 모두 뺀 원래 구획들(머리 8바이트 제외) = 조각 "code". */
export function codeRegion(wasm) {
  wasm = asBytes(wasm);
  return concat(wasmSections(wasm).filter((s) => !isOurs(s)).map((s) => wasm.subarray(s.start, s.end)));
}

/** 조각 code(목차의 시작~끝)에 wasm 머리를 붙인 실행 가능한 wasm. */
export const codeWasm = (code) => concat([Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0), code]);

/** PNG·WebP 머리에서 형식·가로·세로(그림을 풀지 않음). 모르면 null. */
export function imageHead(bytes) {
  const b = asBytes(bytes);
  const ascii = (at, n) => String.fromCharCode(...b.subarray(at, at + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    const be = (at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    return { format: "png", lossless: true, width: be(16), height: be(20) };
  }
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const fourcc = ascii(12, 4);
    if (fourcc === "VP8L" && b[20] === 0x2f) {
      const bits = u32(b, 21);
      return { format: "webp", lossless: true, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return { format: "webp", lossless: false, fourcc };
  }
  return null;
}

/** 롬팩 그림 크기 → 배수 k(격자 × k, k 1~4). 맞지 않으면 0. */
export function cartScale(part, width, height) {
  const [uw, uh] = CART_PARTS[part].unit;
  const k = width / uw;
  return Number.isInteger(k) && k >= 1 && k <= 4 && height === uh * k ? k : 0;
}

/** zlib 풀기. 푼 크기가 limit 을 넘는 순간 멈춘다(압축 폭탄 막기). */
export function inflateLimited(stored, limit) {
  const inflator = new Inflate({ chunkSize: 0x10000 });
  const parts = [];
  let total = 0;
  inflator.onData = (chunk) => {
    total += chunk.length;
    if (total > limit) throw new WgbaError(`푼 크기가 ${limit}바이트를 넘습니다`, "tooBig");
    parts.push(chunk);
  };
  inflator.push(stored, true);
  if (inflator.err) throw new WgbaError(`zlib 을 풀지 못했습니다: ${inflator.msg}`, "inflate");
  return concat(parts);
}

/** 저장된 조각 바이트 → 내용(방식대로 풀고, 푼 크기를 확인). */
export function unpackChunk(stored, entry) {
  if (entry.method === METHOD.store) return stored;
  if (entry.method === METHOD.zlib) {
    const out = inflateLimited(stored, entry.size);
    if (out.length !== entry.size) throw new WgbaError(`조각 ${entry.name}: 푼 크기 ${out.length} ≠ 목차 ${entry.size}`, "size");
    return out;
  }
  throw new WgbaError(`조각 ${entry.name}: 모르는 방식 ${entry.method}`, "method");
}

/** 롬 구획 내용(WGRM 1) 머리. total = 구획 내용 전체 길이(머리만 넘길 때 따로 줌). */
export function romHeader(payload, total = payload.length) {
  const p = asBytes(payload);
  if (p.length < ROM_HEADER || String.fromCharCode(...p.subarray(0, 4)) !== ROM_MAGIC) throw new WgbaError("롬 조각 머리가 WGRM 이 아닙니다", "rom");
  const header = { headerSize: u16(p, 4), version: p[6], method: p[7], size: u32(p, 8), packed: u32(p, 12), sha1: hexOf(p.subarray(16, 36)) };
  if (header.version !== 1) throw new WgbaError(`모르는 롬 조각 형식 ${header.version}`, "rom");
  if (header.headerSize < ROM_HEADER || header.headerSize + header.packed > total) throw new WgbaError("롬 조각 크기가 맞지 않습니다", "rom");
  if (!header.size || header.size > LIMITS.rom) throw new WgbaError(`롬 크기가 규칙 밖입니다: ${header.size}`, "rom");
  return header;
}

/** 롬 구획 내용 → 롬(크기·SHA-1 확인). */
export async function unpackRom(payload) {
  const p = asBytes(payload);
  const header = romHeader(p);
  const data = p.subarray(header.headerSize, header.headerSize + header.packed);
  let rom;
  if (header.method === 0) rom = data.slice();
  else if (header.method === 1) rom = inflateLimited(data, header.size);
  else throw new WgbaError(`모르는 롬 압축 방식 ${header.method}`, "rom");
  if (rom.length !== header.size) throw new WgbaError(`풀린 롬 크기 ${rom.length} ≠ ${header.size}`, "rom");
  const sha1 = hexOf(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", rom)));
  if (sha1 !== header.sha1) throw new WgbaError("풀린 롬의 SHA-1 이 머리와 다릅니다", "rom");
  return { rom, header };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * 묶기 전 설명서 손질: 넣는 롬팩 그림마다 cart.<label|front|spine> 의 chunk·format·width·height 를 그림에서 채우고
 * (그 밖의 값 labelAt·textArea 는 그대로), 넣지 않는 그림의 항목은 지운다. 원본 객체는 바꾸지 않는다.
 */
export function finalizeManifest(manifest, images = {}) {
  const m = clone(manifest);
  const cart = m.cart && typeof m.cart === "object" ? m.cart : {};
  const notes = [];
  for (const part of Object.keys(CART_PARTS)) {
    const bytes = images[part];
    const extra = cart[part] && typeof cart[part] === "object" ? cart[part] : {};
    delete cart[part];
    if (!bytes) {
      const kept = Object.keys(extra).filter((k) => !["chunk", "format", "width", "height"].includes(k));
      if (kept.length) notes.push(`${part} 그림이 없어 cart.${part}(${kept.join(", ")})를 뺐습니다`);
      continue;
    }
    const head = imageHead(bytes);
    if (!head) throw new WgbaError(`롬팩 ${part} 그림이 PNG·WebP 가 아닙니다`, "cart");
    if (!head.lossless) throw new WgbaError(`롬팩 ${part} 그림: WebP 는 무손실(VP8L)만 받습니다`, "cart");
    const rest = Object.fromEntries(Object.entries(extra).filter(([k]) => !["chunk", "format", "width", "height"].includes(k)));
    cart[part] = { chunk: CART_PARTS[part].chunk, format: head.format, width: head.width, height: head.height, ...rest };
  }
  if (Object.keys(cart).length) m.cart = cart;
  else delete m.cart;
  return { manifest: m, notes };
}

function chunkSection(name, stored) {
  return customSection(`${SECTION_PREFIX}${name}`, stored);
}

/**
 * 묶기. 입력 wasm 의 webgba.* 구획은 모두 빼고(code 구간), 조각을 규격 순서로 놓는다.
 * images = { label, front, spine } (PNG·무손실 WebP 바이트, 없으면 빠짐), data = [{ name, bytes, method? }].
 * rom 은 롬 바이트(WGRM 1·pako 9 로 묶음) 또는 romPayloadBytes(이미 묶은 구획 내용).
 */
export async function packWgba({ wasm, manifest, images = {}, js = null, jsMethod = METHOD.zlib, data = [], rom = null, romPayloadBytes = null }) {
  const code = codeRegion(wasm);
  if (!code.length) throw new WgbaError("wasm 에 원래 구획이 없습니다", "code");
  const { manifest: finalManifest, notes } = finalizeManifest(manifest, images);
  const manifestBytes = utf8.encode(JSON.stringify(finalManifest));
  if (manifestBytes.length > LIMITS.manifest) throw new WgbaError("설명서가 64KB 를 넘습니다", "manifest");
  const all = [{ name: "manifest", kind: KIND.manifest, method: METHOD.store, stored: manifestBytes, size: manifestBytes.length, flags: FLAG_REQUIRED }];
  for (const part of Object.keys(CART_PARTS)) {
    const bytes = images[part];
    if (bytes) all.push({ name: CART_PARTS[part].chunk, kind: KIND.cart, method: METHOD.store, stored: asBytes(bytes), size: bytes.length, flags: 0 });
  }
  if (js) {
    const raw = asBytes(js);
    if (raw.length > LIMITS.js) throw new WgbaError("JS 가 16MB 를 넘습니다", "js");
    const stored = jsMethod === METHOD.zlib ? deflate(raw, { level: 9 }) : raw;
    all.push({ name: "js", kind: KIND.js, method: jsMethod, stored, size: raw.length, flags: FLAG_REQUIRED });
  }
  all.push({ name: "code", kind: KIND.code, method: METHOD.store, stored: code, size: code.length, flags: FLAG_REQUIRED, isCode: true });
  if (data.length > LIMITS.data) throw new WgbaError(`데이터 조각은 ${LIMITS.data}개까지입니다`, "data");
  const dataNames = new Set();
  for (const d of data) {
    if (!DATA_NAME_RE.test(d.name) || dataNames.has(d.name)) throw new WgbaError(`데이터 이름이 규칙 밖이거나 겹칩니다: ${d.name}`, "data");
    dataNames.add(d.name);
    const raw = asBytes(d.bytes);
    const method = d.method ?? METHOD.zlib;
    const stored = method === METHOD.zlib ? deflate(raw, { level: 9 }) : raw;
    all.push({ name: `data.${d.name}`, kind: KIND.data, method, stored, size: raw.length, flags: 0 });
  }
  if (rom || romPayloadBytes) {
    const stored = romPayloadBytes ? asBytes(romPayloadBytes) : await romPayload(asBytes(rom));
    romHeader(stored);
    all.push({ name: "rom", kind: KIND.rom, method: METHOD.store, stored, size: stored.length, flags: FLAG_REQUIRED });
  }
  if (all.length > TOC_MAX_ENTRIES) throw new WgbaError("조각이 너무 많습니다", "toc");

  const tocLen = TOC_HEAD + TOC_ENTRY * all.length;
  const tocName = utf8.encode(TOC_SECTION);
  const tocBody = leb(tocName.length).length + tocName.length + tocLen;
  let at = 8 + 1 + leb(tocBody).length + tocBody;
  const pieces = [];
  for (const e of all) {
    if (e.isCode) {
      e.start = at;
      e.end = at + code.length;
      pieces.push(code);
    } else {
      const section = chunkSection(e.name, e.stored);
      e.start = at + section.length - e.stored.length;
      e.end = at + section.length;
      pieces.push(section);
    }
    at = e.end;
  }
  const fileLen = at;
  if (fileLen > LIMITS.file) throw new WgbaError("파일이 512MB 를 넘습니다", "file");
  const toc = new Uint8Array(tocLen);
  for (let i = 0; i < 4; i++) toc[i] = TOC_MAGIC.charCodeAt(i);
  toc[4] = TOC_MAJOR;
  toc[5] = TOC_MINOR;
  putU16(toc, 6, TOC_HEAD);
  putU16(toc, 8, TOC_ENTRY);
  putU16(toc, 10, all.length);
  putU32(toc, 12, fileLen);
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    const o = TOC_HEAD + i * TOC_ENTRY;
    for (let j = 0; j < e.name.length; j++) toc[o + j] = e.name.charCodeAt(j);
    putU32(toc, o + 32, e.start);
    putU32(toc, o + 36, e.end);
    putU32(toc, o + 40, e.size);
    toc[o + 44] = e.method;
    toc[o + 45] = e.kind;
    putU16(toc, o + 46, e.flags);
    toc.set(await sha256(e.stored), o + 48);
  }
  const out = concat([Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0), customSection(TOC_SECTION, toc), ...pieces]);
  if (out.length !== fileLen) throw new WgbaError(`길이 셈이 틀렸습니다 ${out.length} / ${fileLen}`, "internal");
  return { bytes: out, manifest: finalManifest, notes, entries: all.map(({ name, kind, method, start, end, size, flags }) => ({ name, kind, method, start, end, size, flags })) };
}

/**
 * 목차 읽기. readAt(offset, length) → Promise<Uint8Array> 만 쓰므로 파일 앞부분만 읽어도 된다.
 * 목차가 없으면(옛 .wgba·.wasm) null. 목차가 있는데 망가졌으면 WgbaError.
 */
export async function readToc(readAt) {
  const head = await readAt(0, 32);
  if (!isWasm(head)) throw new WgbaError("wasm 1 이 아닙니다", "notWasm");
  let at = 8;
  if (head.length <= at || head[at++] !== 0) return null;
  let size;
  let nameLen;
  [size, at] = readLeb(head, at);
  const bodyStart = at;
  [nameLen, at] = readLeb(head, at);
  if (nameLen !== TOC_SECTION.length || at + nameLen > head.length) return null;
  if (String.fromCharCode(...head.subarray(at, at + nameLen)) !== TOC_SECTION) return null;
  at += nameLen;
  const first = await readAt(at, TOC_HEAD);
  if (first.length < TOC_HEAD || String.fromCharCode(...first.subarray(0, 4)) !== TOC_MAGIC) throw new WgbaError("목차 머리가 WGTC 가 아닙니다", "toc");
  const major = first[4];
  if (major !== TOC_MAJOR) throw new WgbaError(`모르는 목차 형식 ${major} — 새 webGBA 가 필요합니다`, "newer");
  const headLen = u16(first, 6);
  const entryLen = u16(first, 8);
  const count = u16(first, 10);
  const fileLen = u32(first, 12);
  if (headLen < TOC_HEAD || entryLen < TOC_ENTRY || count > TOC_MAX_ENTRIES) throw new WgbaError("목차 머리 값이 규칙 밖입니다", "toc");
  const tableLen = headLen + entryLen * count;
  if (bodyStart + size < at + tableLen) throw new WgbaError("목차가 목차 구획보다 깁니다", "toc");
  const body = await readAt(at, tableLen);
  if (body.length < tableLen) throw new WgbaError("목차가 끊겼습니다", "toc");
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = headLen + i * entryLen;
    let name = "";
    for (let j = 0; j < 32 && body[o + j]; j++) name += String.fromCharCode(body[o + j]);
    entries.push({
      name,
      start: u32(body, o + 32),
      end: u32(body, o + 36),
      size: u32(body, o + 40),
      method: body[o + 44],
      kind: body[o + 45],
      kindName: KIND_NAME[body[o + 45]] ?? `?${body[o + 45]}`,
      flags: u16(body, o + 46),
      sha256: hexOf(body.subarray(o + 48, o + 80)),
    });
  }
  return { major, minor: first[5], fileLen, entries, tocEnd: bodyStart + size };
}

export const bytesReader = (bytes) => async (offset, length) => bytes.subarray(offset, offset + length);
export const readTocFrom = (bytes) => readToc(bytesReader(asBytes(bytes)));

/** 빌드 식별: code·rom·data.* 조각 SHA-256 을 목차 순서로 이어 SHA-256(설명서·롬팩 그림·JS 는 뺌). 멀티플레이 compat "exact" 등. */
export async function buildId(toc) {
  const parts = toc.entries.filter((e) => e.kind === KIND.code || e.kind === KIND.rom || e.kind === KIND.data).map((e) => `${e.name}:${e.sha256}`);
  return sha256Hex(utf8.encode(parts.join("\n")));
}

/** 유의적 버전 비교: a < b → -1, 같음 0, a > b → 1 (시험 버전 꼬리는 semver 규칙). */
export function compareVersions(a, b) {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) throw new WgbaError(`버전이 x.y.z 가 아닙니다: ${pa ? b : a}`, "version");
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d < 0 ? -1 : 1;
  }
  if (!pa[4] && !pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  const xa = pa[4].split(".");
  const xb = pb[4].split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) < Number(xb[i]) ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 같은 id 를 다시 넣을 때 할 일(규격 3.4): 같은 빌드 → "same"(그대로 엶), 더 높은 버전·같은 버전의 다른 빌드 → "update"(묻지 않고 바꿈),
 * 더 낮은 버전 → "older"(경고, 기본 아니요).
 */
export function updateAction({ version: oldVersion, build: oldBuild }, { version: newVersion, build: newBuild }) {
  if (oldBuild && newBuild && oldBuild === newBuild) return "same";
  return compareVersions(newVersion, oldVersion) < 0 ? "older" : "update";
}

const textOk = (value, max) => (typeof value === "string" ? value.length >= 1 && value.length <= max : value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every((v) => typeof v === "string" && v.length >= 1 && v.length <= max));

/** 설명서만 보는 검사(모듈 없이). errors·warnings 에 글을 더한다. */
export function checkManifest(m, errors, warnings) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return errors.push("설명서가 JSON 객체가 아닙니다");
  if (m.wgba !== 1) errors.push(`wgba(규격 번호)가 1 이 아닙니다: ${m.wgba}`);
  if (typeof m.id !== "string" || m.id.length > 64 || !ID_RE.test(m.id)) errors.push(`id 가 규칙 밖입니다(소문자 역도메인, 점 1개 이상, 64자 이하): ${m.id}`);
  if (typeof m.version !== "string" || !VERSION_RE.test(m.version)) errors.push(`version 이 x.y.z(유의적 버전)가 아닙니다: ${m.version}`);
  if (!textOk(m.name, 48)) errors.push("name 이 없거나 48자를 넘습니다");
  if (m.shortName !== undefined && !textOk(m.shortName, 16)) warnings.push("shortName 은 16자 이하 권장");
  if (!RUNTIMES.includes(m.runtime)) errors.push(`runtime 이 webapi·script 가 아닙니다: ${m.runtime}`);
  if (m.homepage !== undefined && !/^https:\/\//.test(m.homepage)) errors.push("homepage 는 https:// 주소만 받습니다");
  for (const need of m.needs ?? []) if (!NEEDS.includes(need)) errors.push(`이 검사기가 모르는 needs: ${need}`);
  const s = m.screen ?? {};
  for (const key of ["width", "height"]) if (s[key] !== undefined && (!Number.isInteger(s[key]) || s[key] < 1 || s[key] > 1024)) errors.push(`screen.${key} 는 1~1024 정수`);
  if (s.scale !== undefined && !["fit", "integer"].includes(s.scale)) errors.push(`screen.scale 이 fit·integer 가 아닙니다: ${s.scale}`);
  const save = m.save ?? {};
  if (save.kind !== undefined && !["flash", "storage", "localStorage", "files", "none"].includes(save.kind)) errors.push(`save.kind 가 규칙 밖입니다: ${save.kind}`);
  if (save.maxSize !== undefined && (!Number.isInteger(save.maxSize) || save.maxSize < 1 || save.maxSize > 16 * 1024 * 1024)) errors.push("save.maxSize 는 1~16MB");
  if (m.input?.preset !== undefined && !["gba", "none"].includes(m.input.preset)) errors.push(`input.preset 이 gba·none 이 아닙니다: ${m.input.preset}`);
  // preset 기본값: ① gba · ② none (규격 5.1, resolveInput 과 같음)
  const presetGba = (m.input?.preset ?? (m.runtime === "script" ? "none" : "gba")) === "gba";
  const ids = new Set(presetGba ? GBA_PRESET.map((b) => b.id) : []);
  const roles = new Map(presetGba ? GBA_PRESET.map((b) => [b.role, b.id]) : []);
  for (const b of m.input?.buttons ?? []) {
    if (!b || typeof b.id !== "string" || !/^[A-Za-z0-9_-]{1,16}$/.test(b.id)) {
      errors.push(`버튼 id 가 규칙 밖입니다: ${b?.id}`);
      continue;
    }
    const replaces = ids.has(b.id) && GBA_PRESET.some((p) => p.id === b.id);
    if (ids.has(b.id) && !replaces) errors.push(`버튼 id 가 겹칩니다: ${b.id}`);
    ids.add(b.id);
    if (b.role !== undefined && !ROLES.includes(b.role)) errors.push(`버튼 ${b.id}: 모르는 role ${b.role}`);
    if (b.role && b.role !== "extra" && roles.has(b.role) && roles.get(b.role) !== b.id) errors.push(`버튼 ${b.id}: role ${b.role} 를 ${roles.get(b.role)} 도 씁니다`);
    if (b.role) roles.set(b.role, b.id);
    for (const key of b.keys ?? []) if (HOST_KEYS.includes(key)) warnings.push(`버튼 ${b.id}: 기본 키 ${key} 는 호스트 몫 키입니다`);
  }
  if (m.multiplayer) {
    const mp = m.multiplayer;
    if (mp.protocol !== 1) errors.push(`multiplayer.protocol 이 1 이 아닙니다: ${mp.protocol}`);
    const pids = new Set();
    for (const p of mp.purposes ?? []) {
      if (typeof p.id !== "string" || !/^[a-z0-9-]{1,32}$/.test(p.id) || pids.has(p.id)) errors.push(`multiplayer.purposes id 가 규칙 밖이거나 겹칩니다: ${p.id}`);
      pids.add(p.id);
    }
    for (const n of [mp.players?.min, mp.players?.max]) if (n !== undefined && (!Number.isInteger(n) || n < 2 || n > 8)) errors.push("multiplayer 인원은 2~8");
  }
  if (m.runtime === "script" && !["module", "emscripten"].includes(m.entry?.style)) errors.push(`entry.style 이 module·emscripten 이 아닙니다: ${m.entry?.style}`);
  // 규격 1 의 JS 조각 이름은 늘 "js"(묶기 도구·읽기 모두) — 다른 값은 무시된다
  if (m.entry?.js !== undefined && m.entry.js !== "js") warnings.push(`entry.js 는 "js" 만 됩니다(규격 1) — 무시하고 조각 js 를 씁니다: ${m.entry.js}`);
  if (m.cart !== undefined) {
    if (m.cart.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(m.cart.color)) errors.push(`cart.color 는 #RRGGBB: ${m.cart.color}`);
  }
  return undefined;
}

/** 롬팩 그림 검사(그림 조각 + 설명서). */
function checkCart(m, images, errors, warnings) {
  const scales = {};
  for (const part of Object.keys(CART_PARTS)) {
    const bytes = images[part];
    const meta = m.cart?.[part];
    if (meta && !bytes) errors.push(`설명서에 cart.${part} 가 있는데 조각 ${CART_PARTS[part].chunk} 이 없습니다`);
    if (!bytes) continue;
    if (!meta) warnings.push(`조각 ${CART_PARTS[part].chunk} 이 있는데 설명서에 cart.${part} 가 없습니다(그림은 씀)`);
    const head = imageHead(bytes);
    if (!head) {
      errors.push(`롬팩 ${part}: PNG·WebP 가 아닙니다`);
      continue;
    }
    if (!head.lossless) errors.push(`롬팩 ${part}: WebP 는 무손실(VP8L)만 받습니다`);
    if (bytes.length > LIMITS.cart) errors.push(`롬팩 ${part}: 256KB 를 넘습니다`);
    else if (bytes.length > LIMITS.cartRecommended) warnings.push(`롬팩 ${part}: 64KB 권장을 넘습니다`);
    const k = cartScale(part, head.width, head.height);
    const [uw, uh] = CART_PARTS[part].unit;
    if (!k) warnings.push(`롬팩 ${part} ${head.width}x${head.height} 는 ${uw}x${uh} 의 1~4배가 아닙니다 — 호스트는 기본 모양으로 그립니다`);
    else scales[part] = k;
    if (meta && (meta.format !== head.format || meta.width !== head.width || meta.height !== head.height)) warnings.push(`설명서 cart.${part} 의 형식·크기가 그림과 다릅니다(그림 쪽을 씀)`);
  }
  const ks = new Set(Object.values(scales));
  if (ks.size > 1) warnings.push(`롬팩 그림 배수가 서로 다릅니다(${Object.entries(scales).map(([p, k]) => `${p} ×${k}`).join(", ")}) — 다른 배수의 앞면·옆면은 쓰지 않습니다`);
  const front = m.cart?.front;
  if (front?.labelAt !== undefined && scales.front) {
    const k = scales.front;
    const ok = Array.isArray(front.labelAt) && front.labelAt.length === 2 && front.labelAt.every((n) => Number.isInteger(n) && n >= 0);
    if (!ok || front.labelAt[0] + 48 * k > 54 * k || front.labelAt[1] + 32 * k > 44 * k) warnings.push("cart.front.labelAt 의 라벨 자리가 앞면 그림 밖입니다 — 기본 자리를 씁니다");
  }
  const spine = m.cart?.spine;
  if (spine?.textArea !== undefined && scales.spine) {
    const k = scales.spine;
    const t = spine.textArea;
    const ok = Array.isArray(t) && t.length === 4 && t.every((n) => Number.isInteger(n) && n >= 0) && t[2] > 0 && t[3] > 0;
    if (!ok || t[0] + t[2] > CART_PARTS.spine.unit[0] * k || t[1] + t[3] > CART_PARTS.spine.unit[1] * k) warnings.push("cart.spine.textArea 가 옆면 그림 밖입니다 — 이름을 쓰지 않습니다");
  }
}

const CHUNK_RULES = [
  { test: (n) => n === "manifest", kind: KIND.manifest, max: 1, min: 1 },
  { test: (n) => n === "code", kind: KIND.code, max: 1, min: 1 },
  { test: (n) => n === "js", kind: KIND.js, max: 1, min: 0 },
  { test: (n) => n === "rom", kind: KIND.rom, max: 1, min: 0 },
  { test: (n) => n.startsWith("data."), kind: KIND.data, max: LIMITS.data, min: 0 },
  ...Object.values(CART_PARTS).map((p) => ({ test: (n) => n === p.chunk, kind: KIND.cart, max: 1, min: 0 })),
];

/**
 * 파일 전체 검사(규격 10장). bytes = 파일 전체. 결과 { errors, warnings, toc, manifest, imports, exports, buildId, rom }.
 * compile: false 면 모듈 내보내기·가져오기 검사를 건너뜀. deep: false 면 롬을 풀어 SHA-1 을 보지 않음.
 */
export async function checkWgba(bytes, { compile = true, deep = true } = {}) {
  bytes = asBytes(bytes);
  const errors = [];
  const warnings = [];
  const result = { errors, warnings, toc: null, manifest: null, imports: [], exports: [], buildId: null, rom: null };
  if (bytes.length > LIMITS.file) errors.push("파일이 512MB 를 넘습니다");
  let list;
  try {
    list = wasmSections(bytes);
  } catch (error) {
    errors.push(error.message);
    return result;
  }
  if (!WebAssembly.validate(bytes)) errors.push("파일 전체가 올바른 wasm 이 아닙니다");
  let toc;
  try {
    toc = await readTocFrom(bytes);
  } catch (error) {
    errors.push(error.message);
    return result;
  }
  result.toc = toc;
  if (!toc) {
    warnings.push("목차(webgba.toc)가 없습니다 — 옛 .wgba 로 보고 기본값(① · 240x160 · GBA 버튼 · 파일 이름)으로 엽니다");
    return result;
  }
  if (list[0]?.name !== TOC_SECTION) errors.push("목차가 첫 구획이 아닙니다");
  if (list.filter((s) => s.id === 0 && s.name === TOC_SECTION).length > 1) errors.push("목차 구획이 둘 이상입니다");
  if (toc.minor > TOC_MINOR) warnings.push(`목차 작은 번호 ${toc.minor} 는 이 검사기보다 새것입니다`);
  if (toc.fileLen !== bytes.length) errors.push(`목차의 파일 길이 ${toc.fileLen} ≠ 실제 ${bytes.length}`);

  const names = new Set();
  const counts = new Map();
  let last = toc.tocEnd;
  let codeEntry = null;
  const stage = (e) => (e.kind === KIND.manifest || e.kind === KIND.cart || e.kind === KIND.js ? 0 : e.kind === KIND.code ? 1 : e.kind === KIND.data ? 2 : e.kind === KIND.rom ? 3 : -1);
  let lastStage = 0;
  for (const e of toc.entries) {
    if (names.has(e.name)) errors.push(`조각 이름이 겹칩니다: ${e.name}`);
    names.add(e.name);
    if (!CHUNK_NAME_RE.test(e.name)) errors.push(`조각 이름이 규칙 밖입니다: ${e.name}`);
    if (e.start < last || e.end < e.start || e.end > bytes.length) {
      errors.push(`조각 ${e.name} 자리가 겹치거나 순서가 틀리거나 파일 밖입니다(${e.start}–${e.end})`);
      continue;
    }
    last = e.end;
    if (!(e.kind in KIND_NAME)) {
      if (e.flags & FLAG_REQUIRED) errors.push(`꼭 알아야 하는 모르는 종류 ${e.kind}(조각 ${e.name}) — 새 webGBA 가 필요합니다`);
      else warnings.push(`모르는 종류 ${e.kind}(조각 ${e.name}) — 무시합니다`);
      continue;
    }
    const rule = CHUNK_RULES.find((r) => r.test(e.name));
    if (!rule) warnings.push(`규격 1 이 모르는 조각 이름 ${e.name}`);
    else {
      if (rule.kind !== e.kind) errors.push(`조각 ${e.name} 의 종류 ${e.kindName} 가 이름과 맞지 않습니다`);
      counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
    const st = stage(e);
    if (st < lastStage) errors.push(`조각 ${e.name} 의 순서가 틀립니다(목차 → 설명서·롬팩·JS → code → 데이터 → 롬)`);
    lastStage = Math.max(lastStage, st);
    if (e.method !== METHOD.store && e.method !== METHOD.zlib) errors.push(`조각 ${e.name}: 모르는 방식 ${e.method}`);
    if (e.method === METHOD.store && e.size !== e.end - e.start) errors.push(`조각 ${e.name}: 방식 0 인데 푼 크기 ${e.size} ≠ 저장 길이 ${e.end - e.start}`);
    const stored = bytes.subarray(e.start, e.end);
    if ((await sha256Hex(stored)) !== e.sha256) errors.push(`조각 ${e.name} 의 SHA-256 이 다릅니다`);
    if (e.kind === KIND.code) {
      codeEntry = e;
      const first = list.find((s) => s.start === e.start);
      const lastSec = list.find((s) => s.end === e.end);
      if (!first || !lastSec) errors.push("조각 code 의 경계가 wasm 구획 경계와 맞지 않습니다");
      if (list.some((s) => s.start >= e.start && s.end <= e.end && isOurs(s))) errors.push("조각 code 안에 webgba.* 구획이 있습니다");
      continue;
    }
    const sec = list.find((s) => s.id === 0 && s.payload === e.start && s.end === e.end);
    if (!sec || sec.name !== `${SECTION_PREFIX}${e.name}`) errors.push(`조각 ${e.name} 자리에 구획 ${SECTION_PREFIX}${e.name} 이 없습니다`);
  }
  for (const rule of CHUNK_RULES) {
    const n = counts.get(rule) ?? 0;
    if (n < rule.min) errors.push(rule.kind === KIND.manifest ? "설명서(manifest) 조각이 없습니다" : "조각 code 가 없습니다");
    if (n > rule.max) errors.push(`같은 종류 조각이 너무 많습니다(${KIND_NAME[rule.kind]} ${n}개)`);
  }
  const listed = new Set(toc.entries.map((e) => `${SECTION_PREFIX}${e.name}`));
  for (const s of list) if (isOurs(s) && s.name !== TOC_SECTION && !listed.has(s.name)) warnings.push(`목차에 없는 구획 ${s.name} — 무시합니다`);
  const romEntry = toc.entries.find((e) => e.name === "rom");
  if (romEntry && romEntry.end !== bytes.length) errors.push("rom 조각은 파일 맨 끝이어야 합니다(옛 앱 호환)");

  const get = (name, limit) => {
    const e = toc.entries.find((x) => x.name === name);
    if (!e || e.end > bytes.length) return null;
    if (limit && e.size > limit) throw new WgbaError(`조각 ${name} 이 ${limit}바이트를 넘습니다`, "tooBig");
    return unpackChunk(bytes.subarray(e.start, e.end), e);
  };
  let manifestBytes;
  try {
    manifestBytes = get("manifest", LIMITS.manifest);
  } catch (error) {
    errors.push(error.message);
  }
  if (!manifestBytes) return result;
  let m;
  try {
    m = JSON.parse(utf8Strict.decode(manifestBytes));
  } catch (error) {
    errors.push(`설명서 JSON 을 읽지 못했습니다: ${error.message}`);
    return result;
  }
  result.manifest = m;
  checkManifest(m, errors, warnings);
  let jsBytes = null;
  try {
    jsBytes = get("js", LIMITS.js);
  } catch (error) {
    errors.push(error.message);
  }
  const images = {};
  for (const part of Object.keys(CART_PARTS)) {
    try {
      images[part] = get(CART_PARTS[part].chunk, LIMITS.cart * 4);
    } catch (error) {
      errors.push(error.message);
    }
  }
  checkCart(m, images, errors, warnings);
  for (const e of toc.entries.filter((x) => x.kind === KIND.data)) {
    try {
      get(e.name);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (romEntry) {
    try {
      const header = romHeader(bytes.subarray(romEntry.start, romEntry.end));
      result.rom = header;
      if (deep) await unpackRom(bytes.subarray(romEntry.start, romEntry.end));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (m.rom?.sha1 && result.rom && m.rom.sha1 !== result.rom.sha1) warnings.push("설명서 rom.sha1 이 롬 조각의 SHA-1 과 다릅니다");

  if (compile && codeEntry) {
    let mod = null;
    try {
      mod = new WebAssembly.Module(codeWasm(bytes.subarray(codeEntry.start, codeEntry.end)));
    } catch (error) {
      errors.push(`조각 code 를 컴파일하지 못했습니다: ${error.message}`);
    }
    if (mod) {
      const exportsSet = new Set(WebAssembly.Module.exports(mod).map((x) => x.name));
      const imports = WebAssembly.Module.imports(mod);
      result.exports = [...exportsSet];
      result.imports = imports.map((x) => `${x.module}.${x.name}`);
      if (m.runtime === "webapi") {
        for (const need of WEBAPI_REQUIRED) if (!exportsSet.has(need)) errors.push(`webapi 필수 내보내기가 없습니다: ${need}`);
        let v1 = false;
        for (const imp of imports) {
          if (imp.module === "webgba" && imp.name === "v1" && imp.kind === "function") {
            v1 = true;
            continue;
          }
          const ok = imp.kind === "function" && ((imp.module === "env" && (WEBAPI_ENV.includes(imp.name) || /^invoke_[a-z]+$/.test(imp.name))) || (imp.module === "wasi_snapshot_preview1" && WEBAPI_WASI.includes(imp.name)));
          if (!ok) errors.push(`webapi 가 모르는 가져오기: ${imp.module}.${imp.name}`);
        }
        const net = WEBAPI_NET.filter((n) => exportsSet.has(n)).length;
        if (net && net < WEBAPI_NET.length) warnings.push(`Web_Net* 일곱 개 중 ${net}개만 있습니다 — 멀티플레이를 쓰지 않는 것으로 봅니다`);
        const w = m.screen?.width ?? 240;
        const h = m.screen?.height ?? 160;
        const customButtons = (m.input?.buttons ?? []).length > 0 || (m.input?.preset ?? "gba") !== "gba";
        if ((w !== 240 || h !== 160 || customButtons) && !v1) warnings.push("240x160·GBA 버튼이 아닌 ① 게임은 가져오기 webgba.v1 을 넣으세요(옛 webGBA 가 열지 않게)");
        else if (m.rom?.required === false && !v1) warnings.push("롬 없이 도는 ① 게임(rom.required false)은 가져오기 webgba.v1 을 넣으세요(옛 webGBA 가 롬을 묻지 않게)");
        const bits = new Set(GBA_PRESET.filter(() => (m.input?.preset ?? "gba") === "gba").map((b) => b.bit));
        const own = new Set();
        for (const b of m.input?.buttons ?? []) {
          if (!Number.isInteger(b.bit) || b.bit < 0 || b.bit > 31) errors.push(`버튼 ${b.id}: bit 가 0~31 이 아닙니다`);
          else if (own.has(b.bit) || (bits.has(b.bit) && !GBA_PRESET.some((p) => p.id === b.id && p.bit === b.bit))) errors.push(`버튼 ${b.id}: bit ${b.bit} 가 겹칩니다`);
          own.add(b.bit);
        }
        if (jsBytes) warnings.push("webapi 인데 js 조각이 있습니다(쓰지 않음)");
      } else if (m.runtime === "script") {
        if (!jsBytes) errors.push("script 인데 js 조각이 없습니다");
        if (imports.some((x) => x.kind === "memory" && x.type?.shared)) errors.push("공유 메모리(스레드) 빌드는 규격 1 에서 받지 않습니다");
        for (const b of m.input?.buttons ?? []) if (typeof b.code !== "string" || !/^[A-Za-z0-9]{1,24}$/.test(b.code)) errors.push(`버튼 ${b.id}: code(KeyboardEvent.code)가 없습니다`);
      }
    }
  }
  result.buildId = await buildId(toc);
  return result;
}

export { ROM_SECTION };
