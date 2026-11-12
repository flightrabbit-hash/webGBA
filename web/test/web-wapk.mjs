// 웹 webGBA .wapk(규격 14장, Android 앱) 시험 — 예제 hello-wapk(가짜 Android 코어)로 화면·터치·키·방향 잠금 안내를 본다.
//   node web/build.mjs && node web/test/web-wapk.mjs [--shots <캡처 폴더>] [--chrome <chrome.exe>]
// 크롬 한 개(새 프로필). 휴대폰 가로·세로(터치 에뮬레이션)·PC(마우스)에서:
//   가상 패드·테두리 없음 · 화면 = 안전 영역 전체 · 캔버스 비율 유지 · 터치 → 게임 좌표(다중 터치 id) · 검정 여백 터치 무시 ·
//   메뉴 버튼(좌측 상단) → 메뉴 창(일시정지·뒤로·메뉴 키) · 같은 줄 버튼 상하 위치 차이 0px · Escape = 뒤로 ·
//   가로 게임을 세로로 열면 "가로로 돌려 주세요"(일시정지) → 가로로 바꾸면 사라짐 · orientation any = 캔버스가 칸 비율을 따름 ·
//   라이브러리 이름 "[A] " · 끌어놓기로 열기.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packAppBundle, packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const ex = path.join(here, "..", "..", "docs", "wgba", "examples", "hello-wapk");
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = opt.shots ?? "";
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

const manifest = JSON.parse(fs.readFileSync(path.join(ex, "manifest.json"), "utf8"));
const app = packAppBundle(["AndroidManifest.xml", "classes.dex"].map((name) => [name, new Uint8Array(fs.readFileSync(path.join(ex, "app", name)))]));
const pack = async (extra) => (await packWgba({ wasm: fs.readFileSync(path.join(ex, "game.wasm")), js: fs.readFileSync(path.join(ex, "game.js")), manifest: { ...manifest, ...extra }, rom: app })).bytes;
const GAMES = {
  landscape: { name: "hello.wapk", bytes: await pack({}) },
  any: { name: "hello-any.wapk", bytes: await pack({ id: "com.example.hellowapk.any", mobile: { ...manifest.mobile, orientation: "any" } }) },
};

const { chromium } = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url)("playwright-core");
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

async function session(name, contextOptions) {
  who = name;
  const context = await browser.newContext({ reducedMotion: "reduce", ...contextOptions });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window === window.top) localStorage.setItem("webgba.installHint", "1");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  const host = (fn, arg) => page.evaluate(fn, arg);
  const logs = () => host(() => (window.webgba.player.host?.logs ?? []).map((l) => `${l.level} ${l.text}`));
  const waitLog = async (re, from = 0, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = (await logs()).slice(from).find((line) => re.test(line));
      if (found) return found;
      await sleep(50);
    }
    return null;
  };
  const open = async (game, { drop = false } = {}) => {
    await host(
      ({ name, bytes, drop }) => {
        const file = new File([new Uint8Array(bytes)], name);
        if (!drop) return window.webgba.openFiles([file]);
        const data = new DataTransfer();
        data.items.add(file);
        window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true, cancelable: true }));
        window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
        return null;
      },
      { name: game.name, bytes: [...game.bytes], drop },
    );
    await page.waitForFunction(() => !window.webgba.state.opening && document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout: 20000 });
    await waitLog(/^view /);
    await sleep(300);
  };
  const shot = async (file) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, file) });
  };
  const cdp = await context.newCDPSession(page);
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const layoutBox = () =>
    host(() => {
      const box = (node) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const style = (sel) => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node) : null;
      };
      return {
        wapk: document.body.dataset.wapk ?? "",
        pad: document.body.dataset.pad,
        padShown: style(".pad")?.display !== "none",
        frameShown: style(".frame")?.display !== "none",
        screen: box(document.getElementById("screen")),
        frame: box(document.querySelector(".script-frame")),
        menu: box(document.getElementById("btnMenu")),
        menuOpacity: Number(style("#btnMenu")?.opacity),
        rightShown: style(".bar__group--right")?.display !== "none",
        turn: !document.getElementById("turn").hidden,
        paused: window.webgba.player.paused,
        view: { w: innerWidth, h: innerHeight },
      };
    });
  return { page, context, host, logs, waitLog, open, shot, touch, layoutBox, errors, close: () => context.close() };
}

// 캔버스(w×h)를 칸(box)에 비율 유지로 넣었을 때 게임 좌표 → CSS 좌표
const toCss = (box, w, h, x, y) => {
  const s = Math.min(box.w / w, box.h / h);
  return [box.x + (box.w - w * s) / 2 + x * s, box.y + (box.h - h * s) / 2 + y * s];
};

