// exe 버튼 이름 시험(게임마다 버튼 글자 — 설명서 버튼 label·touchLabel). 실제 앱을 CDP 로 다룬다. 마우스를 움직이지 않는다. 레지스트리 안 건드림.
//   node tools/test/app-labels.mjs <exe> <작업 폴더>
// 시험용 .wgba 둘(docs/wgba/examples/hello-script 에 설명서만 바꿈, 롬 없음)을 작업 폴더 games 에 묶어 연다:
//   PS1 형(label·touchLabel ○ × △ □ L1 R1 · L2·R2 · input.rs) · 옛 설명서(label 만 — 공격·점프)
// 확인: 설정 창 › 키 이름 · RS 칸 글자·설명(title) · 조작법 목록 · 화면 언어 en · 옛 설명서는 RS 칸 자리 이름 그대로. 캡처 <작업>\captures\labels_*.png
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attach, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-labels.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9347;
const T = "window.__WEBGBA_TEST__";
const appDir = path.join(work, "app_labels");
const gameDir = path.join(work, "games_labels");
const captures = path.join(work, "captures");
fs.mkdirSync(captures, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const example = fileURLToPath(new URL("../../docs/wgba/examples/hello-script/", import.meta.url));
const read = (name) => fs.readFileSync(path.join(example, name));
const dirs = [["UP", "up", "ArrowUp"], ["DOWN", "down", "ArrowDown"], ["LEFT", "left", "ArrowLeft"], ["RIGHT", "right", "ArrowRight"]].map(([id, role, code]) => ({ id, role, code }));
const PS1 = {
  preset: "none",
  buttons: [
    ...dirs,
    { id: "CIRCLE", role: "a", code: "KeyZ", label: "○", touchLabel: "○" },
    { id: "CROSS", role: "b", code: "KeyX", label: "×", touchLabel: "×" },
    { id: "TRIANGLE", role: "c", code: "KeyC", label: "△", touchLabel: "△" },
    { id: "SQUARE", role: "d", code: "KeyV", label: "□", touchLabel: "□" },
    { id: "L1", role: "l", code: "KeyA", label: "L1", touchLabel: "L1" },
    { id: "R1", role: "r", code: "KeyS", label: "R1", touchLabel: "R1" },
    { id: "L2", role: "l2", code: "KeyQ", label: "L2" },
    { id: "R2", role: "r2", code: "KeyW", label: "R2" },
    { id: "START", role: "start", code: "Enter" },
    { id: "SELECT", role: "select", code: "Backspace" },
  ],
  rs: [{ buttons: ["CIRCLE", "CROSS"], hold: 6 }],
};
const OLD = {
  preset: "none",
  buttons: [...dirs, { id: "A", role: "a", code: "KeyZ", label: { en: "ATTACK", ko: "공격" } }, { id: "B", role: "b", code: "KeyX", label: { en: "JUMP", ko: "점프" } }, { id: "START", role: "start", code: "Enter" }],
  rs: [{ buttons: ["A"], hold: 3 }],
};

fs.rmSync(gameDir, { recursive: true, force: true });
fs.mkdirSync(gameDir, { recursive: true });
const pack = async (name, patch) => {
  const file = path.join(gameDir, name);
  const manifest = { ...JSON.parse(read("manifest.json")), ...patch };
  fs.writeFileSync(file, (await packWgba({ wasm: read("game.wasm"), manifest, js: read("game.js") })).bytes);
  return file;
};
const files = {
  ps1: await pack("label-ps1.wgba", { id: "com.example.labelps1", name: "Label PS1", input: PS1, display: { aspect: "4:3" } }),
  old: await pack("label-old.wgba", { id: "com.example.labelold", name: "Label Old", input: OLD }),
};

guardOthers(exe, work);
const appExe = prepareApp(exe, appDir);
launch(appExe, PORT);
const app = await attach(PORT);

const open = async (file) => {
  const done = await app.evaluate(`${T}.openPath(${JSON.stringify(file)})`);
  await app.evaluate(`new Promise((r) => { const t = () => (${T}.state.game && !${T}.state.opening ? r(true) : setTimeout(t, 100)); t(); })`);
  await sleep(500);
  return done;
};
const keysTab = async () => {
  await app.evaluate(`${T}.openSettings("keys").catch(() => {}), true`);
  await sleep(500);
  return app.evaluate(`(() => {
    const names = [...document.querySelectorAll(".keys__name")].map((n) => n.textContent);
    const chips = [...document.querySelectorAll(".rsx__key")].map((n) => ({ key: n.dataset.key, text: n.textContent, title: n.title, pressed: n.getAttribute("aria-pressed") }));
    return { names, chips };
  })()`);
};
const openSteps = () => app.evaluate(`(() => { const t = document.querySelector(".rsx__toggle"); if (t && t.getAttribute("aria-expanded") !== "true") t.click(); const box = document.querySelector(".rsx"); box?.scrollIntoView({ block: "center" }); return Boolean(t); })()`);
const closeSettings = async () => {
  await app.evaluate(`(${T}.settings.close(), true)`);
  await sleep(300);
};
const helpList = async () => {
  await app.evaluate(`(() => { document.querySelector('[data-menu="help"]').click(); return true; })()`);
  await sleep(250);
  await app.evaluate(`(() => { const item = [...document.querySelectorAll(".menu__label")].find((n) => n.textContent === ${T}.i18n.t("menu.howto")); item?.closest("button, [role=menuitem], li")?.click(); return Boolean(item); })()`);
  await sleep(400);
  return app.evaluate(`[...document.querySelectorAll("dl.help dt")].map((n) => n.textContent)`);
};
const closeDialog = async () => {
  await app.evaluate(`(() => { const b = [...document.querySelectorAll(".dialog button, #dialog-actions button")].find((n) => n.textContent === "CLOSE"); b?.click(); return Boolean(b); })()`);
  await sleep(300);
};

try {
  check("PS1 형 .wgba 열기", await open(files.ps1));
  const input = await app.evaluate(`${T}.state.input.buttons.map((b) => [b.id, b.touchLabel])`);
  check("설명서 touchLabel 을 버튼 목록이 넘김", input.find(([id]) => id === "CIRCLE")?.[1] === "○" && input.find(([id]) => id === "L2")?.[1] === null, JSON.stringify(input));

  const ko = await keysTab();
  check("설정 창 › 키: 게임 버튼 이름(○ × △ □ L1 R1 L2 R2 START SELECT)", ["○", "×", "△", "□", "L1", "R1", "L2", "R2", "START", "SELECT"].every((n) => ko.names.includes(n)), ko.names.join(" | "));
  const chip = (list, key) => list.find((c) => c.key === key);
  check("설정 창 › RS 칸: 터치 글자(A ○ · B × · C △ · D □ · L L1 · R R1, START·SELECT 그대로) · 1단계 ○·× 켬", chip(ko.chips, "A")?.text === "○" && chip(ko.chips, "B")?.text === "×" && chip(ko.chips, "C")?.text === "△" && chip(ko.chips, "D")?.text === "□" && chip(ko.chips, "L")?.text === "L1" && chip(ko.chips, "R")?.text === "R1" && chip(ko.chips, "START")?.text === "START" && chip(ko.chips, "A")?.pressed === "true" && chip(ko.chips, "B")?.pressed === "true", JSON.stringify(ko.chips.map((c) => `${c.key}:${c.text}`)));
  check("설정 창 › RS 칸 설명(title) = 버튼 이름", chip(ko.chips, "A")?.title === "○" && chip(ko.chips, "UP")?.title.includes("↑"), JSON.stringify(ko.chips.map((c) => `${c.key}:${c.title}`)));
  await app.screenshot(path.join(captures, "labels_keys_ko.png"));
  await openSteps();
  await sleep(300);
  await app.screenshot(path.join(captures, "labels_rs_ko.png"));
  await closeSettings();

  const help = await helpList();
  check("도움말 › 조작법: 게임 버튼 이름", ["○", "×", "△", "□", "L1", "R1", "L2", "R2"].every((n) => help.includes(n)), help.join(" | "));
  await app.screenshot(path.join(captures, "labels_help_ko.png"));
  await closeDialog();

  await app.evaluate(`Promise.resolve(${T}.setLang("en")).then(() => true)`);
  await sleep(400);
  const en = await keysTab();
  check("화면 언어 English: 키 이름·RS 칸 같은 글자(기호는 언어와 무관)", en.names.includes("○") && chip(en.chips, "A")?.text === "○", en.names.slice(0, 8).join(" | "));
  await app.screenshot(path.join(captures, "labels_keys_en.png"));
  await closeSettings();
  await app.evaluate(`Promise.resolve(${T}.setLang("ko")).then(() => true)`);
  await sleep(300);

  await app.evaluate(`${T}.closeGame().then(() => true)`);
  check("옛 설명서(label 만) .wgba 열기", await open(files.old));
  const old = await keysTab();
  check("옛 설명서: 키 이름 = label(공격·점프), RS 칸 = 자리 이름 그대로(A·B) · 설명(title) = label", old.names.includes("공격") && old.names.includes("점프") && chip(old.chips, "A")?.text === "A" && chip(old.chips, "B")?.text === "B" && chip(old.chips, "A")?.title === "공격", JSON.stringify(old.chips.map((c) => `${c.key}:${c.text}:${c.title}`)));
  await closeSettings();
  await app.evaluate(`${T}.closeGame().then(() => true)`);
} catch (error) {
  check("시험 도중 오류", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" "));
} finally {
  await app?.evaluate("window.__TAURI__.core.invoke('window_close').then(() => true)").catch(() => {});
  app?.close();
  for (let i = 0; i < 40 && runningIn(work); i++) await sleep(250);
  fs.writeFileSync(path.join(work, "app_labels_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length}개 중 ${results.length - failed}개 통과`);
  process.exit(failed ? 1 : 0);
}
