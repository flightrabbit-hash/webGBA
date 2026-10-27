// mGBA wasm 코어를 도커에서 빌드하고 결과를 앱 bin 리소스(src-bundle/bin/core)로 옮긴다.
// 그 폴더는 tauri.conf 의 resources 로 exe 옆 bin/ 에 함께 놓이고, exe 에도 사본이 들어간다(없으면 꺼내 놓음).
//
//   node tools/core-build.cjs
//
// 이미지는 emscripten/emsdk:4.0.10(포트 빌드와 같은 판). 컨테이너는 --rm 이고 15분 안에 끝나지 않으면 멈춘다.
// 다른 작업의 컨테이너는 건드리지 않는다.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const tint = require("./tint.cjs");

const root = path.join(__dirname, "..");
const core = path.join(root, "core");
const out = path.join(core, "out");
const dest = path.join(root, "src-bundle", "bin", "core");
const IMAGE = "emscripten/emsdk:4.0.10";
const LIMIT_MS = 15 * 60 * 1000;

const mount = `${core.replace(/\\/g, "/")}:/work`;
const done = spawnSync("docker", ["run", "--rm", "-v", mount, IMAGE, "bash", "/work/build.sh"], {
  stdio: "inherit",
  timeout: LIMIT_MS,
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});

if (done.error || done.status !== 0) {
  console.error(tint.bad(`코어를 빌드하지 못했습니다: ${done.error?.message ?? `종료 코드 ${done.status}`}`));
  console.error(`기록: ${path.join(out, "cmake.log")}, ${path.join(out, "make.log")}`);
  process.exit(1);
}

fs.mkdirSync(path.join(dest, "licenses"), { recursive: true });
fs.copyFileSync(path.join(out, "mgba_core.wasm"), path.join(dest, "mgba_core.wasm"));
for (const name of ["mgba-LICENSE.txt", "blip_buf-LICENSE.txt", "inih-LICENSE.txt"]) {
  fs.copyFileSync(path.join(out, name), path.join(dest, "licenses", name));
}

const size = `${(fs.statSync(path.join(dest, "mgba_core.wasm")).size / 1024).toFixed(1)} KB`;
console.log(`${tint.head("코어를 옮겼습니다")} — src-bundle/bin/core/mgba_core.wasm ${size}`);
