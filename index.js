/**
 * Web Search Pro — plugin entry (Host half).
 *
 * Two model-facing tools, no opinion about which search vendor serves them:
 *
 *   - `web_search_api` runs one query against the configured search API and
 *     returns normalized `{ title, url, snippet, publishedAt }` sources.
 *   - `web_fetch_api` reads one page as text so the model can open a source
 *     instead of guessing from the snippet.
 *
 * ## Why this file imports nothing from `@deepseek-ai/*`
 *
 * A profile-installed bundle is resolved with two anchors (dsh installation,
 * then the profile directory), but *imports inside the bundle* are resolved by
 * Node from the bundle's own location. From `~/.dsh/profiles/<p>/node_modules/…`
 * the DSH installation's packages are not on that chain, so `import { defineTool }
 * from '@deepseek-ai/dsh-tools'` throws ERR_MODULE_NOT_FOUND at load time and the
 * whole plugin never mounts. Everything below therefore uses `node:` builtins plus
 * the `ctx` object the Host hands us — the same shape the other third-party
 * bundles in this profile use.
 *
 * That rules out `@deepseek-ai/dsh-tools`'s `defineTool` and the settings schema
 * machinery. `defineTool` is a validator/wrapper around a plain object literal, so
 * `localDefineTool` reproduces the contract (typed parameters, JSON Schema
 * projection, argument validation). Configuration lives in this plugin's own JSON
 * file under `$DSH_HOME` and is served to the Settings page over the Host's own
 * `/api/web-search-pro/*` routes, which keeps both halves in sync without needing
 * the config-forms transport.
 *
 * @module dsh-web-search-lite
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Package version, read from the manifest rather than repeated as a literal.
 *
 * Three copies of a version number drift the moment one of them is bumped — this
 * one did, and the only place the mismatch surfaced was `host-status.json`, where
 * it looks like a stale Host half rather than a typo. Reading the manifest keeps
 * the status file, the upstream User-Agent and `package.json` in agreement.
 */
const HOST_VERSION = (() => {
  try {
    const manifest = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** Request header sent upstream; bumped with the package version. */
const USER_AGENT = `dsh-web-search-lite/${HOST_VERSION}`

/** Route prefix this plugin owns on the Host web server. */
const API_PREFIX = '/api/web-search-pro'

/** Ceiling for a single fetched body kept in memory, in characters. */
const FETCH_BODY_LIMIT = 200000

/** Largest settings request body accepted, to keep a stray upload from buffering. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Search providers this plugin can talk to.
 *
 * `endpoint` is the default URL; a non-empty configured `endpoint` overrides it.
 * `needsKey` providers cannot work anonymously, so a missing key is reported as a
 * configuration problem rather than a network failure. `limit` is the vendor's own
 * maximum result count, applied before `maxResults` so a large setting never
 * produces a rejected request.
 */
/**
 * Search providers this plugin can talk to, in three families.
 *
 * `mode` names the wire format:
 *   - `fanout` queries every no-key engine at once and merges the answers. This is
 *            the default: one engine's ranking is one opinion, and the engines
 *            disagree most on exactly the queries worth searching.
 *   - `html`  a search engine's public results page, read as HTML. No key, no
 *            account, no quota to sign up for — but the page structure is the
 *            engine's own, so a redesign (or bot filtering) can break it.
 *   - `json`  a documented JSON endpoint that needs no key (SearXNG's own API).
 *   - `api`   a vendor's documented JSON endpoint, authenticated by an API key.
 *
 * `needsKey` is what the Settings page groups by, and what decides whether a
 * missing key is a configuration problem. `limit` is the vendor's own maximum
 * result count, applied before `maxResults` so a large setting never produces a
 * rejected request.
 */
const PROVIDERS = {
  all: {
    label: '全部引擎',
    mode: 'fanout',
    endpoint: '',
    needsKey: false,
    limit: 50,
    docs: '',
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    mode: 'html',
    endpoint: 'https://html.duckduckgo.com/html/',
    needsKey: false,
    limit: 30,
    docs: 'https://duckduckgo.com/',
  },
  bingweb: {
    label: 'Bing 网页',
    mode: 'html',
    endpoint: 'https://www.bing.com/search',
    needsKey: false,
    limit: 30,
    docs: 'https://www.bing.com/',
  },
  baidu: {
    label: '百度',
    mode: 'html',
    endpoint: 'https://www.baidu.com/s',
    needsKey: false,
    limit: 30,
    docs: 'https://www.baidu.com/',
  },
  so360: {
    label: '360 搜索',
    mode: 'html',
    endpoint: 'https://www.so.com/s',
    needsKey: false,
    limit: 30,
    docs: 'https://www.so.com/',
  },
  searxng: {
    label: 'SearXNG（自建实例）',
    mode: 'json',
    endpoint: '',
    needsKey: false,
    limit: 50,
    docs: 'https://docs.searxng.org/dev/search_api.html',
  },
  tavily: {
    label: 'Tavily',
    mode: 'api',
    endpoint: 'https://api.tavily.com/search',
    needsKey: true,
    limit: 20,
    docs: 'https://app.tavily.com/home',
  },
  serper: {
    label: 'Serper (Google)',
    mode: 'api',
    endpoint: 'https://google.serper.dev/search',
    needsKey: true,
    limit: 100,
    docs: 'https://serper.dev/api-key',
  },
  brave: {
    label: 'Brave Search',
    mode: 'api',
    endpoint: 'https://api.search.brave.com/res/v1/web/search',
    needsKey: true,
    limit: 20,
    docs: 'https://api.search.brave.com/app/keys',
  },
  exa: {
    label: 'Exa',
    mode: 'api',
    endpoint: 'https://api.exa.ai/search',
    needsKey: true,
    limit: 100,
    docs: 'https://dashboard.exa.ai/api-keys',
  },
  bing: {
    label: 'Bing Web Search API',
    mode: 'api',
    endpoint: 'https://api.bing.microsoft.com/v7.0/search',
    needsKey: true,
    limit: 50,
    docs: 'https://portal.azure.com/',
  },
}

/** Provider ids in a stable order, used by messages and the Settings page. */
const PROVIDER_IDS = Object.keys(PROVIDERS)

/** Defaults for every stored setting. */
const DEFAULTS = {
  // Querying every no-key engine at once is the default: it needs no setup, and the
  // merged ranking is noticeably better than any single one of them.
  provider: 'all',
  apiKey: '',
  endpoint: '',
  maxResults: 8,
  timeoutMs: 20000,
  language: '',
  includeAnswer: true,
  enableFetch: true,
  fetchMaxChars: 20000,
}

// ---------------------------------------------------------------------------
// Settings storage
// ---------------------------------------------------------------------------

/** `$DSH_HOME`, the directory DSH keeps profiles and plugin state under. */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return path.join(os.homedir(), '.dsh')
}

/** Directory holding this plugin's state, beside the other plugins' folders. */
function stateDir() {
  return path.join(dshHome(), 'web-search-pro')
}

/** Path of the settings file. */
function settingsPath() {
  return path.join(stateDir(), 'settings.json')
}

/** Coerce to a finite integer, falling back when the value is not a number. */
function toInteger(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** Keep `value` inside `[min, max]`. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Record how far this Host half got while mounting.
 *
 * The browser half and the Host half load independently: a page refresh picks up a
 * new client module through HMR, while the Host keeps running the plugin set it
 * booted with. That mismatch shows up as a Settings page whose `/api` routes answer
 * 404, and there is no log file to read on a packaged desktop build. Writing a
 * small status file at every mount stage turns that into something inspectable:
 * `applyStartedAt` present but no `webServer` means the Host never ran this bundle,
 * `webServer: "unavailable"` means the composition has no web server, and so on.
 *
 * Failures here are swallowed on purpose — diagnostics must never be the reason a
 * plugin fails to load.
 *
 * @param patch - fields to merge into the status record.
 */
function writeHostStatus(patch) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true })
    const file = path.join(stateDir(), 'host-status.json')
    let current = {}
    try {
      current = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      current = {}
    }
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    )
  } catch {
    // A read-only or missing home directory is not a reason to stop mounting.
  }
}

