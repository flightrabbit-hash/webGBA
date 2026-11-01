// 웹 webGBA .wgba ② 자체 JS 게임(runtime script) 시험 — 격리 틀(출처 없는 sandbox iframe + 엄격 CSP + MessagePort)과 실행.
// 크롬·웹킷 둘 다, 새 브라우저 프로필(시험 전용). 이 시험이 띄우는 서버가 web/dist 를 내주고 새는 요청을 센다(/__leak·업그레이드·UDP STUN).
//   PLAYWRIGHT_DIR=<크롬용 playwright-core 폴더> WEBKIT_PLAYWRIGHT_DIR=<웹킷(설치된 빌드)과 맞는 playwright-core 폴더> \
//     node web/test/web-script.mjs [--module <예제 module 폴더> --emscripten <예제 emscripten 폴더>] [--screen <160x144 ① .wgba>] [--only chromium|webkit]
//   --module 이 없으면 저장소 docs/wgba/examples/net-script 로 격리 틀 규칙만 본다(S4 전용 항목 건너뜀).
// 예제 폴더: module = game.js·code.wasm·manifest.json, emscripten = manifest.json + out/game.js·game.wasm·game.data.
// 시험이 그 자리에서 묶는 것: 그대로 / x-probe(밖으로 나가 보기) / x-probe.selfNav(틀이 스스로 다른 문서로) 변형.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import dgram from "node:dgram";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const STUN_PORT = 3478;

const results = [];
let who = "";
const ok = (name, pass, detail = "") => {
  results.push({ name: `[${who}] ${name}`, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} [${who}] ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── 서버: web/dist + 새는 요청 세기 ──
const hits = [];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/__leak")) {
    hits.push(`http ${req.method} ${url.pathname}${url.search}`);
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    return res.end("leak");
  }
  const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.join(dist, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
});
server.on("upgrade", (req, socket) => {
  hits.push(`upgrade ${req.url}`);
  socket.destroy();
});
const udp = dgram.createSocket("udp4");
udp.on("message", (msg, from) => hits.push(`udp ${from.address}:${from.port} ${msg.length}B`));
await new Promise((resolve) => udp.bind(STUN_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const LEAK = `${BASE}__leak`;

// ── 예제 묶기 ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "webgba-script-"));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
async function pack(name, args) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, (await packWgba(args)).bytes);
  return file;
}
const REPO = !opt.module;
const mod = opt.module ?? path.join(here, "..", "..", "docs", "wgba", "examples", "net-script");
const modManifest = readJson(path.join(mod, "manifest.json"));
const modWasm = fs.existsSync(path.join(mod, "code.wasm")) ? path.join(mod, "code.wasm") : path.join(mod, "game.wasm");
const modArgs = (extra = {}) => ({ wasm: fs.readFileSync(modWasm), js: fs.readFileSync(path.join(mod, "game.js")), manifest: { ...modManifest, ...extra } });
const files = {
  module: await pack("s4-module.wgba", modArgs()),
  probe: await pack("s4-probe.wgba", modArgs({ id: "io.example.s4.probe", "x-probe": { url: LEAK, ws: `ws://127.0.0.1:${server.address().port}/__leak-ws`, stun: `stun:127.0.0.1:${STUN_PORT}` } })),
  nav: await pack("s4-nav.wgba", modArgs({ id: "io.example.s4.nav", "x-probe": { selfNav: true } })),
  emscripten: opt.emscripten
    ? await (async () => {
        const em = opt.emscripten;
        const out = path.join(em, "out");
        return pack("s4-emscripten.wgba", { wasm: fs.readFileSync(path.join(out, "game.wasm")), js: fs.readFileSync(path.join(out, "game.js")), manifest: readJson(path.join(em, "manifest.json")), data: [{ name: "game", bytes: fs.readFileSync(path.join(out, "game.data")) }] });
      })()
    : "",
  screen: opt.screen,
};

