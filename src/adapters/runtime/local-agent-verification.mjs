import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createPublicKey, createPrivateKey, randomUUID, sign, verify } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assertAgentExecutionContract, fingerprintAgentExecutionValue as fingerprint, isExactExecutionPath, taskValidationIds } from "../../core/agents/agent-execution-contracts.mjs";

const VERSION = "agent-verification-evidence.v1";
const VERIFIER = Object.freeze({ verifier_id: "local-agent-verification", contract_version: "agent-evidence-verification.v1", algorithm: "Ed25519" });
const MAX_DOCUMENT = 8 * 1024 * 1024;
const digest = value => createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const bytes = value => { fingerprint(value); return Buffer.from(canonical(value)); };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireThat = (condition, code) => { if (!condition) fail(code); };
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const same = (left, right) => fingerprint(left) === fingerprint(right);
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const refs = values => [...new Map(values.map(value => [canonical(value), clone(value)])).values()].sort((a, b) => ordinal(a.ref, b.ref));
// A check emits one JSON document with exactly these three keys. An exit code
// never supplies its verdict; the supervisor binds it to the observed Git SHA.
function verdict(protocol, processResult, validationId) {
  const valid = exactKeys(protocol, ["contract_version", "validation_id", "status"])
    && protocol.contract_version === "agent-verification-check.v1" && protocol.validation_id === validationId
    && ["passed", "failed", "unavailable"].includes(protocol.status);
  return !valid ? "unavailable" : processResult.exit_code === 0 && processResult.signal === null ? protocol.status : "failed";
}

function publicMaterial(value) {
  if (!value) fail("VERIFICATION_PUBLIC_KEY_MISSING");
  const key = value.type === "public" ? value : createPublicKey(Buffer.isBuffer(value) ? { key: value, format: "der", type: "spki" } : value);
  requireThat(key.asymmetricKeyType === "ed25519", "VERIFICATION_KEY_ALGORITHM");
  return { key, pin: digest(key.export({ format: "der", type: "spki" })) };
}
function openSigned(envelope, authority) {
  requireThat(exactKeys(envelope, ["payload", "signature"]) && typeof envelope.signature === "string"
    && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature), "VERIFICATION_SIGNATURE_INVALID");
  requireThat(verify(null, bytes(envelope.payload), authority.key, Buffer.from(envelope.signature, "base64")), "VERIFICATION_SIGNATURE_INVALID");
  return envelope.payload;
}
async function physical(target) {
  requireThat(path.isAbsolute(target), "VERIFICATION_ABSOLUTE_PATH_REQUIRED");
  let cursor = path.resolve(target);
  for (;;) {
    const stat = await fs.lstat(cursor);
    requireThat(!stat.isSymbolicLink(), "VERIFICATION_LINK_REFUSED");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const actual = await fs.realpath(target);
  requireThat((process.platform === "win32" ? actual.toLowerCase() : actual) === (process.platform === "win32" ? path.resolve(target).toLowerCase() : path.resolve(target)), "VERIFICATION_PHYSICAL_PATH_CHANGED");
  return actual;
}
async function readFileBounded(target, limit, { signal, retain = true } = {}) {
  requireThat(!signal?.aborted, "VERIFICATION_INTERRUPTED");
  await physical(target);
  const stat = await fs.lstat(target);
  requireThat(stat.isFile() && stat.nlink === 1 && stat.size <= limit, "VERIFICATION_FILE_INVALID");
  const file = await fs.open(target, "r"), hasher = createHash("sha256"), chunks = []; let count = 0;
  try {
    const opened = await file.stat(); requireThat(opened.dev === stat.dev && opened.ino === stat.ino, "VERIFICATION_FILE_CHANGED");
    for (;;) {
      requireThat(!signal?.aborted, "VERIFICATION_INTERRUPTED");
      const buffer = Buffer.alloc(Math.min(65536, limit - count + 1));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      count += bytesRead; requireThat(count <= limit, "VERIFICATION_EVIDENCE_LIMIT");
      const chunk = buffer.subarray(0, bytesRead); hasher.update(chunk); if (retain) chunks.push(chunk);
    }
    const after = await file.stat();
    requireThat(count === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs, "VERIFICATION_FILE_CHANGED");
    await physical(target);
    const final = await fs.lstat(target);
    requireThat(final.dev === stat.dev && final.ino === stat.ino && !final.isSymbolicLink(), "VERIFICATION_FILE_CHANGED");
    return { sha256: hasher.digest("hex"), bytes: count, ...(retain ? { content: Buffer.concat(chunks, count) } : {}) };
  } finally { await file.close(); }
}
const fileDigest = (target, limit = 256 * 1024 * 1024, signal) => readFileBounded(target, limit, { signal, retain: false });
async function readReference(root, reference, limit = MAX_DOCUMENT, signal) {
  requireThat(exactKeys(reference, ["ref", "sha256", "bytes"]) && isExactExecutionPath(reference.ref)
    && /^[a-f0-9]{64}$/.test(reference.sha256) && Number.isSafeInteger(reference.bytes)
    && reference.bytes >= 0 && reference.bytes <= limit, "VERIFICATION_EVIDENCE_REF_INVALID");
  await physical(root);
  const target = path.join(root, ...reference.ref.split("/"));
  const observed = await readFileBounded(target, limit, { signal });
  requireThat(observed.sha256 === reference.sha256 && observed.bytes === reference.bytes, "VERIFICATION_EVIDENCE_CHANGED");
  return observed.content;
}
async function writeReference(root, ref, content, signal) {
  requireThat(!signal?.aborted, "VERIFICATION_INTERRUPTED");
  requireThat(isExactExecutionPath(ref), "VERIFICATION_EVIDENCE_REF_INVALID");
  await physical(root);
  const target = path.join(root, ...ref.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true }); await physical(path.dirname(target));
  requireThat(!signal?.aborted, "VERIFICATION_INTERRUPTED");
  try { await fs.writeFile(target, content, { flag: "wx", mode: 0o600, signal }); }
  catch (cause) { if (cause.code !== "EEXIST") throw cause; requireThat((await readFileBounded(target, content.length, { signal })).content.equals(content), "VERIFICATION_EVIDENCE_CONFLICT"); }
  const reference = { ref, sha256: digest(content), bytes: content.length };
  await readReference(root, reference, Math.max(content.length, MAX_DOCUMENT), signal); return reference;
}
async function bounded(operation, duration, signal, code = "VERIFICATION_INTERRUPTED") {
  requireThat(Number.isFinite(duration) && duration > 0 && !signal?.aborted, code);
  let timer, onAbort; const began = performance.now();
  try {
    const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      const stop = () => reject(Object.assign(new Error(code), { code }));
      timer = setTimeout(stop, Math.min(duration, 2147483647)); onAbort = stop;
      signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) stop();
    })]);
    requireThat(performance.now() - began < duration, code); return result;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}
