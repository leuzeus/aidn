import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { evaluateAgentReuse, fingerprintAgentReuse } from "../../src/core/agents/agent-reuse-policy.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { processFrameModel, processFrameNode } from "../../src/core/workflow/process-call-model.mjs";
import { resolveProcessCallData } from "../../src/core/workflow/process-call-data.mjs";
import { resolveProcessFrameInput } from "../../src/core/workflow/process-frame-input.mjs";

const H = "a".repeat(64), fail = code => { throw Object.assign(Error(code), { code }); };
const stops = { session_pr_correction_decide: "session_pr_correction_decide", plan: "plan", task_select: "task_select", audit_select: "audit_select", cycle_admit: "cycle_admit", closure_decide: "closure_decide", promotion_decide: "promotion_decide" };
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join();
const effectsPendingNode = "pr_premerge_observe";
const verificationTargetId = "aidn-standard-final-verification", reviewTargetId = "aidn-standard-pr-review-completion";
const reviewCaptureTargetId = "aidn-standard-pr-review-capture";
const callSites = new Map([
  ["session_setup", { model_id: "aidn-standard-session-setup", prefix: "" }],
  ["thinking_session_closure", { model_id: "aidn-standard-mode-session-closure", prefix: "thinking_" }],
  ["exploring_session_closure", { model_id: "aidn-standard-mode-session-closure", prefix: "exploring_" }],
  ["session_pr_review_capture", { model_id: reviewCaptureTargetId, prefix: "session_" }],
  ["correction_pr_review_capture", { model_id: reviewCaptureTargetId, prefix: "correction_" }],
  ["final_verification", { model_id: verificationTargetId, prefix: "" }],
  ["correction_final_verification", { model_id: verificationTargetId, prefix: "correction_" }],
  ["session_pr_effects_pending", { model_id: reviewTargetId, prefix: "session_" }],
  ["correction_pr_effects_pending", { model_id: reviewTargetId, prefix: "correction_" }],
  ["correction_cycle_drift_finalize", { model_id: "aidn-standard-corrective-drift", prefix: "correction_cycle_drift_" }],
  ["correction_closure_drift_finalize", { model_id: "aidn-standard-corrective-drift", prefix: "correction_closure_drift_" }],
  ["correction_promotion_drift_finalize", { model_id: "aidn-standard-corrective-drift", prefix: "correction_promotion_drift_" }],
  ["correction_session_closure_drift_finalize", { model_id: "aidn-standard-corrective-drift", prefix: "correction_session_closure_drift_" }],
]);

