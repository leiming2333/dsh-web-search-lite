// Smoke test for the browser half of dsh-web-search-lite.
//
// Loads client.js behind a fake module loader with a minimal React (element
// construction, hook stubs with injectable initial state) and asserts the slot
// registration, dictionary parity, the three render states, and the draft/write
// comparison that decides which fields a save sends.
//
//   node _dev/client-smoke.mjs

import assert from 'node:assert/strict';

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

// --- fake React ------------------------------------------------------------
// Element construction plus hook stubs. `useState` reads from a queue so a test
// can drop the component straight into a later state without a re-render loop;
// effects never run, which keeps the first render deterministic.
let stateQueue = [];

const fakeReact = {
  createElement(type, props, ...children) {
    if (type === undefined) throw new Error('createElement received an undefined type');
    return { type, props: props ?? {}, children: children.flat() };
  },
  useState(initial) {
    const value = stateQueue.length > 0 ? stateQueue.shift() : typeof initial === 'function' ? initial() : initial;
    return [value, () => {}];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  useRef(initial) {
    return { current: initial };
  },
};

const modules = new Map([['react', fakeReact]]);
let captured;
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry;
    },
  },
};

await import('../client.js');

await check('the browser module registers itself under the package name', () => {
  assert.ok(captured !== undefined, 'ModuleLoader.load was never called');
  assert.equal(captured.id, 'dsh-web-search-lite');
  assert.equal(typeof captured.factory, 'function');
});

const exports = captured.factory((name) => {
  if (!modules.has(name)) throw new Error(`unexpected require("${name}")`);
  return modules.get(name);
});

await check('the browser half exports apply and inject', () => {
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots', 'locale']);
  assert.equal(exports.NS, 'settings.webSearchPro');
});

await check('the browser half imports no host client package', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const required = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]);
  assert.deepEqual(required, ['react'], 'only react may be required');
  assert.ok(!source.includes('@deepseek-ai/dsh-client-ui-primitives'), 'primitives must not be used');
});

// --- fake client context ---------------------------------------------------

const dictionaries = [];
const registrations = [];
const injected = [];

