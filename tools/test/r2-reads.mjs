// R2 요청 수 시험(node 만, 흉내 S3 서버 — 실제 R2 안 씀). node tools/test/r2-reads.mjs
// upload: 버킷 확인 = 목록 조회(ListObjectsV2, 쪽 넘김 포함)만 · 파일마다 HEAD 0번 · 같은 내용 건너뜀 · 목록 실패면 HEAD 로 대체 ·
// --dry-run 은 요청 0번 · --dry-run --remote 는 목록만(쓰기 0번) · 흉내 서버가 서명 4판(질의 글 포함)을 다시 계산해 맞는지 확인.
// r2-stats: 분석 API 질의 모양·Class 나누기·출처 추정·토큰 값 출력 안 함.
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { canonicalQuery, r2List, sha256Hex, signRequest } from "../lib/r2.mjs";
import { upload } from "../lib/update-cmds.mjs";
import { classOf, dayWindows, r2Stats, sourceOf, statsQuery } from "../lib/r2-stats.mjs";

let failed = 0;
const ok = (cond, text, detail = "") => {
  console.log(`${cond ? "통과" : "실패"} ${text}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const md5 = (bytes) => crypto.createHash("md5").update(bytes).digest("hex");
const quiet = async (work) => {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { value: await work(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.log = log;
  }
};

/* ── 시험 묶음(서명은 upload 가 보지 않으므로 형식만) ── */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "r2-reads-"));
const ids = ["io.example.one", "io.example.two"];
const feeds = {};
for (const [i, id] of ids.entries()) {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, "patches"), { recursive: true });
  const from = [];
  for (let k = 0; k < 3; k++) {
    const bytes = crypto.randomBytes(200 + k);
    const rel = `patches/${crypto.createHash("sha256").update(bytes).digest("hex")}.wgbd`;
    fs.writeFileSync(path.join(dir, rel), bytes);
    from.push({ sha1: "0".repeat(40), to: "1".repeat(40), version: `1.0.${k}`, patch: { url: rel, size: bytes.length, sha256: "0".repeat(64) } });
  }
  const signed = JSON.stringify({ id, version: `1.${i}.0`, from });
  const envelope = { wgbaFeed: 1, signed, signature: "AA==" };
  fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(envelope, null, 1)}\n`);
  feeds[id] = envelope;
}
const indexSigned = JSON.stringify({ time: "2026-11-07T00:00:00Z", feeds: Object.fromEntries(ids.map((id) => [id, "0".repeat(64)])) });
fs.writeFileSync(path.join(root, "index.json"), `${JSON.stringify({ wgbaIndex: 1, signed: indexSigned, signature: "AA==", feeds }, null, 1)}\n`);
const planKeys = [];
for (const id of ids) {
  const env = JSON.parse(feeds[id].signed);
  for (const item of env.from) planKeys.push(`${id}/${item.patch.url}`);
  planKeys.push(`${id}/latest.json`);
}
planKeys.push("index.json");
const fileOf = (key) => path.join(root, ...key.split("/"));

