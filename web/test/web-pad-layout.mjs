// 직접 배치(패드 자율배치 에디터) 조작부 시험(헤드리스, 로컬 서버 tools/test/mp-local.mjs 가 web/dist 를 내줌, 롬 없는 예제만).
//   node web/test/web-pad-layout.mjs [--dist <web/dist>] [--engine chromium|webkit] [--only soft] [--shots <캡처 폴더>]
// soft = 숫자 키패드 위 "-" 알약 = 소프트 키(.wmba soft1·soft2, 휴대폰 왼쪽·오른쪽 소프트 키)가 키패드와 따로인 조작부:
//        편집 테두리·이름 따로 · 끌어 옮기기·크기 따로(키패드 크기를 바꿔도 그대로) · 레이아웃 키 "dir,keypad" 그대로 ·
//        저장 → 다시 열기 그 자리 · 예전 저장(키패드만 있음) = 기본 자리 + 키패드 크기 · 두 소프트 키가 한 자리에 겹치지 않음.
// stretch = 자유 비율(가로·세로 따로): 변 손잡이로 키패드를 화면 가로 100%(가로 화면은 상한 400%) · 세로를 바꿔도 가로 그대로 ·
//        키는 칸 수로 늘어 픽셀 그대로(캔버스 css 크기 × dpr = 캔버스 픽셀, 배율 정수) · 크기 표시·"원래 비율" · 저장 → 다시 열기 같은 상자 ·
//        누르는 자리(pad.measure)도 늘어난 키 · 방향 조작부 가로만 늘이기(그림 그대로·상자만) · 화면은 변 손잡이 없음 ·
//        카드 한 줄 버튼·값 위·아래 일치, 글자 잉크 세로 가운데(1 기기 픽셀 이내).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startLocal } from "../../tools/test/mp-local.mjs";
import { decodePng } from "./png.mjs";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const ENGINE = opt.engine ?? "chromium";
const ONLY = new Set(String(opt.only ?? "soft,stretch").split(","));
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
  // 예제 게임(hello-script)이 격리 틀 안에서 localStorage 를 읽다 나는 오류·R2·SW 차단은 시험 대상 밖.
  page.on("pageerror", (e) => {
    if (!/r2\.dev|[Ss]ervice ?[Ww]orker|sandboxed/.test(e.message)) errors.push(e.message);
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

// 키 캔버스가 css 로 늘려지지 않았는지(픽셀 그대로): css 크기 × dpr = 캔버스 픽셀, 캔버스 폭 = 아트 칸 수 × 정수 배율.
const crisp = (page, sel) => page.evaluate((sel) => {
  const c = document.querySelector(`${sel} canvas`);
  const r = c.getBoundingClientRect();
  return { w: c.width, h: c.height, cssW: r.width, cssH: r.height, dpr: devicePixelRatio, ok: Math.abs(r.width * devicePixelRatio - c.width) < 0.6 && Math.abs(r.height * devicePixelRatio - c.height) < 0.6 };
}, sel);

const INK = 48;
function inkRows(image, dpr, box) {
  const x0 = Math.round(box.left * dpr) + 2;
  const x1 = Math.round(box.right * dpr) - 2;
  const y0 = Math.round(box.top * dpr);
  const y1 = Math.round(box.bottom * dpr);
  const at = (x, y) => (y * image.width + x) * 4;
  const counts = new Map();
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const o = at(x, y);
    const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bg = 0;
  let best = -1;
  for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
  const rgb = [bg >> 16, (bg >> 8) & 255, bg & 255];
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = at(x, y);
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(image.data[o + c] - rgb[c]))) > INK) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  return first < 0 ? null : { top: first - y0, bottom: y1 - 1 - last };
}

