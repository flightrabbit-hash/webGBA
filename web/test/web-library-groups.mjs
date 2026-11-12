// 웹 라이브러리 그룹(전체·에뮬·아케이드·모바일)·롬팩 3D·저장소 줄 시험(로컬 전용 — 업데이트 목록은 브라우저 안에서 가로챈 흉내, 실제 R2 안 씀).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-library-groups.mjs --dist <웹 빌드> --shots <캡처 폴더> [--base <수정 전 웹 빌드>] [--out <결과 json>]
// 1) 목록 주입: 등록된 .wgba 에 index.json signed.groups 의 group·category 를 넣음(목록 1번), 목록에 없는 .wgba·.gba·.gb·.gbc 기본값(에뮬)
// 2) 그룹 버튼(초록 버튼 라디오 4개): 고른 그룹만 책장에 · 기기에 기억(다시 열어도) · 빈 그룹 안내 · 세 언어 글 · 잉크 세로 가운데 · 같은 줄 위아래 일치
// 3) 카테고리는 저장만(목록·꺼낸 칸에 배지 없음) · 가져오기(importGame)·업데이트 때 값 저장
// 4) 롬팩 3D(옆면 + 비스듬한 앞면): 틈 없이 붙음 · 롬팩 사이 0 · 줄 끝 앞면 전체 · 정수 배율·가장 가까운 점 · 좌우 여백 같음 · 테두리 상자 안 굴림, 롬 많을 때 열기 시간·굴림 프레임(--base 와 비교)
// 5) 하단 한 줄 "브라우저 저장소 …(webGBA …) / …", "이 앱에서만" 안내 없음
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { publicOf, signText } from "../../tools/lib/update-cmds.mjs";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WEB_PORT = 8798;
const BASE_PORT = 8799;
const WEB = `http://127.0.0.1:${WEB_PORT}/`;
const INDEX_URL = "http://127.0.0.1:9599/index.json";
fs.mkdirSync(opt.shots, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PUB = publicOf(privateKey);
const GROUPS = {
  "dev.example.star": { group: "emu", category: "GBA" },
  "dev.example.arc": { group: "arcade", category: "CPS1" },
  "dev.example.neo": { group: "arcade", category: "NeoGeo" },
  "dev.example.mob": { group: "mobile", category: "Android" },
  "dev.example.arc2": { group: "arcade", category: "PGM" },
};
const signedText = JSON.stringify({ time: "2026-11-12T00:00:00Z", feeds: {}, groups: GROUPS });
const INDEX_TEXT = JSON.stringify({ wgbaIndex: 1, signed: signedText, signature: signText(signedText, privateKey), feeds: {} });

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
const wgbaOf = async (id, version, name) => Array.from((await packWgba({ wasm: tinyWasm(64), manifest: { wgba: 1, id, version, name, runtime: "webapi", input: { preset: "gba" } }, images: {} })).bytes);

const children = [];
function serve(dir, port) {
  const child = spawn(process.execPath, [path.join(repo, "web", "tools", "serve.mjs"), dir, String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  return new Promise((resolve) => child.stdout.once("data", resolve));
}
await serve(opt.dist, WEB_PORT);
if (opt.base) await serve(opt.base, BASE_PORT);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ url = WEB, lang = "ko", width = 390, height = 844, dpr = 2, index = true } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: dpr });
  const hits = [];
  await context.route(INDEX_URL, (route) => {
    hits.push(route.request().url());
    route.fulfill({ status: 200, contentType: "application/json", body: INDEX_TEXT });
  });
  await context.addInitScript(
    ([lang, index, url, key]) => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      if (window !== window.top) return;
      if (index) localStorage.setItem("webgba.updateTest", JSON.stringify({ index: { url, key } }));
      const prefs = JSON.parse(localStorage.getItem("webgba.prefs") ?? "{}");
      if (prefs.lang !== lang) localStorage.setItem("webgba.prefs", JSON.stringify({ ...prefs, lang }));
    },
    [lang, index, INDEX_URL, PUB],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(url);
  await ready(page);
  return { context, page, errors, hits };
}

const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });

