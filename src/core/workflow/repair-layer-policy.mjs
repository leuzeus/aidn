function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

export function normalizeRepairConfidence(value, fallback = 0) {
  return clamp01(value, fallback);
}

export function repairSourceModeRank(mode) {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (normalized === "explicit") return 4;
  if (normalized === "inferred") return 3;
  if (normalized === "legacy_repaired") return 2;
  if (normalized === "ambiguous") return 1;
  return 0;
}

export function isRepairRelationUsable(row, options = {}) {
  const minConfidence = clamp01(options.minConfidence, 0.65);
  const allowAmbiguous = options.allowAmbiguous === true;
  const sourceMode = String(row?.source_mode ?? "explicit").trim().toLowerCase();
  const confidence = normalizeRepairConfidence(row?.confidence, 1);
  if (!allowAmbiguous && sourceMode === "ambiguous") {
    return false;
  }
  return confidence >= minConfidence;
}

export function artifactRepairScore(artifact) {
  const confidence = normalizeRepairConfidence(artifact?.entity_confidence, 1);
  const sourceRank = repairSourceModeRank(artifact?.source_mode);
  return Math.round((confidence * 10) + (sourceRank * 2));
}
