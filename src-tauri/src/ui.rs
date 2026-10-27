//! 웹뷰 화면 서빙, 앱 폴더 위치, 본 창 생성(아비터 ui.rs 와 같은 자리).
//!
//! ```text
//!   webgba.exe
//!   LICENSE                 webGBA 자체 코드(MIT)
//!   THIRD_PARTY_NOTICES     포함된 오픈소스 고지(mGBA MPL-2.0 등)
//!   bin/
//!     core/     mgba_core.wasm, licenses/          실행에 쓰는 코어(앱이 놓고, 사람이 바꿔 넣을 수 있음)
//!     ini/      setting.ini, personalization.cfg  설정
//!     log/      2026-10-26.log                    기록
//!     state/    <롬 이름>.ss1 … .ss9               상태 저장
//!     web/      <빌드 이름>-<키>/state.ssN           웹 빌드 상태 저장
//!     webview/  WebView2 데이터(웹 빌드마다 출처가 달라 저장 공간이 섞이지 않음)
//! ```
//!
//! 세이브는 앱 폴더에 두지 않고 연 파일 바로 옆 `<이름>.sav` 하나를 직접 읽고 덮어쓴다(`store`). 옛 판이 쓰던
//! `save/<롬 이름>.sav`·`web/<빌드>-<키>/save.sav` 는 읽지도 옮기지도 않는다(사용자 2026-10-27).
//!
//! 앱 폴더는 exe 옆 `bin/`(아비터와 같음). 일반 권한으로 뜨므로 exe 옆에 쓸 수 없는 자리(예: Program Files)면
//! `%LOCALAPPDATA%\webGBA\bin` 을 쓴다.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime, UriSchemeContext, WebviewUrl, WebviewWindowBuilder};

pub const SCHEME: &str = "ui";

const ENTRY: &str = "index.html";

pub const BIN_DIR: &str = "bin";
pub const CORE_DIR: &str = "core";
pub const INI_DIR: &str = "ini";
pub const LOG_DIR: &str = "log";
pub const STATE_DIR: &str = "state";
pub const WEB_DIR: &str = "web";
pub const WEBVIEW_DIR: &str = "webview";

/// 코어 파일 이름. 내장본은 dist 의 `bin/core/` 에 있다.
pub const CORE_FILE: &str = "mgba_core.wasm";

/// 웹뷰에 전달하는 Chromium 인자. 앞의 `--disable-features` 는 wry 기본값을 다시 적은 것(지정하면 대체되므로).
/// `CalculateNativeWinOcclusion` 과 배경 지연 끄기는 아비터와 같다 — 다른 창이 덮어도 게임 루프가 멈추지 않게.
/// `--autoplay-policy` 는 사용자 입력 전에도 AudioContext 가 소리를 내게 한다(웹 빌드 페이지 포함).
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
     --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
     --disable-renderer-backgrounding --autoplay-policy=no-user-gesture-required";

/// 시험용 원격 디버깅 포트. `setting.ini` 의 `useDevelopKit: true` 일 때만 받는다.
const ENV_DEBUG_PORT: &str = "WEBGBA_DEBUG_PORT";

