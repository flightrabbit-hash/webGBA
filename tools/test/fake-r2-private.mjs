// 흉내 비공개 R2(S3 호환, 시험 전용). 서명 4판(머리 서명·presigned 주소)을 tools/lib/r2.mjs 계산으로 다시 확인한다 —
// 서버 함수(api/_admin/r2.js)와 따로 짠 계산이라 서로 맞는지 보는 셈. 실제 R2 에는 닿지 않는다.
//   const r2 = await startFakeR2({ bucket, accessKey, secret });  r2.put(key, bytes) · r2.log · r2.endpoint
import crypto from "node:crypto";
import http from "node:http";
import { canonicalQuery, sha256Hex, signingKey, signRequest } from "../lib/r2.mjs";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function startFakeR2({ bucket = "private-test", accessKey = "AKTEST", secret = "secret-test", port = 0, cors = "*", skewMs = 0 } = {}) {
  const objects = new Map();
  const log = [];
  let delayMs = 0;
  let cut = false;
  let emptyPuts = false;

  function headerAuth(req, path, params) {
    const auth = /Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})/.exec(req.headers.authorization ?? "");
    if (!auth || auth[1] !== accessKey) return false;
    const signed = auth[3].split(";").filter((n) => !["host", "x-amz-content-sha256", "x-amz-date"].includes(n));
    const headers = Object.fromEntries(signed.map((n) => [n, req.headers[n] ?? ""]));
    const again = signRequest({ method: req.method, host: req.headers.host, path, query: canonicalQuery(params), headers, payloadHash: req.headers["x-amz-content-sha256"], accessKey, secret, amzDate: req.headers["x-amz-date"] });
    return again.signature === auth[4];
  }

  function presignAuth(req, rawPath, params) {
    const sig = params["X-Amz-Signature"];
    const rest = { ...params };
    delete rest["X-Amz-Signature"];
    const amzDate = rest["X-Amz-Date"] ?? "";
    const date = amzDate.slice(0, 8);
    if (rest["X-Amz-Credential"] !== `${accessKey}/${date}/auto/s3/aws4_request` || rest["X-Amz-SignedHeaders"] !== "host") return "cred";
    const canonical = ["GET", rawPath, canonicalQuery(rest), `host:${req.headers.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", amzDate, `${date}/auto/s3/aws4_request`, sha256Hex(canonical)].join("\n");
    const want = crypto.createHmac("sha256", signingKey(secret, date, "auto", "s3")).update(toSign).digest("hex");
    if (want !== sig) return "sig";
    const at = Date.UTC(+amzDate.slice(0, 4), +amzDate.slice(4, 6) - 1, +amzDate.slice(6, 8), +amzDate.slice(9, 11), +amzDate.slice(11, 13), +amzDate.slice(13, 15));
    if (Date.now() + skewMs > at + Number(rest["X-Amz-Expires"]) * 1000) return "expired";
    return "";
  }

  const server = http.createServer((req, res) => {
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, "http://x");
        const path = decodeURIComponent(url.pathname);
        const entry = { method: "PUT", path, kind: "put" };
        log.push(entry);
        const good = headerAuth(req, path, Object.fromEntries(url.searchParams)) && req.headers["x-amz-content-sha256"] === sha256Hex(body) && path.startsWith(`/${bucket}/`);
        entry.status = good ? 200 : 403;
        const kept = emptyPuts ? Buffer.alloc(0) : body;
        if (good) objects.set(path.slice(bucket.length + 2), { bytes: kept, etag: crypto.createHash("md5").update(kept).digest("hex") });
        res.writeHead(entry.status);
        res.end();
      });
      return;
    }
    const url = new URL(req.url, "http://x");
    const params = Object.fromEntries(url.searchParams);
    const rawPath = url.pathname;
    const path = decodeURIComponent(rawPath);
    const headers = { "Access-Control-Allow-Origin": cors, "Access-Control-Expose-Headers": "Content-Length, ETag" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }
    const presigned = "X-Amz-Signature" in params;
    const entry = { method: req.method, path, kind: presigned ? "presigned" : params["list-type"] ? "list" : "get", range: req.headers.range ?? "" };
    log.push(entry);
    const finish = (status, body = "", extra = {}) => {
      entry.status = status;
      res.writeHead(status, { ...headers, ...extra });
      res.end(body);
    };
    if (!path.startsWith(`/${bucket}`)) return finish(404, "<Error><Code>NoSuchBucket</Code></Error>");
    if (presigned) {
      const why = presignAuth(req, rawPath, params);
      if (why) return finish(403, `<Error><Code>${why}</Code></Error>`);
    } else if (!headerAuth(req, path, params)) return finish(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
    if (entry.kind === "list") {
      const prefix = params.prefix ?? "";
      const rows = [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${xml(k)}</Key><Size>${v.bytes.length}</Size><ETag>"${v.etag}"</ETag></Contents>`);
      return finish(200, `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${rows.join("")}</ListBucketResult>`, { "Content-Type": "application/xml" });
    }
    const key = path.slice(bucket.length + 2);
    const object = objects.get(key);
    if (!object) return finish(404, "<Error><Code>NoSuchKey</Code></Error>");
    let body = object.bytes;
    let status = 200;
    const range = /^bytes=(\d+)-(\d+)?$/.exec(req.headers.range ?? "");
    if (range) {
      const end = Math.min(body.length - 1, range[2] === undefined ? body.length - 1 : Number(range[2]));
      body = body.subarray(Number(range[1]), end + 1);
      status = 206;
    }
    entry.status = status;
    res.writeHead(status, { ...headers, "Content-Length": String(body.length), ETag: `"${object.etag}"`, "Content-Type": "application/octet-stream" });
    if (!presigned || (!delayMs && !cut)) {
      res.end(Buffer.from(body));
      return;
    }
    const half = Math.floor(body.length / 2);
    res.write(Buffer.from(body.subarray(0, half)));
    if (cut) {
      setTimeout(() => res.destroy(), 50);
      return;
    }
    setTimeout(() => res.end(Buffer.from(body.subarray(half))), delayMs);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return {
    endpoint,
    bucket,
    env: { CF_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_PRIVATE_BUCKET: bucket, R2_PRIVATE_ACCESS_KEY_ID: accessKey, R2_PRIVATE_SECRET_ACCESS_KEY: secret },
    log,
    put(key, bytes) {
      const data = Buffer.from(bytes);
      objects.set(key, { bytes: data, etag: crypto.createHash("md5").update(data).digest("hex") });
    },
    remove: (key) => objects.delete(key),
    read: (key) => objects.get(key)?.bytes ?? null,
    toolConfig: () => ({ account: "x", accessKey, secret, bucket, host: new URL(endpoint).host, origin: endpoint }),
    has: (key) => objects.has(key),
    slow: (ms) => (delayMs = ms),
    breakDownloads: (on) => (cut = on),
    emptyPuts: (on) => (emptyPuts = on),
    clear: () => (log.length = 0),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const keyFile = (pin, updated) => JSON.stringify({ sha256: crypto.createHash("sha256").update(pin, "utf8").digest("hex"), updated });