// 1KB 가짜 기록(롬 아님) + 코드로 그린 라벨(48×32 격자, k = 2)
async function seed(page, extra = 0) {
  await page.evaluate(async (extra) => {
    const s = window.webgba.store;
    const png = async (w, h, paint) => {
      const c = new OffscreenCanvas(w, h);
      paint(c.getContext("2d"));
      return new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    };
    const label = (sky, ground, sun) =>
      png(96, 64, (g) => {
        g.fillStyle = sky;
        g.fillRect(0, 0, 96, 64);
        g.fillStyle = ground;
        g.fillRect(0, 44, 96, 20);
        g.fillStyle = sun;
        g.fillRect(64, 10, 16, 16);
      });
    const fake = (n) => new Uint8Array(1024 + n);
    let t = Date.now();
    const opened = (id) => s.patch(s.romKey(id), { opened: (t -= 1000) });
    const games = [
      ["star", "dev.example.star", "Star Garden", "#2f6f5e", ["#172259", "#58c070", "#ffe39a"]],
      ["arc", "dev.example.arc", "Three Wonders", "#c0392b", ["#3a1046", "#e0b040", "#f2f4fa"]],
      ["neo", "dev.example.neo", "Metal Slug", "#2c3e50", ["#5d4a2e", "#8c6b3f", "#d94b2b"]],
      ["mob", "dev.example.mob", "Pocket Run", "#7a3bb0", ["#1e5aa8", "#f2f4fa", "#ffd23f"]],
      ["unk", "dev.example.unk", "Local Test", "#d9a02b", null],
    ];
    for (const [id, gameId, title, color, art] of games) {
      const carts = art ? [{ part: "label", bytes: await label(...art), format: "png", width: 96, height: 64 }] : [];
      await s.putGame({ id, name: `${id}.wgba`, file: `${id}.wgba`, type: "wgba", gameId, version: "1.0.0", build: "a".repeat(64), title, shortName: "", author: "", romSha1: "", cart: { color, ...(art ? { label: { format: "png", width: 96, height: 64, scale: 2 } } : {}) } }, fake(id.length), { carts });
      await opened(id);
    }
    const roms = [["gba", "Moon Hopper.gba", "gba"], ["gb", "Pixel Quest.gb", "gb"], ["gbc", "Neon Drift.gbc", "gbc"], ["wasm", "homebrew-demo.wasm", "wasm"]];
    for (let i = 0; i < extra; i++) roms.push([`x${i}`, `Extra ${i + 1}.${["gba", "gb", "gbc"][i % 3]}`, ["gba", "gb", "gbc"][i % 3]]);
    for (const [id, name, type] of roms) {
      await s.putRom({ id, name, file: name, type, ...(type === "gbc" ? { color: "dual" } : {}) }, fake(10));
      await opened(id);
    }
    await s.putSave("gba", new Uint8Array(4096), "Moon Hopper.gba");
  }, extra);
}

const records = (page) => page.evaluate(async () => Object.fromEntries((await window.webgba.store.list("rom")).map((r) => [r.id, { group: r.group ?? "", category: r.category ?? "", version: r.version ?? "" }])));

async function openLibrary(page) {
  await page.evaluate(() => window.webgba.openSheet("library"));
  await page.waitForSelector("#sheet:not([hidden]) .lib__case");
  await page.waitForTimeout(400);
}

const shelfIds = (page) => page.$$eval(".lib__case .spine[data-key]", (nodes) => nodes.map((n) => n.dataset.key.replace(/^rom:/, "")));
const pickGroup = async (page, id) => {
  await page.click(`.lib__groups [data-group="${id}"]`);
  await page.waitForFunction((id) => document.querySelector(`.lib__groups [data-group="${id}"]`)?.getAttribute("aria-checked") === "true", id);
  await page.waitForTimeout(300);
};

const INK_THRESHOLD = 48;
function inkCheck(image, dpr, box) {
  const x0 = Math.round((box.left + 2) * dpr);
  const x1 = Math.round((box.right - 2) * dpr);
  const y0 = Math.round(box.top * dpr) + 1;
  const y1 = Math.round(box.bottom * dpr) - 1;
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const counts = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * image.width + x) * 4;
    const key = (image.data[o] << 16) | (image.data[o + 1] << 8) | image.data[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bg = 0;
  let best = -1;
  for (const [key, n] of counts) if (n > best) [bg, best] = [key, n];
  let first = -1;
  let last = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      if (Math.max(Math.abs(image.data[o] - (bg >> 16)), Math.abs(image.data[o + 1] - ((bg >> 8) & 255)), Math.abs(image.data[o + 2] - (bg & 255))) > INK_THRESHOLD) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  if (first < 0) return null;
  return { top: (first - y0) / dpr, bottom: (y1 - 1 - last) / dpr };
}

