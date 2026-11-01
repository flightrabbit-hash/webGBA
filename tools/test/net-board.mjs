// 멀티플레이 상태 표(규격 7.9) 부품 시험(브라우저 없이): 설명서 board 읽기·검사, ① 400바이트 버퍼(모든 칸·serial·경계·틀린 값),
// ② webgba.net.board 값 거르기, 글 거르기, 표 합치기(정렬·나간 사람·게임 값 없음), scope "self" 줄 중계(세션 BOARD_ROW).
//   node tools/test/net-board.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_BYTES, boardConfig, boardSerial, boardView, checkBoard, cleanText, decodeRow, encodeRow, readBoard, scriptBoard } from "../../src-bundle/src/js/core/net/board.js";
import { NetSession } from "../../src-bundle/src/js/core/net/session.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(root, "docs", "wgba", "examples", dir, "manifest.json"), "utf8"));

// 설명서
const webapi = manifest("net-webapi");
const cfg = boardConfig(webapi);
ok("설명서 board 읽기(① 예제): 열 4·종류·scope all", cfg && cfg.columns.map((c) => c.type).join() === "bar,number,rank,status" && cfg.scope === "all", JSON.stringify(cfg?.columns.map((c) => c.type)));
const self = boardConfig(manifest("net-script"));
ok("설명서 board 읽기(② 예제): scope self·정렬 sent 큰 순", self?.scope === "self" && self.sort?.index === 0 && self.sort.desc);
ok("board 없음 → 표 안 읽음", boardConfig({ multiplayer: { protocol: 1 } }) === null && boardConfig(null) === null);
const errs = [];
const warns = [];
checkBoard(webapi.multiplayer.board, errs, warns);
checkBoard(manifest("net-script").multiplayer.board, errs, warns);
ok("예제 설명서 board 검사 통과", errs.length === 0 && warns.length === 0, [...errs, ...warns].join(" / "));
const badErrs = [];
checkBoard({ columns: [{ id: "A B", type: "pie", name: "이름이 열두 자를 넘는 긴 열 이름" }, { id: "hp", type: "bar", name: "HP" }, { id: "s", type: "status", name: "S", labels: [] }], scope: "both", sort: { column: "nope" } }, badErrs, []);
ok("틀린 board 검사: id·type·name 길이·bar max·status labels·scope·sort 를 모두 잡음", badErrs.length >= 7, `${badErrs.length}건`);

// ① 버퍼
const mem = new Uint8Array(4096);
const ptr = 1024;
const dv = new DataView(mem.buffer);
const put = (serial, rows, edit = () => {}) => {
  mem.fill(0, ptr, ptr + BOARD_BYTES);
  mem[ptr + 4] = 1;
  mem[ptr + 5] = rows.length;
  mem[ptr + 6] = 1;
  mem[ptr + 7] = 1;
  dv.setInt32(ptr + 8, 4, true);
  dv.setInt32(ptr + 12, -2, true);
  rows.forEach((r, i) => mem.set(encodeRow(r), ptr + 16 + i * 48));
  edit();
  dv.setUint32(ptr, serial, true);
};
const rows = [
  { slot: 0, dim: false, mark: true, nameLabel: 0, name: "", values: [81 | (120 << 16), 7, 1, 2, -5, 99] },
  { slot: null, dim: true, mark: false, nameLabel: 2, name: "", values: [0, 4, 8, 1, 0, 0] },
  { slot: null, dim: false, mark: false, nameLabel: 0, name: "로봇 3", values: [10, 1, 2, 0, 0, 0] },
];
put(7, rows);
const r1 = readBoard(mem, ptr);
const b1 = r1.board;
ok("① 버퍼 모든 칸: serial·format·줄 수·끝 비트·머리 글·인자·slot·흐리게/강조·nameLabel·이름·값 6개", r1.serial === 7 && b1.final && b1.caption === 1 && b1.args.join() === "4,-2" && b1.rows.length === 3 && b1.rows[0].slot === 0 && b1.rows[0].mark && b1.rows[1].slot === null && b1.rows[1].dim && b1.rows[1].nameLabel === 2 && b1.rows[2].name === "로봇 3" && b1.rows[0].values.join() === [81 | (120 << 16), 7, 1, 2, -5, 99].join(), JSON.stringify(b1.rows[0]));
put(0, rows);
ok("① serial 0 → 표 없음", readBoard(mem, ptr).board === null && readBoard(mem, ptr).serial === 0);
ok("① 400바이트 경계: ptr + 400 = 메모리 끝 → 읽음, 1바이트 넘으면 끔", boardSerial(mem, mem.length - BOARD_BYTES) >= 0 && readBoard(mem, mem.length - BOARD_BYTES + 1).off === true && readBoard(mem, 0).off === true);
put(8, rows, () => (mem[ptr + 5] = 9));
ok("① 줄 9개 → 표 무시", readBoard(mem, ptr).board === null && readBoard(mem, ptr).bad);
put(9, rows, () => (mem[ptr + 4] = 2));
ok("① format 2(모름) → 표 무시", readBoard(mem, ptr).board === null);
put(10, rows, () => {
  mem[ptr + 16 + 2 * 48 + 3] = 21;
  mem[ptr + 16 + 48] = 9;
});
const b2 = readBoard(mem, ptr).board;
ok("① nameLen 21 → 이름 버림 · slot 9(규칙 밖) 줄 버림", b2.rows.length === 2 && b2.rows[1].name === "", JSON.stringify(b2.rows.map((r) => [r.slot, r.name])));

