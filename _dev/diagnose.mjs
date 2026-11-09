// Diagnoses why the Settings → Web search page has no data.
//
// Reads the Host half's own mount record (`host-status.json`, written by
// `apply()`), the settings file, and the profile registration. Answers the one
// question a 404 cannot: did the Host half of this plugin ever run?
//
//   node _dev/diagnose.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const stateDir = path.join(home, 'web-search-pro');
const statusFile = path.join(stateDir, 'host-status.json');
const settingsFile = path.join(stateDir, 'settings.json');
const profileDir = path.join(home, 'profiles', 'desktop');

const line = (text = '') => process.stdout.write(`${text}\n`);
const ok = (text) => line(`  ✓ ${text}`);
const bad = (text) => line(`  ✗ ${text}`);
const info = (text) => line(`  · ${text}`);

line(`DSH_HOME: ${home}\n`);

// --- 1. is the bundle even registered? -------------------------------------

line('1. profile 注册');
let registered = false;
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  registered = bundles.includes('dsh-web-search-lite');
  registered ? ok('dsh.profile.bundles 含 dsh-web-search-lite') : bad('dsh.profile.bundles 里没有 dsh-web-search-lite');
  const dep = manifest.dependencies?.['dsh-web-search-lite'];
  dep === undefined ? bad('dependencies 里没有本地引用') : ok(`dependencies: ${dep}`);
} catch (error) {
  bad(`读不到 ${path.join(profileDir, 'package.json')}：${error.message}`);
}

// --- 2. is the package on disk? -------------------------------------------

line('\n2. 包文件');
const packageDir = path.join(profileDir, 'node_modules', 'dsh-web-search-lite');
for (const file of ['package.json', 'index.js', 'client.js', 'cordis.patch.yml']) {
  fs.existsSync(path.join(packageDir, file)) ? ok(file) : bad(`${file} 缺失`);
}
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  info(`包版本 ${manifest.version}`);
} catch {
  // already reported above
}

// --- 3. did the Host half run? --------------------------------------------

line('\n3. 宿主半身是否运行过');
if (!fs.existsSync(statusFile)) {
  bad('没有 host-status.json —— 宿主半身从未加载');
  line('');
  line('  这是 404 的原因：浏览器半身随页面刷新就会重新加载，');
  line('  但宿主进程只在启动时加载一次插件。');
  line('  请「完全退出」DeepSeek Harness（不是关窗口/刷新页面）再打开。');
} else {
  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  } catch (error) {
    bad(`host-status.json 无法解析：${error.message}`);
  }
  if (status !== undefined) {
    // The running Host reports the version it actually mounted; the manifest says
    // what is on disk. A gap means the process is still running older code, which
    // explains any fix that "did not work".
    let onDisk;
    try {
      onDisk = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
    } catch {
      onDisk = undefined;
    }
    info(`宿主运行版本 ${status.version} · pid ${status.pid}`);
    info(`apply 于 ${status.applyStartedAt}（记录更新于 ${status.updatedAt}）`);
    if (onDisk !== undefined && status.version !== onDisk) {
      bad(`磁盘上是 ${onDisk}，宿主还跑着 ${status.version} —— 需要重启才能换上新代码`);
    } else if (onDisk !== undefined) {
      ok(`与磁盘版本一致（${onDisk}）`);
    }
    const tools = status.tools ?? [];
    tools.length === 2 ? ok(`工具已注册：${tools.join(', ')}`) : bad(`工具只注册了：${tools.join(', ') || '（无）'}`);
    if (status.error !== null && status.error !== undefined) bad(`注册错误：${status.error}`);

    if (status.webServer === 'registered') {
      ok(`设置接口已挂载：${status.route}`);
    } else if (status.webServer === 'unavailable') {
      bad('这个组合没有 webServer 服务，设置页没有数据源（搜索工具仍可用）');
    } else if (status.webServer === 'register-failed') {
      bad(`路由注册失败：${status.webServerError}`);
    } else {
      bad(`webServer 状态：${status.webServer}（注入回调可能没有执行）`);
    }

    // --- official/free handoff (1.1.0+) ------------------------------------
    if (status.officialSearch !== undefined) {
      if (status.officialSearchError) {
        bad(`官方/免费接管失败：${status.officialSearchError}`);
      } else if (String(status.officialSearch).startsWith('free:no-web-service')) {
        info('官方搜索接管：这个组合没有 web 服务，内置 web_search 保持原样');
      } else {
        ok(`官方搜索接管：${status.officialSearch}`);
      }
      info(`免密钥提供方：${status.webSearchProvider ?? '（未记录）'}`);
    }
  }
}

// --- 4. settings file ------------------------------------------------------

line('\n4. 设置文件');
if (!fs.existsSync(settingsFile)) {
  info('还没有 settings.json，首次读取用默认值（provider=all，officialSearch=false）');
} else {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    ok(`provider=${settings.provider} maxResults=${settings.maxResults} timeoutMs=${settings.timeoutMs}`);
    info(`apiKey：${settings.apiKey === '' ? '（空）' : '（已配置，不显示）'}`);
  } catch (error) {
    bad(`settings.json 不是合法 JSON：${error.message}`);
  }
}

// --- 5. verdict ------------------------------------------------------------

line('\n结论');
const healthy =
  registered &&
  fs.existsSync(statusFile) &&
  JSON.parse(fs.readFileSync(statusFile, 'utf8')).webServer === 'registered';
if (healthy) {
  line('  宿主状态正常。如果设置页仍显示 404，请确认页面是重启后打开的，');
  line('  并在开发者工具 Network 面板看那条请求的完整 URL 与应用是否同源。');
} else if (!fs.existsSync(statusFile)) {
  line('  重启 DeepSeek Harness（完全退出后重新启动），然后重新运行本脚本。');
} else {
  line('  宿主半身加载了，但设置接口没挂上。把上面第 3 节的内容发出来即可定位。');
}
