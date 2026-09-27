import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCodexJsonlProtocol } from "../../src/adapters/agents/codex-jsonl-protocol.mjs";
import { buildCodexTaskArguments, createCodexCliTaskExecutor, createCodexWorkerEnvironment } from "../../src/adapters/agents/codex-cli-task-executor.mjs";
import { createAgentTaskEvidenceStore } from "../../src/adapters/agents/agent-task-evidence-store.mjs";
import { fingerprintAgentExecutionValue } from "../../src/core/agents/agent-execution-contracts.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-codex-task-fixture-"));
const fixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url)), "utf8"));
const cwd = path.join(root, "worktree espace été"), evidenceRoot = path.join(root, "evidence");
fs.mkdirSync(cwd); fs.mkdirSync(evidenceRoot);
let checks = 0;
const check = async (name, body) => { await body(); checks++; process.stdout.write(`PASS ${name}\n`); };
const lines = [{ type: "thread.started", thread_id: "thread.fixture" }, { type: "turn.started" },
  { type: "item.completed", item: { type: "agent_message", text: "été" } }, { type: "turn.completed", usage: {} }];
const bytes = Buffer.from(lines.map(item => JSON.stringify(item)).join("\n") + "\n");
let ordinal = 0;
function setup({ output = bytes, termination = "confirmed", exit = 0, outcome = "completed", qualify = true, throwController = false, failPrepared = false, callbackTimeoutMs = 5000, admissionTimeoutMs = 10000, admission, omitAdmission = false, invalidatePreparation = false, minimalEnvironment = false } = {}) {
  const request = structuredClone(fixture.request);
  request.cwd = cwd; request.attempt_id = `fixture.${++ordinal}`;
  const calls = [], events = [];
  const runtime = { executable: process.execPath, sha256: createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex"), engine: request.execution.engine, codexHome: path.join(root, "profile") };
  const controller = {
    async checkAvailability() { calls.push("availability"); return { available: true }; },
    async run(spec, { signal, onEvent }) {
      calls.push("run"); assert.equal(spec.cwd, cwd); assert.equal(spec.stdin, request.instruction);
      assert.equal(spec.env.AIDN_PG_URL, undefined); assert.equal(spec.args.at(-1), "-");
      if (throwController) throw new Error("lost native observation");
      try {
        await onEvent({ type: "prepared", pid: 123, suspended: true });
        calls.push("resumed"); await onEvent({ type: "resumed" });
        for (let offset = 0; offset < output.length; offset += 7) await onEvent({ type: "stdout", bytes: output.subarray(offset, offset + 7) });
        return { outcome, termination_state: termination, exit_code: exit, signal: null };
      } catch {
        calls.push("stop"); return { outcome: "failed", termination_state: termination, exit_code: 1, signal: null };
      }
    },
  };
  const executor = createCodexCliTaskExecutor({ runtime, controller, callbackTimeoutMs, admissionTimeoutMs,
    qualify: async () => ({ qualified: qualify }),
    prepare: async req => { if (invalidatePreparation) qualify = false; return { request_sha256: fingerprintAgentExecutionValue(req),
      env: minimalEnvironment ? { AIDN_AGENT_ATTEMPT_ID: req.attempt_id, AIDN_AGENT_REQUEST_SHA256: fingerprintAgentExecutionValue(req) } : createCodexWorkerEnvironment({ host: { PATH: process.env.PATH ?? "", AIDN_PG_URL: "never-forward", OPENAI_API_KEY: "never-forward" },
        codexHome: path.join(root, "profile"), tempDirectory: path.join(root, "temp"),
        admission: { endpoint: "http://127.0.0.1:12345/v1/admit", token: "a".repeat(64), attemptId: req.attempt_id, requestSha256: fingerprintAgentExecutionValue(req) } }) }; },
    recordLaunchIntent: async () => calls.push("intent"),
    observeRunner: async () => { calls.push("observed"); if (failPrepared) throw new Error("observation failed"); },
    admitLaunch: omitAdmission ? undefined : async (req, options) => {
      calls.push(`admission:${options.phase}`);
      const decision = { protocol_version: 1, ok: true, outcome: "allow", attempt_id: req.attempt_id,
        request_sha256: fingerprintAgentExecutionValue(req) };
      return admission ? admission(req, options, decision) : decision;
    },
    openEvidence: createAgentTaskEvidenceStore({ root: evidenceRoot }).open,
  });
  return { request, executor, calls, events };
}
try {
  await check("construction and descriptor do not probe", () => {
    const { executor, calls } = setup(); assert.equal(executor.getDescriptor().executor_id, "codex-cli-task"); assert.deepEqual(calls, []);
  });
  await check("launch admission is required and has its own finite budget", () => {
    assert.throws(() => setup({ omitAdmission: true }), /SUPERVISOR_DEPENDENCY_REQUIRED/);
    assert.throws(() => setup({ callbackTimeoutMs: 5001 }), /CALLBACK_LIMIT_INVALID/);
    for (const value of [0, 10001, Infinity, 1.5]) assert.throws(() => setup({ admissionTimeoutMs: value }), /ADMISSION_LIMIT_INVALID/);
  });
  await check("arguments freeze model effort cwd sandbox and stdin", () => {
    const { request } = setup(); const args = buildCodexTaskArguments(request);
    assert.equal(args[args.indexOf("--cd") + 1], cwd); assert.equal(args[args.indexOf("--model") + 1], request.execution.model);
    assert(args.includes("workspace-write")); assert(!args.some(value => value.includes("dangerously")));
    assert(!args.includes("--ignore-user-config"), "the isolated profile's native trust must be loaded");
    assert(args.includes("agents.enabled=false"), "workers cannot create a second delegation authority");
    for (const policy of ['approval_policy="never"', "sandbox_workspace_write.writable_roots=[]",
      "sandbox_workspace_write.network_access=false", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
      "sandbox_workspace_write.exclude_slash_tmp=true"]) {
      assert(args.includes(policy), "native trust profile cannot widen the delegated worker boundary");
    }
    assert.equal(args.includes('windows.sandbox="elevated"'), process.platform === "win32",
      "Windows workers require the explicitly qualified elevated sandbox backend");
  });
  await check("qualification unavailable launches nothing", async () => {
    const { executor, request, calls } = setup({ qualify: false });
    const result = await executor.runTask(request); assert.equal(result.termination_state, "not_started"); assert(!calls.includes("run"));
  });
  await check("invalid callback does not retain a running executor", async () => {
    const { executor, request, calls } = setup({ qualify: false });
    await assert.rejects(executor.runTask(request, { onEvent: 1 }), /callbacks/);
    assert.equal((await executor.runTask(request)).termination_state, "not_started"); assert(!calls.includes("run"));
  });
  await check("preparation cannot reuse a qualification invalidated by its own effects", async () => {
    const { executor, request, calls } = setup({ invalidatePreparation: true });
    assert.equal((await executor.runTask(request)).termination_state, "not_started"); assert(!calls.includes("run"));
  });
  await check("partial environment never falls back to a default native profile", async () => {
    const { executor, request, calls } = setup({ minimalEnvironment: true });
    const result = await executor.runTask(request); assert.equal(result.reason_code, "CODEX_ENVIRONMENT_INVALID"); assert(!calls.includes("run"));
  });
  await check("streaming Unicode result and evidence are independent from acceptance", async () => {
    const { executor, request, calls, events } = setup(); let busy = false;
    const result = await executor.runTask(request, { onEvent: async event => { assert(!busy); busy = true; await Promise.resolve(); events.push(event); busy = false; } });
    assert.equal(result.outcome, "completed"); assert(!("acceptance" in result));
    assert.deepEqual(calls.filter(value => ["intent", "admission:before_create", "run", "observed", "admission:before_resume", "resumed"].includes(value)),
      ["intent", "admission:before_create", "run", "observed", "admission:before_resume", "resumed"]);
    assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4, 5]);
    const proof = result.evidence[0], content = fs.readFileSync(path.join(evidenceRoot, proof.ref));
    assert.equal(content.length, proof.bytes); assert.equal(createHash("sha256").update(content).digest("hex"), proof.sha256);
    const count = events.length; await new Promise(resolve => setImmediate(resolve)); assert.equal(events.length, count);
  });
  await check("exit zero does not complete a missing protocol", async () => {
    const { executor, request } = setup({ output: Buffer.from(JSON.stringify(lines[0]) + "\n") });
    const result = await executor.runTask(request); assert.equal(result.outcome, "failed"); assert.equal(result.reason_code, "CODEX_PROTOCOL_INCOMPLETE");
  });
  await check("callback failure stops emissions and process", async () => {
    const { executor, request, calls } = setup(); let count = 0;
    const result = await executor.runTask(request, { onEvent: () => { count++; throw new Error("fixture callback"); } });
    assert.equal(result.outcome, "failed"); assert.equal(count, 1); assert(calls.includes("stop"));
    assert.equal(result.reason_code, "CODEX_EVENT_CALLBACK_FAILED");
  });
  await check("unsettled event callback has a bounded failure and no further emissions", async () => {
    const { executor, request, calls } = setup({ callbackTimeoutMs: 50 }); let count = 0;
    const result = await executor.runTask(request, { onEvent: () => { count++; return new Promise(() => {}); } });
    assert.equal(result.outcome, "failed"); assert.equal(count, 1); assert(calls.includes("stop"));
  });
  await check("observation failure never resumes", async () => {
    const { executor, request, calls } = setup({ failPrepared: true });
    const result = await executor.runTask(request); assert.equal(result.outcome, "failed"); assert(!calls.includes("resumed"));
  });
  await check("launch admission cannot be confused with a foreign or denied decision", async () => {
    for (const changed of [{ ok: false, outcome: "deny" }, { attempt_id: "foreign" }, { request_sha256: "0".repeat(64) }, { protocol_version: 2 }]) {
      const { executor, request, calls } = setup({ admission: async (_req, _options, decision) => ({ ...decision, ...changed }) });
      const result = await executor.runTask(request);
      assert.equal(result.reason_code, "CODEX_LAUNCH_ADMISSION_REFUSED"); assert.equal(result.termination_state, "not_started"); assert(!calls.includes("run"));
    }
  });
  await check("fresh suspended admission refusal stops before resume", async () => {
    const { executor, request, calls } = setup({ admission: async (_req, { phase }, decision) =>
      phase === "before_resume" ? { ...decision, ok: false, outcome: "deny" } : decision });
    const result = await executor.runTask(request);
    assert.equal(result.reason_code, "CODEX_LAUNCH_ADMISSION_REFUSED"); assert(calls.includes("observed")); assert(calls.includes("stop")); assert(!calls.includes("resumed"));
  });
  await check("admission work may exceed the notification budget without extending event callbacks", async () => {
    const { executor, request } = setup({ callbackTimeoutMs: 500, admissionTimeoutMs: 1000,
      admission: async (_req, _options, decision) => { await new Promise(resolve => setTimeout(resolve, 600)); return decision; } });
    assert.equal((await executor.runTask(request)).outcome, "completed");
  });
  await check("synchronous admission overruns cannot beat the deadline timer", async () => {
    const { executor, request, calls } = setup({ admissionTimeoutMs: 40, admission: async (_req, _options, decision) => {
      const until = performance.now() + 60; while (performance.now() < until) { /* fixture blocks timer delivery */ }
      return decision;
    } });
    const result = await executor.runTask(request);
    assert.equal(result.reason_code, "CODEX_ADMISSION_TIMEOUT"); assert(!calls.includes("run"));
  });
  await check("admission deadline aborts and ignores a later allow before resume", async () => {
    let finish, signal;
    const { executor, request, calls } = setup({ admissionTimeoutMs: 40, admission: async (_req, options, decision) => {
      if (options.phase === "before_create") return decision;
      signal = options.signal; return new Promise(resolve => { finish = () => resolve(decision); });
    } });
    const result = await executor.runTask(request);
    assert.equal(result.reason_code, "CODEX_ADMISSION_TIMEOUT"); assert(signal.aborted); assert(!calls.includes("resumed"));
    finish(); await new Promise(resolve => setImmediate(resolve)); assert(!calls.includes("resumed"));
  });
  await check("cancellation during suspended admission cannot resume after a late allow", async () => {
    let finish, signal; const abort = new AbortController();
    const { executor, request, calls } = setup({ admission: async (_req, options, decision) => {
      if (options.phase === "before_create") return decision;
      signal = options.signal; queueMicrotask(() => abort.abort());
      return new Promise(resolve => { finish = () => resolve(decision); });
    } });
    const result = await executor.runTask(request, { signal: abort.signal });
    assert.equal(result.outcome, "cancelled"); assert(signal.aborted); assert(!calls.includes("resumed"));
    finish(); await new Promise(resolve => setImmediate(resolve)); assert(!calls.includes("resumed"));
  });
  await check("task deadline bounds a longer launch admission budget", async () => {
    let signal;
    const { executor, request, calls } = setup({ admissionTimeoutMs: 1000, admission: async (_req, options) => { signal = options.signal; return new Promise(() => {}); } });
    request.limits.max_duration_ms = 500;
    const result = await executor.runTask(request);
    assert.equal(result.outcome, "timed_out"); assert(signal.aborted); assert(!calls.includes("run"));
  });
  await check("lost process controller never implies stopped", async () => {
    const { executor, request } = setup({ throwController: true });
    const result = await executor.runTask(request); assert.equal(result.outcome, "indeterminate"); assert.equal(result.termination_state, "unknown");
  });
  await check("unknown descendants forbid completion even with exit zero", async () => {
    const { executor, request } = setup({ termination: "unknown" }); assert.equal((await executor.runTask(request)).outcome, "indeterminate");
  });
  await check("cancelled before launch and timeout remain separate", async () => {
    const early = setup(), abort = new AbortController(); abort.abort();
    const result = await early.executor.runTask(early.request, { signal: abort.signal }); assert.equal(result.outcome, "cancelled"); assert(!early.calls.includes("run"));
    const timed = setup({ outcome: "timed_out", exit: 1 }); assert.equal((await timed.executor.runTask(timed.request)).outcome, "timed_out");
  });
  for (const [name, content] of [
    ["invalid JSON", Buffer.from("x\n")], ["torn final line", bytes.subarray(0, -1)],
    ["unknown event", Buffer.from('{"type":"not.supported"}\n')],
    ["event after terminal", Buffer.concat([bytes, Buffer.from(JSON.stringify(lines[1]) + "\n")])],
  ]) await check(name, async () => {
    const parser = createCodexJsonlProtocol(); await assert.rejects(async () => { await parser.push(content); parser.finish(); });
  });
  await check("line memory is bounded", async () => {
    const parser = createCodexJsonlProtocol({ maxLineBytes: 32 }); await parser.push(Buffer.alloc(20, 32));
    await assert.rejects(parser.push(Buffer.alloc(20, 32)), /LINE_LIMIT/);
  });
  await check("evidence cannot overwrite or reside in worker", async () => {
    const { request } = setup(); await assert.rejects(createAgentTaskEvidenceStore({ root: cwd }).open(request), /INSIDE_WORKER/);
    const store = createAgentTaskEvidenceStore({ root: evidenceRoot }), evidence = await store.open(request); await evidence.finish({});
    await assert.rejects(store.open(request), /EEXIST/);
  });
  process.stdout.write(`PASS ${checks} Codex task executor fixtures; native Codex, hooks and OS qualification NOT EXECUTED\n`);
} finally {
  const resolved = path.resolve(root), temp = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("aidn-codex-task-fixture-")) throw new Error("Unsafe fixture cleanup");
  fs.rmSync(resolved, { recursive: true, force: true });
}
