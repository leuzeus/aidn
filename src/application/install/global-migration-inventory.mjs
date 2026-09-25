// A cleanup inventory is evidence, not authority to delete by directory name.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkedHostPath } from './global-runtime-store.mjs';
import { renderGlobalCommands } from './global-project-integration.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const fail = code => { throw new Error(code); };
const start = '<!-- CODEX-AUDIT-WORKFLOW START -->';
const end = '<!-- CODEX-AUDIT-WORKFLOW END -->';

function local(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':')
      || relative.split('/').some(part => !part || part === '.' || part === '..')) fail('MIGRATION_UNSAFE_PATH');
  return checkedHostPath(path.join(root, ...relative.split('/')));
}
function content(root, name) {
  const file = local(root, name);
  try { return fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function readReceipt(root) {
  const raw = content(root, '.aidn/install/receipt.json');
  if (!raw) fail('MIGRATION_RECEIPT_REQUIRED');
  const { integrity_sha256, ...receipt } = JSON.parse(raw);
  if (integrity_sha256 !== hash(stable(receipt)) || receipt.schema_version !== 1
      || receipt.scope !== 'codex-integration' || !object(receipt.assets)) fail('MIGRATION_RECEIPT_INVALID');
  const canonical = fs.realpathSync(root);
  if (receipt.root_id !== hash(process.platform === 'win32' ? canonical.toLowerCase() : canonical)) fail('MIGRATION_RECEIPT_ROOT_MISMATCH');
  return receipt;
}

export function inventoryGlobalMigration({ targetRoot, globalSkillsVerified = false, globalAgentsVerified = false }) {
  const root = fs.realpathSync(checkedHostPath(path.resolve(targetRoot)));
  if (content(root, '.aidn/install/pending.json')) fail('MIGRATION_INSTALLATION_INTERRUPTED');
  const receipt = readReceipt(root);
  const entries = [];
  const files = new Set(Object.keys(receipt.assets));
  const directories = [];
  function walk(relative) {
    const directory = local(root, relative);
    if (!fs.existsSync(directory)) return;
    const children = fs.readdirSync(directory, { withFileTypes: true });
    if (!children.length) directories.push(relative);
    for (const entry of children) {
      const next = `${relative}/${entry.name}`;
      local(root, next);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) files.add(next);
      else fail('MIGRATION_UNSAFE_PATH');
    }
  }
  for (const directory of ['.agents/skills', '.codex/agents', '.codex/hooks', '.codex/skills']) walk(directory);
  for (const relative of [...files].sort()) {
    const raw = content(root, relative), owned = receipt.assets[relative];
    let action = 'keep', reason = 'unmanaged';
    if (owned && raw === null) { action = 'conflict'; reason = 'managed-file-missing'; }
    else if (owned?.kind === 'file') {
      if (typeof owned.current !== 'string' || raw.toString('base64') !== owned.current) { action = 'conflict'; reason = 'managed-file-modified'; }
      else if (relative.startsWith('.agents/skills/') || relative.startsWith('.codex/skills/')) {
        action = globalSkillsVerified ? 'remove' : 'conflict';
        reason = globalSkillsVerified ? 'managed-local-skill-replaced' : 'global-skills-not-verified';
      } else if (relative.startsWith('.codex/agents/')) {
        action = globalAgentsVerified ? 'remove' : 'conflict';
        reason = globalAgentsVerified ? 'managed-local-agent-replaced' : 'global-agents-not-verified';
      } else if (relative.startsWith('.codex/hooks/')) { action = 'replace'; reason = 'global-hook-connector-required'; }
      else { action = 'keep'; reason = 'project-owned-integration'; }
    } else if (owned?.kind === 'agents-block') {
      const text = raw.toString('utf8');
      const valid = text.split(start).length === 2 && text.split(end).length === 2
        && text.indexOf(end) > text.indexOf(start)
        && text.slice(text.indexOf(start), text.indexOf(end) + end.length) === owned.current;
      action = valid ? 'replace' : 'conflict'; reason = valid ? 'managed-agents-block-only' : 'managed-agents-block-modified';
    } else if (owned?.kind === 'hooks') {
      const configuration = JSON.parse(raw);
      const tokens = [];
      for (const [event, groups] of Object.entries(configuration.hooks ?? {})) {
        if (!Array.isArray(groups)) fail('MIGRATION_HOOKS_INVALID');
        for (const { hooks, ...group } of groups) {
          if (!Array.isArray(hooks)) fail('MIGRATION_HOOKS_INVALID');
          for (const hook of hooks) tokens.push({ event, group, hook });
        }
      }
      const valid = Array.isArray(owned.current) && owned.current.every(item => tokens.filter(token => token.event === item.event
        && stable(token.hook) === stable(item.hook) && Object.entries(item.group).every(([key, value]) => stable(token.group[key]) === stable(value))).length === 1);
      action = valid ? 'replace' : 'conflict'; reason = valid ? 'managed-hook-entries-only' : 'managed-hook-entries-modified';
    } else if (owned) { action = 'conflict'; reason = 'unknown-receipt-asset-kind'; }
    entries.push({ path: relative, action, reason, sha256: raw ? hash(raw) : null });
  }
  // Empty legacy directories have no content to lose. Never remove their parents
  // recursively: a subsequent writer may have added an unrelated file.
  for (const directory of directories.sort()) entries.push({ path: directory, action: 'remove-empty-directory', reason: 'empty', sha256: null });
  for (const relative of ['docs/audit/WORKFLOW.md', 'docs/audit/WORKFLOW_SUMMARY.md', 'docs/audit/CODEX_ONLINE.md', 'docs/audit/index.md']) {
    const raw = content(root, relative);
    if (!raw || renderGlobalCommands(raw.toString('utf8')) === raw.toString('utf8')) continue;
    const owned = receipt.installation?.assets?.[relative];
    const recognized = ['local-file', 'seed-file'].includes(owned?.kind);
    const exact = recognized && raw.toString('base64') === owned.current;
    entries.push({ path: relative, action: exact ? 'replace' : recognized ? 'conflict' : 'keep',
      reason: exact ? 'managed-operational-commands' : recognized ? 'managed-operational-document-modified' : 'unmanaged-operational-reference', sha256: hash(raw) });
  }
  for (const name of ['package.json', 'package-lock.json']) {
    const raw = content(root, name);
    if (!raw) continue;
    const data = JSON.parse(raw);
    const hasAidn = name === 'package.json'
      ? ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(key => Object.hasOwn(data[key] ?? {}, 'aidn-workflow'))
      : Object.hasOwn(data.packages ?? {}, 'node_modules/aidn-workflow');
    entries.push({ path: name, action: hasAidn ? 'replace' : 'keep', reason: hasAidn ? 'npm-remove-aidn-only' : 'no-local-aidn-dependency', sha256: hash(raw) });
  }
  const privateFiles = ['.aidn/config.json', '.aidn/project/workflow.adapter.json', '.aidn/install/receipt.json'];
  const fingerprints = privateFiles.map(name => [name, hash(content(root, name) ?? Buffer.alloc(0))]);
  const plan = { schema_version: 1, target: root, entries, conflicts: entries.filter(item => item.action === 'conflict'),
    preserved: ['project-configuration', 'connection-references', 'workflow-data', 'historical-documents', 'unmanaged-files'], fingerprints };
  return { ...plan, plan_id: hash(stable(plan)) };
}
