// Activation describes availability, independently of the command's logical
// effect class. Keep this module pure so the registry and dispatcher share it.
const MAINTENANCE = new Set([
  "db-backup", "db-migrate", "db-status", "db-only-readiness",
  "persistence-backup", "persistence-adopt", "persistence-source-diagnose",
  "persistence-source-normalize", "persistence-migrate", "persistence-status",
  "visible-artifacts-cleanup", "visible-artifacts-restore",
  "shared-runtime-reanchor", "state-reanchor",
  "shared-coordination-backup", "shared-coordination-restore",
  "shared-coordination-doctor", "shared-coordination-migrate",
  "shared-coordination-bootstrap", "shared-coordination-status",
  "shared-coordination-projects", "governance-diagnostics",
  "list-agent-adapters", "verify-agent-roster", "mode-migrate",
]);
const decision = (category, requires_activation = false) => ({ requires_activation, category });

// run-json-hook accepts a subprocess after --. Its options cannot authorize the
// wrapper or turn a child's --help into a bypass of the wrapper's activation.
export function activationOptionArgs(args = []) {
  const separator = args.indexOf("--");
  return separator < 0 ? [...args] : args.slice(0, separator);
}

export function classifyCliActivation(descriptor, args = []) {
  args = activationOptionArgs(args);
  if (descriptor?.dispatch_kind === "builtin") return decision("information");
  if (descriptor?.visibility === "internal" && descriptor.group === "perf" && descriptor.name.startsWith("verify-")) return decision("source-verification");
  if (descriptor?.visibility === "internal" && descriptor.group === "codex" && descriptor.name === "normalize-hook-payload") return decision("normalization");
  if (descriptor?.group === "root" && ["bootstrap", "install"].includes(descriptor.name)) return decision("installation");
  if (descriptor?.group === "root" && descriptor.name === "build-release") return decision("source-release");
  if (descriptor?.group === "project" && descriptor.name === "config") return decision("maintenance");
  if (descriptor?.group === "runtime") {
    // This command keeps its admission contract and guards itself before its
    // backend loads; it must not acquire the generic refusal shape.
    if (descriptor.name === "pre-write-admit") return decision("self-guarded");
    if (MAINTENANCE.has(descriptor.name)) return decision("maintenance");
    if (descriptor.name === "local-daemon") {
      const actions = ["--start", "--serve", "--status", "--stop"].filter((flag) => args.includes(flag));
      if (actions.length === 1 && ["--status", "--stop"].includes(actions[0])) return decision("maintenance");
    }
  }
  // Preserve installation, maintenance and internal parser contracts. Only a
  // normally gated workflow needs dispatcher-level help precedence.
  if (args.includes("--help") || args.includes("-h")) return decision("help");
  // Workflow dispatch is guarded independently of visibility. Source fixture
  // entry points remain usable; direct node tools/... execution is unaffected.
  return decision("workflow", true);
}

export function commandMayRefuseActivation(descriptor) {
  return classifyCliActivation(descriptor).requires_activation;
}

// Internal tools have no public effect-policy authority. Their refusal uses a
// conservative mutating default, with reviewed read-only/projector exceptions.
// This classification never adds an internal tool to the public effect catalog.
const INTERNAL_READ_ONLY = new Set([
  "report", "index-verify-sqlite", "index-query", "structure", "index-verify",
]);
const INTERNAL_PROJECTORS = new Set([
  "fallback-report", "constraint-report", "constraint-actions", "constraint-trend",
  "constraint-trend-summary", "constraint-lot-plan", "constraint-lot-summary", "constraint-summary",
  "index-sync-report", "index-from-sqlite", "index-export-files", "index-canonical-check",
  "index-canonical-summary", "index-regression-kpi", "index-sql", "index-report", "render-summary", "audit-review",
  "index-select-paths", "index-thresholds", "index-sync-thresholds", "check-thresholds",
  "check-regression", "check-fallbacks", "check-constraints", "check-constraint-trend", "index-regression",
]);
export function resolveInternalCliEffectClass(descriptor, args = []) {
  if (descriptor?.visibility !== "internal") throw new Error("Internal CLI effect classification requires an internal descriptor");
  const options = activationOptionArgs(args);
  if (options.includes("--help") || options.includes("-h")) return "read-only";
  if (options.includes("--dry-run")) return "preview";
  if (descriptor.group === "codex" && descriptor.name === "normalize-hook-payload") return "read-only";
  if (descriptor.group === "perf" && INTERNAL_READ_ONLY.has(descriptor.name)) return "read-only";
  if (descriptor.group === "perf" && INTERNAL_PROJECTORS.has(descriptor.name)) return "projector";
  return "mutating";
}
