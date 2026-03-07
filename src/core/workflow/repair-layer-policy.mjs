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

const DEFAULT_RELATION_THRESHOLDS = Object.freeze({
  summarizes_cycle: 0.7,
  supports_cycle: 0.65,
  attached_cycle: 0.75,
  active_in_snapshot: 0.75,
  included_in_baseline: 0.7,
});

const DEFAULT_PROMOTION_THRESHOLDS = Object.freeze({
  summarizes_cycle: 0.85,
  supports_cycle: 0.9,
  attached_cycle: 0.85,
  active_in_snapshot: 0.8,
  included_in_baseline: 0.75,
});

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
  const relationType = String(row?.relation_type ?? "").trim();
  const minConfidence = getRepairRelationMinConfidence(relationType, options);
  const allowAmbiguous = options.allowAmbiguous === true;
  const sourceMode = String(row?.source_mode ?? "explicit").trim().toLowerCase();
  const confidence = normalizeRepairConfidence(row?.confidence, 1);
  if (!allowAmbiguous && sourceMode === "ambiguous") {
    return false;
  }
  return confidence >= minConfidence;
}

export function getDefaultRepairRelationThresholds() {
  return { ...DEFAULT_RELATION_THRESHOLDS };
}

export function resolveRepairRelationThresholds(options = {}) {
  const resolved = getDefaultRepairRelationThresholds();
  const globalMin = options.minConfidence;
  if (Number.isFinite(Number(globalMin))) {
    const normalized = clamp01(globalMin, 0.65);
    for (const key of Object.keys(resolved)) {
      resolved[key] = normalized;
    }
  }
  const overrides = options.relationThresholds && typeof options.relationThresholds === "object"
    ? options.relationThresholds
    : {};
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof key !== "string" || key.trim().length === 0) {
      continue;
    }
    resolved[key.trim()] = clamp01(value, resolved[key.trim()] ?? 0.65);
  }
  return resolved;
}

export function getRepairRelationMinConfidence(relationType, options = {}) {
  const thresholds = resolveRepairRelationThresholds(options);
  if (relationType && Object.prototype.hasOwnProperty.call(thresholds, relationType)) {
    return thresholds[relationType];
  }
  return clamp01(options.minConfidence, 0.65);
}

export function getRepairPromotionThresholds() {
  return { ...DEFAULT_PROMOTION_THRESHOLDS };
}

export function getRepairRelationPromotionThreshold(relationType) {
  const thresholds = getRepairPromotionThresholds();
  if (relationType && Object.prototype.hasOwnProperty.call(thresholds, relationType)) {
    return thresholds[relationType];
  }
  return 1.1;
}

export function deriveRepairRelationStatus(row) {
  const sourceMode = String(row?.source_mode ?? "explicit").trim().toLowerCase();
  const confidence = normalizeRepairConfidence(row?.confidence, 1);
  const relationType = String(row?.relation_type ?? "").trim();
  if (sourceMode === "explicit") {
    return "explicit";
  }
  if (sourceMode === "ambiguous") {
    return "ambiguous";
  }
  const promotionThreshold = getRepairRelationPromotionThreshold(relationType);
  if (confidence >= promotionThreshold) {
    return "promoted";
  }
  return "inferred";
}

export function evaluateRepairRelation(row, options = {}) {
  const sourceMode = String(row?.source_mode ?? "explicit").trim().toLowerCase();
  const confidence = normalizeRepairConfidence(row?.confidence, 1);
  const relationType = String(row?.relation_type ?? "").trim();
  const minConfidence = getRepairRelationMinConfidence(relationType, options);
  const allowAmbiguous = options.allowAmbiguous === true;
  const relationStatus = String(row?.relation_status ?? deriveRepairRelationStatus(row));
  const ambiguityStatus = String(row?.ambiguity_status ?? "").trim().toLowerCase() || null;
  if (ambiguityStatus === "rejected") {
    return {
      usable: false,
      reason: "ambiguity_rejected",
      confidence,
      min_confidence: minConfidence,
      relation_type: relationType,
      source_mode: sourceMode,
      relation_status: relationStatus,
      ambiguity_status: ambiguityStatus,
    };
  }
  if (ambiguityStatus === "accepted") {
    return {
      usable: true,
      reason: "accepted_override",
      confidence,
      min_confidence: minConfidence,
      relation_type: relationType,
      source_mode: sourceMode,
      relation_status: relationStatus,
      ambiguity_status: ambiguityStatus,
    };
  }
  if (!allowAmbiguous && sourceMode === "ambiguous") {
    return {
      usable: false,
      reason: "ambiguous_disabled",
      confidence,
      min_confidence: minConfidence,
      relation_type: relationType,
      source_mode: sourceMode,
      relation_status: relationStatus,
      ambiguity_status: ambiguityStatus,
    };
  }
  if (confidence < minConfidence) {
    return {
      usable: false,
      reason: "below_confidence_threshold",
      confidence,
      min_confidence: minConfidence,
      relation_type: relationType,
      source_mode: sourceMode,
      relation_status: relationStatus,
      ambiguity_status: ambiguityStatus,
    };
  }
  return {
    usable: true,
    reason: "accepted",
    confidence,
    min_confidence: minConfidence,
    relation_type: relationType,
    source_mode: sourceMode,
    relation_status: relationStatus,
    ambiguity_status: ambiguityStatus,
  };
}

export function artifactRepairScore(artifact) {
  const confidence = normalizeRepairConfidence(artifact?.entity_confidence, 1);
  const sourceRank = repairSourceModeRank(artifact?.source_mode);
  return Math.round((confidence * 10) + (sourceRank * 2));
}
