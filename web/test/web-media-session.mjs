// 웹 잠금화면 재생 위젯(Media Session) 시험(로컬 전용, 결정 282). 흉내 navigator.mediaSession·MediaMetadata 로 기록을 받아 본다.
// 게임 열기·바꾸기·닫기 때 제목·아래 줄·그림(크기·정수 배·가운데·바탕 = 롬팩 색, 라벨 → 앞면 → webGBA 아이콘),
// play/pause → 게임 일시정지 경로·playbackState, 숨김 중 시스템이 소리를 멈춤(suspended) → 일시정지, 화면 언어 = 제목 언어,
// Tauri(window.__TAURI__) 에서는 설정하지 않음. 시험 .wgba 는 저장소 예제(hello-webapi)로 메모리에서 묶는다(롬 없음).
//   node web/test/web-media-session.mjs <주소> [--chrome <chrome.exe>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const URL_BASE = args[0];
const opt = {};
for (let i = 1; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const EXAMPLE = fileURLToPath(new URL("../../docs/wgba/examples/hello-webapi/", import.meta.url));
const read = (name) => fs.readFileSync(path.join(EXAMPLE, name));
const baseManifest = JSON.parse(read("manifest.json").toString("utf8"));
const CART_COLOR = baseManifest.cart.color;
const ICONS = ["/icons/icon-192.png|192x192", "/icons/icon-512.png|512x512"];
const ALL_SIZES = [96, 128, 192, 256, 384, 512];

async function pack(patch, images) {
  const manifest = patch(structuredClone(baseManifest));
  const res = await packWgba({ wasm: read("game.wasm"), manifest, images });
  return Buffer.from(res.bytes);
}

const label = new Uint8Array(read("cart/label.png"));
const front = new Uint8Array(read("cart/front.png"));
const spine = new Uint8Array(read("cart/spine.png"));
const FILES = {
  "art.wgba": await pack((m) => m, { label, front, spine }),
  "front.wgba": await pack((m) => ({ ...m, id: "com.example.hellofront", name: { ko: "앞면 wgba", en: "Front wgba" }, shortName: "Front", cart: { color: CART_COLOR, front: m.cart.front } }), { front }),
  "plain.wgba": await pack((m) => ({ ...m, id: "com.example.helloplain", name: { ko: "그림 없음", en: "Plain" }, shortName: "Plain", cart: { color: CART_COLOR } }), {}),
};

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function checkArt(entry, source, color) {
  const size = Number(entry.sizes.split("x")[0]);
  if (!entry.src.startsWith("data:image/png;base64,") || entry.type !== "image/png") return `주소·형식 ${entry.src.slice(0, 30)} ${entry.type}`;
  const png = decodePng(Buffer.from(entry.src.slice(entry.src.indexOf(",") + 1), "base64"));
  if (png.width !== size || png.height !== size) return `크기 ${png.width}x${png.height} ≠ ${entry.sizes}`;
  const scale = Math.min(Math.floor(size / source.width), Math.floor(size / source.height));
  if (scale < 1) return `배율 ${scale}`;
  const w = source.width * scale;
  const h = source.height * scale;
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  const bg = hexRgb(color);
  let wrong = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      let want = bg;
      if (x >= ox && x < ox + w && y >= oy && y < oy + h) {
        const s = (Math.floor((y - oy) / scale) * source.width + Math.floor((x - ox) / scale)) * 4;
        if (source.data[s + 3] === 255) want = [source.data[s], source.data[s + 1], source.data[s + 2]];
      }
      if (png.data[o + 3] !== 255 || png.data[o] !== want[0] || png.data[o + 1] !== want[1] || png.data[o + 2] !== want[2]) wrong++;
    }
  return wrong ? `다른 픽셀 ${wrong}개(배율 ${scale}, 자리 ${ox},${oy})` : "";
}

