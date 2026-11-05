// 웹 전용 webGBA 조립 — 브라우저만으로 도는 정적 사이트(Vercel 출력 web/dist).
//   node web/build.mjs [출력 폴더]
// 앱(src-bundle)의 코어 모듈을 그대로 가져다 쓰고, Tauri 다리(js/bridge.js)만 웹용으로 바꿔 넣는다.
// mGBA 는 빌드하지 않는다 — 저장소의 src-bundle/bin/core/mgba_core.wasm 을 복사한다. Node 기본 모듈만 쓴다.
// 롬·게임·세이브는 넣지 않는다: 끝에 check-no-rom 으로 출력 전체를 검사하고, 걸리면 실패한다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { check } from "./tools/check-no-rom.mjs";
import { ICON_NAMES } from "./src/js/icons.js";

const web = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(web, "..");
const src = path.join(web, "src");
const app = path.join(root, "src-bundle", "src");
const coreDir = path.join(root, "src-bundle", "bin", "core");
const out = path.resolve(process.argv[2] ?? path.join(web, "dist"));

const SHARED = ["app/player.js", "app/patch-loader.js", "app/zip-pick.js","app/net-window.js", "app/board-panel.js", "core/net/board.js", "core/net/lan.js", "core/net/ice.js","core/net/session.js", "core/net/net-host.js", "core/net/qr.js", "core/net/signal.js", "core/web-host.js", "core/rom-kind.js", "core/wgbp.js", "core/zip.js", "core/wgba-format.js", "core/wgba-read.js", "core/lang-text.js", "core/script-host.js", "core/runner.js", "core/patch-worker.js", "shell/i18n.js", "shell/theme.js", "vendor/pako.js", "vendor/jsqr.js"];
const LANGS = ["ko", "en", "ja"];
const LICENSES = ["mgba-LICENSE.txt", "blip_buf-LICENSE.txt", "inih-LICENSE.txt", "pako-LICENSE.txt", "jsqr-LICENSE.txt"];

const fail = (text) => {
  console.error(`웹 빌드 실패: ${text}`);
  process.exit(1);
};

