// exe .wgba ② 자체 JS 게임(runtime script) 시험(S4). 실제 앱을 CDP 로 다룬다. 마우스를 움직이지 않는다.
//   node tools/test/app-script.mjs <exe> <작업 폴더> --module <예제 module 폴더> --emscripten <예제 emscripten 폴더> [--screen <160x144 ① .wgba>]
// 예제 폴더는 web/test/web-script.mjs 와 같다. 이 시험이 작업 폴더에 변형을 묶어 연다(세이브는 그 옆 <이름>.sav).
// 앱 폴더 <작업>\app_script(레지스트리 안 건드림). 결과 <작업>\app_script_result.json
// 확인: 틀 sandbox·CSP, 게임 코드가 밖(네트워크·WebRTC·Tauri 다리·위 창·팝업)으로 못 나감(서버가 받은 것 0), 그리기·왕복·키(앱 초점·틀 초점)·
//      세이브(파일 옆 .sav)·퀵슬롯·일시정지·다시 시작·CPU 6배, 틀이 스스로 다른 문서로 가면 멈춤, emscripten files·FS 세이브, ① 160×144.
import fs from "fs";
import path from "path";
import http from "http";
import dgram from "dgram";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const [exe, work, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) opt[rest[i].replace(/^--/, "")] = rest[++i];
if (!exe || !work || !opt.module || !opt.emscripten) {
  console.error("사용법: node tools/test/app-script.mjs <exe> <작업 폴더> --module <폴더> --emscripten <폴더> [--screen <.wgba>]");
  process.exit(2);
}

const PORT = 9343;
const STUN_PORT = 3478;
const T = "window.__WEBGBA_TEST__";
const appDir = path.join(work, "app_script");
const gameDir = path.join(work, "games");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const median = (list) => {
  const s = list.slice().sort((a, b) => a - b);
  return { median: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3) };
};

// 새는 요청 세기
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(`http ${req.method} ${req.url}`);
  res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
  res.end("leak");
});
server.on("upgrade", (req, socket) => {
  hits.push(`upgrade ${req.url}`);
  socket.destroy();
});
const udp = dgram.createSocket("udp4");
udp.on("message", (msg, from) => hits.push(`udp ${from.address}:${from.port} ${msg.length}B`));
await new Promise((resolve) => udp.bind(STUN_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const LEAK = `http://127.0.0.1:${server.address().port}/__leak`;

// 예제 묶기
fs.rmSync(gameDir, { recursive: true, force: true });
fs.mkdirSync(gameDir, { recursive: true });
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
async function pack(name, args) {
  const file = path.join(gameDir, name);
  fs.writeFileSync(file, (await packWgba(args)).bytes);
  return file;
}
const modManifest = readJson(path.join(opt.module, "manifest.json"));
const modArgs = (extra = {}) => ({ wasm: fs.readFileSync(path.join(opt.module, "code.wasm")), js: fs.readFileSync(path.join(opt.module, "game.js")), manifest: { ...modManifest, ...extra } });
const emOut = path.join(opt.emscripten, "out");
const files = {
  probe: await pack("s4-probe.wgba", modArgs({ id: "io.example.s4.probe", "x-probe": { url: LEAK, ws: LEAK.replace("http", "ws"), stun: `stun:127.0.0.1:${STUN_PORT}` } })),
  module: await pack("s4-module.wgba", modArgs()),
  nav: await pack("s4-nav.wgba", modArgs({ id: "io.example.s4.nav", "x-probe": { selfNav: true } })),
  emscripten: await pack("s4-emscripten.wgba", { wasm: fs.readFileSync(path.join(emOut, "game.wasm")), js: fs.readFileSync(path.join(emOut, "game.js")), manifest: readJson(path.join(opt.emscripten, "manifest.json")), data: [{ name: "game", bytes: fs.readFileSync(path.join(emOut, "game.data")) }] }),
};
if (opt.screen) {
  files.screen = path.join(gameDir, "s4-screen.wgba");
  fs.copyFileSync(opt.screen, files.screen);
}
const savOf = (file) => file.replace(/\.wgba$/, ".sav");

guardOthers(exe, work);
fs.rmSync(appDir, { recursive: true, force: true });
const appExe = prepareApp(exe, appDir);
launch(appExe, PORT);
let app = await attach(PORT);

const logs = async () => (await app.evaluate(`(${T}.player.host?.logs ?? []).map((l) => l.level + " " + l.text)`)) ?? [];
const waitLog = async (re, ms = 8000, from = 0) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = (await logs()).slice(from).find((line) => re.test(line));
    if (found) return found;
    await sleep(80);
  }
  return null;
};
const count = async () => (await logs()).length;
const open = async (file) => {
  const okOpen = await app.evaluate(`${T}.openPath(${JSON.stringify(file)})`);
  await sleep(400);
  return okOpen;
};
const status = () => app.evaluate("document.getElementById('status').textContent");
const focusApp = () => app.evaluate("document.getElementById('stage').focus(), true");
const focusFrame = () => app.evaluate("document.querySelector('#stage .script-frame').focus(), document.activeElement?.className");
const hold = async (code, down) => {
  const text = code === "Space" ? " " : code.replace(/^Key/, "").toLowerCase();
  const vk = { Space: 32, KeyZ: 90, ArrowRight: 39 }[code] ?? 0;
  await app.send("Input.dispatchKeyEvent", { type: down ? "rawKeyDown" : "keyUp", code, key: text, windowsVirtualKeyCode: vk });
};

