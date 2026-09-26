import { randomUUID } from "node:crypto";
import {
  assertAgentExecutionContract, fingerprintAgentExecutionValue, fingerprintTaskContract,
  normalizeAgentExecutionPlan, validateAgentExecutionBindings,
} from "../../core/agents/agent-execution-contracts.mjs";
import {
  AGENT_EXECUTION_LEASE_MS, AGENT_EXECUTION_TABLES, assertAgentExecutionStore,
} from "../../core/ports/agent-execution-store-port.mjs";
import { lockExecutionPlanning, lockExecutionScope } from "./agent-execution-fence.mjs";

const ACTIVE = new Set(["launch_intended", "running"]);
const RUN_ACTIVE = new Set(["planned", "running"]);
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
  };
}

// This adapter has no default activation or termination authority. Injected
// verifiers are supervisor-owned dependencies, not data supplied by workers.
export function createPostgresAgentExecutionStore({
  connectionString, clientFactory = null, moduleLoader = null,
  verifyActivation = null, verifyTermination = null,
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
        client = new Client({ connectionString });
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
    const ready = missing.length === 0 && shared === 3 && runtime === 3;
    return { ok: ready, ready, shared_schema_version: shared, runtime_schema_version: runtime, missing_tables: missing };
  }

  async function transaction(operation, readOnly = false) {
    return withClient(async client => {
      await client.query(readOnly ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      try {
        if (!(await readiness(client)).ready) throw failure("SCHEMA_NOT_READY");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        // Expiry and revocation fence ownership durably even though the caller's
        // requested mutation is refused. Ordinary validation errors roll back.
        await client.query(committedFailures.has(error) ? "COMMIT" : "ROLLBACK");
        throw error;
      }
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
    row.run_json = run;
    return run;
  }

  async function recovery(client, run, reason) {
    await updateRunStatus(client, run, "recovery_required");
    await client.query("UPDATE aidn_shared.execution_runs SET recovery_reason=$2 WHERE run_id=$1", [run.run_id,reason]);
    await client.query(`UPDATE aidn_shared.execution_attempts
      SET attempt_json=jsonb_set(attempt_json,'{lifecycle_status}','"recovery_required"'::jsonb),
          generation=generation+1, lease_until=clock_timestamp(), updated_at=clock_timestamp()
      WHERE run_id=$1 AND attempt_json->>'lifecycle_status' IN ('launch_intended','running')`, [run.run_id]);
    throw failure(reason, true);
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

  async function snapshot(client, run) {
    const tasks = await client.query("SELECT task_json FROM aidn_shared.execution_tasks WHERE run_id=$1 ORDER BY task_id", [run.run_id]);
    const attempts = await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 ORDER BY task_id,ordinal", [run.run_id]);
    const events = await client.query("SELECT event_json FROM aidn_shared.execution_events WHERE attempt_id IN (SELECT attempt_id FROM aidn_shared.execution_attempts WHERE run_id=$1) ORDER BY attempt_id,sequence", [run.run_id]);
    return { run: json(run, "run_json"), plan: json(run, "plan_json"), tasks: tasks.rows.map(row => json(row, "task_json")),
      attempts: attempts.rows.map(attemptView), events: events.rows.map(row => json(row, "event_json")),
      canonical_snapshot_sha256: run.canonical_snapshot_sha256, reservation_active: run.reservation_active,
      recovery_reason: run.recovery_reason ?? null };
  }

  const store = {
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
    async claimAttempt({ runId, taskId, ownerId, attemptId, inputSha, worktree, expectedPreviousAttemptId = null }) {
      [runId,taskId,ownerId,attemptId].forEach(requireId);
      if (expectedPreviousAttemptId !== null) requireId(expectedPreviousAttemptId);
      return transaction(async client => {
        const run = await lockedRun(client, runId);
        if (!run.reservation_active || !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
        const plan = await canonical(client, run);
        const taskRows = await client.query("SELECT * FROM aidn_shared.execution_tasks WHERE run_id=$1 AND task_id=$2 FOR UPDATE", [runId,taskId]);
        if (!taskRows.rows.length) throw failure("TASK_NOT_FOUND");
        const taskRow = taskRows.rows[0], task = json(taskRow,"task_json");
        if (task.depends_on.length) throw failure("DEPENDENCY_PROOF_REQUIRED");
        if (inputSha !== plan.base.sha) throw failure("INPUT_SHA_MISMATCH");
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
        await client.query("UPDATE aidn_shared.execution_tasks SET next_ordinal=$3 WHERE run_id=$1 AND task_id=$2", [runId,taskId,ordinal]);
        await updateRunStatus(client, run, "running");
        return attemptView(inserted.rows[0]);
      });
    },
    async recordLaunchIntent({ attemptId, ownership, request }) {
      contract("request", request);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
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
    async observeRunner({ attemptId, ownership, runner }) {
      const observed = boundedJson(runner);
      if (!observed || Object.keys(observed).sort().join(",") !== "host_id,pid,runner_id,started_at"
        || !ID.test(observed.runner_id ?? "") || !ID.test(observed.host_id ?? "")
        || !Number.isSafeInteger(observed.pid) || observed.pid < 1
        || typeof observed.started_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(observed.started_at)
        || !Number.isFinite(Date.parse(observed.started_at))) throw failure("RUNNER_INVALID");
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        const attempt = await live(client, run, row, ownership);
        if (!row.request_json) throw failure("LAUNCH_INTENT_REQUIRED");
        if (row.runner_json && !same(json(row,"runner_json"),observed)) throw failure("RUNNER_CONFLICT");
        const running = { ...attempt, lifecycle_status: "running" };
        if (!row.runner_json) {
          const changed = await client.query("UPDATE aidn_shared.execution_attempts SET runner_json=$2::jsonb, attempt_json=$3::jsonb, updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING attempt_id", [attemptId,JSON.stringify(observed),JSON.stringify(running)]);
          if (!changed.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        }
        return { ...attemptView(row), attempt: running, runner: observed };
      });
    },
    async renewAttempt({ attemptId, ownership }) {
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await live(client, run, row, ownership);
        const renewed = await client.query("UPDATE aidn_shared.execution_attempts SET lease_until=clock_timestamp()+($2::bigint*interval '1 millisecond'), updated_at=clock_timestamp() WHERE attempt_id=$1 AND lease_until>clock_timestamp() RETURNING *", [attemptId,AGENT_EXECUTION_LEASE_MS]);
        if (!renewed.rows.length) return recovery(client,run,"LEASE_EXPIRED");
        return attemptView(renewed.rows[0]);
      });
    },
    async appendEvent({ attemptId, ownership, event }) {
      contract("event", event);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
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
    async recordResult({ attemptId, ownership, result, terminationProof }) {
      contract("result", result);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        const attempt = await live(client, run, row, ownership, { allowTerminal: Boolean(row.result_json) });
        if (!row.request_json) throw failure("LAUNCH_INTENT_REQUIRED");
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
    async expireAttempts({ runId }) {
      return transaction(async client => {
        const run = await lockedRun(client, runId);
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
    async invalidateRun({ runId, reason }) {
      if (typeof reason !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(reason)) throw failure("REASON_INVALID");
      return transaction(async client => {
        const run = await lockedRun(client, runId);
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
    async reconcileAttempt({ attemptId, proof }) {
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
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
        if (!unresolved.rows.length) {
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
    async finishRun({ runId, outcome }) {
      if (!["failed","cancelled"].includes(outcome)) throw failure("ACCEPTANCE_REQUIRED");
      return transaction(async client => {
        const run = await lockedRun(client, runId);
        if (!run.reservation_active) {
          if (json(run,"run_json").lifecycle_status !== outcome) throw failure("RUN_TERMINAL_CONFLICT");
          return { run: json(run,"run_json"), reservation_active: false };
        }
        const attempts = await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 FOR UPDATE", [runId]);
        if (attempts.rows.some(row => ACTIVE.has(json(row,"attempt_json").lifecycle_status)
          || json(row,"attempt_json").lifecycle_status === "recovery_required"
          || (!row.termination_json && !row.reconciliation_json))) throw failure("RECOVERY_REQUIRED");
        const ended = await updateRunStatus(client,run,outcome);
        await client.query("UPDATE aidn_shared.execution_runs SET reservation_active=false,updated_at=clock_timestamp() WHERE run_id=$1", [runId]);
        return { run: ended, reservation_active: false };
      });
    },
  };
  return assertAgentExecutionStore(Object.fromEntries(Object.entries(store).map(([name, operation]) => [name, async (...args) => {
    try { return await operation(...args); } catch (error) { throw mapError(error); }
  }])));
}
