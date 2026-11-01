// QR 읽기 시험(브라우저 없이): BarcodeDetector 가 없는 브라우저(iPhone 사파리 등)용 해독 코드(vendor/jsqr.js)가
// webGBA 가 그리는 연결 코드 QR 을 기울기·원근·흐림·잡음 속에서 읽는지. 카메라 대신 그림을 만들어 넣는다.
//   node tools/test/qr-read.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { qrMatrix } from "../../src-bundle/src/js/core/net/qr.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
globalThis.self ??= globalThis;
await import(pathToFileURL(path.join(root, "src-bundle", "src", "js", "vendor", "jsqr.js")).href);
const jsQR = globalThis.jsQR;
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

let seed = 7;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

function render(text, { module = 6, quiet = 4 } = {}) {
  const m = qrMatrix(text);
  const size = (m.size + quiet * 2) * module;
  const gray = new Float32Array(size * size).fill(255);
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.dark[y][x]) for (let j = 0; j < module; j++) for (let i = 0; i < module; i++) gray[((y + quiet) * module + j) * size + (x + quiet) * module + i] = 0;
  return { gray, size, version: m.version };
}

// 출력 그림의 각 점을 원래 그림으로 되돌려 bilinear 로 칠한다(원근 = 위아래 폭이 다른 사다리꼴)
function camera(src, { out = 480, angle = 0, keystone = 0, scale = 0.8, blur = 0, noise = 0, light = 255, dark = 0 }) {
  const { gray, size } = src;
  const pick = (x, y) => (x < 0 || y < 0 || x >= size - 1 || y >= size - 1 ? 255 : gray[(y | 0) * size + (x | 0)] * (1 - (x % 1)) * (1 - (y % 1)) + gray[(y | 0) * size + (x | 0) + 1] * (x % 1) * (1 - (y % 1)) + gray[((y | 0) + 1) * size + (x | 0)] * (1 - (x % 1)) * (y % 1) + gray[((y | 0) + 1) * size + (x | 0) + 1] * (x % 1) * (y % 1));
  const img = new Float32Array(out * out);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let u = (x - out / 2) / (out * scale);
      let v = (y - out / 2) / (out * scale);
      const w = 1 + keystone * v;
      u /= w;
      v /= w;
      const ru = c * u + s * v;
      const rv = -s * u + c * v;
      img[y * out + x] = pick((ru + 0.5) * size, (rv + 0.5) * size);
    }
  }
  let cur = img;
  for (let pass = 0; pass < blur; pass++) {
    const next = new Float32Array(out * out);
    for (let y = 1; y < out - 1; y++) for (let x = 1; x < out - 1; x++) next[y * out + x] = (cur[y * out + x] * 4 + cur[y * out + x - 1] + cur[y * out + x + 1] + cur[(y - 1) * out + x] + cur[(y + 1) * out + x]) / 8;
    cur = next;
  }
  const rgba = new Uint8ClampedArray(out * out * 4);
  for (let i = 0; i < out * out; i++) {
    const g = dark + ((light - dark) * cur[i]) / 255 + (rand() - 0.5) * noise;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = Math.max(0, Math.min(255, g));
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, out };
}

const code = (n) => Array.from({ length: n }, (_, i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[(i * 37 + 11) % 64]).join("");
const cases = [
  ["방장 코드(111자) 정면", code(111), {}],
  ["방장 코드 10° 기울기 + 흐림", code(111), { angle: 0.17, blur: 2 }],
  ["방장 코드 원근(사다리꼴) + 잡음", code(111), { keystone: 0.3, noise: 30 }],
  ["답 코드(150자) 화면 반사로 낮은 대비", code(150), { light: 190, dark: 60, blur: 1 }],
  ["답 코드 작게(화면 폭 55%) + 기울기", code(150), { scale: 0.55, angle: -0.12 }],
];
for (const [name, text, opts] of cases) {
  const src = render(text);
  const shot = camera(src, opts);
  const t0 = performance.now();
  const found = jsQR(shot.rgba, shot.out, shot.out, { inversionAttempts: "dontInvert" });
  ok(`QR 읽기: ${name}`, found?.data === text, `버전 ${src.version} · ${(performance.now() - t0).toFixed(1)}ms · ${found ? (found.data === text ? "같음" : "다름") : "못 읽음"}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
