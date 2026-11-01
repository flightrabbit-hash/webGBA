//! 웹 빌드(.wasm) 열기. 빌드마다 출처를 따로 준다: `http://game.<키>.localhost/`.
//!
//! wry 는 `http://game.*` 를 걸러 `game://<키>.localhost/…` 로 되돌려 넘긴다(wry custom_protocol_workaround).
//! 출처가 빌드마다 달라 localStorage·IndexedDB·IDBFS 가 섞이지 않고, 키가 경로에서 나와 다시 열어도 같다.
//!
//! 이 스킴이 주는 것:
//!   /<파일>                  빌드 폴더 안의 파일만(`..` 로 못 나감). HTML 에는 다리 스크립트 하나를 넣는다.
//!   /__webgba__/<이름>       앱 내장 자산(다리·페이지 없는 빌드용 호스트 페이지)
//!   /rom, /save              웹 빌드 서버(server.js)와 같은 호환 경로(폴더에 같은 이름 파일이 없을 때만).
//!                            /save 는 연 파일 옆 `<이름>.sav`(`store`)를 읽고 쓴다.
//!                            /rom 은 wasm 안에 묶인 롬(`embed`, 사용자 정의 구획 webgba.rom)이 있으면 그것이 먼저.
//!
//! 보안(2026-10-31 결정 101-3): 폴더 빌드는 그 폴더 아래 파일을 읽을 수 있다(그대로 둠). 대신
//!   - 모든 응답에 CSP(`csp`)를 붙여 밖(다른 출처·외부 망)으로 내보내는 길을 막는다.
//!   - /save 쓰기는 그 빌드 자신의 페이지(`Origin` = 그 빌드 출처)가 보낸 것만 받는다(`from_own_page`).
//!   - 틀(iframe)이 이 출처들 밖으로 가는 것은 `frame_may_go` 로 막는다(`ui::tame_webview`).

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::http::{header, HeaderValue, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime};

use crate::error::{Error, Result};
use crate::{embed, store, ui};

pub const SCHEME: &str = "game";

/// 다리 스크립트. 경우 1(원래 페이지)의 `<head>` 맨 앞에 넣는다.
const BRIDGE_TAG: &[u8] = b"<script src=\"/__webgba__/bridge.js\"></script>";

/// 앱 내장 자산 중 웹 빌드 출처에서 쓸 수 있는 것.
const HOST_ASSETS: [(&str, &str); 7] = [
    ("bridge.js", "/js/web/bridge.js"),
    ("host.js", "/js/web/host.js"),
    ("wasm-host.html", "/wasm-host.html"),
    ("host.css", "/css/host.css"),
    ("i18n/ko.json", "/i18n/ko.json"),
    ("i18n/en.json", "/i18n/en.json"),
    ("i18n/ja.json", "/i18n/ja.json"),
];

#[derive(Debug, Clone)]
struct Mount {
    dir: PathBuf,
    /// 연 파일 옆 `<이름>.sav`.
    save: PathBuf,
    rom: Option<PathBuf>,
    /// wasm 안에 묶인 롬. 있으면 `rom` 대신 이것을 준다.
    embedded: Option<embed::Embedded>,
    /// 설명서에 `multiplayer` 가 있는 게임만 true(결정 102-3). 이 빌드 틀에서 WebRTC·DNS 미리 찾기를 쓸 수 있는지.
    /// false 면 응답 HTML 에 차단 스크립트를 넣고, CSP `frame-src 'none'` 와 `X-DNS-Prefetch-Control: off` 를 건다.
    allow_net: bool,
}

static MOUNTS: Mutex<Option<HashMap<String, Mount>>> = Mutex::new(None);

