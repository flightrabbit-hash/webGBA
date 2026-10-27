// 폴더를 탐색기로 연다.
//
//   node tools/open-dir.cjs release     src-tauri/target/release
//   node tools/open-dir.cjs debug       src-tauri/target/debug
//   node tools/open-dir.cjs dist        dist
//   node tools/open-dir.cjs <경로>      그 경로 그대로
//
// 탐색기(explorer.exe)는 성공해도 종료 코드 1 을 반환한다. 그 값을 그대로 넘기면
// 실행기가 실패로 판정하므로, 여기서 결과를 확인하고 0 으로 끝낸다.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");

const KNOWN = {
  release: path.join("src-tauri", "target", "release"),
  debug: path.join("src-tauri", "target", "debug"),
  dist: "dist",
  bundle: path.join("src-tauri", "target", "release", "bundle", "nsis"),
};

const asked = process.argv[2] ?? "release";
const target = path.resolve(root, KNOWN[asked] ?? asked);

if (!fs.existsSync(target)) {
  console.error(`폴더가 존재하지 않습니다: ${target}\n먼저 빌드해 주세요 — npm run build`);
  process.exit(1);
}

console.log(target);

if (process.platform !== "win32") {
  spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  process.exit(0);
}

spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
