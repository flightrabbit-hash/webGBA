// .wgbp(롬이 들어 있지 않은 공유용 패치) 만들기. node 18+, 저장소 안 코드만 씀(pako 는 src-bundle/src/js/vendor).
//
//   node tools/make-wgbp.mjs <빌드.wasm|.wgba> <결과 롬.gba> <출력.wgbp> --base <원본.gba> [--label 이름] [--hidden]
//                            [--base <원본2.gba> [--label …] [--hidden]] … [--title 글] [--min 32]
//
// 첫 --base 가 바탕 롬이다: 바탕 → 결과 롬 BPS 를 넣고, wasm 안에서 바탕 롬과 같은 구간(32바이트 이상)을 0 으로 비워
// "다시 채우기 표"(wasm 자리 · 길이 · 바탕 롬 자리)를 넣는다. 다른 --base 는 바탕 롬으로 가는 BPS 만 넣는다(1.1 → 1.0 등).
// --hidden 은 "쓸 수 있는 롬" 안내 목록에서 빼는 것(받기는 함). 입력이 롬을 묶은 .wgba 면 구획을 뺀 wasm 을 쓴다.
//
// 만든 뒤 스스로 확인한다: 받는 모든 --base 롬으로 앱과 같은 코드(src-bundle/src/js/core/wgbp.js 의 buildGame)로 .wgba 를
// 만들어, pack-wgba 로 묶은 기준(wasm + 결과 롬, pako 9)과 바이트까지 같은지 본다. 비운 wasm 에 바탕 롬과 32바이트 이상
// 같은 구간이 남았는지, 패치 덩어리 안에 바탕 롬과 같은 구간이 얼마나 있는지도 알린다.
//
// 형식(little endian): 0 "WGBP" · 4 머리 길이 u16(16) · 6 형식 판 u8(1) · 7 0 · 8 manifest 길이 u32 · 12 manifest CRC32 ·
// 16 manifest(JSON, utf8) · 이어서 덩어리. manifest 의 { off, len } 은 덩어리 시작 기준, sha1 은 저장된 바이트의 SHA-1,
// method "zlib"(RFC 1950, pako 9) 이면 size 는 푼 크기. 자세한 것은 documents/markdown/설계.md 8절.
//
// 롬은 출력에 들어가지 않는다(바탕 롬과 같은 구간은 비우고, 패치는 차이만). 출력과 시험 결과(.wgba)는 롬을 가진 사람의
// PC 안에서만 쓰고, 묶은 .wgba 는 나눠 주지 않는다.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { deflate } from "../src-bundle/src/js/vendor/pako.js";
import { buildGame, crc32, encodeRefill, packWgba, PATCH_HEADER, PATCH_MAGIC, PATCH_VERSION, readPatch, romInfo } from "../src-bundle/src/js/core/wgbp.js";
import { findRomRanges, indexRom } from "./lib/rom-ranges.mjs";
import { makeBps } from "./lib/bps-make.mjs";
import { sections, stripRom } from "./pack-wgba.mjs";

const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

function parseArgs(argv) {
  const positional = [];
  const bases = [];
  const options = { title: "", min: 32 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") bases.push({ file: argv[++i], label: "", hidden: false });
    else if (a === "--label") bases.at(-1).label = argv[++i];
    else if (a === "--hidden") bases.at(-1).hidden = true;
    else if (a === "--title") options.title = argv[++i];
    else if (a === "--min") options.min = Number(argv[++i]);
    else positional.push(a);
  }
  return { positional, bases, options };
}

const { positional, bases, options } = parseArgs(process.argv.slice(2));
if (positional.length !== 3 || !bases.length || bases.some((b) => !b.file)) {
  console.error("사용법: node tools/make-wgbp.mjs <빌드.wasm|.wgba> <결과 롬.gba> <출력.wgbp> --base <원본.gba> [--label 이름] [--hidden] … [--title 글]");
  process.exit(2);
}
const [inputPath, targetPath, outPath] = positional;
const t0 = Date.now();
const wasm = new Uint8Array(stripRom(fs.readFileSync(inputPath)));
const target = new Uint8Array(fs.readFileSync(targetPath));
const roms = bases.map((b) => ({ ...b, bytes: new Uint8Array(fs.readFileSync(b.file)) }));
const primary = roms[0];
for (const r of roms) r.sha1 = sha1(r.bytes);
if (new Set(roms.map((r) => r.sha1)).size !== roms.length) throw new Error("같은 롬이 --base 에 두 번 있습니다");
if (roms.some((r) => r.sha1 === sha1(target))) throw new Error("--base 롬이 결과 롬과 같습니다");

console.log(`wasm ${wasm.length}바이트 SHA-1 ${sha1(wasm)} · 결과 롬 ${target.length}바이트 SHA-1 ${sha1(target)}`);
const index = indexRom(primary.bytes);
const ranges = findRomRanges(index, wasm, { min: options.min });
const blank = Uint8Array.from(wasm);
for (const r of ranges) blank.fill(0, r.at, r.at + r.length);
const refillBytes = ranges.reduce((s, r) => s + r.length, 0);
const gaps = [];
{
  const all = sections(Buffer.from(wasm.buffer, wasm.byteOffset, wasm.byteLength)).map((s) => [s.start, s.end]);
  for (const [s, e] of all) {
    let at = s;
    for (const r of ranges) {
      if (r.at + r.length <= s || r.at >= e) continue;
      if (r.at > at) gaps.push([at, r.at]);
      at = Math.max(at, r.at + r.length);
    }
    if (at < e) gaps.push([at, e]);
  }
}
const leftover = findRomRanges(index, blank, { min: options.min, passes: 1, spans: gaps });
console.log(`비우기: 바탕 롬과 ${options.min}바이트 이상 같은 구간 ${ranges.length}개 ${refillBytes}바이트 → 비운 wasm 에 남은 구간 ${leftover.length}개`);

