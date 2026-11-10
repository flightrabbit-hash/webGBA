// 온라인 업데이트 시험용 흉내 R2(정적 파일 + CORS). 실제 R2 는 쓰지 않는다.
//   node tools/test/update-server.mjs <발행 폴더 묶음> [포트=9481]
// <발행 폴더 묶음>/<모드>/<게임 id>/latest.json · patches/ · full/ — 모드(기본 "ok")는 GET /__use?mode=<모드> 로 바꾼다
// (같은 주소에 다른 버전 파일: 서명 변조·SHA-1 다름 등). GET /__log = 받은 요청 목록(JSON), /__clear = 비움.
// GET /__delay?ms=<밀리초> = 파일 응답 첫 바이트를 늦춤(r2.dev 첫 바이트 1.3~4초 흉내, 기본 0).
// GET /__cut?bytes=<바이트> = 버전 파일·목록이 아닌 파일을 그 바이트만 보내고 연결을 끊음(내려받기 끊김 흉내, 0 = 끔).
// 응답 머리는 R2 공개 버킷과 같게: latest.json·index.json = Cache-Control no-cache, 그 밖 = 1년 immutable(ok 가 아닌 모드는 no-store). CORS 는 모든 출처 GET.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 9481);
let mode = "ok";
let log = [];
let delay = 0;
let cut = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD", "access-control-max-age": "86400" };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === "/__use") {
    mode = url.searchParams.get("mode") ?? "ok";
    res.writeHead(200, { ...cors, "content-type": "text/plain" });
    return res.end(mode);
  }
  if (url.pathname === "/__delay") {
    delay = Math.max(0, Number(url.searchParams.get("ms")) || 0);
    res.writeHead(200, { ...cors, "content-type": "text/plain" });
    return res.end(String(delay));
  }
  if (url.pathname === "/__cut") {
    cut = Math.max(0, Number(url.searchParams.get("bytes")) || 0);
    res.writeHead(200, { ...cors, "content-type": "text/plain" });
    return res.end(String(cut));
  }
  if (url.pathname === "/__log") {
    res.writeHead(200, { ...cors, "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(log));
  }
  if (url.pathname === "/__clear") {
    log = [];
    res.writeHead(200, cors);
    return res.end("ok");
  }
  log.push({ path: url.pathname, origin: req.headers.origin ?? "", cache: req.headers["cache-control"] ?? "", time: Date.now() });
  const file = path.join(root, mode, ...url.pathname.split("/").filter(Boolean).map(decodeURIComponent));
  if (!file.startsWith(path.join(root, mode)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, cors);
    return res.end("not found");
  }
  const body = fs.readFileSync(file);
  const feed = /(?:latest|index)\.json$/.test(file);
  setTimeout(() => {
    // ok 가 아닌 모드(손상 파일 등)는 같은 주소에 다른 내용이라 웹뷰 캐시에 남지 않게
    const cache = feed ? "no-cache" : mode === "ok" ? "public, max-age=31536000, immutable" : "no-store";
    res.writeHead(200, { ...cors, "content-type": feed ? "application/json" : "application/octet-stream", "content-length": body.length, "cache-control": cache });
    if (cut && !feed && req.method !== "HEAD" && body.length > cut) {
      res.write(body.subarray(0, cut), () => setTimeout(() => res.destroy(), 50));
      return;
    }
    res.end(req.method === "HEAD" ? undefined : body);
  }, delay);
});

server.listen(port, "127.0.0.1", () => console.log(`흉내 R2 http://127.0.0.1:${port}/ (${root})`));
