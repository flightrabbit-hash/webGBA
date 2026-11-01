// 웹 webGBA 퀵슬롯 시험(로컬 전용): 저장·불러오기·덮어쓰기 확인·9번 자동 저장·게임별 분리·게임 지울 때 함께 지움·.wgba 회색.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-quick.mjs <주소> <캡처 폴더> --gba <롬.gba> [--wgba <게임.wgba>] [--chrome <chrome.exe>]
// 롬은 읽기만 하고 브라우저에 바로 넘긴다(복사·전송 없음). 캡처는 세로·가로 퀵슬롯 창과 설정 3장만.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodePng } from "./png.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const URL_BASE = args[0];
const SHOTS = args[1];
const opt = {};
for (let i = 2; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const romBytes = fs.readFileSync(opt.gba);

async function newPage(viewport) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    localStorage.setItem("webgba.installHint", "1");
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && page.errors.push(message.text()));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 20000 });
  return { context, page };
}

const waitGame = (page, timeout = 90000) => page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout });
// 퀵슬롯을 묶는 id(설명서가 있는 .wgba 는 게임 id, 그 밖은 보관 id)
const gameId = (page) => page.evaluate(() => window.webgba.state.game?.saveId ?? "");
const frameNow = (page) => page.evaluate(() => window.webgba.player.host.ex.Web_GetFrameCount() >>> 0);
const slotsOf = (page, id) => page.evaluate(async (id) => (await window.webgba.store.states(id)).map((s) => ({ slot: s.slot, saved: s.saved, auto: s.auto, size: s.size, thumb: s.thumb?.byteLength ?? 0 })).sort((a, b) => a.slot - b.slot), id);

async function openGame(page, name, file) {
  const started = await page.evaluate(() => document.body.dataset.view === "game");
  if (started && (await page.isVisible("#btnMenu"))) {
    await page.click("#btnMenu");
    await page.waitForSelector(".bar__group--files #btnOpen", { state: "visible" });
  }
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click(started ? "#btnOpen" : "#startOpen")]);
  await chooser.setFiles(file ?? { name, mimeType: "application/octet-stream", buffer: romBytes });
  await page.waitForFunction((name) => window.webgba.state.game?.name === name && window.webgba.player.running, name, { timeout: 90000 });
  await page.waitForTimeout(300);
}

async function openQuick(page) {
  await page.click("#btnQuick");
  await page.waitForSelector('#sheet:not([hidden]) .slots .slot[data-slot="9"]', { timeout: 5000 });
  await page.waitForTimeout(250);
}

async function closeSheet(page) {
  if (await page.isVisible("#sheet")) {
    await page.click("#sheetClose");
    await page.waitForTimeout(250);
  }
}

const cardState = (page) => page.evaluate(() => [...document.querySelectorAll(".slots .slot")].map((n) => ({ slot: Number(n.dataset.slot), disabled: n.disabled, empty: Boolean(n.querySelector(".slot__shot.is-empty")), img: Boolean(n.querySelector(".slot__img")) })));

function inkCheck(image, dpr, box) {
  const x0 = Math.round((box.left + (box.inset ?? 3)) * dpr);
  const x1 = Math.round((box.right - (box.inset ?? 3)) * dpr);
  // 위·아래 가장자리 1 화소는 소수 위치의 경계 번짐(사진 끝·둥근 모서리)이라 양쪽 같게 뺀다
  const y0 = Math.round(box.top * dpr) + 1;
  const y1 = Math.round(box.bottom * dpr) - 1;
  const counts = new Map();
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const o = (y * image.width + x) * 4;
    const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bg = 0;
  let best = -1;
  for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++) {
    let ink = false;
    for (let x = x0; x < x1 && !ink; x++) {
      const o = (y * image.width + x) * 4;
      if (Math.max(Math.abs(image.data[o] - (bg >> 16)), Math.abs(image.data[o + 1] - ((bg >> 8) & 255)), Math.abs(image.data[o + 2] - (bg & 255))) > 48) ink = true;
    }
    if (ink) {
      if (first < 0) first = y;
      last = y;
    }
  }
  if (first < 0) return null;
  return { top: (first - y0) / dpr, bottom: (y1 - 1 - last) / dpr };
}

