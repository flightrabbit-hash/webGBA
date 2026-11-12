// .wgba ② 자체 JS 게임의 격리 실행 틀(규격 4.2·8장). 출처 없는 sandbox iframe(allow-scripts 만) 안에서 돈다.
// 문서는 script-host.js 가 srcdoc 으로 만들고 이 파일을 그 안에 그대로 넣는다(CSP 는 문서 맨 앞 meta — 이 파일의 SHA-256 과
// blob: 스크립트만 허락, 네트워크는 모두 막음). 그래서 이 파일 안에는 HTML 스크립트 끝 표시·주석 시작 표시를 쓰지 않는다.
// 호스트와는 처음 받은 MessagePort 하나로만 이야기한다. 게임 JS 는 이 파일이 만든 webgba 객체만 받는다.
(() => {
  "use strict";
  const W = window;
  const canvas = document.getElementById("canvas");
  const tap = document.getElementById("tap");

  // 게임 코드가 바꿔치기하기 전에 쓸 내장 함수를 잡아 둔다.
  const nativePost = MessagePort.prototype.postMessage;
  const nativeRaf = W.requestAnimationFrame.bind(W);
  const nativeCaf = W.cancelAnimationFrame.bind(W);
  const nativeSetTimeout = W.setTimeout.bind(W);
  const nativeClearTimeout = W.clearTimeout.bind(W);
  const nativeSetInterval = W.setInterval.bind(W);
  const now = performance.now.bind(performance);
  const makeURL = URL.createObjectURL.bind(URL);
  const dropURL = URL.revokeObjectURL.bind(URL);
  const utf8 = new TextDecoder("utf-8");
  const utf8Out = new TextEncoder();

  // WebRTC 는 CSP 로 막히지 않는다(크롬은 틀 안에서도 STUN 으로 밖에 보낼 수 있음) → 게임이 쓰기 전에 지운다.
  // 새 틀(iframe)로 깨끗한 것을 다시 얻는 길은 CSP frame-src 'none' 이 막는다(자식 틀이 출처가 다른 오류 문서가 됨).
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"]) {
    try {
      delete W[name];
    } catch {}
  }
  // Windows 앱(WebView2)은 앱 다리 스크립트를 틀에도 넣는다(wry: Windows 는 for_main_frame_only 를 무시). 틀에서 불러도 앱이
  // 받지 않지만(ipc.localhost 는 CSP 가 막고, 틀의 chrome.webview.postMessage 는 앱이 듣지 않음 — app-script 시험이 부작용으로 확인)
  // 겹으로 게임이 보기 전에 그 통로를 지운다. __TAURI_INTERNALS__ 는 지울 수 없게 정의되어 있어 안의 함수만 비운다.
  for (const name of ["__TAURI__", "__TAURI_IPC__", "__TAURI_POST_MESSAGE__", "ipc"]) {
    try {
      delete W[name];
    } catch {}
  }
  try {
    const inner = W.__TAURI_INTERNALS__;
    if (inner && typeof inner === "object") {
      for (const key of Reflect.ownKeys(inner)) {
        try {
          Object.defineProperty(inner, key, { value: undefined, writable: false, configurable: false });
        } catch {}
      }
      Object.freeze(inner);
    }
  } catch {}
  try {
    if (W.chrome && "webview" in W.chrome) delete W.chrome.webview;
    if (W.chrome?.webview) Object.defineProperty(W.chrome, "webview", { value: undefined });
  } catch {}
  try {
    delete W.chrome;
  } catch {}

  let port = null;
  let send = () => {};
  let init = null;
  let started = false;
  let readySent = false;
  let paused = false;
  let speed = 1;
  let volume = 1;
  const listeners = { button: new Set(), pause: new Set(), resume: new Set(), speed: new Set() };
  const emit = (name, value) => {
    for (const fn of listeners[name]) {
      try {
        fn(value);
      } catch (error) {
        report("error", error);
      }
    }
  };

  let logBudget = 200;
  nativeSetInterval(() => (logBudget = 200), 1000);
  function report(level, value) {
    if (logBudget <= 0) return;
    logBudget--;
    const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
    send({ type: "log", level: String(level).slice(0, 16), text: text.slice(0, 2000) });
  }
  W.addEventListener("error", (event) => report("error", event.error ?? event.message));
  W.addEventListener("unhandledrejection", (event) => report("error", event.reason));

  // ── 화면 갱신(requestAnimationFrame): 일시정지면 붙잡아 두고, 초당 프레임을 센다 ──
  let rafSeq = 0;
  const rafLive = new Map();
  const rafHeld = new Map();
  let frames = 0;
  let lastStamp = -1;
  function runRaf(id, fn) {
    rafLive.set(id, {
      fn,
      handle: nativeRaf((stamp) => {
        rafLive.delete(id);
        if (stamp !== lastStamp) {
          lastStamp = stamp;
          frames++;
          fireTick();
        }
        fn(stamp);
      }),
    });
  }
  function pumpRaf() {
    if (paused || document.visibilityState !== "hidden" || !rafLive.size) return;
    const due = [...rafLive.entries()];
    rafLive.clear();
    const stamp = now();
    frames++;
    fireTick();
    for (const [, entry] of due) {
      nativeCaf(entry.handle);
      try {
        entry.fn(stamp);
      } catch (error) {
        report("error", error);
      }
    }
  }
  W.requestAnimationFrame = function requestAnimationFrame(fn) {
    if (typeof fn !== "function") throw new TypeError("requestAnimationFrame: 함수가 아님");
    const id = ++rafSeq;
    if (paused) rafHeld.set(id, fn);
    else runRaf(id, fn);
    return id;
  };
  W.cancelAnimationFrame = function cancelAnimationFrame(id) {
    rafHeld.delete(id);
    const live = rafLive.get(id);
    if (live !== undefined) {
      nativeCaf(live.handle);
      rafLive.delete(id);
    }
  };
  // 타이머가 몰려 짧은 간격으로 두 번 오면(웹킷) 값이 튀므로 0.5초 이상 모였을 때만 낸다.
  // 웹킷(사파리)은 사용자가 아직 누르지 않은 출처 다른 틀의 화면 갱신을 30Hz 로 묶는다 → 2초 넘게 40fps 아래면 "눌러서 시작" 덮개.
  let statAt = now();
  let slowWindows = 0;
  let throttled = false;
  nativeSetInterval(() => {
    const at = now();
    if (at - statAt < 500) return;
    const fps = Math.round(((frames * 1000) / (at - statAt)) * 10) / 10;
    if (started) send({ type: "stats", fps, queued: rafLive.size + rafHeld.size });
    slowWindows = started && !paused && frames > 0 && fps < 40 ? slowWindows + 1 : 0;
    if (slowWindows >= 2 && !throttled) {
      throttled = true;
      checkTap();
    }
    frames = 0;
    statAt = at;
  }, 1000);

  // ── 소리: 게임이 만드는 AudioContext 를 감싸 크기·끄기·일시정지를 호스트가 정하고, 잠긴 소리는 틀 안을 한 번 눌러 켠다 ──
  const NativeAC = W.AudioContext ?? W.webkitAudioContext ?? null;
  const contexts = new Set();
  const gains = new WeakMap();
  const pausedByUs = new Set();
  let unlocked = false;
  let tapTimer = 0;
  function needTap() {
    if (unlocked || paused) return false;
    if (throttled) return true;
    for (const ac of contexts) if (ac.state === "suspended") return true;
    return false;
  }
  function checkTap() {
    nativeClearTimeout(tapTimer);
    tapTimer = nativeSetTimeout(() => (tap.hidden = !needTap()), 400);
  }
  if (NativeAC) {
    const destination = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination")?.get;
    class GameAudioContext extends NativeAC {
      constructor(...args) {
        super(...args);
        const real = destination ? destination.call(this) : super.destination;
        const gain = NativeAC.prototype.createGain.call(this);
        gain.gain.value = volume;
        gain.connect(real);
        Object.defineProperty(gain, "maxChannelCount", { get: () => real.maxChannelCount });
        gains.set(this, gain);
        contexts.add(this);
        this.addEventListener("statechange", checkTap);
        if (paused && this.state !== "closed") {
          pausedByUs.add(this);
          NativeAC.prototype.suspend.call(this).catch(() => {});
        } else if (unlocked) NativeAC.prototype.resume.call(this).catch(() => {});
        checkTap();
      }
      get destination() {
        return gains.get(this);
      }
      close() {
        contexts.delete(this);
        return super.close();
      }
    }
    W.AudioContext = GameAudioContext;
    if (W.webkitAudioContext) W.webkitAudioContext = GameAudioContext;
  }
  let shared = null;
  const sharedAudio = () => {
    if (!shared && W.AudioContext) shared = new W.AudioContext({ latencyHint: "interactive" });
    return shared;
  };
  function setVolume(value) {
    volume = Math.max(0, Math.min(1, Number(value) || 0));
    for (const ac of contexts) {
      const gain = gains.get(ac);
      if (gain) gain.gain.value = volume;
    }
  }
  function unlock() {
    unlocked = true;
    tap.hidden = true;
    if (paused) return;
    for (const ac of contexts) if (ac.state === "suspended") NativeAC.prototype.resume.call(ac).catch(() => {});
  }
  for (const type of ["pointerdown", "touchend", "keydown"]) W.addEventListener(type, (event) => event.isTrusted && unlock(), true);

  // ── 저장소: 출처가 없어 진짜 localStorage·sessionStorage 는 SecurityError → 메모리에 두는 것으로 바꿔 끼운다.
  //    설명서 save.kind "localStorage" 면 localStorage 내용을 호스트가 이 게임의 세이브로 저장한다. ──
  function memoryStorage(initial, onChange) {
    const map = new Map(Object.entries(initial ?? {}).map(([k, v]) => [String(k), String(v)]));
    const api = {
      get length() {
        return map.size;
      },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => {
        map.set(String(k), String(v));
        onChange?.(map);
      },
      removeItem: (k) => {
        if (map.delete(String(k))) onChange?.(map);
      },
      clear: () => {
        if (!map.size) return;
        map.clear();
        onChange?.(map);
      },
    };
    return new Proxy(api, {
      get: (target, key) => (key in target ? target[key] : typeof key === "string" && map.has(key) ? map.get(key) : undefined),
      set: (target, key, value) => {
        if (key in target) return false;
        api.setItem(key, value);
        return true;
      },
      deleteProperty: (target, key) => {
        api.removeItem(key);
        return true;
      },
      has: (target, key) => key in target || map.has(String(key)),
      ownKeys: () => [...map.keys()],
      getOwnPropertyDescriptor: (target, key) => (map.has(String(key)) ? { value: map.get(String(key)), enumerable: true, configurable: true, writable: true } : undefined),
    });
  }
  function placeStorage(name, storage) {
    try {
      Object.defineProperty(W, name, { value: storage, configurable: false, enumerable: true, writable: false });
    } catch (error) {
      report("warn", `${name}: ${error}`);
    }
  }

  // ── 키: 틀에 초점이 있을 때 들어온 실제 키는 호스트로 넘겨 호스트가 사용자 배치대로 바꿔 돌려준다(호스트 초점일 때와 같은 길).
  //    keyboard "raw" 게임은 호스트 몫 키만 넘기고 나머지는 게임이 그대로 받는다. ──
  const KEY = {
    Space: [" ", 32], Enter: ["Enter", 13], NumpadEnter: ["Enter", 13], Escape: ["Escape", 27], Backspace: ["Backspace", 8], Tab: ["Tab", 9], Delete: ["Delete", 46],
    ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
    ShiftLeft: ["Shift", 16], ShiftRight: ["Shift", 16], ControlLeft: ["Control", 17], ControlRight: ["Control", 17], AltLeft: ["Alt", 18], AltRight: ["Alt", 18],
    Home: ["Home", 36], End: ["End", 35], PageUp: ["PageUp", 33], PageDown: ["PageDown", 34], Insert: ["Insert", 45],
    Minus: ["-", 189], Equal: ["=", 187], Comma: [",", 188], Period: [".", 190], Slash: ["/", 191], Semicolon: [";", 186], Quote: ["'", 222], BracketLeft: ["[", 219], BracketRight: ["]", 221], Backslash: ["\\", 220], Backquote: ["`", 192],
  };
  function legacy(code) {
    if (KEY[code]) return KEY[code];
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return [m[1].toLowerCase(), m[1].charCodeAt(0)];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return [m[1], 48 + Number(m[1])];
    m = /^Numpad([0-9])$/.exec(code);
    if (m) return [m[1], 96 + Number(m[1])];
    m = /^F([0-9]{1,2})$/.exec(code);
    if (m) return [code, 111 + Number(m[1])];
    return ["Unidentified", 0];
  }
  function dispatchKey(code, down, extra = {}) {
    const [key, keyCode] = legacy(code);
    const init = { code, key: extra.key ?? key, keyCode: extra.keyCode ?? keyCode, which: extra.keyCode ?? keyCode, repeat: Boolean(extra.repeat), shiftKey: Boolean(extra.shift), bubbles: true, cancelable: true, composed: true };
    const event = new KeyboardEvent(down ? "keydown" : "keyup", init);
    if (event.keyCode !== init.keyCode) {
      Object.defineProperty(event, "keyCode", { get: () => init.keyCode });
      Object.defineProperty(event, "which", { get: () => init.keyCode });
    }
    const active = document.activeElement;
    (active && active !== document.body && active !== tap ? active : canvas).dispatchEvent(event);
  }
  let reserved = new Set();
  const hostKey = (event) => event.ctrlKey || event.altKey || event.metaKey || reserved.has(event.code);
  for (const type of ["keydown", "keyup"]) {
    W.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted) return;
        if (init?.keyboard === "raw" && !hostKey(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        send({ type: "hostKey", down: type === "keydown", code: String(event.code), key: String(event.key), keyCode: event.keyCode | 0, repeat: event.repeat, shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey });
      },
      true,
    );
  }

  // 버튼(설명서 input.buttons 순서) → 게임 키 이벤트 + webgba.input.held·"button" 이벤트
  let buttons = [];
  const held = new Set();
  const codeDown = new Map();
  function setButton(index, down) {
    const b = buttons[index];
    if (!b) return;
    if (down === held.has(b.id)) return;
    if (down) held.add(b.id);
    else held.delete(b.id);
    const count = codeDown.get(b.code) ?? 0;
    const next = Math.max(0, count + (down ? 1 : -1));
    codeDown.set(b.code, next);
    if ((down && count === 0) || (!down && next === 0)) dispatchKey(b.code, down);
    emit("button", { id: b.id, down });
  }

  let fireFrame = 0;
  let fireRate = 0;
  let fireSet = new Set();
  const fireSince = new Map();
  function hostButton(index, down) {
    if (down && fireRate && fireSet.has(index)) fireSince.set(index, fireFrame);
    else fireSince.delete(index);
    setButton(index, down);
  }
  function fireTick() {
    fireFrame++;
    for (const [index, since] of fireSince) setButton(index, Math.floor(((fireFrame - since) * fireRate) / 30) % 2 === 0);
  }
  function setFire(data) {
    fireRate = Number.isInteger(data?.rate) && data.rate > 0 ? data.rate : 0;
    fireSet = new Set(fireRate && Array.isArray(data.buttons) ? data.buttons.filter(Number.isInteger) : []);
    for (const index of [...fireSince.keys()]) {
      fireSince.delete(index);
      setButton(index, true);
    }
    buttons.forEach((b, index) => {
      if (fireRate && fireSet.has(index) && held.has(b.id)) fireSince.set(index, fireFrame);
    });
  }

  // ── 일시정지·빨리 감기 ──
  function setPaused(value) {
    if (value === paused) return;
    paused = value;
    if (paused) {
      for (const ac of contexts) {
        if (ac.state === "running") {
          pausedByUs.add(ac);
          NativeAC.prototype.suspend.call(ac).catch(() => {});
        }
      }
      tap.hidden = true;
      emit("pause");
    } else {
      for (const ac of pausedByUs) if (ac.state !== "closed") NativeAC.prototype.resume.call(ac).catch(() => {});
      pausedByUs.clear();
      const waiting = [...rafHeld];
      rafHeld.clear();
      for (const [id, fn] of waiting) runRaf(id, fn);
      emit("resume");
      checkTap();
    }
  }

  // ── 호스트 요청에 답하기 ──
  const pendingChunks = new Map();
  let chunkSeq = 0;
  const askChunk = (name) =>
    new Promise((resolve, reject) => {
      const id = ++chunkSeq;
      pendingChunks.set(id, { resolve, reject });
      send({ type: "chunkReq", id, name });
    });
  let stateSave = null;
  let stateLoad = null;
  const tellState = () => send({ type: "stateReady", ready: Boolean(stateSave && stateLoad) });

  function snapshot() {
    try {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return null;
      const copy = document.createElement("canvas");
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      return { width: w, height: h, data: data.buffer };
    } catch {
      return null;
    }
  }

  async function onState(data) {
    if (data.type === "stateSave") {
      try {
        if (!stateSave) throw new Error("state.onSave 없음");
        const out = await stateSave();
        if (!(out instanceof Uint8Array)) throw new Error("state.onSave 가 Uint8Array 를 돌려주지 않음");
        const bytes = out.slice();
        const thumb = snapshot();
        send({ type: "state", id: data.id, bytes: bytes.buffer, thumb }, thumb ? [bytes.buffer, thumb.data] : [bytes.buffer]);
      } catch (error) {
        send({ type: "state", id: data.id, error: String(error?.message ?? error).slice(0, 300) });
      }
    } else {
      let ok = false;
      try {
        if (stateLoad) ok = (await stateLoad(new Uint8Array(data.bytes))) === true;
      } catch (error) {
        report("error", error);
      }
      send({ type: "stateLoaded", id: data.id, ok });
    }
  }

  // ── 세이브(설명서 save.kind) ──
  let saveBytes = null;
  let maxSave = 1 << 20;
  function pushSave(bytes) {
    if (bytes.length > maxSave) throw new Error(`세이브가 설명서의 save.maxSize(${maxSave}) 보다 큼`);
    saveBytes = bytes.slice();
    const out = bytes.slice();
    send({ type: "save", bytes: out.buffer }, [out.buffer]);
  }
  let lsTimer = 0;
  let lsMap = null;
  function lsChanged(map) {
    lsMap = map;
    nativeClearTimeout(lsTimer);
    lsTimer = nativeSetTimeout(flushStorage, 500);
  }
  function flushStorage() {
    nativeClearTimeout(lsTimer);
    lsTimer = 0;
    if (!lsMap) return;
    const bytes = utf8Out.encode(JSON.stringify(Object.fromEntries(lsMap)));
    lsMap = null;
    try {
      pushSave(bytes);
    } catch (error) {
      report("error", error);
    }
  }
  let fsWatch = null;
  function watchFile(FS, path) {
    let seen = "";
    const look = () => {
      try {
        const st = FS.stat(path);
        const mark = `${st.mtime?.getTime?.() ?? st.mtime}:${st.size}`;
        if (mark === seen) return;
        seen = mark;
        const bytes = FS.readFile(path);
        if (!saveBytes || bytes.length !== saveBytes.length || bytes.some((b, i) => b !== saveBytes[i])) pushSave(bytes);
      } catch {}
    };
    try {
      const st = FS.stat(path);
      seen = `${st.mtime?.getTime?.() ?? st.mtime}:${st.size}`;
    } catch {}
    fsWatch = look;
    nativeSetInterval(look, 1000);
  }
  function flushAll() {
    flushStorage();
    fsWatch?.();
  }

  // ── webgba 객체(규격 4.2.2, 틀 API 1) ──
  const deepFreeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
  };
  function makeApi(data, code) {
    const manifest = deepFreeze(structuredClone(data.manifest));
    const kind = manifest.save?.kind ?? "storage";
    let compiled = null;
    const urls = new Map();
    const heldView = Object.freeze({ has: (id) => held.has(id), forEach: (fn) => held.forEach((id) => fn(id, id)), get size() { return held.size; }, [Symbol.iterator]: () => held.values(), values: () => held.values() });
    return Object.freeze({
      version: 1,
      manifest,
      lang: String(data.lang ?? "en"),
      canvas,
      wasm: async () => code.slice(0),
      wasmModule: () => (compiled ??= WebAssembly.compile(code.slice(0))),
      chunk: async (name) => new Uint8Array(await askChunk(String(name))),
      chunkURL: async (name) => {
        const key = String(name);
        if (!urls.has(key)) urls.set(key, makeURL(new Blob([await askChunk(key)])));
        return urls.get(key);
      },
      save: Object.freeze({
        read: async () => (kind === "storage" && saveBytes ? saveBytes.slice() : null),
        write: async (bytes) => {
          if (kind !== "storage") throw new Error(`save.kind 가 ${kind} 라 webgba.save 를 쓰지 않습니다`);
          pushSave(new Uint8Array(bytes));
        },
      }),
      state: Object.freeze({
        onSave: (fn) => {
          stateSave = typeof fn === "function" ? fn : null;
          tellState();
        },
        onLoad: (fn) => {
          stateLoad = typeof fn === "function" ? fn : null;
          tellState();
        },
      }),
      input: Object.freeze({ held: heldView }),
      on: (name, fn) => {
        const set = listeners[name];
        if (!set || typeof fn !== "function") return () => {};
        set.add(fn);
        if (name === "speed" && speed !== 1) fn(speed);
        return () => set.delete(fn);
      },
      audioContext: sharedAudio,
      ready: () => {
        if (readySent) return;
        readySent = true;
        send({ type: "ready" });
      },
      exit: (reason) => send({ type: "exit", reason: String(reason ?? "").slice(0, 300) }),
      log: (level, text) => report(level, text),
      net: makeNet(data.net),
    });
  }

  const net = { host: null, onevent: null, onrecv: null, onstate: null, serial: 0 };
  function makeNet(info) {
    if (!info || typeof info !== "object") return null;
    net.host = Object.freeze({ protocol: Number(info.protocol) || 1, ordered: info.ordered !== false, inputs: Boolean(info.inputs), rejoin: info.rejoin === true });
    const toOf = (to) => (to === "ordered" || to === "all" ? to : Number.isInteger(to) && to >= 0 && to < 8 ? to : null);
    return Object.freeze({
      get host() {
        return net.host;
      },
      want: (options = {}) => {
        net.serial = (net.serial % 255) + 1;
        const o = options && typeof options === "object" ? options : {};
        send({ type: "net", op: "want", purpose: String(o.purpose ?? ""), min: Number.isInteger(o.min) ? o.min : undefined, max: Number.isInteger(o.max) ? o.max : undefined, role: ["make", "join"].includes(o.role) ? o.role : "any", serial: net.serial });
        return net.serial;
      },
      unwant: () => send({ type: "net", op: "unwant" }),
      board: (table) => {
        if (table === null || table === undefined) return send({ type: "net", op: "board", board: null });
        if (!table || typeof table !== "object") throw new Error("webgba.net.board: 객체 또는 null");
        const plain = JSON.parse(JSON.stringify(table));
        send({ type: "net", op: "board", board: plain });
      },
      send: (to, bytes) => {
        const target = toOf(to);
        if (target === null) throw new Error(`webgba.net.send: 받는 곳이 규칙 밖입니다: ${to}`);
        const view = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
        if (!view || !view.length || view.length > 16384) throw new Error("webgba.net.send: 바이트는 1~16384");
        const data = view.slice().buffer;
        send({ type: "net", op: "send", to: target, data }, [data]);
      },
      sendState: (to, bytes) => {
        if (!Number.isInteger(to) || to < 0 || to >= 8) throw new Error(`webgba.net.sendState: 받는 곳은 자리 0~7: ${to}`);
        const view = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
        if (!view || !view.length || view.length > 262144) throw new Error("webgba.net.sendState: 바이트는 1~262144");
        const data = view.slice().buffer;
        send({ type: "net", op: "state", to, data }, [data]);
      },
      get onstate() {
        return net.onstate;
      },
      set onstate(fn) {
        net.onstate = typeof fn === "function" ? fn : null;
      },
      get onevent() {
        return net.onevent;
      },
      set onevent(fn) {
        net.onevent = typeof fn === "function" ? fn : null;
      },
      get onrecv() {
        return net.onrecv;
      },
      set onrecv(fn) {
        net.onrecv = typeof fn === "function" ? fn : null;
      },
    });
  }
  function onNet(data) {
    try {
      if (data.op === "hello" && net.host) net.host = Object.freeze({ protocol: Number(data.protocol) || 1, ordered: data.ordered !== false, inputs: Boolean(data.inputs), rejoin: data.rejoin === true });
      else if (data.op === "event" && net.onevent) net.onevent(data.kind | 0, data.a >>> 0, data.b >>> 0);
      else if (data.op === "recv" && net.onrecv && data.data instanceof ArrayBuffer) net.onrecv(data.from | 0, new Uint8Array(data.data));
      else if (data.op === "state" && net.onstate && data.data instanceof ArrayBuffer) net.onstate(data.from | 0, new Uint8Array(data.data));
    } catch (error) {
      report("error", error);
    }
  }

  function importText(text) {
    const url = makeURL(new Blob([text], { type: "text/javascript" }));
    return import(url).finally(() => dropURL(url));
  }
  function classicScript(text) {
    return new Promise((resolve, reject) => {
      const url = makeURL(new Blob([text], { type: "text/javascript" }));
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => {
        dropURL(url);
        resolve();
      };
      script.onerror = () => {
        dropURL(url);
        reject(new Error("게임 JS 를 불러오지 못했습니다"));
      };
      document.head.append(script);
    });
  }

  async function startEmscripten(text, data, code, webgba) {
    const manifest = webgba.manifest;
    const files = new Map();
    for (const [name, bytes] of Object.entries(data.files ?? {})) files.set(name, makeURL(new Blob([bytes])));
    const savePath = manifest.save?.kind === "files" && Array.isArray(manifest.save.files) ? String(manifest.save.files[0] ?? "") : "";
    const base = (path) => String(path).split("/").pop();
    const Module = {
      canvas,
      wasmBinary: code.slice(0),
      arguments: Array.isArray(manifest.entry?.args) ? manifest.entry.args.map(String) : [],
      locateFile: (path, prefix = "") => files.get(path) ?? files.get(base(path)) ?? `${prefix}${path}`,
      print: (line) => report("info", line),
      printErr: (line) => report("warn", line),
      preRun: [
        (mod) => {
          if (!savePath || !saveBytes) return;
          const FS = (mod ?? Module).FS ?? W.FS;
          if (!FS) return report("warn", "save.kind files: FS 가 내보내지지 않아 세이브를 놓지 못함(-sEXPORTED_RUNTIME_METHODS=FS)");
          const dir = savePath.slice(0, savePath.lastIndexOf("/"));
          if (dir) FS.mkdirTree(dir);
          FS.writeFile(savePath, saveBytes);
        },
      ],
      onRuntimeInitialized: () => {
        const FS = Module.FS ?? W.FS;
        if (savePath && FS) watchFile(FS, savePath);
        webgba.ready();
      },
      onAbort: (what) => send({ type: "exit", reason: `abort ${String(what ?? "").slice(0, 200)}` }),
    };
    if (/^\s*export\s+(?:default\b|\{)/m.test(text)) {
      const mod = await importText(text);
      const factory = mod.default ?? Object.values(mod).find((v) => typeof v === "function");
      if (typeof factory !== "function") throw new Error("emscripten ES 모듈에 팩토리 함수가 없습니다");
      await factory(Module);
      return;
    }
    const box = { exports: {} };
    W.Module = Module;
    W.module = box;
    W.exports = box.exports;
    try {
      await classicScript(text);
    } finally {
      delete W.module;
      delete W.exports;
    }
    const factory = typeof box.exports === "function" ? box.exports : typeof box.exports?.default === "function" ? box.exports.default : null;
    if (factory) await factory(Module);
  }

  async function start(data) {
    init = data;
    started = true;
    buttons = Array.isArray(data.buttons) ? data.buttons.map((b) => ({ id: String(b.id), code: String(b.code) })) : [];
    reserved = new Set(Array.isArray(data.reserved) ? data.reserved.map(String) : []);
    maxSave = Number.isInteger(data.manifest.save?.maxSize) ? data.manifest.save.maxSize : 1 << 20;
    saveBytes = data.save ? new Uint8Array(data.save) : null;
    canvas.width = data.manifest.screen?.width ?? 240;
    canvas.height = data.manifest.screen?.height ?? 160;
    tap.setAttribute("aria-label", String(data.text?.tap ?? "▶"));
    tap.textContent = String(data.text?.tap ?? "");
    setVolume(data.volume ?? 1);
    if (data.paused) setPaused(true);
    speed = Number(data.speed) || 1;
    setFire(data.autoFire);
    if (data.manifest.pointer?.use) canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    let ls = {};
    if (data.manifest.save?.kind === "localStorage" && saveBytes) {
      try {
        const parsed = JSON.parse(utf8.decode(saveBytes));
        if (parsed && typeof parsed === "object") ls = parsed;
      } catch {}
    }
    placeStorage("localStorage", memoryStorage(ls, data.manifest.save?.kind === "localStorage" ? lsChanged : null));
    placeStorage("sessionStorage", memoryStorage({}, null));
    const code = data.code;
    const webgba = makeApi(data, code);
    const text = utf8.decode(new Uint8Array(data.js));
    canvas.focus({ preventScroll: true });
    if (data.manifest.entry?.style === "emscripten") await startEmscripten(text, data, code, webgba);
    else {
      const mod = await importText(text);
      if (typeof mod.default !== "function") throw new Error("게임 JS 에 기본 내보내기 함수가 없습니다");
      await mod.default(webgba);
    }
  }

  function onHost(event) {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "init":
        if (started) return;
        start(data).catch((error) => send({ type: "error", text: `${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 500)}` }));
        break;
      case "buttons":
        for (const i of data.up ?? []) hostButton(i, false);
        for (const i of data.down ?? []) hostButton(i, true);
        break;
      case "autoFire":
        setFire(data);
        break;
      case "rawKey":
        dispatchKey(String(data.code), Boolean(data.down), { key: data.key, keyCode: data.keyCode, repeat: data.repeat, shift: data.shift });
        break;
      case "pause":
        setPaused(Boolean(data.paused));
        break;
      case "speed":
        if (Number(data.value) !== speed) {
          speed = Number(data.value) || 1;
          emit("speed", speed);
        }
        break;
      case "volume":
        setVolume(data.value);
        break;
      case "stateSave":
      case "stateLoad":
        onState(data);
        break;
      case "chunk": {
        const wait = pendingChunks.get(data.id);
        if (!wait) return;
        pendingChunks.delete(data.id);
        if (data.bytes instanceof ArrayBuffer) wait.resolve(data.bytes);
        else wait.reject(new Error(String(data.error ?? "조각 없음")));
        break;
      }
      case "flush":
        flushAll();
        send({ type: "flushed", id: data.id });
        break;
      case "ping":
        send({ type: "pong", id: data.id });
        break;
      case "tick":
        pumpRaf();
        break;
      case "net":
        onNet(data);
        break;
    }
  }

  W.addEventListener("message", (event) => {
    if (port || event.source !== W.parent || event.data?.type !== "wgba:port" || !event.ports?.[0]) return;
    port = event.ports[0];
    send = (message, transfer) => Reflect.apply(nativePost, port, transfer ? [message, transfer] : [message]);
    port.onmessage = onHost;
    send({ type: "hello" });
  });
  W.parent.postMessage({ type: "wgba:runner" }, "*");
})();
