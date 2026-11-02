// .wgba ② 자체 JS 게임(runtime script)을 격리 틀에서 돌리는 호스트 쪽(exe·웹 같은 파일). 규격 4.2·8장.
//   틀 = <iframe sandbox="allow-scripts" srcdoc=…> — 출처 없음("null"): 호스트·다른 게임의 저장소·화면에 못 닿고 팝업·위 창 이동도 막힘.
//   문서 맨 앞 meta CSP: 스크립트는 틀 스크립트(runner.js, SHA-256 해시)와 blob: 만, 네트워크(fetch·XHR·WebSocket·이미지·폼 등)는 모두 막음.
//   srcdoc 이라 틀 페이지를 가져올 주소가 없다 — 오프라인(웹 앱 설치)에서도 열리고 exe·웹 서버 설정이 필요 없다.
//   이야기는 처음 넘긴 MessagePort 하나로만. 틀이 보낸 것은 종류·크기를 확인하고, 코드로 실행하지 않는다.
// player.js 의 Player 가 이 호스트를 ① 호스트처럼 다룬다(script = true): 입력 비트 → 버튼 키, 세이브·퀵슬롯·일시정지·소리 크기.
import { codeWasm, parseAspect, ratioOf } from "./wgba-format.js";
import { readRomPayload } from "./web-host.js";

const STATE_BYTES = 262144;

export const RUNNER_CSP_PARTS = Object.freeze([
  "default-src 'none'",
  "script-src {hash} blob: 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src blob: data:",
  "media-src blob:",
  "font-src blob: data:",
  "connect-src blob: data:",
  "worker-src blob:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
]);

const READY_WAIT_MS = 10000;
const REQUEST_WAIT_MS = 10000;
const FLUSH_WAIT_MS = 600;
const STATE_MAX = 64 * 1024 * 1024;
const LOG_KEEP = 300;
const LOG_PER_SEC = 100;
const SAVE_MAX_DEFAULT = 1 << 20;

let runnerText = null;

