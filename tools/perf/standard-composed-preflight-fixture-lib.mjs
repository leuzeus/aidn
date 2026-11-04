import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { evaluateAgentReuse, fingerprintAgentReuse } from "../../src/core/agents/agent-reuse-policy.mjs";
import { iterateAgenticProcessSimulation } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const H = "a".repeat(64), fail = code => { throw Object.assign(Error(code), { code }); };
const stops = { plan: "plan", cycle_admit: "cycle_admit", closure_decide: "closure_decide", promotion_decide: "promotion_decide" };
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join();

// Test planning only. Synthetic receipts/control/assignments never authenticate
// a human, native producer, provider or effect. Routing uses the execution reducer.
export function preflightStandardComposedFixture({ model, scenario, stop = "component_complete" }) {
  const correctionScenario = scenario?.contract_version === "fixture-standard-composed-scenario.v2";
  if (!keys(scenario, ["contract_version", "mode", "closure", "promotion", "task_iterations", "cold_resume", "max_responses", "interruption", ...(correctionScenario ? ["review_disposition"] : [])])
    || !["fixture-standard-composed-scenario.v1", "fixture-standard-composed-scenario.v2"].includes(scenario.contract_version)
    || correctionScenario && !["acknowledgement", "valid_finding"].includes(scenario.review_disposition)
    || !["COMMITTING", "THINKING", "EXPLORING"].includes(scenario.mode)
    || !["retain", "drop", "no_go"].includes(scenario.closure) || !["promote", "skip"].includes(scenario.promotion)
    || !Number.isSafeInteger(scenario.task_iterations) || scenario.task_iterations < 1 || scenario.task_iterations > 32
    || typeof scenario.cold_resume !== "boolean" || !Number.isSafeInteger(scenario.max_responses) || scenario.max_responses < 1
    || ![...Object.keys(stops), "component_complete"].includes(stop)) fail("STANDARD_FIXTURE_SCENARIO_INVALID");
  const interruption = scenario.interruption;
  if (interruption !== null && (!keys(interruption, ["node_id", "outcome"])
    || !model.nodes.some(n => n.id === interruption.node_id && ["operation", "activity"].includes(n.kind))
    || !["blocked", "deferred", "rejected", "failed", "cancelled"].includes(interruption.outcome))) fail("STANDARD_FIXTURE_SCENARIO_INVALID");
  const initial = { instanceId: "budget-preflight", scopeId: "synthetic-fixture", model, policyPins: agenticPolicyPins(model), facts: {},
    parameters: { session: { session_id: "S001", session_branch: "S001-standard", objective: "Synthetic fixture budget planning" },
      cycle: { cycle_id: "C001", cycle_type: "feature", title: "standard-prefix", objective: "Synthetic fixture budget planning" } } };
  let state = createAgenticProcess(initial), serial = 0, advanced = 0, deferred = false, interrupted = false;
  const native = [], operations = [], checkpoints = [];
  const emit = value => { state = advanceAgenticProcess(state, { event_id: "preflight-" + ++serial, ...value }); };
  const opIntent = (frame, node) => ({ contract_version: "process-operation-intent.v1", operation_id: "op-" + serial,
    binding_ref: node.binding_ref, binding_sha256: model.operation_pins[node.binding_ref], input_sha256: H, preconditions_sha256: H,
    authorization_sha256: null, authority_id: "synthetic-host", scope_id: state.scope_id, instance_id: state.instance_id,
    instance_sha256: state.instance_sha256, model_sha256: state.model_sha256, occurrence_id: frame.occurrence_id, instance_revision: state.revision });
  function opResult(frame, intent, outcome, facts = {}) {
    emit({ kind: "operation_result", occurrence_id: frame.occurrence_id, receipt: {
      contract_version: "process-operation-receipt.v1", receipt_id: "receipt-" + serial, operation_id: intent.operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome, effect_status: "no_effect", output_sha256: H,
      facts, evidence_refs: [{ ref: "fixture/preflight", sha256: H }] } });
  }
  for (let step = 0; step < 200; step++) {
    const cursor = inspectAgenticProcess(state);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status)) break;
    const frame = cursor.occurrences.find(f => f.status === "READY") ?? cursor.occurrences.find(f => f.wait_reason === "event");
    if (!frame) fail("STANDARD_FIXTURE_PREFLIGHT_UNPLANNED_WAIT");
    const node = model.nodes.find(n => n.id === frame.node_id);
    if (node.id === stops[stop]) break;
    if (node.kind === "operation") {
      const intent = opIntent(frame, node);
      emit({ kind: "operation_intent", occurrence_id: frame.occurrence_id, intent });
      if (interruption?.node_id === node.id) { opResult(frame, intent, interruption.outcome); interrupted = true; break; }
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
        if (node.binding_ref === "session_mode_apply") facts = { mode_committing: scenario.mode === "COMMITTING", mode_thinking: scenario.mode === "THINKING", mode_exploring: scenario.mode === "EXPLORING" };
        if (node.binding_ref === "cycle_task_advance") facts = { cycle_tasks_finished: ++advanced >= scenario.task_iterations };
        if (node.binding_ref === "cycle_close_finalize") facts = { cycle_retained: scenario.closure === "retain" };
        if (node.binding_ref === "baseline_promotion_decision") facts = { baseline_promotion_requested: scenario.promotion === "promote", baseline_promotion_not_requested: scenario.promotion === "skip" };
        if (node.binding_ref === "session_pr_triage_evaluate") facts = { session_pr_findings_classified: true,
          session_pr_corrections_required: scenario.review_disposition === "valid_finding", session_pr_responses_required: scenario.review_disposition === "valid_finding" };
        opResult(frame, intent, "completed", facts);
      }
      operations.push(node.id);
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
  if (!interrupted && stop === "component_complete" && cursor.status !== "COMPLETED") fail("STANDARD_FIXTURE_PREFLIGHT_INCOMPLETE");
  if (!interrupted && stop !== "component_complete" && !cursor.occurrences.some(f => f.status === "READY" && f.node_id === stops[stop])) fail("STANDARD_FIXTURE_STOP_NOT_REACHED");
  let replay;
  for (const row of iterateAgenticProcessSimulation({ ...initial, events: state.events })) replay = row;
  if (replay.instance_sha256 !== state.instance_sha256) fail("STANDARD_FIXTURE_PREFLIGHT_REPLAY_CHANGED");
  const result = { proof_class: "synthetic-fixture-only", model_sha256: state.model_sha256, scenario_sha256: shadowHash(scenario), stop,
    responses_required: native.length, original_max_responses: scenario.max_responses, native_occurrences: native,
    cold_resume_checkpoints: checkpoints, planned_status: cursor.status, interrupted, operations, replay_exact: true,
    write_authorization: false, product_qualification: "NOT_ESTABLISHED" };
  if (scenario.max_responses < native.length) throw Object.assign(Error("STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT"), { code: "STANDARD_FIXTURE_RESPONSE_BUDGET_INSUFFICIENT", preflight: result });
  return result;
}
