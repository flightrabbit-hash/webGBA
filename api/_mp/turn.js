export const TURN_CAP = Object.freeze({ gb: 900, days: 31 });

export const TURN = Object.freeze({
  TTL: 3600,
  RATE_MAX: 30,
  RATE_TTL: 3700,
  MARK_TTL: 7200,
  USAGE_TTL: 300,
  USAGE_FAIL_TTL: 60,
  TIMEOUT_MS: 4000,
  URLS_MAX: 2,
});

export const TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys/";
export const GRAPHQL_API = "https://api.cloudflare.com/client/v4/graphql";
const USAGE_KEY = "tu";
const URL_RE = /^(turn|turns):([a-z0-9.-]+|\[[0-9a-f:.]+\])(:(\d{1,5}))?(\?transport=(udp|tcp))?$/i;

export class RelayError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function relayConfig(env = process.env) {
  const keyId = String(env.TURN_KEY_ID ?? "");
  const keyToken = String(env.TURN_KEY_API_TOKEN ?? "");
  const account = String(env.CF_ACCOUNT_ID ?? "");
  const analytics = String(env.CF_ANALYTICS_API_TOKEN ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(keyId) || !keyToken || !/^[A-Za-z0-9]{1,64}$/.test(account) || !analytics) return null;
  return { keyId, keyToken, account, analytics };
}

export function pickUrls(urls) {
  const list = (Array.isArray(urls) ? urls : typeof urls === "string" ? [urls] : []).filter((u) => typeof u === "string" && u.length <= 256 && URL_RE.test(u) && URL_RE.exec(u)[4] !== "53");
  const udp = list.find((u) => /^turn:/i.test(u) && !/transport=tcp/i.test(u));
  const tls = list.find((u) => /^turns:/i.test(u) && URL_RE.exec(u)[4] === "443") ?? list.find((u) => /^turns:/i.test(u));
  const picked = [udp, tls].filter(Boolean);
  return (picked.length ? picked : list).slice(0, TURN.URLS_MAX);
}

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function usageQuery(nowMs, days = TURN_CAP.days) {
  const nodes = [];
  for (let i = 0; i < days; i++) {
    const d = day(nowMs - i * 86400000);
    nodes.push(`d${i}: callsTurnUsageAdaptiveGroups(limit: 1, filter: { date_geq: "${d}", date_leq: "${d}" }) { sum { egressBytes } }`);
  }
  return `query ($a: string) { viewer { accounts(filter: { accountTag: $a }) { ${nodes.join(" ")} } } }`;
}

export function usageSum(body, days = TURN_CAP.days) {
  if (!body || typeof body !== "object" || (Array.isArray(body.errors) && body.errors.length)) throw new RelayError("usage");
  const account = body.data?.viewer?.accounts?.[0];
  if (!account || typeof account !== "object") throw new RelayError("usage");
  let total = 0;
  for (let i = 0; i < days; i++) {
    const rows = account[`d${i}`];
    if (!Array.isArray(rows)) throw new RelayError("usage");
    for (const row of rows) {
      const n = Number(row?.sum?.egressBytes ?? 0);
      if (!Number.isFinite(n) || n < 0) throw new RelayError("usage");
      total += n;
    }
  }
  return total;
}

async function timed(fetchImpl, url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function makeRelay({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), db, ttl = TURN.TTL } = {}) {
  const config = relayConfig(env);
  let memo = null;
  let job = null;

  async function readUsage() {
    let response;
    try {
      response = await timed(fetchImpl, GRAPHQL_API, { method: "POST", headers: { Authorization: `Bearer ${config.analytics}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: usageQuery(now()), variables: { a: config.account } }) }, TURN.TIMEOUT_MS);
    } catch {
      throw new RelayError("usage");
    }
    let body = null;
    try {
      body = await response.json();
    } catch {}
    if (!response.ok) throw new RelayError("usage");
    return usageSum(body);
  }

  async function usage() {
    const at = now();
    if (memo && memo.until > at) return memo;
    const [cached] = await db.run([["GET", USAGE_KEY]]);
    try {
      const v = cached ? JSON.parse(cached) : null;
      if (v && (Number.isFinite(v.b) || v.f === 1)) {
        memo = { bytes: v.f === 1 ? null : v.b, until: at + (v.f === 1 ? TURN.USAGE_FAIL_TTL : TURN.USAGE_TTL) * 1000 };
        return memo;
      }
    } catch {}
    let bytes = null;
    try {
      bytes = await readUsage();
    } catch {}
    const keep = bytes === null ? TURN.USAGE_FAIL_TTL : TURN.USAGE_TTL;
    await db.run([["SET", USAGE_KEY, JSON.stringify(bytes === null ? { f: 1 } : { b: bytes }), "EX", keep]]);
    memo = { bytes, until: now() + keep * 1000 };
    return memo;
  }

  async function checkCap() {
    job ??= usage().finally(() => (job = null));
    const got = await job;
    if (got.bytes === null) throw new RelayError("usage");
    if (got.bytes >= TURN_CAP.gb * 1e9) throw new RelayError("cap");
  }

  async function generate() {
    let response;
    try {
      response = await timed(fetchImpl, `${TURN_API}${config.keyId}/credentials/generate-ice-servers`, { method: "POST", headers: { Authorization: `Bearer ${config.keyToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl }) }, TURN.TIMEOUT_MS);
    } catch {
      throw new RelayError("turn");
    }
    let body = null;
    try {
      body = await response.json();
    } catch {}
    if (!response.ok || !body) throw new RelayError("turn");
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const entry = list.find((s) => s && typeof s.username === "string" && s.username && typeof s.credential === "string" && s.credential);
    const urls = entry ? pickUrls(entry.urls) : [];
    if (!urls.length || entry.username.length > 512 || entry.credential.length > 512) throw new RelayError("turn");
    return { urls, username: entry.username, credential: entry.credential, ttl };
  }

  return {
    ready: Boolean(config),
    async issue() {
      if (!config) throw new RelayError("off");
      await checkCap();
      return generate();
    },
  };
}
