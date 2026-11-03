import { Inflate } from "../vendor/pako.js";
import { crc32, crc32Step, MAX_ROM, WgbpError } from "./wgbp.js";

export const ZIP_MAX = 0x10000000;
const ROM_NAME = /\.(gba|agb|bin)$/i;
const GAME_NAME = /\.(gba|agb|bin|gb|gbc)$/i;
const GAME_FILE = /\.(wgba|wasm|gba|agb|gb|gbc|bin)$/i;
const WEB_FILE = /\.(wgba|wasm)$/i;
const SLICE = 0x40000;
const SLICE_MS = 12;
const BIN_NAME = /\.bin$/i;
const METHOD_NAMES = { 1: "Shrink", 6: "Implode", 9: "Deflate64", 12: "BZIP2", 14: "LZMA", 93: "Zstandard", 95: "XZ", 96: "JPEG", 97: "WavPack", 98: "PPMd" };
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;

export class ZipError extends WgbpError {
  constructor(code, params = {}) {
    super(code, params);
    this.name = "ZipError";
  }
}

const u16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const u64 = (bytes, at) => u32(bytes, at) + u32(bytes, at + 4) * 0x100000000;
const corrupt = (why) => new ZipError("zipCorrupt", { why });

export const isZip = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));

const utf8 = new TextDecoder("utf-8", { fatal: true });
const legacy = (() => {
  try {
    return new TextDecoder("euc-kr");
  } catch {
    return new TextDecoder("latin1");
  }
})();

function nameOf(raw, flags) {
  let text;
  try {
    text = utf8.decode(raw);
  } catch {
    text = flags & 0x800 ? new TextDecoder().decode(raw) : legacy.decode(raw);
  }
  return text.replace(/\\/g, "/");
}

const baseName = (name) => name.slice(name.lastIndexOf("/") + 1);

function findEnd(bytes) {
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(bytes, at) === END && at + 22 + u16(bytes, at + 20) <= bytes.length) return at;
  }
  throw corrupt("end");
}

function directory(bytes) {
  const end = findEnd(bytes);
  let count = u16(bytes, end + 10);
  let size = u32(bytes, end + 12);
  let at = u32(bytes, end + 16);
  let disks = u16(bytes, end + 4) | u16(bytes, end + 6);
  if (count === 0xffff || size === 0xffffffff || at === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || u32(bytes, locator) !== LOCATOR64) throw corrupt("zip64");
    const head = u64(bytes, locator + 8);
    if (head + 56 > bytes.length || u32(bytes, head) !== END64) throw corrupt("zip64");
    disks = u32(bytes, head + 16) | u32(bytes, head + 20);
    count = u64(bytes, head + 32);
    size = u64(bytes, head + 40);
    at = u64(bytes, head + 48);
  }
  if (disks) throw corrupt("disk");
  if (at + size > bytes.length) throw corrupt("directory");
  return { count, at, stop: at + size };
}

function widen(entry, extra) {
  for (let i = 0; i + 4 <= extra.length; i += 4 + u16(extra, i + 2)) {
    if (u16(extra, i) !== 1) continue;
    let p = i + 4;
    const stop = Math.min(extra.length, p + u16(extra, i + 2));
    for (const key of ["size", "packed", "local"]) {
      if (entry[key] !== 0xffffffff) continue;
      if (p + 8 > stop) throw corrupt("zip64");
      entry[key] = u64(extra, p);
      p += 8;
    }
    return;
  }
}

export function zipEntries(bytes) {
  const dir = directory(bytes);
  const entries = [];
  let at = dir.at;
  for (let n = 0; n < dir.count; n++) {
    if (at + 46 > dir.stop || u32(bytes, at) !== CENTRAL) throw corrupt("directory");
    const flags = u16(bytes, at + 8);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const next = at + 46 + nameLength + extraLength + u16(bytes, at + 32);
    if (next > dir.stop) throw corrupt("directory");
    const entry = {
      name: nameOf(bytes.subarray(at + 46, at + 46 + nameLength), flags),
      flags,
      method: u16(bytes, at + 10),
      crc: u32(bytes, at + 16),
      packed: u32(bytes, at + 20),
      size: u32(bytes, at + 24),
      local: u32(bytes, at + 42),
    };
    widen(entry, bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength));
    entries.push(entry);
    at = next;
  }
  return entries;
}

const hidden = (name) => name.endsWith("/") || /(^|\/)__MACOSX\//.test(name) || baseName(name).startsWith("._");

export function zipRoms(entries, names = ROM_NAME) {
  const roms = entries.filter((entry) => names.test(entry.name) && !hidden(entry.name));
  return [...roms.filter((entry) => !BIN_NAME.test(entry.name)), ...roms.filter((entry) => BIN_NAME.test(entry.name))];
}

