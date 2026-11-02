fn main() {
    tauri_build::build();

    // Tauri 默认只给应用主程序嵌入清单，库测试程序也需要 Common Controls v6。
    // 否则对话框依赖导入 TaskDialogIndirect 时会在测试启动前报 0xc0000139。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
