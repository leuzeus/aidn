import { assertAgenticProcessModel, AGENTIC_PROCESS_PROFILE, exactKeys, processId, processFail as fail } from "./agentic-process-model.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import { assertAgentReuseRequest, fingerprintAgentReuse } from "../agents/agent-reuse-policy.mjs";
import decisionSchema from "../contracts/agent-reuse/agent-reuse-decision.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import instanceSchema from "../contracts/workflow-definition/agentic-process-instance.v1.schema.json" with { type: "json" };

const terminal = status => ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const factsValid = value => exactKeys(value, [], Object.keys(value ?? {})) && Object.keys(value).length <= 128
  && Object.entries(value).every(([key, item]) => processId(key) && typeof item === "boolean");
const content = ({ instance_sha256, ...value }) => value;

export function assertActivityAssignment(instance, node, occurrenceId, request, decision) {
  assertAgentReuseRequest(request);
  const role = instance.model.roles.find(row => row.id === node.role_ref), policy = instance.model.policies.find(row => row.id === node.policy_ref);
  if (request.activity_id !== occurrenceId || request.scope_id !== instance.scope_id || request.role !== role.role || request.action !== role.action
    || ["assurance_profile", "mode", "independent_review", "context_isolation_required", "required_permissions", "allowed_permissions"]
      .some(key => shadowHash(request[key]) !== shadowHash(policy[key]))) fail("PROCESS_ASSIGNMENT_BINDING_CHANGED");
  if (validateJsonSchema(decision, decisionSchema, "$", { contractKind: "agent-execution" }).length || decision.request_sha256 !== fingerprintAgentReuse(request)
    || !["reuse", "separate"].includes(decision.decision)) fail("PROCESS_ASSIGNMENT_NOT_ADMISSIBLE");
}

export function assertProcessResult(result, assignment) {
  if (!exactKeys(result, ["result_id", "request_sha256", "execution_id", "revision", "artifact_sha256", "criteria_sha256", "outcome", "evidence_refs"])
    || !processId(result.result_id) || !["completed", "failed", "rejected"].includes(result.outcome)
    || !Array.isArray(result.evidence_refs) || !result.evidence_refs.length || result.evidence_refs.length > 16
    || result.evidence_refs.some(ref => !exactKeys(ref, ["ref", "sha256"]) || typeof ref.ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(ref.ref) || !digest(ref.sha256))
    || result.request_sha256 !== fingerprintAgentReuse(assignment.request) || result.execution_id !== assignment.decision.execution_id
    || ["revision", "artifact_sha256", "criteria_sha256"].some(key => result[key] !== assignment.request[key])) fail("PROCESS_RESULT_BINDING_CHANGED");
}

