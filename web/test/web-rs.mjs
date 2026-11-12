// RS 버튼(결정 178·179) 시험 — 웹(로컬 서버 tools/test/mp-local.mjs 가 web/dist 를 내줌, 롬 없는 예제만).
//   node web/test/web-rs.mjs [--only play,save,ui] [--shots <캡처 폴더>] [--out <결과 json>]
// play = ① 게임에 프레임마다 넘긴 키(host.runFrame 인자)로 순서 재생(누름·간격 프레임 단위)·대각선·누르고 있기·다시 누름·
//        다른 키(키보드·화면 터치·게임패드)로 중단(그 프레임부터 RS 출력 0·그 키 반영)·연사 미적용·빨리 감기 4배·멈춤 중 무시·② 자체 JS 전달.
// save = 설명서 기본 RS(input.rs)·게임마다 저장·다시 열기 복원·사용자 값 우선·기본값으로·모두 지우기·표시 조건(등록·"RS 버튼 표시")·빈 RS 알림.
// ui   = 편집 화면 390x844·844x390·1280x800 × 세 언어: 화면 안·가로 넘침 0·글자 잘림 0·잉크 세로 가운데·같은 줄 버튼 위·아래 일치.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startLocal } from "../../tools/test/mp-local.mjs";
import { decodePng } from "./png.mjs";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const ONLY = new Set(String(opt.only ?? "play,save,ui").split(","));
const SHOTS = opt.shots ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const examples = fileURLToPath(new URL("../../docs/wgba/examples/", import.meta.url));
const read = (name, file) => fs.readFileSync(path.join(examples, name, file));
const pack = async (name, patch = {}) => {
  const manifest = { ...JSON.parse(read(name, "manifest.json")), ...patch };
  const js = fs.existsSync(path.join(examples, name, "game.js")) ? read(name, "game.js") : null;
  return Buffer.from((await packWgba({ wasm: read(name, "game.wasm"), manifest, ...(js ? { js } : {}) })).bytes);
};
const btn = (list) => list.map(([id, role, bit]) => ({ id, role, bit }));
const FIGHT_INPUT = {
  preset: "none",
  dpad: "opposite",
  buttons: btn([["UP", "up", 6], ["DOWN", "down", 7], ["LEFT", "left", 5], ["RIGHT", "right", 4], ["P", "a", 0], ["K", "b", 1], ["BEAST", "c", 10], ["BTN4", "d", 11], ["START", "start", 3], ["COIN", "select", 2]]),
  rs: [{ buttons: ["P", "K"], hold: 6 }],
};
const files = {
  gba: await pack("hello-webapi"),
  fight: await pack("hello-webapi", { id: "com.example.fight", input: FIGHT_INPUT, display: { aspect: "4:3" } }),
  script: await pack("hello-script"),
};

// A=1 B=2 RIGHT=16 UP=64 (GBA 비트)
const STEPS = [
  { keys: ["A"], hold: 3, gap: 2 },
  { keys: ["A"], hold: 2, gap: 4 },
  { keys: ["UP", "RIGHT"], hold: 3, gap: 1 },
  { keys: ["A", "B"], hold: 4, gap: 3 },
];
const SEQ = [1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 80, 80, 80, 0, 3, 3, 3, 3];
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const show = (list) => list.join(",");

const local = await startLocal();
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];

async function newPage({ width = 390, height = 844, prefs = { lang: "ko" }, touch = true } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 3 });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (!localStorage.getItem("webgba.prefs")) localStorage.setItem("webgba.prefs", JSON.stringify(prefs));
  }, prefs);
  for (const [name, bytes] of Object.entries(files)) await context.route(`**/rs-${name}.wgba`, (route) => route.fulfill({ body: bytes, contentType: "application/octet-stream" }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  return { context, page };
}

async function boot(page) {
  await page.goto(local.base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
}

async function openGame(page, name) {
  await page.evaluate(async (name) => {
    const buf = await (await fetch(`/rs-${name}.wgba`)).arrayBuffer();
    await window.webgba.openFiles([new File([buf], `rs-${name}.wgba`)]);
  }, name);
  await page.waitForFunction(() => window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 20000 });
  await page.waitForTimeout(200);
}

// frames 프레임 동안 게임에 넘긴 키를 기록. actions[i] = 프레임 i 를 돌린 직후(다음 프레임 입력 전)에 할 일.
async function record(page, frames, actions) {
  return page.evaluate(
    async ({ frames, actions }) => {
      const p = window.webgba.player;
      const host = p.host;
      const log = [];
      const realPads = navigator.getGamepads?.bind(navigator);
      const padWith = (index) => () => [{ connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === index, value: i === index ? 1 : 0 })) }];
      const act = (a) => {
        const [kind, arg] = a.split(/:(.*)/s);
        if (kind === "rs") p.keyDown("Pad:RS");
        else if (kind === "rs-up") p.keyUp("Pad:RS");
        else if (kind === "down") p.keyDown(arg);
        else if (kind === "up") p.keyUp(arg);
        else if (kind === "pad") navigator.getGamepads = padWith(Number(arg));
        else if (kind === "pad-off") navigator.getGamepads = realPads;
      };
      const run = host.runFrame.bind(host);
      host.runFrame = (keys) => {
        const i = log.length;
        log.push(keys >>> 0);
        const result = run(keys);
        for (const a of actions[i] ?? []) act(a);
        return result;
      };
      await new Promise((resolve) => {
        const wait = () => (log.length >= frames ? resolve() : setTimeout(wait, 16));
        wait();
      });
      host.runFrame = run;
      navigator.getGamepads = realPads;
      p.keyUp("Pad:RS");
      return log.slice(0, frames);
    },
    { frames, actions },
  );
}

const setMacro = (page, steps) => page.evaluate((steps) => window.webgba.player.setMacro(steps), steps);

