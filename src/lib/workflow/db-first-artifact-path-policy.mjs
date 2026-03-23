const DB_FIRST_PRESERVED_PATHS = new Set([
  "CURRENT-STATE.md",
  "RUNTIME-STATE.md",
  "INTEGRATION-RISK.md",
  "HANDOFF-PACKET.md",
  "AGENT-ROSTER.md",
  "AGENT-ADAPTERS.md",
  "AGENT-HEALTH-SUMMARY.md",
  "AGENT-SELECTION-SUMMARY.md",
  "MULTI-AGENT-STATUS.md",
  "COORDINATION-SUMMARY.md",
  "COORDINATION-LOG.md",
  "USER-ARBITRATION.md",
]);

export function normalizeDbFirstArtifactPath(relativePath) {
  return String(relativePath ?? "").replace(/\\/g, "/").replace(/^docs\/audit\//, "");
}

export function shouldPreserveDbFirstArtifactPath(relativePath) {
  const rel = normalizeDbFirstArtifactPath(relativePath);
  if (!rel) {
    return false;
  }
  if (DB_FIRST_PRESERVED_PATHS.has(rel)) {
    return true;
  }
  return /^backlog\/BL-S[0-9]+.*\.md$/i.test(rel);
}
