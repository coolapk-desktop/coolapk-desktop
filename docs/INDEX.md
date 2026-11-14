# docs 索引（唯一入口）

本目录只放「现行规范」与「明确标注日期的审计快照」。新增内容就地写进下表的权威文件，别处引用一律写指针，不复制正文。

## 现行规范

| 文件 | 用途 | 权威性 / 时效 | 维护口径 |
|---|---|---|---|
| [`agent-bridge.md`](agent-bridge.md) | 本地 Agent 接口：监听方式、token、MCP、写操作闸门、46 个工具的契约 | 现行，随代码改 | 改 `src-tauri` Agent 相关代码时同步 |
| [`beta-release.md`](beta-release.md) | 测试版发布工作流：增量计算、beta 编号、产物校验、渠道切换 | 现行，随 `.github/workflows/beta-release.yml` 改 | 版本规则摘要留在仓库根 `AGENTS.md`，细节只写这里 |
| [`cookie-guide.md`](cookie-guide.md) | 浏览器手动抓 Cookie 并导入登录 | 现行（面向用户） | 官方页面改变时更新 |
| [`performance-diagnostics.md`](performance-diagnostics.md) | 性能诊断日志字段含义与排查方法 | 现行，随 `diagnosticLogger` 改 | 字段增删时同步 |

## API 参考（两份并存，分工不同，勿合并或互删）

| 文件 | 定位 | 时效 |
|---|---|---|
| [`coolapk-api.md`](coolapk-api.md) | **本项目实际接入**的端点 + 可用性实测（`src-tauri/src/coolapk/api_tests.rs` 的探测测试即证据） | 可用性数据为 2026-08-06 实测，日期随探测更新 |
| [`COOLAPK_API_DOCUMENTATION.md`](COOLAPK_API_DOCUMENTATION.md) | 官方 Android 客户端**反编译全量**接口清单（路径/参数/字段含义），不保证本项目已接入 | 逆向快照，官方改版后可能失效 |

判据：要查「我们能不能调、现在通不通」看前者；要查「官方还有哪些端点、字段叫什么」看后者。

## 历史快照（非现行规范，勿据此实现）

| 文件 | 快照日期 | 说明 |
|---|---|---|
| [`mobile-pull-refresh-audit-2026-10-19.md`](mobile-pull-refresh-audit-2026-10-19.md) | 2026-10-19 | 逐页下拉刷新接入评估与依据；结论已落地进代码，此处仅留证据 |

更早的全仓审计、子代理缺口等留档在 `.pi/memory/history/`（不进 git，`mem` 跳过）。
