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

export const ISO = Object.freeze({ spine: 14, front: 40, back: 4, face: 44, band: 5, show: 20, ridge: 2, ridgeW: 8, strip: [2, 10] });
export const SLOT = ISO.spine + ISO.show;

export function isoBox() {
  const { spine: S, front: F, back: B, face: Hf, band: tb, ridge: R, ridgeW } = ISO;
  const W = S + F + B;
  const ys = R + Math.floor((S - 1) / 4) + Math.floor(F / 2);
  const sil = (x) => {
    if (x < S) return ys - Math.floor(x / 4);
    const edge = ys - Math.floor((S - 1) / 4);
    if (x < S + F) return edge - Math.floor((x - S + 1) / 2);
    return edge - Math.floor(F / 2) + (x - S - F + 1);
  };
  const top = (x) => sil(x) + tb;
  const H = sil(S - 1) + tb + Hf;
  const bottom = (x) => (x < S ? H - Math.floor((S - 1 - x) / 2) : H - Math.floor((x - S + 1) / 2));
  const ridge = (x) => x >= S + F - ridgeW && x < S + F;
  const [s0, s1] = ISO.strip;
  const strip = (x) => [top(s0) + 4 + Math.floor((x - s0) / 2), bottom(x) - 4];
  return { S, F, B, R, W, H, sil, top, bottom, ridge, strip };
}

/** 롬팩 한 장(위에서 본 평행 투영, 2:1 사선): 옆면(라벨 띠) · 윗면 띠 · 앞면 틀 + 라벨 칸(롬팩 그림) · 뒷판 · 돌기. 1칸 = k 그림 픽셀. */
export function drawIso(model, art) {
  const { k } = model;
  const { S, F, R, W, H, sil, top, bottom, ridge, strip } = isoBox();
  const canvas = canvasOf(W * k, H * k);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const tone = tones(model.color);
  const fill = (color, x, from, to) => {
    if (to <= from) return;
    ctx.fillStyle = color;
    ctx.fillRect(x * k, from * k, k, (to - from) * k);
  };
  const [s0, s1] = ISO.strip;
  const label = [S + 3, S + F - 3];
  for (let x = 0; x < W; x++) {
    const peak = sil(x) - (ridge(x) ? R : 0);
    const t = top(x);
    const b = bottom(x);
    fill(tone.base, x, peak, t);
    fill(tone.hi, x, sil(x) + 1, sil(x) + 3);
    fill(tone.sh, x, t - 1, t);
    if (x < S) {
      fill(tone.lo, x, t, b);
      if (x >= s0 && x < s1) {
        const [a, c] = strip(x);
        fill(PAPER, x, a + (x === s0 ? 1 : 0), c - (x === s1 - 1 ? 1 : 0));
      }
      if (x === s1 + 1) fill(tone.base, x, t + 1, b - 1);
      if (x === S - 1) fill(tone.sh, x, t, b);
    } else if (x < S + F) {
      fill(tone.base, x, t, b);
      if (x === S) fill(tone.hi, x, t, b - 1);
      if (x >= label[0] && x < label[1]) {
        fill(PAPER_LO, x, t + 5, b - 4);
        if (x > label[0] && x < label[1] - 1) fill(PAPER, x, t + 6, b - 5);
      }
    } else {
      fill(x === S + F ? tone.sh : tone.lo, x, Math.max(t, sil(x) + 1), b);
    }
    fill(OUTLINE, x, peak, peak + 1);
    fill(OUTLINE, x, b - 1, b);
    if (x === 0 || x === W - 1) fill(OUTLINE, x, peak, b);
    if (ridge(x) && (!ridge(x - 1) || !ridge(x + 1))) fill(OUTLINE, x, peak, sil(x) + 1);
  }
  if (art) {
    const inner = [label[0] + 1, label[1] - 1];
    const cols = inner[1] - inner[0];
    const rows = ISO.face - 11;
    const scale = Math.min((cols * k) / art.w, (rows * k) / art.h);
    const dw = Math.max(1, Math.floor(art.w * scale));
    const dh = Math.max(1, Math.floor(art.h * scale));
    const left = inner[0] * k + Math.floor((cols * k - dw) / 2);
    const lift = Math.floor((rows * k - dh) / 2);
    for (let dx = 0; dx < dw; dx++) {
      const x = Math.floor((left + dx) / k);
      const sx = art.x + Math.floor(((dx + 0.5) * art.w) / dw);
      ctx.drawImage(art.image, sx, art.y, 1, art.h, left + dx, (top(x) + 6) * k + lift, 1, dh);
    }
  }
  return { canvas, visible: SLOT * k };
}

export function labelArt(model, images) {
  if (images.label) return { image: images.label, x: 0, y: 0, w: images.label.width, h: images.label.height };
  if (images.front) return { image: images.front, x: model.labelAt[0], y: model.labelAt[1], w: LABEL[0] * model.k, h: LABEL[1] * model.k };
  return null;
}