// 칸 안 글(잉크)이 세로 가운데인지: 위·아래 여백 차이 0(홀수로 남는 1 기기 픽셀만 허용)
async function inkCenter(page, name, selector) {
  const dpr = await page.evaluate(() => devicePixelRatio);
  const image = decodePng(await page.screenshot());
  const boxes = await page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((n) => n.offsetParent !== null).slice(0, 24).map((n) => {
    const s = getComputedStyle(n);
    const [tx = 0, ty = 0] = s.translate && s.translate !== "none" ? s.translate.split(/\s+/).map((v) => parseFloat(v) || 0) : [];
    const r = n.getBoundingClientRect();
    return { text: n.textContent.trim().slice(0, 8), left: r.left - tx + parseFloat(s.borderLeftWidth), right: r.right - tx - parseFloat(s.borderRightWidth), top: r.top - ty + parseFloat(s.borderTopWidth), bottom: r.bottom - ty - parseFloat(s.borderBottomWidth) };
  }), selector);
  let worst = 0;
  const each = [];
  for (const box of boxes) {
    const m = inkCheck(image, dpr, box);
    if (!m) continue;
    const diff = Math.abs(m.top - m.bottom);
    worst = Math.max(worst, diff);
    each.push(`${box.text}:${m.top}/${m.bottom}`);
  }
  ok(`${name} 잉크 세로 가운데(${each.length}개)`, each.length > 0 && worst <= 1 / dpr + 0.001, `최대 차이 ${worst}px · ${each.slice(0, 8).join(" ")}`);
}

const spread = (list, key) => Math.max(...list.map((b) => b[key])) - Math.min(...list.map((b) => b[key]));

