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

## .wgba 만들기 (다른 개발자용)

`.wgba`는 webGBA가 여는 한 개의 게임 파일입니다. **파일 전체가 올바른 wasm**이고, 맨 앞의 TOC(`webgba.toc`)에
manifest·롬팩 그림·JS·데이터 chunk의 시작·끝 오프셋과 SHA-256이 기록됩니다. GBA 게임이 아니어도 wasm 게임이면 사용할 수 있습니다.

- **① Web API(JS 없음)** — wasm이 `Web_Init`·`Web_RunFrame(keys)`·`Web_GetFramebuffer` 등을 내보내면 webGBA가 화면·소리·입력·세이브를 담당합니다.
- **② 자체 JS** — emscripten Glue 코드 등 자체 JS가 있는 게임. JS는 출처 없는 격리 틀(sandbox iframe) 안에서만 실행되고, 네트워크·다른 게임의 저장소·앱 기능에 접근할 수 없습니다.
- **manifest** — 필수: `wgba`(1)·`id`(고정 게임 id — 같은 id의 높은 버전은 확인 없이 업데이트)·`version`(x.y.z)·`name`·`runtime`. 버튼 목록(① 비트 번호·② 키 코드)을 작성하면 키보드·게임패드·터치 버튼 배치는 webGBA가 결정합니다.
- **롬팩 그림** — 웹 버전 라이브러리 책장에 표시되는 롬팩의 라벨(48×32)·앞면(54×44)·옆면(12×44), 같은 배수(권장 2배: 96×64·108×88·24×88), PNG·무손실 WebP. 모두 선택 사항이고, 없으면 몸통 색(`cart.color`)과 이름으로 기본 롬팩을 표시합니다.
- **패키징·검사** — `node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir 그림폴더] [--js game.js]`, `node tools/wgba.mjs check game.wgba`. 실행해 볼 수 있는 예제: [docs/wgba/examples/hello-webapi](docs/wgba/examples/hello-webapi).
- **AI로 생성** — 규격 문서 맨 아래 "AI 전용 프롬프트"를 사용 중인 AI에 붙여 넣으면 wasm을 `.wgba`로 패키징합니다.

**권리를 가진 데이터만 포함하세요.** 타인의 롬·그림·음악·상표(게임기 이름·로고 등)가 포함된 `.wgba`를 배포하지 마세요.
TOC가 없는 레거시 `.wgba`(wasm 그대로, 또는 롬 section만 추가한 파일)도 그대로 열립니다.

규격 전체: [docs/wgba/WGBA_SPEC.ko.md](docs/wgba/WGBA_SPEC.ko.md) (English: [WGBA_SPEC.en.md](docs/wgba/WGBA_SPEC.en.md)) · manifest 스키마: [wgba-manifest.schema.json](docs/wgba/wgba-manifest.schema.json)

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
docs/wgba/     .wgba 규격 문서(한국어·English) · manifest 스키마 · 예제
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
