export const GOVERNANCE_LANE = Object.freeze({
  EXPLORE: "EXPLORE",
  FAST: "FAST",
  STANDARD: "STANDARD",
  ASSURED: "ASSURED",
});

export const GOVERNANCE_OVERLAY = Object.freeze({
  EMERGENCY: "EMERGENCY",
});

const LANE_ORDER = Object.freeze({
  [GOVERNANCE_LANE.EXPLORE]: 0,
  [GOVERNANCE_LANE.FAST]: 1,
  [GOVERNANCE_LANE.STANDARD]: 2,
  [GOVERNANCE_LANE.ASSURED]: 3,
});

const INVARIANT_GATES = Object.freeze([
  "AIDN-GOV-SECRET-SAFETY",
  "AIDN-GOV-PROVENANCE",
  "AIDN-GOV-NO-IMPLICIT-WRITE",
  "AIDN-GOV-EVIDENCE-INTEGRITY",
  "AIDN-GOV-ROLLBACK",
]);

const LANE_GATES = Object.freeze({
  [GOVERNANCE_LANE.EXPLORE]: [
    ...INVARIANT_GATES,
    "AIDN-GOV-READ-ONLY-BOUNDARY",
  ],
  [GOVERNANCE_LANE.FAST]: [
    ...INVARIANT_GATES,
    "AIDN-GOV-BRANCH-OWNERSHIP",
    "AIDN-GOV-TARGETED-VALIDATION",
  ],
  [GOVERNANCE_LANE.STANDARD]: [
    ...INVARIANT_GATES,
    "AIDN-GOV-BRANCH-OWNERSHIP",
    "AIDN-GOV-WORKFLOW-CONTINUITY",
    "AIDN-GOV-TARGETED-VALIDATION",
    "AIDN-GOV-REVIEW-DELIVERY",
  ],
  [GOVERNANCE_LANE.ASSURED]: [
    ...INVARIANT_GATES,
    "AIDN-GOV-BRANCH-OWNERSHIP",
    "AIDN-GOV-WORKFLOW-CONTINUITY",
    "AIDN-GOV-TARGETED-VALIDATION",
    "AIDN-GOV-STATE-AUTHORITY",
    "AIDN-GOV-BACKUP",
    "AIDN-GOV-COMPATIBILITY",
    "AIDN-GOV-ROLLBACK",
    "AIDN-GOV-FULL-VALIDATION",
    "AIDN-GOV-REVIEW-DELIVERY",
  ],
});

const ALL_ROUTABLE_GATES = Object.freeze(Array.from(new Set(Object.values(LANE_GATES).flat())));
const FAST_FORBIDDEN_PATH = /(^|\/)(migrations?|schema|security|auth|contracts?|api|shared|codegen)(\/|$)/i;

function normalizeLane(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return Object.hasOwn(LANE_ORDER, normalized) ? normalized : null;
}

function normalizePaths(values) {
  return Array.isArray(values)
    ? values.map((item) => String(item ?? "").trim().replace(/\\/g, "/")).filter(Boolean)
    : [];
}

function configuredLaneGates(lanePolicy, lane, field) {
  const laneConfig = lanePolicy && typeof lanePolicy === "object" ? lanePolicy[lane] : null;
  const values = laneConfig && typeof laneConfig === "object" ? laneConfig[field] : null;
  return Array.isArray(values)
    ? values.map((item) => String(item ?? "").trim().toUpperCase()).filter(Boolean)
    : [];
}

export function branchRoleFromKind(branchKind) {
  switch (String(branchKind ?? "").trim().toLowerCase()) {
    case "source":
      return "source";
    case "session":
    case "cycle":
    case "intermediate":
      return "work";
    case "other":
      return "unmanaged";
    default:
      return "unknown";
  }
}