// Deterministic structured control tokens. There is no worker/thread count here.
// All nodes and waits become visible before any external resource is assigned.
function replay(instance) {
  const nodes = new Map(instance.model.nodes.map(node => [node.id, node]));
  const frames = new Map(); let facts = { ...instance.initial_facts }, failure = null;
  function stop(frame, status, reason) {
    if (!failure) failure = reason;
    frame.status = status;
    for (const active of frames.values()) if (!terminal(active.status) && active !== frame) active.status = "CANCELLED";
    frames.get("root").status = status;
  }
  function loopNext(frame) {
    const node = nodes.get(frame.node_id);
    if (!Object.hasOwn(facts, node.until)) { frame.status = "WAITING"; frame.wait_reason = "routing_fact"; return; }
    if (facts[node.until]) { finish(frame); return; }
    if (frame.iteration >= node.max_iterations) { stop(frame, "FAILED", "PROCESS_LOOP_LIMIT"); return; }
    frame.status = "RUNNING"; frame.iteration++;
    enter(node.child, `${frame.occurrence_id}/iteration-${frame.iteration}`, frame.occurrence_id);
  }
  function finish(frame) {
    frame.status = "COMPLETED"; frame.wait_reason = null;
    if (!frame.parent_id) return;
    const parent = frames.get(frame.parent_id), node = nodes.get(parent.node_id);
    if (terminal(parent.status)) fail("PROCESS_PARENT_TERMINAL");
    parent.completed_children.push(frame.occurrence_id);
    if (node.kind === "sequence") {
      const next = parent.completed_children.length;
      if (next === node.children.length) finish(parent);
      else enter(node.children[next], `${parent.occurrence_id}/${next}`, parent.occurrence_id);
    } else if (node.kind === "loop") loopNext(parent);
    else if (node.kind === "multi_instance" && node.ordering === "sequential" && parent.completed_children.length < node.items.length) {
      const index = parent.completed_children.length;
      enter(node.child, `${parent.occurrence_id}/item-${index}`, parent.occurrence_id);
    } else if (parent.completed_children.length === parent.expected_children) finish(parent);
  }
  function route(frame) {
    const node = nodes.get(frame.node_id);
    let selected;
    if (["xor", "or"].includes(node.kind)) {
      if (node.branches.some(branch => branch.condition !== null && !Object.hasOwn(facts, branch.condition))) {
        frame.status = "WAITING"; frame.wait_reason = "routing_fact"; return;
      }
      const matching = node.branches.filter(branch => branch.condition !== null && facts[branch.condition]);
      selected = matching.length ? (node.kind === "xor" ? matching.slice(0, 1) : matching) : node.branches.filter(branch => branch.condition === null);
    } else selected = node.branches;
    if (!selected.length) { stop(frame, "FAILED", "PROCESS_NO_BRANCH_SELECTED"); return; }
    frame.status = "RUNNING"; frame.wait_reason = null; frame.selected_flows = selected.map(branch => branch.flow_id);
    frame.skipped_flows = node.branches.filter(branch => !selected.includes(branch)).map(branch => branch.flow_id);
    frame.expected_children = selected.length;
    for (const branch of selected) {
      if (failure) break;
      enter(branch.node_id, `${frame.occurrence_id}/${branch.flow_id}`, frame.occurrence_id);
    }
  }
  function enter(nodeId, occurrenceId, parentId) {
    if (frames.size >= 1024 || frames.has(occurrenceId)) fail("PROCESS_OCCURRENCE_LIMIT");
    const node = nodes.get(nodeId);
    const frame = { occurrence_id: occurrenceId, node_id: nodeId, participant_ref: node.participant_ref,
      parent_id: parentId, status: "RUNNING", wait_reason: null, correlation_id: `${instance.instance_id}:${occurrenceId}`,
      selected_flows: [], skipped_flows: [], completed_children: [], expected_children: 1, iteration: 0, assignment: null, result: null, last_refusal: null };
    frames.set(occurrenceId, frame);
    if (node.kind === "activity") frame.status = "READY";
    else if (node.kind === "sequence") enter(node.children[0], `${occurrenceId}/0`, occurrenceId);
    else if (node.kind === "call") enter(node.child, `${occurrenceId}/call`, occurrenceId);
    else if (node.kind === "loop") { frame.iteration = 1; enter(node.child, `${occurrenceId}/iteration-1`, occurrenceId); }
    else if (node.kind === "multi_instance") {
      frame.expected_children = node.items.length;
      if (!node.items.length) finish(frame);
      else for (let index = 0; index < (node.ordering === "sequential" ? 1 : node.items.length); index++) {
        if (failure) break;
        enter(node.child, `${occurrenceId}/item-${index}`, occurrenceId);
      }
    } else if (node.kind === "event") { frame.status = "WAITING"; frame.wait_reason = "event"; }
    else route(frame);
  }
  enter(instance.model.entry, "root", null);
  const eventIds = new Set(), resultIds = new Set();
  for (const event of instance.events) {
    if (!processId(event.event_id) || eventIds.has(event.event_id) || terminal(frames.get("root").status)) fail("PROCESS_EVENT_ORDER_INVALID");
    eventIds.add(event.event_id);
    if (event.kind === "cancel") {
      if (!exactKeys(event, ["event_id", "kind"])) fail("PROCESS_EVENT_INVALID");
      stop(frames.get("root"), "CANCELLED", "PROCESS_CANCELLED"); continue;
    }
    if (event.kind === "facts") {
      if (!exactKeys(event, ["event_id", "kind", "facts"]) || !factsValid(event.facts)) fail("PROCESS_FACTS_INVALID");
      facts = { ...facts, ...event.facts };
      for (const frame of [...frames.values()]) {
        if (failure) break;
        if (frame.status === "WAITING" && frame.wait_reason === "routing_fact") {
          if (nodes.get(frame.node_id).kind === "loop") loopNext(frame); else route(frame);
        }
      }
      continue;
    }
    const frame = frames.get(event.occurrence_id), node = frame && nodes.get(frame.node_id);
    if (!frame) fail("PROCESS_OCCURRENCE_UNKNOWN");
    if (event.kind === "refusal") {
      if (!exactKeys(event, ["event_id", "kind", "occurrence_id", "stage", "reason_code", "request_sha256"])
        || node.kind !== "activity" || !["READY", "RUNNING"].includes(frame.status)
        || !["assignment", "verdict"].includes(event.stage) || !/^[A-Z][A-Z_]{0,95}$/.test(event.reason_code)
        || !(event.request_sha256 === null || digest(event.request_sha256))) fail("PROCESS_REFUSAL_INVALID");
      frame.last_refusal = { stage: event.stage, reason_code: event.reason_code, request_sha256: event.request_sha256 };
    } else if (event.kind === "message") {
      if (!exactKeys(event, ["event_id", "kind", "occurrence_id", "correlation_id", "event_key"]) || node.kind !== "event"
        || frame.status !== "WAITING" || frame.correlation_id !== event.correlation_id) fail("PROCESS_EVENT_CORRELATION_INVALID");
      const branch = node.branches.find(row => row.event_key === event.event_key);
      if (!branch) fail("PROCESS_EVENT_CORRELATION_INVALID");
      frame.status = "RUNNING"; frame.wait_reason = null; frame.selected_flows = [branch.flow_id];
      frame.skipped_flows = node.branches.filter(row => row !== branch).map(row => row.flow_id);
      enter(branch.node_id, `${frame.occurrence_id}/${branch.flow_id}`, frame.occurrence_id);
    } else if (event.kind === "assign") {
      if (!exactKeys(event, ["event_id", "kind", "occurrence_id", "request", "decision"]) || node.kind !== "activity" || frame.status !== "READY") fail("PROCESS_ASSIGNMENT_ORDER_INVALID");
      assertActivityAssignment(instance, node, frame.occurrence_id, event.request, event.decision);
      frame.assignment = { request: event.request, decision: event.decision }; frame.status = "RUNNING";
    } else if (event.kind === "result") {
      if (!exactKeys(event, ["event_id", "kind", "occurrence_id", "result"]) || node.kind !== "activity" || frame.status !== "RUNNING" || !frame.assignment) fail("PROCESS_RESULT_ORDER_INVALID");
      assertProcessResult(event.result, frame.assignment);
      if (resultIds.has(event.result.result_id)) fail("PROCESS_RESULT_REUSED");
      resultIds.add(event.result.result_id); frame.result = event.result;
      if (event.result.outcome === "completed") finish(frame);
      else stop(frame, "FAILED", event.result.outcome === "rejected" ? "PROCESS_REVIEW_REJECTED" : "PROCESS_ACTIVITY_FAILED");
    } else fail("PROCESS_EVENT_UNSUPPORTED");
  }
  return { status: frames.get("root").status, first_failure: failure, occurrences: [...frames.values()],
    ready: [...frames.values()].filter(frame => frame.status === "READY").map(frame => frame.occurrence_id),
    waiting: [...frames.values()].filter(frame => frame.status === "WAITING").map(frame => frame.occurrence_id) };
}

