// 웹 게임 중 뒤로가기 막기 시험(로컬 전용, 사용자 2026-11-14 안드로이드 뒤로가기 제보).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-back-guard.mjs --dist <웹 빌드> --shots <캡처 폴더> [--out <결과 json>] [--capture <캡처 png>]
// 시험 .wgba 는 저장소 예제(hello-webapi)를 메모리에서 묶는다(롬 없음). PC 밖 요청은 모두 막는다.
// Chrome·WebKit(아이폰 사파리 엔진) 같은 시험. 첫 진입(기록 1개)은 다른 페이지에서 window.open 으로 연 새 탭.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium, webkit } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8841;
const WEB = `http://127.0.0.1:${WEB_PORT}/`;
fs.mkdirSync(opt.shots, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const EXAMPLE = path.join(repo, "docs", "wgba", "examples", "hello-webapi");
const manifest = JSON.parse(fs.readFileSync(path.join(EXAMPLE, "manifest.json"), "utf8"));
const GAME = Buffer.from((await packWgba({ wasm: fs.readFileSync(path.join(EXAMPLE, "game.wasm")), manifest: { ...manifest, cart: { color: manifest.cart.color } }, images: {} })).bytes);

const server = spawn(process.execPath, [path.join(repo, "web", "tools", "serve.mjs"), opt.dist, String(WEB_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => server.stdout.once("data", resolve));
const outside = [];

async function openPage(browser, { first = false, from = "" } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, isMobile: browser !== wk, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.endsWith("/__bg/game.wgba")) return route.fulfill({ status: 200, body: GAME, contentType: "application/octet-stream" });
    if (url.startsWith(WEB)) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko" }));
    window.__pops = 0;
    window.addEventListener("popstate", () => window.__pops++);
  });
  let page = await context.newPage();
  if (first) {
    await page.goto(WEB + "LICENSE.txt");
    const opener = page;
    [page] = await Promise.all([context.waitForEvent("page"), opener.evaluate((url) => window.open(url, "_blank"), WEB)]);
  }
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  if (!first) {
    if (from) await page.goto(WEB + from);
    await page.goto(WEB);
  }
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(() => (window.__mark = Math.random().toString(36).slice(2)));
  return { context, page };
}

