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
  checkManifest,
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
const images = { label: image(96, 64, [240, 200, 80]), front: image(108, 88, [200, 64, 42]), spine: image(36, 92, [200, 64, 42]) };
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
  cart: { color: "#3a6ea5", label: {}, front: { labelAt: [6, 10] }, spine: { textArea: [4, 10, 28, 68] } },
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
  const outside = await packWgba({ wasm: webapiWasm(), manifest: { ...manifestA, cart: { ...manifestA.cart, front: { labelAt: [20, 20] }, spine: { textArea: [4, 10, 28, 90] } } }, images });
  const res3 = await checkWgba(outside.bytes);
  ok(res3.errors.length === 0 && res3.warnings.some((w) => /labelAt/.test(w)) && res3.warnings.some((w) => /textArea/.test(w)), "라벨 자리·이름 자리가 그림 밖 → 경고", res3.warnings.join(" / "));
  const none = await packWgba({ wasm: webapiWasm(), manifest: manifestA, images: { front: images.front } });
  ok(!none.manifest.cart.label && !none.manifest.cart.spine && none.manifest.cart.front && none.notes.some((x) => /spine/.test(x)), "없는 그림은 설명서 항목도 뺌(빈 라벨 자리는 조용히)", none.notes.join(" / "));
}

// 버전·업데이트 규칙
ok(compareVersions("1.2.0", "1.10.0") === -1 && compareVersions("1.2.0", "1.2.0-beta.1") === 1 && compareVersions("1.2.0-beta.2", "1.2.0-beta.10") === -1 && compareVersions("2.0.0", "2.0.0") === 0, "유의적 버전 비교");
ok(updateAction({ version: "1.1.0", build: "x" }, { version: "1.2.0", build: "y" }) === "update" && updateAction({ version: "1.2.0", build: "x" }, { version: "1.2.0", build: "y" }) === "update" && updateAction({ version: "1.2.0", build: "x" }, { version: "1.1.0", build: "y" }) === "older" && updateAction({ version: "1.2.0", build: "x" }, { version: "1.2.0", build: "x" }) === "same", "같은 id: 높은 버전·같은 버전 다른 빌드 = 묻지 않고 바꿈, 낮은 버전 = 경고, 같은 빌드 = 그대로");

