// 내장 호스트(src-bundle/src/js/core/web-host.js)로 .wasm 하나만 돌려 본다. 앱과 같은 코드다.
//   node tools/test/host-smoke.mjs <코어.wasm> <롬> <출력 폴더> [이름표] [--save-cycle]
//   <롬> 자리에 embedded 를 주면 wasm 안 롬 구획(webgba.rom, tools/pack-wgba.mjs)을 풀어 쓴다.
// 1500프레임(타이틀) → 캡처. --save-cycle 이면 Web_DebugSave(포트)로 세이브를 쓰게 한 뒤 그 세이브로 다시 켜서
// 타이틀 → START → 메뉴 캡처(이어서 하기가 보이면 세이브가 돌아온 것).
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

import { bootHost, inspectModule, readEmbeddedRom } from "../../src-bundle/src/js/core/web-host.js";

const require = createRequire(import.meta.url);
const { encode } = require("./png.cjs");

const args = process.argv.slice(2);
const [wasmPath, romPath, outDir, tag = "host"] = args.filter((a) => !a.startsWith("--"));
const saveCycle = args.includes("--save-cycle");
if (!wasmPath || !romPath || !outDir) {
  console.error("사용법: node tools/test/host-smoke.mjs <코어.wasm> <롬> <출력 폴더> [이름표] [--save-cycle]");
  process.exit(2);
}
void fileURLToPath;

const KEY = { A: 1, START: 8 };

function shot(host, name) {
  const px = Buffer.from(host.framebuffer());
  fs.writeFileSync(path.join(outDir, `${tag}_${name}.png`), encode(px, 240, 160));
  const colors = new Set();
  for (let i = 0; i < px.length; i += 4 * 37) colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
  return colors.size;
}

function run(host, n, keys = 0, stats = null) {
  for (let i = 0; i < n; i++) {
    if (!host.runFrame(keys)) throw new Error(`멈춤: ${host.halted}`);
    const audio = host.audio();
    if (stats && audio) {
      stats.samples += audio.length / 2;
      for (let s = 0; s < audio.length; s += 16) if (audio[s] !== 0) stats.nonZero++;
    }
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const module = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const report = inspectModule(module);
  console.log(`검사: 내장 호스트 ${report.usable ? "가능" : "불가"} · 모르는 가져오기 ${report.unknown.length} · 빠진 내보내기 ${report.missing.length} · 상태 저장 ${report.canState}`);
  if (!report.usable) {
    console.log(report);
    process.exit(1);
  }
  let rom;
  if (romPath === "embedded") {
    const t0 = Date.now();
    const found = await readEmbeddedRom(module);
    if (!found) throw new Error("롬 구획(webgba.rom)이 없습니다");
    rom = found.rom;
    console.log(`내장 롬 ${rom.length}바이트(묶음 ${found.packed}) · SHA-1 ${found.sha1} · 풀기·확인 ${Date.now() - t0}ms`);
  } else {
    rom = new Uint8Array(fs.readFileSync(romPath));
  }
  const logs = [];
  const { host } = await bootHost({ module, rom, save: null, log: (level, line) => logs.push(`${level} ${line}`) });
  host.setAudioRate(48000);
  console.log(`메모리 ${(host.ex.memory.buffer.byteLength / 1048576).toFixed(0)}MB · 제목 ${host.title || "-"}`);

  const stats = { samples: 0, nonZero: 0 };
  const t0 = Date.now();
  run(host, 1500, 0, stats);
  const ms = Date.now() - t0;
  console.log(`1500프레임 ${ms}ms · 화면 색 수 ${shot(host, "title")} · 소리 표본 ${stats.samples}(프레임당 ${(stats.samples / 1500).toFixed(1)}) · 0 아닌 표본 ${stats.nonZero}`);

  if (host.canState) {
    const state = host.stateSave();
    run(host, 1);
    const expected = Buffer.from(host.framebuffer());
    run(host, 120, KEY.START);
    run(host, 60);
    const ok = host.stateLoad(state);
    run(host, 1);
    console.log(`상태 ${state.length}바이트 · 불러오기 ${ok} · 같은 화면 ${Buffer.from(host.framebuffer()).equals(expected)}`);
  }

  if (saveCycle) {
    if (!host.ex.Web_DebugSave) throw new Error("Web_DebugSave 가 없습니다");
    host.takeSaveDirty();
    const result = host.ex.Web_DebugSave();
    run(host, 2);
    const dirty = host.takeSaveDirty();
    const save = host.saveData();
    const savePath = path.join(outDir, `${tag}.sav`);
    fs.writeFileSync(savePath, save);
    console.log(`세이브 쓰기 결과 ${result} · 바뀜 표시 ${dirty} · ${save.length}바이트 → ${savePath}`);

    const again = await bootHost({ module, rom, save: new Uint8Array(fs.readFileSync(savePath)), log: () => {} });
    console.log(`다시 켬: 세이브 불러옴 ${again.hadSave}`);
    run(again.host, 1500);
    for (let i = 0; i < 3; i++) {
      run(again.host, 10, KEY.START);
      run(again.host, 150);
    }
    console.log(`메뉴 화면 색 수 ${shot(again.host, "menu_after_reload")}`);
  }

  if (logs.length) console.log(`코어 출력 ${logs.length}줄 (앞 3줄)\n  ${logs.slice(0, 3).join("\n  ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
