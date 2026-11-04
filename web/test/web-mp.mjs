// 웹 webGBA 멀티플레이 MP2 시험 — 짝 찾기 서버(방 코드·근처 방)로 페이지 2~4개를 잇는다.
//   node web/test/web-mp.mjs --webapi <net-webapi 예제 폴더> [--browser chrome|edge] [--shots <캡처 폴더>] [--out <결과 json>]
//   [--capture <폴더>] = 기능 캡처(설정 멀티플레이 항목·상태 메뉴 끊김 줄). [--base https://webgba.vercel.app/] 를 주면 로컬 서버 대신 그 주소(실제 서버)로 방 코드·근처 방 연결 1회만 확인한다.
// 로컬은 tools/test/mp-local.mjs(web/dist + /api/v1/mp + 메모리 가짜 Upstash). PLAYWRIGHT_DIR 가 없으면 저장소 node_modules.
//   [--only base,rejoin,hostback,wan,ice,anytime] 로 묶음을 고른다(기본 전부). rejoin = 다시 들어오기(손님 끊김 20초·ICE 재시작·방장 끊김·선택 안 한 게임),
//   hostback = 방장 돌아오기(결정 174 가: 방장 페이지 닫기 → 유저 '방장을 기다리는 중'·게임 멈춤 → 같은 맥락에 새 페이지·같은 게임 → '이전 방으로 돌아가기' →
//   같은 방 코드·유저 자동 재연결·상태 해시 같음(2명·4명), 2분 넘김 = 세션 끝, 다른 게임 = 표시 없음, rejoin 없는 게임 = 기존 그대로),
//   seat = 유저 돌아오기(유저 페이지 닫기 → 방장이 자리 보관 → 같은 맥락에 새 페이지·같은 게임 → '이전 방으로 돌아가기' → 같은 자리 REJOINED·방장 BACK·상태 해시 같음,
//   방 만들기를 고르면 이전 자리 기록 삭제·방장 쪽 자리 비움(LEAVE), 방 나가기 = 기록 삭제),
//   wan = 인터넷 연결(멀티 켬이면 항상: STUN 후보·코드·기본 TURN 발급 요청, 멀티 끔 = 창 안 열림, 설정 줄 없음), ice = 게임별 연결 서버(credentialUrl 정상·시간 초과·잘못된 응답, 기본 TURN 미사용),
//   anytime = 중간 참가 게임(join: "anytime" — 창 자동 열림·시간 초과 없음, 방장 혼자 창 닫기·방 유지 Upstash 명령 수, 손님 참가 알림, 다시 들어오기·인터넷 연결과 함께).
//   nosave = 세션 중 퀵슬롯·자동 저장 막음(혼자 = 그대로, 방장 혼자 받는 중·2명·다시 들어오기 대기 = 버튼 끔 모양·클릭·탭 알림·포커스·눌림 없음·자동 저장 건너뜀, 세션 끝 = 다시 동작, 상단 버튼 잉크 위·아래 차이 0).
//   rs = RS 버튼 입력이 멀티플레이에서 일반 입력과 같은 길로 들어가는지(유저 RS = B → 16KB 방송이 방장에 도착, 방장 RS = START → 라운드 시작·끝, 두 기기 해시 같음).
//   크롬 개발자 도구의 오프라인은 WebRTC 를 끊지 않으므로, 끊김은 페이지의 RTCPeerConnection 을 감싸 채널 송수신을 막고(window.__netCut)
//   동시에 오프라인(context.setOffline)으로 서버 요청도 막아 흉내 낸다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startLocal } from "../../tools/test/mp-local.mjs";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const BROWSERS = { chrome: "C:/Program Files/Google/Chrome/Application/chrome.exe", edge: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" };
const which = opt.browser ?? "chrome";
const SHOTS = opt.shots ?? "";
const CAPTURE = opt.capture ?? "";
const REMOTE = opt.base ?? "";
const ONLY = new Set(String(opt.only ?? "base,rejoin,hostback,seat,wan,ice,anytime,nosave,rs").split(","));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
if (CAPTURE) fs.mkdirSync(CAPTURE, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name: `[${which}${REMOTE ? " 실제" : ""}] ${name}`, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} [${which}] ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, ms = 15000, step = 150) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(step);
  }
  return last;
}

const local = REMOTE ? null : await startLocal();
const BASE = REMOTE || local.base;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const webapiArgs = { wasm: fs.readFileSync(path.join(opt.webapi, "game.wasm")), manifest: readJson(path.join(opt.webapi, "manifest.json")) };
const files = {
  webapi: (await packWgba(webapiArgs)).bytes,
  variant: (await packWgba({ ...webapiArgs, data: [{ name: "other", bytes: new Uint8Array([1, 2, 3]) }] })).bytes,
  pair: (await packWgba({ ...webapiArgs, manifest: { ...webapiArgs.manifest, id: "com.example.netpair", multiplayer: { ...webapiArgs.manifest.multiplayer, players: { min: 2, max: 2 }, purposes: [{ ...webapiArgs.manifest.multiplayer.purposes[0], players: [2, 2] }] } } })).bytes,
  rejoin: (await packWgba({ ...webapiArgs, manifest: { ...webapiArgs.manifest, id: "com.example.netrejoin", multiplayer: { ...webapiArgs.manifest.multiplayer, rejoin: true } } })).bytes,
  iced: (await packWgba({ ...webapiArgs, manifest: { ...webapiArgs.manifest, id: "com.example.netice", multiplayer: { ...webapiArgs.manifest.multiplayer, iceServers: [{ urls: "stun:stun.example.test:3478" }, { urls: ["turn:turn.example.test:3478?transport=udp"], credentialUrl: "https://cred.example.test/turn" }] } } })).bytes,
  anytime: (await packWgba({ ...webapiArgs, manifest: { ...webapiArgs.manifest, id: "com.example.netanytime", multiplayer: { ...webapiArgs.manifest.multiplayer, join: "anytime" } } })).bytes,
  anytimeRejoin: (await packWgba({ ...webapiArgs, manifest: { ...webapiArgs.manifest, id: "com.example.netanytimerj", multiplayer: { ...webapiArgs.manifest.multiplayer, join: "anytime", rejoin: true } } })).bytes,
};

const browser = await chromium.launch({ executablePath: BROWSERS[which], headless: true });
const peers = [];

// The page's RTCPeerConnection is wrapped: every config is recorded, and window.__netCut drops channel traffic both ways.
function rtcWrap() {
  const Real = window.RTCPeerConnection;
  if (!Real || window !== window.top) return;
  window.__netCut = false;
  window.__rtcConfigs = [];
  const wrapChannel = (dc) => {
    const send = dc.send.bind(dc);
    dc.send = (data) => (window.__netCut ? undefined : send(data));
    let handler = null;
    Object.defineProperty(dc, "onmessage", { configurable: true, get: () => handler, set: (fn) => (handler = fn) });
    dc.addEventListener("message", (event) => {
      if (!window.__netCut && handler) handler.call(dc, event);
    });
    return dc;
  };
  class Wrapped extends Real {
    constructor(config) {
      if (window.__forceRelay) config = { ...config, iceTransportPolicy: "relay" };
      window.__rtcConfigs.push(JSON.parse(JSON.stringify(config ?? {})));
      super(config);
      let handler = null;
      Object.defineProperty(this, "ondatachannel", { configurable: true, get: () => handler, set: (fn) => (handler = fn) });
      this.addEventListener("datachannel", (event) => {
        wrapChannel(event.channel);
        handler?.call(this, event);
      });
    }
    createDataChannel(...args) {
      return wrapChannel(super.createDataChannel(...args));
    }
  }
  window.RTCPeerConnection = Wrapped;
}

async function peer(name, { nick = "", ip = "", prefs = {}, touch = false } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: touch });
  await context.addInitScript(rtcWrap);
  await context.addInitScript(({ nick, prefs }) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (nick) localStorage.setItem("webgba.prefs", JSON.stringify({ netNick: nick, lang: "ko", ...prefs }));
  }, { nick, prefs });
  if (ip && !REMOTE) await context.route("**/api/**", (route) => route.continue({ headers: { ...route.request().headers(), "x-test-ip": ip } }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (opt.verbose) page.on("console", (m) => /멀티플레이/.test(m.text()) && console.log(`  [${name}] ${m.text().slice(0, 300)}`));
  await page.goto(BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  const p = { name, context, page, errors };
  peers.push(p);
  return p;
}

async function open(p, kind = "webapi") {
  const b64 = Buffer.from(files[kind]).toString("base64");
  await p.page.evaluate(async ({ b64, kind }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], kind === "webapi" ? "net-demo.wgba" : `net-demo-${kind}.wgba`)]);
  }, { b64, kind });
  await p.page.waitForFunction(() => window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 20000 });
}

async function want(p) {
  await p.page.evaluate(() => {
    window.webgba.player.keyDown("KeyZ");
    setTimeout(() => window.webgba.player.keyUp("KeyZ"), 120);
  });
  await p.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
}

const game = (p) =>
  p.page.evaluate(() => {
    const ex = window.webgba.player.host?.ex;
    return ex?.Net_Hash ? { open: ex.Net_Open(), count: ex.Net_Count(), slot: ex.Net_Slot(), closed: ex.Net_Closed() } : null;
  });
