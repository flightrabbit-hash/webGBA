// exe 온라인 업데이트 시험(실제 앱, CDP, 흉내 R2 — 실제 R2 안 씀). 시험 식별자로 빌드한 exe 만(기본 식별자 exe 금지).
//   node tools/test/app-update.mjs <시험 exe> <작업 폴더> --feeds <발행 폴더 묶음> --pub <공개 키> --v130 <1.3.0.wgba> --v131 <1.3.1.wgba>
// 작업 폴더에 앱 폴더(app_update)와 1.3.0 사본(디스크의 파일을 바꾸므로 사본 1개)·옆 .sav 표시를 만든다. 레지스트리는 건드리지 않는다.
// 확인: 앱 실행 → 업데이트 창 → LATER → 즐겨찾기 줄 "업데이트" 버튼(잉크 가운데) → 그 버튼 → 디스크 파일 1.3.1 SHA-1 · 옆 .sav 그대로 ·
// 버전 파일 1번만 · 다른 버전 퀵슬롯 막힘 안내.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { attach, guardOthers, isolatedBuild, launch, prepareApp, sleep } from "./cdp.mjs";
import { decodePng } from "../../web/test/png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [exe, work, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) opt[rest[i].replace(/^--/, "")] = rest[++i];
if (!exe || !work || !opt.feeds || !opt.pub || !opt.v130 || !opt.v131) {
  console.error("사용법: node tools/test/app-update.mjs <시험 exe> <작업 폴더> --feeds <묶음> --pub <공개 키> --v130 <1.3.0.wgba> --v131 <1.3.1.wgba>");
  process.exit(2);
}
if (!isolatedBuild(exe)) {
  console.error("기본 식별자 exe 는 쓰지 않습니다 — 식별자를 바꾼 시험 빌드를 주세요");
  process.exit(2);
}
const PORT = 9349;
const R2_PORT = 9481;
const R2 = `http://127.0.0.1:${R2_PORT}`;
const T = "window.__WEBGBA_TEST__";
const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const appDir = path.join(work, "app_update");
const games = path.join(appDir, "games");
const shots = path.join(work, "captures");
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(games, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
guardOthers(exe, appDir);
const app = prepareApp(exe, appDir);
const game = path.join(games, "firered.wgba");
fs.copyFileSync(opt.v130, game);
const sav = path.join(games, "firered.sav");
const marker = crypto.randomBytes(131072);
fs.writeFileSync(sav, marker);
const cfg = path.join(appDir, "bin", "ini", "personalization.cfg");
fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, "utf8")), favorites: [game], panel: "" }, null, 2));
const target131 = sha1(fs.readFileSync(opt.v131));

