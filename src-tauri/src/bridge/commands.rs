//! 화면이 부르는 명령. 큰 바이트(롬·코어·세이브·상태)는 JSON 배열로 바꾸지 않고 원시 ArrayBuffer 로 오간다
//! (`ipc::Response` 로 보내고, 쓰기는 원시 본문 + 헤더로 받는다).

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Runtime, WebviewWindow};

use crate::error::{Error, Result};
use crate::{config, files, picker, settings, store, ui, web};

/// 막히는 작업(파일·대화상자)은 주 Thread 밖에서.
async fn offload<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| Error::Window(crate::i18n::tr1("rs.taskStopped", e)))?
}

fn header(request: &Request<'_>, name: &str) -> Result<String> {
    let raw = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Error::File(crate::i18n::tr1("rs.missingHeader", name)))?;
    Ok(ui::percent_decode(raw))
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err(Error::File(crate::i18n::tr("rs.notBytes"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    version: &'static str,
    bin_dir: String,
    save_dir: String,
    state_dir: String,
    web_dir: String,
    core_path: String,
    launch_file: Option<String>,
    settings: settings::Settings,
}

#[tauri::command]
pub fn runtime_info(state: tauri::State<'_, crate::AppState>) -> RuntimeInfo {
    RuntimeInfo {
        version: env!("CARGO_PKG_VERSION"),
        bin_dir: ui::bin_root().to_string_lossy().into_owned(),
        save_dir: ui::dir(ui::SAVE_DIR).to_string_lossy().into_owned(),
        state_dir: ui::dir(ui::STATE_DIR).to_string_lossy().into_owned(),
        web_dir: ui::dir(ui::WEB_DIR).to_string_lossy().into_owned(),
        core_path: ui::dir(ui::CORE_DIR).join(ui::CORE_FILE).to_string_lossy().into_owned(),
        launch_file: state.take_launch_file(),
        settings: settings::load(),
    }
}

/* ── 창 ── */

#[tauri::command]
pub fn window_minimize<R: Runtime>(window: WebviewWindow<R>) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn window_toggle_maximize<R: Runtime>(window: WebviewWindow<R>) -> bool {
    let maximized = window.is_maximized().unwrap_or(false);
    let _ = if maximized { window.unmaximize() } else { window.maximize() };
    !maximized
}

#[tauri::command]
pub fn window_is_maximized<R: Runtime>(window: WebviewWindow<R>) -> bool {
    window.is_maximized().unwrap_or(false)
}

/// 화면이 세이브를 마저 쓴 뒤 부른다. 위치를 기억하고 닫는다.
#[tauri::command]
pub fn window_close<R: Runtime>(window: WebviewWindow<R>) {
    crate::remember_spot(&window);
    let _ = window.destroy();
}

#[tauri::command]
pub fn toggle_devtools<R: Runtime>(window: WebviewWindow<R>) {
    if !settings::load().use_develop_kit {
        return;
    }
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/* ── 설정 ── */

#[tauri::command]
pub fn prefs_get() -> serde_json::Value {
    config::prefs()
}

#[tauri::command]
pub fn prefs_set(patch: serde_json::Value) -> Result<()> {
    config::merge(patch)
}

/// 설정 창 SAVE 중 `setting.ini` 쪽 값(창이 가려지면 일시정지·세이브 백업·개발자 도구). 다시 읽은 설정을 돌려준다.
#[tauri::command]
pub fn settings_save(patch: serde_json::Map<String, serde_json::Value>) -> Result<settings::Settings> {
    settings::save(&patch)
}

/// 표시 언어. Rust 가 만드는 글(오류·대화상자 형식 이름)도 바꾸고 `lang` 으로 기억한다.
#[tauri::command]
pub fn lang_set(lang: String) -> Result<String> {
    let id = crate::i18n::set(&lang);
    config::merge(serde_json::json!({ "lang": id }))?;
    crate::assoc::refresh_label();
    Ok(id.to_owned())
}

/* ── 파일 ── */

#[tauri::command]
pub async fn file_list(path: String) -> Result<Vec<files::Entry>> {
    offload(move || files::list(&path)).await
}

#[tauri::command]
pub async fn file_stat(path: String) -> Result<files::Entry> {
    offload(move || files::stat(&path)).await
}

#[tauri::command]
pub async fn file_read_bytes(path: String) -> Result<Response> {
    offload(move || std::fs::read(&path).map(Response::new).map_err(|e| Error::File(format!("{path}: {e}")))).await
}

#[tauri::command]
pub fn file_write_bytes(request: Request<'_>) -> Result<()> {
    let path = header(&request, "x-path")?;
    let bytes = raw_body(&request)?;
    files::write_atomic(std::path::Path::new(&path), &bytes, false)
}

#[tauri::command]
pub async fn rom_read(path: String) -> Result<Response> {
    offload(move || files::read_rom(&path).map(Response::new)).await
}

/// 코어 바이트. `bin/core/mgba_core.wasm`(앱 폴더에서 관리), 없으면 exe 내장본.
#[tauri::command]
pub async fn core_read<R: Runtime>(app: AppHandle<R>) -> Result<Response> {
    let path = ui::dir(ui::CORE_DIR).join(ui::CORE_FILE);
    offload(move || match std::fs::read(&path) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(_) => app
            .asset_resolver()
            .get(format!("/bin/core/{}", ui::CORE_FILE))
            .map(|asset| Response::new(asset.bytes))
            .ok_or_else(|| Error::Game(crate::i18n::tr("rs.noCore"))),
    })
    .await
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Result<()> {
    offload(move || files::reveal(&path)).await
}

/* ── 대화상자 ── */

#[tauri::command]
pub async fn pick_file<R: Runtime>(webview: WebviewWindow<R>, options: Option<picker::Options>) -> Result<Option<String>> {
    let owner = webview.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    offload(move || picker::file(options.unwrap_or_default(), owner)).await
}

#[tauri::command]
pub async fn pick_save<R: Runtime>(webview: WebviewWindow<R>, options: Option<picker::Options>) -> Result<Option<String>> {
    let owner = webview.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    offload(move || picker::save(options.unwrap_or_default(), owner)).await
}

#[tauri::command]
pub async fn pick_folder<R: Runtime>(webview: WebviewWindow<R>, options: Option<picker::Options>) -> Result<Option<String>> {
    let owner = webview.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    offload(move || picker::folder(options.unwrap_or_default(), owner)).await
}

/* ── 세이브·상태 ── */

#[tauri::command]
pub async fn store_read(id: String, slot: u8) -> Result<Response> {
    offload(move || store::read(&id, slot).map(Response::new)).await
}

#[tauri::command]
pub fn store_write(request: Request<'_>) -> Result<String> {
    let id = header(&request, "x-store")?;
    let slot: u8 = header(&request, "x-slot")?.parse().map_err(|_| Error::File(crate::i18n::tr("rs.badSlotNumber")))?;
    let bytes = raw_body(&request)?;
    store::write(&id, slot, &bytes, settings::load().save_backup)
}

/// 롬 옆 `<이름>.sav` 를 webGBA 세이브로 가져온다(없으면 복사, 더 새것이면 백업 뒤 가져옴).
#[tauri::command]
pub async fn save_import_beside(rom: String, id: String) -> Result<store::Imported> {
    offload(move || store::import_beside(&rom, &id)).await
}

/// 정해 준 `.sav` 를 같은 규칙으로 가져온다(종료할 때 만든 세이브 파일).
#[tauri::command]
pub async fn save_import_file(source: String, id: String) -> Result<store::Imported> {
    offload(move || store::import_from(&source, &id)).await
}

/// 종료할 때 세이브 파일 만들기. webGBA 세이브를 `target` 에 쓴다(있으면 `.bak` 하나).
#[tauri::command]
pub async fn save_export(id: String, target: String) -> Result<store::Exported> {
    offload(move || store::export_to(&id, &target)).await
}

#[tauri::command]
pub fn store_slots(id: String) -> Result<Vec<store::Slot>> {
    store::slots(&id)
}

#[tauri::command]
pub fn store_path(id: String, slot: u8) -> Result<String> {
    store::path_of(&id, slot).map(|p| p.to_string_lossy().into_owned())
}

/* ── .wgba 연결 ── */

#[tauri::command]
pub fn assoc_status() -> crate::assoc::Status {
    crate::assoc::status()
}

/// 연결하거나 푼다. 고른 값을 `wgbaLink` 로 기억한다(켤 때 다시 연결할지).
#[tauri::command]
pub fn assoc_set(link: bool) -> Result<crate::assoc::Status> {
    if link {
        crate::assoc::link()?;
    } else {
        crate::assoc::unlink()?;
    }
    config::merge(serde_json::json!({ "wgbaLink": link }))?;
    Ok(crate::assoc::status())
}

/* ── 웹 빌드 ── */

#[tauri::command]
pub async fn web_inspect(path: String, rom_name: Option<String>) -> Result<web::Build> {
    offload(move || web::inspect(&path, rom_name.as_deref())).await
}

#[tauri::command]
pub fn web_set_rom(key: String, rom: Option<String>) -> Result<()> {
    web::set_rom(&key, rom)
}

/* ── 기록 ── */

#[tauri::command]
pub fn log_write(level: String, text: String) {
    crate::logging::write(&level, &text);
}
