// 메모리 가짜 Upstash Redis REST(시험용). POST /pipeline 과 POST / 만, 서버 함수가 쓰는 명령만 흉내 낸다.
//   const fake = await startFakeUpstash();  env = { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token }
//   fake.advance(ms) 로 시계를 앞당겨 TTL 만료를 보고, fake.fail("quota") 로 한도 초과 오류를 낸다. fake.stats() = 명령 수.
import http from "node:http";

export async function startFakeUpstash({ token = "fake-token" } = {}) {
  const data = new Map();
  let skew = 0;
  let failing = "";
  const counts = new Map();
  let total = 0;
  const log = [];
  const now = () => Date.now() + skew;

  const alive = (key) => {
    const e = data.get(key);
    if (!e) return null;
    if (e.until && e.until <= now()) {
      data.delete(key);
      return null;
    }
    return e;
  };

  function run(cmd) {
    const [name, ...args] = cmd.map(String);
    const op = name.toUpperCase();
    total++;
    counts.set(op, (counts.get(op) ?? 0) + 1);
    log.push([op, ...args.slice(0, 1)]);
    if (failing === "quota") return { error: "ERR max requests limit exceeded. Limit: 500000, Usage: 500000" };
    if (op === "GET") return { result: alive(args[0])?.value ?? null };
    if (op === "MGET") return { result: args.map((k) => alive(k)?.value ?? null) };
    if (op === "SET") {
      const [key, value, ...opts] = args;
      let ex = 0;
      let nx = false;
      let xx = false;
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i].toUpperCase();
        if (o === "EX") ex = Number(opts[++i]);
        else if (o === "NX") nx = true;
        else if (o === "XX") xx = true;
        else return { error: `ERR syntax ${o}` };
      }
      const has = Boolean(alive(key));
      if ((nx && has) || (xx && !has)) return { result: null };
      data.set(key, { value, until: ex ? now() + ex * 1000 : 0 });
      return { result: "OK" };
    }
    if (op === "INCR") {
      const e = alive(args[0]);
      const n = (e ? Number(e.value) : 0) + 1;
      data.set(args[0], { value: String(n), until: e?.until ?? 0 });
      return { result: n };
    }
    if (op === "EXPIRE") {
      const e = alive(args[0]);
      if (!e) return { result: 0 };
      e.until = now() + Number(args[1]) * 1000;
      return { result: 1 };
    }
    return { error: `ERR unknown command ${op}` };
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status, value) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized" });
      if (failing === "down") return send(500, { error: "down" });
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(400, { error: "ERR bad json" });
      }
      if (req.url === "/pipeline") return send(200, parsed.map(run));
      if (req.url === "/" && Array.isArray(parsed)) return send(200, run(parsed));
      send(404, { error: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    token,
    advance: (ms) => (skew += ms),
    fail: (mode = "") => (failing = mode),
    stats: () => ({ total, byName: Object.fromEntries(counts), log: log.slice() }),
    reset: () => {
      total = 0;
      counts.clear();
      log.length = 0;
    },
    dump: () => [...data.entries()].filter(([k]) => alive(k)).map(([k, e]) => [k, e.value, e.until ? Math.round((e.until - now()) / 1000) : -1]),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
