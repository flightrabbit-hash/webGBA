// 멀티플레이 MP2 exe 본 창 시험 — 실제 앱(방장)이 짝 찾기 서버로 방을 만들고, 크롬 웹 페이지(손님)가 방 코드로 들어온다.
//   node tools/test/app-mp.mjs <exe> <작업 폴더> <net-webapi 예제 폴더> [--web https://webgba.vercel.app/]
// exe 는 늘 https://webgba.vercel.app/api/v1/mp 를 쓰므로 배포 뒤에 돌린다. 손님 웹 페이지 주소 기본 = 같은 배포.
// 앱 폴더 <작업>\app_mp(레지스트리 안 건드림). 결과 <작업>\app_mp_result.json, 캡처 <작업>\captures\exe_mp_*.png
// 같은 줄 맞춤: 레일(세로) 버튼은 좌·우 위치 차이 0(멀티플레이 켜짐 포함), 연결 창 버튼 줄은 위·아래 차이 0.
// 첫 화면·인터넷 없이 연결 화면은 버튼마다 현재 언어 이름 줄(이름 + 대문자 영어 버튼), 이름·버튼 글자 잉크 세로 가운데(캡처 픽셀).
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { attach, guardOthers, launch, prepareApp, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { decodePng } from "../../web/test/png.mjs";

//   [--api <짝 찾기 서버 주소>] = exe 의 서버 주소를 시험 중에만 바꿈(예: tools/test/mp-local.mjs 의 http://127.0.0.1:8791/api/v1/mp/).
//   [--only base,wan,rejoin,anytime] — wan = exe 기본 인터넷 연결(STUN 공인 후보·기본 TURN 발급 요청), rejoin = exe 유저 끊김 20초 → 같은 자리(서버가 rj 를 알아야 함),
//   anytime = 중간 참가 게임(join: "anytime"): 창 자동 열림 없음 → 레일 버튼으로 방 만들기 → 혼자 창 닫기 → 레일 점·상태 줄 "기다리는 중" → 웹 손님 참가 알림.
//   nosave = 세션 중 상태 저장·불러오기 막음(레일 끔 모양·이유 title·클릭·Shift+F1/F1·게임 메뉴 → 상태 줄 경고, 언어 바꾸기, 세션 끝 = 다시 동작).
//   [--capture <폴더>] = anytime 캡처를 그 폴더에도.
const [exe, work, example, ...rest] = process.argv.slice(2);
if (!exe || !work || !example) {
  console.error("사용법: node tools/test/app-mp.mjs <exe> <작업 폴더> <net-webapi 예제 폴더> [--web <주소>] [--api <주소>] [--only base,wan,rejoin,anytime,nosave] [--capture <폴더>]");
  process.exit(2);
}
const WEB = rest.includes("--web") ? rest[rest.indexOf("--web") + 1] : "https://webgba.vercel.app/";
const API = rest.includes("--api") ? rest[rest.indexOf("--api") + 1] : "";
const ONLY = new Set((rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : "base,wan,rejoin,anytime,nosave").split(","));
const CAPTURE = rest.includes("--capture") ? rest[rest.indexOf("--capture") + 1] : "";
const PORT = 9352;
const appDir = path.join(work, "app_mp");
const shots = path.join(work, "captures");
fs.mkdirSync(shots, { recursive: true });
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
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

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const wgba = (await packWgba({ wasm: fs.readFileSync(path.join(example, "game.wasm")), manifest: readJson(path.join(example, "manifest.json")) })).bytes;
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
const gameFile = path.join(appDir, "net-demo.wgba");
fs.writeFileSync(gameFile, wgba);

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window === window.top) localStorage.setItem("webgba.installHint", "1");
});
const page = await context.newPage();
const GAME = `(() => { const ex = ${T}.player.host?.ex; return ex?.Net_Hash ? { open: ex.Net_Open(), count: ex.Net_Count(), slot: ex.Net_Slot(), closed: ex.Net_Closed() } : null; })()`;
const webGame = () => page.evaluate(() => {
  const ex = window.webgba.player.host?.ex;
  return ex?.Net_Hash ? { open: ex.Net_Open(), count: ex.Net_Count(), slot: ex.Net_Slot(), closed: ex.Net_Closed() } : null;
});
const RAIL = `(() => [...document.querySelectorAll(".railbar .iconbtn")].filter((n) => !n.hidden && n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); return { id: n.id, left: r.left, right: r.right, w: r.width, h: r.height, on: n.getAttribute("aria-pressed") }; }))()`;
const ACTIONS = `(() => [...document.querySelectorAll("#dialog-actions > button, #dialog-body .net-line")].map((n) => n.matches(".net-line") ? [...n.querySelectorAll(":scope > button, :scope > input")] : [n]).filter((g) => g.length).map((g) => g.map((n) => { const r = n.getBoundingClientRect(); return { a: n.dataset.action || n.textContent, top: r.top, bottom: r.bottom }; })))()`;
const spread = (list, k) => +(Math.max(...list.map((i) => i[k])) - Math.min(...list.map((i) => i[k]))).toFixed(2);
const ko = readJson(fileURLToPath(new URL("../../src-bundle/src/i18n/ko.json", import.meta.url)));
const ENTRIES = `[...document.querySelectorAll("#dialog-body .net-entry")].map((n) => ({ label: n.querySelector(".net-entry__label")?.textContent ?? "", button: n.querySelector("button")?.textContent ?? "" }))`;
const ROWS = `[...document.querySelectorAll("#dialog-body .net-entry, #dialog-body .net-offline")].filter((n) => !n.hidden).map((n) => { const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }; return { name: n.querySelector("button").textContent, row: box(n), label: box(n.querySelector("span")), button: box(n.querySelector("button")) }; })`;

