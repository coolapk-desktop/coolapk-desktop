# 移动页面下拉刷新评估与实现

评估日期：2026-10-19。范围为当前仓库全部路由页面与实际承载内容的公共组件；不会通过重新加载应用或重建路由实现刷新。

已检查 64 个顶层页面文件和 14 个设置页面文件；51 个页面直接接入，3 个公共内容组件接入，7 个外层页面委托子页面处理，6 个顶层静态/工具/编辑页面不接管。

## 官方 APK 依据

本地反编译目录：`D:/code/github/coolapk_all_decompiled/java_sources/`。

- `sources/com/coolapk/market/widget/ScrollChildSwipeRefreshLayout.java`：`setScrollUpChild` 指定真实列表；`canChildScrollUp` 优先判断该列表能否向上滚动，构造时关闭缩放式进场。
- `sources/com/coolapk/market/view/base/refresh/RefreshRecyclerFragment.java`：主题强调色指示器、内容背景色圆盘、`OnRefreshListener` 回调；刷新状态由列表请求结束回收。
- `sources/com/coolapk/market/view/base/asynclist/NewAsyncListFragment.java`：刷新走现有列表加载链路。
- `sources/androidx/swiperefreshlayout/widget/SwipeRefreshLayout.java`：圆盘 40dp、默认目标/触发距离 64dp、`DRAG_RATE = 0.5`；超程使用张力曲线；达到阈值松手触发；未达到阈值回弹；刷新中不重复触发。

Web 实现使用 CSS 像素对应布局单位，复用官方阻尼/张力公式。浏览器侧方向判定使用 8px 起手距离；安卓原生 `scaledTouchSlop` 随设备配置变化，因此不宣称所有设备上手势采样和原生组件逐像素相同。

## 共用行为

- 内容必须在顶部、单指向下拖动；列表尚未到顶、横向滑动、双指、编辑控件、视频、隐藏栏目、系统边缘返回手势不接管。
- 刷新指示器悬浮在当前内容区域上方，不整体移动正文、底栏或固定导航；避开状态栏安全区及当前吸顶顶栏。
- 同一分支由最内层刷新宿主接管，避免数码子页、好物子页和个人内容子页重复刷新。
- 保留当前路由、页签、搜索、分类和排序，通过现有请求刷新第一页及对应游标；到达末页后也能刷新。
- 刷新等待返回 Promise 完成后回收，不使用固定延时伪造网络完成；失败时仍回收指示器并沿用页面原有错误提示。
- 普通桌面布局不启用手势。触摸移动设备以及未禁用自动移动布局的窄窗口支持触摸手势。
- 不给编辑表单、授权流程、静态设置和本地下载任务强加下拉刷新；聊天内容不改成刷新最新消息，以保留当前历史阅读位置。

## 逐页清单

