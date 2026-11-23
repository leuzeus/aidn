import fs from "node:fs";
import path from "node:path";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDispatchRecordStore } from "../../adapters/runtime/process-dispatch-record-store.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { readStandardHostInstance } from "../../adapters/runtime/standard-host-authority.mjs";
import { createOperationJournalSigner, operationJournalId } from "../../core/workflow/process-operation-journal.mjs";
import { nativeJournalId } from "../../core/workflow/native-allocation-journal.mjs";
import { inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { shadowHash as H } from "../../core/workflow/shadow-json.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";
import { createCodexSandboxValidationBoundary, buildCodexSandboxValidationInvocation } from "../../adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { observeCodexValidationStartupFailure } from "../../adapters/runtime/codex-validation-startup-failure.mjs";
import { observeCodexValidationChildRunners } from "../../adapters/runtime/codex-validation-process-observation.mjs";
import { observeLocalProcessOwner } from "../../adapters/runtime/local-process-identity.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { assertStandardValidationProfile } from "../../core/workflow/standard-cycle-validation.mjs";
import { inventoryStandardValidationSnapshot as inventory } from "./standard-cycle-validation-result.mjs";
import { inspectInterruptedReopenLock } from "./local-artifact-owner-retirement.mjs";
import { createLocalArtifactResourceFence } from "./local-artifact-resource-fence.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readWorkflowProjectExecutionAuthority } from "./workflow-instance-composition.mjs";
import { createStandardWorkflowOperations } from "./standard-workflow-operations.mjs";
import { readAgenticProductSnapshot } from "./agentic-process-execution-composition.mjs";
import { agenticPolicyPins } from "../../core/workflow/agentic-process-model.mjs";
import { assertValidationLaunchRecoveryRecord, validationRecoveryOwnsFence } from "../../core/workflow/standard-validation-launch-recovery.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const require = (condition, code = "STANDARD_VALIDATION_RECOVERY_SUBJECT_CHANGED") => { if (!condition) fail(code); };
const same = (a, b) => H(a) === H(b);
const pinned = ref => readAgentRunFile(ref.path, { sha256: ref.sha256 });

// The old runtime retained request/launch hashes, including a countdown-derived
// integer duration. Reconstruct only this bounded single-check case. A match of
// the request alone cannot replace verification of the complete launcher hash.
function reconstructLaunch(record, operation, configuration, profile) {
  const plan = record.preview.prepared.plan, check = plan.checks[0];
  require(plan.checks.length === 1 && Number.isSafeInteger(plan.limits.max_duration_ms)
    && plan.limits.max_duration_ms > 0 && plan.limits.max_duration_ms <= 120000, "STANDARD_VALIDATION_RECOVERY_UNSUPPORTED_PLAN");
  const candidate = { invocation_id: "validation:" + H({ plan: record.preview.prepared.plan_sha256, id: check.test_ref }).slice(0, 40),
    boundary_id: configuration.boundary_id, validation_id: check.test_ref, executable: configuration.runner.executable,
    executable_sha256: configuration.runner.sha256, argv: [check.snapshot_path, ...check.args], cwd: plan.snapshot_path,
    environment_sha256: H(profile.environment), max_duration_ms: 0, max_output_bytes: plan.limits.max_output_bytes };
  let invocation = null;
  for (let milliseconds = plan.limits.max_duration_ms; milliseconds > 0; milliseconds--) {
    candidate.max_duration_ms = milliseconds;
    if (H(candidate) === operation.request_sha256) { invocation = { ...candidate }; break; }
  }
  require(invocation !== null, "STANDARD_VALIDATION_RECOVERY_REQUEST_UNPROVEN");
  const launch = buildCodexSandboxValidationInvocation(configuration, { ...invocation, request_sha256: operation.request_sha256, environment: profile.environment });
  require(fingerprint(launch) === operation.intent.launch_sha256, "STANDARD_VALIDATION_RECOVERY_LAUNCH_CHANGED");
  return invocation;
}

// Read-only historical observation. It authenticates retained data with the
// original host key; no historical package code is loaded and no current model
// is substituted into the old instance. Mutation/continuation must be separate.
export function createStandardValidationLaunchRecoveryObserver({ targetRoot, stateMode, environment = process.env }) {
  const root = agentRunPhysicalPath(targetRoot, { directory: true }), options = { targetRoot: root, stateMode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  const dispatches = createProcessDispatchRecordStore(options), allocations = createNativeAllocationJournalStore(options);
  const artifacts = createStandardWorkflowArtifacts(options), fences = createLocalArtifactResourceFence(options);
  return async ({ instanceId, operationId, originalConfiguration, validationProfile }, { recovery = null } = {}) => {
    const execution = pinned(originalConfiguration).value;
    require(execution.instance_id === instanceId && execution.target_root === root, "STANDARD_VALIDATION_RECOVERY_CONFIGURATION_CHANGED");
    const assertExecutionPins = () => {
      for (const ref of [execution.model, execution.criteria, ...Object.values(execution.authorities), ...Object.values(execution.skills),
        ...Object.values(execution.instructions)])
        readAgentRunFile(ref.path, { sha256: ref.sha256, json: false });
      readAgentRunFile(execution.native.executable, { sha256: execution.native.sha256, json: false, maxBytes: 536870912 });
    };
    assertExecutionPins();
    const instance = instances.read(instanceId).record;
    require(instance && instance.instance_id === instanceId, "STANDARD_VALIDATION_RECOVERY_INSTANCE_REQUIRED");
    const cursor = inspectAgenticProcess(instance);
    const signer = createOperationJournalSigner(readStandardHostInstance({ targetRoot: root, instanceId, environment }).readKey);
    const record = journals.read(operationId).record;
    require(record && record.intent.binding_ref === "cycle_validation_execute" && record.phase === "receipted" && record.results.length === 1);
    signer.verify(record); signer.verify(record.preview);
    const original = record.results[0], intent = record.intent, preview = record.preview;
    require(cursor.status === "WAITING" && cursor.occurrences.some(row => row.occurrence_id === intent.occurrence_id
      && row.status === "WAITING" && row.wait_reason === "reconciliation_required" && same(row.operation?.receipt, original.receipt)));
    require(original.receipt.outcome === "reconciliation_required" && original.receipt.effect_status === "unknown"
      && original.output.observations.reason_code === "STANDARD_VALIDATION_STOP_UNCONFIRMED"
      && intent.instance_id === instanceId && intent.scope_id === instance.scope_id && intent.model_sha256 === instance.model_sha256
      && operationJournalId(intent, intent.occurrence_id) === operationId && intent.binding_sha256 === H(preview.binding)
      && intent.input_sha256 === H(preview.input) && intent.preconditions_sha256 === H({ snapshot: preview.snapshot, prepared: preview.prepared })
      && ["instance_id", "instance_sha256", "scope_id", "model_sha256", "occurrence_id"].every(key => preview[key] === intent[key])
      && instance.events.some(event => event.kind === "operation_intent" && same(event.intent, intent))
      && instance.events.some(event => event.kind === "operation_result" && same(event.receipt, original.receipt)));
    const native = allocations.read(nativeJournalId(instance)).record;
    require(native && native.instance_id === instanceId && native.scope_id === instance.scope_id && native.model_sha256 === instance.model_sha256);
    signer.verify(native);
    require(native.allocations.length > 0 && native.allocations.every(row => row.configuration_sha256 === H(execution) && row.phase === "closed"),
      "STANDARD_VALIDATION_RECOVERY_NATIVE_UNSETTLED");
    const capsule = dispatches.read(operationId).record; require(capsule); signer.verify(capsule);
    require(capsule.phase === "returned" && capsule.operation_id === operationId && capsule.instance_id === instanceId
      && capsule.scope_id === instance.scope_id && capsule.model_sha256 === instance.model_sha256
      && capsule.intent_sha256 === H(intent) && capsule.preview_sha256 === H(preview)
      && capsule.physical_root_sha256 === H(root) && capsule.runtime_sha256 === H(artifacts.describe()) && capsule.output_sha256 === H(original.output)
      && capsule.leases.length === 1 && capsule.local_owner_intentions.length === 1);
    require(observeLocalProcessOwner(capsule.process_identity) === "terminated", "STANDARD_VALIDATION_RECOVERY_OWNER_UNRESOLVED");
    const lease = capsule.leases[0], intention = capsule.local_owner_intentions[0];
    const source = preview.snapshot.model_source ?? null;
    const operations = createStandardWorkflowOperations({ targetRoot: root });
    const observeContext = () => {
      const { project, persistence } = readWorkflowProjectExecutionAuthority({ targetRoot: root, env: environment });
      require(project.stateMode === stateMode, "STANDARD_VALIDATION_RECOVERY_SCOPE_CHANGED");
      const authority = { scope_id: H({ project: project.scope, persistence: persistence.binding_sha256,
        process_host: { version: 1, profile: "standard-mixed.v1", state_mode: project.stateMode, key_id: signer.keyId,
          model_sha256: instance.model_sha256, model_source_sha256: source === null ? null : H(source) } }),
        model_sha256: instance.model_sha256, policy_pins: agenticPolicyPins(instance.model) };
      const names = ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"];
      const context = { ...(source ? { model_source: source } : {}), context: operations.observeScope(),
        documents: artifacts.readMany(names, { required: names }).map(({ path, sha256 }) => ({ path, sha256 })),
        native: { configuration_sha256: H(execution), product_sha256: H(readAgenticProductSnapshot(execution.product_root, execution.product_files)) } };
      require(H(authority) === capsule.authority_sha256 && authority.scope_id === instance.scope_id,
        "STANDARD_VALIDATION_RECOVERY_SCOPE_CHANGED");
      require(H(context) === capsule.context_after_sha256, "STANDARD_VALIDATION_RECOVERY_CONTEXT_CHANGED");
      return { authority_sha256: H(authority), context_sha256: H(context) };
    };
    const context = observeContext();
    const fence = fences.read();
    if (recovery) {
      assertValidationLaunchRecoveryRecord(recovery); signer.verify(recovery);
      require(recovery.operation_id === operationId);
    }
    const ownedFence = recovery && validationRecoveryOwnsFence(recovery, fence.record);
    const lock = inspectInterruptedReopenLock(root, operationId, intention, lease, { allowRetired: Boolean(ownedFence) });
    require(ownedFence || !lock.retired && fence.record?.state === "held" && same(fence.record, lease.resource_fence));
    const profile = assertStandardValidationProfile(pinned(validationProfile).value), plan = preview.prepared?.plan;
    // These local boundary witnesses were retained by the supervisor, outside
    // the product and behind the original Native denied roots. They are not
    // caller-authored closure grants or product-generated test output.
    require(execution.native.protected_roots.some(protectedRoot => {
      const relative = path.relative(protectedRoot, profile.evidence_root);
      return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
    }), "STANDARD_VALIDATION_RECOVERY_EVIDENCE_SCOPE_UNPROVEN");
    require(plan && plan.proof_class === "native" && preview.prepared.can_apply === true && H(plan) === preview.prepared.plan_sha256
      && same(plan.input, preview.input) && plan.profile_sha256 === H(profile));
    const work = journals.read(plan.input.work_operation_id).record; require(work); signer.verify(work); signer.verify(work.preview);
    require(work.intent.instance_id === instanceId && work.intent.binding_ref === "cycle_task_work_evaluate"
      && work.results.at(-1).receipt.outcome === "completed" && H(work.results.at(-1).output) === plan.work_sha256
      && instance.events.some(event => event.kind === "operation_result" && same(event.receipt, work.results.at(-1).receipt)));
    const configuration = pinned(profile.boundary_configuration).value;
    const boundary = createCodexSandboxValidationBoundary({ configuration, qualification: pinned(profile.qualification).value,
      publicKey: readAgentRunFile(profile.public_key.path, { sha256: profile.public_key.sha256, json: false }).value, evidenceRoot: profile.evidence_root });
    const available = await boundary.checkAvailability({ cwd: plan.snapshot_path });
    require(available.available === true && available.native === true, "STANDARD_VALIDATION_RECOVERY_BOUNDARY_UNAVAILABLE");
    const retained = await boundary.inspectOperations();
    require(!retained.uncertain_read && retained.operations.length === 1, "STANDARD_VALIDATION_RECOVERY_BOUNDARY_AMBIGUOUS");
    const operation = retained.operations[0], startup = observeCodexValidationStartupFailure({ configuration, operation });
    require(operation.recovery_required && startup !== null, "STANDARD_VALIDATION_RECOVERY_STARTUP_UNPROVEN");
    const invocation = reconstructLaunch(record, operation, configuration, profile);
    require(path.basename(configuration.trampoline.executable).toLowerCase() === "aidn-validation-trampoline.exe",
      "STANDARD_VALIDATION_RECOVERY_PROCESS_IMAGE_UNSUPPORTED");
    const processesBefore = observeCodexValidationChildRunners();
    require(processesBefore.active_count === 0, "STANDARD_VALIDATION_RECOVERY_CHILD_RUNNER_ACTIVE");
    const snapshot = inventory(plan.snapshot_path, plan.limits);
    const beforeFile = path.join(profile.evidence_root, path.basename(plan.snapshot_path), "before.json");
    const before = readAgentRunFile(beforeFile).value;
    require(same(snapshot, before), "STANDARD_VALIDATION_RECOVERY_SNAPSHOT_CHANGED");
    const expected = plan.files.filter(row => row.present).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    for (const check of plan.checks) {
      const source = readAgentRunFile(check.script.path, { sha256: check.script.sha256, json: false });
      expected.push({ path: check.snapshot_path, bytes: source.bytes, sha256: source.sha256 });
    }
    const sorted = rows => rows.slice().sort((a, b) => a.path.localeCompare(b.path));
    require(same(sorted(snapshot), sorted(expected)), "STANDARD_VALIDATION_RECOVERY_SNAPSHOT_CHANGED");
    for (const file of plan.files) {
      const actual = path.join(execution.product_root, file.path);
      require(fs.existsSync(actual) === file.present, "STANDARD_VALIDATION_RECOVERY_PRODUCT_CHANGED");
      if (file.present) readAgentRunFile(actual, { sha256: file.sha256, json: false });
    }
    require(H(journals.read(operationId).record) === H(record) && instances.read(instanceId).record.instance_sha256 === instance.instance_sha256
      && H(dispatches.read(operationId).record) === H(capsule) && fences.read().content_sha256 === fence.content_sha256);
    require(inspectInterruptedReopenLock(root, operationId, intention, lease, { allowRetired: Boolean(ownedFence) }).sha256 === lock.sha256);
    const processesAfter = observeCodexValidationChildRunners();
    require(processesAfter.active_count === 0, "STANDARD_VALIDATION_RECOVERY_CHILD_RUNNER_ACTIVE");
    observeContext();
    const assertStable = () => {
      pinned(originalConfiguration); pinned(validationProfile); assertExecutionPins(); observeContext();
      require(H(journals.read(operationId).record) === H(record) && instances.read(instanceId).record.instance_sha256 === instance.instance_sha256
        && H(dispatches.read(operationId).record) === H(capsule) && H(allocations.read(nativeJournalId(instance)).record) === H(native)
        && H(journals.read(work.operation_id).record) === H(work), "STANDARD_VALIDATION_RECOVERY_SUBJECT_CHANGED");
      require(same(inventory(plan.snapshot_path, plan.limits), snapshot), "STANDARD_VALIDATION_RECOVERY_SNAPSHOT_CHANGED");
      for (const check of plan.checks) readAgentRunFile(check.script.path, { sha256: check.script.sha256, json: false });
      pinned(profile.boundary_configuration); pinned(profile.qualification); readAgentRunFile(profile.public_key.path, { sha256: profile.public_key.sha256, json: false });
      // The inner boundary witnesses are immutable files; reread their exact bytes.
      for (const item of operation.evidence) readAgentRunFile(path.join(profile.evidence_root, item.ref), { sha256: item.sha256, json: false });
      for (const binary of [configuration.client, configuration.runner, configuration.trampoline])
        readAgentRunFile(binary.executable, { sha256: binary.sha256, json: false, maxBytes: 536870912 });
      readAgentRunFile(configuration.controller.helperPath, { sha256: configuration.controller.helperSha256, json: false });
      require(observeCodexValidationChildRunners().active_count === 0, "STANDARD_VALIDATION_RECOVERY_CHILD_RUNNER_ACTIVE");
    };
    return { instance, record, capsule, original, native, profile, operation, startup, invocation, snapshot, work,
      context, assertStable, owner: { lock, lease, intention, fence }, processes: [processesBefore, processesAfter], scope: artifacts.describe(), signer };
  };
}