const calls = (p) => p.page.evaluate(() => window.webgba.net.win.signal?.calls ?? 0);
const text = (p, sel) => p.page.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const errorText = (p) => p.page.evaluate(() => {
  const n = document.querySelector("#sheetBody .net-banner");
  return n && !n.hidden ? n.textContent : "";
});
// 연결 창 탭 B: 방 만들기 탭(마지막 탭 기억) → 방 만들기
async function makeRoom(p) {
  const tab = await p.page.$('[data-action="net-tab-make"]');
  if (tab && (await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await p.page.click('[data-action="net-room-make"]');
}
async function shot(p, name) {
  if (!SHOTS) return;
  await sleep(300);
  await p.page.screenshot({ path: path.join(SHOTS, name) });
}
const roomCode = (p) => waitFor(async () => {
  const t = await text(p, ".net-room-code");
  return /^\d{6}$/.test(t) ? t : "";
}, 12000);
const stats = () => (local ? local.fake.stats().total : 0);

try {
  if (ONLY.has("base")) await baseTests();
  if (ONLY.has("rejoin") && !REMOTE) await rejoinTests();
  if (ONLY.has("hostback") && !REMOTE) await hostBackTests();
  if (ONLY.has("seat") && !REMOTE) await seatTests();
  if (ONLY.has("wan")) await wanTests();
  if (ONLY.has("ice") && !REMOTE) await iceTests();
  if (opt.turn && !REMOTE) await turnTests();
  if (ONLY.has("anytime") && !REMOTE) await anytimeTests();
  if (ONLY.has("nosave") && !REMOTE) await nosaveTests();
  if (ONLY.has("rs") && !REMOTE) await rsTests();
  for (const p of peers) if (p.errors.length) ok(`페이지 오류 없음 ${p.name}`, false, p.errors.slice(0, 3).join(" | "));
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close().catch(() => {});
  await local?.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${which}: ${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);

async function baseTests() {
  // ── 방장 + 근처 방으로 1명 ──
  const H = await peer("H", { nick: "방장 4821" });
  const G1 = await peer("G1", { nick: "손님 7730" });
  for (const p of [H, G1]) await open(p);
  await want(H);
  const empty = await waitFor(async () => /없습니다|No open|ありません|불러오지/.test(await text(H, ".net-near-box")) && text(H, ".net-near-box"), 8000);
  ok("첫 화면: 근처 방 영역(방 없음 안내)", /없습니다|No open|ありません/.test(empty ?? ""), empty);
  const c0 = stats();
  const h0 = await calls(H);
  const t0 = Date.now();
  await makeRoom(H);
  const code = await roomCode(H);
  ok("방 만들기 → 방 코드 6자리", /^\d{6}$/.test(code), code);
  await shot(H, "방코드_390x844.png");
  const g0 = await calls(G1);
  await want(G1);
  const listed = await waitFor(() => G1.page.$(`[data-action="net-near-join"][data-room="${code}"]`), 10000);
  ok("다른 페이지 근처 방 목록에 방 표시(닉네임·인원)", Boolean(listed), await text(G1, ".net-near"));
  await shot(G1, "근처방_첫화면_390x844.png");
  await G1.page.click(`[data-action="net-near-join"][data-room="${code}"]`);
  const both = await waitFor(async () => (await game(H))?.count === 2 && (await game(G1))?.open === 1, 25000, 200);
  const ms = Date.now() - t0;
  const hCalls = (await calls(H)) - h0;
  const gCalls = (await calls(G1)) - g0;
  const cmd = stats() - c0;
  ok(`근처 방으로 2명 연결(${ms}ms · API 방장 ${hCalls}·손님 ${gCalls}회${local ? ` · Redis ${cmd}명령` : ""})`, both, JSON.stringify({ host: await game(H), guest: await game(G1) }));
  const closedG = await waitFor(async () => (await G1.page.evaluate(() => window.webgba.state.sheet)) === "", 5000);
  ok("손님 창은 연결 뒤 저절로 닫힘", Boolean(closedG));
  const hostNote = await text(H, "#sheetBody .net-note");
  const closedH = await waitFor(async () => (await H.page.evaluate(() => window.webgba.state.sheet)) === "", 4000, 100);
  const hostActive = await H.page.evaluate(() => Boolean(window.webgba.net.win.roomHost?.active && window.webgba.net.win.roomHost.running));
  ok("방장 창(최소 2 < 최대 4): 최소 인원에 닿으면 연결됨 표시 → 1초 뒤 저절로 닫힘 · 방 코드 받기는 최대 인원까지 계속", Boolean(closedH) && hostActive, `${hostNote} · 받기 ${hostActive}`);

  for (const name of REMOTE ? ["G2"] : ["G2", "G3"]) {
    const G = await peer(name, { nick: `손님 ${name}` });
    await open(G);
    await want(G);
    await G.page.click('[data-action="net-room-join"]');
    await G.page.fill('[data-action="net-code-in"]', code);
    if (name === "G2") await shot(G, "코드로_들어가기_390x844.png");
    const c1 = await calls(G);
    const h1 = await calls(H);
    const t1 = Date.now();
    await G.page.click('[data-action="net-code-go"]');
    const joined = await waitFor(async () => (await game(G))?.open === 1, 25000, 200);
    ok(`방 코드로 ${name} 연결(${Date.now() - t1}ms · API 방장 ${(await calls(H)) - h1}·손님 ${(await calls(G)) - c1}회)`, joined, JSON.stringify(await game(G)));
  }

  if (!REMOTE) {
    const four = await waitFor(async () => (await game(H))?.count === 4, 8000);
    ok("4명 연결(방장 기준)", Boolean(four));
    const parked = await waitFor(() => H.page.evaluate(() => window.webgba.net.win.roomHost?.parked === true && window.webgba.state.sheet === ""), 5000);
    ok("창이 닫힌 채 방 코드로 3·4번째 연결 · 가득 참(4/4) → 방장 받기 멈춤", Boolean(parked));
    await sleep(600);
    const bar = await H.page.evaluate(() =>
      [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null && !n.closest(".bar__group--files")).map((n) => {
        const r = n.getBoundingClientRect();
        const c = n.querySelector("canvas")?.getBoundingClientRect() ?? r;
        return { id: n.id, top: r.top, bottom: r.bottom, ct: c.top, cb: c.bottom, badge: n.querySelector(".tool__badge:not([hidden])")?.textContent ?? "" };
      }),
    );
    const spread = (k) => Math.max(...bar.map((b) => b[k])) - Math.min(...bar.map((b) => b[k]));
    ok("세션 중 상단 버튼 줄(멀티플레이 켜짐·배지 4/4): 위·아래 차이 0", bar.some((b) => b.id === "btnNet" && b.badge === "4/4") && spread("top") === 0 && spread("bottom") === 0 && spread("ct") === 0 && spread("cb") === 0, JSON.stringify(bar.map((b) => `${b.id}:${b.top}-${b.bottom}${b.badge ? `(${b.badge})` : ""}`)));
    await shot(H, "세션중_상단버튼_390x844.png");

    // ── 최소 = 최대(2명, 교환처럼): 연결되면 방장 창도 1초 뒤 닫힘 ──
    const A = await peer("A", { nick: "교환 방장" });
    const B = await peer("B", { nick: "교환 손님" });
    for (const p of [A, B]) await open(p, "pair");
    await want(A);
    await makeRoom(A);
    const codeP = await roomCode(A);
    await want(B);
    await B.page.click('[data-action="net-room-join"]');
    await B.page.fill('[data-action="net-code-in"]', codeP);
    await B.page.click('[data-action="net-code-go"]');
    const pairOn = await waitFor(async () => (await game(A))?.count === 2 && (await game(B))?.open === 1, 25000, 200);
    const tJoin = Date.now();
    const pairClosed = await waitFor(async () => (await A.page.evaluate(() => window.webgba.state.sheet)) === "" && (await B.page.evaluate(() => window.webgba.state.sheet)) === "", 4000, 100);
    const pairInfo = await A.page.evaluate(() => ({ badge: document.querySelector("#btnNet .tool__badge:not([hidden])")?.textContent ?? "", polling: Boolean(window.webgba.net.win.roomHost?.timer) }));
    ok("최소 = 최대(2명): 방 코드로 연결 → 방장·손님 창 모두 1초 뒤 저절로 닫힘 · 배지 2/2 · 방장 받기 없음", pairOn && pairClosed && pairInfo.badge === "2/2" && !pairInfo.polling, `${Date.now() - tJoin}ms · ${JSON.stringify(pairInfo)}`);
    await A.context.close();
    await B.context.close();

    // ── 다른 버전: 흐림 표시·거부 ──
    const H2 = await peer("H2", { nick: "방장 2" });
    await open(H2);
    await want(H2);
    await makeRoom(H2);
    const code2 = await roomCode(H2);
    const X = await peer("X", { nick: "다른 버전" });
    await open(X, "variant");
    await want(X);
    const dim = await waitFor(() => X.page.$(".net-near__row.is-dim"), 10000);
    const dimText = dim ? await dim.textContent() : "";
    ok("다른 버전 방은 근처 목록에 흐리게(들어가기 없음)", Boolean(dim) && /다른 버전/.test(dimText) && !(await X.page.$(`[data-room="${code2}"]`)), dimText);
    await X.page.click('[data-action="net-room-join"]');
    await X.page.fill('[data-action="net-code-in"]', code2);
    await X.page.click('[data-action="net-code-go"]');
    const xe = await waitFor(() => errorText(X).then((e) => (/다른 게임/.test(e) ? e : "")), 8000);
    ok("다른 버전 방 코드 → 서버가 거부(다른 게임 파일 안내)", Boolean(xe), xe);
    const bad = await (async () => {
      await X.page.fill('[data-action="net-code-in"]', "000001");
      await X.page.click('[data-action="net-code-go"]');
      return waitFor(() => errorText(X).then((e) => (/찾지 못했/.test(e) ? e : "")), 8000);
    })();
    ok("없는 방 코드 → '방을 찾지 못했습니다'", Boolean(bad), bad);
    await H2.page.click('[data-action="net-cancel"]');
    const gone = await waitFor(async () => {
      await X.page.click('[data-action="net-near-refresh"]');
      await sleep(200);
      const t = await X.page.evaluate(() => document.querySelector(".net-near-box")?.textContent ?? "");
      return /다른 버전/.test(t) ? "" : t || " ";
    }, 12000, 1500);
    ok("방장 취소 → 근처 목록에서 빠짐", Boolean(gone), gone);
    await X.context.close();
    await H2.context.close();

    // ── 서버 한도 초과 → 연결 코드·QR 자동 안내 ──
    local.fake.fail("quota");
    const F = await peer("F", { nick: "방장 F", ip: "198.51.100.5" });
    await open(F);
    await want(F);
    const nearFail = await waitFor(async () => /불러오지 못했/.test(await text(F, ".net-near-box")), 8000);
    ok("서버 한도 초과: 근처 방 영역에 '인터넷 없이 연결' 안내", Boolean(nearFail), await text(F, ".net-near-box"));
    await makeRoom(F);
    const offer = await waitFor(() => F.page.evaluate(() => document.querySelector('[data-action="net-offer"]')?.value ?? ""), 10000);
    const note = await F.page.evaluate(() => [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" "));
    ok("서버 한도 초과: 방 만들기 → 연결 코드 화면으로 자동 전환(안내 문구)", Boolean(offer) && /연결 코드로 연결합니다/.test(note), note);
    await shot(F, "서버한도_연결코드안내_390x844.png");
    local.fake.fail("");
    await F.context.close();

    // ── 오프라인 ──
    const O = await peer("O");
    await open(O);
    await O.context.setOffline(true);
    await want(O);
    const off = await waitFor(async () => /인터넷에 연결되어 있지 않습니다/.test(await text(O, ".net-near-box")), 6000);
    ok("오프라인: 근처 방 영역에 연결 코드·QR 안내", Boolean(off), await text(O, ".net-near-box"));
    await O.page.click('[data-action="net-room-join"]');
    await O.page.fill('[data-action="net-code-in"]', "123456");
    await O.page.click('[data-action="net-code-go"]');
    const offBtn = await waitFor(() => O.page.evaluate(() => {
      const n = document.querySelector('[data-action="net-offline"]');
      return n && n.offsetParent !== null;
    }), 5000);
    ok("오프라인: 코드로 들어가기 실패 → '인터넷 없이 연결' 버튼 표시", Boolean(offBtn), await errorText(O));
    await O.context.close();

    const sw = await H.page.evaluate(async () => {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const keys = await caches.keys();
      let hit = 0;
      for (const k of keys) for (const r of await (await caches.open(k)).keys()) if (new URL(r.url).pathname.startsWith("/api/")) hit++;
      return { sw: Boolean(reg), cached: hit };
    });
    ok("Service Worker 캐시에 /api/ 없음", sw.cached === 0, JSON.stringify(sw));
    const api = local.apiCalls.filter((c) => c.status >= 500 && c.status !== 503);
    ok("API 500 오류 없음", api.length === 0, JSON.stringify(api.slice(0, 3)));
  }
}

async function events(p) {
  return p.page.evaluate(() => {
    const ex = window.webgba.player.host?.ex;
    if (!ex?.Net_EventCount) return [];
    const n = ex.Net_EventCount();
    const out = [];
    for (let i = Math.max(0, n - 32); i < n; i++) {
      const v = ex.Net_Event(i) >>> 0;
      out.push({ k: v >>> 24, a: (v >>> 16) & 255, b: v & 0xffff });
    }
    return out;
  });
}

async function cut(p, on) {
  await p.page.evaluate((v) => {
    window.__netCut = v;
  }, on);
  await p.context.setOffline(on);
}

function snap(p) {
  return p.page.evaluate(() => {
    const s = window.webgba.player.net.snapshot();
    return { active: s.active, connected: s.connected, rejoining: s.rejoining, rejoinable: s.rejoinable, state: s.rejoinState, slot: s.slot, count: s.count, hostWait: s.hostWait, hostLeft: s.hostLeft, members: s.members.map((m) => ({ slot: m.slot, held: m.held, stalled: m.stalled, rejoining: m.rejoining })) };
  });
}

function sheetOf(p) {
  return p.page.evaluate(() => window.webgba.state.sheet);
}
function press(p, code) {
  return p.page.evaluate((c) => {
    window.webgba.player.keyDown(c);
    setTimeout(() => window.webgba.player.keyUp(c), 120);
  }, code);
}
function bigOk(p) {
  return p.page.evaluate(() => window.webgba.player.host.ex.Net_BigOk());
}
function kindsOf(list, k, a) {
  return list.filter((e) => e.k === k && (a === undefined || e.a === a)).length;
}

async function room(H, guests, kind) {
  await open(H, kind);
  await want(H);
  await makeRoom(H);
  const code = await roomCode(H);
  for (const G of guests) {
    await open(G, kind);
    await want(G);
    await G.page.click('[data-action="net-room-join"]');
    await G.page.fill('[data-action="net-code-in"]', code);
    await G.page.click('[data-action="net-code-go"]');
    await waitFor(async () => (await game(G))?.open === 1, 25000, 200);
  }
  await waitFor(async () => (await game(H))?.count === guests.length + 1, 10000);
  for (const p of [H, ...guests]) await waitFor(async () => (await sheetOf(p)) === "", 5000);
  return code;
}

async function rejoinTests() {
  const H = await peer("RH", { nick: "방장 R" });
  const A = await peer("RA", { nick: "손님 A" });
  const B = await peer("RB", { nick: "손님 B" });
  const s0 = stats();
  await room(H, [A, B], "rejoin");
  const setup = stats() - s0;
  const keys = await A.page.evaluate(() => ({ key: Boolean(window.webgba.player.net.session?.rejoinKey), on: window.webgba.player.net.session?.rejoinable === true }));
  const hostOn = await H.page.evaluate(() => window.webgba.player.net.session?.rejoinable === true && window.webgba.net.win.roomHost?.rejoin === true);
  ok(`다시 들어오기 게임: 방 코드로 3명 · 방장·손님 다시 들어오기 켜짐(자리 열쇠) · 연결까지 Upstash ${setup}명령`, keys.key && keys.on && hostOn && (await game(H))?.count === 3, JSON.stringify(keys));

  if (!opt.fast) {
  // ── 손님 끊김 20초 → 복귀 → 같은 자리 ──
  const aSlot = (await snap(A)).slot;
  const c0 = stats();
  const api0 = local.apiCalls.length;
  const t0 = Date.now();
  await cut(A, true);
  const held = await waitFor(async () => (await snap(H)).members.find((m) => m.slot === aSlot)?.held, 22000, 250);
  const heldMs = Date.now() - t0;
  const hEv = await events(H);
  const bEv = await events(B);
  ok(`손님 끊김 ${(heldMs / 1000).toFixed(1)}초 → 방장이 자리 보관 · HOLD 사건(방장·다른 손님)`, held && heldMs >= 14000 && kindsOf(hEv, 7, aSlot) && kindsOf(bEv, 7, aSlot), JSON.stringify({ h: hEv.slice(-3), b: bEv.slice(-3) }));
  const aRej = await waitFor(async () => (await snap(A)).rejoining, 8000);
  const aEv = await events(A);
  await waitFor(async () => (await sheetOf(A)) === "net", 4000);
  const aWin = await A.page.evaluate(() => ({ sheet: window.webgba.state.sheet, state: document.querySelector("#sheetBody .net-rejoin-state")?.textContent ?? "", now: Boolean(document.querySelector('[data-action="net-rejoin-now"]')), solo: Boolean(document.querySelector('[data-action="net-solo"]')) }));
  ok("끊긴 손님: HOLD(내 자리) · 연결 창 자동 표시('인터넷 연결을 기다리는 중' · 다시 들어가기 · 혼자 이어 하기)", aRej && kindsOf(aEv, 7, aSlot) && aWin.sheet === "net" && aWin.now && aWin.solo && /인터넷 연결을 기다리는/.test(aWin.state), JSON.stringify(aWin));
  if (SHOTS) await A.page.screenshot({ path: path.join(SHOTS, "다시연결_연결창_390x844.png") });
  await H.page.evaluate(() => window.webgba.net.board.open());
  await sleep(700);
  const row = await H.page.evaluate(() => [...document.querySelectorAll("#board .mpb__row")].map((r) => r.textContent).find((t) => /손님 A/.test(t)) ?? "");
  ok("방장 상태 메뉴: 끊긴 자리 줄 '끊김 · 기다리는 중'", /끊김 · 기다리는 중/.test(row), row);
  if (CAPTURE) await H.page.screenshot({ path: path.join(CAPTURE, "상태메뉴_끊김줄_390x844.png") });
  await H.page.evaluate(() => window.webgba.net.board.close());
  await A.page.evaluate(() => window.webgba.net.win.requestClose());
  await A.page.evaluate(() => window.webgba.net.board.open());
  await sleep(700);
  const bar = await A.page.evaluate(() => {
    const box = document.querySelector("#board .mpb__rejoin");
    const btns = [...document.querySelectorAll("#board .mpb__rejoinActions .btn")].map((n) => n.getBoundingClientRect());
    const me = [...document.querySelectorAll("#board .mpb__row.is-me")].map((r) => r.textContent).join("");
    return { shown: Boolean(box && !box.hidden), text: document.querySelector("#board .mpb__rejoinText")?.textContent ?? "", tops: btns.map((r) => r.top), bottoms: btns.map((r) => r.bottom), me };
  });
  ok("끊긴 손님 상태 메뉴: 다시 연결 줄(글 + 다시 들어가기·혼자 이어 하기, 버튼 위·아래 차이 0) · 내 줄 '다시 연결하는 중…'", bar.shown && bar.tops.length === 2 && bar.tops[0] === bar.tops[1] && bar.bottoms[0] === bar.bottoms[1] && /다시 연결하는 중/.test(bar.me), JSON.stringify(bar));
  if (SHOTS) await A.page.screenshot({ path: path.join(SHOTS, "다시연결_상태메뉴_390x844.png") });
  await A.page.evaluate(() => window.webgba.net.board.close());
  await sleep(Math.max(0, 20000 - (Date.now() - t0)));
  const t1 = Date.now();
  await cut(A, false);
  const back = await waitFor(async () => {
    const s = await snap(A);
    return s.connected && !s.rejoining && s.slot === aSlot;
  }, 40000, 250);
  const backMs = Date.now() - t1;
  const hEv2 = await events(H);
  const aEv2 = await events(A);
  const bEv2 = await events(B);
  const hostView = (await snap(H)).members.find((m) => m.slot === aSlot);
  ok(`복귀 ${(backMs / 1000).toFixed(1)}초 뒤 같은 자리(${aSlot + 1}P)로 들어옴 · REJOINED(손님)·BACK(방장·다른 손님)`, back && kindsOf(aEv2, 9, aSlot) && kindsOf(hEv2, 8, aSlot) && kindsOf(bEv2, 8, aSlot) && hostView && !hostView.held, JSON.stringify({ a: aEv2.slice(-3), h: hEv2.slice(-3) }));
  const cmd = stats() - c0;
  const rj = local.apiCalls.slice(api0).filter((c) => c.op === "rj").length;
  ok(`다시 들어오기 1회(끊김 20초 포함) Upstash ${cmd}명령 · rj 요청 ${rj}회`, cmd > 0 && cmd < 80, `${cmd}`);
  const winGone = await waitFor(async () => (await sheetOf(A)) === "", 4000);
  ok("돌아온 손님 연결 창: '다시 들어왔습니다' 뒤 저절로 닫힘", Boolean(winGone));
  const big0 = await bigOk(H);
  await press(A, "KeyX");
  ok("돌아온 손님의 16KB 순서 방송을 방장이 받음", await waitFor(async () => (await bigOk(H)) > big0, 8000));
  await A.page.evaluate(() => {
    const g = window.webgba.player.net.game;
    const real = g.deliver.bind(g);
    window.__got = [];
    g.deliver = (from, bytes, state) => {
      if (state) {
        let sum = 0;
        for (const b of bytes) sum = (sum + b) % 65521;
        window.__got.push({ from, len: bytes.length, sum });
        return true;
      }
      return real(from, bytes, state);
    };
  });
  const sent = await H.page.evaluate((to) => {
    const all = Uint8Array.from({ length: 40000 }, (_, i) => (i * 13 + 7) & 255);
    let sum = 0;
    for (const b of all) sum = (sum + b) % 65521;
    const net = window.webgba.player.net;
    net.statePart({ to, part: 1, bytes: all.slice(0, 16384) });
    net.statePart({ to, part: 1, bytes: all.slice(16384, 32768) });
    net.statePart({ to, part: 2, bytes: all.slice(32768) });
    return sum;
  }, aSlot);
  const got = await waitFor(() => A.page.evaluate(() => window.__got?.[0] ?? null), 5000);
  ok("상태 묶음: 방장 → 돌아온 자리 40000바이트(기록 3조각 → 채널 3조각) → 한 묶음으로 받음(보낸 자리 0·내용 같음)", got && got.from === 0 && got.len === 40000 && got.sum === sent, JSON.stringify({ got, sent }));

  }
  // ── ICE 재시작(주소 바뀜 흉내) ──
  const bSlot = (await snap(B)).slot;
  const ufrag = (p) => p.page.evaluate(() => /a=ice-ufrag:(\S+)/.exec(window.webgba.player.net.session?.link?.pc?.remoteDescription?.sdp ?? "")?.[1] ?? "");
  const u0 = await ufrag(B);
  const r0 = await H.page.evaluate(() => window.webgba.player.net.session.stats.restarts);
  const hold0 = kindsOf(await events(H), 7, bSlot);
  const c1 = stats();
  const t4 = Date.now();
  await B.page.evaluate(() => {
    window.__netCut = true;
  });
  await waitFor(async () => (await snap(H)).members.find((m) => m.slot === bSlot)?.stalled, 5000, 100);
  await B.page.evaluate(() => window.webgba.player.net.session.helperCall("restart"));
  const restarted = await waitFor(async () => (await ufrag(B)) !== u0 && (await H.page.evaluate(() => window.webgba.player.net.session.stats.restarts)) > r0, 12000, 250);
  const restartMs = Date.now() - t4;
  await B.page.evaluate(() => {
    window.__netCut = false;
  });
  await sleep(1500);
  const sb = await snap(B);
  const big1 = await bigOk(H);
  await press(B, "KeyX");
  const flows = await waitFor(async () => (await bigOk(H)) > big1, 8000);
  ok(`ICE 재시작(주소 바뀜 흉내: 채널 멈춤 → 방장 STALL): 손님 요청 → 방장 답 ${(restartMs / 1000).toFixed(1)}초 → 새 ICE 접속 정보로 같은 연결 유지(보관·다시 들어오기 없음, 메시지 정상) · Upstash ${stats() - c1}명령`, restarted && sb.connected && !sb.rejoining && kindsOf(await events(H), 7, bSlot) === hold0 && flows, JSON.stringify({ restarted, sb: { c: sb.connected, r: sb.rejoining } }));

  if (opt.fast) {
    for (const p of [H, A, B]) await p.context.close();
    return;
  }
  // ── 방장 끊김 20초 → 세션 끝 ──
  const t2 = Date.now();
  await cut(H, true);
  const hostEnd = await waitFor(async () => (await game(H))?.closed === 4, 25000, 250);
  const hostEndMs = Date.now() - t2;
  ok(`방장 끊김 ${(hostEndMs / 1000).toFixed(1)}초 → 방장 세션 끝(CLOSED LOST, 15초 넘는 방장 끊김은 복구 없음)`, hostEnd && hostEndMs >= 14000 && hostEndMs < 21000, `${hostEndMs}`);
  await sleep(Math.max(0, 20000 - (Date.now() - t2)));
  await cut(H, false);
  const guestsEnd = await waitFor(async () => [4, 7].includes((await game(A))?.closed) && [4, 7].includes((await game(B))?.closed), 45000, 500);
  ok(`방장 복귀 뒤 방이 닫혀 손님 세션도 끝(${((Date.now() - t2) / 1000).toFixed(0)}초) → 각자 혼자 이어 함`, guestsEnd, JSON.stringify({ a: await game(A), b: await game(B) }));
  for (const p of [H, A, B]) await p.context.close();

  // ── 다시 들어오기를 선택하지 않은 게임은 그대로 ──
  const P = await peer("PH", { nick: "방장 P" });
  const Q = await peer("PQ", { nick: "손님 Q" });
  await room(P, [Q], "webapi");
  const api1 = local.apiCalls.length;
  const t3 = Date.now();
  await cut(Q, true);
  const left = await waitFor(async () => (await events(P)).some((e) => e.k === 3 && e.b === 4), 22000, 250);
  const leftMs = Date.now() - t3;
  const qClosed = await waitFor(async () => (await game(Q))?.closed === 4, 8000);
  ok(`선택하지 않은 게임: 손님 끊김 ${(leftMs / 1000).toFixed(1)}초 → 방장 LEAVE(LOST)·손님 CLOSED(LOST), HOLD 없음(기존 그대로)`, left && qClosed && !(await events(P)).some((e) => e.k === 7) && !(await events(Q)).some((e) => e.k >= 7), `${leftMs}`);
  const rj2 = local.apiCalls.slice(api1).filter((c) => c.op === "rj").length;
  ok("선택하지 않은 게임은 다시 들어오기 서버 요청 없음", rj2 === 0, `${rj2}`);
  await cut(Q, false);
  for (const p of [P, Q]) await p.context.close();
}

// The example wasm has no state-bundle code, so the page plays that part of a rejoin game:
// BACK(s) on the state holder (host for s > 0, the user webGBA chose for s = 0) → Web_StateSave → bundle to s; a bundle in → Web_StateLoad.
async function stateShim(p) {
  await p.page.evaluate(() => {
    const net = window.webgba.player.net;
    const g = net.game;
    const host = () => window.webgba.player.host;
    window.__shim = { sent: [], got: [] };
    const realEvent = g.event.bind(g);
    g.event = (kind, a, b) => {
      realEvent(kind, a, b);
      const s = net.session;
      if (kind !== 8 || !s || !(s.host ? a !== 0 : a === 0)) return;
      setTimeout(() => {
        const h = host();
        const at = h.ex.Web_Alloc(16);
        h.ex.Web_StateSave(at);
        window.__shim.sent.push({ to: a, hash: h.ex.Net_Hash() >>> 0 });
        net.statePart({ to: a, part: 2, bytes: h.u8.slice(at, at + 16) });
      }, 0);
    };
    const realDeliver = g.deliver.bind(g);
    g.deliver = (from, bytes, state) => {
      if (!state) return realDeliver(from, bytes, state);
      const h = host();
      const at = h.ex.Web_Alloc(bytes.length);
      h.u8.set(bytes, at);
      const loaded = h.ex.Web_StateLoad(at);
      window.__shim.got.push({ from, len: bytes.length, loaded, hash: h.ex.Net_Hash() >>> 0 });
      return true;
    };
  });
}

function hashOf(p) {
  return p.page.evaluate(() => window.webgba.player.host.ex.Net_Hash() >>> 0);
}
function backRecord(p) {
  return p.page.evaluate(() => JSON.parse(localStorage.getItem("webgba.netBack") ?? "null"));
}

// "app restart": a new page in the same browser context keeps localStorage, like reopening the app
async function reopen(H, name) {
  const page = await H.context.newPage();
  const p = { name, context: H.context, page, errors: [] };
  page.on("pageerror", (error) => p.errors.push(error.message));
  await page.goto(BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  peers.push(p);
  return p;
}

async function roundDone(list) {
  await press(list[0], "Enter");
  return waitFor(async () => {
    for (const p of list) if (!(await p.page.evaluate(() => window.webgba.player.host.ex.Net_Ended()))) return false;
    return true;
  }, 30000, 500);
}

async function hostBackRun(guestCount, { crash = false } = {}) {
  const tag = `${guestCount + 1}명${crash ? "(강제 종료)" : ""}`;
  const H = await peer(`BH${guestCount}`, { nick: "방장 B" });
  const guests = [];
  for (let i = 0; i < guestCount; i++) guests.push(await peer(`BG${guestCount}${i}`, { nick: `유저 ${i + 1}` }));
  const code = await room(H, guests, "rejoin");
  for (const p of [H, ...guests]) await stateShim(p);
  const ended = await roundDone([H, ...guests]);
  const hashes = await Promise.all([H, ...guests].map(hashOf));
  const rec = await backRecord(H);
  ok(`${tag}: 라운드 끝 · 모두 같은 상태 해시 · 방장 방 정보 보관(방 코드·방장 증명·자리 ${guestCount}개·시각)`, ended && new Set(hashes).size === 1 && hashes[0] !== 2166136261 && rec?.room === code && rec.slots?.length === guestCount && typeof rec.t === "string" && rec.at > Date.now() - 30000, JSON.stringify({ hashes, rec: rec && { room: rec.room, slots: rec.slots.length } }));

  const api0 = local.apiCalls.length;
  const t0 = Date.now();
  if (crash) {
    const cdp = await H.context.newCDPSession(H.page);
    cdp.send("Page.crash").catch(() => {});
    await sleep(500);
  } else await H.page.close();
  const waiting = await waitFor(async () => {
    for (const g of guests) if (!(await snap(g)).hostWait) return false;
    return true;
  }, crash ? 70000 : 40000, 250);
  const waitMs = Date.now() - t0;
  const awayCalls = local.apiCalls.slice(api0).filter((c) => c.op === "away").length;
  const holdCalls = local.apiCalls.slice(api0).filter((c) => c.op === "hold").length;
  if (crash) ok(`${tag}: pagehide 없이 끊김 → 유저가 ${(waitMs / 1000).toFixed(1)}초 뒤 방장 자리 보관 요청(hold ${holdCalls}회, away ${awayCalls}회) · 대기 화면`, waiting && holdCalls >= 1 && awayCalls === 0, `${waitMs}`);
  const g0 = guests[0];
  const gSlot = (await snap(g0)).slot;
  await waitFor(async () => (await sheetOf(g0)) === "net", 4000);
  await sleep(400);
  const f0 = await g0.page.evaluate(() => window.webgba.player.frameNo);
  await sleep(1500);
  const f1 = await g0.page.evaluate(() => window.webgba.player.frameNo);
  const view = await g0.page.evaluate(() => ({ sheet: window.webgba.state.sheet, state: document.querySelector("#sheetBody .net-rejoin-state")?.textContent ?? "", solo: Boolean(document.querySelector('[data-action="net-solo"]')), now: Boolean(document.querySelector('[data-action="net-rejoin-now"]')), host: [...document.querySelectorAll("#sheetBody .mpb__row")].map((r) => r.textContent)[0] ?? "" }));
  const gEv = await events(g0);
  ok(`${tag}: 방장 페이지 닫기 → ${(waitMs / 1000).toFixed(1)}초 뒤 유저 '방장을 기다리는 중… m:ss 남음' · 혼자 이어 하기만 · 게임 멈춤(프레임 ${f0}→${f1}) · HOLD(내 자리)·HOLD(0) · away ${awayCalls}·hold ${holdCalls}회`, waiting && view.sheet === "net" && /방장을 기다리는 중… [01]:\d\d 남음/.test(view.state) && view.solo && !view.now && f1 === f0 && kindsOf(gEv, 7, 0) && kindsOf(gEv, 7, gSlot) && /끊김 · 기다리는 중/.test(view.host), JSON.stringify({ view, f0, f1 }));
  if (guestCount === 1 && !crash && SHOTS) await g0.page.screenshot({ path: path.join(SHOTS, "유저_방장대기_390x844.png") });
  if (guestCount === 1 && !crash) {
    await g0.page.evaluate(() => window.webgba.net.win.requestClose());
    await g0.page.evaluate(() => window.webgba.net.board.open());
    await sleep(1300);
    const bar = await g0.page.evaluate(() => {
      const box = document.querySelector("#board .mpb__rejoin");
      const btns = [...document.querySelectorAll("#board .mpb__rejoinActions .btn")].filter((n) => !n.hidden).map((n) => n.dataset.action);
      return { shown: Boolean(box && !box.hidden), text: document.querySelector("#board .mpb__rejoinText")?.textContent ?? "", btns };
    });
    ok("유저 상태 메뉴: '방장을 기다리는 중… m:ss 남음' 줄 · 혼자 이어 하기 버튼만", bar.shown && /방장을 기다리는 중… [01]:\d\d 남음/.test(bar.text) && bar.btns.join() === "board-solo", JSON.stringify(bar));
    await g0.page.evaluate(() => window.webgba.net.board.close());
  }

  const t1 = Date.now();
  const H2 = await reopen(H, `BH${guestCount}b`);
  await open(H2, "rejoin");
  const offered = await waitFor(() => H2.page.$('[data-action="net-back"]'), 8000);
  await sleep(300);
  const offer = await H2.page.evaluate(() => ({ sheet: window.webgba.state.sheet, sec: document.querySelector("#sheetBody .net-sec--back")?.textContent ?? "", btn: !document.getElementById("btnNet").hidden }));
  ok(`${tag}: 방장이 다시 열고 같은 게임 → 멀티플레이 창 자동 표시 · 이전 방 ${code} · 유저 ${guestCount}명 · 남은 시간 · '이전 방으로 돌아가기'`, Boolean(offered) && offer.sheet === "net" && offer.sec.includes(code) && offer.sec.includes(`유저 ${guestCount}명`) && /남은 시간 [01]:\d\d/.test(offer.sec) && offer.btn, JSON.stringify(offer));
  if (guestCount === 1 && !crash && SHOTS) await H2.page.screenshot({ path: path.join(SHOTS, "방장_이전방_돌아가기_390x844.png") });
  await stateShim(H2);
  const api1 = local.apiCalls.length;
  await H2.page.click('[data-action="net-back"]');
  const back = await waitFor(async () => {
    const s = await snap(H2);
    return s.connected && s.members.length === guestCount + 1 && s.members.every((m) => !m.held) ? s : null;
  }, 45000, 250);
  const backMs = Date.now() - t1;
  await waitFor(async () => {
    for (const g of guests) if ((await snap(g)).rejoining) return false;
    return true;
  }, 10000);
  await sleep(1500);
  const hash2 = await Promise.all([H2, ...guests].map(hashOf));
  const hEv = await events(H2);
  const shim = await H2.page.evaluate(() => window.__shim);
  const roomNow = await H2.page.evaluate(() => window.webgba.net.win.roomHost?.room ?? "");
  const backCalls = local.apiCalls.slice(api1).filter((c) => c.op === "back").length;
  ok(`${tag}: '이전 방으로 돌아가기' → 같은 방 코드(back ${backCalls}회) · 유저 ${guestCount}명 자동 재연결 ${(backMs / 1000).toFixed(1)}초 · 방장 REJOINED(0) · 상태 묶음 받음 · 모두 같은 상태 해시`, Boolean(back) && roomNow === code && backCalls === 1 && kindsOf(hEv, 9, 0) === 1 && shim.got.length === 1 && shim.got[0].loaded === 1 && new Set(hash2).size === 1 && hash2[0] === hashes[0], JSON.stringify({ roomNow, hash2, got: shim.got, sent: shim.sent }));
  const gEvs = await Promise.all(guests.map(events));
  const srcs = gEvs.filter((list) => kindsOf(list, 8, 0)).length;
  const srcSlot = (await Promise.all(guests.map(snap)))[gEvs.findIndex((list) => kindsOf(list, 8, 0))]?.slot;
  const minSlot = Math.min(...(await Promise.all(guests.map(snap))).map((s) => s.slot));
  ok(`${tag}: 상태 묶음을 보낸 유저 = 가장 작은 자리(${srcSlot + 1}P)`, srcSlot === minSlot, `${srcSlot}/${minSlot}`);
  const others = await Promise.all(guests.map((g) => g.page.evaluate(() => window.__shim.got.filter((x) => x.from === 0).length)));
  const playing = await Promise.all(guests.map(async (g) => {
    const a = await g.page.evaluate(() => window.webgba.player.frameNo);
    await sleep(300);
    return (await g.page.evaluate(() => window.webgba.player.frameNo)) > a;
  }));
  ok(`${tag}: 상태 묶음을 보낸 유저 1명(BACK(0)) · 나머지 ${guestCount - 1}명은 REJOINED(내 자리) 뒤 방장 묶음 받음 · 유저 게임 다시 진행`, srcs === 1 && others.filter((n) => n >= 1).length === guestCount - 1 && playing.every(Boolean) && shim.sent.filter((x) => x.to !== 0).length === guestCount - 1, JSON.stringify({ srcs, others, playing, sent: shim.sent }));
  const big0 = await bigOk(H2);
  await press(g0, "KeyX");
  ok(`${tag}: 돌아온 뒤 유저의 16KB 순서 방송을 방장이 받음`, await waitFor(async () => (await bigOk(H2)) > big0, 8000));
  const rec2 = await backRecord(H2);
  ok(`${tag}: 돌아온 방장도 방 정보 다시 보관(같은 방 코드)`, rec2?.room === code && rec2.slots.length === guestCount, JSON.stringify(rec2 && { room: rec2.room }));
  await H2.page.evaluate(() => window.webgba.player.net.leave());
  await waitFor(async () => (await backRecord(H2)) === null, 5000);
  ok(`${tag}: 방장이 방 나가기 → 보관한 방 정보 삭제 · 유저 세션 끝`, (await backRecord(H2)) === null && (await waitFor(async () => [6, 7].includes((await game(g0))?.closed), 10000)));
  for (const p of [H2, ...guests]) await p.context.close().catch(() => {});
}

async function hostBackTests() {
  await hostBackRun(1);
  await hostBackRun(3);
  await hostBackRun(1, { crash: true });

  // ── 다른 게임으로 열면 표시 안 함 · 2분 넘김 = 세션 끝 ──
  const H = await peer("BHT", { nick: "방장 T" });
  const G = await peer("BGT", { nick: "유저 T" });
  const code = await room(H, [G], "rejoin");
  await H.page.close();
  await waitFor(async () => (await snap(G)).hostWait, 40000, 250);
  const H2 = await reopen(H, "BHT2");
  await open(H2, "webapi");
  await sleep(1500);
  const other = await H2.page.evaluate(() => ({ sheet: window.webgba.state.sheet, back: Boolean(document.querySelector('[data-action="net-back"]')), btn: !document.getElementById("btnNet").hidden }));
  ok("다른 게임(id 다름)으로 열면 '이전 방으로 돌아가기' 표시 없음 · 창 자동 표시 없음", other.sheet === "" && !other.back && !other.btn, JSON.stringify(other));
  await H2.page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem("webgba.netBack"));
    rec.at = Date.now() - 121000;
    localStorage.setItem("webgba.netBack", JSON.stringify(rec));
  });
  await open(H2, "rejoin");
  await sleep(1500);
  const late = await H2.page.evaluate(() => ({ sheet: window.webgba.state.sheet, back: Boolean(document.querySelector('[data-action="net-back"]')), rec: localStorage.getItem("webgba.netBack") }));
  ok("2분 지난 방 정보: 같은 게임이어도 표시 없음 · 보관 정보 삭제", late.sheet === "" && !late.back && late.rec === null, JSON.stringify(late));
  local.fake.advance(125000);
  const t0 = Date.now();
  let toastSeen = "";
  const endG = await waitFor(async () => {
    toastSeen ||= await G.page.evaluate(() => {
      const n = document.getElementById("toast");
      return n && !n.hidden && /방장이 나가/.test(n.textContent) ? n.textContent : "";
    });
    return (await game(G))?.closed === 7 && toastSeen;
  }, 20000, 150);
  const gView = await G.page.evaluate(() => ({ wait: window.webgba.player.net.snapshot().hostWait, active: window.webgba.player.net.active }));
  ok(`2분 넘김(방 기록 만료): 유저 세션 끝 ${((Date.now() - t0) / 1000).toFixed(1)}초 · CLOSED(HOST_LEFT) · 대기 해제 · 알림 '${toastSeen}'`, endG && !gView.wait && !gView.active, JSON.stringify(gView));
  for (const p of [H2, G]) await p.context.close().catch(() => {});

  // ── 다시 들어오기를 선택하지 않은 게임은 그대로(방장 앱 종료 = 세션 끝, 방 정보 보관 없음) ──
  const P = await peer("BHP", { nick: "방장 P" });
  const Q = await peer("BGQ", { nick: "유저 Q" });
  await room(P, [Q], "webapi");
  const t2 = Date.now();
  const kept = await backRecord(P);
  await P.page.close();
  const qEnd = await waitFor(async () => [4, 7].includes((await game(Q))?.closed), 25000, 250);
  const qWait = (await snap(Q)).hostWait;
  const P2 = await reopen(P, "BHP2");
  ok(`선택하지 않은 게임: 방장 페이지 닫기 → 유저 세션 끝 ${((Date.now() - t2) / 1000).toFixed(1)}초(대기 없음) · 방 정보 보관 없음`, qEnd && !qWait && kept === null && (await backRecord(P2)) === null, JSON.stringify({ q: await game(Q) }));
  for (const p of [P2, Q]) await p.context.close().catch(() => {});
}

function seatRecord(p) {
  return p.page.evaluate(() => JSON.parse(localStorage.getItem("webgba.netSeat") ?? "null"));
}

async function seatTests() {
  const H = await peer("SH", { nick: "방장 S" });
  const G = await peer("SG", { nick: "유저 S" });
  const code = await room(H, [G], "rejoin");
  await stateShim(H);
  const gSlot = (await snap(G)).slot;
  const rec = await waitFor(async () => {
    const r = await seatRecord(G);
    return r?.room === code ? r : null;
  }, 5000);
  ok(`유저: 방 ${code} 자리 ${gSlot} 기록(방 코드·자리·자리 열쇠·방장 이름)`, rec?.s === gSlot && /^[A-Za-z0-9_-]{16,32}$/.test(rec.key ?? "") && rec.hn === "방장 S", JSON.stringify(rec && { room: rec.room, s: rec.s, hn: rec.hn }));

  // 유저 앱 닫기 → 방장이 자리를 보관(HOLD) → 같은 맥락 새 페이지에서 같은 게임 → 이전 방으로 돌아가기
  const t0 = Date.now();
  await G.page.close();
  const held = await waitFor(async () => (await snap(H)).members.some((m) => m.slot === gSlot && m.held), 25000, 250);
  ok(`유저 페이지 닫기 → 방장이 자리 ${gSlot} 보관 ${((Date.now() - t0) / 1000).toFixed(1)}초`, held);
  const G2 = await reopen(G, "SG2");
  await open(G2, "rejoin");
  const offered = await waitFor(() => G2.page.$('[data-action="net-back"]'), 8000);
  await sleep(300);
  const offer = await G2.page.evaluate(() => ({ sheet: window.webgba.state.sheet, sec: document.querySelector("#sheetBody .net-sec--back")?.textContent ?? "" }));
  ok(`유저가 같은 게임을 다시 열기 → 창 자동 표시 · 이전 방 ${code} · 방장 이름 · '이전 방으로 돌아가기'`, Boolean(offered) && offer.sheet === "net" && offer.sec.includes(code) && offer.sec.includes("방장 S"), JSON.stringify(offer));
  if (SHOTS) await G2.page.screenshot({ path: path.join(SHOTS, "유저_이전방_돌아가기_390x844.png") });
  await stateShim(G2);
  const t1 = Date.now();
  await G2.page.click('[data-action="net-back"]');
  const back = await waitFor(async () => {
    const s = await snap(G2);
    return s.connected && !s.rejoining && s.slot === gSlot ? s : null;
  }, 45000, 250);
  await waitFor(async () => (await G2.page.evaluate(() => window.__shim.got.length)) >= 1, 8000);
  await sleep(800);
  const hEv = await events(H);
  const gEv = await events(G2);
  const hs = await Promise.all([H, G2].map(hashOf));
  const hostView = await snap(H);
  ok(`'이전 방으로 돌아가기' → ${((Date.now() - t1) / 1000).toFixed(1)}초 · 같은 자리 ${gSlot} REJOINED · 방장 BACK(${gSlot}) · 방장 상태 묶음 받음 · 두 기기 해시 같음`, Boolean(back) && kindsOf(gEv, 9, gSlot) === 1 && kindsOf(hEv, 8, gSlot) >= 1 && hs[0] === hs[1] && hostView.members.every((m) => !m.held), JSON.stringify({ hs, members: hostView.members }));
  // 예제 게임은 REJOINED 를 세션 시작으로 보지 않아(OPEN 만) 새로 연 페이지에서 보내지 않는다 — 주고받기는 BR2 시험에서 확인

  // 돌아가지 않고 방 만들기를 고름 → 기록 삭제·방장 쪽 자리 비움
  await G2.page.close();
  await waitFor(async () => (await snap(H)).members.some((m) => m.slot === gSlot && m.held), 25000, 250);
  const G3 = await reopen(G, "SG3");
  await open(G3, "rejoin");
  await waitFor(() => G3.page.$('[data-action="net-back"]'), 8000);
  const before = (await events(H)).length;
  await makeRoom(G3);
  const freed = await waitFor(async () => !(await snap(H)).members.some((m) => m.slot === gSlot), 20000, 250);
  const evs = await events(H);
  ok("돌아가지 않고 방 만들기 → 이전 자리 기록 삭제 · 방장 쪽 자리 비움(LEAVE)", freed && (await seatRecord(G3)) === null && kindsOf(evs.slice(-Math.max(1, evs.length - before + 1)), 3, gSlot) >= 1, JSON.stringify({ members: (await snap(H)).members }));
  await G3.page.evaluate(() => window.webgba.player.net.leave());
  for (const p of [H, G3]) await p.context.close().catch(() => {});

  // 방 나가기로 끝낸 세션은 기록을 남기지 않는다
  const H4 = await peer("SH4", { nick: "방장 S4" });
  const G4 = await peer("SG4", { nick: "유저 S4" });
  await room(H4, [G4], "rejoin");
  const had = Boolean(await waitFor(async () => await seatRecord(G4), 5000));
  await G4.page.evaluate(() => window.webgba.player.net.leave());
  const cleared = await waitFor(async () => (await seatRecord(G4)) === null, 5000);
  ok("유저가 방 나가기 → 이전 자리 기록 삭제", had && cleared);
  for (const p of [H4, G4]) await p.context.close().catch(() => {});
}

async function wanTests() {
  const W = await peer("W", { nick: "방장 기본" });
  const L = await peer("L", { nick: "유저 기본" });
  const turnCalls = () => (local ? local.apiCalls.filter((c) => c.op === "turn") : []);
  const offerInfo = (p) =>
    p.page.evaluate(async () => {
      const lan = await import("/js/core/net/lan.js");
      const inv = window.webgba.net.win.roomHost?.invite;
      const d = lan.decodeCode(inv.code, "offer", { wan: true });
      const types = d.sdp.split("\r\n").filter((l) => l.startsWith("a=candidate")).map((l) => l.split(" ")[7]);
      return { public: inv.public, types, flag: d.wan, servers: window.__rtcConfigs.map((c) => (c.iceServers ?? []).map((s) => [].concat(s.urls).join(",")).join("|")).filter(Boolean) };
    });
  await open(W);
  await want(W);
  await W.page.click('[data-action="net-tab-make"]');
  const lead = await text(W, "#sheetBody .net-info");
  await makeRoom(W);
  const code = await roomCode(W);
  await waitFor(() => W.page.evaluate(() => Boolean(window.webgba.net.win.roomHost?.invite)), 5000);
  const on = await offerInfo(W);
  ok("멀티플레이 켬(기본) = 인터넷 연결 항상: 기본 STUN 2곳 · 공인 주소 후보(srflx) 수집 · 방 연결 정보에 포함(인터넷 표시) · 와이파이 설정 줄 없음", on.public > 0 && on.types.includes("srflx") && on.flag && /stun\.l\.google\.com/.test(on.servers.join()) && /stun\.cloudflare\.com/.test(on.servers.join()) && !/인터넷 연결|와이파이/.test(lead), JSON.stringify({ public: on.public, types: on.types, flag: on.flag, servers: on.servers.slice(0, 1), lead }));
  await open(L);
  await want(L);
  await L.page.click('[data-action="net-room-join"]');
  await L.page.fill('[data-action="net-code-in"]', code);
  await L.page.click('[data-action="net-code-go"]');
  const joined = await waitFor(async () => (await game(L))?.open === 1, 25000, 200);
  const lInfo = await L.page.evaluate(() => {
    const s = window.webgba.player.net.session;
    const types = (s?.link?.pc?.localDescription?.sdp ?? "").split("\r\n").filter((l) => l.startsWith("a=candidate")).map((l) => l.split(" ")[7]);
    return { types, wan: s?.wan === true, servers: window.__rtcConfigs.map((c) => (c.iceServers ?? []).map((x) => [].concat(x.urls).join(",")).join("|")) };
  });
  const tc = turnCalls();
  // 같은 PC 두 페이지에서는 답 쪽 크롬이 상대 host 후보를 받으면 srflx 를 내지 않는다(turn-work stun-probe.mjs) → 유저는 STUN 설정·인터넷 표시만 본다.
  ok("두 기기 기본 설정: 방 코드로 연결 · 유저도 STUN 2곳·인터넷 연결 · 기본 TURN 발급 경로 요청(로컬 서버 키 없음 = 503) → STUN 만", joined && lInfo.wan && lInfo.servers.length > 0 && lInfo.servers.every((s) => /stun\.l\.google\.com/.test(s) && /stun\.cloudflare\.com/.test(s) && !/turn:/.test(s)) && tc.length >= 1 && tc.every((c) => c.status === 503), JSON.stringify({ ...lInfo, turn: tc.map((c) => c.status) }));
  await L.context.close();
  await W.context.close();
  const O = await peer("O2", { nick: "멀티 끔", prefs: { netOn: false } });
  await open(O);
  const t0 = turnCalls().length;
  await press(O, "KeyZ");
  await sleep(2500);
  const offState = await O.page.evaluate(() => ({ sheet: window.webgba.state.sheet ?? "", configs: window.__rtcConfigs.length, active: Boolean(window.webgba.player.net.active) }));
  ok("멀티플레이 끔: 게임이 요청해도 연결 창 안 열림 · 연결·STUN·TURN 요청 0", offState.sheet !== "net" && offState.configs === 0 && !offState.active && turnCalls().length === t0, JSON.stringify(offState));
  await O.context.close();
  const S = await peer("S", { nick: "설정" });
  await S.page.evaluate(() => window.webgba.openSheet("settings"));
  await sleep(500);
  const item = await S.page.evaluate(() => {
    const leaves = [...document.querySelectorAll("#sheetBody *")].filter((n) => n.childElementCount === 0);
    const label = leaves.find((n) => n.textContent === "멀티플레이 사용");
    const row = label?.closest(".field, .item, label, li, .row") ?? label?.parentElement;
    row?.scrollIntoView({ block: "center" });
    return { found: Boolean(label), text: row?.textContent ?? "", wanRow: leaves.some((n) => /인터넷 연결|실험/.test(n.textContent)) };
  });
  await sleep(300);
  ok("설정 › 멀티플레이: '인터넷 연결' 줄 없음 · '(실험)' 없음 · '멀티플레이 사용' 설명 두 줄(코드 값으로 … 연결합니다 / 비활성화 시 …, 공인 IP·중계 안내는 README)", item.found && !item.wanRow && item.text.includes("코드 값으로 다른 네트워크의 유저와 연결합니다.\n비활성화 시 멀티플레이 창을 열 수 없습니다.") && !/공인 IP|Cloudflare|재실행/.test(item.text), item.text.slice(0, 160));
  if (CAPTURE) await S.page.screenshot({ path: path.join(CAPTURE, "설정_멀티플레이_390x844.png") });
  await S.context.close();
}

async function iceTests() {
  let mode = "ok";
  let calls = 0;
  const cred = async (route) => {
    calls++;
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (mode === "slow") {
      await sleep(6500);
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ username: "late", credential: "late" }) }).catch(() => {});
    }
    if (mode === "bad") return route.fulfill({ status: 200, headers, body: "{not json" });
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ username: "u-test", credential: "c-test", ttl: 600 }) });
  };
  const turnBefore = local ? local.apiCalls.filter((x) => x.op === "turn").length : 0;
  const I = await peer("I", { nick: "게임 서버" });
  await I.context.route("https://cred.example.test/**", cred);
  const make = async (p) => {
    await open(p, "iced");
    await want(p);
    const note = await p.page.evaluate(() => [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" | "));
    await makeRoom(p);
    await roomCode(p);
    const info = await p.page.evaluate(() => ({ cfg: window.__rtcConfigs.at(-1)?.iceServers ?? [], failed: window.webgba.player.net.snapshot().iceFailed, note: [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" | ") }));
    await p.page.click('[data-action="net-cancel"]').catch(() => {});
    await sleep(300);
    return { ...info, lead: note };
  };
  const a = await make(I);
  const urls = a.cfg.map((s) => [].concat(s.urls).join(","));
  ok("게임 연결 서버: 게임 목록만 사용(기본 STUN 없음) · credentialUrl 접속 정보 적용 · 연결 창 '이 게임의 연결 서버' 표시", calls === 1 && urls.length === 2 && urls[0].startsWith("stun:stun.example.test") && a.cfg[1].username === "u-test" && a.cfg[1].credential === "c-test" && !/google|cloudflare/.test(urls.join()) && /이 게임의 연결 서버: stun\.example\.test, turn\.example\.test/.test(a.lead), JSON.stringify({ calls, urls, lead: a.lead.slice(0, 160) }));
  mode = "slow";
  calls = 0;
  const t0 = Date.now();
  const b = await make(I);
  ok(`credentialUrl 시간 초과(6.5초 응답): 5초에 포기하고 그 서버만 빼고 연결 · 안내 표시 · ${((Date.now() - t0) / 1000).toFixed(1)}초`, calls === 1 && b.failed === 1 && b.cfg.length === 1 && /접속 정보를 받지 못했습니다/.test(b.note), JSON.stringify({ calls, cfg: b.cfg.length, failed: b.failed }));
  mode = "bad";
  calls = 0;
  const c = await make(I);
  ok("credentialUrl 잘못된 응답: 그 서버만 빼고 연결 · 안내 표시", calls === 1 && c.failed === 1 && c.cfg.length === 1, JSON.stringify({ calls, cfg: c.cfg.length }));
  await I.context.close();
  const turnAfter = local ? local.apiCalls.filter((x) => x.op === "turn").length : 0;
  ok("게임이 iceServers 를 정함: webGBA 기본 TURN 발급 경로 요청 0(세 번 방 만들기)", turnAfter === turnBefore, `${turnAfter - turnBefore}`);
}