// ② 값
const s1 = scriptBoard({ caption: 1, args: [4, 2], final: true, rows: [{ slot: 0, values: [{ value: 81, max: 100 }, 7.5, "x", 3, 4, 5, 6, 7], mark: true, extra: 1 }, ...Array.from({ length: 9 }, (_, i) => ({ slot: null, name: `Bot ${i}`, values: [i] }))] });
ok("② 줄 8개·값 6개 넘는 것 버림·정수 아닌 값 0·{value,max} 막대·모르는 키 무시", s1.rows.length === 8 && s1.rows[0].values.length === 6 && s1.rows[0].values[0] === (81 | (100 << 16)) && s1.rows[0].values[1] === 0 && s1.rows[0].values[2] === 0 && !("extra" in s1.rows[0]), JSON.stringify(s1.rows[0]));
ok("② null → 표 없음 · 틀린 구조 → 무시", scriptBoard(null) === null && scriptBoard({ rows: 3 }) === undefined && scriptBoard("x") === undefined);

// 글 거르기
const evil = "‮evil​<b>x</b>\u0007  닉네임이아주아주길어요";
const clean = cleanText(evil, 12);
ok("글 거르기: 방향 바꾸기·폭 없는 글자·제어 문자 제거, HTML 은 글 그대로, 12자에서 자름(…)", !/[‮​\u0007]/.test(clean) && clean.startsWith("evil<b>x</b") && [...clean].length === 12 && clean.endsWith("…"), clean);

// 합치기
const members = [{ slot: 0, nick: "방장", rtt: null }, { slot: 1, nick: "나‮", rtt: 12 }, { slot: 3, nick: "느림", rtt: 200, stalled: true }];
const gone = new Map([[2, { nick: "나간사람", left: true }]]);
const v = boardView({ config: boardConfig({ multiplayer: { board: { ...webapi.multiplayer.board, sort: { column: "cmds", order: "desc" } } } }), board: { final: false, caption: 1, args: [3, 1], rows: [{ slot: 0, values: [5, 5, 3, 2] }, { slot: 1, values: [50, 50, 1, 0] }, { slot: 2, values: [20, 20, 2, 1] }, { slot: null, nameLabel: 1, values: [30, 30, 2, 0] }] }, members, gone, slot: 1, lang: "en" });
ok("합치기: 정렬(cmds 큰 순)·사람 줄 닉네임·AI 이름(설명서 names)·머리 글", v.rows.map((r) => r.key).join() === "p1,a3,p2,p0" && v.rows[0].name === "나" && v.rows[1].name === "Bot" && v.caption === "3 players · round 1", `${v.rows.map((r) => `${r.key}:${r.name}`).join(" ")} · ${v.caption}`);
ok("합치기: 나간 사람 = 기억한 닉네임 + 나감 · 지연 품질 · 방장 줄 지연 비움 · 순위 글(en)", v.rows[2].name === "나간사람" && v.rows[2].conn.kind === "left" && v.rows[0].conn.q === "good" && v.rows[3].conn.kind === "ok" && !v.rows[3].conn.ms && v.rows[0].cells[2].text === "1st");
const plain = boardView({ members, gone, slot: 1 });
ok("게임 값 없음: 사람 줄만(자리 순)·연결 상태(잠시 멈춤)", plain.plain && plain.rows.length === 3 && plain.rows[2].conn.kind === "stall" && plain.rows.every((r) => r.cells.length === 0));
const selfView = boardView({ config: self, selfRows: new Map([[0, decodeRow(encodeRow({ slot: 0, values: [10, 100, 2] }), 0)], [1, decodeRow(encodeRow({ slot: 1, values: [30, 90, 1] }), 1)]]), members: members.slice(0, 2), slot: 1, lang: "ko" });
ok("scope self: 기기별 줄 모으기·sent 큰 순", selfView.rows.map((r) => r.slot).join() === "1,0" && selfView.rows[0].cells[1].text === "F90", selfView.rows.map((r) => `${r.slot}:${r.cells.map((c) => c.text ?? c.value).join("/")}`).join(" "));

// 세션 BOARD_ROW 중계(가짜 데이터 채널)
const sent = { 1: [], 2: [] };
const host = new NetSession({ role: "make", nick: "H", max: 4, sink: { event() {}, deliver() {}, change() {} }, makePeer: () => ({}) });
host.start();
const link = (slot) => ({ slot, ready: true, state: "joined", dc: { readyState: "open", send: (b) => sent[slot].push(new Uint8Array(b)) } });
for (const s of [1, 2]) {
  host.links.set(s, link(s));
  host.members.set(s, { nick: `G${s}`, lastSeen: host.now(), rtt: 5 });
}
const row = encodeRow({ slot: 1, values: [7, 8, 1] });
const packet = new Uint8Array(4 + 48);
packet[0] = 0x15;
packet[1] = 1;
packet.set(row, 4);
await host.onHostMessage(host.links.get(1), packet);
ok("scope self 중계: 손님 줄 → 방장 저장 → 다른 손님에게만 전달(보낸 사람 자리 붙임)", host.rows.get(1)?.length === 48 && sent[2].length === 1 && sent[2][0][1] === 1 && sent[1].length === 0);
const tooBig = new Uint8Array(4 + 60);
tooBig[0] = 0x15;
await host.onHostMessage(host.links.get(2), tooBig);
ok("scope self 중계: 길이 틀린 줄 버림", !host.rows.has(2) && sent[1].length === 0);
host.setRow(encodeRow({ slot: 0, values: [1] }));
ok("방장 자기 줄 → 모두에게", sent[1].length === 1 && sent[2].length === 2 && host.rows.has(0));
host.drop(2, 6);
ok("나감 → 줄 지움·닉네임 기억(나감)", !host.rows.has(2) && host.gone.get(2)?.nick === "G2" && host.gone.get(2).left === true);
host.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
