// 웹 webGBA 멀티플레이 MP2 시험 — 짝 찾기 서버(방 코드·근처 방)로 페이지 2~4개를 잇는다.
//   node web/test/web-mp.mjs --webapi <net-webapi 예제 폴더> [--browser chrome|edge] [--shots <캡처 폴더>] [--out <결과 json>]
//   [--capture <폴더>] = 기능 캡처(설정 인터넷 항목·상태 메뉴 끊김 줄). [--base https://webgba.vercel.app/] 를 주면 로컬 서버 대신 그 주소(실제 서버)로 방 코드·근처 방 연결 1회만 확인한다.
// 로컬은 tools/test/mp-local.mjs(web/dist + /api/v1/mp + 메모리 가짜 Upstash). PLAYWRIGHT_DIR 가 없으면 저장소 node_modules.
//   [--only base,rejoin,wan,ice,anytime] 로 묶음을 고른다(기본 전부). rejoin = 다시 들어오기(손님 끊김 20초·ICE 재시작·방장 끊김·선택 안 한 게임),
//   wan = 인터넷 연결 설정(STUN 후보·코드), ice = 게임별 연결 서버(credentialUrl 정상·시간 초과·잘못된 응답, 설정 끔, 지정 안 한 게임),
//   anytime = 중간 참가 게임(join: "anytime" — 창 자동 열림·시간 초과 없음, 방장 혼자 창 닫기·방 유지 Upstash 명령 수, 손님 참가 알림, 다시 들어오기·인터넷 연결과 함께).
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
const ONLY = new Set(String(opt.only ?? "base,rejoin,wan,ice,anytime").split(","));
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

async function peer(name, { nick = "", ip = "", prefs = {} } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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
  const n = document.querySelector("#sheetBody .net-error");
  return n && !n.hidden ? n.textContent : "";
});
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
  if (ONLY.has("wan")) await wanTests();
  if (ONLY.has("ice") && !REMOTE) await iceTests();
  if (opt.turn && !REMOTE) await turnTests();
  if (ONLY.has("anytime") && !REMOTE) await anytimeTests();
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
  await H.page.click('[data-action="net-room-make"]');
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
    await A.page.click('[data-action="net-room-make"]');
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
    await H2.page.click('[data-action="net-room-make"]');
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
      await X.page.click('[data-action="net-back"]');
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
    await F.page.click('[data-action="net-room-make"]');
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
    return { active: s.active, connected: s.connected, rejoining: s.rejoining, rejoinable: s.rejoinable, state: s.rejoinState, slot: s.slot, count: s.count, members: s.members.map((m) => ({ slot: m.slot, held: m.held, stalled: m.stalled, rejoining: m.rejoining })) };
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
  await H.page.click('[data-action="net-room-make"]');
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