/**
 * Normalize a partial record into a complete, legal settings object.
 *
 * Every field is clamped and type-checked here rather than at each use site, so a
 * hand-edited JSON file or an over-permissive browser form cannot produce a state
 * that later code has to defend against.
 *
 * @param raw - whatever was read from disk or from a request body.
 * @returns a complete settings object.
 */
function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const provider = String(source.provider ?? DEFAULTS.provider).trim().toLowerCase()
  return {
    provider: PROVIDER_IDS.includes(provider) ? provider : DEFAULTS.provider,
    apiKey: String(source.apiKey ?? DEFAULTS.apiKey).trim(),
    endpoint: String(source.endpoint ?? DEFAULTS.endpoint).trim(),
    maxResults: clamp(toInteger(source.maxResults, DEFAULTS.maxResults), 1, 50),
    timeoutMs: clamp(toInteger(source.timeoutMs, DEFAULTS.timeoutMs), 1000, 120000),
    language: String(source.language ?? DEFAULTS.language).trim(),
    includeAnswer: source.includeAnswer === undefined ? DEFAULTS.includeAnswer : source.includeAnswer === true,
    enableFetch: source.enableFetch === undefined ? DEFAULTS.enableFetch : source.enableFetch === true,
    fetchMaxChars: clamp(toInteger(source.fetchMaxChars, DEFAULTS.fetchMaxChars), 1000, FETCH_BODY_LIMIT),
  }
}

/**
 * Read the settings file.
 *
 * A missing or unparsable file answers the defaults instead of throwing: a broken
 * settings file must not stop the plugin from mounting, and the Settings page can
 * then show what is wrong by offering to save a clean record.
 *
 * @returns `{ settings, problem }` where `problem` names a parse failure.
 */
function readSettings() {
  const file = settingsPath()
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { settings: normalizeSettings({}), problem: undefined }
    return { settings: normalizeSettings({}), problem: `无法读取 ${file}：${error?.message ?? error}` }
  }
  try {
    return { settings: normalizeSettings(JSON.parse(text)), problem: undefined }
  } catch (error) {
    return { settings: normalizeSettings({}), problem: `设置文件不是合法 JSON（${file}）：${error?.message ?? error}` }
  }
}

/**
 * Replace the settings file atomically.
 *
 * A sibling temp file plus `rename` means a crash mid-write leaves the previous
 * file intact rather than a half-written one.
 *
 * @param settings - the complete settings to persist.
 */
