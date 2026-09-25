import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readProjects } from './project-registry.mjs';
import { checkedHostPath } from '../../src/application/install/global-runtime-store.mjs';

export function preflightGlobalProjects({ home, candidateRoot, globalRecoveryPlanId }, { env = process.env, run = spawnSync } = {}) {
  const registry = readProjects(home);
  const worker = checkedHostPath(path.join(candidateRoot, 'tools/setup/global-compatibility-worker.mjs'));
  if (!fs.existsSync(worker)) throw new Error('GLOBAL_CANDIDATE_PROTOCOL_UNSUPPORTED');
  const rows = [];
  for (const entry of registry.projects) {
    let result;
    try {
      checkedHostPath(entry.path);
      if (!fs.statSync(entry.path).isDirectory()) throw new Error('GLOBAL_PROJECT_UNAVAILABLE');
      const config = JSON.parse(fs.readFileSync(checkedHostPath(path.join(entry.path, '.aidn/config.json')), 'utf8'));
      const ref = config.runtime?.persistence?.connectionRef;
      const runtimeEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^AIDN_/i.test(key)));
      if (typeof ref === 'string' && /^env:[A-Za-z_][A-Za-z0-9_]*$/.test(ref) && env[ref.slice(4)] !== undefined) runtimeEnv[ref.slice(4)] = env[ref.slice(4)];
      const child = run(process.execPath, [worker, entry.path, ...(globalRecoveryPlanId ? [globalRecoveryPlanId] : [])], { env: runtimeEnv, cwd: entry.path,
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
      if (child.status !== 0 || child.error) {
        const code = String(child.stderr ?? '').trim();
        throw new Error(/^GLOBAL_[A-Z0-9_]+$/.test(code) ? code : 'GLOBAL_PROJECT_CHECK_FAILED');
      }
      result = JSON.parse(child.stdout);
      if (result.compatible !== true || !/^[a-f0-9]{64}$/.test(result.fingerprint ?? '')) throw new Error('GLOBAL_PROJECT_CHECK_INVALID');
    } catch (error) {
      result = { compatible: false, error: /^GLOBAL_[A-Z0-9_]+$/.test(error.message) ? error.message : 'GLOBAL_PROJECT_UNAVAILABLE' };
    }
    rows.push({ id: entry.id, path: entry.path, ...result });
  }
  if (JSON.stringify(readProjects(home)) !== JSON.stringify(registry)) throw new Error('GLOBAL_REGISTRY_CHANGED');
  return { compatible: rows.every(row => row.compatible), projects: rows,
    registry_fingerprint: createHash('sha256').update(JSON.stringify(registry)).digest('hex') };
}
