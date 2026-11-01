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
5. 关闭开关即可停止服务；token 立即失效。

> token 等同于一次性的本机通行证，只保存在本机应用数据目录（Unix 下权限为 `0600`）。不要把它写进仓库、截图或聊天记录，也不要交给不受信任的程序。

---

## 接入地址

| 传输方式 | 地址形式 | 说明 |
| --- | --- | --- |
| Unix Socket（Linux / macOS，推荐） | 应用数据目录下的 `agent-bridge.sock` | 不占用任何端口，只能由本机进程访问 |
| TCP 回环 | `http://127.0.0.1:<随机端口>` | 只监听回环地址；服务端会校验 `Host` 头并拒绝任何带 `Origin` 的浏览器跨域请求 |

Windows 没有 Unix domain socket，默认使用 TCP 回环。

服务每次启动都会重新生成地址（TCP 端口为随机端口），因此脚本应读取应用数据目录下的 `agent-bridge.json` 获取当前地址；关闭开关时该文件会被删除。

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
  "allowed_accounts": []
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

## 限制与审计

- **限流**：读取 60 次/分钟；写入（后续版本）1 次/分钟、10 次/小时。超限返回 `429` 并带 `Retry-After`。
- **验证码**：酷安要求人工验证时会返回 `428` 与 `"error": "captcha_required"`，需要在本应用内完成拼图，接口不会自动重试或绕过。
- **审计**：每次调用都会在应用数据目录的 `agent-bridge-audit.jsonl` 追加一行，只记录时间、接口、授权范围、账号与结果，不记录正文和 Cookie。
- **账号**：默认使用当前登录账号；请求可通过 `X-Coolapk-Account` 指定其他账号，但该账号必须在设置中显式允许。

---

## 常见问题

**返回 401**：token 不正确，或服务在设置里被关闭、重启过。重新从设置页复制 token。

**连接被拒绝**：服务没有运行。检查设置页开关，或确认应用没有退出。

**返回 403 `缺少授权范围`**：当前授权范围不包含该接口要求的权限，需要在设置里勾选并重新开启服务。

**TCP 模式下返回 403**：请求的 `Host` 头不是回环地址，或请求带了 `Origin` 头（浏览器发起的跨域请求一律拒绝）。请直接用脚本/命令行调用。

**找不到 `agent-bridge.json`**：服务未开启，或应用刚退出——退出时客户端会关闭服务并清理该文件。

---

## 安全说明

- 接口默认关闭，开启后只在本机监听，不提供任何公网访问方式。
- token 由系统随机数生成，退出应用即失效；「重新生成」会立刻作废旧 token。
- 写操作（发帖、评论、点赞）默认禁用，即使开启也默认要求每次在应用内确认。
- 通过本接口产生的任何操作都会以当前登录账号的身份提交，由此带来的风控或账号风险由使用者自行承担。
