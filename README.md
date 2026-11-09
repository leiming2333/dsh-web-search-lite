# dsh-web-search-lite

[![CI](https://github.com/leiming2333/dsh-web-search-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/leiming2333/dsh-web-search-lite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

给 DeepSeek Harness 装一套联网搜索：模型可以调用搜索引擎查当前信息，也可以打开搜索结果里的网页读正文。

装好就能用，不需要任何 API Key。默认同时查询 DuckDuckGo、Bing 网页、百度、360 搜索四家，再合并去重：单看一家的排序只是一种意见，而四家分歧最大的，恰好就是值得搜的那些查询。愿意配一家搜索 API 的话，可以单独选它，结果更稳更快。

它还能**接管内置的 `web_search`**：DSH 自带的 `web_search` 走 DeepSeek Messages 搜索，一次搜索是一次完整的模型请求，按生成计费。设置页里有一个开关，关掉官方路由后，同一个工具改由上面这些免密钥引擎提供结果——工具名、提示词、调用方式都不变，只是账单不再增长。**默认保持 DSH 原样（不接管）**，要不要省钱由你决定，详见[官方 Web 搜索开关](#官方-web-搜索开关)。

换引擎、填密钥、调条数、开关都在 **设置 → 网络搜索** 里，保存后下一条消息生效，不用重启。设置页还有一个**测试连接**按钮，用已保存的配置跑一次真实查询。

---

## 它给模型什么

| 工具 | 作用 |
|---|---|
| `web_search_api` | 一次搜索，返回排序后的来源列表（标题、URL、摘要、发布时间）。默认走全部引擎聚合；支持临时指定 `provider`、`language`、`maxResults`，不写入设置。 |
| `web_fetch_api` | 把一个 URL 读成纯文本（去掉标签、脚本和样式），用于打开搜索命中的网页。设置页有开关可以关掉它。 |

两个工具出错时都会说清下一步：抓取型被反爬会建议换引擎或配 API Key，解析不到结果会说明可能是引擎改了页面结构，401/403 提示密钥无效，429 提示限流或额度用尽，超时提示调大超时，而不是只抛一个状态码。

## 支持的引擎

### 免密钥（开箱即用）

| `provider` | 引擎 | 怎么拿结果 |
|---|---|---|
| `all` | **全部引擎**（默认） | 四个一起查，轮转合并 + 按 URL 去重 |
| `duckduckgo` | DuckDuckGo | 读 `html.duckduckgo.com` 结果页，`uddg` 参数还原真实链接 |
| `bingweb` | Bing 网页 | 读 `bing.com/search` 结果页，`ck/a` 跳转里的 base64 还原真实链接 |
| `baidu` | 百度 | 读 `baidu.com/s` 结果页，容器的 `mu` 属性取真实链接，过滤推广位 |
| `so360` | 360 搜索 | 读 `so.com/s` 结果页，`data-mdurl` 取真实链接，过滤广告位 |
| `searxng` | SearXNG（自建） | 调用实例的 `format=json` 接口，**必须填服务地址**；配了地址后也会加入 `all` |

`provider` 默认 `all`。

### `all` 是怎么合并的

```
query
  ├─ DuckDuckGo ─┐
  ├─ Bing 网页  ─┤  并发，各自取 max(count,6) 条
  ├─ 百度       ─┤
  └─ 360        ─┘
        ↓
   轮转交错（每个引擎轮流贡献一条）
        ↓
   URL 去重（忽略 utm_* / spm / fbclid 等跟踪参数、末尾斜杠、#fragment）
        ↓
   截断到 maxResults
```

几个刻意的选择：

- **轮转，不拼接**。直接首尾相接的话，谁先返回、谁返回得多，谁就霸占列表前面。轮转让每家的最佳结果都进前几位。
- **去重保留先访问到的那一份**。四个引擎返回的热门页面大量重合，不去重的话列表会被同一批链接占满。
- **用 `allSettled`，不用 `all`**。一家被限流或改版是常态，不能让它拖垮整次搜索。成功的照常合并，失败的按引擎报告原因。
- **部分失败会写进结果**。工具输出里有 `来源：DuckDuckGo 8 · Bing 网页 8 · 百度 8` 和 `未返回：360 搜索（…）`，模型知道哪家没答，而不是以为结果本来就少。

一次实测（查「DeepSeek Harness 怎么安装」，`maxResults: 8`）：

```
耗时 2685 ms · 合并后 8 条
引擎分布: DuckDuckGo 8 · Bing 网页 8 · 百度 8 · 360 搜索(失败)
```

耗时接近最慢的那家，因为四家是并发查的。返回的 8 条覆盖了 runoob、CSDN、知乎、deepseek.com 等不同来源，单用一家通常拿不到这么分散。

### 需要 API Key

| `provider` | 服务 | 密钥申请 | 备注 |
|---|---|---|---|
| `tavily` | Tavily | https://app.tavily.com/home | 返回网页正文，可带生成式摘要 |
| `serper` | Serper（Google 结果） | https://serper.dev/api-key | 结果最接近 Google，可带 answerBox |
| `brave` | Brave Search | https://api.search.brave.com/app/keys | 独立索引 |
| `exa` | Exa | https://dashboard.exa.ai/api-keys | 语义搜索，直接返回正文片段 |
| `bing` | Bing Web Search API | https://portal.azure.com/ | 在 Azure 里创建 Bing Search 资源 |

加一家新的：在 `index.js` 的 `PROVIDERS` 加一条描述，在 `SEARCHERS` 加一个把该家响应映射成 `{ answer?, sources[] }` 的函数。去重、截断、错误文案、渲染都是共享的。

## 关于「抓取型」引擎

免密钥引擎没有官方接口，插件读的是它们**公开的结果页**，和用浏览器打开那个页面看到的一样。这意味着：

- **不用注册、不用付费、不会被额度卡住**，开箱即用。
- **页面结构属于引擎**。它们改版、加反爬，或者对自动化请求返回验证页时，解析就会失败。失败时工具会明确报告「没有解析出结果」或「被拒绝访问」，并建议换引擎，而不是假装「没有搜索结果」。
- 抓取时带上桌面浏览器的 User-Agent 和 `Accept-Language`，因为用插件自己的标识去请求会被直接挡掉；API 请求仍然如实标注身份。
- 向引擎要的结果数比实际需要的多（`count × 3`，至少 12 条），因为结果页里混着答案卡片、图片卡、推广位，能放进来源的通常不到一半。

实测这几个引擎在你当前网络下都可用（DuckDuckGo 约 2s，其余 0.4–1.5s）。**试过但没能用的**：Mojeek（直接返回验证码页）、搜狗（返回反爬验证页）、Ecosia（403 防火墙）、Brave 网页版（429）。这些没放进插件，免得选了就用不了。

有一个例外要说清楚：**360 搜索对密集请求很敏感**。正常使用（几分钟一次）没问题，但短时间内连续搜十几次会开始返回「访问异常页面」。这是 HTTP 200 的拦截页，不是搜索结果。插件会认出它并报「返回了验证/拦截页面，通常是请求过多」，而不是含糊地说「解析失败」。聚合模式下它挂了不影响其他三个，结果里会写 `未返回：360 搜索（…）`。

需要稳定、可预期的结果时（比如每天固定跑几十次查询），还是建议配一家 API。

## 安装

### 先确认装的是哪一个

npm 上有一个**同类的** `dsh-web-search-pro`（作者 anweat），功能是另一套实现：多引擎路由 + SQLite 缓存 + Playwright 渲染，并依赖 `@anweat/dsh-browser`。本包叫 `dsh-web-search-lite`，两者没有关系。

所以如果你在 DSH 里看到这样的提示：

```
dsh-web-search-pro@0.2.3 与 DSH 0.2.2-rc.1 不兼容（要求 @deepseek-ai/dsh-tools>=0.2.0-rc.2 <0.2.1-0 || …
```

那是 `dsh-web-search-pro` 的 0.2.3 版本，不是本插件。它的 `peerDependencies` 把上界写成了 `<0.2.2-0`，而 DSH 现在跑的是 `0.2.2-rc.1`，落在范围外，所以被拒绝。本包的声明是 `^0.2.0-rc.1`，在 DSH 的判定方式（`includePrerelease: true`）下覆盖 `0.2.2-rc.1`：

```
✓ @deepseek-ai/cordis        实际 4.1.0        声明 ^4.0.2
✓ @deepseek-ai/dsh-tools     实际 0.2.2-rc.1   声明 ^0.2.0-rc.1
✓ @deepseek-ai/schemastery   实际 3.19.0       声明 ^3.18.4
```

要装本插件，用下面这些方式之一，不要输入 `dsh-web-search-pro` 这个名字。

### 装法

仓库根目录就是插件包本身（`package.json` 里有 `dsh.bundle.patch` 与 `dsh.client`）；`_dev/` 只有开发与测试脚本，不会被装进 profile。

```bash
git clone https://github.com/leiming2333/dsh-web-search-lite.git
cd dsh-web-search-lite
node _dev/install.mjs --dry-run      # 先看要改什么
node _dev/install.mjs                # 备份后写入 desktop profile
node _dev/install.mjs --profile web  # 换一个 profile
node _dev/install.mjs --uninstall    # 回滚
```

脚本只做三件可回滚的事：把包复制到 `<profile>/plugins/` 与 `<profile>/node_modules/`，在 profile 的 `package.json` 里补 `dependencies`（`file:` 本地引用）与 `dsh.profile.bundles`，改写前备份为 `package.json.bak-<时间戳>`。它不碰 `cordis.patch.yml`，那是你自己的层。

也可以在对话里让 DSH 自己装：「把 /path/to/dsh-web-search-lite 这个 bundle 装上」，它会用 `plugin_manager` 的 `install_bundle`。

### 装完什么时候要重启

首次安装必须重启 DeepSeek Harness：profile 的组合列表变了，那是在启动时读的。之后只改插件文件时，DSH 的文件监听会重载宿主半身（`host-status.json` 里的 `applyStartedAt` 会跟着更新），浏览器半身仍需刷新页面。

> **默认不改你现有的搜索选择。** 第一次启动只注册两个新工具（`web_search_api`、`web_fetch_api`）和一个设置页，内置 `web_search` 仍走你原来的提供方。想让它免费，去 **设置 → 网络搜索** 把「使用 DeepSeek 官方网页搜索」关掉——见下一节。

> 两者的加载时机不同，容易误导人：刷新页面就能让 **设置 → 网络搜索** 出现，但那条 `/api/web-search-pro/settings` 请求需要宿主进程里跑着插件。如果设置页出现了却报 `HTTP 404`，先看 `~/.dsh/web-search-pro/host-status.json`：没有这个文件说明宿主没加载过，需要完全退出应用再启动（不是刷新页面）。

## 官方 Web 搜索开关

DSH 原生有两个 web 工具：`web_search` 和 `web_fetch`。它们本身不含引擎，真正的检索由 `@deepseek-ai/dsh-web` 选中的**搜索提供方**完成，而内置组合把选择固定成了：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official   # DeepSeek Messages 搜索
    fetchProvider: http                 # 本地 HTTP 抓取，免费
```

`deepseek-official`（`@deepseek-ai/dsh-web-search-deepseek`）的做法是把搜索当成一次辅助模型请求：DeepSeek 在**完整的一轮 Messages 调用**里执行服务端检索，所以每次 `web_search` 都是延迟加生成 token。它不会报错，也不会提示你贵，只是账单会变。

插件在 `web` 服务里注册了自己的提供方 `web-search-pro`，设置页的**使用 DeepSeek 官方网页搜索**开关就是切这个选择：

| 开关 | `web.searchProvider` | `web_search` 谁在答 | 费用 |
|---|---|---|---|
| **开（默认）** | `deepseek-official` | DeepSeek Messages 搜索 | 按模型轮次计费 |
| 关 | `web-search-pro` | 本插件的免密钥引擎（与 `web_search_api` 同一套） | 免费 |

几个刻意的选择：

- **默认开，是刻意的。** 装一个搜索插件就改掉别人 DSH 的搜索后端，不合适；默认保持 DSH 原样，谁想省钱谁自己关。关掉之后写进的是你的 profile，重启也还在。
- **不卸载官方 provider，只切选择。** 早期实现用 `- id: web-search-deepseek` + `disabled: true` 关掉它，结果内置的 **插件 → 网页搜索** 卡片整页消失——那个页面绑在提供方的命名空间上。现在 provider 一直挂着，卡片一直在。
- **写入走 `ctx.settings`，不直接改文件。** 那就是内置卡片自己的写入路径：同样校验 volatile 字段、同样带修订号拒绝陈旧写入、同样落到 profile 的 `cordis.patch.yml`。所以拖到卡片里手动改也认，两边看到的是同一个值。
- **不抢别人的选择。** 如果 DSH 选中的既不是 `deepseek-official` 也不是 `web-search-pro`（比如你在卡片里切到了新版 Search API），开关只报告 `foreign` 并保持不动——静默改写用户明确选过的提供方，比什么都不做更糟。
- **先挂后指、先指后卸。** 关官方时先注册自己的 provider 再把选择指过去，开官方时先把选择指回官方再注销自己：选择永远不指向一个不存在的提供方。

没有 `web` 或 `settings` 服务的组合里开关自动失效（`host-status.json` 会写明是哪一种），工具照常可用。

## 配置

设置页里的每一项都存在 `<DSH_HOME>/web-search-pro/settings.json`（默认 `~/.dsh/web-search-pro/settings.json`），改完即时生效，不用重启。

目录名和路由前缀用的是组合行 id `web-search-pro`，不随包名变化；改包名不会动这个文件。

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `all` | 用哪个引擎；默认全部聚合。 |
| `apiKey` | 空 | 密钥。免密钥引擎与自建 SearXNG 留空即可。 |
| `endpoint` | 空 | 自定义地址；留空用官方地址。SearXNG 必填。 |
| `maxResults` | `8` | 每次结果条数（1–50，另受各家上限约束）。 |
| `timeoutMs` | `20000` | 单次请求超时（1000–120000）。 |
| `language` | 空 | 语言提示，如 `zh-CN`。 |
| `includeAnswer` | `true` | 是否请求生成式摘要。传给 Tavily；Serper 的 answerBox 本来就随结果返回。 |
| `enableFetch` | `true` | 是否注册 `web_fetch_api`。 |
| `officialSearch` | `true` | 是否让内置 `web_search` 走 DeepSeek 官方搜索（计费）。`false` 表示由本插件的提供方作答。 |
| `fetchMaxChars` | `20000` | 单页保留字符数（1000–200000）。 |

所有值在写入前都会做类型与范围归一化，手改 JSON 也不会把插件带进非法状态。

## 验证

设置页底部有「测试连接」：用已保存的配置真跑一次搜索，显示提供方、结果条数、耗时和前三条来源；失败就把提供方返回的原因原样显示出来。

也可以回到对话说一句「搜索一下今天的科技新闻」。

## 架构（以及为什么这么写）

```
┌─ Host: index.js（零外部依赖，只用 node:fs/os/path）──────┐
│  settings.json  ← 原子写入                               │
│    ↓                                                     │
│  web_search_api ─→ runSearch ─→ SEARCHERS[id]            │
│  web_fetch_api  ─→ runFetch  ─→ htmlToText               │
│                                                          │
│  ctx.inject(['webServer'], …)                            │
│    └─ /api/web-search-pro/{settings,test}                │
└──────────────────────┬───────────────────────────────────┘
                       │ 同源 JSON
┌──────────────────────┴───────────────────────────────────┐
│  Client: client.js（只 require('react')）                │
│  ctx.slots.register('settings.section', …)               │
│    设置 → 网络搜索（读 /settings，写 /settings，/test）    │
└──────────────────────────────────────────────────────────┘
```

**接管官方工具走的是两个服务，不是两个 import。**

`ctx.web.registerSearchProvider({ id, available, ready, search })`（可选注入，disposer 随 fiber 释放）注册免密钥提供方；`ctx.settings.mutate('web', [{ op: 'set', path: ['searchProvider'], value }], revision)`（可选注入）切换选择。两者都是通过 `ctx` 拿到的服务，符合下面那条零依赖规则；缺任何一个，插件照常提供 `web_search_api`，只是开关失效并在 `host-status.json` 里说明。

**关键决定：这个插件不 import 任何 `@deepseek-ai/*` 包。**

原因是加载机制。DSH 加载 profile 里的 bundle 时用「双锚点」解析名字（先 dsh 安装目录，再 profile 目录），但 bundle 内部的 `import` 由 Node 自己从 bundle 所在位置向上找 `node_modules`。从 `~/.dsh/profiles/<p>/node_modules/…` 出发，DSH 安装目录里的包不在解析链上：

```bash
cd ~/.dsh/profiles/desktop
node --input-type=module -e "console.log(import.meta.resolve('@deepseek-ai/dsh-tools'))"
# ERR_MODULE_NOT_FOUND
```

所以 `import { defineTool } from '@deepseek-ai/dsh-tools'` 会在加载期抛错，插件加载不起来。本机那个第三方插件 `dsh-our-free-model` 也是同样的零依赖写法。

由此带来的两个替代：

- `defineTool` 是对普通对象字面量的校验/包装。`localDefineTool` 复刻了这份契约：参数 DSL → 对象根 JSON Schema、必填与类型在执行前校验、`output.render` 负责呈现。注册表本身只把它当普通对象读。
- 配置不走 `settings`/`configForms` 那套 schema 投影（那需要 schemastery 的 `dict`/`meta` 结构），改由插件自己的 JSON 文件 + `/api/*` 路由承担。代价是密钥存在自己的状态文件里（见下），收益是设置页能真正做到「测试连接」这种需要在 Host 侧发网络请求的操作。

其他约束：

- 不 `require('@deepseek-ai/dsh-client-ui-primitives')`（同样解析不到，且规范也禁止）。控件全部自己画，只用 `--dsw-alias-*` 主题变量并带 fallback，亮/暗主题都跟着宿主走。
- `web_fetch_api` 用 `when` 按模型步骤动态准入，而不是在 `apply` 时决定；否则关掉开关要重启才生效。
- 设置接口做同源校验（`Origin` 与 `Host` 比对），防止第三方页面改写「密钥发往哪个地址」。

## 安全说明

- **密钥明文保存在 `~/.dsh/web-search-pro/settings.json`**，权限跟随用户目录。没有走 DSH 的 credentials 保管库：那个域只回答「是否存在」，而设置页需要回显掩码预览；更重要的是 credentials 服务不在零依赖可达范围内。密钥**不会**通过 `/api/settings` 回传给浏览器，页面只拿到 `hasApiKey` 和 `abcd…wxyz` 形式的掩码。
- 清除密钥只能显式点「清除密钥」；输入框留空表示保持原值，避免误清。
- `web_fetch_api` 只允许 `http`/`https`，跟随重定向，非 2xx 作为结果返回（附状态码），不执行页面脚本。
- 所有请求都由本地 Host 发起，浏览器不直连搜索 API，所以没有 CORS 问题，密钥也不出现在页面里。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 内置「插件 → 网页搜索」卡片不见了 | 有人给 `web-search-deepseek` 这一行写了 `disabled: true`。别那样关官方搜索：那个页面绑在这个提供方的命名空间上，行一卸载整页就没了。改用本插件的开关（`officialSearch`），它只切 `web.searchProvider`，provider 一直挂着。 |
| 拨了开关，但「DSH 当前选中」没变 | 两种可能：选中值不是官方也不是本插件（`foreign`，按设计不抢）；或宿主没有 `web`/`settings` 服务，`host-status.json` 里的 `officialSearch`、`webSearchProvider` 字段会写明是哪一种。 |
| 设置页里没有「网络搜索」这一栏 | 浏览器半身没加载。确认 profile `package.json` 的 `dsh.profile.bundles` 含 `dsh-web-search-lite`，重启并刷新页面。 |
| 设置页显示「读取设置失败」 | 宿主没挂 `/api/web-search-pro`。先看 DSH 日志里以 `web-search-pro:` 开头的行，或 `~/.dsh/web-search-pro/host-status.json`（也可以跑 `node _dev/diagnose.mjs`），确认宿主半身跑到了哪一步；常见原因是 Web 服务未启动（该组合下工具仍可用，只是没有设置页）。 |
| 工具报「未知的搜索提供方」 | `provider` 写了不支持的值，改成错误信息里列出的 id。 |
| 401 / 403 | 密钥无效，或该密钥没有这个接口的权限。 |
| 429 | 额度用尽，或被限流。 |
| 一直超时 | 检查 `endpoint`；国内直连 Tavily/Brave 可能需要代理，可以把 `endpoint` 指向自己的转发地址。 |
| 日志里出现 `ERR_MODULE_NOT_FOUND` | 有人在插件里加了 `@deepseek-ai/*` 的 import，见上面的架构说明。 |

## 测试

```bash
node _dev/run-tests.mjs
```

94 项检查，不需要任何桩包，因为插件本来就没有外部依赖：

- **Host（68）**：清单与 patch 结构、只 import node 内置、两个工具的声明与准入、`localDefineTool` 的校验、五家 API 与四个抓取引擎的响应解析（含去重/截断/单次覆盖/跳转还原/推广位过滤/实体解码）、**聚合的轮转合并与 URL 去重、部分失败与全失败**、错误文案分级、HTML→文本、渲染输出、设置的归一化/原子读写/损坏降级、密钥掩码与不回传、挂载自诊断、**官方/免费接管（提供方注册、`settings.mutate` 的目标值与修订号、`foreign` 不抢、开关往返）**，以及 `/api` 的读写/测试/同源拒绝/坏 JSON/前缀剥离。
- **Client（26）**：字典键一致性、`settings.section` 注册、引擎分组、loading/error/ready 三态渲染、404 时的重启指引与手动配置兜底、免密钥引擎下密钥字段自动禁用、密钥徽标与清除按钮、脏检查与按钮启用、测试结果展示，以及 `pick`/`submitted`/`changesBetween`/`callApi`。

## 文件

```
dsh-web-search-lite/          # 仓库根目录就是这个包
├── package.json             # bundle 清单 + dsh.client 声明
├── cordis.patch.yml         # 插入 web-search-pro 这一行
├── index.js                 # Host：设置存取、两个工具、provider 适配、官方/免费接管、HTTP API
├── client.js                # Client：设置 → 网络搜索
├── locale/{en,zh}.json      # 插件清单里的标题与描述
├── icon.svg                 # 原创图标
├── LICENSE                  # MIT
├── CHANGELOG.md             # 版本变更
├── README.md                # 本文件
├── README.en.md             # 英文说明
└── _dev/                    # 开发与测试，不进 profile、不进 npm 包
    ├── install.mjs          # 安装 / 卸载 / 预演
    ├── run-tests.mjs        # 跑两个套件
    ├── live-check.mjs       # 对真实网络验证四个免密钥引擎
    ├── diagnose.mjs         # 诊断设置页为什么读不到数据
    ├── smoke.mjs            # Host 套件
    └── client-smoke.mjs     # 浏览器套件
```
