// 관리자 모드 서버 함수(api/_admin) 단위 시험 — 흉내 비공개 R2(fake-r2-private.mjs)·메모리 가짜 Upstash. 외부 접속 없음.
//   node tools/test/admin-api.mjs [--out <결과 json>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ADMIN, createAdmin, parseUpdated, safeFileName, saveFileName } from "../../api/_admin/server.js";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startFakeUpstash } from "./fake-upstash.mjs";
import { keyFile, startFakeR2 } from "./fake-r2-private.mjs";
import { adminKey, privatePrune, privateUpload } from "../lib/admin-cmds.mjs";

const require = createRequire(import.meta.url);
const { encode: encodePng } = require("./png.cjs");
const args = process.argv.slice(2);
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : "";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
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
function tinyWasm(pad = 0) {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [0], [0]]));
  const mem = sec(5, vec([[0x00, 1]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
  const blob = sec(0, [...str("x.blob"), ...new Array(pad).fill(7)]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code, ...blob]);
}
const label = encodePng(Buffer.alloc(96 * 64 * 4, 0xc8), 96, 64);
const game = async (id, version, name, { pad = 0, art = false } = {}) => (await packWgba({ wasm: tinyWasm(pad), manifest: { wgba: 1, id, version, name, runtime: "webapi", input: { preset: "gba" } }, images: art ? { label } : {} })).bytes;

const r2 = await startFakeR2();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-api-"));
const writeTemp = async (name, bytes) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const kv = await startFakeUpstash();
let clock = Date.UTC(2026, 10, 10, 6, 0, 0);
const env = { ...r2.env, UPSTASH_REDIS_REST_URL: kv.url, UPSTASH_REDIS_REST_TOKEN: kv.token };
let api = createAdmin({ env, endpoint: r2.endpoint, now: () => clock });
const BASE = "https://webgba.vercel.app/api/v1/admin/";
const PIN = "4!8#0" + "2";

async function call(method, op, { body, token, ip = "203.0.113.7", origin = "https://webgba.vercel.app", server = api } = {}) {
  const headers = { "x-forwarded-for": ip };
  if (origin) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await server.handle(new Request(new URL(op, BASE), init));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const keyGets = () => r2.log.filter((l) => l.path.endsWith("/authentication.key")).length;

try {
  const off = await call("POST", "verify", { body: { pin: PIN }, server: createAdmin({ env: {} }) });
  ok("환경 변수 없음 → 503 off", off.status === 503 && off.body.error === "off");
  const noOrigin = await call("POST", "verify", { body: { pin: PIN }, origin: "" });
  ok("Origin 없는 입력 확인 → 403", noOrigin.status === 403);
  const evil = await call("POST", "verify", { body: { pin: PIN }, origin: "https://evil.example" });
  ok("다른 출처 → 403", evil.status === 403);
  const pre = await call("OPTIONS", "list");
  ok("사전 요청 = Authorization 허용", pre.status === 204 && /Authorization/.test(pre.headers.get("access-control-allow-headers") ?? ""));
  const nokey = await call("POST", "verify", { body: { pin: PIN } });
  ok("키 파일 없음 → 503 nokey", nokey.status === 503 && nokey.body.error === "nokey");
  const noStore = await call("POST", "verify", { body: { pin: PIN }, server: createAdmin({ env: r2.env, endpoint: r2.endpoint, now: () => clock }) });
  ok("저장소 없음 → 503 store(확인하지 않음)", noStore.status === 503 && noStore.body.error === "store");
  const badPin = await call("POST", "verify", { body: { pin: "12345" } });
  ok("형식이 다른 값 → 400", badPin.status === 400);

  r2.put("authentication.key", "{ not json");
  clock += ADMIN.KEY_MISS_MS + 1;
  const bad = await call("POST", "verify", { body: { pin: PIN } });
  ok("키 파일 형식 틀림 → 503 key(format)", bad.status === 503 && bad.body.error === "key" && bad.body.why === "format");
  r2.put("authentication.key", "");
  clock += ADMIN.KEY_MISS_MS + 1;
  const empty = await call("POST", "verify", { body: { pin: PIN } });
  ok("빈 키 파일 → 503 key(empty)", empty.status === 503 && empty.body.why === "empty", JSON.stringify(empty.body));
  const badSecret = createAdmin({ env: { ...env, R2_PRIVATE_SECRET_ACCESS_KEY: "wrong-secret" }, endpoint: r2.endpoint, now: () => clock });
  let denied = null;
  for (let i = 0; i < ADMIN.TRY_MAX + 2; i++) denied = await call("POST", "verify", { body: { pin: PIN }, ip: "198.51.100.77", server: badSecret });
  ok("서버 R2 키가 틀림 → 503 r2 + 상태 코드·R2 오류 이름", denied.status === 503 && denied.body.error === "r2" && denied.body.why === "403 SignatureDoesNotMatch", JSON.stringify(denied.body));
  r2.put("authentication.key", keyFile(PIN, "2026-11-10 14:30"));
  clock += ADMIN.KEY_MISS_MS + 1;
  const notCounted = await call("POST", "verify", { body: { pin: PIN }, ip: "198.51.100.77" });
  ok("키를 못 읽은 시도는 입력 횟수에 넣지 않음(7번 뒤에도 통과)", notCounted.status === 200, String(notCounted.status));

  r2.put("authentication.key", "﻿" + keyFile(PIN, "2026-11-10 14:30"));
  clock += ADMIN.KEY_MS + 1;
  ok("갱신일자 = 한국 시각(시각대 생략)", parseUpdated("2026-11-10 14:30") === Date.UTC(2026, 10, 10, 5, 30) && parseUpdated("2026-11-10T05:30Z") === Date.UTC(2026, 10, 10, 5, 30) && parseUpdated("2026-13-01 00:00") === null);
  r2.clear();
  const good = await call("POST", "verify", { body: { pin: PIN }, ip: "198.51.100.1" });
  ok("맞는 6자리 → 토큰·갱신일자", good.status === 200 && /^a1\./.test(good.body.token) && good.body.updated === "2026-11-10 14:30" && good.body.at === clock, JSON.stringify(good.body).slice(0, 60));
  const wrong = await call("POST", "verify", { body: { pin: "000000" }, ip: "198.51.100.1" });
  ok("틀린 6자리 → 401 wrong · 남은 횟수", wrong.status === 401 && wrong.body.error === "wrong" && wrong.body.left === 3, JSON.stringify(wrong.body));
  ok("키 파일 = 인스턴스 메모리 캐시(60초 안 다시 조회 안 함)", keyGets() === 1, `${keyGets()}번`);

  for (let i = 0; i < 3; i++) await call("POST", "verify", { body: { pin: "111111" }, ip: "198.51.100.1" });
  const limited = await call("POST", "verify", { body: { pin: PIN }, ip: "198.51.100.1" });
  ok("IP당 시간당 5번 → 6번째 429(맞는 값이어도)", limited.status === 429 && limited.body.error === "limit");
  const other = await call("POST", "verify", { body: { pin: PIN }, ip: "198.51.100.2" });
  ok("다른 IP는 그대로", other.status === 200);
  const v6a = await call("POST", "verify", { body: { pin: "222222" }, ip: "2001:db8:1:2::1" });
  for (let i = 0; i < 4; i++) await call("POST", "verify", { body: { pin: "222222" }, ip: `2001:db8:1:2::${i + 5}` });
  const v6 = await call("POST", "verify", { body: { pin: PIN }, ip: "2001:db8:1:2:ffff::9" });
  ok("IPv6 = /64 단위로 묶음", v6a.status === 401 && v6.status === 429);
  clock += 3600000;
  const later = await call("POST", "verify", { body: { pin: PIN }, ip: "198.51.100.1" });
  ok("한 시간 뒤 다시 가능", later.status === 200);

  let n = 0;
  for (let i = 0; n < ADMIN.FAIL_MAX; i++) {
    const r = await call("POST", "verify", { body: { pin: "333333" }, ip: `192.0.2.${10 + i}` });
    if (r.status === 401) n++;
    if (r.status === 429) break;
  }
  const locked = await call("POST", "verify", { body: { pin: PIN }, ip: "192.0.2.250" });
  ok(`전체 실패 하루 ${ADMIN.FAIL_MAX}번 → 그날 잠금(맞는 값도 429)`, locked.status === 429 && locked.body.error === "locked");
  clock += 86400000;
  const nextDay = await call("POST", "verify", { body: { pin: PIN }, ip: "192.0.2.251" });
  ok("다음 날 풀림", nextDay.status === 200);
  const token = nextDay.body.token;

  const v100 = await game("io.example.alpha", "1.0.0", { en: "Alpha", ko: "알파" }, { art: true });
  const v120 = await game("io.example.alpha", "1.2.0", { en: "Alpha", ko: "알파" }, { art: true, pad: 200000 });
  const beta = await game("io.example.beta", "2.0.0", "Beta Quest: <Two>");
  const loose = await game("io.example.gamma", "0.3.1", { ja: "ガンマ" });
  const rapid = await game("com.flightrabbit.rapid", "1.3.5", { en: "Pokémon Rapid", ko: "포켓몬스터 래피드" });
  const kof = await game("local.kof98", "1.0.0", { en: "The King of Fighters '98" });
  r2.put("wgba/io.example.alpha/1.0.0.wgba", v100);
  r2.put("wgba/io.example.alpha/1.2.0.wgba", v120);
  r2.put("wgba/io.example.alpha/1.2.0-beta.1.wgba", v100);
  r2.put("wgba/io.example.beta/2.0.0.wgba", beta);
  r2.put("wgba/My Gamma.wgba", loose);
  r2.put("wgba/firered.wgba", rapid);
  r2.put("wgba/local.kof98/1.0.0.wgba", kof);
  r2.put("wgba/broken.wgba", Buffer.from("not a wgba file"));
  r2.put("wgba/readme.txt", Buffer.from("x"));
  r2.put("other/io.example.zeta.wgba", beta);
  r2.clear();
  const listed = await call("GET", "list", { token });
  const items = listed.body?.items ?? [];
  const alpha = items.find((i) => i.id === "io.example.alpha");
  ok("목록 = 게임별 최신 버전만(1.0.0·1.2.0-beta.1 제외)", listed.status === 200 && alpha?.version === "1.2.0" && alpha.key === "wgba/io.example.alpha/1.2.0.wgba", items.map((i) => `${i.id}@${i.version}`).join(" "));
  ok("목록 = 직접 올린 파일도 manifest로 id·버전·저장 이름(버킷 객체 이름 무관)", items.some((i) => i.id === "io.example.gamma" && i.version === "0.3.1" && i.file === "gamma.wgba"));
  ok("저장 이름 = 래피드는 firered.wgba로 올려도 pokemon-rapid-v.<버전>.wgba", items.find((i) => i.id === "com.flightrabbit.rapid")?.file === "pokemon-rapid-v.1.3.5.wgba", items.find((i) => i.id === "com.flightrabbit.rapid")?.file);
  ok("저장 이름 = 표에 있는 게임은 사용자 폴더 이름", items.find((i) => i.id === "local.kof98")?.file === "king-of-fighters-98.wgba", items.find((i) => i.id === "local.kof98")?.file);
  ok("목록 = 깨진 파일·다른 확장자·wgba/ 밖 제외", items.length === 5, String(items.length));
  ok("목록 = 이름(언어별)·라벨 그림·크기·저장 이름", alpha.names.ko === "알파" && /^data:image\/png;base64,/.test(alpha.label) && alpha.size === v120.length && alpha.file === "alpha.wgba" && items.find((i) => i.id === "io.example.beta").file === "beta-quest-two.wgba");
  const lists = r2.log.filter((l) => l.kind === "list").length;
  const ranges = r2.log.filter((l) => l.range).length;
  ok("R2 요청 = 목록 1번 + 후보마다 앞부분 Range 1번", lists === 1 && ranges === 6 && r2.log.every((l) => !l.range || l.range === `bytes=0-${ADMIN.HEAD_BYTES - 1}`), `목록 ${lists} · Range ${ranges}`);
  r2.clear();
  await call("GET", "list", { token });
  ok("두 번째 목록 = 앞부분 캐시(ETag 같음 → Range 0번)", r2.log.filter((l) => l.range).length === 0 && r2.log.filter((l) => l.kind === "list").length === 1);

  const urls = await call("POST", "url", { token, body: { keys: [alpha.key, "wgba/My Gamma.wgba"] } });
  ok("presigned 주소 발급(5분)", urls.status === 200 && urls.body.urls.length === 2 && urls.body.ttl === 300 && urls.body.urls[0].url.startsWith(r2.endpoint));
  const got = await fetch(urls.body.urls[0].url);
  const bytes = new Uint8Array(await got.arrayBuffer());
  ok("presigned 주소로 받기 = 같은 바이트(흉내 R2 서명 확인)", got.status === 200 && Buffer.compare(Buffer.from(bytes), Buffer.from(v120)) === 0);
  const space = await fetch(urls.body.urls[1].url);
  ok("공백 든 키도 서명 맞음", space.status === 200);
  const tampered = await fetch(urls.body.urls[0].url.replace("1.2.0.wgba", "1.0.0.wgba"));
  ok("주소를 바꾸면 403", tampered.status === 403);
  const forbidden = await call("POST", "url", { token, body: { keys: ["authentication.key"] } });
  const climb = await call("POST", "url", { token, body: { keys: ["wgba/../authentication.key.wgba"] } });
  ok("wgba/…/*.wgba 밖 키 → 400", forbidden.status === 400 && climb.status === 400);
  const many = await call("POST", "url", { token, body: { keys: Array.from({ length: ADMIN.KEYS_MAX + 1 }, (_, i) => `wgba/a${i}.wgba`) } });
  ok(`한 번에 ${ADMIN.KEYS_MAX}개까지`, many.status === 400);

  const sameSite = await call("GET", "list", { token, origin: "" });
  ok("Origin 없는 목록(같은 출처 GET) = 토큰으로 허용", sameSite.status === 200);
  const none = await call("GET", "list");
  const junk = await call("GET", "list", { token: token.slice(0, -2) + "AA" });
  ok("토큰 없음·변조 → 401 again", none.status === 401 && none.body.error === "again" && junk.status === 401);

  r2.put("authentication.key", keyFile(PIN, new Date(clock + 9 * 3600000 + 60000).toISOString().slice(0, 16).replace("T", " ")));
  clock += ADMIN.KEY_MS + 120000;
  r2.clear();
  const stale = await call("GET", "list", { token });
  ok("키 갱신일자가 토큰 발급 뒤 → 401 again(목록 조회 전)", stale.status === 401 && stale.body.error === "again" && r2.log.filter((l) => l.kind === "list").length === 0);
  const again = await call("POST", "verify", { body: { pin: PIN }, ip: "192.0.2.252" });
  const fresh = await call("GET", "list", { token: again.body.token });
  ok("다시 입력하면 새 토큰으로 목록", again.status === 200 && fresh.status === 200);

  r2.put("authentication.key", keyFile("9#9#9#", "2026-11-01 00:00"));
  clock += ADMIN.KEY_MS + 1;
  const rotated = await call("GET", "list", { token: again.body.token });
  ok("키 값을 바꾸면 옛 토큰 무효(갱신일자가 과거여도)", rotated.status === 401);
  const newPin = await call("POST", "verify", { body: { pin: "9#9#9#" }, ip: "192.0.2.253" });
  clock += ADMIN.TOKEN_MS + 1;
  const expired = await call("GET", "list", { token: newPin.body.token });
  ok("토큰 30일 지나면 401 again", newPin.status === 200 && expired.status === 401);

  r2.put("authentication.key", keyFile(PIN, new Date(clock + 9 * 3600000 + 86400000).toISOString().slice(0, 16).replace("T", " ")));
  clock += ADMIN.KEY_MS + 1;
  const future = await call("POST", "verify", { body: { pin: PIN }, ip: "192.0.2.254" });
  ok("갱신일자가 미래 → 503 key(future)", future.status === 503 && future.body.why === "future");

  const tool = r2.toolConfig();
  const quiet = console.log;
  console.log = () => {};
  try {
    let asked = 0;
    await adminKey({ config: tool, ask: async () => (asked++, "1#2!3#"), now: () => clock - 60000 });
    r2.clear();
    await privateUpload([await writeTemp("a.wgba", await game("io.example.delta", "1.0.0", "Delta")), await writeTemp("b.wgba", await game("io.example.delta", "1.1.0", "Delta")), await writeTemp("firered.wgba", rapid)], { config: tool });
    var firstPuts = r2.log.filter((l) => l.kind === "put" && l.status === 200).map((l) => l.path);
    r2.clear();
    var afterFirst = ["wgba/io.example.delta/1.0.0.wgba", "wgba/io.example.delta/1.1.0.wgba", "wgba/com.flightrabbit.rapid/1.3.5.wgba"].map((k) => r2.has(k));
    var keyBefore = r2.read("authentication.key")?.length ?? 0;
    r2.clear();
    await privateUpload([await writeTemp("a.wgba", await game("io.example.delta", "1.1.0", "Delta"))], { config: tool });
    var againPuts = r2.log.filter((l) => l.kind === "put").length;
    r2.put("wgba/io.example.delta/0.9.0.wgba", "old");
    r2.put("wgba/io.example.other/1.0.0.wgba", "other");
    r2.put("wgba/io.example.delta/notes.txt", "x");
    r2.clear();
    await privateUpload([await writeTemp("c.wgba", await game("io.example.delta", "1.2.0", "Delta"))], { config: tool });
    var afterSecond = ["wgba/io.example.delta/0.9.0.wgba", "wgba/io.example.delta/1.1.0.wgba", "wgba/io.example.delta/1.2.0.wgba", "wgba/io.example.other/1.0.0.wgba", "wgba/io.example.delta/notes.txt", "wgba/com.flightrabbit.rapid/1.3.5.wgba"].map((k) => r2.has(k));
    var deletes = r2.log.filter((l) => l.kind === "delete").map((l) => l.path.replace(`/${r2.bucket}/`, "")).sort();
    r2.put("wgba/io.example.delta/1.3.0.wgba", "newer");
    r2.clear();
    await privateUpload([await writeTemp("d.wgba", await game("io.example.delta", "1.2.5", "Delta"))], { config: tool });
    var lowerKeepsNewer = r2.has("wgba/io.example.delta/1.3.0.wgba") && r2.has("wgba/io.example.delta/1.2.5.wgba") && !r2.has("wgba/io.example.delta/1.2.0.wgba");
    r2.put("wgba/io.example.delta/1.2.0.wgba", "back");
    r2.put("wgba/io.example.old/1.0.0.wgba", "o1");
    r2.put("wgba/io.example.old/1.0.1.wgba", "o2");
    r2.clear();
    await privatePrune({ dryRun: true, config: tool });
    var dryDeletes = r2.log.filter((l) => l.kind === "delete").length;
    await privatePrune({ config: tool });
    var prunedLeft = [...["wgba/io.example.delta/1.2.0.wgba", "wgba/io.example.delta/1.2.5.wgba", "wgba/io.example.delta/1.3.0.wgba", "wgba/io.example.old/1.0.0.wgba", "wgba/io.example.old/1.0.1.wgba", "wgba/io.example.other/1.0.0.wgba", "wgba/com.flightrabbit.rapid/1.3.5.wgba", "wgba/io.example.delta/notes.txt", "authentication.key"].map((k) => r2.has(k))];
    r2.put("wgba/io.example.fail/1.0.0.wgba", "f1");
    r2.clear();
    r2.breakPuts(true);
    var failMsg = await privateUpload([await writeTemp("e.wgba", await game("io.example.fail", "1.1.0", "Fail"))], { config: tool }).then(() => "올림", (e) => e.message);
    r2.breakPuts(false);
    var failKept = r2.has("wgba/io.example.fail/1.0.0.wgba") && r2.log.every((l) => l.kind !== "delete");
    var mismatch = await adminKey({ config: tool, ask: (() => { let i = 0; return async () => (i++ ? "000000" : "111111"); })() }).then(() => "올림", (e) => e.message);
    var asks = asked;
    r2.emptyPuts(true);
    var emptyKey = await adminKey({ config: tool, ask: async () => "1#2!3#" }).then(() => "올림", (e) => e.message);
    r2.emptyPuts(false);
    await adminKey({ config: tool, ask: async () => "1#2!3#", now: () => clock - 60000 });
  } finally {
    console.log = quiet;
  }
  const keyText = new TextDecoder().decode(r2.read("authentication.key"));
  ok("admin-key = 두 번 입력 → SHA-256·한국 시각 갱신일자로 업로드(서명 확인)", asks === 2 && /^\{"sha256":"[0-9a-f]{64}","updated":"\d{4}-\d{2}-\d{2} \d{2}:\d{2}"\}\n$/.test(keyText) && !keyText.includes("1#2!3#"));
  ok("admin-key = 두 값이 다르면 올리지 않음", /다릅니다/.test(mismatch));
  ok("admin-key = 올린 뒤 HEAD 로 크기 확인(0바이트면 오류)", /크기가 다릅니다\(버킷 0 · 보낸 \d+바이트\)/.test(emptyKey), emptyKey);
  clock += ADMIN.KEY_MS + 1;
  const viaTool = await call("POST", "verify", { body: { pin: "1#2!3#" }, ip: "192.0.2.99" });
  ok("도구로 만든 키 = 서버 확인 통과", viaTool.status === 200);
  ok("upload --wgba = 비공개 버킷 wgba/<id>/<버전>.wgba(원본 이름 firered.wgba 무관)", firstPuts.join() === `/${r2.bucket}/wgba/io.example.delta/1.0.0.wgba,/${r2.bucket}/wgba/io.example.delta/1.1.0.wgba,/${r2.bucket}/wgba/com.flightrabbit.rapid/1.3.5.wgba`, firstPuts.join(" "));
  ok("upload --wgba = 같은 파일 다시 올리지 않음(목록 1번)", againPuts === 0);
  ok("올린 뒤 같은 id 의 낮은 버전 삭제(delta 1.0.0 삭제 · 1.1.0·다른 id 남김)", afterFirst.join() === "false,true,true", afterFirst.join());
  ok("낮은 것만 삭제 · 다른 id·notes.txt·authentication.key 그대로", afterSecond.join() === "false,false,true,true,true,true" && deletes.join() === "wgba/io.example.delta/0.9.0.wgba,wgba/io.example.delta/1.1.0.wgba" && r2.read("authentication.key").length === keyBefore, deletes.join(" "));
  ok("더 높은 버전이 있는 id 에 낮은 버전을 올리면 높은 것은 남김", lowerKeepsNewer);
  ok("private-prune --dry-run = 삭제 없음 · 실행 = 게임마다 최신 하나만(wgba/ 밖·형식 다른 키 그대로)", dryDeletes === 0 && prunedLeft.join() === "false,false,true,false,true,true,true,true,true", prunedLeft.join());
  ok("올리기 실패 시 삭제하지 않음", /PUT/.test(failMsg) && failKept, failMsg);

  ok("저장 이름 = 영어 이름 소문자·하이픈(악센트 제거) · 영어 이름 없으면 id 끝", saveFileName({ id: "local.x", names: { en: "Ninja Baseball Bat Man", ko: "닌자" } }) === "ninja-baseball-bat-man.wgba" && saveFileName({ id: "local.tetris", names: { ja: "テトリス" } }) === "tetris.wgba" && saveFileName({ id: "com.flightrabbit.rapid" }) === "pokemon-rapid.wgba");
  ok("저장 이름 = Windows 금지 글자·예약어 처리", safeFileName('a<b>:"c"/\\|?*') === "a_b___c______.wgba" && safeFileName("con") === "_con.wgba" && safeFileName("  ..  ") === "game.wgba");
} finally {
  await r2.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  await kv.close?.();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
