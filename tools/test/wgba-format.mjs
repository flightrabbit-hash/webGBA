// .wgba 규격 1 형식 시험(node 만, 롬·앱 없이). node tools/test/wgba-format.mjs [작업 폴더]
// 손으로 짠 작은 wasm 두 개(① webapi · ② script)와 임의 바이트("rom" 조각 — 롬 아님)로 묶어 본다:
// 검사 통과·옛 앱 방식으로 롬 구획 찾기·옛 앱이 롬을 다시 붙여도 같은 바이트·같은 입력 같은 바이트·앞부분만 읽기·
// code 만 컴파일·망가뜨리기 10가지·롬팩 그림 규칙·업데이트 규칙·명령줄(pack-wgba 감싸기·extract·strip).
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  checkWgba,
  codeWasm,
  compareVersions,
  FLAG_REQUIRED,
  packWgba,
  readTocFrom,
  TOC_ENTRY,
  TOC_HEAD,
  updateAction,
  wasmSections,
} from "../../src-bundle/src/js/core/wgba-format.js";
import { packWgba as legacyAttach } from "../../src-bundle/src/js/core/wgbp.js";
import { pack as legacyPack, stripRom } from "../pack-wgba.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.dirname(here);
const work = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "wgba-format-"));
fs.mkdirSync(work, { recursive: true });
const { encode } = createRequire(import.meta.url)("./png.cjs");

