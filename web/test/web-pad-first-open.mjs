// 직접 배치(패드 자율배치 에디터) — 게임 첫 실행 적용 시험(헤드리스, 로컬 서버 tools/test/mp-local.mjs 가 web/dist 를 내줌, 롬 없는 예제만).
//   node web/test/web-pad-first-open.mjs [--dist <web/dist>] [--engine chromium|webkit] [--shots <캡처 폴더>]
// 1) 게임 안에서 배치 저장 → 닫기 → 첫 열기·두 번째 열기·앱 다시 시작 후 첫 열기가 저장 직후 자리와 같음(.wgba GBA·.wmba 모바일, 세로·가로).
// 2) 게임 없이(라이브러리) "키패드" 집합 배치 저장 → .wmba 첫 열기에 그 자리.
// 3) 게임을 연 뒤 resize 이벤트 없이 화면 상자(.app) 크기가 바뀜(아이폰 홈 화면 앱 — 파일 고르기 등을 닫은 직후) → 다음 프레임에
//    배치를 다시 계산해 저장 비율 자리로(전에는 게임을 다시 열 때까지 옛 크기 px 에 남음) · 상자가 그대로면 다시 계산하지 않음.
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
// .wmba 와 같은 설명서(방향·소프트 키·숫자 키패드, 세로 화면) — 실제 .wmba 는 20MB 이상이라 예제(hello-script)에 입력만 바꿔 쓴다.
const MOBILE = { preset: "none", dpad: "both", buttons: [["OK", "ok", "Enter"], ["CLR", "clear", "Backspace"], ["SOFT1", "soft1", "BracketLeft"], ["SOFT2", "soft2", "BracketRight"], ["RIGHT", "right", "ArrowRight"], ["LEFT", "left", "ArrowLeft"], ["UP", "up", "ArrowUp"], ["DOWN", "down", "ArrowDown"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => [`N${n}`, `num${n}`, `Digit${n}`]), ["STAR", "star", "NumpadMultiply"], ["HASH", "hash", "NumpadDivide"]].map(([id, role, code]) => ({ id, role, code })) };
const GAMES = {
  gba: { file: "pf-gba.wgba", bytes: await pack("hello-webapi") },
  mob: { file: "pf-mob.wmba", bytes: await pack("hello-script", { id: "com.example.padmobile", input: MOBILE, screen: { width: 240, height: 320 }, group: "mobile" }) },
};

const dist = opt.dist ? path.resolve(opt.dist) : undefined;
const local = await startLocal(dist ? { dist } : {});
const launchOpt = ENGINE === "webkit" ? { headless: true } : { executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true };
const browser = await pw[ENGINE].launch(launchOpt);
const errors = [];

async function newPage({ width, height }) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (!localStorage.getItem("webgba.prefs")) localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko", pad: "on", padSet: true }));
  });
  for (const g of Object.values(GAMES)) await context.route(`**/${g.file}`, (route) => route.fulfill({ body: g.bytes, contentType: "application/octet-stream" }));
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    if (!/r2\.dev|[Ss]ervice ?[Ww]orker/.test(e.message)) errors.push(e.message);
  });
  await boot(page);
  return { context, page };
}

async function boot(page) {
  await page.goto(local.base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
}

async function openGame(page, game) {
  await page.evaluate(async (file) => {
    const buf = await (await fetch(`/${file}`)).arrayBuffer();
    await window.webgba.openFiles([new File([buf], file)]);
  }, GAMES[game].file);
  await page.waitForFunction(() => window.webgba.state.game && !window.webgba.state.opening, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

async function closeGame(page) {
  await page.evaluate(() => window.webgba.closeGame());
  await page.waitForTimeout(200);
}

const frames = (page, n = 3) => page.evaluate((n) => new Promise((resolve) => {
  const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
  step(n);
}), n);

// 보이는 조작부(에디터가 배치하는 것) 가운데(.app 비율)·폭.
const snap = (page) => page.evaluate(() => {
  const ed = window.webgba.padEditor;
  const box = document.getElementById("app").getBoundingClientRect();
  const sel = { dir: "[data-dpad]", a: ".key--a", b: ".key--b", c: ".key--c", d: ".key--d", L: ".key--l", R: ".key--r", START: ".key--start", SELECT: ".key--select", keypad: ".keypad", screen: ".stage" };
  const pos = {};
  for (const [id, s] of Object.entries(sel)) {
    const n = document.querySelector(s);
    if (!n || n.hidden || n.hasAttribute("data-off") || n.offsetParent === null) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1) continue;
    pos[id] = [+((r.left + r.width / 2 - box.left) / box.width).toFixed(3), +((r.top + r.height / 2 - box.top) / box.height).toFixed(3), +r.width.toFixed(1)];
  }
  return { free: document.body.hasAttribute("data-pad-free"), sig: ed.currentSig(), pos };
});
const differ = (want, got) => {
  const bad = [];
  for (const [id, p] of Object.entries(want.pos)) {
    const q = got.pos[id];
    if (!q) bad.push(`${id}:없음`);
    else if (Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) > 0.01 || Math.abs(p[2] - q[2]) > 1) bad.push(`${id}:${p}→${q}`);
  }
  for (const id of Object.keys(got.pos)) if (!want.pos[id]) bad.push(`${id}:더 있음`);
  return bad;
};

// 편집 진입 → 지금 집합 조작부를 조금씩 옮기고(A·방향은 크게) 저장. 반환 = 저장한 signature.
const editAndSave = (page, kind = "game") => page.evaluate((kind) => {
  const ed = window.webgba.padEditor;
  ed.startEdit(innerWidth > innerHeight);
  if (kind !== "game") ed.pickSet(kind);
  for (const [id, rec] of Object.entries(ed.work.controls)) {
    if (id === "screen") {
      rec.scale = 0.8;
      continue;
    }
    rec.x = Math.min(0.85, Math.max(0.15, rec.x + (rec.x > 0.5 ? -0.12 : 0.12)));
    rec.y = Math.min(0.85, Math.max(0.15, rec.y - 0.06));
    if (id === "a" || id === "dir") rec.scale = 1.3;
  }
  const sig = ed.sig;
  ed.save();
  return sig;
}, kind);

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);

