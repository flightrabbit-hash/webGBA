export class StoreError extends Error {
  constructor(code, detail = "") {
    super(detail || code);
    this.code = code;
  }
}

export function storeConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "";
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "";
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function makeStore({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const config = storeConfig(env);
  return {
    ready: Boolean(config),
    async run(commands) {
      if (!config) throw new StoreError("config");
      if (!commands.length) return [];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${config.url}/pipeline`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(commands.map((c) => c.map(String))),
          signal: ctrl.signal,
        });
      } catch {
        throw new StoreError("network");
      } finally {
        clearTimeout(timer);
      }
      let body = null;
      try {
        body = await response.json();
      } catch {}
      if (!response.ok || !Array.isArray(body)) throw new StoreError(/limit/i.test(String(body?.error ?? "")) ? "quota" : "http", String(response.status));
      return body.map((item) => {
        if (item && item.error) throw new StoreError(/limit/i.test(String(item.error)) ? "quota" : "command");
        return item ? item.result : null;
      });
    },
  };
}
