// 파일 열기 전 업데이트 — 버전 캐시(createVersionCache)·요청 수 시험. node 만, 롬·앱·네트워크 없이. node tools/test/open-update.mjs
// 앱 실행(prefetchFeeds + 앱 확인 loadApp + 버전 캐시 rememberIndex) = index.json 1번(전과 같음) · 롬 가져오기 목록 = R2 요청 0번 ·
// 파일 열기(캐시 있음) = 0번 · 캐시 없음/오래됨 = 열 때 1번(10분 안 다시 시도 없음) · 오프라인 = 0번 · 로컬 저장 다시 읽기 ·
// 롬 가져오기 목록이 낮은 버전이면 캐시를 낮추지 않음 · 서명된 목록(메모리)이 롬 가져오기 목록보다 먼저 · 게임별 버전 파일(시험 덮어쓰기)도 캐시.
import crypto from "crypto";
import { appSource, loadApp } from "../../src-bundle/src/js/core/app-update.js";
import { checkGames, createVersionCache, forgetFeeds, indexFeeds, LATEST_KEY, LATEST_MAX_AGE, loadIndex, OPEN_RETRY_MS, prefetchFeeds, verifyIndex } from "../../src-bundle/src/js/core/wgba-update.js";
import { publicOf, signText } from "../lib/update-cmds.mjs";