// 카드 크기 줄: −·값·+ 위·아래 일치, 값·버튼 글자 잉크 세로 가운데 · "원래 비율" 버튼 글자 잉크 세로 가운데.
async function cardMeasure(page, key) {
  const parts = await page.evaluate(() => {
    const b = (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const row = document.querySelector(".padedit__card .padedit__row:not(.padedit__row--color):not(.padedit__row--ratio)");
    return { btns: [...row.querySelectorAll(".padedit__cardbtn")].map(b), val: b(row.querySelector(".padedit__val")), ratio: document.querySelector(".padedit__ratio") ? b(document.querySelector(".padedit__ratio")) : null, auto: b(document.querySelector(".padedit__auto")), text: row.querySelector(".padedit__val").textContent };
  });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const png = await page.screenshot();
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, `card_${key.replace(/ /g, "_")}.png`), png);
  const image = decodePng(png);
  const sameRow = parts.btns.every((x) => Math.abs(x.top - parts.btns[0].top) < 0.01 && Math.abs(x.bottom - parts.btns[0].bottom) < 0.01);
  // 버튼 안쪽 2px 테두리(outline-offset −2px)는 빼고 잰다 — 값은 같은 줄 버튼의 안쪽 높이에서.
  const inner = (b) => ({ left: b.left + 3, right: b.right - 3, top: b.top + 3, bottom: b.bottom - 3 });
  const row = parts.btns[0] && inner(parts.btns[0]);
  const inkOf = (box) => {
    const r = inkRows(image, dpr, box);
    return r ? r.top - r.bottom : null;
  };
  const ink = [...parts.btns.map(inner), row && { left: parts.val.left, right: parts.val.right, top: row.top, bottom: row.bottom }, parts.ratio && inner(parts.ratio)].filter(Boolean).map(inkOf);
  // 기준 = 이미 있던 "자동" 버튼(같은 글꼴·여백). Chromium 은 기준·새 요소 모두 1 이내, WebKit(Windows 헤드리스)은 글자를 모두
  // 같은 만큼 위에 그려(엔진 차이) 기준과 1 이내로 같은지 본다.
  const ref = inkOf(inner(parts.auto));
  const fine = ENGINE === "webkit" ? (d) => ref !== null && Math.abs(d - ref) <= 1 : (d) => Math.abs(d) <= 1;
  ok(`${key}: 카드 크기 줄 "${parts.text}" — −·+ 위·아래 일치 · −·+·값·"원래 비율" 글자 잉크 세로 가운데(위−아래 ${ink.join("/")} 기기 픽셀, 기준 "자동" ${ref})`, sameRow && Boolean(parts.ratio) && ink.every((d) => d !== null && fine(d)) && (ENGINE === "webkit" || Math.abs(ref) <= 1), JSON.stringify({ ink, ref, parts }));
}

