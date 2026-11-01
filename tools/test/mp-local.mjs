// 시험용 로컬 서버: web/dist 정적 파일 + 짝 찾기 서버 함수(/api/v1/mp/*, 메모리 가짜 Upstash).
//   const local = await startLocal({ dist });  local.base = "http://127.0.0.1:<포트>/"
//   공인 IP 흉내: 요청 머리 x-test-ip(페이지가 보냄) 또는 기본 203.0.113.1. local.fake = 가짜 Upstash(명령 수·TTL·오류).
//   node tools/test/mp-local.mjs [포트=8791] 로 띄우면 손으로 확인할 수 있다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../api/_mp/server.js";
import { startFakeUpstash } from "./fake-upstash.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

export async function startLocal({ dist = path.join(here, "..", "..", "web", "dist"), port = 0, ip = "203.0.113.1" } = {}) {
  const fake = await startFakeUpstash();
  let api = createServer({ env: { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token } });
  const apiCalls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.set("x-forwarded-for", req.headers["x-test-ip"] || ip);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "OPTIONS" ? undefined : body });
      const response = await api.handle(request);
      apiCalls.push({ method: req.method, op: url.pathname.split("/").pop(), status: response.status });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.join(dist, path.normalize(rel).replace(/^([/\\])+/, ""));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}/`,
    fake,
    apiCalls,
    reset: () => {
      api = createServer({ env: { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token } });
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await fake.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = await startLocal({ port: Number(process.argv[2] ?? 8791) });
  console.log(`${local.base} (가짜 Upstash ${local.fake.url})`);
}
