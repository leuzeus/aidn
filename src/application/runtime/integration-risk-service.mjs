import fs from "node:fs";
import path from "node:path";
import {
  classifyOverallOverlap,
  classifyOverallReadiness,
  classifyOverallSemanticRisk,
  deriveIntegrationStrategy,
  normalizeCycleType,
} from "../../core/workflow/integration-strategy-policy.mjs";
import {
  findCycleStatus,
  findSessionFile,
  parseSessionMetadata,
} from "../../lib/workflow/session-context-lib.mjs";

const ROOT_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "README.md",
]);

function normalizeScalar(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.startsWith("`") && normalized.endsWith("`") && normalized.length >= 2) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_ -]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(String(match[1]).trim().toLowerCase().replace(/\s+/g, "_"), normalizeScalar(match[2]));
  }
  return map;
}

function parseListField(text, fieldName) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const inlinePattern = new RegExp(`^[-*]?\\s*${fieldName}:\\s*(.*)$`, "i");
  let collecting = false;
  for (const line of lines) {
    const inlineMatch = line.match(inlinePattern);
    if (!collecting && inlineMatch) {
      const remainder = String(inlineMatch[1] ?? "").trim();
      if (remainder.length > 0) {
        items.push(...splitEntityList(remainder));
        break;
      }
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (/^##\s+/.test(line) || /^[-*]?\s*[a-zA-Z0-9_]+:\s*/.test(line)) {
      break;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    items.push(...splitEntityList(String(bulletMatch[1] ?? "").trim()));
  }
  return Array.from(new Set(items.map((item) => normalizeScalar(item)).filter(Boolean)));
}

function splitEntityList(value) {
  const normalized = String(value ?? "").replace(/[|]/g, " ").trim();
  if (!normalized || /^none$/i.test(normalized)) {
    return [];
  }
  return normalized
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractCycleIds(value) {
  return Array.from(new Set((String(value ?? "").match(/\bC\d+\b/gi) ?? []).map((item) => item.toUpperCase())));
}

function parseCurrentState(currentStatePath) {
  const text = fs.existsSync(currentStatePath) ? fs.readFileSync(currentStatePath, "utf8") : "";
  const map = parseSimpleMap(text);
  return {
    text,
    map,
    active_session: normalizeScalar(map.get("active_session") ?? "none") || "none",
    active_cycle: normalizeScalar(map.get("active_cycle") ?? "none") || "none",
    mode: normalizeScalar(map.get("mode") ?? "unknown") || "unknown",
  };
}

function parseSessionTopology(sessionText, activeCycle) {
  const metadata = parseSessionMetadata(sessionText);
  const attachedCycles = Array.isArray(metadata.attached_cycles) ? metadata.attached_cycles : [];
  const integrationTargetCycles = Array.isArray(metadata.integration_target_cycles)
    ? metadata.integration_target_cycles
    : [];
  const primaryFocusCycle = metadata.primary_focus_cycle ?? null;
  const candidateCycleIds = Array.from(new Set([
    ...attachedCycles,
    ...integrationTargetCycles,
    ...(primaryFocusCycle ? [primaryFocusCycle] : []),
    ...extractCycleIds(activeCycle ?? ""),
  ])).sort((a, b) => a.localeCompare(b));
  return {
    attached_cycles: attachedCycles,
    integration_target_cycles: integrationTargetCycles,
    primary_focus_cycle: primaryFocusCycle,
    candidate_cycle_ids: candidateCycleIds,
  };
}

function parseBlockers(text) {
  const lines = String(text).split(/\r?\n/);
  const blockers = [];
  let active = false;
  for (const line of lines) {
    if (/^blockers:\s*$/i.test(line.trim())) {
      active = true;
      continue;
    }
    if (active && /^##\s+/.test(line)) {
      break;
    }
    if (active && /^[-*]?\s*[a-zA-Z0-9_ -]+:\s*/.test(line) && !/^\s*-/.test(line)) {
      break;
    }
    if (!active) {
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const value = normalizeScalar(bulletMatch[1]);
    if (!value || /^none$/i.test(value)) {
      continue;
    }
    blockers.push(value);
  }
  return blockers;
}

function deriveCycleType({ dirName, branchName }) {
  const branchType = String(branchName ?? "").split("/", 1)[0].trim().toLowerCase();
  if (branchType) {
    const normalizedBranchType = normalizeCycleType(branchType);
    if (normalizedBranchType !== "unknown") {
      return normalizedBranchType;
    }
  }
  const dirMatch = String(dirName ?? "").match(/^C\d+-([a-z0-9]+)(?:-|$)/i);
  return normalizeCycleType(dirMatch?.[1] ?? "unknown");
}

function classifyCycleReadiness({ outcome, dorState, blockers }) {
  const normalizedOutcome = String(outcome ?? "").trim().toUpperCase();
  const normalizedDor = String(dorState ?? "").trim().toUpperCase();
  const blockerCount = Array.isArray(blockers) ? blockers.length : 0;
  if (blockerCount > 0) {
    return { readiness: "blocked", reason: "cycle has declared blockers" };
  }
  if (normalizedOutcome === "DONE" && normalizedDor === "READY") {
    return { readiness: "ready", reason: "cycle is DONE with dor_state=READY" };
  }
  if ((normalizedOutcome === "ACTIVE" || normalizedOutcome === "DONE") && normalizedDor === "READY") {
    return { readiness: "conditional", reason: "cycle is active but still appears technically ready" };
  }
  if (normalizedOutcome === "ACTIVE" || normalizedOutcome === "OPEN") {
    return { readiness: "blocked", reason: "cycle is not completed yet" };
  }
  return { readiness: "unknown", reason: "cycle readiness could not be classified from status metadata" };
}

function collectMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolute));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolute);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeRepoPath(candidate) {
  const normalized = String(candidate ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("docs/audit/") || normalized.startsWith(".aidn/") || normalized.startsWith(".codex/")) {
    return null;
  }
  if (normalized.includes(" ")) {
    return null;
  }
  if (normalized.includes("/") || ROOT_FILE_NAMES.has(normalized)) {
    return normalized;
  }
  return null;
}

