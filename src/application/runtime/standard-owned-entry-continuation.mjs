import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStandardHostInstance } from "../../adapters/runtime/standard-host-authority.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDecisionInboxStore } from "../../adapters/runtime/process-decision-inbox-store.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { createOperationJournalSigner, operationJournalId } from "../../core/workflow/process-operation-journal.mjs";
import { nativeJournalId } from "../../core/workflow/native-allocation-journal.mjs";
import { inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { processFrameNode } from "../../core/workflow/process-call-model.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import checkpointSchema from "../../core/contracts/workflow-definition/standard-cycle-checkpoint-plan.v1.schema.json" with { type: "json" };
import completionSchema from "../../core/contracts/workflow-definition/standard-drift-finalize-plan.v3.schema.json" with { type: "json" };
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createStandardHumanDecisions } from "./standard-workflow-human-decisions.mjs";
import { createStandardObjectiveDisposition } from "./standard-drift-objective-disposition.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { runGatingEvaluateUseCase } from "./gating-evaluate-use-case.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const same = (a, b) => shadowHash(a) === shadowHash(b);
const eventFile = ".aidn/runtime/perf/workflow-events.ndjson";
const cycleDocuments = ["brief", "plan", "hypotheses", "audit-spec", "traceability", "decisions", "change-requests", "status"];
const commonDocuments = ["CURRENT-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md"];
const openGate = gate => gate?.result === "ok" && gate.levels?.level1?.decision !== "stop"
  && gate.levels?.level2?.required === false && gate.levels?.level3?.required === false;

