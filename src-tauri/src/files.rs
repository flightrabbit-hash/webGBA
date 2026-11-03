//! 파일 읽기·폴더 목록(탐색기)·롬 꺼내기.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{io_at, Error, Result};

/// 폴더 항목(아비터 engine/files.rs 의 `Entry` 와 같은 모양).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub base_name: String,
    /// 점 없는 소문자 확장자. 폴더·확장자 없음은 빈 문자열.
    pub extension: String,
    pub size: u64,
    pub path: String,
    pub is_dir: bool,
    /// 최종 수정 시각 `2026-10-26 14:52:00`.
    pub modified: Option<String>,
}

fn entry_of(full: &Path, meta: Option<&std::fs::Metadata>) -> Entry {
    let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
    let name = full.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Entry {
        base_name: if is_dir {
            name.clone()
        } else {
            full.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
        },
        extension: if is_dir {
            String::new()
        } else {
            full.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
        },
        size: if is_dir { 0 } else { meta.map(|m| m.len()).unwrap_or(0) },
        path: full.to_string_lossy().into_owned(),
        is_dir,
        modified: meta.and_then(|m| m.modified().ok()).map(|t| {
            let local: chrono::DateTime<chrono::Local> = t.into();
            local.format("%Y-%m-%d %H:%M:%S").to_string()
        }),
        name,
    }
}

/// 폴더 안 목록. 하위 폴더는 훑지 않는다. 폴더 먼저·이름순.
pub fn list(path: &str) -> Result<Vec<Entry>> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(Error::File(crate::i18n::tr1("rs.notFolder", path)));
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(io_at(dir))? {
        let Ok(entry) = entry else { continue };
        let full = entry.path();
        let meta = std::fs::metadata(&full).ok();
        out.push(entry_of(&full, meta.as_ref()));
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

pub fn stat(path: &str) -> Result<Entry> {
    let full = PathBuf::from(path);
    let meta = std::fs::metadata(&full).map_err(io_at(&full))?;
    Ok(entry_of(&full, Some(&meta)))
}

/// zip 안 롬 한도(`read_rom` 과 같음). `.wgba`·`.wasm` 은 웹 빌드라 ZIP 한도(256MB)까지.
const ZIP_ROM_MAX: u64 = 64 * 1024 * 1024;
const ZIP_WEB_MAX: u64 = 256 * 1024 * 1024;

fn open_zip(path: &str) -> Result<zip::ZipArchive<std::fs::File>> {
    let full = Path::new(path);
    let file = std::fs::File::open(full).map_err(io_at(full))?;
    zip::ZipArchive::new(file).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipOpen", e)))
}

/// macOS 가 덧붙이는 `__MACOSX/`·`._이름` 은 게임이 아니다(웹 `zip.js` 의 hidden 과 같은 기준).
fn hidden_entry(name: &str) -> bool {
    let name = name.replace('\\', "/");
    let base = name.rsplit('/').next().unwrap_or("");
    name.ends_with('/') || name.starts_with("__MACOSX/") || name.contains("/__MACOSX/") || base.starts_with("._")
}

/// zip 항목 목록(폴더 제외). 이름은 원래 바이트로 넘겨 화면이 웹과 같은 규칙(UTF-8 → EUC-KR)으로 읽는다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipItem {
    pub index: usize,
    pub raw: Vec<u8>,
    pub size: u64,
    pub method: u16,
    pub encrypted: bool,
}

pub fn zip_list(path: &str) -> Result<Vec<ZipItem>> {
    let mut archive = open_zip(path)?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let Ok(item) = archive.by_index_raw(i) else { continue };
        if item.is_dir() {
            continue;
        }
        #[allow(deprecated)]
        let method = item.compression().to_u16();
        out.push(ZipItem { index: i, raw: item.name_raw().to_vec(), size: item.size(), method, encrypted: item.encrypted() });
    }
    Ok(out)
}

/// zip 항목 하나를 `target` 에 푼다. 결과: "written"(새로 씀) · "same"(같은 내용이 이미 있음) · "exists"(다른 내용이 있고 overwrite 아님).
pub fn zip_extract(path: &str, index: usize, target: &str, overwrite: bool) -> Result<&'static str> {
    let mut archive = open_zip(path)?;
    let mut item = archive.by_index(index).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipRead", e)))?;
    let lower = target.to_ascii_lowercase();
    let max = if lower.ends_with(".wgba") || lower.ends_with(".wasm") { ZIP_WEB_MAX } else { ZIP_ROM_MAX };
    if item.size() > max {
        return Err(Error::Game(crate::i18n::tr("rs.zipTooBig")));
    }
    let mut bytes = Vec::with_capacity(item.size() as usize);
    item.read_to_end(&mut bytes).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipRead", e)))?;
    let full = Path::new(target);
    if full.exists() {
        if std::fs::read(full).map(|old| old == bytes).unwrap_or(false) {
            return Ok("same");
        }
        if !overwrite {
            return Ok("exists");
        }
    }
    write_atomic(full, &bytes)?;
    Ok("written")
}

fn link_ok(url: &str) -> Option<tauri::Url> {
    let parsed: tauri::Url = url.parse().ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some() && parsed.username().is_empty() && parsed.password().is_none()).then_some(parsed)
}

/// 기본 브라우저로 https 주소를 연다(본 창은 앱 화면 밖으로 가지 않으므로).
pub fn open_link(url: &str) -> Result<()> {
    let parsed = link_ok(url).ok_or_else(|| Error::File(crate::i18n::tr1("rs.badLink", url)))?;
    std::process::Command::new("explorer")
        .arg(parsed.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|e| Error::File(crate::i18n::tr1("rs.explorer", e)))
}

