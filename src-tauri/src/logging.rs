//! `bin/log/YYYY-MM-DD.log` 에 한 줄씩 남긴다(아비터와 같은 자리·이름). 한 줄 = `HH:MM:SS.mmm [LEVEL] [분류] 내용`.
//!
//! - 쓰기는 기록 Thread 하나가 모아서 한다 — 부른 쪽(명령 Thread·화면)이 파일 쓰기를 기다리지 않게.
//! - 날짜 파일은 `KEEP_DAYS` 일 지나면 지운다. 하루 `SOFT_BYTES` 를 넘으면 요약 줄만, `HARD_BYTES` 에서 그날 기록을 멈춘다.
//! - 경로 속 사용자 폴더(`C:\Users\<이름>`)는 `~`, 방 코드·비밀 값은 `***` 로 가린다.
//! - 화면이 보내는 신호(`beat`)가 `BEAT_LOST` 동안 끊기면 화면(웹뷰)이 멈춘 것으로 보고 한 줄 남긴다 — 화면이 멈추면 화면 쪽 기록도 멈추기 때문.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, NaiveDate, TimeZone};

pub const KEEP_DAYS: i64 = 14;
pub const SOFT_BYTES: u64 = 5 * 1024 * 1024;
pub const HARD_BYTES: u64 = 6 * 1024 * 1024;
const LINE_MAX: usize = 4000;
const BEAT_LOST: Duration = Duration::from_secs(15);
const WAKE: Duration = Duration::from_secs(2);
/// 크기 상한을 넘은 뒤에도 남기는 줄(ERROR 와 이 분류).
const SUMMARY: [&str; 5] = ["[앱]", "[게임]", "[성능]", "[멈춤]", "[기록]"];

enum Job {
    Line { at: DateTime<Local>, level: String, text: String },
    Beat(bool),
    Flush { done: Sender<()>, last: bool },
}

static QUEUE: OnceLock<Sender<Job>> = OnceLock::new();
static EVERY: Mutex<Option<HashMap<String, (Instant, u32)>>> = Mutex::new(None);

fn queue() -> &'static Sender<Job> {
    QUEUE.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        let dir = crate::ui::dir(crate::ui::LOG_DIR);
        let _ = std::thread::Builder::new().name("webgba-log".into()).spawn(move || run(rx, dir));
        tx
    })
}

pub fn write(level: &str, text: &str) {
    write_at(Local::now(), level, text);
}

/// 화면이 보낸 줄: 화면이 모아 보내므로 시각은 화면이 남긴 값(Unix ms)으로.
pub fn write_ms(ms: Option<f64>, level: &str, text: &str) {
    let at = ms.filter(|m| m.is_finite()).and_then(|m| Local.timestamp_millis_opt(m as i64).single()).unwrap_or_else(Local::now);
    write_at(at, level, text);
}

fn write_at(at: DateTime<Local>, level: &str, text: &str) {
    let _ = queue().send(Job::Line { at, level: level.to_string(), text: text.to_string() });
}

/// `true` = 화면이 살아 있음(게임 실행 중·창 보임), `false` = 감시 끝(게임 닫음·창 숨김 — 숨긴 창은 타이머가 늦어짐).
pub fn beat(on: bool) {
    let _ = queue().send(Job::Beat(on));
}

/// 쌓인 줄을 파일에 쓰고 돌아온다(최대 1초). `last` = 앱 종료 — 크기 상한으로 버린 줄 수도 남긴다.
pub fn flush(last: bool) {
    let (done, wait) = mpsc::channel();
    if queue().send(Job::Flush { done, last }).is_ok() {
        let _ = wait.recv_timeout(Duration::from_secs(1));
    }
}

/// 같은 `key` 는 `gap` 에 한 번만 `Some(그동안 건너뛴 수)`.
pub fn every(key: &str, gap: Duration) -> Option<u32> {
    let mut guard = EVERY.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    match map.get_mut(key) {
        Some((at, skipped)) if now.duration_since(*at) < gap => {
            *skipped += 1;
            None
        }
        Some((at, skipped)) => {
            let more = *skipped;
            *at = now;
            *skipped = 0;
            Some(more)
        }
        None => {
            if map.len() > 64 {
                map.clear();
            }
            map.insert(key.to_string(), (now, 0));
            Some(0)
        }
    }
}