/// 화면을 그리기 **전에** 지난번 테마·언어를 거는 스크립트(아비터 `THEME_GUARD` 와 같은 방식, 본 창에만).
///
/// 화면은 `runtime_info`·`prefs_get` 왕복 뒤에야 테마·언어를 적용하므로, 그 사이 기본 다크·한국어가 잠깐 비친다.
/// 마지막에 적용한 테마 토큰과 언어를 웹뷰 localStorage 에 두었다가 문서가 생기자마자 건다. 캐시가 없거나(첫 실행)
/// 언어가 한국어가 아니면 화면이 테마(`webgba:theme`)·언어(`webgba:i18n`) 이벤트를 보낼 때까지 본문을 감춘다(3초 뒤에는 무조건 보임).
/// 문서 생성 시점이라 `documentElement` 가 아직 없을 수 있어 생길 때까지 기다린다.
const THEME_GUARD: &str = r#"(function () {
  var KEY = "webgba.theme.cache";
  function start() {
    var el = document.documentElement;
    var style = document.createElement("style");
    style.textContent = "html.theme-loading{background:var(--bg)}html.theme-loading body,html.i18n-loading body{visibility:hidden}";
    (document.head || el).appendChild(style);
    function read() {
      try {
        var d = JSON.parse(localStorage.getItem(KEY) || "null");
        return d && d.v === 1 ? d : null;
      } catch (e) {
        return null;
      }
    }
    function save(patch) {
      try {
        var next = read() || { v: 1 };
        for (var p in patch) next[p] = patch[p];
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch (e) {}
    }
    var d = read();
    if (d && d.props) {
      for (var k in d.props) el.style.setProperty(k, d.props[k]);
      if (d.theme) el.dataset.theme = d.theme;
      if (d.tone) el.dataset.tone = d.tone;
    } else {
      el.classList.add("theme-loading");
    }
    if (d && d.lang && d.lang !== "ko") {
      el.lang = d.lang;
      el.classList.add("i18n-loading");
    }
    document.addEventListener("webgba:theme", function () {
      var s = el.style, props = {};
      for (var i = 0; i < s.length; i++) {
        var p = s[i];
        if (p.indexOf("--") === 0) props[p] = s.getPropertyValue(p);
      }
      save({ props: props, theme: el.dataset.theme, tone: el.dataset.tone });
      el.classList.remove("theme-loading");
    });
    document.addEventListener("webgba:i18n", function (e) {
      save({ lang: (e.detail && e.detail.lang) || el.lang });
      el.classList.remove("i18n-loading");
    });
    setTimeout(function () {
      el.classList.remove("theme-loading");
      el.classList.remove("i18n-loading");
    }, 3000);
  }
  if (document.documentElement) {
    start();
    return;
  }
  new MutationObserver(function (_, watcher) {
    if (!document.documentElement) return;
    watcher.disconnect();
    start();
  }).observe(document, { childList: true });
})();
"#;

/// exe 가 있는 폴더.
pub fn app_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

static BIN_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 앱 폴더. exe 옆 `bin/` 에 쓸 수 있으면 거기, 아니면 `%LOCALAPPDATA%\webGBA\bin`. 한 번 정하면 바꾸지 않는다.
pub fn bin_root() -> &'static PathBuf {
    BIN_ROOT.get_or_init(|| {
        let beside = app_root().join(BIN_DIR);
        if writable(&beside) {
            return beside;
        }
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        local.join("webGBA").join(BIN_DIR)
    })
}

