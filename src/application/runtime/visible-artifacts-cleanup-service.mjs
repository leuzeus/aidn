import fs from "node:fs";
import path from "node:path";
import { readSharedRuntimeLocatorSafe } from "../../lib/config/shared-runtime-locator-config-lib.mjs";
import { removePathWithRetry } from "../../lib/fs/remove-path-with-retry.mjs";

const MANAGED_VISIBLE_PATHS = [
  "docs/audit/AGENT-HEALTH-SUMMARY.md",
  "docs/audit/AGENT-SELECTION-SUMMARY.md",
  "docs/audit/ARTIFACT_MANIFEST.md",
  "docs/audit/COORDINATION-LOG.md",
  "docs/audit/COORDINATION-SUMMARY.md",
  "docs/audit/CURRENT-STATE.md",
  "docs/audit/HANDOFF-PACKET.md",
  "docs/audit/INTEGRATION-RISK.md",
  "docs/audit/MULTI-AGENT-STATUS.md",
  "docs/audit/RUNTIME-STATE.md",
  "docs/audit/USER-ARBITRATION.md",
  "docs/audit/backlog/legacy-derived.md",
  "docs/audit/baseline/current.md",
  "docs/audit/baseline/history.md",
  "docs/audit/parking-lot.md",
  "docs/audit/snapshots/context-snapshot.md",
];

const MANAGED_VISIBLE_CHILD_PATTERNS = [
  { root: "docs/audit/baseline", pattern: /^v\d+/i },
  { root: "docs/audit/cycles", pattern: /^C\d+/i },
  { root: "docs/audit/migration", pattern: /.+/ },
  { root: "docs/audit/reports", pattern: /.+/ },
  { root: "docs/audit/sessions", pattern: /^S\d+.*\.md$/i },
];

const PROTECTED_VISIBLE_FILES = [
  "AGENTS.md",
  ".gitignore",
  ".codex",
  "docs/audit/AGENT-ADAPTERS.md",
  "docs/audit/AGENT-ROSTER.md",
  "docs/audit/CODEX_ONLINE.md",
  "docs/audit/CONTINUITY_GATE.md",
  "docs/audit/CRASH-RECOVERY-RUNBOOK.md",
  "docs/audit/REANCHOR_PROMPT.md",
  "docs/audit/RULE_STATE_BOUNDARY.md",
  "docs/audit/SPEC.md",
  "docs/audit/WORKFLOW-KERNEL.md",
  "docs/audit/WORKFLOW.md",
  "docs/audit/WORKFLOW_SUMMARY.md",
  "docs/audit/backlog/TEMPLATE_SESSION_BACKLOG.md",
  "docs/audit/cycles/TEMPLATE_CYCLE.md",
  "docs/audit/cycles/TEMPLATE_STATUS.md",
  "docs/audit/cycles/TEMPLATE_audit-spec.md",
  "docs/audit/cycles/TEMPLATE_brief.md",
  "docs/audit/cycles/TEMPLATE_change-requests.md",
  "docs/audit/cycles/TEMPLATE_decisions.md",
  "docs/audit/cycles/TEMPLATE_gap-report.md",
  "docs/audit/cycles/TEMPLATE_hypotheses.md",
  "docs/audit/cycles/TEMPLATE_plan.md",
  "docs/audit/cycles/TEMPLATE_traceability.md",
  "docs/audit/cycles/cycle-status.md",
  "docs/audit/fragments",
  "docs/audit/glossary.md",
  "docs/audit/incidents/TEMPLATE_INC_TMP.md",
  "docs/audit/index.md",
  "docs/audit/sessions/TEMPLATE_SESSION_SXXX.md",
];

