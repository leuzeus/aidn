const EFFECT_CLASSES = Object.freeze([
  "read-only",
  "preview",
  "projector",
  "mutating",
  "executor",
]);

const STABILITY_LEVELS = Object.freeze([
  "stable",
  "experimental",
  "internal",
]);

function freezeDeep(value) {
  if (!value || typeof value !== "object") {
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

function commandPolicy({
  id,
  command,
  effectClass,
  stability = "stable",
  jsonContract = "",
  safeArgs = [],
  noMutationPaths = [],
  allowNonZero = false,
  notes = "",
}) {
  return freezeDeep({
    id: normalizeToken(id),
    command: normalizeToken(command),
    effect_class: normalizeToken(effectClass),
    stability: normalizeToken(stability),
    json_contract: normalizeToken(jsonContract),
    safe_args: safeArgs.map(normalizeToken).filter(Boolean),
    no_mutation_paths: noMutationPaths.map(normalizeToken).filter(Boolean),
    allow_non_zero: Boolean(allowNonZero),
    notes: normalizeToken(notes),
  });
}

const CLI_EFFECT_POLICIES = freezeDeep([
  commandPolicy({
    id: "project-config-list",
    command: "aidn project config --list --json",
    effectClass: "read-only",
    jsonContract: "project-config-list.v1.schema.json",
    safeArgs: ["project", "config", "--list", "--json"],
    notes: "Lists project adapter configuration without regenerating files.",
  }),
  commandPolicy({
    id: "runtime-db-status",
    command: "aidn runtime db-status --json",
    effectClass: "read-only",
    jsonContract: "runtime-db-status.v1.schema.json",
    safeArgs: ["runtime", "db-status", "--json"],
    notes: "Reports local runtime persistence status without migration.",
  }),
  commandPolicy({
    id: "runtime-persistence-adopt",
    command: "aidn runtime persistence-adopt --json",
    effectClass: "preview",
    jsonContract: "runtime-persistence-adopt.v1.schema.json",
    safeArgs: ["runtime", "persistence-adopt", "--backend", "postgres", "--dry-run", "--json"],
    notes: "Builds a runtime backend adoption plan without applying it when --dry-run is supplied.",
  }),
  commandPolicy({
    id: "runtime-db-migrate",
    command: "aidn runtime db-migrate --json",
    effectClass: "mutating",
    jsonContract: "runtime-db-migrate.v1.schema.json",
    safeArgs: ["runtime", "db-migrate", "--json"],
    notes: "Applies the local runtime schema migration for the selected backend.",
  }),
  commandPolicy({
    id: "runtime-db-backup",
    command: "aidn runtime db-backup --json",
    effectClass: "mutating",
    jsonContract: "runtime-db-backup.v1.schema.json",
    safeArgs: ["runtime", "db-backup", "--json"],
    notes: "Creates a local backup snapshot for the selected runtime backend.",
  }),
  commandPolicy({
    id: "runtime-persistence-source-diagnose",
    command: "aidn runtime persistence-source-diagnose --json",
    effectClass: "read-only",
    jsonContract: "runtime-persistence-source-diagnose.v1.schema.json",
    safeArgs: ["runtime", "persistence-source-diagnose", "--json"],
    notes: "Inspects sqlite source integrity before runtime backend adoption or transfer.",
  }),
  commandPolicy({
    id: "runtime-shared-coordination-migrate",
    command: "aidn runtime shared-coordination-migrate --json",
    effectClass: "preview",
    jsonContract: "runtime-shared-coordination-migrate.v1.schema.json",
    safeArgs: ["runtime", "shared-coordination-migrate", "--dry-run", "--json"],
    allowNonZero: true,
    notes: "Previews shared coordination schema migration unless --dry-run is removed.",
  }),
  commandPolicy({
    id: "runtime-shared-coordination-status",
    command: "aidn runtime shared-coordination-status --json",
    effectClass: "read-only",
    jsonContract: "runtime-shared-coordination-status.v1.schema.json",
    safeArgs: ["runtime", "shared-coordination-status", "--json"],
    notes: "Inspects the opt-in shared coordination backend without bootstrapping or migration.",
  }),
  commandPolicy({
    id: "runtime-shared-coordination-projects",
    command: "aidn runtime shared-coordination-projects --json",
    effectClass: "read-only",
    jsonContract: "runtime-shared-coordination-projects.v1.schema.json",
    safeArgs: ["runtime", "shared-coordination-projects", "--json"],
    allowNonZero: true,
    notes: "Enumerates shared coordination projects when a shared backend is explicitly configured.",
  }),
  commandPolicy({
    id: "runtime-shared-coordination-backup",
    command: "aidn runtime shared-coordination-backup --json",
    effectClass: "mutating",
    jsonContract: "runtime-shared-coordination-backup.v1.schema.json",
    safeArgs: ["runtime", "shared-coordination-backup", "--json"],
    allowNonZero: true,
    notes: "Exports a local backup snapshot for the opt-in shared coordination backend.",
  }),
  commandPolicy({
    id: "runtime-shared-coordination-restore",
    command: "aidn runtime shared-coordination-restore --json",
    effectClass: "preview",
    jsonContract: "runtime-shared-coordination-restore.v1.schema.json",
    safeArgs: ["runtime", "shared-coordination-restore", "--json"],
    allowNonZero: true,
    notes: "Previews a shared coordination restore unless --write is supplied.",
  }),
  commandPolicy({
    id: "runtime-shared-coordination-doctor",
    command: "aidn runtime shared-coordination-doctor --json",
    effectClass: "read-only",
    jsonContract: "runtime-shared-coordination-doctor.v1.schema.json",
    safeArgs: ["runtime", "shared-coordination-doctor", "--json"],
    allowNonZero: true,
    notes: "Diagnoses the opt-in shared coordination backend without mutating shared state.",
  }),
  commandPolicy({
    id: "runtime-governance-diagnostics",
    command: "aidn runtime governance-diagnostics --json",
    effectClass: "read-only",
    jsonContract: "runtime-governance-diagnostics.v1.schema.json",
    safeArgs: ["runtime", "governance-diagnostics", "--json"],
    notes: "Summarizes source-of-truth, metadata, and public CLI contract coverage without mutating the target.",
  }),
  commandPolicy({
    id: "runtime-list-agent-adapters",
    command: "aidn runtime list-agent-adapters --json",
    effectClass: "read-only",
    jsonContract: "runtime-list-agent-adapters.v1.schema.json",
    safeArgs: ["runtime", "list-agent-adapters", "--json"],
    notes: "Lists available agent adapters and auto-selection previews.",
  }),
  commandPolicy({
    id: "runtime-verify-agent-roster",
    command: "aidn runtime verify-agent-roster --json",
    effectClass: "read-only",
    jsonContract: "runtime-verify-agent-roster.v1.schema.json",
    safeArgs: ["runtime", "verify-agent-roster", "--json"],
    allowNonZero: true,
    notes: "Validates the agent roster and adapter environment without modifying the target.",
  }),
  commandPolicy({
    id: "runtime-pre-write-admit",
    command: "aidn runtime pre-write-admit --json",
    effectClass: "read-only",
    jsonContract: "runtime-pre-write-admit.v1.schema.json",
    safeArgs: ["runtime", "pre-write-admit", "--skill", "cycle-create", "--json"],
    notes: "Admission check only; it can block or warn but must not repair.",
  }),
  commandPolicy({
    id: "runtime-handoff-admit",
    command: "aidn runtime handoff-admit --json",
    effectClass: "read-only",
    jsonContract: "runtime-handoff-admit.v1.schema.json",
    safeArgs: ["runtime", "handoff-admit", "--json"],
    allowNonZero: true,
    notes: "Validates handoff readiness and routing without writing relay state.",
  }),
  commandPolicy({
    id: "runtime-coordinator-next-action",
    command: "aidn runtime coordinator-next-action --json",
    effectClass: "read-only",
    jsonContract: "runtime-coordinator-next-action.v1.schema.json",
    safeArgs: ["runtime", "coordinator-next-action", "--json"],
    notes: "Recommends the next route without executing it.",
  }),
  commandPolicy({
    id: "runtime-coordinator-dispatch-plan",
    command: "aidn runtime coordinator-dispatch-plan --json",
    effectClass: "preview",
    jsonContract: "runtime-coordinator-dispatch-plan.v1.schema.json",
    safeArgs: ["runtime", "coordinator-dispatch-plan", "--json"],
    notes: "Builds a dispatch plan without executing commands.",
  }),
  commandPolicy({
    id: "runtime-coordinator-orchestrate",
    command: "aidn runtime coordinator-orchestrate --json",
    effectClass: "preview",
    jsonContract: "runtime-coordinator-orchestrate.v1.schema.json",
    safeArgs: ["runtime", "coordinator-orchestrate", "--max-iterations", "1", "--json"],
    notes: "Stays a preview unless --execute is supplied.",
  }),
  commandPolicy({
    id: "runtime-project-runtime-state",
    command: "aidn runtime project-runtime-state --json",
    effectClass: "projector",
    jsonContract: "runtime-project-runtime-state.v1.schema.json",
    safeArgs: ["runtime", "project-runtime-state", "--dry-run", "--json"],
    noMutationPaths: ["docs/audit/RUNTIME-STATE.md"],
    notes: "Historical projector; --dry-run is the non-mutating automation path.",
  }),
  commandPolicy({
    id: "runtime-project-handoff-packet",
    command: "aidn runtime project-handoff-packet --json",
    effectClass: "projector",
    jsonContract: "runtime-project-handoff-packet.v1.schema.json",
    safeArgs: ["runtime", "project-handoff-packet", "--dry-run", "--json"],
    noMutationPaths: ["docs/audit/HANDOFF-PACKET.md"],
    notes: "Historical projector; --dry-run must not write local projection or shared relay.",
  }),
  commandPolicy({
    id: "codex-hydrate-context",
    command: "aidn codex hydrate-context --json",
    effectClass: "projector",
    jsonContract: "codex-hydrate-context.v1.schema.json",
    safeArgs: ["codex", "hydrate-context", "--skill", "context-reload", "--no-project-runtime-state", "--no-project-handoff-packet", "--json"],
    notes: "Hydrates local context; the listed safe args disable runtime digest projectors.",
  }),
]);

export function listEffectClasses() {
  return [...EFFECT_CLASSES];
}

export function listStabilityLevels() {
  return [...STABILITY_LEVELS];
}

export function listCliEffectPolicies() {
  return CLI_EFFECT_POLICIES.map((item) => ({
    ...item,
    safe_args: [...item.safe_args],
    no_mutation_paths: [...item.no_mutation_paths],
    allow_non_zero: Boolean(item.allow_non_zero),
  }));
}

export function getCliEffectPolicy(id) {
  const normalized = normalizeToken(id);
  const item = CLI_EFFECT_POLICIES.find((candidate) => candidate.id === normalized) ?? null;
  if (!item) {
    return null;
  }
  return {
    ...item,
    safe_args: [...item.safe_args],
    no_mutation_paths: [...item.no_mutation_paths],
    allow_non_zero: Boolean(item.allow_non_zero),
  };
}

export function validateCliEffectPolicies() {
  const issues = [];
  const seen = new Set();
  for (const item of CLI_EFFECT_POLICIES) {
    if (!item.id) {
      issues.push("policy missing id");
    }
    if (seen.has(item.id)) {
      issues.push(`duplicate policy id: ${item.id}`);
    }
    seen.add(item.id);
    if (!item.command.startsWith("aidn ")) {
      issues.push(`${item.id}: command must start with aidn`);
    }
    if (!EFFECT_CLASSES.includes(item.effect_class)) {
      issues.push(`${item.id}: invalid effect_class ${item.effect_class}`);
    }
    if (!STABILITY_LEVELS.includes(item.stability)) {
      issues.push(`${item.id}: invalid stability ${item.stability}`);
    }
    if (item.stability === "stable" && item.safe_args.length === 0) {
      issues.push(`${item.id}: stable command missing safe_args`);
    }
    if (item.effect_class === "projector" && item.no_mutation_paths.length > 0 && !item.safe_args.includes("--dry-run")) {
      issues.push(`${item.id}: projector with no_mutation_paths must include --dry-run in safe_args`);
    }
    if (item.json_contract && !item.json_contract.endsWith(".schema.json")) {
      issues.push(`${item.id}: json_contract must be a schema file`);
    }
  }
  return {
    ok: issues.length === 0,
    policy_count: CLI_EFFECT_POLICIES.length,
    effect_classes: listEffectClasses(),
    stability_levels: listStabilityLevels(),
    issues,
  };
}
