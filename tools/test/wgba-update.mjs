// 온라인 업데이트(규격 12장) 시험 — node 만, 롬·앱·네트워크 없이. node tools/test/wgba-update.mjs
// 손으로 짠 작은 wasm + 임의 바이트("rom" 조각 — 롬 아님)로 1.0.0 · 1.1.0(code 바뀜) · 1.2.0(롬 바뀜)을 묶어
// 차이 패치(파일 그대로 · 롬 다시 묶기)·적용·SHA-1, 버전 파일 서명(변조·다른 키 거부)·경로(연쇄·모르는 SHA-1 → 전체 설치)·
// 받기(크기·SHA-256)·같은 버전 파일 한 번만 받기·오프라인 조용히 넘어가기·설명서 update 검사·R2 서명(AWS 문서 시험 벡터).
import crypto from "crypto";
import { checkManifest, packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { applyDelta, checkGames, fetchChecked, planUpdate, readDeltaHead, readOverrides, runSteps, updateSource, UpdateError, verifyFeed } from "../../src-bundle/src/js/core/wgba-update.js";
import { makeDelta } from "../lib/wgbd-make.mjs";
import { publicOf, signText } from "../lib/update-cmds.mjs";
import { signingKey, signRequest } from "../lib/r2.mjs";

let failed = 0;
const ok = (cond, text, detail = "") => {
  console.log(`${cond ? "통과" : "실패"} ${text}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const rejects = async (work, code) => {
  try {
    await work();
    return "던지지 않음";
  } catch (error) {
    return error instanceof UpdateError && error.code === code ? true : `${error?.code ?? error}`;
  }
};

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
const str = (t) => [...u(t.length), ...Buffer.from(t)];
const sec = (id, body) => [id, ...u(body.length), ...body];
const vec = (items) => [...u(items.length), ...items.flat()];

function gameWasm(payload) {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [1], [0]]));
  const mem = sec(5, vec([[0x00, 3]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
  const blob = sec(0, [...str("x.blob"), ...payload]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code, ...blob]);
}

const rnd = (n) => new Uint8Array(crypto.randomBytes(n));
const payload1 = rnd(200 * 1024);
const payload2 = payload1.slice();
payload2.set(rnd(700), 51234);
payload2.set(rnd(300), 150000);
const rom1 = rnd(512 * 1024);
rom1[0xb2] = 0x96;
const rom2 = rom1.slice();
rom2.set(rnd(900), 300000);
const manifest = (version) => ({ wgba: 1, id: "io.example.update-test", version, name: "Update Test", runtime: "webapi", input: { preset: "gba" } });
const v1 = (await packWgba({ wasm: gameWasm(payload1), manifest: manifest("1.0.0"), rom: rom1 })).bytes;
const v2 = (await packWgba({ wasm: gameWasm(payload2), manifest: manifest("1.1.0"), rom: rom1 })).bytes;
const v3 = (await packWgba({ wasm: gameWasm(payload2), manifest: manifest("1.2.0"), rom: rom2 })).bytes;

/* ── 차이 패치 ── */
const d12 = await makeDelta(v1, v2);
ok(d12.info.mode === "file" && !d12.info.expanded && d12.info.sameRom, "1.0.0 → 1.1.0: 롬 같음 → 파일 그대로 BPS", JSON.stringify({ mode: d12.info.mode, size: d12.bytes.length }));
ok(d12.bytes.length < 4000, "code 일부만 바뀐 패치가 작음", `${d12.bytes.length}바이트 / 파일 ${v2.length}`);
ok(same(await applyDelta(v1, d12.bytes), v2), "적용 결과 = 1.1.0 바이트까지 같음");
const d23 = await makeDelta(v2, v3);
ok(d23.info.mode === "rebuilt" && d23.info.expanded, "1.1.0 → 1.2.0: 롬 바뀜 → 확장 바탕 + 롬 다시 묶기", JSON.stringify({ mode: d23.info.mode, size: d23.bytes.length }));
ok(d23.bytes.length < 8000, "롬 일부만 바뀐 패치가 작음(압축된 롬 차이가 아니라 푼 롬 차이)", `${d23.bytes.length}바이트`);
ok(same(await applyDelta(v2, d23.bytes), v3), "적용 결과 = 1.2.0 바이트까지 같음");
const head = readDeltaHead(d12.bytes);
ok(head.sourceSha1 === sha1(v1) && head.targetSha1 === sha1(v2) && head.meta.from === "1.0.0" && head.meta.to === "1.1.0", "패치 머리: 옛·새 SHA-1·버전");
ok((await rejects(() => applyDelta(v2, d12.bytes), "deltaSource")) === true, "다른 파일에 적용 → deltaSource");
const broken = d12.bytes.slice();
broken[broken.length - 20] ^= 0xff;
const brokenCode = await rejects(() => applyDelta(v1, broken), "deltaBad");
ok(brokenCode === true || brokenCode === "deltaResult", "몸통 깨짐 → deltaBad(또는 결과 SHA-1)", String(brokenCode));

/* ── 버전 파일 서명 ── */
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicOf(privateKey);
const other = publicOf(crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey);
const base = "https://feed.example/io.example.update-test/latest.json";
const files = new Map();
const put = (rel, bytes) => {
  files.set(new URL(rel, base).href, bytes);
  return { url: rel, size: bytes.length, sha256: sha256(bytes) };
};
const signed = {
  id: "io.example.update-test",
  version: "1.2.0",
  wgba: { sha1: sha1(v3), size: v3.length },
  from: [
    { sha1: sha1(v1), version: "1.0.0", to: sha1(v2), patch: put(`patches/${sha256(d12.bytes)}.wgbd`, d12.bytes) },
    { sha1: sha1(v2), version: "1.1.0", to: sha1(v3), patch: put(`patches/${sha256(d23.bytes)}.wgbd`, d23.bytes) },
  ],
  full: put("full/aaaa.wgbp", rnd(1000)),
};
const envelope = (obj, key = privateKey) => {
  const text = JSON.stringify(obj);
  return JSON.stringify({ wgbaFeed: 1, signed: text, signature: signText(text, key) });
};
const feedText = envelope(signed);
const feed = await verifyFeed(feedText, pub, base);
ok(feed.version === "1.2.0" && feed.from.length === 2 && feed.from[0].patch.url.startsWith("https://feed.example/io.example.update-test/patches/"), "서명 확인 · 상대 주소 → 버전 파일 기준 절대 주소");
const tampered = JSON.parse(feedText);
tampered.signed = tampered.signed.replace('"1.2.0"', '"1.2.1"');
ok((await rejects(() => verifyFeed(JSON.stringify(tampered), pub, base), "feedSignature")) === true, "서명한 글을 바꾸면 거부(feedSignature)");
ok((await rejects(() => verifyFeed(feedText, other, base), "feedSignature")) === true, "다른 공개 키 → 거부");
ok((await rejects(() => verifyFeed(JSON.stringify({ ...JSON.parse(feedText), wgbaFeed: 2 }), pub, base), "feedFormat")) === true, "모르는 버전 파일 형식 → feedFormat");
ok((await rejects(() => verifyFeed(envelope({ ...signed, wgba: { sha1: "xyz", size: 1 } }), pub, base), "feedBad")) === true, "서명은 맞지만 내용 규칙 밖 → feedBad");

/* ── 경로 ── */
const p1 = planUpdate(feed, sha1(v1));
ok(p1.kind === "patch" && p1.steps.length === 2 && p1.size === d12.bytes.length + d23.bytes.length, "1.0.0 → 두 단계 연쇄", `${p1.steps.length}단계 ${p1.size}바이트`);
ok(planUpdate(feed, sha1(v2)).steps.length === 1, "1.1.0 → 한 단계");
ok(planUpdate(feed, sha1(v3)).kind === "latest", "이미 최신 → latest");
ok(planUpdate(feed, "0".repeat(40)).kind === "full", "모르는 SHA-1 → 원본 롬으로 전체 설치(full)");
ok(planUpdate({ ...feed, full: null }, "0".repeat(40)).kind === "none", "전체 설치 없음 → none");

/* ── 받기·적용 ── */
let calls = [];
const fakeFetch = async (url, options = {}) => {
  calls.push({ url, cache: options.cache ?? "" });
  if (url === base) return new Response(feedText, { status: 200 });
  const bytes = files.get(url);
  return bytes ? new Response(bytes, { status: 200 }) : new Response("no", { status: 404 });
};
const done = await runSteps(v1, p1, feed, { fetchImpl: fakeFetch });
ok(same(done, v3), "1.0.0 → 받기 두 번 · 적용 두 번 → 1.2.0 바이트까지 같음");
ok(calls.every((c) => c.url.startsWith("https://feed.example/")), "요청은 버전 파일 서버로만", calls.map((c) => c.url.split("/").pop().slice(0, 8)).join(","));
const lying = { ...feed, wgba: { sha1: "1".repeat(40), size: v3.length } };
ok((await rejects(() => runSteps(v1, planUpdate({ ...lying, from: feed.from.map((f) => (f.to === feed.wgba.sha1 ? { ...f, to: lying.wgba.sha1 } : f)) }, sha1(v1)), lying, { fetchImpl: fakeFetch }), "deltaResult")) === true, "결과 SHA-1 이 버전 파일과 다르면 거부(deltaResult)");
const badRef = { ...feed.from[0].patch, sha256: "0".repeat(64) };
ok((await rejects(() => fetchChecked(badRef, { fetchImpl: fakeFetch }), "downloadHash")) === true, "받은 패치 SHA-256 다름 → downloadHash");
ok((await rejects(() => fetchChecked({ ...feed.from[0].patch, size: feed.from[0].patch.size - 1 }, { fetchImpl: fakeFetch }), "downloadSize")) === true, "받은 크기 다름 → downloadSize");
ok(same(v1, (await packWgba({ wasm: gameWasm(payload1), manifest: manifest("1.0.0"), rom: rom1 })).bytes), "옛 파일은 바뀌지 않음(적용은 새 바이트를 만듦)");

/* ── 앱 실행 때 확인 ── */
calls = [];
const games = [
  { key: "a", gameId: "io.example.update-test", version: "1.0.0", update: { feed: base, key: pub } },
  { key: "b", gameId: "io.example.update-test", version: "1.1.0", update: { feed: base, key: pub } },
  { key: "c", gameId: "io.example.update-test", version: "1.2.0", update: { feed: base, key: pub } },
  { key: "d", gameId: "io.example.other", version: "1.0.0" },
];
const found = await checkGames(games, { fetchImpl: fakeFetch });
ok(found.map((f) => f.game.key).join() === "a,b", "높은 버전이 있는 것만(같은 버전·설명서 항목 없는 게임 제외)", found.map((f) => f.game.key).join());
ok(calls.length === 1 && calls[0].cache === "no-cache", "같은 버전 파일은 한 번만 받음 · cache no-cache", JSON.stringify(calls));
const logs = [];
const offline = await checkGames(games, { fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")), log: (level, text) => logs.push(level) });
ok(offline.length === 0 && logs.length === 1 && logs[0] === "WARN", "오프라인 → 던지지 않고 빈 결과(기록만)");
const wrongKey = await checkGames([{ ...games[0], update: { feed: base, key: other } }], { fetchImpl: fakeFetch });
ok(wrongKey.length === 0, "서명 다른 버전 파일 → 업데이트 없음으로 넘어감");

/* ── 확인할 곳 ── */
ok(updateSource({ gameId: "com.flightrabbit.rapid" }) === null, "알려진 id 표 = 주소·키를 아직 넣지 않으면 확인하지 않음");
const store = { getItem: () => JSON.stringify({ feeds: { "com.flightrabbit.rapid": { feed: "http://127.0.0.1:9/x/latest.json", key: pub }, "io.bad": { feed: "http://evil.example/x", key: pub } } }) };
const overrides = readOverrides(store);
ok(overrides["com.flightrabbit.rapid"] && !overrides["io.bad"], "시험 덮어쓰기: 루프백 http 만 받음");
ok(updateSource({ gameId: "com.flightrabbit.rapid" }, overrides).from === "test", "시험 덮어쓰기가 먼저");

/* ── 설명서 update 검사 ── */
const errs = (m) => {
  const errors = [];
  checkManifest(m, errors, []);
  return errors;
};
ok(errs({ ...manifest("1.0.0"), update: { feed: base, key: pub } }).length === 0, "설명서 update 올바름 → 오류 없음");
ok(errs({ ...manifest("1.0.0"), update: { feed: "http://feed.example/x.json", key: pub } }).length === 1, "update.feed http → 오류");
ok(errs({ ...manifest("1.0.0"), update: { feed: base, key: "abc" } }).length === 1, "update.key 규칙 밖 → 오류");

/* ── R2 서명(AWS S3 문서 "GET Object" 시험 벡터) ── */
const vector = signRequest({
  method: "GET",
  host: "examplebucket.s3.amazonaws.com",
  path: "/test.txt",
  headers: { range: "bytes=0-9" },
  payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  amzDate: "20130524T000000Z",
});
ok(vector.signature === "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41", "AWS 서명 4판 시험 벡터", vector.signature);
ok(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam").toString("hex") === "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9", "서명 열쇠 시험 벡터(AWS 문서)");

console.log(failed ? `실패 ${failed}개` : "모두 통과");
process.exitCode = failed ? 1 : 0;