function copy(from, to) {
  if (!fs.existsSync(from)) fail(`없는 파일 ${path.relative(root, from)}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyTree(from, to, skip = () => false) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const one = path.join(from, entry.name);
    const other = path.join(to, entry.name);
    if (skip(one)) continue;
    if (entry.isDirectory()) copyTree(one, other, skip);
    else copy(one, other);
  }
}

function listFiles(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name), base) : [path.relative(base, path.join(dir, entry.name)).replace(/\\/g, "/")]))
    .sort();
}

// 휴대폰 시작 스플래시: css·js 는 첫 그림이 추가 요청 없이 나오도록 index.html 안에 넣는다(plan.js 는 head 앞쪽 — 그림 받기를 web.css 와 함께 시작).
// 그림은 /splash/*.png 파일로 두어 서비스 워커가 바뀌지 않은 그림을 다시 받지 않게 한다.
function inlineSplash() {
  const dir = path.join(src, "splash");
  const file = path.join(out, "index.html");
  let html = fs.readFileSync(file, "utf8");
  const parts = [
    ['<script src="/splash/plan.js"></script>', "plan.js", "script"],
    ['<link rel="stylesheet" href="/splash/splash.css" />', "splash.css", "style"],
    ['<script src="/splash/splash.js"></script>', "splash.js", "script"],
  ];
  for (const [tag, name, kind] of parts) {
    if (!html.includes(tag)) fail(`index.html 에 스플래시 자리 ${name} 이(가) 없습니다`);
    const text = fs.readFileSync(path.join(dir, name), "utf8").trim();
    if (text.includes(`</${kind}`)) fail(`${name} 를 index.html 에 넣지 못했습니다`);
    html = html.replace(tag, () => `<${kind}>\n${text}\n    </${kind}>`);
  }
  fs.writeFileSync(file, html);
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".png"))) copy(path.join(dir, name), path.join(out, "splash", name));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const slots = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

fs.rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
fs.mkdirSync(out, { recursive: true });

copyTree(src, out, (file) => [path.join(src, "sw.js"), path.join(src, "i18n"), path.join(src, "splash")].includes(file));
inlineSplash();
for (const rel of SHARED) copy(path.join(app, "js", rel), path.join(out, "js", rel));
const iconNames = new Set(ICON_NAMES);
const iconUses = [
  ...fs.readFileSync(path.join(src, "index.html"), "utf8").matchAll(/data-icon="(\w+)"/g),
  ...fs.readFileSync(path.join(src, "js", "main.js"), "utf8").matchAll(/\bicon: "(\w+)"|iconNode\("(\w+)"\)|\["(\w+)", "web\.gate\.|act\(t\("[\w.]+"\), "(\w+)"|\["(?:save|load)", "(\w+)"\]/g),
].map((m) => m.slice(1).find(Boolean));
if (iconUses.length < 20) fail(`아이콘 쓰는 곳을 못 찾았습니다(${iconUses.length})`);
for (const name of iconUses) if (!iconNames.has(name)) fail(`icons.js 에 없는 아이콘 ${name}`);

const webTables = Object.fromEntries(LANGS.map((id) => [id, readJson(path.join(src, "i18n", `${id}.json`))]));
for (const id of LANGS) {
  for (const key of Object.keys(webTables.ko)) {
    if (!(key in webTables[id])) fail(`i18n/${id}.json 에 ${key} 가 없습니다`);
    if (slots(webTables.ko[key]) !== slots(webTables[id][key])) fail(`i18n/${id}.json ${key} 의 자리 표시가 다릅니다`);
  }
  for (const key of Object.keys(webTables[id])) if (!(key in webTables.ko)) fail(`i18n/${id}.json 에만 있는 키 ${key}`);
  const merged = { ...readJson(path.join(app, "i18n", `${id}.json`)), ...webTables[id] };
  fs.mkdirSync(path.join(out, "i18n"), { recursive: true });
  fs.writeFileSync(path.join(out, "i18n", `${id}.json`), JSON.stringify(merged));
}

const used = new Set();
for (const rel of listFiles(path.join(out, "js"))) {
  const text = fs.readFileSync(path.join(out, "js", rel), "utf8");
  for (const m of text.matchAll(/\bt\(\s*"(web\.[\w.-]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/^\s*import\b[^"']*["'](\.[^"']+)["']/gm)) {
    const target = path.resolve(path.dirname(path.join(out, "js", rel)), m[1]);
    if (!fs.existsSync(target) && !m[1].endsWith("build-info.js")) fail(`${rel} 이(가) 가져오는 ${m[1]} 이(가) 없습니다`);
  }
}
for (const m of fs.readFileSync(path.join(src, "index.html"), "utf8").matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) used.add(m[1]);
const known = readJson(path.join(out, "i18n", "ko.json"));
for (const key of used) if (!(key in known)) fail(`번역 표에 없는 키 ${key}`);
for (const m of fs.readFileSync(path.join(src, "index.html"), "utf8").matchAll(/\/icons\/([\w-]+\.(?:svg|png))/g)) {
  if (!fs.existsSync(path.join(out, "icons", m[1]))) fail(`index.html 이 쓰는 아이콘 ${m[1]} 이(가) 없습니다`);
}

copy(path.join(coreDir, "mgba_core.wasm"), path.join(out, "core", "mgba_core.wasm"));
for (const name of LICENSES) copy(path.join(coreDir, "licenses", name), path.join(out, "licenses", name));
copy(path.join(root, "LICENSE"), path.join(out, "LICENSE.txt"));
copy(path.join(root, "THIRD_PARTY_NOTICES"), path.join(out, "THIRD_PARTY_NOTICES.txt"));

const version = readJson(path.join(root, "package.json")).version;
const hashOf = (files) => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(path.join(src, "sw.js")));
  for (const rel of files) {
    hash.update(rel);
    hash.update(fs.readFileSync(path.join(out, rel)));
  }
  return hash.digest("hex").slice(0, 10);
};
const contentHash = hashOf(listFiles(out));
fs.writeFileSync(path.join(out, "js", "build-info.js"), `export const BUILD = ${JSON.stringify({ version, hash: contentHash })};\n`);

// 서비스 워커가 파일마다 내용 해시를 알면 업데이트 때 해시가 같은 파일은 이전 캐시에서 복사하고 바뀐 파일만 받는다.
const fileHash = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(out, rel))).digest("hex").slice(0, 16);
const precache = listFiles(out).filter((rel) => !rel.startsWith("licenses/") && !rel.endsWith(".txt"));
const files = [["/", fileHash("index.html")], ...precache.map((rel) => [`/${rel}`, fileHash(rel)])];
const sw = fs
  .readFileSync(path.join(src, "sw.js"), "utf8")
  .replace('"__WEBGBA_VERSION__"', JSON.stringify(`${version}-${contentHash}`))
  .replace('["__WEBGBA_FILES__"]', JSON.stringify(files));
if (sw.includes("__WEBGBA_")) fail("sw.js 자리 표시를 채우지 못했습니다");
fs.writeFileSync(path.join(out, "sw.js"), sw);

const all = listFiles(out).map((rel) => ({ full: path.join(out, rel), rel }));
const result = check(all);
if (result.problems.length) fail(`롬 없음 검사:\n  ${result.problems.join("\n  ")}`);
if (result.big.length) fail(`1MB 넘는 파일: ${result.big.join(", ")}`);

console.log(`웹 빌드 ${version}-${contentHash} → ${path.relative(root, out) || out}`);
console.log(`파일 ${all.length}개 · ${result.bytesTotal}바이트 · 오프라인 캐시 ${files.length}개 · 롬 없음 검사 통과`);
