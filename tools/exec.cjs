// 명령 하나를 실행하며 진행 상황을 한 행으로 출력한다.
//
//   … 516/518 · webgba · 함수 12,431/48,902 · 경과 1분 2초 / 예상 3분 33초 (29%)
//   … 517/518 · webgba(bin) · LTO 모듈 138/208 · 경과 2분 20초 / 예상 3분 33초 (66%)
//
// cargo 는 출력을 가로채면(파이프) 진행 막대를 끈다. `CARGO_TERM_PROGRESS_WHEN=always`
// 로 유지한 후 해당 행에서 **완료 수 / 전체 수**와 단위명만 조회한다.
//
// 막대의 한 칸(크레이트 하나)이 수 분을 소요하므로 그 내부를 `RUSTC_LOG` 으로 확인한다. 안정
// 채널도 INFO 까지는 실행 파일에 포함되어 있어 별도 도구·nightly 가 필요하지 않고,
// 최적화 설정을 건드리지 않으므로 결과물도 동일하다. 국면을 구분하는 셋만 켠다 —
// 한 행으로 완결되는 기록만 선택한다. `rustc_interface::passes` 는 interner 통계표를,
// `rustc_metadata::creader` 는 크레이트 경로를,
// `rustc_codegen_ssa::back::link` 는 링커 출력을 여러 행으로 출력하므로 제외한다.
//
// 전체 함수 수는 사전에 확인할 수 없다. 직전 빌드의 수치를 target 에 기록한 후 분모로 사용한다.
//
// 진행 행은 터미널에서만 동일 위치를 갱신한다. 파일·파이프로 수신할 때는 갱신
// 문자가 그대로 남으므로 10초에 한 행씩만 출력한다.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const BEAT_MS = 1_000;

/** 이 시간 동안 기록이 멎으면 계수 국면이 끝난 것으로 본다. */
const IDLE_MS = 5_000;

/** `Building [===> ] 516/518: webgba(bin)` 에서 수치와 단위명을 조회한다. */
const STEP = /(\d+)\/(\d+):\s*(.*?)\s*$/;

/** 진행 막대 행. 자체 진행 행으로 대체하므로 원문은 출력하지 않는다. */
const BAR = /^\s*(Building|Compiling|Checking)\s*\[/;

const RUSTC_LOG = [
  "rustc_codegen_ssa::base=info",
  "rustc_codegen_llvm::back::lto=info",
].join(",");

const RUSTC_INFO = /\bINFO\s+rustc_/;

/** 명령별 직전 빌드 수치. target 하위에 배치하여 저장소에는 포함되지 않는다. */
const PACE = path.join(__dirname, "..", "src-tauri", "target", "build-pace.json");

const live = Boolean(process.stdout.isTTY);

let shown = "";

function human(ms) {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}분 ${sec}초` : `${sec}초`;
}

const count = (n) => n.toLocaleString("ko-KR");

/** 한글·한자는 터미널에서 두 칸을 차지한다. 글자 수로 측정하면 Overwrite 위치가 어긋난다. */
function wide(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  );
}

/** 표시 폭 기준으로 절단한다. 폭 초과 시 다음 행으로 이동하여 갱신 위치가 어긋난다. */
function clip(text, limit) {
  let out = "";
  let used = 0;
  for (const ch of text) {
    const step = wide(ch.codePointAt(0)) ? 2 : 1;
    if (used + step > limit) break;
    out += ch;
    used += step;
  }
  return out;
}

/** 진행 행. 터미널에서는 동일 위치를 Overwrite 한다. */
function paint(text) {
  const line = clip(text, Math.max(20, (process.stdout.columns ?? 120) - 2));
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(line);
  // 잔여 영역은 여백이 아닌 삭제로 처리한다. 여백은 폭 계산이 한 칸만 어긋나도 잔상이 남는다.
  readline.clearLine(process.stdout, 1);
  shown = line;
}

/** 진행 행을 삭제한다. 다른 출력이 혼합되기 전에 호출한다. */
function wipe() {
  if (!live || shown === "") return;
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 1);
  shown = "";
}

function paceRead() {
  try {
    return JSON.parse(fs.readFileSync(PACE, "utf8"));
  } catch {
    return {};
  }
}

function paceWrite(key, value) {
  try {
    const all = paceRead();
    all[key] = value;
    fs.mkdirSync(path.dirname(PACE), { recursive: true });
    fs.writeFileSync(PACE, JSON.stringify(all, null, 2), "utf8");
  } catch {
  }
}

/** 크레이트 하나의 진행. 막대가 다음 칸으로 이동하면 초기화한다. */
function newUnit(name) {
  return { name, funcs: 0, add: 0, link: 0, phase: "", last: Date.now() };
}

/**
 * @returns {Promise<number>} 종료 코드
 */
function runStep(command, { cwd, env, beat = true } = {}) {
  const watch = /^cargo\s+(build|check|test)\b/.test(command);

  const now = {
    ...env,
    ...(watch
      ? {
          CARGO_TERM_PROGRESS_WHEN: "always",
          CARGO_TERM_PROGRESS_WIDTH: "100",
          RUSTC_LOG: env?.RUSTC_LOG ?? RUSTC_LOG,
        }
      : {}),
  };

  const past = watch ? paceRead()[command] : undefined;

  return new Promise((done) => {
    const at = Date.now();
    const seen = {};
    let step = "";
    let unit = newUnit("");
    let ticks = 0;

    const child = spawn(command, {
      cwd,
      env: now,
      shell: true,
      stdio: watch ? ["inherit", "pipe", "pipe"] : "inherit",
    });

    if (watch) {
      pipe(child.stdout, (line) => {
        wipe();
        process.stdout.write(`${line}\n`);
      });

      // INFO 기록 중 `{:#?}` 로 출력되는 것(ThinLTOKeysMap 등)은 여러 행이다. 첫 행만 걸러지면
      // 나머지(`keys: {},` · `}`)가 화면에 남으므로 괄호가 닫힐 때까지 함께 숨긴다.
      let infoDepth = 0;
      const braces = (text) => (text.match(/[{[(]/g)?.length ?? 0) - (text.match(/[}\])]/g)?.length ?? 0);

      pipe(child.stderr, (line) => {
        if (infoDepth > 0 && !BAR.test(line) && !RUSTC_INFO.test(line) && !/^\s*(error|warning|Compiling|Checking|Finished)\b/.test(line)) {
          infoDepth = Math.max(0, infoDepth + braces(line));
          return;
        }
        infoDepth = 0;

        if (BAR.test(line)) {
          const hit = STEP.exec(line);
          if (!hit) return;
          step = `${hit[1]}/${hit[2]}`;
          if (hit[3] && hit[3] !== unit.name) {
            if (unit.name) seen[unit.name] = { funcs: unit.funcs, modules: unit.add + 1 };
            unit = newUnit(hit[3]);
          }
          return;
        }

        // 자체 활성화한 기록이므로 수치만 사용하고 원문은 출력하지 않는다.
        if (RUSTC_INFO.test(line)) {
          tally(unit, line);
          infoDepth = Math.max(0, braces(line));
          return;
        }

        if (line.trim() === "") return;
        wipe();
        process.stderr.write(`${line}\n`);
      });
    }

    const timer = beat
      ? setInterval(() => {
          ticks += 1;
          const text = `  … ${status(step, unit, Date.now() - at, past)}`;

          if (live) paint(text);
          else if (ticks % 10 === 0) process.stdout.write(`${text}\n`);
        }, BEAT_MS)
      : null;

    child.on("error", (error) => {
      if (timer) clearInterval(timer);
      wipe();
      console.error(`실행하지 못했습니다: ${command}\n  ${error.message}`);
      done(1);
    });

    child.on("close", (code) => {
      if (timer) clearInterval(timer);
      wipe();
      const spent = Date.now() - at;
      if (spent >= 5_000) console.log(`  ↳ ${human(spent)} 소요`);

      if (watch && code === 0 && spent >= 5_000) {
        if (unit.name) seen[unit.name] = { funcs: unit.funcs, modules: unit.add + 1 };
        paceWrite(command, { ms: spent, units: { ...(past?.units ?? {}), ...seen } });
      }

      done(code ?? 1);
    });
  });
}

