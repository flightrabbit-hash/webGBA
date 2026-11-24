// 화면 필터(설계 38절): 확대·효과·화면 정의, 설정값 → 셰이더 체인, WebGL2 후처리 엔진, ② script 게임용 SVG 색 필터.
import { VS, PROGRAMS } from "./filter-shaders.js";

export const SECTION_IDS = ["scale", "color", "display"];
export const NEUTRAL = { scale: "nearest", color: "none", display: "none" };
export const USER_MAX = 5;
export const NAME_MAX = 12;

const SMOOTH_METHODS = [
  { v: "omni", t: "OmniScale", cost: 2 },
  { v: "scalefx", t: "ScaleFX", cost: 3 },
  { v: "xbr", t: "xBR", cost: 2 },
  { v: "hq2x", t: "HQ2x", cost: 2 },
  { v: "scale2x", t: "Scale2x", cost: 1 },
];

const range = (k, min, max, step, def, unit, extra = {}) => ({ k, type: "range", min, max, step, def, unit, ...extra });

export const FILTERS = {
  scale: [
    { id: "nearest", cost: 0, details: [] },
    { id: "sharp", cost: 1, details: [range("edge", 5, 30, 1, 10, "px10")], uniforms: (d) => ({ p: [d.edge / 10] }) },
    { id: "bilinear", cost: 0, details: [] },
    { id: "sharpen", cost: 1, details: [range("amount", 0, 150, 5, 70, "pct")], uniforms: (d) => ({ p: [d.amount / 100] }) },
    {
      id: "smooth",
      cost: (d) => SMOOTH_METHODS.find((m) => m.v === d.method)?.cost ?? 2,
      details: [
        { k: "method", type: "chips", def: "omni", options: SMOOTH_METHODS },
        range("sfxEdge", 5, 30, 1, 10, "px10", { when: (d) => d.method === "scalefx" }),
        range("xbrEdge", 5, 20, 1, 10, "dec10", { when: (d) => d.method === "xbr" }),
        { k: "xbrDetail", type: "switch", def: false, when: (d) => d.method === "xbr" },
        { k: "aa", type: "switch", def: false, when: (d) => d.method === "scale2x" },
      ],
    },
    {
      id: "toon",
      cost: 3,
      details: [range("thick", 30, 150, 5, 60, "dec100"), range("ink", 0, 100, 5, 90, "pct"), range("levels", 3, 10, 1, 6, "levels"), range("thr", 20, 160, 5, 70, "dec100", { adv: true })],
      uniforms: (d) => ({ p: [d.thick / 100, d.levels, d.ink / 100, d.thr / 100] }),
    },
  ],
  color: [
    { id: "none", cost: 0, details: [] },
    { id: "gray", cost: 1, css: true, details: [range("contrast", 50, 150, 5, 100, "pct")], uniforms: (d) => ({ p: [d.contrast / 100] }) },
    { id: "sepia", cost: 1, css: true, details: [range("contrast", 50, 150, 5, 100, "pct")], uniforms: (d) => ({ p: [d.contrast / 100] }) },
    {
      id: "dmg",
      cost: 1,
      css: true,
      details: [
        { k: "levels", type: "seg", def: 4, options: [{ v: 2 }, { v: 3 }, { v: 4 }] },
        range("dither", 0, 100, 5, 50, "pct", { lock: (d, ctx) => (ctx.cssOnly ? "dither" : null) }),
        range("bright", -50, 50, 5, 0, "signed"),
      ],
      uniforms: (d, ctx) => ({ p: [d.levels, 0.9 * Math.pow(2, -d.bright / 100), ctx.cssOnly ? 0 : d.dither / 100] }),
    },
    {
      id: "satcon",
      cost: 1,
      css: true,
      details: [range("sat", 0, 200, 5, 130, "pct"), range("con", 50, 160, 5, 110, "pct"), range("bri", -30, 30, 2, 2, "signed")],
      uniforms: (d) => ({ p: [d.sat / 100, d.con / 100, d.bri / 100] }),
    },
    { id: "invert", cost: 1, css: true, details: [] },
    {
      id: "cvd",
      cost: 1,
      css: false,
      details: [
        { k: "type", type: "seg", def: 1, options: [{ v: 0 }, { v: 1 }, { v: 2 }] },
        { k: "mode", type: "seg", def: 0, options: [{ v: 0 }, { v: 1 }], descByValue: true },
      ],
      uniforms: (d) => ({ p: [d.type, d.mode] }),
    },
  ],
  display: [
    { id: "none", cost: 0, details: [] },
    {
      id: "crt",
      cost: 2,
      details: [
        range("curve", 0, 100, 5, 25, "curve", { lock: (d, ctx) => (ctx.touch ? "curve" : null) }),
        range("corner", 0, 100, 5, 25, "pct", { lock: (d, ctx) => (ctx.touch || !d.curve ? "corner" : null) }),
        range("scan", 0, 100, 5, 75, "pct"),
        range("mask", 0, 100, 5, 30, "pct"),
        range("bloom", 0, 100, 5, 30, "pct"),
      ],
      uniforms: (d, ctx, s) => {
        const g = crtGeometry(d, ctx, s);
        return { p: [(d.scan / 100) * s, g.curve, (d.bloom / 100) * s, (d.mask / 100) * s], q: [g.corner] };
      },
    },
    {
      id: "lcd",
      cost: 1,
      details: [range("grid", 0, 100, 5, 60, "pct"), range("tint", 0, 100, 5, 50, "pct"), range("ghost", 0, 85, 5, 0, "pct"), range("stripe", 0, 100, 5, 25, "pct", { adv: true })],
      uniforms: (d, ctx, s) => ({ p: [(d.grid / 100) * s, (d.tint / 100) * s, (d.stripe / 100) * s], ghost: (d.ghost / 100) * s }),
    },
    {
      id: "dot",
      cost: 1,
      details: [range("size", 50, 98, 2, 86, "pct"), range("shadow", 0, 100, 5, 60, "pct"), { k: "paper", type: "seg", def: 80, options: [{ v: 0 }, { v: 50 }, { v: 80 }] }, range("ghost", 0, 85, 5, 30, "pct")],
      uniforms: (d, ctx, s) => ({ p: [d.size / 100, d.shadow / 100, d.paper / 100], q: [s], ghost: (d.ghost / 100) * s }),
    },
    { id: "ghost", cost: 1, details: [range("amount", 0, 90, 5, 60, "pct")], uniforms: (d, ctx, s) => ({ ghost: (d.amount / 100) * s }) },
  ],
};