fn writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(format!(".probe-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

pub fn dir(name: &str) -> PathBuf {
    bin_root().join(name)
}

/// 앱 폴더를 갖춘다. 없으면 만들고, 설정 씨앗과 코어를 exe 내장본에서 꺼낸다(exe 하나만으로 뜨게).
pub fn ensure_layout<R: Runtime>(app: &AppHandle<R>) {
    for name in [CORE_DIR, INI_DIR, LOG_DIR, STATE_DIR, WEB_DIR, WEBVIEW_DIR] {
        let _ = std::fs::create_dir_all(dir(name));
    }

    for seed in ["setting.ini", "personalization.cfg"] {
        let target = dir(INI_DIR).join(seed);
        if target.exists() {
            continue;
        }
        if let Some(asset) = app.asset_resolver().get(format!("/{seed}")) {
            let _ = std::fs::write(&target, asset.bytes);
        }
    }

    place_core(app);
}

/// 코어 놓기. 앱이 놓은 파일이면(기록과 같으면) 새 판으로 바꾸고, 사람이 바꿔 넣은 파일은 그대로 둔다.
fn place_core<R: Runtime>(app: &AppHandle<R>) {
    let core_dir = dir(CORE_DIR);
    let record = core_dir.join(".placed");
    let names = [
        CORE_FILE,
        "licenses/mgba-LICENSE.txt",
        "licenses/blip_buf-LICENSE.txt",
        "licenses/inih-LICENSE.txt",
    ];
    for name in names {
        let Some(asset) = app.asset_resolver().get(format!("/bin/core/{name}")) else { continue };
        let target = core_dir.join(name);
        let ours = fingerprint(&asset.bytes);
        let placed = std::fs::read_to_string(record.with_extension(fingerprint_tag(name))).ok();
        let current = std::fs::read(&target).ok().map(|b| fingerprint(&b));

        let write = match (&current, &placed) {
            (None, _) => true,
            (Some(now), Some(before)) => now == before.trim() && now != &ours,
            (Some(_), None) => false,
        };
        if write {
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::write(&target, &asset.bytes).is_ok() {
                let _ = std::fs::write(record.with_extension(fingerprint_tag(name)), &ours);
            }
        } else if current.as_deref() == Some(ours.as_str()) && placed.is_none() {
            let _ = std::fs::write(record.with_extension(fingerprint_tag(name)), &ours);
        }
    }
}

fn fingerprint_tag(name: &str) -> String {
    name.replace(['/', '\\', '.'], "_")
}

/// FNV-1a 64. 파일 같음 확인과 웹 빌드 키에 쓴다.
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn fingerprint(bytes: &[u8]) -> String {
    format!("{:016x}-{}", fnv1a(bytes), bytes.len())
}

/// 커스텀 스킴의 실제 주소. Windows 는 `http://<스킴>.localhost`.
pub fn page_url(page: &str) -> tauri::Url {
    let raw = if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{page}")
    } else {
        format!("{SCHEME}://localhost/{page}")
    };
    raw.parse().expect("고정 문자열이라 파싱이 실패할 수 없음")
}

/// 본 창 생성. 숨김으로 만들고 위치·크기를 적용한 뒤 보인다(첫 프레임이 최종 모습이 되게).
pub fn open_main_window<R: Runtime>(
    app: &AppHandle<R>,
    ini: &crate::settings::Settings,
    spot: Option<crate::config::WindowSpot>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let mut args = BROWSER_ARGS.to_string();
    if ini.use_develop_kit {
        if let Ok(port) = std::env::var(ENV_DEBUG_PORT) {
            if port.parse::<u16>().is_ok() {
                args.push_str(&format!(" --remote-debugging-port={port}"));
            }
        }
    }

    let (width, height) = spot
        .as_ref()
        .map(|s| (s.width, s.height))
        .unwrap_or((ini.app_width, ini.app_height));

    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(page_url(ENTRY)))
        .additional_browser_args(&args)
        .initialization_script(THEME_GUARD)
        .data_directory(dir(WEBVIEW_DIR))
        .title(concat!("webGBA V", env!("CARGO_PKG_VERSION")))
        .inner_size(width.max(ini.app_min_width), height.max(ini.app_min_height))
        .min_inner_size(ini.app_min_width, ini.app_min_height)
        .resizable(true)
        // 제목 표시줄을 직접 그린다(아비터와 같음).
        .decorations(false)
        .visible(false);

    if let Some(s) = spot.as_ref() {
        builder = builder.position(s.x, s.y);
    } else {
        builder = builder.center();
    }

    let window = builder.build()?;
    tame_webview(&window, ini.use_develop_kit);
    if spot.map(|s| s.maximized).unwrap_or(false) {
        let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

/// 브라우저 가속키(F5·Ctrl+R·Ctrl+F 등)를 끄고 개발자 도구를 설정대로 연다. 게임 키(F1~F9 상태 저장)와 겹치지 않게.
#[cfg(windows)]
fn tame_webview<R: Runtime>(window: &tauri::WebviewWindow<R>, dev_tools: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let _ = window.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let _ = settings.SetAreDevToolsEnabled(dev_tools);
        let _ = settings.SetAreDefaultContextMenusEnabled(dev_tools);
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

#[cfg(not(windows))]
fn tame_webview<R: Runtime>(_window: &tauri::WebviewWindow<R>, _dev_tools: bool) {}

/// `ui` 스킴: exe 내장 `dist/`.
pub fn serve<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let app = ctx.app_handle();
    let requested = request.uri().path().trim_start_matches('/');
    let requested = if requested.is_empty() { ENTRY } else { requested };
    let decoded = percent_decode(requested);

    if let Some(asset) = app.asset_resolver().get(format!("/{decoded}")) {
        return ok(asset.bytes, &asset.mime_type);
    }
    error(StatusCode::NOT_FOUND, &crate::i18n::tr("rs.notFound"))
}

pub fn ok(body: Vec<u8>, content_type: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("고정 헤더라 빌더가 실패할 수 없음")
}

pub fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .expect("고정 헤더라 빌더가 실패할 수 없음")
}

pub fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" | "wgba" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "txt" => "text/plain; charset=utf-8",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

/// 퍼센트 인코딩 복원(한글 파일명·공백). 잘못된 조각은 그대로 둔다.
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_restores_korean_and_spaces() {
        assert_eq!(percent_decode("%EA%B2%8C%EC%9E%84%20a.gba"), "게임 a.gba");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn fnv_is_stable() {
        assert_eq!(fnv1a(b""), 0xcbf29ce484222325);
        assert_eq!(format!("{:016x}", fnv1a(b"a")), "af63dc4c8601ec8c");
    }
}
