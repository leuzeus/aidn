import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { createJournaledCodexManagedSetup } from "../../src/application/runtime/journaled-codex-managed-setup.mjs";
import { MANAGED_SETUP_BRIDGE_SOURCE_FILES } from "../../src/adapters/agents/process-tree/codex-managed-setup-bridge.mjs";
import { buildManagedSetupArguments } from "../../src/adapters/agents/codex-managed-setup-transport.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";

const H = "a".repeat(64), OTHER = "b".repeat(64), checks = [], children = new Set();
const self = "src/application/runtime/controlled-codex-managed-setup.mjs";
const repository = path.resolve(import.meta.dirname, "../.."), temporary = fs.realpathSync.native(os.tmpdir());
const bytesHash = bytes => createHash("sha256").update(bytes).digest("hex");
const now = () => new Date().toISOString(), stamp = () => now().replace("Z", "0000Z");
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object"
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const nativePath = Object.fromEntries(["join", "dirname", "normalize", "isAbsolute"].map(k => [k, path[k]]));
const nativeFs = Object.fromEntries(["lstat", "realpath", "open", "readdir"].map(k => [k, fsp[k]]));
const windows = value => typeof value === "string" && /^[CG]:[\\/]/u.test(value);
// Explicit fixture boundary only: synthetic Windows paths/tokens refer to real
// bytes in owned TEMP, while the durable journal uses unmodified synchronous FS.
// No native Windows process, permission, profile or OS isolation is established.
function installTranslation(root) {
  const mapped = value => {
    if (!windows(value)) return value;
    const normal = path.win32.normalize(value), tail = normal.slice(3);
    if (tail && !/^(Candidate|FixtureBin|FixtureState|FixtureProfile|FixtureUser|FixtureWork)(?:\\|$)/u.test(tail)) return value;
    return nativePath.join(root, "material", normal[0], ...tail.split("\\").filter(Boolean));
  };
  if (process.platform !== "win32") {
    path.isAbsolute = value => windows(value) || nativePath.isAbsolute(value);
    path.normalize = value => windows(value) ? path.win32.normalize(value) : nativePath.normalize(value);
    path.dirname = value => windows(value) ? path.win32.dirname(value) : nativePath.dirname(value);
    path.join = (...parts) => windows(parts[0]) ? path.win32.join(...parts) : nativePath.join(...parts);
  }
  for (const name of ["lstat", "open", "readdir"]) fsp[name] = (value, ...args) => nativeFs[name](mapped(value), ...args);
  fsp.realpath = async (value, ...args) => { const target = mapped(value); const real = await nativeFs.realpath(target, ...args); return target !== value ? value : real; };
  return { mapped, restore() { Object.assign(path, nativePath); Object.assign(fsp, nativeFs); } };
}
function fixture({ root: reused = null, mode = null } = {}) {
  const root = reused ?? fs.mkdtempSync(nativePath.join(temporary, "aidn-journaled-setup-")), translation = installTranslation(root);
  const ensureDirectory = dir => fs.mkdirSync(dir, { recursive: true });
  const write = (file, bytes) => { ensureDirectory(nativePath.dirname(file)); if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx" }); };
  for (const directory of ["C:\\", "G:\\", "C:\\Candidate", "C:\\FixtureProfile", "G:\\FixtureWork", "C:\\FixtureState", "C:\\FixtureState\\logs", "C:\\FixtureState\\sqlite"]) ensureDirectory(translation.mapped(directory));
  const sourceInventory = {};
  for (const name of [...MANAGED_SETUP_BRIDGE_SOURCE_FILES, self]) {
    const bytes = fs.readFileSync(nativePath.join(repository, name)); sourceInventory[name] = bytesHash(bytes);
    write(translation.mapped(path.win32.join("C:\\Candidate", name)), bytes);
  }
  function pin(name) { const executable = "C:\\FixtureBin\\" + name; write(translation.mapped(executable), Buffer.from("fixture-only-" + name));
    return { executable, sha256: bytesHash(fs.readFileSync(translation.mapped(executable))) }; }
  const node = pin("node.exe"), powershell = pin("pwsh.exe"), client = pin("codex.exe"), setup = pin("setup.exe"), command_runner = pin("runner.exe"), prerequisites = pin("prerequisites.json");
  const cwd = "G:\\FixtureWork", home = "C:\\FixtureProfile";
  const startup = { state_root: "C:\\FixtureState", mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [],
    permission_scope: { contract_version: "codex-managed-setup-permission-scope.v1", profile_id: "aidn-managed-setup", cwd,
      project_volume_root: "G:\\", user_profile: "C:\\FixtureUser", read_roots: ["C:\\Candidate", "C:\\FixtureBin", "C:\\FixtureState", home],
      write_roots: [cwd], excluded_paths: ["C:\\FixtureUser\\OneDrive"] } };
  const body = { protocol: "aidn-controlled-managed-setup.v2", intent: "execute-managed-setup", invocation_id: "fixture.managed.setup",
    operation_sha256: H, configuration_sha256: H, approval_sha256: H,
    protocol_config: { operation_sha256: H, client_sha256: client.sha256, cwd, expected_codex_home: home,
      limits: { initialize_timeout_ms: 500, setup_timeout_ms: 1000, max_duration_ms: 2000, max_frame_bytes: 8192, max_total_bytes: 65536, max_frames: 16 } },
    node, powershell, job_name: "Local\\aidn-execution-" + "a".repeat(32), candidate_root: "C:\\Candidate", source_inventory: sourceInventory,
    client: { ...client, args: buildManagedSetupArguments(startup) }, sidecars: { setup, command_runner }, cwd, startup,
    env: { CODEX_HOME: home, TEMP: startup.state_root, TMP: startup.state_root, USERPROFILE: startup.permission_scope.user_profile },
    limits: { max_stdout_bytes: 65536, max_stderr_bytes: 16384, max_pending_bytes: 65536, stop_timeout_ms: 500 },
    prerequisites: { reference: prerequisites.executable, sha256: prerequisites.sha256 } };
  const request = { ...body, request_sha256: hash(body) }, journalRoot = nativePath.join(root, "journal"), evidenceRoot = nativePath.join(root, "evidence");
  ensureDirectory(journalRoot); ensureDirectory(evidenceRoot);
  const anchorPath = nativePath.join(root, "anchor.json"), anchorBody = { contract_version: "codex-managed-setup-journal-anchor.v1", host_id: "fixture.host", journal_root: journalRoot, scope: "windows-codex-managed-setup" };
  write(anchorPath, Buffer.from(canonical(anchorBody))); const anchor = { path: anchorPath, sha256: bytesHash(fs.readFileSync(anchorPath)), host_id: "fixture.host" };
  const parentIdentity = { pid: process.pid, started_at: stamp() }, events = [], observations = [], controls = { mode, failRecord: null, block: null }, refs = [];
  let count = 0;
  const token = (identity, job = null) => ({ ...identity, elevated: true, admin_enabled: true, integrity_sid: "S-1-16-12288", elevation_type: 2,
    token_type: 1, has_restrictions: false, restricted_sid_count: 0, is_app_container: false, job_name: job, job_member: job === null ? null : true });
  const entries = () => fs.readdirSync(journalRoot).map(name => JSON.parse(fs.readFileSync(nativePath.join(journalRoot, name), "utf8")));
  const availability = { available: true, helper_sha256: H, source_sha256: H, candidate_sha256: hash(sourceInventory) };
  const dependencies = { anchor, evidenceRoot, parentIdentity, excludedRoots: startup.permission_scope.excluded_paths,
    verifyAnchor: async input => {
      if (controls.mode === "terminal-publication-fails" && entries().some(e => e.event === "prepared") && refs.some(r => r.ref.endsWith("/result.json"))) throw new Error("fixture journal unavailable");
      return { contract_version: "codex-managed-setup-anchor-verification.v1", host_id: anchor.host_id, anchor_sha256: anchor.sha256,
        journal_root: input.journal_root, root_identity_sha256: input.root_identity_sha256, scope: input.scope,
        challenge: input.challenge, observed_at: now(), evidence: [{ ref: "fixture/anchor.json", sha256: H, bytes: 2 }] };
    },
    verifyReconciliation: async () => { throw new Error("No native reconciliation authority exists in this fixture"); },
    recordEvidence: async input => {
      assert(Object.isFrozen(input)); assert(Object.isFrozen(input.document));
      events.push("evidence:" + input.record_id); assert.equal(input.evidence_root, evidenceRoot);
      if (controls.failRecord === input.record_id) throw new Error("fixture persistence refused");
      await controls.block?.(input);
      const bytes = Buffer.from(canonical(input.document)); assert.equal(bytesHash(bytes), input.sha256); assert.equal(bytes.length, input.bytes);
      const ref = `managed-setup/${input.operation_id}/${input.record_id}.json`, file = nativePath.join(evidenceRoot, ...ref.split("/"));
      ensureDirectory(nativePath.dirname(file)); let fd;
      try { fd = fs.openSync(file, "wx"); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
      catch (error) { if (error.code !== "EEXIST") throw error; assert.deepEqual(fs.readFileSync(file), bytes); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
      const receipt = { ref, sha256: bytesHash(bytes), bytes: bytes.length }; refs.push(receipt); return controls.mode === "bad-receipt" ? { ...receipt, sha256: OTHER } : receipt;
    },
    authorizeOperation: async ({ request: req, phase }) => {
      assert(entries().some(e => e.event === "intent")); events.push("authorize:" + phase);
      if (controls.mode === "crash-intent") process.exit(23);
      return { status: controls.mode === "refused" ? "REFUSED" : "AUTHORIZED", request_sha256: req.request_sha256, operation_sha256: req.operation_sha256,
        approval_sha256: req.approval_sha256, configuration_sha256: req.configuration_sha256, effects_adequate: true, expires_at: new Date(Date.now() + 120000).toISOString() };
    },
    compareEffects: async ({ request: req }) => { events.push("effects"); return { status: "MATCHED", operation_sha256: req.operation_sha256, comparison_sha256: H, observed_at: now() }; },
    controller: {
      checkAvailability: async () => { assert(entries().some(e => e.event === "intent")); events.push("availability"); return availability; },
      run: async (input, { onEvent }) => {
        const main = input.runnerId === request.invocation_id, payload = main ? null : JSON.parse(Buffer.from(input.args[6], "base64").toString());
        const label = main ? "main" : payload.phase; events.push("create:" + label); assert(entries().some(e => e.event === "intent"));
        if (!main) assert(refs.some(r => r.ref.endsWith(`/preflight-${payload.phase}-intent.json`)));
        const runner = { runner_id: input.runnerId, pid: 12000 + ++count, started_at: stamp(), job_name: input.jobName,
          executable_sha256: input.executableSha256, helper_sha256: H, source_sha256: H, candidate_sha256: hash(sourceInventory), ...(main ? {} : { helper_pid: 22000 + count }) };
        observations.push({ label, runner });
        const proof = { method: "windows-job-object", active_processes: 0, observed_at: stamp(), ...runner };
        delete proof.executable_sha256;
        if (!main && controls.mode === "unknown-auxiliary") return { outcome: "failed", reason_code: "PROCESS_FAILED", exit_code: 1, signal: null, termination_state: "unknown", runner: null, termination_proof: null };
        try { await onEvent({ type: "prepared", ...runner, suspended: true, job_assigned: true }); }
        catch { return { outcome: "failed", reason_code: "PROCESS_CALLBACK_FAILED", exit_code: 125, signal: null, termination_state: "confirmed", runner, termination_proof: proof }; }
        if (main) { assert(entries().some(e => e.event === "prepared")); if (controls.mode === "crash-prepared") process.exit(23); }
        events.push("resume:" + label);
        const out = main ? { protocol: request.protocol, invocation_id: request.invocation_id, request_sha256: request.request_sha256,
          operation_sha256: request.operation_sha256, ok: true, result: { channel: { protocol: { phase: "completion_observed" }, reported_setup_result: "succeeded", reason_code: null, stop_reason_code: null, stdout_eof: true, outcome: "indeterminate" },
            transport: { closed: true, forced: false, stdout_ended: true, exit_code: 0, signal: null, reason_code: null }, preflight: { target: token({ pid: runner.pid, started_at: runner.started_at }, request.job_name) } } }
          : { contract_version: "aidn-managed-setup-preflight.v1", request_sha256: request.request_sha256, phase: payload.phase, observed_at: now(), status: "OBSERVED",
            launcher: token(parentIdentity), target: payload.target ? token({ pid: payload.target.pid, started_at: payload.target.started_at }, payload.target.job_name) : null,
            helpers: { complete: true, rows: [] }, errors: [] };
        const bytes = Buffer.from(JSON.stringify(out)); await onEvent({ type: "stdout", bytes });
        return { outcome: "completed", reason_code: "PROCESS_EXITED", exit_code: 0, signal: null, termination_state: "confirmed", runner, termination_proof: proof,
          hashes: { ...availability, executable_sha256: input.executableSha256, stdout_sha256: bytesHash(bytes), stderr_sha256: bytesHash(Buffer.alloc(0)) }, bytes: { stdout: bytes.length, stderr: 0 } };
      },
    },
  };
  const options = { operationId: "fixture.operation", manifestSha256: H, inventorySha256: H, maxDurationMs: 15000, execute: true, expectRequestSha256: request.request_sha256 };
  const f = { root, request, dependencies, options, events, observations, refs, controls, entries, journalRoot, evidenceRoot,
    make: overrides => createJournaledCodexManagedSetup({ ...dependencies, ...overrides }), restore: translation.restore };
  f.cleanup = () => { translation.restore(); assert.equal(children.size, 0); assert.equal(fs.realpathSync.native(nativePath.dirname(root)), temporary);
    assert(path.basename(root).startsWith("aidn-journaled-setup-")); fs.rmSync(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 }); assert(!fs.existsSync(root)); };
  return f;
}
async function use(fn) { const f = fixture(); try { await fn(f); } finally { f.cleanup(); } }
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); } catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 1500) }); } }
const previewOptions = f => Object.fromEntries(["operationId", "manifestSha256", "inventorySha256", "maxDurationMs"].map(k => [k, f.options[k]]));

