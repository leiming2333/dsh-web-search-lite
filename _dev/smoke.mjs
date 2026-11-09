// Smoke test for dsh-web-search-lite (Host half).
//
// The plugin imports nothing from the DSH installation, so this suite needs no
// stubs: it points DSH_HOME at a temporary directory, mocks fetch, and drives the
// exported seams plus the `/api/web-search-pro` handler directly.
//
//   node _dev/smoke.mjs

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-home-'));
process.env.DSH_HOME = home;

const plugin = await import('../index.js');
const {
  PROVIDERS,
  PROVIDER_IDS,
  normalizeSettings,
  mergeSettings,
  maskKey,
  publicSettings,
  htmlToText,
  runSearch,
  runFetch,
  localDefineTool,
  renderSearch,
  createApiHandler,
  readSettings,
  writeSettings,
  settingsPath,
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
  FREE_PROVIDER_ID,
  OFFICIAL_PROVIDER_ID,
  freeSearchProvider,
  selectSearchProvider,
  currentSearchProvider,
} = plugin.__test;

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}\n     ${error.message}`);
    process.exitCode = 1;
  }
};

// --- manifest & registration ----------------------------------------------

await check('the package declares a bundle patch and a web client half', () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.name, 'dsh-web-search-lite');
  // The Host reads its version from this manifest; a literal copy would drift.
  assert.equal(plugin.__test.HOST_VERSION, manifest.version, 'HOST_VERSION must equal the manifest version');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.exports['./client'], 'no ./client export');
  assert.ok(manifest.exports['./icon'], 'no ./icon export');
  assert.ok(!manifest.dependencies, 'the package must stay dependency-free');
});

await check('the bundle patch inserts the row under its own id', () => {
  const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /^-\s*insert:/m);
  assert.match(patch, /id:\s*web-search-pro/);
  assert.match(patch, /name:\s*'dsh-web-search-lite'/);
});

await check('the Host half imports only node builtins', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const specifiers = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((match) => match[1]);
  assert.deepEqual(specifiers, ['node:fs', 'node:os', 'node:path']);
});

await check('no static or dynamic import reaches a host package', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const staticImports = [...source.matchAll(/^\s*import\s+[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  for (const specifier of staticImports) {
    assert.ok(specifier.startsWith('node:'), specifier + ' is not a node builtin');
  }
  const dynamic = [...source.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(dynamic, [], 'dynamic imports are not used');
});

const registered = [];
const injectedServices = [];
const routes = [];
const providers = [];
const mutations = [];
let selection = 'deepseek-official';

const webService = {
  registerSearchProvider(provider) {
    providers.push(provider);
    return () => {
      const index = providers.indexOf(provider);
      if (index >= 0) providers.splice(index, 1);
    };
  },
};

const settingsService = {
  describe: () => [{ ns: 'web', revision: 4, value: { searchProvider: selection, fetchProvider: 'http' } }],
  async mutate(ns, ops, revision) {
    mutations.push({ ns, ops, revision });
    selection = ops[0].value;
  },
};

const ctx = {
  logger: { info: () => {}, warn: () => {} },
  tools: {
    register(definition, options) {
      registered.push({ definition, options });
    },
  },
  inject(services, callback) {
    injectedServices.push(services);
    // Simulate a composition that has the web service, the settings service and a
    // web server: the bundle's own desktop composition.
    callback({
      web: webService,
      settings: settingsService,
      webServer: {
        register: (route, label) => {
          routes.push({ route, label });
          return () => {};
        },
      },
      effect: (fn) => {
        fn();
      },
    });
  },
};

plugin.apply(ctx);
// The handoff runs on its own microtask; give it one turn before asserting.
await new Promise((resolve) => setTimeout(resolve, 0));

await check('apply registers both tools and the settings API', () => {
  assert.equal(registered.length, 2);
  assert.deepEqual(
    registered.map((row) => row.definition.name),
    ['web_search_api', 'web_fetch_api'],
  );
  assert.deepEqual(injectedServices, [['web'], ['settings'], ['webServer']]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].route.kind, 'prefix');
  assert.equal(routes[0].route.path, '/api/web-search-pro');
});

await check('the default leaves the official route alone', () => {
  assert.equal(normalizeSettings({}).officialSearch, true, 'installing must not rewrite the provider silently');
  assert.equal(providers.length, 0, 'no free provider is registered while the official route is selected');
  assert.deepEqual(mutations, [], 'nothing is written when the selection is already official');
  assert.equal(selection, OFFICIAL_PROVIDER_ID);
});

await check('turning the official route off mounts ours and repoints the selection', async () => {
  const handler = routes[0].route.handler;
  const post = (body) =>
    new Promise((resolve) => {
      const response = {
        status: 0,
        headers: {},
        headersSent: false,
        body: '',
        writeHead(status) {
          this.status = status;
          this.headersSent = true;
        },
        end(payload) {
          this.body = payload ?? '';
          resolve({ status: this.status, json: JSON.parse(this.body) });
        },
      };
      handler(
        fakeRequest({
          method: 'POST',
          url: '/api/web-search-pro/settings',
          headers: { host: 'x' },
          body: JSON.stringify(body),
        }),
        response,
      );
    });

  const off = await post({ officialSearch: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.settings.officialSearch, false);
  assert.equal(selection, FREE_PROVIDER_ID, 'the free provider is selected');
  assert.equal(providers.length, 1, 'the free provider is registered before the selection moves');
  assert.equal(off.json.dshSearchProvider, FREE_PROVIDER_ID, 'the page learns the live selection');
  const provider = providers[0];
  assert.equal(provider.id, FREE_PROVIDER_ID);
  assert.equal(provider.available(), true);
  assert.equal(provider.ready(), true);
  assert.equal(typeof provider.search, 'function');

  const on = await post({ officialSearch: true });
  assert.equal(on.json.settings.officialSearch, true);
  assert.equal(selection, OFFICIAL_PROVIDER_ID, 'the official route is selected again');
  assert.equal(providers.length, 0, 'the free provider is unregistered after the selection moves');
});

await check('a foreign provider selection is left alone', async () => {
  selection = 'deepseek-search-api';
  const outcome = await selectSearchProvider(settingsService, false);
  assert.equal(outcome.state, 'foreign');
  assert.equal(selection, 'deepseek-search-api');
  selection = 'deepseek-official';
});

await check('web_search_api declares a JSON Schema with query required', () => {
  const { definition } = registered[0];
  assert.equal(definition.parameters.type, 'object');
  assert.deepEqual(definition.parameters.required, ['query']);
  assert.equal(definition.parameters.properties.query.type, 'string');
  assert.equal(definition.parameters.properties.maxResults.type, 'number');
  // The output schema is annotation-only; render owns presentation.
  assert.deepEqual(definition.output.schema, {});
  assert.equal(typeof definition.output.render, 'function');
});

await check('web_fetch_api is gated by the enableFetch setting', () => {
  const gate = registered[1].options.when;
  assert.equal(typeof gate, 'function');
  assert.equal(gate(), true);
  writeSettings({ ...normalizeSettings({}), enableFetch: false });
  assert.equal(gate(), false);
  writeSettings(normalizeSettings({}));
});

await check('localDefineTool rejects bad declarations', () => {
  assert.throws(
    () => localDefineTool({ description: 'x', parameters: {}, output: { render: () => [] }, execute: () => {} }),
    /name is required/,
  );
  assert.throws(
    () => localDefineTool({ name: 'x', parameters: {}, output: {}, execute: () => {} }),
    /output\.render is required/,
  );
});

await check('localDefineTool enforces required and typed arguments before execute', async () => {
  let seen;
  const tool = localDefineTool({
    name: 'probe',
    description: 'x',
    parameters: {
      query: { type: 'string', required: true },
      limit: { type: 'number' },
    },
    output: { render: () => [] },
    execute: (args) => {
      seen = args;
      return 'done';
    },
  });
  await assert.rejects(() => tool.execute({}), /query required/);
  await assert.rejects(() => tool.execute({ query: 'a', limit: '3' }), /limit must be a number/);
  assert.equal(await tool.execute({ query: 'a' }), 'done');
  assert.deepEqual(seen, { query: 'a' });
});

// --- settings storage ------------------------------------------------------

await check('normalizeSettings clamps every out-of-range field', () => {
  const settings = normalizeSettings({
    provider: 'NOPE',
    maxResults: 999,
    timeoutMs: 1,
    fetchMaxChars: 10_000_000,
    includeAnswer: 'yes',
    enableFetch: 1,
    apiKey: '  key  ',
  });
  assert.equal(settings.provider, 'all', 'unknown provider must fall back to the fan-out');
  assert.equal(settings.maxResults, 50);
  assert.equal(settings.timeoutMs, 1000);
  assert.equal(settings.fetchMaxChars, 200000);
  assert.equal(settings.includeAnswer, false, 'a non-true value must not enable a switch');
  assert.equal(settings.enableFetch, false);
  assert.equal(settings.apiKey, 'key');
});

await check('settings round-trip through the state file', () => {
  writeSettings({ ...normalizeSettings({}), provider: 'brave', apiKey: 'secret-key-value', maxResults: 12 });
  const { settings, problem } = readSettings();
  assert.equal(problem, undefined);
  assert.equal(settings.provider, 'brave');
  assert.equal(settings.apiKey, 'secret-key-value');
  assert.equal(settings.maxResults, 12);
  assert.ok(fs.existsSync(settingsPath()));
  assert.ok(settingsPath().startsWith(home), 'state must live under DSH_HOME');
});

await check('a broken settings file degrades to defaults with a reported problem', () => {
  fs.writeFileSync(settingsPath(), '{ not json');
  const { settings, problem } = readSettings();
  assert.equal(settings.provider, 'all');
  assert.match(problem, /不是合法 JSON/);
  writeSettings(normalizeSettings({}));
});

await check('mergeSettings treats a null key as "keep" and "" as clear', () => {
  const base = normalizeSettings({ provider: 'exa', apiKey: 'stored' });
  assert.equal(mergeSettings(base, { provider: 'brave' }).apiKey, 'stored');
  assert.equal(mergeSettings(base, { apiKey: null }).apiKey, 'stored');
  assert.equal(mergeSettings(base, { apiKey: 'fresh' }).apiKey, 'fresh');
  assert.equal(mergeSettings(base, { apiKey: '' }).apiKey, '');
});

await check('the public view never carries the key', () => {
  const view = publicSettings(normalizeSettings({ apiKey: 'tvly-1234567890abcd' }));
  assert.equal(view.apiKey, undefined, 'the key leaked into the view');
  assert.equal(view.hasApiKey, true);
  assert.equal(view.apiKeyPreview, 'tvly…abcd');
  assert.equal(JSON.stringify(view).includes('1234567890'), false);
});

await check('maskKey keeps only the ends', () => {
  assert.equal(maskKey(''), '');
  assert.equal(maskKey('short'), 'sh…');
  assert.equal(maskKey('abcdefghijklmnop'), 'abcd…mnop');
});

// --- providers ------------------------------------------------------------

const calls = [];
function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = handler(String(url), init);
    return {
      ok: body.status === undefined || (body.status >= 200 && body.status < 300),
      status: body.status ?? 200,
      url: String(url),
      headers: new Headers(body.headers ?? { 'content-type': 'application/json' }),
      text: async () => (typeof body.text === 'string' ? body.text : JSON.stringify(body.json ?? {})),
    };
  };
}

/** Run one search against a settings object, with a fresh abort signal. */
function searchWith(settings, args = { query: 'hello world' }) {
  return runSearch(args.query, args, normalizeSettings(settings), new AbortController().signal);
}

const cases = [
  {
    provider: 'tavily',
    payload: {
      answer: 'an answer',
      results: [
        { url: 'https://a.example/1', title: 'A', content: 'snippet a', published_date: '2026-01-01' },
        { url: 'https://a.example/1', title: 'dup', content: 'dup' },
        { url: 'https://b.example/2', title: 'B', content: 'snippet b' },
      ],
    },
    expectAnswer: 'an answer',
  },
  {
    provider: 'serper',
    payload: {
      answerBox: { answer: 'box answer' },
      organic: [
        { link: 'https://a.example/1', title: 'A', snippet: 'snippet a', date: 'Jan 1, 2026' },
        { link: 'https://b.example/2', title: 'B', snippet: 'snippet b' },
      ],
    },
    expectAnswer: 'box answer',
  },
  {
    provider: 'brave',
    payload: {
      web: {
        results: [
          { url: 'https://a.example/1', title: 'A', description: 'snippet a', page_age: '2026-01-01' },
          { url: 'https://b.example/2', title: 'B', description: 'snippet b' },
        ],
      },
    },
  },
  {
    provider: 'exa',
    payload: {
      results: [
        { url: 'https://a.example/1', title: 'A', text: 'body a', publishedDate: '2026-01-01' },
        { url: 'https://b.example/2', title: 'B', text: 'body b' },
      ],
    },
  },
  {
    provider: 'bing',
    payload: {
      webPages: {
        value: [
          { url: 'https://a.example/1', name: 'A', snippet: 'snippet a', dateLastCrawled: '2026-01-01' },
          { url: 'https://b.example/2', name: 'B', snippet: 'snippet b' },
        ],
      },
    },
  },
  {
    provider: 'searxng',
    payload: {
      results: [
        { url: 'https://a.example/1', title: 'A', content: 'snippet a', publishedDate: '2026-01-01' },
        { url: 'https://b.example/2', title: 'B', content: 'snippet b' },
      ],
    },
  },
];

for (const testCase of cases) {
  mockFetch(() => ({ json: testCase.payload }));
  const value = await searchWith({
    provider: testCase.provider,
    apiKey: 'test-key',
    endpoint: testCase.provider === 'searxng' ? 'https://searx.example.com' : '',
    maxResults: 5,
  });
  await check(`${testCase.provider}: normalizes sources`, () => {
    assert.equal(value.provider, testCase.provider);
    assert.equal(value.query, 'hello world');
    assert.equal(value.sources.length, 2, `saw ${value.sources.length} sources`);
    assert.equal(value.sources[0].url, 'https://a.example/1');
    assert.equal(value.sources[0].title, 'A');
    assert.ok(value.sources[0].snippet.length > 0);
    assert.equal(value.truncated, false);
    assert.equal(value.answer, testCase.expectAnswer);
  });
}

await check('tavily sends a bearer token and honours maxResults', async () => {
  mockFetch(() => ({
    json: { results: Array.from({ length: 9 }, (_, i) => ({ url: `https://x/${i}`, title: `t${i}`, content: 'c' })) },
  }));
  calls.length = 0;
  const value = await searchWith({ provider: 'tavily', apiKey: 'k', maxResults: 5 }, { query: 'q', maxResults: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal(calls[0].init.headers.authorization, 'Bearer k');
  assert.equal(JSON.parse(calls[0].init.body).max_results, 3);
  assert.equal(value.sources.length, 3);
  assert.equal(value.truncated, true);
});