function policyFor(plan, authority) {
  assertAgentExecutionContract("plan", plan);
  requireThat(plan.verification && plan.verification.proof_authority_sha256 === authority.pin, "VERIFICATION_AUTHORITY_UNAVAILABLE");
  return plan.verification;
}
function environmentFor(value) {
  requireThat(value && typeof value === "object" && !Array.isArray(value), "VERIFICATION_ENVIRONMENT_INVALID");
  const seen = new Set(), allowed = new Set(["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ", "NO_COLOR"]);
  for (const [name, entry] of Object.entries(value)) {
    const key = name.toUpperCase();
    requireThat(allowed.has(key) && !seen.has(key) && typeof entry === "string" && entry.length <= 8192 && !entry.includes("\0"), "VERIFICATION_ENVIRONMENT_INVALID");
    seen.add(key);
  }
  return clone(value);
}
function checkObservation(content, expected) {
  const value = JSON.parse(content);
  requireThat(value.contract_version === "agent-verification-observation.v1" && value.observation_id === expected.observation_id
    && value.challenge === expected.challenge && value.phase === expected.phase && value.snapshot_sha256 === expected.snapshot_sha256
    && value.candidate_sha === expected.snapshot.candidate_sha && value.head_sha === expected.snapshot.candidate_sha
    && value.tree_sha === expected.snapshot.tree_sha && value.repository_identity_sha256 === expected.snapshot.repository_identity_sha256
    && value.cwd === expected.snapshot.cwd && value.baseline_sha256 === expected.snapshot.baseline_sha256
    && value.detached === true && value.pristine === true && Array.isArray(value.control_files)
    && value.control_files.every(item => item.tree_git_mode === item.git_mode)
    && same(value.control_files.map(({ path, sha256, git_mode }) => ({ path, sha256, git_mode })), expected.control_files)
    && ["files", "directories", "controls"].every(key => Array.isArray(value.changes?.[key]) && value.changes[key].length === 0), "VERIFICATION_SNAPSHOT_DRIFT");
  return value;
}
function auditChecks(plan, policy, facts, gitFacts) {
  requireThat(exactKeys(policy, ["contract_version", "criteria"]) && policy.contract_version === "agent-verification-audit-policy.v1"
    && Array.isArray(policy.criteria) && policy.criteria.length <= 128, "VERIFICATION_AUDIT_POLICY_INVALID");
  return plan.audit.criteria.map((criterion, index) => {
    const criterionHash = digest(Buffer.from(criterion));
    const entries = policy.criteria.filter(item => item.criterion_index === index && item.criterion_sha256 === criterionHash);
    let status = "unavailable", checkId = null;
    if (entries.length === 1 && exactKeys(entries[0], ["criterion_index", "criterion_sha256", "check_id", "parameters"]) && exactKeys(entries[0].parameters, [])) {
      checkId = entries[0].check_id;
      if (["exact-snapshot", "controls-unchanged"].includes(checkId)) status = "passed";
      if (checkId === "all-tasks-integrated" && Array.isArray(facts?.acceptances) && Array.isArray(facts?.integrations)) {
        status = plan.tasks.every(task => facts.acceptances.some(row => row.task_id === task.task_id && row.decision === "accepted")
          && facts.integrations.some(row => row.task_id === task.task_id && row.applied === true)) ? "passed" : "failed";
      }
      if (checkId === "no-uncertain-work" && Array.isArray(facts?.attempts) && Array.isArray(facts?.integrations)
        && Array.isArray(facts?.integration_intents) && Array.isArray(gitFacts?.operations)
        && (gitFacts.uncertain_read === null || gitFacts.uncertain_read && typeof gitFacts.uncertain_read === "object")) {
        status = facts.attempts.every(view => view.result && view.result.outcome !== "indeterminate" && ["confirmed", "not_started"].includes(view.result.termination_state))
          && facts.integrations.every(row => row.applied === true) && facts.integration_intents.every(row => row.status === "applied")
          && !gitFacts.uncertain_read && gitFacts.operations.every(row => row.recovery_required === false) ? "passed" : "failed";
      }
    }
    return { criterion_index: index, criterion_sha256: criterionHash, check_id: checkId, status };
  });
}
function checkCanonicalFacts(facts, binding) {
  requireThat(facts.run_id === binding.run_id && facts.plan_sha256 === binding.plan_sha256
    && facts.integration_head.sha === binding.tested_sha && facts.integration_head.sequence === binding.integration_sequence
    && Number.isFinite(Date.parse(facts.server_now)) && Number.isFinite(Date.parse(facts.started_at)) && Number.isFinite(Date.parse(facts.finished_at))
    && Date.parse(facts.server_now) >= Date.parse(facts.started_at) - 5000 && Date.parse(facts.server_now) <= Date.parse(facts.finished_at) + 5000,
  "VERIFICATION_CANONICAL_MISMATCH");
}
function canonicalFacts(observed, binding, startedAt) {
  requireThat(observed?.run?.run_id === binding.run_id && observed.run.plan_sha256 === binding.plan_sha256
    && observed.integration_head?.sha === binding.tested_sha && observed.integration_head.sequence === binding.integration_sequence,
  "VERIFICATION_CANONICAL_MISMATCH");
  requireThat(Number.isFinite(Date.parse(observed.server_now)), "VERIFICATION_CANONICAL_MISMATCH");
  const facts = { run_id: binding.run_id, plan_sha256: binding.plan_sha256, server_now: new Date(observed.server_now).toISOString(),
    integration_head: observed.integration_head, started_at: startedAt, finished_at: new Date().toISOString(),
    acceptances: Array.isArray(observed.acceptances) ? observed.acceptances.map(row => ({ task_id: row.acceptance.task_id, decision: row.acceptance.decision })) : null,
    integrations: Array.isArray(observed.integrations) ? observed.integrations.map(row => ({ task_id: row.prepared.task_id, applied: Boolean(row.applied) })) : null,
    integration_intents: Array.isArray(observed.integration_intents) ? observed.integration_intents.map(row => ({ integration_id: row.intent.integration_id, status: row.status })) : null,
    attempts: Array.isArray(observed.attempts) ? observed.attempts.map(view => ({ attempt_id: view.attempt.attempt_id, result: view.result && {
      outcome: view.result.outcome, termination_state: view.result.termination_state } })) : null };
  checkCanonicalFacts(facts, binding); return facts;
}
function gitFacts(observed) {
  return Array.isArray(observed?.operations) && Object.hasOwn(observed, "uncertain_read")
    && (observed.uncertain_read === null || observed.uncertain_read && typeof observed.uncertain_read === "object")
    ? { uncertain_read: clone(observed.uncertain_read), operations: observed.operations.map(row => ({ operation_id: row.operation_id,
      intent_sha256: row.intent_sha256, recovery_required: row.recovery_required })) } : null;
}
const materialFacts = ({ server_now, started_at, finished_at, ...value }) => value;

