import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import telemetrySchema from "../contracts/context/context-telemetry.v1.schema.json" with { type: "json" };
import { memoryFailure, sha256, stableContextJson } from "./working-memory-policy.mjs";

const PARTS = ["pinned_tokens", "working_memory_tokens", "retrieved_artifact_tokens", "recent_tail_tokens", "tool_output_tokens"];
const COUNTS = ["compact_count", "new_context_count", "retrieval_count", "source_revision_changes", "stale_rejection_count"];
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");

export function validateContextTelemetry(telemetry, now = Date.now()) {
  if (validateJsonSchema(telemetry, telemetrySchema, "$", { contractKind: "context" }).length)
    memoryFailure("CONTEXT_TELEMETRY_INVALID");
  const time = Date.parse(telemetry.observed_at);
  if (!Number.isFinite(time) || time > now + 5000 || now - time > 300000)
    memoryFailure("CONTEXT_TELEMETRY_STALE");
  const known = PARTS.map(key => telemetry.parts?.[key]).filter(value => value != null);
  if (telemetry.used_tokens > telemetry.capacity_tokens || telemetry.reserved_tokens > telemetry.capacity_tokens
      || known.reduce((a, b) => a + b, 0) > telemetry.used_tokens)
    memoryFailure("CONTEXT_TELEMETRY_INCONSISTENT");
}

export function buildContextMetrics({ memory, checkpoint, canonical, observedRevision, telemetry = null }) {
  if (telemetry) validateContextTelemetry(telemetry);
  return {
    contract_version: "context-metrics.v1", run_id: checkpoint.run_id, observed_at: checkpoint.ts,
    agent_id: memory.agent_id, window_id: telemetry?.window_id ?? null,
    model: telemetry?.model ?? null, provider: telemetry?.provider ?? null,
    source_revision: sha256(stableContextJson({ canonical, checkout: observedRevision.fingerprint })),
    token_source: telemetry ? "client-reported" : "unknown",
    telemetry: telemetry ?? null,
    tokens: { input_tokens: telemetry?.used_tokens ?? null,
      capacity_tokens: telemetry?.capacity_tokens ?? null,
      remaining_tokens: telemetry ? telemetry.capacity_tokens - telemetry.used_tokens : null,
      ...Object.fromEntries(PARTS.map(key => [key, telemetry?.parts?.[key] ?? null])) },
    bytes: { working_memory: bytes(memory), evidence_descriptors: bytes(memory.evidence_refs),
      referenced_evidence: memory.evidence_refs.reduce((total, ref) => total + ref.bytes, 0),
      externalized_tool_outputs: [...new Set((memory.tool_output_summaries ?? []).flatMap(summary => summary.evidence_refs))]
        .reduce((total, ref) => total + (memory.evidence_refs.find(item => item.ref === ref)?.bytes ?? 0), 0),
      pinned: null, retrieved_artifacts: null, recent_tail: null, tool_outputs: null },
    // Counts are deltas for this checkpoint observation, not lifetime totals.
    counts: { checkpoint_count: 1, ...Object.fromEntries(COUNTS.map(key => [key, telemetry?.counts?.[key] ?? null])) },
    count_scope: "observation-delta", admission_evidence: false,
  };
}

export function evaluateContextPressure(telemetry, now = Date.now()) {
  const unknown = reason => ({ contract_version: "context-pressure.v1", pressure: "unknown",
    window_id: null, remaining_tokens: null, recommended_action: "refresh_client_telemetry",
    telemetry_source: "unknown", reason, write_authorization: false });
  if (!telemetry) return unknown("client_telemetry_unavailable");
  try { validateContextTelemetry(telemetry, now); } catch { return unknown("client_telemetry_invalid_or_stale"); }
  const remaining = telemetry.capacity_tokens - telemetry.used_tokens;
  const ratio = telemetry.used_tokens / telemetry.capacity_tokens;
  const pressure = remaining <= telemetry.reserved_tokens || ratio >= 0.9 ? "urgent" : ratio >= 0.75 ? "elevated" : "normal";
  return { contract_version: "context-pressure.v1", pressure, window_id: telemetry.window_id, remaining_tokens: remaining,
    recommended_action: pressure === "normal" ? "continue" : "checkpoint_at_semantic_boundary",
    telemetry_source: "client-reported", reason: "bounded_client_observation", write_authorization: false };
}
