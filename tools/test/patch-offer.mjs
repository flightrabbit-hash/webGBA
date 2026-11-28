// .gba 열기 때 부모 롬 패치 고르기(설계 39절)를 node 에서: 발행 도구(patches → index 서명 · verify · upload --dry-run)와
// 앱 공용 코드(core/patch-offer.js — 목록 읽기 · 롬 SHA-1 일치 · 생성 · 최신까지 업데이트 · 예외). R2 는 쓰지 않는다(파일에서 읽는 흉내 fetch).
//   node tools/test/patch-offer.mjs <작업 폴더> <발행 묶음(update_feed)> <파이어레드.gba> <햄토리 원본.gba> <햄토리.wgbp> <도시락 원본.gba> <도시락.wgbp>
//                                   [<시험 패치.wgba> <시험 패치.wgbp> <햄토리 1.0.0 결과 롬.gba>]
// 작업 폴더(저장소 밖)에 시험 키 · 묶음 사본(<작업>/bundle/ok — update-server.mjs 짜임)을 만든다. 원래 묶음은 읽기만.
// 시험 패치 = patch-fixture.mjs + make-wgbp(같은 부모 롬의 둘째 패치 → 여러 개 일치).
import fs from "node:fs";
import path from "node:path";
import { buildIndex, feed, keygen, loadSecret, patchesCommand, publicOf, signText, upload, verify } from "../lib/update-cmds.mjs";
import { addSkip, installOffer, matchPatches, offersFor, patchList, readPatches, readSkip, romSha1s } from "../../src-bundle/src/js/core/patch-offer.js";
import { buildGame, readPatch } from "../../src-bundle/src/js/core/wgbp.js";
import { indexedFeed } from "../../src-bundle/src/js/core/wgba-update.js";

const [work, feedRoot, fireRed, hamRom, hamWgbp, bentoRom, bentoWgbp, testWgba, testWgbp, hamResult] = process.argv.slice(2);
if (!bentoWgbp) {
  console.error("사용법: node tools/test/patch-offer.mjs <작업 폴더> <발행 묶음> <파이어레드.gba> <햄토리 원본.gba> <햄토리.wgbp> <도시락 원본.gba> <도시락.wgbp> [<시험 패치.wgba> <시험 패치.wgbp> <햄토리 1.0.0 결과 롬>]");
  process.exit(2);
}
const RAPID = "com.flightrabbit.rapid";
const HAM = "local.hamtaro3";
const BENTO = "local.kitchenbento";
const TEST = "local.patchtest";
const OK = path.join(work, "bundle", "ok");
const BASE = "http://127.0.0.1:9/";
let pass = 0;
let fail = 0;
const check = (ok, line) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "통과" : "실패"}  ${line}`);
};
const quiet = async (work) => {
  const log = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { value: await work(), lines };
  } finally {
    console.log = log;
  }
};

fs.rmSync(path.join(work, "bundle"), { recursive: true, force: true });
fs.mkdirSync(OK, { recursive: true });
const keyFile = path.join(work, "test-key.pem");
await quiet(() => keygen(keyFile, { force: true }));
const secret = loadSecret(keyFile);
const pub = publicOf(secret);

function copyGame(id, { keepFrom }) {
  const env = JSON.parse(fs.readFileSync(path.join(feedRoot, id, "latest.json"), "utf8"));
  const signed = JSON.parse(env.signed);
  if (!keepFrom) signed.from = [];
  const dir = path.join(OK, id);
  for (const ref of [...signed.from.map((item) => item.patch), ...(signed.full ? [signed.full] : [])]) {
    const to = path.join(dir, ...ref.url.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(feedRoot, id, ...ref.url.split("/")), to);
  }
  const text = JSON.stringify(signed);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify({ wgbaFeed: 1, signed: text, signature: signText(text, secret) }, null, 1)}\n`);
  return signed;
}

const feeds = { [RAPID]: copyGame(RAPID, { keepFrom: false }), [HAM]: copyGame(HAM, { keepFrom: true }), [BENTO]: copyGame(BENTO, { keepFrom: true }) };
if (testWgba) {
  await quiet(() => feed({ dir: path.join(OK, TEST), key: keyFile, wgba: testWgba, index: false }));
  feeds[TEST] = JSON.parse(JSON.parse(fs.readFileSync(path.join(OK, TEST, "latest.json"), "utf8")).signed);
}

