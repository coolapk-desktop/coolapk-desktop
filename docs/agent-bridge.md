# 本地 Agent 接口

本指南介绍如何开启桌面客户端的本地 Agent 接口（Agent Bridge），让本机脚本、命令行工具或 AI agent 在本机读取酷安内容（以及后续版本中的发帖、评论、点赞）。

接口默认关闭，开启后只在**本机**监听，并且必须携带程序内生成的访问 token。

---

## 适用场景

- 用脚本定期抓取某个话题、某个用户的动态做归档或分析。
- 让本机的 AI agent 帮你检索酷安内容、整理资料。
- 把酷安数据接入自己的本地工具链（例如笔记、报表、看板）。

不适用：远程服务器访问（接口不监听公网，也不提供跨机访问方式）、需要绕过客户端自身登录与权限的操作。

---

## 开启步骤

1. 打开 **设置 → Agent 接口**。
2. 打开「启用本地 Agent 接口」开关。
3. 按需勾选授权范围（默认只开「读取内容」）。
4. 记录页面显示的**接入地址**与**访问 token**。
5. 关闭开关即可停止服务；token 与端口会保留，下次开启继续可用，只有点「重新生成」才会更换 token。

> token 等同于本机的通行证，只保存在本机应用数据目录的 `agent-bridge-token`（Unix 下权限为 `0600`），重启应用后复用。不要把它写进仓库、截图或聊天记录，也不要交给不受信任的程序。

---

## 接入地址

| 传输方式 | 地址形式 | 说明 |
| --- | --- | --- |
| Unix Socket（Linux / macOS，推荐） | 应用数据目录下的 `agent-bridge.sock` | 不占用任何端口，只能由本机进程访问 |
| TCP 回环 | `http://127.0.0.1:<端口>`（默认 47653） | 只监听回环地址；服务端会校验 `Host` 头并拒绝任何带 `Origin` 的浏览器跨域请求 |

Windows 没有 Unix domain socket，默认使用 TCP 回环。

TCP 回环优先使用固定端口（REST `47653`、MCP `47654`），端口被占用时回退到系统随机端口，实际值以配置为准。token 与端口跨重启保留，脚本读取应用数据目录下的 `agent-bridge.json` 即可；关闭开关时该文件会被删除（token 文件保留），重新开启后端口与 token 不变。

`agent-bridge.json` 结构示例（Linux）：

```json
{
  "version": 1,
  "transport": "uds",
  "socketPath": "/home/<用户名>/.local/share/com.coolapk.desktop/agent-bridge.sock",
  "port": null,
  "token": "<token>",
  "scopes": ["read"],
  "write_mode": "disabled",
  "allowed_accounts": [],
  "mcp_enabled": true,
  "mcp_port": 47654
}
```

Windows 上对应 `%APPDATA%\com.coolapk.desktop\agent-bridge.json`，`transport` 为 `tcp`、`port` 为实际端口。

---

## 调用示例

所有请求都需要带上 `Authorization: Bearer <token>`，响应统一为 JSON：

```json
{ "code": 200, "data": {}, "message": "" }
```

失败时返回 HTTP 状态码与 `{ "code": 401, "message": "...", "retryable": false }`。

### Unix Socket

```bash
SOCK="$HOME/.local/share/com.coolapk.desktop/agent-bridge.sock"
TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.local/share/com.coolapk.desktop/agent-bridge.json'))['token'])")

curl --unix-socket "$SOCK" http://localhost/v1/health \
  -H "Authorization: Bearer $TOKEN"
```

### TCP 回环

```bash
curl http://127.0.0.1:47653/v1/health \
  -H "Authorization: Bearer $TOKEN"
```

### Python

```python
import json, pathlib, urllib.request

config = json.loads((pathlib.Path.home() / '.local/share/com.coolapk.desktop/agent-bridge.json').read_text())
request = urllib.request.Request(
    'http://127.0.0.1:%d/v1/health' % config['port'],
    headers={'Authorization': 'Bearer ' + config['token']},
)
print(json.load(urllib.request.urlopen(request)))
```

---

## 接口列表

| 方法 | 路径 | 说明 | 授权范围 |
| --- | --- | --- | --- |
| GET | `/v1/health` | 版本、当前账号、已开启的授权范围 | 需要 token |
| GET | `/v1/me` | 当前登录账号资料 | `read` |
| GET | `/v1/feed/{id}` | 动态详情 | `read` |
| GET | `/v1/feed/{id}/replies?page=1&listType=lastupdate_desc` | 评论列表 | `read` |
| GET | `/v1/user/{uid}` | 用户资料 | `read` |
| GET | `/v1/user/{uid}/feeds?page=1&feedType=` | 用户动态 | `read` |
| GET | `/v1/topic/{tag}` | 话题详情 | `read` |
| GET | `/v1/search?q=关键词&type=all&page=1` | 综合搜索（`type` 可取 `feed`、`user`、`topic` 等） | `read` |

`data` 字段直接返回酷安接口清洗后的结果，字段含义随官方接口变化。

---

## MCP 客户端接入

