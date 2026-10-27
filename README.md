# webGBA

**한국어** · [English](README.en.md) · [日本語](README.ja.md)

GBA 롬(`.gba`·`.zip`)과 웹 빌드(`.wasm`·`.wgba`)를 여는 Windows 실행기입니다.
Tauri 2 + Rust 위에 웹뷰 화면을 얹었고, 구조는 아비터(Arbiter)를 따릅니다. 게임 실행(코어·키·소리)은
웹뷰가, 파일·창은 Rust 가 맡습니다. `.gba` 는 내장 mGBA 0.10.1 코어(wasm)로 돌리고, `.wasm`·`.wgba` 는
그 웹 빌드를 앱 안에서 그대로 실행합니다. **관리자 권한 없이** 일반 권한(`asInvoker`)으로 뜹니다.

> **롬과 BIOS 는 들어 있지 않습니다.** 직접 가진 롬 파일을 여세요. GBA 공식 BIOS 도 없으며 mGBA 내장 HLE BIOS 를 씁니다.

---

## 선행 설치 (먼저 갖춰야 하는 것)

이 프로젝트를 **빌드·실행**하려면 아래가 필요합니다. Windows 기준입니다.

1. **Node.js** (LTS 권장) — `npm` 이 함께 설치됩니다. 화면 조립(`src-bundle/build-dist.cjs`)과 Tauri CLI 에 씁니다.
2. **Rust 툴체인** — [rustup](https://rustup.rs) 으로 설치합니다(`stable`).
3. **Microsoft C++ Build Tools** — Visual Studio Installer 의 **"C++ 데스크톱 개발"** 워크로드(MSVC 링커, Windows SDK).
4. **Microsoft Edge WebView2 런타임** — Windows 11 에는 대개 기본 포함.
   없으면 [Microsoft 배포 페이지](https://developer.microsoft.com/microsoft-edge/webview2/)에서 "Evergreen Standalone Installer" 를 받습니다.
5. **Docker** — mGBA 코어를 다시 빌드할 때만 필요합니다(`emscripten/emsdk:4.0.10`).
   빌드된 코어(`src-bundle/bin/core/mgba_core.wasm`)가 저장소에 있어 앱 빌드에는 필요 없습니다.
6. **의존성 설치** — 저장소를 받은 뒤 한 번 실행합니다.

   ```bash
   npm install
   ```

> 빌드된 앱을 **쓰기만** 할 때는 위 항목이 필요 없습니다. `webgba.exe` 는 WebView2 런타임만 있으면 그대로 돕니다.

---

## 실행과 빌드

```bash
npm run dev       # 디버그 빌드 후 실행
npm run build     # tauri build → src-tauri/target/release/webgba.exe (+ 옆에 LICENSE · THIRD_PARTY_NOTICES · bin/core/)
npm start         # 릴리스 실행 파일 실행
npm run dist      # 화면 자산(dist/)만 다시 조립 — dev·build 가 먼저 실행합니다
npm run core      # mGBA wasm 코어 다시 빌드(도커)
npm test          # Rust 테스트(cargo test --lib)
node tools/run.cjs   # 전체 명령 목록
```

- 빌드 결과물은 `src-tauri/target/release/` 아래에 생깁니다. 설치본(NSIS)은 만들지 않습니다.
- **mGBA 소스는 저장소에 없습니다.** `npm run core` 가 도커 `emscripten/emsdk:4.0.10` 을 `--rm`·15분 제한으로 띄워 `core/build.sh` 를 돌리면,
  `core/build.sh` 가 공식 0.10.1 태그 소스를 받아(`core/vendor/mgba-0.10.1`, 저장소에 넣지 않음) 고치지 않고 묶고,
  결과(`mgba_core.wasm` + 라이선스)를 `src-bundle/bin/core/` 로 옮깁니다.
- VS Code 에서는 `webGBA.code-workspace` 를 열면 같은 명령이 작업(Tasks)으로 보입니다.

---

## 주요 기능

- **.gba · .zip** — 앱 `bin\core\mgba_core.wasm`(mGBA 0.10.1)로 실행. 화면 240x160(오른쪽 영역에 맞춤, 비율 유지. 설정에서 정수 배율), 소리, 키 설정, 게임패드,
  빨리 감기(2·3·4·8배), 일시정지, 재시작, 세이브(롬 옆 `<롬 이름>.sav`, VBA·mGBA 와 같은 형식),
  상태 저장 슬롯 1~9. `.zip` 은 안의 첫 `.gba`·`.agb`·`.bin` 을 꺼내 엽니다.
- **.wgba · .wasm** — .js 없이 파일 하나로도 엽니다(`.wgba` 는 내용이 wasm 이고 확장자만 다름).
  - `Web_*` 이름으로 화면·소리·세이브를 내보내는 빌드는 내장 호스트로 바로 실행합니다.
  - 512KB 같은 큰 세이브도 코어가 내놓는 크기 그대로 저장·불러옵니다(128KB 로 자르지 않음).
  - 페이지(`index.html` 등)가 있는 웹 빌드는 원래 페이지 그대로, 페이지 없이 emscripten `.js` 가 있으면 캔버스를 붙여 실행합니다.
  - 빌드마다 저장 공간(localStorage·IndexedDB·IDBFS)이 따로이고 앱을 다시 열어도 남습니다.
- **롬을 묶은 .wgba** — wasm 끝의 사용자 정의 구획(custom section) `webgba.rom` 에 롬을 넣어 두면, 옆에 `.gba` 가 없어도 그 롬으로 바로 엽니다
  (롬 찾기·고르기 없음, 상태 줄에 "내장 롬"). 묶기: `node tools/pack-wgba.mjs <빌드.wasm> <롬.gba> <출력.wgba>` — 롬을 zlib 으로 줄여 넣고 다시 읽어 SHA-1 까지 확인합니다.
  열 때도 SHA-1 을 확인해 다르면 열지 않고 알립니다. 사용자 정의 구획은 wasm 엔진이 무시하므로 묶은 파일도 그대로 올바른 wasm 입니다.
  **롬이 들어 있으므로 자기 PC 에서만 쓰고 나눠 주지 마세요.** 이 저장소와 릴리스에는 롬도, 롬을 묶은 `.wgba` 도 들어 있지 않습니다.
- **웹 빌드의 롬 고르기** — 설정 창 › 일반 › 파일 › **웹 빌드에 쓸 롬 파일 이름**. 적어 두면 `.wgba`·`.wasm` 과 같은 폴더(없으면 위 폴더)에서 그 이름의 롬을 씁니다.
  비워 두면(기본) `<빌드 이름>.gba` → 같은 폴더에 `.gba` 가 하나뿐이면 그것 순으로 찾고, 여럿이라 정할 수 없으면 처음 열 때 고르게 한 뒤 빌드마다 기억합니다.
  게임 메뉴 › 롬 지정… 으로 언제든 바꿀 수 있습니다. 롬을 묶은 `.wgba` 는 이 규칙을 쓰지 않고 안의 롬을 씁니다.
- **.wgba 파일 연결** — `.wgba` 를 탐색기에서 두 번 누르면 webGBA 로 열립니다. 관리자 권한 없이 사용자 범위(HKCU)에 연결합니다.
  연결 해제는 **설정 창 › 일반 › 파일** 에서 합니다.
- **세이브는 연 파일 옆 하나** — `.gba`·`.zip`·`.wgba`·`.wasm` 모두 연 파일 바로 옆 `<파일 이름>.sav` 하나를 읽고 씁니다(VBA 등 다른 실행기의 세이브를 그 이름으로 두면 그대로 이어집니다).
  게임이 저장하면 약 1초 뒤, 창을 닫거나 다른 게임을 열 때도 그 `.sav` 파일 자체를 직접 덮어씁니다. 백업 파일은 만들지 않습니다.
  쓰지 못하면(읽기 전용 등) 상태 줄에 알리고 다음 저장이나 닫을 때 다시 씁니다. 다른 세이브를 쓰려면 파일 메뉴 › 세이브 가져오기…(옆 `.sav` 를 그 내용으로 덮어씀), 꺼내려면 세이브 내보내기….
- **방향키 동시 누름** — 설정 창 › 일반 › 게임. 두 방향을 함께 눌렀을 때 게임에 넘길 방향을 고릅니다:
  **나중에 누른 방향만**(기본, 누르는 대로 바로 꺾음) · 반대쪽은 나중 것(←+→, ↑+↓ 만 정리) · 모두 넘기기(GBA 실기와 같음).
- **빨리 감기 소리** — 빨리 감기 중에도 배수만큼 빨라진 소리를 냅니다. 조용히 하려면 설정 창 › 일반 › 소리 › 빨리 감기 중 소리 끄기.
- **열기** — 열기 대화상자, 탐색기에서 끌어 놓기, 같은 폴더의 게임 목록(`.gba`·`.wgba`·`.wasm`, 앞뒤 게임으로 바로 넘기기),
  즐겨찾기, 최근 연 파일, 연결 프로그램 인자(이미 켜져 있으면 그 창에서 엶). 화면에는 경로 없이 파일 이름만 보입니다.
- **도구 막대** — 왼쪽 세로 막대. 접으면 게임 화면을 가리지 않고 그만큼 넓어지며, 접힘 상태를 기억합니다.
- **설정 창 (Ctrl+,)** — 일반·키·테마·언어 4쪽. 화면 맞춤·정수 배율, 음량·빨리 감기 배수, 방향키 동시 누름, 상태 슬롯, 세이브, 파일 연결·롬 이름, 즐겨찾기·최근 목록 비우기, 키 설정을 한 창에서 바꿉니다.
- **테마 13가지** — 아비터와 같은 테마 모음(어두운 7 · 밝은 5 · 사용자 지정). webGBA 화면 전체(도구 막대·목록·창·대화 상자)에 바로 적용되고, 게임 화면은 바꾸지 않습니다.
- **언어** — 한국어(기본)·English·日本語. 설정 창 › 언어에서 바꾸면 다시 켜지 않아도 바로 바뀌고 기억합니다.

---

## 단축키

| 동작 | 키 |
| --- | --- |
| GBA A / B | X · K / Z · J |
| GBA L / R | A / S |
| START / SELECT | Enter · 숫자패드 Enter / Backspace · 오른쪽 Shift |
| 방향 | 방향키 |
| 빨리 감기 (누르는 동안) | Space |
| 빨리 감기 켜고 끄기 | Tab |
| 일시정지 | Pause |
| 상태 저장 / 불러오기 | Shift+F1~F9 / F1~F9 |
| 다시 시작 | Ctrl+R |
| 열기 / 닫기 | Ctrl+O / Ctrl+W |
| 설정 창 | Ctrl+, |
| 즐겨찾기에 넣기·빼기 | Ctrl+D |
| 도구 막대 접기·펴기 | Ctrl+B |
| 같은 폴더의 이전 / 다음 게임 | Ctrl+PageUp / Ctrl+PageDown |
| 개발자 도구 (`setting.ini` 의 `useDevelopKit: true` 일 때) | Ctrl+Shift+I |

게임 키는 설정 창 › 키에서 바꿀 수 있고, 게임패드는 표준 배치로 자동 연결됩니다.

---

## 저장소 폴더 구조

```text
core/          mGBA wasm 코어 빌드 — build.sh(도커, mGBA 공식 소스를 받아 옴), src/ 래퍼(webgba_core.c · host_stubs.c)
src-bundle/    화면 — src/(html · css · js · icons · i18n), ini/(설정 씨앗), bin/core/(mgba_core.wasm · licenses/)
src-tauri/     Rust — 창 · 파일 · 세이브 · 웹 빌드 출처 · .wgba 연결
tools/         npm 명령(run.cjs · scripts.cjs), 코어 빌드, pack-wgba.mjs(롬을 .wgba 에 묶기), test/(시험 도구)
documents/     설계 문서
```

## 배포 후 폴더 구조

```text
webgba.exe
LICENSE                webGBA 라이선스(MIT)
THIRD_PARTY_NOTICES    포함된 오픈소스 고지
bin/
  core/     mgba_core.wasm, licenses/          실행에 쓰는 코어
  ini/      setting.ini, personalization.cfg   설정
  log/      2026-10-26.log                     기록
  state/    <롬 이름>.ss1 … .ss9                상태 저장
  web/      <빌드 이름>-<키>/state.ssN          웹 빌드 상태 저장
  webview/  웹뷰 데이터(웹 빌드 저장 공간)
```

- 없으면 처음 뜰 때 exe 안의 사본으로 만듭니다. exe 옆에 쓸 수 없으면 `%LOCALAPPDATA%\webGBA\bin` 을 씁니다.
- 세이브는 `bin` 이 아니라 연 파일 옆 `<파일 이름>.sav` 에 있습니다.
- `setting.ini` 는 창 크기·창이 가려질 때 멈추기·개발자 도구를 정합니다. 나머지 설정은 `personalization.cfg`(설정 창이 씀)에 있습니다.

---

## 라이선스

**webGBA 는 MIT, 포함된 mGBA 는 MPL-2.0** 입니다.

- webGBA 자체 코드(src-bundle, src-tauri, tools, core/src, core/build.sh)는 [MIT 라이선스](LICENSE)를 따릅니다. Copyright © 2026 flightrabbit.
- 함께 묶는 mGBA 0.10.1 과 그 결과물(`mgba_core.wasm`)은 MIT 가 아니라 **MPL-2.0** 그대로입니다. mGBA 소스는 고치지 않았고 저장소에도 넣지 않았습니다.
  소스: https://github.com/mgba-emu/mgba/tree/0.10.1 · 전문: `src-bundle/bin/core/licenses/`(배포본은 `bin/core/licenses/`)
- 포함된 오픈소스 전체 고지는 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) 에 있습니다(앱의 도움말 › 정보에도 같은 내용).
- 롬과 GBA 공식 BIOS 는 들어 있지 않습니다(mGBA 내장 HLE BIOS 사용). 앱 아이콘은 아비터와 같은 그림입니다.

### 포함된 오픈소스

| 구성요소 | 용도 | 라이선스 |
| --- | --- | --- |
| mGBA 0.10.1 (blip_buf, inih 포함) | GBA 코어 | MPL-2.0 (LGPL-2.1, BSD-3-Clause) |
| Tauri 2 · WRY · TAO | 앱 뼈대 · 웹뷰 · 창 | Apache-2.0 OR MIT |
| Microsoft Edge WebView2 | 화면 런타임 | Microsoft 배포 조건 |
| windows-rs · zip | Win32 API · .zip 롬 | MIT OR Apache-2.0 · MIT |
| Tabler Icons | 아이콘 | MIT |

mGBA — Copyright (c) 2013-2022 Jeffrey Pfau 외 기여자 · https://mgba.io

---

Copyright © 2026 flightrabbit
