# webGBA

**한국어** · [English](README.en.md) · [日本語](README.ja.md)

GBA·GB·GBC 롬(`.gba`·`.gb`·`.gbc`·`.zip`)과 웹 빌드(`.wasm`·`.wgba`)를 실행하는 Windows 실행기입니다.
Tauri 2 + Rust 기반에 WebView 화면을 구성했고, 구조는 아비터(Arbiter)와 같습니다. 게임 실행(코어·키·소리)은
WebView가, 파일·창은 Rust가 담당합니다. `.gba`·`.gb`·`.gbc`는 내장 mGBA 0.10.1 코어(wasm)로 실행하고, `.wasm`·`.wgba`는
해당 웹 빌드를 앱 안에서 그대로 실행합니다. **관리자 권한 없이** 일반 권한(`asInvoker`)으로 실행됩니다.

> **롬과 BIOS는 포함되어 있지 않습니다.** 소유한 롬 파일을 여세요. GBA 공식 BIOS도 포함되어 있지 않으며 mGBA 내장 HLE BIOS를 사용합니다. GB·GBC는 부트 롬 없이 부팅 직후 상태에서 시작합니다.

**웹 버전:** https://webgba.vercel.app — 휴대폰·PC 브라우저용 설치형 웹 앱(PWA)입니다(`.gba`·`.gb`·`.gbc`·`.zip`·`.wgba`·`.wasm`·`.wgbp`).
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
- [AI 전용 프롬프트](#ai-전용-프롬프트) — AI에 붙여 넣으면 이 규격대로 `.wgba`를 생성(12장 온라인 업데이트 배포 포함)

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

### 웹 버전·짝 찾기 서버를 직접 배포할 때 (운영자용)

웹 버전(`web/dist`)과 짝 찾기 서버(`api/v1/mp/[op].js`, Vercel 함수 1개)는 Vercel에 배포합니다. 값은 Vercel 프로젝트의 환경 변수(Production)에 직접 등록하고, 저장소·파일에는 쓰지 않습니다.

| 환경 변수 | 용도 | 없으면 |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN`(또는 `KV_REST_API_URL`·`KV_REST_API_TOKEN`) | 방·연결 정보 저장(Upstash Redis REST) | 짝 찾기 서버 503 → 앱은 연결 코드(·QR)로 안내 |
| `TURN_KEY_ID`·`TURN_KEY_API_TOKEN` | Cloudflare Realtime TURN 키 — 1시간짜리 접속 정보 발급(`/credentials/generate-ice-servers`) | 4개 중 하나라도 없으면 중계 서버 없이 STUN만 |
| `CF_ACCOUNT_ID`·`CF_ANALYTICS_API_TOKEN` | 발급 전 최근 31일 중계 사용량 확인(GraphQL `callsTurnUsageAdaptiveGroups`, 토큰 권한 Account › Account Analytics › Read) — 900GB 이상이면 발급 중단 | 〃 |

- Cloudflare는 사용량이 한도를 넘어도 자동으로 멈추지 않으므로 발급 경로가 한도를 지킵니다. 한도 값·기간은 `api/_mp/turn.js`의 `TURN_CAP` 하나로 바꿉니다.

관리자 모드 "롬 가져오기"(`api/v1/admin/[op].js`, webGBA 0.9.1부터, 운영자 1명 전용 — 공개 주소를 끈 비공개 R2 버킷의 `.wgba`를 6자리 확인 뒤 내려받음):

| 환경 변수 | 용도 | 없으면 |
|---|---|---|
| `R2_PRIVATE_BUCKET`·`R2_PRIVATE_ACCESS_KEY_ID`·`R2_PRIVATE_SECRET_ACCESS_KEY`·`CF_ACCOUNT_ID` | 비공개 버킷 읽기 전용 토큰 — 키 파일 `authentication.key`·`wgba/` 목록·5분짜리 내려받기 주소(presigned GET) | 관리자 API 503 → 앱은 "서버에 관리자 모드 설정이 존재하지 않습니다" |
| 위 저장소(`UPSTASH_*`/`KV_*`) | 입력 횟수 제한(IP당 시간당 5번 · 전체 실패 하루 30번) | 입력 확인 503(확인하지 않음) |

- 비공개 버킷 CORS = 웹 버전 출처의 GET만. Windows 앱은 웹뷰 대신 Windows 내장 WinHTTP로 받으므로 CORS가 필요 없습니다.
- 키 파일·`.wgba` 올리기: `node tools/wgba.mjs admin-key`(PowerShell, 6자리를 화면에 표시하지 않음) · `node tools/wgba.mjs upload [<발행 폴더|묶음>] --wgba <새.wgba>`(12.5).

---

## 주요 기능

- **.gba · .zip** — 앱 `bin\core\mgba_core.wasm`(mGBA 0.10.1)로 실행. 화면 240x160(우측 영역에 맞춤, 비율 유지. 설정에서 정수 배율), 소리, 키 설정, 게임패드,
  빨리 감기(2·3·4·8배), 일시정지, 재시작, 세이브(롬 옆 `<롬 파일명>.sav`, VBA·mGBA와 같은 형식),
  상태 저장 슬롯 1~9(멀티플레이 중에는 저장·불러오기 모두 사용할 수 없음). `.zip`은 내부의 `.gba`·`.agb`·`.gb`·`.gbc`·`.bin`을 추출해 엽니다(게임이 여러 개면 목록에서 골라 등록).
- **.gb · .gbc (GB·GBC)** — 같은 mGBA 코어로 실행. 형식은 확장자가 아니라 롬 머리로 판별합니다(mGBA와 같은 규칙. GBC 전용·GB·GBC 겸용 = GBC 색, 흑백 GB = mGBA 기본 회색 4단계).
  화면 160x144(10:9, 화면 칸 비율도 10:9), 키는 A·B·START·SELECT·방향 8개(L·R 없음 — 터치 버튼·키 설정·조작법에서도 숨김. 바꾼 키는 GBA 게임과 같은 앱 전체 키),
  배터리 세이브(롬 옆 `<롬 파일명>.sav`, .gba와 같은 위치·이름), 카트리지 시계(MBC3 RTC — 실제 시각으로 진행, 세이브 끝 48바이트에 함께 저장 — mGBA·VBA-M과 같은 형식), 상태 저장 슬롯·웹 버전 자동 저장.
  슈퍼 게임보이 테두리·색, GB 통신 케이블, 흑백 GB 색 팔레트 선택은 지원하지 않습니다(SGB 지원 게임도 GB·GBC로 실행).
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
- **웹 빌드의 롬 선택** — 설정 창 › 일반 › 파일 › **웹 빌드용 롬 파일명**. 입력하면 `.wgba`·`.wasm`과 같은 폴더(없으면 상위 폴더)에서 해당 파일명의 롬을 사용합니다.
  비워 두면(기본) `<빌드 이름>.gba` → 같은 폴더의 유일한 `.gba` 순서로 검색하고, 여러 개라 결정할 수 없으면 처음 열 때 선택하게 한 후 각 빌드별로 기억합니다.
  게임 메뉴 › 롬 지정…으로 언제든 변경할 수 있습니다. 롬 포함 `.wgba`는 이 규칙을 사용하지 않고 내부의 롬을 사용합니다.
- **.wgbp 파일 연결** — 탐색기에서 `.wgbp`(공유용 패치)를 더블클릭하면 webGBA로 열고 롬을 선택합니다. 관리자 권한 없이 사용자 범위(HKCU)에 등록합니다.
  더블클릭으로 게임이 바로 실행되는 `.wgba`·`.gb`·`.gbc`는 연결하지 않습니다(열기·Drag & Drop으로 실행). 이전 버전이 등록한 `.wgba`·`.gb`·`.gbc` 연결은 앱을 실행할 때 webGBA가 추가한 값만 삭제합니다.
  연결 해제는 **설정 창 › 일반 › 파일 › .wgbp 파일을 webGBA로 열기**에서 합니다.
- **세이브는 연 파일 옆 한 개** — `.gba`·`.gb`·`.gbc`·`.zip`·`.wgba`·`.wasm` 모두 연 파일 옆 `<파일명>.sav` 한 개를 조회·기록합니다(VBA 등 다른 실행기의 세이브를 같은 파일명으로 두면 그대로 이어집니다).
  게임이 저장하면 약 1초 후, 창을 닫거나 다른 게임을 열 때도 해당 `.sav` 파일을 직접 Overwrite합니다. 백업 파일은 생성하지 않습니다.
  기록에 실패하면(읽기 전용 등) 상태 줄에 안내하고 다음 저장이나 닫을 때 다시 기록합니다. 다른 세이브를 사용하려면 파일 메뉴 › 세이브 가져오기…(옆 `.sav`를 가져온 파일 내용으로 Overwrite), 내보내려면 세이브 내보내기….
- **방향키 동시 입력** — 설정 창 › 일반 › 게임. 두 방향을 동시에 눌렀을 때 게임에 전달할 방향을 선택합니다:
  **설정 안함**(기본, 마지막에 누른 방향으로 즉시 전환) · 대각선 입력(←+→, ↑+↓만 마지막 입력) · 모든 입력(GBA 실기와 같음).
  설명서에 `input.dpad`가 있는 게임은 해당 값이 기본값이며, 해당 게임 실행 중에 변경한 값은 게임별로 기억합니다.
- **연사** — 설정 창 › 일반 › 게임(웹 버전 설정). 켜면 A·B·C·D·L·R(role `a`·`b`·`c`·`d`·`l`·`r`) 버튼을 누르고 있는 동안 연속으로 누릅니다(방향·START·SELECT 제외).
  속도 1~9단계 = 초당 1·2·3·4·6·8·12·20·30회(기본 5단계 = 초당 6회, 1단계 = 30프레임 누름·30프레임 뗌, 9단계 = 2프레임마다 누름·뗌). 게임 프레임 기준이라 빨리 감기 중에도 같은 무늬이고, 키보드·게임패드·화면 버튼에 같은 설정이 적용됩니다(앱 전체 설정 하나). 기본 끔.
  게임이 연사를 멈춘 화면(메뉴·배틀 등, ① `Web_AutoFireOff()`)에서는 누르고 있는 버튼을 누른 그대로 전달합니다.
- **RS 버튼(순서 입력)** — 정해 둔 키 순서(예: A → A → ↓ → A+B)를 한 번에 입력합니다. 단계마다 동시에 누를 키(A·B·C·D·L·R·START·SELECT·방향, 대각선은 두 방향 함께)·누르는 시간·다음 단계까지 간격을 프레임(1/60초, ms 함께 표시) 단위로 정합니다(기본 누름 3·간격 3프레임, 단계 32개까지).
  게임마다 프리셋 5개를 저장하고(이름 12자까지 변경·삭제), 사용 중 프리셋 하나를 재생합니다. 설정의 X·1~5 막대에서 고르며(빈 번호 = 새 프리셋), X(사용 안함)이면 RS 버튼을 숨기고 RS 키도 동작하지 않습니다(설명서에 `input.rs`가 있는 게임은 프리셋 1이 기본, 없으면 사용 안함). 프리셋은 설정에서만 바꿉니다.
  재생 규칙: RS를 한 번 누르면 처음부터 한 번 재생 · 누르고 있으면 마지막 단계의 키를 계속 누름(떼면 끝) · 재생 중 다른 키(키보드·게임패드·화면 버튼)를 누르면 그 프레임부터 RS 입력을 멈추고 그 키를 입력 · 재생 중 RS를 다시 누르면 처음부터 · 연사는 RS 입력에 적용하지 않음 · 일시정지 중에는 재생하지 않음.
  입력은 게임 프레임마다 일반 입력과 같은 경로로 들어가므로 빨리 감기·멀티플레이 중에도 같은 프레임 결과입니다(② 자체 JS 게임은 화면 갱신 시간 기준).
  Windows 앱: 설정 창 › 키의 "RS 버튼" 칸에 키보드 키나 게임패드 버튼을 지정(기본 없음)하고, 같은 탭 아래 RS 버튼에서 프리셋·단계를 편집합니다. 웹 버전: 화면의 RS 버튼(버튼 묶음 위 우측 알약, 다른 버튼과 다른 색)과 설정 › RS 버튼 › 편집.
- **빨리 감기 소리** — 빨리 감기 중에도 배수만큼 빨라진 소리를 출력합니다. 소리를 끄려면 설정 창 › 일반 › 소리 › 빨리 감기 중 소리 끄기.
- **열기** — 열기 대화상자, 탐색기에서 Drag & Drop, 같은 폴더의 게임 목록(`.gba`·`.gb`·`.gbc`·`.wgba`·`.wasm`, 이전·다음 게임으로 이동),
  즐겨찾기, 최근 연 파일, 연결 프로그램 인자(이미 실행 중이면 해당 창에서 열기). 화면에는 경로 없이 파일명만 표시됩니다.
- **도구 막대** — 좌측 세로 막대. 접으면 게임 화면을 가리지 않고 접은 만큼 넓어지며, 접힘 상태를 기억합니다.
- **설정 창 (Ctrl+,)** — 일반·키·테마·언어 4개 탭. 화면 맞춤·정수 배율, 음량·빨리 감기 배수, 방향키 동시 입력, 연사, 상태 슬롯, 멀티플레이 사용·닉네임, 세이브, 파일 연결·롬 파일명, 즐겨찾기·최근 목록 비우기, 키 설정·RS 버튼을 한 개의 창에서 변경합니다.
- **테마 13개** — 아비터와 같은 테마(어두운 테마 7·밝은 테마 5·사용자 지정, 웹 버전은 사용자 지정 없이 12개 — 목록에 테마마다 대표 색 4개 표시). webGBA 화면 전체(도구 막대·목록·창·대화 상자)에 즉시 적용되고, 게임 화면은 변경하지 않습니다.
- **언어** — 한국어(기본)·English·日本語. 설정 창 › 언어에서 변경하면 재시작 없이 즉시 적용되고 기억합니다.
- **멀티플레이** — 지원하는 게임은 방 코드 6자리로 같은 Wi-Fi·다른 네트워크의 기기와 연결합니다(같은 Wi-Fi의 근처 방 목록, 짝 찾기 서버 없이 연결 코드·QR을 주고받는 "인터넷 없이 연결"도 사용 가능). 기기 간 직접 연결(WebRTC)을 먼저 시도하고, 직접 연결이 되지 않는 망(휴대폰 데이터·회사·학교 망 등)에서는 **Cloudflare 중계 서버(TURN)**를 거칩니다. 중계 서버를 거쳐도 게임 내용은 암호화되어(DTLS) 중계 서버가 볼 수 없습니다.
  연결 정보에는 공인 IP(공인 주소 후보)가 들어가므로 **상대 기기에 이 기기의 공인 IP가 보입니다**. 연결 정보(공인 IP 포함)는 짝 찾기 서버(`webgba.vercel.app/api/v1/mp`)에 최대 2분 30초 저장됩니다. 설정 › 멀티플레이 › **멀티플레이 사용**(기본 켬)을 비활성화하면 멀티플레이 창을 열 수 없고 연결도 하지 않습니다(바로 적용). 다른 기기에 표시되는 닉네임(12자까지)도 같은 곳에서 변경합니다. 중계 서버 무료 한도를 지키려고 최근 31일 중계 사용량이 900GB 이상이면 중계 접속 정보 발급을 멈추고, 그동안은 STUN만으로 연결합니다.
  세션 중에는 빨리 감기·상태 저장 슬롯·다시 시작을 사용할 수 없습니다. 플레이어 상태 표는 웹 버전 상단 "멀티플레이" 버튼, Windows 앱 도구 막대 "멀티플레이" 버튼 또는 Tab으로 엽니다.
  다시 들어오기(`rejoin`)를 지원하는 게임은 연결이 끊긴 유저의 자리를 보관해 같은 자리로 다시 연결하고, 방장이 앱을 닫아도 방이 2분 동안 남습니다. 방장이 2분 안에 앱을 다시 열고 같은 게임을 열면 멀티플레이 창에 **이전 방으로 돌아가기**가 나오고, 같은 방 코드의 방장 자리로 돌아갑니다. 그동안 유저 화면은 "방장을 기다리는 중… m:ss 남음"으로 게임이 멈추고, 방장이 돌아오면 자동으로 다시 연결되어 유저 한 명의 게임 상태를 받아 이어서 합니다. 2분이 지나면 세션이 끝납니다. 유저가 게임 도중 앱을 닫은 경우에도 방장이 자리를 보관하고, 같은 기기에서 같은 게임을 다시 열면 **이전 방으로 돌아가기**로 같은 자리에 돌아갑니다.
  멀티플레이 규약 번호가 이 webGBA보다 새로운 게임은 멀티플레이 없이 실행하고, 멀티플레이 버튼·연결 창에 "이 게임의 멀티플레이는 새 webGBA가 필요합니다"를 출력합니다.

- **온라인 업데이트** — 앱을 실행할 때마다 한 번, 인터넷에 연결되어 있으면 라이브러리(Windows 앱은 즐겨찾기·최근·같은 폴더)의 `.wgba`에 새 버전이 있는지 확인합니다. 새 버전이 있을 때만 업데이트 창을 표시하고, "업데이트"를 누르면 차이 패치를 받아 적용합니다(서명·SHA-1 확인, 실패하면 기존 파일 그대로, 세이브 유지). 다른 버전에서 만든 퀵슬롯은 불러오지 않습니다. 제작자용 규격은 [12장](#12-온라인-업데이트-update-규격-1-확장).
- **webGBA 업데이트(Windows 앱)** — 0.9.0부터 앱을 실행할 때마다 `.wgba` 확인과 같은 목록(`index.json`)으로 webGBA 자체의 새 버전도 확인합니다(요청 수 그대로). 새 버전이 있으면 업데이트 창을 표시하고, "UPDATE"를 누르면 바뀐 파일만(`webgba.exe` 등) 받아 서명·SHA-256을 확인한 뒤 파일을 교체하고 앱을 다시 시작합니다. 설정(`bin/ini`)·로그·퀵슬롯·WebView 데이터·세이브(게임 옆 `.sav`)는 그대로 유지됩니다. 받기·교체에 실패하면 기존 파일로 되돌립니다. "LATER"를 눌러도 같은 실행 동안 정보 화면에서 업데이트할 수 있습니다. 웹 버전은 늘 최신이라 대상이 아닙니다. 규격은 [12.6](#126-webgba-자체-업데이트-windows-앱).

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
| 멀티플레이 상태 표(세션 중 — 누르는 동안 표시, 짧게 누르면 열어 둠) | Tab |
| RS 버튼(순서 입력) | 설정 창 › 키에서 지정(기본 없음, 게임패드 버튼도 가능) |
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
src-tauri/     Rust — 창 · 파일 · 세이브 · 웹 빌드 출처 · .wgbp 연결
web/           웹 버전(PWA) — src/(화면) · build.mjs(조립) · test/(테스트 도구)
api/           짝 찾기 서버(Vercel 함수) — v1/mp/[op].js · _mp/(방·우편함·TURN 발급)
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
| jsQR 1.4.0 | 연결 코드 QR 읽기(BarcodeDetector 없는 브라우저) | Apache-2.0 |

mGBA — Copyright (c) 2013-2022 Jeffrey Pfau 외 기여자 · https://mgba.io

---

Copyright © 2026 flightrabbit

---

## .wgba 규격 1 (다른 개발자용)

`.wgba`는 webGBA가 여는 한 개의 게임 파일입니다. **파일 전체가 올바른 WebAssembly(wasm) 모듈**이고, 내부의
custom section에 manifest·롬팩 그림·JS·데이터를 저장하며, 맨 앞의 **TOC**에 각 chunk의 시작·끝 오프셋과
해시를 기록합니다. GBA 게임이 아니어도 됩니다 — wasm으로 빌드한 게임이면 `.wgba`로 패키징해 webGBA(Windows 앱·웹 버전)에서
실행할 수 있습니다.

> 모든 장(7장 멀티플레이 포함)은 현재 webGBA(v0.6.1, Windows 앱·웹 버전)의 동작과 같습니다. 7장 중 키 동기화(`sync: "inputs"`, 7.6)만 현재 webGBA가 지원하지 않습니다.
> 아래 내용 중 "현재 webGBA"로 기재한 부분은 규격이 아니라 현재 앱의 동작입니다(다른 호스트는 달라도 됨).

1. [개요](#1-개요)
2. [파일 구조](#2-파일-구조)
3. [manifest](#3-manifest)
4. [실행 방식](#4-실행-방식) — ① Web API(JS 없음) · ② 자체 JS(격리 실행)
5. [키 매핑](#5-키-매핑)
6. [롬팩 그림](#6-롬팩-그림) — 라벨 · 앞면 · 옆면
7. [멀티플레이](#7-멀티플레이) — 방 코드·근처 방·연결 코드, 상태 표, 다시 들어오기, 중계 서버, 중간 참가
8. [보안 규칙](#8-보안-규칙)
9. [생성 예시](#9-생성-예시)
10. [검증](#10-검증)
11. [형식 번호와 버전](#11-형식-번호와-버전)
12. [온라인 업데이트](#12-온라인-업데이트-update-규격-1-확장) — 버전 파일·차이 패치·배포 도구
13. [모바일 .wmba](#13-모바일-wmba-규격-1-확장) — 피처폰 게임·앱 파일 묶음·폰 키·모바일 화면
14. [Android .wapk](#14-android-wapk-규격-1-확장) — Android 앱·터치·화면 크기 변경·방향 고정·전체 화면
15. [AI 전용 프롬프트](#ai-전용-프롬프트) — README 맨 아래

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
| `name` | 문자열 또는 객체 | 게임 이름(라이브러리·첫 화면 최근 목록·창 제목 등, 칸마다 48자 이하). 문자열 = 모든 언어에 같은 이름. 언어별 = ① `en`(영어) ② `ko`(한국어) ③ `ja`(일본어) 칸이 있는 객체(아래 "언어별 글") |
| `runtime` | 문자열 | `"webapi"`(①) 또는 `"script"`(②) |

**언어별 글**: `name`·`shortName`·버튼 `label`·멀티플레이 글(`purposes[].name`·상태 메뉴) 등 "문자열 또는 객체"인 글은 같은 규칙입니다.

- 객체 칸 = ① `"en"` 영어 · ② `"ko"` 한국어 · ③ `"ja"` 일본어. 그 밖의 언어 코드 칸도 작성할 수 있습니다.
- 표시 순서: 현재 화면 언어 칸 → 없으면 `en` → `ko` → `ja` → 그 밖의 칸(작성한 순서). 빈 칸(`""`·공백만)은 없는 칸으로 봅니다.
- 필요한 칸만 작성하면 됩니다. 예 `{"en": "Demon Front", "ko": "데몬프론트"}`는 일본어 화면에서 `Demon Front`를 표시합니다.
- 한 줄 문자열(`"name": "Demon Front"`)은 모든 언어에 그대로 표시합니다(기존 .wgba 그대로 동작).
- 사용자가 웹 버전 라이브러리에서 이름을 바꾼 게임은 바꾼 이름을 표시합니다.

#### 3.2 선택 필드

| 필드 | 타입·기본값 | 설명 |
| --- | --- | --- |
| `shortName` | 문자열·객체 | 롬팩 옆면 이름, 라벨 그림이 없을 때 라벨에 사용하는 짧은 이름(칸마다 16자 이하 권장). `name`과 같은 언어 칸·표시 순서. 없거나 모든 칸이 비면 `name` |
| `description` | 문자열·객체 | 소개(500자 이하) |
| `author` | 문자열 | 제작자. 정보 화면에 표시 |
| `license` · `homepage` · `contact` | 문자열 | 라이선스(SPDX 이름 권장 `MIT`), `https://` 주소(다른 주소는 오류), 연락처. 정보 화면 표시용으로 예약한 필드(현재 webGBA는 표시하지 않음) |
| `build` | 문자열 | 빌드 표시(커밋 등, 64자). 표시용 문자열이며, 빌드 식별(3.4)은 호스트가 별도로 계산 |
| `needs` | 문자열 배열 | 이 기능이 없는 호스트는 **열지 않음**: `"pointer"`(마우스 필수), `"net"`(멀티플레이 필수), `"keyboard"`(실제 키보드 필수), `"state"`. 모르는 값이 있으면 열지 않고 "새 webGBA가 필요합니다" 안내. 현재 webGBA는 네 값을 모두 지원해 `needs: ["net"]` 게임도 엶(멀티플레이를 모르는 옛 webGBA는 열지 않음) |
| `screen` | 객체 | `width`·`height`(1~1024, 기본 240·160), `scale` `"fit"`(기본, 비율 유지 최대 크기)·`"integer"`(정수 배율 권장 — 실제 배율은 webGBA 사용자 설정이 우선: 설정이 "정수 배율"일 때만 정수 배율, "영역에 맞춤"이면 이 값이어도 영역에 맞춰 표시). `fps`는 예약(현재 webGBA는 항상 GBA 속도 약 59.7275fps로 실행). 픽셀은 항상 nearest neighbor 방식으로 표시 |
| `display` | 객체 | `aspect`: 표시 비율 `"W:H"`(예 `"4:3"`, W·H는 1~1024 정수, 비율 1:4~4:1). 화면 버퍼(`screen`)와 다른 비율로 늘려 표시합니다(원래 모니터 비율, 정사각형이 아닌 픽셀). 없으면 화면 버퍼 비율(정사각형 픽셀). 늘려도 픽셀 보간은 하지 않습니다(nearest neighbor). 설정이 "정수 배율"이면 세로만 정수 배율, 가로는 표시 비율에 맞춘 비정수 배율입니다. Windows 앱 화면·웹 버전 화면 칸 모두 이 비율(없으면 화면 버퍼 비율, GBA 게임은 3:2)을 따릅니다 |
| `audio` | 객체 | `use` — 예약(현재 webGBA는 조회하지 않음). ①은 소리 내보내기가 있으면 소리를 출력 |
| `save` | 객체 | `kind`: `"flash"`(① — 현재 webGBA는 ①의 `kind`를 조회하지 않고 `Web_GetFlash`가 있으면 세이브) · `"storage"`(② 기본, `webgba.save`) · `"localStorage"`(②, 틀의 대체 localStorage 전체를 세이브로) · `"files"`(②, emscripten 파일 `files[0]`) · `"none"`. `maxSize`(②, 바이트, 기본 1MB, 16MB까지), `files`(② `"files"`일 때 경로 배열 — 현재 webGBA는 첫 경로만 사용) |
| `state` | 객체 | `use` — 예약. 현재 webGBA는 ①은 상태 내보내기(4.1.1)가 모두 있으면, ②는 게임이 `webgba.state.onSave`·`onLoad`를 모두 호출하면 퀵슬롯을 활성화 |
| `pointer` | 객체 | `use`: 게임이 마우스·터치 좌표를 사용. ①은 `Web_Pointer` 내보내기 여부로 결정되고, ②는 `true`이면 캔버스의 우클릭 메뉴를 차단 |
| `input` | 객체 | 버튼 목록·기본 배치. [5장](#5-키-매핑). 없으면 ①은 `{"preset": "gba"}`, ②는 버튼 없음 |
| `cart` | 객체 | 롬팩: `color` `"#RRGGBB"`(몸통 색), 그림 `label`·`front`·`spine`(`{chunk, format, width, height}` + 앞면 `labelAt`·옆면 `textArea`). [6장](#6-롬팩-그림) |
| `rom` | 객체 | ①: `required`(기본 true — **롬 chunk가 없고 `false`가 아니면 호스트가 사용자에게 롬 파일을 선택하게 함. 롬 없이 실행되는 게임은 반드시 `false`**). `sha1`·`hint`는 예약(현재는 `sha1`이 롬 chunk와 다르면 검사 경고만) |
| `entry` | 객체 | ② 필수: `style` `"module"`·`"emscripten"`, `js` chunk 이름(규격 1에서는 항상 `"js"` — 생략해도 `"js"`, 다른 값은 `check`가 경고 후 무시), `args`(emscripten `arguments`) |
| `files` | 객체 | ②만: 게임 JS가 조회하는 파일 이름 → chunk 이름(`data.<이름>` 또는 `rom`). 예 `{"game.data": "data.game"}` |
| `multiplayer` | 객체 | 멀티플레이 — 인원·용도·호환·상태 표·다시 들어오기·중간 참가·연결 서버. [7장](#7-멀티플레이) |
| `update` | 객체 | 온라인 업데이트 — `feed`(버전 파일 `https://` 주소)·`key`(서명 공개 키). [12장](#12-온라인-업데이트-update-규격-1-확장) |

#### 3.3 예시 (① 롬 없는 240×160 게임)

```json
{
  "wgba": 1,
  "id": "io.github.someone.pixelquest",
  "version": "1.2.0",
  "name": { "en": "Pixel Quest", "ko": "픽셀 퀘스트", "ja": "ピクセルクエスト" },
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
| `Web_AutoFireOff()` → i32 | | 1이면 지금 연사를 적용하지 않음 — 호스트가 누르고 있는 버튼을 누른 그대로 전달(메뉴·배틀처럼 연사가 방해되는 화면). 연사가 켜져 있고 연사 버튼을 누르고 있을 때 `Web_RunFrame` 전마다 조회. 없으면 항상 연사([5.2](#52-role-기본값)) |
| `Web_GetHaltReason()` · `Web_GetTitle()` · `Web_SetTimeZone(sec)` | | 정지 사유 문자열(NUL 종료) 주소 / 제목 / 시간대 오프셋(UTC 기준 동쪽 방향, 초) |
| `Web_Net*` | | 멀티플레이 — [7장](#7-멀티플레이)(7.3, 상태 표 `Web_NetBoard` 7.9.2) |
| `Web_GpuStart(version)` → i32 · `Web_GpuList()` → ptr · `Web_GpuListLen()` → u32 · `Web_GpuListDone()` · `Web_GpuSync(reason)` · `Web_GpuStop()` · `Web_GpuOverlay()` → i32 | | GPU 그리기(WebGL2) — [4.1.4](#414-gpu-그리기-선택). 앞의 네 개가 모두 있으면 사용 |

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

##### 4.1.4 GPU 그리기 (선택)

화면을 CPU 대신 WebGL2로 그리는 게임용입니다. 그리기 규칙(셰이더 GLSL ES 3.00)은 게임이 제공하고, 호스트는 게임이 기록한 명령 목록을 순서대로 실행합니다. 새 가져오기는 없으므로 이 기능을 모르는 webGBA·WebGL2가 없는 브라우저에서는 호스트가 `Web_GpuStart`를 호출하지 않고, 게임은 기존 화면 버퍼(`Web_GetFramebuffer`)로 그립니다. 설명서 항목은 필요하지 않습니다.

1. 호스트는 `Web_Init` 후 WebGL2 컨텍스트를 생성하고 `Web_GpuStart(1)`을 호출합니다. 1을 반환하면 GPU 모드, 0이면 기존 방식입니다. 인스턴스를 새로 생성하면(재시작) 다시 호출합니다.
2. GPU 모드에서는 `Web_RunFrame`마다 `Web_GpuList()` → `Web_GpuListLen()` 순서로 목록(u32 단어)을 받아 순서대로 실행하고 `Web_GpuListDone()`을 호출합니다. 목록은 실행 후 비워질 때까지 프레임마다 이어 붙습니다(여러 프레임을 한 번에 실행해도 됨).
3. 그림 = 출력 대상 0(`screen.width × height` RGBA8, GL 좌표 — 0행이 하단). 화면에 표시할 때 `Web_GpuOverlay()`: 0 = 출력 그대로, 1 = `Web_GetFramebuffer`를 위에 합성(premultiplied alpha, 0행이 상단), 2 = 이번 프레임은 `Web_GetFramebuffer`가 그림.
4. 퀵슬롯 저장 전 `Web_GpuSync(1)`을 호출하고 목록을 실행한 후 `Web_StateSave`를 호출합니다(게임이 GPU 그림을 메모리로 읽는 `READ`를 기록). `reason`은 현재 1(퀵슬롯 저장 직전)만 정의되어 있고, 호스트는 다른 값으로 호출하지 않습니다.
5. 컨텍스트 손실·셰이더 오류 등으로 실행하지 못하면 `Web_GpuStop()`을 호출하고 기존 방식으로 표시합니다. 게임은 다음 프레임부터 CPU로 그립니다.
6. 사용자가 끄기: 웹 버전 `localStorage`의 `webgba.gpu`가 `"0"`이면 호스트가 GPU 모드를 시작하지 않습니다(테스트용).

명령 레코드 = 첫 단어 `opcode | 단어 수 << 8`(단어 수는 첫 단어 포함) + 값. 주소는 wasm 메모리 바이트 위치, 실수는 f32 비트입니다.

| opcode | 명령 | 값 |
| --- | --- | --- |
| 1 | `PROGRAM` | id, 정점 셰이더 주소·길이, 조각 셰이더 주소·길이, 인스턴스 속성 수(속성마다 `ivec4`, location 0부터), uniform 이름 목록(NUL 구분) 주소·길이 — uniform 번호 = 목록 순서 |
| 2 | `TEXTURE` | id(1 이상), 형식(1 RGBA8 · 2 RGB10_A2 · 3 R16UI), 너비, 높이 — NEAREST, CLAMP_TO_EDGE |
| 3 | `TARGET` | 텍스처 id(0 = 출력), viewport x·y·w·h |
| 4 | `BLEND` | 사용(0·1), 식 RGB·A(0 ADD · 1 SUBTRACT · 2 REVERSE_SUBTRACT), 계수 srcRGB·dstRGB·srcA·dstA(0 ZERO · 1 ONE · 2 SRC_COLOR · 3 ONE_MINUS_SRC_COLOR · 4 DST_COLOR · 5 ONE_MINUS_DST_COLOR · 6 SRC_ALPHA · 7 ONE_MINUS_SRC_ALPHA · 8 DST_ALPHA · 9 ONE_MINUS_DST_ALPHA · 10 CONSTANT_COLOR · 11 ONE_MINUS_CONSTANT_COLOR · 12 CONSTANT_ALPHA · 13 ONE_MINUS_CONSTANT_ALPHA), 상수 색 r·g·b·a(f32) |
| 5 | `UNIFORM` | 프로그램 id, uniform 번호, 종류(0 int · 1 float), 개수(1~4), 값 |
| 6 | `TEXBIND` | 텍스처 단위, 텍스처 id |
| 7 | `DRAW` | 프로그램 id, 인스턴스당 정점 수(TRIANGLES), 인스턴스 수, 인스턴스 데이터 주소(0 = 속성 없음), 인스턴스 간격(바이트) |
| 8 | `UPLOAD` | 텍스처 id, x·y·w·h, 형식, 데이터 주소, 행 길이(화소) |
| 9 | `COPY` | 원본·대상 텍스처 id, 원본 x·y, 대상 x·y, w·h(같은 형식) |
| 10 | `READ` | 텍스처 id, x·y·w·h, 형식(1 RGBA8), 메모리 주소 — 호스트가 목록 실행 중에 기록을 끝냄 |

- 모르는 opcode가 있으면 호스트는 GPU 모드를 중지합니다(5번).
- 정점·인스턴스 속성: 정점 버퍼는 없습니다. 정점 셰이더가 `gl_VertexID`(0 ~ 인스턴스당 정점 수 − 1)로 위치를 계산합니다. 인스턴스 i의 레코드 = 인스턴스 데이터 주소 + i × 인스턴스 간격이고, 속성 a(0 ~ 인스턴스 속성 수 − 1)는 레코드의 a × 16바이트 위치에 있는 `INT` 4개입니다. 셰이더에서는 `layout(location = a) in ivec4`로 선언하세요(인스턴스마다 한 번 바뀜).
- `DRAW`: 인스턴스 수가 0이면 그리지 않습니다. 인스턴스 데이터 주소가 0이면 속성 없이 인스턴스 수와 상관없이 한 번 그리고(`drawArrays`), 0이 아니면 인스턴스 수만큼 그립니다(`drawArraysInstanced`).
- 목록 사이 GL 상태: 다음 목록까지 남는 것은 게임이 만든 프로그램(설정한 uniform 값 포함)과 텍스처(내용 포함)뿐입니다. 호스트는 목록 끝마다 블렌드를 비활성화하고, 화면을 표시할 때 출력 대상 연결을 해제하며, `Web_GpuOverlay()`가 1이면 viewport·텍스처 연결·사용 중인 프로그램도 바꿉니다. 따라서 목록마다 처음 그리기 전에 `TARGET`·`TEXBIND`(블렌드가 필요하면 `BLEND`)를 기록하세요.
- 목록 안 GL 상태: `TEXTURE`·`UPLOAD`는 현재 텍스처 단위의 연결을 해당 텍스처로 바꾸고, `COPY`는 출력 대상 연결을 해제하며, `READ`는 출력 대상을 읽은 텍스처로 바꿉니다. 이후에 그리려면 `TEXBIND`·`TARGET`을 다시 기록하세요.
- 선택 내보내기가 없을 때: `Web_GpuSync`가 없으면 호출을 건너뛰고 목록 실행 → `Web_StateSave`만 진행합니다. `Web_GpuStop`이 없으면 호출을 건너뛰고 기존 방식으로 표시합니다. `Web_GpuOverlay`가 없으면 0(출력 그대로)으로 처리합니다.
- 상태 적용 후 텍스처: 퀵슬롯 불러오기(`Web_StateLoad`) 때 호스트는 GPU 쪽에 아무것도 하지 않습니다(`Web_GpuStart`를 다시 호출하지 않고, 게임이 만든 프로그램·텍스처는 불러오기 전 그대로 남음). 따라서 불러온 상태에 맞게 텍스처를 다시 올리는 `UPLOAD`는 게임이 다음 목록에 기록하세요. 다시 들어오기(7.10)·중간 참가(7.12)로 받은 게임 상태를 적용할 때와 `Web_Reset`으로 재시작할 때도 같습니다. GPU 모드에서는 불러온 직후 화면을 다시 표시하지 않고 다음 프레임부터 표시합니다.
- 멀티플레이: 같은 세션에서도 기기마다 GPU 모드 여부가 다를 수 있습니다(WebGL2 유무·`webgba.gpu`·`Web_GpuStop`). 기기 간 상태 비교(해시)에는 모드에 따라 내용이 달라지는 그림 메모리(예: CPU 그리기에서만 갱신되는 VRAM)를 포함하지 마세요.

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

Safari(WebKit)는 사용자 입력(클릭·터치)이 아직 없는 틀의 화면 갱신을 30Hz로 제한합니다. 틀은 2초 넘게 40fps 미만이면 같은 "눌러서 시작" Overlay를 출력합니다. 모바일 게임(.wmba·.wapk)은 이 검사에서 제외합니다 — 게임 자체 화면 갱신이 초당 30회 미만이라 30Hz 제한으로 줄지 않습니다. 소리가 잠겨 Overlay가 출력된 동안 키 입력(호스트 경유)이 들어오면 소리 시작을 다시 시도하고, 브라우저가 허용하면 Overlay를 닫습니다.

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
| `webgba.net` | 멀티플레이 — [7장](#7-멀티플레이)(7.4). manifest에 `multiplayer`가 있으면 객체, 없으면 `null`(멀티플레이를 모르는 옛 webGBA, `multiplayer.protocol`이 호스트가 아는 번호보다 큰 게임도 `null`) |

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
| `dpad` | 방향 버튼 동시 입력 처리의 기본값: `"latest"`(마지막에 누른 방향만) · `"opposite"`(반대 방향끼리만 마지막 입력, 대각선 가능) · `"both"`(모두 전달, GBA 실기와 같음). 지정한 게임은 이 값이 기본값이며, 사용자가 게임별로 변경할 수 있습니다(Windows 앱 설정 창 › 일반 › 방향키 동시 입력, 웹 버전 설정 — 게임 id별로 기억). 없으면 사용자의 전체 설정(기본 `"latest"`). 대각선 이동이 필요한 게임(아케이드 등)은 `"both"` 또는 `"opposite"`를 지정하세요 |
| `rs` | (선택) RS 버튼 기본 입력 — 단계 배열(5.7). 있으면 사용자의 프리셋 1 기본값이 되고 RS 버튼이 표시됩니다. 없으면 RS는 "사용 안함"으로 시작합니다 |

버튼 한 개:

| 필드 | 설명 |
| --- | --- |
| `id` | 버튼 이름(`A`, `JUMP` …, 영문·숫자·`_`·`-` 16자, 중복 불가) |
| `role` | 위치: `up` `down` `left` `right` · 앞면 `a` `b` `c` `d`(최대 4개) · `l` `r` `l2` `r2` · `start` `select` · `extra`. 기본 키·게임패드·터치 위치를 이 값으로 결정. `extra` 외에는 role 한 개에 버튼 한 개 |
| `label` | 화면에 표시할 문자열(문자열 또는 언어별 — 3.1 "언어별 글"과 같은 순서, 6자 이하 권장, 8자까지). 없으면 `id` |
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
- 사용자가 **연사**를 켜면 호스트가 role `a`·`b`·`c`·`d`·`l`·`r` 버튼을 누르고 있는 동안 누름·뗌을 반복해 전달합니다(초당 1~30회, ① = `Web_RunFrame(keys)` 프레임마다, ② = 틀의 화면 갱신 프레임마다 키 이벤트). 연사가 맞지 않는 버튼은 `role: "extra"`로 지정하세요.
- ① 게임은 연사가 방해되는 화면(메뉴·배틀·이름 입력 등)에서 `Web_AutoFireOff()`가 1을 반환하게 하면 그동안 연사를 멈출 수 있습니다(누르고 있는 버튼은 누른 그대로 전달). 다시 0이 되면 누르고 있는 버튼은 그 프레임부터 새로 누른 것처럼 연사합니다(첫 프레임 누름이라 끊김 없음). webGBA 0.9.0부터 조회합니다.

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
- **웹 버전 화면 배치**: 게임 화면을 먼저 채운 뒤(세로 화면은 가로 폭, 가로 화면은 높이 기준) 방향 패드·버튼을 남은 칸에 들어가는 가장 큰 크기로 배치합니다. C·D 행 등으로 공간이 부족하면 **게임 화면 크기는 유지하고** 간격 → 버튼 배율 순으로 필요한 만큼만 줄입니다. 배율은 기기 픽셀 단위(버튼 그림 한 픽셀 = 기기 픽셀 정수 개)라 흐리게 표시하지 않습니다. 가로 화면에서는 기능 버튼(파일·퀵슬롯·빨리 감기·소리·설정 등)을 양옆 칸 위에 한 줄로 배치합니다.
- **A·B 함께 누르기**(웹 버전): A·B 버튼 사이를 누르거나 한 손가락이 두 버튼에 함께 닿으면 role `a`·`b` 버튼을 함께 누릅니다(설정 › A·B 함께 누르기, 기본 켬).
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

게임이 수신하는 `code`는 제한이 없습니다(호스트가 변환해 전달). 방향 버튼 동시 입력 처리(마지막 방향만 / 반대 방향만 마지막 입력 / 모두 전달)는 사용자 설정이며(게임이 `input.dpad`를 지정하면 해당 값이 기본값) `up`·`down`·`left`·`right` role에 적용됩니다.

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

#### 5.7 RS 버튼 기본 입력 `input.rs`

여러 버튼을 정해진 순서·시간으로 누르는 입력(잡기 A+B, 커맨드 등)을 게임이 기본값으로 줄 수 있습니다. 사용자의 프리셋 1 기본값이 되며, 사용자는 앱에서 단계를 바꾸거나 다른 프리셋을 만들 수 있습니다(사용자가 저장한 값이 우선).

```json
"input": {
  "preset": "none",
  "buttons": [ … { "id": "P", "role": "a", "bit": 0 }, { "id": "K", "role": "b", "bit": 1 } … ],
  "rs": [ { "buttons": ["P", "K"], "hold": 6 } ]
}
```

| 단계 필드 | 설명 |
| --- | --- |
| `buttons` | **필수**. 이 단계에서 동시에 누를 버튼 `id` 배열(1개 이상, 겹침 없음). role이 `up` `down` `left` `right` `a` `b` `c` `d` `l` `r` `start` `select`인 버튼만(`extra`·`l2`·`r2` 불가). 대각선은 방향 두 개를 함께 |
| `hold` | 누르는 시간(프레임, 1~600, 기본 3) |
| `gap` | 다음 단계까지 간격(프레임, 0~600, 기본 3). 마지막 단계의 값은 사용하지 않음 |

- 단계는 1~32개. 호스트는 `Web_RunFrame(keys)`(①) 프레임마다 단계의 버튼 비트를 사용자 입력과 함께 전달합니다. RS 단계에 방향이 있는 프레임에는 사용자 방향 대신 RS 방향을 전달하고(방향 동시 입력 설정과 무관하게 대각선 그대로), 연사는 적용하지 않습니다.
- 재생 규칙(한 번 누름 = 한 번 재생, 누르고 있으면 마지막 단계 유지, 다른 키가 들어오면 그 프레임부터 중단)은 호스트 동작입니다(주요 기능 › RS 버튼).
- `check`는 형식·범위·버튼 id·role을 검사합니다.

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
| 옆면 이름 위치 | `cart.spine.textArea: [x, y, 가로, 세로]` — 옆면 그림 픽셀. 호스트가 이 영역에 `shortName`(없으면 `name`)을 세로 문자열로 표시. 영역이 한 가지 색(종이)이면 웹 라이브러리는 그 종이와 바로 위·아래의 밝은 줄을 `cart.color`로 칠하고, 기본 이름 위치(`[2k, 5k, 14k, 34k]`)에 롬팩 색 띠(흰색 위에 `cart.color` 불투명도 50%)를 그린 후 이름을 그 위치에 검정으로 표시. 없으면 문자열을 표시하지 않음(이름을 옆면 그림에 직접 그린 경우) |

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
- 옆면 없음 → 기본 옆면(`cart.color` 몸통 + 기본 이름 위치 `[2k, 5k, 14k, 34k]`에 롬팩 색 띠(흰색 위에 `cart.color` 불투명도 50%), 띠에 `shortName`·`name`을 검정으로)
- 라벨 없음 → 라벨 위치에 `shortName`(없으면 `name`)을 문자열로 표시
- `cart.color` 없음 → 이름에서 정한 색(같은 이름은 항상 같은 색)

- **상표를 포함하지 마세요**: 다른 회사의 이름·로고(게임기 회사 이름, 게임기 이름 문자·로고 등), 실제 카트리지·상자 그림을 모방한 그림, 권리가 없는 캐릭터 그림. 앞면·옆면 몸통도 실제 게임기 카트리지의 모양·홈·단자를 그대로 모방하지 말고 고유한 모양으로 그리세요. 직접 그렸거나 사용 권리가 있는 그림만 포함하세요.

---

### 7. 멀티플레이

> 멀티플레이 규약 1. 현재 webGBA(Windows 앱·웹 버전)는 **방 코드 6자리**(같은 Wi-Fi·다른 네트워크 모두)와 같은 Wi-Fi의 **근처 방 목록**(짝 찾기 서버)으로 연결하고, 서버에 연결할 수 없으면 **연결 코드(·QR)를 두 번 주고받는 방식**으로 연결합니다. 직접 연결이 되지 않는 망에서는 Cloudflare 중계 서버(TURN)를 거칩니다(7.11). `needs: ["net"]` 게임도 열고, `Web_NetHost(1, 1)`(`rejoin` 게임은 `Web_NetHost(1, 5)`)을 호출하며, ②에는 manifest에 `multiplayer`가 있으면 `webgba.net`을 제공합니다. 키 동기화(`sync: "inputs"`, 7.6)는 지원하지 않습니다(`flags` 비트 1 = 0).
> 멀티플레이를 모르는 옛 webGBA에서는 `Web_NetHost`가 호출되지 않고 `webgba.net`이 `null`이므로 게임은 통신 메뉴를 숨기면 됩니다(7.8). 규약은 바뀔 수 있습니다.
> 규약 1 확장(선택): 게임은 자체 연결 서버(`multiplayer.iceServers`)를 지정할 수 있습니다(7.11). 게임이 `multiplayer.rejoin`을 켜면 연결이 끊긴 사람이 같은 자리로 **다시 들어오기**를 할 수 있습니다(7.10). 언제든 참가를 받는 게임은 `multiplayer.join: "anytime"`으로 창 자동 열림·시간 초과 없이, 방장이 방을 만들거나 갱신한 뒤 2분 30초 동안 참가를 받습니다(7.12).

#### 7.1 개요

webGBA는 같은 Wi-Fi(같은 공유기) 안의 기기끼리, 그리고 방 코드로 다른 네트워크의 기기끼리 게임을 연결합니다. 연결은 기기 간 직접 연결(WebRTC 데이터 채널)을 먼저 시도하고, 직접 연결이 되지 않는 망(휴대폰 데이터·회사·학교 망 등)에서는 **Cloudflare 중계 서버(TURN)**를 거칩니다. 중계 서버를 거쳐도 게임 내용은 암호화되어(DTLS) 중계 서버가 볼 수 없습니다(7.11). 설정 › 멀티플레이 **멀티플레이 사용**을 비활성화하면 멀티플레이 창을 열 수 없고 연결도 하지 않습니다(바로 적용).

방을 찾는 동안(다시 들어오기를 켠 게임은 세션이 끝날 때까지) 짝 찾기 서버(`webgba.vercel.app/api/v1/mp`)를 사용합니다. 서버에는 방 코드·닉네임·게임 호환 키 앞 8바이트·용도·인원과 연결 정보(Offer·Answer)가 저장되고, 마지막 갱신 후 최대 2분 30초 뒤 자동으로 삭제됩니다. 연결 정보에는 같은 망 안 주소 후보와 **공인 IP(공인 주소 후보)**, 중계 서버 주소가 들어가므로 **상대 기기에 이 기기의 공인 IP가 보입니다**. 서버는 요청을 보낸 기기의 IP 주소를 따로 저장하지 않습니다. 근처 방 목록은 공인 IP로 만든 하루짜리 해시(HMAC)가 같은 기기끼리만 보여 줍니다.

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
| `sync` | `"messages"` \| `"inputs"` | 아니요 | `"messages"` | `"inputs"` = 호스트가 매 프레임 모든 참가자의 키를 동기화(7.6, 선택 기능 — 현재 webGBA는 지원하지 않아 `"messages"`로 동작) |
| `inputDelay` | 정수 | 아니요 | `3` | `sync: "inputs"`일 때 키를 적용할 지연 프레임 수(1~10) |
| `rejoin` | 불리언 | 아니요 | `false` | `true` = 다시 들어오기(7.10). 연결이 끊긴 유저의 자리를 세션 끝까지 보관하고 같은 자리로 돌아오게 함 |
| `join` | `"anytime"` | 아니요 | 없음(7.7 동작) | `"anytime"` = 중간 참가 게임(7.12). 게임이 요청해도 창을 자동으로 열지 않고 시간 초과 없음, 방장이 방을 만들거나 "갱신"한 뒤 2분 30초 동안 참가를 받음(창을 닫아도 유지, 방장 혼자서도 창 닫기 가능) |
| `iceServers` | 배열 | 아니요 | 없음(webGBA 기본 STUN + Cloudflare TURN) | 게임별 연결 서버(STUN·TURN, 7.11). 지정하면 webGBA 기본 서버 대신 이 목록만 사용 |
| `board` | 객체 | 아니요 | 없음(사람 목록만) | 플레이어 상태 표의 게임 값 열(7.9.1) |

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

모르는 키는 무시합니다. `multiplayer.protocol`이 호스트가 지원하는 번호보다 크면 호스트는 멀티플레이를 비활성화하고 게임은 그대로 실행합니다. 이때 ①에는 `Web_NetHost`를 호출하지 않고 ②의 `webgba.net`은 `null`이며(멀티플레이를 모르는 옛 webGBA와 같음), webGBA는 게임을 열 때 알림과 멀티플레이 버튼(누르면 연결 창)에 "이 게임의 멀티플레이는 새 webGBA가 필요합니다"를 출력합니다. 파일 검사(10장)는 경고만 출력하고 나머지 `multiplayer` 항목은 검사하지 않습니다. `protocol`이 없거나 1 이상 정수가 아니면 오류입니다.

#### 7.3 ① Web API — 내보내기 함수

모두 **게임이 내보내는 함수**이고 호스트가 호출합니다(새 가져오기 없음 → 멀티플레이를 모르는 호스트에서도 게임은 그대로 열림).
`Web_NetWanted`, `Web_NetEvent`, `Web_NetOut`, `Web_NetOutLen`, `Web_NetOutClear`, `Web_NetInBuffer`, `Web_NetIn` 일곱 개가 모두 있어야 멀티플레이를 지원하는 것으로 봅니다. 포인터는 wasm 메모리 안 주소, 값은 모두 little endian.

| 함수 | 시그니처 | 호출 시점 | 설명 |
|---|---|---|---|
| `Web_NetHost` | `(u32 protocol, u32 flags)` | `Web_Init` 후 한 번 | 호스트가 멀티플레이 규약 `protocol`을 지원함. `flags` 비트 0 = 순서 보장 Broadcast 지원, 비트 1 = `sync: "inputs"` 지원(현재 webGBA는 0), 비트 2 = 다시 들어오기(7.10) 지원(manifest `rejoin: true`인 게임에만 설정). **호출되지 않으면 통신을 지원하지 않는 호스트** → 게임은 "친구와 하기" 등의 메뉴를 숨기는 것을 권장. 선택 |
| `Web_NetWanted` | `() → u32` | 매 프레임 `Web_RunFrame` 후 | 0 = 통신 불필요. 0이 아니면 요청(7.3.1) |
| `Web_NetEvent` | `(u32 kind, u32 a, u32 b)` | 이벤트 발생 시, 프레임 사이 | 이벤트(7.3.3) |
| `Web_NetOut` | `() → ptr` | 매 프레임 `Web_RunFrame` 후 | 송신 레코드의 위치(7.3.2) |
| `Web_NetOutLen` | `() → u32` | 같음 | 송신 레코드의 바이트 수(0 = 없음) |
| `Web_NetOutClear` | `()` | 레코드를 모두 조회한 후 | 송신 버퍼 비우기 |
| `Web_NetInBuffer` | `(u32 len) → ptr` | 수신 메시지별, `Web_RunFrame` 전 | `len` 바이트를 기록할 위치. **0 = 현재 공간 없음** → 호스트는 해당 메시지를 보관했다가 다음 프레임에 다시 시도(순서 유지) |
| `Web_NetIn` | `(u32 from, u32 len)` | 위치에 바이트를 기록한 후 | 수신 확정. `from` = 송신자 슬롯. 비트 8(`0x100`)이 켜져 있으면 상태 묶음(7.10, `rejoin` 게임만) |
| `Web_NetBoard` | `() → ptr` | 세션이 열린 후 한 번 | 선택. 플레이어 상태 표 400바이트 버퍼 위치(7.9.2). manifest `multiplayer.board`가 있을 때만 조회 |
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
| 3 | 0 = 메시지. `rejoin` 게임만: 1 = 상태 묶음 조각(이어짐), 2 = 상태 묶음 마지막 조각(7.10). 그 밖의 값은 레코드를 버림 |
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
| 7 | `HOLD` | 슬롯 | 현재 인원 | `rejoin` 게임만(7.10). 해당 슬롯의 연결이 끊겨 자리를 보관함. 끊긴 기기 자신은 `a` = 본인 슬롯. 유저 기기의 `a` = 0 = 방장이 앱을 닫아 돌아오기를 기다림(7.10.1) |
| 8 | `BACK` | 슬롯 | 현재 인원 | `rejoin` 게임만. 보관한 슬롯이 다시 연결됨(늘 `HOLD` 뒤). 유저 기기의 `a` = 0 = 방장이 돌아옴 → 이 기기가 상태 묶음을 슬롯 0으로 보냄(7.10.1) |
| 9 | `REJOINED` | 본인 슬롯 | 현재 인원 | `rejoin` 게임만. 돌아온 기기에 `OPEN` 대신(방장이 앱을 다시 열어 돌아온 경우 방장 기기에 `a` = 0, 유저가 앱을 다시 열어 돌아온 경우 앞선 `OPEN`·`HOLD` 없이 이 사건부터, 7.10.2) |

사유: 1 `CANCEL`(사용자가 멀티플레이 창에서 취소) · 2 `TIMEOUT`(제한 시간 안에 연결 실패 / 연결 끊김 후 복귀하지 않음) · 3 `INCOMPATIBLE`(서로 다른 게임·호환 키·규약 번호) · 4 `LOST`(연결 끊김) · 5 `FULL`(방 정원 초과) · 6 `LEFT`(정상 퇴장) · 7 `HOST_LEFT`(방장이 나가 방이 사라짐) · 8 `NO_NETWORK`(Wi-Fi가 없거나 이 기기에서 연결 기능을 사용할 수 없음) · 9 `SOLO`(`rejoin` 게임만: 끊긴 기기의 사용자가 "혼자 이어 하기"를 선택)

게임이 지킬 사항: `CLOSED(CANCEL)`을 수신하면 게임 안에서 취소한 것과 같이 처리하고 `Web_NetWanted`를 0으로. `STALL`은 일시적일 수 있으므로 즉시 끊지 말고 게임의 제한 시간을 따름. 방장이 나가면(`HOST_LEFT`) 세션 종료(방장 위임은 규약 1에 없음).

#### 7.4 ② 자체 JS — `webgba.net`

격리 틀이 제공하는 `webgba.net`으로 송수신합니다(틀과 호스트 사이는 MessagePort로 통신하고, 게임은 이 객체만 사용). 바이트는 `ArrayBuffer`·`Uint8Array`.

| 게임 → 호스트 | 설명 |
|---|---|
| `webgba.net.want({ purpose, min, max, role })` | ①의 `Web_NetWanted` 0이 아닌 값과 같음. `purpose` = manifest id, `role` = `"any"`·`"make"`·`"join"`. 호출할 때마다 새 요청 |
| `webgba.net.unwant()` | ①의 0과 같음(통신 종료) |
| `webgba.net.send(to, bytes)` | `to` = 슬롯 0~7 · `"ordered"` · `"all"`, 16384바이트까지 |
| `webgba.net.board(table)` | 플레이어 상태 표(7.9.3). `null` = 표 없음 |
| `webgba.net.sendState(to, bytes)` | 상태 묶음(7.10, `rejoin` 게임만). `to` = 슬롯 0~7, 1~262144바이트 |

| 호스트 → 게임 | 설명 |
|---|---|
| `webgba.net.host` | `{ protocol, ordered, inputs, rejoin }` — ①의 `Web_NetHost`(`rejoin` = 비트 2, 현재 webGBA의 `inputs`는 false) |
| `webgba.net.onevent = (kind, a, b) => …` | 7.3.3과 같은 번호 |
| `webgba.net.onrecv = (from, bytes) => …` | 수신 메시지(순서 유지) |
| `webgba.net.onstate = (from, bytes) => …` | 수신 상태 묶음(7.10). 같은 송신자의 메시지와 순서 유지 |

멀티플레이를 모르는 호스트에서는 `webgba.net` 자체가 `null`입니다. 현재 webGBA도 manifest에 `multiplayer`가 없는 게임, `multiplayer.protocol`이 1보다 큰 게임(7.2)에는 `null`을 제공합니다.

#### 7.5 한도

| 항목 | 값 |
|---|---|
| 인원 | 2~8(슬롯 0~7) |
| 메시지 한 개 | 16384바이트 |
| 한 프레임 송신 합계(권장) | 65536바이트 |
| 수신 순서 | 송신자별 순서 유지, `TO_ORDERED`는 모두 같은 순서 |
| 지연(같은 Wi-Fi) | 보통 왕복 2~20ms(프레임 1~2개) |
| 상태 묶음 한 개(7.10) | 262144바이트(호스트가 16384바이트씩 나눠 보내고 다시 합침) |
| 게임별 연결 서버(7.11) | 주소 모두 합쳐 4개, `stun:`·`turn:`·`turns:`만 |

#### 7.6 선택 기능: 키 동기화 (`sync: "inputs"`)

자체 통신 코드가 없는 단순한 ① 게임용. 게임이 같은 키 입력에 같은 화면을 생성하면(결정적) 호스트가 모든 참가자의 키를 매 프레임 동기화합니다.

> **현재 webGBA는 이 기능을 지원하지 않습니다**(① `Web_NetHost` `flags` 비트 1 = 0, ② `webgba.net.host.inputs` = false, `Web_NetKeys`를 호출하지 않음). `sync: "inputs"`를 기재해도 `"messages"`와 같이 동작합니다. 키를 맞춰야 하는 게임은 아래와 같은 방식(지연 프레임 + 모든 참가자의 키가 모일 때까지 대기)을 게임이 메시지로 직접 구현하세요(7.8).

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
- `join: "anytime"` 게임(7.12)은 요청해도 자동으로 출력하지 않음. 사용자가 상단 "멀티플레이" 버튼으로 엶.

```text
┌ 멀티플레이              [교환 · 2명] [×] ┐
│ [ 참가하기 | 방 만들기 ]                  │
│ 열린 방 자동 갱신                    [↻] │
│ ┌ 플레이어 4821  ■□ 1/2명   [들어가기] ┐ │
│ 방 코드로 들어가기                        │
│ [9][2][ ][ ][ ][ ]          [> 들어가기] │
├──────────────────────────────────────────┤
│ 내 이름 플레이어 7730 [바꾸기]  [> 인터넷 없이 연결] │
└──────────────────────────────────────────┘

방 만들기 탭: [+ 방 만들기] → 내 방(방 코드 크게 · 코드 복사 · QR · 유저 칸 1P~ · 빈자리 점선)
              하단 [방 닫기] [갱신] … [게임으로]  (× = 창만 닫음, 방 닫기 = 방이 없어짐)
연결 실패: 원인 + [다시 시도] [인터넷 없이 연결(코드·QR)] [처음으로] + 확인할 것
인터넷 없이 연결 — 방장: ① 방장 코드(111자·QR)를 상대에게 → ② 상대의 답 코드를 넣고 연결
                   참가: ① 방장 코드를 넣고 다음 → ② 답 코드(·QR)를 방장에게
```

- 마지막에 고른 탭(참가하기·방 만들기)을 기억해 다음에 그 탭으로 엽니다. 방 코드는 6칸에 숫자로 넣고, 붙여 넣은 글에서 숫자만 씁니다. 틀린 코드는 칸을 빨갛게 표시하고 그 자리에서 다시 넣습니다.
- PC 버전(exe) 팝업 버튼은 대문자 영어입니다: JOIN(열린 방)·ENTER(방 코드)·EDIT(이름)·OFFLINE(인터넷 없이 연결)·CREATE(방 만들기)·COPY·QR·CLOSE ROOM·RENEW·DONE·RETRY·BACK, 상태 표 LEAVE·INVITE. 안내 글도 같은 버튼 이름으로 씁니다(예: "RENEW를 누르면").

- 연결 코드는 서버를 거치지 않습니다. 코드에는 망 안 주소(mDNS 이름·사설 IPv4·IPv6 ULA·링크 로컬)와 STUN으로 얻은 공인 주소 후보가 들어갑니다(짝 찾기 서버를 쓰지 않으므로 기본 TURN 접속 정보는 받지 않음 — 7.11). 상대가 mDNS 이름을 풀지 못해 연결 확인 요청으로 주소를 알게 된 prflx 후보도 받습니다(같은 와이파이의 PC·휴대폰 사이에서 생김).
- 코드 하나는 한 사람에게 한 번만 씁니다. 3명 이상은 방장이 사람마다 새 방장 코드를 만듭니다(이미 쓴 코드·다른 초대의 답 코드는 거부).
- 역할이 지정된 요청(방 생성만·참가만)이면 해당 화면부터 표시.
- 인원이 최소에 도달하면 "연결됨"을 표시하고 1초 후 창을 닫음. 이후 확인(예: "A로 시작")은 게임 안에서.
- 최대 인원 전까지 방장 측에는 작은 표시("2/4 · 기다리는 중")가 유지되고, 참가자가 더 들어오면 `JOIN`.
- `JOIN`·인원·방 목록의 인원은 유저 기기가 자리 안내를 받아들였다고 알린 뒤에만 바뀝니다. 그 전에 끊긴 유저는 자리에 남지 않습니다(`HOLD` 없음).
- 취소 → `CLOSED(CANCEL)`. 제한 시간 안에 찾지 못하면(기본 3분) `CLOSED(TIMEOUT)`. 게임이 먼저 통신 종료를 알리면 안내 없이 창을 닫음. `join: "anytime"` 게임은 다름(7.12).
- 연결 실패 시 안내: 원인 배너(대칭 NAT 안내 포함, 7.11) + "확인할 것" 목록(같은 와이파이인지 · 게스트·공용 와이파이 · VPN·모바일 데이터 · 메시 와이파이·기기 격리 · PC 방화벽).

세션 중 호스트가 지키는 사항: 빨리 감기·속도 변경 비활성화(1배), 퀵슬롯(상태 저장·불러오기)·웹 버전 자동 저장·초기화 차단(게임 안 세이브는 그대로), 다른 게임 열기 = 세션 종료(`LEFT`). 일시정지·앱 이탈 → 상대에게 `STALL`(PC에서 탭만 숨긴 경우는 프레임을 계속 실행하므로 해당 없음), 복귀하면 `RESUME`, 일정 시간(기본 15초) 넘게 복귀하지 않으면 연결 해제(`LOST`). 화면 구석에 작은 상태 표시(인원·연결 상태). 닉네임은 사용자 설정 값이고 IP·기기 이름은 어디에도 표시되지 않습니다.

#### 7.8 개발자 참고 사항

- 같은 키 입력·같은 메시지에 같은 결과가 나오도록(난수는 게임 내부 seed 사용) 제작하면 `TO_ORDERED` 한 가지로 모두 같은 상태를 유지할 수 있습니다.
- 수신 메시지는 프레임 사이에 도착하므로, 게임은 수신한 메시지를 Queue에 추가하고 프레임 안에서 처리하세요.
- 키 입력을 맞추는 게임(lockstep)은 프레임 f의 본인 키를 프레임 번호와 함께 보내 f + 지연(7.6의 기본값 3프레임 등)에 적용하고, 모든 참가자의 f 키가 모일 때까지 프레임 f를 진행하지 마세요(7.6과 같은 방식, 현재 webGBA는 호스트 키 동기화를 지원하지 않으므로 게임이 구현). 모두 같은 키가 모인 프레임만 진행하므로 느린 기기가 있어도 기기 사이 진행 차이가 지연 프레임 수를 넘지 않습니다. 시작 프레임은 방장이 보낸 "시작" 메시지로 맞추세요.
- `STALL`은 일시적일 수 있으므로 바로 끊지 말고 기다리세요. 기본 15초 넘게 돌아오지 않으면 호스트가 `LEAVE(LOST)`(방장이 끊긴 경우 `CLOSED`, 다시 들어오기 게임은 `HOLD`, 7.10)를 전달합니다.
- 호스트가 멀티플레이를 모르면(`Web_NetHost`가 호출되지 않음 / `webgba.net`이 `null`) 통신 메뉴를 숨기세요(옛 webGBA).
- 예제: `docs/wgba/examples/net-webapi/`(① 작은 C, 롬 없음)·`net-script/`(② JS 한 개) — A로 상대 찾기, 방장 START로 한 라운드, 모두 같은 해시, 플레이어 상태 표(7.9). 멀티플레이 없는 ② 예제는 `hello-script/`(그리기·키·세이브·퀵슬롯).
- 같은 게임 빌드끼리만 연결되는 것이 기본입니다(`compat: "exact"`). 버전이 달라도 통신 규칙이 같다면 `compat`에 같은 문자열을 사용하세요.
- 롬이나 타인의 저작물을 메시지로 전송하지 마세요.

#### 7.9 플레이어 상태 표

세션 중 webGBA는 "멀티플레이" 메뉴에 현재 플레이어 목록을 표시합니다. 자리 번호·닉네임·방장·연결 상태·지연(방장까지 왕복 ms)은 webGBA가 채우고, 게임은 원하면 플레이어마다 값(체력·레벨·순위·상태 등)을 추가할 수 있습니다. 게임이 아무것도 주지 않아도 목록은 표시됩니다.

여는 방법: 웹 = 세션 중 화면 상단 "멀티플레이" 버튼(빨리 감기 버튼 자리), PC 버전(exe) = 좌측 도구 막대 "멀티플레이" 버튼 또는 Tab(누르는 동안 표시, 짧게 누르면 열린 상태 유지). 메뉴가 열려 있어도 게임은 멈추지 않고, 게임이 끝나도 자동으로 열리지 않습니다(기본은 닫힘).

표시 위치: 웹 가로 화면은 게임 화면 우측 칸(게임 화면을 그만큼 줄여 가리지 않음, 가상 버튼을 쓰면 [방향 버튼 | 게임 | 상태 표 | A·B 버튼]으로 열린 채로 플레이 가능), 웹 세로 화면은 게임 화면 아래 시트(가상 버튼 자리를 덮음 — 닫으면 다시 조작), PC 버전은 좌측 패널. 머리 줄은 "방 <코드>"·인원, 줄은 연결 창 대기실과 같은 유저 칸(자리·닉네임·방장·나·끊김·지연, 빈자리 점선 — AI 줄이 있는 게임은 빈자리 없음), 표 아래 한 줄에 게임 머리 글(`captions`)과 `mark` 설명, 하단에 "방 나가기"(방장은 "방 닫기")와 방장의 "초대 코드"(빈자리가 있을 때, 연결 창의 방 코드·연결 코드 화면).

##### 7.9.1 manifest `multiplayer.board`

| 키 | 타입 | 필수 | 기본 | 설명 |
|---|---|---|---|---|
| `columns` | 배열(1~6) | 예 | — | 열 정의. 배열 순서 = 값 순서 |
| `columns[].id` | 문자열(영문 소문자·숫자·`-`, 16자까지) | 예 | — | 고정 열 이름 |
| `columns[].type` | `"bar"`·`"number"`·`"rank"`·`"status"` | 예 | — | 종류(아래 표) |
| `columns[].name` | 다국어 이름(12자까지) | 예 | — | 표시되는 열 이름 |
| `columns[].max` | 정수 1~65535 | `bar`만 | — | 막대 최대값(값에 최대를 함께 주면 그 값) |
| `columns[].tone` | `"hp"`·`"accent"` | 아니요 | `"accent"` | `bar` 색. `hp` = 남은 비율이 50% 초과 초록·25% 초과 노랑·그 이하 빨강 |
| `columns[].prefix`·`suffix` | 다국어 이름(4자까지) | 아니요 | 없음 | `number` 앞·뒤 글(예: `"Lv"`) |
| `columns[].labels` | 배열(1~15) | `status`만 | — | `{ "name": 다국어 이름(8자까지), "tone": "normal"·"good"·"warn"·"bad"·"dim", "dimRow": true·false }`. 값 1 = 첫 꼬리표 |
| `names` | 다국어 이름 배열(1~32, 각 16자까지) | 아니요 | 없음 | 사람이 아닌 줄(AI 등)의 이름. 줄의 `nameLabel` 번호(1부터)로 선택 |
| `captions` | 다국어 이름 배열(1~16, 각 24자까지) | 아니요 | 없음 | 머리 글. `{0}`·`{1}` 자리에 정수 인자 |
| `mark` | 다국어 이름(8자까지) | 아니요 | 없음 | 강조 줄의 의미(바닥줄에 범례로 표시) |
| `scope` | `"all"`·`"self"` | 아니요 | `"all"` | `all` = 게임이 모든 줄을 채움(모든 기기가 같은 상태를 가진 게임). `self` = 기기마다 자기 줄 하나만 주고 webGBA가 모아 모두에게 전달 |
| `sort` | `{ "column": id, "order": "desc"·"asc" }` | 아니요 | 없음 | webGBA가 줄을 정렬. 없으면 `all` = 게임이 넣은 순서, `self` = 자리 순서 |

| 종류 | 값(정수) | 표시 |
|---|---|---|
| `bar` | 하위 16비트 = 현재(u16), 상위 16비트 = 최대(0 = manifest `max`) | 픽셀 막대 + 숫자 |
| `number` | s32 | `prefix`·`suffix`를 붙인 숫자. 둘 다 없으면 열 이름을 앞에 |
| `rank` | 0 = 없음, 1~99 | 언어별 순위 글(`2위`·`2nd`·`2位`) |
| `status` | 0 = 없음, 1~ = `labels` 번호 | 꼬리표. `dimRow: true`면 해당 줄도 흐리게 |

```json
"board": {
  "columns": [
    { "id": "hp", "type": "bar", "name": { "ko": "체력", "en": "HP" }, "max": 100, "tone": "hp" },
    { "id": "lv", "type": "number", "name": { "ko": "레벨", "en": "Level" }, "prefix": "Lv" },
    { "id": "rank", "type": "rank", "name": { "ko": "순위", "en": "Rank" } },
    { "id": "state", "type": "status", "name": { "ko": "상태", "en": "State" },
      "labels": [{ "name": { "ko": "탈락", "en": "Out" }, "tone": "dim", "dimRow": true }, { "name": { "ko": "준비 완료", "en": "Ready" }, "tone": "good" }] }
  ],
  "names": [{ "ko": "웅", "en": "Brock" }],
  "captions": [{ "ko": "{0}-{1} 라운드", "en": "Round {0}-{1}" }],
  "mark": { "ko": "이번 상대", "en": "Next foe" }
}
```

`board`가 없으면 webGBA는 게임 값을 조회하지 않습니다(①의 `Web_NetBoard`가 있어도). 모르는 키는 무시합니다.

##### 7.9.2 ① Web API — `Web_NetBoard`

| 함수 | 시그니처 | 호출 시점 | 설명 |
|---|---|---|---|
| `Web_NetBoard` | `() → ptr` | 세션이 열린 후(`OPEN`) 한 번 | 표 버퍼(400바이트) 위치. 0 = 표 없음. **세션 동안 같은 위치여야 합니다** |

버퍼(little endian):

| 위치 | 타입 | 이름 | 설명 |
|---|---|---|---|
| 0 | u32 | `serial` | 0 = 현재 표 없음. 내용을 바꿀 때마다 1씩 증가(0은 건너뜀). **다른 칸을 모두 기록한 후 마지막에** 기록 |
| 4 | u8 | `format` | `1` |
| 5 | u8 | `rows` | 줄 수 0~8(`scope: "self"`면 0 또는 1) |
| 6 | u8 | `flags` | 비트 0 = 최종 결과(게임 끝). 나머지 0 |
| 7 | u8 | `caption` | `captions` 번호(1부터), 0 = 없음 |
| 8 | s32 | `arg0` | 머리 글 `{0}` |
| 12 | s32 | `arg1` | 머리 글 `{1}` |
| 16 + 48×i | 줄 i | | 아래 48바이트 |

| 위치 | 타입 | 이름 | 설명 |
|---|---|---|---|
| 0 | u8 | `slot` | 0~7 = 세션 자리(사람), `0xFF` = 사람 아님 |
| 1 | u8 | `flags` | 비트 0 = 흐리게, 비트 1 = 강조 |
| 2 | u8 | `nameLabel` | 사람이 아닌 줄의 `names` 번호(1부터), 0 = 없음 |
| 3 | u8 | `nameLen` | 아래 `name`의 바이트 수 0~20 |
| 4 | s32 × 6 | `values` | 열 순서대로. 없는 열은 0 |
| 28 | u8 × 20 | `name` | 사람이 아닌 줄의 이름(UTF-8). `nameLabel`이 있으면 그쪽을 사용 |

- 사람 줄(`slot` 0~7)의 이름은 항상 webGBA 닉네임입니다(게임 이름은 사용하지 않음).
- 호스트는 메뉴가 열려 있을 때(또는 `scope: "self"`일 때) 15프레임마다 `serial`만 조회하고, 바뀌었을 때만 나머지를 조회합니다. `serial`을 마지막에 기록하면 반쯤 기록한 표를 조회하는 일이 없습니다.
- 줄 수 9 이상·`format` 1이 아님 = 표 무시, `nameLen` 21 이상 = 이름 무시, `slot`이 8~254 = 해당 줄 무시, 버퍼가 wasm 메모리 밖 = 표를 사용하지 않음.
- 내용은 초당 4번 넘게 바꾸지 마세요(더 빨리 바꿔도 화면은 초당 4번까지만 갱신).

##### 7.9.3 ② 자체 JS — `webgba.net.board`

```js
webgba.net.board({
  caption: 1, args: [4, 2], final: false,
  rows: [
    { slot: 0, values: [81, 7, 1, 0] },
    { slot: null, nameLabel: 1, values: [66, 6, 3, 0] },
    { slot: null, name: "Bot 3", values: [0, 4, 8, 1], dim: true },
    { slot: 2, values: [{ value: 58, max: 100 }, 5, 4, 0], mark: true },
  ],
});
webgba.net.board(null); // 표 없음
```

- 값은 ①과 같은 의미의 정수(`bar`는 `{ value, max }` 객체도 가능). 8줄·6값을 넘는 것은 버리고, 정수가 아닌 값은 0, 모르는 키는 무시합니다.
- 같은 내용을 다시 보내도 됩니다. 초당 4번까지 화면에 반영(남은 것은 마지막 것만).
- `scope: "self"`면 `rows`에 자기 줄 하나만 넣습니다(`slot`은 무시하고 본인 자리로 처리).

##### 7.9.4 호스트가 지키는 사항

- 게임·다른 기기에서 받은 글(이름·닉네임)은 **글로만** 표시합니다(HTML로 넣지 않음). 제어 문자·글 방향 바꾸기 문자·폭 없는 문자를 제거하고 이름 16자·닉네임 12자에서 자릅니다.
- 색·그림·주소는 게임에서 받지 않습니다. 색은 `tone` 이름을 호스트 테마 색으로 바꿉니다.
- `scope: "self"` 줄은 48바이트로 방장을 거쳐 모두에게 전달됩니다(기기마다 초당 4번까지).
- 나간 사람의 닉네임은 세션이 끝날 때까지 기억합니다. 게임이 해당 자리 번호를 계속 사용하면 그 닉네임 + "나감"(끊김이면 "끊김") 꼬리표로 표시됩니다.
- 예제: `net-webapi`(① `Web_NetBoard`, `scope: "all"`, AI 줄 1개)·`net-script`(② `webgba.net.board`, `scope: "self"`, 정렬).

#### 7.10 다시 들어오기 (`rejoin: true`, 규약 1 확장)

연결이 끊긴 유저가 세션이 끝날 때까지 같은 자리로 돌아올 수 있습니다. 게임이 manifest에 `multiplayer.rejoin: true`를 기재한 경우에만 동작하고, 기재하지 않은 게임은 7.3.3의 이전 처리(`LEAVE(LOST)`) 그대로입니다. 호스트 지원 여부 = ① `Web_NetHost` `flags` 비트 2 / ② `webgba.net.host.rejoin`.

- 방 코드(짝 찾기 서버)로 만든 세션에서만 동작합니다. 연결 코드·QR(인터넷 없이 연결)로 만든 세션은 이전 처리입니다.
- 유저 연결이 끊기면(15초 넘게 응답 없음·채널 닫힘) 방장은 자리를 보관하고(`HOLD`, 인원 그대로, 새 참가자가 받지 않음) 상태 메뉴에 "끊김 · 기다리는 중"으로 표시합니다. 끊긴 기기는 `HOLD`(본인 슬롯)를 받고, webGBA가 "다시 연결하는 중…" 창을 출력하며 같은 방에 자동으로 다시 연결합니다(네트워크가 돌아오면 바로). 사용자는 "다시 들어가기"(바로 다시 시도)·"혼자 이어 하기"(`CLOSED(SOLO)`, 방장·다른 기기에는 `LEAVE(LEFT)`)를 누를 수 있습니다.
- 돌아오면 방장·다른 기기는 `BACK`, 돌아온 기기는 `OPEN` 대신 `REJOINED`를 받습니다. 끊긴 동안의 메시지는 전달되지 않으므로 방장 게임이 **상태 묶음**을 돌아온 슬롯에 보냅니다. `REJOINED` 다음에는 끊긴 동안 바뀐 다른 슬롯의 사건(`JOIN`·`LEAVE`·`HOLD`·`BACK`)이 차이만큼 옵니다.
- 짧은 끊김(같은 Wi-Fi 재연결로 주소가 바뀐 경우 포함)은 ICE 재시작으로 같은 연결을 복구합니다. 이 경우 게임에는 `STALL` → `RESUME`만 가고 메시지 손실이 없습니다.
- 방장 기기의 네트워크 끊김은 15초 안에서만 복구합니다. 넘으면 방장 `CLOSED(LOST)`, 유저 `CLOSED(HOST_LEFT)`로 세션이 끝납니다. 방장이 앱을 닫은 경우는 7.10.1(2분 안에 다시 열면 같은 방으로 돌아옴), 유저가 앱을 닫은 경우는 7.10.2(같은 기기에서 같은 게임을 다시 열면 같은 자리로 돌아옴).
- 방장이 세션을 끝내면 방이 닫혀 돌아오려던 기기에 `CLOSED(HOST_LEFT)`가 갑니다.

상태 묶음(1~262144바이트, 받는 곳 = 슬롯 한 개):

- ① 보내기: 송신 레코드 바이트 3 = `1`(조각, 이어짐) / `2`(마지막 조각). 조각 하나는 16384바이트까지이고 같은 받는 곳의 조각은 여러 프레임에 나눠도 됩니다. ① 받기: 묶음 전체가 모이면 `Web_NetInBuffer(len)`(len = 묶음 크기) → `Web_NetIn(from | 0x100, len)`. 0을 반환하면 다음 프레임에 다시 시도하고 뒤 메시지도 기다리므로, 묶음 최대 크기만큼의 받기 공간을 준비하세요.
- ② `webgba.net.sendState(to, bytes)` / `webgba.net.onstate`.
- 묶음은 같은 송신자의 메시지 사이에서 보낸 순서대로 도착합니다. 방장 링크가 다시 이어진 순간부터 묶음을 보내기 전까지 방장이 중계한 `TO_ORDERED` 메시지는 묶음보다 먼저 도착하고 그 내용은 묶음에 이미 들어 있습니다. 묶음에 게임이 적용한 순서 메시지 번호를 넣고, 돌아온 기기는 그보다 큰 번호만 적용하세요.
- 보관 중인 슬롯·없는 슬롯으로 보낸 묶음, 262144바이트를 넘는 묶음은 버립니다.

```text
방장 게임        끊긴 기기                 다른 기기
STALL(s)         STALL(0)                  STALL(s)
HOLD(s, n)       HOLD(s, n) "다시 연결하는 중…"   HOLD(s, n)
BACK(s, n)       REJOINED(s, n) → 차이 사건   BACK(s, n)
상태 묶음 → s    상태 묶음 적용 → 이후 TO_ORDERED
```

짝 찾기 서버 사용: 다시 들어오기 세션의 방장은 가득 찬 방도 120초마다 갱신해 세션 동안 방을 유지하고(명령 3개), 끊긴 슬롯이 있을 때만 서버 우편함을 확인합니다(1분 동안 2초, 이후 10초 간격). 끊긴 기기와 방장은 우편함(`/api/v1/mp/rj`)으로 연결 정보를 한 번씩 주고받습니다. 자리 열쇠(방장이 WELCOME에서 준 값)가 맞지 않으면 방장이 거부합니다.

##### 7.10.1 방장 돌아오기

`rejoin` 게임에서 유저가 있는 동안 방장이 앱을 닫거나(창 닫기·탭 닫기·새로 고침) 앱이 강제 종료되어도 방은 **2분 동안** 남습니다. 방장이 2분 안에 앱을 다시 열고 같은 게임(같은 게임 id·버전)을 열면 멀티플레이 창 첫 화면에 **이전 방으로 돌아가기**가 나오고, 누르면 같은 방 코드의 방장 자리로 돌아갑니다. 유저는 자동으로 다시 연결되고, 유저 한 명의 게임 상태(상태 묶음)를 방장이 받아 이어서 합니다.

- 방장 기기는 세션 동안 방 정보(방 코드·방장 증명·게임 호환 키·자리·자리 열쇠·시각)를 기기 안(웹 `localStorage`, exe 설정 파일)에 보관하고, 2분이 지나면 버립니다. 방장이 방을 닫거나 세션이 끝나면 바로 삭제합니다. 다른 게임을 열면 표시하지 않고, 돌아가지 않고 새 방을 만들거나 다른 방에 들어가면 이전 방을 닫습니다.
- 유저 화면: "방장을 기다리는 중… m:ss 남음" + 게임 멈춤(webGBA가 프레임을 멈춤) + "혼자 이어 하기". 2분이 지나면 `CLOSED(HOST_LEFT)`로 세션이 끝납니다.
- 사건: 유저는 `HOLD`(본인 슬롯) → `HOLD(0)`. 방장이 돌아오면 webGBA가 고른 유저 한 명(같은 때 다시 연결을 요청한 유저 중 가장 작은 슬롯)은 `BACK(0)`을 받고 **상태 묶음을 슬롯 0으로 보냅니다**(방장이 `BACK(s)`를 받았을 때와 같은 일). 나머지 유저는 `REJOINED`(본인 슬롯)를 받고 방장 게임이 보내는 묶음을 기다립니다. 돌아온 방장 기기는 `OPEN` 대신 `REJOINED(0)`을 받고 묶음을 기다리며, 아직 돌아오지 않은 슬롯은 `HOLD(s)`, 이후 `BACK(s)`(묶음을 받은 뒤에만)로 받습니다. 묶음이 10초 안에 오지 않으면 나머지 `BACK`을 그대로 보냅니다.
- 방장 앱을 닫을 때 webGBA가 유저에게 바로 알리고(연결 제어 메시지), 서버에 방 보관을 요청합니다(`POST /api/v1/mp/away`, 방장 증명). 알리지 못하고 끊긴 경우(강제 종료 등)에는 유저가 다시 연결을 20초 동안 받지 못하면 서버에 보관을 요청합니다(`POST /api/v1/mp/hold`, 들어가기 표). 보관 시간은 처음 요청한 때부터 2분이고 늘리지 않습니다. 돌아오기 = `POST /api/v1/mp/back`(방장 증명만, 방 기록이 남아 있을 때만).
- 기본 TURN 중계 서버를 쓰는 연결은 돌아온 방장도 새 접속 정보를 받습니다(직접 연결·중계 모두).

```text
방장 기기(닫힘 → 다시 열기)          유저 기기(묶음 보냄)            다른 유저
앱 닫기 → 알림·away                  HOLD(본인)·HOLD(0) "방장을 기다리는 중…"  HOLD(본인)·HOLD(0)
"이전 방으로 돌아가기" → back
REJOINED(0) · HOLD(그 밖)             BACK(0) → 상태 묶음 → 0           REJOINED(본인)
묶음 적용 → BACK(s) → 상태 묶음 → s                                  상태 묶음 적용
```

##### 7.10.2 유저 돌아오기

`rejoin` 게임에서 방 코드로 들어간 유저가 앱을 닫거나(창 닫기·탭 닫기·새로 고침·강제 종료) 연결이 끊겨도, 방장은 자리를 보관합니다(`HOLD`). 유저가 같은 기기에서 같은 게임(같은 게임 id·버전)을 다시 열면 멀티플레이 창 첫 화면에 **이전 방으로 돌아가기**(방 코드·방장 이름)가 나오고, 누르면 같은 방의 같은 자리로 다시 들어갑니다(7.10과 같은 길).

- 유저 기기는 세션 동안 자리 정보(방 코드·자리·자리 열쇠·들어가기 표)를 기기 안(웹 `localStorage`, exe 설정 파일)에 보관하고, 세션이 끝나면(나가기·방장이 나감·혼자 이어 하기·다른 게임) 바로 지웁니다. 마지막 보관부터 10분이 지나면 표시하지 않습니다.
- 사건: 방장·다른 기기는 `BACK(s)`, 돌아온 기기는 `REJOINED(s)`(새로 연 게임이라 `OPEN`·`HOLD` 없음). 방장 게임이 상태 묶음을 보내는 것은 7.10과 같습니다.
- 돌아가지 않고 새 방을 만들거나 다른 방에 들어가면 이전 자리 정보를 지우고 방장에게 알려(혼자 이어 하기와 같은 알림) 보관 자리를 비웁니다.
- 방장이 그사이 세션을 끝냈으면 `CLOSED(HOST_LEFT)` 로 끝납니다.

#### 7.11 인터넷 연결·중계 서버·게임별 연결 서버 (`iceServers`, 규약 1 확장)

설정 › 멀티플레이 **멀티플레이 사용**이 켜져 있으면(기본, 웹·PC 버전) 방 코드로 다른 네트워크의 기기와도 연결합니다. 별도 인터넷 연결 설정은 없습니다.

- 연결 서버(기본 = 공개 STUN 2곳 `stun.l.google.com:19302`·`stun.cloudflare.com:3478` + Cloudflare 중계 서버(TURN))로 공인 주소 후보(srflx·전역 IPv6)와 중계 후보(relay)를 모으고, 연결 정보(방장 코드·답 코드·방 Offer/Answer)에 넣습니다. **상대 기기에 이 기기의 공인 IP가 보입니다.**
- **직접 연결을 먼저 시도합니다.** 같은 Wi-Fi·일반 공유기끼리는 직접 연결되고, 대칭 NAT(휴대폰 데이터 등)처럼 직접 연결이 되지 않는 경우에만 Cloudflare 중계 서버를 거칩니다. 중계 서버는 두 기기의 IP를 알 수 있지만 게임 내용은 암호화되어(DTLS) 볼 수 없습니다. 중계로 연결되면 상태 표의 연결 칸에 "중계 · Nms"를 표시합니다.
- 중계 서버 접속 정보는 짝 찾기 서버가 발급합니다(`POST /api/v1/mp/turn`). 열린 방이 있는 기기(방장 = 방 토큰, 유저 = 들어가기 표)만 받고, 공인 IP 묶음마다 1시간 30번까지, 수명은 1시간입니다. 긴 게임은 만료 10분 전에 새 접속 정보로 ICE 재시작(연결 끊김 없음), 다시 들어오기도 새 접속 정보를 씁니다. 연결 코드(인터넷 없이 연결)는 짝 찾기 서버를 쓰지 않으므로 STUN만 씁니다.
- 중계 서버 무료 한도를 지키려고 최근 31일 중계 사용량(Cloudflare 집계)이 900GB 이상이거나 사용량을 확인할 수 없으면 발급을 멈춥니다. 그 동안은 STUN만으로 연결하고, 직접 연결이 되지 않는 망은 실패합니다.
- 직접 연결과 중계 연결이 모두 실패하면 이유를 안내합니다: 내 망이 대칭 NAT로 보이면 "…이 기기의 망(휴대폰 데이터 등)은 다른 곳의 기기와 바로 연결되지 않고, 중계 서버를 거친 연결도 되지 않았습니다. 이 기기를 와이파이에 연결한 뒤 다시 해주세요.", 상대 망이면 "상대 기기를 …", 그 밖은 "상대 기기와 연결하지 못했습니다. '확인할 것' 목록을 살펴봐 주세요."
- 근처 방 목록은 같은 공유기(같은 공인 IP)만 보여 줍니다.

`multiplayer.iceServers` — 게임이 자체 STUN·TURN 서버를 지정합니다. 지정하면 webGBA 기본 서버(STUN·Cloudflare TURN) 대신 **게임 목록만** 씁니다. 지정하지 않은 게임은 webGBA 기본 서버입니다.

| 키 | 타입 | 설명 |
|---|---|---|
| `urls` | 문자열 \| 문자열 배열 | `stun:`·`turn:`·`turns:` 주소(`host[:port][?transport=udp\|tcp]`, 256자까지). 모든 항목의 주소를 합쳐 4개까지 |
| `username`·`credential` | 문자열(512자까지) | 고정 TURN 접속 정보. **파일에서 누구나 꺼낼 수 있어 다른 사람이 TURN을 쓸 수 있습니다** — `credentialUrl` 권장(`wgba.mjs check` 경고) |
| `credentialUrl` | `https://` 주소(512자까지) | TURN 항목 전용. 연결할 때만 호스트가 `GET`(쿠키·리퍼러 없음, 리디렉션 거부, 5초·8KB 제한)으로 요청. 응답 `{ "username": "…", "credential": "…", "ttl": 초 }`(ttl 선택). 서버 주소는 manifest 값만 씀(응답으로 바꿀 수 없음). CORS로 webGBA 출처(`https://webgba.vercel.app`, PC 버전 `http://ui.localhost`)를 허용해야 함 |

```json
"iceServers": [
  { "urls": "stun:stun.example.com:3478" },
  { "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"], "credentialUrl": "https://example.com/api/turn-credential" }
]
```

- 형식이 틀린 항목은 쓰지 않습니다(로그). `credentialUrl` 요청이 실패하면(시간 초과·잘못된 응답·HTTP 오류) 그 항목만 빼고 연결하고 연결 창에 안내합니다.
- 연결 창에 "이 게임의 연결 서버: <도메인>"을 표시합니다. TURN을 거치면 해당 서버는 두 기기의 IP를 알 수 있지만 게임 내용은 암호화되어 볼 수 없습니다. 별도 동의 창은 없습니다(설정 › 멀티플레이 사용 설명에서 안내).
- 연결 서버 요청은 webGBA(호스트)가 연결하는 동안에만 보냅니다. 게임 틀(② JS)은 여전히 네트워크를 직접 쓸 수 없습니다(8장).

#### 7.12 중간 참가 게임 (`join: "anytime"`, 규약 1 확장)

혼자 진행하다가 언제든 다른 사람이 들어오게 하는 게임(예: 아케이드 게임의 이어 하기 참가)용입니다. 이런 게임은 시작부터 요청(`Web_NetWanted` 0이 아닌 값 / `webgba.net.want()`)을 유지하므로, 기본 동작(7.7)이면 시작하자마자 창이 열리고 3분 뒤 `TIMEOUT`이 되며 방장은 첫 유저가 올 때까지 창을 닫을 수 없습니다. manifest에 `multiplayer.join: "anytime"`을 기재하면 아래와 같이 동작합니다. 기재하지 않은 게임은 7.7 그대로입니다.

- **창 자동 열림 없음**: 요청이 있으면 상단 "멀티플레이" 버튼(PC 버전 = 도구 막대 버튼)만 보입니다. 사용자가 버튼으로 창을 열어 방 만들기·코드로 들어가기·근처 방을 사용합니다.
- **시간 초과 없음**: 게임이 요청을 거둘 때(0 / `unwant()`)까지 요청을 유지하고, 기다리는 동안 `CLOSED(TIMEOUT)`을 보내지 않습니다.
- **참가 받기 2분 30초**: 방을 만들거나 창의 **갱신**을 누르면 그때부터 2분 30초 동안 참가를 받습니다. 창을 닫고 게임을 해도 유지되며, 지나면 받기를 멈추고 알립니다(짝 찾기 서버 요청도 멈춤). 다시 받으려면 **갱신** — 같은 방 코드를 다시 쓰고, 그사이 다른 방이 가져갔으면 새 코드를 받습니다. 이미 들어온 사람은 그대로이고, 갱신 뒤 들어오는 사람은 다음 자리 번호를 받습니다.
- 방장 혼자(인원 1)서도 창을 닫을 수 있습니다(창 하단 = 방 나가기 · 닫기). 창에는 "참가 받는 중 · 남은 시간" / "참가 받기 멈춤"과 갱신 버튼이 보입니다.
- 방장 쪽 상단 버튼 표시: 웹 = 인원 배지 파랑(받는 중)·회색(멈춤), PC 버전 = 버튼 모서리 점 초록(받는 중)·회색(멈춤)과 상태 줄 "참가 받는 중 · 2:14 남음" / "참가 받기 멈춤". 유저가 들어오면 알림(웹 = 토스트, PC 버전 = 상태 줄)과 `JOIN`.
- 멈춘 방에 들어가려 하면 "방장이 참가 받기를 멈춘 방입니다. 방장에게 '갱신'을 눌러 달라고 하세요"를 표시합니다(서버가 거부하고 근처 목록에서도 빠짐).
- 창을 닫거나 취소해도 게임에 `CLOSED(CANCEL)`을 보내지 않습니다(진행 중인 들어가기 시도만 정리). 방을 닫으려면 창의 "방 나가기" → `CLOSED(LEFT)`.
- 유저 쪽 들어가는 흐름·`rejoin`(7.10)·인터넷 연결(7.11)·상태 메뉴(7.9)는 같습니다.
- 짝 찾기 서버: 받는 동안 방장은 3초(1분 뒤 5초)마다 유저의 답을 확인합니다(명령 1개). 방 만들기·갱신 한 번 = 받는 2분 30초 동안 약 45명령(방 만들기·갱신 4~6 + 확인 약 38 + 멈춤 표시 3), 멈춘 뒤 게임 중에는 0입니다. 다시 들어오기(7.10)를 켠 게임은 유저가 있으면 끊긴 자리 복귀용으로 멈춘 뒤에도 방을 120초마다 갱신합니다(3~4명령, 1시간 약 120명령).

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
- manifest: 64KB 이하 JSON, `wgba` 1, `id` 규칙, `version`이 `x.y.z`, `name`(문자열 또는 언어 칸마다 1~48자, 칸 이름과 함께 오류 표시, `en`·`ko`·`ja` 칸이 하나도 없거나 공백뿐인 칸은 경고), `runtime`, 모르는 `needs` 없음, `homepage`는 `https://`, `screen`·`save`·`input.preset`·`input.dpad`·`cart.color` 값, `display`는 객체·`display.aspect`는 `"정수:정수"`(W·H 1~1024, 비율 1:4~4:1), 버튼 id 규칙·중복, role 중복, `shortName` 칸이 16자 초과면 경고. `info`는 `name`·`shortName`을 화면 언어(en·ko·ja)마다 표시할 글로 출력(다른 칸을 쓰면 `ja → en …`)
- ①: 필수 내보내기 4개, 모르는 가져오기 없음, 버튼 `bit` 0~31이고 중복 없음, `Web_Net*` 일곱 개(7.3) 중 일부만 있으면 경고, 240×160·GBA 버튼이 아니거나 롬 없이 실행되는데(`rom.required: false`) `webgba.v1`이 없으면 경고, `js` chunk가 있으면 경고(사용하지 않음)
- 멀티플레이: `multiplayer.protocol` 1(1보다 큰 정수 = 경고 — 멀티플레이 없이 실행, 나머지 `multiplayer` 항목은 검사하지 않음 / 없음·1 이상 정수가 아님 = 오류), `purposes[].id` 규칙·중복 없음, 인원 2~8, `rejoin` 불리언, `join`(`"anytime"`만), `iceServers`(7.11 형식 = 오류, 고정 TURN 접속 정보 = 경고), `board`(7.9.1 형식 = 오류, 모르는 키 = 경고), ①에서 `Web_NetBoard`와 `multiplayer.board` 중 한쪽만 있으면 경고
- ②: `js` chunk 있음, `entry.style`, `entry.js`가 `"js"`가 아니면 경고, 버튼별 `code`, 가져온 공유 메모리(스레드) 없음
- `update`(있을 때): 객체, `feed`는 `https://` 주소(512자 이하), `key`는 P-256 공개 키 base64(88자, `04`로 시작) — 아니면 오류
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
| 멀티플레이 규약 `multiplayer.protocol`(현재 1) | 통신 규약이 변경될 때 | 호스트가 지원하는 번호보다 크면 멀티플레이만 비활성화하고 게임은 실행, 멀티플레이 버튼·연결 창에 새 webGBA가 필요하다고 안내(7.2) |
| 롬 chunk WGRM 형식(현재 1) | 롬 헤더가 변경될 때 | 모르면 열지 않음 |
| 게임 `version` | 제작자 재량(콘텐츠 변경 시) | 업데이트 여부 구분·표시에만 사용 |

레거시 파일: TOC·manifest가 없는 `.wgba`(wasm 그대로, 또는 끝에 `webgba.rom`만 있는 파일)도 webGBA는 계속 지원합니다. 이때는 ① · 240×160 · GBA 버튼 · 이름은 파일 이름으로 처리합니다.

---

### 12. 온라인 업데이트 (`update`, 규격 1 확장)

배포한 `.wgba`의 새 버전을 사용자가 파일을 다시 받지 않고 적용하게 하는 선택 기능입니다. 제작자는 정적 파일 서버(예: Cloudflare R2 공개 버킷)에 **버전 파일**과 **차이 패치**를 올리고, webGBA는 앱을 실행할 때마다 한 번 확인한 뒤 사용자가 "업데이트"를 누를 때만 적용합니다. 서버 프로그램은 필요하지 않습니다(정적 파일 `GET`만).

#### 12.1 manifest `update`

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `feed` | 문자열 | 버전 파일 주소. `https://`만(512자 이하). 예 `https://pub-0123abcd.r2.dev/io.github.someone.mygame/latest.json` |
| `key` | 문자열 | 서명 공개 키 — ECDSA P-256, 압축하지 않은 점 65바이트(`04` ‖ X ‖ Y)의 base64(표준, `=` 포함 88자). `wgba.mjs keygen`이 출력 |

- 서버는 버전 파일·패치·`.wgbp`에 CORS `GET`을 허용합니다(출처 `https://webgba.vercel.app`·`http://ui.localhost`, 또는 `*`).
- 응답 머리: 버전 파일 `Cache-Control: no-cache`, 패치·`.wgbp`는 내용 해시 이름 + `public, max-age=31536000, immutable`.
- webGBA 안의 알려진 게임 id 표(제작자 요청으로 추가)에 있는 게임은 표의 주소·키를 먼저 사용합니다 — `update`가 없는 이미 배포한 `.wgba`도 확인하고, 서버 주소를 옮길 때 webGBA 업데이트로 바꿀 수 있습니다.
- 비밀 키를 잃으면 같은 `key`로 새 버전 파일을 낼 수 없습니다. 키를 바꾸면 사용자가 새 `key`가 든 `.wgba`를 한 번 직접 받아야 합니다.

#### 12.2 버전 파일 `latest.json`

봉투(UTF-8 JSON):

```json
{ "wgbaFeed": 1, "signed": "<서명한 JSON 글>", "signature": "<base64, 64바이트>" }
```

- `signature` = `signed` 글(UTF-8 바이트 그대로)의 ECDSA P-256·SHA-256 서명. r ‖ s 각 32바이트(IEEE P1363 — WebCrypto `verify`가 받는 형식).
- 호스트는 서명이 맞을 때만 `signed`를 JSON으로 조회합니다. 봉투의 다른 필드·공백은 서명 대상이 아닙니다. `wgbaFeed`가 모르는 번호면 무시합니다.

`signed` 내용:

| 필드 | 설명 |
| --- | --- |
| `id` | 게임 id(manifest `id`와 같아야 함) |
| `version` | 새 버전 `x.y.z` |
| `time` | 선택. 생성 시각(ISO 8601) |
| `wgba` | `{ "sha1", "size" }` — 새 `.wgba` 파일 전체의 SHA-1(소문자 16진수 40자)·크기 |
| `from` | 배열(256개까지). `{ "sha1", "version", "to", "patch": { "url", "size", "sha256" } }` = 파일 SHA-1이 `sha1`인 `.wgba`에 `patch`를 적용하면 SHA-1 `to`가 됩니다. `to`가 새 버전이 아니면 `to`로 다시 찾아 이어서 적용합니다(건너뛴 버전 연쇄, 64단계까지). 같은 `sha1`이 여러 개면 단계 수가 가장 적은 경로(같으면 받는 양이 적은 것)를 사용 — webGBA 0.8.0 이하는 `to`가 새 버전인 항목을 먼저 |
| `full` | 선택. `{ "url", "size", "sha256" }` — 전체 설치용 `.wgbp`. `from` 표에 없는 파일은 원본 롬을 선택해 이 `.wgbp`로 새로 만듭니다 |
| `notes` | 선택. 언어별 글(예약 — 현재 webGBA는 표시하지 않음) |

- `url`은 버전 파일 주소 기준 상대 주소 또는 `https://` 절대 주소입니다. `sha256`은 받은 파일 전체의 SHA-256(소문자 16진수 64자)입니다.
- 바로 가는 패치: 옛 버전마다 새 버전으로 바로 가는 항목(`to` = 새 버전)을 두면 업데이트 1번 = 패치 받기 1번입니다. `wgba.mjs feed --old`가 생성합니다.

#### 12.2.1 업데이트 목록 `index.json` (webGBA 0.8.1~)

알려진 게임 id 표의 게임과 설명서 `update`가 이 버킷의 `<게임 id>/latest.json`·같은 공개 키인 게임(webGBA 0.9.2부터, 0.9.1 이하는 알려진 게임 id 표의 게임만)은 앱 실행마다 게임별 `latest.json` 대신 버킷 최상위의 **목록** 1개만 조회합니다(게임 수와 무관하게 요청 1번, 목록에 그 게임이 없거나 목록을 못 읽을 때만 게임별 `latest.json`). 목록 = 게임별 `latest.json` 봉투를 그대로 담고 목록 자체에도 서명한 파일입니다.

```json
{
 "wgbaIndex": 1,
 "signed": "{\"time\":\"2026-11-06T04:16:10Z\",\"feeds\":{\"<게임 id>\":\"<SHA-256>\"}}",
 "signature": "<base64, 64바이트>",
 "feeds": { "<게임 id>": { "wgbaFeed": 1, "signed": "…", "signature": "…" } }
}
```

| 필드 | 설명 |
| --- | --- |
| `signed.time` | 목록 생성 시각(ISO 8601). 호스트는 목록 주소마다 확인한 시각 중 가장 늦은 것을 기억하고, 그보다 이른 목록은 사용하지 않습니다(오래된 목록 되돌리기 방지) |
| `signed.feeds` | 게임 id → 해당 게임 봉투의 `signed` 글(UTF-8 바이트) SHA-256(소문자 16진수 64자) |
| `feeds` | 게임 id → `<게임 id>/latest.json`과 같은 봉투. 호스트는 해시를 확인한 후 12.2와 같이 서명·내용을 확인합니다. 상대 `url`의 기준 = `<목록과 같은 폴더>/<게임 id>/latest.json` |

- 서명 = `signed` 글의 ECDSA P-256·SHA-256(12.2와 같은 키·형식). 목록 크기는 1MiB까지.
- 대체: 목록이 존재하지 않음(404 등)·`wgbaIndex`가 모르는 번호·서명 불일치·이전보다 이른 시각·게임 누락·해시 불일치이면 해당 게임은 게임별 `latest.json`을 조회합니다. 서버에 닿지 않으면(오프라인) 대체하지 않고 넘어갑니다.
- 옛 webGBA(0.8.0 이하)는 목록을 조회하지 않으므로 게임별 `latest.json`도 계속 발행합니다. manifest `update`의 다른 주소 버전 파일은 게임별 조회 그대로입니다.
- 선택 필드 `apps`(봉투)·`signed.apps`(해시) = webGBA 자체 업데이트 항목(12.6, 0.9.0부터). 0.8.1 이하는 조회하지 않습니다.
- 선택 필드 `signed.groups` = 게임 id → `{ "group": "emu" | "arcade" | "mobile", "category": "<코어·기판, 영문·숫자 1~24자>" }`(웹 라이브러리 그룹 버튼·카테고리). 서명 범위 안이라 값을 바꾸면 목록 전체가 서명 불일치로 거부됩니다. 이미 등록된 게임도 다음 목록 조회 때 값이 들어갑니다. 목록에 없는 게임은 manifest `group`(13.3)으로, `group`도 없으면 `.wmba`(manifest `mobile`)는 모바일·그 밖 게임과 `.gba`·`.gb`·`.gbc`는 에뮬로 표시합니다. webGBA 0.10.0부터 조회하고, 0.9.2 이하는 조회하지 않습니다(목록 확인은 그대로).

#### 12.3 차이 패치 `.wgbd`

little endian:

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4 | `WGBD` |
| 4 | 2 | 머리 길이(72 + meta 길이) |
| 6 | 1 | 형식 번호 1 |
| 7 | 1 | flag: 비트 0 = 확장 바탕, 비트 1 = 롬 다시 묶기 |
| 8 · 12 | 4 · 4 | 옛 파일 크기 · 새 파일 크기 |
| 16 · 36 | 20 · 20 | 옛 파일 SHA-1 · 새 파일 SHA-1 |
| 56 · 60 | 4 · 4 | 몸통 길이 · 몸통 압축 해제 길이 |
| 64 | 4 | 앞부분 길이(비트 1일 때) |
| 68 · 69 | 1 · 1 | 롬 압축 level · 롬 압축(0 무압축 · 1 zlib) (비트 1일 때) |
| 70 | 2 | meta 길이 n |
| 72 | n | meta — UTF-8 JSON `{ "id", "from", "to" }`(표시용) |
| 72 + n | 나머지 | 몸통 = zlib(RFC 1950)으로 압축한 BPS 패치 |

- 바탕(BPS source) = 옛 파일. 비트 0이면 옛 파일 ‖ 옛 롬 chunk를 푼 롬.
- 비트 1이 없으면 BPS 결과 = 새 파일. 비트 1이면 BPS 결과 = 새 파일의 앞부분(롬 chunk 내용 시작 전까지, 길이 = 64번) ‖ 새 롬이고, 새 롬을 WGRM 1(2.2절, 압축 = 69번, level = 68번, pako)로 다시 묶어 붙입니다. 롬 chunk는 zlib로 저장되어 롬이 조금만 바뀌어도 압축 바이트 대부분이 바뀌므로, 푼 롬끼리 비교합니다.
- 적용 후 크기·SHA-1이 머리와 같아야 합니다(BPS 자체 CRC32도 확인).

#### 12.4 호스트 동작

- 앱 실행(웹 페이지 열기·Windows 앱 시작) 때마다 한 번, 온라인이면 확인합니다. 대상 = 웹 버전 라이브러리의 `.wgba`, Windows 앱의 즐겨찾기·최근·같은 폴더의 `.wgba`. 알려진 게임 id 표의 게임은 목록(12.2.1) 1번, 그 외 게임은 같은 버전 파일을 한 번만 받습니다. 실행 중에는 다시 확인하지 않습니다.
- 경로 = 단계 수가 가장 적은 연쇄(같으면 받는 양이 적은 것). 바로 가는 패치가 있으면 1단계입니다.
- 오프라인·받기 실패·서명 불일치는 알림 없이 넘어갑니다(기록만).
- 새 버전이 있을 때만 업데이트 창을 표시합니다: 줄마다 롬팩 그림·이름·현재 버전 → 새 버전·크기와 "업데이트" 버튼, 아래에 전체(체크한 게임) 업데이트·나중에. 창을 닫은 뒤에도 같은 실행 동안 라이브러리(Windows 앱은 첫 화면·옆 목록의 줄)·정보 화면에 업데이트 표시와 버튼이 남습니다.
- 파일 SHA-1이 `from` 표에 없고 `full`도 없으면 업데이트 창·라이브러리·정보 화면에 아무것도 표시하지 않습니다(기록만). 패치 경로가 있는 `.wgba`를 가진 사람에게만 업데이트가 보입니다.
- 적용 = 받기(크기·SHA-256) → 적용 → 결과 SHA-1 = 버전 파일 `wgba.sha1` → 교체(Windows 앱은 임시 파일에 쓴 뒤 바꿈). 실패하면 기존 파일을 그대로 둡니다.
- 세이브는 그대로 이어집니다(웹 = 게임 id, Windows 앱 = 파일 옆 `.sav`). 퀵슬롯은 만든 버전을 기록하고, 다른 버전에서 만든 칸은 불러오지 않습니다(덮어쓸 때까지 남음).
- 실행 중인 게임은 게임을 종료한 뒤 업데이트합니다.
- 업데이트 동안 webGBA 웹 서버에는 요청하지 않습니다 — 버전 파일·패치는 `feed` 서버에서 직접 받습니다.

#### 12.5 배포 도구

```text
node tools/wgba.mjs keygen -o <저장소 밖 비밀 키.pem>
node tools/wgba.mjs diff <옛.wgba> <새.wgba> -o <패치.wgbd> [--orig <원작 롬>]…
node tools/wgba.mjs feed --dir <발행 폴더> --key <비밀 키.pem> --wgba <새.wgba> [--patch <패치.wgbd>]… [--old <옛.wgba|폴더>]… [--orig <원작 롬>]… [--full <새.wgbp>] [--notes <글.json>] [--prev <latest.json>] [--no-index]
node tools/wgba.mjs app --dir <발행 폴더 묶음>/com.flightrabbit.webgba --key <비밀 키.pem> --exe <webgba.exe> [--file <LICENSE 등>]… [--notes <글.json>] [--no-index] [--dry-run]
node tools/wgba.mjs index --root <발행 폴더 묶음> --key <비밀 키.pem>
node tools/wgba.mjs verify <발행 폴더|묶음> (--pub <공개 키> | --key <비밀 키.pem>) [--wgba <옛.wgba>]…
node tools/wgba.mjs upload [<발행 폴더|묶음>] [--wgba <새.wgba>]… [--dry-run [--remote]]
node tools/wgba.mjs admin-key [--dry-run]
node tools/wgba.mjs private-prune [--dry-run]
node tools/wgba.mjs r2-stats [--days <일 수> | --since <ISO 시각> [--until <ISO 시각>]] [--top <줄 수>] [--bucket public|private|all] [--hourly]
```

- 발행 폴더 묶음 = 버킷 최상위와 같은 구조(`index.json` · `<게임 id>/…`).

- `keygen`: 비밀 키는 git 저장소 밖에만 저장합니다(저장소 안이면 거절). 화면에는 공개 키만 출력합니다.
- `diff`: 같은 id·더 높은 버전만. 만든 뒤 적용해 새 파일과 바이트 단위까지 같은지 확인합니다. `--orig`를 주면 패치에 새로 들어가는 바이트에 원작 롬과 32바이트 이상 같은 구간이 있는지 검사하고, 있으면 패치를 쓰지 않습니다(그 버전은 `.wgbp` 전체 설치로만 배포). 롬이 그대로인 버전 사이는 옛 파일만 바탕으로 하고, 새 code에 롬 바이트가 들어가 검사에 걸리면 확장 바탕(비트 0)으로 다시 만들어 해당 바이트를 옛 롬에서 복사(BPS SourceCopy)합니다.
- `feed`: 발행 폴더 = 버킷의 `<게임 id>/`와 같은 구조(`latest.json` · `patches/<SHA-256>.wgbd` · `full/<SHA-256>.wgbp`). 발행 폴더의 이전 `latest.json`(`--prev`로 다른 파일 지정 가능)의 `from` 표를 이어받고, 모든 이전 버전이 새 버전까지 이어지는지 확인한 뒤 서명합니다. 같은 `.wgba`로 다시 실행하면 `full`·`notes`를 이어받습니다.
  - `--old`(파일 또는 폴더 안 `.wgba`): 같은 id·낮은 버전마다 새 버전으로 바로 가는 패치를 생성합니다. 새 파일에 롬이 있으면 `--orig`가 필요하고, 원작 롬과 같은 구간이 있는 패치는 쓰지 않습니다(해당 옛 버전은 기존 단계 연쇄 유지). 바로 가는 패치가 생긴 옛 버전의 이전 건너뛰는 항목(바로 다음 버전이 아닌 곳으로 가는 항목)은 `from`에서 제외합니다 — 단계 항목은 유지, 파일은 그대로.
  - 묶음(발행 폴더의 상위 폴더)에 `index.json`이 있으면 목록도 다시 생성합니다(`--no-index`로 끔).
- `index`: 묶음의 `<게임 id>/latest.json`(같은 키로 서명한 것)을 모두 담은 `index.json`을 생성합니다. 시각은 기존 목록보다 이르지 않게 정합니다. 묶음에 `groups.json`(게임 id → `{ group, category }`, `$`로 시작하는 키는 설명)이 있으면 목록에 든 게임만 `signed.groups`에 넣고, 값이 규칙 밖이면 목록을 만들지 않습니다(`feed`의 목록 재생성도 같음). `groups.json`은 올리지 않습니다.
- `verify`: 서명·파일 크기·SHA-256, `--wgba`로 준 옛 파일마다 끝까지 적용해 새 SHA-1과 비교합니다. 묶음이면 목록 서명과 게임마다 목록 항목 = `latest.json`인지도 확인하고(옛 파일은 id로 게임을 찾음), 게임 폴더면 상위 폴더 목록의 해당 게임 항목을 확인합니다.
- `upload`: S3 호환 API(R2)로 패치·`.wgbp`를 먼저, `latest.json`을 다음에, `index.json`을 마지막에 올립니다(버킷에 같은 내용(크기·ETag MD5)이 이미 있으면 건너뜀 — 바뀌지 않은 `latest.json`도 다시 쓰지 않음). 버킷 확인은 목록 조회 1번(ListObjectsV2, 1,000개당 1번 = Class A)이고, 목록이 실패할 때만 파일마다 HEAD(Class B)로 확인합니다. `--dry-run`은 버킷에 연결하지 않고, `--dry-run --remote`는 목록 1번으로 버킷과 비교만 합니다(쓰기 없음). 묶음에 `index.json`이 있으면 게임 폴더를 주어도 묶음 전체를 올리고, 목록과 `latest.json`이 다르면 올리지 않습니다. 계정·키는 환경 변수 `R2_ACCOUNT_ID`·`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`·`R2_BUCKET`에서만 조회하고 값을 출력하지 않습니다.
- `r2-stats`: Cloudflare 분석 API(GraphQL `r2OperationsAdaptiveGroups`)로 R2 요청 수를 한국 날짜별·객체·동작·응답 코드별로 출력합니다(버킷 요청 0번, 기본 7일·최대 31일). 객체 이름으로 출처를 추정합니다 — `index.json` = webGBA 0.8.1 이상, `<게임 id>/latest.json` = 0.8.0 이하(또는 목록 실패 시 대체), `patches/`·`full/` = 업데이트 받기, HeadObject = 이전 `upload`·대시보드, 404·그 외 객체 = 외부 요청 의심, `roms.json` = 롬 가져오기 목록(서버 list), `authentication.key` = 관리자 서버 키 읽기, `wgba/…wgba` = 비공개 받기(또는 roms.json 이 없을 때 목록 머리 범위 GET). `--bucket` = `public`(기본, `R2_BUCKET`)·`private`(`R2_PRIVATE_BUCKET`)·`all`(버킷별 합계), `--hourly` = 한국 시각 시 단위 상위. 환경 변수 `CF_API_TOKEN`(Account Analytics 읽기 권한 API 토큰)·`R2_ACCOUNT_ID`·`R2_BUCKET`·`R2_PRIVATE_BUCKET`, 값은 출력하지 않습니다.
- `upload --wgba`: 전체 `.wgba`를 비공개 버킷(관리자 모드 "롬 가져오기" 전용, 공개 주소 꺼짐)의 `wgba/<게임 id>/<버전>.wgba`에 올립니다(원본 파일 이름과 무관, 같은 크기·ETag면 건너뜀, 버킷 확인 = 목록 1번). 받을 때 저장 이름도 버킷 객체 이름이 아닌 게임 id로 정합니다 — 래피드 `pokemon-rapid-v.<버전>.wgba`, 그 외 영어 이름을 소문자·하이픈으로(다른 이름은 `api/_admin/save-name.js` 표). 발행 폴더 없이 `--wgba`만 주어도 됩니다. 올린 뒤 같은 게임의 이전 버전을 삭제하고, 공개 버킷 `roms.json`(롬 가져오기 목록 — 게임마다 최신 하나의 이름·버전·저장 이름·라벨 그림·비공개 버킷 객체 경로)을 다시 씁니다(`private-prune`도 같음). 서버 목록은 이 파일만 1번 읽습니다. `--groups <groups.json>`(또는 발행 폴더 옆 `groups.json`)이 있으면 항목에 `group`·`category`를 넣습니다(롬 가져오기 그룹 버튼, 없으면 앱이 업데이트 목록의 `signed.groups`로 판정). 환경 변수 `R2_ACCOUNT_ID`·`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`·`R2_PRIVATE_BUCKET`·`R2_BUCKET`.
- `admin-key`: 관리자 6자리(0~9·`!`·`#`)를 화면에 `•`로만 표시하며 두 번 받아 SHA-256을 비공개 버킷 `authentication.key`(`{"sha256":"…","updated":"YYYY-MM-DD HH:mm"}`, 한국 시각)에 올립니다. 6자리·해시는 출력하지 않습니다(6자리는 해시만으로 바로 역산되므로 키 파일도 비밀). 갱신일자보다 먼저 켠 관리자 모드는 "롬 가져오기" 때 다시 입력합니다. 서버 반영까지 최대 5분. 파일을 직접 고쳐도 됩니다(미래 시각은 거절).
- `app`: webGBA exe 자체 업데이트 발행(12.6). `index`·`verify`·`upload`는 묶음의 앱 폴더도 함께 다룹니다.

#### 12.6 webGBA 자체 업데이트 (Windows 앱)

webGBA 운영자용입니다(게임 제작자는 쓰지 않음). 대상 = webGBA Windows 앱 0.9.0부터. 웹 버전은 대상이 아닙니다.

- 확인: `.wgba` 확인과 같은 때, 같은 목록 `index.json`의 `apps`(봉투)·`signed.apps`(봉투 `signed` 글 SHA-256). 앱 실행 1회 요청은 그대로 1번입니다. 목록이 404·서명·시각·해시 실패일 때만 `com.flightrabbit.webgba/latest.json`을 조회하고, 목록에 앱 항목이 없으면 추가로 조회하지 않습니다.
- 봉투 `{ "wgbaApp": 1, "signed": "<서명한 JSON 글>", "signature": "<base64, 64바이트>" }` — 서명 = 12.2와 같은 키·형식.

| `signed` 필드 | 설명 |
| --- | --- |
| `id` | `com.flightrabbit.webgba` |
| `version` | 새 버전 `x.y.z`. 지금 앱 버전보다 높을 때만 표시 |
| `time` | 선택. 생성 시각(ISO 8601) |
| `platform` | `windows-x64` |
| `files` | 배열(16개까지). `{ "path", "size", "sha256", "get": { "url", "size", "sha256" } }` — `path` = exe 폴더 기준 상대 경로(영문·숫자·`._-` 조각, `bin/` 아래·상위 폴더·`.old`로 끝나는 이름 금지), `webgba.exe`(실행 중인 exe — 이름을 바꿨어도) 필수. `get` = zlib(RFC 1950)으로 압축한 파일(12.2와 같은 상대 주소 규칙) |
| `notes` | 선택. 언어별 글(예약) |

- 받기: 로컬 파일 SHA-256과 다른 파일만 → 받은 파일 크기·SHA-256 → 푼 파일 크기·SHA-256. `bin/core`의 코어는 exe 안에 들어 있어 새 exe가 시작할 때 교체합니다(사람이 바꿔 넣은 코어는 그대로).
- 교체: exe 폴더의 `.webgba-update\`에 받은 파일 → 새 exe를 `--webgba-version`으로 실행해 출력 `webGBA <버전>`이 `version`과 같은지 확인 → 파일마다 현재 파일을 `<이름>.old`로, 받은 파일을 원래 이름으로(하나라도 실패하면 모두 되돌림) → 새 exe 실행(실패하면 되돌림) → 기존 앱 정상 종료. 새 exe는 기존 프로세스가 끝나기를 기다린 뒤 시작하고, 화면이 뜬 뒤 `.old`·`.webgba-update\`를 삭제합니다.
- 유지: `bin/`(설정·로그·퀵슬롯·WebView 데이터)·게임 옆 `.sav`는 교체 대상이 아닙니다. exe 폴더에 기록할 수 없으면 업데이트하지 못합니다(안내만).
- 발행: `wgba.mjs app` — exe를 `--webgba-version`으로 실행해 버전을 조회(이 기능이 없는 exe 거부), 시험 식별자로 빌드한 exe 거부(`--test-id`로만 허용), `--file`이 없으면 저장소 `LICENSE`·`THIRD_PARTY_NOTICES` 포함, 파일마다 `files/<압축 SHA-256>.z`, 이전 발행보다 낮은 버전·같은 버전인데 파일이 다른 경우 거부, 묶음에 `index.json`이 있으면 목록 재생성(`--no-index`로 끔). 올리기 순서 = 압축 파일 → `latest.json` → `index.json`.

### 13. 모바일 `.wmba` (규격 1 확장)

`.wmba`는 피처폰(휴대폰) 게임 파일입니다. 파일 형식은 `.wgba`와 같고(TOC·chunk·manifest, 2~3장), 확장자와 manifest의 `mobile`만 다릅니다.
webGBA는 `.wmba`를 열면 화면을 모바일 배치(좌측 방향 패드, 우측 키패드·액션키)로 바꾸고, 라이브러리 등 이름이 보이는 곳에는 이름 앞에 `[M] `을 붙여 표시합니다(webGBA 0.10.0부터).

#### 13.1 구성

| chunk | 내용 |
| --- | --- |
| `code` | 모바일 코어 wasm. 실행 방식(① Web API 4.1 · ② 자체 JS 4.2)은 코어가 정합니다. 현재 webGBA용 코어 = **wmba-core**(KTF WIPI — wie 기반 ARM 에뮬레이터 + WIPI-C·Java API, 소리 합성 포함, ② 자체 JS, 13.6) |
| `js` | ② 코어의 시작 JS(4.2). wmba-core = 프레임 진행·화면·소리·세이브·퀵슬롯 + ARM→wasm JIT(코어가 생성한 wasm 모듈을 컴파일·실행) |
| `data.jit` | (선택) wmba-core가 앱의 처음 코드로 미리 생성한 JIT 모듈(wie 캐시 레코드, 13.6). 없으면 실행할 때 생성 |
| `manifest` | `mobile`·`group`·`category`·키 목록(13.3·13.4) |
| `rom` | **앱 파일 묶음 WMFS**(13.2) — jar·리소스·앱 설명(`__adf__` 등)이 파일마다 한 항목 |
| `cart.*` | 롬팩 그림(6장) |

- 앱 파일을 `rom` chunk에 저장하는 이유: 앱 데이터는 롬과 같은 저작물이라 롬과 같은 흐름을 그대로 사용합니다 — `strip`(롬 chunk 제거)·업데이트 차이 패치의 원본 확인(`--orig`, 12장)·비공개 보관. 따라서 `rom.required`를 `false`로 설정할 수 없습니다.

#### 13.2 앱 파일 묶음 WMFS 1

little endian입니다.

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4 | `WMFS` |
| 4 | 4 | 형식 `1` |
| 8 | 4 | 파일 수 |
| 12 | … | 파일마다: u16 이름 길이 · 이름(UTF-8, 폴더 구분 `/`) · u32 크기 · 내용 |

- 이름은 앱의 원래 경로 그대로입니다(예 `__adf__`, `010100D2.jar`, `P/BabyBaby.pak`). 패키징 도구는 이름 순으로 저장하므로 같은 입력이면 같은 바이트입니다.
- 코어는 `Web_RomBuffer(크기)` 위치에서 묶음을 받습니다(4.1.3의 2번).

#### 13.3 manifest

| 필드 | 설명 |
| --- | --- |
| `mobile` | **`.wmba` 필수**. `platform`: `WIPI-KTF`·`WIPI-SKT`·`WIPI-LGT`·`SKVM`·`GVM`·`BREW`·`J2ME` 중 하나(`GVM` = SKT GVM, `BREW` = Qualcomm BREW. Android 앱은 14장 `Android`). `aid`·`pid`·`mclass`·`vendor`·`appVersion`(앱 설명 파일의 값, 각 64자 이하, 선택). `keys`: **사용 키** — 게임이 쓰는 폰 키 role 배열(13.4, 선택) |
| `group` | 라이브러리 그룹: `emu`·`arcade`·`mobile`(모든 `.wgba`에서 선택 사항, 업데이트 목록 `signed.groups`(12.2.1)가 우선). 모바일 게임은 `mobile`(없으면 모바일로 표시) |
| `category` | 그룹 안의 분류(인쇄 가능한 ASCII 1~24자). 예 `WIPI-KTF`·`GVM`·`BREW`·`CPS1`·`GBA` |
| `runtime` | 코어가 정합니다: `webapi`(①) 또는 `script`(②, `entry.style` `"module"`). wmba-core = `script` |
| `screen` | 폰 화면 크기(예 240×320) |
| `save` | 코어가 앱 기록(데이터베이스·파일)을 세이브로 저장. ① `{"kind": "flash"}` · ② `{"kind": "storage", "maxSize": …}`(wmba-core = 262144) |

- 표시 이름: 호스트가 언어마다 `[M] ` + `name`으로 표시합니다. `name`에는 `[M]`을 작성하지 않습니다.
- 확장자 규칙: `mobile`이 있으면 `.wmba`, 없으면 `.wgba`(`pack`·`check`가 확인).

#### 13.4 키 (모바일 role)

5장의 role에 폰 키를 추가합니다. `"preset": "none"`으로 코어가 받는 폰 키를 `input.buttons`에 작성하고, 게임이 실제로 쓰는 키는 `mobile.keys`(사용 키)에 작성합니다.

| role | 폰 키 | 기본 키보드 | 기본 게임패드 | 터치 위치(웹 버전) |
| --- | --- | --- | --- | --- |
| `up` `down` `left` `right` | 방향 | 방향키 | 십자·좌측 스틱 | 좌측 방향 패드 |
| `ok` | 확인(액션) | `Enter` `NumpadEnter` `KeyK` | 0 | 우측 키패드 하단의 가장 큰 버튼 |
| `clear` | 취소(CLR) | `Backspace` `Delete` | 1 | 하단 좌측 |
| `soft1` · `soft2` | 좌·우 소프트키 | `BracketLeft` `PageUp` · `BracketRight` `PageDown` | 4 · 5 | 상단 좌측·우측 |
| `num1`~`num9` | 1~9 | `Digit1`~`9` · `Numpad1`~`9` · `KeyQ` `KeyW` `KeyE` / `KeyA` `KeyS` `KeyD` / `KeyZ` `KeyX` `KeyC` | 없음 | 우측 키패드 3×3 |
| `star` · `num0` · `hash` | `*` · `0` · `#` | `NumpadMultiply` `Minus` · `Digit0` `Numpad0` · `NumpadDivide` `Equal` | 없음 | 키패드 마지막 줄 |
| `call` · `end` | 통화·종료 | 없음(사용자 설정) | 없음 | 없음 |

- 터치 화면은 `mobile.keys`에 없는 키를 표시하지 않습니다. 키 자리는 표준 배치(1 2 3 / 4 5 6 / 7 8 9 / * 0 #)에 고정이고 숨긴 키 자리는 비워 둡니다(다른 키 위치 그대로). 방향키·OK·CLR·소프트키도 같은 규칙(방향키를 모두 쓰지 않으면 방향 패드 자리를 비움). 키보드·게임패드는 `input.buttons` 전체가 동작합니다. `mobile.keys`가 없는 `.wmba`는 `input.buttons`의 키를 모두 표시합니다.
- 사용 키는 도구로 확인합니다(13.7): 장면을 자동으로 찾아가며 키를 하나씩 눌러 ① 코어 안에서 게임 코드가 누른 키 번호와 비교한 키 번호(CMP·CMN 기록)와 ② 화면 변화를 모아 합칩니다.
- ① 코어는 버튼마다 `bit`, ② 코어는 `code`(게임이 받는 `KeyboardEvent.code`)를 작성합니다. wmba-core(②)는 시작 JS가 `webgba.input.held`의 버튼 role을 코어 비트(`Web_RunFrame(keys)`)로 바꿉니다: `ok` 0 · `clear` 1 · `soft1` 2 · `soft2` 3 · → 4 · ← 5 · ↑ 6 · ↓ 7 · `num0` 8 · `num1`~`num9` 9~17 · `star` 18 · `hash` 19 · `call` 20 · `end` 21.
- 연사는 적용하지 않습니다(① `Web_AutoFireOff` = 1, ② 모바일 게임이면 호스트가 연사를 끔).

#### 13.5 화면 (웹 버전)

- 세로: 폰 화면 비율 그대로, 좌우 여백(최소 16px)을 두고 하단 키패드가 들어갈 만큼만 크게 표시합니다. 다른 게임보다 아래쪽에 배치합니다 — 상단 여백 = 화면 높이 × `--mobile-drop`(기본 0.05, `web/src/css/web.css`의 `:root`).
- 가로: 화면은 높이에 맞추고, 좌측에 방향 패드·소프트키·CLR, 우측에 키패드·액션키를 배치합니다. 키패드·액션키는 가운데보다 화면 높이 × `--mobile-keypad-drop-landscape`(기본 0.06, `web/src/css/web.css`의 `:root`)만큼 아래에 배치합니다(아래 여백 8px까지).
- PC(터치 패드 끔): 화면만 비율을 유지해 표시합니다.

#### 13.6 wmba-core (현재 webGBA용 모바일 코어)

- 플랫폼: KTF WIPI(Clet·Jlet). [wie](https://github.com/dlunch/wie)(Inseok Lee, MIT) 기반 + webGBA ② 규약(`runtime: "script"`). 소리는 SMAF(MMF) → MIDI → rustysynth(MIT) + 1mgm.sf2(E-mu Systems, CC BY 3.0), 글꼴 Neo둥근모(OFL).
- 실행: 앱의 ARM 코드를 wie 컴파일러가 wasm 모듈로 바꾸고(ARM→wasm JIT), 시작 JS가 `WebAssembly.compile`로 컴파일해 코어 메모리에 연결합니다. 실행 중 코드가 바뀐 구역은 다시 컴파일하고, 컴파일 전·실패한 구역은 인터프리터가 실행합니다(틀 CSP `'wasm-unsafe-eval'` 필요 — 4.2·8장, 컴파일할 수 없는 환경은 인터프리터만 사용).
- `data.jit`: 앱의 처음 코드로 미리 생성한 모듈(wie 캐시 레코드 — `WIEAOT`·버전·키(SHA-256)·코드·구역 목록). 키가 맞으면 시작할 때 생성 단계를 건너뛰고, 맞지 않으면 실행하면서 생성합니다.
- 세이브: 앱 데이터베이스(RMS)·앱이 기록한 파일을 `WMSV` 형식으로 세이브(256KB까지, `webgba.save`)에 저장합니다.
- 퀵슬롯: 코어 메모리(스택 위 정적 영역 + 힙)에서 값이 모두 0인 4KB 칸을 제외하고 deflate로 압축해 저장합니다. 빌드 지문이 다른 퀵슬롯은 불러오지 않습니다. 다른 실행(새로고침 등)에서 저장한 퀵슬롯을 불러오면 JIT 모듈을 다시 연결합니다(그동안 인터프리터).
- 시간: 프레임마다 1/59.7275초씩 진행하고(빨리 감기·일시정지와 일치), 프레임마다 실제 시간 11ms까지 앱을 실행합니다. 앱이 모두 대기 중이면 같은 프레임 안의 다음 타이머 시각으로 이동합니다.
- 코어 wasm 가져오기: `webgba.v1`, `env.emscripten_get_now`·`emscripten_date_now`, `wasi_snapshot_preview1.fd_write`, `wmba.jit_*`(시작 JS가 제공).

#### 13.7 도구

```bash
node tools/wgba.mjs pack -o game.wmba --wasm wmba-core.wasm --js game.js --data jit=jit.bin --manifest manifest.json --app <앱 폴더|앱.zip> --cart-dir cart
node tools/wgba.mjs info game.wmba    # 모바일·키·표시 이름 행 추가
node tools/wgba.mjs check game.wmba   # mobile·WMFS·__adf__·<AID>.jar 확인
```

- 사용 키 확인(wmba-core 프로젝트 도구): `node tools/keys-usage.mjs <wmba-core.wasm> <앱.wmfs> --manifest manifest.json --write` — 장면별 결과 표(② 화면 변화 · ① 비교 기록)를 출력하고 합친 결과를 `mobile.keys`에 저장합니다. 그 후 `pack`합니다.
- 앱 데이터가 포함된 `.wmba`는 롬이 포함된 `.wgba`와 같이 배포하지 마세요(1장 "롬·게임 데이터").

### 14. Android `.wapk` (규격 1 확장)

`.wapk`는 처음부터 Android로 만든 게임 파일입니다(피처폰 게임을 Android로 다시 빌드한 앱은 `.wmba`). 파일 형식은 `.wgba`·`.wmba`와 같고, manifest의 `mobile.platform`이 `"Android"`입니다.
webGBA는 `.wapk`를 열면 가상 방향키·키패드를 표시하지 않고 게임 화면을 화면 전체에 표시하며, 화면 터치·마우스를 게임 터치로 전달합니다. 라이브러리 등 이름이 보이는 곳에는 이름 앞에 `[A] `을 붙여 표시합니다(webGBA 0.10.0부터).

#### 14.1 구성

| chunk | 내용 |
| --- | --- |
| `code` · `js` | Android 코어 wasm · 시작 JS. **② 자체 JS(`runtime: "script"`, `entry.style: "module"`)만** 지원합니다(① `.wapk`는 `check` 오류) |
| `data.*` | (선택) Pack 때 생성한 변환물(예: dex 변환 결과·미리 생성한 JIT 모듈). 코어가 `webgba.chunk("data.<이름>")`으로 조회 |
| `rom` | **앱 파일 묶음 WMFS**(13.2와 같은 형식) — APK 안 파일을 경로 그대로(`AndroidManifest.xml`·`classes.dex`·`lib/<abi>/*.so`·`assets/…`·`res/…`·`resources.arsc`) |
| `cart.*` | 롬팩 그림(6장, `.wmba`와 같은 규칙) |

- 확장자 규칙: `mobile.platform`이 `"Android"`이면 `.wapk`, 그 외 `mobile`이 있으면 `.wmba`, 없으면 `.wgba`(`pack`·`check`가 확인).
- `check`: 앱 파일 묶음에 `AndroidManifest.xml`이 없으면 오류, `classes.dex`·`lib/`가 모두 없으면 경고.

#### 14.2 manifest

| 필드 | 설명 |
| --- | --- |
| `group` · `category` | `"mobile"` · `"Android"`(모바일 그룹 안의 분류 Android) |
| `screen` | **화면 기준 해상도** — 게임이 시작할 때 받는 화면 크기(캔버스 처음 크기). `orientation`이 `landscape`면 가로가 긴 크기 |
| `mobile.platform` | **`"Android"` 필수** |
| `mobile.package` | Android 패키지 이름(128자 이하, 선택) |
| `mobile.appVersion` · `versionCode` · `minSdk` · `vendor` | 앱 버전 이름 · 버전 번호(0 이상 정수) · 최소 SDK(1~99) · 개발사(선택, 표시용) |
| `mobile.orientation` | `landscape` · `portrait` · `any`(기본 `any`). AndroidManifest `screenOrientation`의 landscape·sensorLandscape·reverseLandscape·userLandscape → `landscape`, portrait 계열 → `portrait`, 나머지 → `any` |
| `mobile.input` | `touch`(터치만, 기본) · `keys`(물리 키만) · `both`(터치 + 물리 키) |
| `mobile.keys` | 게임이 쓰는 키 role 목록(최소). `back`·`menu`는 모든 게임에 권장 |
| `input.buttons` | `preset: "none"`, 버튼마다 `id`·`role`·`code`(14.4) |
| `save` | `{"kind": "storage", "maxSize": …}` — 앱 데이터를 코어가 한 덩어리로 저장 |

- 표시 이름: 호스트가 `[A] ` + `name`으로 표시합니다. `name`에는 `[A]`를 작성하지 않습니다. 연사는 적용하지 않습니다(13.4와 같음).

#### 14.3 터치 (틀 API 추가)

```js
webgba.on("touch", (e) => { /* e.action · e.id · e.index · e.x · e.y · e.time · e.touches */ });
webgba.input.touches; // [{ id, x, y }] — 읽을 때마다 새 배열
```

| 값 | 설명 |
| --- | --- |
| `action` | `"down"` · `"move"` · `"up"` · `"cancel"` |
| `id` | 포인터 번호. 누를 때 비어 있는 가장 작은 번호(0부터, Android pointer id 규칙과 같음), 최대 10개 |
| `x` · `y` | 게임 화면 좌표(캔버스 픽셀, 실수, 좌상단 0·0). 틀이 캔버스 표시 영역(비율 유지)을 기준으로 변환 |
| `index` · `touches` | 이 이벤트 시점에 눌린 모든 포인터(바뀐 포인터 포함, `up`·`cancel`도 포함) · 그 안의 바뀐 포인터 위치(Android `getActionIndex()`) |
| `time` | 이벤트 시각(ms, `performance.now()` 기준) |

- Android 대응: `down` + `touches` 1개 → `ACTION_DOWN`, 그 외 `down` → `ACTION_POINTER_DOWN` · `up` + 1개 → `ACTION_UP`, 그 외 → `ACTION_POINTER_UP` · `move` → `ACTION_MOVE` · `cancel` → `ACTION_CANCEL`(전체 취소).
- 캔버스 표시 영역 밖(검정 여백)에서 시작한 터치는 보내지 않고, 이동·뗌은 밖으로 나가도 보냅니다(좌표가 범위를 벗어날 수 있음).
- 마우스 좌측 버튼 = 포인터 하나, 펜 = 터치와 같습니다. 일시정지·틀 초점 잃음·틀 크기 변경 때 틀이 모든 터치를 `cancel`하고, 일시정지 중에는 터치를 보내지 않습니다.
- `webgba.input.touches`가 `undefined`이면 터치 API가 없는 이전 webGBA입니다.

#### 14.4 키

기존 ② 입력(`webgba.on("button")`·`webgba.input.held`) 그대로입니다. role → Android KEYCODE:

| role | KEYCODE | 기본 키보드 | 기본 게임패드 |
| --- | --- | --- | --- |
| `back` | 4 `BACK` | `Escape` `Backspace` | 8 |
| `menu` | 82 `MENU` | `ContextMenu` `KeyM` | 9 |
| `up` `down` `left` `right` · `ok` | 19~22 `DPAD_*` · 23 `DPAD_CENTER` | 방향키 · `Enter` `NumpadEnter` `KeyK` | 십자·좌측 스틱 · 0 |
| `num0`~`num9` · `star` · `hash` | 7~16 · 17 · 18 | 13.4와 같음 | 없음 |
| `call` · `end` · `soft1` · `soft2` · `clear` | 5 · 6 · 1 · 2 · 28 | 13.4와 같음 | 13.4와 같음 |
| `a` `b` `c` `d` · `l` `r` `l2` `r2` · `start` `select` | 96 97 99 100 · 102~105 · 108 109 | 5장 기본 | 5장 기본 |

- 웹 버전 화면 메뉴의 "뒤로"·"메뉴 키" 항목은 해당 role 버튼을 누르고 약 0.1초 후 뗍니다(게임을 재개한 후).
- role이 없는 버튼은 코어가 `id`로 정합니다. 게임이 `back`을 처리하지 않아 앱이 끝나면 코어가 `webgba.exit()`을 호출합니다.

#### 14.5 화면 크기 변경 · 일시정지 (틀 API 추가)

```js
webgba.view;                       // { width, height, dpr, orientation } — 게임 화면 칸(틀) CSS px · devicePixelRatio · "landscape"(width ≥ height)·"portrait"
webgba.on("resize", (view) => {}); // 등록할 때 한 번 + 칸 크기가 바뀔 때마다(회전·창 크기·전체 화면)
```

- 호스트는 캔버스를 비율 유지로 칸 가득 표시하고 남는 곳은 검정으로 둡니다. 코어가 칸 비율에 맞춰 캔버스 `width`·`height`를 바꾸면(게임에 surfaceChanged·DisplayMetrics 전달) 여백이 없어집니다 — 화면 기준 해상도의 짧은 변을 유지하고 긴 변만 늘리는 방식을 권장합니다(한 변 4096 이하).
- 일시정지·재개는 기존 `webgba.on("pause")`·`on("resume")`(Activity `onPause`·`onResume`)입니다. 호스트는 화면 메뉴·설정 창·방향 안내 화면·탭 숨김·사용자 일시정지 때 일시정지합니다.

#### 14.6 화면 (웹 버전·Windows 앱)

- 가상 방향키·키패드·OK·CLR이 없습니다. 게임 화면이 화면 전체(안전 영역 안)를 차지하고, 캔버스는 비율 유지·남는 곳 검정입니다(늘이기 없음).
- 메뉴: 좌측 상단의 작은 반투명 메뉴 버튼(불투명도 `--wapk-edge-dim`, 기본 0.45 — `web/src/css/web.css`의 `:root`) → 메뉴 창(뒤로 · 메뉴 키 · 퀵슬롯 · 빨리 감기 · 소리 · 설정 · 전체 화면 · 열기 · 라이브러리 · 세이브 · 닫기). 메뉴 창이 열린 동안 게임은 일시정지합니다.
- 방향 고정(`landscape`·`portrait`) 게임을 휴대폰·태블릿에서 열면 전체 화면 + Screen Orientation API 잠금을 시도합니다. 다른 방향이면 "가로(세로)로 돌려 주세요" 안내 화면을 표시하고 게임을 일시정지합니다(잠금을 지원하는 브라우저는 "전체 화면으로 고정" 버튼). iPhone처럼 잠금을 지원하지 않는 기기는 기기를 돌리면 안내가 사라집니다. PC는 안내 없이 비율 유지로 표시합니다.
- `input: "keys"` 게임을 터치 기기에서 열면 "키보드 또는 게임패드가 필요합니다" 알림을 표시합니다.
- Windows 앱은 게임 틀을 화면 영역 전체 크기로 표시합니다(메뉴는 기존 메뉴 막대·도구 막대).

#### 14.7 도구·예제

```bash
node tools/wgba.mjs pack -o game.wapk --wasm android-core.wasm --js core.js --manifest manifest.json --app <game.apk|앱 폴더|.zip> --cart-dir cart
node tools/wgba.mjs info game.wapk    # Android·방향·입력·표시 이름 행
node tools/wgba.mjs check game.wapk   # 확장자·② 전용·AndroidManifest.xml 확인
```

- `--app`에 `.apk`를 그대로 지정할 수 있습니다(apk = zip, 항목을 이름 순으로 저장 — 같은 입력이면 같은 바이트).
- 예제 [`docs/wgba/examples/hello-wapk`](docs/wgba/examples/hello-wapk) — 터치·화면 크기·뒤로·메뉴 키를 그리는 가짜 Android 코어(앱 파일은 자리 표시용). 웹 시험 `node web/test/web-wapk.mjs`.
- 앱 데이터가 포함된 `.wapk`는 배포하지 마세요(1장 "롬·게임 데이터").

---

## AI 전용 프롬프트

아래 내용 전체를 사용 중인 AI에 붙여 넣고, 게임 wasm 파일을 알려 주세요. AI가 이 규격대로 `.wgba`를 생성합니다.

````text
너는 내 WebAssembly 게임을 webGBA의 .wgba 규격 1 파일로 패키징하는 작업을 돕는다. 아래 규격을 그대로 지키고, 모르는 내용은 지어내지 말고 나에게 확인한다.

[먼저 나에게 확인할 항목]
- 게임 wasm 파일, 함께 빌드된 JS(emscripten Glue 등) 유무, 데이터 파일 목록, 롬처럼 게임 메모리에 배치할 큰 데이터 유무
- 게임 이름(영어·한국어·일본어 언어별 가능), 게임 id(소문자 역도메인, 예 io.github.내아이디.게임이름 — 한 번 정하면 변경하지 않음), 버전(x.y.z)
- 화면 크기, 사용하는 버튼과 각 버튼의 의미, 세이브 유무, 마우스 사용 여부
- 롬팩 그림 유무(라벨 48×32·앞면 54×44·옆면 18×46의 같은 배수 1~4배, PNG 또는 무손실 WebP — 모두 선택), 롬팩 몸통 색(#RRGGBB)
- 멀티플레이 사용 여부: 인원(2~8)·용도(교환·대전 등), 멀티플레이 없이도 실행되는지, 끊긴 유저의 다시 들어오기·중간 참가가 필요한지, 게임 상태를 맞추는 방식(메시지 순서 / 키 lockstep)
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
- 필수: "wgba": 1, "id"(소문자 역도메인, 점 1개 이상, 64자 이하), "version"("x.y.z", 테스트 버전 "-beta.1" 가능), "name"(문자열 또는 {"en":…,"ko":…,"ja":…}, 칸마다 48자 이하 — 호스트는 화면 언어 칸 → en → ko → ja 순서로 있는 칸을 표시, 필요한 칸만 작성), "runtime"("webapi" 또는 "script").
- 선택: shortName(16자, name과 같은 언어 칸), description, author, license, homepage(https://만), contact, build, needs(["pointer","net","keyboard","state"] 중), screen{width,height(1~1024, 기본 240·160), scale("fit"·"integer")}, display{aspect("W:H" 표시 비율, 예 "4:3" — 화면 버퍼와 다르면 늘려 표시)}, save{kind,maxSize,files}, pointer{use}, input{preset,buttons,keyboard,dpad("latest"·"opposite"·"both" 방향 동시 입력 기본값)}, cart{color, label, front{labelAt}, spine{textArea}}, rom{required}, entry{style,js,args}, files, multiplayer(아래 [멀티플레이]). 모르는 필드는 무시되고, 규격에 없는 값이 반드시 필요하면 "x-"로 시작하는 이름을 사용한다.
- runtime "webapi"인데 롬 chunk가 없으면 반드시 "rom": {"required": false} (없으면 webGBA가 롬 파일 선택을 요청한다).
- cart.label/front/spine은 {"chunk":"cart.label|cart.front|cart.spine","format":"png|webp","width":…,"height":…}를 그림과 같게 작성하고, 포함하지 않는 그림의 항목은 제외하며, 앞면에 labelAt [x,y](기본 [3k,5k]), 옆면에 textArea [x,y,w,h](호스트가 짧은 이름을 세로로 표시, 없으면 문자열 없음)를 설정한다.
- 현재 webGBA는 screen.fps·audio·state.use를 조회하지 않는다(항상 약 59.7275fps). needs의 네 값은 현재 webGBA가 모두 지원한다. "net"은 멀티플레이 없이는 실행할 수 없는 게임에만 추가한다(멀티플레이를 모르는 옛 webGBA는 열지 않는다).

[runtime "webapi" — JS 없음, 호스트가 wasm을 직접 실행]
- 내보내기 필수: memory, Web_Init() -> i32(0 실패), Web_RunFrame(keys) -> i32(0 정지, keys = 눌린 버튼 비트), Web_GetFramebuffer() -> i32(width×height 픽셀, 픽셀당 R,G,B,A 바이트).
- 선택: Web_SetAudioRate(rate)·Web_GetAudioBuffer()·Web_GetAudioCount()(float32 스테레오 interleaved, 개수 = 좌우 쌍 수) / Web_GetFlash()·Web_GetSaveSize()·Web_SetSaveSize(n)·Web_FlashClear()·Web_TakeFlashDirty()(세이브) / Web_RomBuffer(size)(롬 배치 주소) / Web_Reset() / Web_StateSize()·Web_StateSave(at)·Web_StateLoad(at)·Web_Alloc(n)·Web_Free(at)(퀵슬롯은 다섯 개 모두, Web_StateUsed() 선택) / Web_Pointer(x,y,buttons,wheel)·Web_PointerWanted() / Web_AutoFireOff()(1이면 사용자 연사를 멈추고 누른 그대로 전달 — 메뉴·배틀 등) / Web_GetHaltReason()·Web_GetTitle()·Web_SetTimeZone(sec) / Web_Net*(멀티플레이, 아래 [멀티플레이]) / Web_Gpu*(GPU 그리기, 아래 [GPU 그리기]).
- 가져오기는 다음 항목만: env.{emscripten_asm_const_int, emscripten_resize_heap, _emscripten_throw_longjmp, emscripten_date_now, emscripten_get_now, emscripten_notify_memory_growth, abort, _abort_js, invoke_*}, wasi_snapshot_preview1.{fd_write, fd_read, fd_close, fd_seek, fd_sync, fd_fdstat_get, environ_get, environ_sizes_get, clock_time_get, random_get, proc_exit}, webgba.v1(() -> (), 동작 없음). 다른 가져오기가 있으면 runtime "script"로 제작한다.
- 240×160·GBA 버튼이 아니거나 롬 없이 실행되는 게임은 가져오기 webgba.v1을 추가한다(이전 버전 webGBA가 열지 않도록). C에서는 __attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void);를 선언하고 Web_Init에서 한 번 호출한다.
- 순서: 인스턴스 → __wasm_call_ctors(없으면 _initialize) → 롬 → 세이브 → Web_Init → 매 프레임 Web_RunFrame. Web_Init 후에는 메모리를 크게 늘리지 않는다.
- 버튼별 bit(0~31). GBA와 같으면 "input": {"preset":"gba"} (A=0 B=1 SELECT=2 START=3 RIGHT=4 LEFT=5 UP=6 DOWN=7 R=8 L=9). GBA와 다르면 반드시 "input": {"preset":"none", "buttons":[…모든 버튼…]} — webapi의 preset 기본값은 "gba"라서 preset을 생략하면 내 버튼이 GBA 10버튼 뒤에 추가되어 bit·role이 중복된다(검사 오류). GBA 10버튼에 몇 개만 추가하려면 preset "gba" + 추가할 버튼(중복되지 않는 bit·role, 예 c=10 d=11).

[GPU 그리기 — 선택(규격 4.1.4, webGBA 0.8.0부터, runtime "webapi"만)]
- CPU로 그리기 무거운 게임이 화면을 WebGL2로 그리는 방식이다. 셰이더(GLSL ES 3.00 원문)는 게임이 제공하고, 호스트는 게임이 wasm 메모리에 기록한 명령 목록을 순서대로 실행한다. 새 가져오기·manifest 항목은 없다.
- 내보내기: Web_GpuStart(version)→i32 · Web_GpuList()→ptr · Web_GpuListLen()→u32(u32 단어 수) · Web_GpuListDone() · Web_GpuSync(reason) · Web_GpuStop() · Web_GpuOverlay()→i32. 앞의 네 개가 모두 있어야 사용된다. check 도구는 Web_Gpu*를 검사하지 않으므로 네 개가 모두 있는지 직접 확인한다.
- 호출 순서: Web_Init → 호스트가 WebGL2 컨텍스트를 생성하고 Web_GpuStart(1) 호출 → 1 = GPU 모드, 0 = 기존 방식(재시작으로 인스턴스를 새로 생성하면 다시 호출). GPU 모드에서는 Web_RunFrame마다 Web_GpuList() → Web_GpuListLen() → 목록 실행 → Web_GpuListDone(). 게임은 Web_GpuListDone이 호출될 때까지 목록을 비우지 않고 프레임마다 이어 붙인다(호스트가 여러 프레임 분량을 한 번에 실행해도 됨).
- 표시: 그림 = 출력 대상 0(screen.width×height RGBA8, GL 좌표 — 0행이 하단). Web_GpuOverlay(): 0 = 출력 그대로 · 1 = Web_GetFramebuffer를 위에 합성(덧그림, premultiplied alpha, 0행이 상단) · 2 = 이번 프레임은 Web_GetFramebuffer가 그림.
- 명령 레코드(u32 단어, 연속 배치) = 첫 단어 opcode | 단어 수 << 8(단어 수는 첫 단어 포함) + 값. 주소 = wasm 메모리 바이트 위치, 실수 = f32 비트.
  1 PROGRAM: id, 정점 셰이더 주소·길이, 조각 셰이더 주소·길이, 인스턴스 속성 수(속성마다 ivec4, location 0부터), uniform 이름 목록(NUL 구분) 주소·길이 — uniform 번호 = 목록 순서
  2 TEXTURE: id(1 이상), 형식(1 RGBA8 · 2 RGB10_A2 · 3 R16UI), 너비, 높이 — NEAREST, CLAMP_TO_EDGE
  3 TARGET: 텍스처 id(0 = 출력), viewport x·y·w·h
  4 BLEND: 사용(0·1), 식 RGB·A(0 ADD · 1 SUBTRACT · 2 REVERSE_SUBTRACT), 계수 srcRGB·dstRGB·srcA·dstA(0 ZERO · 1 ONE · 2 SRC_COLOR · 3 ONE_MINUS_SRC_COLOR · 4 DST_COLOR · 5 ONE_MINUS_DST_COLOR · 6 SRC_ALPHA · 7 ONE_MINUS_SRC_ALPHA · 8 DST_ALPHA · 9 ONE_MINUS_DST_ALPHA · 10 CONSTANT_COLOR · 11 ONE_MINUS_CONSTANT_COLOR · 12 CONSTANT_ALPHA · 13 ONE_MINUS_CONSTANT_ALPHA), 상수 색 r·g·b·a(f32)
  5 UNIFORM: 프로그램 id, uniform 번호, 종류(0 int · 1 float), 개수(1~4), 값
  6 TEXBIND: 텍스처 단위, 텍스처 id
  7 DRAW: 프로그램 id, 인스턴스당 정점 수(TRIANGLES), 인스턴스 수, 인스턴스 데이터 주소(0 = 속성 없음), 인스턴스 간격(바이트)
  8 UPLOAD: 텍스처 id, x·y·w·h, 형식, 데이터 주소, 행 길이(화소)
  9 COPY: 원본·대상 텍스처 id, 원본 x·y, 대상 x·y, w·h(같은 형식)
  10 READ: 텍스처 id, x·y·w·h, 형식(1 RGBA8), 메모리 주소 — 호스트가 목록 실행 중에 기록을 끝냄
  모르는 opcode가 있으면 호스트는 GPU 모드를 중지한다.
- 그리기: 정점 버퍼는 없다 — 정점 셰이더가 gl_VertexID로 위치를 계산한다. 인스턴스 i의 레코드 = 인스턴스 데이터 주소 + i×간격, 속성 a = 레코드의 a×16바이트 위치 INT 4개(셰이더 layout(location = a) in ivec4). DRAW 인스턴스 수 0 = 그리지 않음, 주소 0 = 인스턴스 수와 상관없이 1회.
- GL 상태: 목록 사이에 남는 것은 프로그램(uniform 값 포함)·텍스처(내용 포함)뿐이다. 블렌드는 목록 끝마다 비활성화되고, 화면 표시 때 출력 대상(덧그림 1이면 viewport·텍스처 연결·프로그램도)이 바뀌므로 목록마다 처음에 TARGET·TEXBIND·BLEND를 기록한다. 목록 안에서도 TEXTURE·UPLOAD는 현재 단위의 텍스처 연결을, COPY·READ는 출력 대상을 바꾼다.
- 퀵슬롯: 호스트는 저장 전 Web_GpuSync(1) → 목록 실행 → Web_StateSave 순서로 호출한다. 게임은 Web_GpuSync(1)에서 GPU 그림을 메모리로 읽는 READ를 목록에 기록한다. reason은 1만 정의되어 있다.
- 상태 적용: 퀵슬롯 불러오기·다시 들어오기·중간 참가의 상태 적용·Web_Reset 때 호스트는 GPU 쪽에 아무것도 하지 않는다(프로그램·텍스처 그대로). 상태에 맞게 텍스처를 다시 올리는 UPLOAD는 게임이 다음 목록에 기록한다.
- 대체: WebGL2가 없는 브라우저·이 기능을 모르는 webGBA는 Web_GpuStart를 호출하지 않는다. 컨텍스트 손실·셰이더 오류·모르는 opcode로 목록을 실행하지 못하면 호스트가 Web_GpuStop()을 호출하고 기존 방식으로 표시한다. 웹 버전 localStorage의 webgba.gpu가 "0"이면 GPU 모드를 시작하지 않는다(테스트용). 따라서 게임은 Web_GpuStart가 1을 반환하기 전과 Web_GpuStop 다음 프레임부터 CPU로 Web_GetFramebuffer에 그린다. Web_GpuSync·Web_GpuStop이 없으면 호출을 건너뛰고, Web_GpuOverlay가 없으면 0으로 처리한다.
- 멀티플레이 주의: 같은 세션에서도 기기마다 GPU 모드와 CPU 그리기가 다를 수 있다. 따라서 게임 진행은 그림 결과에 의존하지 않게 하고, 기기 간 상태 비교(해시)에는 모드에 따라 내용이 달라지는 그림 메모리(예: CPU 그리기에서만 갱신되는 VRAM)를 넣지 않는다.

[runtime "script" — 자체 JS가 있는 게임]
- JS는 출처 없는 sandbox iframe(srcdoc) 안에서 실행된다. 네트워크(fetch·XHR·WebSocket·WebRTC)·IndexedDB·쿠키·실제 localStorage·팝업·상위 창 이동·스레드(SharedArrayBuffer·pthreads)를 사용할 수 없다(멀티플레이는 webgba.net). localStorage는 메모리 기반 대체 객체다.
- entry 필수. JS chunk 이름은 항상 "js"(entry.js는 생략). entry.style "module": JS가 export default async function start(webgba){…}를 내보낸다. "emscripten": emscripten Glue(일반·MODULARIZE·EXPORT_ES6) — 틀이 Module{canvas, wasmBinary, locateFile, arguments, print, printErr, preRun, onRuntimeInitialized, onAbort}를 전달한다. 데이터 파일은 files 매핑({"파일 이름":"data.<이름>" 또는 "rom"})으로 지정하고, --preload-file의 .data도 같은 방식. 권장 빌드 -sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS.
- webgba 객체: version(1), manifest, lang, canvas(#canvas, screen 크기), wasm()→ArrayBuffer, wasmModule(), chunk(name)→Uint8Array, chunkURL(name)→blob: 주소, save.read()/save.write(bytes)(save.kind "storage"일 때만), state.onSave(fn→Uint8Array)/state.onLoad(fn(bytes)→true|false)(둘 다 호출해야 퀵슬롯 활성화), input.held, on("button"|"pause"|"resume"|"speed", fn), audioContext(), ready()(시작 완료 시 호출), exit(reason), log(level,text), net(manifest에 multiplayer가 있으면 멀티플레이 객체, 없으면 null — 아래 [멀티플레이]).
- save.kind: "storage"(기본, webgba.save), "localStorage"(틀 localStorage 전체를 세이브로), "files"(emscripten FS의 save.files[0] 경로, FS 내보내기 필요), "none". maxSize 기본 1MB, 16MB까지.
- 버튼별 code(게임이 수신하는 KeyboardEvent.code). 호스트가 사용자가 누른 키를 이 code의 keydown/keyup으로 변환해 전달한다(isTrusted는 false이므로 검사하지 않는다). preset 기본값은 "none".

[버튼]
- 버튼 = {id(영문·숫자·_·- 16자), role, label, bit(webapi) 또는 code(script), keys(기본 키 KeyboardEvent.code 4개까지), pad(게임패드 버튼 번호·"+axis1" 등), touch("auto"·"hide")}. webapi는 32개, script는 24개까지.
- role: up down left right, 앞면 a b c d(최대 4개), l r l2 r2, start select, extra. extra 외에는 role 한 개에 버튼 한 개. C·D를 사용하면 c·d role 버튼을 정의한다 — 이때만 터치 화면 A·B 바로 위 행에 표시된다. 정의하지 않으면 A·B만.
- 기본 키는 role로 결정된다(a=Z·K, b=X·J, c=C·I, d=V·U, l=A, r=S, l2=Q, r2=W, start=Enter, select=Backspace·우측 Shift, 방향=방향키). keys에 호스트 예약 키(Space, Tab, Escape, Pause, F1~F12, P)를 포함하지 않는다.
- (선택) input.rs = RS 버튼 기본 입력: 단계 배열 [{buttons:[버튼 id…](동시에 누름, role이 방향·a·b·c·d·l·r·start·select인 버튼만), hold(누름 프레임 1~600, 기본 3), gap(다음 단계까지 프레임 0~600, 기본 3)}] 1~32개. 예: 잡기 A+B = [{"buttons":["P","K"],"hold":6}].

[멀티플레이 — 규약 1, 현재 webGBA(Windows 앱·웹 버전)가 지원]
- 연결은 webGBA가 담당한다: 방 코드 6자리·같은 Wi-Fi 근처 방·연결 코드(QR). 기기 간 직접 연결(WebRTC)을 먼저 시도하고, 직접 연결이 되지 않는 망에서는 Cloudflare 중계 서버(TURN, 내용은 DTLS 암호화)를 거친다. 게임은 "통신 상대가 필요함" 요청·바이트 송수신·사건 처리만 한다. 게임이 직접 네트워크(WebSocket·WebRTC·fetch)를 열지 않는다.
- 세션 = 방 1개, 2~8명. 방장 = 슬롯 0, 참가 순서대로 1·2…. 메시지는 누락 없이 송신자별 순서 유지, 한 개 16384바이트까지, 한 프레임 송신 합계 65536바이트 이하 권장. 같은 게임끼리만 연결된다(compat).
- manifest "multiplayer": protocol 1(필수 — 호스트가 아는 번호보다 크면 호스트는 멀티플레이만 끄고 게임을 실행한다: ① Web_NetHost 호출 없음, ② webgba.net = null) · players{min,max}(2~8, 기본 2·2) · purposes[{id(영문 소문자·숫자·-, 32자), name(언어별 글), players[min,max]}](배열 순서 = 용도 번호 1부터, 서로 다른 용도끼리는 연결하지 않음, 없으면 용도 1개) · compat("exact" 기본 = 같은 id + 같은 빌드 식별 / 다른 문자열 = id와 그 문자열이 같은 게임끼리) · rejoin(true = 다시 들어오기) · join("anytime" = 중간 참가) · iceServers([{urls: stun:·turn:·turns: 주소(모두 합쳐 4개), username·credential 또는 credentialUrl(https, 연결할 때 호스트가 GET → {username, credential, ttl}, CORS로 https://webgba.vercel.app·http://ui.localhost 허용)}] — 지정하면 webGBA 기본 STUN·TURN 대신 이 목록만 사용, 고정 접속 정보는 파일에서 누구나 꺼낼 수 있어 credentialUrl 권장) · board(상태 표, 아래). sync "inputs"·inputDelay는 규격에 있지만 현재 webGBA는 지원하지 않으므로 사용하지 않는다.
- webapi 내보내기(일곱 개가 모두 있어야 멀티플레이 지원): Web_NetWanted()→u32 · Web_NetEvent(kind,a,b) · Web_NetOut()→ptr · Web_NetOutLen()→u32 · Web_NetOutClear() · Web_NetInBuffer(len)→ptr(0 = 현재 공간 없음 → 호스트가 다음 프레임에 순서대로 다시 시도) · Web_NetIn(from,len)(from 비트 8 = 0x100이면 상태 묶음). 선택: Web_NetHost(protocol,flags)(Web_Init 후 한 번, flags 비트 0 = 순서 보장, 비트 1 = 키 동기화(현재 0), 비트 2 = 다시 들어오기 — 호출되지 않으면 통신 메뉴를 숨긴다) · Web_NetBoard()→ptr · Web_NetCompat()→ptr(NUL 종료 ASCII 64자까지의 호환 키, compat 뒤에 연결해 비교). 새 가져오기는 없다.
- 호스트의 한 프레임: 수신 메시지마다 Web_NetInBuffer(len) → 기록 → Web_NetIn(from,len) → Web_RunFrame(keys) → Web_NetOut·Web_NetOutLen 레코드 송신 → Web_NetOutClear() → Web_NetWanted() 확인(창 열기·세션 종료).
- Web_NetWanted 값: 비트 0~7 용도 번호(0 = 첫 용도) · 8~11 최소 인원(0 = 2) · 12~15 최대 인원(0 = 최소와 같음) · 16~17 역할(0 무관, 1 방 생성만, 2 참가만) · 18~23 = 0 · 24~31 요청 번호(새로 상대를 찾을 때마다 +1, 255 다음 1). 세션 동안 같은 값을 계속 반환하고, 0 = 통신 종료(호스트가 남은 송신 후 세션을 닫고 CLOSED(LEFT)).
- 송신 레코드(little endian, 연속 배치): u16 내용 길이 n(1~16384) · u8 받는 곳(0~7 = 슬롯, 0xFE = TO_ORDERED 본인 포함 모두가 같은 순서로 수신, 0xFF = TO_ALL 본인 제외 모두) · u8 종류(0 메시지, rejoin 게임만 1 = 상태 묶음 조각·2 = 마지막 조각) · 내용 n바이트, 다음 레코드는 4바이트 경계. 세션이 없을 때 쌓인 레코드는 버려진다.
- 사건 Web_NetEvent(kind,a,b): 1 OPEN(본인 슬롯, 인원 — 방장은 혼자 먼저 시작) · 2 JOIN(슬롯, 인원) · 3 LEAVE(슬롯, 사유) · 4 CLOSED(사유, 0) · 5 STALL(슬롯 — 1초 넘게 응답 없음·앱 이탈) · 6 RESUME(슬롯). rejoin 게임만: 7 HOLD(슬롯, 인원 — 끊긴 자리 보관, 끊긴 기기 자신은 본인 슬롯, 유저 기기에서 a = 0이면 방장이 앱을 닫아 돌아오기를 기다림) · 8 BACK(슬롯, 인원 — 보관 자리가 다시 연결됨, 항상 HOLD 뒤. 유저 기기에서 a = 0이면 방장이 돌아옴 → 이 기기가 상태 묶음을 슬롯 0으로 보냄) · 9 REJOINED(본인 슬롯, 인원 — 돌아온 기기에 OPEN 대신, 돌아온 방장은 a = 0, 앱을 다시 열어 돌아온 유저는 앞선 OPEN·HOLD 없이 이 사건부터. 이후 끊긴 동안 바뀐 JOIN·LEAVE·HOLD·BACK이 이어짐). 사유: 1 CANCEL · 2 TIMEOUT · 3 INCOMPATIBLE · 4 LOST · 5 FULL · 6 LEFT · 7 HOST_LEFT · 8 NO_NETWORK · 9 SOLO(끊긴 사용자가 "혼자 이어 하기" 선택).
- 게임이 지킬 것: CLOSED(CANCEL)은 게임 안 취소와 같게 처리하고 Web_NetWanted를 0으로. STALL은 일시적일 수 있으므로 바로 끊지 않고 기다린다(기본 15초 넘게 돌아오지 않으면 호스트가 LEAVE(LOST)·CLOSED, rejoin 게임은 HOLD). HOST_LEFT = 세션 종료(방장 위임 없음). 세션 중 호스트는 빨리 감기·퀵슬롯·다시 시작을 막는다(게임 안 세이브는 그대로).
- script: webgba.net(manifest에 multiplayer가 있을 때만, 없으면 null) — want({purpose: 용도 id, min, max, role: "any"|"make"|"join"})(호출할 때마다 새 요청) · unwant() · send(to: 슬롯 0~7 | "ordered" | "all", bytes 16384바이트까지) · sendState(to: 슬롯, bytes 1~262144바이트, rejoin 게임만) · board(table | null) · host{protocol, ordered, inputs(현재 false), rejoin} · onevent = (kind,a,b) => …(위 번호) · onrecv = (from,bytes) => … · onstate = (from,bytes) => …. 바이트는 ArrayBuffer·Uint8Array.
- 같은 상태 유지(권장 = lockstep): 게임을 결정적으로 제작한다(같은 입력·메시지에 같은 결과, 난수는 게임 내부 seed). TO_ORDERED 메시지는 본인에게도 돌아오므로(from = 본인 슬롯) 모든 기기가 돌아온 순서대로만 적용하면 같은 상태가 된다. 키를 맞추는 게임은 프레임 f의 본인 키를 프레임 번호와 함께 보내 f + 지연(예: 3프레임)에 적용하고, 모든 참가자의 f 키가 모일 때까지 프레임 f를 진행하지 않는다 — 느린 기기가 있어도 기기 사이 진행 차이가 지연 프레임 수를 넘지 않는다. 시작 프레임은 방장이 보낸 "시작" 메시지로 맞춘다. 수신은 프레임 사이에 오므로 Queue에 추가하고 프레임 안에서 처리한다.
- 다시 들어오기(rejoin: true, 방 코드 세션만 — 연결 코드·QR 세션은 LEAVE(LOST)): 끊긴 유저 자리는 세션 끝까지 보관된다(HOLD). 끊긴 동안의 메시지는 전달되지 않으므로 BACK(s)를 받은 방장 게임이 상태 묶음(1~262144바이트, 호스트가 16384바이트씩 나눠 보내고 합침)을 슬롯 s로 보낸다. ① 송신 = 레코드 종류 1(조각, 16384바이트까지, 여러 프레임에 나눠도 됨)·2(마지막 조각), ① 수신 = 묶음 전체가 모이면 Web_NetInBuffer(묶음 크기) → Web_NetIn(from | 0x100, len)이므로 묶음 최대 크기만큼 받기 공간을 준비한다. 묶음에 게임이 적용한 순서 메시지 번호를 기록하고, 돌아온 기기는 그보다 큰 번호만 적용한다. 방장이 앱을 닫으면 방이 2분 남고, 방장이 돌아오면 방장 기기는 REJOINED(0), webGBA가 고른 유저 한 명은 BACK(0)을 받아 상태 묶음을 슬롯 0으로 보내며, 나머지 유저는 REJOINED(본인 슬롯) 후 방장 게임이 보내는 묶음을 기다린다. 유저가 앱을 닫아도 방장은 자리를 보관하고(HOLD), 같은 기기에서 같은 게임(같은 id·버전)을 다시 열어 "이전 방으로 돌아가기"를 누르면 그 기기는 새로 시작한 게임에서 REJOINED(본인 슬롯)를 받고 방장·다른 기기는 BACK(s)를 받는다 — 방장 게임은 앱 안 다시 들어오기와 같게 상태 묶음을 보낸다.
- 중간 참가(join: "anytime"): 게임이 시작부터 요청을 유지해도 창을 자동으로 열지 않고 시간 초과도 없다. 사용자가 "멀티플레이" 버튼으로 창을 열어 방을 생성하고, 방장이 방을 생성하거나 갱신한 뒤 2분 30초 동안 참가를 받는다. 들어온 유저는 JOIN으로 알리므로, 그 유저에게 필요한 게임 상태는 게임이 메시지(rejoin 게임은 상태 묶음도 가능)로 보낸다.
- 상태 표(선택): multiplayer.board{columns[1~6]{id(영문 소문자·숫자·-, 16자), type "bar"|"number"|"rank"|"status", name(12자), max(bar 필수, 1~65535), tone("hp"|"accent"), prefix·suffix(4자), labels(status 필수, 1~15개 {name(8자), tone "normal"|"good"|"warn"|"bad"|"dim", dimRow})}, names(사람이 아닌 줄 이름), captions(머리 글 {0}·{1}), mark(강조 줄 의미), scope("all" 게임이 모든 줄 | "self" 기기마다 자기 줄), sort{column, order}}. ① Web_NetBoard() = 세션 동안 같은 위치의 400바이트 버퍼: 0 serial u32(바꿀 때마다 +1, 0 건너뜀, 다른 칸을 모두 기록한 후 마지막에) · 4 format u8 = 1 · 5 rows u8(0~8) · 6 flags u8(비트 0 = 최종 결과) · 7 caption u8(1부터, 0 없음) · 8 arg0 s32 · 12 arg1 s32 · 16 + 48×i 줄{slot u8(0~7, 0xFF = 사람 아님) · flags u8(비트 0 흐리게, 비트 1 강조) · nameLabel u8 · nameLen u8(0~20) · values s32×6 · name 20바이트 UTF-8}. 값: bar = 하위 16비트 현재·상위 16비트 최대(0 = max), number = s32, rank = 0 또는 1~99, status = 0 또는 labels 번호. ② webgba.net.board({caption, args:[…], final, rows:[{slot, values, nameLabel, name, dim, mark}]}). 초당 4번까지만 바꾼다. 사람 줄 이름은 항상 webGBA 닉네임이다.
- 예제: webGBA 저장소 docs/wgba/examples/net-webapi(① C, 롬 없음)·net-script(② JS 한 개).

[온라인 업데이트 — 선택(규격 12장)]
- 새 버전을 사용자가 파일을 다시 받지 않고 적용하게 하려면 manifest에 "update": {"feed": "https://<정적 서버>/<게임 id>/latest.json", "key": "<공개 키>"}를 추가한다. 서버는 정적 파일만(예: Cloudflare R2 공개 버킷), CORS GET 허용, latest.json은 Cache-Control: no-cache, 패치·.wgbp는 내용 해시 이름 + 1년 immutable.
- 열쇠: node tools/wgba.mjs keygen -o <git 저장소 밖 경로>/key.pem — 공개 키(base64 88자)만 manifest에 넣고, 비밀 키는 저장소·채팅·로그에 넣지 않는다. 비밀 키를 잃으면 이 key로는 새 버전을 낼 수 없다.
- 새 버전마다: node tools/wgba.mjs diff <직전.wgba> <새.wgba> -o p.wgbd [--orig <원작 롬>] → node tools/wgba.mjs feed --dir <발행 폴더> --key key.pem --wgba <새.wgba> --patch p.wgbd [--old <옛 버전 .wgba 폴더> --orig <원작 롬>] [--full <새.wgbp>] → node tools/wgba.mjs verify <발행 폴더> --key key.pem --wgba <직전.wgba> → node tools/wgba.mjs upload <발행 폴더>(환경 변수 R2_ACCOUNT_ID·R2_ACCESS_KEY_ID·R2_SECRET_ACCESS_KEY·R2_BUCKET). 이전 버전 .wgba를 모두 보관해 둔다(--old 로 옛 버전마다 바로 가는 패치 = 업데이트 1번에 패치 1개, 직전 버전이 없으면 그 버전 사용자는 .wgbp 전체 설치로만 받는다). 업데이트 목록 index.json(12.2.1)은 webGBA 알려진 게임 id 표의 게임용이고, manifest update 만 쓰는 게임은 필요 없다.
- 버전 파일 형식을 직접 만들 때: {"wgbaFeed":1,"signed":"<JSON 글: id·version·wgba{sha1,size}·from[{sha1,version,to,patch{url,size,sha256}}]·full{url,size,sha256}>","signature":"<signed 글 UTF-8 바이트의 ECDSA P-256·SHA-256 서명 r‖s 64바이트 base64>"}. 차이 패치 .wgbd 형식은 12.3절 그대로(직접 만들지 말고 도구를 쓴다).
- 같은 id·더 높은 version으로만 낸다. 세이브 형식이 바뀌면 게임 쪽에서 옛 세이브를 이어 읽게 한다(퀵슬롯은 버전이 다르면 webGBA가 불러오지 않는다).

[작업 순서]
1. wasm의 가져오기·내보내기를 확인해 runtime을 선택한다(webapi 규약에 맞으면 webapi, 아니면 script).
2. manifest JSON을 작성한다(필수 필드 누락 없이, 모르는 값은 확인한다). 멀티플레이 게임이면 multiplayer를 작성하고, webapi는 Web_Net* 일곱 개를, script는 webgba.net을 구현한다.
3. 패키징한다. webGBA 저장소(https://github.com/flightrabbit-hash/webGBA)를 다운로드할 수 있으면 해당 폴더에서
   node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir 그림폴더(label.png·front.png·spine.png)] [--js game.js] [--data 이름=파일] [--rom 롬]
   을 실행한다(node 18+, 설치 불필요, cart.*의 chunk·format·width·height는 도구가 채운다). 도구를 사용할 수 없으면 위 [파일 구조]대로 패키징하는 짧은 스크립트(node 또는 python)를 작성한다: webgba.* section 제외 → chunk 준비 → TOC 길이 계산 → 오프셋 순서대로 결정 → SHA-256 → 기록.
4. 검증: node tools/wgba.mjs check game.wgba로 오류 0을 확인한다. 도구가 없으면 직접 확인: WebAssembly.validate, 첫 section이 webgba.toc, TOC 파일 길이 = 실제 길이, 항목별 위치·section 이름·종류·SHA-256, rom은 맨 끝, manifest 필수 필드·version 형식, webapi이면 필수 내보내기·가져오기 목록·bit 중복 없음, script이면 js chunk·entry.style·버튼 code, 롬팩 그림 크기·형식, 멀티플레이이면 protocol 1·purposes id 규칙·중복 없음·인원 2~8·rejoin 불리언·join "anytime"만·iceServers 형식·board 형식·Web_Net* 일곱 개가 모두 있음(일부만 있으면 경고).
5. 생성한 파일 이름·크기·TOC 표·검증 결과를 나에게 보고한다.

[금지 사항]
- 나에게 권리가 없는 롬·그림·음악·데이터를 포함하지 않는다. 다른 회사 상표(게임기 이름·로고 등)를 롬팩 그림에 포함하지 않고, 실제 카트리지 모양·상자 그림을 모방하지 않는다.
- 게임 JS에 네트워크 요청·eval로 외부 코드 수신·호스트(parent·top) 접근·IndexedDB를 포함하지 않는다.
- 멀티플레이 통신은 webGBA가 제공하는 것(Web_Net*·webgba.net)만 사용한다. 게임이 직접 WebSocket·WebRTC·fetch로 연결하지 않는다(script 틀은 네트워크를 차단하고, webapi는 네트워크 가져오기가 존재하지 않는다). 롬·타인의 저작물을 메시지로 보내지 않는다.
- 같은 게임의 새 버전에서 id를 변경하지 않는다(세이브 연결이 끊김). 버전은 x.y.z로 올린다 — 같은 id의 높은 버전은 webGBA가 확인 없이 업데이트하고, 낮은 버전만 경고한다. 다른 게임에는 다른 id를 사용한다.
- 규격에 없는 필드를 지어내지 않는다(반드시 필요하면 "x-"로 시작하는 이름).
- 스레드(SharedArrayBuffer·pthreads)를 사용하는 빌드로 제작하지 않는다.
- wasm-opt·strip 등의 도구는 custom section을 삭제할 수 있으므로 패키징 전에만 사용하고, 패키징 후에는 실행하지 않는다.
````
