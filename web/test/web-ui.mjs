// 웹 webGBA 화면 규칙 시험(로컬 전용): 팝업이 보이는 화면 안에 다 들어오는지, 같은 종류 줄의 높이·간격이 같은지,
// 줄·버튼 안 아이콘·글자가 잉크(보이는 픽셀) 기준 세로 가운데인지(위·아래 여백 차이 ≤ 1px).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-ui.mjs <주소> <캡처 폴더> [--chrome <chrome.exe>]
// 보관함 줄은 1KB 짜리 가짜 기록을 넣어 만든다(롬 아님).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodePng } from "./png.mjs";

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium, webkit } = require("playwright-core");

const [URL_BASE, SHOTS, ...rest] = process.argv.slice(2);
const chromeAt = rest.indexOf("--chrome");
const CHROME = chromeAt >= 0 ? rest[chromeAt + 1] : "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const VIEW_FILTER = process.env.UI_VIEWS ? new Set(process.env.UI_VIEWS.split(",")) : null;
const VIEWS_ALL = [
  { name: "390x844", viewport: { width: 390, height: 844 } },
  { name: "844x390", viewport: { width: 844, height: 390 } },
  { name: "360x640", viewport: { width: 360, height: 640 } },
];
const VIEWS = VIEWS_ALL.filter((view) => !VIEW_FILTER || VIEW_FILTER.has(view.name));
const LANGS = (process.env.UI_LANGS ?? "ko,en,ja").split(",");
const INK_THRESHOLD = Number(process.env.INK_THRESHOLD ?? 48);
// UI_MOTION_ONLY=1 이면 여닫기 움직임 시험만(UI_MOTION=0 이면 그것만 뺌). WebKit 이 설치돼 있으면 같은 시험을 WebKit 으로도.
const ONLY_MOTION = process.env.UI_MOTION_ONLY === "1";
// UI_EXTRA_ONLY=1 이면 C·D 버튼 시험만(UI_EXTRA=0 이면 그것만 뺌). UI_BASE_URL = 수정 전 빌드 주소(정의 없음 픽셀 비교).
const ONLY_EXTRA = process.env.UI_EXTRA_ONLY === "1";
const EXTRA = ONLY_EXTRA || (!ONLY_MOTION && process.env.UI_EXTRA !== "0");
const BASE_URL = process.env.UI_BASE_URL ?? "";
const SKIP_MAIN = ONLY_MOTION || ONLY_EXTRA;
const MOTION = !ONLY_EXTRA && (ONLY_MOTION || process.env.UI_MOTION !== "0");
const SHOT_PLAN = { "390x844|ko|bar": "", "844x390|ko|bar": "가로_844x390_기능버튼.png", "390x844|ko|menu": "세로_390x844_햄버거.png", "390x844|ko|settings": "세로_390x844_설정.png", "844x390|ko|library": "가로_844x390_보관함.png", "360x640|ko|rename": "세로_360x640_이름입력.png", "390x844|ja|saves": "세로_390x844_세이브_일본어.png" };

