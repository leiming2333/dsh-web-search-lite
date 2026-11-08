// Runs both smoke suites for dsh-web-search-pro.
//
// The plugin imports nothing from the DSH installation (see the header of
// index.js for why), so no stubs are needed and nothing is written into the
// package. Each suite isolates its own state: the Host suite points DSH_HOME at a
// temporary directory, the browser suite runs behind a fake module loader.
//
//   node _dev/run-tests.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let failed = false;
for (const suite of ['smoke.mjs', 'client-smoke.mjs']) {
  process.stdout.write(`\n=== ${suite} ===\n`);
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(here, suite)], { encoding: 'utf8' }));
  } catch (error) {
    failed = true;
    process.stdout.write(error.stdout ?? '');
    process.stderr.write(error.stderr ?? '');
  }
}

process.stdout.write(failed ? '\nFAILED\n' : '\nall suites passed\n');
process.exitCode = failed ? 1 : 0;