const FRAME_PROBE = `async ({ leak, ws, stun }) => {
  const out = {};
  const tryIt = async (key, fn) => {
    try {
      const value = await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 2500))]);
      out[key] = "열림 " + String(value).slice(0, 40);
    } catch (e) {
      out[key] = "막힘 " + (e && e.name ? e.name : String(e));
    }
  };
  await tryIt("fetch", () => fetch(leak + "?fetch").then((r) => r.status));
  await tryIt("xhr", () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("GET", leak + "?xhr"); x.onload = () => ok(x.status); x.onerror = () => no(new Error("NetworkError")); x.send(); }));
  await tryIt("webSocket", () => new Promise((ok, no) => { const w = new WebSocket(ws); w.onopen = () => ok("open"); w.onerror = () => no(new Error("WebSocketError")); }));
  await tryIt("eventSource", () => new Promise((ok, no) => { const s = new EventSource(leak + "?es"); s.onopen = () => ok("open"); s.onerror = () => { s.close(); no(new Error("EventSourceError")); }; }));
  await tryIt("image", () => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok("load"); i.onerror = () => no(new Error("ImageError")); i.src = leak + "?img"; }));
  await tryIt("beacon", () => { if (!navigator.sendBeacon(leak + "?beacon", "x")) throw new Error("refused"); return "queued"; });
  await tryIt("webRTC", () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] }); pc.createDataChannel("x"); return pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => "made"); });
  await tryIt("indexedDB", () => new Promise((ok, no) => { const r = indexedDB.open("probe"); r.onsuccess = () => ok("open"); r.onerror = () => no(r.error || new Error("IDBError")); }));
  await tryIt("cookie", () => { document.cookie = "probe=1"; if (!document.cookie.includes("probe=1")) throw new Error("NoCookie"); return document.cookie; });
  await tryIt("parentDom", () => parent.document.title);
  await tryIt("topDom", () => top.document.title);
  await tryIt("popup", () => { const w = window.open(leak + "?popup"); if (!w) throw new Error("NoPopup"); return "opened"; });
  await tryIt("tauriHere", () => { if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) throw new Error("NoTauri"); return "tauri"; });
  out.origin = String(self.origin);
  return out;
}`;

