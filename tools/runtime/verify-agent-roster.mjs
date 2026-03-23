#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectRegisteredAgentAdapters,
  listBuiltInAgentAdapters,
} from "../../src/application/runtime/agent-adapter-registry-service.mjs";
import { loadAgentRoster } from "../../src/application/runtime/agent-roster-service.mjs";
import { AGENT_ROLES, getAgentRoleCapabilities } from "../../src/core/agents/agent-role-model.mjs";
import { resolveDbBackedMode } from "./db-first-runtime-view-lib.mjs";

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
  console.log("  node tools/runtime/verify-agent-roster.mjs --target .");
  console.log("  node tools/runtime/verify-agent-roster.mjs --target . --json");
}

function uniq(values) {
  return [...new Set(values)];
}

function validateRoles(roles) {
  const normalized = Array.isArray(roles)
    ? roles.map((role) => String(role ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  const unknown = normalized.filter((role) => !AGENT_ROLES.includes(role));
  return {
    normalized,
    unknown,
  };
}

function normalizeEnvironmentProbe(result) {
  const normalizedStatus = String(result?.status ?? "").trim().toLowerCase();
  if (normalizedStatus === "ready" || normalizedStatus === "degraded" || normalizedStatus === "unavailable") {
    return {
      environment_status: normalizedStatus,
      environment_reason: String(result?.reason ?? "").trim() || "environment probe returned no reason",
    };
  }
  return {
    environment_status: "unknown",
    environment_reason: "environment probe returned an invalid status",
  };
}

async function probeAdapterEnvironment({ adapter, targetRoot }) {
  if (!adapter) {
    return {
      environment_status: "unavailable",
      environment_reason: "adapter is not loadable for environment probing",
    };
  }
  if (typeof adapter.checkEnvironment === "function") {
    try {
      return normalizeEnvironmentProbe(await adapter.checkEnvironment({
        targetRoot,
        probeCommand: process.execPath,
        probeArgs: ["--version"],
      }));
    } catch (error) {
      return {
        environment_status: "unavailable",
        environment_reason: `environment probe failed: ${String(error?.message ?? error)}`,
      };
    }
  }
  try {
    const result = adapter.runCommand({
      command: process.execPath,
      commandArgs: ["--version"],
      commandLine: `"${process.execPath}" --version`,
      envOverrides: {
        AIDN_AGENT_ENV_PROBE: "1",
      },
    });
    const exitCode = Number.isInteger(result?.status) ? result.status : 1;
    if (exitCode === 0) {
      return {
        environment_status: "ready",
        environment_reason: "adapter executed the default environment probe successfully",
      };
    }
    const details = String(result?.stderr ?? result?.stdout ?? "").trim();
    return {
      environment_status: "unavailable",
      environment_reason: details
        ? `environment probe failed: ${details}`
        : `environment probe failed with exit code ${exitCode}`,
    };
  } catch (error) {
    return {
      environment_status: "unavailable",
      environment_reason: `environment probe failed: ${String(error?.message ?? error)}`,
    };
  }
}

async function buildEntryResult({ id, config, builtInAdapters, registeredInspection, targetRoot }) {
  const issues = [];
  const warnings = [];
  const builtInAdapter = builtInAdapters.get(id) ?? null;
  const builtInProfile = builtInAdapter?.getProfile?.() ?? null;
  const declaredRoles = validateRoles(config?.roles);
  if (declaredRoles.unknown.length > 0) {
    issues.push(`unknown roster roles: ${uniq(declaredRoles.unknown).join(", ")}`);
  }

  let source = "unknown";
  let supportedRoles = [];
  let adapterLabel = "";
  let modulePath = "";
  let adapter = null;
  if (builtInProfile) {
    source = "built-in";
    supportedRoles = builtInProfile.supported_roles;
    adapterLabel = builtInProfile.label;
    adapter = builtInAdapter;
  }
  if (registeredInspection) {
    source = "registered";
    modulePath = registeredInspection.module_path;
    if (!registeredInspection.exists) {
      issues.push(`adapter module missing: ${registeredInspection.module_path}`);
    }
    if (!registeredInspection.loaded) {
      issues.push(`adapter load failed: ${registeredInspection.error}`);
    }
    const profile = registeredInspection.adapter?.getProfile?.();
    if (profile) {
      supportedRoles = profile.supported_roles;
      adapterLabel = profile.label;
    }
    adapter = registeredInspection.adapter ?? adapter;
  }
  if (!builtInProfile && !registeredInspection) {
    issues.push("unknown adapter id with no adapter_module");
  }

  const unsupportedDeclaredRoles = declaredRoles.normalized
    .filter((role) => supportedRoles.length > 0 && !supportedRoles.includes(role));
  if (unsupportedDeclaredRoles.length > 0) {
    issues.push(`roster roles not supported by adapter: ${uniq(unsupportedDeclaredRoles).join(", ")}`);
  }
  if (declaredRoles.normalized.length === 0) {
    warnings.push("no explicit roster roles declared");
  }

  const effectiveRoles = declaredRoles.normalized.length > 0
    ? declaredRoles.normalized.filter((role) => supportedRoles.includes(role))
    : [...supportedRoles];
  const capabilitiesByRole = Object.fromEntries(
    effectiveRoles.map((role) => [role, getAgentRoleCapabilities(role)]),
  );
  const environment = config?.enabled === false
    ? {
      environment_status: "unknown",
      environment_reason: "environment probe skipped because the adapter is disabled by roster",
    }
    : await probeAdapterEnvironment({
      adapter,
      targetRoot,
    });
  if (config?.enabled !== false && environment.environment_status === "unavailable") {
    issues.push(`environment probe unavailable: ${environment.environment_reason}`);
  } else if (config?.enabled !== false && environment.environment_status === "degraded") {
    warnings.push(`environment probe degraded: ${environment.environment_reason}`);
  }
  let healthStatus = "ready";
  let healthReason = "adapter is enabled and loadable";
  if (config?.enabled === false) {
    healthStatus = "disabled";
    healthReason = "adapter is disabled by roster";
  } else if (issues.some((issue) => issue.includes("adapter module missing") || issue.includes("adapter load failed"))) {
    healthStatus = "unavailable";
    healthReason = "adapter cannot be loaded in the current environment";
  } else if (environment.environment_status === "unavailable") {
    healthStatus = "unavailable";
    healthReason = environment.environment_reason;
  } else if (environment.environment_status === "degraded") {
    healthStatus = "degraded";
    healthReason = environment.environment_reason;
  } else if (issues.length > 0) {
    healthStatus = "degraded";
    healthReason = "adapter configuration has roster compatibility issues";
  }

  return {
    id,
    source,
    enabled: config?.enabled ?? true,
    priority: Number.parseInt(String(config?.priority ?? 0), 10) || 0,
    adapter_label: adapterLabel,
    adapter_module: modulePath || String(config?.adapter_module ?? "").trim(),
    supported_roles: supportedRoles,
    roster_roles: declaredRoles.normalized,
    effective_roles: effectiveRoles,
    capabilities_by_role: capabilitiesByRole,
    environment_status: environment.environment_status,
    environment_reason: environment.environment_reason,
    health_status: healthStatus,
    health_reason: healthReason,
    issues,
    warnings,
    ok: issues.length === 0,
  };
}

export async function verifyAgentRoster({
  targetRoot,
  rosterFile = "docs/audit/AGENT-ROSTER.md",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const { effectiveStateMode, dbBackedMode } = resolveDbBackedMode(absoluteTargetRoot);
  const roster = loadAgentRoster({
    targetRoot: absoluteTargetRoot,
    rosterFile,
  });
  const builtInAdapters = new Map(
    listBuiltInAgentAdapters().map((adapter) => [adapter.getProfile().id, adapter]),
  );
  const registeredInspections = await inspectRegisteredAgentAdapters({
    targetRoot: absoluteTargetRoot,
    roster,
  });
  const inspectionById = new Map(registeredInspections.map((item) => [item.id, item]));
  const entries = await Promise.all(Object.entries(roster.agents)
    .map(([id, config]) => buildEntryResult({
      id,
      config,
      builtInAdapters,
      registeredInspection: inspectionById.get(id) ?? null,
      targetRoot: absoluteTargetRoot,
    })));
  entries.sort((left, right) => left.id.localeCompare(right.id));

  const issues = [];
  const warnings = [];
  const defaultRequestedAgent = String(roster.default_requested_agent ?? "auto").trim().toLowerCase() || "auto";
  const knownIds = new Set([
    ...builtInAdapters.keys(),
    ...registeredInspections.map((item) => item.id),
    ...Object.keys(roster.agents),
  ]);
  if (defaultRequestedAgent !== "auto" && !knownIds.has(defaultRequestedAgent)) {
    issues.push(`default_agent_selection references unknown adapter: ${defaultRequestedAgent}`);
  }
  for (const entry of entries) {
    for (const issue of entry.issues) {
      issues.push(`${entry.id}: ${issue}`);
    }
    for (const warning of entry.warnings) {
      warnings.push(`${entry.id}: ${warning}`);
    }
  }

  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    roster_found: roster.found,
    roster_file: roster.file_path,
    default_requested_agent: defaultRequestedAgent,
    entries,
    registered_inspections: registeredInspections.map((item) => ({
      id: item.id,
      module_path: item.module_path,
      export_name: item.export_name,
      exists: item.exists,
      loaded: item.loaded,
      error: item.error,
    })),
    issues,
    warnings,
    pass: issues.length === 0,
  };
}

export function buildAgentHealthMap(result) {
  return Object.fromEntries(
    (result?.entries ?? []).map((entry) => [entry.id, {
      health_status: entry.health_status,
      health_reason: entry.health_reason,
      issues: entry.issues ?? [],
      warnings: entry.warnings ?? [],
      effective_roles: entry.effective_roles ?? [],
      supported_roles: entry.supported_roles ?? [],
    }]),
  );
}

function renderText(result) {
  const lines = [];
  lines.push("Agent roster verification:");
  lines.push(`- roster_found=${result.roster_found ? "yes" : "no"}`);
  lines.push(`- default_requested_agent=${result.default_requested_agent}`);
  lines.push(`- pass=${result.pass ? "yes" : "no"}`);
  lines.push("- entries:");
  for (const entry of result.entries) {
    lines.push(`  - ${entry.id} source=${entry.source} ok=${entry.ok ? "yes" : "no"} health=${entry.health_status} env=${entry.environment_status} roles=${entry.roster_roles.join(",") || "none"}`);
  }
  if (result.issues.length > 0) {
    lines.push("- issues:");
    for (const issue of result.issues) {
      lines.push(`  - ${issue}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("- warnings:");
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await verifyAgentRoster({
      targetRoot: args.target,
      rosterFile: args.rosterFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(renderText(result));
    }
    if (!result.pass) {
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