function artReport(artwork, sourceBytes, color) {
  const source = decodePng(Buffer.from(sourceBytes));
  const want = ALL_SIZES.filter((size) => Math.min(Math.floor(size / source.width), Math.floor(size / source.height)) >= 1);
  const sizes = artwork.map((a) => a.sizes);
  const problems = artwork.map((a) => [a.sizes, checkArt(a, source, color)]).filter(([, p]) => p);
  const scale512 = Math.min(Math.floor(512 / source.width), Math.floor(512 / source.height));
  return { pass: sizes.join() === want.map((s) => `${s}x${s}`).join() && !problems.length, detail: `크기 ${sizes.join(",")} · 512 배율 ${scale512} · ${problems.length ? JSON.stringify(problems) : "모든 픽셀 = 원본 정수 배 + 롬팩 색 바탕"}` };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function openPage({ tauri = false, prefs = { lang: "ko" } } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript(
    ({ tauri, prefs }) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window !== window.top) return;
      localStorage.setItem("webgba.installHint", "1");
      if (prefs && !sessionStorage.getItem("media.seeded")) {
        localStorage.setItem("webgba.prefs", JSON.stringify(prefs));
        sessionStorage.setItem("media.seeded", "1");
      }
      if (tauri) window.__TAURI__ = {};
      const log = { metadata: [], states: [], handlers: {}, current: null, state: "none" };
      class FakeMetadata {
        constructor(init = {}) {
          this.title = init.title ?? "";
          this.artist = init.artist ?? "";
          this.album = init.album ?? "";
          this.artwork = (init.artwork ?? []).map((a) => ({ src: a.src, sizes: a.sizes ?? "", type: a.type ?? "" }));
        }
      }
      Object.defineProperty(window, "MediaMetadata", { value: FakeMetadata, configurable: true, writable: true });
      const fake = {
        get metadata() {
          return log.current;
        },
        set metadata(value) {
          log.current = value;
          log.metadata.push(value);
        },
        get playbackState() {
          return log.state;
        },
        set playbackState(value) {
          log.state = value;
          log.states.push(value);
        },
        setActionHandler(action, run) {
          if (run) log.handlers[action] = run;
          else delete log.handlers[action];
        },
      };
      Object.defineProperty(navigator, "mediaSession", { value: fake, configurable: true });
      window.__media = log;
    },
    { tauri, prefs },
  );
  await context.route("**/__media/*", (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    return FILES[name] ? route.fulfill({ status: 200, body: FILES[name], contentType: "application/octet-stream" }) : route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page };
}

async function openGame(page, name) {
  await page.evaluate(async (name) => {
    const data = new Uint8Array(await (await fetch(`/__media/${encodeURIComponent(name)}`)).arrayBuffer());
    await window.webgba.openFiles([new File([data], name)]);
  }, name);
  await page.waitForFunction(() => window.webgba.player.running, null, { timeout: 30000 });
}

const current = (page) =>
  page.evaluate(() => {
    const m = window.__media;
    const c = m.current;
    return { title: c?.title ?? null, artist: c?.artist ?? null, artwork: c?.artwork ?? [], state: m.state, count: m.metadata.length, handlers: Object.keys(m.handlers).sort() };
  });
const waitTitle = (page, title) => page.waitForFunction((title) => window.__media.current?.title === title, title, { timeout: 15000 });
const iconSet = (artwork) => artwork.map((a) => `${a.src}|${a.sizes}`).join() === ICONS.join();
const gameState = (page) => page.evaluate(() => ({ paused: window.webgba.player.paused, veil: !document.getElementById("pauseVeil").hidden, state: window.__media.state }));

