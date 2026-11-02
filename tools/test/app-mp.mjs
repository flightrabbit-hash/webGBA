// 멀티플레이 MP2 exe 본 창 시험 — 실제 앱(방장)이 짝 찾기 서버로 방을 만들고, 크롬 웹 페이지(손님)가 방 코드로 들어온다.
//   node tools/test/app-mp.mjs <exe> <작업 폴더> <net-webapi 예제 폴더> [--web https://webgba.vercel.app/]
// exe 는 늘 https://webgba.vercel.app/api/v1/mp 를 쓰므로 배포 뒤에 돌린다. 손님 웹 페이지 주소 기본 = 같은 배포.
// 앱 폴더 <작업>\app_mp(레지스트리 안 건드림). 결과 <작업>\app_mp_result.json, 캡처 <작업>\captures\exe_mp_*.png
// 같은 줄 맞춤: 레일(세로) 버튼은 좌·우 위치 차이 0(멀티플레이 켜짐 포함), 연결 창 버튼 줄은 위·아래 차이 0.
// 첫 화면·인터넷 없이 연결 화면은 버튼마다 현재 언어 이름 줄(이름 + 대문자 영어 버튼), 이름·버튼 글자 잉크 세로 가운데(캡처 픽셀).
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { attach, guardOthers, launch, prepareApp, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { decodePng } from "../../web/test/png.mjs";

const [exe, work, example, ...rest] = process.argv.slice(2);
if (!exe || !work || !example) {
  console.error("사용법: node tools/test/app-mp.mjs <exe> <작업 폴더> <net-webapi 예제 폴더> [--web <주소>]");
  process.exit(2);
}
const WEB = rest.includes("--web") ? rest[rest.indexOf("--web") + 1] : "https://webgba.vercel.app/";
const PORT = 9352;
const appDir = path.join(work, "app_mp");
const shots = path.join(work, "captures");
fs.mkdirSync(shots, { recursive: true });
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
async function waitFor(fn, ms = 15000, step = 150) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(step);
  }
  return last;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const wgba = (await packWgba({ wasm: fs.readFileSync(path.join(example, "game.wasm")), manifest: readJson(path.join(example, "manifest.json")) })).bytes;
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
const gameFile = path.join(appDir, "net-demo.wgba");
fs.writeFileSync(gameFile, wgba);

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window === window.top) localStorage.setItem("webgba.installHint", "1");
});
const page = await context.newPage();
const GAME = `(() => { const ex = ${T}.player.host?.ex; return ex?.Net_Hash ? { open: ex.Net_Open(), count: ex.Net_Count(), slot: ex.Net_Slot(), closed: ex.Net_Closed() } : null; })()`;
const webGame = () => page.evaluate(() => {
  const ex = window.webgba.player.host?.ex;
  return ex?.Net_Hash ? { open: ex.Net_Open(), count: ex.Net_Count(), slot: ex.Net_Slot(), closed: ex.Net_Closed() } : null;
});
const RAIL = `(() => [...document.querySelectorAll(".railbar .iconbtn")].filter((n) => !n.hidden && n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); return { id: n.id, left: r.left, right: r.right, w: r.width, h: r.height, on: n.getAttribute("aria-pressed") }; }))()`;
const ACTIONS = `(() => [...document.querySelectorAll("#dialog-actions > button, #dialog-body .net-line")].map((n) => n.matches(".net-line") ? [...n.querySelectorAll(":scope > button, :scope > input")] : [n]).filter((g) => g.length).map((g) => g.map((n) => { const r = n.getBoundingClientRect(); return { a: n.dataset.action || n.textContent, top: r.top, bottom: r.bottom }; })))()`;
const spread = (list, k) => +(Math.max(...list.map((i) => i[k])) - Math.min(...list.map((i) => i[k]))).toFixed(2);
const ko = readJson(fileURLToPath(new URL("../../src-bundle/src/i18n/ko.json", import.meta.url)));
const ENTRIES = `[...document.querySelectorAll("#dialog-body .net-entry")].map((n) => ({ label: n.querySelector(".net-entry__label")?.textContent ?? "", button: n.querySelector("button")?.textContent ?? "" }))`;
const ROWS = `[...document.querySelectorAll("#dialog-body .net-entry, #dialog-body .net-offline")].filter((n) => !n.hidden).map((n) => { const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }; return { name: n.querySelector("button").textContent, row: box(n), label: box(n.querySelector("span")), button: box(n.querySelector("button")) }; })`;

