# 变更记录

## 1.4.1 — 2026-11-11

### 新增

- **服务地址带预设**：选中某家 API 时，地址输入框可以直接从下拉里挑它的官方地址（Tavily、Serper、Brave、Exa、Bing）；SearXNG 给的是本地/Docker 默认值（公共实例几乎都关掉了 JSON API，列出来只会误人）。仍然可以手填，比如换成中转地址。

### 修复

- **聚合模式没有真的调用 API**：`searchAll` 拿到的是 provider 对象，而引擎选择函数按字符串 id 比较，条件永远为假——1.4.0 的聚合模式其实只查了免密钥那四家。现在用 `includeKeyed` 标志区分，实测假 key 会真的发出请求（返回 401）。
- **聚合模式会把共享的 `endpoint` 套到所有 API 上**：这个字段本意是"给当前这一家换个地址"，在 fan-out 里会让 Tavily 的请求打到 Brave 的 URL。现在 fan-out 中 API 提供方一律用各自的官方地址，该字段只作用于 SearXNG 和免密钥引擎，设置页的提示也按模式切换。
- **设置页选不到「聚合模式」**：客户端的 provider 列表是硬编码副本，1.4.0 只改了 Host 侧，下拉里既没有 aggregate、选中后的回落也错成了「全部引擎」。

### 其他

- 测试 92 → 93 项，新增「fan-out 不把共享 endpoint 串给 API」——它同时抓住了上面第一个 bug。

## 1.4.0 — 2026-11-10

### 新增

- **聚合模式（`aggregate`）**，并设为默认。它同时查询四家免密钥引擎、SearXNG（配了地址时）和**所有填了 Key 的 API 提供方**，用同一套轮转合并去重。没填 Key 的 API 会被跳过而不是硬调——硬调只会拿到 401，让结果看起来像坏了。
- 原来的 `all` 保留，改名为「免密钥聚合」：只查免密钥那几家，永远不碰 API。零配置时两者行为完全一样。

### 不兼容变更

- 设置里的 `apiKey`（单个字符串）改成 `apiKeys`（按提供方分开的对象）。聚合模式要同时调多家 API，一个共享字段做不到。旧的 `apiKey` 在读取时自动迁移到当时选中提供方的槽位，不会丢。
- `/api/settings` 的 `hasApiKey` / `apiKeyPreview` 换成 `apiKeys: { <id>: { has, preview } }`。
- 设置页在聚合模式下列出每一家 API 的输入框；选中单个引擎时只显示那一家。

### 其他

- 测试 90 → 92 项：新增「aggregate 只挑能答的引擎」「旧 apiKey 迁移到对应槽位」，以及「清一家的 Key 不影响其他家」——后者是聚合模式的关键，一个手滑就会让别的引擎静默消失。

## 1.3.2 — 2026-11-09

### 修正

- npm 的 `description` 有 255 字符硬上限，1.3.1 写的 305 字符被截成 `…no native build; two n`，页面上是残句。改成中英混排的 184 字符版本，同时补上中文关键词。
- 顺便说明：npm 包页面的**正文**显示的是 `README.md`（中文），只有顶部那一行短描述受这个限制；插件市场里的描述本来就是 `{ zh, en }` 双语。

## 1.3.1 — 2026-11-09

### 打包

- 仓库改名为 `dsh-web-search-lite`，`package.json` 的 `repository`、`homepage`、`bugs` 与两份 README、市场索引里的链接一并更新。npm 上 1.3.0 的这几个字段仍是旧仓库名（靠 GitHub 的 301 跳转），这个版本把它们修正。
- 描述改为强调定位：零依赖、无 Playwright、无 SQLite、无原生编译。npm 上 `dsh-web-search-pro` 是另一套实现（anweat 的，依赖 Playwright + SQLite），描述里点名差异可以减少装错。

### 其他

- 市场索引的地址从 `cdn.jsdelivr.net` 换成 `fastly.jsdelivr.net`：主域名在部分网络下 TLS 握手失败，三个镜像（fastly / gcore / testingcf）都可用。

## 1.3.0 — 2026-11-09

### 移除

