// 웹 webGBA 시험(로컬 전용) — Playwright(playwright-core)로 실제 Chrome 을 띄워 화면·입력·보관·오프라인을 본다.
//   PLAYWRIGHT_DIR=<playwright-core 가 설치된 폴더> node web/test/web-app.mjs <주소> <캡처 폴더> \
//     --gba <롬.gba> --wgba <게임.wgba> --wgbp <패치.wgbp> --base <바탕 롬…> --sav <세이브.sav> [--chrome <chrome.exe>] [--only 이름,…]
// 시험 파일은 브라우저에서 고르기만 한다(서버로 보내지 않음). 사용자 폴더 파일은 읽기만 하고, scratch 사본을 쓰는 것을 권한다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const URL_BASE = args[0];
const SHOTS = args[1];
const opt = { base: [] };
for (let i = 2; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  if (key === "base") opt.base.push(args[++i]);
  else opt[key] = args[++i];
}
const only = opt.only ? new Set(opt.only.split(",")) : null;
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");

const BITS = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const bitsOf = (...names) => names.reduce((sum, name) => sum | BITS[name], 0);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=user-gesture-required"] });

async function newPage({ viewport = { width: 1280, height: 800 }, mobile = false, touch = false, seen = true, ua = undefined, standalone = true, path: at = "" } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport, isMobile: mobile, hasTouch: touch, deviceScaleFactor: mobile ? 2 : 1, userAgent: ua, acceptDownloads: true });
  if (seen) await context.addInitScript(() => localStorage.setItem("webgba.installHint", "1"));
  if (standalone) await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && page.errors.push(message.text()));
  await page.goto(URL_BASE + at);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 20000 });
  return { context, page };
}

async function chooseFiles(page, clickSelector, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click(clickSelector)]);
  await chooser.setFiles(files);
}

const filesMenu = async (page) => {
  if (await page.isVisible("#btnMenu")) {
    await page.click("#btnMenu");
    await page.waitForSelector(".bar__group--files #btnOpen", { state: "visible" });
  }
};
const waitGame = (page, timeout = 60000) => page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout });
const held = (page) => page.evaluate(() => window.webgba.player.held);
const want = (name) => !only || only.has(name);

async function rects(page) {
  return page.evaluate(() => {
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    };
    const out = {};
    for (const node of document.querySelectorAll("[data-key]")) out[node.dataset.key] = box(node);
    out.DIR = box(document.querySelector("[data-dpad]"));
    out.screen = box(document.getElementById("canvas"));
    return out;
  });
}

function touchApi(cdp) {
  return async (type, points) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 2, radiusY: 2, force: 1 })) });
  };
}

