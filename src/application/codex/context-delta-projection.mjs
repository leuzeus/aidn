import { isDeepStrictEqual } from "node:util";
import { sha256 } from "../../core/context/working-memory-policy.mjs";

const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const binding = unit => ({ path: unit.path, heading: unit.heading, authority: unit.authority,
  scope: unit.scope, lifecycle_status: unit.lifecycle_status, dependency_reason: unit.dependency_reason,
  cross_workspace: unit.cross_workspace, cross_worktree: unit.cross_worktree });

// The baseline is a caller-held prior observation, never a source of authority.
// Fresh mandatory units and their complete dependency closure are always sent.
export function projectContextDelta(selection, baseline) {
  const full = reason => ({ ...selection, delta: { contract_version: "context-delta.v1", mode: "full",
    reason, baseline_revision: null, source_revision: selection.source_revision,
    unchanged_optional_refs: [], removed_unit_ids: [], write_authorization: false } });
  if (selection.status !== "complete") return full("current_selection_blocked");
  if (!baseline?.context_selection || baseline.context_selection.status !== "complete"
      || !hash(baseline.source_revision) || !Array.isArray(baseline.artifacts) || baseline.artifacts.length > 128
      || !isDeepStrictEqual(baseline.context_selection.scope, selection.scope)
      || baseline.context_selection.purpose !== selection.purpose
      || baseline.context_delta?.mode === "differential") return full("baseline_unavailable_or_incompatible");
  const previous = new Map();
  for (const unit of baseline.artifacts) {
    if (!unit || typeof unit.unit_id !== "string" || previous.has(unit.unit_id)
        || typeof unit.content_excerpt !== "string" || !hash(unit.unit_sha256)
        || sha256(unit.content_excerpt) !== unit.unit_sha256 || !hash(unit.sha256)) return full("baseline_integrity_invalid");
    previous.set(unit.unit_id, unit);
  }
  const mandatory = new Set(selection.mandatory_ids);
  const unchanged = [];
  const units = selection.units.filter(unit => {
    const old = previous.get(unit.unit_id);
    if (mandatory.has(unit.unit_id) || !old || old.sha256 !== unit.sha256
        || old.unit_sha256 !== unit.unit_sha256 || !isDeepStrictEqual(binding(old), binding(unit))) return true;
    unchanged.push({ unit_id: unit.unit_id, path: unit.path, sha256: unit.sha256, unit_sha256: unit.unit_sha256 });
    return false;
  });
  const current = new Set(selection.units.map(unit => unit.unit_id));
  return { ...selection, units, delta: { contract_version: "context-delta.v1", mode: "differential",
    reason: "fresh_mandatory_closure_and_changed_optional_units", baseline_revision: baseline.source_revision,
    source_revision: selection.source_revision, unchanged_optional_refs: unchanged,
    removed_unit_ids: [...previous.keys()].filter(id => !current.has(id)), write_authorization: false } };
}
