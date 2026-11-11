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

Admin mode "Import ROMs" (`api/v1/admin/[op].js`, from webGBA 0.9.1, for a single operator only — downloads `.wgba` files from a private R2 bucket with its public URL turned off, after a 6-character check):

| Environment variable | Purpose | If missing |
|---|---|---|
| `R2_PRIVATE_BUCKET`, `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID` | Read-only token for the private bucket — key file `authentication.key`, the `wgba/` listing, 5-minute download addresses (presigned GET) | Admin API returns 503 → the app shows "Admin mode is not set up on the server" |
| The storage above (`UPSTASH_*`/`KV_*`) | Attempt limit (5 per IP per hour, 30 failures per day in total) | Code check returns 503 (no check) |

- Private bucket CORS = GET from the web version's origin only. The Windows app downloads with the built-in WinHTTP instead of the web view, so it needs no CORS.
- Upload the key file and `.wgba` files with `node tools/wgba.mjs admin-key` (PowerShell, the code is not shown on screen) and `node tools/wgba.mjs upload [<publish folder|root>] --wgba <new.wgba>` (12.5).

---

## Features

- **.gba / .zip** — runs on the app's `bin\core\mgba_core.wasm` (mGBA 0.10.1). 240x160 screen (fits the right-hand area, keeps the aspect ratio; integer scaling in settings), sound, key bindings, gamepad,
  fast-forward (2x/3x/4x/8x), pause, reset, saves (`<ROM name>.sav` next to the ROM, same format as VBA and mGBA),
  save-state slots 1–9 (neither saving nor loading is available during multiplayer). For `.zip`, the `.gba`/`.agb`/`.gb`/`.gbc`/`.bin` inside is extracted and opened (when it holds several games, you pick them from a list to add).
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
  To remove the association, use **Settings › General › Files › Open .wgbp files with webGBA**.
- **One save, next to the opened file** — for `.gba`, `.gb`, `.gbc`, `.zip`, `.wgba` and `.wasm` alike, webGBA reads and writes a single `<file name>.sav` right next to the opened file (put a VBA or other emulator save there under that name and it just continues).
  About a second after the game saves, and also when you close the window or open another game, that `.sav` file itself is overwritten in place. No backup file is made.
  If it cannot be written (read-only, for example) the status bar says so and it is tried again on the next save or on close. To use another save, File › Import save… (overwrites the `.sav` next to the game with it); to take one out, Export save….
- **Two directions at once** — Settings › General › Game. Chooses which direction reaches the game when two are held:
  **Off** (default, you turn as soon as you press) · Diagonal input (only ←+→ and ↑+↓ keep the last one) · All input (same as a real GBA).
  A game whose manifest has `input.dpad` uses that value as its default; a change made while that game runs is remembered per game.
- **Auto fire** — Settings › General › Game (web: Settings). When on, holding A · B · C · D · L · R (roles `a`, `b`, `c`, `d`, `l`, `r`) presses it repeatedly (not the directions, START or SELECT).
  Speed levels 1–9 = 1 · 2 · 3 · 4 · 6 · 8 · 12 · 20 · 30 presses per second (default level 5 = 6 per second, level 1 = 30 frames pressed and 30 frames released, level 9 = press and release every 2 frames). It counts game frames, so the pattern is the same while fast-forwarding, and the same setting applies to the keyboard, gamepads and on-screen buttons (one app-wide setting). Off by default.
  On screens where the game turns auto fire off (menus, battles and so on, ① `Web_AutoFireOff()`), held buttons are passed as held.
- **RS button (sequence input)** — enters a key sequence you set up (for example A → A → ↓ → A+B) in one press. For each step you choose the keys pressed together (A · B · C · D · L · R · START · SELECT · directions; a diagonal is two directions together), how long they are held and the wait before the next step, in frames (1/60 s, shown with ms; default hold 3 and wait 3 frames, up to 32 steps).
  Each game keeps 5 presets (rename up to 12 characters, delete), and the preset in use is played. Pick it in Settings from the X · 1–5 row (an empty number makes a new preset); X (Off) hides the RS button and the RS key does nothing (a game whose manifest has `input.rs` starts with preset 1, otherwise Off). Presets change only in Settings.
  Playback rules: one press plays the sequence once from the start · holding RS keeps the last step's keys pressed (release to end) · pressing any other key (keyboard, gamepad, on-screen button) during playback stops RS input from that frame and sends that key · pressing RS again during playback restarts it · auto fire is not applied to RS input · nothing plays while paused.
  Input goes through the normal input path every game frame, so fast-forward and multiplayer give the same per-frame result (② self-JS games follow screen refresh time).
  Windows app: assign a keyboard key or gamepad button to the "RS button" row in Settings › Keys (none by default) and edit presets and steps under RS button on the same page. Web version: the RS button on screen (a pill above the right-hand buttons, in its own colour) and Settings › RS button › Edit.
- **Fast-forward sound** — sound keeps playing while fast-forwarding, sped up by the same factor. To keep it quiet, use Settings › General › Sound › Mute while fast forwarding.
- **Opening files** — open dialog, drag and drop from Explorer, list of games in the same folder (`.gba`, `.gb`, `.gbc`, `.wgba`, `.wasm`; jump to the previous/next game),
  favorites, recent files, and command-line arguments from file association (passed to the running window if already open). Only file names are shown on screen, never full paths.
- **Toolbar** — vertical bar on the left. When collapsed it no longer covers the game, which gets the extra width; the collapsed state is remembered.
- **Settings window (Ctrl+,)** — four pages: General, Keys, Theme, Language. Screen fit and integer scaling, volume and fast-forward speed, two directions at once, auto fire, state slot, multiplayer on/off and nickname, saves, file association and ROM name, clearing favorites/recent files, key bindings and the RS button — all in one window.
- **13 themes** — the same theme set as Arbiter (7 dark, 5 light, custom; the web version has the 12 without custom, each shown with 4 key colours in the list). Applied instantly to the whole webGBA UI (toolbar, lists, windows, dialogs); the game screen itself is not changed.
- **Languages** — 한국어 (default), English, 日本語. Switching in Settings › Language applies immediately without a restart and is remembered.
- **Multiplayer** — supported games connect with a 6-digit room code, on the same Wi-Fi or across networks (plus a nearby-room list on the same Wi-Fi, and "Connect without internet", which swaps connection codes / QR without the matchmaking server). A direct device-to-device connection (WebRTC) is tried first; networks where that does not work (mobile data, company or school networks, …) go through a **Cloudflare relay server (TURN)**. Game data stays encrypted (DTLS) through the relay, so the relay cannot read it.
  Connection details include public IP candidates, so **the other device can see this device's public IP**. They (public IP included) are stored on the matchmaking server (`webgba.vercel.app/api/v1/mp`) for at most 2 min 30 s. Turning off Settings › Multiplayer › **Use multiplayer** (on by default) means the multiplayer window cannot be opened and nothing connects (applies immediately). The nickname shown on other devices (up to 12 characters) is set in the same place. To stay inside the relay server's free quota, relay credentials stop being issued when the relay usage of the last 31 days reaches 900 GB; until then connections use STUN only.
  During a session fast-forward, save-state slots and reset are unavailable. The player status table opens from the "Multiplayer" button at the top of the web version, or the "Multiplayer" toolbar button or Tab in the Windows app.
  In games that support rejoin (`rejoin`), a dropped user's seat is kept and the user reconnects to it, and the room stays for 2 minutes even if the host closes the app. If the host reopens the app within 2 minutes and opens the same game, the multiplayer window shows **Return to previous room**, which puts the host back into the host seat of the same room code. Meanwhile the users' games pause with "Waiting for the host… m:ss left"; when the host returns they reconnect automatically and the host receives one user's game state to continue. After 2 minutes the session ends. When a user closes the app during a game, the host also keeps that seat; opening the same game again on the same device shows **Return to previous room**, which puts the user back into the same seat.
  A game whose multiplayer protocol is newer than this webGBA runs without multiplayer, and the multiplayer button and connection window show "This game's multiplayer needs a newer webGBA".

