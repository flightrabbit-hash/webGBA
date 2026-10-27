// 빌드된 webGBA 를 실행한다. 실행 파일이 없으면 먼저 빌드한다.
//
//   node tools/run-app.cjs              release·debug 중 최신 실행 파일
//   node tools/run-app.cjs --release    릴리스만
//   node tools/run-app.cjs --debug      디버그만
//   node tools/run-app.cjs --no-build   없어도 빌드하지 않는다
//   node tools/run-app.cjs --no-run     빌드까지만 하고 실행하지 않는다
//   node tools/run-app.cjs -- <파일>    그 파일을 열며 실행
//
// 일반 권한으로 띄운다(관리자 승인 창 없음).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TABLE = require("./scripts.cjs");
const { runStep } = require("./exec.cjs");
const tint = require("./tint.cjs");

const root = path.join(__dirname, "..");
const target = path.join(root, "src-tauri", "target");
const EXE = "webgba.exe";

const args = process.argv.slice(2);
const only = args.includes("--release") ? "release" : args.includes("--debug") ? "debug" : null;
const withBuild = !args.includes("--no-build");
const withRun = !args.includes("--no-run");
const files = args.filter((arg) => !arg.startsWith("--"));

const BIN = path.join(root, "node_modules", ".bin");
const PATH_KEY = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const env = { ...process.env, [PATH_KEY]: [BIN, process.env[PATH_KEY] ?? ""].join(path.delimiter) };

main();

async function main() {
  let pick = find();
  if (!pick && withBuild) {
    const kind = only ?? "release";
    console.log(`실행 파일이 존재하지 않습니다 — ${kind} 빌드를 먼저 수행합니다.`);
    await buildOne(kind);
    pick = find();
  }

  if (!pick) {
    console.error("실행 파일이 존재하지 않습니다.\n  릴리스: npm run build\n  디버그: node tools/run.cjs app:build");
    process.exit(1);
  }

  const stamp = new Date(pick.at).toLocaleString("ko-KR", { hour12: false });
  console.log(`${withRun ? "실행" : "준비"} — ${pick.kind} · ${stamp}\n  ${pick.path}`);
  if (!withRun) return;

  spawn(pick.path, files, { detached: true, stdio: "ignore" }).unref();
}

function find() {
  const picks = [];
  for (const kind of ["release", "debug"]) {
    if (only && kind !== only) continue;
    const where = path.join(target, kind, EXE);
    if (!fs.existsSync(where)) continue;
    picks.push({ kind, path: where, at: fs.statSync(where).mtimeMs });
  }
  picks.sort((a, b) => b.at - a.at);
  return picks[0] ?? null;
}

/** 빌드 명령은 tools/scripts.cjs 의 것을 그대로 쓴다. 두 곳에 적으면 한쪽만 고쳐진다. */
async function buildOne(kind) {
  const name = kind === "release" ? "app:build:release" : "app:build";
  const base = TABLE[name].run;
  const steps = Array.isArray(base) ? [...base] : [base];
  for (const step of steps) {
    console.log(`\n${tint.head("▶")} ${tint.name(step)}`);
    const code = await runStep(step, { cwd: root, env });
    if (code !== 0) {
      console.error("빌드하지 못했습니다.");
      process.exit(code);
    }
  }
}
