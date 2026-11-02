// exe 파일 연결 시험(실제 앱, CDP): .wgbp 만 연결 · 이전 버전이 쓴 .wgba·.gb·.gbc 값 삭제 · 다른 프로그램 값 보존.
//   node tools/test/app-assoc.mjs <exe> <작업 폴더>
// 식별자를 바꾼 시험 빌드만 쓴다(guardOthers). 시작할 때 관련 HKCU 키를 reg export 해 두고, 끝나면 지운 뒤 다시 넣어
// 시험 전과 같은지(reg query /s 바이트 비교) 확인한다 — 사용자 PC 의 .wgba·.wgbp 연결은 그대로 남는다.
// 앱 폴더 <작업>\app_assoc, 결과 <작업>\app_assoc_result.json, 백업 <작업>\reg_backup_assoc\*.reg
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-assoc.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9353;
const appDir = path.join(work, "app_assoc");
const backup = path.join(work, "reg_backup_assoc");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const C = "HKCU\\Software\\Classes\\";
const OTHER = "webgbaTestOther";
const KEYS = [".wgba", ".wgbp", ".gb", ".gbc", "webGBA.wgba", "webGBA.wgbp", "webGBA.gb", "webGBA.gbc", `${OTHER}.gb`];

const reg = (...args) => spawnSync("reg", args, { encoding: "latin1" });
const dump = (key) => {
  const done = spawnSync("reg", ["query", C + key, "/s"]);
  return done.status === 0 ? done.stdout.toString("hex") : "";
};
// reg query prints a localized "(value not set)" for an empty default, so read the key's own section of a .reg export instead
const peek = path.join(work, "reg_peek.reg");
const value = (key, name = null) => {
  fs.mkdirSync(work, { recursive: true });
  if (spawnSync("reg", ["export", C + key, peek, "/y"]).status !== 0) return null;
  const lines = fs.readFileSync(peek).toString("utf16le").split(/\r?\n/);
  const head = lines.findIndex((l) => l.toLowerCase() === `[${(C.replace(/^HKCU/, "HKEY_CURRENT_USER") + key).toLowerCase()}]`);
  const want = name === null ? "@=" : `${JSON.stringify(name)}=`;
  for (let i = head + 1; head >= 0 && i < lines.length && !lines[i].startsWith("["); i++) {
    if (lines[i].startsWith(want)) return JSON.parse(lines[i].slice(want.length));
  }
  return null;
};
const exists = (key) => reg("query", C + key).status === 0;
const put = (key, name, data) => reg("add", C + key, ...(name === null ? ["/ve"] : ["/v", name]), "/t", "REG_SZ", "/d", data, "/f").status === 0;

fs.rmSync(appDir, { recursive: true, force: true });
fs.rmSync(backup, { recursive: true, force: true });
fs.mkdirSync(backup, { recursive: true });
const before = Object.fromEntries(KEYS.map((key) => [key, dump(key)]));
const saved = KEYS.map((key, i) => {
  const file = path.join(backup, `${i}.reg`);
  return { key, file, had: spawnSync("reg", ["export", C + key, file, "/y"]).status === 0 };
});
if (saved.find((s) => s.key === `${OTHER}.gb`).had) throw new Error(`${OTHER}.gb 키가 이미 있습니다`);

function restore() {
  for (const { key, file, had } of saved) {
    reg("delete", C + key, "/f");
    if (had) spawnSync("reg", ["import", file]);
  }
}

// 이전 버전이 쓴 값 + 다른 프로그램 값
function seedOld() {
  const cmd = `"C:\\old\\webgba.exe" "%1"`;
  put(".wgba", null, "webGBA.wgba");
  put(".wgba\\OpenWithProgids", `${OTHER}.wgba`, "");
  put("webGBA.wgba", null, "webGBA 게임");
  put("webGBA.wgba\\shell\\open\\command", null, cmd);
  put(".gb", null, "webGBA.gb");
  put(".gb\\OpenWithProgids", "webGBA.gb", "");
  put(".gb\\OpenWithProgids", `${OTHER}.gb`, "");
  put("webGBA.gb\\shell\\open\\command", null, cmd);
  put(`${OTHER}.gb`, null, "other emulator");
  put(".gbc", null, `${OTHER}.gbc`);
  put(".gbc\\OpenWithProgids", "webGBA.gbc", "");
  put("webGBA.gbc\\shell\\open\\command", null, cmd);
}

