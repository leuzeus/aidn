#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRequestedAgentAction, normalizeRequestedAgentRole } from "../../src/core/ports/agent-adapter-port.mjs";
import { rankAgentAdapters, selectAgentAdapter } from "../../src/core/agents/agent-selection-policy.mjs";
import { loadRegisteredAgentAdapters } from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { buildAgentHealthMap, verifyAgentRoster } from "./verify-agent-roster.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    agent: "auto",
    role: "",
    action: "",
    rosterFile: "docs/audit/AGENT-ROSTER.md",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--agent") {
      args.agent = String(argv[index + 1] ?? "").trim().toLowerCase();
      index += 1;
    } else if (token === "--role") {
      args.role = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--action") {
      args.action = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--roster-file") {
      args.rosterFile = String(argv[index + 1] ?? "").trim();
      index += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.role || !args.action) {
    throw new Error("Missing required values for --target, --role, or --action");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/coordinator-select-agent.mjs --target . --role auditor --action audit");
  console.log("  node tools/runtime/coordinator-select-agent.mjs --target . --role repair --action repair --agent auto --json");
}

function buildCandidateEntry(entry, roster, adapterHealth) {
  const rosterEntry = roster?.agents?.[entry.profile.id] ?? null;
  const health = adapterHealth?.[entry.profile.id] ?? null;
  return {
    id: entry.profile.id,
    label: entry.profile.label,
    score: entry.score,
    default_role: entry.profile.default_role,
    supported_roles: entry.profile.supported_roles,
    roster_enabled: rosterEntry?.enabled ?? true,
    roster_priority: Number.parseInt(String(rosterEntry?.priority ?? 0), 10) || 0,
    roster_roles: Array.isArray(rosterEntry?.roles) ? rosterEntry.roles : [],
    adapter_module: rosterEntry?.adapter_module ?? "",
    health_status: health?.health_status ?? "unknown",
    health_reason: health?.health_reason ?? "health not evaluated",
  };
}

export async function coordinatorSelectAgent({
  targetRoot,
  requestedAgent = "auto",
  role,
  action,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const normalizedRole = normalizeRequestedAgentRole(role);
  const normalizedAction = normalizeRequestedAgentAction(action);
  const roster = loadAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const rosterVerification = await verifyAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const adapterHealth = buildAgentHealthMap(rosterVerification);
  const adapters = await loadRegisteredAgentAdapters({
    targetRoot: absoluteTargetRoot,
    roster,
    ignoreLoadFailures: true,
  });
  const ranking = rankAgentAdapters({
    role: normalizedRole,
    action: normalizedAction,
    adapters,
    roster,
    adapterHealth,
  });
  const selection = selectAgentAdapter({
    requestedAgent,
    role: normalizedRole,
    action: normalizedAction,
    adapters,
    roster,
    adapterHealth,
  });

  return {
    target_root: absoluteTargetRoot,
    requested_agent: String(requestedAgent ?? "auto").trim().toLowerCase() || "auto",
    role: normalizedRole,
    action: normalizedAction,
    roster: {
      found: roster.found,
      file_path: roster.file_path,
      default_requested_agent: roster.default_requested_agent,
    },
    roster_verification: {
      pass: rosterVerification.pass,
      issue_count: rosterVerification.issues.length,
      warning_count: rosterVerification.warnings.length,
    },
    selection: {
      status: selection.status,
      selected_agent: selection.selected_profile?.id ?? "unsupported",
      reason: selection.reason,
    },
    candidates: ranking.map((entry) => buildCandidateEntry(entry, roster, adapterHealth)),
  };
}

function renderText(result) {
  const lines = [];
  lines.push("Coordinator select agent:");
  lines.push(`- requested_agent=${result.requested_agent}`);
  lines.push(`- role=${result.role}`);
  lines.push(`- action=${result.action}`);
  lines.push(`- selected_agent=${result.selection.selected_agent}`);
  lines.push(`- status=${result.selection.status}`);
  lines.push(`- reason=${result.selection.reason}`);
  lines.push("- candidates:");
  for (const candidate of result.candidates) {
    lines.push(`  - ${candidate.id} score=${candidate.score} priority=${candidate.roster_priority} roles=${candidate.supported_roles.join(",")}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await coordinatorSelectAgent({
      targetRoot: args.target,
      requestedAgent: args.agent,
      role: args.role,
      action: args.action,
      rosterFile: args.rosterFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(renderText(result));
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
