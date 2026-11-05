// .wgba 규격 1 도구: 묶기·정보·검사·풀기·롬 빼기. node 18+, 바깥 의존성 없음(저장소 안 pako).
//
//   node tools/wgba.mjs pack -o <출력.wgba> --wasm <게임.wasm|.wgba> --manifest <manifest.json>
//                       [--cart-dir <폴더>] [--label <그림>] [--front <그림>] [--spine <그림>]
//                       [--js <게임.js>] [--js-store] [--data <이름>=<파일> …] [--data-store] [--rom <롬>]
//   node tools/wgba.mjs info <파일>                   목차·설명서 요약(파일 앞부분만 읽음). 목차가 없으면 옛 롬 구획 정보
//   node tools/wgba.mjs check <파일> [--quick]        규격 10장 검사. 오류가 있으면 끝 상태 1(--quick: 롬을 풀지 않음)
//   node tools/wgba.mjs extract <파일> <조각> <출력>  조각 내용을 씀. code → 실행 가능한 wasm(머리 붙임), rom → 풀린 롬
//   node tools/wgba.mjs strip <파일> <출력.wgba>      롬 조각만 빼고 다시 묶음(설명서·그림·JS·데이터 그대로)
//   node tools/wgba.mjs keygen · diff · feed · verify · upload   온라인 업데이트 배포(tools/lib/update-cmds.mjs, 규격 12장)
//
// --cart-dir 폴더의 label.png · front.png · spine.png(또는 .webp)가 있으면 넣는다(없는 것은 빠지고 설명서 cart.<그것>도 뺌).
// 설명서의 cart.<label|front|spine> 의 chunk·format·width·height 는 그림에서 채운다(labelAt·textArea 등은 그대로).
// 같은 입력이면 어느 PC 에서 묶어도 바이트까지 같다(압축 pako level 9, 설명서는 JSON.stringify 그대로).
// 출력은 옆 임시 파일로 쓴 뒤 다시 읽어 검사(check)를 통과해야 이름을 바꾼다.
//
// 롬은 배포하지 않는다. --rom 은 롬을 가진 사람이 자기 PC 에서 묶을 때만 쓰고, 묶은 .wgba 는 공개 저장소·릴리스에 넣지 않는다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CART_PARTS,
  checkWgba,
  codeWasm,
  KIND,
  KIND_NAME,
  METHOD,
  packWgba,
  readToc,
  romHeader,
  ROM_SECTION,
  unpackChunk,
  unpackRom,
  wasmSections,
  buildId,
} from "../src-bundle/src/js/core/wgba-format.js";
import { pickTextKey, TEXT_LANGS } from "../src-bundle/src/js/core/lang-text.js";

const n = (v) => v.toLocaleString("en-US");

function fileReader(file) {
  const fd = fs.openSync(file, "r");
  const reads = { count: 0, bytes: 0 };
  const readAt = async (offset, length) => {
    const buf = Buffer.alloc(length);
    const got = fs.readSync(fd, buf, 0, length, offset);
    reads.count++;
    reads.bytes += got;
    return new Uint8Array(buf.buffer, buf.byteOffset, got);
  };
  return { readAt, reads, close: () => fs.closeSync(fd), size: fs.fstatSync(fd).size };
}

