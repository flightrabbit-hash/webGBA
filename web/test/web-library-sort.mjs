// 라이브러리·롬 가져오기 이름 순 시험(로컬 전용 — 흉내 비공개 R2·가짜 Upstash·브라우저 안에서 가로챈 업데이트 목록, 실제 R2·Vercel 안 씀).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-library-sort.mjs --dist <웹 빌드> --shots <캡처 폴더> [--out <결과 json>]
// 사용자 2026-11-17 "전체에서 목록 정렬 시 모바일이 아닌것부터 가나다순으로 정렬하고 그 아래에 모바일을 가나다 순으로".
// 1) nameOrder(node): 모바일이 아닌 게임 먼저 → 모바일, "[M] "·"[A] " 뗀 이름, 숫자 자연 순서(2 < 10), 언어별 Collator(ko·en)
// 2) 라이브러리: 최근 연 순은 그대로(그룹 섞임), 이름순 전체 = 비모바일 가나다 → 모바일 가나다(ko·en), 그룹 버튼 안 순서
// 3) 롬 가져오기 목록(roms.json — .wmba "[M] "·.wapk "[A] "): 전체 = 같은 순서(ko·en), 그룹 버튼 안 순서
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createAdmin } from "../../api/_admin/server.js";
import { romItem, romsText } from "../../api/_admin/roms.js";
import { nameOrder, plainName } from "../../src-bundle/src/js/core/wgba-format.js";
import { startFakeUpstash } from "../../tools/test/fake-upstash.mjs";
import { keyFile, startFakeR2 } from "../../tools/test/fake-r2-private.mjs";
import { publicOf, signText } from "../../tools/lib/update-cmds.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8794;
const WEB = `http://127.0.0.1:${WEB_PORT}/`;
const INDEX_URL = "http://127.0.0.1:9596/index.json";
const PIN = "2#6!4" + "8";
fs.mkdirSync(opt.shots, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const same = (got, want) => got.join(" / ") === want.join(" / ");
const show = (got, want) => (same(got, want) ? got.join(" / ") : `받음 ${got.join(" / ")} | 기대 ${want.join(" / ")}`);

// ── 1) nameOrder(node) ──
{
  const sample = [
    ["포켓몬 10"], ["[M] 리듬스타 10", 1], ["Metal Slug"], ["[A] 나무꾼", 1], ["포켓몬 2"], ["[M] 가로세로", 1], ["나이트 런"], ["[M] Bubble", 1], ["가디언"], ["[M] 리듬스타 2", 1],
  ];
  const by = (locale) => [...sample].sort(nameOrder(locale, { name: (x) => x[0], mobile: (x) => x[1] })).map((x) => x[0]);
  const ko = ["가디언", "나이트 런", "포켓몬 2", "포켓몬 10", "Metal Slug", "[M] 가로세로", "[A] 나무꾼", "[M] 리듬스타 2", "[M] 리듬스타 10", "[M] Bubble"];
  const en = ["Metal Slug", "가디언", "나이트 런", "포켓몬 2", "포켓몬 10", "[M] Bubble", "[M] 가로세로", "[A] 나무꾼", "[M] 리듬스타 2", "[M] 리듬스타 10"];
  ok("nameOrder ko: 비모바일 가나다(2 < 10) → 모바일 가나다([M]·[A] 뗀 이름)", same(by("ko-KR"), ko), show(by("ko-KR"), ko));
  ok("nameOrder en: 영어 Collator(라틴 → 한글) · 모바일은 뒤", same(by("en"), en), show(by("en"), en));
  const plain = [plainName("[M] 리듬스타 1"), plainName("[A] Run"), plainName("[M]X"), plainName(null), plainName("A [M] B")];
  ok("plainName: 앞 접두어 \"[M] \"·\"[A] \"만 뗌", plain.join("|") === "리듬스타 1|Run|[M]X||A [M] B", plain.join("|"));
}

// ── 흉내 서버 ──
const r2 = await startFakeR2({ publicRead: true });
const kv = await startFakeUpstash();
const api = createAdmin({ env: { ...r2.env, UPSTASH_REDIS_REST_URL: kv.url, UPSTASH_REDIS_REST_TOKEN: kv.token }, endpoint: r2.endpoint, romsUrl: `${r2.endpoint}/roms.json` });
const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
r2.put("authentication.key", keyFile(PIN, kst(Date.now() - 600000)));
const ROMS = [
  ["wgba", "io.sort.p10", { ko: "포켓몬 10", en: "Pocket 10" }, "emu"],
  ["wmba", "local.r10", { ko: "리듬스타 10", en: "Rhythm Star 10" }, "mobile"],
  ["wgba", "io.sort.metal", "Metal Slug", "arcade"],
  ["wapk", "local.wood", { ko: "나무꾼", en: "Woodcutter" }, "mobile"],
  ["wgba", "io.sort.p2", { ko: "포켓몬 2", en: "Pocket 2" }, "emu"],
  ["wmba", "local.garo", { ko: "가로세로", en: "Crossword" }, "mobile"],
  ["wgba", "io.sort.night", { ko: "나이트 런", en: "Night Run" }, "arcade"],
  ["wmba", "local.bubble", "Bubble", null],
  ["wgba", "io.sort.guard", { ko: "가디언", en: "Guardian" }, null],
  ["wmba", "local.r2", { ko: "리듬스타 2", en: "Rhythm Star 2" }, "mobile"],
];
r2.put("roms.json", romsText(ROMS.map(([ext, id, names, group], i) => romItem({ id, version: "1.0.0", key: `${ext}/${id}/1.0.0.${ext}`, size: 1000 + i, etag: `e${i}`, names, group })), "2026-11-17T00:00:00Z"));

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signed = JSON.stringify({ time: "2026-11-17T00:00:00Z", feeds: {}, groups: {} });
const INDEX_TEXT = JSON.stringify({ wgbaIndex: 1, signed, signature: signText(signed, privateKey), feeds: {} });

const web = spawn(process.execPath, [path.join(repo, "web", "tools", "serve.mjs"), opt.dist, String(WEB_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => web.stdout.once("data", resolve));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open(lang, adminRec = null) {
  const context = await browser.newContext({ viewport: { width: 430, height: 1100 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await context.route(INDEX_URL, (route) => route.fulfill({ status: 200, contentType: "application/json", body: INDEX_TEXT }));
  await context.route("**/api/v1/admin/**", async (route) => {
    const req = route.request();
    const headers = await req.allHeaders();
    const res = await api.handle(new Request(req.url(), { method: req.method(), headers, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer() }));
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await context.addInitScript(
    ([lang, url, key, rec]) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window !== window.top) return;
      localStorage.setItem("webgba.updateTest", JSON.stringify({ index: { url, key } }));
      localStorage.setItem("webgba.installHint", "1");
      if (rec && !localStorage.getItem("webgba.admin")) localStorage.setItem("webgba.admin", rec);
      const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
      if (prefs.lang !== lang) localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang }));
    },
    [lang, INDEX_URL, publicOf(privateKey), adminRec],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(WEB);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page, errors };
}

// 라이브러리 기록(1KB 가짜 기록, 롬 아님). 넣는 순서 = 최근 연 순(그룹이 섞이게).
const LIB = [
  ["p10", "dev.sort.p10", { ko: "포켓몬 10", en: "Pocket 10" }, "emu"],
  ["r10", "dev.sort.r10", { ko: "[M] 리듬스타 10", en: "[M] Rhythm Star 10" }, "mobile"],
  ["moon10", "", "Moon 10.gba", ""],
  ["metal", "dev.sort.metal", "Metal Slug", "arcade"],
  ["wood", "dev.sort.wood", { ko: "[A] 나무꾼", en: "[A] Woodcutter" }, "mobile"],
  ["p2", "dev.sort.p2", { ko: "포켓몬 2", en: "Pocket 2" }, "emu"],
  ["guard", "", "가디언.gba", ""],
  ["garo", "dev.sort.garo", { ko: "[M] 가로세로", en: "[M] Crossword" }, "mobile"],
  ["night", "dev.sort.night", { ko: "나이트 런", en: "Night Run" }, "arcade"],
  ["moon9", "", "Moon 9.gba", ""],
  ["bubble", "dev.sort.bubble", "[M] Bubble", "mobile"],
  ["r2", "dev.sort.r2", { ko: "[M] 리듬스타 2", en: "[M] Rhythm Star 2" }, "mobile"],
];
async function seed(page) {
  await page.evaluate(async (games) => {
    const s = window.webgba.store;
    let t = Date.now();
    for (const [id, gameId, title, group] of games) {
      if (gameId) {
        const ext = id === "wood" ? "wapk" : group === "mobile" ? "wmba" : "wgba";
        const extra = group === "mobile" ? { mobile: true, ...(ext === "wapk" ? { android: true } : {}) } : {};
        await s.putGame({ id, name: `${id}.${ext}`, file: `${id}.${ext}`, type: "wgba", gameId, version: "1.0.0", build: "a".repeat(64), title, shortName: "", author: "", romSha1: "", group, category: "", cart: { color: "#4a6fa5" }, ...extra }, new Uint8Array(1024));
      } else await s.putRom({ id, name: title, file: title, type: "gba" }, new Uint8Array(1024));
      await s.patch(s.romKey(id), { opened: (t -= 1000) });
    }
  }, LIB);
}

async function openLibrary(page) {
  await page.evaluate(() => window.webgba.openSheet("library"));
  await page.waitForSelector("#sheet:not([hidden]) .lib__case");
  await page.waitForTimeout(400);
}
const shelfNames = (page) => page.$$eval(".lib__case .spine[data-key]", (nodes) => nodes.map((n) => n.getAttribute("aria-label")));
async function libGroup(page, id) {
  await page.click(`#sheet .lib__groups [data-group="${id}"]`);
  await page.waitForFunction((id) => document.querySelector(`#sheet .lib__groups [data-group="${id}"]`)?.getAttribute("aria-checked") === "true", id);
  await page.waitForTimeout(300);
}
async function openImport(page) {
  await page.click('[data-action="admin-import"]');
  await page.waitForSelector("#dialog .upick__item", { timeout: 20000 });
  await page.waitForTimeout(400);
}
const importNames = (page) => page.$$eval("#dialog .upick__item", (nodes) => nodes.filter((n) => !n.hidden).map((n) => n.querySelector(".upick__name").textContent));
async function importGroup(page, id) {
  await page.click(`#dialog .lib__groups [data-group="${id}"]`);
  await page.waitForTimeout(250);
}
async function closeDialog(page) {
  await page.click('#dialogActions [data-action="admin-0"]');
  await page.waitForFunction(() => document.getElementById("dialog").hidden, null, { timeout: 20000 });
}

const LIB_WANT = {
  ko: {
    recent: ["포켓몬 10", "[M] 리듬스타 10", "Moon 10", "Metal Slug", "[A] 나무꾼", "포켓몬 2", "가디언", "[M] 가로세로", "나이트 런", "Moon 9", "[M] Bubble", "[M] 리듬스타 2"],
    all: ["가디언", "나이트 런", "포켓몬 2", "포켓몬 10", "Metal Slug", "Moon 9", "Moon 10", "[M] 가로세로", "[A] 나무꾼", "[M] 리듬스타 2", "[M] 리듬스타 10", "[M] Bubble"],
    emu: ["가디언", "포켓몬 2", "포켓몬 10", "Moon 9", "Moon 10"],
    arcade: ["나이트 런", "Metal Slug"],
    mobile: ["[M] 가로세로", "[A] 나무꾼", "[M] 리듬스타 2", "[M] 리듬스타 10", "[M] Bubble"],
  },
  en: {
    all: ["Metal Slug", "Moon 9", "Moon 10", "Night Run", "Pocket 2", "Pocket 10", "가디언", "[M] Bubble", "[M] Crossword", "[M] Rhythm Star 2", "[M] Rhythm Star 10", "[A] Woodcutter"],
  },
};
const IMPORT_WANT = {
  ko: {
    all: ["가디언", "나이트 런", "포켓몬 2", "포켓몬 10", "Metal Slug", "[M] 가로세로", "[A] 나무꾼", "[M] 리듬스타 2", "[M] 리듬스타 10", "[M] Bubble"],
    emu: ["가디언", "포켓몬 2", "포켓몬 10"],
    arcade: ["나이트 런", "Metal Slug"],
    mobile: ["[M] 가로세로", "[A] 나무꾼", "[M] 리듬스타 2", "[M] 리듬스타 10", "[M] Bubble"],
  },
  en: {
    all: ["Guardian", "Metal Slug", "Night Run", "Pocket 2", "Pocket 10", "[M] Bubble", "[M] Crossword", "[M] Rhythm Star 2", "[M] Rhythm Star 10", "[A] Woodcutter"],
  },
};

let adminRec = null;
try {
  // ── 2) 라이브러리(ko) ──
  {
    const { context, page, errors } = await open("ko");
    await seed(page);
    await openLibrary(page);
    const sortLabel = () => page.textContent('[data-action="sort"]').then((s) => s.trim());
    const recent = await shelfNames(page);
    ok("라이브러리 최근 연 순(기본) = 그대로(연 순서, 그룹 섞임)", (await sortLabel()) === "최근 연 순" && same(recent, LIB_WANT.ko.recent), show(recent, LIB_WANT.ko.recent));
    await page.click('[data-action="sort"]');
    await page.waitForFunction(() => document.querySelector('[data-action="sort"]').textContent.trim() === "이름순");
    await page.waitForTimeout(400);
    const all = await shelfNames(page);
    ok("라이브러리 이름순 전체(ko) = 비모바일 가나다 → 모바일 가나다 · [M]·[A] 뗀 이름 · 2 < 10", same(all, LIB_WANT.ko.all), show(all, LIB_WANT.ko.all));
    await page.screenshot({ path: path.join(opt.shots, "01_라이브러리_전체_이름순_ko.png") });
    for (const id of ["emu", "arcade", "mobile"]) {
      await libGroup(page, id);
      const got = await shelfNames(page);
      ok(`라이브러리 이름순 ${id} 그룹 안 순서(ko)`, same(got, LIB_WANT.ko[id]), show(got, LIB_WANT.ko[id]));
      if (id === "mobile") await page.screenshot({ path: path.join(opt.shots, "02_라이브러리_모바일_이름순_ko.png") });
    }
    await libGroup(page, "all");
    await page.click('[data-action="sort"]');
    await page.waitForFunction(() => document.querySelector('[data-action="sort"]').textContent.trim() === "최근 연 순");
    await page.waitForTimeout(400);
    const back = await shelfNames(page);
    ok("라이브러리 다시 최근 연 순 = 처음과 같음", same(back, LIB_WANT.ko.recent), show(back, LIB_WANT.ko.recent));

    // ── 3) 롬 가져오기(ko) ──
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await page.waitForSelector('[data-action="cfg-admin"]', { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.click('[data-action="cfg-admin"]');
    await page.waitForSelector("#dialog .apad", { timeout: 10000 });
    await page.waitForTimeout(250);
    await page.keyboard.type(PIN);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("dialog").hidden, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    adminRec = await page.evaluate(() => localStorage.getItem("webgba.admin"));
    ok("관리자 모드 입력(흉내 서버)", Boolean(adminRec && JSON.parse(adminRec).token));
    await page.waitForFunction(() => document.getElementById("toast").hidden, null, { timeout: 15000 }).catch(() => {});
    await openLibrary(page);
    await openImport(page);
    const list = await importNames(page);
    ok("롬 가져오기 전체(ko) = 비모바일 가나다 → 모바일 가나다 · roms.json [M]·[A] · 그룹 없는 .wmba = 모바일 · 2 < 10", same(list, IMPORT_WANT.ko.all), show(list, IMPORT_WANT.ko.all));
    await page.screenshot({ path: path.join(opt.shots, "03_롬가져오기_전체_ko.png") });
    for (const id of ["emu", "arcade", "mobile"]) {
      await importGroup(page, id);
      const got = await importNames(page);
      ok(`롬 가져오기 ${id} 그룹 안 순서(ko)`, same(got, IMPORT_WANT.ko[id]), show(got, IMPORT_WANT.ko[id]));
    }
    await importGroup(page, "all");
    ok("롬 가져오기 다시 전체 = 같은 순서", same(await importNames(page), IMPORT_WANT.ko.all));
    await closeDialog(page);
    ok("화면 오류 없음(ko)", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ── en ──
  {
    const { context, page, errors } = await open("en", adminRec);
    await seed(page);
    await openLibrary(page);
    await page.click('[data-action="sort"]');
    await page.waitForFunction(() => document.querySelector('[data-action="sort"]').textContent.trim() === "By name");
    await page.waitForTimeout(400);
    const all = await shelfNames(page);
    ok("라이브러리 이름순 전체(en) = 영어 Collator · 비모바일 → 모바일", same(all, LIB_WANT.en.all), show(all, LIB_WANT.en.all));
    await page.screenshot({ path: path.join(opt.shots, "04_라이브러리_전체_이름순_en.png") });
    await openImport(page);
    const list = await importNames(page);
    ok("롬 가져오기 전체(en) = 영어 이름 · 비모바일 → 모바일", same(list, IMPORT_WANT.en.all), show(list, IMPORT_WANT.en.all));
    await page.screenshot({ path: path.join(opt.shots, "05_롬가져오기_전체_en.png") });
    await closeDialog(page);
    ok("화면 오류 없음(en)", errors.length === 0, errors.join(" | "));
    await context.close();
  }
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error));
} finally {
  await browser.close();
  web.kill();
  await r2.close();
  await kv.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
