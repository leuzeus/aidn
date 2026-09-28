import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createVerificationFixture, canonical, digest, signed } from "./agent-verification-test-lib.mjs";
import { createAgentValidationEvidenceVerifier } from "../../src/adapters/runtime/local-agent-verification.mjs";
import { fingerprintAgentExecutionValue as fingerprint, normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";

const checks = [];
async function check(name, body) { try { await body(); checks.push({ name, status: "PASS" }); } catch (cause) { checks.push({ name, status: "FAIL", detail: String(cause.stack ?? cause).slice(0, 2400) }); } }
async function fixture(options, body) { const value = await createVerificationFixture(options); try { await body(value); } finally { value.cleanup(); } }
const raw = plan => { const value = structuredClone(plan); delete value.plan_sha256; return value; };
let forgedOrdinal = 0;
function forgedDocument(f, document, reference, mutate) {
  const payload = JSON.parse(fs.readFileSync(path.join(f.resourcesRoot, reference.ref))).payload;
  mutate(payload);
  const content = Buffer.from(canonical(signed(payload, f.privateKey))), ref = `adversarial-${++forgedOrdinal}.json`;
  fs.writeFileSync(path.join(f.resourcesRoot, ref), content, { flag: "wx" });
  const replacement = { ref, sha256: digest(content), bytes: content.length };
  const replace = value => value && typeof value === "object" ? canonical(value) === canonical(reference) ? replacement
    : Array.isArray(value) ? value.map(replace) : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)])) : value;
  return replace(document);
}

