// 웹 온라인 업데이트 시험(로컬 전용, 흉내 R2 — 실제 R2 안 씀). 시험 서버 둘(웹 빌드·흉내 R2)을 띄우고 끝나면 닫는다.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-update.mjs --dist <웹 빌드> --feeds <발행 폴더 묶음> --pub <공개 키>
//     --v121 <1.2.1.wgba> --v130 <1.3.0.wgba> --v131 <1.3.1.wgba> --unknown <SHA-1 이 다른 1.3.0> --rom <원본 롬> --shots <캡처 폴더>
// 롬이 든 시험 파일은 브라우저에서 고르기만 한다(서버로 보내지 않음). 새 브라우저 프로필(시험 전용)에서만 돈다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8796;
const R2_PORT = 9481;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const R2 = `http://127.0.0.1:${R2_PORT}`;
const GAME_ID = "com.flightrabbit.rapid";
const FEED = `${R2}/${GAME_ID}/latest.json`;
fs.mkdirSync(opt.shots, { recursive: true });
const sha1 = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
const SHA = { v121: sha1(opt.v121), v130: sha1(opt.v130), v131: sha1(opt.v131) };

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const children = [];
function serve(args) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  return new Promise((resolve) => child.stdout.once("data", () => resolve(child)));
}
const web = await serve([path.join(repo, "web", "tools", "serve.mjs"), opt.dist, String(WEB_PORT)]);
let r2 = await serve([path.join(repo, "tools", "test", "update-server.mjs"), opt.feeds, String(R2_PORT)]);
const r2Mode = (mode) => fetch(`${R2}/__use?mode=${mode}`).then((r) => r.text());
const r2Log = () => fetch(`${R2}/__log`).then((r) => r.json());
const r2Clear = () => fetch(`${R2}/__clear`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ lang = "ko", viewport = { width: 390, height: 844 }, feed = FEED } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript(
    ([feed, pub, lang]) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window !== window.top) return;
      localStorage.setItem("webgba.installHint", "1");
      localStorage.setItem("webgba.updateTest", JSON.stringify({ feeds: { "com.flightrabbit.rapid": { feed, key: pub } } }));
      const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
      if (prefs.lang !== lang) localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang }));
    },
    [feed, opt.pub, lang],
  );
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (opt.debug) page.on("console", (m) => console.log(`[콘솔 ${m.type()}] ${m.text()}`));
  page.on("response", (response) => requests.push({ url: response.url(), time: Date.now(), sw: response.fromServiceWorker() }));
  await boot(page);
  return { context, page, errors, requests };
}

async function boot(page) {
  await page.goto(WEB);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
}

async function addFile(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click("#startOpen")]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
  await page.waitForTimeout(300);
}

const dialogShown = (page) => page.evaluate(() => !document.getElementById("dialog").hidden && Boolean(document.querySelector("#dialog .upick__item")));
const waitDialog = (page) => page.waitForFunction(() => !document.getElementById("dialog").hidden && document.querySelector("#dialog .upick__item"), null, { timeout: 20000 });
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("#dialog .upick__item")].map((n) => ({ state: n.dataset.state, meta: n.querySelector(".upick__meta").textContent, name: n.querySelector(".upick__name").textContent, btn: n.querySelector(".upick__btn").hidden ? "" : n.querySelector(".upick__btn").textContent.trim() })));
const rapid = (page) => page.evaluate(async (id) => {
  const rom = (await window.webgba.store.list("rom")).find((r) => r.gameId === id);
  if (!rom) return null;
  const bytes = await window.webgba.store.bytes(rom.key);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  return { key: rom.key, version: rom.version, sha1: hash, size: bytes.length };
}, GAME_ID);
const waitRows = (page, done) => page.waitForFunction((done) => [...document.querySelectorAll("#dialog .upick__item")].every((n) => done.includes(n.dataset.state)), done, { timeout: 180000 });

async function putMarker(page) {
  return page.evaluate(async (id) => {
    const bytes = new Uint8Array(131072);
    crypto.getRandomValues(bytes.subarray(0, 65536));
    await window.webgba.store.putSave(id, bytes, "marker");
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  }, GAME_ID);
}
const saveSha = (page) => page.evaluate(async (id) => {
  const bytes = await window.webgba.store.saveBytes(id);
  return bytes ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), (b) => b.toString(16).padStart(2, "0")).join("") : "";
}, GAME_ID);