await check('a per-call provider override wins over the saved one', async () => {
  mockFetch(() => ({ json: { web: { results: [{ url: 'https://b/1', title: 'B' }] } } }));
  calls.length = 0;
  const value = await searchWith({ provider: 'tavily', apiKey: 'k' }, { query: 'q', provider: 'brave' });
  assert.equal(value.provider, 'brave');
  assert.match(calls[0].url, /api\.search\.brave\.com/);
});

await check('a missing key fails with a settings instruction', async () => {
  await assert.rejects(() => searchWith({ provider: 'brave', apiKey: '' }), (error) => {
    assert.match(error.message, /设置 → 网络搜索/);
    assert.match(error.message, /Brave/);
    return true;
  });
});

await check('SearXNG works without a key but needs an endpoint', async () => {
  await assert.rejects(() => searchWith({ provider: 'searxng', apiKey: '', endpoint: '' }), (error) => {
    assert.match(error.message, /服务地址/);
    return true;
  });
  mockFetch(() => ({ json: { results: [{ url: 'https://s/1', title: 'S', content: 'c' }] } }));
  const value = await searchWith({ provider: 'searxng', endpoint: 'https://searx.example.com/' });
  assert.equal(value.sources.length, 1);
});

await check('an unknown provider lists the supported ids', async () => {
  await assert.rejects(() => searchWith({}, { query: 'q', provider: 'nope' }), (error) => {
    assert.match(error.message, /未知的搜索提供方/);
    assert.match(error.message, /免密钥/);
    assert.match(error.message, /需要 API Key/);
    for (const id of PROVIDER_IDS) assert.ok(error.message.includes(id), `${id} missing from the message`);
    return true;
  });
});

