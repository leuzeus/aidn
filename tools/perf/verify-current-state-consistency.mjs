#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-current-state-consistency.mjs");
  console.log("  node tools/perf/verify-current-state-consistency.mjs --target tests/fixtures/repo-installed-core --json");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function normalizeScalar(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  return value.replace(/^`|`$/g, "").trim();
}

function parseTimestamp(value) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = Date.parse(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseSimpleMap(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    map.set(match[1], normalizeScalar(match[2]));
  }
  return map;
}

function parseSessionFile(text) {
  const map = new Map();
  const lines = String(text).split(/\r?\n/);
  let mode = "";

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^-\s+([a-zA-Z0-9_]+):\s*(.+)$/);
    if (bulletMatch) {
      map.set(bulletMatch[1], normalizeScalar(bulletMatch[2]));
      continue;
    }
    if (trimmed.startsWith("[x]")) {
      if (trimmed.includes("COMMITTING")) {
        mode = "COMMITTING";
      } else if (trimmed.includes("EXPLORING")) {
        mode = "EXPLORING";
      } else if (trimmed.includes("THINKING")) {
        mode = "THINKING";
      }
    }
  }

  if (mode) {
    map.set("mode", mode);
  }
  return map;
}

function parseSessionListField(text, fieldName) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const inlinePattern = new RegExp(`^\\s*-\\s+${fieldName}:\\s*(.*)$`, "i");
  let collecting = false;

  for (const line of lines) {
    const match = line.match(inlinePattern);
    if (!collecting && match) {
      const remainder = normalizeScalar(match[1] ?? "");
      if (remainder) {
        if (!canonicalNone(remainder)) {
          items.push(...remainder.split(",").map((item) => normalizeScalar(item)).filter(Boolean).filter((item) => !canonicalNone(item)));
        }
        break;
      }
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (/^##\s+/.test(line) || /^\s*-\s+[a-zA-Z0-9_]+:\s*/.test(line)) {
      break;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const item = normalizeScalar(bulletMatch[1] ?? "");
    if (item && !canonicalNone(item)) {
      items.push(item);
    }
  }

  return Array.from(new Set(items));
}

function parseSnapshot(text) {
  const lines = String(text).split(/\r?\n/);
  let activeCycles = [];
  let inActiveCycles = false;
  let snapshotSession = "";
  let snapshotCycle = "";

  for (const line of lines) {
    if (line.startsWith("## Active cycles")) {
      inActiveCycles = true;
      continue;
    }
    if (line.startsWith("## ") && !line.startsWith("## Active cycles")) {
      inActiveCycles = false;
    }
    if (inActiveCycles && line.trim().startsWith("- ")) {
      const item = line.trim().slice(2).trim();
      if (item && item !== "(none)") {
        const cycleMatch = item.match(/\b(C[0-9A-Z]+)\b/);
        if (cycleMatch) {
          activeCycles.push(cycleMatch[1]);
        }
      }
    }

    const sessionMatch = line.match(/^- Session active:\s*`?\(?([^`)]+)\)?`?\s*$/);
    if (sessionMatch) {
      snapshotSession = normalizeScalar(sessionMatch[1]);
    }
    const cycleMatch = line.match(/^- Active cycle:\s*`?\(?([^`)]+)\)?`?\s*$/);
    if (cycleMatch) {
      snapshotCycle = normalizeScalar(cycleMatch[1]);
    }
  }

  activeCycles = Array.from(new Set(activeCycles));
  return {
    active_cycles: activeCycles,
    active_session: snapshotSession,
    active_cycle: snapshotCycle,
  };
}

function canonicalNone(value) {
  const normalized = normalizeScalar(value).toLowerCase();
  return normalized === "none" || normalized === "(none)";
}

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
}

function parseStatusFile(statusPath) {
  if (!exists(statusPath)) {
    return new Map();
  }
  return parseSimpleMap(readText(statusPath));
}

function findSessionFile(sessionsDir, sessionId) {
  if (!exists(sessionsDir) || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(sessionsDir, entry.name));

  const direct = entries.find((filePath) => path.basename(filePath).startsWith(sessionId));
  if (direct) {
    return direct;
  }

  return entries.find((filePath) => readText(filePath).includes(`# Session ${sessionId}`)) ?? null;
}

