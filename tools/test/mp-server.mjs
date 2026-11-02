// 멀티플레이 짝 찾기 서버 함수(api/_mp) 단위 시험 — 메모리 가짜 Upstash(fake-upstash.mjs)로 돌린다. 외부 접속 없음.
//   node tools/test/mp-server.mjs [--out <결과 json>]
import fs from "node:fs";
import { createServer, LIMITS } from "../../api/_mp/server.js";
import { startFakeUpstash } from "./fake-upstash.mjs";

const args = process.argv.slice(2);
const outFile = args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1] : "";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const fake = await startFakeUpstash();
const env = { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token };
let api = createServer({ env });
const BASE = "https://webgba.vercel.app/api/v1/mp/";
const C = "0123456789abcdef";
const C2 = "fedcba9876543210";
const OFFER = "AQ" + "x".repeat(130);
const ANSWER = "Ag" + "y".repeat(130);

async function call(method, op, { body, query, ip = "203.0.113.7", origin = "https://webgba.vercel.app", server = api } = {}) {
  const url = new URL(op, BASE);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const headers = { "x-forwarded-for": ip };
  if (origin) headers.origin = origin;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    headers["content-type"] = "text/plain;charset=UTF-8";
  }
  const res = await server.handle(new Request(url, init));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const makeRoom = (o = {}) => call("POST", "room", { body: { c: C, p: "trade", m: 2, n: "플레이어 4821", o: OFFER, ...o.body }, ip: o.ip });
const hostQ = (r, q) => ({ room: r.room, x: r.x, g: r.g, i: r.i, t: r.t, q });

