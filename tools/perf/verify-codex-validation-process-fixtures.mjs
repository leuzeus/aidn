import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { buildAgentProcessHelper } from "../verify/build-agent-process-helper.mjs";
import { buildCodexValidationTrampoline } from "../verify/build-codex-validation-trampoline.mjs";
import { createWindowsProcessTreeController } from "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs";
import { createCodexValidationStreamParser } from "../../src/adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { createVerificationFixture } from "./agent-verification-test-lib.mjs";

// Real Windows process trees, deliberately WITHOUT Codex or an OS sandbox.
// This gate can qualify the helper protocol and environment, never confinement.
const checks = [], hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const check = async (name, action) => { await action(); checks.push({ name, status: "PASS" }); };
let root, token, unresolved = false;
try {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("VALIDATION_PROCESS_PLATFORM_UNAVAILABLE");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-validation-process-")); token = randomUUID();
  fs.writeFileSync(path.join(root, "owner"), token, { flag: "wx" });
  const cwd = path.join(root, "snapshot espace été"), out = path.join(root, "trampoline"); fs.mkdirSync(cwd); fs.mkdirSync(out);
  const compilerPath = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  const helper = buildAgentProcessHelper({ outputDir: path.join(root, "helper"), compilerPath });
  const trampoline = buildCodexValidationTrampoline({ outputDir: out, compilerPath });
  const controller = createWindowsProcessTreeController({ helperPath: helper.helper_path, helperSha256: helper.helper_sha256,
    helperSourceSha256: helper.source_sha256, candidateSha256: hash(path.resolve(import.meta.dirname, "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs")) });
  const nodeHash = hash(process.execPath), env = { SystemRoot: process.env.SystemRoot, TEMP: cwd, TMP: cwd, NO_COLOR: "1" };
  const direct = (script, changes = {}) => ({ runnerId: randomUUID(), executable: process.execPath, executableSha256: nodeHash, args: ["-e", script],
    cwd, env, stdin: "", maxDurationMs: 15000, stopTimeoutMs: 3000, ...changes });
  await check("new helper preserves historical unnamed requests", async () => {
    const result = await controller.run(direct("process.stdout.write('legacy')")); assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.termination_state, "confirmed");
  });
  await check("exact supervisor job name is observed and malformed name is refused", async () => {
    const jobName = `Local\\aidn-execution-${randomUUID().replaceAll("-", "")}`;
    const result = await controller.run(direct("", { jobName })); assert.equal(result.outcome, "completed", JSON.stringify(result));
    assert.equal(result.runner.job_name, jobName); assert.equal(result.termination_proof.job_name, jobName);
    assert.equal((await controller.run(direct("", { jobName: "Global\\bad" }))).reason_code, "PROCESS_REQUEST_INVALID");
  });
  await check("existing named job refuses a second launch without changing the first", async () => {
    const jobName = `Local\\aidn-execution-${randomUUID().replaceAll("-", "")}`, sentinel = path.join(cwd, "collision-must-not-run"); let refused;
    const result = await controller.run(direct("", { jobName }), { async onEvent(event) { if (event.type !== "prepared") return;
      refused = await controller.run(direct(`require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad')`, { jobName }));
      assert.equal(refused.reason_code, "JOB_ALREADY_EXISTS", JSON.stringify(refused)); assert.equal(refused.termination_state, "not_started");
    } });
    assert(refused); assert.equal(result.outcome, "completed", JSON.stringify(result)); assert(!fs.existsSync(sentinel));
  });
  function invocation(script, duration = 15000) {
    const value = { invocation_id: randomUUID(), boundary_id: "codex-sandbox-validation", validation_id: "process.fixture", executable: process.execPath,
      executable_sha256: nodeHash, argv: ["-e", script], cwd, environment_sha256: fingerprint(env), max_duration_ms: duration, max_output_bytes: 65536 };
    return { ...value, request_sha256: fingerprint(value), environment: env };
  }
  async function execute(input, { mode, parentJobName } = {}) {
    const jobName = `Local\\aidn-execution-${fingerprint({ invocation_id: input.invocation_id, request_sha256: input.request_sha256 }).slice(0, 32)}`;
    const stdin = canonical({ protocol: "aidn-validation-trampoline.v1", runner_id: input.invocation_id, request_sha256: input.request_sha256,
      parent_job_name: parentJobName ?? jobName, executable: input.executable, executable_sha256: input.executable_sha256, args: input.argv,
      cwd, environment_json: canonical(env), environment_sha256: fingerprint(env), max_duration_ms: mode === "timeout" ? 1200 : 15000, max_output_bytes: input.max_output_bytes }) + "\n";
    const stream = createCodexValidationStreamParser(input), stop = new AbortController(); let bytes = "", events = 0;
    const result = await controller.run({ ...direct(""), runnerId: input.invocation_id, jobName, executable: trampoline.executable, executableSha256: trampoline.sha256,
      args: [], stdin, env: { ...env, NODE_OPTIONS: "must-not-inherit", PGPASSWORD: "fixture-only", AIDN_FIXTURE_AMBIENT: "must-not-inherit" } }, {
      signal: stop.signal, async onEvent(event) {
        if (event.type !== "stdout") return; events++; bytes += event.bytes.toString("utf8");
        if (parentJobName) return; stream.consume(event.bytes);
        if (stream.observation() && bytes.includes('"type":"stdout"')) {
          if (mode === "cancel") stop.abort();
          if (mode === "callback") throw new Error("fixture callback rejected");
        }
      },
    });
    if (result.termination_state === "unknown") unresolved = true;
    return { result, stream, bytes, events, jobName };
  }
  await check("trampoline starts runner in both jobs with an actually closed environment", async () => {
    const input = invocation("console.log(JSON.stringify({env:process.env,cwd:process.cwd()}))"), observed = await execute(input), decoded = observed.stream.finish();
    assert.equal(observed.result.outcome, "completed", JSON.stringify(observed.result)); assert.equal(decoded.terminal.active_processes, 0);
    assert.equal(decoded.prepared.parent_job_name, observed.result.termination_proof.job_name);
    assert.deepEqual(JSON.parse(decoded.stdout).env, env); assert.equal(JSON.parse(decoded.stdout).cwd, cwd);
  });
  await check("unavailable outer job prevents runner creation", async () => {
    const sentinel = path.join(cwd, "wrong-job-must-not-run");
    const observed = await execute(invocation(`require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad')`), { parentJobName: `Local\\aidn-execution-${"0".repeat(32)}` });
    assert.equal(observed.result.termination_state, "confirmed"); assert(!fs.existsSync(sentinel));
    const terminal = JSON.parse(observed.bytes.trim()); assert.equal(terminal.reason_code, "PARENT_JOB_UNAVAILABLE"); assert.equal(terminal.termination_state, "not_started");
  });
  const tree = "const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000)";
  for (const mode of ["timeout", "cancel", "callback"]) await check(`${mode} stops a real descendant in the bound outer job`, async () => {
    const observed = await execute(invocation(tree), { mode });
    assert.equal(observed.result.termination_state, "confirmed", JSON.stringify(observed.result));
    assert.equal(observed.result.termination_proof.active_processes, 0); assert.equal(observed.stream.observation().parent_job_name, observed.jobName);
    if (mode === "timeout") { const inner = observed.stream.finish(); assert.equal(inner.terminal.outcome, "timed_out"); assert.equal(inner.terminal.active_processes, 0); }
    else assert.equal(observed.result.reason_code, mode === "cancel" ? "PROCESS_CANCELLED" : "PROCESS_CALLBACK_FAILED");
  });
  await check("timeout outcome with exit zero and passed JSON remains a failed validation", async () => {
    const fixture = await createVerificationFixture({});
    try {
      const original = fixture.boundary.run;
      const producer = fixture.create({ boundary: { ...fixture.boundary, async run(...args) { return { ...await original(...args), outcome: "timed_out" }; } } });
      const validation = await producer.validateTask(fixture.taskInput);
      assert.equal(validation.status, "failed"); assert.equal(validation.checks[0].status, "failed"); assert.equal(fixture.calls, 1);
    } finally { fixture.cleanup(); }
  });
} catch (cause) { checks.push({ name: "process qualification fixtures", status: "FAIL", detail: String(cause.stack ?? cause).slice(0, 4000), diagnostics: cause.diagnostics }); }
finally {
  if (root && !unresolved) {
    try { const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
      assert.equal(path.dirname(resolved), temp); assert(path.basename(resolved).startsWith("aidn-validation-process-")); assert.equal(fs.readFileSync(path.join(root, "owner"), "utf8"), token);
      fs.rmSync(resolved, { recursive: true }); checks.push({ name: "owned process fixture cleanup", status: "PASS" });
    } catch (cause) { checks.push({ name: "owned process fixture cleanup", status: "FAIL", detail: cause.message }); }
  } else if (root) checks.push({ name: "owned process fixture cleanup", status: "FAIL", detail: "unconfirmed process tree; resources preserved", root });
}
console.log(JSON.stringify({ status: checks.every(row => row.status === "PASS") ? "PASS" : "FAIL", checks, native_sandbox_qualification: "NOT_EXECUTED" }, null, 2));
if (checks.some(row => row.status === "FAIL")) process.exitCode = 1;