// ── 발행 도구 ──
const added = [];
added.push(await quiet(() => patchesCommand({ root: OK, id: RAPID, full: true, names: { ko: "포켓몬 래피드", en: "Pokemon Rapid", ja: "ポケモン ラピッド" } })));
added.push(await quiet(() => patchesCommand({ root: OK, id: HAM, wgbp: hamWgbp, version: "1.0.0", names: { ko: "햄토리 러브러브 대모험", en: "Hamtaro: Ham-Ham Heartbreak", ja: "とっとこハム太郎3" } })));
added.push(await quiet(() => patchesCommand({ root: OK, id: BENTO, wgbp: bentoWgbp, version: "1.0.0", names: { ko: "구르메 키친", en: "Gourmet Kitchen", ja: "グルメキッチン" } })));
if (testWgbp) added.push(await quiet(() => patchesCommand({ root: OK, id: TEST, wgbp: testWgbp, version: "1.0.0", names: { ko: "시험 패치", en: "Patch Test" } })));
check(added.every((got) => got.value === 0), `patches 명령 ${added.length}줄 확인 통과`);
const wrong = await quiet(() => patchesCommand({ root: OK, id: HAM, wgbp: hamWgbp, version: "1.0.1", names: {} }));
check(wrong.value === 1 && wrong.lines.some((line) => line.includes("맞지 않음")), "버전이 틀린 고정 .wgbp(1.0.1 이라 적음) = 목록에서 뺌");
await quiet(() => patchesCommand({ root: OK, id: HAM, wgbp: hamWgbp, version: "1.0.0", names: {} }));
const built = await quiet(() => buildIndex(OK, secret));
check(built.value === 0 && built.lines.some((line) => line.includes("패치 목록  local.hamtaro3 · 1.0.0 → 1.0.1")), `index 서명 · patches ${built.lines.filter((line) => line.startsWith("패치 목록  ")).length}줄`);
const indexText = fs.readFileSync(path.join(OK, "index.json"), "utf8");
const signed = JSON.parse(JSON.parse(indexText).signed);
const items = readPatches(signed.patches, `${BASE}index.json`);
check(items.length === (testWgbp ? 4 : 3), `앱 규칙으로 읽은 patches ${items.length}줄`);
const ham = items.find((item) => item.id === HAM);
check(ham?.install?.wgba?.sha1 === "67ccbddd15699fd551e736c9fee1b1c9d479901b" && ham.parents[0]?.sha1 === "2525cc23524068dfb3a2b4e0ce7b736f95023e82" && ham.file === "hamtaro-ham-ham-heartbreak.wgba", `햄토리 줄 = 1.0.0 SHA-1 · 부모 2525cc23 · 파일 ${ham?.file}`);
const rapid = items.find((item) => item.id === RAPID);
check(rapid?.install === "full" && rapid.parents.length === 3 && rapid.file === `pokemon-rapid-v.${feeds[RAPID].version}.wgba`, `래피드 줄 = full · 부모 ${rapid?.parents.length}개 · 파일 ${rapid?.file}`);
check(Buffer.byteLength(JSON.stringify(signed.patches)) < 4096, `patches 크기 ${Buffer.byteLength(JSON.stringify(signed.patches))}바이트`);
const verified = await quiet(() => verify(OK, { pub }));
check(verified.value === 0 && verified.lines.some((line) => line.startsWith("목록 패치 ")), `verify 통과 · ${verified.lines.find((line) => line.startsWith("목록 패치 ")) ?? "패치 행 없음"}`);
const planned = await quiet(() => upload(OK, { dryRun: true }));
const planKeys = planned.lines.filter((line) => line.startsWith("올릴 것 ")).map((line) => line.split(" ")[2]);
check(planKeys.at(-1) === "index.json" && planKeys.some((key) => key === signed.patches.items.find((item) => item.id === HAM)?.install?.wgbp?.url),`upload --dry-run = 고정 .wgbp 포함 · index.json 마지막(${planKeys.length}개)`);

// ── 앱 공용 코드 ──
const fileFetch = ({ hang = false, missing = null, cut = null } = {}) => async (url, init = {}) => {
  const u = new URL(url);
  if (hang) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  if (missing?.test(u.pathname)) return new Response("no", { status: 404 });
  const file = path.join(OK, ...u.pathname.split("/").filter(Boolean).map(decodeURIComponent));
  if (!fs.existsSync(file)) return new Response("no", { status: 404 });
  const bytes = fs.readFileSync(file);
  return new Response(cut?.test(u.pathname) ? bytes.subarray(0, bytes.length >> 1) : bytes);
};
const index = { url: `${BASE}index.json`, key: pub };
const build = (patch, rom, onStage) => buildGame(readPatch(patch), rom, { onProgress: onStage });
const readRom = (file) => new Uint8Array(fs.readFileSync(file));