let failed = 0;
const ok = (cond, text, detail = "") => {
  console.log(`${cond ? "통과" : "실패"} ${text}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

/* ── 손으로 짠 작은 wasm ── */
const u = (n) => {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const s = (n) => {
  const o = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) return o.push(b), o;
    o.push(b | 0x80);
  }
};
const str = (t) => [...u(t.length), ...Buffer.from(t)];
const sec = (id, body) => [id, ...u(body.length), ...body];
const vec = (items) => [...u(items.length), ...items.flat()];

function webapiWasm() {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [1], [0]]));
  const mem = sec(5, vec([[0x00, 3]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const run = [1, 1, 0x7f, 0x03, 0x40, 0x20, 1, 0x41, 2, 0x74, 0x41, ...s(1024), 0x6a, 0x20, 0, 0x41, ...s(0x00103050), 0x6c, 0x41, ...s(-16777216), 0x72, 0x36, 2, 0, 0x20, 1, 0x41, 1, 0x6a, 0x22, 1, 0x41, ...s(38400), 0x49, 0x0d, 0, 0x0b, 0x41, 1, 0x0b];
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(run.length), ...run], [...u(5), 0, 0x41, ...s(1024), 0x0b]]));
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code]);
}

function scriptWasm() {
  const types = sec(1, vec([[0x60, 2, 0x7f, 0x7f, 1, 0x7f]]));
  const funcs = sec(3, vec([[0]]));
  const exps = sec(7, vec([[...str("add"), 0, 0]]));
  const body = [0, 0x20, 0, 0x20, 1, 0x6a, 0x0b];
  const code = sec(10, vec([[...u(body.length), ...body]]));
  const prod = sec(0, [...str("producers"), 0]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...exps, ...code, ...prod]);
}

const image = (w, h, rgb) => {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...rgb, i % 7 ? 255 : 0], i * 4);
  return new Uint8Array(encode(px, w, h));
};
const images = { label: image(96, 64, [240, 200, 80]), front: image(108, 88, [200, 64, 42]), spine: image(24, 88, [200, 64, 42]) };
const fakeRom = new Uint8Array(crypto.randomBytes(96 * 1024));
fakeRom[0xb2] = 0x96;

const manifestA = {
  wgba: 1,
  id: "io.example.hello-webapi",
  version: "1.0.0",
  name: { en: "Hello Web API", ko: "헬로 웹 API" },
  shortName: "Hello",
  runtime: "webapi",
  save: { kind: "none" },
  input: { preset: "gba" },
  cart: { color: "#3a6ea5", label: {}, front: { labelAt: [6, 10] }, spine: { textArea: [4, 10, 16, 64] } },
};
const manifestB = {
  wgba: 1,
  id: "io.example.hello-script",
  version: "0.3.0-beta.1",
  name: "Hello Script",
  runtime: "script",
  entry: { style: "module" },
  screen: { width: 320, height: 180, scale: "integer" },
  input: { buttons: [{ id: "UP", role: "up", code: "ArrowUp" }, { id: "JUMP", role: "a", code: "Space" }, { id: "C", role: "c", code: "KeyC" }] },
};
const js = new TextEncoder().encode("export default async function start(webgba) { webgba.ready(); }\n".repeat(20));

const A = await packWgba({ wasm: webapiWasm(), manifest: manifestA, images, rom: fakeRom });
const B = await packWgba({ wasm: scriptWasm(), manifest: manifestB, js, data: [{ name: "levels", bytes: new Uint8Array(4096).fill(7) }] });
const a = A.bytes;
const b = B.bytes;
const resA = await checkWgba(a);
const resB = await checkWgba(b);
ok(resA.errors.length === 0 && resA.warnings.length === 0, "① 예제 검사 오류·경고 0", [...resA.errors, ...resA.warnings].join(" / "));
ok(resB.errors.length === 0, "② 예제 검사 오류 0", resB.errors.join(" / "));
ok(A.manifest.cart.label?.chunk === "cart.label" && A.manifest.cart.front.width === 108 && A.manifest.cart.front.labelAt[0] === 6 && A.manifest.cart.spine.textArea.length === 4, "설명서 cart 를 그림에서 채움(labelAt·textArea 그대로)", JSON.stringify(A.manifest.cart));
ok(A.entries.map((e) => e.name).join(",") === "manifest,cart.label,cart.front,cart.spine,code,rom", "조각 순서 목차 → 설명서 → 롬팩 → code → 롬", A.entries.map((e) => e.name).join(","));
ok(B.entries.map((e) => e.name).join(",") === "manifest,js,code,data.levels", "② 조각 순서 설명서 → JS → code → 데이터", B.entries.map((e) => e.name).join(","));

// 옛 앱 호환
ok(WebAssembly.validate(a) && WebAssembly.validate(b), "두 파일 모두 WebAssembly.validate 통과");
const modA = await WebAssembly.compile(a);
ok(WebAssembly.Module.customSections(modA, "webgba.rom").length === 1, "옛 앱 방식(customSections)으로 webgba.rom 을 찾음");
const inst = await WebAssembly.instantiate(modA, {});
ok(inst.exports.Web_Init() === 1 && inst.exports.Web_RunFrame(1) === 1, "파일 그대로 컴파일·실행(옛 앱처럼)");
const reattached = await legacyAttach(new Uint8Array(stripRom(Buffer.from(a))), fakeRom);
ok(same(reattached, a), "옛 앱(.wgbp → .wgba)이 롬 구획을 빼고 다시 붙여도 바이트까지 같음");
const again = await packWgba({ wasm: webapiWasm(), manifest: manifestA, images, rom: fakeRom });
ok(same(again.bytes, a), "같은 입력이면 같은 바이트");
const repacked = await packWgba({ wasm: a, manifest: manifestA, images, rom: fakeRom });
ok(same(repacked.bytes, a), ".wgba 를 입력으로 다시 묶어도 같은 바이트(webgba.* 구획은 뺌)");

// 앞부분만 읽기
let reads = 0;
let readBytes = 0;
const readAt = async (o, l) => {
  reads++;
  readBytes += Math.min(l, a.length - o);
  return a.subarray(o, o + l);
};
const { readToc } = await import("../../src-bundle/src/js/core/wgba-format.js");
const toc = await readToc(readAt);
for (const e of toc.entries.filter((x) => x.kind === 1 || x.kind === 2)) await readAt(e.start, e.end - e.start);
ok(readBytes < 8 * 1024, "라이브러리 읽기(목차·설명서·라벨·앞면·옆면)", `${reads}번 · ${readBytes}바이트 / 파일 ${a.length}바이트`);
const codeE = toc.entries.find((e) => e.name === "code");
const modCode = await WebAssembly.compile(codeWasm(a.subarray(codeE.start, codeE.end)));
ok(same(codeWasm(a.subarray(codeE.start, codeE.end)), webapiWasm()) && WebAssembly.Module.customSections(modCode, "webgba.rom").length === 0, "code 조각 = 입력 wasm 그대로(롬·그림 없이 컴파일)");
const modB = await WebAssembly.compile(b);
ok(WebAssembly.Module.customSections(modB, "producers").length === 1, "② 원래 사용자 정의 구획(producers)이 code 안에 남음");

// 목차 없는 옛 파일
const legacy = new Uint8Array(legacyPack(Buffer.from(webapiWasm()), Buffer.from(fakeRom)));
const resL = await checkWgba(legacy);
ok((await readTocFrom(legacy)) === null && resL.errors.length === 0 && resL.warnings.some((w) => w.includes("목차")), "목차 없는 옛 .wgba: 목차 null · 오류 0 · 경고로 알림");

// 망가뜨리기
const tocAt = wasmSections(a)[0].payload; // 목차 내용(WGTC) 첫 바이트
const entryAt = (name) => tocAt + TOC_HEAD + toc.entries.findIndex((e) => e.name === name) * TOC_ENTRY;
const setSha = async (buf, name) => {
  const e = toc.entries.find((x) => x.name === name);
  buf.set(new Uint8Array(await crypto.webcrypto.subtle.digest("SHA-256", buf.subarray(e.start, e.end))), entryAt(name) + 48);
};
async function broken(text, mutate, expect) {
  let buf = Uint8Array.from(a);
  const r = await mutate(buf);
  if (r) buf = r;
  const res = await checkWgba(buf);
  const hit = res.errors.find((e) => expect.test(e));
  ok(Boolean(hit), `망가뜨리기: ${text}`, hit ?? res.errors.join(" / "));
}
await broken("앞면 그림 1바이트", (buf) => void (buf[toc.entries.find((e) => e.name === "cart.front").start + 40] ^= 0xff), /SHA-256/);
await broken("끝 1바이트 잘림", (buf) => buf.subarray(0, buf.length - 1), /파일 길이|파일 끝을 넘/);
await broken("끝에 덧붙임(빈 사용자 정의 구획)", (buf) => Uint8Array.from([...buf, 0, 1, 0]), /파일 길이/);
await broken("목차 큰 번호 2", (buf) => void (buf[tocAt + 4] = 2), /목차 형식/);
await broken("조각 이름 바꿈(manifest → manifesu)", (buf) => void (buf[entryAt("manifest") + 7] = "u".charCodeAt(0)), /설명서\(manifest\) 조각이 없|구획 webgba.manifesu/);
await broken("조각 끝을 파일 밖으로", (buf) => {
  const v = new DataView(buf.buffer);
  v.setUint32(entryAt("cart.spine") + 36, buf.length + 10, true);
}, /자리가 겹치거나|파일 밖/);
await broken("롬 머리 SHA-1(목차 해시는 맞춤)", async (buf) => {
  buf[toc.entries.find((e) => e.name === "rom").start + 20] ^= 0xff;
  await setSha(buf, "rom");
}, /SHA-1/);
await broken("모르는 종류 + 필수 깃발", async (buf) => {
  buf[entryAt("cart.label") + 45] = 9;
  buf[entryAt("cart.label") + 46] = FLAG_REQUIRED;
}, /모르는 종류 9/);
{
  const bad = await packWgba({ wasm: webapiWasm(), manifest: { ...manifestA, version: "1.2", id: "NoDots" } });
  const res = await checkWgba(bad.bytes);
  ok(res.errors.some((e) => /version/.test(e)) && res.errors.some((e) => /id 가 규칙 밖/.test(e)), "망가뜨리기: 설명서 version·id 규칙 밖", res.errors.join(" / "));
}
{
  const bad = await packWgba({ wasm: scriptWasm(), manifest: { ...manifestA, cart: undefined } });
  const res = await checkWgba(bad.bytes);
  ok(res.errors.some((e) => /필수 내보내기/.test(e)), "망가뜨리기: webapi 인데 필수 내보내기 없음", res.errors[0]);
}
{
  const lie = Uint8Array.from(b);
  const tocB = await readTocFrom(b);
  const at = tocAt + TOC_HEAD + tocB.entries.findIndex((e) => e.name === "js") * TOC_ENTRY;
  new DataView(lie.buffer).setUint32(at + 40, 100, true);
  const res = await checkWgba(lie);
  ok(res.errors.some((e) => /넘습니다|푼 크기/.test(e)), "망가뜨리기: 압축 푼 크기 거짓(폭탄 막기)", res.errors.find((e) => /넘습니다|푼 크기/.test(e)));
}

// 롬팩 그림 규칙
{
  const odd = await packWgba({ wasm: webapiWasm(), manifest: manifestA, images: { ...images, spine: image(20, 88, [1, 2, 3]) } });
  const res = await checkWgba(odd.bytes);
  ok(res.errors.length === 0 && res.warnings.some((w) => /spine 20x88/.test(w)), "옆면 20x88 → 경고(기본 모양으로)", res.warnings.join(" / "));
  const mixed = await packWgba({ wasm: webapiWasm(), manifest: manifestA, images: { ...images, front: image(54, 44, [1, 2, 3]) } });
  const res2 = await checkWgba(mixed.bytes);
  ok(res2.errors.length === 0 && res2.warnings.some((w) => /배수가 서로 다릅니다/.test(w)), "배수 다름 → 경고", res2.warnings.join(" / "));
  const outside = await packWgba({ wasm: webapiWasm(), manifest: { ...manifestA, cart: { ...manifestA.cart, front: { labelAt: [20, 20] }, spine: { textArea: [4, 10, 16, 90] } } }, images });
  const res3 = await checkWgba(outside.bytes);
  ok(res3.errors.length === 0 && res3.warnings.some((w) => /labelAt/.test(w)) && res3.warnings.some((w) => /textArea/.test(w)), "라벨 자리·이름 자리가 그림 밖 → 경고", res3.warnings.join(" / "));
  const none = await packWgba({ wasm: webapiWasm(), manifest: manifestA, images: { front: images.front } });
  ok(!none.manifest.cart.label && !none.manifest.cart.spine && none.manifest.cart.front && none.notes.some((x) => /spine/.test(x)), "없는 그림은 설명서 항목도 뺌(빈 라벨 자리는 조용히)", none.notes.join(" / "));
}

// 버전·업데이트 규칙
ok(compareVersions("1.2.0", "1.10.0") === -1 && compareVersions("1.2.0", "1.2.0-beta.1") === 1 && compareVersions("1.2.0-beta.2", "1.2.0-beta.10") === -1 && compareVersions("2.0.0", "2.0.0") === 0, "유의적 버전 비교");
ok(updateAction({ version: "1.1.0", build: "x" }, { version: "1.2.0", build: "y" }) === "update" && updateAction({ version: "1.2.0", build: "x" }, { version: "1.2.0", build: "y" }) === "update" && updateAction({ version: "1.2.0", build: "x" }, { version: "1.1.0", build: "y" }) === "older" && updateAction({ version: "1.2.0", build: "x" }, { version: "1.2.0", build: "x" }) === "same", "같은 id: 높은 버전·같은 버전 다른 빌드 = 묻지 않고 바꿈, 낮은 버전 = 경고, 같은 빌드 = 그대로");

// 명령줄
const node = (args) => spawnSync(process.execPath, args, { encoding: "utf8" });
const wasmFile = path.join(work, "hello.wasm");
const manFile = path.join(work, "manifest.json");
const romFile = path.join(work, "fake.bin");
const cartDir = path.join(work, "cart");
fs.mkdirSync(cartDir, { recursive: true });
fs.writeFileSync(wasmFile, webapiWasm());
fs.writeFileSync(manFile, JSON.stringify(manifestA, null, 2));
fs.writeFileSync(romFile, fakeRom);
for (const [part, bytes] of Object.entries(images)) fs.writeFileSync(path.join(cartDir, `${part}.png`), bytes);
const out1 = path.join(work, "cli.wgba");
const out2 = path.join(work, "wrap.wgba");
const p1 = node([path.join(tools, "wgba.mjs"), "pack", "-o", out1, "--wasm", wasmFile, "--manifest", manFile, "--cart-dir", cartDir, "--rom", romFile]);
ok(p1.status === 0 && same(fs.readFileSync(out1), a), "wgba.mjs pack(--cart-dir) = 같은 바이트", p1.stderr.trim());
const p2 = node([path.join(tools, "pack-wgba.mjs"), wasmFile, romFile, out2, "--manifest", manFile, "--cart-dir", cartDir]);
ok(p2.status === 0 && same(fs.readFileSync(out2), a), "pack-wgba.mjs --manifest 가 새 묶기로 넘김(같은 바이트)", p2.stderr.trim());
const p3 = node([path.join(tools, "pack-wgba.mjs"), "--info", out1]);
ok(p3.status === 0 && /목차 형식 1\.0/.test(p3.stdout), "pack-wgba.mjs --info 가 목차 파일을 읽음");
const codeOut = path.join(work, "code.wasm");
const p4 = node([path.join(tools, "wgba.mjs"), "extract", out1, "code", codeOut]);
ok(p4.status === 0 && same(fs.readFileSync(codeOut), webapiWasm()), "extract code = 입력 wasm(배포 cmp 방법)");
const stripped = path.join(work, "norom.wgba");
const p5 = node([path.join(tools, "wgba.mjs"), "strip", out1, stripped]);
const resS = await checkWgba(new Uint8Array(fs.readFileSync(stripped)));
ok(p5.status === 0 && resS.errors.length === 0 && !resS.toc.entries.some((e) => e.name === "rom") && resS.toc.entries.some((e) => e.name === "cart.spine"), "strip: 롬만 빼고 다시 묶음(검사 통과)", p5.stderr.trim());
const p6 = node([path.join(tools, "wgba.mjs"), "check", out1]);
ok(p6.status === 0 && /통과/.test(p6.stdout), "wgba.mjs check 끝 상태 0");
const badFile = path.join(work, "bad.wgba");
const badBytes = Uint8Array.from(a);
badBytes[toc.entries.find((e) => e.name === "manifest").start + 3] ^= 0x20;
fs.writeFileSync(badFile, badBytes);
ok(node([path.join(tools, "wgba.mjs"), "check", badFile]).status === 1, "wgba.mjs check 오류면 끝 상태 1");
ok(wasmSections(a)[0].name === "webgba.toc", "첫 구획 = webgba.toc");

if (!process.argv[2]) fs.rmSync(work, { recursive: true, force: true });
console.log(failed ? `실패 ${failed}` : "모두 통과");
process.exitCode = failed ? 1 : 0;