const results = [];
const table = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.log(`실패 ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function shoot(page) {
  return decodePng(await page.screenshot());
}

function inkCheck(image, dpr, box) {
  const x0 = Math.round((box.left + box.inset) * dpr);
  const x1 = Math.round((box.right - box.inset) * dpr);
  const y0 = Math.round(box.top * dpr);
  const y1 = Math.round(box.bottom * dpr);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const counts = new Map();
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const o = (y * image.width + x) * 4;
      const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bg = 0;
  let best = -1;
  for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
  const br = bg >> 16;
  const bgG = (bg >> 8) & 255;
  const bb = bg & 255;
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++) {
    let ink = false;
    for (let x = x0; x < x1 && !ink; x++) {
      const o = (y * image.width + x) * 4;
      if (Math.max(Math.abs(image.data[o] - br), Math.abs(image.data[o + 1] - bgG), Math.abs(image.data[o + 2] - bb)) > INK_THRESHOLD) ink = true;
    }
    if (ink) {
      if (first < 0) first = y;
      last = y;
    }
  }
  if (first < 0) return null;
  const top = (first - y0) / dpr;
  const bottom = (y1 - 1 - last) / dpr;
  return { top, bottom, diff: Math.abs(top - bottom) };
}

async function boxes(page, selector, { limit = 12 } = {}) {
  return page.evaluate(
    ([selector, limit]) => {
      const vh = window.visualViewport?.height ?? innerHeight;
      return [...document.querySelectorAll(selector)]
        .filter((node) => node.offsetParent !== null || getComputedStyle(node).position === "fixed")
        .slice(0, limit)
        .map((node) => {
          const r = node.getBoundingClientRect();
          const s = getComputedStyle(node);
          const bt = parseFloat(s.borderTopWidth);
          const bb = parseFloat(s.borderBottomWidth);
          const bl = parseFloat(s.borderLeftWidth);
          const radius = Math.max(parseFloat(s.borderTopLeftRadius) || 0, node.matches(".sheet__head") ? 16 : 0);
          return {
            label: node.className.split(" ")[0] + (node.dataset.action ? `[${node.dataset.action}]` : ""),
            left: r.left + bl,
            right: r.right - parseFloat(s.borderRightWidth),
            top: r.top + bt,
            bottom: r.bottom - bb,
            inset: Math.max(3, Math.min(radius, 16)),
            visible: (() => {
              let top = 0, bottom = vh;
              for (let at = node.parentElement; at; at = at.parentElement) {
                const o = getComputedStyle(at).overflowY;
                if (o === "auto" || o === "hidden" || o === "scroll") {
                  const c = at.getBoundingClientRect();
                  top = Math.max(top, c.top);
                  bottom = Math.min(bottom, c.bottom);
                }
              }
              return r.top >= top - 0.5 && r.bottom <= bottom + 0.5 && r.left >= 0 && r.right <= innerWidth;
            })(),
            height: r.height,
          };
        })
        .filter((b) => b.visible);
    },
    [selector, limit],
  );
}

async function measure(page, key, selectors) {
  const image = await shoot(page);
  const dpr = await page.evaluate(() => devicePixelRatio);
  for (const selector of selectors) {
    for (const box of await boxes(page, selector)) {
      const m = inkCheck(image, dpr, box);
      if (!m) continue;
      table.push({ key, target: box.label, top: m.top, bottom: m.bottom, diff: m.diff });
      ok(`${key} ${box.label} 잉크 세로 가운데`, m.diff <= 1, `위 ${m.top} · 아래 ${m.bottom}`);
    }
  }
}

async function fits(page, key, selector) {
  const info = await page.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? innerHeight;
    const buttons = [...node.querySelectorAll(".sheet__head button, .dialog__actions button, .loader__actions button")].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect());
    return { top: r.top, bottom: r.bottom, vh, vw: innerWidth, left: r.left, right: r.right, buttons: buttons.map((b) => [b.top, b.bottom, b.left, b.right]) };
  }, selector);
  if (!info) return ok(`${key} ${selector} 있음`, false);
  const inside = info.top >= -0.5 && info.bottom <= info.vh + 0.5 && info.left >= -0.5 && info.right <= info.vw + 0.5;
  const buttonsIn = info.buttons.every(([t, b, l, r]) => t >= -0.5 && b <= info.vh + 0.5 && l >= -0.5 && r <= info.vw + 0.5);
  ok(`${key} ${selector} 화면 안(잘림 0)`, inside && buttonsIn, `위 ${info.top.toFixed(1)} 아래 ${info.bottom.toFixed(1)} / 화면 ${info.vh}`);
}

async function rows(page, key, selector) {
  const info = await page.evaluate((selector) => {
    const nodes = [...document.querySelectorAll(selector)].filter((n) => n.offsetParent !== null);
    const r = nodes.map((n) => n.getBoundingClientRect());
    const heights = r.map((b) => +b.height.toFixed(2));
    const gaps = r.slice(1).map((b, i) => +(b.top - r[i].bottom).toFixed(2));
    return { heights, gaps };
  }, selector);
  if (info.heights.length < 2) return;
  const spread = (list) => (list.length ? Math.max(...list) - Math.min(...list) : 0);
  ok(`${key} ${selector} 줄 높이·간격 같음`, spread(info.heights) < 0.02 && spread(info.gaps) < 0.02, `높이 ${[...new Set(info.heights)].join("/")} · 간격 ${[...new Set(info.gaps)].join("/")}`);
}

async function snap(page, key) {
  if (SHOT_PLAN[key]) await page.screenshot({ path: path.join(SHOTS, SHOT_PLAN[key]) });
}

async function seed(page) {
  await page.evaluate(async () => {
    const s = window.webgba.store;
    const names = ["Pokemon Rapid.wgba", "테스트 게임 둘.gba", "テスト ゲーム.gba"];
    for (const [i, name] of names.entries()) {
      await s.putRom({ id: `seed${i}`, name, file: name, type: name.endsWith(".wgba") ? "wgba" : "gba" }, new Uint8Array(1024 + i));
      if (i < 2) await s.putSave(`seed${i}`, new Uint8Array(4096), name);
    }
  });
}

for (const view of SKIP_MAIN ? [] : VIEWS) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: view.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.addInitScript((lang) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      localStorage.setItem("webgba.prefs", JSON.stringify({ lang }));
    }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(URL_BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
    await seed(page);
    await page.evaluate(() => window.webgba.refreshStart());
    await page.waitForTimeout(400);
    const base = `${view.name}|${lang}`;
    const landscape = view.viewport.width > view.viewport.height;
    await rows(page, `${base}|start`, "#startList .item");
    await measure(page, `${base}|start`, ["#startList .item", ".start__head", landscape ? "" : ".bar"].filter(Boolean));

    await page.evaluate(() => window.webgba.toast("세이브를 저장했습니다 · Saved · セーブしました"));
    await page.waitForTimeout(150);
    await measure(page, `${base}|toast`, [".toast"]);
    await page.evaluate(() => window.webgba.toast(""));

    // 닫힌 햄버거 창은 레이아웃에 남아 있고 visibility 로만 숨는다 → 보이는 것만 센다
    const toolBoxes = () => page.evaluate(() => [...document.querySelectorAll(".bar .tool, #btnMenu")].filter((b) => b.offsetParent !== null && !b.hidden && getComputedStyle(b).visibility !== "hidden").map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    const overlap = (list) => list.some((x, i) => list.some((y, j) => j > i && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5));
    const inView = (list) => list.every((x) => x.l >= 0 && x.t >= 0 && x.r <= view.viewport.width && x.b <= view.viewport.height && x.r - x.l >= 44);
    if (landscape) {
      const list = await toolBoxes();
      const blockers = await page.evaluate(() => [document.getElementById("screen"), ...document.querySelectorAll("[data-key], [data-dpad]")].map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
      const hits = list.some((x) => blockers.some((y) => x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b));
      ok(`${base}|bar 가로: 기능 버튼 8개(퀵슬롯 포함) 모두 바로 보임·겹침 0·화면 안·게임 화면/버튼과 겹치지 않음`, list.length === 8 && !list.some((x) => x.id === "btnMenu") && !overlap(list) && inView(list) && !hits, JSON.stringify(list.map((x) => x.id)));
      await snap(page, `${base}|bar`);
    } else {
      const closed = await toolBoxes();
      ok(`${base}|bar 세로: 햄버거 + 퀵슬롯 + 기능 버튼 4개·겹침 0·화면 안`, closed.length === 6 && closed[0].id === "btnMenu" && closed[1].id === "btnQuick" && !overlap(closed) && inView(closed), JSON.stringify(closed.map((x) => x.id)));
      await page.click("#btnMenu");
      await page.waitForTimeout(250);
      const opened = await page.evaluate(() => [...document.querySelectorAll(".bar__group--files .tool")].map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
      ok(`${base}|menu 햄버거: 파일 열기·보관함·세이브 3개 펼침·화면 안`, opened.length === 3 && inView(opened) && !overlap(opened), JSON.stringify(opened.map((x) => x.id)));
      await fits(page, `${base}|menu`, ".bar__group--files");
      await snap(page, `${base}|menu`);
      await page.click("#btnMenu");
      await page.waitForTimeout(200);
      ok(`${base}|menu 다시 누르면 닫힘`, await page.evaluate(() => document.body.dataset.menu !== "open"));
      await page.click("#btnMenu");
      await page.waitForTimeout(200);
      await page.mouse.click(view.viewport.width / 2, view.viewport.height - 5);
      await page.waitForTimeout(200);
      ok(`${base}|menu 바깥 누르면 닫힘`, await page.evaluate(() => document.body.dataset.menu !== "open"));
    }

    const openSheet = async (button) => {
      if (!landscape && button !== "#btnSettings") {
        await page.click("#btnMenu");
        await page.waitForTimeout(250);
      }
      await page.click(button);
      await page.waitForSelector("#sheet:not([hidden])");
      await page.waitForTimeout(350);
    };

    await openSheet("#btnLibrary");
    await fits(page, `${base}|library`, ".sheet__panel");
    await rows(page, `${base}|library`, '.list[data-kind="rom"] .item');
    ok(`${base}|library '파일 열기' 버튼 없음`, !(await page.$(".sheet__body .btn--primary")));
    await measure(page, `${base}|library`, [".sheet__head", '.list[data-kind="rom"] .item']);
    await snap(page, `${base}|library`);

    await page.click('.list[data-kind="rom"] [data-action="rename"]');
    await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
    await page.fill(".dialog__input", "테스트 Name 名前");
    await page.waitForTimeout(200);
    await fits(page, `${base}|rename`, ".dialog__card");
    await measure(page, `${base}|rename`, [".dialog__actions .btn", ".dialog__input"]);
    await snap(page, `${base}|rename`);
    await page.click("#dialogActions .btn:not(.btn--primary)");
    await page.waitForTimeout(200);

    await page.click('.list[data-kind="rom"] [data-action="delete"]');
    await page.waitForSelector("#dialog:not([hidden])");
    await page.waitForTimeout(150);
    await fits(page, `${base}|confirm`, ".dialog__card");
    await measure(page, `${base}|confirm`, [".dialog__actions .btn"]);
    await page.click("#dialogActions .btn:not(.btn--danger)");
    await page.waitForTimeout(150);
    await page.click("#sheetClose");
    await page.waitForTimeout(200);

    await openSheet("#btnSaves");
    await fits(page, `${base}|saves`, ".sheet__panel");
    await rows(page, `${base}|saves`, '.list[data-kind="save"] .item');
    await measure(page, `${base}|saves`, [".sheet__head", '.list[data-kind="save"] .item']);
    await snap(page, `${base}|saves`);
    await page.click("#sheetClose");
    await page.waitForTimeout(200);

    await openSheet("#btnSettings");
    await fits(page, `${base}|settings`, ".sheet__panel");
    await rows(page, `${base}|settings`, ".sheet__body .group:first-child .field");
    await measure(page, `${base}|settings`, [".sheet__head", ".field"]);
    await snap(page, `${base}|settings`);
    await page.click("#sheetClose");
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const loader = window.webgba.openLoader({ title: "Pokemon Rapid", stages: ["check", "patch", "verify", "pack", "store", "open"] });
      loader.set("verify", 0.5);
      window.__loader = loader;
    });
    await page.waitForTimeout(300);
    await fits(page, `${base}|loader`, ".loader__card");
    await rows(page, `${base}|loader`, ".loader__step");
    await measure(page, `${base}|loader`, [".loader__step", ".loader__meta"]);
    await page.evaluate(() => window.__loader.close());

    ok(`${base} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

for (const width of SKIP_MAIN ? [] : [320, 360, 375, 390, 414, 430]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(300);
  const boxesOf = (selector) => page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== "hidden").map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }), selector);
  const overlap = (list) => list.some((x, i) => list.some((y, j) => j > i && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5));
  const bar = await boxesOf(".bar .tool");
  ok(`너비 ${width}: 위 기능 버튼 겹침 0·화면 밖 0`, bar.length === 6 && !overlap(bar) && bar.every((x) => x.l >= 0 && x.r <= width), JSON.stringify(bar.map((x) => [x.id, Math.round(x.l), Math.round(x.r)])));
  await page.click("#btnMenu");
  await page.waitForTimeout(250);
  const files = await boxesOf(".bar__group--files .tool");
  ok(`너비 ${width}: 햄버거 메뉴 3개 겹침 0·화면 밖 0`, files.length === 3 && !overlap(files) && files.every((x) => x.l >= 0 && x.r <= width));
  if (width === 320) await page.screenshot({ path: path.join(SHOTS, "세로_320x760_햄버거.png") });
  await context.close();
}

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
for (const viewport of SKIP_MAIN ? [] : [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IOS_UA });
    await context.addInitScript((lang) => localStorage.setItem("webgba.prefs", JSON.stringify({ lang })), lang);
    const page = await context.newPage();
    await page.goto(URL_BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
    await page.waitForTimeout(500);
    const key = `${viewport.width}x${viewport.height}|${lang}|gate`;
    const g = await page.evaluate(() => { const n = document.getElementById("gate"); return { shown: !n.hidden, ox: n.scrollWidth - n.clientWidth, steps: n.querySelectorAll(".gate__step").length }; });
    ok(`${key} 설치 안내: 가로 넘침 0·단계 보임`, g.shown && g.ox <= 0 && g.steps >= 3, JSON.stringify(g));
    const gaps = await page.evaluate(() => { const r = [...document.querySelectorAll(".gate__step")].map((n) => n.getBoundingClientRect()); return r.slice(1).map((b, i) => +(b.top - r[i].bottom).toFixed(2)); });
    ok(`${key} 단계 사이 간격 같음`, new Set(gaps).size <= 1, gaps.join("/"));
    await measure(page, key, [".gate__step", ".gate__actions .btn"]);
    if (lang === "ko" && viewport.width === 320) await page.screenshot({ path: path.join(SHOTS, "세로_320x568_설치안내.png") });
    if (lang === "ja" && viewport.width === 844) await page.screenshot({ path: path.join(SHOTS, "가로_844x390_설치안내_일본어.png") });
    await context.close();
  }
}

