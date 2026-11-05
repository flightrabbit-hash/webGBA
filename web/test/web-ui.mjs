// 웹 webGBA 화면 규칙 시험(로컬 전용): 팝업이 보이는 화면 안에 다 들어오는지, 같은 종류 줄의 높이·간격이 같은지,
// 줄·버튼 안 아이콘·글자가 잉크(보이는 픽셀) 기준 세로 가운데인지(위·아래 여백 차이 ≤ 1px).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-ui.mjs <주소> <캡처 폴더> [--chrome <chrome.exe>]
// 보관함 줄은 1KB 짜리 가짜 기록을 넣어 만든다(롬 아님).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
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
// UI_BOARD_ONLY=1 이면 멀티플레이 상태 메뉴 시험만(UI_NET_WGBA 의 예제를 열고 가짜 세션·표로 320x568·390x844·844x390 × 세 언어)
const ONLY_BOARD = process.env.UI_BOARD_ONLY === "1";
// UI_CHOICE_ONLY=1 이면 선택 칸(아래에서 올라오는 옵션 목록) 시험만(UI_CHOICE=0 이면 그것만 뺌): 설정의 선택 칸마다 열기·고르기·닫기·키보드·게임패드·
// 뒤로 가기·바깥 누르기, 320x568·390x844·844x390 화면 안·잉크 가운데·줄 여백, 6배 느린 CPU 열기 시간, WebKit 한 번.
const ONLY_CHOICE = process.env.UI_CHOICE_ONLY === "1";
// UI_ASPECT_ONLY=1 이면 표시 비율·방향 입력 기본값 시험만(아래 "표시 비율" 절, 다른 시험과 함께 돌리려면 UI_ASPECT=1)
const ONLY_ASPECT = process.env.UI_ASPECT_ONLY === "1";
// UI_GB_ONLY=1 이면 GB·GBC 시험만(아래 "GB·GBC" 절, UI_GB_DIR = 직접 만든 테스트 롬 폴더 — 저장소 밖, 경로 조회만)
const ONLY_GB = process.env.UI_GB_ONLY === "1";
// UI_ANYTIME_ONLY=1 이면 중간 참가 게임(join: "anytime") 연결 창·상단 버튼 시험만(UI_NET_WGBA 를 메모리에서 다시 묶음, <주소> 는 /api/v1/mp 를 내주는 로컬 서버)
const ONLY_ANYTIME = process.env.UI_ANYTIME_ONLY === "1";
// UI_AUTOFIRE_ONLY=1 이면 설정의 연사 켜기·단계 바 줄 시험만(세 화면 × 세 언어 — 잉크 세로 가운데·화면 안·끔이면 바 비활성)
const ONLY_AUTOFIRE = process.env.UI_AUTOFIRE_ONLY === "1";
// UI_OVERLAY_ONLY=1 이면 가상 버튼 오버레이 시험만(가로 = 화면 최대·게임 화면 안 반투명 버튼·입력·눌림, 세로 = 표시와 같음, 회전, 표시·숨김 그대로)
const ONLY_OVERLAY = process.env.UI_OVERLAY_ONLY === "1";
// UI_SETTEXT_ONLY=1 이면 설정 줄 문구·테마 목록(대표 색 4개 견본, 커스텀 없음)·빈 라이브러리·빈 세이브 시험만. UI_CAPTURE = 기능 캡처 폴더(없으면 캡처 폴더)
const ONLY_SETTEXT = process.env.UI_SETTEXT_ONLY === "1";
const CAPTURE = process.env.UI_CAPTURE || "";
// UI_HOSTBACK_ONLY=1 이면 방장 돌아오기 화면 시험만(방장 '이전 방' 칸·주황 버튼 대비(테마 12개)·유저 '방장을 기다리는 중', 390x844·844x390·PC × 세 언어, UI_NET_WGBA 를 rejoin 으로 다시 묶음)
const ONLY_HOSTBACK = process.env.UI_HOSTBACK_ONLY === "1";
// UI_NAMES_ONLY=1 이면 설명서 언어별 이름(name·shortName) 시험만: 세 화면 × 세 언어 × 이름 형태 9가지 — 첫 화면·옆면·꺼낸 칸 표시 글·넘침 0·잉크 가운데
const ONLY_NAMES = process.env.UI_NAMES_ONLY === "1";
const ONLY_OTHER = ONLY_NET || ONLY_BOARD || ONLY_ASPECT || ONLY_GB || ONLY_ANYTIME || ONLY_AUTOFIRE || ONLY_OVERLAY || ONLY_SETTEXT || ONLY_HOSTBACK || ONLY_NAMES;
const EXTRA = !ONLY_OTHER && (ONLY_EXTRA || (!ONLY_MOTION && !ONLY_LIBRARY && !ONLY_CHOICE && process.env.UI_EXTRA !== "0"));
const BASE_URL = process.env.UI_BASE_URL ?? "";
const SKIP_MAIN = ONLY_MOTION || ONLY_EXTRA || ONLY_LIBRARY || ONLY_CHOICE || ONLY_OTHER;
const MOTION = !ONLY_OTHER && !ONLY_EXTRA && !ONLY_LIBRARY && !ONLY_CHOICE && (ONLY_MOTION || process.env.UI_MOTION !== "0");
const LIBRARY = !ONLY_OTHER && (ONLY_LIBRARY || (!ONLY_MOTION && !ONLY_EXTRA && !ONLY_CHOICE && process.env.UI_LIBRARY !== "0"));
const CHOICE = !ONLY_OTHER && (ONLY_CHOICE || (!ONLY_MOTION && !ONLY_EXTRA && !ONLY_LIBRARY && process.env.UI_CHOICE !== "0"));
const ASPECT = ONLY_ASPECT || process.env.UI_ASPECT === "1";
const SHOT_PLAN = { "390x844|ko|bar": "", "844x390|ko|bar": "가로_844x390_기능버튼.png", "390x844|ko|menu": "세로_390x844_햄버거.png", "390x844|ko|settings": "세로_390x844_설정.png", "390x844|ko|info": "세로_390x844_정보_게임_소리.png","844x390|ko|library": "가로_844x390_라이브러리.png", "360x640|ko|rename": "세로_360x640_이름입력.png", "390x844|ja|saves": "세로_390x844_세이브_일본어.png" };

const results = [];
const table = [];
const padTable = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.log(`실패 ${name}${detail ? ` — ${detail}` : ""}`);
};

// UI_BROWSER=webkit 이면 주 화면 시험을 WebKit(아이폰 사파리 엔진)으로. 엣지는 --chrome <msedge.exe>.
const browser = process.env.UI_BROWSER === "webkit" ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: CHROME, headless: true });

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

