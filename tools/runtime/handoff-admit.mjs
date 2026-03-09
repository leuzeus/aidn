#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canAgentRolePerform, isKnownAgentRole, normalizeAgentAction, normalizeAgentRole } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateAgentTransition } from "../../src/core/agents/agent-transition-policy.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    packetFile: "docs/audit/HANDOFF-PACKET.md",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--packet-file") {
      args.packetFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
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
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/handoff-admit.mjs --target .");
  console.log("  node tools/runtime/handoff-admit.mjs --target tests/fixtures/repo-installed-core --json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function readRequired(filePath) {
  if (!exists(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

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

function canonicalUnknown(value) {
  return normalizeScalar(value).toLowerCase() === "unknown";
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

function parseListSection(text, header) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    if (line.trim() === `${header}:`) {
      active = true;
      continue;
    }
    if (active && (/^[A-Za-z0-9_]+:\s*/.test(line) || /^##\s+/.test(line))) {
      break;
    }
    if (active) {
      const match = line.match(/^\s*-\s+(.+)$/);
      if (match) {
        const item = normalizeScalar(match[1]);
        if (item) {
          items.push(item);
        }
      }
    }
  }
  return items;
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

function isPathLikeArtifact(item) {
  const normalized = normalizeScalar(item);
  if (!normalized) {
    return false;
  }
  if (/^active (session file|cycle `status\.md`)$/.test(normalized)) {
    return false;
  }
  return normalized.includes("/") || normalized.startsWith(".aidn/") || /\.(md|json|yaml|yml|sqlite|txt)$/i.test(normalized);
}

function isConcreteArtifactPath(item) {
  const normalized = normalizeScalar(item);
  if (!isPathLikeArtifact(normalized)) {
    return false;
  }
  return !/[*?]/.test(normalized);
}

function addMismatch(issues, field, packetValue, liveValue) {
  issues.push(`${field} mismatch: packet=${packetValue || "missing"} live=${liveValue || "missing"}`);
}

export function admitHandoff({
  targetRoot,
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const packetPath = resolveTargetPath(absoluteTargetRoot, packetFile);
  const currentStatePath = resolveTargetPath(absoluteTargetRoot, currentStateFile);
  const runtimeStatePath = resolveTargetPath(absoluteTargetRoot, runtimeStateFile);

  const packetText = readRequired(packetPath);
  const currentStateText = readRequired(currentStatePath);
  const runtimeStateText = readRequired(runtimeStatePath);
  const packet = parseSimpleMap(packetText);
  const current = parseSimpleMap(currentStateText);
  const runtime = parseSimpleMap(runtimeStateText);
  const prioritizedArtifacts = parseListSection(packetText, "prioritized_artifacts");
  const consistency = evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot });
  const issues = [];
  const warnings = [];

  const handoffStatus = normalizeScalar(packet.get("handoff_status") ?? "unknown").toLowerCase();
  const consistencyStatus = normalizeScalar(packet.get("consistency_status") ?? "unknown").toLowerCase();
  const packetFreshness = normalizeScalar(packet.get("current_state_freshness") ?? "unknown").toLowerCase();
  const packetMode = normalizeScalar(packet.get("mode") ?? "unknown");
  const packetFromRole = normalizeAgentRole(packet.get("handoff_from_agent_role") ?? "");
  const packetFromAction = normalizeAgentAction(packet.get("handoff_from_agent_action") ?? "");
  const packetRole = normalizeAgentRole(packet.get("recommended_next_agent_role") ?? "");
  const packetAction = normalizeAgentAction(packet.get("recommended_next_agent_action") ?? "");
  const packetTransitionStatus = normalizeScalar(packet.get("transition_policy_status") ?? "unknown");
  const packetTransitionReason = normalizeScalar(packet.get("transition_policy_reason") ?? "unknown");
  const transition = evaluateAgentTransition({
    mode: packetMode,
    fromRole: packetFromRole,
    fromAction: packetFromAction,
    toRole: packetRole,
    toAction: packetAction,
  });

  if (handoffStatus === "blocked") {
    issues.push("handoff packet is blocked");
  }
  if (consistencyStatus === "fail") {
    issues.push("handoff packet captured failed current-state consistency");
  }
  if (packetFreshness === "stale") {
    issues.push("handoff packet reports stale current-state freshness");
  }
  if (consistency.pass === false) {
    issues.push("live current-state consistency failed");
  }
  if (!isKnownAgentRole(packetFromRole)) {
    issues.push(`unknown packet source role: ${packet.get("handoff_from_agent_role") ?? "missing"}`);
  }
  if (!isKnownAgentRole(packetRole)) {
    issues.push(`unknown packet role: ${packet.get("recommended_next_agent_role") ?? "missing"}`);
  }
  if (packetFromAction && !canAgentRolePerform(packetFromRole, packetFromAction)) {
    issues.push(`packet source role/action mismatch: role=${packetFromRole || "missing"} action=${packetFromAction}`);
  }
  if (packetAction && !canAgentRolePerform(packetRole, packetAction)) {
    issues.push(`packet role/action mismatch: role=${packetRole || "missing"} action=${packetAction}`);
  }
  if (!transition.allowed) {
    issues.push(`transition policy rejected handoff: ${transition.reason}`);
  }
  if (packetTransitionStatus && packetTransitionStatus !== "unknown" && packetTransitionStatus !== transition.status) {
    issues.push(`transition_policy_status mismatch: packet=${packetTransitionStatus} live=${transition.status}`);
  }
  if (packetTransitionReason && packetTransitionReason !== "unknown" && packetTransitionReason !== transition.reason) {
    warnings.push(`transition_policy_reason drift: packet=${packetTransitionReason} live=${transition.reason}`);
  }

  const currentChecks = [
    "mode",
    "branch_kind",
    "active_session",
    "active_cycle",
    "dor_state",
    "first_plan_step",
  ];
  for (const field of currentChecks) {
    const packetValue = normalizeScalar(packet.get(field) ?? "");
    const liveValue = normalizeScalar(current.get(field) ?? "");
    if (!packetValue || !liveValue || canonicalUnknown(packetValue) || canonicalUnknown(liveValue) || canonicalNone(packetValue) || canonicalNone(liveValue)) {
      continue;
    }
    if (packetValue !== liveValue) {
      addMismatch(issues, field, packetValue, liveValue);
    }
  }

  const runtimeChecks = [
    "runtime_state_mode",
    "repair_layer_status",
    "current_state_freshness",
  ];
  for (const field of runtimeChecks) {
    const packetValue = normalizeScalar(packet.get(field) ?? "");
    const liveValue = normalizeScalar(runtime.get(field) ?? "");
    if (!packetValue || !liveValue || canonicalUnknown(packetValue) || canonicalUnknown(liveValue)) {
      continue;
    }
    if (packetValue !== liveValue) {
      addMismatch(issues, field, packetValue, liveValue);
    }
  }

  const packetUpdatedAtMs = parseTimestamp(packet.get("updated_at") ?? "");
  const currentUpdatedAtMs = parseTimestamp(current.get("updated_at") ?? "");
  if (packetUpdatedAtMs !== null && currentUpdatedAtMs !== null && packetUpdatedAtMs < currentUpdatedAtMs) {
    issues.push("handoff packet is older than CURRENT-STATE.md");
  }

  const missingArtifacts = prioritizedArtifacts
    .filter(isConcreteArtifactPath)
    .filter((item) => !exists(resolveTargetPath(absoluteTargetRoot, item)));
  for (const item of missingArtifacts) {
    issues.push(`missing prioritized artifact: ${item}`);
  }

  if (handoffStatus === "refresh_required" && issues.length === 0) {
    warnings.push("handoff packet requires normal re-anchor before durable write");
  }

  let admissionStatus = "admitted";
  let admitted = true;
  let recommendedRole = packetRole || "coordinator";
  let recommendedAction = packetAction || "coordinate";
  if (issues.some((item) => item === "handoff packet is blocked")) {
    admissionStatus = "blocked";
    admitted = false;
    recommendedRole = "repair";
    recommendedAction = "repair";
  } else if (issues.length > 0) {
    admissionStatus = "rejected";
    admitted = false;
    recommendedRole = "coordinator";
    recommendedAction = "reanchor";
  } else if (handoffStatus === "refresh_required") {
    recommendedRole = "coordinator";
    recommendedAction = "reanchor";
  }

  return {
    target_root: absoluteTargetRoot,
    packet_file: packetPath,
    admission_status: admissionStatus,
    admitted,
    recommended_action: recommendedAction,
    recommended_next_agent_role: recommendedRole,
    next_agent_goal: normalizeScalar(packet.get("next_agent_goal") ?? "unknown") || "unknown",
    packet: Object.fromEntries(packet.entries()),
    transition_policy: transition,
    prioritized_artifacts: prioritizedArtifacts,
    consistency,
    issues,
    warnings,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = admitHandoff({
      targetRoot: args.target,
      packetFile: args.packetFile,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Handoff admit: ${result.admission_status}`);
      console.log(`- admitted=${result.admitted}`);
      console.log(`- recommended_action=${result.recommended_action}`);
      console.log(`- recommended_next_agent_role=${result.recommended_next_agent_role}`);
      console.log(`- next_agent_goal=${result.next_agent_goal}`);
      if (result.issues.length > 0) {
        console.log("- issues:");
        for (const issue of result.issues) {
          console.log(`  - ${issue}`);
        }
      }
      if (result.warnings.length > 0) {
        console.log("- warnings:");
        for (const warning of result.warnings) {
          console.log(`  - ${warning}`);
        }
      }
    }
    if (!result.admitted) {
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