for (const viewport of SKIP_MAIN ? [] : [{ width: 1280, height: 800 }, { width: 800, height: 1000 }, { width: 600, height: 400 }]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport });
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; };
    const seen = (n) => n.offsetParent !== null && getComputedStyle(n).visibility !== "hidden";
    const boxes = [...document.querySelectorAll(".bar .tool, #btnMenu, [data-key], [data-dpad], #screen")].filter(seen).map((n) => n.getBoundingClientRect());
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && !(a.width === 0 || b.width === 0)));
    return { tools: [...document.querySelectorAll(".bar .tool, #btnMenu")].filter((n) => seen(n) && vis(n)).length, keys: [...document.querySelectorAll("[data-key], [data-dpad]")].filter(vis).length, overlap, layout: document.body.dataset.layout };
  });
  const a = await page.evaluate(() => { const r = document.querySelector('[data-key="A"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  const held = await page.evaluate(() => window.webgba.player.held);
  await page.mouse.up();
  const want = info.layout === "landscape" ? 8 : 6;
  await page.click("#btnSettings");
  await page.waitForTimeout(200);
  const span = await page.evaluate(() => { const r = document.querySelector(".sheet__body").getBoundingClientRect(); return [r.left + 10, r.top + 10, r.right - 10, r.bottom - 10]; });
  await page.mouse.move(span[0], span[1]);
  await page.mouse.down();
  await page.mouse.move(span[2], span[3], { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection().toString().length);
  ok(`PC 창 ${viewport.width}x${viewport.height}: 끌어도 글자 선택 0`, selected === 0, String(selected));
  await page.click("#sheetClose");
  ok(`PC 창 ${viewport.width}x${viewport.height}: 기능 버튼·가상 버튼 보임·겹침 0·마우스로 A`, info.tools === want && info.keys === 7 && !info.overlap && held === 1, JSON.stringify({ ...info, held }));
  await context.close();
}

// ── C·D 버튼(게임이 정의했을 때만 — main.js setExtraButtons, 여기서는 시험용 가짜 정의 C = L, D = R) ──
// 정의 없음: C·D 없고 수정 전 빌드(UI_BASE_URL)와 픽셀 같음. 정의 있음: C 는 A 위·D 는 B 위, 크기 = A·B, 겹침 0·화면 안,
// 터치로 C·D → L·R, 두 손가락(A + C)·미끄러짐(C→D→B)·스틱 + C, 키보드 C·I / V·U. 끄면 처음 화면과 픽셀 같음.
const EXTRA_VIEWS = [
  { width: 320, height: 568, dpr: 2 },
  { width: 360, height: 640, dpr: 3 },
  { width: 390, height: 844, dpr: 3 },
  { width: 568, height: 320, dpr: 2 },
  { width: 640, height: 360, dpr: 2.625 },
  { width: 844, height: 390, dpr: 3 },
];
const EXTRA_SHOTS = { "390x844": "세로_390x844_ABCD.png", "844x390": "가로_844x390_ABCD.png" };
const PAD_BITS = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };

async function padPage(url, { width, height, dpr }) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: dpr });
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(400);
  return { context, page };
}

