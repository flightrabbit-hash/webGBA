// webGBA exe 자체 업데이트 시험(실제 앱, CDP, 흉내 R2 — 실제 R2 안 씀). 시험 식별자로 빌드한 exe 만(기본 식별자 exe 금지).
//   node tools/test/app-self-update.mjs <시험 exe> <작업 폴더>
// 작업 폴더에 시험용 서명 키(작업 폴더 밖 임시 폴더)·발행 묶음(ok·badsig·badfile)·앱 폴더를 만든다. 새 exe = 시험 exe + 끝에 32바이트(PE 뒤 덧붙임 — 실행 그대로).
// 앱의 지금 버전은 시험 덮어쓰기(localStorage webgba.updateTest.app.version = 0.0.1)로 낮춘다 — 버전 번호는 올리지 않는다.
// 확인: 서명 틀림 → 창 없음·파일 그대로 / 받은 파일 손상·내려받기 끊김 → 실패 안내·파일 그대로·단계 폴더 없음 /
// 교체 중 실패 → 되돌림(exe·LICENSE 그대로, 같은 프로세스) / 성공 → 바뀐 파일만 받기·교체·다시 시작·설정·퀵슬롯·세이브 그대로·.old·단계 폴더 정리 ·
// 목록 요청 실행마다 1번 · 창 버튼 잉크 세로 가운데.
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { attach, guardOthers, isolatedBuild, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { decodePng } from "../../web/test/png.mjs";
import { publicOf } from "../lib/update-cmds.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-self-update.mjs <시험 exe> <작업 폴더>");
  process.exit(2);
}
if (!isolatedBuild(exe)) {
  console.error("기본 식별자 exe 는 쓰지 않습니다 — 식별자를 바꾼 시험 빌드를 주세요");
  process.exit(2);
}
const PORT = 9351;
const R2_PORT = 9483;
const R2 = `http://127.0.0.1:${R2_PORT}`;
const T = "window.__WEBGBA_TEST__";
const APP_ID = "com.flightrabbit.webgba";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const root = path.resolve(work);
const appDir = path.join(root, "app");
const feeds = path.join(root, "feeds");
const rel = path.join(root, "newrel");
const shots = path.join(root, "captures");
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "webgba-selfupd-"));
for (const dir of [appDir, feeds, rel]) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(rel, { recursive: true });
fs.mkdirSync(shots, { recursive: true });

// 시험 키(작업 폴더 밖 임시 폴더 — 끝나면 삭제)
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keyFile = path.join(keyDir, "test.pem");
fs.writeFileSync(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }));
const pub = publicOf(privateKey);

// 앱 폴더(옛 버전 흉내) + 보존 확인 표시
guardOthers(exe, appDir);
const app = prepareApp(exe, appDir);
const notices = fs.readFileSync(path.join(repo, "THIRD_PARTY_NOTICES"));
fs.writeFileSync(path.join(appDir, "LICENSE"), "OLD LICENSE\n");
fs.writeFileSync(path.join(appDir, "THIRD_PARTY_NOTICES"), notices);
const cfg = path.join(appDir, "bin", "ini", "personalization.cfg");
fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, "utf8")), volume: 37 }, null, 2));
fs.mkdirSync(path.join(appDir, "bin", "state"), { recursive: true });
const slot = path.join(appDir, "bin", "state", "marker.ss1");
fs.writeFileSync(slot, crypto.randomBytes(4096));
fs.mkdirSync(path.join(appDir, "games"), { recursive: true });
const sav = path.join(appDir, "games", "marker.sav");
fs.writeFileSync(sav, crypto.randomBytes(8192));
const keep = { slot: sha256(fs.readFileSync(slot)), sav: sha256(fs.readFileSync(sav)), ini: sha256(fs.readFileSync(path.join(appDir, "bin", "ini", "setting.ini"))) };
const oldExe = sha256(fs.readFileSync(app));

// 새 릴리스: exe + 32바이트, LICENSE 바뀜, THIRD_PARTY_NOTICES 그대로(받지 않아야 함)
const newExeBytes = Buffer.concat([fs.readFileSync(exe), crypto.randomBytes(32)]);
fs.writeFileSync(path.join(rel, "webgba.exe"), newExeBytes);
fs.writeFileSync(path.join(rel, "LICENSE"), "NEW LICENSE\n");
fs.writeFileSync(path.join(rel, "THIRD_PARTY_NOTICES"), notices);
const newExe = sha256(newExeBytes);