/** rustc 기록 한 행을 수치로 반영한다. */
function tally(unit, line) {
  unit.last = Date.now();
  if (line.includes("codegen_instance(")) {
    unit.funcs += 1;
    unit.phase = "codegen";
    return;
  }
  if (line.includes("adding bitcode from")) {
    unit.add += 1;
    unit.phase = "collect";
    return;
  }
  if (/::lto\s+linking\s+"/.test(line)) {
    unit.link += 1;
    unit.phase = "lto";
    return;
  }
}

/** 진행 행의 내용. 단계 · 크레이트 · 국면별 수치 · 경과와 예상. */
function status(step, unit, spent, past) {
  const bits = [];

  if (step) bits.push(step);
  if (unit.name) bits.push(unit.name);

  const work = detail(unit, past?.units?.[unit.name]);
  if (work) bits.push(work);

  if (past?.ms) {
    const pct = Math.min(99, Math.round((spent / past.ms) * 100));
    bits.push(`경과 ${human(spent)} / 예상 ${human(past.ms)} (${pct}%)`);
  } else {
    bits.push(`${human(spent)} 경과`);
  }

  return bits.join(" · ");
}

/** 국면별 수치. 전체 수를 아는 것은 분모까지 표시한다. */
function detail(unit, was) {
  // 결합 총수는 수집한 모듈에 기준 모듈 하나를 더한 값이다.
  const total = unit.add + 1;

  if (unit.phase === "lto") {
    return unit.link >= total ? "LTO 최적화·기계어 생성" : `LTO 모듈 ${count(unit.link)}/${count(total)}`;
  }
  if (unit.phase === "collect") return `LTO 모듈 수집 ${count(unit.add)}개`;
  if (unit.phase === "codegen") {
    // 함수 생성은 초반에 완료되며 나머지는 LLVM 최적화다. 기록이 중단되면
    // 동일 수치를 유지하지 않고 국면을 전환한다.
    if (Date.now() - unit.last > IDLE_MS) return `LLVM 최적화 · 함수 ${count(unit.funcs)}개`;
    return was?.funcs ? `함수 ${count(unit.funcs)}/${count(was.funcs)}` : `함수 ${count(unit.funcs)}개 생성`;
  }
  return "";
}

/** cargo 의 진행 막대는 `\r` 로 갱신된다. 줄바꿈과 함께 구분해야 값을 놓치지 않는다. */
function pipe(stream, onLine) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split(/\r\n|\r|\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (rest) onLine(rest);
  });
}

module.exports = { runStep, human };
