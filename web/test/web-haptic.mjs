// 웹 webGBA 버튼 진동 시험(로컬 전용): 게임 버튼(A·B·C·D·L·R·START·SELECT)만 진동하고 십자 패드·스틱은 진동하지 않음,
// 설정 "버튼 진동" 기본 끔·지원하지 않는 기기는 회색 + 안내, 기기별 판정(hapticKind), iOS 스위치 방식 요소, 누르기 처리 시간.
// 방향 진동: 설정 "방향 진동"(기본 끔) — 스틱·십자 패드 방향이 바뀔 때마다 한 번(중립 → 방향, 방향 → 다른 방향, 대각선 포함),
// 같은 방향 유지·중립 복귀·죽은 영역 안 흔들림·경계 떨림에서는 추가 진동 없음, 끄면 0, 움직임 처리 시간.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-haptic.mjs <주소> <캡처 폴더> [--chrome <chrome.exe>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

const [URL_BASE, SHOTS, ...rest] = process.argv.slice(2);
const chromeAt = rest.indexOf("--chrome");
const CHROME = chromeAt >= 0 ? rest[chromeAt + 1] : "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ mobile, prefs = {} }) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko", ...prefs }));
    window.__log = [];
    window.__buzzAt = [];
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value(pattern) {
        window.__log.push(`buzz:${pattern}`);
        window.__buzzAt.push(performance.now());
        return true;
      },
    });
  }, prefs);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const p = window.webgba.player;
    const down = p.keyDown.bind(p);
    p.keyDown = (code) => (window.__log.push(`key:${code}`), down(code));
  });
  return { context, page };
}

const vibrateRow = (page, label = "버튼 진동") =>
  page.evaluate((label) => {
    window.webgba.openSheet("settings");
    const rows = [...document.querySelectorAll(".field")];
    const row = rows.find((n) => n.querySelector(".switch")?.getAttribute("aria-label") === label);
    if (!row) return null;
    const toggle = row.querySelector(".switch");
    return { checked: toggle.getAttribute("aria-checked"), disabled: toggle.disabled, off: row.classList.contains("field--off"), note: row.querySelector(".field__note")?.textContent ?? "", opacity: +getComputedStyle(toggle).opacity, label: getComputedStyle(row.querySelector(".field__label")).color, after: rows[rows.indexOf(row) - 1]?.querySelector(".switch")?.getAttribute("aria-label") ?? "" };
  }, label);

const flip = (page, label) =>
  page.evaluate((label) => {
    window.webgba.openSheet("settings");
    [...document.querySelectorAll(".switch")].find((n) => n.getAttribute("aria-label") === label).click();
    document.getElementById("sheetClose").click();
  }, label);

// 걸음마다 [기다림(ms), 종류, 손가락, 대상, dx, dy] — dx·dy 는 대상 반지름(짧은 변의 절반) 단위.
// 방향 진동은 시간 조건(떠나는 방향 유지 40ms·진동 사이 100ms)이 있어 사이를 띄운다.
const pressTimed = (page, steps) =>
  page.evaluate(async (steps) => {
    window.__log.length = 0;
    const root = document.getElementById("pad");
    const center = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: Math.min(r.width, r.height) / 2 };
    };
    const send = (type, id, at) => (type === "pointerdown" ? root : window).dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: at.x, clientY: at.y, pointerType: "touch", isPrimary: id === 1, bubbles: true, cancelable: true }));
    for (const [wait, type, id, sel, dx = 0, dy = 0] of steps) {
      if (wait) await new Promise((done) => setTimeout(done, wait));
      const c = center(sel);
      send(type, id, { x: c.x + dx * c.rad, y: c.y + dy * c.rad });
    }
    return [...window.__log];
  }, steps);
const dirKeys = (log) => log.filter((x) => x.startsWith("key:")).length;