async function inkRows(page, key, selector, limit = 12) {
  const image = decodePng(await page.screenshot());
  const dpr = await page.evaluate(() => devicePixelRatio);
  const list = await page.evaluate(
    ([selector, limit]) =>
      [...document.querySelectorAll(selector)]
        .filter((n) => n.offsetParent !== null)
        .slice(0, limit)
        .map((n) => {
          // 글자 줄은 centerInk 가 translate 로 옮기므로, 그 줄이 차지하는 칸(카드에서 사진 아래)을 잰다
          if (n.classList.contains("slot__time")) {
            const slot = n.closest(".slot");
            const card = slot.getBoundingClientRect();
            const cs = getComputedStyle(slot);
            const shot = n.previousElementSibling.getBoundingClientRect();
            return { left: card.left + parseFloat(cs.borderLeftWidth), right: card.right - parseFloat(cs.borderRightWidth), top: shot.bottom, bottom: card.bottom - parseFloat(cs.borderBottomWidth), inset: 10 };
          }
          const r = n.getBoundingClientRect();
          const s = getComputedStyle(n);
          return { left: r.left + parseFloat(s.borderLeftWidth), right: r.right - parseFloat(s.borderRightWidth), top: r.top + parseFloat(s.borderTopWidth), bottom: r.bottom - parseFloat(s.borderBottomWidth), inset: Math.max(3, Math.min(parseFloat(s.borderTopLeftRadius) || 0, 16)) };
        }),
    [selector, limit],
  );
  let worst = 0;
  let measured = 0;
  const each = [];
  for (const box of list) {
    const m = inkCheck(image, dpr, box);
    if (!m) continue;
    measured++;
    each.push(`${m.top}/${m.bottom}`);
    worst = Math.max(worst, Math.abs(m.top - m.bottom));
  }
  ok(`${key} ${selector} 잉크 세로 가운데(${measured}개)`, measured > 0 && worst <= 1, `최대 차이 ${worst}px · 위/아래 ${each.join(" ")}`);
}

