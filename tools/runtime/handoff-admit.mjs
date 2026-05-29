#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateHandoffAdmission } from "../../src/application/runtime/handoff-admit-use-case.mjs";
import { readLatestSharedHandoffRelay, resolveSharedCoordinationStore } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { validateSharedRuntimeContext } from "../../src/application/runtime/shared-runtime-validation-service.mjs";
import { canAgentRolePerform, isKnownAgentRole, normalizeAgentAction, normalizeAgentRole } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateAgentTransition } from "../../src/core/agents/agent-transition-policy.mjs";
import { evaluateCurrentStateConsistency } from "../perf/verify-current-state-consistency.mjs";
import {
  buildVirtualCurrentStateConsistency,
  loadDbIndexPayloadSafe,
  normalizeScalar,
  parseSimpleMap,
  resolveDbArtifactSourceName,
  resolveAuditArtifactText,
  resolveCycleStatusArtifact,
  resolveDbBackedMode,
} from "./db-first-runtime-view-lib.mjs";
import {
  buildSharedRelayHandoff,
  derivePacketResolution,
  readPacketSummary,
  readSharedRelaySummary,
} from "./shared-handoff-relay-resolution-lib.mjs";

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

export async function admitHandoff({
  targetRoot,
  packetFile = "docs/audit/HANDOFF-PACKET.md",
  currentStateFile = "docs/audit/CURRENT-STATE.md",
  runtimeStateFile = "docs/audit/RUNTIME-STATE.md",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
  sharedStateOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const sqliteFallback = dbBackedMode ? await loadDbIndexPayloadSafe(absoluteTargetRoot, sharedStateOptions) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  const dbSource = resolveDbArtifactSourceName(sqliteFallback.backend);
  const packetResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: packetFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const currentStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: currentStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  const runtimeStateResolution = resolveAuditArtifactText({
    targetRoot: absoluteTargetRoot,
    candidatePath: runtimeStateFile,
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
    dbSource,
  });
  if (!currentStateResolution.exists) {
    throw new Error(`Missing file: ${resolveTargetPath(absoluteTargetRoot, currentStateFile)}`);
  }
  if (!runtimeStateResolution.exists) {
    throw new Error(`Missing file: ${resolveTargetPath(absoluteTargetRoot, runtimeStateFile)}`);
  }

  const currentStateText = currentStateResolution.text;
  const runtimeStateText = runtimeStateResolution.text;
  const current = parseSimpleMap(currentStateText);
  const runtime = parseSimpleMap(runtimeStateText);
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const sharedRuntimeValidation = validateSharedRuntimeContext({
    targetRoot: absoluteTargetRoot,
    workspace,
  });
  const sharedCoordinationResolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace,
    ...sharedCoordinationOptions,
  });
  const activeSession = normalizeScalar(current.get("active_session") ?? "none") || "none";
  const activeCycle = normalizeScalar(current.get("active_cycle") ?? "none") || "none";
  const sharedRelayRead = await readLatestSharedHandoffRelay(sharedCoordinationResolution, {
    workspace,
    sessionId: activeSession !== "none" ? activeSession : "",
    scopeType: activeCycle !== "none" ? "cycle" : "",
    scopeId: activeCycle !== "none" ? activeCycle : "",
  });
  const sharedRelay = sharedRelayRead.handoff_relay ?? null;
  const packetResolutionInfo = derivePacketResolution(
    readPacketSummary(packetResolution),
    readSharedRelaySummary(sharedRelay),
  );
  const packetSource = packetResolutionInfo.selected_source === "shared-coordination"
    ? "shared-coordination"
    : packetResolution.source;
  const handoffPacket = packetResolutionInfo.selected_source === "shared-coordination"
    ? buildSharedRelayHandoff(sharedRelay)
    : null;
  if (!packetResolution.exists && !handoffPacket) {
    throw new Error(`Missing file: ${resolveTargetPath(absoluteTargetRoot, packetFile)}`);
  }
  const packet = handoffPacket
    ? new Map(Object.entries(handoffPacket.packet))
    : parseSimpleMap(packetResolution.text);
  const prioritizedArtifacts = handoffPacket
    ? (handoffPacket.packet.prioritized_artifacts ?? [])
    : parseListSection(packetResolution.text, "prioritized_artifacts");
  const cycleStatusResolution = resolveCycleStatusArtifact({
    targetRoot: absoluteTargetRoot,
    auditRoot: path.join(absoluteTargetRoot, "docs", "audit"),
    cycleId: normalizeScalar(current.get("active_cycle") ?? "none") || "none",
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    dbSource,
  });
  const consistency = currentStateResolution.source === "file"
    ? evaluateCurrentStateConsistency({ targetRoot: absoluteTargetRoot })
    : buildVirtualCurrentStateConsistency({
      currentStateResolution,
      activeCycle: normalizeScalar(current.get("active_cycle") ?? "none") || "none",
      activeSession: normalizeScalar(current.get("active_session") ?? "none") || "none",
      cycleStatusResolution,
    });
  const preferredDispatchSource = normalizeScalar(packet.get("preferred_dispatch_source") ?? "workflow") || "workflow";
  const packetActiveBacklog = normalizeScalar(packet.get("active_backlog") ?? packet.get("backlog_refs") ?? "none") || "none";
  const sharedPlanningFreshness = normalizeScalar(packet.get("shared_planning_freshness") ?? "not_applicable") || "not_applicable";
  const sharedPlanningGateStatus = normalizeScalar(packet.get("shared_planning_gate_status") ?? "not_applicable") || "not_applicable";
  const sharedPlanningGateReason = normalizeScalar(packet.get("shared_planning_gate_reason") ?? "none") || "none";
  const result = evaluateHandoffAdmission({
    packet,
    current,
    runtime,
    prioritizedArtifacts,
    handoffPacket,
    packetActiveBacklog,
    preferredDispatchSource,
    sharedPlanningFreshness,
    sharedPlanningGateStatus,
    sharedPlanningGateReason,
    packetSource,
    packetResolutionInfo,
    workspace,
    sharedStateBackend: sqliteFallback.backend ?? null,
    sharedRuntimeValidation,
    transitionEvaluator: evaluateAgentTransition,
    consistency,
    effectiveStateMode,
    dbBackedMode,
    packetFile: packetResolution.logicalPath,
    packetRef: normalizeScalar(sharedRelay?.handoff_packet_ref) || "shared-coordination://handoff_relays",
    currentStateSource: currentStateResolution.source,
    runtimeStateSource: runtimeStateResolution.source,
    artifactExists(item) {
      const normalizedItem = String(item).replace(/\\/g, "/");
      if (String(item).replace(/\\/g, "/").startsWith("docs/audit/")) {
        return resolveAuditArtifactText({
          targetRoot: absoluteTargetRoot,
          candidatePath: normalizedItem,
          dbBacked: dbBackedMode,
          sqlitePayload: sqliteFallback.payload,
          sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
          dbSource,
        }).exists;
      }
      return fs.existsSync(resolveTargetPath(absoluteTargetRoot, normalizedItem));
    },
    canAgentRolePerform,
    isKnownAgentRole,
    normalizeAgentRole,
    normalizeAgentAction,
  });
  return {
    target_root: absoluteTargetRoot,
    ...result,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await admitHandoff({
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
      console.log(`- scope=${result.scope_type}:${result.scope_id}`);
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
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
