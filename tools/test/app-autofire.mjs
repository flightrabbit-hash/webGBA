// 연사(autoFire) exe 시험(실제 앱, CDP) — 식별자를 바꾼 시험 빌드만.
//   node tools/test/app-autofire.mjs <exe> <작업 폴더>
// 설정 창 게임 묶음의 연사 줄(체크)·연사 속도 줄(값 글 + 바): 기본 끔·5단계, 끄면 바 비활성, 줄 안 세로 가운데(체크·값 글·바 가운데 = 줄 가운데, 1px 이하),
// SAVE → 적용·personalization.cfg 저장 → 앱 다시 켜기 복원. 게임에 넘긴 키(host.runFrame 인자)로 끔 = 그대로, 1·9단계 무늬 = 공식.
import fs from "fs";
import path from "path";
import { attach, guardOthers, launch, prepareApp, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-autofire.mjs <exe> <작업 폴더>");
  process.exit(2);
}
const PORT = 9354;
const appDir = path.join(work, "app_autofire");
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const expected = (n, rate) => Array.from({ length: n }, (_, f) => (Math.floor((f * rate) / 30) % 2 === 0 ? 1 : 0)).join("");
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

const example = new URL("../../docs/wgba/examples/hello-webapi/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", example), "utf8"));
const wgba = (await packWgba({ wasm: fs.readFileSync(new URL("game.wasm", example)), manifest })).bytes;
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
const appExe = prepareApp(exe, appDir);
const gameFile = path.join(appDir, "hello.wgba");
fs.writeFileSync(gameFile, wgba);

const HOLD = (code, frames) => `(async () => {
  const p = ${T}.player;
  const host = p.host;
  const log = [];
  const run = host.runFrame.bind(host);
  host.runFrame = (k) => { log.push(k); return run(k); };
  p.keyDown(${JSON.stringify(code)});
  const start = log.length;
  await new Promise((r) => { const w = () => (log.length - start >= ${frames} + 4 ? r() : setTimeout(w, 16)); w(); });
  p.keyUp(${JSON.stringify(code)});
  await new Promise((r) => setTimeout(r, 120));
  host.runFrame = run;
  const bits = log.map((k) => (k & 1 ? "1" : "0")).join("");
  const first = bits.indexOf("1");
  return first < 0 ? "" : bits.slice(first, first + ${frames});
})()`;

const ROWS = `(() => {
  const range = document.querySelector('#settings-body input[data-key="autoFireLevel"]');
  if (!range) return null;
  const level = range.closest(".cfg__row");
  const fire = level.previousElementSibling;
  const box = fire.querySelector("input[type=checkbox]");
  const mid = (n) => { const r = n.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const cap = level.querySelector(".cfg__level-value");
  return {
    fireLabel: fire.querySelector(".cfg__label")?.firstChild?.textContent ?? "",
    checked: box.checked,
    disabled: range.disabled,
    rowOff: level.classList.contains("is-disabled"),
    value: range.value, min: range.min, max: range.max,
    caption: cap.textContent,
    offsets: { box: +(mid(box) - mid(fire)).toFixed(2), caption: +(mid(cap) - mid(level)).toFixed(2), range: +(mid(range) - mid(level)).toFixed(2) },
  };
})()`;

let app = null;
try {
  guardOthers(exe, appDir);
  launch(appExe, PORT, [gameFile]);
  app = await attach(PORT);
  check("exe 가 예제(.wgba) 실행", await waitFor(() => app.evaluate(`${T}.player.running === true`), 20000));
  const off = await app.evaluate(HOLD("KeyZ", 30));
  check("연사 끔(기본): A 를 누르는 동안 매 프레임 그대로", off === "1".repeat(30), off);
  await app.evaluate(`${T}.openSettings("general")`);
  await sleep(500);
  await app.evaluate(`document.querySelector('#settings-body input[data-key="autoFireLevel"]')?.scrollIntoView({ block: "center" })`);
  await sleep(200);
  const rows = await app.evaluate(ROWS);
  const centered = rows && Object.values(rows.offsets).every((v) => Math.abs(v) <= 1);
  check("설정: 연사(체크) + 연사 속도(값 글·바), 기본 끔·5단계 · 끄면 바 비활성 · 줄 안 세로 가운데(1px 이하)", rows && rows.fireLabel === "연사" && !rows.checked && rows.disabled && rows.rowOff && rows.value === "5" && rows.min === "1" && rows.max === "9" && /5단계 · 초당 12회/.test(rows.caption) && centered, JSON.stringify(rows));
  await app.screenshot(path.join(work, "exe_설정_연사_끔.png"));
  await app.evaluate(`(() => {
    const range = document.querySelector('#settings-body input[data-key="autoFireLevel"]');
    const box = range.closest(".cfg__row").previousElementSibling.querySelector("input[type=checkbox]");
    box.click();
    range.value = "9";
    range.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(200);
  const on = await app.evaluate(ROWS);
  check("설정: 켜면 바 활성 · 9단계 글 '초당 30회'", on && on.checked && !on.disabled && !on.rowOff && /9단계 · 초당 30회/.test(on.caption) && Object.values(on.offsets).every((v) => Math.abs(v) <= 1), JSON.stringify(on));
  await app.screenshot(path.join(work, "exe_설정_연사_켬.png"));
  await app.evaluate("document.getElementById('settings-save').click()");
  await sleep(800);
  const applied = await app.evaluate(`({ prefs: [${T}.state.prefs.autoFire, ${T}.state.prefs.autoFireLevel], fire: ${T}.player.autoFire })`);
  check("SAVE → 적용·저장(연사 켬·9단계)", applied.prefs[0] === true && applied.prefs[1] === 9 && applied.fire.on && applied.fire.level === 9, JSON.stringify(applied));
  const nine = await app.evaluate(HOLD("KeyZ", 40));
  check("9단계: 게임 프레임 무늬 = 공식(2프레임마다)", nine === expected(40, 30), nine);
  await app.evaluate(`${T}.player.setAutoFire({ on: true, level: 1 })`);
  const one = await app.evaluate(HOLD("KeyZ", 66));
  check("1단계: 게임 프레임 무늬 = 공식(15프레임마다)", one === expected(66, 4), one);
  const cfg = JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8"));
  check("personalization.cfg 에 autoFire·autoFireLevel 저장", cfg.autoFire === true && cfg.autoFireLevel === 9, JSON.stringify({ autoFire: cfg.autoFire, autoFireLevel: cfg.autoFireLevel }));
  await app.evaluate(`${T}.shutdown()`).catch(() => {});
  app.close();
  app = null;
  await sleep(2500);
  launch(appExe, PORT, [gameFile]);
  app = await attach(PORT);
  await waitFor(() => app.evaluate(`${T}.player.running === true`), 20000);
  const again = await app.evaluate(`${T}.player.autoFire`);
  check("앱 다시 켜기: 연사 켬·9단계 복원", again.on && again.level === 9, JSON.stringify(again));
} catch (error) {
  check("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
} finally {
  if (app) {
    await app.evaluate(`${T}.shutdown()`).catch(() => {});
    app.close();
  }
}
fs.writeFileSync(path.join(work, "app_autofire_result.json"), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\nexe 연사: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
