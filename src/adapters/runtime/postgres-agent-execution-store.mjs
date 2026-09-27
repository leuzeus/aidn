import { randomUUID } from "node:crypto";
import {
  assertAgentExecutionContract, fingerprintAgentExecutionValue, fingerprintTaskContract,
  normalizeAgentExecutionPlan, validateAgentExecutionBindings, isExactExecutionPath, validateAgentRunValidationBindings,
} from "../../core/agents/agent-execution-contracts.mjs";
import {
  AGENT_EXECUTION_LEASE_MS, AGENT_EXECUTION_TABLES, assertAgentSupervisedExecutionStore,
} from "../../core/ports/agent-execution-store-port.mjs";
import { lockExecutionPlanning, lockExecutionScope } from "./agent-execution-fence.mjs";

const ACTIVE = new Set(["launch_intended", "running"]);
const RUN_ACTIVE = new Set(["planned", "running"]);
const ADMISSION_EVALUATION_MS = 4500;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const knownFailures = new WeakSet();
const committedFailures = new WeakSet();
const expectedTables = [
  "aidn_shared.schema_migrations", "aidn_shared.planning_states",
  ...AGENT_EXECUTION_TABLES.map(name => `aidn_shared.${name}`),
  "aidn_runtime.schema_migrations", "aidn_runtime.index_meta", "aidn_runtime.artifacts",
];

