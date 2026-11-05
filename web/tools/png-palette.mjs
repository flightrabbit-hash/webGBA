// PNG 를 팔레트 PNG(8비트 색인)로 다시 저장 — 화소는 그대로(256색 이하만), 크기만 줄인다. 스플래시 그림은 index.html 에 data URI 로 들어가므로.
//   node web/tools/png-palette.mjs <입력.png> <출력.png>
// 다시 읽어 RGBA 가 입력과 한 화소도 다르지 않을 때만 쓴다.
import fs from "node:fs";
import zlib from "node:zlib";
import { decodePng } from "../test/png.mjs";

const [input, output] = process.argv.slice(2);
const src = decodePng(fs.readFileSync(input));
const { width, height, data } = src;

const index = new Map();
const colors = [];
const pixels = Buffer.alloc(width * height);
for (let i = 0; i < width * height; i++) {
  const a = data[i * 4 + 3];
  const key = a ? data.readUInt32BE(i * 4) : 0;
  let at = index.get(key);
  if (at === undefined) {
    at = colors.length;
    index.set(key, at);
    colors.push(a ? [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], a] : [0, 0, 0, 0]);
  }
  pixels[i] = at;
}
if (colors.length > 256) {
  console.error(`색 ${colors.length}개 — 팔레트 PNG 로 바꿀 수 없습니다`);
  process.exit(1);
}
colors.sort((a, b) => a[3] - b[3]);
const order = new Map(colors.map((c, i) => [c[3] ? ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0 : 0, i]));
for (let i = 0; i < pixels.length; i++) {
  const a = data[i * 4 + 3];
  pixels[i] = order.get(a ? data.readUInt32BE(i * 4) : 0);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 3;
const plte = Buffer.from(colors.flatMap((c) => c.slice(0, 3)));
const alphas = colors.map((c) => c[3]);
const lastSeeThrough = alphas.findLastIndex((a) => a !== 255);
const raw = Buffer.alloc((width + 1) * height);
for (let y = 0; y < height; y++) pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("PLTE", plte)];
if (lastSeeThrough >= 0) parts.push(chunk("tRNS", Buffer.from(alphas.slice(0, lastSeeThrough + 1))));
parts.push(chunk("IDAT", zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk("IEND", Buffer.alloc(0)));
const out = Buffer.concat(parts);

const back = { width, height, data: Buffer.alloc(width * height * 4) };
for (let i = 0; i < pixels.length; i++) {
  const c = colors[pixels[i]];
  back.data.set(c[3] ? c : [0, 0, 0, 0], i * 4);
}
const want = Buffer.from(data);
for (let i = 0; i < width * height; i++) if (!want[i * 4 + 3]) want.fill(0, i * 4, i * 4 + 4);
if (!back.data.equals(want)) {
  console.error("다시 읽은 화소가 입력과 다릅니다");
  process.exit(1);
}
fs.writeFileSync(output, out);
console.log(`${input} ${fs.statSync(input).size} → ${out.length}바이트 · 색 ${colors.length}`);
