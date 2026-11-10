// exe 관리자 모드 "롬 가져오기" 시험(실제 앱, CDP — 흉내 비공개 R2·가짜 Upstash·로컬 관리자 서버, 실제 R2·Vercel 안 씀).
//   node tools/test/app-admin.mjs <시험 exe> <작업 폴더>
// 시험 식별자로 빌드한 exe 만(기본 식별자 exe 금지). 서버 주소는 개발 키트 덮어쓰기(localStorage webgba.adminTest.base),
// 루프백 http 받기도 개발 키트일 때만 허용되는 길(Rust admin_fetch)을 그대로 쓴다.
import fs from "fs";
import http from "http";
import path from "path";
import { attach, guardOthers, isolatedBuild, launch, prepareApp, sleep } from "./cdp.mjs";
import { decodePng } from "../../web/test/png.mjs";
import { ADMIN, createAdmin } from "../../api/_admin/server.js";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { startFakeUpstash } from "./fake-upstash.mjs";
import { keyFile, startFakeR2 } from "./fake-r2-private.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-admin.mjs <시험 exe> <작업 폴더>");
  process.exit(2);
}
if (!isolatedBuild(exe)) {
  console.error("기본 식별자 exe 는 쓰지 않습니다 — 식별자를 바꾼 시험 빌드를 주세요");
  process.exit(2);
}
const PORT = 9352;
const API_PORT = 9484;
const PIN = "5!0#8" + "2";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const u = (n) => {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const str = (t) => [...u(t.length), ...Buffer.from(t)];
const sec = (id, body) => [id, ...u(body.length), ...body];
const vec = (items) => [...u(items.length), ...items.flat()];
function tinyWasm(pad) {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [0], [0]]));
  const mem = sec(5, vec([[0x00, 1]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
  const blob = sec(0, [...str("x.blob"), ...new Array(pad).fill(7)]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code, ...blob]);
}
const game = async (id, version, name, pad) => (await packWgba({ wasm: tinyWasm(pad), manifest: { wgba: 1, id, version, name, runtime: "webapi", input: { preset: "gba" } } })).bytes;

const root = path.resolve(work);
const appDir = path.join(root, "app");
const shots = path.join(root, "captures");
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });
guardOthers(exe, appDir);
const app = prepareApp(exe, appDir);

const alpha = await game("io.example.alpha", "1.2.0", { en: "Alpha", ko: "알파" }, 900000);
const gamma = await game("io.example.gamma", "0.3.1", { ja: "ガンマ" }, 300000);
const beta = await game("io.example.beta", "2.0.0", "Beta Quest", 1000);
fs.writeFileSync(path.join(appDir, "beta-local.wgba"), beta);
fs.writeFileSync(path.join(appDir, "Alpha.wgba"), await game("io.example.other", "1.0.0", "Other", 10));