设置页的「MCP 服务」开关会让桌面端在**另一个本机回环端口**上提供 MCP 端点。它和上面选择的传输方式无关：Unix Socket 不能被 MCP 客户端直接使用，因此 MCP 始终走 TCP 回环，Windows / macOS / Linux 行为一致。

- 端点：`http://127.0.0.1:<端口>/mcp`，端口随机，设置页的「MCP 接入地址」可直接复制。
- 认证：请求必须带 `Authorization: Bearer <token>`，与 REST 接口共用同一个 token。
- 协议：MCP Streamable HTTP，只提供 `tools` 能力；不提供服务端推送流（`GET /mcp` 返回 `405`），也不保存会话状态，因此常驻开销只有工具表本身。
- 开关 MCP 只会重建监听，token、授权范围与写操作闸门保持不变；关闭本地 Agent 接口则 MCP 一并停止。

### 工具列表

| 工具 | 说明 | 授权范围 |
| --- | --- | --- |
| `coolapk_health` | 版本、监听地址、MCP 地址、授权范围、当前账号 | 需要 token |
| `coolapk_me` | 当前登录账号资料 | `read` |
| `coolapk_search` | 按关键词搜索（`q`，可选 `type`、`page`） | `read` |
| `coolapk_feed_detail` | 动态详情（`id`） | `read` |
| `coolapk_feed_replies` | 评论列表（`id`，可选 `page`、`listType`） | `read` |
| `coolapk_user_profile` | 用户资料（`uid`） | `read` |
| `coolapk_user_feeds` | 用户动态（`uid`，可选 `page`、`feedType`） | `read` |
| `coolapk_topic_detail` | 话题详情（`tag`） | `read` |

工具列表会按已勾选的授权范围过滤（例如只勾了「发布内容」时只会看到 `coolapk_health`）。工具与 REST 接口共用同一份业务实现、限流桶和审计文件；工具执行失败时返回 `isError: true` 的文本内容，错误码与 REST 一致（例如 `428` + `captcha_required`）。

### 客户端配置示例

Claude Code：

```bash
claude mcp add --transport http coolapk http://127.0.0.1:47654/mcp \
  --header 'Authorization: Bearer <token>'
```

支持 HTTP transport 的通用 JSON 配置（Claude Desktop、Cursor 等）：

```json
{
  "mcpServers": {
    "coolapk": {
      "type": "http",
      "url": "http://127.0.0.1:47654/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

非 Streamable HTTP 的旧客户端（只支持 stdio）需要用 `mcp-remote` 之类的桥接工具把上面的 URL 转成 stdio：

```bash
npx -y mcp-remote http://127.0.0.1:47654/mcp \
  --header "Authorization: Bearer <token>"
```

> MCP 端口与 token 跨重启保留（端口被占用时才会回退到随机端口），客户端配置一次即可长期使用；如重新生成了 token，需要在客户端同步更新。MCP 的调用同样只在本机完成，不会把 token 或请求转发到任何第三方。

---

## 限制与审计

- **限流**：读取 60 次/分钟（REST 与 MCP 的 `tools/call` 共用同一个桶）；写入（后续版本）1 次/分钟、10 次/小时。超限返回 `429` 并带 `Retry-After`，MCP 则在工具结果里返回同样的错误码。
- **验证码**：酷安要求人工验证时会返回 `428` 与 `"error": "captcha_required"`，需要在本应用内完成拼图，接口不会自动重试或绕过。
- **审计**：每次调用都会在应用数据目录的 `agent-bridge-audit.jsonl` 追加一行，只记录时间、接口（MCP 记为 `MCP <工具名>`）、授权范围、账号与结果，不记录正文和 Cookie。
- **账号**：默认使用当前登录账号；请求可通过 `X-Coolapk-Account` 指定其他账号，但该账号必须在设置中显式允许。

---

## 常见问题

**返回 401**：token 不正确（例如点过「重新生成」但客户端没更新），或服务在设置里被关闭。重新从设置页复制 token。

**连接被拒绝**：服务没有运行。检查设置页开关，或确认应用没有退出。

**返回 403 `缺少授权范围`**：当前授权范围不包含该接口要求的权限，需要在设置里勾选并重新开启服务。

**TCP 模式下返回 403**：请求的 `Host` 头不是回环地址，或请求带了 `Origin` 头（浏览器发起的跨域请求一律拒绝）。请直接用脚本/命令行调用。

**找不到 `agent-bridge.json`**：服务未开启，或应用刚退出——退出时客户端会关闭服务并清理该文件。

---

## 安全说明

- 接口默认关闭，开启后只在本机监听，不提供任何公网访问方式。
- token 由系统随机数生成并保存在本机（Unix 下 0600），重启应用后复用；「重新生成」会立刻作废旧 token。
- MCP 与 REST 使用同一套校验：只监听回环、校验 `Host` / `Origin`、必须携带 token；关闭开关后立即停止并吊销 token。
- 写操作（发帖、评论、点赞）默认禁用，即使开启也默认要求每次在应用内确认。
- 通过本接口产生的任何操作都会以当前登录账号的身份提交，由此带来的风控或账号风险由使用者自行承担。
