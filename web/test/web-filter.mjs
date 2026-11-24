// 웹 webGBA 화면 필터 시험(로컬 전용, 설계 38절) — 헤드리스 Chrome 으로 필터 렌더(시안과 비교)·성능·패널 흐름·게임패드·키보드·빨리 감기·퀵슬롯·형식·휴대폰 배치를 본다.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-filter.mjs <빌드 폴더> <캡처 폴더> --gba <롬.gba> [--wgba <포트.wgba>] [--arcade <① 게임.wgba>]
//     [--script <② 게임.wgba|.wmba>] [--siaan <UX 시안 src 폴더> --cap <시안 캡처 폴더(rapid_battle.png)>] [--base <비교 빌드 폴더>] [--only 이름,…]
// 빌드 폴더를 이 프로세스 안 정적 서버로 띄운다(node 1개 + 브라우저 1개). 시험 파일은 읽기만 하고 브라우저에 바로 넘긴다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodePng } from "./png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const DIST = path.resolve(args[0]);
const SHOTS = path.resolve(args[1]);
const opt = {};
for (let i = 2; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const only = opt.only ? new Set(opt.only.split(",")) : null;
const want = (name) => !only || only.has(name);
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const notes = {};
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- 0. 번역 표 — 화면 필터가 조합해 쓰는 키(sf.*, 앱과 같은 표 src-bundle/src/i18n)가 세 언어 모두에 존재
if (want("keys")) {
  const core = await import(pathToFileURL(path.join(here, "..", "..", "src-bundle", "src", "js", "core", "screen-filter.js")).href);
  const need = new Set();
  for (const sec of core.SECTION_IDS) {
    need.add(`sf.sec.${sec}`);
    need.add(`sf.sec.${sec}.note`);
    for (const f of core.FILTERS[sec]) {
      need.add(`sf.f.${sec}.${f.id}`);
      need.add(`sf.f.${sec}.${f.id}.desc`);
      for (const x of f.details) {
        const key = `sf.d.${sec}.${f.id}.${x.k}`;
        need.add(key);
        if (x.descByValue) for (const o of x.options) need.add(`${key}.desc${o.v}`);
        else if (x.type === "chips") for (const o of x.options) need.add(`sf.m.${o.v}`);
        else need.add(`${key}.desc`);
        if (x.type === "seg" && x.k !== "levels") for (const o of x.options) need.add(`sf.o.${sec}.${f.id}.${x.k}.${o.v}`);
        if (x.lock) need.add(`sf.lock.${x.k === "dither" ? "dither" : x.k}`);
      }
    }
  }
  for (const p of core.BUILTIN) {
    need.add(`sf.p.${p.id}`);
    need.add(`sf.p.${p.id}.desc`);
  }
  for (const lv of [0, 1, 2]) need.add(`sf.cost.${lv}`);
  for (const w of ["scalefx", "toon", "stack"]) {
    need.add(`sf.what.${w}`);
    need.add(`sf.lighten.${w}`);
  }
  const missing = [];
  for (const lang of ["ko", "en", "ja"]) {
    const table = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "src-bundle", "src", "i18n", `${lang}.json`), "utf8"));
    for (const key of need) if (!(key in table)) missing.push(`${lang}:${key}`);
  }
  ok(`번역 표: 조합 키 ${need.size}개 × 3언어 존재`, !missing.length, missing.slice(0, 8).join(", "));
  const fmt = await import(pathToFileURL(path.join(here, "..", "..", "src-bundle", "src", "js", "core", "wgba-format.js")).href);
  const probe = (display) => {
    const errors = [];
    const warnings = [];
    fmt.checkManifest?.({ wgba: 1, id: "io.example.test", version: "1.0.0", name: "T", runtime: "webapi", display }, errors, warnings);
    return { errors, warnings };
  };
  if (fmt.checkManifest) {
    const good = probe({ aspect: "4:3", filter: { display: { id: "crt", strength: 80, detail: { curve: 15 } }, scale: "sharp" } });
    const bad = probe({ filter: { display: { id: "vhs" }, scale: { id: "smooth", detail: { method: "2xsai" } } } });
    const none = probe({ aspect: "4:3" });
    ok("설명서 검사: display.filter 올바른 값은 경고 없음, 모르는 값은 경고만(오류 아님), 없으면 그대로", !good.errors.length && !good.warnings.length && !bad.errors.length && bad.warnings.length === 2 && !none.errors.length && !none.warnings.length, JSON.stringify({ good, bad }));
  } else notes.checkManifest = "checkManifest 내보내기 없음";
}

// ---------------------------------------------------------------- 정적 서버(빌드 · 시안 src · 시안 캡처)
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8" };
function serve(root, extra = {}) {
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel === "/") rel = "/index.html";
    let base = root;
    for (const [prefix, dir] of Object.entries(extra)) {
      if (dir && rel.startsWith(prefix)) {
        base = dir;
        rel = rel.slice(prefix.length - 1);
      }
    }
    const file = path.join(base, rel);
    if (!file.startsWith(path.resolve(base)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}
const main = await serve(DIST, { "/siaan/": opt.siaan ? path.resolve(opt.siaan) : null, "/cap/": opt.cap ? path.resolve(opt.cap) : null });
const baseSrv = opt.base ? await serve(path.resolve(opt.base)) : null;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
async function newPage({ viewport = { width: 1280, height: 800 }, mobile = false, dpr = null, prefs = null, url = main.url, pad = false } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dpr ?? (mobile ? 2 : 1), userAgent: mobile ? PHONE_UA : undefined });
  await context.addInitScript((p) => {
    localStorage.setItem("webgba.installHint", "1");
    if (p && !sessionStorage.getItem("sfSeeded")) {
      localStorage.setItem("webgba.prefs", JSON.stringify(p));
      sessionStorage.setItem("sfSeeded", "1");
    }
  }, prefs);
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  if (pad) {
    await context.addInitScript(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      const gp = { id: "test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons, timestamp: 0 };
      window.__pad = gp;
      navigator.getGamepads = () => [gp, null, null, null];
    });
  }
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => !/sandboxed and lacks/.test(error.message) && page.errors.push(error.message));
  // 화면 필터와 관계없는 것: 업데이트 목록(R2) 교차 출처 거절(127.0.0.1 출처), ② 게임 틀 안 게임 코드의 sandbox 경고
  page.on("console", (message) => message.type() === "error" && !/favicon|404|r2\.dev|net::ERR_FAILED|sandboxed and lacks|Permissions policy/.test(message.text()) && page.errors.push(message.text()));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page };
}

