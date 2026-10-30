// 롬 없음 검사 — 웹 빌드 결과·커밋할 파일에 롬·게임·세이브가 들어가지 않았는지 본다.
//   node web/tools/check-no-rom.mjs [--rom <롬.gba> …] <폴더…>   폴더 안 모든 파일
//   node web/tools/check-no-rom.mjs [--rom <롬.gba> …] --git      git 이 커밋할 수 있는 파일(추적 + 무시 안 된 새 파일)
// --rom 을 주면 그 롬의 SHA-1(글자·바이트)과 롬 안 64곳의 32바이트 조각도 찾는다(롬은 읽기만).
// 이 파일은 찾을 바이트를 실행할 때 만들어 자기 자신에 걸리지 않게 한다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BANNED_EXT = new Set([".gba", ".agb", ".gb", ".gbc", ".wgba", ".wgbp", ".sav", ".srm", ".zip", ".7z", ".rar", ".bin"]);
const ALLOWED_WASM = new Set(["mgba_core.wasm"]);
const BIG = 1024 * 1024;
const SAMPLE_COUNT = 64;
const SAMPLE_SIZE = 32;

const fromCodes = (...codes) => Buffer.from(codes);
const HEADER_SIGNATURE = Buffer.concat([Buffer.from("POKEMON "), fromCodes(0x46, 0x49, 0x52, 0x45), fromCodes(0x42, 0x50, 0x52, 0x45)]);
const TITLE = Buffer.concat([Buffer.from("POKEMON "), fromCodes(0x46, 0x49, 0x52, 0x45)]);
const CODE = fromCodes(0x42, 0x50, 0x52, 0x45);
const HACK_SHA1_PREFIX = ["86b5", "c42e"].join("");

function romNeedles(file) {
  const rom = fs.readFileSync(file);
  const sha1 = crypto.createHash("sha1").update(rom).digest();
  const needles = [
    { what: `${path.basename(file)} SHA-1 글자`, bytes: Buffer.from(sha1.toString("hex")) },
    { what: `${path.basename(file)} SHA-1 글자(대문자)`, bytes: Buffer.from(sha1.toString("hex").toUpperCase()) },
    { what: `${path.basename(file)} SHA-1 바이트`, bytes: sha1 },
  ];
  const step = Math.floor(rom.length / (SAMPLE_COUNT * 4));
  for (let at = 0x200; at + SAMPLE_SIZE < rom.length && needles.length < SAMPLE_COUNT + 3; at += step) {
    const piece = rom.subarray(at, at + SAMPLE_SIZE);
    if (new Set(piece).size < 20) continue;
    needles.push({ what: `${path.basename(file)} 0x${at.toString(16)} 조각`, bytes: Buffer.from(piece) });
  }
  return { needles, sha1: sha1.toString("hex") };
}

function looksLikeGbaRom(bytes) {
  if (bytes.length < 0xc0 || bytes[0xb2] !== 0x96) return false;
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += bytes[i];
  return ((-(sum + 0x19)) & 0xff) === bytes[0xbd];
}

function wasmSections(bytes) {
  const names = [];
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0x6d736100) return names;
  let at = 8;
  const leb = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80 && at < bytes.length);
    return value;
  };
  while (at < bytes.length) {
    const id = bytes[at++];
    const size = leb();
    const end = at + size;
    if (id === 0) {
      const length = leb();
      names.push(bytes.subarray(at, at + length).toString("utf8"));
    }
    at = end;
  }
  return names;
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push({ full, rel: path.relative(base, full).replace(/\\/g, "/") });
  }
  return out;
}

function gitFiles(root) {
  const text = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
  return text
    .split("\0")
    .filter(Boolean)
    .map((rel) => ({ full: path.join(root, rel), rel }))
    .filter((item) => fs.existsSync(item.full));
}

export function check(files, { needles = [], self = "" } = {}) {
  const problems = [];
  const big = [];
  const loose = [];
  let bytesTotal = 0;
  for (const file of files) {
    if (self && path.resolve(file.full) === self) continue;
    const ext = path.extname(file.rel).toLowerCase();
    const name = path.basename(file.rel);
    if (BANNED_EXT.has(ext)) problems.push(`넣으면 안 되는 형식: ${file.rel}`);
    if (ext === ".wasm" && !ALLOWED_WASM.has(name)) problems.push(`mGBA 코어가 아닌 wasm: ${file.rel}`);
    const bytes = fs.readFileSync(file.full);
    bytesTotal += bytes.length;
    if (bytes.length > BIG) big.push(`${file.rel} ${bytes.length}`);
    if (ext === ".wasm" && wasmSections(bytes).includes("webgba.rom")) problems.push(`롬을 묶은 wasm 구획: ${file.rel}`);
    if (looksLikeGbaRom(bytes)) problems.push(`GBA 롬 머리 모양: ${file.rel}`);
    if (bytes.includes(HEADER_SIGNATURE)) problems.push(`정식 롬 머리 바이트(제목+코드): ${file.rel}`);
    if (bytes.includes(Buffer.from(HACK_SHA1_PREFIX))) problems.push(`핵 롬 SHA-1 앞자리: ${file.rel}`);
    for (const needle of needles) if (bytes.includes(needle.bytes)) problems.push(`${needle.what}: ${file.rel}`);
    if (bytes.includes(TITLE)) loose.push(`제목 글자만: ${file.rel}`);
    if (bytes.includes(CODE)) loose.push(`게임 코드 글자만: ${file.rel}`);
  }
  return { count: files.length, bytesTotal, problems, big, loose };
}

function main() {
  const args = process.argv.slice(2);
  const roms = [];
  const targets = [];
  let git = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rom") roms.push(args[++i]);
    else if (args[i] === "--git") git = true;
    else targets.push(args[i]);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const self = path.resolve(fileURLToPath(import.meta.url));
  const needles = [];
  for (const rom of roms) {
    const found = romNeedles(rom);
    needles.push(...found.needles);
    console.log(`롬 기준: ${path.basename(rom)} SHA-1 ${found.sha1.slice(0, 8)}… · 조각 ${found.needles.length - 3}개`);
  }
  let files = [];
  if (git) files.push(...gitFiles(root));
  for (const target of targets) files.push(...walk(path.resolve(target)));
  if (!files.length) {
    console.error("검사할 파일이 없습니다");
    process.exit(2);
  }
  const result = check(files, { needles, self });
  console.log(`파일 ${result.count}개 · ${result.bytesTotal}바이트`);
  console.log(`1MB 넘는 파일: ${result.big.length ? result.big.join(", ") : "없음"}`);
  if (result.loose.length) console.log(`참고(글자만, 실패 아님): ${result.loose.join(", ")}`);
  if (result.problems.length) {
    console.error(`문제 ${result.problems.length}건`);
    for (const line of result.problems) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("롬 없음 검사 통과");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