async function layoutChecks(page, key, width, height) {
  const info = await page.evaluate(() => {
    const box = (n) => {
      const r = n.getBoundingClientRect();
      return { id: n.id || n.className, l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    const tools = [...document.querySelectorAll(".bar .tool, #btnMenu")].filter((n) => n.offsetParent !== null && !n.hidden && getComputedStyle(n).visibility !== "hidden").map(box);
    const panel = document.querySelector(".sheet__panel");
    const cards = [...document.querySelectorAll(".slots .slot")].map(box);
    const clipped = [...document.querySelectorAll(".slot__time, .seg__label, .slot__empty")].filter((n) => n.offsetParent !== null && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
    return { tools, panel: panel && !document.getElementById("sheet").hidden ? box(panel) : null, cards, clipped };
  });
  const overlap = (list) => list.some((x, i) => list.some((y, j) => j > i && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5));
  ok(`${key} 위 막대 버튼 겹침 0·화면 안`, !overlap(info.tools) && info.tools.every((x) => x.l >= -0.5 && x.r <= width + 0.5), info.tools.map((x) => `${x.id}:${Math.round(x.l)}-${Math.round(x.r)}`).join(" "));
  if (info.panel) {
    ok(`${key} 퀵슬롯 창 화면 안`, info.panel.t >= -0.5 && info.panel.b <= height + 0.5 && info.panel.l >= -0.5 && info.panel.r <= width + 0.5, JSON.stringify(info.panel));
    ok(`${key} 칸 9개 겹침 0`, info.cards.length === 9 && !overlap(info.cards));
    ok(`${key} 칸 글자 잘림 0`, info.clipped.length === 0, info.clipped.join(","));
    const minSide = Math.min(...info.cards.map((c) => Math.min(c.r - c.l, c.b - c.t)));
    ok(`${key} 칸 터치 영역 44px 이상`, minSide >= 44, `가장 짧은 변 ${minSide.toFixed(1)}px`);
  }
  return info;
}

// ── 세로 390x844 ──
{
  const { context, page } = await newPage({ width: 390, height: 844 });
  ok("시작 화면: 퀵슬롯 버튼 회색(게임 없음)", (await page.getAttribute("#btnQuick", "aria-disabled")) === "true");
  await page.click("#btnQuick", { force: true });
  await page.waitForTimeout(200);
  ok("게임 없이 누르면 안내만(창 안 열림)", (await page.isHidden("#sheet")) && /게임을 연 뒤/.test(await page.textContent("#toast")));

  await openGame(page, "QuickTest A.gba");
  const idA = await gameId(page);
  ok(".gba: 퀵슬롯 버튼 켜짐", (await page.getAttribute("#btnQuick", "aria-disabled")) === "false");
  const place = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { menu: r("btnMenu"), quick: r("btnQuick") };
  });
  ok("세로: 퀵슬롯 버튼은 햄버거 바로 오른쪽 위 막대", place.quick.left > place.menu.right && place.quick.left - place.menu.right < 16 && Math.abs(place.quick.top - place.menu.top) < 2, `햄버거 오른쪽 ${place.menu.right.toFixed(0)} → 퀵슬롯 왼쪽 ${place.quick.left.toFixed(0)}`);
  await page.waitForTimeout(800);

  await openQuick(page);
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".seg__btn")].map((n) => [n.dataset.tab, n.getAttribute("aria-selected")]));
  ok("창: 처음 탭은 저장", JSON.stringify(tabs) === JSON.stringify([["save", "true"], ["load", "false"]]), JSON.stringify(tabs));
  let cards = await cardState(page);
  ok("저장 탭: 1~8 누를 수 있음·9 회색·모두 빈 칸", cards.length === 9 && cards.slice(0, 8).every((c) => !c.disabled) && cards[8].disabled && cards.every((c) => c.empty), JSON.stringify(cards.map((c) => c.disabled)));
  ok("창이 열린 동안 게임 멈춤", await page.evaluate(() => window.webgba.player.paused));

  const savedFrame = await frameNow(page);
  await page.click('.slot[data-slot="1"]');
  await page.waitForTimeout(600);
  ok("빈 칸 저장: 확인 없이 저장하고 창 닫힘", (await page.isHidden("#sheet")) && (await page.isHidden("#dialog")));
  let list = await slotsOf(page, idA);
  ok("1번 칸 저장(상태 바이트·화면 사진)", list.length === 1 && list[0].slot === 1 && list[0].size > 100000 && list[0].thumb > 500 && !list[0].auto, JSON.stringify(list));

  // 상태에는 게임 안 세이브 내용이 들어가지 않는다 — 저장 뒤 세이브 메모리를 바꾸고 불러와도 그대로인지
  const flashMark = await page.evaluate(() => {
    const host = window.webgba.player.host;
    const at = (host.ex.Web_GetFlash() >>> 0) + 0x1f000;
    host.u8[at] ^= 0x5a;
    return host.u8[at];
  });
  const savBefore = await page.evaluate(async (id) => Array.from((await window.webgba.store.saveBytes(id)) ?? []).length, idA);
  await page.waitForTimeout(1500);
  const runFrame = await frameNow(page);
  ok("저장 뒤 게임 계속 돎", runFrame > savedFrame + 30, `${savedFrame} → ${runFrame}`);

  await openQuick(page);
  await page.click('.seg__btn[data-tab="load"]');
  await page.waitForTimeout(150);
  cards = await cardState(page);
  ok("불러오기 탭: 1번만 켜짐(빈 칸·9번 회색)", !cards[0].disabled && cards.slice(1).every((c) => c.disabled) && cards[0].img, JSON.stringify(cards.map((c) => c.disabled)));
  await page.click('.slot[data-slot="1"]');
  await page.waitForSelector("#dialog:not([hidden])");
  ok("불러오기는 확인 한 번", /불러올까요/.test(await page.textContent("#dialogTitle")));
  await page.click("#dialogActions .btn--primary");
  await page.waitForTimeout(400);
  const loadedFrame = await frameNow(page);
  ok("불러오기: 저장한 순간으로 돌아감(프레임 번호)", loadedFrame < runFrame - 30 && loadedFrame >= savedFrame && loadedFrame - savedFrame < 40, `저장 ${savedFrame} · 불러오기 전 ${runFrame} · 뒤 ${loadedFrame}`);
  const flashAfter = await page.evaluate(() => {
    const host = window.webgba.player.host;
    return host.u8[(host.ex.Web_GetFlash() >>> 0) + 0x1f000];
  });
  const savAfter = await page.evaluate(async (id) => Array.from((await window.webgba.store.saveBytes(id)) ?? []).length, idA);
  ok("불러오기는 게임 안 세이브(.sav)를 바꾸지 않음", flashAfter === flashMark && savAfter === savBefore, `세이브 메모리 ${flashMark} → ${flashAfter} · 보관 .sav ${savBefore} → ${savAfter}바이트`);
  ok("불러온 뒤 창 닫히고 게임 이어서 돎", (await page.isHidden("#sheet")) && !(await page.evaluate(() => window.webgba.player.paused)));

  // 덮어쓰기는 확인 한 번(취소하면 그대로)
  await page.waitForTimeout(400);
  const first = (await slotsOf(page, idA))[0].saved;
  await openQuick(page);
  ok("다시 열면 지난 탭(불러오기) 그대로", await page.evaluate(() => document.querySelector('.seg__btn[data-tab="load"]').getAttribute("aria-selected") === "true"));
  await page.click('.seg__btn[data-tab="save"]');
  await page.click('.slot[data-slot="1"]');
  await page.waitForSelector("#dialog:not([hidden])");
  ok("덮어쓰기 확인 창", /덮어쓸까요/.test(await page.textContent("#dialogTitle")));
  await page.click("#dialogActions .btn:not(.btn--primary)");
  await page.waitForTimeout(250);
  ok("덮어쓰기 취소하면 그대로", (await slotsOf(page, idA))[0].saved === first && (await page.isVisible("#sheet")));
  await page.click('.slot[data-slot="1"]');
  await page.waitForSelector("#dialog:not([hidden])");
  await page.click("#dialogActions .btn--primary");
  await page.waitForTimeout(600);
  ok("덮어쓰기 확인하면 새 시각", (await slotsOf(page, idA))[0].saved > first);
  await openQuick(page);
  await page.click('.slot[data-slot="3"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => (window.webgba.state.quick.tab = "save"));

  // 설정: 자동 저장 기본 5분, 바꾸기
  await page.click("#btnSettings");
  await page.waitForSelector("#sheet:not([hidden])");
  await page.waitForTimeout(300);
  const autoField = await page.evaluate(() => {
    const field = [...document.querySelectorAll(".field")].find((f) => /자동 저장/.test(f.textContent));
    if (!field) return null;
    const pick = field.querySelector(".pick");
    return { value: pick.dataset.value, options: [...pick.querySelectorAll(".pick__size")].map((o) => o.textContent) };
  });
  ok("설정: 자동 저장 끔/1/3/5/10/15/30분, 기본 5분", autoField?.value === "5" && autoField.options.join(",") === "끔,1분,3분,5분,10분,15분,30분", JSON.stringify(autoField));
  await page.evaluate(() => [...document.querySelectorAll(".field")].find((f) => /자동 저장/.test(f.textContent)).scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, "설정_자동저장_세로_390x844.png") });
  await page.click('.pick[aria-label="자동 저장"]');
  await page.waitForSelector('#choice:not([hidden]) .choice__opt[data-value="1"]');
  await page.click('.choice__opt[data-value="1"]');
  await page.waitForFunction(() => !window.webgba.state.choiceDone);
  ok("설정 바꾸면 저장", await page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs")).autoSave === 1));

  // 창이 열린 동안은 시간을 세지 않음
  await page.evaluate(() => (window.webgba.state.quick.played = 59000));
  await page.waitForTimeout(2500);
  ok("창(설정)이 열린 동안 자동 저장 시간 안 셈", (await page.evaluate(() => window.webgba.state.quick.played)) === 59000 && !(await slotsOf(page, idA)).some((s) => s.slot === 9));
  await closeSheet(page);

  // 자동 저장 + 멈춤 측정(프레임 간격)
  await page.evaluate(() => {
    const gaps = (window.__gaps = []);
    let last = performance.now();
    const loop = (now) => {
      gaps.push([now, now - last]);
      last = now;
      if (gaps.length < 20000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const timings = [];
  for (let i = 0; i < 5; i++) {
    const before = await page.evaluate(() => window.webgba.state.quick.autoCount);
    await page.evaluate(() => (window.webgba.state.quick.played = 59200));
    await page.waitForFunction((n) => window.webgba.state.quick.autoCount > n, before, { timeout: 5000 });
    await page.waitForTimeout(300);
    timings.push(await page.evaluate(() => ({ at: performance.now(), sync: window.webgba.state.quick.syncMs, all: window.webgba.state.quick.lastMs })));
    await page.waitForTimeout(700);
  }
  list = await slotsOf(page, idA);
  const auto = list.find((s) => s.slot === 9);
  ok("자동 저장: 9번 칸(자동 표시·화면 사진)", auto && auto.auto && auto.thumb > 500, JSON.stringify(auto));
  const gapInfo = await page.evaluate((marks) => {
    const gaps = window.__gaps;
    const near = (t) => gaps.filter(([at]) => at > t - 1400 && at <= t).map(([, g]) => g);
    const around = marks.map((t) => Math.max(...near(t)));
    const quiet = gaps.filter(([at]) => marks.every((t) => Math.abs(at - t) > 1500)).map(([, g]) => g).sort((a, b) => a - b);
    return { around, quietMax: quiet[quiet.length - 1] ?? 0, quietP99: quiet[Math.floor(quiet.length * 0.99)] ?? 0, n: gaps.length };
  }, timings.map((x) => x.at));
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const syncAvg = avg(timings.map((x) => x.sync));
  const allAvg = avg(timings.map((x) => x.all));
  ok(
    "자동 저장 순간 멈춤이 눈에 띄지 않음(프레임 간격 최대 50ms 미만)",
    Math.max(...gapInfo.around) < 50,
    `상태 뜨기(동기) 평균 ${syncAvg.toFixed(2)}ms · 보관 끝까지 평균 ${allAvg.toFixed(1)}ms · 저장 때 프레임 간격 최대 ${gapInfo.around.map((g) => g.toFixed(1)).join("/")}ms · 평소 최대 ${gapInfo.quietMax.toFixed(1)}ms(99% ${gapInfo.quietP99.toFixed(1)}ms)`,
  );
  ok("자동 저장 뒤 시간 다시 셈", (await page.evaluate(() => window.webgba.state.quick.played)) < 5000);
  ok("자동 저장 뒤 게임 계속(멈춤 0)", !(await page.evaluate(() => window.webgba.player.paused)));

  // 화면이 숨으면 안 셈
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    window.webgba.state.quick.played = 1000;
  });
  await page.waitForTimeout(2200);
  ok("화면이 숨은 동안 안 셈", (await page.evaluate(() => window.webgba.state.quick.played)) === 1000);
  await page.evaluate(() => delete document.visibilityState);

  // 사람은 9번 칸에 저장 못 함
  await openQuick(page);
  await page.click('.seg__btn[data-tab="save"]');
  const nine = await page.evaluate(() => document.querySelector('.slot[data-slot="9"]'));
  ok("저장 탭 9번 칸 회색·누를 수 없음", await page.evaluate(() => document.querySelector('.slot[data-slot="9"]').disabled));
  ok("9번 칸 '자동' 표시", await page.evaluate(() => document.querySelector('.slot[data-slot="9"] .slot__num').textContent === "자동"));
  void nine;
  const blocked = await page.evaluate(async () => {
    const before = (await window.webgba.store.states(window.webgba.state.game.id)).find((s) => s.slot === 9).saved;
    return { before };
  });
  await page.evaluate(() => document.querySelector('.slot[data-slot="9"]').click());
  await page.waitForTimeout(300);
  ok("9번 칸 눌러도 저장 안 됨", (await slotsOf(page, idA)).find((s) => s.slot === 9).saved === blocked.before && (await page.isHidden("#dialog")));

  await layoutChecks(page, "세로 390x844", 390, 844);
  await inkRows(page, "세로 390x844", ".slot:not(:disabled) .slot__time", 9);
  await inkRows(page, "세로 390x844", ".seg__btn", 2);
  await inkRows(page, "세로 390x844", ".slot:not(:disabled) .slot__num", 9);
  await page.screenshot({ path: path.join(SHOTS, "퀵슬롯_세로_390x844.png") });
  await page.click('.seg__btn[data-tab="load"]');
  await page.waitForTimeout(200);
  await inkRows(page, "세로 390x844 불러오기", ".slot:not(:disabled) .slot__time", 9);
  await closeSheet(page);

  // 게임별 분리
  await openGame(page, "QuickTest B.gba");
  const idB = await gameId(page);
  ok("두 번째 게임은 다른 id", idB && idB !== idA);
  await openQuick(page);
  await page.click('.seg__btn[data-tab="load"]');
  cards = await cardState(page);
  ok("두 번째 게임: 빈 칸뿐(A 칸 안 보임)", cards.every((c) => c.disabled && c.empty), JSON.stringify(cards.map((c) => c.empty)));
  await page.click('.seg__btn[data-tab="save"]');
  await page.click('.slot[data-slot="2"]');
  await page.waitForTimeout(600);
  const listA = await slotsOf(page, idA);
  const listB = await slotsOf(page, idB);
  ok("칸이 게임마다 따로", listA.map((s) => s.slot).join(",") === "1,3,9" && listB.map((s) => s.slot).join(",") === "2", `A ${listA.map((s) => s.slot)} · B ${listB.map((s) => s.slot)}`);

  // 게임 지우면 그 게임 칸도 지움
  await page.click("#btnMenu");
  await page.waitForSelector(".bar__group--files #btnLibrary", { state: "visible" });
  await page.click("#btnLibrary");
  await page.waitForSelector("#sheet:not([hidden])");
  await page.waitForTimeout(300);
  const keyA = `rom:${idA}`;
  // 라이브러리 책장에서 A 롬팩을 꺼내(이미 꺼냈으면 그대로) 꺼낸 칸의 지우기
  if ((await page.getAttribute(`.spine[data-key="${keyA}"]`, "aria-pressed")) !== "true") await page.click(`.spine[data-key="${keyA}"]`);
  await page.waitForSelector(`.lib__card[data-key="${keyA}"] [data-action="delete"]`);
  await page.click(`.lib__card[data-key="${keyA}"] [data-action="delete"]`);
  await page.waitForSelector("#dialog:not([hidden])");
  ok("지우기 확인 글에 퀵슬롯도 지운다는 말", /퀵슬롯/.test(await page.textContent("#dialogBody")));
  await page.click("#dialogActions .btn--danger");
  await page.waitForTimeout(700);
  const afterA = await slotsOf(page, idA);
  const afterB = await slotsOf(page, idB);
  const rawLeft = await page.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("webgba");
      r.onsuccess = () => resolve(r.result);
    });
    const count = (name) => new Promise((resolve) => {
      const req = db.transaction(name).objectStore(name).count(IDBKeyRange.bound(`state:${id}:`, `state:${id}:\uffff`));
      req.onsuccess = () => resolve(req.result);
    });
    const out = { meta: await count("meta"), data: await count("data") };
    db.close();
    return out;
  }, idA);
  ok("게임 A 지움 → A 칸 모두 지움(목록·바이트)·B 칸은 그대로", afterA.length === 0 && rawLeft.meta === 0 && rawLeft.data === 0 && afterB.length === 1, `A ${afterA.length} · 남은 기록 ${JSON.stringify(rawLeft)} · B ${afterB.length}`);
  await closeSheet(page);

  ok("세로 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// ── 가로 844x390 ──
{
  const { context, page } = await newPage({ width: 844, height: 390 });
  await openGame(page, "QuickTest C.gba");
  const id = await gameId(page);
  const place = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { saves: r("btnSaves"), quick: r("btnQuick"), fast: r("btnFast") };
  });
  ok("가로: 퀵슬롯 버튼은 세이브 바로 오른쪽", place.quick.left > place.saves.right && place.quick.left - place.saves.right < 8 && Math.abs(place.quick.top - place.saves.top) < 2, `세이브 오른쪽 ${place.saves.right.toFixed(0)} → 퀵슬롯 왼쪽 ${place.quick.left.toFixed(0)} · 빨리 감기 왼쪽 ${place.fast.left.toFixed(0)}`);
  for (const slot of [1, 2, 5]) {
    await page.waitForTimeout(500);
    await openQuick(page);
    await page.click(`.slot[data-slot="${slot}"]`);
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => (window.webgba.state.quick.played = 4 * 60000 + 59200));
  await page.waitForFunction(() => window.webgba.state.quick.autoCount > 0, null, { timeout: 5000 });
  ok("가로: 기본 5분 자동 저장 9번 칸", (await slotsOf(page, id)).some((s) => s.slot === 9 && s.auto));
  await page.waitForTimeout(500);
  await openQuick(page);
  const blockers = await page.evaluate(() => [document.getElementById("screen"), ...document.querySelectorAll("[data-key], [data-dpad]")].map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  const info = await layoutChecks(page, "가로 844x390", 844, 390);
  const bar = info.tools;
  ok("가로: 기능 버튼 8개 모두 보임·게임 화면/버튼과 안 겹침", bar.length === 8 && !bar.some((x) => blockers.some((y) => x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b)), bar.map((x) => x.id).join(","));
  const firstRows = await page.evaluate(() => {
    const body = document.querySelector(".sheet__body").getBoundingClientRect();
    return [...document.querySelectorAll(".slots .slot")].every((n) => n.getBoundingClientRect().bottom <= body.bottom + 0.5);
  });
  ok("가로: 탭과 9칸이 스크롤 없이 다 보임", firstRows);
  await inkRows(page, "가로 844x390", ".slot:not(:disabled) .slot__time", 9);
  await inkRows(page, "가로 844x390", ".seg__btn", 2);
  await page.screenshot({ path: path.join(SHOTS, "퀵슬롯_가로_844x390.png") });
  await closeSheet(page);
  ok("가로 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// ── 좁은 320px + 가장 넓은 시각 ──
// 갈무리11 숫자는 1만 5px(나머지 8px)이라 시각마다 폭이 달랐다(10/30 23:30 잘림). 저장 시각을 넓은 조합으로 바꿔 넣고
// 세로 320·360·390, 가로 높이 320·360·390 에서 칸 글자 잘림·넘침 0, 잉크 세로 가운데를 본다.
{
  const { context, page } = await newPage({ width: 320, height: 640 });
  await openGame(page, "QuickTest D.gba");
  const id = await gameId(page);
  for (const slot of [1, 2, 3, 4]) {
    await openQuick(page);
    await page.click('.seg__btn[data-tab="save"]');
    await page.click(`.slot[data-slot="${slot}"]`);
    await page.waitForTimeout(500);
  }
  const WIDE = [
    [1, new Date(2026, 7, 8, 8, 8)], // 08/08 08:08 — 숫자 모두 8px(가장 넓음)
    [2, new Date(2026, 9, 30, 23, 30)], // 10/30 23:30 — 실패했던 시각
    [3, new Date(2026, 11, 30, 8, 8)], // 12/30 08:08
    [4, new Date(2026, 10, 11, 11, 11)], // 11/11 11:11 — 비례폭이면 가장 좁음
  ].map(([slot, d]) => [slot, d.getTime()]);
  const patched = await page.evaluate(async ([id, list]) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("webgba");
      r.onsuccess = () => resolve(r.result);
    });
    let n = 0;
    for (const [slot, saved] of list) {
      const store = db.transaction("meta", "readwrite").objectStore("meta");
      const rec = await new Promise((resolve) => {
        const req = store.get(`state:${id}:${slot}`);
        req.onsuccess = () => resolve(req.result);
      });
      if (!rec) continue;
      rec.saved = saved;
      await new Promise((resolve) => {
        const req = store.put(rec);
        req.onsuccess = () => resolve();
      });
      n++;
    }
    db.close();
    return n;
  }, [id, WIDE]);
  ok("넓은 시각 4칸 넣음", patched === 4, `${patched}칸`);
  await openQuick(page);
  await page.click('.seg__btn[data-tab="save"]');
  await page.waitForTimeout(200);
  const texts = await page.evaluate(() => [1, 2, 3, 4].map((s) => document.querySelector(`.slot[data-slot="${s}"] .slot__time`).textContent.replace("\n", " ")));
  ok("넓은 시각이 칸에 보임", texts.join(",") === "08/08 08:08,10/30 23:30,12/30 08:08,11/11 11:11", texts.join(","));
  const VIEWS = [
    [320, 640, "세로 320x640"],
    [360, 640, "세로 360x640"],
    [390, 844, "세로 390x844"],
    [568, 320, "가로 568x320"],
    [640, 360, "가로 640x360"],
    [844, 390, "가로 844x390"],
  ];
  for (const [width, height, key] of VIEWS) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    if (!(await page.isVisible("#sheet"))) await openQuick(page);
    for (const tab of ["save", "load"]) {
      await page.click(`.seg__btn[data-tab="${tab}"]`);
      await page.waitForTimeout(250);
      const label = `${key} ${tab === "save" ? "저장" : "불러오기"}`;
      await layoutChecks(page, label, width, height);
      const fit = await page.evaluate(() =>
        [...document.querySelectorAll(".slot__time")].map((n) => {
          const card = n.closest(".slot").getBoundingClientRect();
          const r = n.getBoundingClientRect();
          return { text: n.textContent.replace("\n", "⏎"), lines: Math.round((n.clientHeight - parseFloat(getComputedStyle(n).paddingTop) - parseFloat(getComputedStyle(n).paddingBottom)) / parseFloat(getComputedStyle(n).lineHeight)), over: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1, inside: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.bottom <= card.bottom + 0.5 };
        }),
      );
      const bad = fit.filter((f) => f.over || !f.inside);
      const rows = [...new Set(fit.map((f) => f.lines))];
      ok(`${label} 칸 시각 넘침·칸 밖 0(${rows.join("/")}줄 칸)`, bad.length === 0, bad.map((f) => f.text).join(","));
      await inkRows(page, label, ".slot:not(:disabled) .slot__time", 9);
      if (width === 320 && tab === "save") await page.screenshot({ path: path.join(SHOTS, "퀵슬롯_320_시각.png") });
    }
  }
  await closeSheet(page);
  ok("320 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// ── .wgba(포트 wasm: 상태 저장 = 그 순간 + 그때의 게임 저장, 쓴 길이만 남김) ──
if (opt.wgba) {
  const { context, page } = await newPage({ width: 390, height: 844 });
  await openGame(page, path.basename(opt.wgba), opt.wgba);
  const idW = await gameId(page);
  ok(".wgba: 상태 저장 내보내기 있음", await page.evaluate(() => window.webgba.player.canState));
  ok(".wgba: 퀵슬롯 버튼 켜짐", (await page.getAttribute("#btnQuick", "aria-disabled")) === "false");
  await page.waitForTimeout(3000);
  const savedFrame = await frameNow(page);
  await openQuick(page);
  await page.click('.slot[data-slot="1"]');
  await page.waitForTimeout(600);
  let list = await slotsOf(page, idW);
  const full = await page.evaluate(() => window.webgba.player.host.ex.Web_StateSize() >>> 0);
  ok(".wgba: 1번 칸 저장(쓴 길이만 남김)", list.length === 1 && list[0].slot === 1 && list[0].size > 1000 && list[0].size < full / 4 && list[0].thumb > 500, `칸 ${list[0]?.size}바이트 · Web_StateSize ${full}`);
  await page.waitForTimeout(1500);
  const runFrame = await frameNow(page);
  await openQuick(page);
  await page.click('.seg__btn[data-tab="load"]');
  await page.waitForTimeout(150);
  await page.click('.slot[data-slot="1"]');
  await page.waitForSelector("#dialog:not([hidden])");
  await page.click("#dialogActions .btn--primary");
  await page.waitForTimeout(400);
  const loadedFrame = await frameNow(page);
  const kind = await page.evaluate(() => window.webgba.player.host.stateLoadedKind);
  ok(".wgba: 불러오기는 저장한 순간 그대로(같은 빌드)", kind === 1 && loadedFrame < runFrame - 30 && loadedFrame >= savedFrame && loadedFrame - savedFrame < 40 && /불러왔습니다/.test(await page.textContent("#toast")),
    `종류 ${kind} · 저장 ${savedFrame} · 불러오기 전 ${runFrame} · 뒤 ${loadedFrame} · ${await page.textContent("#toast")}`);
  // 자동 저장(9번) + 그때 프레임 간격
  await page.evaluate(() => {
    const gaps = (window.__gaps = []);
    let last = performance.now();
    const loop = (now) => {
      gaps.push([now, now - last]);
      last = now;
      if (gaps.length < 20000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const timings = [];
  for (let i = 0; i < 5; i++) {
    const before = await page.evaluate(() => window.webgba.state.quick.autoCount);
    await page.evaluate(() => (window.webgba.state.quick.played = 5 * 60000 - 800));
    await page.waitForFunction((n) => window.webgba.state.quick.autoCount > n, before, { timeout: 5000 });
    await page.waitForTimeout(300);
    timings.push(await page.evaluate(() => ({ at: performance.now(), sync: window.webgba.state.quick.syncMs, all: window.webgba.state.quick.lastMs })));
    await page.waitForTimeout(700);
  }
  list = await slotsOf(page, idW);
  const auto = list.find((s) => s.slot === 9);
  const gapInfo = await page.evaluate((marks) => {
    const gaps = window.__gaps;
    const near = (t) => gaps.filter(([at]) => at > t - 1400 && at <= t).map(([, g]) => g);
    const quiet = gaps.filter(([at]) => marks.every((t) => Math.abs(at - t) > 1500)).map(([, g]) => g).sort((a, b) => a - b);
    return { around: marks.map((t) => Math.max(...near(t))), quietMax: quiet[quiet.length - 1] ?? 0 };
  }, timings.map((x) => x.at));
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  ok(".wgba: 자동 저장 9번 칸(쓴 길이만)", auto && auto.auto && auto.size < full / 4 && auto.thumb > 500, JSON.stringify(auto));
  ok(
    ".wgba: 자동 저장 순간 멈춤이 눈에 띄지 않음(프레임 간격 최대 50ms 미만)",
    Math.max(...gapInfo.around) < 50,
    `상태 뜨기(동기) 평균 ${avg(timings.map((x) => x.sync)).toFixed(2)}ms · 보관 끝까지 평균 ${avg(timings.map((x) => x.all)).toFixed(1)}ms · 저장 때 프레임 간격 최대 ${gapInfo.around.map((g) => g.toFixed(1)).join("/")}ms · 평소 최대 ${gapInfo.quietMax.toFixed(1)}ms`,
  );
  ok(".wgba 페이지 오류 없음", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n퀵슬롯 시험 ${results.length - failed.length}/${results.length} 통과`);
fs.writeFileSync(path.join(SHOTS, "결과.json"), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
