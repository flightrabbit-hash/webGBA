// .wgba 묶기: 웹 빌드 wasm 끝에 사용자 정의 구획(custom section) `webgba.rom` 하나로 롬을 붙인다. node 18+, 의존성 없음.
//
//   node tools/pack-wgba.mjs <빌드.wasm|.wgba> <롬.gba> <출력.wgba> [--store] [--level <0-9>]
//   node tools/pack-wgba.mjs --info <파일>                      묶인 롬 정보만 본다(SHA-1·크기·방식)
//   node tools/pack-wgba.mjs --strip <파일.wgba> <출력.wasm>     롬 구획을 뺀다
//
// 사용자 정의 구획은 wasm 엔진이 무시하므로 출력은 그대로 올바른 wasm 이다. 입력에 이미 구획이 있으면 바꿔 넣는다.
// 구획이 없던 wasm 을 묶으면 출력의 앞부분은 입력 wasm 과 바이트까지 같고, 구획은 맨 끝에 붙는다.
// 출력은 옆에 임시 파일로 쓴 뒤 다시 읽어 확인(wasm 검사·압축 풀기·SHA-1)하고 나서 이름을 바꾼다.
//
// 구획 내용(little endian, 머리 36바이트):
//   0  "WGRM"   4  머리 길이 u16(36)   6  형식 판 u8(1)   7  방식 u8(0 그대로, 1 zlib)
//   8  롬 크기 u32   12  묶은 크기 u32   16  롬 SHA-1 20바이트   36  묶은 롬
// zlib 은 RFC 1950 — 웹뷰가 DecompressionStream("deflate") 로 푼다. 읽는 쪽: web-host.js 의 readEmbeddedRom, Rust 는 embed.rs.
//
// 롬은 배포하지 않는다. 이 도구는 롬을 가진 사람이 자기 PC 에서 묶을 때만 쓰고, 묶은 .wgba 는 공개 저장소·릴리스에 넣지 않는다.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

export const SECTION = "webgba.rom";
export const MAGIC = "WGRM";
export const HEADER_SIZE = 36;
export const VERSION = 1;
export const METHOD_STORE = 0;
export const METHOD_ZLIB = 1;
export const MAX_ROM = 0x02000000;

function leb(value) {
  const out = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Buffer.from(out);
}

function readLeb(buf, at) {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (at >= buf.length) throw new Error("wasm 이 중간에 끊겼습니다(LEB128)");
    const byte = buf[at++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [value, at];
    shift += 7;
    if (shift > 28) throw new Error("wasm 구획 크기가 너무 깁니다(LEB128)");
  }
}

/** wasm 구획 목록. 사용자 정의 구획(id 0)은 이름과 내용 시작 위치도 준다. */
export function sections(buf) {
  if (buf.length < 8 || buf.readUInt32LE(0) !== 0x6d736100) throw new Error("wasm 이 아닙니다(첫 4바이트가 \\0asm 이 아님)");
  if (buf.readUInt32LE(4) !== 1) throw new Error(`모르는 wasm 판입니다: ${buf.readUInt32LE(4)}`);
  const list = [];
  let at = 8;
  while (at < buf.length) {
    const start = at;
    const id = buf[at++];
    let size;
    [size, at] = readLeb(buf, at);
    const end = at + size;
    if (end > buf.length) throw new Error(`구획 ${list.length}(id ${id})이 파일 끝을 넘습니다`);
    let name = null;
    let payload = at;
    if (id === 0) {
      let len;
      [len, payload] = readLeb(buf, at);
      if (payload + len > end) throw new Error(`사용자 정의 구획 ${list.length} 의 이름이 구획을 넘습니다`);
      name = buf.toString("utf8", payload, payload + len);
      payload += len;
    }
    list.push({ id, start, end, name, payload });
    at = end;
  }
  return list;
}

/** 묶인 롬 구획(여럿이면 마지막). 없으면 null. */
export function findRomSection(buf) {
  return sections(buf).filter((s) => s.id === 0 && s.name === SECTION).at(-1) ?? null;
}

