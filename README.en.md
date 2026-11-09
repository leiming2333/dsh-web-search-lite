# dsh-web-search-lite

[![CI](https://github.com/leiming2333/dsh-web-search-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/leiming2333/dsh-web-search-lite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Web search for DeepSeek Harness: the model can look up current information and open the pages it finds.

Works out of the box with no API key. By default it queries DuckDuckGo, Bing 网页, 百度 and 360 at once and merges them: one engine's ranking is one opinion, and the queries the four disagree on are usually the queries worth searching. A configured search API (Tavily, Serper, Brave, Exa, Bing, SearXNG) is steadier when you have a key.

It can also **take over the built-in `web_search`**. DSH's native `web_search` runs DeepSeek Messages search, where one search is a full model round — billed as generation. A switch in the settings page repoints that tool at the free engines above; the tool name, its prompt guidance and the call shape stay identical, only the bill stops growing. **The default keeps DSH as it was**; opting into the free route is your call. See [Official web search switch](#official-web-search-switch).

Engines, keys, result counts and the switch all live in **Settings → Web search** and apply from the next message; no restart. The page also has a **Test connection** button that runs one real query with the saved settings.

---

## What the model gets

| Tool | What it does |
|---|---|
| `web_search_api` | One search, returns ranked sources (title, URL, snippet, date). Defaults to every no-key engine; accepts a per-call `provider`, `language`, `maxResults` without changing settings. |
| `web_fetch_api` | Reads one URL as plain text (tags, scripts and styles removed). Toggleable in settings. |

Both report the next step on failure — a challenge page suggests another engine, an unparsable page says the engine may have changed, 401/403 means the key is wrong, 429 means rate limit or quota, a timeout suggests raising the limit — instead of only a status code.

## Engines

**No key needed:** `all` (default — all four, round-robin merged and de-duplicated), `duckduckgo`, `bingweb`, `baidu`, `so360`, `searxng` (self-hosted, endpoint required).

**API key:** `tavily`, `serper` (Google results), `brave`, `exa`, `bing` (Bing Web Search API).

The no-key engines are read from their public results pages — nothing to sign up for, and the page structure belongs to the engine, so a redesign or bot check can break one for a while. Failures are reported per engine; in `all`, one engine failing costs only its share of the results.

## Official web search switch

`@deepseek-ai/dsh-web` runs the built-in `web_search` through a selected provider, and the shipped composition pins it:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official   # DeepSeek Messages search
    fetchProvider: http                 # local HTTP fetch, free
```

`deepseek-official` performs the search inside a full Messages request, so every call costs latency plus generated tokens.

| Switch | `web.searchProvider` | Who answers `web_search` | Cost |
|---|---|---|---|
| **On (default)** | `deepseek-official` | DeepSeek Messages search | billed per model round |
| Off | `web-search-pro` | this plugin's free engines | free |

Deliberate choices:

- **On by default.** Installing a search plugin must not silently rewrite someone else's search backend; the free route is explicit.
- **The provider row is never unmounted.** Disabling `web-search-deepseek` would take the built-in **Plugins → Web search** card with it (that page binds to the provider's namespace). The switch only changes which provider is selected.
- **Writes go through `ctx.settings`**, the same path the built-in card uses: same volatile-field validation, same revision guard, same persistence into the profile's `cordis.patch.yml`.
- **A third-party choice is never overwritten.** If DSH selects something that is neither id, the switch reports `foreign` and leaves it alone.
- **Mount before pointing, unpoint before unmounting.** The selection never names an unregistered provider.

Without `web` or `settings` services the switch goes inert and says so in `host-status.json`; the tools keep working.

## Install

### Make sure you are installing the right package

npm has a **different** `dsh-web-search-pro` (by anweat): multi-engine routing plus SQLite caching and Playwright rendering, depending on `@anweat/dsh-browser`. This package is `dsh-web-search-lite` and is unrelated to it.

So if DSH shows something like:

```
dsh-web-search-pro@0.2.3 is incompatible with DSH 0.2.2-rc.1 (requires @deepseek-ai/dsh-tools>=0.2.0-rc.2 <0.2.1-0 || …
```

that is version 0.2.3 of `dsh-web-search-pro`, not this plugin. Its `peerDependencies` cap the range at `<0.2.2-0` while DSH now runs `0.2.2-rc.1`, so it falls outside. This package declares `^0.2.0-rc.1`, which covers `0.2.2-rc.1` under DSH's check (`includePrerelease: true`):

```
✓ @deepseek-ai/cordis        actual 4.1.0       declared ^4.0.2
✓ @deepseek-ai/dsh-tools     actual 0.2.2-rc.1  declared ^0.2.0-rc.1
✓ @deepseek-ai/schemastery   actual 3.19.0      declared ^3.18.4
```

Install this plugin with one of the methods below; do not type the name `dsh-web-search-pro`.

### How to install

The repository root *is* the package (`package.json` carries `dsh.bundle.patch` and `dsh.client`); `_dev/` holds development scripts and is not installed.

```bash
git clone https://github.com/leiming2333/dsh-web-search-lite.git
cd dsh-web-search-lite
node _dev/install.mjs --dry-run      # show what would change
node _dev/install.mjs                # copy into the desktop profile, after backing up
node _dev/install.mjs --profile web  # a different profile
node _dev/install.mjs --uninstall    # roll back
```

The script does three reversible things: copies the package into `<profile>/plugins/` and `<profile>/node_modules/`, adds a `file:` dependency and a `dsh.profile.bundles` entry to the profile's `package.json` (backed up first), and never touches your `cordis.patch.yml`.

You can also ask DSH itself: “install the bundle at /path/to/dsh-web-search-lite” uses `plugin_manager`'s `install_bundle`.

### When a restart is needed

The first install needs a restart: the profile's bundle list changed, and that list is read at startup. Updating files of an already-installed plugin is picked up by DSH's file watcher for the Host half (`applyStartedAt` in `host-status.json` moves with it); the browser half still needs a page refresh.

If Settings → Web search appears but shows `HTTP 404`, check `~/.dsh/web-search-pro/host-status.json`. No such file means the Host half never loaded — quit the app completely and start it again; a page refresh will not do it.

## Settings

Stored in `<DSH_HOME>/web-search-pro/settings.json` (default `~/.dsh/web-search-pro/settings.json`), applied immediately.

| Field | Default | Meaning |
|---|---|---|
| `provider` | `all` | Engine to use; `all` queries every no-key engine. |
| `apiKey` | empty | Key for the API providers. |
| `endpoint` | empty | Custom base URL; required for SearXNG. |
| `maxResults` | `8` | Sources per search (1–50). |
| `timeoutMs` | `20000` | Per-request timeout (1000–120000). |
| `language` | empty | Language hint, e.g. `zh-CN`. |
| `includeAnswer` | `true` | Ask for a generated summary (Tavily). |
| `enableFetch` | `true` | Register `web_fetch_api`. |
| `officialSearch` | `true` | Let the built-in `web_search` use DeepSeek's official search (billed). |
| `fetchMaxChars` | `20000` | Characters kept per page (1000–200000). |

Values are normalized on write, so a hand-edited file cannot put the plugin in an invalid state.

## Verify

**Test connection** runs a real search with the saved settings and reports provider, count, elapsed time and the first three sources; a failure prints the provider's own reason.

Or just ask in chat: “search today's tech news”.

## Architecture (and why)

The Host half imports only `node:fs`, `node:os`, `node:path` — no `@deepseek-ai/*` package. That is not style: DSH loads a profile bundle by resolving the bundle name from two anchors, but the bundle's own `import`s are resolved by Node from the bundle's location, where the DSH installation is not on the chain. A single `import { defineTool } from '@deepseek-ai/dsh-tools'` would throw at load time and the whole plugin would fail to mount.

So the two contracts are re-implemented locally (`localDefineTool` mirrors the validator/wrapper; settings use the plugin's own JSON file plus `/api/web-search-pro` routes), and the official/free handoff uses services through `ctx` — `ctx.web.registerSearchProvider()` and `ctx.settings.mutate()` — which is allowed because it is not an import.

```
┌─ Host: index.js ─────────────────────────────────────────┐
│  settings.json  ← atomic write                           │
│  web_search_api ─→ runSearch ─→ SEARCHERS[id]            │
│  web_fetch_api  ─→ runFetch  ─→ htmlToText               │
│  web provider   ─→ freeSearchProvider() (optional)       │
│  official switch─→ ctx.settings.mutate('web', …)         │
│  ctx.inject(['webServer']) → /api/web-search-pro/*       │
└──────────────────────┬───────────────────────────────────┘
                       │ same-origin JSON
┌──────────────────────┴───────────────────────────────────┐
│  Client: client.js (only `require('react')`)             │
│  ctx.slots.register('settings.section', …)               │
└──────────────────────────────────────────────────────────┘
```

## Security

- API keys are stored in plain text in `~/.dsh/web-search-pro/settings.json`, never returned to the browser (only `hasApiKey` and an `abcd…wxyz` preview).
- All requests originate from the local Host, so there is no CORS surface and keys never reach the page.
- The settings API is same-origin guarded (`Origin` vs `Host`).
- `web_fetch_api` allows only `http`/`https`, follows redirects, reports non-2xx as a result, and never executes page scripts.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No “Web search” section in Settings | The browser half did not load: check `dsh.profile.bundles` includes `dsh-web-search-lite`, restart, reload the page. |
| The page loads but reports `HTTP 404` | The Host half is not running: the app was not restarted after install (a page refresh is not enough). |
| The built-in “Plugins → Web search” card disappeared | Someone set `disabled: true` on `web-search-deepseek`. Do not disable that row; use this plugin's switch instead. |
| The switch does not move “DSH currently selects” | The selection is `foreign` (not managed by the switch), or the Host has no `web`/`settings` service — `host-status.json` says which. |
| `unknown provider` | `provider` holds an unsupported id; use one from the error message. |
| 401 / 403 / 429 / timeouts | Invalid key, missing permission, quota, or endpoint — the tool prints the provider's own wording. |

## Tests

```bash
node _dev/run-tests.mjs
```

94 checks, no stub packages needed, because the plugin has no external dependencies: 68 for the Host half (manifest and patch shape, node-only imports, tool declarations and admission, provider parsers, fan-out merge and de-duplication, partial and total failure, error grading, HTML→text, settings normalization/atomic write/corruption fallback, key masking, mount diagnostics, the official/free handoff, and the `/api` routes) and 26 for the browser half (dictionary keys, slot registration, three render states, 404 guidance, dirty tracking, test results, `pick`/`submitted`/`changesBetween`/`callApi`).

## Files

```
dsh-web-search-lite/
├── package.json         # bundle manifest + dsh.client declaration
├── cordis.patch.yml     # inserts the web-search-pro row
├── index.js             # Host: settings, tools, provider adapters, handoff, HTTP API
├── client.js            # Client: Settings → Web search
├── locale/{en,zh}.json  # plugin title and description
├── icon.svg
├── LICENSE              # MIT
├── CHANGELOG.md
├── README.md            # Chinese
├── README.en.md         # this file
└── _dev/                # not installed
    ├── install.mjs
    ├── run-tests.mjs
    ├── live-check.mjs
    ├── diagnose.mjs
    ├── smoke.mjs
    └── client-smoke.mjs
```

## License

MIT — see [LICENSE](LICENSE).
