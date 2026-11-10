// 웹 관리자 모드 "롬 가져오기" 시험(로컬 전용 — 흉내 비공개 R2·가짜 Upstash, 실제 R2·Vercel 안 씀).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-admin.mjs --dist <웹 빌드> --shots <캡처 폴더> [--out <결과 json>]
// /api/v1/admin/* 요청은 브라우저 안에서 가로채 서버 함수(api/_admin/server.js)로 바로 넘긴다(Origin 등 머리는 브라우저가 붙인 그대로).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";
import { ADMIN, createAdmin } from "../../api/_admin/server.js";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startFakeUpstash } from "../../tools/test/fake-upstash.mjs";
import { keyFile, startFakeR2 } from "../../tools/test/fake-r2-private.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const { encode: encodePng } = createRequire(import.meta.url)("../../tools/test/png.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8797;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const PIN = "7#3!9" + "1";
fs.mkdirSync(opt.shots, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const u = (n) => {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const str = (t) => [...u(t.length), ...Buffer.from(t)];
const sec = (id, body) => [id, ...u(body.length), ...body];
const vec = (items) => [...u(items.length), ...items.flat()];
function tinyWasm(pad) {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [0], [0]]));
  const mem = sec(5, vec([[0x00, 1]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
  const blob = sec(0, [...str("x.blob"), ...new Array(pad).fill(7)]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code, ...blob]);
}
const rgba = Buffer.alloc(96 * 64 * 4);
for (let i = 0; i < 96 * 64; i++) rgba.set(i % 96 < 48 ? [220, 80, 60, 255] : [60, 120, 220, 255], i * 4);
const label = encodePng(rgba, 96, 64);
const game = async (id, version, name, pad, art = false) => (await packWgba({ wasm: tinyWasm(pad), manifest: { wgba: 1, id, version, name, runtime: "webapi", input: { preset: "gba" } }, images: art ? { label } : {} })).bytes;

const r2 = await startFakeR2();
const kv = await startFakeUpstash();
let skew = 0;
let delay = 0;
const api = createAdmin({ env: { ...r2.env, UPSTASH_REDIS_REST_URL: kv.url, UPSTASH_REDIS_REST_TOKEN: kv.token }, endpoint: r2.endpoint, now: () => Date.now() + skew });
const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
r2.put("authentication.key", keyFile(PIN, kst(Date.now() - 600000)));
r2.put("wgba/io.example.alpha/1.0.0.wgba", await game("io.example.alpha", "1.0.0", { en: "Alpha", ko: "알파" }, 1000, true));
r2.put("wgba/io.example.alpha/1.2.0.wgba", await game("io.example.alpha", "1.2.0", { en: "Alpha", ko: "알파" }, 400000, true));
r2.put("wgba/io.example.beta/2.0.0.wgba", await game("io.example.beta", "2.0.0", "Beta Quest", 600000));
r2.put("wgba/Gamma Land.wgba", await game("io.example.gamma", "0.3.1", { ja: "ガンマ" }, 200000));
r2.slow(400);

const web = spawn(process.execPath, [path.join(repo, "web", "tools", "serve.mjs"), opt.dist, String(WEB_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => web.stdout.once("data", resolve));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

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

async function inkCenter(page, name, selector) {
  const image = decodePng(await page.screenshot());
  const boxes = await page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((n) => n.offsetParent !== null && !n.hidden).map((n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    const lift = parseFloat(String(n.style.translate || "0 0").split(" ")[1] ?? 0) || 0;
    return { text: n.textContent.trim().slice(0, 6), left: r.left + parseFloat(s.borderLeftWidth), right: r.right - parseFloat(s.borderRightWidth), top: r.top - lift + parseFloat(s.borderTopWidth), bottom: r.bottom - lift - parseFloat(s.borderBottomWidth) };
  }), selector);
  let worst = 0;
  const each = [];
  for (const box of boxes) {
    const m = inkCheck(image, box);
    if (!m) continue;
    each.push(Math.abs(m.top - m.bottom) > 1 ? `${box.text}:${m.top}/${m.bottom}` : `${m.top}/${m.bottom}`);
    worst = Math.max(worst, Math.abs(m.top - m.bottom));
  }
  ok(`${name} 잉크 세로 가운데(${each.length}개)`, each.length > 0 && worst <= 1, `최대 차이 ${worst}px(홀수 1행 허용) · 위/아래 ${[...new Set(each)].join(" ")}`);
}

async function rowAlign(page, name) {
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
  ok(`${name} 줄 안 상자(체크·그림·글) 세로 가운데 차이 0px`, diffs.length && diffs.every((d) => d < 0.5), diffs.map((d) => d.toFixed(1)).join(" "));
}

const dialogOpen = (page) => page.evaluate(() => !document.getElementById("dialog").hidden);
const waitClosed = (page) => page.waitForFunction(() => document.getElementById("dialog").hidden, null, { timeout: 20000 });
const toastText = (page) => page.textContent("#toast");
const stored = (page) => page.evaluate(() => localStorage.getItem("webgba.admin"));
const libIds = (page) => page.evaluate(async () => (await window.webgba.store.list("rom")).map((r) => `${r.gameId}@${r.version}`).sort());
async function openSettings(page) {
  await page.evaluate(() => window.webgba.openSheet("settings"));
  await page.waitForSelector('[data-action="cfg-admin"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}
async function openLibrary(page) {
  await page.evaluate(() => window.webgba.openSheet("library"));
  await page.waitForSelector(".lib__shelfHead", { timeout: 10000 });
  await page.waitForTimeout(400);
}
async function typePad(page, pin, { keyboard = false } = {}) {
  await page.waitForSelector("#dialog .apad", { timeout: 10000 });
  await page.waitForTimeout(250);
  if (keyboard) await page.keyboard.type(pin);
  else for (const ch of pin) await page.click(`#dialog .apad__key[data-key="${ch}"]`);
}
const okButton = (page) => page.$('#dialog #dialogActions [data-action="admin-1"]');

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window !== window.top) return;
  localStorage.setItem("webgba.installHint", "1");
  const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
  if (prefs.lang !== "ko") localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang: "ko" }));
});
const calls = [];
await context.route("**/api/v1/admin/**", async (route) => {
  const req = route.request();
  const headers = await req.allHeaders();
  calls.push({ op: new URL(req.url()).pathname.split("/").pop(), origin: headers.origin ?? "" });
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const res = await api.handle(new Request(req.url(), { method: req.method(), headers, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer() }));
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(WEB);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });

  await openSettings(page);
  const off = await page.evaluate(() => {
    const btn = document.querySelector('[data-action="cfg-admin"]');
    const row = btn.closest(".field");
    return { label: btn.textContent.trim(), name: row.querySelector(".field__label").textContent, note: row.querySelector(".field__note").textContent, afterNick: Boolean(row.previousElementSibling?.querySelector(".cfg-nick")) };
  });
  ok("설정 = 닉네임 아래 관리자 모드 [입력]", off.label === "입력" && off.name === "관리자 모드" && off.afterNick, JSON.stringify(off));
  await openLibrary(page);
  ok("비활성 = 라이브러리에 롬 가져오기 없음", !(await page.$('[data-action="admin-import"]')));

  await openSettings(page);
  await page.click('[data-action="cfg-admin"]');
  await typePad(page, "");
  const padInfo = await page.evaluate(() => ({ keys: [...document.querySelectorAll("#dialog .apad__keys .apad__key")].map((b) => b.dataset.key).join(""), slots: document.querySelectorAll("#dialog .apad__slot").length, ok: document.querySelector('#dialog [data-action="admin-1"]').disabled, actions: [...document.querySelectorAll("#dialogActions .btn")].map((b) => b.textContent.trim()).join("·") }));
  ok("숫자패드 = 1~9·!·0·# 열두 키 + 6칸 · 6자리 전 확인 꺼짐", padInfo.keys === "123456789!0#" && padInfo.slots === 6 && padInfo.ok && padInfo.actions === "취소·확인", JSON.stringify(padInfo));
  await typePad(page, "12");
  await page.screenshot({ path: path.join(opt.shots, "01_숫자패드.png") });
  await inkCenter(page, "숫자패드 키", "#dialog .apad__key");
  await inkCenter(page, "숫자패드 창 버튼", "#dialog #dialogActions .btn");
  const shown = await page.evaluate(() => [...document.querySelectorAll("#dialog .apad__slot")].some((n) => n.textContent.trim()));
  ok("누른 글자는 화면에 표시 안 함(칸만 채움)", !shown && (await page.$$eval("#dialog .apad__slot.is-on", (n) => n.length)) === 2);
  await page.click('#dialog .apad__key[data-key="erase"]');
  await typePad(page, "00000");
  ok("지우기 후 6자리 = 확인 켜짐", (await page.$$eval("#dialog .apad__slot.is-on", (n) => n.length)) === 6 && !(await (await okButton(page)).isDisabled()));
  await (await okButton(page)).click();
  await waitClosed(page);
  await page.waitForTimeout(300);
  ok("틀린 6자리 → 창 닫힘 · 안내 · [입력] 그대로", /번호가 맞지 않습니다/.test(await toastText(page)) && (await stored(page)) === null && (await page.textContent('[data-action="cfg-admin"]')).trim() === "입력", await toastText(page));

  await page.click('[data-action="cfg-admin"]');
  await typePad(page, PIN, { keyboard: true });
  delay = 900;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const busy = await page.evaluate(() => ({ state: !document.querySelector("#dialog .apad__state").hidden && document.querySelector("#dialog .apad__state").textContent, keys: [...document.querySelectorAll("#dialog .apad__key")].every((b) => b.disabled), ok: document.querySelector('#dialog [data-action="admin-1"]').disabled, cancel: document.querySelector('#dialog [data-action="admin-0"]').disabled }));
  await page.screenshot({ path: path.join(opt.shots, "02_확인중.png") });
  ok("확인 중 = 로딩 글 · 키·버튼 잠김", busy.state === "확인하는 중…" && busy.keys && busy.ok && busy.cancel, JSON.stringify(busy));
  await inkCenter(page, "확인 중 글", "#dialog .apad__state");
  await waitClosed(page);
  delay = 0;
  await page.waitForTimeout(400);
  const rec = await stored(page);
  ok("맞는 6자리 → 활성화 · 토큰만 저장(6자리 저장 안 함)", rec && JSON.parse(rec).token && !rec.includes(PIN) && (await page.textContent('[data-action="cfg-admin"]')).trim() === "해제", rec?.slice(0, 40));
  ok("입력 확인 요청 = Origin 붙음", calls.filter((c) => c.op === "verify").every((c) => c.origin === WEB));
  await inkCenter(page, "설정 관리자 버튼", '[data-action="cfg-admin"]');
  await page.screenshot({ path: path.join(opt.shots, "03_설정_해제.png") });

  await openLibrary(page);
  const head = await page.evaluate(() => {
    const a = document.querySelector('[data-action="admin-import"]').getBoundingClientRect();
    const s = document.querySelector('[data-action="sort"]').getBoundingClientRect();
    return { left: a.right <= s.left, top: a.top - s.top, bottom: a.bottom - s.bottom, label: document.querySelector('[data-action="admin-import"]').textContent.trim() };
  });
  ok("활성 = 최근 연 순 좌측 롬 가져오기 · 상단·하단 위치 같음", head.left && head.top === 0 && head.bottom === 0 && head.label === "롬 가져오기", JSON.stringify(head));
  await inkCenter(page, "라이브러리 머리 버튼", ".lib__shelfHead .btn");
  await page.screenshot({ path: path.join(opt.shots, "04_라이브러리.png") });

  await page.click('[data-action="admin-import"]');
  await page.waitForSelector("#dialog .upick__item", { timeout: 20000 });
  await page.waitForTimeout(400);
  const first = await page.evaluate(() => [...document.querySelectorAll("#dialog .upick__item")].map((n) => `${n.querySelector(".upick__name").textContent}|${n.querySelector(".upick__meta").textContent}|${n.querySelector(".upick__art img") ? "그림" : ""}`));
  ok("목록 = 게임별 최신 버전 · 이름(현재 언어) · 버전·크기 · 라벨", first.length === 3 && first.some((r) => r.startsWith("알파|버전 1.2.0") && r.endsWith("그림")) && first.some((r) => r.startsWith("ガンマ|")), first.join(" / "));
  await page.screenshot({ path: path.join(opt.shots, "05_목록.png") });
  await rowAlign(page, "목록");
  await inkCenter(page, "목록 글", "#dialog .upick__name, #dialog .upick__meta, #dialog .zpick__allLabel");
  const start = await page.evaluate(() => ({ checked: [...document.querySelectorAll("#dialog .upick__check")].filter((n) => n.getAttribute("aria-checked") === "true").length, all: document.querySelector("#dialog .zpick__all").getAttribute("aria-checked"), rowButtons: document.querySelectorAll("#dialog .upick__btn").length, go: document.querySelector('#dialog [data-action="admin-1"]').disabled, label: document.querySelector('#dialog [data-action="admin-1"]').textContent.trim() }));
  ok("목록 = 처음 체크 모두 꺼짐 · 줄마다 받기 버튼 없음 · 하단 버튼 꺼짐", start.checked === 0 && start.all === "false" && start.rowButtons === 0 && start.go && start.label === "다운로드", JSON.stringify(start));
  await page.click('#dialog .upick__item[data-key="wgba/io.example.beta/2.0.0.wgba"] .upick__check');
  ok("하나 체크 → 하단 버튼 켜짐", !(await page.$eval('#dialog [data-action="admin-1"]', (b) => b.disabled)));
  await page.click('#dialog [data-action="admin-1"]');
  await page.waitForFunction(() => document.querySelector('#dialog .upick__item[data-key="wgba/io.example.beta/2.0.0.wgba"]')?.dataset.state === "busy", null, { timeout: 10000 });
  await page.waitForTimeout(150);
  const during = await page.evaluate(() => ({ meta: document.querySelector('#dialog .upick__item[data-key="wgba/io.example.beta/2.0.0.wgba"] .upick__meta').textContent, bar: !document.querySelector('#dialog .upick__item[data-key="wgba/io.example.beta/2.0.0.wgba"] .upick__bar').hidden }));
  await page.screenshot({ path: path.join(opt.shots, "06_받는중.png") });
  ok("받는 중 = 줄 진행 막대 · %", during.bar && /내려받는 중 \d+%/.test(during.meta), during.meta);
  await page.waitForFunction(() => document.querySelector('#dialog .upick__item[data-key="wgba/io.example.beta/2.0.0.wgba"]')?.dataset.state === "done", null, { timeout: 30000 });
  ok("하나 받기 → 라이브러리 등록", (await libIds(page)).join() === "io.example.beta@2.0.0", (await libIds(page)).join());
  await page.click('#dialog [data-action="admin-0"]');
  await waitClosed(page);

  await page.click('[data-action="admin-import"]');
  await page.waitForSelector("#dialog .upick__item", { timeout: 20000 });
  const second = await page.$$eval("#dialog .upick__item", (n) => n.map((x) => x.dataset.key));
  ok("이미 등록된 롬 제외", second.length === 2 && !second.some((k) => k.includes("beta")), second.join(" "));
  await page.click("#dialog .zpick__all");
  await page.click('#dialog [data-action="admin-1"]');
  await page.waitForFunction(() => [...document.querySelectorAll("#dialog .upick__item")].every((n) => n.dataset.state === "done"), null, { timeout: 60000 });
  const ids = await libIds(page);
  ok("모두 받기 → 라이브러리 3개", ids.join() === "io.example.alpha@1.2.0,io.example.beta@2.0.0,io.example.gamma@0.3.1", ids.join());
  ok("presigned 주소로만 받음(3번) · 키 파일은 받지 않음", r2.log.filter((l) => l.kind === "presigned").length === 3 && !r2.log.some((l) => l.kind === "presigned" && l.path.endsWith("authentication.key")));
  await page.click('#dialog [data-action="admin-0"]');
  await waitClosed(page);
  await page.click('[data-action="admin-import"]');
  await page.waitForTimeout(1500);
  ok("모두 등록됨 → 목록 창 없음 · 안내", !(await dialogOpen(page)) && /가져올 롬이 없습니다/.test(await toastText(page)), await toastText(page));

  skew += ADMIN.KEY_MS + 120000;
  r2.put("authentication.key", keyFile(PIN, kst(Date.now() + skew)));
  await page.click('[data-action="admin-import"]');
  await page.waitForSelector("#dialog .apad", { timeout: 15000 });
  const againText = await page.textContent("#dialogBody p");
  await page.screenshot({ path: path.join(opt.shots, "07_다시입력.png") });
  ok("키 갱신일자가 활성화 이후 → 롬 가져오기 때 숫자패드 다시", /다시 입력/.test(againText), againText);
  await typePad(page, "999999");
  await (await okButton(page)).click();
  await waitClosed(page);
  await page.waitForTimeout(500);
  ok("다시 입력 실패 → 창 닫힘 · 버튼 사라짐 · 저장 지움", !(await page.$('[data-action="admin-import"]')) && (await stored(page)) === null && /해제했습니다/.test(await toastText(page)), await toastText(page));
  await openSettings(page);
  ok("다시 입력 실패 → 설정도 [입력]", (await page.textContent('[data-action="cfg-admin"]')).trim() === "입력");

  await page.click('[data-action="cfg-admin"]');
  await typePad(page, PIN);
  await (await okButton(page)).click();
  await waitClosed(page);
  await openLibrary(page);
  skew += ADMIN.KEY_MS + 120000;
  r2.put("authentication.key", keyFile(PIN, kst(Date.now() + skew)));
  await page.click('[data-action="admin-import"]');
  await typePad(page, PIN);
  await (await okButton(page)).click();
  await page.waitForTimeout(1500);
  ok("다시 입력 성공 → 활성 유지 · 목록 조회(모두 등록됨 안내)", Boolean(await stored(page)) && Boolean(await page.$('[data-action="admin-import"]')) && /가져올 롬이 없습니다/.test(await toastText(page)), await toastText(page));
  const legacy = await page.evaluate(async () => {
    const { updatePicker } = await import("/js/app/update-pick.js");
    const picker = updatePicker({ items: [{ key: "a", name: "A", kind: "patch", state: "ready", from: "1.0.0", to: "1.1.0", size: 10 }], button: (onClick) => { const b = document.createElement("button"); b.append(Object.assign(document.createElement("span"), { className: "btn__label" })); b.onclick = onClick; return b; }, apply: async () => true, install: async () => true, stop: async () => true });
    return { buttons: picker.node.querySelectorAll(".upick__btn").length, on: picker.chosen().length, bare: picker.node.classList.contains("upick--bare") };
  });
  ok("업데이트 창 기본값 그대로(줄 버튼 있음·처음 체크 켜짐)", legacy.buttons === 1 && legacy.on === 1 && !legacy.bare, JSON.stringify(legacy));
  ok("화면 오류 없음", errors.length === 0, errors.join(" | "));
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
