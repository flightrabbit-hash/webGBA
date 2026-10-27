//! webGBA — Tauri 2 웹뷰로 도는 GBA 실행기. 구조는 아비터를 따른다.
//!
//! ```text
//!   webgba.exe 옆 bin/  core/ · ini/ · log/ · save/ · state/ · web/ · webview/
//!            │  invoke()              ▲  event / DOM 이벤트
//!            ▼                        │
//!   ┌────────────────────────────────────────┐
//!   │ bridge::commands      bridge::events   │  ← 유일한 접점
//!   ├────────────────────────────────────────┤
//!   │ files (롬·폴더 목록)  store (세이브·상태)  │
//!   │ web (웹 빌드 출처 game.<키>.localhost)    │
//!   │ ui (화면 서빙·앱 폴더·본 창)  picker     │
//!   └────────────────────────────────────────┘
//! ```
//!
//! 게임 실행(코어·키·소리·프레임)은 모두 웹뷰가 한다. Rust 는 파일과 창만 맡는다.

mod assoc;
mod bridge;
mod config;
mod error;
mod files;
mod i18n;
mod logging;
mod picker;
mod settings;
mod store;
mod ui;
mod web;

use std::sync::Mutex;

use tauri::{Emitter, Manager, Runtime, WindowEvent};

/// 앱 상태. 첫 실행 인자로 받은 파일은 화면이 뜬 뒤 `runtime_info` 로 한 번 넘긴다.
pub struct AppState {
    launch_file: Mutex<Option<String>>,
}

impl AppState {
    pub fn take_launch_file(&self) -> Option<String> {
        self.launch_file.lock().unwrap_or_else(|p| p.into_inner()).take()
    }
}

/// 실행 인자의 열 파일. `[0]`(exe)과 플래그·없는 경로는 건너뛴다.
fn launched_file(argv: &[String]) -> Option<String> {
    argv.iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && std::path::Path::new(a).exists())
        .cloned()
}

/// 창 위치를 기억한다(닫을 때).
pub fn remember_spot<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let maximized = window.is_maximized().unwrap_or(false);
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let previous = config::window_spot();
    let spot = if maximized {
        match previous {
            Some(mut keep) => {
                keep.maximized = true;
                keep
            }
            None => return,
        }
    } else {
        config::WindowSpot {
            x: pos.x as f64 / scale,
            y: pos.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
            maximized: false,
        }
    };
    config::set_window_spot(spot);
}

fn restore_main<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// 창 이벤트: 끌어 놓기 → 화면 DOM 이벤트, 닫기 요청 → 화면이 세이브를 마저 쓰게, 최대화 → 버튼 모양.
fn window_events<R: Runtime>() -> impl Fn(&tauri::Window<R>, &WindowEvent) + Send + Sync + 'static {
    let last_max: Mutex<Option<bool>> = Mutex::new(None);
    move |window, event| {
        let Some(webview) = window.app_handle().get_webview_window(window.label()) else { return };
        match event {
            WindowEvent::DragDrop(drop) => match drop {
                tauri::DragDropEvent::Enter { position, .. } | tauri::DragDropEvent::Over { position } => {
                    bridge::events::os_drag(&webview, Some((position.x, position.y)));
                }
                tauri::DragDropEvent::Drop { paths, position } => {
                    let paths = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    bridge::events::os_drop(&webview, paths, (position.x, position.y));
                }
                tauri::DragDropEvent::Leave => bridge::events::os_drag(&webview, None),
                _ => {}
            },
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = webview.emit_to(window.label(), bridge::events::CLOSE_REQUESTED, ());
                // 화면이 응답하지 않아도 3초 뒤에는 닫는다.
                let handle = webview.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    remember_spot(&handle);
                    let _ = handle.destroy();
                });
            }
            WindowEvent::Resized(_) => {
                let Ok(maximized) = window.is_maximized() else { return };
                let mut seen = last_max.lock().unwrap_or_else(|p| p.into_inner());
                if *seen != Some(maximized) {
                    *seen = Some(maximized);
                    let _ = window.emit_to(window.label(), bridge::events::WINDOW_MAXIMIZED, maximized);
                }
            }
            _ => {}
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 두 번째 실행은 기존 창만 보이고, 넘겨받은 파일을 연다. 반드시 첫 번째로 등록한다.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            restore_main(app);
            if let Some(file) = launched_file(&argv) {
                bridge::events::open_file(app, &file);
            }
        }))
        .register_uri_scheme_protocol(ui::SCHEME, ui::serve)
        // 웹 빌드 wasm 은 수십 MB 라 주 Thread 를 막지 않게 따로 읽는다.
        .register_asynchronous_uri_scheme_protocol(web::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(web::serve(&app, request)));
        })
        .on_window_event(window_events())
        .invoke_handler(tauri::generate_handler![
            bridge::commands::runtime_info,
            bridge::commands::window_minimize,
            bridge::commands::window_toggle_maximize,
            bridge::commands::window_is_maximized,
            bridge::commands::window_close,
            bridge::commands::toggle_devtools,
            bridge::commands::prefs_get,
            bridge::commands::prefs_set,
            bridge::commands::settings_save,
            bridge::commands::lang_set,
            bridge::commands::file_list,
            bridge::commands::file_stat,
            bridge::commands::file_read_bytes,
            bridge::commands::file_write_bytes,
            bridge::commands::rom_read,
            bridge::commands::core_read,
            bridge::commands::reveal_path,
            bridge::commands::pick_file,
            bridge::commands::pick_save,
            bridge::commands::pick_folder,
            bridge::commands::store_read,
            bridge::commands::store_write,
            bridge::commands::store_slots,
            bridge::commands::save_import_beside,
            bridge::commands::save_import_file,
            bridge::commands::save_export,
            bridge::commands::assoc_status,
            bridge::commands::assoc_set,
            bridge::commands::store_path,
            bridge::commands::web_inspect,
            bridge::commands::web_set_rom,
            bridge::commands::log_write,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            ui::ensure_layout(&handle);
            logging::write("INFO", &format!("webGBA {} 시작 · 앱 폴더 {}", env!("CARGO_PKG_VERSION"), ui::bin_root().display()));
            // 오류·대화상자 형식 이름·.wgba 형식 이름을 지난번 언어로(연결보다 먼저).
            i18n::set(config::prefs().get("lang").and_then(|v| v.as_str()).unwrap_or("ko"));
            // .wgba 를 이 exe 로 연결(해제를 고르지 않았으면). 폴더를 옮겨도 켤 때 고쳐 쓴다.
            assoc::ensure_on_start();

            app.manage(AppState {
                launch_file: Mutex::new(launched_file(&std::env::args().collect::<Vec<_>>())),
            });

            let ini = settings::load();
            ui::open_main_window(&handle, &ini, config::window_spot())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("webGBA 를 시작하지 못했습니다");
}
