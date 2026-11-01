use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;

use super::config::AUDIT_FILE_NAME;

/// 追加写入的审计日志：只记录调用元数据，不落正文、Cookie 或 token。
#[derive(Clone)]
pub struct AuditSink {
    path: Arc<PathBuf>,
}

impl AuditSink {
    pub fn new(dir: &Path) -> Self {
        Self { path: Arc::new(dir.join(AUDIT_FILE_NAME)) }
    }

    pub fn path(&self) -> &Path {
        self.path.as_path()
    }

    pub fn record(&self, entry: Value) {
        let line = match serde_json::to_string(&entry) {
            Ok(line) => line,
            Err(_) => return,
        };
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path.as_path())
            .and_then(|mut file| writeln!(file, "{line}"));
    }
}
