export function buildIndexSyncCheckReasonCodes({
  currentExists,
  digestMatch,
  digestComparable,
  summaryMismatches,
  artifactMismatchCount,
}) {
  const codes = [];
  if (!currentExists) {
    codes.push("INDEX_FILE_MISSING");
  }
  if (digestComparable && !digestMatch) {
    codes.push("DIGEST_MISMATCH");
  }
  if (summaryMismatches.length > 0) {
    codes.push("SUMMARY_MISMATCH");
  }
  if (artifactMismatchCount > 0) {
    codes.push("ARTIFACT_MISMATCH");
  }
  return codes;
}

export function resolveIndexSyncDriftLevel(reasonCodes, totalMismatchCount) {
  if (reasonCodes.length === 0) {
    return "none";
  }
  if (reasonCodes.includes("INDEX_FILE_MISSING") || totalMismatchCount >= 3) {
    return "high";
  }
  return "low";
}
