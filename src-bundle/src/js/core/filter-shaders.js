// SameBoy Shaders (Expat/MIT, Copyright (c) 2015-2026 Lior Halphon): OmniScale, HQ2x, Scale2x, AAScale2x
// libretro glsl-shaders xBR-lv2 (MIT, Copyright (C) 2011-2016 Hyllian), ScaleFX pass0-4 (MIT, Copyright (c) 2016 Sp00kyFox)
// License texts: THIRD_PARTY_NOTICES

const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTex;
uniform sampler2D uAux;
uniform vec2 uIn;
uniform vec2 uOut;
uniform vec2 uSrc;
uniform vec4 uP;
uniform vec4 uQ;
uniform vec2 uShift;
uniform float uTime;
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
`;

export const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID & 1) << 2), float((gl_VertexID & 2) << 1));
  gl_Position = vec4(p - 1.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- 색 (원본 해상도에서 1회)
const COLOR_WRAP = (body) => `${HEAD}
vec3 srcAt() {
  ivec2 s = ivec2(uIn);
  ivec2 p = ivec2(gl_FragCoord.xy) - ivec2(uShift);
  p = ((p % s) + s) % s;
  return texelFetch(uTex, p, 0).rgb;
}
${body}
void main() { vec3 c = srcAt(); fragColor = vec4(clamp(mix(c, colorize(c), uQ.x), 0.0, 1.0), 1.0); }`;

const COLOR = {
  none: `vec3 colorize(vec3 c) { return c; }`,
  gray: `vec3 colorize(vec3 c) { return vec3((dot(c, LUMA) - 0.5) * uP.x + 0.5); }`,
  sepia: `vec3 colorize(vec3 c) {
    vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
    return (min(s, vec3(1.0)) - 0.5) * uP.x + 0.5;
  }`,
  dmg: `vec3 colorize(vec3 c) {
    float n = uP.x;
    float y = pow(clamp(dot(c, LUMA), 0.0, 1.0), uP.y);
    ivec2 q = ivec2(gl_FragCoord.xy) & 1;
    float bayer = (q.x == 0 ? (q.y == 0 ? 0.0 : 0.75) : (q.y == 0 ? 0.5 : 0.25)) - 0.375;
    float i = clamp(floor(y * n + bayer * uP.z), 0.0, n - 1.0);
    float k = n < 2.5 ? (i < 0.5 ? 0.0 : 3.0) : n < 3.5 ? (i < 0.5 ? 0.0 : i < 1.5 ? 1.0 : 3.0) : i;
    return k < 0.5 ? vec3(0.059, 0.220, 0.059) : k < 1.5 ? vec3(0.188, 0.384, 0.188) : k < 2.5 ? vec3(0.545, 0.675, 0.059) : vec3(0.608, 0.737, 0.059);
  }`,
  invert: `vec3 colorize(vec3 c) { return 1.0 - c; }`,
  satcon: `vec3 colorize(vec3 c) {
    float y = dot(c, LUMA);
    c = mix(vec3(y), c, uP.x);
    return (c - 0.5) * uP.y + 0.5 + uP.z;
  }`,
  cvd: `vec3 colorize(vec3 c) {
    vec3 l = pow(c, vec3(2.2));
    int t = int(uP.x + 0.5);
    vec3 r0, r1, r2;
    if (t == 0) { r0 = vec3(0.152286, 1.052583, -0.204868); r1 = vec3(0.114503, 0.786281, 0.099216); r2 = vec3(-0.003882, -0.048116, 1.051998); }
    else if (t == 1) { r0 = vec3(0.367322, 0.860646, -0.227968); r1 = vec3(0.280085, 0.672501, 0.047413); r2 = vec3(-0.011820, 0.042940, 0.968881); }
    else { r0 = vec3(1.255528, -0.076749, -0.178779); r1 = vec3(-0.078411, 0.930809, 0.147602); r2 = vec3(0.004733, 0.691367, 0.303900); }
    vec3 sim = clamp(vec3(dot(r0, l), dot(r1, l), dot(r2, l)), 0.0, 1.0);
    vec3 o;
    if (uP.y > 0.5) o = sim;
    else {
      vec3 e = l - sim;
      vec3 sh = t == 2 ? vec3(e.r + 0.7 * e.b, e.g + 0.7 * e.b, 0.0) : vec3(0.0, 0.7 * e.r + e.g, 0.7 * e.r + e.b);
      o = l + sh;
    }
    return pow(clamp(o, 0.0, 1.0), vec3(1.0 / 2.2));
  }`,
};

// ---------------------------------------------------------------- 확대
const POS = `vec2 pos = gl_FragCoord.xy / uOut;`;

const SCALE_SIMPLE = {
  nearest: `${HEAD}void main() { ${POS} fragColor = vec4(texelFetch(uTex, ivec2(floor(pos * uIn)), 0).rgb, 1.0); }`,
  bilinear: `${HEAD}void main() { ${POS} fragColor = vec4(texture(uTex, pos).rgb, 1.0); }`,
  sharp: `${HEAD}void main() {
    ${POS}
    vec2 sc = max(uOut / uIn, vec2(1.0));
    vec2 t = pos * uIn;
    vec2 fl = floor(t);
    vec2 f = fract(t) - 0.5;
    float w = max(uP.x, 0.25);
    vec2 reg = clamp(0.5 - 0.5 * w / sc, 0.0, 0.5);
    vec2 g = (f - clamp(f, -reg, reg)) * (sc / w) + 0.5;
    fragColor = vec4(texture(uTex, (fl + g) / uIn).rgb, 1.0);
  }`,
  sharpen: `${HEAD}void main() {
    ${POS}
    vec2 d = 1.0 / uIn;
    vec3 c = texture(uTex, pos).rgb;
    vec3 n = texture(uTex, pos + vec2(0.0, -d.y)).rgb;
    vec3 s = texture(uTex, pos + vec2(0.0, d.y)).rgb;
    vec3 e = texture(uTex, pos + vec2(d.x, 0.0)).rgb;
    vec3 w = texture(uTex, pos + vec2(-d.x, 0.0)).rgb;
    vec3 blur = (n + s + e + w) * 0.25;
    vec3 r = c + uP.x * 2.0 * (c - blur);
    vec3 mn = min(c, min(min(n, s), min(e, w)));
    vec3 mx = max(c, max(max(n, s), max(e, w)));
    r = clamp(r, mn - 0.03, mx + 0.03);
    fragColor = vec4(clamp(r, 0.0, 1.0), 1.0);
  }`,
};

// SameBoy MasterShader 대역 틀(감마 2.2 선형화, texture_relative) + 각 scale() 본문
const SAMEBOY_WRAP = (body) => `${HEAD}
#define STATIC
#define GAMMA 2.2
#define equal(x, y) ((x) == (y))
#define inequal(x, y) ((x) != (y))
vec4 _texture(sampler2D t, vec2 p) { return pow(texture(t, p), vec4(GAMMA)); }
vec4 texture_relative(sampler2D t, vec2 p, vec2 offset) {
  vec2 r = vec2(textureSize(t, 0));
  return _texture(t, (floor(p * r) + offset + vec2(0.5)) / r);
}
${body.replace(/\btexture\(/g, "_texture(")}
void main() {
  ${POS}
  vec4 c = scale(uTex, pos, uIn, uOut);
  fragColor = vec4(pow(clamp(c.rgb, 0.0, 1.0), vec3(1.0 / GAMMA)), 1.0);
}`;

// SameBoy Shaders/OmniScale.fsh (Expat, Lior Halphon) — 원문 그대로, ES 3.00 문법만 맞춤
const OMNISCALE = `
STATIC vec3 rgb_to_hq_colospace(vec4 rgb)
{
    return vec3( 0.250 * rgb.r + 0.250 * rgb.g + 0.250 * rgb.b,
                 0.250 * rgb.r - 0.000 * rgb.g - 0.250 * rgb.b,
                -0.125 * rgb.r + 0.250 * rgb.g - 0.125 * rgb.b);
}
STATIC bool is_different(vec4 a, vec4 b)
{
    vec3 diff = abs(rgb_to_hq_colospace(a) - rgb_to_hq_colospace(b));
    return diff.x > 0.018 || diff.y > 0.002 || diff.z > 0.005;
}
#define P(m, r) ((pattern & (m)) == (r))
STATIC vec4 scale(sampler2D image, vec2 position, vec2 input_resolution, vec2 output_resolution)
{
    vec2 o = vec2(1, 1);
    vec2 p = fract(position * input_resolution);
    if (p.x > 0.5) { o.x = -o.x; p.x = 1.0 - p.x; }
    if (p.y > 0.5) { o.y = -o.y; p.y = 1.0 - p.y; }
    vec4 w0 = texture_relative(image, position, vec2( -o.x, -o.y));
    vec4 w1 = texture_relative(image, position, vec2(    0, -o.y));
    vec4 w2 = texture_relative(image, position, vec2(  o.x, -o.y));
    vec4 w3 = texture_relative(image, position, vec2( -o.x,    0));
    vec4 w4 = texture_relative(image, position, vec2(    0,    0));
    vec4 w5 = texture_relative(image, position, vec2(  o.x,    0));
    vec4 w6 = texture_relative(image, position, vec2( -o.x,  o.y));
    vec4 w7 = texture_relative(image, position, vec2(    0,  o.y));
    vec4 w8 = texture_relative(image, position, vec2(  o.x,  o.y));
    int pattern = 0;
    if (is_different(w0, w4)) pattern |= 1 << 0;
    if (is_different(w1, w4)) pattern |= 1 << 1;
    if (is_different(w2, w4)) pattern |= 1 << 2;
    if (is_different(w3, w4)) pattern |= 1 << 3;
    if (is_different(w5, w4)) pattern |= 1 << 4;
    if (is_different(w6, w4)) pattern |= 1 << 5;
    if (is_different(w7, w4)) pattern |= 1 << 6;
    if (is_different(w8, w4)) pattern |= 1 << 7;
    if ((P(0xBF,0x37) || P(0xDB,0x13)) && is_different(w1, w5)) {
        return mix(w4, w3, 0.5 - p.x);
    }
    if ((P(0xDB,0x49) || P(0xEF,0x6D)) && is_different(w7, w3)) {
        return mix(w4, w1, 0.5 - p.y);
    }
    if ((P(0x0B,0x0B) || P(0xFE,0x4A) || P(0xFE,0x1A)) && is_different(w3, w1)) {
        return w4;
    }
    if ((P(0x6F,0x2A) || P(0x5B,0x0A) || P(0xBF,0x3A) || P(0xDF,0x5A) ||
         P(0x9F,0x8A) || P(0xCF,0x8A) || P(0xEF,0x4E) || P(0x3F,0x0E) ||
         P(0xFB,0x5A) || P(0xBB,0x8A) || P(0x7F,0x5A) || P(0xAF,0x8A) ||
         P(0xEB,0x8A)) && is_different(w3, w1)) {
        return mix(w4, mix(w4, w0, 0.5 - p.x), 0.5 - p.y);
    }
    if (P(0x0B,0x08)) {
        return mix(mix(w0 * 0.375 + w1 * 0.25 + w4 * 0.375, w4 * 0.5 + w1 * 0.5, p.x * 2.0), w4, p.y * 2.0);
    }
    if (P(0x0B,0x02)) {
        return mix(mix(w0 * 0.375 + w3 * 0.25 + w4 * 0.375, w4 * 0.5 + w3 * 0.5, p.y * 2.0), w4, p.x * 2.0);
    }
    if (P(0x2F,0x2F)) {
        float dist = length(p - vec2(0.5));
        float pixel_size = length(1.0 / (output_resolution / input_resolution));
        if (dist < 0.5 - pixel_size / 2.0) {
            return w4;
        }
        vec4 r;
        if (is_different(w0, w1) || is_different(w0, w3)) {
            r = mix(w1, w3, p.y - p.x + 0.5);
        }
        else {
            r = mix(mix(w1 * 0.375 + w0 * 0.25 + w3 * 0.375, w3, p.y * 2.0), w1, p.x * 2.0);
        }
        if (dist > 0.5 + pixel_size / 2.0) {
            return r;
        }
        return mix(w4, r, (dist - 0.5 + pixel_size / 2.0) / pixel_size);
    }
    if (P(0xBF,0x37) || P(0xDB,0x13)) {
        float dist = p.x - 2.0 * p.y;
        float pixel_size = length(1.0 / (output_resolution / input_resolution)) * sqrt(5.0);
        if (dist > pixel_size / 2.0) {
            return w1;
        }
        vec4 r = mix(w3, w4, p.x + 0.5);
        if (dist < -pixel_size / 2.0) {
            return r;
        }
        return mix(r, w1, (dist + pixel_size / 2.0) / pixel_size);
    }
    if (P(0xDB,0x49) || P(0xEF,0x6D)) {
        float dist = p.y - 2.0 * p.x;
        float pixel_size = length(1.0 / (output_resolution / input_resolution)) * sqrt(5.0);
        if (p.y - 2.0 * p.x > pixel_size / 2.0) {
            return w3;
        }
        vec4 r = mix(w1, w4, p.x + 0.5);
        if (dist < -pixel_size / 2.0) {
            return r;
        }
        return mix(r, w3, (dist + pixel_size / 2.0) / pixel_size);
    }
    if (P(0xBF,0x8F) || P(0x7E,0x0E)) {
        float dist = p.x + 2.0 * p.y;
        float pixel_size = length(1.0 / (output_resolution / input_resolution)) * sqrt(5.0);
        if (dist > 1.0 + pixel_size / 2.0) {
            return w4;
        }
        vec4 r;
        if (is_different(w0, w1) || is_different(w0, w3)) {
            r = mix(w1, w3, p.y - p.x + 0.5);
        }
        else {
            r = mix(mix(w1 * 0.375 + w0 * 0.25 + w3 * 0.375, w3, p.y * 2.0), w1, p.x * 2.0);
        }
        if (dist < 1.0 - pixel_size / 2.0) {
            return r;
        }
        return mix(r, w4, (dist + pixel_size / 2.0 - 1.0) / pixel_size);
    }
    if (P(0x7E,0x2A) || P(0xEF,0xAB)) {
        float dist = p.y + 2.0 * p.x;
        float pixel_size = length(1.0 / (output_resolution / input_resolution)) * sqrt(5.0);
        if (p.y + 2.0 * p.x > 1.0 + pixel_size / 2.0) {
            return w4;
        }
        vec4 r;
        if (is_different(w0, w1) || is_different(w0, w3)) {
            r = mix(w1, w3, p.y - p.x + 0.5);
        }
        else {
            r = mix(mix(w1 * 0.375 + w0 * 0.25 + w3 * 0.375, w3, p.y * 2.0), w1, p.x * 2.0);
        }
        if (dist < 1.0 - pixel_size / 2.0) {
            return r;
        }
        return mix(r, w4, (dist + pixel_size / 2.0 - 1.0) / pixel_size);
    }
    if (P(0x1B,0x03) || P(0x4F,0x43) || P(0x8B,0x83) || P(0x6B,0x43)) {
        return mix(w4, w3, 0.5 - p.x);
    }
    if (P(0x4B,0x09) || P(0x8B,0x89) || P(0x1F,0x19) || P(0x3B,0x19)) {
        return mix(w4, w1, 0.5 - p.y);
    }
    if (P(0xFB,0x6A) || P(0x6F,0x6E) || P(0x3F,0x3E) || P(0xFB,0xFA) ||
        P(0xDF,0xDE) || P(0xDF,0x1E)) {
        return mix(w4, w0, (1.0 - p.x - p.y) / 2.0);
    }
    if (P(0x4F,0x4B) || P(0x9F,0x1B) || P(0x2F,0x0B) ||
        P(0xBE,0x0A) || P(0xEE,0x0A) || P(0x7E,0x0A) || P(0xEB,0x4B) ||
        P(0x3B,0x1B)) {
        float dist = p.x + p.y;
        float pixel_size = length(1.0 / (output_resolution / input_resolution));
        if (dist > 0.5 + pixel_size / 2.0) {
            return w4;
        }
        vec4 r;
        if (is_different(w0, w1) || is_different(w0, w3)) {
            r = mix(w1, w3, p.y - p.x + 0.5);
        }
        else {
            r = mix(mix(w1 * 0.375 + w0 * 0.25 + w3 * 0.375, w3, p.y * 2.0), w1, p.x * 2.0);
        }
        if (dist < 0.5 - pixel_size / 2.0) {
            return r;
        }
        return mix(r, w4, (dist + pixel_size / 2.0 - 0.5) / pixel_size);
    }
    if (P(0x0B,0x01)) {
        return mix(mix(w4, w3, 0.5 - p.x), mix(w1, (w1 + w3) / 2.0, 0.5 - p.x), 0.5 - p.y);
    }
    if (P(0x0B,0x00)) {
        return mix(mix(w4, w3, 0.5 - p.x), mix(w1, w0, 0.5 - p.x), 0.5 - p.y);
    }
    float dist = p.x + p.y;
    float pixel_size = length(1.0 / (output_resolution / input_resolution));
    if (dist > 0.5 + pixel_size / 2.0) {
        return w4;
    }
    vec4 x0 = texture_relative(image, position, vec2( -o.x * 2.0, -o.y * 2.0));
    vec4 x1 = texture_relative(image, position, vec2( -o.x      , -o.y * 2.0));
    vec4 x2 = texture_relative(image, position, vec2(  0.0      , -o.y * 2.0));
    vec4 x3 = texture_relative(image, position, vec2(  o.x      , -o.y * 2.0));
    vec4 x4 = texture_relative(image, position, vec2( -o.x * 2.0, -o.y      ));
    vec4 x5 = texture_relative(image, position, vec2( -o.x * 2.0,  0.0      ));
    vec4 x6 = texture_relative(image, position, vec2( -o.x * 2.0,  o.y      ));
    if (is_different(x0, w4)) pattern |= 1 << 8;
    if (is_different(x1, w4)) pattern |= 1 << 9;
    if (is_different(x2, w4)) pattern |= 1 << 10;
    if (is_different(x3, w4)) pattern |= 1 << 11;
    if (is_different(x4, w4)) pattern |= 1 << 12;
    if (is_different(x5, w4)) pattern |= 1 << 13;
    if (is_different(x6, w4)) pattern |= 1 << 14;
    int diagonal_bias = -7;
    while (pattern != 0) {
        diagonal_bias += pattern & 1;
        pattern >>= 1;
    }
    if (diagonal_bias <= 0) {
        vec4 r = mix(w1, w3, p.y - p.x + 0.5);
        if (dist < 0.5 - pixel_size / 2.0) {
            return r;
        }
        return mix(r, w4, (dist + pixel_size / 2.0 - 0.5) / pixel_size);
    }
    return w4;
}`;

// SameBoy Shaders/HQ2x.fsh (Expat, Lior Halphon)
const HQ2X = `
STATIC vec3 rgb_to_hq_colospace(vec4 rgb)
{
    return vec3( 0.250 * rgb.r + 0.250 * rgb.g + 0.250 * rgb.b,
                 0.250 * rgb.r - 0.000 * rgb.g - 0.250 * rgb.b,
                -0.125 * rgb.r + 0.250 * rgb.g - 0.125 * rgb.b);
}
STATIC bool is_different(vec4 a, vec4 b)
{
    vec3 diff = abs(rgb_to_hq_colospace(a) - rgb_to_hq_colospace(b));
    return diff.x > 0.018 || diff.y > 0.002 || diff.z > 0.005;
}
#define P(m, r) ((pattern & (m)) == (r))
STATIC vec4 interp_2px(vec4 c1, float w1, vec4 c2, float w2)
{
    return (c1 * w1 + c2 * w2) / (w1 + w2);
}
STATIC vec4 interp_3px(vec4 c1, float w1, vec4 c2, float w2, vec4 c3, float w3)
{
    return (c1 * w1 + c2 * w2 + c3 * w3) / (w1 + w2 + w3);
}
STATIC vec4 scale(sampler2D image, vec2 position, vec2 input_resolution, vec2 output_resolution)
{
    vec2 o = vec2(1, 1);
    vec2 p = fract(position * input_resolution);
    if (p.x > 0.5) o.x = -o.x;
    if (p.y > 0.5) o.y = -o.y;
    vec4 w0 = texture_relative(image, position, vec2( -o.x, -o.y));
    vec4 w1 = texture_relative(image, position, vec2(    0, -o.y));
    vec4 w2 = texture_relative(image, position, vec2(  o.x, -o.y));
    vec4 w3 = texture_relative(image, position, vec2( -o.x,    0));
    vec4 w4 = texture_relative(image, position, vec2(    0,    0));
    vec4 w5 = texture_relative(image, position, vec2(  o.x,    0));
    vec4 w6 = texture_relative(image, position, vec2( -o.x,  o.y));
    vec4 w7 = texture_relative(image, position, vec2(    0,  o.y));
    vec4 w8 = texture_relative(image, position, vec2(  o.x,  o.y));
    int pattern = 0;
    if (is_different(w0, w4)) pattern |= 1;
    if (is_different(w1, w4)) pattern |= 2;
    if (is_different(w2, w4)) pattern |= 4;
    if (is_different(w3, w4)) pattern |= 8;
    if (is_different(w5, w4)) pattern |= 16;
    if (is_different(w6, w4)) pattern |= 32;
    if (is_different(w7, w4)) pattern |= 64;
    if (is_different(w8, w4)) pattern |= 128;
    if ((P(0xBF,0x37) || P(0xDB,0x13)) && is_different(w1, w5)) {
        return interp_2px(w4, 3.0, w3, 1.0);
    }
    if ((P(0xDB,0x49) || P(0xEF,0x6D)) && is_different(w7, w3)) {
        return interp_2px(w4, 3.0, w1, 1.0);
    }
    if ((P(0x0B,0x0B) || P(0xFE,0x4A) || P(0xFE,0x1A)) && is_different(w3, w1)) {
        return w4;
    }
    if ((P(0x6F,0x2A) || P(0x5B,0x0A) || P(0xBF,0x3A) || P(0xDF,0x5A) ||
         P(0x9F,0x8A) || P(0xCF,0x8A) || P(0xEF,0x4E) || P(0x3F,0x0E) ||
         P(0xFB,0x5A) || P(0xBB,0x8A) || P(0x7F,0x5A) || P(0xAF,0x8A) ||
         P(0xEB,0x8A)) && is_different(w3, w1)) {
        return interp_2px(w4, 3.0, w0, 1.0);
    }
    if (P(0x0B,0x08)) {
        return interp_3px(w4, 2.0, w0, 1.0, w1, 1.0);
    }
    if (P(0x0B,0x02)) {
        return interp_3px(w4, 2.0, w0, 1.0, w3, 1.0);
    }
    if (P(0x2F,0x2F)) {
        return interp_3px(w4, 4.0, w3, 1.0, w1, 1.0);
    }
    if (P(0xBF,0x37) || P(0xDB,0x13)) {
        return interp_3px(w4, 5.0, w1, 2.0, w3, 1.0);
    }
    if (P(0xDB,0x49) || P(0xEF,0x6D)) {
        return interp_3px(w4, 5.0, w3, 2.0, w1, 1.0);
    }
    if (P(0x1B,0x03) || P(0x4F,0x43) || P(0x8B,0x83) || P(0x6B,0x43)) {
        return interp_2px(w4, 3.0, w3, 1.0);
    }
    if (P(0x4B,0x09) || P(0x8B,0x89) || P(0x1F,0x19) || P(0x3B,0x19)) {
        return interp_2px(w4, 3.0, w1, 1.0);
    }
    if (P(0x7E,0x2A) || P(0xEF,0xAB) || P(0xBF,0x8F) || P(0x7E,0x0E)) {
        return interp_3px(w4, 2.0, w3, 3.0, w1, 3.0);
    }
    if (P(0xFB,0x6A) || P(0x6F,0x6E) || P(0x3F,0x3E) || P(0xFB,0xFA) ||
        P(0xDF,0xDE) || P(0xDF,0x1E)) {
        return interp_2px(w4, 3.0, w0, 1.0);
    }
    if (P(0x0A,0x00) || P(0x4F,0x4B) || P(0x9F,0x1B) || P(0x2F,0x0B) ||
        P(0xBE,0x0A) || P(0xEE,0x0A) || P(0x7E,0x0A) || P(0xEB,0x4B) ||
        P(0x3B,0x1B)) {
        return interp_3px(w4, 2.0, w3, 1.0, w1, 1.0);
    }
    return interp_3px(w4, 6.0, w3, 1.0, w1, 1.0);
}`;

// SameBoy Shaders/Scale2x.fsh·AAScale2x.fsh (Expat, Lior Halphon) — uP.x = 0 이면 Scale2x, 1 이면 AAScale2x 처럼 원본과 반씩 섞음
const SCALE2X = `
STATIC vec4 scale2x(sampler2D image, vec2 position, vec2 input_resolution, vec2 output_resolution)
{
    vec4 B = texture_relative(image, position, vec2(  0,  1));
    vec4 D = texture_relative(image, position, vec2( -1,  0));
    vec4 E = texture_relative(image, position, vec2(  0,  0));
    vec4 F = texture_relative(image, position, vec2(  1,  0));
    vec4 H = texture_relative(image, position, vec2(  0, -1));
    vec2 p = position * input_resolution;
    p = fract(p);
    if (p.x > .5) {
        if (p.y > .5) {
            return equal(B, F) && inequal(B, D) && inequal(F, H) ? F : E;
        } else {
            return equal(H, F) && inequal(D, H) && inequal(B, F) ? F : E;
        }
    } else {
        if (p.y > .5) {
            return equal(D, B) && inequal(B, F) && inequal(D, H) ? D : E;
        } else {
            return equal(D, H) && inequal(D, B) && inequal(H, F) ? D : E;
        }
    }
}
STATIC vec4 scale(sampler2D image, vec2 position, vec2 input_resolution, vec2 output_resolution)
{
    return mix(texture_relative(image, position, vec2(0.0)), scale2x(image, position, input_resolution, output_resolution), 1.0 - 0.5 * uP.x);
}`;

// libretro glsl-shaders xbr/shaders/xbr-lv2.glsl (MIT, Hyllian) — CORNER_C·SMOOTH_TIPS. 정점 셰이더 좌표 계산을 조각 셰이더로, XBR_SCALE 을 실제 배율로
const XBR = `${HEAD}
#define XBR_Y_WEIGHT 48.0
#define XBR_EQ_THRESHOLD 15.0
#define lv2_cf 2.0
#define mul(a,b) (b*a)
const vec3 rgbw = vec3(14.352, 28.176, 5.472);
const vec4 Ao = vec4( 1.0, -1.0, -1.0, 1.0 );
const vec4 Bo = vec4( 1.0,  1.0, -1.0,-1.0 );
const vec4 Co = vec4( 1.5,  0.5, -0.5, 0.5 );
const vec4 Ax = vec4( 1.0, -1.0, -1.0, 1.0 );
const vec4 Bx = vec4( 0.5,  2.0, -0.5,-2.0 );
const vec4 Cx = vec4( 1.0,  1.0, -0.5, 0.0 );
const vec4 Ay = vec4( 1.0, -1.0, -1.0, 1.0 );
const vec4 By = vec4( 2.0,  0.5, -2.0,-0.5 );
const vec4 Cy = vec4( 2.0,  0.0, -1.0, 0.5 );
const vec4 Ci = vec4(0.25, 0.25, 0.25, 0.25);
const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
vec4 df(vec4 A, vec4 B) { return vec4(abs(A-B)); }
vec4 diff(vec4 A, vec4 B) { return vec4(notEqual(A, B)); }
vec4 eq(vec4 A, vec4 B) { return (step(df(A, B), vec4(XBR_EQ_THRESHOLD))); }
vec4 neq(vec4 A, vec4 B) { return (vec4(1.0, 1.0, 1.0, 1.0) - eq(A, B)); }
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) { return (df(a,b) + df(a,c) + df(d,e) + df(d,f) + 4.0*df(g,h)); }
vec4 weighted_distance(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h, vec4 i, vec4 j, vec4 k, vec4 l) { return (df(a,b) + df(a,c) + df(d,e) + df(d,f) + df(i,j) + df(k,l) + 2.0*df(g,h)); }
float c_df(vec3 c1, vec3 c2) { vec3 d = abs(c1 - c2); return d.r + d.g + d.b; }
void main()
{
    vec2 texCoord = gl_FragCoord.xy / uOut;
    vec2 TextureSize = uIn;
    float dx = 1.0 / TextureSize.x;
    float dy = 1.0 / TextureSize.y;
    vec4 t1 = texCoord.xxxy + vec4( -dx, 0, dx,-2.0*dy);
    vec4 t2 = texCoord.xxxy + vec4( -dx, 0, dx,    -dy);
    vec4 t3 = texCoord.xxxy + vec4( -dx, 0, dx,      0);
    vec4 t4 = texCoord.xxxy + vec4( -dx, 0, dx,     dy);
    vec4 t5 = texCoord.xxxy + vec4( -dx, 0, dx, 2.0*dy);
    vec4 t6 = texCoord.xyyy + vec4(-2.0*dx,-dy, 0,  dy);
    vec4 t7 = texCoord.xyyy + vec4( 2.0*dx,-dy, 0,  dy);
    float XBR_SCALE = max(1.0, min(uOut.x / uIn.x, uOut.y / uIn.y)) / max(uP.x, 0.25);
    vec4 delta   = vec4(1.0/XBR_SCALE);
    vec4 delta_l = vec4(0.5/XBR_SCALE, 1.0/XBR_SCALE, 0.5/XBR_SCALE, 1.0/XBR_SCALE);
    vec4 delta_u = delta_l.yxwz;
    float small_details = uP.y;

    vec4 edri, edr, edr_l, edr_u, px;
    vec4 irlv0, irlv1, irlv2l, irlv2u;
    vec4 fx, fx_l, fx_u;
    vec2 fp  = fract(texCoord*TextureSize);
    vec3 A1 = texture(uTex, t1.xw ).xyz;
    vec3 B1 = texture(uTex, t1.yw ).xyz;
    vec3 C1 = texture(uTex, t1.zw ).xyz;
    vec3 A  = texture(uTex, t2.xw ).xyz;
    vec3 B  = texture(uTex, t2.yw ).xyz;
    vec3 C  = texture(uTex, t2.zw ).xyz;
    vec3 D  = texture(uTex, t3.xw ).xyz;
    vec3 E  = texture(uTex, t3.yw ).xyz;
    vec3 F  = texture(uTex, t3.zw ).xyz;
    vec3 G  = texture(uTex, t4.xw ).xyz;
    vec3 H  = texture(uTex, t4.yw ).xyz;
    vec3 I  = texture(uTex, t4.zw ).xyz;
    vec3 G5 = texture(uTex, t5.xw ).xyz;
    vec3 H5 = texture(uTex, t5.yw ).xyz;
    vec3 I5 = texture(uTex, t5.zw ).xyz;
    vec3 A0 = texture(uTex, t6.xy ).xyz;
    vec3 D0 = texture(uTex, t6.xz ).xyz;
    vec3 G0 = texture(uTex, t6.xw ).xyz;
    vec3 C4 = texture(uTex, t7.xy ).xyz;
    vec3 F4 = texture(uTex, t7.xz ).xyz;
    vec3 I4 = texture(uTex, t7.xw ).xyz;
    vec4 b  = vec4(dot(B ,rgbw), dot(D ,rgbw), dot(H ,rgbw), dot(F ,rgbw));
    vec4 c  = vec4(dot(C ,rgbw), dot(A ,rgbw), dot(G ,rgbw), dot(I ,rgbw));
    vec4 d  = b.yzwx;
    vec4 e  = vec4(dot(E,rgbw));
    vec4 f  = b.wxyz;
    vec4 g  = c.zwxy;
    vec4 h  = b.zwxy;
    vec4 i  = c.wxyz;
    vec4 i4, i5, h5, f4;
    float y_weight = XBR_Y_WEIGHT;
    if (small_details < 0.5) {
        i4 = vec4(dot(I4,rgbw), dot(C1,rgbw), dot(A0,rgbw), dot(G5,rgbw));
        i5 = vec4(dot(I5,rgbw), dot(C4,rgbw), dot(A1,rgbw), dot(G0,rgbw));
        h5 = vec4(dot(H5,rgbw), dot(F4,rgbw), dot(B1,rgbw), dot(D0,rgbw));
    } else {
        i4 = mul( mat4x3(I4, C1, A0, G5), y_weight * Y );
        i5 = mul( mat4x3(I5, C4, A1, G0), y_weight * Y );
        h5 = mul( mat4x3(H5, F4, B1, D0), y_weight * Y );
    }
    f4 = h5.yzwx;
    fx   = (Ao*fp.y+Bo*fp.x);
    fx_l = (Ax*fp.y+Bx*fp.x);
    fx_u = (Ay*fp.y+By*fp.x);
    irlv1 = irlv0 = diff(e,f) * diff(e,h);
    irlv1 = (irlv0 * ( neq(f,b) * neq(f,c) + neq(h,d) * neq(h,g) + eq(e,i) * (neq(f,f4) * neq(f,i4) + neq(h,h5) * neq(h,i5)) + eq(e,g) + eq(e,c)) );
    irlv2l = diff(e,g) * diff(d,g);
    irlv2u = diff(e,c) * diff(b,c);
    vec4 fx45i = clamp((fx   + delta   -Co - Ci)/(2.0*delta  ), 0.0, 1.0);
    vec4 fx45  = clamp((fx   + delta   -Co     )/(2.0*delta  ), 0.0, 1.0);
    vec4 fx30  = clamp((fx_l + delta_l -Cx     )/(2.0*delta_l), 0.0, 1.0);
    vec4 fx60  = clamp((fx_u + delta_u -Cy     )/(2.0*delta_u), 0.0, 1.0);
    vec4 wd1, wd2;
    if (small_details < 0.5) {
        wd1 = wd( e, c,  g, i, h5, f4, h, f);
        wd2 = wd( h, d, i5, f, i4,  b, e, i);
    } else {
        wd1 = weighted_distance( e, c, g, i, f4, h5, h, f, b, d, i4, i5);
        wd2 = weighted_distance( h, d, i5, f, b, i4, e, i, g, h5, c, f4);
    }
    edri  = step(wd1, wd2) * irlv0;
    edr   = step(wd1 + vec4(0.1, 0.1, 0.1, 0.1), wd2) * step(vec4(0.5, 0.5, 0.5, 0.5), irlv1);
    edr_l = step( lv2_cf*df(f,g), df(h,c) ) * irlv2l * edr;
    edr_u = step( lv2_cf*df(h,c), df(f,g) ) * irlv2u * edr;
    fx45  = edr   * fx45;
    fx30  = edr_l * fx30;
    fx60  = edr_u * fx60;
    fx45i = edri  * fx45i;
    px = step(df(e,f), df(e,h));
    vec4 maximos = max(max(fx30, fx60), max(fx45, fx45i));
    vec3 res1 = E;
    res1 = mix(res1, mix(H, F, px.x), maximos.x);
    res1 = mix(res1, mix(B, D, px.z), maximos.z);
    vec3 res2 = E;
    res2 = mix(res2, mix(F, B, px.y), maximos.y);
    res2 = mix(res2, mix(D, H, px.w), maximos.w);
    vec3 res = mix(res1, res2, step(c_df(E, res1), c_df(E, res2)));
    fragColor = vec4(res, 1.0);
}`;

// libretro glsl-shaders scalefx/shaders/scalefx-pass0~4.glsl (MIT, Sp00kyFox) — texelFetch 로 이웃 조회, SFX_CLR 0.5 · SFX_SAA 1.0 · SFX_SCN 1.0
const FETCH = `
vec4 at(sampler2D t, int x, int y) {
  ivec2 s = textureSize(t, 0);
  ivec2 p = clamp(ivec2(gl_FragCoord.xy) + ivec2(x, y), ivec2(0), s - 1);
  return texelFetch(t, p, 0);
}`;
const SFX0 = `${HEAD}${FETCH}
float dist(vec3 A, vec3 B) {
  float r = 0.5 * (A.r + B.r);
  vec3 d = A - B;
  vec3 c = vec3(2. + r, 4., 3. - r);
  return sqrt(dot(c*d, d)) / 3.;
}
void main() {
  vec3 A = at(uTex,-1,-1).rgb, B = at(uTex,0,-1).rgb, C = at(uTex,1,-1).rgb, E = at(uTex,0,0).rgb, F = at(uTex,1,0).rgb;
  fragColor = vec4(dist(E,A), dist(E,B), dist(E,C), dist(E,F));
}`;
const SFX1 = `${HEAD}${FETCH}
#define SFX_CLR 0.5
#define SFX_SAA 1.0
float str(float d, vec2 a, vec2 b){
  float diff = a.x - a.y;
  float wght1 = max(SFX_CLR - d, 0.) / SFX_CLR;
  float wght2 = clamp((1.-d) + (min(a.x, b.x) + a.x > min(a.y, b.y) + a.y ? diff : -diff), 0., 1.);
  return (SFX_SAA == 1. || 2.*d < a.x + a.y) ? (wght1 * wght2) * (a.x * a.y) : 0.;
}
void main() {
  vec4 A = at(uTex,-1,-1), B = at(uTex,0,-1);
  vec4 D = at(uTex,-1,0), E = at(uTex,0,0), F = at(uTex,1,0);
  vec4 G = at(uTex,-1,1), H = at(uTex,0,1), I = at(uTex,1,1);
  vec4 res;
  res.x = str(D.z, vec2(D.w, E.y), vec2(A.w, D.y));
  res.y = str(F.x, vec2(E.w, E.y), vec2(B.w, F.y));
  res.z = str(H.z, vec2(E.w, H.y), vec2(H.w, I.y));
  res.w = str(H.x, vec2(D.w, H.y), vec2(G.w, G.y));
  fragColor = res;
}`;
const SFX2 = `${HEAD}${FETCH}
#define LE(x, y) (1. - step(y, x))
#define GE(x, y) (1. - step(x, y))
#define LEQ(x, y) step(x, y)
#define GEQ(x, y) step(y, x)
#define NOT(x) (1. - (x))
vec4 dom(vec3 x, vec3 y, vec3 z, vec3 w){
  return 2. * vec4(x.y, y.y, z.y, w.y) - (vec4(x.x, y.x, z.x, w.x) + vec4(x.z, y.z, z.z, w.z));
}
float clear(vec2 crn, vec2 a, vec2 b){
  return (crn.x >= max(min(a.x, a.y), min(b.x, b.y))) && (crn.y >= max(min(a.x, b.y), min(b.x, a.y))) ? 1. : 0.;
}
void main() {
  vec4 A = at(uAux,-1,-1), B = at(uAux,0,-1);
  vec4 D = at(uAux,-1,0), E = at(uAux,0,0), F = at(uAux,1,0);
  vec4 G = at(uAux,-1,1), H = at(uAux,0,1), I = at(uAux,1,1);
  vec4 As = at(uTex,-1,-1), Bs = at(uTex,0,-1), Cs = at(uTex,1,-1);
  vec4 Ds = at(uTex,-1,0), Es = at(uTex,0,0), Fs = at(uTex,1,0);
  vec4 Gs = at(uTex,-1,1), Hs = at(uTex,0,1), Is = at(uTex,1,1);
  vec4 jSx = vec4(As.z, Bs.w, Es.x, Ds.y), jDx = dom(As.yzw, Bs.zwx, Es.wxy, Ds.xyz);
  vec4 jSy = vec4(Bs.z, Cs.w, Fs.x, Es.y), jDy = dom(Bs.yzw, Cs.zwx, Fs.wxy, Es.xyz);
  vec4 jSz = vec4(Es.z, Fs.w, Is.x, Hs.y), jDz = dom(Es.yzw, Fs.zwx, Is.wxy, Hs.xyz);
  vec4 jSw = vec4(Ds.z, Es.w, Hs.x, Gs.y), jDw = dom(Ds.yzw, Es.zwx, Hs.wxy, Gs.xyz);
  vec4 zero4 = vec4(0.);
  vec4 jx = min(GE(jDx, zero4) * (LEQ(jDx.yzwx, zero4) * LEQ(jDx.wxyz, zero4) + GE(jDx + jDx.zwxy, jDx.yzwx + jDx.wxyz)), 1.);
  vec4 jy = min(GE(jDy, zero4) * (LEQ(jDy.yzwx, zero4) * LEQ(jDy.wxyz, zero4) + GE(jDy + jDy.zwxy, jDy.yzwx + jDy.wxyz)), 1.);
  vec4 jz = min(GE(jDz, zero4) * (LEQ(jDz.yzwx, zero4) * LEQ(jDz.wxyz, zero4) + GE(jDz + jDz.zwxy, jDz.yzwx + jDz.wxyz)), 1.);
  vec4 jw = min(GE(jDw, zero4) * (LEQ(jDw.yzwx, zero4) * LEQ(jDw.wxyz, zero4) + GE(jDw + jDw.zwxy, jDw.yzwx + jDw.wxyz)), 1.);
  vec4 res;
  res.x = min(jx.z + NOT(jx.y) * NOT(jx.w) * GE(jSx.z, 0.) * (jx.x + GE(jSx.x + jSx.z, jSx.y + jSx.w)), 1.);
  res.y = min(jy.w + NOT(jy.z) * NOT(jy.x) * GE(jSy.w, 0.) * (jy.y + GE(jSy.y + jSy.w, jSy.x + jSy.z)), 1.);
  res.z = min(jz.x + NOT(jz.w) * NOT(jz.y) * GE(jSz.x, 0.) * (jz.z + GE(jSz.x + jSz.z, jSz.y + jSz.w)), 1.);
  res.w = min(jw.y + NOT(jw.x) * NOT(jw.z) * GE(jSw.y, 0.) * (jw.w + GE(jSw.y + jSw.w, jSw.x + jSw.z)), 1.);
  res = min(res * (vec4(jx.z, jy.w, jz.x, jw.y) + NOT(res.wxyz * res.yzwx)), 1.);
  vec4 clr;
  clr.x = clear(vec2(D.z, E.x), vec2(D.w, E.y), vec2(A.w, D.y));
  clr.y = clear(vec2(F.x, E.z), vec2(E.w, E.y), vec2(B.w, F.y));
  clr.z = clear(vec2(H.z, I.x), vec2(E.w, H.y), vec2(H.w, I.y));
  clr.w = clear(vec2(H.x, G.z), vec2(D.w, H.y), vec2(G.w, G.y));
  vec4 h = vec4(min(D.w, A.w), min(E.w, B.w), min(E.w, H.w), min(D.w, G.w));
  vec4 v = vec4(min(E.y, D.y), min(E.y, F.y), min(H.y, I.y), min(H.y, G.y));
  vec4 orr  = GE(h + vec4(D.w, E.w, E.w, D.w), v + vec4(E.y, E.y, H.y, H.y));
  vec4 hori = LE(h, v) * clr;
  vec4 vert = GE(h, v) * clr;
  fragColor = (res + 2. * hori + 4. * vert + 8. * orr) / 15.;
}`;
const SFX3 = `${HEAD}${FETCH}
#define SFX_SCN 1.0
bvec4 loadCorn(vec4 x){ return bvec4(floor(mod(x*15. + 0.5, 2.))); }
bvec4 loadHori(vec4 x){ return bvec4(floor(mod(x*7.5 + 0.25, 2.))); }
bvec4 loadVert(vec4 x){ return bvec4(floor(mod(x*3.75 + 0.125, 2.))); }
bvec4 loadOr(vec4 x){ return bvec4(floor(mod(x*1.875 + 0.0625, 2.))); }
void main() {
  vec4 E = at(uTex,0,0);
  vec4 D = at(uTex,-1,0), D0 = at(uTex,-2,0), D1 = at(uTex,-3,0);
  vec4 F = at(uTex,1,0), F0 = at(uTex,2,0), F1 = at(uTex,3,0);
  vec4 B = at(uTex,0,-1), B0 = at(uTex,0,-2), B1 = at(uTex,0,-3);
  vec4 H = at(uTex,0,1), H0 = at(uTex,0,2), H1 = at(uTex,0,3);
  bvec4 Ec = loadCorn(E), Eh = loadHori(E), Ev = loadVert(E), Eo = loadOr(E);
  bvec4 Dc = loadCorn(D), Dh = loadHori(D), Do = loadOr(D), D0c = loadCorn(D0), D0h = loadHori(D0), D1h = loadHori(D1);
  bvec4 Fc = loadCorn(F), Fh = loadHori(F), Fo = loadOr(F), F0c = loadCorn(F0), F0h = loadHori(F0), F1h = loadHori(F1);
  bvec4 Bc = loadCorn(B), Bv = loadVert(B), Bo = loadOr(B), B0c = loadCorn(B0), B0v = loadVert(B0), B1v = loadVert(B1);
  bvec4 Hc = loadCorn(H), Hv = loadVert(H), Ho = loadOr(H), H0c = loadCorn(H0), H0v = loadVert(H0), H1v = loadVert(H1);
  bool lvl1x = Ec.x && (Dc.z || Bc.z || SFX_SCN == 1.);
  bool lvl1y = Ec.y && (Fc.w || Bc.w || SFX_SCN == 1.);
  bool lvl1z = Ec.z && (Fc.x || Hc.x || SFX_SCN == 1.);
  bool lvl1w = Ec.w && (Dc.y || Hc.y || SFX_SCN == 1.);
  bvec2 lvl2x = bvec2((Ec.x && Eh.y) && Dc.z, (Ec.y && Eh.x) && Fc.w);
  bvec2 lvl2y = bvec2((Ec.y && Ev.z) && Bc.w, (Ec.z && Ev.y) && Hc.x);
  bvec2 lvl2z = bvec2((Ec.w && Eh.z) && Dc.y, (Ec.z && Eh.w) && Fc.x);
  bvec2 lvl2w = bvec2((Ec.x && Ev.w) && Bc.z, (Ec.w && Ev.x) && Hc.y);
  bvec2 lvl3x = bvec2(lvl2x.y && (Dh.y && Dh.x) && Fh.z, lvl2w.y && (Bv.w && Bv.x) && Hv.z);
  bvec2 lvl3y = bvec2(lvl2x.x && (Fh.x && Fh.y) && Dh.w, lvl2y.y && (Bv.z && Bv.y) && Hv.w);
  bvec2 lvl3z = bvec2(lvl2z.x && (Fh.w && Fh.z) && Dh.x, lvl2y.x && (Hv.y && Hv.z) && Bv.x);
  bvec2 lvl3w = bvec2(lvl2z.y && (Dh.z && Dh.w) && Fh.y, lvl2w.x && (Hv.x && Hv.w) && Bv.y);
  bvec2 lvl4x = bvec2((Dc.x && Dh.y && Eh.x && Eh.y && Fh.x && Fh.y) && (D0c.z && D0h.w), (Bc.x && Bv.w && Ev.x && Ev.w && Hv.x && Hv.w) && (B0c.z && B0v.y));
  bvec2 lvl4y = bvec2((Fc.y && Fh.x && Eh.y && Eh.x && Dh.y && Dh.x) && (F0c.w && F0h.z), (Bc.y && Bv.z && Ev.y && Ev.z && Hv.y && Hv.z) && (B0c.w && B0v.x));
  bvec2 lvl4z = bvec2((Fc.z && Fh.w && Eh.z && Eh.w && Dh.z && Dh.w) && (F0c.x && F0h.y), (Hc.z && Hv.y && Ev.z && Ev.y && Bv.z && Bv.y) && (H0c.x && H0v.w));
  bvec2 lvl4w = bvec2((Dc.w && Dh.z && Eh.w && Eh.z && Fh.w && Fh.z) && (D0c.y && D0h.x), (Hc.w && Hv.x && Ev.w && Ev.x && Bv.w && Bv.x) && (H0c.y && H0v.z));
  bvec2 lvl5x = bvec2(lvl4x.x && (F0h.x && F0h.y) && (D1h.z && D1h.w), lvl4y.x && (D0h.y && D0h.x) && (F1h.w && F1h.z));
  bvec2 lvl5y = bvec2(lvl4y.y && (H0v.y && H0v.z) && (B1v.w && B1v.x), lvl4z.y && (B0v.z && B0v.y) && (H1v.x && H1v.w));
  bvec2 lvl5z = bvec2(lvl4w.x && (F0h.w && F0h.z) && (D1h.y && D1h.x), lvl4z.x && (D0h.z && D0h.w) && (F1h.x && F1h.y));
  bvec2 lvl5w = bvec2(lvl4x.y && (H0v.x && H0v.w) && (B1v.z && B1v.y), lvl4w.y && (B0v.w && B0v.x) && (H1v.y && H1v.z));
  bvec2 lvl6x = bvec2(lvl5x.y && (D1h.y && D1h.x), lvl5w.y && (B1v.w && B1v.x));
  bvec2 lvl6y = bvec2(lvl5x.x && (F1h.x && F1h.y), lvl5y.y && (B1v.z && B1v.y));
  bvec2 lvl6z = bvec2(lvl5z.x && (F1h.w && F1h.z), lvl5y.x && (H1v.y && H1v.z));
  bvec2 lvl6w = bvec2(lvl5z.y && (D1h.z && D1h.w), lvl5w.x && (H1v.x && H1v.w));
  vec4 crn;
  crn.x = (lvl1x && Eo.x || lvl3x.x && Eo.y || lvl4x.x && Do.x || lvl6x.x && Fo.y) ? 5. : (lvl1x || lvl3x.y && !Eo.w || lvl4x.y && !Bo.x || lvl6x.y && !Ho.w) ? 1. : lvl3x.x ? 3. : lvl3x.y ? 7. : lvl4x.x ? 2. : lvl4x.y ? 6. : lvl6x.x ? 4. : lvl6x.y ? 8. : 0.;
  crn.y = (lvl1y && Eo.y || lvl3y.x && Eo.x || lvl4y.x && Fo.y || lvl6y.x && Do.x) ? 5. : (lvl1y || lvl3y.y && !Eo.z || lvl4y.y && !Bo.y || lvl6y.y && !Ho.z) ? 3. : lvl3y.x ? 1. : lvl3y.y ? 7. : lvl4y.x ? 4. : lvl4y.y ? 6. : lvl6y.x ? 2. : lvl6y.y ? 8. : 0.;
  crn.z = (lvl1z && Eo.z || lvl3z.x && Eo.w || lvl4z.x && Fo.z || lvl6z.x && Do.w) ? 7. : (lvl1z || lvl3z.y && !Eo.y || lvl4z.y && !Ho.z || lvl6z.y && !Bo.y) ? 3. : lvl3z.x ? 1. : lvl3z.y ? 5. : lvl4z.x ? 4. : lvl4z.y ? 8. : lvl6z.x ? 2. : lvl6z.y ? 6. : 0.;
  crn.w = (lvl1w && Eo.w || lvl3w.x && Eo.z || lvl4w.x && Do.w || lvl6w.x && Fo.z) ? 7. : (lvl1w || lvl3w.y && !Eo.x || lvl4w.y && !Ho.w || lvl6w.y && !Bo.x) ? 1. : lvl3w.x ? 3. : lvl3w.y ? 5. : lvl4w.x ? 2. : lvl4w.y ? 8. : lvl6w.x ? 4. : lvl6w.y ? 6. : 0.;
  vec4 mid;
  mid.x = (lvl2x.x &&  Eo.x || lvl2x.y &&  Eo.y || lvl5x.x &&  Do.x || lvl5x.y &&  Fo.y) ? 5. : lvl2x.x ? 1. : lvl2x.y ? 3. : lvl5x.x ? 2. : lvl5x.y ? 4. : (Ec.x && Dc.z && Ec.y && Fc.w) ? ( Eo.x ?  Eo.y ? 5. : 3. : 1.) : 0.;
  mid.y = (lvl2y.x && !Eo.y || lvl2y.y && !Eo.z || lvl5y.x && !Bo.y || lvl5y.y && !Ho.z) ? 3. : lvl2y.x ? 5. : lvl2y.y ? 7. : lvl5y.x ? 6. : lvl5y.y ? 8. : (Ec.y && Bc.w && Ec.z && Hc.x) ? (!Eo.y ? !Eo.z ? 3. : 7. : 5.) : 0.;
  mid.z = (lvl2z.x &&  Eo.w || lvl2z.y &&  Eo.z || lvl5z.x &&  Do.w || lvl5z.y &&  Fo.z) ? 7. : lvl2z.x ? 1. : lvl2z.y ? 3. : lvl5z.x ? 2. : lvl5z.y ? 4. : (Ec.z && Fc.x && Ec.w && Dc.y) ? ( Eo.z ?  Eo.w ? 7. : 1. : 3.) : 0.;
  mid.w = (lvl2w.x && !Eo.x || lvl2w.y && !Eo.w || lvl5w.x && !Bo.x || lvl5w.y && !Ho.w) ? 1. : lvl2w.x ? 5. : lvl2w.y ? 7. : lvl5w.x ? 6. : lvl5w.y ? 8. : (Ec.w && Hc.y && Ec.x && Bc.z) ? (!Eo.w ? !Eo.x ? 1. : 5. : 7.) : 0.;
  fragColor = (crn + 9. * mid) / 80.;
}`;
const SFX4 = `${HEAD}
vec4 loadCrn(vec4 x){ return floor(mod(x*80. + 0.5, 9.)); }
vec4 loadMid(vec4 x){ return floor(mod(x*8.888888 + 0.055555, 9.)); }
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy);
  ivec2 s = o / 3;
  ivec2 sz = textureSize(uTex, 0);
  vec4 E = texelFetch(uTex, clamp(s, ivec2(0), sz - 1), 0);
  vec4 crn = loadCrn(E);
  vec4 mid = loadMid(E);
  vec2 fp = vec2(o - s * 3);
  float sp = fp.y == 0. ? (fp.x == 0. ? crn.x : fp.x == 1. ? mid.x : crn.y) : (fp.y == 1. ? (fp.x == 0. ? mid.w : fp.x == 1. ? 0. : mid.y) : (fp.x == 0. ? crn.w : fp.x == 1. ? mid.z : crn.z));
  vec2 res = sp == 0. ? vec2(0.,0.) : sp == 1. ? vec2(-1.,0.) : sp == 2. ? vec2(-2.,0.) : sp == 3. ? vec2(1.,0.) : sp == 4. ? vec2(2.,0.) : sp == 5. ? vec2(0,-1) : sp == 6. ? vec2(0.,-2.) : sp == 7. ? vec2(0.,1.) : vec2(0.,2.);
  fragColor = vec4(texelFetch(uAux, clamp(s + ivec2(res), ivec2(0), sz - 1), 0).rgb, 1.0);
}`;

// 셀 음영·윤곽 (자체 작성) — 입력 = OmniScale 결과(출력 크기)
const TOON = `${HEAD}
float L(vec2 p) { return dot(texture(uTex, p).rgb, LUMA); }
void main() {
  ${POS}
  vec2 sp = 1.0 / uSrc;
  vec3 c = texture(uTex, pos).rgb;
  vec3 acc = c; float ws = 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec3 s = texture(uTex, pos + vec2(float(i), float(j)) * sp * 0.9).rgb;
    float w = exp(-dot(s - c, s - c) * 22.0);
    acc += s * w; ws += w;
  }
  c = acc / ws;
  float y = dot(c, LUMA);
  float n = uP.y;
  float yq = (floor(y * n) + 0.5) / n;
  yq = mix(y, yq, 0.85);
  vec3 cq = clamp(c * (yq / max(y, 0.02)), 0.0, 1.0);
  cq = clamp(mix(vec3(dot(cq, LUMA)), cq, 1.15), 0.0, 1.0);
  vec2 t = sp * uP.x;
  float tl = L(pos + vec2(-1.0, -1.0) * t), tc = L(pos + vec2(0.0, -1.0) * t), tr = L(pos + vec2(1.0, -1.0) * t);
  float ml = L(pos + vec2(-1.0, 0.0) * t), mr = L(pos + vec2(1.0, 0.0) * t);
  float bl = L(pos + vec2(-1.0, 1.0) * t), bc = L(pos + vec2(0.0, 1.0) * t), br = L(pos + vec2(1.0, 1.0) * t);
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  float e = length(vec2(gx, gy));
  float line = smoothstep(uP.w, uP.w + 0.45, e) * uP.z;
  vec3 ink = cq * 0.22 + vec3(0.015, 0.01, 0.025);
  fragColor = vec4(mix(cq, ink, line), 1.0);
}`;

// ---------------------------------------------------------------- 화면 재현 (출력 크기, 입력 = 확대 결과)
const DISPLAY = {
  crt: `${HEAD}
