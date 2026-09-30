import assert from "node:assert/strict";
import { inspectNativeAttemptStop } from "../../src/application/runtime/agent-run-native-runtime-service.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createCodexAgentAttemptService, loadCodexNativePinnedJson, createControlledGitProcess, createCodexProfileOperationJournal } from "../../src/application/runtime/codex-agent-attempt-service.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-native-composition-fixture-")), nonce = randomUUID(), hash = bytes => createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(path.join(root, "owner"), nonce); let count = 0;
const test = async (name, operation) => { await operation(); count++; process.stdout.write(`PASS ${name}\n`); };
const config = { candidate: { version: "0.0.0", sha256: "a".repeat(64) }, runtime: { sha256: "b".repeat(64) }, helper: { helper_sha256: "c".repeat(64), source_sha256: "d".repeat(64) },
  resourcesRoot: root, preparedManifest: {}, profile: {}, qualificationEvidence: {} };
try {
  await test("service construction has no reads, writes or native probes", async () => {
    const saved = Object.fromEntries(["readFileSync", "writeFileSync", "lstatSync", "statSync", "mkdirSync"].map(name => [name, fs[name]]));
    try { for (const name of Object.keys(saved)) fs[name] = () => { throw new Error("unexpected filesystem effect"); };
      assert.equal(typeof createCodexAgentAttemptService(config).prepareAttempt, "function");
    } finally { Object.assign(fs, saved); }
  });
  await test("missing native prerequisites report unavailable without a fallback", () => {
    const service = createCodexAgentAttemptService(config);
    assert.equal(service.inspectAvailability({ plan: { execution: {} } }).available, false);
  });
  await test("pinned native metadata rejects byte drift and invalid JSON", () => {
    const file = path.join(root, "metadata.json"), bytes = Buffer.from('{"fixture":true}'); fs.writeFileSync(file, bytes);
    assert.deepEqual(loadCodexNativePinnedJson({ path: file, sha256: hash(bytes) }), { fixture: true });
    fs.appendFileSync(file, " "); assert.throws(() => loadCodexNativePinnedJson({ path: file, sha256: hash(bytes) }), /AGENT_NATIVE_EVIDENCE_CHANGED/);
    fs.writeFileSync(file, "not-json"); assert.throws(() => loadCodexNativePinnedJson({ path: file, sha256: hash("not-json") }), /AGENT_NATIVE_EVIDENCE_INVALID/);
  });
  await test("pinned reads bind one descriptor and refuse growth before allocation or during reading", () => {
    const file = path.join(root, "racing-metadata.json"), bytes = Buffer.from('{"fixture":true}');
    fs.writeFileSync(file, bytes); const originalOpen = fs.openSync;
    try {
      fs.openSync = (...args) => { const descriptor = originalOpen(...args); if (args[0] === file) fs.appendFileSync(file, " "); return descriptor; };
      assert.throws(() => loadCodexNativePinnedJson({ path: file, sha256: hash(bytes) }), /AGENT_NATIVE_EVIDENCE_CHANGED/);
    } finally { fs.openSync = originalOpen; }
    fs.writeFileSync(file, bytes); const originalRead = fs.readSync;
    try {
      fs.readSync = (...args) => { const read = originalRead(...args); fs.appendFileSync(file, " "); return read; };
      assert.throws(() => loadCodexNativePinnedJson({ path: file, sha256: hash(bytes) }), /AGENT_NATIVE_EVIDENCE_CHANGED/);
    } finally { fs.readSync = originalRead; }
    fs.writeFileSync(file, bytes); const originalStat = fs.fstatSync;
    try {
      fs.fstatSync = (...args) => { const actual = originalStat(...args), oversized = Object.create(actual); oversized.size = 16 * 1024 * 1024 + 1; return oversized; };
      assert.throws(() => loadCodexNativePinnedJson({ path: file, sha256: hash(bytes) }), /AGENT_NATIVE_EVIDENCE_LIMIT/);
    } finally { fs.fstatSync = originalStat; }
  });
  await test("preparation bytes are immutable, path-bound and recoverable by a fresh service", async () => {
    const service = createCodexAgentAttemptService(config), attemptId = "attempt.fixture", content = Buffer.from(JSON.stringify({ contract_version: "agent-attempt-preparation.v1", attempt_id: attemptId }));
    const proof = await service.persistPreparedAttempt({ attemptId, content, sha256: hash(content), bytes: content.length });
    assert((await createCodexAgentAttemptService(config).loadPreparedAttempt({ attempt: { attempt_id: attemptId }, evidence: proof })).equals(content));
    await assert.rejects(service.loadPreparedAttempt({ attempt: { attempt_id: "foreign" }, evidence: proof }), /AGENT_NATIVE_PREPARATION_EVIDENCE_INVALID/);
    const changed = Buffer.from(JSON.stringify({ contract_version: "agent-attempt-preparation.v1", attempt_id: attemptId, changed: true }));
    await assert.rejects(service.persistPreparedAttempt({ attemptId, content: changed, sha256: hash(changed), bytes: changed.length }), /AGENT_NATIVE_EVIDENCE_CHANGED/);
  });
  await test("closed Job evidence survives supervisor memory loss and rejects foreign request/client", () => {
    const attempt = { attempt_id: "attempt.closed" }, request = { attempt_id: attempt.attempt_id, input_sha: "1".repeat(40) };
    const proof = { method: "windows-job-object", active_processes: 0, runner_id: "runner.fixture", pid: 9876, started_at: "2026-09-27T00:00:00Z", job_name: "Local\\aidn-execution-" + "0".repeat(32),
      candidate_sha256: config.candidate.sha256, helper_sha256: config.helper.helper_sha256, source_sha256: config.helper.source_sha256 };
    const record = { attempt_id: attempt.attempt_id, request_sha256: fingerprint(request), process: { termination_state: "confirmed", termination_proof: proof,
      runner: { runner_id: proof.runner_id, pid: proof.pid, started_at: proof.started_at, executable_sha256: config.runtime.sha256 } } };
    fs.writeFileSync(path.join(root, `native-termination-${hash(attempt.attempt_id)}.json`), JSON.stringify(record));
    const context = { request, termination_state: "confirmed", runner: { runner_id: proof.runner_id, pid: proof.pid, started_at: new Date(proof.started_at).toISOString() } };
    const service = createCodexAgentAttemptService(config); assert.equal(service.verifyTermination(attempt, proof, context), true);
    assert.equal(service.verifyTermination(attempt, proof, { ...context, runner: null }), true);
    assert.equal(inspectNativeAttemptStop(service, { attempt, request, runner: null, result: null }).termination_state, "confirmed");
    assert.equal(service.verifyTermination(attempt, proof, { ...context, runner: { ...context.runner, pid: 123 } }), false);
    const file = path.join(root, `native-termination-${hash(attempt.attempt_id)}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...record, process: { ...record.process, runner: { ...record.process.runner, pid: 123 } } }));
    assert.equal(service.verifyTermination(attempt, proof, { ...context, runner: null }), false);
    for (const field of ["pid", "runner_id"]) {
      const incomplete = structuredClone(record); delete incomplete.process.runner[field]; delete incomplete.process.termination_proof[field];
      fs.writeFileSync(file, JSON.stringify(incomplete));
      assert.equal(service.verifyTermination(attempt, incomplete.process.termination_proof, { ...context, runner: null }), false);
    }
    const undated = structuredClone(record); undated.process.runner.started_at = null; undated.process.termination_proof.started_at = null;
    fs.writeFileSync(file, JSON.stringify(undated)); assert.equal(service.verifyTermination(attempt, undated.process.termination_proof, { ...context, runner: null }), false);
    fs.writeFileSync(file, JSON.stringify(record));
    assert.equal(service.verifyTermination(attempt, proof, { ...context, request: { ...request, input_sha: "2".repeat(40) } }), false);
    assert.equal(service.verifyTermination(attempt, { ...proof, active_processes: 1 }, context), false);
    assert.equal(createCodexAgentAttemptService({ ...config, runtime: { sha256: "f".repeat(64) } }).verifyTermination(attempt, proof, context), false);
  });
  await test("never-started receipt survives memory loss without a synthetic worker termination", () => {
    const chain = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url)));
    const { request, attempt } = chain, service = createCodexAgentAttemptService(config);
    const proof = { method: "codex-not-started", attempt_id: attempt.attempt_id, request_sha256: fingerprint(request), native_create_requested: false };
    const result = { ...chain.result, outcome: "cancelled", reason_code: "CODEX_CANCELLED", termination_state: "not_started", request_sha256: fingerprint(request), process: { exit_code: null, signal: null } };
    const record = { result, proof, process: null }, file = path.join(root, `native-not-started-${hash(attempt.attempt_id)}.json`);
    const persist = value => fs.writeFileSync(file, JSON.stringify(value));
    const view = { attempt, request, runner: null, result: null, termination: null, reconciliation: null };
    const context = { request, runner: null, termination_state: "not_started" };
    assert.throws(() => inspectNativeAttemptStop(service, view));
    persist(record);
    assert.deepEqual(inspectNativeAttemptStop(service, view), { attempt_id: attempt.attempt_id, proof, termination_state: "not_started" });
    assert.throws(() => inspectNativeAttemptStop(service, view, { durableOnly: true }));
    assert.equal(service.verifyTermination(attempt, proof, { ...context, runner: { pid: 123 } }), false);
    assert.equal(service.verifyTermination(attempt, proof, { ...context, termination_state: "confirmed" }), false);
    const reconciled = { ...view, reconciliation: proof, reconciliation_termination_state: "not_started" };
    assert.equal(inspectNativeAttemptStop(service, reconciled, { durableOnly: true }).termination_state, "not_started");
    for (const changed of [
      { ...record, proof: { ...proof, native_create_requested: null } },
      { ...record, proof: { ...proof, method: "unknown" } },
      { ...record, result: { ...result, task_id: "foreign" } },
      { ...record, result: { ...result, request_sha256: "f".repeat(64) } },
      { ...record, process: { termination_state: "confirmed", runner: { pid: 123 } } },
    ]) { persist(changed); assert.equal(service.verifyTermination(attempt, changed.proof, context), false); }
    persist(record);
    const contradictory = path.join(root, `native-termination-${hash(attempt.attempt_id)}.json`);
    fs.writeFileSync(contradictory, "{}"); assert.equal(service.verifyTermination(attempt, proof, context), false);
    const notCreated = { ...record, proof: { ...proof, native_create_requested: true }, process: { termination_state: "not_started", runner: null } };
    persist(notCreated); fs.writeFileSync(contradictory, JSON.stringify({ attempt_id: attempt.attempt_id, request_sha256: fingerprint(request), process: notCreated.process }));
    assert.equal(service.verifyTermination(attempt, notCreated.proof, context), true);
    assert.equal(inspectNativeAttemptStop(service, view).termination_state, "not_started");
  });
  await test("metadata preparation replay preserves unknown cleanup and refuses missing or foreign proof", () => {
    const attemptId = "attempt.bootstrap", requestSha = "1".repeat(64), directory = path.join(root, `native-attempt-${hash(attemptId)}`);
    fs.mkdirSync(directory); const service = createCodexAgentAttemptService(config);
    fs.writeFileSync(path.join(directory, "native-profile-preparation.intent.json"), JSON.stringify({ attempt_id: attemptId, request_sha256: requestSha, budget_ms: 60000 }));
    assert.throws(() => service.inspectPreparationTermination({ attemptId }), /AGENT_NATIVE_PREPARATION_TERMINATION_UNAVAILABLE/);
    const file = path.join(directory, "native-profile-preparation.terminal.json");
    fs.writeFileSync(file, JSON.stringify({ attempt_id: attemptId, request_sha256: requestSha, status: "FAILED", process_cleanup: "UNCONFIRMED", process: null, native_worker: "NOT_STARTED" }));
    const observed = service.inspectPreparationTermination({ attemptId }); assert.equal(observed.terminal.process_cleanup, "UNCONFIRMED");
    assert.equal(observed.terminal.process, null); assert.equal(observed.terminal_evidence.ref, `native-attempt-${hash(attemptId)}/native-profile-preparation.terminal.json`);
    fs.writeFileSync(file, JSON.stringify({ attempt_id: "foreign", request_sha256: requestSha }));
    assert.throws(() => service.inspectPreparationTermination({ attemptId }), /AGENT_NATIVE_PREPARATION_EVIDENCE_INVALID/);
  });
  await test("controlled Git forwards only the pinned executable to its injected controller", async () => {
    const binary = path.join(root, "fixture-binary"), bytes = Buffer.from("fixture, never executable"); fs.writeFileSync(binary, bytes);
    let calls = 0;
    const run = createControlledGitProcess({ gitExecutable: binary, gitSha256: hash(bytes), controller: { async run(request) { calls++; assert.equal(request.executableSha256, hash(bytes)); return { fixture: true }; } } });
    assert.deepEqual(await run({ executable: binary, operation_id: "fixture", args: [], cwd: root, env: {}, stdin: "", maxDurationMs: 1, maxOutputBytes: 100 }), { fixture: true });
    fs.appendFileSync(binary, "changed"); await assert.rejects(run({ executable: binary }), /AGENT_GIT_EXECUTABLE_CHANGED/); assert.equal(calls, 1);
  });
  await test("every metadata observation retains actual closure while unknown or interrupted operations refuse recovery", async () => {
    const attemptId = "attempt.metadata", directory = path.join(root, `native-attempt-${hash(attemptId)}`); fs.mkdirSync(directory);
    const options = { request: { attempt_id: attemptId }, policy: { fixture: true }, timeoutMs: 10000 };
    const processProof = { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: 6, budget_ms: 10000 };
    let reject;
    const journal = createCodexProfileOperationJournal({ resourcesRoot: root, attemptId, observe: async input => {
      if (input.fixtureFailure) throw Object.assign(new Error("fixture"), { code: "FIXTURE_FAILURE", process: input.confirmedFailure ? processProof : null });
      if (input.pending) return new Promise((_, refused) => { reject = refused; });
      return { process: processProof };
    } });
    for (const metadataBootstrap of [true, false, false, false]) await journal.observe({ ...options, metadataBootstrap });
    assert.equal(journal.inspect().operations.length, 4);
    assert.equal(journal.inspect().metadata_parent_closed, true); assert.equal(journal.inspect().descendants_termination, "unconfirmed"); assert.equal(journal.inspect().confirmed, false);
    await assert.rejects(journal.observe({ ...options, fixtureFailure: true, confirmedFailure: true }), /fixture/);
    assert.equal(createCodexAgentAttemptService(config).inspectProfileOperations({ attemptId }).operations.length, 5);
    const pending = journal.observe({ ...options, pending: true });
    assert.throws(() => journal.inspect(), /AGENT_NATIVE_PROFILE_TERMINATION_UNCONFIRMED/);
    reject(Object.assign(new Error("fixture unknown"), { code: "FIXTURE_UNKNOWN" }));
    await assert.rejects(pending, /fixture unknown/);
    assert.equal(journal.inspect().confirmed, false); assert.equal(journal.inspect().metadata_parent_closed, false);
  });
  await test("only matching metadata Job evidence establishes descendant termination, independently of metadata success", async () => {
    const attemptId = "attempt.metadata.job", directory = path.join(root, `native-attempt-${hash(attemptId)}`); fs.mkdirSync(directory);
    const expectedTree = { metadata_runner_sha256: "1".repeat(64), candidate_sha256: "2".repeat(64), helper_sha256: "3".repeat(64),
      source_sha256: "4".repeat(64), bridge_sha256: "5".repeat(64), collector_sha256: "6".repeat(64), candidate_inventory_sha256: "7".repeat(64) };
    const runner = { runner_id: "metadata.fixture", pid: 1234, started_at: "2026-09-27T00:00:00Z", job_name: "Local\\aidn-execution-" + "f".repeat(32), executable_sha256: expectedTree.metadata_runner_sha256,
      candidate_sha256: expectedTree.candidate_sha256, helper_sha256: expectedTree.helper_sha256, source_sha256: expectedTree.source_sha256 };
    const proof = { method: "windows-job-object", active_processes: 0, ...runner, candidate_sha256: expectedTree.candidate_sha256, helper_sha256: expectedTree.helper_sha256, source_sha256: expectedTree.source_sha256 };
    const process = { closed: false, pid_absent: false, tree_termination: { termination_state: "confirmed", runner, proof,
      bridge_sha256: expectedTree.bridge_sha256, collector_sha256: expectedTree.collector_sha256, candidate_inventory_sha256: expectedTree.candidate_inventory_sha256, request_sha256: "8".repeat(64) } };
    const journal = createCodexProfileOperationJournal({ resourcesRoot: root, attemptId, expectedTree,
      observe: async () => { throw Object.assign(new Error("metadata failed with stopped tree"), { code: "FIXTURE_FAILURE", process }); } });
    await assert.rejects(journal.observe({ request: { attempt_id: attemptId }, policy: {}, timeoutMs: 10000 }), /metadata failed/);
    const observation = journal.inspect(); assert.equal(observation.confirmed, true); assert.equal(observation.metadata_parent_closed, false);
    assert.equal(observation.operations[0].terminal.status, "FAILED");
    for (const field of Object.keys(expectedTree)) {
      const foreign = { ...expectedTree, [field]: "0".repeat(64) };
      assert.equal(createCodexProfileOperationJournal({ resourcesRoot: root, attemptId, expectedTree: foreign }).inspect().confirmed, false);
    }
    const terminalPath = path.join(root, observation.operations[0].terminal_evidence.ref), retained = fs.readFileSync(terminalPath);
    for (const field of ["runner_id", "pid", "started_at", "job_name", "candidate_sha256", "helper_sha256", "source_sha256"]) {
      const changed = JSON.parse(retained), tree = changed.process.tree_termination;
      delete tree.runner[field];
      if (["runner_id", "pid", "started_at", "job_name"].includes(field)) delete tree.proof[field];
      fs.writeFileSync(terminalPath, JSON.stringify(changed));
      assert.equal(journal.inspect().confirmed, false, `missing ${field} cannot establish termination`);
    }
    fs.writeFileSync(terminalPath, retained); assert.equal(journal.inspect().confirmed, true);
  });
} finally {
  const physical = fs.realpathSync.native(root); assert.equal(path.dirname(physical).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.equal(fs.readFileSync(path.join(physical, "owner"), "utf8"), nonce); fs.rmSync(physical, { recursive: true, force: true });
}
assert(!fs.existsSync(root)); console.log(JSON.stringify({ status: "PASS", checks: count, cleanup: "PASS", native_codex: "NOT_RUN", postgres: "NOT_RUN", controlled_git: "INJECTED_FIXTURE_ONLY" }));
