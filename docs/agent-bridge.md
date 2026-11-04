# 本地 Agent 接口

本指南介绍如何开启桌面客户端的本地 Agent 接口（Agent Bridge），供本机脚本、命令行工具或 AI agent 读取酷安内容，并调用当前版本提供的自动化工具。

接口首次默认关闭，开启后只在**本机**监听，并且必须携带程序内生成的访问 token。接口开关、MCP 开关、授权范围、传输方式和写操作模式会保存在本机；退出时若接口仍开启，下次启动会自动恢复。

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
3. 选择权限预设：默认「只读」；需要写入时选「敏感写操作需确认」（每次写入在应用内弹窗）或「完全放开（自动执行）」。读取权限固定开放，不能关闭；需要更细的组合时改用「自定义」，再用下方「授权范围」与「写操作闸门」逐项选择，保存后立即生效。
4. 记录页面显示的**接入地址**与**访问 token**。
5. 需要给 Claude Code、Codex 等客户端用时，再打开「MCP 服务」开关，复制上方的 **MCP 接入地址**。
6. 关闭接口开关会停止服务并取消下次自动恢复；只退出应用时若开关仍开启，下次启动会恢复服务。token 会保留；再次开启时会重新绑定端口，固定端口被占用时可能分配新的随机端口。只有点「重新生成」才会更换 token。

> 写能力现状：发帖（含图片）、编辑自己的动态、评论/楼中楼回复、评论点赞、转发、收藏与收藏单管理、删除自己的动态/评论、关注话题、主页置顶、点赞、关注、私信均已接通，受下方写操作闸门约束；图文长文编辑需自行提供官方 ArticleModel 正文，改变动态类型不被支持。应用收藏也已接通（按包名，内部走收藏单接口）；应用评价尚未提供。商品/数码类只有只读工具，不提供任何交易类写操作。

> token 等同于本机的通行证，只保存在本机应用数据目录的 `agent-bridge-token`（Unix 下权限为 `0600`），重启应用后复用。不要把它写进仓库、截图或聊天记录，也不要交给不受信任的程序。

---

## 接入地址

| 传输方式 | 地址形式 | 说明 |
| --- | --- | --- |
| Unix Socket（Linux / macOS，推荐） | 应用数据目录下的 `agent-bridge.sock` | 不占用任何端口，只能由本机进程访问 |
| TCP 回环 | `http://127.0.0.1:<端口>`（默认 47653） | 只监听回环地址；服务端会校验 `Host` 头并拒绝任何带 `Origin` 的浏览器跨域请求 |

Windows 没有 Unix domain socket，默认使用 TCP 回环。