async function playChecks() {
  const { context, page } = await newPage();
  try {
    await openGame(page, "gba");
    await setMacro(page, STEPS);
    const tap = await record(page, 30, { 2: ["rs", "rs-up"] });
    ok(`한 번 누름: 단계·누름·간격이 프레임 단위로 기대값(누른 다음 프레임부터 ${SEQ.length}프레임, 대각선 ↑+→ 함께, 끝나면 0)`, same(tap.slice(3, 3 + SEQ.length), SEQ) && tap.slice(0, 3).every((k) => k === 0) && tap.slice(3 + SEQ.length).every((k) => k === 0), show(tap));
    const held = await record(page, 50, { 2: ["rs"], 40: ["rs-up"] });
    ok("누르고 있기: 순서 뒤 마지막 단계(A+B)를 계속 누름 · 떼면 다음 프레임부터 0", same(held.slice(3, 3 + SEQ.length), SEQ) && held.slice(3 + SEQ.length, 41).every((k) => k === 3) && held.slice(41).every((k) => k === 0), show(held));
    const key = await record(page, 30, { 2: ["rs", "rs-up"], 8: ["down:KeyX"], 20: ["up:KeyX"] });
    ok("재생 중 키보드 B(KeyX): 그 프레임부터 RS 출력 0·B 만 · 떼면 0", same(key.slice(3, 9), SEQ.slice(0, 6)) && key.slice(9, 21).every((k) => k === 2) && key.slice(21).every((k) => k === 0), show(key));
    const touch = await record(page, 30, { 2: ["rs", "rs-up"], 12: ["down:Pad:LEFT"], 16: ["up:Pad:LEFT"] });
    ok("재생 중 화면 터치 ←(Pad:LEFT): 그 프레임부터 RS 출력 0·← 만", same(touch.slice(3, 13), SEQ.slice(0, 10)) && touch.slice(13, 17).every((k) => k === 32) && touch.slice(17).every((k) => k === 0), show(touch));
    const pad = await record(page, 40, { 2: ["rs", "rs-up"], 9: ["pad:14"], 30: ["pad-off"] });
    const first = pad.findIndex((k) => k & 32);
    ok(`재생 중 게임패드 ←(버튼 14): 처음 들어온 프레임(${first})부터 RS 출력 0·← 만`, first > 3 && same(pad.slice(3, first), SEQ.slice(0, first - 3)) && pad.slice(first, 31).every((k) => k === 32), show(pad));
    const again = await record(page, 40, { 2: ["rs", "rs-up"], 9: ["rs", "rs-up"] });
    ok("재생 중 RS 다시 누름: 다음 프레임부터 처음부터", same(again.slice(3, 10), SEQ.slice(0, 7)) && same(again.slice(10, 10 + SEQ.length), SEQ) && again.slice(10 + SEQ.length).every((k) => k === 0), show(again));
    await page.evaluate(() => window.webgba.player.setAutoFire({ on: true, level: 9 }));
    const fire = await record(page, 30, { 2: ["rs", "rs-up"] });
    const fireUser = await record(page, 12, { 2: ["down:KeyZ"], 10: ["up:KeyZ"] });
    ok("연사 켬(9단계): RS 재생 출력은 그대로(연사 미적용) · 직접 누른 A 는 연사", same(fire.slice(3, 3 + SEQ.length), SEQ) && show(fireUser.slice(3, 9)) === "1,0,1,0,1,0", `${show(fire)} | ${show(fireUser)}`);
    await page.evaluate(() => window.webgba.player.setAutoFire({ on: false, level: 5 }));
    await page.evaluate(() => {
      const p = window.webgba.player;
      p.gameSpeed = 4;
      p.fast = true;
    });
    const fast = await record(page, 40, { 2: ["rs", "rs-up"] });
    ok("빨리 감기 4배에서도 게임 프레임 기준(무늬 같음)", same(fast.slice(3, 3 + SEQ.length), SEQ), show(fast));
    await page.evaluate(() => {
      const p = window.webgba.player;
      p.gameSpeed = 1;
      p.fast = false;
    });
    const paused = await page.evaluate(() => {
      const p = window.webgba.player;
      p.setPaused(true);
      p.keyDown("Pad:RS");
      const playing = p.macroPlaying;
      p.keyUp("Pad:RS");
      p.setPaused(false);
      return playing;
    });
    ok("일시정지 중 RS: 재생하지 않음", paused === false, String(paused));
    const visual = await page.evaluate(async () => {
      const pad = window.webgba.pad;
      window.webgba.layout();
      document.getElementById("pad").toggleAttribute("data-rs", true);
      window.webgba.layout();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rects = pad.measure();
      const rs = rects.keys.find((k) => k.name === "RS");
      return { measured: Boolean(rs), w: rs?.box.width ?? 0 };
    });
    ok("터치 판정 영역(measure)에 RS 칸 포함", visual.measured && visual.w > 0, JSON.stringify(visual));

    await openGame(page, "script");
    const script = await page.evaluate(async () => {
      const p = window.webgba.player;
      const host = p.host;
      const sent = [];
      const real = host.setInput.bind(host);
      host.setInput = (bits) => {
        sent.push(bits >>> 0);
        return real(bits);
      };
      const a = p.bitOf.get(p.layout.buttons.find((b) => b.role === "a")?.id ?? "") ?? 0;
      p.setMacro([{ keys: ["A"], hold: 6, gap: 3 }]);
      p.keyDown("Pad:RS");
      p.keyUp("Pad:RS");
      const first = sent.at(-1) ?? 0;
      await new Promise((r) => setTimeout(r, 400));
      host.setInput = real;
      return { a, first, last: sent.at(-1) ?? -1, on: sent.filter((b) => b & a).length };
    });
    ok("② 자체 JS 게임: 누르면 바로 틀에 A 비트 전달 · 끝나면 0", script.a > 0 && (script.first & script.a) === script.a && script.last === 0 && script.on >= 1, JSON.stringify(script));
  } finally {
    await context.close();
  }
}

const prefsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}"));
const macroOf = (page) => page.evaluate(() => window.webgba.player.macro);
const rsShown = (page) => page.evaluate(() => {
  const node = document.querySelector('#pad [data-key="RS"]');
  return Boolean(node) && document.getElementById("pad").hasAttribute("data-rs") && node.getBoundingClientRect().width > 0;
});
const rsTitle = (page) => page.evaluate(() => document.querySelector('#pad [data-key="RS"]')?.title ?? "");
// 프리셋 막대: "X·1·2…" 칸마다 사용 중 = *, 빈 칸 = _ · 이름 칸 값
const presetState = (page) =>
  page.evaluate(() => ({
    bar: [...document.querySelectorAll("#sheetBody .rs-pick__btn")].map((n) => `${n.dataset.slot === "-1" ? "X" : Number(n.dataset.slot) + 1}${n.hasAttribute("data-empty") ? "_" : ""}${n.getAttribute("aria-checked") === "true" ? "*" : ""}`).join(","),
    name: document.querySelector("#sheetBody .rs-name__input")?.value ?? null,
  }));
const settle = (page) => page.waitForTimeout(200);
async function dialogOk(page) {
  await page.waitForSelector("#dialog:not([hidden]) #dialogActions .btn", { timeout: 5000 });
  await page.click("#dialogActions .btn:last-child");
  await settle(page);
}
const pick = (page, slot) => page.click(`#sheetBody .rs-pick__btn[data-slot="${slot}"]`);

