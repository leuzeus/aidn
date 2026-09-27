import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { createCodexManagedSetupOperationJournal as createJournal } from "../../src/adapters/runtime/codex-managed-setup-operation-journal.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";

const H = "a".repeat(64), OTHER = "b".repeat(64), checks = [], children = new Set();
const stamp = () => new Date().toISOString(), clone = value => structuredClone(value);
const bytesHash = bytes => createHash("sha256").update(bytes).digest("hex");
const evidence = () => [{ ref: "fixture/evidence.json", sha256: H, bytes: 2 }];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const runnerKeys = ["runner_id", "pid", "started_at", "job_name", "executable_sha256", "helper_sha256", "source_sha256", "candidate_sha256"];
function intent(id = "fixture.operation") {
  const at = stamp(); return { contract_version: "codex-managed-setup-intent.v1", operation_id: id,
    request_sha256: hash(id), operation_sha256: H, approval_sha256: H, configuration_sha256: H, startup_sha256: H,
    manifest_sha256: H, inventory_sha256: H, candidate_sha256: H, parent: { pid: process.pid, started_at: at },
    invocation_id: id + ".runner", job_name: "Local\\aidn-execution-" + hash(id).slice(0, 32), node_sha256: H,
    created_at: at, deadline_at: new Date(Date.now() + 120000).toISOString(), evidence: evidence() };
}
function runner(i) { return { runner_id: i.invocation_id, pid: process.pid, started_at: stamp(), job_name: i.job_name,
  executable_sha256: H, helper_sha256: H, source_sha256: H, candidate_sha256: H, suspended: true, job_assigned: true }; }
