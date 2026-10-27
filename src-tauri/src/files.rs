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

/// 롬 바이트. `.zip` 이면 안의 첫 `.gba`/`.agb`/`.bin` 을 꺼낸다.
pub fn read_rom(path: &str) -> Result<Vec<u8>> {
    let full = Path::new(path);
    let is_zip = full.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false);
    if !is_zip {
        return std::fs::read(full).map_err(io_at(full));
    }
    let file = std::fs::File::open(full).map_err(io_at(full))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipOpen", e)))?;
    let mut pick: Option<usize> = None;
    for i in 0..archive.len() {
        let Ok(item) = archive.by_index(i) else { continue };
        let name = item.name().to_ascii_lowercase();
        if item.is_file() && (name.ends_with(".gba") || name.ends_with(".agb") || name.ends_with(".bin")) {
            pick = Some(i);
            break;
        }
    }
    let Some(index) = pick else {
        return Err(Error::Game(crate::i18n::tr("rs.zipNoRom")));
    };
    let mut item = archive.by_index(index).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipOpen", e)))?;
    if item.size() > 64 * 1024 * 1024 {
        return Err(Error::Game(crate::i18n::tr("rs.zipTooBig")));
    }
    let mut out = Vec::with_capacity(item.size() as usize);
    item.read_to_end(&mut out).map_err(|e| Error::Game(crate::i18n::tr1("rs.zipRead", e)))?;
    Ok(out)
}

/// 임시 파일에 쓴 뒤 바꿔치기(쓰는 도중 실패해도 원본이 남음). `backup` 이면 처음 덮어쓸 때 `.bak` 을 남긴다.
pub fn write_atomic(target: &Path, bytes: &[u8], backup: bool) -> Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(io_at(parent))?;
    }
    if backup && target.exists() {
        let bak = PathBuf::from(format!("{}.bak", target.display()));
        if !bak.exists() {
            let _ = std::fs::copy(target, &bak);
        }
    }
    let temp = PathBuf::from(format!("{}.tmp", target.display()));
    std::fs::write(&temp, bytes).map_err(io_at(&temp))?;
    std::fs::rename(&temp, target).map_err(io_at(target))
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