// --turn <host:port> (e.g. a local coturn: --lt-cred-mech --user test:secret) forces iceTransportPolicy "relay" so the game's TURN server carries the channel.
async function turnTests() {
  const manifest = { ...webapiArgs.manifest, id: "com.example.netturn", multiplayer: { ...webapiArgs.manifest.multiplayer, iceServers: [{ urls: `turn:${opt.turn}?transport=udp`, username: "test", credential: "secret" }] } };
  files.turned = (await packWgba({ ...webapiArgs, manifest })).bytes;
  const H = await peer("TH", { nick: "TURN 방장" });
  const G = await peer("TG", { nick: "TURN 유저" });
  for (const p of [H, G])
    await p.page.evaluate(() => {
      window.__forceRelay = true;
    });
  await room(H, [G], "turned");
  const pair = async (p) =>
    p.page.evaluate(async () => {
      const { selectedPair } = await import("/js/core/net/lan.js");
      const s = window.webgba.player.net.session;
      const link = s.host ? [...s.links.values()][0] : s.link;
      return link?.pc ? selectedPair(link.pc) : null;
    });
  const hp = await pair(H);
  const gp = await pair(G);
  const big0 = await bigOk(H);
  await press(G, "KeyX");
  const flows = await waitFor(async () => (await bigOk(H)) > big0, 8000);
  ok("게임 TURN 서버(iceTransportPolicy relay 강제): 방 코드로 연결 · 고른 후보 relay/relay · 16KB 메시지 정상", (await game(H))?.count === 2 && hp?.local === "relay" && gp?.local === "relay" && flows, JSON.stringify({ hp: hp && `${hp.local}/${hp.remote}`, gp: gp && `${gp.local}/${gp.remote}` }));
  for (const p of [H, G]) await p.context.close();
}