// 줄마다 위 여백 = 아래 여백(줄 상자 → 글자 잉크·조작 칸 틀 중 바깥, 1px 이내), 모든 줄의 여백이 같음(1px 이내).
// 위아래 선은 줄 상자 밖(앞 줄의 아래 선·묶음 구분선)이라 줄 상자에서 잰다. 아래로 굴리며 다 보이는 줄을 한 번씩 잰다.
async function rowPads(page, key, selector) {
  const dpr = await page.evaluate(() => devicePixelRatio);
  const count = await page.evaluate((s) => document.querySelectorAll(s).length, selector);
  const pads = new Map();
  for (let round = 0; round <= count && pads.size < count; round++) {
    const next = [...Array(count).keys()].find((i) => !pads.has(i));
    await page.evaluate(([s, i]) => document.querySelectorAll(s)[i].scrollIntoView({ block: "start" }), [selector, next]);
    await page.waitForTimeout(80);
    const image = await shoot(page);
    const list = await page.evaluate(
      ([s, controls]) => {
        const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2;
        const vh = window.visualViewport?.height ?? innerHeight;
        return [...document.querySelectorAll(s)].map((node, i) => {
          const r = node.getBoundingClientRect();
          const st = getComputedStyle(node);
          let top = 0;
          let bottom = vh;
          for (let at = node.parentElement; at; at = at.parentElement) {
            const o = getComputedStyle(at).overflowY;
            if (o === "auto" || o === "hidden" || o === "scroll") {
              const c = at.getBoundingClientRect();
              top = Math.max(top, c.top);
              bottom = Math.min(bottom, c.bottom);
            }
          }
          const frames = [...node.querySelectorAll(controls)]
            .filter((c) => c.getBoundingClientRect().width > 0)
            .map((c) => {
              const b = c.getBoundingClientRect();
              return { left: b.left - px, right: b.right + px, top: b.top - px, bottom: b.bottom + px };
            });
          const icons = [...node.querySelectorAll(".icon")]
            .filter((c) => getComputedStyle(c).visibility === "visible" && c.getBoundingClientRect().width > 0)
            .map((c) => {
              const b = c.getBoundingClientRect();
              return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
            });
          const label = (node.querySelector(".field__label, .choice__label")?.textContent ?? "").trim();
          return { i, label, visible: r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5, left: r.left, right: r.right, top: r.top + parseFloat(st.borderTopWidth), bottom: r.bottom - parseFloat(st.borderBottomWidth), inset: 3, frames, icons, mask: frames.map((f) => [f.left - 1, f.top - 1, f.right + 1, f.bottom + px + 1]) };
        });
      },
      [selector, CONTROLS],
    );
    for (const row of list) {
      if (!row.visible || pads.has(row.i)) continue;
      const ink = inkCheck(image, dpr, row);
      let top = ink ? ink.top : Infinity;
      let bottom = ink ? ink.bottom : Infinity;
      for (const f of row.frames) {
        top = Math.min(top, f.top - row.top - 1 / dpr);
        bottom = Math.min(bottom, row.bottom - f.bottom - 1 / dpr);
      }
      // 같은 줄 요소: 글자 잉크(조작 칸·아이콘 가림)의 가운데 = 조작 칸 틀·아이콘 칸의 가운데(위·아래가 같은 만큼 안쪽)
      const text = inkCheck(image, dpr, { ...row, mask: [...row.mask, ...row.icons.map((c) => [c.left - 1, c.top - 1, c.right + 1, c.bottom + 1])] });
      const textMid = text ? (row.top + row.bottom + text.top - text.bottom) / 2 : null;
      const mids = [...row.frames, ...row.icons].map((f) => (f.top + f.bottom) / 2);
      const align = textMid === null || !mids.length ? 0 : Math.max(...mids.map((m) => Math.abs(m - textMid)));
      pads.set(row.i, { label: row.label, top: +top.toFixed(2), bottom: +bottom.toFixed(2), align: +align.toFixed(2), parts: mids.length + (text ? 1 : 0) });
    }
  }
  const all = [...pads.values()];
  for (const p of all) ok(`${key} ${p.label} 위·아래 여백 같음`, Number.isFinite(p.top) && Math.abs(p.top - p.bottom) <= 1, `위 ${p.top} · 아래 ${p.bottom}`);
  for (const p of all.filter((x) => x.parts > 1)) ok(`${key} ${p.label} 같은 줄 요소(글자·조작 칸·아이콘) 위·아래 맞춤(가운데 차이 ${p.align}px)`, p.align <= 1, `${p.align}`);
  const values = all.flatMap((p) => [p.top, p.bottom]);
  const spread = values.length ? Math.max(...values) - Math.min(...values) : Infinity;
  ok(`${key} 줄 ${all.length}/${count}개 여백 모두 같음(1px 이내)`, all.length === count && spread <= 1, `${Math.min(...values)}~${Math.max(...values)}px`);
  return all;
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
      // 가로: 좌·우 칸 위 한 줄씩(버튼 크기를 줄여 맞추고, 32px 아래가 될 때만 햄버거 메뉴 안으로) — 보이는 것 + 메뉴 안 = 기능 버튼 8개 모두, 게임 종료는 햄버거가 있을 때만 메뉴 마지막
      const inMenu = await page.evaluate(() => (getComputedStyle(document.querySelector("#btnMenu")).display === "none" ? [] : [...document.querySelectorAll(".bar__group--files .tool")].filter((b) => !b.hidden).map((b) => b.id)));
      const all = new Set([...list.map((x) => x.id), ...inMenu].filter((id) => id !== "btnMenu" && id !== "btnQuit"));
      const oneRow = new Set(list.map((x) => Math.round(x.t))).size === 1;
      const quitPlace = inMenu.length ? inMenu.at(-1) === "btnQuit" : !list.some((x) => x.id === "btnQuit");
      ok(`${base}|bar 가로: 한 줄 기능 버튼(32px 이상)·나머지는 메뉴 안(모두 ${all.size}개)·겹침 0·화면 안·게임 화면/버튼과 겹치지 않음`, oneRow && all.size === 8 && quitPlace && list.every((x) => x.r - x.l >= 32) && (inMenu.length === 0 || list[0]?.id === "btnMenu") && !overlap(list) && list.every((x) => x.l >= 0 && x.t >= 0 && x.r <= view.viewport.width && x.b <= view.viewport.height) && !hits, JSON.stringify({ shown: list.map((x) => x.id), inMenu }));
      await snap(page, `${base}|bar`);
    } else {
      const closed = await toolBoxes();
      ok(`${base}|bar 세로: 햄버거 + 퀵슬롯 + 기능 버튼 4개·겹침 0·화면 안`, closed.length === 6 && closed[0].id === "btnMenu" && closed[1].id === "btnQuick" && !overlap(closed) && inView(closed), JSON.stringify(closed.map((x) => x.id)));
      await page.click("#btnMenu");
      await page.waitForTimeout(250);
      const opened = await page.evaluate(() => [...document.querySelectorAll(".bar__group--files .tool")].map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
      ok(`${base}|menu 햄버거: 파일 열기·라이브러리·세이브·게임 종료 4개 펼침·화면 안`, opened.length === 4 && opened[3].id === "btnQuit" && inView(opened) && !overlap(opened), JSON.stringify(opened.map((x) => x.id)));
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
      if (await page.evaluate((sel) => Boolean(document.querySelector(sel)?.closest(".bar__group--files")) && getComputedStyle(document.querySelector("#btnMenu")).display !== "none", button)) {
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
    await measure(page, `${base}|settings`, [".sheet__head", ".field"]);
    await snap(page, `${base}|settings`);
    // 첫 줄은 머리 선 바로 아래(묶음 제목·위 간격 없음), 묶음 구분선은 줄 사이 선(위아래 간격 없음) — 여백은 모두 줄 안 여백 하나
    const edges = await page.evaluate(() => {
      const body = document.getElementById("sheetBody");
      body.scrollTop = 0;
      const first = body.querySelector(".field").getBoundingClientRect().top - body.getBoundingClientRect().top;
      const groups = [...body.querySelectorAll(".group")].map((g) => { const s = getComputedStyle(g); return [s.marginTop, s.marginBottom, s.paddingTop].map(parseFloat); });
      const fieldGroups = groups.slice(0, -1);
      return { first: +first.toFixed(2), extra: fieldGroups.flat().filter((v) => v > 0).length };
    });
    ok(`${base}|settings 첫 줄 = 머리 선 바로 아래 · 묶음 사이 덧 간격 0`, Math.abs(edges.first) < 0.5 && edges.extra === 0, JSON.stringify(edges));
    const pads = await rowPads(page, `${base}|settings·여백`, "#sheetBody .field");
    padTable.push({ key: base, pads });
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll("#sheetBody .field__label, #sheetBody .field__note, #sheetBody .pick__value")]
        .filter((n) => {
          const row = n.closest(".field").getBoundingClientRect();
          const r = n.getBoundingClientRect();
          return n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 || r.top < row.top - 0.5 || r.bottom > row.bottom + 0.5;
        })
        .map((n) => n.textContent.trim()),
    );
    ok(`${base}|settings 이름·설명·선택 값 잘림 0`, cut.length === 0, cut.join(" / "));
    // 상태가 바뀌어도(토글 켜기·끄기) 같은 줄 요소 위·아래 그대로(손잡이는 가로로만), 나란한 단추(조작법·정보) 위·아래 같음
    const states = await page.evaluate(async () => {
      const edge = (n) => {
        const b = n.getBoundingClientRect();
        return [b.top, b.bottom];
      };
      const knobY = (n) => {
        const m = getComputedStyle(n, "::after").transform;
        return m && m !== "none" ? new DOMMatrixReadOnly(m).m42 : 0;
      };
      const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const out = [];
      for (const sw of document.querySelectorAll("#sheetBody .switch:not(:disabled)")) {
        sw.scrollIntoView({ block: "center" });
        await frame();
        const a = edge(sw);
        const ka = knobY(sw);
        sw.click();
        await frame();
        const b = edge(sw);
        const kb = knobY(sw);
        sw.click();
        await frame();
        out.push({ name: sw.getAttribute("aria-label"), move: +Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])).toFixed(2), knob: +Math.abs(ka - kb).toFixed(2) });
      }
      const btns = [...document.querySelectorAll("#sheetBody .start__actions .btn")].map(edge);
      return { out, btns: btns.length, btnDiff: btns.length > 1 ? +Math.max(...btns.map((b) => Math.max(Math.abs(b[0] - btns[0][0]), Math.abs(b[1] - btns[0][1])))).toFixed(2) : 0 };
    });
    ok(`${base}|settings 토글 ${states.out.length}개 켜기·끄기에 위·아래 그대로(손잡이 세로 0)`, states.out.length >= 3 && states.out.every((s) => s.move <= 0.5 && s.knob <= 0.5), JSON.stringify(states.out));
    ok(`${base}|settings 나란한 단추(조작법·정보) 위·아래 같음(차이 ${states.btnDiff}px)`, states.btns === 2 && states.btnDiff <= 0.5, JSON.stringify(states));
    // 묶음 제목 없음(설정 시트) · "버튼 진동" 바로 아래 "방향 진동" — 그 줄을 가운데로 굴려 줄·잉크 세로 가운데를 다시 잰다
    const words = await (await fetch(new URL(`/i18n/${lang}.json`, URL_BASE))).json();
    const vib = await page.evaluate(([button, dir]) => {
      const rows = [...document.querySelectorAll("#sheetBody .field")];
      const at = rows.findIndex((n) => n.querySelector(".switch")?.getAttribute("aria-label") === dir);
      rows[at]?.scrollIntoView({ block: "center" });
      return { titles: document.querySelectorAll("#sheetBody .group__title").length, next: at > 0 && rows[at - 1].querySelector(".switch")?.getAttribute("aria-label") === button };
    }, [words["web.vibrate"], words["web.vibrateDir"]]);
    ok(`${base}|settings 묶음 제목 0 · "${words["web.vibrate"]}" 바로 아래 "${words["web.vibrateDir"]}"`, vib.titles === 0 && vib.next, JSON.stringify(vib));
    await page.waitForTimeout(150);
    await measure(page, `${base}|settings·진동`, [".field"]);
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
  ok(`너비 ${width}: 햄버거 메뉴 4개 겹침 0·화면 밖 0`, files.length === 4 && !overlap(files) && files.every((x) => x.l >= 0 && x.r <= width));
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
  // 가로는 게임 화면을 먼저 키우고 양옆 칸 위 한 줄 — 좁으면 메뉴 + 퀵슬롯 + 설정·전체 화면(나머지는 메뉴 안), 넓으면 8개
  const want = info.layout === "landscape" ? (info.tools >= 4 && info.tools <= 8 ? info.tools : 4) : 6;
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
// 크기 = A·B, 겹침 0·화면 안, 세로는 게임 화면 그대로(가로 폭 가득, 버튼은 남은 칸에 들어가는 배율), 터치 C·D → bit 10·11,
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
    // 세로: 게임 화면은 늘 가로 폭 가득(정의 없을 때와 같은 크기), 버튼은 남은 칸에 들어가는 가장 큰 배율(기기 픽셀 정수 칸, 상한 4)
    const dpr = view.dpr;
    ok(`${key}: 세로 게임 화면 그대로(줄이지 않음), 버튼 배율 ${art}(기기 픽셀 정수)`, screen === before.screen && Number.isInteger(Math.round(art * dpr * 1000) / 1000) && art <= before.art && art <= 4, `배율 ${before.art}→${art} · 게임 화면 ${before.screen} → ${screen}`);
    console.log(`측정 ${key}: 세로 게임 화면 ${before.screen} → ${screen} · 배율 ${before.art}→${art}`);
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
  ok(`${key}: 버튼 일부 — 정의한 자리만 보임·겹침 0·키는 정의한 버튼만`, fewShown && !fewHit.hits.length && !fewHit.outside.length && few.art >= before.art && fewKeys.join() === [1, 0, 0, 0, 0, 8, 64].join(),
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
      const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      paint(c.getContext("2d"));
      const blob = c.convertToBlob ? await c.convertToBlob({ type: "image/png" }) : await new Promise((done) => c.toBlob(done, "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
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

    // 라이브러리(햄버거 메뉴 안에 있으면 메뉴를 먼저)
    if (await page.evaluate(() => Boolean(document.querySelector("#btnLibrary").closest(".bar__group--files")) && getComputedStyle(document.querySelector("#btnMenu")).display !== "none")) {
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

    // 꺼내기·넣기·바꾸기(움직임 줄이기 = 바로): 위 꺼낸 칸·아래 책장 상자가 1px 도 안 움직임
    const keys = await page.$$eval(".lib__case .spine[data-key]", (nodes) => nodes.map((node) => node.dataset.key));
    const first = await page.getAttribute(".lib__card", "data-key");
    const frame = () => page.evaluate(() => [".lib__card", ".lib__shelf", ".lib__scroll"].map((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }).flat());
    const moved = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const base = await frame();
    let drift = 0;
    await page.$eval(`.spine[data-key="${keys[2]}"]`, (n) => n.click());
    await page.waitForTimeout(200);
    drift = Math.max(drift, moved(base, await frame()));
    const pulled = await page.evaluate((k) => {
      const art = document.querySelector(`.spine[data-key="${k}"] .spine__art`);
      return { card: document.querySelector(".lib__card").dataset.key, out: [...document.querySelectorAll(".spine.is-out")].map((n) => n.dataset.key), pressed: document.querySelector(`.spine[data-key="${k}"]`).getAttribute("aria-pressed"), op: +getComputedStyle(art).opacity, hidden: [...art.querySelectorAll("*")].filter((n) => getComputedStyle(n).visibility === "hidden").length, others: [...document.querySelectorAll(".spine:not(.is-out) .spine__art")].every((n) => getComputedStyle(n).opacity === "1") };
    }, keys[2]);
    ok(`${key}|library 옆면 누르면 꺼냄(이전 것은 제자리) · 꺼낸 자리는 같은 옆면 반투명 ${pulled.op}`, first === keys[0] && pulled.card === keys[2] && pulled.out.join() === keys[2] && pulled.pressed === "true" && pulled.op === 0.35 && pulled.hidden === 0 && pulled.others, JSON.stringify({ first, pulled }));
    await measure(page, `${key}|library-pulled`, [".lib__card .pack__label", ".lib__name", ".lib__meta"]);
    if (lang === "ko" && view.name === "320x568") await page.screenshot({ path: path.join(SHOTS, "라이브러리_꺼낸자리_반투명_320x568.png") });
    await page.$eval(`.spine[data-key="${keys[2]}"]`, (n) => n.click());
    await page.waitForTimeout(200);
    drift = Math.max(drift, moved(base, await frame()));
    const back = await page.evaluate(() => ({ state: document.querySelector(".lib__card").dataset.state, out: document.querySelectorAll(".spine.is-out").length }));
    ok(`${key}|library 반투명 자리 누르면 넣음 → 안내`, back.state === "empty" && back.out === 0, JSON.stringify(back));
    await measure(page, `${key}|library-empty`, [".lib__hint"]);
    const instant = [];
    for (const k of [keys[5], keys[1], keys[7]]) {
      instant.push(
        await page.evaluate((k) => {
          document.querySelector(`.spine[data-key="${k}"]`).click();
          const anims = document.getAnimations().filter((a) => a.effect?.target?.closest?.(".lib__card, .lib__fly, .lib__case")).length;
          return { k, card: document.querySelector(".lib__card").dataset.key, outs: [...document.querySelectorAll(".spine.is-out")].map((n) => n.dataset.key).join(), fly: document.querySelector(".lib__fly").childElementCount, anims };
        }, k),
      );
      await page.waitForTimeout(150);
      drift = Math.max(drift, moved(base, await frame()));
    }
    ok(`${key}|library 움직임 줄이기 = 바로(누른 즉시 새 칸·꺼낸 자리 하나 · 날기 그림·움직임 0)`, instant.every((x) => x.card === x.k && x.outs === x.k && x.fly === 0 && x.anims === 0), JSON.stringify(instant));
    ok(`${key}|library 꺼내기·넣기·바꾸기 전후 꺼낸 칸·책장 위치 그대로(최대 ${+drift.toFixed(3)}px)`, drift < 1);

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
    ok(`${key}|running 실행 중 칸: 계속하기·세이브·다시 시작·게임 종료(btn--warn)·이름·지우기(btn--danger) · 칸 안 · 겹침 0 · 버튼 글 안 잘림`, runButtons.join() === "resume,saves,reset,close-game,rename,delete" && Boolean(await page.$('.lib__btns .btn--warn[data-action="close-game"]')) && Boolean(await page.$('.lib__btns .btn--danger[data-action="delete"]')) && within(run.cardParts, landscape ? { ...run.cardView, b: Infinity } : run.cardView) && !crosses(run.cardParts) && run.cardScroll <= 0 && run.btnOver.length === 0 && Boolean(await page.$(".lib__card .pack__chip")) && Boolean(await page.$('.spine[data-key="rom:art"] .spine__run')), `${runButtons.join()} · 잘림 ${run.btnOver.join("/")}`);
    await measure(page, `${key}|running`, [".lib__btns .btn", ".pack__chip"]);
    if (LIB_SHOTS[`${key}|running`]) await page.screenshot({ path: path.join(SHOTS, LIB_SHOTS[`${key}|running`]) });
    const runBase = await frame();
    let runDrift = 0;
    for (const k of [keys[4], keys[4], "rom:art"]) {
      await page.$eval(`.spine[data-key="${k}"]`, (n) => n.click());
      await page.waitForTimeout(150);
      runDrift = Math.max(runDrift, moved(runBase, await frame()));
    }
    ok(`${key}|running 실행 중(버튼 6개) ↔ 다른 롬팩(버튼 4개)·안내로 바꿔도 위치 그대로(최대 ${+runDrift.toFixed(3)}px)`, runDrift < 1);
    await page.evaluate(() => (window.webgba.state.game = null));
    ok(`${key}|library 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

/// 꺼내기·넣기·바꾸기 움직임(움직임 줄이기 끔): transform·opacity 만, 책장·꺼낸 칸 상자는 프레임마다 그대로, 앞면은 한 번에 하나만 보임
async function libraryMotion(engine, launcher, view, { shots = false } = {}) {
  const key = `${engine} ${view.name}`;
  const context = await launcher.newContext({ viewport: { width: view.width, height: view.height }, hasTouch: true, deviceScaleFactor: 2, ...(engine === "chromium" ? { isMobile: true } : {}) });
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
  const keys = await page.$$eval(".lib__case .spine[data-key]", (nodes) => nodes.map((node) => node.dataset.key));
  const record = (act, ms, pause = -1, watch = []) =>
    page.evaluate(
      ({ act, ms, pause, watch }) =>
        new Promise((done) => {
          const props = new Set();
          const box = (n) => {
            const r = n.getBoundingClientRect();
            return [r.left, r.top, r.right, r.bottom].map((v) => +v.toFixed(2));
          };
          const op = (n) => +(+getComputedStyle(n).opacity).toFixed(3);
          const card = document.querySelector(".lib__card");
          const shelf = document.querySelector(".lib__shelf");
          const spine = (k) => document.querySelector(`.lib__case .spine[data-key="${k}"] .spine__art`);
          const look = () => {
            for (const anim of document.getAnimations()) for (const frame of anim.effect?.getKeyframes?.() ?? []) for (const name of Object.keys(frame)) if (!["offset", "easing", "composite", "computedOffset"].includes(name)) props.add(name);
            const fronts = [...card.querySelectorAll(".lib__pack")].map((n) => ({ b: box(n.querySelector(".pack")), o: op(n) })).concat([...document.querySelectorAll(".lib__fly > .pack")].map((n) => ({ b: box(n), o: op(n), g: 1 })));
            const ghostSpines = [...document.querySelectorAll(".lib__fly > .spine__art")].map((n) => ({ b: box(n), o: op(n) }));
            const text = card.querySelector(".lib__text");
            return { card: box(card), shelf: box(shelf), fronts, ghostSpines, key: card.dataset.key, state: card.dataset.state, textOp: text ? op(text) : -1, grids: card.querySelectorAll(".lib__grid").length, outs: [...document.querySelectorAll(".spine.is-out")].map((n) => n.dataset.key), arts: Object.fromEntries([...act.map(([k]) => k), ...watch].map((k) => [k, op(spine(k))])) };
          };
          const presses = [];
          const press = (k) => {
            presses.push({ k, at: performance.now() - start });
            document.querySelector(`.lib__case .spine[data-key="${k}"]`).click();
          };
          const start = performance.now();
          const frames = [{ t: 0, at: 0, ...look() }];
          for (const [k, at] of act) {
            if (at) setTimeout(() => press(k), at);
            else press(k);
          }
          frames.push({ t: 0, at: performance.now() - start, ...look() });
          const step = (now) => {
            const t = now - start;
            if (pause >= 0 && t >= pause) {
              for (const anim of document.getAnimations()) anim.pause();
              done({ frames, props: [...props], presses, paused: true });
              return;
            }
            frames.push({ t: +t.toFixed(1), at: performance.now() - start, ...look() });
            if (t < ms) requestAnimationFrame(step);
            else done({ frames, props: [...props], presses });
          };
          requestAnimationFrame(step);
        }),
      { act, ms, pause, watch },
    );
  const flyMs = await page.evaluate(() => Math.round((parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pop-ms")) || 200) * 1.1));
  const drift = (frames) => Math.max(0, ...frames.flatMap((f) => [...f.card.map((v, i) => Math.abs(v - frames[0].card[i])), ...f.shelf.map((v, i) => Math.abs(v - frames[0].shelf[i]))]));
  const hit = (a, b) => a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.6);
  const clash = (frames) =>
    frames.filter((f) => {
      const seen = [];
      for (const front of f.fronts.filter((x) => x.o > 0.02)) if (!seen.some((b) => same(b, front.b))) seen.push(front.b);
      return seen.some((a, i) => seen.some((b, j) => j > i && hit(a, b)));
    }).length;
  const settledAt = (frames) => frames.find((f, i) => i > 1 && f.fronts.every((x) => !x.g) && !f.ghostSpines.length && frames.slice(i).every((g) => g.key === f.key))?.t ?? -1;
  const last = (frames) => frames[frames.length - 1];
  const props = new Set();
  const lines = [];
  const note = (name, out) => {
    out.props.forEach((p) => props.add(p));
    lines.push(`${name}: ${out.frames.map((f) => `${f.t}ms 칸 ${f.key || "-"}/${f.state} 글 ${f.textOp} · 앞면 ${f.fronts.map((x) => `${x.g ? "날기" : "칸"} ${x.o}@${x.b[0]},${x.b[1]} ${+(x.b[2] - x.b[0]).toFixed(1)}w`).join(" + ") || "-"} · 옆면날기 ${f.ghostSpines.map((x) => x.o).join("/") || "-"} · 책장 ${f.shelf[1]}`).join(" | ")}`);
  };

  const one = (k, at = 0) => [k, at];
  // 꺼내기: keys[0] 이 처음 꺼낸 것 → 먼저 넣고, keys[3] 을 꺼냄
  const putFirst = await record([one(keys[0])], 700);
  note("put-first", putFirst);
  const pull = await record([one(keys[3])], 600);
  note("pull", pull);
  const pf = last(pull.frames);
  const firstGhost = pull.frames.find((f) => f.fronts.some((x) => x.g));
  const endBox = pf.fronts.find((x) => !x.g)?.b ?? [0, 0, 0, 0];
  const ghostMid = pull.frames.filter((f) => f.fronts.some((x) => x.g && x.o > 0.02 && !same(x.b, endBox))).length;
  const crossMid = pull.frames.filter((f) => f.ghostSpines.some((x) => x.o > 0.02) && f.fronts.some((x) => x.g && x.o > 0.02)).length;
  const realFront = pf.fronts.find((x) => !x.g);
  const firstW = firstGhost ? firstGhost.fronts.find((x) => x.g).b : null;
  ok(
    `${key} 꺼내기: 책장 칸 → 꺼낸 칸으로 날며 옆면 → 앞면(중간 ${ghostMid}프레임, 옆면·앞면 함께 ${crossMid}프레임) · 끝 ${settledAt(pull.frames)}ms(${flyMs}ms) · 꺼낸 자리 반투명 ${pf.arts[keys[3]]}`,
    ghostMid >= 2 && crossMid >= 1 && firstW && firstW[2] - firstW[0] < (realFront.b[2] - realFront.b[0]) / 2 && pf.key === keys[3] && realFront.o === 1 && pf.arts[keys[3]] === 0.35 && pf.outs.join() === keys[3] && settledAt(pull.frames) >= flyMs * 0.8 && settledAt(pull.frames) <= flyMs + 150,
    JSON.stringify({ firstW, last: pf.fronts }),
  );
  if (shots) await page.screenshot({ path: path.join(SHOTS, `라이브러리_꺼낸상태_반투명_${view.name}.png`) });
  if (engine === "chromium") await measure(page, `${view.name}|ko|library-flown`, [".lib__card .pack__label", ".lib__name", ".lib__meta", ".lib__btns .btn"]);

  // 넣기만: 꺼낸 자리를 다시 누름 → 앞면이 옆면으로 돌아가고 칸은 안내
  const put = await record([one(keys[3])], 700);
  note("put", put);
  const pt = last(put.frames);
  const backMid = put.frames.filter((f) => f.fronts.some((x) => x.g && x.o > 0.02)).length;
  ok(`${key} 넣기: 앞면이 책장 칸으로 날며 옆면으로(중간 ${backMid}프레임) · 끝 옆면 불투명도 ${pt.arts[keys[3]]} · 칸은 안내`, backMid >= 2 && pt.arts[keys[3]] === 1 && pt.outs.length === 0 && pt.state === "empty" && pt.ghostSpines.length === 0 && pt.fronts.length === 0, JSON.stringify({ state: pt.state, outs: pt.outs }));

  // 바꾸기: keys[3] 꺼낸 뒤 keys[6] 을 누름 → 옛 앞면은 넣는 움직임 없이 바로 사라지고(책장 자리도 바로 원래 옆면) 새 롬팩 꺼내기만
  await record([one(keys[3])], 500);
  const swap = await record([one(keys[6])], 900, -1, [keys[3]]);
  note("swap", swap);
  const sw = last(swap.frames);
  const pressed = swap.frames[1];
  const oldAfter = swap.frames.slice(1).filter((f) => f.key === keys[3] || f.outs.includes(keys[3]) || f.arts[keys[3]] !== 1).length;
  const flights = (f) => f.fronts.filter((x) => x.g).length <= 1 && f.ghostSpines.length <= 1;
  ok(
    `${key} 바꾸기: 옛 앞면 바로 사라짐(누른 뒤 옛 칸·옛 꺼낸 자리 ${oldAfter}프레임, 옛 옆면 불투명도 ${pressed.arts[keys[3]]}) · 새 칸 바로 · 꺼내기만(끝 ${settledAt(swap.frames)}ms, ${flyMs}ms) · 꺼낸 자리 하나`,
    oldAfter === 0 && pressed.key === keys[6] && sw.key === keys[6] && sw.outs.join() === keys[6] && sw.arts[keys[6]] === 0.35 && swap.frames.every((f) => f.grids <= 1 && flights(f)) && settledAt(swap.frames) >= flyMs * 0.8 && settledAt(swap.frames) <= flyMs + 150,
    JSON.stringify({ pressed: { key: pressed.key, outs: pressed.outs, arts: pressed.arts } }),
  );

  // 빠르게 연달아 누르기: 날고 있는 중에 다른 칸 → 그 자리에서 정리하고 새로
  const rapid = await record([one(keys[8]), one(keys[9], 80)], 900);
  note("rapid", rapid);
  const rp = last(rapid.frames);
  ok(`${key} 빠르게 두 칸: 마지막에 누른 칸만 꺼냄 · 날기 그림 남지 않음`, rp.key === keys[9] && rp.outs.join() === keys[9] && rp.fronts.length === 1 && rp.ghostSpines.length === 0, JSON.stringify({ key: rp.key, outs: rp.outs }));

  // 빠르게 열 번(간격 30~80ms): 누를 때마다 바로 새 칸·날기 그림은 늘 한 벌, 마지막 것만 남고 꺼내기 한 번 시간에 끝
  const tenKeys = [10, 13, 11, 16, 12, 18, 14, 19, 15, 17].map((i) => keys[i]);
  const tenAt = [0, 45, 115, 145, 225, 280, 315, 380, 430, 505];
  const ten = await record(tenKeys.map((k, i) => one(k, tenAt[i])), 1300);
  note("rapid-10", ten);
  const tp = last(ten.frames);
  const lastKey = tenKeys[tenKeys.length - 1];
  const tenEnd = settledAt(ten.frames) - ten.presses[ten.presses.length - 1].at;
  const behind = ten.frames.slice(1).filter((f) => {
    const done = ten.presses.filter((p) => p.at < f.at);
    return done.length && f.key !== done[done.length - 1].k;
  }).length;
  ok(
    `${key} 빠르게 열 번: 마지막 칸만 꺼냄 · 날기 그림 남지 않음·늘 한 벌 · 누른 칸 늦게 따라감 ${behind}프레임 · 마지막 누름 뒤 끝 ${tenEnd.toFixed(0)}ms(${flyMs}ms)`,
    tp.key === lastKey && tp.outs.join() === lastKey && tp.fronts.length === 1 && tp.ghostSpines.length === 0 && ten.frames.every((f) => f.grids <= 1 && flights(f)) && behind === 0 && tenEnd >= 0 && tenEnd <= flyMs + 150,
    JSON.stringify({ key: tp.key, outs: tp.outs, end: tenEnd }),
  );

  const all = [putFirst, pull, put, swap, rapid, ten].flatMap((out) => out.frames);
  ok(`${key} 움직이는 동안 책장·꺼낸 칸 상자 그대로(최대 ${drift(all)}px, ${all.length}프레임)`, drift(all) < 1);
  ok(`${key} 움직이는 동안 앞면 겹침 0(${clash(all)}프레임) · 칸 내용 한 벌`, clash(all) === 0 && all.every((f) => f.grids <= 1));
  ok(`${key} transform·opacity 만`, props.size > 0 && [...props].every((p) => p === "transform" || p === "opacity"), [...props].join(","));

  if (shots) {
    await record([one(keys[9])], 600);
    const paused = await record([one(keys[12])], 1000, flyMs * 0.5);
    await page.screenshot({ path: path.join(SHOTS, `라이브러리_꺼내기_중간프레임_${view.name}.png`) });
    ok(`${key} 중간 프레임 캡처(멈춘 때 ${last(paused.frames).t}ms)`, paused.paused === true);
    await page.evaluate(() => document.getAnimations().forEach((anim) => anim.play()));
  }
  ok(`${key} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
  fs.writeFileSync(path.join(SHOTS, `라이브러리_움직임_프레임_${engine}_${view.name}.txt`), lines.join("\n"));
  await context.close();
}

// UI_NET_WGBA=<멀티플레이 예제 .wgba> 이면 멀티플레이 연결 창(근처 방 첫 화면·방 코드·코드로 들어가기·인터넷 없이 연결의 방장 코드·QR·참가 코드 넣기)을
// 세 화면 크기 × 세 언어로 잰다(UI_NET_ONLY=1 이면 그것만). 방 코드 화면은 <주소> 가 tools/test/mp-local.mjs 처럼 /api/v1/mp 를 내줄 때만.
// 같은 줄 맞춤: 상단 기능 버튼(멀티플레이 켜짐·배지 표시 포함)과 연결 창 버튼 줄의 위·아래 위치 차이 0.
async function lineUp(page, key, scope, selector) {
  const info = await page.evaluate(([scope, selector]) => {
    const out = [];
    for (const row of document.querySelectorAll(scope)) {
      const items = [...row.querySelectorAll(selector)].filter((n) => n.offsetParent !== null && getComputedStyle(n).visibility !== "hidden").map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.id || n.dataset.action || n.className, top: r.top, bottom: r.bottom };
      });
      if (items.length > 1) out.push(items);
    }
    return out;
  }, [scope, selector]);
  // 좁은 화면에서 다음 줄로 넘어간 요소(flex-wrap)는 그 줄끼리 비교한다
  for (const all of info) {
    const lines = [];
    for (const item of [...all].sort((a, b) => a.top - b.top)) {
      const mid = (item.top + item.bottom) / 2;
      const line = lines.find((l) => mid > l[0].top && mid < l[0].bottom);
      if (line) line.push(item);
      else lines.push([item]);
    }
    for (const items of lines) {
      if (items.length < 2) continue;
      const tops = items.map((i) => i.top);
      const bottoms = items.map((i) => i.bottom);
      const dt = +(Math.max(...tops) - Math.min(...tops)).toFixed(2);
      const db = +(Math.max(...bottoms) - Math.min(...bottoms)).toFixed(2);
      ok(`${key} 같은 줄 위·아래 차이 0(${items.map((i) => i.id).join(",")})`, dt === 0 && db === 0, `위 ${dt} · 아래 ${db}`);
    }
  }
  return info;
}

// 기능 버튼 줄 나누기: 세로 범위가 겹치는 버튼끼리 한 줄(가로 화면은 좌·우 칸 위에 2개씩 두 줄일 수 있음).
function barRows(list) {
  const rows = [];
  for (const item of [...list].sort((a, b) => a.top - b.top)) {
    const row = rows.find((r) => item.top < r[0].bottom && r[0].top < item.bottom);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows;
}

async function barLineUp(page, key) {
  const read = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null && getComputedStyle(n).visibility !== "hidden" && !n.closest(".bar__group--files")).map((n) => {
        const r = n.getBoundingClientRect();
        const c = n.querySelector("canvas")?.getBoundingClientRect() ?? r;
        return { id: n.id, top: r.top, bottom: r.bottom, ctop: c.top, cbottom: c.bottom, h: r.height };
      }),
    );
  const spread = (list, a) => Math.max(...barRows(list).map((row) => +(Math.max(...row.map((i) => i[a])) - Math.min(...row.map((i) => i[a]))).toFixed(2)));
  const before = await read();
  const net = before.find((i) => i.id === "btnNet");
  ok(`${key} 상단 버튼 줄 위·아래 차이 0(멀티플레이 켜짐)`, net && spread(before, "top") === 0 && spread(before, "bottom") === 0 && spread(before, "ctop") === 0 && spread(before, "cbottom") === 0, `${before.map((i) => i.id).join(",")} 위 ${spread(before, "top")} 아래 ${spread(before, "bottom")} 그림 ${spread(before, "ctop")}/${spread(before, "cbottom")}`);
  await page.evaluate(() => {
    const badge = document.querySelector("#btnNet .tool__badge");
    if (badge) {
      badge.textContent = "2/4";
      badge.hidden = false;
    }
  });
  const after = await read();
  const net2 = after.find((i) => i.id === "btnNet");
  ok(`${key} 배지 표시해도 버튼 상자 그대로·줄 맞춤 유지`, net2 && net && net2.top === net.top && net2.h === net.h && spread(after, "top") === 0 && spread(after, "bottom") === 0, `${net?.top}/${net2?.top} 높이 ${net?.h}/${net2?.h}`);
}