try {
  // 1. 밖으로 나가 보기
  hits.length = 0;
  check("예제(밖으로 나가 보기) 열기", await open(files.probe), await status());
  const frame = await app.evaluate("(() => { const f = document.querySelector('#stage .script-frame'); return f ? { sandbox: f.getAttribute('sandbox'), csp: /connect-src blob: data:/.test(f.srcdoc), w: f.style.width, h: f.style.height, kind: window.__WEBGBA_TEST__.state.game?.kind } : null; })()");
  check("틀: sandbox=allow-scripts 만 · CSP meta · 크기 4:3(320×240 비율)", frame?.sandbox === "allow-scripts" && frame.csp && frame.kind === "script" && Math.abs(parseFloat(frame.w) / parseFloat(frame.h) - 4 / 3) < 0.02, JSON.stringify(frame));
  const probeLine = await waitLog(/^probe /, 20000);
  const probe = probeLine ? JSON.parse(probeLine.slice(6)) : {};
  await sleep(2500);
  const blocked = ["fetch", "xhr", "webSocket", "eventSource", "image", "worker", "webRTC", "childFrame", "indexedDB", "realLocalStorage", "cookie", "parentDom", "topDom", "parentTauri", "topNav", "popup", "tauriHere", "tauriIpc"];
  const leaky = blocked.filter((k) => !String(probe[k] ?? "").startsWith("막힘"));
  check("막힘: 네트워크·저장소·위 창·팝업·WebRTC·자식 틀·Tauri 다리(게임 코드가 시도)", probeLine && leaky.length === 0, leaky.length ? leaky.map((k) => `${k}=${probe[k]}`).join(", ") : blocked.map((k) => `${k}:${String(probe[k]).replace("막힘 ", "")}`).join(" "));
  check("서버가 받은 것 없음(STUN 포함)", hits.length === 0, hits.join(" | ") || "0건");
  check("본 창은 앱 화면 그대로", (await app.evaluate("location.origin")) === "http://ui.localhost");
  // 앱 명령이 틀에서 실제로 돌지 않음: 게임이 부르려 한 log_write 표시가 앱 기록에 없고, 본 창에서 부른 것은 있음(대조)
  await app.evaluate(`window.__TAURI_INTERNALS__.invoke("log_write", { level: "INFO", text: "S4-IPC-PROBE-FROM-MAIN" }).then(() => true)`);
  await sleep(500);
  const logDir = path.join(appDir, "bin", "log");
  const appLog = fs.existsSync(logDir) ? fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), "utf8")).join("\n") : "";
  check("앱 명령: 틀에서 부른 것은 안 돎(기록 없음) · 본 창은 됨(대조)", !/S4-IPC-PROBE-FROM-GAME/.test(appLog) && /S4-IPC-PROBE-FROM-MAIN/.test(appLog), `틀 ${/S4-IPC-PROBE-FROM-GAME/.test(appLog)} · 본 창 ${/S4-IPC-PROBE-FROM-MAIN/.test(appLog)}`);

  // 2. 그리기·왕복·키
  check("예제(모듈 게임) 열기", await open(files.module), await status());
  await sleep(2500);
  const fps = await app.evaluate(`${T}.player.host.fps`);
  const perf = await waitLog(/^perf /, 5000);
  check("그리기 60Hz(틀 안 requestAnimationFrame)", fps >= 50, `${fps}fps · ${perf?.slice(5) ?? ""} · 상태 줄 ${await app.evaluate("document.getElementById('status-right').textContent")}`);
  const rtt = [];
  for (let i = 0; i < 200; i++) rtt.push(await app.evaluate(`${T}.player.host.ping()`));
  const r1 = median(rtt);
  check("메시지 왕복(MessagePort, 200번)", r1.median < 5, `가운데 ${r1.median}ms · p95 ${r1.p95}ms`);
  await focusApp();
  let from = await count();
  await app.key("KeyZ");
  const z1 = await waitLog(/^key down Space " " 32/, 3000, from);
  check("키(앱 초점): Z → 게임 Space", z1, z1 ?? (await logs()).slice(from).join(" | "));
  const active = await focusFrame();
  from = await count();
  await app.key("KeyZ");
  const z2 = await waitLog(/^key down Space/, 3000, from);
  check("키(틀 초점): Z → 틀이 앱으로 넘김 → 게임 Space", z2, `${active} · ${z2 ?? (await logs()).slice(from).join(" | ")}`);
  from = await count();
  await hold("Space", true);
  await sleep(300);
  const fastOn = await waitLog(/^event speed 4/, 2000, from);
  await hold("Space", false);
  const fastOff = await waitLog(/^event speed 1/, 2000, from);
  const leaked = (await logs()).slice(from).filter((l) => /^key down Space/.test(l));
  check("키(틀 초점): 실제 Space = 앱 몫(누르는 동안 빨리 감기) — 게임엔 안 감", fastOn && fastOff && !leaked.length, `${fastOn} / ${fastOff} / 새어 감 ${leaked.length}`);
  const blurPaused = await app.evaluate(`${T}.player.paused`);
  check("틀로 초점이 가도 일시정지·키 놓기 안 함", blurPaused === false);

  // 3. 세이브(연 파일 옆 .sav)
  await sleep(1800);
  const sav = savOf(files.module);
  const savBytes = fs.existsSync(sav) ? fs.readFileSync(sav) : Buffer.alloc(0);
  check("세이브: webgba.save.write → 연 파일 옆 s4-module.sav", savBytes.length === 4 && savBytes.readUInt32LE(0) === 2, `${savBytes.length}B ${savBytes.length === 4 ? savBytes.readUInt32LE(0) : ""}`);

  // 4. 퀵슬롯
  from = await count();
  const saved = await app.evaluate(`${T}.player.saveState(1)`);
  await focusApp();
  await app.key("KeyZ");
  await sleep(200);
  const loaded = await app.evaluate(`${T}.player.loadState(1)`);
  const stateLine = await waitLog(/^state load \d+ \d+ 2$/, 3000, from);
  check("퀵슬롯: 저장 → 점프 → 불러오기 = 그때 값(점프 2)", saved === true && loaded === true && stateLine, `${saved} ${loaded} ${stateLine}`);

  // 5. 일시정지·다시
  from = await count();
  await app.evaluate(`${T}.player.setPaused(true), true`);
  await sleep(2200);
  const pausedFps = await app.evaluate(`${T}.player.host.fps`);
  await app.evaluate(`${T}.player.setPaused(false), true`);
  await sleep(2200);
  const resumed = await app.evaluate(`({ fps: ${T}.player.host.fps, queued: ${T}.player.host.rafQueued })`);
  check("일시정지: 틀 화면 멈춤 → 다시 60Hz(붙잡았던 화면 갱신 하나만)", pausedFps < 1 && resumed.fps >= 50 && resumed.queued <= 1, `${pausedFps} → ${resumed.fps}fps · 대기 ${resumed.queued}`);

  // 6. 다시 시작
  from = await count();
  await app.evaluate(`${T}.player.reset()`);
  const restart = await waitLog(/^start jumps 3 /, 8000, from);
  check("다시 시작: 세이브에서(점프 3) · 틀 크기 다시 맞춤", restart && (await app.evaluate("parseFloat(document.querySelector('#stage .script-frame').style.width) > 0")), restart ?? "");

  // 7. 소리
  await focusApp();
  from = await count();
  await app.key("KeyZ");
  const audio = await waitLog(/^audio /, 3000, from);
  check("소리: 틀 안 AudioContext", audio === "audio running", audio ?? "");

  // 8. CPU 6배 느리게(본 창 + 틀 대상)
  const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "iframe" && t.url.startsWith("about:srcdoc"));
  const inner = targets.length ? await connect(PORT, { match: "about:srcdoc" }).catch(() => null) : null;
  for (const s of [app, inner].filter(Boolean)) await s.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await sleep(1500);
  from = await count();
  await sleep(2500);
  const slowFps = await app.evaluate(`${T}.player.host.fps`);
  const slowPerf = await waitLog(/^perf /, 4000, from);
  const slowRtt = [];
  for (let i = 0; i < 100; i++) slowRtt.push(await app.evaluate(`${T}.player.host.ping()`));
  for (const s of [app, inner].filter(Boolean)) await s.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  inner?.close();
  const r6 = median(slowRtt);
  check("CPU 6배 느리게: 틀 그리기·왕복", slowFps >= 45, `${slowFps}fps · ${slowPerf?.slice(5) ?? ""} · 왕복 가운데 ${r6.median}ms p95 ${r6.p95}ms · 틀 대상 ${inner ? "따로" : "없음(같은 프로세스)"}`);

  // 9. 틀이 스스로 다른 문서로
  await open(files.nav);
  await sleep(1500);
  const nav = await app.evaluate(`({ halted: ${T}.player.host?.halted ?? "", frame: Boolean(document.querySelector('#stage .script-frame')), status: document.getElementById('status').textContent })`);
  check("틀이 스스로 다른 문서로 → 틀 지우고 멈춤", nav.halted && !nav.frame, JSON.stringify(nav));

  // 10. emscripten
  fs.rmSync(savOf(files.emscripten), { force: true });
  check("예제(emscripten SDL) 열기", await open(files.emscripten), await status());
  const asset = await waitLog(/^info asset hello from data chunk/, 8000);
  const first = await waitLog(/^info (no save|loaded \d+)/, 3000);
  await focusApp();
  from = await count();
  await app.key("KeyZ");
  const sdlKey = await waitLog(/^info key 122 down/, 3000, from);
  const sdlSaved = await waitLog(/^info saved 1/, 3000, from);
  await sleep(2500);
  const emSav = fs.existsSync(savOf(files.emscripten)) ? fs.readFileSync(savOf(files.emscripten)) : Buffer.alloc(0);
  check("emscripten: files 조각 · Z → SDL 키 122 · FS 세이브 → 파일 옆 .sav", asset && first === "info no save" && sdlKey && sdlSaved && emSav.length === 4 && emSav.readUInt32LE(0) === 1, `${first} · ${sdlKey} · ${sdlSaved} · ${emSav.length}B`);
  const emFrame = await app.evaluate("(() => { const f = document.querySelector('#stage .script-frame'); return { w: parseFloat(f.style.width), h: parseFloat(f.style.height) }; })()");
  check("emscripten: 설명서 scale integer → 정수 배율(256×192 의 배수)", emFrame.w % 256 === 0 && emFrame.h % 192 === 0 && emFrame.w / 256 === emFrame.h / 192, JSON.stringify(emFrame));
  await app.evaluate(`${T}.closeGame().then(() => true)`);
  await open(files.emscripten);
  const reloaded = await waitLog(/^info loaded 1/, 8000);
  check("emscripten: 다시 열면 .sav 를 /save/game.sav 에", reloaded, reloaded ?? "");

  // 11. ① 160×144
  if (files.screen) {
    check("① 160×144 열기", await open(files.screen), await status());
    await sleep(500);
    const scr = await app.evaluate("(() => { const c = document.getElementById('screen'); return { w: c.width, h: c.height, cw: parseFloat(c.style.width), ch: parseFloat(c.style.height) }; })()");
    check("① 화면 160×144: 캔버스 크기·화면 비율(정수 배율·영역 맞춤 규칙 그대로)", scr.w === 160 && scr.h === 144 && Math.abs(scr.cw / scr.ch - 160 / 144) < 0.02, JSON.stringify(scr));
  }
  await app.evaluate(`${T}.closeGame().then(() => true)`);
  check("닫으면 틀이 없음", !(await app.evaluate("Boolean(document.querySelector('#stage .script-frame'))")));
} catch (error) {
  check("시험 도중 오류", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" "));
} finally {
  await app?.evaluate("document.getElementById('win-close').click(); true").catch(() => {});
  app?.close();
  for (let i = 0; i < 40 && runningIn(work); i++) await sleep(250);
  server.close();
  udp.close();
  fs.writeFileSync(path.join(work, "app_script_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length}개 중 ${results.length - failed}개 통과`);
  process.exit(failed ? 1 : 0);
}
