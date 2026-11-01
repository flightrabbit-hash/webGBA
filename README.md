# webGBA

**한국어** · [English](README.en.md) · [日本語](README.ja.md)

GBA 롬(`.gba`·`.zip`)과 웹 빌드(`.wasm`·`.wgba`)를 실행하는 Windows 실행기입니다.
Tauri 2 + Rust 기반에 WebView 화면을 구성했고, 구조는 아비터(Arbiter)와 같습니다. 게임 실행(코어·키·소리)은
WebView가, 파일·창은 Rust가 담당합니다. `.gba`는 내장 mGBA 0.10.1 코어(wasm)로 실행하고, `.wasm`·`.wgba`는
해당 웹 빌드를 앱 안에서 그대로 실행합니다. **관리자 권한 없이** 일반 권한(`asInvoker`)으로 실행됩니다.

> **롬과 BIOS는 포함되어 있지 않습니다.** 소유한 롬 파일을 여세요. GBA 공식 BIOS도 포함되어 있지 않으며 mGBA 내장 HLE BIOS를 사용합니다.

**웹 버전:** https://webgba.vercel.app — 휴대폰·PC 브라우저용 설치형 웹 앱(PWA)입니다(`.gba`·`.zip`·`.wgba`·`.wasm`·`.wgbp`).
브라우저 탭으로 열면 설치 안내가 표시됩니다. 홈 화면에 추가하거나 앱으로 설치한 후 해당 아이콘으로 열면 실행됩니다. 선택한 파일과 세이브는 해당 브라우저 안에만 저장됩니다.

---

## 목차

