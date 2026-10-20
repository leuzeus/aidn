import path from "node:path";
import { createRuntimeCanonicalSnapshotReader } from "./runtime-persistence-service.mjs";
import { findUniqueAuditArtifact, resolveRuntimeHeadArtifact } from "./runtime-head-resolution-service.mjs";
import { parseSessionMetadata, parseSimpleMap } from "../../lib/workflow/session-context-lib.mjs";

const relative = value => String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^docs\/audit\//i, "");
const decode = artifact => artifact?.content_format === "base64"
  ? Buffer.from(artifact.content, "base64").toString("utf8") : artifact?.content ?? "";

// One snapshot supplies heads, lifecycle, ownership and close decisions. Never
// combine canonical rows with a visible Markdown projection during admission.
export async function readCanonicalCloseSessionContext({ targetRoot, auditRoot, persistenceOptions = {} }) {
  const snapshot = await createRuntimeCanonicalSnapshotReader({ ...persistenceOptions, targetRoot })
    .readCanonicalSnapshot({ includePayload: true, includeRuntimeHeads: true });
  if (!snapshot?.exists || !snapshot.payload || snapshot.warning) throw new Error("CLOSE_SESSION_CANONICAL_UNAVAILABLE");
  const { payload } = snapshot;
  const current = resolveRuntimeHeadArtifact(snapshot.runtimeHeads, "current_state", payload)
    ?? findUniqueAuditArtifact(payload, "CURRENT-STATE.md");
  const text = decode(current);
  if (!text.trim()) throw new Error("CLOSE_SESSION_CURRENT_STATE_MISSING");
  const map = parseSimpleMap(text);
  const result = { currentState: { active_session: map.get("active_session") ?? "none",
    active_cycle: map.get("active_cycle") ?? "none" }, sessions: [], cycles: [] };
  for (const [table, idKey, pattern] of [
    ["sessions", "session_id", /^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/i],
    ["cycles", "cycle_id", /^cycles\/(C\d+)[^/]*\/status\.md$/i],
  ]) {
    const seen = new Set();
    for (const row of payload[table] ?? []) {
      const id = String(row[idKey]).toUpperCase();
      if (seen.has(id)) throw new Error("CLOSE_SESSION_ENTITY_AMBIGUOUS");
      seen.add(id);
      const candidates = (payload.artifacts ?? []).filter(a => relative(a.path).match(pattern)?.[1]?.toUpperCase() === id);
      // Relational projection also records referenced historical parents without
      // an artifact. Such placeholders cannot be selected as closure targets.
      if (table === "sessions" && candidates.length === 0 && row.source_mode === "inferred"
          && !row.branch_name && !row.state && !row.ended_at) continue;
      if (candidates.length !== 1) throw new Error(`CLOSE_SESSION_ARTIFACT_MISSING_OR_AMBIGUOUS: ${table} ${id} (${candidates.length})`);
      const artifact = candidates[0];
      const canonicalText = decode(artifact);
      if (!canonicalText.trim()) throw new Error("CLOSE_SESSION_ARTIFACT_EMPTY");
      const fields = parseSimpleMap(canonicalText);
      const metadata = table === "sessions" ? parseSessionMetadata(canonicalText) : null;
      const branch = metadata?.session_branch ?? fields.get("branch_name");
      if ((artifact[idKey] && String(artifact[idKey]).toUpperCase() !== id)
          || (fields.get(idKey) && String(fields.get(idKey)).toUpperCase() !== id)
          || (row.source_artifact_path && relative(row.source_artifact_path) !== relative(artifact.path))
          || !branch || branch !== row.branch_name
          || (table === "cycles" && (String(fields.get("state")).toUpperCase() !== String(row.state).toUpperCase()
            || (row.session_id && fields.get("session_owner") !== row.session_id)))) {
        throw new Error("CLOSE_SESSION_ARTIFACT_IDENTITY_MISMATCH");
      }
      result[table].push({ ...row, file_path: path.join(auditRoot, relative(artifact.path)),
        canonical_text: canonicalText, ...(metadata ? { metadata } : { session_owner: fields.get("session_owner") }),
        state: fields.get("state") ?? row.state });
    }
  }
  return result;
}