if (process.argv[2] === "--participant") {
  const f = fixture({ root: process.argv[3], mode: process.argv[4] });
  const result = await f.make().run(f.request, f.options);
  if (process.argv[4] === "crash-terminal" && result.outcome === "completed") process.exit(23);
  process.send?.({ outcome: result.outcome, reason: result.reason_code }); f.restore(); process.exit(result.outcome === "completed" ? 0 : 1);
} else {
  await check("construction and preview have no filesystem or authority effects", () => use(f => {
    const traps = ["lstatSync", "readFileSync", "readdirSync", "openSync"], old = Object.fromEntries(traps.map(k => [k, fs[k]]));
    try { for (const k of traps) fs[k] = () => { throw new Error("unexpected constructor I/O"); };
      const result = f.make().preview(f.request, previewOptions(f)); assert.equal(result.execution_available, false); assert.equal(result.status, "PREPARED_NOT_AUTHORIZED"); assert.deepEqual(f.events, []);
    } finally { Object.assign(fs, old); }
  }));
  await check("production does not accept inspectMaterial or an injected preflight bypass", () => use(f => {
    assert.throws(() => f.make({ inspectMaterial() {} }), /DEPENDENCIES_REQUIRED/u); assert.throws(() => f.make({ preflight() {} }), /DEPENDENCIES_REQUIRED/u);
    for (const key of ["recordEvidence", "authorizeOperation", "compareEffects", "verifyAnchor", "verifyReconciliation"]) assert.throws(() => f.make({ [key]: undefined }), /DEPENDENCIES_REQUIRED/u);
  }));
  await check("legacy permissions and explicit execution are refused before journal I/O", () => use(async f => {
    const old = structuredClone(f.request); delete old.startup.permission_scope; old.client.args = buildManagedSetupArguments(old.startup);
    const { request_sha256: ignored, ...body } = old; old.request_sha256 = hash(body);
    await assert.rejects(f.make().run(old, { ...f.options, expectRequestSha256: old.request_sha256 }), /NAMED_PERMISSION_REQUIRED/u);
    await assert.rejects(f.make().run(f.request, { ...f.options, execute: false }), /EXPLICIT_INTENT_REQUIRED/u); assert.deepEqual(f.entries(), []); assert.deepEqual(f.events, []);
  }));
  await check("cloud anchor and evidence roots refused before any filesystem access", () => use(f => {
    for (const key of ["anchor", "evidenceRoot"]) assert.throws(() => f.make(key === "anchor" ? { anchor: { ...f.dependencies.anchor, path: "C:\\FixtureUser\\OneDrive\\anchor.json" } }
      : { evidenceRoot: "C:\\FixtureUser\\OneDrive\\evidence" }), /AGENT_CLOUD_PATH_EXCLUDED/u);
    assert.deepEqual(f.events, []);
  }));
  await check("closed dependencies and run options reject accessors without evaluating them", () => use(async f => {
    let invoked = 0; const bad = { ...f.dependencies }; Object.defineProperty(bad, "recordEvidence", { enumerable: true, get() { invoked++; return f.dependencies.recordEvidence; } });
    assert.throws(() => createJournaledCodexManagedSetup(bad), /DEPENDENCIES_REQUIRED/u);
    const options = { ...f.options }; Object.defineProperty(options, "operationId", { enumerable: true, get() { invoked++; return f.options.operationId; } });
    await assert.rejects(f.make().run(f.request, options), /OPTIONS_INVALID/u); assert.equal(invoked, 0); assert.deepEqual(f.events, []);
  }));
  await check("fixed exclusions cannot be changed through the request or caller array", () => use(f => {
    const roots = [...f.dependencies.excludedRoots], service = f.make({ excludedRoots: roots }); roots.push("C:\\FixtureBin");
    assert.equal(service.preview(f.request, previewOptions(f)).status, "PREPARED_NOT_AUTHORIZED");
    const changed = structuredClone(f.request); changed.startup.permission_scope.excluded_paths.push("C:\\ExtraExcluded");
    changed.client.args = buildManagedSetupArguments(changed.startup); const { request_sha256: ignored, ...body } = changed; changed.request_sha256 = hash(body);
    assert.throws(() => service.preview(changed, previewOptions(f)), /EXCLUSIONS_MISMATCH/u); assert.deepEqual(f.events, []);
  }));
  await check("PATH is a bounded list while PATHEXT is not interpreted as a path", () => use(f => {
    const changed = structuredClone(f.request); changed.env.PATH = "C:\\FixtureBin;C:\\Candidate"; changed.env.PATHEXT = ".COM;.EXE;.BAT";
    const seal = () => { const { request_sha256: ignored, ...body } = changed; changed.request_sha256 = hash(body); };
    seal(); assert.equal(f.make().preview(changed, previewOptions(f)).status, "PREPARED_NOT_AUTHORIZED");
    changed.env.PATH += ";C:\\FixtureUser\\OneDrive\\bin"; seal(); assert.throws(() => f.make().preview(changed, previewOptions(f)), /AGENT_CLOUD_PATH_EXCLUDED/u);
    assert.deepEqual(f.events, []);
  }));
  for (const name of ["LOCALAPPDATA", "APPDATA", "PROGRAMDATA"]) for (const excluded of ["C:\\FixtureUser\\OneDrive", "C:\\FixtureUser\\RenamedExcluded"]) {
    await check("preview rejects excluded environment pointer " + name + " " + (excluded.endsWith("OneDrive") ? "standard" : "configured"), () => use(f => {
      const changed = structuredClone(f.request), roots = [...changed.startup.permission_scope.excluded_paths];
      if (!roots.includes(excluded)) roots.push(excluded);
      changed.startup.permission_scope.excluded_paths = roots; changed.env[name] = excluded + "\\unobserved";
      changed.client.args = buildManagedSetupArguments(changed.startup);
      const { request_sha256: ignored, ...body } = changed; changed.request_sha256 = hash(body);
      assert.throws(() => f.make({ excludedRoots: roots }).preview(changed, previewOptions(f)), { code: "AGENT_CLOUD_PATH_EXCLUDED" });
      assert.deepEqual(f.events, []); assert.deepEqual(f.entries(), []);
    }));
  }
  await check("real journal preserves initial intent before three controlled process doubles", () => use(async f => {
    const before = structuredClone(f.request), service = f.make(), result = await service.run(f.request, f.options);
    assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.recovery_required, false); assert.equal(result.journal.terminal_recorded, true);
    assert.deepEqual(f.entries().map(e => e.event), ["intent", "prepared", "terminal"]); assert.deepEqual(f.request, before);
    assert.deepEqual(f.observations.map(v => v.label), ["before_create", "main", "before_resume"]);
    assert(f.events.indexOf("evidence:main-prepared") < f.events.indexOf("resume:main"));
    assert.equal(result.result.bridge.result.channel.outcome, "indeterminate"); assert.equal(result.native_qualified, false);
    assert.equal((await service.inspect()).recovery_required, false);
    const receipt = result.journal.evidence.find(r => r.ref.endsWith("/result.json")); const bytes = fs.readFileSync(nativePath.join(f.evidenceRoot, receipt.ref));
    assert.equal(bytesHash(bytes), receipt.sha256); assert.equal(bytes.length, receipt.bytes); assert.deepEqual(JSON.parse(bytes).result, result.result);
  }));
  await check("settled replay cannot launch after reconstruction", () => use(async f => {
    assert.equal((await f.make().run(f.request, f.options)).outcome, "completed"); const count = f.observations.length;
    const replay = await f.make().run(f.request, f.options); assert.equal(replay.reason_code, "MANAGED_SETUP_DURABLE_REPLAY_FORBIDDEN"); assert.equal(f.observations.length, count);
  }));
  await check("refusal before auxiliary creation is retained then durably terminal", () => use(async f => {
    f.controls.mode = "refused"; const result = await f.make().run(f.request, f.options); assert.equal(result.outcome, "refused"); assert.equal(result.recovery_required, false);
    assert.deepEqual(f.entries().map(e => e.event), ["intent", "terminal"]); assert.equal(f.observations.length, 0); assert(result.journal.evidence.some(r => r.ref.endsWith("/result.json")));
  }));
  await check("unknown auxiliary tree leaves open intent despite main not_started", () => use(async f => {
    f.controls.mode = "unknown-auxiliary"; const result = await f.make().run(f.request, f.options);
    assert.equal(result.outcome, "indeterminate"); assert.equal(result.result.tree_termination.state, "not_started"); assert.equal(result.result.preflight_recovery.termination_state, "unknown");
    assert.equal(result.recovery_required, true); assert.deepEqual(f.entries().map(e => e.event), ["intent"]);
    assert(f.refs.some(r => r.ref.endsWith("/preflight-before_create-terminal.json"))); assert(f.refs.some(r => r.ref.endsWith("/result.json")));
    const count = f.observations.length; const replay = await f.make().run(f.request, f.options); assert.equal(replay.recovery_required, true); assert.equal(f.observations.length, count);
  }));
  for (const record of ["request", "preflight-before_create-intent", "preflight-before_create-prepared", "preflight-before_create-terminal", "main-prepared", "preflight-before_resume-intent", "result"]) {
    await check("immutable sink failure quarantines at " + record, () => use(async f => {
      f.controls.failRecord = record; const result = await f.make().run(f.request, f.options); assert.notEqual(result.outcome, "completed"); assert.equal(result.recovery_required, true);
      assert(!f.entries().some(e => e.event === "terminal"));
      if (["request", "preflight-before_create-intent"].includes(record)) assert.equal(f.observations.length, 0);
      if (["main-prepared", "preflight-before_resume-intent"].includes(record)) assert(!f.events.includes("resume:main"));
      if (record !== "request") { const count = f.observations.length; assert.equal((await f.make().run(f.request, f.options)).recovery_required, true); assert.equal(f.observations.length, count); }
    }));
  }
  await check("forged receipt refuses before durable intent and any process", () => use(async f => {
    f.controls.mode = "bad-receipt"; const result = await f.make().run(f.request, f.options); assert.equal(result.reason_code, "MANAGED_SETUP_DURABLE_EVIDENCE_RECEIPT_INVALID"); assert.deepEqual(f.entries(), []); assert.equal(f.observations.length, 0);
  }));
  await check("terminal publication failure preserves full result and blocks reconstruction", () => use(async f => {
    f.controls.mode = "terminal-publication-fails"; const result = await f.make().run(f.request, f.options); assert.equal(result.outcome, "indeterminate"); assert.equal(result.result.outcome, "completed");
    assert(f.refs.some(r => r.ref.endsWith("/result.json"))); assert.deepEqual(f.entries().map(e => e.event), ["intent", "prepared"]);
    f.controls.mode = null; assert.equal((await f.make().inspect()).recovery_required, true);
  }));
  await check("two recreated parents contend on the same real journal with only one launch", () => use(async f => {
    const results = await Promise.all([f.make().run(f.request, f.options), f.make().run(f.request, f.options)]);
    assert.equal(results.filter(r => r.outcome === "completed").length, 1, JSON.stringify(results)); assert.equal(f.observations.length, 3);
    assert.deepEqual(f.entries().map(e => e.event), ["intent", "prepared", "terminal"]);
  }));
  await check("pre-aborted work cannot create journal or evidence", () => use(async f => {
    const abort = new AbortController(); abort.abort(); await assert.rejects(f.make().run(f.request, { ...f.options, signal: abort.signal }), /CANCELLED/u);
    assert.deepEqual(f.entries(), []); assert.deepEqual(f.events, []);
  }));
  await check("late auxiliary sink completion never resumes or closes an unknown operation", () => use(async f => {
    f.options.maxDurationMs = 1500; let late;
    f.controls.block = input => {
      if (input.record_id === "preflight-before_create-prepared") return late = new Promise(resolve => setTimeout(resolve, 2000));
    };
    const service = f.make(), result = await service.run(f.request, f.options);
    assert.equal(result.outcome, "indeterminate"); assert.equal(result.recovery_required, true); assert.equal(result.journal.terminal_recorded, false);
    await late; await new Promise(resolve => setTimeout(resolve, 50));
    assert(!f.events.includes("resume:before_create")); assert(!f.events.includes("create:main")); assert.deepEqual(f.entries().map(e => e.event), ["intent"]);
    assert.equal((await f.make().inspect()).recovery_required, true);
  }));
  await check("caller cancellation during auxiliary persistence leaves intent open", () => use(async f => {
    const abort = new AbortController(); f.controls.block = async input => { if (input.record_id === "preflight-before_create-prepared") abort.abort(); };
    const result = await f.make().run(f.request, { ...f.options, signal: abort.signal });
    assert.equal(result.outcome, "indeterminate"); assert.equal(result.recovery_required, true); assert.deepEqual(f.entries().map(e => e.event), ["intent"]);
    assert(!f.events.includes("resume:before_create")); assert(!f.events.includes("create:main"));
  }));
  for (const mode of ["crash-intent", "crash-prepared", "crash-terminal"]) await check("process crash remains durable across fresh parent: " + mode, () => use(async f => {
    f.restore(); const child = fork(import.meta.filename, ["--participant", f.root, mode], { execPath: process.execPath, execArgv: [], windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.add(child);
    let stderr = "", output = ""; child.stderr.on("data", bytes => { stderr += bytes.toString(); if (stderr.length > 4096) child.kill(); }); child.stdout.on("data", bytes => { output += bytes.toString(); });
    const timer = setTimeout(() => child.kill(), 20000);
    const closed = await new Promise(resolve => child.once("close", (code, signal) => { clearTimeout(timer); children.delete(child); resolve({ code, signal }); }));
    installTranslation(f.root); assert.equal(closed.code, 23, stderr + output); assert.equal(closed.signal, null); assert.equal(stderr, "");
    const state = await f.make().inspect(); assert.equal(state.recovery_required, mode !== "crash-terminal");
    assert.deepEqual(f.entries().map(e => e.event), mode === "crash-intent" ? ["intent"] : mode === "crash-prepared" ? ["intent", "prepared"] : ["intent", "prepared", "terminal"]);
    const replay = await f.make().run(f.request, f.options); assert.equal(replay.reason_code, "MANAGED_SETUP_DURABLE_REPLAY_FORBIDDEN"); assert.equal(f.observations.length, 0);
  }));
  console.log(JSON.stringify({ status: checks.some(c => c.status === "FAIL") ? "FAIL" : "PASS", checks, count: checks.length, cleanup: children.size === 0 ? "PASS" : "FAIL",
    journal: "REAL_LOCAL_WX_FSYNC", material: "TEMP_BYTES_WITH_SYNTHETIC_WINDOWS_PATH_TRANSLATION", process_authority: "DOUBLES", native: "NOT_RUN" }, null, 2));
  process.exitCode = checks.some(c => c.status === "FAIL") ? 1 : 0;
}