const r2 = await startFakeR2();
const kv = await startFakeUpstash();
let skew = 0;
const api = createAdmin({ env: { ...r2.env, UPSTASH_REDIS_REST_URL: kv.url, UPSTASH_REDIS_REST_TOKEN: kv.token }, endpoint: r2.endpoint, now: () => Date.now() + skew });
const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
r2.put("authentication.key", keyFile(PIN, kst(Date.now() - 600000)));
r2.put("wgba/io.example.alpha/1.2.0.wgba", alpha);
r2.put("wgba/io.example.beta/2.0.0.wgba", beta);
r2.put("wgba/Gamma Land.wgba", gamma);
r2.slow(500);
const origins = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  origins.push(req.headers.origin ?? "");
  const response = await api.handle(new Request(`http://127.0.0.1:${API_PORT}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve) => server.listen(API_PORT, "127.0.0.1", resolve));

let cdp = null;
const T = "window.__WEBGBA_TEST__";
const ev = (expr) => cdp.evaluate(expr);
const click = (selector) => ev(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.click(); return true; })()`);
const clickAction = (label) => ev(`(() => { const b = [...document.querySelectorAll("#dialog-actions .btn")].find((n) => n.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const until = async (expr, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(expr).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
};
const press = async (label) => (await until(`[...document.querySelectorAll("#dialog-actions .btn")].some((n) => n.textContent.trim() === ${JSON.stringify(label)} && !n.disabled)`)) && clickAction(label);
const closeList = async () => {
  await press("CLOSE");
  return until(`document.getElementById("layer").hidden`, 5000);
};
const typePad = (pin) => ev(`(() => { for (const k of ${JSON.stringify([...pin])}) document.querySelector('#dialog .apad__key[data-key="' + k + '"]').click(); return document.querySelectorAll("#dialog .apad__slot.is-on").length; })()`);
const files = () => fs.readdirSync(appDir).filter((n) => /\.wgba$|\.part$/i.test(n)).sort();

async function ink(label, selector, file) {
  const image = decodePng(fs.readFileSync(file));
  const dpr = await ev("devicePixelRatio");
  const boxes = await ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((n) => n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); const lift = parseFloat(String(n.style.translate || "0 0").split(" ")[1] ?? 0) || 0; return { l: r.left + parseFloat(s.borderLeftWidth), r: r.right - parseFloat(s.borderRightWidth), t: r.top - lift + parseFloat(s.borderTopWidth), b: r.bottom - lift - parseFloat(s.borderBottomWidth) }; })`);
  const each = [];
  for (const box of boxes) {
    const x0 = Math.round((box.l + 2) * dpr);
    const x1 = Math.round((box.r - 2) * dpr);
    const y0 = Math.round(box.t * dpr) + 1;
    const y1 = Math.round(box.b * dpr) - 1;
    const counts = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bg = 0;
    let best = -1;
    for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
    let top = -1;
    let bottom = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      if (Math.max(Math.abs(image.data[o] - (bg >> 16)), Math.abs(image.data[o + 1] - ((bg >> 8) & 255)), Math.abs(image.data[o + 2] - (bg & 255))) > 48) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
    if (top >= 0) each.push([Math.round((top - y0) / dpr), Math.round((y1 - 1 - bottom) / dpr)]);
  }
  const worst = Math.max(0, ...each.map(([a, b]) => Math.abs(a - b)));
  ok(`${label} 잉크 세로 가운데(${each.length}개)`, each.length > 0 && worst <= 1, `최대 차이 ${worst}px(홀수 1행 허용) · 위/아래 ${[...new Set(each.map((e) => e.join("/")))].join(" ")}`);
}