// 표시 비율 display.aspect(결정 143)·방향 입력 기본값 input.dpad(결정 145)
const { parseAspect, resolveInput } = await import("../../src-bundle/src/js/core/wgba-format.js");
const { screenOf } = await import("../../src-bundle/src/js/core/wgba-read.js");
{
  const manifestErrors = async (patch) => (await checkWgba((await packWgba({ wasm: webapiWasm(), manifest: { ...manifestA, ...patch } })).bytes)).errors;
  const good = [];
  for (const aspect of ["4:3", "3:4", "16:9", "8:7", "1024:768", "4:1", "1:4"]) good.push(...(await manifestErrors({ display: { aspect } })));
  ok(good.length === 0, "display.aspect 형식 통과: 4:3·3:4·16:9·8:7·1024:768·4:1·1:4", good.join(" / "));
  const bad = [];
  for (const aspect of ["4x3", "4:3:1", "0:3", "04:3", "4 : 3", "1025:768", "5:1", "1:5", "-4:3", 4, null, ""]) {
    const errors = await manifestErrors({ display: { aspect } });
    if (!errors.some((e) => /display\.aspect/.test(e))) bad.push(JSON.stringify(aspect));
  }
  const notObject = await manifestErrors({ display: "4:3" });
  ok(bad.length === 0 && notObject.some((e) => /display 는 객체/.test(e)), "display.aspect 형식 밖 → 오류(x·세 칸·0·앞자리 0·공백·1024 초과·4:1 넘는 비율·숫자·null·빈 글), display 가 객체 아님 → 오류", bad.join(", "));
  ok(parseAspect("8:6").join() === "4,3" && parseAspect("448:336").join() === "4,3" && parseAspect("4x3") === null, "parseAspect: 약분(8:6 → 4:3), 형식 밖 null");
  const gba = screenOf({});
  const kov = screenOf({ screen: { width: 448, height: 224 } });
  const kov43 = screenOf({ screen: { width: 448, height: 224 }, display: { aspect: "4:3" } });
  const same32 = screenOf({ screen: { width: 240, height: 160 }, display: { aspect: "3:2" } });
  ok(gba.aspect.join() === "3,2" && !gba.stretch && kov.aspect.join() === "2,1" && !kov.stretch && kov43.aspect.join() === "4,3" && kov43.stretch && !same32.stretch, "screenOf: 비율 없음 = 화면 버퍼 비율(240×160 → 3:2, 448×224 → 2:1, 늘리기 없음), 448×224 + 4:3 → 늘리기, 버퍼와 같은 비율 → 늘리기 없음", JSON.stringify({ gba, kov43 }));
  const dpadErrors = await manifestErrors({ input: { preset: "gba", dpad: "diagonal" } });
  const dpadGood = await manifestErrors({ input: { preset: "gba", dpad: "both" } });
  ok(dpadErrors.some((e) => /input\.dpad/.test(e)) && dpadGood.length === 0, "input.dpad: both·opposite·latest 밖 → 오류", dpadErrors.join(" / "));
  ok(resolveInput({ ...manifestA, input: { preset: "gba", dpad: "both" } }).dpad === "both" && resolveInput({ ...manifestA, input: { preset: "gba", dpad: "both" } }).gba && resolveInput(manifestA).dpad === null && resolveInput(null).dpad === null, "resolveInput: dpad 지정 값(버튼은 GBA 그대로면 gba 유지), 지정 없음·설명서 없음 = null");
  globalThis.window ??= {};
  const { dpadFor, gameDpadPatch } = await import("../../src-bundle/src/js/app/player.js");
  const kovInput = { gameId: "local.kov115", dpad: "both" };
  const gbaInput = { gameId: "", dpad: null };
  ok(dpadFor(gbaInput, { dpadMode: "latest" }) === "latest" && dpadFor(gbaInput, { dpadMode: "opposite", gameDpad: { "": "both" } }) === "opposite" && dpadFor(gbaInput, {}) === "latest", "dpadFor: 지정 없는 게임 = 전체 설정(없으면 latest)");
  ok(dpadFor(kovInput, { dpadMode: "latest" }) === "both" && dpadFor(kovInput, { dpadMode: "latest", gameDpad: { "local.kov115": "opposite" } }) === "opposite" && dpadFor(kovInput, { gameDpad: { "local.kov115": "wrong" } }) === "both", "dpadFor: 지정한 게임 = 게임별 값 → 설명서 값(전체 설정과 무관)");
  const p1 = gameDpadPatch(kovInput, { gameDpad: { other: "both" } }, "latest");
  const p2 = gameDpadPatch(kovInput, { gameDpad: { "local.kov115": "latest", other: "both" } }, "both");
  ok(p1.gameDpad["local.kov115"] === "latest" && p1.gameDpad.other === "both" && !("local.kov115" in p2.gameDpad) && p2.gameDpad.other === "both" && gameDpadPatch(gbaInput, {}, "both") === null, "gameDpadPatch: 설명서 값과 다르면 게임 id 에 기록, 같으면 삭제, 지정 없는 게임 = null(전체 설정)");
  // RS 기본 입력 input.rs(결정 178·179)
  const fight = { preset: "none", buttons: [{ id: "UP", role: "up", bit: 6 }, { id: "LEFT", role: "left", bit: 5 }, { id: "P", role: "a", bit: 0 }, { id: "K", role: "b", bit: 1 }, { id: "X", role: "extra", bit: 12 }] };
  const rsGood = await manifestErrors({ input: { ...fight, rs: [{ buttons: ["P", "K"], hold: 6 }, { buttons: ["UP", "LEFT"], gap: 0 }] } });
  const rsGba = await manifestErrors({ input: { preset: "gba", rs: [{ buttons: ["A", "B"] }] } });
  ok(rsGood.length === 0 && rsGba.length === 0, "input.rs: 버튼 id 묶음·hold·gap 통과(preset none·gba)", [...rsGood, ...rsGba].join(" / "));
  const rsBad = [];
  for (const rs of [[], {}, [{ buttons: [] }], [{ buttons: ["P", "P"] }], [{ buttons: ["Q"] }], [{ buttons: ["X"] }], [{ buttons: ["P"], hold: 0 }], [{ buttons: ["P"], hold: 601 }], [{ buttons: ["P"], gap: -1 }], [{ buttons: ["P"], gap: 1.5 }], Array.from({ length: 33 }, () => ({ buttons: ["P"] }))]) {
    const errors = await manifestErrors({ input: { ...fight, rs } });
    if (!errors.some((e) => /input\.rs/.test(e))) rsBad.push(JSON.stringify(rs).slice(0, 40));
  }
  ok(rsBad.length === 0, "input.rs 규칙 밖 → 오류(빈 배열·객체·빈 묶음·겹친 id·없는 id·extra role·hold 0·601·gap -1·1.5·33단계)", rsBad.join(", "));
  const rsIn = resolveInput({ ...manifestA, input: { ...fight, rs: [{ buttons: ["K", "P"], hold: 6 }, { buttons: ["LEFT", "UP"], gap: 0 }] } });
  ok(JSON.stringify(rsIn.rs) === JSON.stringify([{ keys: ["A", "B"], hold: 6, gap: 3 }, { keys: ["UP", "LEFT"], hold: 3, gap: 0 }]) && resolveInput(manifestA).rs === null && resolveInput(null).rs === null && resolveInput({ ...manifestA, input: { preset: "gba", rs: [{ buttons: ["A", "B"] }] } }).gba, "resolveInput: rs = 자리 이름(A·B·UP…) 단계, 기본 누름·간격 3, 없음 = null, GBA 버튼 그대로면 gba 유지", JSON.stringify(rsIn.rs));
}