function writeSettings(settings) {
  const dir = stateDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = settingsPath()
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * Build a registry-ready tool definition from a typed declaration.
 *
 * Mirrors `@deepseek-ai/dsh-tools`'s `defineTool` for the subset this plugin uses:
 * a per-property parameter spec becomes an object-rooted JSON Schema, required
 * fields are enforced before `execute` runs, and `output.schema` is the
 * annotation-only `{}` because rendering owns the presentation. The registry itself
 * treats a definition as a plain object, so no package import is involved.
 *
 * @param options - name, description, parameter spec, output spec, execute.
 * @returns the definition object `ctx.tools.register` accepts.
 */
function localDefineTool(options) {
  if (typeof options.name !== 'string' || options.name === '') throw new Error('defineTool: name is required')
  if (typeof options.execute !== 'function') throw new Error(`defineTool(${options.name}): execute is required`)

  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(options.parameters ?? {})) {
    const property = { type: spec.type }
    if (spec.description !== undefined) property.description = spec.description
    properties[key] = property
    if (spec.required === true) required.push(key)
  }
  const parameters = { type: 'object', properties, ...(required.length === 0 ? {} : { required }) }

  const render = options.output?.render
  if (typeof render !== 'function') throw new Error(`defineTool(${options.name}): output.render is required`)

  return {
    name: options.name,
    description: options.description,
    parameters,
    output: { schema: {}, render },
    async execute(args, exec) {
      const value = args !== null && typeof args === 'object' ? args : {}
      const missing = required.filter((key) => value[key] === undefined || value[key] === null)
      if (missing.length > 0) throw new Error(`invalid arguments: ${missing.join(', ')} required`)
      for (const [key, spec] of Object.entries(options.parameters ?? {})) {
        const given = value[key]
        if (given === undefined) continue
        const wanted = spec.type === 'number' ? 'number' : spec.type
        if (typeof given !== wanted) throw new Error(`invalid arguments: ${key} must be a ${wanted}`)
      }
      return options.execute(value, exec)
    },
  }
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

/** Shorten text for an error message without hiding the cause. */
function excerpt(text, limit = 300) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/**
 * Turn an HTTP failure into an actionable message.
 *
 * A 401/403 almost always means the key, a 429 the quota, a 4xx the endpoint — the
 * model reads this text and repeats it to the user, so it names the provider, the
 * status, and the next step instead of only the code.
 */
function httpFailure(provider, status, body) {
  const hint =
    status === 401 || status === 403
      ? `${provider.label} 拒绝了这次请求，通常是 API Key 无效、过期或没有该接口的权限。请到「设置 → 网络搜索」检查密钥。`
      : status === 429
        ? `${provider.label} 报告请求过多或额度用尽，请稍后重试或检查套餐额度。`
        : status === 404
          ? `${provider.label} 返回 404，请检查「设置 → 网络搜索」里的服务地址是否正确。`
          : `${provider.label} 返回 HTTP ${status}。`
  return `${hint}\n响应片段：${excerpt(body)}`
}

/**
 * Send one request and parse JSON, preserving the vendor's error text.
 *
 * @param provider - the adapter whose label names failures.
 * @param url - absolute request URL.
 * @param init - fetch init; `signal` is supplied by the caller.
 * @returns the parsed JSON body.
 */
async function requestJson(provider, url, init) {
  const headers = { accept: 'application/json', 'user-agent': USER_AGENT, ...init.headers }
  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  if (!response.ok) throw new Error(httpFailure(provider, response.status, text))
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${provider.label} 返回的内容不是 JSON：${excerpt(text, 200)}`)
  }
}

/** Build a source, dropping empty fields so the model never sees `undefined`. */
function source(entry) {
  const url = typeof entry.url === 'string' ? entry.url.trim() : ''
  if (url === '') return undefined
  const result = { url }
  const title = typeof entry.title === 'string' ? entry.title.trim() : ''
  if (title !== '') result.title = title
  const snippet = typeof entry.snippet === 'string' ? entry.snippet.trim() : ''
  if (snippet !== '') result.snippet = excerpt(snippet, 600)
  const publishedAt = typeof entry.publishedAt === 'string' ? entry.publishedAt.trim() : ''
  if (publishedAt !== '') result.publishedAt = publishedAt
  return result
}

/** Drop unusable rows and duplicate URLs, keeping the first (best-ranked) one. */
function collect(rows) {
  const seen = new Set()
  const sources = []
  for (const row of rows) {
    const item = source(row)
    if (item === undefined || seen.has(item.url)) continue
    seen.add(item.url)
    sources.push(item)
  }
  return sources
}

// ---------------------------------------------------------------------------
// Search engines read as HTML
//
// These providers have no API key and no quota: the plugin requests the same
// results page a browser would and reads the list out of the markup. That makes
// them the zero-setup path, and it also makes them the brittle path — the page
// structure belongs to the engine, so a redesign or a bot challenge breaks the
// parser rather than an error code. Every parser below therefore reports "no
// results parsed" with the same actionable message instead of returning an empty
// list that looks like a genuinely empty search.
// ---------------------------------------------------------------------------

/**
 * A desktop browser UA string.
 *
 * Search engines answer a bot-looking UA with a challenge page or a 403, so the
 * default `dsh-web-search-lite` token is replaced only on this path; API calls keep
 * identifying themselves honestly.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Named entities that show up in result titles and snippets. */
const NAMED_ENTITIES = {
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
}

/** Decode numeric references plus the named entities that appear in results. */
function decodeEntities(text) {
  const fromCode = (code) => {
    try {
      return String.fromCodePoint(code)
    } catch {
      return ''
    }
  }
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCode(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

/** Reduce one HTML fragment to single-line text. */
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Resolve a possibly relative, entity-escaped href against the results page. */
function absoluteUrl(href, base) {
  const raw = decodeEntities(String(href ?? '').trim())
  if (raw === '' || raw.startsWith('#') || /^javascript:/i.test(raw)) return undefined
  try {
    return new URL(raw, base).toString()
  } catch {
    return undefined
  }
}

/**
 * Undo the click-tracking wrapper an engine puts around a result link.
 *
 * DuckDuckGo redirects through `/l/?uddg=`, Bing through `/ck/a?u=a1<base64url>`.
 * Baidu's `/link?url=` is resolved server-side and cannot be decoded here, so it is
 * kept as-is: `web_fetch_api` follows redirects and still lands on the page.
 */
function unwrapRedirect(raw) {
  try {
    const url = new URL(raw)
    const uddg = url.searchParams.get('uddg')
    if (uddg !== null && uddg !== '') return uddg
    const target = url.searchParams.get('u')
    if (target !== null && /^a1/i.test(target)) {
      // Bing's offset link is `a1` plus url-safe base64 of the destination.
      const normalized = target.slice(2).replace(/-/g, '+').replace(/_/g, '/')
      const decoded = Buffer.from(normalized, 'base64').toString('utf8')
      if (/^https?:\/\//i.test(decoded)) return decoded
    }
    if (/\/url$/.test(url.pathname)) {
      const q = url.searchParams.get('q')
      if (q !== null && /^https?:\/\//i.test(q)) return q
    }
    return raw
  } catch {
    return raw
  }
}

/** Turn one parsing candidate into a source row, unwrapping the click tracker. */
function scrapedRow(href, base, title, snippet) {
  const absolute = absoluteUrl(href, base)
  if (absolute === undefined) return undefined
  return {
    url: unwrapRedirect(absolute),
    title: stripTags(title ?? ''),
    snippet: snippet === undefined || snippet === null ? undefined : stripTags(snippet),
  }
}

/** Collect scraped rows, dropping ones without a usable link or title. */
function collectScraped(rows, limit) {
  return collect(
    rows.filter((row) => row !== undefined && row.title !== '').slice(0, limit),
  )
}

/**
 * Titles of the pages engines serve instead of results when they suspect automation.
 *
 * These come back with HTTP 200, so a status check cannot see them; without this
 * the failure surfaces as "could not parse any results", which reads like a parser
 * bug and sends the reader looking in the wrong place.
 */
const BLOCK_PAGE_TITLE =
  /<title>\s*(?:访问异常|安全验证|验证码|人机验证|Just a moment|Attention Required|Captcha|Access Denied)/i

/**
 * Request one results page as HTML.
 *
 * @param provider - the adapter naming failures.
 * @param url - absolute results URL.
 * @param signal - caller cancellation.
 * @param language - accepted-language hint, empty for the default.
 * @returns the response body.
 */
async function fetchResultsPage(provider, url, signal, language) {
  const tag = language === '' ? 'zh-CN,zh;q=0.9,en;q=0.8' : `${language},${language.split('-')[0]};q=0.9,en;q=0.6`
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': tag,
      'cache-control': 'no-cache',
      'upgrade-insecure-requests': '1',
    },
    signal,
  })
  const html = await response.text()
  if (!response.ok) {
    if (response.status === 403 || response.status === 429 || response.status === 503) {
      throw new Error(
        `${provider.label} 拒绝了这次自动访问（HTTP ${response.status}），通常是反爬或频率限制。`
          + '可以稍后重试、换一个免密钥引擎（比如百度或 Bing 网页），或在「设置 → 网络搜索」里改用带 API Key 的提供方。',
      )
    }
    throw new Error(`${provider.label} 返回 HTTP ${response.status}。响应片段：${excerpt(html, 200)}`)
  }
  // A challenge page arrives as 200, so it has to be recognised by its title.
  if (BLOCK_PAGE_TITLE.test(html.slice(0, 4000))) {
    throw new Error(
      `${provider.label} 返回了验证/拦截页面，没有给出搜索结果。通常是短时间内请求过多；`
        + '稍等一会儿再试，或换一个免密钥引擎（百度、Bing 网页通常更宽松）。',
    )
  }
  return html
}

/** Report an empty parse as a parser/structure problem, not as "no results". */
function emptyParse(provider) {
  return new Error(
    `${provider.label} 没有解析出任何搜索结果。常见原因：引擎改了结果页结构、返回了验证页，或这条查询确实没有结果。`
      + '可以换个关键词重试，或换一个免密钥引擎；需要稳定结果时建议在「设置 → 网络搜索」里配置 API Key。',
  )
}

/** DuckDuckGo: result blocks carry `result__a` / `result__snippet` classes. */
function parseDuckDuckGo(html, base, limit) {
  const rows = []
  for (const block of html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1)) {
    const link = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (link === null) continue
    const snippet =
      /<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      ?? /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|td)>/i.exec(block)
    rows.push(scrapedRow(link[1], base, link[2], snippet?.[1]))
  }
  return collectScraped(rows, limit)
}

/** Bing: each organic result is an `<li class="b_algo">` with an `<h2><a>` title. */
function parseBingWeb(html, base, limit) {
  const rows = []
  for (const block of html.split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"/i).slice(1)) {
    const link = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (link === null) continue
    const snippet =
      /<p[^>]+class="[^"]*\bb_lineclamp\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)
      ?? /<div[^>]+class="[^"]*\bb_caption\b[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)
      ?? /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)
    rows.push(scrapedRow(link[1], base, link[2], snippet?.[1]))
  }
  return collectScraped(rows, limit)
}

/**
 * Baidu: one container per result. The container's own `mu` attribute holds the
 * real destination (the anchor only carries a `/link?url=` redirect), and paid
 * placements are marked in the container class, so both are read from the block's
 * opening tag — which is why the split keeps it instead of discarding it.
 */
function parseBaidu(html, base, limit) {
  const rows = []
  for (const block of html.split(/(?=<div[^>]+class="[^"]*\bc-container\b[^"]*")/i).slice(1)) {
    const head = /^<div[^>]*>/i.exec(block)?.[0] ?? ''
    if (/\bec_ad\b|\bec_union\b/i.test(head)) continue
    const link = /<h3[^>]+class="[^"]*\bt\b[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (link === null) continue
    const real = /\bmu="([^"]+)"/i.exec(head) ?? /\bmu="([^"]+)"/i.exec(block)
    // Snippets sit in `c-abstract`, or in a hashed `summary-text_xxxx` span whose
    // prefix is the stable part, or in the right-hand content column.
    const snippet =
      /<div[^>]+class="[^"]*\bc-abstract\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
      ?? /<(?:div|span|p)[^>]+class="[^"]*\bsummary-text[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i.exec(block)
      ?? /<span[^>]+class="[^"]*\bcontent-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block)
      ?? /<div[^>]+class="[^"]*\bc-span-last\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
    rows.push(scrapedRow(real?.[1] ?? link[1], base, link[2], snippet?.[1]))
  }
  return collectScraped(rows, limit)
}

/**
 * 360: `<li class="res-list">` per result, with the real destination in
 * `data-mdurl` beside the `so.com/link` redirect. Paid rows carry an `ad` marker in
 * the opening tag and are skipped.
 */
function parseSo360(html, base, limit) {
  const rows = []
  for (const block of html.split(/(?=<li[^>]+class="[^"]*\bres-list\b[^"]*")/i).slice(1)) {
    const head = /^<li[^>]*>/i.exec(block)?.[0] ?? ''
    if (/data-result-type="[^"]*\bad\b/i.test(head) || /\bec_ad\b/i.test(head)) continue
    const link = /<h3[^>]+class="[^"]*\bres-title\b[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/i.exec(block)
    if (link === null) continue
    const real = /\bdata-mdurl="([^"]+)"/i.exec(link[2]) ?? /\bdata-mdurl="([^"]+)"/i.exec(block)
    const snippet =
      /<p[^>]+class="[^"]*\bres-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)
      ?? /<div[^>]+class="[^"]*\bres-desc\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
    rows.push(scrapedRow(real?.[1] ?? link[1], base, link[3], snippet?.[1]))
  }
  return collectScraped(rows, limit)
}

/**
 * Build one engine's results URL and run its parser.
 *
 * The engine is asked for more rows than needed: a results page interleaves answer
 * boxes, image cards and paid placements that never become sources, so requesting
 * exactly `count` usually returns fewer. The parser then trims to `count`, which is
 * what the caller asked for.
 */
async function scrapeSearch(provider, parser, build, cfg, query, count, signal) {
  const wanted = Math.min(Math.max(count * 3, 12), provider.limit)
  const url = build(cfg.endpoint || provider.endpoint, query, wanted, cfg.language)
  const html = await fetchResultsPage(provider, url, signal, cfg.language)
  const sources = parser(html, url, count)
  if (sources.length === 0) throw emptyParse(provider)
  return { sources }
}

/** DuckDuckGo HTML endpoint; one page holds roughly ten results. */
async function searchDuckDuckGo(provider, cfg, query, count, signal) {
  return scrapeSearch(provider, parseDuckDuckGo, (endpoint, q) => {
    const url = new URL(endpoint)
    url.searchParams.set('q', q)
    return url.toString()
  }, cfg, query, count, signal)
}

/** Bing's public results page. */
async function searchBingWeb(provider, cfg, query, count, signal) {
  return scrapeSearch(provider, parseBingWeb, (endpoint, q, limited, language) => {
    const url = new URL(endpoint)
    url.searchParams.set('q', q)
    url.searchParams.set('count', String(limited))
    if (language !== '') url.searchParams.set('setlang', language)
    return url.toString()
  }, cfg, query, count, signal)
}

/** Baidu's public results page; `rn` asks for the result count. */
async function searchBaidu(provider, cfg, query, count, signal) {
  return scrapeSearch(provider, parseBaidu, (endpoint, q, limited) => {
    const url = new URL(endpoint)
    url.searchParams.set('wd', q)
    url.searchParams.set('rn', String(limited))
    return url.toString()
  }, cfg, query, count, signal)
}

/** Tavily: POST /search, key in the Authorization header, optional direct answer. */
async function searchTavily(provider, cfg, query, count, signal) {
  const payload = await requestJson(provider, cfg.endpoint || provider.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      query,
      max_results: Math.min(count, provider.limit),
      search_depth: 'basic',
      include_answer: cfg.includeAnswer,
    }),
    signal,
  })
  return {
    answer: typeof payload.answer === 'string' ? payload.answer : undefined,
    sources: collect(
      (Array.isArray(payload.results) ? payload.results : []).map((row) => ({
        url: row.url,
        title: row.title,
        snippet: row.content,
        publishedAt: row.published_date,
      })),
    ),
  }
}

/** Serper: POST /search, Google organic results, key in X-API-KEY. */
async function searchSerper(provider, cfg, query, count, signal) {
  const body = { q: query, num: Math.min(count, provider.limit) }
  if (cfg.language !== '') body.hl = cfg.language
  const payload = await requestJson(provider, cfg.endpoint || provider.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey },
    body: JSON.stringify(body),
    signal,
  })
  const answerBox = payload.answerBox ?? {}
  const answer = answerBox.answer ?? answerBox.snippet ?? payload.knowledgeGraph?.description
  return {
    answer: typeof answer === 'string' && answer.trim() !== '' ? answer : undefined,
    sources: collect(
      (Array.isArray(payload.organic) ? payload.organic : []).map((row) => ({
        url: row.link,
        title: row.title,
        snippet: row.snippet,
        publishedAt: row.date,
      })),
    ),
  }
}

/** Brave: GET /res/v1/web/search, key in X-Subscription-Token. */
async function searchBrave(provider, cfg, query, count, signal) {
  const url = new URL(cfg.endpoint || provider.endpoint)
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(count, provider.limit)))
  if (cfg.language !== '') url.searchParams.set('search_lang', cfg.language)
  const payload = await requestJson(provider, url.toString(), {
    method: 'GET',
    headers: { 'x-subscription-token': cfg.apiKey },
    signal,
  })
  return {
    sources: collect(
      (payload.web?.results ?? []).map((row) => ({
        url: row.url,
        title: row.title,
        snippet: row.description,
        publishedAt: row.page_age,
      })),
    ),
  }
}

/** Exa: POST /search, key in x-api-key, inline page text as the snippet. */
async function searchExa(provider, cfg, query, count, signal) {
  const payload = await requestJson(provider, cfg.endpoint || provider.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey },
    body: JSON.stringify({
      query,
      numResults: Math.min(count, provider.limit),
      contents: { text: { maxCharacters: 600 } },
    }),
    signal,
  })
  return {
    sources: collect(
      (Array.isArray(payload.results) ? payload.results : []).map((row) => ({
        url: row.url,
        title: row.title,
        snippet: row.text ?? row.summary,
        publishedAt: row.publishedDate,
      })),
    ),
  }
}

/** Bing: GET /v7.0/search, key in Ocp-Apim-Subscription-Key. */
async function searchBing(provider, cfg, query, count, signal) {
  const url = new URL(cfg.endpoint || provider.endpoint)
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(count, provider.limit)))
  if (cfg.language !== '') url.searchParams.set('mkt', cfg.language)
  const payload = await requestJson(provider, url.toString(), {
    method: 'GET',
    headers: { 'ocp-apim-subscription-key': cfg.apiKey },
    signal,
  })
  return {
    sources: collect(
      (payload.webPages?.value ?? []).map((row) => ({
        url: row.url,
        title: row.name,
        snippet: row.snippet,
        publishedAt: row.dateLastCrawled,
      })),
    ),
  }
}

/** 360 Search's public results page. */
async function searchSo360(provider, cfg, query, count, signal) {
  return scrapeSearch(provider, parseSo360, (endpoint, q) => {
    const url = new URL(endpoint)
    url.searchParams.set('q', q)
    return url.toString()
  }, cfg, query, count, signal)
}

/** SearXNG: GET /search?format=json on the instance the user runs. */
async function searchSearxng(provider, cfg, query, count, signal) {
  const base = cfg.endpoint === '' ? '' : cfg.endpoint.replace(/\/+$/, '')
  if (base === '') {
    throw new Error(
      '使用 SearXNG 需要先在「设置 → 网络搜索」里填写服务地址，例如 https://searx.example.com（实例需在 settings.yml 中开启 json 格式）。',
    )
  }
  const url = new URL(`${base}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  if (cfg.language !== '') url.searchParams.set('language', cfg.language)
  const payload = await requestJson(provider, url.toString(), { method: 'GET', signal })
  return {
    sources: collect(
      (Array.isArray(payload.results) ? payload.results : [])
        .slice(0, Math.min(count, provider.limit))
        .map((row) => ({
          url: row.url,
          title: row.title,
          snippet: row.content,
          publishedAt: row.publishedDate,
        })),
    ),
  }
}

/** Adapter table: id → search implementation. */
const SEARCHERS = {
  all: searchAll,
  duckduckgo: searchDuckDuckGo,
  bingweb: searchBingWeb,
  baidu: searchBaidu,
  so360: searchSo360,
  searxng: searchSearxng,
  tavily: searchTavily,
  serper: searchSerper,
  brave: searchBrave,
  exa: searchExa,
  bing: searchBing,
}

// ---------------------------------------------------------------------------
// Fan-out: every no-key engine at once
// ---------------------------------------------------------------------------

/**
 * Normalize a result URL for cross-engine de-duplication.
 *
 * Four engines answering the same query surface the same popular pages, usually
 * with different tracking parameters. Comparing raw strings would keep every copy;
 * comparing a stripped form keeps the first (best-ranked) one and lets the rest of
 * the budget go to genuinely different sources.
 *
 * @param raw - the URL as the engine reported it.
 * @returns a comparison key; unparsable input is compared verbatim.
 */
function urlKey(raw) {
  try {
    const url = new URL(raw)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|ref$|ref_src$|referrer$|share_|fbclid$|gclid$|msclkid$|_hsenc$)/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    const text = url.toString()
    // A trailing slash is the same page; a root path is not, so only trim the former.
    return text.endsWith('/') && url.pathname !== '/' ? text.slice(0, -1) : text
  } catch {
    return String(raw)
  }
}

