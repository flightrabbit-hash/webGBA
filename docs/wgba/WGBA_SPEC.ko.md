# .wgba 규격 1

**한국어** · [English](WGBA_SPEC.en.md)

`.wgba` 는 webGBA 가 여는 게임 파일 하나입니다. **파일 전체가 올바른 WebAssembly(wasm) 모듈**이고, 그 안의
사용자 정의 구획(custom section)에 설명서·롬팩 그림·JS·데이터를 담고, 맨 앞의 **목차**가 조각마다 시작·끝 오프셋과
해시를 적어 둡니다. GBA 게임이 아니어도 됩니다 — wasm 으로 만든 게임이면 `.wgba` 로 묶어 webGBA(Windows 앱·웹 버전)에서
돌릴 수 있습니다.

> 7장 멀티플레이는 아직 초안이고, 지금 webGBA 는 멀티플레이 연결을 하지 않습니다. 그 밖의 장은 지금 webGBA 가 하는 그대로입니다.
> 문서에 "지금 webGBA" 라고 적은 곳은 규격이 아니라 지금 앱의 동작입니다(다른 호스트는 달라도 됨).

## 목차
1. [개요](#1-개요)
2. [파일 구조](#2-파일-구조)
3. [설명서(manifest)](#3-설명서manifest)
4. [실행 방식](#4-실행-방식) — ① Web API(JS 없음) · ② 자체 JS(격리 실행)
5. [키 매핑](#5-키-매핑)
6. [롬팩 그림](#6-롬팩-그림) — 라벨 · 앞면 · 옆면
7. [멀티플레이](#7-멀티플레이) (초안)
8. [보안 규칙](#8-보안-규칙)
9. [만들기 예](#9-만들기-예)
10. [검증](#10-검증)
11. [형식 번호와 버전](#11-형식-번호와-버전)
12. [AI 전용 프롬프트](#12-ai-전용-프롬프트)

---

## 1. 개요

| 하고 싶은 것 | 고를 실행 방식 |
| --- | --- |
| C·C++·Rust 등으로 만든 게임을 JS 없이 wasm 하나로(화면·소리·입력·세이브는 webGBA 가 맡음) | **① Web API** (`runtime: "webapi"`) |
| emscripten·직접 만든 JS 처럼 **자기 JS 가 있는** wasm 게임 | **② 자체 JS** (`runtime: "script"`) — JS 는 격리된 틀 안에서만 돎 |

- `.wgba` 하나에 게임에 필요한 것이 모두 들어 있어 옆에 다른 파일이 없어도 열립니다.
- 파일이 그대로 wasm 이라 `WebAssembly.validate()` 를 통과하고, wasm 도구(`wasm-objdump -h` 등)로 들여다볼 수 있습니다.
- 가장 빨리 해 보기: [9.1](#91-예제를-묶어-보기) 의 예제 `docs/wgba/examples/hello-webapi/` 를 명령 두 줄로 묶어 webGBA 로 열어 보세요.
- **롬·게임 데이터는 자기가 권리를 가진 것만 넣으세요.** 남의 롬·그림·음악을 넣은 `.wgba` 를 나눠 주지 마세요. webGBA 는 롬을 함께 주지 않습니다.

용어: **조각** = 목차에 적힌 데이터 한 덩어리(설명서·롬팩 그림·JS·code·데이터·롬). **호스트** = webGBA(파일을 여는 쪽).
**틀** = ② 게임이 도는 격리된 iframe. **퀵슬롯** = 상태 저장(그 순간을 통째로 저장·불러오기).

---

## 2. 파일 구조

```text
 오프셋 0 ┌──────────────────────────────────────────┐
          │ wasm 머리 8바이트  00 61 73 6D 01 00 00 00   │
        8 ├──────────────────────────────────────────┤
          │ 구획 webgba.toc       목차 (첫 구획, 필수)      │
          │ 구획 webgba.manifest    설명서 JSON (필수)     │
          │ 구획 webgba.cart.label  롬팩 라벨 그림 (선택)   │
          │ 구획 webgba.cart.front  롬팩 앞면 그림 (선택)   │
          │ 구획 webgba.cart.spine  롬팩 옆면 그림 (선택)   │
          │ 구획 webgba.js          게임 JS (② 만)        │
          ├──────────────────────────────────────────┤ ← 조각 "code" 시작
          │ 원래 wasm 구획들 (type·import·…·code·data)     │
          │ (원래 있던 사용자 정의 구획 name·producers 등도)   │
          ├──────────────────────────────────────────┤ ← 조각 "code" 끝
          │ 구획 webgba.data.<이름>  데이터 (선택, 여럿)      │
          │ 구획 webgba.rom          롬 (선택, 있으면 맨 끝)   │
          └──────────────────────────────────────────┘
```

- 앞쪽(목차·설명서·롬팩 그림)은 작아서 **라이브러리 목록은 파일 앞 몇 KB 만 읽고** 그립니다. 큰 데이터·롬은 뒤에 둡니다.
- 호스트는 조각 "code" 구간만 떼어(앞에 wasm 머리 8바이트를 붙여) 컴파일합니다. 그래서 롬·그림이 wasm 엔진 메모리에 올라가지 않습니다.
- wasm 사용자 정의 구획은 `00` + 구획 길이(LEB128) + 이름 길이(LEB128) + 이름(UTF-8) + 내용 입니다. wasm 엔진은 이 구획을 무시합니다.

### 2.1 목차 `webgba.toc`

**파일의 첫 구획**이어야 합니다(오프셋 8). 내용은 little endian, 고정 길이입니다.

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4 | `WGTC` |
| 4 | 1 | 목차 형식 큰 번호 `1` (모르는 값이면 열지 않음) |
| 5 | 1 | 목차 형식 작은 번호 `0` (높아도 엶) |
| 6 | 2 | 머리 길이 `16` (읽는 쪽은 이 값만큼 건너뜀) |
| 8 | 2 | 항목 길이 `80` (읽는 쪽은 이 값 간격으로 읽음) |
| 10 | 2 | 항목 수 (256 이하) |
| 12 | 4 | 파일 전체 길이 (잘렸거나 뒤에 덧붙은 파일을 알아냄) |
| 16 | 80×n | 항목들 (파일 안 순서대로) |

항목 하나(80바이트):

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 32 | 조각 이름(ASCII, 남는 자리 0). 규칙 `[a-z0-9][a-z0-9._-]{0,31}` |
| 32 | 4 | **시작** 오프셋 — 파일 처음부터, 조각 내용의 첫 바이트 |
| 36 | 4 | **끝** 오프셋 — 내용 마지막 바이트 다음(끝 − 시작 = 저장된 길이) |
| 40 | 4 | 푼 크기(방식 0 이면 저장된 길이와 같음) |
| 44 | 1 | 방식: `0` 그대로, `1` zlib(RFC 1950) |
| 45 | 1 | 종류: `0` code · `1` manifest · `2` cart(롬팩 그림) · `3` js · `4` rom · `5` data |
| 46 | 2 | 깃발: 비트 0 = 필수(이 종류를 모르는 호스트는 열지 않음). 나머지 0. 묶기 도구는 manifest·code·js·rom 에 1, cart·data 에 0 |
| 48 | 32 | 저장된 바이트(시작~끝)의 SHA-256 |

- 이름과 구획: 조각 `manifest` 는 구획 `webgba.manifest` 의 내용, `data.levels` 는 `webgba.data.levels` 처럼 **구획 이름 = `webgba.` + 조각 이름**입니다. 시작 오프셋 = 그 구획 내용(이름 뒤)의 첫 바이트입니다.
- 조각 `code` 만 구획이 아니라 **원래 wasm 구획들이 이어진 구간**입니다(첫 원래 구획의 id 바이트부터 마지막 원래 구획 끝까지). 이 구간 안에 `webgba.*` 구획이 있으면 안 됩니다.
- 하나씩만: `manifest`·`code`(꼭 하나), `cart.label`·`cart.front`·`cart.spine`·`js`·`rom`(많아야 하나). `data.*` 는 64개까지, 이름은 `data.` 뒤 27자까지.
- 순서: 목차 → `manifest`·`cart.*`·`js` → `code` → `data.*` → `rom`.
- 목차에 없는 `webgba.*` 구획은 무시합니다(검사 경고).
- `rom` 이 있으면 **파일 맨 끝 구획**이어야 합니다(롬 구획을 빼고 다시 붙이는 옛 도구와 바이트까지 같게 하려고).
- 목차 자체의 길이는 항목 수로만 정해지므로, 묶는 도구는 목차 길이를 먼저 셈하고 그 뒤 오프셋을 차례로 정하면 됩니다(되풀이 없음).

### 2.2 롬 조각 `webgba.rom`

① 게임에 넣는 롬(호스트가 게임 메모리에 놓는 큰 데이터)입니다. 목차 방식은 `0`(그대로)이고, 내용은 아래 머리 + 롬입니다.
(목차가 생기기 전부터 쓰던 형식이라 그대로 둡니다.)

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4 | `WGRM` |
| 4 | 2 | 머리 길이 `36` |
| 6 | 1 | 형식 `1` |
| 7 | 1 | `0` 그대로 · `1` zlib |
| 8 | 4 | 롬 크기(32MB 이하) |
| 12 | 4 | 묶은 크기 |
| 16 | 20 | 롬 SHA-1 |
| 36 | … | 묶은 롬 |

### 2.3 크기 상한

| 무엇 | 상한 | 넘으면 |
| --- | --- | --- |
| 파일 전체 | 512MB (휴대폰은 64MB 이하 권장) | 열지 않음 |
| 설명서 | 64KB (풀어서) | 열지 않음 |
| 롬팩 그림(하나마다) | 256KB (64KB 이하 권장) | 그 그림만 기본 모양 |
| JS | 16MB (풀어서) | 묶지 않음 |
| 롬 | 32MB (풀어서) | 열지 않음 |
| 세이브 | ① `Web_GetSaveSize`(없으면 128KB) · ② `save.maxSize`(기본 1MB, 16MB 까지) | 저장하지 않음 |

호스트는 압축을 풀 때 목차의 "푼 크기"를 넘는 순간 멈춥니다(압축 폭탄 막기).

---

## 3. 설명서(manifest)

조각 `manifest` 는 UTF-8 JSON 객체 하나입니다(BOM 없음, 64KB 이하). 필드 이름은 lowerCamelCase 입니다.
**모르는 필드는 무시합니다.** `x-` 로 시작하는 필드는 만든 이가 마음대로 쓰는 자리입니다(호스트는 보지 않음).
검사용 JSON 스키마: [wgba-manifest.schema.json](wgba-manifest.schema.json).

### 3.1 필수 필드

| 필드 | 형 | 뜻 |
| --- | --- | --- |
| `wgba` | 정수 | 설명서 규격 번호. 지금 `1` |
| `id` | 글 | **게임 id — 바뀌지 않는 값.** 소문자 역도메인(`io.github.someone.mygame`), 점 1개 이상, 64자 이하. 웹 버전은 세이브·퀵슬롯을, Windows 앱은 게임별 키 설정을 이 id 로 묶습니다(Windows 앱의 세이브는 연 파일 옆 `<이름>.sav`). 새 버전에서도 같은 id 를 쓰세요 |
| `version` | 글 | **게임 버전**, 유의적 버전 `x.y.z`(예 `1.2.0`, 시험 버전 `1.3.0-beta.1` 도 됨, `+` 꼬리표는 받지 않음). 콘텐츠가 바뀔 때 올립니다 |
| `name` | 글 또는 객체 | 게임 이름(48자 이하). 언어별로 `{"en": "…", "ko": "…", "ja": "…"}` 도 됨. 호스트는 사용자 언어 → `en` → 첫 값 순으로 고름 |
| `runtime` | 글 | `"webapi"`(①) 또는 `"script"`(②) |

### 3.2 선택 필드

| 필드 | 형·기본값 | 뜻 |
| --- | --- | --- |
| `shortName` | 글·객체 | 롬팩 옆면 이름, 라벨 그림이 없을 때 라벨에 쓰는 짧은 이름(16자 이하 권장). 없으면 `name` |
| `description` | 글·객체 | 소개(500자 이하) |
| `author` | 글 | 만든 이. 정보 화면에 보임 |
| `license` · `homepage` · `contact` | 글 | 라이선스(SPDX 이름 권장 `MIT`), `https://` 주소(다른 주소는 오류), 연락처. 정보 화면에 쓰려고 둔 자리(지금 webGBA 는 보이지 않음) |
| `build` | 글 | 빌드 표시(커밋 등, 64자). 사람이 보는 글일 뿐, 빌드 식별(3.4)은 호스트가 따로 셈 |
| `needs` | 글 배열 | 이 기능이 없는 호스트는 **열지 않음**: `"pointer"`(마우스 없이는 못 함), `"net"`(멀티플레이 없이는 못 함), `"keyboard"`(실제 키보드가 꼭 있어야 함), `"state"`. 모르는 낱말이 있으면 열지 않고 "새 webGBA 가 필요합니다". 지금 webGBA 는 `net` 이 없어 `needs: ["net"]` 게임을 열지 않음 |
| `screen` | 객체 | `width`·`height`(1~1024, 기본 240·160), `scale` `"fit"`(기본, 비율 유지 꽉 채움)·`"integer"`(정수 배율 권장 — Windows 앱은 정수 배율로 그림). `fps` 는 예약(지금 webGBA 는 늘 GBA 속도 약 59.7275fps 로 돌림). 픽셀은 늘 가장 가까운 점으로 그림 |
| `audio` | 객체 | `use` — 예약(지금 webGBA 는 보지 않음). ① 은 소리 내보내기가 있으면 소리를 냄 |
| `save` | 객체 | `kind`: `"flash"`(① — 지금 webGBA 는 ① 의 `kind` 를 보지 않고 `Web_GetFlash` 가 있으면 세이브) · `"storage"`(② 기본, `webgba.save`) · `"localStorage"`(②, 틀의 대신 쓰는 localStorage 전체를 세이브로) · `"files"`(②, emscripten 파일 `files[0]`) · `"none"`. `maxSize`(②, 바이트, 기본 1MB, 16MB 까지), `files`(② `"files"` 일 때 경로 배열 — 지금 webGBA 는 첫 경로만 씀) |
| `state` | 객체 | `use` — 예약. 지금 webGBA 는 ① 은 상태 내보내기(4.1.1)가 모두 있으면, ② 는 게임이 `webgba.state.onSave`·`onLoad` 를 둘 다 부르면 퀵슬롯을 켬 |
| `pointer` | 객체 | `use`: 게임이 마우스·터치 좌표를 씀. ① 은 `Web_Pointer` 내보내기로 정해지고, ② 는 `true` 면 캔버스의 오른쪽 클릭 메뉴를 막음 |
| `input` | 객체 | 버튼 목록·기본 배치. [5장](#5-키-매핑). 없으면 ① 은 `{"preset": "gba"}`, ② 는 버튼 없음 |
| `cart` | 객체 | 롬팩: `color` `"#RRGGBB"`(몸통 색), 그림 `label`·`front`·`spine`(`{chunk, format, width, height}` + 앞면 `labelAt`·옆면 `textArea`). [6장](#6-롬팩-그림) |
| `rom` | 객체 | ①: `required`(기본 true — **롬 조각이 없고 `false` 가 아니면 호스트가 롬 파일을 고르게 함. 롬 없이 도는 게임은 꼭 `false`**). `sha1`·`hint` 는 예약(지금은 `sha1` 이 롬 조각과 다르면 검사 경고만) |
| `entry` | 객체 | ② 필수: `style` `"module"`·`"emscripten"`, `js` 조각 이름(기본 `"js"` — 묶기 도구는 늘 이 이름), `args`(emscripten `arguments`) |
| `files` | 객체 | ② 만: 게임 JS 가 찾는 파일 이름 → 조각 이름(`data.<이름>` 또는 `rom`). 예 `{"game.data": "data.game"}` |
| `multiplayer` | 객체 | [7장](#7-멀티플레이) (초안) |

### 3.3 예 (① 롬 없는 240×160 게임)

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
    "spine": { "chunk": "cart.spine", "format": "png", "width": 24, "height": 88, "textArea": [4, 10, 16, 64] }
  }
}
```

(`cart.*` 의 `chunk`·`format`·`width`·`height` 는 묶기 도구가 그림에서 채우므로 손으로 쓸 때는 `labelAt`·`textArea`·`color` 만 적어도 됩니다.)

### 3.4 버전·형식 번호·빌드 — 셋은 따로입니다

| 값 | 어디 | 누가 올림 | 무엇에 씀 |
| --- | --- | --- | --- |
| 규격 번호 `wgba`, 목차 형식 번호 | 설명서·목차 | 이 규격이 바뀔 때만 | 호스트가 **읽을 수 있는 파일인지** 가림 |
| 게임 버전 `version` | 설명서 | 만든 이(콘텐츠가 바뀔 때) | 사람에게 보임, **같은 id 를 다시 가져올 때 업데이트인지** 가림 |
| 빌드 식별 | 목차의 `code`·`rom`·`data.*` 조각 SHA-256 을 이어 다시 SHA-256 (호스트가 셈, 설명서·롬팩 그림·JS 는 뺌) | 묶을 때 저절로 | **게임 내용이 바이트까지 같은지** 가림(같으면 다시 넣지 않음, 멀티플레이 `compat: "exact"`) |

지금 webGBA 의 동작:
- 정보 화면에 이름·`version`·id·만든 이·빌드 앞 8자리를, 웹 버전 라이브러리에는 "v1.2.0" 처럼 버전을 보입니다.
- **같은 id 는 같은 게임**입니다. 웹 버전 라이브러리에 같은 id 를 다시 가져오면:
  - 빌드가 같음 → "이미 있음"(그대로 엶)
  - 더 높은 버전, 또는 같은 버전인데 빌드가 다름 → **묻지 않고 업데이트**(알림 한 줄 "1.1.0 → 1.2.0"). 세이브·퀵슬롯은 id 로 이어집니다.
  - 더 낮은 버전 → 경고하고 물음(기본 "아니요")
  - 둘을 따로 두는 고르기는 없습니다. 다른 게임이면 다른 id 를 쓰세요.
- Windows 앱은 디스크의 파일을 그대로 열므로 묻지 않고 버전만 보입니다.
- (웹 버전) 목차가 없던 옛 `.wgba` 로 하던 세이브·퀵슬롯은, 롬 조각 SHA-1 이 같은 새 파일을 처음 넣을 때 한 번 새 id 로 옮깁니다.

---

## 4. 실행 방식

### 4.1 ① Web API — `runtime: "webapi"` (JS 없음)

호스트가 wasm 을 직접 돌리고 화면·소리·입력·세이브를 맡습니다. wasm 은 아래 이름을 **내보내고**, 가져오기는 4.1.2 의 것만 씁니다.
그래서 이 방식의 게임은 호스트의 다른 기능(파일·저장소·네트워크)에 손댈 수 없습니다.

#### 4.1.1 내보내기

| 내보내기 | 필수 | 뜻 |
| --- | --- | --- |
| `memory` | ● | 선형 메모리 |
| `Web_Init()` → i32 | ● | 롬·세이브를 놓은 뒤 한 번. 0 이면 실패 |
| `Web_RunFrame(keys)` → i32 | ● | 한 프레임 진행. `keys` = 눌린 버튼 비트(5장). 0 이면 멈춤 |
| `Web_GetFramebuffer()` → i32 | ● | 화면 주소. `screen.width × height` 칸, 칸마다 R·G·B·A 4바이트(메모리 순서) |
| `Web_SetAudioRate(rate)` · `Web_GetAudioBuffer()` · `Web_GetAudioCount()` | | 호스트가 소리 표본률을 알려 줌 / 이번 프레임 소리(float32 스테레오 교차) 주소·표본 수(왼쪽·오른쪽 한 쌍 = 1) |
| `Web_GetFlash()` · `Web_GetSaveSize()` · `Web_SetSaveSize(n)` · `Web_FlashClear()` · `Web_TakeFlashDirty()` | | 세이브 버퍼 주소 / 크기(없으면 128KB) / 불러온 크기 알림 / 지우기 / 게임이 세이브를 썼는지(1 이면 호스트가 약 1초 뒤 저장) |
| `Web_RomBuffer(size)` → i32 | | 롬을 놓을 주소(권장). 없으면 0x08000000 에 놓음(메모리가 그만큼 커야 함) |
| `Web_Reset()` | | 다시 시작. 없으면 호스트가 인스턴스를 새로 만듦 |
| `Web_StateSize()` · `Web_StateSave(at)` · `Web_StateLoad(at)` · `Web_Alloc(n)` · `Web_Free(at)` · `Web_StateUsed()` | | 퀵슬롯(상태 저장). 앞의 다섯 개가 모두 있어야 켜짐. `Web_StateUsed` 가 있으면 쓴 길이만 보관(불러올 때 뒤를 0 으로 채움) |
| `Web_Pointer(x, y, buttons, wheel)` · `Web_PointerWanted()` | | 마우스: 게임 픽셀 좌표(밖이면 -1), `MouseEvent.buttons`, 휠 칸 수 / 1 이면 지금 마우스를 씀 |
| `Web_GetHaltReason()` · `Web_GetTitle()` · `Web_SetTimeZone(sec)` | | 멈춘 까닭 글(NUL 로 끝남) 주소 / 제목 / 지역 시차(UTC 에서 동쪽으로 초) |
| `Web_Net*` | | 멀티플레이 — [7장](#7-멀티플레이) (초안) |

#### 4.1.2 가져오기(호스트가 주는 것)

- `env`: `emscripten_asm_const_int`(0 을 돌려줌), `emscripten_resize_heap`, `_emscripten_throw_longjmp`, `emscripten_date_now`, `emscripten_get_now`, `emscripten_notify_memory_growth`, `abort`, `_abort_js`, `invoke_*`(emscripten 방식 setjmp/예외)
- `wasi_snapshot_preview1`: `fd_write`(기록으로만), `fd_read`·`fd_close`·`fd_seek`·`fd_sync`·`fd_fdstat_get`(오류 번호), `environ_get`·`environ_sizes_get`(0개), `clock_time_get`, `random_get`, `proc_exit`
- `webgba.v1`: 아무것도 하지 않는 함수 `() → ()`. 이 규격을 모르는 옛 webGBA 는 모르는 가져오기라며 열지 않습니다. 그래서 **240×160·GBA 버튼이 아닌 ① 게임, 롬 없이 도는 ① 게임(`rom.required: false`)은 이것을 가져오기에 넣으세요**(옛 webGBA 에서 화면이 깨진 채 돌거나 쓸데없이 롬을 묻지 않게).
- 이 밖의 가져오기가 있으면 호스트는 ① 로 열지 않습니다(② 로 만드세요).

#### 4.1.3 순서

1. 컴파일(조각 `code`) → 인스턴스 → `__wasm_call_ctors`(없으면 `_initialize`)가 있으면 부름 → `Web_SetTimeZone`.
2. 롬 조각이 있으면 풀고 SHA-1 확인 → `Web_RomBuffer(크기)` 자리에 씀. 없고 `rom.required` 가 `false` 가 아니면 사용자에게 롬 파일을 고르게 함.
3. 세이브가 있으면 `Web_FlashClear` 뒤 `Web_GetFlash` 자리에 씀 → `Web_SetSaveSize`.
4. `Web_Init()` → 그 뒤 프레임마다(GBA 속도, 약 59.7275fps) `Web_RunFrame(keys)` → 화면·소리를 가져감.
5. **`Web_Init` 뒤에는 `Web_RunFrame` 안에서 메모리를 크게 늘리지 마세요**(호스트가 들고 있는 화면 주소가 낡음).

### 4.2 ② 자체 JS — `runtime: "script"` (격리 실행)

게임 JS(조각 `js`)는 호스트가 만든 **격리된 틀** 안에서만 돕니다. 틀은 `<iframe sandbox="allow-scripts" srcdoc="…">` 이고
출처가 없습니다(`"null"`). 틀 문서는 호스트가 만들어 넣으므로 가져올 주소가 없습니다(설치한 웹 앱·오프라인에서도 열림).
틀에는 캔버스 하나(`#canvas`, `screen.width × height`)와 `webgba` 객체가 있습니다.

#### 4.2.1 틀 안에서 되는 것·안 되는 것

| 됨 | 안 됨 (호스트가 대신 함) |
| --- | --- |
| wasm 컴파일·실행, 캔버스 2D·WebGL, `requestAnimationFrame` | 네트워크(fetch·XHR·WebSocket·이미지 주소·폼 — CSP 로 막힘, WebRTC 는 틀 스크립트가 게임보다 먼저 지움). 멀티플레이는 `webgba.net`(7장) |
| 키 입력 — 호스트가 사용자 배치를 게임의 `code` 로 바꿔 `keydown`·`keyup` 을 넣음(틀이 만든 이벤트라 `isTrusted` 는 false), 캔버스 위 포인터 이벤트 | IndexedDB·쿠키·진짜 localStorage(출처가 없어 막힘) → `webgba.save`. `localStorage`·`sessionStorage` 는 틀이 메모리에 둔 것으로 바꿔 끼우고, `save.kind: "localStorage"` 면 그 내용을 호스트가 세이브로 저장 |
| `AudioContext`·AudioWorklet. 게임이 만든 `AudioContext` 도 호스트가 크기·일시정지를 맞춤. 소리가 잠겨 있으면 틀 위에 "눌러서 시작" 덮개 | 게임패드 API(호스트가 읽어 키로 넣음), 전체 화면(호스트 버튼), 팝업·`alert`·다른 주소로 가기(가면 호스트가 틀을 지우고 게임을 멈춤) |
| `blob:` 주소의 Worker·스크립트·그림 | 스레드(SharedArrayBuffer·pthreads) — 규격 1 에서 받지 않음 |

사파리(웹킷)는 사용자가 아직 누르지 않은 틀의 화면 갱신을 30Hz 로 묶습니다. 틀은 2초 넘게 40fps 아래면 같은 "눌러서 시작" 덮개를 띄웁니다.

#### 4.2.2 `webgba` 객체 (틀 API 1)

| 이름 | 뜻 |
| --- | --- |
| `webgba.version` | `1` |
| `webgba.manifest` · `webgba.lang` · `webgba.canvas` | 설명서(얼린 복사본, 읽기만) · 사용자 언어(`ko` 등) · 캔버스 |
| `webgba.wasm()` → `Promise<ArrayBuffer>` · `webgba.wasmModule()` → `Promise<WebAssembly.Module>` | 조각 `code`(머리 붙인 wasm) |
| `webgba.chunk(name)` → `Promise<Uint8Array>` · `webgba.chunkURL(name)` → `Promise<string>` (`blob:` 주소) | 데이터 조각(`data.*`, `rom` 은 풀린 롬). 그 밖의 이름은 오류 |
| `webgba.save.read()` → `Promise<Uint8Array \| null>` · `webgba.save.write(bytes)` | 이 게임의 세이브(`save.maxSize` 까지). `save.kind` 가 `"storage"` 일 때만(다른 kind 면 `read` 는 null, `write` 는 오류) |
| `webgba.state.onSave(fn)` · `webgba.state.onLoad(fn)` | 퀵슬롯: `fn()` 이 `Uint8Array`(64MB 까지)를 돌려줌 / `fn(bytes)` 가 `true`·`false`. 둘 다 불러야 퀵슬롯이 켜짐 |
| `webgba.input.held` · `webgba.on("button", fn)` | 버튼 단위 입력이 좋으면: 지금 눌린 버튼 id 묶음(`has`·`size`·되풀이) / `{id, down}` |
| `webgba.on("pause"·"resume"·"speed", fn)` | 일시정지·다시·빨리 감기 배수(게임이 맞춰도 되고 무시해도 됨). 일시정지 동안 `requestAnimationFrame` 은 틀이 붙잡아 둠. `on` 은 떼는 함수를 돌려줌 |
| `webgba.audioContext()` | 틀이 크기·일시정지를 맞추는 공용 `AudioContext`(권장) |
| `webgba.ready()` · `webgba.exit(reason)` · `webgba.log(level, text)` | 시작 끝(호스트가 불러오기 화면을 내림 — 10초 안에 부르지 않아도 그냥 보임) · 멈춤 · 기록 |
| `webgba.net` | 멀티플레이 — [7장](#7-멀티플레이). 지금 webGBA 는 `null` |

#### 4.2.3 시작 방식 `entry.style`

- `"module"`: 조각 `js` 가 ES 모듈. **기본 내보내기 함수**를 `webgba` 를 넣어 부릅니다.

  ```js
  export default async function start(webgba) {
    const { instance } = await WebAssembly.instantiate(await webgba.wasm(), {});
    const ctx = webgba.canvas.getContext("2d");
    // … 게임 루프(requestAnimationFrame)
    webgba.ready();
  }
  ```

- `"emscripten"`: emscripten 이 만든 글루 `.js`(보통 글루, `-sMODULARIZE` 팩토리, `-sEXPORT_ES6` 모두). 틀이 `Module` 을 넣어 부릅니다:
  `canvas`, `wasmBinary`(조각 `code`), `locateFile`(`files` 표의 파일을 `blob:` 주소로 — 전체 경로 또는 파일 이름으로 찾음), `arguments`(`entry.args`), `print`·`printErr`(기록),
  `preRun`(`save.kind: "files"` 면 세이브를 `save.files[0]` 경로에 놓음 — `FS` 가 내보내져 있어야 함), `onRuntimeInitialized`(`webgba.ready()` 를 대신 부르고, 그 파일을 1초마다 보아 바뀌면 저장), `onAbort`(멈춤).
  권장 빌드: `-sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS`. `--preload-file` 로 만든 `.data` 는 `files` 표에 넣으면 됩니다(틀이 `blob:` 주소로 줌). pthreads·IDBFS 는 쓰지 마세요.

---

## 5. 키 매핑

게임은 **자기가 쓰는 버튼 목록**만 설명서에 적습니다. 실제 키보드·게임패드·터치 버튼을 어디에 둘지는 호스트가 role 로 정합니다.

### 5.1 `input`

| 필드 | 뜻 |
| --- | --- |
| `preset` | `"gba"`: 아래 GBA 10버튼을 그대로(① 의 기본값). `"none"`: 버튼 없음(② 의 기본값) |
| `buttons` | 버튼 배열(① 32개까지, ② 24개까지). `preset` 과 같이 쓰면 preset 뒤에 붙음(같은 `id` 면 preset 것을 바꿈). **① 에서 GBA 와 다른 버튼을 쓰면 `"preset": "none"` 을 적고 버튼을 모두 적으세요** — ① 의 기본값은 `"gba"` 라서, 빼면 GBA 10버튼 뒤에 붙어 bit·role 이 겹침(검사 오류) |
| `keyboard` | `"mapped"`(기본): 게임은 목록의 버튼만 받음. `"raw"`(② 만): 실제 키를 그대로 넘김(글자 입력 게임 등, 호스트 몫 키는 빼고) |

버튼 하나:

| 필드 | 뜻 |
| --- | --- |
| `id` | 버튼 이름(`A`, `JUMP` …, 영문·숫자·`_`·`-` 16자, 겹치지 않게) |
| `role` | 자리: `up` `down` `left` `right` · 앞면 `a` `b` `c` `d`(최대 4개) · `l` `r` `l2` `r2` · `start` `select` · `extra`. 기본 키·게임패드·터치 자리를 이것으로 정함. `extra` 말고는 role 하나에 버튼 하나 |
| `label` | 화면에 보일 글(글 또는 언어별, 6자 이하 권장, 8자까지). 없으면 `id` |
| `bit` | **① 필수**: `Web_RunFrame(keys)` 의 비트 번호 0~31 (눌림 = 1) |
| `code` | **② 필수**: 게임 JS 가 듣는 `KeyboardEvent.code`(예 `"Space"`, `"KeyZ"`). 호스트는 `key`·`keyCode` 도 맞춰 넣음 |
| `keys` | 기본 키보드 배치(`KeyboardEvent.code` 4개까지). 없으면 `role` 의 기본값 |
| `pad` | 기본 게임패드 배치(표준 매핑 버튼 번호 0~31, 축은 `"-axis0"`·`"+axis1"` 처럼). 없으면 `role` 의 기본값 |
| `touch` | `"auto"`(기본) 또는 `"hide"`(터치 버튼을 만들지 않음) |

### 5.2 `role` 기본값

| role | 기본 키 | 게임패드(표준) | 터치 자리 |
| --- | --- | --- | --- |
| `up` `down` `left` `right` | 방향키 | 12·13·14·15, 왼쪽 스틱 | 왼쪽 방향 패드(스틱·십자는 사용자 설정) |
| `a` | `KeyZ` `KeyK` | 0 | 오른쪽 앞면 |
| `b` | `KeyX` `KeyJ` | 1 | 오른쪽 앞면 |
| `c` · `d` | `KeyC` `KeyI` · `KeyV` `KeyU` | 2 · 3 | 앞면 **A·B 바로 위 줄**(5.4, 게임이 정의했을 때만) |
| `l` · `r` | `KeyA` · `KeyS` | 4(·6) · 5(·7) | 위 왼쪽 · 위 오른쪽 |
| `l2` · `r2` | `KeyQ` · `KeyW` | 6 · 7 | 없음(키보드·게임패드만) |
| `start` | `Enter` `NumpadEnter` | 9 | 아래 가운데 |
| `select` | `Backspace` `ShiftRight` | 8 | 아래 가운데 |
| `extra` | 없음(사용자가 정함) | 없음 | 없음 |

- `l2`·`r2` 가 있으면 `l`·`r` 의 게임패드는 4·5 만 씁니다.
- GBA 버튼과 같은 role(`a` `b` `select` `start` 방향 `l` `r`)의 기본 키는 사용자가 앱에서 정한 GBA 키를 따릅니다(위 표는 처음 값).
- 한 키는 한 버튼에만 갑니다(먼저 정해진 쪽). Windows 앱은 설정 창 › 키에서 그 게임의 버튼만 보이고, 바꾼 배치를 게임 id 별로 기억합니다.

### 5.3 GBA 기본 배치 `preset: "gba"`

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

### 5.4 앞면 버튼 A~D

앞면 버튼은 최대 4개, role `a` `b` `c` `d` 입니다. **터치 화면의 C·D 버튼은 설명서에 `c`·`d` role 버튼을 정의한 게임에서만 나옵니다.**

- **C·D 를 쓰는 게임**은 `c`·`d` role 버튼을 정의합니다. 그 버튼이 보내는 것은 ① 이면 `bit`, ② 이면 `code` 입니다. 하나만(`c` 만) 정의해도 됩니다.

  ```json
  "input": { "preset": "gba", "buttons": [
    { "id": "C", "role": "c", "bit": 10, "label": "C" },
    { "id": "D", "role": "d", "bit": 11, "label": "D" }
  ] }
  ```

- **C·D 를 정의하지 않은 게임**(`preset: "gba"` 만 쓰는 게임, 설명서가 없는 옛 `.wgba`·`.wasm`, `.gba`): 터치 화면에는 **A·B 만** 나옵니다. 호스트가 C·D 를 따로 만들지 않습니다.
- **화면 배치**: C·D 는 **A·B 바로 위 한 줄**에, A·B 와 같은 크기·간격·모양으로 놓습니다(세로·가로 모두). C 는 A 위, D 는 B 위(`c` 만 있으면 A 위에 C 하나).
- **좁은 세로 화면**(너비 320·360 등)에서 C·D 줄을 놓을 자리가 모자라면, 호스트는 버튼 크기를 지키고 **게임 화면을 줄여** 자리를 만듭니다.
- 키보드·게임패드는 정의된 모든 버튼이 늘 됩니다. 터치는 role 자리가 있는 버튼만(5.2) 나옵니다.

### 5.5 호스트 몫 키

호스트가 게임보다 먼저 쓰는 키입니다. 게임의 기본 배치(`keys`)에 넣지 마세요(`check` 가 `Space`·`Tab`·`Escape`·`F1`~`F12` 를 경고).

| 키 | 하는 일 |
| --- | --- |
| `Space`(사용자가 바꿀 수 있음) | 누르는 동안 빨리 감기 |
| `Tab` | 빨리 감기 켜고 끄기 |
| `Pause` (웹 버전은 `P` 도) | 일시정지 |
| `F1`~`F9`, `Shift+F1`~`F9` (Windows 앱) | 퀵슬롯 불러오기·저장. Windows 앱은 `F1`~`F12` 모두 호스트 몫 |
| `Ctrl`·`Alt`·`Meta` 조합 | 앱 단축키 |

게임이 듣는 `code` 는 무엇이든 됩니다(호스트가 바꿔 넣으므로). 방향 버튼을 동시에 누를 때의 처리(나중 것만 / 반대쪽은 나중 것 / 모두)는 사용자 설정이고 `up`·`down`·`left`·`right` role 에 걸립니다.

### 5.6 ② 의 예

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

사용자가 `Z` 를 누르면(기본 `a` = `KeyZ`) 게임은 `code: "Space"`, `key: " "`, `keyCode: 32` 인 키 이벤트를 받습니다. 터치 화면에는 방향 패드 + "점프" + 아래 가운데 "MENU" 가 생깁니다.

---

## 6. 롬팩 그림

webGBA 웹 버전의 라이브러리는 게임마다 롬팩(카트리지) 하나를 책장에 꽂아 보여 줍니다. 꽂혀 있을 때는 **옆면(등)** 이 보이고,
고르면 꺼내서 **앞면 + 라벨**이 보입니다. `.wgba` 에 그림 셋을 넣을 수 있고(모두 선택), 없는 것은 webGBA 가 `cart.color` 로 기본 모양을 그립니다.

| 그림 | 조각 | 격자(가로×세로) | 무엇 |
| --- | --- | --- | --- |
| 라벨 | `cart.label` | 48×32 (3:2) | 앞면 라벨 창에 들어갈 그림만 |
| 앞면 | `cart.front` | 54×44 | 롬팩 앞면 전체(몸통·라벨 창 바탕·홈 등). 몸통 바깥은 투명 |
| 옆면(등) | `cart.spine` | 12×44 | 책장에 꽂혔을 때 보이는 옆면. 바깥은 투명 |

| 항목 | 규칙 |
| --- | --- |
| 크기 | 격자 × k, k 는 1~4. **세 그림은 같은 k** 를 씀. 권장 k = 2: 라벨 **96×64** · 앞면 **108×88** · 옆면 **24×88** |
| 형식 | PNG(권장, 팔레트 PNG 도 됨) 또는 **무손실** WebP. JPEG·GIF·SVG 는 받지 않음 |
| 투명 | 됨. 라벨의 투명한 곳에는 앞면 그림(없으면 기본 라벨 바탕)이 비침 |
| 용량 | 하나마다 64KB 이하 권장(256KB 를 넘으면 그 그림을 쓰지 않음) |
| 그리기 | 호스트는 가장 가까운 점·정수 배율로만 그림(줄이거나 흐리게 늘리지 않음). 격자 크기로 그려 2배로 저장하기를 권장 |
| 라벨 자리 | `cart.front.labelAt: [x, y]` — 앞면 그림 안에서 라벨 왼쪽 위(앞면 그림 픽셀). 없으면 `[3k, 5k]`. 라벨(48k×32k)이 앞면 안에 들어가야 함 |
| 옆면 이름 자리 | `cart.spine.textArea: [x, y, 가로, 세로]` — 옆면 그림 픽셀. 호스트가 여기에 `shortName`(없으면 `name`)을 세로 글로 씀. 없으면 글을 쓰지 않음(이름을 옆면 그림에 직접 그린 경우) |

```json
"cart": {
  "color": "#3a6ea5",
  "label": { "chunk": "cart.label", "format": "png", "width": 96, "height": 64 },
  "front": { "chunk": "cart.front", "format": "png", "width": 108, "height": 88, "labelAt": [6, 10] },
  "spine": { "chunk": "cart.spine", "format": "png", "width": 24, "height": 88, "textArea": [4, 10, 16, 64] }
}
```

`chunk`·`format`·`width`·`height` 는 묶기 도구가 그림에서 채웁니다(직접 쓸 때는 그림과 같게). `color` 는 몸통 색(선택)이고, 기본 앞면·옆면을 그릴 때 이 색으로 명암을 만듭니다.

그림이 없을 때(규격 밖 크기·형식, 망가진 그림, 다른 k 도 "없음"으로 봄 — 오류 창 없음):
- 앞면 없음 → 기본 앞면(`cart.color` 몸통 + 라벨 창, 라벨 자리 `[3k, 5k]`)
- 옆면 없음 → 기본 옆면(`cart.color` 몸통 + 이름 띠에 `shortName`·`name`)
- 라벨 없음 → 라벨 자리에 `shortName`(없으면 `name`)을 글로 씀
- `cart.color` 없음 → 테마 색

- **상표를 넣지 마세요**: 다른 회사의 이름·로고(게임기 회사 이름, 게임기 이름 글자·로고 등), 실제 카트리지·상자 그림을 베낀 것, 권리가 없는 캐릭터 그림. 앞면·옆면 몸통도 실제 게임기 카트리지의 모양·홈·단자를 그대로 베끼지 말고 자기 모양으로 그리세요. 자기가 그렸거나 쓸 권리가 있는 그림만 넣으세요.

---

## 7. 멀티플레이

> 멀티플레이 규약 1 (초안). **지금 webGBA 는 아직 연결을 하지 않습니다**: `needs: ["net"]` 게임은 열지 않고, `Web_NetHost` 는 불리지 않으며, `webgba.net` 은 `null` 입니다.
> 게임은 이 경우 통신 메뉴를 숨기면 됩니다(7.8). 아래는 앞으로 넣을 규약이고 바뀔 수 있습니다.

### 7.1 개요

webGBA 는 같은 와이파이(같은 공유기) 안의 기기끼리 게임을 이어 줍니다. 연결은 기기끼리 직접(WebRTC 데이터 채널)이고, 게임 데이터는 어느 서버도 지나지 않습니다. 기본으로 다른 망의 기기와는 연결되지 않습니다.

게임은 "지금 통신 상대가 필요하다"는 것과 주고받을 바이트만 다룹니다. 방 만들기·들어가기·근처 기기 찾기·연결·끊김 처리는 webGBA 가 맡습니다. ② 의 게임 JS 는 네트워크를 직접 쓸 수 없으므로(8장) 늘 이 길을 씁니다.

- 한 연결 묶음(세션) = 방 하나, 2~8명. 방을 만든 기기가 **자리 0(방장)**, 들어온 순서대로 1, 2, …
- 메시지는 믿을 수 있고(빠지지 않음) 보낸 사람마다 순서를 지킵니다. 메시지 하나는 16384바이트까지.
- 받는 곳을 `TO_ORDERED` 로 보내면 나를 포함한 모두가 **같은 순서로** 받습니다(방장이 순서를 매김).
- 같은 게임(또는 같은 호환 키)끼리만 연결됩니다.
- 멀티플레이 없이는 아예 못 하는 게임만 `needs: ["net"]` 을 적습니다.

### 7.2 설명서의 `multiplayer` 필드

없으면 멀티플레이를 쓰지 않는 게임입니다(①에서 내보내기만 있고 `multiplayer` 가 없으면 아래 기본값으로 동작).

| 키 | 종류 | 필수 | 기본 | 뜻 |
|---|---|---|---|---|
| `protocol` | 정수 | 예 | — | 멀티플레이 규약 번호. 지금 `1` |
| `players` | `{ "min": 정수, "max": 정수 }` | 아니요 | `{2, 2}` | 게임 전체가 받는 인원(2~8) |
| `purposes` | 배열 | 아니요 | 이름 "통신" 하나 | 게임이 상대를 찾는 경우들. 배열 순서 = 번호(1부터) |
| `purposes[].id` | 글자(영문 소문자·숫자·`-`, 32자까지) | 예 | — | 바뀌지 않는 이름. 서로 다른 용도끼리는 연결하지 않음 |
| `purposes[].name` | 여러 언어 이름 | 예 | — | 창에 보이는 이름(예: 교환, 대전) |
| `purposes[].players` | `[min, max]` | 아니요 | `players` | 그 용도의 인원 |
| `compat` | 글자 | 아니요 | `"exact"` | 함께 할 수 있는 상대. `"exact"` = 같은 `id` + 빌드 식별(3.4)이 같음(설명서·롬팩 그림만 다른 파일끼리는 됨). 다른 글자 = `id` 와 그 글자가 같은 게임끼리(예: 통신 규칙이 같은 여러 버전) |
| `sync` | `"messages"` \| `"inputs"` | 아니요 | `"messages"` | `"inputs"` = 호스트가 프레임마다 모두의 키를 맞춰 줌(7.6, 선택 기능) |
| `inputDelay` | 정수 | 아니요 | `3` | `sync: "inputs"` 일 때 키를 몇 프레임 늦게 쓸지(1~10) |

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

모르는 키는 무시합니다. `multiplayer.protocol` 이 호스트가 아는 것보다 크면 호스트는 멀티플레이를 끄고 게임은 그대로 실행합니다.

### 7.3 ① Web API — 내보내기 함수

모두 **게임이 내보내는 함수**이고 호스트가 부릅니다(새 가져오기 없음 → 멀티플레이를 모르는 호스트에서도 게임은 그대로 열림).
`Web_NetWanted`, `Web_NetEvent`, `Web_NetOut`, `Web_NetOutLen`, `Web_NetOutClear`, `Web_NetInBuffer`, `Web_NetIn` 일곱 개가 모두 있어야 멀티플레이를 지원하는 것으로 봅니다. 포인터는 wasm 메모리 안 주소, 값은 모두 little endian.

| 함수 | 모양 | 부르는 때 | 뜻 |
|---|---|---|---|
| `Web_NetHost` | `(u32 protocol, u32 flags)` | `Web_Init` 뒤 한 번 | 호스트가 멀티플레이 규약 `protocol` 을 지원함. `flags` 비트 0 = 순서 방송 됨, 비트 1 = `sync: "inputs"` 됨. **불리지 않으면 통신이 없는 호스트** → 게임은 "친구와 하기" 같은 메뉴를 숨기면 좋음. 선택 |
| `Web_NetWanted` | `() → u32` | 프레임마다 `Web_RunFrame` 뒤 | 0 = 통신 필요 없음. 0 이 아니면 요청(7.3.1) |
| `Web_NetEvent` | `(u32 kind, u32 a, u32 b)` | 일이 생겼을 때, 프레임 사이 | 사건(7.3.3) |
| `Web_NetOut` | `() → ptr` | 프레임마다 `Web_RunFrame` 뒤 | 보낼 기록들이 있는 곳(7.3.2) |
| `Web_NetOutLen` | `() → u32` | 같음 | 보낼 기록들의 바이트 수(0 = 없음) |
| `Web_NetOutClear` | `()` | 기록을 다 읽은 뒤 | 보내기 자리를 비움 |
| `Web_NetInBuffer` | `(u32 len) → ptr` | 받은 메시지마다, `Web_RunFrame` 앞 | `len` 바이트를 쓸 자리. **0 = 지금 자리가 없음** → 호스트는 그 메시지를 들고 있다가 다음 프레임에 다시(순서 그대로) |
| `Web_NetIn` | `(u32 from, u32 len)` | 자리에 바이트를 쓴 뒤 | 받기 확정. `from` = 보낸 사람 자리 |
| `Web_NetCompat` | `() → ptr` | 세션 전 한 번 | 선택. NUL 로 끝나는 ASCII 64자까지의 호환 키(예: 빌드 해시). 있으면 설명서 `compat` 뒤에 붙여 함께 비교 |

호스트의 한 프레임:

```text
받은 메시지들 → Web_NetInBuffer / Web_NetIn (자리가 없으면 멈추고 다음 프레임에)
Web_RunFrame(keys)
Web_NetOut / Web_NetOutLen → 보내기 → Web_NetOutClear
Web_NetWanted → 창 열기·닫기·세션 끝내기 (7.7)
```

#### 7.3.1 `Web_NetWanted` 값

| 비트 | 뜻 |
|---|---|
| 0~7 | 용도 번호(설명서 `purposes` 의 1부터 번호. 0 = 첫 용도) |
| 8~11 | 최소 인원(0 = 2) |
| 12~15 | 최대 인원(0 = 최소와 같음, 8까지) |
| 16~17 | 역할: 0 = 아무거나(창에서 고름), 1 = 방 만들기만, 2 = 들어가기만 |
| 18~23 | 0 으로 둠(나중 쓰임) |
| 24~31 | 요청 번호: 새로 상대를 찾을 때마다 게임이 1씩 올림(255 다음 1). 같은 값이 이어지면 같은 요청 |

- 세션이 이어지는 동안 게임은 **같은 값을 계속** 돌려줍니다. 0 을 돌려주면 "통신 끝" → 호스트는 남은 보내기를 다 보낸 뒤 세션을 닫고 `CLOSED(LEFT)` 를 줍니다.
- 용도나 요청 번호가 바뀌면 호스트는 지금 세션을 닫고 새 요청으로 봅니다.

#### 7.3.2 보내기 기록 형식

`Web_NetOut()` 위치부터 `Web_NetOutLen()` 바이트에 기록이 이어집니다. 기록마다:

| 바이트 | 뜻 |
|---|---|
| 0~1 | 내용 길이 `n`(u16, 1~16384) |
| 2 | 받는 곳: 0~7 = 그 자리 하나, `0xFE` = **TO_ORDERED**(나 포함 모두, 모두 같은 순서), `0xFF` = **TO_ALL**(나 말고 모두) |
| 3 | 0(나중 쓰임) |
| 4~ | 내용 `n` 바이트, 다음 기록은 4바이트 경계에서 |

- 한 프레임 보내기 합은 65536바이트까지 권장. 세션이 없을 때 쌓인 기록은 호스트가 버립니다.
- `TO_ORDERED` 로 보낸 것은 내게도 돌아옵니다(`from` = 내 자리). 게임은 자기 메시지도 돌아온 순서에 맞춰 적용하면 모든 기기가 같은 상태가 됩니다.
- 받는 쪽은 보낸 사람마다 순서를 지킵니다. 서로 다른 사람의 메시지끼리는 `TO_ORDERED` 일 때만 모두 같은 순서입니다.

#### 7.3.3 사건 `Web_NetEvent(kind, a, b)`

| kind | 이름 | a | b | 뜻 |
|---|---|---|---|---|
| 1 | `OPEN` | 내 자리 | 지금 인원 | 세션이 열림. 방장은 혼자(인원 1)로 먼저 열림 |
| 2 | `JOIN` | 들어온 자리 | 지금 인원 | 누가 들어옴 |
| 3 | `LEAVE` | 나간 자리 | 이유 | 누가 나감(그 자리는 비어 있고, 새 사람이 같은 번호를 받을 수 있음) |
| 4 | `CLOSED` | 이유 | 0 | 세션 끝. 이후 보내기는 버려짐 |
| 5 | `STALL` | 자리 | 0 | 그 사람에게서 1초 넘게 소식이 없거나 그 기기가 앱을 잠시 떠남 |
| 6 | `RESUME` | 자리 | 0 | 다시 이어짐 |

이유: 1 `CANCEL`(사용자가 멀티플레이 창에서 취소) · 2 `TIMEOUT`(정해진 시간 안에 연결 못 함 / 끊긴 뒤 돌아오지 않음) · 3 `INCOMPATIBLE`(서로 다른 게임·호환 키·규약 번호) · 4 `LOST`(연결이 끊김) · 5 `FULL`(방이 가득 참) · 6 `LEFT`(정상적으로 나감) · 7 `HOST_LEFT`(방장이 나가 방이 없어짐) · 8 `NO_NETWORK`(와이파이가 없거나 이 기기에서 연결 기능을 못 씀)

게임이 지킬 것: `CLOSED(CANCEL)` 을 받으면 게임 안에서 취소한 것과 같이 처리하고 `Web_NetWanted` 를 0 으로. `STALL` 은 잠깐일 수 있으니 바로 끊지 말고 게임의 시간 제한대로. 방장이 나가면(`HOST_LEFT`) 세션은 끝(방장 넘기기는 규약 1에 없음).

### 7.4 ② 자체 JS — `webgba.net`

격리 틀이 주는 `webgba.net` 으로 주고받습니다(틀과 호스트 사이는 MessagePort 로 오가고, 게임은 이 객체만 씀). 바이트는 `ArrayBuffer`·`Uint8Array`.

| 게임 → 호스트 | 뜻 |
|---|---|
| `webgba.net.want({ purpose, min, max, role })` | ① 의 `Web_NetWanted` 0 아님과 같음. `purpose` = 설명서 id, `role` = `"any"`·`"make"`·`"join"`. 부를 때마다 새 요청 |
| `webgba.net.unwant()` | ① 의 0 과 같음(통신 끝) |
| `webgba.net.send(to, bytes)` | `to` = 자리 0~7 · `"ordered"` · `"all"`, 16384바이트까지 |

| 호스트 → 게임 | 뜻 |
|---|---|
| `webgba.net.host` | `{ protocol, ordered, inputs }` — ① 의 `Web_NetHost` |
| `webgba.net.onevent = (kind, a, b) => …` | 7.3.3 과 같은 번호 |
| `webgba.net.onrecv = (from, bytes) => …` | 받은 메시지(순서 그대로) |

멀티플레이를 모르는 호스트에서는 `webgba.net` 자체가 `null` 입니다.

### 7.5 한도

| 항목 | 값 |
|---|---|
| 인원 | 2~8(자리 0~7) |
| 메시지 하나 | 16384바이트 |
| 한 프레임 보내기 합(권장) | 65536바이트 |
| 받기 순서 | 보낸 사람마다 순서 지킴, `TO_ORDERED` 는 모두 같은 순서 |
| 지연(같은 와이파이) | 보통 왕복 2~20ms(프레임 1~2개) |

### 7.6 선택 기능: 키 맞추기 (`sync: "inputs"`)

자기 통신 코드가 없는 단순한 ① 게임용. 게임이 같은 키 입력에 같은 화면을 만들면(결정적) 호스트가 모든 사람의 키를 프레임마다 맞춰 줍니다.

- 추가 내보내기: `Web_NetKeys(u32 slot, u32 keys)` — 호스트가 `Web_RunFrame` 바로 앞에 다른 사람마다 부름. `Web_RunFrame(keys)` 의 `keys` 는 내 키.
- 호스트는 프레임 f 의 내 키를 f + `inputDelay` 에 쓰도록 보내고, 모두의 f 키가 모일 때까지 프레임 f 를 돌리지 않음(그동안 화면 멈춤, 1초 넘으면 `STALL`).
- 모두 같은 프레임 0 에서 시작: `OPEN`·`JOIN` 으로 인원이 차면 방장이 "시작"을 보내고, 그다음 프레임이 모두의 프레임 0.
- 빨리 감기·상태 불러오기는 세션 중 쓸 수 없음.

### 7.7 멀티플레이 창을 띄우는 조건

호스트는 아래가 모두 맞을 때 **한 번** 멀티플레이 창을 띄웁니다.

1. 게임이 멀티플레이를 지원함: ① 7.3 의 일곱 함수가 있음(설명서 `multiplayer` 가 있으면 그 내용을 씀) / ② 설명서에 `multiplayer` 가 있음
2. 게임이 요청함: ① `Web_NetWanted()` 가 0 에서 0 아님으로 바뀜(또는 요청 번호가 바뀜) / ② `webgba.net.want()` 를 부름
3. 지금 세션이 없음, 게임이 실행 중(멈춤 아님), 사용자 설정에서 멀티플레이가 켜져 있음

띄우지 않음:
- 사용자가 창을 닫은(취소한) 뒤 **같은 요청**으로는 다시 띄우지 않음. 대신 화면 위 "멀티플레이" 단추가 요청이 이어지는 동안 켜져 있어 다시 열 수 있음.
- 게임이 아무것도 요청하지 않을 때는 창도 단추도 없음(사용자가 먼저 여는 일 없음).

```text
┌ 멀티플레이 · 교환 (2명) ─────────────────┐
│  [ 방 만들기 ]   [ 코드로 들어가기 ]       │
│                                          │
│  근처 방                                  │
│   ● 플레이어 4821 · 교환 · 1/2   [들어가기] │
│   ○ 플레이어 7730 · 다른 버전     (흐림)   │
│                                          │
│  인터넷 없이 연결(코드·QR)          [ > ]  │
│                              [ 취소 ]     │
└──────────────────────────────────────────┘
```

- 역할이 정해진 요청(방 만들기만·들어가기만)이면 그 화면부터.
- 인원이 최소에 닿으면 "연결됨"을 보이고 1초 뒤 창을 닫음. 그다음 확인(예: "A로 시작")은 게임 안에서.
- 최대 인원 전까지 방장 쪽에는 작은 표시("2/4 · 기다리는 중")가 남고, 사람이 더 들어오면 `JOIN`.
- 취소 → `CLOSED(CANCEL)`. 시간 안에 못 찾으면(기본 3분) `CLOSED(TIMEOUT)`. 게임이 먼저 통신 끝을 알리면 창을 조용히 닫음.
- 연결이 안 될 때 안내: "같은 와이파이인지, 게스트·공용 와이파이가 아닌지, VPN 이 꺼져 있는지 확인하세요."

세션 중 호스트가 지키는 것: 빨리 감기·속도 바꾸기 끔(1배), 상태 불러오기·초기화 막음, 다른 게임 열기 = 세션 끝(`LEFT`). 일시 멈춤·앱을 떠남 → 상대에게 `STALL`, 돌아오면 `RESUME`, 일정 시간(기본 15초) 넘게 돌아오지 않으면 끊음(`LOST`). 화면 구석에 작은 상태(인원·연결 상태). 닉네임은 사용자 설정 값이고 IP·기기 이름은 어디에도 보이지 않습니다.

### 7.8 만드는 사람에게

- 같은 키 입력·같은 메시지에 같은 결과가 나오게(난수는 게임 안 씨앗에서) 만들면 `TO_ORDERED` 하나로 모두 같은 상태를 유지할 수 있습니다.
- 받은 메시지는 프레임 사이에 들어오므로, 게임은 받은 것을 큐에 넣고 프레임 안에서 처리하세요.
- 호스트가 멀티플레이를 모르면(`Web_NetHost` 가 안 불림 / `webgba.net` 이 `null`) 통신 메뉴를 숨기세요. 지금 webGBA 가 이 경우입니다.
- 같은 게임 빌드끼리만 연결되는 것이 기본입니다(`compat: "exact"`). 버전이 달라도 통신 규칙이 같다면 `compat` 에 같은 글자를 쓰세요.
- 롬이나 남의 저작물을 메시지로 보내지 마세요.

---

## 8. 보안 규칙

`.wgba` 는 남이 만든 파일입니다. 호스트는 아래를 지킵니다(다른 호스트를 만들 때도 같은 규칙을 권장합니다).

**공통**
- 목차의 오프셋·길이는 믿지 않습니다: 파일 안인지, 순서대로이고 겹치지 않는지, 구획 이름이 맞는지, SHA-256 이 맞는지 확인한 뒤 씁니다. 압축은 "푼 크기"를 넘으면 멈춥니다.
- 설명서 글은 **글로만** 보입니다(HTML 로 넣지 않음). 길이를 자릅니다. 주소는 `https://` 만 받습니다.
- 그림은 PNG·무손실 WebP 만, 머리에서 크기를 먼저 읽고 규칙 밖이면 쓰지 않습니다(SVG 는 받지 않음).
- 세이브·퀵슬롯·키 설정은 **게임마다 따로**입니다. 한 게임에 다른 게임의 저장 데이터를 주지 않습니다. 같은 id 는 같은 게임으로 보므로(3.4) 더 낮은 버전으로 바꿀 때만 묻습니다 — 만드는 사람은 id 를 자기 도메인·계정 이름으로 만들어 남과 겹치지 않게 하세요.

**① Web API**
- wasm 은 가져오기 목록(4.1.2) 밖의 것에 닿을 수 없으므로 호스트 안에서 돌립니다. 모르는 가져오기가 있으면 ① 로 열지 않습니다.
- 끝없는 반복·메모리 키우기로 화면이 멈출 수는 있으므로, 호스트는 멈춘 게임을 닫을 수 있게 합니다.

**② 자체 JS — 격리 틀**
- JS 는 **sandbox iframe(`sandbox="allow-scripts"` 만, `allow-same-origin` 없음)** 에서만 돌립니다. 틀 문서는 `srcdoc` 으로 넣습니다. 출처가 없어(`"null"`) 호스트·다른 게임의 저장소(IndexedDB·localStorage·쿠키)와 호스트 화면에 닿지 못합니다. 팝업·위 창 이동·`alert` 도 막힙니다.
- 틀 문서 맨 앞에 엄격한 CSP 를 `<meta http-equiv="Content-Security-Policy">` 로 넣습니다:
  `default-src 'none'; script-src 'sha256-<틀 스크립트>' blob: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob:; font-src blob: data:; connect-src blob: data:; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'`
  (출처 없는 문서에서는 `'self'` 가 맞지 않는 브라우저가 있어, 틀 스크립트는 문서 안에 넣고 그 SHA-256 으로 허락합니다. 문서 안에 들어 있어 따로 가져올 주소가 없으므로 웹 서버·앱 설정이 필요 없습니다.)
- WebRTC 는 CSP 로 막히지 않으므로 틀 스크립트가 게임보다 먼저 `RTCPeerConnection` 을 지웁니다. 깨끗한 것을 다시 얻으려고 새 틀을 만드는 길은 `frame-src 'none'` 이 막습니다.
- 호스트와는 처음 넘긴 **MessagePort 하나**로만 이야기합니다. 호스트는 정해진 메시지 종류·크기만 받고, 틀에서 온 글을 코드로 실행하지 않습니다.
- 틀이 스스로 다른 주소로 가면(틀 `load` 가 두 번째로 일어나면) 호스트는 틀을 지우고 게임을 멈춥니다.
- Windows 앱: WebView2 는 앱 다리 스크립트를 틀에도 넣습니다. 그래도 앱은 틀에서 온 부름을 받지 않고(앱 통로 주소는 CSP 가 막고, 틀에서 보낸 메시지는 앱이 듣지 않음), 틀 스크립트가 게임보다 먼저 그 통로(`__TAURI__`·`__TAURI_INTERNALS__` 안의 함수·`chrome.webview` 등)를 지웁니다.

---

## 9. 만들기 예

### 9.1 예제를 묶어 보기

webGBA 저장소(https://github.com/flightrabbit-hash/webGBA)를 받아 그 폴더에서(node 18 이상, 바깥 의존 없음):

```text
node tools/wgba.mjs pack -o hello.wgba --wasm docs/wgba/examples/hello-webapi/game.wasm --manifest docs/wgba/examples/hello-webapi/manifest.json --cart-dir docs/wgba/examples/hello-webapi/cart
node tools/wgba.mjs check hello.wgba
```

`hello.wgba`(약 2.6KB)를 webGBA 로 열면 화면 전체가 버튼에 따라 색이 바뀝니다. 예제 폴더 `docs/wgba/examples/hello-webapi/`:
`game.c`(소스) · `game.wasm`(그 빌드, 594바이트) · `manifest.json` · `cart/`(라벨·앞면·옆면 PNG, k = 2).

### 9.2 도구 명령

```text
node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir 그림폴더]
                     [--label label.png] [--front front.png] [--spine spine.png] [--js game.js] [--js-store]
                     [--data levels=levels.bin …] [--data-store] [--rom game.bin]
node tools/wgba.mjs check game.wgba [--quick]             검증(10장). 오류가 있으면 끝 상태 1. --quick 은 롬을 풀지 않음
node tools/wgba.mjs info  game.wgba                       목차·설명서 요약(파일 앞부분만 읽음)
node tools/wgba.mjs extract game.wgba cart.label label.png   조각 꺼내기(code → 실행 가능한 wasm, rom → 풀린 롬)
node tools/wgba.mjs strip game.wgba game-norom.wgba          롬 조각만 빼고 다시 묶기
```

- `--wasm` 에는 `.wgba` 도 줄 수 있습니다(안의 `webgba.*` 구획은 빼고 다시 묶음).
- `--cart-dir` 폴더의 `label.png`·`front.png`·`spine.png`(또는 `.webp`) 중 있는 것을 넣고, 설명서 `cart.*` 의 `chunk`·`format`·`width`·`height` 를 그림에서 채웁니다. 없는 그림의 항목은 설명서에서 뺍니다.
- JS·데이터는 zlib 으로 넣습니다(`--js-store`·`--data-store` 면 그대로). 설명서·롬팩 그림·code 는 늘 그대로입니다.
- 같은 입력이면 어느 PC 에서 묶어도 바이트까지 같은 파일이 나옵니다(압축은 pako level 9, 설명서는 입력 JSON 을 같은 순서로 빈칸 없이).
- 묶은 뒤 다시 읽어 10장 검사를 통과해야 출력 파일을 씁니다.

### 9.3 ① 가장 작은 C 게임

예제 `game.c` 의 요점입니다(전체는 예제 폴더):

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

(`wasm-ld` 는 `memory` 를 기본으로 내보냅니다. 롬이 없으므로 설명서에 `"rom": { "required": false }`, 옛 webGBA 가 롬을 묻지 않게 `webgba.v1` 가져오기를 넣었습니다.)

### 9.4 ② emscripten(SDL 등) 게임

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

### 9.5 도구 없이 묶기(직접)

규칙만 지키면 어떤 언어로도 만들 수 있습니다. 순서:

1. 입력 wasm 의 구획을 따라가며 `webgba.` 로 시작하는 사용자 정의 구획을 빼고 나머지를 그대로 이어 붙임 → **code 구간**.
2. 조각 내용을 정함: manifest(JSON UTF-8), cart.label·cart.front·cart.spine(그림 바이트 그대로), js(그대로 또는 zlib), data(그대로 또는 zlib), rom(WGRM 머리 + 롬).
3. 항목 수 n 으로 목차 길이 `16 + 80n` 을 정하고, 목차 구획(`00` + LEB 길이 + LEB 이름 길이 + `webgba.toc` + 목차) 길이를 셈.
4. 오프셋 8 + 목차 구획 길이부터 차례로: 각 `webgba.<이름>` 구획 → code 구간 → data → rom. 구획마다 **시작 = 그 구획 내용의 첫 바이트**(이름 뒤), 끝 = 구획 끝. code 는 구간의 처음과 끝.
5. 목차를 채움(이름·시작·끝·푼 크기·방식·종류·깃발·SHA-256), 파일 전체 길이도.
6. `wasm 머리 + 목차 구획 + 나머지` 를 쓰고, `WebAssembly.validate` 와 10장 검사를 거침.

---

## 10. 검증

`wgba.mjs check` 가 보는 것(직접 만들 때도 이대로 확인하세요). **오류**가 하나라도 있으면 실패, **경고**는 알림입니다.

- 파일 전체 `WebAssembly.validate` 통과, 첫 구획이 `webgba.toc`(하나만), 목차의 파일 길이 = 실제 길이
- 항목: 이름 규칙·겹침 없음, 순서대로이고 파일 안, 그 자리에 `webgba.<이름>` 구획이 있음(code 는 wasm 구획 경계와 맞고 안에 `webgba.*` 없음), 종류가 이름과 맞음, 방식 0 이면 푼 크기 = 저장 길이, SHA-256 일치, 필수 깃발인데 모르는 종류 없음, 하나만 있어야 하는 조각이 하나
- 목차에 없는 `webgba.*` 구획 → 경고
- `rom` 이 있으면 맨 끝, WGRM 머리·크기·SHA-1 이 맞음(`--quick` 이면 풀지 않음), 설명서 `rom.sha1` 이 다르면 경고
- 설명서: 64KB 이하 JSON, `wgba` 1, `id` 규칙, `version` 이 `x.y.z`, `name`(48자), `runtime`, 모르는 `needs` 없음, `homepage` 는 `https://`, `screen`·`save`·`input.preset`·`cart.color` 값, 버튼 id 규칙·겹침, role 겹침, `shortName` 16자 넘으면 경고
- ①: 필수 내보내기 4개, 모르는 가져오기 없음, 버튼 `bit` 0~31 이고 겹치지 않음, `Web_Net*` 일곱 개(7.3) 중 일부만 있으면 경고, 240×160·GBA 버튼이 아닌데 `webgba.v1` 이 없으면 경고, `js` 조각이 있으면 경고(쓰지 않음)
- 멀티플레이: `multiplayer.protocol` 1, `purposes[].id` 규칙·겹치지 않음, 인원 2~8
- ②: `js` 조각 있음, `entry.style`, 버튼마다 `code`, 가져온 공유 메모리(스레드) 없음
- 롬팩 그림(라벨·앞면·옆면): PNG·무손실 WebP, 256KB 상한(64KB 넘으면 경고), 격자(48×32 · 54×44 · 12×44) × k(1~4)가 아니면 경고, 셋의 k 가 다르면 경고, 설명서의 형식·크기와 다르면 경고, `labelAt`·`textArea` 가 그림 밖이면 경고, 설명서에 있는데 조각이 없으면 오류, 조각이 있는데 설명서에 없으면 경고
- 기본 키(`keys`)에 호스트 몫 키(`Space`·`Tab`·`Escape`·`F1`~`F12`)가 있으면 경고

---

## 11. 형식 번호와 버전

| 번호 | 올리는 때 | 읽는 쪽 |
| --- | --- | --- |
| 목차 큰 번호(지금 1) | 목차 짜임이 바뀌어 옛 호스트가 잘못 읽을 때만 | 모르면 열지 않고 "새 webGBA 가 필요합니다" |
| 목차 작은 번호(지금 0) | 새 조각 종류·깃발이 생길 때 | 높아도 엶. 모르는 종류는 필수 깃발이 없으면 무시 |
| 설명서 `wgba`(지금 1) | 있던 필드의 뜻이 바뀌거나 빠질 때만(새 필드는 올리지 않음) | 더 높으면 열지 않음 |
| `needs` | 번호 대신 "이 기능이 꼭 필요함"을 적음 | 모르는 낱말이면 열지 않음 |
| 틀 API `webgba.version`(지금 1) | 있던 함수의 뜻이 바뀔 때만 | 게임이 보고 맞춤 |
| 롬 조각 WGRM 형식(지금 1) | 롬 머리가 바뀔 때 | 모르면 열지 않음 |
| 게임 `version` | 만든 이 마음(콘텐츠가 바뀔 때) | 업데이트인지 가리기·표시에만 씀 |

옛 파일: 목차·설명서가 없는 `.wgba`(wasm 그대로, 또는 끝에 `webgba.rom` 만 있는 것)도 webGBA 는 계속 엽니다. 이때는 ① · 240×160 · GBA 버튼 · 이름은 파일 이름으로 봅니다.

---

## 12. AI 전용 프롬프트

아래를 통째로 자기 AI 에게 붙여 넣고, 자기 wasm 게임 파일을 알려 주세요. AI 가 이 규격대로 `.wgba` 를 만들어 줍니다.

````text
너는 내 WebAssembly 게임을 webGBA 의 .wgba 규격 1 파일로 묶는 일을 돕는다. 아래 규격을 그대로 지키고, 모르는 것은 지어내지 말고 나에게 묻는다.

[먼저 나에게 물을 것]
- 게임 wasm 파일, 함께 빌드된 JS 가 있는지(emscripten 글루 등), 데이터 파일 목록, 롬처럼 게임 메모리에 놓을 큰 데이터가 있는지
- 게임 이름(언어별도 됨), 게임 id(소문자 역도메인, 예 io.github.내아이디.게임이름 — 한 번 정하면 바꾸지 않음), 버전(x.y.z)
- 화면 크기, 쓰는 버튼과 각 버튼의 뜻, 세이브가 있는지, 마우스를 쓰는지
- 롬팩 그림이 있는지(라벨 48×32·앞면 54×44·옆면 12×44 의 같은 배수 1~4배, PNG 또는 무손실 WebP — 모두 선택), 롬팩 몸통 색(#RRGGBB)
- 넣을 데이터에 대한 권리가 나에게 있는지(없으면 넣지 않는다)

[파일 짜임]
- .wgba 는 파일 전체가 올바른 wasm 이다: wasm 머리 8바이트(00 61 73 6D 01 00 00 00) 뒤에 구획들. 사용자 정의 구획 = 바이트 00 + 구획 길이(LEB128, 이름 길이 칸부터 끝까지) + 이름 길이(LEB128) + 이름(UTF-8) + 내용.
- 순서: "webgba.toc"(목차, 반드시 첫 구획) → "webgba.manifest"(설명서 JSON) → "webgba.cart.label" → "webgba.cart.front" → "webgba.cart.spine"(롬팩 그림, 있는 것만) → "webgba.js"(runtime script 만) → 원래 wasm 구획들 = 조각 "code" → "webgba.data.<이름>"(선택, 64개까지, 이름 27자까지 [a-z0-9][a-z0-9._-]*) → "webgba.rom"(선택, 있으면 파일 맨 끝).
- 조각 code = 입력 wasm 에서 이름이 "webgba." 로 시작하는 사용자 정의 구획을 모두 뺀 나머지 구획들을 원래 순서대로 이은 것(머리 8바이트 제외, name 등 다른 사용자 정의 구획은 남김).
- 목차 내용(little endian): "WGTC"(4) · 큰 번호 u8=1 · 작은 번호 u8=0 · 머리 길이 u16=16 · 항목 길이 u16=80 · 항목 수 u16 · 파일 전체 길이 u32, 그 뒤 항목들(파일 안 순서대로).
- 항목 80바이트: 조각 이름 32바이트(ASCII, 남는 자리 0) · 시작 u32 · 끝 u32 · 푼 크기 u32 · 방식 u8 · 종류 u8 · 깃발 u16 · SHA-256 32바이트.
  - 조각 이름 = 구획 이름에서 "webgba." 를 뺀 것(manifest, cart.label, cart.front, cart.spine, js, code, data.<이름>, rom).
  - 시작 = 그 구획 "내용"(이름 뒤) 첫 바이트의 파일 오프셋, 끝 = 구획 끝(내용 마지막 바이트 다음). code 는 이은 구간의 처음과 끝.
  - 방식: 0 그대로, 1 zlib(RFC 1950). manifest·cart·code·rom 은 0. js·data 는 1(또는 0). 푼 크기 = 풀었을 때 길이(방식 0 이면 끝 − 시작).
  - 종류: 0 code · 1 manifest · 2 cart · 3 js · 4 rom · 5 data. 깃발: manifest·code·js·rom = 1(필수), cart·data = 0.
  - SHA-256 = 파일에 저장된 바이트(시작~끝, 압축된 그대로)의 해시.
- 셈 순서: 항목 수 n → 목차 길이 16+80n → 목차 구획 전체 길이 → 오프셋 8 + 목차 구획 길이부터 조각을 차례로 놓으며 시작·끝을 정함 → 목차를 채움(파일 전체 길이 포함). 되풀이할 필요 없음.
- 롬 조각 내용(webgba.rom, 방식 0): "WGRM" · 머리 길이 u16=36 · 형식 u8=1 · 압축 u8(0 그대로, 1 zlib) · 롬 크기 u32(32MB 이하) · 묶은 크기 u32 · 롬 SHA-1 20바이트 · 묶은 롬.
- 크기 상한: 파일 512MB, 설명서 64KB, 롬팩 그림 하나 256KB(64KB 권장), JS 16MB, 롬 32MB, 목차 항목 256개.

[설명서 webgba.manifest — UTF-8 JSON, BOM 없음]
- 필수: "wgba": 1, "id"(소문자 역도메인, 점 1개 이상, 64자 이하), "version"("x.y.z", 시험 버전 "-beta.1" 됨), "name"(글 또는 {"en":…,"ko":…}, 48자 이하), "runtime"("webapi" 또는 "script").
- 선택: shortName(16자), description, author, license, homepage(https:// 만), contact, build, needs(["pointer","net","keyboard","state"] 중), screen{width,height(1~1024, 기본 240·160), scale("fit"·"integer")}, save{kind,maxSize,files}, pointer{use}, input{preset,buttons,keyboard}, cart{color, label, front{labelAt}, spine{textArea}}, rom{required}, entry{style,js,args}, files, multiplayer. 모르는 필드는 무시되고, 규격에 없는 값이 꼭 필요하면 "x-" 로 시작하는 이름을 쓴다.
- runtime "webapi" 인데 롬 조각이 없으면 반드시 "rom": {"required": false} (없으면 webGBA 가 롬 파일을 고르라고 한다).
- cart.label/front/spine 은 {"chunk":"cart.label|cart.front|cart.spine","format":"png|webp","width":…,"height":…} 를 그림과 같게 쓰고, 넣지 않는 그림의 항목은 빼며, 앞면에 labelAt [x,y](기본 [3k,5k]), 옆면에 textArea [x,y,w,h](호스트가 짧은 이름을 세로로 씀, 없으면 글 없음)를 둔다.
- 지금 webGBA 는 screen.fps·audio·state.use 를 보지 않는다(늘 약 59.7275fps). needs 에 "net" 을 넣으면 지금 webGBA 는 열지 않는다.

[runtime "webapi" — JS 없음, 호스트가 wasm 을 직접 돌림]
- 내보내기 필수: memory, Web_Init() -> i32(0 실패), Web_RunFrame(keys) -> i32(0 멈춤, keys = 눌린 버튼 비트), Web_GetFramebuffer() -> i32(width×height 칸, 칸마다 R,G,B,A 바이트).
- 선택: Web_SetAudioRate(rate)·Web_GetAudioBuffer()·Web_GetAudioCount()(float32 스테레오 교차, 개수 = 좌우 쌍 수) / Web_GetFlash()·Web_GetSaveSize()·Web_SetSaveSize(n)·Web_FlashClear()·Web_TakeFlashDirty()(세이브) / Web_RomBuffer(size)(롬 놓을 주소) / Web_Reset() / Web_StateSize()·Web_StateSave(at)·Web_StateLoad(at)·Web_Alloc(n)·Web_Free(at)(퀵슬롯은 다섯 개 모두, Web_StateUsed() 선택) / Web_Pointer(x,y,buttons,wheel)·Web_PointerWanted() / Web_GetHaltReason()·Web_GetTitle()·Web_SetTimeZone(sec).
- 가져오기는 이것만: env.{emscripten_asm_const_int, emscripten_resize_heap, _emscripten_throw_longjmp, emscripten_date_now, emscripten_get_now, emscripten_notify_memory_growth, abort, _abort_js, invoke_*}, wasi_snapshot_preview1.{fd_write, fd_read, fd_close, fd_seek, fd_sync, fd_fdstat_get, environ_get, environ_sizes_get, clock_time_get, random_get, proc_exit}, webgba.v1(() -> (), 아무것도 안 함). 다른 가져오기가 있으면 runtime "script" 로 만든다.
- 240×160·GBA 버튼이 아니거나 롬 없이 도는 게임은 가져오기 webgba.v1 을 넣는다(옛 webGBA 가 열지 않게). C 에서는 __attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void); 를 Web_Init 에서 한 번 부른다.
- 순서: 인스턴스 → __wasm_call_ctors(없으면 _initialize) → 롬 → 세이브 → Web_Init → 프레임마다 Web_RunFrame. Web_Init 뒤에는 메모리를 크게 늘리지 않는다.
- 버튼마다 bit(0~31). GBA 와 같으면 "input": {"preset":"gba"} (A=0 B=1 SELECT=2 START=3 RIGHT=4 LEFT=5 UP=6 DOWN=7 R=8 L=9). GBA 와 다르면 반드시 "input": {"preset":"none", "buttons":[…모든 버튼…]} — webapi 의 preset 기본값은 "gba" 라서 preset 을 빼면 내 버튼이 GBA 10버튼 뒤에 붙어 bit·role 이 겹친다(검사 오류). GBA 10버튼에 몇 개만 더하려면 preset "gba" + 더할 버튼(겹치지 않는 bit·role, 예 c=10 d=11).

[runtime "script" — 자기 JS 가 있는 게임]
- JS 는 출처 없는 sandbox iframe(srcdoc) 안에서 돈다. 네트워크(fetch·XHR·WebSocket·WebRTC)·IndexedDB·쿠키·진짜 localStorage·팝업·위 창 이동·스레드(SharedArrayBuffer·pthreads)를 못 쓴다. localStorage 는 메모리 대용품이다.
- entry 필수. entry.style "module": JS 가 export default async function start(webgba){…} 를 내보낸다. "emscripten": emscripten 글루(보통·MODULARIZE·EXPORT_ES6) — 틀이 Module{canvas, wasmBinary, locateFile, arguments, print, printErr, preRun, onRuntimeInitialized, onAbort} 를 넣는다. 데이터 파일은 files 표({"파일 이름":"data.<이름>" 또는 "rom"})로, --preload-file 의 .data 도 이렇게. 권장 빌드 -sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS.
- webgba 객체: version(1), manifest, lang, canvas(#canvas, screen 크기), wasm()→ArrayBuffer, wasmModule(), chunk(name)→Uint8Array, chunkURL(name)→blob: 주소, save.read()/save.write(bytes)(save.kind "storage" 일 때만), state.onSave(fn→Uint8Array)/state.onLoad(fn(bytes)→true|false)(둘 다 불러야 퀵슬롯), input.held, on("button"|"pause"|"resume"|"speed", fn), audioContext(), ready()(시작 끝에 부른다), exit(reason), log(level,text), net(지금 null).
- save.kind: "storage"(기본, webgba.save), "localStorage"(틀 localStorage 전체를 세이브로), "files"(emscripten FS 의 save.files[0] 경로, FS 내보내기 필요), "none". maxSize 기본 1MB, 16MB 까지.
- 버튼마다 code(게임이 듣는 KeyboardEvent.code). 호스트가 사용자가 누른 키를 이 code 의 keydown/keyup 으로 바꿔 넣는다(isTrusted 는 false 이니 검사하지 않는다). preset 기본값은 "none".

[버튼]
- 버튼 = {id(영문·숫자·_·- 16자), role, label, bit(webapi) 또는 code(script), keys(기본 키 KeyboardEvent.code 4개까지), pad(게임패드 버튼 번호·"+axis1" 등), touch("auto"·"hide")}. webapi 는 32개, script 는 24개까지.
- role: up down left right, 앞면 a b c d(최대 4개), l r l2 r2, start select, extra. extra 말고는 role 하나에 버튼 하나. C·D 를 쓰면 c·d role 버튼을 정의한다 — 그때만 터치 화면 A·B 바로 위 줄에 나온다. 정의하지 않으면 A·B 만.
- 기본 키는 role 로 정해진다(a=Z·K, b=X·J, c=C·I, d=V·U, l=A, r=S, l2=Q, r2=W, start=Enter, select=Backspace·오른쪽 Shift, 방향=방향키). keys 에 호스트 몫 키(Space, Tab, Escape, Pause, F1~F12, P)를 넣지 않는다.

[멀티플레이 — 규약 초안, 지금 webGBA 는 연결하지 않음]
- 설명서 multiplayer{protocol:1, players{min,max}, purposes[{id,name,players}], compat, sync}. webapi 는 Web_NetWanted·Web_NetEvent·Web_NetOut·Web_NetOutLen·Web_NetOutClear·Web_NetInBuffer·Web_NetIn 일곱 개를 내보내고, script 는 webgba.net(지금 null) 을 쓴다. 호스트가 Web_NetHost 를 부르지 않거나 webgba.net 이 null 이면 통신 메뉴를 숨긴다. 게임 JS 가 직접 네트워크를 열지 않는다.

[할 일]
1. wasm 의 가져오기·내보내기를 살펴 runtime 을 고른다(webapi 규약에 맞으면 webapi, 아니면 script).
2. 설명서 JSON 을 쓴다(필수 필드 빠짐없이, 모르는 값은 묻는다).
3. 묶는다. webGBA 저장소(https://github.com/flightrabbit-hash/webGBA)를 받을 수 있으면 그 폴더에서
   node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir 그림폴더(label.png·front.png·spine.png)] [--js game.js] [--data 이름=파일] [--rom 롬]
   을 쓴다(node 18+, 설치할 것 없음, cart.* 의 chunk·format·width·height 는 도구가 채운다). 못 쓰면 위 [파일 짜임] 대로 묶는 짧은 스크립트(node 또는 python)를 만든다: webgba.* 구획 빼기 → 조각 준비 → 목차 길이 셈 → 오프셋 차례로 → SHA-256 → 쓰기.
4. 검증: node tools/wgba.mjs check game.wgba 로 오류 0 을 확인한다. 도구가 없으면 직접: WebAssembly.validate, 첫 구획이 webgba.toc, 목차 파일 길이 = 실제, 항목마다 자리·구획 이름·종류·SHA-256, rom 은 맨 끝, 설명서 필수 필드·version 형식, webapi 면 필수 내보내기·가져오기 목록·bit 겹침 없음, script 면 js 조각·entry.style·버튼 code, 롬팩 그림 크기·형식.
5. 만든 파일 이름·크기·목차 표·검증 결과를 나에게 보여 준다.

[하지 말 것]
- 나에게 권리가 없는 롬·그림·음악·데이터를 넣지 않는다. 다른 회사 상표(게임기 이름·로고 등)를 롬팩 그림에 넣지 않고, 실제 카트리지 모양·상자 그림을 베끼지 않는다.
- 게임 JS 에 네트워크 요청·eval 로 바깥 코드 받기·호스트(parent·top) 건드리기·IndexedDB 를 넣지 않는다.
- 같은 게임의 새 버전에서 id 를 바꾸지 않는다(세이브가 끊김). 버전은 x.y.z 로 올린다 — 같은 id 의 높은 버전은 webGBA 가 묻지 않고 업데이트하고, 낮은 버전만 경고한다. 다른 게임에는 다른 id 를 쓴다.
- 규격에 없는 필드를 지어내지 않는다(꼭 필요하면 "x-" 로 시작하는 이름).
- 스레드(SharedArrayBuffer·pthreads)를 쓰는 빌드로 만들지 않는다.
- wasm-opt·strip 같은 도구는 사용자 정의 구획을 지울 수 있으니 묶기 전에만 쓰고, 묶은 뒤에는 돌리지 않는다.
````
