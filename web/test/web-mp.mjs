// 웹 webGBA 멀티플레이 MP2 시험 — 짝 찾기 서버(방 코드·근처 방)로 페이지 2~4개를 잇는다.
//   node web/test/web-mp.mjs --webapi <net-webapi 예제 폴더> [--browser chrome|edge] [--shots <캡처 폴더>] [--out <결과 json>]
//   [--base https://webgba.vercel.app/] 를 주면 로컬 서버 대신 그 주소(실제 서버)로 방 코드·근처 방 연결 1회만 확인한다.
// 로컬은 tools/test/mp-local.mjs(web/dist + /api/v1/mp + 메모리 가짜 Upstash). PLAYWRIGHT_DIR 가 없으면 저장소 node_modules.
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
const REMOTE = opt.base ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

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
};

const browser = await chromium.launch({ executablePath: BROWSERS[which], headless: true });
const peers = [];

async function peer(name, { nick = "", ip = "" } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addInitScript((nick) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (nick) localStorage.setItem("webgba.prefs", JSON.stringify({ netNick: nick, lang: "ko" }));
  }, nick);
  if (ip && !REMOTE) await context.route("**/api/**", (route) => route.continue({ headers: { ...route.request().headers(), "x-test-ip": ip } }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
