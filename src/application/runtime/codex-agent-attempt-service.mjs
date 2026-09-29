import fs from "node:fs";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fingerprintAgentExecutionValue as fingerprint, fingerprintTaskContract, assertAgentExecutionContract } from "../../core/agents/agent-execution-contracts.mjs";
import { createCodexCliTaskExecutor, createCodexWorkerEnvironment } from "../../adapters/agents/codex-cli-task-executor.mjs";
import { createWindowsProcessTreeController } from "../../adapters/agents/process-tree/windows-process-tree-controller.mjs";
import { createAgentTaskEvidenceStore } from "../../adapters/agents/agent-task-evidence-store.mjs";
import { assertCodexNativeProfileBinding, assertCodexNativeProfileVerification, fingerprintCodexNativeProfilePolicy, resolveCodexNativeProfileStatePaths } from "../../adapters/agents/codex-native-profile-policy.mjs";
import { createAgentWorktreeInspector } from "./agent-worktree-inspection-service.mjs";
import { createDelegatedAgentAdmissionService } from "./delegated-agent-admission-service.mjs";
import { startAgentAdmissionTransport } from "../../adapters/runtime/agent-admission-transport.mjs";
import { readActivation } from "../install/project-activation-service.mjs";
import { createCodexNativeProfileVerifier, createCodexNativeProfileObserver, observerMetadata } from "./codex-native-profile-observation-service.mjs";
import { bootstrapCodexNativeProfile } from "./codex-native-profile-bootstrap-service.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireProof = (value, code) => { if (!value) fail(code); };
const hash = value => createHash("sha256").update(value).digest("hex");
const same = (a, b) => fingerprint(a) === fingerprint(b);
const digest = value => /^[a-f0-9]{64}$/.test(value ?? "");
const equalPath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (parent, child) => { const relative = path.relative(parent, child); return !relative || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`); };
function physical(input, type = "file") {
  assertAgentLocalPath(input);
  requireProof(typeof input === "string" && path.isAbsolute(input) && path.normalize(input) === input, "AGENT_NATIVE_PATH_INVALID");
  let current = input;
  while (true) { const stat = fs.lstatSync(current); requireProof(!stat.isSymbolicLink(), "AGENT_NATIVE_PATH_REDIRECT"); const parent = path.dirname(current); if (parent === current) break; current = parent; }
  const stat = fs.lstatSync(input);
  requireProof(type === "directory" ? stat.isDirectory() : stat.isFile() && stat.nlink === 1, "AGENT_NATIVE_PATH_INVALID");
  requireProof(equalPath(fs.realpathSync.native(input), input), "AGENT_NATIVE_PATH_REDIRECT"); return stat;
}
function fileHash(file, maxBytes = 64 * 1024 * 1024) {
  const stat = physical(file); requireProof(stat.size <= maxBytes, "AGENT_NATIVE_EVIDENCE_LIMIT");
  const descriptor = fs.openSync(file, "r");
  try {
    const opened = fs.fstatSync(descriptor);
    requireProof(opened.isFile() && opened.nlink === 1 && opened.size <= maxBytes, "AGENT_NATIVE_EVIDENCE_LIMIT");
    requireProof(stat.ino === opened.ino && stat.dev === opened.dev && stat.size === opened.size
      && stat.mtimeMs === opened.mtimeMs && stat.ctimeMs === opened.ctimeMs, "AGENT_NATIVE_EVIDENCE_CHANGED");
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      requireProof(read > 0, "AGENT_NATIVE_EVIDENCE_CHANGED"); offset += read;
    }
    const after = fs.fstatSync(descriptor), final = physical(file);
    requireProof(after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs
      && final.ino === opened.ino && final.dev === opened.dev && final.size === opened.size
      && final.mtimeMs === opened.mtimeMs && final.ctimeMs === opened.ctimeMs, "AGENT_NATIVE_EVIDENCE_CHANGED");
    return { bytes, sha256: hash(bytes) };
  } finally { fs.closeSync(descriptor); }
}
export function loadCodexNativePinnedJson(reference) {
  requireProof(reference && digest(reference.sha256), "AGENT_NATIVE_REFERENCE_INVALID");
  const observed = fileHash(reference.path, 16 * 1024 * 1024);
  requireProof(observed.sha256 === reference.sha256, "AGENT_NATIVE_EVIDENCE_CHANGED");
  try { return JSON.parse(observed.bytes.toString("utf8")); } catch { fail("AGENT_NATIVE_EVIDENCE_INVALID"); }
}
function writeImmutable(root, name, value) {
  physical(root, "directory"); const file = path.join(root, name), bytes = Buffer.from(JSON.stringify(value));
  if (fs.existsSync(file)) requireProof(fileHash(file).bytes.equals(bytes), "AGENT_NATIVE_EVIDENCE_CHANGED");
  else fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return { ref: name, bytes: bytes.length, sha256: hash(bytes) };
}
function resourceEvidence(resourcesRoot, evidenceRoot, reference) {
  const relative = path.relative(resourcesRoot, path.join(evidenceRoot, reference.ref));
  requireProof(relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`), "AGENT_NATIVE_EVIDENCE_OUTSIDE_RESOURCES");
  return { ...reference, ref: relative.split(path.sep).join("/") };
}
function directory(parent, name) {
  physical(parent, "directory"); const result = path.join(parent, name);
  fs.mkdirSync(result); physical(result, "directory"); return result;
}

