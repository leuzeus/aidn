import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  assertAgentExecutionContract, fingerprintAgentExecutionValue, normalizeAgentExecutionPlan,
  taskValidationIds, validateAgentExecutionBindings, validateAgentRunValidationBindings,
} from "../../core/agents/agent-execution-contracts.mjs";
import { buildAgentExecutionSchedule, projectAgentExecutionSchedule } from "../../core/agents/agent-execution-schedule.mjs";
import { assertAgentTaskExecutor, readAgentTaskExecutorDescriptor } from "../../core/ports/agent-task-executor-port.mjs";
import { assertAgentGitIntegration } from "../../core/ports/agent-git-integration-port.mjs";
import { AGENT_EXECUTION_HEARTBEAT_MS, assertAgentSupervisedExecutionStore } from "../../core/ports/agent-execution-store-port.mjs";
import { createAgentTaskIntegrationService } from "./agent-task-integration-service.mjs";

const copy = value => structuredClone(value);
const hash = value => createHash("sha256").update(value).digest("hex");
const error = code => Object.assign(new Error(code), { code });
function requireThat(condition, code) { if (!condition) throw error(code); }
const terminal = new Set(["completed", "failed", "cancelled", "timed_out"]);
const STOPPED = new Set(["confirmed", "not_started"]);
const PREPARATION_LIMIT = 8 * 1024 * 1024;

// This only describes an initial durable reservation. Process closure is a
// separate observation made by the native composition before initial takeover.
export function assertUnclaimedAgentRun(snapshot) {
  requireThat(snapshot?.run?.lifecycle_status === "planned" && snapshot.supervision?.current === null
    && snapshot.supervision.mode === "legacy" && snapshot.supervision.history.length === 0
    && snapshot.attempts.length === 0 && snapshot.integration_intents.length === 0
    && snapshot.integrations.length === 0 && snapshot.acceptances.length === 0
    && snapshot.integration_head === null && snapshot.final_validation === null
    && snapshot.run_started_at === null && snapshot.run_deadline_at === null, "UNCLAIMED_RUN_RECONCILIATION_REQUIRED");
  return { contract_version: "agent-unclaimed-run-observation.v1", run_id: snapshot.run.run_id,
    plan_sha256: snapshot.run.plan_sha256, control_revision: snapshot.supervision.control_revision };
}

