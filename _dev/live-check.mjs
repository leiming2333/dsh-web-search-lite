// Live check: one real query per no-key engine, to prove the parsers match the
// pages those engines serve right now. Network access is required and results
// depend on the machine's egress.
//
//   node _dev/live-check.mjs ["查询词"]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-live-'));
process.env.DSH_HOME = home;

const plugin = await import('../index.js');
const { runSearch, normalizeSettings, PROVIDERS } = plugin.__test;

const query = process.argv[2] ?? 'DeepSeek Harness';
const engines = process.argv[3] === 'all' ? ['all'] : ['duckduckgo', 'bingweb', 'baidu', 'so360'];

const settings = normalizeSettings({ maxResults: 5, timeoutMs: 15000 });

for (const id of engines) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const value = await runSearch(query, { provider: id }, settings, controller.signal);
    const elapsed = Date.now() - started;
    const lines = [
      `ok   ${PROVIDERS[id].label.padEnd(12)} ${String(value.sources.length).padStart(2)} 条 · ${elapsed}ms`,
    ];
    for (const item of value.sources.slice(0, 2)) {
      lines.push(`       · ${(item.title ?? '(无标题)').slice(0, 46)}`)
      lines.push(`         ${item.url.slice(0, 90)}`)
      if (item.snippet !== undefined) lines.push(`         ${item.snippet.slice(0, 70)}`)
    }
    console.log(lines.join('\n'));
  } catch (error) {
    const elapsed = Date.now() - started;
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? `超时（${settings.timeoutMs}ms 内无响应）`
      : String(error?.message ?? error).split('\n')[0];
    console.log(`FAIL ${PROVIDERS[id].label.padEnd(12)}        ${elapsed}ms  ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

fs.rmSync(home, { recursive: true, force: true });
