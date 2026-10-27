// package.json 의 이름으로 tools/scripts.cjs 의 명령을 실행한다.
//
//   node tools/run.cjs              전체 목록
//   node tools/run.cjs app:build    그 이름의 명령 실행
//   npm test -- ocr                 `--` 뒤 인자는 마지막 명령에 이어 붙는다
//
// 명령이 배열이면 순서대로 실행하고, 하나라도 실패하면 거기서 멈춘다.
// 오래 걸리는 명령은 15초마다 경과를 알린다(tools/exec.cjs).

const path = require("path");

const TABLE = require("./scripts.cjs");
const { runStep } = require("./exec.cjs");
const tint = require("./tint.cjs");

const root = path.join(__dirname, "..");

// npm 을 거치지 않고 직접 실행해도 지역 명령(tauri 등)을 찾도록 경로를 더한다.
// npm run 으로 부를 때는 npm 이 이미 넣어 주지만, node tools/run.cjs 로 부를 때는 없다.
const BIN = path.join(root, "node_modules", ".bin");
const PATH_KEY = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const env = { ...process.env, [PATH_KEY]: [BIN, process.env[PATH_KEY] ?? ""].join(path.delimiter) };

const [name, ...extra] = process.argv.slice(2);

if (!name || name === "--list") {
  const width = Math.max(...Object.keys(TABLE).map((key) => key.length));
  console.log("사용 가능한 명령:\n");
  for (const [key, item] of Object.entries(TABLE)) {
    console.log(`  ${key.padEnd(width)}  ${item.detail}`);
  }
  console.log("\n  npm run <이름>  또는  node tools/run.cjs <이름>");
  process.exit(name ? 0 : 1);
}

const item = TABLE[name];
if (!item) {
  console.error(`그런 명령이 존재하지 않습니다: ${name}\n목록: node tools/run.cjs --list`);
  process.exit(1);
}

const steps = Array.isArray(item.run) ? [...item.run] : [item.run];
if (extra.length > 0) steps[steps.length - 1] = `${steps[steps.length - 1]} ${extra.join(" ")}`;

main();

async function main() {
  for (const step of steps) {
    if (steps.length > 1) console.log(`\n${tint.head("▶")} ${tint.name(step)}`);
    const code = await runStep(step, { cwd: root, env });
    if (code !== 0) process.exit(code);
  }
}