- **Online updates** — once each time the app starts, when online, webGBA checks whether the `.wgba` files in the library (in the Windows app: favorites, recent files and the current folder) have a new version. The update window appears only when one exists; pressing "Update" downloads and applies a delta patch (signature and SHA-1 checked, the current file kept on failure, saves kept). Quick slots made in another version are not loaded. Spec for authors: [chapter 12](#12-online-updates-update-spec-1-extension).
- **webGBA updates (Windows app)** — from 0.9.0, each app start also checks for a new webGBA version through the same index (`index.json`) as the `.wgba` check (no extra request). When one exists an update window appears; pressing "UPDATE" downloads only the changed files (such as `webgba.exe`), checks the signature and SHA-256, replaces the files and restarts the app. Settings (`bin/ini`), logs, quick slots, WebView data and saves (the `.sav` next to each game) are kept. If downloading or replacing fails, the original files are restored. After "LATER", the update is still available from the About screen for the rest of that run. The web version is always current and is not covered. Spec: [12.6](#126-webgba-self-update-windows-app).

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
| Multiplayer status (in a session: hold, or tap to keep open) | Tab |
| RS button (sequence input) | Set in Settings › Keys (none by default; a gamepad button also works) |
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
web/           web version (PWA) — src/ (UI) · build.mjs (assembly) · test/ (test tools)
api/           matchmaking server (Vercel function) — v1/mp/[op].js · _mp/ (rooms, mailbox, TURN credentials)
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

> Every chapter (multiplayer in chapter 7 included) describes what the current webGBA (v0.6.1, Windows app and web version) does. Within chapter 7, only input sync (`sync: "inputs"`, 7.6) is not supported by the current webGBA.
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
7. [Multiplayer](#7-multiplayer) — room codes, nearby rooms, connection codes, status board, rejoin, relay servers, drop-in
8. [Security rules](#8-security-rules)
9. [Making one](#9-making-one)
10. [Validation](#10-validation)
11. [Format numbers and versions](#11-format-numbers-and-versions)
12. [Online updates](#12-online-updates-update-spec-1-extension) — version file, delta patches, release tools
13. [Prompt for AI assistants](#prompt-for-ai-assistants) — at the end of this README

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
| `needs` | string array | Hosts without the feature **do not open** the game: `"pointer"` (unplayable without a mouse), `"net"` (unplayable without multiplayer), `"keyboard"` (needs a real keyboard), `"state"`. An unknown word means "not opened — a newer webGBA is required". The current webGBA supports all four, so games with `needs: ["net"]` open too (an older webGBA without multiplayer does not open them) |
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
| `multiplayer` | object | Multiplayer — players, purposes, compatibility, status board, rejoin, drop-in, connection servers. [Chapter 7](#7-multiplayer) |
| `update` | object | Online updates — `feed` (`https://` address of the version file) and `key` (signing public key). [Chapter 12](#12-online-updates-update-spec-1-extension) |

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
| `Web_AutoFireOff()` → i32 | | 1 = no auto fire now: the host passes held buttons as held (screens where auto fire gets in the way, such as menus and battles). Read before each `Web_RunFrame` while auto fire is on and an auto fire button is held. Without it, auto fire always applies ([5.2](#52-role-defaults)) |
| `Web_GetHaltReason()` · `Web_GetTitle()` · `Web_SetTimeZone(sec)` | | Address of the stop reason text (NUL terminated) / title / local time offset (seconds east of UTC) |
| `Web_Net*` | | Multiplayer — [chapter 7](#7-multiplayer) (7.3; status board `Web_NetBoard` 7.9.2) |
| `Web_GpuStart(version)` → i32 · `Web_GpuList()` → ptr · `Web_GpuListLen()` → u32 · `Web_GpuListDone()` · `Web_GpuSync(reason)` · `Web_GpuStop()` · `Web_GpuOverlay()` → i32 | | GPU drawing (WebGL2) — [4.1.4](#414-gpu-drawing-optional). Used only when the first four all exist |

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

##### 4.1.4 GPU drawing (optional)

For games that draw the screen with WebGL2 instead of the CPU. The game supplies the drawing rules (shaders, GLSL ES 3.00), and the host runs the command list the game wrote, in order. There are no new imports, so a webGBA that does not know this feature, or a browser without WebGL2, never calls `Web_GpuStart`, and the game draws with the usual framebuffer (`Web_GetFramebuffer`). No manifest entry is needed.

1. After `Web_Init`, the host creates a WebGL2 context and calls `Web_GpuStart(1)`. 1 means GPU mode, 0 means the usual way. When the host creates a new instance (restart), it calls it again.
2. In GPU mode, after every `Web_RunFrame` the host takes the list (u32 words) with `Web_GpuList()` → `Web_GpuListLen()`, runs it in order and calls `Web_GpuListDone()`. Until it is run and cleared, the list keeps growing frame by frame (running several frames at once is fine).
3. Picture = output target 0 (`screen.width × height` RGBA8, GL coordinates — row 0 is the bottom). When showing it, `Web_GpuOverlay()`: 0 = the output as is, 1 = `Web_GetFramebuffer` composited on top (premultiplied alpha, row 0 is the top), 2 = `Web_GetFramebuffer` draws this frame.
4. Before saving a quick slot, the host calls `Web_GpuSync(1)`, runs the list and then calls `Web_StateSave` (the game writes a `READ` that copies the GPU picture into memory). Only `reason` 1 (just before a quick-slot save) is defined, and the host never calls it with another value.
5. If the list cannot be run (lost context, shader error and so on), the host calls `Web_GpuStop()` and shows the screen the usual way. The game draws on the CPU from the next frame.
6. Turning it off: in the web version, when `webgba.gpu` in `localStorage` is `"0"`, the host does not start GPU mode (for testing).

Command record = first word `opcode | word count << 8` (the count includes the first word) followed by the values. Addresses are byte offsets in wasm memory, and floats are f32 bits.

| opcode | Command | Values |
| --- | --- | --- |
| 1 | `PROGRAM` | id, vertex shader address·length, fragment shader address·length, number of instance attributes (one `ivec4` each, from location 0), uniform name list (NUL separated) address·length — uniform number = order in the list |
| 2 | `TEXTURE` | id (1 or more), format (1 RGBA8 · 2 RGB10_A2 · 3 R16UI), width, height — NEAREST, CLAMP_TO_EDGE |
| 3 | `TARGET` | texture id (0 = output), viewport x·y·w·h |
| 4 | `BLEND` | enable (0·1), equation RGB·A (0 ADD · 1 SUBTRACT · 2 REVERSE_SUBTRACT), factors srcRGB·dstRGB·srcA·dstA (0 ZERO · 1 ONE · 2 SRC_COLOR · 3 ONE_MINUS_SRC_COLOR · 4 DST_COLOR · 5 ONE_MINUS_DST_COLOR · 6 SRC_ALPHA · 7 ONE_MINUS_SRC_ALPHA · 8 DST_ALPHA · 9 ONE_MINUS_DST_ALPHA · 10 CONSTANT_COLOR · 11 ONE_MINUS_CONSTANT_COLOR · 12 CONSTANT_ALPHA · 13 ONE_MINUS_CONSTANT_ALPHA), constant color r·g·b·a (f32) |
| 5 | `UNIFORM` | program id, uniform number, type (0 int · 1 float), count (1–4), values |
| 6 | `TEXBIND` | texture unit, texture id |
| 7 | `DRAW` | program id, vertices per instance (TRIANGLES), instance count, instance data address (0 = no attributes), instance stride (bytes) |
| 8 | `UPLOAD` | texture id, x·y·w·h, format, data address, row length (pixels) |
| 9 | `COPY` | source·destination texture id, source x·y, destination x·y, w·h (same format) |
| 10 | `READ` | texture id, x·y·w·h, format (1 RGBA8), memory address — the host finishes writing while it runs the list |

- An unknown opcode makes the host stop GPU mode (step 5).
- Vertices and instance attributes: there is no vertex buffer. The vertex shader computes positions from `gl_VertexID` (0 to vertices per instance − 1). The record of instance i = instance data address + i × instance stride, and attribute a (0 to number of instance attributes − 1) is the 4 `INT`s at byte offset a × 16 in that record. Declare it in the shader as `layout(location = a) in ivec4` (it changes once per instance).
- `DRAW`: an instance count of 0 draws nothing. With instance data address 0, the host draws once without attributes whatever the instance count is (`drawArrays`); otherwise it draws instance-count instances (`drawArraysInstanced`).
- GL state between lists: only the programs (with the uniform values set on them) and textures (with their content) the game created carry over to the next list. The host disables blending at the end of every list, unbinds the output target when it shows the screen, and when `Web_GpuOverlay()` is 1 it also changes the viewport, the texture bindings and the program in use. So at the start of every list, before drawing, write `TARGET` and `TEXBIND` (and `BLEND` if you need blending).
- GL state inside a list: `TEXTURE` and `UPLOAD` bind that texture to the current texture unit, `COPY` unbinds the output target, and `READ` makes the read texture the output target. To draw after them, write `TEXBIND` and `TARGET` again.
- When optional exports are missing: without `Web_GpuSync` the host skips the call and only runs the list → `Web_StateSave`. Without `Web_GpuStop` the host skips the call and shows the screen the usual way. Without `Web_GpuOverlay` the host treats it as 0 (the output as is).
- Textures after a state is applied: when a quick slot is loaded (`Web_StateLoad`) the host does nothing on the GPU side (it does not call `Web_GpuStart` again, and the programs and textures the game created stay as they were before loading). So the game writes the `UPLOAD`s that bring the textures back in line with the loaded state into the next list. The same goes for applying game state received through rejoin (7.10) or drop-in (7.12), and for a restart with `Web_Reset`. In GPU mode the host does not redraw the screen right after loading; the screen updates from the next frame.
- Multiplayer: devices in the same session can differ in GPU mode (WebGL2 or not, `webgba.gpu`, `Web_GpuStop`). Leave memory whose content depends on the mode (e.g. VRAM that only CPU drawing updates) out of state comparisons (hashes) between devices.

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
| `webgba.net` | Multiplayer — [chapter 7](#7-multiplayer) (7.4). An object when the manifest has `multiplayer`, otherwise `null` (also `null` in an older webGBA without multiplayer, and for a game whose `multiplayer.protocol` is higher than the host knows) |

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
| `rs` | (Optional) default RS button input — an array of steps (5.7). It becomes the user's preset 1 default and the RS button is shown. Without it, RS starts as Off |

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
- A ① game can stop auto fire on screens where it gets in the way (menus, battles, name entry and so on) by returning 1 from `Web_AutoFireOff()`; held buttons are then passed as held. When it returns 0 again, a held button starts auto fire from that frame as if newly pressed (its first frame is pressed, so there is no gap).

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
- **Web version layout**: the game screen is filled first (by width on portrait screens, by height on landscape screens), then the D-pad and buttons take the largest size that fits the space left. When space runs short (a C·D row, for example), the host **keeps the game screen size** and shrinks the gaps first, then the button scale, only as much as needed. The scale steps in device pixels (one pixel of button art = a whole number of device pixels), so buttons are never smoothed. On landscape screens the function buttons (file, quick slots, fast-forward, sound, settings, …) sit in one row each above the left and right columns.
- **Press A and B together** (web version): pressing between the A and B buttons, or one finger touching both, presses the role `a` and `b` buttons together (Settings › Press A and B together, on by default).
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

#### 5.7 Default RS button input `input.rs`

A game can give a default for input that presses several buttons in a set order and timing (a throw with A+B, a command, …). It becomes the user's preset 1 default; the user can change the steps or make other presets in the app (values the user saved win).

```json
"input": {
  "preset": "none",
  "buttons": [ … { "id": "P", "role": "a", "bit": 0 }, { "id": "K", "role": "b", "bit": 1 } … ],
  "rs": [ { "buttons": ["P", "K"], "hold": 6 } ]
}
```

| Step field | Description |
| --- | --- |
| `buttons` | **Required**. Button `id`s pressed together in this step (at least one, no duplicates). Only buttons whose role is `up` `down` `left` `right` `a` `b` `c` `d` `l` `r` `start` `select` (not `extra`, `l2`, `r2`). A diagonal is two directions together |
| `hold` | How long to hold (frames, 1–600, default 3) |
| `gap` | Wait before the next step (frames, 0–600, default 3). Ignored for the last step |

- 1–32 steps. Every `Web_RunFrame(keys)` (①) frame the host sends the step's button bits together with the user's input. In frames where the RS step has a direction, the RS direction replaces the user's direction (a diagonal passes as is, whatever the two-directions setting), and auto fire is not applied.
- The playback rules (one press = one playback, holding keeps the last step, any other key stops it from that frame) are host behaviour (Main features › RS button).
- `check` validates the format, ranges, button ids and roles.

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

> Multiplayer protocol 1. The current webGBA (Windows app and web version) connects players with **a 6-digit room code** (same Wi-Fi or other networks) and the same Wi-Fi's **nearby-room list** (matchmaking server), and when the server cannot be reached, by **exchanging connection codes (or QR) twice**. On networks where a direct connection does not work it goes through a Cloudflare relay server (TURN) (7.11). It opens games with `needs: ["net"]`, calls `Web_NetHost(1, 1)` (`Web_NetHost(1, 5)` for `rejoin` games), and gives ② games `webgba.net` when the manifest has `multiplayer`. Input sync (`sync: "inputs"`, 7.6) is not supported (`flags` bit 1 = 0).
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
| `sync` | `"messages"` \| `"inputs"` | no | `"messages"` | `"inputs"` = the host lines up everyone's keys every frame (7.6, optional feature — not supported by the current webGBA, which behaves as `"messages"`) |
| `inputDelay` | integer | no | `3` | With `sync: "inputs"`, how many frames later keys take effect (1–10) |
| `rejoin` | boolean | no | `false` | `true` = rejoin (7.10). A dropped guest's seat is kept until the session ends and the same device can come back to it |
| `join` | `"anytime"` | no | none (7.7 behavior) | `"anytime"` = drop-in game (7.12). The dialog does not open by itself when the game asks, there is no timeout, and players are taken for 2 min 30 s after the host creates the room or presses Renew (also with the dialog closed; the host can close it alone) |
| `iceServers` | array | no | none (webGBA default STUN + Cloudflare TURN) | The game's own connection servers (STUN/TURN, 7.11). When given, only this list is used instead of webGBA's defaults |
| `board` | object | no | none (people list only) | Game value columns of the player status board (7.9.1) |

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

Unknown keys are ignored. If `multiplayer.protocol` is higher than the host knows, the host turns multiplayer off and runs the game as usual. Then ① never gets `Web_NetHost` and ②'s `webgba.net` is `null` (the same as an older webGBA without multiplayer), and webGBA shows "This game's multiplayer needs a newer webGBA" in a notice when the game opens and on the multiplayer button (which opens the connection window). The file check (chapter 10) gives only a warning and does not check the other `multiplayer` entries. A missing `protocol` or one that is not an integer of 1 or more is an error.

#### 7.3 ① Web API — exported functions

All are **functions the game exports** and the host calls (no new imports → the game still opens on hosts that do not know multiplayer).
The game counts as supporting multiplayer only when all seven exist: `Web_NetWanted`, `Web_NetEvent`, `Web_NetOut`, `Web_NetOutLen`, `Web_NetOutClear`, `Web_NetInBuffer`, `Web_NetIn`. Pointers are addresses in wasm memory, all values little endian.

| Function | Shape | Called | Meaning |
|---|---|---|---|
| `Web_NetHost` | `(u32 protocol, u32 flags)` | Once after `Web_Init` | The host supports multiplayer protocol `protocol`. `flags` bit 0 = ordered broadcast available, bit 1 = `sync: "inputs"` available (0 in the current webGBA), bit 2 = rejoin (7.10) available (set only for games with manifest `rejoin: true`). **Not called means the host has no link** → the game should hide menus like "Play with friends". Optional |
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
| 9 | `REJOINED` | own seat | current count | `rejoin` games only. Sent to the returning device instead of `OPEN` (`a` = 0 on the host device when the host reopened the app and returned; a user who reopened the app and returned gets this event first, with no earlier `OPEN` or `HOLD`, 7.10.2) |

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
| `webgba.net.host` | `{ protocol, ordered, inputs, rejoin }` — the ① `Web_NetHost` (`rejoin` = bit 2; `inputs` is false in the current webGBA) |
| `webgba.net.onevent = (kind, a, b) => …` | Same numbers as 7.3.3 |
| `webgba.net.onrecv = (from, bytes) => …` | A received message (in order) |
| `webgba.net.onstate = (from, bytes) => …` | A received state bundle (7.10). In order with that sender's messages |

On hosts that do not know multiplayer, `webgba.net` itself is `null`. The current webGBA also gives `null` to games whose manifest has no `multiplayer` and to games whose `multiplayer.protocol` is higher than 1 (7.2).

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

> **The current webGBA does not support this feature** (① `Web_NetHost` `flags` bit 1 = 0, ② `webgba.net.host.inputs` = false, `Web_NetKeys` is never called). A game with `sync: "inputs"` behaves as `"messages"`. Games that need matching keys should build the same scheme (delay frames + wait until everyone's keys have arrived) themselves with messages (7.8).

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
┌ Multiplayer            [Trade · 2 players] [×] ┐
│ [ Join | Host a room ]                          │
│ Open rooms · updates automatically         [↻] │
│ ┌ Player 4821  ■□ 1/2 players      [Join] ┐    │
│ Join with room code                             │
│ [9][2][ ][ ][ ][ ]                  [> Join]   │
├─────────────────────────────────────────────────┤
│ My name Player 7730 [Change]  [> Connect without internet] │
└─────────────────────────────────────────────────┘

Host a room tab: [+ Host a room] → My room (big room code · Copy code · QR · user seats 1P~ · empty seats dashed)
                 bottom [Close room] [Renew] … [Back to game]  (× = close the window only, Close room = the room is gone)
Connection failed: cause + [Try again] [Connect without internet (code / QR)] [Start over] + things to check
Connect without internet — host:  ① give the host code (111 characters · QR) to the other player → ② enter their answer code and connect
                           join:  ① enter the host code and press Next → ② give the answer code (· QR) to the host
```

- The last tab picked (Join · Host a room) is remembered and opens next time. A room code goes into 6 cells as digits; from pasted text only the digits are used. A wrong code turns the cells red and can be retyped in place.
- In the PC version (exe) popup buttons are upper-case English: JOIN (open room) · ENTER (room code) · EDIT (name) · OFFLINE (connect without internet) · CREATE (host a room) · COPY · QR · CLOSE ROOM · RENEW · DONE · RETRY · BACK, and LEAVE · INVITE on the status board. Help texts use the same button names (e.g. "press RENEW").

- Connection codes never pass through a server. A code carries local addresses (mDNS names, private IPv4, IPv6 ULA, link-local) and public address candidates from STUN (no matchmaking server is used, so no default TURN credentials — 7.11). A prflx candidate (learned from a connectivity check when the other side could not resolve an mDNS name, as happens between a PC and a phone on the same Wi-Fi) is accepted too.
- A code is for one person, once. For 3 or more players the host makes a new host code per player (used codes and answer codes for another invite are refused).
- Requests with a fixed role (create only, join only) start on that screen.
- When the minimum player count is reached, it shows "Connected" and closes after 1 second. Any further confirmation (e.g. "Press A to start") happens inside the game.
- Until the maximum is reached, the room host keeps a small indicator ("2/4 · waiting"); more players arrive as `JOIN`.
- `JOIN`, the player count and the count in the room list change only after the joining device reports that it accepted its seat. A player who drops before that does not keep a seat (no `HOLD`).
- Cancel → `CLOSED(CANCEL)`. Not found in time (3 minutes by default) → `CLOSED(TIMEOUT)`. If the game ends the link first, the dialog closes quietly. `join: "anytime"` games differ (7.12).
- Help when connecting fails: a cause banner (including the symmetric NAT notice, 7.11) + a "Things to check" list (same Wi-Fi · guest or public Wi-Fi · VPN and mobile data · mesh Wi-Fi and client isolation · PC firewall).

During a session the host keeps to: fast-forward and speed changes off (1×), quick slots (saving and loading states), web auto save and reset blocked (the game's own save stays as it is), opening another game = end of session (`LEFT`). Pausing or leaving the app → `STALL` to the others (not when only the tab is hidden on a PC: frames keep running), `RESUME` on return, dropped (`LOST`) if not back within a set time (15 seconds by default). A small status in a screen corner (players, connection state). The nickname is a user setting; IP addresses and device names are never shown.

#### 7.8 For game authors

- If the same keys and messages always give the same result (random numbers from a seed inside the game), `TO_ORDERED` alone keeps everyone in the same state.
- Messages arrive between frames, so queue them and process them inside a frame.
- Games that keep keys in step (lockstep) send their own keys for frame f with the frame number, apply them at f + a delay (such as 7.6's default of 3 frames), and do not advance frame f until everyone's keys for f have arrived (the same scheme as 7.6; the current webGBA has no host input sync, so the game does it). Only frames with everyone's keys advance, so even with a slow device the devices never drift apart by more than the delay. Line up the first frame with a "start" message from the room host.
- `STALL` can be temporary, so wait instead of dropping the player at once. If the player is not back within 15 seconds (default), the host sends `LEAVE(LOST)` (`CLOSED` when the room host dropped, `HOLD` in rejoin games, 7.10).
- If the host does not know multiplayer (`Web_NetHost` never called / `webgba.net` is `null`), hide the link menus (older webGBA).
- Examples: `docs/wgba/examples/net-webapi/` (① small C, no ROM) and `net-script/` (② one JS file) — A looks for players, the host's START runs one round, everyone ends with the same hash, and both fill the player status board (7.9). A ② example without multiplayer is `hello-script/` (drawing, keys, save, quick slots).
- By default only the same game build can connect (`compat: "exact"`). If different versions share the same link rules, put the same string in `compat`.
- Do not send ROMs or other people's works in messages.

#### 7.9 Player status board

During a session webGBA shows the current players in the "Multiplayer" menu. webGBA fills the seat number, nickname, room host, connection state and latency (round trip to the room host, ms); the game may add values per player (HP, level, rank, state, …). The list shows even if the game gives nothing.

Opening it: web = the "Multiplayer" button above the screen during a session (where fast-forward was), PC version (exe) = the "Multiplayer" button in the left tool bar or Tab (shown while held; a short press keeps it open). The game keeps running while the menu is open, and the menu never opens by itself when a game ends (closed by default).

Where it shows: on a landscape web screen in a column right of the game screen (the game screen shrinks by that much so nothing is covered; with on-screen buttons the layout is [D-pad | game | status board | A·B buttons], so you can play with it open), on a portrait web screen as a sheet below the game screen (covering the on-screen buttons — close it to play again), and in the PC version as the left panel. The header shows "Room <code>" and the player count; rows are the same user seats as in the connection window's waiting room (seat, nickname, host, me, lost, latency, empty seats dashed — no empty seats in games with AI rows); one line under the table shows the game caption (`captions`) and the `mark` legend; at the bottom are "Leave room" ("Close room" for the host) and the host's "Invite code" (when a seat is free; opens the room code / connection code screens of the connection window).

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
- A drop of the host device's network is repaired only within 15 seconds. Beyond that the session ends: host `CLOSED(LOST)`, guests `CLOSED(HOST_LEFT)`. When the host closes the app, see 7.10.1 (reopen within 2 minutes to return to the same room); when a user closes the app, see 7.10.2 (open the same game again on the same device to return to the same seat).
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

##### 7.10.2 User return

In a `rejoin` game, when a user who joined by room code closes the app (window or tab closed, reload, crash) or loses the connection, the host keeps the seat (`HOLD`). When the user opens the same game (same game id and version) again on the same device, the first screen of the multiplayer window shows **Return to previous room** (room code and host name); it rejoins the same seat of the same room (the same path as 7.10).

- During the session the user device keeps the seat information (room code, seat, seat key, join ticket) on the device (web `localStorage`, exe settings file) and deletes it when the session ends (leave, host left, continue alone, another game). Ten minutes after it was last kept it is no longer shown.
- Events: the host and other devices get `BACK(s)`, the returning device `REJOINED(s)` (a freshly opened game, so no `OPEN` or `HOLD`). The host game sends a state bundle as in 7.10.
- Making a new room or joining another room instead deletes the seat information and tells the host (the same notice as continue alone), which frees the kept seat.
- If the host has ended the session meanwhile, the attempt ends with `CLOSED(HOST_LEFT)`.

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
- Multiplayer: `multiplayer.protocol` 1 (an integer above 1 = warning — runs without multiplayer and the other `multiplayer` entries are not checked / missing or not an integer of 1 or more = error), `purposes[].id` rule and no duplicates, players 2–8, `rejoin` boolean, `join` (`"anytime"` only), `iceServers` (7.11 format = error, fixed TURN credentials = warning), `board` (7.9.1 format = error, unknown keys = warning), and in ① a warning when only one of `Web_NetBoard` and `multiplayer.board` exists
- ②: a `js` chunk exists, `entry.style`, `entry.js` other than `"js"` → warning, a `code` on every button, no imported shared memory (threads)
- `update` (when present): an object, `feed` an `https://` address (up to 512 characters), `key` a base64 P-256 public key (88 characters, starting with `04`) — otherwise an error
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
| Multiplayer protocol `multiplayer.protocol` (now 1) | When the link protocol changes | If higher than the host supports, only multiplayer is turned off and the game runs; the multiplayer button and connection window say a newer webGBA is needed (7.2) |
| ROM chunk WGRM format (now 1) | When the ROM header changes | Unknown → not opened |
| Game `version` | Up to the author (when content changes) | Used only to decide updates and for display |

Older files: webGBA keeps opening `.wgba` files with no TOC or manifest (plain wasm, or with only `webgba.rom` at the end). They are treated as ① · 240×160 · GBA buttons, named after the file.

---

### 12. Online updates (`update`, spec 1 extension)

An optional feature that lets players apply a new version of a `.wgba` you released without downloading the file again. You put a **version file** and **delta patches** on a static file server (for example a public Cloudflare R2 bucket); webGBA checks once each time the app starts and applies an update only when the player presses "Update". No server program is needed (plain static `GET`).

#### 12.1 Manifest `update`

| Field | Type | Description |
| --- | --- | --- |
| `feed` | string | Address of the version file. `https://` only (up to 512 characters). E.g. `https://pub-0123abcd.r2.dev/io.github.someone.mygame/latest.json` |
| `key` | string | Signing public key — ECDSA P-256, the uncompressed 65-byte point (`04` ‖ X ‖ Y) in base64 (standard, with `=`, 88 characters). Printed by `wgba.mjs keygen` |

- The server allows CORS `GET` on the version file, patches and `.wgbp` (origins `https://webgba.vercel.app` and `http://ui.localhost`, or `*`).
- Response headers: version file `Cache-Control: no-cache`; patches and `.wgbp` use content-hash names and `public, max-age=31536000, immutable`.
- Games in the table of known game ids inside webGBA (added at the author's request) use the table's address and key first — so released `.wgba` files without `update` are checked too, and the server address can be moved with a webGBA update.
- If you lose the private key you cannot publish new version files for that `key`. Changing the key means players download a `.wgba` with the new `key` once by hand.

#### 12.2 Version file `latest.json`

Envelope (UTF-8 JSON):

```json
{ "wgbaFeed": 1, "signed": "<signed JSON text>", "signature": "<base64, 64 bytes>" }
```

- `signature` = ECDSA P-256 / SHA-256 signature over the `signed` text (its UTF-8 bytes as is), r ‖ s 32 bytes each (IEEE P1363 — the format WebCrypto `verify` takes).
- The host parses `signed` as JSON only when the signature matches. Other envelope fields and whitespace are not signed. An unknown `wgbaFeed` number is ignored.

`signed` content:

| Field | Description |
| --- | --- |
| `id` | Game id (must equal the manifest `id`) |
| `version` | New version `x.y.z` |
| `time` | Optional. Creation time (ISO 8601) |
| `wgba` | `{ "sha1", "size" }` — SHA-1 (40 lowercase hex digits) and size of the whole new `.wgba` file |
| `from` | Array (up to 256). `{ "sha1", "version", "to", "patch": { "url", "size", "sha256" } }` = applying `patch` to the `.wgba` whose file SHA-1 is `sha1` gives SHA-1 `to`. If `to` is not the new version, the host looks `to` up again and continues (skipped versions are chained, up to 64 steps). With several entries for the same `sha1`, the path with the fewest steps (then the smallest download) is used — webGBA 0.8.0 and earlier use the entry whose `to` is the new version first |
| `full` | Optional. `{ "url", "size", "sha256" }` — a `.wgbp` for a full install. A file missing from `from` is rebuilt with this `.wgbp` from the original ROM the player picks |
| `notes` | Optional. Text per language (reserved — current webGBA does not show it) |

- `url` is relative to the version file address, or an absolute `https://` address. `sha256` is the SHA-256 (64 lowercase hex digits) of the whole downloaded file.
- Direct patches: an entry from each old version straight to the new version (`to` = new version) makes one update = one patch download. `wgba.mjs feed --old` creates them.

#### 12.2.1 Update index `index.json` (webGBA 0.8.1+)

For games in the known game id table, each app start reads one **index** at the top of the bucket instead of a `latest.json` per game (one request regardless of the number of games). The index carries each game's `latest.json` envelope unchanged and is signed itself.

```json
{
 "wgbaIndex": 1,
 "signed": "{\"time\":\"2026-11-06T04:16:10Z\",\"feeds\":{\"<game id>\":\"<SHA-256>\"}}",
 "signature": "<base64, 64 bytes>",
 "feeds": { "<game id>": { "wgbaFeed": 1, "signed": "…", "signature": "…" } }
}
```

| Field | Description |
| --- | --- |
| `signed.time` | Index creation time (ISO 8601). The host remembers the latest time seen per index address and ignores an index older than that (protection against rolling back to an old index) |
| `signed.feeds` | Game id → SHA-256 (64 lowercase hex digits) of that game's envelope `signed` text (UTF-8 bytes) |
| `feeds` | Game id → the same envelope as `<game id>/latest.json`. The host checks the hash, then the signature and content as in 12.2. Relative `url` values resolve against `<index folder>/<game id>/latest.json` |

- Signature = ECDSA P-256/SHA-256 over the `signed` text (same key and format as 12.2). The index is at most 1 MiB.
- Fallback: when the index is missing (404 etc.), has an unknown `wgbaIndex`, a bad signature, an older time, lacks the game or has a wrong hash, that game reads its own `latest.json`. When the server cannot be reached (offline) there is no fallback.
- webGBA 0.8.0 and earlier do not read the index, so the per-game `latest.json` keeps being published. Version files at other addresses from manifest `update` are read per game as before.
- Optional fields `apps` (envelopes) and `signed.apps` (hashes) = the webGBA self-update entry (12.6, from 0.9.0). 0.8.1 and earlier do not read them.

#### 12.3 Delta patch `.wgbd`

Little endian:

| Offset | Size | Content |
| --- | --- | --- |
| 0 | 4 | `WGBD` |
| 4 | 2 | Header length (72 + meta length) |
| 6 | 1 | Format number 1 |
| 7 | 1 | Flags: bit 0 = expanded source, bit 1 = rebuild the ROM |
| 8 · 12 | 4 · 4 | Old file size · new file size |
| 16 · 36 | 20 · 20 | Old file SHA-1 · new file SHA-1 |
| 56 · 60 | 4 · 4 | Body length · unpacked body length |
| 64 | 4 | Prefix length (with bit 1) |
| 68 · 69 | 1 · 1 | ROM compression level · ROM compression (0 none · 1 zlib) (with bit 1) |
| 70 | 2 | Meta length n |
| 72 | n | Meta — UTF-8 JSON `{ "id", "from", "to" }` (for display) |
| 72 + n | rest | Body = a BPS patch compressed with zlib (RFC 1950) |

- Source (BPS source) = the old file. With bit 0: old file ‖ the unpacked ROM of the old ROM chunk.
- Without bit 1 the BPS result is the new file. With bit 1 the BPS result is the start of the new file (up to where the ROM chunk content begins, length at offset 64) ‖ the new ROM; the new ROM is packed again as WGRM 1 (2.2, compression at offset 69, level at offset 68, pako) and appended. The ROM chunk is stored with zlib, so even a small ROM change alters most compressed bytes — unpacked ROMs are compared instead.
- After applying, the size and SHA-1 must match the header (the BPS CRC32s are checked too).

#### 12.4 Host behavior

- Once each time the app starts (opening the web page, starting the Windows app), when online. Checked files = `.wgba` in the web version's library; in the Windows app, `.wgba` among favorites, recent files and the current folder. Games in the known game id table read the index (12.2.1) once; for other games each version file is downloaded once. No further checks while the app runs.
- Path = the chain with the fewest steps (then the smallest download). With a direct patch it is one step.
- Offline, failed downloads and signature mismatches are skipped without a notice (logged only).
- The update window appears only when a new version exists: per row the cartridge art, name, current version → new version, size and an "Update" button; below, update the checked games and later. After closing it, for the rest of that run the library (in the Windows app, rows on the start screen and side list) and the info screen keep an update mark and button.
- If the file SHA-1 is not in `from` and there is no `full`, nothing is shown in the update window, library or info screen (log only). Only players who have a `.wgba` with a patch path see the update.
- Apply = download (size, SHA-256) → apply → result SHA-1 = `wgba.sha1` of the version file → replace (the Windows app writes a temporary file first, then swaps it in). On failure the current file stays as it is.
- Saves carry over (web = by game id, Windows app = `.sav` next to the file). Quick slots record the version they were made in; slots from another version are not loaded (they stay until overwritten).
- A running game is updated after quitting it.
- No request goes to the webGBA web server during an update — the version file and patches come straight from the `feed` server.

#### 12.5 Release tools

```text
node tools/wgba.mjs keygen -o <private key outside the repository.pem>
node tools/wgba.mjs diff <old.wgba> <new.wgba> -o <patch.wgbd> [--orig <original ROM>]…
node tools/wgba.mjs feed --dir <publish folder> --key <private key.pem> --wgba <new.wgba> [--patch <patch.wgbd>]… [--old <old.wgba|folder>]… [--orig <original ROM>]… [--full <new.wgbp>] [--notes <text.json>] [--prev <latest.json>] [--no-index]
node tools/wgba.mjs app --dir <publish root>/com.flightrabbit.webgba --key <private key.pem> --exe <webgba.exe> [--file <LICENSE etc.>]… [--notes <text.json>] [--no-index] [--dry-run]
node tools/wgba.mjs index --root <publish root> --key <private key.pem>
node tools/wgba.mjs verify <publish folder|root> (--pub <public key> | --key <private key.pem>) [--wgba <old.wgba>]…
node tools/wgba.mjs upload [<publish folder|root>] [--wgba <new.wgba>]… [--dry-run [--remote]]
node tools/wgba.mjs admin-key [--dry-run]
node tools/wgba.mjs r2-stats [--days <days> | --since <ISO time> [--until <ISO time>]] [--top <rows>]
```

- Publish root = the same layout as the top of the bucket (`index.json` · `<game id>/…`).

- `keygen`: stores the private key only outside a git repository (refused inside one) and prints only the public key.
- `diff`: same id and a higher version only. Applies the result and checks that it matches the new file byte for byte. With `--orig`, checks whether the bytes newly carried by the patch contain a run of 32 bytes or more equal to the original ROM, and writes no patch if so (that version is released as a `.wgbp` full install only). Between versions with the same ROM the source is the old file only; if the new code carries ROM bytes and fails the check, the patch is made again with the expanded source (bit 0) so those bytes are copied from the old ROM (BPS SourceCopy).
- `feed`: publish folder = the same layout as `<game id>/` in the bucket (`latest.json` · `patches/<SHA-256>.wgbd` · `full/<SHA-256>.wgbp`). Carries over the `from` table of the previous `latest.json` in the publish folder (`--prev` picks another file), checks that every previous version reaches the new one, then signs. Running it again with the same `.wgba` keeps `full` and `notes`.
  - `--old` (files, or the `.wgba` files in a folder): creates a direct patch from each lower version with the same id to the new version. If the new file contains a ROM, `--orig` is required, and a patch with a run equal to the original ROM is not written (that old version keeps its existing step chain). For an old version that gets a direct patch, its previous skipping entries (entries to something other than the next version) are removed from `from` — step entries stay, files are left as they are.
  - If the root (the parent of the publish folder) has an `index.json`, the index is rebuilt too (`--no-index` turns this off).
- `index`: creates `index.json` with every `<game id>/latest.json` in the root signed by the same key. Its time is never earlier than the existing index.
- `verify`: signature, file sizes and SHA-256; for each old file given with `--wgba`, applies the whole chain and compares with the new SHA-1. For a root it also checks the index signature and that each index entry equals the game's `latest.json` (old files are matched to games by id); for a game folder, the entry for that game in the parent's index.
- `upload`: S3-compatible API (R2); patches and `.wgbp` first, then `latest.json`, `index.json` last (objects already in the bucket with the same content — size and ETag MD5 — are skipped, so unchanged `latest.json` files are not rewritten). The bucket is checked with one object listing (ListObjectsV2, one request per 1,000 objects = Class A); only when the listing fails does it check each file with HEAD (Class B). `--dry-run` does not connect to the bucket; `--dry-run --remote` only compares with the bucket through one listing (no writes). If the root has an `index.json`, the whole root is uploaded even when a game folder is given, and nothing is uploaded if the index and a `latest.json` differ. Account and keys are read only from the environment variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`, and their values are never printed.
- `r2-stats`: prints R2 request counts from the Cloudflare analytics API (GraphQL `r2OperationsAdaptiveGroups`) per Korean date and per object, action and response code (no bucket requests, 7 days by default, 31 at most). The source is guessed from the object name — `index.json` = webGBA 0.8.1 or later, `<game id>/latest.json` = 0.8.0 or earlier (or the fallback when the index fails), `patches/`·`full/` = update downloads, HeadObject = the earlier `upload` or the dashboard, 404 and other objects = likely outside requests. Environment variables `CF_API_TOKEN` (an API token with Account Analytics read), `R2_ACCOUNT_ID` and `R2_BUCKET` (whole account when absent); values are never printed.
- `upload --wgba`: uploads full `.wgba` files to `wgba/<game id>/<version>.wgba` in the private bucket (admin mode "Import ROMs" only, public URL off), regardless of the source file name. The saved file name on download also comes from the game id, not the bucket object name — Rapid `pokemon-rapid-v.<version>.wgba`, others the English name in lowercase with hyphens (exceptions in the `api/_admin/save-name.js` table). Skips files with the same size and ETag; one listing request checks the bucket. `--wgba` alone works without a publish folder. After uploading it deletes older versions of the same game and rewrites `roms.json` in the public bucket (the Import ROMs list: name, version, saved file name, label image and private key of the latest version of each game; `private-prune` does the same). The server list reads only this file, once. Environment variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_BUCKET`, `R2_BUCKET`.
- `admin-key`: reads the 6-character admin code (0–9, `!`, `#`) twice, showing only `•`, and uploads its SHA-256 to `authentication.key` in the private bucket (`{"sha256":"…","updated":"YYYY-MM-DD HH:mm"}`, Korea time). The code and the hash are never printed (a 6-character code can be recovered from its hash at once, so the key file is secret too). Admin mode enabled before the updated time asks for the code again at "Import ROMs". Takes up to a minute to reach the server. The file can also be edited by hand (a future time is refused).
- `app`: publishes a webGBA self-update for the Windows app (12.6). `index`, `verify` and `upload` also handle the app folder in the root.

#### 12.6 webGBA self-update (Windows app)

For the webGBA operator (game authors don't use this). Applies to the webGBA Windows app 0.9.0 and later. The web version is not covered.

- Check: at the same time and from the same `index.json` as the `.wgba` check — `apps` (envelopes) and `signed.apps` (SHA-256 of each envelope's `signed` text). One app start is still one request. Only when the index fails (404, signature, time or hash) does it read `com.flightrabbit.webgba/latest.json`; an index without an app entry causes no extra request.
- Envelope `{ "wgbaApp": 1, "signed": "<signed JSON text>", "signature": "<base64, 64 bytes>" }` — signature = same key and format as 12.2.

| `signed` field | Description |
| --- | --- |
| `id` | `com.flightrabbit.webgba` |
| `version` | New version `x.y.z`. Shown only when it is higher than the running app |
| `time` | Optional. Creation time (ISO 8601) |
| `platform` | `windows-x64` |
| `files` | Array (up to 16). `{ "path", "size", "sha256", "get": { "url", "size", "sha256" } }` — `path` = relative to the exe folder (segments of letters, digits and `._-`; nothing under `bin/`, no parent folders, no names ending in `.old`); `webgba.exe` (the running exe, even if renamed) is required. `get` = the file compressed with zlib (RFC 1950), same relative address rule as 12.2 |
| `notes` | Optional. Text per language (reserved) |

- Download: only files whose local SHA-256 differs → size and SHA-256 of the download → size and SHA-256 of the inflated file. The core in `bin/core` is embedded in the exe and replaced when the new exe starts (a core replaced by hand is kept).
- Replace: downloads go to `.webgba-update\` in the exe folder → the new exe runs with `--webgba-version` and must print `webGBA <version>` equal to `version` → for each file the current file is renamed to `<name>.old` and the download takes the original name (any failure rolls everything back) → the new exe starts (a failure rolls back) → the current app exits normally. The new exe waits for the old process to end, and deletes the `.old` files and `.webgba-update\` once its screen is up.
- Kept: `bin/` (settings, logs, quick slots, WebView data) and the `.sav` next to each game are never replaced. When the exe folder is not writable, the update fails with a message.
- Publish: `wgba.mjs app` — reads the version by running the exe with `--webgba-version` (an exe without this feature is refused), refuses exes built with a test identifier (allowed only with `--test-id`), adds the repository `LICENSE` and `THIRD_PARTY_NOTICES` when no `--file` is given, writes `files/<compressed SHA-256>.z` per file, refuses a version lower than the previous publish or the same version with different files, and rebuilds the index when the root has `index.json` (`--no-index` turns this off). Upload order = compressed files → `latest.json` → `index.json`.

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
- Whether it has multiplayer: players (2–8) and purposes (trade, battle, …), whether the game also runs without multiplayer, whether dropped users need to rejoin or players need to drop in, and how the game keeps devices in the same state (message order / key lockstep)
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
- Optional: shortName (16 characters, same language entries as name), description, author, license, homepage (https:// only), contact, build, needs (from ["pointer","net","keyboard","state"]), screen{width,height (1–1024, default 240·160), scale ("fit"·"integer")}, display{aspect ("W:H" display ratio, e.g. "4:3" — stretched when it differs from the screen buffer)}, save{kind,maxSize,files}, pointer{use}, input{preset,buttons,keyboard,dpad ("latest"·"opposite"·"both" default for directions pressed together)}, cart{color, label, front{labelAt}, spine{textArea}}, rom{required}, entry{style,js,args}, files, multiplayer (see [Multiplayer] below). Unknown fields are ignored; if a value outside the spec is really needed, use a name starting with "x-".
- For runtime "webapi" without a ROM chunk you must write "rom": {"required": false} (otherwise webGBA asks the user to pick a ROM file).
- Write cart.label/front/spine as {"chunk":"cart.label|cart.front|cart.spine","format":"png|webp","width":…,"height":…} matching the pictures, leave out entries for pictures you do not include, and put labelAt [x,y] (default [3k,5k]) on the front and textArea [x,y,w,h] (the host writes the short name vertically there; no text if absent) on the spine.
- The current webGBA ignores screen.fps, audio and state.use (it always runs at about 59.7275 fps). It supports all four needs values. Put "net" in needs only for a game that cannot run without multiplayer (an older webGBA without multiplayer does not open it).

[runtime "webapi" — no JS, the host runs the wasm directly]
- Required exports: memory, Web_Init() -> i32 (0 = failure), Web_RunFrame(keys) -> i32 (0 = stopped; keys = bits of pressed buttons), Web_GetFramebuffer() -> i32 (width×height pixels, R,G,B,A bytes each).
- Optional: Web_SetAudioRate(rate)·Web_GetAudioBuffer()·Web_GetAudioCount() (float32 stereo interleaved, count = number of left/right pairs) / Web_GetFlash()·Web_GetSaveSize()·Web_SetSaveSize(n)·Web_FlashClear()·Web_TakeFlashDirty() (save) / Web_RomBuffer(size) (where to place the ROM) / Web_Reset() / Web_StateSize()·Web_StateSave(at)·Web_StateLoad(at)·Web_Alloc(n)·Web_Free(at) (quick slots need all five; Web_StateUsed() optional) / Web_Pointer(x,y,buttons,wheel)·Web_PointerWanted() / Web_AutoFireOff() (1 = the user's auto fire stops and held buttons pass as held — menus, battles) / Web_GetHaltReason()·Web_GetTitle()·Web_SetTimeZone(sec) / Web_Net* (multiplayer, see [Multiplayer] below) / Web_Gpu* (GPU drawing, see [GPU drawing] below).
- Only these imports: env.{emscripten_asm_const_int, emscripten_resize_heap, _emscripten_throw_longjmp, emscripten_date_now, emscripten_get_now, emscripten_notify_memory_growth, abort, _abort_js, invoke_*}, wasi_snapshot_preview1.{fd_write, fd_read, fd_close, fd_seek, fd_sync, fd_fdstat_get, environ_get, environ_sizes_get, clock_time_get, random_get, proc_exit}, webgba.v1 (() -> (), does nothing). Any other import → make it runtime "script".
- Games that are not 240×160 with GBA buttons, or that run without a ROM, import webgba.v1 (so older webGBA refuses them). In C: __attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void); called once in Web_Init.
- Sequence: instantiate → __wasm_call_ctors (or else _initialize) → ROM → save → Web_Init → Web_RunFrame every frame. Do not grow memory a lot after Web_Init.
- Every button has a bit (0–31). If the buttons are the GBA ones, use "input": {"preset":"gba"} (A=0 B=1 SELECT=2 START=3 RIGHT=4 LEFT=5 UP=6 DOWN=7 R=8 L=9). If not, you must write "input": {"preset":"none", "buttons":[…every button…]} — the webapi preset default is "gba", so leaving preset out appends my buttons after the 10 GBA buttons and bits and roles collide (validation error). To add only a few buttons to the 10 GBA ones, use preset "gba" + the extra buttons (unused bits and roles, e.g. c=10 d=11).

[GPU drawing — optional (spec 4.1.4, webGBA 0.8.0 and later, runtime "webapi" only)]
- For games that are too heavy to draw on the CPU: the screen is drawn with WebGL2. The game supplies the shaders (GLSL ES 3.00 source), and the host runs, in order, the command list the game wrote into wasm memory. No new imports and no manifest entry.
- Exports: Web_GpuStart(version)→i32 · Web_GpuList()→ptr · Web_GpuListLen()→u32 (number of u32 words) · Web_GpuListDone() · Web_GpuSync(reason) · Web_GpuStop() · Web_GpuOverlay()→i32. GPU drawing is used only when the first four are all present. The check tool does not inspect Web_Gpu*, so confirm the four by hand.
- Call order: Web_Init → the host creates a WebGL2 context and calls Web_GpuStart(1) → 1 = GPU mode, 0 = the usual way (called again when a restart creates a new instance). In GPU mode, after every Web_RunFrame: Web_GpuList() → Web_GpuListLen() → run the list → Web_GpuListDone(). The game keeps appending to the list frame by frame and does not clear it until Web_GpuListDone is called (the host may run several frames' worth at once).
- Showing: picture = output target 0 (screen.width×height RGBA8, GL coordinates — row 0 is the bottom). Web_GpuOverlay(): 0 = the output as is · 1 = Web_GetFramebuffer composited on top (overlay, premultiplied alpha, row 0 is the top) · 2 = Web_GetFramebuffer draws this frame.
- Command record (u32 words, back to back) = first word opcode | word count << 8 (the count includes the first word) followed by the values. Addresses are byte offsets in wasm memory; floats are f32 bits.
  1 PROGRAM: id, vertex shader address·length, fragment shader address·length, number of instance attributes (one ivec4 each, from location 0), uniform name list (NUL separated) address·length — uniform number = order in the list
  2 TEXTURE: id (1 or more), format (1 RGBA8 · 2 RGB10_A2 · 3 R16UI), width, height — NEAREST, CLAMP_TO_EDGE
  3 TARGET: texture id (0 = output), viewport x·y·w·h
  4 BLEND: enable (0·1), equation RGB·A (0 ADD · 1 SUBTRACT · 2 REVERSE_SUBTRACT), factors srcRGB·dstRGB·srcA·dstA (0 ZERO · 1 ONE · 2 SRC_COLOR · 3 ONE_MINUS_SRC_COLOR · 4 DST_COLOR · 5 ONE_MINUS_DST_COLOR · 6 SRC_ALPHA · 7 ONE_MINUS_SRC_ALPHA · 8 DST_ALPHA · 9 ONE_MINUS_DST_ALPHA · 10 CONSTANT_COLOR · 11 ONE_MINUS_CONSTANT_COLOR · 12 CONSTANT_ALPHA · 13 ONE_MINUS_CONSTANT_ALPHA), constant color r·g·b·a (f32)
  5 UNIFORM: program id, uniform number, type (0 int · 1 float), count (1–4), values
  6 TEXBIND: texture unit, texture id
  7 DRAW: program id, vertices per instance (TRIANGLES), instance count, instance data address (0 = no attributes), instance stride (bytes)
  8 UPLOAD: texture id, x·y·w·h, format, data address, row length (pixels)
  9 COPY: source·destination texture id, source x·y, destination x·y, w·h (same format)
  10 READ: texture id, x·y·w·h, format (1 RGBA8), memory address — the host finishes writing while it runs the list
  An unknown opcode makes the host stop GPU mode.
- Drawing: there is no vertex buffer — the vertex shader computes positions from gl_VertexID. Record of instance i = instance data address + i×stride; attribute a = the 4 INTs at byte offset a×16 in the record (shader: layout(location = a) in ivec4). DRAW with instance count 0 = nothing drawn; address 0 = drawn once whatever the instance count.
- GL state: only programs (with their uniform values) and textures (with their content) carry over between lists. Blending is disabled at the end of every list, and showing the screen changes the output target (with overlay 1 also the viewport, texture bindings and program), so write TARGET, TEXBIND and BLEND at the start of every list. Inside a list too, TEXTURE and UPLOAD change the current unit's texture binding, and COPY and READ change the output target.
- Quick slots: before saving, the host calls Web_GpuSync(1) → runs the list → Web_StateSave. At Web_GpuSync(1) the game writes a READ into the list that copies the GPU picture into memory. Only reason 1 is defined.
- Applying a state: on quick-slot load, state applied through rejoin or drop-in, and Web_Reset, the host does nothing on the GPU side (programs and textures stay as they are). The game writes the UPLOADs that bring the textures back in line with the state into the next list.
- Fallback: a browser without WebGL2, or a webGBA that does not know this feature, never calls Web_GpuStart. If the list cannot be run (lost context, shader error, unknown opcode), the host calls Web_GpuStop() and shows the screen the usual way. In the web version, when webgba.gpu in localStorage is "0", the host does not start GPU mode (for testing). So the game draws into Web_GetFramebuffer on the CPU until Web_GpuStart returns 1, and again from the frame after Web_GpuStop. Without Web_GpuSync or Web_GpuStop the host skips the call; without Web_GpuOverlay it treats it as 0.
- Multiplayer note: devices in the same session can differ (GPU mode on one, CPU drawing on another). So keep game progress independent of drawing results, and leave memory whose content depends on the mode (e.g. VRAM that only CPU drawing updates) out of state comparisons (hashes) between devices.

[runtime "script" — games with their own JS]
- The JS runs inside an origin-less sandbox iframe (srcdoc). It cannot use the network (fetch, XHR, WebSocket, WebRTC), IndexedDB, cookies, real localStorage, popups, top-window navigation or threads (SharedArrayBuffer, pthreads) (multiplayer goes through webgba.net). localStorage is an in-memory substitute.
- entry is required. The JS chunk is always named "js" (leave out entry.js). entry.style "module": the JS exports export default async function start(webgba){…}. "emscripten": emscripten glue (plain, MODULARIZE or EXPORT_ES6) — the frame passes Module{canvas, wasmBinary, locateFile, arguments, print, printErr, preRun, onRuntimeInitialized, onAbort}. Data files go through the files table ({"file name":"data.<name>" or "rom"}), including the .data of --preload-file. Recommended build: -sENVIRONMENT=web -sEXPORTED_RUNTIME_METHODS=FS.
- The webgba object: version (1), manifest, lang, canvas (#canvas, screen size), wasm()→ArrayBuffer, wasmModule(), chunk(name)→Uint8Array, chunkURL(name)→blob: address, save.read()/save.write(bytes) (only with save.kind "storage"), state.onSave(fn→Uint8Array)/state.onLoad(fn(bytes)→true|false) (both needed for quick slots), input.held, on("button"|"pause"|"resume"|"speed", fn), audioContext(), ready() (call it when start-up is done), exit(reason), log(level,text), net (the multiplayer object when the manifest has multiplayer, otherwise null — see [Multiplayer] below).
- save.kind: "storage" (default, webgba.save), "localStorage" (the frame's whole localStorage is the save), "files" (path save.files[0] in emscripten FS, FS must be exported), "none". maxSize default 1MB, up to 16MB.
- Every button has a code (the KeyboardEvent.code the game listens for). The host turns the keys the user presses into keydown/keyup events with this code (isTrusted is false, so do not check it). The preset default is "none".

[Buttons]
- Button = {id (letters, digits, _, -, 16 characters), role, label, bit (webapi) or code (script), keys (default keys, up to 4 KeyboardEvent.code values), pad (gamepad button numbers, "+axis1" etc.), touch ("auto"·"hide")}. Up to 32 for webapi, 24 for script.
- role: up down left right, face a b c d (at most 4), l r l2 r2, start select, extra. Except extra, one button per role. To use C·D, define buttons with role c·d — only then do they appear in the touch row right above A·B. Without them only A·B appear.
- Default keys come from the role (a=Z·K, b=X·J, c=C·I, d=V·U, l=A, r=S, l2=Q, r2=W, start=Enter, select=Backspace·right Shift, directions=arrow keys). Do not put host keys (Space, Tab, Escape, Pause, F1–F12, P) in keys.
- (Optional) input.rs = default RS button input: an array of 1–32 steps [{buttons:[button id…] (pressed together; only buttons whose role is a direction, a, b, c, d, l, r, start or select), hold (frames held, 1–600, default 3), gap (frames before the next step, 0–600, default 3)}]. Example: a throw with A+B = [{"buttons":["P","K"],"hold":6}].

[Multiplayer — protocol 1, supported by the current webGBA (Windows app and web version)]
- webGBA does the connecting: 6-digit room code, nearby rooms on the same Wi-Fi, connection codes (QR). A direct device-to-device connection (WebRTC) is tried first; networks where that fails go through a Cloudflare relay server (TURN; content stays DTLS-encrypted). The game only asks for "I need players", sends and receives bytes, and handles events. The game never opens network connections itself (WebSocket, WebRTC, fetch).
- Session = one room, 2–8 players. Room host = slot 0, then 1, 2, … in join order. Messages are never lost and keep each sender's order; one message is up to 16384 bytes; keep each frame's total sends at 65536 bytes or less. Only the same game connects (compat).
- Manifest "multiplayer": protocol 1 (required — when it is higher than the host knows, the host turns only multiplayer off and runs the game: ① no Web_NetHost call, ② webgba.net = null) · players{min,max} (2–8, default 2·2) · purposes[{id (lowercase letters, digits, -, 32 characters), name (per-language text), players[min,max]}] (array order = purpose number from 1; different purposes never connect; absent = one purpose) · compat ("exact" default = same id + same build id / any other string = games with the same id and that string) · rejoin (true = rejoin) · join ("anytime" = drop-in) · iceServers ([{urls: stun:/turn:/turns: addresses (4 in total), username·credential or credentialUrl (https; the host GETs it when connecting → {username, credential, ttl}; CORS must allow https://webgba.vercel.app and http://ui.localhost)}] — when given, only this list is used instead of webGBA's default STUN/TURN; fixed credentials can be pulled out of the file by anyone, so credentialUrl is recommended) · board (status board, below). sync "inputs" and inputDelay are in the spec but not supported by the current webGBA, so do not use them.
- webapi exports (all seven are needed for multiplayer): Web_NetWanted()→u32 · Web_NetEvent(kind,a,b) · Web_NetOut()→ptr · Web_NetOutLen()→u32 · Web_NetOutClear() · Web_NetInBuffer(len)→ptr (0 = no room right now → the host retries next frame, in order) · Web_NetIn(from,len) (from bit 8 = 0x100 means a state bundle). Optional: Web_NetHost(protocol,flags) (once after Web_Init; flags bit 0 = ordered, bit 1 = input sync (0 now), bit 2 = rejoin — if it is never called, hide the link menus) · Web_NetBoard()→ptr · Web_NetCompat()→ptr (NUL-terminated ASCII compatibility key up to 64 characters, appended to compat for comparison). No new imports.
- The host's frame: for each received message Web_NetInBuffer(len) → write → Web_NetIn(from,len) → Web_RunFrame(keys) → send the records from Web_NetOut·Web_NetOutLen → Web_NetOutClear() → check Web_NetWanted() (open the window, end the session).
- Web_NetWanted value: bits 0–7 purpose number (0 = first purpose) · 8–11 minimum players (0 = 2) · 12–15 maximum players (0 = same as minimum) · 16–17 role (0 any, 1 host only, 2 join only) · 18–23 = 0 · 24–31 request number (+1 every time the game looks for new players, 1 after 255). Keep returning the same value during a session; 0 = end of link (the host finishes pending sends, closes the session and sends CLOSED(LEFT)).
- Send records (little endian, back to back): u16 content length n (1–16384) · u8 target (0–7 = slot, 0xFE = TO_ORDERED everyone including me, all in the same order, 0xFF = TO_ALL everyone except me) · u8 type (0 message; rejoin games only: 1 = state bundle piece, 2 = last piece) · n content bytes; the next record starts on a 4-byte boundary. Records queued without a session are dropped.
- Events Web_NetEvent(kind,a,b): 1 OPEN (own slot, players — the room host starts alone first) · 2 JOIN (slot, players) · 3 LEAVE (slot, reason) · 4 CLOSED (reason, 0) · 5 STALL (slot — no reply for over 1 second, or the app was left) · 6 RESUME (slot). Rejoin games only: 7 HOLD (slot, players — the dropped seat is kept; the dropped device itself gets its own slot; on a user device a = 0 means the room host closed the app and is awaited) · 8 BACK (slot, players — the kept seat is connected again, always after HOLD; on a user device a = 0 means the room host is back → this device sends its state bundle to slot 0) · 9 REJOINED (own slot, players — sent to a returning device instead of OPEN; a returning room host gets a = 0; a user who reopened the app gets this event first, with no earlier OPEN or HOLD; the JOIN, LEAVE, HOLD and BACK missed while away follow). Reasons: 1 CANCEL · 2 TIMEOUT · 3 INCOMPATIBLE · 4 LOST · 5 FULL · 6 LEFT · 7 HOST_LEFT · 8 NO_NETWORK · 9 SOLO (the dropped user chose "Play alone").
- The game must: treat CLOSED(CANCEL) like a cancel inside the game and return 0 from Web_NetWanted. Wait on STALL instead of dropping at once (if not back within 15 seconds by default, the host sends LEAVE(LOST) or CLOSED; HOLD in rejoin games). HOST_LEFT = end of session (no host hand-over). During a session the host blocks fast-forward, quick slots and reset (the game's own save stays).
- script: webgba.net (only when the manifest has multiplayer, otherwise null) — want({purpose: purpose id, min, max, role: "any"|"make"|"join"}) (every call is a new request) · unwant() · send(to: slot 0–7 | "ordered" | "all", bytes up to 16384) · sendState(to: slot, bytes 1–262144, rejoin games only) · board(table | null) · host{protocol, ordered, inputs (false now), rejoin} · onevent = (kind,a,b) => … (numbers as above) · onrecv = (from,bytes) => … · onstate = (from,bytes) => …. Bytes are ArrayBuffer or Uint8Array.
- Keeping the same state (recommended = lockstep): make the game deterministic (same input and messages → same result; random numbers from a seed inside the game). TO_ORDERED messages come back to the sender too (from = own slot), so if every device applies them only in the order they arrive, all devices end in the same state. A game that keeps keys in step sends its own keys for frame f with the frame number, applies them at f + a delay (e.g. 3 frames), and does not advance frame f until everyone's keys for f have arrived — even with a slow device, the devices never drift apart by more than the delay. Line up the first frame with a "start" message from the room host. Messages arrive between frames, so queue them and process them inside a frame.
- Rejoin (rejoin: true, room-code sessions only — connection-code / QR sessions get LEAVE(LOST)): a dropped user's seat is kept until the session ends (HOLD). Messages sent while the user was away are not delivered, so the room host's game sends a state bundle (1–262144 bytes; the host splits it into 16384-byte pieces and joins them) to slot s when it gets BACK(s). ① sending = record type 1 (piece, up to 16384 bytes, may be spread over frames) and 2 (last piece); ① receiving = once the whole bundle is in, Web_NetInBuffer(bundle size) → Web_NetIn(from | 0x100, len), so keep receive space for the largest bundle. Put the number of the last ordered message the game applied into the bundle; the returning device applies only higher numbers. If the room host closes the app the room stays 2 minutes; when the host returns, the host device gets REJOINED(0), one user picked by webGBA gets BACK(0) and sends its state bundle to slot 0, and the other users get REJOINED (own slot) and wait for the bundle from the host's game. If a user closes the app the host keeps the seat (HOLD); when the user opens the same game (same id and version) again on the same device and presses "Return to previous room", that device gets REJOINED (own slot) in the freshly started game and the host and other devices get BACK(s) — the host's game sends a state bundle as for an in-app rejoin.
- Drop-in (join: "anytime"): even if the game keeps its request from the start, the window does not open by itself and there is no timeout. The user hosts a room with the "Multiplayer" button, and the room host takes players for 2 min 30 s after creating the room or pressing Renew. A new user arrives as JOIN; the game sends that user the game state it needs with messages (state bundles also work in rejoin games).
- Status board (optional): multiplayer.board{columns[1–6]{id (lowercase letters, digits, -, 16 characters), type "bar"|"number"|"rank"|"status", name (12 characters), max (required for bar, 1–65535), tone ("hp"|"accent"), prefix·suffix (4 characters), labels (required for status, 1–15 {name (8 characters), tone "normal"|"good"|"warn"|"bad"|"dim", dimRow})}, names (names of non-human rows), captions (header text with {0}·{1}), mark (meaning of highlighted rows), scope ("all" the game fills every row | "self" each device gives its own row), sort{column, order}}. ① Web_NetBoard() = a 400-byte buffer at the same address for the whole session: 0 serial u32 (+1 on every change, skip 0, written last after every other field) · 4 format u8 = 1 · 5 rows u8 (0–8) · 6 flags u8 (bit 0 = final result) · 7 caption u8 (from 1, 0 none) · 8 arg0 s32 · 12 arg1 s32 · 16 + 48×i row{slot u8 (0–7, 0xFF = not a person) · flags u8 (bit 0 dim, bit 1 highlight) · nameLabel u8 · nameLen u8 (0–20) · values s32×6 · name 20 bytes UTF-8}. Values: bar = low 16 bits current, high 16 bits max (0 = max), number = s32, rank = 0 or 1–99, status = 0 or a labels number. ② webgba.net.board({caption, args:[…], final, rows:[{slot, values, nameLabel, name, dim, mark}]}). Change it at most 4 times a second. Human rows always show the webGBA nickname.
- Examples: webGBA repository docs/wgba/examples/net-webapi (① C, no ROM) and net-script (② one JS file).

[Online updates — optional (spec chapter 12)]
- To let players apply a new version without downloading the file again, add "update": {"feed": "https://<static server>/<game id>/latest.json", "key": "<public key>"} to the manifest. The server serves static files only (e.g. a public Cloudflare R2 bucket), allows CORS GET, sends Cache-Control: no-cache for latest.json, and uses content-hash names with a 1-year immutable cache for patches and .wgbp.
- Keys: node tools/wgba.mjs keygen -o <path outside any git repository>/key.pem — put only the public key (88 base64 characters) in the manifest; never put the private key in a repository, chat or log. Losing the private key means no new versions for that key.
- For every new version: node tools/wgba.mjs diff <previous.wgba> <new.wgba> -o p.wgbd [--orig <original ROM>] → node tools/wgba.mjs feed --dir <publish folder> --key key.pem --wgba <new.wgba> --patch p.wgbd [--old <folder of old .wgba> --orig <original ROM>] [--full <new.wgbp>] → node tools/wgba.mjs verify <publish folder> --key key.pem --wgba <previous.wgba> → node tools/wgba.mjs upload <publish folder> (environment variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET). Keep every previous .wgba (--old makes a direct patch from each old version = one patch per update; without the previous .wgba, players on that version can only do a .wgbp full install). The update index index.json (12.2.1) is for games in the webGBA known game id table; games that only use manifest update do not need it.
- Writing the version file by hand: {"wgbaFeed":1,"signed":"<JSON text: id, version, wgba{sha1,size}, from[{sha1,version,to,patch{url,size,sha256}}], full{url,size,sha256}>","signature":"<base64 of the 64-byte r‖s ECDSA P-256/SHA-256 signature over the UTF-8 bytes of signed>"}. The .wgbd delta format is exactly 12.3 (use the tool rather than writing it by hand).
- Publish only the same id with a higher version. If the save format changes, make the game read old saves (webGBA does not load quick slots from another version).

[Steps]
1. Look at the wasm imports and exports and choose the runtime (webapi if it follows the webapi convention, otherwise script).
2. Write the manifest JSON (every required field; ask me for values you do not know). For a multiplayer game write multiplayer, and implement the seven Web_Net* exports (webapi) or webgba.net (script).
3. Pack. If you can get the webGBA repository (https://github.com/flightrabbit-hash/webGBA), run in that folder
   node tools/wgba.mjs pack -o game.wgba --wasm game.wasm --manifest manifest.json [--cart-dir art-folder (label.png·front.png·spine.png)] [--js game.js] [--data name=file] [--rom rom]
   (node 18+, nothing to install; the tool fills chunk, format, width and height of cart.*). If not, write a short script (node or python) that packs by the [File layout] above: drop webgba.* sections → prepare chunks → compute the TOC length → assign offsets in order → SHA-256 → write.
4. Validate: node tools/wgba.mjs check game.wgba must report 0 errors. Without the tool, check by hand: WebAssembly.validate, first section is webgba.toc, TOC file length = real length, every entry's position, section name, kind and SHA-256, rom is last, required manifest fields and version format, for webapi the required exports, the import list and no shared bits, for script the js chunk, entry.style and button codes, cartridge picture sizes and formats, for multiplayer protocol 1, purpose id rule and no duplicates, players 2–8, rejoin boolean, join "anytime" only, iceServers format, board format, and all seven Web_Net* exports (only some = warning).
5. Show me the file name, size, the TOC table and the validation result.

[Do not]
- Include ROMs, art, music or data I have no rights to. Put other companies' trademarks (console names, logos …) on cartridge art, or copy real cartridge shapes or box art.
- Put network requests, eval of outside code, access to the host (parent, top) or IndexedDB into game JS.
- Use anything but webGBA's link (Web_Net*, webgba.net) for multiplayer. The game never connects by itself with WebSocket, WebRTC or fetch (the script frame blocks the network, and webapi has no network imports). Send ROMs or other people's works in messages.
- Change the id in a new version of the same game (saves would be lost). Raise the version as x.y.z — webGBA updates a higher version of the same id without asking and warns only for a lower one. Use a different id for a different game.
- Invent fields that are not in the spec (if really needed, use a name starting with "x-").
- Build with threads (SharedArrayBuffer, pthreads).
- Run wasm-opt, strip or similar tools after packing — they can remove custom sections. Use them only before packing.
````
