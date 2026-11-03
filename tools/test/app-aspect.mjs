// 표시 비율 display.aspect(결정 143)·방향 입력 기본값 input.dpad(결정 145) exe 시험.
//   node tools/test/app-aspect.mjs <exe> <작업 폴더> [아케이드 .wgba]
// 작업 폴더 files\ 에 롬 없는 예제(hello-webapi)를 두 가지로 묶는다: 240×160 + display.aspect "4:3" + input.dpad "both", 그리고 그대로.
// 확인: 화면 4:3(캔버스 버퍼 240×160 을 늘림)·정수 배율이면 세로만 정수 배, 방향 both = 대각선 두 비트, 설정 창 방향 값·게임 전용 안내,
// 게임 전용 값 저장(전체 설정 그대로) 후 앱을 다시 켜도 복원, 지정 없는 게임 = 전체 설정. 아케이드 .wgba 는 경로에서 그대로 열어
// 화면 버퍼 비율(448×224 → 2:1)을 보고, 화면 상태만 4:3 으로 바꿔 캡처한다(설명서·파일은 바꾸지 않음). 아케이드 파일은 files\ 에 하드 링크로 열어
// 옆 .sav 가 원래 폴더에 생기지 않게 하고, 끝에 링크를 삭제한다(같은 드라이브가 아니면 원래 경로). 캡처 = <작업>\captures\aspect_*.png
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const [exe, work, arcade] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-aspect.mjs <exe> <작업 폴더> [아케이드 .wgba]");
  process.exit(2);
}

