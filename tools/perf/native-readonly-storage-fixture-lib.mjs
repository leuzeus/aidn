import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { advanceAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { createAgenticProcessStore } from '../../src/adapters/runtime/agentic-process-store.mjs';
import { createNativeAllocationJournalStore } from '../../src/adapters/runtime/native-allocation-journal-store.mjs';
import { createWorkflowRecordStore } from '../../src/adapters/runtime/workflow-record-store.mjs';
import { assertNativeDispatchRecord, nativeDispatchPath } from '../../src/core/workflow/native-dispatch-record.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// The common host runs with controlled RPC and supervisor doubles. Rewriting
// this disposable corpus below creates a retained pre-fix storage failure.
// No production instance, Native client or model participates in this setup.
export async function createReadOnlyStorageStopFixture({ mode, operatorHome, mixedFixture, bootstrapMixed }) {
  const options = { cancelWorkerGeneration: 3, signingKey: Buffer.alloc(32, 73) };
  const f = mixedFixture(mode, options);
  f.configuration.native.protected_roots = [operatorHome];
  const authorization = await bootstrapMixed(f);
  const first = await f.open().step({ write: true, authorization });
  assert.equal(first.kind, 'native');
  assert.equal(first.journal_phase, 'closed');
  await f.open().step({ write: true });
  const before = f.open().inspect().record;
  options.postAssignmentReturnFailure = true;
  const second = await f.open().step({ write: true, authorization });
  assert.equal(second.kind, 'native');
  const optionsStore = { targetRoot: f.configuration.target_root, stateMode: mode };
  const instances = createAgenticProcessStore(optionsStore);
  const current = instances.read(f.configuration.instance_id);
  const assignment = current.record.events[before.events.length];
  assert.equal(assignment.kind, 'assign');
  const interrupted = advanceAgenticProcess(before, assignment);
  const canonical = instances.compareAndSwap(interrupted, current.content_sha256);
  if (canonical.projection === 'pending') instances.materialize(interrupted.instance_id, { write: true });

  const journals = createNativeAllocationJournalStore(optionsStore);
  const journal = f.open().inspectAllocations();
  assert.equal(journal.allocations.length, 2);
  const previous = journal.allocations[1];
  assert.equal(previous.phase, 'failed');
  assert.equal(previous.tree_closed, true);
  const signer = createOperationJournalSigner(() => f.key);
  const allocations = [journal.allocations[0], { ...previous,
    first_failure: 'PROCESS_EXECUTION_STORAGE_LIMIT', checkpoint: null, closure_ref: null, consumption: null }];
  const retained = signer.seal({ ...journal, revision: journal.revision + 1, allocations });
  const journalWrite = journals.compareAndSwap(retained, journals.read(journal.journal_id).content_sha256);
  if (journalWrite.projection === 'pending') journals.materialize(journal.journal_id, { write: true });
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: f.configuration.target_root });
  const dispatch = artifacts.observeInventory().rows
    .filter(row => row.path.startsWith('workflows/native-dispatches/'))
    .map(row => JSON.parse(row.content))
    .find(row => row.instance_sha256 === before.instance_sha256);
  assert.equal(dispatch.phase, 'returned');
  const dispatches = createWorkflowRecordStore({ ...optionsStore, descriptor: {
    pathForId: nativeDispatchPath, validate: assertNativeDispatchRecord, idOf: row => row.dispatch_id,
    hashOf: H, kind: 'native_allocation_journal' } });
  const updated = signer.seal({ ...dispatch, revision: dispatch.revision + 1,
    native_journal_after_sha256: H(retained) });
  const dispatchWrite = dispatches.compareAndSwap(updated, dispatches.read(dispatch.dispatch_id).content_sha256);
  if (dispatchWrite.projection === 'pending') dispatches.materialize(dispatch.dispatch_id, { write: true });
  for (const file of [previous.checkpoint.path, previous.closure_ref.path]) {
    assert(!path.relative(f.configuration.control_root, file).startsWith('..'));
    fs.unlinkSync(file);
  }
  return { mode, root: f.configuration.target_root, private_root: f.base, operator_home: operatorHome,
    configuration: f.configuration, model: f.model, journal_id: journal.journal_id,
    input: { expectedSha256: interrupted.instance_sha256, dispatchId: dispatch.dispatch_id, generation: 2 },
    original_journal_sha256: artifacts.read('workflows/native-allocations/' + journal.journal_id + '.json').sha256,
    original_dispatch_sha256: artifacts.read(nativeDispatchPath(dispatch.dispatch_id)).sha256,
    model_calls: 0, proof_class: 'synthetic-legacy-storage-stop-with-real-canonical-owner-ports' };
}
