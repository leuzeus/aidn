#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import { canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateAgentTransition } from "../../src/core/agents/agent-transition-policy.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    currentStateFile: "docs/audit/CURRENT-STATE.md",
    runtimeStateFile: "docs/audit/RUNTIME-STATE.md",
    out: "docs/audit/HANDOFF-PACKET.md",
    nextAgentGoal: "",
    handoffNote: "",
    fromAgentRole: "",
    fromAgentAction: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-file") {
      args.currentStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-file") {
      args.runtimeStateFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--next-agent-goal") {
      args.nextAgentGoal = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--handoff-note") {
      args.handoffNote = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--from-agent-role") {
      args.fromAgentRole = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--from-agent-action") {
      args.fromAgentAction = String(argv[i + 1] ?? "").trim();
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

  if (!args.target || !args.out) {
    throw new Error("Missing required arguments");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target .");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target . --from-agent-role coordinator --from-agent-action relay --next-agent-goal \"reanchor and continue cycle validation\"");
  console.log("  node tools/runtime/project-handoff-packet.mjs --target tests/fixtures/repo-installed-core --json");
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

function readTextIfExists(filePath) {
  return exists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
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
        if (item && item.toLowerCase() !== "none") {
          items.push(item);
        }
      }
    }
  }
  return items;
}

function findSessionFile(auditRoot, sessionId) {
  if (!sessionId || canonicalNone(sessionId) || canonicalUnknown(sessionId)) {
    return null;
  }
  const sessionsDir = path.join(auditRoot, "sessions");
  if (!exists(sessionsDir)) {
    return null;
  }
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^S\d+.*\.md$/i.test(entry.name));
  const direct = entries.find((entry) => entry.name.startsWith(sessionId));
  return direct ? path.join(sessionsDir, direct.name) : null;
}