// ink rows of a box in device pixels: the first and last rows with non-background pixels (the background = the box's most common colour)
function inkRows(image, x0, x1, y0, y1) {
  const px = (x, y) => {
    const o = (y * image.width + x) * 4;
    return [image.data[o], image.data[o + 1], image.data[o + 2]];
  };
  const counts = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) counts.set(px(x, y).join(), (counts.get(px(x, y).join()) ?? 0) + 1);
  const bg = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (Math.max(...px(x, y).map((v, i) => Math.abs(v - bg[i]))) > 48) {
        if (first < 0) first = y;
        last = y;
        break;
      }
  return first < 0 ? null : { first, last };
}

// the name's ink centred in its row and the button as tall as the row. Gaps from the row's exact edges: the dialog sits on a
// half CSS pixel when its height is odd and the glyphs snap to whole device pixels, so ≤ 2 device pixels apart (a 1 CSS px miss
// is 3 at 1.5x). The button's own caps are judged the same way (`text`, ≤ 2 device pixels).
async function entryInks() {
  const rows = await app.evaluate(ROWS);
  const dpr = await app.evaluate("devicePixelRatio");
  const image = decodePng(Buffer.from((await app.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const inset = Math.ceil(dpr) + 1;
  const gaps = (ink, top, bottom) => ink && { top: +(ink.first - top).toFixed(1), bottom: +(bottom - ink.last - 1).toFixed(1) };
  return rows.map((r) => {
    const d = (v) => Math.round(v * dpr);
    const label = gaps(inkRows(image, d(r.label.left), d(r.label.right), d(r.row.top), d(r.row.bottom)), r.row.top * dpr, r.row.bottom * dpr);
    const text = gaps(inkRows(image, d(r.button.left) + inset, d(r.button.right) - inset, d(r.button.top) + inset, d(r.button.bottom) - inset), r.button.top * dpr, r.button.bottom * dpr);
    const ok = Boolean(label) && Math.abs(label.top - label.bottom) <= 2 && Boolean(text) && Math.abs(text.top - text.bottom) <= 2 && r.button.top === r.row.top && r.button.bottom === r.row.bottom;
    return { name: r.name, label: label && `${label.top}/${label.bottom}`, text: text && `${text.top}/${text.bottom}`, ok };
  });
}

let app = null;
try {
  guardOthers(exe, appDir);
  const appExe = prepareApp(exe, appDir);
  launch(appExe, PORT, [gameFile]);
  app = await attach(PORT);
  check("exe 가 net 예제(.wgba) 실행", await waitFor(() => app.evaluate(`${T}.player.running === true`), 20000));
  if (API) await app.evaluate(`${T}.netWin.signal.base = ${JSON.stringify(API)}`);
  if (ONLY.has("base")) await baseFlow();
  if (ONLY.has("wan")) await wanFlow();
  if (ONLY.has("rejoin")) await rejoinFlow();
  if (ONLY.has("anytime")) await anytimeFlow();
  if (ONLY.has("nosave")) await nosaveFlow();
} catch (error) {
  check("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
} finally {
  if (app) {
    try {
      await app.evaluate(`${T}.shutdown()`);
    } catch {}
    app.close();
  }
  await browser.close().catch(() => {});
}
fs.writeFileSync(path.join(work, "app_mp_result.json"), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\nexe 멀티플레이: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);

async function baseFlow() {
  await app.evaluate(`(() => { const p = ${T}.player; p.keyDown("KeyZ"); setTimeout(() => p.keyUp("KeyZ"), 150); return true; })()`);
  const layer = await waitFor(() => app.evaluate("!document.getElementById('layer').hidden && Boolean(document.querySelector('#dialog-body .net-tabset'))"), 8000);
  check("exe: 연결 창 첫 화면(참가하기·방 만들기 탭 · 열린 방 · 방 코드 6칸 · 인터넷 없이 연결)", layer && (await app.evaluate("Boolean(document.querySelector('[data-action=net-room-join]') && document.querySelector('[data-action=net-tab-make]') && document.querySelector('[data-action=net-offline]') && document.querySelector('.net-near-box') && document.querySelectorAll('.net-cell').length === 6)")));
  const labels = await app.evaluate(`[...document.querySelectorAll("#dialog-body .net-tab, #dialog-actions .btn, #dialog-body .net-coderow .btn")].map((n) => n.textContent).join(",")`);
  check("exe: 탭 글자(현재 언어) · 버튼 대문자 영어(EDIT·OFFLINE·ENTER)", labels === `${ko["net.join"]},${ko["net.make"]},ENTER,EDIT,OFFLINE`, labels);
  const near = await waitFor(() => app.evaluate("(() => { const t = document.querySelector('.net-near-box')?.textContent ?? ''; return /…/.test(t) ? '' : t; })()"), 10000);
  check("exe: 열린 방 영역 서버 응답(목록 또는 없음 안내)", near && !/불러오지 못했/.test(near), near);
  await sleep(300);
  const codeRow = await app.evaluate(`(() => [...document.querySelectorAll(".net-coderow .net-cell, .net-coderow > .btn")].map((n) => { const r = n.getBoundingClientRect(); return { a: n.className, top: r.top, bottom: r.bottom }; }))()`);
  check("exe: 코드 칸·ENTER 위·아래 차이 0", codeRow.length === 7 && spread(codeRow, "top") === 0 && spread(codeRow, "bottom") === 0, JSON.stringify(codeRow.map((c) => `${c.top}-${c.bottom}`)));
  await app.screenshot(path.join(shots, "exe_mp_첫화면.png"));
  await app.evaluate("document.querySelector('[data-action=net-offline]').click()");
  await sleep(300);
  const lan = await app.evaluate(ENTRIES);
  const lanInks = await entryInks();
  check("exe: 인터넷 없이 연결 화면 이름 줄(방 만들기 CREATE · 참가하기 JOIN)·잉크 세로 가운데", lan.map((e) => `${e.label}|${e.button}`).join(",") === `${ko["net.make"]}|CREATE,${ko["net.join"]}|JOIN` && lanInks.length === 2 && lanInks.every((i) => i.ok), JSON.stringify({ lan, lanInks }));
  await app.evaluate("document.querySelector('[data-action=net-back]').click()");
  await appMake();
  const code = await waitFor(() => app.evaluate("(() => { const t = document.querySelector('.net-room-code')?.textContent ?? ''; return /^\\d{6}$/.test(t) ? t : ''; })()"), 15000);
  check("exe: 서버로 방 만들기 → 방 코드 6자리", /^\d{6}$/.test(code ?? ""), code);
  await sleep(300);
  await app.screenshot(path.join(shots, "exe_mp_방코드.png"));
  const rows = await app.evaluate(ACTIONS);
  check("exe: 연결 창 버튼 줄 위·아래 차이 0", rows.every((g) => g.length < 2 || (spread(g, "top") === 0 && spread(g, "bottom") === 0)), JSON.stringify(rows.map((g) => g.map((i) => `${i.a}:${i.top}-${i.bottom}`))));

  const t0 = Date.now();
  await page.goto(WEB);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], "net-demo.wgba")]);
  }, Buffer.from(wgba).toString("base64"));
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
  await page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("KeyZ");
    setTimeout(() => p.keyUp("KeyZ"), 150);
  });
  await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await page.click('[data-action="net-room-join"]');
  await page.fill('[data-action="net-code-in"]', code);
  await page.click('[data-action="net-code-go"]');
  const joined = await waitFor(async () => (await webGame())?.open === 1 && (await app.evaluate(GAME))?.count === 2, 30000, 200);
  const calls = { host: await app.evaluate(`${T}.netWin?.signal?.calls ?? -1`).catch(() => -1), guest: await page.evaluate(() => window.webgba.net.win.signal.calls) };
  check(`exe(방장) ↔ 크롬(손님) 방 코드로 연결(${Date.now() - t0}ms)`, joined, JSON.stringify({ calls, host: await app.evaluate(GAME), guest: await webGame() }));
  await sleep(500);
  await app.screenshot(path.join(shots, "exe_mp_연결됨.png"));
  await app.evaluate("document.querySelector('[data-action=net-done]')?.click()");
  await sleep(600);
  const rail = await app.evaluate(RAIL);
  check("exe: 레일 버튼 좌·우 위치·크기 같음(멀티플레이 켜짐 포함)", rail.some((b) => b.id === "btn-net" && b.on === "true") && spread(rail, "left") === 0 && spread(rail, "right") === 0 && spread(rail, "w") === 0 && spread(rail, "h") === 0, JSON.stringify(rail.map((b) => `${b.id}:${b.left}-${b.right}${b.on === "true" ? "(켜짐)" : ""}`)));
  await app.evaluate(`${T}.player.net.leave()`);
  check("exe 방장 나감 → 웹 손님 CLOSED(HOST_LEFT)", await waitFor(async () => ((await webGame())?.closed === 7 ? true : null), 8000));
}