function findCycleStatus(cyclesDir, cycleId) {
  if (!exists(cyclesDir) || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  const dirs = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${cycleId}-`))
    .map((entry) => path.join(cyclesDir, entry.name, "status.md"));

  return dirs.find((filePath) => exists(filePath)) ?? null;
}

function check(checks, key, pass, details = "") {
  checks[key] = {
    pass,
    details,
  };
}

export function evaluateCurrentStateConsistency({ targetRoot }) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot);
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const currentStatePath = path.join(auditRoot, "CURRENT-STATE.md");
  const snapshotPath = path.join(auditRoot, "snapshots", "context-snapshot.md");
  const sessionsDir = path.join(auditRoot, "sessions");
  const cyclesDir = path.join(auditRoot, "cycles");

  const checks = {};
  const missingFiles = [];

  if (!exists(currentStatePath)) {
    missingFiles.push(currentStatePath);
  }
  if (!exists(snapshotPath)) {
    missingFiles.push(snapshotPath);
  }

  const currentStateText = exists(currentStatePath) ? readText(currentStatePath) : "";
  const snapshotText = exists(snapshotPath) ? readText(snapshotPath) : "";
  const current = parseSimpleMap(currentStateText);
  const snapshot = parseSnapshot(snapshotText);

  const updatedAt = normalizeScalar(current.get("updated_at") ?? "");
  const updatedAtMs = parseTimestamp(updatedAt);
  check(
    checks,
    "updated_at_parseable",
    updatedAtMs !== null,
    updatedAt || "missing updated_at",
  );

  const activeSession = normalizeScalar(current.get("active_session") ?? "");
  const sessionBranch = normalizeScalar(current.get("session_branch") ?? "");
  const branchKind = normalizeScalar(current.get("branch_kind") ?? "");
  const mode = normalizeScalar(current.get("mode") ?? "");
  const activeCycle = normalizeScalar(current.get("active_cycle") ?? "");
  const cycleBranch = normalizeScalar(current.get("cycle_branch") ?? "");
  const dorState = normalizeScalar(current.get("dor_state") ?? "");
  const firstPlanStep = normalizeScalar(current.get("first_plan_step") ?? "");

    check(
      checks,
      "session_branch_consistent",
      (canonicalNone(activeSession) && canonicalNone(sessionBranch))
        || (!canonicalNone(activeSession) && !canonicalUnknown(activeSession) && !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch)),
      `active_session=${activeSession || "missing"} session_branch=${sessionBranch || "missing"}`,
    );

    check(
      checks,
      "cycle_branch_consistent",
      (canonicalNone(activeCycle) && canonicalNone(cycleBranch))
        || (!canonicalNone(activeCycle) && !canonicalUnknown(activeCycle) && !canonicalNone(cycleBranch) && !canonicalUnknown(cycleBranch)),
      `active_cycle=${activeCycle || "missing"} cycle_branch=${cycleBranch || "missing"}`,
    );

    check(
      checks,
      "branch_kind_known_when_active",
      (!canonicalNone(activeSession) || !canonicalNone(activeCycle)) ? !canonicalUnknown(branchKind) : true,
      `branch_kind=${branchKind || "missing"}`,
    );

    check(
      checks,
      "committing_requires_cycle",
      mode !== "COMMITTING" || (!canonicalNone(activeCycle) && !canonicalUnknown(activeCycle)),
      `mode=${mode || "missing"} active_cycle=${activeCycle || "missing"}`,
    );

    check(
      checks,
      "committing_requires_dor",
      mode !== "COMMITTING" || (!canonicalUnknown(dorState) && !canonicalNone(dorState)),
      `mode=${mode || "missing"} dor_state=${dorState || "missing"}`,
    );

    check(
      checks,
      "committing_requires_first_plan_step",
      mode !== "COMMITTING" || (!canonicalUnknown(firstPlanStep) && !canonicalNone(firstPlanStep)),
      `mode=${mode || "missing"} first_plan_step=${firstPlanStep || "missing"}`,
    );

  const sessionFile = findSessionFile(sessionsDir, activeSession);
  check(
    checks,
    "active_session_file_exists",
    canonicalNone(activeSession) || canonicalUnknown(activeSession) || Boolean(sessionFile),
    sessionFile ?? `session ${activeSession || "missing"} not found`,
  );

  const session = sessionFile ? parseSessionFile(readText(sessionFile)) : new Map();
  const sessionMode = normalizeScalar(session.get("mode") ?? "");
  const sessionBranchFromFile = normalizeScalar(session.get("session_branch") ?? "");
  const sessionBranchKind = normalizeScalar(session.get("branch_kind") ?? "");
  const sessionCycleBranch = normalizeScalar(session.get("cycle_branch") ?? "");
  const sessionIntegrationTarget = normalizeScalar(session.get("integration_target_cycle") ?? "");
  const sessionPrimaryFocusCycle = normalizeScalar(session.get("primary_focus_cycle") ?? "");
  const sessionAttachedCycles = parseSessionListField(sessionFile ? readText(sessionFile) : "", "attached_cycles");
  const sessionIntegrationTargetCycles = parseSessionListField(sessionFile ? readText(sessionFile) : "", "integration_target_cycles");

    check(
      checks,
      "session_branch_matches_session_file",
      !sessionFile || canonicalNone(activeSession) || !sessionBranchFromFile || sessionBranchFromFile === sessionBranch,
      `session.session_branch=${sessionBranchFromFile || "missing"} current_state.session_branch=${sessionBranch || "missing"}`,
    );

    check(
      checks,
      "branch_kind_matches_session_file",
      !sessionFile || canonicalUnknown(branchKind) || !sessionBranchKind || sessionBranchKind === branchKind,
      `session.branch_kind=${sessionBranchKind || "missing"} current_state.branch_kind=${branchKind || "missing"}`,
    );

    check(
      checks,
      "mode_matches_session_file",
      !sessionFile || canonicalUnknown(mode) || !sessionMode || sessionMode === mode,
      `session.mode=${sessionMode || "missing"} current_state.mode=${mode || "missing"}`,
    );

    check(
      checks,
      "cycle_branch_matches_session_file",
      !sessionFile || canonicalUnknown(cycleBranch) || !sessionCycleBranch || sessionCycleBranch === cycleBranch,
      `session.cycle_branch=${sessionCycleBranch || "missing"} current_state.cycle_branch=${cycleBranch || "missing"}`,
    );

  const attachedCycles = sessionAttachedCycles;
  const integrationTargets = Array.from(new Set([
    ...sessionIntegrationTargetCycles,
    ...(sessionIntegrationTarget
      ? sessionIntegrationTarget.split(",").map((item) => normalizeScalar(item)).filter(Boolean).filter((item) => item.toLowerCase() !== "none")
      : []),
    ...(sessionPrimaryFocusCycle && !canonicalNone(sessionPrimaryFocusCycle) ? [sessionPrimaryFocusCycle] : []),
  ]));
  check(
    checks,
    "active_cycle_matches_session_tracking",
    !sessionFile
      || canonicalNone(activeCycle)
      || canonicalUnknown(activeCycle)
      || (integrationTargets.length === 0 && attachedCycles.length === 0)
      || integrationTargets.includes(activeCycle)
      || attachedCycles.includes(activeCycle),
    `session.integration_target_cycle=${sessionIntegrationTarget || "missing"} session.integration_target_cycles=${integrationTargets.join(",") || "none"} session.attached_cycles=${attachedCycles.join(",") || "none"} current_state.active_cycle=${activeCycle || "missing"}`,
  );

  const cycleStatusPath = findCycleStatus(cyclesDir, activeCycle);
  check(
    checks,
    "active_cycle_status_exists",
    canonicalNone(activeCycle) || canonicalUnknown(activeCycle) || Boolean(cycleStatusPath),
    cycleStatusPath ?? `cycle ${activeCycle || "missing"} not found`,
  );

  const status = cycleStatusPath ? parseStatusFile(cycleStatusPath) : new Map();
  const statusBranchName = normalizeScalar(status.get("branch_name") ?? "");
  const statusDorState = normalizeScalar(status.get("dor_state") ?? "");
  const statusSessionOwner = normalizeScalar(status.get("session_owner") ?? "");
  const statusLastUpdated = normalizeScalar(status.get("last updated") ?? "");
  const statusLastUpdatedMs = parseTimestamp(statusLastUpdated);
  const dorLastCheck = normalizeScalar(status.get("dor_last_check") ?? "");
  const dorLastCheckMs = parseTimestamp(dorLastCheck);

    check(
      checks,
      "cycle_branch_matches_status",
      !cycleStatusPath || canonicalUnknown(cycleBranch) || statusBranchName === cycleBranch,
      `status.branch_name=${statusBranchName || "missing"} current_state.cycle_branch=${cycleBranch || "missing"}`,
    );

    check(
      checks,
      "dor_state_matches_status",
      !cycleStatusPath || canonicalUnknown(dorState) || statusDorState === dorState,
      `status.dor_state=${statusDorState || "missing"} current_state.dor_state=${dorState || "missing"}`,
    );

    check(
      checks,
      "session_owner_matches_status",
      !cycleStatusPath
        || canonicalNone(activeSession)
        || canonicalUnknown(activeSession)
        || !statusSessionOwner
        || statusSessionOwner === activeSession,
      `status.session_owner=${statusSessionOwner || "missing"} current_state.active_session=${activeSession || "missing"}`,
    );

    check(
      checks,
      "updated_at_not_older_than_status",
      !cycleStatusPath || updatedAtMs === null || statusLastUpdatedMs === null || updatedAtMs >= statusLastUpdatedMs,
      `current_state.updated_at=${updatedAt || "missing"} status.last_updated=${statusLastUpdated || "missing"}`,
    );

    check(
      checks,
      "updated_at_not_older_than_dor_check",
      !cycleStatusPath || updatedAtMs === null || dorLastCheckMs === null || updatedAtMs >= dorLastCheckMs,
      `current_state.updated_at=${updatedAt || "missing"} status.dor_last_check=${dorLastCheck || "missing"}`,
    );

  const snapshotSession = snapshot.active_session || "";
  const snapshotCycle = snapshot.active_cycle || "";
  const snapshotHasActiveCycles = snapshot.active_cycles.length > 0;

    check(
      checks,
      "snapshot_session_aligned",
      (canonicalNone(activeSession) && (canonicalNone(snapshotSession) || !snapshotSession))
        || (!canonicalNone(activeSession) && !canonicalUnknown(activeSession) && (!snapshotSession || snapshotSession === activeSession)),
      `snapshot.active_session=${snapshotSession || "missing"} current_state.active_session=${activeSession || "missing"}`,
    );

    check(
      checks,
      "snapshot_cycle_aligned",
      (canonicalNone(activeCycle) && (canonicalNone(snapshotCycle) || !snapshotCycle) && !snapshotHasActiveCycles)
        || (!canonicalNone(activeCycle)
          && !canonicalUnknown(activeCycle)
          && (!snapshotCycle || snapshotCycle === activeCycle)
          && (!snapshotHasActiveCycles || snapshot.active_cycles.includes(activeCycle))),
      `snapshot.active_cycle=${snapshotCycle || "missing"} snapshot.active_cycles=${snapshot.active_cycles.join(",") || "none"} current_state.active_cycle=${activeCycle || "missing"}`,
    );

  const pass = missingFiles.length === 0
    && Object.values(checks).every((item) => item.pass === true);

  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    audit_root: auditRoot,
    missing_files: missingFiles,
    current_state: {
      active_session: activeSession || null,
      session_branch: sessionBranch || null,
      branch_kind: branchKind || null,
      mode: mode || null,
      active_cycle: activeCycle || null,
      cycle_branch: cycleBranch || null,
      dor_state: dorState || null,
      first_plan_step: firstPlanStep || null,
    },
    snapshot,
    checks,
    pass,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const output = evaluateCurrentStateConsistency({ targetRoot: args.target });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.target_root}`);
      console.log(`Missing files: ${output.missing_files.length}`);
      for (const [key, value] of Object.entries(output.checks)) {
        console.log(`- ${key}: ${value.pass ? "yes" : "no"}${value.details ? ` (${value.details})` : ""}`);
      }
      console.log(`Result: ${output.pass ? "PASS" : "FAIL"}`);
    }

    if (!output.pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
