import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { transport } from './agentic-native-rpc-fixture-lib.mjs';
import { producePublicNativeEntryFixture, runPublicNativeEntryFixtureCLI as run, applyPublicNativeEntryFixtureCLI as apply,
  runPublicNativeEntryFixtureConsole as runConsole, applyPublicNativeEntryFixtureConsole as applyConsole,
  selectPublicNativeEntryFixtureSource as selectSource, issuePublicNativeEntryFixtureSource as issue,
  interruptPublicNativeEntryFixtureCAS } from './standard-native-entry-fixture-lib.mjs';
import { createStandardWorkflowExecution } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { runStandardWorkflowAction } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { createProjectAgenticProcessExecution } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { createNativeAllocationWorkerAuthority } from '../../src/application/runtime/native-allocation-worker-authority.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { assertNativeAllocationJournal } from '../../src/core/workflow/native-allocation-journal.mjs';
import { assertNativeReconciliationRecord, nativeReconciliationId, nativeReconciliationPath, retainedNativeReconciliationReceipt } from '../../src/core/workflow/native-allocation-reconciliation-record.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';

const script = fileURLToPath(import.meta.url), read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const artifacts = data => createStandardWorkflowArtifacts({ targetRoot: data.root });
const canonical = data => H(artifacts(data).observeInventory());
function worker(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16777216 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).findLast(line => line.startsWith('{')));
}
async function retainPostAssignmentFailure({ data, configuration, key, modelSource, instance, artifacts: a }) {
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home };
  const local = createStandardHostAuthority({ configuration, environment }, { useProvider: false });
  const fixture = { configuration, base: data.base, dirs: { product: configuration.product_root, control: configuration.control_root } };
  const rpc = transport(fixture, { readOnlyAnswer: true, answer({ params }) {
    const observed = JSON.parse(params.input[0].text.split('\n').at(-1));
    assert.equal(observed.context.contract_version, 'standard-mode-work-context.v1');
    assert.equal(observed.context.mode, 'THINKING');
    return { outcome: 'completed', summary: 'Controlled read-only analysis accepted before the supervisor return fails.', report: {
      contract_version: 'standard-mode-work-report.v1', context_sha256: observed.context_sha256, mode: 'THINKING',
      objective: observed.context.objective, disposition: 'thinking_complete', findings: ['The product exports value 1.'],
      rationale: 'Fixture answer bound to the actual published analysis context.', evidence_refs: observed.evidence_refs } };
  } });
  let launches = 0;
  const controllerFactory = () => ({ async checkAvailability() { return { available: true }; }, async run(request, { onEvent }) {
    launches++;
    const sent = JSON.parse(request.stdin);
    let native;
    const authority = createNativeAllocationWorkerAuthority({ configuration, authorization: sent.authorization,
      admission: sent.allocation, readProductSha256: () => native.preview().product_sha256, environment });
    native = createProjectAgenticProcessExecution(configuration, { rpcFactory: rpc.rpcFactory,
      allocationAuthority: authority, processAuthority: authority.processAuthority, environment });
    const result = await native.run({ execute: true, authorization: sent.authorization });
    await onEvent({ type: 'stdout', bytes: Buffer.from(JSON.stringify(result)) });
    // Only the transport and supervisor closure are controlled. The accepted
    // result, checkpoint, allocator, signatures, journals and CAS use real ports.
    return { outcome: 'failed', reason_code: 'FIXTURE_POST_NATIVE_RETURN_FAILURE', termination_state: 'confirmed',
      termination_proof: { active_processes: 0 } };
  } });
  const host = createStandardWorkflowExecution({ configuration, modelSource, readSigningKey: key, environment,
    humanSource: local.humanSource, authorize: async () => { throw Error('UNEXPECTED_POST_FIXTURE_OPERATION'); } }, { controllerFactory });
  const now = Date.now(), authorization = { approved: true, model_allowed: true, configuration_sha256: H(configuration),
    authorized_at_ms: now, global_deadline_ms: now + 600000, workflow_deadline_ms: now + 600000,
    max_turn_ms: 60000, max_responses: 1, max_bytes: 33554432 };
  fs.writeFileSync(path.join(data.base, 'original-controlled-native-authorization.json'), JSON.stringify(authorization), { flag: 'wx' });
  const input = { request: data.request, configuration, parameters: data.request.parameters, modelSource, authorization };
  const ports = { authority: local, compose: () => host };
  const action = await runStandardWorkflowAction(input, ports);
  assert.equal(action.preview.kind, 'native');
  const applied = await runStandardWorkflowAction({ ...input, preparedAction: action.preview, execute: true,
    expectPlan: action.action_sha256 }, ports);
  assert.equal(applied.result.action_kind, 'native'); assert.equal(applied.result.workflow_completed, false);
  assert.equal(applied.result.written, true);
  const result = applied.result.details;
  assert.equal(result.kind, 'native'); assert.equal(result.status, 'FAILED'); assert.equal(launches, 1); assert.equal(rpc.sessions.length, 1);
  assert.equal(rpc.sessions.every(row => row.closed), true);
  const journal = assertNativeAllocationJournal(host.inspectAllocations()), entry = journal.allocations[0];
  assert.equal(journal.allocations.length, 1); assert.equal(entry.phase, 'failed'); assert.equal(entry.consumption.responses_observed, 1);
  assert.equal(result.first_failure, entry.first_failure);
  assert.equal(result.journal_sha256, H(journal));
  assert.equal(entry.initial_instance_sha256, instance.instance_sha256);
  const current = host.inspectDiagnostic().record;
  assert.notEqual(current.instance_sha256, instance.instance_sha256);
  const dispatches = a.observeInventory().rows.filter(row => row.path.startsWith('workflows/native-dispatches/'))
    .map(row => JSON.parse(row.content)).filter(row => row.kind === 'allocation' && row.journal_id === journal.journal_id && row.phase === 'returned');
  assert.equal(dispatches.length, 1);
  return { journalId: journal.journal_id, dispatch: dispatches[0], input: { dispatchId: dispatches[0].dispatch_id,
    generation: 1, expectedSha256: current.instance_sha256 } };
}
export async function verifyPublicPostAssignmentNativeEntryFixture(mode) {
  assert.ok(['files', 'dual', 'db-only'].includes(mode));
  const proof = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-public-post-native-proof-')), file = path.join(proof, 'fixture.json');
  worker(['produce', mode, file]); const data = read(file), a = artifacts(data), original = canonical(data);
  const nativeRows = a.observeInventory().rows.filter(row => row.path.startsWith('workflows/native-allocations/'));
  assert.equal(nativeRows.length, 1); const originalNative = assertNativeAllocationJournal(JSON.parse(nativeRows[0].content));
  const originalEntry = originalNative.allocations[0], originalCheckpoint = fs.readFileSync(originalEntry.checkpoint.path);
  const operator = createStandardHostAuthority({ configuration: data.configuration,
    environment: { ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home } }, { useProvider: false });
  const signer = createOperationJournalSigner(() => operator.readKey()); signer.verify(originalNative);
  const ownerConsole = runConsole(data, { operation: 'run', input: { configuration: data.config_file } });
  assert.deepEqual(ownerConsole.errors, [], JSON.stringify(ownerConsole));
  const owner = ownerConsole.action.preview;
  assert.equal(owner.preview.contract_version, 'standard-workflow-native-action.v2'); assert.equal(owner.preview.profile, 'admitted_post_assignment');
  assert.equal(owner.preview.kind, 'native_owner_retire'); assert.equal(owner.preview.payload.plan.contract_version, 'native-owner-disposition-plan.v2');
  assert.equal(canonical(data), original);
  const downgraded = structuredClone(owner.preview); downgraded.contract_version = 'standard-workflow-native-action.v1'; delete downgraded.profile;
  fs.writeFileSync(data.action_file, JSON.stringify(downgraded));
  assert.equal(run(data, ['--action-file', data.action_file]).errors[0], 'STANDARD_ENTRY_ACTION_INVALID'); assert.equal(canonical(data), original);
  const forged = structuredClone(owner.preview); forged.payload.plan.authentication = '0'.repeat(64);
  fs.writeFileSync(data.action_file, JSON.stringify(forged));
  assert.equal(run(data, ['--action-file', data.action_file]).errors[0], 'PROCESS_JOURNAL_NOT_AUTHENTICATED'); assert.equal(canonical(data), original);
  const retired = applyConsole(data, owner, ownerConsole.action_sha256);
  assert.deepEqual(retired.errors, [], JSON.stringify(retired)); assert.equal(retired.result.contract_version, 'standard-workflow-native-result.v2');
  assert.equal(retired.result.profile, 'admitted_post_assignment'); assert.equal(retired.result.native_started, false);
  const afterRetirement = canonical(data), ownerReplay = apply(data, owner);
  assert.deepEqual(ownerReplay.errors, [], JSON.stringify(ownerReplay)); assert.equal(ownerReplay.written, false); assert.equal(canonical(data), afterRetirement);
  const missing = run(data); assert.deepEqual(missing.errors, [], JSON.stringify(missing));
  assert.equal(missing.preview.kind, 'native_allocation_reconcile'); assert.equal(missing.preview.contract_version, 'standard-workflow-native-action.v2');
  assert.equal(missing.can_apply, false); const reconciliation = selectSource(data, missing, 'fixture-public-post-reconciliation');
  const q = reconciliation.preview.payload.preparation.request;
  assert.equal(q.contract_version, 'native-allocation-reconciliation-request.v2'); assert.equal(q.minimum_consumption.responses_observed, 1);
  assert.ok(q.resources.some(row => row.kind === 'native_scope')); assert.ok(q.resources.some(row => row.kind === 'native_session'));
  const absent = apply(data, reconciliation); assert.deepEqual(absent.errors, [], JSON.stringify(absent));
  assert.equal(absent.result.details.status, 'WAITING'); assert.equal(canonical(data), afterRetirement);
  issue(data, reconciliation.preview, 'fixture-public-post-reconciliation', true);
  assert.equal(apply(data, reconciliation).errors[0], 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED'); assert.equal(canonical(data), afterRetirement);
  issue(data, reconciliation.preview, 'fixture-public-post-reconciliation');
  if (mode === 'files') {
    fs.writeFileSync(data.action_file, JSON.stringify(reconciliation.preview)); worker(['interrupt', file, data.action_file]);
    const sourceFile = path.join(data.operator_home, 'inbox/fixture-public-post-reconciliation.json');
    fs.writeFileSync(path.join(data.base, 'retained-original-reconciliation-source.json'), fs.readFileSync(sourceFile), { flag: 'wx' }); fs.unlinkSync(sourceFile);
  }
  const reconciled = applyConsole(data, reconciliation);
  assert.deepEqual(reconciled.errors, [], JSON.stringify(reconciled)); assert.equal(reconciled.result.contract_version, 'standard-workflow-native-result.v2');
  assert.equal(reconciled.result.native_started, false); assert.equal(reconciled.result.workflow_completed, false);
  const afterReconciliation = canonical(data), replay = apply(data, reconciliation);
  assert.deepEqual(replay.errors, [], JSON.stringify(replay)); assert.equal(replay.written, false); assert.equal(canonical(data), afterReconciliation);
  const native = assertNativeAllocationJournal(JSON.parse(a.read('workflows/native-allocations/' + q.journal_id + '.json', { required: true }).content));
  const record = assertNativeReconciliationRecord(JSON.parse(a.read(nativeReconciliationPath(nativeReconciliationId(q.journal_id, 1)), { required: true }).content));
  const receipt = retainedNativeReconciliationReceipt(record); for (const value of [native, record, receipt]) signer.verify(value);
  assert.equal(native.contract_version, 'native-allocation-journal.v5'); assert.equal(record.phase, 'confirmed');
  assert.equal(record.attempts.length, mode === 'files' ? 2 : 1); assert.deepEqual(native.allocations, originalNative.allocations);
  assert.deepEqual(receipt.grant.consumption.response_sha256, originalEntry.consumption.response_sha256);
  assert.ok(receipt.grant.consumption.storage_debit_bytes >= originalEntry.consumption.storage_debit_bytes);
  assert.equal(a.read('workflows/native-dispatches/' + data.input.dispatchId + '.json').sha256, data.original_dispatch_sha256);
  assert.deepEqual(fs.readFileSync(originalEntry.checkpoint.path), originalCheckpoint); assert.equal(a.resourceFence().read().record.state, 'released');
  if (mode === 'db-only') assert.equal(fs.existsSync(path.join(data.root, 'docs/audit', nativeReconciliationPath(record.reconciliation_id))), false);
  // Accounting confirmation supplies no operation grant. A separate exact
  // ordinary action must admit and perform the next deterministic business port.
  const next = run(data); assert.deepEqual(next.errors, [], JSON.stringify(next)); assert.equal(next.preview.kind, 'operation');
  const resumed = apply(data, next); assert.deepEqual(resumed.errors, [], JSON.stringify(resumed)); assert.equal(resumed.written, true);
  assert.equal(resumed.result.native_started, false);
  const finalNative = assertNativeAllocationJournal(JSON.parse(a.read('workflows/native-allocations/' + q.journal_id + '.json', { required: true }).content));
  assert.equal(finalNative.allocations.length, 1); assert.deepEqual(finalNative.allocations, originalNative.allocations);
  return { status: 'PASS_PUBLIC_POSTASSIGNMENT_NATIVE_RESOURCE_ACTIONS', mode, proof, root: data.root,
    actual_published_model_CLI_console_operator_HMAC_Ed25519: true, Native_RPC_OS_closure_and_consent: 'CONTROLLED_FIXTURE',
    controlled_accepted_responses: 1, Native_model_calls: 0, original_failure_work_consumption_preserved: true,
    FILES_cold_after_CAS_without_resource_envelope: mode === 'files', separate_actual_deterministic_operation_after_accounting: true,
    Native_allocations: 1, new_Native_allocations: 0, new_epoch_or_Native_resume: 'NOT_RUN_BY_THIS_CASE',
    genuine_Native_Human_installed_provider_full_plan: 'NOT_QUALIFIED' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const [action, first, second] = process.argv.slice(2);
    if (action === 'produce') {
      const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const workerFile = fileURLToPath(new URL('../../src/adapters/agents/agentic-process-worker.mjs', import.meta.url));
      await producePublicNativeEntryFixture(first, second, { nativeModel: 'fixture-model',
        controllerPins: { node_sha256: hashFile(process.execPath), worker_sha256: hashFile(workerFile) }, retainFailure: retainPostAssignmentFailure });
    }
    else if (action === 'interrupt') await interruptPublicNativeEntryFixtureCAS(read(first), read(second));
    else if (action === 'verify') console.log(JSON.stringify(await verifyPublicPostAssignmentNativeEntryFixture(first)));
    else throw Error('PUBLIC_POST_ASSIGNMENT_FIXTURE_ACTION_INVALID');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
