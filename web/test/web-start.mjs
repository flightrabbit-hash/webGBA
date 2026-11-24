// 웹 처음 화면 시험(로컬 전용) — 「파일 열기」·「라이브러리 전체 보기」 버튼 모양.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-start.mjs <빌드 폴더> <캡처 폴더> [--only buttons] [--tag 이름]
// 빌드 폴더를 이 프로세스 안 정적 서버로 띄운다(node 1개 + 브라우저 1개). 외부 요청은 모두 막는다(route abort).
// 라이브러리 = 저장소 예제(docs/wgba/examples/net-webapi)의 wasm 으로 이름·id 만 다른 .wgba 를 만들어 가져옴(롬 없음).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const DIST = path.resolve(args[0]);
const SHOTS = path.resolve(args[1]);
const opt = {};
for (let i = 2; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const only = opt.only ? new Set(opt.only.split(",")) : null;
const want = (name) => !only || only.has(name);
const TAG = opt.tag ?? "after";
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const notes = {};
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8" };
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${srv.address().port}/`;

const netDir = path.join(here, "..", "..", "docs", "wgba", "examples", "net-webapi");
const wasm = fs.readFileSync(path.join(netDir, "game.wasm"));
const gameFile = async (id, name) => Buffer.from((await packWgba({ wasm, manifest: { wgba: 1, id, version: "1.0.0", name, runtime: "webapi", input: { preset: "gba" }, screen: { width: 240, height: 160 } } })).bytes).toString("base64");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const VIEWS = { pc: { viewport: { width: 1280, height: 800 } }, portrait: { viewport: { width: 390, height: 844 }, mobile: true }, landscape: { viewport: { width: 844, height: 390 }, mobile: true }, small: { viewport: { width: 320, height: 568 }, mobile: true } };
const blocked = new Set();

async function newPage(view) {
  const { viewport, mobile = false } = VIEWS[view];
  const context = await browser.newContext({ reducedMotion: "reduce", viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, userAgent: mobile ? PHONE_UA : undefined, serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    blocked.add(url.slice(0, 80));
    return route.abort();
  });
  await context.addInitScript(() => {
    localStorage.setItem("webgba.installHint", "1");
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && !/favicon|404|net::ERR_FAILED/.test(message.text()) && page.errors.push(message.text()));
  await page.goto(BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page };
}

// 라이브러리에 게임 넣기 → 처음 화면 다시 그림. 반환 = 가져온 순서대로 key
async function seed(page, games) {
  const keys = [];
  for (const [id, name] of games) {
    const b64 = await gameFile(id, name);
    keys.push(
      await page.evaluate(async ([b64, id]) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const { meta } = await window.webgba.importGame(id, bytes, { file: `${id}.wgba` });
        return meta.key;
      }, [b64, id]),
    );
    await page.waitForTimeout(20);
  }
  await page.evaluate(() => window.webgba.refreshStart());
  await page.waitForTimeout(400);
  return keys;
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

// ---------------------------------------------------------------- 1. 「파일 열기」·「라이브러리 전체 보기」 같은 색·크기·글자 규칙
if (want("buttons")) {
  const styleOf = (page) =>
    page.evaluate(() => {
      const pick = (id, labelSel) => {
        const n = document.getElementById(id);
        const s = getComputedStyle(n);
        const l = getComputedStyle(n.querySelector(labelSel));
        const r = n.getBoundingClientRect();
        return { h: Math.round(r.height * 100) / 100, w: Math.round(r.width), minH: s.minHeight, pad: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`, font: l.fontSize, weight: l.fontWeight, family: l.fontFamily.split(",")[0], line: l.lineHeight, bg: s.backgroundColor, ink: s.color, border: `${s.borderTopColor} ${s.borderBottomColor}`, borderW: `${s.borderTopWidth} ${s.borderBottomWidth}` };
      };
      const start = document.getElementById("start");
      return { open: pick("startOpen", ".btn__label"), all: pick("startAll", ".recent__allLabel"), overflow: start.scrollHeight - start.clientHeight, startH: start.clientHeight };
    });
  const SAME = ["h", "minH", "pad", "font", "weight", "family", "line", "bg", "ink", "border", "borderW"];
  for (const view of ["pc", "portrait", "landscape", "small"]) {
    const { context, page } = await newPage(view);
    const empty = await page.evaluate(() => {
      const n = document.getElementById("startOpen");
      const s = getComputedStyle(n.querySelector(".btn__label"));
      return { h: n.getBoundingClientRect().height, font: s.fontSize, family: s.fontFamily.split(",")[0] };
    });
    if (view !== "small") await shot(page, `${TAG}_${view}_empty`);
    await seed(page, [["io.example.alpha", { ko: "알파", en: "Alpha" }], ["io.example.beta", { ko: "베타", en: "Beta" }], ["io.example.gamma", { ko: "감마", en: "Gamma" }], ["io.example.delta", { ko: "델타", en: "Delta" }]]);
    const s = await styleOf(page);
    notes[`${view}`] = { empty, ...s };
    if (view !== "small") await shot(page, `${TAG}_${view}_list`);
    const diff = SAME.filter((k) => s.open[k] !== s.all[k]);
    ok(`${view}: 「파일 열기」·「라이브러리 전체 보기」 계산 스타일 같음(높이·min-height·padding·글자 크기·굵기·글꼴·줄 높이·배경·글자색·테두리)`, diff.length === 0, diff.length ? diff.map((k) => `${k} ${s.open[k]} / ${s.all[k]}`).join(" · ") : JSON.stringify(s.open));
    ok(`${view}: 목록 없는 처음 화면 「파일 열기」 글자 = 라이브러리 전체 보기 글자(크기·글꼴)`, empty.font === s.all.font && empty.family === s.all.family, JSON.stringify(empty));
    ok(`${view}: 처음 화면 넘침 없음(목록 있음, 스크롤 ${s.overflow}px)`, s.overflow <= 0, `start 높이 ${s.startH}`);
    ok(`${view}: 오류 없음`, !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }
}

await browser.close();
srv.close();
notes.blocked = [...blocked];
const failed = results.filter((r) => !r.pass);
console.log(`\n결과 ${results.length - failed.length}/${results.length} 통과`);
fs.writeFileSync(path.join(SHOTS, `results_${TAG}.json`), JSON.stringify({ results, notes }, null, 2));
process.exit(failed.length ? 1 : 0);