const blobs = [];
let blobAt = 0;
function put(bytes, { zlib = true } = {}) {
  const stored = zlib ? deflate(bytes, { level: 9 }) : bytes;
  const entry = { off: blobAt, len: stored.length, sha1: sha1(stored), method: zlib ? "zlib" : "store", size: bytes.length };
  blobs.push(stored);
  blobAt += stored.length;
  return entry;
}

const patchBytes = [];
const baseEntries = [];
for (const r of roms) {
  const to = r === primary ? target : primary.bytes;
  const toSha = sha1(to);
  const info = romInfo(r.bytes);
  const label = r.label || `${info.title || "?"} (${info.code || "?"}) rev ${info.revision}`;
  const t1 = Date.now();
  const bps = makeBps(r.bytes, to, `${label} -> ${r === primary ? options.title || "target" : primary.label || "base"}`);
  patchBytes.push({ label, bps });
  console.log(`패치 ${label} → ${r === primary ? "결과" : "바탕"}: ${bps.length}바이트 (${((Date.now() - t1) / 1000).toFixed(1)}초)`);
  baseEntries.push({ sha1: r.sha1, size: r.bytes.length, code: info.code, revision: info.revision, name: label, main: !r.hidden, to: toSha, patch: put(bps) });
}
const wasmEntry = put(blank);
const tableEntry = put(encodeRefill(ranges), { zlib: false });
const reference = await packWgba(wasm, target);
const manifest = {
  format: PATCH_VERSION,
  title: options.title || path.basename(outPath).replace(/\.wgbp$/i, ""),
  tool: "webGBA tools/make-wgbp.mjs",
  rom: { size: target.length, sha1: sha1(target) },
  wasm: { size: wasm.length, sha1: sha1(wasm), blob: wasmEntry },
  wgba: { size: reference.length, sha1: sha1(reference) },
  pack: { section: "webgba.rom", method: "zlib", impl: "pako 2.1.0", level: 9 },
  refill: { from: primary.sha1, count: ranges.length, bytes: refillBytes, table: tableEntry },
  bases: baseEntries,
};
const text = new TextEncoder().encode(JSON.stringify(manifest));
const head = Buffer.alloc(PATCH_HEADER);
head.write(PATCH_MAGIC, 0, "latin1");
head.writeUInt16LE(PATCH_HEADER, 4);
head[6] = PATCH_VERSION;
head.writeUInt32LE(text.length, 8);
head.writeUInt32LE(crc32(text), 12);
const out = Buffer.concat([head, text, ...blobs]);
const temp = `${outPath}.tmp-${process.pid}`;
fs.writeFileSync(temp, out);

const problems = [];
const patch = readPatch(new Uint8Array(fs.readFileSync(temp)));
for (const r of roms) {
  const t1 = Date.now();
  const made = await buildGame(patch, r.bytes);
  const same = Buffer.from(made.wgba).equals(Buffer.from(reference));
  console.log(`확인 ${baseEntries[roms.indexOf(r)].name}: .wgba ${made.wgba.length}바이트 SHA-1 ${made.sha1} ${same ? "기준과 같음" : "기준과 다름!"} (${((Date.now() - t1) / 1000).toFixed(1)}초)`);
  if (!same || !made.same) problems.push(`${r.file}: 결과가 기준과 다름`);
}
for (const { label, bps } of patchBytes) {
  const inside = findRomRanges(index, bps, { min: options.min, passes: 1, spans: [[0, bps.length]] });
  const bytes = inside.reduce((s, x) => s + x.length, 0);
  console.log(`패치 ${label} 안에 바탕 롬과 ${options.min}바이트 이상 같은 구간: ${inside.length}개 ${bytes}바이트`);
}
if (leftover.length) problems.push(`비운 wasm 에 바탕 롬과 같은 구간이 ${leftover.length}개 남음`);
const given = fs.readFileSync(inputPath);
const givenRom = given.length !== wasm.length;
if (givenRom) console.log(`입력 .wgba 와 기준 .wgba: ${given.equals(Buffer.from(reference)) ? "바이트까지 같음" : "다름(입력은 다른 압축으로 묶였거나 롬이 다름)"}`);
if (problems.length) {
  fs.rmSync(temp, { force: true });
  console.error(`만들지 않았습니다:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
fs.renameSync(temp, outPath);
console.log(`만듦 ${outPath}: ${out.length}바이트 (wasm 덩어리 ${kb(wasmEntry.len)}, 패치 ${baseEntries.map((b) => kb(b.patch.len)).join(" + ")}, 채우기 표 ${kb(tableEntry.len)}) · 기대 .wgba SHA-1 ${manifest.wgba.sha1} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