// Construction is probe-free. All effects are explicitly injected. In particular
// there is no implicit Codex registration, native bootstrap, DB fallback or CLI.
export function createAgentExecutionScheduler({
  store, git, prepareAttempt, persistPreparedAttempt, loadPreparedAttempt,
  createExecutor, validateTask, validateRun, auditRun, commitIdentity,
  makeId = randomUUID,
  clock = { now: () => performance.now(), setTimeout, clearTimeout },
  coordinationTimeoutMs = 10000, preparationTimeoutMs = 60000, shutdownTimeoutMs = 15000,
} = {}) {
  assertAgentGitIntegration(git);
  assertAgentSupervisedExecutionStore(store);
  for (const fn of [prepareAttempt, persistPreparedAttempt, loadPreparedAttempt, createExecutor, validateTask, validateRun, auditRun]) requireThat(typeof fn === "function", "SUPERVISOR_CALLBACK_REQUIRED");
  for (const [value, max] of [[coordinationTimeoutMs, 10000], [preparationTimeoutMs, 60000], [shutdownTimeoutMs, 60000]]) requireThat(Number.isSafeInteger(value) && value > 0 && value <= max, "SUPERVISOR_BUDGET_INVALID");
  let running = false;

  async function execute(options, resuming) {
    requireThat(!running, "SUPERVISOR_ALREADY_RUNNING");
    requireThat(options !== null && typeof options === "object" && !Array.isArray(options), "SUPERVISOR_OPTIONS_INVALID");
    const { runId, ownerId, runner, signal, reconciliation = null } = options;
    requireThat(signal === undefined || signal instanceof AbortSignal, "SUPERVISOR_SIGNAL_INVALID");
    running = true;
    const stop = new AbortController(), active = new Map(), heartbeats = new Set(), instances = new WeakSet();
    let snapshot = null, supervisor = null, plan = null, graph = null, fatal = null, cancelled = false, durableCancellation = false, timedOut = false, coordinationLost = false;
    let deadline = Infinity, deadlineTimer = null;
    let acceptanceTail = Promise.resolve();
    const abort = () => { cancelled = true; stop.abort(error("RUN_CANCELLED")); };
    if (signal) { signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); }
    function halt(cause) { fatal ??= cause instanceof Error ? cause : error(String(cause)); stop.abort(fatal); }
    function alive() { if (fatal) throw fatal; if (stop.signal.aborted) throw error(timedOut ? "RUN_DEADLINE_EXCEEDED" : "RUN_CANCELLED"); }
    async function bounded(operation, duration, code) {
      let timer;
      const began = clock.now();
      try {
        const value = await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => { timer = clock.setTimeout(() => reject(error(code)), duration); }),
        ]);
        requireThat(clock.now() - began < duration, code);
        return value;
      } finally { if (timer !== undefined) clock.clearTimeout(timer); }
    }
    async function withinRun(operation, code) {
      alive();
      let onAbort;
      try {
        return await bounded(() => Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
          onAbort = () => reject(error(code)); stop.signal.addEventListener("abort", onAbort, { once: true });
          if (stop.signal.aborted) onAbort();
        })]), Math.min(2147483647, Math.max(1, deadline - clock.now())), code);
      } finally { if (onAbort) stop.signal.removeEventListener("abort", onAbort); }
    }
    async function awaitProgress() {
      let onAbort;
      try {
        await Promise.race([...active.values(), new Promise(resolve => {
          onAbort = resolve; stop.signal.addEventListener("abort", onAbort, { once: true });
          if (stop.signal.aborted) resolve();
        })]);
      } finally { if (onAbort) stop.signal.removeEventListener("abort", onAbort); }
    }
    async function coordinate(name, args) {
      if (fatal) throw fatal;
      try { return await bounded(() => store[name](args), coordinationTimeoutMs, "COORDINATION_TIMEOUT"); }
      catch (cause) { coordinationLost = true; halt(cause); throw cause; }
    }
    const integrationService = createAgentTaskIntegrationService({
      git: { ...git,
        prepareIntegration: args => withinRun(() => git.prepareIntegration(args), "INTEGRATION_PREPARATION_INTERRUPTED"),
        compareAndSwapIntegration: args => withinRun(() => git.compareAndSwapIntegration(args), "INTEGRATION_APPLY_INTERRUPTED"),
      },
      store: {
        recordIntegrationIntent: args => coordinate("recordIntegrationIntent", args),
        prepareIntegration: args => coordinate("prepareIntegration", args),
        recordIntegrationApplied: args => coordinate("recordIntegrationApplied", args),
      },
    });
    function startHeartbeat(operation) {
      let timer, pending = Promise.resolve(), closed = false;
      const tick = () => {
        if (closed || fatal) return;
        pending = operation().catch(halt).finally(() => {
          if (!closed && !fatal) timer = clock.setTimeout(tick, AGENT_EXECUTION_HEARTBEAT_MS);
        });
      };
      // The timer is installed synchronously in the continuation of the claim,
      // before preparation or any subsequent awaited operation.
      timer = clock.setTimeout(tick, AGENT_EXECUTION_HEARTBEAT_MS);
      const close = async () => { closed = true; clock.clearTimeout(timer); await pending; heartbeats.delete(close); };
      heartbeats.add(close);
      return close;
    }
    function adopt(next, began = clock.now()) {
      requireThat(next?.run?.run_id === runId, "RUN_SNAPSHOT_MISMATCH");
      snapshot = next;
      if (next.cancel_request) { durableCancellation = true; cancelled = true; if (supervisor) stop.abort(error("RUN_CANCELLED")); }
      if (next.run_deadline_at !== null && next.run_deadline_at !== undefined) {
        const remaining = Date.parse(next.run_deadline_at) - Date.parse(next.server_now);
        requireThat(Number.isFinite(remaining), "RUN_DEADLINE_MISSING");
        deadline = Math.min(deadline, began + remaining);
        if (deadlineTimer !== null) clock.clearTimeout(deadlineTimer);
        const arm = () => {
          const left = deadline - clock.now();
          if (left <= 0) { timedOut = true; stop.abort(error("RUN_DEADLINE_EXCEEDED")); }
          else deadlineTimer = clock.setTimeout(arm, Math.min(left, 2147483647));
        };
        arm();
      }
      return next;
    }
    async function fresh() { const began = clock.now(); return adopt(await coordinate("getRun", { runId }), began); }
    const owned = view => ({ attemptId: view.attempt.attempt_id, ownership: view.attempt.ownership, supervisor });
    const acceptances = () => snapshot.acceptances.map(row => row.acceptance);
    async function checkHead() {
      alive();
      const observed = await withinRun(() => git.inspectIntegration({ phase: "head" }), "INTEGRATION_INSPECTION_INTERRUPTED");
      requireThat(observed.repository_identity_sha256 === snapshot.integration_head.repository_identity_sha256
        && observed.ref === snapshot.integration_head.ref && observed.head_sha === snapshot.integration_head.sha, "INTEGRATION_HEAD_CHANGED");
      return observed;
    }
    function projection() {
      const failed = snapshot.attempts.filter(view => (view.result && view.result.outcome !== "completed" && STOPPED.has(view.result.termination_state))
        || (view.attempt.lifecycle_status === "cancelled" && view.reconciliation)).map(view => view.attempt.task_id);
      for (const acceptance of acceptances()) if (acceptance.decision === "rejected") failed.push(acceptance.task_id);
      return projectAgentExecutionSchedule(graph, {
        attempted: snapshot.attempts.map(view => view.attempt.task_id),
        integrated: snapshot.integrations.filter(row => row.applied).map(row => row.prepared.task_id), failed,
      });
    }
    async function restorePreparation(view) {
      requireThat(view.preparation && view.request, "ATTEMPT_PREPARATION_MISSING");
      const evidence = view.preparation.evidence;
      const raw = await bounded(() => loadPreparedAttempt({ evidence: copy(evidence), attempt: copy(view.attempt) }), coordinationTimeoutMs, "PREPARATION_READ_TIMEOUT");
      requireThat(typeof raw === "string" || Buffer.isBuffer(raw), "PREPARATION_BYTES_REQUIRED");
      const bytes = Buffer.from(raw);
      requireThat(bytes.length <= PREPARATION_LIMIT && bytes.length === evidence.bytes && hash(bytes) === evidence.sha256, "PREPARATION_EVIDENCE_CHANGED");
      const document = JSON.parse(bytes.toString("utf8"));
      requireThat(document.contract_version === "agent-attempt-preparation.v1"
        && document.attempt_id === view.attempt.attempt_id
        && document.request_sha256 === fingerprintAgentExecutionValue(view.request)
        && document.request_sha256 === view.preparation.request_sha256
        && fingerprintAgentExecutionValue(document.request) === document.request_sha256
        && document.binding.run_id === runId && document.binding.task_id === view.attempt.task_id
        && document.binding.attempt_id === view.attempt.attempt_id
        && document.binding.input_sha === view.attempt.input_sha
        && document.binding.cwd === view.attempt.worktree.cwd && document.binding.branch === view.attempt.worktree.branch,
      "PREPARATION_BINDING_CHANGED");
      requireThat(STOPPED.has(document.bootstrap?.termination_state), "PREPARATION_STOP_UNCONFIRMED");
      return document;
    }
    function acceptResult(view, prepared) {
      // Workers stay concurrent; their stopped results share one validation boundary.
      const pending = acceptanceTail.then(() => { alive(); return acceptStoppedResult(view, prepared); });
      // Stop the queue before releasing another result after a failure or cancellation.
      acceptanceTail = pending.catch(halt);
      return pending;
    }
    async function acceptStoppedResult(view, prepared) {
      if (view.result.outcome !== "completed") return;
      requireThat(STOPPED.has(view.result.termination_state) && view.termination, "WORKER_STOP_UNCONFIRMED");
      const task = snapshot.tasks.find(item => item.task_id === view.attempt.task_id);
      requireThat(validateAgentExecutionBindings({ plan, run: snapshot.run, task, attempt: view.attempt,
        delegation: view.delegation, request: view.request, result: view.result }).ok, "SUPERVISOR_RESULT_BINDING_INVALID");
      const plannedTask = plan.tasks.find(item => item.task_id === task.task_id);
      const capture = await git.captureTaskChanges({ binding: prepared.binding, termination: view.termination, baseline: prepared.baseline, scope: task.scope });
      alive();
      const committed = await git.createTaskCommit({ capture, expectedCaptureSha256: capture.capture_sha256, commitIdentity });
      const validation = await withinRun(() => validateTask({ runId, resultSha256: fingerprintAgentExecutionValue(view.result), plan: copy(plan), task: copy(plannedTask), validationIds: taskValidationIds(plan, plannedTask), candidateSha: committed.source_sha, binding: copy(prepared.binding), signal: stop.signal }), "TASK_VALIDATION_INTERRUPTED");
      alive();
      const acceptance = {
        contract_version: "agent-task-acceptance.v1", run_id: runId, task_id: task.task_id,
        attempt_id: view.attempt.attempt_id, plan_sha256: plan.plan_sha256,
        task_contract_sha256: task.task_contract_sha256, input_sha: view.attempt.input_sha,
        result_sha256: fingerprintAgentExecutionValue(view.result), candidate_sha: committed.source_sha,
        decision: validation.status === "passed" ? "accepted" : "rejected", validation,
        integration: { status: validation.status === "passed" ? "pending" : "not_requested", source_sha: committed.source_sha, integrated_sha: null },
        cleanup: { status: "pending", evidence: [] },
      };
      assertAgentExecutionContract("acceptance", acceptance);
      requireThat(validateAgentExecutionBindings({ plan, run: snapshot.run, task, attempt: view.attempt,
        delegation: view.delegation, request: view.request, result: view.result, acceptance }).ok, "SUPERVISOR_ACCEPTANCE_INVALID");
      await coordinate("recordAcceptance", { runId, supervisor, acceptance });
    }
    async function launch(taskId) {
      alive();
      const task = snapshot.tasks.find(item => item.task_id === taskId), attemptId = makeId();
      const inputSha = task.depends_on.length ? snapshot.integration_head.sha : plan.base.sha;
      if (task.depends_on.length) await checkHead();
      const workspace = git.allocateAttemptWorkspace({ runId, taskId, attemptId, inputSha });
      const view = await coordinate("claimAttempt", { runId, taskId, ownerId, attemptId, inputSha,
        worktree: { worktree_id: workspace.worktree_id, cwd: workspace.cwd, branch: workspace.branch }, supervisor,
        expectedIntegrationSequence: task.depends_on.length ? snapshot.integration_head.sequence : null });
      const closeHeartbeat = startHeartbeat(() => coordinate("renewAttempt", owned(view)));
      const request = {
        contract_version: "agent-task-request.v1", run_id: runId, task_id: taskId, attempt_id: attemptId,
        plan_sha256: plan.plan_sha256, task_contract_sha256: task.task_contract_sha256, input_sha: inputSha,
        delegation_id: view.delegation.delegation_id, delegation_sha256: fingerprintAgentExecutionValue(view.delegation),
        instruction: JSON.stringify({ objective: task.objective, scope: task.scope, acceptance_criteria: task.acceptance_criteria }), cwd: workspace.cwd, execution: copy(plan.execution),
        limits: { max_duration_ms: task.max_duration_ms }, ownership: copy(view.attempt.ownership),
      };
      // These are store-shaped supervisor callbacks, not the Codex adapter's
      // request/event callback signatures. The injected composition translates
      // native runner events and supplies its bounded canonical evaluator.
      const callbacks = Object.freeze({
        recordLaunchIntent: () => coordinate("recordLaunchIntent", { ...owned(view), request }),
        observeRunner: runner => coordinate("observeRunner", { ...owned(view), runner }),
        admitDelegatedRequest: ({ evaluate }) => coordinate("admitDelegatedRequest", {
          ...owned(view), requestSha256: fingerprintAgentExecutionValue(request),
          delegationSha256: request.delegation_sha256, evaluate,
        }),
      });
      let execution = null;
      const work = (async () => {
        try {
          const checked = validateAgentExecutionBindings({ plan, run: snapshot.run, task, attempt: view.attempt, delegation: view.delegation, request });
          requireThat(checked.ok, "SUPERVISOR_REQUEST_INVALID");
          alive();
          await coordinate("recordLaunchIntent", { ...owned(view), request });
          const attemptBinding = { run_id: runId, task_id: taskId, attempt_id: attemptId, cwd: workspace.cwd, branch: workspace.branch, input_sha: inputSha };
          const created = await git.prepareAttemptWorkspace({ workspace, inputSha, attemptBinding,
            verifyAuthority: () => coordinate("recordLaunchIntent", { ...owned(view), request }) });
          requireThat(created.cwd === workspace.cwd && created.branch === workspace.branch
            && created.worktree_id === workspace.worktree_id && created.input_sha === inputSha, "PREPARED_WORKTREE_MISMATCH");
          const binding = { run_id: runId, task_id: taskId, attempt_id: attemptId, cwd: workspace.cwd,
            branch: workspace.branch, input_sha: inputSha, repository_identity_sha256: created.repository_identity_sha256 };
          // This budget covers installation, metadata bootstrap and fresh
          // preflight, while the independent attempt heartbeat already runs.
          const preparation = await bounded(() => withinRun(() => prepareAttempt({ plan: copy(plan), task: copy(task),
            attempt: copy(view.attempt), delegation: copy(view.delegation), request: copy(request), binding: copy(binding),
            callbacks, signal: stop.signal }), "ATTEMPT_PREPARATION_INTERRUPTED"),
          Math.min(preparationTimeoutMs, Math.max(1, deadline - clock.now())), "ATTEMPT_PREPARATION_TIMEOUT");
          alive();
          requireThat(STOPPED.has(preparation?.bootstrap?.termination_state), "PREPARATION_STOP_UNCONFIRMED");
          const baseline = await git.captureBaseline({ binding });
          const document = { contract_version: "agent-attempt-preparation.v1", attempt_id: attemptId,
            request_sha256: fingerprintAgentExecutionValue(request), request, binding, baseline, bootstrap: preparation.bootstrap };
          const bytes = Buffer.from(JSON.stringify(document));
          requireThat(bytes.length <= PREPARATION_LIMIT, "PREPARATION_EVIDENCE_LIMIT");
          const expected = { sha256: hash(bytes), bytes: bytes.length };
          const evidence = await withinRun(() => persistPreparedAttempt({ attemptId, content: bytes, ...expected }), "PREPARATION_PERSIST_INTERRUPTED");
          requireThat(evidence?.sha256 === expected.sha256 && evidence.bytes === expected.bytes && typeof evidence.ref === "string", "PREPARATION_EVIDENCE_MISMATCH");
          await coordinate("recordPreparation", { ...owned(view), preparation: { request_sha256: document.request_sha256, evidence } });
          alive();
          execution = await withinRun(() => createExecutor({ plan: copy(plan), task: copy(task), attempt: copy(view.attempt), signal: stop.signal,
            delegation: copy(view.delegation), request: copy(request), prepared: preparation, callbacks }), "EXECUTOR_CREATION_INTERRUPTED");
          assertAgentTaskExecutor(execution?.executor);
          requireThat(!instances.has(execution.executor), "EXECUTOR_INSTANCE_REUSED"); instances.add(execution.executor);
          requireThat(readAgentTaskExecutorDescriptor(execution.executor).executor_id === plan.execution.executor_id, "EXECUTOR_IDENTITY_MISMATCH");
          requireThat(typeof execution.getTerminationProof === "function" && typeof execution.close === "function", "EXECUTOR_LIFECYCLE_REQUIRED");
          alive();
          const result = await execution.executor.runTask(request, { signal: stop.signal,
            onEvent: event => coordinate("appendEvent", { ...owned(view), event }) });
          assertAgentExecutionContract("result", result);
          requireThat(validateAgentExecutionBindings({ plan, run: snapshot.run, task,
            attempt: { ...view.attempt, lifecycle_status: result.outcome === "indeterminate" ? "recovery_required" : result.outcome },
            delegation: view.delegation, request, result }).ok, "SUPERVISOR_RESULT_INVALID");
          // Drain any in-flight renewal before storing the terminal state; a
          // renewal must never run after recordResult closes its lease.
          await closeHeartbeat();
          if (fatal) return;
          const stored = await coordinate("recordResult", { ...owned(view), result,
            terminationProof: await bounded(() => execution.getTerminationProof(), coordinationTimeoutMs, "TERMINATION_PROOF_TIMEOUT") });
          if (!STOPPED.has(result.termination_state) || result.outcome === "indeterminate") throw error("WORKER_STOP_UNCONFIRMED");
          if (!stop.signal.aborted) await acceptResult(stored, document);
        } catch (cause) { halt(cause); }
        finally { await closeHeartbeat(); if (execution) { try { await bounded(() => execution.close(), shutdownTimeoutMs, "EXECUTOR_CLOSE_UNCONFIRMED"); } catch (cause) { halt(cause); } } }
      })();
      active.set(attemptId, work);
      void work.finally(() => active.delete(attemptId));
    }
    async function applyPrepared(row) {
      alive();
      const prepared = row.prepared;
      const intent = (snapshot.integration_intents ?? []).find(item => item.intent.integration_id === prepared.integration_id)?.intent;
      const observed = await withinRun(() => git.inspectIntegration({ ...prepared, ...(intent ? { intent } : {}) }, { phase: "prepared" }), "INTEGRATION_INSPECTION_INTERRUPTED");
      requireThat(observed.head_sha === prepared.parent_sha || observed.head_sha === prepared.result_sha, "INTEGRATION_RECONCILIATION_REQUIRED");
      const preparedSha256 = fingerprintAgentExecutionValue(prepared);
      // The canonical service replays the durable preparation with current
      // authority immediately before CAS, then records the exact observed SHA.
      await integrationService.applyPrepared({ prepared, preparedSha256, supervisor, intent,
        expectedControlRevision: snapshot.supervision.control_revision });
    }
    async function reconcilePendingIntegrations({ cancelling = false } = {}) {
      const pendingIntents = (snapshot.integration_intents ?? []).filter(row => row.status !== "applied");
      requireThat(pendingIntents.length <= 1, "MULTIPLE_PREPARED_INTEGRATIONS");
      for (const row of pendingIntents) {
        if (snapshot.integrations.some(item => item.prepared.integration_id === row.intent.integration_id)) continue;
        let restored = await bounded(() => integrationService.resumePreparation({ intent: row.intent,
          intentSha256: row.intent_sha256, supervisor, expectedControlRevision: snapshot.supervision.control_revision,
          reconciliation: true }), coordinationTimeoutMs, "INTEGRATION_INSPECTION_TIMEOUT");
        if (restored.status === "absent") {
          requireThat(!cancelling, "CANCEL_PENDING_INTEGRATION");
          alive(); // Absence is not permission to work after the frozen deadline.
          restored = await integrationService.resumePreparation({ intent: row.intent, intentSha256: row.intent_sha256,
            supervisor, expectedControlRevision: snapshot.supervision.control_revision, reconciliation: false });
        }
        requireThat(restored.status === "prepared", "INTEGRATION_RECONCILIATION_REQUIRED");
        await fresh();
      }
      const pending = snapshot.integrations.filter(row => !row.applied);
      requireThat(pending.length <= 1, "MULTIPLE_PREPARED_INTEGRATIONS");
      for (const row of pending) {
        const prepared = row.prepared;
        const intent = (snapshot.integration_intents ?? []).find(item => item.intent.integration_id === prepared.integration_id)?.intent;
        const observed = await bounded(() => git.inspectIntegration({ ...prepared, ...(intent ? { intent } : {}) }, { phase: "prepared" }),
          coordinationTimeoutMs, "INTEGRATION_INSPECTION_TIMEOUT");
        requireThat(observed.head_sha === prepared.parent_sha || observed.head_sha === prepared.result_sha, "INTEGRATION_RECONCILIATION_REQUIRED");
        if (observed.head_sha === prepared.result_sha) {
          // Factual reconciliation never launches a second CAS, even after the
          // run deadline. PostgreSQL reobserves Git and retains recovery status.
          await coordinate("recordIntegrationApplied", { runId, supervisor,
            expectedControlRevision: snapshot.supervision.control_revision, integrationId: prepared.integration_id,
            preparedSha256: fingerprintAgentExecutionValue(prepared), proof: { evidence: prepared.evidence }, reconciliation: true });
        } else { requireThat(!cancelling, "CANCEL_PENDING_INTEGRATION"); await applyPrepared(row); }
        await fresh();
      }
    }
    async function integrateNext() {
      const pending = snapshot.integrations.filter(row => !row.applied);
      requireThat(pending.length <= 1, "MULTIPLE_PREPARED_INTEGRATIONS");
      if (pending.length) { await applyPrepared(pending[0]); await fresh(); return true; }
      const id = projection().nextIntegration;
      const acceptance = acceptances().find(item => item.task_id === id && item.decision === "accepted");
      if (!acceptance) return false;
      await checkHead();
      const sequence = snapshot.integration_head.sequence + 1, parentSha = snapshot.integration_head.sha;
      // A crash can leave Git preparation without its PostgreSQL journal. The
      // same logical integration must find that resource again and fail closed,
      // rather than silently preparing another result under a fresh random ID.
      const integrationId = `integration.${fingerprintAgentExecutionValue({
        contract_version: "agent-integration-identity.v1", run_id: runId, plan_sha256: plan.plan_sha256,
        task_id: id, attempt_id: acceptance.attempt_id, source_sha: acceptance.candidate_sha,
        parent_sha: parentSha, sequence,
      })}`;
      const result = await integrationService.prepare({ runId, planSha256: plan.plan_sha256,
        taskId: id, attemptId: acceptance.attempt_id, acceptanceSha256: fingerprintAgentExecutionValue(acceptance),
        sequence, integrationId, sourceSha: acceptance.candidate_sha,
        parentSha, supervisor, expectedControlRevision: snapshot.supervision.control_revision, commitIdentity, verification: plan.verification ?? null });
      requireThat(result.status === "prepared", "INTEGRATION_CONFLICT"); alive();
      await fresh();
      await applyPrepared({ prepared: result.prepared }); await fresh(); return true;
    }
    try {
      await fresh();
      plan = normalizeAgentExecutionPlan(snapshot.plan); graph = buildAgentExecutionSchedule(plan.tasks);
      requireThat(plan.limits.concurrency >= 1 && plan.limits.concurrency <= 4, "CONCURRENCY_LIMIT");
      if (["completed", "failed", "cancelled"].includes(snapshot.run.lifecycle_status)) return { status: snapshot.run.lifecycle_status, snapshot };
      // Explicit resume may reconcile facts after the deadline, but cannot
      // restart work. Caller cancellation still stops before any takeover.
      if (signal?.aborted || !resuming && !durableCancellation) alive();
      const initialResume = resuming && snapshot.supervision.current === null;
      if (initialResume) requireThat(reconciliation?.unclaimedRun
        && fingerprintAgentExecutionValue(reconciliation.unclaimedRun) === fingerprintAgentExecutionValue(assertUnclaimedAgentRun(snapshot)), "UNCLAIMED_RUN_OBSERVATION_REQUIRED");
      if (resuming && !initialResume) {
        requireThat(reconciliation?.supervisorProof, "SUPERVISOR_RECONCILIATION_REQUIRED");
        const previous = copy(snapshot.supervision.current.ownership);
        adopt(await coordinate("reconcileSupervisor", { runId, expectedSupervisor: previous,
          expectedControlRevision: snapshot.supervision.control_revision, proof: reconciliation.supervisorProof }));
        adopt(await coordinate("claimSupervisor", { runId, ownerId, runner,
          expectedControlRevision: snapshot.supervision.control_revision, expectedPreviousGeneration: previous.generation, drainOnly: durableCancellation,
          integration: { repository_identity_sha256: snapshot.integration_head.repository_identity_sha256,
            ref: snapshot.integration_head.ref, base_sha: plan.base.sha } }));
      } else {
        requireThat(snapshot.attempts.length === 0, "RESUME_REQUIRED");
        const identity = await bounded(() => git.inspectIntegration({ phase: "head" }), coordinationTimeoutMs, "INTEGRATION_INSPECTION_TIMEOUT");
        if (!durableCancellation) alive();
        requireThat(identity.head_sha === null || identity.head_sha === plan.base.sha, "INTEGRATION_BASE_CHANGED");
        adopt(await coordinate("claimSupervisor", { runId, ownerId, runner, expectedControlRevision: snapshot.supervision.control_revision,
          integration: { repository_identity_sha256: identity.repository_identity_sha256, ref: identity.ref, base_sha: plan.base.sha }, expectedPreviousGeneration: null, drainOnly: durableCancellation }));
      }
      supervisor = copy(snapshot.supervision.current.ownership);
      if (durableCancellation) stop.abort(error("RUN_CANCELLED"));
      startHeartbeat(async () => adopt(await coordinate("renewSupervisor", { runId, supervisor })));
      requireThat(Number.isFinite(deadline), "RUN_DEADLINE_MISSING");
      if (resuming && !initialResume) {
        for (const entry of reconciliation.attempts ?? []) await coordinate("reconcileAttempt", { ...entry, supervisor });
        await fresh();
        requireThat(snapshot.attempts.every(view => terminal.has(view.attempt.lifecycle_status)
          && (view.termination || view.reconciliation)), "ATTEMPT_RECONCILIATION_REQUIRED");
        await reconcilePendingIntegrations({ cancelling: durableCancellation });
        if (durableCancellation) {
          const finished = await coordinate("finishRun", { runId, supervisor, outcome: "cancelled", expectedControlRevision: snapshot.supervision.control_revision });
          return { status: "cancelled", snapshot: finished, blocked_tasks: projection().blocked };
        }
        alive();
        adopt(await coordinate("resumeRun", { runId, supervisor, expectedControlRevision: snapshot.supervision.control_revision }));
        // Existing completed workers are never executed again. Only immutable
        // preparation evidence can supply a baseline for unfinished acceptance.
        for (const view of snapshot.attempts) if (view.result?.outcome === "completed"
          && !acceptances().some(item => item.attempt_id === view.attempt.attempt_id)) await acceptResult(view, await restorePreparation(view));
      } else if (!durableCancellation) { alive(); await withinRun(() => git.initializeIntegration({ baseSha: plan.base.sha }), "INTEGRATION_INITIALIZATION_INTERRUPTED"); }
      await fresh();
      while (!stop.signal.aborted) {
        await fresh();
        if (stop.signal.aborted) break;
        if (await integrateNext()) continue;
        await checkHead();
        const selected = projection();
        for (const taskId of selected.ready) {
          if (active.size >= plan.limits.concurrency || stop.signal.aborted) break;
          await fresh();
          if (stop.signal.aborted) break;
          await launch(taskId);
        }
        if (!active.size) {
          // Git inspection/integration yields to completed workers. Their
          // acceptance may be newer than the snapshot used above even though
          // the last local promise has already left active.
          await fresh();
          const latest = projection();
          if (latest.ready.length || snapshot.integrations.some(row => !row.applied)
            || acceptances().some(value => value.task_id === latest.nextIntegration && value.decision === "accepted")) continue;
          break;
        }
        await awaitProgress();
        if (!fatal) await fresh();
      }
      if (active.size) await bounded(() => Promise.all(active.values()), shutdownTimeoutMs, "WORKER_SHUTDOWN_UNCONFIRMED");
      if (fatal) throw fatal;
      await fresh();
      const schedule = projection();
      if (cancelled || timedOut || snapshot.integrations.filter(row => row.applied).length !== plan.tasks.length) {
        if (!cancelled && !timedOut) requireThat(schedule.blocked.length || snapshot.attempts.some(view => view.result?.outcome !== "completed")
          || acceptances().some(item => item.decision === "rejected"), "RUN_PROGRESS_UNRESOLVED");
        const outcome = cancelled ? "cancelled" : "failed";
        const finished = await coordinate("finishRun", { runId, supervisor, outcome, expectedControlRevision: snapshot.supervision.control_revision });
        return { status: outcome, snapshot: finished, blocked_tasks: schedule.blocked };
      }
      await checkHead();
      const integratedSha = snapshot.integration_head.sha;
      let validation = snapshot.final_validation?.validation;
      if (!validation) {
        const checks = await withinRun(() => validateRun({ runId, integrationSequence: snapshot.integration_head.sequence, plan: copy(plan), integratedSha, signal: stop.signal }), "RUN_VALIDATION_INTERRUPTED"); alive();
        const audit = await withinRun(() => auditRun({ runId, integrationSequence: snapshot.integration_head.sequence, plan: copy(plan), integratedSha, signal: stop.signal }), "RUN_AUDIT_INTERRUPTED"); alive();
        await checkHead();
        const all = [...checks, ...audit.checks];
        validation = { contract_version: "agent-run-validation.v1", validation_id: makeId(), run_id: runId,
          plan_sha256: plan.plan_sha256, integration_sequence: snapshot.integration_head.sequence, integrated_sha: integratedSha,
          checks, audit, outcome: all.some(item => item.status === "failed") ? "failed" : all.some(item => item.status !== "passed") ? "unavailable" : "passed" };
      } else requireThat(fingerprintAgentExecutionValue(validation) === snapshot.final_validation.validation_sha256, "RUN_VALIDATION_EVIDENCE_CHANGED");
      requireThat(validateAgentRunValidationBindings({ plan, run: snapshot.run, validation, integratedSha,
        integrationSequence: snapshot.integration_head.sequence }).ok, "RUN_VALIDATION_INVALID");
      if (!snapshot.final_validation) await coordinate("recordRunValidation", { runId, supervisor, expectedControlRevision: snapshot.supervision.control_revision, validation });
      await fresh();
      const outcome = validation.outcome === "passed" ? "completed" : "failed";
      const finished = await coordinate("finishRun", { runId, supervisor, outcome, expectedControlRevision: snapshot.supervision.control_revision,
        finalValidationSha256: fingerprintAgentExecutionValue(validation) });
      return { status: outcome, snapshot: finished, blocked_tasks: [] };
    } catch (cause) {
      halt(cause);
      try { await bounded(() => Promise.all(active.values()), shutdownTimeoutMs, "WORKER_SHUTDOWN_UNCONFIRMED"); } catch { /* retained attempts require independent reconciliation */ }
      let durableStateKnown = false;
      // A local failure must fence its acquired generation in PostgreSQL so
      // verified recovery need not wait for lease expiry. This request grants
      // no termination proof. After coordination/ownership loss, even this
      // mutation is forbidden: a former owner must not invalidate its successor.
      if (supervisor && !coordinationLost) {
        try {
          await bounded(() => store.invalidateRun({ runId, supervisor,
            reason: cause.code ?? "SUPERVISOR_FAILED" }), coordinationTimeoutMs, "RECOVERY_PERSISTENCE_TIMEOUT");
          snapshot = await bounded(() => store.getRun({ runId }), coordinationTimeoutMs, "RECOVERY_READ_TIMEOUT");
          durableStateKnown = snapshot?.run?.run_id === runId && snapshot.run.lifecycle_status === "recovery_required";
        } catch { /* Keep the last observed snapshot; it is not fresh authority. */ }
      }
      return { status: "recovery_required", reason_code: cause.code ?? "SUPERVISOR_FAILED", durable_state_known: durableStateKnown, snapshot };
    } finally {
      stop.abort();
      if (deadlineTimer !== null) clock.clearTimeout(deadlineTimer);
      await Promise.all([...heartbeats].map(close => close()));
      if (signal) signal.removeEventListener("abort", abort);
      running = false;
    }
  }
  return Object.freeze({ run: options => execute(options, false), resume: options => execute(options, true) });
}