async function openGame(page, file) {
  const name = path.basename(file);
  const started = await page.evaluate(() => document.body.dataset.view === "game");
  if (started && (await page.isVisible("#btnMenu"))) {
    await page.click("#btnMenu");
    await page.waitForSelector(".bar__group--files #btnOpen", { state: "visible" });
  }
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click(started ? "#btnOpen" : "#startOpen")]);
  await chooser.setFiles({ name, mimeType: "application/octet-stream", buffer: fs.readFileSync(file) });
  await page.waitForFunction((n) => window.webgba.state.game?.name === n && window.webgba.player.running, name, { timeout: 180000 });
  await page.waitForTimeout(500);
}

const shot = async (page, name, el = null) => {
  const file = path.join(SHOTS, `${name}.png`);
  if (el) await page.locator(el).screenshot({ path: file });
  else await page.screenshot({ path: file });
  return file;
};
const satOf = (file) => {
  const im = decodePng(fs.readFileSync(file));
  let v = 0;
  for (let i = 0; i < im.data.length; i += 4) v += Math.max(im.data[i], im.data[i + 1], im.data[i + 2]) - Math.min(im.data[i], im.data[i + 1], im.data[i + 2]);
  return Math.round(v / (im.data.length / 4));
};
const dbg = (page) => page.evaluate(() => window.webgba.filter.debug());
const setLook = (page, preset) =>
  page.evaluate(async (id) => {
    const f = window.webgba.filter;
    if (!f.isOpen) f.open();
    document.querySelector(`[data-fid="p-${id}"]`).click();
  }, preset);
const closePanel = (page) => page.evaluate(() => window.webgba.filter.close());
const panelOpen = (page) => page.evaluate(() => window.webgba.filter.isOpen);
const rectOf = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n || n.hidden) return null;
  const r = n.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}, sel);
const pngStats = (file) => {
  const img = decodePng(fs.readFileSync(file));
  let sum = 0;
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    sum += img.data[i] + img.data[i + 1] + img.data[i + 2];
    if (seen.size < 5000) seen.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
  }
  return { mean: sum / (img.data.length / 4) / 3, colors: seen.size, w: img.width, h: img.height };
};

// 게임 화면 픽셀(스크린샷 .screen) — 필터 전후 차이
async function screenPng(page, name) {
  return pngStats(await shot(page, name, "#screen"));
}

// 대표 프레임 시간: tick(에뮬 + 그리기 + 필터) CPU · rAF 간격 · 초당 프레임
async function measure(page, ms = 4000) {
  return page.evaluate(async (ms) => {
    const p = window.webgba.player;
    const orig = p.tick;
    const costs = [];
    p.tick = (now) => {
      const t0 = performance.now();
      orig(now);
      costs.push(performance.now() - t0);
    };
    const gaps = [];
    let last = 0;
    let frames = 0;
    const start = performance.now();
    await new Promise((resolve) => {
      const loop = (now) => {
        if (last) gaps.push(now - last);
        last = now;
        frames++;
        if (now - start < ms) requestAnimationFrame(loop);
        else resolve();
      };
      requestAnimationFrame(loop);
    });
    p.tick = orig;
    const q = (a, k) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0;
    };
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const r = (v) => Math.round(v * 100) / 100;
    return { fps: r((frames * 1000) / ms), tick: r(avg(costs)), tick95: r(q(costs, 0.95)), gap: r(avg(gaps)), gap95: r(q(gaps, 0.95)) };
  }, ms);
}

// 다른 작업과 PC 를 함께 쓰므로 2초 3구간 중 tick 이 가장 낮은 구간(빌드·필터 모두 같은 방법)
async function measureBest(page) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const m = await measure(page, 2000);
    if (!best || m.tick < best.tick) best = m;
  }
  return best;
}

// 필터 체인만 동기 렌더(readPixels 로 GPU 완료까지) 반복 → 1회 평균 ms
async function gpuCost(page, n = 30) {
  return page.evaluate((n) => {
    const e = window.webgba.filter.engine();
    const d = window.webgba.filter.debug();
    if (!e || !d.gl.on) return 0;
    const gl = e.gl;
    const px = new Uint8Array(4);
    const w = e.canvas.width;
    const h = e.canvas.height;
    e.render(d.gl.chain, w, h);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      e.render(d.gl.chain, w, h);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return Math.round(((performance.now() - t0) / n) * 100) / 100;
  }, n);
}

