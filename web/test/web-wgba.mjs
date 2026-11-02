// 웹 webGBA .wgba 규격 1 시험(로컬 전용) — 새 형식 열기(code 조각만 컴파일)·옛 형식 그대로·같은 게임 id 업데이트 규칙·
// 옛 .wgba 세이브·퀵슬롯을 게임 id 로 옮기기·못 여는 파일 안내. 새 브라우저 프로필(시험 전용)에서만 돈다.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-wgba.mjs <주소> <캡처 폴더> --new <새 1.2.0.wgba> --old <옛 .wgba> \
//     --v130 <1.3.0(다른 빌드)> --v120d <1.2.0 다른 빌드> --v110d <1.1.0(다른 빌드)> --script <script.wgba> --net <net.wgba> --newer <newer.wgba>
// 롬이 든 시험 파일은 브라우저에서 고르기만 한다(서버로 보내지 않음). 옛·새 파일 이름은 둘 다 firered.wgba(사용자가 파일을 바꿔 넣는 것과 같게).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readWgba } from "../../src-bundle/src/js/core/wgba-read.js";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const URL_BASE = args[0];
const SHOTS = args[1];
const opt = {};
for (let i = 2; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const GAME_ID = "com.flightrabbit.rapid";
// 기대 롬 SHA-1·게임 이름은 --new 파일에서 읽는다(저장소에 롬 SHA-1·고정 이름을 두지 않음 — check-no-rom, 이름이 바뀌어도 시험이 따라감)
const NEW_WGBA = await readWgba(new Uint8Array(fs.readFileSync(opt.new)));
const ROM_SHA1 = NEW_WGBA.romSha1;
const GAME_NAME = typeof NEW_WGBA.manifest.name === "string" ? NEW_WGBA.manifest.name : NEW_WGBA.manifest.name?.en ?? "";
const SHORT_NAME = typeof NEW_WGBA.manifest.shortName === "string" ? NEW_WGBA.manifest.shortName : NEW_WGBA.manifest.shortName?.en ?? "";

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window === window.top) localStorage.setItem("webgba.installHint", "1");
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

async function boot() {
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 20000 });
}

const running = () => page.evaluate(() => document.body.dataset.view === "game" && Boolean(window.webgba.player.running));
const toastText = () => page.textContent("#toast").catch(() => "");

// 파일 고르기(시작 화면 또는 메뉴의 열기). wait: "game" = 게임이 돌 때까지, "dialog" = 대화창, "toast" = 알림 글이 바뀔 때까지
async function pick(file, wait = "game") {
  const started = await page.evaluate(() => document.body.dataset.view === "game");
  const before = await toastText();
  await page.evaluate(() => (window.__lastToast = document.getElementById("toast").textContent));
  if (started && (await page.isVisible("#btnMenu"))) {
    await page.click("#btnMenu");
    await page.waitForSelector(".bar__group--files #btnOpen", { state: "visible" });
  }
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click(started ? "#btnOpen" : "#startOpen")]);
  await chooser.setFiles(file);
  if (wait === "game") {
    await page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
    await page.waitForTimeout(400);
  } else if (wait === "dialog") {
    await page.waitForSelector("#dialog:not([hidden]) #dialogActions .btn", { timeout: 60000 });
  } else {
    await page.waitForFunction((was) => !window.webgba.state.opening && document.getElementById("toast").textContent !== was, before, { timeout: 60000 });
    await page.waitForTimeout(300);
  }
}

const roms = () => page.evaluate(async () => (await window.webgba.store.list("rom")).map((r) => ({ key: r.key, id: r.id, name: r.name, gameId: r.gameId ?? "", version: r.version ?? "", build: r.build ?? "", size: r.size })));
const gameNow = () => page.evaluate(() => {
  const g = window.webgba.state.game;
  return g ? { id: g.id, saveId: g.saveId, gameId: g.gameId, version: g.version, name: g.name, title: g.title } : null;
});
const savesOf = (id) => page.evaluate(async (id) => {
  const bytes = await window.webgba.store.saveBytes(id);
  const states = await window.webgba.store.states(id);
  return { save: bytes ? bytes.length : 0, head: bytes ? Array.from(bytes.subarray(0x7f000, 0x7f004)).join(",") : "", states: states.map((s) => s.slot).sort() };
}, id);
const romSha = () => page.evaluate(async () => {
  const r = window.webgba.player.host?.rom;
  if (!r) return "";
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", r));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
});
const moduleHasRom = () => page.evaluate(() => WebAssembly.Module.customSections(window.webgba.player.host.module, "webgba.rom").length);

