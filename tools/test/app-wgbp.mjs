// .wgbp(롬이 들어 있지 않은 공유용 패치) 시험. 실제 앱, CDP.
//   node tools/test/app-wgbp.mjs <exe> <작업 폴더> <파일.wgbp> <바탕 롬 1> <바탕 롬 2> <받으면 안 되는 롬> [세이브.sav]
// 작업 폴더 안 patch\ 에 .wgbp 하나만 두고(옆·위 폴더에 롬 없음) 연다. 롬 고르기는 시험 훅(openPath 의 patchRom)으로 넘긴다
// (Windows 고르기 창은 손으로만). 인자 열기 → 안내 창 CANCEL, 바탕 롬 1 로 만들기(.wgba SHA-1 = manifest), 다시 열면 그대로,
// 다른 .wgba 가 있으면 덮어쓰기 확인(OK) 뒤 바탕 롬 2 로 다시, 받으면 안 되는 롬은 세 언어 안내·파일 안 생김, 롬과 같이 끌어
// 놓기(openDropped), 만든 .wgba 를 바로 열어 게임이 돎, 옆 .sav 를 읽음, 같은 폴더 목록의 .wgbp 줄. 앱 폴더 <작업>\app_wgbp.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { readPatch } from "../../src-bundle/src/js/core/wgbp.js";