/* ── 흉내 S3 ── */
const SECRET = "secret-for-test";
const ACCESS = "test-access";
const BUCKET = "test-bucket";
const bucket = new Map();
const calls = [];
let pageSize = 4;
let failList = false;
let badSignatures = 0;
const xmlEscape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, "http://x");
  const params = Object.fromEntries(url.searchParams);
  const auth = req.headers.authorization ?? "";
  const names = (auth.match(/SignedHeaders=([^,]+)/)?.[1] ?? "").split(";");
  const headers = Object.fromEntries(names.filter((name) => !["host", "x-amz-content-sha256", "x-amz-date"].includes(name)).map((name) => [name, req.headers[name]]));
  const again = signRequest({ method: req.method, host: req.headers.host, path: decodeURIComponent(url.pathname), query: url.search ? canonicalQuery(params) : "", headers, payloadHash: req.headers["x-amz-content-sha256"], accessKey: ACCESS, secret: SECRET, amzDate: req.headers["x-amz-date"] });
  if (again.headers.authorization !== auth || sha256Hex(body) !== req.headers["x-amz-content-sha256"]) badSignatures++;
  const key = decodeURIComponent(url.pathname).replace(`/${BUCKET}`, "").replace(/^\//, "");
  calls.push({ method: req.method, key, list: params["list-type"] === "2", token: params["continuation-token"] ?? "" });
  if (req.method === "GET" && key === "" && params["list-type"] === "2") {
    if (failList) {
      res.writeHead(403, { "content-type": "application/xml" });
      return res.end("<Error><Code>AccessDenied</Code></Error>");
    }
    const all = [...bucket.keys()].sort();
    const start = params["continuation-token"] ? all.indexOf(Buffer.from(params["continuation-token"], "base64").toString()) : 0;
    const part = all.slice(start, start + pageSize);
    const next = all[start + pageSize];
    const contents = part.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><LastModified>2026-11-07T00:00:00.000Z</LastModified><ETag>&quot;${bucket.get(k).etag}&quot;</ETag><Size>${bucket.get(k).size}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("");
    res.writeHead(200, { "content-type": "application/xml" });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${BUCKET}</Name><KeyCount>${part.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${Buffer.from(next).toString("base64")}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`);
  }
  if (req.method === "HEAD") {
    const hit = bucket.get(key);
    if (!hit) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-length": hit.size, etag: `"${hit.etag}"` });
    return res.end();
  }
  if (req.method === "PUT") {
    bucket.set(key, { size: body.length, etag: md5(body) });
    res.writeHead(200, { etag: `"${md5(body)}"` });
    return res.end();
  }
  res.writeHead(400);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const config = { account: "test", accessKey: ACCESS, secret: SECRET, bucket: BUCKET, host: `127.0.0.1:${server.address().port}`, origin };
const pages = () => Math.max(1, Math.ceil(bucket.size / pageSize));
const count = (from = 0) => {
  const list = calls.slice(from);
  return { list: list.filter((c) => c.list).length, head: list.filter((c) => c.method === "HEAD").length, put: list.filter((c) => c.method === "PUT").length, total: list.length };
};

try {
  // 버킷: 같은 패치 2개 · 다른 내용 latest.json 1개 · 관계없는 객체 5개(목록 쪽 넘김이 생기게)
  bucket.set(planKeys[0], { size: fs.statSync(fileOf(planKeys[0])).size, etag: md5(fs.readFileSync(fileOf(planKeys[0]))) });
  bucket.set(planKeys[1], { size: fs.statSync(fileOf(planKeys[1])).size, etag: md5(fs.readFileSync(fileOf(planKeys[1]))) });
  bucket.set(`${ids[0]}/latest.json`, { size: 10, etag: "0".repeat(32) });
  for (let i = 0; i < 5; i++) bucket.set(`other/obj ${i}+=&.bin`, { size: i + 1, etag: md5(Buffer.from([i])) });

  let mark = calls.length;
  const dry = await quiet(() => upload(root, { dryRun: true }));
  ok(!dry.error && count(mark).total === 0 && dry.lines.filter((l) => l.startsWith("올릴 것")).length === planKeys.length, "--dry-run: 버킷 요청 0번", dry.error?.message ?? JSON.stringify(count(mark)));

  mark = calls.length;
  let want = pages();
  const compare = await quiet(() => upload(root, { dryRun: true, remote: true, config }));
  const c1 = count(mark);
  ok(!compare.error && c1.head === 0 && c1.put === 0 && c1.list === want && want > 1, `--dry-run --remote: 목록 ${want}쪽(쪽 넘김)만 · HEAD 0 · 쓰기 0`, compare.error?.message ?? JSON.stringify(c1));
  ok(compare.lines.filter((l) => l.startsWith("같음")).length === 2 && compare.lines.filter((l) => l.startsWith("올릴 것")).length === planKeys.length - 2, "--dry-run --remote: 같음 2 · 올릴 것 나머지", compare.lines.filter((l) => /^(같음|올릴 것)/.test(l)).length);

  mark = calls.length;
  want = pages();
  const first = await quiet(() => upload(root, { config }));
  const c2 = count(mark);
  ok(!first.error && c2.head === 0 && c2.list === want && c2.put === planKeys.length - 2, `upload: 버킷 확인 = 목록만(HEAD 0) · 올림 ${planKeys.length - 2}개`, first.error?.message ?? JSON.stringify(c2));
  const puts = calls.slice(mark).filter((c) => c.method === "PUT").map((c) => c.key);
  ok(puts.at(-1) === "index.json" && puts.indexOf(`${ids[0]}/latest.json`) > puts.indexOf(`${ids[0]}/${JSON.parse(feeds[ids[0]].signed).from[2].patch.url}`), "올리는 순서 그대로(패치 → latest.json → index.json 마지막)", puts.join(" "));
  ok(first.lines.some((l) => l.includes(`버킷 확인 목록 ${want}번`)), "완료 줄에 버킷 확인 요청 수", first.lines.at(-1));

  mark = calls.length;
  want = pages();
  const again = await quiet(() => upload(root, { config }));
  const c3 = count(mark);
  ok(!again.error && c3.put === 0 && c3.head === 0 && c3.total === c3.list && c3.list === want, `다시 upload(바뀐 것 없음): 목록 ${want}쪽만 · 쓰기 0`, JSON.stringify(c3));

  pageSize = 1000;
  mark = calls.length;
  await quiet(() => upload(root, { config }));
  ok(count(mark).total === 1, "객체 1,000개 이하 = 요청 1번", JSON.stringify(count(mark)));

  failList = true;
  fs.appendFileSync(path.join(root, "index.json"), " ");
  mark = calls.length;
  const fallback = await quiet(() => upload(root, { config }));
  const c4 = count(mark);
  ok(!fallback.error && c4.head === planKeys.length && c4.put === 1 && fallback.lines.some((l) => l.startsWith("경고")), "목록 실패(403) → 파일마다 HEAD 로 대체 · 바뀐 index.json 만 올림", fallback.error?.message ?? JSON.stringify(c4));
  failList = false;

  const listed = await r2List(config);
  ok(listed.objects.has("other/obj 3+=&.bin") && listed.objects.get("other/obj 3+=&.bin").etag === md5(Buffer.from([3])), "목록 XML: 특수 문자 키·ETag 따옴표 풀기", [...listed.objects.keys()].slice(-2).join(", "));
  ok(badSignatures === 0, "흉내 서버가 다시 계산한 서명 4판(질의 글·쪽 넘김 표시 포함) 모두 일치", `어긋남 ${badSignatures}`);
  ok(canonicalQuery({ prefix: "a b", "list-type": "2", "continuation-token": "x+y/z=" }) === "continuation-token=x%2By%2Fz%3D&list-type=2&prefix=a%20b", "질의 글 이름순·RFC 3986 인코딩");
  const listVector = signRequest({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/", query: canonicalQuery({ "max-keys": "2", prefix: "J" }), payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", accessKey: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", amzDate: "20130524T000000Z" });
  ok(listVector.signature === "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7", "AWS 서명 4판 시험 벡터(GET Bucket 목록, 질의 글)", listVector.signature);

  /* ── r2-stats ── */
  const now = Date.parse("2026-11-07T05:00:00Z");
  const windows = dayWindows({ days: 3, now });
  ok(windows.length === 3 && windows[0].label === "2026-11-05" && windows[2].label === "2026-11-07" && windows[0].from === "2026-11-04T15:00:00.000Z", "한국 날짜 하루씩 3일", windows.map((w) => `${w.label} ${w.from}`).join(" | "));
  const query = statsQuery(windows, true);
  ok((query.match(/r2OperationsAdaptiveGroups/g) ?? []).length === 3 && /objectName/.test(query) && /responseStatusCode/.test(query) && /bucketName: \$b/.test(query), "질의 = 날짜마다 r2OperationsAdaptiveGroups · 객체·응답 코드 차원 · 버킷 거르기");
  ok(classOf("GetObject") === "B" && classOf("HeadObject") === "B" && classOf("ListObjects") === "A" && classOf("PutObject") === "A" && classOf("DeleteObject") === "기타", "Class A·B 나누기(Cloudflare 요금 문서)");
  ok(sourceOf({ actionType: "GetObject", objectName: "local.mslug/latest.json", responseStatusCode: 200 }).includes("0.8.0") && sourceOf({ actionType: "GetObject", objectName: "index.json", responseStatusCode: 304 }).includes("0.8.1") && sourceOf({ actionType: "GetObject", objectName: "wp-login.php", responseStatusCode: 404 }).includes("외부") && sourceOf({ actionType: "HeadObject", objectName: "index.json", responseStatusCode: 200 }).startsWith("HEAD"), "출처 추정(목록·게임별·없는 객체·HEAD)");
  const TOKEN = "token-value-must-not-print";
  let sent = null;
  const fakeGraphql = async (url, init) => {
    sent = { url, init };
    const group = (actionType, objectName, responseStatusCode, requests) => ({ sum: { requests }, dimensions: { actionType, objectName, responseStatusCode } });
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{ d0: [group("GetObject", "local.mslug/latest.json", 200, 40), group("HeadObject", "index.json", 200, 7)], d1: [group("GetObject", "index.json", 304, 12), group("PutObject", "index.json", 200, 2)], d2: [group("GetObject", ".env", 404, 3)] }] } }, errors: null }), { status: 200 });
  };
  const out = [];
  await r2Stats({ days: 3, now, env: { CF_API_TOKEN: TOKEN, R2_ACCOUNT_ID: "acct-value", R2_BUCKET: "bucket-value" }, fetchImpl: fakeGraphql, print: (line) => out.push(line) });
  const text = out.join("\n");
  ok(sent.url === "https://api.cloudflare.com/client/v4/graphql" && sent.init.headers.Authorization === `Bearer ${TOKEN}` && JSON.parse(sent.init.body).variables.b === "bucket-value", "분석 API 주소·Bearer 토큰·버킷 변수");
  ok(!text.includes(TOKEN) && !text.includes("acct-value") && !text.includes("bucket-value"), "출력에 토큰·계정·버킷 값 없음");
  ok(/2026-11-05\s+0\s+47\s+0\s+40\s+0\s+7/.test(text) && /2026-11-06\s+2\s+12\s+12/.test(text) && /합계\s+2\s+62/.test(text), "날짜별 Class A·B·출처 칸", out.slice(1, 6).join(" / "));
  ok(out.some((l) => l.includes("local.mslug/latest.json") && l.includes("64.5%")) && out.some((l) => l.includes(".env") && l.includes("외부")), "객체별 상위 줄(비율·출처)");
  let sentAll = null;
  const fakeAll = async (url, init) => {
    sentAll = JSON.parse(init.body);
    const group = (bucketName, actionType, objectName, responseStatusCode, requests, datetimeHour) => ({ sum: { requests }, dimensions: { bucketName, actionType, objectName, responseStatusCode, datetimeHour } });
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{ d0: [group("priv-value", "GetObject", "wgba/local.kof98/1.0.0.wgba", 206, 21, "2026-11-05T03:00:00Z"), group("priv-value", "GetObject", "authentication.key", 200, 3, "2026-11-05T03:00:00Z"), group("priv-value", "ListObjectsV2", "", 200, 1, "2026-11-05T03:00:00Z"), group("bucket-value", "GetObject", "index.json", 200, 5, "2026-11-05T04:00:00Z"), group("bucket-value", "GetObject", "roms.json", 200, 1, "2026-11-05T04:00:00Z")], d1: [], d2: [] }] } }, errors: null }), { status: 200 });
  };
  const allOut = [];
  await r2Stats({ days: 3, now, bucket: "all", hourly: true, env: { CF_API_TOKEN: TOKEN, R2_ACCOUNT_ID: "acct-value", R2_BUCKET: "bucket-value", R2_PRIVATE_BUCKET: "priv-value" }, fetchImpl: fakeAll, print: (line) => allOut.push(line) });
  const allText = allOut.join("\n");
  ok(!/bucketName: \$b/.test(sentAll.query) && /bucketName datetimeHour/.test(sentAll.query) && sentAll.variables.b === undefined, "--bucket all --hourly = 버킷 거르기 없음 · 버킷·시각 차원");
  ok(/비공개: Class A 1 · Class B 24/.test(allText) && /공개: Class A 0 · Class B 6/.test(allText) && !allText.includes("priv-value") && !allText.includes("bucket-value"), "버킷별 합계(공개·비공개 이름만, 버킷 값 출력 없음)", allOut.filter((l) => l.includes("Class A")).join(" / "));
  ok(allOut.some((l) => l.includes("wgba/local.kof98/1.0.0.wgba") && l.includes("비공개") && l.includes("범위 GET")) && allOut.some((l) => l.includes("roms.json") && l.includes("롬 가져오기")) && allOut.some((l) => l.includes("authentication.key") && l.includes("키 파일")), "비공개 객체 출처(.wgba 범위 GET·키 파일·roms.json)");
  ok(allOut.some((l) => /^11-05 12시\s+24/.test(l)) && allOut.some((l) => /^11-05 13시\s+6/.test(l)), "시각별 상위(한국 시각)", allOut.slice(-2).join(" / "));
  const privQuery = [];
  await r2Stats({ days: 1, now, bucket: "private", env: { CF_API_TOKEN: TOKEN, R2_ACCOUNT_ID: "acct-value", R2_BUCKET: "bucket-value", R2_PRIVATE_BUCKET: "priv-value" }, fetchImpl: async (url, init) => (privQuery.push(JSON.parse(init.body)), new Response(JSON.stringify({ data: { viewer: { accounts: [{ d0: [] }] } } }), { status: 200 })), print: () => {} });
  ok(privQuery[0].variables.b === "priv-value" && /bucketName: \$b/.test(privQuery[0].query), "--bucket private = R2_PRIVATE_BUCKET 로 거르기");
  const missing = await r2Stats({ env: {}, print: () => {} }).then(() => null, (error) => error);
  ok(missing && /CF_API_TOKEN/.test(missing.message), "환경 변수 없음 → 만들 토큰 안내", missing?.message);
} finally {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failed ? `실패 ${failed}개` : "모두 통과");
process.exitCode = failed ? 1 : 0;
