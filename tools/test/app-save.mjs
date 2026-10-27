// 세이브는 연 파일 옆 <이름>.sav 하나를 직접 덮어쓴다(사용자 2026-10-27). 실제 앱을 CDP 로 다룬다. 마우스를 움직이지 않는다.
//   node tools/test/app-save.mjs <exe> <작업 폴더>
// 작업 폴더: rom\test.gba · rom\townmap.sav · port\<빌드>.wgba(512KB 세이브 포트, Web_DebugSave 있음) · <롬>(그 빌드의 롬)
//            · gen3\a.sav · gen3\b.sav(포트 세이브 두 개)
//   있으면 user\ (실제 사용 폴더의 사본: <빌드>.wgba · <빌드>.sav · inside\ = 옛 판 앱 안쪽 폴더)로 한 번 더 열어 본다(6절).
// 앱 폴더는 <작업>\app_save 를 새로 만든다(wgbaLink false — 레지스트리는 건드리지 않음).
// 세이브 가져오기·내보내기는 파일 고르기 창 대신 시험 훅 importSave(경로)·exportSave(경로)로 경로를 넘긴다(확인 창은 OK 를 누름).
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep, TEST_BUILD, TEST_ROM, TEST_ROM_SAV } from "./cdp.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-save.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9339;
const T = "window.__WEBGBA_TEST__";
const appDir = path.join(work, "app_save");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const running = () => runningIn(work);

const fnv = (bytes) => {
  let h = 2166136261;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return [bytes.length, h >>> 0].join("/");
};
const fileHash = (file) => (fs.existsSync(file) ? fnv(fs.readFileSync(file)) : "없음");
const inoOf = (file) => (fs.existsSync(file) ? fs.statSync(file, { bigint: true }).ino : null);
const HOST_HASH = `(() => { const d = ${T}.player.host.saveData(); let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return [d.length, h >>> 0].join("/"); })()`;
const copyKeep = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const st = fs.statSync(from);
  fs.utimesSync(to, st.atime, st.mtime);
};
const ago = (file, ms) => {
  const when = new Date(Date.now() - ms);
  fs.utimesSync(file, when, when);
};
const fresh = (name) => {
  const dir = path.join(work, name);
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, n), 0o666);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const listOf = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().join(", ") : "(없음)");
const extraIn = (dir, keep) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !keep.includes(n)) : []);
const SAVE_LIKE = /\.(bak|tmp|migrated)$|\.bak-|rescue/i;
/** 사용자 사본에서 일부러 넣은 옛 파일(안쪽 폴더의 .bak 등). 시험이 만든 것이 아니므로 마지막 검사에서 뺀다. */
const seeded = new Set();

let app = null;
async function start() {
  for (let i = 0; i < 40 && running(); i++) await sleep(250);
  launch(path.join(appDir, "webgba.exe"), PORT);
  app = await attach(PORT);
}
async function closeByButton() {
  await app.evaluate("document.getElementById('win-close').click(); true").catch(() => {});
  app.close();
  for (let i = 0; i < 40 && running(); i++) await sleep(250);
  app = null;
}
const statusText = () => app.evaluate("document.getElementById('status').textContent");
const open = async (file) => {
  const ok = await app.evaluate(`${T}.openPath(${JSON.stringify(file)})`);
  await sleep(300);
  return ok;
};
const closeGame = () => app.evaluate(`${T}.closeGame().then(() => true)`);
const saveIdOf = (file) => app.evaluate(`window.__TAURI__.core.invoke('web_inspect', { path: ${JSON.stringify(file)}, romName: null }).then((b) => b.saveId)`);
const insideWeb = (id) => path.join(appDir, "bin", "web", id.slice(4), "save.sav");
const debugSave = () => app.evaluate(`(() => { const r = ${T}.player.host.ex.Web_DebugSave(); return ${HOST_HASH}; })()`);
async function waitFile(file, want, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fileHash(file) === want) return true;
    await sleep(50);
  }
  return false;
}
async function waitStatus(re, ms = 5000) {
  const until = Date.now() + ms;
  let said = "";
  while (Date.now() < until) {
    said = await statusText();
    if (re.test(said)) return said;
    await sleep(100);
  }
  return said;
}
/** 메뉴 "세이브 가져오기"와 같은 흐름(파일 고르기 창 대신 `file` 을 넘김 → 확인 창 OK). 끝난 뒤 상태 줄. */
async function importVia(file) {
  await app.evaluate(`(window.__imp = '', ${T}.importSave(${JSON.stringify(file)}).then(() => { window.__imp = 'done'; }, (e) => { window.__imp = 'err ' + e; }), true)`);
  let asked = false;
  for (let i = 0; i < 50 && !asked; i++) {
    asked = await app.evaluate("!document.getElementById('layer').hidden && !!document.querySelector('#dialog-actions .btn--go')");
    if (!asked) await sleep(100);
  }
  if (asked) await app.evaluate("document.querySelector('#dialog-actions .btn--go').click(); true");
  let done = "";
  for (let i = 0; i < 100 && !done; i++) {
    done = await app.evaluate("window.__imp");
    if (!done) await sleep(100);
  }
  await sleep(300);
  return { asked, done, said: await statusText() };
}