async function testHeadAndInstall() {
  const { context, page } = await newPage({ seen: false });
  const head = await page.evaluate(async () => {
    const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content ?? null;
    const manifest = await (await fetch(document.querySelector('link[rel="manifest"]').href)).json();
    const icons = [];
    for (const icon of manifest.icons) {
      const response = await fetch(icon.src);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      icons.push({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose, real: `${bitmap.width}x${bitmap.height}`, status: response.status });
    }
    const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const touchBitmap = await createImageBitmap(await (await fetch(touchIcon.href)).blob());
    const canvas = new OffscreenCanvas(touchBitmap.width, touchBitmap.height);
    const g = canvas.getContext("2d");
    g.drawImage(touchBitmap, 0, 0);
    const alpha = g.getImageData(0, 0, touchBitmap.width, touchBitmap.height).data;
    let transparent = 0;
    for (let i = 3; i < alpha.length; i += 4) if (alpha[i] < 255) transparent++;
    return {
      viewport: meta("viewport"),
      capable: meta("apple-mobile-web-app-capable"),
      mobileCapable: meta("mobile-web-app-capable"),
      title: meta("apple-mobile-web-app-title"),
      bar: meta("apple-mobile-web-app-status-bar-style"),
      theme: meta("theme-color"),
      touchSizes: touchIcon.getAttribute("sizes"),
      touchReal: `${touchBitmap.width}x${touchBitmap.height}`,
      touchTransparent: transparent,
      manifest,
      icons,
    };
  });
  ok("head: viewport-fit·확대 막기", /viewport-fit=cover/.test(head.viewport) && /user-scalable=no/.test(head.viewport), head.viewport);
  ok("head: iOS 메타 4개", head.capable === "yes" && head.mobileCapable === "yes" && head.title === "webGBA" && Boolean(head.bar), JSON.stringify([head.capable, head.mobileCapable, head.title, head.bar]));
  ok("head: apple-touch-icon 180 불투명", head.touchSizes === "180x180" && head.touchReal === "180x180" && head.touchTransparent === 0, `${head.touchReal} 투명 ${head.touchTransparent}`);
  const icons = head.icons.map((icon) => `${icon.sizes}/${icon.purpose}/${icon.real}`);
  ok("manifest: any 192·512 + maskable 512, 실제 크기 같음", head.icons.length === 3 && head.icons.every((icon) => icon.sizes === icon.real && icon.status === 200) && head.icons.some((icon) => icon.purpose === "maskable"), icons.join(", "));
  ok("manifest: standalone·start_url·scope", head.manifest.display === "standalone" && head.manifest.start_url === "/" && head.manifest.scope === "/");
  await context.close();
  const gateOf = (p) => p.evaluate(() => ({ shown: !document.getElementById("gate").hidden, app: getComputedStyle(document.getElementById("app")).display, platform: document.getElementById("gate").dataset.platform ?? "", text: document.getElementById("gate").textContent, overflowX: document.getElementById("gate").scrollWidth > document.getElementById("gate").clientWidth }));
  const desk = await newPage({ standalone: false });
  const d = await gateOf(desk.page);
  ok("앱으로 실행하지 않으면 화면 전체 설치 안내(앱 화면 숨김)", d.shown && d.app === "none" && d.platform === "desktop", d.platform);
  await desk.page.reload();
  await desk.page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  ok("설치 안내는 매번(새로고침 뒤에도)", (await gateOf(desk.page)).shown);
  await desk.context.close();
  const alone = await newPage({ standalone: true });
  ok("설치한 앱(standalone)이면 안내 없이 바로 앱", !(await gateOf(alone.page)).shown);
  await alone.context.close();
  const dev = await newPage({ standalone: false, path: "?dev=1" });
  ok("개발용 우회(?dev=1)", !(await gateOf(dev.page)).shown);
  await dev.context.close();
  const uas = {
    iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    iosOther: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
    androidInApp: "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 KAKAOTALK 10.8.0",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
    unsupported: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  };
  for (const [kind, ua] of Object.entries(uas)) {
    const mobile = kind !== "unsupported";
    const g = await newPage({ standalone: false, ua, mobile, touch: mobile, viewport: mobile ? { width: 393, height: 852 } : { width: 1280, height: 800 } });
    const info = await gateOf(g.page);
    ok(`기기별 설치 안내: ${kind}`, info.shown && info.platform === kind && !info.overflowX, info.text.slice(0, 80));
    if (kind === "iosSafari") await g.page.screenshot({ path: path.join(SHOTS, "ios_393x852_설치안내.png") });
    await g.context.close();
  }
}