export const filterOf = (sec, id) => FILTERS[sec].find((f) => f.id === id) ?? FILTERS[sec][0];
export const isNeutral = (sec, id) => NEUTRAL[sec] === id;

export function costOf(sec, id, d) {
  const f = filterOf(sec, id);
  return typeof f.cost === "function" ? f.cost(d) : f.cost;
}

export function defaultsOf(sec, id) {
  const out = {};
  for (const x of filterOf(sec, id).details) out[x.k] = x.def;
  return out;
}

export function blankLook() {
  return { scale: { id: "nearest", s: 100, d: {} }, color: { id: "none", s: 100, d: {} }, display: { id: "none", s: 100, d: {} } };
}

export function makeLook(part = {}) {
  const look = blankLook();
  for (const sec of SECTION_IDS) {
    const p = part[sec];
    if (!p) continue;
    look[sec].id = p.id ?? look[sec].id;
    look[sec].s = p.s ?? 100;
    if (p.d) look[sec].d[look[sec].id] = { ...p.d };
  }
  return look;
}

export function detailOf(look, sec) {
  const id = look[sec].id;
  return { ...defaultsOf(sec, id), ...(look[sec].d[id] ?? {}) };
}

export function sameLook(a, b) {
  for (const sec of SECTION_IDS) {
    if (a[sec].id !== b[sec].id) return false;
    if (!isNeutral(sec, a[sec].id) && a[sec].s !== b[sec].s) return false;
    const da = detailOf(a, sec);
    const db = detailOf(b, sec);
    for (const k of Object.keys(da)) if (da[k] !== db[k]) return false;
  }
  return true;
}

export const anyFilter = (look) => SECTION_IDS.some((sec) => !isNeutral(sec, look[sec].id));

const clampNum = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

function cleanDetail(sec, id, raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const x of filterOf(sec, id).details) {
    const v = raw[x.k];
    if (v === undefined) continue;
    if (x.type === "range") out[x.k] = clampNum(Number(v), x.min, x.max, x.def);
    else if (x.type === "switch") out[x.k] = Boolean(v);
    else if (x.options.some((o) => o.v === v)) out[x.k] = v;
  }
  return out;
}

