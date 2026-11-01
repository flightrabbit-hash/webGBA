// hello-script: a small runtime "script" example for .wgba (no ROM, no network).
// It shows the frame API of spec chapter 4.2: drawing with requestAnimationFrame, buttons and the
// key events a button sends (manifest input.buttons[].code), save (webgba.save), quick slots
// (webgba.state), pause / resume / speed events and sound (webgba.audioContext).
//
//   Z (button JUMP, the game sees KeyboardEvent "Space")   jump: counter + 1, saved at once
//   arrows                                                 move the square
//
// Every step prints one line with webgba.log(<tag>, <text>), so tests can read what happened:
//   start jumps <n> save <bytes> · key down <code> "<key>" <keyCode> · button <id> down|up
//   event pause|resume|speed <n> · state load <bytes> <frame> <jumps> · audio <state> · perf <...>
//
// Test hook: if the manifest has "x-probe", the game tries to reach outside the isolated frame
// (network, storage, parent window, popups, Tauri) and prints "probe <json>". webGBA must block
// every try; this is how the isolation test of webGBA checks its frame. Normal games never do this.

const W = 320;
const H = 240;

export default async function start(webgba) {
  const probe = webgba.manifest["x-probe"];
  if (probe?.selfNav) {
    webgba.ready();
    setTimeout(() => location.replace("about:blank#nav"), 300);
    return;
  }
  if (probe) {
    webgba.ready();
    webgba.log("probe", JSON.stringify(await tryOutside(probe)));
    return;
  }

  const canvas = webgba.canvas;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const st = { jumps: 0, frame: 0, x: 150, y: 110, dx: 0, dy: 0, hop: 0, cost: 0, costN: 0 };

  const saved = await webgba.save.read();
  if (saved && saved.length === 4) st.jumps = new DataView(saved.buffer, saved.byteOffset, 4).getUint32(0, true);
  webgba.log("start", `jumps ${st.jumps} save ${saved ? saved.length : 0}`);

  const counter = () => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, st.jumps, true);
    return out;
  };

  const sound = async () => {
    let ac = null;
    try {
      ac = webgba.audioContext();
    } catch {}
    if (!ac) {
      webgba.log("audio", "none");
      return;
    }
    try {
      await Promise.race([ac.resume(), new Promise((ok) => setTimeout(ok, 500))]);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0.05;
      osc.frequency.value = 660;
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.05);
    } catch {}
    webgba.log("audio", ac.state);
  };

  const jump = () => {
    st.jumps++;
    st.hop = 12;
    webgba.save.write(counter());
    sound();
  };

  const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  addEventListener("keydown", (e) => {
    webgba.log("key", `down ${e.code} ${JSON.stringify(e.key)} ${e.keyCode}`);
    if (keys[e.code]) [st.dx, st.dy] = keys[e.code];
  });
  addEventListener("keyup", (e) => {
    if (keys[e.code]) [st.dx, st.dy] = [0, 0];
  });
  webgba.on("button", ({ id, down }) => {
    webgba.log("button", `${id} ${down ? "down" : "up"}`);
    if (id === "JUMP" && down) jump();
  });
  webgba.on("pause", () => webgba.log("event", "pause"));
  webgba.on("resume", () => webgba.log("event", "resume"));
  webgba.on("speed", (value) => webgba.log("event", `speed ${value}`));

  webgba.state.onSave(() => {
    const out = new Uint8Array(12);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, st.jumps, true);
    dv.setUint32(4, st.frame, true);
    dv.setInt16(8, st.x, true);
    dv.setInt16(10, st.y, true);
    return out;
  });
  webgba.state.onLoad((bytes) => {
    if (bytes.length !== 12) return false;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, 12);
    st.jumps = dv.getUint32(0, true);
    st.x = dv.getInt16(8, true);
    st.y = dv.getInt16(10, true);
    webgba.log("state", `load ${bytes.length} ${dv.getUint32(4, true)} ${st.jumps}`);
    return true;
  });

  const frame = () => {
    const t0 = performance.now();
    st.frame++;
    st.x = Math.max(0, Math.min(W - 20, st.x + st.dx * 2));
    st.y = Math.max(20, Math.min(H - 20, st.y + st.dy * 2));
    if (st.hop) st.hop--;
    ctx.fillStyle = "#1d2433";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2f7d5b";
    ctx.fillRect(0, H - 20, W, 20);
    ctx.fillStyle = "#ffd23c";
    ctx.fillRect(st.x, st.y - st.hop * 2, 20, 20);
    for (let i = 0; i < Math.min(st.jumps, 30); i++) {
      ctx.fillStyle = "#dcdcdc";
      ctx.fillRect(8 + i * 10, 8, 6, 6);
    }
    st.cost += performance.now() - t0;
    if (++st.costN === 120) {
      webgba.log("perf", `frames 120 draw ${(st.cost / 120).toFixed(3)}ms`);
      st.cost = 0;
      st.costN = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  webgba.ready();
}

async function tryOutside({ url = "", ws = "", stun = "" }) {
  const out = {};
  const tryIt = async (key, fn) => {
    try {
      const value = await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 2500))]);
      out[key] = `열림 ${String(value).slice(0, 40)}`;
    } catch (e) {
      out[key] = `막힘 ${e && e.name ? e.name : String(e)}`;
    }
  };
  await tryIt("fetch", () => fetch(`${url}?fetch`).then((r) => r.status));
  await tryIt("xhr", () => new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open("GET", `${url}?xhr`);
    x.onload = () => ok(x.status);
    x.onerror = () => no(new Error("NetworkError"));
    x.send();
  }));
  await tryIt("webSocket", () => new Promise((ok, no) => {
    const w = new WebSocket(ws);
    w.onopen = () => ok("open");
    w.onerror = () => no(new Error("WebSocketError"));
  }));
  await tryIt("eventSource", () => new Promise((ok, no) => {
    const s = new EventSource(`${url}?es`);
    s.onopen = () => ok("open");
    s.onerror = () => {
      s.close();
      no(new Error("EventSourceError"));
    };
  }));
  await tryIt("image", () => new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok("load");
    i.onerror = () => no(new Error("ImageError"));
    i.src = `${url}?img`;
  }));
  await tryIt("beacon", () => {
    if (!navigator.sendBeacon(`${url}?beacon`, "x")) throw new Error("refused");
    return "queued";
  });
  await tryIt("form", () => {
    const f = document.createElement("form");
    f.method = "POST";
    f.action = `${url}?form`;
    f.target = "_blank";
    document.body.append(f);
    f.submit();
    f.remove();
    return "sent";
  });
  await tryIt("worker", () => new Promise((ok, no) => {
    const w = new Worker(`${url}?worker`);
    w.onmessage = () => ok("message");
    w.onerror = (e) => {
      e.preventDefault?.();
      no(new Error("WorkerError"));
    };
  }));
  await tryIt("webRTC", () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] });
    pc.createDataChannel("x");
    return pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => "made");
  });
  await tryIt("childFrame", () => new Promise((ok) => {
    const f = document.createElement("iframe");
    const done = (e) => e.data === "child" && ok("message");
    addEventListener("message", done);
    f.srcdoc = "<script>parent.postMessage('child','*')</script>";
    document.body.append(f);
  }));
  await tryIt("indexedDB", () => new Promise((ok, no) => {
    const r = indexedDB.open("probe");
    r.onsuccess = () => ok("open");
    r.onerror = () => no(r.error || new Error("IDBError"));
  }));
  await tryIt("realLocalStorage", () => {
    const real = Object.getOwnPropertyDescriptor(Window.prototype, "localStorage")?.get?.call(window);
    if (!real) throw new Error("NoStorage");
    real.setItem("probe", "1");
    return real.getItem("probe");
  });
  await tryIt("cookie", () => {
    document.cookie = "probe=1";
    if (!document.cookie.includes("probe=1")) throw new Error("NoCookie");
    return document.cookie;
  });
  await tryIt("parentDom", () => parent.document.title);
  await tryIt("topDom", () => top.document.title);
  await tryIt("parentTauri", () => {
    const tauri = parent.__TAURI__ ?? parent.__TAURI_INTERNALS__;
    if (!tauri) throw new Error("NoTauri");
    return "tauri";
  });
  await tryIt("topNav", () => {
    top.location.href = `${url}?topnav`;
    return "navigated";
  });
  await tryIt("popup", () => {
    const w = window.open(`${url}?popup`);
    if (!w) throw new Error("NoPopup");
    return "opened";
  });
  await tryIt("tauriHere", () => {
    if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) throw new Error("NoTauri");
    return "tauri";
  });
  await tryIt("tauriIpc", () => {
    const ipc = window.ipc?.postMessage ?? window.chrome?.webview?.postMessage;
    if (typeof ipc !== "function") throw new Error("NoIpc");
    return "ipc";
  });
  try {
    localStorage.setItem("probe", "2");
    out.shimLocalStorage = localStorage.getItem("probe") === "2" ? "됨(메모리)" : "안 됨";
  } catch (e) {
    out.shimLocalStorage = `안 됨 ${e?.name ?? e}`;
  }
  out.origin = String(self.origin);
  return out;
}