fn with_mounts<T>(f: impl FnOnce(&mut HashMap<String, Mount>) -> T) -> T {
    let mut guard = MOUNTS.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

/// 화면에 돌려주는 빌드 정보.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub key: String,
    pub base: String,
    pub dir: String,
    pub origin: String,
    /// 같은 폴더의 페이지(`<이름>.html` 또는 `index.html`).
    pub page: Option<String>,
    /// 같은 이름의 emscripten 글루(`<이름>.js` 또는 `.mjs`).
    pub glue: Option<String>,
    /// 상태 슬롯 저장 이름(`web/<이름>-<키>`). 세이브는 연 파일 옆 `<이름>.sav`.
    pub save_id: String,
    /// 롬 짐작(`guess_rom`). 없으면 화면이 사람에게 묻고 기억한다. 롬이 묶인 빌드는 짐작하지 않는다.
    pub rom_guess: Option<String>,
    /// wasm 안에 롬이 묶여 있음(사용자 정의 구획 `webgba.rom`). 화면은 모듈에서 바로 꺼내 쓴다.
    pub rom_embedded: bool,
    /// `.wgba` 를 처음 열 때 같은 폴더·같은 이름 `.wasm` 때의 앱 안쪽 폴더(상태 슬롯)를 이어받았으면 그 빌드 키.
    pub moved_from: Option<String>,
}

/// 경로 → 빌드 키(FNV-1a 64 앞 12자리). 출처 이름과 앱 안쪽 폴더 이름(상태 슬롯)에 쓴다.
pub fn key_of(path: &Path) -> String {
    format!("{:016x}", ui::fnv1a(path.to_string_lossy().to_lowercase().as_bytes()))[..12].to_string()
}

/// `.wgba` 로 이름을 바꾼 빌드가 `.wasm` 때의 앱 안쪽 폴더(상태 슬롯)를 이어 쓰게 옮긴다.
/// 폴더째 못 옮기면 상태 슬롯만 옮긴다. 세이브는 연 파일 옆 `.sav` 라 이름이 같으면 그대로 이어진다.
fn adopt_wasm_states(dir: &Path, base: &str, save_id: &str) -> Option<String> {
    let new_dir = store::web_dir(save_id).ok()?;
    let old_key = key_of(&dir.join(format!("{base}.wasm")));
    let old_dir = store::web_dir(&format!("web/{}-{old_key}", store::clean_name(base))).ok()?;
    if !old_dir.is_dir() || old_dir == new_dir {
        return None;
    }
    if !new_dir.exists() && std::fs::rename(&old_dir, &new_dir).is_ok() {
        return Some(old_key);
    }
    std::fs::create_dir_all(&new_dir).ok()?;
    let mut moved = false;
    for name in (1..=9).map(|n| format!("state.ss{n}")) {
        let from = old_dir.join(&name);
        if from.is_file() && !new_dir.join(&name).exists() && std::fs::rename(&from, new_dir.join(&name)).is_ok() {
            moved = true;
        }
    }
    moved.then_some(old_key)
}

/// .wgba·.wasm 경로 → 빌드 정보. 출처를 등록해 둔다. `rom_name` 은 설정 "웹 빌드 롬 파일 이름"(비우면 None).
/// `allow_net` = 설명서에 `multiplayer` 가 있는 게임(화면 JS 가 정함). 그 외에는 이 빌드 틀에서 WebRTC·DNS 미리 찾기를 막는다.
pub fn inspect(path: &str, rom_name: Option<&str>, allow_net: bool) -> Result<Build> {
    let wasm = std::fs::canonicalize(path).map_err(|e| Error::File(format!("{path}: {e}")))?;
    let dir = wasm.parent().ok_or_else(|| Error::File(crate::i18n::tr("rs.noFolderOf")))?.to_path_buf();
    let base = wasm.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "build".into());
    let key = key_of(&wasm);

    let page = [format!("{base}.html"), "index.html".to_string()].into_iter().find(|name| dir.join(name).is_file());
    let glue = [format!("{base}.js"), format!("{base}.mjs")].into_iter().find(|name| dir.join(name).is_file());
    let save_id = format!("web/{}-{key}", store::clean_name(&base));
    let embedded = embed::find(&wasm);
    let rom_guess = if embedded.is_some() { None } else { guess_rom(&wasm, rom_name) };
    let is_wgba = wasm.extension().map(|e| e.eq_ignore_ascii_case("wgba")).unwrap_or(false);
    let moved_from = if is_wgba { adopt_wasm_states(&dir, &base, &save_id) } else { None };
    let save = store::beside_of(path);

    let rom_embedded = embedded.is_some();
    with_mounts(|mounts| {
        let keep = mounts.get(&key).and_then(|m| m.rom.clone());
        let rom = if rom_embedded { None } else { keep.or_else(|| rom_guess.clone()) };
        mounts.insert(key.clone(), Mount { dir: dir.clone(), save, rom, embedded, allow_net });
    });

    Ok(Build {
        origin: origin(&key),
        key,
        base,
        dir: dir.to_string_lossy().into_owned(),
        page,
        glue,
        save_id,
        rom_guess: rom_guess.map(|p| p.to_string_lossy().into_owned()),
        rom_embedded,
        moved_from,
    })
}

