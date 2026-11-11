// R2 요청 수 조회 — wgba.mjs r2-stats. Cloudflare GraphQL 분석 API(r2OperationsAdaptiveGroups)를 읽기만 한다(버킷 요청 0번).
// 환경 변수 CF_API_TOKEN(Account Analytics 읽기 권한 API 토큰) · R2_ACCOUNT_ID · R2_BUCKET(공개) · R2_PRIVATE_BUCKET(비공개)에서만 읽고 값을 출력·기록하지 않는다.
// --bucket public(기본) | private | all(버킷 이름 차원 추가), --hourly = 시각(한국 시각 시) 차원 추가.
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
  if (object === "roms.json") return "롬 가져오기 목록 roms.json(서버 list)";
  if (object === "authentication.key") return "관리자 키 파일(서버 verify·list·url, 5분 캐시)";
  if (/^wgba\/.+\.wgba$/i.test(object)) return "비공개 .wgba(받기·roms.json 없을 때 목록 머리 범위 GET)";
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

export function statsQuery(windows, withBucket, { byBucket = false, hourly = false } = {}) {
  const dims = ["actionType", "objectName", "responseStatusCode", ...(byBucket ? ["bucketName"] : []), ...(hourly ? ["datetimeHour"] : [])].join(" ");
  const nodes = windows.map((w, i) => `d${i}: r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: "${w.from}", datetime_leq: "${w.to}"${withBucket ? ", bucketName: $b" : ""} }) { sum { requests } dimensions { ${dims} } }`);
  return `query (${["$a: string", ...(withBucket ? ["$b: string"] : [])].join(", ")}) { viewer { accounts(filter: { accountTag: $a }) { ${nodes.join(" ")} } } }`;
}

const n = (v) => v.toLocaleString("en-US");
const pad = (text, width) => String(text).padStart(width);