TCP 回环优先使用固定端口（REST `47653`、MCP `47654`），端口被占用时回退到系统随机端口，实际地址以当前运行的 `agent-bridge.json` 为准。token 跨重启保留；脚本应在服务运行期间读取应用数据目录下的 `agent-bridge.json`。关闭开关或退出应用时会删除该运行时文件（token 文件与设置偏好保留）；重新开启时会重新绑定端口，固定端口可用时仍使用固定端口。

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
| `coolapk_notifications` | 通知列表（`type`：list/sublist/feedLikeList/contactsFollowList，`page`） | `read` |
| `coolapk_favorites` | 我的收藏（`favType`：feed/apk/topic 等，`page`） | `read` |
| `coolapk_following_feeds` | 关注时间线（`page`） | `read` |
| `coolapk_reply_thread` | 一级评论下的楼中楼（`feedId`、`replyId`、`page`） | `read` |
| `coolapk_private_messages` | 私信会话列表（`page`） | `read` |
| `coolapk_collections` | 我的收藏单（收藏夹分类）列表（`page`） | `read` |
| `coolapk_collection_items` | 收藏单内容列表（`collectionId`、`page`） | `read` |
| `coolapk_collection_detail` | 收藏单详情（`collectionId`） | `read` |
| `coolapk_feed_collections` | 某条动态已加入哪些收藏单（`feedId`） | `read` |
| `coolapk_product_detail` | 数码产品详情（`productId` 或 `name`） | `read` |
| `coolapk_product_feeds` | 产品相关动态（`productId`，可选 `feedType`、`page`） | `read` |
| `coolapk_product_versions` | 产品版本/到手价配置（`productId`） | `read` |
| `coolapk_publish_feed` | 发布动态：正文 + 最多 9 张图片（base64 或本机路径），可指定板块与可见范围 | `write.publish` |
| `coolapk_reply_feed` | 评论动态，带 `rid` 时回复某条评论（楼中楼），可带图片 | `write.interact` |
| `coolapk_forward_feed` | 转发动态，评语与图片可选 | `write.interact` |
| `coolapk_favorite_feed` / `coolapk_unfavorite_feed` | 收藏 / 取消收藏动态（`feedId`） | `write.interact` |
| `coolapk_favorite_apk` / `coolapk_unfavorite_apk` | 收藏 / 取消收藏应用（`packageName`） | `write.interact` |
| `coolapk_delete_feed` | 删除自己发布的动态（不可恢复） | `write.publish` |
| `coolapk_update_feed` | 编辑自己已发布的动态（不传图片则沿用原配图） | `write.publish` |
| `coolapk_like_reply` / `coolapk_unlike_reply` | 点赞 / 取消点赞评论（`replyId`） | `write.interact` |
| `coolapk_delete_reply` | 删除自己发表的评论（`replyId`，不可恢复） | `write.interact` |
| `coolapk_follow_topic` / `coolapk_unfollow_topic` | 关注 / 取消关注话题（`tag`） | `write.interact` |
| `coolapk_send_message` | 给指定用户发私信（`uid`、`message`，1000 字以内） | `write.interact` |
| `coolapk_set_feed_top` / `coolapk_unset_feed_top` | 个人主页置顶 / 取消置顶动态（`feedId`） | `write.interact` |
| `coolapk_collection_create` | 新建收藏单（`title`，可选 `description`/`cover`/`isOpen`） | `write.interact` |
| `coolapk_collection_add_feed` | 把动态加入/移出收藏单（`feedId`、`collectionIds`、`cancelIds`） | `write.interact` |
| `coolapk_collection_remove_item` | 从收藏单移除一条内容（`itemId`） | `write.interact` |
| `coolapk_collection_update` | 编辑收藏单（`collectionId`、`title` 等） | `write.publish` |
| `coolapk_collection_delete` | 删除收藏单（不可恢复） | `write.publish` |
| `coolapk_like_feed` / `coolapk_unlike_feed` | 点赞 / 取消点赞（`feedId`） | `write.interact` |
| `coolapk_follow_user` / `coolapk_unfollow_user` | 关注 / 取消关注（`uid`） | `write.interact` |

读取工具始终可用；写工具按已授予的写授权过滤（预设为「只读」时不会出现任何写工具）。工具与 REST 接口共用同一份业务实现、限流桶和审计文件；工具执行失败时返回 `isError: true` 的文本内容，错误码与 REST 一致（例如 `428` + `captcha_required`）。

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

### 给 AI 的说明

开启接口后，设置页底部「给 AI 的说明」会按当前配置生成一段可直接粘贴的文字：包含接入地址、访问 token、当前授权范围与写操作闸门、可用工具清单（名称+说明）、限流与错误码约定，以及针对 AI 的使用约定（先查 ID、不批量删除、遇到验证码停下等）。

点「复制说明」把整段内容发给 Claude Code、Codex、Cursor 等本机 AI，它就能自己完成 MCP 注册并按当前权限调用，不需要你手动拼地址和 token。说明由后端从运行时配置与工具表即时生成，改过授权或闸门后页面上的内容会同步更新；预览里的 token 会打码，复制得到的是完整文本。

---

## 写操作与闸门

### 写工具参数

#### 发帖（`coolapk_publish_feed`）

| 参数 | 说明 |
| --- | --- |
| `message` | 动态正文，最多 5000 字；话题直接写在正文里（`#话题#`）。与图片至少给一项 |
| `images` | 可选，`[{ name, mimeType, dataBase64 }]`，单张 8 MB、最多 9 张、合计 20 MB |
| `imagePaths` | 可选，本机绝对路径列表（JPEG/PNG/WebP）；应用自己读盘上传，**推荐平板/大图场景**，与 `images` 合计最多 9 张 |
| `visibleStatus` | `1` 公开（默认）、`-1` 仅自己 |
| `options` | 官方 createFeed 扩展表单，未知字段会被拒绝：`targetType`+`targetId`（发布板块 tag/apk/product_phone）、`largeCover`、`subTypeId`/`subData`、`originalType`、`extraUrl`、`dyhId`、`mediaUrl`/`mediaInfo`、`includeDeviceModel`、`htmlArticle`+`messageTitle`+`messageCover`（图文长文，正文需为官方 ArticleModel JSON） |
| `requestId` | 幂等 id，5 分钟内同工具同账号重复调用直接返回上次结果 |

执行顺序与官方 App 一致：逐张上传图片（`image/feed` 目录）取图片地址 → 逗号拼 `pic` → 提交 `createFeed`。
成功返回 `{ "dryRun": false, "deduplicated": false, "data": { "feedId": …, "feed": {…}, "imageUrls": [...], "messageChars": n } }`。

