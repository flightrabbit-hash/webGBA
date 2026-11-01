// 멀티플레이(MP1) exe 본 창 시험 — 실제 앱(방장)과 크롬 웹 페이지(손님)를 연결 코드로 잇는다(exe 는 한 PC 에 하나만 뜸).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node tools/test/app-net.mjs <exe> <작업 폴더> <net-webapi 예제 폴더>
// 웹 페이지는 이 시험이 web/dist 를 내주는 로컬 서버에서 연다(미리 node web/build.mjs). 앱 폴더 <작업>\app_net 를 새로 만든다(레지스트리 안 건드림).
// 결과 <작업>\app_net_result.json, 캡처 <작업>\captures\exe_*.png
import fs from "fs";
import path from "path";
import http from "http";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { attach, guardOthers, launch, prepareApp, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const [exe, work, example] = process.argv.slice(2);
if (!exe || !work || !example) {
  console.error("사용법: node tools/test/app-net.mjs <exe> <작업 폴더> <net-webapi 예제 폴더>");
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = path.join(root, "web", "dist");
const PORT = 9351;
const appDir = path.join(work, "app_net");
const shots = path.join(work, "captures");
fs.mkdirSync(shots, { recursive: true });
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const wgba = (await packWgba({ wasm: fs.readFileSync(path.join(example, "game.wasm")), manifest: readJson(path.join(example, "manifest.json")) })).bytes;
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
const gameFile = path.join(appDir, "net-demo.wgba");
fs.writeFileSync(gameFile, wgba);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/^\/$/, "/index.html"));
  const file = path.join(dist, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404), res.end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  if (window === window.top) localStorage.setItem("webgba.installHint", "1");
});
const page = await context.newPage();

async function waitFor(fn, ms = 15000, step = 120) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(step);
  }
  return last;
}

const GAME = `(() => { const ex = ${T}.player.host?.ex; if (!ex?.Net_Hash) return null; return { hash: (ex.Net_Hash() >>> 0).toString(16), applied: ex.Net_Applied(), slot: ex.Net_Slot(), count: ex.Net_Count(), open: ex.Net_Open(), ended: ex.Net_Ended(), closed: ex.Net_Closed(), hostProtocol: ex.Net_HostProtocol() }; })()`;
const webGame = () => page.evaluate(() => {
  const ex = window.webgba.player.host?.ex;
  return ex?.Net_Hash ? { hash: (ex.Net_Hash() >>> 0).toString(16), applied: ex.Net_Applied(), slot: ex.Net_Slot(), count: ex.Net_Count(), open: ex.Net_Open(), ended: ex.Net_Ended(), closed: ex.Net_Closed() } : null;
});