const tool = (...args) => {
  const out = spawnSync(process.execPath, [path.join(repo, "tools", "wgba.mjs"), ...args], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`wgba.mjs ${args[0]} 실패: ${out.stderr || out.stdout}`);
  return out.stdout;
};
const okDir = path.join(feeds, "ok");
tool("app", "--dir", path.join(okDir, APP_ID), "--key", keyFile, "--exe", path.join(rel, "webgba.exe"), "--file", path.join(rel, "LICENSE"), "--file", path.join(rel, "THIRD_PARTY_NOTICES"), "--test-id", "--no-index", "--time", "2026-11-10T00:00:00Z");
tool("index", "--root", okDir, "--key", keyFile, "--time", "2026-11-10T00:00:00Z");
const verified = spawnSync(process.execPath, [path.join(repo, "tools", "wgba.mjs"), "verify", okDir, "--pub", pub], { encoding: "utf8" });
ok("발행 도구 app → index → verify 통과", verified.status === 0, (verified.stdout.trim().split("\n").pop() ?? "").trim());
const signedApp = JSON.parse(JSON.parse(fs.readFileSync(path.join(okDir, APP_ID, "latest.json"), "utf8")).signed);
const version = signedApp.version;
const licenseBlob = signedApp.files.find((f) => f.path === "LICENSE").get.url;

// badfile: 서명은 맞고 LICENSE 압축 파일만 1바이트 바뀜(크기 같음)
fs.cpSync(okDir, path.join(feeds, "badfile"), { recursive: true });
const blob = path.join(feeds, "badfile", APP_ID, ...licenseBlob.split("/"));
const bytes = fs.readFileSync(blob);
bytes[bytes.length >> 1] ^= 0xff;
fs.writeFileSync(blob, bytes);
// badsig: 목록·버전 파일 모두 서명 글만 바꿈(서명 그대로)
fs.cpSync(okDir, path.join(feeds, "badsig"), { recursive: true });
for (const file of [path.join(feeds, "badsig", "index.json"), path.join(feeds, "badsig", APP_ID, "latest.json")]) {
  const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  envelope.signed = envelope.signed.replace(`"version":"${version}"`, `"version":"9.9.9"`).replace('"time":"2026-11-10T00:00:00Z"', '"time":"2026-11-10T00:00:01Z"');
  if (envelope.apps) envelope.apps[APP_ID].signed = envelope.apps[APP_ID].signed.replace(`"version":"${version}"`, `"version":"9.9.9"`);
  fs.writeFileSync(file, JSON.stringify(envelope, null, 1));
}