try {
  const none = await call("POST", "room", { body: {}, server: createServer({ env: {} }) });
  ok("환경 변수 없음 → 503 store(클라이언트가 연결 코드로 안내)", none.status === 503 && none.body.error === "store", JSON.stringify(none.body));

  const game = await call("GET", "near", { origin: "http://game.abc123def456.localhost" });
  const nul = await call("GET", "near", { origin: "null" });
  const other = await call("GET", "near", { origin: "https://evil.example" });
  ok("CORS: 게임 틀·null·다른 사이트 출처 거부(403)", game.status === 403 && nul.status === 403 && other.status === 403, `${game.status}/${nul.status}/${other.status}`);
  const app = await call("GET", "near", { origin: "http://ui.localhost" });
  const pre = await call("OPTIONS", "room", { origin: "http://ui.localhost" });
  ok("CORS: exe 앱 화면(http://ui.localhost) 허용·사전 요청 204", app.status === 200 && app.headers.get("access-control-allow-origin") === "http://ui.localhost" && pre.status === 204 && /POST/.test(pre.headers.get("access-control-allow-methods")), `${app.status} ${pre.status}`);
  const same = await call("GET", "near", { origin: "https://webgba-abc.vercel.app", server: api });
  ok("CORS: 다른 배포 주소에서 webgba.vercel.app 으로 보내면 거부", same.status === 403, String(same.status));

  // ── 방 만들기·근처·들어가기·답·받기 (2명) ──
  fake.reset();
  const room = await makeRoom({ ip: "203.0.113.7" });
  const created = fake.stats().total;
  ok("방 만들기 → 6자리 방 코드·토큰", room.status === 200 && /^\d{6}$/.test(room.body.room) && room.body.t && room.body.q === 1, JSON.stringify({ room: room.body.room, i: room.body.i }));
  const r = room.body;
  const nearSame = await call("GET", "near", { ip: "203.0.113.7" });
  const nearOther = await call("GET", "near", { ip: "198.51.100.9" });
  const listed = nearSame.body.rooms.find((x) => x.room === r.room);
  ok("근처: 같은 공인 IP 는 방이 보이고 다른 IP 는 안 보임", listed && listed.nick === "플레이어 4821" && listed.k === 1 && listed.m === 2 && listed.c === C && !nearOther.body.rooms.some((x) => x.room === r.room), JSON.stringify(listed));
  const v6a = await makeRoom({ ip: "2001:db8:1:2::5", body: { c: C2 } });
  const v6same = await call("GET", "near", { ip: "2001:db8:1:2:aaaa:bbbb:cccc:dddd" });
  const v6other = await call("GET", "near", { ip: "2001:db8:1:3::5" });
  ok("근처: IPv6 는 앞 /64 가 같으면 같은 묶음", v6same.body.rooms.some((x) => x.room === v6a.body.room && x.c === C2) && !v6other.body.rooms.some((x) => x.room === v6a.body.room));
  const bad = await call("POST", "join", { body: { room: r.room, c: C2, p: "trade", n: "B" } });
  const badP = await call("POST", "join", { body: { room: r.room, c: C, p: "battle", n: "B" } });
  const missing = await call("POST", "join", { body: { room: r.room === "999999" ? "999998" : "999999", c: C, p: "trade", n: "B" } });
  ok("들어가기: 다른 호환 키 409 version · 다른 용도 409 purpose · 없는 방 404", bad.status === 409 && bad.body.error === "version" && badP.body.error === "purpose" && missing.status === 404 && missing.body.error === "none");
  const j = await call("POST", "join", { body: { room: r.room, c: C, p: "trade", n: "손님" }, ip: "203.0.113.7" });
  ok("들어가기 → 방장 연결 코드(Offer)·손님 토큰", j.status === 200 && j.body.o === OFFER && j.body.hn === "플레이어 4821" && j.body.t, JSON.stringify({ q: j.body.q, k: j.body.k, m: j.body.m }));
  const nearAfter = await call("GET", "near", { ip: "203.0.113.7" });
  ok("마지막 자리를 잡으면 근처 목록에서 빠짐", !nearAfter.body.rooms.some((x) => x.room === r.room));
  const j2 = await call("POST", "join", { body: { room: r.room, c: C, p: "trade", n: "늦은 손님" } });
  ok("2명 방: 다른 사람이 자리를 잡았으면 409 full", j2.status === 409 && j2.body.error === "full", JSON.stringify(j2.body));
  const forged = await call("POST", "msg", { body: { x: j.body.x, q: 1, t: r.t, d: ANSWER } });
  ok("답 보내기: 방장 토큰(다른 종류)으로는 거부 403", forged.status === 403);
  const sent = await call("POST", "msg", { body: { x: j.body.x, q: j.body.q, t: j.body.t, d: ANSWER } });
  const got = await call("GET", "msg", { query: hostQ(r, 1) });
  ok("답 보내기 → 방장 받기에 Answer·자리 잡은 시각", sent.status === 200 && got.body.a === ANSWER && got.body.c > 0, JSON.stringify({ c: got.body.c > 0 }));
  const stolen = await call("GET", "msg", { query: { ...hostQ(r, 1), room: v6a.body.room } });
  ok("받기: 다른 방 코드로 토큰을 쓰면 403", stolen.status === 403);
  const flow = fake.stats();
  ok(`연결 1회 Redis 명령 수(방 만들기 ${created} · 전체 ${flow.total}, 시험용 추가 요청 포함)`, flow.total > 0, JSON.stringify(flow.byName));

  // ── 연결 1회만 깨끗하게 세기(비밀값 캐시 따뜻함, 방장 받기 2번) ──
  fake.reset();
  const cr = (await makeRoom({ ip: "192.0.2.10" })).body;
  const c1 = fake.stats().total;
  await call("GET", "near", { ip: "192.0.2.11" });
  const c2 = fake.stats().total;
  const cj = (await call("POST", "join", { body: { room: cr.room, c: C, p: "trade", n: "G" }, ip: "192.0.2.11" })).body;
  const c3 = fake.stats().total;
  await call("GET", "msg", { query: hostQ(cr, 1), ip: "192.0.2.10" });
  await call("POST", "msg", { body: { x: cj.x, q: cj.q, t: cj.t, d: ANSWER }, ip: "192.0.2.11" });
  const c4 = fake.stats().total;
  const last = await call("GET", "msg", { query: hostQ(cr, 1), ip: "192.0.2.10" });
  const one = fake.stats();
  ok(`연결 1회 명령 수 = ${one.total}(방 만들기 ${c1} · 근처 ${c2 - c1} · 들어가기 ${c3 - c2} · 받기+답 ${c4 - c3} · 받기 ${one.total - c4})`, last.body.a === ANSWER && one.total <= 15, JSON.stringify(one.byName));

  // ── 4명 방: 자리 잡기 겹침 → 기다림 → 새 Offer ──
  const r4 = (await makeRoom({ body: { m: 4 }, ip: "192.0.2.50" })).body;
  const a = await call("POST", "join", { body: { room: r4.room, c: C, p: "trade", n: "A" }, ip: "192.0.2.50" });
  const b = await call("POST", "join", { body: { room: r4.room, c: C, p: "trade", n: "B" }, ip: "192.0.2.50" });
  ok("4명 방: 같은 Offer 를 두 번째 사람이 잡으려 하면 wait", a.status === 200 && b.status === 200 && b.body.wait === true && b.body.q === 1);
  const up = await call("POST", "room", { body: { ...hostQ(r4, 2), c: C, p: "trade", m: 4, n: "H", o: OFFER + "2", k: 2 }, ip: "192.0.2.50" });
  const st = await call("GET", "room", { query: { room: r4.room }, ip: "192.0.2.50" });
  const b2 = await call("POST", "join", { body: { room: r4.room, c: C, p: "trade", n: "B" }, ip: "192.0.2.50" });
  const near4 = await call("GET", "near", { ip: "192.0.2.50" });
  ok("방장 새 Offer(q 2) → 기다리던 사람이 들어감 · 근처 인원 2/4", up.status === 200 && st.body.q === 2 && b2.body.o === OFFER + "2" && b2.body.q === 2 && near4.body.rooms.find((x) => x.room === r4.room)?.k === 2, JSON.stringify(st.body));

  // ── 제한 ──
  const big = await call("POST", "msg", { body: { x: cj.x, q: cj.q, t: cj.t, d: "z".repeat(LIMITS.MSG_MAX + 1) } });
  const nine = await makeRoom({ body: { m: 9 } });
  const longNick = await makeRoom({ body: { n: "가나다라마바사아자차카타파하" }, ip: "192.0.2.77" });
  const nick = (await call("GET", "near", { ip: "192.0.2.77" })).body.rooms.find((x) => x.room === longNick.body.room)?.nick ?? "";
  ok("메시지 1KB 넘음 413 · 9명 방 400 · 닉네임 12자로 자름", big.status === 413 && nine.status === 400 && [...nick].length === 12, `${big.status} ${nine.status} ${nick}`);
  let lastWrite = null;
  for (let n = 0; n < LIMITS.RATE_MAX + 1; n++) lastWrite = await call("POST", "join", { body: { room: "123456", c: C, p: "trade", n: "x" }, ip: "192.0.2.200" });
  const otherGroup = await call("POST", "join", { body: { room: "123456", c: C, p: "trade", n: "x" }, ip: "192.0.2.201" });
  ok("쓰기 제한: 근처 묶음마다 1분 60회, 61번째 429 · 다른 묶음은 그대로", lastWrite.status === 429 && lastWrite.body.error === "limit" && otherGroup.status === 404, `${lastWrite.status}/${otherGroup.status}`);
  let lastRead = null;
  for (let n = 0; n < LIMITS.RATE_MAX + 1; n++) lastRead = await call("GET", "near", { ip: "192.0.2.202" });
  ok("읽기 제한: 1분 60회 넘으면 429", lastRead.status === 429);

  // ── 닫기·TTL ──
  const rc = (await makeRoom({ ip: "192.0.2.90" })).body;
  const closed = await call("POST", "room", { body: { ...hostQ(rc, 1), close: true }, ip: "192.0.2.90" });
  const afterClose = await call("GET", "near", { ip: "192.0.2.90" });
  const joinClosed = await call("POST", "join", { body: { room: rc.room, c: C, p: "trade", n: "x" }, ip: "192.0.2.90" });
  ok("방장 취소 → 근처에서 빠지고 들어가기 404(삭제 명령 없이 짧은 TTL)", closed.status === 200 && !afterClose.body.rooms.some((x) => x.room === rc.room) && joinClosed.status === 404);
  const del = fake.stats().byName.DEL ?? 0;
  ok("DEL 명령 0", del === 0, String(del));
  const ttlLess = fake.dump().filter(([, , ttl]) => ttl < 0);
  ok("모든 열쇠에 만료 시간 있음", ttlLess.length === 0, ttlLess.map(([k]) => k.split(":")[0]).join(","));
  const values = fake.dump().map(([k, v]) => `${k} ${v}`).join("\n");
  ok("저장 값에 IP 없음(묶음 키는 HMAC)", !/203\.0\.113\.7|198\.51\.100|192\.0\.2\.|2001:db8/.test(values));
  const rt = (await makeRoom({ ip: "192.0.2.91" })).body;
  fake.advance((LIMITS.ROOM_TTL + 1) * 1000);
  const nearT = await call("GET", "near", { ip: "192.0.2.91" });
  const joinT = await call("POST", "join", { body: { room: rt.room, c: C, p: "trade", n: "x" }, ip: "192.0.2.91" });
  const statT = await call("GET", "room", { query: { room: rt.room }, ip: "192.0.2.91" });
  ok(`TTL ${LIMITS.ROOM_TTL}초 지나면 방·근처 목록 저절로 사라짐`, !nearT.body.rooms.some((x) => x.room === rt.room) && joinT.status === 404 && statT.status === 404);

  // ── 다시 들어오기 우편함(rj) ──
  fake.reset();
  const rr = (await makeRoom({ body: { m: 3 }, ip: "198.51.100.40" })).body;
  ok("방 만들기 응답에 다시 들어오기 지원 표시(rj: 1)", rr.rj === 1, JSON.stringify({ rj: rr.rj }));
  const jg = (await call("POST", "join", { body: { room: rr.room, c: C, p: "trade", n: "손님" }, ip: "198.51.100.41" })).body;
  ok("들어가기 응답에 다시 들어오기 표(rt)", typeof jg.rt === "string" && /^\d{8}\./.test(jg.rt), Object.keys(jg).join(","));
  const KEY = "k".repeat(22);
  const U1 = "u".repeat(11);
  const U2 = "v".repeat(11);
  const gAuth = { room: rr.room, x: jg.x, rt: jg.rt, s: 1 };
  const hAuth = { room: rr.room, x: rr.x, g: rr.g, i: rr.i, t: rr.t };
  const badT = await call("POST", "rj", { body: { ...gAuth, rt: `${jg.rt.slice(0, 9)}${"A".repeat(22)}`, u: U1, k: "n", o: OFFER, key: KEY }, ip: "198.51.100.41" });
  const badK = await call("POST", "rj", { body: { ...gAuth, u: U1, k: "n", o: OFFER, key: "x" }, ip: "198.51.100.41" });
  const badS = await call("POST", "rj", { body: { ...gAuth, s: 0, u: U1, k: "n", o: OFFER, key: KEY }, ip: "198.51.100.41" });
  ok("우편함: 잘못된 표 403 · 열쇠 형식·자리 0 은 400", badT.status === 403 && badK.status === 400 && badS.status === 400, `${badT.status}/${badK.status}/${badS.status}`);
  let n0 = fake.stats().total;
  const post = await call("POST", "rj", { body: { ...gAuth, u: U1, k: "n", o: OFFER, key: KEY }, ip: "198.51.100.41" });
  const postCmds = fake.stats().total - n0;
  n0 = fake.stats().total;
  const empty = await call("GET", "rj", { query: { ...hAuth, s: "2" }, ip: "198.51.100.40" });
  const box = await call("GET", "rj", { query: { ...hAuth, s: "1,2" }, ip: "198.51.100.40" });
  const pollCmds = fake.stats().total - n0;
  ok(`손님 제안 넣기(${postCmds}명령) → 방장 받기(MGET 1명령씩): 자리 1 제안·열쇠 그대로, 빈 자리는 없음`, post.status === 200 && empty.body.offers.length === 0 && box.body.offers.length === 1 && box.body.offers[0].s === 1 && box.body.offers[0].u === U1 && box.body.offers[0].key === KEY && box.body.offers[0].o === OFFER && pollCmds === 2, `${postCmds}/${pollCmds}`);
  const badH = await call("GET", "rj", { query: { ...hAuth, t: rr.t.replace(/.$/, rr.t.endsWith("A") ? "B" : "A"), s: "1" }, ip: "198.51.100.40" });
  ok("방장 받기: 방장 토큰이 다르면 403", badH.status === 403, String(badH.status));
  n0 = fake.stats().total;
  const ans = await call("POST", "rj", { body: { ...hAuth, s: 1, u: U1, a: ANSWER }, ip: "198.51.100.40" });
  const ansCmds = fake.stats().total - n0;
  n0 = fake.stats().total;
  const mine = await call("GET", "rj", { query: { ...gAuth, u: U1 }, ip: "198.51.100.41" });
  const otherU = await call("GET", "rj", { query: { ...gAuth, u: U2 }, ip: "198.51.100.41" });
  const gPollCmds = (fake.stats().total - n0) / 2;
  ok(`방장 답(${ansCmds}명령) → 손님 받기(${gPollCmds}명령): 같은 시도 번호(u)만 답 · 방 살아 있음(live)`, ans.status === 200 && mine.body.a === ANSWER && mine.body.live === true && otherU.body.a === null && otherU.body.live === true, JSON.stringify({ a: Boolean(mine.body.a), o: otherU.body.a }));
  await call("POST", "rj", { body: { ...hAuth, s: 1, u: U2, n: 1 }, ip: "198.51.100.40" });
  const need = await call("GET", "rj", { query: { ...gAuth, u: U2 }, ip: "198.51.100.41" });
  await call("POST", "rj", { body: { ...hAuth, s: 1, u: U1 }, ip: "198.51.100.40" });
  const refused = await call("GET", "rj", { query: { ...gAuth, u: U1 }, ip: "198.51.100.41" });
  ok("방장 답 종류: 새 연결 필요(n)·거부(no)", need.body.n === 1 && !need.body.a && refused.body.no === 1, JSON.stringify({ n: need.body.n, no: refused.body.no }));
  const bye = await call("POST", "rj", { body: { ...gAuth, u: U2, k: "b", key: KEY }, ip: "198.51.100.41" });
  const byeBox = await call("GET", "rj", { query: { ...hAuth, s: "1" }, ip: "198.51.100.40" });
  ok("혼자 이어 하기 알림(k: b, 연결 정보 없음)", bye.status === 200 && byeBox.body.offers[0]?.k === "b" && !byeBox.body.offers[0]?.o, JSON.stringify(byeBox.body.offers[0]));
  const rjTtl = fake.dump().filter(([k]) => /^[jk]:/.test(k)).every(([, , ttl]) => ttl > 0 && ttl <= LIMITS.ANSWER_TTL);
  ok(`우편함 열쇠 만료 ${LIMITS.ANSWER_TTL}초`, rjTtl);
  n0 = fake.stats().total;
  const keep = await call("POST", "room", { body: { ...hAuth, c: C, p: "trade", m: 3, n: "방장", o: OFFER, q: 2, k: 3 }, ip: "198.51.100.40" });
  ok(`방 살려 두기(가득 찬 방) 1회 ${fake.stats().total - n0}명령`, keep.status === 200, String(fake.stats().total - n0));
  await call("POST", "room", { body: { ...hAuth, close: 1 }, ip: "198.51.100.40" });
  const gone = await call("GET", "rj", { query: { ...gAuth, u: U1 }, ip: "198.51.100.41" });
  ok("방장이 방을 닫으면 손님 받기 live: false(다시 들어오기 끝)", gone.status === 200 && gone.body.live === false, JSON.stringify(gone.body));

  // ── 저장소 한도·장애 ──
  fake.fail("quota");
  const q1 = await makeRoom({ ip: "192.0.2.92" });
  const q2 = await call("GET", "near", { ip: "192.0.2.92" });
  fake.fail("down");
  const q3 = await call("POST", "join", { body: { room: rt.room, c: C, p: "trade", n: "x" }, ip: "192.0.2.92" });
  fake.fail("");
  api = createServer({ env: { UPSTASH_REDIS_REST_URL: "http://127.0.0.1:9", UPSTASH_REDIS_REST_TOKEN: "x" } });
  const q4 = await call("GET", "near", { ip: "192.0.2.92" });
  ok("Upstash 한도 초과·장애·접속 실패 → 503 store", [q1, q2, q3, q4].every((x) => x.status === 503 && x.body.error === "store"), [q1, q2, q3, q4].map((x) => x.status).join("/"));
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
} finally {
  await fake.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\nmp-server: ${results.length - failed.length}/${results.length} 통과`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