function findCycleStatus(auditRoot, cycleId) {
  if (!cycleId || canonicalNone(cycleId) || canonicalUnknown(cycleId)) {
    return null;
  }
  const cyclesDir = path.join(auditRoot, "cycles");
  if (!exists(cyclesDir)) {
    return null;
  }
  const entries = fs.readdirSync(cyclesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${cycleId}-`));
  for (const entry of entries) {
    const statusPath = path.join(cyclesDir, entry.name, "status.md");
    if (exists(statusPath)) {
      return statusPath;
    }
  }
  return null;
}

function uniqueItems(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeScalar(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function relativePath(root, filePath) {
  if (!filePath) {
    return "";
  }
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function deriveHandoffStatus({ consistency, runtimeMap, currentMap }) {
  const repairStatus = normalizeScalar(runtimeMap.get("repair_layer_status") ?? "unknown").toLowerCase();
  const freshness = normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown").toLowerCase();
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown").toLowerCase();
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none").toLowerCase();
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none").toLowerCase();
  if (repairStatus === "block") {
    return "blocked";
  }
  if (mode === "unknown" || (activeSession === "none" && activeCycle === "none")) {
    return "refresh_required";
  }
  if (freshness === "stale" || consistency.pass === false) {
    return "refresh_required";
  }
  return "ready";
}

function deriveNextAgentRouting({ handoffStatus, mode, repairStatus }) {
  const normalizedRepair = String(repairStatus ?? "").trim().toLowerCase();
  if (handoffStatus === "blocked" || normalizedRepair === "block" || normalizedRepair === "repair") {
    return { role: "repair", action: "repair" };
  }
  if (normalizedRepair === "audit-first") {
    return { role: "auditor", action: "audit" };
  }
  if (handoffStatus === "refresh_required") {
    return { role: "coordinator", action: "reanchor" };
  }
  if (mode === "COMMITTING") {
    return { role: "executor", action: "implement" };
  }
  if (mode === "EXPLORING") {
    return { role: "auditor", action: "analyze" };
  }
  return { role: "coordinator", action: "coordinate" };
}

function deriveNextAgentGoal({ explicitGoal, handoffStatus, mode, repairStatus, repairAdvice, firstPlanStep, blockingFindings }) {
  const manualGoal = normalizeScalar(explicitGoal);
  if (manualGoal) {
    return manualGoal;
  }
  if (handoffStatus === "blocked" || repairStatus === "block" || repairStatus === "repair") {
    const topFinding = normalizeScalar(blockingFindings[0] ?? "");
    if (topFinding) {
      return `resolve blocking finding: ${topFinding}`;
    }
    return "resolve blocking repair-layer or workflow findings before continuing";
  }
  if (repairStatus === "audit-first") {
    const normalizedAdvice = normalizeScalar(repairAdvice);
    if (normalizedAdvice && normalizedAdvice.toLowerCase() !== "unknown") {
      return `review runtime warnings first: ${normalizedAdvice}`;
    }
    return "review runtime warnings and validate the relay before implementation";
  }
  if (handoffStatus === "refresh_required") {
    return "reanchor current session, cycle, and runtime facts before any durable write";
  }
  if (mode === "COMMITTING" && firstPlanStep && !canonicalUnknown(firstPlanStep) && !canonicalNone(firstPlanStep)) {
    return firstPlanStep;
  }
  if (mode === "EXPLORING") {
    return "continue analysis and validate the next hypothesis before durable write";
  }
  if (mode === "THINKING") {
    return "restate the objective, active constraints, and the smallest compliant next step";
  }
  return "reload the prioritized artifacts and choose the next compliant action";
}

function buildPrioritizedArtifacts({ targetRoot, runtimeStateText, sessionFile, cycleStatus, currentMap }) {
  const items = [
    "docs/audit/CURRENT-STATE.md",
    "docs/audit/WORKFLOW-KERNEL.md",
    "docs/audit/RUNTIME-STATE.md",
    "docs/audit/WORKFLOW_SUMMARY.md",
  ];
  const runtimeArtifacts = parseListSection(runtimeStateText, "prioritized_artifacts");
  const firstPlanStep = normalizeScalar(currentMap.get("first_plan_step") ?? "");
  if (sessionFile) {
    items.push(relativePath(targetRoot, sessionFile));
  }
  if (cycleStatus) {
    items.push(relativePath(targetRoot, cycleStatus));
    const planPath = path.join(path.dirname(cycleStatus), "plan.md");
    if (firstPlanStep && exists(planPath)) {
      items.push(relativePath(targetRoot, planPath));
    }
  }
  return uniqueItems([...items, ...runtimeArtifacts]);
}

function deriveDispatchScope({ currentMap, nextRouting }) {
  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sessionBranch = normalizeScalar(currentMap.get("session_branch") ?? "none") || "none";
  const cycleBranch = normalizeScalar(currentMap.get("cycle_branch") ?? "none") || "none";
  if (!canonicalNone(activeCycle) && !canonicalUnknown(activeCycle)) {
    return {
      scope_type: "cycle",
      scope_id: activeCycle,
      target_branch: !canonicalNone(cycleBranch) && !canonicalUnknown(cycleBranch) ? cycleBranch : "none",
    };
  }
  if (!canonicalNone(activeSession) && !canonicalUnknown(activeSession)) {
    return {
      scope_type: "session",
      scope_id: activeSession,
      target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
    };
  }
  if (nextRouting.role === "coordinator") {
    return {
      scope_type: "session",
      scope_id: !canonicalNone(activeSession) && !canonicalUnknown(activeSession) ? activeSession : "none",
      target_branch: !canonicalNone(sessionBranch) && !canonicalUnknown(sessionBranch) ? sessionBranch : "none",
    };
  }
  return {
    scope_type: "none",
    scope_id: "none",
    target_branch: "none",
  };
}

function buildMarkdown(packet) {
  const lines = [];
  lines.push("# Handoff Packet");
  lines.push("");
  lines.push("Purpose:");
  lines.push("");
  lines.push("- provide a short, deterministic handoff digest between agents");
  lines.push("- reduce restart cost for long sessions or multi-window work");
  lines.push("- point the next agent to the minimum artifact set before acting");
  lines.push("");
  lines.push("Rule/State boundary:");
  lines.push("");
  lines.push("- this file is a state digest, not a canonical workflow rules file");
  lines.push("- keep canonical workflow rules in `docs/audit/SPEC.md`");
  lines.push("- keep local policy extensions in `docs/audit/WORKFLOW.md`");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`updated_at: ${packet.updated_at}`);
  lines.push(`handoff_status: ${packet.handoff_status}`);
  lines.push(`handoff_from_agent_role: ${packet.handoff_from_agent_role}`);
  lines.push(`handoff_from_agent_action: ${packet.handoff_from_agent_action}`);
  lines.push(`recommended_next_agent_role: ${packet.recommended_next_agent_role}`);
  lines.push(`recommended_next_agent_action: ${packet.recommended_next_agent_action}`);
  lines.push(`next_agent_goal: ${packet.next_agent_goal}`);
  lines.push(`scope_type: ${packet.scope_type}`);
  lines.push(`scope_id: ${packet.scope_id}`);
  lines.push(`target_branch: ${packet.target_branch}`);
  lines.push(`transition_policy_status: ${packet.transition_policy_status}`);
  lines.push(`transition_policy_reason: ${packet.transition_policy_reason}`);
  lines.push("");
  lines.push("## Active Context");
  lines.push("");
  lines.push(`mode: ${packet.mode}`);
  lines.push(`branch_kind: ${packet.branch_kind}`);
  lines.push(`active_session: ${packet.active_session}`);
  lines.push(`active_cycle: ${packet.active_cycle}`);
  lines.push(`dor_state: ${packet.dor_state}`);
  lines.push(`first_plan_step: ${packet.first_plan_step}`);
  lines.push("");
  lines.push("## Runtime Signals");
  lines.push("");
  lines.push(`runtime_state_mode: ${packet.runtime_state_mode}`);
  lines.push(`repair_layer_status: ${packet.repair_layer_status}`);
  lines.push(`repair_routing_hint: ${packet.repair_routing_hint}`);
  lines.push(`current_state_freshness: ${packet.current_state_freshness}`);
  lines.push("");
  lines.push("## Blocking Findings");
  lines.push("");
  lines.push("blocking_findings:");
  if (packet.blocking_findings.length === 0) {
    lines.push("- none");
  } else {
    for (const item of packet.blocking_findings) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## Prioritized Reads");
  lines.push("");
  lines.push("prioritized_artifacts:");
  for (const item of packet.prioritized_artifacts) {
    lines.push(`- \`${item}\``);
  }
  lines.push("");
  lines.push("## Handoff Guidance");
  lines.push("");
  lines.push("- `ready`: the next agent can resume from the prioritized artifacts and restate the workflow context before writing");
  lines.push("- `refresh_required`: the next agent must reload session/cycle facts before any durable write");
  lines.push("- `blocked`: the next agent must resolve runtime blocking findings or workflow contradictions before continuing");
  lines.push("");
  lines.push("## Handoff Intent");
  lines.push("");
  lines.push(`handoff_note: ${packet.handoff_note}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`- Current-state consistency: ${packet.consistency_status}`);
  lines.push(`- Session file: ${packet.session_file}`);
  lines.push(`- Cycle status: ${packet.cycle_status_file}`);
  lines.push("- Refresh this packet after significant session/cycle state changes when work is likely to continue in another agent.");
  lines.push("- In `dual` / `db-only`, refresh this packet after refreshing `docs/audit/RUNTIME-STATE.md`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function projectHandoffPacket({
  targetRoot,
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  out = "docs/audit/HANDOFF-PACKET.md",
  nextAgentGoal = "",
  handoffNote = "",
  fromAgentRole = "",
  fromAgentAction = "",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const currentStatePath = resolveTargetPath(absoluteTargetRoot, currentStateFile);
  const runtimeStatePath = resolveTargetPath(absoluteTargetRoot, runtimeStateFile);
  const currentStateText = readTextIfExists(currentStatePath);
  const runtimeStateText = readTextIfExists(runtimeStatePath);
  const currentMap = parseSimpleMap(currentStateText);
  const runtimeMap = parseSimpleMap(runtimeStateText);
  const consistency = evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot });

  const activeSession = normalizeScalar(currentMap.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(currentMap.get("active_cycle") ?? "none") || "none";
  const sessionFile = findSessionFile(auditRoot, activeSession);
  const cycleStatus = findCycleStatus(auditRoot, activeCycle);
  const repairStatus = normalizeScalar(runtimeMap.get("repair_layer_status") ?? "unknown") || "unknown";
  const repairRoutingHint = normalizeScalar(runtimeMap.get("repair_routing_hint") ?? repairStatus) || "unknown";
  const repairRoutingReason = normalizeScalar(runtimeMap.get("repair_routing_reason") ?? runtimeMap.get("repair_layer_advice") ?? "unknown") || "unknown";
  const handoffStatus = deriveHandoffStatus({ consistency, runtimeMap, currentMap });
  const mode = normalizeScalar(currentMap.get("mode") ?? "unknown") || "unknown";
  const firstPlanStep = normalizeScalar(currentMap.get("first_plan_step") ?? "unknown") || "unknown";
  const blockingFindings = uniqueItems(parseListSection(runtimeStateText, "blocking_findings").slice(0, 5));
  const nextRouting = deriveNextAgentRouting({
    handoffStatus,
    mode,
    repairStatus: repairRoutingHint,
  });
  const handoffFromAgentRole = normalizeScalar(fromAgentRole) || "coordinator";
  const handoffFromAgentAction = normalizeScalar(fromAgentAction) || "relay";
  const transition = evaluateAgentTransition({
    mode,
    fromRole: handoffFromAgentRole,
    fromAction: handoffFromAgentAction,
    toRole: nextRouting.role,
    toAction: nextRouting.action,
  });
  const scope = deriveDispatchScope({ currentMap, nextRouting });

  const packet = {
    updated_at: new Date().toISOString(),
    handoff_status: handoffStatus,
    handoff_from_agent_role: handoffFromAgentRole,
    handoff_from_agent_action: handoffFromAgentAction,
    recommended_next_agent_role: nextRouting.role,
    recommended_next_agent_action: nextRouting.action,
    next_agent_goal: deriveNextAgentGoal({
      explicitGoal: nextAgentGoal,
      handoffStatus,
      mode,
      repairStatus: repairRoutingHint,
      repairAdvice: repairRoutingReason,
      firstPlanStep,
      blockingFindings,
    }),
    scope_type: scope.scope_type,
    scope_id: scope.scope_id,
    target_branch: scope.target_branch,
    handoff_note: normalizeScalar(handoffNote) || "none",
    mode,
    branch_kind: normalizeScalar(currentMap.get("branch_kind") ?? "unknown") || "unknown",
    active_session: activeSession,
    active_cycle: activeCycle,
    dor_state: normalizeScalar(currentMap.get("dor_state") ?? "unknown") || "unknown",
    first_plan_step: firstPlanStep,
    runtime_state_mode: normalizeScalar(runtimeMap.get("runtime_state_mode") ?? currentMap.get("runtime_state_mode") ?? "unknown") || "unknown",
    repair_layer_status: repairStatus,
    repair_routing_hint: repairRoutingHint,
    current_state_freshness: normalizeScalar(runtimeMap.get("current_state_freshness") ?? "unknown") || "unknown",
    transition_policy_status: transition.status,
    transition_policy_reason: transition.reason,
    blocking_findings: blockingFindings,
    prioritized_artifacts: buildPrioritizedArtifacts({ targetRoot: absoluteTargetRoot, runtimeStateText, sessionFile, cycleStatus, currentMap }),
    consistency_status: consistency.pass ? "pass" : "fail",
    session_file: sessionFile ? relativePath(absoluteTargetRoot, sessionFile) : "none",
    cycle_status_file: cycleStatus ? relativePath(absoluteTargetRoot, cycleStatus) : "none",
  };

  if (!canAgentRolePerform(packet.recommended_next_agent_role, packet.recommended_next_agent_action)) {
    throw new Error(`Invalid handoff routing: role=${packet.recommended_next_agent_role} action=${packet.recommended_next_agent_action}`);
  }

  if (packet.blocking_findings.length === 0 && packet.handoff_status === "blocked") {
    packet.blocking_findings.push("runtime or workflow blocking condition detected without detailed finding list");
  }

  const markdown = buildMarkdown(packet);
  const outWrite = writeUtf8IfChanged(resolveTargetPath(absoluteTargetRoot, out), markdown);
  return {
    target_root: absoluteTargetRoot,
    output_file: outWrite.path,
    written: outWrite.written,
    packet,
    consistency,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const output = projectHandoffPacket({
      targetRoot: args.target,
      currentStateFile: args.currentStateFile,
      runtimeStateFile: args.runtimeStateFile,
      out: args.out,
      nextAgentGoal: args.nextAgentGoal,
      handoffNote: args.handoffNote,
      fromAgentRole: args.fromAgentRole,
      fromAgentAction: args.fromAgentAction,
    });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Handoff packet: ${output.output_file} (${output.written ? "written" : "unchanged"})`);
      console.log(`- handoff_status=${output.packet.handoff_status}`);
      console.log(`- handoff_from_agent_role=${output.packet.handoff_from_agent_role}`);
      console.log(`- handoff_from_agent_action=${output.packet.handoff_from_agent_action}`);
      console.log(`- recommended_next_agent_role=${output.packet.recommended_next_agent_role}`);
      console.log(`- recommended_next_agent_action=${output.packet.recommended_next_agent_action}`);
      console.log(`- scope=${output.packet.scope_type}:${output.packet.scope_id}`);
      console.log(`- transition_policy_status=${output.packet.transition_policy_status}`);
      console.log(`- next_agent_goal=${output.packet.next_agent_goal}`);
      console.log(`- active_session=${output.packet.active_session}`);
      console.log(`- active_cycle=${output.packet.active_cycle}`);
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
