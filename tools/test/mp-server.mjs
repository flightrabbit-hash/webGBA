// 멀티플레이 짝 찾기 서버 함수(api/_mp) 단위 시험 — 메모리 가짜 Upstash(fake-upstash.mjs)로 돌린다. 외부 접속 없음.
//   node tools/test/mp-server.mjs [--out <결과 json>]
import fs from "node:fs";
import { createServer, LIMITS } from "../../api/_mp/server.js";
import { startFakeUpstash } from "./fake-upstash.mjs";
import { makeStore } from "../../api/_mp/store.js";
import { GRAPHQL_API, TURN, TURN_API, TURN_CAP } from "../../api/_mp/turn.js";

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

  // ── 중간 참가 게임: 받기 멈춤(w: 0)·갱신(renew) ──
  fake.reset();
  const IP = "192.0.2.120";
  const hb = (r, q, more = {}) => ({ ...hostQ(r, q), c: C, p: "trade", m: 4, n: "H", o: OFFER, k: 1, ...more });
  const rw = (await makeRoom({ body: { m: 4 }, ip: IP })).body;
  const p0 = fake.stats().total;
  const pause = await call("POST", "room", { body: hb(rw, 1, { w: 0 }), ip: IP });
  const pauseCmds = fake.stats().total - p0;
  const nearP = await call("GET", "near", { ip: IP });
  const joinP = await call("POST", "join", { body: { room: rw.room, c: C, p: "trade", n: "G" }, ip: IP });
  ok(`받기 멈춤(w: 0, ${pauseCmds}명령) → 근처 목록에서 빠지고 들어가기 409 paused`, pause.status === 200 && !nearP.body.rooms.some((x) => x.room === rw.room) && joinP.status === 409 && joinP.body.error === "paused", JSON.stringify(joinP.body));
  const r0 = fake.stats().total;
  const alive = await call("POST", "renew", { body: hb(rw, 2), ip: IP });
  const aliveCmds = fake.stats().total - r0;
  const nearA = await call("GET", "near", { ip: IP });
  const joinA = await call("POST", "join", { body: { room: rw.room, c: C, p: "trade", n: "G" }, ip: IP });
  ok(`갱신(방 기록 남음, ${aliveCmds}명령) → 같은 방 코드·근처 목록 다시 표시·들어가기 됨`, alive.status === 200 && alive.body.room === rw.room && alive.body.same === true && nearA.body.rooms.some((x) => x.room === rw.room) && joinA.status === 200 && joinA.body.q === 2, JSON.stringify(alive.body));
  fake.advance((LIMITS.ROOM_TTL + 1) * 1000);
  const e0 = fake.stats().total;
  const expired = await call("POST", "renew", { body: hb(rw, 3, { t: alive.body.t, i: alive.body.i }), ip: IP });
  const expiredCmds = fake.stats().total - e0;
  const joinE = await call("POST", "join", { body: { room: rw.room, c: C, p: "trade", n: "G2" }, ip: IP });
  ok(`갱신(방 기록 만료, ${expiredCmds}명령) → 같은 방 코드 다시 잡음·들어가기 됨`, expired.status === 200 && expired.body.room === rw.room && expired.body.same === false && joinE.status === 200 && joinE.body.q === 3, JSON.stringify(expired.body));
  fake.advance((LIMITS.ROOM_TTL + 1) * 1000);
  await makeStore({ env }).run([["SET", `r:${rw.room}`, JSON.stringify({ x: "zzzzzzzzzzz", c: C, p: "trade", m: 2, n: "other", k: 1, q: 1, o: OFFER, g: rw.g, i: -1 }), "EX", 150]]);
  const otherJoin = await call("POST", "join", { body: { room: rw.room, c: C, p: "trade", n: "X" }, ip: IP });
  const taken = await call("POST", "renew", { body: hb(rw, 4, { t: expired.body.t, i: expired.body.i }), ip: IP });
  ok("갱신: 그사이 다른 방이 같은 코드를 쓰면 409 taken(남의 방 기록은 그대로)", otherJoin.status === 200 && otherJoin.body.hn === "other" && taken.status === 409 && taken.body.error === "taken", JSON.stringify({ taken: taken.body, other: otherJoin.status }));
  const forgedR = await call("POST", "renew", { body: { ...hb(rw, 5), t: "20260101.xxxxxxxxxxxxxxxxxxxxxx" }, ip: IP });
  ok("갱신: 방장 토큰이 틀리면 403", forgedR.status === 403, String(forgedR.status));

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

  // ── 방장 돌아오기(away·hold·back, 결정 174 가): 방장이 앱을 닫아도 방 기록 2분 유지, 방장 증명으로만 되찾음 ──
  fake.reset();
  const HIP = "198.51.100.60";
  const GIP = "198.51.100.61";
  const hr = (await makeRoom({ body: { m: 3 }, ip: HIP })).body;
  const hj = (await call("POST", "join", { body: { room: hr.room, c: C, p: "trade", n: "유저" }, ip: GIP })).body;
  const hA = { room: hr.room, x: hr.x, g: hr.g, i: hr.i, t: hr.t };
  const gA = { room: hr.room, x: hj.x, rt: hj.rt, s: 1 };
  const ttlOf = (key) => fake.dump().find(([k]) => k === key)?.[2] ?? 0;
  const rKey = `r:${hr.room}`;
  const before = await call("GET", "rj", { query: { ...gA, u: U1 }, ip: GIP });
  n0 = fake.stats().total;
  const away = await call("POST", "away", { body: hA, ip: HIP });
  const awayCmds = fake.stats().total - n0;
  const awayTtl = ttlOf(rKey);
  const seen = await call("GET", "rj", { query: { ...gA, u: U1 }, ip: GIP });
  const joinAway = await call("POST", "join", { body: { room: hr.room, c: C, p: "trade", n: "새 유저" }, ip: "198.51.100.62" });
  const nearAway = await call("GET", "near", { ip: HIP });
  ok(`방장 앱 종료(away, ${awayCmds}명령): 방 기록 ${LIMITS.HOLD_TTL}초 유지 · 유저 받기 away > 0 · 새 참가 409 paused · 근처 목록에서 빠짐`, away.status === 200 && away.body.away > (LIMITS.HOLD_TTL - 5) * 1000 && awayTtl > LIMITS.HOLD_TTL - 5 && awayTtl <= LIMITS.HOLD_TTL && before.body.away === 0 && seen.body.live === true && seen.body.away > 0 && joinAway.status === 409 && joinAway.body.error === "paused" && !nearAway.body.rooms.some((x) => x.room === hr.room), JSON.stringify({ away: away.body, ttl: awayTtl, seen: seen.body.away, join: joinAway.body }));
  fake.advance(10000);
  const again = await call("POST", "away", { body: hA, ip: HIP });
  const gHold = await call("POST", "hold", { body: { room: hr.room, x: hj.x, rt: hj.rt }, ip: GIP });
  ok("두 번째 away·유저 hold 는 시간을 늘리지 않음(처음 나간 시각 기준)", again.status === 200 && gHold.status === 200 && again.body.away <= away.body.away && gHold.body.away <= away.body.away && ttlOf(rKey) <= awayTtl - 9, JSON.stringify({ again: again.body, hold: gHold.body, ttl: ttlOf(rKey) }));
  const forgedHold = await call("POST", "hold", { body: { room: hr.room, x: hj.x, rt: `${hj.rt.slice(0, 9)}${"A".repeat(22)}` }, ip: GIP });
  const forgedAway = await call("POST", "away", { body: { ...hA, t: `${hr.t.slice(0, 9)}${"A".repeat(22)}` }, ip: HIP });
  const forgedBack = await call("POST", "back", { body: { ...hA, t: `${hr.t.slice(0, 9)}${"A".repeat(22)}`, c: C, p: "trade", m: 3, n: "남", o: OFFER, q: 1, k: 2 }, ip: "198.51.100.63" });
  const guestBack = await call("POST", "back", { body: { room: hr.room, x: hj.x, rt: hj.rt, c: C, p: "trade", m: 3, n: "유저", o: OFFER, q: 1, k: 2 }, ip: GIP });
  ok("증명이 틀리면 hold·away·back 403 · 유저 표(rt)로는 방장 자리를 되찾지 못함", forgedHold.status === 403 && forgedAway.status === 403 && forgedBack.status === 403 && guestBack.status >= 400, `${forgedHold.status}/${forgedAway.status}/${forgedBack.status}/${guestBack.status}`);
  fake.advance(50000);
  n0 = fake.stats().total;
  const back = await call("POST", "back", { body: { ...hA, c: C, p: "trade", m: 3, n: "방장", o: OFFER, q: 1, k: 2 }, ip: HIP });
  const backCmds = fake.stats().total - n0;
  const backTtl = ttlOf(rKey);
  const afterBack = await call("GET", "rj", { query: { ...gA, u: U1 }, ip: GIP });
  ok(`돌아오기(back, ${backCmds}명령): 같은 방 코드 · 방 기록 다시 ${LIMITS.ROOM_TTL}초 · 유저 받기 away 0·live`, back.status === 200 && back.body.ok === true && backTtl > LIMITS.ROOM_TTL - 5 && afterBack.body.live === true && afterBack.body.away === 0, JSON.stringify({ back: back.body, ttl: backTtl, after: afterBack.body }));
  const markG = await call("POST", "hold", { body: { room: hr.room, x: hj.x, rt: hj.rt }, ip: GIP });
  ok(`유저 hold(방장이 답하지 않음): 방장 자리 보관 시작 · ${LIMITS.HOLD_TTL}초`, markG.status === 200 && markG.body.away > (LIMITS.HOLD_TTL - 5) * 1000 && ttlOf(rKey) <= LIMITS.HOLD_TTL, JSON.stringify(markG.body));
  fake.advance((LIMITS.HOLD_TTL + 1) * 1000);
  const late = await call("POST", "back", { body: { ...hA, c: C, p: "trade", m: 3, n: "방장", o: OFFER, q: 1, k: 2 }, ip: HIP });
  const lateG = await call("GET", "rj", { query: { ...gA, u: U1 }, ip: GIP });
  const lateHold = await call("POST", "hold", { body: { room: hr.room, x: hj.x, rt: hj.rt }, ip: GIP });
  ok(`${LIMITS.HOLD_TTL}초 지나면 방 기록 없음 → 돌아오기 404 none · 유저 받기 live false · hold 404(새로 만들지 않음)`, late.status === 404 && late.body.error === "none" && lateG.body.live === false && lateHold.status === 404 && !fake.dump().some(([k]) => k === rKey), `${late.status}/${lateG.body.live}/${lateHold.status}`);

  // ── 기본 TURN 접속 정보 발급(turn) — 가짜 Cloudflare(발급·GraphQL), 키 값은 출력하지 않음 ──
  const cloud = { bytes: 0, gql: 0, gen: 0, mode: "", ttl: 0, nodes: 0, vars: null, auth: [] };
  const KEYS = { TURN_KEY_ID: "fake-key-id", TURN_KEY_API_TOKEN: "fake-turn-token", CF_ACCOUNT_ID: "fakeaccount0123", CF_ANALYTICS_API_TOKEN: "fake-analytics-token" };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const cloudFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === GRAPHQL_API) {
      cloud.gql++;
      cloud.auth.push(init.headers?.Authorization === `Bearer ${KEYS.CF_ANALYTICS_API_TOKEN}`);
      if (cloud.mode === "gql500") return json({}, 500);
      if (cloud.mode === "gqlErr") return json({ data: null, errors: [{ message: "bad" }] });
      const body = JSON.parse(init.body);
      cloud.vars = body.variables;
      cloud.nodes = (body.query.match(/callsTurnUsageAdaptiveGroups/g) ?? []).length;
      const account = {};
      for (let i = 0; i < cloud.nodes; i++) account[`d${i}`] = i === 3 ? [{ sum: { egressBytes: cloud.bytes - 1000 } }] : i === 5 ? [{ sum: { egressBytes: 1000 } }] : [];
      return json({ data: { viewer: { accounts: [account] } }, errors: null });
    }
    if (u.startsWith(TURN_API)) {
      cloud.gen++;
      cloud.auth.push(u === `${TURN_API}${KEYS.TURN_KEY_ID}/credentials/generate-ice-servers` && init.headers?.Authorization === `Bearer ${KEYS.TURN_KEY_API_TOKEN}`);
      if (cloud.mode === "gen500") return json({ error: "x" }, 500);
      cloud.ttl = JSON.parse(init.body).ttl;
      return json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: ["turn:turn.cloudflare.com:53?transport=udp", "turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:443?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turn:turn.cloudflare.com:80?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "U".repeat(96), credential: "P".repeat(96) }] }, 201);
    }
    return fetch(url, init);
  };
  let shift = 0;
  const clock = () => Date.now() + shift;
  const later = (ms) => {
    shift += ms;
    fake.advance(ms);
  };
  const turnApi = (extra = {}) => createServer({ env: { ...env, ...KEYS, ...extra }, fetchImpl: cloudFetch, now: clock });
  let tapi = turnApi();
  const turnCall = (body, o = {}) => call("POST", "turn", { body, server: tapi, ip: "198.51.100.70", ...o });
  const th = (await makeRoom({ body: { m: 3 }, ip: "198.51.100.70" })).body;
  const hostProof = { room: th.room, x: th.x, g: th.g, i: th.i, t: th.t };
  const tj = (await call("POST", "join", { body: { room: th.room, c: C, p: "trade", n: "유저" }, ip: "198.51.100.71" })).body;
  const guestProof = { room: th.room, x: tj.x, rt: tj.rt };

  const NAMES = Object.keys(KEYS);
  const WHY_RE = new RegExp(`^(${NAMES.join("|")}):(missing|format)$`);
  const warned = [];
  const warn0 = console.warn;
  console.warn = (...a) => warned.push(a.join(" "));
  const offRaw = [];
  const offCall = async (server) => {
    const res = await turnCall(hostProof, { server });
    offRaw.push(JSON.stringify(res.body));
    return res;
  };
  let off, offAgain, partial, blank, badForm;
  try {
    const offApi = createServer({ env, fetchImpl: cloudFetch, now: clock });
    off = await offCall(offApi);
    offAgain = await offCall(offApi);
    partial = await offCall(turnApi({ CF_ANALYTICS_API_TOKEN: "" }));
    blank = await offCall(turnApi({ TURN_KEY_ID: ` "" \n`, TURN_KEY_API_TOKEN: "\r\n" }));
    badForm = await offCall(turnApi({ TURN_KEY_ID: "fake key id", TURN_KEY_API_TOKEN: "fake-turn\ntoken", CF_ACCOUNT_ID: "fake-account-0123" }));
  } finally {
    console.warn = warn0;
  }
  const whyIs = (res, list) => res.status === 503 && res.body.error === "off" && JSON.stringify(res.body.why) === JSON.stringify(list);
  ok("TURN: 환경 변수 4개 중 하나라도 없으면 503 off(Cloudflare 호출 0)·why = 4개 missing", whyIs(off, NAMES.map((n) => `${n}:missing`)) && whyIs(offAgain, NAMES.map((n) => `${n}:missing`)) && cloud.gql + cloud.gen === 0, JSON.stringify(off.body));
  ok("TURN: 사용량 조회 키가 없으면 발급하지 않음(503 off · why = CF_ANALYTICS_API_TOKEN:missing)", whyIs(partial, ["CF_ANALYTICS_API_TOKEN:missing"]) && cloud.gen === 0, JSON.stringify(partial.body));
  ok("TURN: 공백·줄바꿈·따옴표만 있는 값 = missing", whyIs(blank, ["TURN_KEY_ID:missing", "TURN_KEY_API_TOKEN:missing"]) && cloud.gql + cloud.gen === 0, JSON.stringify(blank.body));
  ok("TURN: 형식이 틀린 값(가운데 공백·줄바꿈·허용하지 않는 글자) = format", whyIs(badForm, ["TURN_KEY_ID:format", "TURN_KEY_API_TOKEN:format", "CF_ACCOUNT_ID:format"]) && cloud.gql + cloud.gen === 0, JSON.stringify(badForm.body));
  const offShapes = [off, offAgain, partial, blank, badForm].every((r) => Object.keys(r.body).join(",") === "error,why" && r.body.why.every((w) => WHY_RE.test(w)));
  ok("TURN: off 응답·서버 기록 = 변수 이름과 이유만(값 없음), 서버 기록은 인스턴스마다 1번", offShapes && !offRaw.some((t) => /fake|account0123/.test(t)) && warned.length === 4 && warned.every((w) => /^\[mp\/turn\] off: /.test(w) && w.slice(15).split(" ").every((x) => WHY_RE.test(x)) && !/fake|account0123/.test(w)), `기록 ${warned.length}줄`);

  cloud.bytes = 10e9;
  const issued = await turnCall(hostProof);
  const ib = issued.body ?? {};
  ok("TURN: 방장(방 토큰) → 접속 정보·서버 주소 2개(UDP 3478·TLS 443, 53 제외)·수명 3600초", issued.status === 200 && JSON.stringify(ib.urls) === JSON.stringify(["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"]) && ib.username === "U".repeat(96) && ib.credential === "P".repeat(96) && ib.ttl === TURN.TTL && cloud.ttl === TURN.TTL, JSON.stringify({ status: issued.status, urls: ib.urls, ttl: ib.ttl }));
  ok(`TURN: 사용량 조회 = 최근 ${TURN_CAP.days}일(하루씩 ${cloud.nodes}개 노드)·계정 변수·두 키 모두 Bearer`, cloud.nodes === TURN_CAP.days && cloud.vars?.a === KEYS.CF_ACCOUNT_ID && cloud.auth.length === 2 && cloud.auth.every(Boolean), `노드 ${cloud.nodes}`);
  const guestIssued = await turnCall(guestProof, { ip: "198.51.100.71" });
  ok("TURN: 유저(들어가기 표 rt) → 발급 · 사용량은 캐시(조회 1회)", guestIssued.status === 200 && guestIssued.body.username && cloud.gql === 1 && cloud.gen === 2, `gql ${cloud.gql} gen ${cloud.gen}`);
  tapi = turnApi();
  const otherInstance = await turnCall(hostProof);
  ok("TURN: 다른 함수 인스턴스도 Upstash 캐시를 씀(5분 동안 조회 1회)", otherInstance.status === 200 && cloud.gql === 1, `gql ${cloud.gql}`);

  const forgedT = await turnCall({ ...hostProof, t: "20260101.xxxxxxxxxxxxxxxxxxxxxx" });
  const forgedG = await turnCall({ ...guestProof, rt: `${tj.rt.slice(0, 9)}${"A".repeat(22)}` });
  const badShape = await turnCall({ room: "12", x: tj.x, rt: tj.rt });
  ok("TURN: 틀린 방장 토큰·유저 표 403 · 형식 400", forgedT.status === 403 && forgedG.status === 403 && badShape.status === 400, `${forgedT.status}/${forgedG.status}/${badShape.status}`);
  const noOrigin = await turnCall(hostProof, { origin: "" });
  const evil = await turnCall(hostProof, { origin: "https://evil.example" });
  const exe = await turnCall(hostProof, { origin: "http://ui.localhost" });
  ok("TURN: 출처 없음·다른 사이트 403, exe 화면 출처 허용", noOrigin.status === 403 && evil.status === 403 && exe.status === 200, `${noOrigin.status}/${evil.status}/${exe.status}`);

  const lone = (await makeRoom({ ip: "198.51.100.72" })).body;
  const loneProof = { room: lone.room, x: lone.x, g: lone.g, i: lone.i, t: lone.t };
  await call("POST", "room", { body: { ...hostQ(lone, 1), close: true }, ip: "198.51.100.72" });
  later(3000);
  const closedRoom = await turnCall(loneProof, { ip: "198.51.100.72" });
  ok("TURN: 닫힌 방(발급 기록 없음) → 404 none", closedRoom.status === 404 && closedRoom.body.error === "none", JSON.stringify(closedRoom.body));
  await call("POST", "room", { body: { ...hostQ(th, 1), close: true }, ip: "198.51.100.70" });
  later(3000);
  const renewHost = await turnCall(hostProof);
  const renewGuest = await turnCall(guestProof, { ip: "198.51.100.71" });
  ok("TURN: 방 기록이 끝나도 발급 기록(2시간) 안이면 갱신(긴 게임)", renewHost.status === 200 && renewGuest.status === 200, `${renewHost.status}/${renewGuest.status}`);
  later((TURN.MARK_TTL + 1) * 1000);
  const stale = await turnCall(hostProof);
  ok("TURN: 마지막 발급 뒤 2시간 지나면 404", stale.status === 404, String(stale.status));

  const rr2 = (await makeRoom({ ip: "198.51.100.73" })).body;
  const rateProof = { room: rr2.room, x: rr2.x, g: rr2.g, i: rr2.i, t: rr2.t };
  tapi = turnApi();
  const rateCodes = [];
  for (let n = 0; n < TURN.RATE_MAX + 1; n++) rateCodes.push((await turnCall(rateProof, { ip: "198.51.100.73" })).status);
  ok(`TURN: 같은 IP 묶음 1시간 ${TURN.RATE_MAX}회, 다음은 429`, rateCodes.slice(0, TURN.RATE_MAX).every((s) => s === 200) && rateCodes[TURN.RATE_MAX] === 429, rateCodes.slice(-2).join("/"));

  const capRoom = async (ip) => {
    const r = (await makeRoom({ ip })).body;
    return { room: r.room, x: r.x, g: r.g, i: r.i, t: r.t };
  };
  const fresh = async (bytes, mode = "") => {
    later((TURN.USAGE_TTL + 1) * 1000);
    tapi = turnApi();
    cloud.bytes = bytes;
    cloud.mode = mode;
  };
  await fresh(TURN_CAP.gb * 1e9 - 1e9);
  const c899 = await turnCall(await capRoom("198.51.100.74"), { ip: "198.51.100.74" });
  await fresh(TURN_CAP.gb * 1e9);
  const gen0 = cloud.gen;
  const c900 = await turnCall(await capRoom("198.51.100.75"), { ip: "198.51.100.75" });
  ok(`TURN: 최근 ${TURN_CAP.days}일 ${TURN_CAP.gb - 1}GB → 발급, ${TURN_CAP.gb}GB → 503 cap(발급 호출 없음)`, c899.status === 200 && c900.status === 503 && c900.body.error === "cap" && cloud.gen === gen0, `${c899.status}/${c900.status} ${c900.body?.error}`);
  const gCap = cloud.gql;
  const capAgain = await turnCall(await capRoom("198.51.100.76"), { ip: "198.51.100.76", server: turnApi() });
  ok("TURN: 한도 도달 결과도 캐시(5분) — 새 인스턴스도 조회 없이 503", capAgain.status === 503 && capAgain.body.error === "cap" && cloud.gql === gCap, `${capAgain.body?.error} gql +${cloud.gql - gCap}`);

  await fresh(1e9, "gql500");
  const g0 = cloud.gql;
  const u500 = await turnCall(await capRoom("198.51.100.77"), { ip: "198.51.100.77" });
  const u500b = await turnCall(await capRoom("198.51.100.78"), { ip: "198.51.100.78", server: turnApi() });
  ok("TURN: 사용량 조회 실패(HTTP 500) → 503 usage, 실패도 1분 캐시(다시 조회 안 함)", u500.status === 503 && u500.body.error === "usage" && u500b.body.error === "usage" && cloud.gql === g0 + 1, `${u500.body?.error}/${u500b.body?.error} gql +${cloud.gql - g0}`);
  later((TURN.USAGE_FAIL_TTL + 1) * 1000);
  tapi = turnApi();
  cloud.mode = "gqlErr";
  const uErr = await turnCall(await capRoom("198.51.100.79"), { ip: "198.51.100.79" });
  ok("TURN: GraphQL errors 응답 → 503 usage(1분 뒤 다시 조회)", uErr.status === 503 && uErr.body.error === "usage" && cloud.gql === g0 + 2, `${uErr.body?.error} gql +${cloud.gql - g0}`);
  await fresh(1e9, "gen500");
  const genFail = await turnCall(await capRoom("198.51.100.80"), { ip: "198.51.100.80" });
  ok("TURN: Cloudflare 발급 실패 → 503 turn", genFail.status === 503 && genFail.body.error === "turn", JSON.stringify(genFail.body));
  cloud.mode = "";

  await fresh(1e9);
  const MESSY = { TURN_KEY_ID: `  "${KEYS.TURN_KEY_ID}"\n`, TURN_KEY_API_TOKEN: `'${KEYS.TURN_KEY_API_TOKEN}'\r\n`, CF_ACCOUNT_ID: ` ${KEYS.CF_ACCOUNT_ID}\t`, CF_ANALYTICS_API_TOKEN: `"\n${KEYS.CF_ANALYTICS_API_TOKEN} "\n` };
  tapi = turnApi(MESSY);
  const a0 = cloud.auth.length;
  const gq0 = cloud.gql;
  const messy = await turnCall(await capRoom("198.51.100.81"), { ip: "198.51.100.81" });
  const messyAuth = cloud.auth.slice(a0);
  ok("TURN: 앞뒤 공백·줄바꿈·따옴표가 섞인 값 → 다듬은 값으로 사용량 조회·발급(두 키 Bearer·계정 변수 일치)", messy.status === 200 && messy.body.username === "U".repeat(96) && cloud.gql === gq0 + 1 && messyAuth.length === 2 && messyAuth.every(Boolean) && cloud.vars?.a === KEYS.CF_ACCOUNT_ID, JSON.stringify({ status: messy.status, error: messy.body?.error, auth: messyAuth }));

  const dumpT = fake.dump();
  const ttlLessT = dumpT.filter(([, , ttl]) => ttl < 0);
  const textT = dumpT.map(([k, v]) => `${k} ${v}`).join("\n");
  ok("TURN: 새 열쇠(tl·u·tu)도 모두 만료 시간 · DEL 0", ttlLessT.length === 0 && (fake.stats().byName.DEL ?? 0) === 0 && dumpT.some(([k]) => k.startsWith("tl:")) && dumpT.some(([k]) => k.startsWith("u:")), ttlLessT.map(([k]) => k.split(":")[0]).join(","));
  ok("TURN: 저장 값에 접속 정보·키·IP 없음", !/UUUUUUUU|PPPPPPPP|fake-|fakeaccount|198\.51\.100/.test(textT));

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
