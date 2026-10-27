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

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::http::{Method, Request, Response, StatusCode};
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
pub fn inspect(path: &str, rom_name: Option<&str>) -> Result<Build> {
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
        mounts.insert(key.clone(), Mount { dir: dir.clone(), save, rom, embedded });
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

fn inject_bridge(mut html: Vec<u8>) -> Vec<u8> {
    let lower: Vec<u8> = html.iter().map(|b| b.to_ascii_lowercase()).collect();
    let at = lower
        .windows(5)
        .position(|w| w == b"<head")
        .and_then(|start| lower[start..].iter().position(|b| *b == b'>').map(|end| start + end + 1))
        .or_else(|| {
            lower
                .windows(5)
                .position(|w| w == b"<html")
                .and_then(|start| lower[start..].iter().position(|b| *b == b'>').map(|end| start + end + 1))
        })
        .unwrap_or(0);
    html.splice(at..at, BRIDGE_TAG.iter().copied());
    html
}

/// `game` 스킴 응답. 큰 파일(웹 빌드 wasm 수십 MB)을 읽으므로 별도 Thread 에서 부른다.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
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
                let body = if kind.starts_with("text/html") { inject_bridge(body) } else { body };
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
        "save" => serve_save(&mount, request),
        _ => ui::error(StatusCode::NOT_FOUND, &crate::i18n::tr("rs.notFound")),
    }
}

fn serve_save(mount: &Mount, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::GET {
        return match store::read(&mount.save) {
            Ok(body) if !body.is_empty() => ui::ok(body, "application/octet-stream"),
            Ok(_) => ui::error(StatusCode::NOT_FOUND, "no save"),
            Err(e) => ui::error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
    }
    if request.method() == Method::PUT || request.method() == Method::POST {
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
        let out = inject_bridge(b"<!doctype html><HTML lang=ko><Head><title>t</title>".to_vec());
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("<Head><script src=\"/__webgba__/bridge.js\"></script><title>"));
    }

    #[test]
    fn bridge_without_head_goes_after_html_or_first() {
        let out = String::from_utf8(inject_bridge(b"<html><body>x".to_vec())).unwrap();
        assert!(out.starts_with("<html><script"));
        let bare = String::from_utf8(inject_bridge(b"<canvas>".to_vec())).unwrap();
        assert!(bare.starts_with("<script"));
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