export async function r2Stats({ days = null, since = null, until = null, top = 30, bucket = "public", hourly = false, env = process.env, fetchImpl = fetch, now = Date.now(), print = console.log } = {}) {
  const missing = STATS_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`환경 변수가 없습니다: ${missing.join(", ")} — CF_API_TOKEN 은 Cloudflare 대시보드 → My Profile → API Tokens 에서 "Account Analytics: Read" 권한으로 만듭니다`);
  if (!["public", "private", "all"].includes(bucket)) throw new Error("--bucket 은 public · private · all");
  const bucketEnv = bucket === "private" ? "R2_PRIVATE_BUCKET" : bucket === "public" ? "R2_BUCKET" : null;
  if (bucket === "private" && !env.R2_PRIVATE_BUCKET) throw new Error("환경 변수가 없습니다: R2_PRIVATE_BUCKET");
  const bucketName = bucketEnv ? env[bucketEnv] ?? "" : "";
  const windows = dayWindows({ days: days ?? 7, since, until, now });
  const withBucket = Boolean(bucketName);
  const byBucket = bucket === "all";
  const response = await fetchImpl(GRAPHQL_API, { method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: statsQuery(windows, withBucket, { byBucket, hourly }), variables: { a: env.R2_ACCOUNT_ID, ...(withBucket ? { b: bucketName } : {}) } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.errors?.length) throw new Error(`분석 API: HTTP ${response.status} ${(body?.errors ?? []).map((e) => e.message).join(" / ").slice(0, 300)}`);
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("분석 API: 계정 결과가 없습니다(R2_ACCOUNT_ID·토큰 권한 확인)");
  const bucketLabel = (name) => (name === env.R2_BUCKET ? "공개" : name === env.R2_PRIVATE_BUCKET ? "비공개" : "그 외 버킷");
  const total = new Map();
  const daily = [];
  const buckets = new Map();
  const hours = new Map();
  const SOURCES = ["목록 index.json(webGBA 0.8.1 이상)", "게임별 latest.json(webGBA 0.8.0 이하·목록 실패 시)", "패치·전체 설치 받기", "HEAD(업로드 도구 0.8.1 upload·대시보드)", "없는 객체(외부 요청 의심)", "그 외 객체(외부 요청 의심)", "롬 가져오기 목록 roms.json(서버 list)", "관리자 키 파일(서버 verify·list·url, 5분 캐시)", "비공개 .wgba(받기·roms.json 없을 때 목록 머리 범위 GET)"];
  for (const [i, w] of windows.entries()) {
    const row = { label: w.label, A: 0, B: 0, by: new Map() };
    for (const group of account[`d${i}`] ?? []) {
      const dim = group.dimensions ?? {};
      const count = Number(group.sum?.requests) || 0;
      const cls = classOf(dim.actionType);
      const where = byBucket ? bucketLabel(dim.bucketName) : "";
      if (byBucket) {
        const b = buckets.get(where) ?? { A: 0, B: 0 };
        if (cls === "A" || cls === "B") b[cls] += count;
        buckets.set(where, b);
      }
      if (cls === "A") row.A += count;
      if (cls !== "B") continue;
      row.B += count;
      const source = sourceOf(dim);
      row.by.set(source, (row.by.get(source) ?? 0) + count);
      const key = [where, dim.actionType, dim.responseStatusCode, dim.objectName ?? ""].join("\n");
      total.set(key, { ...dim, where, source, count: (total.get(key)?.count ?? 0) + count });
      if (hourly && dim.datetimeHour) {
        const h = hours.get(dim.datetimeHour) ?? { count: 0, by: new Map() };
        h.count += count;
        h.by.set(source, (h.by.get(source) ?? 0) + count);
        hours.set(dim.datetimeHour, h);
      }
    }
    daily.push(row);
  }
  const scope = byBucket ? "계정 전체(버킷별)" : bucket === "private" ? "버킷 R2_PRIVATE_BUCKET" : withBucket ? "버킷 R2_BUCKET" : "계정 전체 버킷";
  print(`R2 요청 수 — ${windows[0].label} ~ ${windows.at(-1).label}(한국 날짜) · ${scope} · 분석 API 집계(몇 분 늦을 수 있음)`);
  const short = ["index.json", "latest.json", "패치", "HEAD", "없는 객체", "그 외 객체", "roms.json", "키 파일", "비공개wgba"];
  print(`날짜         Class A   Class B  ${short.map((s) => pad(s, 11)).join(" ")}`);
  for (const row of daily) print(`${row.label}  ${pad(n(row.A), 8)}  ${pad(n(row.B), 8)}  ${SOURCES.map((s) => pad(n(row.by.get(s) ?? 0), 11)).join(" ")}`);
  const sumB = daily.reduce((s, r) => s + r.B, 0);
  print(`합계         ${pad(n(daily.reduce((s, r) => s + r.A, 0)), 8)}  ${pad(n(sumB), 8)}`);
  if (byBucket) for (const [where, b] of buckets) print(`  ${where}: Class A ${n(b.A)} · Class B ${n(b.B)}`);
  const list = [...total.values()].sort((a, b) => b.count - a.count);
  print(`\nClass B 객체별 상위 ${Math.min(top, list.length)}줄(전체 ${list.length}줄)`);
  print(`   횟수    비율  ${byBucket ? "버킷    " : ""}동작        응답  객체 → 추정 출처`);
  for (const item of list.slice(0, top)) print(`${pad(n(item.count), 7)}  ${pad(((item.count / Math.max(1, sumB)) * 100).toFixed(1), 5)}%  ${byBucket ? String(item.where).padEnd(6) + "  " : ""}${String(item.actionType).padEnd(10)}  ${pad(item.responseStatusCode ?? "", 4)}  ${item.objectName || "(없음)"} → ${item.source}`);
  if (hourly) {
    const busy = [...hours].sort((a, b) => b[1].count - a[1].count).slice(0, top);
    print(`\nClass B 많은 시각 상위 ${busy.length}개(한국 시각)`);
    for (const [at, h] of busy) {
      const label = new Date(Date.parse(at) + KST).toISOString().slice(5, 13).replace("T", " ");
      const lead = [...h.by].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s, c]) => `${s} ${n(c)}`).join(" · ");
      print(`${label}시  ${pad(n(h.count), 6)}  ${lead}`);
    }
  }
  return 0;
}