await check('401 points at the key and 429 at the quota', async () => {
  mockFetch(() => ({ status: 401, text: 'unauthorized' }));
  await assert.rejects(() => searchWith({ provider: 'brave', apiKey: 'wrong' }), (error) => {
    assert.match(error.message, /API Key 无效/);
    assert.match(error.message, /unauthorized/);
    return true;
  });
  mockFetch(() => ({ status: 429, text: 'slow down' }));
  await assert.rejects(() => searchWith({ provider: 'brave', apiKey: 'x' }), /额度/);
});

await check('a vendor 5xx surfaces the status and a body excerpt', async () => {
  mockFetch(() => ({ status: 503, text: '<html>maintenance</html>' }));
  await assert.rejects(() => searchWith({ provider: 'exa', apiKey: 'k' }), (error) => {
    assert.match(error.message, /HTTP 503/);
    assert.match(error.message, /maintenance/);
    return true;
  });
});

// --- render ---------------------------------------------------------------

await check('render output is model-readable', () => {
  const text = renderSearch({
    provider: 'tavily',
    providerLabel: 'Tavily',
    query: 'q',
    answer: 'because',
    sources: [{ url: 'https://a', title: 'A', snippet: 's', publishedAt: '2026-01-01' }],
    truncated: false,
  });
  assert.match(text, /Tavily · "q" · 1 条结果/);
  assert.match(text, /摘要：because/);
  assert.match(text, /1\. A/);
  assert.match(text, /发布时间：2026-01-01/);
});

