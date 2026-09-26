import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import pg from "pg";
import { withEphemeralPostgres } from "./agent-execution-postgres-test-lib.mjs";
import { createPostgresAgentExecutionStore } from "../../src/adapters/runtime/postgres-agent-execution-store.mjs";
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";
import { executePostgresArtifactCommand } from "../../src/adapters/runtime/postgres-artifact-command-lib.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { getPostgresRuntimeRelationalSchemaFile } from "../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs";
import { getPostgresSharedCoordinationSchemaFile } from "../../src/application/runtime/postgres-shared-coordination-contract-service.mjs";
import { fingerprintAgentExecutionValue, normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url), "utf8"));
const childFile = fileURLToPath(new URL("./agent-execution-postgres-child.mjs", import.meta.url));
const children = new Set();
const clusterRoots = new Set();
const checks = [];
let currentCheck = "preconditions";
let serial = 0;
const id = prefix => `${prefix}.${++serial}`;
const sha = text => createHash("sha256").update(text).digest("hex");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = async (name, operation) => {
  currentCheck = name;
  await operation();
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
};
const reject = (operation, code) => assert.rejects(operation, error => error.code === code || error.message === code);

function spawnParticipant() {
  const child = fork(childFile, [], { cwd: path.dirname(childFile), windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  children.add(child);
  let readyResolve, resultResolve, aliveResolve, rejectAll;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; rejectAll = reject; });
  const result = new Promise(resolve => { resultResolve = resolve; });
  const alive = new Promise(resolve => { aliveResolve = resolve; });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => { children.delete(child); resolve({ code, signal }); }));
  child.on("message", message => {
    if (message.type === "ready") readyResolve(message);
    if (message.type === "result") resultResolve(message);
    if (message.type === "alive") aliveResolve(message);
  });
  child.once("error", () => rejectAll(new Error("POSTGRES_FIXTURE_CHILD_START_FAILED")));
  child.once("exit", () => { rejectAll(new Error("POSTGRES_FIXTURE_CHILD_EXITED")); });
  return { child, ready, result, alive, exited };
}

