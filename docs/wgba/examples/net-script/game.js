// net-script: a tiny runtime "script" multiplayer example for .wgba.
// The game JS runs in webGBA's isolated frame and cannot open any network by itself;
// it only uses webgba.net (spec 7.4). Same rules as the net-webapi example:
//   A ask for players · START (host) start a round · SELECT stop multiplayer
// Every player sends small commands with send("ordered"), folds them into one hash in the
// order webGBA delivers them, and prints "net <json>" lines with webgba.log for tests.
// Player status board (spec 7.9, scope "self"): each player gives only its own row with
// webgba.net.board(); webGBA collects the rows of everyone and sorts them by "sent".

const ROUND = 360;
const T_START = 1;
const T_CMD = 2;
const T_FIN = 3;
const T_END = 4;

export default async function start(webgba) {
  const canvas = webgba.canvas;
  const ctx = canvas.getContext("2d");
  const net = webgba.net;
  const st = { slot: -1, count: 0, open: false, closed: 0, started: false, ended: false, frame: 0, hash: 0x811c9dc5, applied: 0, sent: 0, fins: new Set(), rng: 1, wanting: false, events: [] };
  const queue = [];
  const fold = (x) => {
    for (let i = 0; i < 4; i++) st.hash = Math.imul(st.hash ^ ((x >>> (i * 8)) & 255), 0x01000193) >>> 0;
  };
  const report = () => webgba.log("info", `net ${JSON.stringify({ slot: st.slot, count: st.count, open: st.open, closed: st.closed, started: st.started, ended: st.ended, hash: st.hash.toString(16), applied: st.applied, sent: st.sent, host: Boolean(net?.host), events: st.events.slice(-12) })}`);
  const msg = (type, value) => {
    const m = new Uint8Array(8);
    m[0] = type;
    m[1] = st.slot;
    new DataView(m.buffer).setUint32(4, value >>> 0, true);
    return m;
  };
  const apply = (from, b) => {
    const type = b[0];
    const value = new DataView(b.buffer, b.byteOffset, 8).getUint32(4, true);
    if (type === T_START) Object.assign(st, { started: true, ended: false, frame: 0, hash: 0x811c9dc5, applied: 0, sent: 0, rng: 1, fins: new Set() });
    if (!st.started || st.ended) return;
    fold(type | (b[1] << 8) | (from << 16));
    fold(value);
    st.applied++;
    if (type === T_FIN) {
      st.fins.add(b[1]);
      if (st.slot === 0 && st.fins.size >= st.count) net.send("ordered", msg(T_END, st.applied));
    }
    if (type === T_END) {
      st.ended = true;
      report();
    }
  };

  if (net) {
    net.onevent = (kind, a, b) => {
      st.events.push(`${kind}:${a}:${b}`);
      if (kind === 1) Object.assign(st, { open: true, slot: a, count: b, closed: 0 });
      else if (kind === 2) st.count = b;
      else if (kind === 3) st.count = Math.max(1, st.count - 1);
      else if (kind === 4) Object.assign(st, { open: false, closed: a, wanting: false, started: false });
      report();
    };
    net.onrecv = (from, bytes) => queue.push([from, bytes]);
  }

  webgba.on("button", ({ id, down }) => {
    if (!down || !net) return;
    if (id === "A" && !st.wanting) {
      st.wanting = true;
      net.want({ purpose: "party", min: 2, max: 4 });
    } else if (id === "SELECT" && st.wanting) {
      st.wanting = false;
      net.unwant();
    } else if (id === "START" && st.open && st.slot === 0 && st.count >= 2 && !st.started) {
      net.send("ordered", msg(T_START, st.count));
    }
  });

  let boardWait = 0;
  let boardLast = "";
  const board = () => {
    if (!net?.board || !st.open || ++boardWait < 15) return;
    boardWait = 0;
    const values = [st.sent, st.frame, st.started ? (st.ended ? 1 : 0) : 2];
    const key = values.join(",");
    if (key === boardLast) return;
    boardLast = key;
    net.board({ rows: [{ values }] });
  };

  const frame = () => {
    while (queue.length) apply(...queue.shift());
    board();
    if (st.started && !st.ended && st.open) {
      st.frame++;
      if (st.frame <= ROUND) {
        st.rng = (Math.imul(st.rng, 1103515245) + 12345 + st.slot * 7919) >>> 0;
        if ((st.rng >>> 16) % 10 < 3) net.send("ordered", msg(T_CMD, st.sent++));
        if (st.frame === ROUND) net.send("ordered", msg(T_FIN, st.sent));
      }
    }
    ctx.fillStyle = st.ended ? `#${(st.hash & 0xffffff).toString(16).padStart(6, "0")}` : st.started ? "#3c285a" : st.open ? "#1e5a3c" : st.wanting ? "#243c6e" : "#282c34";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let s = 0; s < 8; s++) {
      ctx.fillStyle = s === st.slot ? "#ffd23c" : s < st.count ? "#dcdcdc" : "#464646";
      ctx.fillRect(8 + s * 28, 8, 22, 22);
    }
    if (st.started) {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(8, 40, (224 * Math.min(st.frame, ROUND)) / ROUND, 8);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  report();
  webgba.ready();
}