fn run(rx: Receiver<Job>, dir: PathBuf) {
    let mut sink = Sink::new(dir);
    let mut watch = Watch::default();
    loop {
        match rx.recv_timeout(WAKE) {
            Ok(job) => {
                sink.take(job, &mut watch);
                while let Ok(job) = rx.try_recv() {
                    sink.take(job, &mut watch);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if let Some(text) = watch.check(Instant::now()) {
            sink.line(Local::now(), "WARN", &text);
        }
        sink.flush();
    }
    sink.close();
}

#[derive(Default)]
struct Watch {
    on: bool,
    last: Option<Instant>,
    lost: Option<Instant>,
}

impl Watch {
    fn beat(&mut self, on: bool, now: Instant) -> Option<String> {
        let back = self.lost.take().map(|since| format!("[멈춤] 화면(웹뷰) 응답 다시 옴 · 약 {}초 응답 없었음", now.duration_since(since).as_secs()));
        self.on = on;
        self.last = Some(now);
        back
    }

    fn check(&mut self, now: Instant) -> Option<String> {
        let last = self.last?;
        if !self.on || self.lost.is_some() || now.duration_since(last) < BEAT_LOST {
            return None;
        }
        self.lost = Some(last);
        Some(format!("[멈춤] 화면(웹뷰)이 {}초 넘게 응답하지 않음 · 게임 실행 중·창 보임 상태였음", BEAT_LOST.as_secs()))
    }
}

struct Sink {
    dir: PathBuf,
    day: Option<NaiveDate>,
    file: Option<BufWriter<File>>,
    size: u64,
    dropped: u64,
    noted: u8,
}

impl Sink {
    fn new(dir: PathBuf) -> Self {
        Self { dir, day: None, file: None, size: 0, dropped: 0, noted: 0 }
    }

    fn take(&mut self, job: Job, watch: &mut Watch) {
        match job {
            Job::Line { at, level, text } => self.line(at, &level, &text),
            Job::Beat(on) => {
                if let Some(text) = watch.beat(on, Instant::now()) {
                    self.line(Local::now(), "INFO", &text);
                }
            }
            Job::Flush { done, last } => {
                if last {
                    self.note_dropped();
                }
                self.flush();
                let _ = done.send(());
            }
        }
    }

    fn line(&mut self, at: DateTime<Local>, level: &str, text: &str) {
        let day = at.date_naive();
        // 화면이 모아 보낸 줄은 조금 늦게 와서 날짜가 하루 앞설 수 있다 — 지난 날짜로는 되돌아가지 않는다.
        if self.day.is_none_or(|now| day > now) {
            self.open(day);
        }
        let level = level_of(level);
        let text = clean(text);
        let summary = level == "ERROR" || SUMMARY.iter().any(|tag| text.starts_with(tag));
        let stage = if self.size >= HARD_BYTES {
            2
        } else if self.size >= SOFT_BYTES && !summary {
            1
        } else {
            0
        };
        if stage > 0 {
            self.dropped += 1;
            if self.noted < stage {
                self.noted = stage;
                let note = if stage == 2 {
                    format!("[기록] 오늘 기록이 {}MB 에 이르러 더 남기지 않음 · 남기지 않은 줄 수는 종료·날짜 변경 때 한 줄", HARD_BYTES >> 20)
                } else {
                    format!("[기록] 오늘 기록이 {}MB 를 넘어 이후에는 요약 줄(오류·앱·게임·성능·멈춤)만 남김", SOFT_BYTES >> 20)
                };
                self.raw(at, "INFO", &note);
            }
            return;
        }
        self.raw(at, &level, &text);
    }

    fn raw(&mut self, at: DateTime<Local>, level: &str, text: &str) {
        let Some(file) = self.file.as_mut() else { return };
        let line = format!("{} [{}] {}\n", at.format("%H:%M:%S%.3f"), level, text);
        if file.write_all(line.as_bytes()).is_ok() {
            self.size += line.len() as u64;
        }
    }

    fn open(&mut self, day: NaiveDate) {
        self.close();
        self.day = Some(day);
        let _ = std::fs::create_dir_all(&self.dir);
        let path = self.dir.join(format!("{}.log", day.format("%Y-%m-%d")));
        self.file = OpenOptions::new().create(true).append(true).open(&path).ok().map(BufWriter::new);
        self.size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        self.noted = 0;
        let removed = prune(&self.dir, day);
        if removed > 0 {
            self.raw(Local::now(), "INFO", &format!("[기록] {KEEP_DAYS}일 지난 기록 파일 {removed}개 삭제"));
        }
    }

    fn note_dropped(&mut self) {
        if self.dropped > 0 {
            let text = format!("[기록] 크기 상한으로 남기지 않은 줄 {}개", self.dropped);
            self.dropped = 0;
            self.raw(Local::now(), "INFO", &text);
        }
    }

    fn close(&mut self) {
        self.note_dropped();
        self.flush();
        self.file = None;
    }

    fn flush(&mut self) {
        if let Some(file) = self.file.as_mut() {
            let _ = file.flush();
        }
    }
}

/// `YYYY-MM-DD.log` 중 `today` 보다 `KEEP_DAYS` 일 이상 지난 것을 지운다. 다른 이름의 파일은 건드리지 않는다.
fn prune(dir: &Path, today: NaiveDate) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(".log").filter(|s| s.len() == 10) else { continue };
        let Ok(date) = NaiveDate::parse_from_str(stem, "%Y-%m-%d") else { continue };
        if (today - date).num_days() >= KEEP_DAYS && entry.path().is_file() && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn level_of(level: &str) -> String {
    let level: String = level.chars().filter(|c| c.is_ascii_alphabetic()).take(8).collect::<String>().to_uppercase();
    if level.is_empty() {
        "INFO".into()
    } else {
        level
    }
}

fn clean(text: &str) -> String {
    let mut text = text.replace(['\r', '\n'], " ");
    if text.len() > LINE_MAX {
        let mut cut = LINE_MAX;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push('…');
    }
    hide_secret(&hide_room(&hide_home(&text)))
}

/// `X:\Users\<이름>`(구분자 `\`·`/`) → `~`. 릴리스 빌드의 `--remap-path-prefix` 와 같은 표기.
fn hide_home(text: &str) -> String {
    let b = text.as_bytes();
    let sep = |c: u8| c == b'\\' || c == b'/';
    let mut out = String::with_capacity(text.len());
    let (mut from, mut i) = (0, 0);
    while i + 9 < b.len() {
        let start = b[i].is_ascii_alphabetic()
            && b[i + 1] == b':'
            && sep(b[i + 2])
            && b[i + 3..i + 8].eq_ignore_ascii_case(b"users")
            && sep(b[i + 8])
            && (i == 0 || !b[i - 1].is_ascii_alphanumeric());
        if start {
            let mut j = i + 9;
            while j < b.len() && !name_end(b, j) {
                j += 1;
            }
            if j > i + 9 {
                out.push_str(&text[from..i]);
                out.push('~');
                from = j;
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&text[from..]);
    out
}

/// 사용자 이름은 공백을 품을 수 있어 "공백 + 영문·숫자" 는 이어서 본다.
fn name_end(b: &[u8], j: usize) -> bool {
    match b[j] {
        b'\\' | b'/' | b'"' | b'\'' | b'<' | b'>' | b'|' | b'?' | b'*' | b':' | b';' | b',' | b'(' | b')' | b'[' | b']' => true,
        b' ' => !b.get(j + 1).is_some_and(|c| c.is_ascii_alphanumeric()),
        _ => false,
    }
}

/// 멀티플레이 기록의 "방 <코드>" — 방 코드로 남의 방에 들어갈 수 있어 가린다.
fn hide_room(text: &str) -> String {
    const MARK: &str = "방 ";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(MARK) {
        let (head, tail) = rest.split_at(at + MARK.len());
        out.push_str(head);
        let run = tail.bytes().take_while(|c| c.is_ascii_alphanumeric()).count();
        if (4..=12).contains(&run) {
            out.push_str("***");
            rest = &tail[run..];
        } else {
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// `token=…`·`secret: …`·`Bearer …` 같은 값. 기록하는 줄에 넣지 않지만 게임·서버 오류 글에 섞여 올 수 있다.
fn hide_secret(text: &str) -> String {
    const KEYS: [&str; 8] = ["token", "secret", "password", "passwd", "apikey", "api_key", "credential", "bearer"];
    let low = text.to_ascii_lowercase();
    let b = low.as_bytes();
    let mut cuts: Vec<(usize, usize)> = Vec::new();
    for key in KEYS {
        let mut from = 0;
        while let Some(pos) = low[from..].find(key) {
            let mut j = from + pos + key.len();
            from = j;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] == b'-') {
                j += 1;
            }
            while j < b.len() && matches!(b[j], b'"' | b'\'' | b' ') {
                j += 1;
            }
            if key != "bearer" {
                if j >= b.len() || !(b[j] == b'=' || b[j] == b':') {
                    continue;
                }
                j += 1;
                while j < b.len() && matches!(b[j], b'"' | b'\'' | b' ') {
                    j += 1;
                }
            }
            let start = j;
            while j < b.len() && !matches!(b[j], b' ' | b'"' | b'\'' | b',' | b';' | b'&' | b'}' | b')' | b'<' | b'>') {
                j += 1;
            }
            if j > start {
                cuts.push((start, j));
            }
        }
    }
    if cuts.is_empty() {
        return text.to_string();
    }
    cuts.sort_unstable();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for (start, end) in cuts {
        if end <= at {
            continue;
        }
        out.push_str(&text[at..start.max(at)]);
        out.push_str("***");
        at = end;
    }
    out.push_str(&text[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn at(text: &str) -> DateTime<Local> {
        let naive = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").unwrap();
        Local.from_local_datetime(&naive).earliest().unwrap()
    }

    fn read(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap_or_default()
    }

    #[test]
    fn user_folder_becomes_tilde() {
        assert_eq!(hide_home(r"앱 폴더 C:\Users\tester\OneDrive\바탕 화면\webGBA\bin"), r"앱 폴더 ~\OneDrive\바탕 화면\webGBA\bin");
        assert_eq!(hide_home("file:///C:/Users/tester/a.wgba"), "file:///~/a.wgba");
        assert_eq!(hide_home(r"d:\USERS\John Smith\g.gba · 열기"), r"~\g.gba · 열기");
        assert_eq!(hide_home(r"C:\Users\홍길동\게임.gba"), r"~\게임.gba");
        assert_eq!(hide_home(r"C:\Users\tester"), "~");
        assert_eq!(hide_home(r"C:\Users\tester · 끝"), "~ · 끝");
        assert_eq!(hide_home(r"D:\games\x.gba"), r"D:\games\x.gba");
        assert_eq!(hide_home(r"C:\Users\"), r"C:\Users\");
    }

    #[test]
    fn room_codes_and_secrets_are_masked() {
        assert_eq!(hide_room("방 629336 만듦(근처 칸 6)"), "방 *** 만듦(근처 칸 6)");
        assert_eq!(hide_room("방 629336: 같은 방 코드를 다시 쓰지 못해 새 방 101202"), "방 ***: 같은 방 코드를 다시 쓰지 못해 새 방 ***");
        assert_eq!(hide_room("방 코드 화면 · 방 12"), "방 코드 화면 · 방 12");
        assert_eq!(hide_secret("url?token=abc123&x=1"), "url?token=***&x=1");
        assert_eq!(hide_secret(r#"{"TURN_KEY_API_TOKEN": "s3cr3t", "n": 1}"#), r#"{"TURN_KEY_API_TOKEN": "***", "n": 1}"#);
        assert_eq!(hide_secret("Authorization: Bearer eyJabc.def"), "Authorization: Bearer ***");
        assert_eq!(hide_secret("password 없이"), "password 없이");
        assert_eq!(hide_secret("토큰 없음"), "토큰 없음");
        assert_eq!(clean("a\r\nb"), "a  b");
        let long = "가".repeat(LINE_MAX);
        assert!(clean(&long).len() <= LINE_MAX + "…".len() && clean(&long).ends_with('…'));
    }

    #[test]
    fn old_files_are_pruned_and_days_roll() {
        let dir = fresh("webgba-log-prune");
        for name in ["2026-10-01.log", "2026-10-22.log", "2026-10-23.log", "2026-11-05.log", "notes.log", "2026-10-01.txt"] {
            std::fs::write(dir.join(name), "x\n").unwrap();
        }
        assert_eq!(prune(&dir, day("2026-11-05")), 2, "14일 이상 지난 2026-10-01·10-22 만");
        let mut names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["2026-10-01.txt", "2026-10-23.log", "2026-11-05.log", "notes.log"]);

        let mut sink = Sink::new(dir.clone());
        sink.line(at("2026-11-05 23:59:59"), "info", "[앱] 하나");
        sink.line(at("2026-11-06 00:00:01"), "warn", "[실행] 둘");
        sink.line(at("2026-11-05 23:59:59"), "info", "[실행] 늦게 온 줄");
        sink.close();
        assert!(read(&dir, "2026-11-05.log").ends_with("23:59:59.000 [INFO] [앱] 하나\n"));
        let next = read(&dir, "2026-11-06.log");
        assert!(next.contains("00:00:01.000 [WARN] [실행] 둘\n") && next.contains("[INFO] [실행] 늦게 온 줄"), "{next}");
        assert!(!dir.join("2026-10-23.log").exists(), "날짜가 바뀌면 다시 지움(11-06 기준 14일)");
    }

    #[test]
    fn size_caps_keep_summary_lines() {
        let dir = fresh("webgba-log-cap");
        std::fs::write(dir.join("2026-11-05.log"), vec![b'.'; SOFT_BYTES as usize]).unwrap();
        let mut sink = Sink::new(dir.clone());
        sink.line(at("2026-11-05 10:00:00"), "INFO", "[실행] 일시정지 · 사용자");
        sink.line(at("2026-11-05 10:00:01"), "WARN", "[코어] 진단");
        sink.line(at("2026-11-05 10:00:02"), "INFO", "[성능] 30.0초 · 평균 60.0fps");
        sink.line(at("2026-11-05 10:00:03"), "ERROR", "[오류] 예외");
        sink.flush();
        let soft = read(&dir, "2026-11-05.log")[SOFT_BYTES as usize..].to_string();
        assert!(soft.contains("5MB 를 넘어") && soft.contains("[성능]") && soft.contains("[오류] 예외"), "{soft}");
        assert!(!soft.contains("[실행]") && !soft.contains("[코어]"), "{soft}");
        let big = "x".repeat(LINE_MAX);
        while sink.size < HARD_BYTES {
            sink.line(at("2026-11-05 10:00:04"), "ERROR", &big);
        }
        sink.line(at("2026-11-05 10:00:05"), "ERROR", "[오류] 상한 뒤");
        sink.line(at("2026-11-05 10:00:06"), "INFO", "[앱] 상한 뒤");
        sink.note_dropped();
        sink.flush();
        let hard = read(&dir, "2026-11-05.log");
        assert!(!hard.contains("상한 뒤") && hard.contains("6MB 에 이르러"), "상한 뒤 줄 없음 · 멈춤 안내");
        assert!(hard.ends_with("[INFO] [기록] 크기 상한으로 남기지 않은 줄 4개\n"), "버린 줄 수(5MB 뒤 2 + 6MB 뒤 2)");
    }

    #[test]
    fn every_counts_skipped() {
        let gap = Duration::from_millis(80);
        assert_eq!(every("t-key", gap), Some(0));
        assert_eq!(every("t-key", gap), None);
        assert_eq!(every("t-key", gap), None);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(every("t-key", gap), Some(2));
    }

    #[test]
    fn watch_reports_lost_and_back_once() {
        let mut watch = Watch::default();
        let t0 = Instant::now();
        assert!(watch.check(t0 + Duration::from_secs(60)).is_none(), "신호 전에는 감시하지 않음");
        assert!(watch.beat(true, t0).is_none());
        assert!(watch.check(t0 + Duration::from_secs(10)).is_none());
        assert!(watch.check(t0 + Duration::from_secs(16)).unwrap().contains("15초 넘게"));
        assert!(watch.check(t0 + Duration::from_secs(30)).is_none(), "한 번만");
        assert!(watch.beat(true, t0 + Duration::from_secs(40)).unwrap().contains("약 40초"));
        assert!(watch.beat(false, t0 + Duration::from_secs(41)).is_none());
        assert!(watch.check(t0 + Duration::from_secs(100)).is_none(), "감시 끝");
    }
}