function normalizeRelative(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

function toSafeSegment(value, fallback = "project") {
  const normalized = String(value ?? "").trim();
  return (normalized || fallback).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function timestampForBackup(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isSubpath(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function listFilesRecursive(rootPath, rootRelative) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    return [normalizeRelative(rootRelative)];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const rows = [];
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(rootPath, entry.name);
    const relative = normalizeRelative(path.join(rootRelative, entry.name));
    if (entry.isDirectory()) {
      rows.push(...listFilesRecursive(absolute, relative));
    } else if (entry.isFile()) {
      rows.push(relative);
    }
  }
  return rows.sort((left, right) => left.localeCompare(right));
}

function resolveProjectId(targetRoot) {
  const locator = readSharedRuntimeLocatorSafe(targetRoot);
  const locatorProjectId = locator.valid ? locator.data?.projectId : "";
  return toSafeSegment(locatorProjectId || path.basename(path.resolve(targetRoot)), "project");
}

function resolveDefaultBackupRoot(targetRoot, projectId, date = new Date()) {
  const parent = path.dirname(path.resolve(targetRoot));
  return path.resolve(parent, ".aidn-backups", projectId, timestampForBackup(date));
}

function copyPath(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
}

function shouldFallbackToCopyRemove(error) {
  return ["EXDEV", "EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].includes(String(error?.code ?? ""));
}

export function movePath(sourcePath, destinationPath, options = {}) {
  const renameSync = typeof options.renameSync === "function" ? options.renameSync : fs.renameSync;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    renameSync(sourcePath, destinationPath);
  } catch (error) {
    if (!shouldFallbackToCopyRemove(error)) {
      throw error;
    }
    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
    removePathWithRetry(sourcePath);
  }
}

function pushCandidate(candidates, candidateFiles, targetRoot, relative) {
  const absolute = path.resolve(targetRoot, relative);
  if (!fs.existsSync(absolute)) {
    return;
  }
  candidates.push({
    relative: normalizeRelative(relative),
    absolute,
    file_count: listFilesRecursive(absolute, relative).length,
  });
  candidateFiles.push(...listFilesRecursive(absolute, relative));
}

function collectManagedVisibleCandidates(targetRoot) {
  const candidates = [];
  const candidateFiles = [];
  const seen = new Set();

  function add(relative) {
    const normalized = normalizeRelative(relative);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      return;
    }
    seen.add(key);
    pushCandidate(candidates, candidateFiles, targetRoot, normalized);
  }

  for (const relative of MANAGED_VISIBLE_PATHS) {
    add(relative);
  }
  for (const item of MANAGED_VISIBLE_CHILD_PATTERNS) {
    const absoluteRoot = path.resolve(targetRoot, item.root);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
      continue;
    }
    const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!item.pattern.test(entry.name)) {
        continue;
      }
      add(path.join(item.root, entry.name));
    }
  }

  candidates.sort((left, right) => left.relative.localeCompare(right.relative));
  return {
    candidates,
    candidateFiles,
  };
}

function classifyVisibleArtifacts(targetRoot) {
  const {
    candidates,
    candidateFiles,
  } = collectManagedVisibleCandidates(targetRoot);
  const protectedFiles = [];
  for (const relative of PROTECTED_VISIBLE_FILES) {
    const absolute = path.resolve(targetRoot, relative);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    protectedFiles.push(relative);
  }
  return {
    candidates,
    candidate_files: Array.from(new Set(candidateFiles)).sort((left, right) => left.localeCompare(right)),
    protected_files: protectedFiles,
    unknown_files: [],
    already_conformant: candidates.length === 0,
  };
}

export function planVisibleArtifactsCleanup({
  targetRoot,
  backupRoot = "",
  now = new Date(),
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot || ".");
  const projectId = resolveProjectId(absoluteTargetRoot);
  const resolvedBackupRoot = backupRoot
    ? path.resolve(process.cwd(), backupRoot)
    : resolveDefaultBackupRoot(absoluteTargetRoot, projectId, now);
  const quarantineRoot = path.resolve(resolvedBackupRoot, "quarantine");
  const originalRoot = path.resolve(resolvedBackupRoot, "original");
  const classification = classifyVisibleArtifacts(absoluteTargetRoot);
  const backupOutsideProject = !isSubpath(absoluteTargetRoot, resolvedBackupRoot);
  return {
    kind: "runtime-visible-artifacts-cleanup",
    target_root: absoluteTargetRoot,
    project_id: projectId,
    backup_root: resolvedBackupRoot,
    original_root: originalRoot,
    quarantine_root: quarantineRoot,
    backup_outside_project: backupOutsideProject,
    candidates: classification.candidates.map((item) => ({
      relative: item.relative,
      file_count: item.file_count,
      backup_to: path.resolve(originalRoot, item.relative),
      quarantine_to: path.resolve(quarantineRoot, item.relative),
    })),
    candidate_files: classification.candidate_files,
    protected_files: classification.protected_files,
    unknown_files: classification.unknown_files,
    already_conformant: classification.already_conformant,
  };
}

