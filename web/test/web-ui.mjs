// 웹 webGBA 화면 규칙 시험(로컬 전용): 팝업이 보이는 화면 안에 다 들어오는지, 같은 종류 줄의 높이·간격이 같은지,
// 줄·버튼 안 아이콘·글자가 잉크(보이는 픽셀) 기준 세로 가운데인지(위·아래 여백 차이 ≤ 1px).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-ui.mjs <주소> <캡처 폴더> [--chrome <chrome.exe>]
// 보관함 줄은 1KB 짜리 가짜 기록을 넣어 만든다(롬 아님).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodePng } from "./png.mjs";

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

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

for (const view of VIEWS) {
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

    const toolBoxes = () => page.evaluate(() => [...document.querySelectorAll(".bar .tool, #btnMenu")].filter((b) => b.offsetParent !== null && !b.hidden).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    const overlap = (list) => list.some((x, i) => list.some((y, j) => j > i && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5));
    const inView = (list) => list.every((x) => x.l >= 0 && x.t >= 0 && x.r <= view.viewport.width && x.b <= view.viewport.height && x.r - x.l >= 44);
    if (landscape) {
      const list = await toolBoxes();
      const blockers = await page.evaluate(() => [document.getElementById("screen"), ...document.querySelectorAll("[data-key], [data-dpad]")].map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
      const hits = list.some((x) => blockers.some((y) => x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b));
      ok(`${base}|bar 가로: 기능 버튼 7개 모두 바로 보임·겹침 0·화면 안·게임 화면/버튼과 겹치지 않음`, list.length === 7 && !list.some((x) => x.id === "btnMenu") && !overlap(list) && inView(list) && !hits, JSON.stringify(list.map((x) => x.id)));
      await snap(page, `${base}|bar`);
    } else {
      const closed = await toolBoxes();
      ok(`${base}|bar 세로: 햄버거 + 기능 버튼 4개·겹침 0·화면 안`, closed.length === 5 && closed[0].id === "btnMenu" && !overlap(closed) && inView(closed), JSON.stringify(closed.map((x) => x.id)));
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

for (const width of [320, 360, 375, 390, 414, 430]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(300);
  const boxesOf = (selector) => page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }), selector);
  const overlap = (list) => list.some((x, i) => list.some((y, j) => j > i && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5));
  const bar = await boxesOf(".bar .tool");
  ok(`너비 ${width}: 위 기능 버튼 겹침 0·화면 밖 0`, bar.length === 5 && !overlap(bar) && bar.every((x) => x.l >= 0 && x.r <= width), JSON.stringify(bar.map((x) => [x.id, Math.round(x.l), Math.round(x.r)])));
  await page.click("#btnMenu");
  await page.waitForTimeout(250);
  const files = await boxesOf(".bar__group--files .tool");
  ok(`너비 ${width}: 햄버거 메뉴 3개 겹침 0·화면 밖 0`, files.length === 3 && !overlap(files) && files.every((x) => x.l >= 0 && x.r <= width));
  if (width === 320) await page.screenshot({ path: path.join(SHOTS, "세로_320x760_햄버거.png") });
  await context.close();
}

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
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

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1000 }, { width: 600, height: 400 }]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport });
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; };
    const boxes = [...document.querySelectorAll(".bar .tool, #btnMenu, [data-key], [data-dpad], #screen")].filter((n) => n.offsetParent !== null).map((n) => n.getBoundingClientRect());
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && !(a.width === 0 || b.width === 0)));
    return { tools: [...document.querySelectorAll(".bar .tool, #btnMenu")].filter((n) => n.offsetParent !== null && vis(n)).length, keys: [...document.querySelectorAll("[data-key], [data-dpad]")].filter(vis).length, overlap, layout: document.body.dataset.layout };
  });
  const a = await page.evaluate(() => { const r = document.querySelector('[data-key="A"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  const held = await page.evaluate(() => window.webgba.player.held);
  await page.mouse.up();
  const want = info.layout === "landscape" ? 7 : 5;
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

const pixelTable = [];
for (const dpr of [1, 2, 3]) {
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
