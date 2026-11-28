// 웹 .gba 가져오기 때 부모 롬 패치 고르기(설계 39절) 시험 — 헤드리스 Chrome 1개, 서버 둘(웹 빌드 · 흉내 R2)은 같은 node 안. 실제 R2 안 씀.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-patch.mjs --dist <웹 빌드> --feeds <묶음/ok(patch-offer.mjs 가 만든 것)> --key <시험 키.pem>
//     --firered <파이어레드.gba> --hamtaro <햄토리 원본.gba> --bento <도시락 원본.gba> --nomatch <목록에 없는 .gba> --wgba <아무 .wgba> --shots <캡처 폴더>
// 롬은 브라우저 파일 선택으로만 넘긴다(서버로 보내지 않음). 새 브라우저 프로필(시험 전용)에서만 돈다.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { loadSecret, publicOf } from "../../tools/lib/update-cmds.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const LIMIT = setTimeout(() => {
  console.error("상한 15분 초과 — 종료");
  process.exit(3);
}, 15 * 60 * 1000);
fs.mkdirSync(opt.shots, { recursive: true });
const pub = publicOf(loadSecret(opt.key));
const sha1 = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
const signed = JSON.parse(JSON.parse(fs.readFileSync(path.join(opt.feeds, "index.json"), "utf8")).signed);
const latest = (id) => JSON.parse(JSON.parse(fs.readFileSync(path.join(opt.feeds, id, "latest.json"), "utf8")).signed);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const feedLog = [];
function serve(dir, { cors = false, log = null } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    log?.push(rel);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(root, rel);
    const head = cors ? { "access-control-allow-origin": "*" } : {};
    if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, head);
      return res.end();
    }
    res.writeHead(200, { ...head, "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

let pass = 0;
let fail = 0;
const check = (ok, line) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "통과" : "실패"}  ${line}`);
};

const web = await serve(opt.dist);
const feeds = await serve(opt.feeds, { cors: true, log: feedLog });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ index = `${feeds.base}/index.json`, viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(
    ([test]) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window !== window.top) return;
      localStorage.setItem("webgba.installHint", "1");
      localStorage.setItem("webgba.updateTest", JSON.stringify(test));
    },
    [{ index: { url: index, key: pub } }],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(web.base);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 60000 });
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "patchTestFile";
    input.hidden = true;
    input.addEventListener("change", () => window.webgba.openFiles(input.files));
    document.body.append(input);
  });
  return { context, page, errors };
}

const pick = (page, file) => page.setInputFiles("#patchTestFile", file);
const dialogUp = (page) => page.waitForFunction(() => !document.getElementById("dialog").hidden && document.querySelector('#dialog [data-action="patch-go"]'), null, { timeout: 30000 }).then(() => true, () => false);
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("#dialog .upick__item")].map((n) => ({ name: n.querySelector(".upick__name").textContent, meta: n.querySelector(".upick__meta").textContent, state: n.dataset.state, on: n.querySelector(".upick__check").getAttribute("aria-checked") })));
const playing = (page, timeout = 180000) => page.waitForFunction(() => document.body.dataset.view === "game" && window.webgba.player.running && !window.webgba.state.opening, null, { timeout }).then(() => true, () => false);
const settled = (page) => page.waitForFunction(() => !window.webgba.state.opening && document.getElementById("dialog").hidden, null, { timeout: 60000 }).then(() => true, () => false);
const library = (page) =>
  page.evaluate(async () => {
    const out = [];
    for (const rom of await window.webgba.store.list("rom")) {
      const bytes = await window.webgba.store.bytes(rom.key);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
      out.push({ id: rom.gameId ?? "", version: rom.version ?? "", sha1: hash, name: rom.name, type: rom.type });
    }
    return out;
  });
const skipList = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("webgba.patchSkip") || "[]"));
const noDialog = async (page) => {
  await page.waitForTimeout(400);
  return page.evaluate(() => document.getElementById("dialog").hidden || !document.querySelector('#dialog [data-action="patch-go"]'));
};

const RAPID = latest("com.flightrabbit.rapid");
const HAM = latest("local.hamtaro3");
const TEST = fs.existsSync(path.join(opt.feeds, "local.patchtest")) ? latest("local.patchtest") : null;

// A. 파이어레드 → 2줄 체크 → 전체 설치 → 모두 성공 = 맨 위(래피드) 바로 실행, 원본 .gba 는 라이브러리에 없음
{
  const { context, page, errors } = await open();
  await pick(page, opt.firered);
  const up = await dialogUp(page);
  const list = up ? await rows(page) : [];
  check(up && list.length === (TEST ? 2 : 1) && list.every((r) => r.on === "true"), `파이어레드 = 창 · ${list.map((r) => `${r.name}(${r.meta})`).join(", ")}`);
  const title = await page.textContent("#dialogTitle");
  const go = await page.textContent('#dialog [data-action="patch-go"]');
  check(/패치 2개|패치 1개/.test(title) && go.includes("전체 설치"), `제목 「${title}」 · 버튼 「${go.trim()}」`);
  await page.screenshot({ path: path.join(opt.shots, "web_patch_pick.png") });
  await page.click('#dialog [data-action="patch-go"]');
  await page.waitForFunction(() => [...document.querySelectorAll("#dialog .upick__item")].some((n) => n.dataset.state === "busy"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(opt.shots, "web_patch_busy.png") });
  const ran = await playing(page);
  const lib = await library(page);
  const rapid = lib.find((r) => r.id === "com.flightrabbit.rapid");
  const test = lib.find((r) => r.id === "local.patchtest");
  check(ran && rapid?.sha1 === RAPID.wgba.sha1 && rapid.version === RAPID.version, `설치 후 바로 실행 · 래피드 ${rapid?.version} SHA-1 ${rapid?.sha1?.slice(0, 8)} = 공개 ${RAPID.version}`);
  if (TEST) check(test?.sha1 === TEST.wgba.sha1, `둘째 패치도 라이브러리에 ${test?.sha1?.slice(0, 8)}`);
  check(!lib.some((r) => r.sha1 === sha1(opt.firered)), "원본 .gba 는 라이브러리에 남기지 않음(결정 515-5)");
  const title2 = await page.evaluate(() => window.webgba.state.game?.title ?? window.webgba.state.game?.name ?? "");
  check(/Rapid|래피드/i.test(title2), `실행한 게임 = ${title2}`);

  // B. 햄토리 원본 → 1줄(모두 선택 숨김) → 1.0.0 생성 후 1.0.1 까지
  await pick(page, opt.hamtaro);
  const upB = await dialogUp(page);
  const single = await page.evaluate(() => Boolean(document.querySelector("#dialog .upick--single")));
  const rowB = upB ? await rows(page) : [];
  check(upB && single && rowB.length === 1 && rowB[0].meta.startsWith("v1.0.1"), `햄토리 = 1줄 창 · ${rowB[0]?.meta ?? ""}`);
  await page.click('#dialog [data-action="patch-go"]');
  let chain = "";
  try {
    await page.waitForFunction(() => /업데이트 중/.test(document.querySelector("#dialog .upick__meta")?.textContent ?? ""), null, { timeout: 60000, polling: 20 });
    chain = await page.textContent("#dialog .upick__meta");
    await page.screenshot({ path: path.join(opt.shots, "web_patch_chain.png") });
  } catch {}
  check(/v1\.0\.0 생성 완료 → v1\.0\.1 업데이트 중/.test(chain), `연쇄 표시 「${chain}」`);
  const ranB = await playing(page);
  const ham = (await library(page)).find((r) => r.id === "local.hamtaro3");
  check(ranB && ham?.sha1 === HAM.wgba.sha1 && ham.version === HAM.version, `햄토리 ${ham?.version} SHA-1 ${ham?.sha1?.slice(0, 8)} = 공개 ${HAM.version}(866e940a)`);

  // C. 파이어레드 다시 = 모두 이미 있음 → 창 없이 원본 실행
  await pick(page, opt.firered);
  const noC = await noDialog(page);
  const ranC = await playing(page);
  check(noC && ranC && (await library(page)).some((r) => r.sha1 === sha1(opt.firered)), "모두 이미 있음 = 창 없이 원본 가져오기 · 실행");

  // D. 도시락 원본 + 「이 롬은 다시 묻지 않기」 + 원본 실행 → 다시 열면 창 없음
  await pick(page, opt.bento);
  const upD = await dialogUp(page);
  await page.click("#dialog .upick__again");
  await page.screenshot({ path: path.join(opt.shots, "web_patch_again.png") });
  await page.click('#dialog [data-action="patch-skip"]');
  const ranD = await playing(page);
  const skip = await skipList(page);
  check(upD && ranD && skip.includes(sha1(opt.bento)), `다시 묻지 않기 + 원본 실행 = 원본 실행 · 저장 ${skip.length}개`);
  await pick(page, opt.bento);
  check((await noDialog(page)) && (await playing(page)), "다시 묻지 않기 롬 = 창 없음");

  // E. 설정 「패치 안내 안 하는 롬」 끄기 = 목록 비움
  await page.evaluate(() => {
    window.webgba.closeGame();
    window.webgba.openSheet("settings");
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => document.querySelector('[role="switch"][aria-label="패치 안내 안 하는 롬"]')?.getAttribute("aria-checked") ?? "");
  await page.click('[role="switch"][aria-label="패치 안내 안 하는 롬"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ list: JSON.parse(localStorage.getItem("webgba.patchSkip") || "[]").length, off: document.querySelector('[role="switch"][aria-label="패치 안내 안 하는 롬"]')?.disabled }));
  check(before === "true" && after.list === 0 && after.off, `설정 「패치 안내 안 하는 롬」 끄기 = 목록 비움(${after.list}개 · 스위치 꺼짐)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // F. 오프라인 = 창 없이 원본 실행
  await context.setOffline(true);
  await pick(page, opt.bento);
  check((await noDialog(page)) && (await settled(page)), "오프라인 = 창 없음");
  await context.setOffline(false);

  // G. 목록에 없는 롬 · .wgba = 창 없이 기존 흐름
  await pick(page, opt.nomatch);
  check((await noDialog(page)) && (await playing(page)), "목록에 없는 .gba = 창 없이 실행");
  await pick(page, opt.wgba);
  check((await noDialog(page)) && (await playing(page)), ".wgba 열기 = 창 없이 실행(기존 흐름)");
  check(errors.length === 0, `페이지 오류 ${errors.length}개${errors.length ? ` (${errors[0]})` : ""}`);
  await context.close();
}

