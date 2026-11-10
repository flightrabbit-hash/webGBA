import { inflateSync } from "node:zlib";

const WASM_HEAD = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const LABEL_MAX = 262144;
const MANIFEST_MAX = 1048576;
const NAME_MAX = 120;

function leb(bytes, at) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    const b = bytes[at + i];
    if (b === undefined) return null;
    value += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(b & 0x80)) return { value, next: at + i + 1 };
  }
  return null;
}

/** 파일 앞부분(TOC 포함) → chunk 표. 형식이 다르면 null. */
export function readToc(head) {
  if (head.length < 32 || WASM_HEAD.some((b, i) => head[i] !== b) || head[8] !== 0) return null;
  const size = leb(head, 9);
  if (!size) return null;
  const nameLen = leb(head, size.next);
  if (!nameLen) return null;
  const name = new TextDecoder().decode(head.subarray(nameLen.next, nameLen.next + nameLen.value));
  if (name !== "webgba.toc") return null;
  const at = nameLen.next + nameLen.value;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (at + 16 > head.length || String.fromCharCode(...head.subarray(at, at + 4)) !== "WGTC" || head[at + 4] !== 1) return null;
  const headLen = view.getUint16(at + 6, true);
  const entryLen = view.getUint16(at + 8, true);
  const count = view.getUint16(at + 10, true);
  if (entryLen < 48 || count > 256 || at + headLen + entryLen * count > head.length) return null;
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const p = at + headLen + entryLen * i;
    const raw = head.subarray(p, p + 32);
    const zero = raw.indexOf(0);
    const chunk = String.fromCharCode(...(zero < 0 ? raw : raw.subarray(0, zero)));
    entries.set(chunk, { start: view.getUint32(p + 32, true), end: view.getUint32(p + 36, true), size: view.getUint32(p + 40, true), method: head[p + 44] });
  }
  return { entries, fileSize: view.getUint32(at + 12, true) };
}

function unpack(entry, bytes, max) {
  if (entry.size > max) return null;
  if (entry.method === 0) return bytes;
  if (entry.method !== 1) return null;
  try {
    const out = inflateSync(bytes, { maxOutputLength: max });
    return out.length === entry.size ? new Uint8Array(out) : null;
  } catch {
    return null;
  }
}

const textOk = (value) => typeof value === "string" && value.length > 0 && value.length <= NAME_MAX;

function cleanNames(value) {
  if (textOk(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const lang of ["ko", "en", "ja"]) if (textOk(value[lang])) out[lang] = value[lang];
  return Object.keys(out).length ? out : null;
}

/**
 * 파일 앞부분 → { id, version, names, short, label }. 필요한 바이트가 앞부분 밖이면 need = [start, end] 범위를 돌려준다.
 * label = "data:image/png;base64,…"(PNG·WebP만).
 */
export function readHead(head, extra = null) {
  const toc = readToc(head);
  if (!toc) return { bad: true };
  const bytesOf = (entry) => {
    if (entry.end <= head.length) return head.subarray(entry.start, entry.end);
    if (extra && entry.start >= extra.start && entry.end <= extra.start + extra.bytes.length) return extra.bytes.subarray(entry.start - extra.start, entry.end - extra.start);
    return null;
  };
  const manifestEntry = toc.entries.get("manifest");
  if (!manifestEntry || manifestEntry.end <= manifestEntry.start || manifestEntry.end - manifestEntry.start > MANIFEST_MAX) return { bad: true };
  const stored = bytesOf(manifestEntry);
  if (!stored) return { need: [manifestEntry.start, manifestEntry.end] };
  const text = unpack(manifestEntry, stored, MANIFEST_MAX);
  let manifest = null;
  try {
    manifest = text ? JSON.parse(new TextDecoder().decode(text)) : null;
  } catch {}
  if (!manifest || typeof manifest !== "object" || typeof manifest.id !== "string") return { bad: true };
  let label = null;
  const labelEntry = toc.entries.get("cart.label");
  const labelBytes = labelEntry && labelEntry.end - labelEntry.start <= LABEL_MAX ? bytesOf(labelEntry) : null;
  const image = labelBytes ? unpack(labelEntry, labelBytes, LABEL_MAX) : null;
  if (image) {
    const png = image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47;
    const webp = String.fromCharCode(...image.subarray(0, 4)) === "RIFF" && String.fromCharCode(...image.subarray(8, 12)) === "WEBP";
    if (png || webp) label = `data:image/${png ? "png" : "webp"};base64,${Buffer.from(image).toString("base64")}`;
  }
  return {
    id: manifest.id.slice(0, 128),
    version: typeof manifest.version === "string" ? manifest.version.slice(0, 32) : "",
    names: cleanNames(manifest.name),
    short: cleanNames(manifest.shortName),
    label,
    fileSize: toc.fileSize,
  };
}