function appWant() {
  return app.evaluate(`(() => { const p = ${T}.player; p.keyDown("KeyZ"); setTimeout(() => p.keyUp("KeyZ"), 150); return true; })()`);
}

function appDialog(action) {
  return waitFor(() => app.evaluate(`!document.getElementById('layer').hidden && Boolean(document.querySelector('#dialog-body [data-action=${action}]'))`), 10000);
}

// 연결 창 탭 B: 방 만들기 탭 → 방 만들기(마지막 탭 기억이라 이미 그 탭일 수 있음)
async function appMake() {
  await appDialog("net-tab-make");
  await app.evaluate("document.querySelector('[data-action=net-tab-make]').click()");
  await appDialog("net-room-make");
  await app.evaluate("document.querySelector('[data-action=net-room-make]').click()");
}

async function wanFlow() {
  await app.evaluate(`${T}.openPath(${JSON.stringify(gameFile)})`);
  await waitFor(() => app.evaluate(`${T}.player.running === true && !${T}.player.net.active`), 15000);
  await appWant();
  await appMake();
  const info = await waitFor(() => app.evaluate(`(async () => { const inv = ${T}.netWin.roomHost?.invite; if (!inv?.code) return null; const lan = await import("/js/core/net/lan.js"); const d = lan.decodeCode(inv.code, "offer", { wan: true }); return { public: inv.public, types: d.sdp.split("\\r\\n").filter((l) => l.startsWith("a=candidate")).map((l) => l.split(" ")[7]), flag: d.wan }; })()`), 15000);
  check("exe 기본(멀티 켬 = 인터넷 연결 항상): WebView2 에서 STUN 막힘 없음(공인 후보 srflx 수집 · 코드에 포함)", info && info.public > 0 && info.types.includes("srflx") && info.flag, JSON.stringify(info));
  const relay = await waitFor(() => app.evaluate(`(() => { const p = ${T}.player.net.icePlan; return p && p.relayCalls > 0 ? { calls: p.relayCalls, got: Boolean(p.relay), wait: p.relayWait > 0 } : null; })()`), 10000);
  check("exe 기본 TURN 발급 요청: 방을 만든 뒤 짝 찾기 서버 turn 요청(exe 출처 허용 — 키 없는 서버면 503 → STUN 만)", relay && relay.calls >= 1 && (relay.got || relay.wait), JSON.stringify(relay));
  await app.evaluate("document.querySelector('[data-action=net-cancel]')?.click()");
  await sleep(500);
}

