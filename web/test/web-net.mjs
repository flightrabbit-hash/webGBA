// 웹 webGBA 멀티플레이(MP1) 시험 — 페이지(브라우저 프로필) 2~5개를 연결 코드로 이어 붙이고 규약을 확인한다.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-net.mjs --webapi <net-webapi 예제 폴더> --script <net-script 예제 폴더>
//     [--browser chrome|edge] [--shots <캡처 폴더>] [--out <결과 json>]
// 이 시험이 띄우는 서버가 web/dist 를 내준다. 예제는 롬이 없는 작은 게임이고 이 자리에서 묶는다(호환 키 다른 빌드 = data 조각 하나 더).
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");
const BROWSERS = { chrome: "C:/Program Files/Google/Chrome/Application/chrome.exe", edge: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" };
const which = opt.browser ?? "chrome";
const SHOTS = opt.shots ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name: `[${which}] ${name}`, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} [${which}] ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.join(dist, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const webapiDir = opt.webapi;
const scriptDir = opt.script;
const webapiArgs = { wasm: fs.readFileSync(path.join(webapiDir, "game.wasm")), manifest: readJson(path.join(webapiDir, "manifest.json")) };
const files = {
  webapi: (await packWgba(webapiArgs)).bytes,
  variant: (await packWgba({ ...webapiArgs, data: [{ name: "other", bytes: new Uint8Array([1, 2, 3]) }] })).bytes,
  script: (await packWgba({ wasm: fs.readFileSync(path.join(scriptDir, "game.wasm")), js: fs.readFileSync(path.join(scriptDir, "game.js")), manifest: readJson(path.join(scriptDir, "manifest.json")) })).bytes,
};

const browser = await chromium.launch({ executablePath: BROWSERS[which], headless: true });
const peers = [];

async function peer(name, { viewport = { width: 390, height: 844 }, clip = false, touch = false } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport, permissions: clip ? ["clipboard-read", "clipboard-write"] : [], hasTouch: touch, isMobile: touch });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window === window.top) localStorage.setItem("webgba.installHint", "1");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  const p = { name, context, page, errors, codes: [] };
  peers.push(p);
  return p;
}

async function open(p, kind, fileName) {
  const b64 = Buffer.from(files[kind]).toString("base64");
  await p.page.evaluate(async ({ name, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], name)]);
  }, { name: fileName, b64 });
  await p.page.waitForFunction(() => window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 20000 });
}

const press = (p, code, ms = 120) =>
  p.page.evaluate(([c, ms]) => {
    const player = window.webgba.player;
    player.keyDown(c);
    setTimeout(() => player.keyUp(c), ms);
  }, [code, ms]);

const game = (p) =>
  p.page.evaluate(() => {
    const ex = window.webgba.player.host?.ex;
    if (!ex?.Net_Hash) return null;
    const events = [];
    const n = ex.Net_EventCount();
    for (let i = Math.max(0, n - 32); i < n; i++) {
      const v = ex.Net_Event(i) >>> 0;
      events.push(`${v >>> 24}:${(v >>> 16) & 255}:${v & 0xffff}`);
    }
    return { hash: (ex.Net_Hash() >>> 0).toString(16), applied: ex.Net_Applied(), slot: ex.Net_Slot(), count: ex.Net_Count(), open: ex.Net_Open(), started: ex.Net_Started(), ended: ex.Net_Ended(), closed: ex.Net_Closed(), bigOk: ex.Net_BigOk(), bigBad: ex.Net_BigBad(), hostProtocol: ex.Net_HostProtocol(), events };
  });

const scriptState = async (p) => {
  const lines = await p.page.evaluate(() => (window.webgba.player.host?.logs ?? []).map((l) => l.text).filter((t) => t.startsWith("net ")));
  return lines.length ? JSON.parse(lines[lines.length - 1].slice(4)) : null;
};

async function waitFor(fn, ms = 15000, step = 100) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(step);
  }
  return last;
}

const value = (p, action) => p.page.evaluate((a) => document.querySelector(`[data-action="${a}"]`)?.value ?? "", action);
const sheet = (p) => p.page.evaluate(() => window.webgba.state.sheet);
const errorText = (p) => p.page.evaluate(() => {
  const node = document.querySelector("#sheetBody .net-error");
  return node && !node.hidden ? node.textContent : "";
});

async function shot(p, name) {
  if (!SHOTS) return;
  await sleep(250);
  await p.page.screenshot({ path: path.join(SHOTS, `${which}_${name}.png`) });
}

