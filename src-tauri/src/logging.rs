//! `bin/log/YYYY-MM-DD.log` 에 한 줄씩 남긴다(아비터와 같은 자리·이름).

use std::io::Write;
use std::sync::Mutex;

use crate::ui;

static LOCK: Mutex<()> = Mutex::new(());

pub fn write(level: &str, text: &str) {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let now = chrono::Local::now();
    let path = ui::dir(ui::LOG_DIR).join(format!("{}.log", now.format("%Y-%m-%d")));
    let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let level: String = level.chars().filter(|c| c.is_ascii_alphabetic()).take(8).collect::<String>().to_uppercase();
    let text = text.replace(['\r', '\n'], " ");
    let _ = writeln!(file, "{} [{}] {}", now.format("%H:%M:%S%.3f"), level, text);
}
