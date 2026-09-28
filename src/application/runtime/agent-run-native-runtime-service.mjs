import path from "node:path";
import os from "node:os";
import { createHash, randomUUID, createPublicKey, createPrivateKey } from "node:crypto";
import { createPostgresAgentExecutionStore } from "../../adapters/runtime/postgres-agent-execution-store.mjs";
import { createWindowsProcessTreeController } from "../../adapters/agents/process-tree/windows-process-tree-controller.mjs";
import { createLocalAgentGitIntegration } from "../../adapters/runtime/local-agent-git-integration.mjs";
import { createLocalAgentVerification, createAgentValidationEvidenceVerifier } from "../../adapters/runtime/local-agent-verification.mjs";
import { createCodexSandboxValidationBoundary } from "../../adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { createCodexAgentAttemptService, createControlledGitProcess } from "./codex-agent-attempt-service.mjs";
import { createAgentExecutionScheduler, assertUnclaimedAgentRun } from "./agent-run-supervisor.mjs";
import { inventoryRuntime } from "../install/global-runtime-store.mjs";
import { readAgentRunReference, readAgentRunFile, agentRunPhysicalPath, assertAgentRunSecretScope } from "./agent-run-configuration-service.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";
import { describeAgentRunAssurance, assertAgentRunAssuranceBinding } from "./agent-run-assurance-policy.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const ensure = (condition, code) => { if (!condition) fail(code); };
const copy = value => structuredClone(value);
const same = (a, b) => fingerprint(a) === fingerprint(b);
const equalPath = (a, b) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function absentProcess(runner) {
  if (!runner || runner.host_id !== os.hostname() || !Number.isSafeInteger(runner.pid) || runner.pid <= 0) return false;
  try { process.kill(runner.pid, 0); return false; } catch (cause) { return cause.code === "ESRCH"; }
}
function currentRunner() {
  return { host_id: os.hostname(), runner_id: randomUUID(), pid: process.pid,
    started_at: new Date(Date.now() - process.uptime() * 1000).toISOString() };
}
export function readNativeAgentRunMaterials(context, { execution = false, recoveryOnly = false } = {}) {
  const config = context.configuration, plan = context.plan;
  if (!recoveryOnly) ensure(equalPath(agentRunPhysicalPath(path.resolve(import.meta.dirname, "../../.."), { directory: true }),
    agentRunPhysicalPath(config.native.candidate.packageRoot, { directory: true })), "AGENT_RUN_CANDIDATE_ENGINE_REQUIRED");
  if (!recoveryOnly) ensure(same(inventoryRuntime(config.native.candidate.packageRoot), config.native.candidate.inventory), "AGENT_RUN_CANDIDATE_CHANGED");
  ensure(plan.verification, "AGENT_RUN_VERIFICATION_REQUIRED");
  const preparedManifest = readAgentRunReference(config.prepared_manifest).value;
  const profile = { ...config.native.profile,
    manifest: readAgentRunReference(config.native.profile.manifest).value,
    policy: readAgentRunReference(config.native.profile.policy).value };
  const publicKey = readAgentRunReference(config.verification.public_key, { json: false }).value;
  const publicObject = createPublicKey(publicKey);
  ensure(publicObject.asymmetricKeyType === "ed25519" && hash(publicObject.export({ type: "spki", format: "der" })) === plan.verification.proof_authority_sha256, "AGENT_RUN_PROOF_AUTHORITY_CHANGED");
  const boundaryConfiguration = readAgentRunReference(config.verification.boundary.configuration).value;
  ensure(equalPath(boundaryConfiguration.roots.supervisor, config.resources_root)
    && equalPath(boundaryConfiguration.roots.snapshots, path.join(config.resources_root, "snapshots"))
    && equalPath(boundaryConfiguration.roots.scratch, path.join(config.resources_root, "scratch"))
    && equalPath(boundaryConfiguration.profile.home, config.native.runtime.codexHome), "AGENT_RUN_BOUNDARY_ROOTS_CHANGED");
  const boundaryQualification = readAgentRunReference(config.verification.boundary.qualification).value;
  // This only binds declarations. The boundary still receives the intact envelope
  // and authenticates its signature before making any availability claim.
  assertAgentRunAssuranceBinding(plan, boundaryConfiguration, boundaryQualification?.payload);
  if (["agent-execution-plan.v2", "agent-execution-plan.v3"].includes(plan.contract_version)) ensure(profile.policy.contract_version === "codex-native-profile-policy.v2", "AGENT_RUN_COOPERATIVE_PROFILE_REQUIRED");
  if (execution && !recoveryOnly) {
    assertAgentRunSecretScope(config.resources_root, config.verification.private_key.path);
  }
  const privateKey = execution && !recoveryOnly ? readAgentRunReference(config.verification.private_key, { json: false }).value : null;
  if (privateKey) {
    const secret = createPrivateKey(privateKey), derived = createPublicKey(secret);
    ensure(secret.asymmetricKeyType === "ed25519" && derived.export({ type: "spki", format: "der" }).equals(publicObject.export({ type: "spki", format: "der" })), "AGENT_RUN_PROOF_AUTHORITY_CHANGED");
  }
  return { preparedManifest, profile, publicKey, privateKey, boundaryConfiguration, boundaryQualification,
    auditPolicy: readAgentRunReference(config.verification.audit_policy).value };
}
function makeAssembly({ context, connectionString, verifyActivation }, options = {}) {
  const config = context.configuration, plan = context.plan, selected = readNativeAgentRunMaterials(context, options);
  const attempts = createCodexAgentAttemptService({ ...config.native, preparedManifest: selected.preparedManifest,
    resourcesRoot: config.resources_root, qualificationEvidence: config.native.qualification, profile: selected.profile });
  const controller = createWindowsProcessTreeController({ helperPath: config.native.helper.helper_path,
    helperSha256: config.native.helper.helper_sha256, helperSourceSha256: config.native.helper.source_sha256, candidateSha256: plan.execution.engine.sha256 });
  let store, boundary;
  const getSnapshot = () => store.getRun({ runId: config.run_id });
  function profileStopped(view) {
    const attemptId = view.attempt.attempt_id, prepared = attempts.inspectPreparationTermination({ attemptId });
    ensure(view.request && prepared.intent.request_sha256 === fingerprint(view.request), "AGENT_RUN_PROFILE_STOP_UNCONFIRMED");
    // The retained parent-close flags describe metadata protocol completion.
    // Only the independently checked Job proofs below establish tree death.
    const operations = attempts.inspectProfileOperations({ attemptId });
    ensure(operations.confirmed === true && operations.descendants_termination === "confirmed" && operations.attempt_id === attemptId, "AGENT_RUN_PROFILE_STOP_UNCONFIRMED");
    ensure(operations.operations.every(row => row.intent.request_sha256 === fingerprint(view.request)
      && row.intent.policy_sha256 === fingerprint(selected.profile.policy)), "AGENT_RUN_PROFILE_BINDING_CHANGED");
    return { attempt_id: attemptId, preparation: [prepared.intent_evidence, prepared.terminal_evidence],
      operations_sha256: fingerprint(operations.operations), operation_count: operations.operations.length };
  }
  function workerStopped(view) {
    try { profileStopped(view); } catch { return false; }
    const proof = view.termination ?? view.reconciliation;
    return Boolean(proof && attempts.verifyTermination(view.attempt, proof, {
      runner: view.runner, request: view.request, termination_state: view.result?.termination_state ?? "confirmed" }));
  }
  function gitStopped(record) {
    const proof = record.closed?.termination_proof;
    return record.recovery_required === false && record.closed?.descendants_termination === "confirmed"
      && proof?.active_processes === 0 && proof.helper_sha256 === config.native.helper.helper_sha256
      && proof.source_sha256 === config.native.helper.source_sha256 && proof.candidate_sha256 === plan.execution.engine.sha256;
  }
  const git = createLocalAgentGitIntegration({
    repositoryRoot: config.target_root, resourcesRoot: config.resources_root, integrationRef: config.integration_ref,
    gitExecutable: config.git.executable, preparedWorkspaces: selected.preparedManifest,
    verificationSnapshotsRoot: path.join(config.resources_root, "snapshots"),
    runGitProcess: createControlledGitProcess({ controller, gitExecutable: config.git.executable, gitSha256: config.git.sha256 }),
    requireConfirmedGitTermination: true, journalReadOperations: options.execution === true,
    async verifyTermination({ binding, termination }) {
      const snapshot = await getSnapshot(), view = snapshot.attempts.find(row => row.attempt.attempt_id === binding.attempt_id);
      return { confirmed: Boolean(view && same(view.termination ?? view.reconciliation, termination) && workerStopped(view)), attempt_id: binding.attempt_id };
    },
    async verifyCleanupTermination({ snapshot: supplied }) {
      const snapshot = supplied ?? await getSnapshot(), operations = await git.inspectGitOperations();
      const validations = await boundary.inspectOperations();
      let supervisorStopped = snapshot.supervision.current?.status === "stopped" && Boolean(snapshot.supervision.current.termination);
      if (!supervisorStopped && snapshot.supervision.current) { try { await stopFacts(snapshot, snapshot.supervision.current.runner); supervisorStopped = true; } catch { /* Read-only proof unavailable. */ } }
      return { confirmed: supervisorStopped && snapshot.attempts.every(workerStopped) && !operations.uncertain_read && operations.operations.every(gitStopped)
        && !validations.uncertain_read && validations.operations.every(row => row.recovery_required === false) };
    },
  });
  async function stopFacts(snapshot, runner) {
    const operations = await git.inspectGitOperations();
    ensure(typeof boundary?.inspectOperations === "function", "AGENT_RUN_VALIDATION_OBSERVER_REQUIRED");
    const validationOperations = await boundary.inspectOperations();
    ensure(!validationOperations.uncertain_read && Array.isArray(validationOperations.operations) && validationOperations.operations.every(row => row.recovery_required === false), "AGENT_RUN_VALIDATION_STOP_UNCONFIRMED");
    const attemptFacts = [], profileFacts = [];
    for (const view of snapshot.attempts) {
      profileFacts.push(profileStopped(view));
      if (workerStopped(view)) { attemptFacts.push({ attempt_id: view.attempt.attempt_id, proof: view.termination ?? view.reconciliation }); continue; }
      try {
        const observed = attempts.inspectTermination({ attemptId: view.attempt.attempt_id });
        const proof = observed.process?.termination_proof;
        ensure(proof && attempts.verifyTermination(view.attempt, proof, { runner: view.runner, request: view.request, termination_state: "confirmed" }), "AGENT_RUN_WORKER_STOP_UNCONFIRMED");
        attemptFacts.push({ attempt_id: view.attempt.attempt_id, proof });
      } catch { fail("AGENT_RUN_WORKER_STOP_UNCONFIRMED"); }
    }
    ensure(absentProcess(runner), "AGENT_RUN_SUPERVISOR_STILL_ACTIVE");
    ensure(!operations.uncertain_read && operations.operations.every(gitStopped), "AGENT_RUN_GIT_STOP_UNCONFIRMED");
    return { contract_version: "agent-run-stop-observation.v1", run_id: config.run_id, plan_sha256: plan.plan_sha256,
      runner: copy(runner), attempts: attemptFacts, profiles: profileFacts,
      validation_operations: { count: validationOperations.operations.length, sha256: fingerprint(validationOperations.operations) },
      // Every read must be confirmed, but completed observer reads do not change
      // the material preimage being reconciled. Retain all journals locally.
      git_mutations: { count: operations.operations.filter(row => row.intent.effect_class !== "read-only").length,
        sha256: fingerprint(operations.operations.filter(row => row.intent.effect_class !== "read-only")) } };
  }
  async function unclaimedFacts(snapshot) {
    const observation = assertUnclaimedAgentRun(snapshot);
    ensure(selected.preparedManifest.base_sha === plan.base.sha, "AGENT_RUN_PREPARED_BASE_CHANGED");
    // The adapter recognizes only the exact, sealed worktree creations that
    // legitimately preceded reservation. It refuses all other mutations.
    const operations = await git.inspectUnclaimedPreparation({ preparedWorkspaces: selected.preparedManifest });
    const validations = await boundary.inspectOperations();
    // A pre-claim observer can have crashed with a Git child still alive.
    ensure(!operations.uncertain_read && operations.operations.every(gitStopped), "AGENT_RUN_GIT_STOP_UNCONFIRMED");
    ensure(!validations.uncertain_read && validations.operations.length === 0, "AGENT_RUN_VALIDATION_STOP_UNCONFIRMED");
    return observation;
  }
  async function verifyStop(supervisor, proof) {
    try {
      const snapshot = await getSnapshot(), expected = await stopFacts(snapshot, supervisor.runner);
      return { ok: same(expected, proof), supervisor_stopped: true, descendants_stopped: true, git_operations_stopped: true };
    } catch { return { ok: false, supervisor_stopped: false, descendants_stopped: false, git_operations_stopped: false }; }
  }
  const evidenceVerifier = createAgentValidationEvidenceVerifier({ resourcesRoot: config.resources_root, publicKey: selected.publicKey });
  store = createPostgresAgentExecutionStore({ connectionString, verifyActivation, verifyTermination: attempts.verifyTermination,
    verifySupervisorTermination: verifyStop, verifyCleanupTermination: async (...args) => { const value = await verifyStop(...args); return { ...value, cleaner_stopped: value.supervisor_stopped }; },
    inspectIntegration: (entry, options) => git.inspectIntegration(entry, options),
    inspectCleanup: (resource, options) => git.inspectCleanup(resource, options), validationEvidenceVerifier: evidenceVerifier });
  boundary = createCodexSandboxValidationBoundary({ configuration: selected.boundaryConfiguration,
    qualification: selected.boundaryQualification, publicKey: selected.publicKey, evidenceRoot: config.resources_root });
  const verification = createLocalAgentVerification({ resourcesRoot: config.resources_root, scratchRoot: path.join(config.resources_root, "scratch"),
    runId: config.run_id, git, runner: config.verification.runner, environment: config.verification.environment,
    auditPolicy: selected.auditPolicy, publicKey: selected.publicKey, privateKey: selected.privateKey, boundary, readRun: getSnapshot });
  return { attempts, git, store, boundary, verification, selected, stopFacts, unclaimedFacts, workerStopped, getSnapshot };
}