function inkCheck(image, box) {
  const x0 = Math.round(box.left + 2);
  const x1 = Math.round(box.right - 2);
  const y0 = Math.round(box.top) + 1;
  const y1 = Math.round(box.bottom) - 1;
  const counts = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
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
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      if (Math.max(Math.abs(image.data[o] - (bg >> 16)), Math.abs(image.data[o + 1] - ((bg >> 8) & 255)), Math.abs(image.data[o + 2] - (bg & 255))) > 48) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  if (first < 0) return null;
  return { top: first - y0, bottom: y1 - 1 - last };
}

async function inkCenter(page, label, selector) {
  const image = decodePng(await page.screenshot());
  const boxes = await page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((n) => n.offsetParent !== null && !n.hidden).map((n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return { left: r.left + parseFloat(s.borderLeftWidth), right: r.right - parseFloat(s.borderRightWidth), top: r.top + parseFloat(s.borderTopWidth), bottom: r.bottom - parseFloat(s.borderBottomWidth) };
  }), selector);
  let worst = 0;
  const each = [];
  for (const box of boxes) {
    const m = inkCheck(image, box);
    if (!m) continue;
    each.push(`${m.top}/${m.bottom}`);
    worst = Math.max(worst, Math.abs(m.top - m.bottom));
  }
  ok(`${label} ${selector} 잉크 세로 가운데(${each.length}개)`, each.length > 0 && worst <= 1, `최대 차이 ${worst}px(홀수 1행 허용) · 위/아래 ${each.join(" ")}`);
}

async function rowAlign(page, label) {
  const diffs = await page.evaluate(() =>
    [...document.querySelectorAll("#dialog .upick__item")].map((li) => {
      const box = li.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(li).paddingTop);
      const row = { top: box.top + pad, height: box.height - pad * 2 - parseFloat(getComputedStyle(li).borderBottomWidth) };
      const mid = (r) => r.top + r.height / 2;
      const parts = [li.querySelector(".upick__check"), li.querySelector(".upick__art:not([hidden])"), li.querySelector(".upick__text")].filter(Boolean).map((n) => n.getBoundingClientRect());
      return Math.max(...parts.map((r) => Math.abs(mid(r) - mid(row))));
    }),
  );
  ok(`${label} 줄 안 상자(체크·그림·글) 세로 가운데 차이 0px`, diffs.length && diffs.every((d) => d < 0.5), diffs.map((d) => d.toFixed(1)).join(" "));
}

async function oneLine(page, label) {
  const wraps = await page.evaluate(() =>
    [...document.querySelectorAll("#dialog .upick__name, #dialog .upick__meta, #dialog .upick__btn:not([hidden]), #dialog #dialogActions .btn, #dialog .zpick__allLabel")]
      .filter((n) => n.offsetParent !== null)
      .map((n) => ({ text: n.textContent.trim(), multi: n.getClientRects().length > 1 || n.scrollHeight > n.clientHeight + 1 || (getComputedStyle(n).whiteSpace !== "nowrap" && n.getBoundingClientRect().height > parseFloat(getComputedStyle(n).lineHeight || "20") * 1.5 + 12) })),
  );
  ok(`${label} 문구 한 줄`, wraps.length && wraps.every((w) => !w.multi), wraps.filter((w) => w.multi).map((w) => w.text).join(" | ") || wraps.map((w) => w.text).join(" | "));
}

