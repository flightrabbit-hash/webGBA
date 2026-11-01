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
// UI_LIBRARY_ONLY=1 이면 라이브러리(책장)·첫 화면 최근 줄 시험만(UI_LIBRARY=0 이면 그것만 뺌): 320 세로 ~ 낮은 가로까지 겹침·화면 안·잉크 가운데·
// 정수 배율·꺼내기/넣기·정렬·실행 중 칸, 그리고 꺼내기·넣기 움직임(transform·opacity, 닫을 때 움직임 뒤 숨김).
const ONLY_LIBRARY = process.env.UI_LIBRARY_ONLY === "1";
const ONLY_NET = process.env.UI_NET_ONLY === "1";
const EXTRA = !ONLY_NET && (ONLY_EXTRA || (!ONLY_MOTION && !ONLY_LIBRARY && process.env.UI_EXTRA !== "0"));
const BASE_URL = process.env.UI_BASE_URL ?? "";
const SKIP_MAIN = ONLY_MOTION || ONLY_EXTRA || ONLY_LIBRARY || ONLY_NET;
const MOTION = !ONLY_NET && !ONLY_EXTRA && !ONLY_LIBRARY && (ONLY_MOTION || process.env.UI_MOTION !== "0");
const LIBRARY = !ONLY_NET && (ONLY_LIBRARY || (!ONLY_MOTION && !ONLY_EXTRA && process.env.UI_LIBRARY !== "0"));
const SHOT_PLAN = { "390x844|ko|bar": "", "844x390|ko|bar": "가로_844x390_기능버튼.png", "390x844|ko|menu": "세로_390x844_햄버거.png", "390x844|ko|settings": "세로_390x844_설정.png", "390x844|ko|info": "세로_390x844_정보_게임_소리.png","844x390|ko|library": "가로_844x390_라이브러리.png", "360x640|ko|rename": "세로_360x640_이름입력.png", "390x844|ja|saves": "세로_390x844_세이브_일본어.png" };