/**
 * Merge ranked lists by taking one row from each engine in turn.
 *
 * Concatenating would let whichever engine answered first — or returned the most
 * rows — own the top of the list. Round-robin keeps every engine's best result in
 * the first few slots, which is the reason to ask all of them.
 *
 * @param lists - per-engine ranked sources, best first.
 * @param limit - how many merged sources to keep.
 * @returns the merged, de-duplicated list.
 */
function interleave(lists, limit) {
  const out = []
  const seen = new Set()
  const depth = lists.reduce((max, list) => Math.max(max, list.length), 0)
  for (let index = 0; index < depth; index++) {
    for (const list of lists) {
      const item = list[index]
      if (item === undefined) continue
      const key = urlKey(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
      if (out.length >= limit) return out
    }
  }
  return out
}

/** Engines a fan-out may use: every no-key page reader, plus SearXNG when configured. */
function fanoutEngines(cfg) {
  const ids = ['duckduckgo', 'bingweb', 'baidu', 'so360']
  if (cfg.endpoint !== '') ids.push('searxng')
  return ids
}

/**
 * Ask every usable engine at once and merge what comes back.
 *
 * A fan-out has to survive partial failure — that is its whole value, since one
 * engine being slow, rate-limited or redesigned is normal rather than exceptional.
 * `allSettled` keeps the winners and reports the losers per engine; only a total
 * loss becomes an error, and that error carries each engine's own reason. The
 * per-engine breakdown also rides back on the result so the caller can say where
 * the answers came from.
 *
 * @param provider - the fan-out pseudo-provider.
 * @param cfg - settings snapshot.
 * @param query - the search query.
 * @param count - how many merged sources to keep.
 * @param signal - caller cancellation, shared by every engine.
 * @returns `{ sources, engines }`.
 */
async function searchAll(provider, cfg, query, count, signal) {
  const ids = fanoutEngines(cfg)
  // Ask for more per engine than the caller needs, so the overlap removed by
  // de-duplication does not eat the whole budget.
  const perEngine = Math.max(count, 6)
  const settled = await Promise.allSettled(
    ids.map((id) => SEARCHERS[id](PROVIDERS[id], cfg, query, perEngine, signal)),
  )

  const engines = []
  const lists = []
  for (const [index, outcome] of settled.entries()) {
    const id = ids[index]
    if (outcome.status === 'fulfilled') {
      const sources = outcome.value.sources ?? []
      engines.push({ id, label: PROVIDERS[id].label, count: sources.length })
      lists.push(sources)
    } else {
      // Only the first line: a provider's full message can span paragraphs of advice.
      const reason = String(outcome.reason?.message ?? outcome.reason).split('\n')[0]
      engines.push({ id, label: PROVIDERS[id].label, count: 0, error: reason })
    }
  }

  const sources = interleave(lists, count)
  if (sources.length === 0) {
    const reasons = engines.map((item) => `${item.label}：${item.error ?? '没有解析到结果'}`).join('；')
    throw new Error(
      `同时查询的 ${ids.length} 个引擎都没能返回结果。${reasons}。`
        + '可以换个关键词再试，或在「设置 → 网络搜索」里改用某个具体引擎 / 配置 API Key。',
    )
  }
  return { sources, engines }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Run one search and normalize the result.
 *
 * @param query - the user's query.
 * @param options - `{ maxResults?, provider?, language? }` from the tool call; each
 *   overrides the same setting for this one call and never persists.
 * @param cfg - the settings snapshot.
 * @param signal - caller cancellation.
 * @returns `{ provider, providerLabel, query, answer?, sources, truncated }`.
 */
async function runSearch(query, options, cfg, signal) {
  const requested = typeof options?.provider === 'string' ? options.provider.trim().toLowerCase() : ''
  const providerId = requested !== '' ? requested : cfg.provider
  const provider = PROVIDERS[providerId]
  if (provider === undefined) {
    const free = PROVIDER_IDS.filter((id) => !PROVIDERS[id].needsKey)
    const keyed = PROVIDER_IDS.filter((id) => PROVIDERS[id].needsKey)
    throw new Error(
      `未知的搜索提供方 "${providerId}"。免密钥：${free.join('、')}；需要 API Key：${keyed.join('、')}。`
        + '请在「设置 → 网络搜索」里选择，或在调用时用 provider 参数指定。',
    )
  }
  if (provider.needsKey && cfg.apiKey === '') {
    throw new Error(
      `还没有配置 ${provider.label} 的 API Key，因此无法搜索。`
        + '请让用户在「设置 → 网络搜索」里填入密钥并保存；也可以先用 provider 参数切到一个免密钥引擎（duckduckgo、bingweb、baidu、so360）。',
    )
  }

  // One call may override the fan-out without rewriting the saved setting; the
  // provider's own ceiling wins so a large number never becomes a rejected request.
  const count = clamp(toInteger(options?.maxResults, cfg.maxResults), 1, Math.min(50, provider.limit))
  const effective = {
    ...cfg,
    language:
      typeof options?.language === 'string' && options.language.trim() !== ''
        ? options.language.trim()
        : cfg.language,
  }

  const result = await SEARCHERS[providerId](provider, effective, query, count, signal)
  const sources = result.sources.slice(0, count)
  return {
    provider: providerId,
    providerLabel: provider.label,
    query,
    ...(result.answer === undefined ? {} : { answer: result.answer }),
    sources,
    truncated: result.sources.length > count,
    // Present only for a fan-out: which engines answered, and which did not.
    ...(result.engines === undefined ? {} : { engines: result.engines }),
  }
}

/** Reduce an HTML document to readable plain text. */
function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Read one page as text.
 *
 * HTML is reduced to readable text without a parser dependency: scripts, styles,
 * comments and tags are stripped, block-level elements become newlines, and the
 * five common entities are decoded. It is deliberately lossy — the model needs
 * prose, not a DOM.
 *
 * @param url - absolute http(s) URL.
 * @param maxChars - how much text to keep.
 * @param cfg - the settings snapshot (for timeout only).
 * @param signal - caller cancellation.
 * @returns `{ url, finalUrl, status, contentType, text, truncated }`.
 */
async function runFetch(url, maxChars, cfg, signal) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`不是合法的 URL："${url}"。请给出带 http:// 或 https:// 的完整地址。`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`只支持 http 与 https，收到的是 "${parsed.protocol}"。`)
  }
  const response = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
    signal,
  })
  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()
  const isHtml = /html|xml/i.test(contentType) || /^\s*<(?:!doctype|html)/i.test(raw)
  const text = isHtml ? htmlToText(raw) : raw.trim()
  const limit = clamp(toInteger(maxChars, cfg.fetchMaxChars), 1000, FETCH_BODY_LIMIT)
  return {
    url: parsed.toString(),
    finalUrl: response.url,
    status: response.status,
    contentType,
    text: text.slice(0, limit),
    truncated: text.length > limit,
    bodyBytes: raw.length,
  }
}

