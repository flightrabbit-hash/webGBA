import { deflate } from "../vendor/pako.js";

export const ROM_SECTION = "webgba.rom";
export const ROM_MAGIC = "WGRM";
export const ROM_HEADER = 36;
export const ROM_VERSION = 1;
export const ROM_STORE = 0;
export const ROM_ZLIB = 1;
export const MAX_ROM = 0x02000000;
export const PACK_LEVEL = 9;
export const PATCH_MAGIC = "WGBP";
export const PATCH_HEADER = 16;
export const PATCH_VERSION = 1;
export const GBA_ROM_SIZE = 0x01000000;

export class WgbpError extends Error {
  constructor(code, params = {}) {
    super(`${code}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`);
    this.name = "WgbpError";
    this.code = code;
    this.params = params;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha1Bytes(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", bytes));
}

export async function sha1Hex(bytes) {
  return hexOf(await sha1Bytes(bytes));
}

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
const u16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

function putU32(bytes, at, value) {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

export function concat(parts) {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function leb(value) {
  const out = [];
  let n = value;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Uint8Array.from(out);
}

export function customSection(name, payload) {
  const label = new TextEncoder().encode(name);
  const body = concat([leb(label.length), label, payload]);
  return concat([Uint8Array.of(0), leb(body.length), body]);
}

export function romPayloadFrom(rom, sha1, { store = false, level = PACK_LEVEL } = {}) {
  if (!rom.length) throw new WgbpError("romEmpty");
  if (rom.length > MAX_ROM) throw new WgbpError("romTooBig", { size: rom.length });
  const data = store ? rom : deflate(rom, { level });
  const head = new Uint8Array(ROM_HEADER);
  for (let i = 0; i < 4; i++) head[i] = ROM_MAGIC.charCodeAt(i);
  head[4] = ROM_HEADER & 0xff;
  head[5] = ROM_HEADER >> 8;
  head[6] = ROM_VERSION;
  head[7] = store ? ROM_STORE : ROM_ZLIB;
  putU32(head, 8, rom.length);
  putU32(head, 12, data.length);
  head.set(sha1.subarray(0, 20), 16);
  return concat([head, data]);
}

export async function romPayload(rom, options = {}) {
  return romPayloadFrom(rom, await sha1Bytes(rom), options);
}

export async function packWgba(wasm, rom, options = {}) {
  return concat([wasm, customSection(ROM_SECTION, await romPayload(rom, options))]);
}

export function readPatch(bytes) {
  if (bytes.length < PATCH_HEADER || ascii(bytes, 0, 4) !== PATCH_MAGIC) throw new WgbpError("notPatch");
  const headerSize = u16(bytes, 4);
  const version = bytes[6];
  if (version !== PATCH_VERSION) throw new WgbpError("patchVersion", { version });
  const size = u32(bytes, 8);
  if (headerSize < PATCH_HEADER || headerSize + size > bytes.length) throw new WgbpError("patchCorrupt", { why: "header" });
  const text = bytes.subarray(headerSize, headerSize + size);
  if (crc32(text) !== u32(bytes, 12)) throw new WgbpError("patchCorrupt", { why: "manifest" });
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(text));
  } catch {
    throw new WgbpError("patchCorrupt", { why: "manifest" });
  }
  if (manifest?.format !== PATCH_VERSION) throw new WgbpError("patchVersion", { version: manifest?.format });
  for (const need of ["rom", "wasm", "wgba", "refill", "bases"]) if (!manifest[need]) throw new WgbpError("patchCorrupt", { why: "manifest" });
  return { manifest, blobs: bytes.subarray(headerSize + size) };
}

async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readBlob(patch, entry) {
  if (!entry || !(entry.off >= 0) || !(entry.len >= 0) || entry.off + entry.len > patch.blobs.length) throw new WgbpError("patchCorrupt", { why: "range" });
  const raw = patch.blobs.subarray(entry.off, entry.off + entry.len);
  if ((await sha1Hex(raw)) !== entry.sha1) throw new WgbpError("patchCorrupt", { why: "sha1" });
  if (entry.method !== "zlib") return raw.slice();
  let out;
  try {
    out = await inflate(raw);
  } catch {
    throw new WgbpError("patchCorrupt", { why: "inflate" });
  }
  if (out.length !== entry.size) throw new WgbpError("patchCorrupt", { why: "size" });
  return out;
}

function readNumber(bytes, pos) {
  let data = 0;
  let shift = 1;
  for (;;) {
    if (pos.i >= bytes.length) throw new WgbpError("patchCorrupt", { why: "bps" });
    const x = bytes[pos.i++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) return data;
    shift *= 128;
    data += shift;
  }
}

export function bpsApply(source, patch) {
  const bad = () => new WgbpError("patchCorrupt", { why: "bps" });
  if (patch.length < 19 || ascii(patch, 0, 4) !== "BPS1") throw bad();
  const end = patch.length - 12;
  if (crc32(patch, 0, patch.length - 4) !== u32(patch, patch.length - 4)) throw bad();
  const pos = { i: 4 };
  const sourceSize = readNumber(patch, pos);
  const targetSize = readNumber(patch, pos);
  const metaSize = readNumber(patch, pos);
  pos.i += metaSize;
  if (source.length !== sourceSize || crc32(source) !== u32(patch, end)) throw bad();
  const target = new Uint8Array(targetSize);
  let out = 0;
  let sourceAt = 0;
  let targetAt = 0;
  while (pos.i < end) {
    const data = readNumber(patch, pos);
    const command = data % 4;
    const length = Math.floor(data / 4) + 1;
    if (out + length > targetSize) throw bad();
    if (command === 0) {
      if (out + length > source.length) throw bad();
      target.set(source.subarray(out, out + length), out);
    } else if (command === 1) {
      if (pos.i + length > end) throw bad();
      target.set(patch.subarray(pos.i, pos.i + length), out);
      pos.i += length;
    } else {
      const value = readNumber(patch, pos);
      const offset = (value % 2 ? -1 : 1) * Math.floor(value / 2);
      if (command === 2) {
        sourceAt += offset;
        if (sourceAt < 0 || sourceAt + length > source.length) throw bad();
        target.set(source.subarray(sourceAt, sourceAt + length), out);
        sourceAt += length;
      } else {
        targetAt += offset;
        if (targetAt < 0 || targetAt >= out) throw bad();
        for (let k = 0; k < length; k++) target[out + k] = target[targetAt + k];
        targetAt += length;
      }
    }
    out += length;
  }
  if (out !== targetSize || crc32(target) !== u32(patch, end + 4)) throw bad();
  return target;
}

export function romInfo(rom) {
  if (rom.length < 0xc0) return { code: "", title: "", revision: 0, gba: false };
  const text = (at, length) => ascii(rom, at, length).replace(/[^\x20-\x7e]/g, "").trim();
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += rom[i];
  const gba = rom[0xb2] === 0x96 && ((-(sum + 0x19)) & 0xff) === rom[0xbd];
  return { code: text(0xac, 4), title: text(0xa0, 12), revision: rom[0xbc], gba };
}

function sizeVariants(rom) {
  const out = [rom];
  if (rom.length < GBA_ROM_SIZE && rom.length >= 0x100000) {
    const padded = new Uint8Array(GBA_ROM_SIZE).fill(0xff);
    padded.set(rom);
    out.push(padded);
  } else if (rom.length > GBA_ROM_SIZE && rom.subarray(GBA_ROM_SIZE).every((b) => b === 0xff)) {
    out.push(rom.slice(0, GBA_ROM_SIZE));
  }
  return out;
}

export async function findBase(patch, rom) {
  const { manifest } = patch;
  const info = romInfo(rom);
  for (const bytes of sizeVariants(rom)) {
    const sha1 = await sha1Hex(bytes);
    if (sha1 === manifest.rom.sha1) throw new WgbpError("romAlready", { ...info, sha1 });
    const base = manifest.bases.find((item) => item.sha1 === sha1);
    if (base) return { base, bytes, info };
  }
  const sha1 = await sha1Hex(rom);
  const codes = manifest.bases.map((item) => item.code).filter(Boolean);
  if (!info.gba || !/^[A-Z0-9]{4}$/.test(info.code)) throw new WgbpError("romNotGba", { sha1 });
  if (codes.includes(info.code)) throw new WgbpError("romModified", { ...info, sha1 });
  if (codes.some((code) => code.slice(0, 3) === info.code.slice(0, 3))) throw new WgbpError("romOtherLang", { ...info, sha1 });
  throw new WgbpError("romOther", { ...info, sha1 });
}

export function decodeRefill(table) {
  const ranges = [];
  const pos = { i: 0 };
  const read = () => {
    let value = 0;
    let scale = 1;
    let byte;
    do {
      if (pos.i >= table.length) throw new WgbpError("patchCorrupt", { why: "refill" });
      byte = table[pos.i++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  };
  let last = 0;
  while (pos.i < table.length) {
    const at = last + read();
    const length = read();
    const from = read();
    ranges.push({ at, length, from });
    last = at + length;
  }
  return ranges;
}

export function encodeRefill(ranges) {
  const parts = [];
  let last = 0;
  for (const range of ranges) {
    parts.push(leb(range.at - last), leb(range.length), leb(range.from));
    last = range.at + range.length;
  }
  return concat(parts);
}

export async function buildGame(patch, rom, { onStep = async () => {} } = {}) {
  const { manifest } = patch;
  await onStep("check");
  const found = await findBase(patch, rom);
  let bytes = found.bytes;
  let sha1 = found.base.sha1;
  let refillRom = sha1 === manifest.refill.from ? bytes : null;
  for (let guard = 0; sha1 !== manifest.rom.sha1; guard++) {
    const base = manifest.bases.find((item) => item.sha1 === sha1);
    if (!base || guard >= manifest.bases.length) throw new WgbpError("patchCorrupt", { why: "chain" });
    await onStep("patch");
    bytes = bpsApply(bytes, await readBlob(patch, base.patch));
    sha1 = await sha1Hex(bytes);
    if (sha1 !== base.to) throw new WgbpError("resultMismatch", { what: "rom" });
    if (sha1 === manifest.refill.from) refillRom = bytes;
  }
  if (!refillRom) throw new WgbpError("patchCorrupt", { why: "refill" });
  await onStep("game");
  const wasm = await readBlob(patch, manifest.wasm.blob);
  if (wasm.length !== manifest.wasm.size) throw new WgbpError("patchCorrupt", { why: "size" });
  for (const range of decodeRefill(await readBlob(patch, manifest.refill.table))) {
    if (range.at + range.length > wasm.length || range.from + range.length > refillRom.length) throw new WgbpError("patchCorrupt", { why: "refill" });
    wasm.set(refillRom.subarray(range.from, range.from + range.length), range.at);
  }
  if ((await sha1Hex(wasm)) !== manifest.wasm.sha1) throw new WgbpError("resultMismatch", { what: "wasm" });
  await onStep("pack");
  const wgba = await packWgba(wasm, bytes, { level: manifest.pack?.level ?? PACK_LEVEL });
  const wgbaSha1 = await sha1Hex(wgba);
  return { wgba, base: found.base, sha1: wgbaSha1, same: wgbaSha1 === manifest.wgba.sha1 };
}
