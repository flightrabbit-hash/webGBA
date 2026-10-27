// 게임 캔버스 맞춤 시험(사용자 2026-10-27): 창 크기별로 처음 켤 때(인자로 게임을 넘김), 도구 막대 접기·펴기, 패널 닫기·열기 뒤
// 캔버스가 오른쪽 영역에 맞는지 잰다. 마우스를 움직이지 않는다.
//   node tools/test/app-layout.mjs <exe> <작업 폴더>
// 앱 폴더는 <작업>\app3 를 새로 만든다. 캡처는 <작업>\captures\layout_*.png
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-layout.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9336;
const appDir = path.join(work, "app3");
const captures = path.join(work, "captures");
const rom = path.join(work, "rom", "test.gba");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const running = () => runningIn(work);

const MEASURE = `(() => {
  const s = document.getElementById('stage').getBoundingClientRect();
  const c = document.getElementById('screen').getBoundingClientRect();
  const integer = window.__WEBGBA_TEST__.state.prefs.scaleMode === "integer";
  const fit = Math.min(s.width / 240, s.height / 160);
  const scale = integer && fit >= 1 ? Math.floor(fit) : fit;
  return { stage: [Math.round(s.width), Math.round(s.height)], canvas: [Math.round(c.width), Math.round(c.height)],
    want: [Math.floor(240 * scale), Math.floor(160 * scale)], integer, hidden: document.getElementById('screen').hidden };
})()`;

function fits(m) {
  return !m.hidden && Math.abs(m.canvas[0] - m.want[0]) <= 1 && Math.abs(m.canvas[1] - m.want[1]) <= 1 && Math.abs(m.canvas[0] * 160 - m.canvas[1] * 240) <= 240;
}
const show = (m) => `영역 ${m.stage.join("x")} · 캔버스 ${m.canvas.join("x")} · 기대 ${m.want.join("x")}${m.integer ? " (정수 배율)" : ""}`;

const CASES = [
  { name: "작게", window: { x: 60, y: 60, width: 700, height: 520, maximized: false } },
  { name: "크게", window: { x: 40, y: 40, width: 1400, height: 1000, maximized: false } },
  { name: "최대화", window: { x: 40, y: 40, width: 960, height: 720, maximized: true } },
];

try {
  guardOthers(exe, work);
  if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  for (const item of CASES) {
    fs.rmSync(appDir, { recursive: true, force: true });
    const appExe = prepareApp(exe, appDir);
    fs.writeFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), JSON.stringify({ window: item.window, panel: "files", wgbaLink: false, exitSave: false }, null, 2));
    launch(appExe, PORT, [rom]);
    const app = await attach(PORT);
    try {
      await app.evaluate("new Promise((r) => { const t = () => (window.__WEBGBA_TEST__.state.game ? r(true) : setTimeout(t, 50)); t(); })");
      const first = await app.evaluate(MEASURE);
      check(`${item.name}: 처음 켜서 게임을 열자마자 캔버스가 영역에 맞음`, fits(first), show(first));
      await sleep(1200);
      const later = await app.evaluate(MEASURE);
      check(`${item.name}: 1초 뒤에도 맞음`, fits(later), show(later));
      await app.evaluate("window.__WEBGBA_TEST__.toggleRail(true)");
      await sleep(150);
      const folded = await app.evaluate(MEASURE);
      check(`${item.name}: 도구 막대를 접은 뒤 맞음(더 넓어짐)`, fits(folded) && folded.canvas[0] >= later.canvas[0], show(folded));
      if (item.name !== "작게") await app.screenshot(path.join(captures, `layout_${item.name}_접음.png`));
      await app.evaluate("window.__WEBGBA_TEST__.toggleRail(false)");
      await sleep(150);
      const opened = await app.evaluate(MEASURE);
      check(`${item.name}: 다시 편 뒤 맞음`, fits(opened), show(opened));
      await app.evaluate("window.__WEBGBA_TEST__.showPanel('files')");
      await sleep(150);
      const noPanel = await app.evaluate(MEASURE);
      check(`${item.name}: 패널을 닫은 뒤 맞음`, fits(noPanel) && noPanel.stage[0] > opened.stage[0], show(noPanel));
      await app.evaluate("window.__WEBGBA_TEST__.showPanel('favorites')");
      await sleep(150);
      const withPanel = await app.evaluate(MEASURE);
      check(`${item.name}: 패널을 연 뒤 맞음`, fits(withPanel), show(withPanel));
      if (item.name === "작게") await app.screenshot(path.join(captures, "layout_작게_패널.png"));
      if (item.name === "크게") {
        await app.evaluate("window.__WEBGBA_TEST__.state.prefs.scaleMode = 'integer'; window.dispatchEvent(new Event('resize')); true");
        await sleep(150);
        const integer = await app.evaluate(MEASURE);
        check(`${item.name}: 정수 배율을 켜면 그 규칙(내림 배율) 그대로`, fits(integer) && integer.integer && integer.canvas[0] % 240 === 0, show(integer));
        await app.evaluate("window.__WEBGBA_TEST__.state.prefs.scaleMode = 'fit'; window.dispatchEvent(new Event('resize')); true");
      }
    } finally {
      await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
      app.close();
      for (let i = 0; i < 20 && running(); i++) await sleep(250);
    }
  }
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
  if (running()) {
    const app = await connect(PORT, { timeoutMs: 3000 }).catch(() => null);
    if (app) {
      await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
      app.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(work, "app_layout_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
