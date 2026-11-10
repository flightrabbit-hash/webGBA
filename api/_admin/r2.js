import { createHash, createHmac } from "node:crypto";

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const encodeSegment = (part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (path) => path.split("/").map(encodeSegment).join("/");
const EMPTY_HASH = sha256Hex("");

export const amzDateOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

export function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((name) => `${encodeSegment(name)}=${encodeSegment(String(params[name]))}`)
    .join("&");
}

function signingKey(secret, date) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), "auto"), "s3"), "aws4_request");
}

function signature(config, amzDate, canonical) {
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  return { scope, value: hmac(signingKey(config.secret, date), toSign).toString("hex") };
}

const objectPath = (config, key) => (key === null ? `/${config.bucket}` : `/${config.bucket}/${key}`);

export function signedHeaders(config, { method = "GET", key = null, params = null, range = "", amzDate }) {
  const path = objectPath(config, key);
  const query = params ? canonicalQuery(params) : "";
  const headers = { host: config.host, "x-amz-content-sha256": EMPTY_HASH, "x-amz-date": amzDate };
  if (range) headers.range = range;
  const names = Object.keys(headers).sort();
  const canonical = [method, encodePath(path), query, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), EMPTY_HASH].join("\n");
  const { scope, value } = signature(config, amzDate, canonical);
  const { host, ...send } = headers;
  send.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${value}`;
  return { url: `${config.origin}${encodePath(path)}${query ? `?${query}` : ""}`, headers: send };
}

export function presignGet(config, key, { amzDate, expires }) {
  const path = objectPath(config, key);
  const date = amzDate.slice(0, 8);
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKey}/${date}/auto/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const query = canonicalQuery(params);
  const canonical = ["GET", encodePath(path), query, `host:${config.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const { value } = signature(config, amzDate, canonical);
  return `${config.origin}${encodePath(path)}?${query}&X-Amz-Signature=${value}`;
}

export class R2Error extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const unescapeXml = (text) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const tagOf = (xml, name) => {
  const hit = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return hit ? unescapeXml(hit[1]) : null;
};

export function makeR2(config, { fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 8000 } = {}) {
  async function send(options) {
    const { url, headers } = signedHeaders(config, { ...options, amzDate: amzDateOf(now()) });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { method: options.method ?? "GET", headers, signal: ctrl.signal });
    } catch {
      throw new R2Error("network");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async get(key, { range = "", max = 0 } = {}) {
      const response = await send({ key, range });
      if (response.status === 404) return null;
      if (!response.ok) throw new R2Error("http", response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (max && bytes.length > max) throw new R2Error("size");
      return { bytes, etag: (response.headers.get("etag") ?? "").replace(/"/g, "") };
    },
    async list(prefix, { pageMax = 10 } = {}) {
      const objects = new Map();
      let token = "";
      for (let page = 0; page < pageMax; page++) {
        const params = { "list-type": "2", "max-keys": "1000", prefix, ...(token ? { "continuation-token": token } : {}) };
        const response = await send({ params });
        const xml = await response.text();
        if (!response.ok) throw new R2Error("http", response.status);
        for (const [, body] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = tagOf(body, "Key");
          if (key !== null) objects.set(key, { size: Number(tagOf(body, "Size")), etag: (tagOf(body, "ETag") ?? "").replace(/"/g, "") });
        }
        if (tagOf(xml, "IsTruncated") !== "true") return objects;
        token = tagOf(xml, "NextContinuationToken") ?? "";
        if (!token) break;
      }
      return objects;
    },
    presign: (key, expires) => presignGet(config, key, { amzDate: amzDateOf(now()), expires }),
  };
}
