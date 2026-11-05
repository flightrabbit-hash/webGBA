// exe 기록(log) 시험(설계 32절) — 시험 식별자 exe 를 CDP 로 다뤄 bin/log 의 줄을 확인한다. 레지스트리는 건드리지 않음.
//   node tools/test/app-log.mjs <exe> <작업 폴더> <롬.gba> <.wgba>
// 롬·.wgba 는 <작업>\games 에 하드 링크(읽기만, 세이브는 그 옆에 생김). 앱 폴더 <작업>\app_log, 결과 <작업>\app_log_result.json.
// 창 최소화·복원은 window-show.ps1(마우스 움직임 없음). 웹뷰 감시 확인에 화면을 19초 막는다.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { attach, guardOthers, launch, prepareApp, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const [exe, work, romSrc, wgbaSrc] = process.argv.slice(2);
if (!exe || !work || !romSrc || !wgbaSrc) {
  console.error("사용법: node tools/test/app-log.mjs <exe> <작업 폴더> <롬.gba> <.wgba>");
  process.exit(2);
}

const PORT = 9351;
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const appDir = path.join(work, "app_log");
const gameDir = path.join(work, "games");
fs.mkdirSync(gameDir, { recursive: true });
const link = (from, name) => {
  const to = path.join(gameDir, name);
  if (!fs.existsSync(to)) fs.linkSync(from, to);
  return to;
};
const rom = link(romSrc, "test.gba");
const wgba = link(wgbaSrc, "game.wgba");
const sha8 = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);

const logDir = path.join(appDir, "bin", "log");
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));
const todayFile = () => path.join(logDir, `${ymd(new Date())}.log`);
const readLog = () => (fs.existsSync(todayFile()) ? fs.readFileSync(todayFile(), "utf8") : "");
const lineCount = () => readLog().split("\n").length - 1;
const short = (line) => line?.slice(13) ?? "없음";

async function start({ fresh = true, seed = null } = {}) {
  guardOthers(exe, work);
  if (fresh) fs.rmSync(appDir, { recursive: true, force: true });
  const appExe = prepareApp(exe, appDir);
  fs.mkdirSync(logDir, { recursive: true });
  seed?.();
  const child = launch(appExe, PORT);
  return { app: await attach(PORT), pid: child.pid };
}

async function waitLine(re, ms = 8000, from = 0) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = readLog().split("\n").slice(from).find((line) => re.test(line));
    if (hit) return hit;
    await sleep(150);
  }
  return null;
}

const running = () => (spawnSync("powershell", ["-NoProfile", "-Command", `Get-Process webgba -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${appDir.replace(/'/g, "''")}*' } | Measure-Object | ForEach-Object Count`], { encoding: "utf8" }).stdout ?? "0").trim() !== "0";
async function shutdown(app) {
  try {
    await app.evaluate(`${T}.shutdown()`);
  } catch {}
  app.close();
  for (let i = 0; i < 50 && running(); i++) await sleep(200);
}
const windowDo = (pid, action) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "window-show.ps1"), String(pid), action], { encoding: "utf8" }).stdout.trim();
const pauseKey = async (app) => {
  await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "Pause", key: "Pause", windowsVirtualKeyCode: 19 });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Pause", key: "Pause", windowsVirtualKeyCode: 19 });
};

