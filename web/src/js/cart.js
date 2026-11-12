// 롬팩 그림(라이브러리 책장·첫 화면 최근 게임) — 앞면(54×44 격자)·옆면(18×46 격자)을 canvas 로 그린다.
// .wgba 설명서의 그림(cart.label·front·spine, 같은 배수 k)이 있으면 그 바이트를 그대로(가장 가까운 점, 1:1) 쓰고,
// 없는 것만 우리 기본 모양(오른쪽 위 모따기·위 꽂는 방향 ▼·아래 손잡이 홈 7줄 — 실제 카트리지·상표 모양 아님)을
// cart.color(없으면 테마 색)로 그린다. 규격 6장: 다른 k·규격 밖 자리·망가진 그림은 "없음"으로 보고 오류 창 없음.
// 화면에서는 격자 1칸 = UNIT(2) CSS px 이상의 정수 배율이고 canvas 는 image-rendering: pixelated — 흐리게·줄여 그리지 않는다
// (k 가 UNIT 보다 크면 그 게임은 1 그림 픽셀 = 1 CSS px 로 키운다).
import { CART_DEFAULT_LABEL_AT, CART_DEFAULT_TEXT_AREA, CART_PARTS, rompackColor } from "./core/wgba-format.js";

export const UNIT = 2;
export const FRONT = CART_PARTS.front.unit;
export const SPINE = CART_PARTS.spine.unit;
const LABEL = CART_PARTS.label.unit;

const OUTLINE = "#04060d";
const PAPER = "#dfe4f0";
const PAPER_HI = "#f2f4fa";
const PAPER_LO = "#b9c0d3";
export const LABEL_INK = "#1d2340";

// ── 색 ──
const probe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");

/** CSS 색 글(#rgb·#rrggbb·rgb()) → [r, g, b]. 모르면 null. */
export function rgbOf(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let hex = /^#([0-9a-f]{6})$/i.exec(text)?.[1];
  if (!hex && /^#[0-9a-f]{3}$/i.test(text)) hex = [...text.slice(1)].map((c) => c + c).join("");
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (!probe) return null;
  probe.fillStyle = "#000";
  probe.fillStyle = text;
  const out = probe.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(out)) return rgbOf(out);
  const m = /rgba?\(([^)]+)\)/.exec(out);
  return m ? m[1].split(/[ ,\/]+/).slice(0, 3).map(Number) : null;
}

const hexOf = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => hexOf(a.map((v, i) => v + (b[i] - v) * t));
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function tones(color) {
  const c = rgbOf(color) ?? [96, 104, 128];
  return { hi: mix(c, WHITE, 0.3), base: hexOf(c), lo: mix(c, BLACK, 0.3), sh: mix(c, BLACK, 0.55) };
}

/** 테마에서 만든 기본 몸통 색(--bg-raised 를 흰색 쪽으로 28%). 테마가 바뀌면 다시 부른다. */
export function themeBody() {
  const raised = rgbOf(getComputedStyle(document.documentElement).getPropertyValue("--bg-raised")) ?? [21, 29, 51];
  return mix(raised, WHITE, 0.28);
}

// ── 격자(1칸 = 색 하나) ──
function grid(w, h) {
  const px = new Array(w * h).fill(null);
  return {
    w,
    h,
    px,
    get: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : px[y * w + x]),
    set(x, y, c) {
      if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c;
    },
  };
}

function blit(ctx, g, k) {
  for (let y = 0; y < g.h; y++) {
    const row = y * g.w;
    for (let x = 0; x < g.w; ) {
      const v = g.px[row + x];
      let end = x + 1;
      while (end < g.w && g.px[row + end] === v) end++;
      if (v) {
        ctx.fillStyle = v;
        ctx.fillRect(x * k, y * k, (end - x) * k, k);
      }
      x = end;
    }
  }
}

