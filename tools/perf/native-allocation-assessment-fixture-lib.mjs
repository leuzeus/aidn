import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { createNativeDispatchProvenance } from '../../src/application/runtime/native-dispatch-provenance.mjs';
import { readAgenticProductSnapshot } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createNativeAllocationJournalStore } from '../../src/adapters/runtime/native-allocation-journal-store.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { nativeJournalId } from '../../src/core/workflow/native-allocation-journal.mjs';
import { assertNativeAllocationAssessment } from '../../src/core/workflow/native-allocation-assessment.mjs';
import { assertNativePostAssignmentAssessment } from '../../src/core/workflow/native-post-assignment-assessment.mjs';
import { verifyNativePostAssignmentAssessmentContracts } from './native-post-assignment-assessment-fixture-lib.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tree = root => {
  const files = {}, directories = [];
  function visit(at) {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, entry.name), relative = path.relative(root, file).replaceAll(path.sep, '/');
      if (entry.isSymbolicLink()) files[relative] = 'LINK:' + fs.readlinkSync(file);
      else if (entry.isDirectory()) { directories.push(relative); visit(file); }
      else files[relative] = sha(fs.readFileSync(file));
    }
  }
  visit(root); return { files, directories };
};

// Real canonical stores, signing and owner/fence ports; the retained checkpoint,
// failed allocator return and OS tree evidence below are explicitly synthetic.
// This fixture starts no Native client, process tree, model or human actor.
export async function createNativeAllocationAssessmentFixture(mode, { protectedHome = null, parentClosed = true, retainAuthorization = false } = {}) {
  const retained = [], root = createFreshStandardWorkflowFixture(mode, retained);
  const privateRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-native-assessment-')); retained.push(privateRoot);
  const configuration = { target_root: root, instance_id: 'assessment-case', product_root: path.join(root, 'product'), product_files: ['app.mjs'],
    control_root: path.join(privateRoot, 'control'), review_root: path.join(privateRoot, 'review'), native: { home: path.join(privateRoot, 'home'), tool_roots: [], protected_roots: protectedHome ? [protectedHome] : [] } };
  for (const directory of [configuration.product_root, configuration.control_root, configuration.review_root, configuration.native.home]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(configuration.product_root, 'app.mjs'), 'export const value = 1;\n');
  const key = () => Buffer.alloc(32, 73), binding = standardWorkflowOperationBindings().find(row => row.id === 'context_reload');
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'native-assessment-component', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'observe', operation_pins: { context_reload: H(binding) },
    nodes: [{ id: 'observe', kind: 'operation', participant_ref: 'project', binding_ref: 'context_reload' }] };
  const productSnapshot = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files);
  const authority = createStandardProcessAuthority({ configuration, model, readSigningKey: key, readProductSnapshot: productSnapshot, readProductSha256: () => H(productSnapshot()) });
  const hostOptions = { targetRoot: root, model, readSigningKey: key, authorize: async () => null, processAuthority: authority, reconciliationConfiguration: configuration };
  const host = createStandardWorkflowOperationHost(hostOptions), preview = host.initialize({ instanceId: configuration.instance_id });
  host.initialize({ instanceId: configuration.instance_id, write: true, expectedResultSha256: preview.record.instance_sha256 });
  const instance = host.inspect(configuration.instance_id).record, artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  return retainFailedNativeAllocationFixture({ mode, retained, root, privateRoot, configuration, key, model, productSnapshot, authority, hostOptions, host, instance, artifacts, retainAuthorization, parentClosed });
}

