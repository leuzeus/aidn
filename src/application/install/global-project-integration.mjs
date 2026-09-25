import path from 'node:path';
import { resolveGlobalRuntime, resolveGlobalRecoveryRuntime, GLOBAL_INTEGRATION_REVISION } from './global-runtime-store.mjs';
import { assertGlobalSkillsEnabled } from './global-skills-migration-service.mjs';

function verifySkills(runtime) {
  const groups = new Map();
  for (const asset of runtime.state.assets ?? []) if (asset.path.endsWith(`${path.sep}SKILL.md`)) {
    const home = path.dirname(path.dirname(path.dirname(asset.path)));
    if (!groups.has(home)) groups.set(home, []);
    groups.get(home).push(asset.path);
  }
  for (const [home, files] of groups) assertGlobalSkillsEnabled(home, files);
}

export function resolveGlobalProjectBinding(binding, { recoveryPlanId } = {}) {
  if (!binding || binding.schema_version !== 1 || !path.isAbsolute(binding.home ?? '')
      || typeof binding.installation_id !== 'string' || binding.integration_revision !== GLOBAL_INTEGRATION_REVISION) throw new Error('GLOBAL_PROJECT_BINDING_INVALID');
  const runtime = recoveryPlanId
    ? resolveGlobalRecoveryRuntime({ home: binding.home, expectedPlanId: recoveryPlanId })
    : resolveGlobalRuntime({ home: binding.home, installationId: binding.installation_id, integrationRevision: binding.integration_revision });
  if (runtime.state.installation_id !== binding.installation_id) throw new Error('GLOBAL_INSTALLATION_MISMATCH');
  verifySkills(runtime);
  return runtime;
}

export function globalProjectBinding(home, packageRoot) {
  const runtime = resolveGlobalRuntime({ home });
  verifySkills(runtime);
  if (path.resolve(packageRoot) !== path.resolve(runtime.packageRoot)) throw new Error('GLOBAL_PROJECT_EXECUTOR_MISMATCH');
  return { schema_version: 1, home: runtime.home, installation_id: runtime.state.installation_id, integration_revision: GLOBAL_INTEGRATION_REVISION };
}

// Only the project root and hook event are local. All hook behavior lives in the
// verified global package and still checks local activation and request scope.
export function globalHookConnector(event) {
  if (!['session-start', 'pre-tool-use'].includes(event)) throw new Error('GLOBAL_HOOK_EVENT_INVALID');
  return `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
try {
  const home = process.env.AIDN_HOME;
  if (!home || !path.isAbsolute(home)) throw new Error('GLOBAL_HOME_REQUIRED');
  const child = spawnSync(process.execPath, [path.join(home, 'bin/global-launcher.mjs'), '--integration-revision', '${GLOBAL_INTEGRATION_REVISION}', '__aidn-hook', '${event}', '--target', root], { stdio: 'inherit', shell: false, windowsHide: true });
  process.exitCode = child.status ?? 2;
} catch { process.stderr.write('AIDN global hook unavailable; diagnose the global installation.\\n'); process.exitCode = 2; }
`;
}

export function renderGlobalCommands(text) {
  return text.replace(/\bnpx aidn\b/g, 'aidn')
    .replace(/\baidn (?=(?:runtime|bootstrap|codex|project|perf|install)\b)/g, `aidn --integration-revision ${GLOBAL_INTEGRATION_REVISION} `);
}

export function adaptGlobalProjectAssets(desired) {
  for (const name of desired.keys()) if (name.startsWith('.agents/skills/') || name.startsWith('.codex/agents/')
      || name === '.codex/hooks/aidn-hook-runtime.mjs') desired.delete(name);
  for (const event of ['session-start', 'pre-tool-use']) desired.set(`.codex/hooks/aidn-${event}.mjs`, {
    kind: 'file', data: Buffer.from(globalHookConnector(event)).toString('base64'),
  });
  const agents = desired.get('AGENTS.md');
  if (agents) agents.data = Buffer.from(renderGlobalCommands(Buffer.from(agents.data, 'base64').toString('utf8'))).toString('base64');
  return desired;
}
