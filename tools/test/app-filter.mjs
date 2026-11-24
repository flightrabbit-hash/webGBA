// exe 화면 필터 시험(설계 38절) — CDP 로 실제 앱: 형식별 렌더(.gba·포트·아케이드·② script·웹 빌드 틀)·성능·패널 흐름·게임패드·키보드·빨리 감기·퀵슬롯·게임 추천·언어.
// 웹 web/test/web-filter.mjs 와 같은 항목(휴대폰 배치·hover 는 웹 전용).
//   node tools/test/app-filter.mjs <exe> <작업 폴더> [--shots <캡처 폴더>] [--base <비교 exe>] [--only formats,script,frame,perf,flow,pad,ff,recommend,lang]
// 작업 폴더: rom\test.gba · port\firered.wgba · arcade\*.wgba · script\*.wgba · webpage\*.wasm(원래 페이지 빌드) — 없는 것은 건너뜀.
// 앱 폴더 <작업>\app_filter 를 새로 만든다(wgbaLink false — 레지스트리 안 건드림, updateCheck false — 업데이트 요청 없음). 마우스는 CDP 로만.
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep } from "./cdp.mjs";
import { decodePng } from "../../web/test/png.mjs";

const args = process.argv.slice(2);
const [exe, work] = args;
if (!exe || !work) {
  console.error("사용법: node tools/test/app-filter.mjs <exe> <작업 폴더> [--shots <폴더>] [--base <비교 exe>] [--only 이름,…]");
  process.exit(2);
}
const opt = {};
for (let i = 2; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const only = opt.only ? new Set(opt.only.split(",")) : null;
const want = (name) => !only || only.has(name);
const SHOTS = path.resolve(opt.shots ?? path.join(work, "captures"));
fs.mkdirSync(SHOTS, { recursive: true });

const PORT = 9341;
const appDir = path.join(work, "app_filter");
const pick = (dir, ext) => {
  const full = path.join(work, dir);
  if (!fs.existsSync(full)) return null;
  const hit = fs.readdirSync(full).find((n) => n.toLowerCase().endsWith(ext));
  return hit ? path.join(full, hit) : null;
};
const FILES = { gba: pick("rom", ".gba"), port: pick("port", ".wgba"), arcade: pick("arcade", ".wgba"), script: pick("script", ".wgba"), page: pick("webpage", ".wasm") };

const results = [];
const notes = {};
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- 앱 띄우기·닫기
async function startApp(exePath = exe) {
  if (runningIn(work)) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  fs.rmSync(appDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const appExe = prepareApp(exePath, appDir);
  const cfg = path.join(appDir, "bin", "ini", "personalization.cfg");
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, "utf8")), window: { x: 40, y: 40, width: 1280, height: 800, maximized: false } }, null, 2));
  launch(appExe, PORT);
  const app = await attach(PORT);
  await app.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await app.evaluate(`(() => {
    window.__sfErrors = [];
    window.addEventListener("error", (e) => window.__sfErrors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__sfErrors.push(String(e.reason?.message ?? e.reason)));
    return true;
  })()`);
  return app;
}

async function stopApp(app) {
  if (!app) return;
  await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(2000)]);
  app.close();
  for (let i = 0; i < 40 && runningIn(work); i++) await sleep(250);
}

const T = "window.__WEBGBA_TEST__";
const js = (v) => JSON.stringify(v);
const ev = (app, code) => app.evaluate(code);
const dbg = (app) => ev(app, `${T}.filter.debug()`);
const errorsOf = (app) => ev(app, "window.__sfErrors.slice(0, 3)");