pub fn origin(key: &str) -> String {
    if cfg!(windows) {
        format!("http://{SCHEME}.{key}.localhost")
    } else {
        format!("{SCHEME}://{key}.localhost")
    }
}

/// 웹 빌드 출처(`http://game.<키>.localhost`)인지. 키는 열린 빌드가 아니어도 모양만 본다.
fn is_build_origin(url: &tauri::Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    let host = host.to_ascii_lowercase();
    let label = if cfg!(windows) {
        if url.scheme() != "http" {
            return false;
        }
        host.strip_prefix("game.").and_then(|rest| rest.strip_suffix(".localhost"))
    } else {
        if url.scheme() != SCHEME {
            return false;
        }
        host.strip_suffix(".localhost")
    };
    url.port().is_none() && label.is_some_and(|k| !k.is_empty() && k.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// 웹 빌드 틀(iframe, 그 안의 틀 포함)이 가도 되는 주소. 빌드 출처와, 망으로 나가지 않는 about:·data:·javascript:,
/// 빌드 출처에서 만든 blob: 뿐이다. 바깥 주소로 가며 주소에 읽은 내용을 실어 보내는 길을 막는다.
pub fn frame_may_go(uri: &str) -> bool {
    let Ok(url) = uri.parse::<tauri::Url>() else { return false };
    match url.scheme() {
        "about" | "data" | "javascript" => true,
        "blob" => url.path().parse::<tauri::Url>().map(|inner| is_build_origin(&inner)).unwrap_or(false),
        _ => is_build_origin(&url),
    }
}

/// 웹 빌드 출처의 모든 응답에 거는 CSP. 막을 것은 실행이 아니라 내보내기라 emscripten 페이지가 쓰는 인라인 스크립트·eval·wasm 은 둔다.
///   - 요청·불러오기(fetch·XHR·WebSocket·sendBeacon·이미지·글꼴·소리·스크립트·워커·틀)는 이 빌드 출처('self')와 data:·blob: 만
///     → 다른 빌드 출처(다른 키)와 외부 망은 모두 막힘
///   - 양식 보내기는 'self' 만, `<base>` 는 'self' 만, 플러그인 없음
///   - 이 페이지를 끼워 넣을 수 있는 곳은 앱 본 창과 자기 자신뿐
///   - `allow_net` 이 아니면(멀티플레이 설명서 없음) `frame-src 'none'` — 깨끗한 WebRTC 를 다른 출처(blob·data·http) 자식 틀에서
///     다시 얻는 길을 막는다(②의 runner 가 쓰는 길과 같음). 멀티플레이 게임만 `frame-src 'self' data: blob:`.
fn csp(allow_net: bool) -> &'static str {
    static OPEN: OnceLock<String> = OnceLock::new();
    static TAMED: OnceLock<String> = OnceLock::new();
    let make = |frame_src: &str| {
        let app = ui::page_url("").origin().ascii_serialization();
        let local = "'self' data: blob:";
        format!(
            "default-src {local}; script-src {local} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src {local} 'unsafe-inline'; \
             connect-src {local}; img-src {local}; media-src {local}; font-src {local}; worker-src {local}; frame-src {frame_src}; \
             manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' {app}"
        )
    };
    if allow_net {
        OPEN.get_or_init(|| make("'self' data: blob:")).as_str()
    } else {
        TAMED.get_or_init(|| make("'none'")).as_str()
    }
}

/// 멀티플레이 설명서가 없는 게임 틀의 HTML 맨 앞에 넣는 스크립트(결정 102-3). 게임 JS 보다 먼저 돈다.
///   - WebRTC(`RTCPeerConnection`·`webkitRTCPeerConnection`·`mozRTCPeerConnection`·`RTCDataChannel`)를 지우고 다시 못 넣게 undefined 로 고정.
///   - 같은 출처 자식 틀(src 없음·about:blank·srcdoc)로 깨끗한 것을 얻는 길: 틀을 넣는 함수와 contentWindow·window[i] 접근 때 자식에서도 지움.
///     다른 출처 자식 틀(blob·data·http)은 CSP `frame-src 'none'` 이 막는다.
///   - DNS 미리 찾기·미리 연결 힌트(`<link rel=dns-prefetch|preconnect|prefetch|prerender>`)를 넣는 즉시 떼고, 넣으려는 것도 막는다.
/// 본 창(앱 화면)에는 넣지 않는다 — 이후 멀티플레이에서 webGBA 가 WebRTC 를 쓴다.
const TAME_NET_TAG: &[u8] = br##"<script>(function(){"use strict";var W=window;
var names=["RTCPeerConnection","webkitRTCPeerConnection","mozRTCPeerConnection","RTCDataChannel"];
function strip(w){if(!w)return;for(var i=0;i<names.length;i++){try{delete w[names[i]];}catch(e){}try{Object.defineProperty(w,names[i],{value:undefined,writable:false,configurable:false});}catch(e){}}}
strip(W);
function scan(node){try{if(!node)return;if(node.tagName==="IFRAME"){strip(node.contentWindow);}if(node.querySelectorAll){var f=node.querySelectorAll("iframe");for(var i=0;i<f.length;i++)strip(f[i].contentWindow);}}catch(e){}}
function stripFrames(){try{for(var i=0;i<W.length;i++){try{strip(W[i]);}catch(e){}}}catch(e){}}
try{var ip=HTMLIFrameElement.prototype;["contentWindow","contentDocument"].forEach(function(key){var d=Object.getOwnPropertyDescriptor(ip,key);if(!d||!d.get)return;var g=d.get;Object.defineProperty(ip,key,{configurable:true,enumerable:d.enumerable,get:function(){var v;try{v=g.call(this);}catch(e){return null;}try{strip(key==="contentDocument"?(v&&v.defaultView):v);}catch(e){}return v;}});});}catch(e){}
["appendChild","insertBefore","replaceChild"].forEach(function(name){var proto=Node.prototype,orig=proto[name];if(typeof orig!=="function")return;proto[name]=function(){var r=orig.apply(this,arguments);try{scan(arguments[0]);stripFrames();}catch(e){}return r;};});
["append","prepend","before","after","replaceWith"].forEach(function(name){[Element.prototype,Document.prototype,DocumentFragment.prototype].forEach(function(proto){if(!proto||typeof proto[name]!=="function")return;var orig=proto[name];proto[name]=function(){var r=orig.apply(this,arguments);try{for(var i=0;i<arguments.length;i++)scan(arguments[i]);stripFrames();}catch(e){}return r;};});});
var hint=/\b(dns-prefetch|preconnect|prefetch|prerender)\b/i;
function sweep(root){try{var ls=(root&&root.querySelectorAll)?root.querySelectorAll("link[rel]"):[];for(var i=0;i<ls.length;i++){if(hint.test(ls[i].rel||""))ls[i].remove();}}catch(e){}}
try{new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++){var n=a[j];if(n.nodeType!==1)continue;if(n.tagName==="LINK"&&hint.test(n.rel||"")){n.remove();}else{sweep(n);}if(n.tagName==="IFRAME"||((n.querySelectorAll)&&n.querySelector("iframe")))scan(n);}}}).observe(document,{childList:true,subtree:true});}catch(e){}
document.addEventListener("DOMContentLoaded",function(){sweep(document);stripFrames();},{once:true});
})();</script>"##;

