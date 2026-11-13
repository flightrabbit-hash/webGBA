// 웹 라이브러리: 그룹·정렬 버튼을 바꿔도 꺼낸 롬팩(상단 칸) 유지 시험(로컬 전용 — 업데이트 목록은 가로챈 흉내, PC 밖 요청은 모두 막고 셈).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-library-keep-select.mjs --dist <웹 빌드> --shots <캡처 폴더> [--out <결과 json>]
// 아케이드에서 고른 게임 → 에뮬(+정렬 1회) → 모바일 → 전체 → 아케이드: 매번 상단 칸 이름·대상 키 그대로, 책장 선택 표시는 그 게임이 있는 그룹에서만.
// 넣어 둔 상태(빈 칸)도 그룹 바꾸기에서 유지 · 닫았다 다시 열면 이전 규칙(현재 그룹에 없으면 첫 게임).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { publicOf, signText } from "../../tools/lib/update-cmds.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8831;
const WEB = `http://127.0.0.1:${WEB_PORT}/`;
const INDEX_URL = "http://127.0.0.1:9631/index.json";
fs.mkdirSync(opt.shots, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PUB = publicOf(privateKey);
const GROUPS = {
  "dev.example.star": { group: "emu", category: "GBA" },
  "dev.example.arc": { group: "arcade", category: "CPS1" },
  "dev.example.neo": { group: "arcade", category: "NeoGeo" },
  "dev.example.mob": { group: "mobile", category: "WIPI" },
};
const signedText = JSON.stringify({ time: "2026-11-13T00:00:00Z", feeds: {}, groups: GROUPS });
const INDEX_TEXT = JSON.stringify({ wgbaIndex: 1, signed: signedText, signature: signText(signedText, privateKey), feeds: {} });

const server = spawn(process.execPath, [path.join(repo, "web", "tools", "serve.mjs"), opt.dist, String(WEB_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => server.stdout.once("data", resolve));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const outside = [];

try {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url === INDEX_URL) return route.fulfill({ status: 200, contentType: "application/json", body: INDEX_TEXT });
    if (url.startsWith(WEB)) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await context.addInitScript(
    ([url, key]) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window !== window.top) return;
      localStorage.setItem("webgba.updateTest", JSON.stringify({ index: { url, key } }));
      const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
      if (prefs.lang !== "ko") localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang: "ko" }));
    },
    [INDEX_URL, PUB],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const ready = () => page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.goto(WEB);
  await ready();

  await page.evaluate(async () => {
    const s = window.webgba.store;
    const fake = (n) => new Uint8Array(1024 + n);
    let t = Date.now();
    const opened = (id) => s.patch(s.romKey(id), { opened: (t -= 1000) });
    const games = [
      ["star", "dev.example.star", "Star Garden", "#2f6f5e"],
      ["arc", "dev.example.arc", "Three Wonders", "#c0392b"],
      ["neo", "dev.example.neo", "Metal Slug", "#2c3e50"],
      ["mob", "dev.example.mob", "Pocket Run", "#7a3bb0"],
    ];
    for (const [id, gameId, title, color] of games) {
      await s.putGame({ id, name: `${id}.wgba`, file: `${id}.wgba`, type: "wgba", gameId, version: "1.0.0", build: "a".repeat(64), title, shortName: "", author: "", romSha1: "", cart: { color } }, fake(id.length), { carts: [] });
      await opened(id);
    }
    for (const [id, name, type] of [["gba", "Moon Hopper.gba", "gba"], ["gb", "Pixel Quest.gb", "gb"], ["gbc", "Neon Drift.gbc", "gbc"]]) {
      await s.putRom({ id, name, file: name, type, ...(type === "gbc" ? { color: "dual" } : {}) }, fake(10));
      await opened(id);
    }
  });
  await page.reload();
  await ready();
  await page.waitForFunction(async () => (await window.webgba.store.list("rom")).filter((r) => r.group).length >= 4, null, { timeout: 15000 }).catch(() => {});

  const openLibrary = async () => {
    await page.evaluate(() => window.webgba.openSheet("library"));
    await page.waitForSelector("#sheet:not([hidden]) .lib__case");
    await page.waitForTimeout(400);
  };
  const pickGroup = async (id) => {
    await page.click(`.lib__groups [data-group="${id}"]`);
    await page.waitForFunction((id) => document.querySelector(`.lib__groups [data-group="${id}"]`)?.getAttribute("aria-checked") === "true" && document.querySelector(".lib__case"), id);
    await page.waitForTimeout(400);
  };
  const view = () =>
    page.evaluate(() => {
      const card = document.querySelector(".lib__card");
      return {
        cardKey: card?.dataset.key ?? null,
        cardState: card?.dataset.state ?? null,
        cardName: card?.querySelector(".lib__name")?.textContent ?? "",
        shelf: [...document.querySelectorAll(".lib__case .spine[data-key]")].map((n) => n.dataset.key),
        pressed: [...document.querySelectorAll('.lib__case .spine[aria-pressed="true"]')].map((n) => n.dataset.key),
        out: [...document.querySelectorAll(".lib__case .spine.is-out")].map((n) => n.dataset.key),
      };
    });
  const NEO = "rom:neo";

  await openLibrary();
  await pickGroup("all");
  await pickGroup("arcade");
  const arcade = await view();
  ok("아케이드 책장 = 아케이드 게임만", arcade.shelf.length === 2 && arcade.shelf.includes(NEO), arcade.shelf.join(","));
  await page.click(`.lib__case .spine[data-key="${NEO}"]`);
  await page.waitForTimeout(300);
  const picked = await view();
  const name = picked.cardName;
  ok("아케이드 게임 선택", picked.cardKey === NEO && picked.pressed.join() === NEO, `${name} · 표시 ${picked.pressed.join()}`);

  const step = async (label, group, onShelf, extra) => {
    if (group) await pickGroup(group);
    if (extra) await extra();
    const v = await view();
    const same = v.cardKey === NEO && v.cardState === "open" && v.cardName === name;
    const mark = onShelf ? v.pressed.join() === NEO && v.out.join() === NEO : v.pressed.length === 0 && v.out.length === 0 && !v.shelf.includes(NEO);
    ok(`${label}: 상단 칸 그대로`, same, `${v.cardName} (${v.cardKey})`);
    ok(`${label}: 책장 선택 표시 ${onShelf ? "있음" : "없음"}`, mark, `책장 ${v.shelf.length}개 · 표시 ${v.pressed.join() || "없음"}`);
    return v;
  };
  const emu = await step("에뮬", "emu", false);
  const sortBefore = emu.shelf.join();
  const sorted = await step("에뮬 + 정렬 바꾸기", null, false, async () => {
    await page.click('.lib__shelfHead [data-action="sort"]');
    await page.waitForTimeout(400);
  });
  ok("정렬: 책장 순서 바뀜", sorted.shelf.join() !== sortBefore && sorted.shelf.length === emu.shelf.length, sorted.shelf.join(","));
  await step("모바일", "mobile", false);
  await page.screenshot({ path: path.join(opt.shots, "keep_select_mobile_group.png") });
  await step("전체", "all", true);
  await step("아케이드", "arcade", true);

  await page.click(`.lib__case .spine[data-key="${NEO}"]`);
  await page.waitForTimeout(300);
  await pickGroup("emu");
  const empty = await view();
  ok("넣어 둔 상태(빈 칸)도 그룹 바꾸기에서 유지", empty.cardState === "empty" && empty.pressed.length === 0, `${empty.cardState} · 표시 ${empty.pressed.join() || "없음"}`);

  await pickGroup("arcade");
  await page.click(`.lib__case .spine[data-key="${NEO}"]`);
  await page.waitForTimeout(300);
  await pickGroup("emu");
  await page.click("#sheetClose");
  await page.waitForFunction(() => document.querySelector("#sheet")?.hidden && !document.querySelector(".lib__case"), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  await openLibrary();
  const again = await view();
  ok("다시 열기: 이전 규칙(현재 그룹 첫 게임)·저장된 그룹 유지", again.cardKey === again.shelf[0] && again.pressed.join() === again.shelf[0] && (await page.getAttribute('.lib__groups [data-group="emu"]', "aria-checked")) === "true", `${again.cardName} (${again.cardKey})`);

  ok("페이지 오류 0", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
} finally {
  await browser.close();
  server.kill();
}
ok("PC 밖 요청 0(R2·Vercel 등)", outside.length === 0, outside.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.pass).length;
console.log(`합계 ${results.length - failed}/${results.length}`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify({ results, outside }, null, 2));
process.exit(failed ? 1 : 0);