const results = [];
const table = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.log(`실패 ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// 픽셀 버튼·팝업(2026-11-01): 둥근 모서리·흐린 그림자·filter 없음, 색은 토큰(:root 의 기본 테마 토큰 정의 밖 HEX 0)
{
  const css = await (await fetch(new URL("/css/web.css", URL_BASE))).text();
  const radius = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => !/^0(px)?$/.test(v));
  const flat = (s) => {
    let t = s;
    while (/\([^()]*\)/.test(t)) t = t.replace(/\([^()]*\)/g, "");
    return t;
  };
  const blurred = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].flatMap((m) => flat(m[1]).split(",")).map((s) => s.trim()).filter((s) => s !== "none" && !/^(inset\s+)?\S+\s+\S+\s+0(\s|$)/.test(s));
  const body = css.replace(/^:root\s*\{[\s\S]*?\n\}/m, "");
  const hex = [...body.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
  ok("web.css: border-radius 0 · 흐린 box-shadow 0 · filter 0 · :root 밖 HEX 0", !radius.length && !blurred.length && !/\bfilter:/.test(css) && !hex.length, `radius ${radius.join("/") || 0} · 흐림 ${blurred.join(" / ") || 0} · HEX ${hex.join(",") || 0}`);
}

async function shoot(page) {
  return decodePng(await page.screenshot());
}

// 픽셀 조작 칸(버튼·선택 칸·토글·범위·색)은 외곽선·옆면·그림자가 있어 잉크로 재면 틀이 섞인다 →
// 줄 안 글자 잉크는 그 칸(틀 + 그림자)을 빼고 재고, 칸 자체는 틀(외곽선 포함, 그림자 뺌) 상자가 줄 가운데인지 따로 잰다.
const CONTROLS = ".btn, .tool--small, .pick, .switch, input[type=range], input[type=color], .recent__all";
const masked = (box, x, y) => box.mask?.some((m) => x >= m[0] && x < m[2] && y >= m[1] && y < m[3]);

function inkCheck(image, dpr, box) {
  const x0 = Math.round((box.left + box.inset) * dpr);
  const x1 = Math.round((box.right - box.inset) * dpr);
  // 위아래 1 기기 픽셀은 빼고 잰다: 칸이 0.5px 자리에 놓이면 브라우저가 칠할 때 정수 px 로 맞춰, 바깥 틀(외곽선) 한 줄이 상자 안에 끼는 일이 있다
  const y0 = Math.round(box.top * dpr) + 1;
  const y1 = Math.round(box.bottom * dpr) - 1;
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  if (box.mask) box = { ...box, mask: box.mask.map((m) => m.map((v) => Math.round(v * dpr))) };
  const counts = new Map();
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (masked(box, x, y)) continue;
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
      if (masked(box, x, y)) continue;
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
    ([selector, limit, controls]) => {
      const vh = window.visualViewport?.height ?? innerHeight;
      const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2;
      const frames = (node) =>
        node.matches(controls)
          ? []
          : [...node.querySelectorAll(controls)].filter((c) => c.offsetParent !== null && c.getBoundingClientRect().width > 0).map((c) => {
              const b = c.getBoundingClientRect();
              return { name: c.className.split(" ")[0] || c.tagName.toLowerCase(), left: b.left - px, right: b.right + px, top: b.top - px, bottom: b.bottom + px };
            });
      return [...document.querySelectorAll(selector)]
        .filter((node) => node.offsetParent !== null || getComputedStyle(node).position === "fixed")
        .slice(0, limit)
        .map((node) => {
          const s = getComputedStyle(node);
          // 잉크 가운데 맞춤이 이 칸 자체를 translate 로 옮긴 경우(.lib__name 등)는 옮기기 전 자리(레이아웃 칸)에서 잰다
          const [tx = 0, ty = 0] = s.translate && s.translate !== "none" ? s.translate.split(/\s+/).map((v) => parseFloat(v) || 0) : [];
          const raw = node.getBoundingClientRect();
          const r = { left: raw.left - tx, right: raw.right - tx, top: raw.top - ty, bottom: raw.bottom - ty, height: raw.height };
          const bt = parseFloat(s.borderTopWidth);
          const bb = parseFloat(s.borderBottomWidth);
          const bl = parseFloat(s.borderLeftWidth);
          const radius = Math.max(parseFloat(s.borderTopLeftRadius) || 0, node.matches(".sheet__head") ? 16 : 0);
          const inner = frames(node);
          return {
            frames: inner,
            mask: inner.map((f) => [f.left - 1, f.top - 1, f.right + 1, f.bottom + px + 1]),
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
    [selector, limit, CONTROLS],
  );
}

async function measure(page, key, selectors) {
  const image = await shoot(page);
  const dpr = await page.evaluate(() => devicePixelRatio);
  for (const selector of selectors) {
    for (const box of await boxes(page, selector)) {
      for (const f of box.frames) {
        const top = +(f.top - box.top).toFixed(2);
        const bottom = +(box.bottom - f.bottom).toFixed(2);
        table.push({ key, target: `${box.label} › ${f.name}(틀)`, top, bottom, diff: Math.abs(top - bottom) });
        ok(`${key} ${box.label} › ${f.name} 틀 세로 가운데`, Math.abs(top - bottom) <= 1, `위 ${top} · 아래 ${bottom}`);
      }
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
    await measure(page, `${base}|start`, [".recent__name", ".recent__meta", ".start__head", landscape ? "" : ".bar"].filter(Boolean));

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
      ok(`${base}|menu 햄버거: 파일 열기·라이브러리·세이브 3개 펼침·화면 안`, opened.length === 3 && inView(opened) && !overlap(opened), JSON.stringify(opened.map((x) => x.id)));
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
    await measure(page, `${base}|library`, [".sheet__head", ".lib__name", ".lib__meta", ".lib__btns .btn"]);
    await snap(page, `${base}|library`);

    await page.click('.lib__card [data-action="rename"]');
    await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
    await page.fill(".dialog__input", "테스트 Name 名前");
    await page.waitForTimeout(200);
    await fits(page, `${base}|rename`, ".dialog__card");
    await measure(page, `${base}|rename`, [".dialog__actions .btn", ".dialog__input"]);
    await snap(page, `${base}|rename`);
    await page.click("#dialogActions .btn:not(.btn--primary)");
    await page.waitForTimeout(200);

    await page.click('.lib__card [data-action="delete"]');
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

    // 정보 화면: 설명서 있는 게임 묶음(S2) + webGBA 묶음의 소리 줄(ios-audio)이 함께 — 겹침 0·잉크 세로 가운데
    await page.evaluate(() => {
      window.webgba.state.game = { id: "art", saveId: "dev.example.star", gameId: "dev.example.star", title: "Star Garden", version: "0.9.1", author: "example", build: "a".repeat(64), name: "star.wgba" };
      window.webgba.openSheet("info");
    });
    await page.waitForSelector("#sheet:not([hidden])");
    await page.waitForTimeout(700);
    await fits(page, `${base}|info`, ".sheet__panel");
    const infoLines = await page.evaluate(() => {
      const groups = [...document.querySelectorAll("#sheetBody .group")];
      const lines = groups.slice(0, 2).flatMap((g) => [...g.children]).map((n) => { const r = n.getBoundingClientRect(); return { text: n.textContent.trim(), top: r.top, bottom: r.bottom }; });
      const overlap = lines.some((a, i) => i > 0 && a.top < lines[i - 1].bottom - 0.5);
      return { game: groups[0]?.textContent.includes("Star Garden") && groups[0].textContent.includes("dev.example.star"), audio: lines.some((l) => /^(소리|Sound|サウンド|音)/.test(l.text)), overlap, count: lines.length };
    });
    ok(`${base}|info 게임 묶음 + 소리 줄 함께 · 겹침 0`, infoLines.game && infoLines.audio && !infoLines.overlap, JSON.stringify(infoLines));
    // 상태 줄(게임 id 줄·버전 줄·소리 줄)과 묶음 제목. 설명 글(.note 문단)은 줄 칸이 아니라 재지 않음.
    await measure(page, `${base}|info`, [".sheet__head", "#sheetBody .group__title", "#sheetBody .info__line"]);
    await snap(page, `${base}|info`);
    await page.click("#sheetClose");
    await page.waitForTimeout(200);
    await page.evaluate(() => (window.webgba.state.game = null));

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

// ── C·D 버튼·키 매핑(게임 설명서 input 이 정의했을 때만 — main.js setInput, 시험은 window.webgba.setInput(설명서 input)) ──
// 정의 없음: C·D 없고 수정 전 빌드(UI_BASE_URL)와 픽셀 같음. C·D 정의(preset gba + c = bit 10, d = bit 11): C 는 A 위·D 는 B 위,
// 크기 = A·B, 겹침 0·화면 안, 세로는 게임 화면 그대로(좁으면 버튼 배율·배치만 다시 맞춤, 결정 102-11), 터치 C·D → bit 10·11,
// 두 손가락(A + C)·미끄러짐(C→D→B)·스틱 + C, 키보드 C·I / V·U. 끄면 처음 화면과 픽셀 같음.
// 버튼 일부(방향·A·START 만): 나머지 자리 안 보임·겹침 0. 역할이 다른 버튼(a = bit 8 …): 터치·키보드가 그 bit.
const CD_INPUT = { preset: "gba", buttons: [{ id: "C", role: "c", bit: 10 }, { id: "D", role: "d", bit: 11 }] };
const FEW_INPUT = { preset: "none", buttons: [{ id: "UP", role: "up", bit: 6 }, { id: "DOWN", role: "down", bit: 7 }, { id: "LEFT", role: "left", bit: 5 }, { id: "RIGHT", role: "right", bit: 4 }, { id: "A", role: "a", bit: 0 }, { id: "START", role: "start", bit: 3 }] };
const ROLES_INPUT = {
  preset: "none",
  buttons: [
    { id: "UP", role: "up", bit: 0 },
    { id: "DOWN", role: "down", bit: 1 },
    { id: "LEFT", role: "left", bit: 2 },
    { id: "RIGHT", role: "right", bit: 3 },
    { id: "JUMP", role: "a", bit: 8, label: { en: "Jump", ko: "점프" } },
    { id: "FIRE", role: "b", bit: 9 },
    { id: "SPIN", role: "c", bit: 12 },
    { id: "MENU", role: "start", bit: 15 },
    { id: "MAP", role: "extra", bit: 20, keys: ["KeyM"] },
    { id: "DASH", role: "l2", bit: 21 },
  ],
};
const CD_BITS = { C: 1024, D: 2048 };
// 수정 전 빌드(UI_BASE_URL)는 setInput 이 없어 옛 시험 정의(C = L, D = R)로 켠다 — 화면 배치 비교용
const turnOnCD = (page) => page.evaluate((input) => (window.webgba.setInput ? window.webgba.setInput(input) : window.webgba.setExtraButtons({ C: "L", D: "R" })), CD_INPUT);
const EXTRA_VIEWS = [
  { width: 320, height: 568, dpr: 2 },
  { width: 360, height: 640, dpr: 3 },
  { width: 375, height: 667, dpr: 2 },
  { width: 390, height: 844, dpr: 3 },
  { width: 568, height: 320, dpr: 2 },
  { width: 640, height: 360, dpr: 2.625 },
  { width: 844, height: 390, dpr: 3 },
  { width: 740, height: 360, dpr: 3 },
  { width: 667, height: 375, dpr: 2 },
  { width: 932, height: 430, dpr: 3 },
  { width: 1024, height: 768, dpr: 2 },
];
const EXTRA_SHOTS = { "320x568": "세로_320x568_ABCD.png", "390x844": "세로_390x844_ABCD.png", "844x390": "가로_844x390_ABCD.png" };
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
    const s = getComputedStyle(document.documentElement);
    return { boxes: out, art: window.webgba.skin.art, screen: `${parseFloat(s.getPropertyValue("--sw"))}x${parseFloat(s.getPropertyValue("--sh"))}` };
  });

function overlaps(b, view) {
  const list = Object.entries(b);
  const hits = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [n1, x] = list[i];
      const [n2, y] = list[j];
      if (x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5) hits.push(`${n1}×${n2}`);
    }
  const outside = list.filter(([, x]) => x.l < -0.5 || x.t < -0.5 || x.r > view.width + 0.5 || x.b > view.height + 0.5).map(([n]) => n);
  return { hits, outside };
}

// 키 하나를 눌렀다 뗐을 때 player.held(게임에 갈 비트)
const pressBits = (page, codes) =>
  page.evaluate((codes) => {
    const p = window.webgba.player;
    return codes.map((code) => {
      p.keyDown(code);
      const bits = p.held;
      p.keyUp(code);
      return bits;
    });
  }, codes);

// 둥근 버튼 넷의 잉크(불투명 칸 = 면·옆면·외곽선, 반투명 그림자 뺌) 사이 가장 가까운 빈 거리(CSS px).
// 아트 칸 가운데끼리 거리 − 한 칸(같은 세로줄이면 빈 줄 수 × 한 칸).
const inkGaps = (page) =>
  page.evaluate(() => {
    const ink = (k) => {
      const c = document.querySelector(`[data-key="${k}"] canvas`);
      const r = c.getBoundingClientRect();
      const step = c.width / 23;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const sx = r.width / c.width;
      const sy = r.height / c.height;
      const pts = [];
      for (let y = step / 2; y < c.height; y += step)
        for (let x = step / 2; x < c.width; x += step) if (d[(Math.floor(y) * c.width + Math.floor(x)) * 4 + 3] === 255) pts.push([r.left + x * sx, r.top + y * sy]);
      return { pts, cell: step * sx };
    };
    const k = Object.fromEntries(["A", "B", "C", "D"].map((n) => [n, ink(n)]));
    const gap = (m, n) => {
      let best = Infinity;
      for (const [x1, y1] of k[m].pts) for (const [x2, y2] of k[n].pts) best = Math.min(best, Math.hypot(x1 - x2, y1 - y2));
      return best - k[m].cell;
    };
    return { AB: gap("A", "B"), CD: gap("C", "D"), CA: gap("C", "A"), DB: gap("D", "B"), DA: gap("D", "A") };
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

  await turnOnCD(page);
  await page.waitForTimeout(300);
  const { boxes: b, art, screen } = await padBoxes(page);
  const { hits, outside } = overlaps(b, view);
  ok(`${key}: C·D 보임·겹침 0·화면 안`, b.C && b.D && !hits.length && !outside.length, `겹침 ${hits.join(" ") || "0"} · 밖 ${outside.join(" ") || "0"}`);
  if (!b.C || !b.D) {
    await context.close();
    continue;
  }
  if (view.width < view.height) {
    // 세로(결정 102-11): 게임 화면은 정의 없을 때와 같은 크기(폭 맞춤 3:2), 버튼 배율·배치만 다시 맞춤(정수 배율, 들어가는 가장 큰 값)
    const fit = await page.evaluate(() => document.getElementById("pad").dataset.fit ?? "rows");
    ok(`${key}: 세로 게임 화면 그대로(줄이지 않음), 버튼은 정수 배율 ${art}·배치 ${fit}`, screen === before.screen && Number.isInteger(art) && art >= 2 && art <= before.art, `배율 ${before.art}→${art} · 게임 화면 ${before.screen} → ${screen} · 배치 ${fit}`);
    console.log(`측정 ${key}: 세로 게임 화면 ${before.screen} → ${screen} · 배율 ${before.art}→${art} · 배치 ${fit}`);
  }
  const column = b.C.b <= b.A.t + 0.5 && Math.abs(b.C.cx - b.A.cx) < 0.5 && b.D.b <= b.B.t + 0.5 && Math.abs(b.D.cx - b.B.cx) < 0.5;
  ok(`${key}: C 는 A 바로 위, D 는 B 바로 위`, column, JSON.stringify({ C: [b.C.cx, b.C.b], A: [b.A.cx, b.A.t], D: [b.D.cx, b.D.b], B: [b.B.cx, b.B.t] }));
  const sameSize = [b.C, b.D].every((x) => Math.abs(x.w - b.A.w) < 0.5 && Math.abs(x.h - b.A.h) < 0.5);
  const gapCA = b.A.t - b.C.b;
  const gapDB = b.B.t - b.D.b;
  const diagAB = b.B.t - b.A.t;
  const diagCD = b.D.t - b.C.t;
  ok(`${key}: C·D 크기 = A·B, 위아래 간격 같음, C·D 대각선 = A·B 대각선`, sameSize && Math.abs(gapCA - gapDB) <= 1 && Math.abs(diagAB - diagCD) <= 1 && gapCA > 0, `배율 ${before.art}→${art} · 버튼 ${b.A.w}x${b.A.h} · 간격 ${gapCA.toFixed(1)}/${gapDB.toFixed(1)} · 대각선 ${diagAB.toFixed(1)}/${diagCD.toFixed(1)}`);
  if (view.width > view.height) {
    // 가로: C·D 줄과 A·B 줄이 한 묶음 — C 아래 ↔ A 위(D ↔ B)의 빈 거리 ≤ A·B 사이 가장 가까운 거리(둘 다 그림자 뺀 잉크).
    // 네 버튼 묶음은 R 아래 ~ START 위 가운데(위·아래 여백 차이 ≤ 1px).
    const g = await inkGaps(page);
    let was = "";
    if (BASE_URL) {
      const base = await padPage(BASE_URL, view);
      await turnOnCD(base.page);
      await base.page.waitForTimeout(300);
      const old = await inkGaps(base.page);
      const ob = (await padBoxes(base.page)).boxes;
      await base.context.close();
      was = ` · 고치기 전 C↔A ${old.CA.toFixed(1)} 상자 ${(ob.A.t - ob.C.b).toFixed(1)}`;
    }
    const top = b.C.t - b.R.b;
    const bottom = b.START.t - b.B.b;
    ok(`${key}: 가로 C·D 줄 ↔ A·B 줄 ≤ A·B 사이, R·START 사이 가운데`, g.CA <= g.AB + 0.01 && g.DB <= g.AB + 0.01 && Math.abs(top - bottom) <= 1,
      `잉크 거리 C↔A ${g.CA.toFixed(1)} · D↔B ${g.DB.toFixed(1)} · A↔B ${g.AB.toFixed(1)} · D↔A ${g.DA.toFixed(1)} · 상자 C↔A ${gapCA.toFixed(1)}${was} · R 아래 ${top.toFixed(1)} / START 위 ${bottom.toFixed(1)}`);
    console.log(`측정 ${key}: 배율 ${art} · C↔A ${g.CA.toFixed(1)} · D↔B ${g.DB.toFixed(1)} · A↔B ${g.AB.toFixed(1)} · D↔A ${g.DA.toFixed(1)} · 상자 C↔A ${gapCA.toFixed(1)}${was} · R 아래 ${top.toFixed(1)} / START 위 ${bottom.toFixed(1)}`);
  }

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
  ok(`${key}: 터치 C → bit 10, D → bit 11`, c === CD_BITS.C && d === CD_BITS.D, `${c}/${d}`);
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
  ok(`${key}: 두 손가락 A + C, C→D→B 미끄러짐, 떼기`, ac === (PAD_BITS.A | CD_BITS.C) && ad === (PAD_BITS.A | CD_BITS.D) && ab === (PAD_BITS.A | PAD_BITS.B) && a === PAD_BITS.A && none === 0, `${ac}/${ad}/${ab}/${a}/${none}`);
  const stick = { x: b.DIR.cx + b.DIR.w * 0.4, y: b.DIR.cy, id: 1 };
  await touch("touchStart", [stick, at("C", 2)]);
  const sc = await held();
  await touch("touchEnd", []);
  ok(`${key}: 스틱 오른쪽 + C`, sc === (PAD_BITS.RIGHT | CD_BITS.C), `${sc}`);
  const keys = await pressBits(page, ["KeyC", "KeyI", "KeyV", "KeyU", "KeyZ", "KeyA", "KeyS"]);
  ok(`${key}: 키보드 C·I → C, V·U → D(A·L·R 키 그대로)`, keys.join() === [1024, 1024, 2048, 2048, 1, 512, 256].join(), keys.join(","));
  if (EXTRA_SHOTS[name]) await page.screenshot({ path: path.join(SHOTS, EXTRA_SHOTS[name]) });

  if (name === "390x844") {
    const only = await page.evaluate((input) => {
      window.webgba.setInput(input);
      const shown = (k) => document.querySelector(`[data-key="${k}"]`).getBoundingClientRect().width > 0;
      const s = window.webgba.player;
      s.keyDown("Pad:C");
      const bits = s.held;
      s.keyUp("Pad:C");
      const one = { c: shown("C"), d: shown("D"), bits };
      window.webgba.setInput({ preset: "gba", buttons: [{ id: "X", role: "zz", bit: 12 }] });
      return { ...one, bad: window.webgba.state.extra, badShown: shown("C") || shown("D") };
    }, { preset: "gba", buttons: [{ id: "C", role: "c", bit: 10 }] });
    ok(`${key}: C 만 정의하면 C 만(→ bit 10), 모르는 role 은 터치 자리 없음(= C·D 없음)`, only.c && !only.d && only.bits === CD_BITS.C && only.bad === null && !only.badShown, JSON.stringify(only));
  }

  await page.evaluate(() => window.webgba.setInput(null));
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

  // 버튼 일부(방향·A·START 만): B·L·R·SELECT·C·D 자리 안 보임, 남은 것 겹침 0·화면 안, 키보드 X(B)·A(L) 는 아무것도 아님
  await page.evaluate((input) => window.webgba.setInput(input), FEW_INPUT);
  await page.waitForTimeout(300);
  const few = await padBoxes(page);
  const fewHit = overlaps(few.boxes, view);
  const fewKeys = await pressBits(page, ["KeyZ", "KeyX", "KeyA", "KeyS", "Backspace", "Enter", "ArrowUp"]);
  const fewShown = ["A", "START", "DIR"].every((n) => few.boxes[n]) && ["B", "L", "R", "SELECT", "C", "D"].every((n) => !few.boxes[n]);
  ok(`${key}: 버튼 일부 — 정의한 자리만 보임·겹침 0·키는 정의한 버튼만`, fewShown && !fewHit.hits.length && !fewHit.outside.length && few.art === before.art && fewKeys.join() === [1, 0, 0, 0, 0, 8, 64].join(),
    `보임 ${Object.keys(few.boxes).filter((n) => /^[A-Z]+$/.test(n)).join(",")} · 겹침 ${fewHit.hits.join(" ") || "0"} · 키 ${fewKeys.join(",")}`);

  // 역할이 다른 버튼: 터치 A 자리 → 점프(bit 8), B 자리 → bit 9, C 자리 → bit 12, D 없음, START 자리 → bit 15, 키보드 M(extra)·Q(l2)
  await page.evaluate((input) => window.webgba.setInput(input), ROLES_INPUT);
  await page.waitForTimeout(300);
  const roles = await padBoxes(page);
  const rb = roles.boxes;
  const rHit = overlaps(rb, view);
  const tapBits = [];
  for (const n of ["A", "B", "C", "START"]) {
    if (!rb[n]) {
      tapBits.push(-1);
      continue;
    }
    await touch("touchStart", [{ x: rb[n].cx, y: rb[n].cy, id: 1 }]);
    tapBits.push(await held());
    await touch("touchEnd", []);
  }
  const roleKeys = await pressBits(page, ["KeyZ", "KeyX", "KeyC", "KeyM", "KeyQ", "Enter", "ArrowUp", "ArrowRight"]);
  ok(`${key}: 역할이 다른 버튼 — 터치·키보드가 그 bit, D·L·R·SELECT 없음·겹침 0`,
    tapBits.join() === [256, 512, 4096, 32768].join() && roleKeys.join() === [256, 512, 4096, 1 << 20, 1 << 21, 32768, 1, 8].join() && !rb.D && !rb.L && !rb.R && !rb.SELECT && !rHit.hits.length && !rHit.outside.length,
    `터치 ${tapBits.join(",")} · 키 ${roleKeys.join(",")} · 겹침 ${rHit.hits.join(" ") || "0"}`);
  await page.evaluate(() => window.webgba.setInput(null));
  await page.waitForTimeout(300);
  ok(`${key}: 버튼 일부·역할 정의를 지워도 처음 화면과 픽셀 같음`, pixelDiff(plain, await shoot(page)) === 0);
  ok(`${key}: 페이지 오류 없음`, page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

// C·D 색: 테마 13개 모두 A·B 와 색상 계열이 다름(색상 차 ≥ 60°, A·B 가 무채색이면 C·D 채도 ≥ 0.4), C·D 글자 대비 ≥ 3,
// 화면에 칠한 C·D 면 = 팔레트 cd, A·B 면 = accent(그대로). 13테마 버튼만 모은 비교 한 장(테마비교_13.png).
const hexRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const hueSat = (c) => {
  const [r, g, b] = hexRgb(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (!d) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: d / (1 - Math.abs(2 * l - 1)) };
};
const relLum = (c) => {
  const [r, g, b] = hexRgb(c).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05);
const CUSTOM_DEFAULT = { "--bg-sunken": "#070a14", "--bg-deep": "#070a14", "--bg": "#151d33", "--bg-raised": "#151d33", "--bg-tint": "#151d33", "--text": "#eef1f8", "--text-hi": "#eef1f8", "--accent": "#6c93ff", "--accent-hi": "#6c93ff", "--line": "#3a4670", "--line-strong": "#3a4670" };

if (EXTRA) {
  const { context, page } = await padPage(URL_BASE, { width: 1000, height: 640, dpr: 2 });
  await turnOnCD(page);
  await page.waitForTimeout(300);
  const rows = await page.evaluate(async (custom) => {
    const T = await import("/js/shell/theme.js");
    const PX = await import("/js/pixel-ui.js");
    const skin = window.webgba.skin;
    const hex = (d, i) => "#" + [d[i], d[i + 1], d[i + 2]].map((x) => x.toString(16).padStart(2, "0")).join("");
    const face = (k) => {
      const c = document.querySelector(`[data-key="${k}"] canvas`);
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const n = new Map();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) n.set(hex(d, i), (n.get(hex(d, i)) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1])[0][0];
    };
    const sheet = document.createElement("div");
    sheet.id = "cdSheet";
    sheet.style.cssText = "position:fixed;left:0;top:0;z-index:99;display:grid;grid-template-columns:repeat(2,auto);gap:4px;padding:4px;background:#000";
    const dpr = window.devicePixelRatio;
    const scale = skin.px(2);
    const out = [];
    for (const m of T.MODES) {
      T.apply(m.id === "custom" ? { mode: "custom", colors: custom } : { mode: m.id });
      skin.refreshColors();
      const p = skin.palette;
      out.push({ id: m.id, A: face("A"), B: face("B"), C: face("C"), D: face("D"), accent: p.base.accent, ab: p.ab, cd: p.cd, cdInk: p.cdInk });
      const cell = document.createElement("div");
      cell.style.cssText = `display:flex;align-items:center;gap:6px;padding:6px 10px;background:${p.body};color:${p.base.ink};font:12px/16px var(--font-small)`;
      const name = document.createElement("span");
      name.style.cssText = "width:84px";
      name.textContent = m.id;
      cell.append(name);
      for (const label of ["A", "B", "C", "D"]) {
        const src = PX.renderRoundButton({ label, scale, palette: p }).canvas;
        const copy = document.createElement("canvas");
        copy.width = src.width;
        copy.height = src.height;
        copy.style.width = `${src.width / dpr}px`;
        copy.getContext("2d").drawImage(src, 0, 0);
        cell.append(copy);
      }
      sheet.append(cell);
    }
    document.body.append(sheet);
    return out;
  }, CUSTOM_DEFAULT);
  await page.locator("#cdSheet").screenshot({ path: path.join(SHOTS, "테마비교_13.png") });
  for (const r of rows) {
    const a = hueSat(r.ab);
    const c = hueSat(r.cd);
    const dh = Math.min(Math.abs(a.h - c.h), 360 - Math.abs(a.h - c.h));
    const apart = a.s < 0.15 ? c.s >= 0.4 : dh >= 60;
    const painted = r.A === r.ab && r.B === r.ab && r.ab === r.accent && r.C === r.cd && r.D === r.cd;
    const inkRatio = ratio(r.cd, r.cdInk);
    ok(`C·D 색 ${r.id}: A·B 와 다른 계열·글자 대비 ≥ 3·칠한 색 맞음`, apart && inkRatio >= 3 && painted, `A·B ${r.ab} C·D ${r.cd} 글자 ${r.cdInk} · 색상 차 ${dh.toFixed(0)}° 채도 ${c.s.toFixed(2)} · 대비 ${inkRatio.toFixed(1)} · 칠한 색 A ${r.A} B ${r.B} C ${r.C} D ${r.D}`);
    console.log(`색 ${r.id}: A·B ${r.ab} · C·D ${r.cd} · 글자 ${r.cdInk} · 색상 차 ${dh.toFixed(0)}° · 대비 ${inkRatio.toFixed(1)}`);
  }
  ok(`C·D 색: 페이지 오류 없음`, page.errors.length === 0, page.errors.join(" | "));
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

// ── 라이브러리(책장)·첫 화면 최근 줄 ──
const LIB_VIEWS = [
  { name: "390x844", width: 390, height: 844, langs: ["ko", "en", "ja"] },
  { name: "844x390", width: 844, height: 390, langs: ["ko", "en", "ja"] },
  { name: "360x640", width: 360, height: 640, langs: ["ko"] },
  { name: "320x568", width: 320, height: 568, langs: ["ko", "en", "ja"] },
  { name: "568x320", width: 568, height: 320, langs: ["ko", "ja"] },
].filter((view) => !VIEW_FILTER || VIEW_FILTER.has(view.name));
const LIB_SHOTS = { "390x844|ko|start": "라이브러리_첫화면_390x844.png", "390x844|ko|library": "라이브러리_세로_390x844.png", "844x390|ko|library": "라이브러리_가로_844x390.png", "320x568|ko|library": "라이브러리_세로_320x568.png", "568x320|ko|library": "라이브러리_가로_568x320.png", "320x568|ko|running": "라이브러리_실행중_320x568.png" };

// 1KB 가짜 기록(롬 아님) + 코드로 그린 임시 롬팩 그림(k = 2: 라벨 96x64 · 앞면 108x88 · 옆면 24x88)
async function seedLibrary(page) {
  await page.evaluate(async () => {
    const s = window.webgba.store;
    const png = async (w, h, paint) => {
      const c = new OffscreenCanvas(w, h);
      paint(c.getContext("2d"));
      return new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    };
    const front = await png(108, 88, (g) => {
      g.fillStyle = "#04060d";
      g.fillRect(0, 0, 108, 88);
      g.fillStyle = "#2f6f5e";
      g.fillRect(2, 2, 104, 84);
      g.fillStyle = "#1c4a3e";
      g.fillRect(4, 8, 100, 68);
    });
    const label = await png(96, 64, (g) => {
      g.fillStyle = "#172259";
      g.fillRect(0, 0, 96, 64);
      g.fillStyle = "#58c070";
      g.fillRect(0, 46, 96, 18);
      g.fillStyle = "#ffe39a";
      g.fillRect(66, 10, 14, 14);
    });
    const spine = await png(36, 92, (g) => {
      g.fillStyle = "#04060d";
      g.fillRect(0, 0, 36, 92);
      g.fillStyle = "#2f6f5e";
      g.fillRect(2, 2, 32, 88);
      g.fillStyle = "#dfe4f0";
      g.fillRect(4, 10, 28, 68);
    });
    const fake = (n) => new Uint8Array(1024 + n);
    let t = Date.now();
    const opened = (id) => s.patch(s.romKey(id), { opened: (t -= 1000) });
    await s.putGame(
      { id: "art", name: "star.wgba", file: "star.wgba", type: "wgba", gameId: "dev.example.star", version: "0.9.1", build: "a".repeat(64), title: "Star Garden", shortName: "Star", author: "example", romSha1: "", cart: { color: "#2f6f5e", label: { format: "png", width: 96, height: 64, scale: 2 }, front: { format: "png", width: 108, height: 88, scale: 2, labelAt: [6, 10] }, spine: { format: "png", width: 36, height: 92, scale: 2, textArea: [4, 10, 28, 68] } } },
      fake(0),
      { carts: [{ part: "label", bytes: label, format: "png", width: 96, height: 64 }, { part: "front", bytes: front, format: "png", width: 108, height: 88 }, { part: "spine", bytes: spine, format: "png", width: 36, height: 92 }] },
    );
    await s.putSave("dev.example.star", new Uint8Array(4096), "star.wgba");
    await opened("art");
    await s.putGame({ id: "color", name: "racer.wgba", file: "racer.wgba", type: "wgba", gameId: "dev.example.racer", version: "2.0.3", build: "b".repeat(64), title: { ko: "작은 경주", en: "Tiny Racer", ja: "タイニーレーサー" }, shortName: "", author: "", romSha1: "", cart: { color: "#d9a02b" } }, fake(1), { carts: [] });
    await opened("color");
    await s.putRom({ id: "gba", name: "테스트 게임 둘.gba", file: "테스트 게임 둘.gba", type: "gba" }, fake(2));
    await s.putSave("gba", new Uint8Array(4096), "테스트 게임 둘.gba");
    await opened("gba");
    await s.putRom({ id: "wasm", name: "homebrew-demo.wasm", file: "homebrew-demo.wasm", type: "wasm" }, fake(3));
    await opened("wasm");
    const names = ["Moon Hopper", "Pixel Quest", "던전 런", "Sky Fisher", "Neon Drift", "꼬마 농장", "Robo Run", "テスト ゲーム", "Bit Golf", "Ghost Lamp", "Rail Way", "Mini Chef", "바다 탐험", "Crystal Cave", "Hop Frog", "Space Mail", "Tile Town", "별빛 우체국", "Cloud Kite", "Iron Bee", "숲속 학교", "A very long game name for testing"];
    for (const [i, name] of names.entries()) {
      await s.putRom({ id: `m${i}`, name: `${name}.gba`, file: `${name}.gba`, type: "gba" }, fake(10 + i));
      await opened(`m${i}`);
    }
  });
}

const boxOf = (r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom });
const within = (list, box) => list.every((x) => x.l >= box.l - 0.5 && x.r <= box.r + 0.5 && x.t >= box.t - 0.5 && x.b <= box.b + 0.5);
const crosses = (list) => list.some((x, i) => list.some((y, j) => j > i && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5));

async function libraryLayout(page) {
  return page.evaluate(() => {
    const box = (n) => {
      const r = n.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    const one = (sel) => document.querySelector(sel);
    const card = one(".lib__card");
    const shelf = one(".lib__shelf");
    const scroll = one(".lib__scroll");
    const caseBox = one(".lib__case");
    const spines = [...document.querySelectorAll(".lib__case .spine")];
    const arts = [...document.querySelectorAll(".sheet__body .cart__art")].map((c) => ({ ratio: c.getBoundingClientRect().width / c.width, ratioH: c.getBoundingClientRect().height / c.height, pixelated: getComputedStyle(c).imageRendering }));
    const cardParts = card ? [...card.querySelectorAll(".lib__pack, .lib__line, .lib__meta, .lib__btns .btn, .lib__hint")].filter((n) => n.offsetParent).map(box) : [];
    return {
      body: box(one(".sheet__body")),
      card: card ? box(card) : null,
      cardScroll: card ? card.scrollWidth - card.clientWidth : 0,
      cardParts,
      cardView: card ? (() => { const r = box(card); return { ...r, b: r.t + card.clientHeight }; })() : null,
      shelf: box(shelf),
      scroll: box(scroll),
      caseBox: box(caseBox),
      spines: spines.map(box),
      spineRows: new Set(spines.map((n) => Math.round(n.getBoundingClientRect().height))).size,
      arts,
      // 버튼 글이 말줄임으로 잘리면 안 됨(이름·버전 줄은 말줄임 허용)
      btnOver: [...document.querySelectorAll(".lib__btns .btn__label, .lib__shelfHead .btn__label")].filter((n) => n.offsetParent && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent),
    };
  });
}

for (const view of LIBRARY ? LIB_VIEWS : []) {
  for (const lang of view.langs) {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: view.width, height: view.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.addInitScript((lang) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      localStorage.setItem("webgba.prefs", JSON.stringify({ lang }));
    }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(URL_BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
    await seedLibrary(page);
    await page.evaluate(() => window.webgba.refreshStart());
    await page.waitForTimeout(500);
    const key = `${view.name}|${lang}`;
    const landscape = view.width > view.height;

    // 첫 화면 최근 줄: 세로 3개·가로 5개까지 들어가는 만큼(줄이지 않음), 게임 화면 안, 겹침 0, 굴림 없음
    const start = await page.evaluate(() => {
      const box = (n) => {
        const r = n.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom };
      };
      const items = [...document.querySelectorAll("#startList .recent__item")].filter((n) => !n.hidden).map(box);
      const startNode = document.getElementById("start");
      const packs = [...document.querySelectorAll("#startList .recent__item:not([hidden]) .pack")].map((n) => Math.round(n.getBoundingClientRect().width));
      return { screen: box(document.getElementById("screen")), items, all: box(document.getElementById("startAll")), width: document.getElementById("startList").clientWidth, overflow: startNode.scrollHeight - startNode.clientHeight, packs };
    });
    const n = start.items.length;
    const max = landscape ? 5 : 3;
    const oneMore = (n + 1) * 108 + n * 4 <= start.width;
    ok(`${key}|start 최근 롬팩 ${n}개(세로 3·가로 5까지 들어가는 만큼) · 108px 그대로 · 화면 안 · 겹침 0 · 굴림 없음`, n >= 1 && n <= max && (n === max || !oneMore) && start.packs.every((w) => w === 108) && within([...start.items, start.all], start.screen) && !crosses(start.items) && start.overflow <= 0, JSON.stringify({ n, width: start.width, overflow: start.overflow, packs: start.packs }));
    await measure(page, `${key}|start`, [".recent__name", ".recent__meta", ".recent__all", ".start__head", "#startList .pack__label"]);
    if (LIB_SHOTS[`${key}|start`]) await page.screenshot({ path: path.join(SHOTS, LIB_SHOTS[`${key}|start`]) });

    // 라이브러리
    if (!landscape) {
      await page.click("#btnMenu");
      await page.waitForTimeout(250);
    }
    await page.click("#btnLibrary");
    await page.waitForSelector('#sheet:not([hidden]) .lib__card[data-state="open"]');
    await page.waitForTimeout(400);
    await fits(page, `${key}|library`, ".sheet__panel");
    const lay = await libraryLayout(page);
    ok(`${key}|library 꺼낸 롬팩 칸·책장이 시트 안 · 서로 겹침 0`, within([lay.card, lay.shelf], lay.body) && !crosses([lay.card, lay.shelf]), JSON.stringify({ card: lay.card, shelf: lay.shelf, body: lay.body }));
    ok(`${key}|library 꺼낸 칸의 롬팩·이름·버튼이 칸 안 · 서로 겹침 0 · 가로 넘침 0 · 버튼 글 안 잘림`, within(lay.cardParts, lay.cardView) && !crosses(lay.cardParts) && lay.cardScroll <= 0 && lay.btnOver.length === 0, JSON.stringify({ parts: lay.cardParts.length, scroll: lay.cardScroll, over: lay.btnOver }));
    ok(`${key}|library 옆면은 책장 안(가로 넘침 0) · 겹침 0 · 칸 높이 하나`, lay.spines.length > 20 && lay.spines.every((x) => x.l >= lay.caseBox.l - 0.5 && x.r <= lay.caseBox.r + 0.5) && !crosses(lay.spines) && lay.spineRows === 1, JSON.stringify({ n: lay.spines.length, case: lay.caseBox }));
    ok(`${key}|library 롬팩 그림 정수 배율(CSS px/그림 px)·가장 가까운 점`, lay.arts.length > 20 && lay.arts.every((a) => Number.isInteger(+a.ratio.toFixed(3)) && a.ratio >= 1 && Math.abs(a.ratio - a.ratioH) < 0.001 && a.pixelated === "pixelated"), JSON.stringify([...new Set(lay.arts.map((a) => `${a.ratio}/${a.pixelated}`))]));
    await measure(page, `${key}|library`, [".sheet__head", ".lib__name", ".lib__meta", ".lib__btns .btn", ".lib__shelfHead .btn", ".lib__count"]);
    if (LIB_SHOTS[`${key}|library`]) await page.screenshot({ path: path.join(SHOTS, LIB_SHOTS[`${key}|library`]) });

    // 꺼내기·넣기(움직임 줄이기 = 바로)
    const keys = await page.$$eval(".lib__case .spine[data-key]", (nodes) => nodes.map((node) => node.dataset.key));
    const first = await page.getAttribute(".lib__card", "data-key");
    await page.click(`.spine[data-key="${keys[2]}"]`);
    await page.waitForTimeout(200);
    const pulled = await page.evaluate((k) => ({ card: document.querySelector(".lib__card").dataset.key, out: [...document.querySelectorAll(".spine.is-out")].map((n) => n.dataset.key), pressed: document.querySelector(`.spine[data-key="${k}"]`).getAttribute("aria-pressed") }), keys[2]);
    ok(`${key}|library 옆면 누르면 꺼냄(이전 것은 제자리) · 빈칸 하나`, first === keys[0] && pulled.card === keys[2] && pulled.out.join() === keys[2] && pulled.pressed === "true", JSON.stringify({ first, pulled }));
    await measure(page, `${key}|library-pulled`, [".lib__card .pack__label", ".lib__name", ".lib__meta"]);
    await page.click(`.spine[data-key="${keys[2]}"]`);
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => ({ state: document.querySelector(".lib__card").dataset.state, out: document.querySelectorAll(".spine.is-out").length }));
    ok(`${key}|library 빈칸 누르면 넣음 → 안내`, back.state === "empty" && back.out === 0, JSON.stringify(back));
    await measure(page, `${key}|library-empty`, [".lib__hint"]);

    // 정렬: 버튼으로 이름순 ↔ 최근 연 순(기억)
    await page.click('[data-action="sort"]');
    await page.waitForTimeout(400);
    const sorted = await page.evaluate(() => {
      const names = [...document.querySelectorAll(".lib__case .spine[data-key]")].map((n) => n.getAttribute("aria-label"));
      const collator = new Intl.Collator(document.documentElement.lang || "ko", { numeric: true, sensitivity: "base" });
      return { names, ok: names.every((name, i) => i === 0 || collator.compare(names[i - 1], name) <= 0), pref: JSON.parse(localStorage.getItem("webgba.prefs")).libSort };
    });
    await page.click('[data-action="sort"]');
    await page.waitForTimeout(400);
    const recentAgain = await page.$$eval(".lib__case .spine[data-key]", (nodes) => nodes.map((node) => node.dataset.key));
    ok(`${key}|library 정렬: 이름순 → 다시 최근 연 순(기억)`, sorted.ok && sorted.pref === "name" && recentAgain.join() === keys.join(), sorted.names.slice(0, 4).join(" / "));

    // 실행 중인 게임을 꺼낸 칸(버튼 6개)
    await page.evaluate(() => {
      window.webgba.state.game = { id: "art", saveId: "dev.example.star", name: "star.wgba" };
      window.webgba.state.lib.sel = "rom:art";
      window.webgba.renderSheet();
    });
    await page.waitForTimeout(400);
    const run = await libraryLayout(page);
    const runButtons = await page.$$eval(".lib__btns .btn", (nodes) => nodes.map((node) => node.dataset.action));
    ok(`${key}|running 실행 중 칸: 계속하기·세이브·다시 시작·게임 닫기·이름·지우기 · 칸 안 · 겹침 0 · 버튼 글 안 잘림`, runButtons.join() === "resume,saves,reset,close-game,rename,delete" && within(run.cardParts, landscape ? { ...run.cardView, b: Infinity } : run.cardView) && !crosses(run.cardParts) && run.cardScroll <= 0 && run.btnOver.length === 0 && Boolean(await page.$(".lib__card .pack__chip")) && Boolean(await page.$('.spine[data-key="rom:art"] .spine__run')), `${runButtons.join()} · 잘림 ${run.btnOver.join("/")}`);
    await measure(page, `${key}|running`, [".lib__btns .btn", ".pack__chip"]);
    if (LIB_SHOTS[`${key}|running`]) await page.screenshot({ path: path.join(SHOTS, LIB_SHOTS[`${key}|running`]) });
    await page.evaluate(() => (window.webgba.state.game = null));
    ok(`${key}|library 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// 꺼내기·넣기 움직임(움직임 줄이기 끔): transform·opacity 만, --pop-ms 시간, 넣기만 할 때 칸 내용은 움직임 뒤 안내로
if (LIBRARY) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko" }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await seedLibrary(page);
  await page.evaluate(() => window.webgba.openSheet("library"));
  await page.waitForSelector('.lib__card[data-state="open"]');
  // 첫 누르기는 소리 켜기(오디오 준비, 라이브러리와 무관)가 수백 ms 걸리므로 먼저 한 번 눌러 둔다
  await page.evaluate(() => document.querySelector(".lib__count").click());
  await page.waitForTimeout(800);
  const out = await page.evaluate(async () => {
    const card = document.querySelector(".lib__card");
    const target = [...document.querySelectorAll(".lib__case .spine[data-key]")][3];
    const art = target.querySelector(".spine__art");
    const props = new Set();
    const look = () => {
      const s = getComputedStyle(art);
      const m = s.transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(s.transform);
      for (const anim of document.getAnimations()) for (const frame of anim.effect?.getKeyframes?.() ?? []) for (const name of Object.keys(frame)) if (!["offset", "easing", "composite", "computedOffset"].includes(name)) props.add(name);
      const grid = card.querySelector(".lib__grid");
      const pack = card.querySelector(".lib__pack");
      return { op: +(+s.opacity).toFixed(3), ty: +m.m42.toFixed(2), out: target.classList.contains("is-out"), card: card.dataset.key, state: card.dataset.state, packOp: pack ? +(+getComputedStyle(pack).opacity).toFixed(3) : -1, gridOp: grid ? +(+getComputedStyle(grid).opacity).toFixed(3) : -1 };
    };
    const record = (ms, act) =>
      new Promise((done) => {
        const start = performance.now();
        act();
        const frames = [{ t: 0, ...look() }];
        const step = (now) => {
          frames.push({ t: +(now - start).toFixed(1), ...look() });
          if (now - start < ms) requestAnimationFrame(step);
          else done(frames);
        };
        requestAnimationFrame(step);
      });
    const pull = await record(450, () => target.click());
    const put = await record(500, () => target.click());
    return { pull, put, props: [...props], pop: getComputedStyle(document.documentElement).getPropertyValue("--pop-ms").trim(), key: target.dataset.key };
  });
  const mid = (frames, field) => frames.filter((f) => f[field] > 0.02 && f[field] < 0.98).length;
  const lastPull = out.pull[out.pull.length - 1];
  const outAt = out.pull.find((f) => f.out)?.t ?? -1;
  ok("라이브러리 움직임: transform·opacity 만", out.props.length > 0 && out.props.every((p) => p === "transform" || p === "opacity"), out.props.join(","));
  ok(`라이브러리 움직임: 꺼내기 — 옆면이 위로 빠지며 사라지고(중간 ${mid(out.pull, "op")}프레임) 끝나면 빈칸(${outAt}ms, --pop-ms ${out.pop})`, mid(out.pull, "op") >= 2 && out.pull.some((f) => f.ty < -1) && lastPull.out && outAt >= 150 && outAt <= 400);
  ok(`라이브러리 움직임: 꺼낸 앞면이 올라오며 나타남(중간 ${mid(out.pull, "packOp")}프레임)`, lastPull.card === out.key && mid(out.pull, "packOp") >= 2 && lastPull.packOp === 1);
  const lastPut = out.put[out.put.length - 1];
  const openSeen = Math.max(0, ...out.put.filter((f) => f.state === "open" && f.gridOp > 0.02).map((f) => f.t));
  ok(`라이브러리 움직임: 넣기 — 옆면이 제자리로(끝 불투명도 ${lastPut.op}) · 칸 내용은 움직임 뒤 안내로(마지막으로 보인 ${openSeen}ms)`, !lastPut.out && lastPut.op === 1 && mid(out.put, "gridOp") >= 2 && openSeen >= 100 && lastPut.state === "empty");
  ok("라이브러리 움직임: 페이지 오류 없음", errors.length === 0, errors.join(" | "));
  fs.writeFileSync(path.join(SHOTS, "라이브러리_꺼내기_프레임.txt"), ["pull", "put"].map((name) => `${name}: ${out[name].map((f) => `${f.t}ms 옆면 ${f.op}/${f.ty}px${f.out ? " 빈칸" : ""} · 앞면 ${f.packOp} · 칸 ${f.state} ${f.gridOp}`).join(" | ")}`).join("\n"));
  await context.close();
}

