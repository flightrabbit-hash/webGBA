// 스플래시 새 배경(PixelLab 26장) 테스트(로컬 전용) — 오프라인 캐시 완료 후 각 배경별로 실제 출력,
// 소실점 위치·가장자리 연장(지평선 위 화소 = 그림)·바닥 흐름 표식·그림자·도착 배율 확인 후 세로·가로 캡처.
// 네트워크 차단 후 열기, 캐시가 빈 첫 접속의 새 배경 수신 시점·첫 그림 시각(--main 지정 시 변경 전 빌드와 번갈아 5회씩).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-splash-bg.mjs <주소> <캡처 폴더> [--main <변경 전 빌드 주소>] [--chrome <chrome.exe>]
// 배경 선택은 Date(날짜·시각)와 Math.random 1회 고정으로 대역 — 같은 plan.js 를 node vm 에서 실행해 해당 배경이 나오는 값을 산출.
// 캡처 중에는 webgbaSplash.ready 를 비워 스플래시 유지(앱 준비 신호만 차단).
// 같은 프로세스의 정적 서버가 globalThis.__served 에 요청을 기록하면 오프라인 서버 요청 0도 확인(없으면 생략).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const pngOut = createRequire(import.meta.url)("../../tools/test/png.cjs");

const args = process.argv.slice(2);
const [URL_BASE, SHOTS] = args;
const flag = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null);
const CHROME = flag("--chrome") || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MAIN = flag("--main");
fs.mkdirSync(SHOTS, { recursive: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "src", "splash");
const sceneText = fs.readFileSync(path.join(dir, "splash.js"), "utf8").match(/const SCENES = \{([\s\S]*?)\n  \};/)[1];
const SCENES = Object.fromEntries([...sceneText.matchAll(/^\s*"?([\w-]+)"?: \[(\d+), (\d+), (\d+), (\d+), "(\w+)", (\d+)\]/gm)].map((m) => [m[1], { ax: Number(m[2]), ay: Number(m[3]) }]));
const IDS = Object.keys(SCENES);

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

const planScript = new vm.Script(fs.readFileSync(path.join(dir, "plan.js"), "utf8"));
function listAt(when) {
  class FakeDate extends Date {
    constructor(...a) {
      if (a.length) super(...a);
      else super(when);
    }
  }
  const box = { Date: FakeDate, navigator: { serviceWorker: { controller: {} } }, matchMedia: () => ({ matches: true }), screen: { width: 390, height: 844 }, localStorage: { getItem: () => null, setItem() {} }, Image: class { decode() { return Promise.resolve(); } } };
  box.window = box;
  vm.createContext(box);
  planScript.runInContext(box);
  box.webgbaSplashPlan.ready.catch(() => {});
  return box.webgbaSplashPlan.list;
}
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 30, 0).getTime();
const TIMES = [at(2026, 11, 24, 6), at(2026, 5, 5, 6), at(2026, 7, 7, 6), at(2027, 1, 12, 6), at(2026, 6, 10, 12), at(2026, 7, 11, 17, 30), at(2027, 1, 16, 20), at(2026, 11, 24, 1), at(2026, 10, 28, 23, 30)];
function force(id) {
  for (const when of TIMES) {
    const list = listAt(when);
    const total = list.reduce((sum, [, w]) => sum + w, 0);
    let before = 0;
    for (const [one, w] of list) {
      if (one === id) return { at: when, r: (before + w / 2) / total };
      before += w;
    }
  }
  throw new Error(`${id} 이(가) 든 시각 없음`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

async function phone(viewport = PORTRAIT, dpr = 3) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    let cfg = null;
    try {
      cfg = JSON.parse(localStorage.getItem("test.splash") || "null");
      localStorage.removeItem("webgba.splashRecent");
      localStorage.setItem("webgba.installHint", "1");
    } catch {}
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    new MutationObserver(() => {
      if (!window.__readyAt && document.documentElement?.dataset.ready === "1") window.__readyAt = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-ready"] });
    if (!cfg) return;
    const Real = Date;
    const shift = cfg.at - Real.now();
    window.Date = class extends Real {
      constructor(...a) {
        if (a.length) super(...a);
        else super(Real.now() + shift);
      }
      static now() {
        return Real.now() + shift;
      }
    };
    if (cfg.r !== undefined) {
      const real = Math.random;
      Math.random = () => ((Math.random = real), cfg.r);
    }
    if (cfg.hold) {
      let held;
      Object.defineProperty(window, "webgbaSplash", { configurable: true, get: () => held, set: (v) => ((v.ready = () => {}), (held = v)) });
    }
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return { context, page };
}

const startOf = (page) => page.waitForFunction(() => window.webgbaSplash?.startAt || !document.getElementById("splash"), null, { timeout: 20000, polling: 10 });
const readyOf = (page) => page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
const cacheState = (page) =>
  page.evaluate(async (ids) => {
    const reg = await navigator.serviceWorker.getRegistration();
    let n = 0;
    for (const id of ids) if (await caches.match(`/splash/${id}.png`)) n++;
    return { active: Boolean(reg?.active), controlled: Boolean(navigator.serviceWorker.controller), n };
  }, IDS);
async function fillCache(page, url = URL_BASE) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load" });
  for (;;) {
    const s = await cacheState(page).catch(() => null);
    if (s && s.active && s.controlled && s.n === IDS.length) return Date.now() - t0;
    if (Date.now() - t0 > 60000) throw new Error(`캐시가 차지 않음 ${JSON.stringify(s)}`);
    await sleep(100);
  }
}
async function show(page, cfg) {
  await page.evaluate((c) => localStorage.setItem("test.splash", JSON.stringify(c)), cfg);
  await page.reload({ waitUntil: "commit" });
  await startOf(page);
}

function inspect({ ax, ay }) {
  const s0 = window.webgbaSplash;
  const [back, front] = document.querySelectorAll("#splash canvas");
  const dpr = devicePixelRatio;
  const vw = Math.round(innerWidth * dpr);
  const vh = Math.round(innerHeight * dpr);
  const s = Math.max(1, Math.round(3 * dpr));
  const axis = Math.floor(vw / 2);
  const AX = Math.ceil(axis / s);
  const hyL = Math.ceil(Math.round(vh * 0.4) / s);
  return new Promise((resolve) => {
    const image = new Image();
    image.src = `/splash/${s0.variant}.png`;
    image.decode().then(() => {
      const work = document.createElement("canvas");
      work.width = image.width;
      work.height = image.height;
      const g = work.getContext("2d");
      g.drawImage(image, 0, 0);
      const src = g.getImageData(0, 0, image.width, image.height).data;
      const read = () => back.getContext("2d").getImageData(0, 0, back.width, back.height).data;
      const a = read();
      const clamp = (v, max) => Math.min(max - 1, Math.max(0, v));
      let skyDiff = 0;
      let groundMarks = 0;
      const ground = [];
      for (let y = 0; y < back.height; y++)
        for (let x = 0; x < back.width; x++) {
          const from = (clamp(y - (hyL - ay), image.height) * image.width + clamp(x - (AX - ax), image.width)) * 4;
          const to = (y * back.width + x) * 4;
          const same = a[to] === src[from] && a[to + 1] === src[from + 1] && a[to + 2] === src[from + 2] && a[to + 3] === 255;
          if (y < hyL) skyDiff += same ? 0 : 1;
          else if (!same) groundMarks++;
          if (y >= hyL) ground.push(to);
        }
      setTimeout(() => {
        const b = read();
        let moved = 0;
        for (const i of ground) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) moved++;
        const fd = front.getContext("2d").getImageData(0, 0, front.width, front.height).data;
        const shadow = s0.shadow.toLowerCase();
        const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(shadow.slice(i, i + 2), 16));
        const rows = new Map();
        for (let y = 0; y < front.height; y++)
          for (let x = 0; x < front.width; x++) {
            const i = (y * front.width + x) * 4;
            if (fd[i + 3] && fd[i] === sr && fd[i + 1] === sg && fd[i + 2] === sb) rows.set(y, (rows.get(y) || 0) + 1);
          }
        const lowest = Math.max(-1, ...rows.keys());
        resolve({ variant: s0.variant, LW: back.width, LH: back.height, AX, hyL, skyDiff, skyPixels: hyL * back.width, groundMarks, moved, shadow, shadowK: (rows.get(lowest) || 0) / 20, dpr });
      }, 200);
    });
  });
}

