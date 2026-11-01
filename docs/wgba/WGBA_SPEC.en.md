# .wgba specification 1

[한국어](WGBA_SPEC.ko.md) · **English**

A `.wgba` is a single game file that webGBA opens. **The whole file is a valid WebAssembly (wasm) module.** Custom sections
inside it carry the manifest, cartridge art, JS and data, and a **table of contents** at the front records the start/end offset
and hash of every chunk. It does not have to be a GBA game — any game built as wasm can be packed into a `.wgba` and run in
webGBA (Windows app and web version).

> Chapter 7 (multiplayer) is still a draft, and the current webGBA does not connect players yet. All other chapters describe what the current webGBA does.
> Wherever this document says "the current webGBA", it describes the app's behaviour, not a rule of the spec (other hosts may differ).

Terms used in this document:

| Term | Meaning |
| --- | --- |
| chunk | One piece of data listed in the table of contents (manifest, cartridge art, JS, code, data, ROM) |
| host | webGBA, the program that opens the file |
| manifest | The JSON description of the game (chunk `manifest`) |
| table of contents (TOC) | The first section `webgba.toc`, which lists every chunk |
| frame | The isolated iframe a runtime "script" game runs in |
| quick slot | Save state (save and restore the whole running moment) |
| cartridge | The game cartridge drawn on the web version's library shelf: label, front and spine |
| build id | A hash of the game content (code, ROM, data), computed by the host |

