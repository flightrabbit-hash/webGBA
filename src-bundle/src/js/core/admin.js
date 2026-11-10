export const ADMIN_PATH = "/api/v1/admin/";
export const ADMIN_APP_API = "https://webgba.vercel.app/api/v1/admin/";
export const PIN_LENGTH = 6;
export const PIN_KEYS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9", "!", "0", "#"]);
export const OFF_CODES = new Set(["wrong", "limit", "locked"]);

export class AdminError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    this.extra = extra;
  }
}

export function adminClient({ base, fetchImpl = (...a) => fetch(...a), timeoutMs = 20000 }) {
  async function call(method, op, { token = "", body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(new URL(op, base).href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, cache: "no-store", credentials: "omit" });
    } catch {
      throw new AdminError("network");
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {}
    if (!response.ok) {
      const { error, ...extra } = data && typeof data === "object" ? data : {};
      throw new AdminError(typeof error === "string" ? error : "http", { ...extra, status: response.status });
    }
    return data ?? {};
  }
  return {
    verify: (pin) => call("POST", "verify", { body: { pin } }),
    list: (token) => call("GET", "list", { token }),
    urls: (token, keys) => call("POST", "url", { token, body: { keys } }),
  };
}

/** 저장 값 → { token, at, until, updated } 또는 null(형식이 다름). 기간이 지난 토큰도 그대로 — 서버 401 again 으로 다시 입력. 6자리는 저장하지 않는다. */
export function readRecord(value) {
  if (!value || typeof value !== "object") return null;
  const { token, at, until, updated } = value;
  if (typeof token !== "string" || !/^a1\.[0-9a-z]{1,12}\.[0-9a-z]{1,12}\.[A-Za-z0-9_-]{32}$/.test(token) || !Number.isFinite(at) || !Number.isFinite(until)) return null;
  return { token, at, until, updated: typeof updated === "string" ? updated : "" };
}

export const recordOf = (got) => ({ token: got.token, at: got.at, until: got.until, updated: got.updated ?? "" });

/** 받은 크기만큼 진행률을 알리며 받는다(웹). */
export async function downloadBytes(url, { size = 0, onProgress = () => {}, fetchImpl = (...a) => fetch(...a) } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { cache: "no-store", credentials: "omit" });
  } catch {
    throw new AdminError("network");
  }
  if (!response.ok) throw new AdminError("http", { status: response.status });
  const total = size || Number(response.headers.get("content-length")) || 0;
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress(1);
    return bytes;
  }
  const reader = response.body.getReader();
  const parts = [];
  let done = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch {
      throw new AdminError("network");
    }
    if (step.done) break;
    parts.push(step.value);
    done += step.value.length;
    if (total) onProgress(Math.min(0.99, done / total));
  }
  if (size && done !== size) throw new AdminError("size");
  const bytes = new Uint8Array(done);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  onProgress(1);
  return bytes;
}
