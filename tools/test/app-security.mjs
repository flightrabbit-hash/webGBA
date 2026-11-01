// exe 보안 시험(S0, 2026-10-31 결정 101-3). 실제 앱을 CDP 로 다룬다. 마우스를 움직이지 않는다.
//   node tools/test/app-security.mjs <exe> <작업 폴더> [--web <포트 웹 빌드 폴더> --rom <롬>]
// 작업 폴더: 웹버전\<빌드>.wasm + index.html·app.js·<빌드>.js(포트 웹버전 폴더, 원래 페이지로 엶) · 그 위 폴더에 롬 하나.
// --web·--rom(또는 환경 변수 WEBGBA_TEST_WEB·WEBGBA_TEST_ROM_PATH)을 주면 작업 폴더에 하드 링크로 놓는다(사본 없음, 세이브는 작업 폴더에).
// 짝 찾기 서버(MP2): 본 창은 https://webgba.vercel.app 요청이 CSP 에 막히지 않고, 게임 틀은 막힌다.
// 앱 폴더 <작업>\app_security(레지스트리 안 건드림). 결과 <작업>\app_security_result.json
// 확인:
//   - 틀(iframe)에 sandbox, 웹 빌드 응답에 CSP 머리
//   - 페이지 자신의 /save 쓰기(PUT)는 됨, 다른 출처(본 창)가 보낸 쓰기는 거부(파일 그대로, 앱 기록에 남음)
//   - 틀 안에서 바깥 주소로 요청하면 막힘, 틀이 스스로 바깥 주소로 가거나 위 창을 옮기려 해도 그대로
//   - 본 창도 앱 화면 밖으로 가지 않음
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, linkWebBuild, prepareApp, runningIn, sleep, TEST_BUILD } from "./cdp.mjs";

const [exe, work, ...rest] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-security.mjs <exe> <작업 폴더> [--web <포트 웹 빌드 폴더> --rom <롬>]");
  process.exit(2);
}
const argOf = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : "");
const webSrc = argOf("--web") || process.env.WEBGBA_TEST_WEB || "";
const romSrc = argOf("--rom") || process.env.WEBGBA_TEST_ROM_PATH || "";
if (webSrc) linkWebBuild(webSrc, romSrc, work);
const SERVER = "https://webgba.vercel.app/api/v1/mp/near";

const PORT = 9341;
const T = "window.__WEBGBA_TEST__";
const OUTSIDE = "https://example.com/";
const appDir = path.join(work, "app_security");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const logText = () => {
  const file = path.join(appDir, "bin", "log", `${today()}.log`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
};
const frameTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.url.includes("game."));

guardOthers(exe, work);
fs.rmSync(appDir, { recursive: true, force: true });
const appExe = prepareApp(exe, appDir);
launch(appExe, PORT);
let app = await attach(PORT);

const webDir = path.join(work, "웹버전");
const wasm = path.join(webDir, `${TEST_BUILD}.wasm`);
const save = path.join(webDir, `${TEST_BUILD}.sav`);