export function readHeader(payload) {
  if (payload.length < HEADER_SIZE || payload.toString("latin1", 0, 4) !== MAGIC) throw new Error("롬 구획 머리를 읽지 못했습니다(WGRM 아님)");
  const headerSize = payload.readUInt16LE(4);
  const header = {
    headerSize,
    version: payload[6],
    method: payload[7],
    size: payload.readUInt32LE(8),
    packed: payload.readUInt32LE(12),
    sha1: payload.subarray(16, 36).toString("hex"),
  };
  if (header.version !== VERSION) throw new Error(`모르는 롬 구획 형식 판입니다: ${header.version}`);
  if (headerSize < HEADER_SIZE || headerSize + header.packed > payload.length) throw new Error("롬 구획 크기가 맞지 않습니다");
  return header;
}

/** 구획 내용 → 롬. 크기·SHA-1 을 확인한다. */
export function unpackPayload(payload) {
  const header = readHeader(payload);
  const data = payload.subarray(header.headerSize, header.headerSize + header.packed);
  let rom;
  if (header.method === METHOD_STORE) rom = Buffer.from(data);
  else if (header.method === METHOD_ZLIB) rom = zlib.inflateSync(data);
  else throw new Error(`모르는 압축 방식입니다: ${header.method}`);
  if (rom.length !== header.size) throw new Error(`풀린 롬 크기가 다릅니다: ${rom.length} / ${header.size}`);
  const sha1 = crypto.createHash("sha1").update(rom).digest("hex");
  if (sha1 !== header.sha1) throw new Error(`풀린 롬의 SHA-1 이 다릅니다: ${sha1} / ${header.sha1}`);
  return { rom, header };
}

/** 롬 → 구획 내용(머리 + 묶은 롬). */
export function makePayload(rom, { store = false, level = 9 } = {}) {
  if (!rom.length) throw new Error("롬이 비어 있습니다");
  if (rom.length > MAX_ROM) throw new Error(`롬이 32MB 보다 큽니다: ${rom.length}바이트`);
  const data = store ? rom : zlib.deflateSync(rom, { level });
  const head = Buffer.alloc(HEADER_SIZE);
  head.write(MAGIC, 0, "latin1");
  head.writeUInt16LE(HEADER_SIZE, 4);
  head[6] = VERSION;
  head[7] = store ? METHOD_STORE : METHOD_ZLIB;
  head.writeUInt32LE(rom.length, 8);
  head.writeUInt32LE(data.length, 12);
  crypto.createHash("sha1").update(rom).digest().copy(head, 16);
  return Buffer.concat([head, data]);
}

/** wasm 에서 롬 구획을 모두 뺀 바이트. 구획이 없으면 입력 그대로. */
export function stripRom(wasm) {
  const keep = sections(wasm).filter((s) => !(s.id === 0 && s.name === SECTION));
  if (keep.length === sections(wasm).length) return wasm;
  return Buffer.concat([wasm.subarray(0, 8), ...keep.map((s) => wasm.subarray(s.start, s.end))]);
}

/** wasm + 롬 → .wgba 바이트. */
export function pack(wasm, rom, options = {}) {
  const base = stripRom(wasm);
  const payload = makePayload(rom, options);
  const name = Buffer.from(SECTION, "utf8");
  const body = Buffer.concat([leb(name.length), name, payload]);
  return Buffer.concat([base, Buffer.from([0]), leb(body.length), body]);
}

const hex = (n) => n.toLocaleString("en-US");

