#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { executePostgresArtifactCommand } from '../../src/adapters/runtime/postgres-artifact-command-lib.mjs';
import { assertProjectArtifactCompareDelete } from '../../src/core/ports/project-artifact-store-port.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { getDatabaseSync } from '../../src/lib/sqlite/workflow-db-schema-lib.mjs';

const incidentPath = 'incidents/INC-TMP-20261115-000000-fixture.md';
const content = 'incident_id: INC-TMP-20261115-000000-fixture\nstatus: RESOLVED\n';
const request = artifact => ({ path: artifact.path, write: true,
  expectedSha256: artifactContentHash(artifact.content), expectedMetadataSha256: artifactMetadataHash(artifact) });
let assertions = 0;
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-artifact-delete-'));
let store, other, db;
try {
  const sqliteFile = path.join(target, 'workflow.sqlite');
  store = assertProjectArtifactCompareDelete(createArtifactStore({ sqliteFile }));
  const seed = () => store.upsertArtifact({ path: incidentPath, kind: 'incident', family: 'incident', content });
  seed();
  store.upsertArtifact({ path: 'notes/keep.md', content: 'unrelated retained evidence' });
  const snapshot = () => ['artifacts', 'artifact_blobs', 'runtime_heads', 'sessions', 'cycles'].map(table => {
    const statement = db.prepare(`SELECT * FROM ${table} ORDER BY 1`);
    statement.setReadBigInts(true);
    return [table, statement.all()];
  });
  const DatabaseSync = getDatabaseSync(); db = new DatabaseSync(sqliteFile);
  const valid = request(store.getArtifact(incidentPath));
  const before = snapshot();
  for (const invalid of [undefined, {}, { ...valid, write: false }, { ...valid, write: undefined },
    { ...valid, expectedSha256: null }, { ...valid, expectedMetadataSha256: undefined },
    { ...valid, path: '../escape.md' }, { ...valid, path: '/absolute.md' },
    { ...valid, path: 'incidents\\alias.md' }, { ...valid, path: 'C:/absolute.md' }]) {
    assert.throws(() => store.compareAndDeleteArtifact(invalid), /ARTIFACT_COMPARE_DELETE_INVALID/);
    assert.deepEqual(snapshot(), before); assertions++;
  }
  assert.throws(() => store.compareAndDeleteArtifact({ ...valid, expectedSha256: '0'.repeat(64) }), /ARTIFACT_REVISION_CONFLICT/);
  assert.throws(() => store.compareAndDeleteArtifact({ ...valid, expectedMetadataSha256: '0'.repeat(64) }), /ARTIFACT_REVISION_CONFLICT/);
  assert.deepEqual(snapshot(), before); assertions += 2;

  // A second actual connection changes metadata while preserving content.
  other = createArtifactStore({ sqliteFile, existingOnly: true });
  other.upsertArtifact({ ...store.getArtifact(incidentPath), classification_reason: 'new canonical owner decision' });
  const changed = snapshot();
  assert.throws(() => store.compareAndDeleteArtifact(valid), /ARTIFACT_REVISION_CONFLICT/);
  assert.deepEqual(snapshot(), changed); assertions++;

  // A late failure occurs after the blob DELETE. The real transaction restores both rows.
  const current = request(store.getArtifact(incidentPath));
  db.exec("CREATE TRIGGER refuse_fixture_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'fixture late delete failure'); END");
  assert.throws(() => store.compareAndDeleteArtifact(current), /fixture late delete failure/);
  assert.deepEqual(snapshot(), changed); assertions++;
  db.exec('DROP TRIGGER refuse_fixture_delete');

  // Existing heads and derived workflow/session/cycle records are outside this capability.
  for (const [name, kind] of [['workflows/native-allocations/native_fixture.json', 'other'],
    ['sessions/S001-test.md', 'session'], ['cycles/C001-test/status.md', 'cycle'], ['notes/session.md', 'session']]) {
    store.upsertArtifact({ path: name, kind, content: '{}' });
    const protectedBefore = snapshot();
    assert.throws(() => store.compareAndDeleteArtifact(request(store.getArtifact(name))), /ARTIFACT_DELETE_PROTECTED/);
    assert.deepEqual(snapshot(), protectedBefore); assertions++;
  }
  db.prepare('INSERT INTO runtime_heads (head_key, artifact_path, updated_at) VALUES (?, ?, ?)')
    .run('fixture-protected', incidentPath, '2026-11-15T00:00:00Z');
  const withHead = snapshot();
  assert.throws(() => store.compareAndDeleteArtifact(current), /ARTIFACT_DELETE_PROTECTED/);
  assert.deepEqual(snapshot(), withHead); assertions++;
  db.prepare('DELETE FROM runtime_heads WHERE head_key=?').run('fixture-protected');
  const referencedId = db.prepare('SELECT artifact_id FROM artifacts WHERE path=?').get(incidentPath).artifact_id;
  db.prepare('INSERT INTO runtime_heads (head_key, artifact_id, artifact_path, updated_at) VALUES (?, ?, ?, ?)')
    .run('fixture-protected', referencedId, 'notes/foreign-head-path.md', '2026-11-15T00:00:00Z');
  const idHead = snapshot();
  assert.throws(() => store.compareAndDeleteArtifact(current), /ARTIFACT_DELETE_PROTECTED/);
  assert.deepEqual(snapshot(), idHead); assertions++;
  db.prepare('DELETE FROM runtime_heads WHERE head_key=?').run('fixture-protected');

  const readonly = assertProjectArtifactCompareDelete(createArtifactStore({ sqliteFile, readOnly: true }));
  try { assert.throws(() => readonly.compareAndDeleteArtifact(current), /read-only/); assertions++; }
  finally { readonly.close(); }
  const missingFile = path.join(target, 'missing.sqlite');
  const absent = assertProjectArtifactCompareDelete(createArtifactStore({ sqliteFile: missingFile, readOnly: true }));
  try {
    assert.throws(() => absent.compareAndDeleteArtifact(current), /read-only/);
    assert.equal(fs.existsSync(missingFile), false); assertions++;
  } finally { absent.close(); }

  const visible = path.join(target, 'incident-visible-copy.md'); fs.writeFileSync(visible, content);
  const removedId = BigInt(db.prepare('SELECT artifact_id FROM artifacts WHERE path=?').get(incidentPath).artifact_id);
  const unrelated = snapshot().map(([name, rows]) => [name, rows.filter(row => row.path !== incidentPath
    && row.artifact_id !== removedId)]);
  const result = store.compareAndDeleteArtifact(current);
  assert.deepEqual(result, { path: incidentPath, deleted: true, sha256: current.expectedSha256,
    metadata_sha256: current.expectedMetadataSha256 });
  assert.equal(store.getArtifact(incidentPath), null);
  assert.deepEqual(snapshot(), unrelated);
  assert.equal(fs.readFileSync(visible, 'utf8'), content, 'canonical delete does not silently remove a visible projection'); assertions++;
  assert.throws(() => other.compareAndDeleteArtifact(current), /ARTIFACT_REVISION_CONFLICT/); assertions++;
} finally {
  db?.close(); other?.close(); store?.close();
  assert.equal(path.dirname(path.resolve(target)), path.resolve(os.tmpdir()));
  assert.match(path.basename(target), /^aidn-artifact-delete-/);
  fs.rmSync(target, { recursive: true, force: true });
}