export function cleanLook(raw) {
  const look = blankLook();
  if (!raw || typeof raw !== "object") return look;
  for (const sec of SECTION_IDS) {
    const p = raw[sec];
    if (!p || typeof p !== "object") continue;
    if (FILTERS[sec].some((f) => f.id === p.id)) look[sec].id = p.id;
    look[sec].s = Math.round(clampNum(Number(p.s), 0, 100, 100) / 5) * 5;
    if (p.d && typeof p.d === "object") for (const f of FILTERS[sec]) if (p.d[f.id]) look[sec].d[f.id] = cleanDetail(sec, f.id, p.d[f.id]);
  }
  return look;
}

const cleanName = (raw) => [...String(raw ?? "").trim()].slice(0, NAME_MAX).join("");

// 저장 형식 { global: { look, base }, games: { <게임 id>: { look, base, title } }, user: [{ id, name, look }] }
export function cleanStore(raw) {
  const out = { global: { look: blankLook(), base: "orig" }, games: {}, user: [] };
  if (!raw || typeof raw !== "object") return out;
  const rec = (r) => ({ look: cleanLook(r?.look), base: typeof r?.base === "string" ? r.base : null });
  if (raw.global) out.global = rec(raw.global);
  if (raw.games && typeof raw.games === "object") {
    for (const [gid, r] of Object.entries(raw.games)) if (gid && r && typeof r === "object") out.games[gid] = { ...rec(r), title: String(r.title ?? "").slice(0, 80) };
  }
  if (Array.isArray(raw.user)) {
    for (const u of raw.user.slice(0, USER_MAX)) if (u && typeof u.id === "string" && cleanName(u.name)) out.user.push({ id: u.id.slice(0, 24), name: cleanName(u.name), look: cleanLook(u.look) });
  }
  return out;
}

export function crtGeometry(d, ctx, s) {
  const curve = ctx.touch ? 0 : (d.curve / 100) * s;
  const ramp = Math.min(1, curve / 0.05);
  return { curve, corner: (d.corner / 100) * 0.22 * s * ramp };
}

// ctx: { cssOnly, touch, ff, phone, compare, unsupported }
export function resolveChain(look, ctx = {}) {
  const neutral = { color: { key: "c:none", p: [], q: [1] }, scale: { kind: "nearest", p: [], s: 1 }, display: null, ghost: 0 };
  if (ctx.compare || ctx.unsupported) return neutral;
  const out = { ...neutral };
  const cs = look.color;
  const cd = detailOf(look, "color");
  const cf = filterOf("color", cs.id);
  if (cs.id !== "none" && !(ctx.cssOnly && !cf.css)) out.color ={ key: `c:${cs.id}`, p: cf.uniforms ? cf.uniforms(cd, ctx).p : [], q: [cs.s / 100] };
  if (!ctx.cssOnly) {
    const ss = look.scale;
    const sd = detailOf(look, "scale");
    const sf = filterOf("scale", ss.id);
    let kind = ss.id;
    let p = [];
    if (ss.id === "smooth") {
      kind = sd.method;
      if (kind === "scalefx") p = [sd.sfxEdge / 10];
      if (kind === "xbr") p = [sd.xbrEdge / 10, sd.xbrDetail ? 1 : 0];
      if (kind === "scale2x") p = [sd.aa ? 1 : 0];
    } else if (sf.uniforms) p = sf.uniforms(sd, ctx).p;
    if (ctx.ff && ctx.phone && costOf("scale", ss.id, sd) >= 3) kind = "nearest";
    out.scale = { kind, p, s: ss.s / 100 };
    const ds = look.display;
    const dd = detailOf(look, "display");
    const df = filterOf("display", ds.id);
    if (ds.id !== "none") {
      const u = df.uniforms(dd, ctx, ds.s / 100);
      out.display = ds.id === "ghost" ? null : { key: `d:${ds.id}`, p: u.p ?? [], q: u.q ?? [] };
      out.ghost = ctx.ff ? 0 : u.ghost ?? 0;
    }
  }
  return out;
}

export function chainIsPlain(chain) {
  return chain.color.key === "c:none" && chain.scale.kind === "nearest" && !chain.display && !(chain.ghost > 0.001);
}