// H. 목록 없음(404) = 창 없음
{
  const { context, page } = await open({ index: `${feeds.base}/missing/index.json` });
  await pick(page, opt.hamtaro);
  check((await noDialog(page)) && (await playing(page)), "목록 없음(404) = 창 없이 원본 실행");
  await context.close();
}

// I. 둘째 패치 받기 실패 = 창 유지(닫기 · 실행, 줄 다시 시도) → 닫기 = 아무것도 실행 안 함, PC 폭
if (TEST) {
  const { context, page } = await open({ viewport: { width: 1280, height: 800 } });
  await page.route(/local\.patchtest\/full\//, (route) => route.fulfill({ status: 404, body: "" }));
  await pick(page, opt.firered);
  await dialogUp(page);
  await page.screenshot({ path: path.join(opt.shots, "web_patch_pick_pc.png") });
  await page.click('#dialog [data-action="patch-go"]');
  await page.waitForFunction(() => [...document.querySelectorAll("#dialog .upick__item")].every((n) => n.dataset.state === "done" || n.dataset.state === "failed"), null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(900);
  const list = await rows(page);
  const left = await page.textContent('#dialog [data-action="patch-skip"]');
  const go = await page.textContent('#dialog [data-action="patch-go"]');
  const stay = await page.evaluate(() => !document.getElementById("dialog").hidden);
  const rowBtn = await page.evaluate(() => [...document.querySelectorAll("#dialog .upick__btn")].filter((b) => !b.hidden).map((b) => b.textContent.trim()));
  check(stay && list[0]?.state === "done" && list[1]?.state === "failed" && left.includes("닫기") && go.includes("실행") && rowBtn.join() === "실행,다시 시도", `실패 = 창 유지 · ${list.map((r) => r.meta).join(" / ")} · 버튼 ${left.trim()}·${go.trim()} · 줄 ${rowBtn.join("·")}`);
  await page.screenshot({ path: path.join(opt.shots, "web_patch_fail_pc.png") });
  await page.click('#dialog [data-action="patch-skip"]');
  await page.waitForTimeout(600);
  const view = await page.evaluate(() => document.body.dataset.view);
  check(view !== "game", `닫기 = 실행 안 함(화면 ${view})`);
  await context.close();
}

await browser.close();
web.server.close();
feeds.server.close();
clearTimeout(LIMIT);
console.log(`\n${fail ? "실패 있음" : "모두 통과"} — 통과 ${pass} · 실패 ${fail} · 흉내 R2 요청 index.json ${feedLog.filter((p) => p.endsWith("/index.json")).length}번 · .wgbp ${feedLog.filter((p) => p.endsWith(".wgbp")).length}번`);
process.exit(fail ? 1 : 0);