function topBar(p) {
  return p.page.evaluate(() =>
    [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null && !n.closest(".bar__group--files")).map((n) => {
      const r = n.getBoundingClientRect();
      const c = n.querySelector("canvas")?.getBoundingClientRect() ?? r;
      const b = n.querySelector(".tool__badge:not([hidden])");
      return { id: n.id, top: r.top, bottom: r.bottom, ct: c.top, cb: c.bottom, badge: b?.textContent ?? "", tone: b?.dataset.tone ?? "", title: n.title };
    }),
  );
}

function spreadOf(list, k) {
  return Math.max(...list.map((b) => b[k])) - Math.min(...list.map((b) => b[k]));
}

function actionRow(p) {
  return p.page.evaluate(() => [...document.querySelectorAll("#sheetFoot .net-actions > button")].map((n) => {
    const r = n.getBoundingClientRect();
    return { a: n.dataset.action, top: r.top, bottom: r.bottom };
  }));
}

async function anytimeTests() {
  // ── 중간 참가 게임: 창 자동 열림 없음 · 만들기·갱신부터 2분 30초만 받기(시험은 줄임) · 창을 닫아도 그동안은 받음 · 지나면 멈춤 · 갱신 = 같은 코드, 기존 유저 그대로 ──
  const H = await peer("AH", { nick: "중간 방장" });
  const G = await peer("AG", { nick: "중간 유저" });
  for (const p of [H, G]) await open(p, "anytime");
  await press(H, "KeyZ");
  await sleep(1500);
  const quiet = await H.page.evaluate(() => ({ sheet: window.webgba.state.sheet, request: Boolean(window.webgba.player.net.request), timer: Boolean(window.webgba.player.net.windowTimer), btn: !document.getElementById("btnNet").hidden }));
  ok("중간 참가 게임: 요청해도 창 자동 열림 없음 · 시간 초과 타이머 없음 · 상단 멀티플레이 버튼 표시", quiet.sheet === "" && quiet.request && !quiet.timer && quiet.btn, JSON.stringify(quiet));
  await H.page.click("#btnNet");
  await waitFor(async () => (await sheetOf(H)) === "net" && Boolean(await H.page.$('.net-tabs')), 5000);
  const m0 = stats();
  await makeRoom(H);
  const code = await roomCode(H);
  await sleep(400);
  const acts = await actionRow(H);
  const view = await H.page.evaluate(() => ({ accept: document.querySelector("#sheetBody .net-accept")?.textContent ?? "", renew: Boolean(document.querySelector('[data-action="net-renew"]')), note: [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" | ") }));
  ok("방장 혼자 방 코드 화면: 받는 중·남은 시간 · 하단 방 닫기·갱신·게임으로(위·아래 차이 0)", acts.map((b) => b.a).join() === "net-leave,net-renew,net-close" && spreadOf(acts, "top") === 0 && spreadOf(acts, "bottom") === 0 && /참가 받는 중 · 2:[0-9]{2} 남음/.test(view.accept) && view.renew && /2분 30초/.test(view.note), `${code} · ${JSON.stringify(view)}`);
  await shot(H, "중간참가_방코드_390x844.png");
  const LIMIT = opt.fast ? 20000 : 30000;
  await H.page.evaluate((limit) => {
    const rh = window.webgba.net.win.roomHost;
    rh.limit = limit;
    rh.acceptUntil = Date.now() + limit;
    rh.keepAt = rh.acceptUntil + 1;
    rh.schedule();
  }, LIMIT);
  const madeAt = Date.now();
  await H.page.click('[data-action="net-close"]');
  const closed = await waitFor(async () => (await sheetOf(H)) === "", 4000, 100);
  await sleep(600);
  const keep = await H.page.evaluate(() => ({ active: window.webgba.player.net.active, inviting: window.webgba.net.win.roomHost?.inviting === true, timer: Boolean(window.webgba.player.net.windowTimer) }));
  const bar = await topBar(H);
  const btn = bar.find((b) => b.id === "btnNet");
  ok("방장 혼자 창 닫기(게임 중) → 방 유지 · 받기 계속 · 상단 버튼 배지 1/4 파랑·제목 '참가 받는 중'", closed && keep.active && keep.inviting && !keep.timer && (await game(H))?.closed === 0 && btn?.badge === "1/4" && btn.tone === "" && /참가 받는 중/.test(btn.title), JSON.stringify({ keep, btn }));
  ok("받는 중 상단 버튼 줄: 위·아래 차이 0(버튼·그림)", spreadOf(bar, "top") === 0 && spreadOf(bar, "bottom") === 0 && spreadOf(bar, "ct") === 0 && spreadOf(bar, "cb") === 0, JSON.stringify(bar.map((b) => `${b.id}:${b.top}-${b.bottom}${b.badge ? `(${b.badge})` : ""}`)));
  if (CAPTURE) await H.page.screenshot({ path: path.join(CAPTURE, "웹_받는중_상단버튼_390x844.png") });

  await press(G, "KeyZ");
  await sleep(1200);
  const gQuiet = await sheetOf(G);
  await G.page.click("#btnNet");
  const listed = await waitFor(() => G.page.$(`[data-action="net-near-join"][data-room="${code}"]`), 12000);
  await G.page.click(`[data-action="net-near-join"][data-room="${code}"]`);
  const toastSeen = await waitFor(() => H.page.evaluate(() => {
    const n = document.getElementById("toast");
    return n && !n.hidden && /들어왔습니다/.test(n.textContent) ? n.textContent : "";
  }), 25000, 100);
  if (CAPTURE) await H.page.screenshot({ path: path.join(CAPTURE, "웹_유저참가_알림_390x844.png") });
  const joined = await waitFor(async () => (await game(H))?.count === 2 && (await game(G))?.open === 1, 10000, 200);
  const gSlot = (await game(G))?.slot;
  ok(`게임 중(창 닫음) 받는 시간 안에 근처 방으로 참가 → 방장 토스트 알림(${((Date.now() - madeAt) / 1000).toFixed(1)}초)`, gQuiet === "" && Boolean(listed) && joined && Boolean(toastSeen) && (await sheetOf(H)) === "", toastSeen);
  await waitFor(() => H.page.evaluate(() => window.webgba.net.win.roomHost?.pausedAt > 0), LIMIT + 8000, 250);
  const acceptUsed = stats() - m0;
  await sleep(500);
  const pausedToast = await H.page.evaluate(() => document.getElementById("toast")?.textContent ?? "");
  const pBtn = (await topBar(H)).find((b) => b.id === "btnNet");
  const pState = await H.page.evaluate(() => ({ inviting: window.webgba.net.win.roomHost?.inviting, count: window.webgba.player.net.session?.count }));
  ok(`받는 시간(시험 ${LIMIT / 1000}초) 지나면 자동 멈춤 · 알림 · 배지 회색·제목 '참가 받기 멈춤' · 이미 들어온 유저 그대로(받는 동안 Upstash ${acceptUsed}명령)`, pState.inviting === false && pState.count === 2 && /참가 받기를 멈췄습니다/.test(pausedToast) && pBtn?.tone === "wait" && /멈춤/.test(pBtn.title) && (await game(G))?.open === 1, JSON.stringify({ pState, pBtn, pausedToast }));
  if (CAPTURE) await H.page.screenshot({ path: path.join(CAPTURE, "웹_멈춤_상단버튼_390x844.png") });
  const idleMs = opt.fast ? 10000 : 30000;
  const i0 = stats();
  await sleep(idleMs);
  const idleUsed = stats() - i0;
  ok(`멈춘 뒤 게임 중 ${idleMs / 1000}초: Upstash ${idleUsed}명령(목표 0)`, idleUsed === 0, String(idleUsed));

  const C = await peer("AC", { nick: "새 유저" });
  await open(C, "anytime");
  await press(C, "KeyZ");
  await sleep(800);
  await C.page.click("#btnNet");
  await waitFor(() => C.page.$('[data-action="net-room-join"]'), 5000);
  await C.page.click('[data-action="net-room-join"]');
  await C.page.fill('[data-action="net-code-in"]', code);
  await C.page.click('[data-action="net-code-go"]');
  const refused = await waitFor(() => errorText(C).then((e) => (/갱신/.test(e) ? e : "")), 8000);
  ok("멈춘 방 코드로 들어가기 → 실패 안내('방장에게 갱신을 눌러 달라고')", Boolean(refused), refused);

  await H.page.evaluate(() => window.webgba.net.open());
  await waitFor(() => H.page.$('[data-action="net-renew"]'), 4000);
  const before = await H.page.evaluate(() => ({ accept: document.querySelector("#sheetBody .net-accept")?.textContent ?? "", code: document.querySelector(".net-room-code")?.textContent ?? "" }));
  const r0 = stats();
  await H.page.click('[data-action="net-renew"]');
  await waitFor(() => H.page.evaluate(() => window.webgba.net.win.roomHost?.inviting === true && !window.webgba.net.win.roomHost.renewing), 8000);
  const renewUsed = stats() - r0;
  await sleep(400);
  const after = await H.page.evaluate(() => ({ accept: document.querySelector("#sheetBody .net-accept")?.textContent ?? "", code: document.querySelector(".net-room-code")?.textContent ?? "" }));
  ok(`멈춤 화면 '갱신' → 같은 방 코드로 다시 받기(갱신 ${renewUsed}명령)`, /멈춤/.test(before.accept) && /받는 중/.test(after.accept) && after.code === code && before.code === code, JSON.stringify({ before, after }));
  await H.page.evaluate(() => window.webgba.net.win.requestClose());
  await C.page.click('[data-action="net-code-go"]');
  const added = await waitFor(async () => (await game(C))?.open === 1 && (await game(H))?.count === 3, 25000, 200);
  const slots = { g: (await game(G))?.slot, c: (await game(C))?.slot, gOpen: (await game(G))?.open };
  ok("갱신 뒤 같은 코드로 새 유저 참가 · 기존 유저 연결·자리 그대로(3명, 자리 이어서)", added && slots.gOpen === 1 && slots.g === gSlot && slots.c === 2, JSON.stringify(slots));

  const D = await peer("AD", { nick: "중간 취소" });
  await open(D, "anytime");
  await press(D, "KeyZ");
  await sleep(800);
  await D.page.click("#btnNet");
  await waitFor(() => D.page.$(".net-tabs"), 4000);
  await D.page.click("#sheetClose");
  await sleep(600);
  const dState = await D.page.evaluate(() => ({ sheet: window.webgba.state.sheet, request: Boolean(window.webgba.player.net.request), btn: !document.getElementById("btnNet").hidden }));
  ok("중간 참가 게임 창 취소: 게임에 CLOSED 없음 · 요청·버튼 유지", (await game(D))?.closed === 0 && dState.sheet === "" && dState.request && dState.btn, JSON.stringify({ dState, game: await game(D) }));
  await D.context.close();

  await H.page.evaluate(() => window.webgba.net.open());
  await waitFor(() => H.page.$('[data-action="net-leave"]'), 4000);
  await H.page.click('[data-action="net-leave"]');
  const left = await waitFor(async () => (await game(G))?.closed === 7 && (await game(C))?.closed === 7 && (await game(H))?.closed === 6, 8000);
  ok("방장 방 나가기 → 유저 CLOSED(HOST_LEFT) · 방장 CLOSED(LEFT)", left, JSON.stringify({ h: await game(H), g: await game(G), c: await game(C) }));
  for (const p of [H, G, C]) await p.context.close();

  // ── 중간 참가 + 다시 들어오기 + 인터넷 연결 ──
  const RH = await peer("ARH", { nick: "중간 방장 R" });
  const RG = await peer("ARG", { nick: "중간 유저 R" });
  for (const p of [RH, RG]) await open(p, "anytimeRejoin");
  await press(RH, "KeyZ");
  await sleep(800);
  await RH.page.click("#btnNet");
  await waitFor(() => RH.page.$('.net-tabs'), 5000);
  await makeRoom(RH);
  const rCode = await roomCode(RH);
  await RH.page.click('[data-action="net-close"]');
  await press(RG, "KeyZ");
  await sleep(800);
  await RG.page.click("#btnNet");
  await waitFor(() => RG.page.$('[data-action="net-room-join"]'), 5000);
  await RG.page.click('[data-action="net-room-join"]');
  await RG.page.fill('[data-action="net-code-in"]', rCode);
  await RG.page.click('[data-action="net-code-go"]');
  const rOn = await waitFor(async () => (await game(RG))?.open === 1 && (await game(RH))?.count === 2, 30000, 200);
  const rInfo = await RH.page.evaluate(() => ({ rejoin: window.webgba.net.win.roomHost?.rejoin === true && window.webgba.player.net.session?.rejoinable === true, wan: window.webgba.player.net.session?.wan === true }));
  ok("중간 참가 + 다시 들어오기 + 인터넷 연결(항상): 창을 닫아 둔 방에 방 코드로 연결 · 다시 들어오기 켜짐", rOn && rInfo.rejoin && rInfo.wan, JSON.stringify(rInfo));
  if (!opt.fast) {
    const slot = (await snap(RG)).slot;
    await sleep(1500);
    const t0 = Date.now();
    await cut(RG, true);
    await waitFor(async () => (await snap(RH)).members.find((m) => m.slot === slot)?.held, 22000, 250);
    await RG.page.evaluate(() => window.webgba.net.win.requestClose());
    await sleep(Math.max(0, 20000 - (Date.now() - t0)));
    await cut(RG, false);
    const back = await waitFor(async () => {
      const s = await snap(RG);
      return s.connected && !s.rejoining && s.slot === slot;
    }, 40000, 250);
    ok("중간 참가 게임 손님 끊김 20초 → 같은 자리로 돌아옴", back, JSON.stringify(await snap(RG)));
  }
  for (const p of [RH, RG]) await p.context.close();
}