async function stretchChecks(view) {
  const key = `${ENGINE} ${view.label}`;
  const { context, page } = await newPage(view);
  try {
    await openGame(page);
    await page.evaluate(() => window.webgba.padEditor.startEdit(innerWidth > innerHeight));
    await page.waitForTimeout(150);
    const handles = await page.evaluate(() => {
      window.webgba.padEditor.select("screen");
      const screen = document.querySelector('.padedit__sel[data-ctl="screen"]');
      const n = screen.querySelectorAll(".padedit__handle--x, .padedit__handle--y").length;
      window.webgba.padEditor.select("keypad");
      const kp = document.querySelector('.padedit__sel[data-ctl="keypad"]');
      return { screen: n, keypad: [...kp.querySelectorAll(".padedit__handle")].filter((h) => !h.hidden).length };
    });
    ok(`${key}: 손잡이 — 키패드는 모서리(같은 비율)·가로 변·세로 변 3개, 게임 화면은 변 손잡이 없음(비율 지킴)`, handles.keypad === 3 && handles.screen === 0, JSON.stringify(handles));
    const start = await boxes(page);
    const appW = view.width;
    const keyW0 = start.n1.w;
    // 가로 변 손잡이를 반대쪽 화면 끝 너머까지 → 화면 가로 100%(가로 화면은 상한 400%)
    const dx = view.width > view.height ? -900 : -400;
    await drag(page, "keypad", "resize-x", dx, 0);
    const wide = await boxes(page);
    const wantW = Math.min(appW, start.keypad.w * 4);
    const keyCanvas = await crisp(page, '.keypad [data-key="N5"]');
    ok(`${key}: 키패드 가로 변 → 가로 ${Math.round((wide.keypad.w / appW) * 100)}%(기대 ${Math.round((wantW / appW) * 100)}%) · 세로 그대로 · 화면 안`, Math.abs(wide.keypad.w - wantW) <= 1.5 && Math.abs(wide.keypad.h - start.keypad.h) <= 1 && wide.keypad.l >= -0.5 && wide.keypad.l + wide.keypad.w <= appW + 0.5, JSON.stringify({ start: start.keypad, wide: wide.keypad }));
    ok(`${key}: 키가 칸 수로 늘어 픽셀 그대로(키 ${Math.round(keyW0)}→${Math.round(wide.n1.w)}px, 캔버스 ${keyCanvas.w}×${keyCanvas.h} = css×dpr)`, wide.n1.w > keyW0 * 1.6 && keyCanvas.ok, JSON.stringify(keyCanvas));
    await shot(page, `stretch_wide_${ENGINE}_${view.label}`);
    // 세로 변 손잡이 → 세로만 늘이기, 가로 그대로(키패드 상자 = 기본 × sx·sy)
    await drag(page, "keypad", "resize-y", 0, view.width > view.height ? -40 : -70);
    const tall = await boxes(page);
    const rec = await page.evaluate(() => ({ ...window.webgba.padEditor.work.controls.keypad }));
    ok(`${key}: 키패드 세로 변 → 세로만 커짐(${Math.round(wide.keypad.h)}→${Math.round(tall.keypad.h)}px) · 가로는 그대로(${Math.round(tall.keypad.w)}px)`, tall.keypad.h > wide.keypad.h + 10 && Math.abs(tall.keypad.w - wide.keypad.w) <= 1.5 && Number.isFinite(rec.sx) && rec.sy > 1, JSON.stringify(rec));
    const badge = await page.evaluate(() => document.querySelector('.padedit__sel[data-ctl="keypad"] .padedit__badge').textContent);
    ok(`${key}: 배지·카드에 가로×세로 크기("${badge}")`, /^키패드 \d+×\d+%$/.test(badge), badge);
    await cardMeasure(page, key);
    // 방향: 가로만 늘이면 그림은 그대로, 상자(누르는 자리)만 넓어짐
    const dir0 = await crisp(page, "[data-dpad]");
    await drag(page, "dir", "resize-x", view.width > view.height ? 60 : 50, 0);
    const dir1 = await boxes(page);
    const dirRec = await page.evaluate(() => ({ ...window.webgba.padEditor.work.controls.dir }));
    ok(`${key}: 방향 가로 변 → 상자 가로만 넓어짐(${Math.round(start.dir.w)}→${Math.round(dir1.dir.w)}px, 세로 ${Math.round(dir1.dir.h)}px 그대로)`, dir1.dir.w > start.dir.w + 20 && Math.abs(dir1.dir.h - start.dir.h) <= 1 && dirRec.sx > dirRec.sy, JSON.stringify({ dirRec, dir0: dir0.w }));
    // "원래 비율" → 방향은 같은 비율로 돌아감
    await page.evaluate(() => document.querySelector(".padedit__ratio").click());
    const dirBack = await page.evaluate(() => ({ ...window.webgba.padEditor.work.controls.dir }));
    const dir2 = await boxes(page);
    ok(`${key}: "원래 비율" → 같은 비율(sx·sy 지움, 상자 ${Math.round(dir2.dir.w)}×${Math.round(dir2.dir.h)})`, !("sx" in dirBack) && !("sy" in dirBack) && Math.abs(dir2.dir.w - dir2.dir.h) <= 1.5 && !(await page.evaluate(() => Boolean(document.querySelector(".padedit__ratio")))), JSON.stringify(dirBack));
    await page.evaluate(() => window.webgba.padEditor.save());
    await page.waitForTimeout(150);
    const saved = await boxes(page);
    const stored = await page.evaluate(() => {
      const lay = JSON.parse(localStorage.getItem("webgba.prefs")).padLayout["dir,keypad"];
      return lay[innerWidth > innerHeight ? "landscape" : "portrait"].controls.keypad;
    });
    ok(`${key}: 저장 = 키패드 { scale, sx, sy }`, Number.isFinite(stored.sx) && Number.isFinite(stored.sy) && Number.isFinite(stored.scale), JSON.stringify(stored));
    await closeGame(page);
    await openGame(page);
    const again = await boxes(page);
    const measured = await page.evaluate(() => {
      const pad = window.webgba.pad;
      pad.invalidate();
      const k = pad.measure().keys.find((x) => x.name === "N5");
      const r = document.querySelector('.keypad [data-key="N5"]').getBoundingClientRect();
      return { touch: [k.box.width, k.box.height], dom: [r.width, r.height] };
    });
    ok(`${key}: 다시 열기 — 키패드 상자 같음(${Math.round(again.keypad.w)}×${Math.round(again.keypad.h)}) · 누르는 자리도 늘어난 키(${measured.touch.map(Math.round).join("×")})`, Math.abs(again.keypad.w - saved.keypad.w) <= 1 && Math.abs(again.keypad.h - saved.keypad.h) <= 1 && near(again.keypad.cx, saved.keypad.cx) && Math.abs(measured.touch[0] - measured.dom[0]) < 0.5 && measured.touch[0] > keyW0 * 1.6, JSON.stringify({ saved: saved.keypad, again: again.keypad, measured }));
  } finally {
    await context.close();
  }
}