async function testPad() {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  const cdp = await context.newCDPSession(page);
  const touch = touchApi(cdp);
  ok("세로: 가상 버튼 보임(터치 기기)", (await page.evaluate(() => document.body.dataset.pad)) === "on");
  const r = await rects(page);
  const R = r.DIR.w / 2;
  const at = (deg, k) => ({ x: r.DIR.x + Math.cos((deg * Math.PI) / 180) * R * k, y: r.DIR.y + Math.sin((deg * Math.PI) / 180) * R * k, id: 1 });
  const expect = { 0: ["RIGHT"], 45: ["RIGHT", "DOWN"], 90: ["DOWN"], 135: ["DOWN", "LEFT"], 180: ["LEFT"], 225: ["LEFT", "UP"], 270: ["UP"], 315: ["UP", "RIGHT"] };
  let all = true;
  const seen = [];
  for (const [deg, names] of Object.entries(expect)) {
    await touch("touchStart", [at(Number(deg), 0.8)]);
    const bits = await held(page);
    seen.push(`${deg}°=${bits}`);
    if (bits !== bitsOf(...names)) all = false;
    await touch("touchEnd", []);
  }
  ok("스틱 8방향", all, seen.join(" "));
  await touch("touchStart", [at(0, 0.2)]);
  const dead = await held(page);
  await touch("touchEnd", []);
  ok("스틱 가운데 죽은 영역(0.2r)", dead === 0, `bits ${dead}`);
  await touch("touchStart", [at(28, 0.8)]);
  const narrowCard = await held(page);
  await touch("touchMove", [at(36, 0.8)]);
  const narrowDiag = await held(page);
  await touch("touchEnd", []);
  ok("대각선 칸은 좁게(28°=오른쪽, 36°=오른쪽+아래)", narrowCard === bitsOf("RIGHT") && narrowDiag === bitsOf("RIGHT", "DOWN"), `${narrowCard}/${narrowDiag}`);
  await touch("touchStart", [at(0, 0)]);
  await touch("touchMove", [{ x: r.DIR.x + R * 3, y: r.DIR.y, id: 1 }]);
  const outside = await held(page);
  const knob = await page.evaluate(() => window.webgba.skin.stickState.x.toFixed(3));
  await touch("touchMove", [{ x: r.DIR.x, y: r.DIR.y - R * 3, id: 1 }]);
  const outsideUp = await held(page);
  await touch("touchEnd", []);
  ok("받침 밖으로 끌어도 스틱 유지(오른쪽→위)", outside === bitsOf("RIGHT") && outsideUp === bitsOf("UP") && Number(knob) === 1, `${outside}/${outsideUp} 손잡이 ${knob}`);
  await touch("touchStart", [at(0, 0.8), { x: r.A.x, y: r.A.y, id: 2 }]);
  const both = await held(page);
  await touch("touchMove", [at(0, 0.8), { x: r.B.x, y: r.B.y, id: 2 }]);
  const slid = await held(page);
  await touch("touchMove", [at(270, 0.8), { x: r.B.x, y: r.B.y, id: 2 }]);
  const turned = await held(page);
  await touch("touchEnd", [at(270, 0.8)]);
  const left = await held(page);
  await touch("touchEnd", []);
  const none = await held(page);
  ok("두 손가락 동시(스틱 오른쪽 + A)", both === bitsOf("RIGHT", "A"), `${both}`);
  ok("A→B 미끄러짐", slid === bitsOf("RIGHT", "B"), `${slid}`);
  ok("스틱 돌리기(오른쪽→위, B 유지)", turned === bitsOf("UP", "B"), `${turned}`);
  ok("한 손가락 떼기·모두 떼기", left === bitsOf("B") && none === 0, `${left}/${none}`);
  await touch("touchStart", [{ x: r.L.x, y: r.L.y, id: 1 }, { x: r.R.x, y: r.R.y, id: 2 }, { x: r.START.x, y: r.START.y, id: 3 }, { x: r.SELECT.x, y: r.SELECT.y, id: 4 }]);
  const four = await held(page);
  await touch("touchEnd", []);
  ok("네 손가락 L·R·START·SELECT", four === bitsOf("L", "R", "START", "SELECT"), `${four}`);
  const edgeA = { x: r.A.x + r.A.w / 2 + 10, y: r.A.y, id: 1 };
  await touch("touchStart", [edgeA]);
  const nearA = await held(page);
  await touch("touchEnd", []);
  const mid = { x: (r.A.x + r.B.x) / 2, y: (r.A.y + r.B.y) / 2, id: 1 };
  await touch("touchStart", [mid]);
  const between = await held(page);
  await touch("touchEnd", []);
  ok("버튼 그림 바깥 가장자리 근처(+10px) 탭도 그 버튼", nearA === bitsOf("A"), `${nearA}`);
  ok("A·B 사이 탭은 하나만 눌림", between === bitsOf("A") || between === bitsOf("B"), `${between}`);
  await page.click("#btnSettings");
  await page.selectOption('select[aria-label="방향 입력"]', "dpad");
  const mode = await page.evaluate(() => [document.querySelector("[data-dpad]").dataset.mode, JSON.parse(localStorage.getItem("webgba.prefs")).dirInput]);
  await page.click("#sheetClose");
  const r2 = await rects(page);
  const arm = r2.DIR.w * 0.33;
  await touch("touchStart", [{ x: r2.DIR.x, y: r2.DIR.y - arm, id: 1 }]);
  const up = await held(page);
  await touch("touchMove", [{ x: r2.DIR.x + arm, y: r2.DIR.y, id: 1 }]);
  const right = await held(page);
  await touch("touchMove", [{ x: r.A.x, y: r.A.y, id: 1 }]);
  const toA = await held(page);
  await touch("touchEnd", []);
  ok("설정: 십자 패드로 바꿈(기억)", mode[0] === "dpad" && mode[1] === "dpad", mode.join("/"));
  ok("십자 패드 위→오른쪽 미끄러짐·A 로 넘어감", up === bitsOf("UP") && right === bitsOf("RIGHT") && toA === bitsOf("A"), `${up}/${right}/${toA}`);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  ok("새로고침 뒤에도 십자 패드", (await page.evaluate(() => document.querySelector("[data-dpad]").dataset.mode)) === "dpad");
  ok("화면 확대·선택 막기(touch-action·user-select)", await page.evaluate(() => getComputedStyle(document.getElementById("pad")).touchAction === "none" && getComputedStyle(document.body).userSelect === "none"));
  ok("가상 버튼 시험 중 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

async function testGba() {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  await chooseFiles(page, "#startOpen", [opt.gba]);
  await waitGame(page);
  const frames0 = await page.evaluate(() => window.webgba.player.frames);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(async () => {
    const roms = await window.webgba.store.list("rom");
    return { roms: roms.map((r) => ({ key: r.key, kind: r.kind, name: r.name, type: r.type })), game: window.webgba.state.game };
  });
  const name = path.basename(opt.gba);
  ok(".gba 열기(mGBA 코어)", info.game?.type === "gba" && info.game.name === name, JSON.stringify(info.game));
  ok("게임 파일 IndexedDB 보관(kind rom, 키 rom:)", info.roms.some((r) => r.kind === "rom" && r.key.startsWith("rom:") && r.name === name), JSON.stringify(info.roms));
  await page.screenshot({ path: path.join(SHOTS, "세로_390x844_게임.png") });
  await page.keyboard.down("KeyZ");
  const keyA = await held(page);
  await page.keyboard.up("KeyZ");
  await page.keyboard.down("ArrowLeft");
  const keyLeft = await held(page);
  await page.keyboard.up("ArrowLeft");
  ok("키보드(Z=A, ←)", keyA === bitsOf("A") && keyLeft === bitsOf("LEFT"), `${keyA}/${keyLeft}`);
  const countFrames = () => page.evaluate(() => new Promise((resolve) => { const host = window.webgba.player.host; const run = host.runFrame.bind(host); let n = 0; host.runFrame = (k) => (n++, run(k)); setTimeout(() => { host.runFrame = run; resolve(n); }, 1500); }));
  const speedDefault = await page.evaluate(() => window.webgba.player.gameSpeed);
  const at1 = await countFrames();
  await page.click("#btnSettings");
  await page.selectOption('select[aria-label="게임 재생 속도"]', "2");
  await page.click("#sheetClose");
  await page.waitForTimeout(300);
  const at2 = await countFrames();
  ok("게임 재생 속도: 기본 1배·2배 고르면 계속 2배(프레임 수)", speedDefault === 1 && at2 / at1 > 1.7 && at2 / at1 < 2.3, `1배 ${at1} · 2배 ${at2}`);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  ok("게임 재생 속도 기억(새로고침 뒤)", (await page.evaluate(() => window.webgba.player.gameSpeed)) === 2);
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("webgba.prefs")); p.gameSpeed = 1; localStorage.setItem("webgba.prefs", JSON.stringify(p)); });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.click("#startList .item__main");
  await waitGame(page);
  await filesMenu(page);
  await page.click("#btnLibrary");
  await page.waitForSelector('.list[data-kind="rom"] .item');
  const actions = await page.$$eval('.list[data-kind="rom"] .item [data-action]', (nodes) => nodes.map((node) => node.dataset.action));
  ok("보관한 게임 목록: 열기·이름 바꾸기·삭제만(내보내기 없음)", actions.length > 0 && actions.every((a) => a === "rename" || a === "delete"), actions.join(","));
  await page.click("#sheetClose");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  const land = await page.evaluate(() => ({ layout: document.body.dataset.layout, sw: getComputedStyle(document.documentElement).getPropertyValue("--sw") }));
  ok("가로 모드 배치", land.layout === "landscape", JSON.stringify(land));
  await page.screenshot({ path: path.join(SHOTS, "가로_844x390_게임.png") });
  const frames1 = await page.evaluate(() => window.webgba.player.frames);
  ok(".gba 프레임이 돈다", frames0 !== frames1 || (await page.evaluate(() => window.webgba.player.running)));
  ok(".gba 시험 중 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

async function testPortSaveOffline() {
  const { context, page } = await newPage({ viewport: { width: 1280, height: 800 }, touch: true });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1" && navigator.serviceWorker.controller);
  ok("서비스 워커가 페이지를 맡음", await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await chooseFiles(page, "#startOpen", [opt.wgba]);
  await waitGame(page, 90000);
  const game = await page.evaluate(() => window.webgba.state.game);
  ok(".wgba 열기(내장 롬)", game?.type === "wgba", JSON.stringify(game));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, "데스크톱_1280x800_게임.png") });
  const calls = await page.evaluate(async () => {
    const host = window.webgba.player.host;
    window.__pointer = [];
    const original = host.pointer.bind(host);
    host.pointer = (x, y, buttons, wheel) => {
      window.__pointer.push([x, y, buttons, wheel]);
      original(x, y, buttons, wheel);
    };
    return { has: host.hasPointer, wantedExport: typeof host.ex.Web_PointerWanted === "function" };
  });
  const r = await rects(page);
  await page.touchscreen.tap(r.screen.x, r.screen.y);
  await page.waitForTimeout(200);
  const pointer = await page.evaluate(() => window.__pointer);
  const down = pointer.find((c) => c[2] === 1);
  ok("포인터 wasm: 화면 터치 → Web_Pointer(게임 좌표, 누름·뗌)", calls.has && calls.wantedExport && down && down[0] >= 100 && down[0] <= 140 && down[1] >= 60 && down[1] <= 100 && pointer.some((c) => c[2] === 0), JSON.stringify(pointer.slice(0, 4)));
  const savBytes = fs.readFileSync(opt.sav);
  await filesMenu(page);
  await page.click("#btnSaves");
  await chooseFiles(page, '[data-action="import-current"]', [opt.sav]);
  await page.click("#dialogActions .btn--primary");
  await page.waitForFunction(() => /가져왔습니다/.test(document.getElementById("toast").textContent) && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 90000 });
  const stored = await page.evaluate(async () => {
    const id = window.webgba.state.game.saveId;
    const bytes = await window.webgba.store.saveBytes(id);
    return { id, size: bytes?.length ?? 0, hex: bytes ? Array.from(bytes.slice(0, 64)).join(",") : "" };
  });
  ok(".sav 불러오기 → save 기록 덮어씀", stored.size === savBytes.length && stored.hex === Array.from(savBytes.subarray(0, 64)).join(","), `${stored.size}`);
  const modified = await page.evaluate(async () => {
    const p = window.webgba.player;
    const at = p.host.ex.Web_GetFlash() >>> 0;
    p.host.u8[at + 0x7f000] ^= 0x5a;
    p.queueSave();
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const bytes = await window.webgba.store.saveBytes(p.game);
    return { byte: bytes[0x7f000], live: p.host.u8[at + 0x7f000] };
  });
  ok("세이브 자동 보관(저장 신호 뒤 약 1초)", modified.byte === modified.live, JSON.stringify(modified));
  const hidden = await page.evaluate(async () => {
    const p = window.webgba.player;
    const at = p.host.ex.Web_GetFlash() >>> 0;
    p.host.u8[at + 0x7f001] ^= 0x33;
    p.queueSave();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const bytes = await window.webgba.store.saveBytes(p.game);
    const paused = p.paused;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return { byte: bytes[0x7f001], live: p.host.u8[at + 0x7f001], paused };
  });
  ok("화면 숨김 → 바로 보관·일시정지", hidden.byte === hidden.live && hidden.paused, JSON.stringify(hidden));
  const live = await page.evaluate(() => Array.from(window.webgba.player.host.saveData()));
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="export-current"]')]);
  const downloaded = fs.readFileSync(await download.path());
  ok("세이브 내보내기(.sav = 지금 세이브)", download.suggestedFilename().endsWith(".sav") && sha1(downloaded) === sha1(Buffer.from(live)), download.suggestedFilename());
  await page.click("#sheetClose");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.click("#startList .item__main");
  await waitGame(page, 90000);
  const after = await page.evaluate(async () => {
    const bytes = await window.webgba.store.saveBytes(window.webgba.state.game.saveId);
    return [bytes[0x7f000], bytes[0x7f001], window.webgba.player.host.saveData()[0x7f000]];
  });
  ok("새로고침 뒤 이어서 하기 · 세이브 유지", after[0] === modified.byte && after[1] === hidden.byte && after[2] === modified.byte, after.join(","));
  await filesMenu(page);
  await page.click("#btnLibrary");
  await page.waitForSelector('.list[data-kind="rom"] .item');
  const romActions = await page.$$eval('.list[data-kind="rom"] [data-action]', (nodes) => nodes.map((n) => n.dataset.action));
  ok("롬 기록은 내려받을 수 없음(목록에 내보내기 없음)", romActions.every((a) => a === "rename" || a === "delete"), romActions.join(","));
  await page.click("#sheetClose");
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 15000 });
  ok("오프라인 다시 열기(앱 화면)", true);
  await page.click("#startList .item__main");
  await waitGame(page, 90000).then(
    () => ok("오프라인에서 보관한 게임 열기", true),
    () => ok("오프라인에서 보관한 게임 열기", false),
  );
  await context.setOffline(false);
  ok("포트 시험 중 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

async function testPatch() {
  const results = [];
  for (const [index, base] of opt.base.entries()) {
    const { context, page } = await newPage({ viewport: { width: 390, height: 844 }, mobile: true, touch: true });
    await chooseFiles(page, "#startOpen", [opt.wgbp]);
    await page.waitForSelector('#dialog:not([hidden]) [data-action="pick-rom"]');
    await chooseFiles(page, '[data-action="pick-rom"]', [base]);
    await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
    const defaultName = await page.inputValue(".dialog__input");
    const name = `시험 ${index + 1}`;
    await page.fill(".dialog__input", "bad/name");
    await page.click('[data-action="name-ok"]');
    const hint = await page.textContent(".dialog__hint");
    await page.fill(".dialog__input", name);
    await page.evaluate(() => {
      window.__frames = [];
      const loop = (now) => {
        const loader = document.querySelector(".loader");
        window.__frames.push([now, loader ? Number(loader.dataset.percent ?? 0) : -1, loader?.dataset.stage ?? ""]);
        if (window.__frames.length < 20000 && document.body.dataset.view !== "game") requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.click('[data-action="name-ok"]');
    await page.waitForSelector(".loader", { timeout: 5000 });
    if (index === 0) {
      await page.waitForFunction(() => Number(document.querySelector(".loader")?.dataset.percent ?? 0) > 20, null, { timeout: 60000 }).catch(() => {});
      await page.screenshot({ path: path.join(SHOTS, "세로_390x844_패치로더.png") });
    }
    await waitGame(page, 180000);
    const frames = await page.evaluate(() => window.__frames);
    const live = frames.filter((f) => f[1] >= 0);
    let maxGap = 0;
    for (let i = 1; i < live.length; i++) maxGap = Math.max(maxGap, live[i][0] - live[i - 1][0]);
    const stages = [...new Set(live.map((f) => f[2]).filter(Boolean))];
    const distinct = new Set(live.map((f) => Math.floor(f[1]))).size;
    const info = await page.evaluate(async () => {
      const roms = await window.webgba.store.list("rom");
      return { roms: roms.map((r) => ({ id: r.id, name: r.name, sha1: r.sha1, type: r.type })), game: window.webgba.state.game };
    });
    const made = info.roms.find((r) => r.name === name);
    results.push(made?.sha1);
    ok(`패치(${path.basename(base)}): 기본 이름 = .wgbp 이름`, defaultName === path.basename(opt.wgbp).replace(/\.wgbp$/i, ""), defaultName);
    ok(`패치(${path.basename(base)}): 쓸 수 없는 글자 막음`, Boolean(hint && hint.trim()), hint);
    ok(`패치(${path.basename(base)}): 로더 단계 모두 지남`, ["check", "patch", "verify", "pack", "store", "open"].every((s) => stages.includes(s)), stages.join(","));
    ok(`패치(${path.basename(base)}): 막대가 멈추지 않음(프레임 간격 최대 ${Math.round(maxGap)}ms · ${distinct}단계 값)`, maxGap < 250 && distinct >= 20);
    ok(`패치(${path.basename(base)}): 그 이름으로 보관·실행`, made && info.game?.name === name && made.type === "wgba", JSON.stringify(made));
    if (index === 0) {
      await page.evaluate(async () => {
        const p = window.webgba.player;
        p.host.u8[(p.host.ex.Web_GetFlash() >>> 0) + 0x10] ^= 0x77;
        p.queueSave();
        await new Promise((resolve) => setTimeout(resolve, 1500));
      });
      const saveBefore = await page.evaluate(async () => (await window.webgba.store.list("save")).map((s) => s.key));
      await filesMenu(page);
  await page.click("#btnLibrary");
      await page.waitForSelector('.list[data-kind="rom"] [data-action="rename"]');
      await page.click('.list[data-kind="rom"] [data-action="rename"]');
      await page.fill(".dialog__input", "새 이름");
      await page.click('[data-action="name-ok"]');
      await page.waitForTimeout(500);
      const renamed = await page.evaluate(async () => {
        const roms = await window.webgba.store.list("rom");
        const saves = await window.webgba.store.list("save");
        return { roms: roms.map((r) => [r.key, r.name]), saves: saves.map((s) => [s.key, s.game]) };
      });
      const romKey = renamed.roms.find((r) => r[1] === "새 이름")?.[0] ?? "";
      ok("이름 바꾸기: 표시 이름만 바뀌고 키·세이브 짝 유지", romKey && renamed.saves.some((s) => s[0] === romKey.replace(/^rom:/, "save:") && s[1] === "새 이름") && saveBefore.includes(romKey.replace(/^rom:/, "save:")), JSON.stringify(renamed));
      await page.click("#sheetClose");
      await filesMenu(page);
      await chooseFiles(page, "#btnOpen", [opt.wgbp]);
      await waitGame(page, 90000);
      const toast = await page.textContent("#toast");
      ok("같은 결과가 있으면 로더 없이 바로 엶", /이미 만든/.test(toast) && !(await page.$(".loader")), toast);
      await page.evaluate(async () => {
        for (const rom of await window.webgba.store.list("rom")) await window.webgba.store.patch(rom.key, { sha1: "x" });
      });
      await filesMenu(page);
      await chooseFiles(page, "#btnOpen", [opt.wgbp]);
      await page.waitForSelector('#dialog:not([hidden]) [data-action="pick-rom"]');
      await chooseFiles(page, '[data-action="pick-rom"]', [base]);
      await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
      await page.fill(".dialog__input", "새 이름");
      await page.click('[data-action="name-ok"]');
      const taken = await page.waitForSelector('#dialog:not([hidden]) [data-action="name-overwrite"]', { timeout: 5000 }).then(() => true, () => false);
      ok("같은 이름이면 덮어쓰기/다른 이름 확인 창", taken);
      if (taken) {
        await page.click('[data-action="name-overwrite"]');
        await waitGame(page, 180000);
        const over = await page.evaluate(async () => ({ roms: (await window.webgba.store.list("rom")).map((r) => [r.key, r.name]), game: window.webgba.state.game }));
        ok("덮어쓰기는 같은 키(세이브 짝 유지)", over.game.key === romKey && over.roms.filter((r) => r[1] === "새 이름").length === 1, JSON.stringify(over.roms));
      }
    }
    ok(`패치(${path.basename(base)}) 중 페이지 오류 없음`, page.errors.length === 0, page.errors.join(" | "));
    await context.close();
  }
  if (results.length > 1) ok("세 롬 모두 같은 결과 SHA-1", results.every((value) => value && value === results[0]), results.map((v) => String(v).slice(0, 8)).join(","));
}

async function testUpdateNotice() {
  const dist = opt.dist;
  if (!dist) return;
  const { context, page } = await newPage();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1" && navigator.serviceWorker.controller);
  const file = path.join(dist, "sw.js");
  const original = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, original.replace(/const VERSION = "([^"]+)"/, 'const VERSION = "$1-next"'));
    await page.evaluate(() => window.webgba.state.reg.update());
    const shown = await page.waitForSelector("#notice:not([hidden])", { timeout: 15000 }).then(() => true, () => false);
    ok("새 버전 알림", shown);
    if (shown) {
      await Promise.all([page.waitForEvent("load", { timeout: 15000 }), page.click("#noticeGo")]);
      await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
      ok("알림 누르면 새 버전으로 다시 불러옴", true);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
  await context.close();
}

async function testLang() {
  const { context, page } = await newPage();
  await page.click("#btnSettings");
  await page.selectOption('select[aria-label="표시 언어"]', "en");
  await page.waitForTimeout(300);
  const en = await page.getAttribute("#btnOpen", "title");
  await page.selectOption('select[aria-label="Display language"]', "ja").catch(() => {});
  await page.waitForTimeout(300);
  const ja = await page.getAttribute("#btnOpen", "title");
  ok("언어 바꾸기(영어·일본어)", /Open/.test(en) && /開く/.test(ja), `${en} / ${ja}`);
  await context.close();
}

const tests = { head: testHeadAndInstall, pad: testPad, gba: testGba, port: testPortSaveOffline, patch: testPatch, update: testUpdateNotice, lang: testLang };
for (const [name, run] of Object.entries(tests)) {
  if (!want(name)) continue;
  try {
    await run();
  } catch (error) {
    ok(`${name} 시험 중 예외`, false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" "));
  }
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
fs.writeFileSync(path.join(SHOTS, "결과.json"), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