async function wanTests() {
  const W = await peer("W", { nick: "인터넷 켬", prefs: { netWan: true } });
  const L = await peer("L", { nick: "인터넷 끔" });
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
  const lead = await text(W, "#sheetBody .net-note");
  await W.page.click('[data-action="net-room-make"]');
  const code = await roomCode(W);
  await waitFor(() => W.page.evaluate(() => Boolean(window.webgba.net.win.roomHost?.invite)), 5000);
  const on = await offerInfo(W);
  ok("인터넷 연결 켬: 기본 STUN 2곳 · 공인 주소 후보(srflx) 수집 · 방 연결 정보에 포함(인터넷 표시) · 안내 문구", on.public > 0 && on.types.includes("srflx") && on.flag && /stun\.l\.google\.com/.test(on.servers.join()) && /stun\.cloudflare\.com/.test(on.servers.join()) && /다른 곳에 있는 친구/.test(lead), JSON.stringify({ public: on.public, types: on.types, flag: on.flag, servers: on.servers.slice(0, 1) }));
  await open(L);
  await want(L);
  await L.page.click('[data-action="net-room-join"]');
  await L.page.fill('[data-action="net-code-in"]', code);
  await L.page.click('[data-action="net-code-go"]');
  const joined = await waitFor(async () => (await game(L))?.open === 1, 25000, 200);
  const lInfo = await L.page.evaluate(() => {
    const s = window.webgba.player.net.session;
    const types = (s?.link?.pc?.localDescription?.sdp ?? "").split("\r\n").filter((l) => l.startsWith("a=candidate")).map((l) => l.split(" ")[7]);
    return { peerWan: s?.peerWan, types, servers: window.__rtcConfigs.map((c) => (c.iceServers ?? []).length) };
  });
  ok("한쪽만 켬(방장 켬·손님 끔): 같은 와이파이는 연결됨 · 끈 쪽은 STUN 없음·공인 후보 없음", joined && lInfo.peerWan === true && !lInfo.types.includes("srflx") && lInfo.servers.every((n) => n === 0), JSON.stringify(lInfo));
  await L.context.close();
  await W.context.close();
  const O = await peer("O2", { nick: "끔 방장" });
  await open(O);
  await want(O);
  await O.page.click('[data-action="net-room-make"]');
  await roomCode(O);
  await waitFor(() => O.page.evaluate(() => Boolean(window.webgba.net.win.roomHost?.invite)), 5000);
  const off = await offerInfo(O);
  ok("인터넷 연결 끔(기본): STUN 없음 · 공인 후보 없음 · 망 안 후보만(기존 그대로)", off.public === 0 && !off.types.includes("srflx") && !off.flag && off.servers.length === 0, JSON.stringify(off));
  await O.context.close();
  const S = await peer("S", { nick: "설정", prefs: { netWan: true } });
  await S.page.evaluate(() => window.webgba.openSheet("settings"));
  await sleep(500);
  const item = await S.page.evaluate(() => {
    const label = [...document.querySelectorAll("#sheetBody *")].find((n) => n.childElementCount === 0 && n.textContent === "인터넷 연결(실험)");
    const row = label?.closest(".field, .item, label, li, .row") ?? label?.parentElement;
    row?.scrollIntoView({ block: "center" });
    return { found: Boolean(label), text: row?.textContent ?? "" };
  });
  await sleep(300);
  ok("설정 › 멀티플레이 '인터넷 연결(실험)'(설명: 방 코드·실패할 수 있는 망·공인 IP)", item.found && /공인 IP/.test(item.text) && /휴대폰 데이터/.test(item.text), item.text.slice(0, 120));
  if (CAPTURE) await S.page.screenshot({ path: path.join(CAPTURE, "설정_인터넷연결_390x844.png") });
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
  const I = await peer("I", { nick: "게임 서버", prefs: { netWan: true } });
  await I.context.route("https://cred.example.test/**", cred);
  const make = async (p) => {
    await open(p, "iced");
    await want(p);
    const note = await p.page.evaluate(() => [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" | "));
    await p.page.click('[data-action="net-room-make"]');
    await roomCode(p);
    const info = await p.page.evaluate(() => ({ cfg: window.__rtcConfigs.at(-1)?.iceServers ?? [], failed: window.webgba.player.net.snapshot().iceFailed, note: [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" | ") }));
    await p.page.click('[data-action="net-cancel"]').catch(() => {});
    await sleep(300);
    return { ...info, lead: note };
  };
  const a = await make(I);
  const urls = a.cfg.map((s) => [].concat(s.urls).join(","));
  ok("게임 연결 서버(설정 켬): 게임 목록만 사용(기본 STUN 없음) · credentialUrl 접속 정보 적용 · 연결 창 '이 게임의 연결 서버' 표시", calls === 1 && urls.length === 2 && urls[0].startsWith("stun:stun.example.test") && a.cfg[1].username === "u-test" && a.cfg[1].credential === "c-test" && !/google|cloudflare/.test(urls.join()) && /이 게임의 연결 서버: stun\.example\.test, turn\.example\.test/.test(a.lead), JSON.stringify({ calls, urls, lead: a.lead.slice(0, 160) }));
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
  const F = await peer("F2", { nick: "끔" });
  calls = 0;
  mode = "ok";
  await F.context.route("https://cred.example.test/**", cred);
  const d = await make(F);
  ok("설정 끔: 게임 연결 서버도 쓰지 않음(요청 없음·STUN 없음·표시 없음)", calls === 0 && d.cfg.length === 0 && !/연결 서버/.test(d.lead), JSON.stringify({ calls, cfg: d.cfg.length }));
  await F.context.close();
}

