// 멀티플레이 부품 시험(브라우저 없이): 망 안 후보 거르기·연결 코드·Web_NetWanted 값·설명서 multiplayer 읽기·호환 키·QR 크기.
//   node tools/test/net-lan.mjs
import { cleanCode, decodeCode, encodeCode, isLanAddress } from "../../src-bundle/src/js/core/net/lan.js";
import { compatKey, netConfig, packWanted, unpackWanted } from "../../src-bundle/src/js/core/net/net-host.js";
import { cleanNick } from "../../src-bundle/src/js/core/net/session.js";
import { qrMatrix } from "../../src-bundle/src/js/core/net/qr.js";

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
const k1 = await compatKey({ id: "a.b", compat: "exact", build: "x1", game: "" });
const k2 = await compatKey({ id: "a.b", compat: "exact", build: "x2", game: "" });
const k3 = await compatKey({ id: "a.b", compat: "proto-1", build: "x1", game: "" });
const k4 = await compatKey({ id: "a.b", compat: "proto-1", build: "x2", game: "" });
const k5 = await compatKey({ id: "a.b", compat: "proto-1", build: "x2", game: "v9" });
ok("호환 키: exact 는 빌드가 다르면 다름, 같은 compat 글자면 빌드 달라도 같음, Web_NetCompat 도 섞임", k1 !== k2 && k3 === k4 && k4 !== k5 && k1.length === 64);
ok("닉네임 정리(제어 문자·길이 16)", cleanNick(`  a${String.fromCharCode(7)}b  c  `, "?") === "ab c" && [...cleanNick("가".repeat(30))].length === 16 && cleanNick("   ", "기본") === "기본");
const q = qrMatrix("A".repeat(111));
ok("QR: 111자 연결 코드 = 버전 7(45칸)", q.version === 7 && q.size === 45, `v${q.version}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