## Contents
1. [Overview](#1-overview)
2. [File layout](#2-file-layout)
3. [Manifest](#3-manifest)
4. [Runtimes](#4-runtimes) — ① Web API (no JS) · ② own JS (isolated)
5. [Key mapping](#5-key-mapping)
6. [Cartridge art](#6-cartridge-art) — label · front · spine
7. [Multiplayer](#7-multiplayer) (draft)
8. [Security rules](#8-security-rules)
9. [Making one](#9-making-one)
10. [Validation](#10-validation)
11. [Format numbers and versions](#11-format-numbers-and-versions)
12. [Prompt for AI assistants](#12-prompt-for-ai-assistants)

---

## 1. Overview

| You want to… | Pick this runtime |
| --- | --- |
| Ship a game written in C, C++, Rust … as one wasm with no JS (webGBA handles screen, sound, input and saves) | **① Web API** (`runtime: "webapi"`) |
| Ship a wasm game that **has its own JS** (emscripten glue, hand-written JS) | **② Own JS** (`runtime: "script"`) — the JS runs only inside an isolated frame |

- One `.wgba` holds everything the game needs, so it opens with no other files next to it.
- Because the file is plain wasm, it passes `WebAssembly.validate()` and can be inspected with wasm tools (`wasm-objdump -h`, …).
- Quickest way to try: pack the example `docs/wgba/examples/hello-webapi/` with the two commands in [9.1](#91-pack-the-example) and open it in webGBA.
- **Only include ROMs and game data you have the rights to.** Do not distribute `.wgba` files that contain other people's ROMs, art or music. webGBA does not ship any ROM.

---

## 2. File layout

```text
 offset 0 ┌────────────────────────────────────────────────────────┐
          │ wasm header, 8 bytes   00 61 73 6D 01 00 00 00          │
        8 ├────────────────────────────────────────────────────────┤
          │ section webgba.toc         TOC (first, required)        │
          │ section webgba.manifest    manifest JSON (required)     │
          │ section webgba.cart.label  cartridge label (optional)   │
          │ section webgba.cart.front  cartridge front (optional)   │
          │ section webgba.cart.spine  cartridge spine (optional)   │
          │ section webgba.js          game JS (② only)             │
          ├────────────────────────────────────────────────────────┤ ← chunk "code" starts
          │ the original wasm sections (type, import, …, code, data)│
          │ (also original custom sections: name, producers, …)    │
          ├────────────────────────────────────────────────────────┤ ← chunk "code" ends
          │ section webgba.data.<name> data (optional, several)     │
          │ section webgba.rom         ROM (optional, last if any)  │
          └────────────────────────────────────────────────────────┘
```

- The front part (TOC, manifest, cartridge art) is small, so **a library list reads only the first few KB** of each file. Large data and the ROM go at the back.
- The host cuts out only the chunk "code" range (and puts the 8-byte wasm header in front of it) to compile. ROM and art therefore never enter the wasm engine's memory.
- A wasm custom section is `00` + section size (LEB128) + name length (LEB128) + name (UTF-8) + content. wasm engines ignore these sections.

### 2.1 Table of contents `webgba.toc`

It must be **the first section of the file** (offset 8). The content is little endian and fixed size.

| Offset | Size | Content |
| --- | --- | --- |
| 0 | 4 | `WGTC` |
| 4 | 1 | TOC major version `1` (an unknown value means "do not open") |
| 5 | 1 | TOC minor version `0` (a higher value still opens) |
| 6 | 2 | Header size `16` (readers skip this many bytes) |
| 8 | 2 | Entry size `80` (readers step by this many bytes) |
| 10 | 2 | Number of entries (256 or fewer) |
| 12 | 4 | Total file length (detects truncated or appended files) |
| 16 | 80×n | Entries (in file order) |

One entry (80 bytes):

| Offset | Size | Content |
| --- | --- | --- |
| 0 | 32 | Chunk name (ASCII, zero padded). Rule `[a-z0-9][a-z0-9._-]{0,31}` |
| 32 | 4 | **Start** offset — from the start of the file, first byte of the chunk content |
| 36 | 4 | **End** offset — one past the last content byte (end − start = stored length) |
| 40 | 4 | Unpacked size (equals the stored length for method 0) |
| 44 | 1 | Method: `0` stored, `1` zlib (RFC 1950) |
| 45 | 1 | Kind: `0` code · `1` manifest · `2` cart (cartridge art) · `3` js · `4` rom · `5` data |
| 46 | 2 | Flags: bit 0 = required (a host that does not know this kind must not open the file). Other bits 0. The pack tool sets 1 on manifest, code, js and rom, 0 on cart and data |
| 48 | 32 | SHA-256 of the stored bytes (start to end) |

- Names and sections: chunk `manifest` is the content of section `webgba.manifest`, `data.levels` is `webgba.data.levels`: **section name = `webgba.` + chunk name**. The start offset is the first byte of that section's content (after the name).
- Only chunk `code` is not a section but **the run of original wasm sections** (from the id byte of the first original section to the end of the last one). No `webgba.*` section may sit inside this range.
- One each: `manifest` and `code` (exactly one), `cart.label`, `cart.front`, `cart.spine`, `js`, `rom` (at most one). Up to 64 `data.*` chunks, with at most 27 characters after `data.`.
- Order: TOC → `manifest`·`cart.*`·`js` → `code` → `data.*` → `rom`.
- `webgba.*` sections not listed in the TOC are ignored (validation warning).
- If `rom` is present it must be **the last section of the file** (so the result stays byte-identical with older tools that strip and re-append the ROM section).
- The TOC's own length depends only on the number of entries, so a packer can compute it first and then assign offsets in order (no iteration).

### 2.2 ROM chunk `webgba.rom`

The ROM for a ① game (large data the host places in game memory). Its TOC method is `0` (stored) and its content is the header below + the ROM.
(This format predates the TOC and is kept as is.)

| Offset | Size | Content |
| --- | --- | --- |
| 0 | 4 | `WGRM` |
| 4 | 2 | Header size `36` |
| 6 | 1 | Format `1` |
| 7 | 1 | `0` stored · `1` zlib |
| 8 | 4 | ROM size (32MB or less) |
| 12 | 4 | Packed size |
| 16 | 20 | ROM SHA-1 |
| 36 | … | Packed ROM |

### 2.3 Size limits

| What | Limit | If exceeded |
| --- | --- | --- |
| Whole file | 512MB (64MB or less recommended for phones) | Not opened |
| Manifest | 64KB (unpacked) | Not opened |
| Cartridge art (each) | 256KB (64KB or less recommended) | That picture falls back to the default look |
| JS | 16MB (unpacked) | Not packed |
| ROM | 32MB (unpacked) | Not opened |
| Save | ① `Web_GetSaveSize` (128KB if absent) · ② `save.maxSize` (default 1MB, up to 16MB) | Not saved |

When unpacking, the host stops as soon as the output exceeds the TOC's "unpacked size" (zip-bomb protection).

---

## 3. Manifest

Chunk `manifest` is one UTF-8 JSON object (no BOM, 64KB or less). Field names are lowerCamelCase.
**Unknown fields are ignored.** Fields starting with `x-` are free for the author to use (hosts never read them).
JSON schema for validation: [wgba-manifest.schema.json](wgba-manifest.schema.json).

### 3.1 Required fields

| Field | Type | Meaning |
| --- | --- | --- |
| `wgba` | integer | Manifest spec number. Currently `1` |
| `id` | string | **Game id — never changes.** Lowercase reverse domain (`io.github.someone.mygame`), at least one dot, 64 characters or fewer. The web version keys saves and quick slots by this id, the Windows app keys per-game key settings by it (the Windows app keeps saves in `<name>.sav` next to the opened file). Keep the same id in new versions |
| `version` | string | **Game version**, semantic version `x.y.z` (e.g. `1.2.0`; pre-releases like `1.3.0-beta.1` are fine; `+` build metadata is not accepted). Raise it when the content changes |
| `name` | string or object | Game name (48 characters or fewer). Per language as `{"en": "…", "ko": "…", "ja": "…"}` also works. Hosts pick the user's language → `en` → the first value |
| `runtime` | string | `"webapi"` (①) or `"script"` (②) |

### 3.2 Optional fields

| Field | Type · default | Meaning |
| --- | --- | --- |
| `shortName` | string · object | Name on the cartridge spine, and on the label when there is no label picture (16 characters or fewer recommended). Defaults to `name` |
| `description` | string · object | Description (500 characters or fewer) |
| `author` | string | Author. Shown on the info screen |
| `license` · `homepage` · `contact` | string | License (an SPDX name such as `MIT` is recommended), an `https://` address (anything else is an error), contact. Reserved for the info screen (the current webGBA does not show them) |
| `build` | string | Build label (commit etc., 64 characters). Text for people only; the build id (3.4) is computed by the host separately |
| `needs` | string array | Hosts without the feature **do not open** the game: `"pointer"` (unplayable without a mouse), `"net"` (unplayable without multiplayer), `"keyboard"` (needs a real keyboard), `"state"`. An unknown word means "not opened — a newer webGBA is required". The current webGBA has no `net`, so it does not open games with `needs: ["net"]` |
| `screen` | object | `width`·`height` (1–1024, default 240·160), `scale` `"fit"` (default, fill while keeping the aspect ratio) · `"integer"` (integer scaling preferred — the webGBA user setting comes first: integer scale only when the setting is "Integer scale"; with "Fit to area" the game is fitted even with this value). `fps` is reserved (the current webGBA always runs at GBA speed, about 59.7275 fps). Pixels are always drawn nearest-neighbour |
| `audio` | object | `use` — reserved (the current webGBA ignores it). A ① game makes sound when it has the audio exports |
| `save` | object | `kind`: `"flash"` (① — the current webGBA ignores `kind` for ① and saves when `Web_GetFlash` exists) · `"storage"` (② default, `webgba.save`) · `"localStorage"` (②, the frame's whole substitute localStorage is the save) · `"files"` (②, emscripten file `files[0]`) · `"none"`. `maxSize` (②, bytes, default 1MB, up to 16MB), `files` (② with `"files"`: array of paths — the current webGBA uses only the first) |
| `state` | object | `use` — reserved. The current webGBA turns quick slots on for ① when all state exports (4.1.1) exist, and for ② when the game calls both `webgba.state.onSave` and `onLoad` |
| `pointer` | object | `use`: the game uses mouse/touch coordinates. For ① this is decided by the `Web_Pointer` export; for ②, `true` blocks the right-click menu on the canvas |
| `input` | object | Button list and default layout. [Chapter 5](#5-key-mapping). Absent: ① means `{"preset": "gba"}`, ② means no buttons |
| `cart` | object | Cartridge: `color` `"#RRGGBB"` (body colour), pictures `label`·`front`·`spine` (`{chunk, format, width, height}` + front `labelAt`, spine `textArea`). [Chapter 6](#6-cartridge-art) |
| `rom` | object | ①: `required` (default true — **if there is no ROM chunk and this is not `false`, the host asks the user to pick a ROM file. Games that run without a ROM must set `false`**). `sha1` and `hint` are reserved (currently a mismatching `sha1` only gives a validation warning) |
| `entry` | object | Required for ②: `style` `"module"`·`"emscripten"`, `js` chunk name (always `"js"` in spec 1 — leaving it out also means `"js"`; any other value gets a `check` warning and is ignored), `args` (emscripten `arguments`) |
| `files` | object | ② only: file name the game JS asks for → chunk name (`data.<name>` or `rom`). E.g. `{"game.data": "data.game"}` |
| `multiplayer` | object | [Chapter 7](#7-multiplayer) (draft) |

### 3.3 Example (① 240×160 game without a ROM)

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

(The pack tool fills `chunk`, `format`, `width` and `height` of `cart.*` from the pictures, so when writing by hand you only need `labelAt`, `textArea` and `color`.)

### 3.4 Version, format numbers and build — three separate things

| Value | Where | Who raises it | Used for |
| --- | --- | --- | --- |
| Spec number `wgba`, TOC format numbers | Manifest, TOC | Only when this spec changes | Whether the host **can read the file** |
| Game version `version` | Manifest | The author (when content changes) | Shown to people; decides **whether a re-imported id is an update** |
| Build id | SHA-256 over the SHA-256 of the TOC's `code`·`rom`·`data.*` chunks (computed by the host; manifest, cartridge art and JS excluded) | Automatically when packing | Whether the **game content is byte-identical** (not imported again if the same; multiplayer `compat: "exact"`) |

What the current webGBA does:
- The info screen shows name, `version`, id, author and the first 8 characters of the build id; the web version's library shows the version like "v1.2.0".
- **The same id is the same game.** When an id already in the web version's library is imported again:
  - Same build → "already there" (opens it as is)
  - Higher version, or same version with a different build → **updates without asking** (one-line notice "1.1.0 → 1.2.0"). Saves and quick slots carry over through the id.
  - Lower version → warns and asks (default "No")
  - There is no option to keep both. A different game must use a different id.
- The Windows app opens the file on disk as it is, so it never asks and just shows the version.
- (Web version) Saves and quick slots made with an older `.wgba` that had no TOC move to the new id once, the first time a new file whose ROM chunk has the same SHA-1 is imported.

---

## 4. Runtimes

### 4.1 ① Web API — `runtime: "webapi"` (no JS)

The host runs the wasm directly and handles screen, sound, input and saves. The wasm **exports** the names below and imports only what is listed in 4.1.2.
A game of this kind therefore cannot touch any other host feature (files, storage, network).

#### 4.1.1 Exports

| Export | Required | Meaning |
| --- | --- | --- |
| `memory` | ● | Linear memory |
| `Web_Init()` → i32 | ● | Called once after the ROM and save are placed. 0 means failure |
| `Web_RunFrame(keys)` → i32 | ● | Runs one frame. `keys` = bits of the pressed buttons (chapter 5). 0 means the game stopped |
| `Web_GetFramebuffer()` → i32 | ● | Screen address. `screen.width × height` pixels, 4 bytes R·G·B·A each (memory order) |
| `Web_SetAudioRate(rate)` · `Web_GetAudioBuffer()` · `Web_GetAudioCount()` | | Host tells the sample rate / this frame's sound (float32 stereo interleaved) address and sample count (one left+right pair = 1) |
| `Web_GetFlash()` · `Web_GetSaveSize()` · `Web_SetSaveSize(n)` · `Web_FlashClear()` · `Web_TakeFlashDirty()` | | Save buffer address / size (128KB if absent) / tells the loaded size / clear / whether the game wrote its save (1 → the host saves about 1 second later) |
| `Web_RomBuffer(size)` → i32 | | Address to place the ROM (recommended). Without it the ROM goes to 0x08000000 (memory must be that large) |
| `Web_Reset()` | | Restart. Without it the host creates a new instance |
| `Web_StateSize()` · `Web_StateSave(at)` · `Web_StateLoad(at)` · `Web_Alloc(n)` · `Web_Free(at)` · `Web_StateUsed()` | | Quick slots (save states). Enabled only when the first five all exist. With `Web_StateUsed`, only the used length is kept (zero-filled on load) |
| `Web_Pointer(x, y, buttons, wheel)` · `Web_PointerWanted()` | | Mouse: game pixel coordinates (-1 when outside), `MouseEvent.buttons`, wheel steps / 1 when the game wants the mouse now |
| `Web_GetHaltReason()` · `Web_GetTitle()` · `Web_SetTimeZone(sec)` | | Address of the stop reason text (NUL terminated) / title / local time offset (seconds east of UTC) |
| `Web_Net*` | | Multiplayer — [chapter 7](#7-multiplayer) (draft) |

#### 4.1.2 Imports (provided by the host)

- `env`: `emscripten_asm_const_int` (returns 0), `emscripten_resize_heap`, `_emscripten_throw_longjmp`, `emscripten_date_now`, `emscripten_get_now`, `emscripten_notify_memory_growth`, `abort`, `_abort_js`, `invoke_*` (emscripten-style setjmp/exceptions)
- `wasi_snapshot_preview1`: `fd_write` (to the log only), `fd_read`·`fd_close`·`fd_seek`·`fd_sync`·`fd_fdstat_get` (error codes), `environ_get`·`environ_sizes_get` (none), `clock_time_get`, `random_get`, `proc_exit`
- `webgba.v1`: a function `() → ()` that does nothing. Older webGBA versions that do not know this spec refuse it as an unknown import. So **① games that are not 240×160 with GBA buttons, and ① games that run without a ROM (`rom.required: false`), should import it** (so older webGBA does not run them with a broken screen or ask for a ROM they do not need).
- Any other import means the host will not open the file as ① (make it ② instead).

#### 4.1.3 Sequence

1. Compile (chunk `code`) → instantiate → call `__wasm_call_ctors` (or else `_initialize`) if present → `Web_SetTimeZone`.
2. If there is a ROM chunk, unpack it and check the SHA-1 → write it at `Web_RomBuffer(size)`. If there is none and `rom.required` is not `false`, ask the user to pick a ROM file.
3. If there is a save, `Web_FlashClear` then write it at `Web_GetFlash` → `Web_SetSaveSize`.
4. `Web_Init()` → then every frame (GBA speed, about 59.7275 fps) `Web_RunFrame(keys)` → take the screen and sound.
5. **After `Web_Init`, do not grow memory a lot inside `Web_RunFrame`** (the host's screen address would go stale).

### 4.2 ② Own JS — `runtime: "script"` (isolated)

The game JS (chunk `js`) runs only inside an **isolated frame** made by the host. The frame is `<iframe sandbox="allow-scripts" srcdoc="…">`
and has no origin (`"null"`). The host writes the frame document itself, so there is no address to load (it also works in an installed web app and offline).
The frame contains one canvas (`#canvas`, `screen.width × height`) and the `webgba` object.

#### 4.2.1 What works and what does not inside the frame

| Works | Does not work (the host does it instead) |
| --- | --- |
| wasm compile and run, canvas 2D·WebGL, `requestAnimationFrame` | Network (fetch, XHR, WebSocket, image URLs, forms — blocked by CSP; WebRTC is removed by the frame script before the game starts). Multiplayer goes through `webgba.net` (chapter 7) |
| Key input — the host turns the user's layout into the game's `code` and dispatches `keydown`·`keyup` (made by the frame, so `isTrusted` is false), pointer events on the canvas | IndexedDB, cookies, real localStorage (blocked: no origin) → `webgba.save`. `localStorage`·`sessionStorage` are replaced with in-memory versions, and with `save.kind: "localStorage"` the host stores their content as the save |
| `AudioContext`·AudioWorklet. The host also controls volume and pause of any `AudioContext` the game creates. When sound is locked, a "tap to start" cover appears over the frame | Gamepad API (the host reads it and sends keys), fullscreen (host button), popups·`alert`·navigating away (the host removes the frame and stops the game) |
| `blob:` Workers, scripts and images | Threads (SharedArrayBuffer·pthreads) — not accepted in spec 1 |

Safari (WebKit) limits screen updates of a frame the user has not tapped yet to 30Hz. When the frame runs below 40 fps for more than 2 seconds it shows the same "tap to start" cover.

#### 4.2.2 The `webgba` object (frame API 1)

| Name | Meaning |
| --- | --- |
| `webgba.version` | `1` |
| `webgba.manifest` · `webgba.lang` · `webgba.canvas` | The manifest (frozen copy, read only) · user language (`en` etc.) · the canvas |
| `webgba.wasm()` → `Promise<ArrayBuffer>` · `webgba.wasmModule()` → `Promise<WebAssembly.Module>` | Chunk `code` (wasm with header) |
| `webgba.chunk(name)` → `Promise<Uint8Array>` · `webgba.chunkURL(name)` → `Promise<string>` (`blob:` address) | Data chunks (`data.*`; `rom` gives the unpacked ROM). Other names are errors |
| `webgba.save.read()` → `Promise<Uint8Array \| null>` · `webgba.save.write(bytes)` | This game's save (up to `save.maxSize`). Only when `save.kind` is `"storage"` (otherwise `read` gives null and `write` throws) |
| `webgba.state.onSave(fn)` · `webgba.state.onLoad(fn)` | Quick slots: `fn()` returns a `Uint8Array` (up to 64MB) / `fn(bytes)` returns `true`·`false`. Both must be set for quick slots to turn on |
| `webgba.input.held` · `webgba.on("button", fn)` | If you prefer button-level input: the set of button ids held now (`has`, `size`, iterable) / `{id, down}` |
| `webgba.on("pause"·"resume"·"speed", fn)` | Pause, resume, fast-forward factor (the game may follow or ignore them). While paused the frame holds back `requestAnimationFrame`. `on` returns a function that removes the listener |
| `webgba.audioContext()` | A shared `AudioContext` whose volume and pause the frame controls (recommended) |
| `webgba.ready()` · `webgba.exit(reason)` · `webgba.log(level, text)` | Start-up finished (the host hides the loading screen — shown anyway after 10 seconds) · stop · log |
| `webgba.net` | Multiplayer — [chapter 7](#7-multiplayer). `null` in the current webGBA |

#### 4.2.3 Start styles `entry.style`

- `"module"`: chunk `js` is an ES module. Its **default export function** is called with `webgba`.

  ```js
  export default async function start(webgba) {
    const { instance } = await WebAssembly.instantiate(await webgba.wasm(), {});
    const ctx = webgba.canvas.getContext("2d");
    // … game loop (requestAnimationFrame)
    webgba.ready();
  }
  ```

- `"emscripten"`: glue `.js` made by emscripten (plain glue, `-sMODULARIZE` factory and `-sEXPORT_ES6` all work). The frame passes a `Module` with:
  `canvas`, `wasmBinary` (chunk `code`), `locateFile` (files from the `files` table as `blob:` addresses — matched by full path or file name), `arguments` (`entry.args`), `print`·`printErr` (log),
  `preRun` (with `save.kind: "files"`, places the save at path `save.files[0]` — `FS` must be exported), `onRuntimeInitialized` (calls `webgba.ready()` for you and checks that file every second, saving it when it changes), `onAbort` (stop).
  Recommended build: `-sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS`. A `.data` file made with `--preload-file` just goes into the `files` table (the frame serves it as a `blob:` address). Do not use pthreads or IDBFS.

---

## 5. Key mapping

A game lists only **the buttons it uses** in the manifest. Where they go on the real keyboard, gamepad and touch screen is decided by the host from each button's role.

### 5.1 `input`

| Field | Meaning |
| --- | --- |
| `preset` | `"gba"`: the 10 GBA buttons below as they are (① default). `"none"`: no buttons (② default) |
| `buttons` | Button array (up to 32 for ①, 24 for ②). With a `preset`, these are appended after the preset (the same `id` replaces the preset button). **If a ① game uses buttons other than the GBA ones, write `"preset": "none"` and list every button** — the ① default is `"gba"`, so leaving it out appends your buttons after the 10 GBA buttons and bits and roles collide (validation error) |
| `keyboard` | `"mapped"` (default): the game receives only the listed buttons. `"raw"` (② only): real keys are passed through (text-entry games etc.; host keys excluded) |

One button:

| Field | Meaning |
| --- | --- |
| `id` | Button name (`A`, `JUMP` …; letters, digits, `_`, `-`, 16 characters; unique) |
| `role` | Position: `up` `down` `left` `right` · face `a` `b` `c` `d` (at most 4) · `l` `r` `l2` `r2` · `start` `select` · `extra`. Decides the default key, gamepad button and touch position. Except `extra`, one button per role |
| `label` | Text shown on screen (string or per language; 6 characters or fewer recommended, up to 8). Defaults to `id` |
| `bit` | **Required for ①**: bit number 0–31 in `Web_RunFrame(keys)` (pressed = 1) |
| `code` | **Required for ②**: the `KeyboardEvent.code` the game JS listens for (e.g. `"Space"`, `"KeyZ"`). The host also fills in `key`·`keyCode` |
| `keys` | Default keyboard keys (up to 4 `KeyboardEvent.code` values). Defaults to the role's keys |
| `pad` | Default gamepad buttons (standard-mapping button numbers 0–31; axes as `"-axis0"`, `"+axis1"`). Defaults to the role's buttons |
| `touch` | `"auto"` (default) or `"hide"` (no touch button) |

### 5.2 `role` defaults

| role | Default keys | Gamepad (standard) | Touch position |
| --- | --- | --- | --- |
| `up` `down` `left` `right` | Arrow keys | 12·13·14·15, left stick | Left direction pad (stick or cross is a user setting) |
| `a` | `KeyZ` `KeyK` | 0 | Right face |
| `b` | `KeyX` `KeyJ` | 1 | Right face |
| `c` · `d` | `KeyC` `KeyI` · `KeyV` `KeyU` | 2 · 3 | Face **row right above A·B** (5.4, only when the game defines them) |
| `l` · `r` | `KeyA` · `KeyS` | 4(·6) · 5(·7) | Top left · top right |
| `l2` · `r2` | `KeyQ` · `KeyW` | 6 · 7 | None (keyboard and gamepad only) |
| `start` | `Enter` `NumpadEnter` | 9 | Bottom centre |
| `select` | `Backspace` `ShiftRight` | 8 | Bottom centre |
| `extra` | None (the user sets it) | None | None |

- If `l2`·`r2` exist, `l`·`r` use only gamepad buttons 4·5.
- Roles that match a GBA button (`a` `b` `select` `start`, directions, `l` `r`) follow the GBA keys the user set in the app (the table shows the initial values).
- A key goes to one button only (whichever was assigned first). In the Windows app, Settings › Keys shows just that game's buttons and remembers changes per game id.

### 5.3 GBA default layout `preset: "gba"`

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

### 5.4 Face buttons A–D

There are at most 4 face buttons, roles `a` `b` `c` `d`. **Touch C·D buttons appear only for games whose manifest defines buttons with role `c`·`d`.**

- **Games that use C·D** define buttons with role `c`·`d`. Such a button sends its `bit` (①) or its `code` (②). Defining only one (`c`) is fine.

  ```json
  "input": { "preset": "gba", "buttons": [
    { "id": "C", "role": "c", "bit": 10, "label": "C" },
    { "id": "D", "role": "d", "bit": 11, "label": "D" }
  ] }
  ```

- **Games that do not define C·D** (games with only `preset: "gba"`, older `.wgba`·`.wasm` without a manifest, `.gba`): the touch screen shows **only A·B**. The host never adds C·D on its own.
- **Layout**: C·D sit in **one row right above A·B**, with the same size, spacing and shape as A·B (portrait and landscape). C above A, D above B (with only `c`, a single C above A).
- **Narrow portrait screens** (width 320, 360, …): if there is not enough room for the C·D row, the host **keeps the game screen size** and re-fits the button scale (integer) and arrangement instead (button art is drawn only at integer scale, never smoothed).
- Keyboard and gamepad always work for every defined button. Touch shows only buttons whose role has a touch position (5.2).

### 5.5 Host keys

Keys the host uses before the game. Do not put them in a game's default keys (`keys`) (`check` warns about `Space`, `Tab`, `Escape`, `Pause`, `KeyP`, `F1`–`F12`).

| Key | What it does |
| --- | --- |
| `Space` (the user can change it) | Fast-forward while held |
| `Tab` | Toggle fast-forward |
| `Pause` (also `P` on the web version) | Pause |
| `F1`–`F9`, `Shift+F1`–`F9` (Windows app) | Load / save quick slots. The Windows app reserves all of `F1`–`F12` |
| `Ctrl`·`Alt`·`Meta` combinations | App shortcuts |

The `code` a game listens for can be anything (the host translates). How simultaneous opposite directions are handled (latest only / latest of the opposite pair / all) is a user setting applied to the `up`·`down`·`left`·`right` roles.

### 5.6 Example for ②

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

When the user presses `Z` (default `a` = `KeyZ`), the game receives a key event with `code: "Space"`, `key: " "`, `keyCode: 32`. The touch screen shows a direction pad + "Jump" + "MENU" at the bottom centre.

---

## 6. Cartridge art

The library of the webGBA web version shows one cartridge per game on a shelf. On the shelf you see the **spine**;
picking it pulls it out and shows the **front + label**. A `.wgba` may contain three pictures (all optional); for missing ones webGBA draws a default look from `cart.color`.

| Picture | Chunk | Grid (width×height) | What |
| --- | --- | --- | --- |
| Label | `cart.label` | 48×32 (3:2) | Only the picture inside the front's label window |
| Front | `cart.front` | 54×44 | The whole cartridge front (body, label window background, grooves …). Transparent outside the body |
| Spine | `cart.spine` | 12×44 | The side seen on the shelf. Transparent outside |

| Item | Rule |
| --- | --- |
| Size | Grid × k, k from 1 to 4. **All three pictures use the same k.** Recommended k = 2: label **96×64** · front **108×88** · spine **24×88** |
| Format | PNG (recommended, palette PNG fine) or **lossless** WebP. No JPEG, GIF or SVG |
| Transparency | Allowed. Transparent parts of the label show the front picture (or the default label background) |
| File size | 64KB or less each recommended (over 256KB the picture is not used) |
| Drawing | Hosts draw only nearest-neighbour at integer scale (never shrink or smooth). Drawing at grid size and saving at 2× is recommended |
| Label position | `cart.front.labelAt: [x, y]` — top-left of the label inside the front picture (front picture pixels). Default `[3k, 5k]`. The label (48k×32k) must fit inside the front |
| Spine name area | `cart.spine.textArea: [x, y, width, height]` — spine picture pixels. The host writes `shortName` (or `name`) here vertically. Absent means no text (the name is painted on the spine picture) |

```json
"cart": {
  "color": "#3a6ea5",
  "label": { "chunk": "cart.label", "format": "png", "width": 96, "height": 64 },
  "front": { "chunk": "cart.front", "format": "png", "width": 108, "height": 88, "labelAt": [6, 10] },
  "spine": { "chunk": "cart.spine", "format": "png", "width": 24, "height": 88, "textArea": [4, 10, 16, 64] }
}
```

The pack tool fills `chunk`, `format`, `width` and `height` from the pictures (when writing by hand, match the pictures). `color` is the body colour (optional) and is used to shade the default front and spine.

Missing pictures (sizes or formats outside the rules, broken pictures, or a different k all count as "missing" — no error dialog):
- No front → default front (`cart.color` body + label window, label position `[3k, 5k]`)
- No spine → default spine (`cart.color` body + `shortName`·`name` on the name strip)
- No label → `shortName` (or `name`) written as text in the label position
- No `cart.color` → theme colour

- **Do not include trademarks**: other companies' names or logos (console makers, console names or logos …), copies of real cartridges or box art, or characters you have no rights to. Draw the front and spine body in your own shape too — do not copy the shape, grooves or contacts of a real console cartridge. Only include pictures you made or have the right to use.

---

## 7. Multiplayer

> Multiplayer protocol 1 (draft). **The current webGBA does not connect players yet**: it does not open games with `needs: ["net"]`, never calls `Web_NetHost`, and `webgba.net` is `null`.
> Games should simply hide their link menus in that case (7.8). The rest of this chapter is the planned protocol and may change.

### 7.1 Overview

webGBA connects devices on the same Wi-Fi (same router). The connection is direct between devices (WebRTC data channels), and game data never passes through a server. By default devices on other networks are not connected.

The game only says "I need a link partner now" and handles the bytes it sends and receives. Creating and joining rooms, finding nearby devices, connecting and handling drop-outs are done by webGBA. ② game JS cannot use the network directly (chapter 8), so it always goes this way.

- One session = one room, 2–8 players. The device that made the room is **seat 0 (host)**, the others get 1, 2, … in joining order.
- Messages are reliable (never lost) and ordered per sender. One message is up to 16384 bytes.
- Sending to `TO_ORDERED` makes everyone, including you, receive messages **in the same order** (the room host orders them).
- Only the same game (or the same compatibility key) can connect.
- Only games that cannot be played at all without multiplayer write `needs: ["net"]`.

### 7.2 Manifest field `multiplayer`

Absent means the game does not use multiplayer (a ① game with the exports but no `multiplayer` uses the defaults below).

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `protocol` | integer | yes | — | Multiplayer protocol number. Currently `1` |
| `players` | `{ "min": integer, "max": integer }` | no | `{2, 2}` | Player count the game accepts (2–8) |
| `purposes` | array | no | one, named "Link" | The situations in which the game looks for partners. Array order = number (from 1) |
| `purposes[].id` | string (lowercase letters, digits, `-`, up to 32) | yes | — | Stable name. Different purposes never connect to each other |
| `purposes[].name` | name per language | yes | — | Name shown in the dialog (e.g. Trade, Battle) |
| `purposes[].players` | `[min, max]` | no | `players` | Player count for this purpose |
| `compat` | string | no | `"exact"` | Who you can play with. `"exact"` = same `id` + same build id (3.4) (files that differ only in manifest or cartridge art can connect). Any other string = games with the same `id` and the same string (e.g. several versions with the same link rules) |
| `sync` | `"messages"` \| `"inputs"` | no | `"messages"` | `"inputs"` = the host lines up everyone's keys every frame (7.6, optional feature) |
| `inputDelay` | integer | no | `3` | With `sync: "inputs"`, how many frames later keys take effect (1–10) |

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

Unknown keys are ignored. If `multiplayer.protocol` is higher than the host knows, the host turns multiplayer off and runs the game as usual.

### 7.3 ① Web API — exported functions

All are **functions the game exports** and the host calls (no new imports → the game still opens on hosts that do not know multiplayer).
The game counts as supporting multiplayer only when all seven exist: `Web_NetWanted`, `Web_NetEvent`, `Web_NetOut`, `Web_NetOutLen`, `Web_NetOutClear`, `Web_NetInBuffer`, `Web_NetIn`. Pointers are addresses in wasm memory, all values little endian.

| Function | Shape | Called | Meaning |
|---|---|---|---|
| `Web_NetHost` | `(u32 protocol, u32 flags)` | Once after `Web_Init` | The host supports multiplayer protocol `protocol`. `flags` bit 0 = ordered broadcast available, bit 1 = `sync: "inputs"` available. **Not called means the host has no link** → the game should hide menus like "Play with friends". Optional |
| `Web_NetWanted` | `() → u32` | Every frame after `Web_RunFrame` | 0 = no link needed. Non-zero = a request (7.3.1) |
| `Web_NetEvent` | `(u32 kind, u32 a, u32 b)` | When something happens, between frames | Event (7.3.3) |
| `Web_NetOut` | `() → ptr` | Every frame after `Web_RunFrame` | Where the records to send are (7.3.2) |
| `Web_NetOutLen` | `() → u32` | Same | Byte length of the records to send (0 = none) |
| `Web_NetOutClear` | `()` | After reading all records | Empties the send area |
| `Web_NetInBuffer` | `(u32 len) → ptr` | For each received message, before `Web_RunFrame` | Where to write `len` bytes. **0 = no room right now** → the host keeps the message and retries next frame (order preserved) |
| `Web_NetIn` | `(u32 from, u32 len)` | After writing the bytes there | Confirms receipt. `from` = sender seat |
| `Web_NetCompat` | `() → ptr` | Once before a session | Optional. A NUL-terminated ASCII compatibility key of up to 64 characters (e.g. a build hash). If present it is appended to the manifest `compat` and compared too |

One host frame:

```text
received messages → Web_NetInBuffer / Web_NetIn (stop and retry next frame if there is no room)
Web_RunFrame(keys)
Web_NetOut / Web_NetOutLen → send → Web_NetOutClear
Web_NetWanted → open/close the dialog, end the session (7.7)
```

#### 7.3.1 `Web_NetWanted` value

| Bits | Meaning |
|---|---|
| 0–7 | Purpose number (1-based number in the manifest's `purposes`; 0 = the first purpose) |
| 8–11 | Minimum players (0 = 2) |
| 12–15 | Maximum players (0 = same as minimum, up to 8) |
| 16–17 | Role: 0 = either (chosen in the dialog), 1 = create a room only, 2 = join only |
| 18–23 | Leave 0 (reserved) |
| 24–31 | Request number: the game adds 1 every time it looks for new partners (1 after 255). The same value means the same request |

- While a session continues the game keeps returning **the same value**. Returning 0 means "link finished" → the host sends what is left, closes the session and gives `CLOSED(LEFT)`.
- If the purpose or request number changes, the host closes the current session and treats it as a new request.

#### 7.3.2 Send record format

Records follow one another from `Web_NetOut()` for `Web_NetOutLen()` bytes. Each record:

| Bytes | Meaning |
|---|---|
| 0–1 | Content length `n` (u16, 1–16384) |
| 2 | Destination: 0–7 = that seat only, `0xFE` = **TO_ORDERED** (everyone including me, same order for all), `0xFF` = **TO_ALL** (everyone except me) |
| 3 | 0 (reserved) |
| 4~ | `n` content bytes; the next record starts at a 4-byte boundary |

- Keeping one frame's sends at 65536 bytes or less is recommended. Records queued while there is no session are dropped by the host.
- What you send to `TO_ORDERED` also comes back to you (`from` = your seat). If the game applies its own messages in the order they come back, every device stays in the same state.
- Receivers keep each sender's order. Messages from different senders are in the same order for everyone only with `TO_ORDERED`.

#### 7.3.3 Events `Web_NetEvent(kind, a, b)`

| kind | Name | a | b | Meaning |
|---|---|---|---|---|
| 1 | `OPEN` | my seat | current players | Session opened. The room host opens alone first (1 player) |
| 2 | `JOIN` | joined seat | current players | Someone joined |
| 3 | `LEAVE` | left seat | reason | Someone left (the seat is free; a newcomer may get the same number) |
| 4 | `CLOSED` | reason | 0 | Session over. Later sends are dropped |
| 5 | `STALL` | seat | 0 | Nothing heard from that player for over 1 second, or that device left the app briefly |
| 6 | `RESUME` | seat | 0 | Back again |

Reasons: 1 `CANCEL` (the user cancelled in the multiplayer dialog) · 2 `TIMEOUT` (no connection in time / did not come back after a drop) · 3 `INCOMPATIBLE` (different game, compatibility key or protocol) · 4 `LOST` (connection dropped) · 5 `FULL` (room full) · 6 `LEFT` (left normally) · 7 `HOST_LEFT` (the room host left, the room is gone) · 8 `NO_NETWORK` (no Wi-Fi, or this device cannot use the link feature)

What the game must do: on `CLOSED(CANCEL)`, treat it like a cancel inside the game and set `Web_NetWanted` to 0. A `STALL` may be brief, so do not drop at once — follow the game's own timeout. When the room host leaves (`HOST_LEFT`) the session ends (protocol 1 has no host migration).

### 7.4 ② Own JS — `webgba.net`

Use the `webgba.net` object the isolated frame provides (between frame and host the messages travel over the MessagePort; the game only uses this object). Bytes are `ArrayBuffer`·`Uint8Array`.

| Game → host | Meaning |
|---|---|
| `webgba.net.want({ purpose, min, max, role })` | Same as a non-zero ① `Web_NetWanted`. `purpose` = manifest id, `role` = `"any"`·`"make"`·`"join"`. Every call is a new request |
| `webgba.net.unwant()` | Same as ① returning 0 (link finished) |
| `webgba.net.send(to, bytes)` | `to` = seat 0–7 · `"ordered"` · `"all"`, up to 16384 bytes |

| Host → game | Meaning |
|---|---|
| `webgba.net.host` | `{ protocol, ordered, inputs }` — the ① `Web_NetHost` |
| `webgba.net.onevent = (kind, a, b) => …` | Same numbers as 7.3.3 |
| `webgba.net.onrecv = (from, bytes) => …` | A received message (in order) |

On hosts that do not know multiplayer, `webgba.net` itself is `null`.

### 7.5 Limits

| Item | Value |
|---|---|
| Players | 2–8 (seats 0–7) |
| One message | 16384 bytes |
| Sends per frame (recommended) | 65536 bytes |
| Receive order | Per sender; `TO_ORDERED` is the same order for everyone |
| Latency (same Wi-Fi) | Usually 2–20 ms round trip (1–2 frames) |

### 7.6 Optional feature: input sync (`sync: "inputs"`)

For simple ① games with no link code of their own. If the game produces the same screen for the same key input (deterministic), the host lines up everyone's keys every frame.

- Extra export: `Web_NetKeys(u32 slot, u32 keys)` — the host calls it for every other player right before `Web_RunFrame`. The `keys` of `Web_RunFrame(keys)` are your own.
- The host sends your keys for frame f to be used at f + `inputDelay`, and does not run frame f until everyone's keys for f have arrived (the screen pauses meanwhile; `STALL` after 1 second).
- Everyone starts at the same frame 0: when `OPEN`·`JOIN` fill the room, the room host sends "start", and the next frame is frame 0 for everyone.
- Fast-forward and loading states are unavailable during a session.

### 7.7 When the multiplayer dialog opens

The host opens the multiplayer dialog **once** when all of these hold:

1. The game supports multiplayer: ① the seven functions of 7.3 exist (the manifest `multiplayer`, if any, is used) / ② the manifest has `multiplayer`
2. The game asks: ① `Web_NetWanted()` changes from 0 to non-zero (or the request number changes) / ② it calls `webgba.net.want()`
3. No session is running, the game is running (not paused), and multiplayer is enabled in the user settings

It does not open:
- Again for **the same request** after the user closed (cancelled) it. Instead a "Multiplayer" button above the screen stays lit while the request lasts, so it can be reopened.
- When the game asks for nothing — then there is neither dialog nor button (the user never opens it first).

```text
┌ Multiplayer · Trade (2 players) ──────────┐
│  [ Create room ]   [ Join with code ]      │
│                                            │
│  Nearby rooms                              │
│   ● Player 4821 · Trade · 1/2     [Join]   │
│   ○ Player 7730 · other version  (dimmed)  │
│                                            │
│  Connect without internet (code·QR)  [ > ] │
│                                [ Cancel ]  │
└────────────────────────────────────────────┘
```

- Requests with a fixed role (create only, join only) start on that screen.
- When the minimum player count is reached, it shows "Connected" and closes after 1 second. Any further confirmation (e.g. "Press A to start") happens inside the game.
- Until the maximum is reached, the room host keeps a small indicator ("2/4 · waiting"); more players arrive as `JOIN`.
- Cancel → `CLOSED(CANCEL)`. Not found in time (3 minutes by default) → `CLOSED(TIMEOUT)`. If the game ends the link first, the dialog closes quietly.
- Help when connecting fails: "Check that you are on the same Wi-Fi, that it is not a guest or public Wi-Fi, and that VPN is off."

During a session the host keeps to: fast-forward and speed changes off (1×), loading states and reset blocked, opening another game = end of session (`LEFT`). Pausing or leaving the app → `STALL` to the others, `RESUME` on return, dropped (`LOST`) if not back within a set time (15 seconds by default). A small status in a screen corner (players, connection state). The nickname is a user setting; IP addresses and device names are never shown.

### 7.8 For game authors

- If the same keys and messages always give the same result (random numbers from a seed inside the game), `TO_ORDERED` alone keeps everyone in the same state.
- Messages arrive between frames, so queue them and process them inside a frame.
- If the host does not know multiplayer (`Web_NetHost` never called / `webgba.net` is `null`), hide the link menus. The current webGBA is such a host.
- By default only the same game build can connect (`compat: "exact"`). If different versions share the same link rules, put the same string in `compat`.
- Do not send ROMs or other people's works in messages.

---

## 8. Security rules

A `.wgba` is a file made by someone else. The host follows these rules (other hosts are encouraged to do the same).

**General**
- TOC offsets and lengths are not trusted: the host checks that they are inside the file, in order and not overlapping, that the section names match and that the SHA-256 matches before using them. Unpacking stops when it exceeds the "unpacked size".
- Manifest text is shown **as text only** (never inserted as HTML) and truncated. Only `https://` addresses are accepted.
- Pictures must be PNG or lossless WebP; the size is read from the header first and pictures outside the rules are not used (no SVG).
- Saves, quick slots and key settings are **separate per game**. A game is never given another game's stored data. The same id counts as the same game (3.4), so the host asks only when switching to a lower version — authors should build their id from their own domain or account name so it never collides with someone else's.

**① Web API**
- The wasm cannot reach anything outside the import list (4.1.2), so it runs inside the host. Unknown imports mean it is not opened as ①.
- Endless loops or growing memory can still freeze the screen, so the host lets the user close a stuck game.

**② Own JS — isolated frame**
- The JS runs only in a **sandbox iframe (`sandbox="allow-scripts"` only, no `allow-same-origin`)**. The frame document is given as `srcdoc`. Having no origin (`"null"`), it cannot reach the storage of the host or other games (IndexedDB, localStorage, cookies) or the host page. Popups, top-window navigation and `alert` are blocked too.
- A strict CSP is put at the very start of the frame document as `<meta http-equiv="Content-Security-Policy">`:
  `default-src 'none'; script-src 'sha256-<frame script>' blob: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob:; font-src blob: data:; connect-src blob: data:; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'`
  (Some browsers do not match `'self'` in an origin-less document, so the frame script is embedded in the document and allowed by its SHA-256. Because it is embedded there is no address to fetch, so no web server or app configuration is needed.)
- CSP does not block WebRTC, so the frame script deletes `RTCPeerConnection` before the game runs. `frame-src 'none'` blocks getting a clean copy back by creating a new frame.
- Host and frame talk only through **the single MessagePort** handed over at the start. The host accepts only known message types and sizes and never executes text from the frame as code.
- If the frame navigates by itself (a second frame `load`), the host removes the frame and stops the game.
- Windows app: WebView2 injects the app bridge script into the frame as well. Even so, the app does not accept calls from the frame (CSP blocks the app's IPC address, and the app does not listen to messages posted from the frame), and the frame script removes those channels (functions inside `__TAURI__`·`__TAURI_INTERNALS__`, `chrome.webview`, …) before the game runs.

---

## 9. Making one

### 9.1 Pack the example

Get the webGBA repository (https://github.com/flightrabbit-hash/webGBA) and, in that folder (node 18 or later, no other dependencies):

```text
node tools/wgba.mjs pack -o hello.wgba --wasm docs/wgba/examples/hello-webapi/game.wasm --manifest docs/wgba/examples/hello-webapi/manifest.json --cart-dir docs/wgba/examples/hello-webapi/cart
node tools/wgba.mjs check hello.wgba
```

Open `hello.wgba` (about 2.6KB) in webGBA and the whole screen changes colour with the buttons. The example folder `docs/wgba/examples/hello-webapi/` holds
`game.c` (source) · `game.wasm` (its build, 594 bytes) · `manifest.json` · `cart/` (label, front and spine PNG, k = 2).

### 9.2 Tool commands

```text
node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir art-folder]
                     [--label label.png] [--front front.png] [--spine spine.png] [--js game.js] [--js-store]
                     [--data levels=levels.bin …] [--data-store] [--rom game.bin]
node tools/wgba.mjs check game.wgba [--quick]             validate (chapter 10). Exit code 1 on errors. --quick does not unpack the ROM
node tools/wgba.mjs info  game.wgba                       TOC and manifest summary (reads only the front of the file)
node tools/wgba.mjs extract game.wgba cart.label label.png   extract a chunk (code → runnable wasm, rom → unpacked ROM)
node tools/wgba.mjs strip game.wgba game-norom.wgba          repack without the ROM chunk
```

- `--wasm` also accepts a `.wgba` (its `webgba.*` sections are dropped and it is packed again).
- From the `--cart-dir` folder, whichever of `label.png`, `front.png`, `spine.png` (or `.webp`) exist are included, and `chunk`, `format`, `width`, `height` of the manifest's `cart.*` are filled from the pictures. Entries for missing pictures are removed from the manifest.
- JS and data are stored with zlib (`--js-store`·`--data-store` store them as is). Manifest, cartridge art and code are always stored as is.
- The same input gives a byte-identical file on any PC (compression is pako level 9; the manifest is written from the input JSON in the same order without whitespace).
- The output file is written only after it has been read back and passed the chapter 10 checks.

### 9.3 ① The smallest C game

The core of the example `game.c` (full file in the example folder):

```c
#include <stdint.h>
static uint32_t fb[240 * 160];            // memory order R,G,B,A (little endian 0xAABBGGRR)
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

(`wasm-ld` exports `memory` by default. There is no ROM, so the manifest has `"rom": { "required": false }`, and it imports `webgba.v1` so older webGBA does not ask for a ROM.)

### 9.4 ② emscripten (SDL etc.) game

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

### 9.5 Packing without the tool

Any language works as long as the rules are followed. Steps:

1. Walk the sections of the input wasm, drop the custom sections whose name starts with `webgba.` and join the rest unchanged → the **code range**.
2. Prepare the chunk contents: manifest (UTF-8 JSON), cart.label·cart.front·cart.spine (picture bytes as they are), js (stored or zlib), data (stored or zlib), rom (WGRM header + ROM).
3. From the number of entries n, the TOC length is `16 + 80n`; compute the TOC section length (`00` + LEB size + LEB name length + `webgba.toc` + TOC).
4. Starting at offset 8 + TOC section length, in order: each `webgba.<name>` section → code range → data → rom. For each section, **start = first byte of the section content** (after the name), end = end of the section. For code, the start and end of the range.
5. Fill in the TOC (name, start, end, unpacked size, method, kind, flags, SHA-256) and the total file length.
6. Write `wasm header + TOC section + the rest`, then run `WebAssembly.validate` and the chapter 10 checks.

---

## 10. Validation

What `wgba.mjs check` looks at (check the same things when you pack by hand). Any **error** means failure; **warnings** are notices.

- The whole file passes `WebAssembly.validate`, the first section is `webgba.toc` (only one), the TOC's file length = the real length
- Entries: name rule and no duplicates, in order and inside the file, a `webgba.<name>` section at that position (code matches wasm section boundaries and contains no `webgba.*`), kind matches the name, unpacked size = stored length for method 0, SHA-256 matches, no unknown kind with the required flag, single-instance chunks appear once
- `webgba.*` sections missing from the TOC → warning
- If `rom` exists: it is last, and the WGRM header, size and SHA-1 are right (not unpacked with `--quick`); a different manifest `rom.sha1` → warning
- Manifest: JSON of 64KB or less, `wgba` 1, `id` rule, `version` is `x.y.z`, `name` (48 characters), `runtime`, no unknown `needs`, `homepage` is `https://`, values of `screen`, `save`, `input.preset`, `cart.color`, button id rule and duplicates, role duplicates, `shortName` over 16 characters → warning
- ①: the 4 required exports, no unknown imports, button `bit` within 0–31 and not shared, only some of the seven `Web_Net*` (7.3) → warning, not 240×160 with GBA buttons, or runs without a ROM (`rom.required: false`), but no `webgba.v1` → warning, a `js` chunk → warning (unused)
- Multiplayer: `multiplayer.protocol` 1, `purposes[].id` rule and no duplicates, players 2–8
- ②: a `js` chunk exists, `entry.style`, `entry.js` other than `"js"` → warning, a `code` on every button, no imported shared memory (threads)
- Cartridge art (label, front, spine): PNG or lossless WebP, 256KB limit (warning over 64KB), not grid (48×32 · 54×44 · 12×44) × k (1–4) → warning, different k between them → warning, format or size different from the manifest → warning, `labelAt`·`textArea` outside the picture → warning, listed in the manifest but no chunk → error, a chunk not listed in the manifest → warning
- Host keys (`Space`·`Tab`·`Escape`·`Pause`·`KeyP`·`F1`–`F12`) in default keys (`keys`) → warning

---

## 11. Format numbers and versions

| Number | Raised when | Readers |
| --- | --- | --- |
| TOC major (now 1) | Only when the TOC layout changes so that older hosts would misread it | Unknown → not opened, "a newer webGBA is required" |
| TOC minor (now 0) | When new chunk kinds or flags appear | Opens even if higher. Unknown kinds are ignored unless flagged required |
| Manifest `wgba` (now 1) | Only when the meaning of an existing field changes or a field is removed (new fields do not raise it) | Not opened if higher |
| `needs` | Lists "this feature is required" instead of a number | Not opened if a word is unknown |
| Frame API `webgba.version` (now 1) | Only when the meaning of an existing function changes | The game checks it |
| ROM chunk WGRM format (now 1) | When the ROM header changes | Unknown → not opened |
| Game `version` | Up to the author (when content changes) | Used only to decide updates and for display |

Older files: webGBA keeps opening `.wgba` files with no TOC or manifest (plain wasm, or with only `webgba.rom` at the end). They are treated as ① · 240×160 · GBA buttons, named after the file.

---

## 12. Prompt for AI assistants

Paste everything below into your AI assistant and tell it about your wasm game files. It will build a `.wgba` that follows this spec.

````text
You help me pack my WebAssembly game into a webGBA .wgba file (spec 1). Follow the spec below exactly; do not invent anything you do not know — ask me instead.

[Ask me first]
- The game wasm file, whether JS was built with it (emscripten glue etc.), the data files, and whether there is large data such as a ROM to place in game memory
- Game name (per language is fine), game id (lowercase reverse domain, e.g. io.github.myaccount.gamename — never changes once chosen), version (x.y.z)
- Screen size, the buttons used and what each does, whether there is a save, whether it uses the mouse
- Whether there is cartridge art (label 48×32, front 54×44, spine 12×44, all at the same scale 1–4×, PNG or lossless WebP — all optional), cartridge body colour (#RRGGBB)
- Whether I have the rights to every piece of data that goes in (if not, it does not go in)

[File layout]
- A .wgba is a valid wasm file as a whole: the 8-byte wasm header (00 61 73 6D 01 00 00 00) followed by sections. A custom section = byte 00 + section size (LEB128, counting from the name-length field to the end) + name length (LEB128) + name (UTF-8) + content.
- Order: "webgba.toc" (TOC, always the first section) → "webgba.manifest" (manifest JSON) → "webgba.cart.label" → "webgba.cart.front" → "webgba.cart.spine" (cartridge art, only those present) → "webgba.js" (runtime script only) → the original wasm sections = chunk "code" → "webgba.data.<name>" (optional, up to 64, name up to 27 characters [a-z0-9][a-z0-9._-]*) → "webgba.rom" (optional, last in the file if present).
- Chunk code = the input wasm's sections, in their original order, minus every custom section whose name starts with "webgba." (without the 8-byte header; other custom sections such as name stay).
- TOC content (little endian): "WGTC" (4) · major u8=1 · minor u8=0 · header size u16=16 · entry size u16=80 · entry count u16 · total file length u32, then the entries (in file order).
- Entry, 80 bytes: chunk name 32 bytes (ASCII, zero padded) · start u32 · end u32 · unpacked size u32 · method u8 · kind u8 · flags u16 · SHA-256 32 bytes.
  - Chunk name = section name without "webgba." (manifest, cart.label, cart.front, cart.spine, js, code, data.<name>, rom).
  - Start = file offset of the first byte of the section "content" (after the name); end = end of the section (one past the last content byte). For code, the start and end of the joined range.
  - Method: 0 stored, 1 zlib (RFC 1950). manifest, cart, code and rom use 0; js and data use 1 (or 0). Unpacked size = length after unpacking (end − start for method 0).
  - Kind: 0 code · 1 manifest · 2 cart · 3 js · 4 rom · 5 data. Flags: manifest, code, js, rom = 1 (required); cart, data = 0.
  - SHA-256 = hash of the bytes stored in the file (start to end, still compressed).
- Order of computation: entry count n → TOC length 16+80n → full TOC section length → place the chunks one after another starting at offset 8 + TOC section length, recording start and end → fill the TOC (including the total file length). No iteration needed.
- ROM chunk content (webgba.rom, method 0): "WGRM" · header size u16=36 · format u8=1 · compression u8 (0 stored, 1 zlib) · ROM size u32 (32MB or less) · packed size u32 · ROM SHA-1 20 bytes · packed ROM.
- Limits: file 512MB, manifest 64KB, each cartridge picture 256KB (64KB recommended), JS 16MB, ROM 32MB, 256 TOC entries.

[Manifest webgba.manifest — UTF-8 JSON, no BOM]
- Required: "wgba": 1, "id" (lowercase reverse domain, at least one dot, 64 characters or fewer), "version" ("x.y.z"; pre-release "-beta.1" allowed), "name" (string or {"en":…,"ko":…}, 48 characters or fewer), "runtime" ("webapi" or "script").
- Optional: shortName (16 characters), description, author, license, homepage (https:// only), contact, build, needs (from ["pointer","net","keyboard","state"]), screen{width,height (1–1024, default 240·160), scale ("fit"·"integer")}, save{kind,maxSize,files}, pointer{use}, input{preset,buttons,keyboard}, cart{color, label, front{labelAt}, spine{textArea}}, rom{required}, entry{style,js,args}, files, multiplayer. Unknown fields are ignored; if a value outside the spec is really needed, use a name starting with "x-".
- For runtime "webapi" without a ROM chunk you must write "rom": {"required": false} (otherwise webGBA asks the user to pick a ROM file).
- Write cart.label/front/spine as {"chunk":"cart.label|cart.front|cart.spine","format":"png|webp","width":…,"height":…} matching the pictures, leave out entries for pictures you do not include, and put labelAt [x,y] (default [3k,5k]) on the front and textArea [x,y,w,h] (the host writes the short name vertically there; no text if absent) on the spine.
- The current webGBA ignores screen.fps, audio and state.use (it always runs at about 59.7275 fps). It does not open games with "net" in needs.

[runtime "webapi" — no JS, the host runs the wasm directly]
- Required exports: memory, Web_Init() -> i32 (0 = failure), Web_RunFrame(keys) -> i32 (0 = stopped; keys = bits of pressed buttons), Web_GetFramebuffer() -> i32 (width×height pixels, R,G,B,A bytes each).
- Optional: Web_SetAudioRate(rate)·Web_GetAudioBuffer()·Web_GetAudioCount() (float32 stereo interleaved, count = number of left/right pairs) / Web_GetFlash()·Web_GetSaveSize()·Web_SetSaveSize(n)·Web_FlashClear()·Web_TakeFlashDirty() (save) / Web_RomBuffer(size) (where to place the ROM) / Web_Reset() / Web_StateSize()·Web_StateSave(at)·Web_StateLoad(at)·Web_Alloc(n)·Web_Free(at) (quick slots need all five; Web_StateUsed() optional) / Web_Pointer(x,y,buttons,wheel)·Web_PointerWanted() / Web_GetHaltReason()·Web_GetTitle()·Web_SetTimeZone(sec).
- Only these imports: env.{emscripten_asm_const_int, emscripten_resize_heap, _emscripten_throw_longjmp, emscripten_date_now, emscripten_get_now, emscripten_notify_memory_growth, abort, _abort_js, invoke_*}, wasi_snapshot_preview1.{fd_write, fd_read, fd_close, fd_seek, fd_sync, fd_fdstat_get, environ_get, environ_sizes_get, clock_time_get, random_get, proc_exit}, webgba.v1 (() -> (), does nothing). Any other import → make it runtime "script".
- Games that are not 240×160 with GBA buttons, or that run without a ROM, import webgba.v1 (so older webGBA refuses them). In C: __attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void); called once in Web_Init.
- Sequence: instantiate → __wasm_call_ctors (or else _initialize) → ROM → save → Web_Init → Web_RunFrame every frame. Do not grow memory a lot after Web_Init.
- Every button has a bit (0–31). If the buttons are the GBA ones, use "input": {"preset":"gba"} (A=0 B=1 SELECT=2 START=3 RIGHT=4 LEFT=5 UP=6 DOWN=7 R=8 L=9). If not, you must write "input": {"preset":"none", "buttons":[…every button…]} — the webapi preset default is "gba", so leaving preset out appends my buttons after the 10 GBA buttons and bits and roles collide (validation error). To add only a few buttons to the 10 GBA ones, use preset "gba" + the extra buttons (unused bits and roles, e.g. c=10 d=11).

[runtime "script" — games with their own JS]
- The JS runs inside an origin-less sandbox iframe (srcdoc). It cannot use the network (fetch, XHR, WebSocket, WebRTC), IndexedDB, cookies, real localStorage, popups, top-window navigation or threads (SharedArrayBuffer, pthreads). localStorage is an in-memory substitute.
- entry is required. The JS chunk is always named "js" (leave out entry.js). entry.style "module": the JS exports export default async function start(webgba){…}. "emscripten": emscripten glue (plain, MODULARIZE or EXPORT_ES6) — the frame passes Module{canvas, wasmBinary, locateFile, arguments, print, printErr, preRun, onRuntimeInitialized, onAbort}. Data files go through the files table ({"file name":"data.<name>" or "rom"}), including the .data of --preload-file. Recommended build: -sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS.
- The webgba object: version (1), manifest, lang, canvas (#canvas, screen size), wasm()→ArrayBuffer, wasmModule(), chunk(name)→Uint8Array, chunkURL(name)→blob: address, save.read()/save.write(bytes) (only with save.kind "storage"), state.onSave(fn→Uint8Array)/state.onLoad(fn(bytes)→true|false) (both needed for quick slots), input.held, on("button"|"pause"|"resume"|"speed", fn), audioContext(), ready() (call it when start-up is done), exit(reason), log(level,text), net (null for now).
- save.kind: "storage" (default, webgba.save), "localStorage" (the frame's whole localStorage is the save), "files" (path save.files[0] in emscripten FS, FS must be exported), "none". maxSize default 1MB, up to 16MB.
- Every button has a code (the KeyboardEvent.code the game listens for). The host turns the keys the user presses into keydown/keyup events with this code (isTrusted is false, so do not check it). The preset default is "none".

[Buttons]
- Button = {id (letters, digits, _, -, 16 characters), role, label, bit (webapi) or code (script), keys (default keys, up to 4 KeyboardEvent.code values), pad (gamepad button numbers, "+axis1" etc.), touch ("auto"·"hide")}. Up to 32 for webapi, 24 for script.
- role: up down left right, face a b c d (at most 4), l r l2 r2, start select, extra. Except extra, one button per role. To use C·D, define buttons with role c·d — only then do they appear in the touch row right above A·B. Without them only A·B appear.
- Default keys come from the role (a=Z·K, b=X·J, c=C·I, d=V·U, l=A, r=S, l2=Q, r2=W, start=Enter, select=Backspace·right Shift, directions=arrow keys). Do not put host keys (Space, Tab, Escape, Pause, F1–F12, P) in keys.

[Multiplayer — draft protocol; the current webGBA does not connect players]
- Manifest multiplayer{protocol:1, players{min,max}, purposes[{id,name,players}], compat, sync}. webapi exports the seven Web_NetWanted·Web_NetEvent·Web_NetOut·Web_NetOutLen·Web_NetOutClear·Web_NetInBuffer·Web_NetIn; script uses webgba.net (null for now). If the host never calls Web_NetHost or webgba.net is null, hide the link menus. Game JS never opens network connections itself.

[Steps]
1. Look at the wasm imports and exports and choose the runtime (webapi if it follows the webapi convention, otherwise script).
2. Write the manifest JSON (every required field; ask me for values you do not know).
3. Pack. If you can get the webGBA repository (https://github.com/flightrabbit-hash/webGBA), run in that folder
   node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir art-folder (label.png·front.png·spine.png)] [--js game.js] [--data name=file] [--rom rom]
   (node 18+, nothing to install; the tool fills chunk, format, width and height of cart.*). If not, write a short script (node or python) that packs by the [File layout] above: drop webgba.* sections → prepare chunks → compute the TOC length → assign offsets in order → SHA-256 → write.
4. Validate: node tools/wgba.mjs check game.wgba must report 0 errors. Without the tool, check by hand: WebAssembly.validate, first section is webgba.toc, TOC file length = real length, every entry's position, section name, kind and SHA-256, rom is last, required manifest fields and version format, for webapi the required exports, the import list and no shared bits, for script the js chunk, entry.style and button codes, cartridge picture sizes and formats.
5. Show me the file name, size, the TOC table and the validation result.

[Do not]
- Include ROMs, art, music or data I have no rights to. Put other companies' trademarks (console names, logos …) on cartridge art, or copy real cartridge shapes or box art.
- Put network requests, eval of outside code, access to the host (parent, top) or IndexedDB into game JS.
- Change the id in a new version of the same game (saves would be lost). Raise the version as x.y.z — webGBA updates a higher version of the same id without asking and warns only for a lower one. Use a different id for a different game.
- Invent fields that are not in the spec (if really needed, use a name starting with "x-").
- Build with threads (SharedArrayBuffer, pthreads).
- Run wasm-opt, strip or similar tools after packing — they can remove custom sections. Use them only before packing.
````