async function menuRows(s) {
  return s.host(() => {
    const tools = [...document.querySelectorAll(".bar__group--files .tool")].filter((node) => !node.hidden && getComputedStyle(node).display !== "none");
    const rows = new Map();
    for (const node of tools) {
      const r = node.getBoundingClientRect();
      const key = Math.round(r.top / 8);
      rows.set(key, [...(rows.get(key) ?? []), { id: node.id, top: r.top, bottom: r.bottom }]);
    }
    return [...rows.values()].map((row) => ({ ids: row.map((b) => b.id), topSpread: Math.max(...row.map((b) => b.top)) - Math.min(...row.map((b) => b.top)), bottomSpread: Math.max(...row.map((b) => b.bottom)) - Math.min(...row.map((b) => b.bottom)) }));
  });
}

try {
  // 1. 휴대폰 가로(844×390, 터치) — 가로 게임
  {
    const s = await session("휴대폰 가로", { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await s.open(GAMES.landscape);
    const L = await s.layoutBox();
    ok("wapk 화면: 가상 패드·테두리 없음", L.wapk === "landscape" && L.pad === "off" && !L.padShown && !L.frameShown, JSON.stringify({ wapk: L.wapk, pad: L.pad, padShown: L.padShown, frameShown: L.frameShown }));
    ok("화면 = 뷰포트 전체", L.screen.x === 0 && L.screen.y === 0 && L.screen.w === 844 && L.screen.h === 390 && L.frame?.w === 844 && L.frame?.h === 390, JSON.stringify(L.screen));
    ok("메뉴 버튼 좌측 상단·반투명, 다른 도구 줄 숨김", L.menu.x <= 12 && L.menu.y <= 12 && L.menuOpacity < 1 && !L.rightShown, JSON.stringify({ menu: L.menu, opacity: L.menuOpacity, right: L.rightShown }));
    const before = (await s.logs()).length;
    await s.touch("touchStart", [[20, 195, 3]]);
    await s.touch("touchEnd", []);
    await sleep(150);
    ok("검정 여백 터치는 보내지 않음", !(await s.logs()).slice(before).some((line) => line.startsWith("touch ")), (await s.logs()).slice(before).join(" | "));
    const m0 = (await s.logs()).length;
    await s.page.tap("#btnMenu");
    await s.page.waitForSelector(".bar__group--files[data-open='open']");
    await sleep(300);
    const paused = await s.waitLog(/^event pause/, m0);
    const rows = await menuRows(s);
    ok("메뉴 창: 일시정지·뒤로·메뉴 키 버튼", Boolean(paused) && rows.flatMap((r) => r.ids).includes("btnBack") && rows.flatMap((r) => r.ids).includes("btnAppMenu"), JSON.stringify(rows.map((r) => r.ids)));
    ok("메뉴 창 같은 줄 버튼 상단·하단 차이 0px", rows.every((r) => r.topSpread === 0 && r.bottomSpread === 0), JSON.stringify(rows));
    await s.shot("phone-landscape-menu.png");
    const b0 = (await s.logs()).length;
    await s.page.tap("#btnBack");
    const backDown = await s.waitLog(/^button BACK down/, b0);
    const backUp = await s.waitLog(/^button BACK up/, b0);
    const resumed = await s.waitLog(/^event resume/, b0);
    ok("메뉴 \"뒤로\" → 게임 재개 후 BACK 누름·뗌", backDown && backUp && resumed, (await s.logs()).slice(b0).join(" | "));
    const k0 = (await s.logs()).length;
    await s.page.keyboard.press("Escape");
    ok("Escape = 뒤로(BACK)", Boolean(await s.waitLog(/^button BACK down/, k0)));
    // CDP 로 보낸 다중 터치 뒤에는 크롬 에뮬레이션이 탭(click)을 만들지 않아 이 세션의 마지막에 둔다
    const from = (await s.logs()).length;
    const [ax, ay] = toCss(L.screen, 800, 480, 400, 240);
    const [bx, by] = toCss(L.screen, 800, 480, 100, 100);
    await s.touch("touchStart", [[ax, ay, 1]]);
    await s.touch("touchStart", [[ax, ay, 1], [bx, by, 2]]);
    await s.touch("touchMove", [[ax + 13, ay, 1], [bx, by, 2]]);
    await s.touch("touchEnd", [[bx, by, 2]]);
    await s.touch("touchEnd", []).catch(() => {});
    await sleep(200);
    await s.shot("phone-landscape.png");
    const lines = (await s.logs()).slice(from).filter((line) => line.startsWith("touch "));
    const want = [/^touch down 0 400\.0 240\.0 1$/, /^touch down 1 100\.0 100\.0 2$/, /^touch up 1 100\.0 100\.0 2$/, /^touch up 0 416\.0 240\.0 1$/];
    ok("두 손가락: 게임 좌표·id 0·1·touches 수(Android 순서)", lines.length === 4 && want.every((re, i) => re.test(lines[i])), lines.join(" | "));
    ok("페이지 오류 없음", s.errors.length === 0, s.errors.join(" | "));
    await s.close();
  }

  // 2. 휴대폰 세로(390×844) — 가로 게임: 안내 화면 → 가로로 돌리면 사라짐
  {
    const s = await session("휴대폰 세로", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await s.open(GAMES.landscape);
    await sleep(200);
    const P = await s.layoutBox();
    const veil = await s.host(() => {
      const turn = document.getElementById("turn");
      const kids = [...turn.children].filter((n) => !n.hidden && getComputedStyle(n).display !== "none");
      const top = Math.min(...kids.map((n) => n.getBoundingClientRect().top));
      const bottom = Math.max(...kids.map((n) => n.getBoundingClientRect().bottom));
      const r = turn.getBoundingClientRect();
      return { title: document.getElementById("turnTitle").textContent, lock: !document.getElementById("turnLock").hidden, center: (top + bottom) / 2 - (r.top + r.bottom) / 2 };
    });
    ok("세로에서 가로 게임: 안내 화면·일시정지", P.turn && P.paused && /돌려|Rotate|向き/.test(veil.title), JSON.stringify({ turn: P.turn, paused: P.paused, veil }));
    ok("안내 화면 내용 세로 가운데(차이 0px)", Math.abs(veil.center) < 0.5, String(veil.center));
    await s.shot("phone-portrait-turn.png");
    await s.page.setViewportSize({ width: 844, height: 390 });
    await sleep(500);
    const R = await s.layoutBox();
    ok("가로로 돌리면 안내 사라지고 재개", !R.turn && !R.paused && R.screen.w === 844 && R.screen.h === 390, JSON.stringify({ turn: R.turn, paused: R.paused, screen: R.screen }));
    await s.close();
  }

  // 3. 휴대폰 세로 — orientation any: 캔버스가 칸 비율을 따름
  {
    const s = await session("휴대폰 any", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await s.open(GAMES.any);
    const v1 = await s.waitLog(/^view 390x844 portrait 480x1039/);
    const A = await s.layoutBox();
    ok("any: 안내 없음 · view 390x844 → 캔버스 480x1039", !A.turn && Boolean(v1), v1 ?? (await s.logs()).filter((l) => l.startsWith("view")).join(" | "));
    const from = (await s.logs()).length;
    const [x, y] = toCss(A.screen, 480, 1039, 240, 519.5);
    await s.touch("touchStart", [[x, y, 1]]);
    await s.touch("touchEnd", []);
    await sleep(150);
    const down = (await s.logs()).slice(from).find((line) => line.startsWith("touch down"));
    ok("any: 바뀐 캔버스 크기로 좌표 변환", /^touch down 0 24\d\.\d 519\.\d 1$/.test(down ?? ""), down ?? "없음");
    await s.shot("phone-any-portrait.png");
    await s.page.setViewportSize({ width: 844, height: 390 });
    const v2 = await s.waitLog(/^view 844x390 landscape 1039x480/, from);
    ok("any: 가로로 바꾸면 resize → 캔버스 1039x480", Boolean(v2), (await s.logs()).filter((l) => l.startsWith("view")).join(" | "));
    await s.shot("phone-any-landscape.png");
    await s.close();
  }

  // 4. PC(1280×800, 마우스) — 끌어놓기로 열기, 마우스 = 터치, 안내 없음, 라이브러리 이름
  {
    const s = await session("PC", { viewport: { width: 1280, height: 800 } });
    await s.open(GAMES.landscape, { drop: true });
    const C = await s.layoutBox();
    ok("PC: 끌어놓기로 열림 · 안내 없음 · 화면 전체", C.wapk === "landscape" && !C.turn && C.screen.w === 1280 && C.screen.h === 800, JSON.stringify({ wapk: C.wapk, turn: C.turn, screen: C.screen }));
    const from = (await s.logs()).length;
    const [x, y] = toCss(C.screen, 800, 480, 200, 300);
    await s.page.mouse.move(x, y);
    await s.page.mouse.down();
    await s.page.mouse.move(x + 16, y, { steps: 2 });
    await s.page.mouse.up();
    await sleep(150);
    const lines = (await s.logs()).slice(from).filter((line) => line.startsWith("touch "));
    ok("PC: 마우스 좌측 버튼 = 터치 하나", /^touch down 0 200\.0 300\.0 1$/.test(lines[0] ?? "") && /^touch up 0 210\.0 300\.0 1$/.test(lines.at(-1) ?? ""), lines.join(" | "));
    await s.shot("pc.png");
    await s.host(() => window.webgba.closeGame({ quiet: true }));
    await sleep(200);
    const back = await s.layoutBox();
    ok("닫으면 wapk 화면 해제", back.wapk === "" && back.rightShown, JSON.stringify({ wapk: back.wapk, right: back.rightShown }));
    await s.host(() => window.webgba.openSheet("library"));
    await sleep(600);
    const names = await s.host(() => document.getElementById("sheetBody").textContent);
    ok("라이브러리 이름 \"[A] \" · 형식 .wapk", /\[A\] /.test(names) && /\.wapk/.test(names), names.slice(0, 120));
    await s.shot("pc-library.png");
    ok("페이지 오류 없음", s.errors.length === 0, s.errors.join(" | "));
    await s.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
process.exitCode = failed.length ? 1 : 0;
