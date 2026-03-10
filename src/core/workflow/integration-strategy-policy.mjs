export const INTEGRATION_OVERLAP_LEVELS = ["none", "low", "medium", "high", "unknown"];
export const INTEGRATION_SEMANTIC_RISK_LEVELS = ["low", "medium", "high", "unknown"];
export const INTEGRATION_READINESS_LEVELS = ["ready", "conditional", "blocked", "unknown"];
export const INTEGRATION_MERGEABILITY_LEVELS = ["merge_safe", "merge_risky", "merge_not_recommended", "insufficient_context"];
export const INTEGRATION_STRATEGIES = [
  "direct_merge",
  "integration_cycle",
  "report_forward",
  "rework_from_example",
  "user_arbitration_required",
];

const KNOWN_CYCLE_TYPES = new Set([
  "feature",
  "hotfix",
  "spike",
  "refactor",
  "structural",
  "migration",
  "security",
  "perf",
  "integration",
  "compat",
  "corrective",
]);

const OVERLAP_RANK = new Map(INTEGRATION_OVERLAP_LEVELS.map((value, index) => [value, index]));
const RISK_RANK = new Map(INTEGRATION_SEMANTIC_RISK_LEVELS.map((value, index) => [value, index]));
const READINESS_RANK = new Map([["unknown", 0], ["blocked", 1], ["conditional", 2], ["ready", 3]]);

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function maxByRank(values, rankMap, fallback) {
  let best = fallback;
  let bestRank = rankMap.get(fallback) ?? -1;
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    const rank = rankMap.get(normalized);
    if (typeof rank !== "number") {
      continue;
    }
    if (rank > bestRank) {
      best = normalized;
      bestRank = rank;
    }
  }
  return best;
}

function minReadiness(values) {
  let best = "ready";
  let bestRank = READINESS_RANK.get(best);
  for (const value of values) {
    const normalized = normalizeIntegrationReadiness(value);
    const rank = READINESS_RANK.get(normalized) ?? 0;
    if (rank < bestRank) {
      best = normalized;
      bestRank = rank;
    }
  }
  return best;
}

function sortedPair(left, right) {
  return [String(left ?? "").trim().toLowerCase(), String(right ?? "").trim().toLowerCase()].sort((a, b) => a.localeCompare(b));
}

export function normalizeCycleType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return KNOWN_CYCLE_TYPES.has(normalized) ? normalized : "unknown";
}

export function normalizeIntegrationOverlap(value) {
  return normalizeEnum(value, INTEGRATION_OVERLAP_LEVELS, "unknown");
}

export function normalizeSemanticRisk(value) {
  return normalizeEnum(value, INTEGRATION_SEMANTIC_RISK_LEVELS, "unknown");
}

export function normalizeIntegrationReadiness(value) {
  return normalizeEnum(value, INTEGRATION_READINESS_LEVELS, "unknown");
}

export function classifyCyclePairSemanticRisk(leftType, rightType) {
  const [a, b] = sortedPair(normalizeCycleType(leftType), normalizeCycleType(rightType));
  if (a === "unknown" || b === "unknown") {
    return {
      semantic_risk: "unknown",
      reason: "one cycle type is unknown",
      pair_types: [a, b],
    };
  }
  if (a === "spike" || b === "spike") {
    return {
      semantic_risk: "high",
      reason: "spike output should not be merged mechanically into production work",
      pair_types: [a, b],
    };
  }
  if ((a === "feature" && b === "refactor") || (a === "feature" && b === "migration") || (a === "feature" && b === "security") || (a === "compat" && b === "feature") || (a === "feature" && b === "structural") || (a === "feature" && b === "perf")) {
    return {
      semantic_risk: "medium",
      reason: `${a}+${b} needs explicit integration sequencing`,
      pair_types: [a, b],
    };
  }
  if ((a === "hotfix" && (b === "migration" || b === "refactor" || b === "security")) || (a === "migration" && b === "security")) {
    return {
      semantic_risk: "high",
      reason: `${a}+${b} carries high semantic and sequencing risk`,
      pair_types: [a, b],
    };
  }
  if (a === "integration" || b === "integration") {
    return {
      semantic_risk: "medium",
      reason: "integration cycles are assembly vehicles and should not be treated as trivial merge sources",
      pair_types: [a, b],
    };
  }
  if (a === b && (a === "feature" || a === "corrective" || a === "hotfix")) {
    return {
      semantic_risk: "low",
      reason: `${a}+${b} is usually compatible when overlap stays low`,
      pair_types: [a, b],
    };
  }
  return {
    semantic_risk: "low",
    reason: `${a}+${b} has no built-in semantic escalation rule`,
    pair_types: [a, b],
  };
}