function quickView(p) {
  return p.page.evaluate(() => {
    const w = window.webgba;
    const btn = document.getElementById("btnQuick");
    const toastNode = document.getElementById("toast");
    const tool = w.skin.tools.get(btn) ?? {};
    return {
      locked: w.player.net.locked,
      aria: btn.getAttribute("aria-disabled"),
      htmlDisabled: btn.disabled,
      title: btn.title,
      sheet: w.state.sheet,
      toast: toastNode && !toastNode.hidden ? toastNode.textContent : "",
      focus: document.activeElement === btn,
      focusVisible: btn.matches(":focus-visible"),
      drawnOff: Boolean(tool.disabled),
      pressed: Boolean(tool.pressed),
      autoCount: w.state.quick.autoCount,
      played: w.state.quick.played,
    };
  });
}

// the quick button canvas: alpha mask signature + ink rows, to tell the off art keeps the same place and size
function quickArt(p) {
  return p.page.evaluate(() => {
    const c = document.querySelector("#btnQuick canvas");
    const { data, width, height } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    let mask = "";
    let colors = 0;
    for (let i = 0; i < data.length; i += 4) {
      mask += data[i + 3] ? "1" : "0";
      colors = (colors * 31 + data[i] * 7 + data[i + 1] * 3 + data[i + 2]) % 1000003;
    }
    return { width, height, mask, colors };
  });
}

