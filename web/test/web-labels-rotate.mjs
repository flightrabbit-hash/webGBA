// 휴대폰 웹 가상 버튼: ① 화면 방향을 바꿔도 설명서 touchLabel 이 유지되는지(글꼴 확인이 잠깐 실패해도 다시 그림),
// ② 새 터치 자리 role l3(L 바로 아래, 세로 · 가로)와 그 touchLabel · 입력, ③ l3 를 쓰지 않는 기존 게임 화면이 그대로인지(--old 빌드와 비교).
// 헤드리스 Chrome 1개, 서버는 같은 node 안(tools/test/mp-local.mjs), 롬 없는 예제만.
//   node web/test/web-labels-rotate.mjs [--dist <web/dist>] [--old <이전 web/dist>] [--shots <캡처 폴더>] [--dpr 2] [--wgba <실제 게임 .wgba(①만)>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startLocal } from "../../tools/test/mp-local.mjs";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const SHOTS = opt.shots ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const DPR = Number(opt.dpr ?? 2);
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const LIMIT = setTimeout(() => {
  console.error("상한 6분 초과 — 종료");
  process.exit(3);
}, 360000);
let pass = 0;
let fail = 0;
const ok = (name, good, detail = "") => {
  if (good) pass++;
  else fail++;
  console.log(`${good ? "통과" : "실패"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const examples = fileURLToPath(new URL("../../docs/wgba/examples/", import.meta.url));
const read = (dir, file) => fs.readFileSync(path.join(examples, dir, file));
const dirs = [["UP", "up", "ArrowUp"], ["DOWN", "down", "ArrowDown"], ["LEFT", "left", "ArrowLeft"], ["RIGHT", "right", "ArrowRight"]].map(([id, role, code]) => ({ id, role, code }));
const script = async (id, input, extra = {}) => Buffer.from((await packWgba({ wasm: read("hello-script", "game.wasm"), js: read("hello-script", "game.js"), manifest: { ...JSON.parse(read("hello-script", "manifest.json")), id, name: id, input, ...extra } })).bytes);
const webapi = async (id, input) => Buffer.from((await packWgba({ wasm: read("hello-webapi", "game.wasm"), manifest: { ...JSON.parse(read("hello-webapi", "manifest.json")), id, name: id, input } })).bytes);

const GAMES = {
  rotate: opt.wgba
    ? fs.readFileSync(opt.wgba)
    : await script(
        "com.example.labelrotate",
        { preset: "none", buttons: [...dirs, { id: "A", role: "a", code: "KeyX" }, { id: "B", role: "b", code: "KeyZ" }, { id: "C", role: "c", code: "KeyC" }, { id: "D", role: "d", code: "KeyV" }, { id: "L", role: "l", code: "KeyA" }, { id: "CHEAT", role: "r", code: "KeyS", label: { ko: "치트", en: "Cheat", ja: "チート" }, touchLabel: { ko: "치트", en: "CHEAT", ja: "チート" } }, { id: "START", role: "start", code: "Enter" }, { id: "SELECT", role: "select", code: "Backspace" }] },
        { screen: { width: 640, height: 480 }, display: { aspect: "4:3" } },
      ),
  l3: await webapi("com.example.l3", { preset: "gba", buttons: [{ id: "CHEAT", role: "l3", bit: 10, keys: ["KeyQ"], label: "CHEAT", touchLabel: "CHEAT" }] }),
  gba: await webapi("com.example.plaingba", { preset: "gba" }),
  ps1: await script("com.example.ps1", { preset: "none", dpad: "opposite", buttons: [...dirs, { id: "CIRCLE", role: "a", code: "KeyZ", touchLabel: "○" }, { id: "CROSS", role: "b", code: "KeyX", touchLabel: "×" }, { id: "TRIANGLE", role: "c", code: "KeyC", touchLabel: "△" }, { id: "SQUARE", role: "d", code: "KeyV", touchLabel: "□" }, { id: "L1", role: "l", code: "KeyA", touchLabel: "L1" }, { id: "R1", role: "r", code: "KeyS", touchLabel: "R1" }, { id: "START", role: "start", code: "Enter" }, { id: "SELECT", role: "select", code: "Backspace", touchLabel: { ko: "선택", en: "SELECT" } }] }, { screen: { width: 320, height: 240 }, display: { aspect: "4:3" } }),
};

const local = await startLocal(opt.dist ? { dist: path.resolve(opt.dist) } : {});
const old = opt.old ? await startLocal({ dist: path.resolve(opt.old) }) : null;
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

async function openGame(name, viewport, base = local.base) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: DPR, reducedMotion: "reduce", serviceWorkers: "block", locale: "ko-KR" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (!localStorage.getItem("webgba.prefs")) localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko", pad: "on", padSet: true }));
  });
  await context.route(`**/game-${name}.wgba`, (route) => route.fulfill({ body: GAMES[name], contentType: "application/octet-stream" }));
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(async (file) => {
    const buf = await (await fetch(`/${file}`)).arrayBuffer();
    await window.webgba.openFiles([new File([buf], file)]);
  }, `game-${name}.wgba`);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.waitForFunction(() => window.webgba.state.game && !window.webgba.state.opening, null, { timeout: 30000 }).catch(async () => {
    throw new Error(`${name} 열기 실패: ${await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "")} ${errors.join(" / ")}`);
  });
  await page.waitForTimeout(600);
  return { context, page };
}

const look = (page, key) =>
  page.evaluate((key) => {
    const host = document.querySelector(`#pad [data-key="${key}"]`);
    const canvas = host?.querySelector("canvas");
    const now = canvas?.toDataURL() ?? "";
    const keep = { ...window.webgba.skin.labels };
    window.webgba.skin.setLabels({});
    const plain = canvas?.toDataURL() ?? "";
    window.webgba.skin.setLabels(keep);
    const r = host?.getBoundingClientRect();
    return { labels: keep, now, plain, layout: document.body.dataset.layout, box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null, shown: Boolean(host && !host.hasAttribute("data-off") && r.width > 0) };
  }, key);
