import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { projectNextActionAgentView } from "../runtime/agent-decision-projection.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));

export function validateAgentViewOptions(args, hook = false) {
  if (args.view !== undefined && !["full", "agent"].includes(args.view)) throw new Error("Invalid --view. Expected full|agent");
  if (args.write !== undefined && typeof args.write !== "boolean") throw new Error("Diagnostic receipt write intent must be boolean");
  if (hook && args.view === "agent" && (args.verbose || args.includeRaw)) throw new Error("Agent view conflicts with --verbose or --include-raw");
}

export function describeStoredEvidence(file) {
  if (!file) return null;
  const bytes = fs.readFileSync(file);
  return { path: file, sha256: hash(bytes), bytes: bytes.length };
}

// A selected view never creates an audit record. Explicit --write retains a
// complete diagnostic observation, with no canonical or write-admission role.
export function persistAgentViewReceipt({ write, targetRoot, kind, payload }) {
  if (write !== true) return null;
  if (!["workflow-step", "run-json-hook"].includes(kind)) throw new Error("Unknown diagnostic receipt kind");
  const root = fs.realpathSync.native(path.resolve(targetRoot));
  let directory = root;
  for (const segment of [".aidn", "runtime", "context", "agent-view-receipts", kind]) {
    directory = path.join(directory, segment);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    const real = fs.realpathSync.native(directory), relative = path.relative(root, real);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("Diagnostic receipt directory escapes the worktree");
    directory = real;
  }
  const file = path.join(directory, `${randomUUID()}.json`);
  const content = JSON.stringify({ contract_version: "agent-view-receipt.v1", kind,
    observed_at: new Date().toISOString(), scope: "worktree-local", write_authorization: false, observation: payload }) + "\n";
  writeFileAtomicSync(file, content, { encoding: "utf8" });
  const receipt = describeStoredEvidence(file);
  if (receipt.sha256 !== hash(content)) throw new Error("Diagnostic receipt readback mismatch");
  return receipt;
}

const CONTEXT_FIELDS = ["workspace_id", "worktree_id", "mode", "branch_kind", "active_session", "session_branch",
  "active_cycle", "cycle_branch", "cycle_state", "dor_state", "first_plan_step", "effective_state_mode",
  "current_state_freshness", "source_of_truth_status", "source_of_truth_reason_codes", "repair_layer_status"];
const DECISION_FIELDS = ["ok", "decision", "action", "result", "reason_codes", "reason_code", "blocking_reasons",
  "recommended_next_action", "repair_layer_open_count", "repair_layer_blocking", "repair_layer_status",
  "repair_layer_advice", "repair_primary_reason", "repair_layer_top_findings", "error"];

export function projectWorkflowAgentView(payload, receipt = null, projectionProfile = null) {
  if (projectionProfile !== null && projectionProfile !== "compact.v1") throw new Error("Unknown agent projection profile");
  const artifacts = new Map();
  const metadata = new Map();
  const contexts = Object.entries(payload.hydrations ?? {}).map(([skill, hydrated]) => {
    const source = pick(hydrated, ["target_root", "source_revision", "source_backend", "runtime_scope_id", "project_id", "workspace_id", "state_mode"]);
    const refs = (hydrated.artifacts ?? []).map(artifact => {
      let projected = artifact;
      if (payload.selection_policy?.mode === "scoped" && artifact.canonical && typeof artifact.canonical === "object") {
        // Parsed whole-document sections and inferred runtime/session fields are
        // not additional selected units. Keep source identity once, without
        // reinjecting unselected source bodies through derived metadata.
        const binding = { source, path: artifact.path, sha256: artifact.sha256,
          canonical: pick(artifact.canonical, ["schema_version", "format", "artifact_class", "title", "stats"]) };
        const reference = hash(JSON.stringify(binding));
        if (!metadata.has(reference)) metadata.set(reference, { id: reference, ...structuredClone(binding) });
        const { canonical, ...unit } = artifact;
        projected = { ...unit, canonical_ref: reference };
      }
      const id = hash(JSON.stringify({ source, artifact: projected }));
      if (!artifacts.has(id)) artifacts.set(id, { id, source, artifact: projected });
      return id;
    });
    return { skill, ...source, artifact_refs: refs, bundle_budget: hydrated.bundle_budget ?? null,
      decisions: Object.fromEntries(Object.entries(hydrated.decisions ?? {}).map(([name, entry]) => [name, pick(entry, DECISION_FIELDS)])),
      recent_history: payload.history_view === "transitions" ? structuredClone(hydrated.recent_history ?? [])
        : (hydrated.recent_history ?? []).map(entry => pick(entry, ["skill", "ts", "execution_id", ...DECISION_FIELDS])),
      repair_layer: hydrated.repair_layer ?? null };
  });
  const projected = {
    ts: payload.ts, ok: payload.ok, contract_version: "codex-workflow-step-agent.v1",
    command: "aidn codex workflow-step --view agent --json", effect_class: payload.effect_class,
    view: "agent", target_root: payload.target_root, mode: payload.mode,
    skills: payload.skills, workspace: payload.workspace, summary: payload.summary,
    observation_scope: payload.observation?.scope ?? "per-skill", write_authorization: false,
    ...(payload.observation ? { observation: payload.observation } : {}),
    admissions: Object.entries(payload.admissions ?? {}).map(([skill, admission]) => ({
      skill, ok: admission.ok === true, admission_status: admission.admission_status ?? "unknown",
      admission_kind: admission.admission_kind ?? "generic", context: pick(admission.context, CONTEXT_FIELDS),
      activation: { ...structuredClone(admission.activation ?? { state: "unknown" }),
        active: typeof admission.activation?.active === "boolean" ? admission.activation.active : null },
      blocking_reasons: admission.blocking_reasons ?? [], warnings: admission.warnings ?? [],
      blocking_findings: admission.blocking_findings ?? [],
      source_of_truth: pick(admission.source_of_truth, ["state_mode", "runtime_state_mode", "issues", "repair_actions",
        ...(payload.observation ? ["observed_sources"] : [])]),
    })),
    contexts, artifacts: [...artifacts.values()], next_action: payload.next_action,
    ...(payload.artifact_consultation?{artifact_consultation:structuredClone(payload.artifact_consultation)}:{}),
    ...(metadata.size ? { artifact_metadata: [...metadata.values()] } : {}),
    ...(payload.selection_policy ? { selection_policy: payload.selection_policy } : {}),
    ...(payload.context_selection ? { context_selection: structuredClone(payload.context_selection) } : {}),
    ...(payload.context_delta ? { context_delta: structuredClone(payload.context_delta) } : {}),
    ...(payload.history_view ? { history_view: payload.history_view } : {}),
    receipt,
  };
  if (projectionProfile === "compact.v1") {
    projected.contract_version = "codex-workflow-step-agent-compact.v1";
    projected.command = "aidn codex workflow-step --view agent --projection-profile compact.v1 --json";
    projected.projection_profile = "compact.v1";
    projected.next_action = projectNextActionAgentView(payload.next_action);
  }
  return projected;
}

export function projectHookAgentView(payload, receipt = null) {
  return {
    contract_version: "codex-hook-agent.v1", view: "agent", write_authorization: false,
    ...pick(payload, ["ts", "skill", "mode", "state_mode", "strict", "fallback", "command_status", "context_file", ...DECISION_FIELDS]),
    db_sync: pick(payload.db_sync, ["enabled", "skipped", "reason", "error"]),
    evidence: { raw: describeStoredEvidence(payload.raw_file), full: receipt },
  };
}
