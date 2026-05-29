#!/usr/bin/env node
import {
  buildCoordinatorAgentCandidateEntry,
  buildCoordinatorSelectAgentResult,
} from "../../src/application/runtime/coordinator-select-agent-use-case.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRankingEntry() {
  return {
    score: 120,
    profile: {
      id: "codex-auditor",
      label: "Codex Auditor",
      default_role: "auditor",
      supported_roles: ["auditor"],
    },
  };
}

function verifyCandidateEntry() {
  const entry = buildCoordinatorAgentCandidateEntry(
    buildRankingEntry(),
    {
      agents: {
        "codex-auditor": {
          enabled: true,
          priority: 40,
          roles: ["auditor"],
          adapter_module: "",
        },
      },
    },
    {
      "codex-auditor": {
        health_status: "ready",
        health_reason: "adapter is healthy",
      },
    },
  );
  assert(entry.id === "codex-auditor", "candidate entry should preserve adapter id");
  assert(entry.roster_priority === 40, "candidate entry should preserve roster priority");
  assert(entry.health_status === "ready", "candidate entry should preserve health status");
}

function verifyResultAssembly() {
  const result = buildCoordinatorSelectAgentResult({
    absoluteTargetRoot: "G:/fixture/project",
    effectiveStateMode: "dual",
    dbBackedMode: false,
    requestedAgent: "AUTO",
    normalizedRole: "auditor",
    normalizedAction: "audit",
    roster: {
      found: true,
      file_path: "docs/audit/AGENT-ROSTER.md",
      default_requested_agent: "auto",
    },
    rosterVerification: {
      pass: true,
      issues: [],
      warnings: [],
    },
    selection: {
      status: "selected",
      selected_profile: {
        id: "codex-auditor",
      },
      reason: "best ranked healthy adapter",
    },
    ranking: [buildRankingEntry()],
    adapterHealth: {
      "codex-auditor": {
        health_status: "ready",
        health_reason: "adapter is healthy",
      },
    },
  });
  assert(result.requested_agent === "auto", "result assembly should normalize requested agent");
  assert(result.selection.selected_agent === "codex-auditor", "result assembly should preserve selected agent");
  assert(Array.isArray(result.candidates) && result.candidates.length === 1, "result assembly should preserve ranked candidates");
}

function main() {
  try {
    verifyCandidateEntry();
    verifyResultAssembly();
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
