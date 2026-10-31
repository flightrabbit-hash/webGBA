//! .wgba 안에 묶인 롬: 웹 빌드 wasm 끝의 사용자 정의 구획(custom section) `webgba.rom`.
//!
//! 묶기는 `tools/pack-wgba.mjs`, 형식은 설계.md 의 "롬을 묶은 .wgba" 절. 내장 호스트로 열 때는 화면(`web-host.js` 의
//! `readEmbeddedRom`)이 컴파일한 모듈에서 바로 꺼내 크기·SHA-1 까지 확인한다. 여기는 원래 페이지·글루로 열 때
//! 호환 경로 `/rom` 이 줄 롬을 푼다 — 열 때 구획 위치만 찾아 두고(파일을 다 읽지 않고 구획 머리만 건너뜀) 요청이 오면 읽는다.
//!
//! 구획 내용(little endian, 머리 36바이트):
//!   0 "WGRM" · 4 머리 길이 u16 · 6 형식 판 u8(1) · 7 방식 u8(0 그대로, 1 zlib) · 8 롬 크기 u32 · 12 묶은 크기 u32 ·
//!   16 롬 SHA-1 20바이트 · 머리 길이부터 묶은 롬

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use flate2::read::ZlibDecoder;

pub const SECTION: &str = "webgba.rom";
const MAGIC: &[u8; 4] = b"WGRM";
const HEADER: usize = 36;
const VERSION: u8 = 1;
const METHOD_STORE: u8 = 0;
const METHOD_ZLIB: u8 = 1;
const MAX_ROM: usize = 0x0200_0000;

/// 파일 안 롬 구획의 내용(머리 포함) 자리.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Embedded {
    pub file: PathBuf,
    pub offset: u64,
    pub len: u64,
}

fn read_leb<R: Read>(reader: &mut R) -> io::Result<(u64, u64)> {
    let mut value = 0u64;
    let mut shift = 0;
    let mut used = 0;
    loop {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte)?;
        used += 1;
        value |= u64::from(byte[0] & 0x7f) << shift;
        if byte[0] & 0x80 == 0 {
            return Ok((value, used));
        }
        shift += 7;
        if shift > 28 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "LEB128 too long"));
        }
    }
}

/// 롬 구획 찾기: 새 .wgba(규격 1, 첫 구획이 목차 `webgba.toc`)는 목차의 "rom" 항목으로 바로, 아니면(옛 .wgba·.wasm,
/// 목차가 이상함) 구획 머리를 훑는다. 어느 쪽이든 없으면 None.
pub fn find(path: &Path) -> Option<Embedded> {
    find_by_toc(path).or_else(|| scan(path))
}

const TOC_SECTION: &str = "webgba.toc";
const TOC_MAGIC: &[u8; 4] = b"WGTC";
const TOC_MAJOR: u8 = 1;
const TOC_HEAD: usize = 16;
const TOC_ENTRY: usize = 80;

fn u16_at(bytes: &[u8], at: usize) -> usize {
    usize::from(u16::from_le_bytes([bytes[at], bytes[at + 1]]))
}

fn u32_at(bytes: &[u8], at: usize) -> u64 {
    u64::from(u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]))
}

