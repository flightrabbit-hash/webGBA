// 파일 열기 전 업데이트 시험(실제 앱, CDP, 로컬 피드 update-server.mjs + 시험 덮어쓰기 — 실제 R2·Vercel 안 씀). 시험 식별자 exe 만.
//   node tools/test/app-open-update.mjs <시험 exe> <작업 폴더>
// 시험 게임 = docs 의 hello-webapi(롬 없음)를 id local.atetris(알려진 id → 목록 경로)로 1.0.0 · 1.1.0 · 1.2.0 묶음(1.2.0 은 큰 패치가 되게 임의 바이트 구획).
// 확인: 앱 실행 캐시(목록 1번) → 처음 보는 폴더의 옛 버전 끌어 놓기 = 시작 전 창·게이지 → 새 버전 실행(세이브 그대로, 목록·버전 파일 요청 0번) →
// 취소 = 옛 버전 실행 · 같은 파일 다시 열기 = 창 없음 → 최신 = 창 없음·요청 0번 → 업데이트 끔 → 오프라인 → 캐시 없음 + 서버 닿지 않음 =
// 1번 시도 후 실행 → 롬 가져오기 목록 = 캐시 갱신(업데이트 서버 요청 0번) → 앱 실행 인자로 옛 파일 = 시작 전 창 1번·새 버전. 레지스트리 안 건드림.
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { attach, guardOthers, isolatedBuild, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { buildIndex, feed, publicOf } from "../lib/update-cmds.mjs";
import { makeDelta } from "../lib/wgbd-make.mjs";
import { createAdmin } from "../../api/_admin/server.js";
import { startFakeUpstash } from "./fake-upstash.mjs";
import { keyFile, startFakeR2 } from "./fake-r2-private.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-open-update.mjs <시험 exe> <작업 폴더>");
  process.exit(2);
}
if (!isolatedBuild(exe)) {
  console.error("기본 식별자 exe 는 쓰지 않습니다 — 식별자를 바꾼 시험 빌드를 주세요");
  process.exit(2);
}
const PORT = 9356;
const FEED_PORT = 9487;
const API_PORT = 9488;
const FEED = `http://127.0.0.1:${FEED_PORT}`;
const PIN = "3!7#1" + "9";
const MAIN = "local.atetris";
const T = "window.__WEBGBA_TEST__";
const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ── 시험 게임·발행 묶음(작업 폴더, 롬 없음) ── */
const root = path.resolve(work);
const appDir = path.join(root, "app");
const shots = path.join(root, "captures");
const pubDir = path.join(root, "feed");
const builds = path.join(root, "builds");
fs.rmSync(appDir, { recursive: true, force: true });
fs.rmSync(pubDir, { recursive: true, force: true });
fs.rmSync(builds, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(builds, { recursive: true });
guardOthers(exe, appDir);
const app = prepareApp(exe, appDir, { updateCheck: false });

const leb = (n) => {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const withPad = (wasm, bytes) => {
  const name = Buffer.from("x.pad");
  const body = Buffer.concat([Buffer.from(leb(name.length)), name, bytes]);
  return Buffer.concat([wasm, Buffer.from([0, ...leb(body.length)]), body]);
};
const example = path.join(here, "..", "..", "docs", "wgba", "examples", "hello-webapi");
const baseWasm = fs.readFileSync(path.join(example, "game.wasm"));
const images = Object.fromEntries(["front", "label", "spine"].map((part) => [part, fs.readFileSync(path.join(example, "cart", `${part}.png`))]));
const baseManifest = JSON.parse(fs.readFileSync(path.join(example, "manifest.json"), "utf8"));
const name = { ko: "열기 업데이트 시험", en: "Open Update Test", ja: "オープン更新テスト" };
const pack = async (id, version, wasm) => (await packWgba({ wasm, manifest: { ...baseManifest, id, version, name, shortName: "OpenUp" }, images })).bytes;
const v100 = await pack(MAIN, "1.0.0", baseWasm);
const v110 = await pack(MAIN, "1.1.0", withPad(baseWasm, Buffer.alloc(64, 1)));
const v120 = await pack(MAIN, "1.2.0", withPad(baseWasm, crypto.randomBytes(360 * 1024)));
const alpha = (await packWgba({ wasm: baseWasm, manifest: { ...baseManifest, id: "io.example.alpha", version: "1.3.0", name: { en: "Alpha", ko: "알파" } } })).bytes;
const file = (n) => path.join(builds, n);
fs.writeFileSync(file("v100.wgba"), v100);
fs.writeFileSync(file("v110.wgba"), v110);
fs.writeFileSync(file("v120.wgba"), v120);
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicOf(privateKey);
const keyPem = file("test.pem");
fs.writeFileSync(keyPem, privateKey.export({ format: "pem", type: "pkcs8" }));
const gameDir = path.join(pubDir, "ok", MAIN);
fs.mkdirSync(gameDir, { recursive: true });
const delta = async (a, b, n) => {
  fs.writeFileSync(file(n), (await makeDelta(fs.readFileSync(file(a)), fs.readFileSync(file(b)))).bytes);
  return file(n);
};
const quietly = async (work) => {
  const keep = console.log;
  console.log = () => {};
  try {
    return await work();
  } finally {
    console.log = keep;
  }
};
await quietly(async () => feed({ dir: gameDir, key: keyPem, wgba: file("v110.wgba"), patches: [await delta("v100.wgba", "v110.wgba", "p1.wgbd")] }));
await quietly(async () => feed({ dir: gameDir, key: keyPem, wgba: file("v120.wgba"), patches: [await delta("v110.wgba", "v120.wgba", "p2.wgbd")], olds: [file("v100.wgba")] }));
await quietly(async () => buildIndex(path.join(pubDir, "ok"), privateKey));
fs.rmSync(keyPem, { force: true });
const target = sha1(v120);
const old100 = sha1(v100);

const place = (folder, n, bytes) => {
  const dir = path.join(appDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, n), bytes);
  return path.join(dir, n);
};
const old1 = place("downloads", "openup-old.wgba", v100);
const sav1 = path.join(appDir, "downloads", "openup-old.sav");
const marker = crypto.randomBytes(131072);
fs.writeFileSync(sav1, marker);
const old2 = place("other", "openup-cancel.wgba", v100);
const new1 = place("latest", "openup-new.wgba", v120);
const off1 = place("off", "openup-off.wgba", v110);
const net1 = place("offline", "openup-offline.wgba", v100);
const miss1 = place("nocache", "openup-nocache.wgba", v100);
const fail1 = place("fail", "openup-fail.wgba", v100);
const arg1 = place("argument", "openup-arg.wgba", v100);
const arg2 = place("argument2", "openup-arg-cancel.wgba", v100);
const fav1 = place("favorite", "openup-fav.wgba", v100);

const feedServer = spawn(process.execPath, [path.join(here, "update-server.mjs"), pubDir, String(FEED_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => feedServer.stdout.once("data", resolve));
const feedLog = async () => (await (await fetch(`${FEED}/__log`)).json()).map((l) => l.path);
const feedClear = () => fetch(`${FEED}/__clear`);
const feedDelay = (ms) => fetch(`${FEED}/__delay?ms=${ms}`);

const r2 = await startFakeR2({ publicRead: true });
const kv = await startFakeUpstash();
const api = createAdmin({ env: { ...r2.env, UPSTASH_REDIS_REST_URL: kv.url, UPSTASH_REDIS_REST_TOKEN: kv.token }, endpoint: r2.endpoint, now: () => Date.now(), romsUrl: `${r2.endpoint}/roms.json` });
const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
r2.put("authentication.key", keyFile(PIN, kst(Date.now() - 600000)));
r2.put(`wgba/${MAIN}/1.2.0.wgba`, v120);
r2.put("wgba/io.example.alpha/1.3.0.wgba", alpha);
const apiServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const response = await api.handle(new Request(`http://127.0.0.1:${API_PORT}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve) => apiServer.listen(API_PORT, "127.0.0.1", resolve));

let cdp = null;
const ev = (expr) => cdp.evaluate(expr);
const until = async (expr, ms = 20000, step = 100) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(expr).catch(() => false)) return true;
    await sleep(step);
  }
  return false;
};
const overrideOf = (url) => JSON.stringify(JSON.stringify({ index: { url, key: pub } }));
const DIALOG = `(!document.getElementById("layer").hidden && document.getElementById("dialog-title").textContent)`;
const OPEN_TITLE = "업데이트 후 시작";
const rowOf = (file, state) => `(() => { const li = document.querySelector("#dialog .upick__item"); return !document.getElementById("layer").hidden && Boolean(li) && li.dataset.key.endsWith(${JSON.stringify(path.basename(file).toLowerCase())}) && li.dataset.state === ${JSON.stringify(state)}; })()`;
const rowState = () => ev(`(() => { const li = document.querySelector("#dialog .upick__item"); if (!li) return null; return { state: li.dataset.state, meta: li.querySelector(".upick__meta").textContent, fill: Number(getComputedStyle(li.querySelector(".upick__fill")).getPropertyValue("--progress")) || 0 }; })()`);
const gameNow = () => ev(`({ version: ${T}.state.game?.info?.version ?? "", running: Boolean(${T}.player.running), path: ${T}.state.game?.path ?? "" })`);
const startOpen = (p, how = "openPath") => ev(`(window.__opened = null, ${T}.${how}(${how === "openDropped" ? `[${JSON.stringify(p)}]` : JSON.stringify(p)}).then((v) => (window.__opened = v ?? true), (e) => (window.__opened = String(e))), 1)`);
const opened = (version) => until(`window.__opened !== null && ${T}.state.game?.info?.version === ${JSON.stringify(version)} && ${T}.player.running`, 60000);
const watchNoDialog = () => ev(`(window.__sawDialog = false, window.__dialogWatch = new MutationObserver(() => { if (!document.getElementById("layer").hidden) window.__sawDialog = true; }), window.__dialogWatch.observe(document.getElementById("layer"), { attributes: true }), 1)`);
const sawDialog = () => ev(`(window.__dialogWatch?.disconnect(), window.__sawDialog || !document.getElementById("layer").hidden)`);
const close = () => ev(`(${T}.closeGame({ quiet: true }), 1)`);
const clickAction = (label) => ev(`(() => { const b = [...document.querySelectorAll("#dialog-actions .btn")].find((n) => n.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const appLog = () => {
  const dir = path.join(appDir, "bin", "log");
  if (!fs.existsSync(dir)) return "";
  return fs.readdirSync(dir).filter((n) => n.endsWith(".log")).map((n) => fs.readFileSync(path.join(dir, n), "utf8")).join("\n");
};
const relaunch = async (arg, delay, favorites = []) => {
  await ev(`window.__TAURI__.core.invoke("window_close")`).catch(() => {});
  cdp.close();
  cdp = null;
  for (let i = 0; i < 150 && runningIn(appDir) > 0; i++) await sleep(200);
  await sleep(800);
  const cfg = path.join(appDir, "bin", "ini", "personalization.cfg");
  const prefs = JSON.parse(fs.readFileSync(cfg, "utf8"));
  fs.writeFileSync(cfg, JSON.stringify({ ...prefs, recent: [], favorites, updateIndex: {}, lastDir: "" }, null, 2));
  await feedClear();
  await feedDelay(delay);
  const mark = appLog().length;
  launch(app, PORT, [arg]);
  cdp = await attach(PORT);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  return mark;
};
const linesSince = (mark) => appLog().slice(mark).split("\n");

try {
  /* ── A. 앱 실행 = 버전 캐시(목록 1번) ── */
  launch(app, PORT);
  cdp = await attach(PORT);
  await ev(`localStorage.setItem("webgba.updateTest", ${overrideOf(`${FEED}/index.json`)}); localStorage.removeItem("webgba.updateLatest"); 1`);
  await ev(`window.__TAURI__.core.invoke("prefs_set", { patch: { updateCheck: true } }).then(() => 1)`);
  await feedClear();
  await ev("location.reload(); 1").catch(() => {});
  cdp.close();
  await sleep(1500);
  cdp = await attach(PORT);
  const cached = await until(`${T}.updater.versions.get(${JSON.stringify(MAIN)})?.version === "1.2.0"`, 20000);
  const entry = await ev(`JSON.parse(localStorage.getItem("webgba.updateLatest") || "{}")[${JSON.stringify(MAIN)}] ?? null`);
  await sleep(500);
  const bootLog = await feedLog();
  ok("앱 실행 → 버전 캐시(메모리·로컬 저장) = local.atetris 1.2.0 · 받은 시각", cached && entry?.version === "1.2.0" && Math.abs(Date.now() - entry.at) < 60000 && entry.from === "index", JSON.stringify(entry));
  ok("앱 실행 요청 = index.json 1번(게임별 버전 파일·패치 0번)", bootLog.filter((p) => p === "/index.json").length === 1 && bootLog.length === 1, bootLog.join(" "));

  /* ── B. 처음 보는 폴더의 옛 버전 끌어 놓기 → 시작 전 창·게이지 → 새 버전 실행 ── */
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: 70 * 1024, uploadThroughput: -1 });
  await feedClear();
  const t0 = Date.now();
  await startOpen(old1, "openDropped");
  const asked = await until(`${DIALOG} === ${JSON.stringify(OPEN_TITLE)} && ${rowOf(old1, "busy")}`, 20000, 50);
  const midGame = await gameNow();
  ok("옛 버전(1.0.0) 끌어 놓기 → 게임 시작 전 업데이트 창 · 바로 진행(받는 중)", asked && !midGame.running && !midGame.path, JSON.stringify(midGame));
  const gauge = await until(`Number(getComputedStyle(document.querySelector("#dialog .upick__fill")).getPropertyValue("--progress")) >= 0.25`, 20000, 50);
  const gaugeRow = await rowState();
  await cdp.screenshot(path.join(shots, "open_update_gauge.png"));
  ok("진행 게이지 표시(받는 중 %)", gauge && gaugeRow?.state === "busy" && /받는 중 \d+%/.test(gaugeRow.meta) && gaugeRow.fill > 0 && gaugeRow.fill < 1, JSON.stringify(gaugeRow));
  const updated = await opened("1.2.0");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(800);
  const afterB = await gameNow();
  const openLog = await feedLog();
  ok("업데이트 완료 → 새 파일(1.2.0)로 이어서 실행", updated && afterB.version === "1.2.0" && afterB.running && afterB.path.toLowerCase() === old1.toLowerCase(), `${JSON.stringify(afterB)} · ${Date.now() - t0}ms`);
  ok("디스크 파일 = 1.2.0 SHA-1 · 옆 .sav 그대로", sha1(fs.readFileSync(old1)) === target && sha1(fs.readFileSync(sav1)) === sha1(marker));
  ok("열 때 요청 = 패치만(index.json·latest.json 0번 — 캐시로 비교)", openLog.length >= 1 && openLog.every((p) => p.includes("/patches/")), openLog.join(" "));
  ok("창 닫힘", await until(`document.getElementById("layer").hidden`, 3000));
  await cdp.screenshot(path.join(shots, "open_update_done.png"));
  await close();

  /* ── C. 취소 → 옛 버전 실행 · 같은 파일 다시 열기 = 창 없음 ── */
  // 패치 주소는 immutable(1년)이라 B 에서 받은 것이 웹뷰 HTTP 캐시에서 바로 나옴 → 받기 지연이 걸리게 캐시 끔(실제 첫 받기와 같게)
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await feedDelay(6000);
  await feedClear();
  await startOpen(old2);
  const askedC = await until(`${DIALOG} === ${JSON.stringify(OPEN_TITLE)} && ${rowOf(old2, "busy")}`, 20000, 50);
  await sleep(300);
  const cancelLabel = await ev(`[...document.querySelectorAll("#dialog-actions .btn")].map((b) => b.textContent.trim() + (b.disabled ? "(꺼짐)" : "")).join(" ")`);
  const clicked = await clickAction("CANCEL");
  const cancelled = await opened("1.0.0");
  await feedDelay(0);
  const afterC = await gameNow();
  ok("받는 중 CANCEL → 현재 버전(1.0.0)으로 실행", askedC && clicked && cancelled && afterC.version === "1.0.0" && afterC.running, `${cancelLabel} · ${JSON.stringify(afterC)}`);
  ok("취소 → 디스크 파일 그대로(1.0.0)", sha1(fs.readFileSync(old2)) === old100);
  await cdp.screenshot(path.join(shots, "open_update_cancel.png"));
  const rowButton = await until(`Boolean([...document.querySelectorAll(".row")].find((r) => r.textContent.includes("openup-cancel") && r.querySelector(".row__upd")))`, 5000);
  ok("취소한 파일 = 같은 폴더 목록 줄에 업데이트 버튼(기존 경로로 나중에 업데이트)", rowButton);
  await close();
  await watchNoDialog();
  await startOpen(old2);
  const again = await opened("1.0.0");
  ok("같은 실행에서 같은 파일 다시 열기 → 창 다시 안 뜸(1.0.0 실행)", again && !(await sawDialog()));
  await close();

  /* ── C2. 받기 실패(패치 404) → 이유 표시 · LATER = 현재 버전 실행 ── */
  await fetch(`${FEED}/__use?mode=missing`);
  await startOpen(fail1);
  const failed = await until(rowOf(fail1, "failed"), 20000);
  const failRow = await rowState();
  const failButtons = await ev(`[...document.querySelectorAll("#dialog-actions .btn")].map((b) => b.textContent.trim() + (b.disabled ? "(꺼짐)" : "")).join(" ")`);
  const later = await clickAction("LATER");
  const failOpened = await opened("1.0.0");
  await fetch(`${FEED}/__use?mode=ok`);
  ok("받기 실패 → 줄에 이유 · LATER 로 현재 버전(1.0.0) 실행 · 디스크 그대로", failed && /실패 · 내려받지 못했습니다\(HTTP 404\)/.test(failRow?.meta ?? "") && failButtons === "LATER UPDATE" && later && failOpened && sha1(fs.readFileSync(fail1)) === old100, `${failRow?.meta} · ${failButtons}`);
  await close();

  /* ── D. 최신 열기 → 창 없음 · 요청 0번 ── */
  await feedClear();
  await watchNoDialog();
  await startOpen(new1);
  const latest = await opened("1.2.0");
  ok("최신(1.2.0) 열기 → 창 없음 · 요청 0번", latest && !(await sawDialog()) && (await feedLog()).length === 0, (await feedLog()).join(" "));
  await close();

  /* ── E. 업데이트 끔(updateCheck false) ── */
  await ev(`(${T}.state.prefs.updateCheck = false, 1)`);
  await feedClear();
  await watchNoDialog();
  await startOpen(off1);
  const offOk = await opened("1.1.0");
  ok("업데이트 확인 끔 → 옛 버전(1.1.0) 그대로 실행 · 창 없음 · 요청 0번", offOk && !(await sawDialog()) && (await feedLog()).length === 0);
  await ev(`(${T}.state.prefs.updateCheck = true, 1)`);
  await close();

  /* ── F. 오프라인(navigator.onLine false) ── */
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const onLine = await ev("navigator.onLine");
  await feedClear();
  await watchNoDialog();
  await startOpen(net1);
  const offline = await opened("1.0.0");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok("오프라인 → 창 없이 현재 버전(1.0.0) 실행 · 요청 0번", onLine === false && offline && !(await sawDialog()) && (await feedLog()).length === 0, `navigator.onLine ${onLine}`);
  await close();

  /* ── G. 캐시 없음 + 서버 닿지 않음 → 열 때 1번 시도 → 실행 ── */
  await ev(`localStorage.setItem("webgba.updateTest", ${overrideOf("http://127.0.0.1:9/index.json")}); localStorage.removeItem("webgba.updateLatest"); 1`);
  await ev("location.reload(); 1").catch(() => {});
  cdp.close();
  await sleep(1500);
  cdp = await attach(PORT);
  await sleep(1500);
  await watchNoDialog();
  const tg = Date.now();
  await startOpen(miss1);
  const missOk = await opened("1.0.0");
  const missMs = Date.now() - tg;
  await sleep(300);
  const missLog = appLog();
  ok("캐시 없음 · 서버 닿지 않음 → 열 때 1번 시도 후 현재 버전(1.0.0) 실행 · 창 없음", missOk && !(await sawDialog()) && /새 버전 정보 없음\(fetch\) local\.atetris 1\.0\.0/.test(missLog), `${missMs}ms`);
  await close();
  await watchNoDialog();
  await startOpen(miss1);
  const missAgain = await opened("1.0.0");
  await sleep(300);
  ok("바로 다시 열기 → 다시 시도 안 함(10분 안)", missAgain && !(await sawDialog()) && /새 버전 정보 없음\(retry\) local\.atetris 1\.0\.0/.test(appLog()));
  await close();
  await ev(`localStorage.setItem("webgba.updateTest", ${overrideOf(`${FEED}/index.json`)}); 1`);

  /* ── H. 롬 가져오기 목록 → 캐시 갱신(업데이트 서버 요청 0번) ── */
  const verify = await api.handle(new Request(`http://127.0.0.1:${API_PORT}/api/v1/admin/verify`, { method: "POST", headers: { origin: "http://ui.localhost", "content-type": "application/json" }, body: JSON.stringify({ pin: PIN }) }));
  const rec = await verify.json();
  ok("관리자 토큰(시험 서버 직접)", verify.status === 200 && typeof rec.token === "string", String(verify.status));
  await ev(`localStorage.setItem("webgba.adminTest", ${JSON.stringify(JSON.stringify({ base: `http://127.0.0.1:${API_PORT}/api/v1/admin/` }))}); ${T}.state.prefs.admin = ${JSON.stringify({ token: rec.token, at: rec.at, until: rec.until, updated: rec.updated ?? "" })}; 1`);
  const beforeImport = await ev(`${T}.updater.versions.get("io.example.alpha")`);
  await feedClear();
  await ev(`document.getElementById("btn-admin").click(); 1`);
  const listShown = await until(`Boolean(document.querySelector("#dialog .upick__item"))`, 20000);
  const alphaEntry = await ev(`${T}.updater.versions.get("io.example.alpha")`);
  const mainEntry = await ev(`${T}.updater.versions.get(${JSON.stringify(MAIN)})`);
  const stored = await ev(`JSON.parse(localStorage.getItem("webgba.updateLatest") || "{}")["io.example.alpha"] ?? null`);
  ok("롬 가져오기 → 목록 응답의 버전으로 캐시 갱신(새 게임 io.example.alpha 1.3.0 · 로컬 저장)", listShown && !beforeImport && alphaEntry?.version === "1.3.0" && alphaEntry.from === "roms" && stored?.version === "1.3.0" && Date.now() - alphaEntry.at < 60000, JSON.stringify({ alphaEntry, mainEntry }));
  ok("롬 가져오기 = 업데이트 서버(R2 흉내) 요청 0번", (await feedLog()).length === 0, (await feedLog()).join(" "));
  await clickAction("CLOSE");
  await until(`document.getElementById("layer").hidden`, 5000);

  /* ── I1. 앱 실행 인자(연결 실행)로 옛 파일 → 시작 전 창 → 새 버전 ── */
  const mark1 = await relaunch(arg1, 4000);
  const bootAsk = await until(`${DIALOG} === ${JSON.stringify(OPEN_TITLE)}`, 20000, 50);
  const bootMid = await gameNow();
  if (bootAsk) await until(rowOf(arg1, "busy"), 10000, 50);
  if (bootAsk) await cdp.screenshot(path.join(shots, "open_update_launch.png"));
  ok("앱 실행 인자로 옛 파일 → 게임 시작 전 업데이트 창(시작 때 받는 목록을 기다림)", bootAsk && !bootMid.running && !bootMid.path, JSON.stringify(bootMid));
  const bootDone = await until(`${T}.state.game?.info?.version === "1.2.0" && ${T}.player.running`, 60000);
  await feedDelay(0);
  await watchNoDialog();
  await sleep(4000);
  const bootLog1 = await feedLog();
  const lines1 = linesSince(mark1);
  ok("업데이트 후 새 버전(1.2.0) 실행 · 디스크 = 1.2.0", bootDone && sha1(fs.readFileSync(arg1)) === target);
  ok("시작 뒤 다른 창 없음 · 파일 열기 전 안내 1번 · 업데이트 확인 오류 없음", !(await sawDialog()) && lines1.filter((l) => l.includes("파일 열기 전 업데이트 있음") && l.includes("openup-arg.wgba")).length === 1 && !lines1.some((l) => /업데이트 확인 실패|WARN/.test(l)), lines1.filter((l) => /업데이트|WARN/.test(l)).slice(-5).join(" ‖ "));
  ok("이번 실행 요청 = index.json 1번 + 패치 1번(새 요청 없음)", bootLog1.filter((p) => p === "/index.json").length === 1 && bootLog1.filter((p) => p.includes("/patches/")).length === 1 && bootLog1.length === 2, bootLog1.join(" "));

  /* ── I2. 앱 실행 인자로 옛 파일 → CANCEL → 시작 때 목록 검사가 같은 파일 창을 다시 띄우지 않음 ── */
  const mark2 = await relaunch(arg2, 5000, [fav1]);
  const bootAsk2 = await until(`${DIALOG} === ${JSON.stringify(OPEN_TITLE)} && ${rowOf(arg2, "busy")}`, 30000, 50);
  await sleep(300);
  const clicked2 = await clickAction("CANCEL");
  const bootCancel = await until(`${T}.state.game?.info?.version === "1.0.0" && ${T}.player.running`, 60000);
  await feedDelay(0);
  const listWin = await until(`${DIALOG} === "업데이트 1개"`, 20000);
  const listKeys = listWin ? await ev(`[...document.querySelectorAll("#dialog .upick__item")].map((li) => li.dataset.key.split("\\\\").pop())`) : [];
  if (listWin) await clickAction("LATER");
  await sleep(1000);
  const lines2 = linesSince(mark2);
  ok("실행 인자 · CANCEL → 현재 버전(1.0.0) 실행 · 디스크 그대로", bootAsk2 && clicked2 && bootCancel && sha1(fs.readFileSync(arg2)) === old100);
  ok("시작 때 목록 창(기존 동작) = 즐겨찾기 옛 파일만 · 열 때 안내한 실행 인자 파일은 다시 띄우지 않음", listWin && listKeys.length === 1 && listKeys[0] === "openup-fav.wgba", listKeys.join(", "));
  ok("기록: 실행 인자 파일 = 열 때 안내 1번·목록 검사에서 제외 · 즐겨찾기 파일 = 목록 검사 · 업데이트 확인 오류 없음", lines2.some((l) => l.includes("파일 열기 전 업데이트 안 함")) && !lines2.some((l) => /\] 업데이트 있음/.test(l) && l.includes("openup-arg-cancel")) && lines2.some((l) => /\] 업데이트 있음/.test(l) && l.includes("openup-fav")) && !lines2.some((l) => /업데이트 확인 실패|WARN/.test(l)), lines2.filter((l) => /업데이트|WARN/.test(l)).slice(-6).join(" ‖ "));
  await ev(`window.__TAURI__.core.invoke("window_close")`).catch(() => {});
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error));
} finally {
  cdp?.close();
  feedServer.kill();
  apiServer.close();
  await r2.close?.();
  await kv.close?.();
}
await sleep(1500);
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
fs.writeFileSync(path.join(root, "app-open-update.json"), JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