// visible top-bar tools: canvas ink rows (alpha > 0) in CSS px — the drawn button, not the element box
function barInk(p) {
  return p.page.evaluate(() =>
    [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null && !n.closest(".bar__group--files")).map((n) => {
      const c = n.querySelector("canvas");
      const r = c.getBoundingClientRect();
      const { data, width, height } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      let y0 = -1;
      let y1 = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3]) {
            if (y0 < 0) y0 = y;
            y1 = y;
            break;
          }
      const k = r.height / height;
      const box = n.getBoundingClientRect();
      return { id: n.id, off: n.getAttribute("aria-disabled") === "true", top: box.top, bottom: box.bottom, it: +(r.top + y0 * k).toFixed(2), ib: +(r.top + (y1 + 1) * k).toFixed(2) };
    }),
  );
}

async function quickSlot9(p) {
  return p.page.evaluate(async () => (await window.webgba.store.states(window.webgba.state.game.saveId)).find((s) => s.slot === 9)?.saved ?? 0);
}

// push the auto-save clock past one minute and wait two ticks
async function autoTry(p) {
  const before = await quickView(p);
  const saved = await quickSlot9(p);
  await p.page.evaluate(() => (window.webgba.state.quick.played = 59200));
  await sleep(2600);
  const after = await quickView(p);
  return { saved: after.autoCount > before.autoCount && (await quickSlot9(p)) > saved, skipped: after.autoCount === before.autoCount && (await quickSlot9(p)) === saved, played: after.played, toast: after.toast };
}

