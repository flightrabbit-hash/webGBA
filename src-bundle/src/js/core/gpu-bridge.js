export const GPU_EXPORTS = ["Web_GpuStart", "Web_GpuList", "Web_GpuListLen", "Web_GpuListDone"];
export const GPU_VERSION = 1;

const OP = { PROGRAM: 1, TEXTURE: 2, TARGET: 3, BLEND: 4, UNIFORM: 5, TEXBIND: 6, DRAW: 7, UPLOAD: 8, COPY: 9, READ: 10 };

const OVERLAY_VS = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const OVERLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uO;
in vec2 uv;
out vec4 o;
void main() { o = texture(uO, uv); }`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

export class GpuBridge {
  static create(width, height, doc = globalThis.document) {
    try {
      const canvas = doc.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
      if (!gl) return null;
      return new GpuBridge(canvas, gl, width, height);
    } catch {
      return null;
    }
  }

  constructor(canvas, gl, width, height) {
    this.canvas = canvas;
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.lost = false;
    this.error = "";
    gl.disable(gl.DITHER);
    canvas.addEventListener?.("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    this.programs = new Map();
    this.textures = new Map();
    this.vbo = gl.createBuffer();
    this.vboSize = 0;
    this.vao = gl.createVertexArray();
    this.empty = gl.createVertexArray();
    const out = this.texture(0, 1, width, height);
    this.output = out;
    this.overlayProgram = compile(gl, OVERLAY_VS, OVERLAY_FS);
    this.overlayTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.attribs = 0;
    this.stats = { lists: 0, draws: 0, bytes: 0 };
  }

  format(code) {
    const gl = this.gl;
    if (code === 1) return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytes: 4, view: Uint8Array };
    if (code === 2) return { internal: gl.RGB10_A2, format: gl.RGBA, type: gl.UNSIGNED_INT_2_10_10_10_REV, bytes: 4, view: Uint32Array };
    if (code === 3) return { internal: gl.R16UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_SHORT, bytes: 2, view: Uint16Array };
    throw new Error(`texture format ${code}`);
  }

  texture(id, code, width, height) {
    const gl = this.gl;
    const old = this.textures.get(id);
    if (old) {
      gl.deleteTexture(old.tex);
      if (old.fbo) gl.deleteFramebuffer(old.fbo);
    }
    const f = this.format(code);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, f.internal, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const entry = { tex, fbo: null, f, width, height };
    this.textures.set(id, entry);
    return entry;
  }

  framebuffer(entry) {
    const gl = this.gl;
    if (!entry.fbo) {
      entry.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer incomplete");
    }
    return entry.fbo;
  }

  text(u8, ptr, len) {
    return new TextDecoder().decode(u8.subarray(ptr, ptr + len));
  }

  run(ex) {
    if (this.lost) throw new Error("context lost");
    const at = ex.Web_GpuList() >>> 0;
    const len = ex.Web_GpuListLen() >>> 0;
    if (at && len) this.execute(ex.memory.buffer, at, len);
    ex.Web_GpuListDone();
  }

  execute(buffer, at, len) {
    const gl = this.gl;
    const words = new Uint32Array(buffer, at, len);
    const i32 = new Int32Array(buffer, at, len);
    const f32 = new Float32Array(buffer, at, len);
    const u8 = new Uint8Array(buffer);
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < len; i += words[i] >>> 8 || 1) {
      if ((words[i] & 0xff) !== OP.DRAW) continue;
      const ptr = words[i + 4], size = words[i + 3] * words[i + 5];
      if (!ptr || !size) continue;
      lo = Math.min(lo, ptr);
      hi = Math.max(hi, ptr + size);
    }
    const shared = hi > lo && hi - lo <= 1 << 24;
    if (shared) this.upload(u8.subarray(lo, hi));
    let program = null;
    for (let i = 0; i < len; ) {
      const head = words[i], op = head & 0xff, n = head >>> 8;
      if (!n) throw new Error("bad record");
      const w = (k) => words[i + k];
      switch (op) {
        case OP.PROGRAM: {
          const old = this.programs.get(w(1));
          if (old) gl.deleteProgram(old.program);
          const p = compile(gl, this.text(u8, w(2), w(3)), this.text(u8, w(4), w(5)));
          const names = this.text(u8, w(7), w(8)).split("\0").filter(Boolean);
          this.programs.set(w(1), { program: p, attrs: w(6), uniforms: names.map((name) => gl.getUniformLocation(p, name)) });
          break;
        }
        case OP.TEXTURE:
          this.texture(w(1), w(2), w(3), w(4));
          break;
        case OP.TARGET: {
          const target = w(1) === 0 ? this.output : this.textures.get(w(1));
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer(target));
          gl.viewport(w(2), w(3), w(4), w(5));
          break;
        }
        case OP.BLEND:
          this.blend(w, f32, i);
          break;
        case OP.UNIFORM: {
          const p = this.programs.get(w(1));
          gl.useProgram(p.program);
          program = p;
          const loc = p.uniforms[w(2)], count = w(4);
          if (loc == null) break;
          if (w(3) === 0) gl[`uniform${count}iv`](loc, i32.subarray(i + 5, i + 5 + count));
          else gl[`uniform${count}fv`](loc, f32.subarray(i + 5, i + 5 + count));
          break;
        }
        case OP.TEXBIND:
          gl.activeTexture(gl.TEXTURE0 + w(1));
          gl.bindTexture(gl.TEXTURE_2D, this.textures.get(w(2)).tex);
          break;
        case OP.DRAW: {
          const p = this.programs.get(w(1));
          if (program !== p) {
            gl.useProgram(p.program);
            program = p;
          }
          const verts = w(2), count = w(3), ptr = w(4), stride = w(5);
          if (!count) break;
          if (ptr) {
            let offset = ptr - lo;
            if (!shared) {
              this.upload(u8.subarray(ptr, ptr + count * stride));
              offset = 0;
            }
            gl.bindVertexArray(this.vao);
            for (let a = this.attribs; a < p.attrs; a++) {
              gl.enableVertexAttribArray(a);
              gl.vertexAttribDivisor(a, 1);
            }
            for (let a = p.attrs; a < this.attribs; a++) gl.disableVertexAttribArray(a);
            this.attribs = p.attrs;
            for (let a = 0; a < p.attrs; a++) gl.vertexAttribIPointer(a, 4, gl.INT, stride, offset + a * 16);
            gl.drawArraysInstanced(gl.TRIANGLES, 0, verts, count);
          } else {
            gl.bindVertexArray(this.empty);
            gl.drawArrays(gl.TRIANGLES, 0, verts);
          }
          this.stats.draws++;
          break;
        }
        case OP.UPLOAD: {
          const t = this.textures.get(w(1));
          const f = t.f, width = w(4), height = w(5), row = w(8);
          gl.bindTexture(gl.TEXTURE_2D, t.tex);
          gl.pixelStorei(gl.UNPACK_ROW_LENGTH, row);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          const pixels = row * (height - 1) + width;
          gl.texSubImage2D(gl.TEXTURE_2D, 0, w(2), w(3), width, height, f.format, f.type, new f.view(buffer, w(7), pixels));
          gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
          this.stats.bytes += pixels * f.bytes;
          break;
        }
        case OP.COPY: {
          const from = this.textures.get(w(1)), to = this.textures.get(w(2));
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer(from));
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer(to));
          gl.blitFramebuffer(w(3), w(4), w(3) + w(7), w(4) + w(8), w(5), w(6), w(5) + w(7), w(6) + w(8), gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          break;
        }
        case OP.READ: {
          const t = this.textures.get(w(1));
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer(t));
          gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
          gl.readPixels(w(2), w(3), w(4), w(5), gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buffer, w(7), w(4) * w(5) * 4));
          break;
        }
        default:
          throw new Error(`command ${op}`);
      }
      i += n;
    }
    gl.disable(gl.BLEND);
    this.stats.lists++;
  }

  upload(bytes) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (bytes.length > this.vboSize) {
      this.vboSize = Math.max(bytes.length, this.vboSize * 2, 1 << 16);
      gl.bufferData(gl.ARRAY_BUFFER, this.vboSize, gl.STREAM_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes);
    this.stats.bytes += bytes.length;
  }

  blend(w, f32, i) {
    const gl = this.gl;
    if (!w(1)) {
      gl.disable(gl.BLEND);
      return;
    }
    const eq = [gl.FUNC_ADD, gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT];
    const fa = [gl.ZERO, gl.ONE, gl.SRC_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.DST_COLOR, gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.CONSTANT_COLOR, gl.ONE_MINUS_CONSTANT_COLOR, gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA];
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(eq[w(2)], eq[w(3)]);
    gl.blendFuncSeparate(fa[w(4)], fa[w(5)], fa[w(6)], fa[w(7)]);
    gl.blendColor(f32[i + 8], f32[i + 9], f32[i + 10], f32[i + 11]);
  }

  compose(overlay) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer(this.output));
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (overlay) {
      gl.viewport(0, 0, this.width, this.height);
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, overlay);
      gl.useProgram(this.overlayProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(gl.getUniformLocation(this.overlayProgram, "uO"), 0);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.empty);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }
    return this.canvas;
  }

  destroy() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
