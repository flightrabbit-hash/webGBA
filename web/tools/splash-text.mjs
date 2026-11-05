// 스플래시 하단 주소 글자를 도트 마스크 PNG 로 굽기 — 갈무리11 굵은 글꼴 12px(글꼴 한 칸 = 1px), 잉크 상자로 자름.
// 스플래시는 글꼴을 받기 전에 그려야 하므로 글자를 그림으로 넣는다(빌드가 index.html 에 data URI 로 넣음).
// 12px 로 그리면 가로 안티에일리어싱이 섞이므로 8배(96px)로 그려 칸마다 가운데 화소만 본다.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/tools/splash-text.mjs [--chrome <chrome.exe>]
// 만든 뒤 node web/tools/png-palette.mjs web/src/splash/text.png web/src/splash/text.png 로 줄인다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src");
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const TEXT = "https://flightrabbit.tistory.com";
const FONT_PX = 12;
const args = process.argv.slice(2);
const at = args.indexOf("--chrome");
const CHROME = at >= 0 ? args[at + 1] : "C:/Program Files/Google/Chrome/Application/chrome.exe";

const font = fs.readFileSync(path.join(src, "fonts", "Galmuri11-Bold.woff2")).toString("base64");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setContent("<!doctype html><title>text</title>");
const out = await page.evaluate(
  async ([fontData, text, px, scale]) => {
    const bytes = Uint8Array.from(atob(fontData), (c) => c.charCodeAt(0));
    const face = new FontFace("SplashBold", bytes);
    await face.load();
    document.fonts.add(face);
    const cols = 300;
    const rows = 32;
    const baseRow = 22;
    const work = document.createElement("canvas");
    work.width = cols * scale;
    work.height = rows * scale;
    const c = work.getContext("2d", { willReadFrequently: true });
    c.font = `${px * scale}px SplashBold`;
    c.fillStyle = "#fff";
    c.fillText(text, 4 * scale, baseRow * scale);
    const data = c.getImageData(0, 0, work.width, work.height).data;
    const at = (x, y) => data[((y * scale + scale / 2) * work.width + x * scale + scale / 2) * 4 + 3];
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1, unsure = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const a = at(x, y);
        if (a > 32 && a < 224) unsure++;
        if (a < 128) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    const mask = document.createElement("canvas");
    mask.width = x1 - x0 + 1;
    mask.height = y1 - y0 + 1;
    const m = mask.getContext("2d");
    const image = m.createImageData(mask.width, mask.height);
    for (let y = 0; y < mask.height; y++)
      for (let x = 0; x < mask.width; x++) if (at(x + x0, y + y0) >= 128) image.data.set([255, 255, 255, 255], (y * mask.width + x) * 4);
    m.putImageData(image, 0, 0);
    return { url: mask.toDataURL("image/png"), w: mask.width, h: mask.height, unsure };
  },
  [font, TEXT, FONT_PX, 8],
);
await browser.close();

const file = path.join(src, "splash", "text.png");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, Buffer.from(out.url.split(",")[1], "base64"));
console.log(`${path.relative(path.join(here, "..", ".."), file)} ${out.w}x${out.h} · 칸 가운데가 애매한 칸 ${out.unsure}개`);
if (out.unsure) process.exitCode = 1;
