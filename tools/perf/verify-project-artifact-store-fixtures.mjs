#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveEffectiveRuntimePersistence } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { executePostgresArtifactCommand, validateArtifactPath } from '../../src/adapters/runtime/postgres-artifact-command-lib.mjs';

export async function verifyProjectArtifactCommands() {
  let count = 0;
  const configured = { runtime: { persistence: { backend: 'postgres', connectionRef: 'env:PROJECT_DB' } } };
  assert.equal(resolveEffectiveRuntimePersistence({ backend: 'postgres', configData: configured }).connectionRef, 'env:PROJECT_DB');
  assert.equal(resolveEffectiveRuntimePersistence({ backend: 'postgres', configData: configured, connectionRef: 'env:EXPLICIT_DB' }).connectionRef, 'env:EXPLICIT_DB');
  assert.equal(resolveEffectiveRuntimePersistence({ backend: 'sqlite', configData: configured }).connectionRef, null); count += 3;
  function fake({ version = 3, scopes = ['scope'], failTable = '', headPath = '' } = {}) {
    const queries = [];
    return { queries, async query(sql, values = []) {
      queries.push({ sql, values });
      assert.doesNotMatch(sql, /CREATE |ALTER |DROP |DELETE /i);
      if (failTable && sql.startsWith(`INSERT INTO aidn_runtime.${failTable} `)) throw new Error('injected late failure');
      if (sql.startsWith('SELECT MAX(schema_version)')) return { rows: [{ version }] };
      if (sql.startsWith('SELECT DISTINCT scope_key')) return { rows: scopes.map(scope_key => ({ scope_key })) };
      if (sql.includes('COALESCE(MAX(artifact_id)')) return { rows: [{ id: '8' }] };
      if (sql.startsWith('SELECT artifact_path')) return { rows: headPath ? [{ artifact_path: headPath }] : [] };
      return { rows: [] };
    } };
  }
  for (const name of ['../bad', 'docs/audit/CURRENT-STATE.md', 'C:\\bad', '/bad', 'a//b', 'a/./b']) {
    assert.throws(() => validateArtifactPath(name), /ARTIFACT_PATH/); count++;
  }
  for (const options of [{ version: 2 }, { scopes: [] }, { scopes: ['one', 'two'] }]) {
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
  assert(client.queries.some(q => q.sql.startsWith('INSERT INTO aidn_runtime.sessions')));
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
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-artifact-preview-'));
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../runtime/artifact-store.mjs', import.meta.url)),
      'upsert', '--target', target, '--dry-run', '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(child.status, 1); assert.match(child.stderr, /does not support --dry-run/);
    assert.equal(child.stdout, ''); assert.deepEqual(fs.readdirSync(target), []); count++;
  } finally {
    assert.equal(path.dirname(path.resolve(target)), path.resolve(os.tmpdir())); fs.rmSync(target, { recursive: true, force: true });
  }
  console.log(`PASS project artifact command fixtures: ${count} assertions; no live PostgreSQL claim`);
}

await verifyProjectArtifactCommands();