function parse(argv) {
  const opts = { data: [], positional: [] };
  const takes = new Set(["-o", "--out", "--wasm", "--manifest", "--cart-dir", "--label", "--front", "--spine", "--js", "--rom"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data") {
      const spec = argv[++i] ?? "";
      const at = spec.indexOf("=");
      if (at <= 0) throw new Error(`--data 는 <이름>=<파일>: ${spec}`);
      opts.data.push({ name: spec.slice(0, at), file: spec.slice(at + 1) });
    } else if (takes.has(a)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} 뒤에 값이 없습니다`);
      opts[a === "--out" ? "-o" : a] = value;
    } else if (a.startsWith("--")) opts[a] = true;
    else opts.positional.push(a);
  }
  return opts;
}

/** --cart-dir·--label·--front·--spine → { label, front, spine } 바이트와 쓴 파일 이름. */
export function collectImages({ cartDir = null, label = null, front = null, spine = null } = {}) {
  const images = {};
  const used = {};
  const explicit = { label, front, spine };
  for (const part of Object.keys(CART_PARTS)) {
    let file = explicit[part];
    if (!file && cartDir) file = ["png", "webp"].map((ext) => path.join(cartDir, `${part}.${ext}`)).find((f) => fs.existsSync(f)) ?? null;
    if (!file) continue;
    images[part] = new Uint8Array(fs.readFileSync(file));
    used[part] = file;
  }
  return { images, used };
}

/** pack 명령 본체(다른 도구도 부름). 결과 { bytes, check, notes, entries, used }. */
export async function packFiles({ wasm, manifest, cartDir, label, front, spine, js, jsStore = false, data = [], dataStore = false, rom }) {
  const { images, used } = collectImages({ cartDir, label, front, spine });
  const result = await packWgba({
    wasm: new Uint8Array(fs.readFileSync(wasm)),
    manifest: JSON.parse(fs.readFileSync(manifest, "utf8").replace(/^﻿/, "")),
    images,
    js: js ? new Uint8Array(fs.readFileSync(js)) : null,
    jsMethod: jsStore ? METHOD.store : METHOD.zlib,
    data: data.map((d) => ({ name: d.name, bytes: new Uint8Array(fs.readFileSync(d.file)), method: dataStore ? METHOD.store : METHOD.zlib })),
    rom: rom ? new Uint8Array(fs.readFileSync(rom)) : null,
  });
  return { ...result, used };
}

/** 임시 파일로 쓰고 다시 읽어 검사를 통과하면 이름을 바꾼다. 통과하지 못하면 지우고 던진다. */
export async function writeChecked(out, bytes) {
  const tmp = `${out}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  try {
    const back = new Uint8Array(fs.readFileSync(tmp));
    if (back.length !== bytes.length || !Buffer.from(back).equals(Buffer.from(bytes))) throw new Error("임시 파일을 다시 읽으니 내용이 다릅니다");
    const res = await checkWgba(back);
    if (res.errors.length) throw new Error(`검사 오류 ${res.errors.length}개:\n  ${res.errors.join("\n  ")}`);
    fs.renameSync(tmp, out);
    return res;
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

// 화면 언어(en·ko·ja)마다 보일 글. 칸이 없어 다른 칸을 쓰면 "ja → en …", 그 밖의 언어 칸은 뒤에.
function langLine(value) {
  if (typeof value === "string") return `${value} (모든 언어)`;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const shown = TEXT_LANGS.map((lang) => {
    const used = pickTextKey(value, lang);
    if (used === null) return `${lang} 없음`;
    return used === lang ? `${lang} ${value[lang]}` : `${lang} → ${used} ${value[used]}`;
  });
  const others = Object.keys(value).filter((key) => !TEXT_LANGS.includes(key)).map((key) => `${key} ${value[key]}`);
  return [...shown, ...others].join(" · ");
}

function printToc(toc) {
  console.log(`목차 형식 ${toc.major}.${toc.minor} · 파일 ${n(toc.fileLen)}바이트 · 조각 ${toc.entries.length}개`);
  for (const e of toc.entries) {
    const method = e.method === METHOD.zlib ? "zlib" : "그대로";
    console.log(`  ${e.name.padEnd(12)} ${String(e.kindName).padEnd(8)} ${String(e.start).padStart(10)}–${String(e.end).padEnd(10)} ${method.padEnd(4)} ${n(e.size).padStart(12)}바이트 ${e.flags & 1 ? "필수" : "    "} ${e.sha256.slice(0, 16)}`);
  }
}

async function info(file) {
  const r = fileReader(file);
  try {
    const toc = await readToc(r.readAt);
    if (!toc) {
      r.close();
      return legacyInfo(file);
    }
    printToc(toc);
    const me = toc.entries.find((e) => e.name === "manifest");
    let m = null;
    if (me) {
      m = JSON.parse(new TextDecoder().decode(unpackChunk(await r.readAt(me.start, me.end - me.start), me)));
      console.log(`설명서  id ${m.id} · 버전 ${m.version} · ${m.runtime}`);
      console.log(`이름    ${langLine(m.name)}`);
      if (m.shortName) console.log(`짧은 이름 ${langLine(m.shortName)}`);
      console.log(`화면    ${m.screen?.width ?? 240}x${m.screen?.height ?? 160} · 표시 비율 ${m.display?.aspect ?? "화면 버퍼 그대로"} · 방향 입력 ${m.input?.dpad ?? "사용자 설정"}`);
      const cart = m.cart ?? {};
      const parts = Object.keys(CART_PARTS).map((p) => (cart[p] ? `${p} ${cart[p].width}x${cart[p].height}` : `${p} 없음`));
      console.log(`롬팩    색 ${cart.color ?? "없음"} · ${parts.join(" · ")}`);
    }
    const rom = toc.entries.find((e) => e.kind === KIND.rom);
    if (rom) {
      const head = romHeader(await r.readAt(rom.start, Math.min(64, rom.end - rom.start)), rom.end - rom.start);
      console.log(`롬      ${n(head.size)}바이트 → ${head.method ? "zlib" : "그대로"} ${n(head.packed)}바이트 · SHA-1 ${head.sha1}`);
    }
    console.log(`빌드    ${(await buildId(toc)).slice(0, 16)} (code·rom·data SHA-256)`);
    console.log(`읽은 양 ${r.reads.count}번 · ${n(r.reads.bytes)}바이트`);
    return 0;
  } finally {
    try {
      r.close();
    } catch {}
  }
}

async function legacyInfo(file) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const found = wasmSections(buf).filter((s) => s.id === 0 && s.name === ROM_SECTION).at(-1);
  console.log(`${path.basename(file)} ${n(buf.length)}바이트 · 목차 없음(옛 .wgba)`);
  if (!found) {
    console.log("롬 구획 없음");
    return 3;
  }
  const { header } = await unpackRom(buf.subarray(found.payload, found.end));
  console.log(`롬 구획 ${n(found.end - found.start)}바이트(파일 ${n(found.start)}부터) · ${n(header.size)}바이트 → ${header.method ? "zlib" : "그대로"} ${n(header.packed)}바이트 · 풀어서 확인함`);
  console.log(`SHA-1 ${header.sha1}`);
  return 0;
}

async function check(file, quick) {
  const res = await checkWgba(new Uint8Array(fs.readFileSync(file)), { deep: !quick });
  for (const w of res.warnings) console.log(`경고  ${w}`);
  for (const e of res.errors) console.log(`오류  ${e}`);
  if (res.manifest) console.log(`설명서 ${res.manifest.id} ${res.manifest.version} · 빌드 ${res.buildId?.slice(0, 16)}`);
  console.log(res.errors.length ? `실패(오류 ${res.errors.length}, 경고 ${res.warnings.length})` : `통과(경고 ${res.warnings.length})`);
  return res.errors.length ? 1 : 0;
}

async function chunkOf(file, name) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const r = fileReader(file);
  const toc = await readToc(r.readAt);
  r.close();
  if (!toc) throw new Error("목차가 없는 옛 .wgba 입니다");
  const e = toc.entries.find((x) => x.name === name);
  if (!e) throw new Error(`조각 ${name} 이 없습니다(있는 것: ${toc.entries.map((x) => x.name).join(", ")})`);
  return { buf, toc, e, stored: buf.subarray(e.start, e.end) };
}

async function extract(file, name, out) {
  const { e, stored } = await chunkOf(file, name);
  let bytes;
  if (e.kind === KIND.code) bytes = codeWasm(stored);
  else if (e.kind === KIND.rom) bytes = (await unpackRom(stored)).rom;
  else bytes = unpackChunk(stored, e);
  fs.writeFileSync(out, bytes);
  console.log(`${name}(${KIND_NAME[e.kind]}) → ${out} ${n(bytes.length)}바이트`);
  return 0;
}

/** 목차를 따라 조각을 모두 꺼내 다시 묶는다(롬만 뺄 때). */
async function strip(file, out) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const toc = await readToc(async (o, l) => buf.subarray(o, o + l));
  if (!toc) throw new Error("목차가 없는 옛 .wgba 입니다 — tools/pack-wgba.mjs --strip 을 쓰세요");
  const take = (e) => unpackChunk(buf.subarray(e.start, e.end), e);
  const byName = (name) => toc.entries.find((e) => e.name === name);
  const manifest = JSON.parse(new TextDecoder().decode(take(byName("manifest"))));
  const images = {};
  for (const [part, { chunk }] of Object.entries(CART_PARTS)) if (byName(chunk)) images[part] = take(byName(chunk));
  const js = byName("js");
  const code = byName("code");
  const result = await packWgba({
    wasm: codeWasm(buf.subarray(code.start, code.end)),
    manifest,
    images,
    js: js ? take(js) : null,
    jsMethod: js?.method ?? METHOD.zlib,
    data: toc.entries.filter((e) => e.kind === KIND.data).map((e) => ({ name: e.name.slice(5), bytes: take(e), method: e.method })),
  });
  await writeChecked(path.resolve(out), result.bytes);
  console.log(`롬 조각을 뺐습니다: ${n(buf.length)} → ${n(result.bytes.length)}바이트 · ${path.basename(out)}`);
  return 0;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "pack") {
    const o = parse(rest);
    if (!o["-o"] || !o["--wasm"] || !o["--manifest"] || o.positional.length) return usage();
    const t0 = Date.now();
    const res = await packFiles({
      wasm: o["--wasm"],
      manifest: o["--manifest"],
      cartDir: o["--cart-dir"],
      label: o["--label"],
      front: o["--front"],
      spine: o["--spine"],
      js: o["--js"],
      jsStore: Boolean(o["--js-store"]),
      data: o.data,
      dataStore: Boolean(o["--data-store"]),
      rom: o["--rom"],
    });
    for (const note of res.notes) console.log(`알림  ${note}`);
    const checked = await writeChecked(path.resolve(o["-o"]), res.bytes);
    const m = res.manifest;
    console.log(`설명서  ${m.id} ${m.version} · ${m.runtime}`);
    console.log(`이름    ${langLine(m.name)}`);
    if (m.shortName) console.log(`짧은 이름 ${langLine(m.shortName)}`);
    console.log(`롬팩    ${Object.keys(CART_PARTS).map((p) => `${p} ${res.used[p] ? path.basename(res.used[p]) : "없음"}`).join(" · ")}`);
    for (const e of res.entries) console.log(`  ${e.name.padEnd(12)} ${String(KIND_NAME[e.kind]).padEnd(8)} ${String(e.start).padStart(10)}–${String(e.end).padEnd(10)} ${n(e.size).padStart(12)}바이트`);
    if (checked.rom) console.log(`롬 SHA-1 ${checked.rom.sha1}`);
    console.log(`출력  ${path.basename(o["-o"])} ${n(res.bytes.length)}바이트 · 빌드 ${checked.buildId.slice(0, 16)} · 검사 통과(경고 ${checked.warnings.length}) · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
    for (const w of checked.warnings) console.log(`경고  ${w}`);
    return 0;
  }
  if (cmd === "info" && rest.length === 1) return info(rest[0]);
  if (cmd === "check" && rest.length >= 1) return check(rest[0], rest.includes("--quick"));
  if (cmd === "extract" && rest.length === 3) return extract(rest[0], rest[1], rest[2]);
  if (cmd === "strip" && rest.length === 2) return strip(rest[0], rest[1]);
  if (UPDATE_COMMANDS.includes(cmd)) {
    // 배포 명령은 필요할 때만 불러온다(pack-wgba.mjs 가 이 파일을 가져오므로 정적으로 가져오면 순환)
    const { updateCommand } = await import("./lib/update-cmds.mjs");
    const code = await updateCommand(cmd, rest);
    if (code !== null && code >= 0) return code;
  }
  return usage();
}

const UPDATE_COMMANDS = ["keygen", "diff", "feed", "verify", "upload"];
const UPDATE_USAGE = [
  "        node tools/wgba.mjs keygen -o <저장소 밖 비밀 키.pem> [--force]",
  "        node tools/wgba.mjs diff <옛.wgba> <새.wgba> -o <패치.wgbd> [--orig <원작 롬>]… [--no-expand]",
  "        node tools/wgba.mjs feed --dir <발행 폴더> --key <비밀 키.pem> --wgba <새.wgba> [--patch <패치.wgbd>]… [--full <새.wgbp>] [--notes <글.json>] [--prev <latest.json>]",
  "        node tools/wgba.mjs verify <발행 폴더> (--pub <공개 키> | --key <비밀 키.pem>) [--wgba <옛.wgba>]…",
  "        node tools/wgba.mjs upload <발행 폴더> [--dry-run]",
];

function usage() {
  console.error("사용법: node tools/wgba.mjs pack -o <출력.wgba> --wasm <게임.wasm> --manifest <manifest.json> [--cart-dir <폴더>] [--label|--front|--spine <그림>] [--js <게임.js>] [--data <이름>=<파일>] [--rom <롬>]");
  console.error("        node tools/wgba.mjs info <파일> | check <파일> [--quick] | extract <파일> <조각> <출력> | strip <파일> <출력>");
  for (const line of UPDATE_USAGE) console.error(line);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`실패: ${error.message}`);
    process.exitCode = 1;
  }
}