try {
  const sandbox = await app.evaluate("document.getElementById('webframe').getAttribute('sandbox')");
  check("틀 sandbox(위 창 이동·팝업 없음)", sandbox && /allow-scripts/.test(sandbox) && !/allow-top-navigation|allow-popups/.test(sandbox), sandbox);

  fs.writeFileSync(save, Buffer.alloc(131072, 0x5a));
  const before = fs.readFileSync(save);
  check("포트 웹버전을 원래 페이지로 열기", await app.evaluate(`${T}.openPath(${JSON.stringify(wasm)}, { preferPage: true })`), "");
  await sleep(4000);
  const origin = await app.evaluate(`${T}.state.game?.origin ?? ""`);
  const targets = await frameTargets();
  const inner = targets.length ? await connect(PORT, { match: "game." }) : null;
  check("틀 대상 찾기(CDP)", Boolean(inner), targets.map((t) => t.url).join(" | "));

  if (inner) {
    const csp = await inner.evaluate("fetch(location.href, { cache: 'no-store' }).then((r) => r.headers.get('content-security-policy') ?? '')");
    check("응답에 CSP(connect-src 'self' 등)", /connect-src 'self'/.test(csp) && /form-action 'self'/.test(csp), csp.slice(0, 120));

    const overlay = await inner.evaluate("document.getElementById('overlayText')?.textContent ?? ''");
    check("CSP 아래에서도 페이지가 /rom 으로 롬을 받아 준비됨", /준비되었습니다/.test(overlay), overlay);

    const own = await inner.evaluate(
      "fetch('save', { cache: 'no-store' }).then((r) => r.arrayBuffer()).then((b) => fetch('save', { method: 'PUT', body: b }).then((r) => [r.status, b.byteLength]))",
    );
    check("페이지 자신의 /save 쓰기(PUT) 됨", own[0] === 200 && own[1] === 131072, JSON.stringify(own));

    const outward = await inner.evaluate(
      `fetch(${JSON.stringify(OUTSIDE)}, { mode: "no-cors" }).then(() => "sent", (e) => "blocked " + e.name)`,
    );
    check("틀 안에서 바깥 주소 요청은 막힘(CSP)", /^blocked/.test(outward), outward);

    const other = await inner.evaluate(
      `fetch(${JSON.stringify(origin.replace(/game\.[0-9a-f]+\./, "game.000000000000."))} + "/save", { mode: "no-cors" }).then(() => "sent", (e) => "blocked " + e.name)`,
    );
    check("틀 안에서 다른 빌드 출처 요청도 막힘(CSP)", /^blocked/.test(other), other);

    const signal = await inner.evaluate(`fetch(${JSON.stringify(SERVER)}, { cache: "no-store" }).then((r) => "sent " + r.status, (e) => "blocked " + e.name)`);
    check("틀 안에서 짝 찾기 서버 요청은 막힘(CSP)", /^blocked/.test(signal), signal);

    await inner.evaluate(`(() => { try { top.location.href = ${JSON.stringify(OUTSIDE)}; } catch (e) {} return true; })()`).catch(() => {});
    await sleep(1500);
    check("틀이 위 창을 옮기지 못함", (await app.evaluate("location.origin")) === "http://ui.localhost", await app.evaluate("location.href"));

    // WebRTC(결정 102-3): 멀티플레이 설명서가 없는 게임 틀에서는 지워져 생성 실패. 틀 자신·window[0] 자식·src 없는 자식 모두.
    const rtc = await inner.evaluate(
      "(() => { const out = { top: typeof RTCPeerConnection, webkit: typeof window.webkitRTCPeerConnection, channel: typeof RTCDataChannel }; " +
        "try { new RTCPeerConnection(); out.make = 'made'; } catch (e) { out.make = 'blocked ' + e.name; } " +
        "const f = document.createElement('iframe'); document.body.append(f); out.childNoSrc = typeof window[0]?.RTCPeerConnection; out.childWin = typeof f.contentWindow?.RTCPeerConnection; return out; })()",
    );
    check(
      "WebRTC 막힘(설명서에 멀티플레이 없음): RTCPeerConnection 없음·생성 실패·자식 틀에도 없음",
      rtc.top === "undefined" && rtc.webkit === "undefined" && rtc.channel === "undefined" && /^blocked/.test(rtc.make) && rtc.childNoSrc === "undefined" && rtc.childWin === "undefined",
      JSON.stringify(rtc),
    );
    const dnsHead = await inner.evaluate("fetch(location.href, { cache: 'no-store' }).then((r) => r.headers.get('x-dns-prefetch-control') ?? '')");
    const frameSrc = /frame-src ([^;]+)/.exec(csp)?.[1]?.trim() ?? "";
    check("DNS 미리 찾기 끔 머리 + CSP frame-src 'none'(자식 틀로 WebRTC 다시 못 얻음)", dnsHead === "off" && frameSrc === "'none'", `dns=${dnsHead} · frame-src=${frameSrc}`);
    // 동적으로 넣은 dns-prefetch·preconnect 링크는 차단 스크립트가 바로 떼어 낸다(DOM 에 안 남음)
    const hintGone = await inner.evaluate(
      "(async () => { for (const rel of ['dns-prefetch', 'preconnect']) { const l = document.createElement('link'); l.rel = rel; l.href = 'http://d102-x-' + rel + '.example.com'; document.head.append(l); } await new Promise((r) => setTimeout(r, 200)); return document.querySelectorAll('link[rel=\"dns-prefetch\"], link[rel=\"preconnect\"]').length; })()",
    );
    check("넣은 dns-prefetch·preconnect 링크를 떼어 냄", hintGone === 0, String(hintGone));
    // blob 자식 틀(다른 출처)은 frame-src 'none' 이 막는다
    const blobChild = await inner.evaluate(
      "(async () => { const url = URL.createObjectURL(new Blob(['<p>x</p>'], { type: 'text/html' })); const f = document.createElement('iframe'); f.src = url; document.body.append(f); await new Promise((r) => setTimeout(r, 400)); try { return typeof f.contentWindow.RTCPeerConnection === 'undefined' ? 'blocked' : 'open ' + typeof f.contentWindow.RTCPeerConnection; } catch (e) { return 'blocked ' + e.name; } })()",
    );
    check("blob 자식 틀(다른 출처)로 WebRTC 못 얻음", /^blocked/.test(blobChild), blobChild);

    await inner.evaluate(`(() => { location.href = ${JSON.stringify(OUTSIDE)}; return true; })()`).catch(() => {});
    await sleep(2000);
    const after = await frameTargets();
    check(
      "틀이 스스로 바깥 주소로 가지 못함(앱이 막고 기록)",
      after.length && after.every((t) => t.url.startsWith(origin)) && /틀 이동 막음: https:\/\/example\.com/.test(logText()),
      after.map((t) => t.url).join(" | "),
    );
    inner.close();
  }

  // 본 창(앱 화면, ui.localhost)은 WebRTC 를 그대로 둔다 — 멀티플레이는 호스트(이 창)가 하고 게임 틀에는 안 준다(결정 102-3).
  // 설명서에 멀티플레이가 있는 게임의 통신도 이 창에서 webgba.net 으로 이어진다. 게임 틀에서만 WebRTC 를 지운 것과 대비.
  const mainRtc = await app.evaluate("typeof RTCPeerConnection");
  check("본 창은 WebRTC 유지(멀티플레이 호스트는 이 창)", mainRtc === "function", mainRtc);
  const mainSignal = await app.evaluate(`fetch(${JSON.stringify(SERVER)}, { cache: "no-store", credentials: "omit" }).then((r) => "sent " + r.status, (e) => "blocked " + e.name)`);
  check("본 창은 짝 찾기 서버 요청 가능(다른 출처 응답을 읽음 = 서버 CORS 가 앱 화면 출처 허용)", mainSignal === "sent 200", mainSignal);

  const fresh = fs.readFileSync(save);
  await app.evaluate(`fetch(${JSON.stringify(`${origin}/save`)}, { method: "POST", mode: "no-cors", body: new Uint8Array(131072) }).then(() => true, () => true)`);
  await app.evaluate(`fetch(${JSON.stringify(`${origin}/save`)}, { method: "PUT", mode: "no-cors", body: new Uint8Array(131072) }).then(() => true, () => true)`);
  await sleep(500);
  check(
    "다른 출처(본 창)가 보낸 /save 쓰기는 거부(파일 그대로, 기록)",
    Buffer.compare(fresh, fs.readFileSync(save)) === 0 && /세이브 쓰기 거부/.test(logText()),
    `처음과 같음 ${Buffer.compare(before, fs.readFileSync(save)) === 0}`,
  );

  await app.evaluate(`${T}.closeGame().then(() => true)`);
  await app.evaluate(`(() => { location.href = ${JSON.stringify(OUTSIDE)}; return true; })()`).catch(() => {});
  await sleep(2000);
  app.close();
  app = await connect(PORT);
  const where = await app.evaluate("location.href");
  check("본 창은 앱 화면 밖으로 가지 않음", where.startsWith("http://ui.localhost/"), where);
} finally {
  await app?.evaluate("document.getElementById('win-close').click(); true").catch(() => {});
  app?.close();
  for (let i = 0; i < 40 && runningIn(work); i++) await sleep(250);
  fs.writeFileSync(path.join(work, "app_security_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length}개 중 ${results.length - failed}개 통과`);
  process.exit(failed ? 1 : 0);
}