| 页面 | 评估结果 | 刷新范围或处理理由 |
| --- | --- | --- |
| `src/pages/AlbumPage.vue` | 已接入 | 专辑资料及讨论首页 |
| `src/pages/AlbumsPage.vue` | 已接入 | 当前专辑分类或搜索第一页 |
| `src/pages/AnyListCreatePage.vue` | 不接管 | 创建表单，避免下拉覆盖已填写内容 |
| `src/pages/AnyListDetailPage.vue` | 已接入 | 清单详情 |
| `src/pages/AnyListPage.vue` | 已接入 | 当前清单分类第一页 |
| `src/pages/AppDetailPage.vue` | 已接入 | 应用资料及当前详情子栏目 |
| `src/pages/AppsPage.vue` | 已接入 | 当前应用分类或搜索 |
| `src/pages/AuthCallbackView.vue` | 不接管 | 授权回调，不是内容列表 |
| `src/pages/BlackListPage.vue` | 已接入 | 当前黑名单分类第一页 |
| `src/pages/CenterPage.vue` | 不接管 | 静态功能入口 |
| `src/pages/DigitalPage.vue` | 已接入 | 当前数码栏目、所选分类及排序第一页 |
| `src/pages/DiscoverPage.vue` | 已接入 | 当前发现栏目（含 flexList） |
| `src/pages/DownloadsPage.vue` | 不接管 | 本地下载任务状态由下载管理器同步，不重新创建或重启下载 |
| `src/pages/DyhPage.vue` | 已接入 | 看看号资料及当前内容分类 |
| `src/pages/EventDetailPage.vue` | 已接入 | 活动资料及当前选中页签 |
| `src/pages/EventsPage.vue` | 已接入 | 活动列表第一页 |
| `src/pages/ExternalPage.vue` | 已接入 | 当前网页只读内容；举报表单不接管 |
| `src/pages/FavoritesPage.vue` | 已接入 | 当前收藏单资料和内容，或收藏单目录 |
| `src/pages/FeedDetailPage.vue` | 已接入 | 动态正文及已展开评论，回答详情同样更新评论 |
| `src/pages/FollowingPage.vue` | 已接入 | 关注动态当前筛选 |
| `src/pages/GamesPage.vue` | 已接入 | 当前游戏类别或搜索 |
| `src/pages/GoodsListDetailPage.vue` | 子页面接入 | 由 GoodsListDetailBody 接管 |
| `src/pages/GoodsListsPage.vue` | 子页面接入 | 由 GoodsRankingList 接管 |
| `src/pages/GoodsPage.vue` | 子页面接入 | 由当前好物内容子页面接管 |
| `src/pages/GoodsRankingDetailPage.vue` | 子页面接入 | 由 GoodsListDetailBody 接管 |
| `src/pages/GoodsRankingPage.vue` | 子页面接入 | 由 GoodsRankingList 接管 |
| `src/pages/GoodsSearchPage.vue` | 已接入 | 当前好物搜索或热词 |
| `src/pages/HeadlinePage.vue` | 已接入 | 当前头条栏目 |
| `src/pages/HistoryPage.vue` | 已接入 | 当前历史分类第一页 |
| `src/pages/HomePage.vue` | 子页面接入 | 由 HomeTabPanel 接管当前活动栏目 |
| `src/pages/HomeTabPanel.vue` | 已接入 | 首页当前活动栏目，沿用刷新锚点 |
| `src/pages/LiveDetailPage.vue` | 已接入 | 直播详情信息 |
| `src/pages/MessagesPage.vue` | 已接入 | 仅私信会话目录；聊天窗口保留历史记录操作 |
| `src/pages/MoreDataPage.vue` | 已接入 | 当前个人内容模式第一页 |
| `src/pages/MorePage.vue` | 不接管 | 静态服务入口 |
| `src/pages/MoreWorkspacePage.vue` | 子页面接入 | 由当前个人内容子页面接管 |
| `src/pages/MyAlbumsPage.vue` | 已接入 | 我的专辑 |
| `src/pages/MyCommentsPage.vue` | 已接入 | 当前评论/回复分类第一页 |
| `src/pages/MyDyhPage.vue` | 已接入 | 当前看看号分类第一页 |
| `src/pages/MyFeedsPage.vue` | 已接入 | 我的动态当前分类第一页 |
| `src/pages/MyGoodsPage.vue` | 已接入 | 我的好物第一页 |
| `src/pages/MyLikesPage.vue` | 已接入 | 当前赞过的内容第一页 |
| `src/pages/MyProductsPage.vue` | 已接入 | 我的产品当前类型第一页 |
| `src/pages/MyProfilePage.vue` | 已接入 | 个人资料统计及服务端内容卡片 |
| `src/pages/MyRecentPage.vue` | 已接入 | 最近内容第一页 |
| `src/pages/NodePage.vue` | 已接入 | 当前节点资料及内容第一页 |
| `src/pages/NotificationsPage.vue` | 已接入 | 当前通知类型第一页 |
| `src/pages/PageDataListPage.vue` | 已接入 | 当前服务端页面、页签及排序，跟随 flexList |
| `src/pages/PicturesPage.vue` | 已接入 | 当前图片列表第一页 |
| `src/pages/ProductCategoryPage.vue` | 已接入 | 当前品牌或分类第一页 |
| `src/pages/ProductComparePage.vue` | 不接管 | 本地选品对比工具；不重置用户选择 |
| `src/pages/ProductPage.vue` | 已接入 | 产品资料及当前讨论/媒体/点评等栏目 |
| `src/pages/ProductSelectorPage.vue` | 已接入 | 当前产品筛选第一页 |
| `src/pages/QuestionDetailPage.vue` | 已接入 | 问题资料及当前排序的回答第一页 |
| `src/pages/ReviewPage.vue` | 已接入 | 当前点评列表第一页 |
| `src/pages/SearchPage.vue` | 已接入 | 刷新当前页面内容 |
| `src/pages/SecondHandBrandsPage.vue` | 已接入 | 当前闲置品牌产品第一页 |
| `src/pages/SecondHandListPage.vue` | 已接入 | 当前闲置筛选第一页 |
| `src/pages/SecondHandPage.vue` | 已接入 | 当前闲置栏目第一页 |
| `src/pages/TopicPage.vue` | 已接入 | 话题资料及当前讨论或点评 |
| `src/pages/TopicsHubPage.vue` | 已接入 | 当前话题分类 |
| `src/pages/UserPage.vue` | 已接入 | 用户资料及当前空间页签 |
| `src/pages/UserPluginsPage.vue` | 已接入 | 仅挂件商店；挂件编辑保留未保存选择 |
| `src/pages/UserRelationsPage.vue` | 已接入 | 当前关注/好友/粉丝分类第一页 |