async function saveChecks() {
  const { context, page } = await newPage();
  const FIGHT = "com.example.fight";
  try {
    await openGame(page, "fight");
    const def = await macroOf(page);
    ok("설명서 input.rs(P+K, 6프레임) → 프리셋 1 사용 중 = A+B 6프레임 · RS 버튼 보임 · title '프리셋 1'", JSON.stringify(def) === JSON.stringify([{ keys: ["A", "B"], hold: 6, gap: 3 }]) && (await rsShown(page)) && (await rsTitle(page)) === "프리셋 1", JSON.stringify(def));
    const grab = await record(page, 14, { 2: ["rs", "rs-up"] });
    ok("동물철권형 설명서: RS 한 번 = P·K(비트 0·1) 6프레임", show(grab.slice(3, 10)) === "3,3,3,3,3,3,0", show(grab));
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await settle(page);
    await page.click('#sheetBody [data-action="cfg-rs"]');
    await settle(page);
    const first = await page.evaluate(() => ({ notes: [...document.querySelectorAll("#sheetBody .note")].map((n) => n.textContent), groups: [...document.querySelectorAll("#sheetBody .group__title")].map((n) => n.textContent), hidden: [...document.querySelectorAll("#sheetBody .rs-step__body")].map((n) => n.hidden), head: document.querySelector("#sheetBody .rs-step__title")?.textContent.replace(/​/g, ""), time: document.querySelector("#sheetBody .rs-step__time")?.textContent, foot: [...document.querySelectorAll("#sheetFoot .rs-actions .btn")].map((b) => `${b.dataset.action}${b.disabled ? "(끔)" : ""}`), footShown: !document.getElementById("sheetFoot").hidden }));
    ok("편집 화면: 설명 한 줄 · 프리셋 막대 X·1*·2~5(빈 칸) · 이름 칸 '프리셋 1' · '단계' · 단계 접힘('1단계' · '누름 6프레임') · 하단 고정 단계 추가·초기화(기본과 같아 끔)", first.notes[0] === "RS를 누르면 아래 단계를 순서대로 입력합니다." && JSON.stringify(await presetState(page)) === JSON.stringify({ bar: "X,1*,2_,3_,4_,5_", name: "프리셋 1" }) && first.groups.join("|") === "이 게임의 프리셋|단계" && first.hidden.every(Boolean) && first.head === "1단계" && first.time === "누름 6프레임" && first.footShown && first.foot.join(",") === "rs-add,rs-reset(끔)", JSON.stringify(first));
    await page.click("#sheetBody .rs-step:nth-child(1) .rs-step__toggle");
    const chips = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .rs-key")].filter((n) => n.offsetParent).map((n) => `${n.dataset.key}:${n.dataset.group}:${n.getAttribute("aria-pressed")}`));
    ok("줄을 누르면 펼침: 이 게임 버튼 자리만(L·R 없음) · A·B 켜짐 · 묶음(ab·cd·ss·dir)", !chips.some((c) => /^(L|R):/.test(c)) && chips.includes("A:ab:true") && chips.includes("B:ab:true") && chips.includes("C:cd:false") && chips.includes("START:ss:false") && chips.includes("UP:dir:false"), chips.join(" "));
    await page.click('#sheetBody .rs-key[data-key="UP"]');
    await page.click('#sheetFoot [data-action="rs-add"]');
    await settle(page);
    await page.click('#sheetBody .rs-step:nth-child(2) .rs-key[data-key="C"]');
    await page.fill("#sheetBody .rs-step:nth-child(2) .rs-num__input", "10");
    await page.locator("#sheetBody .rs-step:nth-child(2) .rs-num__input").blur();
    await page.click("#sheetBody .rs-step:nth-child(1) .field:last-child .rs-num .tool--small:last-child");
    await settle(page);
    const want = [{ keys: ["A", "B", "UP"], hold: 6, gap: 4 }, { keys: ["C"], hold: 10, gap: 3 }];
    const edited = (await prefsOf(page)).rsPresets?.[FIGHT];
    ok("편집: ↑ 켜기·단계 추가(새 단계는 펼침)·C·누름 10·간격 +1 → 게임 id 프리셋 1 로 바로 저장·재생기 적용", edited?.active === 0 && JSON.stringify(edited.slots[0]?.steps) === JSON.stringify(want) && edited.slots.slice(1).every((s) => s === null) && JSON.stringify(await macroOf(page)) === JSON.stringify(want), JSON.stringify(edited));
    const heads = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .rs-step")].map((n) => `${n.querySelector(".rs-step__title").textContent.replace(/\u200b/g, "")}|${n.querySelector(".rs-step__time").textContent}|${n.querySelector(".rs-step__body").hidden ? "접힘" : "펼침"}`));
    ok("접힌 줄(키 요약 없음) 시간 줄이 바로 바뀜: '1단계|누름 6 · 간격 4프레임' · '2단계|누름 10프레임'", heads.join(" / ") === "1단계|누름 6 · 간격 4프레임|펼침 / 2단계|누름 10프레임|펼침", heads.join(" / "));
    await page.click("#sheetBody .rs-step:nth-child(2) .rs-step__head .tool--small:nth-child(2)");
    await settle(page);
    const moved = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .rs-step")].map((n) => `${n.querySelector(".rs-step__title").textContent}|${n.querySelector(".rs-step__time").textContent}|${n.querySelector(".rs-step__body").hidden ? "접힘" : "펼침"}`));
    await page.click("#sheetBody .rs-step:nth-child(1) .rs-step__head .tool--small:nth-child(3)");
    await settle(page);
    await page.click("#sheetBody .rs-step:nth-child(2) .rs-step__toggle");
    const toggled = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .rs-step")].map((n) => (n.querySelector(".rs-step__body").hidden ? "접힘" : "펼침")).join(","));
    ok("위·아래 버튼은 접힘을 바꾸지 않고 순서만(펼친 상태도 함께 이동) · 줄을 다시 누르면 접힘", moved.join(" / ") === "1단계|누름 10 · 간격 3프레임|펼침 / 2단계|누름 6프레임|펼침" && toggled === "펼침,접힘" && JSON.stringify((await prefsOf(page)).rsPresets?.[FIGHT]?.slots[0]?.steps) === JSON.stringify(want), `${moved.join(" / ")} · ${toggled}`);
    const resetOn = await page.evaluate(() => !document.querySelector('#sheetFoot [data-action="rs-reset"]').disabled);
    await page.click('#sheetFoot [data-action="rs-reset"]');
    const ask = await page.evaluate(() => ({ title: document.getElementById("dialogTitle").textContent, body: document.getElementById("dialogBody").textContent, buttons: [...document.querySelectorAll("#dialogActions .btn")].map((b) => `${b.textContent}${b.classList.contains("btn--danger") ? "(빨강)" : ""}`) }));
    await dialogOk(page);
    ok("초기화(빨강): 확인 창('프리셋 1을(를) 초기화할까요?' · 취소·초기화) → 프리셋 1 = 설명서 기본(A+B 6프레임) · 다시 끔", resetOn && ask.title === "프리셋 1을(를) 초기화할까요?" && /기본 입력으로 되돌립니다/.test(ask.body) && ask.buttons.join(",") === "취소,초기화(빨강)" && JSON.stringify(await macroOf(page)) === JSON.stringify(def) && (await page.evaluate(() => document.querySelector('#sheetFoot [data-action="rs-reset"]').disabled)), JSON.stringify(ask));
    await page.click("#sheetBody .rs-step:nth-child(1) .rs-step__toggle");
    const resetLive = [];
    for (let i = 0; i < 2; i++) {
      await page.click('#sheetBody .rs-step:nth-child(1) .rs-key[data-key="C"]');
      resetLive.push(await page.evaluate(() => document.querySelector('#sheetFoot [data-action="rs-reset"]').disabled));
    }
    ok("초기화 버튼은 편집하는 즉시 켜지고 기본과 같아지면 다시 끔", resetLive.join() === "false,true", resetLive.join());

    await pick(page, 1);
    await settle(page);
    const second = { state: await presetState(page), macro: await macroOf(page), shown: await rsShown(page), title: await rsTitle(page) };
    const toast = await page.evaluate(() => {
      window.webgba.pad.onChange("RS", true);
      window.webgba.pad.onChange("RS", false);
      return document.getElementById("toast").textContent;
    });
    ok("빈 칸 2 → '프리셋 2' 생성·사용 중(단계 없음) · RS 보임·title '프리셋 2' · 누르면 단계 없음 안내", JSON.stringify(second.state) === JSON.stringify({ bar: "X,1,2*,3_,4_,5_", name: "프리셋 2" }) && second.macro.length === 0 && second.shown && second.title === "프리셋 2" && /단계가 없습니다/.test(toast), JSON.stringify({ second, toast }));
    await page.click('#sheetFoot [data-action="rs-add"]');
    await settle(page);
    await page.click('#sheetBody .rs-step .rs-key[data-key="B"]');
    await page.fill("#sheetBody .rs-name__input", "잡기 콤보 연속 입력 예약");
    await page.press("#sheetBody .rs-name__input", "Enter");
    await settle(page);
    const named = { state: await presetState(page), title: await rsTitle(page), saved: (await prefsOf(page)).rsPresets?.[FIGHT], tip: await page.evaluate(() => document.querySelector('#sheetBody .rs-pick__btn[data-slot="1"]').title) };
    ok("이름 칸 바로 바꾸기: 12자까지('잡기 콤보 연속 입력') · RS title·막대 칸 title 반영 · 프리셋 2 단계 = B", named.state.name === "잡기 콤보 연속 입력" && named.title === "잡기 콤보 연속 입력" && named.tip === "잡기 콤보 연속 입력" && named.saved.slots[1].name === "잡기 콤보 연속 입력" && JSON.stringify(named.saved.slots[1].steps) === JSON.stringify([{ keys: ["B"], hold: 3, gap: 3 }]) && JSON.stringify(await macroOf(page)) === JSON.stringify([{ keys: ["B"], hold: 3, gap: 3 }]), JSON.stringify(named));
    await page.evaluate(() => window.webgba.openSheet("settings"));
    await settle(page);
    const summary = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .field")].find((f) => f.querySelector('[data-action="cfg-rs"]'))?.querySelector(".field__note")?.textContent ?? "");
    ok("설정 'RS 버튼' 줄: 사용 중 프리셋 이름·단계 수", summary === "잡기 콤보 연속 입력 · 1단계", summary);
    await page.click('#sheetBody [data-action="cfg-rs"]');
    await settle(page);
    await pick(page, 0);
    await settle(page);
    ok("1 고르기 → 사용 중 = 설명서 기본(A+B 6프레임)", JSON.stringify(await macroOf(page)) === JSON.stringify(def) && (await rsTitle(page)) === "프리셋 1");
    await pick(page, -1);
    await settle(page);
    const off = await page.evaluate(() => {
      const p = window.webgba.player;
      p.keyDown("Pad:RS");
      const playing = p.macroPlaying;
      p.keyUp("Pad:RS");
      return { playing, steps: document.querySelectorAll("#sheetBody .rs-step").length, name: Boolean(document.querySelector("#sheetBody .rs-name__input")), note: document.querySelector("#sheetBody .rs-off")?.textContent ?? "", foot: !document.getElementById("sheetFoot").hidden };
    });
    ok("X(사용 안함) → RS 숨김·재생 없음 · 이름 줄·단계·하단 버튼 대신 안내 'RS 버튼을 쓰지 않습니다.' · 프리셋 값은 남음", !(await rsShown(page)) && (await macroOf(page)).length === 0 && !off.playing && off.steps === 0 && !off.name && !off.foot && off.note === "RS 버튼을 쓰지 않습니다." && (await prefsOf(page)).rsPresets?.[FIGHT]?.active === -1 && (await prefsOf(page)).rsPresets?.[FIGHT]?.slots[1]?.name === "잡기 콤보 연속 입력", JSON.stringify(off));
    await pick(page, 1);
    await settle(page);
    await page.click('#sheetBody [data-action="rs-remove"]');
    const delAsk = await page.evaluate(() => ({ title: document.getElementById("dialogTitle").textContent, buttons: [...document.querySelectorAll("#dialogActions .btn")].map((b) => b.textContent) }));
    await dialogOk(page);
    ok("사용 중 프리셋 삭제(확인 창 '…을(를) 삭제할까요?' 취소·삭제) → 남은 첫 프리셋(1) 사용 중", delAsk.title === "잡기 콤보 연속 입력을(를) 삭제할까요?" && delAsk.buttons.join(",") === "취소,삭제" && JSON.stringify(await presetState(page)) === JSON.stringify({ bar: "X,1*,2_,3_,4_,5_", name: "프리셋 1" }) && JSON.stringify(await macroOf(page)) === JSON.stringify(def), JSON.stringify(delAsk));
    await pick(page, 3);
    await settle(page);
    await page.click('#sheetFoot [data-action="rs-add"]');
    await settle(page);
    await page.click('#sheetBody .rs-step .rs-key[data-key="D"]');
    await page.evaluate(() => document.getElementById("sheetClose").click());
    await settle(page);

    await openGame(page, "gba");
    ok("다른 게임(GBA, 설명서 RS 없음): 기본 사용 안함 → RS 숨김", (await macroOf(page)).length === 0 && !(await rsShown(page)));
    await page.evaluate(() => {
      window.webgba.state.rsOpen = new Set();
      window.webgba.openSheet("rs");
    });
    await settle(page);
    const gbaFirst = await presetState(page);
    await pick(page, 0);
    await settle(page);
    await page.click('#sheetFoot [data-action="rs-add"]');
    await settle(page);
    await page.click('#sheetBody .rs-step .rs-key[data-key="L"]');
    await page.evaluate(() => document.getElementById("sheetClose").click());
    await settle(page);
    const both = (await prefsOf(page)).rsPresets;
    ok("GBA 게임: 처음 X*·1~5 빈 칸 → 1(L) 만들기 → RS 보임 · 동물철권형 값은 그대로(게임마다 저장)", JSON.stringify(gbaFirst) === JSON.stringify({ bar: "X*,1_,2_,3_,4_,5_", name: null }) && JSON.stringify(both["com.example.hello"]) === JSON.stringify({ active: 0, slots: [{ name: "", steps: [{ keys: ["L"], hold: 3, gap: 3 }] }, null, null, null, null] }) && both[FIGHT].active === 3 && JSON.stringify(both[FIGHT].slots[3].steps) === JSON.stringify([{ keys: ["D"], hold: 3, gap: 3 }]) && (await rsShown(page)), JSON.stringify(both));

    await boot(page);
    await openGame(page, "fight");
    ok("다시 열기: 동물철권형 사용 중 프리셋 4(D) 복원 · title '프리셋 4'", JSON.stringify(await macroOf(page)) === JSON.stringify([{ keys: ["D"], hold: 3, gap: 3 }]) && (await rsTitle(page)) === "프리셋 4" && (await rsShown(page)));
    await boot(page);
    ok("게임 없음: RS 숨김", !(await rsShown(page)));
  } finally {
    await context.close();
  }
}

