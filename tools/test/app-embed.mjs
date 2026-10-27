// 롬을 묶은 .wgba(사용자 정의 구획 webgba.rom, tools/pack-wgba.mjs) 시험. 실제 앱, CDP.
//   node tools/test/app-embed.mjs <exe> <작업 폴더> <빌드.wasm> <롬.gba> [drop]
// 작업 폴더 안에 시험 파일을 새로 만든다(롬이 없는 폴더에 묶은 .wgba 만 두는 것이 핵심):
//   packed\<빌드>.wgba            묶은 것만(같은 폴더·위 폴더 어디에도 .gba 없음)
//   plain\<빌드>.wgba + 롬.gba    구획 없는 옛 .wgba(지금 규칙: 옆 롬)
//   broken_sha\ · broken_zip\     머리 SHA-1 을 바꾼 것 · 묶은 롬 가운데를 깬 것
//   page\<빌드>.wasm + 페이지      빌드 폴더에 index.html 등이 있으면 원래 페이지로 열어 /rom 확인
// drop 을 주면 실제 마우스로 끌어 놓기도 한다(drag-drop.ps1). 앱 폴더 <작업>\app_embed, 레지스트리는 건드리지 않는다.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { findRomSection, pack, HEADER_SIZE } from "../pack-wgba.mjs";

const [exe, work, wasmPath, romPath, ...extra] = process.argv.slice(2);
if (!exe || !work || !wasmPath || !romPath) {
  console.error("사용법: node tools/test/app-embed.mjs <exe> <작업 폴더> <빌드.wasm> <롬.gba> [drop]");
  process.exit(2);
}

const PORT = 9343;
const T = "window.__WEBGBA_TEST__";
const appDir = path.join(work, "app_embed");
const captures = path.join(work, "captures");
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(captures, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const build = path.basename(wasmPath).replace(/\.(wasm|wgba)$/i, "");
const wasm = fs.readFileSync(wasmPath);
const rom = fs.readFileSync(romPath);
const romSha = crypto.createHash("sha1").update(rom).digest("hex");
const packed = pack(wasm, rom);

function fresh(name, files) {
  const dir = path.join(work, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), bytes);
  return dir;
}
const packedDir = fresh("packed", { [`${build}.wgba`]: packed });
const plainDir = fresh("plain", { [`${build}.wgba`]: wasm, [path.basename(romPath)]: rom });
const sec = findRomSection(packed);
const badSha = Buffer.from(packed);
badSha[sec.payload + 16] ^= 0xff;
const badZip = Buffer.from(packed);
badZip[sec.payload + HEADER_SIZE + Math.floor((sec.end - sec.payload - HEADER_SIZE) / 2)] ^= 0xff;
const shaDir = fresh("broken_sha", { [`${build}.wgba`]: badSha });
const zipDir = fresh("broken_zip", { [`${build}.wgba`]: badZip });
const pageSrc = path.dirname(wasmPath);
const hasPage = fs.existsSync(path.join(pageSrc, "index.html")) && fs.existsSync(path.join(pageSrc, `${build}.js`));
let pageDir = null;
if (hasPage) {
  const files = { [`${build}.wasm`]: packed };
  for (const name of fs.readdirSync(pageSrc)) {
    if (/\.(html|js|css)$/i.test(name) && name !== "server.js") files[name] = fs.readFileSync(path.join(pageSrc, name));
  }
  pageDir = fresh("page", files);
}
const noRomAround = (dir) => ![dir, path.dirname(dir)].some((d) => fs.readdirSync(d).some((n) => /\.gba$/i.test(n)));
const packedFile = path.join(packedDir, `${build}.wgba`);
const plainFile = path.join(plainDir, `${build}.wgba`);
const packedSave = path.join(packedDir, `${build}.sav`);

const running = () => runningIn(work);
async function start(args = []) {
  launch(appExe, PORT, args);
  for (let attempt = 0; attempt < 10; attempt++) {
    const app = await connect(PORT);
    try {
      await app.evaluate(`new Promise((r) => { const t = () => (${T}?.state?.info ? r(true) : setTimeout(t, 100)); t(); })`);
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
const statusOf = (app) => app.evaluate("document.getElementById('status').textContent");
const open = (app, file, options = {}) => app.evaluate(`${T}.openPath(${JSON.stringify(file)}, ${JSON.stringify(options)})`);
const close = (app) => app.evaluate(`${T}.closeGame()`);
const gameName = (app) => app.evaluate(`${T}.state.game?.name ?? ''`);
const waitGame = async (app, name, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await gameName(app)) === name && !(await app.evaluate(`${T}.state.opening`))) return true;
    await sleep(200);
  }
  return false;
};
const hostRomSha = (app) => app.evaluate(`(async () => { const r = ${T}.player.host?.rom; if (!r) return ''; const d = new Uint8Array(await crypto.subtle.digest('SHA-1', r)); return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join(''); })()`);
const stageClip = (app) => app.evaluate("(() => { const b = document.getElementById('screen').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()");
const noPath = (text) => !/[A-Za-z]:\\/.test(text);
const pickedRoms = (app) => app.evaluate(`Object.keys(${T}.state.prefs.webBuilds ?? {}).length`);
const timeOpen = async (app, file) => {
  await close(app);
  await sleep(300);
  const t0 = Date.now();
  const ok = await open(app, file);
  return ok ? Date.now() - t0 : -1;
};
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