const old = [daysAgo(20), daysAgo(14), daysAgo(13)];
let { app, pid } = await start({
  seed: () => {
    for (const day of old) fs.writeFileSync(path.join(logDir, `${day}.log`), "old\n");
    fs.writeFileSync(path.join(logDir, "keep-me.log"), "keep\n");
  },
});
try {
  check("앱 시작 줄(버전·앱 폴더·프로세스)", await waitLine(/\[INFO\] \[앱\] webGBA \d+\.\d+\.\d+ 시작 · 앱 폴더 .* · 프로세스 \d+/));
  const ready = await waitLine(/\[앱\] 화면 준비 · WebView2 [\d.]+ · CPU \d+개 · 화면 \d+×\d+/);
  check("화면 준비 줄(WebView2·CPU·화면)", ready, short(ready));
  const pruned = await waitLine(/\[기록\] 14일 지난 기록 파일 2개 삭제/);
  check("오래된 파일 삭제(20·14일 전 삭제, 13일 전·다른 이름 유지)", pruned && !fs.existsSync(path.join(logDir, `${old[0]}.log`)) && !fs.existsSync(path.join(logDir, `${old[1]}.log`)) && fs.existsSync(path.join(logDir, `${old[2]}.log`)) && fs.existsSync(path.join(logDir, "keep-me.log")), fs.readdirSync(logDir).join(", "));
  await app.evaluate(`document.querySelector('[data-menu="setting"]').click(), true`);
  await sleep(300);
  const menu = await app.evaluate(`[...document.querySelectorAll('#menu .menu__label')].map((n) => n.textContent)`);
  await app.evaluate(`document.querySelector('[data-menu="setting"]').click(), true`);
  const logDirInfo = await app.evaluate(`${T}.state.info.logDir`);
  check("설정 메뉴 '로그 폴더 열기'(앱 폴더 열기 다음) · logDir = 앱 bin\\log", menu.indexOf("로그 폴더 열기") === menu.indexOf("앱 폴더 열기") + 1 && path.resolve(logDirInfo) === path.resolve(logDir), menu.slice(-2).join(" | "));

  await app.evaluate(`window.__TAURI_INTERNALS__.invoke("log_lines", { lines: [
    { level: "INFO", text: "[멀티플레이] 방 629336 만듦(근처 칸 6)", at: Date.now() },
    { level: "WARN", text: "[시험] 경로 C:\\\\Users\\\\tester\\\\게임\\\\a.wgba · url?token=abc123&x=1", at: Date.now() }
  ] }).then(() => true)`);
  const room = await waitLine(/\[멀티플레이\] 방 \*\*\* 만듦/);
  const masked = await waitLine(/\[시험\] 경로 ~\\게임\\a\.wgba · url\?token=\*\*\*&x=1/);
  check("가림: 방 코드·사용자 폴더·토큰", room && masked && !/629336|tester|abc123/.test(readLog()), `${short(room)} | ${short(masked)}`);

  let from = lineCount();
  await app.evaluate(`${T}.openPath(${JSON.stringify(rom)})`);
  const openGba = await waitLine(new RegExp(`\\[게임\\] 열기 · GBA · test\\.gba · 롬 SHA-1 ${sha8(rom)} · runtime mGBA 코어 · `), 8000, from);
  check("게임 열기 .gba(종류·이름·롬 SHA-1·runtime)", openGba, short(openGba));
  await sleep(1000);

  from = lineCount();
  await app.evaluate(`document.getElementById('btn-pause').click(), true`);
  await sleep(200);
  await pauseKey(app);
  await sleep(200);
  await app.evaluate(`document.getElementById('btn-fast').click(), true`);
  await sleep(500);
  await app.evaluate(`document.getElementById('btn-fast').click(), true`);
  const p1 = await waitLine(/\[실행\] 일시정지 · 사용자\(버튼\)/, 3000, from);
  const p2 = await waitLine(/\[실행\] 재개 · 사용자\(Pause 키\)/, 3000, from);
  const f1 = await waitLine(/\[실행\] 빨리 감기 켬 · 4배/, 3000, from);
  const f2 = await waitLine(/\[실행\] 빨리 감기 끔 · 1배/, 3000, from);
  check("일시정지·재개 이유(버튼·Pause 키) · 빨리 감기 켬·끔", p1 && p2 && f1 && f2);

  from = lineCount();
  await app.evaluate(`${T}.saveStateTo(1)`);
  await app.evaluate(`${T}.loadStateFrom(1)`);
  await app.evaluate(`${T}.loadStateFrom(8)`);
  const q1 = await waitLine(/\[퀵슬롯\] 저장 1번 · 성공 · \d+KB · \d+ms/, 3000, from);
  const q2 = await waitLine(/\[퀵슬롯\] 불러오기 1번 · 성공 · \d+KB · \d+ms/, 3000, from);
  const q3 = await waitLine(/\[퀵슬롯\] 불러오기 8번 · 빈 칸 · \d+ms/, 3000, from);
  check("퀵슬롯 저장·불러오기·빈 칸", q1 && q2 && q3, [q1, q2, q3].map(short).join(" | "));

  from = lineCount();
  windowDo(pid, "minimize");
  await sleep(1500);
  windowDo(pid, "restore");
  const m1 = await waitLine(/\[실행\] 창 최소화$/, 4000, from);
  const m2 = await waitLine(/\[실행\] 창 최소화 풀림$/, 4000, from);
  check("창 최소화·풀림(Rust 창 이벤트)", m1 && m2);
  if (await app.evaluate(`${T}.player.paused`)) await app.evaluate(`document.getElementById('btn-pause').click(), true`);

  from = lineCount();
  await app.evaluate(`(() => { const t = performance.now(); while (performance.now() - t < 1500) {} return true; })()`);
  const s1 = await waitLine(/\[멈춤\] 화면 갱신이 1\.\d초 멈췄다가 이어짐/, 4000, from);
  from = lineCount();
  await app.evaluate(`(() => { const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; setTimeout(() => { window.requestAnimationFrame = raf; ${T}.player.raf = raf(${T}.player.tick); }, 4500); return true; })()`);
  const s2 = await waitLine(/\[멈춤\] 화면 갱신\(requestAnimationFrame\)이 3\.\d초째 오지 않음 · 페이지 스크립트는 응답함/, 8000, from);
  const s3 = await waitLine(/\[멈춤\] 화면 갱신 다시 옴/, 8000, from);
  from = lineCount();
  await app.evaluate(`(() => { const t = performance.now(); while (performance.now() - t < 19000) {} return true; })()`);
  const s4 = await waitLine(/\[WARN\] \[멈춤\] 화면\(웹뷰\)이 15초 넘게 응답하지 않음/, 4000, from);
  const s5 = await waitLine(/\[멈춤\] 화면\(웹뷰\) 응답 다시 옴 · 약 \d+초 응답 없었음/, 8000, from);
  check("멈춤: 1.5초 막힘 뒤 한 줄 · rAF 만 멈춤 3초째·다시 옴 · 웹뷰 19초 막힘(Rust 감시)·다시 옴", s1 && s2 && s3 && s4 && s5, [s1, s2, s4, s5].map(short).join(" | "));

  const perf = await waitLine(/\[INFO\] \[성능\] 3\d\.\d초 · 평균 [\d.]+fps · 프레임 처리 평균 [\d.]+ms·최장 [\d.]+ms · 16\.7ms 넘은 프레임 \d+ · 화면 간격 최장 \d+ms\(25ms 넘음 \d+\)/, 40000);
  check("성능 요약 30초 실행마다 한 줄", perf, short(perf));

  from = lineCount();
  await app.evaluate(`(() => { for (let i = 0; i < 3; i++) setTimeout(() => { throw new Error("APP-LOG-PROBE"); }, 0); Promise.reject(new TypeError("APP-LOG-PROBE-P")); return true; })()`);
  const e1 = await waitLine(/\[ERROR\] \[오류\] 예외 Error: APP-LOG-PROBE @ /, 3000, from);
  const e2 = await waitLine(/\[ERROR\] \[오류\] 처리되지 않은 Promise 오류 TypeError: APP-LOG-PROBE-P/, 3000, from);
  await sleep(500);
  const dup = readLog().split("\n").slice(from).filter((l) => /APP-LOG-PROBE @/.test(l)).length;
  check("오류: 예외(메시지 + 위치)·Promise · 같은 오류 1분에 한 줄", e1 && e2 && dup === 1, `${short(e1)} | 같은 줄 ${dup}`);

  from = lineCount();
  await app.evaluate(`(${T}.player.host.runFrame = () => { throw new WebAssembly.RuntimeError("unreachable"); }, true)`);
  const trap = await waitLine(/\[ERROR\] \[오류\] 게임 멈춤 · 코어 trap RuntimeError: unreachable @ .* · .*test\.gba/, 4000, from);
  await sleep(300);
  const repeat = readLog().split("\n").slice(from).filter((l) => /unreachable/.test(l)).length;
  check("코어 trap: 멈춤 + 한 줄(반복 없음)", trap && !(await app.evaluate(`${T}.player.running`)) && repeat === 1, short(trap));

  from = lineCount();
  await app.evaluate(`${T}.closeGame()`);
  await app.evaluate(`${T}.openPath(${JSON.stringify(wgba)})`);
  const close1 = await waitLine(/\[게임\] 종료 · test\.gba · \d+분 \d+초 · 닫기/, 4000, from);
  const openW = await waitLine(new RegExp(`\\[게임\\] 열기 · [\\w.]+ \\d+\\.\\d+\\.\\d+ · .+ · \\.wgba SHA-1 ${sha8(wgba)} · 빌드 [0-9a-f]{8} · runtime 내장 호스트\\(Web_\\*\\)`), 15000, from);
  check("게임 종료(실행 시간·이유) · .wgba 열기(id·버전·이름·SHA-1·빌드·runtime)", close1 && openW, `${short(close1)} | ${short(openW)}`);
  await sleep(2000);

  const hello = path.join(root, "docs", "wgba", "examples", "hello-script");
  const scriptFile = path.join(gameDir, "hello-script.wgba");
  fs.writeFileSync(scriptFile, (await packWgba({ wasm: fs.readFileSync(path.join(hello, "game.wasm")), js: fs.readFileSync(path.join(hello, "game.js")), manifest: JSON.parse(fs.readFileSync(path.join(hello, "manifest.json"), "utf8")) })).bytes);
  from = lineCount();
  await app.evaluate(`${T}.openPath(${JSON.stringify(scriptFile)})`);
  const closeW = await waitLine(/\[게임\] 종료 · [\w.]+ \d+\.\d+\.\d+ · \d+분 \d+초 · 다른 게임 열기/, 8000, from);
  const openS = await waitLine(/\[게임\] 열기 · com\.example\.helloscript 1\.0\.0 · .* · runtime 자체 JS\(격리 틀\)/, 8000, from);
  check("다른 게임 열기 → 앞 게임 종료 · ② 자체 JS 열기", closeW && openS, short(openS));
  await sleep(1500);

  from = lineCount();
  await shutdown(app);
  const close2 = await waitLine(/\[게임\] 종료 · com\.example\.helloscript 1\.0\.0 · .* · 앱 종료/, 4000, from);
  const end = await waitLine(/\[INFO\] \[앱\] webGBA \d+\.\d+\.\d+ 종료$/, 4000, from);
  check("앱 종료: 게임 종료(앱 종료) · [앱] 종료 줄 · 사용자 폴더 없음", close2 && end && !/Users[\\/][^\\/~]/i.test(readLog()), short(end));
  fs.copyFileSync(todayFile(), path.join(work, "app_log_session1.log"));

  const padEnd = (() => {
    fs.appendFileSync(todayFile(), `${".".repeat(1023)}\n`.repeat(5 * 1024 + 8));
    return fs.statSync(todayFile()).size;
  })();
  ({ app, pid } = await start({ fresh: false }));
  await app.evaluate(`${T}.openPath(${JSON.stringify(rom)})`);
  await sleep(1000);
  await app.evaluate(`document.getElementById('btn-pause').click(), true`);
  await app.evaluate(`${T}.saveStateTo(2)`);
  await sleep(300);
  await shutdown(app);
  await sleep(300);
  const tail = fs.readFileSync(todayFile()).subarray(padEnd).toString("utf8");
  check("크기 상한 5MB: 요약 줄만·안내 한 줄·남기지 않은 줄 수", /\[앱\] webGBA .* 시작/.test(tail) && /\[게임\] 열기 · GBA/.test(tail) && /5MB 를 넘어 이후에는 요약 줄/.test(tail) && !/\[실행\]|\[퀵슬롯\]/.test(tail) && /\[기록\] 크기 상한으로 남기지 않은 줄 \d+개/.test(tail) && /\[앱\] webGBA .* 종료/.test(tail), tail.split("\n").filter(Boolean).slice(-3).map(short).join(" | "));
} catch (error) {
  check("시험 도중 오류", false, String(error?.stack ?? error));
  try {
    await shutdown(app);
  } catch {}
}

const failed = results.filter((r) => !r.ok).length;
fs.writeFileSync(path.join(work, "app_log_result.json"), JSON.stringify({ when: new Date().toISOString(), exe, results }, null, 1));
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