function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return -1;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
  return n;
}

const padBoxes = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const n of document.querySelectorAll("[data-key], [data-dpad], #frame, .bar .tool, #btnMenu")) {
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(n).visibility === "hidden") continue;
      out[n.dataset.key ?? (n.matches("[data-dpad]") ? "DIR" : n.id)] = { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    return { boxes: out, art: window.webgba.skin.art };
  });

for (const view of EXTRA ? EXTRA_VIEWS : []) {
  const name = `${view.width}x${view.height}`;
  const key = `${name} dpr${view.dpr} C·D`;
  const { context, page } = await padPage(URL_BASE, view);
  const plain = await shoot(page);
  const before = await padBoxes(page);
  ok(`${key}: 정의 없으면 C·D 없음`, !before.boxes.C && !before.boxes.D && before.boxes.A && before.boxes.B, Object.keys(before.boxes).join(","));
  if (BASE_URL) {
    const base = await padPage(BASE_URL, view);
    const old = await shoot(base.page);
    await base.context.close();
    const diff = pixelDiff(plain, old);
    ok(`${key}: 정의 없음 = 수정 전 빌드와 픽셀 같음`, diff === 0, `다른 픽셀 ${diff}`);
  }

  await page.evaluate(() => window.webgba.setExtraButtons({ C: "L", D: "R" }));
  await page.waitForTimeout(300);
  const { boxes: b, art } = await padBoxes(page);
  const list = Object.entries(b);
  const hits = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [n1, x] = list[i];
      const [n2, y] = list[j];
      if (x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5) hits.push(`${n1}×${n2}`);
    }
  const outside = list.filter(([, x]) => x.l < -0.5 || x.t < -0.5 || x.r > view.width + 0.5 || x.b > view.height + 0.5).map(([n]) => n);
  ok(`${key}: C·D 보임·겹침 0·화면 안`, b.C && b.D && !hits.length && !outside.length, `겹침 ${hits.join(" ") || "0"} · 밖 ${outside.join(" ") || "0"}`);
  if (!b.C || !b.D) {
    await context.close();
    continue;
  }
  const column = b.C.b <= b.A.t + 0.5 && Math.abs(b.C.cx - b.A.cx) < 0.5 && b.D.b <= b.B.t + 0.5 && Math.abs(b.D.cx - b.B.cx) < 0.5;
  ok(`${key}: C 는 A 바로 위, D 는 B 바로 위`, column, JSON.stringify({ C: [b.C.cx, b.C.b], A: [b.A.cx, b.A.t], D: [b.D.cx, b.D.b], B: [b.B.cx, b.B.t] }));
  const sameSize = [b.C, b.D].every((x) => Math.abs(x.w - b.A.w) < 0.5 && Math.abs(x.h - b.A.h) < 0.5);
  const gapCA = b.A.t - b.C.b;
  const gapDB = b.B.t - b.D.b;
  const diagAB = b.B.t - b.A.t;
  const diagCD = b.D.t - b.C.t;
  ok(`${key}: C·D 크기 = A·B, 위아래 간격 같음, C·D 대각선 = A·B 대각선`, sameSize && Math.abs(gapCA - gapDB) <= 1 && Math.abs(diagAB - diagCD) <= 1 && gapCA > 0, `배율 ${before.art}→${art} · 버튼 ${b.A.w}x${b.A.h} · 간격 ${gapCA.toFixed(1)}/${gapDB.toFixed(1)} · 대각선 ${diagAB.toFixed(1)}/${diagCD.toFixed(1)}`);

  const cdp = await context.newCDPSession(page);
  const touch = touchApi(cdp);
  const held = () => page.evaluate(() => window.webgba.player.held);
  const at = (n, id) => ({ x: b[n].cx, y: b[n].cy, id });
  await touch("touchStart", [at("C", 1)]);
  const c = await held();
  await touch("touchEnd", []);
  await touch("touchStart", [at("D", 1)]);
  const d = await held();
  await touch("touchEnd", []);
  ok(`${key}: 터치 C → L, D → R`, c === PAD_BITS.L && d === PAD_BITS.R, `${c}/${d}`);
  await touch("touchStart", [at("A", 1), at("C", 2)]);
  const ac = await held();
  await touch("touchMove", [at("A", 1), at("D", 2)]);
  const ad = await held();
  await touch("touchMove", [at("A", 1), at("B", 2)]);
  const ab = await held();
  await touch("touchEnd", [at("B", 2)]); // CDP touchEnd 의 점 = 떼는 손가락
  const a = await held();
  await touch("touchEnd", []);
  const none = await held();
  ok(`${key}: 두 손가락 A + C, C→D→B 미끄러짐, 떼기`, ac === (PAD_BITS.A | PAD_BITS.L) && ad === (PAD_BITS.A | PAD_BITS.R) && ab === (PAD_BITS.A | PAD_BITS.B) && a === PAD_BITS.A && none === 0, `${ac}/${ad}/${ab}/${a}/${none}`);
  const stick = { x: b.DIR.cx + b.DIR.w * 0.4, y: b.DIR.cy, id: 1 };
  await touch("touchStart", [stick, at("C", 2)]);
  const sc = await held();
  await touch("touchEnd", []);
  ok(`${key}: 스틱 오른쪽 + C`, sc === (PAD_BITS.RIGHT | PAD_BITS.L), `${sc}`);
  const keys = await page.evaluate(() => {
    const p = window.webgba.player;
    const one = (code) => {
      p.keyDown(code);
      const bits = p.held;
      p.keyUp(code);
      return bits;
    };
    return ["KeyC", "KeyI", "KeyV", "KeyU", "KeyZ", "KeyA", "KeyS"].map(one);
  });
  ok(`${key}: 키보드 C·I → L, V·U → R(A·L·R 키 그대로)`, keys.join() === [512, 512, 256, 256, 1, 512, 256].join(), keys.join(","));
  if (EXTRA_SHOTS[name]) await page.screenshot({ path: path.join(SHOTS, EXTRA_SHOTS[name]) });

  if (name === "390x844") {
    const only = await page.evaluate(() => {
      window.webgba.setExtraButtons({ C: "START" });
      const shown = (k) => document.querySelector(`[data-key="${k}"]`).getBoundingClientRect().width > 0;
      const s = window.webgba.player;
      s.keyDown("Pad:C");
      const bits = s.held;
      s.keyUp("Pad:C");
      const one = { c: shown("C"), d: shown("D"), bits };
      window.webgba.setExtraButtons({ C: "X", D: 3 });
      return { ...one, bad: window.webgba.state.extra, badShown: shown("C") || shown("D") };
    });
    ok(`${key}: C 만 정의하면 C 만(→ START), 모르는 이름은 무시(= 정의 없음)`, only.c && !only.d && only.bits === PAD_BITS.START && only.bad === null && !only.badShown, JSON.stringify(only));
  }

  await page.evaluate(() => window.webgba.setExtraButtons(null));
  await page.waitForTimeout(300);
  const back = pixelDiff(plain, await shoot(page));
  const gone = await page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("KeyC");
    const bits = p.held;
    p.keyUp("KeyC");
    return { bits, extra: window.webgba.state.extra, attr: document.getElementById("pad").dataset.extra ?? null };
  });
  ok(`${key}: 정의를 지우면 처음 화면과 픽셀 같음·C 키 없음`, back === 0 && gone.bits === 0 && gone.extra === null && gone.attr === null, `다른 픽셀 ${back} · ${JSON.stringify(gone)}`);
  ok(`${key}: 페이지 오류 없음`, page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

function touchApi(cdp) {
  return async (type, points) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 2, radiusY: 2, force: 1 })) });
  };
}