// CRT 곡면·모서리에 맞춘 바깥 테두리 반경(CSS px). DISPLAY.crt 와 같은 식으로 화면 모서리 대각선의 그림 시작 지점을 찾는다
export function crtFrameRadius(look, ctx, w, h) {
  if (ctx.compare || ctx.unsupported || ctx.cssOnly || look.display.id !== "crt") return 0;
  const g = crtGeometry(detailOf(look, "display"), ctx, look.display.s / 100);
  if (g.curve <= 0) return 0;
  const k = g.curve * 0.22;
  const hx = w / 2;
  const hy = h / 2;
  const rr = g.corner * Math.min(hx, hy);
  const inside = (x, y) => {
    let cx = (x / w) * 2 - 1;
    let cy = (y / h) * 2 - 1;
    const nx = cx * (1 + k * cy * cy);
    const ny = cy * (1 + k * cx * cx);
    cx = nx / (1 + k * 0.35);
    cy = ny / (1 + k * 0.35);
    if (Math.abs(cx) > 1 || Math.abs(cy) > 1) return false;
    const qx = Math.abs(cx) * hx - (hx - rr);
    const qy = Math.abs(cy) * hy - (hy - rr);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr <= 0;
  };
  let t0 = 0;
  for (let t = 0; t < Math.min(hx, hy); t += 0.25) {
    if (inside(t, t)) {
      t0 = t;
      break;
    }
  }
  if (t0 < 0.5) return 0;
  return Math.min(Math.max(0, t0 - 0.75) / (1 - Math.SQRT1_2), Math.min(hx, hy) * 0.6);
}

export function loadScore(look, ctx = {}) {
  if (ctx.cssOnly) return { score: look.color.id === "none" ? 0 : 1, heavy: false };
  let score = 0;
  let heavy = false;
  for (const sec of SECTION_IDS) {
    const c = costOf(sec, look[sec].id, detailOf(look, sec));
    score += c;
    if (c >= 3) heavy = true;
  }
  const d = detailOf(look, "display");
  if (["lcd", "dot", "ghost"].includes(look.display.id) && (d.ghost ?? d.amount) > 0) score += 1;
  if (look.scale.id !== "nearest" && look.scale.s < 100) score += 1;
  return { score, heavy };
}

export const loadLevel = (score, heavy) => (heavy || score >= 5 ? 2 : score >= 3 ? 1 : 0);
export const costLevel = (cost) => (cost >= 3 ? 2 : cost >= 2 ? 1 : 0);

// 휴대폰 무거운 조합 → 가볍게 변경 계획. what = 원인 키(scalefx·toon·stack)
export function lightenPlan(look) {
  const sd = detailOf(look, "scale");
  if (look.scale.id === "smooth" && sd.method === "scalefx") return { what: "scalefx", apply: (l) => (l.scale.d.smooth = { ...detailOf(l, "scale"), method: "omni" }) };
  if (look.scale.id === "toon") {
    return {
      what: "toon",
      apply: (l) => {
        l.scale.id = "smooth";
        l.scale.d.smooth = { ...defaultsOf("scale", "smooth"), method: "omni" };
      },
    };
  }
  return { what: "stack", apply: (l) => (l.display.id = "none") };
}

export const BUILTIN = [
  { id: "orig", look: makeLook() },
  { id: "pixel", look: makeLook({ scale: { id: "sharp" } }) },
  { id: "gba", look: makeLook({ scale: { id: "sharp" }, display: { id: "lcd", d: { grid: 60, tint: 50, ghost: 20, stripe: 25 } } }) },
  { id: "crt", look: makeLook({ display: { id: "crt" } }) },
  { id: "smooth", look: makeLook({ scale: { id: "smooth", d: { method: "omni" } } }) },
  { id: "gb", look: makeLook({ color: { id: "dmg" }, display: { id: "dot" } }) },
  { id: "sharp3d", look: makeLook({ scale: { id: "sharpen" }, color: { id: "satcon", d: { sat: 120, con: 105, bri: 0 } } }) },
  { id: "vector", look: makeLook({ scale: { id: "toon" } }) },
  { id: "gray", look: makeLook({ color: { id: "gray" } }) },
];

// 설명서 display.filter(게임 추천) → look. 모르는 이름·범위 밖 값은 버림(cleanLook)
export function recommendLook(filter) {
  if (!filter || typeof filter !== "object") return null;
  const part = {};
  for (const sec of SECTION_IDS) {
    const p = filter[sec];
    if (!p) continue;
    const one = typeof p === "string" ? { id: p } : p;
    if (!FILTERS[sec].some((f) => f.id === one.id)) continue;
    part[sec] = { id: one.id, s: one.strength, d: one.detail ?? one.d };
  }
  if (!Object.keys(part).length) return null;
  const raw = blankLook();
  for (const [sec, p] of Object.entries(part)) {
    raw[sec].id = p.id;
    raw[sec].s = p.s ?? 100;
    if (p.d) raw[sec].d[p.id] = p.d;
  }
  return cleanLook(raw);
}