vec3 hs(vec2 uv) {
  float d = 0.45 / uSrc.x;
  return texture(uTex, uv).rgb * 0.5 + texture(uTex, uv + vec2(d, 0.0)).rgb * 0.25 + texture(uTex, uv - vec2(d, 0.0)).rgb * 0.25;
}
float beam(float d, float l) { float w = mix(0.24, 0.48, l); return exp(-0.5 * (d / w) * (d / w)); }
void main() {
  ${POS}
  vec2 cc = pos * 2.0 - 1.0;
  float k = uP.y * 0.22;
  cc *= 1.0 + k * (cc.yx * cc.yx);
  cc /= 1.0 + k * 0.35;
  vec2 uv = cc * 0.5 + 0.5;
  vec2 fw = fwidth(uv) * 1.2;
  vec2 em = smoothstep(vec2(0.0), fw, uv) * smoothstep(vec2(0.0), fw, 1.0 - uv);
  vec2 hp = uOut * 0.5;
  float rr = uQ.x * min(hp.x, hp.y);
  vec2 qp = abs(cc) * hp - (hp - rr);
  float sd = length(max(qp, 0.0)) + min(max(qp.x, qp.y), 0.0) - rr;
  float corner = 1.0 - smoothstep(-0.8, 0.8, sd);
  float edge = em.x * em.y * corner;
  uv = clamp(uv, 0.0, 1.0);
  float lines = uSrc.y > 300.0 ? uSrc.y * 0.5 : uSrc.y;
  float ry = uv.y * lines - 0.5;
  float fy = fract(ry);
  float y0 = (floor(ry) + 0.5) / lines, y1 = (floor(ry) + 1.5) / lines;
  vec3 c0 = hs(vec2(uv.x, y0)), c1 = hs(vec2(uv.x, y1));
  vec3 scan = c0 * beam(fy, dot(c0, LUMA)) + c1 * beam(1.0 - fy, dot(c1, LUMA));
  vec3 flatc = texture(uTex, uv).rgb;
  vec3 col = mix(flatc, scan * 1.42, uP.x);
  float m = 1.0 - uP.w * 0.55;
  int mx = int(mod(gl_FragCoord.x, 3.0));
  vec3 mask = mx == 0 ? vec3(1.0, m, m) : mx == 1 ? vec3(m, 1.0, m) : vec3(m, m, 1.0);
  col *= mask * (1.0 + uP.w * 0.32);
  vec2 b = 1.6 / uSrc;
  vec3 blur = (texture(uTex, uv + vec2(b.x, 0.0)).rgb + texture(uTex, uv - vec2(b.x, 0.0)).rgb + texture(uTex, uv + vec2(0.0, b.y)).rgb + texture(uTex, uv - vec2(0.0, b.y)).rgb
             + texture(uTex, uv + b * 0.7).rgb + texture(uTex, uv - b * 0.7).rgb + texture(uTex, uv + vec2(b.x, -b.y) * 0.7).rgb + texture(uTex, uv + vec2(-b.x, b.y) * 0.7).rgb) * 0.125;
  col += uP.z * 0.55 * blur * blur;
  col = mix(col, blur, uP.z * 0.12);
  col *= 1.0 - 0.22 * uP.y * dot(cc * 0.7, cc * 0.7);
  fragColor = vec4(clamp(col, 0.0, 1.0) * edge, 1.0);
}`,
  lcd: `${HEAD}