export function assertAgenticProcessInstance(instance) {
  if (checkShadowJson(instance) || validateJsonSchema(instance, instanceSchema, "$", { contractKind: "workflow-definition" }).length || !exactKeys(instance, ["contract_version", "profile", "instance_id", "model", "model_sha256", "policy_pins", "scope_id", "initial_facts", "revision", "events", "instance_sha256"])
    || instance.contract_version !== "agentic-process-instance.v1" || instance.profile !== AGENTIC_PROCESS_PROFILE
    || !processId(instance.instance_id) || typeof instance.scope_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(instance.scope_id)
    || !factsValid(instance.initial_facts) || !Array.isArray(instance.events) || instance.events.length > 512
    || instance.revision !== instance.events.length + 1 || instance.model_sha256 !== shadowHash(instance.model)
    || instance.instance_sha256 !== shadowHash(content(instance))) fail("PROCESS_INSTANCE_INVALID");
  assertAgenticProcessModel(instance.model, { policyPins: instance.policy_pins }); replay(instance); return instance;
}
function seal(value) {
  const instance = { ...value, instance_sha256: shadowHash(value) };
  assertAgenticProcessInstance(instance); return freezeShadow(instance);
}
export function createAgenticProcess({ instanceId, model, policyPins, scopeId, facts = {} }) {
  if (checkShadowJson({ instanceId, model, policyPins, scopeId, facts }) || policyPins === null) fail("PROCESS_INPUT_INVALID");
  assertAgenticProcessModel(model, { policyPins });
  return seal({ contract_version: "agentic-process-instance.v1", profile: AGENTIC_PROCESS_PROFILE, instance_id: instanceId,
    model: structuredClone(model), model_sha256: shadowHash(model), policy_pins: structuredClone(policyPins), scope_id: scopeId,
    initial_facts: structuredClone(facts), revision: 1, events: [] });
}
export function inspectAgenticProcess(instance) { assertAgenticProcessInstance(instance); return freezeShadow(replay(instance)); }
export function advanceAgenticProcess(instance, event) {
  assertAgenticProcessInstance(instance);
  if (checkShadowJson(event)) fail("PROCESS_EVENT_INVALID");
  const existing = instance.events.find(row => row.event_id === event.event_id);
  if (existing) {
    if (shadowHash(existing) !== shadowHash(event)) fail("PROCESS_EVENT_ID_CONFLICT");
    return instance;
  }
  return seal({ ...content(instance), revision: instance.revision + 1, events: [...instance.events, structuredClone(event)] });
}
