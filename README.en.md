# webGBA

[한국어](README.md) · **English** · [日本語](README.ja.md)

A Windows launcher that opens GBA, GB and GBC ROMs (`.gba`, `.gb`, `.gbc`, `.zip`) and web builds (`.wasm`, `.wgba`).
It puts a WebView UI on top of Tauri 2 + Rust, and its structure follows Arbiter. The WebView runs the game
(core, keys, sound) and Rust handles files and windows. `.gba`, `.gb` and `.gbc` files run on the built-in mGBA 0.10.1 core (wasm);
`.wasm` and `.wgba` web builds run as they are, inside the app. It starts with normal user rights (`asInvoker`) —
**no administrator rights needed**.

> **No ROMs or BIOS are included.** Open ROM files that you own. The official GBA BIOS is not included either; mGBA's built-in HLE BIOS is used. GB and GBC games start from the post-boot state without a boot ROM.

**Web version:** https://webgba.vercel.app — an installable web app (PWA) for phone and PC browsers (`.gba`, `.gb`, `.gbc`, `.zip`, `.wgba`, `.wasm`, `.wgbp`).
Opened in a browser tab it shows how to install; add it to the Home screen or install it as an app, then open it from that icon to play. Files and saves you pick stay inside that browser.

---

## Contents

- [Prerequisites](#prerequisites)
- [Run and build](#run-and-build)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Repository layout](#repository-layout) · [Folder layout after deployment](#folder-layout-after-deployment)
- [License](#license)
- [.wgba specification 1 (for other developers)](#wgba-specification-1-for-other-developers) — the full spec for packing your own wasm game into a `.wgba`
- [Prompt for AI assistants](#prompt-for-ai-assistants) — paste it into an AI and it builds a `.wgba` that follows this spec

---

## Prerequisites

You need the following to **build and run** this project (Windows).

1. **Node.js** (LTS recommended) — comes with `npm`. Used to assemble the UI (`src-bundle/build-dist.cjs`) and for the Tauri CLI.
2. **Rust toolchain** — install with [rustup](https://rustup.rs) (`stable`).
3. **Microsoft C++ Build Tools** — the **"Desktop development with C++"** workload in Visual Studio Installer (MSVC linker, Windows SDK).
4. **Microsoft Edge WebView2 Runtime** — usually preinstalled on Windows 11.
   If missing, get the "Evergreen Standalone Installer" from the [Microsoft download page](https://developer.microsoft.com/microsoft-edge/webview2/).
5. **Docker** — only to rebuild the mGBA core (`emscripten/emsdk:4.0.10`).
   The prebuilt core (`src-bundle/bin/core/mgba_core.wasm`) is in the repository, so building the app does not need it.
6. **Install dependencies** — run once after cloning.

   ```bash
   npm install
   ```

> To only **use** a built app, none of the above is needed. `webgba.exe` runs as long as the WebView2 Runtime is present.

---

## Run and build

```bash
npm run dev       # debug build, then run
npm run build     # tauri build → src-tauri/target/release/webgba.exe (+ LICENSE · THIRD_PARTY_NOTICES · bin/core/ next to it)
npm start         # run the release executable
npm run dist      # reassemble only the UI assets (dist/) — dev and build run this first
npm run core      # rebuild the mGBA wasm core (Docker)
npm test          # Rust tests (cargo test --lib)
node tools/run.cjs   # list all commands
```

- Build output goes under `src-tauri/target/release/`. No installer (NSIS) is produced.
- **The mGBA source is not in this repository.** `npm run core` starts Docker `emscripten/emsdk:4.0.10` with `--rm` and a 15-minute limit and runs `core/build.sh`,
  which downloads the official 0.10.1 tag source (into `core/vendor/mgba-0.10.1`, not committed), links it unmodified,
  and copies the result (`mgba_core.wasm` + licenses) to `src-bundle/bin/core/`.
- In VS Code, open `webGBA.code-workspace` to get the same commands as Tasks.

### Deploying the web version and matchmaking server yourself (operators)

The web version (`web/dist`) and the matchmaking server (`api/v1/mp/[op].js`, one Vercel function) deploy to Vercel. Register the values directly as environment variables (Production) of the Vercel project; never write them into the repository or files.

| Environment variable | Purpose | When missing |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Rooms and connection details (Upstash Redis REST) | Matchmaking returns 503 → the app points to connection codes (QR) |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | Cloudflare Realtime TURN key — issues one-hour credentials (`/credentials/generate-ice-servers`) | If any of the four is missing, STUN only (no relay server) |
| `CF_ACCOUNT_ID`, `CF_ANALYTICS_API_TOKEN` | Checks the relay usage of the last 31 days before issuing (GraphQL `callsTurnUsageAdaptiveGroups`, token permission Account › Account Analytics › Read) — issuing stops at 900 GB or more | Same as above |

- Cloudflare does not stop by itself when usage passes the free tier, so the issuing route keeps the limit. Change the limit and window in one place, `TURN_CAP` in `api/_mp/turn.js`.

---

## Features

- **.gba / .zip** — runs on the app's `bin\core\mgba_core.wasm` (mGBA 0.10.1). 240x160 screen (fits the right-hand area, keeps the aspect ratio; integer scaling in settings), sound, key bindings, gamepad,
  fast-forward (2x/3x/4x/8x), pause, reset, saves (`<ROM name>.sav` next to the ROM, same format as VBA and mGBA),
  save-state slots 1–9 (neither saving nor loading is available during multiplayer). For `.zip`, the first `.gba`/`.agb`/`.gb`/`.gbc`/`.bin` inside is opened.
- **.gb / .gbc (GB and GBC)** — run on the same mGBA core. The system is told from the ROM header, not the extension (same rule as mGBA; GBC-only and GB/GBC-compatible games get GBC colors, monochrome GB games get mGBA's default four grays).
  160x144 screen (10:9, and the screen area is 10:9 too). Keys are the eight A, B, START, SELECT and directions (no L/R — hidden from the touch buttons, key settings and controls list as well; changed keys are the app-wide keys shared with GBA games).
  Battery saves (`<ROM name>.sav` next to the ROM, same place and name as for .gba), the cartridge clock (MBC3 RTC — runs on real time and is stored in the last 48 bytes of the save, the same format as mGBA and VBA-M), save-state slots and the web version's auto-save.
  Super Game Boy borders and colors, the GB link cable and monochrome palette choice are not supported (SGB-enhanced games also run as GB/GBC).
- **.wgba / .wasm** — opens even a single file without a `.js` (`.wgba` is a wasm file with a different extension).
  - Builds that export screen, sound and saves under `Web_*` names run directly on the built-in host.
  - Large saves such as 512 KB are stored and loaded at the size the core reports (not cut to 128 KB).
  - Web builds with a page (`index.html` etc.) run with their own page; builds with only an emscripten `.js` get a canvas attached.
  - Each build has its own storage (localStorage, IndexedDB, IDBFS), which persists across restarts.
- **.wgba with a packed ROM** — If a ROM is stored in the custom section `webgba.rom` at the end of the wasm, webGBA opens it with that ROM even when no `.gba` is next to it
  (no ROM search or prompt; the status bar says "Built-in ROM"). To pack: `node tools/pack-wgba.mjs <build.wasm> <rom.gba> <out.wgba>` — the ROM is zlib-compressed, then read back and checked down to its SHA-1.
  The SHA-1 is checked again when opening; if it does not match, the game is not opened and you are told why. Wasm engines ignore custom sections, so a packed file is still a valid wasm.
  **It contains the ROM, so keep it on your own PC and do not share it.** Neither this repository nor its releases contain any ROM or any `.wgba` with a ROM packed in.
- **ROM-free shareable patch .wgbp** — a file you can share. When opened, webGBA asks once for a ROM you own, then creates `<name>.wgba` with that ROM packed in, in the same folder, and opens it
  (from then on you open that `.wgba`). The ROM is checked by SHA-1; if it does not fit, you are told why (already patched, different revision, different language, different game, …). Drop a `.wgbp` together with a ROM to skip the prompt.
  To make one: `node tools/make-wgbp.mjs <build.wasm|.wgba> <target ROM> <out.wgbp> --base <original ROM> [--label name] …` — stores a BPS patch from the original ROM to the target ROM, blanks the parts of the wasm
  that equal the original ROM and fills them back from the user's ROM. Afterwards it checks, with every accepted ROM, that the result is byte-identical to what `pack-wgba` packs. The app and the tools use the same pako, so a `.wgba` is byte-identical on any PC.
- **Choosing the ROM for a web build** — Settings › General › Files › **ROM file name for web builds**. When set, the ROM with that name in the same folder as the `.wgba`/`.wasm` (or the folder above) is used.
  When empty (default), webGBA tries `<build name>.gba`, then the only `.gba` in the same folder; if there are several, it asks the first time and remembers the choice per build.
  You can change it any time with Game › Choose ROM…. A `.wgba` with a packed ROM ignores these rules and uses its own ROM.
- **.wgbp file association** — double-click a `.wgbp` (shared patch) in Explorer to open it in webGBA and pick a ROM. Registered per user (HKCU) without administrator rights.
  `.wgba`, `.gb` and `.gbc` start a game right away, so they are not associated (open them or drag and drop them instead). On start, webGBA deletes only the values it added for `.wgba`, `.gb` and `.gbc` in earlier versions.
  To remove the association, use **Settings › General › Files**.
- **One save, next to the opened file** — for `.gba`, `.gb`, `.gbc`, `.zip`, `.wgba` and `.wasm` alike, webGBA reads and writes a single `<file name>.sav` right next to the opened file (put a VBA or other emulator save there under that name and it just continues).
  About a second after the game saves, and also when you close the window or open another game, that `.sav` file itself is overwritten in place. No backup file is made.
  If it cannot be written (read-only, for example) the status bar says so and it is tried again on the next save or on close. To use another save, File › Import save… (overwrites the `.sav` next to the game with it); to take one out, Export save….
- **Two directions at once** — Settings › General › Game. Chooses which direction reaches the game when two are held:
  **Off** (default, you turn as soon as you press) · Diagonal input (only ←+→ and ↑+↓ keep the last one) · All input (same as a real GBA).
  A game whose manifest has `input.dpad` uses that value as its default; a change made while that game runs is remembered per game.
- **Auto fire** — Settings › General › Game (web: Settings). When on, holding A · B · C · D · L · R (roles `a`, `b`, `c`, `d`, `l`, `r`) presses it repeatedly (not the directions, START or SELECT).
  Speed levels 1–9 = 1 · 2 · 3 · 4 · 6 · 8 · 12 · 20 · 30 presses per second (default level 5 = 6 per second, level 1 = 30 frames pressed and 30 frames released, level 9 = press and release every 2 frames). It counts game frames, so the pattern is the same while fast-forwarding, and the same setting applies to the keyboard, gamepads and on-screen buttons (one app-wide setting). Off by default.
- **Fast-forward sound** — sound keeps playing while fast-forwarding, sped up by the same factor. To keep it quiet, use Settings › General › Sound › Mute while fast forwarding.
- **Opening files** — open dialog, drag and drop from Explorer, list of games in the same folder (`.gba`, `.gb`, `.gbc`, `.wgba`, `.wasm`; jump to the previous/next game),
  favorites, recent files, and command-line arguments from file association (passed to the running window if already open). Only file names are shown on screen, never full paths.
- **Toolbar** — vertical bar on the left. When collapsed it no longer covers the game, which gets the extra width; the collapsed state is remembered.
- **Settings window (Ctrl+,)** — four pages: General, Keys, Theme, Language. Screen fit and integer scaling, volume and fast-forward speed, two directions at once, auto fire, state slot, saves, file association and ROM name, clearing favorites/recent files, and key bindings — all in one window.
- **13 themes** — the same theme set as Arbiter (7 dark, 5 light, custom; the web version has the 12 without custom, each shown with 4 key colours in the list). Applied instantly to the whole webGBA UI (toolbar, lists, windows, dialogs); the game screen itself is not changed.
- **Languages** — 한국어 (default), English, 日本語. Switching in Settings › Language applies immediately without a restart and is remembered.

---

## Keyboard shortcuts

| Action | Key |
| --- | --- |
| GBA A / B | Z · K / X · J |
| GBA L / R | A / S |
| START / SELECT | Enter · Numpad Enter / Backspace · Right Shift |
| D-pad | Arrow keys |
| Fast-forward (while held) | Space |
| Toggle fast-forward | Tab |
| Pause | Pause |
| Save / load state | Shift+F1–F9 / F1–F9 |
| Reset | Ctrl+R |
| Open / close | Ctrl+O / Ctrl+W |
| Settings window | Ctrl+, |
| Add to / remove from favorites | Ctrl+D |
| Collapse / expand toolbar | Ctrl+B |
| Previous / next game in the same folder | Ctrl+PageUp / Ctrl+PageDown |
| Developer tools (when `useDevelopKit: true` in `setting.ini`) | Ctrl+Shift+I |

Game keys can be changed in Settings › Keys; gamepads are mapped automatically with the standard layout.

---

## Repository layout

```text
core/          mGBA wasm core build — build.sh (Docker, downloads the official mGBA source), src/ wrappers (webgba_core.c · host_stubs.c)
src-bundle/    UI — src/ (html · css · js · icons · i18n), ini/ (settings seeds), bin/core/ (mgba_core.wasm · licenses/)
src-tauri/     Rust — windows · files · saves · web-build origins · .wgbp association
tools/         npm commands (run.cjs · scripts.cjs), core build, wgba.mjs (pack and check .wgba files), pack-wgba.mjs (pack a ROM into a .wgba), make-wgbp.mjs (make a ROM-free .wgbp), lib/, test/ (test tools)
docs/wgba/     manifest schema · example (the .wgba spec text is further down in this README)
documents/     design documents (Korean)
```

## Folder layout after deployment

```text
webgba.exe
LICENSE                webGBA license (MIT)
THIRD_PARTY_NOTICES    notices for the bundled open source
bin/
  core/     mgba_core.wasm, licenses/          core used at run time
  ini/      setting.ini, personalization.cfg   settings
  log/      2026-10-26.log                     logs
  state/    <ROM name>.ss1 … .ss9               save states
  web/      <build name>-<key>/state.ssN        web-build save states
  webview/  WebView data (web-build storage)
```

- Missing files are created on first launch from copies embedded in the exe. If the folder next to the exe is not writable, `%LOCALAPPDATA%\webGBA\bin` is used.
- Saves are not in `bin`; they are the `<file name>.sav` next to the opened file.
- `setting.ini` sets the window size, pausing when the window is hidden and developer tools. Other settings live in `personalization.cfg` (written by the Settings window).

---

## License

**webGBA is MIT; the bundled mGBA is MPL-2.0.**

- webGBA's own code (src-bundle, src-tauri, tools, core/src, core/build.sh) is under the [MIT License](LICENSE). Copyright © 2026 flightrabbit.
- The bundled mGBA 0.10.1 and its build output (`mgba_core.wasm`) stay under **MPL-2.0**, not MIT. The mGBA source is unmodified and not included in this repository.
  Source: https://github.com/mgba-emu/mgba/tree/0.10.1 · full texts: `src-bundle/bin/core/licenses/` (`bin/core/licenses/` in the deployed app)
- The full notices for bundled open source are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) (also shown in the app under Help › About).
- No ROMs or official GBA BIOS are included (mGBA's built-in HLE BIOS is used). The app icon is a pixel-art handheld drawing provided by flightrabbit.

### Bundled open source

| Component | Purpose | License |
| --- | --- | --- |
| mGBA 0.10.1 (incl. blip_buf, inih) | GBA core | MPL-2.0 (LGPL-2.1, BSD-3-Clause) |
| Tauri 2 · WRY · TAO | app framework · WebView · windows | Apache-2.0 OR MIT |
| Microsoft Edge WebView2 | UI runtime | Microsoft distribution terms |
| windows-rs · zip | Win32 API · .zip ROMs | MIT OR Apache-2.0 · MIT |
| Tabler Icons | icons | MIT |
| pako 2.1.0 | .wgba ROM compression · .wgbp | MIT AND Zlib |
| jsQR 1.4.0 | Reading connection-code QR (browsers without BarcodeDetector) | Apache-2.0 |

mGBA — Copyright (c) 2013-2022 Jeffrey Pfau and contributors · https://mgba.io

---

Copyright © 2026 flightrabbit

---

## .wgba specification 1 (for other developers)

A `.wgba` is a single game file that webGBA opens. **The whole file is a valid WebAssembly (wasm) module.** Custom sections
inside it carry the manifest, cartridge art, JS and data, and a **table of contents** at the front records the start/end offset
and hash of every chunk. It does not have to be a GBA game — any game built as wasm can be packed into a `.wgba` and run in
webGBA (Windows app and web version).

> Chapter 7 (multiplayer) is still a draft, and the current webGBA does not connect players yet. All other chapters describe what the current webGBA does.
> Wherever this specification says "the current webGBA", it describes the app's behaviour, not a rule of the spec (other hosts may differ).

Terms used in this specification:

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
12. [Prompt for AI assistants](#prompt-for-ai-assistants) — at the end of this README

---

### 1. Overview

| You want to… | Pick this runtime |
| --- | --- |
| Ship a game written in C, C++, Rust … as one wasm with no JS (webGBA handles screen, sound, input and saves) | **① Web API** (`runtime: "webapi"`) |
| Ship a wasm game that **has its own JS** (emscripten glue, hand-written JS) | **② Own JS** (`runtime: "script"`) — the JS runs only inside an isolated frame |

- One `.wgba` holds everything the game needs, so it opens with no other files next to it.
- Because the file is plain wasm, it passes `WebAssembly.validate()` and can be inspected with wasm tools (`wasm-objdump -h`, …).
- Quickest way to try: pack the example `docs/wgba/examples/hello-webapi/` with the two commands in [9.1](#91-pack-the-example) and open it in webGBA.
- **Only include ROMs and game data you have the rights to.** Do not distribute `.wgba` files that contain other people's ROMs, art or music. webGBA does not ship any ROM.

---

### 2. File layout

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

#### 2.1 Table of contents `webgba.toc`

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

#### 2.2 ROM chunk `webgba.rom`

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

#### 2.3 Size limits

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

### 3. Manifest

Chunk `manifest` is one UTF-8 JSON object (no BOM, 64KB or less). Field names are lowerCamelCase.
**Unknown fields are ignored.** Fields starting with `x-` are free for the author to use (hosts never read them).
JSON schema for validation: [wgba-manifest.schema.json](docs/wgba/wgba-manifest.schema.json).

#### 3.1 Required fields

| Field | Type | Meaning |
| --- | --- | --- |
| `wgba` | integer | Manifest spec number. Currently `1` |
| `id` | string | **Game id — never changes.** Lowercase reverse domain (`io.github.someone.mygame`), at least one dot, 64 characters or fewer. The web version keys saves and quick slots by this id, the Windows app keys per-game key settings by it (the Windows app keeps saves in `<name>.sav` next to the opened file). Keep the same id in new versions |
| `version` | string | **Game version**, semantic version `x.y.z` (e.g. `1.2.0`; pre-releases like `1.3.0-beta.1` are fine; `+` build metadata is not accepted). Raise it when the content changes |
| `name` | string or object | Game name (library, start screen recent list, window title and so on; 48 characters or fewer per entry). A string = the same name in every language. Per language = an object with entries ① `en` (English) ② `ko` (Korean) ③ `ja` (Japanese) (see "Text per language" below) |
| `runtime` | string | `"webapi"` (①) or `"script"` (②) |

**Text per language**: `name`, `shortName`, button `label`, multiplayer text (`purposes[].name`, status menu) and every other "string or object" text follow the same rule.

- Object entries = ① `"en"` English · ② `"ko"` Korean · ③ `"ja"` Japanese. Entries for other language codes are allowed too.
- Display order: the entry for the current screen language → otherwise `en` → `ko` → `ja` → the other entries (in the order written). Empty entries (`""` or only spaces) count as missing.
- Write only the entries you have. For example `{"en": "Demon Front", "ko": "데몬프론트"}` shows `Demon Front` on a Japanese screen.
- A plain string (`"name": "Demon Front"`) is shown as is in every language (existing .wgba files keep working).
- A game the user renamed in the web version's library shows the user's name.

#### 3.2 Optional fields

| Field | Type · default | Meaning |
| --- | --- | --- |
| `shortName` | string · object | Name on the cartridge spine, and on the label when there is no label picture (16 characters or fewer per entry recommended). Same language entries and display order as `name`. Missing or every entry empty → `name` |
| `description` | string · object | Description (500 characters or fewer) |
| `author` | string | Author. Shown on the info screen |
| `license` · `homepage` · `contact` | string | License (an SPDX name such as `MIT` is recommended), an `https://` address (anything else is an error), contact. Reserved for the info screen (the current webGBA does not show them) |
| `build` | string | Build label (commit etc., 64 characters). Text for people only; the build id (3.4) is computed by the host separately |
| `needs` | string array | Hosts without the feature **do not open** the game: `"pointer"` (unplayable without a mouse), `"net"` (unplayable without multiplayer), `"keyboard"` (needs a real keyboard), `"state"`. An unknown word means "not opened — a newer webGBA is required". The current webGBA has no `net`, so it does not open games with `needs: ["net"]` |
| `screen` | object | `width`·`height` (1–1024, default 240·160), `scale` `"fit"` (default, fill while keeping the aspect ratio) · `"integer"` (integer scaling preferred — the webGBA user setting comes first: integer scale only when the setting is "Integer scale"; with "Fit to area" the game is fitted even with this value). `fps` is reserved (the current webGBA always runs at GBA speed, about 59.7275 fps). Pixels are always drawn nearest-neighbour |
| `display` | object | `aspect`: display aspect ratio `"W:H"` (e.g. `"4:3"`, W·H integers 1–1024, ratio between 1:4 and 4:1). The screen buffer (`screen`) is stretched to this ratio (the original monitor ratio, non-square pixels). Without it, the screen buffer's own ratio (square pixels). No pixel interpolation when stretching (nearest-neighbour). With the "Integer scale" setting only the height is an integer multiple; the width follows the display ratio (non-integer). Both the Windows app screen and the web screen box follow this ratio (without it, the screen buffer ratio; GBA games stay 3:2) |
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

#### 3.3 Example (① 240×160 game without a ROM)

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

(The pack tool fills `chunk`, `format`, `width` and `height` of `cart.*` from the pictures, so when writing by hand you only need `labelAt`, `textArea` and `color`.)

#### 3.4 Version, format numbers and build — three separate things

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

### 4. Runtimes

#### 4.1 ① Web API — `runtime: "webapi"` (no JS)

The host runs the wasm directly and handles screen, sound, input and saves. The wasm **exports** the names below and imports only what is listed in 4.1.2.
A game of this kind therefore cannot touch any other host feature (files, storage, network).

##### 4.1.1 Exports

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

##### 4.1.2 Imports (provided by the host)

- `env`: `emscripten_asm_const_int` (returns 0), `emscripten_resize_heap`, `_emscripten_throw_longjmp`, `emscripten_date_now`, `emscripten_get_now`, `emscripten_notify_memory_growth`, `abort`, `_abort_js`, `invoke_*` (emscripten-style setjmp/exceptions)
- `wasi_snapshot_preview1`: `fd_write` (to the log only), `fd_read`·`fd_close`·`fd_seek`·`fd_sync`·`fd_fdstat_get` (error codes), `environ_get`·`environ_sizes_get` (none), `clock_time_get`, `random_get`, `proc_exit`
- `webgba.v1`: a function `() → ()` that does nothing. Older webGBA versions that do not know this spec refuse it as an unknown import. So **① games that are not 240×160 with GBA buttons, and ① games that run without a ROM (`rom.required: false`), should import it** (so older webGBA does not run them with a broken screen or ask for a ROM they do not need).
- Any other import means the host will not open the file as ① (make it ② instead).

##### 4.1.3 Sequence

1. Compile (chunk `code`) → instantiate → call `__wasm_call_ctors` (or else `_initialize`) if present → `Web_SetTimeZone`.
2. If there is a ROM chunk, unpack it and check the SHA-1 → write it at `Web_RomBuffer(size)`. If there is none and `rom.required` is not `false`, ask the user to pick a ROM file.
3. If there is a save, `Web_FlashClear` then write it at `Web_GetFlash` → `Web_SetSaveSize`.
4. `Web_Init()` → then every frame (GBA speed, about 59.7275 fps) `Web_RunFrame(keys)` → take the screen and sound.
5. **After `Web_Init`, do not grow memory a lot inside `Web_RunFrame`** (the host's screen address would go stale).

#### 4.2 ② Own JS — `runtime: "script"` (isolated)

The game JS (chunk `js`) runs only inside an **isolated frame** made by the host. The frame is `<iframe sandbox="allow-scripts" srcdoc="…">`
and has no origin (`"null"`). The host writes the frame document itself, so there is no address to load (it also works in an installed web app and offline).
The frame contains one canvas (`#canvas`, `screen.width × height`) and the `webgba` object.

##### 4.2.1 What works and what does not inside the frame

| Works | Does not work (the host does it instead) |
| --- | --- |
| wasm compile and run, canvas 2D·WebGL, `requestAnimationFrame` | Network (fetch, XHR, WebSocket, image URLs, forms — blocked by CSP; WebRTC is removed by the frame script before the game starts). Multiplayer goes through `webgba.net` (chapter 7) |
| Key input — the host turns the user's layout into the game's `code` and dispatches `keydown`·`keyup` (made by the frame, so `isTrusted` is false), pointer events on the canvas | IndexedDB, cookies, real localStorage (blocked: no origin) → `webgba.save`. `localStorage`·`sessionStorage` are replaced with in-memory versions, and with `save.kind: "localStorage"` the host stores their content as the save |
| `AudioContext`·AudioWorklet. The host also controls volume and pause of any `AudioContext` the game creates. When sound is locked, a "tap to start" cover appears over the frame | Gamepad API (the host reads it and sends keys), fullscreen (host button), popups·`alert`·navigating away (the host removes the frame and stops the game) |
| `blob:` Workers, scripts and images | Threads (SharedArrayBuffer·pthreads) — not accepted in spec 1 |

Safari (WebKit) limits screen updates of a frame the user has not tapped yet to 30Hz. When the frame runs below 40 fps for more than 2 seconds it shows the same "tap to start" cover.

##### 4.2.2 The `webgba` object (frame API 1)

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

##### 4.2.3 Start styles `entry.style`

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

### 5. Key mapping

A game lists only **the buttons it uses** in the manifest. Where they go on the real keyboard, gamepad and touch screen is decided by the host from each button's role.

#### 5.1 `input`

| Field | Meaning |
| --- | --- |
| `preset` | `"gba"`: the 10 GBA buttons below as they are (① default). `"none"`: no buttons (② default) |
| `buttons` | Button array (up to 32 for ①, 24 for ②). With a `preset`, these are appended after the preset (the same `id` replaces the preset button). **If a ① game uses buttons other than the GBA ones, write `"preset": "none"` and list every button** — the ① default is `"gba"`, so leaving it out appends your buttons after the 10 GBA buttons and bits and roles collide (validation error) |
| `keyboard` | `"mapped"` (default): the game receives only the listed buttons. `"raw"` (② only): real keys are passed through (text-entry games etc.; host keys excluded) |
| `dpad` | Default handling of directions pressed together: `"latest"` (last pressed only) · `"opposite"` (latest of an opposite pair only, diagonals pass) · `"both"` (all, like a real GBA). For a game that sets it, this is the default and the user can change it per game (Windows app Settings › General › Two directions at once, web Settings — remembered per game id). Without it, the user's global setting (default `"latest"`). Games that need diagonal movement (arcade etc.) should set `"both"` or `"opposite"` |

One button:

| Field | Meaning |
| --- | --- |
| `id` | Button name (`A`, `JUMP` …; letters, digits, `_`, `-`, 16 characters; unique) |
| `role` | Position: `up` `down` `left` `right` · face `a` `b` `c` `d` (at most 4) · `l` `r` `l2` `r2` · `start` `select` · `extra`. Decides the default key, gamepad button and touch position. Except `extra`, one button per role |
| `label` | Text shown on screen (string or per language — same order as "Text per language" in 3.1; 6 characters or fewer recommended, up to 8). Defaults to `id` |
| `bit` | **Required for ①**: bit number 0–31 in `Web_RunFrame(keys)` (pressed = 1) |
| `code` | **Required for ②**: the `KeyboardEvent.code` the game JS listens for (e.g. `"Space"`, `"KeyZ"`). The host also fills in `key`·`keyCode` |
| `keys` | Default keyboard keys (up to 4 `KeyboardEvent.code` values). Defaults to the role's keys |
| `pad` | Default gamepad buttons (standard-mapping button numbers 0–31; axes as `"-axis0"`, `"+axis1"`). Defaults to the role's buttons |
| `touch` | `"auto"` (default) or `"hide"` (no touch button) |

#### 5.2 `role` defaults

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
- When the user turns on **auto fire**, the host passes buttons with role `a`, `b`, `c`, `d`, `l` or `r` as repeated presses and releases while they are held (1–30 per second; ① = per `Web_RunFrame(keys)` frame, ② = key events per display frame of the frame runtime). Give buttons that should not repeat `role: "extra"`.

#### 5.3 GBA default layout `preset: "gba"`

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

#### 5.4 Face buttons A–D

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

#### 5.5 Host keys

Keys the host uses before the game. Do not put them in a game's default keys (`keys`) (`check` warns about `Space`, `Tab`, `Escape`, `Pause`, `KeyP`, `F1`–`F12`).

| Key | What it does |
| --- | --- |
| `Space` (the user can change it) | Fast-forward while held |
| `Tab` | Toggle fast-forward |
| `Pause` (also `P` on the web version) | Pause |
| `F1`–`F9`, `Shift+F1`–`F9` (Windows app) | Load / save quick slots. The Windows app reserves all of `F1`–`F12` |
| `Ctrl`·`Alt`·`Meta` combinations | App shortcuts |

The `code` a game listens for can be anything (the host translates). How simultaneous opposite directions are handled (latest only / latest of the opposite pair / all) is a user setting (a game's `input.dpad` sets its default) applied to the `up`·`down`·`left`·`right` roles.

#### 5.6 Example for ②

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

### 6. Cartridge art

The library of the webGBA web version shows one cartridge per game on a shelf. On the shelf you see the **spine**;
picking it pulls it out and shows the **front + label**. A `.wgba` may contain three pictures (all optional); for missing ones webGBA draws a default look from `cart.color`.

| Picture | Chunk | Grid (width×height) | What |
| --- | --- | --- | --- |
| Label | `cart.label` | 48×32 (3:2) | Only the picture inside the front's label window |
| Front | `cart.front` | 54×44 | The whole cartridge front (body, label window background, grooves …). Transparent outside the body |
| Spine | `cart.spine` | 18×46 | The side seen on the shelf. Transparent outside |

| Item | Rule |
| --- | --- |
| Size | Grid × k, k from 1 to 4. **All three pictures use the same k.** Recommended k = 2: label **96×64** · front **108×88** · spine **36×92** |
| Format | PNG (recommended, palette PNG fine) or **lossless** WebP. No JPEG, GIF or SVG |
| Transparency | Allowed. Transparent parts of the label show the front picture (or the default label background) |
| File size | 64KB or less each recommended (over 256KB the picture is not used) |
| Drawing | Hosts draw only nearest-neighbour at integer scale (never shrink or smooth). Drawing at grid size and saving at 2× is recommended |
| Label position | `cart.front.labelAt: [x, y]` — top-left of the label inside the front picture (front picture pixels). Default `[3k, 5k]`. The label (48k×32k) must fit inside the front |
| Spine name area | `cart.spine.textArea: [x, y, width, height]` — spine picture pixels. The host writes `shortName` (or `name`) here vertically. If the area is one colour (paper), the web library paints that paper and the light lines right above and below it with `cart.color`, draws a cartridge-colour strip (`cart.color` at 50% opacity over white) at the default name area (`[2k, 5k, 14k, 34k]`) and writes the name there in black. Absent means no text (the name is painted on the spine picture) |

```json
"cart": {
  "color": "#3a6ea5",
  "label": { "chunk": "cart.label", "format": "png", "width": 96, "height": 64 },
  "front": { "chunk": "cart.front", "format": "png", "width": 108, "height": 88, "labelAt": [6, 10] },
  "spine": { "chunk": "cart.spine", "format": "png", "width": 36, "height": 92, "textArea": [4, 10, 28, 68] }
}
```

The pack tool fills `chunk`, `format`, `width` and `height` from the pictures (when writing by hand, match the pictures). `color` is the body colour (optional) and is used to shade the default front and spine.

Missing pictures (sizes or formats outside the rules, broken pictures, or a different k all count as "missing" — no error dialog):
- No front → default front (`cart.color` body + label window, label position `[3k, 5k]`)
- No spine → default spine (`cart.color` body + a cartridge-colour strip (`cart.color` at 50% opacity over white) at the default name area `[2k, 5k, 14k, 34k]`, with `shortName`·`name` in black)
- No label → `shortName` (or `name`) written as text in the label position
- No `cart.color` → a colour picked from the name (the same name always gets the same colour)

- **Do not include trademarks**: other companies' names or logos (console makers, console names or logos …), copies of real cartridges or box art, or characters you have no rights to. Draw the front and spine body in your own shape too — do not copy the shape, grooves or contacts of a real console cartridge. Only include pictures you made or have the right to use.

---

### 7. Multiplayer

> Multiplayer protocol 1 (draft). The current webGBA connects players with **a 6-digit room code** (same Wi-Fi or other networks) and the same Wi-Fi's **nearby-room list** (matchmaking server), and when the server cannot be reached, by **exchanging connection codes (or QR) twice**. It opens games with `needs: ["net"]`, calls `Web_NetHost(1, 1)`, and gives ② games `webgba.net`.
> An older webGBA that does not know multiplayer never calls `Web_NetHost` and its `webgba.net` is `null`, so games should hide their link menus there (7.8). The protocol may change.
> Protocol 1 extensions (optional): a game can name its own connection servers (`multiplayer.iceServers`, 7.11). When a game sets `multiplayer.rejoin`, a player whose connection dropped can **rejoin** the same seat (7.10). A game that takes players at any time sets `multiplayer.join: "anytime"`: no automatic dialog, no timeout, and players are taken for 2 min 30 s after the host creates or renews the room (7.12).

#### 7.1 Overview

webGBA connects devices on the same Wi-Fi (same router), and devices on other networks by room code. It tries a direct connection between devices (WebRTC data channels) first; on networks where that fails (mobile data, office or school networks), traffic goes through a **Cloudflare relay server (TURN)**. Through the relay the game content stays encrypted (DTLS), so the relay cannot read it (7.11). With Settings › Multiplayer **Use multiplayer** disabled, the multiplayer window cannot be opened and nothing connects (applies at once).

The matchmaking (signaling) server (`webgba.vercel.app/api/v1/mp`) is used while finding a room (for games with rejoin, until the session ends). It keeps the room code, nickname, the first 8 bytes of the game's compatibility key, purpose, player count and connection details (Offer and Answer), deleted automatically at most 2 minutes 30 seconds after the last update. Connection details carry local address candidates, **the public IP (public address candidates)** and relay addresses, so **the other device can see this device's public IP**. The server does not store the IP address of the requesting device. The nearby-room list only shows rooms to devices that share the same one-day hash (HMAC) made from the public IP.

The game only says "I need a link partner now" and handles the bytes it sends and receives. Creating and joining rooms, finding nearby devices, connecting and handling drop-outs are done by webGBA. ② game JS cannot use the network directly (chapter 8), so it always goes this way.

- One session = one room, 2–8 players. The device that made the room is **seat 0 (host)**, the others get 1, 2, … in joining order.
- Messages are reliable (never lost) and ordered per sender. One message is up to 16384 bytes.
- Sending to `TO_ORDERED` makes everyone, including you, receive messages **in the same order** (the room host orders them).
- Only the same game (or the same compatibility key) can connect.
- Only games that cannot be played at all without multiplayer write `needs: ["net"]`.

#### 7.2 Manifest field `multiplayer`

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
| `rejoin` | boolean | no | `false` | `true` = rejoin (7.10). A dropped guest's seat is kept until the session ends and the same device can come back to it |
| `join` | `"anytime"` | no | none (7.7 behavior) | `"anytime"` = drop-in game (7.12). The dialog does not open by itself when the game asks, there is no timeout, and players are taken for 2 min 30 s after the host creates the room or presses Renew (also with the dialog closed; the host can close it alone) |
| `iceServers` | array | no | none (webGBA default STUN + Cloudflare TURN) | The game's own connection servers (STUN/TURN, 7.11). When given, only this list is used instead of webGBA's defaults |

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

#### 7.3 ① Web API — exported functions

All are **functions the game exports** and the host calls (no new imports → the game still opens on hosts that do not know multiplayer).
The game counts as supporting multiplayer only when all seven exist: `Web_NetWanted`, `Web_NetEvent`, `Web_NetOut`, `Web_NetOutLen`, `Web_NetOutClear`, `Web_NetInBuffer`, `Web_NetIn`. Pointers are addresses in wasm memory, all values little endian.

| Function | Shape | Called | Meaning |
|---|---|---|---|
| `Web_NetHost` | `(u32 protocol, u32 flags)` | Once after `Web_Init` | The host supports multiplayer protocol `protocol`. `flags` bit 0 = ordered broadcast available, bit 1 = `sync: "inputs"` available, bit 2 = rejoin (7.10) available (set only for games with manifest `rejoin: true`). **Not called means the host has no link** → the game should hide menus like "Play with friends". Optional |
| `Web_NetWanted` | `() → u32` | Every frame after `Web_RunFrame` | 0 = no link needed. Non-zero = a request (7.3.1) |
| `Web_NetEvent` | `(u32 kind, u32 a, u32 b)` | When something happens, between frames | Event (7.3.3) |
| `Web_NetOut` | `() → ptr` | Every frame after `Web_RunFrame` | Where the records to send are (7.3.2) |
| `Web_NetOutLen` | `() → u32` | Same | Byte length of the records to send (0 = none) |
| `Web_NetOutClear` | `()` | After reading all records | Empties the send area |
| `Web_NetInBuffer` | `(u32 len) → ptr` | For each received message, before `Web_RunFrame` | Where to write `len` bytes. **0 = no room right now** → the host keeps the message and retries next frame (order preserved) |
| `Web_NetIn` | `(u32 from, u32 len)` | After writing the bytes there | Confirms receipt. `from` = sender seat. Bit 8 (`0x100`) set = a state bundle (7.10, `rejoin` games only) |
| `Web_NetBoard` | `() → ptr` | Once after the session opens | Optional. Where the 400-byte player status table is (7.9.2). Read only when the manifest has `multiplayer.board` |
| `Web_NetCompat` | `() → ptr` | Once before a session | Optional. A NUL-terminated ASCII compatibility key of up to 64 characters (e.g. a build hash). If present it is appended to the manifest `compat` and compared too |

One host frame:

```text
received messages → Web_NetInBuffer / Web_NetIn (stop and retry next frame if there is no room)
Web_RunFrame(keys)
Web_NetOut / Web_NetOutLen → send → Web_NetOutClear
Web_NetWanted → open/close the dialog, end the session (7.7)
```

##### 7.3.1 `Web_NetWanted` value

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

##### 7.3.2 Send record format

Records follow one another from `Web_NetOut()` for `Web_NetOutLen()` bytes. Each record:

| Bytes | Meaning |
|---|---|
| 0–1 | Content length `n` (u16, 1–16384) |
| 2 | Destination: 0–7 = that seat only, `0xFE` = **TO_ORDERED** (everyone including me, same order for all), `0xFF` = **TO_ALL** (everyone except me) |
| 3 | 0 = message. `rejoin` games only: 1 = state bundle part (more follows), 2 = last state bundle part (7.10). Other values drop the record |
| 4~ | `n` content bytes; the next record starts at a 4-byte boundary |

- Keeping one frame's sends at 65536 bytes or less is recommended. Records queued while there is no session are dropped by the host.
- What you send to `TO_ORDERED` also comes back to you (`from` = your seat). If the game applies its own messages in the order they come back, every device stays in the same state.
- Receivers keep each sender's order. Messages from different senders are in the same order for everyone only with `TO_ORDERED`.

##### 7.3.3 Events `Web_NetEvent(kind, a, b)`

| kind | Name | a | b | Meaning |
|---|---|---|---|---|
| 1 | `OPEN` | my seat | current players | Session opened. The room host opens alone first (1 player) |
| 2 | `JOIN` | joined seat | current players | Someone joined |
| 3 | `LEAVE` | left seat | reason | Someone left (the seat is free; a newcomer may get the same number) |
| 4 | `CLOSED` | reason | 0 | Session over. Later sends are dropped |
| 5 | `STALL` | seat | 0 | Nothing heard from that player for over 1 second, or that device left the app briefly |
| 6 | `RESUME` | seat | 0 | Back again |
| 7 | `HOLD` | seat | current count | `rejoin` games only (7.10). The seat's connection dropped and the seat is kept. On the dropped device itself `a` = its own seat. On a user device `a` = 0 = the host closed the app and webGBA waits for it to return (7.10.1) |
| 8 | `BACK` | seat | current count | `rejoin` games only. A kept seat is connected again (always after `HOLD`). On a user device `a` = 0 = the host is back → this device sends a state bundle to seat 0 (7.10.1) |
| 9 | `REJOINED` | own seat | current count | `rejoin` games only. Sent to the returning device instead of `OPEN` (`a` = 0 on the host device when the host reopened the app and returned) |

Reasons: 1 `CANCEL` (the user cancelled in the multiplayer dialog) · 2 `TIMEOUT` (no connection in time / did not come back after a drop) · 3 `INCOMPATIBLE` (different game, compatibility key or protocol) · 4 `LOST` (connection dropped) · 5 `FULL` (room full) · 6 `LEFT` (left normally) · 7 `HOST_LEFT` (the room host left, the room is gone) · 8 `NO_NETWORK` (no Wi-Fi, or this device cannot use the link feature) · 9 `SOLO` (`rejoin` games only: the dropped device's user chose "Play alone")

What the game must do: on `CLOSED(CANCEL)`, treat it like a cancel inside the game and set `Web_NetWanted` to 0. A `STALL` may be brief, so do not drop at once — follow the game's own timeout. When the room host leaves (`HOST_LEFT`) the session ends (protocol 1 has no host migration).

#### 7.4 ② Own JS — `webgba.net`

Use the `webgba.net` object the isolated frame provides (between frame and host the messages travel over the MessagePort; the game only uses this object). Bytes are `ArrayBuffer`·`Uint8Array`.

| Game → host | Meaning |
|---|---|
| `webgba.net.want({ purpose, min, max, role })` | Same as a non-zero ① `Web_NetWanted`. `purpose` = manifest id, `role` = `"any"`·`"make"`·`"join"`. Every call is a new request |
| `webgba.net.unwant()` | Same as ① returning 0 (link finished) |
| `webgba.net.send(to, bytes)` | `to` = seat 0–7 · `"ordered"` · `"all"`, up to 16384 bytes |
| `webgba.net.board(table)` | Player status table (7.9.3). `null` = no table |
| `webgba.net.sendState(to, bytes)` | State bundle (7.10, `rejoin` games only). `to` = seat 0–7, 1–262144 bytes |

| Host → game | Meaning |
|---|---|
| `webgba.net.host` | `{ protocol, ordered, inputs, rejoin }` — the ① `Web_NetHost` (`rejoin` = bit 2) |
| `webgba.net.onevent = (kind, a, b) => …` | Same numbers as 7.3.3 |
| `webgba.net.onrecv = (from, bytes) => …` | A received message (in order) |
| `webgba.net.onstate = (from, bytes) => …` | A received state bundle (7.10). In order with that sender's messages |

On hosts that do not know multiplayer, `webgba.net` itself is `null`.

#### 7.5 Limits

| Item | Value |
|---|---|
| Players | 2–8 (seats 0–7) |
| One message | 16384 bytes |
| Sends per frame (recommended) | 65536 bytes |
| Receive order | Per sender; `TO_ORDERED` is the same order for everyone |
| Latency (same Wi-Fi) | Usually 2–20 ms round trip (1–2 frames) |
| One state bundle (7.10) | 262144 bytes (the host splits it into 16384-byte pieces and joins them again) |
| Game connection servers (7.11) | 4 addresses in total, `stun:`, `turn:`, `turns:` only |

#### 7.6 Optional feature: input sync (`sync: "inputs"`)

For simple ① games with no link code of their own. If the game produces the same screen for the same key input (deterministic), the host lines up everyone's keys every frame.

- Extra export: `Web_NetKeys(u32 slot, u32 keys)` — the host calls it for every other player right before `Web_RunFrame`. The `keys` of `Web_RunFrame(keys)` are your own.
- The host sends your keys for frame f to be used at f + `inputDelay`, and does not run frame f until everyone's keys for f have arrived (the screen pauses meanwhile; `STALL` after 1 second).
- Everyone starts at the same frame 0: when `OPEN`·`JOIN` fill the room, the room host sends "start", and the next frame is frame 0 for everyone.
- Fast-forward and loading states are unavailable during a session.

#### 7.7 When the multiplayer dialog opens

The host opens the multiplayer dialog **once** when all of these hold:

1. The game supports multiplayer: ① the seven functions of 7.3 exist (the manifest `multiplayer`, if any, is used) / ② the manifest has `multiplayer`
2. The game asks: ① `Web_NetWanted()` changes from 0 to non-zero (or the request number changes) / ② it calls `webgba.net.want()`
3. No session is running, the game is running (not paused), and multiplayer is enabled in the user settings

It does not open:
- Again for **the same request** after the user closed (cancelled) it. Instead a "Multiplayer" button above the screen stays lit while the request lasts, so it can be reopened.
- When the game asks for nothing — then there is neither dialog nor button (the user never opens it first).
- For `join: "anytime"` games (7.12) when the game asks. The user opens it with the "Multiplayer" button above the screen.

```text
┌ Multiplayer · Trade (2 players) ──────────┐
│  Nickname [ Player 4821 ]                  │
│  [ Host a room ]   [ Join ]                │
│                                [ Cancel ]  │
└────────────────────────────────────────────┘

Host:  ① give the host code (111 characters · QR) to the other player → ② enter their answer code and connect
Guest: ① enter the host code and press Next → ② give the answer code (· QR) to the host
```

- Connection codes never pass through a server. A code carries local addresses (mDNS names, private IPv4, IPv6 ULA, link-local) and public address candidates from STUN (no matchmaking server is used, so no default TURN credentials — 7.11). A prflx candidate (learned from a connectivity check when the other side could not resolve an mDNS name, as happens between a PC and a phone on the same Wi-Fi) is accepted too.
- A code is for one person, once. For 3 or more players the host makes a new host code per player (used codes and answer codes for another invite are refused).
- Requests with a fixed role (create only, join only) start on that screen.
- When the minimum player count is reached, it shows "Connected" and closes after 1 second. Any further confirmation (e.g. "Press A to start") happens inside the game.
- Until the maximum is reached, the room host keeps a small indicator ("2/4 · waiting"); more players arrive as `JOIN`.
- `JOIN`, the player count and the count in the room list change only after the joining device reports that it accepted its seat. A player who drops before that does not keep a seat (no `HOLD`).
- Cancel → `CLOSED(CANCEL)`. Not found in time (3 minutes by default) → `CLOSED(TIMEOUT)`. If the game ends the link first, the dialog closes quietly. `join: "anytime"` games differ (7.12).
- Help when connecting fails: "Check that you are on the same Wi-Fi, that it is not a guest or public Wi-Fi, and that VPN is off."

During a session the host keeps to: fast-forward and speed changes off (1×), quick slots (saving and loading states), web auto save and reset blocked (the game's own save stays as it is), opening another game = end of session (`LEFT`). Pausing or leaving the app → `STALL` to the others (not when only the tab is hidden on a PC: frames keep running), `RESUME` on return, dropped (`LOST`) if not back within a set time (15 seconds by default). A small status in a screen corner (players, connection state). The nickname is a user setting; IP addresses and device names are never shown.

#### 7.8 For game authors

- If the same keys and messages always give the same result (random numbers from a seed inside the game), `TO_ORDERED` alone keeps everyone in the same state.
- Messages arrive between frames, so queue them and process them inside a frame.
- If the host does not know multiplayer (`Web_NetHost` never called / `webgba.net` is `null`), hide the link menus (older webGBA).
- Examples: `docs/wgba/examples/net-webapi/` (① small C, no ROM) and `net-script/` (② one JS file) — A looks for players, the host's START runs one round, everyone ends with the same hash, and both fill the player status board (7.9). A ② example without multiplayer is `hello-script/` (drawing, keys, save, quick slots).
- By default only the same game build can connect (`compat: "exact"`). If different versions share the same link rules, put the same string in `compat`.
- Do not send ROMs or other people's works in messages.

#### 7.9 Player status board

During a session webGBA shows the current players in the "Multiplayer" menu. webGBA fills the seat number, nickname, room host, connection state and latency (round trip to the room host, ms); the game may add values per player (HP, level, rank, state, …). The list shows even if the game gives nothing.

Opening it: web = the "Multiplayer" button above the screen during a session (where fast-forward was), PC version (exe) = the "Multiplayer" button in the left tool bar or Tab (shown while held; a short press keeps it open). The game keeps running while the menu is open, and the menu never opens by itself when a game ends.

##### 7.9.1 Manifest `multiplayer.board`

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `columns` | array (1–6) | yes | — | Column definitions. Array order = value order |
| `columns[].id` | string (lowercase letters, digits, `-`, up to 16) | yes | — | Fixed column name |
| `columns[].type` | `"bar"`·`"number"`·`"rank"`·`"status"` | yes | — | Kind (table below) |
| `columns[].name` | localized text (up to 12) | yes | — | Shown column name |
| `columns[].max` | integer 1–65535 | `bar` only | — | Bar maximum (a maximum given with the value wins) |
| `columns[].tone` | `"hp"`·`"accent"` | no | `"accent"` | `bar` colour. `hp` = green above 50%, yellow above 25%, red below |
| `columns[].prefix`·`suffix` | localized text (up to 4) | no | none | Text before / after a `number` (e.g. `"Lv"`) |
| `columns[].labels` | array (1–15) | `status` only | — | `{ "name": localized text (up to 8), "tone": "normal"·"good"·"warn"·"bad"·"dim", "dimRow": true·false }`. Value 1 = first label |
| `names` | array of localized text (1–32, up to 16 each) | no | none | Names of non-human rows (AI, …), picked by the row's `nameLabel` (1-based) |
| `captions` | array of localized text (1–16, up to 24 each) | no | none | Header text with integer arguments in `{0}`·`{1}` |
| `mark` | localized text (up to 8) | no | none | Meaning of a highlighted row (legend in the footer) |
| `scope` | `"all"`·`"self"` | no | `"all"` | `all` = the game fills every row (all devices share the same state). `self` = each device gives only its own row; webGBA collects and shares them |
| `sort` | `{ "column": id, "order": "desc"·"asc" }` | no | none | webGBA sorts the rows. Without it: `all` = the game's order, `self` = seat order |

| Kind | Value (integer) | Shown as |
|---|---|---|
| `bar` | low 16 bits = current (u16), high 16 bits = maximum (0 = manifest `max`) | Pixel bar + number |
| `number` | s32 | Number with `prefix`·`suffix`; if neither, the column name in front |
| `rank` | 0 = none, 1–99 | Localized rank (`2위`·`2nd`·`2位`) |
| `status` | 0 = none, 1– = `labels` number | Label. With `dimRow: true` the row is dimmed too |

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

Without `board`, webGBA never reads game values (even if ① exports `Web_NetBoard`). Unknown keys are ignored.

##### 7.9.2 ① Web API — `Web_NetBoard`

| Function | Shape | Called | Meaning |
|---|---|---|---|
| `Web_NetBoard` | `() → ptr` | Once after the session opens (`OPEN`) | Where the 400-byte table is. 0 = no table. **Keep the same address for the whole session** |

Buffer (little endian):

| Offset | Type | Name | Meaning |
|---|---|---|---|
| 0 | u32 | `serial` | 0 = no table now. Add 1 on every change (skip 0). **Write it last, after every other field** |
| 4 | u8 | `format` | `1` |
| 5 | u8 | `rows` | Row count 0–8 (0 or 1 with `scope: "self"`) |
| 6 | u8 | `flags` | Bit 0 = final result (game over). Others 0 |
| 7 | u8 | `caption` | `captions` number (1-based), 0 = none |
| 8 | s32 | `arg0` | Header `{0}` |
| 12 | s32 | `arg1` | Header `{1}` |
| 16 + 48×i | row i | | 48 bytes below |

| Offset | Type | Name | Meaning |
|---|---|---|---|
| 0 | u8 | `slot` | 0–7 = session seat (a person), `0xFF` = not a person |
| 1 | u8 | `flags` | Bit 0 = dimmed, bit 1 = highlighted |
| 2 | u8 | `nameLabel` | `names` number (1-based) for a non-human row, 0 = none |
| 3 | u8 | `nameLen` | Bytes in `name` below, 0–20 |
| 4 | s32 × 6 | `values` | In column order; 0 for missing columns |
| 28 | u8 × 20 | `name` | Name of a non-human row (UTF-8). `nameLabel` wins if set |

- A human row (`slot` 0–7) always shows the webGBA nickname (never a game-given name).
- While the menu is open (or with `scope: "self"`) the host reads only `serial` every 15 frames and the rest only when it changed. Writing `serial` last means a half-written table is never read.
- 9 or more rows or `format` other than 1 = table ignored, `nameLen` 21 or more = name ignored, `slot` 8–254 = that row ignored, buffer outside wasm memory = table not used.
- Do not change the table more than 4 times a second (faster changes still show at most 4 times a second).

##### 7.9.3 ② Own JS — `webgba.net.board`

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
webgba.net.board(null); // no table
```

- Values are the same integers as ① (`bar` also takes a `{ value, max }` object). Rows beyond 8 and values beyond 6 are dropped, non-integers become 0, unknown keys are ignored.
- Sending the same content again is fine. The screen follows at most 4 times a second (only the latest is kept).
- With `scope: "self"` put only your own row in `rows` (`slot` is ignored and taken as your seat).

##### 7.9.4 What the host guarantees

- Text from the game or other devices (names, nicknames) is shown **as text only** (never inserted as HTML). Control characters, direction overrides and zero-width characters are removed; names are cut at 16 and nicknames at 12 characters.
- Colours, pictures and addresses are never taken from the game. Colours come from the `tone` name in the host theme.
- `scope: "self"` rows travel as 48 bytes through the room host to everyone (at most 4 times a second per device).
- The nickname of someone who left is kept until the session ends. If the game keeps using that seat number, the row shows that nickname with a "Left" (or "Lost") label.
- Examples: `net-webapi` (① `Web_NetBoard`, `scope: "all"`, one AI row) and `net-script` (② `webgba.net.board`, `scope: "self"`, sorted).

#### 7.10 Rejoin (`rejoin: true`, protocol 1 extension)

A guest whose connection dropped can come back to the same seat until the session ends. It works only when the game writes `multiplayer.rejoin: true` in its manifest; other games keep the earlier handling of 7.3.3 (`LEAVE(LOST)`). Host support = ① `Web_NetHost` `flags` bit 2 / ② `webgba.net.host.rejoin`.

- Only for sessions made with a room code (matchmaking server). Sessions made with connection codes or QR (connect without internet) keep the earlier handling.
- When a guest drops (no reply for 15 seconds, or the channel closed) the host keeps the seat (`HOLD`, the count stays, new players cannot take it) and the status menu shows "Disconnected · waiting". The dropped device gets `HOLD` (its own seat); webGBA shows a "Reconnecting…" dialog and retries the same room automatically (right away when the network comes back). The user can press "Rejoin" (retry now) or "Play alone" (`CLOSED(SOLO)`; the host and others get `LEAVE(LEFT)`).
- On return the host and others get `BACK`, the returning device gets `REJOINED` instead of `OPEN`. Messages sent while it was away are not delivered, so the host game sends a **state bundle** to the returning seat. After `REJOINED` come the events (`JOIN`, `LEAVE`, `HOLD`, `BACK`) for other seats that changed meanwhile.
- A short drop (including an address change after reconnecting to the same Wi-Fi) is repaired on the same connection with an ICE restart. The game then only sees `STALL` → `RESUME` and no message is lost.
- A drop of the host device's network is repaired only within 15 seconds. Beyond that the session ends: host `CLOSED(LOST)`, guests `CLOSED(HOST_LEFT)`. When the host closes the app, see 7.10.1 (reopen within 2 minutes to return to the same room).
- When the host ends the session the room closes and a device trying to come back gets `CLOSED(HOST_LEFT)`.

State bundle (1–262144 bytes, to one seat):

- ① send: send record byte 3 = `1` (part, more follows) / `2` (last part). One part is up to 16384 bytes; parts for the same target may span frames. ① receive: when the whole bundle has arrived, `Web_NetInBuffer(len)` (len = bundle size) → `Web_NetIn(from | 0x100, len)`. Returning 0 retries next frame and later messages wait too, so keep receive space for your largest bundle.
- ② `webgba.net.sendState(to, bytes)` / `webgba.net.onstate`.
- A bundle arrives in send order among that sender's messages. `TO_ORDERED` messages the host relayed between relinking and sending the bundle arrive before the bundle and are already inside it. Put the number of ordered messages the game applied into the bundle, and on the returning device apply only higher numbers.
- Bundles to a kept or empty seat, and bundles over 262144 bytes, are dropped.

Matchmaking server use: the host of a rejoin session refreshes even a full room every 120 seconds to keep it during the session (3 commands) and checks the server mailbox only while a seat is dropped (every 2 seconds for a minute, then every 10). The dropped device and the host exchange connection details once through the mailbox (`/api/v1/mp/rj`). The host refuses a seat key (given in WELCOME) that does not match.

##### 7.10.1 Host return

In a `rejoin` game, if the host closes the app while users are in the room (closing the window or tab, reloading) or the app is killed, the room stays for **2 minutes**. When the host reopens the app within 2 minutes and opens the same game (same game id and version), the first screen of the multiplayer window shows **Return to previous room**; it takes the host back to the host seat with the same room code. Users reconnect automatically, and the host takes over one user's game state (state bundle) and continues.

- During a session the host device keeps the room details (room code, host proof, game compatibility key, seats, seat keys, time) on the device (web `localStorage`, exe settings file) and drops them after 2 minutes. They are deleted at once when the host closes the room or the session ends. Another game does not show them, and making a new room or joining another room instead of returning closes the previous room.
- Users see "Waiting for the host… m:ss left", the game is paused (webGBA stops the frames), and "Play alone" stays available. After 2 minutes the session ends with `CLOSED(HOST_LEFT)`.
- Events: users get `HOLD` (own seat) → `HOLD(0)`. When the host is back, one user chosen by webGBA (the lowest seat among the users asking to reconnect at that time) gets `BACK(0)` and **sends a state bundle to seat 0** (the same as the host does on `BACK(s)`). The other users get `REJOINED` (own seat) and wait for the bundle from the host game. The returning host device gets `REJOINED(0)` instead of `OPEN` and waits for the bundle; seats not back yet come as `HOLD(s)`, later `BACK(s)` (only after the bundle arrived). If no bundle arrives within 10 seconds, the remaining `BACK` events are sent anyway.
- When the host app closes, webGBA tells the users at once (a connection control message) and asks the server to keep the room (`POST /api/v1/mp/away`, host proof). If the host drops without telling (killed app and so on), a user that gets no answer to reconnecting for 20 seconds asks the server to keep it (`POST /api/v1/mp/hold`, join ticket). The keep time is 2 minutes from the first request and is never extended. Returning = `POST /api/v1/mp/back` (host proof only, only while the room record exists).
- Connections through the default TURN relay get new credentials for the returning host as well (direct and relay).

```text
host device (closed → reopened)      user (sends the bundle)          other users
close app → notice · away           HOLD(own) · HOLD(0) "Waiting for the host…"  HOLD(own) · HOLD(0)
"Return to previous room" → back
REJOINED(0) · HOLD(others)           BACK(0) → state bundle → 0        REJOINED(own)
apply bundle → BACK(s) → bundle → s                                    apply bundle
```

#### 7.11 Internet connection, relay server and game connection servers (`iceServers`, protocol 1 extension)

With Settings › Multiplayer **Use multiplayer** on (the default, web and PC), the room code also connects devices on other networks. There is no separate internet setting.

- Through connection servers (default = two public STUN servers, `stun.l.google.com:19302` and `stun.cloudflare.com:3478`, plus a Cloudflare relay server (TURN)) the device gathers public address candidates (srflx, global IPv6) and relay candidates and puts them into its connection details (host code, answer code, room Offer/Answer). **The other device can see this device's public IP.**
- **A direct connection is tried first.** The same Wi-Fi and ordinary routers connect directly; only when a direct link fails, as behind a symmetric NAT (mobile data and the like), does traffic go through the Cloudflare relay. The relay can see both devices' IPs but not the game content (encrypted with DTLS). A relayed link shows "Relay · Nms" in the connection cell of the status table.
- The matchmaking server issues the relay credentials (`POST /api/v1/mp/turn`): only to a device with an open room (host = room token, guest = join ticket), 30 per public-IP group per hour, valid for one hour. Long games restart ICE with fresh credentials 10 minutes before they expire (the link stays up), and rejoining uses fresh credentials too. Connection codes (connect without internet) do not use the matchmaking server, so they use STUN only.
- To stay inside the relay's free tier, issuing stops when the relay usage of the last 31 days (Cloudflare analytics) reaches 900 GB or cannot be checked. Meanwhile only STUN is used, and networks without a direct path fail.
- When both the direct and the relayed connection fail, the reason is shown: if this device's network looks like a symmetric NAT, "…This device's network (such as mobile data) can't connect directly to devices elsewhere, and the connection through the relay server also failed. Connect this device to Wi-Fi and try again."; the other device's network gives "Connect the other device …"; anything else gives "Could not connect to the other device. Go through the checklist."
- The nearby-room list only shows the same router (same public IP).

`multiplayer.iceServers` — the game names its own STUN/TURN servers. When given, **only the game's list** is used instead of webGBA's defaults (STUN and Cloudflare TURN). Games without it use the defaults.

| Key | Type | Meaning |
|---|---|---|
| `urls` | string \| string array | `stun:`, `turn:`, `turns:` addresses (`host[:port][?transport=udp\|tcp]`, up to 256 characters). Up to 4 addresses over all entries |
| `username`, `credential` | string (up to 512) | Fixed TURN credentials. **Anyone can take them out of the file and use your TURN** — prefer `credentialUrl` (`wgba.mjs check` warns) |
| `credentialUrl` | `https://` address (up to 512) | TURN entries only. The host requests it only when connecting with `GET` (no cookies or referrer, redirects refused, 5 s and 8 KB limit). Response `{ "username": "…", "credential": "…", "ttl": seconds }` (ttl optional). Server addresses always come from the manifest (the response cannot change them). Must allow webGBA origins with CORS (`https://webgba.vercel.app`, PC `http://ui.localhost`) |

```json
"iceServers": [
  { "urls": "stun:stun.example.com:3478" },
  { "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"], "credentialUrl": "https://example.com/api/turn-credential" }
]
```

- Malformed entries are not used (logged). If a `credentialUrl` request fails (timeout, bad response, HTTP error) only that entry is left out and the dialog says so.
- The dialog shows "This game's connection servers: <domain>". A TURN server in the path can see both devices' IPs but not the game content (encrypted). There is no separate consent dialog (the "Use multiplayer" setting explains it).
- webGBA (the host) contacts connection servers only while connecting. The game frame (② JS) still cannot use the network directly (chapter 8).

#### 7.12 Drop-in games (`join: "anytime"`, protocol 1 extension)

For games played alone that let others join at any time (e.g. joining an arcade game in progress). Such a game keeps its request (`Web_NetWanted` non-zero / `webgba.net.want()`) from the start, so with the default behavior (7.7) the dialog opens right away, `TIMEOUT` arrives after 3 minutes, and the host cannot close the dialog until the first guest arrives. With `multiplayer.join: "anytime"` in the manifest it works as below. Other games keep 7.7.

- **No automatic dialog**: while the game asks, only the "Multiplayer" button above the screen (the toolbar button on PC) is shown. The user opens the dialog with it to host a room, enter a code or use nearby rooms.
- **No timeout**: the request lasts until the game withdraws it (0 / `unwant()`); no `CLOSED(TIMEOUT)` while waiting.
- **Taking players for 2 min 30 s**: creating the room or pressing **Renew** in the dialog takes players for 2 minutes 30 seconds from then. It keeps going after the dialog is closed and you play; when the time is up it stops (with a notice, and no more matchmaking server requests). To take more, press **Renew** — the same room code is used again, or a new one if another room took it meanwhile. Players already in stay, and players who join after a renew get the next seat numbers.
- The host can close the dialog alone (1 player) (dialog buttons = Leave room · Close). The dialog shows "Taking players · time left" / "Not taking players" and a Renew button.
- The host's button: web = player badge blue (taking players) / grey (stopped), PC = a dot on the button corner green / grey and the status bar "Taking players · 2:14 left" / "Not taking players". When someone joins there is a notice (web = toast, PC = status bar) and `JOIN`.
- Trying to join a stopped room shows "The host has stopped taking players. Ask the host to press Renew" (the server refuses it and drops it from the nearby list).
- Closing or cancelling the dialog does not send `CLOSED(CANCEL)` to the game (only a join attempt in progress is dropped). To close the room use "Leave room" → `CLOSED(LEFT)`.
- The guest's way in, `rejoin` (7.10), internet connections (7.11) and the status menu (7.9) are unchanged.
- Matchmaking server: while taking players the host checks for a player's answer every 3 seconds (5 after a minute, 1 command). One room creation or renew = about 45 commands over its 2 min 30 s (create or renew 4–6 + checks about 38 + stop marker 3), and 0 while playing after it stops. Games with rejoin (7.10) keep refreshing the room every 120 seconds after it stops while players are in, so dropped seats can come back (3–4 commands, about 120 an hour).

---

### 8. Security rules

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

### 9. Making one

#### 9.1 Pack the example

Get the webGBA repository (https://github.com/flightrabbit-hash/webGBA) and, in that folder (node 18 or later, no other dependencies):

```text
node tools/wgba.mjs pack -o hello.wgba --wasm docs/wgba/examples/hello-webapi/game.wasm --manifest docs/wgba/examples/hello-webapi/manifest.json --cart-dir docs/wgba/examples/hello-webapi/cart
node tools/wgba.mjs check hello.wgba
```

Open `hello.wgba` (about 2.6KB) in webGBA and the whole screen changes colour with the buttons. The example folder `docs/wgba/examples/hello-webapi/` holds
`game.c` (source) · `game.wasm` (its build, 594 bytes) · `manifest.json` · `cart/` (label, front and spine PNG, k = 2).

#### 9.2 Tool commands

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

#### 9.3 ① The smallest C game

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

#### 9.4 ② emscripten (SDL etc.) game

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

#### 9.5 Packing without the tool

Any language works as long as the rules are followed. Steps:

1. Walk the sections of the input wasm, drop the custom sections whose name starts with `webgba.` and join the rest unchanged → the **code range**.
2. Prepare the chunk contents: manifest (UTF-8 JSON), cart.label·cart.front·cart.spine (picture bytes as they are), js (stored or zlib), data (stored or zlib), rom (WGRM header + ROM).
3. From the number of entries n, the TOC length is `16 + 80n`; compute the TOC section length (`00` + LEB size + LEB name length + `webgba.toc` + TOC).
4. Starting at offset 8 + TOC section length, in order: each `webgba.<name>` section → code range → data → rom. For each section, **start = first byte of the section content** (after the name), end = end of the section. For code, the start and end of the range.
5. Fill in the TOC (name, start, end, unpacked size, method, kind, flags, SHA-256) and the total file length.
6. Write `wasm header + TOC section + the rest`, then run `WebAssembly.validate` and the chapter 10 checks.

---

### 10. Validation

What `wgba.mjs check` looks at (check the same things when you pack by hand). Any **error** means failure; **warnings** are notices.

- The whole file passes `WebAssembly.validate`, the first section is `webgba.toc` (only one), the TOC's file length = the real length
- Entries: name rule and no duplicates, in order and inside the file, a `webgba.<name>` section at that position (code matches wasm section boundaries and contains no `webgba.*`), kind matches the name, unpacked size = stored length for method 0, SHA-256 matches, no unknown kind with the required flag, single-instance chunks appear once
- `webgba.*` sections missing from the TOC → warning
- If `rom` exists: it is last, and the WGRM header, size and SHA-1 are right (not unpacked with `--quick`); a different manifest `rom.sha1` → warning
- Manifest: JSON of 64KB or less, `wgba` 1, `id` rule, `version` is `x.y.z`, `name` (a string or each language entry 1–48 characters, errors name the entry; no `en`·`ko`·`ja` entry at all or an entry of only spaces → warning), `runtime`, no unknown `needs`, `homepage` is `https://`, values of `screen`, `save`, `input.preset`, `input.dpad`, `cart.color`, `display` is an object and `display.aspect` is `"integer:integer"` (W·H 1–1024, ratio 1:4–4:1), button id rule and duplicates, role duplicates, a `shortName` entry over 16 characters → warning. `info` prints `name` and `shortName` as shown for each screen language (en·ko·ja; `ja → en …` when another entry is used)
- ①: the 4 required exports, no unknown imports, button `bit` within 0–31 and not shared, only some of the seven `Web_Net*` (7.3) → warning, not 240×160 with GBA buttons, or runs without a ROM (`rom.required: false`), but no `webgba.v1` → warning, a `js` chunk → warning (unused)
- Multiplayer: `multiplayer.protocol` 1, `purposes[].id` rule and no duplicates, players 2–8, `rejoin` boolean, `join` (`"anytime"` only), `iceServers` (7.11 format = error, fixed TURN credentials = warning)
- ②: a `js` chunk exists, `entry.style`, `entry.js` other than `"js"` → warning, a `code` on every button, no imported shared memory (threads)
- Cartridge art (label, front, spine): PNG or lossless WebP, 256KB limit (warning over 64KB), not grid (48×32 · 54×44 · 18×46) × k (1–4) → warning, different k between them → warning, format or size different from the manifest → warning, `labelAt`·`textArea` outside the picture → warning, listed in the manifest but no chunk → error, a chunk not listed in the manifest → warning
- Host keys (`Space`·`Tab`·`Escape`·`Pause`·`KeyP`·`F1`–`F12`) in default keys (`keys`) → warning

---

### 11. Format numbers and versions

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

## Prompt for AI assistants

Paste everything below into your AI assistant and tell it about your wasm game files. It will build a `.wgba` that follows this spec.

````text
You help me pack my WebAssembly game into a webGBA .wgba file (spec 1). Follow the spec below exactly; do not invent anything you do not know — ask me instead.

[Ask me first]
- The game wasm file, whether JS was built with it (emscripten glue etc.), the data files, and whether there is large data such as a ROM to place in game memory
- Game name (per language in English, Korean and Japanese is fine), game id (lowercase reverse domain, e.g. io.github.myaccount.gamename — never changes once chosen), version (x.y.z)
- Screen size, the buttons used and what each does, whether there is a save, whether it uses the mouse
- Whether there is cartridge art (label 48×32, front 54×44, spine 18×46, all at the same scale 1–4×, PNG or lossless WebP — all optional), cartridge body colour (#RRGGBB)
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
- Required: "wgba": 1, "id" (lowercase reverse domain, at least one dot, 64 characters or fewer), "version" ("x.y.z"; pre-release "-beta.1" allowed), "name" (string or {"en":…,"ko":…,"ja":…}, 48 characters or fewer per entry — hosts show the screen language's entry → en → ko → ja, whichever exists; write only the entries you have), "runtime" ("webapi" or "script").
- Optional: shortName (16 characters, same language entries as name), description, author, license, homepage (https:// only), contact, build, needs (from ["pointer","net","keyboard","state"]), screen{width,height (1–1024, default 240·160), scale ("fit"·"integer")}, display{aspect ("W:H" display ratio, e.g. "4:3" — stretched when it differs from the screen buffer)}, save{kind,maxSize,files}, pointer{use}, input{preset,buttons,keyboard,dpad ("latest"·"opposite"·"both" default for directions pressed together)}, cart{color, label, front{labelAt}, spine{textArea}}, rom{required}, entry{style,js,args}, files, multiplayer. Unknown fields are ignored; if a value outside the spec is really needed, use a name starting with "x-".
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
