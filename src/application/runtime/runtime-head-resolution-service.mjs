function exactPath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function auditRelative(value) {
  return exactPath(value).replace(/^\.\//, "").replace(/^docs\/audit\//i, "");
}

export function resolveRuntimeHeadArtifact(runtimeHeads, headKey, payload) {
  if (!headKey || !runtimeHeads || !Object.hasOwn(runtimeHeads, headKey)) return null;
  const head = runtimeHeads[headKey];
  if (!head || typeof head !== "object") throw new Error("RUNTIME_HEAD_INVALID");
  // SQLite already materializes the referenced artifact. PostgreSQL exposes a
  // metadata pointer: resolve it within this snapshot, never by normalized alias
  // or by choosing whichever historical artifact happens to be first/latest.
  if (head.path && !head.artifact_path) return head;
  if (!head.artifact_path || !head.artifact_sha256 || (head.head_key && head.head_key !== headKey)) {
    throw new Error("RUNTIME_HEAD_INVALID");
  }
  const candidates = (Array.isArray(payload?.artifacts) ? payload.artifacts : [])
    .filter(row => exactPath(row?.path) === exactPath(head.artifact_path));
  if (candidates.length !== 1) throw new Error("RUNTIME_HEAD_ARTIFACT_MISSING_OR_AMBIGUOUS");
  const artifact = candidates[0];
  if (String(artifact.sha256 ?? "") !== String(head.artifact_sha256)
      || (head.artifact_id != null && String(artifact.artifact_id) !== String(head.artifact_id))) {
    throw new Error("RUNTIME_HEAD_ARTIFACT_IDENTITY_MISMATCH");
  }
  return artifact;
}

export function findUniqueAuditArtifact(payload, artifactPath) {
  const normalized = auditRelative(artifactPath);
  if (!normalized || !Array.isArray(payload?.artifacts)) return null;
  const matches = payload.artifacts.filter(row => auditRelative(row?.path) === normalized);
  if (matches.length > 1) throw new Error("RUNTIME_ARTIFACT_PATH_AMBIGUOUS");
  return matches[0] ?? null;
}
