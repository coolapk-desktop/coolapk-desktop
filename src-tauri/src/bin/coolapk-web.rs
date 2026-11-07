// The headless build uses the same core modules without loading Tauri or WebView libraries.
#[allow(dead_code)]
#[path = "../coolapk/core_modules.rs"]
mod coolapk;
#[path = "../web.rs"]
mod web;
#[path = "../coolapk/web_commands.rs"]
mod web_commands;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    web::run().await
}
