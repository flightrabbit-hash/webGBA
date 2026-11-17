// 웹 webGBA 모바일 게임(.wmba) 소리 경로 시험 — 웹킷: 소리 중계(본 창 AudioContext)·덮개 없음, 크롬(PC): 틀 안 소리 그대로.
//   node web/build.mjs && PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-wmba-audio.mjs --wmba <게임.wmba> [--chrome <chrome.exe>] [--shots <캡처 폴더>]
// 웹킷(Playwright, 아이폰 크기 터치 화면): Windows 빌드에는 Web Audio 가 없어 본 창·틀 모두에 웹킷 시작 규칙을 따르는 작은
//   AudioContext·AudioWorkletNode 를 넣는다 — 그 문서 창 자신의 transient activation 이 있을 때만 시작(WebKit
//   AudioContext::willBeginPlayback → shouldDocumentAllowWebAudioToAutoPlay, bug 247614). 본 창 노드는 받은 표본(직접·옮긴 feed 포트)을 센다.
//   Playwright 웹킷의 evaluate·screenshot·setFiles 는 흉내 사용자 동작을 남기므로, 사용자 동작은 그 문서(또는 틀 — 조상으로 번짐)의
//   실제 입력 이벤트가 5초 안에 있었을 때만 인정하고, 읽기는 모두 콘솔 줄로 한다.
//   quick = 고른 누름 직후 열림 · slow-pad = 누름 6초 뒤 열림 → 첫 가상 키 · slow-screen = 같은데 첫 입력이 게임 화면 터치.
// 크롬(실제 Web Audio, 기본 자동 재생 규칙): PC 기본 = 틀 안 GameAudioContext, localStorage webgba.audioRelay "1" = 중계. 출력 크기를 잰다.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = opt.shots ?? "";
if (!opt.wmba || !fs.existsSync(opt.wmba)) {
  console.error("--wmba <게임.wmba> 가 필요합니다");
  process.exit(2);
}
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let who = "";
const ok = (name, pass, detail = "") => {
  results.push({ name: `[${who}] ${name}`, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} [${who}] ${name}${detail ? ` — ${detail}` : ""}`);
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
const pw = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url)("playwright-core");

const STANDALONE = () => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window === window.top) localStorage.setItem("webgba.installHint", "1");
};

// 웹킷 시작 규칙을 따르는 Web Audio(본 창·틀 모두). 틀은 자기 상태를 본 창에 알린다.
const WEBKIT_AUDIO = () => {
  const top = window === window.top;
  const clock = () => performance.timeOrigin + performance.now();
  window.__lastTrusted = -1e12;
  window.__frameTrusted = -1e12;
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown", "mousedown", "click"]) {
    window.addEventListener(
      type,
      (e) => {
        if (!e.isTrusted) return;
        window.__lastTrusted = clock();
        if (!top) parent.postMessage({ type: "__trusted", t: window.__lastTrusted }, "*");
      },
      true,
    );
  }
  if (top) window.addEventListener("message", (e) => e.data?.type === "__trusted" && (window.__frameTrusted = e.data.t));
  const recentInput = () => clock() - Math.max(window.__lastTrusted, top ? window.__frameTrusted : -1e12) < 5000;
  const counters = (window.__audioCount = []);
  const node = (ctx) => ({ context: ctx, connect: (n) => n, disconnect() {}, gain: { value: 1 }, frequency: { value: 440 }, buffer: null, start() { ctx.__wantStart(); }, stop() {} });
  class BaseAudioContext extends EventTarget {}
  Object.defineProperty(BaseAudioContext.prototype, "destination", { get() { return (this.__dest ??= node(this)); }, configurable: true });
  class AudioContext extends BaseAudioContext {
    constructor() {
      super();
      this.__state = "suspended";
      this.__allowed = false;
      this.__waiting = [];
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.audioWorklet = { addModule: async () => {} };
      (window.__contexts ??= []).push(this);
    }
    get state() { return this.__state; }
    __set(next) {
      if (next === this.__state) return;
      this.__state = next;
      this.dispatchEvent(new Event("statechange"));
      if (next === "running") for (const done of this.__waiting.splice(0)) done();
    }
    __may() {
      if (!this.__allowed && navigator.userActivation?.isActive && recentInput()) this.__allowed = true;
      return this.__allowed;
    }
    __wantStart() { if (this.__may()) this.__set("running"); }
    resume() {
      if (this.__state === "closed") return Promise.reject(new DOMException("closed", "InvalidStateError"));
      if (this.__may()) {
        this.__set("running");
        return Promise.resolve();
      }
      return new Promise((done) => this.__waiting.push(done));
    }
    suspend() { if (this.__state === "running") this.__set("suspended"); return Promise.resolve(); }
    close() { this.__set("closed"); return Promise.resolve(); }
    createGain() { return node(this); }
    createOscillator() { return node(this); }
    createBufferSource() { return node(this); }
    createBuffer() { return {}; }
  }
  class AudioWorkletNode {
    constructor(ctx, name) {
      Object.assign(this, node(ctx));
      const ch = new MessageChannel();
      this.port = ch.port1;
      const c = { name, ctx, samples: 0, played: 0, feed: false };
      counters.push(c);
      const take = (data) => {
        if (!(data instanceof Float32Array)) return;
        c.samples += data.length / 2;
        if (ctx.state === "running") c.played += data.length / 2;
      };
      ch.port2.onmessage = (e) => {
        if (e.data?.feed instanceof MessagePort) {
          c.feed = true;
          e.data.feed.onmessage = (m) => take(m.data);
        } else take(e.data);
      };
    }
  }
  Object.assign(window, { BaseAudioContext, AudioContext, AudioWorkletNode });
  if (top) return;
  setInterval(() => {
    const t = document.getElementById("tap");
    const w = window.__wmba;
    parent.postMessage({ type: "__frame", tap: Boolean(t && !t.hidden && getComputedStyle(t).display !== "none"), frames: w?.frames ?? -1, mode: w ? (w.synth ? "thread" : w.audio ? "page" : "none") : "-", ctx: w?.audio?.context?.constructor?.name ?? "-", ctxState: w?.audio?.context?.state ?? "-", own: (window.__contexts ?? []).length }, "*");
  }, 150);
};

const REPORTER = () => {
  if (window !== window.top) return;
  window.addEventListener("message", (e) => e.data?.type === "__frame" && (window.__frame = e.data));
  setInterval(() => {
    const host = window.webgba?.player?.host;
    const relay = host?.relay;
    const center = (el) => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 4 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    };
    const keys = [...document.querySelectorAll(".pad .key[data-key]")].filter((n) => n.offsetParent && n.getBoundingClientRect().width > 10);
    const counted = (window.__audioCount ?? []).find((c) => c.ctx === relay?.ac);
    console.log(
      "__probe " +
        JSON.stringify({
          ready: document.documentElement.dataset.ready === "1",
          running: Boolean(document.body.dataset.view === "game" && window.webgba?.player?.running && !window.webgba?.state?.opening),
          frame: window.__frame ?? null,
          relay: relay ? relay.ac.state : null,
          node: counted ? { name: counted.name, feed: counted.feed, samples: counted.samples, played: counted.played } : null,
          key: center(keys.find((n) => n.dataset.key === "N5") ?? keys[0]),
          screen: center(document.querySelector("#screen .script-frame")),
        }),
    );
  }, 150);
};

async function webkitRun(variant) {
  who = `webkit ${variant}`;
  const browser = await pw.webkit.launch({ headless: true });
  let last = null;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1" });
    await context.addInitScript(STANDALONE);
    await context.addInitScript(WEBKIT_AUDIO);
    await context.addInitScript(REPORTER);
    const page = await context.newPage();
    page.on("console", (m) => m.text().startsWith("__probe ") && (last = JSON.parse(m.text().slice(8))));
    const until = async (fn, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (last && fn(last)) return;
        await sleep(100);
      }
      throw new Error(`시간 넘김: ${what}`);
    };
    const snap = async () => (await sleep(350), structuredClone(last));
    const tell = (s) => `덮개 ${s.frame?.tap} · 프레임 ${s.frame?.frames} · 게임 소리 ${s.frame?.ctx}/${s.frame?.ctxState}(${s.frame?.mode}) · 틀 자체 컨텍스트 ${s.frame?.own} · 본 창 중계 ${s.relay} · 노드 ${s.node ? `${s.node.name} 받음 ${s.node.samples} 재생 ${s.node.played}` : "-"}`;
    await page.goto(BASE);
    await until((s) => s.ready, 30000, "준비");
    await sleep(500);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.tap("#startOpen")]);
    if (variant !== "quick") await sleep(6000);
    await chooser.setFiles(opt.wmba);
    await until((s) => s.running && s.frame?.frames > 0, 90000, "게임 시작");
    await sleep(3000);
    const start = await snap();
    await sleep(1500);
    const later = await snap();
    if (variant === "quick") {
      ok("고른 누름이 살아 있을 때 열림 → 덮개 없이 바로 소리(본 창 중계 running, 표본 재생)", !start.frame.tap && start.frame.ctx === "RelayAudioContext" && start.relay === "running" && start.node?.played > 0 && start.node.played === start.node.samples, tell(start));
    } else {
      ok("늦게 열림: 덮개 없음 · 화면 진행 · 첫 입력 전 무음(중계 suspended, 받은 표본만 쌓임)", !start.frame.tap && !later.frame.tap && later.frame.frames > start.frame.frames && start.relay === "suspended" && later.node?.samples > 0 && later.node.played === 0 && start.frame.own === 0, `${tell(start)} → 프레임 ${later.frame.frames}`);
      const at = variant === "slow-pad" ? last.key : last.screen;
      await page.touchscreen.tap(at.x, at.y);
      await sleep(900);
      const after = await snap();
      await sleep(1200);
      const end = await snap();
      ok(variant === "slow-pad" ? "첫 가상 키(본 창 누름) → 중계 running · 표본 재생" : "첫 게임 화면 터치(틀 안 → 본 창으로 번짐) → 중계 running · 표본 재생", after.relay === "running" && end.node.played > after.node.played && after.node.played > 0 && !end.frame.tap, `${tell(after)} → 재생 ${end.node.played}`);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `webkit-${variant}.png`) });
  } catch (error) {
    ok("시험 도중 오류", false, `${String(error?.message ?? error).split("\n")[0]} · 마지막 ${JSON.stringify(last)?.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
}

async function chromiumRun(relay) {
  who = `chromium ${relay ? "중계 강제" : "PC 기본"}`;
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await context.addInitScript(STANDALONE);
    await context.addInitScript((on) => {
      if (window !== window.top) return;
      if (on) localStorage.setItem("webgba.audioRelay", "1");
      else localStorage.removeItem("webgba.audioRelay");
    }, relay);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click("#startOpen")]);
    await chooser.setFiles(opt.wmba);
    await page.waitForFunction(() => !window.webgba.state.opening && document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout: 90000 });
    await sleep(2500);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const side = await frame.evaluate(() => {
      const w = globalThis.__wmba;
      return { tap: !document.getElementById("tap").hidden, ctx: w?.audio?.context?.constructor?.name ?? "-", state: w?.audio?.context?.state ?? "-", mode: w ? (w.synth ? "thread" : w.audio ? "page" : "none") : "-" };
    });
    // 게임 소리를 내는 쪽(본 창 중계 gain 또는 틀 컨텍스트의 노드)에 분석기를 달아 출력 크기를 잰다
    const where = relay ? page : frame;
    await where.evaluate((onHost) => {
      const out = onHost ? window.webgba.player.host.relay : null;
      const ac = onHost ? out.ac : globalThis.__wmba.audio.context;
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      (onHost ? out.gain : globalThis.__wmba.audio).connect(an);
      globalThis.__an = an;
    }, relay);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      if (i === 5 || i === 18) await page.keyboard.press("Enter");
      peak = Math.max(peak, await where.evaluate(() => {
        const a = new Float32Array(2048);
        globalThis.__an.getFloatTimeDomainData(a);
        return a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      }));
      await sleep(100);
    }
    const hostRelay = await page.evaluate(() => window.webgba.player.host.relay?.ac.state ?? null);
    const want = relay ? side.ctx === "RelayAudioContext" && hostRelay === "running" : side.ctx === "GameAudioContext" && hostRelay === null;
    ok(relay ? "게임 소리 = 본 창 중계 AudioContext · 출력 있음 · 덮개 없음" : "게임 소리 = 틀 안 GameAudioContext(이전과 같음) · 출력 있음 · 덮개 없음", want && side.state === "running" && peak > 0.01 && !side.tap, `${side.ctx}/${side.state}(${side.mode}) · 본 창 중계 ${hostRelay} · 최대 ${peak.toFixed(3)}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `chromium-${relay ? "relay" : "pc"}.png`) });
    ok("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  } catch (error) {
    ok("시험 도중 오류", false, String(error?.message ?? error).split("\n")[0]);
  } finally {
    await browser.close();
  }
}

try {
  for (const variant of ["quick", "slow-pad", "slow-screen"]) await webkitRun(variant);
  await chromiumRun(false);
  await chromiumRun(true);
} finally {
  server.close();
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n실패 ${failed.length} / ${results.length}` : `\n모두 통과 ${results.length}`);
process.exit(failed.length ? 1 : 0);
