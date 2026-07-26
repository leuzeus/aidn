const REGISTRY_SOURCE = "src/core/cli/command-registry.mjs";
const EFFECT_POLICY_SOURCE = "src/core/cli/effect-policy.mjs";
const VISIBILITY_VALUES = Object.freeze(["public", "internal"]);

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

function normalizeToken(value) {
  return String(value ?? "").trim();
}

function descriptor({
  group,
  name,
  implementation,
  fixedArgs = [],
  aliases = [],
  dispatchKind = "script",
  visibility,
  owner,
  effectAuthority,
  jsonContracts = [],
}) {
  const normalizedGroup = normalizeToken(group);
  const normalizedName = normalizeToken(name);
  const command = normalizedGroup === "root"
    ? `aidn ${normalizedName}`
    : `aidn ${normalizedGroup} ${normalizedName}`;
  return freezeDeep({
    id: `${normalizedGroup}:${normalizedName}`,
    command,
    group: normalizedGroup,
    name: normalizedName,
    implementation: normalizeToken(implementation).replaceAll("\\", "/"),
    fixed_args: fixedArgs.map(normalizeToken),
    aliases: aliases.map(normalizeToken),
    dispatch_kind: normalizeToken(dispatchKind),
    visibility: normalizeToken(visibility),
    owner: normalizeToken(owner),
    effect_authority: normalizeToken(effectAuthority),
    json_contracts: jsonContracts.map(normalizeToken),
    registry_source: REGISTRY_SOURCE,
  });
}

function publicCommand(group, name, implementation, jsonContracts = [], fixedArgs = []) {
  const command = group === "root" ? `aidn ${name}` : `aidn ${group} ${name}`;
  return descriptor({
    group,
    name,
    implementation,
    fixedArgs,
    visibility: "public",
    owner: group === "codex"
      ? "Codex integration maintainer"
      : group === "project"
        ? "Project configuration maintainer"
        : group === "root" && name === "install"
          ? "Install maintainer"
          : group === "root" && name === "bootstrap"
            ? "Bootstrap maintainer"
            : group === "root" && name === "build-release"
              ? "Release maintainer"
              : "Runtime CLI maintainer",
    effectAuthority: `${EFFECT_POLICY_SOURCE}#${command}`,
    jsonContracts,
  });
}

function internalCommand(group, name, implementation, fixedArgs = []) {
  return descriptor({
    group,
    name,
    implementation,
    fixedArgs,
    visibility: "internal",
    owner: group === "perf"
      ? "Repository verification maintainer"
      : "Codex integration maintainer",
    effectAuthority: "internal/non-public",
    jsonContracts: [],
  });
}

function builtinCommand(group, name, {
  aliases = [],
  visibility = "public",
} = {}) {
  const command = group === "root" ? `aidn ${name}` : `aidn ${group} ${name}`;
  return descriptor({
    group,
    name,
    implementation: "bin/aidn.mjs",
    aliases,
    dispatchKind: "builtin",
    visibility,
    owner: "CLI maintainer",
    effectAuthority: visibility === "public"
      ? `${EFFECT_POLICY_SOURCE}#${command}`
      : "internal/non-public",
  });
}

const DIRECT_COMMANDS = freezeDeep([
  builtinCommand("root", "help", { aliases: ["--help", "-h"] }),
  builtinCommand("root", "version", { aliases: ["--version", "-v"] }),
  publicCommand("root", "bootstrap", "tools/bootstrap.mjs", [
    "bootstrap-preview.v1.schema.json",
    "bootstrap.v1.schema.json",
  ]),
  publicCommand("root", "build-release", "tools/build-release.mjs"),
  publicCommand("root", "install", "tools/install.mjs"),
]);