const boxOf = (page, key) =>
  page.evaluate((key) => {
    const r = document.querySelector(`#pad [data-key="${key}"]`)?.getBoundingClientRect();
    return r && r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, key);
const padState = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const host of document.querySelectorAll("#pad [data-key], #pad [data-dpad]")) {
      const r = host.getBoundingClientRect();
      if (r.width < 1 || host.offsetParent === null) continue;
      out[host.dataset.key ?? "dpad"] = { box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10), png: host.querySelector("canvas")?.toDataURL() ?? "" };
    }
    return out;
  });
async function turn(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(900);
}
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);

// ① 방향을 바꿔도 touchLabel 유지
{
  const { context, page } = await openGame("rotate", PORTRAIT);
  const p1 = await look(page, "R");
  ok("① 세로로 열기 = R 자리 「치트」", p1.labels.R === "치트" && p1.now !== p1.plain, JSON.stringify(p1.labels));
  await page.evaluate(() => {
    const check = document.fonts.check.bind(document.fonts);
    const load = document.fonts.load.bind(document.fonts);
    let ready = false;
    document.fonts.check = (font, text) => ready && check(font, text);
    document.fonts.load = (font, text) =>
      load(font, text).then((faces) => {
        ready = true;
        return faces;
      });
  });
  await turn(page, LANDSCAPE);
  const l1 = await look(page, "R");
  ok("① 세로 → 가로(그 순간 글꼴 확인 실패) = 「치트」로 다시 그림", l1.layout === "landscape" && l1.labels.R === "치트" && l1.now !== l1.plain, l1.now === l1.plain ? "자리 이름 R 로 남음" : "");
  await turn(page, PORTRAIT);
  const p2 = await look(page, "R");
  ok("① 가로 → 세로 = 처음 세로와 같은 「치트」", p2.layout === "portrait" && p2.now === p1.now);
  await context.close();
  const fresh = await openGame("rotate", LANDSCAPE);
  const l0 = await look(fresh.page, "R");
  ok("① 돌린 가로 그림 = 처음부터 가로로 연 그림", l0.now === l1.now && l0.now !== l0.plain);
  await fresh.context.close();
}

