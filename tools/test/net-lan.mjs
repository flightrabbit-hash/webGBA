// 멀티플레이 부품 시험(브라우저 없이): 망 안 후보 거르기·연결 코드(인터넷 후보 포함)·Web_NetWanted 값·설명서 multiplayer 읽기·호환 키·QR 크기·게임별 연결 서버·상태 묶음 조각·중간 참가 게임(join).
//   node tools/test/net-lan.mjs
import { cleanCode, decodeCode, encodeCode, isLanAddress } from "../../src-bundle/src/js/core/net/lan.js";
import { compatKey, NetHost, netConfig, packWanted, unpackWanted } from "../../src-bundle/src/js/core/net/net-host.js";
import { checkManifest } from "../../src-bundle/src/js/core/wgba-format.js";
import { cleanNick, NetSession, STATE_MAX, statePackets } from "../../src-bundle/src/js/core/net/session.js";
import { fetchCredential, iceHosts, IcePlan, readIceServers } from "../../src-bundle/src/js/core/net/ice.js";
import { qrMatrix } from "../../src-bundle/src/js/core/net/qr.js";
import { RoomHost } from "../../src-bundle/src/js/core/net/signal.js";

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const lan = ["192.168.0.7", "10.1.2.3", "172.16.0.1", "172.31.255.1", "169.254.3.4", "fd12:3456::1", "fe80::1", "0b6c3a2e-1111-2222-3333-444455556666.local"];
const outside = ["8.8.8.8", "172.32.0.1", "100.64.1.2", "2001:db8::1", "2400:cb00::1", "1.2.3.4", "999.1.1.1", "router.local", ""];
ok("망 안 주소만 받음(mDNS·사설 IPv4·ULA·링크 로컬)", lan.every((a) => isLanAddress(a)), lan.filter((a) => !isLanAddress(a)).join(","));
ok("공인 IPv4·100.64/10·전 세계 IPv6·모르는 이름은 버림", outside.every((a) => !isLanAddress(a)), outside.filter((a) => isLanAddress(a)).join(","));

const fp = Array(32).fill("AB").join(":");
const sdp = (setup, cands) =>
  ["v=0", "a=ice-ufrag:Ab3d", "a=ice-pwd:0123456789abcdefghijkl", `a=fingerprint:sha-256 ${fp}`, `a=setup:${setup}`, ...cands.map((c, i) => `a=candidate:${i} 1 ${c}`), ""].join("\r\n");
const offer = encodeCode(sdp("actpass", ["udp 2122260223 8.8.8.8 50000 typ host", "udp 2122260223 2001:db8::9 50001 typ host", "udp 2122260223 0b6c3a2e-1111-2222-3333-444455556666.local 50002 typ host", "udp 1686052607 1.2.3.4 50003 typ srflx raddr 0.0.0.0 rport 0", "tcp 1518280447 192.168.0.9 9 typ host tcptype active", "udp 2122260223 192.168.0.9 50004 typ host"]));
ok("연결 코드: 공인 주소·srflx·TCP 버리고 망 안 UDP host 만", offer.kept === 2 && offer.dropped === 4, `남김 ${offer.kept} · 버림 ${offer.dropped}`);
const back = decodeCode(offer.code, "offer");
ok("연결 코드 되살리기: 망 안 후보만 SDP 에", back.kept === 2 && !/8\.8\.8\.8|2001:db8|1\.2\.3\.4/.test(back.sdp) && /192\.168\.0\.9/.test(back.sdp), `${offer.code.length}자`);
const answer = encodeCode(sdp("active", ["udp 2122260223 10.0.0.5 40000 typ host"]), back.ufrag);
const ans = decodeCode(answer.code, "answer");
ok("답 코드는 초대(방장 ufrag)를 가리킴", ans.ref === "Ab3d" && ans.type === "answer");
const kind = (() => {
  try {
    decodeCode(offer.code, "answer");
    return "";
  } catch (e) {
    return e.code;
  }
})();
ok("방장 코드를 답 칸에 넣으면 kind 오류", kind === "kind", kind);
const bad = ["", "abc", `${offer.code}x`, offer.code.slice(0, 40)].map((c) => {
  try {
    decodeCode(c, "offer");
    return "통과";
  } catch (e) {
    return e.code;
  }
});
ok("망가진·빈 코드 거부", bad.every((c) => c !== "통과"), bad.join(","));
ok("붙여 넣은 글 정리(띄어쓰기·줄바꿈·따옴표)", cleanCode(` "${offer.code.slice(0, 10)}\n${offer.code.slice(10)}" `) === offer.code);