export async function inspectNativeAgentRun(input) {
  const { args, context } = input, config = context.configuration, plan = context.plan;
  const blockers = [], resources = [], material = describeAgentRunAssurance(plan);
  try {
    const recoveryOnly = args.command === "agent-run-cleanup" || Boolean(context.snapshot?.cancel_request);
    const assembled = makeAssembly(input, { recoveryOnly });
    const { attempts, git, boundary, selected } = assembled;
    if (!recoveryOnly) {
      const available = attempts.inspectAvailability({ plan });
      material.executor = available; if (!available.available) blockers.push(available.reason_code);
      const boundaryStatus = await boundary.checkAvailability({ signal: AbortSignal.timeout(10000) });
      material.validation = boundaryStatus; if (!boundaryStatus.available) blockers.push(boundaryStatus.reason_code);
      if (["agent-execution-plan.v2", "agent-execution-plan.v3"].includes(plan.contract_version)) material.qualification_status = available.available && boundaryStatus.available ? "qualified" : "unavailable";
    }
    const head = await git.inspectIntegration({ phase: "head" });
    material.integration_head = head;
    if (args.command === "agent-run") {
      if (head.head_sha !== null && head.head_sha !== plan.base.sha) blockers.push("AGENT_RUN_INTEGRATION_BASE_CHANGED");
      ensure(selected.preparedManifest.base_sha === plan.base.sha, "AGENT_RUN_PREPARED_BASE_CHANGED");
      for (const row of selected.preparedManifest.workspaces) {
        const observed = await git.inspectPreparedAttemptWorkspace({ preparedWorkspace: row, expectedPreparationSha256: row.preparation.preimage_sha256 });
        resources.push({ task_id: row.task_id, cwd: row.workspace.cwd, preimage_sha256: row.preparation.preimage_sha256,
          observed_sha256: fingerprint(observed) });
      }
    } else if (args.command === "agent-run-resume") {
      if (!context.snapshot.supervision.current) material.unclaimed_run = await assembled.unclaimedFacts(context.snapshot);
      else material.termination = await assembled.stopFacts(context.snapshot, context.snapshot.supervision.current.runner);
    } else if (args.command === "agent-run-cleanup") {
      const { previewNativeAgentCleanup } = await import("./agent-run-cleanup-service.mjs");
      const preview = await previewNativeAgentCleanup({ ...input, assembled });
      blockers.push(...preview.blockers); resources.push(...preview.resources); material.cleanup = preview.material;
    }
  } catch (cause) { blockers.push(/^[A-Z][A-Z0-9_]{0,100}$/.test(cause.code ?? "") ? cause.code : "AGENT_RUN_NATIVE_UNAVAILABLE"); }
  return { blockers: [...new Set(blockers)], resources, material };
}