function rtcWrap() {
  if (window.__rtcWrapped) return;
  window.__rtcWrapped = true;
  const Real = window.RTCPeerConnection;
  window.__netCut = false;
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

async function appCut(on) {
  await app.evaluate(`window.__netCut = ${on}`);
  await app.send("Network.enable");
  await app.send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

async function rejoinFlow() {
  const manifest = readJson(path.join(example, "manifest.json"));
  manifest.id = "com.example.netrejoin";
  manifest.multiplayer.rejoin = true;
  const rjBytes = (await packWgba({ wasm: fs.readFileSync(path.join(example, "game.wasm")), manifest })).bytes;
  const rjFile = path.join(appDir, "net-rejoin.wgba");
  fs.writeFileSync(rjFile, rjBytes);
  const hostCtx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  await hostCtx.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window === window.top) {
      localStorage.setItem("webgba.installHint", "1");
      localStorage.setItem("webgba.prefs", JSON.stringify({ netNick: "웹 방장", lang: "ko" }));
    }
  });
  const H = await hostCtx.newPage();
  await H.goto(WEB);
  await H.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await H.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], "net-rejoin.wgba")]);
  }, Buffer.from(rjBytes).toString("base64"));
  await H.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
  await H.evaluate(() => {
    window.webgba.player.keyDown("KeyZ");
    setTimeout(() => window.webgba.player.keyUp("KeyZ"), 150);
  });
  await H.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await H.click('[data-action="net-tab-make"]');
  await H.click('[data-action="net-room-make"]');
  const code = await waitFor(async () => {
    const t = await H.evaluate(() => document.querySelector(".net-room-code")?.textContent ?? "");
    return /^\d{6}$/.test(t) ? t : "";
  }, 15000);
  await app.evaluate(`(${rtcWrap.toString()})()`);
  await app.evaluate(`${T}.openPath(${JSON.stringify(rjFile)})`);
  await waitFor(() => app.evaluate(`${T}.player.running === true && !${T}.player.net.active`), 15000);
  await appWant();
  await appDialog("net-room-join");
  await app.evaluate("document.querySelector('[data-action=net-room-join]').click()");
  await appDialog("net-code-in");
  await app.evaluate(`(() => { const i = document.querySelector('[data-action=net-code-in]'); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event('input')); document.querySelector('[data-action=net-code-go]').click(); return true; })()`);
  const joined = await waitFor(async () => (await app.evaluate(GAME))?.open === 1, 30000, 250);
  const on = await app.evaluate(`({ on: ${T}.player.net.session?.rejoinable === true, slot: ${T}.player.net.session?.slot })`);
  check("exe 손님(다시 들어오기 게임) ↔ 웹 방장 방 코드 연결 · 다시 들어오기 켜짐", joined && on.on, JSON.stringify(on));
  await sleep(1500);
  const t0 = Date.now();
  await appCut(true);
  const rej = await waitFor(() => app.evaluate(`${T}.player.net.snapshot().rejoining`), 22000, 250);
  const dialog = await appDialog("net-rejoin-now");
  await sleep(400);
  const entries = await app.evaluate(ENTRIES);
  const inks = await entryInks();
  check(`exe 손님 끊김 ${((Date.now() - t0) / 1000).toFixed(1)}초 → 연결 창 '다시 연결하는 중' · 이름 줄(다시 들어가기 RETRY · 혼자 이어 하기 SOLO)·잉크 세로 가운데`, rej && dialog && entries.map((e) => `${e.label}|${e.button}`).join(",") === `${ko["net.rejoinNow"]}|RETRY,${ko["net.solo"]}|SOLO` && inks.length === 2 && inks.every((i) => i.ok), JSON.stringify({ entries, inks }));
  await app.screenshot(path.join(shots, "exe_mp_다시연결_창.png"));
  const rowsR = await app.evaluate(ACTIONS);
  check("exe 다시 연결 창 버튼 줄 위·아래 차이 0", rowsR.every((g) => g.length < 2 || (spread(g, "top") === 0 && spread(g, "bottom") === 0)), JSON.stringify(rowsR.map((g) => g.map((i) => `${i.a}:${i.top}-${i.bottom}`))));
  await app.evaluate("document.querySelector('[data-action=net-close]')?.click()");
  await sleep(300);
  await app.evaluate("document.getElementById('btn-net').click()");
  await sleep(700);
  const panel = await app.evaluate(`(() => { const box = document.querySelector('#mppanel .mpb__rejoin'); const b = [...document.querySelectorAll('#mppanel .mpb__rejoinActions .btn')].map((n) => n.getBoundingClientRect()); const t = document.querySelector('#mppanel .mpb__rejoinText'); const tr = t?.getBoundingClientRect(); return { open: !document.getElementById('mppanel').hidden, shown: Boolean(box && !box.hidden), text: t?.textContent ?? '', clipped: t ? t.scrollWidth > t.clientWidth + 1 : true, tops: b.map((r) => r.top), bottoms: b.map((r) => r.bottom), labels: [...document.querySelectorAll('#mppanel .mpb__rejoinActions .btn')].map((n) => n.textContent) }; })()`);
  check("exe 상태 패널: 다시 연결 줄(글 잘림 없음 + 두 버튼 위·아래 차이 0)", panel.open && panel.shown && !panel.clipped && panel.tops.length === 2 && panel.tops[0] === panel.tops[1] && panel.bottoms[0] === panel.bottoms[1], JSON.stringify(panel));
  await app.screenshot(path.join(shots, "exe_mp_다시연결_상태메뉴.png"));
  const held = await waitFor(() => H.evaluate(() => window.webgba.player.net.snapshot().members.some((m) => m.held)), 5000);
  check("웹 방장: exe 손님 자리 보관(끊김 · 기다리는 중)", held);
  await sleep(Math.max(0, 20000 - (Date.now() - t0)));
  const t1 = Date.now();
  await appCut(false);
  const back = await waitFor(async () => {
    const s = await app.evaluate(`(() => { const s = ${T}.player.net.snapshot(); return { c: s.connected, r: s.rejoining, slot: s.slot }; })()`);
    return s.c && !s.r && s.slot === on.slot ? s : null;
  }, 40000, 250);
  check(`exe 손님 복귀 ${((Date.now() - t1) / 1000).toFixed(1)}초 뒤 같은 자리로 들어옴`, back, JSON.stringify(back));
  await app.evaluate("document.getElementById('btn-net').click()");
  await hostCtx.close();
}