function oldGone() {
  const got = {
    wgba: value(".wgba"),
    wgbaOther: value(".wgba\\OpenWithProgids", `${OTHER}.wgba`),
    wgbaProg: exists("webGBA.wgba"),
    gb: value(".gb"),
    gbOurs: value(".gb\\OpenWithProgids", "webGBA.gb"),
    gbOther: value(".gb\\OpenWithProgids", `${OTHER}.gb`),
    gbProg: exists("webGBA.gb"),
    otherProg: value(`${OTHER}.gb`),
    gbc: value(".gbc"),
    gbcList: exists(".gbc\\OpenWithProgids"),
    gbcProg: exists("webGBA.gbc"),
  };
  const ok = got.wgba === null && got.wgbaOther === "" && !got.wgbaProg && got.gb === null && got.gbOurs === null && got.gbOther === "" && !got.gbProg && got.otherProg === "other emulator" && got.gbc === `${OTHER}.gbc` && !got.gbcList && !got.gbcProg;
  return { ok, got };
}

const T = "window.__WEBGBA_TEST__";
const running = () => runningIn(appDir);

async function start() {
  launch(appExe, PORT);
  for (let attempt = 0; attempt < 10; attempt++) {
    const app = await connect(PORT);
    try {
      await app.evaluate(`new Promise((r) => { const t = () => (${T}?.state?.link ? r(true) : setTimeout(t, 100)); t(); })`);
      await sleep(500);
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

const appExe = prepareApp(exe, appDir, { link: true });
let app = null;
try {
  guardOthers(exe, appDir);
  if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  seedOld();
  app = await start();
  const wgbpCmd = value("webGBA.wgbp\\shell\\open\\command") ?? "";
  check("켤 때 .wgbp 를 이 exe 로 연결(HKCU)", value(".wgbp") === "webGBA.wgbp" && wgbpCmd.toLowerCase().includes(appExe.toLowerCase()) && (await app.evaluate(`${T}.state.link.linked`)), `${value(".wgbp")} · ${wgbpCmd}`);
  const first = oldGone();
  check("켤 때 이전 버전의 .wgba·.gb·.gbc 값 삭제 · 다른 프로그램 값(기본값·OpenWithProgids·ProgID) 보존", first.ok, JSON.stringify(first.got));
  const note = await app.evaluate(`${T}.i18n.t("cfg.wgbaLink")`);
  check("설정 문구 = .wgbp 하나", /^\.wgbp /.test(note), note);

  await app.evaluate(`${T}.toggleLink()`);
  await sleep(300);
  check("연결 해제: .wgbp 값·ProgID 삭제, 다른 프로그램 값 보존", value(".wgbp") === null && !exists("webGBA.wgbp") && oldGone().ok && !(await app.evaluate(`${T}.state.link.linked`)), await app.evaluate("document.getElementById('status').textContent"));
  await stop(app);

  seedOld();
  app = await start();
  const refused = oldGone();
  check("해제를 선택한 뒤 다시 켜도 .wgbp 는 등록하지 않고 이전 버전 값만 삭제", value(".wgbp") === null && refused.ok, JSON.stringify(refused.got));
  await app.evaluate(`${T}.toggleLink()`);
  await sleep(300);
  check("다시 연결: .wgbp 만 등록", value(".wgbp") === "webGBA.wgbp" && !exists("webGBA.wgba") && !exists("webGBA.gb") && !exists("webGBA.gbc"), value("webGBA.wgbp\\shell\\open\\command"));
  await stop(app);
  app = null;
} catch (error) {
  check("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
} finally {
  if (!app && running()) app = await connect(PORT, { timeoutMs: 5000 }).catch(() => null);
  if (app) await stop(app);
  restore();
  const after = Object.fromEntries(KEYS.map((key) => [key, dump(key)]));
  const changed = KEYS.filter((key) => before[key] !== after[key]);
  check("시험 뒤 레지스트리 = 시험 전(사용자 .wgba·.wgbp 연결 그대로)", changed.length === 0, changed.length ? `다름: ${changed.join(", ")}` : `.wgba=${value(".wgba")} · .wgbp=${value(".wgbp")}`);
  fs.writeFileSync(path.join(work, "app_assoc_result.json"), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n파일 연결: ${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
}
