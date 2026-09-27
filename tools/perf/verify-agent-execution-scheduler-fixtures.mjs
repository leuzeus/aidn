import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAgentExecutionSchedule, projectAgentExecutionSchedule } from "../../src/core/agents/agent-execution-schedule.mjs";
import { createLocalAgentGitIntegration } from "../../src/adapters/runtime/local-agent-git-integration.mjs";
import { assertUnclaimedAgentRun } from "../../src/application/runtime/agent-run-supervisor.mjs";
import { createSchedulerFixture, delay } from "./agent-execution-scheduler-test-lib.mjs";

const checks = [];
async function check(name, body) {
  try { await body(); checks.push({ name, status: "PASS" }); }
  catch (cause) { checks.push({ name, status: "FAIL", detail: String(cause.stack ?? cause).slice(0, 1800) }); }
}
async function fixture(options, body) {
  const value = createSchedulerFixture(options);
  try { await body(value); } finally { value.cleanup(); }
}
const task = task_id => ({ task_id, depends_on: [] });
const proof = { supervisorProof: { confirmed: true }, attempts: [] };

await check("DAG is pure and deterministically topological then ordinal ID", () => {
  const tasks = [task("z"), { task_id: "a2", depends_on: ["a"] }, task("a")], before = JSON.stringify(tasks);
  const graph = buildAgentExecutionSchedule(tasks);
  assert.deepEqual(graph.order, ["a", "a2", "z"]); assert.equal(JSON.stringify(tasks), before);
  assert.ok(Object.isFrozen(graph.dependencies.a2));
});
await check("DAG rejects ambiguous identities, foreign dependencies and cycles", () => {
  assert.throws(() => buildAgentExecutionSchedule([task("a"), task("a")]), /SCHEDULE_ID_INVALID/);
  assert.throws(() => buildAgentExecutionSchedule([{ task_id: "a", depends_on: ["b"] }]), /SCHEDULE_UNKNOWN_DEPENDENCY/);
  assert.throws(() => buildAgentExecutionSchedule([{ task_id: "a", depends_on: ["b"] }, { task_id: "b", depends_on: ["a"] }]), /SCHEDULE_DEPENDENCY_CYCLE/);
});
await check("failed predecessor blocks descendants and leaves independent ready", () => {
  const graph = buildAgentExecutionSchedule([task("a"), task("b"), { task_id: "c", depends_on: ["a"] }]);
  assert.deepEqual(projectAgentExecutionSchedule(graph, { attempted: ["a"], failed: ["a"] }), { ready: ["b"], blocked: ["c"], nextIntegration: "b" });
  assert.throws(() => projectAgentExecutionSchedule(graph, { failed: ["foreign"] }), /FOREIGN_TASK/);
});
await check("construction is probe-free and missing dependencies are refused", async () => fixture({}, async f => {
  f.create(); assert.deepEqual(f.operations, []);
  assert.throws(() => f.create({ prepareAttempt: null }), /CALLBACK_REQUIRED/);
  assert.throws(() => f.create({ coordinationTimeoutMs: 60000 }), /BUDGET_INVALID/);
}));
await check("invalid entry never latches a scheduler before a valid invocation", async () => fixture({}, async f => {
  const scheduler = f.create();
  await assert.rejects(scheduler.run(undefined), /SUPERVISOR_OPTIONS_INVALID/);
  await assert.rejects(scheduler.run({ ...f.options, signal: {} }), /SUPERVISOR_SIGNAL_INVALID/);
  assert.deepEqual(f.operations, []);
  const result = await scheduler.run(f.options);
  assert.equal(result.status, "completed", result.reason_code);
}));
await check("bounded concurrency, exact input SHA and deterministic acceptance/integration", async () => fixture({}, async f => {
  const outcome = await f.create().run(f.options);
  assert.equal(outcome.status, "completed", outcome.reason_code); assert.equal(f.maxLive, 2);
  assert.deepEqual(f.state.integrations.map(row => row.prepared.task_id), ["a", "b", "c"]);
  const [a, b, c] = f.state.attempts;
  assert.equal(a.attempt.input_sha, f.plan.base.sha); assert.equal(b.attempt.input_sha, f.plan.base.sha);
  assert.equal(c.attempt.input_sha, f.state.integrations[1].prepared.result_sha);
  assert.ok(f.operations.indexOf("integration-applied:b") < f.operations.indexOf("claim:c"));
  assert.equal(f.state.final_validation.validation.integrated_sha, f.state.integration_head.sha);
}));
await check("concurrency one serializes child execution", async () => fixture({ concurrency: 1 }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "completed", result.reason_code); assert.equal(f.maxLive, 1);
}));
await check("configured concurrency four is respected", async () => fixture({ concurrency: 4, tasks: ["a", "b", "d", "e"].map(task) }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "completed", result.reason_code); assert.equal(f.maxLive, 4);
}));
await check("confirmed failure blocks descendants while independent task integrates", async () => fixture({ failure: { task: "a" } }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "failed", result.reason_code);
  assert.deepEqual(result.blocked_tasks, ["c"]); assert.deepEqual(f.state.integrations.map(row => row.prepared.task_id), ["b"]);
  assert.ok(!f.operations.includes("claim:c")); assert.equal(f.state.attempts.length, 2);
}));
await check("exit zero without passed validation is rejected and not integrated", async () => fixture({}, async f => {
  const result = await f.create({ validateTask: async context => {
    const value = await f.callbacks.validateTask(context);
    return context.task.task_id === "a" ? { ...value, status: "failed", checks: value.checks.map(check => ({ ...check, status: "failed" })) } : value;
  } }).run(f.options);
  assert.equal(result.status, "failed", result.reason_code);
  assert.equal(f.state.attempts[0].result.process.exit_code, 0);
  assert.equal(f.state.acceptances.find(row => row.acceptance.task_id === "a").acceptance.integration.status, "not_requested");
  assert.deepEqual(f.state.integrations.map(row => row.prepared.task_id), ["b"]);
}));
await check("indeterminate stop prevents new launch and automatic retry", async () => fixture({ concurrency: 1, failure: { indeterminate: "a" } }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "recovery_required");
  assert.ok(!f.operations.includes("claim:b"));
  const resumed = await f.create().resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.reason_code, "ATTEMPT_RECONCILIATION_REQUIRED"); assert.equal(f.state.attempts.length, 1);
}));
await check("explicit reconciliation continues unattempted independent task without retry", async () => fixture({ concurrency: 1, failure: { indeterminate: "a" } }, async f => {
  await f.create().run(f.options);
  const first = f.state.attempts[0].attempt.attempt_id;
  const resumed = await f.create().resume({ ...f.options, reconciliation: { ...proof, attempts: [{ attemptId: first, proof: { confirmed: true } }] } });
  assert.equal(resumed.status, "failed", resumed.reason_code);
  assert.equal(f.operations.filter(item => item === "claim:a").length, 1); assert.ok(f.operations.includes("integration-applied:b"));
}));
await check("coordination failure stops launches and preserves uncertain attempt", async () => fixture({ concurrency: 1, failure: { event: true } }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "recovery_required");
  assert.equal(f.state.attempts.length, 1); assert.ok(!f.operations.includes("claim:b"));
}));
await check("a hung coordination call is bounded and creates no child", async () => fixture({}, async f => {
  f.store.getRun = async () => new Promise(() => {});
  const result = await f.create({ coordinationTimeoutMs: 5 }).run(f.options);
  assert.equal(result.reason_code, "COORDINATION_TIMEOUT"); assert.ok(!f.operations.some(item => item.startsWith("claim:")));
}));
await check("initial Git inspection is bounded before supervisor claim", async () => fixture({}, async f => {
  const result = await f.create({ coordinationTimeoutMs: 5, git: { ...f.git, inspectIntegration: async () => new Promise(() => {}) } }).run(f.options);
  assert.equal(result.reason_code, "INTEGRATION_INSPECTION_TIMEOUT"); assert.ok(!f.operations.includes("claimSupervisor"));
}));
await check("Git initialization ignoring abort leaves run recoverable", async () => fixture({}, async f => {
  const controller = new AbortController();
  const result = await f.create({ git: { ...f.git, initializeIntegration: async () => {
    setTimeout(() => controller.abort(), 5); return new Promise(() => {});
  } } }).run({ ...f.options, signal: controller.signal });
  assert.equal(result.reason_code, "INTEGRATION_INITIALIZATION_INTERRUPTED"); assert.equal(f.state.attempts.length, 0);
}));
await check("heartbeats cover preparation before executor construction", async () => {
  const timers = [];
  const clock = { now: () => performance.now(), setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, ms === 10000 ? 4 : ms); }, clearTimeout };
  await fixture({ tasks: [task("a")], failure: { prepareDelay: 24 }, clock }, async f => {
    const result = await f.create().run(f.options); assert.equal(result.status, "completed", result.reason_code);
    assert.ok(timers.filter(ms => ms === 10000).length >= 2);
    assert.ok(f.operations.indexOf("renew:a") < f.operations.indexOf("executor:a"));
    assert.ok(f.operations.indexOf("renewSupervisor") < f.operations.indexOf("executor:a"));
  });
});
await check("heartbeat loss during bootstrap prevents executor creation", async () => {
  const clock = { now: () => performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms === 10000 ? 3 : ms), clearTimeout };
  await fixture({ tasks: [task("a")], failure: { prepareDelay: 20, heartbeat: true }, clock }, async f => {
    const result = await f.create().run(f.options); assert.equal(result.status, "recovery_required"); assert.ok(!f.operations.includes("executor:a"));
  });
});
await check("preparation timeout preserves intent without worker launch", async () => fixture({ tasks: [task("a")], failure: { prepareDelay: 25 } }, async f => {
  const result = await f.create({ preparationTimeoutMs: 5 }).run(f.options);
  assert.equal(result.reason_code, "ATTEMPT_PREPARATION_TIMEOUT"); assert.ok(f.operations.includes("intent:a")); assert.ok(!f.operations.includes("executor:a"));
  await delay(30);
}));
await check("resume requires preserved preparation and never repeats bootstrap", async () => fixture({ tasks: [task("a")] }, async f => {
  const first = await f.create({ validateTask: async () => { throw new Error("injected crash"); } }).run(f.options);
  assert.equal(first.status, "recovery_required"); assert.equal(f.state.attempts[0].result.outcome, "completed");
  assert.equal(first.durable_state_known, true); assert.equal(f.state.run.lifecycle_status, "recovery_required");
  const deadline = f.state.run_deadline_at;
  const resumed = await f.create().resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.status, "completed", resumed.reason_code); assert.equal(f.state.run_deadline_at, deadline);
  assert.equal(f.operations.filter(item => item === "bootstrap:a").length, 1);
  assert.equal(f.operations.filter(item => item === "executor:a").length, 1);
}));
await check("altered preparation bytes block resume without worker relaunch", async () => fixture({ tasks: [task("a")] }, async f => {
  await f.create({ validateTask: async () => { throw new Error("injected crash"); } }).run(f.options);
  f.evidence.set(f.state.attempts[0].preparation.evidence.ref, Buffer.from("changed"));
  const resumed = await f.create().resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.reason_code, "PREPARATION_EVIDENCE_CHANGED"); assert.equal(f.operations.filter(item => item === "executor:a").length, 1);
}));
await check("resume recognizes already applied integration without preparing twice", async () => fixture({ tasks: [task("a")], failure: { afterCas: true } }, async f => {
  const first = await f.create().run(f.options); assert.equal(first.status, "recovery_required");
  assert.equal(first.durable_state_known, false); assert.ok(!f.operations.includes("invalidateRun"));
  f.state.supervision.current.lease_live = false; // Independent recovery after lease expiry, not implicit takeover.
  assert.equal(f.state.integrations.length, 1); assert.equal(f.state.integrations[0].applied, null);
  const expected = f.state.integrations[0].prepared.result_sha;
  const resumed = await f.create().resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.status, "completed", resumed.reason_code);
  assert.equal(f.state.integration_head.sha, expected); assert.equal(f.state.integrations.length, 1);
  assert.equal(f.operations.filter(item => item === "integration-prepared:a").length, 1);
}));
await check("foreign integration reference blocks recovery", async () => fixture({ tasks: [task("a")], failure: { afterCas: true } }, async f => {
  await f.create().run(f.options);
  f.state.supervision.current.lease_live = false;
  const inspect = f.git.inspectIntegration;
  f.git.inspectIntegration = async (...args) => ({ ...await inspect(...args), head_sha: "f".repeat(40) });
  const result = await f.create().resume({ ...f.options, reconciliation: proof });
  assert.equal(result.reason_code, "INTEGRATION_RECONCILIATION_REQUIRED"); assert.equal(f.state.integrations[0].applied, null);
}));
await check("conflict is preserved and dependent never launched", async () => fixture({ failure: { conflict: true } }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.reason_code, "INTEGRATION_CONFLICT"); assert.ok(!f.operations.includes("claim:c"));
}));
await check("wrong final tested SHA cannot complete a run", async () => fixture({ tasks: [task("a")] }, async f => {
  const validateRun = f.callbacks.validateRun;
  const result = await f.create({ validateRun: async context => (await validateRun(context)).map(check => ({ ...check, tested_sha: "f".repeat(40) })) }).run(f.options);
  assert.equal(result.reason_code, "RUN_VALIDATION_INVALID"); assert.equal(f.state.final_validation, null);
}));
await check("missing audit criterion cannot complete a run", async () => fixture({ tasks: [task("a")] }, async f => {
  const result = await f.create({ auditRun: async ({ integratedSha }) => ({ read_only: true, tested_sha: integratedSha, checks: [] }) }).run(f.options);
  assert.equal(result.reason_code, "RUN_VALIDATION_INVALID"); assert.equal(f.state.final_validation, null);
}));
await check("resume after durable final validation reuses that exact evidence", async () => fixture({ tasks: [task("a")], failure: { finish: true } }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "recovery_required");
  f.state.supervision.current.lease_live = false;
  const expected = structuredClone(f.state.final_validation);
  const resumed = await f.create({ validateRun: async () => { throw new Error("must not repeat final validation"); } }).resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.status, "completed", resumed.reason_code); assert.deepEqual(f.state.final_validation, expected);
}));
await check("failed recovery persistence reports unknown durable state without takeover", async () => fixture({ tasks: [task("a")], failure: { invalidate: true } }, async f => {
  const result = await f.create({ validateTask: async () => { throw new Error("local failure"); } }).run(f.options);
  assert.equal(result.status, "recovery_required"); assert.equal(result.durable_state_known, false);
  assert.equal(f.operations.filter(item => item === "invalidateRun").length, 1);
  assert.equal(f.state.run.lifecycle_status, "running");
}));
await check("an executor object cannot be reused across attempts", async () => fixture({}, async f => {
  let shared;
  const result = await f.create({ createExecutor: async context => shared ??= await f.callbacks.createExecutor(context) }).run(f.options);
  assert.equal(result.reason_code, "EXECUTOR_INSTANCE_REUSED");
}));
await check("external cancellation stops work without starting dependents", async () => fixture({ failure: { workerDelay: 50 } }, async f => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15);
  try { const result = await f.create().run({ ...f.options, signal: controller.signal }); assert.equal(result.status, "cancelled", result.reason_code); }
  finally { clearTimeout(timer); }
  assert.ok(!f.operations.includes("claim:c"));
}));
await check("cancellation bounds an executor that never settles", async () => fixture({ tasks: [task("a")] }, async f => {
  const controller = new AbortController();
  const result = await f.create({ shutdownTimeoutMs: 8, createExecutor: async context => {
    const value = await f.callbacks.createExecutor(context);
    value.executor.runTask = async () => { setTimeout(() => controller.abort(), 5); return new Promise(() => {}); };
    return value;
  } }).run({ ...f.options, signal: controller.signal });
  assert.equal(result.status, "recovery_required"); assert.equal(result.reason_code, "WORKER_SHUTDOWN_UNCONFIRMED");
  assert.equal(f.state.attempts[0].result, null);
}));
await check("durable run deadline bounds an executor that ignores abort", async () => fixture({ tasks: [task("a")] }, async f => {
  f.state.run_deadline_at = new Date(Date.now() + 45).toISOString();
  const began = performance.now();
  const result = await f.create({ shutdownTimeoutMs: 8, createExecutor: async context => {
    const value = await f.callbacks.createExecutor(context); value.executor.runTask = async () => new Promise(() => {}); return value;
  } }).run(f.options);
  assert.equal(result.reason_code, "WORKER_SHUTDOWN_UNCONFIRMED"); assert.ok(performance.now() - began < 1000);
}));
for (const phase of ["prepareAttempt", "createExecutor", "validateTask", "validateRun", "auditRun"]) {
  await check(`cancellation bounds a nonsettling ${phase} callback`, async () => fixture({ tasks: [task("a")] }, async f => {
    const controller = new AbortController(), began = performance.now();
    const result = await f.create({ shutdownTimeoutMs: 8, [phase]: async () => {
      setTimeout(() => controller.abort(), 5); return new Promise(() => {});
    } }).run({ ...f.options, signal: controller.signal });
    assert.equal(result.status, "recovery_required"); assert.ok(performance.now() - began < 1000);
  }));
}
if (process.argv.includes("--synthetic-only")) checks.push({ name: "two real child processes overlap and dependent reads real integrated files", status: "SKIP", detail: "Explicit synthetic-only selection" });
else await check("two real child processes overlap and dependent reads real integrated files", async () => fixture({ realGit: true }, async f => {
  const result = await f.create().run(f.options); assert.equal(result.status, "completed", result.reason_code);
  const [a, b, c] = f.children;
  assert.notEqual(a.pid, b.pid); assert.ok(a.ended > b.started && b.ended > a.started);
  assert.ok(c.started >= a.ended && c.started >= b.ended); assert.equal(f.maxLive, 2);
  assert.equal(f.gitCommand(["show", `${f.state.integration_head.sha}:c.txt`]), "ab");
  assert.equal(f.gitCommand(["status", "--porcelain"]), "");
}));
if (!process.argv.includes("--synthetic-only")) await check("real Git resumes an already created task commit without reexecuting worker", async () => fixture({ realGit: true, tasks: [task("a")], barrier: false }, async f => {
  const first = await f.create({ validateTask: async () => { throw new Error("crash after commit"); } }).run(f.options);
  assert.equal(first.status, "recovery_required"); assert.equal(f.children.length, 1);
  const resumed = await f.create().resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.status, "completed", resumed.reason_code); assert.equal(f.children.length, 1);
  assert.equal(f.operations.filter(item => item === "bootstrap:a").length, 1);
  assert.equal(f.gitCommand(["show", `${f.state.integration_head.sha}:a.txt`]), "a");
}));
if (!process.argv.includes("--synthetic-only")) await check("real Git preserves preparation interrupted before the durable journal on resume", async () => fixture({ realGit: true, tasks: [task("a")], barrier: false }, async f => {
  const integrations = [], resourcesRoot = path.join(f.root, "resources");
  const observingGit = git => ({ ...git, prepareIntegration: async args => {
    integrations.push(args.integrationId); return git.prepareIntegration(args);
  } });
  const first = await f.create({ git: observingGit(f.git), store: { ...f.store, prepareIntegration: async () => {
    throw Object.assign(new Error("CRASH_BEFORE_JOURNAL"), { code: "CRASH_BEFORE_JOURNAL" });
  } } }).run(f.options);
  assert.equal(first.reason_code, "CRASH_BEFORE_JOURNAL"); assert.equal(first.durable_state_known, false);
  assert.equal(f.state.integrations.length, 0); assert.equal(integrations.length, 1);
  const names = fs.readdirSync(resourcesRoot).filter(name => name.startsWith("integration-") || name.startsWith("prepared-")).sort();
  assert.equal(names.filter(name => name.startsWith("integration-")).length, 1);
  const preparedName = names.find(name => name.startsWith("prepared-")); assert.ok(preparedName);
  const preparedBytes = fs.readFileSync(path.join(resourcesRoot, preparedName));
  const worktrees = f.gitCommand(["worktree", "list", "--porcelain"]);
  const ref = f.state.integration_head.ref;
  assert.equal(f.gitCommand(["rev-parse", ref]), f.plan.base.sha);
  // The fixture supplies explicit old-supervisor termination evidence after
  // lease expiry. A fresh adapter and scheduler model the restarted process.
  f.state.supervision.current.lease_live = false;
  const restartedGit = createLocalAgentGitIntegration({ repositoryRoot: path.join(f.root, "repository"), resourcesRoot,
    integrationRef: ref, verifyTermination: async () => ({ confirmed: false }) });
  const resumed = await f.create({ git: observingGit(restartedGit) }).resume({ ...f.options, reconciliation: proof });
  assert.equal(resumed.reason_code, "AGENT_GIT_PREPARATION_EXISTS"); assert.equal(resumed.status, "recovery_required");
  assert.deepEqual(integrations, [integrations[0], integrations[0]]);
  assert.equal(f.state.integrations.length, 0); assert.equal(f.children.length, 1);
  assert.deepEqual(fs.readdirSync(resourcesRoot).filter(name => name.startsWith("integration-") || name.startsWith("prepared-")).sort(), names);
  assert.deepEqual(fs.readFileSync(path.join(resourcesRoot, preparedName)), preparedBytes);
  assert.equal(f.gitCommand(["worktree", "list", "--porcelain"]), worktrees);
  assert.equal(f.gitCommand(["rev-parse", ref]), f.plan.base.sha);
}));