export function isFastLaneEligible({
  changedPaths = [],
  maxTouchedFiles = 2,
  authorityImpact = false,
  persistenceImpact = false,
  structuralImpact = false,
  securityImpact = false,
  continuityAmbiguous = false,
} = {}) {
  const paths = normalizePaths(changedPaths);
  const limit = Number.isInteger(maxTouchedFiles) && maxTouchedFiles > 0 ? maxTouchedFiles : 2;
  return paths.length > 0
    && paths.length <= limit
    && !paths.some((item) => FAST_FORBIDDEN_PATH.test(item))
    && !authorityImpact
    && !persistenceImpact
    && !structuralImpact
    && !securityImpact
    && !continuityAmbiguous;
}

export function evaluateAdaptiveAdmission({
  mode = "UNKNOWN",
  branchKind = "unknown",
  requestedLane = null,
  defaultLane = GOVERNANCE_LANE.STANDARD,
  changedPaths = [],
  maxTouchedFiles = 2,
  authorityImpact = false,
  persistenceImpact = false,
  structuralImpact = false,
  securityImpact = false,
  continuityAmbiguous = false,
  emergency = false,
  stateSource = "unknown",
  projectionFreshness = "unknown",
  lanePolicy = null,
} = {}) {
  const normalizedMode = String(mode ?? "UNKNOWN").trim().toUpperCase();
  const fastEligible = isFastLaneEligible({
    changedPaths,
    maxTouchedFiles,
    authorityImpact,
    persistenceImpact,
    structuralImpact,
    securityImpact,
    continuityAmbiguous,
  });
  const assuredRequired = authorityImpact || persistenceImpact || structuralImpact || securityImpact;
  let lane = normalizeLane(requestedLane);
  let laneReason = lane ? "requested" : "default";

  if (!lane) {
    if (assuredRequired) {
      lane = GOVERNANCE_LANE.ASSURED;
      laneReason = "risk-escalation";
    } else if (["THINKING", "EXPLORING"].includes(normalizedMode)) {
      lane = GOVERNANCE_LANE.EXPLORE;
      laneReason = "read-only-mode";
    } else if (normalizedMode === "COMMITTING" && fastEligible) {
      lane = GOVERNANCE_LANE.FAST;
      laneReason = "bounded-reversible-change";
    } else {
      lane = normalizeLane(defaultLane) ?? GOVERNANCE_LANE.STANDARD;
      laneReason = "conservative-default";
    }
  }

  if (assuredRequired && LANE_ORDER[lane] < LANE_ORDER[GOVERNANCE_LANE.ASSURED]) {
    lane = GOVERNANCE_LANE.ASSURED;
    laneReason = "risk-escalation";
  } else if (lane === GOVERNANCE_LANE.FAST && !fastEligible) {
    lane = GOVERNANCE_LANE.STANDARD;
    laneReason = "fast-boundary-exceeded";
  }

  const requiredGates = Array.from(new Set([
    ...LANE_GATES[lane],
    ...configuredLaneGates(lanePolicy, lane, "requiredGates"),
  ]));
  const deferredGates = Array.from(new Set([
    ...ALL_ROUTABLE_GATES,
    ...configuredLaneGates(lanePolicy, lane, "deferredGates"),
  ])).filter((gate) => !requiredGates.includes(gate));
  const branchRole = branchRoleFromKind(branchKind);
  const sourceDirectWrites = false;
  const workBranchRequired = branchRole === "source";

  return {
    lane,
    lane_reason: laneReason,
    overlay: emergency ? GOVERNANCE_OVERLAY.EMERGENCY : null,
    required_gates: requiredGates,
    deferred_gates: deferredGates,
    state_source: String(stateSource ?? "unknown") || "unknown",
    projection_freshness: String(projectionFreshness ?? "unknown") || "unknown",
    branch_role: branchRole,
    source_direct_writes: sourceDirectWrites,
    work_branch_required: workBranchRequired,
    fast_eligible: fastEligible,
    invariants_non_bypassable: [...INVARIANT_GATES],
  };
}