/**
 * Combine this call's timeout with the caller's cancellation.
 *
 * `AbortSignal.any` reports whichever fires first, so a slow vendor hits our
 * deadline while a cancelled turn still stops the request immediately.
 */
function combinedSignal(timeoutMs, callerSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (callerSignal === undefined || callerSignal === null) return timeout
  try {
    return AbortSignal.any([timeout, callerSignal])
  } catch {
    return timeout
  }
}

/** Translate an abort into a message that says which deadline was hit. */
function abortMessage(error, timeoutMs) {
  if (error?.name === 'TimeoutError') {
    return `请求在 ${timeoutMs} 毫秒内没有完成，已中止。可以在「设置 → 网络搜索」里调大超时时间，或稍后重试。`
  }
  if (error?.name === 'AbortError') return '请求已被取消。'
  return undefined
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Format a search result for the model. */
function renderSearch(value) {
  const lines = [`${value.providerLabel ?? value.provider} · "${value.query}" · ${value.sources.length} 条结果`]

  // A fan-out names its engines: a merged list without that is harder to trust,
  // and a silent partial failure looks like a genuinely thin result set.
  if (Array.isArray(value.engines) && value.engines.length > 0) {
    const answered = value.engines.filter((item) => item.error === undefined)
    const failed = value.engines.filter((item) => item.error !== undefined)
    if (answered.length > 0) {
      lines.push(`来源：${answered.map((item) => `${item.label} ${item.count}`).join(' · ')}`)
    }
    if (failed.length > 0) {
      lines.push(`未返回：${failed.map((item) => `${item.label}（${item.error}）`).join('；')}`)
    }
  }

  if (value.answer !== undefined) lines.push('', `摘要：${value.answer}`)
  if (value.sources.length === 0) {
    lines.push('', '没有结果。可以换更具体的关键词，或换一种语言再试。')
    return lines.join('\n')
  }
  lines.push('')
  value.sources.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title ?? '(无标题)'}`)
    lines.push(`   ${item.url}`)
    if (item.snippet !== undefined) lines.push(`   ${item.snippet}`)
    if (item.publishedAt !== undefined) lines.push(`   发布时间：${item.publishedAt}`)
  })
  if (value.truncated) lines.push('', `结果已截断到 ${value.sources.length} 条。`)
  return lines.join('\n')
}

/** Format a fetched page for the model. */
function renderFetch(value) {
  const lines = [
    `${value.finalUrl}（HTTP ${value.status}${value.contentType === '' ? '' : `，${value.contentType}`}）`,
    '',
    value.text === '' ? '(页面没有可读文本)' : value.text,
  ]
  if (value.truncated) {
    lines.push('', `正文已截断到 ${value.text.length} 字符；需要更多内容时用 maxChars 调大。`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------------------

/** Hide all but the first and last four characters of a key. */
function maskKey(key) {
  if (key === '') return ''
  if (key.length <= 10) return `${key.slice(0, 2)}…`
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/**
 * The settings view the browser is allowed to see.
 *
 * The key itself never crosses the wire: the page learns whether one is configured
 * and a masked preview, which is enough to show state and to decide whether an
 * empty field means "keep" or "missing".
 */
function publicSettings(settings, problem) {
  return {
    provider: settings.provider,
    hasApiKey: settings.apiKey !== '',
    apiKeyPreview: maskKey(settings.apiKey),
    endpoint: settings.endpoint,
    maxResults: settings.maxResults,
    timeoutMs: settings.timeoutMs,
    language: settings.language,
    includeAnswer: settings.includeAnswer,
    enableFetch: settings.enableFetch,
    fetchMaxChars: settings.fetchMaxChars,
    ...(problem === undefined ? {} : { problem }),
  }
}

/** Whether a request came from this app, by checking Origin against Host. */
function sameOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined || origin === '') return true
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Send one JSON response. */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Read a JSON request body, bounded by `MAX_BODY_BYTES`. */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        const value = JSON.parse(text)
        resolve(value !== null && typeof value === 'object' ? value : {})
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${error?.message ?? error}`))
      }
    })
    request.on('error', reject)
  })
}