/// 이 빌드 자신의 페이지가 보낸 요청인지. 브라우저는 POST·PUT 에 늘 `Origin` 을 붙이고 페이지가 바꿀 수 없다.
/// 다른 빌드의 틀이 `fetch("http://game.<남의 키>.localhost/save", { method: "POST", mode: "no-cors" })` 로 보내면
/// `Origin` 이 그 틀의 출처라 다르다. `Origin` 이 없거나 `null`(출처 없는 틀)이어도 받지 않는다.
fn from_own_page(request: &Request<Vec<u8>>, key: &str) -> bool {
    request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(&origin(key)))
}

/// 호환 경로 /rom 이 줄 롬을 정한다(화면이 기억해 둔 롬이나 사람이 고른 롬).
pub fn set_rom(key: &str, rom: Option<String>) -> Result<()> {
    with_mounts(|mounts| match mounts.get_mut(key) {
        Some(mount) => {
            mount.rom = rom.map(PathBuf::from);
            Ok(())
        }
        None => Err(Error::Game(crate::i18n::tr("rs.buildNotOpen"))),
    })
}

/// 롬 짐작. 각 단계는 같은 폴더 → 위 폴더 순으로 찾는다.
///   1. 설정의 롬 파일 이름(`rom_name`, 비우면 건너뜀. 절대 경로도 됨)
///   2. `<빌드 이름>.gba`
///   3. 같은 폴더의 `.gba` 가 하나뿐이면 그것(같은 폴더에 `.gba` 가 없을 때만 위 폴더에서 같은 규칙)
/// 여럿이라 정하지 못하면 None — 화면이 처음 열 때 묻고 빌드마다 기억한다.
fn guess_rom(wasm: &Path, rom_name: Option<&str>) -> Option<PathBuf> {
    let base = wasm.file_stem()?.to_string_lossy().into_owned();
    let dir = wasm.parent()?;
    let places: Vec<&Path> = [Some(dir), dir.parent()].into_iter().flatten().collect();

    let mut names: Vec<String> = rom_name.map(str::trim).filter(|name| !name.is_empty()).map(str::to_owned).into_iter().collect();
    names.push(format!("{base}.gba"));
    for name in &names {
        if let Some(found) = places.iter().map(|place| place.join(name)).find(|p| p.is_file()) {
            return Some(found);
        }
    }
    for place in &places {
        let Ok(read) = std::fs::read_dir(place) else { continue };
        let mut roms: Vec<PathBuf> = read
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().map(|e| e.eq_ignore_ascii_case("gba")).unwrap_or(false))
            .collect();
        match roms.len() {
            0 => continue,
            1 => return roms.pop(),
            _ => return None,
        }
    }
    None
}