async function netChecks() {
  const bytes = fs.readFileSync(process.env.UI_NET_WGBA).toString("base64");
  const openNet = async (page) => {
    await page.evaluate(() => {
      window.webgba.player.keyDown("KeyZ");
      setTimeout(() => window.webgba.player.keyUp("KeyZ"), 120);
    });
    await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  };
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
      await openNet(page);
      await page.waitForFunction(() => !document.querySelector(".net-near-box")?.textContent.includes("…"), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      const base = `${view.name}|${lang}`;
      await measure(page, `${base}|net-choose`, [".sheet__head", ".seg__btn", ".net-sech", ".net-cell", ".net-coderow > .btn", ".net-nickline", "#sheetFoot .btn"]);
      await page.evaluate(() => {
        const win = window.webgba.net.win;
        win.stopNear();
        win.near = { state: "ok", compat: "same", rooms: [{ room: "123456", nick: "Player 4821", c: "same", p: "party", k: 1, m: 4 }, { room: "654321", nick: "Player 7730", c: "other", p: "party", k: 1, m: 2 }] };
        win.paintNear();
      });
      await page.waitForTimeout(400);
      await measure(page, `${base}|net-near`, [".net-near__row"]);
      await rows(page, `${base}|net-near`, ".net-near__row");
      await lineUp(page, `${base}|net-near`, ".net-near__row", ":scope > button");
      await fits(page, `${base}|net-choose`, ".sheet__panel");
      await lineUp(page, `${base}|net-choose`, "#sheetFoot .net-actions", ":scope > button, :scope > .net-nickline > button");
      if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `멀티_${view.name}_첫화면.png`) });
      await page.click('[data-action="net-tab-make"]');
      await page.waitForTimeout(300);
      await measure(page, `${base}|net-make`, [".net-info__row", "#sheetBody .btn"]);
      await page.click('[data-action="net-room-make"]');
      const room = await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector(".net-room-code")?.textContent ?? "") || Boolean(document.querySelector('[data-action="net-offer"]')?.value), null, { timeout: 10000 }).then(() => page.evaluate(() => document.querySelector(".net-room-code")?.textContent ?? ""));
      await page.waitForTimeout(400);
      if (room) {
        await measure(page, `${base}|net-room`, [".sheet__head", ".net-room", ".net-seats .mpb__l1", ".net-seats .mpb__seat", "#sheetFoot .btn"]);
        await rows(page, `${base}|net-room`, ".net-seats .mpb__row");
        await fits(page, `${base}|net-room`, ".sheet__panel");
        await lineUp(page, `${base}|net-room`, "#sheetFoot .net-actions", ":scope > button");
        await lineUp(page, `${base}|net-room`, "#sheetBody .net-btnrow", ":scope > button");
        if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `멀티_${view.name}_방코드.png`) });
      } else ok(`${base}|net-room 서버 없음 → 연결 코드 화면으로 자동 안내`, Boolean(await page.$('[data-action="net-offer"]')));
      await barLineUp(page, `${base}|bar`);
      await page.click('[data-action="net-cancel"]');
      await page.waitForTimeout(400);
      await openNet(page);
      await page.click('[data-action="net-room-join"]');
      await page.waitForTimeout(300);
      await measure(page, `${base}|net-code`, [".sheet__head", ".net-cell", ".net-coderow > .btn", ".net-nickline", "#sheetFoot .btn"]);
      await fits(page, `${base}|net-code`, ".sheet__panel");
      await lineUp(page, `${base}|net-code`, ".net-coderow", ":scope > button, .net-cell");
      await page.click('[data-action="net-offline"]');
      await page.waitForTimeout(300);
      await measure(page, `${base}|net-lan`, [".sheet__head", ".net-line", "#sheetFoot .btn"]);
      await fits(page, `${base}|net-lan`, ".sheet__panel");
      await page.click('[data-action="net-make"]');
      await page.waitForFunction(() => document.querySelector('[data-action="net-offer"]')?.value, null, { timeout: 10000 });
      await page.waitForTimeout(500);
      await measure(page, `${base}|net-host`, [".sheet__head", ".net-seats .mpb__l1", ".net-line", "#sheetFoot .btn"]);
      await rows(page, `${base}|net-host`, ".net-seats .mpb__row");
      await lineUp(page, `${base}|net-host`, "#sheetBody .net-line, #sheetFoot .net-actions", ":scope > button");
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
        const deep = [...body.querySelectorAll(".net-invite > *, .net-line > *, .mpb__row")].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
        let overlap = 0;
        for (let i = 1; i < kids.length; i++) if (kids[i].top < kids[i - 1].bottom - 0.5) overlap++;
        return { overlap, wide: deep.filter((r) => r.right > b.right + 0.5 || r.left < b.left - 0.5).length, hScroll: body.scrollWidth > body.clientWidth + 1, top: Math.round((kids[0].top + body.scrollTop - head.bottom) * 10) / 10 };
      });
      ok(`${base}|net-qr 겹침·가로 넘침 없음, 제목 위 여백 16`, lay.overlap === 0 && lay.wide === 0 && !lay.hScroll && lay.top === 16, JSON.stringify(lay));
      await page.click('[data-action="net-cancel"]');
      await page.waitForTimeout(400);
      await openNet(page);
      await page.click('[data-action="net-offline"]');
      await page.click('[data-action="net-join"]');
      await page.waitForTimeout(400);
      await measure(page, `${base}|net-join`, [".sheet__head", ".net-line", "#sheetFoot .btn"]);
      await fits(page, `${base}|net-join`, ".sheet__panel");
      await lineUp(page, `${base}|net-join`, "#sheetBody .net-line, #sheetFoot .net-actions", ":scope > button");
      const overlapAll = await page.evaluate(() => {
        const kids = [...document.getElementById("sheetBody").children].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
        let overlap = 0;
        for (let i = 1; i < kids.length; i++) if (kids[i].top < kids[i - 1].bottom - 0.5) overlap++;
        return overlap;
      });
      ok(`${base}|net-join 겹침 없음`, overlapAll === 0, String(overlapAll));
      ok(`${base}|net 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
}

// 멀티플레이 상태 메뉴: 예제 게임을 열고 가짜 세션(사람 4·AI 4, 잠시 멈춤·지연 3단계·탈락·이번 상대)과 게임 값 없는 세션(연결 중 1명)을
// 세 화면 크기 × 세 언어로 잰다 — 잉크 세로 가운데, 줄 높이·간격, 줄 위·아래 여백, 같은 줄 버튼 위·아래 차이 0, 겹침, 화면 안, 게임 화면 가리지 않음.
const BOARD_FIXTURE = {
  columns: [
    { id: "hp", type: "bar", name: { ko: "체력", en: "HP", ja: "HP" }, max: 100, tone: "hp" },
    { id: "lv", type: "number", name: { ko: "레벨", en: "Level", ja: "レベル" }, prefix: "Lv" },
    { id: "rank", type: "rank", name: { ko: "순위", en: "Rank", ja: "順位" } },
    { id: "state", type: "status", name: { ko: "상태", en: "State", ja: "状態" }, labels: [{ name: { ko: "탈락", en: "Out", ja: "脱落" }, tone: "dim", dimRow: true }, { name: { ko: "준비 완료", en: "Ready", ja: "準備OK" }, tone: "good" }, { name: { ko: "AI가 대신", en: "AI", ja: "AI代行" }, tone: "dim" }] },
  ],
  names: [{ ko: "웅", en: "Brock" }, { ko: "이슬", en: "Misty" }, { ko: "마티스", en: "Surge" }, { ko: "민화", en: "Erika" }],
  captions: [{ ko: "{0}-{1} 라운드", en: "Round {0}-{1}", ja: "ラウンド {0}-{1}" }],
  mark: { ko: "이번 상대", en: "Next foe", ja: "次の相手" },
};
const BOARD_ROWS = [
  { slot: 0, values: [81, 7, 1, 0] },
  { slot: 1, values: [74, 6, 2, 0] },
  { slot: null, nameLabel: 2, values: [66, 6, 3, 0] },
  { slot: 2, values: [58, 5, 4, 0] },
  { slot: null, nameLabel: 3, values: [52, 5, 5, 0], mark: true },
  { slot: null, nameLabel: 4, values: [40, 5, 6, 0] },
  { slot: 3, values: [23, 4, 7, 0] },
  { slot: null, nameLabel: 1, values: [0, 4, 8, 1], dim: true },
];

async function boardSession(page, { plain, rejoin = false }) {
  await page.evaluate(
    async ({ plain, rejoin, fixture, rows }) => {
      const { boardConfig, scriptBoard } = await import("/js/core/net/board.js");
      const net = window.webgba.player.net;
      const members = plain
        ? [{ slot: 0, nick: "플레이어 7730", rtt: null }, { slot: 1, nick: "플라이", rtt: 9 }, { slot: 2, nick: "플레이어 5102", rtt: null }]
        : [{ slot: 0, nick: "플레이어 7730", rtt: null }, { slot: 1, nick: "플라이", rtt: 12, rejoining: rejoin }, { slot: 2, nick: "플레이어 4821", rtt: 38, stalled: true }, { slot: 3, nick: "달빛토끼", rtt: rejoin ? 160 : null, held: !rejoin }];
      net.session = { closed: false, open: true, opened: true, role: "join", host: false, slot: 1, rejoining: rejoin, rejoinable: true, helper: { state: "offline" }, max: plain ? 4 : 8, get count() { return members.length; }, gone: new Map(), rows: new Map(), memberList: () => members.map((m) => ({ ...m, me: m.slot === 1, host: m.slot === 0, stalled: Boolean(m.stalled), held: Boolean(m.held), rejoining: Boolean(m.rejoining), away: false })), setAway() {}, close() {}, setRow() {} };
      net.request = { serial: 9, purpose: net.config.purposes[0], min: 2, max: plain ? 4 : 8, role: "any" };
      net.boardCfg = plain ? null : boardConfig({ multiplayer: { board: fixture } });
      net.boardPtr = 0;
      net.board = plain ? null : scriptBoard({ caption: 1, args: [4, 2], rows });
      window.webgba.net.win.joinedRoom = "482153";
      net.changed();
    },
    { plain, rejoin, fixture: BOARD_FIXTURE, rows: BOARD_ROWS },
  );
}

async function boardChecks() {
  const bytes = fs.readFileSync(process.env.UI_NET_WGBA).toString("base64");
  const views = [{ name: "390x844", viewport: { width: 390, height: 844 } }, { name: "844x390", viewport: { width: 844, height: 390 } }, { name: "320x568", viewport: { width: 320, height: 568 } }].filter((v) => !VIEW_FILTER || VIEW_FILTER.has(v.name));
  const shots = { "390x844|ko|game": "웹_세로_390x844_상태메뉴.png", "844x390|ko|game": "웹_가로_844x390_상태메뉴.png", "320x568|ko|plain": "웹_세로_320x568_게임값없음.png", "390x844|ko|rejoin": "웹_세로_390x844_다시연결.png", "844x390|ko|rejoin": "웹_가로_844x390_다시연결.png" };
  for (const view of views) {
    for (const lang of LANGS) {
      for (const mode of ["game", "plain", "rejoin"]) {
        const plain = mode === "plain";
        const rejoin = mode === "rejoin";
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
        const key = `${view.name}|${lang}|${mode}`;
        const toolsBefore = await page.evaluate(() => [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null).length);
        await boardSession(page, { plain, rejoin });
        await page.waitForTimeout(200);
        await page.click("#btnNet");
        await page.waitForFunction(() => window.webgba.net.board.state.open, null, { timeout: 5000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const info = await page.evaluate(() => {
          const root = window.webgba.net.board.root;
          const panel = root.querySelector(".mpb__panel").getBoundingClientRect();
          const screen = document.getElementById("frame").getBoundingClientRect();
          const rows = [...root.querySelectorAll(".mpb__row:not(.is-empty)")];
          let overlap = 0;
          for (const line of root.querySelectorAll(".mpb__l1, .mpb__head, .mpb__foot")) {
            const kids = [...line.children].filter((n) => !n.hidden && n.getBoundingClientRect().width > 0).map((n) => n.getBoundingClientRect()).sort((a, b) => a.left - b.left);
            for (let i = 1; i < kids.length; i++) if (kids[i].left < kids[i - 1].right - 0.5) overlap++;
          }
          for (const line of root.querySelectorAll(".mpb__l2")) {
            const kids = [...line.children].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
            for (let i = 1; i < kids.length; i++) if (kids[i].left < kids[i - 1].right - 0.5) overlap++;
          }
          const clipped = [...root.querySelectorAll(".mpb__text, .mpb__tagtext")].filter((n) => !n.closest("[hidden]") && n.scrollWidth > n.clientWidth + 1 && !n.matches(".mpb__name, .mpb__title")).map((n) => n.textContent);
          return { landscape: document.body.dataset.layout === "landscape", panel: { top: panel.top, left: panel.left, right: panel.right, width: panel.width }, screenBottom: screen.bottom, screenRight: screen.right, rows: rows.length, empty: root.querySelectorAll(".mpb__row.is-empty").length, overlap, clipped, tools: [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null).length, plain: root.querySelector(".mpb__rows").hasAttribute("data-plain"), fast: getComputedStyle(document.getElementById("btnFast")).display };
        });
        ok(`${key} 상태 메뉴 줄 수(${plain ? "사람 3 + 빈자리 1" : "사람 4 + AI 4, 빈자리 없음"})·게임 값 ${plain ? "없음" : "있음"}`, info.rows === (plain ? 3 : 8) && info.empty === (plain ? 1 : 0) && info.plain === plain, JSON.stringify({ rows: info.rows, empty: info.empty, plain: info.plain }));
        ok(`${key} 상태 메뉴 자리: ${info.landscape ? "게임 화면 우측(겹침 0)" : "게임 화면 아래(게임 화면 가리지 않음)"}`, info.landscape ? info.panel.left >= info.screenRight - 0.5 : info.panel.top >= info.screenBottom - 0.5, `${JSON.stringify(info.panel)} 화면 아래 ${info.screenBottom} · 우측 ${info.screenRight}`);
        ok(`${key} 상단 버튼 수 그대로·빨리 감기 자리에 멀티플레이`, info.tools === toolsBefore && info.fast === "none", `${toolsBefore} → ${info.tools} · 빨리 감기 ${info.fast}`);
        ok(`${key} 상태 메뉴 겹침 없음·잘린 글 없음(이름·제목 제외)`, info.overlap === 0 && info.clipped.length === 0, `겹침 ${info.overlap} · 잘림 ${info.clipped.join(",")}`);
        const held = await page.evaluate(() => ({ chips: [...window.webgba.net.board.root.querySelectorAll(".mpb__tag--warn")].map((n) => n.textContent), bar: !window.webgba.net.board.root.querySelector(".mpb__rejoin")?.hidden }));
        if (!plain) ok(`${key} 상태 메뉴 ${rejoin ? "내 줄 '다시 연결하는 중…' · 다시 연결 줄(글 + 버튼 둘)" : "끊긴 자리 줄 꼬리표('끊김 · 기다리는 중')"} · ${rejoin ? "" : "다시 연결 줄 없음"}`, rejoin ? held.bar && held.chips.length >= 2 : !held.bar && held.chips.length >= 2, JSON.stringify(held));
        await measure(page, `${key}|board`, [".mpb__head", ".mpb__seat", ".mpb__l1", ".mpb__l2", ".mpb__tag", ".mpb__foot", ...(rejoin ? [".mpb__rejoinText", ".mpb__rejoinActions .btn"] : [])]);
        if (rejoin) await lineUp(page, `${key}|board`, ".mpb__rejoinActions", ":scope > button");
        await rows(page, `${key}|board`, ".mpb__row");
        // 항목 위·아래 여백: 줄 칸(1줄·2줄)이 항목 위·아래에서 같은 거리, 모든 항목 같은 짜임. 칸 안 글자·꼬리표·막대는 위 measure 가 잉크 가운데를 잰다
        // (꼬리표 외곽선이 바탕색과 비슷한 줄이 있어 항목 전체 잉크로 항목끼리 비교하지 않음).
        const pads = await page.evaluate(() => [...window.webgba.net.board.root.querySelectorAll(".mpb__row")].map((r) => {
          const box = r.getBoundingClientRect();
          const l1 = r.querySelector(".mpb__l1").getBoundingClientRect();
          const last = (r.querySelector(".mpb__l2") ?? r.querySelector(".mpb__l1")).getBoundingClientRect();
          return [+(l1.top - box.top).toFixed(2), +(box.bottom - last.bottom).toFixed(2)];
        }));
        ok(`${key}|board 항목 위·아래 여백 같음(모든 항목 같은 짜임)`, pads.every((p) => p[0] === p[1]) && new Set(pads.map((p) => p.join())).size === 1, JSON.stringify(pads[0]));
        await lineUp(page, `${key}|board`, ".mpb__head", ":scope > button");
        await fits(page, `${key}|board`, ".mpb__panel");
        await barLineUp(page, `${key}|bar`);
        if (shots[key]) await page.screenshot({ path: path.join(SHOTS, shots[key]) });
        if (plain) {
          // 설정: 멀티플레이 켜기·끄기 + 닉네임 칸(기본 "플레이어 + 숫자 4개")
          await page.evaluate(() => window.webgba.openSheet("settings"));
          await page.waitForTimeout(400);
          const nick = await page.evaluate(() => {
            const input = document.querySelector('[data-action="cfg-net-nick"]');
            input?.closest(".field")?.scrollIntoView({ block: "center" });
            const row = input?.closest(".group");
            if (!input) return null;
            const s = getComputedStyle(input);
            const ctx = document.createElement("canvas").getContext("2d");
            ctx.font = `${s.fontSize} ${s.fontFamily}`;
            const room = input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
            return { placeholder: input.placeholder, max: input.maxLength, switches: row.querySelectorAll(".switch").length, fits: ctx.measureText(input.placeholder).width <= room + 0.5 };
          });
          await page.waitForTimeout(300);
          ok(`${key} 설정: 멀티플레이 켜기·인터넷 연결 칸 + 닉네임 칸(빈칸 = 플레이어 1234, 12자, 안내 글 잘림 없음)`, nick && /1234/.test(nick.placeholder) && nick.max === 12 && nick.switches === 2 && nick.fits, JSON.stringify(nick));
          await page.evaluate(() => {
            const group = document.querySelector('[data-action="cfg-net-nick"]').closest(".group");
            group.dataset.uiNet = "1";
          });
          await measure(page, `${key}|settings-net`, ['[data-ui-net] .field']);
          if (view.name === "390x844" && lang === "ko") await page.screenshot({ path: path.join(SHOTS, "웹_설정_닉네임.png") });
        }
        ok(`${key} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
        await context.close();
      }
    }
  }
}

if (process.env.UI_NET_WGBA && process.env.UI_NET !== "0" && !ONLY_BOARD && !ONLY_ANYTIME && !ONLY_HOSTBACK) await netChecks();
if (process.env.UI_NET_WGBA && (ONLY_ANYTIME || (process.env.UI_NET !== "0" && !ONLY_BOARD && !ONLY_HOSTBACK))) await anytimeChecks();
if (process.env.UI_NET_WGBA && (ONLY_HOSTBACK || (process.env.UI_NET !== "0" && !ONLY_BOARD && !ONLY_ANYTIME))) await hostBackChecks();