const strictVerification={runner:{id:"fixture",executable_sha256:"a".repeat(64)},environment_sha256:"b".repeat(64),
  control_files:[{path:"seed.txt",sha256:"c".repeat(64),git_mode:"100644"}],audit_policy_sha256:"d".repeat(64),
  proof_authority_sha256:"e".repeat(64),limits:{max_duration_ms:30000,max_output_bytes:4096}};
if (!process.argv.includes("--synthetic-only")) await check("real Git adopts exact prejournal preparation under its durable intention", async()=>fixture({realGit:true,tasks:[task("a")],barrier:false,verification:strictVerification},async f=>{
  let prepares=0;
  const observe=git=>({...git,prepareIntegration:async args=>{prepares++;return git.prepareIntegration(args);}});
  const first=await f.create({git:observe(f.git),store:{...f.store,prepareIntegration:async()=>{throw Object.assign(new Error("CRASH_BEFORE_JOURNAL"),{code:"CRASH_BEFORE_JOURNAL"});}}}).run(f.options);
  assert.equal(first.reason_code,"CRASH_BEFORE_JOURNAL");assert.equal(f.state.integration_intents.length,1);assert.equal(f.state.integrations.length,0);
  const row=f.state.integration_intents[0],resourcesRoot=path.join(f.root,"resources");
  assert.equal(row.status,"reserved");assert.equal(prepares,1);
  const names=fs.readdirSync(resourcesRoot).filter(name=>name.startsWith("prepared-"));assert.equal(names.length,1);
  const bytes=fs.readFileSync(path.join(resourcesRoot,names[0]));
  f.state.supervision.current.lease_live=false;
  const git=createLocalAgentGitIntegration({repositoryRoot:path.join(f.root,"repository"),resourcesRoot,
    integrationRef:f.state.integration_head.ref,verifyTermination:async()=>({confirmed:false})});
  const resumed=await f.create({git:observe(git)}).resume({...f.options,reconciliation:proof});
  assert.equal(resumed.status,"completed",resumed.reason_code);assert.equal(prepares,1);assert.equal(f.children.length,1);
  assert.equal(f.state.integration_intents[0].status,"applied");assert.equal(f.state.integrations.length,1);
  assert.equal(f.state.integrations[0].prepared.prepared_by.generation,1);
  assert.equal(f.state.supervision.current.ownership.generation,2);
  assert.deepEqual(fs.readFileSync(path.join(resourcesRoot,names[0])),bytes);
}));
if (!process.argv.includes("--synthetic-only")) await check("real Git resumes an intention whose preparation never started",async()=>fixture({realGit:true,tasks:[task("a")],barrier:false,verification:strictVerification},async f=>{
  const first=await f.create({git:{...f.git,prepareIntegration:async()=>{throw Object.assign(new Error("CRASH_BEFORE_GIT"),{code:"CRASH_BEFORE_GIT"});}}}).run(f.options);
  assert.equal(first.reason_code,"CRASH_BEFORE_GIT");assert.equal(f.state.integration_intents.length,1);assert.equal(f.state.integrations.length,0);
  const expected=structuredClone(f.state.integration_intents[0].intent);
  const resumed=await f.create().resume({...f.options,reconciliation:proof});
  assert.equal(resumed.status,"completed",resumed.reason_code);assert.equal(f.children.length,1);
  assert.deepEqual(f.state.integration_intents[0].intent,expected);
  assert.equal(f.state.integrations[0].prepared.prepared_by.generation,2);
}));
await check("validation callbacks receive immutable run and result identities",async()=>fixture({tasks:[task("a")]},async f=>{
  const seen=[];
  const options=Object.fromEntries(["validateTask","validateRun","auditRun"].map(name=>[name,async args=>{seen.push({name,args:structuredClone({...args,signal:undefined})});return f.callbacks[name](args);} ]));
  const result=await f.create(options).run(f.options);assert.equal(result.status,"completed",result.reason_code);
  assert.deepEqual(seen.map(item=>item.args.runId),[f.options.runId,f.options.runId,f.options.runId]);
  assert.match(seen[0].args.resultSha256,/^[a-f0-9]{64}$/);
  assert.equal(seen[1].args.integrationSequence,1);assert.equal(seen[2].args.integrationSequence,1);
}));
await check("already applied recovery records fact without another Git CAS",async()=>fixture({tasks:[task("a")],failure:{afterCas:true}},async f=>{
  let cas=0;const original=f.git.compareAndSwapIntegration;
  f.git.compareAndSwapIntegration=async(...args)=>{cas++;return original(...args);};
  await f.create().run(f.options);assert.equal(cas,1);f.state.supervision.current.lease_live=false;
  const resumed=await f.create().resume({...f.options,reconciliation:proof});
  assert.equal(resumed.status,"completed",resumed.reason_code);assert.equal(cas,1);
}));