// ---------------------------------------------------------------- 1. 렌더 — 시안 엔진과 같은 결과
if (want("render") && opt.siaan && opt.cap) {
  const { context, page } = await newPage();
  const out = await page.evaluate(async () => {
    const A = await import("/js/core/screen-filter.js");
    const E = await import("/siaan/engine.js");
    const F = await import("/siaan/filters.js");
    const img = new Image();
    img.src = "/cap/rapid_battle.png";
    await img.decode();
    const looks = [];
    for (const sec of A.SECTION_IDS) {
      for (const f of A.FILTERS[sec]) {
        if (f.id === "smooth") for (const m of ["omni", "scalefx", "xbr", "hq2x", "scale2x"]) looks.push({ name: `${sec}.smooth.${m}`, part: { [sec]: { id: "smooth", d: { method: m } } } });
        else looks.push({ name: `${sec}.${f.id}`, part: { [sec]: { id: f.id } } });
      }
    }
    for (const p of A.BUILTIN) looks.push({ name: `preset.${p.id}`, look: p.id });
    looks.push({ name: "strength.mix", part: { scale: { id: "smooth", s: 40, d: { method: "omni" } }, color: { id: "sepia", s: 60 }, display: { id: "crt", s: 50 } } });
    looks.push({ name: "crt.round", part: { display: { id: "crt", d: { curve: 30, corner: 45 } } } });
    const W = 720;
    const H = 480;
    const ca = document.createElement("canvas");
    const cb = document.createElement("canvas");
    const ea = new A.FilterEngine(ca, { preserve: true });
    const eb = new E.FilterEngine(cb, { preserve: true });
    const read = (c) => {
      const t = document.createElement("canvas");
      t.width = W;
      t.height = H;
      const g = t.getContext("2d");
      g.drawImage(c, 0, 0);
      return g.getImageData(0, 0, W, H).data;
    };
    const res = [];
    for (const item of looks) {
      const la = item.look ? A.BUILTIN.find((p) => p.id === item.look).look : A.makeLook(item.part);
      const lb = item.look ? F.BUILTIN.find((p) => p.id === item.look).look : F.makeLook(item.part);
      const ctx = {};
      const chA = A.resolveChain(la, ctx);
      const chB = F.resolveChain(lb, ctx);
      ea.setSource(img, img.width, img.height);
      eb.setSource(img, img.width, img.height);
      ea.render(chA, W, H, { ghostReset: true });
      eb.render(chB, W, H, { ghostReset: true });
      const a = read(ca);
      const b = read(cb);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) diff++;
      const rA = A.crtFrameRadius(la, ctx, W, H);
      const rB = F.crtFrameRadius(lb, ctx, W, H);
      res.push({ name: item.name, chain: JSON.stringify(chA) === JSON.stringify(chB), diff, radius: Math.abs((rA || 0) - (rB?.rx ?? 0)) < 0.01 });
    }
    return res;
  });
  const bad = out.filter((r) => !r.chain || r.diff || !r.radius);
  ok(`렌더: 필터·프리셋 ${out.length}종 시안 엔진과 같은 체인·픽셀·테두리 반경`, !bad.length, bad.map((r) => `${r.name}(체인 ${r.chain} 픽셀 ${r.diff} 반경 ${r.radius})`).join(", "));
  ok("렌더 페이지 오류 없음", !page.errors.length, page.errors.slice(0, 3).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------- 2. 형식별 렌더 캡처(.gba · 포트 · 아케이드 · script)
const PRESET_SHOTS = ["orig", "pixel", "gba", "crt", "smooth", "gb", "sharp3d", "vector", "gray"];
if (want("formats")) {
  const sets = [
    ["gba", opt.gba, 14000],
    ["port", opt.wgba, 12000],
    ["arcade", opt.arcade, 12000],
  ].filter(([, f]) => f);
  for (const [kind, file, wait] of sets) {
    const { context, page } = await newPage();
    await openGame(page, file);
    await page.waitForTimeout(wait);
    const base = await screenPng(page, `f_${kind}_orig`);
    let changed = 0;
    for (const id of PRESET_SHOTS.slice(1)) {
      await setLook(page, id);
      await page.waitForTimeout(150);
      const st = await screenPng(page, `f_${kind}_${id}`);
      if (Math.abs(st.mean - base.mean) > 0.5 || st.colors !== base.colors) changed++;
    }
    const d = await dbg(page);
    ok(`${kind}: 프리셋 ${PRESET_SHOTS.length - 1}종 적용 시 게임 화면 변경(GL)`, changed === PRESET_SHOTS.length - 1 && !d.gl.failed, `변경 ${changed}, GL 실패 ${d.gl.failed}`);
    await setLook(page, "crt");
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({ screen: getComputedStyle(document.getElementById("screen")).borderTopLeftRadius, radius: window.webgba.filter.radius() }));
    ok(`${kind}: CRT 기본(곡면 25%·모서리 25%) → 화면·테두리 반경`, r.radius > 0 && r.screen !== "0px", JSON.stringify(r));
    await shot(page, `f_${kind}_crt_full`);
    await setLook(page, "orig");
    await closePanel(page);
    await page.waitForTimeout(200);
    const off = await page.evaluate(() => ({ sf: document.body.dataset.sf ?? "", radius: window.webgba.filter.radius(), canvas: getComputedStyle(document.getElementById("canvas")).opacity }));
    ok(`${kind}: 원본으로 되돌리면 지금 경로(2D 캔버스, GL 끔·반경 0)`, !off.sf && off.radius === 0 && off.canvas === "1", JSON.stringify(off));
    ok(`${kind}: 페이지 오류 없음`, !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }
  if (opt.script) {
    const { context, page } = await newPage();
    await openGame(page, opt.script);
    await page.waitForTimeout(8000);
    await page.evaluate(() => window.webgba.filter.open());
    await page.waitForTimeout(300);
    const locks = await page.evaluate(() => ({ scale: document.querySelector('[data-fid="sec-scale"]').disabled, display: document.querySelector('[data-fid="sec-display"]').disabled, color: document.querySelector('[data-fid="sec-color"]').disabled, ban: Boolean(document.querySelector(".fban--warn")) }));
    ok("script: 확대·화면 잠금(미지원), 효과만 사용 + 안내", locks.scale && locks.display && !locks.color && locks.ban, JSON.stringify(locks));
    await shot(page, "f_script_panel");
    await setLook(page, "gray");
    await page.waitForTimeout(300);
    const css = await page.evaluate(() => ({ filter: document.querySelector(".script-frame")?.style.filter ?? "", sf: document.body.dataset.sf ?? "" }));
    const sat = satOf(await shot(page, "f_script_gray", "#screen"));
    ok("script: 흑백 → 틀(iframe)에 CSS filter, GL 미사용, 화면 채도 0", css.filter.includes("grayscale(1)") && !css.sf && sat < 3, JSON.stringify({ ...css, sat }));
    for (const id of ["gb", "sharp3d"]) {
      await setLook(page, id);
      await page.waitForTimeout(200);
      await shot(page, `f_script_${id}`, "#screen");
    }
    await page.click('[data-fid="sec-color"]');
    await page.click('[data-fid="c-color-dmg"]').catch(() => {});
    await page.waitForTimeout(200);
    const dither = await page.evaluate(() => ({ dither: document.querySelector('[data-fid="d-color-dmg-dither"]')?.disabled, cvd: document.querySelector('[data-fid="c-color-cvd"]')?.disabled }));
    ok("script: 게임보이 점 무늬 잠금 · 색약 보정 칩 잠금(CSS 함수로 불가)", dither.dither === true && dither.cvd === true, JSON.stringify(dither));
    await shot(page, "f_script_dmg", "#screen");
    await setLook(page, "orig");
    const cleared = await page.evaluate(() => document.querySelector(".script-frame")?.style.filter ?? "");
    ok("script: 원본 → CSS filter 해제", !cleared, cleared);
    ok("script: 페이지 오류 없음", !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }
}

// ---------------------------------------------------------------- 3. 성능
if (want("perf") && opt.gba) {
  const rows = [];
  const runSet = async (label, viewport, mobile, dpr, url, looks) => {
    const { context, page } = await newPage({ viewport, mobile, dpr, url });
    await openGame(page, opt.gba);
    await page.waitForTimeout(6000);
    for (const id of looks) {
      if (id !== "off") {
        await setLook(page, id);
        await closePanel(page);
      }
      await page.waitForTimeout(800);
      const m = await measureBest(page);
      const g = id === "off" ? 0 : await gpuCost(page);
      rows.push({ set: label, look: id, ...m, gpu: g });
      console.log(`  ${label} ${id}: fps ${m.fps} tick ${m.tick}ms(p95 ${m.tick95}) gap ${m.gap}ms(p95 ${m.gap95}) gpu ${g}ms`);
    }
    ok(`성능 ${label}: 페이지 오류 없음`, !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  };
  const LOOKS = ["off", "pixel", "gba", "crt", "smooth", "vector", "gb"];
  if (baseSrv) await runSet("base(ff-host) PC", { width: 1280, height: 800 }, false, 1, baseSrv.url, ["off"]);
  await runSet("PC 1280×800", { width: 1280, height: 800 }, false, 1, main.url, LOOKS);
  if (baseSrv) await runSet("base(ff-host) 휴대폰 가로", { width: 844, height: 390 }, true, 3, baseSrv.url, ["off"]);
  await runSet("휴대폰 가로 844×390 dpr3", { width: 844, height: 390 }, true, 3, main.url, LOOKS);
  const scalefx = async () => {
    const { context, page } = await newPage({ viewport: { width: 844, height: 390 }, mobile: true, dpr: 3 });
    await openGame(page, opt.gba);
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      const f = window.webgba.filter;
      f.open();
      document.querySelector('[data-fid="p-smooth"]').click();
      document.querySelector('[data-fid="sec-scale"]').click();
    });
    await page.click('[data-fid="d-scale-smooth-method-scalefx"]');
    await closePanel(page);
    await page.waitForTimeout(800);
    const m = await measureBest(page);
    const g = await gpuCost(page);
    rows.push({ set: "휴대폰 가로 844×390 dpr3", look: "smooth.scalefx", ...m, gpu: g });
    console.log(`  휴대폰 scalefx: fps ${m.fps} tick ${m.tick} gap ${m.gap} gpu ${g}`);
    await context.close();
  };
  await scalefx();
  notes.perf = rows;
  const off = rows.find((r) => r.set === "PC 1280×800" && r.look === "off");
  const offBase = rows.find((r) => r.set.startsWith("base") && r.set.includes("PC"));
  if (off && offBase) ok("성능: 필터 끔 tick·간격이 비교 빌드와 같은 수준(tick 차 0.5ms 이내 또는 10% 이내)", Math.abs(off.tick - offBase.tick) <= Math.max(0.5, offBase.tick * 0.1) && Math.abs(off.gap - offBase.gap) < 1.5, `이 가지 ${off.tick}/${off.gap} · 비교 ${offBase.tick}/${offBase.gap}`);
  ok("성능: PC 대표 필터 모두 초당 55프레임 이상", rows.filter((r) => r.set === "PC 1280×800").every((r) => r.fps >= 55), rows.filter((r) => r.set === "PC 1280×800").map((r) => `${r.look} ${r.fps}`).join(", "));
}

// ---------------------------------------------------------------- 4. UI 흐름(시안 화면 흐름 5단계 + 원본 보기 + 설정 창)
if (want("flow") && opt.gba) {
  const { context, page } = await newPage();
  await openGame(page, opt.gba);
  await page.waitForTimeout(12000);
  const gid = await page.evaluate(() => window.webgba.state.game.saveId);
  // 1단계 게임 중 빠른 변경
  await page.click("#btnFilter");
  await page.waitForSelector("#filterPanel:not([hidden])");
  let s = await page.evaluate(() => ({ paused: window.webgba.player.paused, dock: document.body.dataset.fp, pressed: document.getElementById("btnFilter").getAttribute("aria-pressed") }));
  ok("1단계: 필터 버튼 → 패널(우측 Dock) + 게임 일시정지", s.paused && s.dock === "right" && s.pressed === "true", JSON.stringify(s));
  const stage = await rectOf(page, "#screen");
  const fp = await rectOf(page, "#filterPanel");
  ok("1단계: 게임 화면을 가리지 않음(패널 좌측에 다시 맞춤, 폭 400px)", stage && fp && stage.x + stage.w <= fp.x && fp.w === 400, `화면 ${JSON.stringify(stage)} 패널 ${JSON.stringify(fp)}`);
  await page.click('[data-fid="p-gba"]');
  s = await page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs")).screenFilter.global);
  ok("1단계: 프리셋 「GBA 액정」 선택 즉시 저장(SAVE 없음)", s.base === "gba" && s.look.display.id === "lcd", JSON.stringify(s.look.display));
  await page.locator('[data-fid="s-display"]').fill("50");
  s = await dbg(page);
  ok("1단계: 화면 강도 막대 50% → 체인에 반영(격자 0.3)", s.store.global.look.display.s === 50 && Math.abs(s.gl.chain.display.p[0] - 0.3) < 1e-6, JSON.stringify(s.gl.chain.display.p));
  await shot(page, "u1_quick");
  // 2단계 자세히 설정
  await page.click('[data-fid="sec-display"]');
  await page.click('[data-fid="c-display-crt"]');
  const fields = await page.evaluate(() => [...document.querySelectorAll('.fsec[data-sec="display"] .fp-field')].map((n) => n.dataset.row));
  ok("2단계: CRT 선택 → CRT 디테일만(곡면·모서리·주사선·마스크·번짐)", fields.join(",") === "d-display-crt-curve,d-display-crt-corner,d-display-crt-scan,d-display-crt-mask,d-display-crt-bloom", fields.join(","));
  await page.locator('[data-fid="s-display"]').fill("100");
  const r0 = await page.evaluate(() => window.webgba.filter.radius());
  await page.locator('[data-fid="d-display-crt-corner"]').fill("45");
  const r1 = await page.evaluate(() => window.webgba.filter.radius());
  const mod = await page.evaluate(() => Boolean(document.querySelector(".ptile.is-mod")));
  ok("2단계: 모서리 45% → 바깥 테두리 반경 증가", r1 > r0 && r0 > 0, `${r0} → ${r1}`);
  await page.locator('[data-fid="d-display-crt-curve"]').fill("0");
  const flat = await page.evaluate(() => ({ r: window.webgba.filter.radius(), corner: document.querySelector('[data-fid="d-display-crt-corner"]').disabled }));
  ok("2단계: 곡면 0% → 직각(반경 0, 모서리 잠금)", flat.r === 0 && flat.corner, JSON.stringify(flat));
  await page.locator('[data-fid="d-display-crt-curve"]').fill("30");
  await shot(page, "u2_detail");
  await page.click('[data-fid="def-display"]');
  const def = await dbg(page);
  ok("2단계: 「기본값」 → CRT 값·강도만 기본(곡면 25·모서리 25)", def.store.global.look.display.d.crt.curve === 25 && def.store.global.look.display.d.crt.corner === 25 && def.store.global.look.display.s === 100, JSON.stringify(def.store.global.look.display.d.crt));
  ok("2단계: 프리셋 칸 「수정됨」 표시(프리셋 후 값 변경)", mod);
  // 3단계 프리셋 저장
  await page.click('[data-fid="f-save"]');
  await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
  await page.fill("#dialog .dialog__input", "내 CRT 프리셋 이름이 깁니다");
  await page.click('#dialog [data-action="sf-save"]');
  await page.waitForTimeout(200);
  s = await dbg(page);
  ok("3단계: 프리셋 저장(이름 12자 제한) → 사용자 칸 추가·선택", s.store.user.length === 1 && [...s.store.user[0].name].length === 12 && s.store.global.base === `user:${s.store.user[0].id}` && (await page.isVisible(`[data-fid="p-user:${s.store.user[0].id}"]`)), JSON.stringify(s.store.user.map((u) => u.name)));
  await page.fill('[data-fid="uname"]', "내 CRT");
  await page.press('[data-fid="uname"]', "Enter");
  await page.evaluate(() => document.querySelector('[data-fid="uname"]').dispatchEvent(new Event("change")));
  s = await dbg(page);
  ok("3단계: 사용자 프리셋 이름 변경", s.store.user[0].name === "내 CRT", s.store.user[0].name);
  for (let i = 2; i <= 5; i++) {
    await page.click('[data-fid="f-save"]');
    await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
    await page.click('#dialog [data-action="sf-save"]');
    await page.waitForTimeout(150);
  }
  await page.click('[data-fid="f-save"]');
  await page.waitForSelector("#dialog:not([hidden]) .dialog__input");
  const full = await page.evaluate(() => ({ pick: document.querySelectorAll('#dialog [data-fid^="dl-pick-"]').length, warn: document.querySelector("#dialog .note--warn")?.textContent ?? "" }));
  await page.click('#dialog [data-fid="dl-pick-1"]');
  await page.fill("#dialog .dialog__input", "덮어씀");
  await page.click('#dialog [data-action="sf-save"]');
  await page.waitForTimeout(150);
  s = await dbg(page);
  ok("3단계: 5개 가득 → 덮어쓸 프리셋 선택 후 덮어쓰기", full.pick === 5 && s.store.user.length === 5 && s.store.user[1].name === "덮어씀", `${full.pick} ${full.warn} ${s.store.user.map((u) => u.name).join("/")}`);
  await shot(page, "u3_saved");
  await page.click('[data-fid="udel"]');
  await page.waitForSelector("#dialog:not([hidden])");
  await page.click('#dialog [data-action="sf-ok"]');
  await page.waitForTimeout(150);
  s = await dbg(page);
  ok("3단계: 사용자 프리셋 삭제(DELETE) → 4개, 현재 값 유지", s.store.user.length === 4 && s.store.global.base === null && s.store.global.look.display.id === "crt", `${s.store.user.length} base ${s.store.global.base}`);
  // 4단계 게임별 저장
  await page.click('[data-fid="scope-game"]');
  await page.waitForTimeout(150);
  s = await page.evaluate(() => ({ d: window.webgba.filter.debug(), chip: document.querySelector(".fp-chip")?.textContent, badge: document.querySelector("#btnFilter .tool__badgeText")?.textContent, toast: document.getElementById("toast").textContent }));
  ok("4단계: 「이 게임만」 → 전용 설정 생성 + 헤더 「이 게임 전용」 + 버튼 「게임」 배지 + Toast", Boolean(s.d.store.games[gid]) && s.chip === "이 게임 전용" && s.badge === "게임" && s.toast.includes("전용 설정을 생성"), `${s.chip} ${s.badge} ${s.toast}`);
  await page.click('[data-fid="p-gray"]');
  s = await dbg(page);
  ok("4단계: 이후 변경은 이 게임에만(모든 게임 값 그대로)", s.store.games[gid].look.color.id === "gray" && s.store.global.look.color.id === "none", "");
  await shot(page, "u4_game");
  await closePanel(page);
  await page.evaluate(() => window.webgba.closeGame({ quiet: true }));
  await openGame(page, opt.gba);
  await page.waitForTimeout(600);
  s = await page.evaluate(() => ({ toast: document.getElementById("toast").textContent, chain: window.webgba.filter.debug().gl.chain?.color.key }));
  ok("4단계: 다시 열면 전용 설정 적용 + Toast", s.toast.includes("게임별 화면 필터 적용") && s.chain === "c:gray", JSON.stringify(s));
  // 5단계 되돌리기
  await page.click("#btnFilter");
  await page.click('[data-fid="p-vector"]');
  await page.click('[data-fid="t-undo"]');
  s = await dbg(page);
  ok("5단계: 「열기 전으로」 → 패널 연 시점 복원", s.store.games[gid].look.color.id === "gray" && s.store.games[gid].look.scale.id === "nearest", "");
  // 원본 보기(누르는 동안)
  const cmp = await page.locator('[data-fid="t-compare"]').boundingBox();
  await page.mouse.move(cmp.x + cmp.width / 2, cmp.y + cmp.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => ({ sf: document.body.dataset.sf ?? "", compare: window.webgba.filter.debug().ui.compare }));
  await shot(page, "u5_compare_hold");
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ sf: document.body.dataset.sf ?? "", compare: window.webgba.filter.debug().ui.compare }));
  ok("원본 보기: 누르는 동안 원본, 떼면 복귀", during.compare && !during.sf && !after.compare && after.sf === "gl", JSON.stringify({ during, after }));
  await page.click('[data-fid="f-reset"]');
  await page.waitForSelector("#dialog:not([hidden])");
  const title = await page.textContent("#dialogTitle");
  await page.click('#dialog [data-action="sf-ok"]');
  await page.waitForTimeout(150);
  s = await page.evaluate(() => ({ d: window.webgba.filter.debug(), badge: document.querySelector("#btnFilter .tool__badge")?.hidden }));
  ok("5단계: 「전용 설정 해제」 확인 창(RESET) → 전용 설정 삭제, 모든 게임 설정 사용", !s.d.store.games[gid] && s.d.rec.scope === "global" && s.badge === true && title.includes("전용 화면 필터를 해제"), title);
  await page.click('[data-fid="p-crt"]');
  await page.click('[data-fid="f-reset"]');
  await page.waitForSelector("#dialog:not([hidden])");
  await page.click('#dialog [data-action="sf-ok"]');
  await page.waitForTimeout(150);
  s = await dbg(page);
  ok("5단계: 「초기화」(RESET) → 모든 게임 원본, 사용자 프리셋 유지", s.store.global.base === "orig" && s.store.global.look.display.id === "none" && s.store.user.length === 4, "");
  await shot(page, "u5_reset");
  // 설정 창 「화면」 그룹
  await page.click('[data-fid="scope-game"]');
  await closePanel(page);
  await page.click("#btnSettings");
  await page.waitForSelector('#sheet:not([hidden]) [data-action="sf-edit"]');
  const cfg = await page.evaluate(() => ({ list: document.querySelectorAll(".glist__item").length, text: [...document.querySelectorAll("#sheet .field__label, #sheet .cfg-sub__label")].map((n) => n.textContent).filter((x) => x.includes("화면 필터")) }));
  ok("설정 창: 「화면 필터」 요약·편집 + 「게임별 화면 필터」 목록", cfg.list === 1 && cfg.text.length === 2, JSON.stringify(cfg));
  await shot(page, "u6_settings");
  await page.click(".glist__item .tool--danger");
  await page.waitForTimeout(150);
  s = await page.evaluate(() => ({ list: document.querySelectorAll(".glist__item").length, games: Object.keys(window.webgba.filter.debug().store.games).length }));
  ok("설정 창: 게임별 목록 삭제", s.list === 0 && s.games === 0, JSON.stringify(s));
  await page.click('[data-action="sf-edit"]');
  await page.waitForTimeout(200);
  s = await page.evaluate(() => ({ sheet: document.getElementById("sheet").hidden, open: window.webgba.filter.isOpen }));
  ok("설정 창: 편집 → 설정 창 닫고 같은 패널", s.open, JSON.stringify(s));
  await closePanel(page);
  const resumed = await page.evaluate(() => window.webgba.player.paused);
  ok("패널 닫으면 게임 다시 진행", !resumed);
  ok("흐름: 페이지 오류 없음", !page.errors.length, page.errors.slice(0, 3).join(" | "));
  await context.close();
  // 게임 실행 전: 설정 › 편집 → 샘플 화면
  {
    const { context: c2, page: p2 } = await newPage();
    await p2.click("#btnSettings");
    await p2.waitForSelector('#sheet:not([hidden]) [data-action="sf-edit"]');
    await p2.click('[data-action="sf-edit"]');
    await p2.waitForTimeout(200);
    await p2.click('[data-fid="p-crt"]');
    await p2.waitForTimeout(200);
    const st = await p2.evaluate(() => ({ sf: document.body.dataset.sf ?? "", scope: Boolean(document.querySelector('[data-fid="scope-game"]')), ban: document.querySelector(".fban__title")?.textContent, btn: document.getElementById("btnFilter").hidden }));
    ok("게임 미실행: 필터 버튼 숨김, 설정 › 편집 → 샘플 화면 미리보기·적용 범위 = 모든 게임", st.sf === "sample" && !st.scope && st.btn && st.ban === "게임 실행 전", JSON.stringify(st));
    await shot(p2, "u7_no_game");
    await p2.evaluate(() => window.webgba.filter.close());
    const off = await p2.evaluate(() => document.body.dataset.sf ?? "");
    ok("게임 미실행: 닫으면 샘플 미리보기 해제", !off, off);
    ok("게임 미실행: 오류 없음", !p2.errors.length, p2.errors.slice(0, 3).join(" | "));
    await c2.close();
  }
}

