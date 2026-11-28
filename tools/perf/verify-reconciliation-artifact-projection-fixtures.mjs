import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts, STANDARD_ARTIFACT_INVENTORY_MAX_BYTES } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { createProcessOperationJournalStore } from '../../src/adapters/runtime/process-operation-journal-store.mjs';
import { createAgenticProcessStore } from '../../src/adapters/runtime/agentic-process-store.mjs';
import { executePostgresArtifactCommand } from '../../src/adapters/runtime/postgres-artifact-command-lib.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { projectReconciliationArtifacts } from '../../src/core/workflow/reconciliation-artifact-projection.mjs';
import { assertProjectReconciliationArtifactInventory } from '../../src/core/ports/project-artifact-store-port.mjs';
import { assertOperationJournal, createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const owned = [], root = createStandardWorkflowFixture('db-only', owned), key = randomBytes(32);
const binding = standardWorkflowOperationBindings().find(row => row.id === 'context_reload');
const model = { contract_version: 'agentic-process-model.v2', model_id: 'inventory-projection-fixture', revision: 1,
  participants: [{ id: 'project' }], roles: [], policies: [], operation_pins: { context_reload: H(binding) }, entry: 'reload',
  nodes: [{ id: 'reload', kind: 'operation', participant_ref: 'project', binding_ref: 'context_reload' }] };
let authorizations = 0, store;
try {
  const host = createStandardWorkflowOperationHost({ targetRoot: root, model, readSigningKey: () => key,
    authorize: async () => { authorizations++; throw Error('UNEXPECTED_AUTHORIZATION'); } });
  const initial = host.initialize({ instanceId: 'inventory' });
  host.initialize({ instanceId: 'inventory', write: true, expectedResultSha256: initial.record.instance_sha256 });
  const instances = createAgenticProcessStore({ targetRoot: root, stateMode: 'db-only' });
  const before = instances.read('inventory');
  const preview = await host.preview({ instanceId: 'inventory', expectedSha256: before.record.instance_sha256, occurrenceId: 'root' });
  const staged = await host.stage(preview, { write: true, expectedPreviewSha256: H(preview) });
  const journals = createProcessOperationJournalStore({ targetRoot: root, stateMode: 'db-only' });
  const current = journals.read(staged.operation_id).record;
  // Fault-injected orphan remains present even though no instance event names it.
  instances.compareAndSwap(before.record, instances.read('inventory').content_sha256);
  store = createProjectArtifactStore({ targetRoot: root, readOnly: false });
  const foreignPaths = [];
  for (let i = 0; i < 24; i++) {
    const record = structuredClone(current), id = 'op_' + (i + 1).toString(16).padStart(40, '0');
    record.operation_id = id; record.intent.operation_id = id;
    record.intent.instance_id = 'foreign-' + i;
    record.preview.prepared = { fixture_padding: 'x'.repeat(760000) };
    assertOperationJournal(record);
    const name = 'workflows/operation-records/' + id + '.json'; foreignPaths.push(name);
    store.upsertArtifact({ path: name, kind: 'other', content: JSON.stringify(record), content_format: 'utf8' });
  }
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  assert.throws(() => artifacts.observeInventory(), /STANDARD_ARTIFACT_INVENTORY_TRUNCATED/);
  const rows = store.listArtifacts(10000), projected = artifacts.observeInventory({ instanceId: 'inventory' });
  assert(rows.reduce((n, r) => n + Buffer.byteLength(r.content), 0) > STANDARD_ARTIFACT_INVENTORY_MAX_BYTES);
  assert.equal(projected.rows.length, rows.length);
  for (const row of rows) {
    const found = projected.rows.find(p => p.path === row.path);
    assert.equal(found.sha256, row.sha256); assert.equal(found.metadata_sha256, artifactMetadataHash(row));
    assert.equal(found.content, row.path === 'workflows/operation-records/' + current.operation_id + '.json' ? row.content : null);
  }
  const inventory = host.prepareReconciliationInventory('inventory', { expectedSha256: before.record.instance_sha256 });
  createOperationJournalSigner(() => key).verify(inventory);
  assert.equal(inventory.operations.length, 1); assert.equal(inventory.operations[0].operation_id, current.operation_id);
  for (const name of foreignPaths) assert(inventory.resources.some(r => r.ref === 'artifact:' + name));
  assert.equal(inventory.complete_resource_closure, false); assert.equal(inventory.permits_effects, false);
  assert.equal(inventory.written, false); assert.equal(authorizations, 0);
  assert.equal(instances.read('inventory').content_sha256, before.content_sha256);
  assert.equal(H(journals.read(current.operation_id).record), H(current));

  const foreign = rows.find(r => foreignPaths.includes(r.path));
  assert.throws(() => projectReconciliationArtifacts([{ ...foreign, content: foreign.content + ' ' }], 'inventory'), /INTEGRITY_INVALID/);
  const bad = JSON.stringify({ ...JSON.parse(foreign.content), unsupported_field: true });
  assert.throws(() => projectReconciliationArtifacts([{ ...foreign, content: bad, sha256: artifactContentHash(bad) }], 'inventory'), /RECORD_INVALID/);
  assert.throws(() => projectReconciliationArtifacts(rows, '../foreign'), /SCOPE_INVALID/);
  assert.throws(() => assertProjectReconciliationArtifactInventory({ ...store, listReconciliationArtifacts: undefined }), /requires listReconciliationArtifacts/);

  const queries = [];
  const client = { async query(sql, values = []) {
    queries.push({ sql, values });
    assert(!/INSERT|UPDATE|DELETE|CREATE|ALTER|LOCK TABLE/.test(sql));
    if (sql.startsWith('SELECT MAX(schema_version)')) return { rows: [{ version: 3 }] };
    if (sql.startsWith('SELECT DISTINCT scope_key')) return { rows: [{ scope_key: 'canonical' }, { scope_key: 'legacy' }] };
    if (sql.startsWith('SELECT * FROM aidn_runtime.v_materializable_artifacts')) {
      assert.equal(values[0], 'canonical'); return { rows: rows.map(r => ({ ...r, canonical_json: null })) };
    }
    return { rows: [] };
  } };
  const postgres = await executePostgresArtifactCommand(client, ['canonical', 'legacy'], 'list-reconciliation', { instanceId: 'inventory', limit: 10000 });
  assert.equal(queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(queries.filter(q => q.sql.includes('v_materializable_artifacts')).length, 1);
  assert.deepEqual(postgres.sort((a,b) => a.path.localeCompare(b.path)), projected.rows);
  const invalid = { async query(sql, values) {
    if (sql.startsWith('SELECT * FROM')) throw Error('injected read failure');
    return client.query(sql, values);
  } };
  await assert.rejects(executePostgresArtifactCommand(invalid, ['canonical', 'legacy'], 'list-reconciliation', { instanceId: 'inventory' }), /injected read failure/);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');

  // The same byte bound still refuses an oversized relevant history.
  for (const name of foreignPaths) {
    const row = store.getArtifact(name), record = JSON.parse(row.content);
    record.intent.instance_id = 'oversized';
    store.upsertArtifact({ ...row, content: JSON.stringify(record), sha256: undefined });
  }
  assert.throws(() => artifacts.observeInventory({ instanceId: 'oversized' }), /STANDARD_ARTIFACT_INVENTORY_TRUNCATED/);

  console.log(JSON.stringify({ status: 'PASS', sqlite_large_foreign_history: true, all_digests_preserved: true,
    signed_orphan_discovered: true, foreign_corruption_refused: true, postgres_atomic_projection_double: true,
    authority_unchanged: true, relevant_content_bound_preserved: true, native_calls: 0, live_postgres: 'SKIP' }));
} finally {
  store?.close();
  for (const dir of owned.reverse()) {
    const physical = fs.realpathSync(dir), temporary = fs.realpathSync(os.tmpdir());
    if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith('aidn-standard-ports-')) throw Error('PROJECTION_FIXTURE_CLEANUP_OUT_OF_SCOPE');
    fs.rmSync(physical, { recursive: true, force: true });
  }
}