#### 评论（`coolapk_reply_feed`）

| 参数 | 说明 |
| --- | --- |
| `feedId` | 必填，被评论的动态 ID；楼中楼时仍是该评论所属动态的 ID |
| `message` | 评论正文，最多 1000 字；与图片至少给一项 |
| `rid` | 可选，回复某条评论时填该评论 id |
| `images` / `imagePaths` | 可选，规则与发帖一致 |
| `requestId` | 幂等 id，规则与发帖一致 |

仅自己可见的动态无法被评论（服务端拒绝），需要先在应用内改为公开。

#### 转发（`coolapk_forward_feed`）

只有 `feedId` 必填，`message`（评语）与图片可选；同样支持 `requestId`。

#### 编辑动态（`coolapk_update_feed`）

| 参数 | 说明 |
| --- | --- |
| `feedId` | 必填，要编辑的动态 ID |
| `message` | 必填，编辑后的正文（图文长文时是官方 ArticleModel JSON） |
| `images` / `imagePaths` | 可选；**不传则沿用原动态配图**，传了就以本次为准（整组替换） |
| `clearImages` | `true` 表示清空配图，与 `images`/`imagePaths` 互斥 |
| `options` | 与发帖相同的 createFeed 表单；图文长文需 `htmlArticle: true` + `messageTitle` |

受官方接口限制：只能编辑普通动态与图文长文，不能改变原动态类型，视频/大封面动态不支持；`enableModify=0`（官网不允许或编辑次数用尽）时会直接报错。

#### 评论管理（`coolapk_like_reply` / `coolapk_unlike_reply` / `coolapk_delete_reply`）

参数只有一个 `replyId`。**评论 ID 取 `coolapk_feed_replies` 结果里的 `id` 字段**（`rid` 是楼中楼的目标评论，顶层评论为 `0`，不要用它）。

#### 话题（`coolapk_follow_topic` / `coolapk_unfollow_topic`）

参数 `tag` 为话题名，可带 `#` 包裹（会去掉），例如 `酷安` 或 `#酷安#`。

#### 私信（`coolapk_send_message`）

参数 `uid`（收件人）+ `message`（1000 字以内）。服务端不允许给自己发私信。私信会直接送到真实用户，务必确认收件人与内容后再调用。

#### 主页置顶（coolapk_set_feed_top / coolapk_unset_feed_top）

参数只有一个 feedId，作用对象是当前登录账号的个人主页（nodeType=member）。

#### 收藏单（收藏夹分类）

收藏单就是酷安的「收藏夹分类」：`coolapk_collections` 列出现有收藏单，`coolapk_collection_create` 新建，
`coolapk_collection_add_feed` 把动态放进或移出收藏单（`collectionIds` 加入、`cancelIds` 移出，字符串或数组都接受），
`coolapk_collection_items` 读取内容（移除时 `itemId` 用每条返回的 `id`，实测通常等于动态 id）。

- 只有公开（`isOpen=true`）的收藏单会出现在 `coolapk_collections` 里；私密收藏单只能靠已知 id 用 `coolapk_collection_detail` / `coolapk_collection_delete` 操作。
- 新建默认公开；标题最多 60 字、简介最多 200 字，`cover` 必须是 http(s) 图片地址。

#### 商品 / 数码（只读）

`coolapk_product_detail`、`coolapk_product_feeds`、`coolapk_product_versions` 只做信息查询。
本接口不提供任何商品交易类操作（下单、购买、转卖、自动抢购等），也不会把这类动作包装成工具；商品相关一律只读，避免涉及金额与自动交易纠纷。

#### 收藏 / 删除

`coolapk_favorite_feed`、`coolapk_unfavorite_feed`、`coolapk_delete_feed` 只接受 `feedId`。

`coolapk_favorite_apk`、`coolapk_unfavorite_apk` 只接受 `packageName`（例如 `com.coolapk.market`）。官方应用收藏走的是收藏单接口：收藏时加入默认收藏单，取消收藏会把该应用移出全部已选收藏单；重复调用保持幂等，不会重复加入。
删除与发帖共用 `write.publish` 授权和「1 次/分钟、10 次/小时」桶，且不可恢复；批量清理时请自行控制节奏（两次删除之间约需间隔 1 分钟）。
酷安要求人工验证时会返回 `428 captcha_required`：接口不会自动重试；请在应用内完成一次拼图验证，客户端会把验证凭证复用到后续请求，验证后重试即可。网易易盾 `_v2_post_token` 不携带（服务端并不强制）。

### MCP 请求体上限