async function anytimeFlow() {
  const manifest = readJson(path.join(example, "manifest.json"));
  manifest.id = "com.example.netanytime";
  manifest.multiplayer.join = "anytime";
  const atBytes = (await packWgba({ wasm: fs.readFileSync(path.join(example, "game.wasm")), manifest })).bytes;
  const atFile = path.join(appDir, "net-anytime.wgba");
  fs.writeFileSync(atFile, atBytes);
  await app.evaluate(`${T}.openPath(${JSON.stringify(atFile)})`);
  await waitFor(() => app.evaluate(`${T}.player.running === true && !${T}.player.net.active && ${T}.state.game?.name === "net-anytime.wgba"`), 15000);
  await appWant();
  await sleep(1500);
  const quiet = await app.evaluate(`({ layer: !document.getElementById('layer').hidden, btn: !document.getElementById('btn-net').hidden, request: Boolean(${T}.player.net.request), timer: Boolean(${T}.player.net.windowTimer) })`);
  check("exe 중간 참가 게임: 요청해도 연결 창 자동 열림 없음 · 시간 초과 타이머 없음 · 레일 멀티플레이 버튼 표시", !quiet.layer && quiet.btn && quiet.request && !quiet.timer, JSON.stringify(quiet));
  await app.evaluate("document.getElementById('btn-net').click()");
  await appMake();
  const code = await waitFor(() => app.evaluate("(() => { const t = document.querySelector('.net-room-code')?.textContent ?? ''; return /^\\d{6}$/.test(t) ? t : ''; })()"), 15000);
  await sleep(300);
  const acts = await app.evaluate("[...document.querySelectorAll('#dialog-actions > button')].map((n) => { const r = n.getBoundingClientRect(); return { a: n.dataset.action, t: n.textContent, top: r.top, bottom: r.bottom }; })");
  const view = await app.evaluate("({ note: [...document.querySelectorAll('#dialog-body .net-note')].map((n) => n.textContent).join(' | '), accept: document.querySelector('#dialog-body .net-accept')?.textContent ?? '', seats: [...document.querySelectorAll('#dialog-body .net-seats .mpb__row')].map((n) => n.textContent).join(' | '), copy: document.querySelector('[data-action=net-room-copy]')?.textContent ?? '' })");
  check("exe 방장 혼자 방 코드 화면: 받는 중·남은 시간 · COPY·QR · 유저 칸(빈자리) · 하단 CLOSE ROOM·RENEW·DONE(위·아래 차이 0) · 안내 글 버튼 이름 RENEW", /^\d{6}$/.test(code ?? "") && acts.map((b) => `${b.a}:${b.t}`).join() === "net-leave:CLOSE ROOM,net-renew:RENEW,net-close:DONE" && spread(acts, "top") === 0 && spread(acts, "bottom") === 0 && view.note.includes(ko["net.exe.anytimeNote"]) && !/갱신/.test(view.note) && /2:[0-9]{2}/.test(view.accept) && view.copy === "COPY" && /2P.*기다리는 중/.test(view.seats), JSON.stringify({ code, acts, view }));
  await app.screenshot(path.join(shots, "exe_mp_중간참가_방코드.png"));
  await app.evaluate(`(() => { const rh = ${T}.netWin.roomHost; rh.limit = 25000; rh.acceptUntil = Date.now() + 25000; rh.keepAt = rh.acceptUntil + 1; rh.schedule(); })()`);
  await app.evaluate("document.querySelector('[data-action=net-close]').click()");
  await sleep(1500);
  const state = () => app.evaluate(`({ layer: !document.getElementById('layer').hidden, active: ${T}.player.net.active, dot: !document.getElementById('btn-net-dot').hidden, tone: document.getElementById('btn-net-dot').dataset.tone ?? '', title: document.getElementById('btn-net').title, status: document.getElementById('status-right')?.textContent ?? '', count: ${T}.player.net.session?.count ?? 0 })`);
  const on = await state();
  const rail = await app.evaluate(RAIL);
  const dot = await app.evaluate("(() => { const b = document.getElementById('btn-net').getBoundingClientRect(); const d = document.getElementById('btn-net-dot').getBoundingClientRect(); return { inside: d.left >= b.left && d.right <= b.right && d.top >= b.top && d.bottom <= b.bottom, w: d.width, h: d.height }; })()");
  check("exe 창 닫기(게임 중) → 받기 계속 · 레일 점 초록·제목 '참가 받는 중'·상태 줄 남은 시간", !on.layer && on.active && on.dot && on.tone === "on" && dot.inside && on.title === ko["net.buttonAccept"] && /참가 받는 중 · \d:\d{2} 남음/.test(on.status), JSON.stringify({ on, dot }));
  check("exe 받는 중 레일 버튼 좌·우 위치·크기 같음", spread(rail, "left") === 0 && spread(rail, "right") === 0 && spread(rail, "w") === 0 && spread(rail, "h") === 0, JSON.stringify(rail.map((b) => `${b.id}:${b.left}-${b.right}`)));
  if (CAPTURE) await app.screenshot(path.join(CAPTURE, "exe_받는중_레일버튼.png"));

  const guestPage = async (nick) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((nick) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window === window.top) {
        localStorage.setItem("webgba.installHint", "1");
        localStorage.setItem("webgba.prefs", JSON.stringify({ netNick: nick, lang: "ko" }));
      }
    }, nick);
    const p = await ctx.newPage();
    await p.goto(WEB);
    await p.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    await p.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.webgba.openFiles([new File([bytes], "net-anytime.wgba")]);
    }, Buffer.from(atBytes).toString("base64"));
    await p.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
    await p.evaluate(() => {
      window.webgba.player.keyDown("KeyZ");
      setTimeout(() => window.webgba.player.keyUp("KeyZ"), 150);
    });
    await sleep(800);
    await p.click("#btnNet");
    await p.waitForSelector('[data-action="net-room-join"]', { timeout: 8000 });
    await p.click('[data-action="net-room-join"]');
    await p.fill('[data-action="net-code-in"]', code);
    await p.click('[data-action="net-code-go"]');
    return { ctx, p, game: () => p.evaluate(() => { const ex = window.webgba.player.host?.ex; return ex?.Net_Hash ? { open: ex.Net_Open(), slot: ex.Net_Slot(), closed: ex.Net_Closed() } : null; }) };
  };
  const G = await guestPage("웹 유저");
  const joined = await waitFor(async () => (await G.game())?.open === 1 && (await app.evaluate(GAME))?.count === 2, 30000, 200);
  const after = await app.evaluate(`({ status: document.getElementById('status').textContent, layer: !document.getElementById('layer').hidden })`);
  check("exe 방장(게임 중): 웹 유저가 받는 시간 안에 방 코드로 들어옴 → 상태 줄 참가 알림 · 창 닫힌 채", joined && /들어왔습니다/.test(after.status) && !after.layer, JSON.stringify(after));
  await app.screenshot(path.join(shots, "exe_mp_중간참가_유저참가.png"));
  await waitFor(() => app.evaluate(`${T}.netWin.roomHost?.pausedAt > 0`), 35000, 300);
  await sleep(1500);
  const off = await state();
  check("exe 받는 시간(시험 25초) 지나면 자동 멈춤 · 레일 점 회색·제목·상태 줄 '참가 받기 멈춤' · 유저 그대로", off.dot && off.tone === "off" && off.title === ko["net.buttonPaused"] && /참가 받기 멈춤/.test(off.status) && off.count === 2 && (await G.game())?.open === 1, JSON.stringify(off));
  if (CAPTURE) await app.screenshot(path.join(CAPTURE, "exe_멈춤_레일버튼.png"));
  await app.evaluate("document.getElementById('btn-net').click()");
  await sleep(700);
  await app.evaluate("document.querySelector('#mppanel [data-action=board-invite]')?.click()");
  await appDialog("net-renew");
  await app.evaluate("document.querySelector('[data-action=net-renew]').click()");
  const renewed = await waitFor(() => app.evaluate(`${T}.netWin.roomHost?.inviting === true && !${T}.netWin.roomHost.renewing && document.querySelector('.net-room-code')?.textContent`), 10000);
  check("exe '갱신' → 같은 방 코드로 다시 받기", renewed === code, String(renewed));
  await app.evaluate(`${T}.netWin.requestClose()`);
  const G2 = await guestPage("웹 유저 2");
  const added = await waitFor(async () => (await G2.game())?.open === 1 && (await app.evaluate(GAME))?.count === 3, 30000, 200);
  const slots = { g: await G.game(), g2: await G2.game() };
  check("exe 갱신 뒤 새 유저 추가 · 기존 유저 연결·자리 그대로", added && slots.g?.open === 1 && slots.g.slot === 1 && slots.g2?.slot === 2, JSON.stringify(slots));
  await app.evaluate(`${T}.player.net.leave()`);
  check("exe 방장 나감 → 웹 유저 CLOSED(HOST_LEFT)", await waitFor(async () => ((await G.game())?.closed === 7 && (await G2.game())?.closed === 7 ? true : null), 8000));
  await G.ctx.close();
  await G2.ctx.close();
}

