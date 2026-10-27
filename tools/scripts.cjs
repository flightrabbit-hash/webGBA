// npm 명령의 실제 내용. package.json 에는 이름만 두고 여기서 관리한다(아비터와 같은 방식).
//
//   npm run app:dev         → tools/run.cjs app:dev → 아래 표의 명령
//   node tools/run.cjs      → 전체 목록
//
// 값이 배열이면 순서대로 실행하고, 하나라도 실패하면 거기서 멈춘다.
// `npm run <이름> -- <인자>` 로 준 인자는 마지막 명령에 그대로 이어 붙인다.
//
// webGBA 는 일반 권한(asInvoker)으로 뜬다. 아비터처럼 빌드와 실행을 나눌 이유는 없지만
// 같은 명령 이름을 쓰려고 표 모양은 그대로 둔다.

const BUNDLE = "src-bundle";
const CARGO = "--manifest-path src-tauri/Cargo.toml";

module.exports = {
  /* ─────────────── 앱 빌드·실행 ─────────────── */

  "app:dev": {
    detail: "디버그 빌드 후 실행",
    run: [`node ${BUNDLE}/build-dist.cjs`, `cargo build ${CARGO} --no-default-features`, "node tools/run-app.cjs --debug"],
  },

  // custom-protocol 을 끄면 화면을 dist 에서 직접 읽어 수정이 빨리 반영된다.
  "app:build": {
    detail: "디버그 빌드 (target/debug)",
    run: [`node ${BUNDLE}/build-dist.cjs`, `cargo build ${CARGO} --no-default-features`],
  },

  // 릴리스는 기본 기능으로 빌드한다 — custom-protocol 이 꺼지면 화면이 실행 파일에 포함되지 않는다.
  "app:build:release": {
    detail: "릴리스 빌드 (target/release)",
    run: [`node ${BUNDLE}/build-fresh.cjs`, `node ${BUNDLE}/build-dist.cjs`, `cargo build --release ${CARGO}`],
  },

  "app:run": {
    detail: "릴리스 실행 파일 실행",
    run: "node tools/run-app.cjs --release",
  },

  "app:run:debug": {
    detail: "디버그 실행 파일 실행",
    run: "node tools/run-app.cjs --debug",
  },

  /* ─────────────── mGBA 코어 ─────────────── */

  // 도커 emscripten/emsdk:4.0.10 을 --rm 으로 띄워 core/build.sh 를 돌리고 결과를 src-bundle/src/core 로 옮긴다.
  core: {
    detail: "mGBA wasm 코어 빌드 (도커)",
    run: "node tools/core-build.cjs",
  },

  /* ─────────────── Rust ─────────────── */

  "rs:check": {
    detail: "컴파일 검토",
    run: `cargo check --lib ${CARGO}`,
  },

  "rs:test": {
    detail: "테스트",
    run: `cargo test --lib ${CARGO}`,
  },

  /* ─────────────── 시험 ─────────────── */

  "test:core": {
    detail: "내장 호스트로 .wasm 을 Node 에서 돌려 보기 (<코어.wasm> <롬> <출력 폴더>)",
    run: "node tools/test/host-smoke.mjs",
  },

  /* ─────────────── 배포 ─────────────── */

  dist: {
    detail: "화면 조립 (src-bundle/src → dist)",
    run: `node ${BUNDLE}/build-dist.cjs`,
  },

  // bundle 이 비활성이라 설치본 없이 target/release/webgba.exe 만 만든다.
  build: {
    detail: "tauri build — 실행 파일 만들기",
    run: [`node ${BUNDLE}/build-fresh.cjs`, "tauri build"],
  },

  /* ─────────────── 폴더 열기 ─────────────── */

  "open:release": {
    detail: "릴리스 폴더 열기 (target/release)",
    run: "node tools/open-dir.cjs release",
  },

  "open:debug": {
    detail: "디버그 폴더 열기 (target/debug)",
    run: "node tools/open-dir.cjs debug",
  },

  /* ─────────────── 그 밖 ─────────────── */

  dev: {
    detail: "tauri dev",
    run: "tauri dev",
  },

  tauri: {
    detail: "tauri CLI 그대로 호출",
    run: "tauri",
  },
};