// 앱 읽기(wgba-read.js — exe·웹이 .wgba 를 여는 길, S2)
const { readWgba, compileCode, supportProblem, pickText, gameInfo } = await import("../../src-bundle/src/js/core/wgba-read.js");
const { bootHost, inspectModule, readRomPayload } = await import("../../src-bundle/src/js/core/web-host.js");
const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const ra = await readWgba(a);
ok(ra && ra.manifest.id === manifestA.id && ra.build === resA.buildId && ra.romSha1 === sha1(fakeRom) && Object.keys(ra.images).join() === "label,front,spine", "앱 읽기: 설명서·빌드·롬 SHA-1·롬팩 그림 셋", ra && `${ra.build.slice(0, 8)} ${Object.keys(ra.images)}`);
const infoA = ra && gameInfo(ra);
ok(infoA?.gameId === manifestA.id && infoA.cart.front.labelAt[0] === 6 && infoA.cart.spine.textArea.length === 4 && infoA.cart.color === "#3a6ea5", "앱 읽기: 게임 항목 값(id·버전·롬팩 자리·색)", JSON.stringify(infoA?.cart));
const modR = await compileCode(ra.code);
ok(inspectModule(modR).usable && WebAssembly.Module.customSections(modR, "webgba.rom").length === 0, "앱 읽기: code 조각만 컴파일(롬 구획 없음) · 내장 호스트로 쓸 수 있음");
ok(same((await readRomPayload(ra.romPayload)).rom, fakeRom), "앱 읽기: rom 조각 → 롬(SHA-1 확인)");
ok((await readWgba(new Uint8Array(legacyPack(Buffer.from(webapiWasm()), Buffer.from(fakeRom))))) === null && (await readWgba(webapiWasm())) === null, "앱 읽기: 목차 없는 옛 .wgba·.wasm → null(옛 길 그대로)");
const errCode = async (bytes) => {
  try {
    await readWgba(bytes);
    return "열림";
  } catch (error) {
    return error.code;
  }
};
const tocA = await readTocFrom(a);
const flip = (name, at = 3) => {
  const copy = Uint8Array.from(a);
  copy[tocA.entries.find((e) => e.name === name).start + at] ^= 0x55;
  return copy;
};
ok((await errCode(flip("code", 20))) === "hash" && (await errCode(flip("rom", 40))) === "hash" && (await errCode(flip("manifest"))) === "hash", "앱 읽기: code·rom·설명서가 망가지면 열지 않음(SHA-256)");
const labelBroken = await readWgba(flip("cart.label", 30));
ok(labelBroken && !labelBroken.images.label && labelBroken.images.front, "앱 읽기: 롬팩 그림만 망가지면 그 그림만 빼고 엶");
ok((await errCode(a.subarray(0, a.length - 1))) === "length", "앱 읽기: 잘린 파일(목차의 파일 길이와 다름) 열지 않음");
const newer = (await packWgba({ wasm: webapiWasm(), manifest: { ...manifestA, needs: ["teleport"] } })).bytes;
ok((await errCode(newer)) === "newer", "앱 읽기: 모르는 needs → 새 webGBA 필요");
ok(supportProblem(manifestB) === null && supportProblem({ ...manifestA, needs: ["net"] }) === null && supportProblem({ ...manifestA, needs: ["net"] }, { net: false })?.code === "needs" && supportProblem({ ...manifestA, screen: { width: 320, height: 240 } }) === null && supportProblem(manifestA) === null, "앱 읽기: script·240×160 아닌 화면은 엶(S4), needs net 도 엶(MP1 — 모르는 호스트면 가림)");
const rb = await readWgba(b);
const levels = rb && (await rb.chunk("data.levels"));
const noChunk = await rb.chunk("code").then(() => "열림", (e) => e.code);
ok(rb && new TextDecoder().decode(rb.js) === new TextDecoder().decode(js) && levels?.length === 4096 && levels[0] === 7 && noChunk === "data", "앱 읽기: ② js 조각(풀어서)·데이터 조각은 부를 때(data.* 만)", `js ${rb?.js?.length} · levels ${levels?.length} · code → ${noChunk}`);
ok(pickText(manifestA.name, "ko") === "헬로 웹 API" && pickText(manifestA.name, "ja") === "Hello Web API" && pickText("포켓몬 Rapid", "en") === "포켓몬 Rapid", "이름 고르기: 화면 언어 칸 → en → ko → ja");
{
  // 화면 언어 3종 × 설명서 이름 형태(세 칸·한 칸·두 칸·문자열·빈 칸·그 밖의 언어)
  const { pickTextKey, TEXT_LANGS } = await import("../../src-bundle/src/js/core/lang-text.js");
  const forms = [
    { form: "세 칸", name: { en: "Bloody Roar 2", ko: "동물철권 2", ja: "ブラッディロア2" }, want: { en: "Bloody Roar 2", ko: "동물철권 2", ja: "ブラッディロア2" } },
    { form: "en 한 칸", name: { en: "Demon Front" }, want: { en: "Demon Front", ko: "Demon Front", ja: "Demon Front" } },
    { form: "ko 한 칸", name: { ko: "보글보글" }, want: { en: "보글보글", ko: "보글보글", ja: "보글보글" } },
    { form: "ja 한 칸", name: { ja: "バブルボブル" }, want: { en: "バブルボブル", ko: "バブルボブル", ja: "バブルボブル" } },
    { form: "ko·ja 두 칸", name: { ja: "三国戦紀 115", ko: "삼국전기 115" }, want: { en: "삼국전기 115", ko: "삼국전기 115", ja: "三国戦紀 115" } },
    { form: "en·ja 두 칸", name: { ja: "ポケモン ラピッド", en: "Pokémon Rapid" }, want: { en: "Pokémon Rapid", ko: "Pokémon Rapid", ja: "ポケモン ラピッド" } },
    { form: "en·ko 두 칸", name: { ko: "보글보글 2", en: "Bubble Bobble II" }, want: { en: "Bubble Bobble II", ko: "보글보글 2", ja: "Bubble Bobble II" } },
    { form: "문자열", name: "Knights of Valour 115", want: { en: "Knights of Valour 115", ko: "Knights of Valour 115", ja: "Knights of Valour 115" } },
    { form: "빈 칸·공백 칸은 없는 것", name: { en: "", ko: "  ", ja: "デーモンフロント" }, want: { en: "デーモンフロント", ko: "デーモンフロント", ja: "デーモンフロント" } },
    { form: "그 밖의 언어는 en·ko·ja 다음", name: { fr: "Bulles", de: "Blasen", ko: "보글보글" }, want: { en: "보글보글", ko: "보글보글", ja: "보글보글" } },
    { form: "그 밖의 언어만(적힌 순서)", name: { fr: "Bulles", de: "Blasen" }, want: { en: "Bulles", ko: "Bulles", ja: "Bulles" } },
  ];
  const wrong = [];
  for (const { form, name, want } of forms) for (const lang of TEXT_LANGS) if (pickText(name, lang) !== want[lang]) wrong.push(`${form}/${lang} → ${pickText(name, lang)}`);
  ok(wrong.length === 0, `이름 고르기 ${forms.length}형태 × 화면 언어 3종`, wrong.join(" / "));
  ok(pickText(undefined, "ko") === "" && pickText(null, "ko") === "" && pickText(["x"], "ko") === "" && pickText({}, "ko") === "" && pickTextKey({ ko: "x" }) === "ko" && pickText({ ja: "B", en: "A" }) === "A", "이름 고르기: 값 없음·배열·빈 객체 = 빈 글, 언어 없이 부르면 en → ko → ja");
  const { buttonLabel } = await import("../../src-bundle/src/js/app/player.js");
  ok(buttonLabel({ id: "JUMP", label: { ko: "점프", ja: "ジャンプ" } }, "en") === "점프" && buttonLabel({ id: "JUMP", label: { ja: "ジャンプ" } }, "ko") === "ジャンプ", "버튼 label 도 같은 순서(en 없으면 ko → ja)");
  const { boardView, boardConfig } = await import("../../src-bundle/src/js/core/net/board.js");
  ok(typeof boardView === "function" && typeof boardConfig === "function", "멀티플레이 상태 메뉴 글(board.js)도 lang-text.js 를 씀(가져오기 성공)");
  const check = (patch) => {
    const errors = [];
    const warnings = [];
    checkManifest({ ...manifestA, ...patch }, errors, warnings);
    return { errors, warnings };
  };
  const three = check({ name: { en: "Knights of Valour 115", ko: "삼국전기 115", ja: "三国戦紀 115" }, shortName: { en: "Pokémon Rapid", ko: "포켓몬스터 래피드", ja: "ポケモン ラピッド" } });
  ok(three.errors.length === 0 && three.warnings.length === 0, "검사: 세 칸 이름·짧은 이름 통과", [...three.errors, ...three.warnings].join(" / "));
  const long = check({ name: { en: "A".repeat(48), ko: "가".repeat(49), ja: "" } });
  ok(long.errors.length === 2 && long.errors.some((e) => e.includes("name.ko") && e.includes("49자")) && long.errors.some((e) => e.includes("name.ja") && e.includes("비었습니다")), "검사: 칸마다 48자·빈 칸 오류(어느 언어인지)", long.errors.join(" / "));
  const shortLong = check({ shortName: { en: "Short", ja: "あ".repeat(17) } });
  ok(shortLong.errors.length === 0 && shortLong.warnings.length === 1 && shortLong.warnings[0].includes("shortName.ja") && shortLong.warnings[0].includes("17자"), "검사: 짧은 이름 16자 초과는 그 칸 경고", shortLong.warnings.join(" / "));
  const emoji = check({ name: "😀".repeat(48) });
  ok(emoji.errors.length === 0, "검사: 글자 수는 코드 포인트 기준(이모지 48개 통과)", emoji.errors.join(" / "));
  const other = check({ name: { fr: "Bulles" } });
  ok(other.errors.length === 0 && other.warnings.some((w) => w.includes("en·ko·ja") && w.includes("fr")), "검사: en·ko·ja 칸이 없으면 경고(그 밖의 언어 칸을 씀)", other.warnings.join(" / "));
  const bad = [check({ name: undefined }), check({ name: {} }), check({ name: ["x"] }), check({ name: { en: 3 } })];
  ok(bad.every((r) => r.errors.length === 1), "검사: 이름 없음·빈 객체·배열·글이 아닌 칸 = 오류", bad.map((r) => r.errors[0]).join(" / "));
}
// 가져오기 webgba.v1(규격 4.1.2) + 롬 없는 ① 시작
function v1Wasm() {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f], [0x60, 0, 0]]));
  const imps = sec(2, vec([[...str("webgba"), ...str("v1"), 0, 2]]));
  const funcs = sec(3, vec([[0], [1], [0]]));
  const mem = sec(5, vec([[0x00, 3]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 1], [...str("Web_RunFrame"), 0, 2], [...str("Web_GetFramebuffer"), 0, 3]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(5), 0, 0x41, ...s(1024), 0x0b]]));
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...imps, ...funcs, ...mem, ...exps, ...code]);
}
const modV1 = await WebAssembly.compile(v1Wasm());
let v1Ran = false;
try {
  const { host } = await bootHost({ module: modV1, rom: null, save: null });
  v1Ran = host.runFrame(0) && host.framebuffer().length === 240 * 160 * 4;
} catch (error) {
  v1Ran = String(error);
}
ok(inspectModule(modV1).usable && v1Ran === true, "가져오기 webgba.v1 을 아는 함수로 받음 · 롬 없는 ① 시작(rom null)", String(v1Ran));
// check 경고(S5 의견): 롬 없는 ① 인데 webgba.v1 없음 / 있으면 경고 없음, 호스트 몫 키 Pause·KeyP, entry.js 는 "js" 만
{
  const noRom = { ...manifestA, cart: undefined, rom: { required: false } };
  const w1 = (await checkWgba((await packWgba({ wasm: webapiWasm(), manifest: noRom })).bytes)).warnings;
  const w2 = (await checkWgba((await packWgba({ wasm: v1Wasm(), manifest: noRom })).bytes)).warnings;
  ok(w1.some((w) => /롬 없이 도는 ① 게임.*webgba\.v1/.test(w)) && !w2.some((w) => /webgba\.v1/.test(w)), "check: 롬 없는 ① 에 webgba.v1 없으면 경고 · 있으면 경고 없음", [...w1, "|", ...w2].join(" / "));
  const keyed = { ...manifestA, cart: undefined, input: { buttons: [{ id: "A", keys: ["KeyP"] }, { id: "B", keys: ["Pause"] }] } };
  const w3 = (await checkWgba((await packWgba({ wasm: v1Wasm(), manifest: keyed })).bytes)).warnings;
  ok(w3.some((w) => /KeyP 는 호스트 몫/.test(w)) && w3.some((w) => /Pause 는 호스트 몫/.test(w)), "check: 기본 키 KeyP·Pause → 호스트 몫 키 경고", w3.join(" / "));
  const named = await packWgba({ wasm: scriptWasm(), manifest: { ...manifestB, entry: { style: "module", js: "main" } }, js });
  const r4 = await checkWgba(named.bytes);
  const opened = await readWgba(named.bytes);
  ok(r4.errors.length === 0 && r4.warnings.some((w) => /entry\.js 는 "js" 만/.test(w)) && opened?.js?.length === js.length, "check: entry.js 가 \"js\" 가 아니면 경고 · 앱은 조각 js 를 그대로 씀", r4.warnings.join(" / "));
}

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