const w = packWanted({ purpose: 2, min: 2, max: 4, role: 1, serial: 7 });
const u = unpackWanted(w);
ok("Web_NetWanted 값 풀기", u.purpose === 2 && u.min === 2 && u.max === 4 && u.role === 1 && u.serial === 7 && unpackWanted(0) === null, `0x${w.toString(16)}`);
ok("인원 0 = 기본(최소 2, 최대 = 최소)", unpackWanted(packWanted({ min: 0, max: 0, serial: 1 })).min === 2 && unpackWanted(packWanted({ min: 3, max: 0, serial: 1 })).max === 3);

const cfg = netConfig({ multiplayer: { protocol: 1, players: { min: 2, max: 8 }, purposes: [{ id: "trade", players: [2, 2] }, { id: "party" }] } });
ok("설명서 multiplayer 읽기(용도·인원)", cfg.purposes.length === 2 && cfg.purposes[0].max === 2 && cfg.purposes[1].max === 8 && cfg.compat === "exact");
ok("규약 번호가 더 크면 멀티플레이 끔", netConfig({ multiplayer: { protocol: 2 } }).off === "protocol");
ok("설명서 없는 ① 게임 = 기본 용도 하나·2명", netConfig(null).purposes.length === 1 && netConfig(null).max === 2);

// ── 중간 참가 게임(join: "anytime") ──
const joinErrors = (join) => {
  const errors = [];
  checkManifest({ multiplayer: { protocol: 1, join } }, errors, []);
  return errors.filter((e) => e.includes("multiplayer.join")).length;
};
ok("설명서 multiplayer.join: \"anytime\" 통과 · 다른 값 오류 · 빼면 기본", netConfig({ multiplayer: { protocol: 1, join: "anytime" } }).anytime && !netConfig({ multiplayer: { protocol: 1 } }).anytime && joinErrors("anytime") === 0 && joinErrors("always") === 1 && joinErrors(true) === 1);
const fakeHost = (wanted) => ({ ex: { Web_NetWanted: () => wanted, Web_NetEvent() {}, Web_NetOut: () => 0, Web_NetOutLen: () => 0, Web_NetOutClear() {}, Web_NetInBuffer: () => 0, Web_NetIn() {} }, u8: new Uint8Array(64), text: () => "", halted: false });
const wantRun = (join) => {
  const opened = [];
  const net = new NetHost({ onWant: (r) => opened.push(r) });
  net.attach(fakeHost(packWanted({ purpose: 1, min: 2, max: 4, serial: 1 })), { manifest: { multiplayer: { protocol: 1, players: { min: 2, max: 4 }, ...(join ? { join } : {}) } } });
  net.afterFrame();
  const got = { request: Boolean(net.request), opened: opened.length, timer: Boolean(net.windowTimer), anytime: net.snapshot().anytime };
  net.detach();
  return got;
};
const plain = wantRun();
const anytime = wantRun("anytime");
ok("요청: 기본 게임 = 창 자동 열림·3분 시간 초과 걸림 / 중간 참가 게임 = 요청만 기억(창 자동 열림·시간 초과 없음)", plain.request && plain.opened === 1 && plain.timer && anytime.request && anytime.opened === 0 && !anytime.timer && anytime.anytime, JSON.stringify({ plain, anytime }));
const k1 = await compatKey({ id: "a.b", compat: "exact", build: "x1", game: "" });
const k2 = await compatKey({ id: "a.b", compat: "exact", build: "x2", game: "" });
const k3 = await compatKey({ id: "a.b", compat: "proto-1", build: "x1", game: "" });
const k4 = await compatKey({ id: "a.b", compat: "proto-1", build: "x2", game: "" });
const k5 = await compatKey({ id: "a.b", compat: "proto-1", build: "x2", game: "v9" });
ok("호환 키: exact 는 빌드가 다르면 다름, 같은 compat 글자면 빌드 달라도 같음, Web_NetCompat 도 섞임", k1 !== k2 && k3 === k4 && k4 !== k5 && k1.length === 64);
ok("닉네임 정리(제어 문자·길이 16)", cleanNick(`  a${String.fromCharCode(7)}b  c  `, "?") === "ab c" && [...cleanNick("가".repeat(30))].length === 16 && cleanNick("   ", "기본") === "기본");
const q = qrMatrix("A".repeat(111));
ok("QR: 111자 연결 코드 = 버전 7(45칸)", q.version === 7 && q.size === 45, `v${q.version}`);