try {
  launch(app, PORT);
  cdp = await attach(PORT);
  await ev(`localStorage.setItem("webgba.adminTest", ${JSON.stringify(JSON.stringify({ base: `http://127.0.0.1:${API_PORT}/api/v1/admin/` }))}); 1`);
  ok("비활성 = 레일 롬 가져오기 버튼 숨김", await ev(`document.getElementById("btn-admin").hidden`));

  await ev(`${T}.openSettings(); 1`);
  await until(`Boolean(document.querySelector('[data-action="cfg-admin"]'))`);
  const off = await ev(`(() => { const b = document.querySelector('[data-action="cfg-admin"]'); const row = b.closest(".cfg__row"); return { label: b.textContent, name: row.querySelector(".cfg__label").firstChild.textContent, prevNick: Boolean(row.previousElementSibling?.querySelector(".cfg__input--text")) }; })()`);
  ok("설정 = 닉네임 아래 관리자 모드 ENTER", off.label === "ENTER" && off.name === "관리자 모드" && off.prevNick, JSON.stringify(off));
  await click('[data-action="cfg-admin"]');
  await until(`Boolean(document.querySelector("#dialog .apad"))`);
  await sleep(300);
  const pad = await ev(`({ keys: [...document.querySelectorAll("#dialog .apad__keys .apad__key")].map((b) => b.dataset.key).join(""), actions: [...document.querySelectorAll("#dialog-actions .btn")].map((b) => b.textContent + (b.disabled ? "(꺼짐)" : "")).join("·") })`);
  ok("숫자패드 = 열두 키 · CANCEL/OK(6자리 전 OK 꺼짐)", pad.keys === "123456789!0#" && pad.actions === "CANCEL·OK(꺼짐)", JSON.stringify(pad));
  await typePad("12");
  const padShot = path.join(shots, "01_숫자패드.png");
  await cdp.screenshot(padShot);
  await ink("숫자패드 키", "#dialog .apad__key", padShot);
  await ink("숫자패드 창 버튼", "#dialog-actions .btn", padShot);
  await click('#dialog .apad__key[data-key="erase"]');
  await click('#dialog .apad__key[data-key="erase"]');
  ok("6자리 입력 = 칸 6개", (await typePad(PIN)) === 6);
  await clickAction("OK");
  await until(`!document.querySelector("#dialog .apad")`, 15000);
  await sleep(500);
  const on = await ev(`({ rec: ${T}.state.prefs.admin, label: document.querySelector('[data-action="cfg-admin"]').textContent, hint: document.querySelector('[data-action="cfg-admin"]').closest(".cfg__row").querySelector(".cfg__hint").textContent })`);
  ok("맞는 6자리 → 활성화 · EXIT · 토큰만 저장", on.rec?.token && !JSON.stringify(on.rec).includes(PIN) && on.label === "EXIT" && /활성화됨/.test(on.hint), JSON.stringify({ label: on.label, hint: on.hint }));
  ok("exe 요청 출처 = http://ui.localhost", origins.length > 0 && origins.filter(Boolean).every((o) => o === "http://ui.localhost"), [...new Set(origins)].join(" "));
  await ev(`document.querySelector('[data-action="cfg-admin"]').scrollIntoView({ block: "center" }); 1`);
  await sleep(200);
  const cfgShot = path.join(shots, "02_설정.png");
  await cdp.screenshot(cfgShot);
  await ink("설정 관리자 버튼", '[data-action="cfg-admin"]', cfgShot);
  const cfg = JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8"));
  ok("personalization.cfg 에 6자리 없음", Boolean(cfg.admin?.token) && !JSON.stringify(cfg).includes(PIN));
  await click("#settings-close");
  await sleep(400);
  const rail = await ev(`(() => { const b = document.getElementById("btn-admin"); const f = document.getElementById("btn-favorites").getBoundingClientRect(); const r = b.getBoundingClientRect(); return { hidden: b.hidden, title: b.title, below: r.top >= f.bottom - 1, left: r.left - f.left, w: r.width - f.width }; })()`);
  ok("활성 = 레일 즐겨찾기 다음 롬 가져오기(아이콘 + title)", !rail.hidden && rail.title === "롬 가져오기" && rail.below && rail.left === 0 && rail.w === 0, JSON.stringify(rail));

  await click("#btn-admin");
  await until(`!document.getElementById("layer").hidden && Boolean(document.querySelector("#dialog .upick__item"))`);
  await sleep(500);
  const list = await ev(`({ rows: [...document.querySelectorAll("#dialog .upick__item")].map((n) => n.querySelector(".upick__name").textContent + "|" + n.dataset.key), checked: document.querySelectorAll('#dialog .upick__check[aria-checked="true"]').length, rowButtons: document.querySelectorAll("#dialog .upick__btn").length, actions: [...document.querySelectorAll("#dialog-actions .btn")].map((b) => b.textContent + (b.disabled ? "(꺼짐)" : "")).join("·") })`);
  ok("목록 = exe 폴더에 있는 게임 id(beta) 제외 · 이름", list.rows.length === 2 && list.rows.some((r) => r.startsWith("알파|")) && list.rows.some((r) => r.startsWith("ガンマ|")), list.rows.join(" / "));
  ok("목록 = 체크 모두 꺼짐 · 줄 버튼 없음 · CLOSE/DOWNLOAD(꺼짐)", list.checked === 0 && list.rowButtons === 0 && list.actions === "CLOSE·DOWNLOAD(꺼짐)", JSON.stringify(list));
  const listShot = path.join(shots, "03_목록.png");
  await cdp.screenshot(listShot);
  await ink("목록 글", "#dialog .upick__name, #dialog .upick__meta, #dialog .zpick__allLabel", listShot);
  const align = await ev(`[...document.querySelectorAll("#dialog .upick__item")].map((li) => { const box = li.getBoundingClientRect(); const pad = parseFloat(getComputedStyle(li).paddingTop); const row = { top: box.top + pad, height: box.height - pad * 2 - parseFloat(getComputedStyle(li).borderBottomWidth) }; const mid = (r) => r.top + r.height / 2; return Math.max(...[li.querySelector(".upick__check"), li.querySelector(".upick__text")].map((n) => Math.abs(mid(n.getBoundingClientRect()) - mid(row)))); })`);
  ok("목록 줄 안 상자 세로 가운데 차이 0px", align.every((d) => d < 0.5), align.map((d) => d.toFixed(1)).join(" "));

  await click("#dialog .zpick__all");
  ok("모두 선택 → DOWNLOAD 켜짐", await clickAction("DOWNLOAD"));
  await until(`[...document.querySelectorAll("#dialog .upick__item")].some((n) => n.dataset.state === "busy")`, 10000);
  await sleep(200);
  const busyMeta = await ev(`[...document.querySelectorAll("#dialog .upick__item")].map((n) => n.querySelector(".upick__meta").textContent).join(" / ")`);
  await cdp.screenshot(path.join(shots, "04_받는중.png"));
  ok("받는 중 = 줄 진행 % (Rust 진행 신호)", /내려받는 중 \d+%/.test(busyMeta), busyMeta);
  await until(`[...document.querySelectorAll("#dialog .upick__item")].every((n) => n.dataset.state === "done")`, 60000);
  const got = files();
  ok("exe 폴더에 저장 · 같은 이름이 있으면 (2) · .part 없음", got.join(",") === "Alpha (2).wgba,Alpha.wgba,Gamma Land.wgba,beta-local.wgba", got.join(","));
  ok("받은 파일 = 버킷과 같은 바이트", Buffer.compare(fs.readFileSync(path.join(appDir, "Alpha (2).wgba")), Buffer.from(alpha)) === 0 && Buffer.compare(fs.readFileSync(path.join(appDir, "Gamma Land.wgba")), Buffer.from(gamma)) === 0);
  const favs = await ev(`${T}.state.prefs.favorites`);
  ok("받은 파일 = 즐겨찾기에 추가", favs.some((p) => p.endsWith("Alpha (2).wgba")) && favs.some((p) => p.endsWith("Gamma Land.wgba")), favs.map((p) => path.basename(p)).join(" "));
  ok("목록 닫기", await closeList());

  r2.put("wgba/io.example.delta/1.0.0.wgba", await game("io.example.delta", "1.0.0", "Delta", 400000));
  r2.breakDownloads(true);
  await click("#btn-admin");
  await until(`!document.getElementById("layer").hidden && Boolean(document.querySelector("#dialog .upick__item"))`);
  const left = await ev(`[...document.querySelectorAll("#dialog .upick__item")].map((n) => n.dataset.key)`);
  ok("받은 게임은 다음 목록에서 제외", left.length === 1 && left[0] === "wgba/io.example.delta/1.0.0.wgba", left.join(" "));
  await click("#dialog .upick__check");
  await press("DOWNLOAD");
  await until(`document.querySelector("#dialog .upick__item")?.dataset.state === "failed"`, 30000);
  const fail = await ev(`document.querySelector("#dialog .upick__meta").textContent`);
  ok("받다 끊김 → 실패 이유 · 파일·.part 남기지 않음", /실패/.test(fail) && !files().some((n) => /Delta|\.part/i.test(n)), `${fail} · ${files().join(",")}`);
  r2.breakDownloads(false);
  await until(`!document.querySelector("#dialog-actions .btn").disabled`, 5000);
  await click("#dialog .upick__check");
  await press("DOWNLOAD");
  await until(`document.querySelector("#dialog .upick__item")?.dataset.state === "done"`, 30000);
  ok("실패 줄 다시 체크 → 받기 성공", files().includes("Delta.wgba"));
  ok("목록 닫기", await closeList());

  skew += ADMIN.KEY_MS + 120000;
  r2.put("authentication.key", keyFile(PIN, kst(Date.now() + skew)));
  await click("#btn-admin");
  await until(`!document.getElementById("layer").hidden && Boolean(document.querySelector("#dialog .apad"))`, 15000);
  const again = await ev(`document.querySelector("#dialog-body p").textContent`);
  ok("키 갱신일자가 활성화 이후 → 숫자패드 다시", /다시 입력/.test(again), again);
  await typePad("999999");
  await clickAction("OK");
  await until(`!document.querySelector("#dialog .apad")`, 15000);
  await sleep(500);
  const gone = await ev(`({ hidden: document.getElementById("btn-admin").hidden, rec: ${T}.state.prefs.admin ?? null, status: document.getElementById("status").textContent })`);
  ok("다시 입력 실패 → 버튼 사라짐 · 저장 지움 · 안내", gone.hidden && gone.rec === null && /해제했습니다/.test(gone.status), JSON.stringify(gone));
  await ev(`window.__TAURI__.core.invoke("window_close")`).catch(() => {});
} catch (error) {
  ok("시험 진행", false, String(error?.stack ?? error));
} finally {
  cdp?.close();
  server.close();
  await r2.close();
  await kv.close();
}
await sleep(1500);
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
fs.writeFileSync(path.join(root, "app-admin.json"), JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
