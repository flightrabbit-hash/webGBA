// 실행 중인 webGBA 의 웹뷰를 CDP(원격 디버깅)로 다룬다. 시험 도구 전용.
// 앱은 setting.ini 의 useDevelopKit: true + 환경 변수 WEBGBA_DEBUG_PORT 로 띄워야 포트가 열린다.
import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 시험 폴더의 웹 빌드 이름(확장자 없이, `<이름>.wasm`·`.wgba`)과 그 빌드가 쓰는 롬 파일 이름.
 *  다른 웹 빌드로 시험하면 환경 변수 WEBGBA_TEST_BUILD·WEBGBA_TEST_ROM 으로 바꾼다. 기본값은 지금 시험 폴더의 이름. */
export const TEST_BUILD = process.env.WEBGBA_TEST_BUILD || "firered";
export const TEST_ROM = process.env.WEBGBA_TEST_ROM || "Pokemon Fire Red (E).gba";
export const TEST_ROM_SAV = `${TEST_ROM.replace(/\.gba$/i, "")}.sav`;

/** 켜져 있는 webgba.exe 의 실행 파일 경로들. */
export function webgbaPaths() {
  const done = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Process webgba -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"], { encoding: "utf8" });
  return (done.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

const inside = (file, dir) => path.resolve(file).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep);

/** 시험 폴더(dir) 안에서 켜진 webgba.exe 수. 사용자 폴더의 webgba.exe 는 세지 않는다. */
export const runningIn = (dir) => webgbaPaths().filter((file) => inside(file, dir)).length;

/** 시험 폴더 밖에서 켜진 webgba.exe(사용자 앱 등). */
export const othersOutside = (dir) => webgbaPaths().filter((file) => !inside(file, dir));

/** 식별자가 기본값(com.flightrabbit.webgba)이 아닌 시험 빌드면 단일 인스턴스가 사용자 앱과 섞이지 않는다. */
export const isolatedBuild = (exe) => /com\.flightrabbit\.webgba\.[a-z]/.test(fs.readFileSync(exe).toString("latin1"));

/** 다른 webgba.exe 가 켜져 있으면, 시험 exe 가 따로 도는 빌드일 때만 계속한다. */
export function guardOthers(exe, dir) {
  const others = othersOutside(dir);
  if (others.length && !isolatedBuild(exe)) throw new Error(`다른 webgba.exe 가 켜져 있습니다(단일 인스턴스가 섞임): ${others.length}개`);
  return others.length;
}

/** 시험용 앱 폴더를 만든다: exe 사본 + bin/ini/setting.ini(useDevelopKit) + personalization.cfg(앱 씨앗과 같은 값).
 *  "종료할 때 세이브 파일 만들기"(기본 켬)는 꺼 둔다 — 옛 시험이 공용 시험 폴더의 롬 옆에 .sav 를 남기지 않게. 그 기능은 app-settings 가 따로 본다.
 *  .wgba 연결도 기본으로 끈다(wgbaLink false) — 켜 두면 시험 앱이 켤 때 사용자 HKCU 연결을 시험 exe 로 고쳐 쓴다. 연결을 보는 app-features 만 { link: true }. */
export function prepareApp(exe, dir, { link = false } = {}) {
  fs.mkdirSync(path.join(dir, "bin", "ini"), { recursive: true });
  fs.copyFileSync(exe, path.join(dir, "webgba.exe"));
  const resources = path.join(path.dirname(exe), "bin", "core");
  if (fs.existsSync(resources)) fs.cpSync(resources, path.join(dir, "bin", "core"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bin", "ini", "setting.ini"), "appWidth: 960\nappHeight: 720\nuseDevelopKit: true\n");
  const seed = { recent: [], favorites: [], volume: 80, muted: false, fastScale: 4, panel: "files", slot: 1, exitSave: false, wgbaLink: link };
  fs.writeFileSync(path.join(dir, "bin", "ini", "personalization.cfg"), JSON.stringify(seed, null, 2));
  return path.join(dir, "webgba.exe");
}

export function launch(exe, port, args = []) {
  const child = spawn(exe, args, { env: { ...process.env, WEBGBA_DEBUG_PORT: String(port) }, detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

/** 화면이 다 뜰 때까지 기다려 붙는다. 첫 실행은 웹뷰 데이터 폴더를 만들며 페이지를 한 번 더 불러와 맥락이 바뀔 수 있다. */
export async function attach(port, ready = "window.__WEBGBA_TEST__?.state?.info") {
  for (let attempt = 0; attempt < 10; attempt++) {
    const app = await connect(port);
    try {
      await app.evaluate(`new Promise((r) => { const t = () => (${ready} ? r(true) : setTimeout(t, 100)); t(); })`);
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

export async function connect(port, { timeoutMs = 30000, match = "ui.localhost" } = {}) {
  const until = Date.now() + timeoutMs;
  let target = null;
  while (Date.now() < until && !target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => (item.type === "page" || item.type === "iframe") && item.url.includes(match)) ?? null;
    } catch {
      target = null;
    }
    if (!target) await sleep(300);
  }
  if (!target) throw new Error(`CDP 대상을 찾지 못했습니다(포트 ${port})`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let next = 1;
  const waiting = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const screenshot = async (file, clip) => {
    const result = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(file, Buffer.from(result.data, "base64"));
  };
  const KEYCODES = { Enter: 13, Backspace: 8, Space: 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, KeyX: 88, KeyZ: 90, KeyA: 65, KeyS: 83 };
  const KEYS = { Enter: "Enter", Backspace: "Backspace", Space: " ", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight" };
  const key = async (code, holdMs = 120) => {
    const keyCode = KEYCODES[code] ?? 0;
    const keyText = KEYS[code] ?? code.replace(/^Key/, "").toLowerCase();
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: keyText, windowsVirtualKeyCode: keyCode });
    await sleep(holdMs);
    await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: keyText, windowsVirtualKeyCode: keyCode });
  };
  const close = () => ws.close();
  return { send, evaluate, screenshot, key, close, target };
}