function failure(code, commit = false) {
  const error = new Error(`AGENT_EXECUTION_${code}`);
  error.code = error.message;
  knownFailures.add(error);
  if (commit) committedFailures.add(error);
  return error;
}
function requireId(value) { if (typeof value !== "string" || !ID.test(value)) throw failure("IDENTITY_INVALID"); return value; }
function requireHash(value) { if (typeof value !== "string" || !HASH.test(value)) throw failure("HASH_INVALID"); return value; }
function copy(value) { return structuredClone(value); }
function same(left, right) { return fingerprintAgentExecutionValue(left) === fingerprintAgentExecutionValue(right); }
function artifactPath(reference) { return typeof reference === "string" ? reference.replace(/^docs\/audit\//, "") : null; }
function contract(kind, value) {
  try { assertAgentExecutionContract(kind, value); } catch { throw failure("CONTRACT_INVALID"); }
  return value;
}
function boundedJson(value) {
  try {
    fingerprintAgentExecutionValue(value);
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65536) throw failure("EVIDENCE_LIMIT");
    return copy(value);
  } catch { throw failure("EVIDENCE_INVALID"); }
}
function mapError(error) {
  if (knownFailures.has(error)) return error;
  if (error?.code === "23505") return failure("CONFLICT");
  if (error?.code === "23503") return failure("REFERENCE_CONFLICT");
  if (["42P01", "42703", "3F000"].includes(error?.code)) return failure("SCHEMA_UNAVAILABLE");
  if (["40001", "40P01", "55P03"].includes(error?.code)) return failure("TRANSACTION_CONFLICT");
  return failure("BACKEND_UNAVAILABLE");
}
function json(row, field) {
  if (!row || row[field] == null) return null;
  try { return typeof row[field] === "string" ? JSON.parse(row[field]) : copy(row[field]); }
  catch { throw failure("STORED_CONTRACT_INVALID"); }
}
function attemptView(row) {
  return {
    attempt: json(row, "attempt_json"), delegation: json(row, "delegation_json"),
    request: json(row, "request_json"), runner: json(row, "runner_json"),
    result: json(row, "result_json"), termination: json(row, "termination_json"),
    reconciliation: json(row, "reconciliation_json"), lease_until: row.lease_until,
    preparation: json(row,"preparation_json"), dependency_binding: json(row,"dependency_binding_json"),
  };
}

// This adapter has no default activation or termination authority. Injected
// verifiers are supervisor-owned dependencies, not data supplied by workers.
export function createPostgresAgentExecutionStore({
  connectionString, clientFactory = null, moduleLoader = null,
  verifyActivation = null, verifyTermination = null, verifySupervisorTermination = null, inspectIntegration = null,
} = {}) {
  async function withClient(operation) {
    let client;
    try {
      if (typeof connectionString !== "string" || !connectionString) throw failure("CONFIGURATION_REQUIRED");
      if (typeof clientFactory === "function") client = await clientFactory({ connectionString });
      else {
        const module = await (moduleLoader ? moduleLoader("pg") : import("pg"));
        const Client = module?.Client ?? module?.default?.Client;
        if (typeof Client !== "function") throw failure("DRIVER_UNAVAILABLE");
        client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000 });
      }
      if (!client || typeof client.query !== "function") throw failure("DRIVER_UNAVAILABLE");
      if (typeof client.connect === "function") await client.connect();
      return await operation(client);
    } catch (error) { throw mapError(error); }
    finally { if (typeof client?.end === "function") { try { await client.end(); } catch { /* Never replace the transaction's outcome. */ } } }
  }

  async function readiness(client) {
    const found = await client.query("SELECT name, to_regclass(name)::text AS relation FROM unnest($1::text[]) AS name", [expectedTables]);
    const present = new Set(found.rows.filter(row => row.relation).map(row => row.name));
    const missing = expectedTables.filter(name => !present.has(name));
    let shared = null, runtime = null;
    if (present.has("aidn_shared.schema_migrations")) {
      const rows = await client.query("SELECT MAX(schema_version) AS version FROM aidn_shared.schema_migrations WHERE schema_name=$1", ["aidn_shared"]);
      shared = rows.rows[0]?.version == null ? null : Number(rows.rows[0].version);
    }
    if (present.has("aidn_runtime.schema_migrations")) {
      const rows = await client.query("SELECT MAX(schema_version) AS version FROM aidn_runtime.schema_migrations WHERE schema_name=$1", ["aidn_runtime"]);
      runtime = rows.rows[0]?.version == null ? null : Number(rows.rows[0].version);
    }
    const ready = missing.length === 0 && shared === 4 && runtime === 3;
    return { ok: ready, ready, shared_schema_version: shared, runtime_schema_version: runtime, missing_tables: missing };
  }

  const transactionFences = new WeakMap();
  async function transaction(operation, readOnly = false) {
    return withClient(async client => {
      await client.query(readOnly ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      transactionFences.set(client,new Map());
      try {
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
        if (!(await readiness(client)).ready) throw failure("SCHEMA_NOT_READY");
        const result = await operation(client);
        // Recheck PostgreSQL time after every external callback and write, before
        // commit. A late fence failure rolls back the entire requested mutation.
        for (const fence of transactionFences.get(client).values()) {
          await supervisorGuard(client,fence.run,fence.ownership,{deadline:fence.deadline,final:true});
        }
        await client.query("COMMIT");
        return result;
      } catch (error) {
        // Expiry and revocation fence ownership durably even though the caller's
        // requested mutation is refused. Ordinary validation errors roll back.
        await client.query(committedFailures.has(error) ? "COMMIT" : "ROLLBACK");
        throw error;
      } finally { transactionFences.delete(client); }
    });
  }

  async function digest(client, scopeKey) {
    requireId(scopeKey);
    const index = await client.query("SELECT key FROM aidn_runtime.index_meta WHERE scope_key=$1 LIMIT 1", [scopeKey]);
    if (!index.rows.length) throw failure("CANONICAL_SCOPE_MISSING");
    const found = await client.query("SELECT path,sha256 FROM aidn_runtime.artifacts WHERE scope_key=$1 ORDER BY path", [scopeKey]);
    const artifacts = found.rows.map(row => ({ path: row.path, sha256: requireHash(row.sha256) }));
    return { scope_key: scopeKey, canonical_snapshot_sha256: fingerprintAgentExecutionValue(artifacts), artifact_count: artifacts.length };
  }

  async function locks(client, run) {
    await client.query("LOCK TABLE aidn_runtime.artifacts IN SHARE ROW EXCLUSIVE MODE");
    await lockExecutionPlanning(client, { projectId: run.project_id, workspaceId: run.workspace_id, planningKey: run.planning_key });
    await lockExecutionScope(client, run.runtime_scope_id);
  }

  async function lockedRun(client, runId) {
    requireId(runId);
    const initial = await client.query("SELECT * FROM aidn_shared.execution_runs WHERE run_id=$1", [runId]);
    if (!initial.rows.length) throw failure("RUN_NOT_FOUND");
    await locks(client, initial.rows[0]);
    const rows = await client.query("SELECT * FROM aidn_shared.execution_runs WHERE run_id=$1 FOR UPDATE", [runId]);
    if (!rows.rows.length) throw failure("RUN_NOT_FOUND");
    return rows.rows[0];
  }

  async function lockedAttempt(client, attemptId) {
    requireId(attemptId);
    const initial = await client.query("SELECT run_id FROM aidn_shared.execution_attempts WHERE attempt_id=$1", [attemptId]);
    if (!initial.rows.length) throw failure("ATTEMPT_NOT_FOUND");
    const run = await lockedRun(client, initial.rows[0].run_id);
    const found = await client.query("SELECT *, lease_until > clock_timestamp() AS lease_live FROM aidn_shared.execution_attempts WHERE attempt_id=$1 FOR UPDATE", [attemptId]);
    return { run, row: found.rows[0] };
  }

  async function updateRunStatus(client, row, status) {
    const run = { ...json(row, "run_json"), lifecycle_status: status };
    await client.query("UPDATE aidn_shared.execution_runs SET run_json=$2::jsonb, updated_at=clock_timestamp() WHERE run_id=$1", [row.run_id, JSON.stringify(run)]);
    if (row.supervision_mode === "supervised" && json(row,"run_json").lifecycle_status !== status) await bump(client,row);
    row.run_json = run;
    return run;
  }

  async function recovery(client, run, reason, throwFailure = true) {
    await updateRunStatus(client, run, "recovery_required");
    await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason=$2 WHERE run_id=$1", [run.run_id,reason]);
    await client.query(`UPDATE aidn_shared.execution_attempts
      SET attempt_json=jsonb_set(attempt_json,'{lifecycle_status}','"recovery_required"'::jsonb),
          generation=generation+1, lease_until=clock_timestamp(), updated_at=clock_timestamp()
      WHERE run_id=$1 AND attempt_json->>'lifecycle_status' IN ('launch_intended','running')`, [run.run_id]);
    if (throwFailure) throw failure(reason, true);
  }

  async function activation(expected, context) {
    if (typeof verifyActivation !== "function") return false;
    try {
      const result = await verifyActivation(copy(expected), copy(context));
      return result === true || result?.ok === true;
    } catch { return false; }
  }

  async function canonical(client, row, invalidate = true) {
    const plan = json(row, "plan_json"), currentRun = json(row, "run_json");
    const fail = async code => { if (invalidate) return recovery(client, row, code); throw failure(code); };
    const planning = await client.query("SELECT revision,backlog_artifact_ref,backlog_artifact_sha256,session_id FROM aidn_shared.planning_states WHERE project_id=$1 AND workspace_id=$2 AND planning_key=$3 FOR UPDATE", [row.project_id, row.workspace_id, row.planning_key]);
    const current = planning.rows[0];
    if (!current || Number(current.revision) !== plan.canonical.planning_revision
      || current.backlog_artifact_sha256 !== plan.canonical.plan_sha256
      || artifactPath(current.backlog_artifact_ref) !== artifactPath(plan.canonical.plan_ref)
      || current.session_id !== plan.canonical.session_id) return fail("PLANNING_CHANGED");
    // Planning publication and canonical artifact import can be separate
    // transactions. A digest supplied by the caller does not prove that the
    // planning reference already resolves to the declared canonical content.
    const artifact = await client.query("SELECT sha256 FROM aidn_runtime.artifacts WHERE scope_key=$1 AND path=$2", [row.runtime_scope_id,artifactPath(plan.canonical.plan_ref)]);
    if (artifact.rows.length !== 1 || artifact.rows[0].sha256 !== plan.canonical.plan_sha256) return fail("CANONICAL_PLAN_MISMATCH");
    let snapshot;
    try { snapshot = await digest(client, row.runtime_scope_id); } catch { return fail("CANONICAL_CHANGED"); }
    if (snapshot.canonical_snapshot_sha256 !== row.canonical_snapshot_sha256) return fail("CANONICAL_CHANGED");
    if (!await activation(plan.canonical.activation, { run: currentRun, plan })) return fail("ACTIVATION_INVALID");
    return plan;
  }

  function assertOwnership(run, row, ownership) {
    const attempt = json(row, "attempt_json");
    if (!ownership || !same(ownership, attempt.ownership)
      || ownership.owner_id !== row.owner_id || ownership.generation !== Number(row.generation)
      || ownership.lease_id !== row.lease_id || ownership.planning_revision !== Number(run.planning_revision)) throw failure("OWNERSHIP_LOST");
    return attempt;
  }

  async function live(client, run, row, ownership, { allowTerminal = false } = {}) {
    const attempt = assertOwnership(run,row,ownership);
    if (!run.reservation_active || !RUN_ACTIVE.has(json(run, "run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
    if (!row.lease_live) {
      if (ACTIVE.has(attempt.lifecycle_status)) return recovery(client, run, "LEASE_EXPIRED");
      throw failure("LEASE_EXPIRED");
    }
    if (!ACTIVE.has(attempt.lifecycle_status) && !allowTerminal) throw failure("ATTEMPT_NOT_ACTIVE");
    await canonical(client, run);
    const remaining = await client.query("SELECT lease_until>clock_timestamp() AS lease_live FROM aidn_shared.execution_attempts WHERE attempt_id=$1", [row.attempt_id]);
    if (!remaining.rows[0]?.lease_live) {
      if (ACTIVE.has(attempt.lifecycle_status)) return recovery(client,run,"LEASE_EXPIRED");
      throw failure("LEASE_EXPIRED");
    }
    return attempt;
  }

  async function bundle(client, run, row, overrides = {}) {
    const taskRows = await client.query("SELECT task_json FROM aidn_shared.execution_tasks WHERE run_id=$1 AND task_id=$2", [row.run_id, row.task_id]);
    const value = {
      plan: json(run, "plan_json"), run: json(run, "run_json"), task: json(taskRows.rows[0], "task_json"),
      attempt: json(row, "attempt_json"), delegation: json(row, "delegation_json"), request: json(row, "request_json"), ...overrides,
    };
    if (!validateAgentExecutionBindings(value).ok) throw failure("BINDING_INVALID");
    return value;
  }

  async function termination(row, proof, state) {
    if (typeof verifyTermination !== "function") throw failure("TERMINATION_VERIFIER_REQUIRED");
    if (state === "not_started" && row.runner_json) throw failure("TERMINATION_CONTRADICTION");
    const bounded = boundedJson(proof);
    if (!bounded || typeof bounded !== "object" || Array.isArray(bounded)) throw failure("TERMINATION_PROOF_REQUIRED");
    let verified = false;
    try {
      const result = await verifyTermination(json(row, "attempt_json"), copy(bounded), {
        runner: json(row, "runner_json"), request: json(row, "request_json"), termination_state: state,
      });
      verified = result === true || result?.ok === true;
    } catch { /* The verifier cannot leak process or connection details. */ }
    if (!verified) throw failure("TERMINATION_UNCONFIRMED");
    return bounded;
  }


  function supervisorView(row) {
    return row ? { ...json(row,"supervisor_json"), lease_until: row.lease_until,
      lease_live: row.lease_live === true, termination: json(row,"termination_json") } : null;
  }
  async function currentSupervisor(client, run) {
    return (await client.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM aidn_shared.execution_supervisors WHERE run_id=$1 AND generation=$2 FOR UPDATE",
      [run.run_id,run.supervisor_generation])).rows[0] ?? null;
  }
  function revision(run, expected) {
    if (!Number.isSafeInteger(expected) || expected !== Number(run.control_revision)) throw failure("CONTROL_REVISION_MISMATCH");
  }
  async function bump(client, run) {
    const row = (await client.query("UPDATE aidn_shared.execution_runs SET control_revision=control_revision+1,updated_at=clock_timestamp() WHERE run_id=$1 RETURNING control_revision",[run.run_id])).rows[0];
    run.control_revision = Number(row.control_revision);
  }
  async function supervisorGuard(client, run, ownership, { deadline = true, final = false, required = false } = {}) {
    if (run.supervision_mode !== "supervised") {
      if (required || ownership !== null && ownership !== undefined) throw failure("SUPERVISOR_REQUIRED");
      return null;
    }
    const row = await currentSupervisor(client,run), value = json(row,"supervisor_json");
    if (!ownership || !value || !same(value.ownership,ownership)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
    if (value.status !== "active" || !row.lease_live) {
      if (final) throw failure("SUPERVISOR_LEASE_EXPIRED");
      return recovery(client,run,"SUPERVISOR_LEASE_EXPIRED");
    }
    const timing = (await client.query("SELECT run_deadline_at>clock_timestamp() AS live FROM aidn_shared.execution_runs WHERE run_id=$1",[run.run_id])).rows[0];
    if (deadline && !timing.live) {
      if (final) throw failure("RUN_DEADLINE_EXPIRED");
      return recovery(client,run,"RUN_DEADLINE_EXPIRED");
    }
    if (!final) {
      const fences = transactionFences.get(client);
      const prior = fences?.get(run.run_id);
      fences?.set(run.run_id,{run,ownership:copy(ownership),deadline:deadline || prior?.deadline === true});
    }
    return row;
  }
  async function boundedVerification(operation, code) {
    const controller = new AbortController(), end = performance.now()+4500;
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise((_,reject) => { timer = setTimeout(() => reject(failure(code)),4500); }),
      ]);
      if (performance.now() >= end) throw failure(code);
      return value;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  async function inspectGit(run, supervisor, entry, phase, acceptedHeads, inputSha = null) {
    if (typeof inspectIntegration !== "function") throw failure("INTEGRATION_INSPECTOR_REQUIRED");
    let observed;
    try {
      observed = await boundedVerification(signal => inspectIntegration(copy(entry),{
        phase,run:json(run,"run_json"),supervisor:copy(supervisor),signal,
      }),"INTEGRATION_INSPECTION_TIMED_OUT");
    } catch (error) {
      if (knownFailures.has(error)) throw error;
      throw failure("INTEGRATION_INSPECTION_FAILED");
    }
    if (!observed || observed.ok !== true || observed.repository_identity_sha256 !== entry.repository_identity_sha256
      || observed.ref !== entry.ref || !acceptedHeads.includes(observed.head_sha)
      || (phase !== "head" && (observed.source_parent_sha !== inputSha || observed.result_parent_sha !== entry.parent_sha))) {
      throw failure("INTEGRATION_GIT_MISMATCH");
    }
    return observed;
  }
  function headInspection(head) {
    return { repository_identity_sha256:head.repository_identity_sha256,ref:head.ref,parent_sha:null,source_sha:null,result_sha:null };
  }
  async function integrationRows(client, runId) {
    return (await client.query("SELECT * FROM aidn_shared.execution_integrations WHERE run_id=$1 ORDER BY sequence",[runId])).rows;
  }
  function integrationView(row) {
    return { prepared:json(row,"prepared_json"),prepared_sha256:row.prepared_sha256,
      applied:json(row,"applied_json"),applied_sha256:row.applied_sha256 ?? null };
  }
  async function integrationChain(client, run) {
    const rows = await integrationRows(client,run.run_id), head = json(run,"integration_head_json");
    let parent = json(run,"plan_json").base.sha, sequence = 0;
    for (const row of rows) {
      const prepared = json(row,"prepared_json");
      if (Number(row.sequence) !== sequence+1 || prepared.parent_sha !== parent) throw failure("INTEGRATION_CHAIN_INVALID");
      if (!row.applied_json) break;
      const applied = json(row,"applied_json");
      if (applied.prepared_sha256 !== row.prepared_sha256 || applied.result_sha !== prepared.result_sha) throw failure("INTEGRATION_CHAIN_INVALID");
      parent = prepared.result_sha; sequence++;
    }
    if (!head || head.sha !== parent || head.sequence !== sequence) throw failure("INTEGRATION_CHAIN_INVALID");
    return {rows,head};
  }
  function taskOrder(plan) {
    const ordered = [], pending = new Map(plan.tasks.map(task => [task.task_id,task]));
    while (pending.size) {
      const ready = [...pending.values()].filter(task => task.depends_on.every(id => ordered.includes(id))).sort((a,b) => a.task_id < b.task_id ? -1 : 1);
      if (!ready.length) throw failure("DEPENDENCY_CYCLE");
      const selected = ready[0]; ordered.push(selected.task_id); pending.delete(selected.task_id);
    }
    return ordered;
  }
  async function requireAllIntegrated(client, run) {
    const {rows,head} = await integrationChain(client,run), plan = json(run,"plan_json");
    if (rows.length !== plan.tasks.length || rows.some(row => !row.applied_json)) throw failure("REQUIRED_TASKS_NOT_INTEGRATED");
    if (new Set(rows.map(row => json(row,"prepared_json").task_id)).size !== plan.tasks.length) throw failure("REQUIRED_TASKS_NOT_INTEGRATED");
    return head;
  }

  async function snapshot(client, run) {
    run=(await client.query("SELECT *,clock_timestamp() AS server_now FROM aidn_shared.execution_runs WHERE run_id=$1",[run.run_id])).rows[0];
    const supervisors=(await client.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM aidn_shared.execution_supervisors WHERE run_id=$1 ORDER BY generation",[run.run_id])).rows;
    const acceptances=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE run_id=$1 ORDER BY task_id,attempt_id",[run.run_id])).rows;
    const integrations=await integrationRows(client,run.run_id);
    const final=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[run.run_id])).rows[0];

    const tasks = await client.query("SELECT task_json FROM aidn_shared.execution_tasks WHERE run_id=$1 ORDER BY task_id", [run.run_id]);
    const attempts = await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 ORDER BY task_id,ordinal", [run.run_id]);
    const events = await client.query("SELECT event_json FROM aidn_shared.execution_events WHERE attempt_id IN (SELECT attempt_id FROM aidn_shared.execution_attempts WHERE run_id=$1) ORDER BY attempt_id,sequence", [run.run_id]);
    return { run: json(run, "run_json"), plan: json(run, "plan_json"), tasks: tasks.rows.map(row => json(row, "task_json")),
      attempts: attempts.rows.map(attemptView), events: events.rows.map(row => json(row, "event_json")),
      canonical_snapshot_sha256: run.canonical_snapshot_sha256, reservation_active: run.reservation_active,
      recovery_reason: run.recovery_reason ?? null,
      server_now:run.server_now,run_started_at:run.run_started_at,run_deadline_at:run.run_deadline_at,
      supervision:{mode:run.supervision_mode,control_revision:Number(run.control_revision),current:supervisorView(supervisors.at(-1)),history:supervisors.slice(0,-1).map(supervisorView)},
      acceptances:acceptances.map(row=>({acceptance:json(row,"acceptance_json"),acceptance_sha256:row.acceptance_sha256})),
      integrations:integrations.map(integrationView),integration_head:json(run,"integration_head_json"),
      final_validation:final ? {validation:json(final,"validation_json"),validation_sha256:final.validation_sha256} : null };
  }

  const store = {

    async claimSupervisor({runId,ownerId,runner,integration,expectedControlRevision,expectedPreviousGeneration=null}) {
      requireId(ownerId);
      if (typeof verifySupervisorTermination !== "function") throw failure("SUPERVISOR_TERMINATION_VERIFIER_REQUIRED");
      if (typeof inspectIntegration !== "function") throw failure("INTEGRATION_INSPECTOR_REQUIRED");
      if (!integration || Object.keys(integration).sort().join(",") !== "base_sha,ref,repository_identity_sha256"
        || !HASH.test(integration.repository_identity_sha256 ?? "") || typeof integration.ref !== "string"
        || !/^refs\/heads\/codex\/[A-Za-z0-9._/-]+$/.test(integration.ref) || integration.ref.includes("..")
        || integration.ref.includes("//") || /[/.]$/.test(integration.ref) || integration.ref.endsWith(".lock")) throw failure("INTEGRATION_TARGET_INVALID");
      return transaction(async client => {
        const run = await lockedRun(client,runId); revision(run,expectedControlRevision);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const plan = json(run,"plan_json"), prior = await currentSupervisor(client,run);
        if (integration.base_sha !== plan.base.sha || integration.ref === plan.base.branch
          || integration.ref === "refs/heads/"+plan.base.branch) throw failure("INTEGRATION_TARGET_INVALID");
        if (run.supervision_mode !== "supervised") {
          if (expectedPreviousGeneration !== null || (await client.query("SELECT 1 FROM aidn_shared.execution_attempts WHERE run_id=$1 LIMIT 1",[runId])).rows.length) throw failure("LEGACY_RUN_ADOPTION_REFUSED");
          await canonical(client,run);
        } else {
          if (!prior || expectedPreviousGeneration !== Number(prior.generation)
            || json(prior,"supervisor_json").status !== "stopped" || !prior.termination_json) throw failure("SUPERVISOR_RECONCILIATION_REQUIRED");
          const head = json(run,"integration_head_json");
          if (head.repository_identity_sha256 !== integration.repository_identity_sha256 || head.ref !== integration.ref) throw failure("INTEGRATION_TARGET_MISMATCH");
        }
        const generation = Number(run.supervisor_generation)+1;
        if (!Number.isSafeInteger(generation)) throw failure("GENERATION_LIMIT");
        const ownership = {owner_id:ownerId,generation,lease_id:randomUUID()};
        const supervisor = contract("supervisor",{contract_version:"agent-execution-supervisor.v1",run_id:runId,
          plan_sha256:plan.plan_sha256,ownership,runner:copy(runner),status:"active"});
        const priorHost = prior ? json(prior,"supervisor_json").runner.host_id : runner.host_id;
        if (priorHost !== runner.host_id) throw failure("SUPERVISOR_HOST_MISMATCH");
        const head = json(run,"integration_head_json") ?? {repository_identity_sha256:integration.repository_identity_sha256,ref:integration.ref,sha:plan.base.sha,sequence:0};
        await client.query("INSERT INTO aidn_shared.execution_supervisors(run_id,generation,lease_id,lease_until,supervisor_json) VALUES($1,$2,$3,clock_timestamp()+interval '60 seconds',$4::jsonb)",
          [runId,generation,ownership.lease_id,JSON.stringify(supervisor)]);
        await client.query("UPDATE aidn_shared.execution_runs SET supervision_mode='supervised',supervisor_generation=$2,integration_head_json=$3::jsonb,run_started_at=COALESCE(run_started_at,statement_timestamp()),run_deadline_at=COALESCE(run_deadline_at,statement_timestamp()+($4::bigint*interval '1 millisecond')),control_revision=control_revision+1,updated_at=clock_timestamp() WHERE run_id=$1",
          [runId,generation,JSON.stringify(head),plan.limits.max_duration_ms]);
        return snapshot(client,run);
      });
    },
    async renewSupervisor({runId,supervisor}) {
      return transaction(async client => {
        const run=await lockedRun(client,runId);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        await supervisorGuard(client,run,supervisor,{required:true,deadline:false});
        const changed = await client.query("UPDATE aidn_shared.execution_supervisors SET lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() WHERE run_id=$1 AND generation=$2 AND lease_until>clock_timestamp() RETURNING generation",[runId,supervisor.generation]);
        if (!changed.rows.length) return recovery(client,run,"SUPERVISOR_LEASE_EXPIRED");
        return snapshot(client,run);
      });
    },
    async expireSupervisor({runId,expectedSupervisor}) {
      return transaction(async client => {
        const run=await lockedRun(client,runId), row=await currentSupervisor(client,run);
        if (!row || !same(json(row,"supervisor_json").ownership,expectedSupervisor)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
        if (!row.lease_live && json(row,"supervisor_json").status === "active") {
          await client.query("UPDATE aidn_shared.execution_supervisors SET supervisor_json=jsonb_set(supervisor_json,'{status}','\"recovery_required\"'::jsonb),updated_at=clock_timestamp() WHERE run_id=$1 AND generation=$2",[runId,row.generation]);
          await recovery(client,run,"SUPERVISOR_LEASE_EXPIRED",false);
        }
        return snapshot(client,run);
      });
    },
    async reconcileSupervisor({runId,expectedSupervisor,expectedControlRevision,proof}) {
      const bounded=boundedJson(proof);
      if (typeof verifySupervisorTermination !== "function") throw failure("SUPERVISOR_TERMINATION_VERIFIER_REQUIRED");
      return transaction(async client => {
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const row=await currentSupervisor(client,run), value=json(row,"supervisor_json");
        if (!value || !same(value.ownership,expectedSupervisor)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
        if (row.termination_json) {
          if (!same(json(row,"termination_json"),bounded)) throw failure("SUPERVISOR_TERMINATION_CONFLICT");
          return snapshot(client,run);
        }
        if (row.lease_live && value.status === "active" && json(run,"run_json").lifecycle_status !== "recovery_required") throw failure("SUPERVISOR_STILL_ACTIVE");
        let observed;
        try { observed=await boundedVerification(async signal => verifySupervisorTermination(copy(value),copy(bounded),{
          run:json(run,"run_json"),pendingIntegrations:(await integrationRows(client,runId)).filter(entry=>!entry.applied_json).map(integrationView),signal,
        }),"SUPERVISOR_TERMINATION_TIMED_OUT"); } catch { throw failure("SUPERVISOR_TERMINATION_UNCONFIRMED"); }
        if (!observed || ["ok","supervisor_stopped","descendants_stopped","git_operations_stopped"].some(field=>observed[field]!==true)) throw failure("SUPERVISOR_TERMINATION_UNCONFIRMED");
        await client.query("UPDATE aidn_shared.execution_supervisors SET supervisor_json=jsonb_set(supervisor_json,'{status}','\"stopped\"'::jsonb),termination_json=$3::jsonb,lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=$1 AND generation=$2",[runId,row.generation,JSON.stringify(bounded)]);
        await recovery(client,run,"SUPERVISOR_RECONCILED",false); await bump(client,run);
        return snapshot(client,run);
      });
    },
    async resumeRun({runId,supervisor,expectedControlRevision}) {
      return transaction(async client => {
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const unresolved=await client.query("SELECT 1 FROM aidn_shared.execution_attempts WHERE run_id=$1 AND (attempt_json->>'lifecycle_status' IN ('launch_intended','running','recovery_required') OR (termination_json IS NULL AND reconciliation_json IS NULL)) LIMIT 1",[runId]);
        if (unresolved.rows.length || (await integrationRows(client,runId)).some(row=>!row.applied_json)) throw failure("RECOVERY_REQUIRED");
        const {head}=await integrationChain(client,run);
        await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
        await updateRunStatus(client,run,"running");
        await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason=NULL WHERE run_id=$1",[runId]);
        return snapshot(client,run);
      });
    },
    async recordPreparation({attemptId,ownership,supervisor=null,preparation}) {
      const value=boundedJson(preparation), evidence=value?.evidence;
      if (!value || Object.keys(value).sort().join(",") !== "evidence,request_sha256" || !HASH.test(value.request_sha256 ?? "")
        || !evidence || Object.keys(evidence).sort().join(",") !== "bytes,ref,sha256"
        || !isExactExecutionPath(evidence.ref) || !HASH.test(evidence.sha256 ?? "")
        || !Number.isSafeInteger(evidence.bytes) || evidence.bytes<0) throw failure("PREPARATION_INVALID");
      return transaction(async client => {
        const {run,row}=await lockedAttempt(client,attemptId);
        await supervisorGuard(client,run,supervisor); await live(client,run,row,ownership);
        if (!row.request_json || fingerprintAgentExecutionValue(json(row,"request_json"))!==value.request_sha256) throw failure("PREPARATION_REQUEST_MISMATCH");
        if (row.preparation_json && !same(json(row,"preparation_json"),value)) throw failure("PREPARATION_CONFLICT");
        if (!row.preparation_json) await client.query("UPDATE aidn_shared.execution_attempts SET preparation_json=$2::jsonb,updated_at=clock_timestamp() WHERE attempt_id=$1",[attemptId,JSON.stringify(value)]);
        return {...attemptView(row),preparation:copy(value),idempotent:Boolean(row.preparation_json)};
      });
    },
    async recordAcceptance({runId,supervisor,acceptance}) {
      acceptance=copy(contract("acceptance",acceptance));
      supervisor=copy(supervisor);
      return transaction(async client => {
        const run=await lockedRun(client,runId);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active || !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
        const row=(await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 AND attempt_id=$2 FOR UPDATE",[runId,acceptance.attempt_id])).rows[0];
        if (!row || !row.result_json || !row.termination_json || !row.preparation_json) throw failure("ACCEPTANCE_RESULT_REQUIRED");
        await bundle(client,run,row,{result:json(row,"result_json"),acceptance});
        if (acceptance.integration.status !== (acceptance.decision==="accepted" ? "pending" : "not_requested")
          || acceptance.integration.integrated_sha !== null
          || (acceptance.decision==="accepted" && acceptance.integration.source_sha !== acceptance.candidate_sha)) throw failure("ACCEPTANCE_INTEGRATION_INVALID");
        const hash=fingerprintAgentExecutionValue(acceptance);
        const existing=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE attempt_id=$1",[acceptance.attempt_id])).rows[0];
        if (existing && (existing.acceptance_sha256!==hash || !same(json(existing,"acceptance_json"),acceptance))) throw failure("ACCEPTANCE_CONFLICT");
        if (!existing) await client.query("INSERT INTO aidn_shared.execution_acceptances(attempt_id,run_id,task_id,acceptance_sha256,acceptance_json,supervisor_generation) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
          [acceptance.attempt_id,runId,acceptance.task_id,hash,JSON.stringify(acceptance),supervisor.generation]);
        return {acceptance:copy(acceptance),acceptance_sha256:hash,idempotent:Boolean(existing)};
      });
    },
    async prepareIntegration({runId,supervisor,expectedControlRevision,integration}) {
      integration=copy(contract("integration-prepared",integration));
      supervisor=copy(supervisor);
      return transaction(async client => {
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const {rows,head}=await integrationChain(client,run), hash=fingerprintAgentExecutionValue(integration);
        const existing=rows.find(row=>row.integration_id===integration.integration_id);
        if (integration.run_id!==runId || integration.plan_sha256!==run.plan_sha256
          || integration.ref!==head.ref || integration.repository_identity_sha256!==head.repository_identity_sha256) throw failure("INTEGRATION_BINDING_INVALID");
        if (existing && (existing.prepared_sha256!==hash || !same(json(existing,"prepared_json"),integration))) throw failure("INTEGRATION_CONFLICT");
        const acceptance=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE attempt_id=$1 AND run_id=$2",[integration.attempt_id,runId])).rows[0];
        const attempt=(await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE attempt_id=$1 AND run_id=$2",[integration.attempt_id,runId])).rows[0];
        if (!acceptance || !attempt || acceptance.acceptance_sha256!==integration.acceptance_sha256
          || acceptance.task_id!==integration.task_id || json(acceptance,"acceptance_json").decision!=="accepted"
          || json(acceptance,"acceptance_json").candidate_sha!==integration.source_sha) throw failure("INTEGRATION_ACCEPTANCE_REQUIRED");
        if (!existing) {
          if (!same(integration.prepared_by,supervisor)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
          if (!RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
          if (rows.some(row=>!row.applied_json)) throw failure("INTEGRATION_PENDING");
          if (integration.parent_sha!==head.sha || integration.sequence!==head.sequence+1) throw failure("INTEGRATION_PARENT_MISMATCH");
          const plan=json(run,"plan_json"), earlier=taskOrder(plan).slice(0,taskOrder(plan).indexOf(integration.task_id));
          const attempts=(await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 ORDER BY ordinal",[runId])).rows;
          const acceptances=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE run_id=$1",[runId])).rows;
          const failed = taskId => {
            const last=attempts.filter(row=>row.task_id===taskId).at(-1), accepted=acceptances.find(row=>row.task_id===taskId);
            if (accepted && json(accepted,"acceptance_json").decision==="rejected") return true;
            if (last && ["failed","cancelled","timed_out"].includes(json(last,"attempt_json").lifecycle_status)) return true;
            return plan.tasks.find(task=>task.task_id===taskId).depends_on.some(failed);
          };
          if (earlier.some(taskId=>!rows.some(row=>row.applied_json && json(row,"prepared_json").task_id===taskId) && !failed(taskId))) throw failure("INTEGRATION_ORDER_INVALID");
        } else if (!same(integration.prepared_by,supervisor)) {
          const previous=(await client.query("SELECT termination_json FROM aidn_shared.execution_supervisors WHERE run_id=$1 AND generation=$2",[runId,integration.prepared_by.generation])).rows[0];
          if (!previous?.termination_json) throw failure("SUPERVISOR_RECONCILIATION_REQUIRED");
        }
        await inspectGit(run,supervisor,integration,"prepared",existing ? [integration.parent_sha,integration.result_sha] : [integration.parent_sha],json(attempt,"attempt_json").input_sha);
        if (!existing) {
          await client.query("INSERT INTO aidn_shared.execution_integrations(run_id,integration_id,sequence,attempt_id,prepared_sha256,prepared_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
            [runId,integration.integration_id,integration.sequence,integration.attempt_id,hash,JSON.stringify(integration)]);
          await bump(client,run);
        }
        return {integration:copy(integration),prepared_sha256:hash,integration_head:head,control_revision:Number(run.control_revision),idempotent:Boolean(existing)};
      });
    },
    async recordIntegrationApplied({runId,supervisor,expectedControlRevision,integrationId,preparedSha256,proof,reconciliation=false}) {
      if (typeof reconciliation !== "boolean") throw failure("RECONCILIATION_INVALID");
      supervisor=copy(supervisor);
      const evidenceProof=boundedJson(proof);
      if (!evidenceProof || Object.keys(evidenceProof).join(",")!=="evidence") throw failure("INTEGRATION_PROOF_INVALID");
      return transaction(async client => {
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        await supervisorGuard(client,run,supervisor,{required:true,deadline:!reconciliation});
        // Recovery records a fact about the immutable original preparation. A
        // revoked canonical context must still permit observing an earlier CAS;
        // it never grants authority to resume work or move another Git ref.
        if (!reconciliation) await canonical(client,run);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        if (reconciliation && json(run,"run_json").lifecycle_status !== "recovery_required") throw failure("RECONCILIATION_NOT_REQUIRED");
        const {rows,head}=await integrationChain(client,run), row=rows.find(item=>item.integration_id===integrationId), prepared=json(row,"prepared_json");
        if (!row || row.prepared_sha256!==preparedSha256) throw failure("INTEGRATION_BINDING_INVALID");
        const applied=contract("integration-applied",{contract_version:"agent-integration-applied.v1",integration_id:integrationId,
          run_id:runId,plan_sha256:run.plan_sha256,sequence:prepared.sequence,prepared_sha256:preparedSha256,result_sha:prepared.result_sha,
          applied_by:row.applied_json ? json(row,"applied_json").applied_by : copy(supervisor),evidence:copy(evidenceProof.evidence)});
        const hash=fingerprintAgentExecutionValue(applied);
        if (row.applied_json && (row.applied_sha256!==hash || !same(json(row,"applied_json"),applied))) throw failure("INTEGRATION_APPLIED_CONFLICT");
        if (!row.applied_json && !same(applied.applied_by,supervisor)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
        const attempt=(await client.query("SELECT attempt_json FROM aidn_shared.execution_attempts WHERE attempt_id=$1",[row.attempt_id])).rows[0];
        await inspectGit(run,supervisor,prepared,"applied",[prepared.result_sha],json(attempt,"attempt_json").input_sha);
        if (!row.applied_json) {
          if (head.sha!==prepared.parent_sha || head.sequence+1!==prepared.sequence) throw failure("INTEGRATION_PARENT_MISMATCH");
          await client.query("UPDATE aidn_shared.execution_integrations SET applied_json=$3::jsonb,applied_sha256=$4,applied_at=clock_timestamp() WHERE run_id=$1 AND integration_id=$2 AND applied_json IS NULL",[runId,integrationId,JSON.stringify(applied),hash]);
          head.sha=prepared.result_sha; head.sequence=prepared.sequence;
          await client.query("UPDATE aidn_shared.execution_runs SET integration_head_json=$2::jsonb WHERE run_id=$1",[runId,JSON.stringify(head)]);
          await bump(client,run);
        }
        return {integration:{...integrationView(row),applied:copy(applied),applied_sha256:hash},integration_head:head,control_revision:Number(run.control_revision),idempotent:Boolean(row.applied_json)};
      });
    },
    async recordRunValidation({runId,supervisor,expectedControlRevision,validation}) {
      validation=copy(contract("run-validation",validation));
      supervisor=copy(supervisor);
      return transaction(async client => {
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active || !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
        const head=await requireAllIntegrated(client,run);
        if (!validateAgentRunValidationBindings({plan:json(run,"plan_json"),run:json(run,"run_json"),validation,integratedSha:head.sha,integrationSequence:head.sequence}).ok) throw failure("FINAL_VALIDATION_BINDING_INVALID");
        await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
        const hash=fingerprintAgentExecutionValue(validation);
        const old=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[runId])).rows[0];
        if (old && (old.validation_sha256!==hash || !same(json(old,"validation_json"),validation))) throw failure("FINAL_VALIDATION_CONFLICT");
        if (!old) {
          await client.query("INSERT INTO aidn_shared.execution_run_validations(run_id,validation_sha256,validation_json,supervisor_generation) VALUES($1,$2,$3::jsonb,$4)",[runId,hash,JSON.stringify(validation),supervisor.generation]);
          await bump(client,run);
        }
        return {validation:copy(validation),validation_sha256:hash,control_revision:Number(run.control_revision),idempotent:Boolean(old)};
      });
    },

    async checkReadiness() { return withClient(readiness); },
    async readCanonicalDigest({ scopeKey }) { return transaction(client => digest(client, scopeKey), true); },
    async getRun({ runId }) {
      requireId(runId);
      return transaction(async client => {
        const found = await client.query("SELECT * FROM aidn_shared.execution_runs WHERE run_id=$1", [runId]);
        return found.rows.length ? snapshot(client, found.rows[0]) : null;
      }, true);
    },
    async reserveRun({ plan: input, runId, planningKey, canonicalSnapshotSha256 }) {
      requireId(runId); requireId(planningKey); requireHash(canonicalSnapshotSha256);
      let plan;
      try { plan = normalizeAgentExecutionPlan(input); } catch { throw failure("CONTRACT_INVALID"); }
      const run = contract("run", {
        contract_version: "agent-execution-run.v1", run_id: runId, plan_id: plan.plan_id, plan_sha256: plan.plan_sha256,
        authority_backend: "postgres", canonical: copy(plan.canonical), task_ids: plan.tasks.map(task => task.task_id), lifecycle_status: "planned",
      });
      return transaction(async client => {
        const row = {
          run_id: runId, project_id: plan.canonical.project_id, workspace_id: plan.canonical.workspace_id,
          runtime_scope_id: plan.canonical.runtime_scope_id, planning_key: planningKey, planning_revision: plan.canonical.planning_revision,
          canonical_snapshot_sha256: canonicalSnapshotSha256, plan_json: plan, run_json: run,
        };
        await locks(client, row);
        await canonical(client, row, false);
        await client.query(`INSERT INTO aidn_shared.execution_runs
          (run_id,project_id,workspace_id,runtime_scope_id,planning_key,planning_revision,plan_sha256,canonical_snapshot_sha256,plan_json,run_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
        [runId,row.project_id,row.workspace_id,row.runtime_scope_id,planningKey,row.planning_revision,plan.plan_sha256,canonicalSnapshotSha256,JSON.stringify(plan),JSON.stringify(run)]);
        for (const spec of plan.tasks) {
          const task = contract("task", { contract_version: "agent-delegated-task.v1", run_id: runId, plan_sha256: plan.plan_sha256, task_contract_sha256: fingerprintTaskContract(spec), ...copy(spec) });
          await client.query("INSERT INTO aidn_shared.execution_tasks (run_id,task_id,task_json) VALUES ($1,$2,$3::jsonb)", [runId,task.task_id,JSON.stringify(task)]);
        }
        return snapshot(client, { ...row, reservation_active: true });
      });
    },
    async claimAttempt({ runId, taskId, ownerId, attemptId, inputSha, worktree, expectedPreviousAttemptId = null, supervisor = null, expectedIntegrationSequence = null }) {
      [runId,taskId,ownerId,attemptId].forEach(requireId);
      if (expectedPreviousAttemptId !== null) requireId(expectedPreviousAttemptId);
      return transaction(async client => {
        const run = await lockedRun(client, runId);
        await supervisorGuard(client,run,supervisor);
        if (!run.reservation_active || !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
        const plan = await canonical(client, run);
        const taskRows = await client.query("SELECT * FROM aidn_shared.execution_tasks WHERE run_id=$1 AND task_id=$2 FOR UPDATE", [runId,taskId]);
        if (!taskRows.rows.length) throw failure("TASK_NOT_FOUND");
        const taskRow = taskRows.rows[0], task = json(taskRow,"task_json");
        let dependencyBinding = null;
        if (task.depends_on.length) {
          if (run.supervision_mode !== "supervised") throw failure("DEPENDENCY_PROOF_REQUIRED");
          const {rows,head} = await integrationChain(client,run);
          if (inputSha !== head.sha || expectedIntegrationSequence !== head.sequence) throw failure("INPUT_SHA_MISMATCH");
          const predecessors = task.depends_on.map(taskId => rows.find(row => row.applied_json && json(row,"prepared_json").task_id === taskId));
          if (predecessors.some(row=>!row)) throw failure("DEPENDENCY_PROOF_REQUIRED");
          await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
          dependencyBinding = { input_sha:inputSha,integration_sequence:head.sequence,predecessors:predecessors.map(row=>({
            task_id:json(row,"prepared_json").task_id,integration_id:row.integration_id,prepared_sha256:row.prepared_sha256,applied_sha256:row.applied_sha256,
          })) };
        } else if (inputSha !== plan.base.sha) throw failure("INPUT_SHA_MISMATCH");
        if (run.supervision_mode === "supervised" && "refs/heads/"+worktree.branch === json(run,"integration_head_json").ref) throw failure("INTEGRATION_TARGET_INVALID");
        const previous = await client.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM aidn_shared.execution_attempts WHERE run_id=$1 ORDER BY task_id,ordinal FOR UPDATE", [runId]);
        if (previous.rows.some(row => ACTIVE.has(json(row,"attempt_json").lifecycle_status) && !row.lease_live)) return recovery(client,run,"LEASE_EXPIRED");
        const sameTask = previous.rows.filter(row => row.task_id === taskId);
        const last = sameTask.at(-1);
        if (last) {
          if (last.attempt_id !== expectedPreviousAttemptId) throw failure("EXPLICIT_RETRY_REQUIRED");
          if (ACTIVE.has(json(last,"attempt_json").lifecycle_status) || json(last,"attempt_json").lifecycle_status === "recovery_required"
            || (!last.termination_json && !last.reconciliation_json)) throw failure("RECOVERY_REQUIRED");
          if (json(last,"result_json")?.outcome === "completed") throw failure("TASK_ALREADY_COMPLETED");
        } else if (expectedPreviousAttemptId !== null) throw failure("PREDECESSOR_MISMATCH");
        if (previous.rows.some(row => json(row,"attempt_json").lifecycle_status === "recovery_required")) throw failure("RECOVERY_REQUIRED");
        const active = previous.rows.filter(row => ACTIVE.has(json(row,"attempt_json").lifecycle_status));
        if (active.length >= plan.limits.concurrency) throw failure("CONCURRENCY_LIMIT");
        const ordinal = Number(taskRow.next_ordinal) + 1;
        const generation = Math.max(0, ...sameTask.map(row => Number(row.generation))) + 1;
        if (!Number.isSafeInteger(ordinal) || !Number.isSafeInteger(generation)) throw failure("GENERATION_LIMIT");
        const ownership = { owner_id: ownerId, generation, planning_revision: plan.canonical.planning_revision, lease_id: randomUUID() };
        const refs = { run_id: runId, task_id: taskId, attempt_id: attemptId, plan_sha256: plan.plan_sha256, task_contract_sha256: task.task_contract_sha256, input_sha: inputSha };
        const attempt = contract("attempt", { contract_version: "agent-execution-attempt.v1", ...refs, ordinal, worktree: copy(worktree), activation: copy(plan.canonical.activation), ownership, lifecycle_status: "launch_intended" });
        const conflicts = await client.query(`SELECT attempt_id FROM aidn_shared.execution_attempts WHERE
          attempt_json->'worktree'->>'worktree_id'=$1 OR attempt_json->'worktree'->>'branch'=$2
          OR lower(replace(attempt_json->'worktree'->>'cwd',chr(92),'/'))=lower(replace($3,chr(92),'/')) LIMIT 1`, [worktree.worktree_id,worktree.branch,worktree.cwd]);
        if (conflicts.rows.length) throw failure("WORKTREE_IDENTITY_REUSED");
        const delegation = contract("delegation", { contract_version: "agent-task-delegation.v1", delegation_id: randomUUID(), ...refs, worktree: copy(worktree), activation: copy(plan.canonical.activation), ownership: copy(ownership), scope: copy(task.scope) });
        const inserted = await client.query(`INSERT INTO aidn_shared.execution_attempts
          (attempt_id,run_id,task_id,ordinal,owner_id,generation,lease_id,lease_until,attempt_json,delegation_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8::bigint*interval '1 millisecond'),$9::jsonb,$10::jsonb) RETURNING *`,
        [attemptId,runId,taskId,ordinal,ownerId,generation,ownership.lease_id,AGENT_EXECUTION_LEASE_MS,JSON.stringify(attempt),JSON.stringify(delegation)]);
        if (dependencyBinding) {
          await client.query("UPDATE aidn_shared.execution_attempts SET dependency_binding_json=$2::jsonb WHERE attempt_id=$1",[attemptId,JSON.stringify(dependencyBinding)]);
          inserted.rows[0].dependency_binding_json=dependencyBinding;
        }
        await client.query("UPDATE aidn_shared.execution_tasks SET next_ordinal=$3 WHERE run_id=$1 AND task_id=$2", [runId,taskId,ordinal]);
        await updateRunStatus(client, run, "running");
        return attemptView(inserted.rows[0]);
      });
    },
    async recordLaunchIntent({ attemptId, ownership, request, supervisor = null }) {
      contract("request", request);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor);
        await live(client, run, row, ownership);
        await bundle(client, run, row, { request });
        if (row.request_json && !same(json(row,"request_json"),request)) throw failure("LAUNCH_INTENT_CONFLICT");
        if (!row.request_json) {
          const changed = await client.query("UPDATE aidn_shared.execution_attempts SET request_json=$2::jsonb, updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING attempt_id", [attemptId,JSON.stringify(request)]);
          if (!changed.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        }
        return { ...attemptView(row), request: copy(request) };
      });
    },
    async observeRunner({ attemptId, ownership, runner, supervisor = null }) {
      const observed = boundedJson(runner);
      if (!observed || Object.keys(observed).sort().join(",") !== "host_id,pid,runner_id,started_at"
        || !ID.test(observed.runner_id ?? "") || !ID.test(observed.host_id ?? "")
        || !Number.isSafeInteger(observed.pid) || observed.pid < 1
        || typeof observed.started_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(observed.started_at)
        || !Number.isFinite(Date.parse(observed.started_at))) throw failure("RUNNER_INVALID");
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor);
        const attempt = await live(client, run, row, ownership);
        if (!row.request_json) throw failure("LAUNCH_INTENT_REQUIRED");
        if (run.supervision_mode === "supervised" && !row.preparation_json) throw failure("PREPARATION_REQUIRED");
        if (row.runner_json && !same(json(row,"runner_json"),observed)) throw failure("RUNNER_CONFLICT");
        const running = { ...attempt, lifecycle_status: "running" };
        if (!row.runner_json) {
          const changed = await client.query("UPDATE aidn_shared.execution_attempts SET runner_json=$2::jsonb, attempt_json=$3::jsonb, updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING attempt_id", [attemptId,JSON.stringify(observed),JSON.stringify(running)]);
          if (!changed.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        }
        return { ...attemptView(row), attempt: running, runner: observed };
      });
    },
    async renewAttempt({ attemptId, ownership, supervisor = null }) {
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor);
        await live(client, run, row, ownership);
        const renewed = await client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()+($2::bigint*interval '1 millisecond'), updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING *", [attemptId,AGENT_EXECUTION_LEASE_MS]);
        if (!renewed.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        return attemptView(renewed.rows[0]);
      });
    },
    async admitDelegatedRequest({ attemptId, ownership, requestSha256, delegationSha256, evaluate, supervisor = null }) {
      requireHash(requestSha256); requireHash(delegationSha256);
      if (typeof evaluate !== "function") throw failure("ADMISSION_EVALUATOR_REQUIRED");
      return transaction(async client => {
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        await client.query("SET LOCAL statement_timeout = '3000ms'");
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor);
        await live(client, run, row, ownership);
        if (!row.request_json) throw failure("LAUNCH_INTENT_REQUIRED");
        if (fingerprintAgentExecutionValue(json(row,"request_json")) !== requestSha256
          || fingerprintAgentExecutionValue(json(row,"delegation_json")) !== delegationSha256) throw failure("ADMISSION_BINDING_INVALID");
        const context = await bundle(client, run, row);
        const abort = new AbortController(), deadline = performance.now() + ADMISSION_EVALUATION_MS;
        const expired = failure("ADMISSION_EVALUATION_TIMED_OUT");
        let decision, timer;
        try {
          const evaluation = Promise.resolve().then(() => evaluate(copy(context), { signal: abort.signal }));
          const timeout = new Promise((_,reject) => {
            timer = setTimeout(() => { abort.abort(); reject(expired); }, ADMISSION_EVALUATION_MS);
          });
          const evaluated = await Promise.race([evaluation,timeout]);
          // A synchronous callback can delay timer delivery. It must not win
          // with an already-expired result when control reaches us again.
          if (performance.now() >= deadline) throw expired;
          decision = boundedJson(evaluated);
        } catch (error) { throw error === expired ? error : failure("ADMISSION_EVALUATION_FAILED"); }
        finally { clearTimeout(timer); abort.abort(); }
        if (!decision || !["allow","deny"].includes(decision.outcome)) throw failure("ADMISSION_DECISION_INVALID");
        // Filesystem, activation and preparation observations can take time.
        // The result is authoritative only while ownership is still live using
        // PostgreSQL time, with the canonical reservation locked throughout.
        await live(client, run, row, ownership);
        return decision;
      });
    },
    async appendEvent({ attemptId, ownership, event, supervisor = null }) {
      contract("event", event);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor);
        const attempt = assertOwnership(run,row,ownership);
        if (!row.request_json) throw failure("LAUNCH_INTENT_REQUIRED");
        if (["run_id","task_id","attempt_id","plan_sha256"].some(field => event[field] !== attempt[field])) throw failure("EVENT_BINDING_INVALID");
        const hash = fingerprintAgentExecutionValue(event);
        const existing = await client.query("SELECT payload_sha256,event_json FROM aidn_shared.execution_events WHERE attempt_id=$1 AND event_id=$2", [attemptId,event.event_id]);
        if (existing.rows.length) {
          if (existing.rows[0].payload_sha256 !== hash || !same(json(existing.rows[0],"event_json"),event)) throw failure("EVENT_CONFLICT");
          // A delivery replay only reads immutable evidence. It remains valid
          // after normal closure, without extending a lease or emitting again.
          return { event: copy(event), idempotent: true };
        }
        await live(client, run, row, ownership);
        const latest = await client.query("SELECT COALESCE(MAX(sequence),0) AS sequence FROM aidn_shared.execution_events WHERE attempt_id=$1", [attemptId]);
        if (event.sequence !== Number(latest.rows[0].sequence)+1 || event.sequence > 10000) throw failure("EVENT_SEQUENCE_INVALID");
        const inserted = await client.query(`INSERT INTO aidn_shared.execution_events (attempt_id,event_id,sequence,payload_sha256,event_json)
          SELECT $1,$2,$3,$4,$5::jsonb FROM aidn_shared.execution_attempts WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING event_id`, [attemptId,event.event_id,event.sequence,hash,JSON.stringify(event)]);
        if (!inserted.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        return { event: copy(event), idempotent: false };
      });
    },
    async recordResult({ attemptId, ownership, result, terminationProof, supervisor = null }) {
      contract("result", result);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor);
        const attempt = await live(client, run, row, ownership, { allowTerminal: Boolean(row.result_json) });
        if (!row.request_json) throw failure("LAUNCH_INTENT_REQUIRED");
        if (run.supervision_mode === "supervised" && !row.preparation_json) throw failure("PREPARATION_REQUIRED");
        const ended = { ...attempt, lifecycle_status: result.outcome === "indeterminate" ? "recovery_required" : result.outcome };
        await bundle(client, run, row, { attempt: ended, result });
        if (row.result_json) {
          if (!same(json(row,"result_json"),result)) throw failure("RESULT_CONFLICT");
          return { ...attemptView(row), idempotent: true };
        }
        if (result.termination_state === "confirmed" && !row.runner_json) throw failure("RUNNER_OBSERVATION_REQUIRED");
        const proof = result.termination_state === "unknown" ? null : await termination(row,terminationProof,result.termination_state);
        await canonical(client,run);
        // Re-check PostgreSQL time after a possibly slow external verifier.
        const persisted = await client.query(`UPDATE aidn_shared.execution_attempts
          SET attempt_json=$2::jsonb,result_json=$3::jsonb,termination_json=$4::jsonb,updated_at=clock_timestamp()
          WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING *`, [attemptId,JSON.stringify(ended),JSON.stringify(result),proof === null ? null : JSON.stringify(proof)]);
        if (!persisted.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        if (result.outcome === "indeterminate") {
          await updateRunStatus(client,run,"recovery_required");
          await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason='TERMINATION_UNKNOWN' WHERE run_id=$1", [run.run_id]);
        }
        return attemptView(persisted.rows[0]);
      });
    },
    async expireAttempts({ runId, supervisor = null }) {
      return transaction(async client => {
        const run = await lockedRun(client, runId);
        await supervisorGuard(client,run,supervisor,{deadline:false});
        const expired = await client.query(`UPDATE aidn_shared.execution_attempts
          SET attempt_json=jsonb_set(attempt_json,'{lifecycle_status}','"recovery_required"'::jsonb),
              generation=generation+1,updated_at=clock_timestamp()
          WHERE run_id=$1 AND lease_until<=clock_timestamp() AND attempt_json->>'lifecycle_status' IN ('launch_intended','running') RETURNING attempt_id`, [runId]);
        if (expired.rows.length) {
          await updateRunStatus(client,run,"recovery_required");
          await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason='LEASE_EXPIRED' WHERE run_id=$1", [runId]);
        }
        return { run: json(run,"run_json"), expired_attempt_ids: expired.rows.map(row => row.attempt_id) };
      });
    },
    async invalidateRun({ runId, reason, supervisor = null }) {
      if (typeof reason !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(reason)) throw failure("REASON_INVALID");
      return transaction(async client => {
        const run = await lockedRun(client, runId);
        await supervisorGuard(client,run,supervisor,{deadline:false});
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        await updateRunStatus(client,run,"recovery_required");
        await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason=$2 WHERE run_id=$1", [runId,reason]);
        await client.query(`UPDATE aidn_shared.execution_attempts
          SET attempt_json=jsonb_set(attempt_json,'{lifecycle_status}','"recovery_required"'::jsonb),
              generation=generation+1,lease_until=clock_timestamp(),updated_at=clock_timestamp()
          WHERE run_id=$1 AND attempt_json->>'lifecycle_status' IN ('launch_intended','running')`, [runId]);
        return { run: json(run,"run_json"), reason };
      });
    },
    async reconcileAttempt({ attemptId, proof, supervisor = null }) {
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor,{deadline:false});
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const attempt = json(row,"attempt_json");
        if (row.reconciliation_json) {
          if (!same(json(row,"reconciliation_json"),boundedJson(proof))) throw failure("RECONCILIATION_CONFLICT");
          return { ...attemptView(row), idempotent: true };
        }
        if (!ACTIVE.has(attempt.lifecycle_status) && attempt.lifecycle_status !== "recovery_required") throw failure("RECONCILIATION_NOT_REQUIRED");
        const verified = await termination(row,proof,"confirmed");
        const ended = { ...attempt, lifecycle_status: "cancelled" };
        const reconciled = await client.query(`UPDATE aidn_shared.execution_attempts SET
          attempt_json=$2::jsonb,reconciliation_json=$3::jsonb,generation=generation+1,
          lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE attempt_id=$1 RETURNING *`, [attemptId,JSON.stringify(ended),JSON.stringify(verified)]);
        const unresolved = await client.query("SELECT attempt_id FROM aidn_shared.execution_attempts WHERE run_id=$1 AND attempt_json->>'lifecycle_status'='recovery_required' LIMIT 1", [run.run_id]);
        if (!unresolved.rows.length && run.supervision_mode !== "supervised") {
          // Reconciliation proves process death only. Revoked or changed context
          // remains fenced; successful reconciliation never reauthorizes it.
          try {
            await canonical(client,run,false);
            await updateRunStatus(client,run,"running");
            await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason=NULL WHERE run_id=$1", [run.run_id]);
          }
          catch (error) { if (!/^AGENT_EXECUTION_(ACTIVATION_INVALID|CANONICAL_CHANGED|CANONICAL_PLAN_MISMATCH|PLANNING_CHANGED)$/.test(error.code ?? "")) throw error; }
        }
        return attemptView(reconciled.rows[0]);
      });
    },
    async finishRun({ runId, outcome, supervisor = null, expectedControlRevision = null, finalValidationSha256 = null }) {
      if (!["completed","failed","cancelled"].includes(outcome)) throw failure("OUTCOME_INVALID");
      return transaction(async client => {
        const run = await lockedRun(client, runId);
        await supervisorGuard(client,run,supervisor,{deadline:outcome === "completed"});
        if (outcome === "completed") {
          if (run.supervision_mode !== "supervised") throw failure("ACCEPTANCE_REQUIRED");
          revision(run,expectedControlRevision); await canonical(client,run);
          if (run.reservation_active && !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RECOVERY_REQUIRED");
          const head=await requireAllIntegrated(client,run);
          const final=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[runId])).rows[0];
          if (!final || final.validation_sha256!==finalValidationSha256 || json(final,"validation_json").outcome!=="passed"
            || !validateAgentRunValidationBindings({plan:json(run,"plan_json"),run:json(run,"run_json"),validation:json(final,"validation_json"),integratedSha:head.sha,integrationSequence:head.sequence}).ok) throw failure("FINAL_VALIDATION_REQUIRED");
          await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
        }
        if (!run.reservation_active) {
          if (json(run,"run_json").lifecycle_status !== outcome) throw failure("RUN_TERMINAL_CONFLICT");
          if (run.supervision_mode === "supervised") return snapshot(client,run);
          return { run: json(run,"run_json"), reservation_active: false };
        }
        const attempts = await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 FOR UPDATE", [runId]);
        if (run.supervision_mode === "supervised" && (await integrationRows(client,runId)).some(row=>!row.applied_json)) throw failure("RECOVERY_REQUIRED");
        if (attempts.rows.some(row => ACTIVE.has(json(row,"attempt_json").lifecycle_status)
          || json(row,"attempt_json").lifecycle_status === "recovery_required"
          || (!row.termination_json && !row.reconciliation_json))) throw failure("RECOVERY_REQUIRED");
        const ended = await updateRunStatus(client,run,outcome);
        await client.query("UPDATE aidn_shared.execution_runs SET reservation_active=false,updated_at=clock_timestamp() WHERE run_id=$1", [runId]);
        if (run.supervision_mode === "supervised") return snapshot(client,run);
        return { run: ended, reservation_active: false };
      });
    },
  };
  return assertAgentSupervisedExecutionStore(Object.fromEntries(Object.entries(store).map(([name, operation]) => [name, async (...args) => {
    try { return await operation(...args); } catch (error) { throw mapError(error); }
  }])));
}