- [선행 설치](#선행-설치)
- [실행과 빌드](#실행과-빌드)
- [주요 기능](#주요-기능)
- [단축키](#단축키)
- [저장소 폴더 구조](#저장소-폴더-구조) · [배포 후 폴더 구조](#배포-후-폴더-구조)
- [라이선스](#라이선스)
- [.wgba 규격 1 (다른 개발자용)](#wgba-규격-1-다른-개발자용) — 다른 개발자가 자신의 wasm 게임을 `.wgba`로 패키징할 때 보는 규격 전문
- [AI 전용 프롬프트](#ai-전용-프롬프트) — AI에 붙여 넣으면 이 규격대로 `.wgba`를 생성

---

## 선행 설치

이 프로젝트를 **빌드·실행**하려면 아래 항목이 필요합니다. Windows 기준입니다.

1. **Node.js** (LTS 권장) — `npm`이 함께 설치됩니다. 화면 조립(`src-bundle/build-dist.cjs`)과 Tauri CLI에 사용합니다.
2. **Rust 툴체인** — [rustup](https://rustup.rs)으로 설치합니다(`stable`).
3. **Microsoft C++ Build Tools** — Visual Studio Installer의 **"C++ 데스크톱 개발"** 워크로드(MSVC 링커, Windows SDK).
4. **Microsoft Edge WebView2 런타임** — Windows 11에는 대부분 기본 포함.
   설치되어 있지 않으면 [Microsoft 배포 페이지](https://developer.microsoft.com/microsoft-edge/webview2/)에서 "Evergreen Standalone Installer"를 다운로드합니다.
5. **Docker** — mGBA 코어 재빌드 시에만 필요합니다(`emscripten/emsdk:4.0.10`).
   빌드된 코어(`src-bundle/bin/core/mgba_core.wasm`)가 저장소에 포함되어 있어 앱 빌드에는 필요하지 않습니다.
6. **의존성 설치** — 저장소를 다운로드한 후 한 번 실행합니다.

   ```bash
   npm install
   ```

> 빌드된 앱을 **사용만** 할 때는 위 항목이 필요하지 않습니다. `webgba.exe`는 WebView2 런타임만 있으면 실행됩니다.

---

## 실행과 빌드

```bash
npm run dev       # 디버그 빌드 후 실행
npm run build     # tauri build → src-tauri/target/release/webgba.exe (+ 옆에 LICENSE · THIRD_PARTY_NOTICES · bin/core/)
npm start         # 릴리스 실행 파일 실행
npm run dist      # 화면 자산(dist/)만 다시 조립 — dev·build가 먼저 실행합니다
npm run core      # mGBA wasm 코어 재빌드(Docker)
npm test          # Rust 테스트(cargo test --lib)
node tools/run.cjs   # 전체 명령 목록
```

- 빌드 결과물은 `src-tauri/target/release/` 하위에 생성됩니다. 설치본(NSIS)은 생성하지 않습니다.
- **mGBA 소스는 저장소에 포함되어 있지 않습니다.** `npm run core`는 Docker `emscripten/emsdk:4.0.10` 컨테이너(`--rm`, 15분 제한)에서 `core/build.sh`를 실행합니다.
  `core/build.sh`는 공식 0.10.1 태그 소스를 다운로드하고(`core/vendor/mgba-0.10.1`, 저장소 미포함) 수정 없이 빌드한 후,
  결과(`mgba_core.wasm` + 라이선스)를 `src-bundle/bin/core/`로 이동합니다.
- VS Code에서 `webGBA.code-workspace`를 열면 같은 명령이 Tasks로 표시됩니다.

---

## 주요 기능

- **.gba · .zip** — 앱 `bin\core\mgba_core.wasm`(mGBA 0.10.1)로 실행. 화면 240x160(우측 영역에 맞춤, 비율 유지. 설정에서 정수 배율), 소리, 키 설정, 게임패드,
  빨리 감기(2·3·4·8배), 일시정지, 재시작, 세이브(롬 옆 `<롬 파일명>.sav`, VBA·mGBA와 같은 형식),
  상태 저장 슬롯 1~9. `.zip`은 내부의 첫 `.gba`·`.agb`·`.bin`을 추출해 엽니다.
- **.wgba · .wasm** — .js 없이 파일 한 개로도 엽니다(`.wgba`는 내용이 wasm이고 확장자만 다름).
  - 화면·소리·세이브를 `Web_*` 함수로 내보내는 빌드는 내장 호스트로 실행합니다.
  - 512KB 등 큰 세이브도 코어가 반환하는 크기 그대로 저장하고 불러옵니다(128KB로 자르지 않음).
  - 페이지(`index.html` 등)가 있는 웹 빌드는 해당 페이지 그대로, 페이지 없이 emscripten `.js`가 있으면 캔버스를 추가해 실행합니다.
  - 저장 공간(localStorage·IndexedDB·IDBFS)은 각 빌드별로 분리되고, 앱 재시작 후에도 유지됩니다.
- **롬 포함 .wgba** — wasm 끝의 custom section `webgba.rom`에 롬을 저장하면, 옆에 `.gba`가 없어도 해당 롬으로 엽니다
  (롬 검색·선택 없음, 상태 줄에 "내장 롬" 표시). 패키징: `node tools/pack-wgba.mjs <빌드.wasm> <롬.gba> <출력.wgba>` — 롬을 zlib으로 압축해 저장한 후 다시 조회해 SHA-1까지 확인합니다.
  열 때도 SHA-1을 확인하고, 다르면 열지 않고 안내합니다. custom section은 wasm 엔진이 무시하므로 패키징한 파일도 올바른 wasm입니다.
  **롬이 포함되어 있으므로 본인 PC에서만 사용하고 배포하지 마세요.** 이 저장소와 릴리스에는 롬도, 롬 포함 `.wgba`도 포함되어 있지 않습니다.
- **롬 없는 공유용 패치 .wgbp** — 배포 가능한 파일입니다. 열면 소유한 롬을 한 번 선택하게 하고, 같은 폴더에 롬 포함 `<파일명>.wgba`를 생성해 엽니다
  (이후에는 해당 `.wgba`를 엽니다). 롬은 SHA-1로 확인하고, 맞지 않으면 이유(이미 패치된 롬·다른 버전·다른 언어 버전·다른 게임 등)를 안내합니다. `.wgbp`와 롬을 함께 Drag & Drop하면 선택 없이 생성합니다.
  생성: `node tools/make-wgbp.mjs <빌드.wasm|.wgba> <결과 롬> <출력.wgbp> --base <원래 롬> [--label 이름] …` — 원래 롬 → 결과 롬 BPS 패치를 저장하고, wasm 안에서 원래 롬과 같은 구간은 비워 둔 후
  생성 시 사용자의 롬으로 채웁니다. 생성 후 지원하는 모든 롬으로 결과가 `pack-wgba`로 패키징한 파일과 바이트 단위까지 같은지 확인합니다. `.wgba` 압축은 앱과 도구가 같은 pako를 사용해 어느 PC에서나 같은 바이트입니다.
- **웹 빌드의 롬 선택** — 설정 창 › 일반 › 파일 › **웹 빌드에 쓸 롬 파일 이름**. 입력하면 `.wgba`·`.wasm`과 같은 폴더(없으면 상위 폴더)에서 해당 파일명의 롬을 사용합니다.
  비워 두면(기본) `<빌드 이름>.gba` → 같은 폴더의 유일한 `.gba` 순서로 검색하고, 여러 개라 결정할 수 없으면 처음 열 때 선택하게 한 후 각 빌드별로 기억합니다.
  게임 메뉴 › 롬 지정…으로 언제든 변경할 수 있습니다. 롬 포함 `.wgba`는 이 규칙을 사용하지 않고 내부의 롬을 사용합니다.
- **.wgba · .wgbp 파일 연결** — 탐색기에서 `.wgba`·`.wgbp`를 더블클릭하면 webGBA로 열립니다. 관리자 권한 없이 사용자 범위(HKCU)에 등록합니다.
  연결 해제는 **설정 창 › 일반 › 파일**에서 합니다.
- **세이브는 연 파일 옆 한 개** — `.gba`·`.zip`·`.wgba`·`.wasm` 모두 연 파일 옆 `<파일명>.sav` 한 개를 조회·기록합니다(VBA 등 다른 실행기의 세이브를 같은 파일명으로 두면 그대로 이어집니다).
  게임이 저장하면 약 1초 후, 창을 닫거나 다른 게임을 열 때도 해당 `.sav` 파일을 직접 Overwrite합니다. 백업 파일은 생성하지 않습니다.
  기록에 실패하면(읽기 전용 등) 상태 줄에 안내하고 다음 저장이나 닫을 때 다시 기록합니다. 다른 세이브를 사용하려면 파일 메뉴 › 세이브 가져오기…(옆 `.sav`를 가져온 파일 내용으로 Overwrite), 내보내려면 세이브 내보내기….
- **방향키 동시 누름** — 설정 창 › 일반 › 게임. 두 방향을 동시에 눌렀을 때 게임에 전달할 방향을 선택합니다:
  **나중에 누른 방향만**(기본, 누르는 즉시 방향 전환) · 반대쪽은 나중 것(←+→, ↑+↓만 정리) · 모두 넘기기(GBA 실기와 같음).
- **빨리 감기 소리** — 빨리 감기 중에도 배수만큼 빨라진 소리를 출력합니다. 소리를 끄려면 설정 창 › 일반 › 소리 › 빨리 감기 중 소리 끄기.
- **열기** — 열기 대화상자, 탐색기에서 Drag & Drop, 같은 폴더의 게임 목록(`.gba`·`.wgba`·`.wasm`, 이전·다음 게임으로 이동),
  즐겨찾기, 최근 연 파일, 연결 프로그램 인자(이미 실행 중이면 해당 창에서 열기). 화면에는 경로 없이 파일명만 표시됩니다.
- **도구 막대** — 좌측 세로 막대. 접으면 게임 화면을 가리지 않고 접은 만큼 넓어지며, 접힘 상태를 기억합니다.
- **설정 창 (Ctrl+,)** — 일반·키·테마·언어 4개 탭. 화면 맞춤·정수 배율, 음량·빨리 감기 배수, 방향키 동시 누름, 상태 슬롯, 세이브, 파일 연결·롬 파일명, 즐겨찾기·최근 목록 비우기, 키 설정을 한 개의 창에서 변경합니다.
- **테마 13개** — 아비터와 같은 테마(어두운 테마 7·밝은 테마 5·사용자 지정). webGBA 화면 전체(도구 막대·목록·창·대화 상자)에 즉시 적용되고, 게임 화면은 변경하지 않습니다.
- **언어** — 한국어(기본)·English·日本語. 설정 창 › 언어에서 변경하면 재시작 없이 즉시 적용되고 기억합니다.

---

## 단축키

| 동작 | 키 |
| --- | --- |
| GBA A / B | Z · K / X · J |
| GBA L / R | A / S |
| START / SELECT | Enter · 숫자패드 Enter / Backspace · 우측 Shift |
| 방향 | 방향키 |
| 빨리 감기 (누르는 동안) | Space |
| 빨리 감기 켜기·끄기 | Tab |
| 일시정지 | Pause |
| 상태 저장 / 불러오기 | Shift+F1~F9 / F1~F9 |
| 다시 시작 | Ctrl+R |
| 열기 / 닫기 | Ctrl+O / Ctrl+W |
| 설정 창 | Ctrl+, |
| 즐겨찾기 추가·삭제 | Ctrl+D |
| 도구 막대 접기·펴기 | Ctrl+B |
| 같은 폴더의 이전 / 다음 게임 | Ctrl+PageUp / Ctrl+PageDown |
| 개발자 도구 (`setting.ini`의 `useDevelopKit: true`일 때) | Ctrl+Shift+I |

게임 키는 설정 창 › 키에서 변경할 수 있고, 게임패드는 표준 배치로 자동 연결됩니다.

---

## 저장소 폴더 구조

```text
core/          mGBA wasm 코어 빌드 — build.sh(Docker, mGBA 공식 소스 다운로드), src/ 래퍼(webgba_core.c · host_stubs.c)
src-bundle/    화면 — src/(html · css · js · icons · i18n), ini/(설정 기본 파일), bin/core/(mgba_core.wasm · licenses/)
src-tauri/     Rust — 창 · 파일 · 세이브 · 웹 빌드 출처 · .wgba 연결
tools/         npm 명령(run.cjs · scripts.cjs), 코어 빌드, wgba.mjs(.wgba 규격 패키징·검사), pack-wgba.mjs(롬 포함 .wgba 패키징), make-wgbp.mjs(롬 없는 .wgbp 생성), lib/, test/(테스트 도구)
docs/wgba/     manifest 스키마 · 예제(.wgba 규격 본문은 이 README 아래)
documents/     설계 문서
```

## 배포 후 폴더 구조

```text
webgba.exe
LICENSE                webGBA 라이선스(MIT)
THIRD_PARTY_NOTICES    포함된 오픈소스 고지
bin/
  core/     mgba_core.wasm, licenses/          실행용 코어
  ini/      setting.ini, personalization.cfg   설정
  log/      2026-10-26.log                     로그
  state/    <롬 파일명>.ss1 … .ss9              상태 저장
  web/      <빌드 이름>-<키>/state.ssN          웹 빌드 상태 저장
  webview/  WebView 데이터(웹 빌드 저장 공간)
```

- 존재하지 않으면 처음 실행할 때 exe 안의 사본으로 생성합니다. exe 옆에 기록할 수 없으면 `%LOCALAPPDATA%\webGBA\bin`을 사용합니다.
- 세이브는 `bin`이 아니라 연 파일 옆 `<파일명>.sav`에 있습니다.
- `setting.ini`는 창 크기·창이 가려질 때 일시정지·개발자 도구를 설정합니다. 나머지 설정은 `personalization.cfg`(설정 창이 기록)에 있습니다.

---

## 라이선스

**webGBA는 MIT, 포함된 mGBA는 MPL-2.0**입니다.

- webGBA 자체 코드(src-bundle, src-tauri, tools, core/src, core/build.sh)는 [MIT 라이선스](LICENSE)를 따릅니다. Copyright © 2026 flightrabbit.
- 함께 빌드하는 mGBA 0.10.1과 해당 결과물(`mgba_core.wasm`)은 MIT가 아니라 **MPL-2.0** 그대로입니다. mGBA 소스는 수정하지 않았고 저장소에도 포함하지 않았습니다.
  소스: https://github.com/mgba-emu/mgba/tree/0.10.1 · 전문: `src-bundle/bin/core/licenses/`(배포본은 `bin/core/licenses/`)
- 포함된 오픈소스 전체 고지는 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)에 있습니다(앱의 도움말 › 정보에도 같은 내용).
- 롬과 GBA 공식 BIOS는 포함되어 있지 않습니다(mGBA 내장 HLE BIOS 사용). 앱 아이콘은 flightrabbit이 제공한 게임기 픽셀 그림입니다.

### 포함된 오픈소스

| 구성요소 | 용도 | 라이선스 |
| --- | --- | --- |
| mGBA 0.10.1 (blip_buf, inih 포함) | GBA 코어 | MPL-2.0 (LGPL-2.1, BSD-3-Clause) |
| Tauri 2 · WRY · TAO | 앱 프레임워크 · WebView · 창 | Apache-2.0 OR MIT |
| Microsoft Edge WebView2 | 화면 런타임 | Microsoft 배포 조건 |
| windows-rs · zip | Win32 API · .zip 롬 | MIT OR Apache-2.0 · MIT |
| Tabler Icons | 아이콘 | MIT |
| pako 2.1.0 | .wgba 롬 압축 · .wgbp | MIT AND Zlib |

mGBA — Copyright (c) 2013-2022 Jeffrey Pfau 외 기여자 · https://mgba.io

---

Copyright © 2026 flightrabbit

---

## .wgba 규격 1 (다른 개발자용)

`.wgba`는 webGBA가 여는 한 개의 게임 파일입니다. **파일 전체가 올바른 WebAssembly(wasm) 모듈**이고, 내부의
custom section에 manifest·롬팩 그림·JS·데이터를 저장하며, 맨 앞의 **TOC**에 각 chunk의 시작·끝 오프셋과
해시를 기록합니다. GBA 게임이 아니어도 됩니다 — wasm으로 빌드한 게임이면 `.wgba`로 패키징해 webGBA(Windows 앱·웹 버전)에서
실행할 수 있습니다.

> 7장 멀티플레이는 초안이고, 현재 webGBA는 멀티플레이 연결을 지원하지 않습니다. 나머지 장은 현재 webGBA의 동작과 같습니다.
> 아래 내용 중 "현재 webGBA"로 기재한 부분은 규격이 아니라 현재 앱의 동작입니다(다른 호스트는 달라도 됨).

1. [개요](#1-개요)
2. [파일 구조](#2-파일-구조)
3. [manifest](#3-manifest)
4. [실행 방식](#4-실행-방식) — ① Web API(JS 없음) · ② 자체 JS(격리 실행)
5. [키 매핑](#5-키-매핑)
6. [롬팩 그림](#6-롬팩-그림) — 라벨 · 앞면 · 옆면
7. [멀티플레이](#7-멀티플레이) (초안)
8. [보안 규칙](#8-보안-규칙)
9. [생성 예시](#9-생성-예시)
10. [검증](#10-검증)
11. [형식 번호와 버전](#11-형식-번호와-버전)
12. [AI 전용 프롬프트](#ai-전용-프롬프트) — README 맨 아래

---

### 1. 개요

| 목적 | 실행 방식 |
| --- | --- |
| C·C++·Rust 등으로 제작한 게임을 JS 없이 wasm 한 개로(화면·소리·입력·세이브는 webGBA가 담당) | **① Web API** (`runtime: "webapi"`) |
| emscripten·직접 작성한 JS 등 **자체 JS가 있는** wasm 게임 | **② 자체 JS** (`runtime: "script"`) — JS는 격리된 틀 안에서만 실행 |

- `.wgba` 한 개에 게임에 필요한 데이터가 모두 포함되어 있어 옆에 다른 파일이 없어도 열립니다.
- 파일 자체가 wasm이라 `WebAssembly.validate()`를 통과하고, wasm 도구(`wasm-objdump -h` 등)로 내용을 확인할 수 있습니다.
- 가장 빠른 시작: [9.1](#91-예제-패키징)의 예제 `docs/wgba/examples/hello-webapi/`를 명령 두 행으로 패키징해 webGBA로 열어 보세요.
- **롬·게임 데이터는 권리를 가진 것만 포함하세요.** 타인의 롬·그림·음악이 포함된 `.wgba`를 배포하지 마세요. webGBA는 롬을 제공하지 않습니다.

용어: **chunk** = TOC에 기재된 데이터 단위(manifest·롬팩 그림·JS·code·데이터·롬). **호스트** = webGBA(파일을 여는 쪽).
**틀** = ② 게임이 실행되는 격리된 iframe. **퀵슬롯** = 상태 저장(해당 시점 전체를 저장·불러오기).

---

### 2. 파일 구조

```text
 오프셋 0 ┌────────────────────────────────────────────────────┐
          │ wasm 헤더 8바이트   00 61 73 6D 01 00 00 00        │
        8 ├────────────────────────────────────────────────────┤
          │ section webgba.toc         TOC (첫 section, 필수)  │
          │ section webgba.manifest    manifest JSON (필수)    │
          │ section webgba.cart.label  롬팩 라벨 그림 (선택)   │
          │ section webgba.cart.front  롬팩 앞면 그림 (선택)   │
          │ section webgba.cart.spine  롬팩 옆면 그림 (선택)   │
          │ section webgba.js          게임 JS (②만)          │
          ├────────────────────────────────────────────────────┤ ← chunk "code" 시작
          │ 원래 wasm section (type·import·…·code·data)        │
          │ (원래 custom section name·producers 등도 포함)     │
          ├────────────────────────────────────────────────────┤ ← chunk "code" 끝
          │ section webgba.data.<이름> 데이터 (선택, 여러 개)  │
          │ section webgba.rom         롬 (선택, 있으면 맨 끝) │
          └────────────────────────────────────────────────────┘
```

- 앞부분(TOC·manifest·롬팩 그림)은 크기가 작아 **라이브러리 목록은 파일 앞 몇 KB만 조회해** 표시합니다. 큰 데이터·롬은 뒤에 배치합니다.
- 호스트는 chunk "code" 구간만 추출해(앞에 wasm 헤더 8바이트 추가) 컴파일합니다. 따라서 롬·그림이 wasm 엔진 메모리에 로드되지 않습니다.
- wasm custom section = `00` + section 길이(LEB128) + 이름 길이(LEB128) + 이름(UTF-8) + 내용입니다. wasm 엔진은 custom section을 무시합니다.

#### 2.1 TOC `webgba.toc`

**파일의 첫 section**이어야 합니다(오프셋 8). 내용은 little endian, 고정 길이입니다.

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4 | `WGTC` |
| 4 | 1 | TOC 형식 major 번호 `1`(모르는 값이면 열지 않음) |
| 5 | 1 | TOC 형식 minor 번호 `0`(값이 높아도 열기) |
| 6 | 2 | 헤더 길이 `16`(조회 측은 이 값만큼 건너뜀) |
| 8 | 2 | 항목 길이 `80`(조회 측은 이 값 간격으로 조회) |
| 10 | 2 | 항목 수(256 이하) |
| 12 | 4 | 파일 전체 길이(잘린 파일·뒤에 데이터가 추가된 파일 감지) |
| 16 | 80×n | 항목(파일 안 순서대로) |

항목 한 개(80바이트):

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 32 | chunk 이름(ASCII, 남는 바이트 0). 규칙 `[a-z0-9][a-z0-9._-]{0,31}` |
| 32 | 4 | **시작** 오프셋 — 파일 처음 기준, chunk 내용의 첫 바이트 |
| 36 | 4 | **끝** 오프셋 — 내용 마지막 바이트의 다음(끝 − 시작 = 저장 길이) |
| 40 | 4 | 압축 해제 크기(방식 0이면 저장 길이와 같음) |
| 44 | 1 | 방식: `0` 무압축, `1` zlib(RFC 1950) |
| 45 | 1 | 종류: `0` code · `1` manifest · `2` cart(롬팩 그림) · `3` js · `4` rom · `5` data |
| 46 | 2 | flag: 비트 0 = 필수(이 종류를 모르는 호스트는 열지 않음). 나머지 0. 패키징 도구는 manifest·code·js·rom에 1, cart·data에 0 |
| 48 | 32 | 저장된 바이트(시작~끝)의 SHA-256 |

- 이름과 section: chunk `manifest`는 section `webgba.manifest`의 내용, `data.levels`는 `webgba.data.levels`처럼 **section 이름 = `webgba.` + chunk 이름**입니다. 시작 오프셋 = 해당 section 내용(이름 뒤)의 첫 바이트입니다.
- chunk `code`만 section이 아니라 **원래 wasm section이 이어진 구간**입니다(첫 원래 section의 id 바이트부터 마지막 원래 section 끝까지). 이 구간 안에 `webgba.*` section이 있으면 안 됩니다.
- 개수: `manifest`·`code`는 반드시 한 개, `cart.label`·`cart.front`·`cart.spine`·`js`·`rom`은 최대 한 개. `data.*`는 64개까지, 이름은 `data.` 뒤 27자까지.
- 순서: TOC → `manifest`·`cart.*`·`js` → `code` → `data.*` → `rom`.
- TOC에 없는 `webgba.*` section은 무시합니다(검사 경고).
- `rom`이 있으면 **파일 맨 끝 section**이어야 합니다(롬 section을 제거하고 다시 추가하는 레거시 도구와 바이트 단위까지 같게 하기 위함).
- TOC 자체의 길이는 항목 수로만 결정되므로, 패키징 도구는 TOC 길이를 먼저 계산한 후 오프셋을 순서대로 결정하면 됩니다(반복 계산 없음).

#### 2.2 롬 chunk `webgba.rom`

① 게임에 포함하는 롬(호스트가 게임 메모리에 배치하는 큰 데이터)입니다. TOC 방식은 `0`(무압축)이고, 내용은 아래 헤더 + 롬입니다.
(TOC 도입 전부터 사용하던 형식이라 그대로 유지합니다.)

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4 | `WGRM` |
| 4 | 2 | 헤더 길이 `36` |
| 6 | 1 | 형식 `1` |
| 7 | 1 | `0` 무압축 · `1` zlib |
| 8 | 4 | 롬 크기(32MB 이하) |
| 12 | 4 | 저장 크기 |
| 16 | 20 | 롬 SHA-1 |
| 36 | … | 저장된 롬 |

#### 2.3 크기 상한

| 대상 | 상한 | 초과 시 |
| --- | --- | --- |
| 파일 전체 | 512MB(휴대폰은 64MB 이하 권장) | 열지 않음 |
| manifest | 64KB(압축 해제 기준) | 열지 않음 |
| 롬팩 그림(각각) | 256KB(64KB 이하 권장) | 해당 그림만 기본 모양 |
| JS | 16MB(압축 해제 기준) | 패키징하지 않음 |
| 롬 | 32MB(압축 해제 기준) | 열지 않음 |
| 세이브 | ① `Web_GetSaveSize`(없으면 128KB) · ② `save.maxSize`(기본 1MB, 16MB까지) | 저장하지 않음 |

호스트는 압축 해제 중 TOC의 "압축 해제 크기"를 넘는 즉시 중단합니다(압축 폭탄 차단).

---

### 3. manifest

chunk `manifest`는 UTF-8 JSON 객체 한 개입니다(BOM 없음, 64KB 이하). 필드 이름은 lowerCamelCase입니다.
**모르는 필드는 무시합니다.** `x-`로 시작하는 필드는 제작자가 자유롭게 사용하는 필드입니다(호스트는 조회하지 않음).
검사용 JSON 스키마: [wgba-manifest.schema.json](docs/wgba/wgba-manifest.schema.json).

#### 3.1 필수 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `wgba` | 정수 | manifest 규격 번호. 현재 `1` |
| `id` | 문자열 | **게임 id — 변경하지 않는 값.** 소문자 역도메인(`io.github.someone.mygame`), 점 1개 이상, 64자 이하. 웹 버전은 세이브·퀵슬롯을, Windows 앱은 게임별 키 설정을 이 id 기준으로 관리합니다(Windows 앱의 세이브는 연 파일 옆 `<파일명>.sav`). 새 버전에서도 같은 id를 사용하세요 |
| `version` | 문자열 | **게임 버전**, 유의적 버전 `x.y.z`(예 `1.2.0`, 테스트 버전 `1.3.0-beta.1`도 가능, `+` 접미사는 지원하지 않음). 콘텐츠가 변경될 때 올립니다 |
| `name` | 문자열 또는 객체 | 게임 이름(48자 이하). 언어별 `{"en": "…", "ko": "…", "ja": "…"}`도 가능. 호스트는 사용자 언어 → `en` → 첫 값 순서로 선택 |
| `runtime` | 문자열 | `"webapi"`(①) 또는 `"script"`(②) |

#### 3.2 선택 필드

| 필드 | 타입·기본값 | 설명 |
| --- | --- | --- |
| `shortName` | 문자열·객체 | 롬팩 옆면 이름, 라벨 그림이 없을 때 라벨에 사용하는 짧은 이름(16자 이하 권장). 없으면 `name` |
| `description` | 문자열·객체 | 소개(500자 이하) |
| `author` | 문자열 | 제작자. 정보 화면에 표시 |
| `license` · `homepage` · `contact` | 문자열 | 라이선스(SPDX 이름 권장 `MIT`), `https://` 주소(다른 주소는 오류), 연락처. 정보 화면 표시용으로 예약한 필드(현재 webGBA는 표시하지 않음) |
| `build` | 문자열 | 빌드 표시(커밋 등, 64자). 표시용 문자열이며, 빌드 식별(3.4)은 호스트가 별도로 계산 |
| `needs` | 문자열 배열 | 이 기능이 없는 호스트는 **열지 않음**: `"pointer"`(마우스 필수), `"net"`(멀티플레이 필수), `"keyboard"`(실제 키보드 필수), `"state"`. 모르는 값이 있으면 열지 않고 "새 webGBA가 필요합니다" 안내. 현재 webGBA는 `net`을 지원하지 않아 `needs: ["net"]` 게임을 열지 않음 |
| `screen` | 객체 | `width`·`height`(1~1024, 기본 240·160), `scale` `"fit"`(기본, 비율 유지 최대 크기)·`"integer"`(정수 배율 권장 — 실제 배율은 webGBA 사용자 설정이 우선: 설정이 "정수 배율"일 때만 정수 배율, "영역에 맞춤"이면 이 값이어도 영역에 맞춰 표시). `fps`는 예약(현재 webGBA는 항상 GBA 속도 약 59.7275fps로 실행). 픽셀은 항상 nearest neighbor 방식으로 표시 |
| `audio` | 객체 | `use` — 예약(현재 webGBA는 조회하지 않음). ①은 소리 내보내기가 있으면 소리를 출력 |
| `save` | 객체 | `kind`: `"flash"`(① — 현재 webGBA는 ①의 `kind`를 조회하지 않고 `Web_GetFlash`가 있으면 세이브) · `"storage"`(② 기본, `webgba.save`) · `"localStorage"`(②, 틀의 대체 localStorage 전체를 세이브로) · `"files"`(②, emscripten 파일 `files[0]`) · `"none"`. `maxSize`(②, 바이트, 기본 1MB, 16MB까지), `files`(② `"files"`일 때 경로 배열 — 현재 webGBA는 첫 경로만 사용) |
| `state` | 객체 | `use` — 예약. 현재 webGBA는 ①은 상태 내보내기(4.1.1)가 모두 있으면, ②는 게임이 `webgba.state.onSave`·`onLoad`를 모두 호출하면 퀵슬롯을 활성화 |
| `pointer` | 객체 | `use`: 게임이 마우스·터치 좌표를 사용. ①은 `Web_Pointer` 내보내기 여부로 결정되고, ②는 `true`이면 캔버스의 우클릭 메뉴를 차단 |
| `input` | 객체 | 버튼 목록·기본 배치. [5장](#5-키-매핑). 없으면 ①은 `{"preset": "gba"}`, ②는 버튼 없음 |
| `cart` | 객체 | 롬팩: `color` `"#RRGGBB"`(몸통 색), 그림 `label`·`front`·`spine`(`{chunk, format, width, height}` + 앞면 `labelAt`·옆면 `textArea`). [6장](#6-롬팩-그림) |
| `rom` | 객체 | ①: `required`(기본 true — **롬 chunk가 없고 `false`가 아니면 호스트가 사용자에게 롬 파일을 선택하게 함. 롬 없이 실행되는 게임은 반드시 `false`**). `sha1`·`hint`는 예약(현재는 `sha1`이 롬 chunk와 다르면 검사 경고만) |
| `entry` | 객체 | ② 필수: `style` `"module"`·`"emscripten"`, `js` chunk 이름(규격 1에서는 항상 `"js"` — 생략해도 `"js"`, 다른 값은 `check`가 경고 후 무시), `args`(emscripten `arguments`) |
| `files` | 객체 | ②만: 게임 JS가 조회하는 파일 이름 → chunk 이름(`data.<이름>` 또는 `rom`). 예 `{"game.data": "data.game"}` |
| `multiplayer` | 객체 | [7장](#7-멀티플레이)(초안) |

#### 3.3 예시 (① 롬 없는 240×160 게임)

```json
{
  "wgba": 1,
  "id": "io.github.someone.pixelquest",
  "version": "1.2.0",
  "name": { "en": "Pixel Quest", "ko": "픽셀 퀘스트" },
  "runtime": "webapi",
  "author": "someone",
  "license": "MIT",
  "screen": { "width": 240, "height": 160 },
  "save": { "kind": "flash" },
  "rom": { "required": false },
  "input": { "preset": "gba" },
  "cart": {
    "color": "#3a6ea5",
    "label": { "chunk": "cart.label", "format": "png", "width": 96, "height": 64 },
    "front": { "chunk": "cart.front", "format": "png", "width": 108, "height": 88, "labelAt": [6, 10] },
    "spine": { "chunk": "cart.spine", "format": "png", "width": 36, "height": 92, "textArea": [4, 10, 28, 68] }
  }
}
```

(`cart.*`의 `chunk`·`format`·`width`·`height`는 패키징 도구가 그림에서 채우므로, 직접 작성할 때는 `labelAt`·`textArea`·`color`만 기재해도 됩니다.)

#### 3.4 버전·형식 번호·빌드 — 세 값은 별개입니다

| 값 | 위치 | 변경 주체 | 용도 |
| --- | --- | --- | --- |
| 규격 번호 `wgba`, TOC 형식 번호 | manifest·TOC | 이 규격이 변경될 때만 | 호스트가 **조회 가능한 파일인지** 구분 |
| 게임 버전 `version` | manifest | 제작자(콘텐츠 변경 시) | 사용자에게 표시, **같은 id를 다시 가져올 때 업데이트 여부** 구분 |
| 빌드 식별 | TOC의 `code`·`rom`·`data.*` chunk SHA-256을 연결해 다시 SHA-256(호스트가 계산, manifest·롬팩 그림·JS는 제외) | 패키징 시 자동 | **게임 내용이 바이트 단위까지 같은지** 구분(같으면 다시 추가하지 않음, 멀티플레이 `compat: "exact"`) |

현재 webGBA의 동작:
- 정보 화면에 이름·`version`·id·제작자·빌드 앞 8자리를, 웹 버전 라이브러리에는 "v1.2.0" 형식으로 버전을 표시합니다.
- **같은 id는 같은 게임**입니다. 웹 버전 라이브러리에 같은 id를 다시 가져오면:
  - 빌드가 같음 → "이미 있음"(그대로 열기)
  - 더 높은 버전, 또는 같은 버전이지만 빌드가 다름 → **확인 없이 업데이트**(한 행 알림 "1.1.0 → 1.2.0"). 세이브·퀵슬롯은 id로 이어집니다.
  - 더 낮은 버전 → 경고 후 확인(기본 "아니요")
  - 두 버전을 따로 보관하는 선택지는 존재하지 않습니다. 다른 게임이면 다른 id를 사용하세요.
- Windows 앱은 디스크의 파일을 그대로 열므로 확인 없이 버전만 표시합니다.
- (웹 버전) TOC가 없는 레거시 `.wgba`의 세이브·퀵슬롯은, 롬 chunk SHA-1이 같은 새 파일을 처음 추가할 때 한 번 새 id로 이동합니다.

---

### 4. 실행 방식

#### 4.1 ① Web API — `runtime: "webapi"` (JS 없음)

호스트가 wasm을 직접 실행하고 화면·소리·입력·세이브를 담당합니다. wasm은 아래 함수를 **내보내고**, 가져오기는 4.1.2의 항목만 사용합니다.
따라서 이 방식의 게임은 호스트의 다른 기능(파일·저장소·네트워크)에 접근할 수 없습니다.

##### 4.1.1 내보내기

| 내보내기 | 필수 | 설명 |
| --- | --- | --- |
| `memory` | ● | 선형 메모리 |
| `Web_Init()` → i32 | ● | 롬·세이브 배치 후 한 번. 0이면 실패 |
| `Web_RunFrame(keys)` → i32 | ● | 한 프레임 진행. `keys` = 눌린 버튼 비트(5장). 0이면 정지 |
| `Web_GetFramebuffer()` → i32 | ● | 화면 주소. `screen.width × height` 픽셀, 픽셀당 R·G·B·A 4바이트(메모리 순서) |
| `Web_SetAudioRate(rate)` · `Web_GetAudioBuffer()` · `Web_GetAudioCount()` | | 호스트가 Sample Rate 전달 / 이번 프레임 소리(float32 스테레오 interleaved) 주소·sample 수(좌·우 한 쌍 = 1) |
| `Web_GetFlash()` · `Web_GetSaveSize()` · `Web_SetSaveSize(n)` · `Web_FlashClear()` · `Web_TakeFlashDirty()` | | 세이브 버퍼 주소 / 크기(없으면 128KB) / 불러온 크기 전달 / 삭제 / 게임의 세이브 기록 여부(1이면 호스트가 약 1초 후 저장) |
| `Web_RomBuffer(size)` → i32 | | 롬을 배치할 주소(권장). 없으면 0x08000000에 배치(메모리 크기가 충분해야 함) |
| `Web_Reset()` | | 재시작. 없으면 호스트가 인스턴스를 새로 생성 |
| `Web_StateSize()` · `Web_StateSave(at)` · `Web_StateLoad(at)` · `Web_Alloc(n)` · `Web_Free(at)` · `Web_StateUsed()` | | 퀵슬롯(상태 저장). 앞의 다섯 개가 모두 있어야 활성화. `Web_StateUsed`가 있으면 사용한 길이만 보관(불러올 때 나머지를 0으로 채움) |
| `Web_Pointer(x, y, buttons, wheel)` · `Web_PointerWanted()` | | 마우스: 게임 픽셀 좌표(화면 밖이면 -1), `MouseEvent.buttons`, 휠 칸 수 / 1이면 현재 마우스 사용 중 |
| `Web_GetHaltReason()` · `Web_GetTitle()` · `Web_SetTimeZone(sec)` | | 정지 사유 문자열(NUL 종료) 주소 / 제목 / 시간대 오프셋(UTC 기준 동쪽 방향, 초) |
| `Web_Net*` | | 멀티플레이 — [7장](#7-멀티플레이)(초안) |

##### 4.1.2 가져오기(호스트 제공)

- `env`: `emscripten_asm_const_int`(0 반환), `emscripten_resize_heap`, `_emscripten_throw_longjmp`, `emscripten_date_now`, `emscripten_get_now`, `emscripten_notify_memory_growth`, `abort`, `_abort_js`, `invoke_*`(emscripten 방식 setjmp/예외)
- `wasi_snapshot_preview1`: `fd_write`(로그 출력만), `fd_read`·`fd_close`·`fd_seek`·`fd_sync`·`fd_fdstat_get`(오류 번호), `environ_get`·`environ_sizes_get`(0개), `clock_time_get`, `random_get`, `proc_exit`
- `webgba.v1`: 아무 동작도 하지 않는 함수 `() → ()`. 이 규격을 모르는 이전 버전 webGBA는 모르는 가져오기로 보고 열지 않습니다. 따라서 **240×160·GBA 버튼이 아닌 ① 게임, 롬 없이 실행되는 ① 게임(`rom.required: false`)은 이 함수를 가져오기에 추가하세요**(이전 버전 webGBA에서 화면이 깨진 채 실행되거나 불필요하게 롬을 요청하지 않도록).
- 그 외의 가져오기가 있으면 호스트는 ①로 열지 않습니다(②로 제작하세요).

##### 4.1.3 실행 순서

1. 컴파일(chunk `code`) → 인스턴스 생성 → `__wasm_call_ctors`(없으면 `_initialize`)가 있으면 호출 → `Web_SetTimeZone`.
2. 롬 chunk가 있으면 압축 해제 후 SHA-1 확인 → `Web_RomBuffer(크기)` 위치에 기록. 없고 `rom.required`가 `false`가 아니면 사용자에게 롬 파일을 선택하게 함.
3. 세이브가 있으면 `Web_FlashClear` 후 `Web_GetFlash` 위치에 기록 → `Web_SetSaveSize`.
4. `Web_Init()` → 이후 매 프레임(GBA 속도, 약 59.7275fps) `Web_RunFrame(keys)` → 화면·소리 조회.
5. **`Web_Init` 후에는 `Web_RunFrame` 안에서 메모리를 크게 늘리지 마세요**(호스트가 보관 중인 화면 주소가 무효화됨).

#### 4.2 ② 자체 JS — `runtime: "script"` (격리 실행)

게임 JS(chunk `js`)는 호스트가 생성한 **격리된 틀** 안에서만 실행됩니다. 틀은 `<iframe sandbox="allow-scripts" srcdoc="…">`이고
출처가 존재하지 않습니다(`"null"`). 틀 문서는 호스트가 생성해 삽입하므로 별도로 가져올 주소가 존재하지 않습니다(설치한 웹 앱·오프라인에서도 열림).
틀에는 캔버스 한 개(`#canvas`, `screen.width × height`)와 `webgba` 객체가 있습니다.

##### 4.2.1 틀 안에서 가능한 것·불가능한 것

| 가능 | 불가능(호스트가 대신 처리) |
| --- | --- |
| wasm 컴파일·실행, 캔버스 2D·WebGL, `requestAnimationFrame` | 네트워크(fetch·XHR·WebSocket·이미지 주소·폼 — CSP로 차단, WebRTC는 틀 스크립트가 게임보다 먼저 삭제). 멀티플레이는 `webgba.net`(7장) |
| 키 입력 — 호스트가 사용자 배치를 게임의 `code`로 변환해 `keydown`·`keyup`을 전달(틀이 생성한 이벤트라 `isTrusted`는 false), 캔버스 위 포인터 이벤트 | IndexedDB·쿠키·실제 localStorage(출처가 없어 차단) → `webgba.save`. `localStorage`·`sessionStorage`는 틀이 메모리 기반 대체 객체로 교체하고, `save.kind: "localStorage"`이면 해당 내용을 호스트가 세이브로 저장 |
| `AudioContext`·AudioWorklet. 게임이 생성한 `AudioContext`도 호스트가 음량·일시정지를 제어. 오디오가 잠겨 있으면 틀 위에 "눌러서 시작" Overlay | 게임패드 API(호스트가 조회해 키로 전달), 전체 화면(호스트 버튼), 팝업·`alert`·다른 주소로 이동(이동하면 호스트가 틀을 삭제하고 게임을 정지) |
| `blob:` 주소의 Worker·스크립트·그림 | 스레드(SharedArrayBuffer·pthreads) — 규격 1에서 지원하지 않음 |

Safari(WebKit)는 사용자 입력(클릭·터치)이 아직 없는 틀의 화면 갱신을 30Hz로 제한합니다. 틀은 2초 넘게 40fps 미만이면 같은 "눌러서 시작" Overlay를 출력합니다.

##### 4.2.2 `webgba` 객체 (틀 API 1)

| 이름 | 설명 |
| --- | --- |
| `webgba.version` | `1` |
| `webgba.manifest` · `webgba.lang` · `webgba.canvas` | manifest(동결된 복사본, 읽기 전용) · 사용자 언어(`ko` 등) · 캔버스 |
| `webgba.wasm()` → `Promise<ArrayBuffer>` · `webgba.wasmModule()` → `Promise<WebAssembly.Module>` | chunk `code`(헤더를 추가한 wasm) |
| `webgba.chunk(name)` → `Promise<Uint8Array>` · `webgba.chunkURL(name)` → `Promise<string>` (`blob:` 주소) | 데이터 chunk(`data.*`, `rom`은 압축 해제된 롬). 그 외의 이름은 오류 |
| `webgba.save.read()` → `Promise<Uint8Array \| null>` · `webgba.save.write(bytes)` | 이 게임의 세이브(`save.maxSize`까지). `save.kind`가 `"storage"`일 때만(다른 kind이면 `read`는 null, `write`는 오류) |
| `webgba.state.onSave(fn)` · `webgba.state.onLoad(fn)` | 퀵슬롯: `fn()`이 `Uint8Array`(64MB까지)를 반환 / `fn(bytes)`가 `true`·`false`를 반환. 둘 다 호출해야 퀵슬롯이 활성화 |
| `webgba.input.held` · `webgba.on("button", fn)` | 버튼 단위 입력이 필요한 경우: 현재 눌린 버튼 id의 Set(`has`·`size`·반복) / `{id, down}` |
| `webgba.on("pause"·"resume"·"speed", fn)` | 일시정지·재개·빨리 감기 배수(게임이 반영해도 되고 무시해도 됨). 일시정지 동안 `requestAnimationFrame`은 틀이 보류. `on`은 리스너 해제 함수를 반환 |
| `webgba.audioContext()` | 틀이 음량·일시정지를 제어하는 공용 `AudioContext`(권장) |
| `webgba.ready()` · `webgba.exit(reason)` · `webgba.log(level, text)` | 시작 완료(호스트가 로딩 화면을 닫음 — 호출하지 않아도 10초 후 표시) · 정지 · 로그 |
| `webgba.net` | 멀티플레이 — [7장](#7-멀티플레이). 현재 webGBA는 `null` |

##### 4.2.3 시작 방식 `entry.style`

- `"module"`: chunk `js`가 ES 모듈. **기본 내보내기 함수**에 `webgba`를 전달해 호출합니다.

  ```js
  export default async function start(webgba) {
    const { instance } = await WebAssembly.instantiate(await webgba.wasm(), {});
    const ctx = webgba.canvas.getContext("2d");
    // … 게임 루프(requestAnimationFrame)
    webgba.ready();
  }
  ```

- `"emscripten"`: emscripten이 생성한 Glue `.js`(일반 Glue, `-sMODULARIZE` 팩토리, `-sEXPORT_ES6` 모두 지원). 틀이 `Module`을 전달해 호출합니다:
  `canvas`, `wasmBinary`(chunk `code`), `locateFile`(`files` 매핑의 파일을 `blob:` 주소로 — 전체 경로 또는 파일 이름으로 검색), `arguments`(`entry.args`), `print`·`printErr`(로그),
  `preRun`(`save.kind: "files"`이면 세이브를 `save.files[0]` 경로에 배치 — `FS` 내보내기 필요), `onRuntimeInitialized`(`webgba.ready()`를 대신 호출하고, 해당 파일을 1초 간격으로 확인해 변경되면 저장), `onAbort`(정지).
  권장 빌드: `-sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS`. `--preload-file`로 생성한 `.data`는 `files` 매핑에 추가하면 됩니다(틀이 `blob:` 주소로 제공). pthreads·IDBFS는 사용하지 마세요.

---

### 5. 키 매핑

게임은 **사용하는 버튼 목록**만 manifest에 기재합니다. 실제 키보드·게임패드·터치 버튼의 배치는 호스트가 role 기준으로 결정합니다.

#### 5.1 `input`

| 필드 | 설명 |
| --- | --- |
| `preset` | `"gba"`: 아래 GBA 10버튼 그대로(①의 기본값). `"none"`: 버튼 없음(②의 기본값) |
| `buttons` | 버튼 배열(① 32개까지, ② 24개까지). `preset`과 함께 사용하면 preset 뒤에 추가(같은 `id`이면 preset의 버튼을 교체). **①에서 GBA와 다른 버튼을 사용하면 `"preset": "none"`을 기재하고 버튼을 모두 기재하세요** — ①의 기본값은 `"gba"`라서, 생략하면 GBA 10버튼 뒤에 추가되어 bit·role이 중복됨(검사 오류) |
| `keyboard` | `"mapped"`(기본): 게임은 목록의 버튼만 수신. `"raw"`(②만): 실제 키를 그대로 전달(문자 입력 게임 등, 호스트 예약 키는 제외) |

버튼 한 개:

| 필드 | 설명 |
| --- | --- |
| `id` | 버튼 이름(`A`, `JUMP` …, 영문·숫자·`_`·`-` 16자, 중복 불가) |
| `role` | 위치: `up` `down` `left` `right` · 앞면 `a` `b` `c` `d`(최대 4개) · `l` `r` `l2` `r2` · `start` `select` · `extra`. 기본 키·게임패드·터치 위치를 이 값으로 결정. `extra` 외에는 role 한 개에 버튼 한 개 |
| `label` | 화면에 표시할 문자열(문자열 또는 언어별, 6자 이하 권장, 8자까지). 없으면 `id` |
| `bit` | **① 필수**: `Web_RunFrame(keys)`의 비트 번호 0~31(눌림 = 1) |
| `code` | **② 필수**: 게임 JS가 수신하는 `KeyboardEvent.code`(예 `"Space"`, `"KeyZ"`). 호스트는 `key`·`keyCode`도 맞춰 전달 |
| `keys` | 기본 키보드 배치(`KeyboardEvent.code` 4개까지). 없으면 `role`의 기본값 |
| `pad` | 기본 게임패드 배치(표준 매핑 버튼 번호 0~31, 축은 `"-axis0"`·`"+axis1"` 형식). 없으면 `role`의 기본값 |
| `touch` | `"auto"`(기본) 또는 `"hide"`(터치 버튼을 생성하지 않음) |

#### 5.2 `role` 기본값

| role | 기본 키 | 게임패드(표준) | 터치 위치 |
| --- | --- | --- | --- |
| `up` `down` `left` `right` | 방향키 | 12·13·14·15, 좌측 스틱 | 좌측 방향 패드(스틱·십자는 사용자 설정) |
| `a` | `KeyZ` `KeyK` | 0 | 우측 앞면 |
| `b` | `KeyX` `KeyJ` | 1 | 우측 앞면 |
| `c` · `d` | `KeyC` `KeyI` · `KeyV` `KeyU` | 2 · 3 | 앞면 **A·B 바로 위 행**(5.4, 게임이 정의했을 때만) |
| `l` · `r` | `KeyA` · `KeyS` | 4(·6) · 5(·7) | 상단 좌측 · 상단 우측 |
| `l2` · `r2` | `KeyQ` · `KeyW` | 6 · 7 | 없음(키보드·게임패드만) |
| `start` | `Enter` `NumpadEnter` | 9 | 하단 가운데 |
| `select` | `Backspace` `ShiftRight` | 8 | 하단 가운데 |
| `extra` | 없음(사용자가 설정) | 없음 | 없음 |

- `l2`·`r2`가 있으면 `l`·`r`의 게임패드는 4·5만 사용합니다.
- GBA 버튼과 같은 role(`a` `b` `select` `start` 방향 `l` `r`)의 기본 키는 사용자가 앱에서 설정한 GBA 키를 따릅니다(위 표는 초기값).
- 키 한 개는 버튼 한 개에만 할당됩니다(먼저 지정된 쪽). Windows 앱은 설정 창 › 키에 해당 게임의 버튼만 표시하고, 변경한 배치를 게임 id별로 기억합니다.

#### 5.3 GBA 기본 배치 `preset: "gba"`

| id | role | bit |
| --- | --- | --- |
| A | a | 0 |
| B | b | 1 |
| SELECT | select | 2 |
| START | start | 3 |
| RIGHT | right | 4 |
| LEFT | left | 5 |
| UP | up | 6 |
| DOWN | down | 7 |
| R | r | 8 |
| L | l | 9 |

#### 5.4 앞면 버튼 A~D

앞면 버튼은 최대 4개, role `a` `b` `c` `d`입니다. **터치 화면의 C·D 버튼은 manifest에 `c`·`d` role 버튼을 정의한 게임에서만 표시됩니다.**

- **C·D를 사용하는 게임**은 `c`·`d` role 버튼을 정의합니다. 해당 버튼이 전송하는 값은 ①이면 `bit`, ②이면 `code`입니다. 한 개만(`c`만) 정의해도 됩니다.

  ```json
  "input": { "preset": "gba", "buttons": [
    { "id": "C", "role": "c", "bit": 10, "label": "C" },
    { "id": "D", "role": "d", "bit": 11, "label": "D" }
  ] }
  ```

- **C·D를 정의하지 않은 게임**(`preset: "gba"`만 사용하는 게임, manifest가 없는 레거시 `.wgba`·`.wasm`, `.gba`): 터치 화면에는 **A·B만** 표시됩니다. 호스트가 C·D를 별도로 생성하지 않습니다.
- **화면 배치**: C·D는 **A·B 바로 위 한 행**에, A·B와 같은 크기·간격·모양으로 배치합니다(세로·가로 모두). C는 A 위, D는 B 위(`c`만 있으면 A 위에 C 한 개).
- **좁은 세로 화면**(너비 320·360 등)에서 C·D 행을 배치할 공간이 부족하면, 호스트는 **게임 화면 크기를 유지하고** 버튼 배율(정수)·배치를 다시 맞춰 공간을 확보합니다(버튼 그림은 정수 배율로만 표시하고, 축소해 흐리게 표시하지 않음).
- 키보드·게임패드는 정의된 모든 버튼을 항상 사용할 수 있습니다. 터치는 role 위치가 있는 버튼만(5.2) 표시됩니다.

#### 5.5 호스트 예약 키

호스트가 게임보다 먼저 처리하는 키입니다. 게임의 기본 배치(`keys`)에 포함하지 마세요(`check`가 `Space`·`Tab`·`Escape`·`Pause`·`KeyP`·`F1`~`F12`를 경고).

| 키 | 동작 |
| --- | --- |
| `Space`(사용자가 변경 가능) | 누르는 동안 빨리 감기 |
| `Tab` | 빨리 감기 켜기·끄기 |
| `Pause`(웹 버전은 `P`도) | 일시정지 |
| `F1`~`F9`, `Shift+F1`~`F9`(Windows 앱) | 퀵슬롯 불러오기·저장. Windows 앱은 `F1`~`F12` 모두 호스트 예약 |
| `Ctrl`·`Alt`·`Meta` 조합 | 앱 단축키 |

게임이 수신하는 `code`는 제한이 없습니다(호스트가 변환해 전달). 방향 버튼 동시 누름 처리(나중 것만 / 반대쪽은 나중 것 / 모두)는 사용자 설정이며 `up`·`down`·`left`·`right` role에 적용됩니다.

#### 5.6 ② 예시

```json
"input": {
  "buttons": [
    { "id": "UP", "role": "up", "code": "ArrowUp" },
    { "id": "DOWN", "role": "down", "code": "ArrowDown" },
    { "id": "LEFT", "role": "left", "code": "ArrowLeft" },
    { "id": "RIGHT", "role": "right", "code": "ArrowRight" },
    { "id": "JUMP", "role": "a", "label": { "en": "Jump", "ko": "점프" }, "code": "Space" },
    { "id": "MENU", "role": "start", "code": "Escape" }
  ]
}
```

사용자가 `Z`를 누르면(기본 `a` = `KeyZ`) 게임은 `code: "Space"`, `key: " "`, `keyCode: 32`인 키 이벤트를 수신합니다. 터치 화면에는 방향 패드 + "점프" + 하단 가운데 "MENU"가 생성됩니다.

---

### 6. 롬팩 그림

webGBA 웹 버전의 라이브러리는 각 게임별로 롬팩(카트리지) 한 개를 책장에 배치해 표시합니다. 책장에 있을 때는 **옆면(등)**이 표시되고,
선택하면 꺼내져 **앞면 + 라벨**이 표시됩니다. `.wgba`에 그림 세 개를 포함할 수 있고(모두 선택 사항), 없는 그림은 webGBA가 `cart.color`로 기본 모양을 표시합니다.

| 그림 | chunk | 격자(가로×세로) | 내용 |
| --- | --- | --- | --- |
| 라벨 | `cart.label` | 48×32 (3:2) | 앞면 라벨 창에 들어갈 그림만 |
| 앞면 | `cart.front` | 54×44 | 롬팩 앞면 전체(몸통·라벨 창 바탕·홈 등). 몸통 외부는 투명 |
| 옆면(등) | `cart.spine` | 18×46 | 책장에 배치되었을 때 표시되는 옆면. 외부는 투명 |

| 항목 | 규칙 |
| --- | --- |
| 크기 | 격자 × k, k는 1~4. **세 그림은 같은 k**를 사용. 권장 k = 2: 라벨 **96×64** · 앞면 **108×88** · 옆면 **36×92** |
| 형식 | PNG(권장, 팔레트 PNG도 가능) 또는 **무손실** WebP. JPEG·GIF·SVG는 지원하지 않음 |
| 투명 | 가능. 라벨의 투명한 부분에는 앞면 그림(없으면 기본 라벨 바탕)이 비침 |
| 용량 | 각각 64KB 이하 권장(256KB를 넘으면 해당 그림을 사용하지 않음) |
| 표시 | 호스트는 nearest neighbor·정수 배율로만 표시(축소하거나 흐리게 확대하지 않음). 격자 크기로 그린 후 2배로 저장하는 것을 권장 |
| 라벨 위치 | `cart.front.labelAt: [x, y]` — 앞면 그림 안에서 라벨의 좌측 상단(앞면 그림 픽셀). 없으면 `[3k, 5k]`. 라벨(48k×32k)이 앞면 안에 들어가야 함 |
| 옆면 이름 위치 | `cart.spine.textArea: [x, y, 가로, 세로]` — 옆면 그림 픽셀. 호스트가 이 영역에 `shortName`(없으면 `name`)을 세로 문자열로 표시. 없으면 문자열을 표시하지 않음(이름을 옆면 그림에 직접 그린 경우) |

```json
"cart": {
  "color": "#3a6ea5",
  "label": { "chunk": "cart.label", "format": "png", "width": 96, "height": 64 },
  "front": { "chunk": "cart.front", "format": "png", "width": 108, "height": 88, "labelAt": [6, 10] },
  "spine": { "chunk": "cart.spine", "format": "png", "width": 36, "height": 92, "textArea": [4, 10, 28, 68] }
}
```

`chunk`·`format`·`width`·`height`는 패키징 도구가 그림에서 채웁니다(직접 작성할 때는 그림과 같게). `color`는 몸통 색(선택)이고, 기본 앞면·옆면을 표시할 때 이 색으로 명암을 생성합니다.

그림이 없을 때(규격 밖 크기·형식, 손상된 그림, 다른 k도 "없음"으로 처리 — 오류 창 없음):
- 앞면 없음 → 기본 앞면(`cart.color` 몸통 + 라벨 창, 라벨 위치 `[3k, 5k]`)
- 옆면 없음 → 기본 옆면(`cart.color` 몸통 + 이름 띠에 `shortName`·`name`)
- 라벨 없음 → 라벨 위치에 `shortName`(없으면 `name`)을 문자열로 표시
- `cart.color` 없음 → 테마 색

- **상표를 포함하지 마세요**: 다른 회사의 이름·로고(게임기 회사 이름, 게임기 이름 문자·로고 등), 실제 카트리지·상자 그림을 모방한 그림, 권리가 없는 캐릭터 그림. 앞면·옆면 몸통도 실제 게임기 카트리지의 모양·홈·단자를 그대로 모방하지 말고 고유한 모양으로 그리세요. 직접 그렸거나 사용 권리가 있는 그림만 포함하세요.

---

### 7. 멀티플레이

> 멀티플레이 규약 1(초안). 현재 webGBA는 같은 Wi-Fi 안에서 **연결 코드(·QR)를 두 번 주고받는 방식**으로 연결합니다(방 코드·근처 방 목록은 이후 버전). `needs: ["net"]` 게임도 열고, `Web_NetHost(1, 1)`을 호출하며, ②에는 `webgba.net`을 제공합니다.
> 멀티플레이를 모르는 옛 webGBA에서는 `Web_NetHost`가 호출되지 않고 `webgba.net`이 `null`이므로 게임은 통신 메뉴를 숨기면 됩니다(7.8). 규약은 바뀔 수 있습니다.

#### 7.1 개요

webGBA는 같은 Wi-Fi(같은 공유기) 안의 기기끼리 게임을 연결합니다. 연결은 기기 간 직접 연결(WebRTC 데이터 채널)이고, 게임 데이터는 어떤 서버도 거치지 않습니다. 기본 설정에서 다른 네트워크의 기기와는 연결되지 않습니다.

게임은 "현재 통신 상대가 필요하다"는 상태와 송수신할 바이트만 처리합니다. 방 생성·참가·근처 기기 검색·연결·연결 끊김 처리는 webGBA가 담당합니다. ②의 게임 JS는 네트워크를 직접 사용할 수 없으므로(8장) 항상 이 방식을 사용합니다.

- 연결 그룹(세션) 한 개 = 방 한 개, 2~8명. 방을 생성한 기기가 **슬롯 0(방장)**, 참가한 순서대로 1, 2, …
- 메시지는 신뢰성이 보장되고(누락 없음) 송신자별 순서를 유지합니다. 메시지 한 개는 16384바이트까지.
- 수신 대상을 `TO_ORDERED`로 송신하면 본인을 포함한 모두가 **같은 순서로** 수신합니다(방장이 순서를 지정).
- 같은 게임(또는 같은 호환 키)끼리만 연결됩니다.
- 멀티플레이 없이는 실행할 수 없는 게임만 `needs: ["net"]`을 기재합니다.

#### 7.2 manifest의 `multiplayer` 필드

없으면 멀티플레이를 사용하지 않는 게임입니다(①에서 내보내기만 있고 `multiplayer`가 없으면 아래 기본값으로 동작).

| 키 | 타입 | 필수 | 기본 | 설명 |
|---|---|---|---|---|
| `protocol` | 정수 | 예 | — | 멀티플레이 규약 번호. 현재 `1` |
| `players` | `{ "min": 정수, "max": 정수 }` | 아니요 | `{2, 2}` | 게임 전체가 지원하는 인원(2~8) |
| `purposes` | 배열 | 아니요 | 이름 "통신" 한 개 | 게임이 상대를 찾는 용도 목록. 배열 순서 = 번호(1부터) |
| `purposes[].id` | 문자열(영문 소문자·숫자·`-`, 32자까지) | 예 | — | 고정 이름. 서로 다른 용도끼리는 연결하지 않음 |
| `purposes[].name` | 다국어 이름 | 예 | — | 창에 표시되는 이름(예: 교환, 대전) |
| `purposes[].players` | `[min, max]` | 아니요 | `players` | 해당 용도의 인원 |
| `compat` | 문자열 | 아니요 | `"exact"` | 함께 실행할 수 있는 상대. `"exact"` = 같은 `id` + 빌드 식별(3.4)이 같음(manifest·롬팩 그림만 다른 파일끼리는 가능). 다른 문자열 = `id`와 해당 문자열이 같은 게임끼리(예: 통신 규칙이 같은 여러 버전) |
| `sync` | `"messages"` \| `"inputs"` | 아니요 | `"messages"` | `"inputs"` = 호스트가 매 프레임 모든 참가자의 키를 동기화(7.6, 선택 기능) |
| `inputDelay` | 정수 | 아니요 | `3` | `sync: "inputs"`일 때 키를 적용할 지연 프레임 수(1~10) |

```json
"multiplayer": {
  "protocol": 1,
  "players": { "min": 2, "max": 8 },
  "compat": "exact",
  "purposes": [
    { "id": "trade",  "name": { "ko": "교환", "en": "Trade",  "ja": "こうかん" }, "players": [2, 2] },
    { "id": "battle", "name": { "ko": "대전", "en": "Battle", "ja": "たいせん" }, "players": [2, 4] },
    { "id": "party",  "name": { "ko": "친구 게임", "en": "Party", "ja": "なかま" }, "players": [2, 8] }
  ]
}
```

모르는 키는 무시합니다. `multiplayer.protocol`이 호스트가 지원하는 번호보다 크면 호스트는 멀티플레이를 비활성화하고 게임은 그대로 실행합니다.

#### 7.3 ① Web API — 내보내기 함수

모두 **게임이 내보내는 함수**이고 호스트가 호출합니다(새 가져오기 없음 → 멀티플레이를 모르는 호스트에서도 게임은 그대로 열림).
`Web_NetWanted`, `Web_NetEvent`, `Web_NetOut`, `Web_NetOutLen`, `Web_NetOutClear`, `Web_NetInBuffer`, `Web_NetIn` 일곱 개가 모두 있어야 멀티플레이를 지원하는 것으로 봅니다. 포인터는 wasm 메모리 안 주소, 값은 모두 little endian.

| 함수 | 시그니처 | 호출 시점 | 설명 |
|---|---|---|---|
| `Web_NetHost` | `(u32 protocol, u32 flags)` | `Web_Init` 후 한 번 | 호스트가 멀티플레이 규약 `protocol`을 지원함. `flags` 비트 0 = 순서 보장 Broadcast 지원, 비트 1 = `sync: "inputs"` 지원. **호출되지 않으면 통신을 지원하지 않는 호스트** → 게임은 "친구와 하기" 등의 메뉴를 숨기는 것을 권장. 선택 |
| `Web_NetWanted` | `() → u32` | 매 프레임 `Web_RunFrame` 후 | 0 = 통신 불필요. 0이 아니면 요청(7.3.1) |
| `Web_NetEvent` | `(u32 kind, u32 a, u32 b)` | 이벤트 발생 시, 프레임 사이 | 이벤트(7.3.3) |
| `Web_NetOut` | `() → ptr` | 매 프레임 `Web_RunFrame` 후 | 송신 레코드의 위치(7.3.2) |
| `Web_NetOutLen` | `() → u32` | 같음 | 송신 레코드의 바이트 수(0 = 없음) |
| `Web_NetOutClear` | `()` | 레코드를 모두 조회한 후 | 송신 버퍼 비우기 |
| `Web_NetInBuffer` | `(u32 len) → ptr` | 수신 메시지별, `Web_RunFrame` 전 | `len` 바이트를 기록할 위치. **0 = 현재 공간 없음** → 호스트는 해당 메시지를 보관했다가 다음 프레임에 다시 시도(순서 유지) |
| `Web_NetIn` | `(u32 from, u32 len)` | 위치에 바이트를 기록한 후 | 수신 확정. `from` = 송신자 슬롯 |
| `Web_NetCompat` | `() → ptr` | 세션 전 한 번 | 선택. NUL 종료 ASCII 64자까지의 호환 키(예: 빌드 해시). 있으면 manifest `compat` 뒤에 연결해 함께 비교 |

호스트의 한 프레임:

```text
수신 메시지 → Web_NetInBuffer / Web_NetIn (공간이 없으면 중단 후 다음 프레임에)
Web_RunFrame(keys)
Web_NetOut / Web_NetOutLen → 송신 → Web_NetOutClear
Web_NetWanted → 창 열기·닫기·세션 종료 (7.7)
```

##### 7.3.1 `Web_NetWanted` 값

| 비트 | 설명 |
|---|---|
| 0~7 | 용도 번호(manifest `purposes`의 1부터 시작하는 번호. 0 = 첫 용도) |
| 8~11 | 최소 인원(0 = 2) |
| 12~15 | 최대 인원(0 = 최소와 같음, 8까지) |
| 16~17 | 역할: 0 = 무관(창에서 선택), 1 = 방 생성만, 2 = 참가만 |
| 18~23 | 0으로 설정(예약) |
| 24~31 | 요청 번호: 새로 상대를 찾을 때마다 게임이 1씩 증가(255 다음 1). 같은 값이 이어지면 같은 요청 |

- 세션이 유지되는 동안 게임은 **같은 값을 계속** 반환합니다. 0을 반환하면 "통신 종료" → 호스트는 남은 송신을 모두 완료한 후 세션을 닫고 `CLOSED(LEFT)`를 전달합니다.
- 용도나 요청 번호가 변경되면 호스트는 현재 세션을 닫고 새 요청으로 처리합니다.

##### 7.3.2 송신 레코드 형식

`Web_NetOut()` 위치부터 `Web_NetOutLen()` 바이트에 레코드가 연속됩니다. 레코드 형식:

| 바이트 | 설명 |
|---|---|
| 0~1 | 내용 길이 `n`(u16, 1~16384) |
| 2 | 수신 대상: 0~7 = 해당 슬롯 한 개, `0xFE` = **TO_ORDERED**(본인 포함 모두, 모두 같은 순서), `0xFF` = **TO_ALL**(본인 제외 모두) |
| 3 | 0(예약) |
| 4~ | 내용 `n` 바이트, 다음 레코드는 4바이트 경계에서 시작 |

- 한 프레임의 송신 합계는 65536바이트까지 권장. 세션이 없을 때 쌓인 레코드는 호스트가 폐기합니다.
- `TO_ORDERED`로 송신한 메시지는 본인에게도 돌아옵니다(`from` = 본인 슬롯). 게임은 자신의 메시지도 돌아온 순서대로 적용하면 모든 기기가 같은 상태가 됩니다.
- 수신 측은 송신자별 순서를 유지합니다. 서로 다른 송신자의 메시지는 `TO_ORDERED`일 때만 모두 같은 순서입니다.

##### 7.3.3 이벤트 `Web_NetEvent(kind, a, b)`

| kind | 이름 | a | b | 설명 |
|---|---|---|---|---|
| 1 | `OPEN` | 본인 슬롯 | 현재 인원 | 세션 시작. 방장은 혼자(인원 1)로 먼저 시작 |
| 2 | `JOIN` | 참가한 슬롯 | 현재 인원 | 참가자 입장 |
| 3 | `LEAVE` | 나간 슬롯 | 사유 | 참가자 퇴장(해당 슬롯은 비고, 새 참가자가 같은 번호를 받을 수 있음) |
| 4 | `CLOSED` | 사유 | 0 | 세션 종료. 이후 송신은 폐기됨 |
| 5 | `STALL` | 슬롯 | 0 | 해당 참가자에게서 1초 넘게 응답이 없거나 해당 기기가 앱을 잠시 벗어남 |
| 6 | `RESUME` | 슬롯 | 0 | 연결 재개 |

사유: 1 `CANCEL`(사용자가 멀티플레이 창에서 취소) · 2 `TIMEOUT`(제한 시간 안에 연결 실패 / 연결 끊김 후 복귀하지 않음) · 3 `INCOMPATIBLE`(서로 다른 게임·호환 키·규약 번호) · 4 `LOST`(연결 끊김) · 5 `FULL`(방 정원 초과) · 6 `LEFT`(정상 퇴장) · 7 `HOST_LEFT`(방장이 나가 방이 사라짐) · 8 `NO_NETWORK`(Wi-Fi가 없거나 이 기기에서 연결 기능을 사용할 수 없음)

게임이 지킬 사항: `CLOSED(CANCEL)`을 수신하면 게임 안에서 취소한 것과 같이 처리하고 `Web_NetWanted`를 0으로. `STALL`은 일시적일 수 있으므로 즉시 끊지 말고 게임의 제한 시간을 따름. 방장이 나가면(`HOST_LEFT`) 세션 종료(방장 위임은 규약 1에 없음).

#### 7.4 ② 자체 JS — `webgba.net`

격리 틀이 제공하는 `webgba.net`으로 송수신합니다(틀과 호스트 사이는 MessagePort로 통신하고, 게임은 이 객체만 사용). 바이트는 `ArrayBuffer`·`Uint8Array`.

| 게임 → 호스트 | 설명 |
|---|---|
| `webgba.net.want({ purpose, min, max, role })` | ①의 `Web_NetWanted` 0이 아닌 값과 같음. `purpose` = manifest id, `role` = `"any"`·`"make"`·`"join"`. 호출할 때마다 새 요청 |
| `webgba.net.unwant()` | ①의 0과 같음(통신 종료) |
| `webgba.net.send(to, bytes)` | `to` = 슬롯 0~7 · `"ordered"` · `"all"`, 16384바이트까지 |

| 호스트 → 게임 | 설명 |
|---|---|
| `webgba.net.host` | `{ protocol, ordered, inputs }` — ①의 `Web_NetHost` |
| `webgba.net.onevent = (kind, a, b) => …` | 7.3.3과 같은 번호 |
| `webgba.net.onrecv = (from, bytes) => …` | 수신 메시지(순서 유지) |

멀티플레이를 모르는 호스트에서는 `webgba.net` 자체가 `null`입니다.

#### 7.5 한도

| 항목 | 값 |
|---|---|
| 인원 | 2~8(슬롯 0~7) |
| 메시지 한 개 | 16384바이트 |
| 한 프레임 송신 합계(권장) | 65536바이트 |
| 수신 순서 | 송신자별 순서 유지, `TO_ORDERED`는 모두 같은 순서 |
| 지연(같은 Wi-Fi) | 보통 왕복 2~20ms(프레임 1~2개) |

#### 7.6 선택 기능: 키 동기화 (`sync: "inputs"`)

자체 통신 코드가 없는 단순한 ① 게임용. 게임이 같은 키 입력에 같은 화면을 생성하면(결정적) 호스트가 모든 참가자의 키를 매 프레임 동기화합니다.

- 추가 내보내기: `Web_NetKeys(u32 slot, u32 keys)` — 호스트가 `Web_RunFrame` 직전에 다른 참가자별로 호출. `Web_RunFrame(keys)`의 `keys`는 본인 키.
- 호스트는 프레임 f의 본인 키를 f + `inputDelay`에 적용하도록 송신하고, 모든 참가자의 f 키가 모일 때까지 프레임 f를 실행하지 않음(그동안 화면 정지, 1초 넘으면 `STALL`).
- 모두 같은 프레임 0에서 시작: `OPEN`·`JOIN`으로 인원이 차면 방장이 "시작"을 송신하고, 다음 프레임이 모든 참가자의 프레임 0.
- 빨리 감기·상태 불러오기는 세션 중 사용할 수 없음.

#### 7.7 멀티플레이 창 출력 조건

호스트는 아래 조건이 모두 맞을 때 **한 번** 멀티플레이 창을 출력합니다.

1. 게임이 멀티플레이를 지원함: ① 7.3의 일곱 함수가 있음(manifest `multiplayer`가 있으면 해당 내용을 사용) / ② manifest에 `multiplayer`가 있음
2. 게임이 요청함: ① `Web_NetWanted()`가 0에서 0이 아닌 값으로 변경(또는 요청 번호가 변경) / ② `webgba.net.want()`를 호출
3. 현재 세션이 없음, 게임이 실행 중(정지 상태 아님), 사용자 설정에서 멀티플레이가 활성화되어 있음

출력하지 않는 경우:
- 사용자가 창을 닫은(취소한) 후 **같은 요청**으로는 다시 출력하지 않음. 대신 화면 상단 "멀티플레이" 버튼이 요청이 유지되는 동안 활성화되어 다시 열 수 있음.
- 게임이 아무것도 요청하지 않을 때는 창도 버튼도 없음(사용자가 먼저 여는 기능 없음).

```text
┌ 멀티플레이 · 교환 (2명) ─────────────────┐
│  닉네임 [ 플레이어 4821 ]                 │
│  [ 방 만들기 ]   [ 참가하기 ]              │
│                              [ 취소 ]     │
└──────────────────────────────────────────┘

방장: ① 방장 코드(111자·QR)를 상대에게 → ② 상대의 답 코드를 넣고 연결
참가: ① 방장 코드를 넣고 다음 → ② 답 코드(·QR)를 방장에게
```

- 연결 코드는 서버를 거치지 않습니다. 코드에는 망 안 주소(mDNS 이름·사설 IPv4·IPv6 ULA·링크 로컬)만 들어가고, 공인 주소는 만들 때·받을 때 모두 버립니다(STUN·TURN 없음). 연결 뒤 고른 후보 쌍이 host/host가 아니면 끊습니다.
- 코드 하나는 한 사람에게 한 번만 씁니다. 3명 이상은 방장이 사람마다 새 방장 코드를 만듭니다(이미 쓴 코드·다른 초대의 답 코드는 거부).
- 역할이 지정된 요청(방 생성만·참가만)이면 해당 화면부터 표시.
- 인원이 최소에 도달하면 "연결됨"을 표시하고 1초 후 창을 닫음. 이후 확인(예: "A로 시작")은 게임 안에서.
- 최대 인원 전까지 방장 측에는 작은 표시("2/4 · 기다리는 중")가 유지되고, 참가자가 더 들어오면 `JOIN`.
- 취소 → `CLOSED(CANCEL)`. 제한 시간 안에 찾지 못하면(기본 3분) `CLOSED(TIMEOUT)`. 게임이 먼저 통신 종료를 알리면 안내 없이 창을 닫음.
- 연결 실패 시 안내: "같은 와이파이인지, 게스트·공용 와이파이가 아닌지, VPN이 꺼져 있는지 확인하세요."

세션 중 호스트가 지키는 사항: 빨리 감기·속도 변경 비활성화(1배), 상태 불러오기·초기화 차단, 다른 게임 열기 = 세션 종료(`LEFT`). 일시정지·앱 이탈 → 상대에게 `STALL`, 복귀하면 `RESUME`, 일정 시간(기본 15초) 넘게 복귀하지 않으면 연결 해제(`LOST`). 화면 구석에 작은 상태 표시(인원·연결 상태). 닉네임은 사용자 설정 값이고 IP·기기 이름은 어디에도 표시되지 않습니다.

#### 7.8 개발자 참고 사항

- 같은 키 입력·같은 메시지에 같은 결과가 나오도록(난수는 게임 내부 seed 사용) 제작하면 `TO_ORDERED` 한 가지로 모두 같은 상태를 유지할 수 있습니다.
- 수신 메시지는 프레임 사이에 도착하므로, 게임은 수신한 메시지를 Queue에 추가하고 프레임 안에서 처리하세요.
- 호스트가 멀티플레이를 모르면(`Web_NetHost`가 호출되지 않음 / `webgba.net`이 `null`) 통신 메뉴를 숨기세요(옛 webGBA).
- 예제: `docs/wgba/examples/net-webapi/`(① 작은 C, 롬 없음)·`net-script/`(② JS 한 개) — A로 상대 찾기, 방장 START로 한 라운드, 모두 같은 해시.
- 같은 게임 빌드끼리만 연결되는 것이 기본입니다(`compat: "exact"`). 버전이 달라도 통신 규칙이 같다면 `compat`에 같은 문자열을 사용하세요.
- 롬이나 타인의 저작물을 메시지로 전송하지 마세요.

---

### 8. 보안 규칙

`.wgba`는 타인이 제작한 파일입니다. 호스트는 아래 규칙을 지킵니다(다른 호스트를 개발할 때도 같은 규칙을 권장합니다).

**공통**
- TOC의 오프셋·길이는 신뢰하지 않습니다: 파일 범위 안인지, 순서대로이고 겹치지 않는지, section 이름이 맞는지, SHA-256이 맞는지 확인한 후 사용합니다. 압축은 "압축 해제 크기"를 넘으면 중단합니다.
- manifest 문자열은 **텍스트로만** 표시합니다(HTML로 삽입하지 않음). 길이를 제한합니다. 주소는 `https://`만 허용합니다.
- 그림은 PNG·무손실 WebP만, 헤더에서 크기를 먼저 조회하고 규칙 밖이면 사용하지 않습니다(SVG는 지원하지 않음).
- 세이브·퀵슬롯·키 설정은 **게임별로 분리**됩니다. 한 게임에 다른 게임의 저장 데이터를 제공하지 않습니다. 같은 id는 같은 게임으로 보므로(3.4) 더 낮은 버전으로 변경할 때만 확인합니다 — 제작자는 id를 본인 도메인·계정 이름으로 생성해 타인과 겹치지 않게 하세요.

**① Web API**
- wasm은 가져오기 목록(4.1.2) 외의 기능에 접근할 수 없으므로 호스트 안에서 실행합니다. 모르는 가져오기가 있으면 ①로 열지 않습니다.
- 무한 반복·메모리 증가로 화면이 정지할 수는 있으므로, 호스트는 정지한 게임을 닫을 수 있게 합니다.

**② 자체 JS — 격리 틀**
- JS는 **sandbox iframe(`sandbox="allow-scripts"`만, `allow-same-origin` 없음)**에서만 실행합니다. 틀 문서는 `srcdoc`으로 삽입합니다. 출처가 없어(`"null"`) 호스트·다른 게임의 저장소(IndexedDB·localStorage·쿠키)와 호스트 화면에 접근할 수 없습니다. 팝업·상위 창 이동·`alert`도 차단됩니다.
- 틀 문서 맨 앞에 엄격한 CSP를 `<meta http-equiv="Content-Security-Policy">`로 삽입합니다:
  `default-src 'none'; script-src 'sha256-<틀 스크립트>' blob: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob:; font-src blob: data:; connect-src blob: data:; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'`
  (출처 없는 문서에서는 `'self'`가 동작하지 않는 브라우저가 있어, 틀 스크립트는 문서 안에 포함하고 해당 SHA-256으로 허용합니다. 문서 안에 포함되어 별도로 가져올 주소가 없으므로 웹 서버·앱 설정이 필요하지 않습니다.)
- WebRTC는 CSP로 차단되지 않으므로 틀 스크립트가 게임보다 먼저 `RTCPeerConnection`을 삭제합니다. 새 틀을 생성해 원본 객체를 다시 얻는 방법은 `frame-src 'none'`이 차단합니다.
- 호스트와는 처음 전달한 **MessagePort 한 개**로만 통신합니다. 호스트는 정해진 메시지 종류·크기만 수신하고, 틀에서 온 문자열을 코드로 실행하지 않습니다.
- 틀이 스스로 다른 주소로 이동하면(틀 `load`가 두 번째로 발생하면) 호스트는 틀을 삭제하고 게임을 정지합니다.
- Windows 앱: WebView2는 앱 Bridge 스크립트를 틀에도 삽입합니다. 그래도 앱은 틀에서 온 호출을 수신하지 않고(앱 통신 주소는 CSP가 차단하고, 틀에서 송신한 메시지는 앱이 수신하지 않음), 틀 스크립트가 게임보다 먼저 해당 통신 경로(`__TAURI__`·`__TAURI_INTERNALS__` 안의 함수·`chrome.webview` 등)를 삭제합니다.

---

### 9. 생성 예시

#### 9.1 예제 패키징

webGBA 저장소(https://github.com/flightrabbit-hash/webGBA)를 다운로드한 후 해당 폴더에서(node 18 이상, 외부 의존성 없음):

```text
node tools/wgba.mjs pack -o hello.wgba --wasm docs/wgba/examples/hello-webapi/game.wasm --manifest docs/wgba/examples/hello-webapi/manifest.json --cart-dir docs/wgba/examples/hello-webapi/cart
node tools/wgba.mjs check hello.wgba
```

`hello.wgba`(약 2.6KB)를 webGBA로 열면 버튼 입력에 따라 화면 전체의 색이 변경됩니다. 예제 폴더 `docs/wgba/examples/hello-webapi/`:
`game.c`(소스) · `game.wasm`(해당 빌드, 594바이트) · `manifest.json` · `cart/`(라벨·앞면·옆면 PNG, k = 2).

#### 9.2 도구 명령

```text
node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir 그림폴더]
                     [--label label.png] [--front front.png] [--spine spine.png] [--js game.js] [--js-store]
                     [--data levels=levels.bin …] [--data-store] [--rom game.bin]
node tools/wgba.mjs check game.wgba [--quick]             검증(10장). 오류가 있으면 종료 코드 1. --quick은 롬 압축 해제 생략
node tools/wgba.mjs info  game.wgba                       TOC·manifest 요약(파일 앞부분만 조회)
node tools/wgba.mjs extract game.wgba cart.label label.png   chunk 추출(code → 실행 가능한 wasm, rom → 압축 해제된 롬)
node tools/wgba.mjs strip game.wgba game-norom.wgba          롬 chunk만 제외하고 다시 패키징
```

- `--wasm`에는 `.wgba`도 지정할 수 있습니다(내부의 `webgba.*` section은 제외하고 다시 패키징).
- `--cart-dir` 폴더의 `label.png`·`front.png`·`spine.png`(또는 `.webp`) 중 있는 파일을 포함하고, manifest `cart.*`의 `chunk`·`format`·`width`·`height`를 그림에서 채웁니다. 없는 그림의 항목은 manifest에서 삭제합니다.
- JS·데이터는 zlib으로 압축해 저장합니다(`--js-store`·`--data-store`이면 무압축). manifest·롬팩 그림·code는 항상 무압축입니다.
- 같은 입력이면 어느 PC에서 패키징해도 바이트 단위까지 같은 파일이 생성됩니다(압축은 pako level 9, manifest는 입력 JSON을 같은 순서로 공백 없이 저장).
- 패키징 후 다시 조회해 10장 검사를 통과해야 출력 파일을 기록합니다.

#### 9.3 ① 최소 C 게임

예제 `game.c`의 핵심입니다(전체는 예제 폴더).

```c
#include <stdint.h>
static uint32_t fb[240 * 160];            // 메모리 순서 R,G,B,A (little endian 0xAABBGGRR)
__attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void);
__attribute__((export_name("Web_Init"))) int Web_Init(void) { webgba_v1(); return 1; }
__attribute__((export_name("Web_RunFrame"))) int Web_RunFrame(int keys) {
  uint32_t color = 0xFF000000u | ((keys & 1) ? 0xF0 : 0x30);
  for (int i = 0; i < 240 * 160; i++) fb[i] = color;
  return 1;
}
__attribute__((export_name("Web_GetFramebuffer"))) uint32_t *Web_GetFramebuffer(void) { return fb; }
```

```text
clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry -o game.wasm game.c
node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json --cart-dir cart
```

(`wasm-ld`는 `memory`를 기본으로 내보냅니다. 롬이 없으므로 manifest에 `"rom": { "required": false }`를, 이전 버전 webGBA가 롬을 요청하지 않도록 `webgba.v1` 가져오기를 추가했습니다.)

#### 9.4 ② emscripten(SDL 등) 게임

```text
emcc game.c -O2 -lSDL -sMODULARIZE=1 -sEXPORT_NAME=createGame -sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS --preload-file assets@/assets -o game.js
node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --js game.js --manifest manifest.json --cart-dir cart --data game=game.data
```

```json
{
  "wgba": 1, "id": "io.github.someone.sdlgame", "version": "0.3.0", "name": "SDL Game", "runtime": "script",
  "entry": { "style": "emscripten" },
  "files": { "game.data": "data.game" },
  "screen": { "width": 256, "height": 192, "scale": "integer" },
  "save": { "kind": "files", "files": ["/save/game.sav"], "maxSize": 4096 },
  "input": { "buttons": [
    { "id": "UP", "role": "up", "code": "ArrowUp" }, { "id": "DOWN", "role": "down", "code": "ArrowDown" },
    { "id": "LEFT", "role": "left", "code": "ArrowLeft" }, { "id": "RIGHT", "role": "right", "code": "ArrowRight" },
    { "id": "FIRE", "role": "a", "code": "KeyZ" }, { "id": "PAUSE", "role": "start", "code": "Enter" }
  ] }
}
```

#### 9.5 도구 없이 직접 패키징

규칙만 지키면 어떤 언어로도 제작할 수 있습니다. 순서:

1. 입력 wasm의 section을 순회하며 `webgba.`로 시작하는 custom section을 제외하고 나머지를 그대로 연결 → **code 구간**.
2. chunk 내용 결정: manifest(JSON UTF-8), cart.label·cart.front·cart.spine(그림 바이트 그대로), js(무압축 또는 zlib), data(무압축 또는 zlib), rom(WGRM 헤더 + 롬).
3. 항목 수 n으로 TOC 길이 `16 + 80n`을 결정하고, TOC section(`00` + LEB 길이 + LEB 이름 길이 + `webgba.toc` + TOC) 길이를 계산.
4. 오프셋 8 + TOC section 길이부터 순서대로: 각 `webgba.<이름>` section → code 구간 → data → rom. section별 **시작 = 해당 section 내용의 첫 바이트**(이름 뒤), 끝 = section 끝. code는 구간의 처음과 끝.
5. TOC 작성(이름·시작·끝·압축 해제 크기·방식·종류·flag·SHA-256), 파일 전체 길이 포함.
6. `wasm 헤더 + TOC section + 나머지`를 기록한 후 `WebAssembly.validate`와 10장 검사를 수행.

---

### 10. 검증

`wgba.mjs check`의 검사 항목입니다(직접 제작할 때도 이 항목대로 확인하세요). **오류**가 한 개라도 있으면 실패, **경고**는 알림입니다.

- 파일 전체 `WebAssembly.validate` 통과, 첫 section이 `webgba.toc`(한 개만), TOC의 파일 길이 = 실제 길이
- 항목: 이름 규칙·중복 없음, 순서대로이고 파일 범위 안, 해당 위치에 `webgba.<이름>` section이 있음(code는 wasm section 경계와 일치하고 내부에 `webgba.*` 없음), 종류가 이름과 일치, 방식 0이면 압축 해제 크기 = 저장 길이, SHA-256 일치, 필수 flag인데 모르는 종류 없음, 한 개만 있어야 하는 chunk가 한 개
- TOC에 없는 `webgba.*` section → 경고
- `rom`이 있으면 맨 끝, WGRM 헤더·크기·SHA-1 일치(`--quick`이면 압축 해제 생략), manifest `rom.sha1`이 다르면 경고
- manifest: 64KB 이하 JSON, `wgba` 1, `id` 규칙, `version`이 `x.y.z`, `name`(48자), `runtime`, 모르는 `needs` 없음, `homepage`는 `https://`, `screen`·`save`·`input.preset`·`cart.color` 값, 버튼 id 규칙·중복, role 중복, `shortName` 16자 초과 시 경고
- ①: 필수 내보내기 4개, 모르는 가져오기 없음, 버튼 `bit` 0~31이고 중복 없음, `Web_Net*` 일곱 개(7.3) 중 일부만 있으면 경고, 240×160·GBA 버튼이 아니거나 롬 없이 실행되는데(`rom.required: false`) `webgba.v1`이 없으면 경고, `js` chunk가 있으면 경고(사용하지 않음)
- 멀티플레이: `multiplayer.protocol` 1, `purposes[].id` 규칙·중복 없음, 인원 2~8
- ②: `js` chunk 있음, `entry.style`, `entry.js`가 `"js"`가 아니면 경고, 버튼별 `code`, 가져온 공유 메모리(스레드) 없음
- 롬팩 그림(라벨·앞면·옆면): PNG·무손실 WebP, 256KB 상한(64KB 초과 시 경고), 격자(48×32 · 54×44 · 18×46) × k(1~4)가 아니면 경고, 세 그림의 k가 다르면 경고, manifest의 형식·크기와 다르면 경고, `labelAt`·`textArea`가 그림 밖이면 경고, manifest에 있는데 chunk가 없으면 오류, chunk가 있는데 manifest에 없으면 경고
- 기본 키(`keys`)에 호스트 예약 키(`Space`·`Tab`·`Escape`·`Pause`·`KeyP`·`F1`~`F12`)가 있으면 경고

---

### 11. 형식 번호와 버전

| 번호 | 변경 시점 | 조회 측 |
| --- | --- | --- |
| TOC major 번호(현재 1) | TOC 구조가 변경되어 이전 호스트가 잘못 조회할 때만 | 모르면 열지 않고 "새 webGBA가 필요합니다" |
| TOC minor 번호(현재 0) | 새 chunk 종류·flag가 추가될 때 | 높아도 열기. 모르는 종류는 필수 flag가 없으면 무시 |
| manifest `wgba`(현재 1) | 기존 필드의 의미가 변경되거나 삭제될 때만(새 필드는 올리지 않음) | 더 높으면 열지 않음 |
| `needs` | 번호 대신 "이 기능이 반드시 필요함"을 기재 | 모르는 값이면 열지 않음 |
| 틀 API `webgba.version`(현재 1) | 기존 함수의 의미가 변경될 때만 | 게임이 확인해 대응 |
| 롬 chunk WGRM 형식(현재 1) | 롬 헤더가 변경될 때 | 모르면 열지 않음 |
| 게임 `version` | 제작자 재량(콘텐츠 변경 시) | 업데이트 여부 구분·표시에만 사용 |

레거시 파일: TOC·manifest가 없는 `.wgba`(wasm 그대로, 또는 끝에 `webgba.rom`만 있는 파일)도 webGBA는 계속 지원합니다. 이때는 ① · 240×160 · GBA 버튼 · 이름은 파일 이름으로 처리합니다.

---

## AI 전용 프롬프트

아래 내용 전체를 사용 중인 AI에 붙여 넣고, 게임 wasm 파일을 알려 주세요. AI가 이 규격대로 `.wgba`를 생성합니다.

````text
너는 내 WebAssembly 게임을 webGBA의 .wgba 규격 1 파일로 패키징하는 작업을 돕는다. 아래 규격을 그대로 지키고, 모르는 내용은 지어내지 말고 나에게 확인한다.

[먼저 나에게 확인할 항목]
- 게임 wasm 파일, 함께 빌드된 JS(emscripten Glue 등) 유무, 데이터 파일 목록, 롬처럼 게임 메모리에 배치할 큰 데이터 유무
- 게임 이름(언어별 가능), 게임 id(소문자 역도메인, 예 io.github.내아이디.게임이름 — 한 번 정하면 변경하지 않음), 버전(x.y.z)
- 화면 크기, 사용하는 버튼과 각 버튼의 의미, 세이브 유무, 마우스 사용 여부
- 롬팩 그림 유무(라벨 48×32·앞면 54×44·옆면 18×46의 같은 배수 1~4배, PNG 또는 무손실 WebP — 모두 선택), 롬팩 몸통 색(#RRGGBB)
- 포함할 데이터에 대한 권리 보유 여부(없으면 포함하지 않는다)

[파일 구조]
- .wgba는 파일 전체가 올바른 wasm이다: wasm 헤더 8바이트(00 61 73 6D 01 00 00 00) 뒤에 section이 이어진다. custom section = 바이트 00 + section 길이(LEB128, 이름 길이 필드부터 끝까지) + 이름 길이(LEB128) + 이름(UTF-8) + 내용.
- 순서: "webgba.toc"(TOC, 반드시 첫 section) → "webgba.manifest"(manifest JSON) → "webgba.cart.label" → "webgba.cart.front" → "webgba.cart.spine"(롬팩 그림, 있는 것만) → "webgba.js"(runtime script만) → 원래 wasm section = chunk "code" → "webgba.data.<이름>"(선택, 64개까지, 이름 27자까지 [a-z0-9][a-z0-9._-]*) → "webgba.rom"(선택, 있으면 파일 맨 끝).
- chunk code = 입력 wasm에서 이름이 "webgba."로 시작하는 custom section을 모두 제외한 나머지 section을 원래 순서대로 연결한 구간(헤더 8바이트 제외, name 등 다른 custom section은 유지).
- TOC 내용(little endian): "WGTC"(4) · major 번호 u8=1 · minor 번호 u8=0 · 헤더 길이 u16=16 · 항목 길이 u16=80 · 항목 수 u16 · 파일 전체 길이 u32, 이후 항목(파일 안 순서대로).
- 항목 80바이트: chunk 이름 32바이트(ASCII, 남는 바이트 0) · 시작 u32 · 끝 u32 · 압축 해제 크기 u32 · 방식 u8 · 종류 u8 · flag u16 · SHA-256 32바이트.
  - chunk 이름 = section 이름에서 "webgba."를 제외한 값(manifest, cart.label, cart.front, cart.spine, js, code, data.<이름>, rom).
  - 시작 = 해당 section "내용"(이름 뒤) 첫 바이트의 파일 오프셋, 끝 = section 끝(내용 마지막 바이트의 다음). code는 연결한 구간의 처음과 끝.
  - 방식: 0 무압축, 1 zlib(RFC 1950). manifest·cart·code·rom은 0. js·data는 1(또는 0). 압축 해제 크기 = 압축 해제 후 길이(방식 0이면 끝 − 시작).
  - 종류: 0 code · 1 manifest · 2 cart · 3 js · 4 rom · 5 data. flag: manifest·code·js·rom = 1(필수), cart·data = 0.
  - SHA-256 = 파일에 저장된 바이트(시작~끝, 압축된 상태 그대로)의 해시.
- 계산 순서: 항목 수 n → TOC 길이 16+80n → TOC section 전체 길이 → 오프셋 8 + TOC section 길이부터 chunk를 순서대로 배치하며 시작·끝 결정 → TOC 작성(파일 전체 길이 포함). 반복 계산 불필요.
- 롬 chunk 내용(webgba.rom, 방식 0): "WGRM" · 헤더 길이 u16=36 · 형식 u8=1 · 압축 u8(0 무압축, 1 zlib) · 롬 크기 u32(32MB 이하) · 저장 크기 u32 · 롬 SHA-1 20바이트 · 저장된 롬.
- 크기 상한: 파일 512MB, manifest 64KB, 롬팩 그림 한 개 256KB(64KB 권장), JS 16MB, 롬 32MB, TOC 항목 256개.

[manifest webgba.manifest — UTF-8 JSON, BOM 없음]
- 필수: "wgba": 1, "id"(소문자 역도메인, 점 1개 이상, 64자 이하), "version"("x.y.z", 테스트 버전 "-beta.1" 가능), "name"(문자열 또는 {"en":…,"ko":…}, 48자 이하), "runtime"("webapi" 또는 "script").
- 선택: shortName(16자), description, author, license, homepage(https://만), contact, build, needs(["pointer","net","keyboard","state"] 중), screen{width,height(1~1024, 기본 240·160), scale("fit"·"integer")}, save{kind,maxSize,files}, pointer{use}, input{preset,buttons,keyboard}, cart{color, label, front{labelAt}, spine{textArea}}, rom{required}, entry{style,js,args}, files, multiplayer. 모르는 필드는 무시되고, 규격에 없는 값이 반드시 필요하면 "x-"로 시작하는 이름을 사용한다.
- runtime "webapi"인데 롬 chunk가 없으면 반드시 "rom": {"required": false} (없으면 webGBA가 롬 파일 선택을 요청한다).
- cart.label/front/spine은 {"chunk":"cart.label|cart.front|cart.spine","format":"png|webp","width":…,"height":…}를 그림과 같게 작성하고, 포함하지 않는 그림의 항목은 제외하며, 앞면에 labelAt [x,y](기본 [3k,5k]), 옆면에 textArea [x,y,w,h](호스트가 짧은 이름을 세로로 표시, 없으면 문자열 없음)를 설정한다.
- 현재 webGBA는 screen.fps·audio·state.use를 조회하지 않는다(항상 약 59.7275fps). needs에 "net"이 포함되면 현재 webGBA는 열지 않는다.

[runtime "webapi" — JS 없음, 호스트가 wasm을 직접 실행]
- 내보내기 필수: memory, Web_Init() -> i32(0 실패), Web_RunFrame(keys) -> i32(0 정지, keys = 눌린 버튼 비트), Web_GetFramebuffer() -> i32(width×height 픽셀, 픽셀당 R,G,B,A 바이트).
- 선택: Web_SetAudioRate(rate)·Web_GetAudioBuffer()·Web_GetAudioCount()(float32 스테레오 interleaved, 개수 = 좌우 쌍 수) / Web_GetFlash()·Web_GetSaveSize()·Web_SetSaveSize(n)·Web_FlashClear()·Web_TakeFlashDirty()(세이브) / Web_RomBuffer(size)(롬 배치 주소) / Web_Reset() / Web_StateSize()·Web_StateSave(at)·Web_StateLoad(at)·Web_Alloc(n)·Web_Free(at)(퀵슬롯은 다섯 개 모두, Web_StateUsed() 선택) / Web_Pointer(x,y,buttons,wheel)·Web_PointerWanted() / Web_GetHaltReason()·Web_GetTitle()·Web_SetTimeZone(sec).
- 가져오기는 다음 항목만: env.{emscripten_asm_const_int, emscripten_resize_heap, _emscripten_throw_longjmp, emscripten_date_now, emscripten_get_now, emscripten_notify_memory_growth, abort, _abort_js, invoke_*}, wasi_snapshot_preview1.{fd_write, fd_read, fd_close, fd_seek, fd_sync, fd_fdstat_get, environ_get, environ_sizes_get, clock_time_get, random_get, proc_exit}, webgba.v1(() -> (), 동작 없음). 다른 가져오기가 있으면 runtime "script"로 제작한다.
- 240×160·GBA 버튼이 아니거나 롬 없이 실행되는 게임은 가져오기 webgba.v1을 추가한다(이전 버전 webGBA가 열지 않도록). C에서는 __attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void);를 선언하고 Web_Init에서 한 번 호출한다.
- 순서: 인스턴스 → __wasm_call_ctors(없으면 _initialize) → 롬 → 세이브 → Web_Init → 매 프레임 Web_RunFrame. Web_Init 후에는 메모리를 크게 늘리지 않는다.
- 버튼별 bit(0~31). GBA와 같으면 "input": {"preset":"gba"} (A=0 B=1 SELECT=2 START=3 RIGHT=4 LEFT=5 UP=6 DOWN=7 R=8 L=9). GBA와 다르면 반드시 "input": {"preset":"none", "buttons":[…모든 버튼…]} — webapi의 preset 기본값은 "gba"라서 preset을 생략하면 내 버튼이 GBA 10버튼 뒤에 추가되어 bit·role이 중복된다(검사 오류). GBA 10버튼에 몇 개만 추가하려면 preset "gba" + 추가할 버튼(중복되지 않는 bit·role, 예 c=10 d=11).

[runtime "script" — 자체 JS가 있는 게임]
- JS는 출처 없는 sandbox iframe(srcdoc) 안에서 실행된다. 네트워크(fetch·XHR·WebSocket·WebRTC)·IndexedDB·쿠키·실제 localStorage·팝업·상위 창 이동·스레드(SharedArrayBuffer·pthreads)를 사용할 수 없다. localStorage는 메모리 기반 대체 객체다.
- entry 필수. JS chunk 이름은 항상 "js"(entry.js는 생략). entry.style "module": JS가 export default async function start(webgba){…}를 내보낸다. "emscripten": emscripten Glue(일반·MODULARIZE·EXPORT_ES6) — 틀이 Module{canvas, wasmBinary, locateFile, arguments, print, printErr, preRun, onRuntimeInitialized, onAbort}를 전달한다. 데이터 파일은 files 매핑({"파일 이름":"data.<이름>" 또는 "rom"})으로 지정하고, --preload-file의 .data도 같은 방식. 권장 빌드 -sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS.
- webgba 객체: version(1), manifest, lang, canvas(#canvas, screen 크기), wasm()→ArrayBuffer, wasmModule(), chunk(name)→Uint8Array, chunkURL(name)→blob: 주소, save.read()/save.write(bytes)(save.kind "storage"일 때만), state.onSave(fn→Uint8Array)/state.onLoad(fn(bytes)→true|false)(둘 다 호출해야 퀵슬롯 활성화), input.held, on("button"|"pause"|"resume"|"speed", fn), audioContext(), ready()(시작 완료 시 호출), exit(reason), log(level,text), net(현재 null).
- save.kind: "storage"(기본, webgba.save), "localStorage"(틀 localStorage 전체를 세이브로), "files"(emscripten FS의 save.files[0] 경로, FS 내보내기 필요), "none". maxSize 기본 1MB, 16MB까지.
- 버튼별 code(게임이 수신하는 KeyboardEvent.code). 호스트가 사용자가 누른 키를 이 code의 keydown/keyup으로 변환해 전달한다(isTrusted는 false이므로 검사하지 않는다). preset 기본값은 "none".

[버튼]
- 버튼 = {id(영문·숫자·_·- 16자), role, label, bit(webapi) 또는 code(script), keys(기본 키 KeyboardEvent.code 4개까지), pad(게임패드 버튼 번호·"+axis1" 등), touch("auto"·"hide")}. webapi는 32개, script는 24개까지.
- role: up down left right, 앞면 a b c d(최대 4개), l r l2 r2, start select, extra. extra 외에는 role 한 개에 버튼 한 개. C·D를 사용하면 c·d role 버튼을 정의한다 — 이때만 터치 화면 A·B 바로 위 행에 표시된다. 정의하지 않으면 A·B만.
- 기본 키는 role로 결정된다(a=Z·K, b=X·J, c=C·I, d=V·U, l=A, r=S, l2=Q, r2=W, start=Enter, select=Backspace·우측 Shift, 방향=방향키). keys에 호스트 예약 키(Space, Tab, Escape, Pause, F1~F12, P)를 포함하지 않는다.

[멀티플레이 — 규약 초안, 현재 webGBA는 연결을 지원하지 않음]
- manifest multiplayer{protocol:1, players{min,max}, purposes[{id,name,players}], compat, sync}. webapi는 Web_NetWanted·Web_NetEvent·Web_NetOut·Web_NetOutLen·Web_NetOutClear·Web_NetInBuffer·Web_NetIn 일곱 개를 내보내고, script는 webgba.net(현재 null)을 사용한다. 호스트가 Web_NetHost를 호출하지 않거나 webgba.net이 null이면 통신 메뉴를 숨긴다. 게임 JS가 직접 네트워크를 열지 않는다.

[작업 순서]
1. wasm의 가져오기·내보내기를 확인해 runtime을 선택한다(webapi 규약에 맞으면 webapi, 아니면 script).
2. manifest JSON을 작성한다(필수 필드 누락 없이, 모르는 값은 확인한다).
3. 패키징한다. webGBA 저장소(https://github.com/flightrabbit-hash/webGBA)를 다운로드할 수 있으면 해당 폴더에서
   node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir 그림폴더(label.png·front.png·spine.png)] [--js game.js] [--data 이름=파일] [--rom 롬]
   을 실행한다(node 18+, 설치 불필요, cart.*의 chunk·format·width·height는 도구가 채운다). 도구를 사용할 수 없으면 위 [파일 구조]대로 패키징하는 짧은 스크립트(node 또는 python)를 작성한다: webgba.* section 제외 → chunk 준비 → TOC 길이 계산 → 오프셋 순서대로 결정 → SHA-256 → 기록.
4. 검증: node tools/wgba.mjs check game.wgba로 오류 0을 확인한다. 도구가 없으면 직접 확인: WebAssembly.validate, 첫 section이 webgba.toc, TOC 파일 길이 = 실제 길이, 항목별 위치·section 이름·종류·SHA-256, rom은 맨 끝, manifest 필수 필드·version 형식, webapi이면 필수 내보내기·가져오기 목록·bit 중복 없음, script이면 js chunk·entry.style·버튼 code, 롬팩 그림 크기·형식.
5. 생성한 파일 이름·크기·TOC 표·검증 결과를 나에게 보고한다.

[금지 사항]
- 나에게 권리가 없는 롬·그림·음악·데이터를 포함하지 않는다. 다른 회사 상표(게임기 이름·로고 등)를 롬팩 그림에 포함하지 않고, 실제 카트리지 모양·상자 그림을 모방하지 않는다.
- 게임 JS에 네트워크 요청·eval로 외부 코드 수신·호스트(parent·top) 접근·IndexedDB를 포함하지 않는다.
- 같은 게임의 새 버전에서 id를 변경하지 않는다(세이브 연결이 끊김). 버전은 x.y.z로 올린다 — 같은 id의 높은 버전은 webGBA가 확인 없이 업데이트하고, 낮은 버전만 경고한다. 다른 게임에는 다른 id를 사용한다.
- 규격에 없는 필드를 지어내지 않는다(반드시 필요하면 "x-"로 시작하는 이름).
- 스레드(SharedArrayBuffer·pthreads)를 사용하는 빌드로 제작하지 않는다.
- wasm-opt·strip 등의 도구는 custom section을 삭제할 수 있으므로 패키징 전에만 사용하고, 패키징 후에는 실행하지 않는다.
````
