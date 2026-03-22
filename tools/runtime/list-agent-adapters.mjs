#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_ROLES, getAgentRoleCapabilities } from "../../src/core/agents/agent-role-model.mjs";
import { selectAgentAdapter } from "../../src/core/agents/agent-selection-policy.mjs";
import { loadRegisteredAgentAdapters, listBuiltInAgentAdapters } from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { resolveDbBackedMode } from "./db-first-runtime-view-lib.mjs";
import { buildAgentHealthMap, verifyAgentRoster } from "./verify-agent-roster.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    rosterFile: "docs/audit/AGENT-ROSTER.md",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      args.target = String(argv[index + 1] ?? "").trim();
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
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/list-agent-adapters.mjs --target .");
  console.log("  node tools/runtime/list-agent-adapters.mjs --target . --json");
}

function buildScenarioMatrix(adapters, roster, adapterHealth) {
  const scenarios = [];
  for (const role of AGENT_ROLES) {
    for (const action of getAgentRoleCapabilities(role)) {
      let selection;
      try {
        selection = selectAgentAdapter({
          requestedAgent: "auto",
          role,
          action,
          adapters,
          roster,
          adapterHealth,
        });
      } catch (error) {
        scenarios.push({
          role,
          action,
          status: "error",
          selected_agent: "unsupported",
          candidate_ids: [],
          reason: String(error?.message ?? error),
        });
        continue;
      }
      scenarios.push({
        role,
        action,
        status: selection.status,
        selected_agent: selection.selected_profile?.id ?? "unsupported",
        candidate_ids: selection.candidate_profiles.map((candidate) => candidate.id),
        reason: selection.reason,
      });
    }
  }
  return scenarios;
}

function buildAdapterEntry(adapter, roster, adapterHealth) {
  const profile = adapter.getProfile();
  const rosterEntry = roster?.agents?.[profile.id] ?? null;
  const isRegistered = Boolean(String(rosterEntry?.adapter_module ?? "").trim());
  const health = adapterHealth?.[profile.id] ?? null;
  return {
    id: profile.id,
    label: profile.label,
    source: isRegistered ? "registered" : "built-in",
    enabled: rosterEntry?.enabled ?? true,
    priority: Number.parseInt(String(rosterEntry?.priority ?? 0), 10) || 0,
    default_role: profile.default_role,
    supported_roles: profile.supported_roles,
    roster_roles: Array.isArray(rosterEntry?.roles) ? rosterEntry.roles : [],
    adapter_module: rosterEntry?.adapter_module ?? "",
    adapter_export: rosterEntry?.adapter_export ?? "",
    notes: rosterEntry?.notes ?? "",
    health_status: health?.health_status ?? "unknown",
    health_reason: health?.health_reason ?? "health not evaluated",
  };
}

function buildUnavailableAdapterEntry(verificationEntry, roster) {
  const rosterEntry = roster?.agents?.[verificationEntry.id] ?? null;
  return {
    id: verificationEntry.id,
    label: verificationEntry.adapter_label || verificationEntry.id,
    source: verificationEntry.source,
    enabled: verificationEntry.enabled,
    priority: Number.parseInt(String(rosterEntry?.priority ?? verificationEntry.priority ?? 0), 10) || 0,
    default_role: verificationEntry.effective_roles?.[0] ?? verificationEntry.supported_roles?.[0] ?? "",
    supported_roles: verificationEntry.supported_roles ?? [],
    roster_roles: Array.isArray(rosterEntry?.roles) ? rosterEntry.roles : (verificationEntry.roster_roles ?? []),
    adapter_module: verificationEntry.adapter_module ?? "",
    adapter_export: rosterEntry?.adapter_export ?? "",
    notes: rosterEntry?.notes ?? "",
    health_status: verificationEntry.health_status ?? "unknown",
    health_reason: verificationEntry.health_reason ?? "health not evaluated",
  };
}

export async function listAgentAdapters({
  targetRoot,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
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
  const builtInIds = new Set(listBuiltInAgentAdapters().map((adapter) => adapter.getProfile().id));
  const entryMap = new Map(adapters
    .map((adapter) => {
      const entry = buildAdapterEntry(adapter, roster, adapterHealth);
      if (!entry.source && builtInIds.has(entry.id)) {
        entry.source = "built-in";
      }
      return entry;
    })
    .map((entry) => [entry.id, entry]));
  for (const verificationEntry of rosterVerification.entries) {
    if (!entryMap.has(verificationEntry.id)) {
      entryMap.set(verificationEntry.id, buildUnavailableAdapterEntry(verificationEntry, roster));
    }
  }
  const entries = [...entryMap.values()]
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    roster: {
      found: roster.found,
      file_path: roster.file_path,
      default_requested_agent: roster.default_requested_agent,
      registered_ids: Object.entries(roster.agents)
        .filter(([, config]) => String(config?.adapter_module ?? "").trim())
        .map(([id]) => id)
        .sort(),
    },
    roster_verification: {
      pass: rosterVerification.pass,
      issue_count: rosterVerification.issues.length,
      warning_count: rosterVerification.warnings.length,
    },
    adapters: entries,
    auto_selection_preview: buildScenarioMatrix(adapters, roster, adapterHealth),
  };
}

function renderText(result) {
  const lines = [];
  lines.push("Agent adapters:");
  lines.push(`- roster_found=${result.roster.found ? "yes" : "no"}`);
  lines.push(`- default_requested_agent=${result.roster.default_requested_agent}`);
  for (const adapter of result.adapters) {
    lines.push(`- ${adapter.id} source=${adapter.source} enabled=${adapter.enabled ? "yes" : "no"} health=${adapter.health_status} roles=${adapter.supported_roles.join(",")}`);
  }
  lines.push("- auto_selection_preview:");
  for (const scenario of result.auto_selection_preview) {
    lines.push(`  - ${scenario.role}+${scenario.action} -> ${scenario.selected_agent} (${scenario.status})`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await listAgentAdapters({
      targetRoot: args.target,
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