/// 빌드 폴더 안의 실제 파일. `..`·절대 경로는 거른다.
fn resolve(dir: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = dir.to_path_buf();
    for part in Path::new(rel).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None,
        }
    }
    out.is_file().then_some(out)
}

/// `<head …>`(없으면 `<html …>`) 바로 뒤 자리. 둘 다 없으면 맨 앞.
fn head_at(html: &[u8]) -> usize {
    let lower: Vec<u8> = html.iter().map(|b| b.to_ascii_lowercase()).collect();
    lower
        .windows(5)
        .position(|w| w == b"<head")
        .and_then(|start| lower[start..].iter().position(|b| *b == b'>').map(|end| start + end + 1))
        .or_else(|| {
            lower
                .windows(5)
                .position(|w| w == b"<html")
                .and_then(|start| lower[start..].iter().position(|b| *b == b'>').map(|end| start + end + 1))
        })
        .unwrap_or(0)
}

/// `<head>` 맨 앞에 여러 태그를 적은 순서대로 넣는다.
fn inject_head(mut html: Vec<u8>, tags: &[&[u8]]) -> Vec<u8> {
    let at = head_at(&html);
    let mut blob: Vec<u8> = Vec::new();
    for tag in tags {
        blob.extend_from_slice(tag);
    }
    html.splice(at..at, blob);
    html
}

/// 폴더 빌드의 HTML: 다리 스크립트(와 멀티플레이 아닌 빌드면 WebRTC·DNS 차단 스크립트)를 넣는다. 차단 스크립트가 다리보다 먼저.
fn inject_bridge(html: Vec<u8>, allow_net: bool) -> Vec<u8> {
    if allow_net {
        inject_head(html, &[BRIDGE_TAG])
    } else {
        inject_head(html, &[TAME_NET_TAG, BRIDGE_TAG])
    }
}

