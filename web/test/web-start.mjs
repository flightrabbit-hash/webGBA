// 웹 처음 화면 시험(로컬 전용) — 「파일 열기」·「라이브러리 전체 보기」 버튼 모양 · 「최근 실행한 게임」 ↔ 「최근 가져온 게임」 토글.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-start.mjs <빌드 폴더> <캡처 폴더> [--only buttons,recent] [--tag 이름]
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

async function newPage(view, { pad = false, admin = false } = {}) {
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
  // 관리자 켬 화면 대역: 형식만 맞는 기록(서버 요청 없음 — 롬 가져오기를 누르지 않는 화면 확인용)
  if (admin) await context.addInitScript(() => localStorage.getItem("webgba.admin") || localStorage.setItem("webgba.admin", JSON.stringify({ token: `a1.x.y.${"A".repeat(32)}`, at: Date.now(), until: Date.now() + 86400000 })));
  if (pad) {
    await context.addInitScript(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      const gp = { id: "test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons, timestamp: 0 };
      window.__pad = gp;
      navigator.getGamepads = () => [gp, null, null, null];
    });
  }
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

// ---------------------------------------------------------------- 2. 「최근 실행한 게임」 ↔ 「최근 가져온 게임」 토글
if (want("recent")) {
  // 가져온 시각(added)·실행 시각(opened)을 다른 순서로: 실행 = E B D A C, 가져온 = D C B A (E 는 옛 기록 — added 없음 → 끝)
  const GAMES = [["io.example.a", { ko: "에이", en: "A" }], ["io.example.b", { ko: "비", en: "B" }], ["io.example.c", { ko: "씨", en: "C" }], ["io.example.d", { ko: "디", en: "D" }], ["io.example.e", { ko: "이", en: "E" }]];
  const TIMES = { a: [1000, 7000], b: [2000, 9000], c: [3000, 6000], d: [4000, 8000], e: [undefined, 10000] };
  const OPENED = "e,b,d,a,c";
  const ADDED = "d,c,b,a,e";
  const prepare = async (page) => {
    const keys = await seed(page, GAMES);
    await page.evaluate(async ([keys, times]) => {
      const ids = Object.keys(times);
      for (const [i, key] of keys.entries()) {
        const [added, opened] = times[ids[i]];
        await window.webgba.store.patch(key, { added, opened });
      }
      await window.webgba.refreshStart();
    }, [keys, TIMES]);
    await page.waitForTimeout(300);
  };
  const view = (page) =>
    page.evaluate(() => {
      const tg = document.getElementById("startToggle");
      const items = [...document.querySelectorAll("#startList .recent__item")];
      const names = items.map((n) => n.querySelector(".recent__name").textContent);
      return {
        title: document.getElementById("startHint").textContent,
        order: items.map((n) => n.dataset.key && n.querySelector(".recent__name").textContent),
        shown: items.filter((n) => !n.hidden).length,
        count: items.length,
        all: document.getElementById("startAll").textContent.trim(),
        pressed: tg.getAttribute("aria-pressed"),
        tip: tg.title,
        aria: tg.getAttribute("aria-label"),
        toggle: !tg.hidden,
        pref: JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}").startRecent ?? "",
        bg: getComputedStyle(tg).backgroundColor,
        names,
      };
    });
  const NAME = { 에이: "a", 비: "b", 씨: "c", 디: "d", 이: "e" };
  const orderOf = (v) => v.names.map((n) => NAME[n]).join(",");
  const tipOpened = "최근 가져온 게임 보기 (현재: 최근 실행한 게임 · 게임패드 SELECT)";
  const tipAdded = "최근 실행한 게임 보기 (현재: 최근 가져온 게임 · 게임패드 SELECT)";
  const isOpened = (v) => v.title === "최근 실행한 게임" && orderOf(v) === OPENED && v.pressed === "false" && v.tip === tipOpened && v.aria === tipOpened;
  const isAdded = (v) => v.title === "최근 가져온 게임" && orderOf(v) === ADDED && v.pressed === "true" && v.tip === tipAdded && v.aria === tipAdded;
  const settle = (page) => page.waitForTimeout(350);

  // PC: 마우스·키보드·게임패드·새로고침
  {
    const { context, page } = await newPage("pc", { pad: true });
    await prepare(page);
    const v0 = await view(page);
    await shot(page, "recent_pc_opened");
    ok("PC 기본 = 최근 실행한 게임(실행 시각 최신순 E B D A C) · 토글 aria-pressed false · 툴팁 = 현재·누르면 바뀌는 상태", isOpened(v0) && v0.toggle && v0.pref === "", JSON.stringify(v0));
    await page.click("#startToggle");
    await settle(page);
    const v1 = await view(page);
    await page.mouse.move(5, 5);
    await settle(page);
    await shot(page, "recent_pc_added");
    ok("PC 토글 클릭 → 최근 가져온 게임(가져온 시각 최신순 D C B A, added 없는 옛 기록 E = 끝) · aria-pressed true · 강조 면", isAdded(v1) && v1.pref === "added" && v1.bg !== v0.bg, JSON.stringify({ v1, bg0: v0.bg }));
    ok("두 상태 목록 개수·보이는 칸 수·「라이브러리 전체 보기」 같음", v0.count === v1.count && v0.shown === v1.shown && v0.all === v1.all, JSON.stringify({ v0: [v0.count, v0.shown, v0.all], v1: [v1.count, v1.shown, v1.all] }));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    await settle(page);
    const v2 = await view(page);
    ok("새로고침 뒤 마지막 선택(최근 가져온 게임) 유지", isAdded(v2), JSON.stringify(v2));
    await page.click("#startToggle");
    await settle(page);
    const v3 = await view(page);
    ok("다시 누르면 최근 실행한 게임으로 돌아감", isOpened(v3) && v3.pref === "opened", JSON.stringify(v3));
    await page.focus("#startToggle");
    await page.keyboard.press("Enter");
    await settle(page);
    const k1 = await view(page);
    await page.keyboard.press("Enter");
    await settle(page);
    const k2 = await view(page);
    const focused = await page.evaluate(() => document.activeElement?.id);
    ok("키보드: 포커스 후 Enter → 가져온 순 · 다시 Enter → 실행 순(포커스 유지)", isAdded(k1) && isOpened(k2) && focused === "startToggle", JSON.stringify({ k1: orderOf(k1), k2: orderOf(k2), focused }));
    await page.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
    const press = async (i) => {
      await page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i);
      await page.waitForTimeout(120);
      await page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i);
      await settle(page);
    };
    await press(8);
    const p1 = await view(page);
    await press(8);
    const p2 = await view(page);
    await press(0);
    const p3 = await view(page);
    ok("게임패드: SELECT → 가져온 순 · 다시 SELECT → 실행 순(다른 버튼은 무시)", isAdded(p1) && isOpened(p2) && isOpened(p3), JSON.stringify({ p1: orderOf(p1), p2: orderOf(p2), p3: orderOf(p3) }));
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await page.waitForTimeout(400);
    await press(8);
    const p4 = await view(page);
    await page.click("#sheetClose");
    await settle(page);
    ok("게임패드: 설정 창이 열린 동안 SELECT 는 토글하지 않음", isOpened(p4), orderOf(p4));
    ok("PC: 오류 없음", !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }
  // 휴대폰 세로·가로: 두 상태 캡처 · 칸 수 같음 · 넘침 없음
  for (const name of ["portrait", "landscape"]) {
    const { context, page } = await newPage(name);
    await prepare(page);
    const v0 = await view(page);
    await shot(page, `recent_${name}_opened`);
    await page.tap("#startToggle");
    await settle(page);
    const v1 = await view(page);
    await shot(page, `recent_${name}_added`);
    const geo = await page.evaluate(() => {
      const hint = document.getElementById("startHint").getBoundingClientRect();
      const tg = document.getElementById("startToggle").getBoundingClientRect();
      const open = document.getElementById("startOpen").getBoundingClientRect();
      const start = document.getElementById("start");
      return { gapHint: Math.round(tg.left - hint.right), beforeOpen: tg.right <= open.left, middle: Math.abs(tg.top + tg.height / 2 - (open.top + open.height / 2)) < 1, overflow: start.scrollHeight - start.clientHeight, hover: matchMedia("(hover: hover) and (pointer: fine)").matches };
    });
    ok(`휴대폰 ${name}: 탭 → 최근 가져온 게임 · 칸 수 같음(${v0.shown}) · 토글 = 제목 우측·파일 열기 좌측·세로 가운데 · 넘침 없음 · hover 없는 기기`, isOpened(v0) && isAdded(v1) && v0.shown === v1.shown && geo.beforeOpen && geo.middle && geo.gapHint >= 0 && geo.gapHint <= 12 && geo.overflow <= 0 && !geo.hover, JSON.stringify({ geo, shown: [v0.shown, v1.shown] }));
    ok(`휴대폰 ${name}: 오류 없음`, !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }
  // 320 세로(가장 좁은 화면): 제목이 길어져도 넘침 없음
  {
    const { context, page } = await newPage("small");
    await prepare(page);
    await page.tap("#startToggle");
    await settle(page);
    const s = await page.evaluate(() => {
      const start = document.getElementById("start");
      const hint = document.getElementById("startHint");
      return { overflow: start.scrollHeight - start.clientHeight, cut: hint.scrollWidth > hint.clientWidth, title: hint.textContent };
    });
    ok("320x568 세로: 최근 가져온 게임 상태 넘침 없음", s.overflow <= 0, JSON.stringify(s));
    await context.close();
  }
  // 빈 라이브러리: 토글 없음 · 안내 문구(관리자 끔·켬)
  for (const [admin, want] of [[false, "게임 파일을 선택하거나 여기에 끌어 놓으세요."], [true, "롬 가져오기를 누르거나 게임 파일을 여기에 끌어 놓으세요."]]) {
    const { context, page } = await newPage("pc", { admin });
    const e = await page.evaluate(() => ({ hint: document.getElementById("startHint").textContent, toggle: !document.getElementById("startToggle").hidden, open: document.querySelector("#startOpen .btn__label").textContent }));
    if (admin) await shot(page, "recent_pc_empty_admin");
    ok(`빈 라이브러리(관리자 ${admin ? "켬" : "끔"}): 토글 없음 · 안내 「${want}」`, !e.toggle && e.hint === want && e.open === (admin ? "롬 가져오기" : "파일 열기"), JSON.stringify(e));
    await context.close();
  }
  {
    const { context, page } = await newPage("portrait", { admin: true });
    const hint = await page.evaluate(() => document.getElementById("startHint").textContent);
    ok("빈 라이브러리(관리자 켬, 휴대폰): 안내 「롬 가져오기를 눌러 게임을 받아 주세요.」", hint === "롬 가져오기를 눌러 게임을 받아 주세요.", hint);
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