guardOthers(exe, work);
if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
const appExe = prepareApp(exe, appDir);
let app = null;
try {
  check("준비: 묶은 .wgba 옆·위 폴더에 .gba 없음", noRomAround(packedDir), `${path.basename(packedFile)} ${packed.length}바이트`);

  // 1. 인자로 넘겨 켬(탐색기 더블클릭·연결과 같은 길) → 고르기 창 없이 바로 실행
  app = await start([packedFile]);
  const opened = await waitGame(app, `${build}.wgba`);
  let said = await statusOf(app);
  const kind = await app.evaluate(`${T}.state.game?.kind ?? ''`);
  check("인자: 롬 없는 폴더의 묶은 .wgba 가 고르기 창 없이 열림(내장 호스트)", opened && kind === "web", `${kind} · ${said}`);
  check("인자: 상태 줄에 '내장 롬'", /내장 롬/.test(said) && !/롬 .*\.gba/.test(said), said);
  check("인자: 코어가 받은 롬 = 묶은 롬(SHA-1)", (await hostRomSha(app)) === romSha, romSha.slice(0, 12));
  check("인자: 롬을 고른 기록이 생기지 않음", (await pickedRoms(app)) === 0, "");
  await sleep(26000);
  await app.screenshot(path.join(captures, "embed_title.png"), await stageClip(app));
  const colors = await app.evaluate("(() => { const d = document.getElementById('screen').getContext('2d').getImageData(0, 0, 240, 160).data; const s = new Set(); for (let i = 0; i < d.length; i += 148) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return s.size; })()");
  check("인자: 게임이 돌아감(타이틀까지)", colors > 8, `화면 색 ${colors}`);
  await app.evaluate("document.querySelector('.menubar__item[data-menu=\"game\"]').click(); true");
  await sleep(300);
  const pickRom = await app.evaluate("[...document.querySelectorAll('.menu__item')].find((b) => b.textContent.includes('롬 지정'))?.disabled ?? null");
  await app.evaluate("document.body.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  check("메뉴: 묶은 빌드는 '롬 지정…' 이 꺼짐", pickRom === true, String(pickRom));
  const title = await app.evaluate("document.getElementById('title').textContent");
  check("경로 숨김: 제목·상태에 경로 없음", noPath(title + said), `${title} | ${said}`);

  // 2. 세이브는 연 파일 옆 <이름>.sav 그대로
  fs.rmSync(packedSave, { force: true });
  await app.evaluate(`${T}.player.host.ex.Web_DebugSave()`);
  await app.evaluate(`(async () => { const p = ${T}.player; p.host.takeSaveDirty(); p.savePending = true; await p.flushSave(); })()`);
  await sleep(1500);
  const saveSize = fs.existsSync(packedSave) ? fs.statSync(packedSave).size : 0;
  check(`세이브: 옆 ${build}.sav 에 씀`, saveSize > 0, `${saveSize}바이트`);
  await close(app);
  await open(app, packedFile);
  said = await statusOf(app);
  check("세이브: 다시 열면 옆 세이브를 불러옴", new RegExp(`세이브를 불러왔습니다: ${build}\\.sav`).test(said) && /내장 롬/.test(said), said);
  await close(app);

  // 3. 같은 폴더 목록에서 두 번 눌러 열기
  await app.evaluate(`${T}.state.prefs.panel === 'files' ? true : ${T}.showPanel('files')`);
  await sleep(400);
  const rows = await app.evaluate("[...document.querySelectorAll('#sidepanel-list .row .row__name')].map((r) => r.textContent)");
  const rowIndex = rows.indexOf(`${build}.wgba`);
  if (rowIndex >= 0) await app.evaluate(`document.querySelectorAll('#sidepanel-list .row')[${rowIndex}].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  const listed = rowIndex >= 0 && (await waitGame(app, `${build}.wgba`, 20000));
  said = await statusOf(app);
  check("목록: 두 번 눌러 열기(롬 없이)", listed && /내장 롬/.test(said), `${rows.join(", ")} · ${said}`);
  await close(app);

  // 4. 구획 없는 옛 .wgba 는 지금처럼 옆 롬
  const plainOk = await open(app, plainFile);
  said = await statusOf(app);
  check("옛 .wgba(구획 없음): 옆 롬으로 열림", plainOk && new RegExp(`롬 ${path.basename(romPath).replace(/[.()]/g, "\\$&")}`).test(said) && !(await app.evaluate(`${T}.state.game?.romEmbedded`)), said);
  await close(app);

  // 5. 망가진 구획은 알아듣는 오류
  const shaOk = await open(app, path.join(shaDir, `${build}.wgba`));
  said = await statusOf(app);
  check("망가진 구획(SHA-1): 열지 않고 오류 문구", !shaOk && /내장 롬이 손상되었습니다\(SHA-1 이 다름\)/.test(said) && (await gameName(app)) === "", said);
  const zipOk = await open(app, path.join(zipDir, `${build}.wgba`));
  said = await statusOf(app);
  check("망가진 구획(압축): 열지 않고 오류 문구", !zipOk && /내장 롬이 손상되었습니다\((압축을 풀지 못함|SHA-1 이 다름)\)/.test(said), said);
  await app.evaluate(`${T}.setLang('en')`);
  await open(app, path.join(shaDir, `${build}.wgba`));
  const en = await statusOf(app);
  await app.evaluate(`${T}.setLang('ja')`);
  await open(app, path.join(shaDir, `${build}.wgba`));
  const ja = await statusOf(app);
  await app.evaluate(`${T}.setLang('ko')`);
  check("오류 문구: 영어·일본어", /built-in ROM is damaged \(SHA-1 does not match\)/.test(en) && /内蔵 ROM が壊れています\(SHA-1 が一致しません\)/.test(ja), `${en} | ${ja}`);

  // 6. 원래 페이지로 열 때 /rom 이 묶인 롬을 줌
  if (pageDir) {
    const pageOk = await open(app, path.join(pageDir, `${build}.wasm`), { preferPage: true });
    said = await statusOf(app);
    check("페이지: 롬 없는 폴더의 묶은 빌드를 원래 페이지로", pageOk && (await app.evaluate(`${T}.state.game?.kind`)) === "frame" && /내장 롬/.test(said), said);
    await sleep(4000);
    let inner = null;
    try {
      inner = await connect(PORT, { match: "game.", timeoutMs: 8000 });
    } catch {}
    if (inner) {
      const got = await inner.evaluate("fetch('rom').then(async (r) => { const b = new Uint8Array(await r.arrayBuffer()); const d = new Uint8Array(await crypto.subtle.digest('SHA-1', b)); return { status: r.status, size: b.length, sha: Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('') }; })");
      check("페이지: /rom 이 묶인 롬을 풀어 줌(SHA-1 같음)", got.status === 200 && got.size === rom.length && got.sha === romSha, `${got.status} · ${got.size} · ${got.sha.slice(0, 12)}`);
      const overlay = await inner.evaluate("document.getElementById('overlayText')?.textContent ?? ''");
      check("페이지: 롬을 받아 준비됨", /준비되었습니다/.test(overlay), overlay);
      inner.close();
    } else {
      check("페이지: 페이지 대상 찾기(CDP)", false, "");
    }
    await close(app);
  }

  // 7. 여는 시간(같은 앱, 첫 번째는 버림): 옛 방식(구획 없음 + 옆 롬) / 묶은 것
  const before = [];
  const after = [];
  await timeOpen(app, plainFile);
  await timeOpen(app, packedFile);
  for (let i = 0; i < 3; i++) {
    before.push(await timeOpen(app, plainFile));
    after.push(await timeOpen(app, packedFile));
  }
  await close(app);
  const sizes = { plain: wasm.length, packed: packed.length, rom: rom.length };
  fs.writeFileSync(path.join(work, "app_embed_timing.json"), JSON.stringify({ before, after, sizes }, null, 2));
  check("시간: 여는 시간 재기", before.every((ms) => ms > 0) && after.every((ms) => ms > 0), `옛 방식 ${before.join("/")}ms(가운데 ${median(before)}) · 묶은 것 ${after.join("/")}ms(가운데 ${median(after)})`);

  // 8. 끌어 놓기(실제 마우스)
  if (extra.includes("drop")) {
    await sleep(1000);
    await app.evaluate("window.__DRAGLOG__ = []; window.addEventListener('webgba:os-drag', (e) => window.__DRAGLOG__.push(e.detail.phase)); window.addEventListener('webgba:os-drop', (e) => window.__DRAGLOG__.push('drop')); true");
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "drag-drop.ps1");
    const done = spawnSync("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script, "-File", packedFile], { encoding: "utf8", timeout: 40000 });
    const out = `${done.stdout ?? ""}${done.stderr ?? ""}`.trim();
    const dropped = await waitGame(app, `${build}.wgba`, 20000);
    said = await statusOf(app);
    const log = await app.evaluate("window.__DRAGLOG__");
    check("끌어 놓기: 묶은 .wgba 가 고르기 창 없이 열림", dropped && /내장 롬/.test(said), `${said} · ${out.split(/\r?\n/).at(-1)} · 이벤트 ${log.filter((x) => x !== "over").join(",")} over ${log.filter((x) => x === "over").length}`);
    await app.screenshot(path.join(captures, "embed_drop.png"));
    await close(app);
  }
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  if (!app && running()) app = await connect(PORT, { timeoutMs: 5000 }).catch(() => null);
  if (app) await stop(app);
  fs.writeFileSync(path.join(work, "app_embed_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