const pixelTable = [];
for (const dpr of SKIP_MAIN ? [] : [1, 2, 3]) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport, isMobile: true, hasTouch: true, deviceScaleFactor: dpr });
    await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
    const page = await context.newPage();
    await page.goto(URL_BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
    await page.waitForTimeout(300);
    const key = `${viewport.width}x${viewport.height} dpr${dpr}`;
    const knob = await page.evaluate(async () => {
      const PX = await import("/js/pixel-ui.js");
      const skin = window.webgba.skin;
      const canvas = document.querySelector("[data-dpad] canvas");
      const scale = skin.px(skin.art);
      const base = PX.renderStickBase({ scale, palette: skin.palette });
      const w = canvas.width;
      const h = canvas.height;
      const shown = canvas.getContext("2d").getImageData(0, 0, w, h).data;
      const only = document.createElement("canvas");
      only.width = w;
      only.height = h;
      const octx = only.getContext("2d");
      octx.drawImage(base.canvas, Math.floor((w - base.width) / 2), Math.floor((h - base.height) / 2));
      const plain = octx.getImageData(0, 0, w, h).data;
      const box = (test) => {
        let t = h, b = -1, l = w, r = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (test((y * w + x) * 4)) { t = Math.min(t, y); b = Math.max(b, y); l = Math.min(l, x); r = Math.max(r, x); }
        return { cx: (l + r + 1) / 2, cy: (t + b + 1) / 2 };
      };
      const ring = box((o) => plain[o + 3] > 0);
      const top = box((o) => shown[o] !== plain[o] || shown[o + 1] !== plain[o + 1] || shown[o + 2] !== plain[o + 2] || shown[o + 3] !== plain[o + 3]);
      return { dx: Math.abs(top.cx - ring.cx) / scale, dy: Math.abs(top.cy - ring.cy) / scale };
    });
    pixelTable.push({ key, target: "스틱 손잡이(쉼) − 받침 잉크 중심", value: `가로 ${knob.dx} · 세로 ${knob.dy} 아트 픽셀` });
    ok(`${key} 스틱 손잡이·받침 잉크 중심 차이 ≤ 0.5 아트 픽셀`, knob.dx <= 0.5 && knob.dy <= 0.5, `가로 ${knob.dx} · 세로 ${knob.dy}`);

    const toolTop = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".bar .tool, #btnMenu")].filter((b) => b.offsetParent !== null).map((b) => [b.id, b.querySelector("canvas").getBoundingClientRect().top])));
    const before = await toolTop();
    await page.evaluate(() => {
      document.getElementById("btnFast").click();
      document.getElementById("btnSound").click();
    });
    await page.waitForTimeout(150);
    const after = await toolTop();
    await page.evaluate(() => {
      window.webgba.state.prefs.gameSpeed = 1;
      document.getElementById("btnSound").click();
    });
    const moved = ["btnFast", "btnSound"].filter((id) => id in before).map((id) => Math.abs(after[id] - before[id]));
    pixelTable.push({ key, target: "재생 속도·소리 버튼 보통↔켬 위치 차이", value: `${Math.max(0, ...moved)}px` });
    ok(`${key} 기능 버튼 보통↔켬 위치 차이 0`, moved.every((d) => d === 0), moved.join(","));

    if (dpr === 2 && viewport.width === 390) {
      const faces = await page.evaluate(async () => {
        const PX = await import("/js/pixel-ui.js");
        const out = [];
        for (const name of PX.ICON_NAMES) {
          for (const state of ["normal", "on", "disabled"]) {
            const render = PX.renderIconButton({ name, state, scale: 1, palette: window.webgba.skin.palette });
            const art = PX.debugArt(render);
            const f = render.faceBox;
            let top = 99, bottom = -1, left = 99, right = -1;
            for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
              const role = art.roles[art.px[y * art.w + x]];
              if (role && (role.startsWith("ic") || role === "iconOutline")) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
            }
            out.push({ name, state, v: Math.abs((top - f.y0) - (f.y1 - bottom)), h: Math.abs((left - f.x0) - (f.x1 - right)) });
          }
        }
        return out;
      });
      const worstV = Math.max(...faces.map((f) => f.v));
      const worstH = Math.max(...faces.map((f) => f.h));
      pixelTable.push({ key, target: "픽셀 아이콘 13종 × 3상태: 면 안 잉크 위·아래 / 좌·우 여백 차이", value: `세로 최대 ${worstV} · 가로 최대 ${worstH} 아트 픽셀` });
      ok("픽셀 아이콘이 면 안 잉크 기준 가운데(차이 ≤ 1 아트 픽셀 — 남는 1줄 규칙)", worstV <= 1 && worstH <= 1, `세로 ${worstV} · 가로 ${worstH}`);
    }
    await context.close();
  }
}
fs.writeFileSync(path.join(SHOTS, "픽셀_측정표.txt"), pixelTable.map((row) => `${row.key} · ${row.target}: ${row.value}`).join("\n"));

