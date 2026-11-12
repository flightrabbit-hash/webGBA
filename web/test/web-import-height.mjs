// 웹 관리자 "롬 가져오기" 팝업 높이 고정 시험(로컬 전용 — 목록 응답 흉내, 실제 R2·Vercel 안 씀).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-import-height.mjs --dist <웹 빌드> --shots <캡처 폴더> [--out <결과 json>]
// 필터(전체·에뮬·아케이드·모바일)를 바꿔도 팝업 높이·하단 버튼 위치가 같은지(px 차이 0), 모바일 375×812·PC 1280×800 각각.
// 관리자 기록은 형식만 맞춘 가짜 토큰, 목록(/api/v1/admin/list)은 브라우저 안에서 가로채 흉내 응답. PC 밖 요청은 모두 막고 센다.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const { encode: encodePng } = createRequire(import.meta.url)("../../tools/test/png.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8798;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const INDEX_URL = "http://127.0.0.1:9599/index.json";
fs.mkdirSync(opt.shots, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const rgba = Buffer.alloc(96 * 64 * 4);
for (let i = 0; i < 96 * 64; i++) rgba.set(i % 96 < 48 ? [220, 80, 60, 255] : [60, 120, 220, 255], i * 4);
const LABEL = `data:image/png;base64,${Buffer.from(encodePng(rgba, 96, 64)).toString("base64")}`;
const entry = (id, name, group) => ({ key: `wgba/${id}/1.0.0.wgba`, id, version: "1.0.0", names: { ko: name, en: name }, size: 3000000, file: `${id}_1.0.0.wgba`, label: LABEL, ...(group ? { group } : {}) });
const ITEMS = [entry("io.example.emu", "에뮬 하나", ""), ...Array.from({ length: 38 }, (_, i) => entry(`io.example.arc${String(i).padStart(2, "0")}`, `아케이드 ${i + 1}`, "arcade"))];
const RECORD = { token: `a1.${"k3x9"}.${"m2p7"}.${"A".repeat(32)}`, at: Date.now() - 60000, until: Date.now() + 86400000, updated: "" };

const web = spawn(process.execPath, [path.join(repo, "web", "tools", "serve.mjs"), opt.dist, String(WEB_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => web.stdout.once("data", resolve));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const outside = [];
const errors = [];

async function measure(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("dialog");
    const card = dialog.querySelector(".dialog__card").getBoundingClientRect();
    const s = getComputedStyle(dialog);
    const room = dialog.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
    const acts = [...document.querySelectorAll("#dialogActions .btn")].map((b) => b.getBoundingClientRect());
    const groups = [...document.querySelectorAll("#dialog .lib__groups .btn")].map((b) => b.getBoundingClientRect());
    const rows = [...document.querySelectorAll("#dialog .upick__item")].filter((li) => !li.hidden).map((li) => {
      const r = li.getBoundingClientRect();
      const cs = getComputedStyle(li);
      return { h: r.height, padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom) };
    });
    const spread = (list, k) => (list.length ? Math.max(...list.map((r) => r[k])) - Math.min(...list.map((r) => r[k])) : 0);
    const empty = document.querySelector("#dialog .dialog__body > p.anote:not(:first-child)");
    return {
      cardTop: card.top,
      cardH: card.height,
      room,
      btnTop: acts.map((r) => r.top),
      btnSpread: { top: spread(acts, "top"), bottom: spread(acts, "bottom") },
      groupSpread: { top: spread(groups, "top"), bottom: spread(groups, "bottom"), height: spread(groups, "height") },
      rows: rows.length,
      rowH: spread(rows, "h"),
      rowPad: rows.every((r) => r.padTop === r.padBottom),
      emptyShown: Boolean(empty && !empty.hidden),
    };
  });
}

