//! Rust → 화면 신호.
//!
//! 끌어 놓기는 아비터와 같은 **DOM 이벤트**로 넘긴다(`window.dispatchEvent`). 아비터는 관리자 권한 때문에 WebView2
//! 기본 외부 Drop 을 받아 쓰지만, webGBA 는 일반 권한이라 wry 기본 처리기(`WindowEvent::DragDrop`)가 그대로 받는다.
//! 화면 쪽 처리(오버레이·`onOsFileDrop`)는 아비터와 같다.
//!   webgba:os-drag  { phase: "over" | "end", at: {x, y} | null }   끄는 동안(오버레이용)
//!   webgba:os-drop  { paths: [..], at: {x, y} | null }             놓았을 때

use tauri::{Emitter, Runtime, WebviewWindow};

pub const OS_DRAG: &str = "webgba:os-drag";
pub const OS_DROP: &str = "webgba:os-drop";

/// 실행 중인 창에 파일 열기 요청(두 번째 실행·연결 프로그램).
pub const OPEN_FILE: &str = "webgba://open-file";

/// OS 가 창을 닫으려 함(Alt+F4 등). 화면이 세이브를 마저 쓰고 `window_close` 를 부른다.
pub const CLOSE_REQUESTED: &str = "webgba://close-requested";

pub const WINDOW_MAXIMIZED: &str = "webgba://window-maximized";

fn dispatch<R: Runtime>(window: &WebviewWindow<R>, name: &str, detail: serde_json::Value) {
    let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent({name:?}, {{ detail: {detail} }}));"));
}

/// 물리 픽셀 → CSS 픽셀.
fn css_point<R: Runtime>(window: &WebviewWindow<R>, x: f64, y: f64) -> serde_json::Value {
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    serde_json::json!({ "x": (x / scale).round(), "y": (y / scale).round() })
}

pub fn os_drag<R: Runtime>(window: &WebviewWindow<R>, over: Option<(f64, f64)>) {
    let detail = match over {
        Some((x, y)) => serde_json::json!({ "phase": "over", "at": css_point(window, x, y) }),
        None => serde_json::json!({ "phase": "end", "at": null }),
    };
    dispatch(window, OS_DRAG, detail);
}

pub fn os_drop<R: Runtime>(window: &WebviewWindow<R>, paths: Vec<String>, at: (f64, f64)) {
    dispatch(window, OS_DRAG, serde_json::json!({ "phase": "end", "at": null }));
    if paths.is_empty() {
        return;
    }
    dispatch(window, OS_DROP, serde_json::json!({ "paths": paths, "at": css_point(window, at.0, at.1) }));
}

pub fn open_file<R: Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    let _ = app.emit_to("main", OPEN_FILE, serde_json::json!({ "path": path }));
}
