// 웹 시작 스플래시 시험(로컬 전용) — 휴대폰(터치 전용·짧은 변 600px 이하)에서만 보이는지, 시간대별 배경(낮·밤·집), 부드러운 확대,
// 도착 고양이 잉크 세로 가운데, 하단 주소, 디졸브 뒤 앱·설치 안내, 느린 로딩 제자리 달리기, 움직임 줄이기.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-splash.mjs <주소> <캡처 폴더> [--chrome <chrome.exe>]
// 시각은 Date 를 원하는 시:분으로 옮겨(시간은 흐름) 흉내, 느린 로딩은 /js/main.js 응답을 늦춰 흉내.
// 캡처는 CDP Page.captureScreenshot — page.screenshot 은 main.js 를 늦춘 동안 앱 준비 뒤까지 기다려 스플래시를 못 찍음.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const pngOut = createRequire(import.meta.url)("../../tools/test/png.cjs");

const args = process.argv.slice(2);
const [URL_BASE, SHOTS] = args;
const at = args.indexOf("--chrome");
const CHROME = at >= 0 ? args[at + 1] : "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const MIN_MS = 2000;
const DAY = [10, 0];
const NIGHT = [1, 0];
const HOME = [19, 0];
const NAME = { meadow: "낮 초원(1안)", sunset: "밤 노을(2안)", home: "집 안(4안)" };
const FADE_MS = 240;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ viewport = PORTRAIT, dpr = 3, mobile = true, touch = true, time = DAY, reduce = false, standalone = true, slow = 0 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: touch, reducedMotion: reduce ? "reduce" : "no-preference" });
  await context.addInitScript(
    ([[h, m], alone]) => {
      const Real = Date;
      const target = new Real();
      target.setHours(h, m, 30, 0);
      const shift = target.getTime() - Real.now();
      window.Date = class extends Real {
        constructor(...args) {
          if (args.length) super(...args);
          else super(Real.now() + shift);
        }
        static now() {
          return Real.now() + shift;
        }
      };
      try {
        localStorage.setItem("webgba.installHint", "1");
      } catch {}
      if (alone) Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      new MutationObserver(() => {
        if (!window.__readyAt && document.documentElement?.dataset.ready === "1") window.__readyAt = performance.now();
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-ready"] });
    },
    [time, standalone],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (slow) await page.route("**/js/main.js", async (route) => (await sleep(slow), route.continue()));
  await page.goto(URL_BASE, { waitUntil: "commit" });
  page.errors = errors;
  return { context, page };
}

const startOf = (page) => page.waitForFunction(() => window.webgbaSplash?.startAt || !document.getElementById("splash"), null, { timeout: 20000, polling: 10 });
const readyOf = (page) => page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
const info = (page) => page.evaluate(() => {
  const s = window.webgbaSplash;
  return { shown: Boolean(document.getElementById("splash")), api: s ? { variant: s.variant, reduce: s.reduce, startAt: s.startAt, readyAt: s.readyAt, closedAt: s.closedAt } : null, readyFlag: window.__readyAt || 0, boot: Boolean(document.getElementById("boot")) };
});

function probe() {
  const splash = document.getElementById("splash");
  const [back, front, text] = splash.querySelectorAll("canvas");
  const dpr = devicePixelRatio;
  const style = getComputedStyle(document.documentElement);
  const variant = window.webgbaSplash.variant;
  const hex = (name) => style.getPropertyValue(name).trim().toLowerCase();
  const shadow = hex(`--sp-${variant}-shadow`);
  const color = (d, i) => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const read = (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const offset = (c) => ({ x: Math.round(parseFloat(c.style.left) * dpr), y: Math.round(parseFloat(c.style.top) * dpr) });
  const fd = read(front);
  const fo = offset(front);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, soft = 0;
  const rows = new Map();
  const colors = new Set();
  for (let y = 0; y < front.height; y++)
    for (let x = 0; x < front.width; x++) {
      const i = (y * front.width + x) * 4;
      const a = fd[i + 3];
      if (!a) continue;
      if (a !== 255) soft++;
      const c = color(fd, i);
      if (c === shadow) {
        rows.set(y, (rows.get(y) || 0) + 1);
        continue;
      }
      colors.add(c);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const lowest = Math.max(-1, ...rows.keys());
  const shadowWidth = rows.get(lowest) || 0;
  const td = read(text);
  const to = offset(text);
  const textColors = new Set();
  let textSoft = 0;
  for (let i = 0; i < td.length; i += 4) {
    if (!td[i + 3]) continue;
    if (td[i + 3] !== 255) textSoft++;
    textColors.add(color(td, i));
  }
  const bd = read(back);
  let clear = 0;
  for (let i = 3; i < bd.length; i += 4) if (!bd[i]) clear++;
  return {
    dpr,
    vw: Math.round(innerWidth * dpr),
    vh: Math.round(innerHeight * dpr),
    cat: { x0: x0 + fo.x, y0: y0 + fo.y, x1: x1 + fo.x, y1: y1 + fo.y },
    shadowK: shadowWidth / 20,
    soft,
    colors: [...colors],
    text: { x: to.x, y: to.y, w: text.width, h: text.height, colors: [...textColors], soft: textSoft },
    backClear: clear / (bd.length / 4),
    rendering: [back, front, text].map((c) => getComputedStyle(c).imageRendering),
  };
}

function inkUnion(ms) {
  const front = document.querySelectorAll("#splash canvas")[1];
  const dpr = devicePixelRatio;
  const fx = Math.round(parseFloat(front.style.left) * dpr);
  const fy = Math.round(parseFloat(front.style.top) * dpr);
  const shadow = getComputedStyle(document.documentElement).getPropertyValue(`--sp-${window.webgbaSplash.variant}-shadow`).trim().toLowerCase();
  const sr = parseInt(shadow.slice(1, 3), 16);
  const sg = parseInt(shadow.slice(3, 5), 16);
  const sb = parseInt(shadow.slice(5, 7), 16);
  const seen = new Set();
  let y0 = 1e9, y1 = -1;
  const end = performance.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (!front.isConnected || performance.now() > end) return resolve({ y0: y0 + fy, y1: y1 + fy, frames: seen.size, fx });
      const d = front.getContext("2d").getImageData(0, 0, front.width, front.height).data;
      let a0 = 1e9, a1 = -1, b0 = 1e9, b1 = -1;
      for (let y = 0; y < front.height; y++)
        for (let x = 0; x < front.width; x++) {
          const i = (y * front.width + x) * 4;
          if (!d[i + 3] || (d[i] === sr && d[i + 1] === sg && d[i + 2] === sb)) continue;
          if (y < a0) a0 = y;
          if (y > a1) a1 = y;
          if (x < b0) b0 = x;
          if (x > b1) b1 = x;
        }
      seen.add(`${a0},${a1},${b0},${b1}`);
      y0 = Math.min(y0, a0);
      y1 = Math.max(y1, a1);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function scaleTrace(ms) {
  const front = document.querySelectorAll("#splash canvas")[1];
  const shadow = getComputedStyle(document.documentElement).getPropertyValue(`--sp-${window.webgbaSplash.variant}-shadow`).trim().toLowerCase();
  const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(shadow.slice(i, i + 2), 16));
  const list = [];
  const end = performance.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (!front.isConnected || performance.now() > end) return resolve(list);
      const d = front.getContext("2d").getImageData(0, 0, front.width, front.height).data;
      let lowest = -1;
      let width = 0;
      for (let y = front.height - 1; y >= 0 && lowest < 0; y--) {
        let n = 0;
        for (let x = 0; x < front.width; x++) {
          const i = (y * front.width + x) * 4;
          if (d[i + 3] && d[i] === sr && d[i + 1] === sg && d[i + 2] === sb) n++;
        }
        if (n) {
          lowest = y;
          width = n;
        }
      }
      if (width && list.at(-1) !== width / 20) list.push(width / 20);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const sheetColors = (() => {
  const image = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "splash", "cat.png")));
  const set = new Set();
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3]) set.add(`#${[image.data[i], image.data[i + 1], image.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
  return set;
})();

async function samples(page, ms) {
  const list = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const one = await page.evaluate(probe).catch(() => null);
    if (!one) break;
    list.push(one);
  }
  return list;
}

const shots = {};
async function capture(page) {
  page.cdp ??= await page.context().newCDPSession(page);
  return Buffer.from((await page.cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64");
}
const shot = async (page, name) => (shots[name] = decodePng(await capture(page)));

for (const [time, want] of [[[3, 59], "sunset"], [[4, 0], "meadow"], [[16, 59], "meadow"], [[17, 0], "home"], [[22, 59], "home"], [[23, 0], "sunset"]]) {
  const { context, page } = await open({ time });
  await startOf(page);
  const got = await info(page);
  ok(`시각 ${time[0]}:${String(time[1]).padStart(2, "0")} → ${NAME[want]}`, got.api?.variant === want, got.api?.variant);
  await context.close();
}

for (const time of [DAY, HOME]) {
  const { context, page } = await open({ time, slow: 3000 });
  await startOf(page);
  const variant = (await info(page)).api.variant;
  const ks = await page.evaluate(scaleTrace, 2000);
  const list = await samples(page, 200);
  const distinct = new Set(ks.map((k) => k.toFixed(3)));
  const fractional = ks.filter((k) => Math.abs(k - Math.round(k)) > 0.02).length;
  let monotonic = true;
  let jump = 0;
  for (let i = 1; i < ks.length; i++) {
    if (ks[i] + 0.05 < ks[i - 1]) monotonic = false;
    jump = Math.max(jump, ks[i] - ks[i - 1]);
  }
  ok(`${NAME[variant]} 세로 부드러운 확대: 크기가 정수 단계가 아니라 이어서 커짐`, distinct.size >= 15 && fractional > ks.length / 2 && monotonic, `표본 ${ks.length} · 서로 다른 크기 ${distinct.size} · 정수 아님 ${fractional} · 한 번에 최대 +${jump.toFixed(2)} · ${ks[0]?.toFixed(2)} → ${ks.at(-1)?.toFixed(2)}`);
  const extra = new Set(list.flatMap((s) => s.colors).filter((c) => !sheetColors.has(c)));
  const soft = list.reduce((sum, s) => sum + s.soft + s.text.soft, 0);
  ok(`${NAME[variant]} 도트 번짐 없음: 고양이 색 = 시트 15색만, 반투명 화소 0, 캔버스 pixelated`, !extra.size && !soft && list[0].rendering.every((r) => r === "pixelated"), `시트에 없는 색 ${extra.size} · 반투명 ${soft} · ${list[0].rendering.join(",")}`);
  await readyOf(page);
  ok(`${NAME[variant]} 오류 없음`, !page.errors.length, page.errors.join(" | "));
  await context.close();
}

for (const [viewport, label, time, key] of [[PORTRAIT, "세로 낮", DAY, "pd"], [PORTRAIT, "세로 밤", NIGHT, "pn"], [PORTRAIT, "세로 집", HOME, "ph"], [LANDSCAPE, "가로 낮", DAY, "ld"], [LANDSCAPE, "가로 밤", NIGHT, "ln"], [LANDSCAPE, "가로 집", HOME, "lh"]]) {
  const { context, page } = await open({ viewport, time, slow: 5000 });
  await startOf(page);
  await sleep(2100);
  const list = await samples(page, 300);
  const union = await page.evaluate(inkUnion, 1000);
  const s = list[0];
  const above = union.y0;
  const below = s.vh - 1 - union.y1;
  const scales = new Set(list.map((v) => v.shadowK));
  ok(`${label} 도착 = 정수 배율(부드러운 확대 끝)`, scales.size === 1 && Number.isInteger(s.shadowK), `배율 ${[...scales].join(",")}`);
  ok(`${label} 도착 고양이 잉크 세로 가운데(8프레임 합친 잉크)`, union.frames >= 8 && Math.abs(above - below) === 0, `위 ${above} · 아래 ${below} 기기 px (화면 ${s.vh}, 서로 다른 동작 ${union.frames})`);
  const t = s.text;
  const bottomGap = s.vh - (t.y + t.h);
  const lineH = 15 * Math.round(s.dpr);
  ok(`${label} 주소 한 줄·하단 여백 16px·가로 가운데·흰 글자 + 검은 테두리만`, t.h === lineH && bottomGap === 16 * Math.round(s.dpr) && t.x >= 0 && t.x + t.w <= s.vw && Math.abs(t.x + t.w / 2 - s.vw / 2) <= 1 && t.colors.length === 2 && t.colors.includes("#ffffff") && t.colors.includes("#000000"), `높이 ${t.h}/${lineH} · 하단 ${bottomGap} · 좌 ${t.x} 우 ${s.vw - t.x - t.w} · 색 ${t.colors.join(",")}`);
  if (key === "pd" || key === "ln" || key === "ph") {
    const late = await samples(page, 700);
    const frames = new Set(late.map((v) => `${v.cat.x0},${v.cat.y0},${v.cat.x1},${v.cat.y1}`));
    const sizes = new Set(late.map((v) => v.shadowK));
    const still = await info(page);
    ok(`${label} 느린 로딩(3초 넘음): 닫히지 않고 도착한 고양이 제자리 달리기`, !still.api.closedAt && frames.size >= 3 && sizes.size === 1, `3.4초 이후 표본 ${late.length} · 서로 다른 동작 ${frames.size} · 크기 ${[...sizes].join(",")}`);
  }
  await shot(page, key);
  await readyOf(page);
  const end = await info(page);
  const closeAt = Math.max(end.api.startAt + MIN_MS, end.api.readyAt);
  ok(`${label} 앱 준비가 늦으면 준비 뒤 디졸브로 닫힘`, end.api.readyAt > end.api.startAt + 3000 && Math.abs(end.api.closedAt - closeAt - FADE_MS) < 80, `준비 ${Math.round(end.api.readyAt - end.api.startAt)}ms · 닫힘 = 준비 + ${Math.round(end.api.closedAt - end.api.readyAt)}ms`);
  await context.close();
}

{
  const { context, page } = await open({ viewport: { width: 320, height: 568 }, dpr: 2 });
  await startOf(page);
  const s = await page.evaluate(probe);
  ok("작은 휴대폰(320×568) 주소 한 줄이 화면 안", s.text.x >= 0 && s.text.x + s.text.w <= s.vw && s.text.h === 15 * 2, `주소 ${s.text.w / 2}css px / 화면 320`);
  await context.close();
}

{
  const { context, page } = await open({ time: DAY });
  await startOf(page);
  await page.waitForFunction(() => window.webgbaSplash.readyAt, null, { polling: 10 });
  const steps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const s = window.webgbaSplash;
        const seen = [];
        const tick = () => {
          const canvas = document.querySelector("#splash canvas");
          const closeAt = Math.max(s.startAt + 2000, s.readyAt);
          const now = performance.now();
          if (!canvas) return resolve(seen);
          if (now >= closeAt) {
            const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let clear = 0;
            for (let i = 3; i < d.length; i += 4) if (!d[i]) clear++;
            seen.push({ step: Math.floor((now - closeAt) / 60) + 1, clear: clear / (d.length / 4) });
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  const levels = [...new Set(steps.map((v) => Math.round(v.clear * 400) / 4))].sort((a, b) => a - b);
  const right = levels.every((v) => [0, 25, 50, 75, 100].includes(v));
  ok("닫힐 때 도트 디졸브(4단계 · 단계마다 1/4씩 빠짐)", right && levels.filter((v) => v > 0).length >= 3, `빠진 비율 ${levels.join("% · ")}%`);
  await readyOf(page);
  const end = await info(page);
  const closeAt = Math.max(end.api.startAt + MIN_MS, end.api.readyAt);
  ok("빠른 로딩: 2.0초 + 디졸브 뒤 닫힘·그 뒤 data-ready", end.api.readyAt < end.api.startAt + MIN_MS && Math.abs(end.api.closedAt - closeAt - FADE_MS) < 80 && end.readyFlag >= end.api.closedAt, `앱 준비 ${Math.round(end.api.readyAt - end.api.startAt)}ms · 닫힘 ${Math.round(end.api.closedAt - end.api.startAt)}ms · data-ready ${Math.round(end.readyFlag - end.api.startAt)}ms(스플래시 시작 기준)`);
  const app = await page.evaluate(() => ({ splash: Boolean(document.getElementById("splash")), boot: Boolean(document.getElementById("boot")), booting: document.body.hasAttribute("data-booting"), start: getComputedStyle(document.getElementById("start")).visibility, gate: document.body.dataset.gate || "" }));
  ok("디졸브 뒤 앱 첫 화면 정상(스플래시·부팅 화면 없음, 첫 화면 보임)", !app.splash && !app.boot && !app.booting && app.start === "visible" && !app.gate, JSON.stringify(app));
  await shot(page, "app");
  await context.close();
}

{
  const { context, page } = await open({ time: HOME, standalone: false });
  await startOf(page);
  const first = await info(page);
  await readyOf(page);
  const gate = await page.evaluate(() => ({ splash: Boolean(document.getElementById("splash")), gate: document.body.dataset.gate, hidden: document.getElementById("gate").hidden, visibility: getComputedStyle(document.getElementById("gate")).visibility, cards: document.querySelectorAll("#gate *").length }));
  ok("설치 안내(?dev=1 없음): 스플래시 뒤 설치 안내 정상", first.shown && !gate.splash && gate.gate === "on" && !gate.hidden && gate.visibility === "visible" && gate.cards > 3, JSON.stringify(gate));
  await shot(page, "gate");
  await context.close();
}

{
  const { context, page } = await open({ time: DAY, reduce: true });
  await startOf(page);
  await sleep(500);
  const a = await capture(page);
  await sleep(1000);
  const b = await capture(page);
  await readyOf(page);
  const end = await info(page);
  const closeAt = Math.max(end.api.startAt + MIN_MS, end.api.readyAt);
  ok("움직임 줄이기: 정지 그림(0.5초·1.5초 화면 같음)", end.api.reduce && a.equals(b), `같음 ${a.equals(b)}`);
  ok("움직임 줄이기: 디졸브 없이 바로 닫힘", Math.abs(end.api.closedAt - closeAt) < 40, `닫힘 = 닫을 때 + ${Math.round(end.api.closedAt - closeAt)}ms`);
  await context.close();
}

for (const [label, opt] of [
  ["PC(마우스) 1280×800", { viewport: { width: 1280, height: 800 }, dpr: 1, mobile: false, touch: false }],
  ["터치 노트북(마우스 + 터치) 1280×800", { viewport: { width: 1280, height: 800 }, dpr: 1, mobile: false, touch: true }],
  ["태블릿 820×1180", { viewport: { width: 820, height: 1180 }, dpr: 2, mobile: true, touch: true }],
  ["태블릿 가로 1180×820", { viewport: { width: 1180, height: 820 }, dpr: 2, mobile: true, touch: true }],
]) {
  const { context, page } = await open(opt);
  await readyOf(page);
  const got = await info(page);
  ok(`${label}: 스플래시 없음`, !got.shown && !got.api, JSON.stringify({ shown: got.shown, api: Boolean(got.api), ready: Math.round(got.readyFlag) }));
  await context.close();
}

function sheet(parts, file) {
  const gap = 24;
  const width = parts.reduce((sum, p) => sum + p.width + gap, -gap);
  const height = Math.max(...parts.map((p) => p.height));
  const out = Buffer.alloc(width * height * 4, 0);
  let x0 = 0;
  for (const p of parts) {
    for (let y = 0; y < p.height; y++) p.data.copy(out, (y * width + x0) * 4, y * p.width * 4, (y + 1) * p.width * 4);
    x0 += p.width + gap;
  }
  fs.writeFileSync(path.join(SHOTS, file), pngOut.encode(out, width, height));
}
if (shots.pd && shots.pn && shots.ld && shots.ln) {
  sheet([shots.pd, shots.pn], "스플래시_세로_낮밤.png");
  sheet([shots.ld, shots.ln], "스플래시_가로_낮밤.png");
}
if (shots.ph && shots.lh) sheet([shots.ph, shots.lh], "스플래시_집안_세로가로.png");
if (shots.app && shots.gate) sheet([shots.app, shots.gate], "스플래시_뒤_앱_설치안내.png");

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