// ── 인터넷 연결(STUN) 코드 ──
const wanSdp = sdp("actpass", ["udp 2122260223 0b6c3a2e-1111-2222-3333-444455556666.local 50002 typ host", "udp 1686052607 203.0.113.9 50003 typ srflx raddr 0.0.0.0 rport 0", "udp 1686052607 203.0.113.9 50003 typ srflx raddr 0.0.0.0 rport 0", "udp 1686052351 2001:db8::77 50004 typ srflx raddr :: rport 0", "udp 41885439 198.51.100.3 3478 typ relay raddr 0.0.0.0 rport 0", "udp 2122260223 127.0.0.1 50005 typ host"]);
const wanOff = encodeCode(wanSdp);
const wanOn = encodeCode(wanSdp, "", { wan: true });
ok("인터넷 끔: 공인 후보(srflx·relay)는 코드에 넣지 않음(기존 코드와 같음)", wanOff.kept === 1 && wanOff.public === 0 && decodeCode(wanOff.code, "offer").wan === false);
const onBack = decodeCode(wanOn.code, "offer", { wan: true });
ok("인터넷 켬: srflx(IPv4·IPv6)·relay 를 코드에 넣음 · 같은 후보 한 번만 · 루프백 버림 · 인터넷 표시", wanOn.kept === 4 && wanOn.public === 3 && onBack.wan && /typ srflx raddr 0\.0\.0\.0/.test(onBack.sdp) && /2001:db8:0:0:0:0:0:77 50004 typ srflx/.test(onBack.sdp) && /198\.51\.100\.3 3478 typ relay/.test(onBack.sdp) && !/127\.0\.0\.1 50005/.test(onBack.sdp), `${wanOn.code.length}자`);
const offBack = decodeCode(wanOn.code, "offer");
ok("받는 쪽이 끔: 공인 후보를 버리고 망 안 후보만 · 버린 수 알림", offBack.kept === 1 && offBack.skipped === 3 && offBack.wan === true && !/srflx|relay/.test(offBack.sdp));
ok("인터넷 코드도 QR 안(버전 10 이하)", qrMatrix(wanOn.code).version <= 10, `v${qrMatrix(wanOn.code).version}`);
const v1 = (() => {
  const b = Buffer.from(wanOff.code, "base64url");
  b[0] |= 0x80;
  try {
    decodeCode(b.toString("base64url"), "offer");
    return "";
  } catch (e) {
    return e.code;
  }
})();
ok("모르는 머리 비트는 version 오류", v1 === "version", v1);

// ── 게임별 연결 서버(iceServers) ──
const good = readIceServers([{ urls: "stun:stun.example.com:3478" }, { urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"], credentialUrl: "https://example.com/turn" }]);
ok("iceServers: stun·turn·turns + credentialUrl 통과 · 도메인 목록", good.errors.length === 0 && good.warnings.length === 0 && iceHosts(good.servers).join() === "stun.example.com,turn.example.com");
const badList = [
  [{ urls: "http://x.example" }],
  [{ urls: ["stun:a.example", "stun:b.example", "stun:c.example", "stun:d.example", "stun:e.example"] }],
  [{ urls: "turn:t.example" }],
  [{ urls: "turn:t.example", credentialUrl: "http://t.example/c" }],
  [{ urls: "stun:s.example", credentialUrl: "https://s.example/c" }],
  "stun:s.example",
];
const badErr = badList.map((l) => readIceServers(l).errors.length);
ok("iceServers 오류: 모르는 주소 형식·주소 5개·접속 정보 없는 turn·http credentialUrl·stun 의 credentialUrl·배열 아님", badErr.every((n) => n > 0), badErr.join(","));
const fixed = readIceServers([{ urls: "turn:t.example:3478", username: "u", credential: "p" }]);
ok("고정 TURN 접속 정보는 경고(오류 아님)", fixed.errors.length === 0 && fixed.warnings.length === 1, fixed.warnings[0]);
const fake = (body, { status = 200, wait = 0 } = {}) => (url, init) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(body, { status })), wait);
    init.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });
