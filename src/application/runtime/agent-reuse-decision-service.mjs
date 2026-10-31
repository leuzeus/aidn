import { rankAgentAdapters } from "../../core/agents/agent-selection-policy.mjs";
import { assertAgentReuseRequest, assertAgentReuseObservation, agentReuseWait, evaluateAgentReuse,
  fingerprintAgentReuse } from "../../core/agents/agent-reuse-policy.mjs";

// No default provider, disk attestation, native launcher or trust boolean. The
// embedding host supplies a read-only authority which verifies retained evidence
// and effective rights; authored JSON and an adapter ID cannot supply that proof.
export async function decideAgentReuse({ request, authority, recommendation, scope, requestedAgent = "auto",
  adapters, roster, adapterHealth, phase = "assignment", expectedExecutionId = null, now = Date.now,
  timeoutMs = 1000, requiredSkills = [] } = {}) {
  if (request == null) return null; // Existing callers do not opt in implicitly.
  let frozen;
  try { frozen = structuredClone(assertAgentReuseRequest(structuredClone(request))); }
  catch { return agentReuseWait("REQUEST_INVALID"); }
  const wait = reason => agentReuseWait(reason, frozen);
  if (!Array.isArray(requiredSkills) || requiredSkills.length > 128 || new Set(requiredSkills).size !== requiredSkills.length
    || requiredSkills.some(skill => typeof skill !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(skill))) return wait("SKILL_REQUIREMENTS_INVALID");
  const requirements = Object.freeze({ skills: Object.freeze([...requiredSkills]) });
  if (!["assignment", "before_step", "verdict"].includes(phase)) return wait("PHASE_INVALID");
  if (phase === "verdict" && typeof expectedExecutionId !== "string") return wait("VERDICT_EXECUTOR_REQUIRED");
  if (frozen.role !== recommendation?.role || frozen.action !== recommendation?.action
      || (recommendation?.mode != null && frozen.mode !== recommendation.mode)
      || frozen.scope_id !== scope?.scope_id) return wait("DISPATCH_BINDING_MISMATCH");
  if (!authority || typeof authority.observe !== "function" || typeof authority.verify !== "function") return wait("ASSIGNMENT_AUTHORITY_UNAVAILABLE");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return wait("AUTHORITY_TIMEOUT_INVALID");
  const stop = new AbortController(); let timer;
  try {
    const requestSha = fingerprintAgentReuse(frozen);
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      stop.abort(); reject(Object.assign(new Error("ASSIGNMENT_OBSERVATION_TIMEOUT"), { code: "ASSIGNMENT_OBSERVATION_TIMEOUT" }));
    }, timeoutMs); });
    const bounded = operation => Promise.race([Promise.resolve().then(operation), timeout]);
    const observation = structuredClone(await bounded(() => authority.observe({ request: structuredClone(frozen),
      request_sha256: requestSha, phase, signal: stop.signal, ...(requirements.skills.length ? { requirements } : {}) })));
    assertAgentReuseObservation(observation);
    const observationSha = fingerprintAgentReuse(observation);
    const verified = await bounded(() => authority.verify({ request: structuredClone(frozen),
      observation: structuredClone(observation), phase, signal: stop.signal, ...(requirements.skills.length ? { requirements } : {}) }));
    if (verified?.request_sha256 !== requestSha || verified?.observation_sha256 !== observationSha
        || verified?.authority_id !== observation.authority_id || verified?.outcome !== "verified"
        || requirements.skills.length && verified.requirements_sha256 !== fingerprintAgentReuse(requirements)) return wait("OBSERVATION_NOT_AUTHENTICATED");
    const eligibleAdapterIds = rankAgentAdapters({ role: frozen.role, action: frozen.action, adapters, roster, adapterHealth })
      .map(row => row.profile.id);
    const explicit = requestedAgent !== "auto" ? requestedAgent : roster?.default_requested_agent;
    const allowedIds = explicit && explicit !== "auto" ? eligibleAdapterIds.filter(id => id === explicit) : eligibleAdapterIds;
    const decision = evaluateAgentReuse({ request: frozen, observation, eligibleAdapterIds: allowedIds, now: now() });
    if (phase === "verdict" && (decision.decision !== "reuse" || decision.execution_id !== expectedExecutionId)) {
      return { ...decision, decision: "wait", reason_code: "VERDICT_EXECUTOR_INELIGIBLE" };
    }
    return decision;
  } catch (error) { return wait(error?.code === "ASSIGNMENT_OBSERVATION_TIMEOUT" ? error.code : "ASSIGNMENT_OBSERVATION_UNAVAILABLE"); }
  finally { clearTimeout(timer); stop.abort(); }
}