/** 기본 앞면 54×44 칸. withLabel = 라벨 그림이 들어갈 자리(바탕 종이를 칠하지 않음). */
function defaultFront(color, withLabel) {
  const [W, H] = FRONT;
  const t = tones(color);
  const g = grid(W, H);
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (W - 1 - x + y < 5) return false; // 오른쪽 위 모따기
    const corner = (cx, cy) => Math.abs(x - cx) + Math.abs(y - cy) < 2;
    return !(corner(0, 0) || corner(0, H - 1) || corner(W - 1, H - 1));
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) g.set(x, y, t.base);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) g.px[y * W + x] = OUTLINE;
    }
  const paint = (x, y, c) => {
    if (inside(x, y) && g.get(x, y) !== OUTLINE) g.px[y * W + x] = c;
  };
  for (let x = 0; x < W; x++) paint(x, 1, t.hi);
  for (let y = 0; y < H; y++) {
    paint(1, y, t.hi);
    paint(W - 2, y, t.lo);
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < 6; y++) if (W - 1 - x + y === 5 || W - 1 - x + y === 6) paint(x, y, t.hi);
  for (let x = 0; x < W; x++) paint(x, H - 2, t.lo);
  for (const [row, a, b] of [[1, 24, 29], [2, 25, 28], [3, 26, 27]]) for (let x = a; x <= b; x++) paint(x, row, t.lo); // 꽂는 방향 ▼
  for (let x = 2; x <= 51; x++) {
    paint(x, 4, t.sh);
    paint(x, 37, t.hi);
  }
  for (let y = 4; y <= 37; y++) {
    paint(2, y, t.sh);
    paint(51, y, t.hi);
  }
  if (!withLabel) {
    for (let y = 5; y <= 36; y++) for (let x = 3; x <= 50; x++) paint(x, y, PAPER);
    for (let x = 3; x <= 50; x++) {
      paint(x, 5, PAPER_HI);
      paint(x, 36, PAPER_LO);
      paint(x, 7, t.base); // 라벨 위 띠(몸통 색)
      paint(x, 8, t.base);
    }
  }
  for (let i = 0; i < 7; i++) {
    const xr = 14 + i * 4;
    for (let y = 39; y <= 41; y++) {
      paint(xr, y, t.lo);
      paint(xr + 1, y, t.hi);
    }
  } // 손잡이 홈
  return g;
}

const GB_BODY = "#a3a6ae";
const GB_X = [8, 45];
const GB_PAPER = [11, 9, 42, 32];
const GB_TEXT = [11, 14, 32, 18];

function gbFront(color) {
  const [W, H] = FRONT;
  const [x0, x1] = GB_X;
  const t = tones(color);
  const g = grid(W, H);
  const inside = (x, y) => {
    if (x < x0 || x > x1 || y < 0 || y >= H) return false;
    const corner = (cx, cy) => Math.abs(x - cx) + Math.abs(y - cy) < 2;
    return !(corner(x0, 0) || corner(x1, 0) || corner(x0, H - 1) || corner(x1, H - 1));
  };
  for (let y = 0; y < H; y++)
    for (let x = x0; x <= x1; x++) if (inside(x, y)) g.set(x, y, !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1) ? OUTLINE : t.base);
  const paint = (x, y, c) => {
    if (inside(x, y) && g.get(x, y) !== OUTLINE) g.px[y * W + x] = c;
  };
  for (let x = x0; x <= x1; x++) {
    paint(x, 1, t.hi);
    paint(x, H - 2, t.lo);
  }
  for (let y = 0; y < H; y++) {
    paint(x0 + 1, y, t.hi);
    paint(x1 - 1, y, t.lo);
  }
  for (const [row, a, b] of [[2, 24, 29], [3, 25, 28], [4, 26, 27]]) for (let x = a; x <= b; x++) paint(x, row, t.lo);
  for (let x = x0 + 2; x <= x1 - 2; x++) {
    paint(x, 5, t.lo);
    paint(x, 6, t.hi);
  }
  const [px0, py0, px1, py1] = GB_PAPER;
  for (let x = px0 - 1; x <= px1 + 1; x++) {
    paint(x, py0 - 1, t.sh);
    paint(x, py1 + 1, t.hi);
  }
  for (let y = py0 - 1; y <= py1 + 1; y++) {
    paint(px0 - 1, y, t.sh);
    paint(px1 + 1, y, t.hi);
  }
  for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) paint(x, y, PAPER);
  for (let x = px0; x <= px1; x++) {
    paint(x, py0, PAPER_HI);
    paint(x, py1, PAPER_LO);
    paint(x, py0 + 2, t.base);
    paint(x, py0 + 3, t.base);
  }
  for (const y of [36, 38, 40])
    for (let x = 18; x <= 35; x++) {
      paint(x, y, t.lo);
      paint(x, y + 1, t.hi);
    }
  return g;
}

// ── 게임 항목 → 그림 모양 ──
const ints = (list, n) => Array.isArray(list) && list.length === n && list.every((v) => Number.isInteger(v) && v >= 0);