async function runViewport(name, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript(([url, record]) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.updateTest", JSON.stringify({ index: { url, key: "" } }));
    localStorage.setItem("webgba.installHint", "1");
    localStorage.setItem("webgba.admin", JSON.stringify(record));
    const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
    localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang: "ko", adminGroup: "all" }));
  }, [INDEX_URL, RECORD]);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.origin === WEB && url.pathname === "/api/v1/admin/list") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: ITEMS }) });
    if (url.origin === WEB && url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (url.href === INDEX_URL) return route.fulfill({ status: 404, body: "" });
    if (url.origin === WEB) return route.continue();
    outside.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  try {
    await page.goto(WEB);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
    await page.evaluate(() => window.webgba.openSheet("library"));
    await page.waitForSelector('[data-action="admin-import"]', { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.click('[data-action="admin-import"]');
    await page.waitForSelector("#dialog .upick__item", { timeout: 20000 });
    await page.waitForTimeout(400);
    const seen = {};
    for (const id of ["all", "emu", "arcade", "mobile", "all"]) {
      await page.click(`#dialog .lib__groups [data-group="${id}"]`);
      await page.waitForTimeout(250);
      const m = await measure(page);
      seen[id] = m;
      if (name === "모바일" && id === "emu") await page.screenshot({ path: path.join(opt.shots, "모바일_에뮬.png") });
    }
    const all = Object.values(seen);
    const spread = (k) => Math.max(...all.map((m) => m[k])) - Math.min(...all.map((m) => m[k]));
    const btnTops = all.flatMap((m) => m.btnTop);
    const btnTopSpread = Math.max(...btnTops) - Math.min(...btnTops);
    const summary = Object.entries(seen).map(([id, m]) => `${id}:${m.rows}줄 h${m.cardH} top${m.cardTop} 버튼${m.btnTop.join("/")}`).join(" · ");
    ok(`${name} ${width}×${height} 필터 4개 팝업 높이·위치 같음(px 차이 0)`, spread("cardH") === 0 && spread("cardTop") === 0, summary);
    ok(`${name} 하단 버튼(닫기·다운로드) top 같음(px 차이 0)`, btnTopSpread === 0 && all.every((m) => m.btnSpread.top === 0 && m.btnSpread.bottom === 0), `top 차이 ${btnTopSpread}`);
    ok(`${name} 높이 = 최대 높이(팝업 칸 안쪽 높이)`, all.every((m) => Math.abs(m.cardH - m.room) < 0.5), `팝업 ${seen.all.cardH} · 칸 ${seen.all.room}`);
    ok(`${name} 빈 목록(모바일 0개)도 같은 높이 · 빈 목록 문구 표시`, seen.mobile.rows === 0 && seen.mobile.emptyShown && seen.mobile.cardH === seen.arcade.cardH, `모바일 ${seen.mobile.cardH} · 아케이드 ${seen.arcade.cardH}`);
    ok(`${name} 그룹 버튼 상단·하단·높이 일치 · 목록 항목 높이·상하 여백 같음`, all.every((m) => m.groupSpread.top === 0 && m.groupSpread.bottom === 0 && m.groupSpread.height === 0 && m.rowH === 0 && m.rowPad), JSON.stringify({ group: seen.emu.groupSpread, rowH: seen.arcade.rowH }));
    const loose = await page.evaluate(async () => {
      const node = document.querySelector("#dialog .upick--fill");
      node.classList.remove("upick--fill");
      document.querySelector('#dialog .lib__groups [data-group="emu"]').click();
      await new Promise((r) => setTimeout(r, 250));
      const h = document.querySelector("#dialog .dialog__card").getBoundingClientRect().height;
      node.classList.add("upick--fill");
      document.querySelector('#dialog .lib__groups [data-group="all"]').click();
      await new Promise((r) => setTimeout(r, 250));
      return h;
    });
    ok(`${name} 대조: 고정 표시를 빼면 에뮬 1개 팝업이 줄어듦(시험이 차이를 잡는지)`, loose < seen.emu.cardH - 1, `고정 ${seen.emu.cardH} · 뺀 상태 ${loose}`);
  } finally {
    await context.close();
  }
}

try {
  await runViewport("모바일", 375, 812);
  await runViewport("PC", 1280, 800);
  ok("PC 밖 요청 0(모두 route 로 막음)", true, outside.length ? `막은 요청 ${outside.length}개: ${[...new Set(outside.map((u) => new URL(u).host))].join(", ")}` : "시도 0");
  ok("화면 오류 없음", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  web.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