{
  const { context, page } = await openPage();
  const start = await current(page);
  ok("열기 전: 제목 webGBA · 아래 줄 없음 · 그림 = webGBA 아이콘(192·512)", start.title === "webGBA" && start.artist === "" && iconSet(start.artwork), JSON.stringify(start));
  ok("동작은 play·pause 두 개만 등록 · 게임 없음 = playbackState none", start.handlers.join() === "pause,play" && start.state === "none", `${start.handlers.join()} · ${start.state}`);

  await openGame(page, "art.wgba");
  await waitTitle(page, "안녕 wgba");
  const art = await current(page);
  ok("게임 열기: 제목 = 설명서 이름(화면 언어 ko) · 아래 줄 = webGBA · playing", art.artist === "webGBA" && art.state === "playing", `${art.title} · ${art.artist} · ${art.state}`);
  const artCheck = artReport(art.artwork, label, CART_COLOR);
  ok("게임 열기: 그림 = cart.label(앞면·옆면도 있음) 정수 배 · 정사각형 가운데 · 바탕 = 롬팩 색 · 128 이하 + 192~512", artCheck.pass, artCheck.detail);

  await page.evaluate(() => window.__media.handlers.pause());
  const paused = await gameState(page);
  await page.evaluate(() => window.__media.handlers.play());
  const resumed = await gameState(page);
  ok("pause 동작 → 게임 일시정지(앱 안 일시정지 덮개) · paused, play → 다시 실행 · playing", paused.paused && paused.veil && paused.state === "paused" && !resumed.paused && !resumed.veil && resumed.state === "playing", JSON.stringify({ paused, resumed }));

  const system = await page.evaluate(() => {
    const p = window.webgba.player;
    const real = p.audio;
    const fake = { ac: { state: "interrupted" }, node: { port: { postMessage() {} } } };
    const snap = () => ({ paused: p.paused, state: window.__media.state });
    p.audio = fake;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    p.onAudioState(fake);
    const interrupted = snap();
    fake.ac.state = "suspended";
    p.onAudioState(fake);
    const suspended = snap();
    fake.ac.state = "running";
    p.onAudioState(fake);
    const running = snap();
    fake.ac.state = "suspended";
    p.onAudioState(fake);
    p.audio = real;
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    const back = { ...snap(), veil: !document.getElementById("pauseVeil").hidden };
    window.__media.handlers.play();
    return { interrupted, suspended, running, back, after: snap() };
  });
  ok(
    "숨김 중 시스템이 소리를 멈춤(suspended, 잠금화면 버튼) → 일시정지 · 다시(running) → 실행, interrupted(전화 등) = 그대로, 멈춘 채 돌아오면 일시정지 덮개 유지",
    !system.interrupted.paused && system.suspended.paused && system.suspended.state === "paused" && !system.running.paused && system.running.state === "playing" && system.back.paused && system.back.veil && !system.after.paused,
    JSON.stringify(system),
  );

  await openGame(page, "front.wgba");
  await waitTitle(page, "앞면 wgba");
  const fr = await current(page);
  const frCheck = artReport(fr.artwork, front, CART_COLOR);
  ok("게임 바꾸기(라벨 없음): 그림 = cart.front 정수 배(96 은 줄일 수 없어 뺌) · 제목 갱신 · playing", frCheck.pass && fr.artist === "webGBA" && fr.state === "playing", `${frCheck.detail} · ${fr.state}`);

  await openGame(page, "plain.wgba");
  await waitTitle(page, "그림 없음");
  const plain = await current(page);
  ok("게임 바꾸기(롬팩 그림 없음): 그림 = webGBA 아이콘 · 아래 줄 webGBA", iconSet(plain.artwork) && plain.artist === "webGBA" && plain.state === "playing", JSON.stringify(plain));

  await page.evaluate(() => window.webgba.closeGame());
  await waitTitle(page, "webGBA");
  const closed = await current(page);
  ok("게임 닫기: 제목 webGBA · 아이콘 · 아래 줄 없음 · playbackState none", iconSet(closed.artwork) && closed.artist === "" && closed.state === "none", JSON.stringify(closed));
  ok("페이지 오류 없음(ko)", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

{
  const { context, page } = await openPage({ prefs: { lang: "en" } });
  await openGame(page, "art.wgba");
  const title = await page
    .waitForFunction(() => window.__media.current?.artist === "webGBA" && window.__media.current.title, null, { timeout: 15000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  ok("화면 언어 en → 제목 = 설명서 en 이름", title === baseManifest.name.en, String(title));
  ok("페이지 오류 없음(en)", page.errors.length === 0, page.errors.join(" | "));
  await context.close();
}

{
  const { context, page } = await openPage({ tauri: true });
  await openGame(page, "art.wgba");
  await page.waitForTimeout(800);
  const none = await page.evaluate(() => ({ metadata: window.__media.metadata.length, states: window.__media.states.length, handlers: Object.keys(window.__media.handlers) }));
  ok("Tauri(window.__TAURI__): 메타데이터·playbackState·동작 모두 설정 안 함", none.metadata === 0 && none.states === 0 && none.handlers.length === 0, JSON.stringify(none));
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
