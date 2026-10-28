// 2026-10-26 추가 기능 시험(실제 앱, CDP). 마우스를 움직이지 않는다.
//   node tools/test/app-features.mjs <exe> <작업 폴더>
// 작업 폴더에 rom\test.gba·rom\townmap.sav·wasm_only\<빌드>.wasm·captures\port.sav·pc30\·<롬>(그 웹 빌드의 롬)이 있어야 한다.
// <빌드>·<롬> 은 환경 변수 WEBGBA_TEST_BUILD·WEBGBA_TEST_ROM(cdp.mjs). 앱 폴더는 <작업>\app2 를 새로 만든다.
// 끝나면 .wgba 연결을 시험 전 값으로 되돌린다(시작할 때 reg export 한 <작업>\reg_backup\*.reg 를 다시 넣음).
import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { connect, guardOthers, launch, prepareApp, runningIn, sleep, TEST_BUILD, TEST_ROM, TEST_ROM_SAV } from "./cdp.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-features.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9335;
const appDir = path.join(work, "app2");
const captures = path.join(work, "captures");
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(captures, { recursive: true });
const appExe = prepareApp(exe, appDir, { link: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function regDefault(key) {
  const done = spawnSync("reg", ["query", key, "/ve"], { encoding: "utf8" });
  if (done.status !== 0) return null;
  const line = done.stdout.split(/\r?\n/).find((l) => /REG_SZ/.test(l));
  return line ? line.replace(/^.*REG_SZ\s+/, "").trim() : "";
}
const EXT_KEY = "HKCU\\Software\\Classes\\.wgba";
const CMD_KEY = "HKCU\\Software\\Classes\\webGBA.wgba\\shell\\open\\command";
const ICON_KEY = "HKCU\\Software\\Classes\\webGBA.wgba\\DefaultIcon";

const running = () => runningIn(work);

const regBackup = path.join(work, "reg_backup");
fs.mkdirSync(regBackup, { recursive: true });
const REG_SAVED = [
  ["HKCU\\Software\\Classes\\.wgba", "ext.reg"],
  ["HKCU\\Software\\Classes\\webGBA.wgba", "progid.reg"],
  ["HKCU\\Software\\Classes\\.wgbp", "ext-wgbp.reg"],
  ["HKCU\\Software\\Classes\\webGBA.wgbp", "progid-wgbp.reg"],
].map(([key, name]) => {
  const file = path.join(regBackup, name);
  fs.rmSync(file, { force: true });
  return { key, file, had: spawnSync("reg", ["export", key, file, "/y"]).status === 0 };
});

function restoreRegistry() {
  for (const { key, file, had } of REG_SAVED) {
    spawnSync("reg", ["delete", key, "/f"]);
    if (had) spawnSync("reg", ["import", file]);
  }
}

async function start(args = []) {
  launch(appExe, PORT, args);
  for (let attempt = 0; attempt < 10; attempt++) {
    const app = await connect(PORT);
    try {
      await app.evaluate("new Promise((r) => { const t = () => (window.__WEBGBA_TEST__?.state?.info ? r(true) : setTimeout(t, 100)); t(); })");
      await sleep(800);
      await app.evaluate("1");
      return app;
    } catch {
      app.close();
      await sleep(700);
    }
  }
  throw new Error("앱 화면에 붙지 못했습니다");
}

async function stop(app) {
  await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
  app.close();
  for (let i = 0; i < 20 && running(); i++) await sleep(250);
}

const T = "window.__WEBGBA_TEST__";
const statusOf = (app) => app.evaluate("document.getElementById('status').textContent");
const open = (app, file, options = {}) => app.evaluate(`${T}.openPath(${JSON.stringify(file)}, ${JSON.stringify(options)})`);
const close = (app) => app.evaluate(`${T}.closeGame()`);
const touch = (file, msAgo) => {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(file, when, when);
};

// 시험 파일 준비
const imp = path.join(work, "imp");
fs.mkdirSync(imp, { recursive: true });
if (!fs.existsSync(path.join(imp, "test.gba"))) fs.copyFileSync(path.join(work, "rom", "test.gba"), path.join(imp, "test.gba"));
fs.copyFileSync(path.join(work, "rom", "townmap.sav"), path.join(imp, "test.sav"));
touch(path.join(imp, "test.sav"), 60000);
const wg = path.join(work, "wg");
fs.rmSync(wg, { recursive: true, force: true });
fs.mkdirSync(wg, { recursive: true });
fs.copyFileSync(path.join(work, "wasm_only", `${TEST_BUILD}.wasm`), path.join(wg, `${TEST_BUILD}.wasm`));
fs.writeFileSync(path.join(wg, "fake.wgba"), "이것은 wasm 이 아닙니다");
const portimp = path.join(work, "portimp");
fs.mkdirSync(path.join(portimp, "웹버전"), { recursive: true });
if (!fs.existsSync(path.join(portimp, TEST_ROM))) fs.copyFileSync(path.join(work, TEST_ROM), path.join(portimp, TEST_ROM));
fs.copyFileSync(path.join(work, "wasm_only", `${TEST_BUILD}.wasm`), path.join(portimp, "웹버전", `${TEST_BUILD}.wgba`));
for (const name of [`${TEST_BUILD}.sav`, `${TEST_BUILD}.sav.bak`]) fs.rmSync(path.join(portimp, "웹버전", name), { force: true });
fs.copyFileSync(path.join(work, "captures", "port.sav"), path.join(portimp, TEST_ROM_SAV));
for (const name of ["test.sav.bak"]) fs.rmSync(path.join(imp, name), { force: true });

let app = null;
try {
  guardOthers(exe, work);
  if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");

  // 1. 켤 때 자동 연결
  app = await start();
  const cmd = regDefault(CMD_KEY);
  check("연결: 켤 때 .wgba 를 이 exe 로 등록(HKCU)", regDefault(EXT_KEY) === "webGBA.wgba" && cmd?.toLowerCase().includes(appExe.toLowerCase()) && (regDefault(ICON_KEY) ?? "").toLowerCase().includes("webgba.exe"), `${regDefault(EXT_KEY)} · ${cmd}`);
  const patchCmd = regDefault("HKCU\\Software\\Classes\\webGBA.wgbp\\shell\\open\\command");
  check("연결: 켤 때 .wgbp 도 이 exe 로 등록(HKCU)", regDefault("HKCU\\Software\\Classes\\.wgbp") === "webGBA.wgbp" && patchCmd?.toLowerCase().includes(appExe.toLowerCase()), `${regDefault("HKCU\\Software\\Classes\\.wgbp")} · ${patchCmd}`);

  // 2. .gba 옆 .sav 를 그대로 읽음(시각 비교·가져오기 없음)
  const hostSum = () => app.evaluate(`(() => { const d = ${T}.player.host.saveData(); let s = 0; for (const b of d) s = (s * 31 + b) >>> 0; return s; })()`);
  const sumOf = (bytes) => {
    let s = 0;
    for (const b of bytes) s = (s * 31 + b) >>> 0;
    return s;
  };
  await open(app, path.join(imp, "test.gba"));
  let said = await statusOf(app);
  check("세이브: 옆 test.sav(1분 전 시각)를 그대로 읽음", /세이브를 불러왔습니다: test\.sav/.test(said) && (await hostSum()) === sumOf(fs.readFileSync(path.join(imp, "test.sav"))), said);
  check("세이브: 앱 안쪽(bin\\save)에 세이브를 만들지 않음", !fs.existsSync(path.join(appDir, "bin", "save")), "");
  await close(app);
  const vba = fs.readFileSync(path.join(imp, "test.sav"));
  vba[0x20] ^= 0xff;
  fs.writeFileSync(path.join(imp, "test.sav"), vba);
  touch(path.join(imp, "test.sav"), 3 * 24 * 3600 * 1000);
  await open(app, path.join(imp, "test.gba"));
  said = await statusOf(app);
  check("세이브: 옆 파일을 바꿔 놓으면(시각이 옛것이어도) 다음에 열 때 그것을 읽음", /세이브를 불러왔습니다/.test(said) && (await hostSum()) === sumOf(vba), said);
  const title = await app.evaluate("document.getElementById('title').textContent");
  check("경로 숨김: 제목·상태에 경로 없음", !/[A-Za-z]:\\/.test(title + said), `${title} | ${said}`);
  await close(app);

  // 3. .wgba: wasm 확인, 같은 이름 .wasm 때의 옆 세이브를 이어 씀
  check("wgba: wasm 이 아니면 알림", !(await open(app, path.join(wg, "fake.wgba"))) && /wasm 이 아닙니다/.test(await statusOf(app)), await statusOf(app));
  await open(app, path.join(wg, `${TEST_BUILD}.wasm`));
  await app.evaluate(`${T}.player.host.ex.Web_DebugSave()`);
  await sleep(2000);
  await close(app);
  const wasmSave = path.join(wg, `${TEST_BUILD}.sav`);
  check(`wgba: .wasm 로 연 판의 세이브가 옆 ${TEST_BUILD}.sav 에 생김`, fs.existsSync(wasmSave), "");
  fs.copyFileSync(path.join(wg, `${TEST_BUILD}.wasm`), path.join(wg, `${TEST_BUILD}.wgba`));
  fs.rmSync(path.join(wg, `${TEST_BUILD}.wasm`));
  const opened = await open(app, path.join(wg, `${TEST_BUILD}.wgba`));
  said = await statusOf(app);
  const kind = await app.evaluate(`${T}.state.game?.kind ?? ''`);
  check("wgba: .wasm 와 같이 내장 호스트로 열림", opened && kind === "web", `${kind} · ${said}`);
  check(`wgba: 이름이 같아 옆 ${TEST_BUILD}.sav 를 그대로 이어 씀`, /세이브를 불러왔습니다/.test(said) && (await hostSum()) === sumOf(fs.readFileSync(wasmSave)), said);
  await sleep(26000);
  await app.screenshot(path.join(captures, "feat_wgba_title.png"), await app.evaluate("(() => { const b = document.getElementById('screen').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()"));
  await close(app);

  // 4. 포트(.wgba)는 롬 옆 .sav 를 쓰지 않음(세이브는 연 파일 옆 하나)
  await open(app, path.join(portimp, "웹버전", `${TEST_BUILD}.wgba`));
  said = await statusOf(app);
  check(`포트: 롬 옆 ${TEST_ROM_SAV} 는 가져오지 않음(옆 ${TEST_BUILD}.sav 가 없어 빈 세이브)`, /세이브 없이 시작합니다/.test(said) && !/불러왔습니다/.test(said), said);
  await close(app);

  // 5. 박스 30 (512KB 세이브)
  const pc30 = path.join(work, "pc30", `${TEST_BUILD}.wasm`);
  const pcSave = path.join(work, "pc30", `${TEST_BUILD}.sav`);
  for (const file of [pcSave, `${pcSave}.bak`]) fs.rmSync(file, { force: true });
  fs.copyFileSync(path.join(work, "pc30", "old128.sav"), pcSave);
  const PLAY = `(() => { const t = ${T}; const host = t.player.host; const ex = host.ex; t.player.setPaused(true);
    let f = 0; const run = (n, k = 0) => { for (let i = 0; i < n; i++, f++) if (!host.runFrame(k)) throw new Error(host.halted); };
    const quest = () => new Uint32Array(ex.memory.buffer)[(ex.Web_DebugFollower() >> 2) + 12];
    for (; f < 1900;) run(1, (f === 1200 || f === 1700) ? 8 : 0);
    for (let w = 0; w < 1500 && !ex.Web_DebugInOverworld(); w++) run(1, w < 120 ? (w % 40 < 2 ? 1 : 0) : 0);
    for (let w = 0; w < 3000 && !(ex.Web_DebugInOverworld() && quest() !== 2); w++) run(1, w % 60 < 2 ? 2 : 0);
    for (let w = 0; !ex.Web_DebugInOverworld() && w < 3000; w++) run(1, w % 20 < 2 ? 2 : 0);
    run(60); return true; })()`;
  await open(app, pc30);
  await app.evaluate(PLAY);
  const lead = await app.evaluate(`${T}.player.host.ex.Web_DebugPartySpecies(0)`);
  await app.evaluate(`(() => { const ex = ${T}.player.host.ex; ex.Web_DebugPcBoxPut(29, 0, 0); return ex.Web_DebugSave(); })()`);
  await app.evaluate(`(async () => { const p = ${T}.player; p.host.takeSaveDirty(); p.savePending = true; await p.flushSave(); })()`);
  const big = fs.statSync(pcSave).size;
  check("박스30: 저장하면 옆 128KB 파일을 그대로 512KB 로 덮어씀(.sav.bak 없음)", big === 0x80000 && !fs.existsSync(`${pcSave}.bak`), `${big}바이트`);
  await close(app);
  await open(app, pc30);
  await app.evaluate(PLAY);
  const kept = await app.evaluate(`${T}.player.host.ex.Web_DebugBoxSpecies(29, 0)`);
  check("박스30: 다시 켜도 박스 30 #1 이 남음", kept === lead && kept !== 0, `${kept}(${lead})`);
  await close(app);
  await open(app, path.join(work, "wasm_only", `${TEST_BUILD}.wasm`));
  const oldCap = await app.evaluate(`${T}.player.host.saveCapacity`);
  check("박스30: 지금 배포본(128KB 판)은 그대로 128KB", oldCap === 0x20000, `${oldCap}`);
  await close(app);

  // 6. 즐겨찾기·같은 폴더 목록·도구 막대
  await open(app, path.join(work, "rom", "test.gba"));
  await app.evaluate(`${T}.state.prefs.panel === 'files' ? true : ${T}.showPanel('files')`);
  await sleep(300);
  const rows = await app.evaluate("[...document.querySelectorAll('#sidepanel-list .row .row__name')].map((r) => r.textContent)");
  check("목록: 루트 폴더의 .gba·.wgba·.wasm 만(zip·sav 없음, 폴더 이동 없음)", rows.join() === "test.gba" && !document_has_up(await app.evaluate("document.getElementById('explorer-up') ? 1 : 0")), rows.join(", "));
  await app.evaluate(`${T}.toggleFavorite()`);
  await open(app, path.join(wg, `${TEST_BUILD}.wgba`));
  await app.evaluate(`${T}.toggleFavorite()`);
  await app.evaluate(`${T}.showPanel('favorites')`);
  await sleep(300);
  const favRows = await app.evaluate("[...document.querySelectorAll('#sidepanel-list .row .row__name')].map((r) => r.textContent)");
  const favPrefs = await app.evaluate(`${T}.state.prefs.favorites.length`);
  check("즐겨찾기: 넣기·목록(이름만)", favPrefs === 2 && favRows.join() === `test.gba,${TEST_BUILD}.wgba`, favRows.join(", "));
  await app.evaluate("document.querySelectorAll('#sidepanel-list .row')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true");
  await sleep(2500);
  check("즐겨찾기: 두 번 눌러 바로 열기", (await app.evaluate(`${T}.state.game?.name`)) === "test.gba", await statusOf(app));
  const panelText = await app.evaluate("document.getElementById('sidepanel').textContent + document.getElementById('start').textContent");
  check("경로 숨김: 목록·첫 화면에 경로 없음", !/[A-Za-z]:\\/.test(panelText), "");
  await app.evaluate(`${T}.toggleRail(true)`);
  await sleep(400);
  const railHidden = await app.evaluate("getComputedStyle(document.getElementById('rail')).display === 'none' && getComputedStyle(document.getElementById('sidepanel')).display === 'none'");
  check("도구 막대: 접으면 막대·패널이 사라져 화면을 가리지 않음", railHidden, "");
  await app.screenshot(path.join(captures, "feat_rail_collapsed.png"));
  await app.evaluate(`${T}.toggleRail(false)`);
  await sleep(400);
  await app.screenshot(path.join(captures, "feat_rail_open_favorites.png"));
  await app.evaluate(`${T}.toggleRail(true)`);
  await stop(app);
  app = null;

  // 7. 연결 경로가 다르면 켤 때 고쳐 씀 + 인자로 넘긴 파일을 염(더블클릭과 같은 길)
  spawnSync("reg", ["add", CMD_KEY, "/ve", "/d", '"C:\\옮기기전\\webgba.exe" "%1"', "/f"]);
  app = await start([path.join(wg, `${TEST_BUILD}.wgba`)]);
  await sleep(2500);
  check("연결: 등록된 exe 가 다르면 켤 때 고쳐 씀", (regDefault(CMD_KEY) ?? "").toLowerCase().includes(appExe.toLowerCase()), regDefault(CMD_KEY));
  check("인자로 넘긴 .wgba 를 켜자마자 엶", (await app.evaluate(`${T}.state.game?.name ?? ''`)) === `${TEST_BUILD}.wgba`, await statusOf(app));
  check("도구 막대: 접힘 상태를 기억", await app.evaluate("document.documentElement.classList.contains('is-rail-collapsed')"), "");

  // 8. 이미 켜진 창으로 넘기기(단일 인스턴스)
  const second = spawn(appExe, [path.join(imp, "test.gba")], { detached: true, stdio: "ignore" });
  second.unref();
  await sleep(4000);
  check("단일 인스턴스: 두 번째 실행의 파일을 켜진 창에서 엶", (await app.evaluate(`${T}.state.game?.name ?? ''`)) === "test.gba" && running() === 1, `프로세스 ${running()}개`);

  // 9. 연결 해제
  await app.evaluate(`${T}.toggleLink()`);
  check("연결 해제: HKCU 키가 지워짐", regDefault(EXT_KEY) === null && regDefault(CMD_KEY) === null, await statusOf(app));
  await stop(app);
  app = await start();
  check("연결 해제를 고르면 다시 켜도 등록하지 않음", regDefault(EXT_KEY) === null, "");
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  if (!app && running()) app = await connect(PORT, { timeoutMs: 5000 }).catch(() => null);
  if (app) await stop(app);
  restoreRegistry();
  fs.writeFileSync(path.join(work, "app_features_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}

function document_has_up(flag) {
  return flag === 1;
}