async function hostOpen(host, { snap = "" } = {}) {
  await press(host, "KeyZ");
  await host.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  if (snap) await shot(host, snap);
  await host.page.click('[data-action="net-make"]');
  const offer = await waitFor(() => value(host, "net-offer"), 10000);
  return offer;
}

const pasted = [];
async function putCode(p, action, code, paste) {
  if (!paste) return p.page.fill(`[data-action="${action}"]`, code);
  await p.page.evaluate((c) => navigator.clipboard.writeText(c), code);
  await p.page.click(`[data-action="${action}-paste"]`);
  const got = await waitFor(() => value(p, action), 3000);
  pasted.push({ who: p.name, action, ok: got === code });
}

async function pasteButtons(p, action) {
  return p.page.evaluate((a) => {
    const paste = document.querySelector(`[data-action="${a}-paste"]`);
    const go = document.querySelector(`[data-action="${a}-go"]`);
    if (!paste || !go) return null;
    const r1 = paste.getBoundingClientRect();
    const r2 = go.getBoundingClientRect();
    return { leftOf: r1.right <= r2.left, sameHeight: Math.abs(r1.height - r2.height) < 0.5, middle: Math.abs(r1.top + r1.height / 2 - (r2.top + r2.height / 2)) < 0.5, paste: paste.textContent.trim(), go: go.textContent.trim() };
  }, action);
}

async function joinOne(host, guest, { snap = false, paste = false } = {}) {
  const offer = await waitFor(() => value(host, "net-offer"), 10000);
  host.codes.push(offer);
  const t0 = Date.now();
  if ((await sheet(guest)) !== "net") {
    await press(guest, "KeyZ");
    await guest.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  }
  await guest.page.click('[data-action="net-join"]');
  await putCode(guest, 'net-offer-in', offer, paste);
  await guest.page.click('[data-action="net-offer-in-go"]');
  const answer = await waitFor(() => value(guest, "net-answer-out"), 10000);
  guest.codes.push(answer);
  if (snap) {
    await shot(host, "방장_코드");
    await shot(guest, "참가자_답코드");
  }
  await putCode(host, 'net-answer', answer, paste);
  await host.page.click('[data-action="net-answer-go"]');
  const joined = await waitFor(async () => (await game(guest))?.open === 1 || (await scriptState(guest))?.open, 15000);
  return { joined: Boolean(joined), ms: Date.now() - t0, offer, answer };
}

async function lanOnly(p, codes) {
  return p.page.evaluate(async (list) => {
    const lan = await import("/js/core/net/lan.js");
    const out = { codes: list.length, cands: 0, bad: [] };
    for (const code of list) {
      let d;
      try {
        d = lan.decodeCode(code);
      } catch (e) {
        out.bad.push(`decode ${e.code}`);
        continue;
      }
      for (const line of d.sdp.split("\r\n").filter((l) => l.startsWith("a=candidate:"))) {
        out.cands++;
        const c = lan.parseCandidate(line);
        if (!lan.lanCandidateOk(c)) out.bad.push(c.address);
      }
    }
    return out;
  }, codes);
}