async function openGame(page) {
  await page.evaluate(async () => {
    const data = new Uint8Array(await (await fetch("/__bg/game.wgba")).arrayBuffer());
    await window.webgba.openFiles([new File([data], "game.wgba")]);
  });
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

const snap = (page) =>
  page.evaluate(() => ({
    mark: window.__mark ?? "",
    url: location.href,
    game: window.webgba?.state.game?.id ?? "",
    running: Boolean(window.webgba?.player.running),
    frames: window.webgba?.player.frameNo ?? 0,
    guard: history.state?.webgbaGuard === true,
    length: history.length,
    pops: window.__pops ?? 0,
    sheet: window.webgba?.state.sheet ?? "",
  }));

const touch = (page) => page.mouse.click(195, 300);
const browserBack = (page) => page.goBack({ timeout: 1500 }).catch(() => null);

const kept = (before, after) => after.mark === before.mark && after.url === before.url && after.game === before.game && after.running && after.frames > before.frames && after.guard;
const brief = (s) => `${s.url.replace(WEB, "/")} 게임 ${s.game || "-"} 실행 ${s.running} 프레임 ${s.frames} 표지 ${s.guard} 기록 ${s.length} popstate ${s.pops}`;

let wk = null;

async function suite(browser, tag, { capture = "" } = {}) {
  {
    const { context, page } = await openPage(browser, { first: true });
    const start = await snap(page);
    ok(`${tag} 첫 진입 = 게임 직접 열기 전 기록 1개`, start.length === 1 && !start.guard, brief(start));
    await openGame(page);
    const opened = await snap(page);
    ok(`${tag} 게임 열기 → 표지 항목 1개 추가(기록 2개)`, opened.guard && opened.length === 2 && opened.game, brief(opened));

    let prev = opened;
    let pass = true;
    const lines = [];
    for (let i = 0; i < 3; i++) {
      await touch(page);
      await browserBack(page);
      await page.waitForTimeout(400);
      const now = await snap(page);
      lines.push(brief(now));
      if (!kept(prev, now)) pass = false;
      prev = now;
    }
    ok(`${tag} 브라우저 뒤로가기 3번(첫 진입 기록 1개) → 페이지 그대로·같은 게임 프레임 계속·다시 불러오기 없음`, pass, lines.join(" | "));
    if (capture) await page.screenshot({ path: capture });

    const before = await snap(page);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => history.back());
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    const after = await snap(page);
    ok(`${tag} history.back() 5번 연속(누르기 없음) → 페이지 그대로·같은 게임 프레임 계속`, kept(before, after), `${brief(before)} → ${brief(after)}`);

    const b2 = await snap(page);
    for (let i = 0; i < 3; i++) await browserBack(page);
    await page.waitForTimeout(400);
    const a2 = await snap(page);
    ok(`${tag} 브라우저 뒤로가기 3번 연속(누르기 없음) → 페이지 그대로`, kept(b2, a2), `${brief(b2)} → ${brief(a2)}`);

    await page.evaluate(() => window.webgba.openSheet("library"));
    await page.waitForTimeout(400);
    const sheetOpen = await snap(page);
    await browserBack(page);
    await page.waitForTimeout(500);
    const sheetBack = await snap(page);
    await touch(page);
    await browserBack(page);
    await page.waitForTimeout(400);
    const sheetBack2 = await snap(page);
    ok(`${tag} 게임 중 라이브러리 → 뒤로가기 = 라이브러리만 닫힘(표지로 복귀) → 다음 뒤로가기 = 아무 동작 없음`, sheetOpen.sheet === "library" && sheetBack.sheet === "" && sheetBack.guard && sheetBack.running && sheetBack.mark === start.mark && kept(sheetBack, sheetBack2), `${brief(sheetOpen)} → ${brief(sheetBack)} → ${brief(sheetBack2)}`);
    ok(`${tag} 페이지 오류 0`, page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }

  {
    const { context, page } = await openPage(browser, { from: "LICENSE.txt" });
    const before = await snap(page);
    await openGame(page);
    const opened = await snap(page);
    await touch(page);
    await browserBack(page);
    await page.waitForTimeout(400);
    const backed = await snap(page);
    ok(`${tag} 이전 페이지가 있을 때 게임 중 뒤로가기 → 이전 페이지로 가지 않음`, opened.length === before.length + 1 && kept(opened, backed) && backed.length === opened.length, `${brief(opened)} → ${brief(backed)}`);

    await page.evaluate(() => window.webgba.closeGame());
    await page.waitForTimeout(500);
    const closed = await snap(page);
    ok(`${tag} 게임 닫기 → 표지 항목 정리(현재 = 처음 항목)`, !closed.game && !closed.guard && closed.mark === opened.mark, brief(closed));
    await page.goBack({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(300);
    ok(`${tag} 게임 닫은 뒤 뒤로가기 = 원래대로(이전 페이지로 이동)`, page.url() === `${WEB}LICENSE.txt`, page.url());
    await context.close();
  }

  {
    const { context, page } = await openPage(browser, { from: "LICENSE.txt" });
    await openGame(page);
    await page.evaluate(() => window.webgba.openSheet("library"));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.webgba.closeGame());
    await page.waitForTimeout(300);
    const inSheet = await snap(page);
    await page.click("#sheetClose");
    await page.waitForTimeout(700);
    const shut = await snap(page);
    ok(`${tag} 라이브러리 안에서 게임 닫기 → 라이브러리 닫으면 표지 항목도 정리`, inSheet.sheet === "library" && !inSheet.game && shut.sheet === "" && !shut.guard && shut.mark === inSheet.mark, `${brief(inSheet)} → ${brief(shut)}`);
    await page.goBack({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(300);
    ok(`${tag} 그 뒤 뒤로가기 = 원래대로(이전 페이지로 이동)`, page.url() === `${WEB}LICENSE.txt`, page.url());
    await context.close();
  }

  {
    const { context, page } = await openPage(browser, { first: true });
    await openGame(page);
    await page.evaluate(() => window.webgba.closeGame());
    await page.waitForTimeout(500);
    const closed = await snap(page);
    await openGame(page);
    const again = await snap(page);
    await touch(page);
    await browserBack(page);
    await page.waitForTimeout(400);
    const backed = await snap(page);
    ok(`${tag} 닫고 다시 열기 → 표지 다시 사용·뒤로가기 막힘(기록 2개 그대로)`, !closed.guard && again.guard && again.length === 2 && kept(again, backed), `${brief(closed)} → ${brief(again)} → ${brief(backed)}`);

    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    await page.evaluate(() => (window.__mark = "reloaded"));
    const reloaded = await snap(page);
    await openGame(page);
    const reopened = await snap(page);
    await touch(page);
    await browserBack(page);
    await page.waitForTimeout(400);
    const reBacked = await snap(page);
    await page.evaluate(() => window.webgba.closeGame());
    await page.waitForTimeout(600);
    const reClosed = await snap(page);
    ok(`${tag} 게임 중 새로 고침 → 남은 표지 정리 · 다시 열면 뒤로가기 막힘 · 닫을 때 다시 불러오기 없음`, !reloaded.guard && reopened.guard && kept(reopened, reBacked) && !reClosed.guard && !reClosed.game && reClosed.mark === "reloaded", `${brief(reloaded)} → ${brief(reopened)} → ${brief(reBacked)} → ${brief(reClosed)}`);
    await context.close();
  }
}

try {
  const cr = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    await suite(cr, "Chrome", { capture: opt.capture ?? "" });
  } finally {
    await cr.close();
  }
  wk = await webkit.launch({ headless: true });
  try {
    await suite(wk, "WebKit");
  } finally {
    await wk.close();
  }
} finally {
  server.kill();
}
console.log(`PC 밖 요청 ${outside.length}건 — 모두 막음(업데이트 목록 등)`);
const failed = results.filter((r) => !r.pass).length;
console.log(`합계 ${results.length - failed}/${results.length}`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify({ results, outside }, null, 2));
process.exit(failed ? 1 : 0);