// 방장 돌아오기(결정 174 가): 방장의 '이전 방' 칸(주황 버튼)과 유저의 '방장을 기다리는 중' 화면 — 잉크 세로 가운데·화면 안·겹침·가로 넘침,
// 주황 버튼 글자 대비 4.5 이상(테마 12개). 유저 화면은 snapshot 을 바꿔 그린다(실제 흐름은 web-mp --only hostback).
async function hostBackChecks() {
  const bytes = (await repackWgba(process.env.UI_NET_WGBA, (m) => ({ ...m, id: `${m.id}.hostback`, multiplayer: { ...m.multiplayer, rejoin: true } }))).toString("base64");
  const shots = CAPTURE || SHOTS;
  const views = [...VIEWS_ALL.filter((v) => v.name !== "360x640"), { name: "1280x800", viewport: { width: 1280, height: 800 }, dpr: 1 }].filter((v) => !VIEW_FILTER || VIEW_FILTER.has(v.name));
  const layout = (page) =>
    page.evaluate(() => {
      const body = document.getElementById("sheetBody");
      const b = body.getBoundingClientRect();
      const kids = [...body.querySelectorAll(".net-col > *, #sheetBody > *")].filter((n) => n.offsetParent).map((n) => [n.parentElement, n.getBoundingClientRect()]);
      let overlap = 0;
      for (let i = 1; i < kids.length; i++) if (kids[i][0] === kids[i - 1][0] && kids[i][1].top < kids[i - 1][1].bottom - 0.5) overlap++;
      const wide = [...body.querySelectorAll(".btn, .net-info__row, .net-note, .mpb__row")].filter((n) => n.offsetParent).filter((n) => n.getBoundingClientRect().right > b.right + 0.5 || n.scrollWidth > n.clientWidth + 1).length;
      return { overlap, wide, hScroll: body.scrollWidth > body.clientWidth + 1 };
    });
  // 위·아래 여백 같음, 홀수로 남는 기기 1픽셀은 늘 아래(UI 규칙) — 그 밖의 차이를 센다
  const worst = (prefix, dpr) => Math.max(0, ...table.filter((r) => r.key === prefix && !(r.top === r.bottom || +(r.bottom - r.top).toFixed(2) === +(1 / dpr).toFixed(2))).map((r) => r.diff));
  for (const view of views) {
    for (const lang of LANGS) {
      const key = `${view.name}|${lang}|hostback`;
      const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dpr ?? 2, reducedMotion: "reduce" });
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
        await window.webgba.openFiles([new File([data], "net-hostback.wgba")]);
      }, bytes);
      await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
      await page.evaluate(async () => {
        const { signalCompat } = await import("/js/core/net/signal.js");
        const c = await signalCompat(window.webgba.player.net.compat);
        const slots = [{ s: 1, nick: "유저 1", key: "k".repeat(22) }, { s: 2, nick: "유저 2", key: "m".repeat(22) }];
        localStorage.setItem("webgba.netBack", JSON.stringify({ c, p: "party", purpose: "party", min: 2, max: 4, room: "482193", x: "AAAAAAAAAAA", g: "BBBBBBBBBBBBBBBB", i: 0, t: `20261104.${"C".repeat(22)}`, q: 1, code: "D".repeat(40), slots, at: Date.now() }));
        await window.webgba.net.win.offerBack();
      });
      const offered = await page.waitForFunction(() => Boolean(document.querySelector('[data-action="net-back"]')), null, { timeout: 8000 }).then(() => true, () => false);
      await page.waitForTimeout(500);
      ok(`${key} 같은 게임을 열면 창 자동 표시 · 첫 화면 '이전 방' 칸`, offered && (await page.evaluate(() => window.webgba.state.sheet)) === "net");
      await measure(page, `${key}|back`, [".sheet__head", ".net-sec--back .net-sech", ".net-sec--back .net-info__row", ".net-sec--back .btn", ".seg__btn", "#sheetFoot .btn"]);
      await fits(page, `${key}|back`, ".sheet__panel");
      await lineUp(page, `${key}|back`, "#sheetFoot .net-actions", ":scope > button, :scope > .net-nickline > button");
      const lay = await layout(page);
      ok(`${key}|back 겹침·가로 넘침 없음 · 잉크 세로 가운데 차이 ${worst(`${key}|back`, view.dpr ?? 2)}px(홀수 1픽셀 아래 제외)`, lay.overlap === 0 && lay.wide === 0 && !lay.hScroll && worst(`${key}|back`, view.dpr ?? 2) === 0, JSON.stringify(lay));
      const btn = await page.evaluate(() => {
        const b = document.querySelector('[data-action="net-back"]');
        return { warn: b.classList.contains("btn--warn"), color: getComputedStyle(b).color, ink: getComputedStyle(document.documentElement).getPropertyValue("--px-warn-ink").trim() };
      });
      ok(`${key}|back '이전 방으로 돌아가기' = 주황 버튼(btn--warn, 글자 = --px-warn-ink)`, btn.warn && hexOfColor(btn.color) === hexOfColor(btn.ink), JSON.stringify(btn));
      if (lang === "ko" && view.name === "390x844") {
        await page.screenshot({ path: path.join(shots, "방장_이전방_돌아가기_390x844.png") });
        const ratios = await page.evaluate(async () => {
          const T = await import("/js/shell/theme.js");
          const out = [];
          for (const mode of T.MODES.filter((m) => m.id !== "custom")) {
            window.webgba.applyTheme(mode.id);
            await new Promise((r) => setTimeout(r, 120));
            const s = getComputedStyle(document.documentElement);
            out.push({ id: mode.id, face: s.getPropertyValue("--px-warn").trim(), ink: s.getPropertyValue("--px-warn-ink").trim() });
          }
          window.webgba.applyTheme("dark");
          return out;
        });
        const low = ratios.map((r) => ({ ...r, ratio: +contrastOf(r.face, r.ink).toFixed(2) })).filter((r) => !(r.ratio >= 4.5));
        ok(`주황 버튼 글자 대비 4.5 이상: 테마 ${ratios.length}개`, ratios.length === 12 && low.length === 0, JSON.stringify(low.length ? low : ratios.map((r) => `${r.id}:${contrastOf(r.face, r.ink).toFixed(1)}`)));
        await page.waitForTimeout(300);
      }

      await page.evaluate(() => {
        const net = window.webgba.player.net;
        const real = net.snapshot.bind(net);
        const until = Date.now() + 95000;
        const m = (slot, nick, extra) => ({ slot, nick, me: false, host: slot === 0, stalled: false, away: false, held: false, rejoining: false, rtt: null, turn: false, ...extra });
        net.snapshot = () => ({ ...real(), active: true, connected: false, rejoining: true, rejoinable: true, rejoinState: "wait", hostWait: true, hostLeft: Math.max(0, until - Date.now()), role: "join", slot: 1, count: 3, max: 4, members: [m(0, "방장 4821", { held: true }), m(1, "유저 1234", { me: true, rejoining: true }), m(2, "유저 7730", { stalled: true })] });
        window.webgba.net.win.clearBack();
        window.webgba.net.open({ serial: 1, purpose: net.config.purposes[0], min: 2, max: 4, role: "any" });
      });
      await page.waitForFunction(() => /\d:\d\d/.test(document.querySelector("#sheetBody .net-rejoin-state")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      const wait = await page.evaluate(() => ({ state: document.querySelector("#sheetBody .net-rejoin-state")?.textContent ?? "", btns: [...document.querySelectorAll("#sheetBody .btn")].map((b) => b.dataset.action) }));
      ok(`${key}|wait '방장을 기다리는 중 · 남은 시간' · 혼자 이어 하기만`, /\d:\d\d/.test(wait.state) && wait.btns.join() === "net-solo", JSON.stringify(wait));
      await measure(page, `${key}|wait`, [".sheet__head", "#sheetBody .net-line", ".net-seats .mpb__l1", ".net-seats .mpb__seat", "#sheetFoot .btn"]);
      await rows(page, `${key}|wait`, ".net-seats .mpb__row");
      await fits(page, `${key}|wait`, ".sheet__panel");
      const lay2 = await layout(page);
      ok(`${key}|wait 겹침·가로 넘침 없음 · 잉크 세로 가운데 차이 ${worst(`${key}|wait`, view.dpr ?? 2)}px(홀수 1픽셀 아래 제외)`, lay2.overlap === 0 && lay2.wide === 0 && !lay2.hScroll && worst(`${key}|wait`, view.dpr ?? 2) === 0, JSON.stringify(lay2));
      if (lang === "ko" && view.name === "390x844") await page.screenshot({ path: path.join(shots, "유저_방장대기_390x844.png") });
      ok(`${key} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
}

function hexOfColor(value) {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(String(value));
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("")}`;
  const t = String(value).trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(t) ? `#${[...t.slice(1)].map((c) => c + c).join("")}` : t;
}

function contrastOf(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hexOfColor(hex).slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
if (process.env.UI_NET_WGBA && (ONLY_BOARD || process.env.UI_BOARD === "1")) await boardChecks();

// 중간 참가 게임: 방장 혼자 방 코드 화면(안내 문구·방 나가기·닫기 버튼 줄)과 창을 닫은 뒤 상단 버튼(회색 배지 1/4) — 잉크 세로 가운데·같은 줄 위·아래 차이 0
async function anytimeChecks() {
  const bytes = (await repackWgba(process.env.UI_NET_WGBA, (m) => ({ ...m, id: `${m.id}.anytime`, multiplayer: { ...m.multiplayer, join: "anytime" } }))).toString("base64");
  for (const view of [...VIEWS, ...(VIEW_FILTER && !VIEW_FILTER.has("320x568") ? [] : [{ name: "320x568", viewport: { width: 320, height: 568 } }])]) {
    for (const lang of LANGS) {
      const key = `${view.name}|${lang}|anytime`;
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
        await window.webgba.openFiles([new File([data], "net-anytime.wgba")]);
      }, bytes);
      await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
      await page.evaluate(() => {
        window.webgba.player.keyDown("KeyZ");
        setTimeout(() => window.webgba.player.keyUp("KeyZ"), 120);
      });
      await page.waitForTimeout(1200);
      ok(`${key} 요청해도 창 자동 열림 없음`, (await page.evaluate(() => window.webgba.state.sheet)) === "" && (await page.evaluate(() => !document.getElementById("btnNet").hidden)));
      await page.click("#btnNet");
      await page.waitForFunction(() => Boolean(document.querySelector('[data-action="net-tab-make"]')), null, { timeout: 8000 });
      await page.click('[data-action="net-tab-make"]');
      await page.click('[data-action="net-room-make"]');
      const room = await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector(".net-room-code")?.textContent ?? ""), null, { timeout: 10000 }).then(() => true, () => false);
      await page.waitForTimeout(400);
      if (room) {
        await measure(page, `${key}|net-room`, [".sheet__head", ".net-room", ".net-seats .mpb__l1", "#sheetFoot .btn"]);
        await rows(page, `${key}|net-room`, ".net-seats .mpb__row");
        await fits(page, `${key}|net-room`, ".sheet__panel");
        const acts = await lineUp(page, `${key}|net-room`, "#sheetFoot .net-actions", ":scope > button");
        ok(`${key}|net-room 하단 버튼 = 방 닫기·갱신·게임으로`, acts[0]?.map((i) => i.id).join() === "net-leave,net-renew,net-close", JSON.stringify(acts));
        const renew = await page.evaluate(() => {
          const btn = document.querySelector('[data-action="net-renew"]');
          const accept = document.querySelector("#sheetBody .net-accept");
          if (!btn || !accept) return null;
          const s = getComputedStyle(btn);
          return { label: btn.querySelector(".btn__label")?.textContent ?? btn.textContent, accept: accept.textContent, clipped: btn.scrollWidth > btn.clientWidth + 1 || accept.scrollWidth > accept.clientWidth + 1, display: s.display };
        });
        ok(`${key}|net-room 받기 상태 줄 + 갱신 버튼(잘림 없음)`, renew && renew.label && /\d:\d{2}/.test(renew.accept) && !renew.clipped, JSON.stringify(renew));
        await measure(page, `${key}|net-room`, ["#sheetBody .net-line"]);
        if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `중간참가_${view.name}_방코드.png`) });
        await page.click('[data-action="net-close"]');
        await page.waitForTimeout(500);
        const badge = await page.evaluate(() => {
          const b = document.querySelector("#btnNet .tool__badge");
          return { sheet: window.webgba.state.sheet, text: b?.textContent ?? "", tone: b?.dataset.tone ?? "", hidden: b?.hidden, active: window.webgba.player.net.active };
        });
        ok(`${key} 창 닫기(게임 중) → 받기 계속 · 파랑 배지 1/4`, badge.sheet === "" && badge.active && badge.text === "1/4" && badge.tone === "" && !badge.hidden, JSON.stringify(badge));
        await measure(page, `${key}|bar`, ["#btnNet .tool__badge"]);
        await barLineUp(page, `${key}|bar`);
        if (lang === "ko") await page.screenshot({ path: path.join(SHOTS, `중간참가_${view.name}_받는중.png`) });
      } else ok(`${key} 방 만들기(서버 필요)`, false, "방 코드를 받지 못함 — <주소> 가 /api/v1/mp 를 내주는지 확인");
      ok(`${key} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
}

// ── 표시 비율 display.aspect(결정 143)·방향 입력 기본값 input.dpad(결정 145) ──
// UI_ASPECT_KOV=<448×224 아케이드 .wgba(경로 조회만, 메모리에서 display.aspect "4:3" 을 더해 다시 묶음 — 파일로 쓰지 않음)>
// UI_ASPECT_RAPID=<240×160 .wgba> · UI_ASPECT_GBA=<.gba> · UI_BASE_URL=<수정 전 빌드>: 첫 화면·두 게임 화면(일시정지 후 같은 무늬)을 수정 전과 픽셀 비교.
// 화면 칸 = 설명서 비율(4:3·2:1·3:2), 4:3 은 캔버스를 늘려 채움(object-fit fill), 가상 버튼 겹침 0·화면 안, 화면 칸 세로 가운데.
// input.dpad "both" 게임: 대각선(두 방향 비트) 전달·설정 설명이 게임 전용·게임별로 바꾼 값 저장·새로 고침 뒤 복원, 지정 없는 게임은 전체 설정 그대로.
const ASPECT_VIEWS = [
  { name: "320x568", viewport: { width: 320, height: 568 }, dpr: 2, mobile: true },
  { name: "390x844", viewport: { width: 390, height: 844 }, dpr: 3, mobile: true },
  { name: "844x390", viewport: { width: 844, height: 390 }, dpr: 3, mobile: true },
  { name: "1280x800", viewport: { width: 1280, height: 800 }, dpr: 1, mobile: false },
].filter((view) => !VIEW_FILTER || VIEW_FILTER.has(view.name));
const ASPECT_SHOTS = { "390x844": "삼국전기_4대3_세로_390x844.png", "844x390": "삼국전기_4대3_가로_844x390.png" };

async function repackWgba(file, patch) {
  const { codeWasm, packWgba, readTocFrom, unpackChunk } = await import("../../src-bundle/src/js/core/wgba-format.js");
  const bytes = new Uint8Array(fs.readFileSync(file));
  const toc = await readTocFrom(bytes);
  const part = (name) => {
    const e = toc.entries.find((x) => x.name === name);
    return e ? { e, stored: bytes.subarray(e.start, e.end) } : null;
  };
  const me = part("manifest");
  const manifest = JSON.parse(new TextDecoder().decode(unpackChunk(me.stored, me.e)));
  const images = {};
  for (const [name, chunk] of [["label", "cart.label"], ["front", "cart.front"], ["spine", "cart.spine"]]) {
    const x = part(chunk);
    if (x) images[name] = unpackChunk(x.stored, x.e);
  }
  const data = toc.entries.filter((e) => e.name.startsWith("data.")).map((e) => ({ name: e.name.slice(5), bytes: unpackChunk(bytes.subarray(e.start, e.end), e) }));
  const res = await packWgba({ wasm: codeWasm(part("code").stored), manifest: patch(manifest), images, data, romPayloadBytes: part("rom")?.stored ?? null });
  return Buffer.from(res.bytes);
}

async function exampleWgba(patch) {
  const { packWgba } = await import("../../src-bundle/src/js/core/wgba-format.js");
  const dir = fileURLToPath(new URL("../../docs/wgba/examples/hello-webapi/", import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const res = await packWgba({ wasm: fs.readFileSync(path.join(dir, "game.wasm")), manifest: patch(manifest) });
  return Buffer.from(res.bytes);
}

async function aspectPage(view, files, { url = URL_BASE, prefs = null } = {}) {
  const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dpr, isMobile: view.mobile, hasTouch: view.mobile, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (prefs && !sessionStorage.getItem("aspect.seeded")) {
      localStorage.setItem("webgba.prefs", JSON.stringify(prefs));
      sessionStorage.setItem("aspect.seeded", "1");
    }
  }, prefs);
  await context.route("**/__aspect/*", (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    return files[name] ? route.fulfill({ status: 200, body: files[name], contentType: "application/octet-stream" }) : route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.addStyleTag({ content: "#toast{visibility:hidden !important}" });
  return { context, page };
}

async function openAspectGame(page, name) {
  await page.evaluate(async (name) => {
    const data = new Uint8Array(await (await fetch(`/__aspect/${encodeURIComponent(name)}`)).arrayBuffer());
    await window.webgba.openFiles([new File([data], name)]);
  }, name);
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 30000 });
  await page.waitForTimeout(500);
}

const screenInfo = (page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const screen = document.getElementById("screen").getBoundingClientRect();
    const canvas = document.getElementById("canvas");
    const c = canvas.getBoundingClientRect();
    const stage = document.querySelector(".stage").getBoundingClientRect();
    return {
      sw: parseFloat(s.getPropertyValue("--sw")),
      sh: parseFloat(s.getPropertyValue("--sh")),
      screen: [screen.left, screen.top, screen.width, screen.height],
      canvas: [c.left, c.top, c.width, c.height],
      buffer: [canvas.width, canvas.height],
      fit: getComputedStyle(canvas).objectFit,
      stretch: document.body.hasAttribute("data-stretch"),
      gapTop: +(screen.top - stage.top).toFixed(2),
      gapBottom: +(stage.bottom - screen.bottom).toFixed(2),
      pad: document.body.dataset.pad,
    };
  });

async function patternShot(page) {
  await page.evaluate(async () => {
    const p = window.webgba.player;
    p.setPaused(true);
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const o = (y * canvas.width + x) * 4;
        const on = (x + y) % 2 === 0;
        img.data[o] = on ? 255 : (x * 7) & 255;
        img.data[o + 1] = on ? 255 : (y * 5) & 255;
        img.data[o + 2] = ((x ^ y) * 3) & 255;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  return shoot(page);
}

// 퀵슬롯 사진 칸 = 게임 화면 비율(설명서 screen·display.aspect, GB 10:9), 사진은 칸 전체에 그대로(좌우 잘림 없음), 칸 폭·열 수는 화면 크기 규칙 그대로.
// 1번 칸에 저장한 뒤 퀵슬롯 창을 열어 재고 닫는다. shot = 캡처 파일 이름(없으면 찍지 않음).
async function quickShotCheck(page, key, ratio, label, shot = "") {
  const saved = await page.evaluate(() => window.webgba.player.saveState(1));
  await page.evaluate(() => window.webgba.openSheet("quick"));
  await page.waitForFunction(() => document.querySelector('.slots .slot[data-slot="1"] .slot__img')?.complete, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const shot = document.querySelector('.slots .slot[data-slot="1"] .slot__shot');
    const img = shot?.querySelector(".slot__img");
    const empty = document.querySelector('.slots .slot[data-slot="2"] .slot__shot');
    if (!shot || !img || !empty) return null;
    const box = (n) => n.getBoundingClientRect();
    const s = box(shot);
    const i = box(img);
    const e = box(empty);
    const columns = getComputedStyle(document.querySelector(".slots")).gridTemplateColumns.split(" ").length;
    const panel = box(document.querySelector(".sheet__panel"));
    return { shot: [s.width, s.height].map((v) => +v.toFixed(2)), img: [i.width, i.height].map((v) => +v.toFixed(2)), empty: [e.width, e.height].map((v) => +v.toFixed(2)), natural: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit, columns, inside: panel.top >= -0.5 && panel.bottom <= (window.visualViewport?.height ?? innerHeight) + 0.5 };
  });
  const pass =
    saved &&
    info &&
    Math.abs(info.shot[0] / info.shot[1] - ratio) < 0.02 &&
    Math.abs(info.empty[0] / info.empty[1] - ratio) < 0.02 &&
    info.img.every((v, i) => Math.abs(v - info.shot[i]) <= 0.5) &&
    info.fit === "fill" &&
    info.inside;
  ok(`${key}: 퀵슬롯 사진 칸 ${label}(빈 칸 포함)·사진 = 칸 전체(잘림 없음)·창 화면 안`, pass, JSON.stringify(info));
  if (shot) await page.screenshot({ path: path.join(SHOTS, shot) });
  await page.evaluate(() => document.getElementById("sheetClose").click());
  await page.waitForTimeout(300);
  return info;
}

async function aspectChecks() {
  const kovFile = process.env.UI_ASPECT_KOV;
  const files = {
    "hello-dpad.wgba": await exampleWgba((m) => ({ ...m, id: "com.example.hello.dpad", input: { preset: "gba", dpad: "both" } })),
    "hello.wgba": await exampleWgba((m) => m),
  };
  if (kovFile) {
    files["kov-43.wgba"] = await repackWgba(kovFile, (m) => ({ ...m, display: { aspect: "4:3" } }));
    // 원본 설명서에 display 가 있어도(삼국전기 1.2.1 = 4:3) 2:1 은 display 를 뺀 사본(448×224 그대로)으로 잰다
    files["kov-21.wgba"] = await repackWgba(kovFile, ({ display, ...m }) => m);
  }
  if (process.env.UI_ASPECT_RAPID) files["rapid.wgba"] = fs.readFileSync(process.env.UI_ASPECT_RAPID);
  if (process.env.UI_ASPECT_GBA) files["game.gba"] = fs.readFileSync(process.env.UI_ASPECT_GBA);

  for (const view of ASPECT_VIEWS) {
    const key = `${view.name} 표시 비율`;
    // 수정 전 빌드와 픽셀 비교: 첫 화면, 240×160 게임(래피드 .wgba·.gba)을 일시정지 후 같은 무늬로 칠한 화면
    if (BASE_URL) {
      for (const name of [null, "rapid.wgba", "game.gba"]) {
        if (name && !files[name]) continue;
        const shots = [];
        for (const url of [BASE_URL, URL_BASE]) {
          const { context, page } = await aspectPage(view, files, { url });
          if (name) await openAspectGame(page, name);
          else await page.waitForTimeout(400);
          shots.push({ image: name ? await patternShot(page) : await shoot(page), info: await screenInfo(page) });
          await context.close();
        }
        const diff = pixelDiff(shots[0].image, shots[1].image);
        ok(`${key}: ${name ?? "첫 화면"} 수정 전과 픽셀 같음(화면 칸 ${shots[1].info.sw}x${shots[1].info.sh})`, diff === 0 && shots[0].info.sw === shots[1].info.sw && shots[0].info.sh === shots[1].info.sh, `다른 픽셀 ${diff} · 전 ${shots[0].info.sw}x${shots[0].info.sh} · 후 ${shots[1].info.sw}x${shots[1].info.sh}`);
      }
    }
    if (kovFile) {
      const { context, page } = await aspectPage(view, files);
      for (const [name, ratio, label] of [["kov-43.wgba", 4 / 3, "4:3"], ["kov-21.wgba", 2, "2:1"]]) {
        await openAspectGame(page, name);
        const info = await screenInfo(page);
        const pads = view.mobile ? overlaps((await padBoxes(page)).boxes, view.viewport) : { hits: [], outside: [] };
        const stretch = label === "4:3";
        const sameBox = info.canvas.every((v, i) => Math.abs(v - info.screen[i]) <= 0.5);
        ok(`${key}: ${name} 화면 칸 ${label}(${info.sw}x${info.sh})·캔버스 = 화면 칸·${stretch ? "늘려 채움" : "비율 유지"}·버퍼 ${info.buffer.join("x")}`, Math.abs(info.sw / info.sh - ratio) < 0.01 && sameBox && info.fit === (stretch ? "fill" : "contain") && info.stretch === stretch && info.buffer.join("x") === "448x224", JSON.stringify(info));
        ok(`${key}: ${name} 가상 버튼·기능 버튼 겹침 0·화면 안`, !pads.hits.length && !pads.outside.length, JSON.stringify(pads));
        ok(`${key}: ${name} 화면 칸 세로 가운데(위 ${info.gapTop} · 아래 ${info.gapBottom})`, Math.abs(info.gapTop - info.gapBottom) <= 0.5, JSON.stringify(info));
        if (stretch && ASPECT_SHOTS[view.name]) {
          await page.waitForTimeout(1500);
          await page.screenshot({ path: path.join(SHOTS, ASPECT_SHOTS[view.name]) });
        }
        await quickShotCheck(page, `${key}: ${name}`, ratio, label, view.name === "390x844" ? `퀵슬롯_${label.replace(":", "대")}_390x844.png` : "");
      }
      ok(`${key}: 페이지 오류 0`, page.errors.length === 0, page.errors.join(" / "));
      await context.close();
    }
    if (files["game.gba"] && view.name === "390x844") {
      const { context, page } = await aspectPage(view, files);
      await openAspectGame(page, "game.gba");
      await quickShotCheck(page, `${key}: game.gba`, 3 / 2, "3:2");
      await context.close();
    }
  }

  // 방향 입력 기본값: 전체 설정 "opposite" 인 상태에서 dpad "both" 게임을 열고, 게임 전용 값을 "latest" 로 바꾼 뒤 새로 고침
  const dirBits = (page) =>
    page.evaluate(() => {
      const p = window.webgba.player;
      p.keyDown("ArrowRight");
      p.keyDown("ArrowUp");
      const bits = p.resolveDpad(p.held);
      p.keyUp("ArrowUp");
      p.keyUp("ArrowRight");
      return { mode: p.dpadMode, bits };
    });
  const prefsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}"));
  for (const view of ASPECT_VIEWS.filter((v) => v.mobile && v.name !== "844x390")) {
    const key = `${view.name} 방향 입력`;
    const { context, page } = await aspectPage(view, files, { prefs: { lang: "ko", dpadMode: "opposite" } });
    await openAspectGame(page, "hello-dpad.wgba");
    const first = await dirBits(page);
    ok(`${key}: dpad both 게임 = 대각선 두 비트(위 + 오른쪽 = 80)`, first.mode === "both" && first.bits === 80, JSON.stringify(first));
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await page.waitForTimeout(400);
    const words = await (await fetch(new URL("/i18n/ko.json", URL_BASE))).json();
    const row = await page.evaluate((label) => {
      const field = [...document.querySelectorAll("#sheetBody .field")].find((n) => n.querySelector(".field__label")?.textContent === label);
      field?.scrollIntoView({ block: "center" });
      return field ? { note: field.querySelector(".field__note")?.textContent ?? "", value: field.querySelector(".pick")?.dataset.value } : null;
    }, words["cfg.dpadMode"]);
    ok(`${key}: 설정 값 = 게임 값 both · 설명 = 게임 전용 안내`, row?.value === "both" && row.note.includes("안녕 wgba") && row.note.includes(words["cfg.dpadMode.both"]), JSON.stringify(row));
    await fits(page, `${key}|settings`, ".sheet__panel");
    const pads = await rowPads(page, `${key}|settings·여백`, "#sheetBody .field");
    padTable.push({ key: `${view.name} 게임 전용 방향 설정`, pads });
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll("#sheetBody .field__label, #sheetBody .field__note, #sheetBody .pick__value")]
        .filter((n) => {
          const row = n.closest(".field").getBoundingClientRect();
          const r = n.getBoundingClientRect();
          return n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 || r.top < row.top - 0.5 || r.bottom > row.bottom + 0.5;
        })
        .map((n) => n.textContent.trim()),
    );
    ok(`${key}|settings 이름·설명·선택 값 잘림 0`, cut.length === 0, cut.join(" / "));
    if (view.name === "390x844") {
      const body = page.locator("#sheetBody");
      const total = await body.evaluate((n) => n.scrollHeight);
      const step = await body.evaluate((n) => n.clientHeight);
      for (let y = 0, i = 1; y < total && i <= 3; y += step, i++) {
        await body.evaluate((n, top) => (n.scrollTop = top), y);
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOTS, `설정_세로_390x844_${i}.png`) });
      }
    }
    await page.evaluate((label) => [...document.querySelectorAll("#sheetBody .field")].find((n) => n.querySelector(".field__label")?.textContent === label).querySelector(".pick").click(), words["cfg.dpadMode"]);
    await page.waitForSelector('.choice__opt[data-value="latest"]', { state: "visible" });
    await page.click('.choice__opt[data-value="latest"]');
    await page.waitForTimeout(300);
    const saved = await prefsOf(page);
    const changed = await dirBits(page);
    ok(`${key}: 게임 전용 값 latest 저장(전체 설정 opposite 그대로)·바로 적용(한 비트)`, saved.gameDpad?.["com.example.hello.dpad"] === "latest" && saved.dpadMode === "opposite" && changed.mode === "latest" && (changed.bits === 64 || changed.bits === 16), JSON.stringify({ gameDpad: saved.gameDpad, dpadMode: saved.dpadMode, changed }));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    await openAspectGame(page, "hello-dpad.wgba");
    const restored = await dirBits(page);
    ok(`${key}: 새로 고침 후 같은 게임 = 저장한 latest 복원`, restored.mode === "latest", JSON.stringify(restored));
    await openAspectGame(page, "hello.wgba");
    const plain = await dirBits(page);
    ok(`${key}: dpad 지정 없는 게임 = 전체 설정 opposite(위 + 오른쪽 두 비트)`, plain.mode === "opposite" && plain.bits === 80, JSON.stringify(plain));
    ok(`${key}: 페이지 오류 0`, page.errors.length === 0, page.errors.join(" / "));
    await context.close();
  }
  // 전체 설정이 기본값(latest)인 새 기기: 지정 없는 게임은 기존 동작 그대로(나중에 누른 방향 한 비트)
  {
    const { context, page } = await aspectPage(ASPECT_VIEWS.find((v) => v.name === "390x844") ?? ASPECT_VIEWS[0], files, { prefs: { lang: "ko" } });
    await openAspectGame(page, "hello.wgba");
    const plain = await dirBits(page);
    ok("방향 입력: 기본 설정·지정 없는 게임 = latest(나중에 누른 위 한 비트 64)", plain.mode === "latest" && plain.bits === 64, JSON.stringify(plain));
    await context.close();
  }
}

if (ASPECT) await aspectChecks();

// ── GB·GBC(결정 146) ──
// UI_GB_DIR=<테스트 롬 폴더: gb_mbc1.gb(DMG·MBC1)·gbc_mbc3.gbc(GBC 전용·MBC3 RTC)·dual_mbc3.gbc(겸용)·gbc_mbc3.zip>. 롬 화면 무늬:
// 2행 = 누른 버튼 비트(타일 2~9열), 4행 = 켜진 횟수, 6행 = RTC 초, 8행 = A 누른 횟수(진한 칸 = 1). 화면 칸 10:9·버퍼 160×144·세로 가운데,
// 터치 L·R 숨김·버튼 겹침 0, 키 8개만(L·R 키 무시), 세이브 저장 → 새로 고침 뒤 복원, RTC 실제 시각, 퀵슬롯·자동 저장, .zip 안 .gbc,
// 흑백 GB 회색, 라이브러리 GB·GBC 롬팩(GB 회색·세로 모양)·종류 글·잉크 가운데, 조작법 8개.
const GB_DIR = process.env.UI_GB_DIR ?? "";
const GB_VIEWS = [
  { name: "320x568", viewport: { width: 320, height: 568 }, dpr: 2, mobile: true },
  { name: "390x844", viewport: { width: 390, height: 844 }, dpr: 3, mobile: true },
  { name: "844x390", viewport: { width: 844, height: 390 }, dpr: 3, mobile: true },
  { name: "1280x800", viewport: { width: 1280, height: 800 }, dpr: 1, mobile: false },
].filter((view) => !VIEW_FILTER || VIEW_FILTER.has(view.name));

const gbRow = (page, row) =>
  page.evaluate((row) => {
    const img = window.webgba.player.image;
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const o = ((row * 8 + 4) * img.width + (2 + i) * 8 + 4) * 4;
      if (img.data[o] + img.data[o + 1] + img.data[o + 2] < 120) v |= 1 << i;
    }
    return v;
  }, row);

async function gbPress(page, code, ms = 120) {
  await page.evaluate((code) => window.webgba.player.keyDown(code), code);
  await page.waitForTimeout(ms);
  const bits = await gbRow(page, 2);
  await page.evaluate((code) => window.webgba.player.keyUp(code), code);
  await page.waitForTimeout(ms);
  return bits;
}

async function gbChecks() {
  if (!GB_DIR) return ok("GB·GBC: UI_GB_DIR 지정", false);
  const files = {};
  for (const name of ["gb_mbc1.gb", "gbc_mbc3.gbc", "dual_mbc3.gbc", "gbc_mbc3.zip"]) files[name] = fs.readFileSync(path.join(GB_DIR, name));

  for (const view of GB_VIEWS) {
    const key = `${view.name} GB·GBC`;
    const { context, page } = await aspectPage(view, files, { prefs: { lang: "ko" } });
    await openAspectGame(page, "gbc_mbc3.gbc");
    const info = await screenInfo(page);
    const sameBox = info.canvas.every((v, i) => Math.abs(v - info.screen[i]) <= 0.5);
    ok(`${key}: 화면 칸 10:9(${info.sw}x${info.sh})·캔버스 = 화면 칸·비율 유지·버퍼 ${info.buffer.join("x")}`, Math.abs(info.sw / info.sh - 10 / 9) < 0.012 && sameBox && info.fit === "contain" && !info.stretch && info.buffer.join("x") === "160x144", JSON.stringify(info));
    ok(`${key}: 화면 칸 세로 가운데(위 ${info.gapTop} · 아래 ${info.gapBottom})`, Math.abs(info.gapTop - info.gapBottom) <= 0.5, JSON.stringify(info));
    await quickShotCheck(page, key, 10 / 9, "10:9", view.name === "390x844" ? "퀵슬롯_10대9_390x844.png" : "");
    if (view.mobile) {
      const shoulders = await page.evaluate(() => ["L", "R"].map((k) => { const n = document.querySelector(`#pad [data-key="${k}"]`); return { off: n?.hasAttribute("data-off"), shown: Boolean(n && n.offsetParent && n.getBoundingClientRect().width > 0) }; }));
      const pads = overlaps((await padBoxes(page)).boxes, view.viewport);
      ok(`${key}: 터치 L·R 숨김 · 나머지 버튼 겹침 0·화면 안`, shoulders.every((s) => s.off && !s.shown) && !pads.hits.length && !pads.outside.length, JSON.stringify({ shoulders, pads }));
      if (view.name === "390x844") {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(SHOTS, "GBC_세로_390x844.png") });
      }
    }
    ok(`${key}: 페이지 오류 0`, page.errors.length === 0, page.errors.join(" / "));
    await context.close();
  }

  const view = GB_VIEWS.find((v) => v.name === "390x844") ?? GB_VIEWS[0];
  const { context, page } = await aspectPage(view, files, { prefs: { lang: "ko", autoSave: 1 } });
  await openAspectGame(page, "gbc_mbc3.gbc");
  const game = await page.evaluate(() => ({ type: window.webgba.state.game.type, kind: window.webgba.state.game.kind, saveId: window.webgba.state.game.saveId, keys: [...window.webgba.player.keymap.keys()] }));
  ok("GB·GBC: .gbc 머리 판별 = GBC 전용 · 키 표에 L·R 키 없음", game.kind?.color === "only" && !game.keys.includes("KeyA") && !game.keys.includes("KeyS"), JSON.stringify(game));
  await page.waitForTimeout(300);
  const pressed = [];
  for (const code of ["KeyZ", "KeyX", "Backspace", "Enter", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "KeyA", "KeyS"]) pressed.push(await gbPress(page, code));
  ok(`GB·GBC: 키 8개 → 비트 0~7, L·R 키 → 입력 없음(${pressed.join(",")})`, pressed.join() === "1,2,4,8,16,32,64,128,0,0");
  const touch = [];
  for (const code of ["Pad:A", "Pad:START", "Pad:L"]) touch.push(await gbPress(page, code));
  ok(`GB·GBC: 터치 A·START → 비트, 터치 L 자리 → 입력 없음(${touch.join(",")})`, touch.join() === "1,8,0");
  const countBefore = await gbRow(page, 8);
  await gbPress(page, "KeyZ");
  await gbPress(page, "KeyZ");
  const countAfter = await gbRow(page, 8);
  let saved = [];
  for (let i = 0; i < 40 && saved[4] !== countAfter; i++) {
    await page.waitForTimeout(250);
    saved = await page.evaluate(async (id) => Array.from((await window.webgba.store.saveBytes(id)) ?? []), game.saveId);
  }
  ok(`GB·GBC: 게임 저장 → 보관 세이브(WG·켜진 1·A ${countBefore}→${countAfter}·크기 ${saved.length} = 8KB + RTC 48)`, saved[0] === 0x57 && saved[1] === 0x47 && saved[2] === 1 && saved[4] === countAfter && countAfter === countBefore + 2 && saved.length === 8240, saved.slice(0, 5).join(","));
  const sec1 = await gbRow(page, 6);
  await page.waitForTimeout(2300);
  const sec2 = await gbRow(page, 6);
  const at2 = Date.now();
  const step = (sec2 - sec1 + 60) % 60;
  ok(`GB·GBC: RTC 실제 시각 진행(${sec1} → 2.3초 뒤 ${sec2}초)`, step >= 2 && step <= 3);
  const frameAt = () => page.evaluate(() => window.webgba.player.host.ex.Web_GetFrameCount() >>> 0);
  const savedOk = await page.evaluate(() => window.webgba.player.saveState(1));
  const f1 = await frameAt();
  await page.waitForTimeout(1500);
  const f2 = await frameAt();
  const loadedOk = await page.evaluate(() => window.webgba.player.loadState(1));
  const f3 = await frameAt();
  const slots = await page.evaluate(async (id) => (await window.webgba.store.states(id)).map((s) => ({ slot: s.slot, size: s.size, thumb: s.thumb?.byteLength ?? 0 })), game.saveId);
  ok(`GB·GBC: 퀵슬롯 1 저장(${slots.find((s) => s.slot === 1)?.size} 바이트·사진)·불러오기 = 저장한 순간(${f1} → ${f2} → ${f3})`, savedOk && loadedOk && f3 < f2 - 30 && Math.abs(f3 - f1) < 10 && slots.some((s) => s.slot === 1 && s.thumb > 100), JSON.stringify(slots));
  await page.evaluate(() => (window.webgba.state.quick.played = 59200));
  await page.waitForTimeout(2500);
  const auto = await page.evaluate(async (id) => (await window.webgba.store.states(id)).filter((s) => s.slot === 9).map((s) => ({ auto: s.auto, size: s.size })), game.saveId);
  ok("GB·GBC: 자동 저장(9번 칸)", auto.length === 1 && auto[0].auto, JSON.stringify(auto));
  await page.evaluate(() => window.webgba.openSheet("help"));
  await page.waitForTimeout(300);
  const help = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .keys dt")].map((n) => n.textContent));
  ok(`GB·GBC: 조작법 = 8버튼 + 빨리 감기(L·R 없음)`, help.includes("A") && help.includes("START") && !help.includes("L") && !help.includes("R"), help.join(" / "));
  await page.evaluate(() => window.webgba.renderSheet && document.getElementById("sheetClose").click());
  await page.waitForTimeout(300);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.waitForTimeout(1800);
  await openAspectGame(page, "gbc_mbc3.gbc");
  await page.waitForTimeout(400);
  const boots = await gbRow(page, 4);
  const count = await gbRow(page, 8);
  const sec3 = await gbRow(page, 6);
  const passed = (sec3 - sec2 + 60) % 60;
  const real = Math.round((Date.now() - at2) / 1000) % 60;
  ok(`GB·GBC: 새로 고침 후 다시 열기 = 세이브 복원(켜진 ${boots}·A ${count})·RTC 이어짐(${sec2} → ${sec3}초, 실제 ${real}초 지남)`, boots === 2 && count === countAfter && Math.abs(passed - real) <= 2);

  await openAspectGame(page, "gb_mbc1.gb");
  const dmg = await page.evaluate(() => {
    const d = window.webgba.player.image.data;
    let gray = true;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) gray = false;
    return { gray, kind: window.webgba.state.game.kind, size: [window.webgba.player.image.width, window.webgba.player.image.height] };
  });
  ok(`GB·GBC: .gb(DMG) = 흑백 회색만·종류 GB·화면 ${dmg.size.join("x")}`, dmg.gray && dmg.kind?.system === "gb" && !dmg.kind.color && dmg.size.join("x") === "160x144", JSON.stringify(dmg));
  await openAspectGame(page, "dual_mbc3.gbc");
  ok("GB·GBC: 겸용 롬 = GBC 모드(겸용)", (await page.evaluate(() => window.webgba.state.game.kind?.color)) === "dual");
  await openAspectGame(page, "gbc_mbc3.zip");
  const zipped = await page.evaluate(() => ({ name: window.webgba.state.game.name, type: window.webgba.state.game.type, running: window.webgba.player.running, w: window.webgba.player.image.width }));
  ok("GB·GBC: .zip 안 .gbc 열기", zipped.name === "gbc_mbc3.gbc" && zipped.type === "gbc" && zipped.running && zipped.w === 160, JSON.stringify(zipped));

  const roms = await page.evaluate(async () => (await window.webgba.store.list("rom")).map((r) => ({ key: r.key, name: r.name, type: r.type, color: r.color ?? "" })));
  ok("GB·GBC: 라이브러리 보관 종류(gb · gbc 전용 · gbc 겸용)", ["gb_mbc1.gb:gb:", "gbc_mbc3.gbc:gbc:only", "dual_mbc3.gbc:gbc:dual"].every((want) => roms.some((r) => `${r.name}:${r.type}:${r.color}` === want)), JSON.stringify(roms));
  await page.evaluate(() => window.webgba.openSheet("library"));
  await page.waitForSelector('#sheet:not([hidden]) .lib__case .spine[data-key]');
  await page.waitForTimeout(500);
  const metas = {};
  for (const rom of roms) {
    await page.evaluate((k) => {
      window.webgba.state.lib.sel = k;
      window.webgba.renderSheet();
    }, rom.key);
    await page.waitForTimeout(350);
    const card = await page.evaluate(() => {
      const art = document.querySelector(".lib__card .cart__art");
      const g = art.getContext("2d");
      const alpha = (x, y) => g.getImageData(x, y, 1, 1).data[3];
      const px = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      return { meta: document.querySelector(".lib__meta")?.textContent ?? "", edge: alpha(2, 22), body: px(12, 3), size: [art.width, art.height] };
    });
    metas[rom.name] = card;
    await measure(page, `GB·GBC library ${rom.name}`, [".lib__name", ".lib__meta", ".lib__card .pack__label", ".lib__btns .btn"]);
    const line = await page.evaluate(() => {
      const tops = [...document.querySelectorAll(".lib__btns .btn")].filter((n) => n.offsetParent).map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.top * 100) / 100, Math.round(r.bottom * 100) / 100]; });
      const rows = new Map();
      for (const [t, b] of tops) rows.set(t, [...(rows.get(t) ?? []), b]);
      return [...rows.values()].map((list) => Math.max(...list) - Math.min(...list));
    });
    ok(`GB·GBC library ${rom.name}: 같은 줄 버튼 위·아래 px 차이 0`, line.every((d) => d === 0), JSON.stringify(line));
  }
  ok(`GB·GBC: 롬팩 종류 글 GB · GBC 전용 · GB·GBC 겸용`, /GB/.test(metas["gb_mbc1.gb"]?.meta) && !/GBC/.test(metas["gb_mbc1.gb"]?.meta) && /GBC 전용/.test(metas["gbc_mbc3.gbc"]?.meta) && /GB·GBC 겸용/.test(metas["dual_mbc3.gbc"]?.meta), JSON.stringify(Object.fromEntries(Object.entries(metas).map(([k, v]) => [k, v.meta]))));
  const gray = (rgb) => Math.max(...rgb) - Math.min(...rgb) < 12;
  ok(`GB·GBC: GB 롬팩 = 회색 몸통·세로 모양(좌우 투명), GBC = 색 몸통`, metas["gb_mbc1.gb"].edge === 0 && gray(metas["gb_mbc1.gb"].body) && metas["gbc_mbc3.gbc"].edge === 0 && !gray(metas["gbc_mbc3.gbc"].body), JSON.stringify(metas));
  const lay = await libraryLayout(page);
  ok("GB·GBC library: 롬팩 그림 정수 배율·칸 안·겹침 0", within(lay.cardParts, lay.cardView) && !crosses(lay.cardParts) && lay.arts.every((a) => Number.isInteger(+a.ratio.toFixed(3)) && a.pixelated === "pixelated"), JSON.stringify({ parts: lay.cardParts.length }));
  await page.evaluate(() => {
    const k = [...document.querySelectorAll(".lib__case .spine[data-key]")].find((n) => n.getAttribute("aria-label") === "gbc_mbc3")?.dataset.key;
    if (k) {
      window.webgba.state.lib.sel = k;
      window.webgba.renderSheet();
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "라이브러리_GB_GBC_롬팩_390x844.png") });
  ok("GB·GBC: 페이지 오류 0", page.errors.length === 0, page.errors.join(" / "));
  await context.close();

  // 첫 화면 최근 줄: GB·GBC 롬팩(가짜 1KB 기록, 롬 아님)의 이름·종류 글·라벨 잉크 가운데
  for (const v of GB_VIEWS.filter((x) => x.mobile)) {
    const { context: c2, page: p2 } = await aspectPage(v, files, { prefs: { lang: "ko" } });
    await p2.evaluate(async () => {
      const s = window.webgba.store;
      let t = Date.now();
      for (const [id, name, type, color] of [["g1", "Pocket Walk.gb", "gb", ""], ["g2", "컬러 퍼즐.gbc", "gbc", "only"], ["g3", "Hybrid Run.gbc", "gbc", "dual"]]) {
        await s.putRom({ id, name, file: name, type, color }, new Uint8Array(1024));
        await s.patch(s.romKey(id), { opened: (t -= 1000) });
      }
    });
    await p2.evaluate(() => window.webgba.refreshStart());
    await p2.waitForTimeout(500);
    const metas = await p2.evaluate(() => [...document.querySelectorAll("#startList .recent__item:not([hidden]) .recent__meta")].map((n) => n.textContent));
    ok(`${v.name} GB·GBC start: 최근 줄 종류 글(${metas.join(" / ")})`, metas.length >= 1 && metas.every((m) => /^(GB|GBC 전용|GB·GBC 겸용)$/.test(m)), JSON.stringify(metas));
    await measure(p2, `${v.name} GB·GBC start`, [".recent__name", ".recent__meta", "#startList .pack__label"]);
    ok(`${v.name} GB·GBC start: 페이지 오류 0`, p2.errors.length === 0, p2.errors.join(" / "));
    await c2.close();
  }
}

