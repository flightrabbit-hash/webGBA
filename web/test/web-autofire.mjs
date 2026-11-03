// 연사(autoFire) 시험 — 웹(로컬 서버 tools/test/mp-local.mjs 가 web/dist 를 내줌, 롬 없는 예제만).
//   node web/test/web-autofire.mjs [--out <결과 json>]
// ① 게임: 프레임마다 게임에 넘긴 키(host.runFrame 인자)를 기록해 단계 1~9 의 누름·뗌 무늬가 공식(프레임 f 에 floor(f × 초당 횟수 / 30) 짝수 = 누름)과
// 프레임 단위로 같은지, 끔이면 입력 그대로, 방향·START·SELECT 제외, A·B·L·R 적용, 키보드·화면 터치(Pad:)·게임패드 같은 설정, 빨리 감기 4배에서도 프레임 기준.
// ② 게임(자체 JS): 틀 안 rAF 프레임마다 버튼 키 이벤트 무늬. 설정 화면 켜기·단계 바 → 저장 → 다시 열기 복원.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startLocal } from "../../tools/test/mp-local.mjs";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const RATES = [1, 2, 3, 4, 6, 8, 12, 20, 30];
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const examples = fileURLToPath(new URL("../../docs/wgba/examples/", import.meta.url));
const pack = async (name) => {
  const dir = path.join(examples, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const js = fs.existsSync(path.join(dir, "game.js")) ? fs.readFileSync(path.join(dir, "game.js")) : null;
  return Buffer.from((await packWgba({ wasm: fs.readFileSync(path.join(dir, "game.wasm")), manifest, ...(js ? { js } : {}) })).bytes);
};
const files = { webapi: await pack("hello-webapi"), script: await pack("hello-script") };
const expected = (n, rate) => Array.from({ length: n }, (_, f) => (Math.floor((f * rate) / 30) % 2 === 0 ? 1 : 0)).join("");
const edges = (bits) => {
  const at = [];
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1" && (i === 0 || bits[i - 1] === "0")) at.push(i);
  return at.slice(1).map((v, i) => v - at[i]);
};

const local = await startLocal();
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window !== window.top) return;
  localStorage.setItem("webgba.installHint", "1");
  if (!localStorage.getItem("webgba.prefs")) localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko" }));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const [name, bytes] of Object.entries(files)) await context.route(`**/test-${name}.wgba`, (route) => route.fulfill({ body: bytes, contentType: "application/octet-stream" }));

async function boot() {
  await page.goto(local.base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
}

async function openGame(name) {
  await page.evaluate(async (name) => {
    const buf = await (await fetch(`/test-${name}.wgba`)).arrayBuffer();
    await window.webgba.openFiles([new File([buf], `test-${name}.wgba`)]);
  }, name);
  await page.waitForFunction(() => window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 20000 });
}

// hold one input for `frames` game frames and return the 0/1 string of `bit` in the keys the game received, from the first frame it appeared
async function hold({ code = "", pad = -1, bit, frames = 66 }) {
  return page.evaluate(
    async ({ code, pad, bit, frames }) => {
      const p = window.webgba.player;
      const host = p.host;
      const log = [];
      const run = host.runFrame.bind(host);
      host.runFrame = (keys) => {
        log.push(keys);
        return run(keys);
      };
      const real = navigator.getGamepads?.bind(navigator);
      if (pad >= 0) navigator.getGamepads = () => [{ connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === pad, value: i === pad ? 1 : 0 })) }];
      else p.keyDown(code);
      const start = log.length;
      await new Promise((resolve) => {
        const wait = () => (log.length - start >= frames + 4 ? resolve() : setTimeout(wait, 16));
        wait();
      });
      if (pad >= 0) navigator.getGamepads = real;
      else p.keyUp(code);
      await new Promise((r) => setTimeout(r, 120));
      host.runFrame = run;
      const bits = log.map((k) => ((k >>> bit) & 1 ? "1" : "0")).join("");
      const first = bits.indexOf("1");
      return first < 0 ? "" : bits.slice(first, first + frames);
    },
    { code, pad, bit, frames },
  );
}

const codeOf = (bit) => page.evaluate((bit) => [...window.webgba.player.keymap].find(([c, m]) => m === 1 << bit && !c.startsWith("Pad:"))?.[0] ?? "", bit);
const setFire = (on, level = 5) => page.evaluate(({ on, level }) => window.webgba.player.setAutoFire({ on, level }), { on, level });

