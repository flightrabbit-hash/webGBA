// 게임마다 버튼 글자(설명서 버튼 touchLabel) 시험(헤드리스, 로컬 서버 tools/test/mp-local.mjs 가 web/dist 를 내줌, 롬 없는 예제만).
//   node web/test/web-labels.mjs [--dist <web/dist>] [--engine chromium|webkit] [--shots <캡처 폴더>]
// 시험용 .wgba 셋(hello-script 에 설명서만 바꿈): PS1 형(○ × △ □ L1 R1 · L2·R2 는 터치 자리 없음) · N64 형(C◀ C▼ · 언어별 글) ·
// 옛 설명서(label 만 — 공격·점프·시작·코인).
// 보는 것: 가상 버튼 글자(휴대폰 세로·가로 3배, PC 1배) · 글자를 바꿔도 버튼 상자·배치 그대로 · touchLabel 이 없는 자리·옛 설명서는
// 자리 이름 그대로(그림이 GBA 기본과 같은 픽셀) · 조작법 목록 · RS 칸 · 직접 배치 편집 이름 · 화면 언어(ko·en)별 글 · 한글 글자(갈무리11 래스터).
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
const read = (file) => fs.readFileSync(path.join(examples, "hello-script", file));
const pack = async (patch) => {
  const manifest = { ...JSON.parse(read("manifest.json")), ...patch };
  return Buffer.from((await packWgba({ wasm: read("game.wasm"), manifest, js: read("game.js") })).bytes);
};
const dirs = [["UP", "up", "ArrowUp"], ["DOWN", "down", "ArrowDown"], ["LEFT", "left", "ArrowLeft"], ["RIGHT", "right", "ArrowRight"]].map(([id, role, code]) => ({ id, role, code }));
const PS1 = {
  preset: "none",
  dpad: "opposite",
  buttons: [
    ...dirs,
    { id: "CIRCLE", role: "a", code: "KeyZ", label: "○", touchLabel: "○" },
    { id: "CROSS", role: "b", code: "KeyX", label: "×", touchLabel: "×" },
    { id: "TRIANGLE", role: "c", code: "KeyC", label: "△", touchLabel: "△" },
    { id: "SQUARE", role: "d", code: "KeyV", label: "□", touchLabel: "□" },
    { id: "L1", role: "l", code: "KeyA", label: "L1", touchLabel: "L1" },
    { id: "R1", role: "r", code: "KeyS", label: "R1", touchLabel: "R1" },
    { id: "L2", role: "l2", code: "KeyQ", label: "L2" },
    { id: "R2", role: "r2", code: "KeyW", label: "R2" },
    { id: "START", role: "start", code: "Enter" },
    { id: "SELECT", role: "select", code: "Backspace" },
  ],
  rs: [{ buttons: ["CIRCLE", "CROSS"], hold: 6 }],
};
const N64 = {
  preset: "none",
  dpad: "opposite",
  buttons: [
    ...dirs,
    { id: "A", role: "a", code: "KeyZ" },
    { id: "B", role: "b", code: "KeyX" },
    { id: "C_LEFT", role: "c", code: "KeyJ", label: "C◀", touchLabel: "C◀" },
    { id: "C_DOWN", role: "d", code: "KeyK", label: "C▼", touchLabel: "C▼" },
    { id: "C_UP", role: "extra", code: "KeyI", label: "C▲" },
    { id: "Z", role: "l2", code: "KeyQ", label: "Z" },
    { id: "L", role: "l", code: "KeyA" },
    { id: "R", role: "r", code: "KeyS" },
    { id: "START", role: "start", code: "Enter", touchLabel: { en: "START", ko: "시작" } },
    { id: "JUMP", role: "select", code: "Backspace", label: { en: "Jump", ko: "점프" }, touchLabel: { en: "JUMP", ko: "점프" } },
  ],
};
const OLD = {
  preset: "none",
  buttons: [
    ...dirs,
    { id: "A", role: "a", code: "KeyZ", label: { en: "ATTACK", ko: "공격" } },
    { id: "B", role: "b", code: "KeyX", label: { en: "JUMP", ko: "점프" } },
    { id: "START", role: "start", code: "Enter", label: { en: "START", ko: "시작" } },
    { id: "COIN", role: "select", code: "Backspace", label: { en: "COIN", ko: "코인" } },
  ],
};
const GAMES = {
  ps1: { file: "lbl-ps1.wgba", bytes: await pack({ id: "com.example.labelps1", name: "Label PS1", input: PS1, screen: { width: 320, height: 240 }, display: { aspect: "4:3" } }) },
  n64: { file: "lbl-n64.wgba", bytes: await pack({ id: "com.example.labeln64", name: "Label N64", input: N64, screen: { width: 320, height: 240 }, display: { aspect: "4:3" } }) },
  old: { file: "lbl-old.wgba", bytes: await pack({ id: "com.example.labelold", name: "Label Old", input: OLD }) },
};