/**
 * 보관 항목(rom) → { k, unit, color, parts, labelAt, textArea }. parts = 실제로 쓸 그림 부분(같은 k 만).
 * labelAt·textArea 는 그림 픽셀(k 배) 단위. textArea 가 null 이면 옆면에 이름을 쓰지 않음(옆면 그림에 이름이 있는 경우).
 */
export function cartModel(rom) {
  const cart = rom?.gameId && rom.cart && typeof rom.cart === "object" ? rom.cart : {};
  const shape = !rom?.gameId && (rom?.type === "gb" || rom?.type === "gbc") ? "gb" : "gba";
  // 설명서 cart.color 가 있으면 그 색, 없으면(그림 없는 롬팩 등) 이름 해시로 고정 색(결정 102-8).
  const color = typeof cart.color === "string" && rgbOf(cart.color) ? cart.color : rom?.type === "gb" && !rom.gameId ? GB_BODY : rompackColor(rom?.name ?? "");
  const has = Object.fromEntries(Object.keys(CART_PARTS).map((part) => [part, Number.isInteger(cart[part]?.scale) ? cart[part].scale : 0]));
  const k = has.front || has.label || has.spine || 1;
  const parts = Object.keys(CART_PARTS).filter((part) => has[part] === k);
  let labelAt = CART_DEFAULT_LABEL_AT.map((v) => v * k);
  if (parts.includes("front") && ints(cart.front?.labelAt, 2)) {
    const [x, y] = cart.front.labelAt;
    if (x + LABEL[0] * k <= FRONT[0] * k && y + LABEL[1] * k <= FRONT[1] * k) labelAt = [x, y];
  }
  let textArea = CART_DEFAULT_TEXT_AREA.map((v) => v * k);
  if (parts.includes("spine")) {
    textArea = null;
    const area = cart.spine?.textArea;
    if (ints(area, 4) && area[2] > 0 && area[3] > 0 && area[0] + area[2] <= SPINE[0] * k && area[1] + area[3] <= SPINE[1] * k) textArea = [...area];
  }
  return { k, unit: Math.max(UNIT, k), color, parts, labelAt, textArea, shape };
}

const imageCache = new Map();

/** 롬팩 그림 바이트(store cart:<id>:<부분>)를 풀어 ImageBitmap 으로. 실패한 부분은 빠짐. read(part) → Uint8Array|null. */
export async function cartImages(rom, model, read) {
  const out = {};
  await Promise.all(
    model.parts.map(async (part) => {
      const key = `${rom.id}|${rom.build ?? ""}|${part}`;
      if (!imageCache.has(key)) {
        imageCache.set(
          key,
          (async () => {
            const bytes = await read(part);
            if (!bytes?.length) return null;
            const type = rom.cart?.[part]?.format === "webp" ? "image/webp" : "image/png";
            const bitmap = await createImageBitmap(new Blob([bytes], { type }));
            const [uw, uh] = CART_PARTS[part].unit;
            return bitmap.width === uw * model.k && bitmap.height === uh * model.k ? bitmap : null;
          })().catch(() => null),
        );
      }
      const bitmap = await imageCache.get(key);
      if (bitmap) out[part] = bitmap;
    }),
  );
  return out;
}

export function forgetImages(id) {
  for (const key of [...imageCache.keys()]) if (key.startsWith(`${id}|`)) imageCache.delete(key);
}

function canvasOf(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * 앞면 canvas(54k×44k) + 글 자리. 돌려주는 값 { canvas, textBox } — textBox 는 라벨 그림이 없을 때 이름을 쓸 자리(그림 픽셀),
 * 라벨 그림이 있으면 null.
 */
export function drawFront(model, images, body) {
  const { k } = model;
  const canvas = canvasOf(FRONT[0] * k, FRONT[1] * k);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const label = images.label ?? null;
  if (model.shape === "gb") {
    blit(ctx, gbFront(model.color ?? body), k);
    return { canvas, textBox: GB_TEXT.map((v) => v * k), paper: PAPER };
  }
  if (images.front) ctx.drawImage(images.front, 0, 0);
  else blit(ctx, defaultFront(model.color ?? body, Boolean(label)), k);
  const [lx, ly] = model.labelAt;
  if (label) {
    if (!images.front) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(lx, ly, LABEL[0] * k, LABEL[1] * k);
    }
    ctx.drawImage(label, lx, ly);
    return { canvas, textBox: null };
  }
  // 기본 앞면은 라벨 위 띠(2칸)와 아래 그늘 줄 사이(위아래 종이 1칸씩 남김, 가운데는 그대로), 앞면 그림은 라벨 자리 전체.
  // paper = 글 자리 바탕이 모두 종이 색(기본 앞면) — 잉크 가운데 계산이 실제 바탕 색을 알도록 글 칸에도 같은 색을 깐다.
  const textBox = images.front ? [lx, ly, LABEL[0] * k, LABEL[1] * k] : [lx, ly + 5 * k, LABEL[0] * k, (LABEL[1] - 7) * k];
  return { canvas, textBox, paper: images.front ? "" : PAPER };
}