// ---------------------------------------------------------------- 5. 게임패드 · 키보드
if (want("pad") && opt.gba) {
  const { context, page } = await newPage({ pad: true });
  await openGame(page, opt.gba);
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
  const press = async (i, hold = 90) => {
    await page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i);
    await page.waitForTimeout(hold);
    await page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i);
    await page.waitForTimeout(90);
  };
  await press(11);
  ok("게임패드: R3 → 패널 열기", await panelOpen(page));
  const focus0 = await page.evaluate(() => document.querySelector(".fp .is-focus")?.dataset.fid);
  await press(5);
  let s = await dbg(page);
  ok("게임패드: R → 다음 프리셋(픽셀 유지)", s.store.global.base === "pixel", s.store.global.base);
  await press(5);
  await press(4);
  s = await dbg(page);
  ok("게임패드: L → 이전 프리셋", s.store.global.base === "pixel", s.store.global.base);
  await press(13);
  const f1 =await page.evaluate(() => document.querySelector(".fp .is-focus")?.dataset.fid);
  await press(14);
  s = await dbg(page);
  ok("게임패드: ↓ 행 이동 → 확대 행, ← 막대 값 -5%", f1 === "sec-scale" && s.store.global.look.scale.s === 95, `${focus0} → ${f1}, ${s.store.global.look.scale.s}`);
  await press(0);
  s = await dbg(page);
  ok("게임패드: A → 펼침", s.ui.sec === "scale", String(s.ui.sec));
  await press(1);
  s = await dbg(page);
  ok("게임패드: B → 접기", s.ui.sec === null, String(s.ui.sec));
  await page.evaluate(() => (window.__pad.buttons[3].pressed = true));
  await page.waitForTimeout(120);
  const yOn = await dbg(page);
  await page.evaluate(() => (window.__pad.buttons[3].pressed = false));
  await page.waitForTimeout(120);
  const yOff = await dbg(page);
  ok("게임패드: Y 누르는 동안 원본 보기", yOn.ui.compare && !yOff.ui.compare);
  await shot(page, "p1_pad_focus");
  await press(1);
  ok("게임패드: B → 패널 닫기", !(await panelOpen(page)));
  await press(11);
  await press(11);
  ok("게임패드: R3 다시 → 닫기", !(await panelOpen(page)));
  // 키보드
  await page.click("#btnFilter");
  await page.focus('[data-fid="s-scale"]');
  await page.keyboard.press("ArrowRight");
  s = await dbg(page);
  ok("키보드: 막대에서 → 값 +5%", s.store.global.look.scale.s === 100, String(s.store.global.look.scale.s));
  await page.focus('[data-fid="t-compare"]');
  await page.keyboard.down(" ");
  await page.waitForTimeout(80);
  const kOn = await dbg(page);
  await page.keyboard.up(" ");
  await page.waitForTimeout(80);
  const kOff = await dbg(page);
  ok("키보드: 원본 보기에서 Space 누르는 동안 원본", kOn.ui.compare && !kOff.ui.compare);
  await page.focus('[data-fid="t-close"]');
  await page.keyboard.press("Tab");
  const tabbed = await page.evaluate(() => Boolean(document.activeElement?.closest("#filterPanel")));
  const fast = await page.evaluate(() => window.webgba.player.gameSpeed);
  ok("키보드: 패널에서 Tab = 포커스 이동(빨리 감기 아님)", tabbed && fast === 1, `${tabbed} ${fast}`);
  await page.keyboard.press("Escape");
  ok("키보드: Esc → 닫기", !(await panelOpen(page)));
  ok("게임패드·키보드: 오류 없음", !page.errors.length, page.errors.slice(0, 3).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------- 6. 빨리 감기 · 퀵슬롯
if (want("ff") && opt.gba) {
  const { context, page } = await newPage();
  await openGame(page, opt.gba);
  await page.waitForTimeout(12000);
  await setLook(page, "gba");
  await closePanel(page);
  let s = await dbg(page);
  ok("잔상 있는 프리셋(GBA 액정 잔상 20%) → 체인 잔상", s.gl.chain.ghost > 0.19, String(s.gl.chain.ghost));
  await page.keyboard.press("Tab");
  await page.waitForTimeout(600);
  s = await page.evaluate(() => ({ chain: window.webgba.filter.debug().gl.chain, speed: window.webgba.player.speed }));
  ok("빨리 감기 중 잔상 끔(설정 값 유지)", s.speed > 1 && s.chain.ghost === 0, `${s.speed} ${s.chain.ghost}`);
  const ffm = await measure(page, 3000);
  notes.ff = ffm;
  ok("빨리 감기 + 필터: 화면 갱신 유지", ffm.fps > 30, JSON.stringify(ffm));
  await page.evaluate(() => window.webgba.filter.open());
  const ban = await page.evaluate(() => [...document.querySelectorAll(".fban__title")].map((n) => n.textContent));
  ok("빨리 감기 중 패널 안내", ban.includes("빨리 감기 중"), ban.join(","));
  await closePanel(page);
  for (let i = 0; i < 6 && (await page.evaluate(() => window.webgba.player.gameSpeed)) !== 1; i++) await page.keyboard.press("Tab");
  await page.waitForTimeout(600);
  s = await dbg(page);
  ok("빨리 감기 해제 → 잔상 복귀", s.gl.chain.ghost > 0.19, String(s.gl.chain.ghost));
  // 퀵슬롯: 필터 켠 채 저장·불러오기, 칸 그림 = 필터 전 원본
  const saved = await page.evaluate(() => window.webgba.quickSave(3));
  await page.waitForTimeout(800);
  const thumb = await page.evaluate(async () => {
    const id = window.webgba.state.game.saveId;
    const list = await window.webgba.store.states(id);
    const one = list.find((x) => x.slot === 3);
    return one?.thumb ? Array.from(new Uint8Array(one.thumb).slice(0, 4)) : null;
  });
  const thumbSize = await page.evaluate(async () => {
    const id = window.webgba.state.game.saveId;
    const one = (await window.webgba.store.states(id)).find((x) => x.slot === 3);
    if (!one?.thumb) return null;
    const bmp = await createImageBitmap(new Blob([one.thumb]));
    return [bmp.width, bmp.height];
  });
  ok("퀵슬롯: 필터 켠 채 저장, 칸 그림은 원본 해상도(필터 전)", saved !== false && thumb && thumbSize?.[0] === 240 && thumbSize?.[1] === 160, JSON.stringify({ saved, thumbSize }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.webgba.quickLoad(3));
  await page.waitForTimeout(800);
  s = await dbg(page);
  const st = await screenPng(page, "q1_after_load");
  ok("퀵슬롯: 불러온 뒤 필터 계속 적용(GL)", s.gl.on && st.colors > 20, JSON.stringify({ on: s.gl.on, colors: st.colors }));
  ok("빨리 감기·퀵슬롯: 오류 없음", !page.errors.length, page.errors.slice(0, 3).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------- 7. 휴대폰 배치 · hover 없음
if (want("phone") && opt.gba) {
  const layouts = [
    ["portrait_pad", { width: 390, height: 844 }, "on", "pad"],
    ["portrait_overlay", { width: 390, height: 844 }, "overlay", "pad"],
    ["portrait_off", { width: 390, height: 844 }, "off", "bottom"],
    ["landscape_pad", { width: 844, height: 390 }, "on", "right"],
    ["landscape_overlay", { width: 844, height: 390 }, "overlay", "right"],
    ["landscape_off", { width: 844, height: 390 }, "off", "right"],
  ];
  for (const [name, viewport, padMode, dock] of layouts) {
    const { context, page } = await newPage({ viewport, mobile: true, dpr: 3, prefs: { pad: padMode, padSet: true } });
    await openGame(page, opt.gba);
    await page.waitForTimeout(10000);
    await setLook(page, "crt");
    await closePanel(page);
    await page.waitForTimeout(200);
    const before = await rectOf(page, "#screen");
    await shot(page, `m_${name}_closed`);
    const tool = await page.evaluate(() => {
      const b = document.getElementById("btnFilter");
      return { visible: b.offsetParent !== null, inMenu: Boolean(b.closest(".bar__group--files")) };
    });
    await page.evaluate(() => window.webgba.filter.open());
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ dock: document.body.dataset.fp, pad: getComputedStyle(document.getElementById("pad")).display, padOn: window.webgba.pad.enabled }));
    const screen = await rectOf(page, "#screen");
    const panel = await rectOf(page, "#filterPanel");
    const radius = await page.evaluate(() => window.webgba.filter.radius());
    await shot(page, `m_${name}_open`);
    let geo = false;
    if (dock === "pad") geo = screen.w === before.w && screen.h === before.h && panel.y >= screen.y + screen.h && panel.w === viewport.width;
    if (dock === "bottom") geo = screen.w >= 240 && screen.w <= viewport.width - 16 && panel.y >= screen.y + screen.h && panel.h >= Math.round(viewport.height * 0.45) - 2;
    if (dock === "right") geo = panel.w === 340 && screen.x + screen.w <= panel.x && screen.w >= 240 && screen.h >= 160;
    ok(`휴대폰 ${name}: Dock ${dock}·가상 버튼 숨김·게임 화면 배치`, st.dock === dock && (st.pad === "none" || !st.padOn) && geo, JSON.stringify({ st, before, screen, panel }));
    ok(`휴대폰 ${name}: CRT 테두리 반경 유지(${radius.toFixed(1)}px)`, radius > 0);
    notes[`tool_${name}`] = tool;
    if (name === "portrait_pad") {
      const hover = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
      await page.click('[data-fid="sec-display"]');
      const chip = page.locator('[data-fid="c-display-lcd"]');
      const box = await chip.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await page.click('[data-fid="c-display-crt"]');
      await page.waitForTimeout(200);
      const bg = await page.evaluate(() => {
        const on = document.querySelector('[data-fid="c-display-lcd"]');
        const off = document.querySelector('[data-fid="c-display-dot"]');
        return [getComputedStyle(on).backgroundColor, getComputedStyle(off).backgroundColor];
      });
      ok("휴대폰: hover 미적용 기기(터치) — 탭한 칩에 hover 색 잔상 없음", !hover && bg[0] === bg[1], `${hover} ${bg.join(" / ")}`);
      await shot(page, "m_hover_after_tap");
      await page.evaluate(() => history.back());
      await page.waitForTimeout(700);
      const back = await page.evaluate(() => ({ open: window.webgba.filter.isOpen, view: document.body.dataset.view, running: window.webgba.player.running }));
      ok("휴대폰: 뒤로 가기 → 패널 닫기(게임 유지)", !back.open && back.view === "game" && back.running, JSON.stringify(back));
    }
    ok(`휴대폰 ${name}: 오류 없음`, !page.errors.length, page.errors.slice(0, 3).join(" | "));
    await context.close();
  }
  // 무거운 필터 안내 + 가볍게 변경
  {
    const { context, page } = await newPage({ viewport: { width: 844, height: 390 }, mobile: true, dpr: 3 });
    await openGame(page, opt.gba);
    await page.waitForTimeout(3000);
    await setLook(page, "vector");
    await page.waitForTimeout(200);
    const ban = await page.evaluate(() => [...document.querySelectorAll(".fban__title")].map((n) => n.textContent));
    await shot(page, "m_heavy");
    await page.click('[data-fid="lighten"]');
    const s = await dbg(page);
    ok("휴대폰: 무거움(벡터 그림) → 안내 + 「가볍게 변경」 → 매끄럽게(OmniScale)", ban.includes("휴대폰에서 끊길 수 있음") && s.store.global.look.scale.id === "smooth" && s.store.global.look.scale.d.smooth.method === "omni", ban.join(","));
    await context.close();
  }
}

// ---------------------------------------------------------------- 8. 설명서 게임 추천(display.filter)
if (want("recommend") && opt.gba) {
  const { context, page } = await newPage();
  await openGame(page, opt.gba);
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.webgba.state.game.filter = { display: { id: "crt", detail: { curve: 15, corner: 20, scan: 70 } } };
    window.webgba.filter.open();
  });
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => ({ first: document.querySelector(".ptile")?.dataset.fid, title: document.querySelector(".fgroup .fgroup__title")?.textContent, applied: window.webgba.filter.debug().store.global.look.display.id }));
  ok("게임 추천: 설명서 display.filter → 프리셋 첫 칸 「게임 추천」(자동 적용 아님)", s.first === "p-rec" && s.applied === "none", JSON.stringify(s));
  await page.click('[data-fid="p-rec"]');
  const d = await dbg(page);
  ok("게임 추천: 칸 선택 시 추천값 적용", d.store.global.look.display.id === "crt" && d.store.global.look.display.d.crt.curve === 15, "");
  await shot(page, "r1_recommend");
  await context.close();
}

await browser.close();
main.srv.close();
baseSrv?.srv.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n결과 ${results.length - failed.length}/${results.length} 통과`);
fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify({ results, notes }, null, 2));
process.exit(failed.length ? 1 : 0);