// PostgreSQL doubles establish query decisions and ordering, not real isolation or rollback.
const canonical = { path: incidentPath, kind: 'incident', family: 'incident', content_format: 'utf8', content,
  gate_relevance: 0, source_mode: 'explicit', entity_confidence: 1, updated_at: '2026-11-15T00:00:00Z' };
// Use the adapter's mapped representation for metadata defaults.
const { mapArtifactRow } = await import('../../src/adapters/runtime/artifact-store.mjs');
const pgRequest = request(mapArtifactRow(canonical));
function fake({ scopes = ['legacy', 'scope'], artifact = canonical, head = false, reservation = false,
  version = 3, fail = '' } = {}) {
  const queries = [];
  return { queries, async query(sql, values = []) {
    queries.push({ sql, values });
    assert.doesNotMatch(sql, /CREATE |ALTER |DROP |INSERT |UPDATE /i);
    if (sql.startsWith('SELECT MAX(schema_version)')) return { rows: [{ version }] };
    if (sql.startsWith('SELECT DISTINCT scope_key')) return { rows: scopes.map(scope_key => ({ scope_key })) };
    if (sql.includes("to_regclass('aidn_shared.execution_runs')")) return { rows: [{ execution_runs: 'aidn_shared.execution_runs' }] };
    if (sql.startsWith('SELECT run_id')) return { rows: reservation ? [{ run_id: 'reserved' }] : [] };
    if (sql.includes('v_materializable_artifacts')) return { rows: artifact ? [artifact] : [] };
    if (sql.startsWith('SELECT artifact_path')) return { rows: head ? [{ artifact_path: incidentPath }] : [] };
    if (sql.startsWith('DELETE')) {
      if (fail && sql.startsWith(`DELETE FROM aidn_runtime.${fail} `)) throw new Error('fixture late PG failure');
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  } };
}
for (const scopes of [['legacy', 'scope'], ['scope', 'legacy'], ['legacy']]) {
  const client = fake({ scopes });
  const result = await executePostgresArtifactCommand(client, ['scope', 'legacy'], 'compare-and-delete', pgRequest);
  assert.equal(result.deleted, true);
  const expectedScope = scopes.includes('scope') ? 'scope' : 'legacy';
  const deletes = client.queries.filter(q => q.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 2);
  assert(deletes.every(q => JSON.stringify(q.values) === JSON.stringify([expectedScope, incidentPath])));
  const tableLock = client.queries.findIndex(q => q.sql.startsWith('LOCK TABLE'));
  const scopeLock = client.queries.findIndex(q => q.sql.includes('pg_advisory_xact_lock'));
  const deletion = client.queries.findIndex(q => q.sql.startsWith('DELETE'));
  assert(tableLock > 0 && scopeLock > tableLock && deletion > scopeLock);
  assert(client.queries.find(q => q.sql.startsWith('SELECT artifact_path')).sql.includes('artifact_id IN'));
  assert.equal(client.queries.at(-1).sql, 'COMMIT'); assertions++;
}
for (const options of [{ artifact: null }, { artifact: { ...canonical, content: 'changed' } },
  { artifact: { ...canonical, classification_reason: 'changed owner' } }, { head: true },
  { reservation: true }, { version: 2 }, { scopes: [] }, { scopes: ['foreign'] }]) {
  const client = fake(options);
  await assert.rejects(executePostgresArtifactCommand(client, ['scope', 'legacy'], 'compare-and-delete', pgRequest), /ARTIFACT_/);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  assert(!client.queries.some(q => q.sql.startsWith('DELETE'))); assertions++;
}
for (const fail of ['artifact_blobs', 'artifacts']) {
  const client = fake({ fail });
  await assert.rejects(executePostgresArtifactCommand(client, ['scope', 'legacy'], 'compare-and-delete', pgRequest), /fixture late PG failure/);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK'); assertions++;
}
for (const invalid of [{ ...pgRequest, write: false }, { ...pgRequest, expectedMetadataSha256: null },
  { ...pgRequest, path: 'incidents\\alias.md' }]) {
  const client = fake();
  await assert.rejects(executePostgresArtifactCommand(client, ['scope'], 'compare-and-delete', invalid), /ARTIFACT_COMPARE_DELETE_INVALID/);
  assert.deepEqual(client.queries, []); assertions++;
}
let workerCalls = 0;
const readonlyPg = assertProjectArtifactCompareDelete(createProjectArtifactStore({ backend: 'postgres',
  connectionRef: 'env:FIXTURE_DB', readOnly: true, workerRunner() { workerCalls++; throw new Error('unexpected worker'); } }));
assert.throws(() => readonlyPg.compareAndDeleteArtifact(pgRequest), /read-only/);
assert.equal(workerCalls, 0); readonlyPg.close(); assertions++;
const pg = assertProjectArtifactCompareDelete(createProjectArtifactStore({ backend: 'postgres', connectionRef: 'env:FIXTURE_DB',
  workerRunner(_executable, args, options) {
    const input = JSON.parse(options.input);
    assert.equal(input.action, 'compare-and-delete');
    assert.equal(input.options.write, true);
    assert.equal(input.options.expectedMetadataSha256, pgRequest.expectedMetadataSha256);
    assert(!args.some(arg => arg.includes(incidentPath)));
    assert.equal(options.shell, false);
    return { status: 0, stdout: JSON.stringify({ ok: true, result: { deleted: true } }) };
  } }));
assert.equal(pg.compareAndDeleteArtifact(pgRequest).deleted, true); pg.close(); assertions++;
console.log(`PASS artifact compare-delete: ${assertions} assertions; actual SQLite and PostgreSQL doubles. R10 resolution/resume/trace executor and live PostgreSQL NOT_RUN.`);