// ② script 게임(틀 화면): 효과만 CSS filter 함수로(틀은 다른 프로세스 화면이라 SVG 참조 필터 url() 미적용). 색약 보정은 미지원(css: false)
const num = (v) => +v.toFixed(3);
export function cssColorFilter(chain) {
  const key = chain.color.key;
  if (key === "c:none") return "";
  const s = chain.color.q[0] ?? 1;
  const p = chain.color.p;
  const by = (amount) => num(1 + (amount - 1) * s);
  if (key === "c:gray") return `grayscale(${num(s)}) contrast(${by(p[0] ?? 1)})`;
  if (key === "c:sepia") return `sepia(${num(s)}) contrast(${by(p[0] ?? 1)})`;
  if (key === "c:invert") return `invert(${num(s)})`;
  if (key === "c:satcon") return `saturate(${by(p[0] ?? 1)}) contrast(${by(p[1] ?? 1)}) brightness(${num(1 + 2 * (p[2] ?? 0) * s)})`;
  if (key === "c:dmg") {
    const bright = Math.sqrt(0.9 / (p[1] ?? 0.9));
    return `grayscale(${num(s)}) sepia(${num(s)}) brightness(${num((1 - 0.41 * s) * (1 + (bright - 1) * s))}) contrast(${num(1 - 0.236 * s)}) sepia(${num(s)}) hue-rotate(${num(36.7 * s)}deg) saturate(${num(1 + 2.31 * s)})`;
  }
  return "";
}