const r2 = spawn(process.execPath, [path.join(here, "update-server.mjs"), feeds, String(R2_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => r2.stdout.once("data", resolve));
const r2get = (what) => fetch(`${R2}/${what}`);
const requests = async () => (await (await r2get("__log")).json()).map((l) => l.path);

const appFiles = () => ({ exe: sha256(fs.readFileSync(app)), license: fs.readFileSync(path.join(appDir, "LICENSE"), "utf8"), stage: fs.existsSync(path.join(appDir, ".webgba-update")), olds: fs.readdirSync(appDir).filter((n) => n.endsWith(".old")) });

let cdp = null;
const waitFor = async (expr, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cdp.evaluate(expr).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
};
const reload = async () => {
  await r2get("__clear");
  await cdp.evaluate("location.reload(); 1").catch(() => {});
  cdp.close();
  await sleep(1500);
  cdp = await attach(PORT);
};
const dialogShown = `!document.getElementById("layer").hidden && document.getElementById("dialog").dataset.kind === "app-update"`;
const stateText = () => cdp.evaluate(`document.querySelector("#dialog .aupd__state")?.textContent ?? ""`);
const clickUpdate = () => cdp.evaluate(`[...document.querySelectorAll("#dialog-actions .btn")].find((b) => b.textContent === "UPDATE").click(); 1`);
const clickLater = () => cdp.evaluate(`[...document.querySelectorAll("#dialog-actions .btn")].find((b) => b.textContent === "LATER")?.click(); 1`);
const failedShown = `Boolean(document.querySelector("#dialog .aupd__state--why"))`;

const ink = async (label, selector, file) => {
  const image = decodePng(fs.readFileSync(file));
  const dpr = await cdp.evaluate("devicePixelRatio");
  const boxes = await cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((n) => n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return { l: r.left + parseFloat(s.borderLeftWidth), r: r.right - parseFloat(s.borderRightWidth), t: r.top + parseFloat(s.borderTopWidth), b: r.bottom - parseFloat(s.borderBottomWidth) }; })`);
  const each = [];
  for (const box of boxes) {
    const x0 = Math.round((box.l + 2) * dpr);
    const x1 = Math.round((box.r - 2) * dpr);
    const y0 = Math.round(box.t * dpr) + 1;
    const y1 = Math.round(box.b * dpr) - 1;
    const at = (x, y) => (y * image.width + x) * 4;
    const bg = image.data.subarray(at(x0, y0), at(x0, y0) + 3);
    let top = -1;
    let bottom = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = at(x, y);
      if (Math.max(Math.abs(image.data[o] - bg[0]), Math.abs(image.data[o + 1] - bg[1]), Math.abs(image.data[o + 2] - bg[2])) > 48) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
    if (top >= 0) each.push([Math.round((top - y0) / dpr), Math.round((y1 - 1 - bottom) / dpr)]);
  }
  const worst = Math.max(0, ...each.map(([a, b]) => Math.abs(a - b)));
  ok(`${label} 잉크 세로 가운데(${each.length}개)`, each.length > 0 && worst <= 1, `최대 차이 ${worst}px(홀수 1행 허용) · 위/아래 ${each.map((e) => e.join("/")).join(" ")}`);
};

try {
  launch(app, PORT);
  cdp = await attach(PORT);
  await cdp.evaluate(`localStorage.setItem("webgba.updateTest", ${JSON.stringify(JSON.stringify({ index: { url: `${R2}/index.json`, key: pub }, app: { version: "0.0.1" } }))}); 1`);

  // 1. 서명 틀림 → 창 없음 · 파일 그대로 · 목록 → 앱 버전 파일 대체 1번씩
  await r2get("__use?mode=badsig");
  await reload();
  const sigShown = await waitFor(dialogShown, 6000);
  const sigLog = await requests();
  ok("서명 틀림 → 업데이트 창 없음 · 파일 그대로", !sigShown && appFiles().exe === oldExe, `요청 ${sigLog.join(", ")}`);
  ok("서명 틀림 → 목록 1번 + 앱 버전 파일(대체) 1번 · 받기 0번", sigLog.filter((p) => p === "/index.json").length === 1 && sigLog.filter((p) => p === `/${APP_ID}/latest.json`).length === 1 && !sigLog.some((p) => p.includes("/files/")), sigLog.join(", "));

  // 2. 받은 파일 손상(SHA-256) → 실패 안내 · 파일 그대로 · 단계 폴더 없음
  await r2get("__use?mode=badfile");
  await reload();
  const fileShown = await waitFor(dialogShown, 15000);
  const lead = fileShown ? await cdp.evaluate(`document.querySelector("#dialog .dialog__lead").textContent`) : "";
  ok(`업데이트 창 표시(0.0.1 → ${version})`, fileShown && lead.includes("0.0.1") && lead.includes(version), lead);
  await sleep(300);
  const popup = path.join(shots, "selfupdate_popup.png");
  await cdp.screenshot(popup);
  await ink("업데이트 창 아래 버튼(LATER·UPDATE)", "#dialog-actions .btn", popup);
  await clickUpdate();
  const fileFailed = await waitFor(failedShown, 60000);
  const fileFiles = appFiles();
  ok("받은 파일 손상 → 실패 안내 · exe·LICENSE 그대로 · 단계 폴더 없음", fileFailed && fileFiles.exe === oldExe && fileFiles.license === "OLD LICENSE\n" && !fileFiles.stage && !fileFiles.olds.length, `${await stateText()} · ${JSON.stringify({ ...fileFiles, exe: fileFiles.exe.slice(0, 8) })}`);
  await clickLater();

  // 3. 내려받기 끊김 → 실패 안내 · 파일 그대로
  await r2get("__use?mode=ok");
  await r2get("__cut?bytes=65536");
  await reload();
  await waitFor(dialogShown, 15000);
  await clickUpdate();
  const cutFailed = await waitFor(failedShown, 60000);
  const cutFiles = appFiles();
  ok("내려받기 끊김 → 실패 안내 · 파일 그대로 · 단계 폴더 없음", cutFailed && cutFiles.exe === oldExe && !cutFiles.stage && !cutFiles.olds.length, await stateText());
  await r2get("__cut?bytes=0");
  await clickLater();

  // 4. 교체 중 실패: exe 다음에 바꿀 LICENSE 의 .old 자리에 지울 수 없는 폴더 → exe 까지 되돌림
  const blocker = path.join(appDir, "LICENSE.old");
  fs.mkdirSync(path.join(blocker, "x"), { recursive: true });
  await reload();
  await waitFor(dialogShown, 15000);
  const pidOf = () => spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process webgba | Where-Object { $_.Path -eq '${app.replace(/'/g, "''")}' } | Select-Object -First 1).Id`], { encoding: "utf8" }).stdout.trim();
  const pid = pidOf();
  await clickUpdate();
  const swapFailed = await waitFor(failedShown, 60000);
  const swapFiles = appFiles();
  const pidAfter = pidOf();
  const swapText = await stateText();
  ok("교체 중 실패 → 되돌림 안내 · exe·LICENSE 그대로 · webgba.exe.old 없음 · 같은 프로세스", swapFailed && /되돌렸습니다/.test(swapText) && swapFiles.exe === oldExe && swapFiles.license === "OLD LICENSE\n" && !swapFiles.olds.includes("webgba.exe.old") && pid && pid === pidAfter, `${swapText} · old ${swapFiles.olds.join(",")} · pid ${pid}/${pidAfter}`);
  const swapLog = await requests();
  const tpnBlob = `/${APP_ID}/${signedApp.files.find((f) => f.path === "THIRD_PARTY_NOTICES").get.url}`;
  ok("바뀐 파일만 받기(exe·LICENSE 2개, 같은 THIRD_PARTY_NOTICES 는 받지 않음) · 목록 1번", swapLog.filter((p) => p.includes("/files/")).length === 2 && !swapLog.includes(tpnBlob) && swapLog.filter((p) => p === "/index.json").length === 1, swapLog.join(", "));
  fs.rmSync(blocker, { recursive: true, force: true });
  await clickLater();

  // 5. 성공 → 바뀐 파일만 받기 · 교체 · 다시 시작 · 보존
  await reload();
  await waitFor(dialogShown, 15000);
  const before = pidOf();
  await clickUpdate();
  // 열린 CDP 연결이 옛 웹뷰 프로세스를 붙잡아 새 창이 늦게 뜨지 않게 누르자마자 끊음(실제 사용자 흐름에는 디버거 연결이 없음)
  cdp.close();
  const clicked = Date.now();
  let after = "";
  while (Date.now() < clicked + 90000) {
    await sleep(300);
    after = pidOf();
    if (after && after !== before) break;
  }
  let ready = false;
  while (Date.now() < clicked + 120000 && !ready) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      ready = list.some((item) => item.type === "page" && item.url.includes("ui.localhost"));
    } catch {
      ready = false;
    }
    if (!ready) await sleep(300);
  }
  cdp = await attach(PORT);
  const restartMs = Date.now() - clicked;
  ok("UPDATE → 새 프로세스로 다시 시작", after && after !== before && ready, `pid ${before} → ${after} · 누른 뒤 화면까지 ${restartMs}ms`);
  const info = await cdp.evaluate(`({ updatedFrom: ${T}.state.info.updatedFrom, status: document.getElementById("status").textContent, volume: ${T}.state.prefs.volume })`);
  ok("새 exe 로 다시 시작 · 업데이트 안내 · 옛 버전 표시", info.updatedFrom === "0.0.1" && info.status.includes(version), JSON.stringify(info));
  await sleep(1500);
  const done = appFiles();
  ok("exe·LICENSE 교체 · .old·단계 폴더 정리", done.exe === newExe && done.license === "NEW LICENSE\n" && !done.stage && !done.olds.length, JSON.stringify({ ...done, exe: done.exe.slice(0, 8) }));
  ok("설정(personalization.cfg volume·setting.ini)·퀵슬롯·세이브 그대로", info.volume === 37 && sha256(fs.readFileSync(slot)) === keep.slot && sha256(fs.readFileSync(sav)) === keep.sav && sha256(fs.readFileSync(path.join(appDir, "bin", "ini", "setting.ini"))) === keep.ini);
  ok("다시 시작한 앱 1개만 실행", runningIn(appDir) === 1, String(runningIn(appDir)));
  await sleep(2500);
  const both = await requests();
  const shownAgain = await cdp.evaluate(dialogShown);
  ok("다시 시작 뒤: 파일이 같아 창 없음 · 목록 = 실행마다 1번(옛·새 합계 2번) · THIRD_PARTY_NOTICES 받지 않음", !shownAgain && both.filter((p) => p === "/index.json").length === 2 && !both.includes(tpnBlob) && both.filter((p) => p.includes("/files/")).length <= 2, both.join(", "));
  await cdp.evaluate(`window.__TAURI__.core.invoke("window_close")`).catch(() => {});
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error));
} finally {
  cdp?.close();
  r2.kill();
  fs.rmSync(keyDir, { recursive: true, force: true });
}
await sleep(1500);
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
fs.writeFileSync(path.join(root, "app-self-update.json"), JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