let app = null;
try {
  guardOthers(exe, appDir);
  const appExe = prepareApp(exe, appDir);
  launch(appExe, PORT, [gameFile]);
  app = await attach(PORT);
  const running = await waitFor(() => app.evaluate(`${T}.player.running === true`), 20000);
  check("exe 가 net 예제(.wgba) 실행", running);
  const hello = await app.evaluate(GAME);
  check("exe: 게임이 Web_NetHost(1) 받음", hello?.hostProtocol === 1, JSON.stringify(hello));
  const rtc = await app.evaluate("typeof RTCPeerConnection");
  check("exe 본 창 WebRTC 있음(게임 틀은 그대로 막힘 — app-security)", rtc === "function", rtc);

  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.webgba.openFiles([new File([bytes], "net-demo.wgba")]);
  }, Buffer.from(wgba).toString("base64"));
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 20000 });

  await app.evaluate(`(() => { const p = ${T}.player; p.keyDown("KeyZ"); setTimeout(() => p.keyUp("KeyZ"), 150); return true; })()`);
  const layer = await waitFor(() => app.evaluate("!document.getElementById('layer').hidden && Boolean(document.querySelector('#dialog-body [data-action=net-make]'))"), 8000);
  check("exe: Web_NetWanted → 아비터 대화상자로 연결 창", layer);
  await app.screenshot(path.join(shots, "exe_창_고르기.png"));
  await app.evaluate("document.querySelector('[data-action=net-make]').click()");
  const offer = await waitFor(() => app.evaluate("document.querySelector('[data-action=net-offer]')?.value ?? ''"), 10000);
  check("exe: 방 만들기 → 연결 코드", offer.length > 80, `${offer.length}자`);
  await app.screenshot(path.join(shots, "exe_방장_코드.png"));
  const t0 = Date.now();
  await page.evaluate(() => {
    const p = window.webgba.player;
    p.keyDown("KeyZ");
    setTimeout(() => p.keyUp("KeyZ"), 150);
  });
  await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await page.click('[data-action="net-join"]');
  await page.fill('[data-action="net-offer-in"]', offer);
  await page.click('[data-action="net-offer-in-go"]');
  const answer = await waitFor(() => page.evaluate(() => document.querySelector('[data-action="net-answer-out"]')?.value ?? ""), 10000);
  const btns = await app.evaluate(`(() => { const p = document.querySelector('[data-action=net-answer-paste]'); const g = document.querySelector('[data-action=net-answer-go]'); const a = p.getBoundingClientRect(); const b = g.getBoundingClientRect(); return { paste: p.textContent, go: g.textContent, leftOf: a.right <= b.left, sameHeight: Math.abs(a.height - b.height) < 0.5, middle: Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 0.5, x: a.left + a.width / 2, y: a.top + a.height / 2 }; })()`);
  check("exe: PASTE 단추가 CONNECT 왼쪽·같은 높이·세로 가운데", btns.paste === "PASTE" && btns.go === "CONNECT" && btns.leftOf && btns.sameHeight && btns.middle, JSON.stringify(btns));
  const clipBefore = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).stdout ?? "";
  await app.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const wrote = await app.send("Runtime.evaluate", { expression: `navigator.clipboard.writeText(${JSON.stringify(answer)}).then(() => "ok", (e) => "fail " + e.name)`, awaitPromise: true, returnByValue: true, userGesture: true });
  for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: btns.x, y: btns.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(2000);
  if (clipBefore.trim()) spawnSync("powershell", ["-NoProfile", "-Command", "$input | Set-Clipboard"], { input: clipBefore.replace(/\r?\n$/, ""), encoding: "utf8" });
  const pasteResult = await app.evaluate(`(() => { const h = document.querySelector('#dialog-body .net-paste-hint'); return { value: document.querySelector('[data-action=net-answer]').value, hint: h && !h.hidden ? h.textContent : "", focus: document.activeElement?.dataset?.action ?? "" }; })()`);
  const pastedOk = pasteResult.value === answer;
  check("exe: PASTE 로 답 코드 넣기(안 되면 입력 칸 초점 + Ctrl+V 안내)", pastedOk || (/Ctrl\+V/.test(pasteResult.hint) && pasteResult.focus === "net-answer"), `쓰기 ${wrote.result?.value} · ${pastedOk ? "붙여 넣음" : `대체 ${pasteResult.hint}`}`);
  await app.screenshot(path.join(shots, "exe_붙여넣기.png"));
  if (!pastedOk) await app.evaluate(`(() => { const a = document.querySelector('[data-action=net-answer]'); a.value = ${JSON.stringify(answer)}; a.dispatchEvent(new Event('input')); return true; })()`);
  await app.evaluate("document.querySelector('[data-action=net-answer-go]').click()");
  const joined = await waitFor(async () => (await webGame())?.open === 1 && (await app.evaluate(GAME))?.count === 2, 20000);
  check("exe(방장) ↔ 크롬(손님) 연결", joined, `${Date.now() - t0}ms`);
  const pair = await app.evaluate(`(async () => { const s = ${T}.player.net.session; const { selectedPair } = await import("/js/core/net/lan.js"); const out = []; for (const l of s.links.values()) out.push(await selectedPair(l.pc)); return out; })()`);
  check("exe: 고른 후보 쌍 host/host", pair.length === 1 && pair[0]?.host, JSON.stringify(pair));
  const lan = await app.evaluate(`(async () => { const lan = await import("/js/core/net/lan.js"); const out = []; for (const code of [${JSON.stringify(offer)}, ${JSON.stringify(answer)}]) for (const line of lan.decodeCode(code).sdp.split("\\r\\n").filter((l) => l.startsWith("a=candidate:"))) out.push(lan.lanCandidateOk(lan.parseCandidate(line))); return out; })()`);
  check("exe·웹 연결 코드 후보 모두 망 안", lan.length > 0 && lan.every(Boolean), JSON.stringify(lan));
  await app.screenshot(path.join(shots, "exe_방장_연결됨.png"));
  await app.evaluate("document.querySelector('[data-action=net-done]').click()");
  await sleep(600);
  const statusRight = await app.evaluate("document.getElementById('status-right').textContent");
  const railBtn = await app.evaluate("!document.getElementById('btn-net').hidden && document.getElementById('btn-net').getAttribute('aria-pressed')");
  check("exe: 상태 줄 멀티플레이 표시·레일 단추 켜짐", /2\/4/.test(statusRight) && railBtn === "true", `${statusRight} · ${railBtn}`);
  const lock = await app.evaluate(`(async () => { await ${T}.loadStateFrom(1); return { status: document.getElementById('status').textContent, fast: document.getElementById('btn-fast').disabled, reset: document.getElementById('btn-reset').disabled, load: document.getElementById('btn-state-load').disabled }; })()`);
  check("exe: 세션 중 불러오기·빨리 감기·다시 시작 막음", /멀티플레이 중에는 상태 불러오기/.test(lock.status) && lock.fast && lock.reset && lock.load, JSON.stringify(lock));
  await app.evaluate(`(() => { const p = ${T}.player; p.keyDown("Enter"); setTimeout(() => p.keyUp("Enter"), 150); return true; })()`);
  const ended = await waitFor(async () => {
    const a = await app.evaluate(GAME);
    const b = await webGame();
    return a?.ended && b?.ended ? [a, b] : null;
  }, 30000, 300);
  check("exe·웹 한 라운드 순서 방송 해시 같음", ended && ended[0].hash === ended[1].hash, (ended ?? []).map((g) => `${g.hash}/${g.applied}`).join(" "));
  await app.evaluate(`${T}.player.net.leave()`);
  const hostLeft = await waitFor(async () => ((await webGame())?.closed === 7 ? true : null), 8000);
  check("exe 방장 나감 → 웹 손님 CLOSED(HOST_LEFT)", hostLeft);
} catch (error) {
  check("시험 진행", false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
} finally {
  if (app) {
    try {
      await app.evaluate(`${T}.shutdown()`);
    } catch {}
    app.close();
  }
  await browser.close().catch(() => {});
  server.close();
}
fs.writeFileSync(path.join(work, "app_net_result.json"), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\nexe 멀티플레이: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