async function offersOf(rom, options = {}) {
  const got = await patchList(index, { cache: new Map(), fetchImpl: fileFetch(options), ...(options.timeout ? { timeout: options.timeout } : {}) });
  if (!got.list) return { got, offers: [] };
  return { got, offers: await offersFor(got.list, index, matchPatches(got.items, await romSha1s(rom))) };
}

async function installAll(name, romFile, wantIds) {
  const rom = readRom(romFile);
  const { offers } = await offersOf(rom);
  check(offers.map((offer) => offer.id).join() === wantIds.join(), `${name}: 일치 ${offers.map((offer) => `${offer.id} ${offer.target.version}→${offer.version}`).join(", ") || "없음"}`);
  for (const offer of offers) {
    const stages = new Set();
    let last = 0;
    let back = false;
    const t0 = Date.now();
    const made = await installOffer(offer, rom, {
      build,
      fetchImpl: fileFetch(),
      onProgress: ({ stage, fraction }) => {
        stages.add(stage);
        if (fraction + 1e-9 < last) back = true;
        last = fraction;
      },
    });
    const feedOf = feeds[offer.id];
    check(made.sha1 === feedOf.wgba.sha1 && made.bytes.length === feedOf.wgba.size && made.version === feedOf.version && !made.updateError, `${name} → ${offer.id} ${made.version} SHA-1 ${made.sha1.slice(0, 8)}(= 공개 ${feedOf.version}) · 단계 ${[...stages].join("·")} · ${Date.now() - t0}ms`);
    check(!back, `${name} → ${offer.id} 진행 값이 줄지 않음`);
  }
}

await installAll("파이어레드", fireRed, testWgbp ? [RAPID, TEST] : [RAPID]);
await installAll("햄토리 원본", hamRom, [HAM]);
await installAll("도시락 원본", bentoRom, [BENTO]);

if (hamResult) {
  const { offers } = await offersOf(readRom(hamResult));
  check(offers.length === 0, "햄토리 1.0.0 결과 롬(목록에 없는 롬) = 일치 없음");
}
{
  const { got } = await offersOf(readRom(hamRom), { missing: /\/index\.json$/ });
  check(!got.list && got.items.length === 0, `목록 없음(404) = 목록 null(${got.error?.code ?? ""})`);
}
{
  await quiet(() => keygen(path.join(work, "other-key.pem"), { force: true }));
  const got = await patchList({ ...index, key: publicOf(loadSecret(path.join(work, "other-key.pem"))) }, { cache: new Map(), fetchImpl: fileFetch() });
  check(!got.list, `다른 키 서명 = 목록 null(${got.error?.code ?? ""})`);
}
{
  const t0 = Date.now();
  const { got } = await offersOf(readRom(hamRom), { hang: true, timeout: 300 });
  check(!got.list && Date.now() - t0 < 2000, `응답 없음 = ${Date.now() - t0}ms 뒤 목록 null(${got.error?.code ?? ""} ${got.error?.params?.why ?? ""})`);
}
{
  const rom = readRom(hamRom);
  const { offers } = await offersOf(rom);
  const made = await installOffer(offers[0], rom, { build, fetchImpl: fileFetch({ missing: /\.wgbd$/ }) });
  check(made.version === "1.0.0" && made.sha1 === "67ccbddd15699fd551e736c9fee1b1c9d479901b" && made.updateError, `업데이트 패치 받기 실패 = 1.0.0 으로 남김(${made.updateError?.code ?? ""})`);
  let code = "";
  try {
    await installOffer(offers[0], rom, { build, fetchImpl: fileFetch({ cut: /\.wgbp$/ }) });
  } catch (error) {
    code = error.code;
  }
  check(code === "downloadSize", `.wgbp 반만 받음 = ${code}`);
  const abort = new AbortController();
  abort.abort();
  code = "";
  try {
    await installOffer(offers[0], rom, { build, fetchImpl: fileFetch(), signal: abort.signal });
  } catch (error) {
    code = error.code;
  }
  check(code === "cancelled", `취소 = ${code}`);
}
{
  const list = addSkip(addSkip(["zz"], "a".repeat(40)), "a".repeat(40));
  check(list.length === 1 && readSkip([...list, "bad"]).length === 1 && readSkip(Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(40, "0"))).length === 64, "다시 묻지 않기 목록(중복 · 형식 · 최대 64)");
}
{
  const got = await patchList(index, { cache: new Map(), fetchImpl: fileFetch() });
  const all = await Promise.all(Object.keys(feeds).map((id) => indexedFeed(got.list, id, { key: pub, feed: `${BASE}${id}/latest.json` }).then(() => true, () => false)));
  check(all.every(Boolean), "patches 를 넣은 목록에서도 게임별 버전 파일 확인(기존 업데이트 경로) 그대로");
}
console.log(`\n${fail ? "실패 있음" : "모두 통과"} — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
