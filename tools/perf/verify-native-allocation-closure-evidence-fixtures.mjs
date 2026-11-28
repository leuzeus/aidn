import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createNativeAllocationAssessmentFixture } from './native-allocation-assessment-fixture-lib.mjs';
import { verifyNativePostAssignmentReconciliationFixture } from './native-post-assignment-reconciliation-fixture-lib.mjs';
import { createStandardWorkflowMixedHost } from '../../src/application/runtime/standard-workflow-mixed-composition.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { readNativeAllocationClosureEvidence } from '../../src/application/runtime/native-allocation-evidence.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const mode = process.argv[2] ?? 'dual';
assert(['dual', 'db-only'].includes(mode));
assert(process.argv.slice(3).every(arg => ['--reconciled', '--handoff-resources', '--handoff-context'].includes(arg)));
assert(!process.argv.includes('--handoff-resources') || process.argv.includes('--reconciled'));
assert(!process.argv.includes('--handoff-context') || process.argv.includes('--handoff-resources'));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
function tree(root) {
  const result = {};
  const walk = at => {
    for (const row of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, row.name), key = path.relative(root, file).replaceAll(path.sep, '/');
      if (row.isSymbolicLink()) result[key] = 'LINK:' + fs.readlinkSync(file);
      else if (row.isDirectory()) { result[key + '/'] = 'DIRECTORY'; walk(file); }
      else result[key] = sha(fs.readFileSync(file));
    }
  };
  walk(root); return result;
}
let checks = 0;
function readonly(name, roots, run) {
  const before = roots.map(tree); const result = run();
  assert.deepEqual(roots.map(tree), before, name + ': all read roots must stay unchanged');
  checks++; console.log('PASS ' + name); return result;
}
const fixture = await createNativeAllocationAssessmentFixture(mode);
const variants = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-native-closure-reader-'));
const roots = [fixture.root, fixture.privateRoot, variants];
const observe = (journal, configuration = fixture.configuration, reconciliationHistory) => readNativeAllocationClosureEvidence({
  journal, configuration, signer: fixture.signer, reconciliationHistory });