// One bounded cross-instance transition: an unchanged OPEN cycle after its
// accepted creation checkpoint. This does not import facts, migrate receipts,
// authorize work, or make other phases/version transitions interchangeable.
export function createStandardOwnedEntryContinuation({ targetRoot, environment = process.env, humanSource,
  observeScope, observeProduct, readCurrent }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  const allocations = createNativeAllocationJournalStore(options);
  function eventAt(offset, expected) {
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, eventFile)), { json: false, maxBytes: 4194304 }).value;
    const end = bytes.indexOf(10, offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || end < offset || end - offset >= 65536
      || offset > 0 && bytes[offset - 1] !== 10) fail("STANDARD_ENTRY_CONTINUATION_EVENT_CHANGED");
    let event; try { event = JSON.parse(bytes.subarray(offset, end).toString("utf8")); } catch { fail("STANDARD_ENTRY_CONTINUATION_EVENT_CHANGED"); }
    if (!same(event, expected)) fail("STANDARD_ENTRY_CONTINUATION_EVENT_CHANGED");
    return event;
  }
  return async (instance, parameters, admission) => {
    const id = parameters.entry_point?.checkpoint_operation_id, selected = admission.observations.selected_cycle;
    if (!/^op_[a-f0-9]{40}$/.test(id ?? "")) fail("STANDARD_ENTRY_CONTINUATION_REQUIRED");
    if (!selected || selected.state !== "OPEN") fail("STANDARD_ENTRY_CONTINUATION_PHASE_UNSUPPORTED");
    const locator = journals.read(id).record;
    if (!locator || locator.intent.binding_ref !== "cycle_checkpoint_finalize") fail("STANDARD_ENTRY_CONTINUATION_REQUIRED");
    const origin = instances.read(locator.intent.instance_id).record;
    if (!origin || origin.instance_id === instance.instance_id) fail("STANDARD_ENTRY_CONTINUATION_ORIGIN_INVALID");
    const signer = createOperationJournalSigner(readStandardHostInstance({ targetRoot: artifacts.root, instanceId: origin.instance_id, environment }).readKey);
    const reads = new Map();
    const read = operationId => {
      const record = journals.read(operationId).record;
      if (!record) fail("STANDARD_ENTRY_CONTINUATION_RECORD_REQUIRED");
      signer.verify(record); signer.verify(record.preview); reads.set(operationId, shadowHash(record)); return record;
    };
    const accepted = (operationId, binding, completed = true) => {
      const record = read(operationId), intent = record.intent, preview = record.preview, result = record.results.at(-1);
      if (record.phase !== "receipted" || intent.binding_ref !== binding || preview.binding.id !== binding
        || intent.instance_id !== origin.instance_id || intent.scope_id !== origin.scope_id || intent.model_sha256 !== origin.model_sha256
        || ["instance_id", "scope_id", "model_sha256", "occurrence_id", "instance_sha256"].some(key => preview[key] !== intent[key])
        || operationJournalId(intent, intent.occurrence_id) !== operationId || intent.binding_sha256 !== shadowHash(preview.binding)
        || intent.input_sha256 !== shadowHash(preview.input) || intent.preconditions_sha256 !== shadowHash({ snapshot: preview.snapshot, prepared: preview.prepared })
        || !origin.events.some(event => event.kind === "operation_intent" && same(event.intent, intent))
        || !origin.events.some(event => event.kind === "operation_result" && same(event.receipt, result?.receipt))
        || completed && result?.receipt.outcome !== "completed" || result?.receipt.effect_status === "unknown")
        fail("STANDARD_ENTRY_CONTINUATION_NOT_ACCEPTED");
      return { record, output: assertStandardOperationOutput(result.output) };
    };
    const latest = binding => origin.events.findLast(event => event.kind === "operation_intent" && event.intent.binding_ref === binding)?.intent.operation_id;
    if (latest("cycle_checkpoint_finalize") !== id) fail("STANDARD_ENTRY_CONTINUATION_CHECKPOINT_SUPERSEDED");
    const { record, output } = accepted(id, "cycle_checkpoint_finalize"), plan = record.preview.prepared?.plan;
    if (!plan || validateJsonSchema(plan, checkpointSchema, "$", { contractKind: "workflow-definition" }).length
      || record.preview.prepared.can_apply !== true || record.preview.prepared.plan_sha256 !== shadowHash(plan)
      || !same(plan.input, record.preview.input) || plan.input.session_id !== parameters.session.session_id
      || plan.input.cycle_id !== selected.cycle_id || plan.mode !== "COMMITTING" || plan.hook_mode !== "COMMITTING"
      || output.effect_status !== "confirmed" || output.facts.cycle_checkpoint_completed !== true
      || !record.grant?.authorized || record.intent.authorization_sha256 !== shadowHash(record.grant)
      || !openGate(output.observations.hook?.payload?.checkpoint?.gate)) fail("STANDARD_ENTRY_CONTINUATION_CHECKPOINT_INVALID");
    const names = [...cycleDocuments.map(name => `${selected.cycle_path}/${name}.md`), `sessions/${parameters.session.session_id}.md`, ...commonDocuments].sort();
    if (!same(plan.documents.map(row => row.path).sort(), names)) fail("STANDARD_ENTRY_CONTINUATION_DOCUMENT_SET_CHANGED");
    const cursor = inspectAgenticProcess(origin);
    if (cursor.occurrences.some(frame => processFrameNode(origin.model, frame)?.kind === "activity" && frame.status === "RUNNING"))
      fail("STANDARD_ENTRY_CONTINUATION_SOURCE_ACTIVE");
    for (const event of origin.events.filter(event => event.kind === "operation_intent")) accepted(event.intent.operation_id, event.intent.binding_ref, false);
    const native = allocations.read(nativeJournalId(origin)).record;
    if (native) {
      signer.verify(native);
      if (native.instance_id !== origin.instance_id || native.scope_id !== origin.scope_id || native.model_sha256 !== origin.model_sha256
        || native.allocations.some(row => row.phase !== "closed" || row.tree_closed !== true)) fail("STANDARD_ENTRY_CONTINUATION_SOURCE_ACTIVE");
    }
    const witness = () => {
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
        || instances.read(origin.instance_id).record?.instance_sha256 !== origin.instance_sha256) fail("STANDARD_ENTRY_CONTINUATION_PROCESS_CHANGED");
      if (artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      if (!same(observeScope(), plan.scope) || record.preview.snapshot.native?.product_sha256 !== observeProduct())
        fail("STANDARD_ENTRY_CONTINUATION_SCOPE_CHANGED");
      const rows = artifacts.readMany(names, { required: names, includeMetadata: true });
      if (rows.some(row => { const pin = plan.documents.find(pin => pin.path === row.path); return row.sha256 !== pin.sha256 || row.metadata_sha256 !== pin.metadata_sha256; }))
        fail("STANDARD_ENTRY_CONTINUATION_DOCUMENT_CHANGED");
      for (const [operationId, sha] of reads) if (shadowHash(journals.read(operationId).record) !== sha) fail("STANDARD_ENTRY_CONTINUATION_RECORD_CHANGED");
      if (!same(allocations.read(nativeJournalId(origin)).record, native)) fail("STANDARD_ENTRY_CONTINUATION_SOURCE_ACTIVE");
      const event = eventAt(output.observations.event_offset, output.observations.event);
      if (output.observations.event_file !== eventFile || event.event !== "checkpoint_summary" || event.result !== "ok"
        || event.run_id !== "process_cycle_" + shadowHash(plan).slice(0, 40) || event.branch !== plan.scope.branch || event.mode !== "COMMITTING")
        fail("STANDARD_ENTRY_CONTINUATION_EVENT_CHANGED");
    };
    witness();
    let alignment = null, completionId = null, completionSha = null;
    const readAlignment = async () => {
      witness();
      if (!plan.objective_completion_sha256) return null;
      completionId = latest("drift_check_finalize");
      const completed = accepted(completionId, "drift_check_finalize"), completion = completed.record.preview.prepared?.plan;
      if (!completion || validateJsonSchema(completion, completionSchema, "$", { contractKind: "workflow-definition" }).length
        || completion.operation_id !== completionId || completed.record.preview.prepared.plan_sha256 !== shadowHash(completion)
        || completion.input.evaluation_operation_id !== plan.input.evaluation_operation_id || completion.branch !== plan.scope.branch
        || completion.head !== plan.scope.head || completed.output.effect_status !== "confirmed" || completed.output.facts.drift_check_completed !== true)
        fail("STANDARD_ENTRY_CONTINUATION_COMPLETION_INVALID");
      const evaluated = accepted(plan.input.evaluation_operation_id, "drift_report_evaluate");
      if (completion.evaluation_sha256 !== shadowHash(evaluated.output) || evaluated.output.facts.drift_recovery_required !== false
        || evaluated.output.facts.drift_context_complete !== true || evaluated.output.observations.report.context_sha256 !== completion.context_sha256)
        fail("STANDARD_ENTRY_CONTINUATION_COMPLETION_INVALID");
      const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: humanSource, projectionRequired: false });
      const disposition = createStandardObjectiveDisposition({ readOperation: read, human, assertFresh: () => fail("STANDARD_ENTRY_CONTINUATION_HISTORY_ONLY") });
      const value = await disposition.readHistorical(origin, completion.input, { output: evaluated.output, evaluation_sha256: completion.evaluation_sha256,
        context_sha256: completion.context_sha256 }, completion.objective_alignment.decision_operation_id);
      if (!same(value, completion.objective_alignment) || shadowHash(value) !== plan.objective_completion_sha256)
        fail("STANDARD_ENTRY_CONTINUATION_ALIGNMENT_CHANGED");
      const report = artifacts.read(completion.report.path, { required: true }), observed = completed.output.observations;
      if (report.sha256 !== completion.report.after_sha256 || report.content !== completion.report.after
        || observed.report_path !== completion.report.path || observed.report_sha256 !== report.sha256 || observed.event_file !== eventFile)
        fail("STANDARD_ENTRY_CONTINUATION_REPORT_CHANGED");
      const event = eventAt(observed.event_offset, observed.observed_event);
      if (event.event !== "drift_check_completed" || event.result !== "ok" || event.run_id !== "process_drift_" + completionId
        || event.branch !== completion.branch || event.mode !== completion.mode || event.objective_alignment_sha256 !== shadowHash(value))
        fail("STANDARD_ENTRY_CONTINUATION_EVENT_CHANGED");
      completionSha = shadowHash(completed.record); witness(); return value;
    };
    alignment = await readAlignment();
    // RUNTIME-STATE is a derived projection refreshed after the checkpoint.
    // Reuse only the accepted alignment on the exact checkpoint business pins;
    // current scope, integrity, repair and intent signals are evaluated again.
    const gate = await runGatingEvaluateUseCase({ targetRoot: artifacts.root, runtimeDir: fileURLToPath(new URL("../../../tools/perf/", import.meta.url)),
      requireIntentSignals: true, readObjectiveCompletion: readAlignment, args: {
        cache: ".aidn/runtime/cache/reload-state.json", eventFile, indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
        stateMode: options.stateMode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
        thresholdFiles: 3, thresholdMinutes: null, mode: "COMMITTING", runId: "", reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: false, completeDriftCheck: false,
      } });
    witness();
    if (!openGate(gate)) fail("STANDARD_ENTRY_CONTINUATION_DRIFT_REQUIRED");
    return { source_instance_id: origin.instance_id, source_instance_sha256: origin.instance_sha256, checkpoint_operation_id: id,
      checkpoint_sha256: shadowHash(record), completion_operation_id: completionId, completion_sha256: completionSha,
      alignment_sha256: alignment === null ? null : shadowHash(alignment), gate_sha256: shadowHash(gate.levels) };
  };
}