// UI_NET_WGBA=<멀티플레이 예제 .wgba> 이면 멀티플레이 연결 창(고르기·방장 코드·QR·참가 코드 넣기)을 세 화면 크기 × 세 언어로 잰다(UI_NET_ONLY=1 이면 그것만).
async function netChecks() {
  const bytes = fs.readFileSync(process.env.UI_NET_WGBA).toString("base64");
  for (const view of [...VIEWS, ...(VIEW_FILTER && !VIEW_FILTER.has("320x568") ? [] : [{ name: "320x568", viewport: { width: 320, height: 568 } }])]) {
    for (const lang of LANGS) {
      const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: 2, reducedMotion: "reduce" });
      await context.addInitScript((lang) => {
        Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
        if (window !== window.top) return;
        localStorage.setItem("webgba.installHint", "1");
        localStorage.setItem("webgba.prefs", JSON.stringify({ lang, netNo: "1234" }));
      }, lang);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(URL_BASE);
      await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
      await page.evaluate(async (b64) => {
        const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await window.webgba.openFiles([new File([data], "net-demo.wgba")]);
      }, bytes);
      await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
      await page.evaluate(() => {
        window.webgba.player.keyDown("KeyZ");
        setTimeout(() => window.webgba.player.keyUp("KeyZ"), 120);
      });
      await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
      await page.waitForTimeout(500);
      const base = `${view.name}|${lang}`;
      const parts = [".sheet__head", ".net-line", ".net-actions", "#sheetBody .field"];
      await measure(page, `${base}|net-choose`, parts);
      await fits(page, `${base}|net-choose`, ".sheet__panel");
      if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `멀티_${view.name}_고르기.png`) });
      await page.click('[data-action="net-make"]');
      await page.waitForFunction(() => document.querySelector('[data-action="net-offer"]')?.value, null, { timeout: 10000 });
      await page.waitForTimeout(500);
      await measure(page, `${base}|net-host`, [".sheet__head", ".net-member", ".net-line", ".net-actions"]);
      await rows(page, `${base}|net-host`, ".net-member");
      await page.click('[data-action="net-offer-qr"]');
      await page.waitForTimeout(400);
      const qr = await page.evaluate(() => {
        const c = document.querySelector(".net-qr__img");
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { w: r.width, h: r.height, px: c.width, inView: r.right <= innerWidth + 0.5 && r.left >= -0.5 };
      });
      ok(`${base}|net-qr QR 그림(정사각·화면 폭 안)`, qr && Math.abs(qr.w - qr.h) < 0.5 && qr.inView && qr.w >= 150, JSON.stringify(qr));
      const lay = await page.evaluate(() => {
        const body = document.getElementById("sheetBody");
        const b = body.getBoundingClientRect();
        const head = document.querySelector(".sheet__head").getBoundingClientRect();
        const kids = [...body.children].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
        const deep = [...body.querySelectorAll(".net-invite > *, .net-line > *, .net-member")].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
        let overlap = 0;
        for (let i = 1; i < kids.length; i++) if (kids[i].top < kids[i - 1].bottom - 0.5) overlap++;
        return { overlap, wide: deep.filter((r) => r.right > b.right + 0.5 || r.left < b.left - 0.5).length, hScroll: body.scrollWidth > body.clientWidth + 1, top: Math.round((kids[0].top - head.bottom) * 10) / 10 };
      });
      ok(`${base}|net-qr 겹침·가로 넘침 없음, 제목 위 여백 16`, lay.overlap === 0 && lay.wide === 0 && !lay.hScroll && lay.top === 16, JSON.stringify(lay));
      if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `멀티_${view.name}_방장코드_QR.png`) });
      await page.click('[data-action="net-cancel"]');
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        window.webgba.player.keyDown("KeyZ");
        setTimeout(() => window.webgba.player.keyUp("KeyZ"), 120);
      });
      await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
      await page.click('[data-action="net-join"]');
      await page.waitForTimeout(400);
      await measure(page, `${base}|net-join`, [".sheet__head", ".net-line", ".net-actions", "#sheetBody .field"]);
      await fits(page, `${base}|net-join`, ".sheet__panel");
      if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `멀티_${view.name}_참가.png`) });
      ok(`${base}|net 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
}

if (process.env.UI_NET_WGBA && process.env.UI_NET !== "0") await netChecks();

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