// This journal surrounds the observer that actually owns each metadata process.
// Challenge decisions deliberately omit process details; they cannot replace it.
export function createCodexProfileOperationJournal({ resourcesRoot, attemptId, observe = observerMetadata, expectedTree = null }) {
  requireProof(typeof attemptId === "string" && typeof observe === "function", "AGENT_NATIVE_PROFILE_JOURNAL_INVALID");
  const root = path.join(resourcesRoot, `native-attempt-${hash(attemptId)}`);
  return Object.freeze({
    async observe(options) {
      requireProof(options?.request?.attempt_id === attemptId, "AGENT_NATIVE_PROFILE_JOURNAL_INVALID");
      const operationId = randomUUID(), prefix = `profile-operation-${operationId}`;
      const intent = { operation_id: operationId, attempt_id: attemptId, request_sha256: fingerprint(options.request),
        policy_sha256: fingerprint(options.policy), metadata_bootstrap: options.metadataBootstrap === true,
        budget_ms: options.timeoutMs, started_at: new Date().toISOString() };
      const reference = writeImmutable(root, `${prefix}.intent.json`, intent);
      const terminal = (status, process, reason = null) => writeImmutable(root, `${prefix}.terminal.json`, {
        operation_id: operationId, attempt_id: attemptId, request_sha256: intent.request_sha256, intent_sha256: reference.sha256,
        status, reason, process_cleanup: process?.closed === true && process?.pid_absent === true ? "CONFIRMED" : "UNCONFIRMED",
        process: process ?? null,
      });
      try { const result = await observe(options); terminal("COMPLETED", result?.process); return result; }
      catch (error) { terminal("FAILED", error.process, /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "PROFILE_OBSERVATION_FAILED"); throw error; }
    },
    inspect() {
      physical(root, "directory"); const names = fs.readdirSync(root);
      requireProof(names.length <= 1024, "AGENT_NATIVE_PROFILE_JOURNAL_LIMIT");
      const intents = names.filter(name => /^profile-operation-[a-f0-9-]{36}\.intent\.json$/.test(name)).sort();
      requireProof(intents.length > 0 && intents.length <= 128, "AGENT_NATIVE_PROFILE_TERMINATION_UNAVAILABLE");
      const operations = intents.map(name => {
        const opened = fileHash(path.join(root, name), 65536), intent = JSON.parse(opened.bytes.toString("utf8"));
        const terminalName = name.replace(/\.intent\.json$/, ".terminal.json");
        requireProof(fs.existsSync(path.join(root, terminalName)), "AGENT_NATIVE_PROFILE_TERMINATION_UNCONFIRMED");
        const closed = fileHash(path.join(root, terminalName), 65536), terminal = JSON.parse(closed.bytes.toString("utf8"));
        requireProof(intent.attempt_id === attemptId && terminal.attempt_id === attemptId && terminal.operation_id === intent.operation_id
          && terminal.request_sha256 === intent.request_sha256 && terminal.intent_sha256 === opened.sha256,
        "AGENT_NATIVE_PROFILE_JOURNAL_CHANGED");
        const tree = terminal.process?.tree_termination, proof = tree?.proof, runner = tree?.runner;
        const treeConfirmed = expectedTree && tree?.termination_state === "confirmed" && proof?.method === "windows-job-object"
          && typeof runner?.runner_id === "string" && runner.runner_id.length > 0 && Number.isSafeInteger(runner.pid) && runner.pid > 0
          && typeof runner.started_at === "string" && Number.isFinite(Date.parse(runner.started_at))
          && /^Local\\aidn-execution-[a-f0-9]{32}$/.test(runner.job_name ?? "")
          && proof.active_processes === 0 && ["runner_id", "pid", "started_at", "job_name"].every(key => proof[key] === runner?.[key])
          && runner?.executable_sha256 === expectedTree.metadata_runner_sha256
          && ["candidate_sha256", "helper_sha256", "source_sha256"].every(key => digest(expectedTree[key]) && proof[key] === expectedTree[key] && runner[key] === expectedTree[key])
          && ["bridge_sha256", "collector_sha256", "candidate_inventory_sha256"].every(key => digest(expectedTree[key]) && tree[key] === expectedTree[key])
          && digest(tree.request_sha256);
        return { intent, terminal,
          metadata_parent_closed: terminal.process?.closed === true && terminal.process?.pid_absent === true,
          descendants_termination: treeConfirmed ? "confirmed" : "unconfirmed",
          intent_evidence: resourceEvidence(resourcesRoot, root, { ref: name, sha256: opened.sha256, bytes: opened.bytes.length }),
          terminal_evidence: resourceEvidence(resourcesRoot, root, { ref: terminalName, sha256: closed.sha256, bytes: closed.bytes.length }) };
      });
      return { confirmed: operations.every(row => row.descendants_termination === "confirmed"), attempt_id: attemptId,
        metadata_parent_closed: operations.every(row => row.metadata_parent_closed),
        descendants_termination: operations.every(row => row.descendants_termination === "confirmed") ? "confirmed" : "unconfirmed", operations };
    },
  });
}

