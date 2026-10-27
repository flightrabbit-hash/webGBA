// exe 안에 들어갈 dist/ 를 조립한다(아비터 build-dist.cjs 와 같은 배치).
//
//   src/html/   index.html · wasm-host.html          → dist/ 뿌리(HTML 이 곧 주소)
//   src/css/ src/js/ src/icons/ src/i18n/            → dist/ 아래 폴더째(i18n 은 언어별 번역 표, Rust 도 include_str 로 씀)
//   bin/core/   mgba_core.wasm · licenses/            → dist/bin/core (exe 안 사본. exe 옆 bin/core 가 없으면 꺼내 놓음)
//   ini/        setting.ini · personalization.cfg     → dist/ (exe 옆 bin/ini 의 씨앗)
//
// 아비터의 공백 압축(minify.cjs)은 쓰지 않는다. 배포 파일에 주석을 두지 않는 규칙만 지킨다.
// 내용이 같은 파일은 다시 쓰지 않는다 — 수정 시각이 바뀌면 Tauri 가 크레이트 전체를 다시 컴파일한다.
//
//   node src-bundle/build-dist.cjs

const fs = require("fs");
const path = require("path");
const tint = require("../tools/tint.cjs");

const bundle = __dirname;
const root = path.join(bundle, "..");
const src = path.join(bundle, "src");
const dist = path.join(root, "dist");

const written = new Set();

function same(from, to) {
  if (!fs.existsSync(to)) return false;
  const a = fs.statSync(from);
  const b = fs.statSync(to);
  if (a.size !== b.size) return false;
  return fs.readFileSync(from).equals(fs.readFileSync(to));
}

function copy(from, to) {
  written.add(path.resolve(to));
  if (same(from, to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const one = path.join(from, entry.name);
    const other = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(one, other);
    else copy(one, other);
  }
}

function sweep(dir) {
  if (!fs.existsSync(dir)) return 0;
  let gone = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const one = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      gone += sweep(one);
      if (fs.readdirSync(one).length === 0) fs.rmdirSync(one);
      continue;
    }
    if (written.has(path.resolve(one))) continue;
    fs.rmSync(one, { force: true, maxRetries: 10, retryDelay: 150 });
    gone += 1;
  }
  return gone;
}

fs.mkdirSync(dist, { recursive: true });

const pages = fs.readdirSync(path.join(src, "html")).filter((name) => name.endsWith(".html"));
if (!pages.includes("index.html")) {
  console.error(`화면 파일을 찾지 못했습니다: ${path.join(src, "html", "index.html")}`);
  process.exit(1);
}
for (const page of pages) copy(path.join(src, "html", page), path.join(dist, page));

for (const folder of ["css", "js", "icons", "i18n"]) copyTree(path.join(src, folder), path.join(dist, folder));

copyTree(path.join(bundle, "bin"), path.join(dist, "bin"));
if (!fs.existsSync(path.join(dist, "bin", "core", "mgba_core.wasm"))) {
  console.error("mGBA 코어가 없습니다: src-bundle/bin/core/mgba_core.wasm\n먼저 npm run core 를 실행하세요.");
  process.exit(1);
}

copy(path.join(root, "src-tauri", "icons", "64x64.png"), path.join(dist, "icon.png"));
copy(path.join(root, "LICENSE"), path.join(dist, "LICENSE"));
copy(path.join(root, "THIRD_PARTY_NOTICES"), path.join(dist, "THIRD_PARTY_NOTICES"));

for (const name of ["personalization.cfg", "setting.ini"]) {
  const seed = path.join(bundle, "ini", name);
  if (fs.existsSync(seed)) copy(seed, path.join(dist, name));
  else console.warn(tint.warn(`초기 설정 파일이 존재하지 않아 exe 에 포함하지 못했습니다: ini/${name}`));
}

const stale = sweep(dist);

let count = 0;
let bytes = 0;
for (const file of written) {
  count += 1;
  bytes += fs.statSync(file).size;
}
const human = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
console.log(`dist 를 준비했습니다(${tint.num(count)}개 ${tint.num(human(bytes))})${stale ? ` — 옛 파일 ${stale}개 정리` : ""}`);
