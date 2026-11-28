import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { migrateStateMode } from '../../src/application/runtime/state-mode-migration.mjs';
import { normalizeStateMode, resolveConfigStateMode, validateAidnProjectConfig, VALID_STATE_MODES } from '../../src/lib/config/aidn-config-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';
import { resolveEffectiveRuntimePersistence } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import outputSchema from '../../src/core/contracts/cli-output/runtime-mode-migrate.v1.schema.json' with { type: 'json' };

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-retire-')), owned = [], checks = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const repo = fileURLToPath(new URL('../../', import.meta.url));
function fixture(name) {
  const target = path.join(root, name); fs.mkdirSync(path.join(target, '.aidn'), { recursive: true }); owned.push(target);
  fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ version: 1, profile: 'files', runtime: { stateMode: 'files', persistence: { backend: 'sqlite' } } }));
  for (const [name, content] of Object.entries({
    'CURRENT-STATE.md': '# State\nactive_session: S901\nactive_cycle: C901\nmode: COMMITTING\n',
    'sessions/S901.md': '# Session S901\nstate: OPEN\nmode: COMMITTING\nattached_cycles: C901\nsession_branch: S901-work\n',
    'cycles/C901-feature-work/status.md': '# Cycle C901\nstate: OPEN\nsession_owner: S901\nbranch_name: feature/C901-work\n',
    'workflows/history/retained.json': '{"choice":"COMMITTING","signature":"retained-byte-for-byte","events":["assigned","UNKNOWN"]}\n',
  })) { const file = path.join(target, 'docs/audit', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  return target;
}
function bytes(target) {
  const rows = [];
  function walk(directory) { for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name); if (item.isDirectory()) walk(file); else rows.push([path.relative(target, file), sha(fs.readFileSync(file))]);
  } }
  walk(target); return rows.sort((a,b) => a[0].localeCompare(b[0]));
}
try {
  assert.deepEqual([...VALID_STATE_MODES], ['dual', 'db-only']);
  for (const read of [() => normalizeStateMode('FILES'), () => resolveConfigStateMode({ runtime: { stateMode: 'files' } }),
    () => validateAidnProjectConfig({ profile: 'files' })]) assert.throws(read, { code: 'AIDN_FILES_STATE_MODE_RETIRED' });
  checks.push('retired selectors rejected');
  assert.throws(() => resolveConfigStateMode({ runtime: { indexStoreMode: 'file' } }), { code: 'AIDN_FILES_STATE_MODE_RETIRED' });
  for (const mode of ['dual', 'db-only']) {
    const target = fixture(mode), before = bytes(target), dbFile = path.join(target, '.aidn/runtime/index/workflow-index.sqlite');
    assert.throws(() => createStandardWorkflowArtifacts({ targetRoot: target }).describe(), { code: 'AIDN_FILES_STATE_MODE_RETIRED' });
    const preview = await migrateStateMode({ targetRoot: target, to: mode });
    assert.deepEqual(validateJsonSchema(preview, outputSchema), []);
    const publicPreview = spawnSync(process.execPath, [path.join(repo, 'bin/aidn.mjs'), 'runtime', 'mode-migrate', '--target', target, '--to', mode, '--json'],
      { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(publicPreview.status, 0, publicPreview.stderr); assert.equal(JSON.parse(publicPreview.stdout).preview, true);
    assert.throws(() => resolveEffectiveRuntimePersistence({ targetRoot: target, backend: 'sqlite', env: { AIDN_STATE_MODE: 'dual' } }), { code: 'AIDN_FILES_STATE_MODE_RETIRED' });
    assert.equal(preview.preview, true); assert.deepEqual(preview.verification.sessions, 1); assert.equal(preview.verification.cycles, 1);
    assert.equal(preview.verification.history_records, 1); assert.deepEqual(bytes(target), before); assert.equal(fs.existsSync(dbFile), false);
    const result = await migrateStateMode({ targetRoot: target, to: mode, write: true });
    assert.equal(result.config_update.applied, true);
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: target }); assert.equal(artifacts.describe().state_mode, mode);
    assert.equal(artifacts.describe().backend, 'sqlite');
    for (const [relative, digest] of before.filter(([name]) => name.replaceAll('\\','/').startsWith('docs/audit/'))) {
      const name = relative.replaceAll('\\','/').slice('docs/audit/'.length), row = artifacts.read(name, { required: true });
      assert.equal(row.sha256, digest); assert.equal(sha(fs.readFileSync(path.join(target, relative))), digest);
    }
    const history = artifacts.read('workflows/history/retained.json', { required: true });
    const old = fs.readFileSync(path.join(target, 'docs/audit/workflows/history/retained.json'), 'utf8'); assert.equal(history.content, old);
    const sqlBefore = createProjectArtifactStore({ targetRoot: target, readOnly: true }); let rows;
    try { rows = sqlBefore.listArtifacts(100); } finally { sqlBefore.close(); }
    fs.writeFileSync(path.join(target, 'docs/audit/sessions/S901.md'), '# stale local session\n');
    await migrateStateMode({ targetRoot: target, to: mode === 'dual' ? 'db-only' : 'dual', write: true });
    const sqlAfter = createProjectArtifactStore({ targetRoot: target, readOnly: true });
    try { assert.deepEqual(sqlAfter.listArtifacts(100), rows); } finally { sqlAfter.close(); }
    checks.push(mode + ': exact migration and SQL-authority preservation');
  }
  const interrupted = fixture('interrupted'); let stopped = false;
  await assert.rejects(migrateStateMode({ targetRoot: interrupted, to: 'dual', write: true }, { onBoundary(name) {
    if (name === 'artifact_copied' && !stopped) { stopped = true; throw Error('FIXTURE_INTERRUPT'); }
  } }), { message: 'FIXTURE_INTERRUPT', migration_written: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(interrupted, '.aidn/config.json'))).runtime.stateMode, 'files');
  await migrateStateMode({ targetRoot: interrupted, to: 'dual', write: true }); checks.push('interruption preserves legacy authority and resumes copy');
  const cached = fixture('stale-index'), cachedFile = path.join(cached, '.aidn/runtime/index/workflow-index.sqlite');
  const cache = createArtifactStore({ sqliteFile: cachedFile });
  try { cache.upsertArtifact({ path: 'legacy-cache-only.md', content: '# stale cache\n', content_format: 'utf8', kind: 'other', family: 'support' }); }
  finally { cache.close(); }
  const cachedPreview = await migrateStateMode({ targetRoot: cached, to: 'dual' }); assert.equal(cachedPreview.legacy_index.rebuild_required, true);
  const rebuilt = await migrateStateMode({ targetRoot: cached, to: 'dual', write: true });
  const backup = path.join(cached, rebuilt.legacy_index.backup.path); assert.equal(sha(fs.readFileSync(backup)), rebuilt.legacy_index.backup.sha256);
  const oldCache = createArtifactStore({ sqliteFile: backup, readOnly: true });
  try { assert.equal(oldCache.getArtifact('legacy-cache-only.md').content, '# stale cache\n'); } finally { oldCache.close(); }
  assert.equal(createStandardWorkflowArtifacts({ targetRoot: cached }).read('legacy-cache-only.md').content, null);
  assert.equal(createStandardWorkflowArtifacts({ targetRoot: cached }).read('sessions/S901.md', { required: true }).source, 'sqlite');
  checks.push('stale legacy SQLite cache preserved separately before rebuild');
  const invalid = fixture('foreign-owner');
  fs.writeFileSync(path.join(invalid, 'docs/audit/cycles/C901-feature-work/status.md'), '# Cycle\nstate: OPEN\nsession_owner: S999\n');
  const badBefore = bytes(invalid);
  await assert.rejects(migrateStateMode({ targetRoot: invalid, to: 'dual', write: true }), { code: 'AIDN_MODE_MIGRATION_CYCLE_OWNER_INVALID' });
  assert.deepEqual(bytes(invalid), badBefore); checks.push('invalid ownership refused before effects');
  const target = fixture('source-drift');
  await assert.rejects(migrateStateMode({ targetRoot: target, to: 'dual', write: true }, { onBoundary(name) {
    if (name === 'before_config') fs.appendFileSync(path.join(target, 'docs/audit/sessions/S901.md'), '\nchanged: true\n');
  } }), { code: 'AIDN_MODE_MIGRATION_SOURCE_CHANGED' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, '.aidn/config.json'))).runtime.stateMode, 'files'); checks.push('source drift refuses publication');
  const command = spawnSync(process.execPath, [path.join(repo,'tools/runtime/mode-migrate.mjs'),'--target',root,'--to','files','--json'],
    { cwd: repo, encoding:'utf8', windowsHide:true });
  assert.notEqual(command.status,0); assert.equal(JSON.parse(command.stdout).code, 'AIDN_FILES_STATE_MODE_RETIRED'); checks.push('CLI cannot select FILES destination');
  assert.deepEqual(validateJsonSchema(JSON.parse(command.stdout), outputSchema), []);
  console.log(JSON.stringify({ status:'PASS',checks,backend:'sqlite',native_calls:0,live_postgres:'SKIP' }));
} finally {
  const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir())); assert(path.basename(resolved).startsWith('aidn-retire-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