const dist = opt.dist ? path.resolve(opt.dist) : undefined;
const local = await startLocal(dist ? { dist } : {});
const launchOpt = ENGINE === "webkit" ? { headless: true } : { executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true };
const browser = await pw[ENGINE].launch(launchOpt);
const errors = [];

async function newPage({ width, height, dpr = 3, mobile = true, prefs = {} }) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: dpr, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (!localStorage.getItem("webgba.prefs")) localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko", pad: "on", padSet: true, ...prefs }));
  }, prefs);
  for (const g of Object.values(GAMES)) await context.route(`**/${g.file}`, (route) => route.fulfill({ body: g.bytes, contentType: "application/octet-stream" }));
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    if (!/r2\.dev|[Ss]ervice ?[Ww]orker|sandboxed/.test(e.message)) errors.push(e.message);
  });
  await page.goto(local.base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page };
}

async function openGame(page, game) {
  await page.evaluate(async (file) => {
    const buf = await (await fetch(`/${file}`)).arrayBuffer();
    await window.webgba.openFiles([new File([buf], file)]);
  }, game.file);
  await page.waitForFunction(() => window.webgba.state.game && !window.webgba.state.opening, null, { timeout: 30000 });
  await page.waitForTimeout(400);
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);

// 가상 버튼 캔버스: 보이는지·상자·그림(dataURL). 글자 없이 다시 그린 그림과 비교한다(skin.setLabels({}) → 되돌림).
const KEYS = ["A", "B", "C", "D", "L", "R", "START", "SELECT"];
const padState = (page) =>
  page.evaluate((keys) => {
    const out = {};
    for (const name of keys) {
      const host = document.querySelector(`#pad [data-key="${name}"], [data-key="${name}"]`);
      const canvas = host?.querySelector("canvas");
      if (!host || !canvas || host.offsetParent === null) continue;
      const r = host.getBoundingClientRect();
      if (r.width < 1) continue;
      out[name] = { box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10), png: canvas.toDataURL() };
    }
    return out;
  }, KEYS);
const withoutLabels = (page) =>
  page.evaluate(() => {
    const keep = { ...window.webgba.skin.labels };
    window.webgba.skin.setLabels({});
    return keep;
  });
const restore = (page, labels) => page.evaluate((labels) => window.webgba.skin.setLabels(labels), labels);