function writeChecked(out, bytes, check) {
  const tmp = `${out}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  try {
    const back = fs.readFileSync(tmp);
    if (!back.equals(bytes)) throw new Error("임시 파일을 다시 읽으니 내용이 다릅니다");
    if (!WebAssembly.validate(back)) throw new Error("묶은 결과가 올바른 wasm 이 아닙니다");
    check(back);
    fs.renameSync(tmp, out);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function info(file) {
  const buf = fs.readFileSync(file);
  const found = findRomSection(buf);
  if (!found) {
    console.log(`${path.basename(file)} ${hex(buf.length)}바이트 · 롬 구획 없음`);
    return 3;
  }
  const payload = buf.subarray(found.payload, found.end);
  const { header } = unpackPayload(payload);
  console.log(`${path.basename(file)} ${hex(buf.length)}바이트 · 롬 구획 ${hex(found.end - found.start)}바이트(파일 ${hex(found.start)}부터)`);
  console.log(`형식 판 ${header.version} · 방식 ${header.method === METHOD_ZLIB ? "zlib" : "그대로"} · 롬 ${hex(header.size)}바이트 → ${hex(header.packed)}바이트 · 풀어서 확인함`);
  console.log(`SHA-1 ${header.sha1}`);
  return 0;
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const levelAt = argv.indexOf("--level");
  const level = levelAt >= 0 ? Number(argv[levelAt + 1]) : 9;
  const args = argv.filter((a, i) => !a.startsWith("--") && !(levelAt >= 0 && i === levelAt + 1));
  if (flags.has("--info")) {
    if (args.length !== 1) return usage();
    return info(args[0]);
  }
  if (flags.has("--strip")) {
    if (args.length !== 2) return usage();
    const wasm = fs.readFileSync(args[0]);
    const out = stripRom(wasm);
    writeChecked(path.resolve(args[1]), out, (back) => {
      if (findRomSection(back)) throw new Error("롬 구획이 남았습니다");
    });
    console.log(`롬 구획을 뺐습니다: ${hex(wasm.length)} → ${hex(out.length)}바이트 · ${path.basename(args[1])}`);
    return 0;
  }
  if (args.length !== 3 || !Number.isInteger(level) || level < 0 || level > 9) return usage();
  const [wasmPath, romPath, outPath] = args;
  const started = Date.now();
  const wasm = fs.readFileSync(wasmPath);
  const rom = fs.readFileSync(romPath);
  if (rom.length < 0xc0 || rom[0xb2] !== 0x96) console.warn(`주의: ${path.basename(romPath)} 은(는) GBA 롬 머리(0xB2 = 0x96)가 아닙니다. 그대로 묶습니다.`);
  const replaced = Boolean(findRomSection(wasm));
  const store = flags.has("--store");
  const bytes = pack(wasm, rom, { store, level });
  const sha1 = crypto.createHash("sha1").update(rom).digest("hex");
  writeChecked(path.resolve(outPath), bytes, (back) => {
    const found = findRomSection(back);
    if (!found) throw new Error("묶은 결과에 롬 구획이 없습니다");
    const { header } = unpackPayload(back.subarray(found.payload, found.end));
    if (header.sha1 !== sha1) throw new Error("묶은 결과의 SHA-1 이 롬과 다릅니다");
  });
  const packed = findRomSection(bytes);
  const romBytes = packed.end - packed.payload - HEADER_SIZE;
  console.log(`wasm  ${path.basename(wasmPath)} ${hex(wasm.length)}바이트${replaced ? " (있던 롬 구획을 바꿈)" : ""}`);
  console.log(`롬    ${path.basename(romPath)} ${hex(rom.length)}바이트 → ${store ? "그대로" : `zlib ${level}`} ${hex(romBytes)}바이트(${((romBytes / rom.length) * 100).toFixed(1)}%)`);
  console.log(`출력  ${path.basename(outPath)} ${hex(bytes.length)}바이트 · ${((Date.now() - started) / 1000).toFixed(1)}초 · 다시 읽어 확인함`);
  console.log(`SHA-1 ${sha1}`);
  return 0;
}

function usage() {
  console.error("사용법: node tools/pack-wgba.mjs <빌드.wasm|.wgba> <롬.gba> <출력.wgba> [--store] [--level <0-9>]");
  console.error("        node tools/pack-wgba.mjs --info <파일>");
  console.error("        node tools/pack-wgba.mjs --strip <파일.wgba> <출력.wasm>");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`실패: ${error.message}`);
    process.exitCode = 1;
  }
}