## 公共组件与设置页

- `ProductCategoryBrowser.vue`：通用分类目录的当前内容页；保留选中的目录，重置分页游标。
- `GoodsRankingList.vue`：清单/榜单的当前分类及第一页。
- `GoodsListDetailBody.vue`：清单/榜单详情及评论。
- `MyProfileCards.vue`、`TopicRatingPanel.vue`：向外层页面暴露可等待的刷新入口，避免另加一套手势。
- 设置目录下全部 14 个页面逐个确认不作为内容列表处理，保留开关、编辑与诊断操作：
  - `src/pages/settings/AboutSettingsPage.vue`
  - `src/pages/settings/AccountSettingsPage.vue`
  - `src/pages/settings/AppearanceSettingsPage.vue`
  - `src/pages/settings/ContentSettingsPage.vue`
  - `src/pages/settings/DeviceSettingsPage.vue`
  - `src/pages/settings/DiagnosticsSettingsPage.vue`
  - `src/pages/settings/DownloadSettingsPage.vue`
  - `src/pages/settings/NetworkSettingsPage.vue`
  - `src/pages/settings/NotificationSettingsPage.vue`
  - `src/pages/settings/PrivacySettingsPage.vue`
  - `src/pages/settings/ProfileSettingsPage.vue`
  - `src/pages/settings/SettingsLayout.vue`
  - `src/pages/settings/ShortcutSettingsPage.vue`
  - `src/pages/settings/StartupSettingsPage.vue`

## 验证边界

自动化覆盖：顶部阈值、阻尼位移上限、横向与多指冲突、取消、嵌套、刷新互斥、失败回收、页面销毁，以及首页/数码/个人中心的真实触摸入口与分页重置。类型检查、相关页面测试、全量前端回归和生产构建分别记录执行结果；它们不能代替安卓/iOS 真机触摸和视觉验证。

本次执行结果：`npm run typecheck`、`npm test`（211 个测试文件、1418 项测试）、`npm run build`、`git diff --check` 均通过。生产构建仍提示现有的 Vite 配置导入扩展名及大分包警告。触摸自动化在 DOM 测试环境中派发事件，不等同于手机实测。

真机待核对：安卓不同状态栏高度及横竖屏、iOS 刘海与侧滑返回、首页横向翻页、内嵌分类与弹窗打开时的手势、慢网/断网下圆盘停留和回收。桌面特有页面没有对应的官方移动页面，不宣称逐页布局完全一致。