// No process, probe, key generation or filesystem mutation occurs at construction.
// The caller supplies a pinned trust root and a separately qualified boundary.
export function createLocalAgentVerification({ resourcesRoot, scratchRoot, runId, git, runner, environment, auditPolicy,
  publicKey, privateKey, boundary = null, readRun = null, evidenceClass = "native" } = {}) {
  requireThat(typeof runId === "string" && path.isAbsolute(resourcesRoot ?? "") && path.isAbsolute(scratchRoot ?? "")
    && path.relative(resourcesRoot, scratchRoot) && !path.relative(resourcesRoot, scratchRoot).startsWith("..")
    && !path.isAbsolute(path.relative(resourcesRoot, scratchRoot)) && ["native", "fixture"].includes(evidenceClass), "VERIFICATION_CONFIGURATION_INVALID");
  requireThat(typeof git?.prepareVerificationSnapshot === "function" && typeof git?.inspectVerificationSnapshot === "function", "VERIFICATION_SNAPSHOT_PORT_REQUIRED");
  const configuration = { runner: clone(runner), environment: clone(environment), auditPolicy: clone(auditPolicy) };
  const verifier = createAgentValidationEvidenceVerifier({ resourcesRoot, publicKey, evidenceClass });
  async function material(plan, execution, signal) {
    const authority = publicMaterial(publicKey), policy = policyFor(plan, authority);
    requireThat(privateKey, "VERIFICATION_PRIVATE_KEY_MISSING");
    const secret = privateKey.type === "private" ? privateKey : createPrivateKey(privateKey);
    requireThat(secret.asymmetricKeyType === "ed25519" && publicMaterial(createPublicKey(secret)).pin === authority.pin, "VERIFICATION_PRIVATE_KEY_CHANGED");
    const configured = configuration.runner, env = environmentFor(configuration.environment);
    await physical(scratchRoot);
    for (const [name, value] of Object.entries(env)) if (["TEMP", "TMP", "TMPDIR"].includes(name.toUpperCase())) requireThat(path.resolve(value) === path.resolve(scratchRoot), "VERIFICATION_SCRATCH_INVALID");
    requireThat(configured?.id === policy.runner.id && path.isAbsolute(configured.executable ?? ""), "VERIFICATION_RUNNER_MISMATCH");
    const executable = await fileDigest(configured.executable, undefined, signal);
    requireThat(executable.sha256 === policy.runner.executable_sha256 && fingerprint(env) === policy.environment_sha256
      && fingerprint(configuration.auditPolicy) === policy.audit_policy_sha256, "VERIFICATION_MATERIAL_CHANGED");
    let qualification = null;
    if (execution) {
      requireThat(typeof boundary?.getDescriptor === "function" && typeof boundary?.run === "function" && typeof boundary?.requestStop === "function", "VERIFICATION_BOUNDARY_UNAVAILABLE");
      const descriptor = clone(boundary.getDescriptor()); qualification = openSigned(descriptor.qualification, authority);
      requireThat(qualification.contract_version === "agent-verification-boundary.v1" && qualification.boundary_id === descriptor.boundary_id
        && qualification.platform === process.platform && qualification.evidence_class === evidenceClass
        && qualification.engine_sha256 === plan.execution.engine.sha256
        && qualification.policy_sha256 === fingerprint(policy) && qualification.executable_sha256 === executable.sha256
        && qualification.environment_sha256 === policy.environment_sha256 && qualification.snapshot_read_only === true && qualification.network_disabled === true
        && qualification.supervisor_resources_inaccessible === true && qualification.descendant_termination === true, "VERIFICATION_BOUNDARY_UNAVAILABLE");
      requireThat(Array.isArray(qualification.evidence) && qualification.evidence.length > 0, "VERIFICATION_BOUNDARY_UNAVAILABLE");
      for (const proof of qualification.evidence) await readReference(resourcesRoot, proof, MAX_DOCUMENT, signal);
    }
    return { authority, secret, policy, env, executable: configured.executable, qualification };
  }
  async function availability({ plan, signal } = {}) {
    try { await material(plan, true, signal); return { status: "available", evidence_class: evidenceClass, native: evidenceClass === "native" }; }
    catch (cause) { return { status: "unavailable", reason_code: cause.code ?? "VERIFICATION_CONFIGURATION_INVALID", native: false }; }
  }
  async function execute(phase, input) {
    const began = performance.now();
    const authority = publicMaterial(publicKey), policy = policyFor(input.plan, authority);
    const remaining = () => policy.limits.max_duration_ms - (performance.now() - began);
    const stop = new AbortController(), abort = () => stop.abort(input.signal?.reason);
    const timer = setTimeout(() => stop.abort(new Error("VERIFICATION_INTERRUPTED")), Math.min(Math.max(1, remaining()), 2147483647));
    input.signal?.addEventListener("abort", abort, { once: true }); if (input.signal?.aborted) abort();
    // Synchronous injected callbacks cannot be interrupted by a timer. Every
    // phase is checked afterwards; a late callback can never publish a PASS.
    const checkpoint = () => requireThat(remaining() > 0 && !stop.signal.aborted, "VERIFICATION_INTERRUPTED");
    try { checkpoint(); return await executeWithinBudget(phase, { ...input, signal: stop.signal }, { stop, remaining, checkpoint }); }
    finally { clearTimeout(timer); input.signal?.removeEventListener("abort", abort); }
  }
  async function executeWithinBudget(phase, input, { stop, remaining, checkpoint }) {
    requireThat(!input.signal?.aborted, "VERIFICATION_INTERRUPTED");
    const plan = clone(input.plan), authority = publicMaterial(publicKey), policy = policyFor(plan, authority);
    requireThat(input.runId === runId, "VERIFICATION_RUN_MISMATCH");
    const task = input.task, sha = phase === "task" ? input.candidateSha : input.integratedSha;
    if (phase === "task") requireThat(plan.tasks.some(candidate => same(candidate, task)), "VERIFICATION_TASK_MISMATCH");
    const ids = phase === "task" ? taskValidationIds(plan, task) : phase === "run" ? plan.validations.map(item => item.validation_id) : [];
    if (phase === "task") requireThat(same(ids, input.validationIds), "VERIFICATION_CHECK_SET_MISMATCH");
    const bindings = { phase, run_id: runId, plan_sha256: plan.plan_sha256, policy_sha256: fingerprint(policy), tested_sha: sha,
      task_id: phase === "task" ? task.task_id : null, attempt_id: phase === "task" ? input.binding.attempt_id : null,
      input_sha: phase === "task" ? input.binding.input_sha : null, result_sha256: phase === "task" ? input.resultSha256 : null,
      integration_sequence: phase === "task" ? null : input.integrationSequence, validation_ids: ids };
    fingerprint(bindings);
    const operationId = fingerprint(bindings), resultRef = `verification/results/${operationId}.json`, intentRef = `verification/intents/${operationId}.json`;
    const materials = await bounded(() => material(plan, phase !== "audit", input.signal), remaining(), input.signal);
    checkpoint();
    const prior = path.join(resourcesRoot, ...resultRef.split("/"));
    try {
      const { content } = await bounded(() => readFileBounded(prior, MAX_DOCUMENT, { signal: input.signal }), remaining(), input.signal);
      const payload = await bounded(() => verifyPayload(JSON.parse(content), authority, resourcesRoot, plan, evidenceClass, input.signal), remaining(), input.signal);
      requireThat(same(payload.bindings, bindings), "VERIFICATION_REPLAY_MISMATCH");
      if (phase === "audit" && configuration.auditPolicy.criteria.some(item => ["all-tasks-integrated", "no-uncertain-work"].includes(item.check_id))) {
        requireThat(typeof readRun === "function" && payload.canonical_observation, "VERIFICATION_REPLAY_FACTS_UNAVAILABLE");
        const started = new Date().toISOString(), current = canonicalFacts(await bounded(() => readRun({ runId, signal: input.signal }), remaining(), input.signal), bindings, started);
        const previous = JSON.parse(await readReference(resourcesRoot, payload.canonical_observation, MAX_DOCUMENT, input.signal));
        requireThat(same(materialFacts(current), materialFacts(previous)), "VERIFICATION_REPLAY_FACTS_CHANGED");
        if (configuration.auditPolicy.criteria.some(item => item.check_id === "no-uncertain-work")) {
          requireThat(typeof git.inspectGitOperations === "function" && payload.git_observation, "VERIFICATION_REPLAY_FACTS_UNAVAILABLE");
          const currentGit = gitFacts(await bounded(() => git.inspectGitOperations(), remaining(), input.signal));
          const previousGit = JSON.parse(await readReference(resourcesRoot, payload.git_observation, MAX_DOCUMENT, input.signal));
          requireThat(currentGit && same(currentGit, previousGit), "VERIFICATION_REPLAY_FACTS_CHANGED");
        }
      }
      checkpoint(); return project(payload, { ref: resultRef, sha256: digest(content), bytes: content.length });
    } catch (cause) { if (cause.code !== "ENOENT") throw cause; }
    await physical(resourcesRoot);
    await fs.mkdir(path.join(resourcesRoot, "verification", "intents"), { recursive: true });
    await physical(path.join(resourcesRoot, "verification", "intents"));
    checkpoint();
    try { await fs.writeFile(path.join(resourcesRoot, ...intentRef.split("/")), bytes({ contract_version: "agent-verification-intent.v1", bindings }), { flag: "wx", mode: 0o600, signal: stop.signal }); }
    catch (cause) { if (cause.code === "EEXIST") fail("VERIFICATION_RECONCILIATION_REQUIRED"); throw cause; }
    try {
      const snapshotIdentity = { run_id: runId, purpose: phase === "task" ? "task" : "run", task_id: bindings.task_id,
        attempt_id: bindings.attempt_id, candidate_sha: sha, policy_sha256: bindings.policy_sha256 };
      const prepared = await bounded(() => git.prepareVerificationSnapshot({ snapshotId: `verification.${fingerprint(snapshotIdentity)}`,
        purpose: snapshotIdentity.purpose, runId, taskId: bindings.task_id, attemptId: bindings.attempt_id,
        candidateSha: sha, validatorManifestSha256: bindings.policy_sha256 }), remaining(), stop.signal);
      requireThat(fingerprint(prepared.snapshot) === prepared.snapshot_sha256 && prepared.snapshot.candidate_sha === sha
        && prepared.snapshot.validator_manifest_sha256 === bindings.policy_sha256, "VERIFICATION_SNAPSHOT_INVALID");
      const observe = async suffix => {
        const expected = { snapshot: prepared.snapshot, snapshot_sha256: prepared.snapshot_sha256,
          observation_id: randomUUID(), challenge: randomUUID(), phase: `${phase}-${suffix}`, control_files: policy.control_files };
        const observed = await bounded(() => git.inspectVerificationSnapshot({ snapshot: prepared.snapshot,
          expectedSnapshotSha256: prepared.snapshot_sha256, observationId: expected.observation_id,
          challenge: expected.challenge, phase: expected.phase, controlFiles: clone(policy.control_files) }), remaining(), stop.signal);
        const content = Buffer.from(observed.content);
        requireThat(content.length <= MAX_DOCUMENT && content.length === observed.bytes && digest(content) === observed.sha256, "VERIFICATION_OBSERVATION_INVALID");
        checkpoint(); checkObservation(content, expected);
        return { expected: { observation_id: expected.observation_id, challenge: expected.challenge, phase: expected.phase },
          evidence: await writeReference(resourcesRoot, `verification/observations/${operationId}-${suffix}.json`, content, stop.signal) };
      };
      const controls = async () => {
        for (const item of policy.control_files) {
          const target = path.join(prepared.snapshot.cwd, ...item.path.split("/")), stat = await fs.lstat(target), actual = await fileDigest(target, undefined, stop.signal);
          requireThat(actual.sha256 === item.sha256 && stat.isFile() && !stat.isSymbolicLink(), "VERIFICATION_CONTROL_CHANGED");
          if (process.platform !== "win32") requireThat(((stat.mode & 0o111) ? "100755" : "100644") === item.git_mode, "VERIFICATION_CONTROL_CHANGED");
        }
      };
      await controls(); const before = await observe("before");
      const checks = [], outputRefs = []; let outputBytes = 0, canonicalObservation = null, gitObservation = null;
      const auditPolicyReference = await writeReference(resourcesRoot, `verification/policies/${policy.audit_policy_sha256}.json`, bytes(configuration.auditPolicy), stop.signal);
      if (phase === "audit") {
        const configured = configuration.auditPolicy;
        auditChecks(plan, configured, null, null);
        let facts = null, observedGitFacts = null;
        if (configured.criteria.some(item => ["all-tasks-integrated", "no-uncertain-work"].includes(item.check_id)) && typeof readRun === "function") {
          const started_at = new Date().toISOString();
          facts = canonicalFacts(await bounded(() => readRun({ runId, signal: stop.signal }), remaining(), stop.signal), bindings, started_at);
          canonicalObservation = await writeReference(resourcesRoot, `verification/observations/${operationId}-canonical.json`, bytes(facts), stop.signal);
        }
        if (configured.criteria.some(item => item.check_id === "no-uncertain-work") && typeof git.inspectGitOperations === "function") {
          observedGitFacts = gitFacts(await bounded(() => git.inspectGitOperations(), remaining(), stop.signal));
          if (observedGitFacts) {
            gitObservation = await writeReference(resourcesRoot, `verification/observations/${operationId}-git.json`, bytes(observedGitFacts), stop.signal);
          }
        }
        checks.push(...auditChecks(plan, configured, facts, observedGitFacts));
      } else for (const validationId of ids) {
        const definition = plan.validations.find(item => item.validation_id === validationId);
        requireThat(definition.argv[0] === policy.runner.id, "VERIFICATION_RUNNER_MISMATCH");
        await bounded(() => material(plan, true, stop.signal), remaining(), stop.signal); await controls(); checkpoint();
        const invocation = { invocation_id: randomUUID(), boundary_id: materials.qualification.boundary_id, validation_id: validationId,
          executable: materials.executable, executable_sha256: policy.runner.executable_sha256, argv: definition.argv.slice(1), cwd: prepared.snapshot.cwd,
          environment_sha256: policy.environment_sha256, max_duration_ms: Math.max(1, Math.floor(remaining())), max_output_bytes: policy.limits.max_output_bytes - outputBytes };
        const requestHash = fingerprint(invocation);
        let result;
        try {
          result = await bounded(() => boundary.run({ ...clone(invocation), request_sha256: requestHash, environment: clone(materials.env) }, { signal: stop.signal }), remaining(), stop.signal);
          requireThat(result?.invocation_id === invocation.invocation_id && result.request_sha256 === requestHash
            && result.boundary_id === invocation.boundary_id && result.termination_state === "confirmed", "VERIFICATION_STOP_UNCONFIRMED");
        }
        catch (cause) {
          stop.abort(cause);
          try { result = await bounded(() => boundary.requestStop({ invocationId: invocation.invocation_id, requestSha256: requestHash }), 1000, null); }
          catch { fail("VERIFICATION_STOP_UNCONFIRMED"); }
          requireThat(result?.termination_state === "confirmed" && result.invocation_id === invocation.invocation_id
            && result.request_sha256 === requestHash && result.boundary_id === invocation.boundary_id, "VERIFICATION_STOP_UNCONFIRMED");
          throw cause;
        }
        const rawStdout = result.stdout ?? "", rawStderr = result.stderr ?? "";
        requireThat([rawStdout, rawStderr].every(value => typeof value === "string" || Buffer.isBuffer(value)), "VERIFICATION_OUTPUT_INVALID");
        const receivedBytes = Buffer.byteLength(rawStdout) + Buffer.byteLength(rawStderr);
        requireThat(receivedBytes <= policy.limits.max_output_bytes - outputBytes, "VERIFICATION_OUTPUT_LIMIT");
        const stdout = Buffer.from(rawStdout), stderr = Buffer.from(rawStderr); outputBytes += receivedBytes;
        requireThat(outputBytes <= policy.limits.max_output_bytes, "VERIFICATION_OUTPUT_LIMIT");
        const stdoutRef = await writeReference(resourcesRoot, `verification/logs/${invocation.invocation_id}.stdout`, stdout, stop.signal);
        const stderrRef = await writeReference(resourcesRoot, `verification/logs/${invocation.invocation_id}.stderr`, stderr, stop.signal);
        outputRefs.push(stdoutRef, stderrRef);
        let protocol = null; try { protocol = JSON.parse(stdout.toString("utf8")); } catch { /* a successful exit alone never supplies a verdict */ }
        const status = verdict(protocol, result, validationId);
        checks.push({ validation_id: validationId, status, invocation, request_sha256: requestHash,
          process: { exit_code: result.exit_code, signal: result.signal, termination_state: result.termination_state }, stdout: stdoutRef, stderr: stderrRef });
      }
      await bounded(() => material(plan, phase !== "audit", stop.signal), remaining(), stop.signal); await controls(); const after = await observe("after");
      const payload = { contract_version: VERSION, evidence_class: evidenceClass, bindings, snapshot: prepared,
        before, after, checks, canonical_observation: canonicalObservation, git_observation: gitObservation, audit_policy: auditPolicyReference,
        boundary_qualification: phase === "audit" ? null : clone(boundary.getDescriptor().qualification), output_refs: outputRefs };
      checkpoint();
      const envelope = { payload, signature: sign(null, bytes(payload), materials.secret).toString("base64") };
      await bounded(() => verifyPayload(envelope, authority, resourcesRoot, plan, evidenceClass, stop.signal), remaining(), stop.signal);
      const content = bytes(envelope); requireThat(content.length <= MAX_DOCUMENT, "VERIFICATION_EVIDENCE_LIMIT");
      checkpoint(); const proof = await writeReference(resourcesRoot, resultRef, content, stop.signal); checkpoint(); return project(payload, proof);
    } catch (cause) { stop.abort(cause); throw cause; }
  }
  return Object.freeze({ getDescriptor: () => ({ verifier_id: VERIFIER.verifier_id, evidence_class: evidenceClass, native_qualification: "external_required" }),
    checkAvailability: availability, validateTask: input => execute("task", input), validateRun: input => execute("run", input),
    auditRun: input => execute("audit", input), evidenceVerifier: verifier });
}