if (ONLY_GB || process.env.UI_GB === "1") await gbChecks();

async function autoFireChecks() {
  for (const view of [...VIEWS, ...(VIEW_FILTER && !VIEW_FILTER.has("320x568") ? [] : [{ name: "320x568", viewport: { width: 320, height: 568 } }])]) {
    for (const lang of LANGS) {
      for (const on of [true, false]) {
        const key = `${view.name}|${lang}|autofire-${on ? "on" : "off"}`;
        const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: 2, reducedMotion: "reduce" });
        await context.addInitScript(({ lang, on }) => {
          Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
          if (window !== window.top) return;
          localStorage.setItem("webgba.installHint", "1");
          localStorage.setItem("webgba.prefs", JSON.stringify({ lang, autoFire: on, autoFireLevel: 7 }));
        }, { lang, on });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(URL_BASE);
        await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
        await page.evaluate(() => window.webgba.openSheet("settings"));
        await page.waitForTimeout(400);
        const info = await page.evaluate(() => {
          const range = document.querySelector('#sheetBody input[data-key="autoFireLevel"]');
          const level = range?.closest(".field");
          const sw = level?.previousElementSibling;
          if (!level || !sw) return null;
          level.dataset.uiFire = "1";
          sw.dataset.uiFire = "1";
          level.scrollIntoView({ block: "center" });
          const r = range.getBoundingClientRect();
          const f = level.getBoundingClientRect();
          return { disabled: range.disabled, off: level.classList.contains("field--off"), note: level.querySelector(".field__note")?.textContent ?? "", label: sw.querySelector(".field__label")?.textContent ?? "", switchOn: sw.querySelector(".switch")?.getAttribute("aria-checked"), rangeMid: +((r.top + r.bottom) / 2 - (f.top + f.bottom) / 2).toFixed(2) };
        });
        await page.waitForTimeout(300);
        ok(`${key} 연사 켜기·끄기 줄 + 단계 바 줄(7단계 글, 끄면 바 비활성 · 바 세로 가운데)`, info && info.switchOn === String(on) && info.disabled === !on && info.off === !on && /7/.test(info.note) && /12/.test(info.note) && Math.abs(info.rangeMid) <= 1, JSON.stringify(info));
        await measure(page, `${key}|settings`, ["[data-ui-fire]"]);
        await fits(page, `${key}|settings`, ".sheet__panel");
        if (lang === "ko" && view.name === "390x844") await page.screenshot({ path: path.join(SHOTS, `웹_설정_연사_${on ? "켬" : "끔"}.png`) });
        ok(`${key} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
        await context.close();
      }
    }
  }
}

if (ONLY_AUTOFIRE || process.env.UI_AUTOFIRE === "1") await autoFireChecks();

// ── 가상 버튼 오버레이(설정 web.pad: 표시·오버레이·숨김) ──
const PAD_PARTS = ["L", "R", "A", "B", "SELECT", "START", "DIR"];

const padState = (page) =>
  page.evaluate(() => {
    const box = (n) => {
      const r = n.getBoundingClientRect();
      return { l: +r.left.toFixed(2), r: +r.right.toFixed(2), t: +r.top.toFixed(2), b: +r.bottom.toFixed(2), cx: +((r.left + r.right) / 2).toFixed(2), cy: +((r.top + r.bottom) / 2).toFixed(2), w: +r.width.toFixed(2) };
    };
    const out = {};
    for (const n of document.querySelectorAll("#pad [data-key]")) if (n.getBoundingClientRect().width > 0) out[n.dataset.key] = box(n);
    const dir = document.querySelector("#pad [data-dpad]");
    if (dir.getBoundingClientRect().width > 0) out.DIR = box(dir);
    out.FACE = box(document.querySelector("#pad .face"));
    out.SCREEN = box(document.getElementById("screen"));
    const s = getComputedStyle(document.documentElement);
    const a = document.querySelector('#pad [data-key="A"]');
    return { boxes: out, pad: document.body.dataset.pad, sw: parseFloat(s.getPropertyValue("--sw")), sh: parseFloat(s.getPropertyValue("--sh")), art: window.webgba.skin.art, display: getComputedStyle(document.getElementById("pad")).display, opacity: getComputedStyle(a).opacity };
  });

const sameBoxes = (x, y) => PAD_PARTS.every((n) => x[n] && y[n] && x[n].l === y[n].l && x[n].t === y[n].t && x[n].r === y[n].r && x[n].b === y[n].b);

// A 터치·스틱 오른쪽 끌기 → 게임에 가는 비트·눌림 표시
async function padTouch(page, context, boxes) {
  const cdp = await context.newCDPSession(page);
  const touch = touchApi(cdp);
  const read = () =>
    page.evaluate(() => {
      const a = document.querySelector('#pad [data-key="A"]');
      const d = document.querySelector("#pad [data-dpad]");
      return { held: window.webgba.player.held, a: a.hasAttribute("data-down"), aOp: getComputedStyle(a).opacity, d: d.hasAttribute("data-down"), dOp: getComputedStyle(d).opacity };
    });
  const A = boxes.A;
  await touch("touchStart", [{ x: A.cx, y: A.cy, id: 1 }]);
  await page.waitForTimeout(80);
  const aDown = await read();
  await touch("touchEnd", []);
  await page.waitForTimeout(80);
  const aUp = await read();
  const D = boxes.DIR;
  await touch("touchStart", [{ x: D.cx, y: D.cy, id: 2 }]);
  await touch("touchMove", [{ x: D.cx + D.w / 2, y: D.cy, id: 2 }]);
  await page.waitForTimeout(80);
  const dDown = await read();
  await touch("touchEnd", []);
  await page.waitForTimeout(80);
  const dUp = await read();
  await cdp.detach();
  return { aDown, aUp, dDown, dUp };
}

async function overlayChecks() {
  const files = { "overlay.wgba": await exampleWgba((m) => m) };
  const land = { viewport: { width: 844, height: 390 }, dpr: 2, mobile: true };
  const port = { viewport: { width: 390, height: 844 }, dpr: 2, mobile: true };
  const shots = CAPTURE || SHOTS;
  const withGame = async (view, pad) => {
    const p = await aspectPage(view, files, { prefs: { lang: "ko", pad } });
    p.start = await padState(p.page);
    await openAspectGame(p.page, "overlay.wgba");
    await p.page.waitForTimeout(300);
    return p;
  };

  const off = await withGame(land, "off");
  const offState = await padState(off.page);
  ok("가로 숨김 그대로: data-pad off · 가상 버튼 없음", offState.pad === "off" && offState.display === "none", JSON.stringify({ pad: offState.pad, display: offState.display }));
  await off.context.close();
  const on = await withGame(land, "on");
  const onState = await padState(on.page);
  const onB = onState.boxes;
  ok("가로 표시 그대로: data-pad on · 버튼은 게임 화면 양옆", onState.pad === "on" && onB.A.l >= onB.SCREEN.r && onB.DIR.r <= onB.SCREEN.l && onState.opacity === "1", JSON.stringify({ pad: onState.pad, A: onB.A, DIR: onB.DIR, SCREEN: onB.SCREEN }));
  const onInput = await padTouch(on.page, on.context, onB);
  await on.context.close();

  const ov = await withGame(land, "overlay");
  ok("가로 오버레이 첫 화면(게임 없음): 가상 버튼 숨김", ov.start.pad === "overlay" && ov.start.display === "none", JSON.stringify({ pad: ov.start.pad, display: ov.start.display }));
  const st = await padState(ov.page);
  const B = st.boxes;
  const S = B.SCREEN;
  const parts = PAD_PARTS.map((n) => [n, B[n]]);
  const inside = parts.every(([, b]) => b && b.l >= S.l && b.r <= S.r && b.t >= S.t && b.b <= S.b);
  ok(`가로 오버레이: data-pad overlay · 게임 화면 = 숨김과 같은 최대 크기(${st.sw}x${st.sh}) · 버튼 7개 모두 게임 화면 안`, st.pad === "overlay" && st.sw === offState.sw && st.sh === offState.sh && inside, JSON.stringify({ screen: S, parts: Object.fromEntries(parts) }));
  const hits = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const [n1, x] = parts[i];
    const [n2, y] = parts[j];
    if (x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b) hits.push(`${n1}×${n2}`);
  }
  ok("가로 오버레이: 버튼끼리 겹침 0", hits.length === 0, hits.join(","));
  const row = { lr: [B.L.t - B.R.t, B.L.b - B.R.b], ss: [B.SELECT.t - B.START.t, B.SELECT.b - B.START.b], mid: +(B.DIR.cy - B.FACE.cy).toFixed(2) };
  ok("가로 오버레이: 같은 줄 위·아래 차이 0(L·R, SELECT·START) · 스틱·A·B 묶음 가운데 차이 0", row.lr.every((v) => v === 0) && row.ss.every((v) => v === 0) && row.mid === 0, JSON.stringify(row));
  ok(`가로 오버레이: 배율 ${st.art}(표시 ${onState.art} 이상 — 표시는 게임 화면을 먼저 키워 양옆 칸이 좁음) · 반투명 ${st.opacity}`, st.art >= onState.art && st.opacity === "0.5", "");
  const through = await ov.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? "", [S.cx, S.cy]);
  ok("가로 오버레이: 게임 화면 가운데는 버튼이 받지 않음(게임 화면으로)", through === "canvas", through);
  const ovInput = await padTouch(ov.page, ov.context, B);
  const sameInput = ovInput.aDown.held === onInput.aDown.held && ovInput.dDown.held === onInput.dDown.held && ovInput.aUp.held === 0 && ovInput.dUp.held === 0;
  ok("가로 오버레이 입력 = 표시 모드(A 터치·스틱 오른쪽) · 누르는 동안 눌림 표시(불투명 0.85) · 떼면 0", sameInput && (ovInput.aDown.held & PAD_BITS.A) && (ovInput.dDown.held & PAD_BITS.RIGHT) && ovInput.aDown.a && ovInput.aDown.aOp === "0.85" && ovInput.dDown.d && ovInput.dDown.dOp === "0.85" && !ovInput.aUp.a && !ovInput.dUp.d, JSON.stringify({ ovInput, onInput }));
  const bar = await ov.page.evaluate(() => [...document.querySelectorAll("#bar .tool")].filter((n) => n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  ok("가로 오버레이: 기능 버튼 같은 줄 위·아래 차이 0", bar.length > 1 && barRows(bar).every((row) => row.every((b) => b.top === row[0].top && b.bottom === row[0].bottom)), JSON.stringify(bar));
  await ov.page.screenshot({ path: path.join(shots, "가로_844x390_오버레이.png") });
  await ov.page.keyboard.press("KeyP");
  await ov.page.waitForTimeout(200);
  const paused = await padState(ov.page);
  await ov.page.keyboard.press("KeyP");
  await ov.page.waitForTimeout(200);
  const resumed = await padState(ov.page);
  ok("가로 오버레이: 일시정지 덮개가 보이는 동안 가상 버튼 숨김(덮개 버튼을 가리지 않음) · 다시 실행하면 표시", paused.display === "none" && resumed.display === "grid", `${paused.display} → ${resumed.display}`);

  const portOn = await withGame(port, "on");
  const portOnState = await padState(portOn.page);
  await portOn.context.close();
  const portOv = await withGame(port, "overlay");
  const portOvState = await padState(portOv.page);
  ok("세로 오버레이 = 표시와 같은 배치(data-pad on · 버튼 자리 같음)", portOvState.pad === "on" && sameBoxes(portOvState.boxes, portOnState.boxes), JSON.stringify({ pad: portOvState.pad }));
  await portOv.page.setViewportSize(land.viewport);
  await portOv.page.waitForTimeout(500);
  const turned = await padState(portOv.page);
  await portOv.page.setViewportSize(port.viewport);
  await portOv.page.waitForTimeout(500);
  const back = await padState(portOv.page);
  ok("회전: 세로(표시 배치) → 가로(오버레이, 같은 자리) → 세로(표시 배치)", turned.pad === "overlay" && sameBoxes(turned.boxes, B) && back.pad === "on" && sameBoxes(back.boxes, portOnState.boxes), JSON.stringify({ turned: turned.pad, back: back.pad }));

  await portOv.page.evaluate(() => window.webgba.openSheet("settings"));
  await portOv.page.waitForTimeout(400);
  const words = await (await fetch(new URL("/i18n/ko.json", URL_BASE))).json();
  await portOv.page.evaluate((label) => {
    const row = [...document.querySelectorAll("#sheetBody .field")].find((n) => n.querySelector(".field__label")?.textContent === label);
    row.scrollIntoView({ block: "center" });
    row.querySelector(".pick").dataset.uiPick = "1";
  }, words["web.pad"]);
  await portOv.page.click('[data-ui-pick="1"]');
  await portOv.page.waitForSelector("#choice:not([hidden]) .choice__opt");
  await portOv.page.waitForTimeout(300);
  const choice = await portOv.page.evaluate(() => ({ labels: [...document.querySelectorAll(".choice__opt")].map((n) => n.querySelector(".choice__label").textContent), selected: document.querySelector('.choice__opt[aria-selected="true"]')?.dataset.value }));
  ok(`설정 가상 버튼: 세 값(${choice.labels.join("·")}) · 현재 오버레이`, choice.labels.join("|") === [words["web.pad.on"], words["web.pad.overlay"], words["web.pad.off"]].join("|") && choice.selected === "overlay", JSON.stringify(choice));
  await measure(portOv.page, "390x844|ko|가상 버튼 옵션", ["#choice .sheet__head", ".choice__opt"]);
  await rowPads(portOv.page, "390x844|ko|가상 버튼 옵션·여백", ".choice__opt");
  await portOv.page.screenshot({ path: path.join(shots, "세로_390x844_설정_가상버튼.png") });
  await portOv.page.click('.choice__opt[data-value="off"]');
  await portOv.page.waitForTimeout(300);
  const picked = await portOv.page.evaluate(() => ({ pref: window.webgba.state.prefs.pad, pad: document.body.dataset.pad }));
  ok("설정에서 숨김 고르면 바로 반영·저장", picked.pref === "off" && picked.pad === "off", JSON.stringify(picked));
  ok("오버레이 시험 페이지 오류 없음", portOv.page.errors.length === 0 && ov.page.errors.length === 0, [...portOv.page.errors, ...ov.page.errors].join(" | "));
  await portOv.context.close();
  await ov.context.close();
}

if (ONLY_OVERLAY) await overlayChecks();

// ── 설정 줄 문구·테마 목록(웹: 커스텀 없음, 대표 색 4개 견본)·빈 라이브러리·빈 세이브 ──
async function settextChecks() {
  const shots = CAPTURE || SHOTS;
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    for (const lang of LANGS) {
      const key = `${viewport.width}x${viewport.height}|${lang}`;
      const { context, page } = await aspectPage({ viewport, dpr: 2, mobile: true }, {}, { prefs: { lang } });
      await page.evaluate(() => window.webgba.openSheet("settings"));
      await page.waitForTimeout(400);
      const count = await page.evaluate(() => document.querySelectorAll("#sheetBody .field").length);
      for (let at = 0; at < count; at += 4) {
        await page.evaluate((i) => document.querySelectorAll("#sheetBody .field")[i].scrollIntoView({ block: "start" }), at);
        await page.waitForTimeout(80);
        await measure(page, `${key}|settings@${at}`, [".field"]);
      }
      await rowPads(page, `${key}|settings·여백`, "#sheetBody .field");
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll("#sheetBody .field__label, #sheetBody .field__note, #sheetBody .pick__value")]
          .filter((n) => {
            const row = n.closest(".field").getBoundingClientRect();
            const r = n.getBoundingClientRect();
            return n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 || r.top < row.top - 0.5 || r.bottom > row.bottom + 0.5;
          })
          .map((n) => n.textContent.trim()),
      );
      ok(`${key} 설정 이름·설명·선택 값 잘림 0`, cut.length === 0, cut.join(" / "));
      const netRow = await page.evaluate(async () => {
        const words = await (await fetch(`/i18n/${document.documentElement.lang || "ko"}.json`)).json().catch(() => ({}));
        const row = [...document.querySelectorAll("#sheetBody .field")].find((r) => r.querySelector(".field__note")?.textContent.includes("\n"));
        if (!row) return null;
        row.scrollIntoView({ block: "center" });
        const note = row.querySelector(".field__note");
        const range = document.createRange();
        range.selectNodeContents(note);
        const lines = [...range.getClientRects()].map((c) => Math.round(c.top)).filter((v, i, a) => a.indexOf(v) === i).length;
        return { label: row.querySelector(".field__label").textContent, note: note.textContent, parts: note.textContent.split("\n").length, lines, pre: getComputedStyle(note).whiteSpace, same: words["cfg.netOn.note"] === note.textContent };
      });
      ok(`${key} 멀티플레이 사용 설명 = 두 문장 줄바꿈(pre-line, 화면 ${netRow?.lines}줄)`, netRow && netRow.parts === 2 && netRow.pre === "pre-line" && netRow.lines >= 2 && !/재실행|restart|再起動|\bIP\b|Cloudflare/.test(netRow.note), JSON.stringify(netRow));
      if (lang === "ko" && viewport.width === 390 && netRow) {
        await page.waitForTimeout(150);
        await measure(page, `${key}|settings·멀티플레이`, [".field"]);
        await page.screenshot({ path: path.join(shots, "설정_멀티플레이사용_390x844.png") });
      }
      if (lang === "ko" && viewport.width === 390) {
        await page.evaluate(() => (document.getElementById("sheetBody").scrollTop = 0));
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(shots, "세로_390x844_설정.png") });
      }
      if (viewport.width === 390) await themeRows(page, key, lang === "ko" ? path.join(shots, "세로_390x844_설정_테마.png") : "");
      await context.close();
    }
  }
  const { context, page } = await aspectPage({ viewport: { width: 390, height: 844 }, dpr: 2, mobile: true }, {}, { prefs: { lang: "ko" } });
  const words = await (await fetch(new URL("/i18n/ko.json", URL_BASE))).json();
  for (const [sheet, selector, word, shot] of [
    ["library", ".lib__empty", "web.lib.empty", "세로_390x844_빈_라이브러리.png"],
    ["saves", "#sheetBody .empty", "web.save.empty", ""],
  ]) {
    await page.evaluate((name) => window.webgba.openSheet(name), sheet);
    await page.waitForTimeout(600);
    const info = await page.evaluate((selector) => {
      const n = document.querySelector(selector);
      const r = n.getBoundingClientRect();
      const host = n.parentElement.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(n);
      const lines = [...range.getClientRects()].map((c) => Math.round(c.top)).filter((v, i, a) => a.indexOf(v) === i).length;
      const text = range.getBoundingClientRect();
      return { text: n.textContent, align: getComputedStyle(n).textAlign, lines, left: +(text.left - host.left).toFixed(2), right: +(host.right - text.right).toFixed(2) };
    }, selector);
    ok(`빈 ${sheet}: 문구 '${words[word]}' · 가운데 정렬(좌우 여백 차이 ${Math.abs(info.left - info.right).toFixed(2)}px) · ${info.lines}줄`, info.text === words[word] && info.align === "center" && Math.abs(info.left - info.right) <= 1, JSON.stringify(info));
    await measure(page, `390x844|ko|빈 ${sheet}`, [selector]);
    if (shot) await page.screenshot({ path: path.join(shots, shot) });
    await page.click("#sheetClose");
    await page.waitForTimeout(300);
  }
  await context.close();
}

// 테마 옵션 줄: 커스텀 없음, 줄마다 대표 색 4개(바탕·면·강조·글자) 한 줄이 글자 좌측 — 견본 묶음 가운데 = 글자 잉크 가운데, 줄 위·아래 여백 같음(선택 줄 포함)
async function themeRows(page, key, shot) {
  const label = await page.evaluate(() => document.querySelectorAll("#sheetBody .field")[1].querySelector(".field__label").textContent);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#sheetBody .field")][1];
    row.scrollIntoView({ block: "center" });
    row.querySelector(".pick").dataset.uiPick = "1";
  });
  await page.click('[data-ui-pick="1"]');
  await page.waitForSelector("#choice:not([hidden]) .choice__opt");
  await page.waitForTimeout(350);
  const meta = await page.evaluate(async () => {
    const T = await import("/js/shell/theme.js");
    const rows = [...document.querySelectorAll(".choice__opt")];
    const want = T.MODES.filter((m) => m.id !== "custom").map((m) => m.id);
    const list = document.getElementById("choiceList").getBoundingClientRect();
    return {
      values: rows.map((r) => r.dataset.value),
      want,
      chips: rows
        .map((r) => {
          const preset = T.presetOf(r.dataset.value);
          const b = r.querySelector(".choice__swatch").getBoundingClientRect();
          return { value: r.dataset.value, want: ["--bg-sunken", "--bg", "--accent", "--text"].map((t) => preset[t].toLowerCase()), at: [0, 1, 2, 3].map((i) => [b.left + 7 + 16 * i, b.top + 7]), visible: b.top >= list.top && b.bottom <= list.bottom };
        })
        .filter((c) => c.visible),
      leftOf: rows.every((r) => r.querySelector(".choice__swatch").getBoundingClientRect().right < r.querySelector(".choice__label").getBoundingClientRect().left),
      gap: rows.map((r) => +(r.querySelector(".choice__label").getBoundingClientRect().left - r.querySelector(".choice__swatch").getBoundingClientRect().right).toFixed(2)),
    };
  });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const shown = await shoot(page);
  const hexAt = ([x, y]) => {
    const o = (Math.round(y * dpr) * shown.width + Math.round(x * dpr)) * 4;
    return "#" + [0, 1, 2].map((k) => shown.data[o + k].toString(16).padStart(2, "0")).join("");
  };
  const wrong = meta.chips.filter((c) => c.at.map(hexAt).join() !== c.want.join()).map((c) => `${c.value}: ${c.at.map(hexAt).join(",")} ≠ ${c.want.join(",")}`);
  ok(`${key} 테마 목록 ${meta.values.length}개 · 커스텀 없음 · 견본 4색 = 테마 토큰(바탕·면·강조·글자, 보이는 ${meta.chips.length}줄 픽셀) · 견본은 글자 좌측(간격 ${[...new Set(meta.gap)].join("/")}px)`, meta.values.join() === meta.want.join() && !meta.values.includes("custom") && meta.chips.length > 0 && wrong.length === 0 && meta.leftOf && new Set(meta.gap).size === 1, `${label} · ${wrong.join(" / ")}`);
  const seen = new Map();
  const total = meta.values.length;
  for (let round = 0; round < total && seen.size < total; round++) {
    const next = [...Array(total).keys()].find((i) => !seen.has(i));
    await page.evaluate((i) => document.querySelectorAll(".choice__opt")[i].scrollIntoView({ block: "nearest" }), next);
    await page.waitForTimeout(80);
    const image = await shoot(page);
    const rows = await page.evaluate(() => {
      const list = document.getElementById("choiceList").getBoundingClientRect();
      return [...document.querySelectorAll(".choice__opt")].map((r, i) => {
        const b = r.getBoundingClientRect();
        const st = getComputedStyle(r);
        const lab = r.querySelector(".choice__label").getBoundingClientRect();
        const sw = r.querySelector(".choice__swatch").getBoundingClientRect();
        return { i, value: r.dataset.value, selected: r.getAttribute("aria-selected") === "true", visible: b.top >= list.top - 0.5 && b.bottom <= list.bottom + 0.5, top: b.top, bottom: b.bottom - parseFloat(st.borderBottomWidth), lab: { left: lab.left, right: lab.right }, sw: { top: sw.top, bottom: sw.bottom } };
      });
    });
    for (const r of rows) {
      if (!r.visible || seen.has(r.i)) continue;
      const ink = inkCheck(image, dpr, { left: r.lab.left, right: r.lab.right, top: r.top, bottom: r.bottom, inset: 0 });
      const textMid = ink ? (r.top + r.bottom + ink.top - ink.bottom) / 2 : NaN;
      const swMid = (r.sw.top + r.sw.bottom) / 2;
      seen.set(r.i, { value: r.value, selected: r.selected, mid: +Math.abs(textMid - swMid).toFixed(2), top: +Math.min(ink?.top ?? Infinity, r.sw.top - r.top).toFixed(2), bottom: +Math.min(ink?.bottom ?? Infinity, r.bottom - r.sw.bottom).toFixed(2), swatch: `${+(r.sw.top - r.top).toFixed(2)}/${+(r.bottom - r.sw.bottom).toFixed(2)}`, height: +(r.bottom - r.top).toFixed(2) });
    }
  }
  const all = [...seen.values()];
  const mids = all.map((r) => r.mid);
  table.push({ key, target: "테마 견본·글자 가운데", top: 0, bottom: 0, diff: Math.max(...mids) });
  ok(`${key} 테마 줄 ${all.length}/${total}: 견본 묶음 가운데 = 글자 잉크 가운데(최대 차이 ${Math.max(...mids)}px, 선택 줄 포함)`, all.length === total && mids.every((v) => v === 0), JSON.stringify(all.filter((r) => r.mid !== 0)));
  // 줄 높이는 fitRows 가 글자 잉크 + 여백을 짝수 px 로 맞춘 값이라, 아래로 내려가는 획(g·p)이 있는 이름 줄은 2px 높고 여백이 0.5px 다를 수 있다
  const pads = all.flatMap((r) => [r.top, r.bottom]);
  const spread = +(Math.max(...pads) - Math.min(...pads)).toFixed(2);
  ok(`${key} 테마 줄마다 위 여백 = 아래 여백(차이 0, 선택 줄 포함) · 줄끼리 여백 차이 ${spread}px`, all.length === total && all.every((r) => r.top === r.bottom) && spread <= 0.5, JSON.stringify(all.map((r) => `${r.value}${r.selected ? "*" : ""}:${r.top}/${r.bottom} 높이 ${r.height}`)));
  if (shot) {
    await page.evaluate(() => (document.getElementById("choiceList").scrollTop = 0));
    await page.waitForTimeout(150);
    await page.screenshot({ path: shot });
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

if (ONLY_SETTEXT) await settextChecks();

// ── 설명서 언어별 이름(name·shortName = 문자열 또는 en·ko·ja 칸, 사용자 2026-11-04) ──
// 화면 언어 3종 × 이름 형태 9가지: 첫 화면 최근 줄·라이브러리 옆면·꺼낸 칸(이름 줄·앞면 라벨 글)의 표시 글, 칸 안(넘침 0), 잉크 가운데.
// 기대 글은 규격 순서(화면 언어 → en → ko → ja)대로 손으로 적은 값(구현 함수로 계산하지 않음).
const NAME_GAMES = [
  { id: "n-br2", form: "세 칸", title: { en: "Bloody Roar 2", ko: "동물철권 2", ja: "ブラッディロア2" }, show: { en: "Bloody Roar 2", ko: "동물철권 2", ja: "ブラッディロア2" } },
  { id: "n-dmn", form: "en 한 칸", title: { en: "Demon Front" }, show: "Demon Front" },
  { id: "n-kov", form: "ko·ja 두 칸", title: { ja: "三国戦紀 115", ko: "삼국전기 115" }, show: { en: "삼국전기 115", ko: "삼국전기 115", ja: "三国戦紀 115" } },
  { id: "n-kovs", form: "문자열", title: "Knights of Valour 115", show: "Knights of Valour 115" },
  { id: "n-bub", form: "ko 한 칸", title: { ko: "보글보글" }, show: "보글보글" },
  { id: "n-rapid", form: "세 칸 + 짧은 이름 en·ko", title: { en: "Pokémon Rapid", ko: "포켓몬스터 래피드", ja: "ポケモン ラピッド" }, shortName: { en: "Rapid", ko: "래피드" }, show: { en: "Pokémon Rapid", ko: "포켓몬스터 래피드", ja: "ポケモン ラピッド" }, spine: { en: "Rapid", ko: "래피드", ja: "Rapid" } },
  { id: "n-bb2", form: "ja 한 칸", title: { ja: "バブルボブルII" }, show: "バブルボブルII" },
  { id: "n-bb2two", form: "en·ko 두 칸", title: { ko: "보글보글 2", en: "Bubble Bobble II" }, show: { en: "Bubble Bobble II", ko: "보글보글 2", ja: "Bubble Bobble II" } },
  { id: "n-named", form: "사용자가 바꾼 이름", title: { en: "Bubble Bobble", ko: "보글보글", ja: "バブルボブル" }, named: "내 보글보글", show: "내 보글보글" },
];
const nameIn = (value, lang) => (typeof value === "string" ? value : value[lang]);
const NAME_VIEWS = [
  { viewport: { width: 390, height: 844 } },
  { viewport: { width: 844, height: 390 } },
  { viewport: { width: 320, height: 568 } },
].filter((view) => !VIEW_FILTER || VIEW_FILTER.has(`${view.viewport.width}x${view.viewport.height}`));

// 옆면 이름 칸(.spine__name) 안 잉크 상자: 글이 90° 돌아 있어 글의 세로 = 화면 가로(좌·우 여백), 글 방향 = 화면 세로(위·아래 여백).
// 기본 옆면은 몸통 그림(밝은 세로 띠 등)이 이름 칸에 겹쳐 바탕색 하나로 잴 수 없다 → 글을 숨긴 화면과 달라진 픽셀만 잉크로 본다.
function boxInk(image, bare, dpr, box) {
  const x0 = Math.round(box.l * dpr);
  const x1 = Math.round(box.r * dpr);
  const y0 = Math.round(box.t * dpr);
  const y1 = Math.round(box.b * dpr);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  let l = Infinity, r = -1, t = Infinity, b = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      if (Math.max(Math.abs(image.data[o] - bare.data[o]), Math.abs(image.data[o + 1] - bare.data[o + 1]), Math.abs(image.data[o + 2] - bare.data[o + 2])) <= INK_THRESHOLD) continue;
      l = Math.min(l, x);
      r = Math.max(r, x);
      t = Math.min(t, y);
      b = Math.max(b, y);
    }
  }
  if (r < 0) return null;
  const left = (l - x0) / dpr;
  const right = (x1 - 1 - r) / dpr;
  const top = (t - y0) / dpr;
  const bottom = (y1 - 1 - b) / dpr;
  return { left, right, top, bottom, across: Math.abs(left - right), along: Math.abs(top - bottom) };
}

async function namesChecks() {
  const shots = CAPTURE || SHOTS;
  for (const view of NAME_VIEWS) {
    for (const lang of LANGS) {
      const key = `${view.viewport.width}x${view.viewport.height}|${lang}|names`;
      const { context, page } = await aspectPage({ viewport: view.viewport, dpr: 2, mobile: true }, {}, { prefs: { lang } });
      await page.evaluate(async (games) => {
        const s = window.webgba.store;
        let t = Date.now();
        for (const [i, g] of games.entries()) {
          const meta = { id: g.id, name: `${g.named ?? g.id}.wgba`, file: `${g.id}.wgba`, type: "wgba", gameId: `dev.example.${g.id}`, version: "1.0.0", build: String(i % 10).repeat(64), title: g.title, shortName: g.shortName ?? "", author: "", romSha1: "", cart: { color: ["#2f6f5e", "#d9a02b", "#7a3fb0", "#b03a2e"][i % 4] } };
          if (g.named) meta.named = true;
          await s.putGame(meta, new Uint8Array(1024 + i), { carts: [] });
          await s.patch(s.romKey(g.id), { opened: (t -= 1000) });
        }
        await window.webgba.refreshStart();
      }, NAME_GAMES);
      await page.waitForTimeout(400);

      // 첫 화면 최근 줄(최근 연 순 = NAME_GAMES 순서)
      const start = await page.evaluate(() => {
        const box = (n) => {
          const r = n.getBoundingClientRect();
          return { l: r.left, r: r.right, t: r.top, b: r.bottom };
        };
        return [...document.querySelectorAll("#startList .recent__item")].filter((n) => !n.hidden).map((n) => {
          const name = n.querySelector(".recent__name");
          const label = n.querySelector(".pack__label");
          const text = n.querySelector(".pack__text");
          return { name: name.textContent, label: text?.textContent ?? null, nameBox: box(name), item: box(n), labelBox: label ? box(label) : null, textBox: text ? box(text) : null };
        });
      });
      const startWrong = start.map((item, i) => {
        const want = nameIn(NAME_GAMES[i].show, lang);
        return item.name === want && item.label === want ? "" : `${NAME_GAMES[i].form}: ${item.name} / ${item.label} ≠ ${want}`;
      }).filter(Boolean);
      ok(`${key} 첫 화면 최근 ${start.length}개 이름·앞면 라벨 글 = 규격 순서`, start.length >= 2 && startWrong.length === 0, startWrong.join(" / "));
      ok(`${key} 첫 화면 이름·라벨 글이 칸 안(넘침 0)`, start.every((item) => within([item.nameBox], item.item) && (!item.labelBox || within([item.textBox], item.labelBox))), JSON.stringify(start.map((item) => item.textBox)));
      await measure(page, `${key}|start`, [".recent__name", "#startList .pack__label"]);

      // 라이브러리 옆면: 표시 글(aria-label = 이름, 줄 글 = 짧은 이름 → 이름), 칸 안, 잉크 가운데
      await page.evaluate(() => window.webgba.openSheet("library"));
      await page.waitForSelector("#sheet:not([hidden]) .lib__case .spine");
      await page.waitForTimeout(400);
      await fits(page, `${key}|library`, ".sheet__panel");
      const spines = await page.evaluate((ids) =>
        ids.map((id) => {
          const node = document.querySelector(`.lib__case .spine[data-key="rom:${id}"]`);
          const area = node?.querySelector(".spine__name");
          if (!area) return null;
          const a = area.getBoundingClientRect();
          return {
            label: node.getAttribute("aria-label"),
            lines: [...area.querySelectorAll(".spine__line")].map((n) => n.textContent),
            outside: [...area.querySelectorAll(".spine__line")].filter((n) => {
              const r = n.getBoundingClientRect();
              return r.left < a.left - 0.5 || r.right > a.right + 0.5 || r.top < a.top - 0.5 || r.bottom > a.bottom + 0.5;
            }).length,
          };
        }),
      NAME_GAMES.map((g) => g.id));
      const flat = (text) => text.replace(/\s+/g, "");
      const spineWrong = spines.map((s, i) => {
        const g = NAME_GAMES[i];
        const want = nameIn(g.show, lang);
        const wantSpine = nameIn(g.spine ?? g.show, lang);
        if (!s) return `${g.form}: 옆면 없음`;
        const got = flat(s.lines.join(""));
        const cut = got.endsWith("…");
        const textOk = cut ? flat(wantSpine).startsWith(got.slice(0, -1)) && got.length > 1 : got === flat(wantSpine);
        return s.label === want && textOk ? "" : `${g.form}: ${s.label} · ${s.lines.join("|")} ≠ ${want} · ${wantSpine}`;
      }).filter(Boolean);
      ok(`${key} 옆면 ${spines.length}개 이름(aria-label)·세로 글(짧은 이름 → 이름) = 규격 순서`, spineWrong.length === 0, spineWrong.join(" / "));
      ok(`${key} 옆면 세로 글이 이름 칸 안(넘침 0)`, spines.every((s) => s && s.outside === 0), JSON.stringify(spines.map((s) => s?.outside)));
      const measured = new Set();
      for (let round = 0; round < NAME_GAMES.length && measured.size < NAME_GAMES.length; round++) {
        const next = NAME_GAMES.find((g) => !measured.has(g.id));
        await page.$eval(`.lib__case .spine[data-key="rom:${next.id}"]`, (n) => n.scrollIntoView({ block: "nearest" }));
        await page.waitForTimeout(80);
        const image = await shoot(page);
        const hide = await page.addStyleTag({ content: ".spine__text{visibility:hidden !important}" });
        const bare = await shoot(page);
        await hide.evaluate((node) => node.remove());
        const dpr = await page.evaluate(() => devicePixelRatio);
        const seen = await page.evaluate((ids) => {
          const vh = window.visualViewport?.height ?? innerHeight;
          return ids.map((id) => {
            const area = document.querySelector(`.lib__case .spine[data-key="rom:${id}"] .spine__name`);
            const r = area.getBoundingClientRect();
            let top = 0, bottom = vh;
            for (let at = area.parentElement; at; at = at.parentElement) {
              const o = getComputedStyle(at).overflowY;
              if (o === "auto" || o === "hidden" || o === "scroll") {
                const c = at.getBoundingClientRect();
                top = Math.max(top, c.top);
                bottom = Math.min(bottom, c.bottom);
              }
            }
            return r.top >= top - 0.5 && r.bottom <= bottom + 0.5 && r.left >= 0 && r.right <= innerWidth ? { id, l: r.left, r: r.right, t: r.top, b: r.bottom } : null;
          });
        }, NAME_GAMES.map((g) => g.id));
        for (const box of seen) {
          if (!box || measured.has(box.id)) continue;
          measured.add(box.id);
          const m = boxInk(image, bare, dpr, box);
          const form = NAME_GAMES.find((g) => g.id === box.id).form;
          if (!m) {
            ok(`${key} 옆면 ${form} 잉크 있음`, false);
            continue;
          }
          table.push({ key, target: `spine__name ${form}(글 세로 = 화면 가로)`, top: m.left, bottom: m.right, diff: m.across });
          table.push({ key, target: `spine__name ${form}(글 방향 = 화면 세로)`, top: m.top, bottom: m.bottom, diff: m.along });
          ok(`${key} 옆면 ${form} 잉크 가운데(글 세로·글 방향)`, m.across <= 1 && m.along <= 1, `좌 ${m.left} · 우 ${m.right} · 위 ${m.top} · 아래 ${m.bottom}`);
        }
      }

      // 꺼낸 칸: 이름 줄·앞면 라벨 글, 칸 안, 잉크 가운데
      for (const g of NAME_GAMES) {
        if ((await page.getAttribute(".lib__card", "data-key")) !== `rom:${g.id}`) {
          await page.$eval(`.lib__case .spine[data-key="rom:${g.id}"]`, (n) => n.click());
          await page.waitForTimeout(200);
        }
        const card = await page.evaluate(() => {
          const box = (n) => {
            const r = n.getBoundingClientRect();
            return { l: r.left, r: r.right, t: r.top, b: r.bottom };
          };
          const card = document.querySelector(".lib__card");
          const name = card.querySelector(".lib__name");
          const label = card.querySelector(".pack__label");
          const text = card.querySelector(".pack__text");
          return { key: card.dataset.key, name: name?.textContent ?? null, label: text?.textContent ?? null, nameBox: name ? box(name) : null, line: name ? box(name.closest(".lib__line") ?? card) : null, labelBox: label ? box(label) : null, textBox: text ? box(text) : null, scroll: card.scrollWidth - card.clientWidth };
        });
        const want = nameIn(g.show, lang);
        ok(`${key} 꺼낸 칸 ${g.form}: 이름 줄·앞면 라벨 글 = ${want}`, card.key === `rom:${g.id}` && card.name === want && card.label === want, `${card.key} · ${card.name} · ${card.label}`);
        ok(`${key} 꺼낸 칸 ${g.form}: 이름·라벨 글이 칸 안(넘침 0)`, card.nameBox && within([card.nameBox], card.line) && card.textBox && within([card.textBox], card.labelBox) && card.scroll <= 0, JSON.stringify({ name: card.nameBox, line: card.line, text: card.textBox, label: card.labelBox, scroll: card.scroll }));
        await measure(page, `${key}|card|${g.id}`, [".lib__card .lib__name", ".lib__card .pack__label"]);
        if (lang === "ko" && view.viewport.width === 390 && g.id === "n-rapid") await page.screenshot({ path: path.join(shots, "언어별이름_라이브러리_390x844_ko.png") });
      }
      ok(`${key} 페이지 오류 없음`, page.errors.length === 0, page.errors.join(" | "));
      await context.close();
    }
  }
}

if (ONLY_NAMES) await namesChecks();

const WK_VIEW = LIB_VIEWS.find((view) => view.name === "390x844") ?? LIB_VIEWS[0];
if (LIBRARY && WK_VIEW) {
  for (const view of LIB_VIEWS) await libraryMotion("chromium", browser, view, { shots: view.name === "390x844" });
  let wk = null;
  try {
    wk = await webkit.launch({ headless: true });
  } catch (error) {
    console.log(`WebKit 없음 — WebKit 라이브러리 움직임 시험 건너뜀 (${error.message.split("\n")[0]})`);
  }
  if (wk) {
    await libraryMotion("webkit", wk, WK_VIEW);
    await wk.close();
  }
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

// ── 선택 칸 옵션 목록(아래에서 올라오는 시트, main.js openChoice) ──
// 설정의 선택 칸마다: 열면 제목 = 항목 이름·listbox/option·현재 값 하나만 aria-selected·초점 = 현재 값(목록 안에 보임)·화면 안·겹침 0·잉크 가운데·줄 여백 같음,
// 다른 값을 누르면 바로 반영(칸 글자·설정 저장)되고 닫힘(설정 시트는 그대로). 키보드(Enter·↑↓·Home·End·Esc·Tab), 게임패드(↓·A·B),
// 닫기 단추·바깥 누르기·뒤로 가기(옵션 목록만 닫히고, 다음 뒤로 가기에 설정 시트), 열기 움직임(transform·opacity 200ms), 6배 느린 CPU 열기 시간, WebKit 한 번.
if (CHOICE) {
  const CHOICE_VIEWS = [
    { name: "320x568", viewport: { width: 320, height: 568 } },
    { name: "390x844", viewport: { width: 390, height: 844 } },
    { name: "844x390", viewport: { width: 844, height: 390 } },
  ];
  const choicePage = async (launcher, engine, viewport, motion = false) => {
    const context = await launcher.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2, reducedMotion: motion ? "no-preference" : "reduce", ...(engine === "chromium" ? { isMobile: true } : {}) });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko" }));
      window.__pads = [];
      Object.defineProperty(navigator, "getGamepads", { value: () => window.__pads, configurable: true });
    });
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.goto(URL_BASE);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await page.waitForSelector("#sheet:not([hidden])");
    await page.waitForTimeout(300);
    return { context, page };
  };
  const picks = (page) => page.evaluate(() => [...document.querySelectorAll("#sheetBody .pick")].map((p) => ({ label: p.getAttribute("aria-label"), value: p.dataset.value, text: p.querySelector(".pick__value").textContent, options: [...p.querySelectorAll(".pick__size")].map((s) => s.textContent) })));
  const markPick = (page, index) =>
    page.evaluate((index) => {
      for (const node of document.querySelectorAll("[data-test-pick]")) delete node.dataset.testPick;
      const pick = document.querySelectorAll("#sheetBody .pick")[index];
      pick.dataset.testPick = "1";
      pick.scrollIntoView({ block: "center" });
    }, index);
  const openAt = async (page, index) => {
    await markPick(page, index);
    await page.click("[data-test-pick]");
    await page.waitForSelector("#choice:not([hidden]) .choice__opt");
    await page.waitForTimeout(60);
  };
  const closed = (page) => page.waitForFunction(() => !window.webgba.state.choiceDone && document.getElementById("choice").hidden, null, { timeout: 3000 }).then(() => true, () => false);
  const choiceState = (page) =>
    page.evaluate(() => {
      const panel = document.querySelector(".choice__panel").getBoundingClientRect();
      const list = document.getElementById("choiceList");
      const lr = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll(".choice__opt")];
      const focus = document.activeElement;
      const fr = focus?.getBoundingClientRect?.();
      const boxes = rows.map((r) => r.getBoundingClientRect());
      return {
        open: !document.getElementById("choice").hidden && Boolean(window.webgba.state.choiceDone),
        title: document.getElementById("choiceTitle").textContent,
        role: list.getAttribute("role"),
        roles: rows.every((r) => r.getAttribute("role") === "option"),
        count: rows.length,
        labels: rows.map((r) => r.textContent),
        values: rows.map((r) => r.dataset.value),
        selected: rows.filter((r) => r.getAttribute("aria-selected") === "true").map((r) => r.dataset.value),
        focusValue: focus?.classList?.contains("choice__opt") ? focus.dataset.value : null,
        focusClose: focus?.id === "choiceClose",
        padFocus: rows.filter((r) => r.classList.contains("is-focus")).map((r) => r.dataset.value),
        focusVisible: fr ? fr.top >= lr.top - 0.5 && fr.bottom <= lr.bottom + 0.5 : false,
        inside: panel.top >= -0.5 && panel.bottom <= (window.visualViewport?.height ?? innerHeight) + 0.5 && panel.left >= -0.5 && panel.right <= innerWidth + 0.5,
        overlap: boxes.some((b, i) => i && b.top < boxes[i - 1].bottom - 0.5),
        sheet: window.webgba.state.sheet,
        sheetShown: !document.getElementById("sheet").hidden && !document.getElementById("sheet").classList.contains("is-closing"),
        expanded: document.querySelector('.pick[aria-expanded="true"]')?.getAttribute("aria-label") ?? "",
      };
    });
  const prefsOf = (page) => page.evaluate(() => localStorage.getItem("webgba.prefs"));
  const pickAt = (page, index) => page.evaluate((index) => { const p = document.querySelectorAll("#sheetBody .pick")[index]; return { value: p.dataset.value, text: p.querySelector(".pick__value").textContent, label: p.getAttribute("aria-label"), focused: document.activeElement === p }; }, index);
  const choose = async (page, index, value) => {
    await openAt(page, index);
    await page.click(`.choice__opt[data-value="${value}"]`);
    return closed(page);
  };
  const autoIndex = async (page) => (await picks(page)).findIndex((p) => p.options.length === 7);

  for (const view of CHOICE_VIEWS) {
    const { context, page } = await choicePage(browser, "chromium", view.viewport);
    const base = `${view.name}|ko|choice`;
    const list = await picks(page);
    ok(`${base} 설정 선택 칸 ${list.length}개(표시 언어·테마·방향 입력·가상 버튼·게임 재생 속도·자동 저장·방향키 동시 누름) · 기본 select 0`, list.length === 7 && (await page.evaluate(() => document.querySelectorAll("select").length)) === 0, list.map((p) => p.label).join(", "));
    for (const [index, item] of list.entries()) {
      const before = await pickAt(page, index);
      await markPick(page, index);
      const shutEdge = await page.evaluate(() => { const b = document.querySelector("[data-test-pick]").getBoundingClientRect(); return [b.top, b.bottom]; });
      await openAt(page, index);
      const openEdge = await page.evaluate(() => { const b = document.querySelector("[data-test-pick]").getBoundingClientRect(); return [b.top, b.bottom]; });
      const st = await choiceState(page);
      const key = `${base}|${index}`;
      ok(`${key} "${before.label}" 선택 칸 열림(aria-expanded) 상태에도 위·아래 그대로`, Math.abs(shutEdge[0] - openEdge[0]) <= 0.5 && Math.abs(shutEdge[1] - openEdge[1]) <= 0.5, JSON.stringify({ shutEdge, openEdge }));
      ok(
        `${key} "${before.label}" 열기: 제목·listbox/option·옵션 ${item.options.length}개·현재 값만 선택·초점 = 현재 값(보임)·화면 안·겹침 0·설정 시트 그대로·aria-expanded`,
        st.open && st.title === before.label && st.role === "listbox" && st.roles && st.count === item.options.length && st.labels.join("|") === item.options.join("|") && st.selected.join() === before.value && st.focusValue === before.value && st.focusVisible && st.inside && !st.overlap && st.sheet === "settings" && st.sheetShown && st.expanded === before.label,
        JSON.stringify({ ...st, labels: undefined, values: undefined }),
      );
      await fits(page, key, ".choice__panel");
      await measure(page, key, ["#choice .sheet__head", ".choice__opt"]);
      const choicePads = await rowPads(page, `${key}·여백`, ".choice__opt");
      if (view.name === "390x844" && index === 1) padTable.push({ key: `${view.name}|ko|옵션 목록(테마)`, pads: choicePads });
      const at = st.values.indexOf(before.value);
      const target = st.values[(at + 1) % st.values.length];
      const targetLabel = st.labels[(at + 1) % st.values.length];
      const prefsBefore = await prefsOf(page);
      await page.click(`.choice__opt[data-value="${target}"]`);
      const shut = await closed(page);
      await page.waitForTimeout(150);
      const after = await pickAt(page, index);
      const sheetAfter = await page.evaluate(() => window.webgba.state.sheet);
      ok(`${key} 다른 값 누르면 바로 반영·닫힘·저장·설정 시트 그대로(${before.text} → ${after.text})`, shut && after.value === target && (index === 0 || after.text === targetLabel) && (await prefsOf(page)) !== prefsBefore && sheetAfter === "settings", JSON.stringify({ shut, after, target, targetLabel, sheetAfter }));
      ok(`${key} 닫은 뒤 초점이 그 칸으로`, index <= 1 || after.focused, JSON.stringify(after));
      const back = await choose(page, index, before.value);
      const restored = await pickAt(page, index);
      ok(`${key} 처음 값으로 되돌림`, back && restored.value === before.value, JSON.stringify(restored));
    }

    const auto = await autoIndex(page);
    const autoBefore = await pickAt(page, auto);
    await markPick(page, auto);
    await page.focus("[data-test-pick]");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#choice:not([hidden]) .choice__opt");
    const k0 = await choiceState(page);
    await page.keyboard.press("ArrowDown");
    const k1 = await choiceState(page);
    await page.keyboard.press("Enter");
    const kShut = await closed(page);
    const kAfter = await pickAt(page, auto);
    const nextValue = k0.values[k0.values.indexOf(autoBefore.value) + 1];
    ok(`${base} 키보드: Enter 로 열기(초점 = 현재 값) → ↓ 다음 값 → Enter 고르고 닫힘 · 초점 칸으로`, k0.focusValue === autoBefore.value && k1.focusValue === nextValue && kShut && kAfter.value === nextValue && kAfter.focused, JSON.stringify({ k0: k0.focusValue, k1: k1.focusValue, kAfter }));
    await page.keyboard.press("ArrowUp");
    await page.waitForSelector("#choice:not([hidden]) .choice__opt");
    await page.keyboard.press("End");
    const kEnd = await choiceState(page);
    await page.keyboard.press("Home");
    const kHome = await choiceState(page);
    await page.keyboard.press("Tab");
    const kTab1 = await choiceState(page);
    await page.keyboard.press("Tab");
    const kTab2 = await choiceState(page);
    await page.keyboard.press("Escape");
    const escShut = await closed(page);
    const escAfter = await pickAt(page, auto);
    ok(
      `${base} 키보드: 칸에서 ↑ 로 열기 · End 끝 · Home 처음 · Tab 은 닫기 단추 ↔ 목록 안에서만 · Esc 닫힘(값 그대로·초점 칸으로·설정 시트 그대로)`,
      kEnd.focusValue === kEnd.values.at(-1) && kHome.focusValue === kHome.values[0] && kTab1.focusClose && kTab2.focusValue === kHome.values[0] && escShut && escAfter.value === nextValue && escAfter.focused && (await page.evaluate(() => window.webgba.state.sheet)) === "settings",
      JSON.stringify({ end: kEnd.focusValue, home: kHome.focusValue, tab1: kTab1.focusClose, tab2: kTab2.focusValue, escAfter }),
    );
    await choose(page, auto, autoBefore.value);

    await openAt(page, auto);
    await page.click("#choiceClose");
    const xShut = await closed(page);
    await openAt(page, auto);
    await page.mouse.click(view.viewport.width / 2, 12);
    const outShut = await closed(page);
    const outSheet = await page.evaluate(() => window.webgba.state.sheet);
    await openAt(page, auto);
    await page.goBack();
    const histShut = await closed(page);
    const histSheet = await page.evaluate(() => window.webgba.state.sheet);
    await page.goBack();
    await page.waitForTimeout(400);
    const sheetGone = await page.evaluate(() => window.webgba.state.sheet === "" && !window.webgba.state.choiceDone);
    ok(`${base} 닫기 단추·바깥 누르기·뒤로 가기로 옵션 목록만 닫힘, 다음 뒤로 가기에 설정 시트 닫힘`, xShut && outShut && outSheet === "settings" && histShut && histSheet === "settings" && sheetGone, JSON.stringify({ xShut, outShut, outSheet, histShut, histSheet, sheetGone }));
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await page.waitForTimeout(300);
    await choose(page, auto, "10");
    await page.goBack();
    await page.waitForTimeout(400);
    ok(`${base} 고른 뒤 뒤로 가기 한 번에 설정 시트 닫힘(남는 기록 0)`, await page.evaluate(() => window.webgba.state.sheet === ""), "");
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await page.waitForTimeout(300);
    await choose(page, auto, autoBefore.value);

    if (view.name === "390x844") {
      const pad = (pressed) => page.evaluate((pressed) => (window.__pads = [{ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [0, 0, 0, 0] }]), pressed);
      await openAt(page, auto);
      const g0 = await choiceState(page);
      await pad([13]);
      await page.waitForTimeout(80);
      await pad([]);
      await page.waitForTimeout(80);
      const g1 = await choiceState(page);
      await pad([0]);
      await page.waitForTimeout(80);
      await pad([]);
      const gShut = await closed(page);
      const gAfter = await pickAt(page, auto);
      const gNext = g0.values[g0.values.indexOf(autoBefore.value) + 1];
      await openAt(page, auto);
      await pad([1]);
      await page.waitForTimeout(80);
      await pad([]);
      const gBack = await closed(page);
      const gKeep = await pickAt(page, auto);
      ok(`${base} 게임패드: ↓ 다음 값(초점 표시) · A 고르고 닫힘 · B 그대로 닫힘`, g1.focusValue === gNext && g1.padFocus.join() === gNext && gShut && gAfter.value === gNext && gBack && gKeep.value === gNext, JSON.stringify({ g1: g1.focusValue, pad: g1.padFocus, gAfter, gKeep }));
      await choose(page, auto, autoBefore.value);
      const themeAt = list.findIndex((p) => p.options.length >= 10);
      await openAt(page, themeAt);
      await page.screenshot({ path: path.join(SHOTS, "세로_390x844_선택목록_테마.png") });
      await page.click("#choiceClose");
      await closed(page);
    }
    ok(`${base} 페이지 오류 없음`, page.errors.length === 0, page.errors.join(" | "));
    await context.close();
  }

  {
    const { context, page } = await choicePage(browser, "chromium", { width: 390, height: 844 }, true);
    const themeAt = (await picks(page)).findIndex((p) => p.options.length >= 10);
    await markPick(page, themeAt);
    await page.waitForTimeout(100);
    const anim = await page.evaluate(async () => {
      document.querySelector("[data-test-pick]").click();
      const shown = document.getElementById("choice");
      const runs = [shown, shown.querySelector(".choice__panel")].map((n) => n.getAnimations().map((a) => ({ name: a.animationName, ms: a.effect.getTiming().duration })));
      await new Promise((done) => setTimeout(done, 300));
      return { runs, sheet: !document.getElementById("sheet").hidden && document.getElementById("sheet").getAnimations().length === 0 };
    });
    ok("옵션 목록 열기 움직임: 바탕 fade-in·판 rise-in(transform·opacity) 200ms, 뒤 설정 시트는 움직이지 않음", anim.runs[0][0]?.name === "fade-in" && anim.runs[1][0]?.name === "rise-in" && anim.runs.every((r) => r[0]?.ms === 200) && anim.sheet, JSON.stringify(anim));
    await page.click("#choiceClose");
    await closed(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    const times = [];
    for (let i = 0; i < 6; i++) {
      times.push(
        await page.evaluate(async () => {
          const pick = document.querySelector("[data-test-pick]");
          const t0 = performance.now();
          pick.click();
          const t1 = performance.now();
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          const t2 = performance.now();
          window.webgba.state.choiceDone?.(null);
          await new Promise((done) => setTimeout(done, 400));
          return { handler: +(t1 - t0).toFixed(1), frame: +(t2 - t0).toFixed(1) };
        }),
      );
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const mid = (key) => times.map((x) => x[key]).sort((a, b) => a - b)[Math.floor(times.length / 2)];
    ok(`6배 느린 CPU: 테마 옵션 목록 열기 처리 가운데값 ${mid("handler")}ms · 다음 두 프레임까지 ${mid("frame")}ms(6번)`, mid("handler") <= 50, JSON.stringify(times));
    fs.writeFileSync(path.join(SHOTS, "선택목록_열기시간_6배.json"), JSON.stringify(times, null, 2));
    await context.close();
  }

  let wkChoice = null;
  try {
    wkChoice = await webkit.launch({ headless: true });
  } catch (error) {
    console.log(`WebKit 없음 — WebKit 옵션 목록 시험 건너뜀 (${error.message.split("\n")[0]})`);
  }
  if (wkChoice) {
    const { context, page } = await choicePage(wkChoice, "webkit", { width: 390, height: 844 });
    const auto = await autoIndex(page);
    const before = await pickAt(page, auto);
    await openAt(page, auto);
    const st = await choiceState(page);
    const target = st.values[(st.values.indexOf(before.value) + 1) % st.values.length];
    await page.click(`.choice__opt[data-value="${target}"]`);
    const shut = await closed(page);
    const after = await pickAt(page, auto);
    await openAt(page, auto);
    await page.keyboard.press("Escape");
    const esc = await closed(page);
    ok("WebKit: 옵션 목록 열기(초점 = 현재 값·화면 안)·고르기·Esc 닫기", st.open && st.focusValue === before.value && st.inside && shut && after.value === target && esc && page.errors.length === 0, JSON.stringify({ focus: st.focusValue, inside: st.inside, shut, after, esc, errors: page.errors }));
    await context.close();
    await wkChoice.close();
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
if (padTable.length) fs.writeFileSync(path.join(SHOTS, "줄여백_표.txt"), padTable.map(({ key, pads }) => [key, ...pads.map((p) => `  ${p.label}: 위 ${p.top} · 아래 ${p.bottom} · 같은 줄 가운데 차이 ${p.align}`)].join("\n")).join("\n\n"));
console.log(`잉크 측정 ${table.length}곳 · 최대 차이 ${Math.max(0, ...table.map((r) => r.diff))}px`);
console.log(`결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
