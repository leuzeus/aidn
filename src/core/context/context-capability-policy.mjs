const CASES = Object.freeze(["governance_needle", "cycle_sketchpad", "artifact_kv", "log_triage", "stale_revision",
  "long_session_resume", "agent_handoff", "injection_persistence", "compaction_drift"]);
const IDENTITY = ["provider", "model", "model_revision", "client", "client_version"];
const immutable = value => Object.freeze({ ...value,
  native_events: Object.freeze([...value.native_events]) });

// Qualifications are supplied by a trusted host integration, never by working
// memory, an evidence body, a model name heuristic or telemetry JSON.
export function resolveContextCapabilities(identity, qualifications = [], now = Date.now()) {
  const fallback = reason => immutable({ contract_version: "context-capabilities.v1", mode: "harness", reason,
    can_edit_working_ledger: false, can_request_new_context: false, can_edit_live_context: false,
    native_events: [], context_awareness: "telemetry-required", write_authorization: false });
  if (!identity || !IDENTITY.every(key => typeof identity[key] === "string" && identity[key])) return fallback("identity_unavailable");
  const matches = (Array.isArray(qualifications) ? qualifications : []).filter(item => IDENTITY.every(key => item?.[key] === identity[key]));
  if (matches.length !== 1) return fallback(matches.length ? "qualification_ambiguous" : "qualification_unavailable");
  const profile = matches[0];
  if (!Number.isFinite(Date.parse(profile.valid_until)) || Date.parse(profile.valid_until) <= now)
    return fallback("qualification_expired_or_undated");
  if (profile.proof_class !== "native" || profile.invariants !== "pass" || profile.task_success !== "pass"
      || profile.continuation !== "pass" || !CASES.every(name => profile.context_bench?.[name] === "pass")
      || !/^[a-f0-9]{64}$/.test(profile.evidence_sha256 ?? "")
      || !["harness", "constrained", "model-owned"].includes(profile.mode)
      || !Array.isArray(profile.native_events)
      || profile.native_events.some(event => !["PreCompact", "PostCompact", "SessionStart", "SubagentStop"].includes(event)))
    return fallback("qualification_incomplete");
  // A dedicated host can replace its complete explicit token input. Codex's
  // transcript remains outside this port; no model alias or fixture enables it.
  const localLiveInput = profile.mode === "model-owned" && identity.client === "aidn-local-clm" && identity.provider === "local-llama.cpp"
    && /^[a-f0-9]{64}$/.test(identity.client_version) && /^[a-f0-9]{64}$/.test(identity.model_revision)
    && profile.live_context_port === "local-token-input-v1"
    && profile.native_input_evidence_sha256 === profile.evidence_sha256
    && profile.tokenizer_sha256 === identity.model_revision && profile.input_budget === "native-exact"
    && profile.edit_gate === "protected-prefix-and-critical-evidence" && profile.rollback === "native-qualified"
    && profile.native_events.length === 0 && profile.new_context === "unavailable";
  if (profile.live_context_port != null && !localLiveInput) return fallback("qualification_incomplete");
  return immutable({ contract_version: "context-capabilities.v1", mode: profile.mode, reason: "exact_native_qualification",
    can_edit_working_ledger: profile.mode !== "harness",
    can_request_new_context: profile.mode !== "harness" && profile.new_context === "native-qualified",
    can_edit_live_context: localLiveInput, native_events: [...new Set(profile.native_events)],
    context_awareness: "telemetry-required", write_authorization: false });
}

export function contextBenchmarkCases() { return [...CASES]; }
