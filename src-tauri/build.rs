fn main() {
    tauri_build::build();

    println!("cargo:rerun-if-env-changed=COOLAPK_RUST_TEST_MANIFEST");
    // Tauri 默认只给应用主程序嵌入清单，库测试程序也需要 Common Controls v6。
    // 仅在独立测试命令显式启用，避免与正式应用已有的 MANIFEST 资源重复。
    // 环境变量变化会重新运行构建脚本，防止测试清单参数被后续应用构建沿用。
    if std::env::var("COOLAPK_RUST_TEST_MANIFEST").as_deref() == Ok("1") && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