function project(payload, evidence) {
  const phase = payload.bindings.phase, tested_sha = payload.bindings.tested_sha;
  const checks = payload.checks.map(check => phase === "audit" ? { criterion_index: check.criterion_index, status: check.status, evidence }
    : { validation_id: check.validation_id, status: check.status, tested_sha, evidence });
  if (phase === "audit") return { read_only: true, tested_sha, checks };
  if (phase === "run") return checks;
  return { status: checks.some(check => check.status === "failed") ? "failed" : checks.some(check => check.status !== "passed") ? "unavailable" : "passed", tested_sha, checks };
}
async function verifyPayload(envelope, authority, root, plan, evidenceClass, signal) {
  const payload = openSigned(envelope, authority), policy = policyFor(plan, authority), binding = payload.bindings;
  requireThat(payload.contract_version === VERSION && payload.evidence_class === evidenceClass
    && binding.plan_sha256 === plan.plan_sha256 && binding.policy_sha256 === fingerprint(policy)
    && ["task", "run", "audit"].includes(binding.phase), "VERIFICATION_BINDING_INVALID");
  const prepared = payload.snapshot;
  requireThat(fingerprint(prepared.snapshot) === prepared.snapshot_sha256 && prepared.snapshot.run_id === binding.run_id
    && prepared.snapshot.candidate_sha === binding.tested_sha && prepared.snapshot.validator_manifest_sha256 === binding.policy_sha256
    && prepared.snapshot.purpose === (binding.phase === "task" ? "task" : "run")
    && prepared.snapshot.task_id === binding.task_id && prepared.snapshot.attempt_id === binding.attempt_id, "VERIFICATION_SNAPSHOT_INVALID");
  for (const reference of prepared.evidence) await readReference(root, reference, MAX_DOCUMENT, signal);
  for (const suffix of ["before", "after"]) {
    const observation = payload[suffix];
    requireThat(observation.expected.phase === `${binding.phase}-${suffix}`, "VERIFICATION_OBSERVATION_INVALID");
    checkObservation(await readReference(root, observation.evidence, MAX_DOCUMENT, signal), { ...observation.expected, snapshot: prepared.snapshot,
      snapshot_sha256: prepared.snapshot_sha256, control_files: policy.control_files });
  }
  requireThat(payload.before.expected.challenge !== payload.after.expected.challenge
    && payload.before.expected.observation_id !== payload.after.expected.observation_id, "VERIFICATION_OBSERVATION_REPLAY");
  let total = 0;
  const auditPolicy = JSON.parse(await readReference(root, payload.audit_policy, MAX_DOCUMENT, signal));
  requireThat(fingerprint(auditPolicy) === policy.audit_policy_sha256, "VERIFICATION_AUDIT_POLICY_INVALID");
  const facts = payload.canonical_observation ? JSON.parse(await readReference(root, payload.canonical_observation, MAX_DOCUMENT, signal)) : null;
  const gitFacts = payload.git_observation ? JSON.parse(await readReference(root, payload.git_observation, MAX_DOCUMENT, signal)) : null;
  if (facts) checkCanonicalFacts(facts, binding);
  for (const reference of payload.output_refs) { total += reference.bytes; requireThat(total <= policy.limits.max_output_bytes, "VERIFICATION_OUTPUT_LIMIT"); await readReference(root, reference, policy.limits.max_output_bytes, signal); }
  if (binding.phase !== "audit") {
    const qualification = openSigned(payload.boundary_qualification, authority);
    requireThat(qualification.contract_version === "agent-verification-boundary.v1" && qualification.evidence_class === evidenceClass
      && qualification.platform === process.platform && qualification.policy_sha256 === binding.policy_sha256 && qualification.executable_sha256 === policy.runner.executable_sha256
      && qualification.engine_sha256 === plan.execution.engine.sha256
      && qualification.environment_sha256 === policy.environment_sha256 && qualification.snapshot_read_only === true && qualification.network_disabled === true
      && qualification.supervisor_resources_inaccessible === true && qualification.descendant_termination === true, "VERIFICATION_BOUNDARY_UNAVAILABLE");
    requireThat(Array.isArray(qualification.evidence) && qualification.evidence.length > 0, "VERIFICATION_BOUNDARY_UNAVAILABLE");
    for (const reference of qualification.evidence) await readReference(root, reference, MAX_DOCUMENT, signal);
    requireThat(same(payload.checks.map(check => check.validation_id), binding.validation_ids), "VERIFICATION_CHECK_SET_MISMATCH");
    requireThat(same(payload.output_refs, payload.checks.flatMap(check => [check.stdout, check.stderr])), "VERIFICATION_OUTPUT_SET_MISMATCH");
    for (const check of payload.checks) {
      const definition = plan.validations.find(item => item.validation_id === check.validation_id), invocation = check.invocation;
      requireThat(definition && definition.argv[0] === policy.runner.id && same(invocation.argv, definition.argv.slice(1))
        && invocation.cwd === prepared.snapshot.cwd && invocation.executable_sha256 === policy.runner.executable_sha256
        && invocation.environment_sha256 === policy.environment_sha256 && invocation.boundary_id === qualification.boundary_id
        && Number.isSafeInteger(invocation.max_duration_ms) && invocation.max_duration_ms > 0 && invocation.max_duration_ms <= policy.limits.max_duration_ms
        && Number.isSafeInteger(invocation.max_output_bytes) && invocation.max_output_bytes > 0 && invocation.max_output_bytes <= policy.limits.max_output_bytes
        && check.request_sha256 === fingerprint(invocation) && check.process.termination_state === "confirmed"
        && (check.process.exit_code === null || Number.isSafeInteger(check.process.exit_code))
        && (check.process.signal === null || typeof check.process.signal === "string")
        && ["passed", "failed", "unavailable"].includes(check.status), "VERIFICATION_INVOCATION_INVALID");
      let protocol = null; try { protocol = JSON.parse(await readReference(root, check.stdout, policy.limits.max_output_bytes, signal)); } catch (cause) { if (cause.code) throw cause; }
      await readReference(root, check.stderr, policy.limits.max_output_bytes, signal);
      requireThat(check.status === verdict(protocol, check.process, check.validation_id), "VERIFICATION_VERDICT_INVALID");
    }
  } else requireThat(payload.boundary_qualification === null && same(payload.output_refs, []) && same(binding.validation_ids, [])
    && same(payload.checks, auditChecks(plan, auditPolicy, facts, gitFacts)), "VERIFICATION_AUDIT_INVALID");
  return payload;
}

