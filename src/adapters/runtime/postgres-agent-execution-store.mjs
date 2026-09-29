import { randomUUID } from "node:crypto";
import {
  assertAgentExecutionContract, fingerprintAgentExecutionValue, fingerprintTaskContract,
  normalizeAgentExecutionPlan, validateAgentExecutionBindings, isExactExecutionPath, validateAgentRunValidationBindings,
  validateAgentIntegrationIntentBindings, isAbsoluteExecutionCwd, isAgentExecutionRuntimeScopeId,
} from "../../core/agents/agent-execution-contracts.mjs";
import {
  AGENT_EXECUTION_LEASE_MS, AGENT_EXECUTION_TABLES, assertAgentRunLifecycleStore,
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
function exactKeys(value,keys) {
  return value && typeof value==="object" && !Array.isArray(value) && Object.keys(value).sort().join(",")===keys.split(",").sort().join(",");
}
function validEvidence(value) {
  return exactKeys(value,"ref,sha256,bytes") && isExactExecutionPath(value.ref)
    && HASH.test(value.sha256 ?? "") && Number.isSafeInteger(value.bytes) && value.bytes>=0;
}
function validRunner(value) {
  return exactKeys(value,"host_id,runner_id,pid,started_at") && ID.test(value.host_id ?? "") && ID.test(value.runner_id ?? "")
    && Number.isSafeInteger(value.pid) && value.pid>0 && typeof value.started_at==="string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.started_at) && Number.isFinite(Date.parse(value.started_at));
}
function cleanupDocument(input) {
  const value=boundedJson(input);
  if (!exactKeys(value,"contract_version,cleanup_id,run_id,plan_sha256,repository_identity_sha256,integration_ref,integrated_sha,resources")
    || value.contract_version!=="agent-cleanup-intent.v1" || !ID.test(value.cleanup_id ?? "") || !ID.test(value.run_id ?? "")
    || !HASH.test(value.plan_sha256 ?? "") || !HASH.test(value.repository_identity_sha256 ?? "")
    || !Array.isArray(value.resources) || !value.resources.length || value.resources.length>64) throw failure("CLEANUP_CONTRACT_INVALID");
  const identities=new Set(), paths=new Set();
  for (const resource of value.resources) {
    const verification=resource?.kind==="verification_worktree";
    if (!exactKeys(resource,"resource_id,kind,attempt_id,integration_id,cwd,preimage_sha256,retention"+(verification ? ",snapshot_sha256" : ""))
      || !ID.test(resource.resource_id ?? "") || !["attempt_worktree","integration_worktree","verification_worktree"].includes(resource.kind)
      || !isAbsoluteExecutionCwd(resource.cwd) || !HASH.test(resource.preimage_sha256 ?? "") || !validEvidence(resource.retention)
      || (verification ? (resource.attempt_id!==null || resource.integration_id!==null || !HASH.test(resource.snapshot_sha256 ?? ""))
        : resource.kind==="attempt_worktree" ? (!ID.test(resource.attempt_id ?? "") || resource.integration_id!==null)
        : (!ID.test(resource.integration_id ?? "") || resource.attempt_id!==null))) throw failure("CLEANUP_RESOURCE_INVALID");
    const physical=resource.cwd.replaceAll("\\","/").toLowerCase();
    if (identities.has(resource.resource_id) || paths.has(physical)) throw failure("CLEANUP_RESOURCE_DUPLICATE");
    identities.add(resource.resource_id); paths.add(physical);
  }
  return value;
}
function cleanupView(row) {
  return row ? {cleanup:json(row,"cleanup_json"),cleanup_sha256:row.cleanup_sha256,ownership:json(row,"ownership_json"),
    runner:json(row,"runner_json"),status:row.status,lease_until:row.lease_until,lease_live:row.lease_live,
    termination:json(row,"termination_json")} : null;
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
  const reconciliation = json(row, "reconciliation_json");
  const notStarted = typeof reconciliation?.contract_version === "string" && reconciliation.contract_version.startsWith("agent-attempt-reconciliation.");
  if (notStarted && (reconciliation.contract_version !== "agent-attempt-reconciliation.v1"
    || reconciliation.termination_state !== "not_started" || Object.keys(reconciliation).sort().join(",") !== "contract_version,proof,termination_state"
    || !reconciliation.proof || typeof reconciliation.proof !== "object" || Array.isArray(reconciliation.proof))) throw failure("RECONCILIATION_INVALID");
  return {
    attempt: json(row, "attempt_json"), delegation: json(row, "delegation_json"),
    request: json(row, "request_json"), runner: json(row, "runner_json"),
    result: json(row, "result_json"), termination: json(row, "termination_json"),
    reconciliation: notStarted ? reconciliation.proof : reconciliation,
    reconciliation_termination_state: reconciliation ? (notStarted ? "not_started" : "confirmed") : null, lease_until: row.lease_until,
    preparation: json(row,"preparation_json"), dependency_binding: json(row,"dependency_binding_json"),
  };
}

// This adapter has no default activation or termination authority. Injected
// verifiers are supervisor-owned dependencies, not data supplied by workers.
export function createPostgresAgentExecutionStore({
  connectionString, clientFactory = null, moduleLoader = null,
  verifyActivation = null, verifyTermination = null, verifySupervisorTermination = null, inspectIntegration = null,
  validationEvidenceVerifier = null, inspectCleanup = null, verifyCleanupTermination = null,
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
    const ready = missing.length === 0 && shared === 6 && runtime === 3;
    return { ok: ready, ready, shared_schema_version: shared, runtime_schema_version: runtime, missing_tables: missing };
  }

  const transactionFences = new WeakMap();
  const cleanupFences = new WeakMap();
  const cleanupHeadFences = new WeakMap();
  async function transaction(operation, readOnly = false) {
    return withClient(async client => {
      await client.query(readOnly ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      transactionFences.set(client,new Map());
      cleanupFences.set(client,new Map());
      cleanupHeadFences.set(client,new Map());
      try {
        // A peer may hold the canonical fence through one bounded 4500ms
        // verifier; allow 500ms scheduling margin while the caller's 10s
        // coordination deadline and the 60s ownership lease remain unchanged.
        await client.query("SET LOCAL lock_timeout = '5000ms'");
        await client.query("SET LOCAL statement_timeout = '9000ms'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
        if (!(await readiness(client)).ready) throw failure("SCHEMA_NOT_READY");
        const result = await operation(client);
        // Recheck PostgreSQL time after every external callback and write, before
        // commit. A late fence failure rolls back the entire requested mutation.
        for (const fence of transactionFences.get(client).values()) {
          await supervisorGuard(client,fence.run,fence.ownership,{deadline:fence.deadline,final:true});
        }
        for (const fence of cleanupFences.get(client).values()) {
          const gitFence=cleanupHeadFences.get(client).get(fence.run.run_id);
          // External cleanup observations may have yielded while the Git ref
          // moved. Recheck it after those observations, then PostgreSQL time
          // and ownership after the last external await, before committing.
          if(gitFence)await inspectGit(fence.run,gitFence.supervisor,headInspection(gitFence.head),"head",[gitFence.head.sha]);
          await cleanupGuard(client,fence.run,fence.cleanupId,fence.ownership,true);
        }
        await client.query("COMMIT");
        return result;
      } catch (error) {
        // Expiry and revocation fence ownership durably even though the caller's
        // requested mutation is refused. Ordinary validation errors roll back.
        await client.query(committedFailures.has(error) ? "COMMIT" : "ROLLBACK");
        throw error;
      } finally { transactionFences.delete(client); cleanupFences.delete(client); cleanupHeadFences.delete(client); }
    });
  }

  async function digest(client, scopeKey) {
    if (!isAgentExecutionRuntimeScopeId(scopeKey)) throw failure("IDENTITY_INVALID");
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

  async function canonical(client, row, invalidate = true, {readOnly=false}={}) {
    const plan = json(row, "plan_json"), currentRun = json(row, "run_json");
    const fail = async code => { if (invalidate) return recovery(client, row, code); throw failure(code); };
    const planning = await client.query("SELECT revision,backlog_artifact_ref,backlog_artifact_sha256,session_id FROM aidn_shared.planning_states WHERE project_id=$1 AND workspace_id=$2 AND planning_key=$3"+(readOnly ? "" : " FOR UPDATE"), [row.project_id, row.workspace_id, row.planning_key]);
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
  async function verifyValidationEvidence(run, document, phase, attemptRow=null) {
    const plan=json(run,"plan_json");
    if (!plan.verification) return null;
    if (!validationEvidenceVerifier || typeof validationEvidenceVerifier.getDescriptor!=="function"
      || typeof validationEvidenceVerifier.verify!=="function") throw failure("VALIDATION_EVIDENCE_VERIFIER_REQUIRED");
    const subject=fingerprintAgentExecutionValue(document), testedSha=phase==="task" ? document.candidate_sha : document.integrated_sha;
    const task=phase==="task" ? plan.tasks.find(item=>item.task_id===document.task_id) : null;
    const checks=phase==="task" ? document.validation.checks : [...document.checks,...document.audit.checks];
    const refs=[...new Map(checks.map(check=>[check.evidence.ref,check.evidence])).values()].sort((a,b)=>a.ref.localeCompare(b.ref,"en"));
    if (checks.some(check=>!same(check.evidence,refs.find(ref=>ref.ref===check.evidence.ref)))) throw failure("VALIDATION_EVIDENCE_INVALID");
    let observed;
    try {
      observed=boundedJson(await boundedVerification(signal=>{
        const descriptor=validationEvidenceVerifier.getDescriptor();
        if (!same(descriptor,{verifier_id:"local-agent-verification",contract_version:"agent-evidence-verification.v1",algorithm:"Ed25519"})) throw failure("VALIDATION_EVIDENCE_VERIFIER_INVALID");
        return validationEvidenceVerifier.verify(copy({
          phase,plan,run:json(run,"run_json"),document,subject_sha256:subject,
          ...(task ? {task,attempt:json(attemptRow,"attempt_json"),result:json(attemptRow,"result_json")} : {}),
          expected:{tested_sha:testedSha,validation_ids:task?.validation_ids ?? plan.validations.map(item=>item.validation_id),
            ...(phase==="run" ? {audit_criteria:plan.audit.criteria} : {})},
        }),{signal});
      },"VALIDATION_EVIDENCE_TIMED_OUT"));
    } catch (error) {
      if (knownFailures.has(error)) throw error;
      throw failure("VALIDATION_EVIDENCE_INVALID");
    }
    const keys="contract_version,phase,plan_sha256,policy_sha256,proof_authority_sha256,run_id,snapshots,subject_sha256,tested_sha,verified_refs,verifier_id";
    if (!observed || Object.keys(observed).sort().join(",")!==keys
      || observed.contract_version!=="agent-evidence-verification.v1" || observed.verifier_id!=="local-agent-verification"
      || observed.phase!==phase || observed.run_id!==run.run_id || observed.plan_sha256!==run.plan_sha256
      || observed.policy_sha256!==fingerprintAgentExecutionValue(plan.verification) || observed.subject_sha256!==subject
      || observed.tested_sha!==testedSha || observed.proof_authority_sha256!==plan.verification.proof_authority_sha256
      || !same(observed.verified_refs,refs) || !Array.isArray(observed.snapshots)) throw failure("VALIDATION_EVIDENCE_BINDING_INVALID");
    const phases=phase==="task" ? ["task"] : ["audit","run"], snapshots=observed.snapshots;
    if (!same(snapshots.map(item=>item?.phase ?? null),phases) || snapshots.some(item=>
      Object.keys(item).sort().join(",")!=="after_sha256,before_sha256,candidate_sha,phase,repository_identity_sha256,snapshot_sha256,tree_sha"
      || item.candidate_sha!==testedSha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.tree_sha ?? "")
      || ["after_sha256","before_sha256","repository_identity_sha256","snapshot_sha256"].some(key=>!HASH.test(item[key] ?? "")))
      || snapshots.some(item=>["snapshot_sha256","tree_sha","repository_identity_sha256"].some(key=>item[key]!==snapshots[0][key]))) throw failure("VALIDATION_EVIDENCE_BINDING_INVALID");
    const head=json(run,"integration_head_json");
    if (head && snapshots.some(item=>item.repository_identity_sha256!==head.repository_identity_sha256)) throw failure("VALIDATION_EVIDENCE_BINDING_INVALID");
    return observed;
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
  async function intentRows(client, runId) {
    return (await client.query("SELECT * FROM aidn_shared.execution_integration_intents WHERE run_id=$1 ORDER BY sequence",[runId])).rows;
  }
  function intentView(row, integrations = []) {
    const prepared=integrations.find(item=>item.integration_id===row.integration_id);
    return {intent:json(row,"intent_json"),intent_sha256:row.intent_sha256,
      status:row.applied_at ? "applied" : prepared ? "prepared" : "reserved",
      prepared_sha256:prepared?.prepared_sha256 ?? null,applied_sha256:prepared?.applied_sha256 ?? null};
  }
  async function pendingIntegrations(client, runId) {
    const integrations=await integrationRows(client,runId), intents=await intentRows(client,runId);
    return [...intents.filter(row=>!row.applied_at).map(row=>intentView(row,integrations)),
      ...integrations.filter(row=>!row.applied_json && !row.intent_sha256).map(integrationView)];
  }
  async function requireStoppedProducer(client, run, producer, current, {mustBePrevious=false}={}) {
    if (same(producer,current)) {
      if (mustBePrevious) throw failure("SUPERVISOR_RECONCILIATION_REQUIRED");
      return;
    }
    const row=(await client.query("SELECT supervisor_json,termination_json FROM aidn_shared.execution_supervisors WHERE run_id=$1 AND generation=$2",[run.run_id,producer.generation])).rows[0];
    if (!row?.termination_json || !same(json(row,"supervisor_json").ownership,producer)
      || producer.generation>=current.generation) throw failure("SUPERVISOR_RECONCILIATION_REQUIRED");
  }
  async function requireIntegrationOrder(client, run, taskId, rows) {
    const plan=json(run,"plan_json"), order=taskOrder(plan), earlier=order.slice(0,order.indexOf(taskId));
    const attempts=(await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 ORDER BY ordinal",[run.run_id])).rows;
    const acceptances=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE run_id=$1",[run.run_id])).rows;
    const failed = id => {
      const last=attempts.filter(row=>row.task_id===id).at(-1), accepted=acceptances.find(row=>row.task_id===id);
      if (accepted && json(accepted,"acceptance_json").decision==="rejected") return true;
      if (last && ["failed","cancelled","timed_out"].includes(json(last,"attempt_json").lifecycle_status)) return true;
      return plan.tasks.find(task=>task.task_id===id).depends_on.some(failed);
    };
    if (earlier.some(id=>!rows.some(row=>row.applied_json && json(row,"prepared_json").task_id===id) && !failed(id))) throw failure("INTEGRATION_ORDER_INVALID");
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
    if (rows.length !== plan.tasks.length || rows.some(row => !row.applied_json) || (await pendingIntegrations(client,run.run_id)).length) throw failure("REQUIRED_TASKS_NOT_INTEGRATED");
    if (new Set(rows.map(row => json(row,"prepared_json").task_id)).size !== plan.tasks.length) throw failure("REQUIRED_TASKS_NOT_INTEGRATED");
    return head;
  }

  async function cancelRow(client,runId) {
    return (await client.query("SELECT * FROM aidn_shared.execution_cancel_requests WHERE run_id=$1",[runId])).rows[0] ?? null;
  }
  async function noCancellation(client,run) {
    if (await cancelRow(client,run.run_id)) throw failure("CANCEL_REQUESTED");
  }
  async function cleanupRows(client,runId) {
    return (await client.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM aidn_shared.execution_cleanup_operations WHERE run_id=$1 ORDER BY generation",[runId])).rows;
  }
  async function cleanupResources(client,runId,cleanupId) {
    return (await client.query("SELECT * FROM aidn_shared.execution_cleanup_resources WHERE run_id=$1 AND cleanup_id=$2 ORDER BY resource_id",[runId,cleanupId])).rows;
  }
  async function cleanupGuard(client,run,cleanupId,ownership,final=false) {
    const rows=await cleanupRows(client,run.run_id), current=rows.at(-1);
    if (!current || current.cleanup_id!==cleanupId || !same(json(current,"ownership_json"),ownership)) throw failure("CLEANUP_OWNERSHIP_LOST");
    if (!current.lease_live) throw failure("CLEANUP_LEASE_EXPIRED");
    if (current.status!=="active" && !(final && current.status==="completed")) throw failure("CLEANUP_NOT_ACTIVE");
    if (!final) cleanupFences.get(client).set(run.run_id,{run,cleanupId,ownership:copy(ownership)});
    return current;
  }
  async function cleanupEligibility(client,run,cleanup,{inspectHead=false}={}) {
    if (run.reservation_active || json(run,"run_json").lifecycle_status!=="completed") throw failure("CLEANUP_RUN_NOT_COMPLETED");
    if (cleanup.run_id!==run.run_id || cleanup.plan_sha256!==run.plan_sha256) throw failure("CLEANUP_BINDING_INVALID");
    const head=await requireAllIntegrated(client,run);
    if (cleanup.repository_identity_sha256!==head.repository_identity_sha256 || cleanup.integration_ref!==head.ref
      || cleanup.integrated_sha!==head.sha) throw failure("CLEANUP_BINDING_INVALID");
    const supervisors=(await client.query("SELECT * FROM aidn_shared.execution_supervisors WHERE run_id=$1 ORDER BY generation",[run.run_id])).rows;
    if (!supervisors.length || supervisors.some(row=>json(row,"supervisor_json").status!=="stopped" || !row.termination_json)) throw failure("CLEANUP_SUPERVISOR_NOT_STOPPED");
    const attempts=(await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1",[run.run_id])).rows;
    if (attempts.some(row=>ACTIVE.has(json(row,"attempt_json").lifecycle_status)
      || json(row,"attempt_json").lifecycle_status==="recovery_required" || (!row.termination_json && !row.reconciliation_json))) throw failure("CLEANUP_TERMINATION_UNCONFIRMED");
    const integrations=await integrationRows(client,run.run_id), intents=await intentRows(client,run.run_id);
    const acceptances=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE run_id=$1",[run.run_id])).rows;
    const final=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[run.run_id])).rows[0];
    for (const resource of cleanup.resources) {
      if(resource.kind==="verification_worktree"){
        const observations=[...acceptances.map(row=>({observation:json(row,"evidence_verification_json"),sha:json(row,"acceptance_json")?.candidate_sha})),
          {observation:json(final,"evidence_verification_json"),sha:json(final,"validation_json")?.integrated_sha}];
        const matches=observations.flatMap(({observation,sha})=>(observation?.snapshots ?? []).filter(item=>
          item.snapshot_sha256===resource.snapshot_sha256 && item.candidate_sha===sha && item.repository_identity_sha256===head.repository_identity_sha256));
        if(!matches.length || matches.some(item=>["candidate_sha","tree_sha","repository_identity_sha256"].some(key=>item[key]!==matches[0][key])))throw failure("CLEANUP_RESOURCE_UNSAFE");
        continue;
      }
      const intent=resource.kind==="integration_worktree" ? intents.find(row=>row.integration_id===resource.integration_id) : null;
      const attemptId=resource.attempt_id ?? intent?.attempt_id;
      const attempt=attempts.find(row=>row.attempt_id===attemptId), accepted=acceptances.find(row=>row.attempt_id===attemptId);
      const integrated=integrations.find(row=>row.attempt_id===attemptId && row.applied_json);
      const expectedCwd=resource.kind==="attempt_worktree" ? json(attempt,"attempt_json")?.worktree.cwd : json(intent,"intent_json")?.workspace.cwd;
      if (!attempt || !accepted || !integrated || json(attempt,"result_json")?.outcome!=="completed" || !attempt.termination_json
        || json(accepted,"acceptance_json")?.decision!=="accepted" || resource.cwd!==expectedCwd
        || (resource.kind==="integration_worktree" && (integrated.integration_id!==resource.integration_id || !intent?.applied_at))) throw failure("CLEANUP_RESOURCE_UNSAFE");
    }
    if(inspectHead){
      const supervisor=json(supervisors.at(-1),"supervisor_json").ownership;
      await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
      cleanupHeadFences.get(client).set(run.run_id,{head:copy(head),supervisor:copy(supervisor)});
    }
  }
  async function cleanupInspection(client,run,cleanup,resource,phase) {
    if (typeof inspectCleanup!=="function") throw failure("CLEANUP_INSPECTOR_REQUIRED");
    let observed;
    try {
      const state=await snapshot(client,run);
      observed=boundedJson(await boundedVerification(signal=>inspectCleanup(copy(resource),{
        phase,run:json(run,"run_json"),snapshot:state,cleanup:copy(cleanup),signal,
      }),"CLEANUP_INSPECTION_TIMED_OUT"));
    } catch(error) { if(knownFailures.has(error))throw error;throw failure("CLEANUP_INSPECTION_FAILED"); }
    if (!exactKeys(observed,"resource_id,cwd,preimage_sha256,repository_identity_sha256,retention,exists,registered,clean,retained,processes_stopped,links_safe")
      || ["resource_id","cwd","preimage_sha256"].some(key=>observed[key]!==resource[key])
      || observed.repository_identity_sha256!==cleanup.repository_identity_sha256 || !same(observed.retention,resource.retention)
      || ["clean","retained","processes_stopped","links_safe"].some(key=>observed[key]!==true)
      || observed.exists!==(phase==="before") || observed.registered!==(phase==="before")) throw failure("CLEANUP_INSPECTION_INVALID");
    return observed;
  }

  async function snapshot(client, run) {
    run=(await client.query("SELECT *,clock_timestamp() AS server_now FROM aidn_shared.execution_runs WHERE run_id=$1",[run.run_id])).rows[0];
    const supervisors=(await client.query("SELECT *,lease_until>clock_timestamp() AS lease_live FROM aidn_shared.execution_supervisors WHERE run_id=$1 ORDER BY generation",[run.run_id])).rows;
    const acceptances=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE run_id=$1 ORDER BY task_id,attempt_id",[run.run_id])).rows;
    const integrations=await integrationRows(client,run.run_id), intents=await intentRows(client,run.run_id);
    const final=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[run.run_id])).rows[0];
    const cancellation=await cancelRow(client,run.run_id), cleaners=await cleanupRows(client,run.run_id), cleaner=cleaners.at(-1);
    const resources=cleaner ? await cleanupResources(client,run.run_id,cleaner.cleanup_id) : [];

    const tasks = await client.query("SELECT task_json FROM aidn_shared.execution_tasks WHERE run_id=$1 ORDER BY task_id", [run.run_id]);
    const attempts = await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 ORDER BY task_id,ordinal", [run.run_id]);
    const events = await client.query("SELECT event_json FROM aidn_shared.execution_events WHERE attempt_id IN (SELECT attempt_id FROM aidn_shared.execution_attempts WHERE run_id=$1) ORDER BY attempt_id,sequence", [run.run_id]);
    return { run: json(run, "run_json"), plan: json(run, "plan_json"), tasks: tasks.rows.map(row => json(row, "task_json")),
      attempts: attempts.rows.map(attemptView), events: events.rows.map(row => json(row, "event_json")),
      canonical_snapshot_sha256: run.canonical_snapshot_sha256, reservation_active: run.reservation_active,
      recovery_reason: run.recovery_reason ?? null,
      cancel_request:cancellation ? {request:json(cancellation,"request_json"),request_sha256:cancellation.request_sha256,
        target_supervisor_generation:Number(cancellation.target_supervisor_generation),accepted_control_revision:Number(cancellation.accepted_control_revision)} : null,
      cleanup:cleaner ? {current:cleanupView(cleaner),history:cleaners.slice(0,-1).map(cleanupView),resources:resources.map(row=>({
        resource:json(row,"resource_json"),resource_sha256:row.resource_sha256,result:json(row,"result_json"),result_sha256:row.result_sha256 ?? null}))} : null,
      server_now:run.server_now,run_started_at:run.run_started_at,run_deadline_at:run.run_deadline_at,
      supervision:{mode:run.supervision_mode,control_revision:Number(run.control_revision),current:supervisorView(supervisors.at(-1)),history:supervisors.slice(0,-1).map(supervisorView)},
      acceptances:acceptances.map(row=>({acceptance:json(row,"acceptance_json"),acceptance_sha256:row.acceptance_sha256,
        evidence_verification:json(row,"evidence_verification_json"),evidence_verification_sha256:row.evidence_verification_sha256 ?? null})),
      integration_intents:intents.map(row=>intentView(row,integrations)),
      integrations:integrations.map(integrationView),integration_head:json(run,"integration_head_json"),
      final_validation:final ? {validation:json(final,"validation_json"),validation_sha256:final.validation_sha256,
        evidence_verification:json(final,"evidence_verification_json"),evidence_verification_sha256:final.evidence_verification_sha256 ?? null} : null };
  }

  const store = {

    async previewRunReservation({plan:input,runId,planningKey,canonicalSnapshotSha256}) {
      requireId(runId);requireId(planningKey);requireHash(canonicalSnapshotSha256);
      let plan;try {plan=normalizeAgentExecutionPlan(input);} catch {throw failure("CONTRACT_INVALID");}
      const run=contract("run",{contract_version:"agent-execution-run.v1",run_id:runId,plan_id:plan.plan_id,plan_sha256:plan.plan_sha256,
        authority_backend:"postgres",canonical:copy(plan.canonical),task_ids:plan.tasks.map(task=>task.task_id),lifecycle_status:"planned"});
      return transaction(async client=>{
        const row={run_id:runId,project_id:plan.canonical.project_id,workspace_id:plan.canonical.workspace_id,
          runtime_scope_id:plan.canonical.runtime_scope_id,planning_key:planningKey,planning_revision:plan.canonical.planning_revision,
          canonical_snapshot_sha256:canonicalSnapshotSha256,plan_json:plan,run_json:run};
        await canonical(client,row,false,{readOnly:true});
        const existing=await client.query("SELECT run_id FROM aidn_shared.execution_runs WHERE run_id=$1 OR (reservation_active AND (runtime_scope_id=$2 OR (project_id=$3 AND workspace_id=$4 AND planning_key=$5))) LIMIT 1",
          [runId,row.runtime_scope_id,row.project_id,row.workspace_id,planningKey]);
        if(existing.rows.length)throw failure("RESERVATION_CONFLICT");
        return {ok:true,run_id:runId,plan_sha256:plan.plan_sha256,canonical_snapshot_sha256:canonicalSnapshotSha256,
          planning_revision:plan.canonical.planning_revision,reservation_available:true};
      },true);
    },
    async requestCancel({runId,expectedControlRevision,expectedSupervisorGeneration,request}) {
      request=boundedJson(request);
      if(!exactKeys(request,"contract_version,request_id,run_id,plan_sha256,reason") || request.contract_version!=="agent-cancel-request.v1"
        || !ID.test(request.request_id ?? "") || !ID.test(request.reason ?? "") || request.run_id!==runId || !HASH.test(request.plan_sha256 ?? "")
        || !Number.isSafeInteger(expectedSupervisorGeneration) || expectedSupervisorGeneration<0)throw failure("CANCEL_CONTRACT_INVALID");
      const hash=fingerprintAgentExecutionValue({request,target_supervisor_generation:expectedSupervisorGeneration});
      return transaction(async client=>{
        const run=await lockedRun(client,runId), existing=await cancelRow(client,runId);
        if(request.plan_sha256!==run.plan_sha256)throw failure("CANCEL_BINDING_INVALID");
        if(existing){
          if(existing.request_sha256!==hash || !same(json(existing,"request_json"),request))throw failure("CANCEL_REQUEST_CONFLICT");
          return snapshot(client,run);
        }
        revision(run,expectedControlRevision);
        if(Number(run.supervisor_generation)!==expectedSupervisorGeneration)throw failure("SUPERVISOR_OWNERSHIP_LOST");
        if(!run.reservation_active)throw failure("RUN_NOT_ACTIVE");
        await client.query("INSERT INTO aidn_shared.execution_cancel_requests(run_id,request_id,request_sha256,request_json,target_supervisor_generation,accepted_control_revision) VALUES($1,$2,$3,$4::jsonb,$5,$6)",
          [runId,request.request_id,hash,JSON.stringify(request),expectedSupervisorGeneration,expectedControlRevision]);
        await bump(client,run);
        return snapshot(client,run);
      });
    },
    async recordSupervisorStopped({runId,expectedSupervisor,expectedControlRevision,proof}) {
      expectedSupervisor=copy(expectedSupervisor);proof=boundedJson(proof);
      if(typeof verifySupervisorTermination!=="function")throw failure("SUPERVISOR_TERMINATION_VERIFIER_REQUIRED");
      return transaction(async client=>{
        const run=await lockedRun(client,runId);revision(run,expectedControlRevision);
        if(run.reservation_active || !["completed","failed","cancelled"].includes(json(run,"run_json").lifecycle_status))throw failure("RUN_NOT_TERMINAL");
        const row=await currentSupervisor(client,run), supervisor=json(row,"supervisor_json");
        if(!supervisor || !same(supervisor.ownership,expectedSupervisor))throw failure("SUPERVISOR_OWNERSHIP_LOST");
        if(row.termination_json){
          if(!same(json(row,"termination_json"),proof))throw failure("SUPERVISOR_TERMINATION_CONFLICT");
          return snapshot(client,run);
        }
        let observed;
        try {observed=await boundedVerification(signal=>verifySupervisorTermination(copy(supervisor),copy(proof),{
          run:json(run,"run_json"),pendingIntegrations:[],signal,
        }),"SUPERVISOR_TERMINATION_TIMED_OUT");}catch{throw failure("SUPERVISOR_TERMINATION_UNCONFIRMED");}
        if(!observed || ["ok","supervisor_stopped","descendants_stopped","git_operations_stopped"].some(key=>observed[key]!==true))throw failure("SUPERVISOR_TERMINATION_UNCONFIRMED");
        await client.query("UPDATE aidn_shared.execution_supervisors SET supervisor_json=jsonb_set(supervisor_json,'{status}','\"stopped\"'::jsonb),termination_json=$3::jsonb,lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=$1 AND generation=$2",
          [runId,expectedSupervisor.generation,JSON.stringify(proof)]);
        await bump(client,run);return snapshot(client,run);
      });
    },

    async beginCleanup({runId,expectedControlRevision,ownerId,runner,cleanup,expectedPreviousGeneration=null}) {
      cleanup=cleanupDocument(cleanup);runner=boundedJson(runner);requireId(ownerId);
      if(!validRunner(runner))throw failure("RUNNER_INVALID");
      if(typeof inspectCleanup!=="function")throw failure("CLEANUP_INSPECTOR_REQUIRED");
      if(typeof verifyCleanupTermination!=="function")throw failure("CLEANUP_TERMINATION_VERIFIER_REQUIRED");
      const hash=fingerprintAgentExecutionValue(cleanup);
      return transaction(async client=>{
        const run=await lockedRun(client,runId);revision(run,expectedControlRevision);await cleanupEligibility(client,run,cleanup,{inspectHead:true});
        const rows=await cleanupRows(client,runId), previous=rows.at(-1);
        if(previous){
          if(previous.cleanup_id!==cleanup.cleanup_id || previous.cleanup_sha256!==hash || !same(json(previous,"cleanup_json"),cleanup))throw failure("CLEANUP_INTENT_CONFLICT");
          const resources=await cleanupResources(client,runId,cleanup.cleanup_id);
          if(resources.length===cleanup.resources.length && resources.every(row=>row.result_json))return snapshot(client,run);
          if(expectedPreviousGeneration!==Number(previous.generation) || previous.status!=="stopped" || !previous.termination_json)throw failure("CLEANUP_RECONCILIATION_REQUIRED");
          if(json(previous,"runner_json").host_id!==runner.host_id)throw failure("CLEANUP_HOST_MISMATCH");
        } else {
          if(expectedPreviousGeneration!==null)throw failure("CLEANUP_PREDECESSOR_MISMATCH");
          for(const resource of cleanup.resources)await cleanupInspection(client,run,cleanup,resource,"before");
        }
        const generation=Number(previous?.generation ?? 0)+1;
        if(!Number.isSafeInteger(generation))throw failure("GENERATION_LIMIT");
        const ownership={owner_id:ownerId,generation,lease_id:randomUUID()};
        await client.query("INSERT INTO aidn_shared.execution_cleanup_operations(run_id,cleanup_id,generation,cleanup_sha256,cleanup_json,ownership_json,runner_json,lease_until,status) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,clock_timestamp()+interval '60 seconds','active')",
          [runId,cleanup.cleanup_id,generation,hash,JSON.stringify(cleanup),JSON.stringify(ownership),JSON.stringify(runner)]);
        if(!previous)for(const resource of cleanup.resources)await client.query("INSERT INTO aidn_shared.execution_cleanup_resources(run_id,cleanup_id,resource_id,creator_generation,resource_json,resource_sha256) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
          [runId,cleanup.cleanup_id,resource.resource_id,generation,JSON.stringify(resource),fingerprintAgentExecutionValue(resource)]);
        await bump(client,run);await cleanupGuard(client,run,cleanup.cleanup_id,ownership);
        return snapshot(client,run);
      });
    },
    async renewCleanup({runId,cleanupId,ownership}) {
      ownership=copy(ownership);
      return transaction(async client=>{
        const run=await lockedRun(client,runId), row=await cleanupGuard(client,run,cleanupId,ownership);
        await cleanupEligibility(client,run,json(row,"cleanup_json"));
        await client.query("UPDATE aidn_shared.execution_cleanup_operations SET lease_until=clock_timestamp()+interval '60 seconds' WHERE run_id=$1 AND cleanup_id=$2 AND generation=$3 AND lease_until>clock_timestamp()",
          [runId,cleanupId,ownership.generation]);
        return snapshot(client,run);
      });
    },
    async inspectCleanupAuthority({runId,cleanupId,ownership,resourceId,resourceSha256,reconciliation=false}) {
      ownership=copy(ownership);requireId(resourceId);requireHash(resourceSha256);
      if(typeof reconciliation!=="boolean")throw failure("CLEANUP_CONTRACT_INVALID");
      return transaction(async client=>{
        const run=await lockedRun(client,runId), row=await cleanupGuard(client,run,cleanupId,ownership), cleanup=json(row,"cleanup_json");
        await cleanupEligibility(client,run,cleanup,{inspectHead:true});
        const resource=(await cleanupResources(client,runId,cleanupId)).find(item=>item.resource_id===resourceId);
        if(!resource || resource.resource_sha256!==resourceSha256 || resource.result_json)throw failure("CLEANUP_RESOURCE_MISMATCH");
        await cleanupInspection(client,run,cleanup,json(resource,"resource_json"),reconciliation ? "after" : "before");
        return {cleanup_sha256:row.cleanup_sha256,resource_sha256:resourceSha256,control_revision:Number(run.control_revision),ownership:copy(ownership)};
      });
    },
    async recordCleanupResult({runId,cleanupId,ownership,resourceId,result}) {
      ownership=copy(ownership);result=boundedJson(result);requireId(resourceId);
      if(!exactKeys(result,"resource_id,preimage_sha256,outcome,evidence") || result.resource_id!==resourceId || result.outcome!=="removed"
        || !HASH.test(result.preimage_sha256 ?? "") || !Array.isArray(result.evidence) || !result.evidence.length || result.evidence.length>16
        || !result.evidence.every(validEvidence))throw failure("CLEANUP_RESULT_INVALID");
      const hash=fingerprintAgentExecutionValue(result);
      return transaction(async client=>{
        const run=await lockedRun(client,runId), resource=(await cleanupResources(client,runId,cleanupId)).find(item=>item.resource_id===resourceId);
        if(!resource || json(resource,"resource_json").preimage_sha256!==result.preimage_sha256)throw failure("CLEANUP_RESOURCE_MISMATCH");
        if(resource.result_json){
          if(resource.result_sha256!==hash || !same(json(resource,"result_json"),result))throw failure("CLEANUP_RESULT_CONFLICT");
          return snapshot(client,run);
        }
        const row=await cleanupGuard(client,run,cleanupId,ownership), cleanup=json(row,"cleanup_json");
        await cleanupEligibility(client,run,cleanup,{inspectHead:true});
        const spec=json(resource,"resource_json");
        if(!result.evidence.some(item=>same(item,spec.retention)))throw failure("CLEANUP_RETENTION_REQUIRED");
        await cleanupInspection(client,run,cleanup,spec,"after");
        await client.query("UPDATE aidn_shared.execution_cleanup_resources SET result_json=$4::jsonb,result_sha256=$5,result_generation=$6,completed_at=clock_timestamp() WHERE run_id=$1 AND cleanup_id=$2 AND resource_id=$3 AND result_json IS NULL",
          [runId,cleanupId,resourceId,JSON.stringify(result),hash,ownership.generation]);
        const resources=await cleanupResources(client,runId,cleanupId);
        if(resources.every(item=>item.result_json))await client.query("UPDATE aidn_shared.execution_cleanup_operations SET status='completed' WHERE run_id=$1 AND cleanup_id=$2 AND generation=$3",[runId,cleanupId,ownership.generation]);
        await bump(client,run);return snapshot(client,run);
      });
    },
    async reconcileCleanup({runId,cleanupId,expectedOwnership,expectedControlRevision,proof}) {
      expectedOwnership=copy(expectedOwnership);proof=boundedJson(proof);
      if(typeof verifyCleanupTermination!=="function")throw failure("CLEANUP_TERMINATION_VERIFIER_REQUIRED");
      return transaction(async client=>{
        const run=await lockedRun(client,runId);revision(run,expectedControlRevision);
        const row=(await cleanupRows(client,runId)).at(-1);
        if(!row || row.cleanup_id!==cleanupId || !same(json(row,"ownership_json"),expectedOwnership))throw failure("CLEANUP_OWNERSHIP_LOST");
        await cleanupEligibility(client,run,json(row,"cleanup_json"));
        if(row.termination_json){
          if(!same(json(row,"termination_json"),proof))throw failure("CLEANUP_TERMINATION_CONFLICT");
          return snapshot(client,run);
        }
        let observed;
        try {observed=await boundedVerification(signal=>verifyCleanupTermination(cleanupView(row),copy(proof),{run:json(run,"run_json"),signal}),"CLEANUP_TERMINATION_TIMED_OUT");}
        catch{throw failure("CLEANUP_TERMINATION_UNCONFIRMED");}
        if(!observed || ["ok","cleaner_stopped","descendants_stopped","git_operations_stopped"].some(key=>observed[key]!==true))throw failure("CLEANUP_TERMINATION_UNCONFIRMED");
        await client.query("UPDATE aidn_shared.execution_cleanup_operations SET status='stopped',termination_json=$4::jsonb,lease_until=clock_timestamp() WHERE run_id=$1 AND cleanup_id=$2 AND generation=$3",
          [runId,cleanupId,expectedOwnership.generation,JSON.stringify(proof)]);
        await bump(client,run);return snapshot(client,run);
      });
    },
    async claimSupervisor({runId,ownerId,runner,integration,expectedControlRevision,expectedPreviousGeneration=null,drainOnly=false}) {
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
        const cancelling=Boolean(await cancelRow(client,runId));
        if(drainOnly!==true && drainOnly!==false)throw failure("DRAIN_MODE_INVALID");
        if(cancelling!==drainOnly)throw failure(cancelling ? "CANCEL_REQUESTED" : "DRAIN_MODE_INVALID");
        const plan = json(run,"plan_json"), prior = await currentSupervisor(client,run);
        if (integration.base_sha !== plan.base.sha || integration.ref === plan.base.branch
          || integration.ref === "refs/heads/"+plan.base.branch) throw failure("INTEGRATION_TARGET_INVALID");
        if (run.supervision_mode !== "supervised") {
          if (expectedPreviousGeneration !== null || (await client.query("SELECT 1 FROM aidn_shared.execution_attempts WHERE run_id=$1 LIMIT 1",[runId])).rows.length) throw failure("LEGACY_RUN_ADOPTION_REFUSED");
          if(!drainOnly)await canonical(client,run);
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
          run:json(run,"run_json"),pendingIntegrations:await pendingIntegrations(client,runId),signal,
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
        await noCancellation(client,run);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const unresolved=await client.query("SELECT 1 FROM aidn_shared.execution_attempts WHERE run_id=$1 AND (attempt_json->>'lifecycle_status' IN ('launch_intended','running','recovery_required') OR (termination_json IS NULL AND reconciliation_json IS NULL)) LIMIT 1",[runId]);
        if (unresolved.rows.length || (await pendingIntegrations(client,runId)).length) throw failure("RECOVERY_REQUIRED");
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
        await noCancellation(client,run);
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
        await noCancellation(client,run);
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
        const verified=await verifyValidationEvidence(run,acceptance,"task",row), verifiedHash=verified ? fingerprintAgentExecutionValue(verified) : null;
        // Activation may be external to the locked PostgreSQL canonical rows.
        await canonical(client,run);
        if (existing && (existing.evidence_verification_sha256 ?? null)!==verifiedHash) throw failure("VALIDATION_EVIDENCE_CONFLICT");
        if (!existing) await client.query("INSERT INTO aidn_shared.execution_acceptances(attempt_id,run_id,task_id,acceptance_sha256,acceptance_json,supervisor_generation,evidence_verification_json,evidence_verification_sha256) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)",
          [acceptance.attempt_id,runId,acceptance.task_id,hash,JSON.stringify(acceptance),supervisor.generation,verified ? JSON.stringify(verified) : null,verifiedHash]);
        return {acceptance:copy(acceptance),acceptance_sha256:hash,evidence_verification:verified,evidence_verification_sha256:verifiedHash,idempotent:Boolean(existing)};
      });
    },
    async recordIntegrationIntent({runId,supervisor,expectedControlRevision,intent}) {
      intent=copy(contract("integration-intent",intent)); supervisor=copy(supervisor);
      return transaction(async client=>{
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        await noCancellation(client,run);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const {rows,head}=await integrationChain(client,run), hash=fingerprintAgentExecutionValue(intent);
        const intents=await intentRows(client,runId), existing=intents.find(row=>row.integration_id===intent.integration_id);
        if (existing && (existing.intent_sha256!==hash || !same(json(existing,"intent_json"),intent))) throw failure("INTEGRATION_INTENT_CONFLICT");
        if (existing) {
          await requireStoppedProducer(client,run,intent.created_by,supervisor);
          await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
          return {intent:copy(intent),intent_sha256:hash,control_revision:Number(run.control_revision),idempotent:true};
        }
        if (!RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
        if (!same(intent.created_by,supervisor)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
        if ((await pendingIntegrations(client,runId)).length) throw failure("INTEGRATION_PENDING");
        const acceptance=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE attempt_id=$1 AND run_id=$2",[intent.attempt_id,runId])).rows[0];
        if (!acceptance || acceptance.acceptance_sha256!==intent.acceptance_sha256
          || !validateAgentIntegrationIntentBindings({plan:json(run,"plan_json"),run:json(run,"run_json"),intent,
            acceptance:json(acceptance,"acceptance_json"),integrationHead:head}).ok) throw failure("INTEGRATION_INTENT_BINDING_INVALID");
        if (rows.some(row=>row.integration_id===intent.integration_id)) throw failure("INTEGRATION_INTENT_CONFLICT");
        await requireIntegrationOrder(client,run,intent.task_id,rows);
        await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
        await client.query("INSERT INTO aidn_shared.execution_integration_intents(run_id,integration_id,sequence,attempt_id,intent_sha256,intent_json,creator_generation) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
          [runId,intent.integration_id,intent.sequence,intent.attempt_id,hash,JSON.stringify(intent),supervisor.generation]);
        await bump(client,run);
        return {intent:copy(intent),intent_sha256:hash,control_revision:Number(run.control_revision),idempotent:false};
      });
    },
    async prepareIntegration({runId,supervisor,expectedControlRevision,integration,intentSha256=null,reconciliation=false}) {
      if (typeof reconciliation!=="boolean") throw failure("RECONCILIATION_INVALID");
      integration=copy(contract("integration-prepared",integration));
      supervisor=copy(supervisor);
      return transaction(async client => {
        const run=await lockedRun(client,runId); revision(run,expectedControlRevision);
        if(!reconciliation)await noCancellation(client,run);
        await supervisorGuard(client,run,supervisor,{required:true,deadline:!reconciliation});
        if (!reconciliation) await canonical(client,run);
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        if (reconciliation && json(run,"run_json").lifecycle_status!=="recovery_required") throw failure("RECONCILIATION_NOT_REQUIRED");
        const {rows,head}=await integrationChain(client,run), hash=fingerprintAgentExecutionValue(integration);
        const existing=rows.find(row=>row.integration_id===integration.integration_id);
        const intents=await intentRows(client,runId), intentRow=intents.find(row=>row.integration_id===integration.integration_id), intent=json(intentRow,"intent_json");
        if (json(run,"plan_json").verification && (!intent || !intentSha256)) throw failure("INTEGRATION_INTENT_REQUIRED");
        if (reconciliation && !intent) throw failure("INTEGRATION_INTENT_REQUIRED");
        if (intent || intentSha256 || integration.intent_sha256) {
          if (!intent || intentRow.intent_sha256!==intentSha256 || integration.intent_sha256!==intentSha256
            || ["integration_id","run_id","plan_sha256","task_id","attempt_id","acceptance_sha256","sequence","repository_identity_sha256","ref","source_sha","parent_sha"].some(key=>integration[key]!==intent[key])) throw failure("INTEGRATION_INTENT_BINDING_INVALID");
          await requireStoppedProducer(client,run,intent.created_by,supervisor,{mustBePrevious:reconciliation});
        }
        if (integration.run_id!==runId || integration.plan_sha256!==run.plan_sha256
          || integration.ref!==head.ref || integration.repository_identity_sha256!==head.repository_identity_sha256) throw failure("INTEGRATION_BINDING_INVALID");
        if (existing && (existing.prepared_sha256!==hash || !same(json(existing,"prepared_json"),integration))) throw failure("INTEGRATION_CONFLICT");
        const acceptance=(await client.query("SELECT * FROM aidn_shared.execution_acceptances WHERE attempt_id=$1 AND run_id=$2",[integration.attempt_id,runId])).rows[0];
        const attempt=(await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE attempt_id=$1 AND run_id=$2",[integration.attempt_id,runId])).rows[0];
        if (!acceptance || !attempt || acceptance.acceptance_sha256!==integration.acceptance_sha256
          || acceptance.task_id!==integration.task_id || json(acceptance,"acceptance_json").decision!=="accepted"
          || json(acceptance,"acceptance_json").candidate_sha!==integration.source_sha) throw failure("INTEGRATION_ACCEPTANCE_REQUIRED");
        if (!existing) {
          if (!intent && !same(integration.prepared_by,supervisor)) throw failure("SUPERVISOR_OWNERSHIP_LOST");
          if (!RUN_ACTIVE.has(json(run,"run_json").lifecycle_status) && !(intent && json(run,"run_json").lifecycle_status==="recovery_required")) throw failure("RUN_NOT_ACTIVE");
          if (rows.some(row=>!row.applied_json) || intents.some(row=>!row.applied_at && row.integration_id!==integration.integration_id)) throw failure("INTEGRATION_PENDING");
          if (integration.parent_sha!==head.sha || integration.sequence!==head.sequence+1) throw failure("INTEGRATION_PARENT_MISMATCH");
          await requireIntegrationOrder(client,run,integration.task_id,rows);
        }
        await requireStoppedProducer(client,run,integration.prepared_by,supervisor,{mustBePrevious:reconciliation});
        await inspectGit(run,supervisor,{...integration,...(intent ? {intent} : {})},"prepared",
          existing || intent ? [integration.parent_sha,integration.result_sha] : [integration.parent_sha],json(attempt,"attempt_json").input_sha);
        if (!existing) {
          await client.query("INSERT INTO aidn_shared.execution_integrations(run_id,integration_id,sequence,attempt_id,prepared_sha256,prepared_json,intent_sha256) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
            [runId,integration.integration_id,integration.sequence,integration.attempt_id,hash,JSON.stringify(integration),intentSha256]);
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
        if(!reconciliation)await noCancellation(client,run);
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
        const intentRow=(await intentRows(client,runId)).find(item=>item.integration_id===integrationId), intent=json(intentRow,"intent_json");
        if (row.intent_sha256 && (!intent || intentRow.intent_sha256!==row.intent_sha256)) throw failure("INTEGRATION_INTENT_BINDING_INVALID");
        await inspectGit(run,supervisor,{...prepared,...(intent ? {intent} : {})},"applied",[prepared.result_sha],json(attempt,"attempt_json").input_sha);
        if (!row.applied_json) {
          if (head.sha!==prepared.parent_sha || head.sequence+1!==prepared.sequence) throw failure("INTEGRATION_PARENT_MISMATCH");
          await client.query("UPDATE aidn_shared.execution_integrations SET applied_json=$3::jsonb,applied_sha256=$4,applied_at=clock_timestamp() WHERE run_id=$1 AND integration_id=$2 AND applied_json IS NULL",[runId,integrationId,JSON.stringify(applied),hash]);
          if (intent) await client.query("UPDATE aidn_shared.execution_integration_intents SET applied_at=clock_timestamp() WHERE run_id=$1 AND integration_id=$2 AND applied_at IS NULL",[runId,integrationId]);
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
        await noCancellation(client,run);
        await supervisorGuard(client,run,supervisor,{required:true}); await canonical(client,run);
        if (!run.reservation_active || !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RUN_NOT_ACTIVE");
        const head=await requireAllIntegrated(client,run);
        if (!validateAgentRunValidationBindings({plan:json(run,"plan_json"),run:json(run,"run_json"),validation,integratedSha:head.sha,integrationSequence:head.sequence}).ok) throw failure("FINAL_VALIDATION_BINDING_INVALID");
        await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
        const hash=fingerprintAgentExecutionValue(validation);
        const old=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[runId])).rows[0];
        if (old && (old.validation_sha256!==hash || !same(json(old,"validation_json"),validation))) throw failure("FINAL_VALIDATION_CONFLICT");
        const verified=await verifyValidationEvidence(run,validation,"run"), verifiedHash=verified ? fingerprintAgentExecutionValue(verified) : null;
        // Activation may be external to the locked PostgreSQL canonical rows.
        await canonical(client,run);
        if (old && (old.evidence_verification_sha256 ?? null)!==verifiedHash) throw failure("VALIDATION_EVIDENCE_CONFLICT");
        if (!old) {
          await client.query("INSERT INTO aidn_shared.execution_run_validations(run_id,validation_sha256,validation_json,supervisor_generation,evidence_verification_json,evidence_verification_sha256) VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6)",[runId,hash,JSON.stringify(validation),supervisor.generation,verified ? JSON.stringify(verified) : null,verifiedHash]);
          await bump(client,run);
        }
        return {validation:copy(validation),validation_sha256:hash,evidence_verification:verified,evidence_verification_sha256:verifiedHash,control_revision:Number(run.control_revision),idempotent:Boolean(old)};
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
        await noCancellation(client,run);
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
        await noCancellation(client,run);
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
        await supervisorGuard(client,run,supervisor,{deadline:!(await cancelRow(client,run.run_id))});
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
        await noCancellation(client,run);
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
        await supervisorGuard(client,run,supervisor,{deadline:!(await cancelRow(client,run.run_id))});
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
        await supervisorGuard(client,run,supervisor,{deadline:!(await cancelRow(client,run.run_id))});
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
    async reconcileAttempt({ attemptId, proof, terminationState = "confirmed", supervisor = null }) {
      if (!["confirmed", "not_started"].includes(terminationState)) throw failure("TERMINATION_STATE_INVALID");
      const retained = terminationState === "not_started"
        ? { contract_version: "agent-attempt-reconciliation.v1", termination_state: terminationState, proof: boundedJson(proof) } : boundedJson(proof);
      return transaction(async client => {
        const { run, row } = await lockedAttempt(client, attemptId);
        await supervisorGuard(client,run,supervisor,{deadline:false});
        if (!run.reservation_active) throw failure("RUN_NOT_ACTIVE");
        const attempt = json(row,"attempt_json");
        if (row.reconciliation_json) {
          if (!same(json(row,"reconciliation_json"),retained)) throw failure("RECONCILIATION_CONFLICT");
          return { ...attemptView(row), idempotent: true };
        }
        if (!ACTIVE.has(attempt.lifecycle_status) && attempt.lifecycle_status !== "recovery_required") throw failure("RECONCILIATION_NOT_REQUIRED");
        await termination(row,terminationState === "not_started" ? retained.proof : retained,terminationState);
        const ended = { ...attempt, lifecycle_status: "cancelled" };
        const reconciled = await client.query(`UPDATE aidn_shared.execution_attempts SET
          attempt_json=$2::jsonb,reconciliation_json=$3::jsonb,generation=generation+1,
          lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE attempt_id=$1 RETURNING *`, [attemptId,JSON.stringify(ended),JSON.stringify(retained)]);
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
          await noCancellation(client,run);
          if (run.supervision_mode !== "supervised") throw failure("ACCEPTANCE_REQUIRED");
          revision(run,expectedControlRevision); await canonical(client,run);
          if (run.reservation_active && !RUN_ACTIVE.has(json(run,"run_json").lifecycle_status)) throw failure("RECOVERY_REQUIRED");
          const head=await requireAllIntegrated(client,run);
          const final=(await client.query("SELECT * FROM aidn_shared.execution_run_validations WHERE run_id=$1",[runId])).rows[0];
          if (!final || final.validation_sha256!==finalValidationSha256 || json(final,"validation_json").outcome!=="passed"
            || !validateAgentRunValidationBindings({plan:json(run,"plan_json"),run:json(run,"run_json"),validation:json(final,"validation_json"),integratedSha:head.sha,integrationSequence:head.sequence}).ok) throw failure("FINAL_VALIDATION_REQUIRED");
          const verified=await verifyValidationEvidence(run,json(final,"validation_json"),"run");
          if (verified && (final.evidence_verification_sha256!==fingerprintAgentExecutionValue(verified)
            || !same(json(final,"evidence_verification_json"),verified))) throw failure("VALIDATION_EVIDENCE_CONFLICT");
          await inspectGit(run,supervisor,headInspection(head),"head",[head.sha]);
          await canonical(client,run);
        }
        if (!run.reservation_active) {
          if (json(run,"run_json").lifecycle_status !== outcome) throw failure("RUN_TERMINAL_CONFLICT");
          if (run.supervision_mode === "supervised") return snapshot(client,run);
          return { run: json(run,"run_json"), reservation_active: false };
        }
        const attempts = await client.query("SELECT * FROM aidn_shared.execution_attempts WHERE run_id=$1 FOR UPDATE", [runId]);
        if (run.supervision_mode === "supervised" && (await pendingIntegrations(client,runId)).length) throw failure("RECOVERY_REQUIRED");
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
  return assertAgentRunLifecycleStore(Object.fromEntries(Object.entries(store).map(([name, operation]) => [name, async (...args) => {
    try { return await operation(...args); } catch (error) { throw mapError(error); }
  }])));
}
