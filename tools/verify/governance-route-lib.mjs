import path from "node:path";

const ROUTE_CONTRACT = "governance-route.v1";

function normalizePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}

function escapeRegex(token) {
  return token.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

export function globToRegex(pattern) {
  const normalized = normalizePath(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const token = normalized[index];
    if (token === "*" && normalized[index + 1] === "*") {
      const followedBySlash = normalized[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (token === "*") {
      source += "[^/]*";
    } else if (token === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(token);
    }
  }
  return new RegExp(`${source}$`, "u");
}

export function matchesAnyPattern(relativePath, patterns = []) {
  const normalized = normalizePath(relativePath);
  return patterns.some((pattern) => globToRegex(pattern).test(normalized));
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeChange(change) {
  if (typeof change === "string") {
    return { status: "M", path: normalizePath(change), previous_path: null };
  }
  return {
    status: String(change?.status ?? "M").trim() || "M",
    path: normalizePath(change?.path),
    previous_path: change?.previous_path ? normalizePath(change.previous_path) : null,
  };
}

function classificationPaths(changes) {
  return unique(changes.flatMap((change) => [change.path, change.previous_path].filter(Boolean)));
}

function publicSurfacePaths(entry) {
  return unique([
    entry.source,
    entry.implementation,
    entry.docs,
    entry.proof?.target,
    entry.proof?.gate,
    /[/.]/u.test(String(entry.entrypoint ?? "")) ? entry.entrypoint : "",
  ].map(normalizePath).filter(Boolean));
}

function publicSurfaceMatches(relativePath, surfaceCatalog) {
  const normalized = normalizePath(relativePath);
  return (surfaceCatalog?.entries ?? [])
    .filter((entry) => entry.status === "active" && entry.visibility === "public")
    .filter((entry) => publicSurfacePaths(entry).some((candidate) => (
      normalized === candidate || normalized.startsWith(`${candidate}/`)
    )))
    .map((entry) => entry.id);
}

function classifyPath(relativePath, policy, surfaceCatalog, historicalPatterns) {
  const families = Object.entries(policy.family_patterns ?? {})
    .filter(([, patterns]) => matchesAnyPattern(relativePath, patterns))
    .map(([family]) => family);
  const historical = matchesAnyPattern(relativePath, historicalPatterns);
  const assuredPattern = matchesAnyPattern(relativePath, policy.assured_patterns);
  const publicSurfaceIds = publicSurfaceMatches(relativePath, surfaceCatalog);
  const assured = assuredPattern || publicSurfaceIds.length > 0;
  return {
    path: normalizePath(relativePath),
    historical,
    known: historical || families.length > 0,
    assured,
    assured_by: [
      ...(assuredPattern ? ["assured-path-policy"] : []),
      ...publicSurfaceIds.map((id) => `public-surface:${id}`),
    ],
    families,
    performance_relevant: matchesAnyPattern(relativePath, policy.performance_patterns),
  };
}

function orderedFamilies(values, requiredFamilies) {
  const requested = new Set(values);
  return requiredFamilies.filter((family) => requested.has(family));
}

function laneRank(policy, lane) {
  return policy.lane_order.indexOf(lane);
}

function routeGateSelection(catalog, families, context) {
  const selectedFamilySet = new Set(families);
  const gates = (catalog.gates ?? [])
    .filter((gate) => selectedFamilySet.has(gate.family))
    .map((gate) => ({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      obligation: gate.obligation?.[context] ?? "required",
    }));
  return {
    context,
    families,
    all: gates,
    required: gates.filter((gate) => gate.obligation === "required").map((gate) => gate.id),
    optional: gates.filter((gate) => gate.obligation === "optional").map((gate) => gate.id),
    skipped: gates.filter((gate) => gate.obligation === "skip").map((gate) => gate.id),
  };
}

export function validateGovernanceRoutePolicy(catalog) {
  const issues = [];
  const policy = catalog?.governance_route_policy;
  if (!policy || typeof policy !== "object") {
    return ["governance_route_policy is required"];
  }
  if (policy.schema_version !== 1 || policy.contract !== ROUTE_CONTRACT) {
    issues.push("governance_route_policy must declare governance-route.v1 schema version 1");
  }
  if (JSON.stringify(policy.lane_order) !== JSON.stringify([
    "EXPLORE",
    "FAST",
    "STANDARD",
    "ASSURED",
  ])) {
    issues.push("governance route lane order must be EXPLORE, FAST, STANDARD, ASSURED");
  }
  const knownFamilies = new Set(catalog.required_families ?? []);
  for (const [field, families] of Object.entries({
    fast_families: policy.fast_families,
    standard_invariant_families: policy.standard_invariant_families,
    standard_fallback_families: policy.standard_fallback_families,
  })) {
    if (!Array.isArray(families) || families.length === 0) {
      issues.push(`${field} must be a non-empty family list`);
      continue;
    }
    for (const family of families) {
      if (!knownFamilies.has(family)) {
        issues.push(`${field} references unknown family ${family}`);
      }
    }
  }
  if (JSON.stringify(policy.fast_families) !== JSON.stringify([
    "cleanliness",
    "docs",
    "security",
  ])) {
    issues.push("FAST must select exactly cleanliness, docs, and security");
  }
  if (JSON.stringify(policy.standard_invariant_families) !== JSON.stringify([
    "cleanliness",
    "security",
  ])) {
    issues.push("STANDARD invariant families must be exactly cleanliness and security");
  }
  const expectedFallback = (catalog.required_families ?? []).filter((family) => family !== "release");
  if (JSON.stringify(policy.standard_fallback_families) !== JSON.stringify(expectedFallback)) {
    issues.push("STANDARD unknown-path fallback must select every non-release family");
  }
  for (const family of Object.keys(policy.family_patterns ?? {})) {
    if (!knownFamilies.has(family)) {
      issues.push(`family_patterns references unknown family ${family}`);
    }
  }
  if (!Array.isArray(policy.assured_patterns) || policy.assured_patterns.length === 0) {
    issues.push("assured_patterns must be non-empty");
  }
  try {
    new RegExp(policy.emergency?.head_pattern ?? "", "u");
  } catch (error) {
    issues.push(`emergency head_pattern is invalid: ${error.message}`);
  }
  if (policy.emergency?.gate_lane !== "ASSURED"
    || policy.emergency?.base_branch !== "main") {
    issues.push("emergency overlay must preserve ASSURED gates and target main");
  }
  return issues;
}

export function resolveGovernanceRoute({
  catalog,
  surfaceCatalog = { entries: [] },
  changes = [],
  baseBranch = "dev",
  headBranch = "",
  baseRef = "",
  headRef = "",
  baseSha = null,
  headSha = null,
  mergeBaseSha = null,
  diffResolved = true,
  draft = false,
  requestedLane = "",
  projectVersion = "",
} = {}) {
  const policyIssues = validateGovernanceRoutePolicy(catalog);
  if (policyIssues.length > 0) {
    throw new Error(policyIssues.join("; "));
  }
  const policy = catalog.governance_route_policy;
  const normalizedChanges = changes.map(normalizeChange);
  const paths = classificationPaths(normalizedChanges);
  const historicalPatterns = catalog.documentation_policy?.historical_patterns ?? [];
  const pathClassifications = paths.map((relativePath) => (
    classifyPath(relativePath, policy, surfaceCatalog, historicalPatterns)
  ));
  const reasons = [];
  const escalations = [];
  const issues = [];
  const normalizedRequestedLane = String(requestedLane ?? "").trim().toUpperCase();
  const supportedRequestedLanes = policy.lane_order.filter((lane) => lane !== "EXPLORE");
  const protectedDirectSource = policy.protected_branches.includes(headBranch)
    && headBranch === baseBranch;
  if (protectedDirectSource) {
    issues.push("DIRECT_PROTECTED_BRANCH");
  }

  const emergencyPattern = new RegExp(policy.emergency.head_pattern, "u");
  const emergency = baseBranch === policy.emergency.base_branch
    && emergencyPattern.test(headBranch)
    && (!projectVersion || headBranch === `hotfix/v${projectVersion}`);
  let derivedLane = "STANDARD";
  if (!diffResolved) {
    derivedLane = "ASSURED";
    reasons.push("UNRESOLVED_PROVENANCE_ASSURED");
    escalations.push("diff-or-provenance-unresolved");
  } else if (baseBranch === "main") {
    derivedLane = "ASSURED";
    reasons.push("MAIN_TARGET_ASSURED");
  } else if (pathClassifications.some((item) => item.assured)) {
    derivedLane = "ASSURED";
    reasons.push("CRITICAL_OR_PUBLIC_SURFACE_ASSURED");
    escalations.push(...pathClassifications.flatMap((item) => item.assured_by));
  } else if (paths.length > 0 && pathClassifications.every((item) => item.historical)) {
    derivedLane = "FAST";
    reasons.push("HISTORICAL_DOCUMENTATION_FAST");
  } else {
    reasons.push(paths.length === 0 ? "EMPTY_DIFF_STANDARD" : "PATH_ROUTED_STANDARD");
  }

  if (emergency) {
    derivedLane = "ASSURED";
    reasons.push("EMERGENCY_HOTFIX_OVERLAY");
    escalations.push("emergency-overlay");
  }
  const unknownPaths = pathClassifications.filter((item) => !item.known).map((item) => item.path);
  if (unknownPaths.length > 0 && derivedLane !== "ASSURED") {
    derivedLane = "STANDARD";
    reasons.push("UNKNOWN_PATH_STANDARD_FALLBACK");
    escalations.push(...unknownPaths.map((relativePath) => `unknown-path:${relativePath}`));
  }

  let lane = draft ? "EXPLORE" : derivedLane;
  if (draft) {
    reasons.push("DRAFT_EXPLORE_ONLY");
  }
  if (normalizedRequestedLane) {
    if (!supportedRequestedLanes.includes(normalizedRequestedLane)) {
      issues.push("INVALID_REQUESTED_LANE");
    } else if (laneRank(policy, normalizedRequestedLane) < laneRank(policy, derivedLane)) {
      issues.push("REQUESTED_LANE_DOWNGRADE_REJECTED");
    } else if (laneRank(policy, normalizedRequestedLane) > laneRank(policy, lane)) {
      lane = normalizedRequestedLane;
      reasons.push("EXPLICIT_LANE_ESCALATION");
      escalations.push(`requested-lane:${normalizedRequestedLane}`);
    }
  }

  let families = [];
  if (lane === "FAST") {
    families = policy.fast_families;
  } else if (lane === "STANDARD") {
    const pathFamilies = unique(pathClassifications.flatMap((item) => item.families));
    families = unknownPaths.length > 0
      ? policy.standard_fallback_families
      : [...policy.standard_invariant_families, ...pathFamilies];
  } else if (lane === "ASSURED") {
    families = catalog.required_families;
  }
  families = orderedFamilies(unique(families), catalog.required_families);
  const context = baseBranch === "main" ? "release" : "dev";
  const gateSelection = routeGateSelection(catalog, families, context);
  const routeOk = issues.length === 0;
  const finalState = !routeOk
    ? "REJECTED"
    : lane === "EXPLORE"
      ? "EXPLORE_ONLY"
      : !diffResolved
        ? "DEGRADED_ASSURED"
        : "ADMITTED";
  const deferredEvidence = emergency ? policy.emergency.deferred_evidence : [];
  const performanceRelevant = pathClassifications.some((item) => item.performance_relevant);

  return {
    contract: policy.contract,
    schema_version: policy.schema_version,
    ok: routeOk,
    status: routeOk ? "PASS" : "FAIL",
    final_state: finalState,
    lane,
    delivery_lane: derivedLane,
    emergency_overlay: emergency ? {
      active: true,
      expires: policy.emergency.expires,
      rollback: policy.emergency.rollback,
      regularization: policy.emergency.regularization,
    } : { active: false },
    requested_lane: normalizedRequestedLane || null,
    provenance: {
      base_branch: baseBranch,
      head_branch: headBranch,
      base_ref: baseRef || null,
      head_ref: headRef || null,
      base_sha: baseSha,
      head_sha: headSha,
      merge_base_sha: mergeBaseSha,
      diff_resolved: diffResolved,
    },
    changed_paths: normalizedChanges,
    path_classification: pathClassifications,
    reasons: unique(reasons),
    escalations: unique(escalations),
    issues: unique(issues),
    deferred_evidence: deferredEvidence,
    performance_relevant: performanceRelevant,
    gate_selection: gateSelection,
  };
}

export function parseGitNameStatusZ(value) {
  const tokens = String(value ?? "").split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) {
      continue;
    }
    if (/^[RC]/u.test(status)) {
      const previousPath = tokens[index++] ?? "";
      const nextPath = tokens[index++] ?? "";
      changes.push({ status, path: nextPath, previous_path: previousPath });
    } else {
      changes.push({ status, path: tokens[index++] ?? "", previous_path: null });
    }
  }
  return changes.filter((change) => change.path);
}

export function repoRelativePath(repoRoot, filePath) {
  return normalizePath(path.relative(repoRoot, filePath));
}

export { ROUTE_CONTRACT };
