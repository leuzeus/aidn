import fs from "node:fs";
import path from "node:path";

const COMMON_REQUIRED_ARTIFACTS = [
  "baseline/current.md",
  "snapshots/context-snapshot.md",
  "WORKFLOW.md",
];

const MODERN_REQUIRED_ARTIFACTS = [
  ...COMMON_REQUIRED_ARTIFACTS,
  "SPEC.md",
];

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseKeyValues(content) {
  const out = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    out[key] = match[2].trim();
  }
  return out;
}

function safeDirEntries(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true });
}

function findLatestSessionFile(auditRoot) {
  const sessionsRoot = path.join(auditRoot, "sessions");
  const files = safeDirEntries(sessionsRoot)
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name))
    .map((entry) => path.join(sessionsRoot, entry.name));
  if (files.length === 0) {
    return null;
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function sampleStatusFiles(auditRoot, max = 12) {
  const cyclesRoot = path.join(auditRoot, "cycles");
  const dirs = safeDirEntries(cyclesRoot).filter((entry) => entry.isDirectory());
  const files = [];
  for (const dir of dirs) {
    const statusPath = path.join(cyclesRoot, dir.name, "status.md");
    if (fs.existsSync(statusPath)) {
      files.push(statusPath);
    }
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files.slice(0, max);
}

function detectKind(signals) {
  if (signals.cycle_dirs_modern_count > 0 && signals.cycle_dirs_legacy_count > 0) {
    return { kind: "mixed", confidence: 95 };
  }
  if (signals.cycle_dirs_modern_count > 0) {
    return { kind: "modern", confidence: signals.has_spec_md ? 90 : 70 };
  }
  if (signals.cycle_dirs_legacy_count > 0) {
    return { kind: "legacy", confidence: 75 };
  }
  if (signals.has_spec_md && signals.has_workflow_summary) {
    return { kind: "modern", confidence: 65 };
  }
  return { kind: "unknown", confidence: 30 };
}

function recommendedArtifactsForKind(kind) {
  if (kind === "modern") {
    return MODERN_REQUIRED_ARTIFACTS;
  }
  return COMMON_REQUIRED_ARTIFACTS;
}

export function detectStructureProfile(auditRoot) {
  const workflowPath = path.join(auditRoot, "WORKFLOW.md");
  const workflowText = readText(workflowPath);
  const workflowKv = parseKeyValues(workflowText);
  const declaredWorkflowVersion = workflowKv.workflow_version || null;

  const cyclesRoot = path.join(auditRoot, "cycles");
  const cycleDirs = safeDirEntries(cyclesRoot).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const cycleDirsLegacy = cycleDirs.filter((name) => /^C\d+$/.test(name));
  const cycleDirsModern = cycleDirs.filter((name) => /^C\d+-/.test(name));

  const hasSpec = fs.existsSync(path.join(auditRoot, "SPEC.md"));
  const hasSummary = fs.existsSync(path.join(auditRoot, "WORKFLOW_SUMMARY.md"));
  const hasContinuityGate = fs.existsSync(path.join(auditRoot, "CONTINUITY_GATE.md"));
  const latestSession = findLatestSessionFile(auditRoot);
  const latestSessionText = latestSession ? readText(latestSession) : "";
  const latestSessionHasContinuity = /continuity_basis|continuity_check|session_branch/i.test(latestSessionText);

  const statusSamples = sampleStatusFiles(auditRoot, 12);
  const statusWithContinuity = statusSamples
    .map((filePath) => readText(filePath))
    .filter((text) => /continuity_rule|continuity_base_branch|continuity_latest_cycle_branch/i.test(text)).length;

  const signals = {
    has_workflow_md: fs.existsSync(workflowPath),
    has_spec_md: hasSpec,
    has_workflow_summary: hasSummary,
    has_continuity_gate: hasContinuityGate,
    cycle_dirs_total: cycleDirs.length,
    cycle_dirs_legacy_count: cycleDirsLegacy.length,
    cycle_dirs_modern_count: cycleDirsModern.length,
    latest_session_has_continuity_fields: latestSessionHasContinuity,
    sampled_status_with_continuity_fields: statusWithContinuity,
    sampled_status_count: statusSamples.length,
  };

  const detected = detectKind(signals);
  const notes = [];
  if (detected.kind === "mixed") {
    notes.push("Legacy and modern cycle directory layouts were both detected.");
  }
  if (declaredWorkflowVersion && detected.kind === "modern" && /^0\.1\./.test(declaredWorkflowVersion)) {
    notes.push("Declared workflow_version looks older than observed structure signals.");
  }
  if (declaredWorkflowVersion && detected.kind === "mixed") {
    notes.push("Declared workflow_version is insufficient alone; mixed structure requires structural checks.");
  }

  return {
    kind: detected.kind,
    confidence: detected.confidence,
    declared_workflow_version: declaredWorkflowVersion,
    observed_version_hint: detected.kind === "modern"
      ? "state-boundary-spec-rules"
      : (detected.kind === "legacy" ? "legacy-cycle-layout" : (detected.kind === "mixed" ? "hybrid" : "unknown")),
    recommended_required_artifacts: recommendedArtifactsForKind(detected.kind),
    optional_tracked_artifacts: [
      "SPEC.md",
      "WORKFLOW_SUMMARY.md",
      "CONTINUITY_GATE.md",
    ],
    signals,
    notes,
  };
}
