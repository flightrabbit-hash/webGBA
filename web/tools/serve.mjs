// 웹 빌드를 로컬에서 띄우기(시험용) — vercel.json 과 같은 머리(캐시·형식)로 정적 파일만 내준다.
//   node web/tools/serve.mjs [폴더=web/dist] [포트=8790]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? path.join(here, "..", "dist"));
const port = Number(process.argv[3] ?? 8790);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

const cacheOf = (rel) => {
  if (rel === "/sw.js" || rel === "/index.html") return "no-cache";
  if (rel.startsWith("/core/")) return "public, max-age=86400";
  return "public, max-age=0, must-revalidate";
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cacheOf(rel),
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/ ← ${dir}`));