readonly('absent journal reports no retained allocation and grants no global closure', roots, () => {
  const result = observe(null); assert.equal(result.retained_history_status, 'not_allocated');
  assert.deepEqual(result.entries, []); assert.equal(result.complete_resource_closure, false); assert.equal(result.permits_effects, false);
});
readonly('authenticated unreconciled failure stays unresolved with its original failure and debit', roots, () => {
  const journal = fixture.store.read(fixture.journalId).record, before = H(journal), result = observe(journal);
  assert.equal(result.retained_history_status, 'reconciliation_required'); assert.equal(result.entries[0].status, 'unresolved');
  assert.equal(result.entries[0].original_phase, 'failed'); assert.equal(result.entries[0].original_first_failure, 'SYNTHETIC_NATIVE_FAILURE');
  assert.equal(H(journal), before); assert.deepEqual(journal, fixture.failed);
});
// Explicitly synthetic journal/checkpoint/supervisor variants. Only the signer,
// bounded physical file reads and original canonical fixture stores are actual.
function closedVariant(name, { parentClosed = true, treeClosed = true } = {}) {
  const configuration = { ...fixture.configuration, control_root: path.join(variants, name) }, configurationSha = H(configuration);
  const old = fixture.failed.allocations[0], limits = { ...old.limits, configuration_sha256: configurationSha };
  const authorization = H({ synthetic: name, configuration_sha256: configurationSha });
  const state = { ...json(fixture.checkpoint).state, parent_closed: parentClosed };
  const checkpoint = { state, response_sha256: [], responses_observed: 0, authorized_budget_sha256: authorization,
    authorized_limits: limits, resume_authority: 'NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED' };
  const checkpointFile = path.join(configuration.control_root, configuration.instance_id, '00001-native-host-state.json'); save(checkpointFile, checkpoint);
  const closure = { status: 'WAITING', first_failure: null, authorized_at_ms: limits.authorized_at_ms, global_deadline_ms: limits.global_deadline_ms,
    process_tree: { termination_state: treeClosed ? 'confirmed' : 'unknown', termination_proof: { active_processes: treeClosed ? 0 : 1 } } };
  const closureFile = path.join(configuration.control_root, configuration.instance_id + '-CLOSURE.json'); save(closureFile, closure);
  const entry = { ...old, configuration_sha256: configurationSha, authorization_sha256: authorization, limits,
    phase: 'closed', owned_status: 'WAITING', first_failure: null, owned_result_sha256: H(closure), tree_proof_sha256: H(closure.process_tree), tree_closed: treeClosed,
    checkpoint: { path: checkpointFile, sha256: sha(fs.readFileSync(checkpointFile)), state_sha256: H(state), instance_sha256: state.instance.instance_sha256 },
    closure_ref: { path: closureFile, sha256: sha(fs.readFileSync(closureFile)) } };
  const { key_id, authentication, ...body } = fixture.failed;
  return { configuration, journal: fixture.signer.seal({ ...body, allocations: [entry] }), checkpointFile, closureFile };
}
const normal = closedVariant('normal');
readonly('ordinary closed history reopens exact checkpoint and supervisor evidence without permission', roots, () => {
  const before = H(normal.journal), result = observe(normal.journal, normal.configuration);
  assert.equal(result.retained_history_status, 'verified_closed_history'); assert.equal(result.entries[0].status, 'ordinary_closed');
  assert.equal(result.entries[0].checkpoint_sha256, normal.journal.allocations[0].checkpoint.sha256);
  assert.equal(result.entries[0].closure_sha256, normal.journal.allocations[0].closure_ref.sha256);
  assert.equal(result.permits_effects, false); assert.equal(result.complete_resource_closure, false); assert.equal(H(normal.journal), before);
});
readonly('foreign configuration refuses before treating any retained history as closed', roots, () => {
  assert.throws(() => observe(normal.journal, { ...normal.configuration, instance_id: 'foreign' }), { code: 'NATIVE_ALLOCATION_SCOPE_CHANGED' });
  assert.throws(() => observe(normal.journal, { ...normal.configuration, product_files: [] }), { code: 'NATIVE_ALLOCATION_CONFIGURATION_CHANGED' });
});
readonly('invalid journal MAC refuses', roots, () => {
  const changed = structuredClone(normal.journal); changed.authentication = '0'.repeat(64);
  assert.throws(() => observe(changed, normal.configuration));
});
const badCheckpoint = closedVariant('changed-checkpoint'); fs.appendFileSync(badCheckpoint.checkpointFile, ' ');
readonly('changed checkpoint bytes refuse even if the signed journal still says closed', roots, () => {
  assert.throws(() => observe(badCheckpoint.journal, badCheckpoint.configuration), { code: 'NATIVE_ALLOCATION_EVIDENCE_CHANGED' });
});
const badClosure = closedVariant('changed-closure'); fs.appendFileSync(badClosure.closureFile, ' ');
readonly('changed supervisor closure bytes refuse', roots, () => {
  assert.throws(() => observe(badClosure.journal, badClosure.configuration), { code: 'NATIVE_ALLOCATION_EVIDENCE_CHANGED' });
});
const openParent = closedVariant('open-parent', { parentClosed: false });
readonly('host-signed ordinary closed journal cannot mask an open Native parent', roots, () => {
  assert.throws(() => observe(openParent.journal, openParent.configuration), { code: 'NATIVE_ALLOCATION_PARENT_UNCONFIRMED' });
});
const openTree = closedVariant('open-tree', { treeClosed: false });
readonly('unconfirmed OS tree cannot become ordinary closed history', roots, () => {
  assert.throws(() => observe(openTree.journal, openTree.configuration));
});
readonly('data-only reconciliation without the existing authenticated record and receipt cannot close failure', roots, () => {
  assert.throws(() => observe(fixture.failed, fixture.configuration, { resolution: () => ({ kind: 'reconciled_no_assignment' }) }),
    { code: 'NATIVE_RECONCILIATION_HISTORY_UNAUTHENTICATED' });
});
assert.deepEqual(fixture.store.read(fixture.journalId).record, fixture.failed, 'the actual original canonical failure stays unchanged');
let reconciled = 'NOT_RUN', contextRead = 'NOT_RUN';
if (process.argv.includes('--reconciled')) {
  const witness = await verifyNativePostAssignmentReconciliationFixture(mode), data = json(witness.data_file);
  const protectedRoots = [...new Set([data.root, data.configuration.control_root, data.configuration.review_root,
    data.configuration.native.home, data.operator_home, ...data.configuration.native.protected_roots])];
  const result = readonly('mixed host reads authenticated v5 reconciliation and physical retirement while preserving original failed allocation', protectedRoots, () => {
    const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home };
    const authority = createStandardHostAuthority({ configuration: data.configuration, environment }, { useProvider: false });
    // Match the post-assignment creator’s controlled key and actual mixed composition.
    const host = createStandardWorkflowMixedHost({ configuration: data.configuration, readSigningKey: () => Buffer.alloc(32, 91), environment,
      authorize: async () => { throw Error('UNEXPECTED_PRODUCT_OPERATION'); }, nativeAuthorizationSource: authority.nativeAuthorizationSource });
    const beforeJournal = host.inspectAllocations(), report = host.inspectNativeClosureEvidence();
    assert.deepEqual(host.inspectAllocations(), beforeJournal); return report;
  });
  assert.equal(result.retained_history_status, 'verified_closed_history'); assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].status, 'reconciled_post_assignment'); assert.equal(result.entries[0].original_phase, 'failed');
  assert.equal(result.entries[0].reconciliation_receipt_sha256, witness.receipt_sha256);
  assert.equal(result.entries[0].reconciliation_record_sha256, witness.record_sha256);
  assert.equal(result.permits_effects, false); assert.equal(result.complete_resource_closure, false);
  reconciled = 'PASS_ACTUAL_MIXED_HOST_CANONICAL_STORES_AND_AUTHENTICATED_RECONCILIATION';
  if (process.argv.includes('--handoff-resources')) {
    const before = protectedRoots.map(tree), environment = { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home };
    let currentChecks = 0;
    const source = {
      async read({ request }) {
        return { contract_version: 'standard-handoff-resource-observation.v1', authority_id: 'fixture_handoff_discoverer',
          request_sha256: H(request), observed_at_ms: Date.now(), evidence_class: 'fixture',
          evidence_refs: [{ ref: 'fixture:controlled-independent-discovery', sha256: H(request) }],
          domains: ['deterministic', 'native', 'human', 'control', 'process', 'git', 'provider'].map(domain => ({ domain,
            complete: true, active_resources: 0, state: 'closed',
            evidence_refs: [{ ref: 'fixture:controlled-domain-' + domain, sha256: H({ request, domain }) }] })) };
      },
      async verify({ request, observation }) { return { outcome: 'verified', authority_id: observation.authority_id,
        request_sha256: H(request), observation_sha256: H(observation), evidence_class: 'fixture' }; },
      assertCurrent() { currentChecks++; assert.deepEqual(protectedRoots.map(tree), before); },
    };
    const host = createStandardWorkflowMixedHost({ configuration: data.configuration, readSigningKey: () => Buffer.alloc(32, 91), environment,
      authorize: async () => { throw Error('UNEXPECTED_PRODUCT_OPERATION'); }, handoffResourceSource: source });
    const journal = host.inspectAllocations(), request = host.prepareHandoffResourceRequest();
    const observed = await host.inspectHandoffResources(request, { sourceRef: 'fixture-handoff' });
    assert.equal(observed.evidence_class, 'fixture'); assert.equal(observed.complete_resource_closure, true); assert.equal(observed.snapshot_only, true);
    assert.equal(observed.permits_handoff, false); assert.equal(observed.permits_effects, false); assert.equal(observed.written, false);
    assert.deepEqual(host.inspectAllocations(), journal); assert.equal(journal.allocations[0].phase, 'failed');
    assert.deepEqual(protectedRoots.map(tree), before); assert.equal(currentChecks, 1);
    checks++; console.log('PASS real mixed handoff resource reads retain reconciled v5 and all owned roots without allocating Native');
    if (process.argv.includes('--handoff-context')) {
      const context = host.inspectHandoffContext();
      assert.equal(context.instance_sha256, host.inspect().record.instance_sha256);
      assert.equal(context.state_mode, mode); assert.equal(context.canonical_source, mode === 'files' ? 'files' : 'sqlite');
      for (const key of ['permits_effects', 'permits_handoff', 'complete_resource_closure', 'written']) assert.equal(context[key], false);
      assert.deepEqual(host.inspectAllocations(), journal); assert.deepEqual(protectedRoots.map(tree), before);
      checks++; contextRead = 'PASS_ACTUAL_MIXED_CANONICAL_CONTEXT';
      console.log('PASS actual mixed canonical handoff context preserves all owned roots and the original Native journal');
    }
  }
}
console.log(JSON.stringify({ status: 'PASS', checks, state_mode: mode, scope: 'READONLY_RETAINED_NATIVE_HISTORY_FOR_HANDOFF',
  synthetic_ordinary_journal_checkpoint_and_OS_closure: true, canonical_signer_and_file_reads: 'ACTUAL', authenticated_reconciled_history: reconciled,
  canonical_handoff_context: contextRead,
  complete_handoff: 'NOT_PROVEN', global_resource_closure: 'NOT_PROVEN', genuine_Native_Human_installed_full_STANDARD: 'NOT_RUN' }));
