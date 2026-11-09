# 变更记录

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