// click (mouse) or tap (touch) the quick button; the press art is read between down and up for the mouse
async function hitQuick(p, how) {
  await p.page.evaluate(() => window.webgba.toast(""));
  await sleep(100);
  const r = await p.page.evaluate(() => {
    const b = document.getElementById("btnQuick").getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  let downPressed = false;
  if (how === "tap") await p.page.touchscreen.tap(r.x, r.y);
  else {
    await p.page.mouse.move(r.x, r.y);
    await p.page.mouse.down();
    downPressed = (await quickView(p)).pressed;
    await p.page.mouse.up();
  }
  await sleep(250);
  return { ...(await quickView(p)), downPressed };
}

function blockedOk(v) {
  return v.locked && v.aria === "true" && !v.htmlDisabled && v.drawnOff && v.sheet === "" && v.toast === "멀티플레이 중에는 사용할 수 없습니다" && !v.focus && !v.focusVisible && !v.pressed && !v.downPressed && v.title === "퀵슬롯";
}

async function rsTests() {
  const preset = (keys) => ({ "com.example.netpair": { active: 0, slots: [{ name: "", steps: [{ keys, hold: 3, gap: 3 }] }, null, null, null, null] } });
  const H = await peer("RH", { nick: "방장 R", prefs: { rsPresets: preset(["START"]) } });
  const G = await peer("RG", { nick: "유저 R", prefs: { rsPresets: preset(["B"]) }, touch: true });
  for (const p of [H, G]) await open(p, "pair");
  await want(H);
  await makeRoom(H);
  const code = await roomCode(H);
  await want(G);
  await G.page.click('[data-action="net-room-join"]');
  await G.page.fill('[data-action="net-code-in"]', code);
  await G.page.click('[data-action="net-code-go"]');
  const both = await waitFor(async () => (await game(H))?.count === 2 && (await game(G))?.open === 1, 25000, 200);
  ok(`RS: 방 코드(${code})로 2명 연결`, both, JSON.stringify({ h: await game(H), g: await game(G) }));
  await waitFor(async () => (await G.page.evaluate(() => window.webgba.state.sheet)) === "" && (await H.page.evaluate(() => window.webgba.state.sheet)) === "", 5000);
  const rsOf = (p) => p.page.evaluate(() => ({ macro: window.webgba.player.macro, shown: document.getElementById("pad").hasAttribute("data-rs") }));
  const big0 = await bigOk(H);
  await G.page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("Pad:RS");
    p.keyUp("Pad:RS");
  });
  const got = await waitFor(async () => (await bigOk(H)) > big0, 8000);
  ok("유저 RS(프리셋 1 = B 3프레임) → 게임이 B 로 받아 16KB 방송 → 방장 도착", Boolean(got) && (await rsOf(G)).shown, JSON.stringify(await rsOf(G)));
  await H.page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("Pad:RS");
    p.keyUp("Pad:RS");
  });
  const started = await waitFor(() => Promise.all([H, G].map((p) => p.page.evaluate(() => window.webgba.player.host.ex.Net_Started()))).then((v) => v.every((s) => s === 1)), 8000);
  ok("방장 RS(프리셋 1 = START 3프레임) → 라운드 시작(두 기기)", Boolean(started));
  const ended = await waitFor(() => Promise.all([H, G].map((p) => p.page.evaluate(() => window.webgba.player.host.ex.Net_Ended()))).then((v) => v.every((s) => s === 1)), 30000, 300);
  const hashes = await Promise.all([H, G].map((p) => p.page.evaluate(() => window.webgba.player.host.ex.Net_Hash() >>> 0)));
  ok(`RS 입력으로 진행한 라운드 끝 · 두 기기 해시 같음(${hashes.map((h) => h.toString(16)).join(" / ")})`, Boolean(ended) && hashes[0] === hashes[1], JSON.stringify(hashes));
  for (const p of [H, G]) await p.context.close();
}