MCP 端点允许最大 32 MiB 请求体（发帖图片 base64 膨胀后的上限），远超 REST 的常规请求；但平板端仍建议用 `imagePaths`，避免大头像/原图在 base64 编解码上浪费内存与时间。

写工具与读工具共用同一个客户端、限流桶和审计文件，但多一层「写操作闸门」（设置页「写操作闸门」）：

| 模式 | 行为 |
| --- | --- |
| `disabled`（默认） | 拒绝所有写调用，返回 `403` + `error: "write_disabled"` |
| `dry-run` | 完整校验参数并返回预览（`{ "dryRun": true, "preview": … }`），不调用酷安接口 |
| `confirm` | 先在应用内弹窗确认（默认 60 秒，超时或拒绝返回 `403 write_confirm_denied`），批准后才提交 |
| `auto` | 校验通过直接提交，只写审计；由用户显式选择 |

- `confirm` 需要应用窗口在前台（最小化/托盘时不会自动抢焦点，最终按超时拒绝）；同一时刻只保留一个待确认请求，新请求会让旧请求以拒绝结束。
- 实际提交成功返回 `{ "dryRun": false, "deduplicated": false, "data": … }`。
- 发帖工具支持可选的 `requestId`：同一 `工具 + 账号 + requestId` 在 5 分钟内重复调用会直接返回上次成功结果（`"deduplicated": true`），用于抵御 MCP 客户端重试导致的重复发布；不传则不去重。
- 当前只有 `coolapk_publish_feed` 提供 `requestId`；点赞/关注是幂等语义，不需要。
- 写操作审计在通用字段上追加 `tool`、`target`（feedId/uid）、`dryRun`、`deduplicated`、`error`；发帖另记 `messageChars`、`imageCount`，**不记录正文或图片内容**。

---

## 限制与审计

- **限流**：读取 60 次/分钟（REST 与 MCP 的 `tools/call` 共用同一个桶）；发布类写操作 1 次/分钟、10 次/小时，互动类写操作 6 次/分钟、60 次/小时。超限返回 `429` 并带 `Retry-After`，MCP 则在工具结果里返回同样的错误码。
- **验证码**：酷安要求人工验证时会返回 `428` 与 `"error": "captcha_required"`，需要在本应用内完成拼图，接口不会自动重试或绕过。
- **审计**：每次调用都会在应用数据目录的 `agent-bridge-audit.jsonl` 追加一行，只记录时间、接口（MCP 记为 `MCP <工具名>`）、授权范围、账号与结果；写操作另记 `target`、`dryRun`、`deduplicated` 与正文字数/图片数，不记录正文、图片内容和 Cookie。
- **账号**：只使用应用当前登录的账号；暂不支持通过请求头切换到其他账号（`allowed_accounts` 字段为后续多账号场景预留）。

---

## 常见问题

**返回 401**：token 不正确（例如点过「重新生成」但客户端没更新），或服务在设置里被关闭。重新从设置页复制 token。

**连接被拒绝**：服务没有运行。检查设置页开关，或确认应用没有退出。

**返回 403 `缺少授权范围`**：当前授权范围不包含该接口要求的权限。在「权限预设」或「授权范围」里勾选对应写授权即可，保存后会重建监听并立即生效（token 与客户端配置不变）。

**TCP 模式下返回 403**：请求的 `Host` 头不是回环地址，或请求带了 `Origin` 头（浏览器发起的跨域请求一律拒绝）。请直接用脚本/命令行调用。

**找不到 `agent-bridge.json`**：服务未开启，或应用刚退出——客户端退出时会关闭监听并清理该运行时文件；如果设置中的接口开关仍为开启，应用下次启动会自动恢复。

---

## 安全说明

- 接口首次默认关闭；用户开启后，应用重启时会恢复该状态，关闭设置开关可停止服务并取消自动恢复。服务只在本机监听，不提供任何公网访问方式。
- token 由系统随机数生成并保存在本机（Unix 下 0600），重启应用后复用；「重新生成」会立刻作废旧 token。
- MCP 与 REST 使用同一套校验：只监听回环、校验 `Host` / `Origin`、必须携带 token；关闭接口开关会立即停止监听，token 保留在本机，需要作废时点「重新生成」。
- 读取权限固定开放，写操作默认禁用（预设「只读」）；`confirm` 模式每次都需要在应用内确认（60 秒超时自动拒绝），`auto` 只应在本机可信环境中显式开启。
- 「给 AI 的说明」里包含完整 token，只应粘贴给本机可信的 AI 客户端，不要发到群聊、截图或公开仓库。
- 通过本接口产生的任何操作都会以当前登录账号的身份提交，由此带来的风控或账号风险由使用者自行承担。