// 예전 저장(같은 비율 scale 만) → 같은 비율 그대로(상자 가로:세로 = 기본 가로:세로).
async function stretchLegacyCheck(view) {
  const key = `${ENGINE} ${view.label}`;
  const landscape = view.width > view.height;
  const orient = landscape ? "landscape" : "portrait";
  const padLayout = { "dir,keypad": { [orient]: { controls: { keypad: { x: 0.7, y: landscape ? 0.6 : 0.8, scale: 1.25 } } } } };
  const plain = await (async () => {
    const { context, page } = await newPage(view);
    try {
      await openGame(page);
      return await boxes(page);
    } finally {
      await context.close();
    }
  })();
  const { context, page } = await newPage({ ...view, prefs: { padPlacement: "custom", padLayout } });
  try {
    await openGame(page);
    const got = await boxes(page);
    const ratio0 = plain.keypad.w / plain.keypad.h;
    const ratio1 = got.keypad.w / got.keypad.h;
    ok(`${key}: 예전 저장(scale 1.25 만) = 같은 비율로 커짐(가로:세로 ${ratio0.toFixed(3)} → ${ratio1.toFixed(3)})`, Math.abs(ratio0 - ratio1) < 0.06 && got.keypad.w > plain.keypad.w * 1.15, JSON.stringify({ plain: plain.keypad, got: got.keypad }));
  } finally {
    await context.close();
  }
}

// 캡처: 세로 화면 — 키패드 가로 100%(아래) · 소프트 키 둘을 키패드 위 양옆에 따로 · 방향은 그 위 가운데 · 화면은 작게 위로.
async function stretchShots() {
  if (!SHOTS) return;
  const view = { label: "세로", width: 390, height: 844 };
  const { context, page } = await newPage(view);
  try {
    await openGame(page);
    await page.evaluate(() => window.webgba.padEditor.startEdit(false));
    await page.waitForTimeout(150);
    await drag(page, "keypad", "resize-x", -400, 0);
    await drag(page, "keypad", "move", 0, 400);
    const kp = await boxes(page);
    await page.evaluate(({ top }) => {
      const ed = window.webgba.padEditor;
      const app = document.getElementById("app").getBoundingClientRect();
      const c = ed.work.controls;
      c.screen.scale = 0.75;
      c.screen.x = 0.5;
      c.screen.y = 0.25;
      c.soft1.x = 0.14;
      c.soft2.x = 0.86;
      c.soft1.y = c.soft2.y = (top - 30) / app.height;
      c.dir.x = 0.5;
      c.dir.y = (top - 100) / app.height;
      ed.applyModel(ed.work);
      ed.select("keypad");
    }, { top: kp.keypad.t });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `pad_stretch_keypad100_soft_edit_${ENGINE}.png`) });
    await page.evaluate(() => window.webgba.padEditor.save());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `pad_stretch_keypad100_soft_play_${ENGINE}.png`) });
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
  if (ONLY.has("stretch")) {
    for (const view of VIEWS) {
      await stretchChecks(view);
      await stretchLegacyCheck(view);
    }
    await stretchShots();
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