const ISO_URL = "/art/rompack.png";
const ISO_STRETCH = 5;
const ISO_SHOW = 17;
let isoTpl = null;
let isoWork = null;

const hslOf = ([r, g, b]) => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
};

const rgbOfHsl = ([h, s, l]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
};

/**
 * 롬팩 시안(16색 그림) → 칸 정보. 몸체 색(붉은 계열)만 롬팩 색으로 바꾸고, 앞면은 라벨 가운데 두 열을 stretch 번 반복해
 * 늘린다(반복마다 오른쪽이 1칸 올라감 = 2:1 사선 그대로). image = { width, height, data(RGBA) }.
 */
export function isoTemplate({ width, height, data }, stretch = ISO_STRETCH) {
  let [x0, x1, y0, y1] = [width, 0, height, 0];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] >= 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + 1);
      }
  const w0 = x1 - x0;
  const h0 = y1 - y0;
  const colors = [];
  const counts = [];
  const indexOf = new Map();
  const src = new Uint8Array(w0 * h0).fill(255);
  for (let y = 0; y < h0; y++)
    for (let x = 0; x < w0; x++) {
      const o = ((y + y0) * width + x + x0) * 4;
      if (data[o + 3] < 128) continue;
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      if (!indexOf.has(key)) {
        indexOf.set(key, colors.length);
        colors.push([data[o], data[o + 1], data[o + 2]]);
        counts.push(0);
      }
      const i = indexOf.get(key);
      src[y * w0 + x] = i;
      counts[i] += 1;
    }
  const hsl = colors.map(hslOf);
  const kind = hsl.map(([h, s, l], i) => {
    if (l < 0.08) return "line";
    if (l > 0.55 && h > 15 && h < 50 && s > 0.15) return "strip";
    if ((h < 30 || h > 330) && s > 0.08) return "body";
    return "keep";
  });
  const paper = counts.reduce((best, n, i) => (kind[i] === "keep" && hsl[i][2] > 0.6 && n > (counts[best] ?? -1) ? i : best), -1);
  const body = counts.reduce((best, n, i) => (kind[i] === "body" && n > (counts[best] ?? -1) ? i : best), -1);
  const column = (grid, w, h, x, test) => {
    let top = -1;
    let bottom = -1;
    let n = 0;
    for (let y = 0; y < h; y++)
      if (test(grid[y * w + x])) {
        if (top < 0) top = y;
        bottom = y + 1;
        n += 1;
      }
    return { top, bottom, n };
  };
  const isPaper = (i) => i === paper;
  const labelCols = [];
  for (let x = 0; x < w0; x++) if (column(src, w0, h0, x, isPaper).n > 8) labelCols.push(x);
  const mid = labelCols[0] + Math.floor((labelCols[labelCols.length - 1] - labelCols[0]) / 2);
  const w = w0 + stretch * 2;
  const h = h0 + stretch;
  const idx = new Uint8Array(w * h).fill(255);
  for (let x = 0; x < w; x++) {
    let sx;
    let dy;
    if (x < mid) [sx, dy] = [x, stretch];
    else if (x < mid + stretch * 2) [sx, dy] = [mid + ((x - mid) % 2), stretch - Math.floor((x - mid) / 2)];
    else [sx, dy] = [x - stretch * 2, 0];
    for (let y = 0; y < h0; y++) idx[(y + dy) * w + x] = src[y * w0 + sx];
  }
  const runs = (test) => {
    const out = [];
    for (let x = 0; x < w; x++) {
      const r = column(idx, w, h, x, test);
      if (r.n) out.push({ x, top: r.top, bottom: r.bottom });
    }
    return out;
  };
  const label = runs(isPaper).filter((r) => r.bottom - r.top > 8);
  const strip = runs((i) => kind[i] === "strip");
  const stripRight = strip[strip.length - 1].x;
  let seam = stripRight + 1;
  while (seam < w && column(idx, w, h, seam, (i) => kind[i] === "line").n < 30) seam++;
  const stripRef = counts.reduce((best, n, i) => (kind[i] === "strip" && n > (counts[best] ?? -1) ? i : best), -1);
  return { w, h, idx, colors, hsl, kind, body, paper, stripRef, seam, label, strip };
}