// 세션 중 상태 저장·불러오기 막음: 레일 버튼(끔 모양 aria-disabled + 이유 title)·클릭·Shift+F1/F1·게임 메뉴 항목 → 상태 줄 경고, 세션 끝 = 다시 동작
async function nosaveFlow() {
  const RAILSTATE = `(() => ["btn-state-save", "btn-state-load"].map((id) => {
    const n = document.getElementById(id);
    const r = n.getBoundingClientRect();
    const i = n.querySelector(".icon").getBoundingClientRect();
    return { id, aria: n.getAttribute("aria-disabled"), disabled: n.disabled, title: n.title, key: n.dataset.i18nTitle, color: getComputedStyle(n).color, focus: document.activeElement === n, focusVisible: n.matches(":focus-visible"), x: r.left + r.width / 2, y: r.top + r.height / 2, dx: +(i.left + i.width / 2 - (r.left + r.width / 2)).toFixed(2), dy: +(i.top + i.height / 2 - (r.top + r.height / 2)).toFixed(2) };
  }))()`;
  const STATUS = `(() => { const s = document.getElementById("status"); return { text: s.textContent, warn: s.classList.contains("is-warn") }; })()`;
  const clear = () => app.evaluate(`document.getElementById("status").textContent = ""`);
  const BLOCK = ko["net.blockQuick"];
  const slotText = (key) => ko[key].replace("{slot}", "1");
  const press = async (x, y, during = "") => {
    await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    const mid = during ? await app.evaluate(during) : null;
    await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(250);
    return mid;
  };
  const fkey = async (shift) => {
    for (const type of ["rawKeyDown", "keyUp"]) await app.send("Input.dispatchKeyEvent", { type, key: "F1", code: "F1", windowsVirtualKeyCode: 112, nativeVirtualKeyCode: 112, modifiers: shift ? 8 : 0 });
    await sleep(250);
    return app.evaluate(STATUS);
  };
  await app.evaluate(`${T}.player.net.leave()`);
  await sleep(500);
  const solo = await app.evaluate(RAILSTATE);
  await clear();
  await press(solo[0].x, solo[0].y);
  const soloSave = await app.evaluate(STATUS);
  await clear();
  const soloLoad = await fkey(false);
  check("exe 혼자 실행: 레일 상태 저장·불러오기 켜짐 · 클릭 저장 · F1 불러오기 그대로", solo.every((b) => b.aria === null && !b.disabled) && solo[0].key === "rail.stateSave" && soloSave.text === slotText("status.stateSaved") && soloLoad.text === slotText("status.stateLoaded"), JSON.stringify({ solo: solo.map((b) => `${b.id}:${b.aria}/${b.key}`), soloSave, soloLoad }));

  await app.evaluate(`(() => { const p = ${T}.player; p.keyDown("KeyZ"); setTimeout(() => p.keyUp("KeyZ"), 150); return true; })()`);
  await appMake();
  const code = await waitFor(() => app.evaluate("(() => { const t = document.querySelector('.net-room-code')?.textContent ?? ''; return /^\\d{6}$/.test(t) ? t : ''; })()"), 15000);
  const lobby = await app.evaluate(RAILSTATE);
  await clear();
  await app.evaluate(`${T}.saveStateTo(1)`);
  const lobbySave = await app.evaluate(STATUS);
  check(`exe 방장 혼자 기다림(${code}): 레일 상태 저장·불러오기 끔(aria-disabled) · 저장 시도 → 상태 줄 '${BLOCK}'`, lobby.every((b) => b.aria === "true" && !b.disabled) && lobbySave.text === BLOCK && lobbySave.warn, JSON.stringify({ lobby: lobby.map((b) => `${b.id}:${b.aria}/${b.key}`), lobbySave }));

  await page.goto(WEB);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], "net-demo.wgba")]);
  }, Buffer.from(wgba).toString("base64"));
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
  await page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("KeyZ");
    setTimeout(() => p.keyUp("KeyZ"), 150);
  });
  await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await page.click('[data-action="net-room-join"]');
  await page.fill('[data-action="net-code-in"]', code);
  await page.click('[data-action="net-code-go"]');
  const joined = await waitFor(async () => (await webGame())?.open === 1 && (await app.evaluate(GAME))?.count === 2, 30000, 200);
  await sleep(500);
  await app.evaluate("document.querySelector('[data-action=net-done]')?.click()");
  await waitFor(() => app.evaluate("document.getElementById('layer').hidden"), 4000);
  await sleep(400);

  const rails = await app.evaluate(RAILSTATE);
  const fastColor = await app.evaluate(`getComputedStyle(document.getElementById("btn-fast")).color`);
  check("exe 2명 세션: 레일 상태 저장·불러오기 끔 모양(aria-disabled, 색 = 끈 빨리 감기와 같음) · title = 이유 붙은 이름", joined && rails.every((b) => b.aria === "true" && !b.disabled && b.color === fastColor) && rails[0].title === ko["rail.stateSaveNet"] && rails[1].title === ko["rail.stateLoadNet"], JSON.stringify(rails.map((b) => ({ id: b.id, aria: b.aria, title: b.title, color: b.color })).concat([{ fastColor }])));
  await clear();
  const midTransform = await press(rails[0].x, rails[0].y, `getComputedStyle(document.getElementById("btn-state-save")).transform`);
  const clickSave = await app.evaluate(STATUS);
  const afterClick = await app.evaluate(RAILSTATE);
  await clear();
  await press(rails[1].x, rails[1].y);
  const clickLoad = await app.evaluate(STATUS);
  check(`exe 세션 중 레일 클릭(저장·불러오기) → 상태 줄 경고 '${BLOCK}' · 누르는 동안 눌림 모양 없음 · 포커스 표시 없음`, clickSave.text === BLOCK && clickSave.warn && clickLoad.text === BLOCK && midTransform === "none" && afterClick.every((b) => !b.focusVisible), JSON.stringify({ clickSave, clickLoad, midTransform }));
  await clear();
  const keySave = await fkey(true);
  await clear();
  const keyLoad = await fkey(false);
  const afterKeys = await app.evaluate(RAILSTATE);
  check("exe 세션 중 Shift+F1·F1 → 상태 줄 경고 · 막힌 버튼을 누른 뒤 키를 눌러도 포커스·포커스 테두리 없음", keySave.text === BLOCK && keyLoad.text === BLOCK && afterClick.concat(afterKeys).every((b) => !b.focus && !b.focusVisible), JSON.stringify({ keySave, keyLoad, focus: afterKeys.map((b) => `${b.id}:${b.focus}/${b.focusVisible}`) }));
  await app.evaluate(`document.querySelector('.menubar__item[data-menu="game"]').click()`);
  await sleep(250);
  const items = await app.evaluate(`[...document.querySelectorAll(".menu__item")].filter((n) => /^상태 (저장|불러오기)/.test(n.querySelector(".menu__label").textContent)).map((n) => ({ label: n.querySelector(".menu__label").textContent, aria: n.getAttribute("aria-disabled"), disabled: n.disabled, title: n.title }))`);
  await clear();
  await app.evaluate(`[...document.querySelectorAll(".menu__item")].find((n) => /^상태 저장/.test(n.querySelector(".menu__label").textContent)).click()`);
  await sleep(250);
  const menuSave = await app.evaluate(STATUS);
  const menuClosed = await app.evaluate(`[...document.querySelectorAll(".menu__item")].every((n) => n.offsetParent === null)`);
  check("exe 세션 중 게임 메뉴 상태 저장·불러오기: 끔 모양(aria-disabled) · title 이유 · 누르면 메뉴 닫힘 + 상태 줄 경고", items.length === 2 && items.every((i) => i.aria === "true" && !i.disabled && i.title === BLOCK) && menuSave.text === BLOCK && menuClosed, JSON.stringify({ items, menuSave, menuClosed }));
  const rail = await app.evaluate(RAIL);
  const centered = rails.every((b) => b.dx === 0 && b.dy === 0);
  check("exe 세션 중 레일 버튼 좌·우 위치·크기 같음 · 끈 상태 버튼 아이콘 가운데(차이 0)", spread(rail, "left") === 0 && spread(rail, "right") === 0 && spread(rail, "w") === 0 && spread(rail, "h") === 0 && centered, JSON.stringify({ rail: rail.map((b) => `${b.id}:${b.left}-${b.right}`), icons: rails.map((b) => `${b.id}:${b.dx},${b.dy}`) }));
  await app.evaluate(`${T}.setLang("en")`);
  await sleep(300);
  const enTitle = await app.evaluate(`document.getElementById("btn-state-save").title`);
  await app.evaluate(`${T}.setLang("ko")`);
  await sleep(300);
  const en = readJson(fileURLToPath(new URL("../../src-bundle/src/i18n/en.json", import.meta.url)));
  check("exe 세션 중 언어 바꾸기 → title 이유도 그 언어", enTitle === en["rail.stateSaveNet"], enTitle);
  await app.evaluate(`document.getElementById("status").textContent = ${JSON.stringify(BLOCK)}`);
  await app.screenshot(path.join(shots, "exe_세션중_상태저장_끔.png"));

  await app.evaluate(`${T}.player.net.leave()`);
  check("exe 방장 나감 → 웹 유저 CLOSED(HOST_LEFT)", await waitFor(async () => ((await webGame())?.closed === 7 ? true : null), 8000));
  const ended = await waitFor(async () => {
    const list = await app.evaluate(RAILSTATE);
    return list.every((b) => b.aria === null) ? list : null;
  }, 5000);
  await clear();
  if (ended) await press(ended[0].x, ended[0].y);
  const endSave = await app.evaluate(STATUS);
  check("exe 세션 끝: 레일 다시 켜짐(title 원래 이름) · 클릭 저장 동작", Boolean(ended) && ended[0].title === ko["rail.stateSave"] && endSave.text === slotText("status.stateSaved"), JSON.stringify({ ended: ended && ended.map((b) => `${b.id}:${b.aria}/${b.title}`), endSave }));
}