const srv = good.servers[1];
const c1 = await fetchCredential(srv, { fetchImpl: fake(JSON.stringify({ username: "u1", credential: "c1", ttl: 60 })) });
const tooBig = await fetchCredential(srv, { fetchImpl: fake(JSON.stringify({ username: "u", credential: "x".repeat(9000) })) }).then(() => "", (e) => e.message);
const badJson = await fetchCredential(srv, { fetchImpl: fake("{x") }).then(() => "", (e) => e.name);
const late = await fetchCredential(srv, { fetchImpl: fake("{}", { wait: 400 }), timeoutMs: 100 }).then(() => "", (e) => e.name);
const http500 = await fetchCredential(srv, { fetchImpl: fake("{}", { status: 500 }) }).then(() => "", (e) => e.message);
ok("credentialUrl: 정상 → 서버 주소는 설명서 그대로 · 큰 응답·잘못된 JSON·시간 초과·HTTP 오류는 실패", c1.server.username === "u1" && c1.server.urls === srv.urls && tooBig === "size" && badJson === "SyntaxError" && late === "AbortError" && /500/.test(http500), [tooBig, badJson, late, http500].join("/"));
const planDefault = new IcePlan({ manifestList: undefined });
const planGame = new IcePlan({ manifestList: good.servers.map((s) => ({ ...s })), fetchImpl: fake(JSON.stringify({ username: "u2", credential: "c2" })) });
const lOff = await planGame.list(false);
const lDef = await planDefault.list(true);
const lGame = await planGame.list(true);
ok("연결 서버 고르기: 설정 끔 = 없음 · 지정 안 한 게임 = 기본 STUN 2곳 · 지정한 게임 = 게임 목록만", lOff.iceServers.length === 0 && lDef.iceServers.length === 2 && /google/.test(lDef.iceServers[0].urls) && lGame.iceServers.length === 2 && lGame.iceServers[1].credential === "c2" && !JSON.stringify(lGame).includes("google"));

// ── 상태 묶음 조각 ──
const got = [];
const hostS = new NetSession({ role: "make", nick: "H", max: 4, sink: { event() {}, deliver: (from, bytes, state) => got.push({ from, len: bytes.length, state, last: bytes[bytes.length - 1] }), change() {} }, makePeer: () => ({}) });
clearInterval(hostS.timer);
const blob = Uint8Array.from({ length: STATE_MAX }, (_, i) => i & 255);
const parts = statePackets(2, 0, blob);
for (const p of parts) hostS.takeState(2, p);
hostS.takeState(3, statePackets(3, 0, Uint8Array.of(9))[0]);
hostS.takeState(2, parts[1]);
ok(`상태 묶음: ${STATE_MAX}바이트 → ${parts.length}조각 → 한 묶음 · 1바이트 묶음 · 첫 조각 없는 조각은 버림`, parts.length === STATE_MAX / 16384 && got.length === 2 && got[0].len === STATE_MAX && got[0].state && got[0].last === 255 && got[1].len === 1 && got[1].from === 3, JSON.stringify(got.map((g) => g.len)));

// ── 방장 받기 간격: 중간 참가 게임은 손님 없이 2분 넘으면 10초 ──
const waitsOf = (idle) => {
  let t = 0;
  const session = { count: 1 };
  const host = new RoomHost({ signal: null, session, info: {}, now: () => t, idle });
  host.eventAt = 1000;
  const at = (ms) => {
    t = ms + 1000;
    return host.pollWait();
  };
  const out = [at(0), at(30000), at(90000), at(119000), at(125000)];
  session.count = 2;
  out.push(at(200000));
  session.count = 1;
  out.push(at(210000), at(331000));
  host.wake();
  out.push(at(332000));
  return out;
};
const idleWaits = waitsOf(true);
const plainWaits = waitsOf(false);
ok("받기 간격: 중간 참가 = 3초 → 1분 뒤 5초 → 손님 없이 2분 뒤 10초 · 손님 들어오면 5초 · 다시 혼자면 2분 뒤 10초 · 창 열기(wake) = 3초 / 기본 게임 = 10초 없음", idleWaits.join() === "3000,3000,5000,5000,10000,5000,5000,10000,3000" && plainWaits.join() === "3000,3000,5000,5000,5000,5000,5000,5000,3000", JSON.stringify({ idleWaits, plainWaits }));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
