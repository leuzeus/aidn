import path from "node:path";
import { createAgentRunLifecycle } from "./agent-run-lifecycle-service.mjs";
import { readAgentRunConfiguration, readAgentRunFile, agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { resolveWorkspaceContext } from "./workspace-resolution-service.mjs";
import { resolveEffectiveRuntimePersistence } from "./runtime-persistence-service.mjs";
import { resolvePostgresRuntimePersistenceConnection } from "./postgres-runtime-persistence-contract-service.mjs";
import { resolvePostgresSharedCoordinationConnection } from "./postgres-shared-coordination-contract-service.mjs";
import { createPostgresAgentExecutionStore } from "../../adapters/runtime/postgres-agent-execution-store.mjs";
import { readActivation } from "../install/project-activation-service.mjs";
import { normalizeAgentExecutionPlan, fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";
import { describeAgentRunAssurance } from "./agent-run-assurance-policy.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const key = value => process.platform === "win32" ? value.toLowerCase() : value;
export function verifyAgentRunActivation(targetRoot, expected) {
  const current = readActivation({ targetRoot });
  return current.active === true && current.state === "active"
    && current.authorization?.authority_id === expected.authority_id
    && current.authorization?.revision === expected.revision
    && current.authorization?.status === "authorized";
}
function materialSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    lifecycle_status: snapshot.run.lifecycle_status, reservation_active: snapshot.reservation_active,
    control_revision: snapshot.supervision.control_revision,
    supervisor: snapshot.supervision.current ? { ownership: snapshot.supervision.current.ownership,
      runner: snapshot.supervision.current.runner, status: snapshot.supervision.current.status,
      lease_live: snapshot.supervision.current.lease_live, termination: snapshot.supervision.current.termination } : null,
    cancel_request: snapshot.cancel_request ?? null,
    integration_head: snapshot.integration_head,
    attempts: snapshot.attempts.map(row => ({
      attempt_id: row.attempt.attempt_id, task_id: row.attempt.task_id, lifecycle_status: row.attempt.lifecycle_status,
      ownership: row.attempt.ownership, input_sha: row.attempt.input_sha,
      result_sha256: row.result ? fingerprintAgentExecutionValue(row.result) : null,
      termination_sha256: row.termination ? fingerprintAgentExecutionValue(row.termination) : null,
      reconciliation_sha256: row.reconciliation ? fingerprintAgentExecutionValue(row.reconciliation) : null,
    })),
    acceptances: snapshot.acceptances.map(row => row.acceptance_sha256),
    integration_intents: (snapshot.integration_intents ?? []).map(row => ({ intent_sha256: row.intent_sha256, status: row.status })),
    integrations: snapshot.integrations.map(row => ({ prepared_sha256: row.prepared_sha256, applied_sha256: row.applied_sha256 ?? null })),
    validation_sha256: snapshot.final_validation?.validation_sha256 ?? null,
    cleanup: snapshot.cleanup ? { current: snapshot.cleanup.current ? {
      cleanup_sha256: snapshot.cleanup.current.cleanup_sha256, ownership: snapshot.cleanup.current.ownership,
      status: snapshot.cleanup.current.status, lease_live: snapshot.cleanup.current.lease_live,
    } : null, resources: snapshot.cleanup.resources.map(row => ({ resource_sha256: row.resource_sha256, result_sha256: row.result_sha256 })) } : null,
  };
}