/// `game` 스킴 응답. 큰 파일(웹 빌드 wasm 수십 MB)을 읽으므로 별도 Thread 에서 부른다. 모든 응답에 CSP 를 붙이고,
/// 멀티플레이 설명서가 없는 빌드면 `X-DNS-Prefetch-Control: off` 도 붙인다(결정 102-3). allow_net 은 그 빌드의 Mount 값.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let key = request.uri().host().unwrap_or_default().to_ascii_lowercase().split('.').next().unwrap_or_default().to_string();
    let allow_net = with_mounts(|mounts| mounts.get(&key).map(|m| m.allow_net)).unwrap_or(false);
    let mut response = route(app, request, allow_net);
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(csp(allow_net)));
    if !allow_net {
        headers.insert("x-dns-prefetch-control", HeaderValue::from_static("off"));
    }
    response
}

fn route<R: Runtime>(app: &AppHandle<R>, request: Request<Vec<u8>>, allow_net: bool) -> Response<Vec<u8>> {
    let host = request.uri().host().unwrap_or_default().to_ascii_lowercase();
    let key = host.split('.').next().unwrap_or_default().to_string();
    let Some(mount) = with_mounts(|mounts| mounts.get(&key).cloned()) else {
        return ui::error(StatusCode::NOT_FOUND, &crate::i18n::tr("rs.buildNotOpen"));
    };

    let rel = ui::percent_decode(request.uri().path().trim_start_matches('/'));

    if let Some(name) = rel.strip_prefix("__webgba__/") {
        let Some((_, asset_path)) = HOST_ASSETS.iter().find(|(n, _)| *n == name) else {
            return ui::error(StatusCode::NOT_FOUND, &crate::i18n::tr("rs.notFound"));
        };
        return match app.asset_resolver().get(asset_path.to_string()) {
            // 페이지 없는 빌드용 호스트 틀(wasm-host.html)에는 다리가 이미 있으니, 멀티플레이 아니면 차단 스크립트만 넣는다.
            Some(asset) if !allow_net && asset.mime_type.starts_with("text/html") => ui::ok(inject_head(asset.bytes.to_vec(), &[TAME_NET_TAG]), &asset.mime_type),
            Some(asset) => ui::ok(asset.bytes, &asset.mime_type),
            None => ui::error(StatusCode::NOT_FOUND, &crate::i18n::tr("rs.notFound")),
        };
    }

    // 글루가 `<이름>.wasm` 을 찾는데 폴더에는 `.wgba` 만 있으면 그것을 wasm 으로 준다(내용은 wasm 그대로).
    let found = resolve(&mount.dir, &rel).or_else(|| {
        rel.strip_suffix(".wasm").and_then(|stem| resolve(&mount.dir, &format!("{stem}.wgba")))
    });
    if let Some(file) = found {
        return match std::fs::read(&file) {
            Ok(body) => {
                let kind = if rel.ends_with(".wasm") { "application/wasm" } else { ui::content_type(&file) };
                let body = if kind.starts_with("text/html") { inject_bridge(body, allow_net) } else { body };
                ui::ok(body, kind)
            }
            Err(e) => ui::error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
    }

    match rel.as_str() {
        "rom" if mount.embedded.is_some() => match mount.embedded.as_ref().map(embed::read) {
            Some(Ok(body)) => ui::ok(body, "application/octet-stream"),
            Some(Err(e)) => ui::error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            None => ui::error(StatusCode::NOT_FOUND, "no rom for this build"),
        },
        "rom" => match mount.rom.as_ref().and_then(|p| std::fs::read(p).ok()) {
            Some(body) => ui::ok(body, "application/octet-stream"),
            None => ui::error(StatusCode::NOT_FOUND, "no rom for this build"),
        },
        "save" => serve_save(&key, &mount, request),
        _ => ui::error(StatusCode::NOT_FOUND, &crate::i18n::tr("rs.notFound")),
    }
}

fn serve_save(key: &str, mount: &Mount, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::GET {
        return match store::read(&mount.save) {
            Ok(body) if !body.is_empty() => ui::ok(body, "application/octet-stream"),
            Ok(_) => ui::error(StatusCode::NOT_FOUND, "no save"),
            Err(e) => ui::error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
    }
    if request.method() == Method::PUT || request.method() == Method::POST {
        if !from_own_page(&request, key) {
            let from = request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).unwrap_or("(없음)");
            crate::logging::write("WARN", &format!("세이브 쓰기 거부: 빌드 {key} 에 다른 출처 {from} 가 보냄"));
            return ui::error(StatusCode::FORBIDDEN, "save can only be written by this build's own page");
        }
        let body = request.body();
        if body.is_empty() || body.len() > 1024 * 1024 {
            return ui::error(StatusCode::BAD_REQUEST, "save must be 1 B .. 1 MiB");
        }
        return match store::write(&mount.save, body) {
            Ok(_) => ui::ok(b"ok".to_vec(), "text/plain; charset=utf-8"),
            Err(e) => ui::error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
    }
    ui::error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_goes_right_after_head() {
        let out = inject_bridge(b"<!doctype html><HTML lang=ko><Head><title>t</title>".to_vec(), true);
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("<Head><script src=\"/__webgba__/bridge.js\"></script><title>"));
    }

    #[test]
    fn bridge_without_head_goes_after_html_or_first() {
        let out = String::from_utf8(inject_bridge(b"<html><body>x".to_vec(), true)).unwrap();
        assert!(out.starts_with("<html><script"));
        let bare = String::from_utf8(inject_bridge(b"<canvas>".to_vec(), true)).unwrap();
        assert!(bare.starts_with("<script"));
    }

    #[test]
    fn tame_net_goes_before_bridge_only_when_not_allowed() {
        // 멀티플레이 아님: 차단 스크립트가 다리보다 먼저
        let tamed = String::from_utf8(inject_bridge(b"<head></head>".to_vec(), false)).unwrap();
        let rtc = tamed.find("RTCPeerConnection").expect("차단 스크립트");
        let bridge = tamed.find("/__webgba__/bridge.js").expect("다리");
        assert!(rtc < bridge, "차단 스크립트가 먼저");
        assert!(tamed.contains("dns-prefetch"));
        // 멀티플레이: 다리만, 차단 스크립트 없음
        let open = String::from_utf8(inject_bridge(b"<head></head>".to_vec(), true)).unwrap();
        assert!(!open.contains("RTCPeerConnection"));
        assert!(open.contains("/__webgba__/bridge.js"));
    }

    #[test]
    fn csp_frame_src_follows_allow_net() {
        assert!(csp(false).contains("frame-src 'none'"), "멀티플레이 아니면 자식 틀 없음");
        assert!(csp(true).contains("frame-src 'self' data: blob:"), "멀티플레이면 자식 틀 허용");
        // 어느 쪽이든 외부 출처는 막는다
        for policy in [csp(false), csp(true)] {
            assert!(policy.contains("connect-src 'self' data: blob:"));
            assert!(policy.contains("object-src 'none'"));
            assert!(HeaderValue::from_str(policy).is_ok());
        }
    }

    #[test]
    fn guess_rom_uses_setting_then_build_name_then_only_gba() {
        let root = std::env::temp_dir().join("webgba-web-guess");
        let _ = std::fs::remove_dir_all(&root);
        let build = root.join("build");
        std::fs::create_dir_all(&build).unwrap();
        let wasm = build.join("game.wgba");
        std::fs::write(&wasm, b"\0asm").unwrap();

        assert_eq!(guess_rom(&wasm, None), None, "롬이 하나도 없음");
        std::fs::write(root.join("upper.gba"), b"x").unwrap();
        assert_eq!(guess_rom(&wasm, None), Some(root.join("upper.gba")), "같은 폴더에 없으면 위 폴더의 하나뿐인 .gba");
        std::fs::write(build.join("only.gba"), b"x").unwrap();
        assert_eq!(guess_rom(&wasm, None), Some(build.join("only.gba")), "같은 폴더의 하나뿐인 .gba");
        std::fs::write(build.join("other.gba"), b"x").unwrap();
        assert_eq!(guess_rom(&wasm, None), None, "같은 폴더에 여럿이면 묻는다(위 폴더로 가지 않음)");
        assert_eq!(guess_rom(&wasm, Some("  ")), None, "빈 설정은 건너뜀");
        assert_eq!(guess_rom(&wasm, Some("upper.gba")), Some(root.join("upper.gba")), "설정 이름은 위 폴더에서도 찾음");
        std::fs::write(build.join("game.gba"), b"x").unwrap();
        assert_eq!(guess_rom(&wasm, None), Some(build.join("game.gba")), "빌드와 같은 이름");
        assert_eq!(guess_rom(&wasm, Some("other.gba")), Some(build.join("other.gba")), "설정 이름이 먼저");
        assert_eq!(guess_rom(&wasm, Some("missing.gba")), Some(build.join("game.gba")), "설정 이름이 없으면 다음 규칙");
        std::fs::remove_dir_all(&root).ok();
    }

    fn save_post(origin_header: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder().method(Method::POST).uri("game://abc123def456.localhost/save");
        if let Some(value) = origin_header {
            builder = builder.header(header::ORIGIN, value);
        }
        builder.body(b"x".to_vec()).unwrap()
    }

    #[test]
    fn save_write_only_from_own_build_page() {
        let key = "abc123def456";
        assert!(from_own_page(&save_post(Some(&origin(key))), key), "자기 출처");
        assert!(from_own_page(&save_post(Some(&origin(key).to_ascii_uppercase())), key), "대소문자만 다름");
        assert!(!from_own_page(&save_post(Some(&origin("0123456789ab"))), key), "다른 빌드 출처");
        assert!(!from_own_page(&save_post(Some(&ui::page_url("").origin().ascii_serialization())), key), "앱 본 창");
        assert!(!from_own_page(&save_post(Some("null")), key), "출처 없는 틀");
        assert!(!from_own_page(&save_post(Some("https://evil.example")), key), "외부");
        assert!(!from_own_page(&save_post(None), key), "Origin 없음");
    }

    #[test]
    fn frames_stay_on_build_origins() {
        let own = format!("{}/index.html?a=1", origin("abc123def456"));
        assert!(frame_may_go(&own));
        assert!(frame_may_go(&format!("{}/x", origin("0123456789ab"))), "다른 빌드 출처도 망 밖은 아님");
        assert!(frame_may_go("about:blank"));
        assert!(frame_may_go("about:srcdoc"));
        assert!(frame_may_go("data:text/html,<p>x"));
        assert!(frame_may_go(&format!("blob:{}/0b1c-uuid", origin("abc123def456"))));
        assert!(!frame_may_go("blob:https://evil.example/0b1c-uuid"));
        assert!(!frame_may_go("https://evil.example/?d=secret"));
        assert!(!frame_may_go("http://evil.example/"));
        assert!(!frame_may_go("http://localhost:8080/"));
        assert!(!frame_may_go("http://127.0.0.1/"));
        assert!(!frame_may_go(&ui::page_url("index.html").to_string()), "앱 화면을 틀에 넣지 않음");
        assert!(!frame_may_go("http://game.localhost/"), "키 없음");
        assert!(!frame_may_go("http://game.abc.evil.localhost/"), "키에 점");
        assert!(!frame_may_go("http://game.abc123def456.localhost:81/"), "포트");
        assert!(!frame_may_go("file:///C:/x.txt"));
        assert!(!frame_may_go("not a url"));
    }

    #[test]
    fn csp_keeps_everything_on_self() {
        let policy = csp(true);
        for directive in ["default-src", "connect-src", "img-src", "media-src", "font-src", "worker-src", "frame-src", "script-src", "style-src"] {
            let part = policy.split(';').map(str::trim).find(|p| p.starts_with(&format!("{directive} "))).unwrap_or_else(|| panic!("{directive} 없음"));
            let sources: Vec<&str> = part.split_whitespace().skip(1).collect();
            assert!(sources.contains(&"'self'"), "{directive}");
            assert!(
                sources.iter().all(|s| ["'self'", "data:", "blob:", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"].contains(s)),
                "{directive} 에 바깥 출처: {part}"
            );
        }
        assert!(policy.contains("form-action 'self'"));
        assert!(policy.contains("object-src 'none'"));
        assert!(HeaderValue::from_str(policy).is_ok());
    }

    #[test]
    fn resolve_refuses_escapes() {
        let dir = std::env::temp_dir().join("webgba-web-resolve");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.js"), b"x").unwrap();
        assert!(resolve(&dir, "a.js").is_some());
        assert!(resolve(&dir, "../a.js").is_none());
        assert!(resolve(&dir, "missing.js").is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