const ctx = {
  effect(fn) {
    const dispose = fn();
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  },
  locale: {
    register(ns, dict) {
      dictionaries.push({ ns, dict });
      return () => {};
    },
    bind(ns) {
      return (key) => {
        const table = dictionaries.find((row) => row.ns === ns)?.dict?.zh;
        return table?.[key] ?? `missing:${key}`;
      };
    },
  },
  slots: {
    inject(slot, factory) {
      injected.push(slot);
      const dispose = factory();
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};

exports.apply(ctx);

const t = (key) => dictionaries[0].dict.zh[key] ?? `missing:${key}`;

await check('apply registers one dictionary and one settings section', () => {
  assert.equal(dictionaries.length, 1);
  assert.equal(dictionaries[0].ns, 'settings.webSearchPro');
  assert.deepEqual(injected, ['settings.section']);
  assert.equal(registrations.length, 1);
  const { options } = registrations[0];
  assert.equal(options.name, 'settings.section');
  assert.equal(options.id, 'web-search-pro');
  assert.equal(typeof options.order, 'number');
  assert.equal(options.label(), '网络搜索');
  assert.equal(options.locale, 'settings.webSearchPro');
});

await check('zh and en dictionaries share exactly the same keys', () => {
  const { en, zh } = dictionaries[0].dict;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const [key, value] of Object.entries(en)) {
    assert.ok(typeof value === 'string' && value !== '', `en.${key} is not a non-empty string`);
  }
  for (const [key, value] of Object.entries(zh)) {
    assert.ok(typeof value === 'string' && value !== '', `zh.${key} is not a non-empty string`);
  }
  assert.ok(Object.keys(en).length >= 45, `only ${Object.keys(en).length} keys`);
});

// --- render helpers --------------------------------------------------------

/** Walk an element tree, following component children only as element values. */
function walk(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

/** All text content below one element, for assertions on copy. */
function textOf(tree) {
  const parts = [];
  const visit = (node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return parts.join(' ');
}

const View = {
  provider: 'brave',
  hasApiKey: true,
  apiKeyPreview: 'abcd…wxyz',
  endpoint: '',
  maxResults: 8,
  timeoutMs: 20000,
  language: '',
  includeAnswer: true,
  enableFetch: true,
  fetchMaxChars: 20000,
};

/** Render the page with a preset hook state. */
function renderWith(preset) {
  stateQueue = preset;
  const tree = registrations[0].component({ t });
  stateQueue = [];
  return tree;
}

/** The nine useState slots in source order. */
function pageState({ status = 'ready', view = View, draft, saved, busy = false, notice = null, probe = null, testing = false, revealed = false, keyTouched = false }) {
  const { pick } = exports.__test;
  return [status === 'ready' ? { status, view } : status, draft ?? pick(view), saved ?? pick(view), busy, notice, probe, testing, revealed, keyTouched];
}

await check('the page shows the loading line before the settings arrive', () => {
  const tree = renderWith([{ status: 'loading' }, null, null, false, null, null, false, false, false]);
  const nodes = walk(tree);
  assert.ok(nodes.some((node) => node.type === 'h2'), 'no title');
  assert.match(textOf(tree), /加载中/);
  assert.equal(nodes.filter((node) => node.type === 'input').length, 0, 'rendered inputs while loading');
});

await check('the page reports a load failure with a retry button', () => {
  const tree = renderWith([{ status: 'error', message: 'boom' }, null, null, false, null, null, false, false, false]);
  const nodes = walk(tree);
  assert.match(textOf(tree), /读取设置失败.*boom/);
  const buttons = nodes.filter((node) => node.type === 'button');
  assert.equal(buttons.length, 1, 'expected exactly the retry button');
  assert.match(textOf(buttons[0]), /重试/);
});

await check('a 404 explains that the Host half is not running', () => {
  const tree = renderWith([
    { status: 'error', message: 'HTTP 404: not found' },
    null,
    null,
    false,
    null,
    null,
    false,
    false,
    false,
  ]);
  const text = textOf(tree);
  assert.match(text, /宿主半身/, 'the restart hint is missing');
  assert.match(text, /重启 DeepSeek Harness/);
  assert.match(text, /刷新页面不够/, 'must say a page refresh is not enough');
  assert.match(text, /settings\.json/, 'no fallback file path');
  assert.match(text, /"provider": "duckduckgo"/, 'no fallback template');
  const buttons = walk(tree).filter((node) => node.type === 'button');
  assert.equal(buttons.length, 1, 'expected only the retry button');
});

await check('a non-404 failure shows the error without the restart lecture', () => {
  const tree = renderWith([
    { status: 'error', message: 'TypeError: boom' },
    null,
    null,
    false,
    null,
    null,
    false,
    false,
    false,
  ]);
  const text = textOf(tree);
  assert.match(text, /读取设置失败.*boom/);
  assert.ok(!text.includes('宿主半身'), 'the restart hint must only follow a 404');
});

await check('the ready page renders every field', () => {
  const tree = renderWith(pageState({}));
  const nodes = walk(tree);
  const inputs = nodes.filter((node) => node.type === 'input');
  const selects = nodes.filter((node) => node.type === 'select');
  const options = nodes.filter((node) => node.type === 'option');
  assert.equal(inputs.length, 6, `expected 6 inputs, saw ${inputs.length}`);
  assert.equal(selects.length, 1, 'expected the provider select');
  assert.equal(options.length, 11, 'expected 11 engines');
  const groups = nodes.filter((node) => node.type === 'optgroup');
  assert.equal(groups.length, 2, 'expected the no-key and keyed groups');
  assert.deepEqual(groups.map((node) => node.props.label), ['免密钥（开箱即用）', '需要 API Key']);
  assert.equal(groups[0].children.length, 6, 'no-key group holds the fan-out plus the 5 keyless engines');
  assert.equal(groups[1].children.length, 5, 'keyed group should hold the 5 API providers');
  const types = inputs.map((node) => node.props.type);
  assert.ok(types.includes('password'), 'the key field should be masked');
  assert.equal(types.filter((type) => type === 'number').length, 3, 'expected three number inputs');
  assert.equal(nodes.filter((node) => node.type === 'button').length, 4, 'save, test, reveal, clear');
});

await check('the ready page marks the configured key and offers to clear it', () => {
  const text = textOf(renderWith(pageState({})));
  assert.match(text, /已配置密钥：abcd…wxyz/);
  assert.match(text, /清除密钥/);
});

await check('a missing key switches the badge and hides the clear button', () => {
  const view = { ...View, hasApiKey: false, apiKeyPreview: '' };
  const tree = renderWith(pageState({ view }));
  assert.match(textOf(tree), /尚未配置密钥/);
  const buttons = walk(tree).filter((node) => node.type === 'button');
  assert.equal(buttons.length, 3, 'save, test, reveal only');
});

await check('a pristine form disables save and hides discard', () => {
  const tree = renderWith(pageState({}));
  const buttons = walk(tree).filter((node) => node.type === 'button');
  const save = buttons.find((node) => textOf(node) === '保存');
  assert.ok(save !== undefined, 'no save button');
  assert.equal(save.props.disabled, true, 'save must be disabled with no changes');
  assert.ok(!buttons.some((node) => textOf(node).includes('放弃修改')), 'discard rendered with no changes');
});

await check('a no-key engine disables the key field and explains why', () => {
  const { pick } = exports.__test;
  const view = { ...View, provider: 'duckduckgo', hasApiKey: false, apiKeyPreview: '' };
  const tree = renderWith(pageState({ view, draft: pick(view), saved: pick(view) }));
  const text = textOf(tree);
  assert.match(text, /这个引擎不需要密钥/);
  assert.match(text, /结果来自该引擎的公开网页/);
  const keyInput = walk(tree).find((node) => node.type === 'input' && node.props.type === 'password');
  assert.ok(keyInput !== undefined, 'no key input');
  assert.equal(keyInput.props.disabled, true, 'the key field stayed editable for a no-key engine');
  const buttons = walk(tree).filter((node) => node.type === 'button');
  const reveal = buttons.find((node) => textOf(node) === '显示');
  assert.equal(reveal.props.disabled, true, 'the reveal button stayed enabled');
  assert.ok(!buttons.some((node) => textOf(node).includes('清除密钥')), 'clear was offered with no key');
});

await check('an API provider re-enables the key field', () => {
  const tree = renderWith(pageState({}));
  const keyInput = walk(tree).find((node) => node.type === 'input' && node.props.type === 'password');
  assert.equal(keyInput.props.disabled, false, 'the key field is disabled for an API provider');
});

await check('an edited form enables save and shows discard', () => {
  const { pick } = exports.__test;
  const view = { ...View };
  const draft = pick(view);
  draft.maxResults = '3';
  const tree = renderWith(pageState({ view, draft }));
  const buttons = walk(tree).filter((node) => node.type === 'button');
  const save = buttons.find((node) => textOf(node) === '保存');
  assert.ok(save !== undefined, 'no save button');
  assert.equal(save.props.disabled, false, 'save stayed disabled after an edit');
  assert.ok(buttons.some((node) => textOf(node).includes('放弃修改')), 'discard missing after an edit');
  assert.match(textOf(tree), /有未保存的修改/);
});

await check('the page tells the user how to verify and offers a real test', () => {
  const text = textOf(renderWith(pageState({})));
  assert.match(text, /验证是否可用/);
  assert.match(text, /测试连接/);
  assert.match(text, /搜索一下今天的科技新闻/);
});

await check('a successful probe reports the provider, count and elapsed time', () => {
  const probe = {
    ok: true,
    provider: 'brave',
    providerLabel: 'Brave Search',
    count: 3,
    elapsedMs: 412,
    sources: [{ url: 'https://a/1', title: 'A' }, { url: 'https://b/2', title: 'B' }],
  };
  const text = textOf(renderWith(pageState({ probe })));
  assert.match(text, /搜索可用 · Brave Search · 3 条来源 · 412ms/);
  assert.match(text, /1\. A/);
});

await check('a failed probe prints the provider error verbatim', () => {
  const probe = { ok: false, elapsedMs: 90, error: 'Brave Search 返回 HTTP 401。\n响应片段：unauthorized' };
  const text = textOf(renderWith(pageState({ probe })));
  assert.match(text, /搜索失败 · 90ms/);
  assert.match(text, /HTTP 401/);
});

await check('an unreadable settings file is surfaced as a warning', () => {
  const view = { ...View, problem: 'unexpected token' };
  const tree = renderWith(pageState({ view, notice: { tone: 'warn', text: t('problem') } }));
  assert.match(textOf(tree), /设置文件读取失败/);
});

// --- pure helpers ----------------------------------------------------------

const { pick, submitted, changesBetween, wholeNumber, providerOf, callApi } = exports.__test;

await check('wholeNumber enforces its range and rejects junk', () => {
  assert.equal(wholeNumber('8', 1, 50), 8);
  assert.equal(wholeNumber(' 8 ', 1, 50), 8);
  assert.equal(wholeNumber('0', 1, 50), undefined);
  assert.equal(wholeNumber('51', 1, 50), undefined);
  assert.equal(wholeNumber('8.5', 1, 50), undefined);
  assert.equal(wholeNumber('', 1, 50), undefined);
  assert.equal(wholeNumber('abc', 1, 50), undefined);
});

await check('pick always leaves the key field empty', () => {
  const draft = pick({ ...View, apiKey: 'must-not-appear' });
  assert.equal(draft.apiKey, '');
  assert.equal(draft.provider, 'brave');
  assert.equal(draft.maxResults, '8', 'numbers are strings while editing');
});

await check('an untouched form yields no writes, a single edit yields one', () => {
  const baseline = submitted(pick(View));
  assert.deepEqual(changesBetween(baseline, baseline), [], 'unchanged form produced writes');
  const edited = submitted(pick({ ...View, maxResults: 3 }));
  assert.deepEqual(changesBetween(edited, baseline), ['maxResults']);
  const both = submitted(pick({ ...View, provider: 'serper', enableFetch: false }));
  assert.deepEqual(changesBetween(both, baseline), ['provider', 'enableFetch']);
});

await check('an out-of-range number makes the whole draft unwritable', () => {
  const draft = pick(View);
  assert.equal(submitted({ ...draft, maxResults: '999' }), undefined);
  assert.equal(submitted({ ...draft, timeoutMs: '' }), undefined);
  assert.equal(submitted({ ...draft, fetchMaxChars: '0' }), undefined);
});

await check('an unknown provider id falls back to a real entry', () => {
  assert.equal(providerOf('nope').id, 'all', 'unknown ids fall back to the fan-out');
  assert.equal(providerOf('searxng').needsKey, false);
  assert.equal(providerOf('baidu').needsKey, false);
  assert.equal(providerOf('tavily').needsKey, true);
  assert.equal(providerOf('all').mode, 'fanout');
  for (const item of exports.__test.PROVIDERS) {
    // The fan-out is not a site, so it has no page to link to.
    if (item.mode === 'fanout') {
      assert.equal(item.docs, '', `${item.id} should not carry a docs URL`);
      continue;
    }
    assert.match(item.docs, /^https:\/\//, `${item.id} has no docs URL`);
  }
});

await check('callApi targets the plugin route and surfaces a JSON error', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'cross-origin request refused' }),
    };
  };
  await assert.rejects(() => callApi('/settings', {}), /cross-origin request refused/);
  assert.equal(seen[0].url, '/api/web-search-pro/settings');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.credentials, 'same-origin');

  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ settings: { provider: 'exa' } }) };
  };
  const payload = await callApi('/settings');
  assert.equal(payload.settings.provider, 'exa');
  assert.equal(seen[1].init.method, 'GET');
  assert.equal(seen[1].init.body, undefined);
});

console.log(results.join('\n'));
console.log(`\n${results.filter((line) => line.startsWith('ok')).length}/${results.length} checks passed`);