function terminal(r) {
  const normal = pick(r, runnerKeys); return { outcome: "completed", reason_code: null, launch_state: "requested", protocol_status: "completed",
    termination: { state: "confirmed", runner: normal, proof: { method: "windows-job-object", active_processes: 0, observed_at: stamp(), ...pick(normal, runnerKeys.filter(key => key !== "executable_sha256")) } },
    effects: { status: "matched", comparison_sha256: H }, evidence: evidence() };
}
function verifiers(anchor, overrides = {}) {
  return { verifyAnchor: async input => {
    assert.deepEqual(input.anchor, anchor); return { contract_version: "codex-managed-setup-anchor-verification.v1",
      host_id: anchor.host_id, anchor_sha256: anchor.sha256, journal_root: input.journal_root, root_identity_sha256: input.root_identity_sha256,
      scope: input.scope, challenge: input.challenge, observed_at: stamp(), evidence: evidence() };
  }, verifyReconciliation: async input => {
    const op = input.operation; return { contract_version: "codex-managed-setup-reconciliation.v1", operation_id: op.intent.operation_id,
      intent_sha256: op.intent_sha256, state_sha256: input.state_sha256, host_id: anchor.host_id, anchor_sha256: anchor.sha256,
      challenge: input.challenge, observed_at: stamp(), parent: { ...op.intent.parent, state: "confirmed_stopped" },
      descendants: { invocation_id: op.intent.invocation_id, job_name: op.intent.job_name, state: "confirmed_stopped", runner: op.prepared ? pick(op.prepared, runnerKeys) : null },
      effects: { status: "MATCHED", inventory_sha256: op.intent.inventory_sha256, after_sha256: H, comparison_sha256: H }, evidence: evidence() };
  }, ...overrides };
}
function fixture() {
  const temporary = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-managed-setup-journal-")), directory = path.join(root, "journal");
  fs.mkdirSync(directory);
  const file = path.join(root, "anchor.json"), body = { contract_version: "codex-managed-setup-journal-anchor.v1", host_id: "fixture.host", journal_root: directory, scope: "windows-codex-managed-setup" };
  fs.writeFileSync(file, JSON.stringify(body), { flag: "wx" }); const anchor = { path: file, sha256: bytesHash(fs.readFileSync(file)), host_id: body.host_id };
  const f = { root, directory, anchor, body, make: overrides => createJournal({ anchor, ...verifiers(anchor, overrides) }) }; f.journal = f.make();
  f.cleanup = () => { assert.equal(children.size, 0, "fixture children must be closed before cleanup");
    assert.equal(path.dirname(fs.realpathSync.native(root)), temporary); assert.ok(path.basename(root).startsWith("aidn-managed-setup-journal-"));
    fs.rmSync(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 }); assert.equal(fs.existsSync(root), false); };
  return f;
}
async function use(fn) { const f = fixture(); try { await fn(f); } finally { f.cleanup(); } }
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); } catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1800) }); } }
async function begin(f, i = intent(), journal = f.journal) { const before = await journal.inspect(); const started = await journal.begin({ intent: i, expectedStateSha256: before.state_sha256 }); return { i, journal, ...started }; }
async function prepare(f) { const b = await begin(f), r = runner(b.i); await b.journal.recordPrepared({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, runner: r }); return { ...b, r }; }
function participant(config, mode) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|HOME)$/iu.test(key)));
  const child = fork(import.meta.filename, ["--participant", config, mode], { execPath: process.execPath, execArgv: [], env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.add(child);
  const messages = []; let stderr = "", closeResolve, readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; }), closed = new Promise(resolve => { closeResolve = resolve; });
  const timer = setTimeout(() => child.kill(), 12000);
  child.stderr.on("data", bytes => { stderr += bytes.toString(); if (stderr.length > 4096) child.kill(); }); child.stdout.on("data", bytes => { if (bytes.length) child.kill(); });
  child.on("message", value => { messages.push(value); if (value.ready) readyResolve(); });
  child.on("close", (code, signal) => { clearTimeout(timer); children.delete(child); readyResolve(); closeResolve({ code, signal, messages, stderr }); });
  return { child, ready, closed };
}
if (process.argv[2] === "--participant") {
  const c = JSON.parse(fs.readFileSync(process.argv[3], "utf8")), mode = process.argv[4];
  const journal = createJournal({ anchor: c.anchor, ...verifiers(c.anchor) }); process.send({ ready: true });
  await new Promise(resolve => process.once("message", resolve));
  try {
    const b = await journal.begin({ intent: c.intent, expectedStateSha256: c.expectedStateSha256 });
    if (mode === "intent-crash") process.exit(23);
    const r = runner(c.intent);
    if (mode !== "race") await journal.recordPrepared({ operationId: c.intent.operation_id, intentSha256: b.intent_sha256, runner: r });
    if (mode === "prepared-crash") process.exit(23);
    if (mode === "terminal-crash") { await journal.recordTerminal({ operationId: c.intent.operation_id, intentSha256: b.intent_sha256, result: terminal(r) }); process.exit(23); }
    process.send({ status: "PASS", created: b.created });
  } catch (error) { process.send({ status: "REFUSED", code: error.code }); }
  process.disconnect();
} else {
await check("construction and empty inspection never create files or call providers", () => use(async f => {
  const before = fs.readdirSync(f.root), source = fs.readFileSync(f.anchor.path); let calls = 0;
  const v = verifiers(f.anchor), j = f.make({ verifyAnchor: async input => { calls++; return v.verifyAnchor(input); } }); assert.equal(calls, 0);
  const state = await j.inspect(); assert.equal(calls, 1); assert.equal(state.revision, 0); assert.equal(state.recovery_required, false);
  assert.equal(state.native_qualified, false); assert.deepEqual(fs.readdirSync(f.root), before); assert.deepEqual(fs.readFileSync(f.anchor.path), source); assert.deepEqual(fs.readdirSync(f.directory), []);
}));
await check("configured excluded journal root is refused before physical observation", () => use(async f => {
  const excluded = [f.directory], j = createJournal({ anchor: f.anchor, ...verifiers(f.anchor), excludedRoots: excluded });
  excluded.length = 0; const original = fs.lstatSync; let observed = 0;
  fs.lstatSync = (file, ...args) => { if (String(file).toLowerCase() === f.directory.toLowerCase()) { observed++; throw Error("EXCLUDED_ROOT_OBSERVED"); } return original(file, ...args); };
  try { await assert.rejects(j.inspect(), /IO_OR_VERIFIER_FAILURE/u); assert.equal(observed, 0); }
  finally { fs.lstatSync = original; }
  assert.deepEqual(fs.readdirSync(f.directory), []);
}));
await check("configured excluded anchor is refused before reading bytes", () => use(async f => {
  const j = createJournal({ anchor: f.anchor, ...verifiers(f.anchor), excludedRoots: [f.anchor.path] });
  const original = fs.lstatSync; let observed = 0;
  fs.lstatSync = (file, ...args) => { if (String(file) === f.anchor.path) { observed++; throw Error("EXCLUDED_ANCHOR_OBSERVED"); } return original(file, ...args); };
  try { await assert.rejects(j.inspect(), /IO_OR_VERIFIER_FAILURE/u); assert.equal(observed, 0); }
  finally { fs.lstatSync = original; }
}));
await check("missing host or reconciliation verifier is refused", () => use(async f => {
  assert.throws(() => createJournal({ anchor: f.anchor, verifyAnchor: async () => true }), /DEPENDENCIES_REQUIRED/u);
  await assert.rejects(f.make({ verifyAnchor: async () => true }).inspect(), /ANCHOR_UNVERIFIED/u);
}));
await check("host authority cannot be replaced by another caller-selected anchor", () => use(async f => {
  const other = path.join(f.root, "other.json"); fs.copyFileSync(f.anchor.path, other);
  const altered = { ...f.anchor, path: other }, j = createJournal({ anchor: altered, ...verifiers(f.anchor) });
  await assert.rejects(j.inspect(), /IO_OR_VERIFIER_FAILURE/u); assert.deepEqual(fs.readdirSync(f.directory), []);
}));
await check("changed anchor bytes fail before an entry is written", () => use(async f => {
  fs.appendFileSync(f.anchor.path, " "); await assert.rejects(f.journal.inspect(), /ANCHOR_CHANGED/u); assert.deepEqual(fs.readdirSync(f.directory), []);
}));
await check("anchor changed during its verifier cannot publish an intent", () => use(async f => {
  const v = verifiers(f.anchor), j = f.make({ verifyAnchor: async input => { const r = await v.verifyAnchor(input); fs.appendFileSync(f.anchor.path, " "); return r; } });
  await assert.rejects(j.inspect(), /ANCHOR_CHANGED/u);
}));
await check("complete lifecycle is durable and idempotent but never native qualification", () => use(async f => {
  const b = await prepare(f), result = terminal(b.r), input = { operationId: b.i.operation_id, intentSha256: b.intent_sha256, result };
  const ended = await f.journal.recordTerminal(input); assert.equal(ended.recorded, true); assert.equal(ended.state.recovery_required, false);
  assert.equal((await f.journal.recordTerminal(input)).recorded, false); assert.equal((await f.make().inspect()).revision, 3);
  const replay = await f.make().begin({ intent: b.i, expectedStateSha256: ended.state.state_sha256 }); assert.equal(replay.created, false);
  assert.equal(replay.state.native_qualified, false); assert.deepEqual(result, input.result);
}));
await check("begin serializes file data with fsync before reporting created", () => use(async f => {
  const original = fs.fsyncSync; let count = 0; fs.fsyncSync = fd => { count++; return original(fd); };
  try { await begin(f); assert.equal(count, 1); } finally { fs.fsyncSync = original; }
}));
await check("divergent replay of an operation identity is refused", () => use(async f => {
  const b = await begin(f); await assert.rejects(f.journal.begin({ intent: { ...b.i, configuration_sha256: OTHER }, expectedStateSha256: b.state.state_sha256 }), /DIVERGENT_REPLAY/u);
}));
await check("prepared writes are idempotent and divergence is refused", () => use(async f => {
  const b = await prepare(f), input = { operationId: b.i.operation_id, intentSha256: b.intent_sha256, runner: b.r };
  assert.equal((await f.journal.recordPrepared(input)).recorded, false);
  await assert.rejects(f.journal.recordPrepared({ ...input, runner: { ...b.r, pid: b.r.pid + 1 } }), /DIVERGENT_REPLAY/u);
}));
await check("fresh instances cannot claim a pending operation or manufacture terminal", () => use(async f => {
  const b = await prepare(f), j = f.make(), state = await j.inspect(); assert.equal(state.recovery_required, true);
  await assert.rejects(j.begin({ intent: intent("other"), expectedStateSha256: state.state_sha256 }), /RECOVERY_REQUIRED/u);
  await assert.rejects(j.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result: terminal(b.r) }), /OWNER_REQUIRED/u);
}));
await check("completed cannot be inferred from Job0 without protocol and effects", () => use(async f => {
  const b = await prepare(f);
  for (const result of [{ ...terminal(b.r), protocol_status: "unknown" }, { ...terminal(b.r), effects: { status: "unknown", comparison_sha256: null } }])
    await assert.rejects(f.journal.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result }), /COMPLETION_UNPROVEN/u);
  assert.equal((await f.journal.inspect()).revision, 2);
}));
await check("mismatched runner and nonempty Job proof are refused", () => use(async f => {
  const b = await prepare(f), result = terminal(b.r); result.termination.proof.active_processes = 1;
  await assert.rejects(f.journal.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result }), /STOP_UNCONFIRMED/u);
  result.termination.proof.active_processes = 0; result.termination.runner.pid++;
  await assert.rejects(f.journal.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result }), /TERMINAL_RUNNER_MISMATCH/u);
}));
await check("refusal before launch closes only a known not-requested operation", () => use(async f => {
  const b = await begin(f), result = { outcome: "refused", reason_code: "OPERATOR_REFUSED", launch_state: "not_requested", protocol_status: "refused",
    termination: { state: "not_started", runner: null, proof: null }, effects: { status: "not_observed", comparison_sha256: null }, evidence: evidence() };
  const end = await f.journal.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result }); assert.equal(end.state.recovery_required, false);
}));
await check("failure after launch is retained in quarantine despite Job0", () => use(async f => {
  const b = await prepare(f), result = { ...terminal(b.r), outcome: "indeterminate", reason_code: "PROTOCOL_INCOMPLETE", protocol_status: "unknown" };
  const end = await f.journal.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result }); assert.equal(end.state.recovery_required, true);
  assert.equal((await f.make().inspect()).operations[0].terminal.outcome, "indeterminate");
}));
await check("reconciliation requires trusted verification, stopped parent/tree and observed matching effects", () => use(async f => {
  const b = await prepare(f), state = await f.journal.inspect(), v = verifiers(f.anchor);
  for (const defect of ["boolean", "parent", "tree", "effects", "intent", "challenge"]) {
    const j = f.make({ verifyReconciliation: async input => { if (defect === "boolean") return { confirmed: true };
      const r = await v.verifyReconciliation(input); if (defect === "parent") r.parent.state = "pid_absent";
      if (defect === "tree") r.descendants.state = "unknown"; if (defect === "effects") r.effects.status = "UNKNOWN";
      if (defect === "intent") r.intent_sha256 = OTHER; if (defect === "challenge") r.challenge = "stale"; return r; } });
    await assert.rejects(j.reconcile({ operationId: b.i.operation_id, expectedStateSha256: state.state_sha256, proof: { confirmed: true } }), /RECONCILIATION_/u);
  }
  assert.equal((await f.journal.inspect()).revision, 2);
}));
await check("successful factual reconciliation preserves the failed outcome and prevents replay", () => use(async f => {
  const b = await prepare(f), result = { ...terminal(b.r), outcome: "indeterminate", reason_code: "PROTOCOL_INCOMPLETE", protocol_status: "unknown" };
  await f.journal.recordTerminal({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, result });
  const j = f.make(), state = await j.inspect(), input = { operationId: b.i.operation_id, expectedStateSha256: state.state_sha256, proof: { evidence: evidence() } };
  const reconciled = await j.reconcile(input); assert.equal(reconciled.state.recovery_required, false);
  assert.equal(reconciled.state.operations[0].terminal.outcome, "indeterminate"); assert.equal(reconciled.state.native_qualified, false);
  assert.equal((await j.reconcile(input)).recorded, false);
  await assert.rejects(j.reconcile({ ...input, proof: { different: true } }), /DIVERGENT_REPLAY/u);
  const reused = { ...intent("different-operation"), request_sha256: b.i.request_sha256 };
  await assert.rejects(j.begin({ intent: reused, expectedStateSha256: reconciled.state.state_sha256 }), /REPLAY_FORBIDDEN/u);
  assert.equal((await j.begin({ intent: intent("fresh-approved-operation"), expectedStateSha256: reconciled.state.state_sha256 })).created, true);
}));
await check("stale state prevents mutation without invoking reconciliation verifier", () => use(async f => {
  const b = await begin(f); let calls = 0; const j = f.make({ verifyReconciliation: async () => { calls++; throw Error("must not run"); } });
  await assert.rejects(j.reconcile({ operationId: b.i.operation_id, expectedStateSha256: OTHER, proof: {} }), /STALE_STATE/u); assert.equal(calls, 0);
}));
await check("state changes during reconciliation cannot commit a stale observation", () => use(async f => {
  const b = await begin(f), before = await f.journal.inspect(), v = verifiers(f.anchor);
  const j = f.make({ verifyReconciliation: async input => {
    const r = await v.verifyReconciliation(input); await f.journal.recordPrepared({ operationId: b.i.operation_id, intentSha256: b.intent_sha256, runner: runner(b.i) }); return r;
  } });
  await assert.rejects(j.reconcile({ operationId: b.i.operation_id, expectedStateSha256: before.state_sha256, proof: {} }), /STALE_STATE/u);
  assert.equal((await f.journal.inspect()).revision, 2);
}));
await check("callback cancellation and late response cannot write reconciliation", () => use(async f => {
  const b = await begin(f), before = await f.journal.inspect(), stop = new AbortController(), v = verifiers(f.anchor); let finish;
  const j = f.make({ verifyReconciliation: input => new Promise(resolve => { finish = async () => resolve(await v.verifyReconciliation(input)); stop.abort(); }) });
  await assert.rejects(j.reconcile({ operationId: b.i.operation_id, expectedStateSha256: before.state_sha256, proof: {} }, { signal: stop.signal }), /CANCELLED/u);
  await finish(); await new Promise(resolve => setImmediate(resolve)); assert.equal((await f.journal.inspect()).revision, 1);
}));
await check("callback deadline remains bounded and ignores a later valid result", () => use(async f => {
  const b = await begin(f), before = await f.journal.inspect(), v = verifiers(f.anchor); let finish;
  const j = f.make({ verifyReconciliation: input => new Promise(resolve => { finish = async () => resolve(await v.verifyReconciliation(input)); }) });
  const began = performance.now(); await assert.rejects(j.reconcile({ operationId: b.i.operation_id, expectedStateSha256: before.state_sha256, proof: {} }), /DEADLINE/u);
  assert.ok(performance.now() - began < 7000); await finish(); await new Promise(resolve => setImmediate(resolve)); assert.equal((await f.journal.inspect()).revision, 1);
}));
await check("aborted call never invokes the host authority or creates files", () => use(async f => {
  const stop = new AbortController(); stop.abort(); let calls = 0;
  await assert.rejects(f.make({ verifyAnchor: () => { calls++; } }).inspect({ signal: stop.signal }), /CANCELLED/u); assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(f.directory), []);
}));
await check("caller mutation while waiting cannot alter the durable intent", () => use(async f => {
  const initial = await f.journal.inspect(), i = intent(), original = clone(i), v = verifiers(f.anchor); let release, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const j = f.make({ verifyAnchor: input => new Promise(resolve => { release = async () => resolve(await v.verifyAnchor(input)); entered(); }) });
  const pending = j.begin({ intent: i, expectedStateSha256: initial.state_sha256 }); await reached; i.configuration_sha256 = OTHER; await release();
  const b = await pending; assert.deepEqual(b.state.operations[0].intent, original);
}));
await check("accessors and unbounded UTF8 data fail without executing getters", () => use(async f => {
  const state = await f.journal.inspect(), i = intent(); let getter = 0;
  Object.defineProperty(i, "configuration_sha256", { get() { getter++; return H; }, enumerable: true });
  assert.throws(() => f.journal.begin({ intent: i, expectedStateSha256: state.state_sha256 }), /JSON_INVALID/u); assert.equal(getter, 0);
  assert.throws(() => f.journal.reconcile({ operationId: "x", expectedStateSha256: state.state_sha256, proof: { text: "é".repeat(600000) } }), /DOCUMENT_LIMIT/u);
}));
await check("extra secret fields and evidence traversal are rejected", () => use(async f => {
  const state = await f.journal.inspect();
  assert.throws(() => f.journal.begin({ intent: { ...intent(), credentials: "never persist" }, expectedStateSha256: state.state_sha256 }), /INTENT_INVALID/u);
  const i = intent(); i.evidence[0].ref = "../secret.json";
  assert.throws(() => f.journal.begin({ intent: i, expectedStateSha256: state.state_sha256 }), /EVIDENCE_INVALID/u);
  assert.deepEqual(fs.readdirSync(f.directory), []);
}));
await check("expired intention cannot create a process claim", () => use(async f => {
  const i = intent(), now = Date.now(); i.created_at = new Date(now - 10000).toISOString(); i.deadline_at = new Date(now - 1000).toISOString();
  await assert.rejects(f.journal.begin({ intent: i, expectedStateSha256: (await f.journal.inspect()).state_sha256 }), /INTENT_EXPIRED/u);
}));
await check("torn and orphan records remain visible and block fresh instances", () => use(async f => {
  fs.writeFileSync(path.join(f.directory, "00000001.json"), "{", { flag: "wx" });
  await assert.rejects(f.make().inspect(), /CORRUPT_RECORD/u); assert.equal(fs.readFileSync(path.join(f.directory, "00000001.json"), "utf8"), "{");
}));
await check("unknown files or missing sequence entries fail closed", () => use(async f => {
  fs.writeFileSync(path.join(f.directory, "00000002.json"), "{}"); await assert.rejects(f.journal.inspect(), /AMBIGUOUS_STATE/u);
}));
await check("content tampering breaks the immutable hash chain", () => use(async f => {
  const b = await prepare(f), filename = path.join(f.directory, "00000001.json"), row = JSON.parse(fs.readFileSync(filename, "utf8")); row.payload.intent.configuration_sha256 = OTHER;
  fs.writeFileSync(filename, JSON.stringify(row)); await assert.rejects(f.make().inspect(), /CHAIN_INVALID/u); assert.ok(b.intent_sha256);
}));
await check("hard-linked journal entries cannot alias another owned file", () => use(async f => {
  const outside = path.join(f.root, "owned-extra.json"); fs.writeFileSync(outside, "{}"); fs.linkSync(outside, path.join(f.directory, "00000001.json"));
  await assert.rejects(f.journal.inspect(), /PATH_INVALID/u);
}));
await check("a renamed journal directory cannot reset its identity", () => use(async f => {
  await begin(f); const moved = path.join(f.root, "old-journal"); fs.renameSync(f.directory, moved); fs.mkdirSync(f.directory);
  // The host verifier is responsible for pinning the root identity across calls.
  const originalIdentity = hash({ device: String(fs.statSync(moved, { bigint: true }).dev), file: String(fs.statSync(moved, { bigint: true }).ino) });
  const v = verifiers(f.anchor), j = f.make({ verifyAnchor: async input => { assert.equal(input.root_identity_sha256, originalIdentity); return v.verifyAnchor(input); } });
  await assert.rejects(j.inspect(), /IO_OR_VERIFIER_FAILURE/u);
}));
await check("two real Node processes compete once with one winner and no overwrites", () => use(async f => {
  const state = await f.journal.inspect(), files = ["left", "right"].map(name => { const file = path.join(f.root, name + ".json"); fs.writeFileSync(file, JSON.stringify({ anchor: f.anchor, intent: intent(name), expectedStateSha256: state.state_sha256 })); return file; });
  const peers = files.map(file => participant(file, "race")); await Promise.all(peers.map(peer => peer.ready)); peers.forEach(peer => peer.child.send({ start: true }));
  const results = await Promise.all(peers.map(peer => peer.closed)); results.forEach(result => { assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null); });
  const messages = results.flatMap(result => result.messages).filter(row => row.status); assert.equal(messages.filter(row => row.status === "PASS" && row.created).length, 1);
  assert.equal(messages.filter(row => row.status === "REFUSED").length, 1); assert.equal((await f.make().inspect()).revision, 1);
}));
for (const mode of ["intent-crash", "prepared-crash", "terminal-crash"]) await check("restart after real fixture process interruption: " + mode, () => use(async f => {
  const before = await f.journal.inspect(), file = path.join(f.root, "participant.json"), i = intent(mode);
  fs.writeFileSync(file, JSON.stringify({ anchor: f.anchor, intent: i, expectedStateSha256: before.state_sha256 }));
  const peer = participant(file, mode); await peer.ready; peer.child.send({ start: true }); const result = await peer.closed; assert.equal(result.code, 23, result.stderr);
  const reopened = await f.make().inspect(); assert.equal(reopened.revision, { "intent-crash": 1, "prepared-crash": 2, "terminal-crash": 3 }[mode]);
  assert.equal(reopened.recovery_required, mode !== "terminal-crash"); assert.equal(reopened.operations[0].intent.request_sha256, i.request_sha256);
}));
await check("failed intent fsync cannot yield ownership or erase its preserved evidence", () => use(async f => {
  const original = fs.fsyncSync; fs.fsyncSync = () => { throw Object.assign(Error("fixture fsync failure"), { code: "EIO" }); };
  try { await assert.rejects(begin(f), /IO_OR_VERIFIER_FAILURE/u); } finally { fs.fsyncSync = original; }
  const reopened = await f.make().inspect(); assert.equal(reopened.revision, 1); assert.equal(reopened.recovery_required, true);
  await assert.rejects(f.journal.recordPrepared({ operationId: reopened.operations[0].intent.operation_id, intentSha256: reopened.operations[0].intent_sha256, runner: runner(reopened.operations[0].intent) }), /OWNER_REQUIRED/u);
}));
await check("partial publication failure is preserved rather than rolled back", () => use(async f => {
  const original = fs.writeFileSync; fs.writeFileSync = (file, bytes, ...args) => {
    if (typeof file === "number") { original(file, Buffer.from("{")); throw Object.assign(Error("fixture partial write"), { code: "EIO" }); }
    return original(file, bytes, ...args);
  };
  try { await assert.rejects(begin(f), /IO_OR_VERIFIER_FAILURE/u); } finally { fs.writeFileSync = original; }
  assert.equal(fs.readFileSync(path.join(f.directory, "00000001.json"), "utf8"), "{");
  await assert.rejects(f.make().inspect(), /CORRUPT_RECORD/u);
}));
await check("pre-existing missing anchor never creates its parent or journal", async () => {
  const f = fixture(); try {
    const absent = path.join(f.root, "not-created", "anchor.json");
    const j = createJournal({ anchor: { ...f.anchor, path: absent }, ...verifiers(f.anchor) });
    await assert.rejects(j.inspect(), /IO_OR_VERIFIER_FAILURE/u); assert.equal(fs.existsSync(path.dirname(absent)), false);
  } finally { f.cleanup(); }
});
await check("read-only import and construction perform no filesystem/provider operations", () => use(async f => {
  const names = ["lstatSync", "readFileSync", "readdirSync", "openSync", "mkdirSync", "writeFileSync"], originals = Object.fromEntries(names.map(name => [name, fs[name]]));
  let calls = 0, loaderReads = 0;
  const modulePath = path.resolve(import.meta.dirname, "../../src/adapters/runtime/codex-managed-setup-operation-journal.mjs");
  try {
    for (const name of names) fs[name] = (...args) => {
      const source = args[0] instanceof URL ? fileURLToPath(args[0]) : args[0];
      if (["openSync", "readFileSync"].includes(name) && typeof source === "string" && path.resolve(source) === modulePath
        && (name === "readFileSync" || args[1] === "r" || args[1] === 0)) { loaderReads++; return originals[name](...args); }
      calls++; throw Error("unexpected filesystem call");
    };
    const loaded = await import("../../src/adapters/runtime/codex-managed-setup-operation-journal.mjs?pure-import-fixture");
    loaded.createCodexManagedSetupOperationJournal({ anchor: f.anchor, ...verifiers(f.anchor) }); assert.equal(calls, 0); assert.ok(loaderReads > 0);
  } finally { for (const name of names) fs[name] = originals[name]; }
}));
const failures = checks.filter(row => row.status === "FAIL");
process.stdout.write(JSON.stringify({ ok: failures.length === 0, checks, totals: { PASS: checks.length - failures.length, FAIL: failures.length, SKIP: 0 },
  evidence: { real_filesystem: true, real_node_participants: true, host_authority: "FIXTURE_DOUBLE", process_and_effect_verifiers: "FIXTURE_DOUBLES", native_setup: "NOT_RUN", providers: "NOT_RUN", postgresql: "NOT_RUN" }, cleanup: children.size === 0 ? "PASS" : "FAIL" }, null, 2) + "\n");
if (failures.length || children.size) process.exitCode = 1;
}