const PERF_COMMANDS = freezeDeep([
  internalCommand("perf", "collect", "tools/perf/collect-event.mjs"),
  internalCommand("perf", "report", "tools/perf/report-kpi.mjs"),
  internalCommand("perf", "sync-history", "tools/perf/sync-kpi-history.mjs"),
  internalCommand("perf", "fallback-report", "tools/perf/report-fallbacks.mjs"),
  internalCommand("perf", "constraint-report", "tools/perf/report-constraints.mjs"),
  internalCommand("perf", "constraint-actions", "tools/perf/report-constraint-actions.mjs"),
  internalCommand("perf", "constraint-history", "tools/perf/sync-constraint-history.mjs"),
  internalCommand("perf", "constraint-trend", "tools/perf/report-constraint-trend.mjs"),
  internalCommand("perf", "constraint-trend-summary", "tools/perf/render-constraint-trend-summary.mjs"),
  internalCommand("perf", "constraint-lot-plan", "tools/perf/report-constraint-lot-plan.mjs"),
  internalCommand("perf", "constraint-lot-update", "tools/perf/update-constraint-lot-plan.mjs"),
  internalCommand("perf", "constraint-lot-advance", "tools/perf/advance-constraint-lot-plan.mjs"),
  internalCommand("perf", "constraint-lot-summary", "tools/perf/render-constraint-lot-plan-summary.mjs"),
  internalCommand("perf", "constraint-summary", "tools/perf/render-constraint-summary.mjs"),
  internalCommand("perf", "constraint-loop", "tools/perf/constraint-loop.mjs"),
  internalCommand("perf", "index", "tools/perf/index-sync.mjs"),
  internalCommand("perf", "index-check", "tools/perf/index-sync-check.mjs"),
  internalCommand("perf", "index-select-paths", "tools/perf/index-sync-select-paths.mjs"),
  internalCommand("perf", "index-reconcile", "tools/perf/index-sync-reconcile.mjs"),
  internalCommand("perf", "index-sync-history", "tools/perf/sync-index-sync-history.mjs"),
  internalCommand("perf", "index-sync-report", "tools/perf/report-index-sync.mjs"),
  internalCommand("perf", "index-from-sqlite", "tools/perf/index-from-sqlite.mjs"),
  internalCommand("perf", "index-export-files", "tools/perf/index-export-files.mjs"),
  internalCommand("perf", "index-verify-sqlite", "tools/perf/index-verify-sqlite.mjs"),
  internalCommand("perf", "index-canonical-check", "tools/perf/check-index-canonical-coverage.mjs"),
  internalCommand("perf", "index-canonical-summary", "tools/perf/render-index-canonical-check-summary.mjs"),
  internalCommand("perf", "index-regression-kpi", "tools/perf/report-index-regression-kpi.mjs"),
  internalCommand("perf", "index-regression-history", "tools/perf/sync-kpi-history.mjs"),
  internalCommand("perf", "index-regression", "tools/perf/check-regression.mjs"),
  internalCommand("perf", "index-sql", "tools/perf/index-to-sql.mjs"),
  internalCommand("perf", "index-query", "tools/perf/index-query.mjs"),
  internalCommand("perf", "structure", "tools/perf/structure-profile.mjs"),
  internalCommand("perf", "index-verify", "tools/perf/index-verify-dual.mjs"),
  internalCommand("perf", "verify-index-sync", "tools/perf/verify-index-sync-fixtures.mjs"),
  internalCommand("perf", "verify-index-sync-select-paths", "tools/perf/verify-index-sync-select-paths-fixtures.mjs"),
  internalCommand("perf", "verify-index-reconcile", "tools/perf/verify-index-reconcile-fixtures.mjs"),
  internalCommand("perf", "verify-index-sqlite", "tools/perf/verify-index-sqlite-fixtures.mjs"),
  internalCommand("perf", "verify-index-canonical-check", "tools/perf/verify-index-canonical-check-fixtures.mjs"),
  internalCommand("perf", "verify-index-regression", "tools/perf/verify-index-regression-fixtures.mjs"),
  internalCommand("perf", "verify-cli-aliases", "tools/perf/verify-perf-cli-aliases-fixtures.mjs"),
  internalCommand("perf", "verify-structure", "tools/perf/verify-structure-profile-fixtures.mjs"),
  internalCommand("perf", "verify-skill-hooks", "tools/perf/verify-skill-hook-coverage.mjs"),
  internalCommand("perf", "skill-hook", "tools/perf/skill-hook.mjs"),
  internalCommand("perf", "verify-skill-hook-context", "tools/perf/verify-skill-hook-context-injection.mjs"),
  internalCommand("perf", "verify-db-first-sync", "tools/perf/verify-db-first-sync-coverage.mjs"),
  internalCommand("perf", "verify-sync-db-first-selective", "tools/perf/verify-sync-db-first-selective-fixtures.mjs"),
  internalCommand("perf", "verify-install-import", "tools/perf/verify-install-import-fixtures.mjs"),
  internalCommand("perf", "verify-project-config", "tools/perf/verify-project-config-fixtures.mjs"),
  internalCommand("perf", "verify-state-mode-parity", "tools/perf/verify-state-mode-parity-fixtures.mjs"),
  internalCommand("perf", "verify-constraint-report", "tools/perf/verify-constraint-report-fixtures.mjs"),
  internalCommand("perf", "verify-constraint-actions", "tools/perf/verify-constraint-actions-fixtures.mjs"),
  internalCommand("perf", "verify-constraint-trend", "tools/perf/verify-constraint-trend-fixtures.mjs"),
  internalCommand("perf", "verify-constraint-lot-plan", "tools/perf/verify-constraint-lot-plan-fixtures.mjs"),
  internalCommand("perf", "index-report", "tools/perf/report-index.mjs"),
  internalCommand("perf", "index-thresholds", "tools/perf/check-thresholds-defaults.mjs", ["--preset", "index"]),
  internalCommand("perf", "index-sync-thresholds", "tools/perf/check-thresholds-defaults.mjs", ["--preset", "index-sync"]),
  internalCommand("perf", "checkpoint", "tools/perf/checkpoint.mjs"),
  internalCommand("perf", "reload-check", "tools/perf/reload-check.mjs"),
  internalCommand("perf", "gate", "tools/perf/gating-evaluate.mjs"),
  internalCommand("perf", "check-thresholds", "tools/perf/check-thresholds.mjs"),
  internalCommand("perf", "check-regression", "tools/perf/check-regression.mjs"),
  internalCommand("perf", "check-fallbacks", "tools/perf/check-thresholds-defaults.mjs", ["--preset", "fallback"]),
  internalCommand("perf", "check-constraints", "tools/perf/check-thresholds-defaults.mjs", ["--preset", "constraint"]),
  internalCommand("perf", "check-constraint-trend", "tools/perf/check-thresholds-defaults.mjs", ["--preset", "constraint-trend"]),
  internalCommand("perf", "campaign", "tools/perf/run-kpi-campaign.mjs"),
  internalCommand("perf", "render-summary", "tools/perf/render-summary.mjs"),
  internalCommand("perf", "reset", "tools/perf/reset-runtime.mjs"),
  internalCommand("perf", "hook", "tools/perf/workflow-hook.mjs"),
  internalCommand("perf", "session-start", "tools/perf/start-session-hook.mjs"),
  internalCommand("perf", "session-close", "tools/perf/workflow-hook.mjs", ["--phase", "session-close"]),
  internalCommand("perf", "delivery-start", "tools/perf/delivery-window.mjs", ["--action", "start"]),
  internalCommand("perf", "delivery-end", "tools/perf/delivery-window.mjs", ["--action", "end"]),
  internalCommand("perf", "audit-review", "tools/perf/audit-review.mjs"),
]);

