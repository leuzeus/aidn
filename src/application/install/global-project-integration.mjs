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

// The local connector only transports bounded native replies. Admission policy
// lives in the verified global package and checks activation and request scope.
export function globalHookConnector(event) {
  if (!['session-start', 'pre-tool-use'].includes(event)) throw new Error('GLOBAL_HOOK_EVENT_INVALID');
  return `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const event = '${event === 'pre-tool-use' ? 'PreToolUse' : 'SessionStart'}';
const reason = 'AIDN global hook unavailable; diagnose the global installation before editing.';
const unavailable = () => ({ hookSpecificOutput: event === 'PreToolUse'
  ? { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason }
  : { hookEventName: event, additionalContext: 'AIDN resume is degraded; remain read-only. ' + reason } });
function decode(text) {
  const reply = JSON.parse(text);
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('INVALID_REPLY');
  if (Object.keys(reply).length === 0) return reply;
  const value = reply.hookSpecificOutput;
  if (Object.keys(reply).length !== 1 || !value || typeof value !== 'object' || Array.isArray(value)
      || value.hookEventName !== event) throw new Error('INVALID_REPLY');
  const keys = event === 'PreToolUse'
    ? ['hookEventName', 'additionalContext', 'permissionDecision', 'permissionDecisionReason']
    : ['hookEventName', 'additionalContext'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('INVALID_REPLY');
  if (value.permissionDecision !== undefined) {
    if (value.permissionDecision !== 'deny' || typeof value.permissionDecisionReason !== 'string'
        || !value.permissionDecisionReason.trim()) throw new Error('INVALID_REPLY');
  } else if (typeof value.additionalContext !== 'string' || !value.additionalContext.trim()
      || value.permissionDecisionReason !== undefined) throw new Error('INVALID_REPLY');
  if (value.additionalContext !== undefined && typeof value.additionalContext !== 'string') throw new Error('INVALID_REPLY');
  return reply;
}
let reply;
try {
  const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
  const home = process.env.AIDN_HOME;
  if (!home || !path.isAbsolute(home)) throw new Error('GLOBAL_HOME_REQUIRED');
  reply = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(home, 'bin/global-launcher.mjs'), '--integration-revision', '${GLOBAL_INTEGRATION_REVISION}', '__aidn-hook', '${event}', '--target', root], { stdio: ['inherit', 'pipe', 'ignore'], shell: false, windowsHide: true });
    const chunks = []; let size = 0, settled = false;
    const finish = (result, stop = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.stdout.destroy();
      if (stop) { try { child.kill(); } catch {} }
      child.unref(); resolve(result);
    };
    // Complete before the shipped 10-second native hook timeout. A terminated
    // launcher can retain a lease; never remove it or infer descendant death.
    const timer = setTimeout(() => finish(unavailable(), true), 8000);
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 65536) finish(unavailable(), true);
      else chunks.push(bytes);
    });
    child.once('error', () => finish(unavailable(), true));
    child.stdout.once('error', () => finish(unavailable(), true));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal) { finish(unavailable()); return; }
      try { finish(decode(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(unavailable()); }
    });
  });
} catch { reply = unavailable(); }
// Native clients may continue after an ordinary process error. Emit exactly one
// protocol reply with exit 0, and never expose raw child output on failure.
process.stdout.write(JSON.stringify(reply) + '\\n');
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