try {
  guardOthers(exe, work);
  if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  fs.rmSync(appDir, { recursive: true, force: true });
  prepareApp(exe, appDir);
  const portWgba = path.join(work, "port", `${TEST_BUILD}.wgba`);
  const portRom = path.join(work, TEST_ROM);
  const gen3A = path.join(work, "gen3", "a.sav");
  const gen3B = path.join(work, "gen3", "b.sav");

  await start();

  /* ── 1. .wgba: 옆 .sav 없음 → 게임 저장 1초 뒤 옆에 씀, 그다음부터는 같은 파일을 직접 덮어씀 ── */
  const s1 = fresh("sb_wgba");
  const wgba = path.join(s1, `${TEST_BUILD}.wgba`);
  const sav = path.join(s1, `${TEST_BUILD}.sav`);
  const s1Files = [`${TEST_BUILD}.wgba`, TEST_ROM, TEST_ROM_SAV, `${TEST_BUILD}.sav`];
  fs.copyFileSync(portWgba, wgba);
  fs.copyFileSync(portRom, path.join(s1, TEST_ROM));
  fs.copyFileSync(path.join(work, "rom", "townmap.sav"), path.join(s1, TEST_ROM_SAV));
  await open(wgba);
  let said = await statusText();
  check(`wgba: 옆 ${TEST_BUILD}.sav 가 없으면 빈 세이브로 시작(롬 옆 ${TEST_ROM_SAV} 는 쓰지 않음)`, /세이브 없이 시작합니다/.test(said) && said.includes(`${TEST_BUILD}.sav`) && !/불러왔습니다/.test(said), said);
  const cap = await app.evaluate(`${T}.player.host.saveCapacity`);
  const t0 = Date.now();
  const first = await debugSave();
  let early = null;
  while (Date.now() - t0 < 5000) {
    if (early === null && Date.now() - t0 >= 500) early = fs.existsSync(sav);
    if (fileHash(sav) === first) break;
    await sleep(25);
  }
  const took = Date.now() - t0;
  check("게임 저장 → 약 1초 뒤 옆 파일에 씀(0.5초엔 아직)", early === false && took >= 900 && took <= 3000 && fileHash(sav) === first, `${took}ms · 0.5초에 ${early ? "이미 있음" : "없음"}`);
  check("옆 파일 크기는 코어 세이브 그대로(포트 512KB)·바이트 같음", fs.statSync(sav).size === cap && cap === 0x80000 && fileHash(sav) === first, `${fs.statSync(sav).size}바이트`);

  const ino1 = inoOf(sav);
  const held = fs.openSync(sav, "r");
  const second = await debugSave();
  await waitFile(sav, second);
  const seen = Buffer.alloc(0x80000);
  fs.readSync(held, seen, 0, seen.length, 0);
  fs.closeSync(held);
  check("덮어쓸 때 같은 파일을 직접 고침(파일 번호 같음, 열어 둔 핸들로도 새 내용이 보임)", inoOf(sav) === ino1 && fnv(seen) === second && fileHash(sav) === second, `파일 번호 ${inoOf(sav) === ino1 ? "같음" : "바뀜"} · 핸들 ${fnv(seen) === second ? "새 내용" : "옛 내용"}`);
  const third = await debugSave();
  await waitFile(sav, third);
  check("또 덮어써도 같은 파일, .bak·.tmp 같은 다른 파일 없음", inoOf(sav) === ino1 && fileHash(sav) === third && !extraIn(s1, s1Files).length, listOf(s1));

  /* 다른 파일을 열면 마지막 것을 씀 */
  const fourth = await debugSave();
  await open(path.join(work, "rom", "test.gba"));
  check("다른 파일을 열 때 기다리지 않고 마지막 세이브를 씀", fileHash(sav) === fourth, fileHash(sav));
  await closeGame();

  /* 다시 열면 그대로 읽음 */
  await open(wgba);
  said = await statusText();
  const loaded = await app.evaluate(HOST_HASH);
  check("다시 열면 옆 파일을 그대로 읽음", /세이브를 불러왔습니다/.test(said) && loaded === fourth, `${said} · ${loaded}`);

  /* ── 2. 쓰기 실패 → 상태 줄에 오류, 따로 파일을 만들지 않음, 다음 저장·닫을 때 다시 씀 ── */
  const kept = fileHash(sav);
  fs.chmodSync(sav, 0o444);
  const lost1 = await debugSave();
  said = await waitStatus(/세이브를 쓰지 못했습니다/);
  check("쓰기 실패(읽기 전용): 상태 줄에 오류·다시 쓴다는 안내, 파일은 그대로", /세이브를 쓰지 못했습니다\(다음 저장 때 다시 씁니다\)/.test(said) && fileHash(sav) === kept, said);
  check("쓰기 실패: 다른 파일·bin\\rescue 를 만들지 않음", !extraIn(s1, s1Files).length && !fs.existsSync(path.join(appDir, "bin", "rescue")), `${listOf(s1)} · bin: ${listOf(path.join(appDir, "bin"))}`);
  const memory = await app.evaluate(HOST_HASH);
  check("쓰기 실패: 메모리의 세이브는 그대로", memory === lost1, memory);
  fs.chmodSync(sav, 0o666);
  const retry = await debugSave();
  const retried = await waitFile(sav, retry);
  said = await statusText();
  check("다음 저장 때 다시 써서 성공", retried && /세이브를 저장했습니다/.test(said) && inoOf(sav) === ino1, `${fileHash(sav)} · ${said}`);
  fs.chmodSync(sav, 0o444);
  const atClose = await debugSave();
  await waitStatus(/세이브를 쓰지 못했습니다/);
  fs.chmodSync(sav, 0o666);
  await closeGame();
  check("실패한 뒤 닫을 때 다시 써서 성공", fileHash(sav) === atClose && !extraIn(s1, s1Files).length, `${fileHash(sav)} · ${listOf(s1)}`);

  /* 창 닫기 때 씀 */
  await open(wgba);
  const sixth = await debugSave();
  await closeByButton();
  check("창 X 로 닫을 때 마지막 세이브를 씀(1초 기다리지 않음), 같은 파일", fileHash(sav) === sixth && inoOf(sav) === ino1 && !extraIn(s1, s1Files).length, `${fileHash(sav)} · ${listOf(s1)}`);
  check(
    "앱 안쪽에 세이브를 만들지 않음(bin\\save·bin\\rescue 없음, bin\\web 에 save.sav 없음)",
    !fs.existsSync(path.join(appDir, "bin", "save")) && !fs.existsSync(path.join(appDir, "bin", "rescue")) && !fs.readdirSync(path.join(appDir, "bin", "web")).some((d) => fs.existsSync(path.join(appDir, "bin", "web", d, "save.sav"))),
    listOf(path.join(appDir, "bin")),
  );
  await start();

  /* ── 3. .gba: 옆 .sav 를 시각과 관계없이 그대로 읽음, 닫을 때 바뀐 것을 같은 파일에 씀 ── */
  const s2 = fresh("sb_gba");
  const gba = path.join(s2, "test.gba");
  const gsav = path.join(s2, "test.sav");
  fs.copyFileSync(path.join(work, "rom", "test.gba"), gba);
  fs.copyFileSync(path.join(work, "rom", "townmap.sav"), gsav);
  ago(gsav, 3 * 24 * 3600 * 1000);
  const gino = inoOf(gsav);
  await open(gba);
  said = await statusText();
  check(".gba: 옆 test.sav(3일 전 시각)를 그대로 읽음", /세이브를 불러왔습니다: test\.sav/.test(said) && (await app.evaluate(HOST_HASH)) === fileHash(gsav), said);
  const changed = await app.evaluate(`(() => { const h = ${T}.player.host; h.u8[(h.ex.Web_GetFlash() >>> 0) + 0x10] ^= 0xff; return ${HOST_HASH}; })()`);
  await closeGame();
  check(".gba: 닫을 때 바뀐 세이브를 같은 파일에 직접 씀, .bak 없음", fileHash(gsav) === changed && inoOf(gsav) === gino && listOf(s2) === "test.gba, test.sav", `${fileHash(gsav)} · ${listOf(s2)}`);
  const mtime = fs.statSync(gsav).mtimeMs;
  await open(gba);
  await closeGame();
  check(".gba: 바뀐 것이 없으면 닫아도 다시 쓰지 않음", fileHash(gsav) === changed && fs.statSync(gsav).mtimeMs === mtime, listOf(s2));

  /* ── 4. 옛 판의 앱 안쪽 세이브는 읽지도 옮기지도 않음 ── */
  const o1 = fresh("old_wgba");
  const o1w = path.join(o1, `${TEST_BUILD}.wgba`);
  fs.copyFileSync(portWgba, o1w);
  fs.copyFileSync(portRom, path.join(o1, TEST_ROM));
  const o1id = await saveIdOf(o1w);
  copyKeep(gen3A, insideWeb(o1id));
  await open(o1w);
  said = await statusText();
  check(
    "옛 안쪽 세이브(.wgba): 무시하고 옆 파일만 봄(빈 세이브로 시작), 안쪽 것은 그대로·.migrated 없음",
    /세이브 없이 시작합니다/.test(said) && !/옛 webGBA/.test(said) && (await app.evaluate(HOST_HASH)) !== fileHash(gen3A) && fileHash(insideWeb(o1id)) === fileHash(gen3A) && !fs.existsSync(`${insideWeb(o1id)}.migrated`) && !fs.existsSync(path.join(o1, `${TEST_BUILD}.sav`)),
    `${said} · ${listOf(o1)} · 안쪽 ${listOf(path.dirname(insideWeb(o1id)))}`,
  );
  await closeGame();
  const o2 = fresh("old_gba");
  const o2r = path.join(o2, "test.gba");
  fs.copyFileSync(path.join(work, "rom", "test.gba"), o2r);
  const gbaInside = path.join(appDir, "bin", "save", "test.sav");
  copyKeep(path.join(work, "rom", "townmap.sav"), gbaInside);
  await open(o2r);
  said = await statusText();
  check(
    "옛 안쪽 세이브(.gba, bin\\save\\test.sav): 무시, 그대로·.migrated 없음",
    /세이브 없이 시작합니다/.test(said) && fileHash(gbaInside) === fileHash(path.join(work, "rom", "townmap.sav")) && !fs.existsSync(`${gbaInside}.migrated`) && listOf(o2) === "test.gba",
    `${said} · ${listOf(o2)}`,
  );
  await closeGame();
  fs.rmSync(path.join(appDir, "bin", "save"), { recursive: true, force: true });

  /* ── 5. 세이브 가져오기·내보내기 ── */
  await open(wgba);
  const before = inoOf(sav);
  let r = await importVia(gen3B);
  said = r.said;
  check(
    "가져오기(.wgba): 고른 파일 내용으로 옆 .sav 를 직접 덮어쓰고 다시 열어 그 세이브로 시작, .bak 없음",
    r.asked && r.done === "done" && /세이브를 가져왔습니다: b\.sav/.test(said) && fileHash(sav) === fileHash(gen3B) && inoOf(sav) === before && (await app.evaluate(HOST_HASH)) === fileHash(gen3B) && !extraIn(s1, s1Files).length,
    `${JSON.stringify({ asked: r.asked, done: r.done })} · ${said} · ${listOf(s1)}`,
  );
  const outDir = fresh("export_out");
  const outFile = path.join(outDir, "exported.sav");
  await app.evaluate(`${T}.exportSave(${JSON.stringify(outFile)}).then(() => true)`);
  said = await statusText();
  check("내보내기: 지금 세이브를 고른 곳에 그대로, 옆 .sav 는 그대로", /세이브를 내보냈습니다: exported\.sav/.test(said) && fileHash(outFile) === (await app.evaluate(HOST_HASH)) && fileHash(outFile) === fileHash(sav), `${said} · ${fileHash(outFile)}`);
  await closeGame();
  await open(gba);
  const gbefore = inoOf(gsav);
  r = await importVia(path.join(work, "rom", "townmap.sav"));
  check(
    "가져오기(.gba): 옆 test.sav 를 직접 덮어씀, .bak 없음",
    r.asked && r.done === "done" && fileHash(gsav) === fileHash(path.join(work, "rom", "townmap.sav")) && inoOf(gsav) === gbefore && (await app.evaluate(HOST_HASH)) === fileHash(gsav) && listOf(s2) === "test.gba, test.sav",
    `${r.done} · ${r.said} · ${listOf(s2)}`,
  );
  await closeGame();

  /* ── 6. 사용자 폴더 사본(있을 때만): 옆 .sav 를 그대로 읽고, 옛 안쪽 폴더는 건드리지 않음 ── */
  const user = path.join(work, "user");
  if (fs.existsSync(path.join(user, `${TEST_BUILD}.wgba`)) && fs.existsSync(path.join(user, `${TEST_BUILD}.sav`))) {
    const dir = fresh("usercopy");
    const uw = path.join(dir, `${TEST_BUILD}.wgba`);
    const us = path.join(dir, `${TEST_BUILD}.sav`);
    fs.copyFileSync(path.join(user, `${TEST_BUILD}.wgba`), uw);
    fs.copyFileSync(portRom, path.join(dir, TEST_ROM));
    copyKeep(path.join(user, `${TEST_BUILD}.sav`), us);
    const id = await saveIdOf(uw);
    const insideDir = path.dirname(insideWeb(id));
    if (fs.existsSync(path.join(user, "inside"))) for (const name of fs.readdirSync(path.join(user, "inside"))) {
      copyKeep(path.join(user, "inside", name), path.join(insideDir, name));
      seeded.add(path.join(insideDir, name));
    }
    const insideBefore = listOf(insideDir);
    const besideBefore = fileHash(us);
    await open(uw);
    said = await statusText();
    const host = await app.evaluate(HOST_HASH);
    await closeGame();
    check(
      "사용자 사본: 옆 firered.sav 를 그대로 읽음, 닫아도 그대로, 옛 안쪽 폴더 그대로, 다른 파일 없음",
      /세이브를 불러왔습니다/.test(said) && host === besideBefore && fileHash(us) === besideBefore && listOf(insideDir) === insideBefore && !extraIn(dir, [`${TEST_BUILD}.wgba`, TEST_ROM, `${TEST_BUILD}.sav`]).length,
      `${said} · 안쪽 ${listOf(insideDir)} · ${listOf(dir)}`,
    );
  }
  const strays = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/webview/i.test(e.name)) walk(full);
      } else if (SAVE_LIKE.test(e.name) && !seeded.has(full)) strays.push(path.relative(work, full));
    }
  };
  for (const name of ["sb_wgba", "sb_gba", "old_wgba", "old_gba", "usercopy", "app_save"]) if (fs.existsSync(path.join(work, name))) walk(path.join(work, name));
  check("시험 폴더 어디에도 .bak·.tmp·.migrated·rescue 가 생기지 않음", !strays.length, strays.join(", "));
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  if (running()) {
    const left = app ?? (await connect(PORT, { timeoutMs: 3000 }).catch(() => null));
    if (left) {
      await Promise.race([left.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
      left.close();
    }
  }
  fs.writeFileSync(path.join(work, "app_save_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