async function nosaveTests() {
  const BLOCK_TEXT = "멀티플레이 중에는 사용할 수 없습니다";
  const H = await peer("NH", { nick: "방장 N", prefs: { autoSave: 1 } });
  const G = await peer("NG", { nick: "유저 N", prefs: { autoSave: 1 }, touch: true });
  for (const p of [H, G]) await open(p, "anytimeRejoin");

  // ── 혼자 실행: 그대로 ──
  const solo = await quickView(H);
  const soloArt = await quickArt(H);
  const soloAuto = await autoTry(H);
  ok("혼자 실행: 퀵슬롯 버튼 켜짐 · 자동 저장(1분) 9번 칸에 저장", !solo.locked && solo.aria === "false" && !solo.drawnOff && soloAuto.saved, JSON.stringify({ solo, soloAuto }));
  const soloHit = await hitQuick(H, "click");
  ok("혼자 실행: 퀵슬롯 버튼 클릭 → 퀵슬롯 창 열림", soloHit.sheet === "quick", JSON.stringify(soloHit));
  await H.page.click("#sheetClose");
  await waitFor(async () => (await sheetOf(H)) === "", 3000);

  // ── 방장 혼자 받는 중(창 닫음, 세션 열림) ──
  await press(H, "KeyZ");
  await sleep(800);
  await H.page.click("#btnNet");
  await waitFor(async () => (await sheetOf(H)) === "net" && Boolean(await H.page.$('.net-tabs')), 5000);
  await makeRoom(H);
  const code = await roomCode(H);
  await H.page.click('[data-action="net-close"]');
  await waitFor(async () => (await sheetOf(H)) === "", 4000, 100);
  await sleep(400);
  const lobbyHit = await hitQuick(H, "click");
  ok(`방장 혼자 받는 중(${code}): 퀵슬롯 버튼 끔 모양(aria-disabled, title 은 이름 그대로) · 클릭 → 알림 '${BLOCK_TEXT}' · 창 안 열림 · 포커스·눌림 없음`, blockedOk(lobbyHit), JSON.stringify(lobbyHit));
  const lobbyArt = await quickArt(H);
  ok("끔 모양 그림: 켜짐과 같은 크기·같은 모양(알파 무늬 같음) · 색만 다름", lobbyArt.width === soloArt.width && lobbyArt.height === soloArt.height && lobbyArt.mask === soloArt.mask && lobbyArt.colors !== soloArt.colors, `${soloArt.width}x${soloArt.height}`);
  const lobbyAuto = await autoTry(H);
  ok("방장 혼자 받는 중: 자동 저장 시간이 지나도 저장 안 함 · 알림 없음 · 쌓은 시간 0", lobbyAuto.skipped && lobbyAuto.played === 0 && !/자동 저장/.test(lobbyAuto.toast), JSON.stringify(lobbyAuto));
  const direct = await H.page.evaluate(async () => ({ save: await window.webgba.player.saveState(3), load: await window.webgba.player.loadState(9) }));
  ok("세션 중 player.saveState·loadState 직접 호출도 false", direct.save === false && direct.load === false, JSON.stringify(direct));

  // ── 2명 게임 진행 ──
  await press(G, "KeyZ");
  await sleep(800);
  await G.page.click("#btnNet");
  await waitFor(() => G.page.$(`[data-action="net-near-join"][data-room="${code}"]`), 12000);
  await G.page.click(`[data-action="net-near-join"][data-room="${code}"]`);
  const joined = await waitFor(async () => (await game(H))?.count === 2 && (await game(G))?.open === 1, 25000, 200);
  await waitFor(async () => (await sheetOf(G)) === "", 5000);
  await sleep(1500);
  const gHit = await hitQuick(G, "tap");
  ok("2명 게임 중 유저(터치): 퀵슬롯 버튼 끔 모양 · 탭 → 알림 · 창 안 열림 · 포커스·눌림 없음", joined && blockedOk(gHit), JSON.stringify(gHit));
  const hHit = await hitQuick(H, "click");
  ok("2명 게임 중 방장: 클릭 → 알림 · 창 안 열림", blockedOk(hHit), JSON.stringify(hHit));
  const ink = await barInk(H);
  const spreadInk = (k) => spreadOf(ink, k);
  ok("세션 중 상단 버튼 줄(퀵슬롯 끔 포함): 버튼·그림 잉크 위·아래 차이 0", ink.some((b) => b.id === "btnQuick" && b.off) && spreadInk("top") === 0 && spreadInk("bottom") === 0 && spreadInk("it") === 0 && spreadInk("ib") === 0, JSON.stringify(ink.map((b) => `${b.id}${b.off ? "(끔)" : ""}:${b.it}-${b.ib}`)));
  await H.page.evaluate(() => window.webgba.toast("멀티플레이 중에는 사용할 수 없습니다", "warn"));
  if (SHOTS) await H.page.screenshot({ path: path.join(SHOTS, "웹_세션중_퀵슬롯_끔_390x844.png") });
  const gAuto = await autoTry(G);
  ok("2명 게임 중 유저: 자동 저장 건너뜀", gAuto.skipped && gAuto.played === 0, JSON.stringify(gAuto));

  // ── 다시 들어오기 대기(유저 끊김) ──
  await cut(G, true);
  const rejoining = await waitFor(async () => (await snap(G)).rejoining, 30000, 250);
  await G.page.evaluate(() => window.webgba.net.win.requestClose());
  await waitFor(async () => (await sheetOf(G)) === "", 3000);
  const rHit = await hitQuick(G, "tap");
  const rAuto = await autoTry(G);
  ok("다시 들어오기 대기(끊긴 유저): 퀵슬롯 버튼 끔 · 탭 → 알림 · 자동 저장 건너뜀", Boolean(rejoining) && blockedOk(rHit) && rAuto.skipped, JSON.stringify({ rHit, rAuto }));
  await cut(G, false);
  const back = await waitFor(async () => {
    const s = await snap(G);
    return s.connected && !s.rejoining;
  }, 40000, 250);
  ok("끊긴 유저 돌아옴(세션 계속 = 계속 막힘)", Boolean(back) && (await quickView(G)).aria === "true", JSON.stringify(await snap(G)));

  // ── 세션 끝 → 다시 동작 ──
  await H.page.evaluate(() => window.webgba.player.net.leave());
  const ended = await waitFor(async () => !(await quickView(G)).locked && !(await quickView(H)).locked, 10000);
  await waitFor(async () => (await sheetOf(G)) === "", 3000);
  const endView = await quickView(G);
  ok("세션 끝(방장 나감): 방장·유저 퀵슬롯 버튼 다시 켜짐", Boolean(ended) && endView.aria === "false" && !endView.drawnOff && (await quickView(H)).aria === "false", JSON.stringify(endView));
  const endHit = await hitQuick(G, "tap");
  ok("세션 끝: 탭 → 퀵슬롯 창 열림", endHit.sheet === "quick", JSON.stringify(endHit));
  await G.page.click("#sheetClose");
  await waitFor(async () => (await sheetOf(G)) === "", 3000);
  const endAuto = await autoTry(G);
  const endAutoH = await autoTry(H);
  ok("세션 끝: 자동 저장 다시 동작(방장·유저)", endAuto.saved && endAutoH.saved, JSON.stringify({ endAuto, endAutoH }));
  for (const p of [H, G]) await p.context.close();
}
