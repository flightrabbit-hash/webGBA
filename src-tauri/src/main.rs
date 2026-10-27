// 콘솔 창 미출력. 디버그 빌드에도 적용한다(아비터와 같음).
#![windows_subsystem = "windows"]

fn main() {
    webgba_lib::run()
}
