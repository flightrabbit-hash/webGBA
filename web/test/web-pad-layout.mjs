// 직접 배치(패드 자율배치 에디터) 조작부 시험(헤드리스, 로컬 서버 tools/test/mp-local.mjs 가 web/dist 를 내줌, 롬 없는 예제만).
//   node web/test/web-pad-layout.mjs [--dist <web/dist>] [--engine chromium|webkit] [--only soft] [--shots <캡처 폴더>]
// soft = 숫자 키패드 위 "-" 알약 = 소프트 키(.wmba soft1·soft2, 휴대폰 왼쪽·오른쪽 소프트 키)가 키패드와 따로인 조작부:
//        편집 테두리·이름 따로 · 끌어 옮기기·크기 따로(키패드 크기를 바꿔도 그대로) · 레이아웃 키 "dir,keypad" 그대로 ·
//        저장 → 다시 열기 그 자리 · 예전 저장(키패드만 있음) = 기본 자리 + 키패드 크기 · 두 소프트 키가 한 자리에 겹치지 않음.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startLocal } from "../../tools/test/mp-local.mjs";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const ENGINE = opt.engine ?? "chromium";
const ONLY = new Set(String(opt.only ?? "soft").split(","));
const SHOTS = opt.shots ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const pw = require("playwright-core");
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const examples = fileURLToPath(new URL("../../docs/wgba/examples/", import.meta.url));
const read = (name, file) => fs.readFileSync(path.join(examples, name, file));
const pack = async (name, patch = {}) => {
  const manifest = { ...JSON.parse(read(name, "manifest.json")), ...patch };
  const js = fs.existsSync(path.join(examples, name, "game.js")) ? read(name, "game.js") : null;
  return Buffer.from((await packWgba({ wasm: read(name, "game.wasm"), manifest, ...(js ? { js } : {}) })).bytes);
};
// .wmba 와 같은 설명서(방향·소프트 키·숫자 키패드, 세로 화면).
const MOBILE = { preset: "none", dpad: "both", buttons: [["OK", "ok", "Enter"], ["CLR", "clear", "Backspace"], ["SOFT1", "soft1", "BracketLeft"], ["SOFT2", "soft2", "BracketRight"], ["RIGHT", "right", "ArrowRight"], ["LEFT", "left", "ArrowLeft"], ["UP", "up", "ArrowUp"], ["DOWN", "down", "ArrowDown"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => [`N${n}`, `num${n}`, `Digit${n}`]), ["STAR", "star", "NumpadMultiply"], ["HASH", "hash", "NumpadDivide"]].map(([id, role, code]) => ({ id, role, code })) };
const GAME = { file: "pl-mob.wmba", bytes: await pack("hello-script", { id: "com.example.padlayout", input: MOBILE, screen: { width: 240, height: 320 }, group: "mobile" }) };

const dist = opt.dist ? path.resolve(opt.dist) : undefined;
const local = await startLocal(dist ? { dist } : {});
const launchOpt = ENGINE === "webkit" ? { headless: true } : { executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true };
const browser = await pw[ENGINE].launch(launchOpt);
const errors = [];

async function newPage({ width, height, prefs = {} }) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (!localStorage.getItem("webgba.prefs")) localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko", pad: "on", padSet: true, ...prefs }));
    // 합성 포인터(시험)는 실제 포인터가 아니라 setPointerCapture 가 예외를 낸다 — 시험에서만 무시.
    Element.prototype.setPointerCapture = function () {};
  }, prefs);
  await context.route(`**/${GAME.file}`, (route) => route.fulfill({ body: GAME.bytes, contentType: "application/octet-stream" }));
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    if (!/r2\.dev|[Ss]ervice ?[Ww]orker/.test(e.message)) errors.push(e.message);
  });
  await page.goto(local.base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page };
}