try {
  /* ── A: 1.3.0 → 1.3.1(웹 세로) · 세이브 유지 · 퀵슬롯 · 실행 1회 · Vercel 요청 0 ── */
  if (!opt.only || opt.only.includes("A")) {
    await r2Mode("ok");
    const { context, page, errors, requests } = await open();
    await addFile(page, opt.v130);
    const saved = await page.evaluate(() => window.webgba.quickSave(1));
    await page.evaluate(() => window.webgba.closeGame({ quiet: true }));
    const marker = await putMarker(page);
    const before = await rapid(page);
    ok("A 1.3.0 보관", before?.version === "1.3.0" && before.sha1 === SHA.v130 && saved, JSON.stringify(before));
    await r2Clear();
    await boot(page);
    await waitDialog(page);
    const shown = await rows(page);
    ok("A 앱 실행 → 업데이트 창(목록 1줄 · 1.3.0 → 1.3.1 · 크기)", shown.length === 1 && /1\.3\.0 → 1\.3\.1/.test(shown[0].meta) && /KB/.test(shown[0].meta), JSON.stringify(shown));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(opt.shots, "update_popup_ko.png") });
    await inkCenter(page, "A", "#dialog .upick__btn:not([hidden])");
    await inkCenter(page, "A", "#dialog #dialogActions .btn");
    await rowAlign(page, "A");
    await oneLine(page, "A ko");
    const start = Date.now();
    await page.click('#dialogActions [data-action="update-all"]');
    await waitRows(page, ["done", "failed"]);
    const after = await rapid(page);
    const shownAfter = await rows(page);
    ok("A 업데이트 완료 → 1.3.1 · SHA-1 일치", after?.version === "1.3.1" && after.sha1 === SHA.v131 && shownAfter[0].state === "done", `${JSON.stringify(after)} · ${shownAfter[0].meta}`);
    ok("A 세이브(게임 id 키) 그대로", (await saveSha(page)) === marker);
    const during = requests.filter((r) => r.time >= start && r.url.startsWith(WEB));
    const precached = await (await fetch(`${WEB}/sw.js`)).text();
    const network = during.filter((r) => !r.sw || !precached.includes(JSON.stringify(new URL(r.url).pathname)));
    ok("A 업데이트 동안 웹 서버(Vercel 자리) 네트워크 요청 0(앱 파일은 서비스 워커 캐시)", network.length === 0, `네트워크 ${network.map((r) => r.url).join(", ") || "0"} · 서비스 워커 캐시 ${during.length - network.length}개`);
    const log = await r2Log();
    ok("A 흉내 R2 요청 = 버전 파일 1 + 패치 1", log.filter((l) => l.path.endsWith("latest.json")).length === 1 && log.filter((l) => l.path.includes("/patches/")).length === 1, log.map((l) => l.path.split("/").pop().slice(0, 12)).join(","));
    await page.click('#dialogActions [data-action="update-later"]');
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.webgba.openSheet("library"));
    await page.waitForTimeout(500);
    ok("A 실행 중에는 다시 확인하지 않음(3초 · 라이브러리 열기 뒤에도 버전 파일 1번)", (await r2Log()).filter((l) => l.path.endsWith("latest.json")).length === 1);
    await page.evaluate(async (key) => {
      window.webgba.state.sheet && document.getElementById("sheetClose").click();
      await window.webgba.openStored(key);
    }, after.key);
    await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 60000 });
    const loaded = await page.evaluate(() => window.webgba.quickLoad(1));
    const toast = await page.textContent("#toast");
    ok("A 퀵슬롯 1(1.3.0 에서 저장) 불러오기 막힘 + 안내", loaded === false && /1\.3\.0/.test(toast) && /1\.3\.1/.test(toast), toast);
    const states = await page.evaluate(async (id) => (await window.webgba.store.states(id)).map((s) => ({ slot: s.slot, version: s.version })), GAME_ID);
    ok("A 다른 버전 칸 데이터는 그대로 남음", states.some((s) => s.slot === 1 && s.version === "1.3.0"), JSON.stringify(states));
    ok("A 페이지 오류 없음", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  /* ── B: 두 단계 연쇄 1.2.1 → 1.3.0 → 1.3.1 ── */
  if (!opt.only || opt.only.includes("B")) {
    const { context, page } = await open();
    await addFile(page, opt.v121);
    await page.evaluate(() => window.webgba.closeGame({ quiet: true }));
    await r2Clear();
    await boot(page);
    await waitDialog(page);
    const shown = await rows(page);
    await page.click('#dialogActions [data-action="update-all"]');
    await waitRows(page, ["done", "failed"]);
    const after = await rapid(page);
    const log = await r2Log();
    ok("B 1.2.1 → 두 단계 → 1.3.1 SHA-1 일치", after?.sha1 === SHA.v131 && log.filter((l) => l.path.includes("/patches/")).length === 2, `${shown[0]?.meta} · ${after?.version}`);
    await context.close();
  }

  /* ── C: 서명 변조 → 거부(창 없음) · D: SHA-1 다름 → 거부·기존 유지 · 3언어 ── */
  if (!opt.only || opt.only.includes("C")) {
    const { context, page, errors } = await open();
    await addFile(page, opt.v130);
    await page.evaluate(() => window.webgba.closeGame({ quiet: true }));
    await r2Mode("tamper");
    await boot(page);
    await page.waitForTimeout(3000);
    ok("C 서명 변조 버전 파일 → 업데이트 창 없음 · 오류 알림 없음", !(await dialogShown(page)) && !/오류|실패/.test(await page.textContent("#toast")));
    await r2Mode("badsha");
    await boot(page);
    await waitDialog(page);
    await page.click('#dialogActions [data-action="update-all"]');
    await waitRows(page, ["done", "failed"]);
    const shown = await rows(page);
    const after = await rapid(page);
    ok("D 결과 SHA-1 다름 → 실패 표시 · 기존 1.3.0 그대로", shown[0].state === "failed" && /SHA-1/.test(shown[0].meta) && after.sha1 === SHA.v130 && after.version === "1.3.0", `${shown[0].meta} · ${after.version}`);
    ok("D 실패 줄 = 다시 시도 버튼", shown[0].btn === "다시 시도", shown[0].btn);
    await page.click('#dialogActions [data-action="update-later"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.webgba.openSheet("library"));
    await page.waitForSelector('#sheet [data-action="update"]', { timeout: 5000 });
    const lib = await page.evaluate(() => ({ spine: Boolean(document.querySelector(".spine__upd")), meta: document.querySelector(".lib__meta")?.textContent ?? "" }));
    ok("D 창을 닫은 뒤에도 라이브러리에 업데이트 표시 + 버튼", lib.spine && /1\.3\.1/.test(lib.meta), JSON.stringify(lib));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(opt.shots, "update_library_ko.png") });
    await inkCenter(page, "D 라이브러리", '#sheet [data-action="update"]');
    for (const lang of ["en", "ja"]) {
      await page.evaluate((lang) => localStorage.setItem("webgba.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}"), lang })), lang);
      await context.addInitScript((lang) => {
        const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
        localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang }));
      }, lang);
      await boot(page);
      await waitDialog(page);
      await page.waitForTimeout(400);
      await oneLine(page, `D ${lang}`);
      await inkCenter(page, `D ${lang}`, "#dialog .upick__btn:not([hidden])");
      await rowAlign(page, `D ${lang}`);
      if (lang === "en") await page.screenshot({ path: path.join(opt.shots, "update_popup_en.png") });
    }
    ok("C·D 페이지 오류 없음", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  /* ── E: 오프라인 → 조용히 넘어감 ── */
  if (!opt.only || opt.only.includes("E")) {
    r2.kill();
    await new Promise((resolve) => r2.once("exit", resolve));
    const { context, page, errors } = await open();
    await addFile(page, opt.v130);
    await page.evaluate(() => window.webgba.closeGame({ quiet: true }));
    await boot(page);
    await page.waitForTimeout(3000);
    ok("E 버전 파일 서버에 닿지 않음 → 창 없음 · 오류 알림 없음", !(await dialogShown(page)) && !/오류|실패/.test(await page.textContent("#toast")) && errors.length === 0, errors.join(" | "));
    await context.close();
    r2 = await serve([path.join(repo, "tools", "test", "update-server.mjs"), opt.feeds, String(R2_PORT)]);
  }

  /* ── F: 모르는 SHA-1 → 원본 롬 선택 → 전체 설치 ── */
  if (!opt.only || opt.only.includes("F")) {
    await r2Mode("ok");
    const { context, page, errors } = await open();
    await addFile(page, opt.unknown);
    await page.evaluate(() => window.webgba.closeGame({ quiet: true }));
    await boot(page);
    await waitDialog(page);
    const shown = await rows(page);
    ok("F 모르는 SHA-1 → '원본 롬 필요' 줄 · 원본 롬 선택 버튼", /원본 롬/.test(shown[0].meta) && shown[0].btn === "원본 롬 선택", JSON.stringify(shown[0]));
    if (opt.debug) {
      await page.click('#dialog [data-action="update-row"]');
      await page.waitForTimeout(1500);
      console.log("디버그", JSON.stringify(await page.evaluate(() => ({ inputs: document.querySelectorAll("input[type=file]").length, rows: [...document.querySelectorAll("#dialog .upick__item")].map((n) => n.dataset.state + " " + n.querySelector(".upick__meta").textContent), toast: document.getElementById("toast").textContent }))));
    }
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click('#dialog [data-action="update-row"]')]);
    await chooser.setFiles(opt.rom);
    await waitRows(page, ["done", "failed"]);
    const after = await rapid(page);
    const done = await rows(page);
    ok("F 원본 롬 + .wgbp → 1.3.1 SHA-1 일치", after?.sha1 === SHA.v131 && done[0].state === "done", `${done[0].meta} · ${after?.sha1}`);
    ok("F 페이지 오류 없음", errors.length === 0, errors.join(" | "));
    await context.close();
  }
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error));
} finally {
  await browser.close();
  for (const child of children) child.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
fs.writeFileSync(path.join(opt.shots, "web-update.json"), JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
