// 웹 webGBA 애니메이션 시험(로컬 전용): 게임이 도는 동안 애니메이션이 게임 프레임에 영향 없는지, 끝난 뒤 위치가 정수인지,
// 움직임 줄이기 설정이면 꺼지는지, 창 열림 연속 4장(한 장으로 이어 붙임).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-anim.mjs <주소> <캡처 폴더> <롬.gba>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodePng } from "./png.mjs";

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");
const pngOut = createRequire(import.meta.url)("../../tools/test/png.cjs");

const [URL_BASE, SHOTS, ROM] = process.argv.slice(2);
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const standalone = () => Object.defineProperty(navigator, "standalone", { value: true, configurable: true });

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(standalone);
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#startOpen")]);
  await chooser.setFiles(ROM);
  await page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const sample = (animate) =>
    page.evaluate(
      (animate) =>
        new Promise((resolve) => {
          const host = window.webgba.player.host;
          const run = host.runFrame.bind(host);
          let frames = 0;
          host.runFrame = (k) => (frames++, run(k));
          const gaps = [];
          let last = performance.now();
          const end = last + 2000;
          let toastTimer = 0;
          if (animate) {
            let n = 0;
            const fire = () => {
              window.webgba.toast(`애니메이션 ${++n}`);
              toastTimer = setTimeout(fire, 180);
            };
            fire();
          }
          const loop = (now) => {
            gaps.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(loop);
            else {
              clearTimeout(toastTimer);
              host.runFrame = run;
              gaps.sort((a, b) => a - b);
              resolve({ frames, p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps[gaps.length - 1], avg: gaps.reduce((a, b) => a + b, 0) / gaps.length });
            }
          };
          requestAnimationFrame(loop);
        }),
      animate,
    );
  const base = await sample(false);
  const moving = await sample(true);
  const ratio = moving.frames / base.frames;
  ok(
    "게임이 도는 동안 토스트 애니메이션: 게임 프레임 수·간격 영향 없음",
    ratio > 0.97 && ratio < 1.03 && moving.p95 <= base.p95 + 2,
    `프레임 ${base.frames} → ${moving.frames} · 화면 간격 p95 ${base.p95.toFixed(1)} → ${moving.p95.toFixed(1)}ms · 최대 ${base.max.toFixed(1)} → ${moving.max.toFixed(1)}ms`,
  );
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(standalone);
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(500);
  const frames = [];
  await page.click("#btnSettings");
  for (const at of [16, 70, 130, 260]) {
    await page.waitForTimeout(at - (frames.length ? [16, 70, 130, 260][frames.length - 1] : 0));
    frames.push(decodePng(await page.screenshot({ clip: { x: 0, y: 300, width: 390, height: 544 } })));
  }
  const width = frames.reduce((sum, f) => sum + f.width + 8, -8);
  const height = frames[0].height;
  const strip = Buffer.alloc(width * height * 4, 0);
  let x0 = 0;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) f.data.copy(strip, (y * width + x0) * 4, y * f.width * 4, (y + 1) * f.width * 4);
    x0 += f.width + 8;
  }
  fs.writeFileSync(path.join(SHOTS, "애니메이션_설정창_열림_4장.png"), pngOut.encode(strip, width, height));
  const settled = await page.evaluate(() => {
    const panel = document.querySelector(".sheet__panel");
    const r = panel.getBoundingClientRect();
    return { transform: getComputedStyle(panel).transform, running: document.getAnimations().filter((a) => a.playState === "running").length, top: r.top, left: r.left, dpr: devicePixelRatio };
  });
  const integral = Number.isInteger(settled.top * settled.dpr) && Number.isInteger(settled.left * settled.dpr);
  ok("창 애니메이션이 끝나면 transform 없음·위치가 화면 픽셀 정수", settled.transform === "none" && integral, JSON.stringify(settled));
  await page.click("#sheetClose");
  await page.waitForTimeout(60);
  const closing = await page.evaluate(() => document.getElementById("sheet").classList.contains("is-closing") && !document.getElementById("sheet").hidden);
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => document.getElementById("sheet").hidden);
  ok("창 닫힘도 짧게 사라진 뒤 숨김(150ms)", closing && closed);
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", isMobile: true, hasTouch: true });
  await context.addInitScript(standalone);
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.click("#btnSettings");
  await page.waitForTimeout(30);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  await page.click("#sheetClose");
  const hiddenNow = await page.evaluate(() => document.getElementById("sheet").hidden);
  ok("움직임 줄이기 설정이면 애니메이션 없음(바로 열리고 닫힘)", running === 0 && hiddenNow, `돌던 애니메이션 ${running}`);
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