const [exe, work, patchPath, rom1, rom2, wrongRom, savePath] = process.argv.slice(2);
if (!exe || !work || !patchPath || !rom1 || !rom2 || !wrongRom) {
  console.error("사용법: node tools/test/app-wgbp.mjs <exe> <작업 폴더> <파일.wgbp> <바탕 롬 1> <바탕 롬 2> <받으면 안 되는 롬> [세이브.sav]");
  process.exit(2);
}
const PORT = 9347;
const T = "window.__WEBGBA_TEST__";
const appDir = path.join(work, "app_wgbp");
const captures = path.join(work, "captures");
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(captures, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const manifest = readPatch(new Uint8Array(fs.readFileSync(patchPath))).manifest;
const dir = path.join(work, "patch");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const stem = "rapid_test";
const patchFile = path.join(dir, `${stem}.wgbp`);
fs.copyFileSync(patchPath, patchFile);
const outFile = path.join(dir, `${stem}.wgba`);
const outSave = path.join(dir, `${stem}.sav`);
const noRomAround = ![dir, path.dirname(dir)].some((d) => fs.readdirSync(d).some((n) => /\.(gba|agb|zip|bin)$/i.test(n)));

const running = () => runningIn(work);
async function start(args = []) {
  launch(appExe, PORT, args);
  for (let attempt = 0; attempt < 10; attempt++) {
    const app = await connect(PORT);
    try {
      await app.evaluate(`new Promise((r) => { const t = () => (${T}?.state?.info ? r(true) : setTimeout(t, 100)); t(); })`);
      await sleep(600);
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
const dialogShown = (app) => app.evaluate("!document.getElementById('layer').hidden");
const dialogText = (app) => app.evaluate("document.getElementById('dialog-title').textContent + ' | ' + document.getElementById('dialog-body').textContent");
const press = (app, go) => app.evaluate(`(() => { const b = document.querySelector('#dialog-actions .btn${go ? ".btn--go" : ":not(.btn--go)"}'); if (!b) return false; b.click(); return true; })()`);
async function waitFor(fn, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
const noPath = (text) => !/[A-Za-z]:\\/.test(text);
const stageClip = (app) => app.evaluate("(() => { const b = document.getElementById('screen').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()");
const hostRomSha = (app) => app.evaluate(`(async () => { const r = ${T}.player.host?.rom; if (!r) return ''; const d = new Uint8Array(await crypto.subtle.digest('SHA-1', r)); return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join(''); })()`);

guardOthers(exe, work);
if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
const appExe = prepareApp(exe, appDir);
let app = null;
try {
  check("준비: .wgbp 옆·위 폴더에 롬 없음", noRomAround, `${path.basename(patchFile)} ${fs.statSync(patchFile).size}바이트`);

  app = await start([patchFile]);
  const asked = await waitFor(() => dialogShown(app), 15000);
  const text = asked ? await dialogText(app) : "";
  check("인자: .wgbp 를 켜자마자 안내 창(제목·만들 파일·쓸 수 있는 롬)", asked && text.includes(manifest.title) && text.includes(`${stem}.wgba`) && manifest.bases.filter((b) => b.main !== false).every((b) => text.includes(b.name)), text.slice(0, 160));
  if (asked) await app.screenshot(path.join(captures, "wgbp_intro.png"));
  await press(app, false);
  await waitFor(async () => !(await app.evaluate(`${T}.state.opening`)), 5000);
  let said = await statusOf(app);
  check("안내 창 CANCEL: 만들지 않음·알림", !fs.existsSync(outFile) && /만들지 않았습니다/.test(said), said);

  await app.evaluate("(() => { window.__frames = []; window.__stopFrames = false; const loop = (now) => { const l = document.querySelector('.loader'); window.__frames.push([now, l ? Number(l.dataset.percent || 0) : -1, l ? l.dataset.stage || '' : '']); if (window.__frames.length < 20000 && !window.__stopFrames) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return true; })()");
  const t0 = Date.now();
  const made = await open(app, patchFile, { patchRom: rom1 });
  const tookMs = Date.now() - t0;
  const frames = await app.evaluate("(() => { window.__stopFrames = true; return window.__frames.filter((f) => f[1] >= 0); })()");
  const gaps = {};
  for (let i = 1; i < frames.length; i++) {
    const stage = frames[i][2] || "?";
    gaps[stage] = Math.max(gaps[stage] ?? 0, Math.round(frames[i][0] - frames[i - 1][0]));
  }
  const workGap = Math.max(...["check", "patch", "verify", "pack"].map((s) => gaps[s] ?? 0));
  const stagesSeen = [...new Set(frames.map((f) => f[2]).filter(Boolean))];
  check("로더: 단계(롬 확인→패치→결과 확인→묶기→쓰기→여는 중)·패치·압축 동안 막대가 멈추지 않음", ["check", "patch", "verify", "pack", "write", "open"].every((s) => stagesSeen.includes(s)) && workGap < 250 && new Set(frames.map((f) => Math.floor(f[1]))).size >= 15, `${stagesSeen.join(",")} · 단계별 최대 프레임 간격 ${JSON.stringify(gaps)}`);
  check("로더: 끝나면 닫힘", await waitFor(async () => !(await app.evaluate("Boolean(document.querySelector('.loader'))")), 3000));
  said = await statusOf(app);
  const outSha = fs.existsSync(outFile) ? sha1(fs.readFileSync(outFile)) : "";
  check("바탕 롬 1: 옆에 .wgba 를 만듦(SHA-1 = manifest)", made && outSha === manifest.wgba.sha1, `${outSha.slice(0, 12)} · ${tookMs}ms`);
  check("바탕 롬 1: 만든 .wgba 를 내장 롬으로 바로 엶", (await app.evaluate(`${T}.state.game?.name ?? ''`)) === `${stem}.wgba` && (await app.evaluate(`${T}.state.game?.romEmbedded === true`)), said);
  check("바탕 롬 1: 상태 줄 '만들었습니다'·'내장 롬'·경로 없음", /만들었습니다/.test(said) && /내장 롬/.test(said) && noPath(said), said);
  check("코어가 받은 롬 = 결과 롬", (await hostRomSha(app)) === manifest.rom.sha1, manifest.rom.sha1.slice(0, 12));
  check("세이브 자리: 만든 .wgba 옆 <이름>.sav", (await app.evaluate(`window.__TAURI__.core.invoke('save_path', { game: ${JSON.stringify(outFile)} })`)).toLowerCase() === outSave.toLowerCase(), "");
  await sleep(24000);
  await app.screenshot(path.join(captures, "wgbp_made_title.png"), await stageClip(app));
  const colors = await app.evaluate("(() => { const d = document.getElementById('screen').getContext('2d').getImageData(0, 0, 240, 160).data; const s = new Set(); for (let i = 0; i < d.length; i += 148) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return s.size; })()");
  check("만든 게임이 돌아감(타이틀까지)", colors > 8, `화면 색 ${colors}`);
  await close(app);

  const t1 = Date.now();
  const again = await open(app, patchFile);
  said = await statusOf(app);
  check("다시 열기: 같은 .wgba 가 있으면 고르지 않고 그대로 엶", again && /이미 만든/.test(said) && !(await dialogShown(app)), `${Date.now() - t1}ms · ${said}`);
  await close(app);

  fs.appendFileSync(outFile, Buffer.from([0]));
  const pending = open(app, patchFile, { patchRom: rom2 }).catch((e) => String(e));
  const confirmShown = await waitFor(() => dialogShown(app), 10000);
  const confirmText = confirmShown ? await dialogText(app) : "";
  check("다른 .wgba 가 있으면 덮어쓰기 확인", confirmShown && /덮어쓸까요/.test(confirmText), confirmText.slice(0, 120));
  await press(app, true);
  const rebuilt = await pending;
  check("확인 OK: 바탕 롬 2 로 다시 만듦(SHA-1 같음)", rebuilt === true && sha1(fs.readFileSync(outFile)) === manifest.wgba.sha1, await statusOf(app));
  await close(app);

  fs.rmSync(outFile, { force: true });
  for (const [lang, pattern] of [["ko", /이미 이 패치를 적용한 롬/], ["en", /already has this patch applied/], ["ja", /すでにこのパッチを当てた/]]) {
    await app.evaluate(`${T}.setLang(${JSON.stringify(lang)})`);
    await sleep(300);
    const pendingWrong = open(app, patchFile, { patchRom: wrongRom });
    const failShown = await waitFor(() => app.evaluate("Boolean(document.querySelector('.loader[data-state=\"fail\"]'))"), 20000);
    const failText = failShown ? await app.evaluate("document.querySelector('.loader__error').textContent + ' @' + (document.querySelector('.loader__step[data-state=\"fail\"]')?.dataset.stage ?? '')") : "";
    if (lang === "ko" && failShown) await app.screenshot(path.join(captures, "wgbp_loader_fail.png"));
    await app.evaluate("document.querySelector('.loader .loader__actions button')?.click()");
    const ok = await pendingWrong;
    said = await statusOf(app);
    check(`받으면 안 되는 롬(${lang}): 로더가 '롬 확인' 단계에서 이유를 보이고 CLOSE`, failShown && pattern.test(failText) && failText.endsWith("@check"), failText.slice(0, 140));
    check(`받으면 안 되는 롬(${lang}): 알아듣는 안내·파일 안 생김·경로 없음`, !ok && pattern.test(said) && !fs.existsSync(outFile) && noPath(said), said);
  }
  await app.evaluate(`${T}.setLang("ko")`);
  await sleep(300);

  const dropped = await app.evaluate(`${T}.openDropped(${JSON.stringify([patchFile, rom2])}).then(() => ${T}.state.game?.name ?? '')`);
  check("롬과 같이 끌어 놓기: 고르지 않고 만들어 엶", dropped === `${stem}.wgba` && sha1(fs.readFileSync(outFile)) === manifest.wgba.sha1, await statusOf(app));
  await close(app);

  if (savePath) {
    fs.copyFileSync(savePath, outSave);
    const ok = await open(app, outFile);
    said = await statusOf(app);
    const sum = await app.evaluate(`(() => { const d = ${T}.player.host.saveData(); let s = 0; for (const b of d) s = (s * 31 + b) >>> 0; return s; })()`);
    let want = 0;
    for (const b of fs.readFileSync(outSave)) want = (want * 31 + b) >>> 0;
    check("만든 .wgba 를 바로 열면 옆 .sav 를 읽음", ok && /세이브를 불러왔습니다/.test(said) && sum === want, said);
    await close(app);
  }

  if ((await app.evaluate(`${T}.state.prefs.panel`)) !== "files" || (await app.evaluate("document.getElementById('sidepanel').hidden"))) await app.evaluate(`${T}.showPanel("files")`);
  await sleep(500);
  const rows = await app.evaluate("Array.from(document.querySelectorAll('#sidepanel-list .row')).map((r) => r.className + ':' + r.textContent.trim())");
  check("같은 폴더 목록에 .wgbp 줄(패치 아이콘)", rows.some((r) => r.includes("row--patch") && r.includes(`${stem}.wgbp`)) && rows.some((r) => r.includes(`${stem}.wgba`)), rows.join(" / "));
  await app.screenshot(path.join(captures, "wgbp_list.png"));
} catch (error) {
  check("시험이 끝까지 돎", false, String(error?.stack ?? error));
} finally {
  if (app) await stop(app).catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length}개 중 ${results.length - failed.length}개 통과`);
fs.writeFileSync(path.join(work, "app-wgbp.json"), JSON.stringify(results, null, 2));
process.exitCode = failed.length ? 1 : 0;
