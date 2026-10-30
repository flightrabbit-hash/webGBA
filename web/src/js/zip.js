import { inflateRaw } from "./vendor/pako.js";

const ROM_EXT = /\.(gba|agb|bin)$/i;
const MAX_ROM = 0x02000000;

export class ZipError extends Error {
  constructor(code, detail = "") {
    super(detail || code);
    this.code = code;
  }
}

export function extractRom(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("read", "EOCD");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const found = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new ZipError("read", "CD");
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (ROM_EXT.test(name) && !name.endsWith("/")) found.push({ name, method, packed, size, local });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (!found.length) throw new ZipError("noRom");
  found.sort((a, b) => b.size - a.size);
  const entry = found.find((item) => /\.(gba|agb)$/i.test(item.name)) ?? found[0];
  if (entry.size > MAX_ROM) throw new ZipError("tooBig");
  if (view.getUint32(entry.local, true) !== 0x04034b50) throw new ZipError("read", "LH");
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const raw = bytes.subarray(start, start + entry.packed);
  let rom;
  if (entry.method === 0) rom = raw.slice();
  else if (entry.method === 8) {
    try {
      rom = inflateRaw(raw);
    } catch (error) {
      throw new ZipError("read", String(error?.message ?? error));
    }
  } else throw new ZipError("read", `method ${entry.method}`);
  if (!rom || rom.length !== entry.size) throw new ZipError("read", "size");
  return { name: entry.name.slice(entry.name.lastIndexOf("/") + 1), bytes: rom };
}