// --turn <host:port> (e.g. a local coturn: --lt-cred-mech --user test:secret) forces iceTransportPolicy "relay" so the game's TURN server carries the channel.
async function turnTests() {
  const manifest = { ...webapiArgs.manifest, id: "com.example.netturn", multiplayer: { ...webapiArgs.manifest.multiplayer, iceServers: [{ urls: `turn:${opt.turn}?transport=udp`, username: "test", credential: "secret" }] } };
  files.turned = (await packWgba({ ...webapiArgs, manifest })).bytes;
  const H = await peer("TH", { nick: "TURN 방장", prefs: { netWan: true } });
  const G = await peer("TG", { nick: "TURN 손님", prefs: { netWan: true } });
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
  return p.page.evaluate(() => [...document.querySelectorAll("#sheetBody .net-actions > button")].map((n) => {
    const r = n.getBoundingClientRect();
    return { a: n.dataset.action, top: r.top, bottom: r.bottom };
  }));
}

async function anytimeTests() {
  // ── 중간 참가 게임: 창 자동 열림 없음 · 시간 초과 없음 · 방장 혼자 창 닫기 · 방 유지 · 손님 참가 알림 ──
  const H = await peer("AH", { nick: "중간 방장" });
  const G = await peer("AG", { nick: "중간 손님" });
  for (const p of [H, G]) await open(p, "anytime");
  await press(H, "KeyZ");
  await sleep(1500);
  const quiet = await H.page.evaluate(() => ({ sheet: window.webgba.state.sheet, request: Boolean(window.webgba.player.net.request), timer: Boolean(window.webgba.player.net.windowTimer), btn: !document.getElementById("btnNet").hidden }));
  ok("중간 참가 게임: 요청해도 창 자동 열림 없음 · 시간 초과 타이머 없음 · 상단 멀티플레이 버튼 표시", quiet.sheet === "" && quiet.request && !quiet.timer && quiet.btn, JSON.stringify(quiet));
  await H.page.click("#btnNet");
  await waitFor(async () => (await sheetOf(H)) === "net" && Boolean(await H.page.$('[data-action="net-room-make"]')), 5000);
  await H.page.click('[data-action="net-room-make"]');
  const code = await roomCode(H);
  await sleep(400);
  const acts = await actionRow(H);
  const note = await H.page.evaluate(() => [...document.querySelectorAll("#sheetBody .net-note")].map((n) => n.textContent).join(" | "));
  ok("방장 혼자 방 코드 화면: 하단 버튼 방 나가기·닫기(위·아래 차이 0) · 방 유지 안내", acts.map((b) => b.a).join() === "net-leave,net-close" && spreadOf(acts, "top") === 0 && spreadOf(acts, "bottom") === 0 && /방은 계속 열려 있습니다/.test(note), `${code} · ${JSON.stringify(acts)}`);
  await shot(H, "중간참가_방코드_390x844.png");
  await H.page.click('[data-action="net-close"]');
  const closed = await waitFor(async () => (await sheetOf(H)) === "", 4000, 100);
  await sleep(600);
  const keep = await H.page.evaluate(() => {
    const net = window.webgba.player.net;
    const rh = window.webgba.net.win.roomHost;
    return { active: net.active, waiting: net.waiting, polling: Boolean(rh?.running && rh.active && !rh.parked), timer: Boolean(net.windowTimer) };
  });
  const bar = await topBar(H);
  const btn = bar.find((b) => b.id === "btnNet");
  ok("방장 혼자 창 닫기 → 게임 계속 · 방 유지(받기 계속) · 상단 버튼 배지 1/4 회색(기다리는 중)·제목", closed && keep.active && keep.waiting && keep.polling && !keep.timer && (await game(H))?.closed === 0 && btn?.badge === "1/4" && btn.tone === "wait" && /기다리는 중/.test(btn.title), JSON.stringify({ keep, btn }));
  ok("기다리는 중 상단 버튼 줄: 위·아래 차이 0(버튼·그림)", spreadOf(bar, "top") === 0 && spreadOf(bar, "bottom") === 0 && spreadOf(bar, "ct") === 0 && spreadOf(bar, "cb") === 0, JSON.stringify(bar.map((b) => `${b.id}:${b.top}-${b.bottom}${b.badge ? `(${b.badge})` : ""}`)));
  if (CAPTURE) await H.page.screenshot({ path: path.join(CAPTURE, "웹_기다리는중_상단버튼_390x844.png") });
  const waitMs = opt.fast ? 15000 : 70000;
  const c0 = stats();
  const api0 = local.apiCalls.length;
  await sleep(waitMs);
  const used = stats() - c0;
  const ops = local.apiCalls.slice(api0).map((c) => c.op);
  const still = await H.page.evaluate(() => ({ active: window.webgba.player.net.active, ended: window.webgba.player.net.ended }));
  ok(`창을 닫은 채 ${waitMs / 1000}초 방 유지: 끝남·시간 초과 없음 · Upstash ${used}명령(요청 ${ops.length}회: ${[...new Set(ops)].map((o) => `${o} ${ops.filter((x) => x === o).length}`).join(", ")})`, still.active && !still.ended && (await game(H))?.closed === 0, JSON.stringify(still));

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
  if (CAPTURE) await H.page.screenshot({ path: path.join(CAPTURE, "웹_손님참가_알림_390x844.png") });
  const joined = await waitFor(async () => (await game(H))?.count === 2 && (await game(G))?.open === 1, 10000, 200);
  const hBtn = (await topBar(H)).find((b) => b.id === "btnNet");
  ok("손님: 창 자동 열림 없음 → 버튼으로 근처 방 들어가기 · 방장: 창 닫힌 채 토스트 알림·배지 2/4(기다리는 중 아님)", gQuiet === "" && Boolean(listed) && joined && Boolean(toastSeen) && (await sheetOf(H)) === "" && hBtn?.badge === "2/4" && hBtn.tone === "", `${toastSeen} · ${JSON.stringify(hBtn)}`);
  await H.page.click("#btnNet");
  const boardOn = await waitFor(() => H.page.evaluate(() => window.webgba.net.board.state.open), 3000);
  ok("최소 인원 뒤 방장 상단 버튼 = 상태 메뉴", boardOn);
  await H.page.evaluate(() => window.webgba.net.board.close({ instant: true }));

  const C = await peer("AC", { nick: "중간 취소" });
  await open(C, "anytime");
  await press(C, "KeyZ");
  await sleep(800);
  await C.page.click("#btnNet");
  await waitFor(() => C.page.$('[data-action="net-cancel"]'), 4000);
  await C.page.click('[data-action="net-cancel"]');
  await sleep(600);
  const cState = await C.page.evaluate(() => ({ sheet: window.webgba.state.sheet, request: Boolean(window.webgba.player.net.request), btn: !document.getElementById("btnNet").hidden }));
  ok("중간 참가 게임 창 취소: 게임에 CLOSED 없음 · 요청·버튼 유지", (await game(C))?.closed === 0 && cState.sheet === "" && cState.request && cState.btn, JSON.stringify({ cState, game: await game(C) }));
  await C.context.close();

  await H.page.evaluate(() => window.webgba.net.open());
  await waitFor(() => H.page.$('[data-action="net-leave"]'), 4000);
  await H.page.click('[data-action="net-leave"]');
  const left = await waitFor(async () => (await game(G))?.closed === 7 && (await game(H))?.closed === 6, 8000);
  ok("방장 방 나가기 → 손님 CLOSED(HOST_LEFT) · 방장 CLOSED(LEFT)", left, JSON.stringify({ h: await game(H), g: await game(G) }));
  for (const p of [H, G]) await p.context.close();

  // ── 중간 참가 + 다시 들어오기 + 인터넷 연결 ──
  const RH = await peer("ARH", { nick: "중간 방장 R", prefs: { netWan: true } });
  const RG = await peer("ARG", { nick: "중간 손님 R", prefs: { netWan: true } });
  for (const p of [RH, RG]) await open(p, "anytimeRejoin");
  await press(RH, "KeyZ");
  await sleep(800);
  await RH.page.click("#btnNet");
  await waitFor(() => RH.page.$('[data-action="net-room-make"]'), 5000);
  await RH.page.click('[data-action="net-room-make"]');
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
  const rInfo = await RH.page.evaluate(() => ({ rejoin: window.webgba.net.win.roomHost?.rejoin === true && window.webgba.player.net.session?.rejoinable === true, wan: window.webgba.player.net.snapshot().wan }));
  ok("중간 참가 + 다시 들어오기 + 인터넷 연결 켬: 창을 닫아 둔 방에 방 코드로 연결 · 다시 들어오기 켜짐", rOn && rInfo.rejoin && rInfo.wan, JSON.stringify(rInfo));
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