const r2 = spawn(process.execPath, [path.join(here, "update-server.mjs"), opt.feeds, String(R2_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => r2.stdout.once("data", resolve));
await fetch(`${R2}/__use?mode=ok`);

let cdp = null;
try {
  launch(app, PORT);
  cdp = await attach(PORT);
  await cdp.evaluate(`localStorage.setItem("webgba.updateTest", ${JSON.stringify(JSON.stringify({ feeds: { "com.flightrabbit.rapid": { feed: `${R2}/com.flightrabbit.rapid/latest.json`, key: opt.pub } } }))}); 1`);
  await fetch(`${R2}/__clear`);
  await cdp.evaluate("location.reload(); 1").catch(() => {});
  cdp.close();
  await sleep(1500);
  cdp = await attach(PORT);
  const waitFor = async (expr, ms = 30000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await cdp.evaluate(expr).catch(() => false)) return true;
      await sleep(200);
    }
    return false;
  };
  const shown = await waitFor(`!document.getElementById("layer").hidden && Boolean(document.querySelector("#dialog .upick__item"))`);
  const rowsNow = () => cdp.evaluate(`[...document.querySelectorAll("#dialog .upick__item")].map((n) => ({ state: n.dataset.state, meta: n.querySelector(".upick__meta").textContent, btn: n.querySelector(".upick__btn").hidden ? "" : n.querySelector(".upick__btn").textContent }))`);
  const first = shown ? await rowsNow() : [];
  ok("앱 실행 → 업데이트 창(1.3.0 → 1.3.1)", shown && first.length === 1 && /1\.3\.0 → 1\.3\.1/.test(first[0].meta), JSON.stringify(first));
  await sleep(300);
  const popupShot = path.join(shots, "exe_update_popup.png");
  await cdp.screenshot(popupShot);
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
  await ink("업데이트 창 줄 버튼", "#dialog .upick__btn:not([hidden])", popupShot);
  await ink("업데이트 창 아래 버튼(LATER·UPDATE)", "#dialog-actions .btn", popupShot);
  const align = await cdp.evaluate(`[...document.querySelectorAll("#dialog .upick__item")].map((li) => { const s = getComputedStyle(li); const r = li.getBoundingClientRect(); const top = r.top + parseFloat(s.paddingTop); const h = r.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderBottomWidth); const mid = (n) => { const b = n.getBoundingClientRect(); return b.top + b.height / 2; }; return Math.max(...[li.querySelector(".upick__check"), li.querySelector(".upick__art:not([hidden])"), li.querySelector(".upick__text")].filter(Boolean).map((n) => Math.abs(mid(n) - (top + h / 2)))); })`);
  ok("업데이트 창 줄 안 상자(체크·그림·글) 세로 가운데 차이 0px", align.length && align.every((d) => d < 0.5), align.map((d) => d.toFixed(1)).join(" "));

  await cdp.evaluate(`[...document.querySelectorAll("#dialog-actions .btn")].find((b) => b.textContent === "LATER").click(); 1`);
  await sleep(500);
  const rowBtn = await waitFor(`Boolean(document.querySelector("#start .row__upd"))`, 5000);
  ok("창을 닫은 뒤 첫 화면 즐겨찾기 줄에 업데이트 버튼", rowBtn);
  const rowShot = path.join(shots, "exe_update_row.png");
  await cdp.screenshot(rowShot);
  await ink("즐겨찾기 줄 업데이트 버튼", "#start .row__upd", rowShot);
  const rowAlign = await cdp.evaluate(`(() => { const b = document.querySelector("#start .row__upd").getBoundingClientRect(); const r = document.querySelector("#start .row__upd").closest(".row").getBoundingClientRect(); return Math.abs((b.top + b.bottom) / 2 - (r.top + r.bottom) / 2); })()`);
  ok("즐겨찾기 줄 안 버튼 세로 가운데 차이 0px", rowAlign < 0.5, rowAlign.toFixed(2));

  for (const lang of ["en", "ja", "ko"]) {
    await cdp.evaluate(`${T}.setLang(${JSON.stringify(lang)})`);
    await sleep(400);
    await cdp.evaluate(`${T}.updater.open(); 1`);
    await waitFor(`!document.getElementById("layer").hidden && Boolean(document.querySelector("#dialog .upick__item"))`, 5000);
    await sleep(300);
    const fits = await cdp.evaluate(`[...document.querySelectorAll("#dialog .upick__name, #dialog .upick__meta, #dialog .upick__label, #dialog-actions .btn")].filter((n) => n.offsetParent !== null).map((n) => ({ text: n.textContent, cut: n.scrollWidth > n.clientWidth + 1 || n.getClientRects().length > 1 }))`);
    ok(`${lang} 업데이트 창 문구 한 줄·잘림 없음`, fits.length && fits.every((x) => !x.cut), fits.map((x) => `${x.text}${x.cut ? "(잘림)" : ""}`).join(" | "));
    const shot = path.join(shots, `exe_update_${lang}.png`);
    await cdp.screenshot(shot);
    await ink(`${lang} 업데이트 창 줄 버튼`, "#dialog .upick__btn:not([hidden])", shot);
    await cdp.evaluate(`[...document.querySelectorAll("#dialog-actions .btn")][0].click(); 1`);
    await sleep(400);
    const rowShotLang = path.join(shots, `exe_row_${lang}.png`);
    await cdp.screenshot(rowShotLang);
    await ink(`${lang} 즐겨찾기 줄 업데이트 버튼`, "#start .row__upd", rowShotLang);
    if (lang !== "ko") fs.rmSync(rowShotLang, { force: true });
    if (lang !== "en") fs.rmSync(shot, { force: true });
  }
  await cdp.evaluate(`document.querySelector("#start .row__upd").click(); 1`);
  const finished = await waitFor(`[...document.querySelectorAll("#dialog .upick__item")].length > 0 && [...document.querySelectorAll("#dialog .upick__item")].every((n) => n.dataset.state === "done" || n.dataset.state === "failed")`, 120000);
  const after = finished ? await rowsNow() : [];
  const disk = sha1(fs.readFileSync(game));
  ok("줄 버튼 → 업데이트 → 디스크 파일 = 1.3.1 SHA-1", finished && after[0]?.state === "done" && disk === target131, `${JSON.stringify(after)} · ${disk} · 기다림 ${finished} · 기준 ${target131}`);
  ok("옆 .sav 그대로", sha1(fs.readFileSync(sav)) === sha1(marker));
  ok("임시 파일이 남지 않음", !fs.readdirSync(games).some((name) => name.endsWith(".tmp")), fs.readdirSync(games).join(", "));
  const log = await (await fetch(`${R2}/__log`)).json();
  ok("버전 파일 1번 · 패치 1번(창을 두 번 열어도)", log.filter((l) => l.path.endsWith("latest.json")).length === 1 && log.filter((l) => l.path.includes("/patches/")).length === 1, log.map((l) => `${l.path.split("/").pop().slice(0, 10)}@${l.origin}`).join(", "));
  await cdp.evaluate(`[...document.querySelectorAll("#dialog-actions .btn")][0].click(); 1`);
  await sleep(300);

  await cdp.evaluate(`${T}.openPath(${JSON.stringify(game)})`);
  const running = await waitFor(`Boolean(${T}.state.game) && ${T}.player.running`, 60000);
  const blocked = running
    ? await cdp.evaluate(`(async () => { const t = ${T}; const id = t.state.game.saveId; t.state.prefs.slotVersions = { [id]: { 1: "1.3.0" } }; await t.loadStateFrom(1); return { status: document.getElementById("status").textContent, version: t.state.game.info?.version }; })()`)
    : null;
  ok("다른 버전(1.3.0) 퀵슬롯 불러오기 막힘 + 안내", blocked && /1\.3\.0/.test(blocked.status) && /1\.3\.1/.test(blocked.status) && blocked.version === "1.3.1", JSON.stringify(blocked));
  await cdp.evaluate(`window.__TAURI__.core.invoke("window_close")`).catch(() => {});
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error));
} finally {
  cdp?.close();
  r2.kill();
}
await sleep(1500);
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
fs.writeFileSync(path.join(work, "app-update.json"), JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