async function reopenChecks(view, game) {
  const key = `${ENGINE} ${view.label} ${game}`;
  const { context, page } = await newPage(view);
  try {
    await openGame(page, game);
    const sig = await editAndSave(page);
    await page.waitForTimeout(150);
    const saved = await snap(page);
    await closeGame(page);
    await openGame(page, game);
    const first = await snap(page);
    await shot(page, `first_open_${ENGINE}_${view.label}_${game}`);
    ok(`${key}: 게임 안에서 저장(${sig}) → 닫고 첫 열기 = 저장 직후 자리(직접 배치 적용)`, first.free && first.sig === sig && !differ(saved, first).length, differ(saved, first).join(" ") || first.sig);
    await closeGame(page);
    await openGame(page, game);
    const second = await snap(page);
    ok(`${key}: 두 번째 열기도 같은 자리`, second.free && !differ(saved, second).length, differ(saved, second).join(" "));
    await boot(page);
    await openGame(page, game);
    const reboot = await snap(page);
    ok(`${key}: 앱 다시 시작 후 첫 열기도 같은 자리`, reboot.free && !differ(saved, reboot).length, differ(saved, reboot).join(" "));
  } finally {
    await context.close();
  }
}

async function libraryKeypadCheck(view) {
  const key = `${ENGINE} ${view.label}`;
  const { context, page } = await newPage(view);
  try {
    const sig = await editAndSave(page, "keypad");
    const want = await page.evaluate((sig) => window.webgba.padEditor.layout()[sig]?.[innerWidth > innerHeight ? "landscape" : "portrait"]?.controls ?? null, sig);
    await openGame(page, "mob");
    const got = await snap(page);
    const box = await page.evaluate(() => {
      const app = document.getElementById("app").getBoundingClientRect();
      const n = document.querySelector(".keypad").getBoundingClientRect();
      return { w: app.width, h: app.height, kw: n.width, kh: n.height };
    });
    // 저장 비율 → 상자 안 가운데(clampCenter 와 같은 식: 상자가 화면 밖으로 나가지 않게)
    const fit = (v, size, max) => Math.min(1 - size / 2 / max, Math.max(size / 2 / max, v));
    const kp = want?.keypad;
    const wantKp = kp ? [fit(kp.x, box.kw, box.w), fit(kp.y, box.kh, box.h)] : null;
    const near = wantKp && got.pos.keypad && Math.abs(got.pos.keypad[0] - wantKp[0]) <= 0.01 && Math.abs(got.pos.keypad[1] - wantKp[1]) <= 0.01;
    ok(`${key}: 게임 없이 "키패드" 집합 저장(${sig}) → .wmba 첫 열기에 그 자리`, sig === "dir,keypad" && got.free && got.sig === sig && near, JSON.stringify({ want: wantKp, got: got.pos.keypad }));
  } finally {
    await context.close();
  }
}

// resize 이벤트 없이 .app 상자가 바뀌는 경우(아이폰 홈 화면 앱). 상자 크기를 inline 으로 줄이고(이벤트 없음) 다음 프레임을 본다.
async function silentBoxCheck(view, game) {
  const key = `${ENGINE} ${view.label} ${game}`;
  const { context, page } = await newPage(view);
  try {
    await openGame(page, game);
    const sig = await editAndSave(page);
    await closeGame(page);
    await openGame(page, game);
    const before = await snap(page);
    const applies = await page.evaluate(() => {
      const ed = window.webgba.padEditor;
      const orig = ed.apply.bind(ed);
      window.__applies = 0;
      ed.apply = () => {
        window.__applies++;
        orig();
      };
      document.getElementById("app").style.bottom = "64px";
      return window.__applies;
    });
    await frames(page, 4);
    await page.waitForTimeout(100);
    const after = await snap(page);
    const ran = await page.evaluate(() => window.__applies);
    await shot(page, `silent_box_${ENGINE}_${view.label}_${game}`);
    ok(`${key}: 게임 연 뒤 resize 이벤트 없이 화면 상자 64px 줄어듦 → 다음 프레임에 다시 배치(저장 비율 자리 그대로, ${sig})`, applies === 0 && ran >= 1 && after.free && !differ(before, after).length, `${differ(before, after).join(" ")} · 다시 계산 ${ran}회`);
    await page.evaluate(() => (window.__applies = 0));
    await frames(page, 4);
    await page.waitForTimeout(150);
    ok(`${key}: 상자가 그대로면 다시 계산하지 않음(반복 0)`, (await page.evaluate(() => window.__applies)) === 0, String(await page.evaluate(() => window.__applies)));
    await page.evaluate(() => document.getElementById("app").style.removeProperty("bottom"));
    await frames(page, 4);
    await page.waitForTimeout(100);
    const back = await snap(page);
    ok(`${key}: 상자가 원래대로 돌아와도 저장 비율 자리`, !differ(before, back).length, differ(before, back).join(" "));
  } finally {
    await context.close();
  }
}

const VIEWS = [{ label: "세로", width: 390, height: 844 }, { label: "가로", width: 844, height: 390 }];
try {
  for (const view of VIEWS) {
    for (const game of ["gba", "mob"]) await reopenChecks(view, game);
    await libraryKeypadCheck(view);
    for (const game of ["gba", "mob"]) await silentBoxCheck(view, game);
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