export class FilterEngine {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: preserve, powerPreference: "default" });
    if (!gl) throw new Error("WebGL2");
    this.gl = gl;
    this.floatOk = Boolean(gl.getExtension("EXT_color_buffer_float"));
    this.progs = new Map();
    this.targets = new Map();
    this.vao = gl.createVertexArray();
    const sampler = (f) => {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, f);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, f);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return s;
    };
    this.nearest = sampler(gl.NEAREST);
    this.linear = sampler(gl.LINEAR);
    this.src = null;
    this.srcW = 0;
    this.srcH = 0;
    this.passes = 0;
    this.cpuMs = 0;
    this.historyValid = false;
    this.errors = [];
  }

  get lost() {
    return this.gl.isContextLost();
  }

  setSource(image, w, h) {
    const gl = this.gl;
    const fresh = !this.src || w !== this.srcW || h !== this.srcH;
    if (!this.src) this.src = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (fresh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.srcW = w;
      this.srcH = h;
      this.historyValid = false;
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  program(key) {
    let p = this.progs.get(key);
    if (p) return p;
    const gl = this.gl;
    const compile = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        this.errors.push(`${key}: ${log}`);
        throw new Error(`shader ${key}: ${log}`);
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, PROGRAMS[key]));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link ${key}: ${gl.getProgramInfoLog(prog)}`);
    const u = {};
    for (const name of ["uTex", "uAux", "uIn", "uOut", "uSrc", "uP", "uQ", "uShift", "uTime"]) u[name] = gl.getUniformLocation(prog, name);
    p = { prog, u };
    this.progs.set(key, p);
    return p;
  }

  target(key, w, h, float = false) {
    const gl = this.gl;
    let t = this.targets.get(key);
    const useFloat = float && this.floatOk;
    if (t && t.w === w && t.h === h && t.float === useFloat) return t;
    if (t) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    t = { tex, fbo, w, h, float: useFloat };
    this.targets.set(key, t);
    if (key === "hist" || key === "histNext") this.historyValid = false;
    return t;
  }

  draw(key, { tex, aux = null, linear = false, auxLinear = false, inW, inH, out, outW, outH, p = [0, 0, 0, 0], q = [0, 0, 0, 0], shift = [0, 0], time = 0 }) {
    const gl = this.gl;
    const { prog, u } = this.program(key);
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
    gl.viewport(0, 0, outW, outH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindSampler(0, linear ? this.linear : this.nearest);
    gl.uniform1i(u.uTex, 0);
    if (aux) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, aux);
      gl.bindSampler(1, auxLinear ? this.linear : this.nearest);
      gl.uniform1i(u.uAux, 1);
    }
    gl.uniform2f(u.uIn, inW, inH);
    gl.uniform2f(u.uOut, outW, outH);
    gl.uniform2f(u.uSrc, this.srcW, this.srcH);
    gl.uniform4f(u.uP, p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0);
    gl.uniform4f(u.uQ, q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 0);
    gl.uniform2f(u.uShift, shift[0], shift[1]);
    gl.uniform1f(u.uTime, time);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.passes++;
  }

  // chain = resolveChain() 결과. 순서: 효과(원본 해상도) → 확대(출력 크기, 강도 = 원본 픽셀과 혼합) → 화면 → 잔상 → 캔버스
  render(chain, outW, outH, { shift = [0, 0], ghostReset = false } = {}) {
    if (!this.src) return null;
    outW = Math.max(1, Math.round(outW));
    outH = Math.max(1, Math.round(outH));
    if (this.canvas.width !== outW) this.canvas.width = outW;
    if (this.canvas.height !== outH) this.canvas.height = outH;
    this.passes = 0;
    const W = this.srcW;
    const H = this.srcH;
    const t0 = performance.now();
    const color = this.target("color", W, H);
    this.draw(chain.color.key, { tex: this.src, inW: W, inH: H, out: color, outW: W, outH: H, p: chain.color.p, q: chain.color.q, shift });
    const scaled = this.target("scaled", outW, outH);
    const kind = chain.scale.kind;
    const sp = chain.scale.p;
    if (kind === "scalefx") {
      const m0 = this.target("sfx0", W, H, true);
      const m1 = this.target("sfx1", W, H, true);
      const m2 = this.target("sfx2", W, H, true);
      const m3 = this.target("sfx3", W, H, true);
      const x3 = this.target("sfx4", W * 3, H * 3);
      this.draw("sfx0", { tex: color.tex, inW: W, inH: H, out: m0, outW: W, outH: H });
      this.draw("sfx1", { tex: m0.tex, inW: W, inH: H, out: m1, outW: W, outH: H });
      this.draw("sfx2", { tex: m1.tex, aux: m0.tex, inW: W, inH: H, out: m2, outW: W, outH: H });
      this.draw("sfx3", { tex: m2.tex, inW: W, inH: H, out: m3, outW: W, outH: H });
      this.draw("sfx4", { tex: m3.tex, aux: color.tex, inW: W, inH: H, out: x3, outW: W * 3, outH: H * 3 });
      this.draw("s:sharp", { tex: x3.tex, linear: true, inW: W * 3, inH: H * 3, out: scaled, outW, outH, p: [sp[0] ?? 1] });
    } else if (kind === "toon") {
      const base = this.target("toonBase", outW, outH);
      this.draw("s:omni", { tex: color.tex, inW: W, inH: H, out: base, outW, outH });
      this.draw("toon", { tex: base.tex, linear: true, inW: outW, inH: outH, out: scaled, outW, outH, p: sp });
    } else {
      const linear = kind === "bilinear" || kind === "sharp" || kind === "sharpen";
      this.draw(`s:${kind}`, { tex: color.tex, linear, inW: W, inH: H, out: scaled, outW, outH, p: sp });
    }
    let last = scaled;
    if (kind !== "nearest" && chain.scale.s < 0.999) {
      const mixed = this.target("mixed", outW, outH);
      this.draw("mixn", { tex: scaled.tex, aux: color.tex, inW: outW, inH: outH, out: mixed, outW, outH, p: [chain.scale.s] });
      last = mixed;
    }
    if (chain.display) {
      const disp = this.target("disp", outW, outH);
      this.draw(chain.display.key, { tex: last.tex, linear: chain.display.key === "d:crt", inW: outW, inH: outH, out: disp, outW, outH, p: chain.display.p, q: chain.display.q });
      last = disp;
    }
    if (chain.ghost > 0.001) {
      const hist = this.target("hist", outW, outH);
      const next = this.target("histNext", outW, outH);
      if (!this.historyValid || ghostReset) {
        this.draw("ghost", { tex: last.tex, aux: last.tex, inW: outW, inH: outH, out: hist, outW, outH, p: [0] });
        this.historyValid = true;
      }
      this.draw("ghost", { tex: last.tex, aux: hist.tex, inW: outW, inH: outH, out: next, outW, outH, p: [chain.ghost] });
      this.targets.set("hist", next);
      this.targets.set("histNext", hist);
      last = next;
    } else {
      this.historyValid = false;
    }
    this.draw("blit", { tex: last.tex, inW: outW, inH: outH, out: null, outW, outH });
    this.cpuMs = performance.now() - t0;
    return { passes: this.passes, outW, outH };
  }

  compileAll() {
    for (const key of Object.keys(PROGRAMS)) this.program(key);
  }

  destroy() {
    try {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
  }
}
