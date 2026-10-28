import { createHash } from "node:crypto";
import { canAgentRolePerform, isKnownAgentRole, normalizeAgentRole, normalizeAgentAction } from "./agent-role-model.mjs";
import { evaluateAgentTransition, isKnownAgentMode } from "./agent-transition-policy.mjs";

export const AGENT_REUSE_POLICY = "sequential-agent-reuse.v1";
const hash = text => createHash("sha256").update(text).digest("hex");
export function fingerprintAgentReuse(value) {
  const canonical = v => v === null || typeof v !== "object" ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
      : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return hash(canonical(value));
}
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const id = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const list = (v, predicate, max = 128) => Array.isArray(v) && v.length <= max && v.every(predicate);
const strings = v => list(v, id) && new Set(v).size === v.length;
const keys = (v, allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k));
const requireThat = condition => { if (!condition) throw Object.assign(new Error("AGENT_REUSE_INPUT_INVALID"), { code: "AGENT_REUSE_INPUT_INVALID" }); };

export function assertAgentReuseRequest(r) {
  requireThat(keys(r, ["contract_version", "activity_id", "scope_id", "revision", "assurance_profile", "artifact_sha256",
    "criteria_sha256", "mode", "role", "action", "independent_review", "context_isolation_required",
    "required_permissions", "allowed_permissions", "allowed_context_sha256", "reviewed_contributors"])
    && r.contract_version === "agent-reuse-request.v1");
  for (const k of ["activity_id", "scope_id", "revision", "assurance_profile"]) requireThat(id(r[k]));
  for (const k of ["artifact_sha256", "criteria_sha256"]) requireThat(digest(r[k]));
  requireThat(isKnownAgentMode(r.mode) && r.mode === r.mode.toUpperCase()
    && r.role === normalizeAgentRole(r.role) && r.action === normalizeAgentAction(r.action)
    && isKnownAgentRole(r.role) && canAgentRolePerform(r.role, r.action));
  requireThat(typeof r.independent_review === "boolean" && typeof r.context_isolation_required === "boolean");
  requireThat(!r.independent_review || (normalizeAgentRole(r.role) === "auditor" && normalizeAgentAction(r.action) === "audit"));
  requireThat(strings(r.required_permissions) && strings(r.allowed_permissions)
    && r.required_permissions.every(p => r.allowed_permissions.includes(p)));
  requireThat(list(r.allowed_context_sha256, digest) && r.allowed_context_sha256.length > 0);
  requireThat(list(r.reviewed_contributors, c => keys(c, ["agent_id", "lineage_id"]) && id(c.agent_id) && id(c.lineage_id)));
  return r;
}

export function assertAgentReuseObservation(o) {
  requireThat(keys(o, ["contract_version", "authority_id", "observation_id", "scope_id", "revision", "assurance_profile",
    "request_sha256", "artifact_sha256", "criteria_sha256", "observed_at", "expires_at", "current_execution_id",
    "executors", "evidence_refs"]) && o.contract_version === "agent-reuse-observation.v1");
  for (const k of ["authority_id", "observation_id", "scope_id", "revision", "assurance_profile"]) requireThat(id(o[k]));
  for (const k of ["request_sha256", "artifact_sha256", "criteria_sha256"]) requireThat(digest(o[k]));
  requireThat(typeof o.observed_at === "string" && Number.isFinite(Date.parse(o.observed_at))
    && typeof o.expires_at === "string" && Number.isFinite(Date.parse(o.expires_at)));
  requireThat(o.current_execution_id === null || id(o.current_execution_id));
  requireThat(list(o.executors, e => {
    if (!keys(e, ["execution_id", "agent_id", "lineage_id", "session_id", "adapter_id", "role", "action",
      "permissions", "guarantees", "context_sha256", "contributions"])) return false;
    if (!["execution_id", "agent_id", "lineage_id", "session_id", "adapter_id"].every(k => id(e[k]))) return false;
    if (!isKnownAgentRole(e.role) || !canAgentRolePerform(e.role, e.action)) return false;
    return strings(e.permissions) && strings(e.guarantees) && list(e.context_sha256, digest)
      && e.context_sha256.length > 0 && list(e.contributions, c => keys(c, ["scope_id", "revision", "activity_id", "artifact_sha256", "role"])
        && ["scope_id", "revision", "activity_id"].every(k => id(c[k]))
        && digest(c.artifact_sha256) && isKnownAgentRole(c.role));
  }, 16));
  requireThat(new Set(o.executors.map(e => e.execution_id)).size === o.executors.length);
  requireThat(list(o.evidence_refs, e => keys(e, ["ref", "sha256"]) && id(e.ref) && digest(e.sha256), 16) && o.evidence_refs.length > 0);
  return o;
}

