#!/usr/bin/env node
// Copied beside the stable launcher support files by the global installer.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquireGlobalRuntime, resolveGlobalRuntime, resolveGlobalRecoveryRuntime } from './global-runtime-store.mjs';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let lease;
let interrupted = false;
try {
  let revision;
  const at = args.indexOf('--integration-revision');
  if (at >= 0) {
    if (args.lastIndexOf('--integration-revision') !== at || !/^[1-9]\d*$/.test(args[at + 1] ?? '')) throw new Error('GLOBAL_INVALID_INTEGRATION_REVISION');
    revision = Number(args[at + 1]);
    args.splice(at, 2);
  }
  // Management commands own the admission barrier themselves; otherwise their
  // own lease would prevent the switch they are meant to perform.
  const management = ['setup', 'update', 'rollback'].includes(args[0]);
  const resume = ['update', 'rollback'].includes(args[0]) && args.includes('--resume');
  const recover = args[0] === 'update' && args.includes('--recover-locks') && fs.existsSync(path.join(home, 'pending.json'));
  const resolved = recover ? resolveGlobalRecoveryRuntime({ home })
    : resume ? resolveGlobalRecoveryRuntime({ home, expectedPlanId: args.includes('--expect-plan') ? args[args.indexOf('--expect-plan') + 1] : undefined })
    : management ? resolveGlobalRuntime({ home, integrationRevision: revision })
      : (lease = acquireGlobalRuntime({ home, integrationRevision: revision }));
  let entry = resolved.entry, childArgs = args, hookRoot;
  if (args[0] === '__aidn-hook') {
    if (args.length !== 4 || !['session-start', 'pre-tool-use'].includes(args[1]) || args[2] !== '--target'
        || !path.isAbsolute(args[3]) || revision === undefined) throw new Error('GLOBAL_HOOK_ARGUMENTS_INVALID');
    hookRoot = args[3];
    entry = path.join(resolved.packageRoot, 'scaffold', 'codex_hooks', 'scripts', `aidn-${args[1]}.mjs`);
    childArgs = [];
  }
  const child = spawn(process.execPath, [entry, ...childArgs], {
    stdio: 'inherit', shell: false, windowsHide: true,
    env: { ...process.env, AIDN_HOME: home, AIDN_GLOBAL_GENERATION: resolved.state.active.id,
      AIDN_GLOBAL_INSTALLATION: resolved.state.installation_id, AIDN_GLOBAL_PACKAGE_ROOT: resolved.packageRoot,
      AIDN_HOOK_PROJECT_ROOT: hookRoot ?? '' },
  });
  // A killed dispatcher may have descendants. Retain the lease on interruption
  // until explicit recovery proves those operations ended; PID death alone is
  // not enough to switch the engine safely on Windows.
  const stop = () => { interrupted = true; child.kill('SIGTERM'); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); resolve(); });
  });
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
} catch (error) {
  process.stderr.write(`${/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'GLOBAL_LAUNCH_FAILED'}\n`);
  process.exitCode = 2;
} finally { if (!interrupted) lease?.release(); }