vec3 lcdColor(vec3 c) {
  vec3 l = pow(c, vec3(2.2));
  vec3 m = vec3(dot(l, vec3(0.80, 0.26, -0.06)), dot(l, vec3(0.11, 0.66, 0.23)), dot(l, vec3(0.09, 0.21, 0.70)));
  m = pow(max(m, 0.0), vec3(1.0 / 2.2));
  return m * 0.90 + 0.05;
}
void main() {
  ${POS}
  vec2 cell = pos * uSrc;
  vec2 f = fract(cell);
  vec2 fw = fwidth(cell);
  vec3 col = texture(uTex, pos).rgb;
  col = mix(col, lcdColor(col), uP.y);
  float small = 1.0 - smoothstep(0.22, 0.40, max(fw.x, fw.y));
  float sx = f.x * 3.0;
  float a = fw.x * 3.0;
  vec3 stripe = vec3(1.0 - smoothstep(1.0 - a, 1.0 + a, sx), smoothstep(1.0 - a, 1.0 + a, sx) * (1.0 - smoothstep(2.0 - a, 2.0 + a, sx)), smoothstep(2.0 - a, 2.0 + a, sx));
  vec3 sub = mix(vec3(1.0), 0.35 + stripe * 1.3, uP.z * small);
  col *= sub;
  vec2 d = min(f, 1.0 - f);
  float gap = 0.09 + 0.09 * uP.x;
  vec2 g = smoothstep(vec2(gap) - fw * 0.6, vec2(gap) + fw * 0.6, d);
  col *= mix(1.0, mix(1.0 - 0.75 * uP.x, 1.0, g.x * g.y), small) * (1.0 + 0.16 * uP.x * small);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
  dot: `${HEAD}
float sdBox(vec2 p, float h, float r) { vec2 q = abs(p) - vec2(h - r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  ${POS}
  vec2 cell = pos * uSrc;
  vec2 fw = fwidth(cell);
  vec2 ci = floor(cell);
  vec3 col = texture(uTex, (ci + 0.5) / uSrc).rgb;
  float h = uP.x * 0.5;
  float sd = sdBox(fract(cell) - 0.5, h, h * 0.35);
  float dotA = 1.0 - smoothstep(-fw.x * 0.7, fw.x * 0.7, sd);
  vec2 off = vec2(0.14, 0.14);
  vec2 sc = cell - off;
  vec3 scol = texture(uTex, (floor(sc) + 0.5) / uSrc).rgb;
  float sA = 1.0 - smoothstep(-0.12, 0.12, sdBox(fract(sc) - 0.5, h, h * 0.35));
  vec3 paper = mix(vec3(0.80, 0.81, 0.78), vec3(0.72, 0.78, 0.55), uP.z);
  paper = mix(paper, paper * (0.55 + 0.45 * scol), 0.35);
  paper *= 1.0 - 0.35 * uP.y * sA * (1.0 - 0.6 * dot(scol, LUMA));
  float small = 1.0 - smoothstep(0.25, 0.45, max(fw.x, fw.y));
  vec3 o = mix(paper, col, dotA);
  fragColor = vec4(mix(col, o, small * uQ.x), 1.0);
}`,
};