/**
 * Apply a partial settings patch coming from the Settings page.
 *
 * `apiKey` has three meanings, which is why it is not a plain assignment: absent or
 * `null` keeps the stored key (the page never receives it), `""` clears it, and any
 * other string replaces it.
 *
 * @param current - the settings currently on disk.
 * @param patch - the request body.
 * @returns the complete settings to persist.
 */
function mergeSettings(current, patch) {
  const next = { ...current }
  for (const field of ['provider', 'endpoint', 'language']) {
    if (patch[field] !== undefined) next[field] = patch[field]
  }
  for (const field of ['maxResults', 'timeoutMs', 'fetchMaxChars']) {
    if (patch[field] !== undefined) next[field] = patch[field]
  }
  for (const field of ['includeAnswer', 'enableFetch']) {
    if (patch[field] !== undefined) next[field] = patch[field]
  }
  if (patch.apiKey !== undefined && patch.apiKey !== null) next.apiKey = patch.apiKey
  return normalizeSettings(next)
}

/**
 * Build the `/api/web-search-pro` handler.
 *
 * Routes:
 *   GET  /settings   read the masked settings
 *   POST /settings   merge a patch, persist, answer the new masked settings
 *   POST /test       run one real search with the saved settings
 *
 * Every route is same-origin guarded: the desktop shell is the only client, and a
 * cross-site page must not be able to rewrite the endpoint a key is sent to.
 *
 * @param logger - the plugin logger, for background failures.
 * @returns a Node request handler.
 */