const press = (page, steps) =>
  page.evaluate((steps) => {
    window.__log.length = 0;
    const root = document.getElementById("pad");
    const center = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
    };
    const send = (type, id, at) => (type === "pointerdown" ? root : window).dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: at.x, clientY: at.y, pointerType: "touch", isPrimary: id === 1, bubbles: true, cancelable: true }));
    for (const [type, id, sel, dx = 0, dy = 0] of steps) {
      const c = center(sel);
      send(type, id, { x: c.x + dx * c.r.width, y: c.y + dy * c.r.height });
    }
    return [...window.__log];
  }, steps);
const tap = (sel, id = 1) => [
  ["pointerdown", id, sel],
  ["pointerup", id, sel],
];
const buzzes = (log) => log.filter((x) => x.startsWith("buzz:")).length;

// 1) 터치 휴대폰(안드로이드 크롬 흉내: pointer coarse + navigator.vibrate)
{
  const { context, page } = await open({ mobile: true });
  const row = await vibrateRow(page);
  ok("휴대폰: 설정 › 화면 \"버튼 진동\" 기본 끔 · 켤 수 있음 · 안내 글", row && row.checked === "false" && !row.disabled && !row.off && row.note === "게임 버튼을 누르면 짧게 진동합니다(십자 패드·스틱 제외)", JSON.stringify(row));
  const offLog = await page.evaluate(() => (document.getElementById("sheetClose").click(), true)).then(() => page.waitForTimeout(400)).then(() => press(page, tap('[data-key="A"]')));
  ok(`휴대폰: 끈 상태에서 A → 진동 0(${buzzes(offLog)})`, buzzes(offLog) === 0 && offLog.some((x) => x.startsWith("key:")), offLog.join(" "));
  await page.evaluate(() => {
    window.webgba.openSheet("settings");
    [...document.querySelectorAll(".switch")].find((n) => n.getAttribute("aria-label") === "버튼 진동").click();
    document.getElementById("sheetClose").click();
  });
  await page.waitForTimeout(400);
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs")).vibrate);
  ok("휴대폰: 켜면 설정에 남음", pref === true, String(pref));

  const each = {};
  for (const key of ["A", "B", "L", "R", "START", "SELECT"]) each[key] = await press(page, tap(`[data-key="${key}"]`));
  const pattern = Object.values(each).flat().filter((x) => x.startsWith("buzz:"));
  ok(`휴대폰: A·B·L·R·START·SELECT 누를 때마다 한 번씩 ${pattern[0]}ms`, Object.values(each).every((log) => buzzes(log) === 1) && pattern.every((x) => x === "buzz:12"), JSON.stringify(each));
  ok("휴대폰: 게임 입력 먼저, 진동은 그 뒤", Object.values(each).every((log) => log.findIndex((x) => x.startsWith("key:")) >= 0 && log.findIndex((x) => x.startsWith("key:")) < log.findIndex((x) => x.startsWith("buzz:"))), JSON.stringify(each.A));

  await page.evaluate(() => window.webgba.setInput({ preset: "gba", buttons: [{ id: "C", role: "c", bit: 10 }, { id: "D", role: "d", bit: 11 }] }));
  await page.waitForTimeout(300);
  const cd = [...(await press(page, tap('[data-key="C"]'))), ...(await press(page, tap('[data-key="D"]')))];
  ok(`휴대폰: C·D(정의한 게임)도 한 번씩(${buzzes(cd)})`, buzzes(cd) === 2, cd.join(" "));

  const stick = await press(page, [["pointerdown", 1, "[data-dpad]"], ["pointermove", 1, "[data-dpad]", 0.45, 0], ["pointermove", 1, "[data-dpad]", 0, -0.45], ["pointermove", 1, "[data-dpad]", -0.45, 0.45], ["pointerup", 1, "[data-dpad]"]]);
  ok(`휴대폰: 스틱 방향 → 진동 0(방향 입력 ${stick.filter((x) => x.startsWith("key:")).length}번)`, buzzes(stick) === 0 && stick.some((x) => x.startsWith("key:")), stick.join(" "));
  await page.evaluate(() => window.webgba.pad.setMode("dpad"));
  const dpad = await press(page, [["pointerdown", 1, "[data-dpad]", 0.4, 0], ["pointerup", 1, "[data-dpad]", 0.4, 0], ["pointerdown", 1, "[data-dpad]", 0, 0.4], ["pointermove", 1, "[data-dpad]", -0.4, 0], ["pointerup", 1, "[data-dpad]"]]);
  ok(`휴대폰: 십자 패드 → 진동 0(방향 입력 ${dpad.filter((x) => x.startsWith("key:")).length}번)`, buzzes(dpad) === 0 && dpad.some((x) => x.startsWith("key:")), dpad.join(" "));
  const dirAndA = await press(page, [["pointerdown", 1, "[data-dpad]", 0.4, 0], ["pointerdown", 2, '[data-key="A"]'], ["pointerup", 2, '[data-key="A"]'], ["pointerup", 1, "[data-dpad]"]]);
  ok(`휴대폰: 방향을 누른 채 A → A 만 한 번(${buzzes(dirAndA)})`, buzzes(dirAndA) === 1, dirAndA.join(" "));
  await page.evaluate(() => window.webgba.pad.setMode("stick"));

  const multi = await press(page, [["pointerdown", 1, '[data-key="A"]'], ["pointerdown", 2, '[data-key="B"]'], ["pointermove", 1, '[data-key="B"]'], ["pointerup", 1, '[data-key="B"]'], ["pointerup", 2, '[data-key="B"]']]);
  ok(`휴대폰: A 누른 채 B → 한 번 더 · 이미 눌린 B 로 손가락을 옮기면 없음(합 ${buzzes(multi)})`, buzzes(multi) === 2, multi.join(" "));
  const slide = await press(page, [["pointerdown", 1, '[data-key="A"]'], ["pointermove", 1, '[data-key="A"]', 0.1, 0.1], ["pointermove", 1, '[data-key="B"]'], ["pointerup", 1, '[data-key="B"]']]);
  ok(`휴대폰: A 에서 B 로 밀면 B 에서 한 번 더(합 ${buzzes(slide)}) · 같은 버튼 안 움직임은 없음`, buzzes(slide) === 2, slide.join(" "));

  // 누르기(pointerdown) 처리 시간: 진동 켬·끔을 50번씩 번갈아 20묶음, 한 번 평균(µs)
  const timing = await page.evaluate(() => {
    const root = document.getElementById("pad");
    const r = document.querySelector('[data-key="A"]').getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: "touch", bubbles: true, cancelable: true };
    const prefs = window.webgba.state.prefs;
    const sum = { on: 0, off: 0 };
    const count = { on: 0, off: 0 };
    for (let block = 0; block < 20; block++) {
      const mode = block % 2 ? "on" : "off";
      prefs.vibrate = mode === "on";
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        root.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerId: 9 }));
        sum[mode] += performance.now() - t0;
        count[mode]++;
        window.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerId: 9 }));
      }
    }
    prefs.vibrate = true;
    return { on: +((sum.on / count.on) * 1000).toFixed(1), off: +((sum.off / count.off) * 1000).toFixed(1), presses: count.on + count.off };
  });
  ok(`휴대폰: 누르기 처리 시간 한 번 평균 진동 켬 ${timing.on}µs · 끔 ${timing.off}µs(${timing.presses}번)`, timing.on - timing.off < 100, JSON.stringify(timing));
  fs.writeFileSync(path.join(SHOTS, "버튼진동_누르기_처리시간.json"), JSON.stringify(timing, null, 2));
  ok("휴대폰: 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// 1b) 방향 진동(스틱·십자 패드): 방향이 바뀔 때마다 한 번, 같은 방향 유지·중립 복귀·죽은 영역 흔들림·경계 떨림은 없음
const S = "[data-dpad]";
const STICK_ROUTE = [
  [200, "pointerdown", 1, S, 0, 0],
  [60, "pointermove", 1, S, 0.8, 0],
  [60, "pointermove", 1, S, 0.85, 0.05],
  [60, "pointermove", 1, S, 0.9, -0.05],
  [120, "pointermove", 1, S, 0.6, 0.6],
  [120, "pointermove", 1, S, 0, -0.8],
  [120, "pointermove", 1, S, 0, 0],
  [120, "pointerup", 1, S, 0, 0],
];
{
  const { context, page } = await open({ mobile: true });
  const row = await vibrateRow(page, "방향 진동");
  ok("휴대폰: 설정 › 화면 \"버튼 진동\" 바로 아래 \"방향 진동\" 기본 끔 · 켤 수 있음 · 안내 글", row && row.after === "버튼 진동" && row.checked === "false" && !row.disabled && !row.off && row.note === "스틱·십자 패드의 방향이 바뀌면 짧게 진동합니다", JSON.stringify(row));
  await page.evaluate(() => document.getElementById("sheetClose").click());
  await page.waitForTimeout(400);

  const offLog = await pressTimed(page, STICK_ROUTE);
  ok(`방향: 끈 상태에서 스틱 오른쪽 → 오른쪽 아래 → 위 → 가운데 → 진동 0(방향 입력 ${dirKeys(offLog)}번)`, buzzes(offLog) === 0 && dirKeys(offLog) === 3, offLog.join(" "));
  await flip(page, "방향 진동");
  await page.waitForTimeout(400);
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs")));
  ok("방향: 켜면 설정에 남음 · 버튼 진동은 그대로 끔", pref.vibrateDir === true && pref.vibrate === false, JSON.stringify({ vibrateDir: pref.vibrateDir, vibrate: pref.vibrate }));

  const stick = await pressTimed(page, STICK_ROUTE);
  const before = stick.map((x, i) => (x.startsWith("buzz:") ? stick[i - 1] : null)).filter((x) => x !== null);
  ok(
    `방향: 스틱 중립 → 오른쪽 · 오른쪽 → 오른쪽 아래(대각선) · → 위 마다 한 번씩(합 ${buzzes(stick)}) · 같은 방향 안 움직임·가운데로 돌아올 때·손 뗄 때 0 · ${stick.find((x) => x.startsWith("buzz:"))}ms`,
    buzzes(stick) === 3 && stick.filter((x) => x.startsWith("buzz:")).every((x) => x === "buzz:12"),
    stick.join(" "),
  );
  ok("방향: 게임 입력 먼저, 진동은 그 뒤(진동 바로 앞이 방향 입력)", before.length === 3 && before.every((x) => x?.startsWith("key:")), before.join(" "));

  const dead = await pressTimed(page, [
    [200, "pointerdown", 1, S, 0, 0],
    [30, "pointermove", 1, S, 0.1, 0],
    [30, "pointermove", 1, S, -0.1, 0.05],
    [30, "pointermove", 1, S, 0.05, -0.15],
    [30, "pointermove", 1, S, 0.2, 0.1],
    [30, "pointermove", 1, S, -0.15, -0.15],
    [30, "pointerup", 1, S, 0, 0],
  ]);
  ok(`방향: 죽은 영역(25%) 안 흔들림 → 입력 0 · 진동 0(${buzzes(dead)})`, buzzes(dead) === 0 && dirKeys(dead) === 0, dead.join(" "));

  const flickerSteps = (a, b, n, wait) => Array.from({ length: n }, (_, i) => [wait, "pointermove", 1, S, ...(i % 2 ? a : b)]);
  const edge = await pressTimed(page, [[200, "pointerdown", 1, S, 0.2, 0], ...flickerSteps([0.2, 0], [0.3, 0], 16, 8), [60, "pointerup", 1, S, 0.2, 0]]);
  ok(`방향: 죽은 영역 경계 떨림(8ms 마다 16번, 게임 입력 ${dirKeys(edge)}번) → 처음 들어갈 때 한 번뿐(${buzzes(edge)})`, buzzes(edge) === 1 && dirKeys(edge) >= 8, edge.join(" "));
  const rad = (deg) => [0.8 * Math.cos((deg * Math.PI) / 180), 0.8 * Math.sin((deg * Math.PI) / 180)];
  const sector = await pressTimed(page, [[200, "pointerdown", 1, S, ...rad(28)], [150, "pointermove", 1, S, ...rad(32)], ...flickerSteps(rad(32), rad(28), 16, 8), [60, "pointerup", 1, S, ...rad(28)]]);
  ok(`방향: 오른쪽 ↔ 오른쪽 아래 경계 떨림(8ms 마다 16번, 게임 입력 ${dirKeys(sector)}번) → 오른쪽·오른쪽 아래 처음 한 번씩만(${buzzes(sector)})`, buzzes(sector) === 2 && dirKeys(sector) >= 8, sector.join(" "));
  await page.evaluate(() => (window.__buzzAt.length = 0));
  const wobble = await pressTimed(page, [[200, "pointerdown", 1, S, ...rad(28)], ...flickerSteps(rad(28), rad(32), 14, 50), [60, "pointerup", 1, S, ...rad(28)]]);
  const gaps = await page.evaluate(() => window.__buzzAt.map((t, i, a) => (i ? Math.round(t - a[i - 1]) : 0)).slice(1));
  ok(`방향: 느린 떨림(50ms 마다 14번) → 진동 사이 100ms 이상(${buzzes(wobble)}번, 간격 ${gaps.join("·") || "-"}ms)`, buzzes(wobble) >= 2 && gaps.every((g) => g >= 99), wobble.join(" "));

  await page.evaluate(() => window.webgba.pad.setMode("dpad"));
  const dpad = await pressTimed(page, [
    [200, "pointerdown", 1, S, 0.8, 0],
    [120, "pointermove", 1, S, 0, 0.8],
    [120, "pointerup", 1, S, 0, 0.8],
    [120, "pointerdown", 1, S, -0.8, 0],
    [120, "pointermove", 1, S, -0.85, 0.05],
    [60, "pointerup", 1, S, -0.85, 0.05],
  ]);
  ok(`방향: 십자 패드 오른쪽 · → 아래 · 손 떼고 왼쪽 마다 한 번씩(합 ${buzzes(dpad)}) · 같은 칸 안 움직임 0`, buzzes(dpad) === 3, dpad.join(" "));
  await page.evaluate(() => window.webgba.pad.setMode("stick"));
  const aOnly = await press(page, tap('[data-key="A"]'));
  ok(`방향: 방향 진동만 켜면 A → 진동 0(${buzzes(aOnly)})`, buzzes(aOnly) === 0 && aOnly.some((x) => x.startsWith("key:")), aOnly.join(" "));
  await flip(page, "버튼 진동");
  await page.waitForTimeout(400);
  const both = await pressTimed(page, [[200, "pointerdown", 1, S, 0.8, 0], [120, "pointerdown", 2, '[data-key="A"]'], [60, "pointerup", 2, '[data-key="A"]'], [60, "pointerup", 1, S, 0.8, 0]]);
  ok(`방향: 둘 다 켜면 방향 한 번 + A 한 번(합 ${buzzes(both)})`, buzzes(both) === 2, both.join(" "));

  // 스틱 움직임(pointermove) 처리 시간: 방향 진동 켬·끔을 50번씩 번갈아 20묶음, 한 번 평균(µs) — 움직일 때마다 방향이 바뀜
  const timing = await page.evaluate(() => {
    const root = document.getElementById("pad");
    const r = document.querySelector("[data-dpad]").getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = Math.min(r.width, r.height) / 2;
    const at = (x, y) => ({ clientX: cx + x * rad, clientY: cy + y * rad, pointerType: "touch", bubbles: true, cancelable: true, pointerId: 9 });
    const prefs = window.webgba.state.prefs;
    const sum = { on: 0, off: 0 };
    const count = { on: 0, off: 0 };
    root.dispatchEvent(new PointerEvent("pointerdown", at(0, 0)));
    for (let block = 0; block < 20; block++) {
      const mode = block % 2 ? "on" : "off";
      prefs.vibrateDir = mode === "on";
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        window.dispatchEvent(new PointerEvent("pointermove", i % 2 ? at(0.8, 0) : at(0, -0.8)));
        sum[mode] += performance.now() - t0;
        count[mode]++;
      }
    }
    window.dispatchEvent(new PointerEvent("pointerup", at(0, 0)));
    prefs.vibrateDir = true;
    return { on: +((sum.on / count.on) * 1000).toFixed(1), off: +((sum.off / count.off) * 1000).toFixed(1), moves: count.on + count.off };
  });
  ok(`방향: 스틱 움직임 처리 시간 한 번 평균 방향 진동 켬 ${timing.on}µs · 끔 ${timing.off}µs(${timing.moves}번)`, timing.on - timing.off < 100, JSON.stringify(timing));
  fs.writeFileSync(path.join(SHOTS, "방향진동_움직임_처리시간.json"), JSON.stringify(timing, null, 2));
  ok("방향: 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// 2) PC(마우스, pointer fine): navigator.vibrate 가 있어도 회색 + "지원하지 않습니다", 설정이 켜져 있어도 진동 없음
{
  const { context, page } = await open({ mobile: false, prefs: { vibrate: true, vibrateDir: true } });
  const row = await vibrateRow(page);
  ok("PC: \"버튼 진동\" 회색(누를 수 없음) · \"이 기기는 진동을 지원하지 않습니다\"", row && row.disabled && row.off && row.checked === "false" && row.note === "이 기기는 진동을 지원하지 않습니다" && row.opacity < 1, JSON.stringify(row));
  const dirRow = await vibrateRow(page, "방향 진동");
  ok("PC: \"방향 진동\"도 회색 · 같은 안내", dirRow && dirRow.disabled && dirRow.off && dirRow.checked === "false" && dirRow.note === "이 기기는 진동을 지원하지 않습니다" && dirRow.opacity < 1, JSON.stringify(dirRow));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "설정_버튼진동_PC_지원안함.png") });
  const clicked = await page.evaluate(() => {
    [...document.querySelectorAll(".switch")].find((n) => n.getAttribute("aria-label") === "버튼 진동").click();
    document.getElementById("sheetClose").click();
    return JSON.parse(localStorage.getItem("webgba.prefs")).vibrate;
  });
  await page.waitForTimeout(400);
  const log = await press(page, tap('[data-key="A"]'));
  ok(`PC: 눌러도 값 안 바뀜 · A 눌러도 진동 0(${buzzes(log)})`, clicked === true && buzzes(log) === 0, log.join(" "));
  const pcStick = await pressTimed(page, STICK_ROUTE);
  ok(`PC: 방향 진동이 켜진 설정이어도 스틱 방향 → 진동 0(방향 입력 ${dirKeys(pcStick)}번)`, buzzes(pcStick) === 0 && dirKeys(pcStick) > 0, pcStick.join(" "));
  ok("PC: 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// 3) 기기별 판정(hapticKind) · iOS 스위치 방식 요소
{
  const { context, page } = await open({ mobile: true });
  const kinds = await page.evaluate(async () => {
    const { hapticKind, buzz } = await import("/js/pad.js");
    const win = (coarse, sw = true) => ({ matchMedia: () => ({ matches: coarse }), HTMLInputElement: { prototype: sw ? { switch: false } : {} } });
    const nav = (ua, vibrate = false) => ({ userAgent: ua, ...(vibrate ? { vibrate() {} } : {}) });
    const iphone = (os, version) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)${version ? ` Version/${version}` : ""} Mobile/15E148${version ? " Safari/604.1" : ""}`;
    const cases = {
      "안드로이드 크롬": hapticKind(nav("Mozilla/5.0 (Linux; Android 15; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36", true), win(true)),
      "안드로이드 파이어폭스(진동 API 없음)": hapticKind(nav("Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0"), win(true)),
      "PC 크롬(진동 API 있음·마우스)": hapticKind(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", true), win(false)),
      "아이폰 사파리 17.4": hapticKind(nav(iphone("17_4", "17.4")), win(true)),
      "아이폰 사파리 18.2": hapticKind(nav(iphone("18_2", "18.2")), win(true)),
      "아이폰 홈 화면 앱 18.3": hapticKind(nav(iphone("18_3")), win(true)),
      "아이폰 사파리 26.3": hapticKind(nav(iphone("18_6", "26.3")), win(true)),
      "아이폰 사파리 26.4": hapticKind(nav(iphone("18_6", "26.4")), win(true)),
      "아이폰 사파리 26.5": hapticKind(nav(iphone("18_6", "26.5")), win(true)),
      "아이폰 홈 화면 앱 26.x(OS 18_6 고정)": hapticKind(nav(iphone("18_6")), win(true)),
      "아이폰 스위치 없음": hapticKind(nav(iphone("18_2", "18.2")), win(true, false)),
      "아이패드(맥 UA)": hapticKind(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"), win(true)),
    };
    const added = [];
    const watch = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node.tagName === "LABEL") added.push({ hidden: node.style.display, aria: node.getAttribute("aria-hidden"), input: node.querySelector("input")?.type, sw: node.querySelector("input")?.hasAttribute("switch") });
    });
    watch.observe(document.head, { childList: true });
    const clicks = [];
    const toggles = [];
    const onClick = (event) => clicks.push(`${event.target.tagName}${event.target.hasAttribute?.("switch") ? "[switch]" : ""}`);
    const onChange = (event) => toggles.push(event.target.checked);
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    const before = document.activeElement;
    buzz("switch");
    buzz("switch");
    await new Promise((done) => setTimeout(done, 0));
    watch.disconnect();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    return { cases, added, clicks, toggles, left: document.head.querySelectorAll("label").length, focus: document.activeElement === before };
  });
  const want = { "안드로이드 크롬": "vibrate", "안드로이드 파이어폭스(진동 API 없음)": "", "PC 크롬(진동 API 있음·마우스)": "", "아이폰 사파리 17.4": "", "아이폰 사파리 18.2": "switch", "아이폰 홈 화면 앱 18.3": "switch", "아이폰 사파리 26.3": "switch", "아이폰 사파리 26.4": "switch", "아이폰 사파리 26.5": "", "아이폰 홈 화면 앱 26.x(OS 18_6 고정)": "", "아이폰 스위치 없음": "", "아이패드(맥 UA)": "" };
  const wrong = Object.keys(want).filter((name) => kinds.cases[name] !== want[name]);
  ok(`기기별 판정 ${Object.keys(want).length}가지(안드로이드 = vibrate, 아이폰 18.0~26.4 = switch, 그 밖 = 없음)`, wrong.length === 0, wrong.length ? wrong.map((n) => `${n}: ${kinds.cases[n]}`).join(", ") : Object.entries(kinds.cases).map(([n, v]) => `${n}=${v || "없음"}`).join(" · "));
  const { cases, ...switchRun } = kinds;
  ok(
    "iOS 스위치 방식(ios-haptics 와 같은 순서): 누를 때마다 숨긴 label > checkbox switch 를 head 에 넣고 label 을 눌러 스위치를 바꾼 뒤 바로 뺌 · 초점 그대로",
    switchRun.added.length === 2 && switchRun.added.every((x) => x.hidden === "none" && x.aria === "true" && x.input === "checkbox" && x.sw) && switchRun.clicks.join() === "LABEL,INPUT[switch],LABEL,INPUT[switch]" && switchRun.toggles.join() === "true,true" && switchRun.left === 0 && switchRun.focus,
    JSON.stringify(switchRun),
  );
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(SHOTS, "버튼진동_결과.json"), JSON.stringify(results, null, 2));
console.log(`결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