try {
  await boot();
  await openGame("webapi");
  await setFire(false);
  const offA = await hold({ code: "KeyZ", bit: 0, frames: 40 });
  ok("연사 끔(기본): A 를 누르고 있는 동안 매 프레임 그대로 눌림", offA === "1".repeat(40), offA);
  const exported = await page.evaluate(async () => (await import("/js/app/player.js")).AUTO_FIRE_RATES.join(","));
  ok(`연사 단계 값 AUTO_FIRE_RATES = ${RATES.join("·")}`, exported === RATES.join(","), exported);
  for (let level = 1; level <= 9; level++) {
    await setFire(true, level);
    const bits = await hold({ code: "KeyZ", bit: 0, frames: 66 });
    const want = expected(66, RATES[level - 1]);
    const gaps = edges(bits);
    const presses = [...bits.slice(0, 60)].filter((b, i, all) => b === "1" && (i === 0 || all[i - 1] === "0")).length;
    ok(`연사 ${level}단계(초당 ${RATES[level - 1]}회): 게임 프레임 무늬 = 공식 · 60프레임 누름 ${presses}회 · 누름 간격 ${[...new Set(gaps)].join("/")}프레임(평균 ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(2)})`, bits === want && presses === RATES[level - 1], `${bits}`);
    if (level === 1) ok("연사 1단계: 60프레임 = 누름 30·뗌 30(첫 프레임 누름)", bits.slice(0, 60) === "1".repeat(30) + "0".repeat(30), bits.slice(0, 60));
  }
  await setFire(true, 9);
  const keysFor = {};
  for (const [name, bit] of [["B", 1], ["R", 8], ["L", 9], ["RIGHT", 4], ["START", 3], ["SELECT", 2]]) keysFor[name] = { bit, code: await codeOf(bit) };
  for (const name of ["B", "R", "L"]) {
    const { bit, code } = keysFor[name];
    const bits = await hold({ code, bit, frames: 20 });
    ok(`연사 적용 ${name}(${code}) 9단계 = 2프레임마다`, bits === expected(20, 30), bits);
  }
  for (const name of ["RIGHT", "START", "SELECT"]) {
    const { bit, code } = keysFor[name];
    const bits = await hold({ code, bit, frames: 20 });
    ok(`연사 제외 ${name}(${code}): 그대로 눌림`, bits === "1".repeat(20), bits);
  }
  await setFire(true, 6);
  const touch = await hold({ code: "Pad:A", bit: 0, frames: 40 });
  ok(`화면 터치 A(Pad:A)도 같은 설정(6단계 = 초당 ${RATES[5]}회)`, touch === expected(40, RATES[5]), touch);
  const gp = await hold({ pad: 0, bit: 0, frames: 40 });
  ok("게임패드 A(버튼 0)도 같은 설정(6단계)", gp === expected(40, RATES[5]), gp);
  await page.evaluate(() => {
    const p = window.webgba.player;
    p.gameSpeed = 4;
    p.fast = true;
  });
  await setFire(true, 5);
  const fast = await hold({ code: "KeyZ", bit: 0, frames: 120 });
  const fastSpeed = await page.evaluate(() => window.webgba.player.runSpeed);
  ok(`빨리 감기 ${fastSpeed}배에서도 게임 프레임 기준(5단계 무늬 = 공식)`, fastSpeed === 4 && fast === expected(120, RATES[4]), fast.slice(0, 40));
  await page.evaluate(() => {
    const p = window.webgba.player;
    p.gameSpeed = 1;
    p.fast = false;
  });

  // ② 자체 JS 게임: 틀 안에서 rAF 프레임마다 키 이벤트
  await openGame("script");
  await setFire(true, 1);
  const scriptFire = await page.evaluate(() => window.webgba.player.host.fire);
  ok("② 자체 JS 게임: 1단계 → 틀에 초당 1회 전달(ScriptHost.setAutoFire)", scriptFire?.rate === 1 && scriptFire.buttons.length > 0, JSON.stringify(scriptFire));
  await setFire(true, 9);
  await sleep(800);
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
  if (!frame) throw new Error(`틀을 찾지 못함: ${page.frames().map((f) => f.url()).join(", ")}`);
  await frame.evaluate(() => {
    window.__fire = [];
    window.__stamps = [];
    const loop = (ts) => {
      window.__stamps.push(ts);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    for (const type of ["keydown", "keyup"]) addEventListener(type, (e) => e.code === "Space" && window.__fire.push([document.timeline.currentTime, type === "keydown" ? 1 : 0]), true);
  });
  await page.evaluate(() => window.webgba.player.keyDown("KeyZ"));
  await sleep(1200);
  await page.evaluate(() => window.webgba.player.keyUp("KeyZ"));
  await sleep(200);
  const ev = await frame.evaluate(() => window.__fire.map(([t, d]) => [window.__stamps.findIndex((s) => Math.abs(s - t) < 0.5), d]));
  const downs = ev.filter((e) => e[1] === 1 && e[0] >= 0).map((e) => e[0]);
  const gaps = downs.slice(1).map((v, i) => v - downs[i]);
  ok(`② 자체 JS 게임: 틀 rAF 프레임마다 누름·뗌(9단계 = 2프레임 간격) · 누름 ${downs.length}회`, downs.length >= 20 && gaps.length && gaps.every((g) => g === 2), `간격 ${[...new Set(gaps)].join("/")}`);

  // 설정 화면: 켜기·단계 바 → 저장 → 다시 열기 복원
  await setFire(false);
  await page.evaluate(() => {
    const prefs = window.webgba.state.prefs;
    delete prefs.autoFire;
    delete prefs.autoFireLevel;
  });
  await page.evaluate(() => window.webgba.openSheet("settings"));
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const sw = [...document.querySelectorAll("#sheetBody .switch")].find((n) => n.getAttribute("aria-label") === "연사");
    const range = document.querySelector('#sheetBody input[data-key="autoFireLevel"]');
    return { sw: Boolean(sw), on: sw?.getAttribute("aria-checked"), range: Boolean(range), disabled: range?.disabled, value: range?.value, min: range?.min, max: range?.max, note: range?.closest(".field")?.querySelector(".field__note")?.textContent ?? "" };
  });
  ok("설정: 연사 켜기·끄기 + 1~9단계 바(기본 끔·5단계, 끄면 바 비활성)", before.sw && before.on === "false" && before.range && before.disabled && before.value === "5" && before.min === "1" && before.max === "9" && /5단계 · 초당 6회/.test(before.note), JSON.stringify(before));
  await page.evaluate(() => [...document.querySelectorAll("#sheetBody .switch")].find((n) => n.getAttribute("aria-label") === "연사").click());
  const levelOne = await page.evaluate(() => {
    const range = document.querySelector('#sheetBody input[data-key="autoFireLevel"]');
    range.value = "1";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    return range.closest(".field").querySelector(".field__note").textContent;
  });
  const tables = Object.fromEntries(["ko", "en", "ja"].map((id) => [id, JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../src-bundle/src/i18n/${id}.json`, import.meta.url)), "utf8"))]));
  const oneText = Object.fromEntries(Object.entries(tables).map(([id, table]) => [id, table["cfg.autoFireLevel.value"].replace("{n}", "1").replace("{rate}", "1")]));
  ok("설정: 1단계 글 '1단계 · 초당 1회'(세 언어 Level 1 · 1/s · 1段階 · 1秒に1回)", /1단계 · 초당 1회/.test(levelOne) && oneText.ko === "1단계 · 초당 1회" && oneText.en === "Level 1 · 1/s" && oneText.ja === "1段階 · 1秒に1回", JSON.stringify({ levelOne, oneText }));
  await page.evaluate(() => {
    const range = document.querySelector('#sheetBody input[data-key="autoFireLevel"]');
    range.value = "9";
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const saved = await page.evaluate(() => ({ prefs: JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}"), fire: window.webgba.player.autoFire, note: document.querySelector('#sheetBody input[data-key="autoFireLevel"]').closest(".field").querySelector(".field__note").textContent, disabled: document.querySelector('#sheetBody input[data-key="autoFireLevel"]').disabled }));
  ok("설정: 켜고 9단계 → 바로 저장·적용(초당 30회 표시)", saved.prefs.autoFire === true && saved.prefs.autoFireLevel === 9 && saved.fire.on && saved.fire.level === 9 && !saved.disabled && /9단계 · 초당 30회/.test(saved.note), JSON.stringify(saved));
  await boot();
  const restored = await page.evaluate(() => ({ prefs: window.webgba.state.prefs.autoFire, level: window.webgba.state.prefs.autoFireLevel, fire: window.webgba.player.autoFire }));
  ok("다시 열기: 연사 켬·9단계 복원", restored.prefs === true && restored.level === 9 && restored.fire.on && restored.fire.level === 9, JSON.stringify(restored));
  ok("페이지 오류 없음", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close().catch(() => {});
  await local.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n연사: ${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