export async function createNativeAgentRunRuntime(input) {
  const { args, context } = input, config = context.configuration, recoveryOnly = args.command === "agent-run-cleanup" || Boolean(context.snapshot?.cancel_request);
  const assembled = makeAssembly(input, { execution: true, recoveryOnly });
  const { attempts, git, store, verification } = assembled;
  const ownerId = randomUUID(), runner = currentRunner();
  const scheduler = createAgentExecutionScheduler({
    store, git, prepareAttempt: attempts.prepareAttempt, persistPreparedAttempt: attempts.persistPreparedAttempt,
    loadPreparedAttempt: attempts.loadPreparedAttempt, createExecutor: attempts.createExecutor,
    validateTask: verification.validateTask, validateRun: verification.validateRun, auditRun: verification.auditRun,
    commitIdentity: config.commit_identity,
  });
  return {
    store, scheduler, ownerId, runner,
    async observeReconciliation(current) {
      const fresh = await store.getRun({ runId: config.run_id });
      ensure(fresh.run.plan_sha256 === current.plan.plan_sha256 && fresh.supervision.control_revision === current.snapshot.supervision.control_revision, "AGENT_RUN_PREVIEW_CHANGED");
      if (!fresh.supervision.current) return { unclaimedRun: await assembled.unclaimedFacts(fresh), attempts: [] };
      const proof = await assembled.stopFacts(fresh, fresh.supervision.current.runner);
      return { supervisorProof: proof, attempts: proof.attempts.filter(row => {
        const view = fresh.attempts.find(value => value.attempt.attempt_id === row.attempt_id);
        return ["running", "launch_intended", "recovery_required"].includes(view.attempt.lifecycle_status);
      }).map(row => ({ attemptId: row.attempt_id, proof: row.proof })) };
    },
    async cleanup(options) {
      const { applyNativeAgentCleanup } = await import("./agent-run-cleanup-service.mjs");
      return applyNativeAgentCleanup({ ...input, ...options, assembled, ownerId, runner });
    },
    close: () => attempts.close(),
  };
}