try {
  // ── ① 네 명: 방장 + 손님 셋 ──
  const H = await peer("H", { clip: true });
  const G1 = await peer("G1", { clip: true });
  const G2 = await peer("G2");
  const G3 = await peer("G3");
  for (const p of [H, G1, G2, G3]) await open(p, "webapi", "net-demo.wgba");
  const hello = await game(H);
  ok("① 게임 Web_NetHost(1) 받음(멀티플레이를 아는 호스트)", hello.hostProtocol === 1, `protocol ${hello.hostProtocol}`);
  await press(H, "KeyZ");
  await H.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  ok("Web_NetWanted 0 → 0 아님: 연결 창이 저절로 열림", (await sheet(H)) === "net");
  await shot(H, "창_고르기");
  const paused = await H.page.evaluate(() => window.webgba.player.paused);
  ok("연결 창이 열려 있어도 게임은 멈추지 않음(세션 유지)", paused === false);
  await H.page.click('[data-action="net-make"]');
  await waitFor(() => value(H, "net-offer"), 10000);
  const pb = await pasteButtons(H, "net-answer");
  ok("붙여넣기 단추: 연결 왼쪽·같은 높이·세로 가운데", pb?.leftOf && pb.sameHeight && pb.middle, JSON.stringify(pb));
  const j1 = await joinOne(H, G1, { snap: true, paste: true });
  ok("붙여넣기 단추로 코드가 들어감(손님 방장 코드·방장 답 코드)", pasted.length === 2 && pasted.every((p) => p.ok), JSON.stringify(pasted));
  ok("방장 + 1명 연결(연결 코드 두 번, 붙여넣기 단추)", j1.joined, `${j1.ms}ms · 방장 코드 ${j1.offer.length}자 · 답 코드 ${j1.answer.length}자`);
  const after1 = await game(H);
  ok("방장 OPEN(0,1) → JOIN(1,2)", after1.events.includes("1:0:1") && after1.events.includes("2:1:2"), after1.events.join(" "));
  await shot(H, "방장_2명");
  const j2 = await joinOne(H, G2);
  const j3 = await joinOne(H, G3);
  ok("4명 연결", j2.joined && j3.joined && (await game(H)).count === 4, `${j2.ms}ms · ${j3.ms}ms`);
  const full = await H.page.evaluate(() => Boolean(document.querySelector("#sheetBody .net-invite")));
  ok("가득 참(4/4): 초대 칸 없음", !full);
  await shot(H, "방장_4명");
  await H.page.click('[data-action="net-done"]');
  await waitFor(async () => (await sheet(H)) === "" && (await sheet(G3)) === "", 5000);
  ok("연결되면 창 닫힘(손님은 1초 뒤 저절로)", (await sheet(H)) === "" && (await sheet(G1)) === "" && (await sheet(G3)) === "");
  const lan = await lanOnly(H, [...H.codes, ...G1.codes, ...G2.codes, ...G3.codes]);
  ok("후보 거르기: 모든 연결 코드의 후보가 망 안 주소(공인 0)", lan.bad.length === 0 && lan.cands > 0, `코드 ${lan.codes} · 후보 ${lan.cands} · 밖 ${lan.bad.join(",") || 0}`);
  const pair = await H.page.evaluate(async () => {
    const s = window.webgba.player.net.session;
    const { selectedPair } = await import("/js/core/net/lan.js");
    const out = [];
    for (const l of s.links.values()) out.push(await selectedPair(l.pc));
    return out;
  });
  ok("고른 후보 쌍 host/host(getStats)", pair.length === 3 && pair.every((x) => x?.host), JSON.stringify(pair.map((x) => `${x?.local}/${x?.remote} ${x?.rttMs ?? "?"}ms`)));
  const lock = await H.page.evaluate(async () => {
    const w = window.webgba;
    const before = w.player.runSpeed;
    const load = await w.player.loadState(1);
    const reset = await w.player.reset();
    const save = await w.player.saveState(1);
    return { before, load, reset, save, canQuick: w.player.canState };
  });
  ok("세션 중: 속도 1배·퀵슬롯 불러오기 막음·다시 시작 막음·저장은 됨", lock.before === 1 && lock.load === false && lock.reset === false && lock.save === true, JSON.stringify(lock));
  await H.page.evaluate(() => window.webgba.openSheet("quick"));
  await sleep(400);
  const quickUi = await H.page.evaluate(() => {
    document.querySelector('[data-action="tab-load"]')?.click();
    const slots = [...document.querySelectorAll("#sheetBody .slot")];
    return { slots: slots.length, enabled: slots.filter((s) => !s.disabled).length, note: [...document.querySelectorAll("#sheetBody .note--warn")].map((n) => n.textContent).join(" ") };
  });
  ok("퀵슬롯 창 불러오기 탭: 칸 모두 막힘 + 안내", quickUi.slots === 9 && quickUi.enabled === 0 && quickUi.note.length > 0, JSON.stringify(quickUi));
  await shot(H, "퀵슬롯_불러오기막힘");
  await H.page.evaluate(() => document.getElementById("sheetClose").click());
  await sleep(300);
  await press(H, "Enter");
  const ended = await waitFor(async () => {
    const all = await Promise.all([H, G1, G2, G3].map(game));
    return all.every((g) => g.ended) ? all : null;
  }, 30000, 300);
  const hashes = (ended ?? []).map((g) => g.hash);
  ok("① 순서 방송(TO_ORDERED) 한 라운드: 4명 해시 같음", ended && new Set(hashes).size === 1, `${hashes.join(" ")} · 명령 ${(ended ?? []).map((g) => g.applied).join("/")}`);
  await shot(G2, "라운드_끝");
  await press(G1, "KeyX");
  const big = await waitFor(async () => {
    const all = await Promise.all([H, G1, G2, G3].map(game));
    return all.every((g) => g.bigOk >= 1) ? all : null;
  }, 8000);
  ok("16384바이트 메시지(TO_ORDERED, 받기 자리 없으면 다음 프레임에): 모두 받음·내용 같음", big && big.every((g) => g.bigBad === 0), (big ?? []).map((g) => `${g.bigOk}/${g.bigBad}`).join(" "));
  const variant = await peer("X");
  await open(variant, "variant", "net-demo-other.wgba");
  await H.page.click("#btnNet");
  await H.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 5000 });
  ok("멀티플레이 단추로 창 다시 열기(방장 화면)", (await sheet(H)) === "net");
  await G3.context.close();
  const left = await waitFor(async () => {
    const g = await game(H);
    return g.count === 3 && g.events.some((e) => e.startsWith("3:3:")) ? g : null;
  }, 20000, 300);
  const g1after = await game(G1);
  ok("손님 끊김 → 방장·다른 손님 LEAVE(3)", Boolean(left) && g1after.events.some((e) => e.startsWith("3:3:")), `${left?.events.slice(-3).join(" ")} · G1 ${g1after.events.slice(-2).join(" ")}`);
  const offerNow = await waitFor(() => value(H, "net-offer"), 10000);
  await press(variant, "KeyZ");
  await variant.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await variant.page.click('[data-action="net-join"]');
  await variant.page.fill('[data-action="net-offer-in"]', offerNow);
  await variant.page.click('[data-action="net-offer-in-go"]');
  const vAnswer = await waitFor(() => value(variant, "net-answer-out"), 10000);
  await H.page.fill('[data-action="net-answer"]', G1.codes[0]);
  await H.page.click('[data-action="net-answer-go"]');
  const reuse = await waitFor(() => errorText(H), 5000);
  ok("쓴 답 코드로 다시 들어오기 거부", /이미 쓴|다른 초대/.test(reuse), reuse);
  await H.page.fill('[data-action="net-answer"]', vAnswer);
  await H.page.click('[data-action="net-answer-go"]');
  const incompatible = await waitFor(async () => {
    const e = await errorText(H);
    return /다른 게임/.test(e) ? e : null;
  }, 15000);
  const vg = await waitFor(async () => ((await game(variant)).closed ? game(variant) : null), 8000);
  ok("호환 키 다름 → 방장 거부 · 그 게임 CLOSED(INCOMPATIBLE)", Boolean(incompatible) && vg?.closed === 3, `${incompatible} · 게임 이유 ${vg?.closed}`);
  await shot(H, "방장_호환거부");
  const stillCount = (await game(H)).count;
  ok("거부 뒤에도 방 그대로(3명)", stillCount === 3, String(stillCount));
  await H.page.click('[data-action="net-leave"]');
  const hostLeft = await waitFor(async () => {
    const all = await Promise.all([G1, G2].map(game));
    return all.every((g) => g.closed === 7) ? all : null;
  }, 8000);
  ok("방장 나감 → 손님 CLOSED(HOST_LEFT) · Web_NetWanted 0 → 창 없음", Boolean(hostLeft) && (await sheet(G1)) === "", (hostLeft ?? []).map((g) => g.events.slice(-1)[0]).join(" "));
  const unlocked = await H.page.evaluate(async () => ({ locked: window.webgba.player.net.locked, load: await window.webgba.player.loadState(1) }));
  ok("세션 끝나면 퀵슬롯 불러오기 다시 됨", !unlocked.locked && unlocked.load === true, JSON.stringify(unlocked));
  for (const p of [H, G1, G2, variant]) await p.context.close();

  // ── 붙여넣기 권한 없음·미지원(입력 칸 초점 + 안내) · 취소 ──
  const C1 = await peer("C1");
  await open(C1, "webapi", "net-demo.wgba");
  await press(C1, "KeyZ");
  await C1.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await C1.page.click('[data-action="net-join"]');
  const fallback = async (setup) => {
    await C1.page.evaluate(setup);
    await C1.page.evaluate(() => document.activeElement?.blur());
    await C1.page.click('[data-action="net-offer-in-paste"]');
    await sleep(400);
    return C1.page.evaluate(() => {
      const hint = document.querySelector("#sheetBody .net-paste-hint");
      return { hint: hint && !hint.hidden ? hint.textContent : "", focus: document.activeElement?.dataset?.action ?? "", value: document.querySelector('[data-action="net-offer-in"]').value };
    });
  };
  const denied = await fallback(() => {
    Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: () => Promise.reject(new DOMException("denied", "NotAllowedError")) });
  });
  ok("붙여넣기 권한 거부 → 입력 칸에 초점 + 안내(Ctrl+V)", /Ctrl\+V/.test(denied.hint) && denied.focus === "net-offer-in" && !denied.value, JSON.stringify(denied));
  const missing = await fallback(() => {
    Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: undefined });
  });
  ok("붙여넣기 미지원(readText 없음) → 같은 대체 동작", /Ctrl\+V/.test(missing.hint) && missing.focus === "net-offer-in", JSON.stringify(missing));
  await shot(C1, "붙여넣기_대체안내");
  const M1 = await peer("M1", { touch: true });
  await open(M1, "webapi", "net-demo.wgba");
  await press(M1, "KeyZ");
  await M1.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await M1.page.click('[data-action="net-join"]');
  await M1.page.evaluate(() => Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }));
  await M1.page.click('[data-action="net-offer-in-paste"]');
  await sleep(400);
  const touchHint = await M1.page.evaluate(() => ({ hint: document.querySelector("#sheetBody .net-paste-hint")?.textContent ?? "", focus: document.activeElement?.dataset?.action ?? "" }));
  ok("터치 기기 권한 거부 → 입력 칸 초점 + '길게 눌러' 안내", /길게 눌러/.test(touchHint.hint) && touchHint.focus === "net-offer-in", JSON.stringify(touchHint));
  await M1.context.close();
  await C1.page.click('[data-action="net-cancel"]');
  const cancel = await waitFor(async () => ((await game(C1)).closed ? game(C1) : null), 5000);
  ok("창에서 취소 → CLOSED(CANCEL) · 게임이 요청을 거둠 → 단추 숨김", cancel?.closed === 1 && (await C1.page.evaluate(() => document.getElementById("btnNet").hidden)), `이유 ${cancel?.closed}`);
  await C1.context.close();

  // ── ② 자체 JS 두 명 ──
  const S1 = await peer("S1");
  const S2 = await peer("S2");
  for (const p of [S1, S2]) await open(p, "script", "net-script.wgba");
  const s0 = await waitFor(() => scriptState(S1), 8000);
  ok("② webgba.net.host 있음(멀티플레이를 아는 호스트)", s0?.host === true, JSON.stringify(s0));
  const inFrame = S1.page.frames().find((f) => f !== S1.page.mainFrame());
  const frameRtc = inFrame ? await inFrame.evaluate(() => ({ rtc: typeof RTCPeerConnection, webkit: typeof window.webkitRTCPeerConnection, ws: (() => { try { new WebSocket("ws://127.0.0.1:9/"); return "열림"; } catch (e) { return "막힘"; } })() })) : null;
  ok("② 게임 틀 안에는 여전히 WebRTC 없음(통신은 호스트만, webgba.net 으로)", frameRtc?.rtc === "undefined" && frameRtc.webkit === "undefined", JSON.stringify(frameRtc));
  await S1.page.evaluate(() => window.webgba.player.keyDown("KeyZ"));
  await sleep(150);
  await S1.page.evaluate(() => window.webgba.player.keyUp("KeyZ"));
  await S1.page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  ok("② webgba.net.want() → 연결 창", (await sheet(S1)) === "net");
  await S1.page.click('[data-action="net-make"]');
  await waitFor(() => value(S1, "net-offer"), 10000);
  const sj = await joinOne(S1, S2);
  ok("② 두 명 연결(MessagePort ↔ 세션)", sj.joined, `${sj.ms}ms`);
  await S1.page.click('[data-action="net-done"]');
  await sleep(1500);
  await S1.page.evaluate(() => window.webgba.player.keyDown("Enter"));
  await sleep(150);
  await S1.page.evaluate(() => window.webgba.player.keyUp("Enter"));
  const sEnd = await waitFor(async () => {
    const a = await scriptState(S1);
    const b = await scriptState(S2);
    return a?.ended && b?.ended ? [a, b] : null;
  }, 20000, 300);
  ok("② send(\"ordered\") 한 라운드: 두 명 해시 같음", sEnd && sEnd[0].hash === sEnd[1].hash, (sEnd ?? []).map((s) => `${s.hash}/${s.applied}`).join(" "));
  await S2.context.close();
  const sLeave = await waitFor(async () => ((await scriptState(S1))?.events.some((e) => e.startsWith("3:1:")) ? scriptState(S1) : null), 20000, 300);
  ok("② 손님 페이지 닫힘 → 방장 onevent LEAVE(1)", Boolean(sLeave), sLeave?.events.slice(-2).join(" "));
  await S1.context.close();
  for (const p of peers) if (p.errors.length) ok(`페이지 오류 없음 ${p.name}`, false, p.errors.slice(0, 3).join(" | "));
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${which}: ${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
