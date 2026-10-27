# webGBA

[한국어](README.md) · **English** · [日本語](README.ja.md)

A Windows launcher that opens GBA ROMs (`.gba`, `.zip`) and web builds (`.wasm`, `.wgba`).
It puts a WebView UI on top of Tauri 2 + Rust, and its structure follows Arbiter. The WebView runs the game
(core, keys, sound) and Rust handles files and windows. `.gba` files run on the built-in mGBA 0.10.1 core (wasm);
`.wasm` and `.wgba` web builds run as they are, inside the app. It starts with normal user rights (`asInvoker`) —
**no administrator rights needed**.

> **No ROMs or BIOS are included.** Open ROM files that you own. The official GBA BIOS is not included either; mGBA's built-in HLE BIOS is used.

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

---

## Features

- **.gba / .zip** — runs on the app's `bin\core\mgba_core.wasm` (mGBA 0.10.1). 240x160 screen (fits the right-hand area, keeps the aspect ratio; integer scaling in settings), sound, key bindings, gamepad,
  fast-forward (2x/3x/4x/8x), pause, reset, saves (`bin\save\<ROM name>.sav`, same format as VBA and mGBA),
  save-state slots 1–9. For `.zip`, the first `.gba`/`.agb`/`.bin` inside is opened.
- **.wgba / .wasm** — opens even a single file without a `.js` (`.wgba` is a wasm file with a different extension).
  - Builds that export screen, sound and saves under `Web_*` names run directly on the built-in host.
  - Large saves such as 512 KB are stored and loaded at the size the core reports (not cut to 128 KB).
  - Web builds with a page (`index.html` etc.) run with their own page; builds with only an emscripten `.js` get a canvas attached.
  - Each build has its own storage (localStorage, IndexedDB, IDBFS), which persists across restarts.
- **Choosing the ROM for a web build** — Settings › General › Files › **ROM file name for web builds**. When set, the ROM with that name in the same folder as the `.wgba`/`.wasm` (or the folder above) is used.
  When empty (default), webGBA tries `<build name>.gba`, then the only `.gba` in the same folder; if there are several, it asks the first time and remembers the choice per build.
  You can change it any time with Game › Choose ROM….
- **.wgba file association** — double-click a `.wgba` in Explorer to open it in webGBA. Registered per user (HKCU) without administrator rights.
  To remove the association, use **Settings › General › Files**.
- **Automatic save import** — a same-name `.sav` next to the ROM (saves from VBA and other emulators) is imported automatically. If webGBA has no save yet it is copied;
  if the `.sav` beside the ROM is newer, the current save is backed up first and then replaced.
- **Write a save file on exit** — Settings › General › Saves (on by default). When you close the window or open another game, `<file name>.sav` is written next to the opened file (another folder can be chosen). An existing file is kept as `.sav.bak`.
- **Two directions at once** — Settings › General › Game. Chooses which direction reaches the game when two are held:
  **Last pressed only** (default, you turn as soon as you press) · Opposite: last wins (only ←+→ and ↑+↓) · Pass all (same as a real GBA).
- **Fast-forward sound** — sound keeps playing while fast-forwarding, sped up by the same factor. To keep it quiet, use Settings › General › Sound › Mute while fast forwarding.
- **Opening files** — open dialog, drag and drop from Explorer, list of games in the same folder (`.gba`, `.wgba`, `.wasm`; jump to the previous/next game),
  favorites, recent files, and command-line arguments from file association (passed to the running window if already open). Only file names are shown on screen, never full paths.
- **Toolbar** — vertical bar on the left. When collapsed it no longer covers the game, which gets the extra width; the collapsed state is remembered.
- **Settings window (Ctrl+,)** — four pages: General, Keys, Theme, Language. Screen fit and integer scaling, volume and fast-forward speed, two directions at once, state slot, saves, file association and ROM name, clearing favorites/recent files, and key bindings — all in one window.
- **13 themes** — the same theme set as Arbiter (7 dark, 5 light, custom). Applied instantly to the whole webGBA UI (toolbar, lists, windows, dialogs); the game screen itself is not changed.
- **Languages** — 한국어 (default), English, 日本語. Switching in Settings › Language applies immediately without a restart and is remembered.

---

## Keyboard shortcuts

| Action | Key |
| --- | --- |
| GBA A / B | X · K / Z · J |
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
src-tauri/     Rust — windows · files · saves · web-build origins · .wgba association
tools/         npm commands (run.cjs · scripts.cjs), core build, test/ (test tools)
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
  save/     <ROM name>.sav                      saves
  state/    <ROM name>.ss1 … .ss9               save states
  web/      <build name>-<key>/save.sav         web-build saves
  webview/  WebView data (web-build storage)
```

- Missing files are created on first launch from copies embedded in the exe. If the folder next to the exe is not writable, `%LOCALAPPDATA%\webGBA\bin` is used.
- `setting.ini` sets the window size, pausing when the window is hidden, save backups and developer tools. Other settings live in `personalization.cfg` (written by the Settings window).

---

## License

**webGBA is MIT; the bundled mGBA is MPL-2.0.**

- webGBA's own code (src-bundle, src-tauri, tools, core/src, core/build.sh) is under the [MIT License](LICENSE). Copyright © 2026 flightrabbit.
- The bundled mGBA 0.10.1 and its build output (`mgba_core.wasm`) stay under **MPL-2.0**, not MIT. The mGBA source is unmodified and not included in this repository.
  Source: https://github.com/mgba-emu/mgba/tree/0.10.1 · full texts: `src-bundle/bin/core/licenses/` (`bin/core/licenses/` in the deployed app)
- The full notices for bundled open source are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) (also shown in the app under Help › About).
- No ROMs or official GBA BIOS are included (mGBA's built-in HLE BIOS is used). The app icon is the same image as Arbiter's.

### Bundled open source

| Component | Purpose | License |
| --- | --- | --- |
| mGBA 0.10.1 (incl. blip_buf, inih) | GBA core | MPL-2.0 (LGPL-2.1, BSD-3-Clause) |
| Tauri 2 · WRY · TAO | app framework · WebView · windows | Apache-2.0 OR MIT |
| Microsoft Edge WebView2 | UI runtime | Microsoft distribution terms |
| windows-rs · zip | Win32 API · .zip ROMs | MIT OR Apache-2.0 · MIT |
| Tabler Icons | icons | MIT |

mGBA — Copyright (c) 2013-2022 Jeffrey Pfau and contributors · https://mgba.io

---

Copyright © 2026 flightrabbit
