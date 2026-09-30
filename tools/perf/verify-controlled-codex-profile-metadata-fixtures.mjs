import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { runCodexProfileMetadataBridge } from "../../src/adapters/agents/process-tree/codex-profile-metadata-bridge.mjs";
import { createControlledCodexProfileMetadata } from "../../src/application/runtime/controlled-codex-profile-metadata.mjs";
import { createWindowsProcessTreeController } from "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs";
import { buildAgentProcessHelper } from "../verify/build-agent-process-helper.mjs";

const native = process.argv.includes("--native");
if (process.argv.slice(2).some(value => value !== "--native")) throw new Error("PROFILE_TREE_FIXTURE_ARGUMENT_INVALID");
const checks = [], hash = content => createHash("sha256").update(content).digest("hex");
const check = async (name, action) => { await action(); checks.push({ name, status: "PASS" }); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const absent = pid => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === "ESRCH"; } };
const source = path.resolve(import.meta.dirname, "../.."), BRIDGE = "src/adapters/agents/process-tree/codex-profile-metadata-bridge.mjs";
let root, token, unresolved = false;
try {
  if (native && (process.platform !== "win32" || process.arch !== "x64")) throw new Error("PROFILE_TREE_PROCESS_PLATFORM_UNAVAILABLE");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-profile-tree-")); token = randomUUID(); fs.writeFileSync(path.join(root, "owner"), token, { flag: "wx" });
  const candidateRoot = path.join(root, "candidate espace Ã©tÃ©"), cwd = path.join(root, "workspace"); fs.mkdirSync(candidateRoot); fs.mkdirSync(cwd);
  // Minimal exact candidate fixture contains real production modules and schemas.
  const selected = [BRIDGE, "src/application/runtime/controlled-codex-profile-metadata.mjs", "src/application/runtime/codex-native-profile-observation-service.mjs",
    "src/adapters/agents/codex-native-profile-policy.mjs", "src/adapters/agents/codex-metadata-rpc-diagnostic.mjs", "src/core/agents/codex-startup-arguments.mjs", "src/core/agents/agent-execution-contracts.mjs", "src/core/agents/agent-local-path-policy.mjs", "src/core/contracts/json-schema-validator.mjs",
    ...fs.readdirSync(path.join(source, "src/core/contracts/agent-execution")).filter(name => name.endsWith(".json")).map(name => `src/core/contracts/agent-execution/${name}`)];
  for (const relative of selected) { const target = path.join(candidateRoot, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, relative), target); }
  const candidateInventory = Object.fromEntries(selected.map(name => [name, hash(fs.readFileSync(path.join(candidateRoot, name)))]));
  const nodeRuntime = { executable: process.execPath, sha256: hash(fs.readFileSync(process.execPath)) };
  const helper = native ? buildAgentProcessHelper({ outputDir: path.join(root, "helper"), compilerPath: "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" }) : { helper_sha256: "1".repeat(64), source_sha256: "2".repeat(64) };
  const controller = native ? createWindowsProcessTreeController({ helperPath: helper.helper_path, helperSha256: helper.helper_sha256,
    helperSourceSha256: helper.source_sha256, candidateSha256: hash(fs.readFileSync(path.join(source, "src/adapters/agents/process-tree/windows-process-tree-controller.mjs"))) }) : {
    async checkAvailability() { return { available: true, helper_sha256: helper.helper_sha256, source_sha256: helper.source_sha256,
      candidate_sha256: hash(fs.readFileSync(path.join(source, "src/adapters/agents/process-tree/windows-process-tree-controller.mjs"))) }; },
    run() { throw new Error("PURE_FIXTURE_MUST_NOT_LAUNCH"); },
  };
  const base = { controller, nodeRuntime, candidateRoot, candidateInventory }, env = { ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}), TEMP: cwd, TMP: cwd };
  const server = path.join(root, "fake-app-server.mjs");
  fs.writeFileSync(server, `import fs from 'node:fs';import readline from 'node:readline';import {spawn} from 'node:child_process';
const [mode,sentinel]=process.argv.slice(2);let started=false;
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{const request=JSON.parse(line);if(!request.id)return;
if(!started){started=true;if(['descendant','timeout','cancel'].includes(mode)){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});child.unref();fs.writeFileSync(sentinel,JSON.stringify({parent:process.pid,descendant:child.pid}),{flag:'wx'});}}
if(['timeout','cancel'].includes(mode))return;
const result=request.method==='config/read'?{configuration:'fixture',environment_keys:Object.keys(process.env).sort()}:request.method==='hooks/list'?{data:[]}:{status:'fixture'};
process.stdout.write(JSON.stringify({id:request.id,result})+'\\n');});
lines.on('close',()=>process.exit(0));`);
  const input = (mode = "normal", signal) => ({ executable: process.execPath, args: [server, mode, path.join(root, mode + ".pids.json")], cwd, env, roots: [{ role: "worker-a", root: cwd }], signal });
  const allPids = [];
  async function real(mode, { timeoutMs = 10000, signal, wrapper } = {}) {
    const collect = createControlledCodexProfileMetadata({ ...base, controller: wrapper ?? controller });
    try { const result = await collect(input(mode, signal), { timeoutMs }); return { result }; }
    catch (error) { if (error.process?.tree_termination?.termination_state === "unknown") unresolved = true; return { error }; }
    finally { const file = path.join(root, mode + ".pids.json"); if (fs.existsSync(file)) allPids.push(...Object.values(JSON.parse(fs.readFileSync(file)))); }
  }
  await check("construction performs no IO or process with explicit pins", () => {
    let calls = 0; const before = fs.readdirSync(root);
    const collect = createControlledCodexProfileMetadata({ ...base, candidateRoot: path.join(root, "absent"), controller: { checkAvailability() { calls++; }, run() { calls++; } } });
    assert.equal(typeof collect, "function"); assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(root), before);
  });
  await check("explicit source and Node pins required; injected environment rejected", async () => {
    assert.throws(() => createControlledCodexProfileMetadata({ ...base, candidateInventory: {} }));
    let calls = 0; const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability() { calls++; }, run() { calls++; } } });
    await assert.rejects(collect({ ...input(), env: { ...env, NODE_OPTIONS: '--import forbidden' } }), { code: "PROFILE_TREE_INPUT_INVALID" });
    assert.equal(calls, 0);
  });
  await check("pre-cancellation proves not started without native discovery", async () => {
    const stop = new AbortController(); stop.abort(); let calls = 0;
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability() { calls++; }, run() { calls++; } } });
    await assert.rejects(collect(input("normal", stop.signal)), error => error.process.tree_termination.termination_state === "not_started"); assert.equal(calls, 0);
  });
  await check("changed candidate and executable rejected before controller", async () => {
    let calls = 0; const dormant = { checkAvailability() { calls++; }, run() { calls++; } };
    const collect = createControlledCodexProfileMetadata({ ...base, controller: dormant, nodeRuntime: { ...nodeRuntime, sha256: "0".repeat(64) } });
    await assert.rejects(collect(input()), { code: "PROFILE_TREE_NODE_CHANGED" });
    const file = path.join(candidateRoot, BRIDGE), saved = fs.readFileSync(file); fs.appendFileSync(file, '\n// modified fixture');
    try { await assert.rejects(createControlledCodexProfileMetadata({ ...base, controller: dormant })(input()), { code: "PROFILE_TREE_CANDIDATE_CHANGED" }); }
    finally { fs.writeFileSync(file, saved); }
    assert.equal(calls, 0);
  });
  await check("unsettled availability is bounded and launches no process", async () => {
    let calls = 0; const began = performance.now();
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: () => new Promise(() => {}), run() { calls++; } } });
    await assert.rejects(collect(input(), { timeoutMs: 3000 }), error => ['PROFILE_TREE_TIMEOUT','PROFILE_TREE_CANCELLED'].includes(error.code));
    assert(performance.now() - began < 4000); assert.equal(calls, 0);
  });
  function completed(request, mutate = value => value) {
    const pins = { helper_sha256: helper.helper_sha256, source_sha256: helper.source_sha256,
      candidate_sha256: hash(fs.readFileSync(path.join(source, "src/adapters/agents/process-tree/windows-process-tree-controller.mjs"))) };
    const runner = { runner_id: request.runnerId, pid: 777, started_at: "2026-01-01T00:00:00Z", job_name: "Local\\aidn-execution-" + "a".repeat(32), executable_sha256: nodeRuntime.sha256, ...pins };
    return mutate({ outcome: "completed", reason_code: "PROCESS_COMPLETED", termination_state: "confirmed", exit_code: 0, runner,
      termination_proof: { method: "windows-job-object", runner_id: runner.runner_id, pid: runner.pid, started_at: runner.started_at,
        job_name: runner.job_name, active_processes: 0, observed_at: "2026-01-01T00:00:00Z", ...pins } });
  }
  function metadataEnvelope(request, result) {
    const { request_sha256, ...body } = JSON.parse(request.stdin);
    assert.equal(request_sha256, fingerprint(body));
    return { protocol: body.protocol, invocation_id: body.invocation_id, request_sha256, ok: true, result };
  }
  function metadataResult() { return { configs: [{}], hooks: { data: [] }, readiness: { status: "updateRequired" },
    process: { closed: true, pid_absent: true, exit_code: 0, signal: null, response_count: 4, budget_ms: 10000 } }; }
  await check("prepared material preserves exact provenance, worker protocol and response count", async () => {
    let calls = 0, prepared = 0, requestSha; const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) { calls++; const document = JSON.parse(request.stdin); requestSha = document.request_sha256;
        assert.equal(document.protocol, "aidn-controlled-profile-metadata.v1");
        assert.equal(Object.hasOwn(document.input, "metadataProfile"), false);
        await options.onEvent({ type: "prepared" }); prepared++;
        await options.onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(metadataEnvelope(request, metadataResult()))) }); return completed(request); } } });
    const result = await collect(input()), evidence = result.process.tree_termination;
    assert.equal(result.process.response_count, 4); assert.equal(result.process.budget_ms, 10000); assert.equal(Object.hasOwn(result, "requirements"), false);
    assert.equal(evidence.termination_state, "confirmed"); assert.equal(calls, 1); assert.equal(prepared, 1);
    assert.equal(evidence.bridge_sha256, candidateInventory[BRIDGE]);
    assert.equal(evidence.collector_sha256, candidateInventory["src/application/runtime/codex-native-profile-observation-service.mjs"]);
    assert.equal(evidence.candidate_inventory_sha256, fingerprint(candidateInventory)); assert.equal(evidence.request_sha256, requestSha);
  });
  for (const variant of ["content", "addition", "removal", "node"]) await check("prepared material refuses " + variant + " drift before bridge resume with original code and Job0", async () => {
    const sentinelName = "prepared-material.fixture", sentinel = path.join(candidateRoot, sentinelName);
    const added = path.join(candidateRoot, "unlisted-prepared.fixture"), fakeNode = path.join(root, "prepared-node.fixture");
    fs.writeFileSync(sentinel, "original bytes\n", { flag: "wx" });
    const preparedInventory = { ...candidateInventory, [sentinelName]: hash(fs.readFileSync(sentinel)) };
    if (variant === "node") fs.writeFileSync(fakeNode, "original node\n", { flag: "wx" });
    const runtime = variant === "node" ? { executable: fakeNode, sha256: hash(fs.readFileSync(fakeNode)) } : nodeRuntime;
    let callbacks = 0, resumed = false, callbackCode = null;
    const expectedCode = variant === "node" ? "PROFILE_TREE_NODE_CHANGED" : "PROFILE_TREE_CANDIDATE_CHANGED";
    const collect = createControlledCodexProfileMetadata({ ...base, nodeRuntime: runtime, candidateInventory: preparedInventory,
      controller: { checkAvailability: controller.checkAvailability, async run(request, options) {
        if (variant === "content") {
          const before = fs.statSync(sentinel);
          fs.writeFileSync(sentinel, "modified bytes\n"); // Same length; content remains authoritative.
          fs.utimesSync(sentinel, before.atime, before.mtime);
        } else if (variant === "addition") fs.writeFileSync(added, "unexpected\n", { flag: "wx" });
        else if (variant === "removal") fs.unlinkSync(sentinel);
        else fs.writeFileSync(fakeNode, "modified node\n");
        try { callbacks++; await options.onEvent({ type: "prepared" }); resumed = true; }
        catch (error) { callbackCode = error.code; }
        return completed(request, value => ({ ...value, outcome: "failed", reason_code: "PROCESS_CALLBACK_FAILED",
          runner: { ...value.runner, executable_sha256: runtime.sha256 } }));
      } },
    });
    try {
      await assert.rejects(collect(input()), error => error.code === expectedCode
        && error.process.tree_termination.termination_state === "confirmed"
        && error.process.tree_termination.proof.active_processes === 0);
      assert.equal(callbacks, 1); assert.equal(callbackCode, expectedCode); assert.equal(resumed, false);
    } finally {
      for (const file of [sentinel, added, ...(variant === "node" ? [fakeNode] : [])]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
  for (const [reason, expectedCode] of [
    ["PROCESS_CALLBACK_FAILED", "PROFILE_TREE_BRIDGE_DIAGNOSTIC"],
    ["PROCESS_TIMEOUT", "PROFILE_TREE_TIMEOUT"],
    ["PROCESS_CANCELLED", "PROFILE_TREE_CANCELLED"],
  ]) await check("confirmed " + reason + " preserves stop priority after callback failures", async () => {
    const errors = [];
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) {
        for (const event of [{ type: "stderr", bytes: Buffer.from("fixture diagnostic") }, { type: "stdout", bytes: "invalid" }]) {
          try { await options.onEvent(event); } catch (error) { errors.push(error.code); }
        }
        return completed(request, value => ({ ...value, outcome: "failed", reason_code: reason }));
      } } });
    await assert.rejects(collect(input()), error => error.code === expectedCode
      && error.process.tree_termination.termination_state === "confirmed"
      && error.process.tree_termination.proof.active_processes === 0);
    assert.deepEqual(errors, ["PROFILE_TREE_BRIDGE_DIAGNOSTIC", "PROFILE_TREE_PROTOCOL_INVALID"]);
  });
  for (const variant of ["count", "requirements", "version"]) await check("worker parent refuses obsolete metadata response " + variant + " despite Job0", async () => {
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) { const result = metadataResult(); if (variant === "count") result.process.response_count = 5;
        if (variant === "requirements") result.requirements = { requirements: null };
        const envelope = metadataEnvelope(request, result); if (variant === "version") envelope.protocol = "aidn-controlled-profile-metadata.v2";
        await options.onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(envelope)) }); return completed(request); } } });
    await assert.rejects(collect(input()), error => error.process.tree_termination.termination_state === "confirmed");
  });
  for (const invalid of [null, "unknown", undefined, "managed-setup.v1", "managed-setup.v2"]) await check("parent refuses explicit metadata profile before controller " + String(invalid), async () => {
    let calls = 0; const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability() { calls++; }, run() { calls++; } } });
    await assert.rejects(collect({ ...input(), metadataProfile: invalid }), { code: "PROFILE_METADATA_PROFILE_INVALID" }); assert.equal(calls, 0);
  });
  await check("bridge import is inert and injected collection preserves worker metadata", async () => {
    const { signal, ...plain } = input();
    const body = { protocol: "aidn-controlled-profile-metadata.v1", invocation_id: "fixture", input: plain, timeout_ms: 10000 }; let calls = 0;
    const result = await runCodexProfileMetadataBridge({ ...body, request_sha256: fingerprint(body) }, { collect: async (request, options) => {
      calls++; assert.equal(Object.hasOwn(request, "metadataProfile"), false); assert.equal(options.timeoutMs, 10000); return metadataResult(); } });
    assert.equal(result.ok, true); assert.equal(calls, 1); assert.equal(result.protocol, body.protocol);
  });
  const rpcDiagnostic = { version: 1, kind: "notification", method_type: "string", method: "thread/started",
    method_sha256: null, id_type: "absent", phase: "awaiting_response", expected_method: "initialize", request_index: 1 };
  for (const invalid of [false, true]) await check("bridge and parent retain only a valid RPC diagnostic, invalid=" + invalid, async () => {
    let envelope;
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) {
        envelope = await runCodexProfileMetadataBridge(JSON.parse(request.stdin), { collect: async () => {
          throw Object.assign(new Error("synthetic-private-error"), { code: "PROFILE_METADATA_UNEXPECTED_RPC",
            process: { ...metadataResult().process, exit_code: 1, response_count: 0 },
            details: { unrelated: "synthetic-private-details", metadata_rpc: invalid ? { ...rpcDiagnostic, params: "synthetic-private-param" } : rpcDiagnostic } });
        } });
        assert.equal(JSON.stringify(envelope).includes("synthetic-private"), false);
        if (invalid) assert.equal(Object.hasOwn(envelope.error, "details"), false);
        else assert.deepEqual(envelope.error.details, { metadata_rpc: rpcDiagnostic });
        // Exercise the parent sanitizer independently from the already sanitized bridge.
        if (invalid) envelope.error.details = { metadata_rpc: { ...rpcDiagnostic, id: "synthetic-private-id" } };
        await options.onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(envelope)) });
        return completed(request, value => ({ ...value, outcome: "failed", reason_code: "PROCESS_EXITED", exit_code: 1 }));
      } } });
    const error = await collect(input()).catch(error => error);
    assert.equal(error.code, "PROFILE_METADATA_UNEXPECTED_RPC"); assert.equal(error.process.tree_termination.termination_state, "confirmed");
    if (invalid) assert.equal(Object.hasOwn(error, "details"), false);
    else assert.deepEqual(error.details, { metadata_rpc: rpcDiagnostic });
    assert.equal(JSON.stringify(error).includes("synthetic-private"), false);
  });
  for (const reason of ["PROCESS_TIMEOUT", "PROCESS_CANCELLED"]) await check("RPC diagnostic never overrides " + reason, async () => {
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) {
        const envelope = metadataEnvelope(request, metadataResult());
        delete envelope.result; envelope.ok = false;
        envelope.error = { code: "PROFILE_METADATA_UNEXPECTED_RPC", process: metadataResult().process, details: { metadata_rpc: rpcDiagnostic } };
        await options.onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(envelope)) });
        return completed(request, value => ({ ...value, outcome: "failed", reason_code: reason }));
      } } });
    await assert.rejects(collect(input()), error => error.code === (reason === "PROCESS_TIMEOUT" ? "PROFILE_TREE_TIMEOUT" : "PROFILE_TREE_CANCELLED")
      && error.process.tree_termination.termination_state === "confirmed");
  });
  for (const invalid of [null, "unknown", "managed-setup.v1", "managed-setup.v2"]) await check("bridge refuses explicit metadata profile before collection " + String(invalid), async () => {
    const { signal, ...plain } = input(); plain.metadataProfile = invalid;
    const body = { protocol: "aidn-controlled-profile-metadata.v1", invocation_id: "fixture", input: plain, timeout_ms: 10000 }; let calls = 0;
    const result = await runCodexProfileMetadataBridge({ ...body, request_sha256: fingerprint(body) }, { collect: async () => { calls++; } });
    assert.equal(result.ok, false); assert.equal(result.error.code, "PROFILE_METADATA_PROFILE_INVALID"); assert.equal(calls, 0);
  });
  for (const variant of ["v2", "hash"]) await check("bridge rejects protocol or fingerprint mismatch before collection " + variant, async () => {
    const { signal, ...plain } = input();
    const body = { protocol: variant === "v2" ? "aidn-controlled-profile-metadata.v2" : "aidn-controlled-profile-metadata.v1",
      invocation_id: "fixture", input: plain, timeout_ms: 10000 }; let calls = 0;
    const result = await runCodexProfileMetadataBridge({ ...body, request_sha256: variant === "hash" ? "0".repeat(64) : fingerprint(body) }, { collect: async () => { calls++; } });
    assert.equal(result.ok, false); assert.equal(result.error.code, "PROFILE_TREE_INPUT_INVALID"); assert.equal(calls, 0);
  });
  await check("malformed bridge JSON cannot become metadata success despite a completed process", async () => {
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) { await options.onEvent({ type: 'stdout', bytes: Buffer.from('{}') }); return completed(request); } } });
    await assert.rejects(collect(input()), error => error.code === "PROFILE_TREE_PROTOCOL_INVALID" && error.process.tree_termination.termination_state === "confirmed");
  });
  await check("foreign Job proof overrides a callback error, becomes unknown and blocks any new call", async () => {
    let calls = 0, callbackCode; const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) { calls++;
        try { await options.onEvent({ type: "stderr", bytes: Buffer.from("fixture diagnostic") }); } catch (error) { callbackCode = error.code; }
        return completed(request, value => ({ ...value, outcome: "failed", reason_code: "PROCESS_CALLBACK_FAILED",
          termination_proof: { ...value.termination_proof, runner_id: 'foreign' } })); } } });
    await assert.rejects(collect(input()), error => error.code === "PROFILE_TREE_TERMINATION_UNCONFIRMED" && error.process.tree_termination.termination_state === "unknown");
    assert.equal(callbackCode, "PROFILE_TREE_BRIDGE_DIAGNOSTIC");
    await assert.rejects(collect(input()), { code: "PROFILE_TREE_RECOVERY_REQUIRED" }); assert.equal(calls, 1);
  });
  await check("oversized metadata stops the callback and never returns raw output", async () => {
    let refused = false;
    const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      async run(request, options) { try { await options.onEvent({ type: 'stdout', bytes: Buffer.alloc(2 * 1024 * 1024 + 65537) }); }
        catch (error) { refused = error.code === 'PROFILE_TREE_OUTPUT_LIMIT'; }
        return completed(request, value => ({ ...value, outcome: 'failed', reason_code: 'PROCESS_CALLBACK_FAILED' })); } } });
    await assert.rejects(collect(input())); assert.equal(refused, true);
  });
  await check("unsettled controller is aborted within the total budget and quarantined", async () => {
    let aborted = false, calls = 0; const collect = createControlledCodexProfileMetadata({ ...base, controller: { checkAvailability: controller.checkAvailability,
      run(_request, options) { calls++; options.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); } } });
    const began = performance.now(); await assert.rejects(collect(input(), { timeoutMs: 3500 }), error => error.code === 'PROFILE_TREE_TIMEOUT' && error.process.tree_termination.termination_state === 'unknown');
    assert(performance.now() - began < 4500); assert.equal(aborted, true);
    await assert.rejects(collect(input()), { code: 'PROFILE_TREE_RECOVERY_REQUIRED' }); assert.equal(calls, 1);
  });
  await check("deadline returns with delayed material quarantined, bounded readers and late handle closure", async () => {
    const fakeNode = path.join(root, "delayed-node.fixture"); fs.writeFileSync(fakeNode, "fixture node\n", { flag: "wx" });
    const runtime = { executable: fakeNode, sha256: hash(fs.readFileSync(fakeNode)) }, originalOpen = fs.promises.open;
    let releaseRead, readSeen = false, activeReaders = 0, peakReaders = 0, closedReaders = 0, openedReaders = 0, nodeHandle;
    let closeResolve, calls = 0, timeout;
    const lateRead = new Promise((_resolve, reject) => { releaseRead = () => reject(new Error("fixture delayed read failure")); });
    lateRead.catch(() => {}); // A fixture setup failure may occur before the delayed read is reached.
    const allClosed = new Promise(resolve => { closeResolve = resolve; }), unhandled = [];
    const onUnhandled = error => unhandled.push(error); process.on("unhandledRejection", onUnhandled);
    fs.promises.open = async (...args) => {
      const handle = await originalOpen(...args); openedReaders++; activeReaders++; peakReaders = Math.max(peakReaders, activeReaders);
      const delayed = args[0] === fakeNode; if (delayed) nodeHandle = handle;
      return {
        stat: (...values) => handle.stat(...values),
        async read(...values) { if (delayed) { readSeen = true; await lateRead; } return handle.read(...values); },
        async close() { try { await handle.close(); } finally { activeReaders--; closedReaders++; if (readSeen && activeReaders === 0) closeResolve(); } },
      };
    };
    const collect = createControlledCodexProfileMetadata({ ...base, nodeRuntime: runtime,
      controller: { checkAvailability() { calls++; throw new Error("delayed material must not reach availability"); }, run() { calls++; throw new Error("delayed material must not launch"); } } });
    const began = performance.now(), pending = collect(input(), { timeoutMs: 3000 });
    const settled = pending.then(value => ({ value }), error => ({ error }));
    try {
      const outcome = await Promise.race([settled, new Promise(resolve => { timeout = setTimeout(() => resolve({ unbounded: true }), 4200); })]);
      clearTimeout(timeout);
      assert.equal(outcome.unbounded, undefined, "material cleanup must not wait indefinitely past the original deadline");
      assert.equal(outcome.error?.code, "PROFILE_TREE_TIMEOUT"); assert(performance.now() - began < 4200);
      assert.equal(outcome.error.process.tree_termination.termination_state, "not_started");
      assert.equal(readSeen, true); assert.equal(calls, 0);
      await assert.rejects(collect(input()), { code: "PROFILE_TREE_RECOVERY_REQUIRED" });
      releaseRead();
      const closed = await Promise.race([allClosed.then(() => true), sleep(1500).then(() => false)]);
      assert.equal(closed, true, "late material failure must close every opened handle");
      assert.equal(activeReaders, 0); assert.equal(closedReaders, openedReaders); assert(peakReaders <= 4);
      await assert.rejects(nodeHandle.stat(), { code: "EBADF" });
      await sleep(0); assert.deepEqual(unhandled, []);
      await assert.rejects(collect(input()), { code: "PROFILE_TREE_RECOVERY_REQUIRED" }); assert.equal(calls, 0);
    } finally {
      clearTimeout(timeout); releaseRead();
      const closed = await Promise.race([allClosed.then(() => true), sleep(1500).then(() => false)]);
      if (!closed) unresolved = true;
      await Promise.race([settled, sleep(1500)]);
      fs.promises.open = originalOpen; process.removeListener("unhandledRejection", onUnhandled);
      if (closed && fs.existsSync(fakeNode)) fs.unlinkSync(fakeNode);
    }
  });
  if (native) {
  await check("real pinned bridge collects one JSON document under confirmed Job", async () => {
    const { result, error } = await real("normal"); assert.ifError(error); assert.equal(result.process.closed, true); assert.equal(result.process.pid_absent, true);
    assert.equal(result.process.response_count, 4); assert.equal(result.process.budget_ms, 10000); assert.equal(result.process.tree_termination.termination_state, "confirmed");
    assert.equal(result.process.tree_termination.proof.active_processes, 0); assert.equal(result.process.tree_termination.runner.executable_sha256, nodeRuntime.sha256);
    assert.equal(result.process.tree_termination.bridge_sha256, candidateInventory[BRIDGE]); assert.equal(result.configs[0].configuration, 'fixture');
    assert.deepEqual(result.configs[0].environment_keys, Object.keys(env).sort());
  });
  await check("real surviving app-server descendant is killed when bridge exits", async () => {
    const { result, error } = await real("descendant"); assert.ifError(error); assert.equal(result.process.tree_termination.termination_state, "confirmed");
    const pids = JSON.parse(fs.readFileSync(path.join(root, "descendant.pids.json"))); assert(absent(pids.parent)); assert(absent(pids.descendant));
  });
  await check("real timeout confirms tree without inventing successful parent metadata", async () => {
    const began = performance.now(), { error } = await real("timeout", { timeoutMs: 8000 }); assert(error);
    assert.equal(error.process.tree_termination.termination_state, "confirmed", error.stack); assert.equal(error.process.closed, false);
    assert(performance.now() - began < 9000); const pids = JSON.parse(fs.readFileSync(path.join(root, "timeout.pids.json"))); assert(absent(pids.descendant));
  });
  await check("real cancellation kills the app-server descendant under the same Job", async () => {
    const stop = new AbortController(), pending = real("cancel", { signal: stop.signal });
    const file = path.join(root, "cancel.pids.json"), deadline = Date.now() + 5000;
    while (!fs.existsSync(file) && Date.now() < deadline) await sleep(25);
    assert(fs.existsSync(file)); stop.abort(); const { error } = await pending; assert(error);
    assert.equal(error.process.tree_termination.termination_state, "confirmed"); assert(absent(JSON.parse(fs.readFileSync(file)).descendant));
  });
  await check("prepared callback failure cannot resume the bridge and retains real Job proof", async () => {
    let prepared = 0; const wrapper = { checkAvailability: controller.checkAvailability, run: (request, options) => controller.run(request, { ...options,
      async onEvent(event) { if (event.type === 'prepared') { prepared++; throw new Error('fixture callback rejected'); } await options.onEvent(event); } }) };
    const { error } = await real("callback", { wrapper }); assert(error); assert.equal(prepared, 1);
    assert.equal(error.code, "PROFILE_TREE_CALLBACK_FAILED"); assert.equal(error.process.tree_termination.termination_state, "confirmed");
  });
  await check("all real fixture PIDs are absent; no Codex process was launched", () => { assert(allPids.length >= 6); assert(allPids.every(absent)); });
  }
} catch (cause) { checks.push({ name: "controlled profile metadata fixtures", status: "FAIL", detail: String(cause.stack ?? cause).slice(0, 4000), diagnostics: cause.diagnostics }); }
finally {
  if (root && !unresolved) { try { const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temp); assert(path.basename(resolved).startsWith("aidn-profile-tree-")); assert.equal(fs.readFileSync(path.join(root, "owner"), "utf8"), token);
    fs.rmSync(resolved, { recursive: true }); checks.push({ name: "owned process fixture cleanup", status: "PASS" });
  } catch (cause) { checks.push({ name: "owned process fixture cleanup", status: "FAIL", detail: cause.message }); } }
  else if (root) checks.push({ name: "owned process fixture cleanup", status: "FAIL", detail: "unconfirmed tree; preserve resources", root });
}
console.log(JSON.stringify({ status: checks.some(row => row.status === 'FAIL') ? 'FAIL' : 'PASS', checks,
  native_codex: 'NOT_EXECUTED', native_sandbox: 'NOT_EXECUTED', native_processes: native ? 'EXECUTED' : 'NOT_RUN',
  evidence: native ? 'real Windows Job, real Node bridge and fake app-server only' : 'portable doubles; no child process or helper compilation' }, null, 2));
if (checks.some(row => row.status === 'FAIL')) process.exitCode = 1;