export function createPublicAgentRunLifecycle() {
  // The secret connection value never enters returned contexts/action documents.
  const dependencies = new WeakMap();
  async function readContext(args) {
    const targetRoot = agentRunPhysicalPath(path.resolve(args.target), { directory: true });
    const selected = readAgentRunConfiguration(path.resolve(args.configuration)), configuration = selected.configuration;
    if (key(targetRoot) !== key(agentRunPhysicalPath(configuration.target_root, { directory: true }))) fail("AGENT_RUN_TARGET_MISMATCH");
    const workspace = resolveWorkspaceContext({ targetRoot });
    if (workspace.shared_runtime_mode !== "shared-runtime" || workspace.shared_backend_kind !== "postgres") fail("AGENT_RUN_POSTGRES_REQUIRED");
    const shared = resolvePostgresSharedCoordinationConnection({ workspace });
    const persistence = resolveEffectiveRuntimePersistence({ targetRoot });
    const canonical = resolvePostgresRuntimePersistenceConnection({ connectionRef: persistence.connectionRef });
    if (!shared.ok || persistence.backend !== "postgres" || !canonical.ok
      || shared.connection_string !== canonical.connection_string) fail("AGENT_RUN_CANONICAL_BACKEND_MISMATCH");
    const verifyActivation = expected => verifyAgentRunActivation(targetRoot, expected);
    const store = createPostgresAgentExecutionStore({ connectionString: shared.connection_string, verifyActivation });
    if (!(await store.checkReadiness()).ready) fail("AGENT_RUN_SCHEMA_NOT_READY");
    const runId = args.command === "agent-run" ? configuration.run_id : args.run;
    const snapshot = await store.getRun({ runId });
    if (args.command !== "agent-run" && !snapshot) fail("AGENT_RUN_NOT_FOUND");
    const plan = normalizeAgentExecutionPlan(args.command === "agent-run" ? readAgentRunFile(path.resolve(args.plan)).value : snapshot.plan);
    if (plan.supervision?.configuration_sha256 !== selected.configuration_sha256) fail("AGENT_RUN_CONFIGURATION_CHANGED");
    if (plan.canonical.project_id !== workspace.project_id || plan.canonical.workspace_id !== workspace.workspace_id) fail("AGENT_RUN_WORKSPACE_MISMATCH");
    const blockers = [];
    let read = null;
    try { read = await store.readCanonicalDigest({ scopeKey: plan.canonical.runtime_scope_id }); }
    catch (cause) { if (args.command === "agent-run" || args.command === "agent-run-resume" && !snapshot.cancel_request) throw cause; }
    const activation = readActivation({ targetRoot });
    const preconditions = {
      blockers, canonical_snapshot_sha256: read?.canonical_snapshot_sha256 ?? snapshot?.canonical_snapshot_sha256 ?? null,
      canonical_available: read !== null,
      activation: { active: activation.active, state: activation.state,
        authority_id: activation.authorization?.authority_id ?? null, revision: activation.authorization?.revision ?? null },
    };
    if (args.command === "agent-run") {
      if (snapshot) blockers.push("AGENT_RUN_ALREADY_EXISTS");
      if (!verifyActivation(plan.canonical.activation)) blockers.push("AGENT_RUN_ACTIVATION_INVALID");
      try { await store.previewRunReservation({ plan, runId, planningKey: configuration.planning_key, canonicalSnapshotSha256: read.canonical_snapshot_sha256 }); }
      catch (cause) { blockers.push(/^[A-Z0-9_]+$/.test(cause.code ?? "") ? cause.code : "AGENT_RUN_RESERVATION_UNAVAILABLE"); }
    }
    if (args.command === "agent-run-resume") {
      if (["completed", "failed", "cancelled"].includes(snapshot.run.lifecycle_status)) blockers.push("AGENT_RUN_TERMINAL");
      if (!snapshot.cancel_request && !verifyActivation(plan.canonical.activation)) blockers.push("AGENT_RUN_ACTIVATION_INVALID");
    }
    if (args.command === "agent-run-cancel" && ["completed", "failed", "cancelled"].includes(snapshot.run.lifecycle_status)) blockers.push("AGENT_RUN_TERMINAL");
    if (args.command === "agent-run-cancel" && snapshot.cancel_request) blockers.push("AGENT_RUN_CANCELLATION_ALREADY_REQUESTED");
    if (args.command === "agent-run-cleanup" && snapshot.run.lifecycle_status !== "completed") blockers.push("AGENT_RUN_CLEANUP_RETAINS_UNSUCCESSFUL_RUN");
    if (plan.contract_version === "agent-execution-plan.v2") preconditions.native = describeAgentRunAssurance(plan);
    const context = { plan, configuration, snapshot, preconditions,
      targetIdentity: { target_root: targetRoot, worktree_id: workspace.worktree_id,
        project_id: workspace.project_id, workspace_id: workspace.workspace_id, git_common_dir: workspace.git_common_dir },
      materialState: materialSnapshot(snapshot), resources: [] };
    dependencies.set(context, { connectionString: shared.connection_string, verifyActivation, workspace, store });
    if (args.command !== "agent-run-status" && args.command !== "agent-run-cancel") {
      const { inspectNativeAgentRun } = await import("./agent-run-native-runtime-service.mjs");
      const inspected = await inspectNativeAgentRun({ args, context, ...dependencies.get(context) });
      blockers.push(...inspected.blockers); context.resources = inspected.resources;
      preconditions.native = inspected.material;
    }
    return context;
  }
  async function createRuntime(args, context) {
    const selected = dependencies.get(context);
    if (!selected) fail("AGENT_RUN_CONTEXT_NOT_OBSERVED");
    if (args.command === "agent-run-cancel") return { store: selected.store, close: async () => {} };
    const { createNativeAgentRunRuntime } = await import("./agent-run-native-runtime-service.mjs");
    return createNativeAgentRunRuntime({ args, context, ...selected });
  }
  return createAgentRunLifecycle({ readContext, createRuntime });
}