// The caller supplies an actual canonical instance. Only the failed Native
// return/checkpoint/OS closure are synthetic; provenance owns the real process.
export async function retainFailedNativeAllocationFixture({ mode, retained, root, privateRoot, configuration, key, model, productSnapshot, authority, hostOptions, host, instance, artifacts, retainAuthorization = false, parentClosed = true }) {
  const signer = createOperationJournalSigner(key);
  const journalId = nativeJournalId(instance), options = { targetRoot: root, stateMode: mode }, store = createNativeAllocationJournalStore(options);
  const limits = { configuration_sha256: H(configuration), authorized_at_ms: 1, global_deadline_ms: 100, workflow_deadline_ms: 100,
    max_turn_ms: 10, max_responses: 1, max_bytes: 1048576 };
  const originalAuthorization = { approved: true, model_allowed: true, ...limits };
  const allocation = { generation: 1, owner_id: 'synthetic_retained', configuration_sha256: H(configuration), authorization_sha256: retainAuthorization ? H(originalAuthorization) : H('synthetic-original-grant'),
    initial_instance_sha256: instance.instance_sha256, limits, phase: 'reserved', owned_result_sha256: null, tree_proof_sha256: null,
    tree_closed: false, owned_status: null, first_failure: null, checkpoint: null, consumption: null, closure_ref: null };
  const reserved = signer.seal({ contract_version: 'native-allocation-journal.v1', journal_id: journalId, instance_id: instance.instance_id,
    scope_id: instance.scope_id, model_sha256: instance.model_sha256, revision: 1, allocations: [allocation] });
  store.compareAndSwap(reserved, null);
  const state = { contract_version: 'native-host-state.v1', authority_id: 'synthetic_retained', instance, parent_closed: parentClosed, resources: [], results: [], native_usage: null };
  const evidence = { state, responses_observed: 0, response_sha256: [], authorized_budget_sha256: allocation.authorization_sha256, authorized_limits: limits,
    resume_authority: 'NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED' };
  const checkpoint = path.join(configuration.control_root, instance.instance_id, '00001-native-host-state.json');
  fs.mkdirSync(path.dirname(checkpoint)); fs.writeFileSync(checkpoint, JSON.stringify(evidence));
  const closure = { status: 'FAILED', first_failure: 'SYNTHETIC_NATIVE_FAILURE', authorized_at_ms: limits.authorized_at_ms,
    global_deadline_ms: limits.global_deadline_ms, process_tree: { termination_state: 'confirmed', termination_proof: { active_processes: 0 } } };
  const closureFile = path.join(configuration.control_root, instance.instance_id + '-CLOSURE.json'); fs.writeFileSync(closureFile, JSON.stringify(closure));
  const failed = signer.seal({ ...reserved, revision: 2, allocations: [{ ...allocation, phase: 'failed', owned_result_sha256: H(closure),
    tree_proof_sha256: H(closure.process_tree), tree_closed: true, owned_status: 'FAILED', first_failure: closure.first_failure,
    checkpoint: { path: checkpoint, sha256: sha(fs.readFileSync(checkpoint)), state_sha256: H(state), instance_sha256: instance.instance_sha256 },
    closure_ref: { path: closureFile, sha256: sha(fs.readFileSync(closureFile)) },
    consumption: { responses_observed: 0, response_sha256: [], storage_debit_bytes: 7, native_usage_sha256: null } }] });
  store.compareAndSwap(failed, store.read(journalId).content_sha256);
  const returned = { contract_version: 'journaled-native-allocation-result.v1', owned_result: closure, journal_id: journalId, generation: 1,
    journal_phase: 'failed', journal_sha256: H(failed), status: 'FAILED', first_failure: closure.first_failure, retry: false };
  const provenance = createNativeDispatchProvenance({ configuration, options, signer, journalId, processAuthority: authority,
    readJournal: () => store.read(journalId), readInstance: () => instance });
  await provenance.withOwner({ instance_id: instance.instance_id, authorization_sha256: allocation.authorization_sha256 }, async () => returned);
  const dispatch = JSON.parse(artifacts.observeInventory().rows.find(row => row.path.startsWith('workflows/native-dispatches/')).content);
  const input = { expectedSha256: instance.instance_sha256, dispatchId: dispatch.dispatch_id, generation: 1 };
  return { retained, root, privateRoot, configuration, key, signer, model, productSnapshot, authority, hostOptions, host, instance, artifacts, journalId, options, store, limits, allocation, failed, dispatch, input, checkpoint, ...(retainAuthorization ? { originalAuthorization } : {}) };
}
export async function verifyNativeAllocationAssessmentFixture(mode) {
  const { retained, root, privateRoot, configuration, signer, hostOptions, host, instance, artifacts, journalId, store, input, checkpoint } = await createNativeAllocationAssessmentFixture(mode);
  const before = { project: tree(root), private: tree(privateRoot) };
  const result = host.prepareNativeAllocationAssessment(instance.instance_id, input);
  signer.verify(result.inventory); signer.verify(result.assessment); assertNativeAllocationAssessment(result.assessment, result.inventory);
  assert.equal(result.assessment.assignment_status, 'no_assignment'); assert.equal(result.assessment.return_binding, 'matched');
  const post = host.prepareNativePostAssignmentAssessment(instance.instance_id, input);
  signer.verify(post.inventory); signer.verify(post.assessment); signer.verify(post.assessment.base_assessment);
  assertNativePostAssignmentAssessment(post.assessment, post.inventory);
  assert.equal(post.assessment.evidence_profile, 'unknown');
  assert.equal(post.assessment.base_assessment.assignment_status, 'no_assignment');
  assert.equal(post.assessment.permits_owner_retirement, false);
  verifyNativePostAssignmentAssessmentContracts(result, name => console.log('PASS ' + name));
  assert.equal(result.assessment.native_accounting_known, false); assert.equal(result.inventory.accounting.storage_debit_bytes_minimum, 7);
  assert.deepEqual(result.assessment.lease_statuses, ['held']); assert.equal(artifacts.ownerPending(), true);
  assert.equal(store.read(journalId).record.allocations[0].phase, 'failed');
  assert.equal(result.assessment.business_effect, 'unknown');
  assert.throws(() => host.inspect(instance.instance_id), { code: 'STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE' });
  const cold = createStandardWorkflowOperationHost(hostOptions).prepareNativeAllocationAssessment(instance.instance_id, input);
  signer.verify(cold.assessment); assert.equal(cold.assessment.assignment_status, 'no_assignment');
  for (const [name, mutate] of [
    ['resume', value => { value.permits_resume = true; }], ['effects', value => { value.permits_effects = true; }],
    ['renewal', value => { value.permits_native_renewal = true; }], ['retirement', value => { value.permits_owner_retirement = true; }],
    ['complete closure', value => { value.complete_resource_closure = true; }], ['write', value => { value.written = true; }],
    ['approval field', value => { value.approved = true; }], ['foreign instance', value => { value.instance_sha256 = H('foreign'); }],
    ['foreign original prefix', value => { value.initial_instance_sha256 = H('foreign'); }],
    ['known accounting', value => { value.native_accounting_known = true; }], ['released lease', value => { value.lease_statuses = ['released']; }],
    ['foreign checkpoint', value => { value.checkpoint.sha256 = H('foreign'); }],
    ['unconfirmed tree', value => { value.checkpoint.os_tree_confirmed = false; }],
    ['missing returned proof', value => { value.return_binding = 'not_proven'; }],
  ]) {
    const value = structuredClone(result.assessment); mutate(value);
    assert.throws(() => assertNativeAllocationAssessment(signer.seal(value), result.inventory), error => /NATIVE_ALLOCATION_ASSESSMENT_/.test(error.code));
  }
  for (const [name, mutate] of [
    ['missing returned proof', value => { value.return_binding = 'not_proven'; }],
    ['open parent', value => { value.checkpoint.parent_closed = false; }],
    ['unconfirmed tree', value => { value.checkpoint.os_tree_confirmed = false; }],
    ['observed responses', value => { value.checkpoint.responses_observed = 1; }],
  ]) {
    const value = structuredClone(result.assessment); mutate(value); value.assignment_status = 'unknown';
    assertNativeAllocationAssessment(signer.seal(value), result.inventory);
  }
  assert.throws(() => host.prepareNativeAllocationAssessment(instance.instance_id, { ...input, write: true }), { code: 'NATIVE_ALLOCATION_ASSESSMENT_INPUT_INVALID' });
  assert.throws(() => host.prepareNativeAllocationAssessment(instance.instance_id, { ...input, expectedSha256: H('stale') }), { code: 'PROCESS_REVISION_CONFLICT' });
  assert.throws(() => host.prepareNativeAllocationAssessment(instance.instance_id, { ...input, generation: 2 }), { code: 'NATIVE_ALLOCATION_ASSESSMENT_SUBJECT_CHANGED' });
  const foreign = createStandardWorkflowOperationHost({ ...hostOptions, reconciliationConfiguration: { ...configuration, instance_id: 'foreign-case' } });
  assert.throws(() => foreign.prepareNativeAllocationAssessment(instance.instance_id, input), { code: 'PROCESS_RECONCILIATION_RESOURCE_CHANGED' });
  const checkpointBytes = fs.readFileSync(checkpoint); fs.appendFileSync(checkpoint, '\n');
  assert.throws(() => host.prepareNativeAllocationAssessment(instance.instance_id, input), { code: 'NATIVE_ALLOCATION_EVIDENCE_CHANGED' });
  fs.writeFileSync(checkpoint, checkpointBytes);
  assert.deepEqual(tree(root), before.project); assert.deepEqual(tree(privateRoot), before.private);
  return { mode, scope: 'REAL_CANONICAL_SIGNING_OWNER_PORTS_SYNTHETIC_CHECKPOINT_AND_RETURN', assignment_status: 'no_assignment',
    accounting_known: false, owner_retired: false, lease_statuses: ['held'], read_only_bytes_and_directories: true,
    signed_cold_read: true, contract_substitutions_refused: 14, uncertain_claims_preserved: 4, Native_calls: 0, retained_roots: retained, full_standard: false };
}