// ── 편집 화면 UI ──
const INK = 48;
function inkRows(image, dpr, box) {
  const x0 = Math.round(box.left * dpr) + 2;
  const x1 = Math.round(box.right * dpr) - 2;
  const y0 = Math.round(box.top * dpr);
  const y1 = Math.round(box.bottom * dpr);
  const at = (x, y) => (y * image.width + x) * 4;
  const counts = new Map();
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const o = at(x, y);
    const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bg = 0;
  let best = -1;
  for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
  const rgb = [bg >> 16, (bg >> 8) & 255, bg & 255];
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = at(x, y);
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(image.data[o + c] - rgb[c]))) > INK) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  if (first < 0) return null;
  return { top: first - y0, bottom: y1 - 1 - last };
}

async function colorChecks() {
  const { context, page } = await newPage();
  try {
    const rows = await page.evaluate(async () => {
      const PX = await import("/js/pixel-ui.js");
      const theme = await import("/js/shell/theme.js");
      const hue = (hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        if (!d) return { h: 0, s: 0 };
        const l = (max + min) / 2;
        const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return { h: h * 60, s: d / (1 - Math.abs(2 * l - 1)) };
      };
      const apart = (a, b) => {
        const x = hue(a);
        const y = hue(b);
        if (y.s < 0.15 || x.s < 0.15) return 360;
        return Math.round(Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h)));
      };
      const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const out = [];
      for (const mode of theme.MODES.filter((m) => m.id !== "custom")) {
        window.webgba.applyTheme(mode.id);
        const p = window.webgba.skin.palette;
        const groups = Object.fromEntries(["acc", "cd", "ss", "dir"].map((g) => [g, { face: css(`--px-${g}`), ink: css(`--px-${g}-ink`) }]));
        const faces = { ab: p.ab, cd: groups.cd.face, rs: p.rs, ss: groups.ss.face, dir: groups.dir.face };
        const names = Object.keys(faces);
        let nearest = 360;
        for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) nearest = Math.min(nearest, apart(faces[names[i]], faces[names[j]]));
        out.push({
          id: mode.id,
          rs: p.rs,
          ink: p.rsInk,
          contrast: +PX.contrastRatio(p.rs, p.rsInk).toFixed(2),
          ab: apart(p.rs, p.ab),
          cd: apart(p.rs, p.cd),
          sat: +hue(p.rs).s.toFixed(2),
          pillSat: +hue(p.pill).s.toFixed(2),
          keyInk: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, +PX.contrastRatio(v.face, v.ink).toFixed(2)])),
          keySat: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, +hue(v.face).s.toFixed(2)])),
          offGap: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, +PX.contrastRatio(v.face, css("--px-face")).toFixed(2)])),
          offSat: +hue(css("--px-face")).s.toFixed(2),
          danger: +PX.contrastRatio(css("--px-dng"), css("--px-dng-ink")).toFixed(2),
          digits: { saved: +PX.contrastRatio(css("--text"), css("--bg-sunken")).toFixed(2), empty: +PX.contrastRatio(css("--text-faint"), css("--bg-sunken")).toFixed(2), apart: +PX.contrastRatio(css("--text"), css("--text-faint")).toFixed(2) },
          nearest,
          faces,
        });
      }
      return out;
    });
    for (const r of rows) ok(`테마 ${r.id}: RS 색 ${r.rs}·글자 ${r.ink} 대비 ${r.contrast}(4.5 이상) · A·B 와 색상 ${r.ab}° · C·D 와 ${r.cd}° 떨어짐(30° 이상) · 채도 ${r.sat}(SELECT·START ${r.pillSat}보다 큼)`, r.contrast >= 4.5 && r.ab >= 30 && r.cd >= 30 && r.sat > r.pillSat, JSON.stringify(r));
    for (const r of rows) ok(`테마 ${r.id}: 키 칸 켜짐 묶음 색(A·B ${r.faces.ab} · C·D ${r.faces.cd} · SELECT·START ${r.faces.ss} · 방향 ${r.faces.dir}) 글자 대비 4.5 이상(${Object.values(r.keyInk).join("/")}) · A·B·C·D·RS·두 묶음 서로 색상 ${r.nearest}° 이상(30° 이상) · 꺼짐(회색 채도 ${r.offSat})과 구별(채도 차 0.1 이상 또는 밝기 대비 1.5 이상)`, Object.values(r.keyInk).every((c) => c >= 4.5) && r.nearest >= 30 && Object.keys(r.keySat).every((g) => r.keySat[g] > r.offSat + 0.1 || r.offGap[g] >= 1.5), JSON.stringify({ keyInk: r.keyInk, keySat: r.keySat, offGap: r.offGap, nearest: r.nearest }));
    for (const r of rows) ok(`테마 ${r.id}: 프리셋 막대 숫자 — 저장된 번호 ${r.digits.saved}(4.5 이상) · 빈 번호 흐린 글자 ${r.digits.empty}(3 이상) · 두 글자 색 대비 ${r.digits.apart}(1.5 이상)`, r.digits.saved >= 4.5 && r.digits.empty >= 3 && r.digits.apart >= 1.5, JSON.stringify(r.digits));
    for (const r of rows) ok(`테마 ${r.id}: 휴지통(위험) 버튼 그림 대비 ${r.danger}(3 이상)`, r.danger >= 3, String(r.danger));
    ok("테마 12종 모두 확인", rows.length === 12, String(rows.length));
  } finally {
    await context.close();
  }
}