export function agentReuseWait(reason, request = null) {
  return { contract_version: "agent-reuse-decision.v1", policy: AGENT_REUSE_POLICY,
    decision: "wait", reason_code: reason, request_sha256: request ? fingerprintAgentReuse(request) : null,
    observation_sha256: null, authority_id: null, observation_id: null, execution_id: null,
    agent_id: null, lineage_id: null, session_id: null, adapter_id: null, role: request?.role ?? null,
    action: request?.action ?? null, contribution_sha256: null, evidence_refs: [],
    rejected: [], write_authorization: false, native_qualification: "NOT_PROVEN" };
}

// Only evaluate observations authenticated by the composition's authority port.
// This pure policy neither reads a roster nor authenticates a native identity.
export function evaluateAgentReuse({ request, observation, eligibleAdapterIds, now = Date.now() }) {
  assertAgentReuseRequest(request); assertAgentReuseObservation(observation);
  requireThat(strings(eligibleAdapterIds));
  const wait = reason => ({ ...agentReuseWait(reason, request),
    observation_sha256: fingerprintAgentReuse(observation), authority_id: observation.authority_id,
    observation_id: observation.observation_id, evidence_refs: structuredClone(observation.evidence_refs) });
  if (observation.request_sha256 !== fingerprintAgentReuse(request)
      || ["scope_id", "revision", "artifact_sha256", "criteria_sha256", "assurance_profile"]
        .some(k => observation[k] !== request[k])) return wait("OBSERVATION_BINDING_MISMATCH");
  const observedAt = Date.parse(observation.observed_at), expiresAt = Date.parse(observation.expires_at);
  if (!Number.isFinite(now) || observedAt > now || expiresAt <= now || expiresAt <= observedAt
      || expiresAt - observedAt > 10000) return wait("OBSERVATION_STALE");
  const current = observation.executors.find(e => e.execution_id === observation.current_execution_id);
  const rejected = [];
  function rejection(e) {
    if (!eligibleAdapterIds.includes(e.adapter_id)) return "ADAPTER_NOT_ELIGIBLE";
    if (!e.permissions.every(p => request.allowed_permissions.includes(p))
        || !request.required_permissions.every(p => e.permissions.includes(p))) return "EFFECTIVE_PERMISSIONS_MISMATCH";
    if (!e.context_sha256.every(h => request.allowed_context_sha256.includes(h))) return "CONTEXT_PROVENANCE_MISMATCH";
    if ((request.context_isolation_required || request.independent_review) && !e.guarantees.includes("context-isolated")) return "CONTEXT_ISOLATION_UNPROVEN";
    if (request.independent_review) {
      if (!e.guarantees.includes("protected-verdict")) return "VERDICT_AUTHORITY_UNPROVEN";
      if (request.reviewed_contributors.some(c => c.agent_id === e.agent_id || c.lineage_id === e.lineage_id)
          || e.contributions.some(c => c.scope_id === request.scope_id)) return "REVIEWED_CONTRIBUTOR_EXCLUDED";
    }
    if (normalizeAgentRole(e.role) !== normalizeAgentRole(request.role)
        && !evaluateAgentTransition({ mode: request.mode, fromRole: e.role, fromAction: e.action,
          toRole: request.role, toAction: request.action }).allowed) return "ROLE_TRANSITION_REFUSED";
    return null;
  }
  const candidates = [...(current ? [current] : []), ...observation.executors
    .filter(e => e !== current).sort((a, b) => a.execution_id.localeCompare(b.execution_id))];
  for (const e of candidates) {
    const reason = rejection(e);
    if (reason) { rejected.push({ execution_id: e.execution_id, reason_code: reason }); continue; }
    return { ...wait("NO_ELIGIBLE_EXECUTOR"), decision: e === current ? "reuse" : "separate",
      reason_code: e === current ? "CURRENT_EXECUTOR_ELIGIBLE" : "SEPARATE_EXECUTOR_REQUIRED",
      observation_sha256: fingerprintAgentReuse(observation), authority_id: observation.authority_id,
      observation_id: observation.observation_id, execution_id: e.execution_id, agent_id: e.agent_id,
      lineage_id: e.lineage_id, session_id: e.session_id, adapter_id: e.adapter_id,
      contribution_sha256: fingerprintAgentReuse(e.contributions), evidence_refs: structuredClone(observation.evidence_refs), rejected };
  }
  return { ...wait("NO_ELIGIBLE_EXECUTOR"), observation_sha256: fingerprintAgentReuse(observation),
    authority_id: observation.authority_id, observation_id: observation.observation_id,
    evidence_refs: structuredClone(observation.evidence_refs), rejected };
}