async function runnerSource() {
  if (!runnerText) {
    runnerText = (async () => {
      const response = await fetch(new URL("./runner.js", import.meta.url));
      if (!response.ok) throw new Error(`runner.js ${response.status}`);
      const text = await response.text();
      // 문서 안에 그대로 넣으므로 스크립트를 끝내거나 상태를 바꾸는 표시가 있으면 안 된다
      if (/<\/script|<!--|<script/i.test(text)) throw new Error("runner.js 에 HTML 스크립트 표시가 있습니다");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const hash = `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
      return { text, hash, csp: RUNNER_CSP_PARTS.join("; ").replace("{hash}", hash) };
    })().catch((error) => {
      runnerText = null;
      throw error;
    });
  }
  return runnerText;
}

const attr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cssColor = (value) => (/^[#(),.\w\s%-]{1,64}$/.test(String(value)) ? String(value) : "#000");

/** 틀 문서(srcdoc). 배경색만 호스트 화면에 맞춘다(스크립트 해시와 관계없음). */
export async function runnerDocument({ lang = "en", background = "#000", stretch = false } = {}) {
  const { text, csp, hash } = await runnerSource();
  const style =
    `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${cssColor(background)}}` +
    `canvas{display:block;width:100%;height:100%;object-fit:${stretch ? "fill" : "contain"};image-rendering:pixelated;image-rendering:crisp-edges;outline:none;touch-action:none}` +
    "#tap{position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:0;border:0;background:rgba(0,0,0,.45);cursor:pointer}" +
    "#tap[hidden]{display:none}" +
    "#tap::before,#tap::after{content:'';grid-area:1/1}" +
    "#tap::before{width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.6);box-shadow:inset 0 0 0 2px #fff}" +
    "#tap::after{width:16px;height:18px;margin-left:4px;background:#fff;clip-path:polygon(0 0,100% 50%,0 100%)}";
  const html =
    `<!doctype html><html lang="${attr(lang)}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">` +
    `<meta http-equiv="x-dns-prefetch-control" content="off"><meta name="referrer" content="no-referrer">` +
    `<style>${style}</style></head><body><canvas id="canvas" tabindex="0"></canvas><button id="tap" type="button" hidden></button>` +
    `<script>${text}</script></body></html>`;
  return { html, csp, hash };
}

const copyBuffer = (bytes) => {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out.buffer;
};

/**
 * ② 게임 하나. Player 가 부르는 것: saveData·takeSaveDirty·saveCapacity·canState·stateSave·stateLoad·reset·setInput·
 * setPaused·setSpeed·setVolume·rawKey·flush·dispose, 알림 onHalt·onStats·onChange(Player 가 채움)·onHostKey(화면이 채움).
 */
export class ScriptHost {
  constructor({ wgba, input, container, before = null, lang = "en", text = {}, background = "#000", log = () => {}, reserved = [], onFrame = null, onHostKey = null }) {
    this.script = true;
    this.onFrame = onFrame;
    this.wgba = wgba;
    this.manifest = wgba.manifest;
    this.input = input;
    this.container = container;
    this.before = before;
    this.lang = lang;
    this.text = text;
    this.background = background;
    this.writeLog = log;
    this.reserved = reserved;
    this.width = this.manifest.screen?.width ?? 240;
    this.height = this.manifest.screen?.height ?? 160;
    this.saveKind = this.manifest.save?.kind ?? "storage";
    this.saveCapacity = Number.isInteger(this.manifest.save?.maxSize) ? this.manifest.save.maxSize : SAVE_MAX_DEFAULT;
    this.hasPointer = false;
    this.pointerWanted = false;
    this.halted = "";
    this.save = null;
    this.dirty = false;
    this.stateOn = false;
    this.thumb = null;
    this.logs = [];
    this.fps = 0;
    this.sentBits = 0;
    this.paused = false;
    this.speed = 1;
    this.volume = 1;
    this.frame = null;
    this.port = null;
    this.pending = new Map();
    this.seq = 0;
    this.logBudget = LOG_PER_SEC;
    this.logTimer = 0;
    this.onHalt = null;
    this.onStats = null;
    this.onChange = null;
    this.onHostKey = onHostKey;
    this.onNet = null;
    this.ready = false;
  }

  netPost(message, transfer = []) {
    this.post({ type: "net", ...message }, transfer);
  }

  netFrom(data) {
    const op = data.op;
    if (op === "want") {
      const num = (v) => (Number.isInteger(v) && v >= 0 && v <= 8 ? v : undefined);
      this.onNet?.({ op, purpose: typeof data.purpose === "string" ? data.purpose.slice(0, 32) : "", min: num(data.min), max: num(data.max), role: ["any", "make", "join"].includes(data.role) ? data.role : "any", serial: Number.isInteger(data.serial) ? data.serial & 0xff : undefined });
    } else if (op === "unwant") this.onNet?.({ op });
    else if (op === "board") {
      if (data.board === null || (data.board && typeof data.board === "object" && JSON.stringify(data.board).length <= 8192)) this.onNet?.({ op, board: data.board });
    } else if (op === "send") {
      const to = data.to === "ordered" || data.to === "all" ? data.to : Number.isInteger(data.to) && data.to >= 0 && data.to < 8 ? data.to : null;
      if (to === null || !(data.data instanceof ArrayBuffer) || !data.data.byteLength || data.data.byteLength > 16384) return;
      this.onNet?.({ op, to, data: data.data });
    } else if (op === "state") {
      const to = Number.isInteger(data.to) && data.to >= 0 && data.to < 8 ? data.to : null;
      if (to === null || !(data.data instanceof ArrayBuffer) || !data.data.byteLength || data.data.byteLength > STATE_BYTES) return;
      this.onNet?.({ op, to, data: data.data });
    }
  }

  get canState() {
    return this.stateOn && !this.halted && Boolean(this.port);
  }

  saveData() {
    return this.save;
  }

  takeSaveDirty() {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  /** 틀을 만들고 게임이 webgba.ready() 를 부를 때까지(오래 걸리면 그냥 돌린다) 기다린다. */
  async start(save) {
    if (save && save.length) this.save = new Uint8Array(save);
    this.halted = "";
    this.stateOn = false;
    this.ready = false;
    this.sentBits = 0;
    const own = ratioOf(this.width, this.height);
    const aspect = parseAspect(this.manifest.display?.aspect) ?? own;
    const { html } = await runnerDocument({ lang: this.lang, background: this.background, stretch: aspect[0] !== own[0] || aspect[1] !== own[1] });
    const frame = document.createElement("iframe");
    frame.className = "script-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("allow", "autoplay *");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.title = this.text.frame ?? "game";
    frame.srcdoc = html;
    this.frame = frame;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => this.onPort(event.data);
    let loads = 0;
    frame.addEventListener("load", () => {
      loads++;
      // 틀이 스스로 다른 문서로 갔다(규격 8장) → 지우고 멈춘다
      if (loads > 1 && this.frame === frame) this.halt(this.text.navigated ?? "navigated", { remove: true });
    });
    const hello = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", on);
        reject(new Error(this.text.noRunner ?? "runner did not start"));
      }, READY_WAIT_MS);
      const on = (event) => {
        if (event.source !== frame.contentWindow || event.data?.type !== "wgba:runner") return;
        window.removeEventListener("message", on);
        clearTimeout(timer);
        frame.contentWindow.postMessage({ type: "wgba:port" }, "*", [channel.port2]);
        resolve();
      };
      window.addEventListener("message", on);
    });
    this.container.insertBefore(frame, this.before);
    // 화면이 틀 크기를 맞춘다(exe: 정수 배율·영역 맞춤, 웹: 화면 칸 꽉). 틀은 처음부터 보여야 requestAnimationFrame 이 돈다.
    this.onFrame?.(frame);
    await hello;
    const ready = new Promise((resolve) => {
      this.readyDone = resolve;
      this.readyTimer = setTimeout(resolve, READY_WAIT_MS);
    });
    await this.sendInit();
    await ready;
    clearTimeout(this.readyTimer);
    if (this.halted) throw new Error(this.halted);
    return this;
  }

  async sendInit() {
    const wgba = this.wgba;
    const transfer = [];
    const js = copyBuffer(wgba.js);
    const code = codeWasm(wgba.code).buffer;
    transfer.push(js, code);
    const files = {};
    for (const [name, chunk] of Object.entries(this.manifest.files ?? {})) {
      const bytes = await this.chunkBytes(chunk).catch(() => null);
      if (bytes) {
        files[name] = copyBuffer(bytes);
        transfer.push(files[name]);
      }
    }
    const save = this.save ? copyBuffer(this.save) : null;
    if (save) transfer.push(save);
    this.post(
      {
        type: "init",
        manifest: this.manifest,
        lang: this.lang,
        js,
        code,
        files,
        save,
        buttons: this.input.buttons.map((b) => ({ id: b.id, code: b.code })),
        keyboard: this.manifest.input?.keyboard === "raw" ? "raw" : "mapped",
        reserved: this.reserved,
        volume: this.volume,
        paused: this.paused,
        speed: this.speed,
        text: { tap: this.text.tap ?? "" },
        net: this.manifest.multiplayer ? { protocol: 1, ordered: true, inputs: false, rejoin: this.manifest.multiplayer.rejoin === true } : null,
      },
      transfer,
    );
  }

  /** 조각 이름 → 풀린 바이트. 게임이 부를 수 있는 것은 data.* 와 rom 뿐. */
  async chunkBytes(name) {
    if (name === "rom") {
      if (!this.wgba.romPayload) throw new Error("rom 조각 없음");
      this.romCache ??= readRomPayload(this.wgba.romPayload).then((r) => r.rom);
      return this.romCache;
    }
    if (typeof name !== "string" || !name.startsWith("data.")) throw new Error(`부를 수 없는 조각 ${name}`);
    return this.wgba.chunk(name);
  }

  post(message, transfer = []) {
    try {
      this.port?.postMessage(message, transfer);
    } catch (error) {
      this.writeLog("warn", `틀에 보내지 못함: ${error}`);
    }
  }

  request(type, body = {}, transfer = [], wait = REQUEST_WAIT_MS) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type}: 답 없음`));
      }, wait);
      this.pending.set(id, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      this.post({ type, id, ...body }, transfer);
    });
  }

  answer(data) {
    const done = this.pending.get(data.id);
    if (!done) return;
    this.pending.delete(data.id);
    done(data);
  }

  onPort(data) {
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    switch (data.type) {
      case "ready":
        this.ready = true;
        this.readyDone?.();
        break;
      case "save":
        if (this.saveKind === "none" || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > this.saveCapacity) return;
        this.save = new Uint8Array(data.bytes);
        this.dirty = true;
        break;
      case "stateReady":
        if (this.stateOn !== (data.ready === true)) {
          this.stateOn = data.ready === true;
          this.onChange?.();
        }
        break;
      case "state":
      case "stateLoaded":
      case "flushed":
      case "pong":
        if (Number.isInteger(data.id)) this.answer(data);
        break;
      case "chunkReq":
        if (!Number.isInteger(data.id)) return;
        this.chunkBytes(data.name).then(
          (bytes) => {
            const buffer = copyBuffer(bytes);
            this.post({ type: "chunk", id: data.id, bytes: buffer }, [buffer]);
          },
          (error) => this.post({ type: "chunk", id: data.id, error: String(error?.message ?? error) }),
        );
        break;
      case "log":
        this.noteLog(String(data.level ?? "info").slice(0, 16), String(data.text ?? "").slice(0, 2000));
        break;
      case "stats":
        if (Number.isFinite(data.fps)) {
          this.fps = Math.max(0, Math.min(1000, data.fps));
          this.rafQueued = Number.isInteger(data.queued) ? data.queued : 0;
          this.onStats?.({ fps: this.fps });
        }
        break;
      case "hostKey":
        this.onHostKey?.({
          type: data.down ? "keydown" : "keyup",
          code: String(data.code ?? "").slice(0, 32),
          key: String(data.key ?? "").slice(0, 32),
          keyCode: Number.isInteger(data.keyCode) ? data.keyCode : 0,
          repeat: Boolean(data.repeat),
          shiftKey: Boolean(data.shift),
          ctrlKey: Boolean(data.ctrl),
          altKey: Boolean(data.alt),
          metaKey: Boolean(data.meta),
        });
        break;
      case "net":
        if (typeof data.op === "string") this.netFrom(data);
        break;
      case "exit":
        this.halt(String(data.reason ?? "").slice(0, 300) || (this.text.exited ?? "exit"));
        break;
      case "error":
        this.noteLog("error", String(data.text ?? "").slice(0, 2000));
        this.halt(String(data.text ?? "").slice(0, 500));
        this.readyDone?.();
        break;
    }
  }

  noteLog(level, text) {
    if (this.logBudget <= 0) return;
    if (!this.logTimer) {
      this.logTimer = setTimeout(() => {
        this.logBudget = LOG_PER_SEC;
        this.logTimer = 0;
      }, 1000);
    }
    this.logBudget--;
    this.logs.push({ level, text });
    if (this.logs.length > LOG_KEEP) this.logs.splice(0, this.logs.length - LOG_KEEP);
    this.writeLog(level, text);
  }

  halt(reason, { remove = false } = {}) {
    if (this.halted) return;
    this.halted = reason || "stop";
    if (remove) this.removeFrame();
    else this.post({ type: "pause", paused: true });
    this.onChange?.();
    this.onHalt?.(this.halted);
  }

  /** 입력 비트(Player: 버튼 순서 = 비트) → 바뀐 버튼만 눌림·뗌. */
  setInput(bits) {
    const changed = (bits ^ this.sentBits) >>> 0;
    if (!changed || !this.port) return;
    const down = [];
    const up = [];
    for (let i = 0; i < this.input.buttons.length; i++) {
      const mask = 1 << i;
      if (!(changed & mask)) continue;
      (bits & mask ? down : up).push(i);
    }
    this.sentBits = bits >>> 0;
    this.post({ type: "buttons", down, up });
  }

  /** keyboard "raw" 게임: 호스트에 초점이 있을 때 누른 실제 키를 그대로. */
  rawKey(event, down) {
    this.post({ type: "rawKey", code: event.code, key: event.key, keyCode: event.keyCode | 0, repeat: Boolean(event.repeat), shift: Boolean(event.shiftKey), down });
  }

  get raw() {
    return this.manifest.input?.keyboard === "raw";
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this.post({ type: "pause", paused: this.paused });
  }

  setSpeed(speed) {
    if (speed === this.speed) return;
    this.speed = speed;
    this.post({ type: "speed", value: speed });
  }

  setVolume(volume) {
    this.volume = volume;
    this.post({ type: "volume", value: volume });
  }

  async stateSave() {
    if (!this.canState) return null;
    const data = await this.request("stateSave");
    if (data.error || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > STATE_MAX) throw new Error(data.error || "state");
    const t = data.thumb;
    this.thumb = null;
    if (t && Number.isInteger(t.width) && Number.isInteger(t.height) && t.data instanceof ArrayBuffer && t.data.byteLength === t.width * t.height * 4 && t.width <= 1024 && t.height <= 1024) {
      try {
        this.thumb = new ImageData(new Uint8ClampedArray(t.data), t.width, t.height);
      } catch {}
    }
    return new Uint8Array(data.bytes);
  }

  async stateLoad(bytes) {
    if (!this.canState || !bytes?.length || bytes.length > STATE_MAX) return false;
    const buffer = copyBuffer(bytes);
    const data = await this.request("stateLoad", { bytes: buffer }, [buffer]);
    return data.ok === true;
  }

  /** 틀이 들고 있는 세이브(save.kind localStorage·files)를 지금 받는다. */
  async flush() {
    if (!this.port || this.halted) return;
    try {
      await this.request("flush", {}, [], FLUSH_WAIT_MS);
    } catch {}
  }

  ping() {
    const at = performance.now();
    return this.request("ping").then(() => performance.now() - at);
  }

  /** 다시 시작: 지금 세이브로 틀을 새로 만든다. */
  async reset() {
    await this.flush();
    this.dispose();
    try {
      await this.start(this.save);
      this.onChange?.();
      return true;
    } catch (error) {
      this.halted = String(error?.message ?? error);
      return false;
    }
  }

  removeFrame() {
    this.frame?.remove();
    this.frame = null;
  }

  dispose() {
    for (const done of this.pending.values()) done({ error: "closed" });
    this.pending.clear();
    clearTimeout(this.readyTimer);
    try {
      this.port?.close();
    } catch {}
    this.port = null;
    this.stateOn = false;
    this.removeFrame();
  }
}

/** 열기: { host, hadSave }. wgba = readWgba 결과(js·chunk 포함), input = resolveInput(설명서). */
export async function bootScript(options) {
  const host = new ScriptHost(options);
  try {
    await host.start(options.save ?? null);
  } catch (error) {
    host.dispose();
    throw error;
  }
  return { host, hadSave: Boolean(options.save?.length) };
}