const PORT = 9341;
const appDir = path.join(work, "app-aspect");
const files = path.join(work, "files");
const captures = path.join(work, "captures");
fs.mkdirSync(files, { recursive: true });
fs.mkdirSync(captures, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const T = "window.__WEBGBA_TEST__";
const running = () => runningIn(work);

const example = fileURLToPath(new URL("../../docs/wgba/examples/hello-webapi/", import.meta.url));
const baseManifest = JSON.parse(fs.readFileSync(path.join(example, "manifest.json"), "utf8"));
const wasm = fs.readFileSync(path.join(example, "game.wasm"));
const aspectFile = path.join(files, "hello-aspect.wgba");
const plainFile = path.join(files, "hello.wgba");
fs.writeFileSync(aspectFile, (await packWgba({ wasm, manifest: { ...baseManifest, id: "com.example.hello.aspect", display: { aspect: "4:3" }, input: { preset: "gba", dpad: "both" } } })).bytes);
fs.writeFileSync(plainFile, (await packWgba({ wasm, manifest: baseManifest })).bytes);

const MEASURE = `(() => {
  const s = document.getElementById('stage').getBoundingClientRect();
  const c = document.getElementById('screen');
  const r = c.getBoundingClientRect();
  return { stage: [Math.round(s.width), Math.round(s.height)], css: [r.width, r.height], buffer: [c.width, c.height], screen: ${T}.state.screen, integer: ${T}.state.prefs.scaleMode === 'integer', hidden: c.hidden };
})()`;
const show = (m) => `영역 ${m.stage.join("x")} · 화면 ${m.css.map((v) => Math.round(v)).join("x")} · 버퍼 ${m.buffer.join("x")}${m.integer ? " (정수 배율)" : ""}`;
const DIAG = `(() => { const p = ${T}.player; p.keyDown('ArrowRight'); p.keyDown('ArrowUp'); const bits = p.resolveDpad(p.held); p.keyUp('ArrowUp'); p.keyUp('ArrowRight'); return { mode: p.dpadMode, bits }; })()`;
const waitGame = (app, id) => app.evaluate(`new Promise((r) => { const t = () => (${T}.state.game && ${T}.player.active && (${JSON.stringify(id)} === '' || ${T}.state.input.gameId === ${JSON.stringify(id)}) ? r(true) : setTimeout(t, 50)); t(); })`);
const DPAD_ROW = `[...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('input[name="cfg-dpadMode"]'))`;

async function start(args) {
  launch(path.join(appDir, "webgba.exe"), PORT, args);
  return attach(PORT);
}

async function stop(app) {
  await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
  app.close();
  for (let i = 0; i < 20 && running(); i++) await sleep(250);
}

let app = null;
try {
  guardOthers(exe, work);
  if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  fs.rmSync(appDir, { recursive: true, force: true });
  prepareApp(exe, appDir);
  const cfg = path.join(appDir, "bin", "ini", "personalization.cfg");
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, "utf8")), dpadMode: "opposite", window: { x: 60, y: 60, width: 1100, height: 760, maximized: false } }, null, 2));

  app = await start([aspectFile]);
  await waitGame(app, "com.example.hello.aspect");
  await sleep(300);
  const fit = await app.evaluate(MEASURE);
  check("4:3 게임: 화면 4:3·버퍼 240×160(늘림)", !fit.hidden && Math.abs(fit.css[0] / fit.css[1] - 4 / 3) < 0.01 && fit.buffer.join("x") === "240x160" && fit.screen?.stretch === true, show(fit));
  await app.evaluate(`${T}.state.prefs.scaleMode = 'integer'; window.dispatchEvent(new Event('resize')); true`);
  await sleep(200);
  const integer = await app.evaluate(MEASURE);
  check("4:3 게임 정수 배율: 세로 = 160 의 정수 배·가로 = 세로 × 4/3", integer.css[1] % 160 === 0 && Math.abs(integer.css[0] - Math.round((integer.css[1] * 4) / 3)) <= 1 && integer.css[0] <= integer.stage[0], show(integer));
  await app.screenshot(path.join(captures, "aspect_exe_4대3_정수배율.png"));
  await app.evaluate(`${T}.state.prefs.scaleMode = 'fit'; window.dispatchEvent(new Event('resize')); true`);
  await sleep(150);
  const diag = await app.evaluate(DIAG);
  check("dpad both 게임: 대각선 두 비트(위 + 오른쪽 = 80, 전체 설정 opposite 와 무관)", diag.mode === "both" && diag.bits === 80, JSON.stringify(diag));

  await app.evaluate(`${T}.openSettings('general').then(() => new Promise((r) => setTimeout(() => r(true), 400)))`);
  const row = await app.evaluate(`(() => { const row = ${DPAD_ROW}; row.scrollIntoView({ block: 'center' }); const radios = [...row.querySelectorAll('input[name="cfg-dpadMode"]')]; return { checked: radios.findIndex((n) => n.checked), hint: row.querySelector('.cfg__hint').textContent }; })()`);
  check("설정 창: 방향 값 = 게임 값(모든 입력)·안내 = 게임 전용", row.checked === 0 && (row.hint.includes("안녕 wgba") || row.hint.includes("Hello wgba")), JSON.stringify(row));
  await sleep(200);
  await app.screenshot(path.join(captures, "aspect_exe_설정_게임전용방향.png"));
  await app.evaluate(`(() => { ${DPAD_ROW}.querySelectorAll('input[name="cfg-dpadMode"]')[2].click(); document.getElementById('settings-save').click(); return true; })()`);
  await sleep(600);
  const saved = JSON.parse(fs.readFileSync(cfg, "utf8"));
  const after = await app.evaluate(DIAG);
  check("게임 전용 값 latest 저장(전체 설정 opposite 그대로)·바로 적용(한 비트)", saved.gameDpad?.["com.example.hello.aspect"] === "latest" && saved.dpadMode === "opposite" && after.mode === "latest" && after.bits === 64, JSON.stringify({ gameDpad: saved.gameDpad, dpadMode: saved.dpadMode, after }));
  await app.evaluate(`${T}.settings.close(); true`).catch(() => {});
  await stop(app);
  app = null;

  app = await start([aspectFile]);
  await waitGame(app, "com.example.hello.aspect");
  const restored = await app.evaluate(DIAG);
  check("앱을 다시 켠 뒤 같은 게임 = 저장한 latest 복원", restored.mode === "latest", JSON.stringify(restored));
  await app.evaluate(`${T}.openPath(${JSON.stringify(plainFile)})`);
  await waitGame(app, "com.example.hello");
  const plain = await app.evaluate(DIAG);
  const plainBox = await app.evaluate(MEASURE);
  check("지정 없는 게임 = 전체 설정 opposite(위 + 오른쪽 두 비트)·화면 3:2(늘림 없음)", plain.mode === "opposite" && plain.bits === 80 && Math.abs(plainBox.css[0] / plainBox.css[1] - 1.5) < 0.01 && plainBox.screen?.stretch === false, `${JSON.stringify(plain)} · ${show(plainBox)}`);
  await app.evaluate(`${T}.closeGame()`);
  await sleep(200);
  const closed = await app.evaluate(`${T}.player.dpadMode`);
  check("게임을 닫으면 전체 설정(opposite)", closed === "opposite", closed);

  if (arcade) {
    const linked = path.join(files, "arcade.wgba");
    fs.rmSync(linked, { force: true });
    let opened = arcade;
    try {
      fs.linkSync(arcade, linked);
      opened = linked;
    } catch {}
    await app.evaluate(`${T}.openPath(${JSON.stringify(opened)})`);
    await waitGame(app, "");
    await sleep(2500);
    const own = await app.evaluate(MEASURE);
    check("아케이드 .wgba: 화면 버퍼 비율 2:1(448×224, 늘림 없음)", Math.abs(own.css[0] / own.css[1] - 2) < 0.01 && own.buffer.join("x") === "448x224" && own.screen?.stretch === false, show(own));
    await app.evaluate(`${T}.state.screen = { ...${T}.state.screen, aspect: [4, 3], stretch: true }; window.dispatchEvent(new Event('resize')); true`);
    await sleep(2500);
    const stretched = await app.evaluate(MEASURE);
    check("아케이드 화면 상태 4:3: 화면 4:3·버퍼 448×224", Math.abs(stretched.css[0] / stretched.css[1] - 4 / 3) < 0.01 && stretched.buffer.join("x") === "448x224", show(stretched));
    await app.screenshot(path.join(captures, "aspect_exe_아케이드_4대3.png"));
  }
  await stop(app);
  app = null;
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
  if (app) await stop(app).catch(() => {});
  else if (running()) {
    const left = await connect(PORT, { timeoutMs: 3000 }).catch(() => null);
    if (left) await stop(left).catch(() => {});
  }
} finally {
  fs.rmSync(path.join(files, "arcade.wgba"), { force: true });
  fs.writeFileSync(path.join(work, "app_aspect_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