export function runVisibleArtifactsCleanup({
  targetRoot,
  backupRoot = "",
  write = false,
  now = new Date(),
} = {}) {
  const plan = planVisibleArtifactsCleanup({ targetRoot, backupRoot, now });
  const result = {
    ...plan,
    write_requested: write === true,
    backup_created: false,
    quarantined_count: 0,
    restored_count: 0,
    status: "preview",
    errors: [],
  };
  if (!write) {
    return result;
  }
  if (!plan.backup_outside_project) {
    result.status = "blocked";
    result.errors.push("backup root must be outside target project");
    return result;
  }
  fs.mkdirSync(plan.original_root, { recursive: true });
  fs.mkdirSync(plan.quarantine_root, { recursive: true });
  for (const candidate of plan.candidates) {
    const sourcePath = path.resolve(plan.target_root, candidate.relative);
    if (!isSubpath(plan.target_root, sourcePath) || !fs.existsSync(sourcePath)) {
      continue;
    }
    const originalPath = path.resolve(plan.original_root, candidate.relative);
    const quarantinePath = path.resolve(plan.quarantine_root, candidate.relative);
    copyPath(sourcePath, originalPath);
    movePath(sourcePath, quarantinePath);
    result.quarantined_count += 1;
  }
  result.backup_created = true;
  result.status = "applied";
  return result;
}

export function planVisibleArtifactsRestore({
  targetRoot,
  from,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot || ".");
  const backupRoot = path.resolve(process.cwd(), from || "");
  if (!from) {
    throw new Error("Missing required --from backup root.");
  }
  const quarantineRoot = path.resolve(backupRoot, "quarantine");
  const originalRoot = path.resolve(backupRoot, "original");
  const sourceRoot = fs.existsSync(quarantineRoot) ? quarantineRoot : originalRoot;
  const restoreItems = [];
  const { candidates } = collectManagedVisibleCandidates(sourceRoot);
  for (const candidate of candidates) {
    const relative = candidate.relative;
    const sourcePath = path.resolve(sourceRoot, relative);
    restoreItems.push({
      relative,
      source: sourcePath,
      destination: path.resolve(absoluteTargetRoot, relative),
      file_count: listFilesRecursive(sourcePath, relative).length,
    });
  }
  return {
    kind: "runtime-visible-artifacts-restore",
    target_root: absoluteTargetRoot,
    backup_root: backupRoot,
    source_root: sourceRoot,
    restore_items: restoreItems,
  };
}

export function runVisibleArtifactsRestore({
  targetRoot,
  from,
  write = false,
} = {}) {
  const plan = planVisibleArtifactsRestore({ targetRoot, from });
  const result = {
    ...plan,
    write_requested: write === true,
    restored_count: 0,
    status: "preview",
    errors: [],
  };
  if (!write) {
    return result;
  }
  for (const item of plan.restore_items) {
    if (!isSubpath(plan.source_root, item.source)) {
      result.status = "blocked";
      result.errors.push(`restore source escapes backup root: ${item.relative}`);
      return result;
    }
    if (!isSubpath(plan.target_root, item.destination)) {
      result.status = "blocked";
      result.errors.push(`restore destination escapes target root: ${item.relative}`);
      return result;
    }
    copyPath(item.source, item.destination);
    result.restored_count += 1;
  }
  result.status = "applied";
  return result;
}