export function loadIso() {
  if (isoTpl) return Promise.resolve(isoTpl);
  if (!isoWork) {
    isoWork = (async () => {
      const bitmap = await createImageBitmap(await (await fetch(ISO_URL)).blob());
      const canvas = canvasOf(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      isoTpl = isoTemplate(ctx.getImageData(0, 0, canvas.width, canvas.height));
      return isoTpl;
    })().catch((error) => {
      isoWork = null;
      throw error;
    });
  }
  return isoWork;
}

export const isoInfo = () => isoTpl;
export const isoSlot = () => (isoTpl ? isoTpl.seam + 1 + ISO_SHOW : 0);

const ISO_PAPER = { sat: 0.45, light: [0.62, 0.84], lift: 0.32 };
const ISO_STRIP = { sat: 0.35, light: [0.84, 0.94], lift: 0.5 };

/** 시안 팔레트 → 이 롬팩 색: 몸체 색은 색상·채도를 바꾸고 밝기는 시안의 단계 비율 그대로, 그림 칸 종이·옆면 띠는 롬팩 색의 밝은 단계(글자가 읽히게 밝기 하한), 외곽선은 그대로. */
function isoPalette(tpl, color) {
  const [ht, st, lt] = hslOf(rgbOf(color) ?? [96, 104, 128]);
  const [, sr, lr] = tpl.hsl[tpl.body];
  const tint = ({ sat, light, lift }, offset = 0) => rgbOfHsl([ht, st * sat, Math.min(light[1], Math.max(light[0], lt + lift) + offset)]);
  return tpl.colors.map((rgb, i) => {
    if (i === tpl.paper) return tint(ISO_PAPER);
    if (tpl.kind[i] === "strip") return tint(ISO_STRIP, tpl.hsl[i][2] - tpl.hsl[tpl.stripRef][2]);
    if (tpl.kind[i] !== "body") return rgb;
    const [, s, l] = tpl.hsl[i];
    const w = Math.min(1, s / sr);
    const light = Math.min(0.95, l * (1 - w) + ((l * lt) / lr) * w);
    return rgbOfHsl([ht, Math.min(1, (s * st) / sr), light]);
  });
}

/** 책장 롬팩(시안 그림 + 롬팩 색 + 라벨 칸 안 롬팩 그림). 시안 1화소 = k 그림 픽셀. */
export function drawIso(model, art) {
  const tpl = isoTpl;
  const { k } = model;
  const pal = isoPalette(tpl, model.color);
  const small = canvasOf(tpl.w, tpl.h);
  const sctx = small.getContext("2d");
  const image = sctx.createImageData(tpl.w, tpl.h);
  for (let i = 0; i < tpl.idx.length; i++) {
    const c = tpl.idx[i];
    if (c === 255) continue;
    image.data.set([...pal[c], 255], i * 4);
  }
  sctx.putImageData(image, 0, 0);
  const canvas = canvasOf(tpl.w * k, tpl.h * k);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  if (art && tpl.label.length > 2) {
    const cols = tpl.label.slice(1, -1);
    const rows = Math.min(...cols.map((r) => r.bottom - r.top - 2));
    const scale = Math.min((cols.length * k) / art.w, (rows * k) / art.h);
    const dw = Math.max(1, Math.floor(art.w * scale));
    const dh = Math.max(1, Math.floor(art.h * scale));
    const left = cols[0].x * k + Math.floor((cols.length * k - dw) / 2);
    const lift = Math.floor((rows * k - dh) / 2);
    const byX = new Map(cols.map((r) => [r.x, r]));
    for (let dx = 0; dx < dw; dx++) {
      const run = byX.get(Math.floor((left + dx) / k));
      if (!run) continue;
      const sx = art.x + Math.floor(((dx + 0.5) * art.w) / dw);
      const top = (run.top + 1) * k + lift;
      ctx.drawImage(art.image, sx, art.y, 1, art.h, left + dx, top, 1, Math.min(dh, (run.bottom - 1) * k - top));
    }
  }
  return { canvas, visible: isoSlot() * k };
}

export function labelArt(model, images) {
  if (images.label) return { image: images.label, x: 0, y: 0, w: images.label.width, h: images.label.height };
  if (images.front) return { image: images.front, x: model.labelAt[0], y: model.labelAt[1], w: LABEL[0] * model.k, h: LABEL[1] * model.k };
  return null;
}
