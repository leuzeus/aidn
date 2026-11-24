import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDispatchRecordStore } from '../../adapters/runtime/process-dispatch-record-store.mjs';
import { createNativeAllocationJournalStore } from '../../adapters/runtime/native-allocation-journal-store.mjs';
import { readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner, operationJournalId } from '../../core/workflow/process-operation-journal.mjs';
import { nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { inspectAgenticProcess } from '../../core/workflow/agentic-process.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { agenticPolicyPins } from '../../core/workflow/agentic-process-model.mjs';
import { observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { createLocalHandoffProcessDiscovery } from '../../adapters/runtime/local-handoff-process-discovery.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { inspectInterruptedReopenLock } from './local-artifact-owner-retirement.mjs';
import { createLocalArtifactResourceFence } from './local-artifact-resource-fence.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readWorkflowProjectExecutionAuthority } from './workflow-instance-composition.mjs';
import { createStandardWorkflowOperations } from './standard-workflow-operations.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createRetainedSessionClosureSource } from './standard-retained-session-closure-source.mjs';
import { createStandardProcessAuthority } from './standard-process-authority.mjs';
import { readSessionCloseObjectiveCompletion } from './session-close-objective-completion.mjs';
import { assertSessionCloseRecoveryRecord, sessionRecoveryOwnsFence, assertSessionCloseCheckpointOnly } from '../../core/workflow/standard-session-close-recovery.mjs';

const require = (ok, code = 'STANDARD_SESSION_RECOVERY_SUBJECT_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
const same = (a, b) => H(a) === H(b);
const pinned = ref => readAgentRunFile(ref.path, { sha256: ref.sha256 });
const eventFile = '.aidn/runtime/perf/workflow-events.ndjson', runFile = '.aidn/runtime/perf/current-run-id.txt';

// Read-only, deliberately narrow historical boundary: returned failed hook,
// exactly its diagnostic checkpoint suffix and unchanged canonical preimages.
// A close event, partial CAS, active/opaque scoped process or a different suffix
// is unresolved. This observer never calls the hook and never claims no effect.
export function createStandardSessionCloseRecoveryObserver({ targetRoot, stateMode, environment = process.env }) {
  const root = agentRunPhysicalPath(targetRoot, { directory: true }), options = { targetRoot: root, stateMode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  const dispatches = createProcessDispatchRecordStore(options), allocations = createNativeAllocationJournalStore(options);
  const artifacts = createStandardWorkflowArtifacts(options), fences = createLocalArtifactResourceFence(options);
  return async ({ instanceId, operationId, originalConfiguration }, { recovery = null } = {}) => {
    const execution = pinned(originalConfiguration).value;
    require(execution.instance_id === instanceId && execution.target_root === root, 'STANDARD_SESSION_RECOVERY_CONFIGURATION_CHANGED');
    const assertExecutionPins = () => {
      for (const ref of [execution.model, execution.criteria, ...Object.values(execution.authorities), ...Object.values(execution.skills), ...Object.values(execution.instructions)])
        readAgentRunFile(ref.path, { sha256: ref.sha256, json: false });
      readAgentRunFile(execution.native.executable, { sha256: execution.native.sha256, json: false, maxBytes: 536870912 });
    };
    assertExecutionPins();
    const instance = instances.read(instanceId).record;
    require(instance?.instance_id === instanceId && instance.initial_parameters?.entry_point?.kind === 'retained_session_closure');
    const cursor = inspectAgenticProcess(instance);
    const signer = createOperationJournalSigner(readStandardHostInstance({ targetRoot: root, instanceId, environment }).readKey);
    const records = instance.events.filter(row => row.kind === 'operation_intent').map(row => journals.read(row.intent.operation_id).record);
    require(same(records.map(row => row?.intent.binding_ref), ['workflow_entry_select', 'session_close_record', 'session_close_checkpoint', 'session_close_finalize']), 'STANDARD_SESSION_RECOVERY_BOUNDARY_CHANGED');
    for (const row of records) {
      require(row?.phase === 'receipted' && row.results.length === 1); signer.verify(row); signer.verify(row.preview);
      require(row.intent.instance_id === instanceId && row.intent.scope_id === instance.scope_id && row.intent.model_sha256 === instance.model_sha256
        && row.preview.snapshot.native.configuration_sha256 === H(execution)
        && row.results[0].receipt.output_sha256 === H(row.results[0].output)
        && row.results[0].receipt.effect_status === row.results[0].output.effect_status
        && instance.events.some(event => event.kind === 'operation_result' && same(event.receipt, row.results[0].receipt)));
    }
    const record = records.at(-1), original = record.results[0], intent = record.intent, preview = record.preview, plan = preview.prepared.plan;
    require(record.operation_id === operationId && cursor.status === 'WAITING' && cursor.occurrences.some(row => row.occurrence_id === intent.occurrence_id
      && row.status === 'WAITING' && row.wait_reason === 'reconciliation_required' && same(row.operation?.receipt, original.receipt)));
    require(original.receipt.outcome === 'reconciliation_required' && original.receipt.effect_status === 'unknown'
      && original.output.outcome === 'reconciliation_required' && original.output.observations.reason_code === 'STANDARD_SESSION_CLOSE_HOOK_UNCONFIRMED'
      && original.output.observations.exit_code === 1 && original.output.observations.hook === null && original.output.observations.sync === null
      && same(original.output.observations.committed, []) && same(original.output.facts, {})
      && operationJournalId(intent, intent.occurrence_id) === operationId && intent.binding_sha256 === H(preview.binding)
      && intent.input_sha256 === H(preview.input) && intent.preconditions_sha256 === H({ snapshot: preview.snapshot, prepared: preview.prepared })
      && ['instance_id', 'instance_sha256', 'scope_id', 'model_sha256', 'occurrence_id'].every(key => preview[key] === intent[key])
      && plan.contract_version === 'standard-session-close-hook-plan.v1' && plan.operation_id === operationId
      && preview.prepared.plan_sha256 === H(plan) && preview.prepared.can_apply === true && same(plan.input, preview.input));
    const native = allocations.read(nativeJournalId(instance)).record;
    if (native) { signer.verify(native); require(native.instance_id === instanceId && native.scope_id === instance.scope_id && native.model_sha256 === instance.model_sha256
      && native.allocations.every(row => row.configuration_sha256 === H(execution) && row.phase === 'closed' && row.tree_closed === true), 'STANDARD_SESSION_RECOVERY_NATIVE_UNSETTLED'); }
    const capsule = dispatches.read(operationId).record; require(capsule); signer.verify(capsule);
    require(capsule.phase === 'returned' && capsule.operation_id === operationId && capsule.instance_id === instanceId
      && capsule.scope_id === instance.scope_id && capsule.model_sha256 === instance.model_sha256 && capsule.intent_sha256 === H(intent) && capsule.preview_sha256 === H(preview)
      && capsule.physical_root_sha256 === H(root) && capsule.runtime_sha256 === H(artifacts.describe()) && capsule.output_sha256 === H(original.output)
      && capsule.leases.length === 1 && capsule.local_owner_intentions.length === 1);
    require(observeLocalProcessOwner(capsule.process_identity) === 'terminated', 'STANDARD_SESSION_RECOVERY_OWNER_UNRESOLVED');
    const lease = capsule.leases[0], intention = capsule.local_owner_intentions[0];
    require(observeLocalProcessOwner(lease.resource_fence.process_identity) === 'terminated', 'STANDARD_SESSION_RECOVERY_OWNER_UNRESOLVED');
    const discovery = createLocalHandoffProcessDiscovery({ targetRoot: root, controlRoot: execution.control_root,
      nativeExecutable: execution.native.executable, ownerIdentities: [capsule.process_identity, lease.resource_fence.process_identity] });
    const observeProcesses = () => { const found = discovery.observe();
      require(found.stable && found.samples.every(row => !row.processes.length && !row.unavailable.length), 'STANDARD_SESSION_RECOVERY_PROCESS_UNRESOLVED'); return found; };
    const processes = [observeProcesses()];
    const historical = await createRetainedSessionClosureSource({ configuration: execution, environment, createAuthority: createStandardProcessAuthority }).readRecorded(instance.initial_parameters.entry_point);
    const writer = records[1], checkpoint = records[2], question = historical.question;
    for (const row of records.slice(0, 3)) require(row.results[0].receipt.outcome === 'completed' && ['no_effect', 'confirmed'].includes(row.results[0].receipt.effect_status));
    require(writer.operation_id === plan.input.record_operation_id && checkpoint.operation_id === plan.input.checkpoint_operation_id
      && writer.results[0].output.facts.session_close_report_recorded === true && writer.results[0].output.effect_status === 'confirmed'
      && checkpoint.results[0].output.facts.session_close_checkpoint_completed === true && checkpoint.results[0].output.effect_status === 'confirmed'
      && checkpoint.results[0].output.observations.record_operation_id === writer.operation_id
      && writer.preview.prepared.plan.decision_material_sha256 === H({ question, decision: historical.decision }));
    const recorded = { question, plan: writer.preview.prepared.plan, recorded: { record: writer, output: writer.results[0].output } };
    const final = historical.records.find(row => row.operation_id === question.review.drift_finalization_operation_id);
    require(final);
    const completion = () => readSessionCloseObjectiveCompletion({ artifacts, recorded, finalization: { record: final, output: final.results[0].output } });
    completion();
    const originalSource = { record_operation_id: writer.operation_id, checkpoint_operation_id: checkpoint.operation_id,
      session_id: question.review.session_id, session_path: question.review.session_path, mode: question.review.mode, branch: question.review.branch,
      record_plan_sha256: H(recorded.plan), record_output_sha256: H(recorded.recorded.output), start_output: historical.started.output, checkpoint_output: checkpoint.results[0].output };
    require(H(originalSource) === plan.source_sha256, 'STANDARD_SESSION_RECOVERY_SOURCE_CHANGED');
    const modelSource = preview.snapshot.model_source ?? null, operations = createStandardWorkflowOperations({ targetRoot: root });
    const observeContext = () => {
      const { project, persistence } = readWorkflowProjectExecutionAuthority({ targetRoot: root, env: environment });
      require(project.stateMode === stateMode, 'STANDARD_SESSION_RECOVERY_SCOPE_CHANGED');
      const authority = { scope_id: H({ project: project.scope, persistence: persistence.binding_sha256,
        process_host: { version: 1, profile: 'standard-mixed.v1', state_mode: project.stateMode, key_id: signer.keyId,
          model_sha256: instance.model_sha256, model_source_sha256: modelSource === null ? null : H(modelSource) } }),
        model_sha256: instance.model_sha256, policy_pins: agenticPolicyPins(instance.model) };
      const names = ['CURRENT-STATE.md', 'SPEC.md', 'WORKFLOW.md', 'WORKFLOW-KERNEL.md', 'baseline/current.md', 'snapshots/context-snapshot.md'];
      const context = { ...(modelSource ? { model_source: modelSource } : {}), context: operations.observeScope(),
        documents: artifacts.readMany(names, { required: names }).map(({ path, sha256 }) => ({ path, sha256 })),
        native: { configuration_sha256: H(execution), product_sha256: H(readAgenticProductSnapshot(execution.product_root, execution.product_files)) } };
      require(H(authority) === capsule.authority_sha256 && authority.scope_id === instance.scope_id, 'STANDARD_SESSION_RECOVERY_SCOPE_CHANGED');
      require(H(context) === capsule.context_after_sha256, 'STANDARD_SESSION_RECOVERY_CONTEXT_CHANGED');
      return { authority_sha256: H(authority), context_sha256: H(context) };
    };
    const context = observeContext();
    const physicalRead = () => {
      const events = readAgentRunFile(path.join(root, eventFile), { json: false, maxBytes: 4194304 });
      const run = readAgentRunFile(path.join(root, runFile), { json: false, maxBytes: 256 });
      assertSessionCloseCheckpointOnly({ plan, events, run });
      const documents = plan.documents.map(row => {
        require(artifacts.read(row.path, { required: true }).sha256 === row.sha256 && artifacts.metadataHash(row.path) === row.metadata_sha256,
          'STANDARD_SESSION_RECOVERY_PREIMAGE_CHANGED'); return row;
      });
      return { events_sha256: events.sha256, run_file_sha256: run.sha256, documents };
    };
    const physical = physicalRead(), fence = fences.read();
    if (recovery) { assertSessionCloseRecoveryRecord(recovery); signer.verify(recovery); require(recovery.operation_id === operationId); }
    const owned = recovery && sessionRecoveryOwnsFence(recovery, fence.record);
    const lock = inspectInterruptedReopenLock(root, operationId, intention, lease, { allowRetired: Boolean(owned) });
    require(owned || !lock.retired && fence.record?.state === 'held' && same(fence.record, lease.resource_fence));
    const assertStable = () => {
      pinned(originalConfiguration); assertExecutionPins(); observeContext(); completion();
      require(same(physicalRead(), physical) && H(instances.read(instanceId).record) === H(instance)
        && [...records, ...historical.records, historical.started.record].every(row => H(journals.read(row.operation_id).record) === H(row))
        && H(instances.read(historical.instance.instance_id).record) === H(historical.instance) && H(dispatches.read(operationId).record) === H(capsule)
        && H(allocations.read(nativeJournalId(instance)).record) === H(native), 'STANDARD_SESSION_RECOVERY_SUBJECT_CHANGED');
      observeProcesses();
    };
    assertStable();
    return { instance, record, capsule, original, native, records, execution, historical, physical, context, assertStable,
      owner: { lock, lease, intention, fence }, processes, scope: artifacts.describe(), signer };
  };
}