async function capture(page) {
  page.cdp ??= await page.context().newCDPSession(page);
  return decodePng(Buffer.from((await page.cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
function shrink(img, k) {
  const w = Math.floor(img.width / k);
  const h = Math.floor(img.height / k);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.copy(data, (y * w + x) * 4, ((y * k) * img.width + x * k) * 4, ((y * k) * img.width + x * k) * 4 + 4);
  return { width: w, height: h, data };
}
function sheet(parts, cols, file) {
  const gap = 12;
  const cw = Math.max(...parts.map((p) => p.width));
  const ch = Math.max(...parts.map((p) => p.height));
  const rows = Math.ceil(parts.length / cols);
  const width = cols * cw + (cols - 1) * gap;
  const height = rows * ch + (rows - 1) * gap;
  const out = Buffer.alloc(width * height * 4, 0);
  parts.forEach((p, i) => {
    const x0 = (i % cols) * (cw + gap);
    const y0 = Math.floor(i / cols) * (ch + gap);
    for (let y = 0; y < p.height; y++) p.data.copy(out, ((y0 + y) * width + x0) * 4, y * p.width * 4, (y + 1) * p.width * 4);
  });
  fs.writeFileSync(path.join(SHOTS, file), pngOut.encode(out, width, height));
}

async function firstVisit(url) {
  const { context, page } = await phone();
  const t0 = Date.now();
  const seen = [];
  context.on("request", (request) => seen.push({ at: Date.now(), port: Number(new URL(request.url()).port), path: new URL(request.url()).pathname }));
  const from = (globalThis.__served || []).length;
  await page.goto(url, { waitUntil: "commit" });
  await startOf(page);
  await readyOf(page);
  const times = await page.evaluate(() => ({ origin: performance.timeOrigin, start: window.webgbaSplash?.startAt || 0, ready: window.webgbaSplash?.readyAt || 0, variant: window.webgbaSplash?.variant, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime || 0 }));
  let cachedAt = 0;
  for (;;) {
    const s = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      if (!reg?.active || !keys.length) return false;
      const cache = await caches.open(keys.find((k) => k.startsWith("webgba-")));
      return Boolean(await cache.match("/__files.json"));
    });
    if (s) {
      cachedAt = Date.now() - t0;
      break;
    }
    if (Date.now() - t0 > 60000) break;
    await sleep(50);
  }
  const port = Number(new URL(url).port);
  const served = (globalThis.__served ? globalThis.__served.slice(from) : seen).filter((r) => r.port === port);
  const fresh = served.filter((r) => IDS.some((id) => r.path === `/splash/${id}.png`));
  const splashStart = times.origin + times.start;
  const appReady = times.origin + times.ready;
  await context.close();
  return { ...times, cachedAt, fresh: fresh.length, earliest: fresh.length ? Math.min(...fresh.map((r) => r.at)) : 0, splashStart, appReady, served: served.length, errors: page.errors };
}

{
  const runs = [];
  for (let i = 0; i < 5; i++) {
    runs.push({ build: "새", ...(await firstVisit(URL_BASE)) });
    if (MAIN) runs.push({ build: "전", ...(await firstVisit(MAIN)) });
  }
  const mine = runs.filter((r) => r.build === "새");
  const before = runs.filter((r) => r.build === "전");
  const late = mine.filter((r) => r.fresh && r.earliest < r.appReady);
  ok("첫 접속(캐시 없음): 새 배경 26장은 스플래시 첫 그림·앱 준비 뒤 서비스 워커가 받음, 첫 화면은 초원", mine.every((r) => r.variant === "meadow" && r.fresh === IDS.length && !r.errors.length) && !late.length, `받은 새 배경 ${mine.map((r) => r.fresh).join("/")}장 · 첫 새 배경 요청 = 앱 준비 + ${mine.map((r) => Math.round(r.earliest - r.appReady)).join("/")}ms(첫 그림 + ${mine.map((r) => Math.round(r.earliest - r.splashStart)).join("/")}ms)`);
  const text = (list) => `첫 그림 ${median(list.map((r) => r.start)).toFixed(0)}ms · FCP ${median(list.map((r) => r.fcp)).toFixed(0)}ms · 앱 준비 ${median(list.map((r) => r.ready)).toFixed(0)}ms · 오프라인 준비 ${median(list.map((r) => r.cachedAt))}ms · 요청 ${median(list.map((r) => r.served))}개`;
  if (MAIN) {
    const d = median(mine.map((r) => r.start)) - median(before.map((r) => r.start));
    ok("첫 접속 첫 그림 시각: 바꾸기 전과 같은 수준(중앙값 차이 50ms 이하)", Math.abs(d) <= 50, `새 ${text(mine)} / 전 ${text(before)} · 첫 그림 차이 ${d.toFixed(0)}ms`);
  } else console.log(`참고 첫 접속: ${text(mine)}`);
}

const shots = { portrait: [], landscape: [] };
{
  const { context, page } = await phone(PORTRAIT, 3);
  const fillMs = await fillCache(page);
  ok("오프라인 캐시: 서비스 워커가 새 배경 26장을 모두 담음", (await cacheState(page)).n === IDS.length, `첫 방문부터 다 담기까지 ${fillMs}ms`);
  for (const [viewport, key] of [[PORTRAIT, "portrait"], [LANDSCAPE, "landscape"]]) {
    await page.setViewportSize(viewport);
    const bad = [];
    let checked = 0;
    for (const id of IDS) {
      await show(page, { ...force(id), hold: true });
      await sleep(2100);
      const s = await page.evaluate(inspect, SCENES[id]);
      const fine = s.variant === id && s.skyDiff === 0 && s.groundMarks > 0 && s.moved > 0 && s.shadowK > 0 && Number.isInteger(s.shadowK);
      if (!fine) bad.push(`${id}: ${JSON.stringify({ variant: s.variant, skyDiff: s.skyDiff, marks: s.groundMarks, moved: s.moved, k: s.shadowK })}`);
      checked++;
      shots[key].push(shrink(await capture(page), 3));
      if (page.errors.length) bad.push(`${id} 오류 ${page.errors.join(" | ")}`);
    }
    const sample = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    ok(`${key === "portrait" ? "세로" : "가로"} ${sample.w}×${sample.h}(DPR 3) 새 배경 ${checked}장: 고른 배경 그대로·지평선 위 화소 = 그림(소실점 자리·가장자리 연장)·바닥 흐름 표식이 움직임·그림자·도착 정수 배율`, !bad.length, bad.join(" | ") || "모두 맞음");
  }
  sheet(shots.portrait.map((p) => shrink(p, 2)), 7, "스플래시_새배경_세로.png");
  sheet(shots.landscape.map((p) => shrink(p, 2)), 4, "스플래시_새배경_가로.png");

  await page.setViewportSize(PORTRAIT);
  const halloween = force("halloween");
  await page.evaluate((c) => localStorage.setItem("test.splash", JSON.stringify(c)), { ...halloween, hold: false });
  await context.setOffline(true);
  const from = (globalThis.__served || []).length;
  page.errors.length = 0;
  await page.reload({ waitUntil: "commit" });
  await startOf(page);
  const variant = await page.evaluate(() => window.webgbaSplash?.variant);
  await readyOf(page);
  const hits = (globalThis.__served || []).slice(from).map((r) => r.path);
  const app = await page.evaluate(() => ({ splash: Boolean(document.getElementById("splash")), start: getComputedStyle(document.getElementById("start")).visibility, online: navigator.onLine }));
  const pageHits = hits.filter((p) => p !== "/sw.js");
  ok("오프라인(네트워크 끊음): 캐시에서 새 배경 스플래시(핼러윈)·앱 첫 화면까지, 페이지 요청이 서버에 닿지 않음", variant === "halloween" && !app.splash && app.start === "visible" && !app.online && !page.errors.length && (globalThis.__served ? !pageHits.length : true), `배경 ${variant} · 서버에 닿은 요청 ${globalThis.__served ? hits.join(",") || "없음" : "(모름)"}(sw.js = 브라우저의 워커 갱신 확인, 페이지 요청 아님) · ${JSON.stringify(app)}${page.errors.length ? ` · 오류 ${page.errors.join(" | ")}` : ""}`);

  const cherry = force("spring-cherry");
  await page.evaluate(async (c) => {
    localStorage.setItem("test.splash", JSON.stringify(c));
    for (const key of await caches.keys()) await (await caches.open(key)).delete("/splash/spring-cherry.png");
  }, { ...cherry, hold: false });
  page.errors.length = 0;
  await page.reload({ waitUntil: "commit" });
  await startOf(page);
  const gone = await page.evaluate(() => window.webgbaSplash?.variant);
  await readyOf(page);
  ok("오프라인에서 고른 새 배경 그림을 못 받으면(캐시에서 지움) 초원으로 바꿔 스플래시·앱 정상", gone === "meadow" && !page.errors.length, `${gone}${page.errors.length ? ` · 오류 ${page.errors.join(" | ")}` : ""}`);
  await context.setOffline(false);
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
