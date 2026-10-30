# webGBA

[한국어](README.md) · [English](README.en.md) · **日本語**

GBA ROM(`.gba`・`.zip`)とウェブビルド(`.wasm`・`.wgba`)を開く Windows 用ランチャーです。
Tauri 2 + Rust の上に WebView の画面を載せた構成で、作りは Arbiter に倣っています。ゲームの実行(コア・キー・サウンド)は
WebView が、ファイルとウィンドウは Rust が受け持ちます。`.gba` は内蔵の mGBA 0.10.1 コア(wasm)で動かし、`.wasm`・`.wgba` は
そのウェブビルドをアプリの中でそのまま実行します。**管理者権限は不要**で、通常の権限(`asInvoker`)で起動します。

> **ROM と BIOS は含まれていません。** ご自身が持っている ROM ファイルを開いてください。GBA 公式 BIOS も含まれず、mGBA 内蔵の HLE BIOS を使います。

---

## 事前準備

このプロジェクトを**ビルド・実行**するには次のものが必要です(Windows)。

1. **Node.js**(LTS 推奨)— `npm` も一緒に入ります。画面の組み立て(`src-bundle/build-dist.cjs`)と Tauri CLI に使います。
2. **Rust ツールチェーン** — [rustup](https://rustup.rs) でインストールします(`stable`)。
3. **Microsoft C++ Build Tools** — Visual Studio Installer の **「C++ によるデスクトップ開発」** ワークロード(MSVC リンカー、Windows SDK)。
4. **Microsoft Edge WebView2 ランタイム** — Windows 11 にはたいてい最初から入っています。
   ない場合は [Microsoft の配布ページ](https://developer.microsoft.com/microsoft-edge/webview2/)から「Evergreen Standalone Installer」を入手します。
5. **Docker** — mGBA コアをビルドし直すときだけ必要です(`emscripten/emsdk:4.0.10`)。
   ビルド済みのコア(`src-bundle/bin/core/mgba_core.wasm`)がリポジトリにあるので、アプリのビルドには不要です。
6. **依存関係のインストール** — クローンした後に一度だけ実行します。

   ```bash
   npm install
   ```

> ビルド済みのアプリを**使うだけ**なら、上のものは要りません。`webgba.exe` は WebView2 ランタイムさえあればそのまま動きます。

---

## 実行とビルド

```bash
npm run dev       # デバッグビルドして実行
npm run build     # tauri build → src-tauri/target/release/webgba.exe(+ 隣に LICENSE・THIRD_PARTY_NOTICES・bin/core/)
npm start         # リリース版の実行ファイルを実行
npm run dist      # 画面アセット(dist/)だけを組み立て直す — dev・build が先に実行します
npm run core      # mGBA wasm コアをビルドし直す(Docker)
npm test          # Rust のテスト(cargo test --lib)
node tools/run.cjs   # コマンド一覧
```

- ビルド結果は `src-tauri/target/release/` の下にできます。インストーラー(NSIS)は作りません。
- **mGBA のソースはリポジトリに含まれていません。** `npm run core` が Docker `emscripten/emsdk:4.0.10` を `--rm`・15 分の制限付きで起動して `core/build.sh` を実行すると、
  `core/build.sh` が公式 0.10.1 タグのソースを取得し(`core/vendor/mgba-0.10.1`、リポジトリには入れません)、変更せずにまとめ、
  結果(`mgba_core.wasm` + ライセンス)を `src-bundle/bin/core/` に移します。
- VS Code では `webGBA.code-workspace` を開くと、同じコマンドがタスクとして表示されます。

---

## 主な機能

- **.gba・.zip** — アプリの `bin\core\mgba_core.wasm`(mGBA 0.10.1)で実行。画面 240x160(右側の領域に合わせ、縦横比を維持。設定で整数倍率)、サウンド、キー設定、ゲームパッド、
  早送り(2・3・4・8 倍)、一時停止、リセット、セーブ(ROM の隣の `<ROM 名>.sav`、VBA・mGBA と同じ形式)、
  ステートセーブのスロット 1〜9。`.zip` は中の最初の `.gba`・`.agb`・`.bin` を取り出して開きます。
- **.wgba・.wasm** — `.js` がなくてもファイル 1 つで開けます(`.wgba` は中身が wasm で、拡張子だけが違います)。
  - `Web_*` という名前で画面・サウンド・セーブを公開しているビルドは、内蔵ホストでそのまま実行します。
  - 512KB のような大きなセーブも、コアが出すサイズのまま保存・読み込みします(128KB に切り詰めません)。
  - ページ(`index.html` など)があるウェブビルドは元のページのまま、ページがなく emscripten の `.js` があればキャンバスを付けて実行します。
  - ビルドごとに保存領域(localStorage・IndexedDB・IDBFS)が分かれていて、アプリを開き直しても残ります。
- **ROM を同梱した .wgba** — wasm の末尾のカスタムセクション `webgba.rom` に ROM を入れておくと、隣に `.gba` がなくてもその ROM ですぐに開きます
  (ROM の検索・選択なし、ステータスバーに「内蔵 ROM」)。同梱: `node tools/pack-wgba.mjs <ビルド.wasm> <rom.gba> <出力.wgba>` — ROM を zlib で縮めて入れ、読み直して SHA-1 まで確かめます。
  開くときにも SHA-1 を確かめ、違えば開かずに知らせます。カスタムセクションは wasm エンジンが無視するので、同梱したファイルもそのまま正しい wasm です。
  **ROM が入っているので自分の PC だけで使い、配らないでください。** このリポジトリとリリースには ROM も、ROM を同梱した `.wgba` も入っていません。
- **ROM の入っていない配布用パッチ .wgbp** — 配れるファイルです。開くとお持ちの ROM を一度選んでもらい、同じフォルダーに ROM を同梱した `<名前>.wgba` を作ってすぐに開きます
  (次からはその `.wgba` を開きます)。ROM は SHA-1 で確かめ、合わなければ理由(パッチ済み・別の版・別の言語版・別のゲームなど)を知らせます。`.wgbp` と ROM を一緒にドロップすると選ばずに作ります。
  作り方: `node tools/make-wgbp.mjs <ビルド.wasm|.wgba> <結果の ROM> <出力.wgbp> --base <元の ROM> [--label 名前] …` — 元の ROM → 結果の ROM の BPS パッチを入れ、wasm の中で元の ROM と同じ部分は空けておき、
  作るときに利用者の ROM から埋めます。作ったあと、受け付けるすべての ROM で結果が `pack-wgba` で同梱したものとバイトまで同じか確かめます。アプリとツールが同じ pako を使うので、`.wgba` はどの PC でも同じバイトです。
- **ウェブビルドの ROM 選び** — 設定ウィンドウ › 一般 › ファイル › **Web ビルドで使う ROM ファイル名**。入力しておくと、`.wgba`・`.wasm` と同じフォルダー(なければ一つ上のフォルダー)にあるその名前の ROM を使います。
  空のまま(既定)なら `<ビルド名>.gba` → 同じフォルダーの `.gba` が一つだけならそれ、の順に探し、複数あって決められないときは最初に開くときに選んでもらい、ビルドごとに覚えます。
  ゲーム › ROM を指定… でいつでも変更できます。ROM を同梱した `.wgba` はこの規則を使わず、中の ROM を使います。
- **.wgba・.wgbp の関連付け** — エクスプローラーで `.wgba`・`.wgbp` をダブルクリックすると webGBA で開きます。管理者権限なしでユーザー単位(HKCU)に登録します。
  関連付けの解除は **設定ウィンドウ › 一般 › ファイル** で行います。
- **セーブは開いたファイルの隣にひとつ** — `.gba`・`.zip`・`.wgba`・`.wasm` のどれも、開いたファイルのすぐ隣の `<ファイル名>.sav` ひとつを読み書きします(VBA などほかのエミュレーターのセーブをその名前で置けばそのまま続きから遊べます)。
  ゲームがセーブしてから約 1 秒後と、ウィンドウを閉じるときや別のゲームを開くときに、その `.sav` ファイル自体を直接上書きします。バックアップファイルは作りません。
  書き込めないとき(読み取り専用など)はステータスバーに知らせ、次のセーブか閉じるときにもう一度書き込みます。ほかのセーブを使うにはファイル › セーブを取り込む…(隣の `.sav` をその内容で上書き)、取り出すにはセーブを書き出す…。
- **方向キーの同時押し** — 設定ウィンドウ › 一般 › ゲーム。二つの方向を同時に押したとき、ゲームに渡す方向を選びます:
  **後に押した方向のみ**(既定、押したとおりにすぐ曲がる)・逆方向は後押し優先(←+→、↑+↓ だけを整理)・すべて渡す(GBA 実機と同じ)。
- **早送り中の音** — 早送り中も倍率どおりに速くなった音を鳴らします。静かにしたいときは 設定ウィンドウ › 一般 › サウンド › 早送り中は音を消す。
- **開く** — 開くダイアログ、エクスプローラーからのドラッグ&ドロップ、同じフォルダーのゲーム一覧(`.gba`・`.wgba`・`.wasm`、前後のゲームへすぐ移動)、
  お気に入り、最近開いたファイル、関連付けからの起動引数(すでに起動していればそのウィンドウで開く)。画面にはパスを出さず、ファイル名だけを表示します。
- **ツールバー** — 左側の縦のバー。折りたたむとゲーム画面を隠さずにその分広くなり、折りたたみの状態を覚えます。
- **設定ウィンドウ(Ctrl+,)** — 一般・キー・テーマ・言語の 4 ページ。画面の合わせ方・整数倍率、音量・早送りの倍率、方向キーの同時押し、ステートスロット、セーブ、関連付け・ROM 名、お気に入り・最近の一覧の消去、キー設定を 1 つのウィンドウで変更します。
- **テーマ 13 種類** — Arbiter と同じテーマ一式(ダーク 7・ライト 5・カスタム)。webGBA の画面全体(ツールバー・一覧・ウィンドウ・ダイアログ)にすぐ適用され、ゲーム画面自体は変えません。
- **言語** — 한국어(既定)・English・日本語。設定ウィンドウ › 言語 で切り替えると再起動なしですぐに変わり、その選択を覚えます。

---

## ショートカットキー

| 操作 | キー |
| --- | --- |
| GBA A / B | Z・K / X・J |
| GBA L / R | A / S |
| START / SELECT | Enter・テンキー Enter / Backspace・右 Shift |
| 方向 | 矢印キー |
| 早送り(押している間) | Space |
| 早送りのオン・オフ | Tab |
| 一時停止 | Pause |
| ステートセーブ / ロード | Shift+F1〜F9 / F1〜F9 |
| リセット | Ctrl+R |
| 開く / 閉じる | Ctrl+O / Ctrl+W |
| 設定ウィンドウ | Ctrl+, |
| お気に入りに追加・削除 | Ctrl+D |
| ツールバーの折りたたみ・展開 | Ctrl+B |
| 同じフォルダーの前 / 次のゲーム | Ctrl+PageUp / Ctrl+PageDown |
| 開発者ツール(`setting.ini` の `useDevelopKit: true` のとき) | Ctrl+Shift+I |

ゲームのキーは 設定ウィンドウ › キー で変更でき、ゲームパッドは標準配置で自動的に割り当てられます。

---

## リポジトリの構成

```text
core/          mGBA wasm コアのビルド — build.sh(Docker、mGBA 公式ソースを取得)、src/ ラッパー(webgba_core.c・host_stubs.c)
src-bundle/    画面 — src/(html・css・js・icons・i18n)、ini/(設定の初期値)、bin/core/(mgba_core.wasm・licenses/)
src-tauri/     Rust — ウィンドウ・ファイル・セーブ・ウェブビルドのオリジン・.wgba の関連付け
tools/         npm コマンド(run.cjs・scripts.cjs)、コアのビルド、pack-wgba.mjs(ROM を .wgba に同梱)、make-wgbp.mjs(ROM なしの .wgbp を作る)、lib/、test/(テストツール)
documents/     設計の文書(韓国語)
```

## 配布後のフォルダー構成

```text
webgba.exe
LICENSE                webGBA のライセンス(MIT)
THIRD_PARTY_NOTICES    同梱のオープンソースの表示
bin/
  core/     mgba_core.wasm, licenses/          実行に使うコア
  ini/      setting.ini, personalization.cfg   設定
  log/      2026-10-26.log                     ログ
  state/    <ROM 名>.ss1 … .ss9                 ステートセーブ
  web/      <ビルド名>-<キー>/state.ssN          ウェブビルドのステートセーブ
  webview/  WebView のデータ(ウェブビルドの保存領域)
```

- ないものは初回起動時に exe 内のコピーから作ります。exe の隣に書き込めない場合は `%LOCALAPPDATA%\webGBA\bin` を使います。
- セーブは `bin` ではなく、開いたファイルの隣の `<ファイル名>.sav` にあります。
- `setting.ini` ではウィンドウサイズ、ウィンドウが隠れたときの一時停止、開発者ツールを設定します。そのほかの設定は `personalization.cfg`(設定ウィンドウが書きます)にあります。

---

## ライセンス

**webGBA は MIT、同梱の mGBA は MPL-2.0** です。

- webGBA 自体のコード(src-bundle、src-tauri、tools、core/src、core/build.sh)は [MIT ライセンス](LICENSE)に従います。Copyright © 2026 flightrabbit.
- 同梱する mGBA 0.10.1 とそのビルド結果(`mgba_core.wasm`)は MIT ではなく **MPL-2.0** のままです。mGBA のソースは変更しておらず、リポジトリにも含めていません。
  ソース: https://github.com/mgba-emu/mgba/tree/0.10.1 ・全文: `src-bundle/bin/core/licenses/`(配布版では `bin/core/licenses/`)
- 同梱のオープンソースの表示の全文は [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) にあります(アプリの ヘルプ › 情報 にも同じ内容)。
- ROM と GBA 公式 BIOS は含まれていません(mGBA 内蔵の HLE BIOS を使用)。アプリのアイコンは flightrabbit が用意した携帯ゲーム機のドット絵です。

### 同梱のオープンソース

| コンポーネント | 用途 | ライセンス |
| --- | --- | --- |
| mGBA 0.10.1(blip_buf、inih を含む) | GBA コア | MPL-2.0(LGPL-2.1、BSD-3-Clause) |
| Tauri 2・WRY・TAO | アプリの骨組み・WebView・ウィンドウ | Apache-2.0 OR MIT |
| Microsoft Edge WebView2 | 画面のランタイム | Microsoft の配布条件 |
| windows-rs・zip | Win32 API・.zip の ROM | MIT OR Apache-2.0・MIT |
| Tabler Icons | アイコン | MIT |
| pako 2.1.0 | .wgba の ROM 圧縮・.wgbp | MIT AND Zlib |

mGBA — Copyright (c) 2013-2022 Jeffrey Pfau and contributors ・ https://mgba.io

---

Copyright © 2026 flightrabbit
