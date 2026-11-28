import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { migrateStateMode } from '../../src/application/runtime/state-mode-migration.mjs';
import { createRuntimeArtifactStore } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';
import { cleanAndVerifyScopes } from './verify-postgres-runtime-persistence-live-smoke.mjs';

// Optional live qualification. Every write belongs to this process's fresh
// synthetic scope, and cleanup verifies only those exact scope identities.
export async function verifyFilesRetirementPostgres(connectionString) {
  const base = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'aidn-retire-pg-'));
  const scopes = new Set(), env = { ...process.env, AIDN_RETIRE_PG_TEST_URL: connectionString }, checks = [];
  let cleanup;
  try {
    for (const mode of ['dual', 'db-only']) {
      const target = path.join(root, mode); fs.mkdirSync(path.join(target, '.aidn'), { recursive: true });
      fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ version: 1, profile: 'files', runtime: { stateMode: 'files' } }));
      const content = { 'CURRENT-STATE.md': '# State\nactive_session: S901\nactive_cycle: C901\nmode: COMMITTING\n',
        'sessions/S901.md': '# Session\nstate: OPEN\nmode: COMMITTING\nattached_cycles: C901\n',
        'cycles/C901-feature-check/status.md': '# Cycle\nstate: OPEN\nsession_owner: S901\n',
        'workflows/history/retained.json': '{"mode":"COMMITTING","state":"UNKNOWN","signature":"opaque historical bytes"}\n' };
      for (const [name, text] of Object.entries(content)) { const file = path.join(target, 'docs/audit', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
      const scope = resolveRuntimeProjectContext({ targetRoot: target });
      scopes.add(scope.runtime_scope_id); scopes.add(scope.legacy_scope_key);
      const options = { targetRoot: target, to: mode, backend: 'postgres', connectionRef: 'env:AIDN_RETIRE_PG_TEST_URL', env };
      const configFile = path.join(target, '.aidn/config.json'), before = fs.readFileSync(configFile);
      const preview = await migrateStateMode(options); assert.equal(preview.preview, true); assert.deepEqual(fs.readFileSync(configFile), before);
      await migrateStateMode({ ...options, write: true });
      const store = createRuntimeArtifactStore({ targetRoot: target, env, readOnly: true });
      let retained;
      try {
        retained = await store.executeArtifactCommand('get-many', { paths: Object.keys(content) });
        assert.deepEqual(retained.map(row => row.content), Object.values(content));
        assert.equal(retained.find(row => row.path === 'sessions/S901.md').session_id, 'S901');
        assert.equal(retained.find(row => row.path.endsWith('/status.md')).cycle_id, 'C901');
      } finally { await store.close?.(); }
      fs.writeFileSync(path.join(target, 'docs/audit/sessions/S901.md'), '# stale projection\n');
      await migrateStateMode({ targetRoot: target, to: mode === 'dual' ? 'db-only' : 'dual', write: true, env });
      const reread = createRuntimeArtifactStore({ targetRoot: target, env, readOnly: true });
      try { assert.deepEqual(await reread.executeArtifactCommand('get-many', { paths: Object.keys(content) }), retained); }
      finally { await reread.close?.(); }
      checks.push(mode + ': legacy migration, retained bytes and canonical SQL preserved');
    }
  } finally {
    cleanup = await cleanAndVerifyScopes(connectionString, [...scopes]);
    assert.equal(path.dirname(fs.realpathSync(root)), base); assert(path.basename(root).startsWith('aidn-retire-pg-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(cleanup.ok, true, 'synthetic PostgreSQL scope cleanup');
  return { status: 'PASS', backend: 'postgres', checks, synthetic_scope_cleanup: 'PASS', native_calls: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connection = process.env.AIDN_RUNTIME_PG_SMOKE_URL;
  if (!connection) console.log(JSON.stringify({ status: 'SKIP', reason: 'AIDN_RUNTIME_PG_SMOKE_URL unavailable' }));
  else console.log(JSON.stringify(await verifyFilesRetirementPostgres(connection)));
}
