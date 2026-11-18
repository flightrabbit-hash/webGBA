// GPU 그리기 실행기(src-bundle/src/js/core/gpu-bridge.js, README 4.1.4) 단위 시험 — 형식별 UPLOAD(RGBA8·RGB10_A2·R16UI)와 READ.
// 롬·게임 없이 가짜 wasm 메모리(ArrayBuffer)에 명령 목록을 써서 GpuBridge.run 으로 실행하고, 텍스처 내용을 GL 로 읽어 원본과 비교한다.
// 원본 데이터는 메모리 끝에 딱 맞게 둔다(필요한 바이트보다 짧게 잡으면 텍스처가 비고 GL 오류, 길게 잡으면 RangeError).
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-gpu.mjs [--browser chromium|webkit] [--chrome <chrome.exe>]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const playwright = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeFile = path.join(here, "..", "..", "src-bundle", "src", "js", "core", "gpu-bridge.js");
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BROWSER = opt.browser ?? "chromium";

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">import { GpuBridge } from "/gpu-bridge.js"; window.GpuBridge = GpuBridge; window.ready = true;</script>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/gpu-bridge.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    return res.end(fs.readFileSync(bridgeFile));
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = BROWSER === "webkit" ? await playwright.webkit.launch({ headless: true }) : await playwright.chromium.launch({ executablePath: CHROME, headless: true });
console.log(`브라우저: ${BROWSER}`);
try {
  const page = await browser.newPage();
  const warnings = [];
  page.on("console", (message) => (message.type() === "warning" || message.type() === "error") && warnings.push(message.text()));
  page.on("pageerror", (error) => warnings.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 10000 });

  const cases = await page.evaluate(() => {
    const OP = { TEXTURE: 2, UPLOAD: 8, READ: 10 };
    const FMT = { RGBA8: 1, RGB10_A2: 2, R16UI: 3 };
    const BYTES = { 1: 4, 2: 4, 3: 2 };
    const LIST_AT = 16;
    const bridge = GpuBridge.create(8, 8);
    if (!bridge) return { error: "no WebGL2" };
    const gl = bridge.gl;
    const record = (op, ...vals) => [op | ((vals.length + 1) << 8), ...vals];

    function runList(buffer, words) {
      new Uint32Array(buffer, LIST_AT, words.length).set(words);
      const ex = { memory: { buffer }, Web_GpuList: () => LIST_AT, Web_GpuListLen: () => words.length, Web_GpuListDone: () => {} };
      while (gl.getError()) {}
      let thrown = "";
      try {
        bridge.run(ex);
      } catch (error) {
        thrown = String(error?.message ?? error);
      }
      return { thrown, glError: gl.getError() };
    }

    function readTexture(id, fmt, width, height) {
      const entry = bridge.textures.get(id);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bridge.framebuffer(entry));
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      let out;
      if (fmt === FMT.R16UI) {
        const raw = new Uint32Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, raw);
        out = Array.from({ length: width * height }, (_, i) => raw[i * 4]);
      } else {
        const raw = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        out = Array.from({ length: width * height }, (_, i) => Array.from(raw.subarray(i * 4, i * 4 + 4)).join(","));
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    }

    function texel(fmt, n) {
      if (fmt === FMT.RGBA8) return [(n * 37 + 11) & 255, (n * 53 + 7) & 255, (n * 91 + 3) & 255, (255 - n) & 255];
      if (fmt === FMT.RGB10_A2) return [n & 1 ? 1023 : 0, n & 2 ? 1023 : 0, n & 4 ? 1023 : 0, n & 8 ? 3 : 0];
      return [(n * 977 + 4099) & 0xffff];
    }
    function shown(fmt, t) {
      if (fmt === FMT.RGBA8) return t.join(",");
      if (fmt === FMT.RGB10_A2) return [t[0] ? 255 : 0, t[1] ? 255 : 0, t[2] ? 255 : 0, t[3] ? 255 : 0].join(",");
      return t[0];
    }
    const empty = (fmt) => (fmt === FMT.R16UI ? 0 : "0,0,0,0");

    function uploadCase({ name, fmt, texW, texH, x, y, w, h, row, align, read }) {
      const bytes = (row * (h - 1) + w) * BYTES[fmt];
      const readAt = 4096, readBytes = w * h * 4;
      let size = 8192 + bytes;
      while ((size - bytes) % 4 !== align) size++;
      const buffer = new ArrayBuffer(size);
      const dataAt = size - bytes;
      const dv = new DataView(buffer);
      const src = [];
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < (j === h - 1 ? w : row); i++) {
          const t = texel(fmt, j * row + i), at = dataAt + (j * row + i) * BYTES[fmt];
          if (fmt === FMT.RGBA8) t.forEach((v, k) => dv.setUint8(at + k, v));
          else if (fmt === FMT.RGB10_A2) dv.setUint32(at, (t[0] | (t[1] << 10) | (t[2] << 20) | (t[3] << 30)) >>> 0, true);
          else dv.setUint16(at, t[0], true);
          if (i < w) src.push({ px: x + i, py: y + j, t });
        }
      }
      const words = [...record(OP.TEXTURE, 1, fmt, texW, texH), ...record(OP.UPLOAD, 1, x, y, w, h, fmt, dataAt, row)];
      if (read) words.push(...record(OP.READ, 1, x, y, w, h, FMT.RGBA8, readAt));
      const r = runList(buffer, words);
      const got = r.thrown ? [] : readTexture(1, fmt, texW, texH);
      const want = Array.from({ length: texW * texH }, () => empty(fmt));
      for (const s of src) want[s.py * texW + s.px] = shown(fmt, s.t);
      let diff = 0, first = "";
      for (let i = 0; i < want.length; i++) {
        if (got[i] !== want[i]) {
          diff++;
          if (!first) first = `(${i % texW},${Math.floor(i / texW)}) ${got[i]} ≠ ${want[i]}`;
        }
      }
      const out = { name, bytes, dataAt, size, thrown: r.thrown, glError: r.glError, diff, first };
      if (read) {
        const mem = new Uint8Array(buffer, readAt, readBytes);
        let readDiff = 0;
        for (let k = 0; k < w * h; k++) {
          const s = src[k];
          const back = Array.from(mem.subarray(k * 4, k * 4 + 4)).join(",");
          if (back !== shown(fmt, s.t)) readDiff++;
        }
        out.readDiff = readDiff;
      }
      return out;
    }

    return {
      renderer: gl.getParameter(gl.RENDERER),
      list: [
        uploadCase({ name: "RGBA8 전체 4×3, 홀수 주소, 메모리 끝", fmt: FMT.RGBA8, texW: 4, texH: 3, x: 0, y: 0, w: 4, h: 3, row: 4, align: 1 }),
        uploadCase({ name: "RGBA8 부분 3×2 @(1,2), 행 길이 5, 메모리 끝", fmt: FMT.RGBA8, texW: 6, texH: 5, x: 1, y: 2, w: 3, h: 2, row: 5, align: 0 }),
        uploadCase({ name: "RGBA8 전체 4×2 + READ", fmt: FMT.RGBA8, texW: 4, texH: 2, x: 0, y: 0, w: 4, h: 2, row: 4, align: 3, read: true }),
        uploadCase({ name: "RGBA8 전체 2048×4, 행 길이 2048(taitof3 재현)", fmt: FMT.RGBA8, texW: 2048, texH: 4, x: 0, y: 0, w: 2048, h: 4, row: 2048, align: 0 }),
        uploadCase({ name: "RGB10_A2 전체 4×4, 메모리 끝", fmt: FMT.RGB10_A2, texW: 4, texH: 4, x: 0, y: 0, w: 4, h: 4, row: 4, align: 0 }),
        uploadCase({ name: "RGB10_A2 부분 2×3 @(1,0), 행 길이 3, 메모리 끝", fmt: FMT.RGB10_A2, texW: 4, texH: 4, x: 1, y: 0, w: 2, h: 3, row: 3, align: 0 }),
        uploadCase({ name: "R16UI 전체 5×3, 2바이트 정렬 주소, 메모리 끝", fmt: FMT.R16UI, texW: 5, texH: 3, x: 0, y: 0, w: 5, h: 3, row: 5, align: 2 }),
        uploadCase({ name: "R16UI 부분 3×2 @(1,1), 행 길이 4, 메모리 끝", fmt: FMT.R16UI, texW: 4, texH: 4, x: 1, y: 1, w: 3, h: 2, row: 4, align: 0 }),
      ],
      stats: bridge.stats,
      lost: gl.isContextLost(),
    };
  });

  if (cases.error) ok("WebGL2 캔버스", false, cases.error);
  else {
    console.log(`그리기 장치: ${cases.renderer}`);
    for (const c of cases.list) {
      const detail = `원본 ${c.bytes}B @${c.dataAt}/${c.size}, 다른 화소 ${c.diff}${c.first ? ` 첫 ${c.first}` : ""}, GL 오류 ${c.glError}${c.thrown ? `, 예외 ${c.thrown}` : ""}${c.readDiff != null ? `, READ 다른 화소 ${c.readDiff}` : ""}`;
      ok(c.name, !c.thrown && c.glError === 0 && c.diff === 0 && (c.readDiff == null || c.readDiff === 0), detail);
    }
    ok("컨텍스트 유지", !cases.lost);
    ok("브라우저 경고·오류 없음", warnings.length === 0, warnings.slice(0, 3).join(" | "));
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