/// 목차(머리 16 + 항목 80×n, little endian — 규격 2.1)에서 "rom" 항목의 시작·끝. 그 자리가 WGRM 으로 시작해야 쓴다.
fn find_by_toc(path: &Path) -> Option<Embedded> {
    let file = File::open(path).ok()?;
    let total = file.metadata().ok()?.len();
    let mut reader = BufReader::new(file);
    let mut head = [0u8; 9];
    reader.read_exact(&mut head).ok()?;
    if &head[..4] != b"\0asm" || head[8] != 0 {
        return None;
    }
    let (size, _) = read_leb(&mut reader).ok()?;
    let (name_len, name_used) = read_leb(&mut reader).ok()?;
    if name_len != TOC_SECTION.len() as u64 || name_used + name_len > size {
        return None;
    }
    let mut name = [0u8; 10];
    reader.read_exact(&mut name).ok()?;
    if name != TOC_SECTION.as_bytes() {
        return None;
    }
    let mut top = [0u8; TOC_HEAD];
    reader.read_exact(&mut top).ok()?;
    if &top[..4] != TOC_MAGIC || top[4] != TOC_MAJOR {
        return None;
    }
    let (head_len, entry_len, count) = (u16_at(&top, 6), u16_at(&top, 8), u16_at(&top, 10));
    if head_len < TOC_HEAD || entry_len < TOC_ENTRY {
        return None;
    }
    if head_len > TOC_HEAD {
        reader.seek_relative((head_len - TOC_HEAD) as i64).ok()?;
    }
    let mut entry = vec![0u8; entry_len];
    for _ in 0..count {
        reader.read_exact(&mut entry).ok()?;
        let name_end = entry[..32].iter().position(|&b| b == 0).unwrap_or(32);
        if &entry[..name_end] != b"rom" {
            continue;
        }
        let (start, end) = (u32_at(&entry, 32), u32_at(&entry, 36));
        if start >= end || end > total {
            return None;
        }
        reader.seek(SeekFrom::Start(start)).ok()?;
        let mut magic = [0u8; 4];
        reader.read_exact(&mut magic).ok()?;
        return (&magic == MAGIC).then(|| Embedded { file: path.to_path_buf(), offset: start, len: end - start });
    }
    None
}

/// wasm 의 구획 머리만 따라가 `webgba.rom` 구획(여럿이면 마지막)을 찾는다. wasm 이 아니거나 망가졌거나 없으면 None.
fn scan(path: &Path) -> Option<Embedded> {
    let file = File::open(path).ok()?;
    let total = file.metadata().ok()?.len();
    let mut reader = BufReader::new(file);
    let mut head = [0u8; 8];
    reader.read_exact(&mut head).ok()?;
    if &head[..4] != b"\0asm" {
        return None;
    }
    let mut at = 8u64;
    let mut found = None;
    while at < total {
        let mut id = [0u8; 1];
        reader.read_exact(&mut id).ok()?;
        let (size, used) = read_leb(&mut reader).ok()?;
        let body = at + 1 + used;
        let end = body.checked_add(size)?;
        if end > total {
            return None;
        }
        if id[0] == 0 {
            let (name_len, name_used) = read_leb(&mut reader).ok()?;
            if name_len == SECTION.len() as u64 && name_used + name_len <= size {
                let mut name = vec![0u8; SECTION.len()];
                reader.read_exact(&mut name).ok()?;
                if name == SECTION.as_bytes() {
                    let offset = body + name_used + name_len;
                    found = Some(Embedded { file: path.to_path_buf(), offset, len: end - offset });
                }
            }
        }
        reader.seek(SeekFrom::Start(end)).ok()?;
        at = end;
    }
    found
}

fn invalid(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("embedded rom: {what}"))
}

/// 구획 내용 → 롬. 머리·크기를 확인한다(SHA-1 은 열 때 화면이 확인).
pub fn unpack(payload: &[u8]) -> io::Result<Vec<u8>> {
    if payload.len() < HEADER || &payload[..4] != MAGIC {
        return Err(invalid("bad header"));
    }
    let word = |at: usize| u32::from_le_bytes([payload[at], payload[at + 1], payload[at + 2], payload[at + 3]]) as usize;
    let header_size = usize::from(u16::from_le_bytes([payload[4], payload[5]]));
    let (version, method, size, packed) = (payload[6], payload[7], word(8), word(12));
    if version != VERSION {
        return Err(invalid(&format!("unknown version {version}")));
    }
    if header_size < HEADER || header_size + packed > payload.len() || size == 0 || size > MAX_ROM {
        return Err(invalid("bad sizes"));
    }
    let data = &payload[header_size..header_size + packed];
    let rom = match method {
        METHOD_STORE => data.to_vec(),
        METHOD_ZLIB => {
            let mut out = Vec::with_capacity(size);
            ZlibDecoder::new(data).take(size as u64 + 1).read_to_end(&mut out)?;
            out
        }
        other => return Err(invalid(&format!("unknown method {other}"))),
    };
    if rom.len() != size {
        return Err(invalid("size mismatch"));
    }
    Ok(rom)
}