await check('render says so when a search finds nothing', () => {
  const text = renderSearch({ provider: 'brave', providerLabel: 'Brave', query: 'q', sources: [], truncated: false });
  assert.match(text, /没有结果/);
});

// --- fetch ----------------------------------------------------------------

const settings = normalizeSettings({ fetchMaxChars: 5000 });

await check('web_fetch reduces HTML to readable text', async () => {
  mockFetch(() => ({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    text: '<html><head><title>T</title><style>a{}</style></head><body><!-- c --><h1>Title</h1><p>First &amp; second</p><script>x()</script><p>Third</p></body></html>',
  }));
  const value = await runFetch('https://example.com/post', undefined, settings, new AbortController().signal);
  assert.equal(value.status, 200);
  assert.equal(value.finalUrl, 'https://example.com/post');
  assert.match(value.text, /Title/);
  assert.match(value.text, /First & second/);
  assert.match(value.text, /Third/);
  assert.ok(!value.text.includes('<'), 'tags survived');
  assert.ok(!value.text.includes('x()'), 'script body survived');
  assert.ok(!value.text.includes('a{}'), 'style body survived');
});

await check('web_fetch treats plain text as-is and honours maxChars', async () => {
  mockFetch(() => ({ headers: { 'content-type': 'text/plain' }, text: 'a'.repeat(9000) }));
  const value = await runFetch('https://example.com/long', 2000, settings, new AbortController().signal);
  assert.equal(value.text.length, 2000);
  assert.equal(value.truncated, true);
});

await check('web_fetch rejects non-http URLs', async () => {
  await assert.rejects(
    () => runFetch('file:///etc/passwd', undefined, settings, new AbortController().signal),
    /只支持 http/,
  );
  await assert.rejects(() => runFetch('not a url', undefined, settings, new AbortController().signal), /不是合法的 URL/);
});

await check('htmlToText collapses whitespace and drops empty lines', () => {
  const text = htmlToText('<div>  a  </div>\n\n\n<div></div><div>b</div>');
  assert.equal(text, 'a\nb');
});

// --- no-key engines (results pages read as HTML) --------------------------

const DDG_PAGE = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">标题 A &amp; more</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">摘要 A</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Title B</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Snippet B</a>
  </div>
</div>`;

const BING_PAGE = `
<ol id="b_results">
<li class="b_algo"><h2><a href="https://example.com/b" h="ID=SERP,1">Title B</a></h2>
  <div class="b_caption"><p class="b_lineclamp4 b_algoSlug">Snippet <b>B</b></p></div>
</li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9j&amp;ntb=1">Title C</a></h2>
  <p>Snippet C</p>
</li>
</ol>`;

const BAIDU_PAGE = `
<div class="result c-container new-pmd" mu="https://example.com/d">
  <h3 class="t"><a href="https://www.baidu.com/link?url=xyz">标题 D</a></h3>
  <div class="c-abstract">摘要 D</div>
</div>
<div class="result-op c-container">
  <h3 class="t c-gap-top"><a href="https://example.com/e">Title E</a></h3>
  <span class="summary-text_15QGa">Snippet E</span>
</div>
<div class="result c-container ec_ad" mu="https://ad.example/">
  <h3 class="t"><a href="https://www.baidu.com/link?url=ad">广告条目</a></h3>
</div>`;

const SO360_PAGE = `
<ul class="result">
<li class="res-list" data-result-type="normal">
  <h3 class="res-title"><a href="https://www.so.com/link?m=abc" data-mdurl="https://example.com/f" target="_blank">标题 F</a></h3>
  <p class="res-desc">摘要 F</p>
</li>
<li class="res-list" data-result-type="normal">
  <h3 class="res-title"><a href="https://www.so.com/link?m=def" data-mdurl="https://example.com/g">Title G</a></h3>
  <div class="res-desc">Snippet G</div>
</li>
<li class="res-list" data-result-type="ad">
  <h3 class="res-title"><a href="https://www.so.com/link?m=ad" data-mdurl="https://ad.example/">广告</a></h3>