/* ── 1. 목록 주입 · 그룹 버튼 · 카테고리 · 롬팩 3D (한국어 390x844) ── */
{
  const { context, page, errors, hits } = await open();
  await seed(page, 9);
  ok("시작: 등록 직후 group·category 없음", Object.values(await records(page)).every((r) => !r.group));
  await page.reload();
  await ready(page);
  await page.waitForFunction(async () => (await window.webgba.store.list("rom")).some((r) => r.group), null, { timeout: 15000 }).catch(() => {});
  const rec = await records(page);
  ok("목록 주입: .wgba 에 index.json 의 group·category 저장", rec.arc.group === "arcade" && rec.arc.category === "CPS1" && rec.neo.category === "NeoGeo" && rec.mob.group === "mobile" && rec.star.group === "emu" && rec.star.category === "GBA", JSON.stringify({ arc: rec.arc, neo: rec.neo, mob: rec.mob, star: rec.star }));
  ok("목록에 없는 .wgba·.gba·.gb·.gbc·.wasm 은 저장 값 없음(표시 기본값 = 에뮬)", !rec.unk.group && !rec.gba.group && !rec.gb.group && !rec.wasm.group, JSON.stringify({ unk: rec.unk, gba: rec.gba }));
  ok("목록 요청 1번(다시 열어도 그 실행에서 1번)", hits.length === 1, `${hits.length}번`);

  await openLibrary(page);
  const bar = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".lib__groups .btn")];
    const head = document.querySelector(".lib__shelfHead").getBoundingClientRect();
    const box = document.querySelector(".lib__groups").getBoundingClientRect();
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--on)";
    document.body.append(probe);
    const green = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { role: document.querySelector(".lib__groups").getAttribute("role"), green, items: nodes.map((n) => ({ id: n.dataset.group, role: n.getAttribute("role"), checked: n.getAttribute("aria-checked"), label: n.textContent, title: n.title, bg: getComputedStyle(n).backgroundColor, side: getComputedStyle(n).borderBottomColor, top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom, height: n.getBoundingClientRect().height })), below: box.top >= head.bottom - 0.5, count: document.querySelector(".lib__count").textContent };
  });
  const greenish = (rgb) => {
    const unit = rgb.startsWith("color(") ? 255 : 1;
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map((v) => Number(v) * unit);
    return g > r + 10 && g > b;
  };
  ok("그룹 버튼: 정렬 줄 하단 · 라디오 4개(전체·에뮬·아케이드·모바일) · 기본 전체", bar.role === "radiogroup" && bar.below && bar.items.map((i) => i.label).join() === "전체,에뮬,아케이드,모바일" && bar.items.every((i) => i.role === "radio" && i.title) && bar.items.map((i) => i.checked).join() === "true,false,false,false", JSON.stringify(bar.items.map((i) => `${i.label}:${i.checked}`)));
  ok("그룹 버튼 초록: 선택 = 테마 초록(--on) · 선택 안 됨 = 옅은 초록 버튼(구분됨) · 하단 그림자 짙은 초록", bar.items[0].bg === bar.green && bar.items.slice(1).every((i) => i.bg !== bar.green && greenish(i.bg)) && bar.items.every((i) => greenish(i.side)), JSON.stringify({ green: bar.green, bg: bar.items.map((i) => i.bg), side: bar.items.map((i) => i.side) }));
  ok("그룹 버튼 같은 줄 상단·하단·높이 일치(px 차이 0)", spread(bar.items, "top") === 0 && spread(bar.items, "bottom") === 0 && spread(bar.items, "height") === 0, `상단 ${spread(bar.items, "top")} · 하단 ${spread(bar.items, "bottom")}`);
  const all = await shelfIds(page);
  ok("전체 = 등록한 롬 모두", all.length === 18 && bar.count.includes("18"), `${all.length}개 · ${bar.count}`);

  ok("카테고리 배지 표시 없음(책장·꺼낸 칸)", !(await page.$(".spine__tag, .lib__cat")) && !/CPS1|NeoGeo|Android/.test(await page.$eval(".sheet__body", (n) => n.textContent)));
  const shelf = await page.evaluate(() => {
    const caseNode = document.querySelector(".lib__case");
    const c = caseNode.getBoundingClientRect();
    const cs = getComputedStyle(caseNode);
    const column = (canvas, x) => {
      const data = canvas.getContext("2d").getImageData(x, 0, 1, canvas.height).data;
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < canvas.height; y++)
        if (data[y * 4 + 3]) {
          if (top < 0) top = y;
          bottom = y + 1;
        }
      return [top, bottom];
    };
    return {
      overflow: caseNode.scrollWidth - caseNode.clientWidth,
      inner: (() => {
        const sc = caseNode.parentElement;
        const r = sc.getBoundingClientRect();
        const ss = getComputedStyle(sc);
        return { l: r.left + sc.clientLeft + parseFloat(ss.paddingLeft), r: r.left + sc.clientLeft + sc.clientWidth - parseFloat(ss.paddingRight) };
      })(),
      box: (() => {
        const sc = caseNode.parentElement;
        const ss = getComputedStyle(sc);
        return { scrolls: ss.overflowY === "auto", border: [ss.borderTopWidth, ss.borderBottomWidth, ss.borderLeftWidth, ss.borderRightWidth].map(parseFloat), caseShadow: cs.boxShadow };
      })(),
      slots: [...document.querySelectorAll(".lib__case .spine[data-key]")].map((slot) => {
        const artNode = slot.querySelector(".spine__art");
        const art = artNode.getBoundingClientRect();
        const spineCanvas = artNode.querySelector("canvas");
        const sideNode = slot.querySelector(".spine__side");
        const side = sideNode.getBoundingClientRect();
        const box = slot.getBoundingClientRect();
        const scale = art.width / spineCanvas.width;
        let right = spineCanvas.width;
        while (right > 0 && column(spineCanvas, right - 1)[0] < 0) right--;
        const edge = column(spineCanvas, right - 1);
        const near = column(sideNode, 0);
        return { inCase: box.left >= c.left - 0.5 && box.right <= c.right + 0.5, overlap: art.left + right * scale - side.left, nearSame: near[0] === edge[0] && near[1] === edge[1], width: Math.abs(box.width - (art.width + Number(artNode.dataset.side))) < 0.5 && side.right >= box.right - 0.5, slotRight: box.right, ratio: side.width / sideNode.width, ratioH: side.height / sideNode.height, pixel: getComputedStyle(sideNode).imageRendering, left: box.left, right: side.right, top: Math.round(box.top) };
      }),
    };
  });
  const rows = [...new Set(shelf.slots.map((s) => s.top))].map((top) => shelf.slots.filter((s) => s.top === top).length);
  ok("롬팩 3D: 앞면이 옆면 외곽선 1칸에 겹쳐 틈 0 · 맞닿는 세로 줄 높이 같음(기본·GB 모양·그림 롬팩 모두)", shelf.slots.every((s) => s.overlap > 0 && s.overlap <= 4.01 && s.nearSame), JSON.stringify([...new Set(shelf.slots.map((s) => `${+s.overlap.toFixed(2)}/${s.nearSame}`))]));
  ok("롬팩 3D: 칸 폭 = 옆면 + 보이는 앞면(앞면은 칸 끝까지 이상) · 정수 배율 · 가장 가까운 점", shelf.slots.every((s) => s.width && Number.isInteger(+s.ratio.toFixed(3)) && Math.abs(s.ratio - s.ratioH) < 0.001 && s.pixel === "pixelated"), JSON.stringify([...new Set(shelf.slots.map((s) => `${s.ratio}/${s.pixel}`))]));
  const firstRow = shelf.slots.filter((s) => s.top === shelf.slots[0].top);
  const margins = [firstRow[0].left - shelf.inner.l, shelf.inner.r - firstRow[firstRow.length - 1].right];
  const gaps = firstRow.slice(1).map((s, i) => +(s.left - firstRow[i].slotRight).toFixed(2));
  ok("롬팩 사이 여백 0(다음 롬팩 옆면이 앞 롬팩 앞면 위에) · 줄 끝 롬팩은 앞면 전체가 상자 안", gaps.every((g) => g === 0) && firstRow[firstRow.length - 1].right <= shelf.inner.r + 0.5, `사이 ${gaps.join(",")}`);
  ok("롬팩 목록 = 테두리 상자 안에서만 굴림(상하좌우 테두리 · 책장 자체 테두리 없음)", shelf.box.scrolls && shelf.box.border.every((w) => w > 0) && shelf.box.caseShadow === "none", JSON.stringify(shelf.box));
  ok("롬팩 3D: 책장 밖 넘침 0 · 390 폭 한 줄 5개 · 좌우 여백 같음(마지막 앞면까지 보임)", shelf.overflow <= 0 && shelf.slots.every((s) => s.inCase) && rows[0] === 5 && Math.abs(margins[0] - margins[1]) <= 0.5, `줄마다 ${rows.join(",")} · 넘침 ${shelf.overflow} · 여백 ${margins.map((m) => m.toFixed(1)).join("/")}`);
  await page.screenshot({ path: path.join(opt.shots, "라이브러리_롬팩3D_390x844.png") });
  await inkCenter(page, "그룹 버튼", ".lib__groups .btn");

  await page.click('.spine[data-key="rom:arc"]');
  await page.waitForFunction(() => document.querySelector(".lib__card")?.dataset.key === "rom:arc");
  await page.waitForTimeout(300);
  const meta = await page.$eval(".lib__card .lib__meta", (n) => n.textContent);
  ok("꺼낸 칸: 배지 없이 메타 글 그대로(v1.0.0 · .wgba · 크기)", /^v1\.0\.0 · \.wgba · /.test(meta) && !(await page.$(".lib__card .lib__cat")), meta);
  await inkCenter(page, "꺼낸 칸 메타 글", ".lib__card .lib__meta");

  await pickGroup(page, "arcade");
  const arcade = await shelfIds(page);
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem("webgba.prefs")).libGroup);
  ok("아케이드 → 아케이드 게임만 · 기기에 기억(prefs.libGroup)", arcade.sort().join() === "arc,neo" && pref === "arcade", `${arcade.join()} · ${pref}`);
  await page.screenshot({ path: path.join(opt.shots, "라이브러리_그룹_아케이드_390x844.png") });
  await page.reload();
  await ready(page);
  await openLibrary(page);
  const again = await shelfIds(page);
  const checked = await page.$eval('.lib__groups [aria-checked="true"]', (n) => n.dataset.group);
  ok("다시 열어도 아케이드 그대로", again.sort().join() === "arc,neo" && checked === "arcade", `${again.join()} · ${checked}`);
  await pickGroup(page, "mobile");
  ok("모바일 → 모바일 게임만", (await shelfIds(page)).join() === "mob");
  await pickGroup(page, "emu");
  const emu = (await shelfIds(page)).sort();
  ok("에뮬 → 목록 emu + 목록에 없는 .wgba + .gba·.gb·.gbc·.wasm", emu.join() === ["star", "unk", "gba", "gb", "gbc", "wasm", ...Array.from({ length: 9 }, (_, i) => `x${i}`)].sort().join(), emu.join());
  await page.evaluate(() => window.webgba.store.remove("rom:mob"));
  await pickGroup(page, "mobile");
  const empty = await page.evaluate(() => ({ text: document.querySelector(".lib__empty")?.textContent ?? "", spines: document.querySelectorAll(".lib__case .spine[data-key]").length, card: Boolean(document.querySelector(".lib__card")) }));
  ok("빈 그룹 → 안내 글 · 롬팩 0 · 꺼낸 칸 없음", empty.text === "이 그룹에는 게임이 없습니다." && empty.spines === 0 && !empty.card, JSON.stringify(empty));
  await pickGroup(page, "all");

  // 가져오기·업데이트 때 값 저장
  const arc2 = await wgbaOf("dev.example.arc2", "1.0.0", "Arcade Two");
  const arcNew = await wgbaOf("dev.example.arc", "1.1.0", "Three Wonders");
  const fresh = await wgbaOf("dev.example.fresh", "1.0.0", "Fresh Game");
  const runHits = hits.length;
  const imported = await page.evaluate(async ([a, b, c]) => {
    const one = async (name, bytes) => {
      const { meta } = await window.webgba.importGame(name, new Uint8Array(bytes));
      return { id: meta.gameId, group: meta.group ?? "", category: meta.category ?? "", version: meta.version };
    };
    return [await one("arc2.wgba", a), await one("arc.wgba", b), await one("fresh.wgba", c)];
  }, [arc2, arcNew, fresh]);
  ok("가져오기: 목록에 있는 게임은 바로 group·category 저장", imported[0].group === "arcade" && imported[0].category === "PGM", JSON.stringify(imported[0]));
  ok("업데이트(같은 게임 새 버전): group·category 유지", imported[1].version === "1.1.0" && imported[1].group === "arcade" && imported[1].category === "CPS1", JSON.stringify(imported[1]));
  ok("목록에 없는 새 게임: 값 없음(에뮬)", !imported[2].group, JSON.stringify(imported[2]));
  ok("가져오기(목록에 없는 게임 포함) 뒤에도 그 실행의 목록 요청 그대로(추가 0번)", hits.length === runHits, `실행 시작 ${runHits}번 → ${hits.length}번`);

  // 하단 한 줄
  await page.evaluate(() => window.webgba.renderSheet());
  await page.waitForTimeout(400);
  const foot = await page.evaluate(() => ({ notes: [...document.querySelectorAll(".sheet__body .note")].map((n) => ({ cls: n.className, text: n.textContent, title: n.title === n.textContent, ellipsis: getComputedStyle(n).textOverflow, over: n.scrollWidth - n.clientWidth, last: n === n.parentElement.lastElementChild && n.parentElement.classList.contains("lib__shelf") })), old: document.querySelector(".sheet__body").textContent.includes("이 앱에서만") }));
  ok("하단: \"브라우저 저장소 현재(webGBA 사용) / 전체\" 한 줄만(책장 굴림 칸 밖 맨 아래) · 게임 수·총용량·\"이 앱에서만\" 없음", foot.notes.length === 1 && foot.notes[0].cls.includes("lib__storage") && foot.notes[0].last && foot.notes[0].title && foot.notes[0].ellipsis === "ellipsis" && /^브라우저 저장소 \S+\(webGBA \S+\) \/ \S+$/.test(foot.notes[0].text) && foot.notes[0].over <= 0 && !foot.old, JSON.stringify(foot));
  await inkCenter(page, "하단 저장소 줄", ".lib__storage");
  await page.screenshot({ path: path.join(opt.shots, "라이브러리_저장소줄_390x844.png") });
  ok("페이지 오류 없음(한국어 390x844)", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ── 2. 세 언어 글 · 좁은 화면 · 가로 화면 ── */
for (const view of [{ lang: "en", width: 320, height: 568, words: "All,Emulator,Arcade,Mobile", storage: /^Storage \S+ \(webGBA \S+\) \/ \S+$/ }, { lang: "ja", width: 844, height: 390, words: "すべて,エミュ,アーケード,モバイル", storage: /^保存領域 \S+\(webGBA \S+\) \/ \S+$/ }]) {
  const key = `${view.lang} ${view.width}x${view.height}`;
  const { context, page, errors } = await open({ lang: view.lang, width: view.width, height: view.height, index: false });
  await seed(page, 9);
  await openLibrary(page);
  const info = await page.evaluate(() => {
    const body = document.querySelector(".sheet__body").getBoundingClientRect();
    const bar = document.querySelector(".lib__groups").getBoundingClientRect();
    const caseNode = document.querySelector(".lib__case");
    return {
      labels: [...document.querySelectorAll(".lib__groups .btn__label")].map((n) => n.textContent).join(),
      clipped: [...document.querySelectorAll(".lib__groups .btn__label, .lib__shelfHead .btn__label")].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent),
      inside: bar.left >= body.left - 0.5 && bar.right <= body.right + 0.5,
      overflow: caseNode.scrollWidth - caseNode.clientWidth,
      storage: document.querySelector(".lib__storage")?.textContent ?? "",
      storageOver: (() => { const n = document.querySelector(".lib__storage"); return n ? n.scrollWidth - n.clientWidth : 0; })(),
      tops: [...document.querySelectorAll(".lib__groups .btn")].map((n) => n.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })),
    };
  });
  ok(`${key} 그룹 버튼 글(${view.words}) · 잘림 0 · 시트 안 · 책장 넘침 0`, info.labels === view.words && info.clipped.length === 0 && info.inside && info.overflow <= 0, JSON.stringify({ labels: info.labels, clipped: info.clipped, overflow: info.overflow }));
  ok(`${key} 그룹 버튼 상단·하단 일치`, spread(info.tops, "top") === 0 && spread(info.tops, "bottom") === 0);
  ok(`${key} 하단 저장소 한 줄 글`, view.storage.test(info.storage) && info.storageOver <= 0, info.storage);
  await inkCenter(page, `${key} 그룹 버튼`, ".lib__groups .btn");
  ok(`${key} 페이지 오류 없음`, errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ── 3. 롬 많을 때(80개): 열기 시간 · 굴림 프레임 — 수정 전 빌드와 1번씩 ── */
async function perf(url, name) {
  const { context, page } = await open({ url, index: false });
  await seed(page, 76);
  const t0 = Date.now();
  await page.evaluate(() => window.webgba.openSheet("library"));
  await page.waitForFunction(() => document.querySelectorAll(".lib__case .spine[data-key]").length >= 80, null, { timeout: 30000 });
  const openMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => {
    const note = document.querySelector(".lib__storage");
    if (!note) return null;
    const r = note.getBoundingClientRect();
    const body = document.querySelector(".sheet__body").getBoundingClientRect();
    const scroller = document.querySelector(".lib__scroll");
    return { inside: r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5 && r.height > 0, scrolls: scroller.scrollHeight > scroller.clientHeight };
  });
  const frames = await page.evaluate(
    () =>
      new Promise((done) => {
        const scroller = document.querySelector(".lib__scroll");
        const gaps = [];
        let last = performance.now();
        let n = 0;
        const step = (now) => {
          gaps.push(now - last);
          last = now;
          scroller.scrollTop += 14;
          if (++n < 120) requestAnimationFrame(step);
          else done({ gaps: gaps.slice(2), end: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight });
        };
        requestAnimationFrame(step);
      }),
  );
  const sorted = [...frames.gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const worst = sorted[sorted.length - 1];
  await context.close();
  return { name, openMs, p95: +p95.toFixed(1), worst: +worst.toFixed(1), scrolled: Math.round(frames.end), shown };
}
const after = await perf(WEB, "수정 후");
const before = opt.base ? await perf(`http://127.0.0.1:${BASE_PORT}/`, "수정 전") : null;
ok("롬 80개(책장 굴림): 하단 저장소 줄은 굴리지 않아도 시트 안에 보임", after.shown?.inside && after.shown.scrolls, JSON.stringify(after.shown));
ok(`롬 80개: 굴림 프레임 p95 ${after.p95}ms · 최대 ${after.worst}ms · 열기 ${after.openMs}ms${before ? ` (수정 전 p95 ${before.p95}ms · 최대 ${before.worst}ms · 열기 ${before.openMs}ms)` : ""}`, after.p95 <= 20 && after.worst <= 50 && (!before || after.p95 <= before.p95 + 4), JSON.stringify({ after, before }));

await browser.close();
for (const child of children) child.kill();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}개 / ${results.length}` : `모두 통과 ${results.length}개`);
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
