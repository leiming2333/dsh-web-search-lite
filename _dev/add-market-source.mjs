// Registers this package's plugin-market index with a DSH profile.
//
// The Discover tab reads the index URLs configured on the `plugin-market` row. This
// writes that row into the profile's patch layer, so a profile rebuilt by a DSH
// reinstall can be pointed back at the index with one command.
//
//   node _dev/add-market-source.mjs              # desktop profile
//   node _dev/add-market-source.mjs --profile web
//   node _dev/add-market-source.mjs --remove
//   node _dev/add-market-source.mjs --dry-run
//
// Only that one row is rewritten. Every other entry in the patch layer is left
// byte-for-byte alone, and the file is backed up before the write.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const remove = argv.includes('--remove');
const profileArg = argv.indexOf('--profile');
const profile = profileArg >= 0 ? argv[profileArg + 1] : 'desktop';

/**
 * Index URL jsDelivr serves from this repository's `market/` directory.
 *
 * Pinned to a commit rather than `@main`: jsDelivr caches a branch reference for
 * hours and `purge` is rate-limited, so `@main` keeps answering with an older index
 * long after the push — and an older index can name a version that was withdrawn.
 * A commit reference has no such cache. Re-run this script after changing the index.
 *
 * The owner/repo half comes from the manifest, so renaming the repository is a
 * link-only change.
 */
const INDEX_URL = (() => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const raw = manifest.repository?.url ?? '';
  const match = /github\.com[:/]([^/]+)\/([^/#.]+)/i.exec(raw);
  if (match === null) {
    throw new Error(`package.json 的 repository.url 里读不出 GitHub 仓库：${raw}`);
  }
  const repoRoot = new URL('..', import.meta.url);
  const sha = execFileSync('git', ['-C', repoRoot.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  // fastly.jsdelivr.net rather than cdn.jsdelivr.net: the canonical host does not
  // resolve on every network in CN, while the Fastly mirror serves the same content.
  return `https://fastly.jsdelivr.net/gh/${match[1]}/${match[2]}@${sha}/market/index.json`;
})();

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const profileDir = path.join(home, 'profiles', profile);
const patchPath = path.join(profileDir, 'cordis.patch.yml');

const say = (text = '') => process.stdout.write(`${text}\n`);

if (!fs.existsSync(patchPath)) {
  say(`找不到 ${patchPath}`);
  say('先启动一次 DSH，让 profile 生成出来。');
  process.exit(1);
}

const original = fs.readFileSync(patchPath, 'utf8');
const lines = original.split('\n');

/** The row block for the wanted URLs. */
function blockFor(urls) {
  if (urls.length === 0) return ['- id: plugin-market', '  name: "@deepseek-ai/dsh-plugin-market"'];
  return [
    '- id: plugin-market',
    '  name: "@deepseek-ai/dsh-plugin-market"',
    '  config:',
    '    indexes:',
    ...urls.map((url) => `      - ${url}`),
  ];
}

const wanted = remove ? [] : [INDEX_URL];
const start = lines.findIndex((line) => /^- id:\s*plugin-market\s*$/.test(line));

let next;
if (start < 0) {
  if (remove) {
    say('patch 里没有 plugin-market 行，无需移除');
    process.exit(0);
  }
  next = `${original.trimEnd()}\n\n${blockFor(wanted).join('\n')}\n`;
} else {
  // A top-level row runs until the next top-level `- ` item.
  let end = start + 1;
  while (end < lines.length && !/^- /.test(lines[end])) end += 1;
  next = [...lines.slice(0, start), ...blockFor(wanted), ...lines.slice(end)].join('\n');
}

if (next === original) {
  say('patch 已是目标状态，无需改动');
  process.exit(0);
}

say(`profile：  ${profileDir}`);
say(remove ? '移除索引源' : '索引源：');
say(`  ${INDEX_URL}`);

if (dryRun) {
  say('');
  say('（--dry-run，未写入）改动后的这一段：');
  const check = next.split('\n');
  const at = check.findIndex((line) => /^- id:\s*plugin-market\s*$/.test(line));
  say(check.slice(Math.max(0, at), at + 7).join('\n'));
  process.exit(0);
}

const backup = `${patchPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(patchPath, backup);
fs.writeFileSync(patchPath, next);
say('');
say(`已备份：  ${path.basename(backup)}`);
say('完成。重启 DeepSeek Harness，然后打开 插件 → 发现。');