async function waitFor(app, cond, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ev(app, `Boolean(${cond})`).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

async function openGame(app, file, options = {}) {
  await ev(app, `${T}.openPath(${js(file)}, ${js(options)})`);
  const frame = Boolean(options.preferPage);
  const done = await waitFor(app, frame ? `${T}.state.game?.kind === "frame"` : `${T}.state.game && ${T}.player.running`, 180000);
  if (!done) throw new Error(`게임을 열지 못함: ${path.basename(file)} · ${await ev(app, "document.getElementById('status').textContent")}`);
  await sleep(500);
}

const click = (app, sel) => ev(app, `(() => { const n = document.querySelector(${js(sel)}); if (!n) throw new Error("없음 " + ${js(sel)}); n.click(); return true; })()`);
const exists = (app, sel) => ev(app, `Boolean(document.querySelector(${js(sel)}))`);
const setRange = (app, sel, value) =>
  ev(app, `(() => { const r = document.querySelector(${js(sel)}); r.value = ${js(String(value))}; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const rectOf = (app, sel) =>
  ev(app, `(() => { const n = document.querySelector(${js(sel)}); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
const openPanel = (app) => ev(app, `(() => { const f = ${T}.filter; if (!f.isOpen) f.open(); return true; })()`);
const closePanel = (app) => ev(app, `${T}.filter.close()`);
const panelOpen = (app) => ev(app, `${T}.filter.isOpen`);
async function setLook(app, id) {
  await openPanel(app);
  await click(app, `[data-fid="p-${id}"]`);
}

async function shot(app, name, sel = null) {
  const file = path.join(SHOTS, `${name}.png`);
  if (sel) {
    const r = await rectOf(app, sel);
    await app.screenshot(file, { x: r.x, y: r.y, width: r.w, height: r.h });
  } else await app.screenshot(file);
  return file;
}

function pngStats(file) {
  const img = decodePng(fs.readFileSync(file));
  let sum = 0;
  let sat = 0;
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    sum += r + g + b;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    if (seen.size < 5000) seen.add((r << 16) | (g << 8) | b);
  }
  const n = img.data.length / 4;
  return { mean: sum / n / 3, sat: Math.round(sat / n), colors: seen.size, w: img.width, h: img.height };
}
const screenPng = async (app, name) => pngStats(await shot(app, name, "#screen"));

async function key(app, { key: k, code, vk = 0 }, holdMs = 80) {
  await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk });
  if (k === " ") await app.send("Input.dispatchKeyEvent", { type: "char", key: k, code, text: " " });
  await sleep(holdMs);
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
}
const KEY = { right: { key: "ArrowRight", code: "ArrowRight", vk: 39 }, space: { key: " ", code: "Space", vk: 32 }, tab: { key: "Tab", code: "Tab", vk: 9 }, esc: { key: "Escape", code: "Escape", vk: 27 } };

async function mouse(app, type, x, y) {
  await app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
}

// 대표 프레임 시간: tick(에뮬 + 그리기 + 필터) CPU · rAF 간격 · 초당 프레임
const MEASURE = (ms) => `(async () => {
  const p = ${T}.player;
  const orig = p.tick;
  const costs = [];
  p.tick = (now) => { const t0 = performance.now(); orig(now); costs.push(performance.now() - t0); };
  const gaps = [];
  let last = 0;
  let frames = 0;
  const start = performance.now();
  await new Promise((resolve) => {
    const loop = (now) => { if (last) gaps.push(now - last); last = now; frames++; if (now - start < ${ms}) requestAnimationFrame(loop); else resolve(); };
    requestAnimationFrame(loop);
  });
  p.tick = orig;
  const q = (a, k) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0; };
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const r = (v) => Math.round(v * 100) / 100;
  return { fps: r((frames * 1000) / ${ms}), tick: r(avg(costs)), tick95: r(q(costs, 0.95)), gap: r(avg(gaps)), gap95: r(q(gaps, 0.95)) };
})()`;
async function measureBest(app) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const m = await ev(app, MEASURE(2000));
    if (!best || m.tick < best.tick) best = m;
  }
  return best;
}
const gpuCost = (app, n = 30) =>
  ev(app, `(() => {
    const e = ${T}.filter.engine();
    const d = ${T}.filter.debug();
    if (!e || !d.gl.on) return 0;
    const gl = e.gl;
    const px = new Uint8Array(4);
    const w = e.canvas.width;
    const h = e.canvas.height;
    e.render(d.gl.chain, w, h);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < ${n}; i++) { e.render(d.gl.chain, w, h); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return Math.round(((performance.now() - t0) / ${n}) * 100) / 100;
  })()`);

const statusText = (app) => ev(app, "document.getElementById('status').textContent");
const PRESET_SHOTS = ["orig", "pixel", "gba", "crt", "smooth", "gb", "sharp3d", "vector", "gray"];

