// hello-wapk: a stand-in Android core for .wapk (spec chapter 14, runtime "script", no network).
// It draws what the host sends to an Android core: touches (webgba.on("touch") — game pixels, pointer ids),
// the view (webgba.on("resize") / webgba.view), the Back · Menu buttons (roles back · menu) and pause / resume.
// With mobile.orientation "any" the canvas follows the view (short side kept), the way a real core would
// resize its surface so the host shows it without black bars.
//
// Every step prints one line with webgba.log(<tag>, <text>), so tests can read what happened:
//   touch <action> <id> <x> <y> <count> · view <w>x<h> <orientation> <canvas w>x<h> · button <id> down|up · event pause|resume
// Moves are not printed (too many); the frame keeps the last 64 events in globalThis.__wapk.events.

export default async function start(webgba) {
  const canvas = webgba.canvas;
  const ctx = canvas.getContext("2d");
  const base = { w: webgba.manifest.screen?.width ?? 800, h: webgba.manifest.screen?.height ?? 480 };
  const follow = webgba.manifest.mobile?.orientation === "any";
  const short = Math.min(base.w, base.h);
  const events = [];
  const trail = [];
  let touches = [];
  let view = webgba.view;
  let paused = false;
  globalThis.__wapk = { events };

  const note = (tag, text, quiet = false) => {
    events.push(`${tag} ${text}`);
    if (events.length > 64) events.shift();
    if (!quiet) webgba.log(tag, text);
  };

  const fit = (v) => {
    if (!follow || !v.width || !v.height) return;
    const long = Math.min(4096, Math.round((short * Math.max(v.width, v.height)) / Math.min(v.width, v.height)));
    const [w, h] = v.width >= v.height ? [long, short] : [short, long];
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  webgba.on("resize", (v) => {
    view = v;
    fit(v);
    note("view", `${v.width}x${v.height} ${v.orientation} ${canvas.width}x${canvas.height}`);
  });

  webgba.on("touch", (e) => {
    touches = e.action === "up" || e.action === "cancel" ? e.touches.filter((t) => e.action === "up" && t.id !== e.id) : e.touches;
    if (e.action !== "cancel") trail.push({ x: e.x, y: e.y, id: e.id });
    if (trail.length > 48) trail.shift();
    note("touch", `${e.action} ${e.id} ${e.x.toFixed(1)} ${e.y.toFixed(1)} ${e.touches.length}`, e.action === "move");
  });

  const held = webgba.input.held;
  webgba.on("button", ({ id, down }) => note("button", `${id} ${down ? "down" : "up"}`));
  webgba.on("pause", () => {
    paused = true;
    note("event", "pause");
  });
  webgba.on("resume", () => {
    paused = false;
    note("event", "resume");
  });

  const COLORS = ["#ff5c5c", "#3fd48a", "#6c93ff", "#f2b33d", "#c77dff", "#4dd0e1", "#ff8a65", "#aed581", "#f06292", "#90a4ae"];

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#101828";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#24324f";
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = "#6c93ff";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    for (const p of trail) {
      ctx.fillStyle = COLORS[p.id % COLORS.length];
      ctx.globalAlpha = 0.35;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 22px monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const t of touches) {
      ctx.fillStyle = COLORS[t.id % COLORS.length];
      ctx.beginPath();
      ctx.arc(t.x, t.y, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillText(String(t.id), t.x, t.y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#eef1f8";
    ctx.font = "20px monospace";
    const lines = [
      `canvas ${w}x${h} · view ${view.width}x${view.height} ${view.orientation} · dpr ${view.dpr}`,
      `touches ${touches.map((t) => `${t.id}(${t.x.toFixed(0)},${t.y.toFixed(0)})`).join(" ") || "-"}`,
      `buttons ${[...held].join(" ") || "-"}${paused ? " · paused" : ""}`,
      ...events.filter((line) => !line.startsWith("touch move")).slice(-4),
    ];
    lines.forEach((line, i) => ctx.fillText(line, 16, 16 + i * 26));
    requestAnimationFrame(draw);
  }

  fit(view);
  requestAnimationFrame(draw);
  webgba.ready();
}