// ② l3 자리
{
  const { context, page } = await openGame("l3", PORTRAIT);
  for (const [step, viewport, file] of [["세로", null, "l3_portrait"], ["가로", LANDSCAPE, "l3_landscape"], ["다시 세로", PORTRAIT, "l3_portrait2"]]) {
    if (viewport) await turn(page, viewport);
    const l = await boxOf(page, "L");
    const k = await look(page, "L3");
    const b = k.box && { left: k.box[0], top: k.box[1] };
    const below = Boolean(l && b && b.top >= l.bottom - 1 && b.top - l.bottom < 40 && Math.abs(b.left - l.left) < 2);
    ok(`② ${step}: L3 = L 바로 아래 · 「CHEAT」`, k.shown && below && k.labels.L3 === "CHEAT" && k.now !== k.plain, `L ${l ? [Math.round(l.left), Math.round(l.top), Math.round(l.bottom)] : "없음"} · L3 ${k.box} · ${k.layout}`);
    await shot(page, file);
  }
  await page.evaluate(() => {
    const player = window.webgba.player;
    const log = [];
    const keyDown = player.keyDown.bind(player);
    player.keyDown = (code, event) => {
      const item = { code, hit: player.keymap.get(code) ?? null, held: 0 };
      log.push(item);
      const out = keyDown(code, event);
      item.held = player.held;
      return out;
    };
    window.__l3log = log;
  });
  const b = await page.locator('#pad [data-key="L3"]').boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(200);
  const log = await page.evaluate(() => window.__l3log);
  ok("② L3 누름 = CHEAT 버튼(bit 10) 입력", log.some((item) => item.code === "Pad:L3" && item.hit === 1 << 10 && (item.held & (1 << 10)) !== 0), JSON.stringify(log));
  const key = await page.evaluate(() => window.webgba.player.keymap.get("KeyQ") ?? null);
  ok("② 키보드 KeyQ = 같은 버튼", key === 1 << 10, String(key));
  await context.close();
}

// ③ l3 를 쓰지 않는 기존 게임 = 화면 그대로(L3 자리 없음, --old 빌드와 같은 그림 · 상자)
for (const name of ["gba", "ps1"]) {
  for (const [label, viewport] of [["세로", PORTRAIT], ["가로", LANDSCAPE]]) {
    const now = await openGame(name, viewport);
    const state = await padState(now.page);
    const hidden = await now.page.evaluate(() => document.querySelector('#pad [data-key="L3"]')?.hasAttribute("data-off") ?? true);
    await shot(now.page, `keep_${name}_${viewport === LANDSCAPE ? "landscape" : "portrait"}`);
    await now.context.close();
    let same = "비교 빌드 없음";
    let good = hidden && !state.L3;
    if (old) {
      const before = await openGame(name, viewport, old.base);
      const was = await padState(before.page);
      await before.context.close();
      const diff = [...new Set([...Object.keys(was), ...Object.keys(state)])].filter((k) => JSON.stringify(was[k]) !== JSON.stringify(state[k]));
      same = diff.length ? `다른 자리 ${diff.join(", ")}` : `자리 ${Object.keys(state).length}개 그림 · 상자 같음`;
      good = good && diff.length === 0;
    }
    ok(`③ ${name} ${label}: L3 없음 · 이전 빌드와 같음`, good, same);
  }
}

await browser.close();
await local.close();
await old?.close();
clearTimeout(LIMIT);
console.log(`\n${fail ? "실패 있음" : "모두 통과"} — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
