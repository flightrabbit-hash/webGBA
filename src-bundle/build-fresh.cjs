/*
  빌드할 때마다 exe 를 새로 만들게 한다(아비터 build-fresh.cjs 와 같은 방식).

  실행 파일이 없을 때만 이 크레이트의 지문(fingerprint)을 지운다. 지문이 남아 있으면 cargo 가
  `Finished` 만 출력하고 링크를 하지 않아 exe 가 생기지 않는다. 의존성 지문은 건드리지 않는다.
  실행 파일이 있으면 잠겨 있는지만 확인한다 — webGBA 가 켜져 있으면 링크 단계에서 실패한다.
*/

const fs = require("fs");
const path = require("path");
const tint = require("../tools/tint.cjs");

const root = path.join(__dirname, "..");
const profile = process.argv.includes("--debug") ? "debug" : "release";
const release = path.join(root, "src-tauri", "target", profile);

/** 이 크레이트의 지문 폴더 이름은 `webgba-<해시>` 꼴이다. */
const CRATE = "webgba";

const BINARIES = [path.join(release, "webgba.exe"), path.join(release, "deps", "webgba.exe")];

function halt(file, error) {
  console.error(
    tint.bad(
      `\n빌드를 시작하지 못했습니다.\n` +
        `  ${path.relative(root, file)} 을(를) 사용할 수 없습니다.\n` +
        `  webGBA 가 켜져 있으면 그 파일이 잠깁니다. 창을 닫고 다시 빌드해 주세요.\n` +
        `  원래 오류: ${error.code ?? error.message}\n`,
    ),
  );
  process.exit(1);
}

const kept = BINARIES.filter((file) => fs.existsSync(file));
if (kept.length > 0) {
  for (const file of kept) {
    try {
      fs.closeSync(fs.openSync(file, "r+"));
    } catch (error) {
      halt(file, error);
    }
  }
  console.log(tint.dim(`정리할 내용이 없습니다(${profile}) — 기존 실행 파일 유지`));
  process.exit(0);
}

const removed = [];
const fingerprints = path.join(release, ".fingerprint");
if (fs.existsSync(fingerprints)) {
  for (const name of fs.readdirSync(fingerprints)) {
    if (!name.startsWith(`${CRATE}-`)) continue;
    fs.rmSync(path.join(fingerprints, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    removed.push(name);
  }
}

console.log(removed.length ? `${tint.head(`파일을 정리합니다(${profile})`)}\n — ${removed.join("\n — ")}` : tint.dim(`정리할 내용이 없습니다(${profile})`));