async function openGame(page) {
  await page.evaluate(async (file) => {
    const buf = await (await fetch(`/${file}`)).arrayBuffer();
    await window.webgba.openFiles([new File([buf], file)]);
  }, GAME.file);
  await page.waitForFunction(() => window.webgba.state.game && !window.webgba.state.opening, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

async function closeGame(page) {
  await page.evaluate(() => window.webgba.closeGame());
  await page.waitForTimeout(200);
}

// 조작부 상자(.app 기준 px)·가운데 비율.
const boxes = (page) => page.evaluate(() => {
  const app = document.getElementById("app").getBoundingClientRect();
  const sel = { dir: "[data-dpad]", keypad: ".keypad", soft1: ".key--soft1", soft2: ".key--soft2", screen: ".stage", n1: '.keypad [data-key="N1"]' };
  const out = {};
  for (const [id, s] of Object.entries(sel)) {
    const n = document.querySelector(s);
    if (!n || n.offsetParent === null) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1) continue;
    out[id] = { l: r.left - app.left, t: r.top - app.top, w: r.width, h: r.height, cx: +((r.left + r.width / 2 - app.left) / app.width).toFixed(3), cy: +((r.top + r.height / 2 - app.top) / app.height).toFixed(3) };
  }
  return out;
});
const overlap = (a, b) => a && b && a.l < b.l + b.w && b.l < a.l + a.w && a.t < b.t + b.h && b.t < a.t + a.h;
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// 편집 테두리에서 합성 포인터로 끌기(손가락 흉내). target = 테두리(move) 또는 손잡이.
const drag = (page, id, kind, dx, dy) => page.evaluate(async ({ id, kind, dx, dy }) => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const ed = window.webgba.padEditor;
  ed.select(id);
  await frame();
  const box = document.querySelector(`.padedit__sel[data-ctl="${id}"]`);
  const target = kind === "move" ? box : box.querySelector(kind === "resize" ? ".padedit__handle" : `.padedit__handle--${kind === "resize-x" ? "x" : "y"}`);
  const r = target.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const fire = (type, node, px, py) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true, clientX: px, clientY: py }));
  fire("pointerdown", target, x, y);
  for (let i = 1; i <= 8; i++) {
    fire("pointermove", window, x + (dx * i) / 8, y + (dy * i) / 8);
    await frame();
  }
  fire("pointerup", window, x + dx, y + dy);
  await frame();
  return { x, y };
}, { id, kind, dx, dy });

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);

async function softChecks(view) {
  const key = `${ENGINE} ${view.label}`;
  const { context, page } = await newPage(view);
  try {
    await openGame(page);
    const plain = await boxes(page);
    await page.evaluate(() => window.webgba.padEditor.startEdit(innerWidth > innerHeight));
    await page.waitForTimeout(150);
    const frames = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".padedit__sel")].map((n) => [n.dataset.ctl, n.dataset.label])));
    const sig = await page.evaluate(() => window.webgba.padEditor.sig);
    ok(`${key}: 편집 — 소프트 키 둘이 따로 테두리(소프트 L·소프트 R) · 키패드 테두리와 별개 · 레이아웃 키 그대로 dir,keypad`, frames.soft1 === "소프트 L" && frames.soft2 === "소프트 R" && frames.keypad === "키패드" && sig === "dir,keypad", JSON.stringify({ frames, sig }));
    const start = await boxes(page);
    ok(`${key}: 편집 시작 자리 = 기본 자리(소프트 키 둘이 서로 겹치지 않음)`, ["soft1", "soft2", "keypad"].every((id) => near(start[id].cx, plain[id].cx) && near(start[id].cy, plain[id].cy)) && !overlap(start.soft1, start.soft2), JSON.stringify({ plain: [plain.soft1, plain.soft2], start: [start.soft1, start.soft2] }));
    // 키패드를 크게 → 소프트 키 크기 그대로
    await drag(page, "keypad", "resize", -40, 40);
    const grown = await boxes(page);
    ok(`${key}: 키패드 크기를 키워도 소프트 키 크기·자리 그대로(키패드 ${Math.round(start.keypad.w)}→${Math.round(grown.keypad.w)}px)`, grown.keypad.w > start.keypad.w + 4 && ["soft1", "soft2"].every((id) => near(grown[id].w, start[id].w, 0.5) && near(grown[id].cx, start[id].cx) && near(grown[id].cy, start[id].cy)), JSON.stringify({ soft1: [start.soft1.w, grown.soft1.w], soft2: [start.soft2.w, grown.soft2.w] }));
    // 소프트 R 을 따로 옮기고 크게 → 키패드 그대로
    const dx = view.width > view.height ? -120 : -90;
    await drag(page, "soft2", "move", dx, 60);
    await drag(page, "soft2", "resize", -24, 24);
    const moved = await boxes(page);
    ok(`${key}: 소프트 R 만 끌어 옮기고 크기 키움 → 키패드·소프트 L 그대로`, moved.soft2.w > grown.soft2.w + 2 && !near(moved.soft2.cx, grown.soft2.cx, 0.03) && near(moved.keypad.cx, grown.keypad.cx) && near(moved.keypad.w, grown.keypad.w, 0.5) && near(moved.soft1.cx, grown.soft1.cx), JSON.stringify({ soft2: [grown.soft2, moved.soft2], keypad: moved.keypad.w }));
    await shot(page, `soft_edit_${ENGINE}_${view.label}`);
    await page.evaluate(() => window.webgba.padEditor.save());
    await page.waitForTimeout(150);
    const saved = await boxes(page);
    const stored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("webgba.prefs")).padLayout ?? {}));
    ok(`${key}: 저장 키 = dir,keypad 하나(소프트 키는 그 안에 따로 기록)`, stored.length === 1 && stored[0] === "dir,keypad", stored.join("|"));
    await closeGame(page);
    await openGame(page);
    const again = await boxes(page);
    ok(`${key}: 다시 열기 — 소프트 R 은 옮긴 자리·크기, 키패드·소프트 L 도 저장 자리`, ["soft1", "soft2", "keypad", "dir"].every((id) => near(again[id].cx, saved[id].cx) && near(again[id].cy, saved[id].cy) && near(again[id].w, saved[id].w, 0.5)), JSON.stringify({ saved: saved.soft2, again: again.soft2 }));
    await shot(page, `soft_reopen_${ENGINE}_${view.label}`);
  } finally {
    await context.close();
  }
}