function createApiHandler(logger) {
  return async (request, response) => {
    try {
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'cross-origin request refused' })
      // A prefix route may hand over the full path or the part after the prefix,
      // depending on the deployment; accept both instead of silently 404-ing one.
      const raw = new URL(request.url ?? '/', 'http://localhost').pathname
      const trimmed = raw.startsWith(API_PREFIX) ? raw.slice(API_PREFIX.length) : raw
      const pathname = trimmed === '' ? '/' : trimmed
      const isSettings = pathname === '/settings' || pathname === '/'

      if (request.method === 'GET' && isSettings) {
        const { settings, problem } = readSettings()
        return sendJson(response, 200, { settings: publicSettings(settings, problem) })
      }

      if (request.method === 'POST' && isSettings) {
        const patch = await readJsonBody(request)
        const { settings: current } = readSettings()
        const settings = mergeSettings(current, patch)
        writeSettings(settings)
        logger?.info?.(`web-search-pro: settings saved (provider=${settings.provider})`)
        return sendJson(response, 200, { settings: publicSettings(settings) })
      }

      if (request.method === 'POST' && pathname === '/test') {
        const body = await readJsonBody(request)
        const { settings } = readSettings()
        const query =
          typeof body.query === 'string' && body.query.trim() !== '' ? body.query.trim() : 'DeepSeek Harness'
        const started = Date.now()
        try {
          const value = await runSearch(query, {}, settings, combinedSignal(settings.timeoutMs))
          return sendJson(response, 200, {
            ok: true,
            elapsedMs: Date.now() - started,
            provider: value.provider,
            providerLabel: value.providerLabel,
            count: value.sources.length,
            ...(value.answer === undefined ? {} : { answer: value.answer }),
            sources: value.sources.slice(0, 5),
          })
        } catch (error) {
          return sendJson(response, 200, {
            ok: false,
            elapsedMs: Date.now() - started,
            error: abortMessage(error, settings.timeoutMs) ?? error?.message ?? String(error),
          })
        }
      }

      return sendJson(response, 404, { error: `unknown route ${request.method} ${pathname}` })
    } catch (error) {
      logger?.warn?.(`web-search-pro: api failure ${error?.message ?? error}`)
      if (response.headersSent) return response.end()
      return sendJson(response, 500, { error: error?.message ?? String(error) })
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/** Settings this plugin needs from the Host before it can expose tools. */
export const inject = ['tools']

/** Host plugin name, used by logs and by the Settings page's own identification. */
export const name = 'web-search-pro'

/**
 * Mount the tools and the settings API.
 *
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  const logger = ctx.logger
  const mounted = {
    version: HOST_VERSION,
    pid: process.pid,
    applyStartedAt: new Date().toISOString(),
    tools: [],
    // Present from the start: a patch that carries `undefined` for a field would drop
    // it on serialization and erase the previous record instead of keeping it.
    error: null,
  }
  writeHostStatus({ ...mounted, webServer: 'pending' })

  // Each stage is guarded and recorded. A failure in one stage must not take the
  // other down: search keeps working without the settings API, and a partially
  // registered route still leaves a trace in `host-status.json` to diagnose.
  try {
    ctx.tools.register(
      localDefineTool({
        name: 'web_search_api',
        description:
          'Search the web through the engine configured in Settings → Web search. The default is to query DuckDuckGo, Bing 网页, 百度 and 360 at once and merge their ranking; a single engine can be selected if one keeps failing. '
          + 'Engines that need no account (DuckDuckGo, Bing 网页, 百度, 360) work out of the box; a configured API provider (Tavily, Serper, Brave, Exa, Bing Web Search API, SearXNG) is steadier when the user has a key. '
          + "Use it for anything that needs current information beyond the model's knowledge: news, prices, releases, docs, people, or a fact you want a source for. "
          + 'Returns ranked sources with title, URL and snippet; follow up with web_fetch_api on a URL when the snippet is not enough. '
          + 'Prefer several focused queries over one broad one. If one engine reports that it cannot parse results or is rate-limited, retry once with another provider instead of giving up. '
          + 'If it reports a missing API key, either pass a no-key provider or tell the user to open Settings → Web search — do not repeat the same failing call.',
        parameters: {
          query: { type: 'string', required: true, description: '搜索关键词或问题，使用自然语言。' },
          maxResults: { type: 'number', description: '本次返回的结果条数；不填则使用设置里的默认值。' },
          provider: {
            type: 'string',
            description: '本次临时指定引擎：duckduckgo、bingweb、baidu、so360（免密钥）或 tavily、serper、brave、exa、bing、searxng（需密钥）；默认 all 表示同时查询全部免密钥引擎。不写入设置。',
          },
          language: { type: 'string', description: '本次临时指定结果语言，例如 zh-CN。' },
        },
        output: {
          render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
        },
        async execute(args, exec) {
          const { settings } = readSettings()
          const query = String(args.query ?? '').trim()
          if (query === '') throw new Error('query 不能为空。')
          const signal = combinedSignal(settings.timeoutMs, exec?.signal)
          try {
            return await runSearch(query, args, settings, signal)
          } catch (error) {
            throw new Error(abortMessage(error, settings.timeoutMs) ?? error?.message ?? String(error))
          }
        },
      }),
    )
    mounted.tools.push('web_search_api')
  } catch (error) {
    mounted.error = `web_search_api: ${error?.message ?? error}`
    logger?.warn?.(`web-search-pro: ${mounted.error}`)
  }

  // Gated per model step rather than at mount time: the switch lives in the settings
  // file, so flipping it must take the tool out of the very next request's schema
  // instead of waiting for a restart.
  try {
    ctx.tools.register(
      localDefineTool({
        name: 'web_fetch_api',
        description:
          'Read one web page as plain text. Use it to open a URL returned by web_search_api, or any URL the user gives you, when the search snippet is not enough to answer. '
          + 'HTML is reduced to readable text and truncated to the configured limit; a non-2xx status is reported as part of the result rather than thrown.',
        parameters: {
          url: { type: 'string', required: true, description: '要读取的完整地址，含 http:// 或 https://。' },
          maxChars: { type: 'number', description: '本次返回的最大字符数；不填则使用设置里的默认值。' },
        },
        output: {
          render: (_args, value) => [{ type: 'text', text: renderFetch(value) }],
        },
        async execute(args, exec) {
          const { settings } = readSettings()
          const signal = combinedSignal(settings.timeoutMs, exec?.signal)
          try {
            return await runFetch(String(args.url ?? '').trim(), args.maxChars, settings, signal)
          } catch (error) {
            throw new Error(abortMessage(error, settings.timeoutMs) ?? error?.message ?? String(error))
          }
        },
      }),
      { when: () => readSettings().settings.enableFetch },
    )
    mounted.tools.push('web_fetch_api')
  } catch (error) {
    mounted.error = `${mounted.error === null ? '' : `${mounted.error}; `}web_fetch_api: ${error?.message ?? error}`
    logger?.warn?.(`web-search-pro: web_fetch_api registration failed: ${error?.message ?? error}`)
  }

  writeHostStatus({ tools: mounted.tools, error: mounted.error })

  // The settings page needs an HTTP route; the tool lane does not. A composition
  // without a web server keeps search working and simply has no Settings section,
  // which is why this is a nested fiber rather than a hard requirement.
  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    if (server === undefined || server === null || typeof server.register !== 'function') {
      writeHostStatus({ webServer: 'unavailable', webServerError: 'no usable webServer service in this composition' })
      logger?.warn?.('web-search-pro: webServer service is missing; the Settings page has no data source')
      return
    }
    const handler = createApiHandler(logger)
    try {
      scoped.effect(
        () => server.register({ kind: 'prefix', path: API_PREFIX, handler }, 'web-search-pro: api'),
        'web-search-pro: api routes',
      )
      writeHostStatus({ webServer: 'registered', route: API_PREFIX, webServerError: null })
      logger?.info?.(`web-search-pro: settings API mounted at ${API_PREFIX}`)
    } catch (error) {
      writeHostStatus({ webServer: 'register-failed', webServerError: String(error?.message ?? error) })
      logger?.warn?.(`web-search-pro: could not register ${API_PREFIX}: ${error?.message ?? error}`)
    }
  })

  const { settings, problem } = readSettings()
  logger?.info?.(
    `web-search-pro: tools mounted (provider=${settings.provider}, key=${settings.apiKey === '' ? 'missing' : 'set'}, fetch=${String(settings.enableFetch)})`,
  )
  if (problem !== undefined) logger?.warn?.(`web-search-pro: ${problem}`)
}

// Exported for the headless checks; not part of the plugin contract.
export const __test = {
  PROVIDERS,
  PROVIDER_IDS,
  DEFAULTS,
  normalizeSettings,
  mergeSettings,
  maskKey,
  publicSettings,
  htmlToText,
  runSearch,
  runFetch,
  localDefineTool,
  renderSearch,
  renderFetch,
  createApiHandler,
  readSettings,
  writeSettings,
  settingsPath,
  stateDir,
  writeHostStatus,
  HOST_VERSION,
  parseDuckDuckGo,
  parseBingWeb,
  parseBaidu,
  parseSo360,
  urlKey,
  interleave,
  fanoutEngines,
  searchAll,
  decodeEntities,
  stripTags,
  absoluteUrl,
  unwrapRedirect,
  BROWSER_UA,
  BLOCK_PAGE_TITLE,
  fetchResultsPage,
}
