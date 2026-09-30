// Test doubles only. PostgreSQL remains the production supervision authority.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createAgentExecutionScheduler } from "../../src/application/runtime/agent-run-supervisor.mjs";
import { createLocalAgentGitIntegration } from "../../src/adapters/runtime/local-agent-git-integration.mjs";
import { normalizeAgentExecutionPlan, fingerprintAgentExecutionValue as fingerprint, fingerprintTaskContract } from "../../src/core/agents/agent-execution-contracts.mjs";

const chain = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url)));
const clone = value => structuredClone(value);
const sha = value => createHash("sha256").update(String(value)).digest("hex");
export const fixtureEvidence = { ref: "evidence/supervision.json", sha256: sha("fixture"), bytes: 7 };
const fail = code => { throw Object.assign(new Error(code), { code }); };
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createSchedulerFixture({ realGit = false, concurrency = 2, tasks = null, verification = null, plan: suppliedPlan = null, failure = {}, clock, barrier = realGit, runId = "run.fixture" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-scheduler-")), token = randomUUID();
  fs.writeFileSync(path.join(root, "owner"), token, { flag: "wx" });
  const repositoryRoot = path.join(root, "repository"), resourcesRoot = path.join(root, "resources");
  const processes = new Set(), children = [], operations = [], evidence = new Map();
  let baseSha = "1".repeat(40), serial = 0, live = 0, maxLive = 0;
  function gitCommand(args) {
    const result = spawnSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", windowsHide: true, timeout: 10000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" } });
    if (result.status !== 0) throw new Error(`FIXTURE_GIT_FAILED:${result.stderr.slice(0, 400)}`);
    return result.stdout.trim();
  }
  if (realGit) {
    fs.mkdirSync(repositoryRoot);
    gitCommand(["init", "--initial-branch=dev"]);
    fs.writeFileSync(path.join(repositoryRoot, "seed.txt"), "fixture\n");
    gitCommand(["add", "seed.txt"]);
    gitCommand(["-c", "user.name=AIDN fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture base"]);
    baseSha = gitCommand(["rev-parse", "HEAD"]);
  }
  const taskSpecs = tasks ?? [
    { task_id: "a", depends_on: [] }, { task_id: "b", depends_on: [] }, { task_id: "c", depends_on: ["a", "b"] },
  ];
  const rawPlan = clone(chain.plan); delete rawPlan.plan_sha256;
  rawPlan.base.sha = baseSha;
  rawPlan.limits = { concurrency, max_duration_ms: 120000 };
  rawPlan.tasks = taskSpecs.map(task => ({ objective: `Write ${task.task_id}.txt`, scope: [{ path: `${task.task_id}.txt`, operations: ["add"] }],
    acceptance_criteria: ["Expected content"], max_duration_ms: 60000, ...task }));
  rawPlan.canonical.scope = rawPlan.tasks.flatMap(task => task.scope);
  rawPlan.validations = [{ validation_id: "contents", argv: ["fixture", "contents"] }];
  rawPlan.audit = { read_only: true, criteria: ["Changes remain in delegated scope"] };
  if (verification) rawPlan.verification = clone(verification);
  const plan = normalizeAgentExecutionPlan(suppliedPlan ?? rawPlan);
  baseSha = plan.base.sha;
  const state = {
    plan, run: { ...clone(chain.run), run_id: runId, canonical: clone(plan.canonical), plan_id: plan.plan_id, plan_sha256: plan.plan_sha256,
      task_ids: plan.tasks.map(task => task.task_id), lifecycle_status: "planned" },
    tasks: plan.tasks.map(task => ({ contract_version: "agent-delegated-task.v1", run_id: runId,
      plan_sha256: plan.plan_sha256, task_contract_sha256: fingerprintTaskContract(task), ...clone(task) })),
    attempts: [], events: [], acceptances: [], integration_intents: [], integrations: [], final_validation: null,
    supervision: { mode: "legacy", control_revision: 0, current: null, history: [] },
    integration_head: null, run_started_at: null, run_deadline_at: null,
  };
  const snapshot = () => ({ ...clone(state), server_now: new Date().toISOString() });
  const attempt = id => state.attempts.find(view => view.attempt.attempt_id === id) ?? fail("ATTEMPT_NOT_FOUND");
  const store = {
    async checkReadiness() { return { ready: true }; },
    async readCanonicalDigest() { fail("NOT_USED_BY_SCHEDULER"); },
    async reserveRun() { fail("NOT_USED_BY_SCHEDULER"); },
    async expireAttempts() { fail("NOT_USED_BY_SCHEDULER"); },
    async expireSupervisor() { fail("NOT_USED_BY_SCHEDULER"); },
    async invalidateRun({ supervisor, reason }) {
      operations.push("invalidateRun");
      if (failure.invalidate || !supervisor || fingerprint(supervisor) !== fingerprint(state.supervision.current.ownership)) fail("SUPERVISOR_OWNERSHIP_LOST");
      state.run.lifecycle_status = "recovery_required"; state.recovery_reason = reason;
      for (const view of state.attempts) if (["launch_intended", "running"].includes(view.attempt.lifecycle_status)) view.attempt.lifecycle_status = "recovery_required";
      return { run: clone(state.run), reason };
    },
    async getRun() { operations.push("getRun"); if (failure.getRun) fail("BACKEND_UNAVAILABLE"); return snapshot(); },
    async claimSupervisor({ ownerId, runner, integration, expectedPreviousGeneration }) {
      operations.push("claimSupervisor");
      state.supervision.mode = "supervised";
      state.supervision.current = { ownership: { owner_id: ownerId, generation: (expectedPreviousGeneration ?? 0) + 1, lease_id: `sup.${++serial}` }, runner, status: "active", lease_live: true };
      state.supervision.control_revision++;
      state.integration_head ??= { ...integration, sha: integration.base_sha, sequence: 0 };
      state.run_started_at ??= new Date().toISOString();
      state.run_deadline_at ??= new Date(Date.parse(state.run_started_at) + plan.limits.max_duration_ms).toISOString();
      return snapshot();
    },
    async renewSupervisor() { operations.push("renewSupervisor"); if (failure.heartbeat) fail("BACKEND_UNAVAILABLE"); return snapshot(); },
    async reconcileSupervisor() {
      operations.push("reconcileSupervisor");
      if (state.supervision.current.status === "active" && state.supervision.current.lease_live && state.run.lifecycle_status !== "recovery_required") fail("SUPERVISOR_STILL_ACTIVE");
      state.supervision.current.status = "stopped"; return snapshot();
    },
    async resumeRun() { operations.push("resumeRun"); state.run.lifecycle_status = "running"; return snapshot(); },
    async claimAttempt({ taskId, ownerId, attemptId, inputSha, worktree, expectedPreviousAttemptId }) {
      operations.push(`claim:${taskId}`);
      if (expectedPreviousAttemptId !== undefined || state.attempts.some(view => view.attempt.task_id === taskId)) fail("AUTORETRY_FORBIDDEN");
      if (state.attempts.filter(view => ["launch_intended", "running"].includes(view.attempt.lifecycle_status)).length >= concurrency) fail("CONCURRENCY_LIMIT");
      const task = state.tasks.find(item => item.task_id === taskId);
      if (task.depends_on.some(id => !state.integrations.some(row => row.prepared.task_id === id && row.applied))) fail("DEPENDENCY_PROOF_REQUIRED");
      if (inputSha !== (task.depends_on.length ? state.integration_head.sha : baseSha)) fail("INPUT_SHA_MISMATCH");
      const refs = { run_id: runId, task_id: taskId, attempt_id: attemptId, input_sha: inputSha,
        plan_sha256: plan.plan_sha256, task_contract_sha256: task.task_contract_sha256 };
      const ownership = { owner_id: ownerId, generation: 1, lease_id: `lease.${attemptId}`, planning_revision: plan.canonical.planning_revision };
      const view = { attempt: { contract_version: "agent-execution-attempt.v1", ...refs, ordinal: 1, worktree, ownership,
        activation: plan.canonical.activation, lifecycle_status: "launch_intended" },
      delegation: { contract_version: "agent-task-delegation.v1", delegation_id: `delegation.${attemptId}`, ...refs,
        worktree, ownership, activation: plan.canonical.activation, scope: task.scope }, request: null, preparation: null,
      result: null, runner: null, termination: null, reconciliation: null };
      state.attempts.push(view); state.run.lifecycle_status = "running"; return clone(view);
    },
    async renewAttempt({ attemptId }) { operations.push(`renew:${attempt(attemptId).attempt.task_id}`); if (failure.heartbeat) fail("BACKEND_UNAVAILABLE"); return clone(attempt(attemptId)); },
    async recordLaunchIntent({ attemptId, request }) { operations.push(`intent:${request.task_id}`); attempt(attemptId).request = clone(request); },
    async recordPreparation({ attemptId, preparation }) { operations.push(`prepared:${attempt(attemptId).attempt.task_id}`); attempt(attemptId).preparation = clone(preparation); },
    async observeRunner({ attemptId, runner }) { attempt(attemptId).runner = runner; attempt(attemptId).attempt.lifecycle_status = "running"; },
    async appendEvent({ event }) { operations.push(`event:${event.task_id}`); if (failure.event) fail("EVENT_PERSIST_FAILED"); state.events.push(event); },
    async admitDelegatedRequest() { return { admitted: true }; },
    async recordResult({ attemptId, result, terminationProof }) {
      operations.push(`result:${result.task_id}`); const view = attempt(attemptId);
      view.result = clone(result); view.termination = terminationProof;
      view.attempt.lifecycle_status = result.outcome === "indeterminate" ? "recovery_required" : result.outcome;
      return clone(view);
    },
    async reconcileAttempt({ attemptId, proof }) { const view = attempt(attemptId); view.reconciliation = proof; view.attempt.lifecycle_status = "cancelled"; },
    async recordAcceptance({ acceptance }) { operations.push(`accepted:${acceptance.task_id}`); state.acceptances.push({ acceptance: clone(acceptance), acceptance_sha256: fingerprint(acceptance) }); },
    async recordIntegrationIntent({ intent }) {
      const existing = state.integration_intents.find(row => row.intent.integration_id === intent.integration_id);
      if (existing) {
        if (existing.intent_sha256 !== fingerprint(intent)) fail("INTENT_CHANGED");
        return { ...clone(existing), control_revision: state.supervision.control_revision, idempotent: true };
      }
      if (state.integration_intents.some(row => row.status !== "applied")) fail("PENDING_INTENT");
      const row = { intent: clone(intent), intent_sha256: fingerprint(intent), status: "reserved", prepared_sha256: null, applied_sha256: null };
      state.integration_intents.push(row); operations.push("integration-intent:" + intent.task_id);state.supervision.control_revision++;
      return { ...clone(row), control_revision: state.supervision.control_revision, idempotent: false };
    },
    async prepareIntegration({ integration, intentSha256 }) {
      const intent = state.integration_intents.find(row => row.intent.integration_id === integration.integration_id);
      if (plan.verification && (!intent || intent.intent_sha256 !== intentSha256 || integration.intent_sha256 !== intentSha256)) fail("INTENT_REQUIRED");
      if (intent) { intent.status = "prepared"; intent.prepared_sha256 = fingerprint(integration); }
      if (!state.integrations.some(row => row.prepared.integration_id === integration.integration_id)) {
        operations.push(`integration-prepared:${integration.task_id}`); state.integrations.push({ prepared: clone(integration), applied: null }); state.supervision.control_revision++;
      }
      return { integration: clone(integration), prepared_sha256: fingerprint(integration), control_revision: state.supervision.control_revision };
    },
    async recordIntegrationApplied({ integrationId, proof }) {
      const row = state.integrations.find(item => item.prepared.integration_id === integrationId);
      operations.push(`integration-applied:${row.prepared.task_id}`);
      if (failure.afterCas) { failure.afterCas = false; fail("BACKEND_UNAVAILABLE"); }
      const intent = state.integration_intents.find(item => item.intent.integration_id === integrationId);
      if (intent) { intent.status = "applied"; intent.applied_sha256 = fingerprint(proof); }
      row.applied = clone(proof); state.integration_head.sha = row.prepared.result_sha; state.integration_head.sequence = row.prepared.sequence; state.supervision.control_revision++;
    },
    async recordRunValidation({ validation }) { operations.push("finalValidation"); state.final_validation = { validation: clone(validation), validation_sha256: fingerprint(validation) }; state.supervision.control_revision++; },
    async finishRun({ outcome }) { operations.push(`finish:${outcome}`); if (failure.finish) { failure.finish = false; fail("BACKEND_UNAVAILABLE"); } state.run.lifecycle_status = outcome; return snapshot(); },
  };
  let gitHead = null;
  const repositoryIdentity = sha(repositoryRoot), ref = "refs/heads/codex/integration-fixture";
  const fakeGit = {
    allocateAttemptWorkspace({ taskId, attemptId, inputSha }) { return { cwd: path.join(resourcesRoot, attemptId), branch: `codex/${attemptId}`,
      input_sha: inputSha, worktree_id: sha(attemptId) }; },
    async initializeIntegration({ baseSha }) { gitHead = baseSha; },
    async prepareAttemptWorkspace({ workspace }) { return { ...workspace, repository_identity_sha256: repositoryIdentity }; },
    async captureBaseline({ binding }) { return { binding, fixture: true }; },
    async captureTaskChanges({ binding, baseline }) { if (failure.capture) fail("OUTSIDE_SCOPE"); return { binding, baseline, capture_sha256: sha(binding.attempt_id) }; },
    async createTaskCommit({ capture }) { return { source_sha: sha(capture.binding.task_id).slice(0, 40), parent_sha: capture.binding.input_sha }; },
    async prepareIntegration({ integrationId, sourceSha, expectedParent }) { return { status: failure.conflict ? "conflict" : "prepared", integration_id: integrationId,
      source_sha: sourceSha, parent_sha: expectedParent, result_sha: sha(expectedParent + sourceSha).slice(0, 40), ref,
      repository_identity_sha256: repositoryIdentity, evidence: [fixtureEvidence] }; },
    async compareAndSwapIntegration({ prepared }) { if (![prepared.parent_sha, prepared.result_sha].includes(gitHead)) fail("REF_MOVED");
      operations.push(`CAS:${prepared.task_id}`); const status = gitHead === prepared.result_sha ? "already_applied" : "applied";
      gitHead = prepared.result_sha; return { status, observed_sha: gitHead, evidence: [fixtureEvidence] }; },
    async inspectIntegration() { return { repository_identity_sha256: repositoryIdentity, ref, head_sha: gitHead }; },
  };
  const git = realGit ? createLocalAgentGitIntegration({ repositoryRoot, resourcesRoot, integrationRef: ref,
    verifyTermination: async ({ binding, termination }) => ({ confirmed: termination?.confirmed === true, attempt_id: binding.attempt_id }) }) : fakeGit;
  const waiting = [];
  async function nativeFixtureWork(request, callbacks, signal) {
    const program = `import fs from 'node:fs'; const [id]=process.argv.slice(1); console.log('ready'); process.stdin.once('data',()=>{const data=id==='c'?fs.readFileSync('a.txt','utf8')+fs.readFileSync('b.txt','utf8'):id;fs.writeFileSync(id+'.txt',data);process.exit(0);});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", program, request.task_id], { cwd: request.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    processes.add(child);
    const record = { task_id: request.task_id, pid: child.pid, started: performance.now(), ended: null }; children.push(record);
    const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => {
      record.ended = performance.now(); processes.delete(child); resolve({ code, signal }); }); });
    const abort = () => child.kill(); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    try {
      await callbacks.observeRunner({ host_id: "fixture", runner_id: request.attempt_id, pid: child.pid, started_at: new Date().toISOString() });
      let text = "";
      child.stdout.on("data", chunk => { text += chunk; if (!text.includes("ready")) return; child.stdout.removeAllListeners("data");
        if (barrier && request.task_id !== "c") { waiting.push(child); if (waiting.length === 2) for (const pending of waiting) pending.stdin.end("go\n"); }
        else child.stdin.end("go\n"); });
      return await exited;
    } finally { signal.removeEventListener("abort", abort); }
  }
  const callbacks = {
    prepareAttempt: async ({ task, request }) => { operations.push(`bootstrap:${task.task_id}`); if (failure.prepareDelay) await delay(failure.prepareDelay);
      if (failure.preparation) fail("BOOTSTRAP_FAILED"); return { bootstrap: { termination_state: "confirmed", request_sha256: fingerprint(request) } }; },
    persistPreparedAttempt: async ({ attemptId, content, bytes, sha256 }) => {
      const ref = `preparation-${attemptId}.json`;
      evidence.set(ref, Buffer.from(content));
      if (realGit) fs.writeFileSync(path.join(root, ref), content, { flag: "wx" });
      return { ref, sha256, bytes };
    },
    loadPreparedAttempt: async ({ evidence: ref }) => realGit ? fs.readFileSync(path.join(root, ref.ref)) : Buffer.from(evidence.get(ref.ref)),
    createExecutor: async ({ callbacks, request }) => {
      operations.push(`executor:${request.task_id}`);
      let proof = null;
      return {
        executor: {
          getDescriptor: () => clone(chain.descriptor),
          checkAvailability: async () => clone(chain.availability),
          runTask: async (req, { signal, onEvent }) => {
            operations.push(`start:${req.task_id}`); live++; maxLive = Math.max(maxLive, live);
            try {
              let processResult = { code: 0, signal: null };
              if (realGit) processResult = await nativeFixtureWork(req, callbacks, signal);
              else {
                await callbacks.observeRunner({ host_id: "fixture", runner_id: req.attempt_id, pid: 123, started_at: new Date().toISOString() });
                await delay(failure.workerDelay ?? 15);
              }
              if (failure.event) await onEvent({ ...clone(chain.event), event_id: `event.${req.attempt_id}`, run_id: runId,
                task_id: req.task_id, attempt_id: req.attempt_id, plan_sha256: plan.plan_sha256 });
              const outcome = failure.indeterminate === req.task_id ? "indeterminate" : signal.aborted ? "cancelled"
                : failure.task === req.task_id ? "failed" : processResult.code === 0 ? "completed" : "failed";
              const termination_state = outcome === "indeterminate" ? "unknown" : "confirmed";
              proof = termination_state === "confirmed" ? { confirmed: true, attempt_id: req.attempt_id } : null;
              return { contract_version: "agent-task-result.v1", run_id: runId, task_id: req.task_id, attempt_id: req.attempt_id,
                plan_sha256: req.plan_sha256, task_contract_sha256: req.task_contract_sha256, input_sha: req.input_sha,
                outcome, reason_code: "fixture_result", termination_state, process: { exit_code: outcome === "completed" ? 0 : 1, signal: null }, evidence: [],
                ownership: req.ownership, delegation_id: req.delegation_id, request_sha256: fingerprint(req) };
            } finally { live--; operations.push(`stop:${req.task_id}`); }
          },
        }, getTerminationProof: async () => proof, close: async () => {},
      };
    },
    validateTask: async ({ candidateSha, validationIds }) => ({ status: "passed", tested_sha: candidateSha,
      checks: validationIds.map(validation_id => ({ validation_id, status: "passed", tested_sha: candidateSha, evidence: fixtureEvidence })) }),
    validateRun: async ({ integratedSha }) => [{ validation_id: "contents", status: "passed", tested_sha: integratedSha, evidence: fixtureEvidence }],
    auditRun: async ({ integratedSha }) => ({ read_only: true, tested_sha: integratedSha,
      checks: [{ criterion_index: 0, status: "passed", evidence: fixtureEvidence }] }),
  };
  const options = { runId, ownerId: "fixture.supervisor", runner: { host_id: "fixture", runner_id: "fixture.runner", pid: process.pid, started_at: new Date().toISOString() } };
  const create = overrides => createAgentExecutionScheduler({ store, git, ...callbacks, commitIdentity: { name: "AIDN fixture", email: "fixture@example.invalid", timestamp: "2026-09-26T00:00:00Z" },
    makeId: () => `fixture.${++serial}`, ...(clock ? { clock } : {}), ...overrides });
  function cleanup() {
    if (processes.size) fail("FIXTURE_CHILD_STILL_ACTIVE");
    const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("aidn-scheduler-") || fs.readFileSync(path.join(root, "owner"), "utf8") !== token) fail("FIXTURE_CLEANUP_REFUSED");
    fs.rmSync(resolved, { recursive: true }); if (fs.existsSync(resolved)) fail("FIXTURE_CLEANUP_FAILED");
  }
  return { root, state, store, git, fakeGit, plan, options, callbacks, operations, children, create, cleanup, evidence, gitCommand, get maxLive() { return maxLive; } };
}