async function padChecks(view, gameKey, want, { shots = true } = {}) {
  const key = `${ENGINE} ${view.label} ${gameKey}`;
  const { context, page } = await newPage(view);
  try {
    await openGame(page, GAMES[gameKey]);
    const labels = await page.evaluate(() => ({ ...window.webgba.skin.labels }));
    ok(`${key}: 가상 버튼 글자 = 설명서 touchLabel(${view.lang ?? "ko"})`, JSON.stringify(labels) === JSON.stringify(want), JSON.stringify(labels));
    const shown = await padState(page);
    const saved = await withoutLabels(page);
    await page.waitForTimeout(50);
    const plain = await padState(page);
    await restore(page, saved);
    const changed = Object.keys(shown).filter((name) => shown[name].png !== plain[name]?.png);
    const visibleLabeled = Object.keys(want).filter((name) => shown[name] && want[name] !== name);
    ok(`${key}: 글자 자리만 그림이 바뀜(그 밖의 자리·자리 이름과 같은 글자는 같은 픽셀)`, JSON.stringify(changed.sort()) === JSON.stringify(visibleLabeled.sort()), `바뀐 자리 ${changed.join(" ") || "없음"} · 글자 자리 ${visibleLabeled.join(" ") || "없음"}`);
    const moved = Object.keys(shown).filter((name) => shown[name].box.join() !== plain[name]?.box.join());
    ok(`${key}: 글자를 바꿔도 버튼 상자·배치 그대로`, moved.length === 0, moved.map((n) => `${n} ${shown[n].box} → ${plain[n]?.box}`).join(" / "));
    if (shots) await shot(page, `pad_${gameKey}_${view.label}`);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const PHONE_P = { label: "phone-portrait", width: 390, height: 844, dpr: 3 };
const PHONE_L = { label: "phone-landscape", width: 844, height: 390, dpr: 3 };
const PC = { label: "pc", width: 1280, height: 800, dpr: 1, mobile: false };
const PS1_WANT = { A: "○", B: "×", C: "△", D: "□", L: "L1", R: "R1" };

try {
  {
    const { context, page } = await newPage(PC);
    try {
      await page.evaluate(() => document.fonts.load("12px Galmuri11", "점프ジャンプ"));
      const fit = await page.evaluate(async () => {
        const PX = await import("/js/pixel-ui.js");
        window.webgba.skin.refreshText();
        const ink = (r) => (r.inkBox ? { w: r.inkBox.x1 - r.inkBox.x0 + 1, h: r.inkBox.y1 - r.inkBox.y0 + 1 } : null);
        const round = (text, scale = 4) => PX.renderRoundButton({ label: "A", text, scale });
        return {
          bigRound: ["○", "×", "△", "□", "C▲", "C◀", "Y1", "RK", "Z", "ABC", "○×"].map((t) => [t, ink(round(t))]),
          threeRound: ink(round("ABCD")),
          shoulder: ["L1", "START", "TAG"].map((t) => [t, ink(PX.renderShoulder({ side: "L", text: t, scale: 4 }))]),
          shoulderLong: ink(PX.renderShoulder({ side: "L", text: "SELECT", scale: 4 })),
          pill: ["SELECT", "CHEAT", "1/2"].map((t) => [t, ink(PX.renderPill({ label: "START", text: t, scale: 4 }))]),
          hangul: (() => { const r = round("점프"); return { ink: ink(r), fine: r.fineInk }; })(),
          hangulSmall: (() => { const r = round("ジャンプ", 2); return { ink: ink(r), fine: r.fineInk }; })(),
          slotA: ink(round("")),
          font: ["C▲", "점프", "jump"].map((t) => [t, PX.labelFont(t)]),
        };
      });
      const big = (x) => x && x.h === 7;
      const small = (x) => x && x.h === 5;
      ok(`${ENGINE} 픽셀 글자 맞춤: 둥근 버튼 영문 3자·기호 2자 = 큰 글자(5×7), 영문 4자 = 작은 글자`, fit.bigRound.every(([, x]) => big(x)) && small(fit.threeRound), JSON.stringify({ big: fit.bigRound, three: fit.threeRound }));
      ok(`${ENGINE} 픽셀 글자 맞춤: L·R 5자(START) 큰 글자, SELECT = 작은 글자 · START·SELECT 알약 6자 작은 글자`, fit.shoulder.every(([, x]) => big(x)) && small(fit.shoulderLong) && fit.pill.every(([, x]) => small(x)), JSON.stringify({ shoulder: fit.shoulder, long: fit.shoulderLong, pill: fit.pill }));
      ok(`${ENGINE} 한글 = 갈무리11(아트 픽셀 또는 기기 픽셀 덧그림) · 맞지 않으면 자리 이름(배율 2 의 가나 4자 → A)`, (fit.hangul.ink || fit.hangul.fine) && fit.hangulSmall.fine === null && JSON.stringify(fit.hangulSmall.ink) === JSON.stringify(fit.slotA), JSON.stringify(fit.hangul) + " " + JSON.stringify(fit.hangulSmall));
      ok(`${ENGINE} labelFont: C▲ = big · 점프 = 픽셀 글자 없음 · 소문자 = 대문자`, fit.font[0][1] === "big" && fit.font[1][1] === null && fit.font[2][1] === "big", JSON.stringify(fit.font));
    } finally {
      await context.close();
    }
  }
  for (const view of [PHONE_P, PHONE_L, PC]) {
    const { context, page } = await padChecks(view, "ps1", PS1_WANT);
    try {
      if (view === PHONE_P || view === PC) {
        await page.evaluate(() => window.webgba.openSheet("help"));
        await page.waitForTimeout(250);
        const help = await page.evaluate(() => [...document.querySelectorAll(".keys dt")].map((n) => n.textContent));
        ok(`${ENGINE} ${view.label}: 조작법 목록 = 버튼 이름(○ × △ □ L1 R1 L2 R2 START SELECT)`, ["○", "×", "△", "□", "L1", "R1", "L2", "R2", "START", "SELECT"].every((name) => help.includes(name)), help.join(" | "));
        await shot(page, `help_ps1_${view.label}`);
        await page.evaluate(() => {
          window.webgba.state.rsOpen = new Set([0]);
          window.webgba.openSheet("rs");
        });
        await page.waitForTimeout(250);
        const chips = await page.evaluate(() => [...document.querySelectorAll(".rs-step .rs-key")].slice(0, 12).map((n) => ({ key: n.dataset.key, text: n.textContent, title: n.title, pressed: n.getAttribute("aria-pressed") })));
        const chipOf = (k) => chips.find((c) => c.key === k);
        ok(`${ENGINE} ${view.label}: RS 칸 = 터치 글자(A ○ · B × · C △ · D □ · L L1 · R R1, START·SELECT 그대로) · 1단계 ○·× 켬`, chipOf("A")?.text === "○" && chipOf("B")?.text === "×" && chipOf("C")?.text === "△" && chipOf("D")?.text === "□" && chipOf("L")?.text === "L1" && chipOf("R")?.text === "R1" && chipOf("START")?.text === "START" && chipOf("A")?.pressed === "true" && chipOf("B")?.pressed === "true", JSON.stringify(chips.map((c) => `${c.key}:${c.text}`)));
        await shot(page, `rs_ps1_${view.label}`);
        await page.evaluate(() => document.getElementById("sheetClose")?.click());
        await page.waitForTimeout(200);
      }
      if (view === PHONE_P) {
        await page.evaluate(() => window.webgba.padEditor.startEdit(innerWidth > innerHeight));
        await page.waitForTimeout(200);
        const frames = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".padedit__sel")].map((n) => [n.dataset.ctl, n.dataset.label])));
        ok(`${ENGINE} ${view.label}: 직접 배치 편집 이름 = 자리 이름 + 게임 글자(A 버튼 (○) · L (L1)), 글자 없는 자리는 그대로`, frames.a === "A 버튼 (○)" && frames.b === "B 버튼 (×)" && frames.L === "L (L1)" && frames.START === "START" && frames.dir === "방향", JSON.stringify(frames));
        await shot(page, `padedit_ps1_${view.label}`);
        await page.evaluate(() => window.webgba.padEditor.exit(false));
      }
    } finally {
      await context.close();
    }
  }
  for (const [view, lang, want] of [
    [{ ...PC, lang: "ko", prefs: { lang: "ko" } }, "ko", { C: "C◀", D: "C▼", START: "시작", SELECT: "점프" }],
    [{ ...PC, lang: "en", prefs: { lang: "en" } }, "en", { C: "C◀", D: "C▼", START: "START", SELECT: "JUMP" }],
    [{ ...PHONE_P, lang: "ko", prefs: { lang: "ko" } }, "ko", { C: "C◀", D: "C▼", START: "시작", SELECT: "점프" }],
  ]) {
    const { context, page } = await padChecks({ ...view, label: `${view.label}-${lang}` }, "n64", want);
    try {
      const fine = await page.evaluate(() => {
        const PXrender = window.webgba.skin;
        return Object.keys(PXrender.labels);
      });
      ok(`${ENGINE} ${view.label}-${lang}: 언어별 touchLabel(ko 시작·점프 = 갈무리11 래스터, en START·JUMP = 픽셀 글자)`, fine.length === 4);
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await padChecks({ ...PHONE_P, label: "phone-portrait-old" }, "old", {});
    try {
      const help = await page.evaluate(async () => {
        window.webgba.openSheet("help");
        await new Promise((r) => setTimeout(r, 200));
        return [...document.querySelectorAll(".keys dt")].map((n) => n.textContent);
      });
      ok(`${ENGINE} 옛 설명서(label 만): 가상 버튼은 자리 이름 그대로 · 조작법 목록은 label(공격·점프·시작·코인)`, ["공격", "점프", "시작", "코인"].every((n) => help.includes(n)), help.join(" | "));
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await newPage(PHONE_P);
    try {
      await openGame(page, GAMES.ps1);
      await page.evaluate(() => window.webgba.closeGame());
      await page.waitForTimeout(300);
      const labels = await page.evaluate(() => ({ ...window.webgba.skin.labels }));
      ok(`${ENGINE} 게임을 닫으면 글자 지움(GBA 기본 자리 이름)`, Object.keys(labels).length === 0, JSON.stringify(labels));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await local.close?.();
}

ok(`${ENGINE}: 페이지 오류 없음`, errors.length === 0, errors.slice(0, 3).join(" / "));
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `실패 ${failed} / ${results.length}` : `모두 통과 (${results.length})`);
process.exit(failed ? 1 : 0);