const box = (n) => {
  const b = n.getBoundingClientRect();
  return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
};

// 설정 입력 칸 높이 = 버튼 높이(사용자 2026-11-04): 닉네임 칸 = 선택 칸(36px), RS 이름·숫자 칸 = 옆 버튼, 글자 잉크 세로 가운데.
async function inputChecks() {
  for (const [label, width, height, touch] of [["세로", 390, 844, true], ["가로", 844, 390, true], ["PC", 1280, 800, false]]) {
    const rsPresets = { "com.example.fight": { active: 0, slots: [{ name: "", steps: [{ keys: ["A"], hold: 6, gap: 3 }, { keys: ["B"], hold: 3, gap: 3 }] }, null, null, null, null] } };
    const { context, page } = await newPage({ width, height, touch, prefs: { lang: "ko", pad: "on", padSet: true, rsPresets } });
    await page.addStyleTag({ content: "#toast{visibility:hidden !important}" });
    try {
      await openGame(page, "fight");
      const dpr = await page.evaluate(() => devicePixelRatio);
      await page.evaluate(() => window.webgba.openSheet("settings"));
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector("#sheetBody .cfg-nick").scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      const nick = await page.evaluate(() => {
        const b = (n) => {
          const r = n.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height };
        };
        const input = document.querySelector("#sheetBody .cfg-nick");
        input.value = "가나다ABC";
        return { input: b(input), pick: b(document.querySelector("#sheetBody .pick")), row: b(input.closest(".field")), px: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2 };
      });
      await page.waitForTimeout(200);
      const shot1 = decodePng(await page.screenshot());
      const nickInk = inkRows(shot1, dpr, { left: nick.input.left + 4, right: nick.input.right - 4, top: nick.input.top + nick.px * 2, bottom: nick.input.bottom - nick.px });
      ok(`입력 칸 ${label} ${width}x${height}: 닉네임 칸 높이 = 선택 칸 높이(${nick.input.h}/${nick.pick.h}) · 글자 잉크 세로 가운데(위−아래 ${nickInk ? nickInk.top - nickInk.bottom : "?"} 기기 픽셀, 1 이내)`, Math.abs(nick.input.h - nick.pick.h) < 0.01 && nickInk && Math.abs(nickInk.top - nickInk.bottom) <= 1, JSON.stringify({ input: nick.input.h, pick: nick.pick.h, nickInk }));
      if (SHOTS && label === "세로") await page.screenshot({ path: path.join(SHOTS, `입력칸_닉네임_${label}_${width}x${height}.png`), clip: { x: 0, y: nick.row.top - 8, width, height: nick.row.bottom - nick.row.top + 16 } });
      await page.click('#sheetBody [data-action="cfg-rs"]');
      await page.waitForTimeout(300);
      await page.click("#sheetBody .rs-step:nth-child(1) .rs-step__toggle");
      await page.waitForTimeout(200);
      await page.evaluate(() => document.querySelector("#sheetBody .rs-step .rs-num").scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      const num = await page.evaluate(() => {
        const b = (n) => {
          const r = n.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height };
        };
        const row = document.querySelector("#sheetBody .rs-step .field");
        return { parts: [...row.querySelectorAll(".rs-num > *")].map(b), name: [...document.querySelectorAll("#sheetBody .rs-name > *")].map(b), row: b(row), px: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2 };
      });
      const shot2 = decodePng(await page.screenshot());
      const field = num.parts[1];
      const numInk = inkRows(shot2, dpr, { left: field.left + 4, right: field.right - 4, top: field.top + num.px * 2, bottom: field.bottom - num.px });
      const same = (list) => list.every((p) => Math.abs(p.top - list[0].top) < 0.01 && Math.abs(p.bottom - list[0].bottom) < 0.01);
      ok(`입력 칸 ${label} ${width}x${height}: RS 숫자 칸 높이 = −·+ 버튼(${num.parts.map((p) => p.h).join("/")}) 위·아래 같음 · 이름 칸 = 삭제 버튼(${num.name.map((p) => p.h).join("/")}) · 숫자 잉크 세로 가운데(1 이내)`, same(num.parts) && same(num.name) && numInk && Math.abs(numInk.top - numInk.bottom) <= 1, JSON.stringify({ parts: num.parts.map((p) => [p.top, p.bottom]), name: num.name.map((p) => [p.top, p.bottom]), numInk }));
      if (SHOTS && label === "세로") await page.screenshot({ path: path.join(SHOTS, `입력칸_RS숫자_${label}_${width}x${height}.png`), clip: { x: 0, y: num.row.top - 8, width, height: num.row.bottom - num.row.top + 16 } });
    } finally {
      await context.close();
    }
  }
}