await check("expired run can reconcile an applied SHA but cannot resume or complete",async()=>fixture({tasks:[task("a")],failure:{afterCas:true}},async f=>{
  let cas=0;const original=f.git.compareAndSwapIntegration;
  f.git.compareAndSwapIntegration=async(...args)=>{cas++;return original(...args);};
  await f.create().run(f.options);assert.equal(cas,1);
  f.state.supervision.current.lease_live=false;f.state.run_deadline_at=new Date(Date.now()-1000).toISOString();
  const resumed=await f.create().resume({...f.options,reconciliation:proof});
  assert.equal(resumed.status,"recovery_required");assert.equal(resumed.reason_code,"RUN_DEADLINE_EXCEEDED");
  assert.ok(f.state.integrations[0].applied);assert.equal(cas,1);
  assert.ok(!f.operations.includes("resumeRun"));assert.ok(!f.operations.includes("finish:completed"));
}));
await check("cancelled resume does not acquire a new generation",async()=>fixture({tasks:[task("a")],failure:{afterCas:true}},async f=>{
  await f.create().run(f.options);const generation=f.state.supervision.current.ownership.generation;
  const controller=new AbortController();controller.abort();
  const resumed=await f.create().resume({...f.options,reconciliation:proof,signal:controller.signal});
  assert.equal(resumed.status,"recovery_required");assert.equal(f.state.supervision.current.ownership.generation,generation);
}));