// ---------------------------------------------------------------- 실행
let app = null;
try {
  guardOthers(exe, work);

  // 1. 형식별 렌더(.gba · 포트 · 아케이드)
  if (want("formats")) {
    const sets = [
      ["gba", FILES.gba, 14000],
      ["port", FILES.port, 25000],
      ["arcade", FILES.arcade, 12000],
    ].filter(([, f]) => f);
    app = await startApp();
    for (const [kind, file, wait] of sets) {
      await openGame(app, file);
      await sleep(wait);
      await openPanel(app);
      await sleep(300);
      const base = await screenPng(app, `f_${kind}_orig`);
      let changed = 0;
      for (const id of PRESET_SHOTS.slice(1)) {
        await click(app, `[data-fid="p-${id}"]`);
        await sleep(200);
        const st = await screenPng(app, `f_${kind}_${id}`);
        if (Math.abs(st.mean - base.mean) > 0.5 || st.colors !== base.colors) changed++;
      }
      const d = await dbg(app);
      ok(`${kind}: 프리셋 ${PRESET_SHOTS.length - 1}종 적용 시 게임 화면 변경(GL)`, changed === PRESET_SHOTS.length - 1 && !d.gl.failed, `변경 ${changed}, GL 실패 ${d.gl.failed}`);
      await click(app, '[data-fid="p-crt"]');
      await sleep(250);
      const r = await ev(app, `({ screen: getComputedStyle(document.getElementById("screen")).borderTopLeftRadius, gl: getComputedStyle(document.querySelector(".sf-canvas")).borderTopLeftRadius, radius: ${T}.filter.radius(), pointer: Boolean(${T}.player.host?.hasPointer) })`);
      if (r.pointer) {
        await click(app, '[data-fid="sec-display"]');
        const lock = await ev(app, `({ curve: document.querySelector('[data-fid="d-display-crt-curve"]')?.disabled, corner: document.querySelector('[data-fid="d-display-crt-corner"]')?.disabled, note: document.querySelector('[data-row="d-display-crt-curve"] .field__note')?.textContent })`);
        ok(`${kind}: 마우스 조작 게임(Web_Pointer) → CRT 곡면 0% 고정(반경 0, 곡면·모서리 잠금 + 안내)`, r.radius === 0 && r.screen === "0px" && lock.curve && lock.corner && lock.note.includes("마우스 조작 게임"), JSON.stringify({ ...r, ...lock }));
        await click(app, '[data-fid="sec-display"]');
      } else ok(`${kind}: CRT 기본(곡면 25%·모서리 25%) → 화면 반경(#screen·GL 캔버스)`, r.radius > 0 && r.screen !== "0px" && r.gl === r.screen, JSON.stringify(r));
      const glRect = await rectOf(app, ".sf-canvas");
      const scRect = await rectOf(app, "#screen");
      ok(`${kind}: GL 캔버스가 게임 화면(#screen)과 같은 자리·크기`, glRect && scRect && Math.abs(glRect.x - scRect.x) <= 1 && Math.abs(glRect.y - scRect.y) <= 1 && Math.abs(glRect.w - scRect.w) <= 1 && Math.abs(glRect.h - scRect.h) <= 1, `${JSON.stringify(glRect)} ${JSON.stringify(scRect)}`);
      await shot(app, kind === "arcade" ? "app_arcade_crt" : kind === "gba" ? "app_panel_crt" : `app_${kind}_crt`);
      if (kind === "gba") {
        await click(app, '[data-fid="p-gba"]');
        await sleep(250);
        await shot(app, "app_panel_gba");
      }
      await click(app, '[data-fid="p-orig"]');
      await closePanel(app);
      await sleep(250);
      const off = await ev(app, `({ sf: document.body.dataset.sf ?? "", radius: ${T}.filter.radius(), canvas: getComputedStyle(document.getElementById("screen")).opacity, paused: ${T}.player.paused })`);
      ok(`${kind}: 원본으로 되돌리면 기존 경로(2D 캔버스, GL 끔·반경 0)·게임 다시 진행`, !off.sf && off.radius === 0 && off.canvas === "1" && !off.paused, JSON.stringify(off));
    }
    ok("형식: 페이지 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }

  // 2. ② script — 효과만(틀 iframe 에 CSS filter)
  if (want("script") && FILES.script) {
    app = await startApp();
    await openGame(app, FILES.script);
    await sleep(4000);
    await openPanel(app);
    await sleep(300);
    const locks = await ev(app, `({ scale: document.querySelector('[data-fid="sec-scale"]').disabled, display: document.querySelector('[data-fid="sec-display"]').disabled, color: document.querySelector('[data-fid="sec-color"]').disabled, ban: Boolean(document.querySelector(".fban--warn")) })`);
    ok("script: 확대·화면 잠금(미지원), 효과만 사용 + 안내", locks.scale && locks.display && !locks.color && locks.ban, JSON.stringify(locks));
    await shot(app, "app_script_panel");
    const before = pngStats(await shot(app, "s_script_orig", ".script-frame"));
    await click(app, '[data-fid="p-gray"]');
    await sleep(400);
    const css = await ev(app, `({ filter: document.querySelector(".script-frame")?.style.filter ?? "", sf: document.body.dataset.sf ?? "" })`);
    const gray = pngStats(await shot(app, "app_script_gray", ".script-frame"));
    ok("script: 흑백 → 틀(iframe)에 CSS filter, GL 미사용, 화면 채도 0", css.filter.includes("grayscale(1)") && !css.sf && gray.sat < 3 && before.sat > gray.sat, JSON.stringify({ ...css, sat: gray.sat, before: before.sat }));
    await click(app, '[data-fid="sec-color"]');
    await click(app, '[data-fid="c-color-dmg"]');
    await sleep(200);
    const dither = await ev(app, `({ dither: document.querySelector('[data-fid="d-color-dmg-dither"]')?.disabled, cvd: document.querySelector('[data-fid="c-color-cvd"]')?.disabled })`);
    ok("script: 게임보이 점 무늬 잠금 · 색약 보정 칩 잠금(CSS 함수로 불가)", dither.dither === true && dither.cvd === true, JSON.stringify(dither));
    await click(app, '[data-fid="p-orig"]');
    const cleared = await ev(app, `document.querySelector(".script-frame")?.style.filter ?? ""`);
    ok("script: 원본 → CSS filter 해제", !cleared, cleared);
    await closePanel(app);
    ok("script: 페이지 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }

  // 3. 웹 빌드 틀(원래 페이지로 열기) — 미지원 안내
  if (want("frame") && FILES.page) {
    app = await startApp();
    await openGame(app, FILES.page, { preferPage: true });
    await sleep(1500);
    const btn = await ev(app, `!document.getElementById("btn-filter").disabled`);
    await openPanel(app);
    await sleep(300);
    const s = await ev(app, `({ chip: document.querySelector(".fp-chip")?.textContent, ban: document.querySelector(".fban__title")?.textContent, tiles: document.querySelectorAll(".ptile").length, foot: Boolean(document.querySelector(".fp__foot")), sf: document.body.dataset.sf ?? "", radius: ${T}.filter.radius() })`);
    ok("웹 빌드 틀: 필터 버튼 사용 가능 → 패널 「미지원」 칩·안내만(프리셋·부분 없음, GL 없음)", btn && s.chip === "미지원" && s.ban === "화면 필터 미지원" && !s.tiles && !s.foot && !s.sf && s.radius === 0, JSON.stringify(s));
    await shot(app, "app_frame_unsupported");
    await closePanel(app);
    ok("웹 빌드 틀: 페이지 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }

  // 4. 성능 — 필터 끔(비교 exe 와 같은 수준)·대표 필터
  if (want("perf") && FILES.gba) {
    const rows = [];
    const runSet = async (label, exePath, looks) => {
      app = await startApp(exePath);
      await openGame(app, FILES.gba);
      await sleep(6000);
      for (const id of looks) {
        if (id !== "off") {
          await setLook(app, id);
          await closePanel(app);
        }
        await sleep(800);
        const m = await measureBest(app);
        const g = id === "off" ? 0 : await gpuCost(app);
        rows.push({ set: label, look: id, ...m, gpu: g });
        console.log(`  ${label} ${id}: fps ${m.fps} tick ${m.tick}ms(p95 ${m.tick95}) gap ${m.gap}ms(p95 ${m.gap95}) gpu ${g}ms`);
      }
      ok(`성능 ${label}: 페이지 오류 없음`, !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
      await stopApp(app);
      app = null;
    };
    if (opt.base) await runSet("비교 exe(e568771)", path.resolve(opt.base), ["off"]);
    await runSet("이 가지 exe", exe, ["off", "pixel", "gba", "crt", "smooth", "vector", "gb"]);
    notes.perf = rows;
    const off = rows.find((r) => r.set === "이 가지 exe" && r.look === "off");
    const base = rows.find((r) => r.set.startsWith("비교"));
    if (off && base) ok("성능: 필터 끔 tick·간격이 비교 exe 와 같은 수준(tick 차 0.5ms 이내 또는 10% 이내)", Math.abs(off.tick - base.tick) <= Math.max(0.5, base.tick * 0.1) && Math.abs(off.gap - base.gap) < 1.5, `이 가지 ${off.tick}/${off.gap} · 비교 ${base.tick}/${base.gap}`);
    ok("성능: 대표 필터 모두 초당 55프레임 이상", rows.filter((r) => r.set === "이 가지 exe").every((r) => r.fps >= 55), rows.filter((r) => r.set === "이 가지 exe").map((r) => `${r.look} ${r.fps}`).join(", "));
  }

  // 5. UI 흐름(시안 화면 흐름 5단계 + 원본 보기 + 설정 창 + 게임 미실행)
  if (want("flow") && FILES.gba) {
    app = await startApp();
    const before = await ev(app, `({ disabled: document.getElementById("btn-filter").disabled, title: document.getElementById("btn-filter").title })`);
    ok("게임 미실행: 레일 필터 버튼 비활성", before.disabled && before.title === "화면 필터", JSON.stringify(before));
    await openGame(app, FILES.gba);
    await sleep(12000);
    const gid = await ev(app, `${T}.state.game.saveId`);
    const stage0 = await rectOf(app, "#stage");
    await click(app, "#btn-filter");
    await waitFor(app, `!document.getElementById("filterPanel").hidden`);
    await sleep(300);
    let s = await ev(app, `({ paused: ${T}.player.paused, pressed: document.getElementById("btn-filter").getAttribute("aria-pressed"), pill: !document.getElementById("paused").hidden })`);
    ok("1단계: 레일 필터 버튼 → 우측 Dock 패널 + 게임 일시정지", s.paused && s.pressed === "true" && s.pill, JSON.stringify(s));
    const scr = await rectOf(app, "#screen");
    const fp = await rectOf(app, "#filterPanel");
    const stage1 = await rectOf(app, "#stage");
    ok("1단계: 게임 화면을 가리지 않음(남은 영역에 다시 맞춤, 패널 폭 400px)", scr && fp && scr.x + scr.w <= fp.x && fp.w === 400 && stage1.w < stage0.w && fp.x >= stage1.x + stage1.w - 1, `화면 ${JSON.stringify(scr)} 패널 ${JSON.stringify(fp)} 영역 ${stage0.w} → ${stage1.w}`);
    await click(app, '[data-fid="p-gba"]');
    await sleep(300);
    s = await ev(app, `${T}.state.prefs.screenFilter.global`);
    const disk = JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8")).screenFilter?.global;
    ok("1단계: 프리셋 「GBA 액정」 선택 즉시 저장(personalization.cfg, SAVE 없음)", s.base === "gba" && s.look.display.id === "lcd" && disk?.base === "gba", JSON.stringify({ mem: s.base, disk: disk?.base }));
    await setRange(app, '[data-fid="s-display"]', 50);
    s = await dbg(app);
    ok("1단계: 화면 강도 막대 50% → 체인에 반영(격자 0.3)", s.store.global.look.display.s === 50 && Math.abs(s.gl.chain.display.p[0] - 0.3) < 1e-6, JSON.stringify(s.gl.chain.display.p));
    await shot(app, "u1_quick");
    await click(app, '[data-fid="sec-display"]');
    await click(app, '[data-fid="c-display-crt"]');
    const fields = await ev(app, `[...document.querySelectorAll('.fsec[data-sec="display"] .fp-field')].map((n) => n.dataset.row)`);
    ok("2단계: CRT 선택 → CRT 디테일만(곡면·모서리·주사선·마스크·번짐)", fields.join(",") === "d-display-crt-curve,d-display-crt-corner,d-display-crt-scan,d-display-crt-mask,d-display-crt-bloom", fields.join(","));
    await setRange(app, '[data-fid="s-display"]', 100);
    const r0 = await ev(app, `${T}.filter.radius()`);
    await setRange(app, '[data-fid="d-display-crt-corner"]', 45);
    const r1 = await ev(app, `${T}.filter.radius()`);
    const mod = await exists(app, ".ptile.is-mod");
    ok("2단계: 모서리 45% → 화면 반경 증가", r1 > r0 && r0 > 0, `${r0} → ${r1}`);
    await setRange(app, '[data-fid="d-display-crt-curve"]', 0);
    const flat = await ev(app, `({ r: ${T}.filter.radius(), corner: document.querySelector('[data-fid="d-display-crt-corner"]').disabled })`);
    ok("2단계: 곡면 0% → 직각(반경 0, 모서리 잠금)", flat.r === 0 && flat.corner, JSON.stringify(flat));
    await setRange(app, '[data-fid="d-display-crt-curve"]', 30);
    await sleep(200);
    await shot(app, "app_panel_detail");
    await click(app, '[data-fid="def-display"]');
    const def = await dbg(app);
    ok("2단계: 「기본값」 → CRT 값·강도만 기본(곡면 25·모서리 25)", def.store.global.look.display.d.crt.curve === 25 && def.store.global.look.display.d.crt.corner === 25 && def.store.global.look.display.s === 100, JSON.stringify(def.store.global.look.display.d.crt));
    ok("2단계: 프리셋 칸 「수정됨」 표시(프리셋 후 값 변경)", mod);
    // 3단계 프리셋 저장
    const saveDialog = async (name = null, pickIndex = null) => {
      await click(app, '[data-fid="f-save"]');
      await waitFor(app, `!document.getElementById("layer").hidden && document.querySelector("#dialog .dialog__input")`);
      if (pickIndex !== null) await click(app, `#dialog [data-fid="dl-pick-${pickIndex}"]`);
      if (name !== null) await ev(app, `(() => { const i = document.querySelector("#dialog .dialog__input"); i.value = ${js(name)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      await click(app, '#dialog [data-action="sf-save"]');
      await sleep(200);
    };
    await saveDialog("내 CRT 프리셋 이름이 깁니다");
    s = await dbg(app);
    ok("3단계: 프리셋 저장(이름 12자 제한) → 사용자 칸 추가·선택", s.store.user.length === 1 && [...s.store.user[0].name].length === 12 && s.store.global.base === `user:${s.store.user[0].id}` && (await exists(app, `[data-fid="p-user:${s.store.user[0].id}"]`)), JSON.stringify(s.store.user.map((u) => u.name)));
    await ev(app, `(() => { const i = document.querySelector('[data-fid="uname"]'); i.value = "내 CRT"; i.dispatchEvent(new Event("change")); return true; })()`);
    s = await dbg(app);
    ok("3단계: 사용자 프리셋 이름 변경", s.store.user[0].name === "내 CRT", s.store.user[0].name);
    for (let i = 2; i <= 5; i++) await saveDialog();
    await click(app, '[data-fid="f-save"]');
    await waitFor(app, `!document.getElementById("layer").hidden && document.querySelector("#dialog .dialog__input")`);
    const full = await ev(app, `({ pick: document.querySelectorAll('#dialog [data-fid^="dl-pick-"]').length, warn: document.querySelector("#dialog .note--warn")?.textContent ?? "" })`);
    await shot(app, "u3_save_full_dialog");
    await click(app, '#dialog [data-fid="dl-pick-1"]');
    await ev(app, `(() => { const i = document.querySelector("#dialog .dialog__input"); i.value = "덮어씀"; return true; })()`);
    await click(app, '#dialog [data-action="sf-save"]');
    await sleep(200);
    s = await dbg(app);
    ok("3단계: 5개 가득 → 덮어쓸 프리셋 선택 후 덮어쓰기", full.pick === 5 && s.store.user.length === 5 && s.store.user[1].name === "덮어씀", `${full.pick} ${full.warn} ${s.store.user.map((u) => u.name).join("/")}`);
    await shot(app, "u3_saved");
    await click(app, '[data-fid="udel"]');
    await waitFor(app, `!document.getElementById("layer").hidden`);
    await click(app, '#dialog [data-action="sf-ok"]');
    await sleep(200);
    s = await dbg(app);
    ok("3단계: 사용자 프리셋 삭제(DELETE) → 4개, 현재 값 유지", s.store.user.length === 4 && s.store.global.base === null && s.store.global.look.display.id === "crt", `${s.store.user.length} base ${s.store.global.base}`);
    // 4단계 게임별 저장
    await click(app, '[data-fid="scope-game"]');
    await sleep(200);
    s = await ev(app, `({ d: ${T}.filter.debug(), chip: document.querySelector(".fp-chip")?.textContent, dot: document.getElementById("btn-filter-dot").hidden ? "" : document.getElementById("btn-filter-dot").dataset.tone, title: document.getElementById("btn-filter").title, status: document.getElementById("status").textContent })`);
    ok("4단계: 「이 게임만」 → 전용 설정 생성 + 헤더 「이 게임 전용」 + 버튼 점(노랑)·제목 + 상태 줄", Boolean(s.d.store.games[gid]) && s.chip === "이 게임 전용" && s.dot === "game" && s.title === "화면 필터(이 게임 전용)" && s.status.includes("전용 설정을 생성"), `${s.chip} ${s.dot} ${s.title} ${s.status}`);
    await click(app, '[data-fid="p-gray"]');
    s = await dbg(app);
    ok("4단계: 이후 변경은 이 게임에만(모든 게임 값 그대로)", s.store.games[gid].look.color.id === "gray" && s.store.global.look.color.id === "none");
    await shot(app, "u4_game");
    await closePanel(app);
    await ev(app, `${T}.closeGame({ quiet: true })`);
    await openGame(app, FILES.gba);
    await sleep(600);
    s = await ev(app, `({ status: document.getElementById("status").textContent, chain: ${T}.filter.debug().gl.chain?.color.key })`);
    ok("4단계: 다시 열면 전용 설정 적용 + 상태 줄 안내", s.status.includes("게임별 화면 필터 적용") && s.chain === "c:gray", JSON.stringify(s));
    // 5단계 되돌리기
    await click(app, "#btn-filter");
    await click(app, '[data-fid="p-vector"]');
    await click(app, '[data-fid="t-undo"]');
    s = await dbg(app);
    ok("5단계: 「열기 전으로」 → 패널 연 시점 복원", s.store.games[gid].look.color.id === "gray" && s.store.games[gid].look.scale.id === "nearest");
    // 원본 보기(누르는 동안)
    const cmp = await rectOf(app, '[data-fid="t-compare"]');
    await mouse(app, "mouseMoved", cmp.x + cmp.w / 2, cmp.y + cmp.h / 2);
    await mouse(app, "mousePressed", cmp.x + cmp.w / 2, cmp.y + cmp.h / 2);
    await sleep(150);
    const during = await ev(app, `({ sf: document.body.dataset.sf ?? "", compare: ${T}.filter.debug().ui.compare })`);
    await shot(app, "u5_compare_hold");
    await mouse(app, "mouseReleased", cmp.x + cmp.w / 2, cmp.y + cmp.h / 2);
    await sleep(150);
    const after = await ev(app, `({ sf: document.body.dataset.sf ?? "", compare: ${T}.filter.debug().ui.compare })`);
    ok("원본 보기: 누르는 동안 원본, 떼면 복귀", during.compare && !during.sf && !after.compare && after.sf === "gl", JSON.stringify({ during, after }));
    await click(app, '[data-fid="f-reset"]');
    await waitFor(app, `!document.getElementById("layer").hidden`);
    const title = await ev(app, `document.getElementById("dialog-title").textContent`);
    await click(app, '#dialog [data-action="sf-ok"]');
    await sleep(200);
    s = await ev(app, `({ d: ${T}.filter.debug(), dot: document.getElementById("btn-filter-dot").hidden })`);
    ok("5단계: 「전용 설정 해제」 확인 창(RESET) → 전용 설정 삭제, 모든 게임 설정 사용", !s.d.store.games[gid] && s.d.rec.scope === "global" && s.dot === true && title.includes("전용 화면 필터를 해제"), title);
    await click(app, '[data-fid="p-crt"]');
    await click(app, '[data-fid="f-reset"]');
    await waitFor(app, `!document.getElementById("layer").hidden`);
    await click(app, '#dialog [data-action="sf-ok"]');
    await sleep(200);
    s = await dbg(app);
    ok("5단계: 「초기화」(RESET) → 모든 게임 원본, 사용자 프리셋 유지", s.store.global.base === "orig" && s.store.global.look.display.id === "none" && s.store.user.length === 4);
    // 설정 창 「화면」 그룹
    await click(app, '[data-fid="scope-game"]');
    await closePanel(app);
    await ev(app, `${T}.openSettings("general")`);
    await waitFor(app, `document.querySelector('#settings-modal:not([hidden]) [data-action="sf-edit"]')`);
    await sleep(300);
    const cfg = await ev(app, `(() => {
      const edit = document.querySelector('[data-action="sf-edit"]');
      const group = edit.closest(".cfg__group");
      return { group: group.querySelector(".cfg__title").textContent, list: document.querySelectorAll(".glist__item").length, labels: [...group.querySelectorAll(".cfg__label, .cfg-sub__label")].map((n) => n.firstChild.textContent).filter((x) => x.includes("화면 필터")) };
    })()`);
    ok("설정 창: 「화면」 그룹에 「화면 필터」 요약·편집 + 「게임별 화면 필터」 목록", cfg.group === "화면" && cfg.list === 1 && cfg.labels.length === 2, JSON.stringify(cfg));
    await ev(app, `(() => { const g = document.querySelector('[data-action="sf-edit"]').closest(".cfg__group"); g.scrollIntoView({ block: "start" }); return true; })()`);
    await sleep(200);
    await shot(app, "app_settings");
    await click(app, ".glist__item .iconbtn--danger");
    await sleep(200);
    s = await ev(app, `({ list: document.querySelectorAll(".glist__item").length, games: Object.keys(${T}.filter.debug().store.games).length, open: ${T}.settings.isOpen() })`);
    ok("설정 창: 게임별 목록 삭제(설정 창 유지)", s.list === 0 && s.games === 0 && s.open, JSON.stringify(s));
    await click(app, '[data-action="sf-edit"]');
    await sleep(300);
    s = await ev(app, `({ settings: ${T}.settings.isOpen(), open: ${T}.filter.isOpen })`);
    ok("설정 창: 편집 → 설정 창 닫고 같은 패널", !s.settings && s.open, JSON.stringify(s));
    await closePanel(app);
    const resumed = await ev(app, `${T}.player.paused`);
    ok("패널 닫으면 게임 다시 진행", !resumed);
    ok("흐름: 페이지 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    // 게임 실행 전: 설정 › 편집 → 샘플 화면
    await ev(app, `${T}.closeGame({ quiet: true })`);
    await sleep(300);
    await ev(app, `${T}.openSettings("general")`);
    await waitFor(app, `document.querySelector('#settings-modal:not([hidden]) [data-action="sf-edit"]')`);
    await click(app, '[data-action="sf-edit"]');
    await sleep(300);
    await click(app, '[data-fid="p-crt"]');
    await sleep(300);
    const st = await ev(app, `({ sf: document.body.dataset.sf ?? "", scope: Boolean(document.querySelector('[data-fid="scope-game"]')), ban: document.querySelector(".fban__title")?.textContent, btn: document.getElementById("btn-filter").disabled, start: getComputedStyle(document.getElementById("start")).visibility, gl: Boolean(document.querySelector(".sf-canvas")?.offsetWidth) })`);
    ok("게임 미실행: 설정 › 편집 → 샘플 화면 미리보기·적용 범위 = 모든 게임", st.sf === "sample" && !st.scope && st.btn && st.ban === "게임 실행 전" && st.start === "hidden" && st.gl, JSON.stringify(st));
    await shot(app, "app_no_game_sample");
    await closePanel(app);
    const offSample = await ev(app, `document.body.dataset.sf ?? ""`);
    ok("게임 미실행: 닫으면 샘플 미리보기 해제", !offSample, offSample);
    ok("게임 미실행: 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }

  // 6. 게임패드 · 키보드
  if (want("pad") && FILES.gba) {
    app = await startApp();
    await openGame(app, FILES.gba);
    await sleep(3000);
    await ev(app, `(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      window.__pad = { id: "test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons, timestamp: 0 };
      navigator.getGamepads = () => [window.__pad, null, null, null];
      window.dispatchEvent(new Event("gamepadconnected"));
      return true;
    })()`);
    const press = async (i, hold = 90) => {
      await ev(app, `(window.__pad.buttons[${i}].pressed = true)`);
      await sleep(hold);
      await ev(app, `(window.__pad.buttons[${i}].pressed = false)`);
      await sleep(110);
    };
    await press(11);
    ok("게임패드: R3 → 패널 열기", await panelOpen(app));
    await press(5);
    let s = await dbg(app);
    ok("게임패드: R → 다음 프리셋(픽셀 유지)", s.store.global.base === "pixel", s.store.global.base);
    await press(5);
    await press(4);
    s = await dbg(app);
    ok("게임패드: L → 이전 프리셋", s.store.global.base === "pixel", s.store.global.base);
    await press(13);
    const f1 = await ev(app, `document.querySelector(".fp .is-focus")?.dataset.fid`);
    await press(14);
    s = await dbg(app);
    ok("게임패드: ↓ 행 이동 → 확대 행, ← 막대 값 -5%", f1 === "sec-scale" && s.store.global.look.scale.s === 95, `${f1}, ${s.store.global.look.scale.s}`);
    await press(0);
    s = await dbg(app);
    ok("게임패드: A → 펼침", s.ui.sec === "scale", String(s.ui.sec));
    await shot(app, "p1_pad_focus");
    await press(1);
    s = await dbg(app);
    ok("게임패드: B → 접기", s.ui.sec === null, String(s.ui.sec));
    await ev(app, "(window.__pad.buttons[3].pressed = true)");
    await sleep(150);
    const yOn = await dbg(app);
    await ev(app, "(window.__pad.buttons[3].pressed = false)");
    await sleep(150);
    const yOff = await dbg(app);
    ok("게임패드: Y 누르는 동안 원본 보기", yOn.ui.compare && !yOff.ui.compare);
    await press(1);
    ok("게임패드: B → 패널 닫기", !(await panelOpen(app)));
    await press(11);
    await press(11);
    ok("게임패드: R3 다시 → 닫기", !(await panelOpen(app)));
    // 키보드
    await click(app, "#btn-filter");
    await sleep(200);
    await ev(app, `document.querySelector('[data-fid="s-scale"]').focus()`);
    await key(app, KEY.right);
    await sleep(100);
    s = await dbg(app);
    ok("키보드: 막대에서 → 값 +5%", s.store.global.look.scale.s === 100, String(s.store.global.look.scale.s));
    await ev(app, `document.querySelector('[data-fid="t-compare"]').focus()`);
    await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await sleep(120);
    const kOn = await dbg(app);
    await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await sleep(120);
    const kOff = await dbg(app);
    ok("키보드: 원본 보기에서 Space 누르는 동안 원본", kOn.ui.compare && !kOff.ui.compare);
    await ev(app, `document.querySelector('[data-fid="t-close"]').focus()`);
    await key(app, KEY.tab);
    await sleep(100);
    const tabbed = await ev(app, `({ inside: Boolean(document.activeElement?.closest("#filterPanel")), fast: ${T}.player.fast })`);
    ok("키보드: 패널에서 Tab = 포커스 이동(빨리 감기 아님)", tabbed.inside && !tabbed.fast, JSON.stringify(tabbed));
    await key(app, KEY.esc);
    await sleep(150);
    ok("키보드: Esc → 닫기", !(await panelOpen(app)));
    ok("게임패드·키보드: 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }

  // 7. 빨리 감기 · 퀵슬롯
  if (want("ff") && FILES.gba) {
    app = await startApp();
    await openGame(app, FILES.gba);
    await sleep(12000);
    await setLook(app, "gba");
    await closePanel(app);
    let s = await dbg(app);
    ok("잔상 있는 프리셋(GBA 액정 잔상 20%) → 체인 잔상", s.gl.chain.ghost > 0.19, String(s.gl.chain.ghost));
    await key(app, KEY.tab);
    await sleep(600);
    s = await ev(app, `({ chain: ${T}.filter.debug().gl.chain, speed: ${T}.player.speed })`);
    ok("빨리 감기 중 잔상 끔(설정 값 유지)", s.speed > 1 && s.chain.ghost === 0, `${s.speed} ${s.chain.ghost}`);
    const ffm = await ev(app, MEASURE(3000));
    notes.ff = ffm;
    ok("빨리 감기 + 필터: 화면 갱신 유지", ffm.fps > 30, JSON.stringify(ffm));
    await openPanel(app);
    await sleep(200);
    const ban = await ev(app, `[...document.querySelectorAll(".fban__title")].map((n) => n.textContent)`);
    ok("빨리 감기 중 패널 안내", ban.includes("빨리 감기 중"), ban.join(","));
    await closePanel(app);
    await key(app, KEY.tab);
    await sleep(600);
    s = await dbg(app);
    ok("빨리 감기 해제 → 잔상 복귀", s.gl.chain.ghost > 0.19, String(s.gl.chain.ghost));
    const saved = await ev(app, `${T}.saveStateTo(3).then(() => true, () => false)`);
    await sleep(1500);
    await ev(app, `${T}.loadStateFrom(3)`);
    await sleep(800);
    s = await dbg(app);
    const st = await screenPng(app, "q1_after_load");
    ok("퀵슬롯: 필터 켠 채 저장·불러오기 → 필터 계속 적용(GL)", saved && s.gl.on && st.colors > 20, JSON.stringify({ saved, on: s.gl.on, colors: st.colors }));
    ok("빨리 감기·퀵슬롯: 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }

  // 8. 설명서 게임 추천(display.filter) · 언어
  if ((want("recommend") || want("lang")) && FILES.gba) {
    app = await startApp();
    await openGame(app, FILES.gba);
    await sleep(2000);
    if (want("recommend")) {
      await ev(app, `(() => { ${T}.state.game.net = { manifest: { display: { filter: { display: { id: "crt", detail: { curve: 15, corner: 20, scan: 70 } } } } } }; ${T}.filter.open(); return true; })()`);
      await sleep(300);
      const s = await ev(app, `({ first: document.querySelector(".ptile")?.dataset.fid, title: document.querySelector(".fgroup .fgroup__title")?.textContent, applied: ${T}.filter.debug().store.global.look.display.id })`);
      ok("게임 추천: 설명서 display.filter → 프리셋 첫 칸 「게임 추천」(자동 적용 아님)", s.first === "p-rec" && s.applied === "none", JSON.stringify(s));
      await click(app, '[data-fid="p-rec"]');
      const d = await dbg(app);
      ok("게임 추천: 칸 선택 시 추천값 적용", d.store.global.look.display.id === "crt" && d.store.global.look.display.d.crt.curve === 15);
      await shot(app, "r1_recommend");
      await closePanel(app);
    }
    if (want("lang")) {
      for (const [lang, title] of [["en", "Screen filter"], ["ja", "画面フィルター"]]) {
        await ev(app, `${T}.setLang(${js(lang)})`);
        await openPanel(app);
        await click(app, '[data-fid="sec-display"]');
        await sleep(200);
        const s = await ev(app, `({ title: document.getElementById("fpTitle").textContent, raw: [...document.querySelectorAll("#filterPanel *")].some((n) => n.childElementCount === 0 && /\\bsf\\.[a-z]/.test(n.textContent + (n.title ?? ""))), btn: document.getElementById("btn-filter").title })`);
        ok(`언어 ${lang}: 패널 제목·버튼 제목 번역, 번역 키 그대로 보이는 글 없음`, s.title === title && !s.raw && !s.btn.startsWith("sf."), JSON.stringify(s));
        await shot(app, `l_${lang}_panel`);
        await closePanel(app);
      }
      await ev(app, `${T}.setLang("ko")`);
    }
    ok("추천·언어: 오류 없음", !(await errorsOf(app)).length, (await errorsOf(app)).join(" | "));
    await stopApp(app);
    app = null;
  }
} catch (error) {
  ok("오류 없이 끝남", false, String(error?.stack ?? error));
  if (app) await stopApp(app).catch(() => {});
  else if (runningIn(work)) {
    const left = await connect(PORT, { timeoutMs: 3000 }).catch(() => null);
    if (left) await stopApp(left).catch(() => {});
  }
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n결과 ${results.length - failed.length}/${results.length} 통과`);
  fs.writeFileSync(path.join(SHOTS, "app_filter_result.json"), JSON.stringify({ results, notes }, null, 2));
  process.exit(failed.length ? 1 : 0);
}