async function uiChecks() {
  await colorChecks();
  await inputChecks();
  const VIEWS = [["세로", 390, 844, true], ["가로", 844, 390, true], ["PC", 1280, 800, false]];
  for (const [label, width, height, touch] of VIEWS) {
    for (const lang of ["ko", "en", "ja"]) {
      const steps = [{ keys: ["A", "B", "C", "D", "SELECT", "START", "UP", "RIGHT"], hold: 6, gap: 3 }, { keys: ["UP", "RIGHT"], hold: 3, gap: 2 }, { keys: ["C"], hold: 4, gap: 3 }];
      const rsPresets = { "com.example.fight": { active: 1, slots: [{ name: "", steps: steps.slice(1) }, { name: "가나다라마바사아자차카타", steps }, { name: "WWWWWWWWWWWW", steps: [] }, null, null] } };
      const { context, page } = await newPage({ width, height, touch, prefs: { lang, pad: "on", padSet: true, rsPresets } });
      await page.addStyleTag({ content: "#toast{visibility:hidden !important}" });
      try {
        await openGame(page, "fight");
        await page.evaluate(() => window.webgba.openSheet("rs"));
        await page.waitForTimeout(500);
        const key = `${label} ${width}x${height} ${lang}`;
        const dpr = await page.evaluate(() => devicePixelRatio);
        const shot = (name) => (SHOTS && lang === "ko" && label === "세로" ? page.screenshot({ path: path.join(SHOTS, `${name}_${label}_${width}x${height}.png`) }) : null);
        const overflow = () =>
          page.evaluate(() => {
            const body = document.getElementById("sheetBody");
            const panel = document.querySelector(".sheet__panel").getBoundingClientRect();
            const clipped = [...document.querySelectorAll("#sheetBody .rs-key__label, #sheetBody .btn__label, #sheetFoot .btn__label, #sheetBody .seg__label, #sheetBody .rs-step__title, #sheetBody .rs-step__time, #sheetBody .group__title, #sheetBody .field__label, #sheetBody .field__note, #sheetBody .note")].filter((n) => n.offsetParent && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
            const name = document.querySelector("#sheetBody .rs-name__input");
            if (name && name.scrollWidth > name.clientWidth + 1) clipped.push(name.value);
            const outside = [...document.querySelectorAll("#sheetBody .rs-step, #sheetBody .rs-step__toggle, #sheetBody .rs-pick__btn, #sheetBody .rs-name > *, #sheetBody .rs-key, #sheetFoot .btn, #sheetBody .tool--small, #sheetBody .rs-num")].filter((n) => {
              const b = n.getBoundingClientRect();
              return b.width > 0 && (b.left < panel.left - 0.5 || b.right > panel.right + 0.5);
            }).length;
            return { hScroll: body.scrollWidth > body.clientWidth + 1, clipped, outside, inView: panel.left >= -0.5 && panel.right <= innerWidth + 0.5 && panel.top >= -0.5 && panel.bottom <= innerHeight + 0.5 };
          });
        const fine = (o) => o.inView && !o.hScroll && !o.clipped.length && !o.outside;
        const frame = () =>
          page.evaluate(() => {
            const b = (n) => {
              const r = n.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, height: r.height };
            };
            const foot = document.getElementById("sheetFoot");
            return { panel: b(document.querySelector(".sheet__panel")), body: b(document.getElementById("sheetBody")), foot: foot.hidden ? null : b(foot), scroll: document.getElementById("sheetBody").scrollTop, overscroll: getComputedStyle(document.getElementById("sheetBody")).overscrollBehaviorY };
          });
        const shut = await overflow();
        ok(`${key}: 편집 화면 안·가로 넘침 0·글자 잘림 0(12자 이름 포함)`, fine(shut), JSON.stringify(shut));
        // 프리셋 막대 X·1~5 + 이름 줄
        const bar = await page.evaluate(() => {
          const b = (n) => {
            const r = n.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          return {
            px: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2,
            btns: [...document.querySelectorAll("#sheetBody .rs-pick__btn")].map((n) => ({ ...b(n), slot: n.dataset.slot, on: n.getAttribute("aria-checked") === "true" })),
            input: b(document.querySelector("#sheetBody .rs-name__input")),
            trash: b(document.querySelector('#sheetBody .rs-name [data-action="rs-remove"]')),
            red: [...document.querySelectorAll('#sheetBody .rs-name [data-action="rs-remove"], #sheetBody .rs-step__head .tool--small:last-child')].map((n) => n.classList.contains("tool--danger") && getComputedStyle(n).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue("--px-dng").trim().replace(/^#(..)(..)(..)$/, (_, r, g, bl) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(bl, 16)})`)),
          };
        });
        const image = decodePng(await page.screenshot());
        const barInk = bar.btns.map((btn) => {
          const ink = inkRows(image, dpr, { left: btn.left, right: btn.right, top: btn.top + bar.px, bottom: btn.bottom - bar.px * 2 });
          return ink ? ink.top - ink.bottom : null;
        });
        const sameRow = bar.btns.every((x) => Math.abs(x.top - bar.btns[0].top) < 0.01 && Math.abs(x.bottom - bar.btns[0].bottom) < 0.01);
        const widths = [...new Set(bar.btns.map((x) => Math.round((x.right - x.left) * dpr)))];
        ok(`${key}: 프리셋 막대 X·1~5 6칸(2 사용 중) — 같은 줄 위·아래 같음 · 같은 폭(기기 픽셀 ${widths.join("/")}) · 글자·아이콘 잉크 세로 가운데(위−아래 ${[...new Set(barInk)].join("/")} 기기 픽셀, 1 이내)`, bar.btns.length === 6 && bar.btns.filter((x) => x.on).map((x) => x.slot).join() === "1" && sameRow && widths.length <= 2 && Math.max(...widths) - Math.min(...widths) <= 1 && barInk.every((d) => d !== null && Math.abs(d) <= 1), JSON.stringify(barInk));
        ok(`${key}: 휴지통 버튼(프리셋 삭제·단계 삭제) 모두 위험 색(빨강)`, bar.red.length >= 2 && bar.red.every(Boolean), JSON.stringify(bar.red));
        const mid = (b) => ((b.top + b.bottom) / 2) * dpr;
        const inputInk = inkRows(image, dpr, { left: bar.input.left + 4, right: bar.input.right - 4, top: bar.input.top + bar.px * 2, bottom: bar.input.bottom - bar.px });
        ok(`${key}: 이름 줄 — 이름 칸·삭제 버튼 가운데 같음(차이 ${Math.round(mid(bar.input) - mid(bar.trash))} 기기 픽셀) · 위·아래 같음 · 이름 글자 잉크 세로 가운데(1 이내)`, Math.abs(mid(bar.input) - mid(bar.trash)) <= 1 && Math.abs(bar.input.top - bar.trash.top) < 0.6 && Math.abs(bar.input.bottom - bar.trash.bottom) < 0.6 && inputInk && Math.abs(inputInk.top - inputInk.bottom) <= 1, JSON.stringify({ input: bar.input, trash: bar.trash, inputInk }));
        const headInfo = () =>
          page.evaluate(() => {
            const b = (n) => {
              const r = n.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            };
            const view = document.getElementById("sheetBody").getBoundingClientRect();
            return [...document.querySelectorAll("#sheetBody .rs-step")].map((card) => {
              const h = card.querySelector(".rs-step__head");
              const hb = h.getBoundingClientRect();
              return { seen: hb.top >= view.top && hb.bottom <= view.bottom, card: b(card), head: b(h), text: b(h.querySelector(".rs-step__text")), icon: b(h.querySelector(".icon")), tools: [...h.querySelectorAll(".tool--small")].map(b), open: !card.querySelector(".rs-step__body").hidden };
            });
          });
        const stepsIntoView = async () => {
          await page.evaluate(() => document.querySelector("#sheetBody .rs-steps").scrollIntoView({ block: "start" }));
          await page.waitForTimeout(120);
        };
        const headCheck = (img, heads, what) => {
          const rows = heads.map((h) => {
            const ink = inkRows(img, dpr, h.text);
            const toolMid = mid(h.tools[0]);
            const textMid = ink ? (h.text.top * dpr + ink.top + h.text.bottom * dpr - ink.bottom) / 2 : null;
            const toolsSame = h.tools.every((t) => Math.abs(t.top - h.tools[0].top) < 0.01 && Math.abs(t.bottom - h.tools[0].bottom) < 0.01);
            return { text: textMid === null ? null : Math.round(textMid - toolMid), icon: Math.round(mid(h.icon) - toolMid), toolsSame, pad: Math.round((h.head.top - h.card.top - (h.card.bottom - h.head.bottom)) * dpr) };
          });
          ok(`${key}: ${what} — 요약 글자 잉크·펼침 아이콘 가운데 = 버튼 가운데(기기 픽셀 1 이내) · 버튼 3개 위·아래 같음`, rows.length && rows.every((r) => r.text !== null && Math.abs(r.text) <= 1 && Math.abs(r.icon) <= 1 && r.toolsSame), JSON.stringify(rows));
          return rows;
        };
        const top = await frame();
        ok(`${key}: 시트 크기 고정(패널 높이 ${Math.round(top.panel.height)}) · 본문만 스크롤(튕김 없음 ${top.overscroll}) · 하단 버튼 줄 고정(패널 아래 끝)`, top.foot && Math.abs(top.foot.bottom - top.panel.bottom) <= 2 && top.body.bottom <= top.foot.top + 0.5 && top.overscroll === "none", JSON.stringify(top));
        await shot("설정편집_프리셋_접힘");
        await stepsIntoView();
        const folded = (await headInfo()).filter((h) => h.seen);
        const foldRows = headCheck(decodePng(await page.screenshot()), folded, "접힌 줄");
        const oneLine = folded.filter((h) => h.text.bottom - h.text.top < 40);
        const heights = [...new Set(oneLine.map((h) => Math.round((h.card.bottom - h.card.top) * dpr)))];
        ok(`${key}: 접힌 줄 상하 여백 같음(카드 위·아래 차이 ${[...new Set(foldRows.map((r) => r.pad))].join("/")} 기기 픽셀) · 요약 한 줄인 접힌 줄 높이 같음(긴 요약은 줄바꿈)`, folded.every((h) => !h.open) && foldRows.every((r) => r.pad === 0) && heights.length <= 1, `높이 ${heights.join("/")}`);
        await page.click("#sheetBody .rs-step:nth-child(1) .rs-step__toggle");
        await page.waitForTimeout(200);
        await stepsIntoView();
        await shot("설정편집_묶음색");
        await page.evaluate(() => {
          for (const tg of document.querySelectorAll('#sheetBody .rs-step__toggle[aria-expanded="false"]')) tg.click();
        });
        await page.waitForTimeout(300);
        const open = await overflow();
        ok(`${key}: 펼친 편집 화면 안·가로 넘침 0·글자 잘림 0`, fine(open), JSON.stringify(open));
        await stepsIntoView();
        headCheck(decodePng(await page.screenshot()), (await headInfo()).filter((h) => h.seen), "펼친 줄");
        const rowsInfo = async () =>
          page.evaluate(() => {
            const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")) || 2;
            const view = document.getElementById("sheetBody").getBoundingClientRect();
            const vis = (n) => {
              const r = n.getBoundingClientRect();
              return r.height > 0 && r.top >= view.top && r.bottom <= view.bottom;
            };
            const b = (n) => {
              const r = n.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            };
            const chips = [...document.querySelectorAll("#sheetBody .rs-key")].filter(vis).map((n) => ({ ...b(n), key: n.dataset.key, on: n.getAttribute("aria-pressed") === "true", bg: getComputedStyle(n).backgroundColor }));
            const fields = [...document.querySelectorAll("#sheetBody .rs-step .field")].filter(vis).map((f) => ({ row: b(f), text: b(f.querySelector(".field__text")), control: b(f.querySelector(".rs-num")), parts: [...f.querySelectorAll(".rs-num > *")].map(b) }));
            const acts = [...document.querySelectorAll("#sheetFoot .rs-actions .btn")].map(b);
            return { px, chips, fields, acts };
          });
        let info = await rowsInfo();
        const img = decodePng(await page.screenshot());
        const chipDiff = [];
        for (const c of info.chips) {
          const ink = inkRows(img, dpr, { left: c.left, right: c.right, top: c.top + info.px, bottom: c.bottom - info.px * 2 });
          if (ink) chipDiff.push(ink.top - ink.bottom);
        }
        const chipSet = [...new Set(chipDiff)];
        ok(`${key}: 키 칸 글자 잉크 세로 가운데(위−아래 기기 픽셀 ${chipSet.join("/")} · 1칸 이내·같은 쪽)`, chipDiff.length > 0 && chipDiff.every((d) => Math.abs(d) <= 1) && (chipSet.length === 1 || chipSet.every((d) => d >= 0) || chipSet.every((d) => d <= 0)), show(chipDiff));
        const onColors = (keys) => [...new Set(info.chips.filter((c) => c.on && keys.includes(c.key)).map((c) => c.bg))];
        const groupBg = { ab: onColors(["A", "B"]), cd: onColors(["C", "D"]), ss: onColors(["SELECT", "START"]), dir: onColors(["UP", "RIGHT"]) };
        const offBg = [...new Set(info.chips.filter((c) => !c.on).map((c) => c.bg))];
        const allBg = Object.values(groupBg).flat();
        ok(`${key}: 켜진 키 칸 묶음 색 4개(A·B·C·D·SELECT·START·방향 묶음마다 한 색, 서로 다름) · 꺼짐 회색 하나`, Object.values(groupBg).every((list) => list.length === 1) && new Set(allBg).size === 4 && offBg.length === 1 && !allBg.includes(offBg[0]), JSON.stringify({ groupBg, offBg }));
        const fieldDiff = info.fields.map((f) => {
          const ink = inkRows(img, dpr, f.text);
          const textMid = ink ? (f.text.top * dpr + ink.top + f.text.bottom * dpr - ink.bottom) / 2 : null;
          const partsSame = f.parts.every((p) => Math.abs((p.top + p.bottom) / 2 - (f.parts[0].top + f.parts[0].bottom) / 2) < 0.01);
          return { d: textMid === null ? null : Math.round(textMid - mid(f.control)), partsSame };
        });
        ok(`${key}: 누름·간격 줄 — 글자 잉크 가운데 = 숫자 칸 가운데(기기 픽셀 1 이내) · −·숫자·+ 가운데 같음`, fieldDiff.length && fieldDiff.every((f) => f.d !== null && Math.abs(f.d) <= 1 && f.partsSame), JSON.stringify(fieldDiff));
        const actInk = info.acts.map((a) => inkRows(img, dpr, { left: a.left + 4, right: a.right - 4, top: a.top + info.px, bottom: a.bottom - info.px * 2 })).map((i) => (i ? i.top - i.bottom : null));
        ok(`${key}: 하단 고정 버튼 2개(단계 추가·초기화) 같은 줄 위·아래 같음 · 잉크 세로 가운데(1 이내)`, info.acts.length === 2 && Math.abs(info.acts[0].top - info.acts[1].top) < 0.01 && Math.abs(info.acts[0].bottom - info.acts[1].bottom) < 0.01 && actInk.every((d) => d !== null && Math.abs(d) <= 1), JSON.stringify({ acts: info.acts.map((a) => [Math.round(a.top), Math.round(a.bottom)]), actInk }));
        await page.evaluate(() => {
          const body = document.getElementById("sheetBody");
          body.scrollTop = body.scrollHeight;
        });
        await page.waitForTimeout(150);
        const end = await frame();
        ok(`${key}: 끝까지 내려도 패널 크기·하단 버튼 줄 자리 그대로`, end.scroll > 0 && end.foot && Math.abs(end.foot.top - top.foot.top) < 0.5 && Math.abs(end.panel.height - top.panel.height) < 0.5, JSON.stringify({ top: top.foot, end: end.foot, scroll: end.scroll }));
        await shot("설정편집_끝까지_하단고정");
        info = await rowsInfo();
        const img2 = decodePng(await page.screenshot());
        const chip2 = info.chips.map((c) => inkRows(img2, dpr, { left: c.left, right: c.right, top: c.top + info.px, bottom: c.bottom - info.px * 2 })).filter(Boolean).map((i) => i.top - i.bottom);
        ok(`${key}: 아래로 굴린 뒤 키 칸 잉크 가운데(1칸 이내)`, chip2.every((d) => Math.abs(d) <= 1), show(chip2));
        await page.evaluate(() => {
          document.getElementById("sheetBody").scrollTop = 0;
        });
        await page.click('#sheetBody .rs-pick__btn[data-slot="-1"]');
        await page.waitForTimeout(300);
        const off = await frame();
        const offNote = await page.evaluate(() => document.querySelector("#sheetBody .rs-off")?.textContent ?? "");
        const offOver = await overflow();
        ok(`${key}: X(사용 안함) — 안내 한 줄 · 하단 버튼 없음 · 패널 크기 그대로(고정) · 넘침 0`, offNote.length > 0 && !off.foot && Math.abs(off.panel.height - top.panel.height) < 0.5 && fine(offOver), JSON.stringify({ offNote, panel: off.panel.height }));
        await shot("설정편집_사용안함");
      } finally {
        await context.close();
      }
    }
  }
}

try {
  if (ONLY.has("play")) await playChecks();
  if (ONLY.has("save")) await saveChecks();
  if (ONLY.has("ui")) await uiChecks();
  ok("페이지 오류 없음", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close().catch(() => {});
  await local.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\nRS 버튼: ${results.length - failed.length}/${results.length} 통과`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
