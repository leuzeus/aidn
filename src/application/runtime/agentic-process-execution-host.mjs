import { randomUUID } from "node:crypto";
import { fingerprintAgentReuse, assertAgentReuseRequest } from "../../core/agents/agent-reuse-policy.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { processFail as fail } from "../../core/workflow/agentic-process-model.mjs";
import { evaluateAgentTransition } from "../../core/agents/agent-transition-policy.mjs";

// A composition-owned authority, not an attestation supplied by a worker. Only
// sessionFactory creates native resources; result receipts originate here after
// the session adapter has correlated and verified its actual terminal event.
export function createAgenticProcessExecutionHost({ sessionFactory, inputs, evidence, now = Date.now, deadline }) {
  const authorityId = `host-${randomUUID()}`, resources = new Map(), observations = new Map(), results = new Map(), prepared = new Map();
  let current = null, stopped = false;
  const remaining = () => { if (stopped || now() >= deadline) fail("PROCESS_HOST_DEADLINE"); return deadline - now(); };
  const checked = value => { if (checkShadowJson(value)) fail("PROCESS_HOST_DATA_INVALID"); return structuredClone(value); };
  async function snapshot(resource) {
    remaining();
    const observed = checked(await resource.session.observe());
    remaining();
    if (observed.session_id !== resource.sessionId || observed.binding_sha256 !== resource.binding
      || observed.closed !== false || shadowHash(observed.permissions) !== shadowHash(resource.permissions)
      || shadowHash(observed.guarantees) !== shadowHash(resource.guarantees)) fail("PROCESS_HOST_SESSION_CHANGED");
    return observed;
  }
  function describe(resource) {
    return { execution_id: resource.id, agent_id: resource.agentId, lineage_id: resource.lineageId, session_id: resource.sessionId,
      adapter_id: "codex-agentic-session", role: resource.role, action: resource.action,
      permissions: [...resource.permissions], guarantees: [...resource.guarantees], context_sha256: [...resource.context],
      contributions: structuredClone(resource.contributions) };
  }
  async function prepare({ instance, frame, node, role, policy }) {
    remaining();
    const raw = await inputs.prepare({ instance, frame, node, role, policy });
    if (!raw || Object.values(Object.getOwnPropertyDescriptors(raw)).some(row => !Object.hasOwn(row, "value"))) fail("PROCESS_HOST_DATA_INVALID");
    const { instruction, developer_instructions: developer, ...metadata } = raw;
    if ([instruction, developer].some(text => typeof text !== "string" || Buffer.byteLength(text) > 131072)) fail("PROCESS_HOST_CONTEXT_LIMIT");
    const input = { ...checked(metadata), instruction, developer_instructions: developer };
    const instructionHash = shadowHash(input.instruction);
    if (typeof input.instruction !== "string" || !input.instruction.trim() || !input.binding) fail("PROCESS_HOST_INPUT_REQUIRED");
    let resource = !policy.independent_review && !policy.context_isolation_required ? resources.get(current) : null;
    if (resource && (shadowHash(resource.permissions) !== shadowHash(policy.allowed_permissions)
      || role.skills.some(skill => !resource.skills.includes(skill))
      || resource.role !== role.role && !evaluateAgentTransition({ mode: policy.mode, fromRole: resource.role,
        fromAction: resource.action, toRole: role.role, toAction: role.action }).allowed)) resource = null;
    if (!resource) {
      const session = await sessionFactory.open({ instance, frame, role, policy, input, deadline });
      const observed = checked(await session.observe());
      if (typeof observed.session_id !== "string" || !observed.session_id || !/^[a-f0-9]{64}$/.test(observed.binding_sha256)
        || observed.closed !== false || !Array.isArray(observed.permissions) || !Array.isArray(observed.guarantees)
        || !Array.isArray(observed.context_sha256) || !observed.context_sha256.length
        || !Array.isArray(observed.skills) || role.skills.some(skill => !observed.skills.includes(skill))) {
        await session.close(); fail("PROCESS_HOST_SESSION_UNOBSERVED");
      }
      resource = { id: `execution-${randomUUID()}`, agentId: `agent-${randomUUID()}`, lineageId: `lineage-${randomUUID()}`,
        sessionId: observed.session_id, binding: observed.binding_sha256, permissions: observed.permissions,
        guarantees: observed.guarantees, context: [...observed.context_sha256], skills: [...observed.skills],
        role: role.role, action: role.action, contributions: [], session };
      resources.set(resource.id, resource);
    }
    await snapshot(resource);
    const allowed = policy.independent_review || policy.context_isolation_required
      ? [...resource.context, instructionHash] : [...new Set([...resource.context, instructionHash])];
    const binding = { ...input.binding, allowed_context_sha256: allowed,
      reviewed_contributors: [...resources.values()].flatMap(item => item.contributions.some(c => c.scope_id === instance.scope_id)
        ? [{ agent_id: item.agentId, lineage_id: item.lineageId }] : []) };
    prepared.set(frame.occurrence_id, { input, binding, resource, instructionHash, policy, role });
    // Candidate preference is not a verdict identity substitution. Each request
    // observes the selected resource; historical identities stay in its record.
    current = resource.id;
    return structuredClone(binding);
  }
  function readBinding({ occurrence_id }) {
    const value = prepared.get(occurrence_id);
    if (!value) fail("PROCESS_HOST_ACTIVITY_NOT_PREPARED");
    inputs.assertCurrent(value.input, { review: value.policy.independent_review });
    return structuredClone(value.binding);
  }
  const assignmentAuthority = Object.freeze({
    async observe({ request, phase, signal }) {
      remaining(); assertAgentReuseRequest(request);
      const task = prepared.get(request.activity_id);
      if (!task || signal?.aborted) fail("PROCESS_HOST_OBSERVATION_CANCELLED");
      inputs.assertCurrent(task.input, { review: task.policy.independent_review });
      const selected = task.resource;
      await snapshot(selected);
      const row = { contract_version: "agent-reuse-observation.v1", authority_id: authorityId,
        observation_id: `observation-${randomUUID()}`, request_sha256: fingerprintAgentReuse(request),
        ...Object.fromEntries(["scope_id", "revision", "assurance_profile", "artifact_sha256", "criteria_sha256"].map(key => [key, request[key]])),
        observed_at: new Date(now()).toISOString(), expires_at: new Date(Math.min(deadline, now() + 5000)).toISOString(),
        current_execution_id: selected.id, executors: [describe(selected)], evidence_refs: [] };
      const reference = await evidence.retain("assignment-observation", { phase, request_sha256: row.request_sha256,
        session_binding_sha256: selected.binding, executor: describe(selected) });
      row.evidence_refs.push(reference);
      if (observations.size >= 64) observations.delete(observations.keys().next().value);
      observations.set(shadowHash(row), { request: row.request_sha256, resource: selected.id, state: shadowHash(describe(selected)) });
      return row;
    },
    async verify({ request, observation, requirements, signal }) {
      remaining();
      const retained = observations.get(shadowHash(observation)), resource = retained && resources.get(retained.resource);
      if (!resource || signal?.aborted || retained.request !== shadowHash(request)
        || retained.state !== shadowHash(describe(resource))) fail("PROCESS_HOST_OBSERVATION_NOT_ISSUED");
      await snapshot(resource);
      if (requirements?.skills.some(skill => !resource.skills.includes(skill))) fail("PROCESS_HOST_SKILL_UNAVAILABLE");
      return { outcome: "verified", authority_id: authorityId, request_sha256: retained.request,
        observation_sha256: shadowHash(observation), ...(requirements ? { requirements_sha256: shadowHash(requirements) } : {}) };
    },
  });
  async function execute({ instance, occurrenceId, signal }) {
    remaining();
    const task = prepared.get(occurrenceId), frame = instance.events.findLast(row => row.kind === "assign" && row.occurrence_id === occurrenceId);
    if (!task || !frame || frame.decision.execution_id !== task.resource.id) fail("PROCESS_HOST_PERSISTED_ASSIGNMENT_REQUIRED");
    const resource = task.resource;
    await snapshot(resource); inputs.assertCurrent(task.input, { review: task.policy.independent_review });
    if (!task.policy.independent_review) resource.contributions.push({ scope_id: instance.scope_id,
      revision: frame.request.revision, activity_id: occurrenceId, artifact_sha256: frame.request.artifact_sha256, role: frame.request.role });
    const completion = checked(await resource.session.run({ instruction: task.input.instruction,
      request_sha256: shadowHash(frame.request), signal, deadline }));
    remaining();
    if (completion.session_id !== resource.sessionId || completion.binding_sha256 !== resource.binding
      || !["completed", "failed", "rejected"].includes(completion.outcome)
      || !completion.evidence_refs?.length) fail("PROCESS_HOST_COMPLETION_UNBOUND");
    await inputs.completed(task.input, completion);
    resource.context.push(task.instructionHash); resource.context = [...new Set(resource.context)];
    resource.role = frame.request.role; resource.action = frame.request.action;
    const result = { result_id: `result-${randomUUID()}`, request_sha256: shadowHash(frame.request), execution_id: resource.id,
      revision: frame.request.revision, artifact_sha256: frame.request.artifact_sha256, criteria_sha256: frame.request.criteria_sha256,
      outcome: completion.outcome, evidence_refs: completion.evidence_refs };
    const reference = await evidence.retain("protected-result", { result, session_id: resource.sessionId,
      native_receipt_sha256: shadowHash(completion) });
    results.set(result.result_id, { result: structuredClone(result), resource: resource.id, reference });
    return { resultId: result.result_id, outcome: result.outcome };
  }
  const resultAuthority = Object.freeze({
    async read({ result_id, request }) {
      remaining(); const row = results.get(result_id);
      if (!row || row.result.request_sha256 !== shadowHash(request)) fail("PROCESS_HOST_RESULT_NOT_ISSUED");
      await evidence.verify(row.reference); return structuredClone(row.result);
    },
    async verify({ result, request }) {
      remaining(); const row = results.get(result.result_id);
      if (!row || shadowHash(row.result) !== shadowHash(result) || row.result.request_sha256 !== shadowHash(request)) fail("PROCESS_HOST_RESULT_NOT_ISSUED");
      await evidence.verify(row.reference); await snapshot(resources.get(row.resource));
      return { outcome: "verified", authority_id: authorityId, result_sha256: shadowHash(result),
        request_sha256: shadowHash(request), execution_id: row.resource };
    },
  });
  return Object.freeze({ prepare, readBinding, assignmentAuthority, resultAuthority, execute,
    async close() {
      stopped = true; let failure = false;
      for (const resource of resources.values()) try { if ((await resource.session.close())?.closed !== true) failure = true; } catch { failure = true; }
      if (typeof sessionFactory.close === "function") try { if ((await sessionFactory.close())?.closed !== true) failure = true; } catch { failure = true; }
      if (failure) fail("PROCESS_HOST_CLOSE_UNCONFIRMED");
      return { closed: true, resources: resources.size };
    },
  });
}
