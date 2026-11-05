(() => {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const plan = window.webgbaSplashPlan;
  const debug = new URLSearchParams(location.search).get("splash") === "debug" ? document.createElement("pre") : null;
  function startDebug(extra, live) {
    if (!debug) return;
    const media = (query) => matchMedia(query).matches;
    debug.className = "splash-debug";
    debug.setAttribute("aria-hidden", "true");
    document.documentElement.append(debug);
    const draw = () => {
      const going = live();
      const text = [
        `dpr ${window.devicePixelRatio || 1} · css ${innerWidth}x${innerHeight} · screen ${screen.width}x${screen.height}`,
        `coarse+nohover ${media("(pointer: coarse) and (hover: none)")} · short ${Math.min(screen.width, screen.height)} · reduce ${media("(prefers-reduced-motion: reduce)")}`,
        ...extra(),
      ].join("\n");
      if (debug.textContent !== text) debug.textContent = text;
      if (going) requestAnimationFrame(draw);
    };
    draw();
  }
  if (!plan) {
    splash.remove();
    startDebug(() => ["splash off"], () => false);
    return;
  }

  const FRAME_MS = 80;
  const FRAMES = 8;
  const APPROACH_MS = FRAME_MS * FRAMES * 3;
  const TICK_MS = 40;
  const MIN_MS = 2000;
  const FADE_STEPS = 4;
  const FADE_STEP_MS = 60;
  const CONTACT_FRAME = 2;
  const BG_CSS = 3;
  const SHARE_PORTRAIT = 0.6;
  const SHARE_LANDSCAPE = 0.7;
  const HORIZON = 0.4;
  const PATH_HALF = 27;
  const CAMERA_SPEED = 0.0012;
  const LOOP_DEPTH = 24;
  const LOOP_SMALL = 10;
  const TEXT_BOTTOM = 16;
  const LATE_MS = 1000;
  const STEP_MAX_MS = 120;
  const LONG_MS = 4000;
  const HOME_VP_X = 199;
  const HOME_VP_Y = 150;
  const STRIP_ROWS = { meadow: 64, sunset: 52 };
  const NAMES = ["sky", "cloud", "cloud-shade", "sun-rim", "sun-mid", "sun-core", "sun-band", "ground-far", "ground-mid", "ground-near", "ground-a", "ground-b", "band", "path", "path-edge", "pebble", "flower-a", "flower-b", "flower-c", "flower-d", "flower-core", "tuft", "wood", "wood-dark", "pole", "lamp", "lamp-core", "shadow", "fill"];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

  const variant = plan.variant;
  const home = variant === "home";
  const stat = { frames: 0, approach: 0, gap: 0, held: 0, clock: 0 };
  let finish = () => {};
  const api = {
    variant,
    stat,
    startAt: 0,
    readyAt: 0,
    closedAt: 0,
    closed: new Promise((resolve) => (finish = resolve)),
    ready() {
      if (api.readyAt) return;
      api.readyAt = performance.now();
      let seen = -1;
      let idle = 0;
      const guard = setInterval(() => {
        if (api.closedAt) return clearInterval(guard);
        if (!api.startAt) {
          if (performance.now() - api.readyAt >= MIN_MS + FADE_STEPS * FADE_STEP_MS + LATE_MS) close();
          return;
        }
        idle = stat.frames === seen ? idle + 1 : 0;
        seen = stat.frames;
        if (idle >= 2) close();
      }, LATE_MS);
    },
  };
  window.webgbaSplash = api;

  function close() {
    if (api.closedAt) return;
    api.closedAt = performance.now();
    splash.remove();
    finish();
  }

  splash.dataset.variant = variant;
  splash.hidden = false;
  document.getElementById("boot")?.remove();

  const style = getComputedStyle(document.documentElement);
  const P = {};
  for (const name of NAMES) P[name] = style.getPropertyValue(`--sp-${variant}-${name}`).trim();
  const textInk = style.getPropertyValue("--sp-text").trim();
  const textEdge = style.getPropertyValue("--sp-text-edge").trim();
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const skyStops = home ? [] : P.sky.split(",").map((item) => {
    const [at, color] = item.trim().split(/\s+/);
    return { at: Number(at), rgb: rgb(color) };
  });
  const band = Number(P.band || 0);

  const back = document.createElement("canvas");
  const front = document.createElement("canvas");
  const text = document.createElement("canvas");
  splash.append(back, front, text);
  const bctx = back.getContext("2d");
  const fctx = front.getContext("2d");
  const tctx = text.getContext("2d");
  let ctx = bctx;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const rect = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  function disc(cx, cy, r, color) {
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  function line(x0, y0, x1, y1, color) {
    ctx.fillStyle = color;
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    const flat = dx >= -dy;
    let err = dx + dy;
    let a = flat ? x0 : y0;
    let b = a;
    let fixed = flat ? y0 : x0;
    const flush = () => (flat ? ctx.fillRect(Math.min(a, b), fixed, Math.abs(b - a) + 1, 1) : ctx.fillRect(fixed, Math.min(a, b), 1, Math.abs(b - a) + 1));
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
      if ((flat ? y0 : x0) === fixed) b = flat ? x0 : y0;
      else {
        flush();
        fixed = flat ? y0 : x0;
        a = b = flat ? x0 : y0;
      }
    }
    flush();
  }

  const cat = { sheet: null, size: 0, union: null };
  function measureCat(image) {
    const size = image.height;
    const work = document.createElement("canvas");
    work.width = image.width;
    work.height = size;
    const w = work.getContext("2d", { willReadFrequently: true });
    w.drawImage(image, 0, 0);
    const data = w.getImageData(0, 0, work.width, size).data;
    let x0 = size, y0 = size, x1 = -1, y1 = -1;
    for (let f = 0; f < FRAMES; f++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (data[(y * work.width + f * size + x) * 4 + 3]) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
    cat.sheet = image;
    cat.size = size;
    cat.union = { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  const view = {};
  let strip = null;
  let mask = null;
  let skyLayer = null;
  let patterns = null;

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.round(innerWidth * dpr);
    const vh = Math.round(innerHeight * dpr);
    const landscape = vw > vh;
    const s = Math.max(1, Math.round(BG_CSS * dpr));
    const u = cat.union;
    const k0 = Math.max(1, Math.round(dpr));
    const share = landscape ? SHARE_LANDSCAPE : SHARE_PORTRAIT;
    const N = Math.max(k0, Math.floor(Math.min((vh * share) / u.h, (vw * share) / u.w)));
    const top = Math.floor((vh - u.h * N) / 2);
    const axis = Math.floor(vw / 2);
    const AX = Math.ceil(axis / s);
    const offX = axis - AX * s;
    const hyL = Math.ceil(Math.round(vh * HORIZON) / s);
    const LW = Math.ceil((vw - offX) / s);
    const LH = Math.ceil(vh / s);
    const tk = Math.max(1, Math.round(dpr));
    const feetEnd = top + u.h * N;
    const half = Math.ceil((u.w * N) / 2) + 2;
    const fx = axis - half;
    const fy = Math.max(0, Math.min(top, hyL * s) - 2);
    const fw = half * 2;
    const fh = Math.min(vh, feetEnd + N + 2) - fy;
    const tw = (mask.width + 2) * tk;
    const th = (mask.height + 2) * tk;
    const safe = Math.round((parseFloat(getComputedStyle(splash).paddingBottom) || 0) * dpr);
    const tx = axis - Math.floor(tw / 2);
    const ty = vh - safe - TEXT_BOTTOM * tk - th;
    Object.assign(view, { dpr, vw, vh, s, k0, N, top, feetEnd, axis, AX, offX, hyL, hy: hyL * s, LW, LH, tk, fx, fy, fw, fh, tx, ty, tw, th, Dl: (feetEnd - hyL * s) / s });
    place(back, LW, LH, offX, 0, s);
    place(front, fw, fh, fx, fy, 1);
    place(text, tw, th, tx, ty, 1);
    for (const c of [bctx, fctx, tctx]) c.imageSmoothingEnabled = false;
    skyLayer = home ? null : paintSky();
    backDrawn = false;
    drawn = null;
    patterns = null;
    drawText();
  }

  function place(canvas, w, h, x, y, scale) {
    const dpr = view.dpr;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${(w * scale) / dpr}px`;
    canvas.style.height = `${(h * scale) / dpr}px`;
    canvas.style.left = `${x / dpr}px`;
    canvas.style.top = `${y / dpr}px`;
  }

  const rowOf = (Z) => view.hyL + view.Dl / Z;
  const unit = (Z) => view.N / (Z * view.s);
  const xOf = (X, Z) => view.AX + X * unit(Z);
  const depthOf = (y) => view.Dl / (y + 0.5 - view.hyL);
  const nearDepth = () => (view.Dl / (view.LH - view.hyL)) * 0.7;

  function camera(t) {
    const p = Math.min(1, t / APPROACH_MS);
    return CAMERA_SPEED * APPROACH_MS * p * p * 0.5 + CAMERA_SPEED * Math.max(0, t - APPROACH_MS);
  }

  function paintSky() {
    const { LW, hyL } = view;
    const layer = document.createElement("canvas");
    layer.width = LW;
    layer.height = hyL;
    const c = layer.getContext("2d");
    const image = c.createImageData(LW, hyL);
    const d = image.data;
    for (let y = 0; y < hyL; y++) {
      const f = y / Math.max(1, hyL - 1);
      let i = 0;
      while (i < skyStops.length - 2 && f > skyStops[i + 1].at) i++;
      const a = skyStops[i];
      const b = skyStops[i + 1];
      const level = Math.round(Math.min(1, Math.max(0, (f - a.at) / (b.at - a.at))) * 16);
      for (let x = 0; x < LW; x++) {
        const color = bayer(x, y) < level ? b.rgb : a.rgb;
        const at = (y * LW + x) * 4;
        d[at] = color[0];
        d[at + 1] = color[1];
        d[at + 2] = color[2];
        d[at + 3] = 255;
      }
    }
    c.putImageData(image, 0, 0);
    const keep = ctx;
    ctx = c;
    sun();
    ctx = keep;
    return layer;
  }

  function cloud(cx, cy, w, body, shade) {
    const r = Math.max(3, Math.round(w / 5));
    const parts = [[-w / 2 + r, 0, r], [-w / 6, -r * 0.7, r * 1.3], [w / 6, -r * 0.4, r * 1.1], [w / 2 - r, 0, r]];
    for (const [dx, dy, rr] of parts) disc(Math.round(cx + dx), Math.round(cy + dy + 1), Math.round(rr), shade);
    for (const [dx, dy, rr] of parts) disc(Math.round(cx + dx), Math.round(cy + dy), Math.round(rr), body);
    rect(cx - w / 2 + r - 1, cy + 1, w - 2 * r + 2, r, body);
    rect(cx - w / 2 + 1, cy + r, w - 2, 2, shade);
  }

  const cloudList = [];
  function buildClouds() {
    const rnd = seeded(variant.length * 17);
    const sunset = variant === "sunset";
    for (let i = 0; i < (sunset ? 5 : 6); i++) {
      const ry = rnd();
      const w = Math.round(sunset ? 30 + rnd() * 40 : 18 + rnd() * 26);
      const speed = 0.002 + rnd() * 0.003;
      cloudList.push({ ry, w, speed, rx: rnd(), sprite: sunset ? null : cloudSprite(w) });
    }
  }

  function cloudSprite(w) {
    const r = Math.max(3, Math.round(w / 5));
    const ox = Math.ceil(w / 2) + 4;
    const oy = 3 * r + 4;
    const canvas = document.createElement("canvas");
    canvas.width = ox * 2;
    canvas.height = oy + r + 6;
    const keep = ctx;
    ctx = canvas.getContext("2d");
    cloud(ox, oy, w, P.cloud, P["cloud-shade"]);
    ctx = keep;
    return { canvas, ox, oy };
  }

  function clouds(t) {
    const span = view.LW + 80;
    for (const c of cloudList) {
      const y = Math.round(8 + c.ry * (view.hyL - 40));
      const x = ((c.rx * span + t * c.speed) % span) - 40;
      if (c.sprite) ctx.drawImage(c.sprite.canvas, Math.round(x) - c.sprite.ox, y - c.sprite.oy);
      else {
        rect(x, y, c.w, 2, P.cloud);
        rect(x + 4, y + 2, c.w - 10, 1, P["cloud-shade"]);
      }
    }
  }

  function sun() {
    if (variant === "sunset") {
      const cx = view.AX;
      const cy = view.hyL - 10;
      const r = Math.round(Math.min(30, view.LW * 0.2));
      disc(cx, cy, r + 3, P["sun-rim"]);
      disc(cx, cy, r, P["sun-mid"]);
      disc(cx, cy, r - 5, P["sun-core"]);
      for (let k = 0; k < 4; k++) rect(cx - r - 4, cy + 4 + k * 4, (r + 4) * 2 + 1, 1 + (k > 1 ? 1 : 0), P["sun-band"]);
    } else {
      const cx = Math.round(view.LW * 0.82);
      disc(cx, 16, 9, P["sun-rim"]);
      disc(cx, 16, 7, P["sun-core"]);
    }
  }

  function drawStrip() {
    const rows = STRIP_ROWS[variant];
    let left = view.AX - Math.floor(strip.width / 2);
    while (left > 0) left -= strip.width;
    for (let x = left; x < view.LW; x += strip.width) ctx.drawImage(strip, 0, 0, strip.width, rows, x, view.hyL - rows, strip.width, rows);
  }

  function ground(C) {
    const { hyL, LH, LW } = view;
    let from = hyL;
    let last = "";
    for (let y = hyL; y <= LH; y++) {
      let color = "";
      if (y < LH) {
        const Z = depthOf(y);
        color = P["ground-near"];
        if (Z > 9) color = P["ground-far"];
        else if (band) color = (view.Dl / (Z * Z)) * band < 2 ? P["ground-far"] : Math.floor((Z - C) / band) % 2 ? P["ground-a"] : P["ground-b"];
        else if (Z > 4) color = P["ground-mid"];
      }
      if (color === last) continue;
      if (last) rect(0, from, LW, y - from, last);
      from = y;
      last = color;
    }
  }

  function path() {
    const { hyL, LH } = view;
    for (let y = hyL; y < LH; y++) {
      const half = PATH_HALF * unit(depthOf(y));
      if (half < 0.5) continue;
      const l = Math.round(view.AX - half);
      const r = Math.round(view.AX + half);
      rect(l, y, r - l + 1, 1, P.path);
      const edge = Math.max(1, Math.round(half * 0.08));
      rect(l, y, edge, 1, P["path-edge"]);
      rect(r - edge + 1, y, edge, 1, P["path-edge"]);
    }
  }

  const items = [];
  function buildItems() {
    const rnd = seeded(variant.length * 101);
    const add = (kind, X, Zw, extra) => {
      const small = kind === "flower" || kind === "tuft" || kind === "pebble";
      items.push({ kind, X, Zw: small ? Zw % LOOP_SMALL : Zw, small, Z: 0, ...extra });
    };
    if (variant === "meadow") {
      for (let Zw = 0; Zw < LOOP_DEPTH; Zw += 2) for (const side of [-1, 1]) add("post", side * (PATH_HALF + 16), Zw, { side });
      for (let i = 0; i < 140; i++) add("flower", (rnd() < 0.5 ? -1 : 1) * (PATH_HALF + 4 + rnd() * 120), rnd() * LOOP_DEPTH, { color: ["flower-a", "flower-b", "flower-c"][Math.floor(rnd() * 3)] });
      for (let i = 0; i < 90; i++) add("tuft", (rnd() < 0.5 ? -1 : 1) * (PATH_HALF + 2 + rnd() * 140), rnd() * LOOP_DEPTH);
      for (let i = 0; i < 40; i++) add("pebble", (rnd() * 2 - 1) * (PATH_HALF - 4), rnd() * LOOP_DEPTH);
    } else {
      for (let Zw = 1; Zw < LOOP_DEPTH; Zw += 3) for (const side of [-1, 1]) add("lamp", side * (PATH_HALF + 8), Zw);
      for (let i = 0; i < 320; i++) add("flower", (rnd() < 0.5 ? -1 : 1) * (PATH_HALF + 3 + rnd() * 130), rnd() * LOOP_DEPTH, { color: ["flower-a", "flower-b", "flower-c", "flower-d"][Math.floor(rnd() * 4)] });
      for (let i = 0; i < 30; i++) add("pebble", (rnd() * 2 - 1) * (PATH_HALF - 4), rnd() * LOOP_DEPTH);
    }
  }

  const placed = [];
  const posts = { "-1": [], 1: [] };
  function drawItems(C) {
    const near = nearDepth();
    placed.length = 0;
    for (const it of items) {
      const loop = it.small ? LOOP_SMALL : LOOP_DEPTH;
      it.Z = near + ((((it.Zw + C) % loop) + loop) % loop);
      if (rowOf(it.Z) > view.hyL + 1) placed.push(it);
    }
    placed.sort((a, b) => b.Z - a.Z);
    posts["-1"].length = 0;
    posts[1].length = 0;
    for (const it of placed) {
      const k = unit(it.Z);
      const x = xOf(it.X, it.Z);
      const y = rowOf(it.Z);
      if (it.kind === "post") posts[it.side].push({ x, y, k, Z: it.Z });
      else if (it.kind === "flower") {
        if (2 * k < 0.4) continue;
        const size = Math.max(1, Math.round(2 * k));
        rect(x - size / 2, y - size, size, size, P[it.color]);
        if (size >= 3) rect(x - size / 2 + 1, y - size + 1, size - 2, size - 2, P["flower-core"]);
      } else if (it.kind === "tuft") {
        const h = Math.round(4 * k);
        if (h < 1) continue;
        ctx.fillStyle = P.tuft;
        for (const dx of [-1, 0, 1]) ctx.fillRect(Math.round(x + dx * Math.max(1, k)), Math.round(y - h + (dx ? 1 : 0)), Math.max(1, Math.round(k * 0.7)), h - (dx ? 1 : 0));
      } else if (it.kind === "pebble") {
        const size = Math.round(1.6 * k);
        if (size >= 1) rect(x, y - size, size + 1, size, P.pebble);
      } else lamp(x, y, k);
    }
    for (const side of [-1, 1]) {
      const list = posts[side];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const h = 16 * p.k;
        const w = Math.max(1, Math.round(2.4 * p.k));
        if (h < 2) continue;
        const next = list[i + 1];
        if (next && next.Z < p.Z && p.Z - next.Z < 3) for (const at of [0.3, 0.7]) line(p.x, p.y - h * at, next.x, next.y - 16 * next.k * at, P["wood-dark"]);
        rect(p.x - w / 2, p.y - h, w, h, P.wood);
        rect(p.x - w / 2, p.y - h, Math.max(1, Math.round(w / 3)), h, P["wood-dark"]);
      }
    }
  }

  function lamp(x, y, k) {
    const h = Math.round(30 * k);
    if (h < 3) return;
    const w = Math.max(1, Math.round(1.6 * k));
    rect(x - w / 2, y - h, w, h, P.pole);
    const head = Math.max(2, Math.round(5 * k));
    rect(x - head / 2, y - h - head, head, head, P.lamp);
    if (head >= 4) rect(x - head / 2 + 1, y - h - head + 1, head - 2, head - 2, P["lamp-core"]);
  }

  function approach(t) {
    const { k0, N } = view;
    const z0 = N / k0;
    const p = Math.min(1, t / APPROACH_MS);
    const eased = 1 - (1 - p) * (1 - p);
    const z = z0 + (1 - z0) * eased;
    return { k: N / z, feet: view.hy + (view.feetEnd - view.hy) / z };
  }

  let drawn = null;
  function drawFront(t) {
    ctx = fctx;
    fctx.setTransform(1, 0, 0, 1, -view.fx, -view.fy);
    if (drawn) fctx.clearRect(drawn[0], drawn[1], drawn[2], drawn[3]);
    const { k, feet } = approach(t);
    if (k < view.N) stat.approach++;
    const u = cat.union;
    const bottom = Math.round(feet);
    const left = Math.round(view.axis - (u.w * k) / 2);
    const top = Math.round(bottom - u.h * k);
    const x0 = Math.floor(Math.min(left, view.axis - 13 * k)) - 2;
    const y0 = top - 2;
    drawn = [x0, y0, Math.ceil(Math.max(left + u.w * k, view.axis + 13 * k)) + 2 - x0, Math.ceil(bottom + k) + 2 - y0];
    fctx.fillStyle = P.shadow;
    for (const [row, w] of [[-1, 20], [0, 26], [1, 20]]) {
      const y0 = Math.round(bottom + (row - 1) * k);
      const y1 = Math.round(bottom + row * k);
      const x0 = Math.round(view.axis - (w * k) / 2);
      fctx.fillRect(x0, y0, Math.round(view.axis + (w * k) / 2) - x0, Math.max(1, y1 - y0));
    }
    const frame = (Math.floor(t / FRAME_MS) + CONTACT_FRAME) % FRAMES;
    const S = cat.size;
    const dx = Math.round(left - u.x0 * k);
    const dy = Math.round(top - u.y0 * k);
    fctx.drawImage(cat.sheet, frame * S, 0, S, S, dx, dy, Math.round(left + (S - u.x0) * k) - dx, Math.round(top + (S - u.y0) * k) - dy);
    ctx = bctx;
  }

  function drawText() {
    const { tw, th, tk } = view;
    const w = mask.width + 2;
    const h = mask.height + 2;
    const work = document.createElement("canvas");
    work.width = w;
    work.height = h;
    const c = work.getContext("2d");
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) c.drawImage(mask, dx, dy);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = textEdge;
    c.fillRect(0, 0, w, h);
    const inner = document.createElement("canvas");
    inner.width = w;
    inner.height = h;
    const ic = inner.getContext("2d");
    ic.drawImage(mask, 1, 1);
    ic.globalCompositeOperation = "source-in";
    ic.fillStyle = textInk;
    ic.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "source-over";
    c.drawImage(inner, 0, 0);
    tctx.clearRect(0, 0, tw, th);
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(work, 0, 0, w * tk, h * tk);
  }

  let backDrawn = false;
  function render(t) {
    ctx = bctx;
    if (home) {
      if (!backDrawn) {
        rect(0, 0, view.LW, view.LH, P.fill);
        bctx.drawImage(strip, view.AX - HOME_VP_X, view.hyL - HOME_VP_Y);
        backDrawn = true;
      }
    } else {
      const C = camera(t);
      bctx.drawImage(skyLayer, 0, 0);
      clouds(t);
      drawStrip();
      ground(C);
      path();
      drawItems(C);
    }
    drawFront(t);
  }

  function pattern(c, level, cell) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 4 * cell;
    const g = tile.getContext("2d");
    g.fillStyle = textEdge;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bayer(x, y) < level) g.fillRect(x * cell, y * cell, cell, cell);
    return c.createPattern(tile, "repeat");
  }

  function cut(c, fill, ox, oy, w, h) {
    c.save();
    c.globalCompositeOperation = "destination-out";
    c.setTransform(1, 0, 0, 1, ox, oy);
    c.fillStyle = fill;
    c.fillRect(-ox, -oy, w, h);
    c.restore();
  }

  function dissolve(step) {
    const level = (16 * step) / FADE_STEPS;
    if (!patterns || patterns.level !== level) patterns = { level, back: pattern(bctx, level, 1), front: pattern(fctx, level, view.s), text: pattern(tctx, level, view.s) };
    const { offX, fx, fy, tx, ty } = view;
    cut(bctx, patterns.back, 0, 0, view.LW, view.LH);
    cut(fctx, patterns.front, offX - fx, -fy, view.fw, view.fh);
    cut(tctx, patterns.text, offX - tx, -ty, view.tw, view.th);
  }

  let lastTick = -1;
  let dirty = true;
  let prev = 0;
  let fadeAt = -1;
  function loop() {
    if (api.closedAt) return;
    const now = performance.now();
    if (!api.startAt) api.startAt = prev = now;
    const gap = now - prev;
    prev = now;
    stat.frames++;
    stat.gap = Math.max(stat.gap, gap);
    stat.held += Math.max(0, gap - STEP_MAX_MS);
    const t = (stat.clock += Math.min(gap, STEP_MAX_MS));
    if (fadeAt < 0 && api.readyAt && (t >= MIN_MS || now - api.startAt >= LONG_MS)) fadeAt = t;
    const tick = Math.floor(t / TICK_MS);
    if (fadeAt >= 0) {
      const step = Math.floor((t - fadeAt) / FADE_STEP_MS) + 1;
      if (step > FADE_STEPS) return close();
      if (tick !== lastTick || dirty || !patterns || patterns.level !== (16 * step) / FADE_STEPS) {
        lastTick = tick;
        dirty = false;
        render(tick * TICK_MS);
        dissolve(step);
      }
    } else if (dirty || tick !== lastTick) {
      lastTick = tick;
      dirty = false;
      render(tick * TICK_MS);
    }
    requestAnimationFrame(loop);
  }

  startDebug(() => {
    const ms = (v) => (v ? `+${Math.round(v)}ms` : "-");
    const u = cat.union;
    return [
      `variant ${variant} · device ${view.vw ?? "-"}x${view.vh ?? "-"} · s ${view.s ?? "-"} · k0 ${view.k0 ?? "-"} · N ${view.N ?? "-"}`,
      `cat ${u && view.N ? `${u.w * view.N}x${u.h * view.N} top ${view.top}` : "-"} · text ${view.tw ?? "-"}x${view.th ?? "-"}`,
      `first ${ms(api.startAt)} · elapsed ${api.startAt ? Math.round((api.closedAt || performance.now()) - api.startAt) : "-"}ms · anim ${Math.round(stat.clock)}ms`,
      `frames ${stat.frames} · approach ${stat.approach} · max gap ${Math.round(stat.gap)}ms · held ${Math.round(stat.held)}ms`,
      `ready ${ms(api.readyAt)} · closed ${ms(api.closedAt)}`,
    ];
  }, () => !api.closedAt);

  plan.images
    .then(([catImage, stripImage, textImage]) => {
      if (api.closedAt) return;
      measureCat(catImage);
      strip = stripImage;
      mask = textImage;
      if (!home) {
        buildItems();
        buildClouds();
      }
      fit();
      render(0);
      delete splash.dataset.variant;
      dirty = false;
      lastTick = 0;
      addEventListener("resize", () => {
        if (api.closedAt) return;
        fit();
        dirty = true;
      });
      requestAnimationFrame(loop);
    })
    .catch(close);
})();
