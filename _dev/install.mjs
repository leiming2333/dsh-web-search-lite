// Installs dsh-web-search-lite into a DSH profile.
//
// What it touches, in order, each reversible:
//   1. <profile>/plugins/dsh-web-search-lite       the source copy a `file:` dep points at
//   2. <profile>/node_modules/dsh-web-search-lite  the copy Node resolves at runtime
//   3. <profile>/package.json                     dependencies + dsh.profile.bundles
//
// It never edits cordis.patch.yml: the bundle carries its own patch, and the
// profile's patch layer belongs to the user.
//
//   node _dev/install.mjs --dry-run
//   node _dev/install.mjs
//   node _dev/install.mjs --uninstall

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The repository root *is* the package: package.json, index.js, client.js and the
// bundle patch live beside this `_dev` folder, and `_dev` is not part of a delivery.
const source = path.join(here, '..');
const NAME = 'dsh-web-search-lite';

/** Names that never belong in an installed copy. */
const SKIP = new Set(['node_modules', '_dev', 'package-lock.json', 'pnpm-lock.yaml']);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const uninstall = argv.includes('--uninstall');
const profileName = valueOf('--profile') ?? 'desktop';
const dshHome = valueOf('--dsh-home') ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');

function valueOf(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : undefined;
}

const profileDir = path.join(dshHome, 'profiles', profileName);
const manifestPath = path.join(profileDir, 'package.json');
const pluginSourceDir = path.join(profileDir, 'plugins', NAME);
const pluginRuntimeDir = path.join(profileDir, 'node_modules', NAME);

const say = (line) => process.stdout.write(`${dryRun ? '[dry-run] ' : ''}${line}\n`);

if (!fs.existsSync(manifestPath)) {
  process.stderr.write(
    `找不到 profile：${manifestPath}\n` +
      `用 --profile <name> 或 --dsh-home <dir> 指定。当前可用的 profile：\n` +
      listProfiles(),
  );
  process.exit(1);
}

/** List the profile directories that exist, to make a typo self-correcting. */
function listProfiles() {
  const root = path.join(dshHome, 'profiles');
  if (!fs.existsSync(root)) return '  (没有任何 profile)';
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `  - ${entry.name}`)
    .join('\n');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const before = JSON.stringify(manifest, null, 2);

if (uninstall) {
  delete manifest.dependencies?.[NAME];
  const bundles = manifest.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) {
    manifest.dsh.profile.bundles = bundles.filter((entry) => entry !== NAME);
  }
  backup(manifestPath);
  if (!dryRun) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  say(`已从 dependencies 与 dsh.profile.bundles 移除 ${NAME}`);
  removeDir(pluginRuntimeDir);
  removeDir(pluginSourceDir);
  say('目录已删除。重启 DeepSeek Harness 后插件不再加载。');
  process.exit(0);
}

// --- 1. copy the package ---------------------------------------------------

say(`源：      ${source}`);
say(`profile： ${profileDir}`);

if (!fs.existsSync(path.join(source, 'package.json'))) {
  process.stderr.write(`源目录不像一个包（没有 package.json）：${source}\n`);
  process.exit(1);
}

for (const target of [pluginSourceDir, pluginRuntimeDir]) {
  say(`复制到：  ${target}`);
  if (!dryRun) {
    // A leftover node_modules of stubs would shadow the real Harness packages, so
    // the copy is filtered to the files the manifest declares.
    fs.rmSync(target, { recursive: true, force: true });
    copyDir(source, target);
  }
}

// --- 2. register the bundle ------------------------------------------------

manifest.dependencies ??= {};
manifest.dependencies[NAME] = `file:plugins/${NAME}`;

manifest.dsh ??= {};
manifest.dsh.profile ??= {};
manifest.dsh.profile.bundles ??= [];
const bundles = manifest.dsh.profile.bundles;
// Order matters only among bundles that patch the same row; appending keeps the
// existing layer order intact.
if (!bundles.includes(NAME)) bundles.push(NAME);

if (JSON.stringify(manifest, null, 2) === before) {
  say('package.json 无需改动（已是目标状态）');
} else {
  backup(manifestPath);
  say('package.json 更新：');
  say(`  dependencies.${NAME} = file:plugins/${NAME}`);
  say(`  dsh.profile.bundles += ${NAME}`);
  if (!dryRun) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

// --- 3. undo what 1.2.0 and earlier did to someone else's config ------------

/**
 * Point `web.searchProvider` back at the shipped route if an older version left it
 * on ours.
 *
 * Versions up to 1.2.0 registered a `web-search-pro` search provider and rewrote
 * this field through `ctx.settings.mutate` when the user turned the official route
 * off. 1.3.0 drops that capability, so a leftover `web-search-pro` would name a
 * provider nothing registers — and the built-in `web_search` would fail with
 * `WEB_PROVIDER_CONFIGURED_MISSING` instead of searching.
 *
 * Only that exact value is touched. Anything else in the user's patch layer is
 * theirs, including a deliberate choice of another provider.
 */
function restoreShippedSearchProvider() {
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(patchPath)) return;
  const text = fs.readFileSync(patchPath, 'utf8');
  if (!/searchProvider:\s*web-search-pro\b/.test(text)) return;
  say('');
  say('发现旧版本留下的 web.searchProvider = web-search-pro（1.3.0 不再注册该提供方）：');
  backup(patchPath);
  if (!dryRun) {
    fs.writeFileSync(
      patchPath,
      text.replace(/(searchProvider:\s*)web-search-pro\b/g, '$1deepseek-official'),
    );
  }
  say('  已改回 deepseek-official，内置 web_search 恢复官方路由');
}

restoreShippedSearchProvider();

say('');
say('完成。重启 DeepSeek Harness 生效，然后打开 设置 → 网络搜索。');
say('免密钥引擎（DuckDuckGo / Bing 网页 / 百度 / 360）默认即可用；想更稳可以再填一家 API Key。');
say('回滚：node _dev/install.mjs --uninstall');

/** Copy a directory tree, skipping anything that is not a delivery file. */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.') || entry.name.includes('.bak-')) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/** Keep one timestamped copy of a file before the first write of this run. */
function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.bak-${stamp}`;
  if (dryRun) {
    say(`会备份：  ${path.basename(target)}`);
    return;
  }
  fs.copyFileSync(file, target);
  say(`已备份：  ${path.basename(target)}`);
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  say(`删除：    ${dir}`);
  if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
}
