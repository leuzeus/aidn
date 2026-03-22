#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runHydrateContextUseCase } from "../../src/application/codex/hydrate-context-use-case.mjs";
import { projectAgentHealthSummary } from "../runtime/project-agent-health-summary.mjs";
import { projectAgentSelectionSummary } from "../runtime/project-agent-selection-summary.mjs";
import { projectHandoffPacket } from "../runtime/project-handoff-packet.mjs";
import { projectMultiAgentStatus } from "../runtime/project-multi-agent-status.mjs";
import { projectRuntimeState } from "../runtime/project-runtime-state.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: ".aidn/runtime/context/hydrated-context.json",
    skill: "",
    historyLimit: 20,
    includeArtifacts: true,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    maxArtifactBytes: 4096,
    minRelationConfidence: 0.65,
    relationThresholds: {},
    allowAmbiguousLinks: false,
    projectRuntimeState: null,
    runtimeStateOut: "docs/audit/RUNTIME-STATE.md",
    projectHandoffPacket: null,
    handoffPacketOut: "docs/audit/HANDOFF-PACKET.md",
    projectAgentSelectionSummary: null,
    agentSelectionSummaryOut: "docs/audit/AGENT-SELECTION-SUMMARY.md",
    projectAgentHealthSummary: null,
    agentHealthSummaryOut: "docs/audit/AGENT-HEALTH-SUMMARY.md",
    projectMultiAgentStatus: null,
    multiAgentStatusOut: "docs/audit/MULTI-AGENT-STATUS.md",
    handoffNextAgentGoal: "",
    handoffNote: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--context-file") {
      args.contextFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--skill") {
      args.skill = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--history-limit") {
      args.historyLimit = Number(argv[i + 1] ?? 20);
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--max-artifact-bytes") {
      args.maxArtifactBytes = Number(argv[i + 1] ?? 4096);
      i += 1;
    } else if (token === "--min-relation-confidence") {
      args.minRelationConfidence = Number(argv[i + 1] ?? 0.65);
      i += 1;
    } else if (token === "--relation-threshold") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      const [relationType, value] = raw.split("=", 2);
      const key = String(relationType ?? "").trim();
      const n = Number(value);
      if (!key || !Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error("Invalid --relation-threshold. Expected relation=value with value between 0 and 1.");
      }
      args.relationThresholds[key] = n;
    } else if (token === "--allow-ambiguous-links") {
      args.allowAmbiguousLinks = true;
    } else if (token === "--project-runtime-state") {
      args.projectRuntimeState = true;
    } else if (token === "--no-project-runtime-state") {
      args.projectRuntimeState = false;
    } else if (token === "--runtime-state-out") {
      args.runtimeStateOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--project-handoff-packet") {
      args.projectHandoffPacket = true;
    } else if (token === "--no-project-handoff-packet") {
      args.projectHandoffPacket = false;
    } else if (token === "--handoff-packet-out") {
      args.handoffPacketOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--project-agent-selection-summary") {
      args.projectAgentSelectionSummary = true;
    } else if (token === "--no-project-agent-selection-summary") {
      args.projectAgentSelectionSummary = false;
    } else if (token === "--agent-selection-summary-out") {
      args.agentSelectionSummaryOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--project-agent-health-summary") {
      args.projectAgentHealthSummary = true;
    } else if (token === "--no-project-agent-health-summary") {
      args.projectAgentHealthSummary = false;
    } else if (token === "--agent-health-summary-out") {
      args.agentHealthSummaryOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--project-multi-agent-status") {
      args.projectMultiAgentStatus = true;
    } else if (token === "--no-project-multi-agent-status") {
      args.projectMultiAgentStatus = false;
    } else if (token === "--multi-agent-status-out") {
      args.multiAgentStatusOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--handoff-next-agent-goal") {
      args.handoffNextAgentGoal = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--handoff-note") {
      args.handoffNote = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--no-artifacts") {
      args.includeArtifacts = false;
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
  if (!args.contextFile) {
    throw new Error("Missing value for --context-file");
  }
  if (!Number.isFinite(args.historyLimit) || args.historyLimit < 1) {
    throw new Error("Invalid --history-limit. Expected a positive integer.");
  }
  if (!["auto", "json", "sqlite"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite");
  }
  if (!Number.isFinite(args.maxArtifactBytes) || args.maxArtifactBytes < 128) {
    throw new Error("Invalid --max-artifact-bytes. Expected at least 128.");
  }
  if (!Number.isFinite(args.minRelationConfidence) || args.minRelationConfidence < 0 || args.minRelationConfidence > 1) {
    throw new Error("Invalid --min-relation-confidence. Expected a number between 0 and 1.");
  }
  return args;
}

function shouldProjectRuntimeState(args, hydrated, targetRoot) {
  if (args.projectRuntimeState === true) {
    return true;
  }
  if (args.projectRuntimeState === false) {
    return false;
  }
  const stateMode = String(hydrated?.state_mode ?? "").trim().toLowerCase();
  if (!["dual", "db-only"].includes(stateMode)) {
    return false;
  }
  return true;
}

function shouldProjectHandoffPacket(args, hydrated, targetRoot) {
  if (args.projectHandoffPacket === true) {
    return true;
  }
  if (args.projectHandoffPacket === false) {
    return false;
  }
  const stateMode = String(hydrated?.state_mode ?? "").trim().toLowerCase();
  if (!["dual", "db-only"].includes(stateMode)) {
    return false;
  }
  return true;
}

function shouldProjectAgentSelectionSummary(args, hydrated, targetRoot) {
  if (args.projectAgentSelectionSummary === true) {
    return true;
  }
  if (args.projectAgentSelectionSummary === false) {
    return false;
  }
  const stateMode = String(hydrated?.state_mode ?? "").trim().toLowerCase();
  if (["dual", "db-only"].includes(stateMode)) {
    return true;
  }
  const summaryFile = path.resolve(targetRoot, args.agentSelectionSummaryOut);
  return fs.existsSync(summaryFile);
}

function shouldProjectAgentHealthSummary(args, hydrated, targetRoot) {
  if (args.projectAgentHealthSummary === true) {
    return true;
  }
  if (args.projectAgentHealthSummary === false) {
    return false;
  }
  const stateMode = String(hydrated?.state_mode ?? "").trim().toLowerCase();
  if (["dual", "db-only"].includes(stateMode)) {
    return true;
  }
  const summaryFile = path.resolve(targetRoot, args.agentHealthSummaryOut);
  return fs.existsSync(summaryFile);
}

function shouldProjectMultiAgentStatus(args, hydrated, targetRoot) {
  if (args.projectMultiAgentStatus === true) {
    return true;
  }
  if (args.projectMultiAgentStatus === false) {
    return false;
  }
  const stateMode = String(hydrated?.state_mode ?? "").trim().toLowerCase();
  if (["dual", "db-only"].includes(stateMode)) {
    return true;
  }
  const summaryFile = path.resolve(targetRoot, args.multiAgentStatusOut);
  return fs.existsSync(summaryFile);
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex hydrate-context --target . --json");
  console.log("  npx aidn codex hydrate-context --target . --skill context-reload --history-limit 10");
  console.log("  npx aidn codex hydrate-context --target . --skill start-session --project-runtime-state --json");
  console.log("  npx aidn codex hydrate-context --target . --skill start-session --project-runtime-state --project-handoff-packet --project-agent-health-summary --project-agent-selection-summary --project-multi-agent-status --json");
  console.log("  npx aidn codex hydrate-context --target . --skill handoff-close --project-runtime-state --project-handoff-packet --project-agent-health-summary --project-agent-selection-summary --project-multi-agent-status --handoff-next-agent-goal \"reanchor and continue validation\" --json");
  console.log("  npx aidn codex hydrate-context --target . --skill context-reload --no-project-runtime-state --no-project-handoff-packet --no-project-agent-health-summary --no-project-agent-selection-summary --no-project-multi-agent-status --json");
  console.log("  npx aidn codex hydrate-context --target . --relation-threshold attached_cycle=0.35 --allow-ambiguous-links --json");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const hookContextStore = createHookContextStoreAdapter();
    const targetRoot = path.resolve(process.cwd(), args.target);
    const hydrated = runHydrateContextUseCase({
      args,
      hookContextStore,
      targetRoot,
    });
    let runtimeState = null;
    let handoffPacket = null;
    let agentHealthSummary = null;
    let agentSelectionSummary = null;
    let multiAgentStatus = null;
    if (shouldProjectRuntimeState(args, hydrated, targetRoot)) {
      runtimeState = projectRuntimeState({
        targetRoot,
        hydratedFile: args.out,
        contextFile: args.contextFile,
        out: args.runtimeStateOut,
      });
      hydrated.runtime_state = {
        output_file: runtimeState.output_file,
        written: runtimeState.written,
        digest: runtimeState.digest,
        mode: args.projectRuntimeState === true ? "forced" : "auto",
      };
    }
    if (shouldProjectAgentHealthSummary(args, hydrated, targetRoot)) {
      agentHealthSummary = await projectAgentHealthSummary({
        targetRoot,
        out: args.agentHealthSummaryOut,
      });
      hydrated.agent_health_summary = {
        output_file: agentHealthSummary.output_file,
        written: agentHealthSummary.written,
        verification: {
          pass: agentHealthSummary.verification.pass,
          issues: agentHealthSummary.verification.issues,
          warnings: agentHealthSummary.verification.warnings,
        },
        mode: args.projectAgentHealthSummary === true ? "forced" : "auto",
      };
    }
    if (shouldProjectAgentSelectionSummary(args, hydrated, targetRoot)) {
      agentSelectionSummary = await projectAgentSelectionSummary({
        targetRoot,
        out: args.agentSelectionSummaryOut,
      });
      hydrated.agent_selection_summary = {
        output_file: agentSelectionSummary.out_file,
        written: agentSelectionSummary.written,
        summary: agentSelectionSummary.summary,
        mode: args.projectAgentSelectionSummary === true ? "forced" : "auto",
      };
    }
    if (shouldProjectHandoffPacket(args, hydrated, targetRoot)) {
      handoffPacket = projectHandoffPacket({
        targetRoot,
        currentStateFile: "docs/audit/CURRENT-STATE.md",
        runtimeStateFile: args.runtimeStateOut,
        out: args.handoffPacketOut,
        nextAgentGoal: args.handoffNextAgentGoal,
        handoffNote: args.handoffNote,
      });
      hydrated.handoff_packet = {
        output_file: handoffPacket.output_file,
        written: handoffPacket.written,
        packet: handoffPacket.packet,
        mode: args.projectHandoffPacket === true ? "forced" : "auto",
      };
    }
    if (shouldProjectMultiAgentStatus(args, hydrated, targetRoot)) {
      multiAgentStatus = await projectMultiAgentStatus({
        targetRoot,
        out: args.multiAgentStatusOut,
      });
      hydrated.multi_agent_status = {
        output_file: multiAgentStatus.output_file,
        written: multiAgentStatus.written,
        recommendation: multiAgentStatus.coordinator.recommendation,
        roster_verification: multiAgentStatus.roster_verification,
        mode: args.projectMultiAgentStatus === true ? "forced" : "auto",
      };
    }

    if (args.json) {
      console.log(JSON.stringify(hydrated, null, 2));
    } else {
      console.log(`Hydrated context: state_mode=${hydrated.state_mode} history=${hydrated.recent_history.length} artifacts=${hydrated.artifacts.length}`);
      if (hydrated.output_file) {
        console.log(`Output: ${hydrated.output_file}`);
      }
      if (runtimeState?.output_file) {
        console.log(`Runtime state: ${runtimeState.output_file}`);
      }
      if (agentHealthSummary?.output_file) {
        console.log(`Agent health summary: ${agentHealthSummary.output_file}`);
      }
      if (agentSelectionSummary?.out_file) {
        console.log(`Agent selection summary: ${agentSelectionSummary.out_file}`);
      }
      if (handoffPacket?.output_file) {
        console.log(`Handoff packet: ${handoffPacket.output_file}`);
      }
      if (multiAgentStatus?.output_file) {
        console.log(`Multi-agent status: ${multiAgentStatus.output_file}`);
      }
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