/// 롬 바이트. `.zip` 이면 안의 첫 `.gba`/`.agb`/`.gb`/`.gbc`/`.bin` 을 꺼낸다(GB·GBC 는 코어가 롬 머리로 고른다).
pub fn read_rom(path: &str) -> Result<Vec<u8>> {
    let full = Path::new(path);
    let is_zip = full.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false);
    if !is_zip {
        return std::fs::read(full).map_err(io_at(full));
    }
    let mut archive = open_zip(path)?;
    let mut pick: Option<usize> = None;
    for i in 0..archive.len() {
        let Ok(item) = archive.by_index(i) else { continue };
        let name = item.name().to_ascii_lowercase();
        if item.is_file() && !hidden_entry(&name) && [".gba", ".agb", ".gb", ".gbc", ".bin"].iter().any(|ext| name.ends_with(ext)) {
            pick = Some(i);
            break;
        }
    }
    let Some(index) = pick else {
        return Err(Error::Game(crate::i18n::tr("rs.zipNoRom")));
    };
    let mut item = archive.by_index(index).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipOpen", e)))?;
    if item.size() > ZIP_ROM_MAX {
        return Err(Error::Game(crate::i18n::tr("rs.zipTooBig")));
    }
    let mut out = Vec::with_capacity(item.size() as usize);
    item.read_to_end(&mut out).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipRead", e)))?;
    Ok(out)
}

/// 임시 파일에 쓴 뒤 바꿔치기(쓰는 도중 실패하거나 꺼져도 원본이 남음).
/// 바꾸기는 다른 프로그램(OneDrive 동기화·백신)이 잠깐 잡고 있으면 실패하므로 짧게 몇 번 다시 해 본다.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(io_at(parent))?;
    }
    let temp = PathBuf::from(format!("{}.tmp", target.display()));
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&temp).map_err(io_at(&temp))?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            io_at(&temp)(e)
        })?;
    }
    let mut tries = 0;
    loop {
        match std::fs::rename(&temp, target) {
            Ok(()) => return Ok(()),
            Err(e) if tries < 8 && e.kind() != std::io::ErrorKind::NotFound => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&temp);
                return Err(io_at(target)(e));
            }
        }
    }
}

/// 그 파일 자체를 열어 처음부터 덮어쓴다(임시 파일·이름 바꾸기 없음, 세이브용). 없으면 만들고, 새 내용이 더 짧으면 뒤쪽을 잘라 낸다.
/// 열기는 다른 프로그램(OneDrive 동기화·백신)이 잠깐 잡고 있으면 실패하므로 짧게 몇 번 다시 해 본다.
pub fn write_in_place(target: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut tries = 0;
    let mut file = loop {
        match std::fs::OpenOptions::new().write(true).create(true).truncate(false).open(target) {
            Ok(file) => break file,
            Err(e) if tries < 8 && e.kind() != std::io::ErrorKind::NotFound => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(e) => return Err(io_at(target)(e)),
        }
    };
    file.write_all(bytes)
        .and_then(|_| file.set_len(bytes.len() as u64))
        .and_then(|_| file.sync_all())
        .map_err(io_at(target))
}

/// 탐색기에서 보이기. 파일이면 그 파일을 고른 채로, 폴더면 그 폴더를 연다.
pub fn reveal(path: &str) -> Result<()> {
    let full = Path::new(path);
    let mut command = std::process::Command::new("explorer");
    if full.is_file() {
        command.arg(format!("/select,{}", full.display()));
    } else {
        std::fs::create_dir_all(full).map_err(io_at(full))?;
        command.arg(full);
    }
    command.spawn().map(|_| ()).map_err(|e| Error::File(crate::i18n::tr1("rs.explorer", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_entries() {
        assert!(hidden_entry("__MACOSX/a.gba"));
        assert!(hidden_entry("x/__MACOSX/a.gba"));
        assert!(hidden_entry("롬/._a.gba"));
        assert!(hidden_entry("dir/"));
        assert!(!hidden_entry("롬/a.gba"));
    }

    #[test]
    fn links() {
        assert!(link_ok("https://flightrabbit.tistory.com").is_some());
        assert!(link_ok("http://flightrabbit.tistory.com").is_none());
        assert!(link_ok("file:///C:/Windows/notepad.exe").is_none());
        assert!(link_ok("https://user:pw@example.com").is_none());
        assert!(link_ok("C:\\Windows\\notepad.exe").is_none());
    }

    #[test]
    fn extract_states() {
        let dir = std::env::temp_dir().join(format!("webgba-zip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("t.zip");
        {
            use std::io::Write;
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            w.start_file("__MACOSX/a/._game.gba", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"x").unwrap();
            w.start_file("a/game.gba", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"GAME").unwrap();
            w.finish().unwrap();
        }
        let zip_str = zip_path.to_str().unwrap();
        let items = zip_list(zip_str).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].raw, b"a/game.gba");
        let index = items[1].index;
        let target = dir.join("out").join("game.gba");
        let target_str = target.to_str().unwrap();
        assert_eq!(zip_extract(zip_str, index, target_str, false).unwrap(), "written");
        assert_eq!(zip_extract(zip_str, index, target_str, false).unwrap(), "same");
        std::fs::write(&target, b"OTHER").unwrap();
        assert_eq!(zip_extract(zip_str, index, target_str, false).unwrap(), "exists");
        assert_eq!(std::fs::read(&target).unwrap(), b"OTHER");
        assert_eq!(zip_extract(zip_str, index, target_str, true).unwrap(), "written");
        assert_eq!(std::fs::read(&target).unwrap(), b"GAME");
        assert_eq!(read_rom(zip_str).unwrap(), b"GAME");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