await check("construction and failed availability do not write or launch", () => fixture({}, async f => {
  const before = fs.readdirSync(f.resourcesRoot).sort();
  const producer = f.create({ boundary: null });
  assert.equal((await producer.checkAvailability({ plan: f.plan })).status, "unavailable");
  assert.deepEqual(fs.readdirSync(f.resourcesRoot).sort(), before); assert.equal(f.calls, 0);
}));
await check("explicit fixture boundary never advertises native qualification", () => fixture({}, async f => {
  assert.deepEqual(await f.create().checkAvailability({ plan: f.plan }), { status: "available", evidence_class: "fixture", native: false });
  assert.equal((await f.create({ evidenceClass: "native" }).checkAvailability({ plan: f.plan })).status, "unavailable");
}));
await check("injected cooperative qualification retains exact-SHA checks and rejects missing write protection", () => fixture({}, async f => {
  const plan = normalizeAgentExecutionPlan({ ...raw(f.plan), contract_version: "agent-execution-plan.v2", assurance_profile: "codex-cooperative.v1" });
  const strict = f.boundary.getDescriptor().qualification.payload;
  const qualification = { ...strict, contract_version: "agent-verification-boundary.v3", boundary_id: "codex-sandbox-validation", evidence_class: "native",
    assurance_profile: "codex-cooperative.v1", read_isolation: "not_guaranteed", sandbox_maintenance: "codex-managed",
    protected_resources_preserved: true, protected_resources_sha256: "a".repeat(64), supervisor_write_protected: true, concurrent_write_protection: true };
  delete qualification.supervisor_resources_inaccessible;
  let probes = 0;
  // This is a signed, injected consumer double. It supplies no OS/native evidence.
  const boundaryFor = payload => ({ ...f.boundary, getDescriptor: () => ({ boundary_id: payload.boundary_id, qualification: signed(payload, f.privateKey) }),
    checkAvailability: async () => { probes++; return { available: true, native: true }; },
    run: async (...args) => ({ ...await f.boundary.run(...args), boundary_id: payload.boundary_id }) });
  const producer = f.create({ evidenceClass: "native", boundary: boundaryFor(qualification) });
  assert.equal((await producer.checkAvailability({ plan })).status, "available");
  const validation = await producer.validateTask({ ...f.taskInput, plan });
  assert.equal(validation.status, "passed"); assert.equal(validation.tested_sha, f.candidateSha); assert.equal(f.calls, 1);
  const input = { ...f.verificationInput({ validation }, "task"), plan, run: { ...f.run, plan_sha256: plan.plan_sha256 } };
  const proof = await producer.evidenceVerifier.verify(input);
  assert.equal(proof.snapshots[0].candidate_sha, f.candidateSha);
  const changed = forgedDocument(f, { validation }, validation.checks[0].evidence, payload => {
    const q = payload.boundary_qualification.payload; delete q.supervisor_write_protected; payload.boundary_qualification = signed(q, f.privateKey);
  });
  await assert.rejects(producer.evidenceVerifier.verify({ ...input, document: changed, subject_sha256: fingerprint(changed) }), /BOUNDARY_UNAVAILABLE/);
  for (const field of ["supervisor_write_protected", "concurrent_write_protection", "snapshot_read_only", "network_disabled", "descendant_termination"]) {
    const missing = { ...qualification }; delete missing[field];
    assert.equal((await f.create({ evidenceClass: "native", boundary: boundaryFor(missing) }).checkAvailability({ plan })).reason_code, "VERIFICATION_BOUNDARY_UNAVAILABLE");
  }
  const before = probes;
  assert.equal((await producer.checkAvailability({ plan: f.plan })).reason_code, "VERIFICATION_ASSURANCE_PROFILE_MISMATCH");
  assert.equal((await f.create({ boundary: boundaryFor(strict) }).checkAvailability({ plan })).reason_code, "VERIFICATION_ASSURANCE_PROFILE_MISMATCH");
  assert.equal(probes, before); assert.equal(f.calls, 1);
}));
await check("legacy plan, absent key, changed pin and changed environment are unavailable", () => fixture({}, async f => {
  const legacy = raw(f.plan); delete legacy.verification;
  assert.equal((await f.create().checkAvailability({ plan: normalizeAgentExecutionPlan(legacy) })).status, "unavailable");
  assert.equal((await f.create({ privateKey: null }).checkAvailability({ plan: f.plan })).status, "unavailable");
  assert.equal((await f.create({ publicKey: generateKeyPairSync("ed25519").publicKey }).checkAvailability({ plan: f.plan })).status, "unavailable");
  assert.equal((await f.create({ environment: { ...f.configuration.environment, UNDECLARED: "value" } }).checkAvailability({ plan: f.plan })).status, "unavailable");
  assert.equal(f.calls, 0);
}));
await check("sanitized environment refuses credential, loader and case aliases", () => fixture({}, async f => {
  for (const name of ["PGPASSFILE", "PGHOST", "LD_PRELOAD", "NODE_OPTIONS", "PATH", "SystemRoot"]) {
    const environment = name === "SystemRoot" ? { TEMP: f.configuration.scratchRoot, temp: f.configuration.scratchRoot }
      : { ...f.configuration.environment, [name]: "forbidden" };
    assert.equal((await f.create({ environment }).checkAvailability({ plan: f.plan })).reason_code, "VERIFICATION_ENVIRONMENT_INVALID");
  }
  assert.equal((await f.create({ environment: { TEMP: f.root } }).checkAvailability({ plan: f.plan })).reason_code, "VERIFICATION_SCRATCH_INVALID");
  assert.equal(f.calls, 0);
}));
await check("a signed qualification of an old AIDN candidate is unavailable", () => fixture({}, async f => {
  const changed = raw(f.plan); changed.execution.engine.sha256 = "9".repeat(64);
  assert.equal((await f.create().checkAvailability({ plan: normalizeAgentExecutionPlan(changed) })).reason_code, "VERIFICATION_BOUNDARY_UNAVAILABLE");
  assert.equal(f.calls, 0);
}));
await check("a self-declared or forged boundary is unavailable", () => fixture({}, async f => {
  const qualification = structuredClone(f.boundary.getDescriptor().qualification); qualification.payload.snapshot_read_only = false;
  const boundary = { ...f.boundary, getDescriptor: () => ({ boundary_id: "fixture-node", qualification }) };
  assert.equal((await f.create({ boundary }).checkAvailability({ plan: f.plan })).status, "unavailable");
  assert.equal(f.calls, 0);
}));
await check("a signed boundary without network denial is unavailable", () => fixture({}, async f => {
  for (const value of [false, null]) {
    const payload = structuredClone(f.boundary.getDescriptor().qualification.payload);
    if (value === null) delete payload.network_disabled; else payload.network_disabled = value;
    const boundary = { ...f.boundary, getDescriptor: () => ({ boundary_id: "fixture-node", qualification: signed(payload, f.privateKey) }) };
    assert.equal((await f.create({ boundary }).checkAvailability({ plan: f.plan })).reason_code, "VERIFICATION_BOUNDARY_UNAVAILABLE");
  }
  assert.equal(f.calls, 0);
}));
await check("real Node tests the committed candidate in a detached snapshot while worker HEAD remains old", () => fixture({}, async f => {
  assert.equal(f.gitCommand(["rev-parse", "HEAD"]), f.baseSha); assert.equal(fs.readFileSync(path.join(f.repositoryRoot, "subject.txt"), "utf8"), "old");
  const producer = f.create(), validation = await producer.validateTask(f.taskInput);
  assert.equal(validation.status, "passed"); assert.equal(validation.tested_sha, f.candidateSha); assert.equal(f.calls, 1); assert.equal(f.inspections, 2);
  assert.equal(f.gitCommand(["rev-parse", "HEAD"]), f.baseSha); assert.equal(f.gitCommand(["status", "--porcelain"]), "");
  const document = { validation }, input = f.verificationInput(document, "task");
  const observed = await producer.evidenceVerifier.verify(input), repeated = await producer.evidenceVerifier.verify(input);
  assert.equal(canonical(observed), canonical(repeated)); assert.equal(observed.proof_authority_sha256, f.pin);
  assert.equal(observed.snapshots[0].candidate_sha, f.candidateSha);
  assert.deepEqual(await f.create().validateTask(f.taskInput), validation); assert.equal(f.calls, 1);
}));
await check("task evidence rejects altered subject SHA, attempt and result", () => fixture({}, async f => {
  const producer = f.create(), validation = await producer.validateTask(f.taskInput), input = f.verificationInput({ validation }, "task");
  await assert.rejects(producer.evidenceVerifier.verify({ ...input, subject_sha256: "0".repeat(64) }), /SUBJECT_MISMATCH/);
  await assert.rejects(producer.evidenceVerifier.verify({ ...input, expected: { ...input.expected, tested_sha: f.baseSha } }), /BINDING_INVALID/);
  await assert.rejects(producer.evidenceVerifier.verify({ ...input, attempt: { ...input.attempt, attempt_id: "foreign" } }), /BINDING_INVALID/);
  await assert.rejects(producer.evidenceVerifier.verify({ ...input, result: { ...input.result, outcome: "failed" } }), /BINDING_INVALID/);
}));
await check("valid signatures cannot hide partial, duplicate or unproved task checks", () => fixture({}, async f => {
  const producer = f.create(), validation = await producer.validateTask(f.taskInput), document = { validation }, reference = validation.checks[0].evidence;
  for (const mutate of [payload => payload.checks.splice(0), payload => payload.checks.push(structuredClone(payload.checks[0]))]) {
    const changed = forgedDocument(f, document, reference, mutate);
    await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(changed, "task")), /CHECK_SET_MISMATCH/);
  }
  const extra = structuredClone(document); extra.validation.checks.push({ ...structuredClone(extra.validation.checks[0]), validation_id: "unproved" });
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(extra, "task")), /VERDICT_INVALID/);
  const duplicate = structuredClone(document); duplicate.validation.checks.push(structuredClone(duplicate.validation.checks[0]));
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(duplicate, "task")), /VERDICT_INVALID/);
}));
await check("signed wrong platform, engine and invocation limits are rejected independently", () => fixture({}, async f => {
  const producer = f.create(), validation = await producer.validateTask(f.taskInput), document = { validation }, reference = validation.checks[0].evidence;
  for (const field of ["platform", "engine_sha256", "network_disabled"]) {
    const changed = forgedDocument(f, document, reference, payload => {
      const qualification = payload.boundary_qualification.payload; qualification[field] = field === "platform" ? "other-os" : field === "network_disabled" ? false : "0".repeat(64);
      payload.boundary_qualification = signed(qualification, f.privateKey);
    });
    await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(changed, "task")), /BOUNDARY_UNAVAILABLE/);
  }
  for (const [field, value] of [["max_duration_ms", 0], ["max_duration_ms", f.plan.verification.limits.max_duration_ms + 1], ["max_output_bytes", -1]]) {
    const changed = forgedDocument(f, document, reference, payload => {
      payload.checks[0].invocation[field] = value; payload.checks[0].request_sha256 = fingerprint(payload.checks[0].invocation);
    });
    await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(changed, "task")), /INVOCATION_INVALID/);
  }
  const missingLogs = forgedDocument(f, document, reference, payload => { payload.output_refs = []; });
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(missingLogs, "task")), /OUTPUT_SET_MISMATCH/);
}));
await check("altered proof or output bytes cannot be accepted on replay", () => fixture({}, async f => {
  const producer = f.create(), validation = await producer.validateTask(f.taskInput), input = f.verificationInput({ validation }, "task");
  const ref = validation.checks[0].evidence, target = path.join(f.resourcesRoot, ref.ref), original = fs.readFileSync(target);
  fs.writeFileSync(target, Buffer.concat([original, Buffer.from(" ")]));
  await assert.rejects(producer.evidenceVerifier.verify(input), /EVIDENCE_CHANGED/); fs.writeFileSync(target, original);
  const payload = JSON.parse(original).payload, log = path.join(f.resourcesRoot, payload.output_refs[0].ref), originalLog = fs.readFileSync(log);
  fs.writeFileSync(log, "forged"); await assert.rejects(producer.evidenceVerifier.verify(input), /EVIDENCE_CHANGED/); fs.writeFileSync(log, originalLog);
  const forged = JSON.parse(original); forged.payload.checks[0].status = "failed"; const content = Buffer.from(canonical(forged)); fs.writeFileSync(target, content);
  const changed = structuredClone(input.document); changed.validation.checks[0].evidence = { ref: ref.ref, sha256: fingerprint(forged), bytes: content.length };
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(changed, "task")), /SIGNATURE_INVALID/);
}));
await check("oversized and hardlinked evidence is refused before parsing", () => fixture({}, async f => {
  const producer = f.create(), validation = await producer.validateTask(f.taskInput), document = { validation };
  const oversized = structuredClone(document); oversized.validation.checks[0].evidence.bytes = 8 * 1024 * 1024 + 1;
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(oversized, "task")), /EVIDENCE_REF_INVALID/);
  const reference = validation.checks[0].evidence, target = path.join(f.resourcesRoot, reference.ref), original = fs.readFileSync(target);
  const handle = fs.openSync(target, "r+"); try { fs.ftruncateSync(handle, 8 * 1024 * 1024 + 1); } finally { fs.closeSync(handle); }
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(document, "task")), /FILE_INVALID/);
  fs.writeFileSync(target, original);
  const linked = path.join(f.resourcesRoot, "linked-proof.json"); fs.linkSync(target, linked);
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(document, "task")), /FILE_INVALID/);
}));
await check("foreign key and fixture proof are rejected by the native verifier", () => fixture({}, async f => {
  const validation = await f.create().validateTask(f.taskInput), input = f.verificationInput({ validation }, "task");
  await assert.rejects(createAgentValidationEvidenceVerifier({ resourcesRoot: f.resourcesRoot, publicKey: generateKeyPairSync("ed25519").publicKey, evidenceClass: "fixture" }).verify(input), /AUTHORITY_UNAVAILABLE/);
  await assert.rejects(createAgentValidationEvidenceVerifier({ resourcesRoot: f.resourcesRoot, publicKey: f.publicKey }).verify(input), /BINDING_INVALID/);
}));
await check("final validation and pure audit share exact snapshot with fresh distinct observations", () => fixture({}, async f => {
  const producer = f.create(), checks = await producer.validateRun(f.runInput), audit = await producer.auditRun(f.runInput);
  assert.equal(checks[0].status, "passed"); assert.equal(audit.checks[0].status, "passed"); assert.equal(f.calls, 1);
  const document = { checks, audit, integration_sequence: 1 }, observed = await producer.evidenceVerifier.verify(f.verificationInput(document, "run"));
  assert.deepEqual(observed.snapshots.map(item => item.phase), ["audit", "run"]);
  assert.equal(observed.snapshots[0].snapshot_sha256, observed.snapshots[1].snapshot_sha256);
  assert.notEqual(observed.snapshots[0].before_sha256, observed.snapshots[1].before_sha256);
  assert.deepEqual(await f.create().auditRun(f.runInput), audit); assert.equal(f.calls, 1);
}));
await check("run evidence cannot omit a frozen validation or append an unproved check", () => fixture({}, async f => {
  const producer = f.create(), checks = await producer.validateRun(f.runInput), audit = await producer.auditRun(f.runInput), document = { checks, audit, integration_sequence: 1 };
  const changed = forgedDocument(f, document, checks[0].evidence, payload => { payload.checks = []; payload.bindings.validation_ids = []; payload.output_refs = []; });
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(changed, "run")), /BINDING_INVALID/);
  const duplicate = structuredClone(document); duplicate.checks.push(structuredClone(duplicate.checks[0]));
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(duplicate, "run")), /VERDICT_INVALID/);
}));
await check("audit verdicts are recomputed from the sealed policy even with a valid signature", () => fixture({ auditCheck: "code-is-correct" }, async f => {
  const producer = f.create(), checks = await producer.validateRun(f.runInput), audit = await producer.auditRun(f.runInput), document = { checks, audit, integration_sequence: 1 };
  const changed = forgedDocument(f, document, audit.checks[0].evidence, payload => { payload.checks[0].status = "passed"; payload.checks[0].check_id = "exact-snapshot"; });
  changed.audit.checks[0].status = "passed";
  await assert.rejects(producer.evidenceVerifier.verify(f.verificationInput(changed, "run")), /AUDIT_INVALID/);
}));
await check("unknown semantic audit criterion remains unavailable", () => fixture({ auditCheck: "code-is-correct" }, async f => {
  const audit = await f.create({ boundary: null }).auditRun(f.runInput);
  assert.equal(audit.checks[0].status, "unavailable"); assert.equal(f.calls, 0);
}));
await check("canonical audit requires a fresh matching run, plan and integration SHA", () => fixture({ auditCheck: "all-tasks-integrated" }, async f => {
  const producer = f.create({ readRun: async () => ({ ...f.canonicalRun, integration_head: { sha: f.baseSha, sequence: 1 } }) });
  await assert.rejects(producer.auditRun(f.runInput), /CANONICAL_MISMATCH/); assert.equal(f.calls, 0);
}));
await check("stale canonical audit observations are refused", () => fixture({ auditCheck: "all-tasks-integrated" }, async f => {
  await assert.rejects(f.create({ readRun: async () => ({ ...f.canonicalRun, server_now: "2000-01-01T00:00:00.000Z" }) }).auditRun(f.runInput), /CANONICAL_MISMATCH/);
}));
await check("pending integration intents cannot satisfy no-uncertain-work", () => fixture({ auditCheck: "no-uncertain-work" }, async f => {
  const producer = f.create({ readRun: async () => ({ ...f.canonicalRun, server_now: new Date().toISOString(),
    integration_intents: [{ intent: { integration_id: "pending.fixture" }, status: "pending" }] }) });
  assert.equal((await producer.auditRun(f.runInput)).checks[0].status, "failed"); assert.equal(f.calls, 0);
}));
await check("uncertain Git operations cannot satisfy no-uncertain-work", () => fixture({ auditCheck: "no-uncertain-work" }, async f => {
  const git = { ...f.configuration.git, inspectGitOperations: async () => ({ operations: [{ operation_id: "uncertain", intent_sha256: "a".repeat(64), recovery_required: true }], uncertain_read: null }) };
  assert.equal((await f.create({ git }).auditRun(f.runInput)).checks[0].status, "failed");
}));
await check("canonical audit replay rereads material facts while preserving its original proof", () => fixture({ auditCheck: "no-uncertain-work" }, async f => {
  let pending = false;
  const readRun = async () => ({ ...f.canonicalRun, server_now: new Date(), integration_intents: pending
    ? [{ intent: { integration_id: "new.pending" }, status: "reserved" }] : [] });
  const producer = f.create({ readRun }), audit = await producer.auditRun(f.runInput);
  assert.equal(audit.checks[0].status, "passed");
  const reference = audit.checks[0].evidence, target = path.join(f.resourcesRoot, reference.ref), before = fs.readFileSync(target);
  assert.deepEqual(await f.create({ readRun }).auditRun(f.runInput), audit);
  pending = true;
  await assert.rejects(f.create({ readRun }).auditRun(f.runInput), /REPLAY_FACTS_CHANGED/);
  assert.ok(fs.readFileSync(target).equals(before)); assert.equal(f.calls, 0);
}));
await check("missing Git facts leave no-uncertain-work unavailable", () => fixture({ auditCheck: "no-uncertain-work" }, async f => {
  const git = { ...f.configuration.git, inspectGitOperations: undefined };
  assert.equal((await f.create({ git }).auditRun(f.runInput)).checks[0].status, "unavailable");
}));
await check("exit zero without the configured verdict protocol is unavailable", () => fixture({ script: "console.log('{}');" }, async f => {
  assert.equal((await f.create().validateTask(f.taskInput)).status, "unavailable");
}));
await check("failed process cannot manufacture passed validation", () => fixture({ script: "console.log(JSON.stringify({contract_version:'agent-verification-check.v1',validation_id:'contents',status:'passed'}));process.exitCode=1;" }, async f => {
  assert.equal((await f.create().validateTask(f.taskInput)).status, "failed");
}));
await check("candidate changes to the frozen validation script are refused before process launch", () => fixture({ candidateScript: "console.log('forged success');" }, async f => {
  await assert.rejects(f.create().validateTask(f.taskInput), /CONTROL_CHANGED/); assert.equal(f.calls, 0);
}));
await check("mutation during validation is preserved and a retry is refused", () => fixture({ script: "import fs from 'node:fs';fs.writeFileSync('subject.txt','changed');console.log(JSON.stringify({contract_version:'agent-verification-check.v1',validation_id:'contents',status:'passed'}));" }, async f => {
  const producer = f.create(); await assert.rejects(producer.validateTask(f.taskInput), /SNAPSHOT_DRIFT/); assert.equal(f.calls, 1);
  await assert.rejects(f.create().validateTask(f.taskInput), /RECONCILIATION_REQUIRED/); assert.equal(f.calls, 1);
}));
await check("aborted invocation creates no verification intent or child", () => fixture({}, async f => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.create().validateTask({ ...f.taskInput, signal: controller.signal }), /INTERRUPTED/);
  assert.equal(fs.existsSync(path.join(f.resourcesRoot, "verification", "intents")), false); assert.equal(f.calls, 0);
}));
await check("unconfirmed termination preserves intent and refuses another child", () => fixture({}, async f => {
  let stopRequests = 0;
  const boundary = { ...f.boundary, run: async (...args) => ({ ...await f.boundary.run(...args), termination_state: "unknown" }),
    requestStop: async input => { stopRequests++; return f.boundary.requestStop(input); } };
  await assert.rejects(f.create({ boundary }).validateTask(f.taskInput), /STOP_UNCONFIRMED/);
  assert.equal(stopRequests, 1);
  await assert.rejects(f.create().validateTask(f.taskInput), /RECONCILIATION_REQUIRED/); assert.equal(f.calls, 1);
}));
await check("oversized process output is refused before copying or signing a verdict", () => fixture({ script: "process.stdout.write('x'.repeat(100000));", outputLimit: 1024 }, async f => {
  await assert.rejects(f.create().validateTask(f.taskInput), /OUTPUT_LIMIT/); assert.equal(f.calls, 1);
}));
await check("a synchronous final descriptor overrun cannot publish a passed result", () => fixture({ maxDuration: 15000 }, async f => {
  let descriptors = 0;
  const started = performance.now(), boundary = { ...f.boundary, getDescriptor() {
    descriptors++;
    if (descriptors === 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, 15020 - (performance.now() - started)));
    return f.boundary.getDescriptor();
  } };
  await assert.rejects(f.create({ boundary }).validateTask(f.taskInput), /INTERRUPTED/);
  assert.equal(descriptors, 4); assert.equal(f.calls, 1);
  const results = path.join(f.resourcesRoot, "verification", "results"); assert.equal(fs.existsSync(results), false);
}));
await check("timeout stops the fixture child and preserves reconciliation instead of rerunning", () => fixture({ script: "setInterval(()=>{},1000);", maxDuration: 15000 }, async f => {
  const start = performance.now(); await assert.rejects(f.create().validateTask(f.taskInput), /INTERRUPTED|STOP_UNCONFIRMED/);
  assert.ok(performance.now() - start < 18000); assert.equal(f.calls, 1, "the timeout must occur after a real child was launched");
  await assert.rejects(f.create().validateTask(f.taskInput), /RECONCILIATION_REQUIRED/);
}));

console.log(JSON.stringify({ ok: checks.every(item => item.status === "PASS"), checks, evidence: {
  real_node: "fixture processes", real_git: "disposable repositories and detached snapshots", postgres: "NOT_RUN", native_codex: "NOT_RUN",
  native_confinement: "UNAVAILABLE", proof_signatures: "real Ed25519 with fixture-generated explicit keys", cleanup: "verified per fixture",
} }, null, 2));
if (checks.some(item => item.status === "FAIL")) process.exitCode = 1;
