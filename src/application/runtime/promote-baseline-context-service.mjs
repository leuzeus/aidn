import path from "node:path";
import { createHash } from "node:crypto";
import { createRuntimeCanonicalSnapshotReader } from "./runtime-persistence-service.mjs";
import { findUniqueAuditArtifact, resolveRuntimeHeadArtifact } from "./runtime-head-resolution-service.mjs";
import { parseSimpleMap } from "../../lib/workflow/session-context-lib.mjs";
const relative = value => String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/^docs\/audit\//i, "");
const fail = () => { throw Error("PROMOTE_BASELINE_CANONICAL_CONTEXT_INVALID"); };
function decode(row) {
  if (!row) return "";
  if (!["utf8", "base64"].includes(row.content_format) || typeof row.content !== "string") fail();
  const text = row.content_format === "base64" ? Buffer.from(row.content, "base64").toString("utf8") : row.content;
  if (!/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || createHash("sha256").update(text).digest("hex") !== row.sha256) fail();
  return text;
}
// Current focus, cycle identities and their validation evidence belong to one
// fresh canonical snapshot. Visible projections never complete missing data.
export async function readCanonicalBaselinePromotionContext({ targetRoot, auditRoot, persistenceOptions = {} }) {
  const snapshot = await createRuntimeCanonicalSnapshotReader({ ...persistenceOptions, targetRoot })
    .readCanonicalSnapshot({ includePayload: true, includeRuntimeHeads: true });
  if (!snapshot?.exists || !snapshot.payload || snapshot.warning) fail();
  const payload = snapshot.payload, current = resolveRuntimeHeadArtifact(snapshot.runtimeHeads, "current_state", payload)
    ?? findUniqueAuditArtifact(payload, "CURRENT-STATE.md"), currentText = decode(current);
  if (!currentText.trim()) fail();
  const fields = parseSimpleMap(currentText), statuses = (payload.artifacts ?? []).filter(row => /^cycles\/C[0-9]+[^/]*\/status\.md$/i.test(relative(row.path)));
  const cycles = [], seen = new Set();
  for (const row of payload.cycles ?? []) {
    const id = String(row.cycle_id).toUpperCase(); if (seen.has(id)) fail(); seen.add(id);
    const candidates = statuses.filter(a => /^cycles\/(C[0-9]+)[^/]*\/status\.md$/i.exec(relative(a.path))?.[1]?.toUpperCase() === id);
    if (candidates.length !== 1) fail();
    const artifact = candidates[0], text = decode(artifact), map = parseSimpleMap(text), name = relative(artifact.path), branch = map.get("branch_name");
    if (!text.trim() || !branch || branch !== row.branch_name || String(map.get("state")).toUpperCase() !== String(row.state).toUpperCase()
      || row.source_artifact_path && relative(row.source_artifact_path) !== name
      || artifact.cycle_id && String(artifact.cycle_id).toUpperCase() !== id
      || map.get("cycle_id") && String(map.get("cycle_id")).toUpperCase() !== id
      || row.session_id && map.get("session_owner") !== row.session_id) fail();
    const cyclePath = name.replace(/\/status\.md$/, "");
    cycles.push({ ...row, cycle_id: id, state: String(map.get("state")).toUpperCase(), cycle_dir: cyclePath.slice("cycles/".length), file_path: path.join(auditRoot, name), text,
      session_owner: map.get("session_owner"), dor_state: map.get("dor_state"), continuity_rule: map.get("continuity_rule"),
      usage_matrix_scope: map.get("usage_matrix_scope"), usage_matrix_state: map.get("usage_matrix_state"),
      usage_matrix_summary: map.get("usage_matrix_summary"), usage_matrix_rationale: map.get("usage_matrix_rationale"),
      traceability_text: decode(findUniqueAuditArtifact(payload, cyclePath + "/traceability.md")),
      gap_report_text: decode(findUniqueAuditArtifact(payload, cyclePath + "/gap-report.md")) });
  }
  if (statuses.length !== cycles.length) fail();
  const activeCycle = String(fields.get("active_cycle") ?? "none");
  if (!/^none$/i.test(activeCycle) && cycles.filter(row => row.cycle_id === activeCycle.toUpperCase()).length !== 1) fail();
  return { currentState: { active_session: fields.get("active_session") ?? "none", active_cycle: activeCycle }, cycles };
}