// 예전 저장(소프트 키가 키패드에 묶였던 때: 키패드 크기 1.25 — 소프트 키도 1.25 로 그려졌음).
async function legacyChecks(view) {
  const key = `${ENGINE} ${view.label}`;
  const landscape = view.width > view.height;
  const orient = landscape ? "landscape" : "portrait";
  const base = await (async () => {
    const { context, page } = await newPage(view);
    try {
      await openGame(page);
      return await boxes(page);
    } finally {
      await context.close();
    }
  })();
  const padLayout = { "dir,keypad": { [orient]: { controls: { dir: { x: 0.25, y: landscape ? 0.6 : 0.78 }, keypad: { x: 0.72, y: landscape ? 0.6 : 0.8, scale: 1.25 } } } } };
  const { context, page } = await newPage({ ...view, prefs: { padPlacement: "custom", padLayout } });
  try {
    await openGame(page);
    const got = await boxes(page);
    const free = await page.evaluate(() => document.body.hasAttribute("data-pad-free"));
    const ratio = (id) => got[id].w / base[id].w;
    // 기본 자리 = 격자 칸(소프트 L 은 왼쪽 끝, 소프트 R 은 오른쪽 끝에 맞춤 · 세로는 가운데(세로 화면)·위 맞춤(가로 화면))
    // — 커진 만큼 안쪽·아래로 자란다.
    const edges = Math.abs(got.soft1.l - base.soft1.l) <= 2 && Math.abs(got.soft2.l + got.soft2.w - (base.soft2.l + base.soft2.w)) <= 2;
    const rows = ["soft1", "soft2"].every((id) => (landscape ? Math.abs(got[id].t - base[id].t) <= 2 : near(got[id].cy, base[id].cy)));
    ok(`${key}: 예전 저장 배치(키패드만, 크기 125%) — 직접 배치 적용 · 소프트 키 = 기본 자리(양 끝 맞춤) · 크기는 키패드 크기(약 125%) 그대로`, free && edges && rows && ["soft1", "soft2"].every((id) => Math.abs(ratio(id) - 1.25) < 0.12) && !overlap(got.soft1, got.soft2), JSON.stringify({ base: [base.soft1, base.soft2], got: [got.soft1, got.soft2] }));
    await shot(page, `soft_legacy_${ENGINE}_${view.label}`);
  } finally {
    await context.close();
  }
}

const VIEWS = [{ label: "세로", width: 390, height: 844 }, { label: "가로", width: 844, height: 390 }];
try {
  if (ONLY.has("soft")) {
    for (const view of VIEWS) {
      await softChecks(view);
      await legacyChecks(view);
    }
  }
  ok("페이지 오류 없음", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await local.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
