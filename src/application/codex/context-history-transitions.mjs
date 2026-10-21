import { sha256, stableContextJson } from "../../core/context/working-memory-policy.mjs";

const FIELDS = ["skill", "target", "mode", "state_mode", "strict", "ok", "fallback", "command", "command_status",
  "decision", "action", "result", "reason_code", "reason_codes", "repair_layer_open_count", "repair_layer_blocking",
  "repair_layer_status", "repair_layer_advice", "repair_primary_reason", "repair_layer_top_findings", "gates_triggered",
  "error", "reusable", "reuse_status", "reuse_reasons"];

// Presentation only: identical typed decisions and provenance bindings form a
// transition. Distinct executions/raw observations remain distinct references;
// no audit-store entry is merged, removed or turned into fresh admission.
export function projectHistoryTransitions(history) {
  const transitions = [];
  let previous = null, position = 0;
  for (const entry of history) {
    const decision = Object.fromEntries(FIELDS.filter(key => entry[key] !== undefined).map(key => [key, entry[key]]));
    const before = entry.provenance?.before, after = entry.provenance?.after;
    const bound = entry.provenance?.kind === "hook-command-observation.v1" && entry.state_mode === "files"
      && before?.state_mode === "files" && after?.state_mode === "files"
      && /^[a-f0-9]{64}$/.test(before.fingerprint ?? "") && before.fingerprint === after.fingerprint
      && ["current", "stale", "failed"].includes(entry.reuse_status);
    const signature = sha256(stableContextJson({ decision, provenance: entry.provenance ?? null,
      unbound_observation: bound ? null : position }));
    position++;
    if (signature !== previous) {
      transitions.push({ kind: "context-decision-transition.v1", ...decision,
        provenance_binding: signature, binding_status: bound ? "files-context-bound" : "unavailable",
        first_ts: entry.ts ?? null, last_ts: entry.ts ?? null,
        observation_count: 0, observations: [], evidence_status: "unverified-history-references",
        write_authorization: false, requires_fresh_admission: true });
      previous = signature;
    }
    const current = transitions.at(-1);
    current.last_ts = entry.ts ?? null;
    current.observation_count++;
    current.observations.push({ id: entry.id ?? null, execution_id: entry.execution_id ?? null,
      ts: entry.ts ?? null, payload_digest: entry.payload_digest ?? null, raw_file: entry.raw_file ?? null });
  }
  return transitions;
}