await check("durable cancellation before launch finishes without a worker", async () => fixture({}, async f => {
  f.state.cancel_request = { request_sha256: "a".repeat(64) };
  let drainOnly = null; const original = f.store.claimSupervisor;
  f.store.claimSupervisor = async value => { drainOnly = value.drainOnly; return original(value); };
  const outcome = await f.create().run(f.options);
  assert.equal(outcome.status, "cancelled", outcome.reason_code); assert.equal(drainOnly, true);
  assert.equal(f.state.attempts.length, 0); assert.ok(!f.operations.some(value => value.startsWith("start:")));
}));
await check("durable cancellation heartbeat drains results before finishing", async () => {
  const clock = { now: () => performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms === 10000 ? 4 : ms), clearTimeout };
  await fixture({ failure: { workerDelay: 30 }, clock }, async f => {
    const original = f.store.renewSupervisor;
    f.store.renewSupervisor = async () => { f.state.cancel_request = { request_sha256: "a".repeat(64) }; return original(); };
    const outcome = await f.create().run(f.options);
    assert.equal(outcome.status, "cancelled", outcome.reason_code);
    assert.ok(f.operations.includes("renewSupervisor")); assert.equal(f.state.attempts.length, 2);
    assert.ok(f.state.attempts.every(row => row.result.outcome === "cancelled" && row.termination.confirmed));
    assert.ok(f.operations.indexOf("result:a") < f.operations.indexOf("finish:cancelled"));
    assert.ok(!f.operations.includes("claim:c")); assert.equal(f.state.acceptances.length, 0);
  });
});
await check("cancelled recovery drains instead of resuming or retrying", async () => fixture({ concurrency: 1, failure: { indeterminate: "a" } }, async f => {
  await f.create().run(f.options);
  f.state.cancel_request = { request_sha256: "a".repeat(64) };
  const outcome = await f.create().resume({ ...f.options, reconciliation: { ...proof,
    attempts: [{ attemptId: f.state.attempts[0].attempt.attempt_id, proof: { confirmed: true } }] } });
  assert.equal(outcome.status, "cancelled", outcome.reason_code);
  assert.ok(!f.operations.includes("resumeRun")); assert.ok(!f.operations.includes("claim:b"));
  assert.equal(f.operations.filter(value => value === "claim:a").length, 1);
}));


