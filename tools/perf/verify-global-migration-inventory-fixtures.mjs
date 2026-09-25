import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planCodexAssets, executeCodexAssets } from '../../src/application/install/codex-assets-service.mjs';
import { inventoryGlobalMigration } from '../../src/application/install/global-migration-inventory.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-global-inventory-'));
const repoRoot = path.resolve(import.meta.dirname, '../..');
function snapshot() {
  return fs.readdirSync(root, { recursive: true }).sort().map(name => {
    const file = path.join(root, name);
    return [name, fs.statSync(file).isDirectory() ? 'directory' : createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  });
}
try {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Personal policy\nPreserve me.\n');
  const preview = planCodexAssets({ repoRoot, targetRoot: root });
  assert.equal(preview.ok, true, JSON.stringify(preview.errors));
  const installed = executeCodexAssets({ repoRoot, targetRoot: root, dryRun: false, expectedPlanId: preview.plan_id });
  assert.equal(installed.ok, true, JSON.stringify(installed.errors));
  fs.mkdirSync(path.join(root, '.agents/skills/old-empty'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents/skills/personal'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/personal/SKILL.md'), 'personal skill');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { 'aidn-workflow': '0.9.1', other: '1.0.0' } }));
  const before = snapshot();
  const blocked = inventoryGlobalMigration({ targetRoot: root });
  assert(blocked.conflicts.some(item => item.reason === 'global-skills-not-verified'));
  const inventory = inventoryGlobalMigration({ targetRoot: root, globalSkillsVerified: true, globalAgentsVerified: true });
  assert.equal(inventory.conflicts.length, 0);
  const entry = name => inventory.entries.find(item => item.path === name);
  assert.equal(entry('.agents/skills/aidn-context-reload/SKILL.md').action, 'remove');
  assert.equal(entry('.codex/agents/aidn-executor.toml').action, 'remove');
  assert.equal(entry('.agents/skills/personal/SKILL.md').action, 'keep');
  assert.equal(entry('.agents/skills/old-empty').action, 'remove-empty-directory');
  assert.equal(entry('AGENTS.md').reason, 'managed-agents-block-only');
  assert.equal(entry('package.json').reason, 'npm-remove-aidn-only');
  assert.deepEqual(snapshot(), before, 'both previews preserve every byte and directory');
  const skill = path.join(root, '.agents/skills/aidn-context-reload/SKILL.md');
  fs.appendFileSync(skill, '\nPersonal override\n');
  const changed = inventoryGlobalMigration({ targetRoot: root, globalSkillsVerified: true, globalAgentsVerified: true });
  assert(changed.conflicts.some(item => item.path === '.agents/skills/aidn-context-reload/SKILL.md'));
  assert.notEqual(changed.plan_id, inventory.plan_id);
  assert.match(fs.readFileSync(skill, 'utf8'), /Personal override/);
  fs.writeFileSync(path.join(root, '.aidn/install/pending.json'), '{}');
  assert.throws(() => inventoryGlobalMigration({ targetRoot: root }), /MIGRATION_INSTALLATION_INTERRUPTED/);
  fs.unlinkSync(path.join(root, '.aidn/install/pending.json'));
  fs.appendFileSync(path.join(root, '.aidn/install/receipt.json'), 'broken');
  assert.throws(() => inventoryGlobalMigration({ targetRoot: root }));
  console.log('PASS global migration inventory: managed ownership, unknown/custom preservation, empty legacy directories, exact plan and zero preview writes (fixtures only)');
} finally {
  const absolute = fs.realpathSync(root);
  if (path.dirname(absolute) !== fs.realpathSync(os.tmpdir()) || !path.basename(absolute).startsWith('aidn-global-inventory-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(absolute, { recursive: true, force: true });
}
