import { randomUUID } from "node:crypto";
import { fingerprintAgentExecutionValue, normalizeAgentExecutionPlan } from "../../core/agents/agent-execution-contracts.mjs";
import { previewWorkflowSegment, requiresWorkflowSegmentCompilation } from "../../core/workflow/workflow-segment-binding.mjs";

const ACTIONS = new Set(["agent-run", "agent-run-status", "agent-run-resume", "agent-run-cancel", "agent-run-cleanup"]);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const copy = value => structuredClone(value);
const safeCode = cause => /^[A-Z][A-Z0-9_]{0,100}$/.test(cause?.code ?? "") ? cause.code : "AGENT_RUN_UNAVAILABLE";

// Parsing has no environment, filesystem, clock, discovery or process effects.
export function parseAgentRunArguments(command, argv) {
  if (!ACTIONS.has(command)) fail("AGENT_RUN_COMMAND_INVALID");
  const value = { command, target: ".", configuration: null, plan: null, run: null, expectPlan: null,
    execute: false, write: false, syncRelay: false, json: false, dryRun: false, help: false };
  const values = new Map([["--target", "target"], ["--configuration", "configuration"], ["--plan", "plan"],
    ["--run", "run"], ["--expect-plan", "expectPlan"]]);
  const flags = new Map([["--execute", "execute"], ["--write", "write"], ["--sync-relay", "syncRelay"],
    ["--json", "json"], ["--dry-run", "dryRun"], ["--help", "help"], ["-h", "help"]]);
  // Help always returns before runtime configuration or availability is read.
  if (argv.includes("--help") || argv.includes("-h")) return { ...value, help: true, json: argv.includes("--json") };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (seen.has(token)) fail("AGENT_RUN_DUPLICATE_ARGUMENT");
    seen.add(token);
    if (flags.has(token)) value[flags.get(token)] = true;
    else if (values.has(token)) {
      const next = argv[++index];
      if (typeof next !== "string" || !next.trim() || next.startsWith("--")) fail("AGENT_RUN_ARGUMENT_VALUE_REQUIRED");
      value[values.get(token)] = next;
    } else fail("AGENT_RUN_UNKNOWN_ARGUMENT");
  }
  if (value.execute && value.write || value.dryRun && (value.execute || value.write || value.syncRelay)) fail("AGENT_RUN_EFFECT_CONFLICT");
  if (command === "agent-run-status" && (value.execute || value.write || value.syncRelay || value.expectPlan)) fail("AGENT_RUN_STATUS_READ_ONLY");
  if (value.write && command !== "agent-run-cleanup" || value.execute && command === "agent-run-cleanup") fail("AGENT_RUN_EFFECT_CONFLICT");
  if (value.plan && command !== "agent-run" || value.run && command === "agent-run") fail("AGENT_RUN_SELECTOR_INVALID");
  if (value.run !== null && !ID.test(value.run)) fail("AGENT_RUN_ID_INVALID");
  if (value.expectPlan !== null && !HASH.test(value.expectPlan)) fail("AGENT_RUN_EXPECT_PLAN_INVALID");
  if ((value.execute || value.write) && (!value.expectPlan || !value.syncRelay)) fail("AGENT_RUN_EXPLICIT_EFFECT_REQUIRED");
  if (value.syncRelay && !value.execute && !value.write) fail("AGENT_RUN_EFFECT_CONFLICT");
  if (!value.configuration) fail("AGENT_RUN_CONFIGURATION_REQUIRED");
  if (command === "agent-run" ? !value.plan : !value.run) fail("AGENT_RUN_SELECTOR_REQUIRED");
  return Object.freeze(value);
}

export function agentRunEffect(args) {
  if (args.help || args.command === "agent-run-status") return "read-only";
  return args.write ? "mutating" : args.execute ? "executor" : "preview";
}