export function createAgentValidationEvidenceVerifier({ resourcesRoot, publicKey, evidenceClass = "native" } = {}) {
  requireThat(path.isAbsolute(resourcesRoot ?? "") && ["native", "fixture"].includes(evidenceClass), "VERIFICATION_CONFIGURATION_INVALID");
  return Object.freeze({ getDescriptor: () => ({ ...VERIFIER }), async verify(input, { signal } = {}) {
    input = clone(input); const authority = publicMaterial(publicKey), policy = policyFor(input.plan, authority);
    requireThat(input.subject_sha256 === fingerprint(input.document), "VERIFICATION_SUBJECT_MISMATCH");
    const checks = input.phase === "task" ? input.document.validation.checks : [...input.document.checks, ...input.document.audit.checks];
    const references = refs(checks.map(check => check.evidence)), snapshots = [], phases = [];
    for (const reference of references) {
      requireThat(!signal?.aborted, "VERIFICATION_INTERRUPTED");
      const envelope = JSON.parse(await readReference(resourcesRoot, reference, MAX_DOCUMENT, signal)), payload = await verifyPayload(envelope, authority, resourcesRoot, input.plan, evidenceClass, signal);
      const binding = payload.bindings;
      requireThat(binding.run_id === input.run.run_id && binding.tested_sha === input.expected.tested_sha, "VERIFICATION_BINDING_INVALID");
      if (input.phase === "task") requireThat(binding.phase === "task" && binding.task_id === input.task.task_id
        && binding.attempt_id === input.attempt.attempt_id && binding.input_sha === input.attempt.input_sha
        && binding.result_sha256 === fingerprint(input.result) && same(binding.validation_ids, input.expected.validation_ids)
        && same(binding.validation_ids, taskValidationIds(input.plan, input.task)), "VERIFICATION_BINDING_INVALID");
      else requireThat(["run", "audit"].includes(binding.phase) && binding.integration_sequence === input.document.integration_sequence
        && (binding.phase !== "run" || same(binding.validation_ids, input.expected.validation_ids)
          && same(binding.validation_ids, input.plan.validations.map(item => item.validation_id))), "VERIFICATION_BINDING_INVALID");
      const projected = project(payload, reference), actual = binding.phase === "task" ? projected.checks : binding.phase === "run" ? projected : projected.checks;
      const associated = checks.filter(check => same(check.evidence, reference));
      requireThat(same(actual, associated), "VERIFICATION_VERDICT_INVALID");
      phases.push(binding.phase); snapshots.push({ phase: binding.phase, snapshot_sha256: payload.snapshot.snapshot_sha256,
        candidate_sha: binding.tested_sha, tree_sha: payload.snapshot.snapshot.tree_sha, repository_identity_sha256: payload.snapshot.snapshot.repository_identity_sha256,
        before_sha256: payload.before.evidence.sha256, after_sha256: payload.after.evidence.sha256 });
    }
    requireThat(same(phases.sort(), input.phase === "task" ? ["task"] : ["audit", "run"]), "VERIFICATION_PHASE_SET_MISMATCH");
    if (input.phase === "run") requireThat(snapshots.every(value => value.snapshot_sha256 === snapshots[0].snapshot_sha256
      && value.tree_sha === snapshots[0].tree_sha && value.repository_identity_sha256 === snapshots[0].repository_identity_sha256), "VERIFICATION_SNAPSHOT_MISMATCH");
    return { contract_version: VERIFIER.contract_version, verifier_id: VERIFIER.verifier_id,
      phase: input.phase, run_id: input.run.run_id, plan_sha256: input.plan.plan_sha256, policy_sha256: fingerprint(policy),
      subject_sha256: input.subject_sha256, tested_sha: input.expected.tested_sha, proof_authority_sha256: authority.pin,
      verified_refs: references, snapshots: snapshots.sort((a, b) => ordinal(a.phase, b.phase)) };
  } });
}