export function classifyOverallSemanticRisk(cycleTypes) {
  const normalized = Array.from(new Set((cycleTypes ?? []).map((value) => normalizeCycleType(value)).filter(Boolean)));
  if (normalized.length <= 1) {
    return {
      semantic_risk: normalized.includes("unknown") ? "unknown" : "low",
      reasons: normalized.includes("unknown") ? ["cycle type is unknown"] : ["single cycle type set"],
      pair_assessments: [],
    };
  }
  const pairAssessments = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      pairAssessments.push(classifyCyclePairSemanticRisk(normalized[leftIndex], normalized[rightIndex]));
    }
  }
  const semanticRisk = maxByRank(pairAssessments.map((item) => item.semantic_risk), RISK_RANK, "low");
  const reasons = pairAssessments
    .filter((item) => item.semantic_risk === semanticRisk)
    .map((item) => item.reason);
  return {
    semantic_risk: semanticRisk,
    reasons: reasons.length > 0 ? Array.from(new Set(reasons)) : ["no semantic risk rule matched"],
    pair_assessments: pairAssessments,
  };
}

export function deriveIntegrationStrategy({
  cycleTypes = [],
  overlapLevel = "unknown",
  semanticRisk = "unknown",
  readiness = "unknown",
  candidateCount = 0,
  missingContext = false,
} = {}) {
  const normalizedTypes = Array.from(new Set((cycleTypes ?? []).map((value) => normalizeCycleType(value)).filter(Boolean)));
  const overlap = normalizeIntegrationOverlap(overlapLevel);
  const risk = normalizeSemanticRisk(semanticRisk);
  const readinessState = normalizeIntegrationReadiness(readiness);
  const reasons = [];

  if (candidateCount <= 1) {
    reasons.push("single cycle candidate does not require inter-cycle collision handling");
    return {
      mergeability: readinessState === "ready" ? "merge_safe" : "merge_risky",
      recommended_strategy: "direct_merge",
      arbitration_required: false,
      reasons,
    };
  }
  if (missingContext || normalizedTypes.includes("unknown")) {
    reasons.push("integration context is incomplete or contains unknown cycle types");
    return {
      mergeability: "insufficient_context",
      recommended_strategy: "user_arbitration_required",
      arbitration_required: true,
      reasons,
    };
  }
  if (normalizedTypes.includes("spike")) {
    reasons.push("spike output should be replayed intentionally instead of merged mechanically");
    return {
      mergeability: "merge_not_recommended",
      recommended_strategy: "rework_from_example",
      arbitration_required: false,
      reasons,
    };
  }
  if (readinessState === "blocked") {
    reasons.push("at least one candidate cycle is not integration-ready");
    return {
      mergeability: "merge_not_recommended",
      recommended_strategy: "report_forward",
      arbitration_required: false,
      reasons,
    };
  }
  if (risk === "high") {
    reasons.push("semantic risk is high for the candidate cycle set");
    return {
      mergeability: overlap === "unknown" ? "insufficient_context" : "merge_not_recommended",
      recommended_strategy: overlap === "unknown" ? "user_arbitration_required" : "rework_from_example",
      arbitration_required: overlap === "unknown",
      reasons,
    };
  }
  const typeSet = new Set(normalizedTypes);
  const requiresIntegrationVehicle = typeSet.has("integration")
    || (typeSet.has("feature") && (typeSet.has("refactor") || typeSet.has("migration") || typeSet.has("security") || typeSet.has("compat") || typeSet.has("structural") || typeSet.has("perf")))
    || (typeSet.has("hotfix") && (typeSet.has("migration") || typeSet.has("refactor") || typeSet.has("security")));
  if (requiresIntegrationVehicle) {
    reasons.push("cycle type combination requires an explicit integration vehicle");
    return {
      mergeability: "merge_risky",
      recommended_strategy: "integration_cycle",
      arbitration_required: false,
      reasons,
    };
  }
  if (overlap === "high" || overlap === "medium" || readinessState === "conditional") {
    reasons.push("technical overlap or conditional readiness requires a dedicated integration pass");
    return {
      mergeability: "merge_risky",
      recommended_strategy: "integration_cycle",
      arbitration_required: false,
      reasons,
    };
  }
  if (overlap === "unknown" || risk === "unknown" || readinessState === "unknown") {
    reasons.push("integration assessment lacks enough signal to recommend a mechanical merge");
    return {
      mergeability: "insufficient_context",
      recommended_strategy: "user_arbitration_required",
      arbitration_required: true,
      reasons,
    };
  }
  reasons.push("cycle types are compatible and overlap is low enough for a normal merge path");
  return {
    mergeability: "merge_safe",
    recommended_strategy: "direct_merge",
    arbitration_required: false,
    reasons,
  };
}

export function classifyOverallReadiness(values) {
  const normalized = (values ?? []).map((value) => normalizeIntegrationReadiness(value));
  if (normalized.length === 0) {
    return "unknown";
  }
  return minReadiness(normalized);
}

export function classifyOverallOverlap(values) {
  const normalized = (values ?? []).map((value) => normalizeIntegrationOverlap(value));
  if (normalized.length === 0) {
    return "unknown";
  }
  return maxByRank(normalized, OVERLAP_RANK, "none");
}