export function projectAgentRunStatus(snapshot) {
  if (!snapshot) return null;
  return {
    run_id: snapshot.run.run_id, plan_sha256: snapshot.run.plan_sha256,
    execution_status: snapshot.run.lifecycle_status,
    control_revision: snapshot.supervision?.control_revision ?? 0,
    supervisor_generation: snapshot.supervision?.current?.ownership?.generation ?? null,
    cancellation: snapshot.cancel_request ? { status: "requested", request_sha256: snapshot.cancel_request.request_sha256 } : { status: "not_requested" },
    integration: { ref: snapshot.integration_head?.ref ?? null, sha: snapshot.integration_head?.sha ?? null,
      sequence: snapshot.integration_head?.sequence ?? 0, pending: (snapshot.integration_intents ?? []).filter(row => row.status !== "applied").length },
    validation: snapshot.final_validation ? { status: snapshot.final_validation.validation.outcome,
      sha: snapshot.final_validation.validation.integrated_sha, evidence_sha256: snapshot.final_validation.validation_sha256 } : { status: "not_requested", sha: null, evidence_sha256: null },
    cleanup: snapshot.cleanup?.current ? {
      status: snapshot.cleanup.current.status, cleanup_id: snapshot.cleanup.current.cleanup.cleanup_id,
      cleanup_sha256: snapshot.cleanup.current.cleanup_sha256,
      generation: snapshot.cleanup.current.ownership.generation,
      resources: snapshot.cleanup.resources.map(row => ({ resource_id: row.resource.resource_id,
        kind: row.resource.kind, status: row.result?.outcome ?? "pending",
        resource_sha256: row.resource_sha256, result_sha256: row.result_sha256 ?? null,
        evidence: copy(row.result?.evidence ?? []) })),
    } : { status: "not_requested" },
    attempts: (snapshot.attempts ?? []).map(row => ({
      task_id: row.attempt.task_id, attempt_id: row.attempt.attempt_id, ordinal: row.attempt.ordinal,
      input_sha: row.attempt.input_sha, status: row.attempt.lifecycle_status,
      outcome: row.result?.outcome ?? null, exit_code: row.result?.process?.exit_code ?? null,
      termination_state: row.reconciliation_termination_state ?? row.result?.termination_state ?? null,
      acceptance: snapshot.acceptances?.find(item => item.acceptance.attempt_id === row.attempt.attempt_id)?.acceptance.decision ?? null,
      evidence: copy(row.result?.evidence ?? []),
    })),
  };
}

export function buildAgentRunActionPreview(args, context) {
  const plan = normalizeAgentExecutionPlan(context.plan);
  const configurationSha256 = fingerprintAgentExecutionValue(context.configuration);
  if (plan.supervision?.configuration_sha256 !== configurationSha256) fail("AGENT_RUN_CONFIGURATION_CHANGED");
  const runId = args.command === "agent-run" ? context.configuration.run_id : args.run;
  if (runId !== context.configuration.run_id || !ID.test(runId)) fail("AGENT_RUN_ID_MISMATCH");
  if (context.snapshot && (context.snapshot.run.run_id !== runId || context.snapshot.run.plan_sha256 !== plan.plan_sha256)) fail("AGENT_RUN_BINDING_CHANGED");
  const preconditions = copy(context.preconditions);
  if (!preconditions || !Array.isArray(preconditions.blockers)) fail("AGENT_RUN_PRECONDITIONS_REQUIRED");
  if (context.configuration.contract_version === "agent-run-configuration.v2") {
    preconditions.workflow = previewWorkflowSegment(context.configuration.workflow, plan,
      { compile: requiresWorkflowSegmentCompilation(args.command, context.snapshot) });
  }
  // Read adapters must provide material facts explicitly. Heartbeat timestamps,
  // server time and lease expiry timestamps are deliberately not hashed; their
  // currently valid/invalid classification, generation and revision are hashed.
  const action = {
    contract_version: "agent-run-action.v1", command: args.command, run_id: runId,
    plan_sha256: plan.plan_sha256, configuration_sha256: configurationSha256,
    target_identity: copy(context.targetIdentity), preconditions,
    material_state: copy(context.materialState ?? null),
    resources: copy(context.resources ?? []),
  };
  const expected = fingerprintAgentExecutionValue(action);
  return {
    contract_version: "runtime-agent-run.v1", command: "aidn runtime " + args.command,
    effect_class: agentRunEffect(args), dry_run: !args.execute && !args.write,
    written: false, shared_coordination_sync: false,
    run_id: runId, plan_sha256: plan.plan_sha256, action_sha256: expected,
    can_apply: args.command !== "agent-run-status" && preconditions.blockers.length === 0,
    status: projectAgentRunStatus(context.snapshot), action, errors: [], warnings: [],
  };
}