// ink rows of a box in device pixels: the first and last rows with non-background pixels (the background = the box's most common colour)
function inkRows(image, x0, x1, y0, y1) {
  const px = (x, y) => {
    const o = (y * image.width + x) * 4;
    return [image.data[o], image.data[o + 1], image.data[o + 2]];
  };
  const counts = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) counts.set(px(x, y).join(), (counts.get(px(x, y).join()) ?? 0) + 1);
  const bg = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (Math.max(...px(x, y).map((v, i) => Math.abs(v - bg[i]))) > 48) {
        if (first < 0) first = y;
        last = y;
        break;
      }
  return first < 0 ? null : { first, last };
}

// the name's ink centred in its row and the button as tall as the row. Gaps from the row's exact edges: the dialog sits on a
// half CSS pixel when its height is odd and the glyphs snap to whole device pixels, so ≤ 2 device pixels apart (a 1 CSS px miss
// is 3 at 1.5x). The button's own caps sit 1 CSS px low in every exe .btn (font: 600 12px/1) - reported in `text`, not judged here.
async function entryInks() {
  const rows = await app.evaluate(ROWS);
  const dpr = await app.evaluate("devicePixelRatio");
  const image = decodePng(Buffer.from((await app.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const inset = Math.ceil(dpr) + 1;
  const gaps = (ink, top, bottom) => ink && { top: +(ink.first - top).toFixed(1), bottom: +(bottom - ink.last - 1).toFixed(1) };
  return rows.map((r) => {
    const d = (v) => Math.round(v * dpr);
    const label = gaps(inkRows(image, d(r.label.left), d(r.label.right), d(r.row.top), d(r.row.bottom)), r.row.top * dpr, r.row.bottom * dpr);
    const text = gaps(inkRows(image, d(r.button.left) + inset, d(r.button.right) - inset, d(r.button.top) + inset, d(r.button.bottom) - inset), r.button.top * dpr, r.button.bottom * dpr);
    const ok = Boolean(label) && Math.abs(label.top - label.bottom) <= 2 && r.button.top === r.row.top && r.button.bottom === r.row.bottom;
    return { name: r.name, label: label && `${label.top}/${label.bottom}`, text: text && `${text.top}/${text.bottom}`, ok };
  });
}

let app = null;
try {
  guardOthers(exe, appDir);
  const appExe = prepareApp(exe, appDir);
  launch(appExe, PORT, [gameFile]);
  app = await attach(PORT);
  check("exe 가 net 예제(.wgba) 실행", await waitFor(() => app.evaluate(`${T}.player.running === true`), 20000));
  await app.evaluate(`(() => { const p = ${T}.player; p.keyDown("KeyZ"); setTimeout(() => p.keyUp("KeyZ"), 150); return true; })()`);
  const layer = await waitFor(() => app.evaluate("!document.getElementById('layer').hidden && Boolean(document.querySelector('#dialog-body [data-action=net-room-make]'))"), 8000);
  check("exe: 연결 창 첫 화면(방 만들기·코드로 들어가기·근처 방·인터넷 없이 연결)", layer && (await app.evaluate("Boolean(document.querySelector('[data-action=net-room-join]') && document.querySelector('[data-action=net-offline]') && document.querySelector('.net-near-box'))")));
  const entries = await app.evaluate(ENTRIES);
  check("exe: 첫 화면 버튼마다 현재 언어 이름 줄(방 만들기 HOST · 코드로 들어가기 CODE)", entries.map((e) => `${e.label}|${e.button}`).join(",") === `${ko["net.make"]}|HOST,${ko["net.codeJoin"]}|CODE`, JSON.stringify(entries.map((e) => `${e.label}|${e.button}`)));
  const near = await waitFor(() => app.evaluate("(() => { const t = document.querySelector('.net-near-box')?.textContent ?? ''; return /…/.test(t) ? '' : t; })()"), 10000);
  check("exe: 근처 방 영역 서버 응답(목록 또는 없음 안내)", near && !/불러오지 못했/.test(near), near);
  await sleep(300);
  const inks = await entryInks();
  check("exe: 첫 화면 이름 줄 잉크 세로 가운데(이름 위·아래 차이 ≤ 2 기기 픽셀, 버튼 위·아래 = 줄 위·아래)", inks.length === 3 && inks.every((i) => i.ok), JSON.stringify(inks));
  await app.screenshot(path.join(shots, "exe_mp_첫화면.png"));
  await app.evaluate("document.querySelector('[data-action=net-offline]').click()");
  await sleep(300);
  const lan = await app.evaluate(ENTRIES);
  const lanInks = await entryInks();
  check("exe: 인터넷 없이 연결 화면 이름 줄(방 만들기 HOST · 참가하기 JOIN)·잉크 세로 가운데", lan.map((e) => `${e.label}|${e.button}`).join(",") === `${ko["net.make"]}|HOST,${ko["net.join"]}|JOIN` && lanInks.length === 2 && lanInks.every((i) => i.ok), JSON.stringify({ lan, lanInks }));
  await app.evaluate("document.querySelector('[data-action=net-back]').click()");
  await waitFor(() => app.evaluate("Boolean(document.querySelector('#dialog-body [data-action=net-room-make]'))"), 3000);
  await app.evaluate("document.querySelector('[data-action=net-room-make]').click()");
  const code = await waitFor(() => app.evaluate("(() => { const t = document.querySelector('.net-room-code')?.textContent ?? ''; return /^\\d{6}$/.test(t) ? t : ''; })()"), 15000);
  check("exe: 서버로 방 만들기 → 방 코드 6자리", /^\d{6}$/.test(code ?? ""), code);
  await sleep(300);
  await app.screenshot(path.join(shots, "exe_mp_방코드.png"));
  const rows = await app.evaluate(ACTIONS);
  check("exe: 연결 창 버튼 줄 위·아래 차이 0", rows.every((g) => g.length < 2 || (spread(g, "top") === 0 && spread(g, "bottom") === 0)), JSON.stringify(rows.map((g) => g.map((i) => `${i.a}:${i.top}-${i.bottom}`))));

  const t0 = Date.now();
  await page.goto(WEB);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], "net-demo.wgba")]);
  }, Buffer.from(wgba).toString("base64"));
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });
  await page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("KeyZ");
    setTimeout(() => p.keyUp("KeyZ"), 150);
  });
  await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await page.click('[data-action="net-room-join"]');
  await page.fill('[data-action="net-code-in"]', code);
  await page.click('[data-action="net-code-go"]');
  const joined = await waitFor(async () => (await webGame())?.open === 1 && (await app.evaluate(GAME))?.count === 2, 30000, 200);
  const calls = { host: await app.evaluate(`${T}.netWin?.signal?.calls ?? -1`).catch(() => -1), guest: await page.evaluate(() => window.webgba.net.win.signal.calls) };
  check(`exe(방장) ↔ 크롬(손님) 방 코드로 연결(${Date.now() - t0}ms)`, joined, JSON.stringify({ calls, host: await app.evaluate(GAME), guest: await webGame() }));
  await sleep(500);
  await app.screenshot(path.join(shots, "exe_mp_연결됨.png"));
  await app.evaluate("document.querySelector('[data-action=net-done]')?.click()");
  await sleep(600);
  const rail = await app.evaluate(RAIL);
  check("exe: 레일 버튼 좌·우 위치·크기 같음(멀티플레이 켜짐 포함)", rail.some((b) => b.id === "btn-net" && b.on === "true") && spread(rail, "left") === 0 && spread(rail, "right") === 0 && spread(rail, "w") === 0 && spread(rail, "h") === 0, JSON.stringify(rail.map((b) => `${b.id}:${b.left}-${b.right}${b.on === "true" ? "(켜짐)" : ""}`)));
  await app.evaluate(`${T}.player.net.leave()`);
  check("exe 방장 나감 → 웹 손님 CLOSED(HOST_LEFT)", await waitFor(async () => ((await webGame())?.closed === 7 ? true : null), 8000));
} catch (error) {
  check("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
} finally {
  if (app) {
    try {
      await app.evaluate(`${T}.shutdown()`);
    } catch {}
    app.close();
  }
  await browser.close().catch(() => {});
}
fs.writeFileSync(path.join(work, "app_mp_result.json"), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\nexe 멀티플레이 MP2: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