/// 파일에서 구획을 읽어 롬으로 푼다.
pub fn read(embedded: &Embedded) -> io::Result<Vec<u8>> {
    let mut file = File::open(&embedded.file)?;
    file.seek(SeekFrom::Start(embedded.offset))?;
    let mut payload = vec![0u8; usize::try_from(embedded.len).map_err(|_| invalid("too large"))?];
    file.read_exact(&mut payload)?;
    unpack(&payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn leb(mut n: usize) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let mut byte = (n & 0x7f) as u8;
            n >>= 7;
            if n != 0 {
                byte |= 0x80;
            }
            out.push(byte);
            if n == 0 {
                return out;
            }
        }
    }

    fn custom(name: &str, payload: &[u8]) -> Vec<u8> {
        let mut body = leb(name.len());
        body.extend_from_slice(name.as_bytes());
        body.extend_from_slice(payload);
        let mut out = vec![0u8];
        out.extend(leb(body.len()));
        out.extend(body);
        out
    }

    fn payload(rom: &[u8], method: u8) -> Vec<u8> {
        let data = if method == METHOD_ZLIB {
            let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
            enc.write_all(rom).unwrap();
            enc.finish().unwrap()
        } else {
            rom.to_vec()
        };
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(HEADER as u16).to_le_bytes());
        out.push(VERSION);
        out.push(method);
        out.extend_from_slice(&(rom.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&[0u8; 20]);
        out.extend(data);
        out
    }

    fn wasm(extra: &[Vec<u8>]) -> Vec<u8> {
        let mut out = b"\0asm\x01\0\0\0".to_vec();
        out.extend_from_slice(&[1, 1, 0]);
        out.extend(custom("name", &[1, 2, 3]));
        for section in extra {
            out.extend_from_slice(section);
        }
        out
    }

    #[test]
    fn finds_and_unpacks_the_last_rom_section() {
        let dir = std::env::temp_dir().join("webgba-embed-find");
        std::fs::create_dir_all(&dir).unwrap();
        let rom: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let old = vec![7u8; 1000];
        let file = dir.join("game.wgba");
        std::fs::write(&file, wasm(&[custom(SECTION, &payload(&old, METHOD_STORE)), custom(SECTION, &payload(&rom, METHOD_ZLIB))])).unwrap();
        let found = find(&file).expect("구획을 찾음");
        assert_eq!(read(&found).unwrap(), rom, "zlib 롬, 마지막 구획");

        std::fs::write(&file, wasm(&[custom(SECTION, &payload(&old, METHOD_STORE))])).unwrap();
        assert_eq!(read(&find(&file).unwrap()).unwrap(), old, "그대로 묶은 롬");

        std::fs::write(&file, wasm(&[custom("webgba.romx", &payload(&old, METHOD_STORE))])).unwrap();
        assert_eq!(find(&file), None, "이름이 다르면 없음");
        std::fs::write(&file, wasm(&[])).unwrap();
        assert_eq!(find(&file), None, "구획 없는 wasm");
        std::fs::write(&file, b"not wasm at all").unwrap();
        assert_eq!(find(&file), None, "wasm 아님");
        let mut cut = wasm(&[custom(SECTION, &payload(&old, METHOD_STORE))]);
        cut.truncate(cut.len() - 10);
        std::fs::write(&file, cut).unwrap();
        assert_eq!(find(&file), None, "끝이 잘린 wasm");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 새 .wgba 모양: 머리 → 목차(첫 구획) → 원래 구획 → (가짜 롬 구획) → 롬 구획. 목차의 rom 항목 = 진짜 롬 구획 내용.
    fn toc_wasm(rom_payload: &[u8], point_at_rom: bool) -> Vec<u8> {
        let code = [1u8, 1, 0];
        let decoy = custom(SECTION, &payload(&[9u8; 64], METHOD_STORE));
        let rom_section = custom(SECTION, rom_payload);
        let toc_len = TOC_HEAD + TOC_ENTRY;
        let toc_section_len = custom(TOC_SECTION, &vec![0u8; toc_len]).len();
        let rom_at = 8 + toc_section_len + code.len() + decoy.len();
        let start = (rom_at + rom_section.len() - rom_payload.len()) as u32;
        let end = (rom_at + rom_section.len()) as u32;
        let (start, end) = if point_at_rom { (start, end) } else { (8, 40) };
        let mut toc = Vec::new();
        toc.extend_from_slice(TOC_MAGIC);
        toc.extend_from_slice(&[TOC_MAJOR, 0]);
        toc.extend_from_slice(&(TOC_HEAD as u16).to_le_bytes());
        toc.extend_from_slice(&(TOC_ENTRY as u16).to_le_bytes());
        toc.extend_from_slice(&1u16.to_le_bytes());
        toc.extend_from_slice(&((rom_at + rom_section.len()) as u32).to_le_bytes());
        let mut entry = vec![0u8; TOC_ENTRY];
        entry[..3].copy_from_slice(b"rom");
        entry[32..36].copy_from_slice(&start.to_le_bytes());
        entry[36..40].copy_from_slice(&end.to_le_bytes());
        entry[45] = 4;
        toc.extend(entry);
        let mut out = b"\0asm\x01\0\0\0".to_vec();
        out.extend(custom(TOC_SECTION, &toc));
        out.extend_from_slice(&code);
        out.extend(decoy);
        out.extend(rom_section);
        out
    }

    #[test]
    fn finds_the_rom_through_the_table() {
        let dir = std::env::temp_dir().join("webgba-embed-toc");
        std::fs::create_dir_all(&dir).unwrap();
        let rom: Vec<u8> = (0..200_000u32).map(|i| (i % 249) as u8).collect();
        let packed = payload(&rom, METHOD_ZLIB);
        let file = dir.join("new.wgba");
        let bytes = toc_wasm(&packed, true);
        std::fs::write(&file, &bytes).unwrap();
        let by_toc = find_by_toc(&file).expect("목차로 찾음");
        assert_eq!(by_toc.len, packed.len() as u64);
        assert_eq!(find(&file), Some(by_toc.clone()), "목차가 있으면 목차 자리");
        assert_eq!(read(&by_toc).unwrap(), rom);
        assert_eq!(scan(&file), Some(by_toc), "훑기도 같은 자리(마지막 구획)");

        std::fs::write(&file, toc_wasm(&packed, false)).unwrap();
        assert_eq!(find_by_toc(&file), None, "목차 자리가 WGRM 이 아니면 쓰지 않음");
        assert_eq!(read(&find(&file).expect("훑기로 찾음")).unwrap(), rom, "그때는 훑기");

        let mut cut = bytes.clone();
        cut.truncate(40);
        std::fs::write(&file, cut).unwrap();
        assert_eq!(find(&file), None, "목차까지 잘린 파일");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unpack_refuses_broken_payloads() {
        let rom = vec![1u8; 4096];
        let good = payload(&rom, METHOD_ZLIB);
        assert_eq!(unpack(&good).unwrap(), rom);
        let mut magic = good.clone();
        magic[0] = b'X';
        assert!(unpack(&magic).is_err(), "머리 표시");
        let mut version = good.clone();
        version[6] = 9;
        assert!(unpack(&version).is_err(), "형식 판");
        let mut method = good.clone();
        method[7] = 5;
        assert!(unpack(&method).is_err(), "방식");
        let mut size = good.clone();
        size[8..12].copy_from_slice(&4000u32.to_le_bytes());
        assert!(unpack(&size).is_err(), "풀린 크기");
        let mut data = good.clone();
        let last = data.len() - 3;
        data[last] ^= 0xff;
        assert!(unpack(&data).is_err(), "깨진 압축");
        assert!(unpack(&good[..good.len() - 1]).is_err(), "잘린 내용");
    }
}