function inflated(raw, size) {
  const out = new Uint8Array(size);
  let filled = 0;
  const inflator = new Inflate({ raw: true, chunkSize: 0x10000 });
  inflator.onData = (chunk) => {
    if (filled + chunk.length > size) throw corrupt("size");
    out.set(chunk, filled);
    filled += chunk.length;
  };
  inflator.push(raw, true);
  if (!inflator.ended || inflator.err || filled !== size) throw corrupt("inflate");
  return out;
}

function problemOf(entry, max) {
  if (entry.flags & 1 || entry.method === 99) return new ZipError("zipEncrypted");
  if (entry.method !== 0 && entry.method !== 8) return new ZipError("zipMethod", { method: METHOD_NAMES[entry.method] ?? `#${entry.method}` });
  if (entry.size > max) return new ZipError("romTooBig", { size: entry.size, max });
  return null;
}

function packedOf(bytes, entry) {
  const at = entry.local;
  if (at + 30 > bytes.length || u32(bytes, at) !== LOCAL) throw corrupt("local");
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  if (start + entry.packed > bytes.length) throw corrupt("local");
  const raw = bytes.subarray(start, start + entry.packed);
  if (entry.method === 0 && raw.length !== entry.size) throw corrupt("size");
  return raw;
}

export function zipRead(bytes, entry) {
  const problem = problemOf(entry, MAX_ROM);
  if (problem) throw problem;
  const raw = packedOf(bytes, entry);
  const out = entry.method === 0 ? raw.slice() : inflated(raw, entry.size);
  if (crc32(out) !== entry.crc) throw corrupt("crc");
  return out;
}

export const zipName = (raw, flags = 0) => nameOf(raw, flags);

export const entryMax = (name, romMax = MAX_ROM) => (WEB_FILE.test(name) ? ZIP_MAX : romMax);

const order = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const byPath = (a, b) => order(a.name, b.name) || order(a.path, b.path);

export function zipGames(entries, { romMax = MAX_ROM } = {}) {
  return entries
    .filter((entry) => GAME_FILE.test(entry.name) && !hidden(entry.name))
    .map((entry) => {
      const name = baseName(entry.name);
      const max = entryMax(name, romMax);
      return { entry, path: entry.name, name, ext: name.slice(name.lastIndexOf(".") + 1).toLowerCase(), size: entry.size, max, problem: problemOf(entry, max) };
    })
    .sort(byPath);
}

const pauseNow = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function zipReadAsync(bytes, entry, { max = entryMax(entry.name), onProgress = () => {}, pause = pauseNow, signal = null } = {}) {
  const problem = problemOf(entry, max);
  if (problem) throw problem;
  const raw = packedOf(bytes, entry);
  const out = new Uint8Array(entry.size);
  let filled = 0;
  let crc = 0xffffffff;
  let last = performance.now();
  const breathe = async (fraction) => {
    if (signal?.aborted) throw new ZipError("zipCancelled");
    if (performance.now() - last < SLICE_MS) return;
    onProgress(fraction);
    await pause();
    if (signal?.aborted) throw new ZipError("zipCancelled");
    last = performance.now();
  };
  if (entry.method === 0) {
    for (let at = 0; at < raw.length; at += SLICE) {
      const end = Math.min(raw.length, at + SLICE);
      out.set(raw.subarray(at, end), at);
      crc = crc32Step(crc, raw, at, end);
      await breathe(end / raw.length);
    }
    filled = raw.length;
  } else {
    const inflator = new Inflate({ raw: true, chunkSize: 0x10000 });
    inflator.onData = (chunk) => {
      if (filled + chunk.length > entry.size) throw corrupt("size");
      out.set(chunk, filled);
      crc = crc32Step(crc, chunk);
      filled += chunk.length;
    };
    if (!raw.length) inflator.push(raw, true);
    for (let at = 0; at < raw.length && !inflator.ended; at += SLICE) {
      const end = Math.min(raw.length, at + SLICE);
      inflator.push(raw.subarray(at, end), end === raw.length);
      if (inflator.err) throw corrupt("inflate");
      await breathe(end / raw.length);
    }
    if (!inflator.ended || inflator.err || filled !== entry.size) throw corrupt("inflate");
  }
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw corrupt("crc");
  onProgress(1);
  return out;
}

export function zipFile(bytes) {
  if (!isZip(bytes)) throw corrupt("format");
  return bytes;
}

export function romChoices(bytes) {
  if (!isZip(bytes)) return bytes;
  const roms = zipRoms(zipEntries(bytes));
  if (!roms.length) throw new ZipError("zipNoRom");
  return roms.map((entry) => ({ name: baseName(entry.name), read: () => zipRead(bytes, entry) }));
}

export function extractRom(bytes) {
  const roms = zipRoms(zipEntries(bytes), GAME_NAME).sort((a, b) => b.size - a.size);
  if (!roms.length) throw new ZipError("zipNoRom");
  const entry = roms.find((item) => !BIN_NAME.test(item.name)) ?? roms[0];
  return { name: baseName(entry.name), bytes: zipRead(bytes, entry) };
}