await check("reserved run resumes before first supervisor claim", async () => fixture({}, async f => {
  const observation = assertUnclaimedAgentRun(f.state);
  const outcome = await f.create().resume({ ...f.options, reconciliation: { unclaimedRun: observation } });
  assert.equal(outcome.status, "completed", outcome.reason_code);
  assert.equal(f.operations.filter(value => value === "claimSupervisor").length, 1);
  assert.ok(!f.operations.includes("reconcileSupervisor") && !f.operations.includes("resumeRun"));
}));
await check("reserved cancellation resumes only to drain without launch", async () => fixture({}, async f => {
  f.state.cancel_request = { request_sha256: "a".repeat(64) };
  let drainOnly = false; const original = f.store.claimSupervisor;
  f.store.claimSupervisor = async value => { drainOnly = value.drainOnly; return original(value); };
  const outcome = await f.create().resume({ ...f.options, reconciliation: { unclaimedRun: assertUnclaimedAgentRun(f.state) } });
  assert.equal(outcome.status, "cancelled", outcome.reason_code); assert.equal(drainOnly, true);
  assert.equal(f.state.attempts.length, 0); assert.ok(!f.operations.includes("resumeRun"));
}));
await check("unclaimed resume refuses absent or stale observation and hidden history", async () => {
  for (const mutate of [f => null, f => ({ ...assertUnclaimedAgentRun(f.state), control_revision: 99 }),
    f => { const value = assertUnclaimedAgentRun(f.state); f.state.supervision.history.push({}); return value; }]) {
    await fixture({}, async f => {
      const unclaimedRun = mutate(f), outcome = await f.create().resume({ ...f.options, reconciliation: { unclaimedRun } });
      assert.equal(outcome.status, "recovery_required"); assert.match(outcome.reason_code, /UNCLAIMED_RUN_/);
      assert.ok(!f.operations.includes("claimSupervisor")); assert.equal(f.state.attempts.length, 0);
    });
  }
});

const failed = checks.filter(check => check.status === "FAIL");
console.log(JSON.stringify({ ok: !failed.length, checks, evidence: {
  scheduler_doubles: checks.some(check => !check.name.startsWith("real Git") && !check.name.startsWith("two real") && check.status === "FAIL") ? "FAIL" : "PASS",
  real_child_processes: checks.find(check => check.name.startsWith("two real")).status,
  real_git_recovery: checks.find(check => check.name.startsWith("real Git"))?.status ?? "SKIP",
  real_git_prejournal_recovery: checks.find(check => check.name.startsWith("real Git preserves preparation"))?.status ?? "SKIP",
  postgres: "NOT_RUN", native_codex: "NOT_RUN", os_confinement: "NOT_RUN", cleanup: "verified per fixture",
} }, null, 2));
if (failed.length) process.exitCode = 1;