const CODEX_COMMANDS = freezeDeep([
  internalCommand("codex", "run-json-hook", "tools/codex/run-json-hook.mjs"),
  internalCommand("codex", "normalize-hook-payload", "tools/codex/normalize-hook-payload.mjs"),
  publicCommand("codex", "hydrate-context", "tools/codex/hydrate-context.mjs", [
    "codex-hydrate-context.v1.schema.json",
  ]),
  publicCommand("codex", "workflow-step", "tools/codex/workflow-step.mjs", [
    "codex-workflow-step.v1.schema.json",
  ]),
]);

const RUNTIME_COMMANDS = freezeDeep([
  publicCommand("runtime", "artifact-fetch", "tools/runtime/artifact-fetch.mjs", ["runtime-artifact-fetch.v1.schema.json"]),
  publicCommand("runtime", "artifact-store", "tools/runtime/artifact-store.mjs", [
    "runtime-artifact-store-get.v1.schema.json",
    "runtime-artifact-store-list.v1.schema.json",
    "runtime-artifact-store-materialize.v1.schema.json",
    "runtime-artifact-store-upsert.v1.schema.json",
  ]),
  publicCommand("runtime", "db-backup", "tools/runtime/db-backup.mjs", ["runtime-db-backup.v1.schema.json"]),
  publicCommand("runtime", "db-migrate", "tools/runtime/db-migrate.mjs", ["runtime-db-migrate.v1.schema.json"]),
  publicCommand("runtime", "db-status", "tools/runtime/db-status.mjs", ["runtime-db-status.v1.schema.json"]),
  publicCommand("runtime", "db-only-readiness", "tools/runtime/db-only-readiness.mjs", ["runtime-db-only-readiness.v1.schema.json"]),
  publicCommand("runtime", "persistence-backup", "tools/runtime/db-backup.mjs", ["runtime-persistence-backup.v1.schema.json"]),
  publicCommand("runtime", "persistence-adopt", "tools/runtime/persistence-adopt.mjs", ["runtime-persistence-adopt.v1.schema.json"]),
  publicCommand("runtime", "persistence-source-diagnose", "tools/runtime/persistence-source-diagnose.mjs", ["runtime-persistence-source-diagnose.v1.schema.json"]),
  publicCommand("runtime", "persistence-source-normalize", "tools/runtime/persistence-source-normalize.mjs", ["runtime-persistence-source-normalize.v1.schema.json"]),
  publicCommand("runtime", "persistence-migrate", "tools/runtime/db-migrate.mjs", ["runtime-persistence-migrate.v1.schema.json"]),
  publicCommand("runtime", "persistence-status", "tools/runtime/db-status.mjs", ["runtime-persistence-status.v1.schema.json"]),
  publicCommand("runtime", "visible-artifacts-cleanup", "tools/runtime/visible-artifacts-cleanup.mjs", ["runtime-visible-artifacts-cleanup.v1.schema.json"]),
  publicCommand("runtime", "visible-artifacts-restore", "tools/runtime/visible-artifacts-restore.mjs", ["runtime-visible-artifacts-restore.v1.schema.json"]),
  publicCommand("runtime", "shared-runtime-reanchor", "tools/runtime/shared-runtime-reanchor.mjs", ["runtime-shared-runtime-reanchor.v1.schema.json"]),
  publicCommand("runtime", "state-reanchor", "tools/runtime/state-reanchor.mjs", ["runtime-state-reanchor.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-backup", "tools/runtime/shared-coordination-backup.mjs", ["runtime-shared-coordination-backup.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-restore", "tools/runtime/shared-coordination-restore.mjs", ["runtime-shared-coordination-restore.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-doctor", "tools/runtime/shared-coordination-doctor.mjs", ["runtime-shared-coordination-doctor.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-migrate", "tools/runtime/shared-coordination-migrate.mjs", ["runtime-shared-coordination-migrate.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-bootstrap", "tools/runtime/shared-coordination-bootstrap.mjs", ["runtime-shared-coordination-bootstrap.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-status", "tools/runtime/shared-coordination-status.mjs", ["runtime-shared-coordination-status.v1.schema.json"]),
  publicCommand("runtime", "shared-coordination-projects", "tools/runtime/shared-coordination-projects.mjs", ["runtime-shared-coordination-projects.v1.schema.json"]),
  publicCommand("runtime", "governance-diagnostics", "tools/runtime/governance-diagnostics.mjs", ["runtime-governance-diagnostics.v1.schema.json"]),
  publicCommand("runtime", "coordinator-dispatch-execute", "tools/runtime/coordinator-dispatch-execute.mjs", ["runtime-coordinator-dispatch-execute.v1.schema.json"]),
  publicCommand("runtime", "coordinator-dispatch-plan", "tools/runtime/coordinator-dispatch-plan.mjs", ["runtime-coordinator-dispatch-plan.v1.schema.json"]),
  publicCommand("runtime", "coordinator-loop", "tools/runtime/coordinator-loop.mjs", ["runtime-coordinator-loop.v1.schema.json"]),
  publicCommand("runtime", "coordinator-orchestrate", "tools/runtime/coordinator-orchestrate.mjs", ["runtime-coordinator-orchestrate.v1.schema.json"]),
  publicCommand("runtime", "coordinator-record-arbitration", "tools/runtime/coordinator-record-arbitration.mjs", ["runtime-coordinator-record-arbitration.v1.schema.json"]),
  publicCommand("runtime", "coordinator-resume", "tools/runtime/coordinator-resume.mjs", ["runtime-coordinator-resume.v1.schema.json"]),
  publicCommand("runtime", "coordinator-next-action", "tools/runtime/coordinator-next-action.mjs", ["runtime-coordinator-next-action.v1.schema.json"]),
  publicCommand("runtime", "coordinator-select-agent", "tools/runtime/coordinator-select-agent.mjs", ["runtime-coordinator-select-agent.v1.schema.json"]),
  publicCommand("runtime", "coordinator-suggest-arbitration", "tools/runtime/coordinator-suggest-arbitration.mjs", ["runtime-coordinator-suggest-arbitration.v1.schema.json"]),
  publicCommand("runtime", "list-agent-adapters", "tools/runtime/list-agent-adapters.mjs", ["runtime-list-agent-adapters.v1.schema.json"]),
  publicCommand("runtime", "local-daemon", "tools/runtime/local-daemon.mjs"),
  publicCommand("runtime", "verify-agent-roster", "tools/runtime/verify-agent-roster.mjs", ["runtime-verify-agent-roster.v1.schema.json"]),
  publicCommand("runtime", "project-agent-health-summary", "tools/runtime/project-agent-health-summary.mjs", ["runtime-project-agent-health-summary.v1.schema.json"]),
  publicCommand("runtime", "project-agent-selection-summary", "tools/runtime/project-agent-selection-summary.mjs", ["runtime-project-agent-selection-summary.v1.schema.json"]),
  publicCommand("runtime", "project-integration-risk", "tools/runtime/project-integration-risk.mjs", ["runtime-project-integration-risk.v1.schema.json"]),
  publicCommand("runtime", "project-multi-agent-status", "tools/runtime/project-multi-agent-status.mjs", ["runtime-project-multi-agent-status.v1.schema.json"]),
  publicCommand("runtime", "db-first-artifact", "tools/runtime/db-first-artifact.mjs", ["runtime-db-first-artifact.v1.schema.json"]),
  publicCommand("runtime", "handoff-admit", "tools/runtime/handoff-admit.mjs", ["runtime-handoff-admit.v1.schema.json"]),
  publicCommand("runtime", "pre-write-admit", "tools/runtime/pre-write-admit.mjs", ["runtime-pre-write-admit.v1.schema.json"]),
  publicCommand("runtime", "project-coordination-summary", "tools/runtime/project-coordination-summary.mjs", ["runtime-project-coordination-summary.v1.schema.json"]),
  publicCommand("runtime", "project-handoff-packet", "tools/runtime/project-handoff-packet.mjs", ["runtime-project-handoff-packet.v1.schema.json"]),
  publicCommand("runtime", "project-runtime-state", "tools/runtime/project-runtime-state.mjs", ["runtime-project-runtime-state.v1.schema.json"]),
  publicCommand("runtime", "session-plan", "tools/runtime/session-plan.mjs", ["runtime-session-plan.v1.schema.json"]),
  publicCommand("runtime", "sync-db-first", "tools/runtime/sync-db-first.mjs", ["runtime-sync-db-first.v1.schema.json"]),
  publicCommand("runtime", "sync-db-first-selective", "tools/runtime/sync-db-first-selective.mjs", ["runtime-sync-db-first-selective.v1.schema.json"]),
  publicCommand("runtime", "mode-migrate", "tools/runtime/mode-migrate.mjs", ["runtime-mode-migrate.v1.schema.json"]),
]);

const PROJECT_COMMANDS = freezeDeep([
  publicCommand("project", "config", "tools/project/config.mjs", [
    "project-config-list.v1.schema.json",
    "project-config-preview.v1.schema.json",
    "project-config-write.v1.schema.json",
  ]),
]);

const COMMAND_GROUPS = freezeDeep({
  perf: [...PERF_COMMANDS, builtinCommand("perf", "help", {
    aliases: ["--help", "-h"],
    visibility: "internal",
  })],
  codex: [...CODEX_COMMANDS, builtinCommand("codex", "help", {
    aliases: ["--help", "-h"],
  })],
  runtime: [...RUNTIME_COMMANDS, builtinCommand("runtime", "help", {
    aliases: ["--help", "-h"],
  })],
  project: [...PROJECT_COMMANDS, builtinCommand("project", "help", {
    aliases: ["--help", "-h"],
  })],
});

const ALL_DESCRIPTORS = freezeDeep([
  ...DIRECT_COMMANDS,
  ...Object.values(COMMAND_GROUPS).flat(),
]);

function cloneDescriptor(item) {
  return {
    ...item,
    fixed_args: [...item.fixed_args],
    aliases: [...item.aliases],
    json_contracts: [...item.json_contracts],
  };
}

export function validateCommandRegistryDescriptors(descriptors = ALL_DESCRIPTORS) {
  const issues = [];
  const ids = new Set();
  const commands = new Set();
  const groupNames = new Set();
  const dispatchTokens = new Set();
  const requiredFields = [
    "id",
    "command",
    "group",
    "name",
    "implementation",
    "fixed_args",
    "aliases",
    "dispatch_kind",
    "visibility",
    "owner",
    "effect_authority",
    "json_contracts",
    "registry_source",
  ];
  for (const [index, item] of descriptors.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push(`descriptor[${index}]: expected object`);
      continue;
    }
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        issues.push(`descriptor[${index}]: missing ${field}`);
      }
    }
    if (ids.has(item.id)) {
      issues.push(`${item.id}: duplicate descriptor id`);
    }
    ids.add(item.id);
    if (commands.has(item.command)) {
      issues.push(`${item.command}: duplicate command`);
    }
    commands.add(item.command);
    const groupName = `${item.group}/${item.name}`;
    if (groupNames.has(groupName)) {
      issues.push(`${groupName}: duplicate group command`);
    }
    groupNames.add(groupName);
    if (!VISIBILITY_VALUES.includes(item.visibility)) {
      issues.push(`${item.id}: invalid visibility ${item.visibility}`);
    }
    if (!normalizeToken(item.group) || !normalizeToken(item.name)) {
      issues.push(`${item.id}: group and name are required`);
    }
    const expectedId = `${normalizeToken(item.group)}:${normalizeToken(item.name)}`;
    if (item.id !== expectedId) {
      issues.push(`${item.id}: descriptor id must be ${expectedId}`);
    }
    const expectedCommand = item.group === "root"
      ? `aidn ${item.name}`
      : `aidn ${item.group} ${item.name}`;
    if (item.command !== expectedCommand) {
      issues.push(`${item.id}: command must be ${expectedCommand}`);
    }
    if (!Array.isArray(item.fixed_args)) {
      issues.push(`${item.id}: fixed_args must be an array`);
    } else if (item.fixed_args.some((token) => !normalizeToken(token))) {
      issues.push(`${item.id}: fixed_args must contain non-empty tokens`);
    }
    if (!Array.isArray(item.aliases)) {
      issues.push(`${item.id}: aliases must be an array`);
    } else if (item.aliases.some((token) => !normalizeToken(token))
      || item.aliases.some((token) => /\s/.test(token))
      || new Set(item.aliases).size !== item.aliases.length) {
      issues.push(`${item.id}: aliases must contain unique non-empty tokens`);
    } else {
      for (const token of [item.name, ...item.aliases]) {
        const routeToken = `${item.group}/${token}`;
        if (dispatchTokens.has(routeToken)) {
          issues.push(`${item.id}: duplicate dispatch token ${token} in ${item.group}`);
        }
        dispatchTokens.add(routeToken);
      }
    }
    if (!["script", "builtin"].includes(item.dispatch_kind)) {
      issues.push(`${item.id}: invalid dispatch_kind ${item.dispatch_kind}`);
    } else if (item.dispatch_kind === "builtin" && item.implementation !== "bin/aidn.mjs") {
      issues.push(`${item.id}: builtin commands must be implemented by bin/aidn.mjs`);
    }
    if (!Array.isArray(item.json_contracts)) {
      issues.push(`${item.id}: json_contracts must be an array`);
    } else if (item.json_contracts.some(
      (contract) => !normalizeToken(contract) || !contract.endsWith(".schema.json"),
    )) {
      issues.push(`${item.id}: json_contracts must contain schema filenames`);
    }
    if (!normalizeToken(item.owner)) {
      issues.push(`${item.id}: owner is required`);
    }
    if (!normalizeToken(item.implementation)) {
      issues.push(`${item.id}: implementation is required`);
    } else if (pathLikeInvalid(item.implementation)) {
      issues.push(`${item.id}: implementation must be a repository-relative .mjs path`);
    }
    if (item.visibility === "public") {
      if (item.effect_authority !== `${EFFECT_POLICY_SOURCE}#${item.command}`) {
        issues.push(`${item.id}: public effect authority must be exact`);
      }
    } else if (item.effect_authority !== "internal/non-public") {
      issues.push(`${item.id}: internal classification must be explicit`);
    }
    if (item.registry_source !== REGISTRY_SOURCE) {
      issues.push(`${item.id}: registry_source must be ${REGISTRY_SOURCE}`);
    }
  }
  return {
    ok: issues.length === 0,
    descriptor_count: descriptors.length,
    public_count: descriptors.filter((item) => item?.visibility === "public").length,
    internal_count: descriptors.filter((item) => item?.visibility === "internal").length,
    issues,
  };
}

function pathLikeInvalid(value) {
  const normalized = normalizeToken(value).replaceAll("\\", "/");
  return normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").includes("..")
    || !normalized.endsWith(".mjs");
}

export function listDispatchableCommandDescriptors() {
  return ALL_DESCRIPTORS.map(cloneDescriptor);
}

export function listDirectCommandDescriptors() {
  return DIRECT_COMMANDS.map(cloneDescriptor);
}

export function listCommandGroups() {
  return Object.keys(COMMAND_GROUPS);
}

export function listGroupCommandDescriptors(group) {
  return (COMMAND_GROUPS[normalizeToken(group)] ?? []).map(cloneDescriptor);
}

export function getDirectCommandDescriptor(name) {
  const token = normalizeToken(name);
  const item = DIRECT_COMMANDS.find(
    (candidate) => candidate.name === token || candidate.aliases.includes(token),
  );
  return item ? cloneDescriptor(item) : null;
}

export function getGroupCommandDescriptor(group, name) {
  const token = normalizeToken(name);
  const item = (COMMAND_GROUPS[normalizeToken(group)] ?? [])
    .find((candidate) => candidate.name === token || candidate.aliases.includes(token));
  return item ? cloneDescriptor(item) : null;
}

export function buildCommandDescriptorIndex(descriptors = ALL_DESCRIPTORS) {
  const validation = validateCommandRegistryDescriptors(descriptors);
  if (!validation.ok) {
    throw new Error(`Invalid command descriptor registry: ${validation.issues.join("; ")}`);
  }
  return new Map(descriptors.map((item) => [item.command, cloneDescriptor(item)]));
}
