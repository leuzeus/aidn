// Derived presentation only. Evaluate canonical admission/routing first; never
// accept a projected observation as a reusable authorization or retained proof.
const clone = value => structuredClone(value);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, clone(value[key])]));

function workspaceIdentity(value) {
  if (!value) return value;
  return pick(value, ["project_id", "workspace_id", "worktree_id", "head_commit", "target_root", "project_root",
    "worktree_root", "git_common_dir", "is_git_repo", "is_linked_worktree", "shared_runtime_enabled",
    "shared_runtime_mode", "shared_runtime_root", "shared_backend_kind", "shared_runtime_connection_ref",
    "shared_runtime_projection_policy", "shared_runtime_locator_ref"]);
}

function backendIdentity(value) {
  if (!value) return value;
  const result = pick(value, ["shared_runtime_mode", "coordination_backend_kind", "projection_backend_kind", "projection_scope", "logical_root", "exists"]);
  if (value.runtime_backend) result.runtime_backend = {
    ...pick(value.runtime_backend, ["backend_kind", "scope", "schema_name", "schema_version", "runtime_scope_id", "scope_key", "legacy_scope_key", "target_root"]),
    connection: pick(value.runtime_backend.connection, ["ok", "status", "source", "connection_ref", "env_key", "message", "error", "errors", "warnings"]),
  };
  return result;
}

const freshOutput = (command, args) => ({ command, args, requires_fresh_read: true, retained: false });

export function projectAgentDecisionError(kind, error) {
  if (!["pre-write-admit", "coordinator-next-action"].includes(kind)) throw new Error("Unknown agent decision kind");
  return { contract_version: `runtime-${kind}-agent.v1`, command: `aidn runtime ${kind} --view agent --json`,
    view: "agent", effect_class: "read-only", [kind === "pre-write-admit" ? "reusable_write_authorization" : "write_authorization"]: false,
    ok: false, stop_required: true, error: {
      code: /^[A-Z0-9_]{1,80}$/.test(error?.code ?? "") ? error.code : "AGENT_DECISION_UNAVAILABLE",
      message: "Decision unavailable; inspect full diagnostics and restore canonical prerequisites before continuing.",
    } };
}

export function projectAdmissionAgentView(payload) {
  const result = {
    contract_version: "runtime-pre-write-admit-agent.v1", view: "agent", effect_class: "read-only",
    command: "aidn runtime pre-write-admit --view agent --json", reusable_write_authorization: false,
    ...pick(payload, ["ok", "admission_status", "admission_kind", "generic_admission_status", "target_root", "skill",
      "activation", "policy", "context", "checks", "blocking_reasons", "warnings", "blocking_findings", "prioritized_artifacts",
      "current_state_file", "runtime_state_file", "session_file", "cycle_status_file", "plan_file", "source_revision", "write_decision"]),
    workspace: workspaceIdentity(payload.workspace), shared_state_backend: backendIdentity(payload.shared_state_backend),
    shared_runtime_validation: clone(payload.shared_runtime_validation ?? null),
    blocking_findings: clone(payload.blocking_findings ?? []),
    source_of_truth: pick(payload.source_of_truth, ["state_mode", "runtime_state_mode", "observed_sources", "issues", "repair_actions"]),
    full_output: freshOutput("aidn runtime pre-write-admit", ["--target", payload.target_root, "--skill", payload.skill,
      ...(payload.admission_kind === "specific" ? ["--native-request-stdin"] : []), "--json"]),
  };
  return result;
}

export function projectNextActionAgentView(payload) {
  if (payload == null) return payload;
  const result = clone(payload);
  if (result.handoff && typeof result.handoff === "object") {
    delete result.handoff.packet;
    if (result.handoff.workspace) result.handoff.workspace = workspaceIdentity(result.handoff.workspace);
    if (result.handoff.shared_state_backend) result.handoff.shared_state_backend = backendIdentity(result.handoff.shared_state_backend);
    // Only remove exact duplicates. Legacy observations may differ in revision.
    if (JSON.stringify(result.handoff.packet_resolution) === JSON.stringify(result.packet_resolution)) delete result.handoff.packet_resolution;
  }
  if (result.context && JSON.stringify(result.context.packet_resolution) === JSON.stringify(result.packet_resolution)) delete result.context.packet_resolution;
  return { ...result, contract_version: "runtime-coordinator-next-action-agent.v1", view: "agent", effect_class: "read-only",
    command: "aidn runtime coordinator-next-action --view agent --json", write_authorization: false,
    full_output: freshOutput("aidn runtime coordinator-next-action", ["--target", payload.target_root, "--json"]) };
}