function extractRepoPaths(text) {
  const results = new Set();
  const push = (candidate) => {
    const normalized = normalizeRepoPath(candidate);
    if (normalized) {
      results.add(normalized);
    }
  };
  for (const match of String(text).matchAll(/`([^`\n]+)`/g)) {
    push(match[1]);
  }
  for (const match of String(text).matchAll(/\b(?:src|test|tests|lib|app|server|client|web|ui|api|cmd|pkg|internal|scripts|tools|config|configs|packages)\/[A-Za-z0-9_./-]+\b/g)) {
    push(match[0]);
  }
  for (const match of String(text).matchAll(/\b(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig\.json|vite\.config\.(?:ts|js)|README\.md)\b/g)) {
    push(match[0]);
  }
  return Array.from(results).sort((a, b) => a.localeCompare(b));
}

function deriveModuleHints(paths) {
  return Array.from(new Set((paths ?? [])
    .map((item) => {
      const segments = String(item).split("/").filter(Boolean);
      if (segments.length >= 2 && ["src", "tests", "test", "lib", "app", "server", "client", "ui", "api", "pkg", "internal"].includes(segments[0])) {
        return `${segments[0]}/${segments[1]}`;
      }
      return segments[0] ?? "";
    })
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function loadCycleDescriptor(statusPath) {
  if (!statusPath || !fs.existsSync(statusPath)) {
    return null;
  }
  const cycleDir = path.dirname(statusPath);
  const dirName = path.basename(cycleDir);
  const cycleId = extractCycleIds(dirName).at(0) ?? "unknown";
  const statusText = fs.readFileSync(statusPath, "utf8");
  const statusMap = parseSimpleMap(statusText);
  const branchName = normalizeScalar(statusMap.get("branch_name") ?? "none") || "none";
  const cycleType = deriveCycleType({ dirName, branchName });
  const blockers = parseBlockers(statusText);
  const readiness = classifyCycleReadiness({
    outcome: statusMap.get("outcome") ?? "",
    dorState: statusMap.get("dor_state") ?? "",
    blockers,
  });
  const referencedPaths = Array.from(new Set(collectMarkdownFiles(cycleDir)
    .flatMap((filePath) => extractRepoPaths(fs.readFileSync(filePath, "utf8")))))
    .sort((a, b) => a.localeCompare(b));
  return {
    cycle_id: cycleId,
    cycle_dir: cycleDir,
    cycle_dir_name: dirName,
    status_path: statusPath,
    cycle_type: cycleType,
    branch_name: branchName,
    state: normalizeScalar(statusMap.get("state") ?? "unknown") || "unknown",
    outcome: normalizeScalar(statusMap.get("outcome") ?? "unknown") || "unknown",
    dor_state: normalizeScalar(statusMap.get("dor_state") ?? "unknown") || "unknown",
    blockers,
    readiness: readiness.readiness,
    readiness_reason: readiness.reason,
    referenced_paths: referencedPaths,
    module_hints: deriveModuleHints(referencedPaths),
  };
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function classifyPairOverlap(left, right) {
  const sharedPaths = intersect(left.referenced_paths, right.referenced_paths);
  const sharedModules = intersect(left.module_hints, right.module_hints);
  let overlapLevel = "none";
  let reason = "cycles reference distinct modules";
  if (left.referenced_paths.length === 0 || right.referenced_paths.length === 0) {
    overlapLevel = "unknown";
    reason = "at least one cycle has no referenced code paths";
  } else if (sharedPaths.length >= 3) {
    overlapLevel = "high";
    reason = `${sharedPaths.length} shared file paths were detected`;
  } else if (sharedPaths.length >= 1) {
    overlapLevel = "medium";
    reason = `${sharedPaths.length} shared file path(s) were detected`;
  } else if (sharedModules.length >= 1) {
    overlapLevel = "low";
    reason = `cycles overlap in module(s): ${sharedModules.join(", ")}`;
  }
  return {
    left_cycle_id: left.cycle_id,
    right_cycle_id: right.cycle_id,
    overlap_level: overlapLevel,
    reason,
    shared_paths: sharedPaths,
    shared_modules: sharedModules,
  };
}

function classifyCandidateSet(candidateCycles) {
  const pairAssessments = [];
  for (let leftIndex = 0; leftIndex < candidateCycles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidateCycles.length; rightIndex += 1) {
      pairAssessments.push(classifyPairOverlap(candidateCycles[leftIndex], candidateCycles[rightIndex]));
    }
  }
  const overallOverlap = classifyOverallOverlap(pairAssessments.map((item) => item.overlap_level));
  return {
    pair_assessments: pairAssessments,
    overall_overlap: overallOverlap,
  };
}

export function assessIntegrationRisk({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  sessionsDir = "docs/audit/sessions",
  cyclesDir = "docs/audit/cycles",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const currentStatePath = path.resolve(absoluteTargetRoot, currentStateFile);
  const sessionsRoot = path.resolve(absoluteTargetRoot, sessionsDir);
  const cyclesRoot = path.resolve(absoluteTargetRoot, cyclesDir);
  const currentState = parseCurrentState(currentStatePath);
  const sessionFile = findSessionFile(path.dirname(sessionsRoot), currentState.active_session);
  const sessionText = sessionFile ? fs.readFileSync(sessionFile, "utf8") : "";
  const topology = parseSessionTopology(sessionText, currentState.active_cycle);
  const candidateCycles = topology.candidate_cycle_ids.map((cycleId) => {
    const statusPath = findCycleStatus(path.dirname(cyclesRoot), cycleId);
    const descriptor = loadCycleDescriptor(statusPath);
    if (descriptor) {
      return descriptor;
    }
    return {
      cycle_id: cycleId,
      cycle_dir: "none",
      cycle_dir_name: "none",
      status_path: "missing",
      cycle_type: "unknown",
      branch_name: "none",
      state: "missing",
      outcome: "missing",
      dor_state: "unknown",
      blockers: ["missing cycle status artifact"],
      readiness: "blocked",
      readiness_reason: "cycle status artifact is missing",
      referenced_paths: [],
      module_hints: [],
    };
  });
  const overlap = classifyCandidateSet(candidateCycles);
  const semantic = classifyOverallSemanticRisk(candidateCycles.map((cycle) => cycle.cycle_type));
  const readiness = classifyOverallReadiness(candidateCycles.map((cycle) => cycle.readiness));
  const missingContext = !sessionFile
    || candidateCycles.length === 0
    || candidateCycles.some((cycle) => cycle.cycle_type === "unknown" || cycle.status_path === "missing");
  const strategy = deriveIntegrationStrategy({
    cycleTypes: candidateCycles.map((cycle) => cycle.cycle_type),
    overlapLevel: overlap.overall_overlap,
    semanticRisk: semantic.semantic_risk,
    readiness,
    candidateCount: candidateCycles.length,
    missingContext,
  });
  return {
    target_root: absoluteTargetRoot,
    current_state_file: currentStatePath,
    session_file: sessionFile ?? "missing",
    active_session: currentState.active_session,
    active_cycle: currentState.active_cycle,
    topology,
    candidate_cycles: candidateCycles,
    overlap,
    semantic,
    readiness,
    mergeability: strategy.mergeability,
    recommended_strategy: strategy.recommended_strategy,
    arbitration_required: strategy.arbitration_required,
    rationale: strategy.reasons,
    missing_context: missingContext,
  };
}