async function bounded(promise, milliseconds = 20000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => rejectTimeout(new Error("POSTGRES_FIXTURE_PROCESS_TIMEOUT")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function drainChildren() {
  const pending = [...children].map(child => {
    const exited = new Promise(resolve => child.once("exit", resolve));
    // The fixture participants have no descendants. Only owned children are
    // targeted; their exit events, not kill()'s return value, establish death.
    child.kill();
    return exited;
  });
  await bounded(Promise.all(pending), 10000);
  assert.equal(children.size, 0, "all fixture participants must have exited");
}

async function race(connectionString, mode, argumentsList) {
  const participants = argumentsList.map(() => spawnParticipant());
  const ready = await bounded(Promise.all(participants.map(participant => participant.ready)));
  assert.equal(new Set(ready.map(value => value.pid)).size, participants.length);
  // The release is sent only after every distinct process reached the barrier.
  participants.forEach((participant, index) => participant.child.send({ mode, connectionString, args: argumentsList[index] }));
  const results = await bounded(Promise.all(participants.map(participant => participant.result)));
  for (const participant of participants) assert.equal((await bounded(participant.exited)).code, 0);
  return results;
}

async function runSuite({ connectionString, version, root }) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const storeOptions = { connectionString, verifyActivation: () => true, verifyTermination: (_attempt, proof) => proof?.fixtureConfirmed === true };
  const store = createPostgresAgentExecutionStore(storeOptions);
  const shared = createPostgresSharedCoordinationStore({ connectionString });
  const ddlCount = async () => Number((await client.query("SELECT count(*) AS count FROM public.ddl_observations")).rows[0].count);
  const dataSnapshot = async () => fingerprintAgentExecutionValue((await client.query(`SELECT
    (SELECT jsonb_agg(t ORDER BY project_id,workspace_id) FROM aidn_shared.workspace_registry t) AS workspaces,
    (SELECT jsonb_agg(t ORDER BY project_id,workspace_id,worktree_id) FROM aidn_shared.worktree_registry t) AS worktrees,
    (SELECT jsonb_agg(t ORDER BY project_id,workspace_id,planning_key) FROM aidn_shared.planning_states t) AS planning,
    (SELECT jsonb_agg(t ORDER BY scope_key,path) FROM aidn_runtime.artifacts t) AS artifacts,
    (SELECT jsonb_agg(t ORDER BY run_id) FROM aidn_shared.execution_runs t) AS runs,
    (SELECT jsonb_agg(t ORDER BY attempt_id) FROM aidn_shared.execution_attempts t) AS attempts,
    (SELECT jsonb_agg(t ORDER BY run_id,task_id) FROM aidn_shared.execution_tasks t) AS tasks,
    (SELECT jsonb_agg(t ORDER BY attempt_id,event_id) FROM aidn_shared.execution_events t) AS events`)).rows[0]);
  async function seed({ concurrency = 2, reserve = true, options = {} } = {}) {
    const key = id("scenario"), text = `# Fixture backlog ${key}\n`;
    const raw = structuredClone(fixture.plan);
    delete raw.plan_sha256;
    raw.plan_id = `plan.${key}`;
    Object.assign(raw.canonical, { project_id: `project.${key}`, workspace_id: `workspace.${key}`, runtime_scope_id: `scope.${key}`, plan_ref: "docs/audit/BACKLOG.md", plan_sha256: sha(text) });
    raw.limits.concurrency = concurrency;
    const plan = normalizeAgentExecutionPlan(raw), runId = `run.${key}`, planningKey = `planning.${key}`;
    const c = plan.canonical;
    assert.equal((await shared.registerWorkspace({ projectId: c.project_id, workspaceId: c.workspace_id })).ok, true);
    assert.equal((await shared.upsertPlanningState({ projectId: c.project_id, workspaceId: c.workspace_id, planningKey, sessionId: c.session_id,
      backlogArtifactRef: c.plan_ref, backlogArtifactSha256: c.plan_sha256 })).ok, true);
    await client.query("UPDATE aidn_shared.planning_states SET revision=7 WHERE project_id=$1 AND workspace_id=$2 AND planning_key=$3", [c.project_id,c.workspace_id,planningKey]);
    await client.query("INSERT INTO aidn_runtime.index_meta(scope_key,key,value) VALUES($1,'fixture','present')", [c.runtime_scope_id]);
    await client.query(`INSERT INTO aidn_runtime.artifacts(scope_key,artifact_id,path,kind,content_format,content,sha256,size_bytes,mtime_ns,updated_at)
      VALUES($1,1,'BACKLOG.md','backlog','utf8',$2,$3,$4,0,clock_timestamp())`, [c.runtime_scope_id,text,c.plan_sha256,Buffer.byteLength(text)]);
    const selected = createPostgresAgentExecutionStore({ ...storeOptions, ...options });
    const digest = await selected.readCanonicalDigest({ scopeKey: c.runtime_scope_id });
    const reservation = { plan, runId, planningKey, canonicalSnapshotSha256: digest.canonical_snapshot_sha256 };
    if (reserve) await selected.reserveRun(reservation);
    return { store: selected, plan, runId, planningKey, reservation };
  }
  function claimArgs(context, taskId = "alpha") {
    const attemptId = id("attempt");
    return { runId: context.runId, taskId, ownerId: "supervisor.fixture", attemptId, inputSha: context.plan.base.sha,
      worktree: { worktree_id: id("worktree"), cwd: path.join(root, "worktrees espace été", attemptId), branch: `codex/${attemptId}` } };
  }
  async function claim(context, taskId = "alpha") { return context.store.claimAttempt(claimArgs(context, taskId)); }
  function requestFor(context, claimed) {
    const { attempt, delegation } = claimed;
    const request = structuredClone(fixture.request);
    for (const key of ["run_id","task_id","attempt_id","plan_sha256","task_contract_sha256","input_sha","ownership"]) request[key] = attempt[key];
    Object.assign(request, { delegation_id: delegation.delegation_id, delegation_sha256: fingerprintAgentExecutionValue(delegation), cwd: attempt.worktree.cwd,
      execution: context.plan.execution, limits: { max_duration_ms: context.plan.tasks.find(task => task.task_id === attempt.task_id).max_duration_ms } });
    return request;
  }
  function resultFor(claimed, request, outcome = "completed", terminationState = "confirmed") {
    const result = structuredClone(fixture.result);
    for (const key of ["run_id","task_id","attempt_id","plan_sha256","task_contract_sha256","input_sha","ownership"]) result[key] = claimed.attempt[key];
    Object.assign(result, { delegation_id: claimed.delegation.delegation_id, request_sha256: fingerprintAgentExecutionValue(request), outcome,
      termination_state: terminationState, process: { exit_code: terminationState === "confirmed" ? (outcome === "completed" ? 0 : 1) : null, signal: null }, evidence: [] });
    return result;
  }
  const runner = () => ({ runner_id: id("runner"), pid: process.pid, host_id: "host.fixture", started_at: new Date().toISOString() });
  const owned = claimed => ({ attemptId: claimed.attempt.attempt_id, ownership: claimed.attempt.ownership });
  async function launch(context, claimed) {
    const request = requestFor(context, claimed);
    await context.store.recordLaunchIntent({ ...owned(claimed), request });
    await context.store.observeRunner({ ...owned(claimed), runner: runner() });
    return request;
  }
  const expire = claimed => client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE attempt_id=$1", [claimed.attempt.attempt_id]);
  try {
    await check("missing schema is unavailable without implicit DDL", async () => {
      assert.equal((await store.checkReadiness()).ready, false);
      await reject(store.getRun({ runId: "absent" }), "AGENT_EXECUTION_SCHEMA_NOT_READY");
      assert.equal((await client.query("SELECT to_regnamespace('aidn_shared') AS ns")).rows[0].ns, null);
    });
    await client.query(fs.readFileSync(getPostgresRuntimeRelationalSchemaFile(), "utf8"));
    await client.query("INSERT INTO aidn_runtime.schema_migrations(schema_name,schema_version) VALUES('aidn_runtime',3)");
    await client.query(fs.readFileSync(getPostgresSharedCoordinationSchemaFile(), "utf8"));
    await client.query("INSERT INTO aidn_shared.schema_migrations(schema_name,schema_version) VALUES('aidn_shared',2)");
    assert.equal((await shared.registerWorkspace({ projectId: "sentinel.project", workspaceId: "sentinel.workspace" })).ok, true);
    await client.query(`CREATE TABLE public.ddl_observations(tag text NOT NULL);
      CREATE FUNCTION public.record_fixture_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.ddl_observations(tag) VALUES(TG_TAG); END $$;
      CREATE EVENT TRIGGER fixture_ddl ON ddl_command_end EXECUTE FUNCTION public.record_fixture_ddl();`);
    await check("two-process migration applies v3 once and preserves v2 data", async () => {
      const sentinel = (await client.query("SELECT * FROM aidn_shared.workspace_registry WHERE workspace_id='sentinel.workspace'")).rows;
      const results = await race(connectionString, "migrate", [{},{}]);
      assert.deepEqual(results.map(value => value.ok), [true,true]);
      assert.deepEqual((await client.query("SELECT schema_version FROM aidn_shared.schema_migrations ORDER BY schema_version")).rows.map(row => row.schema_version), [2,3]);
      assert.deepEqual((await client.query("SELECT * FROM aidn_shared.workspace_registry WHERE workspace_id='sentinel.workspace'")).rows, sentinel);
      assert.equal(Number((await client.query("SELECT count(*) AS count FROM public.ddl_observations WHERE tag='CREATE TABLE'")).rows[0].count), 4);
      const before = await ddlCount();
      assert.equal((await shared.bootstrap()).ok, true);
      assert.equal(await ddlCount(), before);
      assert.equal((await store.checkReadiness()).ready, true);
    });
    await check("readiness and read operations leave all existing state unchanged", async () => {
      const context = await seed();
      const before = await dataSnapshot(), ddl = await ddlCount();
      await store.checkReadiness(); await store.getRun({ runId: context.runId });
      await store.readCanonicalDigest({ scopeKey: context.plan.canonical.runtime_scope_id });
      await shared.healthcheck();
      assert.equal(await dataSnapshot(), before); assert.equal(await ddlCount(), ddl);
    });
    await check("two-process scope reservation has exactly one owner", async () => {
      const context = await seed({ reserve: false });
      const results = await race(connectionString, "reserveRun", [context.reservation, { ...context.reservation, runId: id("competing") }]);
      assert.equal(results.filter(value => value.ok).length, 1);
      assert.equal(results.find(value => !value.ok).code, "AGENT_EXECUTION_CONFLICT");
    });
    await check("two-process task claim has one attempt and enforces concurrency", async () => {
      const context = await seed({ concurrency: 1 });
      const results = await race(connectionString, "claimAttempt", [claimArgs(context),claimArgs(context)]);
      assert.equal(results.filter(value => value.ok).length, 1);
      assert.equal(results.find(value => !value.ok).code, "AGENT_EXECUTION_EXPLICIT_RETRY_REQUIRED");
      assert.equal((await store.getRun({ runId: context.runId })).attempts.length, 1);
      await reject(claim(context, "beta"), "AGENT_EXECUTION_CONCURRENCY_LIMIT");
      await reject(claim(context, "join"), "AGENT_EXECUTION_DEPENDENCY_PROOF_REQUIRED");
    });
    await check("launch intent survives reconnect and runner observation requires it", async () => {
      const context = await seed(), claimed = await claim(context), args = owned(claimed);
      await reject(store.observeRunner({ ...args, runner: runner() }), "AGENT_EXECUTION_LAUNCH_INTENT_REQUIRED");
      const request = requestFor(context, claimed);
      await store.recordLaunchIntent({ ...args, request });
      const reconnected = createPostgresAgentExecutionStore(storeOptions);
      assert.deepEqual((await reconnected.getRun({ runId: context.runId })).attempts[0].request, request);
      await store.recordLaunchIntent({ ...args, request });
      await reject(store.recordLaunchIntent({ ...args, request: { ...request, instruction: "different" } }), "AGENT_EXECUTION_LAUNCH_INTENT_CONFLICT");
      const observed = runner(); await store.observeRunner({ ...args, runner: observed });
      await reject(store.observeRunner({ ...args, runner: runner() }), "AGENT_EXECUTION_RUNNER_CONFLICT");
      const before = await ddlCount(); await store.renewAttempt(args); assert.equal(await ddlCount(), before);
      for (const field of ["generation", "planning_revision"]) {
        await reject(store.renewAttempt({ ...args, ownership: { ...args.ownership, [field]: args.ownership[field]+1 } }), "AGENT_EXECUTION_OWNERSHIP_LOST");
      }
    });
    await check("event and result bindings are immutable and replay after closure is read only", async () => {
      const context = await seed(), claimed = await claim(context), request = await launch(context, claimed), args = owned(claimed);
      const event = { ...fixture.event, event_id: id("event"), ...Object.fromEntries(["run_id","task_id","attempt_id","plan_sha256"].map(key => [key, claimed.attempt[key]])) };
      assert.equal((await store.appendEvent({ ...args, event })).idempotent, false);
      assert.equal((await store.appendEvent({ ...args, event })).idempotent, true);
      await reject(store.appendEvent({ ...args, event: { ...event, message: "divergent" } }), "AGENT_EXECUTION_EVENT_CONFLICT");
      await reject(store.appendEvent({ ...args, event: { ...event, event_id: id("event"), sequence: 3 } }), "AGENT_EXECUTION_EVENT_SEQUENCE_INVALID");
      const result = resultFor(claimed, request);
      await reject(store.recordResult({ ...args, result: { ...result, request_sha256: "f".repeat(64) }, terminationProof: { fixtureConfirmed: true } }), "AGENT_EXECUTION_BINDING_INVALID");
      await reject(store.recordResult({ ...args, result, terminationProof: { fixtureConfirmed: false } }), "AGENT_EXECUTION_TERMINATION_UNCONFIRMED");
      await store.recordResult({ ...args, result, terminationProof: { fixtureConfirmed: true } });
      await reject(store.finishRun({ runId: context.runId, outcome: "completed" }), "AGENT_EXECUTION_ACCEPTANCE_REQUIRED");
      await store.finishRun({ runId: context.runId, outcome: "cancelled" });
      const before = await dataSnapshot();
      assert.equal((await store.appendEvent({ ...args, event })).idempotent, true);
      assert.equal(await dataSnapshot(), before);
      await reject(store.appendEvent({ ...args, event: { ...event, event_id: id("event"), sequence: 2 } }), "AGENT_EXECUTION_RUN_NOT_ACTIVE");
    });
    await check("expired lease with a live process freezes spare slots and stale results", async () => {
      const context = await seed(), claimed = await claim(context), request = requestFor(context, claimed);
      await store.recordLaunchIntent({ ...owned(claimed), request });
      const participant = spawnParticipant(); await bounded(participant.ready);
      participant.child.send({ mode: "alive" }); await bounded(participant.alive);
      try {
        await store.observeRunner({ ...owned(claimed), runner: { ...runner(), pid: participant.child.pid } });
        await expire(claimed);
        const results = await race(connectionString, "claimAttempt", [claimArgs(context,"beta")]);
        assert.equal(results[0].code, "AGENT_EXECUTION_LEASE_EXPIRED");
        assert.equal(participant.child.exitCode, null);
        const snapshot = await store.getRun({ runId: context.runId });
        assert.equal(snapshot.run.lifecycle_status, "recovery_required"); assert.equal(snapshot.reservation_active, true);
        assert.equal(snapshot.attempts.length, 1);
        await reject(store.renewAttempt(owned(claimed)), "AGENT_EXECUTION_OWNERSHIP_LOST");
        await reject(store.recordResult({ ...owned(claimed), result: resultFor(claimed,request), terminationProof: { fixtureConfirmed: true } }), "AGENT_EXECUTION_OWNERSHIP_LOST");
        await reject(store.reconcileAttempt({ attemptId: claimed.attempt.attempt_id, proof: { fixtureConfirmed: false } }), "AGENT_EXECUTION_TERMINATION_UNCONFIRMED");
      } finally { participant.child.send({ type: "stop" }); await bounded(participant.exited); }
      await store.reconcileAttempt({ attemptId: claimed.attempt.attempt_id, proof: { fixtureConfirmed: true } });
      await reject(claim(context), "AGENT_EXECUTION_EXPLICIT_RETRY_REQUIRED");
      const retry = await store.claimAttempt({ ...claimArgs(context), expectedPreviousAttemptId: claimed.attempt.attempt_id });
      assert.equal(retry.attempt.ordinal, 2); assert.ok(retry.attempt.ownership.generation > claimed.attempt.ownership.generation);
    });
    await check("lease expiry during slow supervisor verification refuses renewal durably", async () => {
      let slow = false, verifiedSlowly = false;
      const context = await seed({ options: { verifyActivation: async () => { if (slow) { verifiedSlowly=true; await delay(700); } return true; } } });
      const claimed = await claim(context);
      await client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE attempt_id=$1", [claimed.attempt.attempt_id]);
      slow = true;
      await reject(context.store.renewAttempt(owned(claimed)), "AGENT_EXECUTION_LEASE_EXPIRED");
      assert.equal(verifiedSlowly,true);
      assert.equal((await store.getRun({ runId: context.runId })).run.lifecycle_status, "recovery_required");
    });
    await check("lease expiry during termination verification refuses the result durably", async () => {
      let verifiedSlowly=false;
      const context=await seed({options:{verifyTermination:async()=>{verifiedSlowly=true; await delay(700); return true;}}});
      const claimed=await claim(context),request=await launch(context,claimed);
      await client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE attempt_id=$1",[claimed.attempt.attempt_id]);
      await reject(context.store.recordResult({...owned(claimed),result:resultFor(claimed,request),terminationProof:{fixtureConfirmed:true}}),"AGENT_EXECUTION_LEASE_EXPIRED");
      assert.equal(verifiedSlowly,true);
      const snapshot=await store.getRun({runId:context.runId});
      assert.equal(snapshot.run.lifecycle_status,"recovery_required"); assert.equal(snapshot.attempts[0].result,null);
    });
    await check("termination facts and supervisor authority cannot be fabricated by a result", async () => {
      const context=await seed(),claimed=await claim(context),request=requestFor(context,claimed),args=owned(claimed);
      await store.recordLaunchIntent({...args,request});
      await reject(store.recordResult({...args,result:resultFor(claimed,request),terminationProof:{fixtureConfirmed:true}}),"AGENT_EXECUTION_RUNNER_OBSERVATION_REQUIRED");
      await store.observeRunner({...args,runner:runner()});
      await reject(store.recordResult({...args,result:resultFor(claimed,request,"failed","not_started"),terminationProof:{fixtureConfirmed:true}}),"AGENT_EXECUTION_TERMINATION_CONTRADICTION");
      const noAuthority=createPostgresAgentExecutionStore({...storeOptions,verifyTermination:null});
      await reject(noAuthority.recordResult({...args,result:resultFor(claimed,request),terminationProof:{fixtureConfirmed:true}}),"AGENT_EXECUTION_TERMINATION_VERIFIER_REQUIRED");
      const noActivation=await seed({reserve:false});
      await reject(createPostgresAgentExecutionStore({...storeOptions,verifyActivation:null}).reserveRun(noActivation.reservation),"AGENT_EXECUTION_ACTIVATION_INVALID");
      assert.equal(await store.getRun({runId:noActivation.runId}),null);
    });
    await check("planning references and content must resolve to the canonical artifact", async () => {
      const context = await seed({ reserve: false }), c = context.plan.canonical;
      await client.query("UPDATE aidn_shared.planning_states SET backlog_artifact_ref='docs/audit/OTHER.md' WHERE project_id=$1", [c.project_id]);
      await reject(store.reserveRun(context.reservation), "AGENT_EXECUTION_PLANNING_CHANGED");
      await client.query("UPDATE aidn_shared.planning_states SET backlog_artifact_ref=$2 WHERE project_id=$1", [c.project_id,c.plan_ref]);
      await client.query("UPDATE aidn_runtime.artifacts SET sha256=$2 WHERE scope_key=$1", [c.runtime_scope_id,"d".repeat(64)]);
      const oldDigest = await store.readCanonicalDigest({ scopeKey: c.runtime_scope_id });
      await reject(store.reserveRun({ ...context.reservation, canonicalSnapshotSha256: oldDigest.canonical_snapshot_sha256 }), "AGENT_EXECUTION_CANONICAL_PLAN_MISMATCH");
      assert.equal(await store.getRun({ runId: context.runId }), null);
    });
    await check("canonical targeted, bulk and planning writers refuse reserved scopes", async () => {
      const context = await seed(), c = context.plan.canonical, before = await dataSnapshot();
      await reject(executePostgresArtifactCommand(client,[c.runtime_scope_id],"upsert",{ artifact:{ path:"BACKLOG.md", content:"forbidden" } }), "ARTIFACT_EXECUTION_SCOPE_RESERVED");
      const bulk = createPostgresRuntimeArtifactStore({ connectionString, targetRoot:root, runtimeProjectContext:{ runtime_scope_id:c.runtime_scope_id,legacy_scope_key:c.runtime_scope_id } });
      await reject(bulk.writeIndexProjection({ payload:{ generated_at:new Date().toISOString(),artifacts:[],cycles:[],sessions:[],file_map:[],tags:[],artifact_tags:[] } }), "ARTIFACT_EXECUTION_SCOPE_RESERVED");
      const result = await shared.upsertPlanningState({ projectId:c.project_id,workspaceId:c.workspace_id,planningKey:context.planningKey,expectedRevision:7 });
      assert.equal(result.ok,false); assert.match(JSON.stringify(result),/SHARED_EXECUTION_SCOPE_RESERVED/);
      assert.equal(await dataSnapshot(), before);
      const other = await seed({ reserve:false }), oc=other.plan.canonical;
      const conflict = await shared.upsertPlanningState({projectId:oc.project_id,workspaceId:oc.workspace_id,planningKey:other.planningKey,expectedRevision:6});
      assert.equal(conflict.ok,false); assert.match(JSON.stringify(conflict),/SHARED_PLANNING_REVISION_CONFLICT/);
      assert.equal((await shared.upsertPlanningState({projectId:oc.project_id,workspaceId:oc.workspace_id,planningKey:other.planningKey,expectedRevision:7})).ok,true);
    });
    await check("unknown termination requires reconciliation and does not release reservation", async () => {
      const context = await seed(), claimed = await claim(context), request = await launch(context, claimed), args = owned(claimed);
      await store.recordResult({ ...args, result: resultFor(claimed,request,"indeterminate","unknown") });
      assert.equal((await store.getRun({runId:context.runId})).reservation_active,true);
      await reject(store.finishRun({runId:context.runId,outcome:"cancelled"}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      await reject(claim(context,"beta"),"AGENT_EXECUTION_RUN_NOT_ACTIVE");
      await store.reconcileAttempt({attemptId:claimed.attempt.attempt_id,proof:{fixtureConfirmed:true}});
      assert.equal((await store.finishRun({runId:context.runId,outcome:"cancelled"})).reservation_active,false);
    });
    await check("out-of-band canonical planning revision invalidates a live attempt", async () => {
      const context=await seed(),claimed=await claim(context);
      await client.query("UPDATE aidn_shared.planning_states SET revision=revision+1 WHERE project_id=$1",[context.plan.canonical.project_id]);
      await reject(context.store.renewAttempt(owned(claimed)),"AGENT_EXECUTION_PLANNING_CHANGED");
      const snapshot=await store.getRun({runId:context.runId});
      assert.equal(snapshot.run.lifecycle_status,"recovery_required"); assert.equal(snapshot.reservation_active,true);
    });
    await check("activation revocation invalidates ownership and is not reversed by process reconciliation", async () => {
      let active = true;
      const context = await seed({options:{verifyActivation:()=>active}}), claimed=await claim(context);
      active=false;
      await reject(context.store.renewAttempt(owned(claimed)),"AGENT_EXECUTION_ACTIVATION_INVALID");
      await context.store.reconcileAttempt({attemptId:claimed.attempt.attempt_id,proof:{fixtureConfirmed:true}});
      assert.equal((await store.getRun({runId:context.runId})).run.lifecycle_status,"recovery_required");
      await reject(claim(context,"beta"),"AGENT_EXECUTION_RUN_NOT_ACTIVE");
    });
    await check("explicit expiration is durable without read-side mutation or automatic claim", async () => {
      const context = await seed(), claimed=await claim(context);
      await expire(claimed);
      assert.equal((await store.getRun({runId:context.runId})).attempts[0].attempt.lifecycle_status,"launch_intended");
      const expired = await store.expireAttempts({runId:context.runId});
      assert.deepEqual(expired.expired_attempt_ids,[claimed.attempt.attempt_id]);
      assert.deepEqual((await store.expireAttempts({runId:context.runId})).expired_attempt_ids,[]);
      assert.equal((await store.getRun({runId:context.runId})).attempts.length,1);
    });
    return { version, root };
  } finally {
    try { await drainChildren(); } finally { await client.end(); }
  }
}

let clusterRoot;
try {
  const result = await withEphemeralPostgres(async context => { clusterRoot=context.root; clusterRoots.add(context.root); return runSuite(context); });
  await check("successful cluster and all child processes are removed", async () => {
    assert.equal(fs.existsSync(clusterRoot),false); assert.equal(children.size,0);
  });
  let injectedRoot;
  await check("injected failure also stops and removes its private cluster", async () => {
    let participantPid;
    await assert.rejects(withEphemeralPostgres(async context => {
      injectedRoot=context.root; clusterRoots.add(context.root);
      try {
        const participant=spawnParticipant(); await bounded(participant.ready);
        participant.child.send({ mode:"alive" }); await bounded(participant.alive);
        participantPid=participant.child.pid;
        assert.equal(participant.child.exitCode,null);
        throw new Error("FIXTURE_INJECTED_FAILURE");
      } finally { await drainChildren(); }
    }), /FIXTURE_INJECTED_FAILURE/);
    assert.ok(participantPid); assert.equal(children.size,0); assert.equal(fs.existsSync(injectedRoot),false);
  });
  process.stdout.write(JSON.stringify({ ok:true, backend:"ephemeral-postgres", version:result.version, checks:checks.length,
    cleanup:"PASS", codex_native:"SKIP", os_confinement:"SKIP", verifier_authority:"injected-supervisor-doubles" })+"\n");
} catch (error) {
  try { await drainChildren(); } catch { /* Retain unconfirmed children in diagnostics. */ }
  // The assertion's bounded message is useful, but driver/connection details
  // are intentionally excluded from this required gate's public diagnostics.
  const code = /^[A-Z_]+$/.test(error.code ?? "") ? error.code : /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "ASSERTION_OR_FIXTURE_FAILURE";
  const assertion = error instanceof assert.AssertionError ? String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]").slice(-1500) : undefined;
  process.stderr.write(JSON.stringify({ ok:false, check:currentCheck, code, assertion, passed:checks.length,
    cleanup:clusterRoots.size>0 && [...clusterRoots].every(root=>!fs.existsSync(root)) && children.size===0
      && !String(error.message).startsWith("EPHEMERAL_POSTGRES_") ? "PASS" : "UNCONFIRMED", live_children:children.size })+"\n");
  process.exitCode=1;
}