async function runRepo(name, browserType, launchOptions) {
  who = name;
  let browser;
  try {
    browser = await browserType.launch(launchOptions);
  } catch (error) {
    ok("브라우저 띄우기", false, error.message.split("\n")[0]);
    return;
  }
  try {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window === window.top) localStorage.setItem("webgba.installHint", "1");
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click("#startOpen")]);
    await chooser.setFiles(files.module);
    await page.waitForFunction(() => !window.webgba.state.opening && document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout: 30000 });
    await sleep(800);
    const frame = await page.evaluate(() => {
      const f = document.querySelector("#screen .script-frame");
      return f ? { sandbox: f.getAttribute("sandbox"), csp: /Content-Security-Policy[^>]+connect-src blob: data:/.test(f.srcdoc), runtime: document.body.dataset.runtime } : null;
    });
    ok("저장소 예제(net-script) 틀: sandbox=allow-scripts 만 · CSP meta(connect-src blob: data:)", frame?.sandbox === "allow-scripts" && frame.csp && frame.runtime === "script", JSON.stringify(frame));
    const inner = page.frames().find((f) => f !== page.mainFrame());
    hits.length = 0;
    const probe = inner ? await inner.evaluate(`(${FRAME_PROBE})(${JSON.stringify({ leak: LEAK, ws: `ws://127.0.0.1:${server.address().port}/__leak-ws`, stun: `stun:127.0.0.1:${STUN_PORT}` })})`) : {};
    await sleep(2500);
    const blocked = ["fetch", "xhr", "webSocket", "eventSource", "image", "webRTC", "indexedDB", "cookie", "parentDom", "topDom", "popup", "tauriHere"];
    const open = blocked.filter((k) => !String(probe[k] ?? "").startsWith("막힘"));
    ok("막힘: 네트워크·저장소·위 창·팝업·WebRTC·Tauri(시험이 틀 안에서 시도)", inner && open.length === 0, open.length ? open.map((k) => `${k}=${probe[k]}`).join(", ") : blocked.map((k) => `${k}:${String(probe[k]).replace("막힘 ", "")}`).join(" "));
    ok("서버가 받은 것 없음(fetch·XHR·WS·이미지·beacon·팝업·STUN)", hits.length === 0, hits.join(" | ") || "0건");
    ok("틀 출처 null", probe.origin === "null", String(probe.origin));
    ok("S4 전용 항목(그리기 측정·키·세이브·퀵슬롯·emscripten)", true, "건너뜀 — S4 예제 없음(저장소 예제로 대체)");
    const unexpected = pageErrors.filter((m) => !/web-inspector:\/\/|blob:null\//.test(m));
    ok("페이지 오류 없음", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
  } catch (error) {
    ok("시험 도중 오류", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" "));
  } finally {
    await browser.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (list) => {
  const s = list.slice().sort((a, b) => a - b);
  return { median: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3) };
};

async function run(name, browserType, launchOptions) {
  who = name;
  let hostFps = 60;
  let browser;
  try {
    browser = await browserType.launch(launchOptions);
  } catch (error) {
    ok("브라우저 띄우기", false, error.message.split("\n")[0]);
    return;
  }
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window === window.top) localStorage.setItem("webgba.installHint", "1");
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleLines = [];
  page.on("pageerror", (error) => pageErrors.push(`${error.message} @ ${String(error.stack ?? "").split("\n").slice(1, 3).join(" ").trim()}`));
  page.on("console", (message) => consoleLines.push(`${message.type()} ${message.text().slice(0, 300)}`));
  await page.goto(BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });

  const host = (fn, arg) => page.evaluate(fn, arg);
  const logs = () => host(() => (window.webgba.player.host?.logs ?? []).map((l) => `${l.level} ${l.text}`));
  const waitLog = async (re, ms = 8000, from = 0) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = (await logs()).slice(from).find((line) => re.test(line));
      if (found) return found;
      await sleep(60);
    }
    return null;
  };
  const logCount = async () => (await logs()).length;

  async function pick(file) {
    const started = await host(() => document.body.dataset.view === "game");
    if (started && (await page.isVisible("#btnMenu"))) {
      await page.click("#btnMenu");
      await page.waitForSelector(".bar__group--files #btnOpen", { state: "visible" });
    }
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click(started ? "#btnOpen" : "#startOpen")]);
    await chooser.setFiles(file);
    try {
      await page.waitForFunction(() => !window.webgba.state.opening && document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout: 30000 });
    } catch (error) {
      const toast = await host(() => document.getElementById("toast").textContent).catch(() => "");
      throw new Error(`${path.basename(file)} 열기 시간 넘김 · 알림 "${toast}" · 콘솔 ${consoleLines.slice(-8).join(" | ")}`);
    }
    await sleep(300);
  }
  const focusHost = () => host(() => {
    document.activeElement?.blur?.();
    document.getElementById("canvas").focus();
  });

  try {
    // 1. 밖으로 나가 보기(게임 코드가 직접 시도)
    hits.length = 0;
    await pick(files.probe);
    const frame = await host(() => {
      const f = document.querySelector("#screen .script-frame");
      return f ? { sandbox: f.getAttribute("sandbox"), allow: f.getAttribute("allow"), csp: /Content-Security-Policy[^>]+connect-src blob: data:/.test(f.srcdoc), runtime: document.body.dataset.runtime } : null;
    });
    ok("틀: sandbox=allow-scripts 만 · CSP meta(connect-src blob: data:)", frame?.sandbox === "allow-scripts" && frame.csp && frame.runtime === "script", JSON.stringify(frame));
    const probeLine = await waitLog(/^probe /, 20000);
    const probe = probeLine ? JSON.parse(probeLine.slice(6)) : {};
    await sleep(2500);
    const blocked = ["fetch", "xhr", "webSocket", "eventSource", "image", "worker", "webRTC", "childFrame", "indexedDB", "realLocalStorage", "cookie", "parentDom", "topDom", "parentTauri", "topNav", "popup", "tauriHere", "tauriIpc"];
    const open = blocked.filter((k) => !String(probe[k] ?? "").startsWith("막힘"));
    ok("막힘: 네트워크·저장소·위 창·팝업·WebRTC·자식 틀·Tauri 다리(게임 코드가 시도)", probeLine && open.length === 0, open.length ? open.map((k) => `${k}=${probe[k]}`).join(", ") : blocked.map((k) => `${k}:${String(probe[k]).replace("막힘 ", "")}`).join(" "));
    ok("서버가 받은 것 없음(fetch·XHR·WS·이미지·beacon·폼·워커·STUN)", hits.length === 0, hits.join(" | ") || "0건");
    ok("출처 null · 대신 쓰는 localStorage", probe.origin === "null" && /됨/.test(probe.shimLocalStorage ?? ""), `${probe.origin} · ${probe.shimLocalStorage}`);

    // 2. 그리기·왕복·키
    await pick(files.module);
    await sleep(2500);
    const run1 = await host(() => ({ fps: window.webgba.player.host.fps, width: window.webgba.player.host.width, canvas: getComputedStyle(document.getElementById("canvas")).visibility }));
    const perf = await waitLog(/^perf /, 5000);
    // 이 브라우저 본 페이지의 화면 갱신 수 — 틀은 그만큼은 나와야 함
    const pageFps = () =>
      host(() => new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(tick)) : resolve(n));
        requestAnimationFrame(tick);
      }));
    hostFps = await pageFps();
    const tapShown = () => page.frameLocator("#screen .script-frame").locator("#tap").isVisible();
    if (name === "chromium") {
      ok("그리기: 틀 안 requestAnimationFrame 60Hz · 덮개 없음", run1.fps >= 50 && !(await tapShown()), `틀 ${run1.fps}fps · 본 페이지 ${hostFps}fps · ${perf?.slice(5) ?? ""} · 화면 ${run1.width} · 캔버스 ${run1.canvas}`);
    } else {
      // 웹킷은 사용자가 아직 누르지 않은 출처 다른 틀을 30Hz 로 묶음 → 틀이 "눌러서 시작" 덮개를 띄우고, 누르면 풀림
      const shown = await tapShown();
      await page.frameLocator("#screen .script-frame").locator("#tap").click({ force: true }).catch(() => {});
      await sleep(2600);
      const after = await host(() => window.webgba.player.host.fps);
      const hidden = !(await tapShown());
      ok("그리기: 웹킷 누르기 전 30Hz → 틀 안 덮개 → 누른 뒤 풀림", run1.fps < 40 ? shown && hidden && after >= 50 : run1.fps >= hostFps * 0.85, `누르기 전 ${run1.fps}fps 덮개 ${shown} → 뒤 ${after}fps 덮개 ${!hidden} · 본 페이지 ${hostFps}fps · ${perf?.slice(5) ?? ""}`);
      hostFps = Math.min(hostFps, after);
    }
    const rtt = [];
    for (let i = 0; i < 200; i++) rtt.push(await host(() => window.webgba.player.host.ping()));
    const r1 = median(rtt);
    ok("메시지 왕복(MessagePort, 200번)", r1.median < 20, `가운데 ${r1.median}ms · p95 ${r1.p95}ms`);
    await focusHost();
    let from = await logCount();
    await page.keyboard.press("KeyZ");
    const z1 = await waitLog(/^key down Space " " 32/, 3000, from);
    const b1 = await waitLog(/^button JUMP down/, 3000, from);
    ok("키(호스트 초점): Z → 게임 Space(key \" \"·keyCode 32) + button JUMP", z1 && b1, `${z1} / ${b1}`);
    from = await logCount();
    await page.keyboard.down("ArrowRight");
    await sleep(300);
    await page.keyboard.up("ArrowRight");
    ok("키(호스트 초점): 방향 → ArrowRight", await waitLog(/^key down ArrowRight/, 2000, from));
    await page.frameLocator("#screen .script-frame").locator("canvas").click({ position: { x: 20, y: 20 }, force: true });
    from = await logCount();
    await page.keyboard.press("KeyZ");
    const z2 = await waitLog(/^key down Space/, 3000, from);
    ok("키(틀 초점): Z → 틀이 호스트로 넘김 → 게임 Space", z2, z2 ?? (await logs()).slice(from).join(" | "));
    from = await logCount();
    await page.keyboard.down("Space");
    await sleep(300);
    const fastOn = await waitLog(/^event speed [2-9]/, 2000, from);
    await page.keyboard.up("Space");
    const fastOff = await waitLog(/^event speed 1/, 2000, from);
    const leaked = (await logs()).slice(from).filter((l) => /^key down Space/.test(l));
    ok("키(틀 초점): 실제 Space = 호스트 몫(누르는 동안 빨리 감기) — 게임엔 안 감", fastOn && fastOff && !leaked.length, `${fastOn} / ${fastOff} / 새어 감 ${leaked.length}`);

    // 3. 세이브(게임 id 키)
    await sleep(1500);
    const save1 = await host(async () => {
      const g = window.webgba.state.game;
      const bytes = await window.webgba.store.saveBytes(g.saveId);
      return { id: g.saveId, n: bytes && bytes.length === 4 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) : -1 };
    });
    ok("세이브: webgba.save.write → 게임 id 키에 저장", save1.id === "io.example.s4.module" && save1.n === 2, JSON.stringify(save1));

    // 4. 퀵슬롯
    from = await logCount();
    const quick = await host(async () => {
      const p = window.webgba.player;
      const can = p.canState;
      const saved = await p.saveState(1);
      const states = await window.webgba.store.states(window.webgba.state.game.saveId);
      return { can, saved, slots: states.map((s) => s.slot), thumb: states.find((s) => s.slot === 1)?.thumb ? true : false, image: `${p.image.width}x${p.image.height}` };
    });
    await focusHost();
    await page.keyboard.press("KeyZ");
    await sleep(200);
    const loaded = await host(() => window.webgba.player.loadState(1));
    const stateLine = await waitLog(/^state load \d+ \d+ 2$/, 3000, from);
    ok("퀵슬롯: 저장(칸 그림 320x240) → 점프 → 불러오기 = 그때 값(점프 2)", quick.can && quick.saved && quick.slots.includes(1) && loaded === true && stateLine, `${JSON.stringify(quick)} · ${stateLine}`);

    // 5. 일시정지(틀이 requestAnimationFrame 을 붙잡음)·다시
    from = await logCount();
    await host(() => window.webgba.player.setPaused(true));
    await sleep(2200);
    const pausedFps = await host(() => window.webgba.player.host.fps);
    await host(() => window.webgba.player.setPaused(false));
    await sleep(2200);
    const resumed = await host(() => ({ fps: window.webgba.player.host.fps, queued: window.webgba.player.host.rafQueued }));
    const pauseEvents = (await logs()).slice(from).filter((l) => /^event (pause|resume)/.test(l));
    ok("일시정지: 틀 화면 멈춤(0fps) → 다시 · 붙잡았던 화면 갱신 하나만 풀림 · pause/resume 사건", pausedFps < 1 && resumed.fps >= Math.min(50, hostFps * 0.85) && resumed.queued <= 1 && pauseEvents.length === 2, `${pausedFps} → ${resumed.fps}fps · 대기 ${resumed.queued} · ${pauseEvents.join(",")}`);

    // 6. 다시 시작 → 세이브에서 이어
    from = await logCount();
    await host(() => window.webgba.player.reset());
    const restart = await waitLog(/^start jumps 3 /, 8000, from);
    ok("다시 시작: 틀을 새로 → 세이브에서(점프 3)", restart, restart ?? (await logs()).slice(from).join(" | "));

    // 7. 소리
    await focusHost();
    from = await logCount();
    await page.keyboard.press("KeyZ");
    const audio = await waitLog(/^audio /, 3000, from);
    ok("소리: 틀 안 AudioContext(webgba.audioContext)", name === "webkit" ? Boolean(audio) : audio === "audio running", `${audio}${name === "webkit" ? " (이 웹킷 빌드는 AudioContext 상태만 확인)" : ""}`);

    // 8. CPU 6배 느리게(크롬만 — CDP)
    if (name === "chromium") {
      const sessions = [await context.newCDPSession(page)];
      const inner = page.frames().find((f) => f !== page.mainFrame());
      try {
        if (inner) sessions.push(await context.newCDPSession(inner));
      } catch {}
      for (const s of sessions) await s.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      await sleep(1500);
      from = await logCount();
      await sleep(2500);
      const slowFps = await host(() => window.webgba.player.host.fps);
      const slowPerf = await waitLog(/^perf /, 4000, from);
      const slowRtt = [];
      for (let i = 0; i < 100; i++) slowRtt.push(await host(() => window.webgba.player.host.ping()));
      for (const s of sessions) await s.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const r6 = median(slowRtt);
      ok("CPU 6배 느리게: 틀 그리기·왕복", slowFps >= 45, `${slowFps}fps · ${slowPerf?.slice(5) ?? ""} · 왕복 가운데 ${r6.median}ms p95 ${r6.p95}ms · 틀 세션 ${sessions.length > 1 ? "따로(다른 프로세스)" : "같음"}`);
    }

    // 9. 틀이 스스로 다른 문서로 → 지우고 멈춤
    await pick(files.nav);
    await sleep(1500);
    const nav = await host(() => ({ halted: window.webgba.player.host?.halted ?? "", frame: Boolean(document.querySelector("#screen .script-frame")), toast: document.getElementById("toast").textContent }));
    ok("틀이 스스로 다른 문서로 → 틀 지우고 멈춤", nav.halted && !nav.frame, JSON.stringify(nav));

    // 10. emscripten(SDL1) — files 조각·save.kind files·키(keyCode)
    await pick(files.emscripten);
    const asset = await waitLog(/^info asset hello from data chunk/, 8000);
    const first = await waitLog(/^info (no save|loaded \d+)/, 3000);
    await focusHost();
    let from2 = await logCount();
    await page.keyboard.press("KeyZ");
    const sdlKey = await waitLog(/^info key 122 down/, 3000, from2);
    const sdlSaved = await waitLog(/^info saved 1/, 3000, from2);
    await sleep(2500);
    const emSave = await host(async () => {
      const g = window.webgba.state.game;
      const bytes = await window.webgba.store.saveBytes(g.saveId);
      return { id: g.saveId, len: bytes?.length ?? 0, fps: window.webgba.player.host.fps };
    });
    ok("emscripten: files 조각(.data) · Z → SDL 키 122 · FS 세이브", asset && first === "info no save" && sdlKey && sdlSaved && emSave.len === 4, `${first} · ${sdlKey} · ${sdlSaved} · ${JSON.stringify(emSave)}`);
    await pick(files.module);
    await pick(files.emscripten);
    const reloaded = await waitLog(/^info loaded 1/, 8000);
    ok("emscripten: 다시 열면 FS 세이브를 /save/game.sav 에 놓음", reloaded, reloaded ?? (await logs()).join(" | "));

    // 11. ① 160×144(240×160 아닌 화면)
    if (files.screen) {
      await pick(files.screen);
      await sleep(500);
      const scr = await host(() => {
        const c = document.getElementById("canvas");
        const px = c.getContext("2d").getImageData(1, 1, 1, 1).data;
        return { w: c.width, h: c.height, fit: getComputedStyle(c).objectFit, px: Array.from(px).join(","), host: `${window.webgba.player.host.width}x${window.webgba.player.host.height}` };
      });
      ok("① 화면 160×144: 캔버스·그림 크기 그대로, 화면 칸 안 비율 맞춤", scr.w === 160 && scr.h === 144 && scr.fit === "contain" && scr.host === "160x144" && scr.px !== "0,0,0,0", JSON.stringify(scr));
    }
    // web-inspector://bootstrap.js = Playwright 웹킷이 틀에 넣는 자기 스크립트가 출처 없는 틀에서 내는 오류(앱·게임 것 아님)
    // blob:null/ = 게임 코드(틀 안)가 막힌 시도에서 낸 것 — 앱 오류만 셈
    const unexpected = pageErrors.filter((m) => !/web-inspector:\/\/|blob:null\//.test(m));
    ok("페이지 오류 없음", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
  } catch (error) {
    ok("시험 도중 오류", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" "));
  } finally {
    await browser.close();
  }
}

const wanted = opt.only ? [opt.only] : ["chromium", "webkit"];
try {
  if (wanted.includes("chromium")) {
    const { chromium } = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url)("playwright-core");
    await (REPO ? runRepo : run)("chromium", chromium, { executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  }
  if (wanted.includes("webkit")) {
    const { webkit } = createRequire(process.env.WEBKIT_PLAYWRIGHT_DIR ?? process.env.PLAYWRIGHT_DIR ? path.join(process.env.WEBKIT_PLAYWRIGHT_DIR ?? process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url)("playwright-core");
    await (REPO ? runRepo : run)("webkit", webkit, { headless: true });
  }
} finally {
  server.close();
  udp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