// Test planning only. Synthetic receipts/control/assignments never authenticate
// a human, native producer, provider or effect. Routing uses the execution reducer.
export function preflightStandardComposedFixture({ model, scenario, stop = "component_complete", cycleEntry = "fresh" }) {
  if (!["fresh", "owned_open"].includes(cycleEntry) || cycleEntry === "owned_open" && scenario?.mode !== "COMMITTING") fail("STANDARD_FIXTURE_CYCLE_ENTRY_INVALID");
  const nominalPostMerge = stop === "nominal_post_merge_complete";
  const fullCorrection = scenario?.contract_version === "fixture-standard-composed-scenario.v3";
  const correctionScenario = fullCorrection || scenario?.contract_version === "fixture-standard-composed-scenario.v2";
  if (!keys(scenario, ["contract_version", "mode", "closure", "promotion", "task_iterations", "cold_resume", "max_responses", "interruption", ...(correctionScenario ? ["review_disposition"] : [])])
    || !["fixture-standard-composed-scenario.v1", "fixture-standard-composed-scenario.v2", "fixture-standard-composed-scenario.v3"].includes(scenario.contract_version)
    || correctionScenario && !["acknowledgement", "valid_finding"].includes(scenario.review_disposition)
    || !["COMMITTING", "THINKING", "EXPLORING"].includes(scenario.mode)
    || !["retain", "drop", "no_go"].includes(scenario.closure) || !["promote", "skip"].includes(scenario.promotion)
    || !Number.isSafeInteger(scenario.task_iterations) || scenario.task_iterations < 1 || scenario.task_iterations > 32
    || typeof scenario.cold_resume !== "boolean" || !Number.isSafeInteger(scenario.max_responses) || scenario.max_responses < 1
    || ![...Object.keys(stops), "component_complete", "pr_effects_pending", "nominal_post_merge_complete"].includes(stop)
    || nominalPostMerge && (correctionScenario || scenario.mode !== "COMMITTING" || scenario.closure !== "retain"
      || scenario.promotion !== "promote" || scenario.interruption !== null)) fail("STANDARD_FIXTURE_SCENARIO_INVALID");
  const interruption = scenario.interruption;
  const targetLabels = model.model_id === "aidn-standard" ? [...callSites].flatMap(([site, { model_id, prefix }]) => {
    const target = model.call_targets?.find(row => row.model_id === model_id)?.model;
    return model.nodes.some(node => node.id === site && node.target?.model_id === model_id)
      ? (target?.nodes ?? []).filter(node => node.kind === "operation").map(node => prefix + node.id) : [];
  }) : [];
  if (interruption !== null && (!keys(interruption, ["node_id", "outcome"])
    || !(targetLabels.includes(interruption.node_id) || model.nodes.some(n => n.id === interruption.node_id && ["operation", "activity"].includes(n.kind)))
    || !["blocked", "deferred", "rejected", "failed", "cancelled"].includes(interruption.outcome))) fail("STANDARD_FIXTURE_SCENARIO_INVALID");
  const initial = { instanceId: "budget-preflight", scopeId: "synthetic-fixture", model, policyPins: agenticPolicyPins(model), facts: {},
    parameters: { session: { session_id: "S001", session_branch: "S001-standard", objective: "Synthetic fixture budget planning" },
      cycle: { cycle_id: "C001", cycle_type: "feature", title: "standard-prefix", objective: "Synthetic fixture budget planning" } } };
  let state = createAgenticProcess(initial), serial = 0, advanced = 0, deferred = false, interrupted = false;
  const native = [], operations = [], checkpoints = [], callTransitions = [], verificationInputs = [];
  const operationInputs = new Map(), syntheticWitnesses = new Map();
  const emit = value => { state = advanceAgenticProcess(state, { event_id: "preflight-" + ++serial, ...value }); };
  const opIntent = (frame, node, inputSha = H) => ({ contract_version: "process-operation-intent.v1", operation_id: "op-" + serial,
    binding_ref: node.binding_ref, binding_sha256: processFrameModel(model, frame).operation_pins[node.binding_ref], input_sha256: inputSha, preconditions_sha256: H,
    authorization_sha256: null, authority_id: "synthetic-host", scope_id: state.scope_id, instance_id: state.instance_id,
    instance_sha256: state.instance_sha256, model_sha256: state.model_sha256, occurrence_id: frame.occurrence_id, instance_revision: state.revision });
  function opResult(frame, intent, outcome, facts = {}) {
    const input = operationInputs.get(intent.operation_id);
    const output = input ? { observations: { operation_id: intent.operation_id } } : null;
    const receipt = {
      contract_version: "process-operation-receipt.v1", receipt_id: "receipt-" + serial, operation_id: intent.operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome, effect_status: "no_effect", output_sha256: output ? shadowHash(output) : H,
      facts, evidence_refs: [{ ref: "fixture/preflight", sha256: H }] };
    // Synthetic output witness for the declared typed return only. It proves
    // reducer dataflow, never physical R05 completion or human authority.
    if (input) syntheticWitnesses.set(intent.operation_id, { phase: "receipted", intent, preview: { input }, results: [{ receipt, output }] });
    emit({ kind: "operation_result", occurrence_id: frame.occurrence_id, receipt });
  }
  for (let step = 0; step < 200; step++) {
    const cursor = inspectAgenticProcess(state);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status)) break;
    const call = model.model_id === "aidn-standard" && cursor.occurrences.find(frame => frame.status === "WAITING"
      && ["call_entry", "call_return"].includes(frame.wait_reason) && callSites.has(frame.node_id)
      && processFrameNode(model, frame).target?.model_id === callSites.get(frame.node_id).model_id);
    if (call) {
      const returning = call.wait_reason === "call_return", occurrence_id = call.occurrence_id;
      // Source-owned parameters and accepted operation IDs enter these calls.
      // Only source-authored synthetic finalizer witnesses are available.
      const data = resolveProcessCallData({ instance: state, cursor, occurrenceId: occurrence_id, returning,
        readOperation: id => syntheticWitnesses.get(id) });
      emit({ kind: returning ? "call_return" : "call_enter", occurrence_id, ...data });
      callTransitions.push({ node_id: call.node_id, occurrence_id, kind: state.events.at(-1).kind, ...data });
      continue;
    }
    const frame = cursor.occurrences.find(f => f.status === "READY") ?? cursor.occurrences.find(f => f.wait_reason === "event");
    if (!frame) throw Object.assign(Error("STANDARD_FIXTURE_PREFLIGHT_UNPLANNED_WAIT"), { code: "STANDARD_FIXTURE_PREFLIGHT_UNPLANNED_WAIT",
      waiting: cursor.occurrences.filter(row => row.status === "WAITING").map(row => ({ node_id: row.node_id, wait_reason: row.wait_reason })) });
    const node = processFrameNode(model, frame);
    if (node.id === stops[stop]) break;
    if (node.kind === "operation") {
      const site = frame.call_scope_id && cursor.occurrences.find(row => row.occurrence_id === frame.call_scope_id);
      const label = (callSites.get(site?.node_id)?.prefix ?? "") + node.id;
      const verificationLeaf = model.model_id === "aidn-standard" &&
        ["final_validation", "verification_enter", "correction_final_validation", "correction_verification_enter"].includes(label);
      const correctiveFinalizer = node.binding_ref === "drift_check_finalize"
        && callSites.get(site?.node_id)?.model_id === "aidn-standard-corrective-drift";
      const resolution = verificationLeaf || correctiveFinalizer ? resolveProcessFrameInput({ instance: state, cursor, occurrenceId: frame.occurrence_id }) : null;
      const intent = opIntent(frame, node, resolution ? shadowHash(resolution.input) : H);
      if (correctiveFinalizer) operationInputs.set(intent.operation_id, resolution.input);
      if (verificationLeaf) verificationInputs.push({ node_id: label, occurrence_id: frame.occurrence_id, binding_ref: node.binding_ref,
        operation_id: intent.operation_id, input: resolution.input, sources: resolution.sources });
      emit({ kind: "operation_intent", occurrence_id: frame.occurrence_id, intent });
      if (interruption?.node_id === label) { opResult(frame, intent, interruption.outcome); interrupted = true; break; }
      if (node.id === effectsPendingNode && !nominalPostMerge) {
        if (stop !== "pr_effects_pending") fail("STANDARD_FIXTURE_PREFLIGHT_INCOMPLETE");
        opResult(frame, intent, "deferred");
        operations.push(label);
        break;
      }
      if (node.id === "closure_decide" && scenario.cold_resume && !deferred) {
        opResult(frame, intent, "deferred");
        checkpoints.push({ event_count: state.events.length, responses: native.length, instance_sha256: state.instance_sha256 });
        // Model a cold restart without dropping the prefix. This is not proof
        // of allocation authentication, closure or native resource extinction.
        state = JSON.parse(JSON.stringify(state)); inspectAgenticProcess(state); deferred = true;
        const resumedFrame = inspectAgenticProcess(state).occurrences.find(f => f.occurrence_id === frame.occurrence_id);
        const next = opIntent(resumedFrame, node);
        emit({ kind: "operation_intent", occurrence_id: frame.occurrence_id, intent: next });
        opResult(frame, next, "completed");
      } else {
        let facts = {};
        if (node.binding_ref === "session_entry_admit") facts = site?.node_id === "session_setup"
          ? { session_creation_allowed: true, session_resume_allowed: false, session_mode_pending: true }
          : { session_creation_allowed: false, session_resume_allowed: true, session_mode_pending: false,
            mode_committing: scenario.mode === "COMMITTING", mode_thinking: scenario.mode === "THINKING",
            mode_exploring: scenario.mode === "EXPLORING", cycle_work_requested: scenario.mode === "COMMITTING" };
        if (node.binding_ref === "cycle_entry_observe") facts = { cycle_entry_fresh_context: cycleEntry === "fresh", cycle_entry_owned_context: cycleEntry === "owned_open", cycle_entry_choice_required: false };
        if (node.binding_ref === "cycle_entry_admit") facts = { cycle_entry_creation_allowed: cycleEntry === "fresh", cycle_entry_resume_allowed: cycleEntry === "owned_open", cycle_entry_choice_required: false };
        if (node.binding_ref === "spike_conversion_admit") facts = { mode_work_spike_requested: false };
        if (node.binding_ref === "mode_work_observe") facts = { mode_work_report_complete: true, mode_analysis_completed: false };
        if (node.binding_ref === "mode_work_evaluate") facts = { mode_analysis_completed: true };
        if (node.binding_ref === "mode_decision") facts = { mode_committing: scenario.mode === "COMMITTING", mode_thinking: scenario.mode === "THINKING", mode_exploring: scenario.mode === "EXPLORING", cycle_work_requested: scenario.mode === "COMMITTING" };
        if (node.binding_ref === "cycle_task_advance") facts = { cycle_tasks_finished: ++advanced >= scenario.task_iterations };
        if (fullCorrection && node.id === "session_pr_correction_decide") facts = { session_pr_correction_cycle_requested: true };
        if (node.binding_ref === "drift_completion_select") facts = { drift_diagnosis_requested: !operations.includes("closure_drift_finalize"), drift_completion_review_required: false, drift_completion_reviewed: operations.includes("closure_drift_finalize") };
        if (node.binding_ref === "drift_followup_select") {
          const objective = fullCorrection && callSites.get(site?.node_id)?.model_id === "aidn-standard-corrective-drift";
          facts = { drift_route_ready: !objective, drift_followup_review_required: objective, drift_objective_review_required: objective };
        }
        if (node.binding_ref === "drift_check_finalize") facts = { drift_check_completed: true };
        if (node.binding_ref === "cycle_close_finalize") facts = { cycle_close_completed: true, cycle_retained: scenario.closure === "retain" };
        if (node.binding_ref === "baseline_promotion_decision") facts = { baseline_promotion_requested: scenario.promotion === "promote", baseline_promotion_not_requested: scenario.promotion === "skip" };
        if (node.binding_ref === "session_pr_review_event_route") facts = { session_pr_pretriage_external: false };
        if (nominalPostMerge) {
          if (["session_pr_premerge_observe", "session_pr_checks_accept"].includes(node.binding_ref)) facts = { session_pr_external_merge_observed: false };
          if (node.binding_ref === "session_pr_review_reply_select") facts = { session_pr_replies_observed: true };
          if (node.binding_ref === "session_pr_review_resolution_select") facts = {
            session_pr_threads_observed_resolved: true, session_pr_resolution_exception_required: false, session_pr_resolution_gate_met: true };
          if (node.binding_ref === "session_pr_merge_execute") facts = { session_pr_merge_completed: true };
          if (node.binding_ref === "session_pr_post_merge_measure") facts = { session_pr_post_merge_diverged: true };
          if (node.binding_ref === "session_pr_post_merge_decision") facts = { session_pr_post_merge_fast_forward: true };
        }
        if (node.binding_ref === "session_pr_triage_evaluate") facts = { session_pr_findings_classified: true,
          session_pr_corrections_required: node.id === "session_pr_triage_evaluate" && scenario.review_disposition === "valid_finding",
          session_pr_responses_required: node.id === "session_pr_triage_evaluate" && scenario.review_disposition === "valid_finding" };
        opResult(frame, intent, "completed", facts);
      }
      operations.push(label);
    } else if (node.kind === "event") {
      const delivery = { contract_version: "process-control-event.v1", delivery_id: "delivery-" + serial, authority_id: "synthetic-host",
        source_kind: "external", source_event_id: "synthetic-event-" + serial, subject_sha256: H, scope_id: state.scope_id,
        instance_id: state.instance_id, instance_sha256: state.instance_sha256, model_sha256: state.model_sha256, instance_revision: state.revision,
        occurrence_id: frame.occurrence_id, correlation_id: frame.correlation_id, event_key: "review_snapshot", payload_sha256: H,
        evidence_refs: [{ ref: "fixture/preflight", sha256: H }] };
      emit({ kind: "control", occurrence_id: frame.occurrence_id, delivery });
    } else if (node.kind === "activity") {
      if (interruption?.node_id === node.id && ["blocked", "deferred"].includes(interruption.outcome)) fail("STANDARD_FIXTURE_SCENARIO_INVALID");
      if (interruption?.node_id === node.id && interruption.outcome === "cancelled") { emit({ kind: "cancel" }); interrupted = true; break; }
      const policy = model.policies.find(p => p.id === node.policy_ref), role = model.roles.find(r => r.id === node.role_ref);
      const request = { contract_version: "agent-reuse-request.v1", activity_id: frame.occurrence_id, scope_id: state.scope_id, revision: "synthetic-1",
        artifact_sha256: H, criteria_sha256: H, ...Object.fromEntries(["assurance_profile", "mode", "independent_review", "context_isolation_required", "required_permissions", "allowed_permissions"].map(k => [k, policy[k]])),
        role: role.role, action: role.action, allowed_context_sha256: [H], reviewed_contributors: [] };
      const resource = { execution_id: "synthetic", agent_id: "synthetic", lineage_id: "synthetic", session_id: "synthetic", adapter_id: "synthetic",
        role: role.role, action: role.action, permissions: policy.allowed_permissions, guarantees: ["context-isolated", "protected-verdict"], context_sha256: [H], contributions: [] };
      const observation = { contract_version: "agent-reuse-observation.v1", authority_id: "synthetic-host", observation_id: "synthetic",
        request_sha256: fingerprintAgentReuse(request), scope_id: request.scope_id, revision: request.revision, assurance_profile: request.assurance_profile,
        artifact_sha256: H, criteria_sha256: H, observed_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-01T00:00:01Z", current_execution_id: resource.execution_id,
        executors: [resource], evidence_refs: [{ ref: "fixture/preflight", sha256: H }] };
      const decision = evaluateAgentReuse({ request, observation, eligibleAdapterIds: ["synthetic"], now: Date.parse("2026-01-01T00:00:00.500Z") });
      emit({ kind: "assign", occurrence_id: frame.occurrence_id, request, decision });
      emit({ kind: "result", occurrence_id: frame.occurrence_id, result: { result_id: "result-" + serial, request_sha256: fingerprintAgentReuse(request),
        execution_id: decision.execution_id, revision: request.revision, artifact_sha256: H, criteria_sha256: H,
        outcome: interruption?.node_id === node.id ? interruption.outcome : "completed", evidence_refs: [{ ref: "fixture/preflight", sha256: H }] } });
      native.push({ node_id: node.id, occurrence_id: frame.occurrence_id });
      if (interruption?.node_id === node.id) { interrupted = true; break; }
    } else fail("STANDARD_FIXTURE_PREFLIGHT_NODE_UNSUPPORTED");
  }
  const cursor = inspectAgenticProcess(state);
  if (interruption && !interrupted) fail("STANDARD_FIXTURE_INTERRUPTION_NOT_REACHED");
  if (!interrupted && (stop === "component_complete" || nominalPostMerge) && cursor.status !== "COMPLETED") fail("STANDARD_FIXTURE_PREFLIGHT_INCOMPLETE");
  if (nominalPostMerge && operations.at(-1) !== "session_pr_post_merge_reconciled_complete") fail("STANDARD_FIXTURE_STOP_NOT_REACHED");
  if (!interrupted && stop === "pr_effects_pending" && !cursor.occurrences.some(f => f.status === "WAITING"
    && f.node_id === effectsPendingNode && f.operation?.receipt?.outcome === "deferred")) fail("STANDARD_FIXTURE_STOP_NOT_REACHED");
  if (!interrupted && Object.hasOwn(stops, stop) && !cursor.occurrences.some(f => f.status === "READY" && f.node_id === stops[stop]))
    fail("STANDARD_FIXTURE_STOP_NOT_REACHED");
  let replay;
  for (const row of iterateAgenticProcessSimulation({ ...initial, events: state.events })) replay = row;
  if (replay.instance_sha256 !== state.instance_sha256) fail("STANDARD_FIXTURE_PREFLIGHT_REPLAY_CHANGED");
  const result = { proof_class: "synthetic-fixture-only", model_sha256: state.model_sha256, scenario_sha256: shadowHash(scenario), stop, cycle_entry: cycleEntry,
    responses_required: native.length, original_max_responses: scenario.max_responses, native_occurrences: native,
    cold_resume_checkpoints: checkpoints, planned_status: cursor.status, interrupted, operations, event_count: state.events.length,
    call_transitions: callTransitions, verification_inputs: verificationInputs, replay_exact: true,
    write_authorization: false, product_qualification: "NOT_ESTABLISHED" };
  if (scenario.max_responses < native.length) throw Object.assign(Error("STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT"), { code: "STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT", preflight: result });
  return result;
}
