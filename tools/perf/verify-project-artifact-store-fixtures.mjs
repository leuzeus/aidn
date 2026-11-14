#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';
import { getDatabaseSync } from '../../src/lib/sqlite/workflow-db-schema-lib.mjs';
import { artifactContentHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { resolveEffectiveRuntimePersistence } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { executePostgresArtifactCommand, validateArtifactPath } from '../../src/adapters/runtime/postgres-artifact-command-lib.mjs';
import { createPostgresRuntimeArtifactStore } from '../../src/adapters/runtime/postgres-runtime-artifact-store.mjs';
import { createRuntimePersistenceFakePgClientFactory } from './runtime-persistence-fake-pg-lib.mjs';

export async function verifyProjectArtifactCommands() {
  let count = 0;
  const configured = { runtime: { persistence: { backend: 'postgres', connectionRef: 'env:PROJECT_DB' } } };
  assert.equal(resolveEffectiveRuntimePersistence({ backend: 'postgres', configData: configured }).connectionRef, 'env:PROJECT_DB');
  assert.equal(resolveEffectiveRuntimePersistence({ backend: 'postgres', configData: configured, connectionRef: 'env:EXPLICIT_DB' }).connectionRef, 'env:EXPLICIT_DB');
  assert.equal(resolveEffectiveRuntimePersistence({ backend: 'sqlite', configData: configured }).connectionRef, null); count += 3;
  function fake({ version = 3, scopes = ['scope'], failTable = '', headPath = '', executionSchema = false, reservations = [], readRows = [] } = {}) {
    const queries = [];
    return { queries, async query(sql, values = []) {
      queries.push({ sql, values });
      assert.doesNotMatch(sql, /CREATE |ALTER |DROP |DELETE /i);
      if (failTable && sql.startsWith(`INSERT INTO aidn_runtime.${failTable} `)) throw new Error('injected late failure');
      if (sql.startsWith('SELECT MAX(schema_version)')) return { rows: [{ version }] };
      if (sql.includes("to_regclass('aidn_shared.execution_runs')")) return { rows: [{ execution_runs: executionSchema ? 'aidn_shared.execution_runs' : null }] };
      if (sql.startsWith('SELECT run_id FROM aidn_shared.execution_runs')) return { rows: reservations.filter(row => row.runtime_scope_id === values[0] && row.reservation_active).map(row => ({ run_id: row.run_id })) };
      if (sql.startsWith('SELECT DISTINCT scope_key')) return { rows: scopes.map(scope_key => ({ scope_key })) };
      if (sql.includes('path=ANY($2::text[])')) return { rows: readRows.filter(row => row.scope_key === values[0] && values[1].includes(row.path)) };
      if (sql.includes('COALESCE(MAX(artifact_id)')) return { rows: [{ id: '8' }] };
      if (sql.startsWith('SELECT artifact_path')) return { rows: headPath ? [{ artifact_path: headPath }] : [] };
      return { rows: [] };
    } };
  }
  for (const name of ['../bad', 'docs/audit/CURRENT-STATE.md', 'C:\\bad', '/bad', 'a//b', 'a/./b']) {
    assert.throws(() => validateArtifactPath(name), /ARTIFACT_PATH/); count++;
  }
  for (const options of [{ version: 2 }, { scopes: [] }, { scopes: ['one', 'two'] },
    { scopes: ['scope', 'foreign'] }, { scopes: ['scope', 'scope'] }]) {
    const client = fake(options);
    await assert.rejects(executePostgresArtifactCommand(client, ['scope'], 'upsert', { artifact: { path: 'notes/test.md', content: 'private' } }), /ARTIFACT_/);
    assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
    assert(!client.queries.some(q => q.sql.startsWith('INSERT'))); count++;
  }
  const client = fake();
  await executePostgresArtifactCommand(client, ['scope'], 'upsert', { artifact: {
    path: 'sessions/S001-test.md', kind: 'session', content: 'mode: THINKING\nsession_branch: codex/test\n',
  } });
  assert.equal(client.queries.at(-1).sql, 'COMMIT');
  assert(!client.queries.some(q => q.sql.includes('pg_advisory_xact_lock')), 'absent supervision schema must not take a new scope lock'); count++;
  assert(client.queries.some(q => q.sql.startsWith('INSERT INTO aidn_runtime.sessions')));
  assert.equal(client.queries.find(q => q.sql.startsWith('INSERT INTO aidn_runtime.sessions')).values[3], 'THINKING');
  assert(!client.queries.some(q => q.sql.includes('private') || q.sql.includes('codex/test'))); count++;
  for (const options of [{ failTable: 'artifact_blobs' }, { headPath: 'docs/audit/CURRENT-STATE.md' }]) {
    const broken = fake(options);
    await assert.rejects(executePostgresArtifactCommand(broken, ['scope'], 'upsert', { artifact: { path: 'CURRENT-STATE.md', content: 'mode: THINKING' } }));
    assert.equal(broken.queries.at(-1).sql, 'ROLLBACK'); count++;
  }
  const reader = fake();
  const mismatch = fake();
  await assert.rejects(executePostgresArtifactCommand(mismatch, ['scope'], 'upsert', { artifact: { path: 'sessions/S001-test.md', session_id: 'S002' } }), /ARTIFACT_IDENTITY_CONFLICT/);
  assert(!mismatch.queries.some(q => q.sql.startsWith('INSERT'))); count++;
  await executePostgresArtifactCommand(reader, ['scope'], 'list', { limit: 3 });
  assert.equal(reader.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert(!reader.queries.some(q => /INSERT|UPDATE|LOCK TABLE/.test(q.sql))); count++;
  // Candidate order is resolved identity first, legacy path second. Database
  // result order cannot change the selected authority when both coexist.
  for (const present of [['legacy', 'scope'], ['scope', 'legacy'], ['legacy']]) {
    const expected = present.includes('scope') ? 'scope' : 'legacy';
    for (const action of ['get', 'list', 'upsert']) {
      const scoped = fake({ scopes: present });
      await executePostgresArtifactCommand(scoped, ['scope', 'legacy'], action, {
        path: 'notes/test.md', artifact: { path: 'notes/test.md', content: 'scoped' },
      });
      const dataQueries = scoped.queries.filter(q => /v_materializable_artifacts|INSERT INTO|SELECT artifact_id|COALESCE\(MAX/.test(q.sql));
      assert(dataQueries.length > 0);
      assert(dataQueries.every(q => q.values[0] === expected), `${action} crossed its selected scope`);
      if (action !== 'upsert') assert(!scoped.queries.some(q => /INSERT|UPDATE|LOCK TABLE/.test(q.sql)));
      assert.equal(scoped.queries.at(-1).sql, 'COMMIT'); count++;
    }
  }
  const absent = fake({ scopes: ['scope', 'legacy'] });
  assert.equal(await executePostgresArtifactCommand(absent, ['scope', 'legacy'], 'get', { path: 'notes/legacy-only.md' }), null);
  assert.equal(absent.queries.filter(q => q.sql.includes('v_materializable_artifacts')).length, 1,
    'missing canonical artifact must not fall back to a legacy artifact'); count++;
  const first = 'notes/first.md', second = 'notes/second.md', missing = 'notes/missing.md';
  const batch = fake({ scopes: ['legacy', 'scope'], readRows: [
    { scope_key: 'scope', path: second, content: 'second' }, { scope_key: 'legacy', path: missing, content: 'legacy' },
    { scope_key: 'scope', path: first, content: 'first' },
  ] });
  const rows = await executePostgresArtifactCommand(batch, ['scope', 'legacy'], 'get-many', { paths: [first, missing, second] });
  assert.deepEqual(rows.map(row => row?.content ?? null), ['first', null, 'second']);
  assert.equal(batch.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(batch.queries.filter(q => q.sql.includes('v_materializable_artifacts')).map(q => q.values), [['scope', [first, missing, second]]]);
  assert.equal(batch.queries.at(-1).sql, 'COMMIT'); count++;
  for (const paths of [[], [first, first], [first, '../invalid']]) {
    const invalid = fake();
    await assert.rejects(executePostgresArtifactCommand(invalid, ['scope'], 'get-many', { paths }), /ARTIFACT_/);
    assert.deepEqual(invalid.queries, []); count++;
  }
  const workerActions = [];
  let workerRefusal = 'ENOBUFS';
  const worker = createProjectArtifactStore({ backend: 'postgres', connectionRef: 'env:PROJECT_DB', readOnly: true,
    workerRunner(_executable, _args, { input }) {
      const request = JSON.parse(input);
      workerActions.push(request.action);
      if (request.action === 'get-many') return { status: null, error: { code: workerRefusal } };
      return { status: 0, stdout: JSON.stringify({ ok: true, result: { path: request.options.path } }) };
    } });
  assert.deepEqual(worker.getArtifacts([first, second]).map(row => row.path), [first, second]);
  assert.deepEqual(workerActions, ['get-many', 'get', 'get']); count++;
  workerRefusal = 'ETIMEDOUT'; workerActions.length = 0;
  assert.throws(() => worker.getArtifacts([first, second]), /ARTIFACT_POSTGRES_WORKER_UNAVAILABLE/);
  assert.deepEqual(workerActions, ['get-many']); count++;
  worker.close();
  for (const lifecycle_status of ['running', 'recovery_required']) {
    const fenced = fake({ scopes: ['legacy', 'scope'], executionSchema: true, reservations: [
      { run_id: 'run-1', runtime_scope_id: 'scope', reservation_active: true, lifecycle_status, lease_expires_at: '2000-01-01T00:00:00Z' },
    ] });
    await assert.rejects(executePostgresArtifactCommand(fenced, ['scope', 'legacy'], 'upsert', { artifact: { path: 'CURRENT-STATE.md', content: 'mode: THINKING' } }), /ARTIFACT_EXECUTION_SCOPE_RESERVED/);
    assert.equal(fenced.queries.at(-1).sql, 'ROLLBACK');
    assert(!fenced.queries.some(q => q.sql.startsWith('INSERT')));
    const tableLock = fenced.queries.findIndex(q => q.sql.startsWith('LOCK TABLE'));
    const scopeLock = fenced.queries.findIndex(q => q.sql.includes('pg_advisory_xact_lock'));
    assert(tableLock >= 0 && scopeLock > tableLock);
    assert.deepEqual(fenced.queries.find(q => q.sql.startsWith('SELECT run_id')).values, ['scope']); count++;
  }
  for (const action of ['get', 'list']) {
    const reservedReader = fake({ executionSchema: true, reservations: [{ runtime_scope_id: 'scope', reservation_active: true }] });
    await executePostgresArtifactCommand(reservedReader, ['scope'], action, { path: 'CURRENT-STATE.md' });
    assert(!reservedReader.queries.some(q => q.sql.includes('execution_runs') || q.sql.includes('LOCK TABLE'))); count++;
  }
  const legacyReservation = [{ run_id: 'run-legacy', runtime_scope_id: 'legacy', reservation_active: true }];
  const canonicalWins = fake({ scopes: ['legacy', 'scope'], executionSchema: true, reservations: legacyReservation });
  await executePostgresArtifactCommand(canonicalWins, ['scope', 'legacy'], 'upsert', { artifact: { path: 'notes/test.md', content: 'canonical' } });
  assert.deepEqual(canonicalWins.queries.find(q => q.sql.startsWith('SELECT run_id')).values, ['scope']);
  assert.equal(canonicalWins.queries.at(-1).sql, 'COMMIT'); count++;
  const legacyWins = fake({ scopes: ['legacy'], executionSchema: true, reservations: legacyReservation });
  await assert.rejects(executePostgresArtifactCommand(legacyWins, ['scope', 'legacy'], 'upsert', { artifact: { path: 'notes/test.md', content: 'legacy' } }), /ARTIFACT_EXECUTION_SCOPE_RESERVED/);
  assert.deepEqual(legacyWins.queries.find(q => q.sql.startsWith('SELECT run_id')).values, ['legacy']);
  assert(!legacyWins.queries.some(q => q.sql.startsWith('INSERT'))); count++;
  const released = fake({ executionSchema: true, reservations: [{ runtime_scope_id: 'scope', reservation_active: false }] });
  await executePostgresArtifactCommand(released, ['scope'], 'upsert', { artifact: { path: 'notes/test.md', content: 'released' } });
  assert.equal(released.queries.at(-1).sql, 'COMMIT'); count++;

  // Bulk canonical imports fence every scope they mutate, including the old
  // snapshot alias. These mocks prove query order, not PostgreSQL concurrency.
  const bulkFake = createRuntimePersistenceFakePgClientFactory({ executionSchema: true });
  const bulk = createPostgresRuntimeArtifactStore({ targetRoot: os.tmpdir(), connectionString: 'postgres://fixture:fixture@localhost/fixture', clientFactory: bulkFake.factory,
    runtimeProjectContext: { runtime_scope_id: 'scope', legacy_scope_key: 'legacy' } });
  const payload = { schema_version: 2, generated_at: '2030-01-01T00:00:00Z', cycles: [], sessions: [], artifacts: [] };
  await bulk.writeIndexProjection({ payload });
  for (const reservedScope of ['scope', 'legacy']) {
    bulkFake.state.queryLog.length = 0;
    bulkFake.state.executionReservations = [{ run_id: 'run-bulk', runtime_scope_id: reservedScope, reservation_active: true }];
    const before = JSON.stringify(bulkFake.state.relationalRows);
    await assert.rejects(bulk.writeIndexProjection({ payload }), /ARTIFACT_EXECUTION_SCOPE_RESERVED/);
    assert.equal(JSON.stringify(bulkFake.state.relationalRows), before);
    assert(!bulkFake.state.queryLog.some(q => q.sql.startsWith('DELETE')));
    assert.equal(bulkFake.state.queryLog.at(-1).sql, 'ROLLBACK');
    const tableLock = bulkFake.state.queryLog.findIndex(q => q.sql.startsWith('LOCK TABLE'));
    const scopeLock = bulkFake.state.queryLog.findIndex(q => q.sql.includes('pg_advisory_xact_lock'));
    assert(tableLock >= 0 && scopeLock > tableLock); count++;
  }
  const sqliteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-artifact-session-projection-'));
  try {
    const sqliteFile = path.join(sqliteRoot, 'workflow.sqlite'), store = createArtifactStore({ sqliteFile });
    const DatabaseSync = getDatabaseSync(), db = new DatabaseSync(sqliteFile);
    try {
      const artifact = { path: 'sessions/S001-test.md', kind: 'session', session_id: 'S001', content_format: 'utf8',
        content: 'mode: THINKING\nsession_branch: S001-original\nparent_session: none\n' };
      store.compareAndSwapArtifact({ artifact, expectedSha256: null });
      assert.equal(db.prepare('SELECT branch_name FROM sessions WHERE session_id=?').get('S001').branch_name, 'S001-original'); count++;
      const changed = { ...artifact, content: artifact.content.replace('THINKING', 'COMMITTING').replace('S001-original', 'S001-updated') };
      store.compareAndSwapArtifact({ artifact: changed, expectedSha256: artifactContentHash(artifact.content) });
      const row = db.prepare('SELECT * FROM sessions WHERE session_id=?').get('S001');
      assert.equal(row.branch_name, 'S001-updated'); assert.equal(row.state, 'COMMITTING'); assert.equal(row.source_artifact_path, artifact.path); count++;
      assert.throws(() => store.compareAndSwapArtifact({ artifact, expectedSha256: artifactContentHash(artifact.content) }), /ARTIFACT_REVISION_CONFLICT/);
      assert.deepEqual(db.prepare('SELECT * FROM sessions WHERE session_id=?').get('S001'), row); count++;
      assert.throws(() => store.compareAndSwapArtifact({ artifact: { ...changed, session_id: 'S002' }, expectedSha256: artifactContentHash(changed.content) }), /ARTIFACT_IDENTITY_CONFLICT/);
      assert.equal(store.getArtifact(artifact.path).content, changed.content); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1); count++;
      db.exec("CREATE TRIGGER reject_session_projection BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'fixture projection failure'); END");
      assert.throws(() => store.compareAndSwapArtifact({ artifact, expectedSha256: artifactContentHash(changed.content) }), /fixture projection failure/);
      assert.equal(store.getArtifact(artifact.path).content, changed.content); assert.deepEqual(db.prepare('SELECT * FROM sessions WHERE session_id=?').get('S001'), row); count++;
    } finally { db.close(); store.close(); }
  } finally {
    assert.equal(path.dirname(path.resolve(sqliteRoot)), path.resolve(os.tmpdir())); fs.rmSync(sqliteRoot, { recursive: true, force: true });
  }
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-artifact-preview-'));
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../runtime/artifact-store.mjs', import.meta.url)),
      'upsert', '--target', target, '--dry-run', '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(child.status, 1); assert.match(child.stderr, /does not support --dry-run/);
    assert.equal(child.stdout, ''); assert.deepEqual(fs.readdirSync(target), []); count++;
  } finally {
    assert.equal(path.dirname(path.resolve(target)), path.resolve(os.tmpdir())); fs.rmSync(target, { recursive: true, force: true });
  }
  console.log(`PASS project artifact command fixtures: ${count} assertions; actual SQLite and PostgreSQL double; no live PostgreSQL claim`);
}

await verifyProjectArtifactCommands();