- 删掉**接管内置 `web_search`** 的整套能力：注册到 `ctx.web` 的 `web-search-pro` 搜索提供方、通过 `ctx.settings.mutate` 改写 `web.searchProvider`、设置页里的「使用 DeepSeek 官方网页搜索」开关、`officialSearch` 字段，以及 `/api/settings` 响应里的 `dshSearchProvider`。
- 理由：官方客户端已经有「插件 → 网页搜索」页管理搜索提供方，插件不必再插一手。这个插件回归「提供两个新工具 + 一个自己的设置页」，不碰内置 `web_search`。

### 兼容

- 旧的 `settings.json` 里若仍有 `officialSearch`，读取时被忽略，不会报错；下次保存会自然丢掉这个键。
- 组合行 id 仍是 `web-search-pro`，`~/.dsh/web-search-pro/settings.json` 与 `/api/web-search-pro/*` 不变。

### 其他

- 测试 94 → 90 项（删掉 4 条覆盖提供方注册、`settings.mutate`、`foreign` 不抢、开关往返的用例）。
- README 删除「官方 Web 搜索开关」整章、配置表对应行与两条相关排错。

## 1.2.0 — 2026-11-09

### 改名

- 包名从 `dsh-web-search-pro` 改为 **`dsh-web-search-lite`**。npm 上已有一个同名但无关的 `dsh-web-search-pro`（作者 anweat，Playwright + SQLite 实现），它的 `peerDependencies` 排除了 DSH 0.2.2，安装时会被 DSH 拒绝并提示「不兼容」——那不是本插件。改名是为了消除这个歧义。
- 同步更新 `cordis.patch.yml` 的 `name`、浏览器模块 id、`USER_AGENT`、安装与诊断脚本，以及两份 README。
- 组合行 id 仍是 `web-search-pro`，因此 `~/.dsh/web-search-pro/settings.json` 与 `/api/web-search-pro/*` 不变，已有配置继续有效。

### 修正

- 版本号改为从 `package.json` 读取，不再在 `USER_AGENT` 和 `HOST_VERSION` 各写一份。三处副本已经漂过一次，表现为 `host-status.json` 里报告旧版本。
- README 更正「装完必须重启」的说法：首次安装需要重启（组合列表在启动时读），之后更新已装插件的文件由 DSH 的文件监听重载宿主半身，浏览器半身刷新页面即可。
- 测试新增一条断言：`HOST_VERSION` 必须等于清单版本，防止再次漂移。

## 1.1.0 — 2026-11-08

### 新增

- 设置页新增**使用 DeepSeek 官方网页搜索**开关（`officialSearch`，**默认 `true`**，即保持 DSH 原有行为）。关掉后，DSH 内置的 `web_search` 由本插件的免密钥引擎作答，不再走按模型轮次计费的 DeepSeek Messages 搜索；工具名、提示词和调用方式都不变。
- 插件向 `web` 服务注册自己的搜索提供方 `web-search-pro`（`ctx.web.registerSearchProvider`），并在开关变化时通过 `ctx.settings.mutate` 切换 `web.searchProvider`——与内置卡片同一套校验、修订号与持久化路径。
- 仓库根目录即插件包：`package.json`、`index.js`、`client.js`、`cordis.patch.yml` 与 `_dev/` 并列，clone 下来就能装。

### 修正

- 不再需要用 `- id: web-search-deepseek` + `disabled: true` 关官方搜索。那样做会让内置的**插件 → 网页搜索**卡片整页消失（页面绑在该提供方的命名空间上）。现在 provider 一直挂着，只切选择。
- 不覆盖用户明确选过的其他提供方：选中值既不是 `deepseek-official` 也不是 `web-search-pro` 时，开关报告 `foreign` 并保持不动。
- 先挂后指、先指后卸，选择永远不指向未注册的提供方。

### 打包与文档

- 新增 MIT `LICENSE`；`package.json` 补 `license`、`author`、`repository`、`homepage`、`bugs`，`files` 补 `LICENSE` 与 `README.md`，版本升到 `1.1.0`。
- README 增加「官方 Web 搜索开关」章节、两条排错、架构说明与配置字段；`locale/{zh,en}.json` 的描述更新。
- 测试从 90 项增加到 94 项（Host 68 + Client 26），覆盖提供方注册、`settings.mutate` 的目标值与修订号、`foreign` 不抢，以及开关往返。

## 1.0.0

首个版本：`web_search_api` / `web_fetch_api` 两个工具、四家免密钥引擎的聚合轮转、五家 API 提供方、设置页与「测试连接」。