// No probe, filesystem access, native process or implicit registration occurs at
// construction. The selected profile is explicit and has no isolated fallback.
export function createCodexAgentAttemptService({ candidate, runtime, helper, metadata_runner, preparedManifest, resourcesRoot, qualificationEvidence, profile } = {}) {
  requireProof(candidate && runtime && helper && preparedManifest && profile && path.isAbsolute(resourcesRoot ?? ""), "AGENT_NATIVE_CONFIGURATION_REQUIRED");
  const frozen = structuredClone({ candidate, runtime, helper, metadata_runner, preparedManifest, resourcesRoot, qualificationEvidence, profile });
  const attempts = new Map(), nativeModules = { assertCodexNativeProfileBinding, assertCodexNativeProfileVerification };
  let closed = false;
  const expectedTree = {
    candidate_sha256: frozen.candidate.sha256, helper_sha256: frozen.helper.helper_sha256, source_sha256: frozen.helper.source_sha256,
    metadata_runner_sha256: frozen.metadata_runner?.sha256,
    bridge_sha256: frozen.candidate.inventory?.["src/adapters/agents/process-tree/codex-profile-metadata-bridge.mjs"],
    collector_sha256: frozen.candidate.inventory?.["src/application/runtime/codex-native-profile-observation-service.mjs"],
    candidate_inventory_sha256: frozen.candidate.inventory ? fingerprint(frozen.candidate.inventory) : null,
  };
  function evidenceFor(request) {
    const file = path.join(resourcesRoot, `native-termination-${hash(request.attempt_id)}.json`);
    return JSON.parse(fileHash(file).bytes.toString("utf8"));
  }
  function inspect({ plan, request } = {}) {
    requireProof(process.platform === "win32" && process.arch === "x64", "AGENT_NATIVE_OS_UNAVAILABLE");
    const selected = request?.execution ?? plan?.execution;
    requireProof(selected && same(selected.engine, { version: frozen.candidate.version, sha256: frozen.candidate.sha256 })
      && same(frozen.runtime.engine, selected.engine), "AGENT_NATIVE_CANDIDATE_CHANGED");
    const policy = frozen.profile.policy;
    requireProof(policy?.mode === "preexisting" && selected.native_profile?.policy_sha256 === fingerprintCodexNativeProfilePolicy(policy)
      && selected.native_profile.mode === "preexisting" && frozen.runtime.codexHome === policy.home.physical_path
      && frozen.runtime.sha256 === policy.client_sha256, "AGENT_NATIVE_PROFILE_UNAVAILABLE");
    requireProof(frozen.profile.consent?.approved === true && frozen.profile.consent.shared_effects_sha256 === policy.effects.shared_effects_sha256
      && frozen.profile.consent.state_root === policy.effects.state_root, "AGENT_NATIVE_PROFILE_CONSENT_REQUIRED");
    const roots = frozen.profile.manifest?.roots?.filter(item => /^worker-[a-z0-9_-]+$/.test(item.role ?? ""));
    requireProof(!Array.isArray(roots) || roots.length <= 4, "AGENT_NATIVE_PREPARED_ROOT_CAPACITY_UNAVAILABLE");
    const rows = frozen.preparedManifest.workspaces;
    requireProof(roots?.length >= 1 && roots.length <= 4 && roots.length === frozen.preparedManifest.workspaces?.length
      && new Set(roots.map(root => path.resolve(root.root).toLowerCase())).size === roots.length
      && new Set(roots.map(root => root.worktree_id)).size === roots.length
      && new Set(rows.map(row => path.resolve(row.workspace.cwd).toLowerCase())).size === rows.length
      && new Set(rows.map(row => row.workspace.branch.toLowerCase())).size === rows.length
      && new Set(rows.map(row => row.workspace.worktree_id)).size === rows.length
      && rows.every(row => roots.some(root => equalPath(root.root, row.workspace.cwd) && root.worktree_id === row.workspace.worktree_id
        && root.branch === row.workspace.branch)), "AGENT_NATIVE_ROOT_REVIEW_REQUIRED");
    for (const root of frozen.profile.manifest.roots) {
      requireProof(fileHash(root.hooks.config.path).sha256 === root.hooks.config.sha256, "AGENT_NATIVE_HOOK_CHANGED");
      for (const handler of root.hooks.handlers) requireProof(fileHash(path.join(root.root, handler.path)).sha256 === handler.sha256, "AGENT_NATIVE_HOOK_CHANGED");
    }
    requireProof(fileHash(frozen.runtime.executable, 512 * 1024 * 1024).sha256 === frozen.runtime.sha256
      && fileHash(frozen.helper.helper_path, 64 * 1024 * 1024).sha256 === frozen.helper.helper_sha256
      && fileHash(frozen.candidate.archivePath, 128 * 1024 * 1024).sha256 === frozen.candidate.sha256, "AGENT_NATIVE_EXECUTABLE_CHANGED");
    requireProof(digest(frozen.metadata_runner?.sha256)
      && fileHash(frozen.metadata_runner.executable, 256 * 1024 * 1024).sha256 === frozen.metadata_runner.sha256, "AGENT_NATIVE_METADATA_RUNNER_REQUIRED");
    const qualified = loadCodexNativePinnedJson(frozen.qualificationEvidence);
    requireProof(qualified.contract_version === "local-native-milestone-review.v1" && qualified.status === "PASS"
      && qualified.candidate_sha256 === frozen.candidate.sha256 && qualified.client_sha256 === frozen.runtime.sha256
      && qualified.helper_sha256 === frozen.helper.helper_sha256 && qualified.platform === process.platform && qualified.architecture === process.arch
      && qualified.model === selected.model && qualified.effort === selected.effort && qualified.results?.native_cases === "PASS"
      && qualified.results?.process_termination === "CONFIRMED" && qualified.results?.profile_preservation === "PASS"
      && qualified.results?.principal_sandbox_confirmation === "PASS" && qualified.terminal_preserved_unchanged === true,
    "AGENT_NATIVE_QUALIFICATION_UNAVAILABLE");
    requireProof(Array.isArray(qualified.evidence) && qualified.evidence.length > 0 && qualified.evidence.length <= 32, "AGENT_NATIVE_QUALIFICATION_UNAVAILABLE");
    for (const ref of qualified.evidence) requireProof(digest(ref.sha256) && fileHash(ref.path).sha256 === ref.sha256, "AGENT_NATIVE_EVIDENCE_CHANGED");
    requireProof(frozen.preparedManifest.contract_version === "agent-prepared-workspaces.v1"
      && Array.isArray(frozen.preparedManifest.workspaces), "AGENT_NATIVE_PREPARATION_REQUIRED");
    if (request) {
      assertCodexNativeProfileBinding(policy, request, frozen.runtime);
      const row = frozen.preparedManifest.workspaces.find(item => item.task_id === request.task_id);
      requireProof(row?.workspace.cwd === request.cwd && row.task_contract_sha256 === request.task_contract_sha256, "AGENT_NATIVE_PREPARATION_CHANGED");
    } else for (const task of plan.tasks) {
      const row = frozen.preparedManifest.workspaces.find(item => item.task_id === task.task_id);
      requireProof(row?.task_contract_sha256 === fingerprintTaskContract(task), "AGENT_NATIVE_PREPARATION_CHANGED");
    }
    return { available: true, reason_code: "AGENT_NATIVE_PINNED_PREREQUISITES", native_trust: "FRESH_OBSERVATION_REQUIRED" };
  }
  const service = {
    async persistPreparedAttempt({ attemptId, content, sha256, bytes }) {
      requireProof(typeof attemptId === "string" && Buffer.isBuffer(content) && content.length <= 16 * 1024 * 1024
        && content.length === bytes && hash(content) === sha256, "AGENT_NATIVE_PREPARATION_EVIDENCE_INVALID");
      const parsed = JSON.parse(content.toString("utf8"));
      requireProof(parsed.attempt_id === attemptId && parsed.contract_version === "agent-attempt-preparation.v1", "AGENT_NATIVE_PREPARATION_EVIDENCE_INVALID");
      physical(resourcesRoot, "directory"); const ref = `prepared-attempt-${hash(attemptId)}.json`, file = path.join(resourcesRoot, ref);
      if (fs.existsSync(file)) requireProof(fileHash(file).bytes.equals(content), "AGENT_NATIVE_EVIDENCE_CHANGED");
      else fs.writeFileSync(file, content, { flag: "wx", mode: 0o600 });
      return { ref, sha256, bytes };
    },
    async loadPreparedAttempt({ attempt, evidence }) {
      requireProof(evidence?.ref === `prepared-attempt-${hash(attempt.attempt_id)}.json`, "AGENT_NATIVE_PREPARATION_EVIDENCE_INVALID");
      const actual = fileHash(path.join(resourcesRoot, evidence.ref), 16 * 1024 * 1024);
      requireProof(actual.sha256 === evidence.sha256 && actual.bytes.length === evidence.bytes, "AGENT_NATIVE_EVIDENCE_CHANGED"); return actual.bytes;
    },
    inspectTermination({ attemptId }) {
      const record = JSON.parse(fileHash(path.join(resourcesRoot, `native-termination-${hash(attemptId)}.json`)).bytes.toString("utf8"));
      requireProof(record.attempt_id === attemptId, "AGENT_NATIVE_TERMINATION_CHANGED"); return record;
    },
    inspectNotStarted({ attemptId }) {
      const record = JSON.parse(fileHash(path.join(resourcesRoot, `native-not-started-${hash(attemptId)}.json`)).bytes.toString("utf8"));
      assertAgentExecutionContract("result", record.result);
      requireProof(!fs.existsSync(path.join(resourcesRoot, `native-termination-${hash(attemptId)}.json`))
        && record.result.attempt_id === attemptId && record.result.termination_state === "not_started"
        && record.proof?.method === "codex-not-started" && record.proof.attempt_id === attemptId
        && typeof record.proof.native_create_requested === "boolean"
        && (record.proof.native_create_requested
          ? record.process?.termination_state === "not_started" && !record.process.runner
          : record.process === null), "AGENT_NATIVE_TERMINATION_CHANGED");
      return record;
    },
    inspectPreparationTermination({ attemptId }) {
      const root = path.join(resourcesRoot, `native-attempt-${hash(attemptId)}`);
      const read = name => {
        try {
          const observed = fileHash(path.join(root, name), 65536), value = JSON.parse(observed.bytes.toString("utf8"));
          return { value, evidence: resourceEvidence(resourcesRoot, root, { ref: name, sha256: observed.sha256, bytes: observed.bytes.length }) };
        } catch (error) { if (error.code === "ENOENT") fail("AGENT_NATIVE_PREPARATION_TERMINATION_UNAVAILABLE"); throw error; }
      };
      const intent = read("native-profile-preparation.intent.json"), terminal = read("native-profile-preparation.terminal.json");
      requireProof(intent.value.attempt_id === attemptId && terminal.value.attempt_id === attemptId
        && digest(intent.value.request_sha256) && terminal.value.request_sha256 === intent.value.request_sha256, "AGENT_NATIVE_PREPARATION_EVIDENCE_INVALID");
      return { intent: intent.value, terminal: terminal.value, intent_evidence: intent.evidence, terminal_evidence: terminal.evidence };
    },
    inspectProfileOperations({ attemptId }) {
      return createCodexProfileOperationJournal({ resourcesRoot, attemptId, expectedTree }).inspect();
    },
    inspectAvailability(options) {
      try { return inspect(options); }
      catch (error) { return { available: false, reason_code: /^[A-Z_]+$/.test(error.code ?? "") ? error.code : "AGENT_NATIVE_PREREQUISITE_UNAVAILABLE" }; }
    },
    async prepareAttempt({ plan, task, attempt, delegation, request, binding, callbacks, signal }) {
      requireProof(!closed && !attempts.has(request.attempt_id), "AGENT_NATIVE_ATTEMPT_ALREADY_PREPARED");
      assertAgentExecutionContract("request", request); inspect({ request });
      requireProof(typeof callbacks?.admitDelegatedRequest === "function" && typeof callbacks.recordLaunchIntent === "function" && typeof callbacks.observeRunner === "function", "AGENT_NATIVE_SUPERVISOR_REQUIRED");
      if (signal?.aborted) fail("AGENT_NATIVE_PREPARATION_CANCELLED");
      physical(resourcesRoot, "directory"); physical(request.cwd, "directory");
      requireProof(!inside(request.cwd, resourcesRoot) && !inside(resourcesRoot, frozen.runtime.codexHome), "AGENT_NATIVE_RESOURCE_OVERLAP");
      const activation = readActivation({ targetRoot: request.cwd });
      requireProof(activation.state === "active" && activation.active && activation.identity.root_id === attempt.worktree.worktree_id
        && activation.receipt?.package?.root === frozen.candidate.packageRoot, "AGENT_NATIVE_ACTIVATION_REQUIRED");
      const root = directory(resourcesRoot, `native-attempt-${hash(request.attempt_id)}`), temp = directory(root, "temporary"), evidenceRoot = directory(root, "evidence");
      const marker = path.join(request.cwd, ".codex/aidn-agent-attempt.json"); physical(path.dirname(marker), "directory");
      fs.writeFileSync(marker, JSON.stringify({ protocol_version: 1, attempt_id: request.attempt_id, request_sha256: fingerprint(request) }), { flag: "wx", mode: 0o600 });
      const admission = createDelegatedAgentAdmissionService({ store: { admitDelegatedRequest: ({ evaluate }) => callbacks.admitDelegatedRequest({ evaluate }) },
        binding: { attemptId: request.attempt_id, ownership: attempt.ownership, requestSha256: fingerprint(request), delegationSha256: fingerprint(delegation) },
        inspectWorktree: createAgentWorktreeInspector({ candidate: frozen.candidate }) });
      const state = resolveCodexNativeProfileStatePaths(frozen.profile.policy, request);
      physical(path.dirname(state.root), "directory"); fs.mkdirSync(state.root); fs.mkdirSync(state.logs); fs.mkdirSync(state.sqlite);
      const { createControlledCodexProfileMetadata } = await import("./controlled-codex-profile-metadata.mjs");
      const metadataController = createWindowsProcessTreeController({ helperPath: frozen.helper.helper_path, helperSha256: frozen.helper.helper_sha256,
        helperSourceSha256: frozen.helper.source_sha256, candidateSha256: frozen.candidate.sha256 });
      const metadataObserver = createCodexNativeProfileObserver({ collect: createControlledCodexProfileMetadata({ controller: metadataController,
        nodeRuntime: frozen.metadata_runner, candidateRoot: frozen.candidate.packageRoot, candidateInventory: frozen.candidate.inventory }) });
      const profileJournal = createCodexProfileOperationJournal({ resourcesRoot, attemptId: request.attempt_id, expectedTree, observe: metadataObserver });
      const verifier = createCodexNativeProfileVerifier({ ...frozen.profile, outputRoot: root, observer: profileJournal.observe });
      const prepared = { request: structuredClone(request), attempt: structuredClone(attempt), root, temp, evidenceRoot, admission, verifier, execution: null, process: null, closed: false };
      attempts.set(request.attempt_id, prepared);
      writeImmutable(root, "native-profile-preparation.intent.json", { attempt_id: request.attempt_id, request_sha256: fingerprint(request),
        policy_sha256: fingerprintCodexNativeProfilePolicy(frozen.profile.policy), started_at: new Date().toISOString(), budget_ms: 60000, native_worker: "NOT_STARTED" });
      let bootstrap;
      try {
        bootstrap = await bootstrapCodexNativeProfile({ modules: nativeModules, policy: frozen.profile.policy, runtime: frozen.runtime, request,
          verify: verifier, admitLaunch: options => admission.preflight(options), signal, rootCount: frozen.profile.manifest.roots.filter(item => /^worker-[a-z0-9_-]+$/.test(item.role ?? "")).length });
        writeImmutable(root, "native-profile-preparation.terminal.json", { attempt_id: request.attempt_id, request_sha256: fingerprint(request), status: "COMPLETED", process_cleanup: "CONFIRMED", process: bootstrap.observation.process, native_worker: "NOT_STARTED" });
      } catch (error) {
        writeImmutable(root, "native-profile-preparation.terminal.json", { attempt_id: request.attempt_id, request_sha256: fingerprint(request), status: "FAILED", reason: error.code ?? "AGENT_NATIVE_PREPARATION_FAILED",
          process_cleanup: error.nativeProfilePreparation?.process_cleanup ?? "UNCONFIRMED", process: error.nativeProfilePreparation?.process ?? null, native_worker: "NOT_STARTED" });
        throw error;
      }
      return { request_sha256: fingerprint(request), preparation_ref: resourceEvidence(resourcesRoot, root, writeImmutable(root, "preparation.json", { request_sha256: fingerprint(request), bootstrap })),
        bootstrap: { termination_state: "confirmed", process: bootstrap.observation.process }, binding: structuredClone(binding) };
    },
    async createExecutor({ request, callbacks, signal }) {
      const state = attempts.get(request.attempt_id);
      requireProof(state && !state.execution && !state.closed && same(state.request, request), "AGENT_NATIVE_PREPARATION_REQUIRED");
      if (signal?.aborted) fail("AGENT_NATIVE_EXECUTOR_CANCELLED");
      let transport;
      try {
        transport = await startAgentAdmissionTransport({ admit: (packet, options) => state.admission.admit(packet, options), attemptId: request.attempt_id, requestSha256: fingerprint(request) });
        const env = createCodexWorkerEnvironment({ codexHome: frozen.runtime.codexHome, tempDirectory: state.temp,
          admission: { endpoint: transport.endpoint, token: transport.token, attemptId: request.attempt_id, requestSha256: fingerprint(request) } });
        const native = createWindowsProcessTreeController({ helperPath: frozen.helper.helper_path, helperSha256: frozen.helper.helper_sha256,
          helperSourceSha256: frozen.helper.source_sha256, candidateSha256: frozen.candidate.sha256 });
        const controller = { checkAvailability: options => native.checkAvailability(options), async run(input, options) {
          state.launch_requested = true;
          state.process = await native.run(input, options);
          writeImmutable(resourcesRoot, `native-termination-${hash(request.attempt_id)}.json`, { attempt_id: request.attempt_id,
            request_sha256: fingerprint(request), process: state.process });
          return state.process;
        } };
        const evidence = createAgentTaskEvidenceStore({ root: state.evidenceRoot });
        const actualExecutor = createCodexCliTaskExecutor({ runtime: { ...frozen.runtime, nativeProfilePolicy: frozen.profile.policy }, controller,
          qualify: async () => ({ qualified: inspect({ request }).available }), prepare: async () => ({ request_sha256: fingerprint(request), env }),
          recordLaunchIntent: async () => callbacks.recordLaunchIntent(),
          observeRunner: async (_request, event) => callbacks.observeRunner({ runner_id: event.runner_id, pid: event.pid, host_id: os.hostname(), started_at: new Date(event.started_at).toISOString() }),
          admitLaunch: async (_request, options) => state.admission.preflight(options), verifyNativeProfile: state.verifier,
          openEvidence: async () => {
            const opened = await evidence.open(request);
            return { append: (stream, chunk) => opened.append(stream, chunk),
              finish: async observation => (await opened.finish(observation)).map(reference => resourceEvidence(resourcesRoot, state.evidenceRoot, reference)) };
          } });
        const executor = { getDescriptor: () => actualExecutor.getDescriptor(), checkAvailability: options => actualExecutor.checkAvailability(options), async runTask(input, options) {
          const result = await actualExecutor.runTask(input, options);
          if (result.termination_state === "not_started") {
            state.not_started = { method: "codex-not-started", attempt_id: request.attempt_id, request_sha256: fingerprint(request), native_create_requested: state.launch_requested === true };
            writeImmutable(resourcesRoot, `native-not-started-${hash(request.attempt_id)}.json`, { result, proof: state.not_started, process: state.process });
          }
          return result;
        } };
        let closePromise;
        state.execution = { executor, getTerminationProof: async () => state.process?.termination_proof ?? state.not_started ?? null,
          close() { closePromise ??= (async () => { await transport.close(); state.closed = true;
            if (state.process?.termination_state === "unknown") fail("AGENT_NATIVE_TERMINATION_UNCONFIRMED");
            if (state.process?.termination_state === "confirmed") {
              const final = await state.verifier.finalize({ request, signal: AbortSignal.timeout(15000) }); writeImmutable(state.root, "profile-final.json", final);
            } })(); return closePromise; } };
        return state.execution;
      } catch (error) { if (transport) await transport.close(); throw error; }
    },
    verifyTermination(attempt, proof, context) {
      try {
        if (context?.termination_state === "not_started") {
          const record = service.inspectNotStarted({ attemptId: attempt.attempt_id });
          return !context.runner && same(record.proof, proof)
            && proof.request_sha256 === fingerprint(context.request) && record.result.request_sha256 === proof.request_sha256
            && ["run_id", "task_id", "attempt_id", "plan_sha256", "task_contract_sha256", "input_sha", "delegation_id", "ownership"]
              .every(field => same(record.result[field], context.request[field]));
        }
        const request = context?.request ?? attempts.get(attempt.attempt_id)?.request;
        const observed = request ? evidenceFor(request) : JSON.parse(fileHash(path.join(resourcesRoot, `native-termination-${hash(attempt.attempt_id)}.json`)).bytes.toString("utf8"));
        return request && observed.request_sha256 === fingerprint(request) && observed.attempt_id === attempt.attempt_id && observed.process.termination_state === "confirmed" && same(observed.process.termination_proof, proof)
          && proof.active_processes === 0 && proof.candidate_sha256 === frozen.candidate.sha256 && proof.helper_sha256 === frozen.helper.helper_sha256
          && proof.source_sha256 === frozen.helper.source_sha256 && observed.process.runner?.executable_sha256 === frozen.runtime.sha256
          && context?.runner?.runner_id === proof.runner_id && context.runner.pid === proof.pid && context.runner.started_at === new Date(proof.started_at).toISOString();
      } catch { return false; }
    },
    async close() { closed = true; for (const state of attempts.values()) if (state.execution) await state.execution.close(); },
  };
  return Object.freeze(service);
}

// All native Git children use the same independently qualified Job controller.
// A controller refusal/unknown result is returned without a spawn fallback.
export function createControlledGitProcess({ controller, gitExecutable, gitSha256 } = {}) {
  requireProof(typeof controller?.run === "function" && path.isAbsolute(gitExecutable ?? "") && digest(gitSha256), "AGENT_GIT_CONTROLLED_PROCESS_REQUIRED");
  return async (request, { signal, onEvent } = {}) => {
    requireProof(request.executable === gitExecutable && fileHash(gitExecutable, 128 * 1024 * 1024).sha256 === gitSha256, "AGENT_GIT_EXECUTABLE_CHANGED");
    return controller.run({ runnerId: request.operation_id ?? randomUUID(), executable: gitExecutable, executableSha256: gitSha256,
      args: request.args, cwd: request.cwd, env: request.env, stdin: request.stdin, maxDurationMs: request.maxDurationMs,
      maxOutputBytes: request.maxOutputBytes, maxPendingBytes: 1024 * 1024, stopTimeoutMs: 5000 }, { signal, onEvent });
  };
}