let failed = 0;
const ok = (cond, text, detail = "") => {
  console.log(`${cond ? "통과" : "실패"} ${text}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const hex = (c) => c.repeat(40);

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicOf(privateKey);
const HOST = "http://127.0.0.1:9";
const INDEX_URL = `${HOST}/index.json`;
const MAIN = "local.atetris";
const SIDE = "local.kof98";
const THIRD = "io.example.third";
const envelope = (obj) => {
  const text = JSON.stringify(obj);
  return { wgbaFeed: 1, signed: text, signature: signText(text, privateKey) };
};
const feedOf = (id, version) =>
  envelope({
    id,
    version,
    wgba: { sha1: hex("b"), size: 1000 },
    from: [{ sha1: hex("a"), to: hex("b"), version: "1.0.0", patch: { url: "patches/p.wgbd", size: 10, sha256: "0".repeat(64) } }],
  });
const appEnvelope = () => {
  const text = JSON.stringify({ id: "com.flightrabbit.webgba", version: "0.0.1", platform: "windows-x64", files: [{ path: "webgba.exe", size: 10, sha256: "0".repeat(64), get: { url: "app/webgba.exe.z", size: 10, sha256: "0".repeat(64) } }] });
  return { wgbaApp: 1, signed: text, signature: signText(text, privateKey) };
};
let indexSeq = 0;
function indexText(versions) {
  const feeds = Object.fromEntries(Object.entries(versions).map(([id, version]) => [id, feedOf(id, version)]));
  const apps = { "com.flightrabbit.webgba": appEnvelope() };
  const signed = JSON.stringify({ time: new Date(Date.UTC(2026, 10, 23, 0, 0, indexSeq++)).toISOString(), feeds: Object.fromEntries(Object.entries(feeds).map(([id, e]) => [id, sha256(e.signed)])), apps: { "com.flightrabbit.webgba": sha256(apps["com.flightrabbit.webgba"].signed) } });
  return JSON.stringify({ wgbaIndex: 1, signed, signature: signText(signed, privateKey), feeds, apps });
}

let server = { [INDEX_URL]: indexText({ [MAIN]: "1.2.0", [SIDE]: "2.0.0" }), [`${HOST}/${THIRD}/latest.json`]: JSON.stringify(feedOf(THIRD, "3.1.0")) };
let hits = [];
let down = false;
const fetchImpl = async (url) => {
  hits.push(url.replace(HOST, ""));
  if (down) throw new TypeError("Failed to fetch");
  const text = server[url];
  return text ? new Response(text, { status: 200 }) : new Response("no", { status: 404 });
};
const store = () => {
  const data = new Map();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};
const overrides = { feeds: { [THIRD]: { feed: `${HOST}/${THIRD}/latest.json`, key: pub } }, index: { url: INDEX_URL, key: pub } };
const game = (gameId, version) => ({ gameId, version, update: null });
const take = () => {
  const out = hits;
  hits = [];
  return out;
};

/* ── 1) 앱 실행: 목록 1번을 게임 미리 받기·앱 확인·버전 캐시가 함께 ── */
const storage = store();
let cache = new Map();
const opts = (extra = {}) => ({ overrides, cache, fetchImpl, memory: null, ...extra });
const vc = createVersionCache({ storage, online: () => true });
prefetchFeeds([game(MAIN, "1.0.0")], opts());
await loadApp(appSource(overrides), { cache, fetchImpl, memory: null });
const count = await vc.rememberIndex({ index: overrides.index, cache, fetchImpl, memory: null });
await checkGames([game(MAIN, "1.0.0"), game(THIRD, "3.0.0")], opts({ onFeed: vc.keepFeed }));
const boot = take();
ok(boot.filter((h) => h === "/index.json").length === 1, "앱 실행: 게임 미리 받기·앱 확인·버전 캐시·목록 검사 = index.json 1번(전과 같음)", boot.join(" "));
ok(count === 2 && vc.get(MAIN)?.version === "1.2.0" && vc.get(MAIN).from === "index" && vc.get(SIDE)?.version === "2.0.0", "버전 캐시 = 목록의 게임별 최신 버전(서명·해시 확인 뒤)", JSON.stringify(vc.get(MAIN)));
const saved = JSON.parse(storage.getItem(LATEST_KEY));
ok(saved[MAIN]?.version === "1.2.0" && Math.abs(saved[MAIN].at - Date.now()) < 5000 && saved[THIRD]?.version === "3.1.0" && saved[THIRD].from === "feed", "로컬 저장(webgba.updateLatest) = 버전·받은 시각·출처(목록·게임별 버전 파일)", JSON.stringify(saved));

/* ── 2) 파일 열기: 네트워크 없이 비교 ── */
let r = await vc.newerFor(game(MAIN, "1.2.0"), opts());
ok(!r.feed && take().length === 0, "최신 파일 열기 → 업데이트 없음 · 요청 0번", r.why);
r = await vc.newerFor(game(MAIN, "1.0.0"), opts());
ok(r.feed?.version === "1.2.0" && r.why === "memory" && take().length === 0, "옛 파일 열기 → 서명된 새 버전(메모리) · 요청 0번", r.why);
r = await vc.newerFor(game(THIRD, "3.0.0"), opts());
ok(r.feed?.version === "3.1.0" && take().length === 0, "게임별 버전 파일 게임(시험 덮어쓰기 feeds)도 앱 실행 때 받은 것으로 · 요청 0번", r.why);
r = await vc.newerFor(game("io.example.none", "1.0.0"), opts());
ok(!r.feed && r.why === "source" && take().length === 0, "update 항목 없는 게임 → 확인 안 함 · 요청 0번");

/* ── 3) 롬 가져오기 목록(서버 list 응답 재사용 = R2 요청 0번) ── */
const listed = vc.rememberList([{ id: MAIN, version: "1.1.0" }, { id: SIDE, version: "2.0.0" }, { id: "io.example.new", version: "0.5.0" }, { id: "io.example.new", version: "0.6.0" }, { id: "bad id", version: "1" }]);
ok(take().length === 0, "롬 가져오기 목록 기록 = 요청 0번");
ok(listed === 2 && vc.get(MAIN).version === "1.2.0" && vc.get("io.example.new")?.version === "0.6.0" && vc.get("io.example.new").from === "roms", "롬 가져오기 목록 = 새 게임 추가·같은 id 는 높은 버전 · 더 낮은 버전으로 캐시를 낮추지 않음", JSON.stringify({ listed, main: vc.get(MAIN), side: vc.get(SIDE) }));
ok(Date.now() - vc.get(SIDE).at < 5000 && vc.get(SIDE).from === "index", "같은 버전 = 받은 시각만 갱신(출처 유지)");
vc.rememberList([{ id: MAIN, version: "9.0.0" }]);
r = await vc.newerFor(game(MAIN, "1.2.0"), opts());
ok(!r.feed && r.why === "memory" && take().length === 0, "롬 가져오기 목록이 더 높아도 이번 실행의 서명된 목록(메모리)이 먼저 → 요청 0번", r.why);

/* ── 4) 앱 다시 실행(로컬 저장만, 오프라인) ── */
const vcOff = createVersionCache({ storage, online: () => false });
cache = new Map();
ok((await vcOff.rememberIndex({ index: overrides.index, cache, fetchImpl, memory: null })) === 0 && take().length === 0, "오프라인 앱 실행 → 목록 요청 안 함");
r = await vcOff.newerFor(game(SIDE, "2.0.0"), opts());
ok(!r.feed && r.why === "cache" && take().length === 0, "오프라인 · 로컬 캐시와 같은 버전 → 요청 0번", r.why);
r = await vcOff.newerFor(game(MAIN, "1.0.0"), opts());
ok(!r.feed && r.why === "offline" && take().length === 0, "오프라인 · 새 버전이 있어도 받을 수 없음 → 그냥 실행 · 요청 0번", r.why);

/* ── 5) 캐시 없음(처음 실행 때 오프라인) → 열 때 1번 ── */
const empty = store();
const vcNew = createVersionCache({ storage: empty, online: () => true });
cache = new Map();
r = await vcNew.newerFor(game(MAIN, "1.0.0"), opts());
ok(r.feed?.version === "1.2.0" && r.why === "fetch" && take().join() === "/index.json", "캐시 없음 → 열 때 목록 1번 → 새 버전", r.why);
ok(JSON.parse(empty.getItem(LATEST_KEY))?.[MAIN]?.version === "1.2.0", "열 때 받은 결과도 캐시에 남음");
r = await vcNew.newerFor(game(SIDE, "1.0.0"), opts());
ok(r.feed?.version === "2.0.0" && r.why === "memory" && take().length === 0, "같은 목록의 다른 게임 → 요청 0번(이미 받음)", r.why);

/* ── 6) 받기 실패 → 1번만, 10분 안 다시 시도 안 함 ── */
let clock = Date.now();
const vcFail = createVersionCache({ storage: store(), online: () => true, now: () => clock });
cache = new Map();
down = true;
await vcFail.rememberIndex({ index: overrides.index, cache, fetchImpl, memory: null });
ok(take().join() === "/index.json", "앱 실행 목록 실패 = 1번(대체 없음)");
r = await vcFail.newerFor(game(MAIN, "1.0.0"), opts());
const firstTry = take();
r = await vcFail.newerFor(game(MAIN, "1.0.0"), opts());
const secondTry = take();
ok(!r.feed && firstTry.join() === "/index.json" && secondTry.length === 0 && r.why === "retry", "열 때 실패 → 1번만 · 바로 다음 열기는 요청 0번(그냥 실행)", `${firstTry.join()} / ${secondTry.join()} / ${r.why}`);
down = false;
clock += OPEN_RETRY_MS + 1000;
r = await vcFail.newerFor(game(MAIN, "1.0.0"), opts());
ok(r.feed?.version === "1.2.0" && take().join() === "/index.json", `${OPEN_RETRY_MS / 60000}분 뒤 열기 → 다시 1번`, r.why);

/* ── 7) 오래된 캐시(받은 지 24시간 넘음) → 열 때 1번 ── */
let shift = 0;
const vcOld = createVersionCache({ storage: store(), online: () => true, now: () => Date.now() + shift });
cache = new Map();
await vcOld.rememberIndex({ index: overrides.index, cache, fetchImpl, memory: null });
take();
server = { ...server, [INDEX_URL]: indexText({ [MAIN]: "1.3.0", [SIDE]: "2.0.0" }) };
r = await vcOld.newerFor(game(MAIN, "1.2.0"), opts());
ok(!r.feed && take().length === 0, "24시간 안 → 캐시 그대로(서버에 새 버전이 있어도 요청 0번)", r.why);
shift = LATEST_MAX_AGE + 60000;
r = await vcOld.newerFor(game(MAIN, "1.2.0"), opts());
ok(r.feed?.version === "1.3.0" && r.why === "fetch" && take().join() === "/index.json", "24시간 넘음 → 열 때 목록 1번 → 새 버전 1.3.0", r.why);

/* ── 8) 보조 함수 ── */
{
  const list = await verifyIndex(server[INDEX_URL], pub, { memory: null });
  const got = await indexFeeds(list, overrides.index, 123);
  ok(got.length === 2 && got.every((g) => g.at === 123 && g.source.index === overrides.index && g.source.feed.endsWith(`/${g.feed.id}/latest.json`)), "indexFeeds = 목록의 게임별 서명 봉투 확인 · 출처(목록 주소·키)");
  const tampered = JSON.parse(server[INDEX_URL]);
  tampered.feeds[SIDE].signed = tampered.feeds[SIDE].signed.replace("2.0.0", "9.9.9");
  const bad = await verifyIndex(JSON.stringify(tampered), pub, { memory: null });
  ok((await indexFeeds(bad, overrides.index)).map((g) => g.feed.id).join() === MAIN, "목록 안 봉투 변조(해시 다름) → 그 게임만 빠짐");
  const c = new Map();
  await loadIndex(overrides.index, { cache: c, fetchImpl, memory: null });
  await checkGames([game(THIRD, "1.0.0")], { overrides, cache: c, fetchImpl, memory: null });
  forgetFeeds([game(MAIN, "1.0.0"), game(THIRD, "1.0.0")], { overrides, cache: c });
  ok(c.size === 0, "forgetFeeds = 목록·게임별 버전 파일 캐시 항목 삭제", [...c.keys()].join(" | "));
  take();
}

console.log(failed ? `실패 ${failed}개` : "모두 통과");
process.exitCode = failed ? 1 : 0;