const GHOST = `${HEAD}void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(uTex, p, 0).rgb;
  vec3 h = texelFetch(uAux, p, 0).rgb;
  fragColor = vec4(mix(c, h, uP.x), 1.0);
}`;

// 확대 강도: 원본 픽셀(최근접)과 확대 결과 혼합. uAux = 원본 해상도 색 결과
const MIXN = `${HEAD}void main() {
  vec2 pos = gl_FragCoord.xy / uOut;
  vec3 a = texelFetch(uAux, ivec2(floor(pos * uSrc)), 0).rgb;
  vec3 b = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0).rgb;
  fragColor = vec4(mix(a, b, uP.x), 1.0);
}`;

const BLIT = `${HEAD}void main() {
  ivec2 p = ivec2(gl_FragCoord.x, uOut.y - 1.0 - gl_FragCoord.y);
  fragColor = vec4(texelFetch(uTex, p, 0).rgb, 1.0);
}`;

export const PROGRAMS = {
  blit: BLIT,
  ghost: GHOST,
  mixn: MIXN,
  toon: TOON,
  sfx0: SFX0, sfx1: SFX1, sfx2: SFX2, sfx3: SFX3, sfx4: SFX4,
  "s:omni": SAMEBOY_WRAP(OMNISCALE),
  "s:hq2x": SAMEBOY_WRAP(HQ2X),
  "s:scale2x": SAMEBOY_WRAP(SCALE2X),
  "s:xbr": XBR,
  ...Object.fromEntries(Object.entries(SCALE_SIMPLE).map(([k, v]) => [`s:${k}`, v])),
  ...Object.fromEntries(Object.entries(COLOR).map(([k, v]) => [`c:${k}`, COLOR_WRAP(v)])),
  ...Object.fromEntries(Object.entries(DISPLAY).map(([k, v]) => [`d:${k}`, v])),
};