// ── 여닫는 움직임(움직임 줄이기 끔, 세로 390x844) ──
// 햄버거 창: transform·opacity 만 움직이고(레이아웃 상자 그대로), 닫는 동안 화면에 남았다가 끝나면 숨는다.
// 두 번 누르기·열리는 중 닫기·닫는 중 다시 열기·바깥 누르기·ESC·항목 고르기, 그리고 시트·알림 닫기.
async function motionChecks(engine, launcher) {
  const context = await launcher.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2, ...(engine === "chromium" ? { isMobile: true } : {}) });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko" }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  // 첫 누름은 소리 켜기(AudioContext 만들기)가 같은 처리에 들어가 시작이 늦어진다 → 미리 한 번 깨워 두고 잰다
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown")));
  await page.waitForTimeout(700);
  const out = await page.evaluate(async () => {
    const panel = document.querySelector(".bar__group--files");
    const btn = document.getElementById("btnMenu");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const look = () => {
      const s = getComputedStyle(panel);
      const m = s.transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(s.transform);
      return { open: panel.dataset.open ?? "", vis: s.visibility !== "hidden", op: +(+s.opacity).toFixed(3), ty: +m.m42.toFixed(2), menu: window.webgba.state.menuOpen, lay: `${panel.offsetLeft},${panel.offsetTop},${panel.offsetWidth},${panel.offsetHeight}` };
    };
    const record = (ms, act) =>
      new Promise((done) => {
        const start = performance.now();
        act?.();
        const frames = [{ t: 0, ...look() }];
        const step = (now) => {
          frames.push({ t: +(now - start).toFixed(1), ...look() });
          if (now - start < ms) requestAnimationFrame(step);
          else done(frames);
        };
        requestAnimationFrame(step);
      });
    const r = { property: getComputedStyle(panel).transitionProperty };
    r.open = await record(320, () => btn.click());
    r.close = await record(360, () => btn.click());
    r.double = await record(360, () => (btn.click(), btn.click()));
    btn.click();
    await sleep(80);
    r.midOpen = await record(360, () => btn.click());
    btn.click();
    await sleep(300);
    btn.click();
    await sleep(60);
    r.reopen = await record(360, () => btn.click());
    r.outside = await record(360, () => document.getElementById("screen").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch" })));
    btn.click();
    await sleep(300);
    r.esc = await record(360, () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })));
    btn.click();
    await sleep(300);
    // 시트 그리기(IndexedDB 읽기)가 같은 때 돌아 닫기가 조금 늦게 시작할 수 있어 길게 본다
    r.item = await record(700, () => document.getElementById("btnLibrary").click());
    const sheet = document.getElementById("sheet");
    r.itemSheet = !sheet.hidden;
    await sleep(300);
    const sheetLook = () => ({ hidden: sheet.hidden, closing: sheet.classList.contains("is-closing"), op: +(+getComputedStyle(sheet).opacity).toFixed(3) });
    document.getElementById("sheetClose").click();
    await sleep(60);
    r.sheetMid = sheetLook();
    await sleep(400);
    r.sheetEnd = sheetLook();
    const toast = document.getElementById("toast");
    window.webgba.toast("여닫기 시험");
    await sleep(250);
    toast.click();
    await sleep(60);
    r.toastMid = { hidden: toast.hidden, closing: toast.classList.contains("is-closing") };
    await sleep(400);
    r.toastEnd = { hidden: toast.hidden };
    return r;
  });
  const key = `여닫기 ${engine}`;
  const last = (frames) => frames[frames.length - 1];
  const shut = (frames) => !last(frames).vis && last(frames).open === "" && !last(frames).menu;
  const middle = (frames) => frames.filter((f) => f.vis && f.op > 0.02 && f.op < 0.98).length;
  const steady = (frames, dir) => frames.filter((f) => f.vis).every((f, i, list) => i === 0 || (dir > 0 ? f.op >= list[i - 1].op - 0.001 : f.op <= list[i - 1].op + 0.001));
  const lastSeen = (frames) => Math.max(0, ...frames.filter((f) => f.vis && f.op > 0.02).map((f) => f.t));
  const all = [out.open, out.close, out.double, out.midOpen, out.reopen, out.outside, out.esc, out.item].flat();
  ok(`${key}: 햄버거 창은 transform·opacity 만 바뀜(레이아웃 상자 그대로)`, /opacity/.test(out.property) && /transform/.test(out.property) && !/top|left|height|width|margin/.test(out.property) && new Set(all.map((f) => f.lay)).size === 1, `${out.property} · 상자 ${[...new Set(all.map((f) => f.lay))].join(" / ")}`);
  ok(`${key}: 열기 — 중간 프레임 ${middle(out.open)}개로 점점 나타남, 끝은 열림`, middle(out.open) >= 2 && steady(out.open, 1) && last(out.open).open === "open" && last(out.open).op === 1 && last(out.open).ty === 0);
  ok(`${key}: 닫기 — 닫는 동안 화면에 남음(마지막으로 보인 ${lastSeen(out.close)}ms), 끝나면 숨김`, lastSeen(out.close) >= 100 && middle(out.close) >= 2 && steady(out.close, -1) && shut(out.close));
  ok(`${key}: 빠르게 두 번 누르기 → 닫힘`, shut(out.double));
  ok(`${key}: 열리는 중 닫기 → 그 자리에서 거꾸로 닫힘`, out.midOpen[0].vis && out.midOpen[0].op < 1 && shut(out.midOpen), JSON.stringify(out.midOpen[0]));
  ok(`${key}: 닫는 중 다시 열기 → 열림`, last(out.reopen).open === "open" && last(out.reopen).op === 1 && last(out.reopen).menu);
  ok(`${key}: 바깥 누르기 → 움직임 뒤 닫힘`, lastSeen(out.outside) >= 100 && shut(out.outside));
  ok(`${key}: ESC → 움직임 뒤 닫힘`, lastSeen(out.esc) >= 100 && shut(out.esc));
  ok(`${key}: 항목 고르기(보관함) → 창은 움직임 뒤 닫히고 시트 열림`, out.itemSheet && shut(out.item), JSON.stringify({ sheet: out.itemSheet, seen: lastSeen(out.item), end: last(out.item) }));
  ok(`${key}: 시트 닫기 — 닫는 동안 남음 → 끝나면 숨김`, !out.sheetMid.hidden && out.sheetMid.closing && out.sheetEnd.hidden && !out.sheetEnd.closing, JSON.stringify([out.sheetMid, out.sheetEnd]));
  ok(`${key}: 알림 누르기 — 닫는 동안 남음 → 끝나면 숨김`, !out.toastMid.hidden && out.toastMid.closing && out.toastEnd.hidden);
  ok(`${key}: 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
  const lines = ["open", "close", "midOpen", "outside"].map((name) => `${name}: ${out[name].map((f) => `${f.t}ms ${f.vis ? `불투명도 ${f.op} · 위로 ${-f.ty}px` : "숨김"}`).join(" | ")}`);
  fs.writeFileSync(path.join(SHOTS, `여닫기_프레임_${engine}.txt`), lines.join("\n"));
  await context.close();
}

if (MOTION) {
  await motionChecks("chromium", browser);
  let wk = null;
  try {
    wk = await webkit.launch({ headless: true });
  } catch (error) {
    console.log(`WebKit 없음 — WebKit 여닫기 시험 건너뜀 (${error.message.split("\n")[0]})`);
  }
  if (wk) {
    await motionChecks("webkit", wk);
    await wk.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.pass);
const worst = new Map();
for (const row of table) {
  const key = `${row.key.split("|").slice(0, 2).join(" ")} · ${row.key.split("|")[2]} · ${row.target}`;
  worst.set(key, Math.max(worst.get(key) ?? 0, row.diff));
}
fs.writeFileSync(path.join(SHOTS, "화면규칙_결과.json"), JSON.stringify({ results, table }, null, 2));
const lines = [...worst.entries()].map(([k, v]) => `${k}: 최대 차이 ${v}px`);
fs.writeFileSync(path.join(SHOTS, "잉크가운데_표.txt"), lines.join("\n"));
console.log(`잉크 측정 ${table.length}곳 · 최대 차이 ${Math.max(0, ...table.map((r) => r.diff))}px`);
console.log(`결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
