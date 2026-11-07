// R2 요청 수 조회 — wgba.mjs r2-stats. Cloudflare GraphQL 분석 API(r2OperationsAdaptiveGroups)를 읽기만 한다(버킷 요청 0번).
// 환경 변수 CF_API_TOKEN(Account Analytics 읽기 권한 API 토큰) · R2_ACCOUNT_ID · R2_BUCKET(없으면 계정 전체)에서만 읽고 값을 출력·기록하지 않는다.
// 대시보드 R2 → 버킷 → Metrics 는 Class A·B 합계만 보여 주므로, 어느 객체를 누가 읽는지는 이 조회(객체·동작·응답 코드별)로 본다.
export const GRAPHQL_API = "https://api.cloudflare.com/client/v4/graphql";
export const STATS_ENV = ["CF_API_TOKEN", "R2_ACCOUNT_ID"];
const CLASS_A = new Set(["ListBuckets", "PutBucket", "ListObjects", "ListObjectsV2", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration"]);
const CLASS_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
const DAY = 86400000;
const KST = 9 * 3600000;

export const classOf = (action) => (CLASS_A.has(action) ? "A" : CLASS_B.has(action) ? "B" : "기타");

/** 요청 한 묶음의 출처 추정(객체 이름·동작·응답 코드로). */
export function sourceOf({ actionType: action, objectName: object = "", responseStatusCode: status = 0 }) {
  if (classOf(action) === "A") return "쓰기·목록(배포 도구·대시보드)";
  if (action === "HeadObject") return "HEAD(업로드 도구 0.8.1 upload·대시보드)";
  if (action !== "GetObject") return "그 외 동작";
  if (status === 404 || !object) return "없는 객체(외부 요청 의심)";
  if (object === "index.json") return "목록 index.json(webGBA 0.8.1 이상)";
  if (/^[^/]+\/latest\.json$/.test(object)) return "게임별 latest.json(webGBA 0.8.0 이하·목록 실패 시)";
  if (/^[^/]+\/(patches|full)\//.test(object)) return "패치·전체 설치 받기";
  return "그 외 객체(외부 요청 의심)";
}

/** 한국 날짜 하루씩(오늘 포함 days 일, since·until 이 있으면 그 사이) → [{ label, from, to }] (UTC ISO). */
export function dayWindows({ days = 7, since = null, until = null, now = Date.now() }) {
  const end = until ? Date.parse(until) : now;
  const start = since ? Date.parse(since) : Math.floor((end + KST) / DAY) * DAY - KST - (days - 1) * DAY;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("기간이 올바르지 않습니다(--since·--until 은 ISO 시각)");
  if (end - start > 31 * DAY) throw new Error("기간은 31일까지입니다(분석 API 한도)");
  const out = [];
  for (let at = start; at < end; ) {
    const next = Math.min(end, Math.floor((at + KST) / DAY) * DAY - KST + DAY);
    out.push({ label: new Date(at + KST).toISOString().slice(0, 10), from: new Date(at).toISOString(), to: new Date(next - 1000).toISOString() });
    at = next;
  }
  return out;
}

export function statsQuery(windows, withBucket) {
  const nodes = windows.map((w, i) => `d${i}: r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: "${w.from}", datetime_leq: "${w.to}"${withBucket ? ", bucketName: $b" : ""} }) { sum { requests } dimensions { actionType objectName responseStatusCode } }`);
  return `query (${["$a: string", ...(withBucket ? ["$b: string"] : [])].join(", ")}) { viewer { accounts(filter: { accountTag: $a }) { ${nodes.join(" ")} } } }`;
}

const n = (v) => v.toLocaleString("en-US");
const pad = (text, width) => String(text).padStart(width);

export async function r2Stats({ days = null, since = null, until = null, top = 30, env = process.env, fetchImpl = fetch, now = Date.now(), print = console.log } = {}) {
  const missing = STATS_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`환경 변수가 없습니다: ${missing.join(", ")} — CF_API_TOKEN 은 Cloudflare 대시보드 → My Profile → API Tokens 에서 "Account Analytics: Read" 권한으로 만듭니다`);
  const windows = dayWindows({ days: days ?? 7, since, until, now });
  const withBucket = Boolean(env.R2_BUCKET);
  const response = await fetchImpl(GRAPHQL_API, { method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: statsQuery(windows, withBucket), variables: { a: env.R2_ACCOUNT_ID, ...(withBucket ? { b: env.R2_BUCKET } : {}) } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.errors?.length) throw new Error(`분석 API: HTTP ${response.status} ${(body?.errors ?? []).map((e) => e.message).join(" / ").slice(0, 300)}`);
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("분석 API: 계정 결과가 없습니다(R2_ACCOUNT_ID·토큰 권한 확인)");
  const total = new Map();
  const daily = [];
  const SOURCES = ["목록 index.json(webGBA 0.8.1 이상)", "게임별 latest.json(webGBA 0.8.0 이하·목록 실패 시)", "패치·전체 설치 받기", "HEAD(업로드 도구 0.8.1 upload·대시보드)", "없는 객체(외부 요청 의심)", "그 외 객체(외부 요청 의심)"];
  for (const [i, w] of windows.entries()) {
    const row = { label: w.label, A: 0, B: 0, by: new Map() };
    for (const group of account[`d${i}`] ?? []) {
      const dim = group.dimensions ?? {};
      const count = Number(group.sum?.requests) || 0;
      const cls = classOf(dim.actionType);
      if (cls === "A") row.A += count;
      if (cls !== "B") continue;
      row.B += count;
      const source = sourceOf(dim);
      row.by.set(source, (row.by.get(source) ?? 0) + count);
      const key = `${dim.actionType}\n${dim.responseStatusCode}\n${dim.objectName ?? ""}`;
      total.set(key, { ...dim, source, count: (total.get(key)?.count ?? 0) + count });
    }
    daily.push(row);
  }
  print(`R2 요청 수 — ${windows[0].label} ~ ${windows.at(-1).label}(한국 날짜) · ${withBucket ? "버킷 R2_BUCKET" : "계정 전체 버킷"} · 분석 API 집계(몇 분 늦을 수 있음)`);
  const short = ["index.json", "latest.json", "패치", "HEAD", "없는 객체", "그 외 객체"];
  print(`날짜         Class A   Class B  ${short.map((s) => pad(s, 11)).join(" ")}`);
  for (const row of daily) print(`${row.label}  ${pad(n(row.A), 8)}  ${pad(n(row.B), 8)}  ${SOURCES.map((s) => pad(n(row.by.get(s) ?? 0), 11)).join(" ")}`);
  const sumB = daily.reduce((s, r) => s + r.B, 0);
  print(`합계         ${pad(n(daily.reduce((s, r) => s + r.A, 0)), 8)}  ${pad(n(sumB), 8)}`);
  const list = [...total.values()].sort((a, b) => b.count - a.count);
  print(`\nClass B 객체별 상위 ${Math.min(top, list.length)}줄(전체 ${list.length}줄)`);
  print("   횟수    비율  동작        응답  객체 → 추정 출처");
  for (const item of list.slice(0, top)) print(`${pad(n(item.count), 7)}  ${pad(((item.count / Math.max(1, sumB)) * 100).toFixed(1), 5)}%  ${String(item.actionType).padEnd(10)}  ${pad(item.responseStatusCode ?? "", 4)}  ${item.objectName || "(없음)"} → ${item.source}`);
  return 0;
}