export function agentRunFailure(args, cause, previous = null, written = false) {
  return {
    contract_version: "runtime-agent-run.v1", command: "aidn runtime " + args.command,
    effect_class: agentRunEffect(args), dry_run: !args.execute && !args.write, written,
    shared_coordination_sync: written, run_id: previous?.run_id ?? args.run ?? null,
    plan_sha256: previous?.plan_sha256 ?? null, action_sha256: previous?.action_sha256 ?? null,
    can_apply: false, status: previous?.status ?? null, action: previous?.action ?? null,
    errors: [safeCode(cause)], warnings: [],
  };
}

// The public composition supplies the real PostgreSQL/native adapters. Tests may
// inject doubles here, but the CLI has no module loader or fixture switch.
export function createAgentRunLifecycle({ readContext, createRuntime, makeId = randomUUID } = {}) {
  if (typeof readContext !== "function" || typeof createRuntime !== "function") fail("AGENT_RUN_DEPENDENCIES_REQUIRED");
  return Object.freeze({
    async invoke(args, { signal } = {}) {
      let preview = null, runtime = null, written = false, output = null;
      const deliver = value => { output = value; return value; };
      try {
        const first = await readContext(args);
        preview = buildAgentRunActionPreview(args, first);
        if (!args.execute && !args.write) return deliver(preview);
        if (preview.action_sha256 !== args.expectPlan) fail("AGENT_RUN_PREVIEW_CHANGED");
        if (!preview.can_apply) fail("AGENT_RUN_PRECONDITIONS_FAILED");
        const current = await readContext(args);
        const confirmed = buildAgentRunActionPreview(args, current);
        if (confirmed.action_sha256 !== args.expectPlan || !confirmed.can_apply) fail("AGENT_RUN_PREVIEW_CHANGED");
        if (signal?.aborted) fail("AGENT_RUN_CANCELLED_BEFORE_EFFECT");
        runtime = await createRuntime(args, current);
        const runId = confirmed.run_id, configuration = current.configuration;
        if (args.command === "agent-run") {
          await runtime.store.reserveRun({ plan: current.plan, runId, planningKey: configuration.planning_key,
            canonicalSnapshotSha256: current.preconditions.canonical_snapshot_sha256 });
          written = true;
          const outcome = await runtime.scheduler.run({ runId, ownerId: runtime.ownerId, runner: runtime.runner, signal });
          return deliver({ ...confirmed, written: true, shared_coordination_sync: true, can_apply: false,
            status: projectAgentRunStatus(outcome.snapshot), errors: outcome.status === "completed" ? [] : [outcome.reason_code ?? "AGENT_RUN_NOT_COMPLETED"] });
        }
        if (args.command === "agent-run-cancel") {
          const snapshot = await runtime.store.requestCancel({ runId,
            expectedControlRevision: current.snapshot.supervision.control_revision,
            expectedSupervisorGeneration: current.snapshot.supervision.current?.ownership?.generation ?? 0,
            request: { contract_version: "agent-cancel-request.v1", request_id: makeId(), run_id: runId,
              plan_sha256: current.plan.plan_sha256, reason: "operator_requested" } });
          written = true;
          return deliver({ ...confirmed, written, shared_coordination_sync: true, can_apply: false, status: projectAgentRunStatus(snapshot) });
        }
        if (args.command === "agent-run-resume") {
          const reconciliation = await runtime.observeReconciliation(current);
          // A resume may durably fence/reconcile before its terminal outcome.
          written = true;
          const outcome = await runtime.scheduler.resume({ runId, ownerId: runtime.ownerId, runner: runtime.runner, signal, reconciliation });
          return deliver({ ...confirmed, written, shared_coordination_sync: true, can_apply: false,
            status: projectAgentRunStatus(outcome.snapshot), errors: ["completed", "cancelled"].includes(outcome.status) ? [] : [outcome.reason_code ?? "AGENT_RUN_NOT_COMPLETED"] });
        }
        if (args.command === "agent-run-cleanup") {
          written = true;
          const snapshot = await runtime.cleanup({ context: current, expectedActionSha256: confirmed.action_sha256, signal });
          return deliver({ ...confirmed, written, shared_coordination_sync: true, can_apply: false, status: projectAgentRunStatus(snapshot) });
        }
        fail("AGENT_RUN_EFFECT_CONFLICT");
      } catch (cause) { return deliver(agentRunFailure(args, cause, preview, written)); }
      finally { if (runtime) { try { await runtime.close(); } catch (cause) {
        // Preserve the recorded effect/result when closing a native boundary
        // fails; never turn an applied run into a false no-write diagnostic.
        if (output) { output.errors.push(safeCode(cause)); output.can_apply = false; } else throw cause;
      } } }
    },
  });
}
