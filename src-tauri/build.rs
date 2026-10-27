fn main() {
    // exe 에 매니페스트를 박는다. webGBA 는 **일반 권한(asInvoker)** 으로 뜬다.
    //
    // 아비터는 requireAdministrator 다(매크로가 관리자 창에 입력을 보내야 해서). webGBA 는 그럴 일이 없고,
    // 관리자로 뜨면 탐색기(일반 권한)에서 끌어 놓은 파일이 UIPI 에 막힌다.
    //
    // windows-app-manifest.xml 을 건드릴 때 지킬 것(아비터와 같음):
    //   1. XML 선언(<?xml ... ?>)을 넣지 말 것. 리소스에 들어갈 때 줄 앞에 공백이 붙어 앱이 뜨지 않는다.
    //   2. ASCII 만 쓸 것.
    //   3. Common-Controls 의존성을 지우지 말 것. 빠지면 시스템 대화상자가 옛 모양으로 뜬다.
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run build script");
}
