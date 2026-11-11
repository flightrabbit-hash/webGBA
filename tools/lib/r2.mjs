// Cloudflare R2(S3 호환 API) 올리기 — wgba.mjs upload 가 씀. 바깥 의존성 없음(AWS 서명 4판을 node crypto 로 직접).
// 계정·키는 환경 변수 R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET 에서만 읽고, 값을 출력·기록하지 않는다.
import crypto from "crypto";

export const R2_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

const hmac = (key, text) => crypto.createHmac("sha256", key).update(text).digest();
export const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const encodeSegment = (part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** 서명 열쇠(날짜·지역·서비스). */
export function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

/**
 * 요청 서명 → 붙일 머리(Authorization 포함). headers 는 소문자 이름, body 해시는 payloadHash(빈 몸통이면 빈 글의 SHA-256).
 * 시험 벡터(AWS S3 문서 "GET Object" 예)와 같은 계산.
 */
export function signRequest({ method, host, path, query = "", headers = {}, payloadHash, accessKey, secret, region = "auto", service = "s3", amzDate }) {
  const date = amzDate.slice(0, 8);
  const all = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalUri = path.split("/").map(encodeSegment).join("/");
  const canonical = [method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signature = hmac(signingKey(secret, date, region, service), toSign).toString("hex");
  return {
    headers: { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    canonical,
    signature,
  };
}

export function r2Config(env = process.env) {
  const missing = R2_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`환경 변수가 없습니다: ${missing.join(", ")} (값은 R2_설정안내의 "환경 변수 등록"대로 넣습니다)`);
  return { account: env.R2_ACCOUNT_ID, accessKey: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET, host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` };
}

const amzNow = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** 서명에 넣는 질의 글: 이름순, 이름·값 모두 RFC 3986 인코딩. */
export function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((name) => `${encodeSegment(name)}=${encodeSegment(String(params[name]))}`)
    .join("&");
}

// config.fetch·config.origin 은 시험(흉내 S3 서버)에서만 준다
async function call(config, method, key, { body = null, headers = {}, params = null } = {}) {
  const path = key === null ? `/${config.bucket}` : `/${config.bucket}/${key}`;
  const query = params ? canonicalQuery(params) : "";
  const payloadHash = sha256Hex(body ?? "");
  const signed = signRequest({ method, host: config.host, path, query, headers, payloadHash, accessKey: config.accessKey, secret: config.secret, amzDate: amzNow() });
  const { host, ...send } = signed.headers;
  const response = await (config.fetch ?? fetch)(`${config.origin ?? `https://${host}`}${path.split("/").map(encodeSegment).join("/")}${query ? `?${query}` : ""}`, { method, headers: send, body });
  return response;
}

const unescapeXml = (text) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const tagOf = (xml, name) => {
  const hit = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return hit ? unescapeXml(hit[1]) : null;
};

/**
 * 버킷 객체 목록(ListObjectsV2) → { objects: Map(키 → { size, etag }), requests }. 요청 1번에 1,000개까지(Class A 1회) —
 * 파일마다 HEAD(Class B 1회씩)를 보내지 않으려고.
 */
export async function r2List(config, { prefix = "", pageMax = 100 } = {}) {
  const objects = new Map();
  let token = "";
  let requests = 0;
  for (let page = 0; page < pageMax; page++) {
    const params = { "list-type": "2", "max-keys": "1000", ...(prefix ? { prefix } : {}), ...(token ? { "continuation-token": token } : {}) };
    const response = await call(config, "GET", null, { params });
    requests++;
    const xml = await response.text();
    if (!response.ok) throw new Error(`목록 조회 HTTP ${response.status} ${(tagOf(xml, "Code") ?? "").slice(0, 80)}`);
    for (const [, body] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = tagOf(body, "Key");
      if (key !== null) objects.set(key, { size: Number(tagOf(body, "Size")), etag: (tagOf(body, "ETag") ?? "").replace(/"/g, "").toLowerCase() });
    }
    if (tagOf(xml, "IsTruncated") !== "true") return { objects, requests };
    token = tagOf(xml, "NextContinuationToken") ?? "";
    if (!token) throw new Error("목록 조회: 다음 쪽 표시(NextContinuationToken)가 없습니다");
  }
  throw new Error(`목록 조회: ${pageMax}쪽을 넘었습니다`);
}

/** 버킷 객체의 크기·ETag(따옴표 뺌 — 한 번에 올린 객체는 내용 MD5). 없으면 null(HEAD). */
export async function r2Head(config, key) {
  const response = await call(config, "HEAD", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HEAD ${key}: HTTP ${response.status}`);
  return { size: Number(response.headers.get("content-length")), etag: (response.headers.get("etag") ?? "").replace(/"/g, "").toLowerCase() };
}

/** 버킷 객체 내용(GET, range = "bytes=0-131071" 식). 없으면 null. */
export async function r2Get(config, key, { range = "" } = {}) {
  const response = await call(config, "GET", key, { headers: range ? { range } : {} });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${key}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** 버킷 객체 삭제(DELETE, 없는 키도 204). */
export async function r2Delete(config, key) {
  const response = await call(config, "DELETE", key);
  if (!response.ok) throw new Error(`DELETE ${key}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
}

export async function r2Put(config, key, bytes, { contentType, cacheControl }) {
  const response = await call(config, "PUT", key, { body: bytes, headers: { "content-type": contentType, "cache-control": cacheControl } });
  if (!response.ok) throw new Error(`PUT ${key}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
}