try {
  await boot();

  // 1. 옛 형식(목차 없음)으로 세이브·퀵슬롯을 만듦
  await pick(opt.old);
  const oldGame = await gameNow();
  ok("옛 .wgba(목차 없음): 열림 · 세이브 id = 보관 id", oldGame && oldGame.saveId === oldGame.id && !oldGame.gameId, JSON.stringify(oldGame));
  ok("옛 .wgba: 코어가 받은 롬 SHA-1", (await romSha()) === ROM_SHA1);
  ok("옛 .wgba: 지금처럼 파일 전체를 컴파일(모듈에 webgba.rom 구획)", (await moduleHasRom()) === 1);
  await page.waitForTimeout(2500);
  const marked = await page.evaluate(async () => {
    const p = window.webgba.player;
    const at = p.host.ex.Web_GetFlash() >>> 0;
    p.host.u8[at + 0x7f000] ^= 0x5a;
    p.host.u8[at + 0x7f001] ^= 0xa5;
    p.queueSave();
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const one = await p.saveState(1);
    const three = await p.saveState(3);
    return { one, three, live: Array.from(p.host.u8.subarray(at + 0x7f000, at + 0x7f004)).join(",") };
  });
  const oldData = await savesOf(oldGame.id);
  ok("옛 .wgba: 세이브·퀵슬롯 1·3 보관", oldData.save > 0 && oldData.head === marked.live && oldData.states.join() === "1,3", JSON.stringify(oldData));

  // 2. 새 형식(1.2.0) — 같은 게임(롬 SHA-1 같음) → 세이브·퀵슬롯을 게임 id 로 한 번 옮김
  const t0 = Date.now();
  await pick(opt.new);
  const openMs = Date.now() - t0;
  const newGame = await gameNow();
  const toast1 = await toastText();
  ok("새 .wgba: 열림 · 세이브 id = 게임 id", newGame && newGame.saveId === GAME_ID && newGame.version === "1.2.0" && newGame.title === GAME_NAME, JSON.stringify(newGame));
  ok("새 .wgba: code 조각만 컴파일(모듈에 webgba.rom 없음) · 롬 SHA-1", (await moduleHasRom()) === 0 && (await romSha()) === ROM_SHA1, `${openMs}ms`);
  const moved = await savesOf(GAME_ID);
  const left = await savesOf(oldGame.id);
  ok("옮기기: 옛 세이브·퀵슬롯이 게임 id 로(내용 같음)", moved.save === oldData.save && moved.head === oldData.head && moved.states.join() === "1,3", JSON.stringify(moved));
  ok("옮기기: 옛 키는 지움", left.save === 0 && left.states.length === 0, JSON.stringify(left));
  ok("옮기기: 이어받았다는 알림", /이어받았습니다/.test(toast1), toast1);
  let list = await roms();
  ok("옮기기: 라이브러리 항목 하나(옛 항목을 새 것으로 바꿈, 보관 id 그대로)", list.length === 1 && list[0].id === oldGame.id && list[0].gameId === GAME_ID && list[0].version === "1.2.0", JSON.stringify(list));
  const live = await page.evaluate(() => Array.from(window.webgba.player.host.saveData().subarray(0x7f000, 0x7f004)).join(","));
  ok("옮기기: 게임이 옮긴 세이브로 시작", live === oldData.head, live);
  const carts = await page.evaluate(async () => (await window.webgba.store.list("cart")).map((c) => `${c.id}:${c.part}:${c.width}x${c.height}`).sort());
  const wantCarts = Object.entries(NEW_WGBA.images).map(([part, image]) => `${oldGame.id}:${part}:${image.width}x${image.height}`).sort();
  ok("롬팩 그림을 따로 보관(--new 파일의 규격 크기 그림, 옆면은 36x92 일 때만)", carts.join() === wantCarts.join() && carts.some((c) => c.endsWith(":spine:36x92")), carts.join());
  // 퀵슬롯 불러오기(옮긴 칸)
  const loaded = await page.evaluate(async () => {
    const r = await window.webgba.player.loadState(1);
    return { r, kind: window.webgba.player.host.stateLoadedKind };
  });
  ok("옮긴 퀵슬롯 1번 불러오기(같은 빌드 = 그 순간 그대로)", loaded.r === true && loaded.kind === 1, JSON.stringify(loaded));
  await page.click("#btnMenu").catch(() => {});
  await page.waitForSelector(".bar__group--files #btnLibrary", { state: "visible" }).catch(() => {});
  await page.click("#btnLibrary");
  await page.waitForSelector('.lib__card[data-state="open"] .lib__name');
  const libLine = `${await page.textContent(".lib__card .lib__name")} ${await page.textContent(".lib__card .lib__meta")}`;
  const spineText = await page.$$eval(`.spine[data-key="rom:${oldGame.id}"] .spine__line`, (lines) => lines.map((l) => l.textContent).join(" ")).catch(() => "");
  ok(`라이브러리: 꺼낸 롬팩 = 이름·버전(<이름> v1.2.0), 옆면 = 짧은 이름(${SHORT_NAME}, 줄을 공백으로 이어 비교)`, libLine.includes(`${GAME_NAME} v1.2.0`) && spineText === SHORT_NAME, `${libLine} · ${spineText}`);
  await page.screenshot({ path: path.join(SHOTS, "라이브러리_이름버전.png") });
  await page.click("#sheetClose");

  // 3. 새로고침 뒤 라이브러리에서 열기 → 이어서
  await boot();
  await page.click("#startList .recent__item");
  await page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running, null, { timeout: 120000 });
  const again = await gameNow();
  const againLive = await page.evaluate(() => Array.from(window.webgba.player.host.saveData().subarray(0x7f000, 0x7f004)).join(","));
  ok("새로고침 뒤 라이브러리에서 열기: 게임 id 세이브로 이어짐", again.saveId === GAME_ID && againLive === oldData.head && (await moduleHasRom()) === 0, JSON.stringify(again));

  // 4. 업데이트 규칙
  await pick(opt.v130);
  let g = await gameNow();
  let toast = await toastText();
  list = await roms();
  ok("높은 버전(1.3.0): 묻지 않고 업데이트 + 알림 한 줄", g.version === "1.3.0" && /업데이트 1\.2\.0 → 1\.3\.0/.test(toast) && list.length === 1 && list[0].id === oldGame.id, `${toast} · ${JSON.stringify(list)}`);
  ok("업데이트 뒤에도 세이브·퀵슬롯 이어짐", (await savesOf(GAME_ID)).states.join() === "1,3" && g.saveId === GAME_ID);

  await pick(opt.v120d, "dialog");
  const dialog = await page.evaluate(() => ({ title: document.getElementById("dialogTitle")?.textContent ?? document.querySelector("#dialog h2")?.textContent, focus: document.activeElement?.dataset?.action ?? "", text: document.getElementById("dialogBody").textContent }));
  await page.screenshot({ path: path.join(SHOTS, "낮은버전_경고.png") });
  ok("낮은 버전(1.3.0 → 1.2.0): 경고 창 · 기본 단추 = 아니요", /이전 버전/.test(dialog.title) && dialog.focus === "older-keep" && /1\.3\.0/.test(dialog.text) && /1\.2\.0/.test(dialog.text), JSON.stringify(dialog));
  await page.click('[data-action="older-keep"]');
  await page.waitForFunction(() => /엽니다/.test(document.getElementById("toast").textContent) && document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
  list = await roms();
  g = await gameNow();
  ok("낮은 버전 → 아니요: 라이브러리에 있던 1.3.0 을 그대로 엶(결정 102-6)", list.length === 1 && list[0].version === "1.3.0" && g?.version === "1.3.0" && g.saveId === GAME_ID, `${await toastText()} · ${JSON.stringify(g)}`);
  await pick(opt.v120d, "dialog");
  await page.click('[data-action="older-use"]');
  await page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
  toast = await toastText();
  g = await gameNow();
  list = await roms();
  ok("낮은 버전 → 바꾸기: 1.2.0(다른 빌드)으로", g.version === "1.2.0" && /1\.3\.0 → 1\.2\.0/.test(toast) && list.length === 1, toast);
  const buildD = list[0].build;
  await pick(opt.new);
  toast = await toastText();
  list = await roms();
  ok("같은 버전·다른 빌드: 묻지 않고 바꿈", /새 빌드로 바꿨습니다/.test(toast) && list.length === 1 && list[0].build !== buildD, toast);
  await pick(opt.new);
  toast = await toastText();
  ok("같은 빌드: 이미 있음(그대로 엶)", /이미 라이브러리에 있는/.test(toast) && (await roms()).length === 1, toast);
  ok("규칙을 거쳐도 세이브·퀵슬롯은 게임 id 하나", (await savesOf(GAME_ID)).save === oldData.save && (await savesOf(GAME_ID)).states.join() === "1,3");

  // 5. 세이브를 옮긴 뒤 옛 파일을 다시 열면 따로 한 줄 만들지 않고 같은 게임의 "낮은 버전" 경고(결정 102-4)
  await pick(opt.old, "dialog");
  const oldDialog = await page.evaluate(() => ({ title: document.getElementById("dialogTitle").textContent, focus: document.activeElement?.dataset?.action ?? "", text: document.getElementById("dialogBody").textContent }));
  ok("옛 .wgba 다시: 낮은 버전 경고(옛 .wgba · 기본 단추 아니요)", /이전 버전/.test(oldDialog.title) && oldDialog.focus === "older-keep" && /옛 \.wgba/.test(oldDialog.text) && /1\.2\.0/.test(oldDialog.text), JSON.stringify(oldDialog));
  await page.click('[data-action="older-keep"]');
  await page.waitForFunction(() => /엽니다/.test(document.getElementById("toast").textContent) && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
  g = await gameNow();
  list = await roms();
  ok("옛 .wgba → 아니요: 라이브러리의 1.2.0 을 엶 · 항목 하나", g.version === "1.2.0" && g.saveId === GAME_ID && list.length === 1, JSON.stringify(list.map((r) => [r.name, r.gameId, r.version])));
  await pick(opt.old, "dialog");
  await page.click('[data-action="older-use"]');
  await page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
  g = await gameNow();
  list = await roms();
  toast = await toastText();
  const oldLive = await page.evaluate(() => Array.from(window.webgba.player.host.saveData().subarray(0x7f000, 0x7f004)).join(","));
  ok("옛 .wgba → 바꾸기: 같은 항목(보관 id·게임 id 그대로)이 옛 파일로 · 세이브 이어짐", list.length === 1 && list[0].id === oldGame.id && list[0].gameId === GAME_ID && list[0].version === "" && g.saveId === GAME_ID && oldLive === oldData.head && (await moduleHasRom()) === 1 && /옛 \.wgba/.test(toast), `${toast} · ${JSON.stringify(list)}`);
  await pick(opt.new);
  toast = await toastText();
  list = await roms();
  ok("옛 .wgba 로 되돌린 뒤 새 파일: 묻지 않고 업데이트(옛 .wgba → 1.2.0)", list.length === 1 && list[0].version === "1.2.0" && /옛 \.wgba → 1\.2\.0/.test(toast) && (await savesOf(GAME_ID)).states.join() === "1,3", toast);

  // 6. 못 여는 파일
  for (const [key, pattern, label] of [
    ["net", /멀티플레이/, "needs net → 기능 없음"],
    ["newer", /새 규격/, "모르는 needs → 새 webGBA 필요"],
  ]) {
    await pick(opt[key], "toast");
    const text = await toastText();
    const after = await roms();
    ok(`${label}`, pattern.test(text) && !(await running()) && after.length === 1, text);
  }
  // runtime script 는 S4 부터 격리 틀에서 연다(이 작은 예제는 webgba.ready 를 부르지 않아 기다림이 끝난 뒤 돎) — 자세한 것은 web-script.mjs
  await pick(opt.script);
  const scriptOpen = await page.evaluate(() => ({ script: Boolean(window.webgba.player.host?.script), frame: document.querySelector("#screen .script-frame")?.getAttribute("sandbox") ?? "" }));
  ok("runtime script → 격리 틀에서 열림(S4)", scriptOpen.script && scriptOpen.frame === "allow-scripts" && (await running()), JSON.stringify(scriptOpen));
  ok("페이지 오류 없음", errors.length === 0, errors.join(" | "));

  // 7. 이어받기 알림은 옮긴 것에 맞게(결정 102-7): 세이브만 옮기면 "세이브를"(퀵슬롯 말 없음) — 새 프로필에서
  const fresh = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
  await fresh.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window === window.top) localStorage.setItem("webgba.installHint", "1");
  });
  const page2 = await fresh.newPage();
  page2.on("pageerror", (error) => errors.push(error.message));
  await page2.goto(URL_BASE);
  await page2.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 20000 });
  const pick2 = async (file) => {
    const [chooser] = await Promise.all([page2.waitForEvent("filechooser", { timeout: 10000 }), page2.evaluate(() => document.body.dataset.view === "game").then((started) => page2.click(started ? "#btnOpen" : "#startOpen"))]);
    await chooser.setFiles(file);
    await page2.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 120000 });
    await page2.waitForTimeout(400);
  };
  await pick2(opt.old);
  await page2.waitForTimeout(2000);
  await page2.evaluate(async () => {
    const p = window.webgba.player;
    p.host.u8[(p.host.ex.Web_GetFlash() >>> 0) + 0x7f000] ^= 0x11;
    p.queueSave();
    await new Promise((resolve) => setTimeout(resolve, 1600));
  });
  await pick2(opt.new);
  const toast2 = await page2.textContent("#toast");
  ok("세이브만 옮김 → '세이브를 이어받았습니다'(퀵슬롯 말 없음)", /세이브를 이어받았습니다/.test(toast2) && !/퀵슬롯/.test(toast2), toast2);
  await fresh.close();
} catch (error) {
  ok("시험 중 예외", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" "));
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n.wgba 규격 시험 ${results.length - failed.length}/${results.length} 통과`);
fs.writeFileSync(path.join(SHOTS, "결과.json"), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
