import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import pg from "pg";
import { withEphemeralPostgres } from "./agent-execution-postgres-test-lib.mjs";
import { createSchedulerFixture } from "./agent-execution-scheduler-test-lib.mjs";
import { createVerificationFixture } from "./agent-verification-test-lib.mjs";
import { createAgentTaskIntegrationService } from "../../src/application/runtime/agent-task-integration-service.mjs";
import { createLocalAgentGitIntegration } from "../../src/adapters/runtime/local-agent-git-integration.mjs";
import { createPostgresAgentExecutionStore } from "../../src/adapters/runtime/postgres-agent-execution-store.mjs";
import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";
import { executePostgresArtifactCommand } from "../../src/adapters/runtime/postgres-artifact-command-lib.mjs";
import { createPostgresRuntimeArtifactStore } from "../../src/adapters/runtime/postgres-runtime-artifact-store.mjs";
import { getPostgresRuntimeRelationalSchemaFile } from "../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs";
import { getPostgresSharedCoordinationSchemaFile, getPostgresSharedCoordinationMigrationFiles } from "../../src/application/runtime/postgres-shared-coordination-contract-service.mjs";
import { fingerprintAgentExecutionValue, normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";
import { buildNextAidnProjectConfig } from "../../src/application/install/project-config-service.mjs";
import { writeAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";
import { writeSharedRuntimeLocator } from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url), "utf8"));
const childFile = fileURLToPath(new URL("./agent-execution-postgres-child.mjs", import.meta.url));
const children = new Set();
const clusterRoots = new Set();
const checks = [];
const selectedArguments=process.argv.slice(2);
if(selectedArguments.length && (selectedArguments.length!==1 || selectedArguments[0]!=="--lifecycle-fences"))throw new Error("POSTGRES_FIXTURE_OPTION_INVALID");
const focused=selectedArguments.length===1, skipped=[];
const lifecycleChecks=new Set([
  "missing schema is unavailable without implicit DDL",
  "two-process migration applies v3 through v6 once and preserves v2 data",
  "cooperative plan v2 survives JSONB reservation reread and claim without DDL",
  "unknown cooperative assurance is rejected before PostgreSQL writes",
  "public CLI status and planned cancellation use real PostgreSQL without native preparation",
  "cleanup rechecks Git after external observations before authority or durable results",
  "real PostgreSQL and Git scheduler overlap two children and integrate dependent output",
  "real PostgreSQL cleanup reconciles removed Git worktrees and preserves retained bytes and refs",
  "successful cluster and all child processes are removed",
  "injected failure also stops and removes its private cluster",
]);
let currentCheck = "preconditions";
const gitInspectionTimings=[];
const timedGitInspector=inspect=>async(input,options)=>{
  const started=performance.now(), timing={phase:options.phase,outcome:"pending",elapsed_ms:null};
  gitInspectionTimings.push(timing);if(gitInspectionTimings.length>8)gitInspectionTimings.shift();
  try {const value=await inspect(input,options);timing.outcome="completed";return value;}
  catch(error){timing.outcome="failed";throw error;}
  finally {timing.elapsed_ms=Math.round(performance.now()-started);}
};
let serial = 0;
const id = prefix => `${prefix}.${++serial}`;
const sha = text => createHash("sha256").update(text).digest("hex");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = async (name, operation) => {
  if(focused && !lifecycleChecks.has(name)){skipped.push(name);return;}
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
  // Process/Git authorities are explicit injected doubles. Only coordination
  // and transactions in this suite are qualified against real PostgreSQL.
  const gitStates = new Map();
  const storeOptions = { connectionString, verifyActivation: () => true, verifyTermination: (_attempt, proof) => proof?.fixtureConfirmed === true,
    verifySupervisorTermination: (_supervisor,proof) => ({ok:proof?.fixtureConfirmed===true,supervisor_stopped:true,descendants_stopped:true,git_operations_stopped:true}),
    inspectIntegration: (input,{run}) => {
      const state=gitStates.get(run.run_id);
      return {ok:true,repository_identity_sha256:state?.identity,ref:state?.ref,head_sha:state?.head,
        source_parent_sha:state?.parents.get(input.source_sha) ?? null,result_parent_sha:state?.parents.get(input.result_sha) ?? null};
    } };
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
    (SELECT jsonb_agg(t ORDER BY attempt_id,event_id) FROM aidn_shared.execution_events t) AS events,
    (SELECT jsonb_agg(t ORDER BY run_id,generation) FROM aidn_shared.execution_supervisors t) AS supervisors,
    (SELECT jsonb_agg(t ORDER BY attempt_id) FROM aidn_shared.execution_acceptances t) AS acceptances,
    (SELECT jsonb_agg(t ORDER BY run_id,sequence) FROM aidn_shared.execution_integrations t) AS integrations,
    (SELECT jsonb_agg(t ORDER BY run_id,sequence) FROM aidn_shared.execution_integration_intents t) AS integration_intents,
    (SELECT jsonb_agg(t ORDER BY run_id) FROM aidn_shared.execution_run_validations t) AS validations,
    (SELECT jsonb_agg(t ORDER BY run_id) FROM aidn_shared.execution_cancel_requests t) AS cancellations,
    (SELECT jsonb_agg(t ORDER BY run_id,generation) FROM aidn_shared.execution_cleanup_operations t) AS cleanups,
    (SELECT jsonb_agg(t ORDER BY run_id,resource_id) FROM aidn_shared.execution_cleanup_resources t) AS cleanup_resources`)).rows[0]);
  async function seed({ concurrency = 2, reserve = true, options = {}, transform = null, planInput = null, runIdOverride = null } = {}) {
    const key = id("scenario"), text = `# Fixture backlog ${key}\n`;
    const raw = structuredClone(planInput ?? fixture.plan);
    delete raw.plan_sha256;
    raw.plan_id = `plan.${key}`;
    Object.assign(raw.canonical, { project_id: `project.${key}`, workspace_id: `workspace.${key}`, runtime_scope_id: `scope.${key}`, plan_ref: "docs/audit/BACKLOG.md", plan_sha256: sha(text) });
    raw.limits.concurrency = concurrency;
    transform?.(raw);
    const plan = normalizeAgentExecutionPlan(raw), runId = runIdOverride ?? `run.${key}`, planningKey = `planning.${key}`;
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
  const admissionArgs = (claimed,request,evaluate) => ({...owned(claimed),
    requestSha256:fingerprintAgentExecutionValue(request),delegationSha256:fingerprintAgentExecutionValue(claimed.delegation),evaluate});
  const admitDecision = context => ({protocol_version:1,ok:true,outcome:"allow",reason_code:"FIXTURE_ADMISSION",
    attempt_id:context.attempt.attempt_id,request_sha256:fingerprintAgentExecutionValue(context.request)});
  async function launch(context, claimed) {
    const request = requestFor(context, claimed);
    await context.store.recordLaunchIntent({ ...owned(claimed), request });
    await context.store.observeRunner({ ...owned(claimed), runner: runner() });
    return request;
  }
  const expire = claimed => client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE attempt_id=$1", [claimed.attempt.attempt_id]);
  const evidence = () => ({ref:`proofs/${id("proof")}.json`,sha256:sha("bounded fixture evidence"),bytes:24});
  function supervisorArgs(context,expectedControlRevision=0) {
    const integration={repository_identity_sha256:sha(context.runId),ref:`refs/heads/codex/${context.runId}`,base_sha:context.plan.base.sha};
    gitStates.set(context.runId,{identity:integration.repository_identity_sha256,ref:integration.ref,head:integration.base_sha,parents:new Map()});
    return {runId:context.runId,ownerId:id("supervisor"),runner:runner(),integration,expectedControlRevision};
  }
  async function supervise(context) {
    const snapshot=await context.store.claimSupervisor(supervisorArgs(context));
    context.supervisor=snapshot.supervision.current.ownership;
    return snapshot;
  }
  async function completedTask(context,taskId="alpha",extra={}) {
    const claimed=await context.store.claimAttempt({...claimArgs(context,taskId),supervisor:context.supervisor,...extra});
    const request=requestFor(context,claimed), args={...owned(claimed),supervisor:context.supervisor};
    await context.store.recordLaunchIntent({...args,request});
    const preparation={request_sha256:fingerprintAgentExecutionValue(request),evidence:evidence()};
    await context.store.recordPreparation({...args,preparation});
    await context.store.observeRunner({...args,runner:runner()});
    const result=resultFor(claimed,request);
    const ended=await context.store.recordResult({...args,result,terminationProof:{fixtureConfirmed:true}});
    return {claimed,request,result,ended,args,preparation};
  }
  function acceptanceFor(context,task,candidateSha=sha(id("candidate")).slice(0,context.plan.base.sha.length)) {
    const acceptance=structuredClone(fixture.acceptance);
    for (const key of ["run_id","task_id","attempt_id","plan_sha256","task_contract_sha256","input_sha"]) acceptance[key]=task.claimed.attempt[key];
    const spec=context.plan.tasks.find(entry=>entry.task_id===acceptance.task_id);
    Object.assign(acceptance,{result_sha256:fingerprintAgentExecutionValue(task.result),candidate_sha:candidateSha,decision:"accepted",
      validation:{status:"passed",tested_sha:candidateSha,checks:(spec.validation_ids ?? context.plan.validations.map(item=>item.validation_id)).map(validation_id=>({validation_id,status:"passed",tested_sha:candidateSha,evidence:evidence()}))},
      integration:{status:"pending",source_sha:candidateSha,integrated_sha:null},cleanup:{status:"pending",evidence:[]}});
    gitStates.get(context.runId).parents.set(candidateSha,task.claimed.attempt.input_sha);
    return acceptance;
  }
  async function acceptedTask(context,taskId="alpha",extra={}) {
    const task=await completedTask(context,taskId,extra), acceptance=acceptanceFor(context,task);
    const accepted=await context.store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance});
    return {...task,...accepted};
  }
  async function prepareTask(context,accepted) {
    const snapshot=await context.store.getRun({runId:context.runId}), head=snapshot.integration_head;
    const integration={contract_version:"agent-integration-prepared.v1",integration_id:id("integration"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
      task_id:accepted.acceptance.task_id,attempt_id:accepted.acceptance.attempt_id,acceptance_sha256:accepted.acceptance_sha256,sequence:head.sequence+1,
      repository_identity_sha256:head.repository_identity_sha256,ref:head.ref,source_sha:accepted.acceptance.candidate_sha,parent_sha:head.sha,result_sha:sha(id("integrated")).slice(0,head.sha.length),
      prepared_by:context.supervisor,evidence:[evidence()]};
    gitStates.get(context.runId).parents.set(integration.result_sha,integration.parent_sha);
    return context.store.prepareIntegration({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,integration});
  }
  async function applyTask(context,prepared) {
    const snapshot=await context.store.getRun({runId:context.runId});
    gitStates.get(context.runId).head=prepared.integration.result_sha;
    return context.store.recordIntegrationApplied({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,
      integrationId:prepared.integration.integration_id,preparedSha256:prepared.prepared_sha256,proof:{evidence:prepared.integration.evidence}});
  }
  async function intentFor(context,accepted) {
    const snapshot=await context.store.getRun({runId:context.runId}), head=snapshot.integration_head, integrationId=id("integration");
    return {contract_version:"agent-integration-intent.v1",integration_id:integrationId,run_id:context.runId,plan_sha256:context.plan.plan_sha256,
      task_id:accepted.acceptance.task_id,attempt_id:accepted.acceptance.attempt_id,acceptance_sha256:accepted.acceptance_sha256,sequence:head.sequence+1,
      repository_identity_sha256:head.repository_identity_sha256,ref:head.ref,source_sha:accepted.acceptance.candidate_sha,parent_sha:head.sha,
      created_by:structuredClone(context.supervisor),workspace:{cwd:path.join(root,"integration",integrationId),detached:true},
      commit_identity:{name:"Fixture Supervisor",email:"fixture@example.invalid",timestamp:"2030-01-01T00:00:00.000Z"}};
  }
  async function reserveIntent(context,intent) {
    const snapshot=await context.store.getRun({runId:context.runId});
    return context.store.recordIntegrationIntent({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,intent});
  }
  function preparedForIntent(context,reserved,producer=context.supervisor) {
    const {created_by,workspace,commit_identity,...rest}=reserved.intent;
    const integration={...rest,contract_version:"agent-integration-prepared.v1",intent_sha256:reserved.intent_sha256,
      result_sha:sha(id("integrated")).slice(0,rest.parent_sha.length),prepared_by:structuredClone(producer),evidence:[evidence()]};
    gitStates.get(context.runId).parents.set(integration.result_sha,integration.parent_sha);
    return integration;
  }
  async function prepareIntent(context,reserved,integration,{reconciliation=false}={}) {
    const snapshot=await context.store.getRun({runId:context.runId});
    return context.store.prepareIntegration({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,
      intentSha256:reserved.intent_sha256,integration,reconciliation});
  }
  async function takeover(context) {
    const old=structuredClone(context.supervisor);
    await context.store.invalidateRun({runId:context.runId,supervisor:old,reason:"FIXTURE_RECOVERY"});
    const snapshot=await context.store.getRun({runId:context.runId});
    const reconciled=await context.store.reconcileSupervisor({runId:context.runId,expectedSupervisor:old,
      expectedControlRevision:snapshot.supervision.control_revision,proof:{fixtureConfirmed:true}});
    const previous=gitStates.get(context.runId), args=supervisorArgs(context,reconciled.supervision.control_revision);
    // supervisorArgs resets only the fixture Git observer; preserve factual refs.
    const claimed=await context.store.claimSupervisor({...args,expectedPreviousGeneration:old.generation});
    gitStates.set(context.runId,previous);
    context.supervisor=claimed.supervision.current.ownership;
    return {old,claimed,previous};
  }
  const verificationPolicy={runner:{id:"fixture.verifier",executable_sha256:sha("fixture executable")},environment_sha256:sha("fixture environment"),
    proof_authority_sha256:sha("fixture public key pin"),control_files:[{path:"test/verify.mjs",sha256:sha("fixture control"),git_mode:"100644"}],
    audit_policy_sha256:sha("fixture audit"),limits:{max_duration_ms:1000,max_output_bytes:4096}};
  const evidenceVerifier={getDescriptor:()=>({verifier_id:"local-agent-verification",contract_version:"agent-evidence-verification.v1",algorithm:"Ed25519"}),
    verify:input=>{
      const checks=input.phase==="task" ? input.document.validation.checks : [...input.document.checks,...input.document.audit.checks];
      return {contract_version:"agent-evidence-verification.v1",verifier_id:"local-agent-verification",phase:input.phase,run_id:input.run.run_id,
        plan_sha256:input.run.plan_sha256,policy_sha256:fingerprintAgentExecutionValue(input.plan.verification),subject_sha256:input.subject_sha256,
        tested_sha:input.expected.tested_sha,proof_authority_sha256:input.plan.verification.proof_authority_sha256,
        verified_refs:[...new Map(checks.map(check=>[check.evidence.ref,check.evidence])).values()].sort((a,b)=>a.ref.localeCompare(b.ref,"en")),
        snapshots:(input.phase==="task" ? ["task"] : ["audit","run"]).map(phase=>({phase,snapshot_sha256:sha(`snapshot:${input.run.run_id}:${input.expected.tested_sha}`),candidate_sha:input.expected.tested_sha,
          tree_sha:sha("tree").slice(0,input.expected.tested_sha.length),repository_identity_sha256:gitStates.get(input.run.run_id).identity,
          before_sha256:sha("before"),after_sha256:sha("after")}))};
    }};
  const cleanupStates=new Map();
  const cleanupOptions={
    verifyCleanupTermination:(_cleaner,proof)=>({ok:proof?.fixtureConfirmed===true,cleaner_stopped:true,descendants_stopped:true,git_operations_stopped:true}),
    inspectCleanup:(resource,{cleanup})=>({resource_id:resource.resource_id,cwd:resource.cwd,preimage_sha256:resource.preimage_sha256,
      repository_identity_sha256:cleanup.repository_identity_sha256,retention:resource.retention,exists:true,registered:true,
      clean:true,retained:true,processes_stopped:true,links_safe:true,...cleanupStates.get(resource.resource_id)}),
  };
  async function completedCleanupContext({stop=true,verification=false}={}) {
    const context=await seed({transform:plan=>{plan.tasks=[plan.tasks[0]];if(verification)plan.verification=structuredClone(verificationPolicy);},
      options:{...cleanupOptions,...(verification ? {validationEvidenceVerifier:evidenceVerifier} : {})}});
    await supervise(context);const task=await acceptedTask(context);
    if(verification){
      const reserved=await reserveIntent(context,await intentFor(context,task));
      await applyTask(context,await prepareIntent(context,reserved,preparedForIntent(context,reserved)));
    } else await applyTask(context,await prepareTask(context,task));
    let state=await context.store.getRun({runId:context.runId});const head=state.integration_head;
    const validation={contract_version:"agent-run-validation.v1",validation_id:id("cleanup.final"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
      integration_sequence:head.sequence,integrated_sha:head.sha,outcome:"passed",
      checks:context.plan.validations.map(item=>({validation_id:item.validation_id,status:"passed",tested_sha:head.sha,evidence:evidence()})),
      audit:{read_only:true,tested_sha:head.sha,checks:context.plan.audit.criteria.map((_,criterion_index)=>({criterion_index,status:"passed",evidence:evidence()}))}};
    const final=await context.store.recordRunValidation({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision,validation});
    state=await context.store.finishRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:final.control_revision,finalValidationSha256:final.validation_sha256,outcome:"completed"});
    if(stop)state=await context.store.recordSupervisorStopped({runId:context.runId,expectedSupervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision,proof:{fixtureConfirmed:true}});
    const resource={resource_id:id("resource"),kind:"attempt_worktree",attempt_id:task.claimed.attempt.attempt_id,integration_id:null,
      cwd:task.claimed.attempt.worktree.cwd,preimage_sha256:sha("exact fixture preimage"),retention:evidence()};
    const cleanup={contract_version:"agent-cleanup-intent.v1",cleanup_id:id("cleanup"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
      repository_identity_sha256:head.repository_identity_sha256,integration_ref:head.ref,integrated_sha:head.sha,resources:[resource]};
    return {...context,task,state,resource,cleanup};
  }
  const cancelArgs=(context,state,requestId=id("cancel"))=>({runId:context.runId,expectedControlRevision:state.supervision.control_revision,
    expectedSupervisorGeneration:state.supervision.current?.ownership.generation ?? 0,
    request:{contract_version:"agent-cancel-request.v1",request_id:requestId,run_id:context.runId,plan_sha256:context.plan.plan_sha256,reason:"USER_CANCELLED"}});
  const cleanupArgs=context=>({runId:context.runId,expectedControlRevision:context.state.supervision.control_revision,ownerId:id("cleaner"),runner:runner(),cleanup:context.cleanup});
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
    await check("two-process migration applies v3 through v6 once and preserves v2 data", async () => {
      const sentinel = (await client.query("SELECT * FROM aidn_shared.workspace_registry WHERE workspace_id='sentinel.workspace'")).rows;
      const results = await race(connectionString, "migrate", [{},{}]);
      assert.deepEqual(results.map(value => value.ok), [true,true]);
      assert.deepEqual((await client.query("SELECT schema_version FROM aidn_shared.schema_migrations ORDER BY schema_version")).rows.map(row => row.schema_version), [2,3,4,5,6]);
      assert.deepEqual((await client.query("SELECT * FROM aidn_shared.workspace_registry WHERE workspace_id='sentinel.workspace'")).rows, sentinel);
      assert.equal(Number((await client.query("SELECT count(*) AS count FROM public.ddl_observations WHERE tag='CREATE TABLE'")).rows[0].count), 12);
      const before = await ddlCount();
      assert.equal((await shared.bootstrap()).ok, true);
      assert.equal(await ddlCount(), before);
      assert.equal((await store.checkReadiness()).ready, true);
    });
    await check("cooperative plan v2 survives JSONB reservation reread and claim without DDL", async () => {
      const context=await seed({reserve:false,transform:plan=>{
        plan.contract_version="agent-execution-plan.v2";
        plan.assurance_profile="codex-cooperative.v1";
      }});
      const before=JSON.stringify(context.reservation), ddl=await ddlCount();
      const reserved=await context.store.reserveRun(context.reservation);
      assert.deepEqual(reserved.plan,context.plan);
      const persisted=(await client.query("SELECT plan_json,plan_sha256,pg_typeof(plan_json)::text AS storage_type FROM aidn_shared.execution_runs WHERE run_id=$1",[context.runId])).rows[0];
      assert.equal(persisted.storage_type,"jsonb");
      assert.deepEqual(persisted.plan_json,context.plan);
      assert.equal(persisted.plan_json.contract_version,"agent-execution-plan.v2");
      assert.equal(persisted.plan_json.assurance_profile,"codex-cooperative.v1");
      assert.equal(persisted.plan_sha256,context.plan.plan_sha256);
      assert.equal(normalizeAgentExecutionPlan(persisted.plan_json).plan_sha256,persisted.plan_sha256);
      const legacy=structuredClone(persisted.plan_json);
      delete legacy.plan_sha256; delete legacy.assurance_profile; legacy.contract_version="agent-execution-plan.v1";
      assert.notEqual(normalizeAgentExecutionPlan(legacy).plan_sha256,persisted.plan_sha256);
      const reconnected=createPostgresAgentExecutionStore(storeOptions);
      const reread=await reconnected.getRun({runId:context.runId});
      assert.deepEqual(reread.plan,context.plan);
      assert.equal(reread.run.plan_sha256,persisted.plan_sha256);
      assert.ok(reread.tasks.every(task=>task.plan_sha256===persisted.plan_sha256));
      const claimed=await reconnected.claimAttempt(claimArgs(context));
      assert.equal(claimed.attempt.plan_sha256,persisted.plan_sha256);
      assert.equal(claimed.delegation.plan_sha256,persisted.plan_sha256);
      const after=await context.store.getRun({runId:context.runId});
      assert.deepEqual(after.plan,context.plan);
      assert.equal(after.attempts.length,1);
      assert.equal(after.attempts[0].attempt.attempt_id,claimed.attempt.attempt_id);
      assert.equal(after.attempts[0].attempt.plan_sha256,persisted.plan_sha256);
      assert.equal(JSON.stringify(context.reservation),before);
      assert.equal(await ddlCount(),ddl);
    });
    await check("unknown cooperative assurance is rejected before PostgreSQL writes", async () => {
      let activationChecks=0;
      const context=await seed({reserve:false,options:{verifyActivation:()=>{activationChecks++;return true;}},transform:plan=>{
        plan.contract_version="agent-execution-plan.v2";
        plan.assurance_profile="codex-cooperative.v1";
      }});
      const invalid=structuredClone(context.reservation);
      invalid.plan.assurance_profile="codex-cooperative.unknown";
      const inputBefore=JSON.stringify(invalid), dataBefore=await dataSnapshot(), ddl=await ddlCount();
      await reject(context.store.reserveRun(invalid),"AGENT_EXECUTION_CONTRACT_INVALID");
      assert.equal(await dataSnapshot(),dataBefore);
      assert.equal(await ddlCount(),ddl);
      assert.equal(await context.store.getRun({runId:context.runId}),null);
      assert.equal(activationChecks,0);
      assert.equal(JSON.stringify(invalid),inputBefore);
    });
    for (const legacyVersion of [3,4,5]) await check(`v${legacyVersion} upgrade preserves existing run task result and immutable evidence`, async () => {
      // This additional database belongs to this same private disposable cluster.
      await client.query(`CREATE DATABASE aidn_v${legacyVersion}_upgrade_fixture`);
      const uri=new URL(connectionString); uri.pathname=`/aidn_v${legacyVersion}_upgrade_fixture`;
      const legacy=new pg.Client({connectionString:uri.href}); await legacy.connect();
      try {
        for (const migration of getPostgresSharedCoordinationMigrationFiles().filter(item=>item.version<=legacyVersion)) {
          await legacy.query(fs.readFileSync(migration.file,"utf8"));
          await legacy.query("INSERT INTO aidn_shared.schema_migrations(schema_name,schema_version) VALUES('aidn_shared',$1)",[migration.version]);
        }
        const historical=createPostgresSharedCoordinationStore({connectionString:uri.href}), c=fixture.plan.canonical;
        assert.equal((await historical.registerWorkspace({projectId:c.project_id,workspaceId:c.workspace_id})).ok,true);
        assert.equal((await historical.upsertPlanningState({projectId:c.project_id,workspaceId:c.workspace_id,planningKey:"fixture",sessionId:c.session_id,backlogArtifactRef:c.plan_ref,backlogArtifactSha256:c.plan_sha256})).ok,true);
        await legacy.query("INSERT INTO aidn_shared.execution_runs(run_id,project_id,workspace_id,runtime_scope_id,planning_key,planning_revision,plan_sha256,canonical_snapshot_sha256,plan_json,run_json) VALUES($1,$2,$3,$4,'fixture',$5,$6,$7,$8::jsonb,$9::jsonb)",
          [fixture.run.run_id,c.project_id,c.workspace_id,c.runtime_scope_id,c.planning_revision,fixture.plan.plan_sha256,sha("historical snapshot"),JSON.stringify(fixture.plan),JSON.stringify(fixture.run)]);
        await legacy.query("INSERT INTO aidn_shared.execution_tasks(run_id,task_id,task_json,next_ordinal) VALUES($1,$2,$3::jsonb,1)",[fixture.task.run_id,fixture.task.task_id,JSON.stringify(fixture.task)]);
        const a=fixture.attempt;
        await legacy.query("INSERT INTO aidn_shared.execution_attempts(attempt_id,run_id,task_id,ordinal,owner_id,generation,lease_id,lease_until,attempt_json,delegation_json,request_json,result_json,termination_json) VALUES($1,$2,$3,1,$4,$5,$6,clock_timestamp(),$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)",
          [a.attempt_id,a.run_id,a.task_id,a.ownership.owner_id,a.ownership.generation,a.ownership.lease_id,JSON.stringify(a),JSON.stringify(fixture.delegation),JSON.stringify(fixture.request),JSON.stringify(fixture.result),JSON.stringify({fixtureConfirmed:true})]);
        await legacy.query("INSERT INTO aidn_shared.execution_events(attempt_id,event_id,sequence,payload_sha256,event_json) VALUES($1,$2,1,$3,$4::jsonb)",[a.attempt_id,fixture.event.event_id,fingerprintAgentExecutionValue(fixture.event),JSON.stringify(fixture.event)]);
        let journalsBefore=null;
        const journalSql="SELECT (SELECT jsonb_agg(jsonb_build_object('prepared',prepared_json,'applied',applied_json,'prepared_sha256',prepared_sha256,'applied_sha256',applied_sha256)) FROM aidn_shared.execution_integrations) AS integrations,(SELECT jsonb_agg(acceptance_json) FROM aidn_shared.execution_acceptances) AS acceptances,(SELECT jsonb_agg(validation_json) FROM aidn_shared.execution_run_validations) AS validations";
        if (legacyVersion>=4) {
          const owner=fixture.supervisor.ownership, prepared=fixture["integration-prepared"], applied=fixture["integration-applied"], validation=fixture["run-validation"];
          await legacy.query("INSERT INTO aidn_shared.execution_supervisors(run_id,generation,lease_id,lease_until,supervisor_json) VALUES($1,$2,$3,clock_timestamp(),$4::jsonb)",[a.run_id,owner.generation,owner.lease_id,JSON.stringify(fixture.supervisor)]);
          await legacy.query("INSERT INTO aidn_shared.execution_acceptances(attempt_id,run_id,task_id,acceptance_sha256,acceptance_json,supervisor_generation) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[a.attempt_id,a.run_id,a.task_id,fingerprintAgentExecutionValue(fixture.acceptance),JSON.stringify(fixture.acceptance),owner.generation]);
          await legacy.query("INSERT INTO aidn_shared.execution_integrations(run_id,integration_id,sequence,attempt_id,prepared_sha256,prepared_json,applied_sha256,applied_json) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)",[a.run_id,prepared.integration_id,prepared.sequence,a.attempt_id,fingerprintAgentExecutionValue(prepared),JSON.stringify(prepared),fingerprintAgentExecutionValue(applied),JSON.stringify(applied)]);
          await legacy.query("INSERT INTO aidn_shared.execution_run_validations(run_id,validation_sha256,validation_json,supervisor_generation) VALUES($1,$2,$3::jsonb,$4)",[a.run_id,fingerprintAgentExecutionValue(validation),JSON.stringify(validation),owner.generation]);
          journalsBefore=(await legacy.query(journalSql)).rows;
        }
        const evidenceSql="SELECT (SELECT jsonb_agg(jsonb_build_object('plan',plan_json,'run',run_json,'created',created_at)) FROM aidn_shared.execution_runs) AS runs,(SELECT jsonb_agg(task_json) FROM aidn_shared.execution_tasks) AS tasks,(SELECT jsonb_agg(jsonb_build_object('attempt',attempt_json,'result',result_json,'termination',termination_json)) FROM aidn_shared.execution_attempts) AS attempts,(SELECT jsonb_agg(event_json) FROM aidn_shared.execution_events) AS events";
        const before=(await legacy.query(evidenceSql)).rows;
        const migrated=await race(uri.href,"migrate",[{},{}]); assert.deepEqual(migrated.map(row=>row.ok),[true,true]);
        assert.deepEqual((await legacy.query(evidenceSql)).rows,before);
        if (legacyVersion>=4) {
          assert.deepEqual((await legacy.query(journalSql)).rows,journalsBefore);
          assert.equal((await legacy.query("SELECT intent_sha256 FROM aidn_shared.execution_integrations")).rows[0].intent_sha256,null);
          assert.equal((await legacy.query("SELECT count(*)::int AS count FROM aidn_shared.execution_integration_intents")).rows[0].count,0);
        }
        const preserved=(await legacy.query("SELECT supervision_mode,supervisor_generation,run_started_at,run_deadline_at FROM aidn_shared.execution_runs")).rows[0];
        assert.equal(preserved.supervision_mode,"legacy"); assert.equal(Number(preserved.supervisor_generation),0); assert.equal(preserved.run_started_at,null); assert.equal(preserved.run_deadline_at,null);
      } finally { await legacy.end(); }
    });
    await check("readiness and read operations leave all existing state unchanged", async () => {
      const context = await seed();
      const before = await dataSnapshot(), ddl = await ddlCount();
      await store.checkReadiness(); await store.getRun({ runId: context.runId });
      await store.readCanonicalDigest({ scopeKey: context.plan.canonical.runtime_scope_id });
      await shared.healthcheck();
      assert.equal(await dataSnapshot(), before); assert.equal(await ddlCount(), ddl);
    });
    await check("reservation preview is read only and refuses occupied or revoked canonical context",async()=>{
      const context=await seed({reserve:false}), before=await dataSnapshot(), ddl=await ddlCount();
      const preview=await context.store.previewRunReservation(context.reservation);
      assert.equal(preview.reservation_available,true);assert.equal(preview.plan_sha256,context.plan.plan_sha256);
      assert.equal(await dataSnapshot(),before);assert.equal(await ddlCount(),ddl);
      const revoked=createPostgresAgentExecutionStore({...storeOptions,verifyActivation:()=>false});
      await reject(revoked.previewRunReservation(context.reservation),"AGENT_EXECUTION_ACTIVATION_INVALID");
      assert.equal(await dataSnapshot(),before);
      await context.store.reserveRun(context.reservation);
      await reject(context.store.previewRunReservation(context.reservation),"AGENT_EXECUTION_RESERVATION_CONFLICT");
    });
    await check("public CLI status and planned cancellation use real PostgreSQL without native preparation",async()=>{
      const target=path.join(root,"public-cli-target"), resources=path.join(root,"public-cli-resources");
      fs.mkdirSync(target);fs.mkdirSync(resources);
      const init=spawnSync("git",["init",target],{encoding:"utf8",windowsHide:true,timeout:10000});assert.equal(init.status,0);
      const reference=name=>({path:path.join(resources,name),sha256:sha("deliberately unavailable native reference")});
      const configuration={contract_version:"agent-run-configuration.v1",run_id:"run.public.lifecycle",target_root:target,resources_root:resources,
        planning_key:"pending",integration_ref:"refs/heads/codex/public-lifecycle",prepared_manifest:reference("prepared.json"),
        git:{executable:process.execPath,sha256:sha("unused native Git executable")},
        commit_identity:{name:"AIDN fixture",email:"fixture@example.invalid",timestamp:"2026-09-26T00:00:00Z"},
        native:{candidate:{},runtime:{},helper:{},metadata_runner:{executable:process.execPath,sha256:sha("unused metadata runner")},
          qualification:reference("qualification.json"),profile:{manifest:reference("profile.json"),policy:reference("policy.json"),consent:{}}},
        verification:{runner:{id:"fixture.unavailable",executable:process.execPath},environment:{},audit_policy:reference("audit.json"),public_key:reference("public.pem"),
          private_key:reference("private.pem"),boundary:{configuration:reference("boundary.json"),qualification:reference("boundary-proof.json")}}};
      const context=await seed({runIdOverride:configuration.run_id,transform:plan=>{
        configuration.planning_key=`planning.${plan.canonical.project_id.slice("project.".length)}`;
        plan.supervision={configuration_sha256:fingerprintAgentExecutionValue(configuration)};
      }});
      const config=buildNextAidnProjectConfig({},{store:"dual-sqlite",stateMode:"dual"},{});
      config.runtime.persistence={backend:"postgres",connectionRef:"env:AIDN_TEST_PG_URL"};writeAidnProjectConfig(target,config);
      writeSharedRuntimeLocator(target,{enabled:true,projectId:context.plan.canonical.project_id,workspaceId:context.plan.canonical.workspace_id,
        backend:{kind:"postgres",connectionRef:"env:AIDN_TEST_PG_URL"},projection:{localIndexMode:"preserve-current"}});
      const configPath=path.join(root,"public-run-configuration.json");fs.writeFileSync(configPath,JSON.stringify(configuration));
      const tree=()=>{const files=[];const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        const file=path.join(directory,entry.name);if(entry.isDirectory())visit(file);else files.push([path.relative(target,file),sha(fs.readFileSync(file))]);
      }};visit(target);return fingerprintAgentExecutionValue(files);};
      const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("AIDN_")));
      environment.AIDN_TEST_PG_URL=connectionString;
      const invoke=(command,extra=[],expectedExitCode=0)=>{
        const child=spawnSync(process.execPath,[fileURLToPath(new URL("../../bin/aidn.mjs",import.meta.url)),"runtime",command,"--target",target,
          "--configuration",configPath,"--run",context.runId,"--json",...extra],{cwd:target,env:environment,encoding:"utf8",windowsHide:true,timeout:20000,maxBuffer:1024*1024});
        assert.equal(child.error,undefined,child.error?.code);const value=JSON.parse(child.stdout);
        assert.equal(child.status,expectedExitCode,JSON.stringify(value.errors));assert.equal(child.stdout.includes(connectionString),false);
        return value;
      };
      const before=await dataSnapshot(), ddl=await ddlCount(), local=tree();
      const status=invoke("agent-run-status"), preview=invoke("agent-run-cancel");
      assert.equal(status.status.execution_status,"planned");assert.equal(status.written,false);assert.equal(preview.can_apply,true,JSON.stringify(preview));
      assert.equal(preview.written,false);assert.equal(preview.action.preconditions.activation.active,false);
      assert.equal(await dataSnapshot(),before);assert.equal(await ddlCount(),ddl);assert.equal(tree(),local);assert.deepEqual(fs.readdirSync(resources),[]);
      const cancelled=invoke("agent-run-cancel",["--execute","--expect-plan",preview.action_sha256,"--sync-relay"]);
      assert.equal(cancelled.written,true);assert.equal(cancelled.status.cancellation.status,"requested");
      const durable=await context.store.getRun({runId:context.runId});
      assert.equal(durable.cancel_request.target_supervisor_generation,0);assert.equal(durable.attempts.length,0);assert.equal(durable.supervision.current,null);
      assert.equal(durable.run.lifecycle_status,"planned");assert.equal(tree(),local);assert.equal(await ddlCount(),ddl);assert.deepEqual(fs.readdirSync(resources),[]);
      const cancelledState=await dataSnapshot(), repeated=invoke("agent-run-cancel");
      assert.equal(repeated.can_apply,false);assert.equal(repeated.written,false);
      assert.ok(repeated.action.preconditions.blockers.includes("AGENT_RUN_CANCELLATION_ALREADY_REQUESTED"));
      const denied=invoke("agent-run-cancel",["--execute","--expect-plan",repeated.action_sha256,"--sync-relay"],1);
      assert.equal(denied.written,false);assert.ok(denied.errors.includes("AGENT_RUN_PRECONDITIONS_FAILED"));
      assert.equal(await dataSnapshot(),cancelledState);assert.equal(tree(),local);assert.equal(await ddlCount(),ddl);assert.deepEqual(fs.readdirSync(resources),[]);
    });
    await check("concurrent cancellation is immutable and fences work while preserving terminal evidence",async()=>{
      const context=await seed();await supervise(context);
      const claimed=await context.store.claimAttempt({...claimArgs(context),supervisor:context.supervisor}), request=requestFor(context,claimed);
      const args={...owned(claimed),supervisor:context.supervisor};
      await context.store.recordLaunchIntent({...args,request});
      await context.store.recordPreparation({...args,preparation:{request_sha256:fingerprintAgentExecutionValue(request),evidence:evidence()}});
      await context.store.observeRunner({...args,runner:runner()});
      const before=await context.store.getRun({runId:context.runId}), first=cancelArgs(context,before), second=cancelArgs(context,before);
      await reject(context.store.requestCancel({...first,expectedSupervisorGeneration:context.supervisor.generation+1}),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
      const raced=await race(connectionString,"requestCancel",[first,second]);assert.equal(raced.filter(value=>value.ok).length,1);
      const won=raced[0].ok ? first : second, state=await context.store.getRun({runId:context.runId});
      assert.equal(state.supervision.control_revision,before.supervision.control_revision+1);
      assert.deepEqual(state.attempts[0].attempt.ownership,claimed.attempt.ownership);
      assert.equal((await context.store.requestCancel(won)).cancel_request.request_sha256,state.cancel_request.request_sha256);
      await reject(context.store.requestCancel({...won,request:{...won.request,reason:"DIFFERENT"}}),"AGENT_EXECUTION_CANCEL_REQUEST_CONFLICT");
      await reject(context.store.claimAttempt({...claimArgs(context,"beta"),supervisor:context.supervisor}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      await reject(context.store.recordLaunchIntent({...args,request}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      let evaluated=false;
      await reject(context.store.admitDelegatedRequest({...args,requestSha256:fingerprintAgentExecutionValue(request),delegationSha256:fingerprintAgentExecutionValue(claimed.delegation),evaluate:()=>{evaluated=true;}}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      assert.equal(evaluated,false);
      await client.query("UPDATE aidn_shared.execution_runs SET run_deadline_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]);
      await context.store.renewSupervisor({runId:context.runId,supervisor:context.supervisor});await context.store.renewAttempt(args);
      await context.store.recordResult({...args,result:resultFor(claimed,request,"cancelled"),terminationProof:{fixtureConfirmed:true}});
      const ended=await context.store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"cancelled"});
      assert.equal(ended.reservation_active,false);assert.equal(ended.attempts[0].result.outcome,"cancelled");
      await reject(context.store.recordSupervisorStopped({runId:context.runId,expectedSupervisor:context.supervisor,expectedControlRevision:ended.supervision.control_revision,proof:{fixtureConfirmed:false}}),"AGENT_EXECUTION_SUPERVISOR_TERMINATION_UNCONFIRMED");
      const stopped=await context.store.recordSupervisorStopped({runId:context.runId,expectedSupervisor:context.supervisor,expectedControlRevision:ended.supervision.control_revision,proof:{fixtureConfirmed:true}});
      assert.equal(stopped.run.lifecycle_status,"cancelled");assert.equal(stopped.supervision.current.status,"stopped");
    });
    await check("cancellation before first supervisor permits only an explicit drain generation",async()=>{
      const context=await seed(), initial=await context.store.getRun({runId:context.runId});
      const cancelled=await context.store.requestCancel(cancelArgs(context,initial));
      const args=supervisorArgs(context,cancelled.supervision.control_revision);
      await reject(context.store.claimSupervisor(args),"AGENT_EXECUTION_CANCEL_REQUESTED");
      const acquired=await context.store.claimSupervisor({...args,drainOnly:true});context.supervisor=acquired.supervision.current.ownership;
      await reject(context.store.resumeRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:acquired.supervision.control_revision}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      await reject(context.store.claimAttempt({...claimArgs(context),supervisor:context.supervisor}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      const ended=await context.store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"cancelled"});
      assert.equal(ended.attempts.length,0);assert.equal(ended.run.lifecycle_status,"cancelled");
    });
    await check("cancelled pending integration preserves reservation until factual applied reconciliation",async()=>{
      const context=await seed();await supervise(context);const accepted=await acceptedTask(context), prepared=await prepareTask(context,accepted);
      let state=await context.store.getRun({runId:context.runId});state=await context.store.requestCancel(cancelArgs(context,state));
      const args={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision};
      await reject(context.store.prepareIntegration({...args,integration:prepared.integration}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      await reject(context.store.recordAcceptance({...args,acceptance:accepted.acceptance}),"AGENT_EXECUTION_CANCEL_REQUESTED");
      await reject(context.store.finishRun({...args,outcome:"cancelled"}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      await context.store.invalidateRun({runId:context.runId,supervisor:context.supervisor,reason:"CANCEL_DRAIN"});
      state=await context.store.getRun({runId:context.runId});
      gitStates.get(context.runId).head=prepared.integration.result_sha;
      const applied=await context.store.recordIntegrationApplied({...args,expectedControlRevision:state.supervision.control_revision,integrationId:prepared.integration.integration_id,
        preparedSha256:prepared.prepared_sha256,proof:{evidence:prepared.integration.evidence},reconciliation:true});
      assert.equal(applied.integration_head.sha,prepared.integration.result_sha);
      const ended=await context.store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"cancelled"});
      assert.equal(ended.reservation_active,false);assert.equal(ended.run.lifecycle_status,"cancelled");
    });
    await check("cleanup requires completed retained integrated resources and independent supervisor stop",async()=>{
      const context=await completedCleanupContext({stop:false});
      await reject(context.store.beginCleanup(cleanupArgs(context)),"AGENT_EXECUTION_CLEANUP_SUPERVISOR_NOT_STOPPED");
      context.state=await context.store.recordSupervisorStopped({runId:context.runId,expectedSupervisor:context.supervisor,expectedControlRevision:context.state.supervision.control_revision,proof:{fixtureConfirmed:true}});
      const noInspector=createPostgresAgentExecutionStore(storeOptions);
      await reject(noInspector.beginCleanup(cleanupArgs(context)),"AGENT_EXECUTION_CLEANUP_INSPECTOR_REQUIRED");
      for(const fault of [{retained:false},{processes_stopped:false},{links_safe:false},{clean:false}]){
        cleanupStates.set(context.resource.resource_id,fault);
        await reject(context.store.beginCleanup(cleanupArgs(context)),"AGENT_EXECUTION_CLEANUP_INSPECTION_INVALID");
        assert.equal((await context.store.getRun({runId:context.runId})).cleanup,null);
      }
      cleanupStates.delete(context.resource.resource_id);
      const observedHead=gitStates.get(context.runId).head;gitStates.get(context.runId).head=context.plan.base.sha;
      await reject(context.store.beginCleanup(cleanupArgs(context)),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      assert.equal((await context.store.getRun({runId:context.runId})).cleanup,null);
      gitStates.get(context.runId).head=observedHead;
      await reject(context.store.beginCleanup({...cleanupArgs(context),cleanup:{...context.cleanup,resources:[{...context.resource,cwd:path.join(root,"unowned")}]}}),"AGENT_EXECUTION_CLEANUP_RESOURCE_UNSAFE");
      const cancelled=await seed();await supervise(cancelled);await cancelled.store.finishRun({runId:cancelled.runId,supervisor:cancelled.supervisor,outcome:"cancelled"});
      await reject(context.store.beginCleanup({...cleanupArgs(context),runId:cancelled.runId,expectedControlRevision:(await store.getRun({runId:cancelled.runId})).supervision.control_revision,
        cleanup:{...context.cleanup,run_id:cancelled.runId,plan_sha256:cancelled.plan.plan_sha256}}),"AGENT_EXECUTION_CLEANUP_RUN_NOT_COMPLETED");
    });
    await check("cleanup rechecks Git after external observations before authority or durable results",async()=>{
      for(const stage of ["begin","authority","result"]){
        const context=await completedCleanupContext(), before=await context.store.getRun({runId:context.runId});
        let state=before;
        if(stage!=="begin")state=await context.store.beginCleanup(cleanupArgs(context));
        const selected=createPostgresAgentExecutionStore({...storeOptions,...cleanupOptions,inspectCleanup:async(resource,options)=>{
          const observation=cleanupOptions.inspectCleanup(resource,options);
          gitStates.get(context.runId).head=context.plan.base.sha;
          return observation;
        }});
        const selection={runId:context.runId,cleanupId:context.cleanup.cleanup_id,ownership:state.cleanup?.current.ownership,
          resourceId:context.resource.resource_id,resourceSha256:fingerprintAgentExecutionValue(context.resource)};
        if(stage==="result")cleanupStates.set(context.resource.resource_id,{exists:false,registered:false});
        const data=await dataSnapshot();
        const operation=stage==="begin" ? selected.beginCleanup(cleanupArgs(context)) : stage==="authority"
          ? selected.inspectCleanupAuthority(selection)
          : selected.recordCleanupResult({...selection,result:{resource_id:context.resource.resource_id,preimage_sha256:context.resource.preimage_sha256,
            outcome:"removed",evidence:[context.resource.retention]}});
        await reject(operation,"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
        assert.equal(await dataSnapshot(),data,"Git movement during observation must roll back every cleanup mutation");
        const after=await context.store.getRun({runId:context.runId});
        if(stage==="begin")assert.equal(after.cleanup,null);else assert.equal(after.cleanup.resources[0].result,null);
      }
    });
    await check("two processes cannot own cleanup and exact outcomes are immutable",async()=>{
      const context=await completedCleanupContext(), args=cleanupArgs(context);
      const raced=await race(connectionString,"beginCleanup",[args,{...args,ownerId:id("other.cleaner"),runner:runner()}]);
      assert.equal(raced.filter(value=>value.ok).length,1);
      let state=await context.store.getRun({runId:context.runId});const ownership=state.cleanup.current.ownership;
      const selected={runId:context.runId,cleanupId:context.cleanup.cleanup_id,ownership,resourceId:context.resource.resource_id};
      const authority=await context.store.inspectCleanupAuthority({...selected,resourceSha256:fingerprintAgentExecutionValue(context.resource)});
      assert.equal(authority.cleanup_sha256,fingerprintAgentExecutionValue(context.cleanup));
      const result={resource_id:context.resource.resource_id,preimage_sha256:context.resource.preimage_sha256,outcome:"removed",evidence:[context.resource.retention]};
      const head=gitStates.get(context.runId).head;gitStates.get(context.runId).head=context.plan.base.sha;
      await reject(context.store.inspectCleanupAuthority({...selected,resourceSha256:fingerprintAgentExecutionValue(context.resource)}),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      await reject(context.store.recordCleanupResult({...selected,result}),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      gitStates.get(context.runId).head=head;
      await reject(context.store.recordCleanupResult({...selected,result}),"AGENT_EXECUTION_CLEANUP_INSPECTION_INVALID");
      cleanupStates.set(context.resource.resource_id,{exists:false,registered:false});
      state=await context.store.recordCleanupResult({...selected,result});
      assert.equal(state.cleanup.current.status,"completed");assert.equal(state.cleanup.resources[0].result.outcome,"removed");
      assert.equal((await context.store.recordCleanupResult({...selected,result})).cleanup.resources[0].result_sha256,fingerprintAgentExecutionValue(result));
      await reject(context.store.recordCleanupResult({...selected,result:{...result,evidence:[...result.evidence,evidence()]}}),"AGENT_EXECUTION_CLEANUP_RESULT_CONFLICT");
      assert.equal(state.integration_head.ref,context.cleanup.integration_ref);assert.equal(state.final_validation.validation.outcome,"passed");
    });
    await check("expired cleanup requires cleaner death before adopting an already removed resource",async()=>{
      const context=await completedCleanupContext(), initial=await context.store.beginCleanup(cleanupArgs(context)), old=initial.cleanup.current.ownership;
      const resourceSha256=fingerprintAgentExecutionValue(context.resource), selected={runId:context.runId,cleanupId:context.cleanup.cleanup_id,ownership:old,resourceId:context.resource.resource_id,resourceSha256};
      await client.query("UPDATE aidn_shared.execution_cleanup_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]);
      await reject(context.store.inspectCleanupAuthority(selected),"AGENT_EXECUTION_CLEANUP_LEASE_EXPIRED");
      await reject(context.store.beginCleanup({...cleanupArgs(context),expectedControlRevision:initial.supervision.control_revision,expectedPreviousGeneration:old.generation}),"AGENT_EXECUTION_CLEANUP_RECONCILIATION_REQUIRED");
      const reconcile={runId:context.runId,cleanupId:context.cleanup.cleanup_id,expectedOwnership:old,expectedControlRevision:initial.supervision.control_revision};
      await reject(context.store.reconcileCleanup({...reconcile,proof:{fixtureConfirmed:false}}),"AGENT_EXECUTION_CLEANUP_TERMINATION_UNCONFIRMED");
      const stopped=await context.store.reconcileCleanup({...reconcile,proof:{fixtureConfirmed:true}});
      cleanupStates.set(context.resource.resource_id,{exists:false,registered:false});
      const resumed=await context.store.beginCleanup({...cleanupArgs(context),expectedControlRevision:stopped.supervision.control_revision,expectedPreviousGeneration:old.generation});
      assert.equal(resumed.cleanup.current.ownership.generation,old.generation+1);assert.equal(resumed.cleanup.history[0].status,"stopped");
      const fresh={...selected,ownership:resumed.cleanup.current.ownership};
      await reject(context.store.inspectCleanupAuthority(fresh),"AGENT_EXECUTION_CLEANUP_INSPECTION_INVALID");
      const factual=await context.store.inspectCleanupAuthority({...fresh,reconciliation:true});
      assert.equal(factual.resource_sha256,resourceSha256);
      const result={resource_id:context.resource.resource_id,preimage_sha256:context.resource.preimage_sha256,outcome:"removed",evidence:[context.resource.retention]};
      await reject(context.store.recordCleanupResult({...selected,result}),"AGENT_EXECUTION_CLEANUP_OWNERSHIP_LOST");
      const ended=await context.store.recordCleanupResult({...selected,ownership:resumed.cleanup.current.ownership,result});
      assert.equal(ended.cleanup.current.status,"completed");assert.equal(ended.cleanup.resources[0].result.outcome,"removed");
    });
    await check("verification cleanup requires a persisted snapshot of the exact accepted run",async()=>{
      const legacy=await completedCleanupContext(), verified=await completedCleanupContext({verification:true});
      const snapshot=verified.state.final_validation.evidence_verification.snapshots[0];
      const resource={...verified.resource,kind:"verification_worktree",attempt_id:null,integration_id:null,
        snapshot_sha256:snapshot.snapshot_sha256,cwd:path.join(root,"verification snapshot")};
      const args={...cleanupArgs(verified),cleanup:{...verified.cleanup,resources:[resource]}};
      await reject(legacy.store.beginCleanup({...cleanupArgs(legacy),cleanup:{...legacy.cleanup,resources:[resource]}}),"AGENT_EXECUTION_CLEANUP_RESOURCE_UNSAFE");
      await reject(verified.store.beginCleanup({...args,cleanup:{...args.cleanup,resources:[{...resource,snapshot_sha256:sha("foreign snapshot")}]}}),"AGENT_EXECUTION_CLEANUP_RESOURCE_UNSAFE");
      const begun=await verified.store.beginCleanup(args);
      assert.equal(begun.cleanup.resources[0].resource.snapshot_sha256,snapshot.snapshot_sha256);
      assert.equal(begun.cleanup.resources[0].resource.kind,"verification_worktree");
    });
    await check("two-process scope reservation has exactly one owner", async () => {
      const context = await seed({ reserve: false });
      const results = await race(connectionString, "reserveRun", [context.reservation, { ...context.reservation, runId: id("competing") }]);
      assert.equal(results.filter(value => value.ok).length, 1);
      assert.equal(results.find(value => !value.ok).code, "AGENT_EXECUTION_CONFLICT");
    });
    await check("canonical lock wait permits a bounded verifier but refuses unbounded contention",async()=>{
      const context=await seed(), claimed=await claim(context);
      for(const milliseconds of [2500,5500]){
        await client.query("BEGIN");await client.query("LOCK TABLE aidn_runtime.artifacts IN SHARE ROW EXCLUSIVE MODE");
        let timer;const released=new Promise((resolve,rejectRelease)=>{timer=setTimeout(()=>client.query("COMMIT").then(resolve,rejectRelease),milliseconds);});
        try {
          const renew=context.store.renewAttempt(owned(claimed));
          if(milliseconds===2500)assert.equal((await renew).attempt.attempt_id,claimed.attempt.attempt_id);
          else await reject(renew,"AGENT_EXECUTION_TRANSACTION_CONFLICT");
          await released;
        } finally {clearTimeout(timer);await client.query("ROLLBACK");}
      }
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
    await check("delegated preflight requires durable launch intent and a live exact binding",async()=>{
      const context=await seed(),claimed=await claim(context),request=requestFor(context,claimed);
      let evaluations=0;
      const args=admissionArgs(claimed,request,bundle=>{evaluations++;return admitDecision(bundle);});
      await reject(store.admitDelegatedRequest(args),"AGENT_EXECUTION_LAUNCH_INTENT_REQUIRED");
      assert.equal(evaluations,0);
      await store.recordLaunchIntent({...owned(claimed),request});
      const before=await dataSnapshot(),ddl=await ddlCount();
      assert.equal((await store.admitDelegatedRequest(args)).outcome,"allow");
      assert.equal(await dataSnapshot(),before);assert.equal(await ddlCount(),ddl);
      for(const field of ["requestSha256","delegationSha256"]){
        await reject(store.admitDelegatedRequest({...args,[field]:"f".repeat(64)}),"AGENT_EXECUTION_ADMISSION_BINDING_INVALID");
      }
      await reject(store.admitDelegatedRequest({...args,ownership:{...args.ownership,generation:args.ownership.generation+1}}),"AGENT_EXECUTION_OWNERSHIP_LOST");
      await reject(store.admitDelegatedRequest({...args,evaluate:()=>{throw new Error("sensitive driver detail");}}),"AGENT_EXECUTION_ADMISSION_EVALUATION_FAILED");
      assert.equal(evaluations,1);
      await store.observeRunner({...owned(claimed),runner:runner()});
      assert.equal((await store.admitDelegatedRequest(args)).outcome,"allow");
      await store.recordResult({...owned(claimed),result:resultFor(claimed,request),terminationProof:{fixtureConfirmed:true}});
      await reject(store.admitDelegatedRequest(args),"AGENT_EXECUTION_ATTEMPT_NOT_ACTIVE");
      assert.equal(evaluations,2);
    });
    await check("delegated admission fences an expired lease before calling its evaluator",async()=>{
      const context=await seed(),claimed=await claim(context),request=await launch(context,claimed);
      let evaluated=false;await expire(claimed);
      await reject(store.admitDelegatedRequest(admissionArgs(claimed,request,()=>{evaluated=true;return {outcome:"allow"};})),"AGENT_EXECUTION_LEASE_EXPIRED");
      assert.equal(evaluated,false);assert.equal((await store.getRun({runId:context.runId})).run.lifecycle_status,"recovery_required");
    });
    await check("delegated admission rechecks PostgreSQL time after a slow evaluator",async()=>{
      const context=await seed(),claimed=await claim(context),request=await launch(context,claimed);
      let evaluated=false;
      await client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE attempt_id=$1",[claimed.attempt.attempt_id]);
      await reject(store.admitDelegatedRequest(admissionArgs(claimed,request,async bundle=>{evaluated=true;await delay(700);return admitDecision(bundle);})),"AGENT_EXECUTION_LEASE_EXPIRED");
      assert.equal(evaluated,true);assert.equal((await store.getRun({runId:context.runId})).run.lifecycle_status,"recovery_required");
    });
    await check("delegated admission rechecks revocation after evaluating the patch",async()=>{
      let active=true;
      const context=await seed({options:{verifyActivation:()=>active}}),claimed=await claim(context),request=await launch(context,claimed);
      const args=admissionArgs(claimed,request,bundle=>{active=false;return admitDecision(bundle);});
      await reject(context.store.admitDelegatedRequest(args),"AGENT_EXECUTION_ACTIVATION_INVALID");
      const snapshot=await store.getRun({runId:context.runId});
      assert.equal(snapshot.run.lifecycle_status,"recovery_required");assert.equal(snapshot.reservation_active,true);
    });
    await check("never-settling delegated evaluation releases PostgreSQL locks at its deadline",async()=>{
      const context=await seed(),claimed=await claim(context),request=await launch(context,claimed);
      let evaluationSignal;
      const before=await dataSnapshot();
      const started=performance.now();
      await reject(store.admitDelegatedRequest(admissionArgs(claimed,request,(_bundle,{signal})=>{
        evaluationSignal=signal;return new Promise(()=>{});
      })),"AGENT_EXECUTION_ADMISSION_EVALUATION_TIMED_OUT");
      assert.equal(evaluationSignal.aborted,true);assert.ok(performance.now()-started<6500);
      assert.equal(await dataSnapshot(),before);
      const secondConnection=createPostgresAgentExecutionStore(storeOptions);
      await bounded(secondConnection.renewAttempt(owned(claimed)),2000);
      await bounded(secondConnection.invalidateRun({runId:context.runId,reason:"FIXTURE_RECONCILIATION"}),2000);
      assert.equal((await store.getRun({runId:context.runId})).run.lifecycle_status,"recovery_required");
    });
    await check("late delegated allow after timeout cannot revive an invalidated run",async()=>{
      const context=await seed(),claimed=await claim(context),request=await launch(context,claimed);
      let settle,lateDecision;
      await reject(store.admitDelegatedRequest(admissionArgs(claimed,request,bundle=>{
        lateDecision=admitDecision(bundle);return new Promise(resolve=>{settle=resolve;});
      })),"AGENT_EXECUTION_ADMISSION_EVALUATION_TIMED_OUT");
      const secondConnection=createPostgresAgentExecutionStore(storeOptions);
      await bounded(secondConnection.invalidateRun({runId:context.runId,reason:"FIXTURE_AFTER_TIMEOUT"}),2000);
      const before=await dataSnapshot();settle(lateDecision);await delay(20);
      assert.equal(await dataSnapshot(),before);
      assert.equal((await store.getRun({runId:context.runId})).run.lifecycle_status,"recovery_required");
    });
    await check("synchronous delegated evaluation cannot outrun the delayed timer",async()=>{
      const context=await seed(),claimed=await claim(context),request=await launch(context,claimed);
      await reject(store.admitDelegatedRequest(admissionArgs(claimed,request,bundle=>{
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,4600);return admitDecision(bundle);
      })),"AGENT_EXECUTION_ADMISSION_EVALUATION_TIMED_OUT");
      await bounded(createPostgresAgentExecutionStore(storeOptions).renewAttempt(owned(claimed)),2000);
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
    await check("lease expiry during supervisor verification refuses renewal durably", async () => {
      let expireDuringVerification = false, verifiedBeforeExpiry = false, activeClient, attemptId;
      const context = await seed({ options: {
        clientFactory: config => (activeClient = new pg.Client(config)),
        verifyActivation: async () => {
          if (expireDuringVerification) {
            verifiedBeforeExpiry = true;
            // The initial live guard has passed. Inject PostgreSQL expiry in
            // this same transaction, without depending on Windows scheduling.
            await activeClient.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE attempt_id=$1", [attemptId]);
          }
          return true;
        },
      } });
      const claimed = await claim(context);
      attemptId = claimed.attempt.attempt_id;
      expireDuringVerification = true;
      await reject(context.store.renewAttempt(owned(claimed)), "AGENT_EXECUTION_LEASE_EXPIRED");
      assert.equal(verifiedBeforeExpiry,true);
      assert.equal((await store.getRun({ runId: context.runId })).run.lifecycle_status, "recovery_required");
    });
    await check("lease expiry during termination verification refuses the result durably", async () => {
      let verifiedBeforeExpiry=false, activeClient, attemptId;
      const context=await seed({options:{
        clientFactory:config=>(activeClient=new pg.Client(config)),
        verifyTermination:async()=>{
          verifiedBeforeExpiry=true;
          await activeClient.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE attempt_id=$1",[attemptId]);
          return true;
        },
      }});
      const claimed=await claim(context),request=await launch(context,claimed);
      attemptId=claimed.attempt.attempt_id;
      await reject(context.store.recordResult({...owned(claimed),result:resultFor(claimed,request),terminationProof:{fixtureConfirmed:true}}),"AGENT_EXECUTION_LEASE_EXPIRED");
      assert.equal(verifiedBeforeExpiry,true);
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
    await check("two-process supervisor claim has exactly one generation owner", async () => {
      const context=await seed(), args=supervisorArgs(context);
      const results=await race(connectionString,"claimSupervisor",[args,{...args,ownerId:id("competitor"),runner:runner()}]);
      assert.equal(results.filter(result=>result.ok).length,1);
      assert.equal(results.find(result=>!result.ok).code,"AGENT_EXECUTION_CONTROL_REVISION_MISMATCH");
      const snapshot=await store.getRun({runId:context.runId});
      assert.equal(snapshot.supervision.mode,"supervised"); assert.equal(snapshot.supervision.current.ownership.generation,1);
      assert.equal(new Date(snapshot.run_deadline_at)-new Date(snapshot.run_started_at),context.plan.limits.max_duration_ms);
      assert.ok(snapshot.server_now); assert.equal(snapshot.attempts.length,0);
      await reject(claim(context),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
      const before=snapshot.supervision.control_revision;
      const renewed=await store.renewSupervisor({runId:context.runId,supervisor:snapshot.supervision.current.ownership});
      assert.equal(renewed.supervision.control_revision,before);
      assert.deepEqual(renewed.run_started_at,snapshot.run_started_at); assert.deepEqual(renewed.run_deadline_at,snapshot.run_deadline_at);
    });
    await check("historical trials cannot be adopted and verifier absence has no fallback", async () => {
      const context=await seed(); await claim(context);
      await reject(store.claimSupervisor(supervisorArgs(context)),"AGENT_EXECUTION_LEGACY_RUN_ADOPTION_REFUSED");
      assert.equal((await store.getRun({runId:context.runId})).supervision.mode,"legacy");
      for (const [field,code] of [["verifySupervisorTermination","SUPERVISOR_TERMINATION_VERIFIER_REQUIRED"],["inspectIntegration","INTEGRATION_INSPECTOR_REQUIRED"]]) {
        const isolated=await seed({options:{[field]:null}});
        await reject(isolated.store.claimSupervisor(supervisorArgs(isolated)),`AGENT_EXECUTION_${code}`);
        assert.equal((await store.getRun({runId:isolated.runId})).supervision.current,null);
      }
    });
    await check("supervised attempt mutations require current supervisor as well as worker ownership", async () => {
      const context=await seed(); await supervise(context);
      const claimed=await store.claimAttempt({...claimArgs(context),supervisor:context.supervisor}), request=requestFor(context,claimed), args=owned(claimed);
      await reject(store.recordLaunchIntent({...args,request}),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
      await reject(store.recordLaunchIntent({...args,request,supervisor:{...context.supervisor,generation:2}}),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
      await store.recordLaunchIntent({...args,request,supervisor:context.supervisor});
      await reject(store.observeRunner({...args,runner:runner(),supervisor:context.supervisor}),"AGENT_EXECUTION_PREPARATION_REQUIRED");
      const preparation={request_sha256:fingerprintAgentExecutionValue(request),evidence:evidence()};
      await reject(store.recordPreparation({...args,supervisor:context.supervisor,preparation:{...preparation,request_sha256:sha("foreign")}}),"AGENT_EXECUTION_PREPARATION_REQUEST_MISMATCH");
      await reject(store.recordPreparation({...args,supervisor:context.supervisor,preparation:{...preparation,evidence:{...preparation.evidence,ref:"../foreign"}}}),"AGENT_EXECUTION_PREPARATION_INVALID");
      await store.recordPreparation({...args,supervisor:context.supervisor,preparation});
      assert.equal((await store.recordPreparation({...args,supervisor:context.supervisor,preparation})).idempotent,true);
      await reject(store.recordPreparation({...args,supervisor:context.supervisor,preparation:{...preparation,evidence:evidence()}}),"AGENT_EXECUTION_PREPARATION_CONFLICT");
      for (const operation of [()=>store.renewAttempt(args),()=>store.expireAttempts({runId:context.runId}),()=>store.invalidateRun({runId:context.runId,reason:"fixture"}),()=>store.finishRun({runId:context.runId,outcome:"failed"})]) {
        await reject(operation(),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
      }
      const before=await dataSnapshot(); await store.getRun({runId:context.runId}); await store.checkReadiness(); assert.equal(await dataSnapshot(),before);
    });
    await check("terminal result acceptance is immutable and independent of expired worker lease", async () => {
      const context=await seed(); await supervise(context); const task=await completedTask(context);
      await expire(task.claimed);
      const acceptance=acceptanceFor(context,task);
      await reject(store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance:{...acceptance,result_sha256:sha("foreign")}}),"AGENT_EXECUTION_BINDING_INVALID");
      const accepted=await store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance});
      assert.equal(accepted.idempotent,false);
      assert.equal((await store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance})).idempotent,true);
      const divergent=structuredClone(acceptance); divergent.validation.checks[0].evidence=evidence();
      await reject(store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance:divergent}),"AGENT_EXECUTION_ACCEPTANCE_CONFLICT");
      await reject(store.recordAcceptance({runId:context.runId,acceptance}),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
    });
    await check("accepted predecessors remain blocked until durable applied chain matches input SHA", async () => {
      const context=await seed(); await supervise(context);
      const alpha=await acceptedTask(context,"alpha"), beta=await acceptedTask(context,"beta");
      await reject(store.claimAttempt({...claimArgs(context,"join"),supervisor:context.supervisor,expectedIntegrationSequence:0}),"AGENT_EXECUTION_DEPENDENCY_PROOF_REQUIRED");
      await reject(prepareTask(context,beta),"AGENT_EXECUTION_INTEGRATION_ORDER_INVALID");
      const prepared=await prepareTask(context,alpha);
      const snapshot=await store.getRun({runId:context.runId});
      assert.equal((await store.prepareIntegration({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,integration:prepared.integration})).idempotent,true);
      await reject(store.prepareIntegration({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,integration:{...prepared.integration,result_sha:sha("substitution").slice(0,prepared.integration.result_sha.length)}}),"AGENT_EXECUTION_INTEGRATION_CONFLICT");
      await applyTask(context,prepared); await applyTask(context,await prepareTask(context,beta));
      const before=await store.getRun({runId:context.runId});
      await reject(store.claimAttempt({...claimArgs(context,"join"),supervisor:context.supervisor,expectedIntegrationSequence:before.integration_head.sequence}),"AGENT_EXECUTION_INPUT_SHA_MISMATCH");
      gitStates.get(context.runId).head=sha("unexpected ref");
      await reject(store.claimAttempt({...claimArgs(context,"join"),supervisor:context.supervisor,inputSha:before.integration_head.sha,expectedIntegrationSequence:before.integration_head.sequence}),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      gitStates.get(context.runId).head=before.integration_head.sha;
      const join=await acceptedTask(context,"join",{inputSha:before.integration_head.sha,expectedIntegrationSequence:before.integration_head.sequence});
      assert.equal(join.claimed.dependency_binding.input_sha,before.integration_head.sha);
      assert.equal(join.claimed.dependency_binding.predecessors.length,2);
      await applyTask(context,await prepareTask(context,join));
      const complete=await store.getRun({runId:context.runId}), head=complete.integration_head;
      await reject(store.finishRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:complete.supervision.control_revision,outcome:"completed"}),"AGENT_EXECUTION_FINAL_VALIDATION_REQUIRED");
      const validation={contract_version:"agent-run-validation.v1",validation_id:id("final"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
        integration_sequence:head.sequence,integrated_sha:head.sha,outcome:"passed",
        checks:context.plan.validations.map(item=>({validation_id:item.validation_id,status:"passed",tested_sha:head.sha,evidence:evidence()})),
        audit:{read_only:true,tested_sha:head.sha,checks:context.plan.audit.criteria.map((_,criterion_index)=>({criterion_index,status:"passed",evidence:evidence()}))}};
      const foreign=structuredClone(validation); foreign.plan_sha256=sha("foreign plan");
      await reject(store.recordRunValidation({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:complete.supervision.control_revision,validation:foreign}),"AGENT_EXECUTION_FINAL_VALIDATION_BINDING_INVALID");
      const final=await store.recordRunValidation({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:complete.supervision.control_revision,validation});
      await store.invalidateRun({runId:context.runId,supervisor:context.supervisor,reason:"FIXTURE_INVALIDATED_AFTER_VALIDATION"});
      const invalidated=await store.getRun({runId:context.runId});
      assert.equal(invalidated.run.lifecycle_status,"recovery_required"); assert.ok(invalidated.supervision.control_revision>final.control_revision);
      const finish={runId:context.runId,supervisor:context.supervisor,finalValidationSha256:final.validation_sha256,outcome:"completed"};
      await reject(store.finishRun({...finish,expectedControlRevision:final.control_revision}),"AGENT_EXECUTION_CONTROL_REVISION_MISMATCH");
      await reject(store.finishRun({...finish,expectedControlRevision:invalidated.supervision.control_revision}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      const resumed=await store.resumeRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:invalidated.supervision.control_revision});
      assert.ok(resumed.supervision.control_revision>invalidated.supervision.control_revision);
      assert.equal(resumed.final_validation.validation_sha256,final.validation_sha256);
      const ended=await store.finishRun({...finish,expectedControlRevision:resumed.supervision.control_revision});
      assert.equal(ended.run.lifecycle_status,"completed"); assert.equal(ended.reservation_active,false);
    });
    await check("supervisor recovery requires process and Git death and preserves prepared result and deadline", async () => {
      const context=await seed(); const initial=await supervise(context), accepted=await acceptedTask(context), prepared=await prepareTask(context,accepted);
      const stale=structuredClone(context.supervisor);
      await client.query("UPDATE aidn_shared.execution_supervisors SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]);
      const expired=await store.expireSupervisor({runId:context.runId,expectedSupervisor:stale});
      assert.equal(expired.run.lifecycle_status,"recovery_required"); assert.equal(expired.reservation_active,true);
      await reject(store.claimSupervisor({...supervisorArgs(context,expired.supervision.control_revision),expectedPreviousGeneration:stale.generation}),"AGENT_EXECUTION_SUPERVISOR_RECONCILIATION_REQUIRED");
      const badStore=createPostgresAgentExecutionStore({...storeOptions,verifySupervisorTermination:()=>({ok:true,supervisor_stopped:true,descendants_stopped:true,git_operations_stopped:false})});
      await reject(badStore.reconcileSupervisor({runId:context.runId,expectedSupervisor:stale,expectedControlRevision:expired.supervision.control_revision,proof:{fixtureConfirmed:true}}),"AGENT_EXECUTION_SUPERVISOR_TERMINATION_UNCONFIRMED");
      const reconciled=await store.reconcileSupervisor({runId:context.runId,expectedSupervisor:stale,expectedControlRevision:expired.supervision.control_revision,proof:{fixtureConfirmed:true}});
      const renewed=await store.claimSupervisor({...supervisorArgs(context,reconciled.supervision.control_revision),expectedPreviousGeneration:stale.generation});
      context.supervisor=renewed.supervision.current.ownership;
      assert.equal(context.supervisor.generation,stale.generation+1); assert.notEqual(context.supervisor.lease_id,stale.lease_id);
      assert.deepEqual(renewed.run_started_at,initial.run_started_at); assert.deepEqual(renewed.run_deadline_at,initial.run_deadline_at);
      assert.equal(renewed.run.lifecycle_status,"recovery_required");
      await reject(store.renewSupervisor({runId:context.runId,supervisor:stale}),"AGENT_EXECUTION_SUPERVISOR_OWNERSHIP_LOST");
      await reject(store.resumeRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:renewed.supervision.control_revision}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      const state=gitStates.get(context.runId); state.parents.set(prepared.integration.source_sha,accepted.claimed.attempt.input_sha); state.parents.set(prepared.integration.result_sha,prepared.integration.parent_sha);
      state.head=prepared.integration.result_sha; // crash happened after Git CAS, before applied
      const replay=await store.prepareIntegration({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:renewed.supervision.control_revision,integration:prepared.integration});
      assert.equal(replay.prepared_sha256,prepared.prepared_sha256); assert.equal(replay.idempotent,true);
      const applied=await applyTask(context,replay);
      assert.equal(applied.integration.applied.applied_by.generation,context.supervisor.generation);
      const resumed=await store.resumeRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:applied.control_revision});
      assert.equal(resumed.run.lifecycle_status,"running"); assert.equal(resumed.integrations.length,1);
      const repeated=await applyTask(context,replay); assert.equal(repeated.idempotent,true);
      assert.equal((await store.getRun({runId:context.runId})).integration_head.sequence,1);
    });
    await check("database deadline fences execution and acceptance but still permits controlled failure", async () => {
      const context=await seed(); await supervise(context); const task=await completedTask(context);
      await client.query("UPDATE aidn_shared.execution_runs SET run_deadline_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]);
      await reject(store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance:acceptanceFor(context,task)}),"AGENT_EXECUTION_RUN_DEADLINE_EXPIRED");
      const state=await store.getRun({runId:context.runId}); assert.equal(state.run.lifecycle_status,"recovery_required"); assert.equal(state.acceptances.length,0);
      await store.renewSupervisor({runId:context.runId,supervisor:context.supervisor});
      assert.equal((await store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"failed"})).reservation_active,false);
    });
    await check("a slow Git observation cannot commit acceptance integration after supervisor expiry", async () => {
      const context=await seed(); await supervise(context); const accepted=await acceptedTask(context);
      const baseline=await store.getRun({runId:context.runId});
      // Expire by database time while the bounded verifier holds the row lock.
      context.store=createPostgresAgentExecutionStore({...storeOptions,inspectIntegration:async (...args)=>{await delay(2000); return storeOptions.inspectIntegration(...args);}});
      await client.query("UPDATE aidn_shared.execution_supervisors SET lease_until=clock_timestamp()+interval '1500 milliseconds' WHERE run_id=$1",[context.runId]);
      await reject(prepareTask(context,accepted),"AGENT_EXECUTION_SUPERVISOR_LEASE_EXPIRED");
      const after=await store.getRun({runId:context.runId}); assert.equal(after.integrations.length,0);
      assert.equal(after.supervision.control_revision,baseline.supervision.control_revision);
    });
    await check("caller mutation during Git inspection cannot change the durable prepared payload", async () => {
      const context=await seed(); await supervise(context); const accepted=await acceptedTask(context);
      let callerDocument, initialSha;
      const actual=createPostgresAgentExecutionStore({...storeOptions,inspectIntegration:async (...args)=>{
        initialSha=callerDocument.result_sha; callerDocument.result_sha=sha("mutated caller").slice(0,initialSha.length);
        return storeOptions.inspectIntegration(...args);
      }});
      context.store={...actual,prepareIntegration:args=>{callerDocument=args.integration;return actual.prepareIntegration(args);}};
      const prepared=await prepareTask(context,accepted);
      assert.notEqual(callerDocument.result_sha,initialSha); assert.equal(prepared.integration.result_sha,initialSha);
      const saved=(await store.getRun({runId:context.runId})).integrations[0];
      assert.equal(saved.prepared.result_sha,initialSha); assert.equal(saved.prepared_sha256,fingerprintAgentExecutionValue(saved.prepared));
      const originalOwner=structuredClone(context.supervisor), callerOwner=structuredClone(context.supervisor);
      context.store=createPostgresAgentExecutionStore({...storeOptions,inspectIntegration:async (...args)=>{
        callerOwner.owner_id="mutated.caller"; return storeOptions.inspectIntegration(...args);
      }});
      context.supervisor=callerOwner;
      const applied=await applyTask(context,prepared);
      assert.equal(callerOwner.owner_id,"mutated.caller"); assert.deepEqual(applied.integration.applied.applied_by,originalOwner);
      const savedApplied=(await store.getRun({runId:context.runId})).integrations[0];
      assert.deepEqual(savedApplied.applied.applied_by,originalOwner); assert.equal(savedApplied.applied_sha256,fingerprintAgentExecutionValue(savedApplied.applied));
    });
    await check("pending integration prevents failure closure and expired recovery only records observed applied SHA", async () => {
      const context=await seed(); await supervise(context);
      const prepared=await prepareTask(context,await acceptedTask(context));
      for (const outcome of ["failed","cancelled"]) await reject(store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      await client.query("UPDATE aidn_shared.execution_runs SET run_deadline_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]);
      await reject(store.claimAttempt({...claimArgs(context,"beta"),supervisor:context.supervisor}),"AGENT_EXECUTION_RUN_DEADLINE_EXPIRED");
      const snapshot=await store.getRun({runId:context.runId});
      const args={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,
        integrationId:prepared.integration.integration_id,preparedSha256:prepared.prepared_sha256,proof:{evidence:prepared.integration.evidence},reconciliation:true};
      await reject(store.recordIntegrationApplied(args),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      gitStates.get(context.runId).head=sha("foreign head"); await reject(store.recordIntegrationApplied(args),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      gitStates.get(context.runId).head=prepared.integration.result_sha;
      const applied=await store.recordIntegrationApplied(args); assert.equal(applied.integration_head.sha,prepared.integration.result_sha);
      await reject(store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"completed",expectedControlRevision:applied.control_revision}),"AGENT_EXECUTION_RUN_DEADLINE_EXPIRED");
      assert.equal((await store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"failed"})).reservation_active,false);
    });
    await check("revocation permits only factual applied reconciliation and controlled cancellation", async () => {
      let authorized=true, activationChecks=0;
      const context=await seed({options:{verifyActivation:()=>{activationChecks++;return authorized;}}});
      await supervise(context); const prepared=await prepareTask(context,await acceptedTask(context));
      authorized=false;
      let snapshot=await context.store.getRun({runId:context.runId});
      const args={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:snapshot.supervision.control_revision,
        integrationId:prepared.integration.integration_id,preparedSha256:prepared.prepared_sha256,proof:{evidence:prepared.integration.evidence}};
      await reject(context.store.recordIntegrationApplied(args),"AGENT_EXECUTION_ACTIVATION_INVALID");
      snapshot=await context.store.getRun({runId:context.runId}); assert.equal(snapshot.run.lifecycle_status,"recovery_required");
      assert.equal(snapshot.reservation_active,true); gitStates.get(context.runId).head=prepared.integration.result_sha;
      const before=activationChecks;
      const applied=await context.store.recordIntegrationApplied({...args,expectedControlRevision:snapshot.supervision.control_revision,reconciliation:true});
      assert.equal(activationChecks,before); assert.equal(applied.integration_head.sha,prepared.integration.result_sha);
      const state=await context.store.getRun({runId:context.runId}); assert.equal(state.run.lifecycle_status,"recovery_required");
      const guarded={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision};
      await reject(context.store.resumeRun(guarded),"AGENT_EXECUTION_ACTIVATION_INVALID");
      const validation={contract_version:"agent-run-validation.v1",validation_id:id("revoked"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
        integration_sequence:state.integration_head.sequence,integrated_sha:state.integration_head.sha,outcome:"passed",
        checks:context.plan.validations.map(item=>({validation_id:item.validation_id,status:"passed",tested_sha:state.integration_head.sha,evidence:evidence()})),
        audit:{read_only:true,tested_sha:state.integration_head.sha,checks:context.plan.audit.criteria.map((_,criterion_index)=>({criterion_index,status:"passed",evidence:evidence()}))}};
      await reject(context.store.recordRunValidation({...guarded,validation}),"AGENT_EXECUTION_ACTIVATION_INVALID");
      await reject(context.store.finishRun({...guarded,outcome:"completed"}),"AGENT_EXECUTION_ACTIVATION_INVALID");
      const cancelled=await context.store.finishRun({...guarded,outcome:"cancelled"});
      assert.equal(cancelled.reservation_active,false); assert.equal(cancelled.run.lifecycle_status,"cancelled");
    });
    await check("durable intention precedes preparation and reserves the single pending integration", async () => {
      const context=await seed(); await supervise(context);
      const accepted=await acceptedTask(context), beta=await acceptedTask(context,"beta"), intent=await intentFor(context,accepted);
      const reserved=await reserveIntent(context,intent), before=await store.getRun({runId:context.runId});
      assert.equal(before.integration_intents[0].status,"reserved"); assert.equal(before.integrations.length,0);
      assert.equal((await reserveIntent(context,intent)).idempotent,true);
      await reject(reserveIntent(context,{...intent,commit_identity:{...intent.commit_identity,name:"different"}}),"AGENT_EXECUTION_INTEGRATION_INTENT_CONFLICT");
      await reject(reserveIntent(context,await intentFor(context,beta)),"AGENT_EXECUTION_INTEGRATION_PENDING");
      for (const outcome of ["failed","cancelled"]) await reject(store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      const integration=preparedForIntent(context,reserved);
      await reject(prepareIntent(context,{...reserved,intent_sha256:sha("foreign")},integration),"AGENT_EXECUTION_INTEGRATION_INTENT_BINDING_INVALID");
      const prepared=await prepareIntent(context,reserved,integration), applied=await applyTask(context,prepared);
      const after=await store.getRun({runId:context.runId}); assert.equal(after.integration_intents[0].status,"applied");
      assert.equal(after.integration_intents[0].prepared_sha256,prepared.prepared_sha256); assert.equal(after.integration_intents[0].applied_sha256,applied.integration.applied_sha256);
      assert.deepEqual(after.integration_intents[0].intent,intent);
    });
    await check("two independent processes cannot reserve different intentions at the same revision", async () => {
      const context=await seed(); await supervise(context); const accepted=await acceptedTask(context), intent=await intentFor(context,accepted);
      const before=await store.getRun({runId:context.runId}), args={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:before.supervision.control_revision,intent};
      const results=await race(connectionString,"recordIntegrationIntent",[args,{...args,intent:{...intent,integration_id:id("competitor")}}]);
      assert.equal(results.filter(item=>item.ok).length,1);
      assert.equal(results.find(item=>!item.ok).code,"AGENT_EXECUTION_CONTROL_REVISION_MISMATCH");
      assert.equal((await store.getRun({runId:context.runId})).integration_intents.length,1);
    });
    await check("orphan prepared attaches after takeover without changing producer or result", async () => {
      const context=await seed(); await supervise(context); const accepted=await acceptedTask(context), reserved=await reserveIntent(context,await intentFor(context,accepted));
      const integration=preparedForIntent(context,reserved), hash=fingerprintAgentExecutionValue(integration);
      const {old}=await takeover(context);
      const forged=structuredClone(integration); forged.prepared_by.owner_id="foreign.owner";
      await reject(prepareIntent(context,reserved,forged),"AGENT_EXECUTION_SUPERVISOR_RECONCILIATION_REQUIRED");
      const attached=await prepareIntent(context,reserved,integration,{reconciliation:true});
      assert.equal(attached.prepared_sha256,hash); assert.deepEqual(attached.integration.prepared_by,old);
      assert.equal((await prepareIntent(context,reserved,integration)).idempotent,true);
      await applyTask(context,attached);
      const state=await store.getRun({runId:context.runId});
      await store.resumeRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision});
    });
    await check("fresh generation can prepare an absent intent while recovery remains pending", async () => {
      const context=await seed(); await supervise(context); const accepted=await acceptedTask(context), reserved=await reserveIntent(context,await intentFor(context,accepted));
      const {old}=await takeover(context), integration=preparedForIntent(context,reserved);
      const state=await store.getRun({runId:context.runId});
      await reject(store.resumeRun({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      const prepared=await prepareIntent(context,reserved,integration);
      assert.deepEqual(reserved.intent.created_by,old); assert.deepEqual(prepared.integration.prepared_by,context.supervisor);
      await applyTask(context,prepared);
    });
    await check("expired revoked orphan can only attach factually and observe the already applied SHA", async () => {
      let active=true, checks=0;
      const context=await seed({options:{verifyActivation:()=>{checks++;return active;}}}); await supervise(context);
      const accepted=await acceptedTask(context), reserved=await reserveIntent(context,await intentFor(context,accepted)), integration=preparedForIntent(context,reserved);
      await takeover(context);
      await client.query("UPDATE aidn_shared.execution_runs SET run_deadline_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]); active=false;
      await reject(prepareIntent(context,reserved,integration),"AGENT_EXECUTION_RUN_DEADLINE_EXPIRED");
      const priorChecks=checks, prepared=await prepareIntent(context,reserved,integration,{reconciliation:true}); assert.equal(checks,priorChecks);
      const state=await store.getRun({runId:context.runId}), args={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision,
        integrationId:integration.integration_id,preparedSha256:prepared.prepared_sha256,proof:{evidence:integration.evidence},reconciliation:true};
      await reject(store.recordIntegrationApplied(args),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      gitStates.get(context.runId).head=sha("unexpected").slice(0,integration.result_sha.length);
      await reject(store.recordIntegrationApplied(args),"AGENT_EXECUTION_INTEGRATION_GIT_MISMATCH");
      gitStates.get(context.runId).head=integration.result_sha;
      await context.store.recordIntegrationApplied(args); assert.equal(checks,priorChecks);
      assert.equal((await context.store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"cancelled"})).reservation_active,false);
    });
    await check("expired absent intention remains reserved without implicit abandonment", async () => {
      const context=await seed(); await supervise(context); const accepted=await acceptedTask(context), reserved=await reserveIntent(context,await intentFor(context,accepted));
      await takeover(context); await client.query("UPDATE aidn_shared.execution_runs SET run_deadline_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[context.runId]);
      await reject(prepareIntent(context,reserved,preparedForIntent(context,reserved)),"AGENT_EXECUTION_RUN_DEADLINE_EXPIRED");
      await reject(store.finishRun({runId:context.runId,supervisor:context.supervisor,outcome:"cancelled"}),"AGENT_EXECUTION_RECOVERY_REQUIRED");
      const snapshot=await store.getRun({runId:context.runId}); assert.equal(snapshot.reservation_active,true); assert.equal(snapshot.integration_intents[0].status,"reserved");
    });
    await check("verification plans reject missing boolean foreign and malformed evidence authorities", async () => {
      const context=await seed({transform:plan=>{plan.verification=structuredClone(verificationPolicy);}}); await supervise(context);
      const task=await completedTask(context), acceptance=acceptanceFor(context,task), args={runId:context.runId,supervisor:context.supervisor,acceptance};
      await reject(context.store.recordAcceptance(args),"AGENT_EXECUTION_VALIDATION_EVIDENCE_VERIFIER_REQUIRED");
      for (const alter of [()=>true,value=>({...value,proof_authority_sha256:sha("foreign pin")}),value=>({...value,subject_sha256:sha("other subject")}),value=>({...value,verified_refs:[]}),value=>({...value,snapshots:[]}),value=>({...value,snapshots:[null]})]) {
        const selected=createPostgresAgentExecutionStore({...storeOptions,validationEvidenceVerifier:{...evidenceVerifier,verify:input=>alter(evidenceVerifier.verify(input))}});
        await reject(selected.recordAcceptance(args),"AGENT_EXECUTION_VALIDATION_EVIDENCE_BINDING_INVALID");
      }
      assert.equal((await store.getRun({runId:context.runId})).acceptances.length,0);
      context.store=createPostgresAgentExecutionStore({...storeOptions,validationEvidenceVerifier:evidenceVerifier});
      const accepted=await context.store.recordAcceptance(args), replay=await context.store.recordAcceptance(args);
      assert.equal(replay.idempotent,true); assert.equal(accepted.evidence_verification_sha256,replay.evidence_verification_sha256);
      assert.equal(accepted.evidence_verification.subject_sha256,accepted.acceptance_sha256);
      await reject(prepareTask(context,{...task,...accepted}),"AGENT_EXECUTION_INTEGRATION_INTENT_REQUIRED");
    });
    await check("evidence verification cannot commit after supervisor lease expiry", async () => {
      const context=await seed({transform:plan=>{plan.verification=structuredClone(verificationPolicy);},options:{validationEvidenceVerifier:{...evidenceVerifier,verify:async input=>{
        await new Promise(resolve=>setTimeout(resolve,1800)); return evidenceVerifier.verify(input);
      }}}}); await supervise(context); const task=await completedTask(context), acceptance=acceptanceFor(context,task);
      await client.query("UPDATE aidn_shared.execution_supervisors SET lease_until=clock_timestamp()+interval '1200 milliseconds' WHERE run_id=$1",[context.runId]);
      await reject(context.store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance}),"AGENT_EXECUTION_SUPERVISOR_LEASE_EXPIRED");
      assert.equal((await store.getRun({runId:context.runId})).acceptances.length,0);
    });
    await check("evidence descriptor time is included in the verification deadline", async () => {
      const context=await seed({transform:plan=>{plan.verification=structuredClone(verificationPolicy);},options:{validationEvidenceVerifier:{...evidenceVerifier,getDescriptor:()=>{
        const end=performance.now()+4550;
        while (performance.now()<end) { /* Model a blocking synchronous descriptor. */ }
        return evidenceVerifier.getDescriptor();
      }}}});
      await supervise(context); const task=await completedTask(context);
      await reject(context.store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance:acceptanceFor(context,task)}),"AGENT_EXECUTION_VALIDATION_EVIDENCE_TIMED_OUT");
      assert.equal((await context.store.getRun({runId:context.runId})).acceptances.length,0);
    });
    await check("activation revoked during evidence verification refuses acceptance final validation and closure", async () => {
      for (const stage of ["acceptance","validation","finish"]) {
        let authorized=true, revoke=false;
        const context=await seed({transform:plan=>{plan.verification=structuredClone(verificationPolicy);plan.tasks=[plan.tasks[0]];},options:{
          verifyActivation:()=>authorized,
          validationEvidenceVerifier:{...evidenceVerifier,verify:input=>{if(revoke) authorized=false;return evidenceVerifier.verify(input);}},
        }});
        await supervise(context); const task=await completedTask(context), acceptance=acceptanceFor(context,task);
        const args={runId:context.runId,supervisor:context.supervisor};
        if (stage==="acceptance") {
          revoke=true;
          await reject(context.store.recordAcceptance({...args,acceptance}),"AGENT_EXECUTION_ACTIVATION_INVALID");
          const after=await context.store.getRun(args);
          assert.equal(after.acceptances.length,0); assert.equal(after.run.lifecycle_status,"recovery_required");
          continue;
        }
        const accepted=await context.store.recordAcceptance({...args,acceptance});
        const reserved=await reserveIntent(context,await intentFor(context,{...task,...accepted}));
        await applyTask(context,await prepareIntent(context,reserved,preparedForIntent(context,reserved)));
        const state=await context.store.getRun(args), head=state.integration_head;
        const validation={contract_version:"agent-run-validation.v1",validation_id:id("activation.final"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
          integration_sequence:head.sequence,integrated_sha:head.sha,outcome:"passed",
          checks:context.plan.validations.map(item=>({validation_id:item.validation_id,status:"passed",tested_sha:head.sha,evidence:evidence()})),
          audit:{read_only:true,tested_sha:head.sha,checks:context.plan.audit.criteria.map((_,criterion_index)=>({criterion_index,status:"passed",evidence:evidence()}))}};
        if (stage==="validation") {
          revoke=true;
          await reject(context.store.recordRunValidation({...args,expectedControlRevision:state.supervision.control_revision,validation}),"AGENT_EXECUTION_ACTIVATION_INVALID");
          const after=await context.store.getRun(args);
          assert.equal(after.final_validation,null); assert.equal(after.run.lifecycle_status,"recovery_required");
        } else {
          const final=await context.store.recordRunValidation({...args,expectedControlRevision:state.supervision.control_revision,validation});
          revoke=true;
          await reject(context.store.finishRun({...args,expectedControlRevision:final.control_revision,finalValidationSha256:final.validation_sha256,outcome:"completed"}),"AGENT_EXECUTION_ACTIVATION_INVALID");
          const after=await context.store.getRun(args);
          assert.equal(after.reservation_active,true); assert.equal(after.run.lifecycle_status,"recovery_required");
          assert.equal(after.final_validation.validation_sha256,final.validation_sha256);
        }
      }
    });
    await check("real PostgreSQL Git and signed verifier bind canonical audit and exact final evidence", async () => {
      const f=await createVerificationFixture({auditChecks:["all-tasks-integrated","no-uncertain-work"]});
      try {
        let context;
        const git=f.configuration.git, producer=f.create({readRun:()=>context.store.getRun({runId:context.runId})});
        context=await seed({planInput:f.plan,runIdOverride:f.run.run_id,options:{inspectIntegration:timedGitInspector(git.inspectIntegration),validationEvidenceVerifier:producer.evidenceVerifier}});
        const observed=await git.inspectIntegration({}, {phase:"head"});
        gitStates.set(context.runId,{identity:observed.repository_identity_sha256,ref:observed.ref,head:f.baseSha,parents:new Map()});
        const initial=await context.store.claimSupervisor({runId:context.runId,ownerId:id("signed.supervisor"),runner:runner(),expectedControlRevision:0,
          integration:{repository_identity_sha256:observed.repository_identity_sha256,ref:observed.ref,base_sha:f.baseSha}});
        context.supervisor=initial.supervision.current.ownership;
        const task=await completedTask(context,"task.fixture"), acceptance=acceptanceFor(context,task,f.candidateSha);
        acceptance.validation=await producer.validateTask({...f.taskInput,plan:context.plan,resultSha256:fingerprintAgentExecutionValue(task.result),
          binding:{...f.taskInput.binding,attempt_id:task.claimed.attempt.attempt_id,input_sha:task.claimed.attempt.input_sha}});
        const accepted=await context.store.recordAcceptance({runId:context.runId,supervisor:context.supervisor,acceptance});
        assert.equal(accepted.evidence_verification.proof_authority_sha256,f.pin);
        assert.equal(accepted.evidence_verification.snapshots[0].candidate_sha,f.candidateSha);
        const service=createAgentTaskIntegrationService({git,store:context.store}), before=await context.store.getRun({runId:context.runId});
        const prepared=await service.prepare({runId:context.runId,planSha256:context.plan.plan_sha256,taskId:acceptance.task_id,attemptId:acceptance.attempt_id,
          acceptanceSha256:accepted.acceptance_sha256,sequence:1,integrationId:id("signed.integration"),sourceSha:f.candidateSha,parentSha:f.baseSha,
          supervisor:context.supervisor,expectedControlRevision:before.supervision.control_revision,verification:context.plan.verification,
          commitIdentity:{name:"Fixture Supervisor",email:"fixture@example.invalid",timestamp:"2030-01-01T00:00:00.000Z"}});
        await service.applyPrepared({prepared:prepared.prepared,preparedSha256:prepared.prepared_sha256,intent:prepared.intent,
          supervisor:context.supervisor,expectedControlRevision:prepared.control_revision});
        const state=await context.store.getRun({runId:context.runId}), input={plan:context.plan,runId:context.runId,integratedSha:state.integration_head.sha,integrationSequence:1};
        await context.store.renewSupervisor({runId:context.runId,supervisor:context.supervisor});
        const checks=await producer.validateRun(input);
        await context.store.renewSupervisor({runId:context.runId,supervisor:context.supervisor});
        const audit=await producer.auditRun(input);
        assert.equal(audit.checks.length,2); assert.ok(audit.checks.every(check=>check.status==="passed"));
        const validation={contract_version:"agent-run-validation.v1",validation_id:id("signed.final"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
          integration_sequence:1,integrated_sha:state.integration_head.sha,outcome:"passed",checks,audit};
        const recorded=await context.store.recordRunValidation({runId:context.runId,supervisor:context.supervisor,expectedControlRevision:state.supervision.control_revision,validation});
        assert.deepEqual(recorded.evidence_verification.snapshots.map(item=>item.phase),["audit","run"]);
        const proofPath=path.join(f.resourcesRoot,...checks[0].evidence.ref.split("/")), original=fs.readFileSync(proofPath);
        const finish={runId:context.runId,supervisor:context.supervisor,expectedControlRevision:recorded.control_revision,outcome:"completed",finalValidationSha256:recorded.validation_sha256};
        fs.writeFileSync(proofPath,"tampered");
        try { await reject(context.store.finishRun(finish),"AGENT_EXECUTION_VALIDATION_EVIDENCE_INVALID"); }
        finally { fs.writeFileSync(proofPath,original); }
        const completed=await context.store.finishRun(finish);
        assert.equal(completed.run.lifecycle_status,"completed"); assert.equal(completed.reservation_active,false);
        assert.equal(completed.integration_intents[0].status,"applied");
        assert.equal(completed.final_validation.evidence_verification.subject_sha256,recorded.validation_sha256);
        assert.equal(f.gitCommand(["rev-parse","HEAD"]),f.baseSha,"worker checkout remains at its original HEAD");
        assert.equal(f.gitCommand(["show",`${state.integration_head.sha}:subject.txt`]),"new");
      } finally { f.cleanup(); }
    });
    await check("real PostgreSQL and Git scheduler overlap two children and integrate dependent output", async () => {
      // Strict plans retain durable integration intents, which are also the
      // cleanup authority for their detached integration worktrees. Evidence
      // verification here is an explicit double; real Ed25519 is tested above.
      const fixtureRun=createSchedulerFixture({realGit:true,verification:verificationPolicy});
      try {
        const cleanupGit=createLocalAgentGitIntegration({repositoryRoot:path.join(fixtureRun.root,"repository"),resourcesRoot:path.join(fixtureRun.root,"resources"),
          integrationRef:"refs/heads/codex/integration-fixture",verifyTermination:async({binding,termination})=>({confirmed:termination?.confirmed===true,attempt_id:binding.attempt_id}),
          verifyCleanupTermination:async()=>({confirmed:fixtureRun.children.length===3 && fixtureRun.children.every(child=>child.ended!==null)})});
        const context=await seed({planInput:fixtureRun.plan,runIdOverride:fixtureRun.options.runId,options:{
          inspectIntegration:timedGitInspector(fixtureRun.git.inspectIntegration),
          verifyTermination:(attempt,proof)=>proof?.confirmed===true && proof.attempt_id===attempt.attempt_id,
          inspectCleanup:cleanupGit.inspectCleanup,verifyCleanupTermination:cleanupOptions.verifyCleanupTermination,validationEvidenceVerifier:evidenceVerifier,
        }});
        const repository=await fixtureRun.git.inspectIntegration({}, {phase:"head"});
        gitStates.set(context.runId,{identity:repository.repository_identity_sha256});
        const result=await fixtureRun.create({store:context.store}).run(fixtureRun.options);
        assert.equal(result.status,"completed",result.reason_code);
        const snapshot=await context.store.getRun({runId:context.runId});
        assert.equal(snapshot.run.lifecycle_status,"completed"); assert.equal(snapshot.integrations.length,3); assert.equal(snapshot.acceptances.length,3);
        assert.equal(snapshot.reservation_active,false); assert.equal(snapshot.final_validation.validation.integrated_sha,snapshot.integration_head.sha);
        const [a,b,c]=fixtureRun.children; assert.notEqual(a.pid,b.pid); assert.ok(a.ended>b.started && b.ended>a.started); assert.ok(c.started>=a.ended && c.started>=b.ended);
        assert.equal(fixtureRun.maxLive,2); assert.equal(fixtureRun.gitCommand(["show",`${snapshot.integration_head.sha}:c.txt`]),"ab");
        assert.equal(fixtureRun.gitCommand(["status","--porcelain"]),"");
        await check("real PostgreSQL cleanup reconciles removed Git worktrees and preserves retained bytes and refs",async()=>{
          let state=await context.store.recordSupervisorStopped({runId:context.runId,expectedSupervisor:snapshot.supervision.current.ownership,
            expectedControlRevision:snapshot.supervision.control_revision,proof:{fixtureConfirmed:true}});
          const retained=[], resources=[];
          const specs=[...state.attempts.map(view=>({resourceId:id("physical.worker"),kind:"attempt_worktree",cwd:view.attempt.worktree.cwd,
            attemptId:view.attempt.attempt_id,binding:{run_id:context.runId,attempt_id:view.attempt.attempt_id},termination:view.termination})),
            ...state.integration_intents.map(entry=>({resourceId:id("physical.integration"),kind:"integration_worktree",cwd:entry.intent.workspace.cwd,
              integrationId:entry.intent.integration_id,binding:{run_id:context.runId,integration_id:entry.intent.integration_id},termination:{fixtureConfirmed:true}}))];
          assert.equal(specs.length,6);
          const refs=fixtureRun.gitCommand(["show-ref"]), principal=fixtureRun.gitCommand(["rev-parse","HEAD"]);
          for(const spec of specs){
            const preview=await cleanupGit.previewCleanupRetention(spec);
            assert.equal(fs.existsSync(path.join(fixtureRun.root,"resources",preview.resource.retention.ref)),false,"preview must not write retention");
            const resource=await cleanupGit.prepareCleanupRetention(spec);assert.deepEqual(resource,preview.resource);resources.push(resource);
            retained.push(...preview.document.retained.map(item=>({file:path.join(fixtureRun.root,"resources",item.ref),sha256:item.sha256,bytes:item.bytes})),
              {file:path.join(fixtureRun.root,"resources",resource.retention.ref),sha256:resource.retention.sha256,bytes:resource.retention.bytes});
          }
          const cleanup={contract_version:"agent-cleanup-intent.v1",cleanup_id:id("physical.cleanup"),run_id:context.runId,plan_sha256:context.plan.plan_sha256,
            repository_identity_sha256:state.integration_head.repository_identity_sha256,integration_ref:state.integration_head.ref,integrated_sha:state.integration_head.sha,resources};
          const args={runId:context.runId,ownerId:id("physical.cleaner"),runner:runner(),cleanup};
          state=await context.store.beginCleanup({...args,expectedControlRevision:state.supervision.control_revision});
          let ownership=state.cleanup.current.ownership;
          const verifyAuthority=({resource,reconciliation=false})=>context.store.inspectCleanupAuthority({runId:context.runId,cleanupId:cleanup.cleanup_id,
            ownership,resourceId:resource.resource_id,resourceSha256:fingerprintAgentExecutionValue(resource),reconciliation});
          for(const [index,resource] of resources.entries()){
            state=await context.store.renewCleanup({runId:context.runId,cleanupId:cleanup.cleanup_id,ownership});
            let result=await cleanupGit.removeOwnedWorktree({resource,cleanup,ownership,verifyAuthority,run:state.run,snapshot:state});
            if(index===0){
              // Simulated crash boundary: Git has removed the worktree, PG has no result.
              const old=ownership;
              state=await context.store.reconcileCleanup({runId:context.runId,cleanupId:cleanup.cleanup_id,expectedOwnership:old,
                expectedControlRevision:state.supervision.control_revision,proof:{fixtureConfirmed:true}});
              state=await context.store.beginCleanup({...args,expectedControlRevision:state.supervision.control_revision,expectedPreviousGeneration:old.generation});
              ownership=state.cleanup.current.ownership;
              result=await cleanupGit.reconcileOwnedWorktreeRemoval({resource,cleanup,ownership,verifyAuthority,run:state.run,snapshot:state});
            }
            state=await context.store.recordCleanupResult({runId:context.runId,cleanupId:cleanup.cleanup_id,ownership,resourceId:resource.resource_id,result});
            assert.equal(fs.existsSync(resource.cwd),false);
          }
          assert.equal(state.cleanup.current.status,"completed");assert.equal(state.cleanup.resources.filter(item=>item.result).length,6);
          assert.equal(fixtureRun.gitCommand(["show-ref"]),refs);assert.equal(fixtureRun.gitCommand(["rev-parse","HEAD"]),principal);
          assert.equal(fixtureRun.gitCommand(["worktree","list","--porcelain"]).split("\n").filter(line=>line.startsWith("worktree ")).length,1);
          for(const item of retained){const bytes=fs.readFileSync(item.file);assert.equal(sha(bytes),item.sha256);assert.equal(bytes.length,item.bytes);}
        });
      } finally { fixtureRun.cleanup(); }
    });
    await check("real PostgreSQL scheduler resumes a local validation failure without worker relaunch", async () => {
      const fixtureRun=createSchedulerFixture({realGit:true,runId:"run.fixture.recovery",tasks:[{task_id:"a",depends_on:[]}],barrier:false});
      let serial=0;
      const makeId=()=>`recovery.${++serial}`;
      try {
        const context=await seed({planInput:fixtureRun.plan,runIdOverride:fixtureRun.options.runId,options:{
          inspectIntegration:fixtureRun.git.inspectIntegration,
          verifyTermination:(attempt,proof)=>proof?.confirmed===true && proof.attempt_id===attempt.attempt_id,
        }});
        const first=await fixtureRun.create({store:context.store,makeId,validateTask:async()=>{throw new Error("fixture validation failure");}}).run(fixtureRun.options);
        const failed=await context.store.getRun({runId:context.runId});
        assert.equal(first.status,"recovery_required",first.reason_code);
        assert.equal(first.durable_state_known,true,JSON.stringify({reason:first.reason_code,known:first.durable_state_known,run:failed.run.lifecycle_status,owner:failed.supervision.current?.status,lease:failed.supervision.current?.lease_live,attempts:failed.attempts.length}));
        assert.equal(failed.run.lifecycle_status,"recovery_required"); assert.equal(failed.supervision.current.lease_live,true,"Immediate recovery must not wait for supervisor expiry");
        assert.equal(failed.attempts[0].result.outcome,"completed"); assert.equal(fixtureRun.children.length,1);
        const resumed=await fixtureRun.create({store:context.store,makeId}).resume({...fixtureRun.options,reconciliation:{supervisorProof:{fixtureConfirmed:true},attempts:[]}});
        assert.equal(resumed.status,"completed",resumed.reason_code); assert.equal(fixtureRun.children.length,1);
        assert.equal(fixtureRun.operations.filter(item=>item==="bootstrap:a").length,1);
        const final=await context.store.getRun({runId:context.runId});
        assert.deepEqual(final.run_deadline_at,failed.run_deadline_at); assert.equal(final.supervision.current.ownership.generation,2);
        assert.equal(final.integrations.length,1); assert.equal(final.reservation_active,false);
        assert.equal(fixtureRun.gitCommand(["show",`${final.integration_head.sha}:a.txt`]),"a");
      } finally { fixtureRun.cleanup(); }
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
    qualification:focused ? "partial" : "full",selection:focused ? "lifecycle-fences" : "all",skipped:skipped.length,
    cleanup:"PASS", codex_native:"SKIP", os_confinement:"SKIP", verifier_authority:"injected-supervisor-doubles",
    validation_evidence:focused ? "injected-double-for-cleanup" : "real-ed25519-with-fixture-process-boundary" })+"\n");
} catch (error) {
  try { await drainChildren(); } catch { /* Retain unconfirmed children in diagnostics. */ }
  // The assertion's bounded message is useful, but driver/connection details
  // are intentionally excluded from this required gate's public diagnostics.
  const code = /^[A-Z_]+$/.test(error.code ?? "") ? error.code : /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "ASSERTION_OR_FIXTURE_FAILURE";
  const assertion = error instanceof assert.AssertionError ? String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]").slice(-1500) : undefined;
  const detail = code.startsWith("EPHEMERAL_POSTGRES_") && typeof error.detail === "string"
    ? error.detail.replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]").slice(-4096) : undefined;
  process.stderr.write(JSON.stringify({ ok:false, check:currentCheck, code, assertion, detail, passed:checks.length,qualification:focused ? "partial" : "full",skipped:skipped.length,git_inspections:gitInspectionTimings,
    postgres_log:error.fixture_postgres_log,cleanup_failure:error.fixture_cleanup_failure,cleanup_path:error.fixture_cleanup_path,
    cleanup:clusterRoots.size>0 && [...clusterRoots].every(root=>!fs.existsSync(root)) && children.size===0
      && !String(error.message).startsWith("EPHEMERAL_POSTGRES_") ? "PASS" : "UNCONFIRMED", live_children:children.size })+"\n");
  process.exitCode=1;
}