</li>
</ul>`;

await check('duckduckgo: reads title, link and snippet, unwrapping the click tracker', () => {
  const sources = parseDuckDuckGo(DDG_PAGE, 'https://html.duckduckgo.com/html/', 10);
  assert.equal(sources.length, 2, `saw ${sources.length}`);
  assert.equal(sources[0].url, 'https://example.com/a', 'the uddg redirect was not unwrapped');
  assert.equal(sources[0].title, '标题 A & more', 'entities were not decoded');
  assert.equal(sources[0].snippet, '摘要 A');
  assert.equal(sources[1].url, 'https://example.com/b');
});

await check('bing: reads each b_algo block and decodes the ck/a offset link', () => {
  const sources = parseBingWeb(BING_PAGE, 'https://www.bing.com/search?q=x', 10);
  assert.equal(sources.length, 2, `saw ${sources.length}`);
  assert.equal(sources[0].url, 'https://example.com/b');
  assert.equal(sources[0].title, 'Title B');
  assert.equal(sources[0].snippet, 'Snippet B', 'inline markup was not stripped');
  assert.equal(sources[1].url, 'https://example.com/c', 'the base64 offset link was not decoded');
});

await check('baidu: prefers the mu attribute, reads snippets, skips paid rows', () => {
  const sources = parseBaidu(BAIDU_PAGE, 'https://www.baidu.com/s?wd=x', 10);
  assert.equal(sources.length, 2, 'the ad row must be dropped, saw ' + sources.length);
  assert.equal(sources[0].url, 'https://example.com/d', 'mu was not preferred over the /link redirect');
  assert.equal(sources[0].title, '标题 D');
  assert.equal(sources[0].snippet, '摘要 D');
  assert.equal(sources[1].url, 'https://example.com/e', 'a row without mu should fall back to its anchor');
  assert.equal(sources[1].snippet, 'Snippet E', 'the hashed summary-text span was not read');
});

await check('so360: reads res-list rows, prefers data-mdurl, skips ads', () => {
  const sources = parseSo360(SO360_PAGE, 'https://www.so.com/s?q=x', 10);
  assert.equal(sources.length, 2, 'the ad row must be dropped, saw ' + sources.length);
  assert.equal(sources[0].url, 'https://example.com/f', 'data-mdurl was not preferred');
  assert.equal(sources[0].title, '标题 F');
  assert.equal(sources[0].snippet, '摘要 F');
  assert.equal(sources[1].url, 'https://example.com/g');
  assert.equal(sources[1].snippet, 'Snippet G');
});

await check('every parser honours the result limit and drops rows without a link', () => {
  assert.equal(parseDuckDuckGo(DDG_PAGE, 'https://x/', 1).length, 1);
  assert.equal(parseBingWeb(BING_PAGE, 'https://x/', 1).length, 1);
  assert.equal(parseBaidu(BAIDU_PAGE, 'https://x/', 1).length, 1);
  assert.equal(parseSo360(SO360_PAGE, 'https://x/', 1).length, 1);
  const noLinks = '<div class="result"><h2 class="result__title"></h2></div>';
  assert.deepEqual(parseDuckDuckGo(noLinks, 'https://x/', 5), []);
});

await check('an unrecognised page parses to nothing rather than throwing', () => {
  assert.deepEqual(parseDuckDuckGo('<html><body>captcha</body></html>', 'https://x/', 5), []);
  assert.deepEqual(parseBingWeb('', 'https://x/', 5), []);
  assert.deepEqual(parseSo360('<html></html>', 'https://x/', 5), []);
});

await check('html helpers decode entities, strip markup and resolve URLs', () => {
  assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x4e2d;'), "a & b 'c' 中");
  assert.equal(decodeEntities('x&ensp;·&ensp;y &middot; z&hellip;'), 'x · y · z…');
  assert.equal(decodeEntities('&unknown; stays'), '&unknown; stays');
  assert.match(stripTags('<b>bold</b>  <i>x</i>'), /bold\s+x/);
  assert.equal(absoluteUrl('/search?q=1', 'https://example.com/base/'), 'https://example.com/search?q=1');
  assert.equal(absoluteUrl('//cdn.example.com/a', 'https://example.com/'), 'https://cdn.example.com/a');
  assert.equal(absoluteUrl('javascript:void(0)', 'https://example.com/'), undefined);
  assert.equal(absoluteUrl('#frag', 'https://example.com/'), undefined);
});

await check('a no-key engine runs end to end without an API key', async () => {
  mockFetch(() => ({ headers: { 'content-type': 'text/html' }, text: DDG_PAGE }));
  calls.length = 0;
  const value = await searchWith({ provider: 'duckduckgo', apiKey: '' }, { query: '测试查询' });
  assert.equal(value.provider, 'duckduckgo');
  assert.equal(value.sources.length, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /html\.duckduckgo\.com\/html\/\?q=/);
  assert.match(calls[0].init.headers['user-agent'], /Mozilla\/5\.0/, 'a browser UA is required by the engines');
});

await check('every no-key engine sends a browser UA and its own query parameter', async () => {
  const expectations = [
    ['duckduckgo', /[?&]q=/, 'https://html.duckduckgo.com/html/'],
    ['bingweb', /[?&]q=/, 'https://www.bing.com/search'],
    ['baidu', /[?&]wd=/, 'https://www.baidu.com/s'],
    ['so360', /[?&]q=/, 'https://www.so.com/s'],
  ];
  const pages = { duckduckgo: DDG_PAGE, bingweb: BING_PAGE, baidu: BAIDU_PAGE, so360: SO360_PAGE };
  for (const [id, pattern, base] of expectations) {
    mockFetch(() => ({ headers: { 'content-type': 'text/html' }, text: pages[id] }));
    calls.length = 0;
    const value = await searchWith({ provider: id }, { query: '你好 world' });
    assert.equal(value.sources.length, 2, `${id} parsed ${value.sources.length} sources`);
    assert.ok(calls[0].url.startsWith(base), `${id} went to ${calls[0].url}`);
    assert.match(calls[0].url, pattern, `${id} did not send its query parameter`);
    assert.match(calls[0].init.headers['user-agent'], /Mozilla\/5\.0/);
    assert.equal(calls[0].init.headers.accept.includes('text/html'), true);
  }
});

await check('a challenge page served as 200 is reported as rate limiting', async () => {
  // The engines do this with a 200, so a status check alone cannot see it.
  mockFetch(() => ({
    headers: { 'content-type': 'text/html' },
    text: '<html><head><title>访问异常页面</title></head><body>请稍后重试</body></html>',
  }));
  await assert.rejects(() => searchWith({ provider: 'so360' }), (error) => {
    assert.match(error.message, /验证\/拦截页面/);
    assert.match(error.message, /请求过多/);
    assert.ok(!/没有解析出/.test(error.message), 'must not be reported as a parser problem');
    return true;
  });
  mockFetch(() => ({
    headers: { 'content-type': 'text/html' },
    text: '<html><head><title>Just a moment...</title></head><body>checking</body></html>',
  }));
  await assert.rejects(() => searchWith({ provider: 'duckduckgo' }), /验证\/拦截页面/);
});

await check('a bot challenge is reported as a rate limit, not an empty search', async () => {
  mockFetch(() => ({ status: 403, text: 'blocked' }));
  await assert.rejects(() => searchWith({ provider: 'duckduckgo' }), (error) => {
    assert.match(error.message, /反爬/);
    assert.match(error.message, /百度/);
    return true;
  });
  mockFetch(() => ({ status: 429, text: 'slow down' }));
  await assert.rejects(() => searchWith({ provider: 'bingweb' }), /反爬/);
});

await check('an unparsable page says so instead of returning zero results', async () => {
  mockFetch(() => ({ headers: { 'content-type': 'text/html' }, text: '<html><body>验证码</body></html>' }));
  await assert.rejects(() => searchWith({ provider: 'so360' }), (error) => {
    assert.match(error.message, /没有解析出任何搜索结果/);
    assert.match(error.message, /API Key/);
    return true;
  });
});

await check('the default provider queries every no-key engine', () => {
  assert.equal(normalizeSettings({}).provider, 'all');
  assert.equal(PROVIDERS.all.mode, 'fanout');
  assert.equal(PROVIDERS.all.needsKey, false);
  for (const id of PROVIDERS.all ? fanoutEngines(normalizeSettings({})) : []) {
    assert.equal(PROVIDERS[id].needsKey, false, id + ' in the default fan-out would demand a key');
  }
});

// --- settings API ---------------------------------------------------------

function fakeRequest({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const emitter = new EventEmitter();
  emitter.method = method;
  emitter.url = url;
  emitter.headers = headers;
  emitter.destroy = () => {};
  process.nextTick(() => {
    if (body !== undefined) emitter.emit('data', Buffer.from(body));
    emitter.emit('end');
  });
  return emitter;
}

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk);
    },
  };
}

const handler = createApiHandler({ info: () => {}, warn: () => {} });

/** Drive the handler with one fake exchange and parse the JSON answer. */
async function callApi(request) {
  const response = fakeResponse();
  await handler(request, response);
  return { status: response.status, headers: response.headers, json: JSON.parse(response.body || '{}') };
}

await check('GET /settings returns the masked view', async () => {
  writeSettings({ ...normalizeSettings({}), provider: 'brave', apiKey: 'abcdefghijkl' });
  const answer = await callApi(
    fakeRequest({ method: 'GET', url: '/api/web-search-pro/settings', headers: { host: 'x' } }),
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.json.settings.provider, 'brave');
  assert.equal(answer.json.settings.hasApiKey, true);
  assert.ok(!JSON.stringify(answer.json).includes('abcdefghijkl'), 'the key crossed the wire');
});

await check('POST /settings persists a patch and keeps an untouched key', async () => {
  writeSettings({ ...normalizeSettings({}), provider: 'brave', apiKey: 'stored-key' });
  const answer = await callApi(
    fakeRequest({
      method: 'POST',
      url: '/api/web-search-pro/settings',
      headers: { host: 'x', 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'exa', maxResults: 4 }),
    }),
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.json.settings.provider, 'exa');
  assert.equal(answer.json.settings.maxResults, 4);
  assert.equal(answer.json.settings.hasApiKey, true, 'the stored key was dropped');
  assert.equal(readSettings().settings.apiKey, 'stored-key');
});

await check('POST /settings clears the key on an explicit empty string', async () => {
  writeSettings({ ...normalizeSettings({}), apiKey: 'stored-key' });
  const answer = await callApi(
    fakeRequest({
      method: 'POST',
      url: '/api/web-search-pro/settings',
      headers: { host: 'x' },
      body: JSON.stringify({ apiKey: '' }),
    }),
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.json.settings.hasApiKey, false);
  assert.equal(readSettings().settings.apiKey, '');
});

await check('POST /test reports a real search and a real failure', async () => {
  writeSettings({ ...normalizeSettings({}), provider: 'brave', apiKey: 'k' });
  mockFetch(() => ({ json: { web: { results: [{ url: 'https://a/1', title: 'A', description: 'd' }] } } }));
  const good = await callApi(
    fakeRequest({ method: 'POST', url: '/api/web-search-pro/test', headers: { host: 'x' }, body: '{}' }),
  );
  assert.equal(good.status, 200);
  assert.equal(good.json.ok, true);
  assert.equal(good.json.count, 1);
  assert.equal(good.json.provider, 'brave');
  assert.ok(typeof good.json.elapsedMs === 'number');

  mockFetch(() => ({ status: 401, text: 'nope' }));
  const bad = await callApi(
    fakeRequest({ method: 'POST', url: '/api/web-search-pro/test', headers: { host: 'x' }, body: '{}' }),
  );
  assert.equal(bad.status, 200);
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.error, /API Key 无效/);
});

await check('a cross-origin request is refused', async () => {
  const answer = await callApi(
    fakeRequest({
      method: 'POST',
      url: '/api/web-search-pro/settings',
      headers: { host: 'local', origin: 'https://evil.example' },
      body: JSON.stringify({ provider: 'exa' }),
    }),
  );
  assert.equal(answer.status, 403);
  const sameOrigin = await callApi(
    fakeRequest({
      method: 'POST',
      url: '/api/web-search-pro/settings',
      headers: { host: 'local', origin: 'http://local' },
      body: JSON.stringify({ provider: 'exa' }),
    }),
  );
  assert.equal(sameOrigin.status, 200);
});

await check('an unknown route answers 404 and bad JSON answers 500', async () => {
  const notFound = await callApi(
    fakeRequest({ method: 'GET', url: '/api/web-search-pro/nope', headers: { host: 'x' } }),
  );
  assert.equal(notFound.status, 404);
  const badJson = await callApi(
    fakeRequest({ method: 'POST', url: '/api/web-search-pro/settings', headers: { host: 'x' }, body: '{oops' }),
  );
  assert.equal(badJson.status, 500);
  assert.match(badJson.json.error, /不是合法 JSON/);
});

await check('every provider record has the fields the page renders', () => {
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    assert.equal(typeof provider.label, 'string', `${id} has no label`);
    assert.equal(typeof provider.needsKey, 'boolean', `${id} has no needsKey`);
    assert.ok(Number.isInteger(provider.limit) && provider.limit > 0, `${id} has no limit`);
    assert.ok(['api', 'html', 'json', 'fanout'].includes(provider.mode), `${id} has an unknown mode`);
    // The fan-out pseudo-provider is not a site, so it carries no link of its own.
    if (provider.mode === 'fanout') assert.equal(provider.docs, '', `${id} should not carry a docs URL`);
    else assert.match(provider.docs, /^https:\/\//, `${id} has no docs URL`);
    if (provider.needsKey) assert.match(provider.endpoint, /^https:\/\//, `${id} needs a default endpoint`);
    if (provider.mode === 'api') assert.equal(provider.needsKey, true, `${id} is an API provider without a key requirement`);
    if (provider.mode === 'html') assert.equal(provider.needsKey, false, `${id} scrapes but demands a key`);
  }
});

// --- fan-out across every engine ------------------------------------------

await check('urlKey ignores tracking parameters and a trailing slash', () => {
  const base = 'https://example.com/a';
  assert.equal(urlKey('https://example.com/a/'), base);
  assert.equal(urlKey('https://example.com/a?utm_source=x&utm_medium=y'), base);
  assert.equal(urlKey('https://EXAMPLE.com/a#frag'), base);
  assert.equal(urlKey('https://example.com/a?spm=1&fbclid=z'), base);
  // A meaningful query parameter is not stripped.
  assert.notEqual(urlKey('https://example.com/a?id=7'), base);
  assert.equal(urlKey('not a url'), 'not a url');
});

await check('interleave round-robins and de-duplicates across engines', () => {
  const a = [{ url: 'https://x/1', title: 'a1' }, { url: 'https://x/2', title: 'a2' }];
  const b = [{ url: 'https://x/2', title: 'b2-dup' }, { url: 'https://x/3', title: 'b3' }];
  const c = [{ url: 'https://x/9', title: 'c9' }];
  const merged = interleave([a, b, c], 10);
  // Round 1 takes each engine's top row. `a2` shares its URL with `b`'s top row, and
  // that row was visited first within its round, so `a2` is the copy that drops.
  // the list keeps the higher-ranked duplicate, not the later one.
  assert.deepEqual(merged.map((item) => item.title), ['a1', 'b2-dup', 'c9', 'b3']);
  assert.equal(merged[1].url, 'https://x/2', 'the duplicate collapsed onto the first seen URL');
  assert.equal(interleave([a, b, c], 2).length, 2);
  assert.deepEqual(interleave([[], []], 5), []);
});

await check('the fan-out asks every no-key engine, and SearXNG only when configured', () => {
  const withoutEndpoint = fanoutEngines(normalizeSettings({}));
  assert.deepEqual(withoutEndpoint, ['duckduckgo', 'bingweb', 'baidu', 'so360']);
  const withEndpoint = fanoutEngines(normalizeSettings({ endpoint: 'https://searx.example.com' }));
  assert.ok(withEndpoint.includes('searxng'));
});

await check('all: one real query fans out and merges with per-engine reporting', async () => {
  const pages = {
    'html.duckduckgo.com': DDG_PAGE,
    'www.bing.com': BING_PAGE,
    'www.baidu.com': BAIDU_PAGE,
    'www.so.com': SO360_PAGE,
  };
  const seen = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    seen.push(target);
    const host = Object.keys(pages).find((key) => target.includes(key));
    return {
      ok: true,
      status: 200,
      url: target,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => (host === undefined ? '<html></html>' : pages[host]),
    };
  };
  const value = await runSearch('q', {}, normalizeSettings({ provider: 'all', maxResults: 6 }), new AbortController().signal);
  assert.equal(value.provider, 'all');
  assert.equal(seen.length, 4, 'expected one request per engine, saw ' + seen.length);
  assert.ok(value.sources.length > 0, 'the merged list is empty');
  assert.ok(value.sources.length <= 6);
  assert.equal(value.engines.length, 4);
  for (const engine of value.engines) {
    assert.equal(engine.error, undefined, engine.label + ' should have answered');
    assert.ok(engine.count > 0, engine.label + ' reported no rows');
  }
  // Every engine contributed its top row, which is the reason to fan out at all.
  const titles = value.sources.map((item) => item.title);
  assert.ok(titles.length >= 4);
});

await check('all: one engine failing still returns the others and names the loser', async () => {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('duckduckgo')) return { ok: false, status: 403, url: target, headers: new Headers({}), text: async () => 'blocked' };
    const page = target.includes('bing.com') ? BING_PAGE : target.includes('baidu') ? BAIDU_PAGE : SO360_PAGE;
    return { ok: true, status: 200, url: target, headers: new Headers({ 'content-type': 'text/html' }), text: async () => page };
  };
  const value = await runSearch('q', {}, normalizeSettings({ provider: 'all' }), new AbortController().signal);
  assert.ok(value.sources.length > 0, 'a partial failure must not empty the result');
  const failed = value.engines.filter((item) => item.error !== undefined);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, 'duckduckgo');
  assert.match(failed[0].error, /反爬|403/);
  const rendered = renderSearch(value);
  assert.match(rendered, /未返回：DuckDuckGo/);
  assert.match(rendered, /来源：/);
});

await check('all: total failure reports every engine reason', async () => {
  globalThis.fetch = async (url) => ({ ok: false, status: 403, url: String(url), headers: new Headers({}), text: async () => 'blocked' });
  await assert.rejects(
    () => runSearch('q', {}, normalizeSettings({ provider: 'all' }), new AbortController().signal),
    (error) => {
      assert.match(error.message, /4 个引擎都没能返回结果/);
      assert.match(error.message, /DuckDuckGo/);
      assert.match(error.message, /360/);
      return true;
    },
  );
});

await check('the free provider maps a search onto the web seam result', async () => {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: new Headers({}),
    text: async () => DDG_PAGE,
  });
  writeSettings({ ...normalizeSettings({}), provider: 'duckduckgo' });
  const provider = freeSearchProvider();
  assert.equal(provider.id, 'web-search-pro');
  const value = await provider.search({ query: 'harness', maxResults: 2 }, new AbortController().signal);
  assert.ok(Array.isArray(value.sources));
  assert.ok(value.sources.length >= 1 && value.sources.length <= 2);
  assert.ok(value.sources.every((row) => typeof row.url === 'string' && row.url.startsWith('https://')));
  assert.equal('content' in value, false, 'a scraped engine has no provider answer');
  await assert.rejects(
    () => provider.search({ query: '   ' }, new AbortController().signal),
    /request\.query/,
  );
  writeSettings(normalizeSettings({}));
});

// --- mount diagnostics ----------------------------------------------------

await check('apply records every mount stage in host-status.json', () => {
  const status = JSON.parse(fs.readFileSync(path.join(home, 'web-search-pro', 'host-status.json'), 'utf8'));
  assert.equal(status.version, HOST_VERSION, 'a stale Host half must be identifiable');
  assert.deepEqual(status.tools, ['web_search_api', 'web_fetch_api']);
  assert.equal(status.webServer, 'registered');
  assert.equal(status.route, '/api/web-search-pro');
  assert.equal(status.error, null);
  assert.equal(typeof status.updatedAt, 'string');
  assert.equal(typeof status.pid, 'number');
});

await check('a composition without a web server keeps the tools and says why', () => {
  const localStatus = [];
  plugin.apply({
    logger: { info: () => {}, warn: () => {} },
    tools: { register: (definition) => localStatus.push(definition.name) },
    // The fiber resolves but the service is absent: what a headless composition looks like.
    inject(services, callback) {
      callback({ effect: (fn) => fn() });
    },
  });
  const status = JSON.parse(fs.readFileSync(path.join(home, 'web-search-pro', 'host-status.json'), 'utf8'));
  assert.deepEqual(localStatus, ['web_search_api', 'web_fetch_api'], 'tools must still mount');
  assert.equal(status.webServer, 'unavailable');
  assert.match(status.webServerError, /webServer/);
});

await check('a failing tool registration does not stop the API from mounting', () => {
  const routes = [];
  const warnings = [];
  plugin.apply({
    logger: { info: () => {}, warn: (line) => warnings.push(line) },
    tools: {
      register: (definition) => {
        if (definition.name === 'web_search_api') throw new Error('name already taken');
      },
    },
    inject(services, callback) {
      callback({
        webServer: { register: (route) => (routes.push(route), () => {}) },
        effect: (fn) => fn(),
      });
    },
  });
  const status = JSON.parse(fs.readFileSync(path.join(home, 'web-search-pro', 'host-status.json'), 'utf8'));
  assert.deepEqual(status.tools, ['web_fetch_api'], 'the second tool should still register');
  assert.match(status.error, /name already taken/);
  assert.equal(status.webServer, 'registered', 'the settings API must still mount');
  assert.equal(routes.length, 1);
  assert.ok(warnings.some((line) => line.includes('name already taken')));
});

await check('the handler accepts a path whose prefix was already stripped', async () => {
  writeSettings({ ...normalizeSettings({}), provider: 'baidu' });
  const get = await callApi(fakeRequest({ method: 'GET', url: '/settings', headers: { host: 'x' } }));
  assert.equal(get.status, 200, 'a stripped GET must not 404');
  assert.equal(get.json.settings.provider, 'baidu');
  const post = await callApi(
    fakeRequest({ method: 'POST', url: '/settings', headers: { host: 'x' }, body: JSON.stringify({ provider: 'exa' }) }),
  );
  assert.equal(post.status, 200, 'a stripped POST must not 404');
  assert.equal(post.json.settings.provider, 'exa');
});

fs.rmSync(home, { recursive: true, force: true });

console.log(results.join('\n'));
console.log(`\n${results.filter((line) => line.startsWith('ok')).length}/${results.length} checks passed`);
