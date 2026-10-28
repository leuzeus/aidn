#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AGENT_ROLES, buildAgentProfile, canAgentRolePerform } from "../../src/core/agents/agent-role-model.mjs";
import { evaluateAgentReuse, fingerprintAgentReuse } from "../../src/core/agents/agent-reuse-policy.mjs";
import { decideAgentReuse } from "../../src/application/runtime/agent-reuse-decision-service.mjs";
import { buildCoordinatorDispatchPlanResult } from "../../src/application/runtime/coordinator-dispatch-plan-use-case.mjs";
import { buildCoordinationHistoryEvent } from "../../src/application/runtime/coordinator-dispatch-execute-use-case.mjs";
import { computeCoordinatorDispatchPlan } from "../runtime/coordinator-dispatch-plan.mjs";
import { executeCoordinatorDispatch } from "../runtime/coordinator-dispatch-execute.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { createTrackedFixtureFilter, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";

const copy = structuredClone, H = "a".repeat(64), OTHER = "b".repeat(64), NOW = Date.now();
const request = () => ({ contract_version: "agent-reuse-request.v1", activity_id: "activity-2", scope_id: "scope-1",
  revision: "revision-1", artifact_sha256: H, criteria_sha256: H, assurance_profile: "consultation.v1",
  mode: "EXPLORING", role: "auditor", action: "analyze", independent_review: false, context_isolation_required: false,
  required_permissions: ["read:product"], allowed_permissions: ["read:product"], allowed_context_sha256: [H], reviewed_contributors: [] });
const executor = (suffix = "1") => ({ execution_id: `execution-${suffix}`, agent_id: `agent-${suffix}`, lineage_id: `lineage-${suffix}`,
  session_id: `session-${suffix}`, adapter_id: "codex", role: "executor", action: "implement",
  permissions: ["read:product"], guarantees: ["context-isolated", "protected-verdict"], context_sha256: [H], contributions: [] });
function observation(r = request()) { return { contract_version: "agent-reuse-observation.v1", authority_id: "fixture-authority",
  observation_id: "observation-1", request_sha256: fingerprintAgentReuse(r), scope_id: r.scope_id, revision: r.revision,
  artifact_sha256: r.artifact_sha256, criteria_sha256: r.criteria_sha256, assurance_profile: r.assurance_profile,
  observed_at: new Date(NOW - 100).toISOString(), expires_at: new Date(NOW + 9000).toISOString(),
  current_execution_id: "execution-1", executors: [executor()], evidence_refs: [{ ref: "fixture/snapshot-1", sha256: H }] }; }
const profile = buildAgentProfile({ id: "codex", label: "Fixture", defaultRole: "coordinator", roles: AGENT_ROLES });
const adapter = { getProfile: () => profile, canHandleRole: ({ role, action }) => canAgentRolePerform(role, action) };
function authority(observe) { return { observe, verify: async ({ request: r, observation: o }) => ({ outcome: "verified",
  authority_id: o.authority_id, request_sha256: fingerprintAgentReuse(r), observation_sha256: fingerprintAgentReuse(o) }) }; }
const pure = (r, o) => evaluateAgentReuse({ request: r, observation: o, eligibleAdapterIds: ["codex"], now: NOW });
const service = (r, provider, rest = {}) => decideAgentReuse({ request: r, authority: provider,
  recommendation: { role: r.role, action: r.action, mode: r.mode }, scope: { scope_id: r.scope_id }, adapters: [adapter], now: () => NOW, ...rest });
const cases = [];
function snapshot(root) {
  const files = {};
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files[path.relative(root, absolute)] = createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    }
  };
  visit(root); return files;
}
async function check(name, run) {
  try { await run(); cases.push({ name, status: "PASS" }); }
  catch (error) { console.error(JSON.stringify({ name, status: "FAIL", code: error.code ?? "FIXTURE_FAILURE",
    diagnostic: String(error.message).slice(0, 768) })); throw new Error(`CASE_FAILED: ${name}`); }
}
function reviewRequest() { return { ...request(), action: "audit", independent_review: true, context_isolation_required: true,
  reviewed_contributors: [{ agent_id: "author", lineage_id: "author-lineage" }] }; }

await check("compatible roles retain observed execution identity and contribution history", () => {
  const r = request(), o = observation(r); o.executors[0].contributions.push({ scope_id: r.scope_id, revision: "older",
    artifact_sha256: OTHER, activity_id: "activity-1", role: "executor" });
  const before = copy(o), result = pure(r, o); assert.equal(result.decision, "reuse");
  assert.equal(result.execution_id, o.current_execution_id); assert.equal(result.contribution_sha256, fingerprintAgentReuse(o.executors[0].contributions));
  assert.deepEqual(o, before); assert.equal(result.write_authorization, false); assert.equal(result.native_qualification, "NOT_PROVEN");
});
await check("same role continuation is not a fabricated role transition", () => {
  const r = { ...request(), role: "executor", action: "implement" }; assert.equal(pure(r, observation(r)).decision, "reuse");
});
await check("reuse never bypasses the existing mode transition matrix", () => {
  const r = { ...request(), role: "executor", action: "implement" }, o = observation(r);
  o.executors[0].role = "repair"; o.executors[0].action = "repair";
  assert.equal(pure(r, o).rejected[0].reason_code, "ROLE_TRANSITION_REFUSED");
});
await check("adapter change alone cannot supply a native execution identity", async () => {
  const r = request(), o = observation(r); o.executors[0].agent_id = "";
  assert.equal((await service(r, authority(async () => o))).decision, "wait");
});
await check("review excludes same author and same lineage even after a new session", () => {
  const r = reviewRequest();
  for (const key of ["agent_id", "lineage_id"]) {
    const o = observation(r); o.executors[0][key] = r.reviewed_contributors[0][key]; o.executors[0].session_id = "fresh-session";
    const result = pure(r, o); assert.equal(result.decision, "wait"); assert.equal(result.rejected[0].reason_code, "REVIEWED_CONTRIBUTOR_EXCLUDED");
  }
});
await check("different author label still excluded by retained scope contribution", () => {
  const r = reviewRequest(), o = observation(r); o.executors[0].contributions.push({ scope_id: r.scope_id,
    revision: "older", artifact_sha256: OTHER, activity_id: "fix-criteria", role: "auditor" });
  assert.equal(pure(r, o).rejected[0].reason_code, "REVIEWED_CONTRIBUTOR_EXCLUDED");
});
await check("another eligible executor is a separation recommendation, never a launch", () => {
  const r = reviewRequest(), o = observation(r); o.executors[0].agent_id = "author"; o.executors.push(executor("2"));
  const result = pure(r, o); assert.equal(result.decision, "separate"); assert.equal(result.execution_id, "execution-2"); assert.equal(result.write_authorization, false);
});
await check("no eligible reviewer waits instead of weakening assurance", () => {
  const r = reviewRequest(), o = observation(r); o.executors[0].guarantees = [];
  assert.equal(pure(r, o).decision, "wait");
});
await check("explicit context isolation is binding outside independent review too", () => {
  const r = { ...request(), context_isolation_required: true }, o = observation(r);
  o.executors[0].guarantees = []; assert.equal(pure(r, o).rejected[0].reason_code, "CONTEXT_ISOLATION_UNPROVEN");
});
await check("write rights retained from prior role cannot accumulate into read-only activity", () => {
  const r = request(), o = observation(r); o.executors[0].permissions.push("write:product");
  assert.equal(pure(r, o).rejected[0].reason_code, "EFFECTIVE_PERMISSIONS_MISMATCH");
});
await check("missing effective rights, foreign context and absent protected verdict refuse", () => {
  const r = reviewRequest();
  for (const mutate of [o => { o.executors[0].permissions = []; }, o => { o.executors[0].context_sha256 = [OTHER]; },
    o => { o.executors[0].guarantees = ["context-isolated"]; }]) {
    const o = observation(r); mutate(o); assert.equal(pure(r, o).decision, "wait");
  }
});
await check("changed revision artifact criteria assurance scope or request cannot reuse observation", () => {
  const r = request();
  for (const field of ["revision", "artifact_sha256", "criteria_sha256", "assurance_profile", "scope_id", "request_sha256"]) {
    const o = observation(r); o[field] = field.includes("sha256") ? OTHER : "changed";
    assert.equal(pure(r, o).reason_code, "OBSERVATION_BINDING_MISMATCH");
  }
});
await check("expired future or overlong observations fail closed", () => {
  const r = request();
  for (const change of [{ expires_at: new Date(NOW).toISOString() }, { observed_at: new Date(NOW + 1).toISOString() },
    { expires_at: new Date(NOW + 20000).toISOString() }]) {
    const o = { ...observation(r), ...change }, result = pure(r, o);
    assert.equal(result.reason_code, "OBSERVATION_STALE"); assert.equal(result.observation_sha256, fingerprintAgentReuse(o));
    assert.deepEqual(result.evidence_refs, o.evidence_refs);
  }
});
await check("expiry during authentication is rechecked before assignment", async () => {
  const r = request();
  const result = await service(r, authority(async () => observation(r)), { now: () => NOW + 10000 });
  assert.equal(result.reason_code, "OBSERVATION_STALE");
});
await check("author-supplied verified boolean is not an authority port", async () => {
  const r = request(); assert.equal((await service(r, { verified: true })).reason_code, "ASSIGNMENT_AUTHORITY_UNAVAILABLE");
  assert.equal((await service(r, { observe: async () => observation(r), verify: async () => true })).reason_code, "OBSERVATION_NOT_AUTHENTICATED");
});
await check("authenticator response must bind exact observation request and authority", async () => {
  const r = request(); for (const override of [{ observation_sha256: OTHER }, { request_sha256: OTHER }, { authority_id: "other" }]) {
    const provider = authority(async () => observation(r)), verify = provider.verify;
    provider.verify = async args => ({ ...await verify(args), ...override });
    assert.equal((await service(r, provider)).reason_code, "OBSERVATION_NOT_AUTHENTICATED");
  }
});
await check("role and canonical scope binding precede authority observation", async () => {
  const r = request(); let reads = 0;
  const result = await service(r, authority(async () => { reads++; return observation(r); }), { scope: { scope_id: "other" } });
  assert.equal(result.reason_code, "DISPATCH_BINDING_MISMATCH"); assert.equal(reads, 0);
});
await check("unknown request fields and capabilities cannot silently broaden policy", async () => {
  const r = { ...request(), skip_review: true }; assert.equal((await service(r, authority(async () => observation(r)))).reason_code, "REQUEST_INVALID");
});
await check("decision schema validates real outcomes and rejects mutation authority or malformed proof", () => {
  const repo = path.resolve(import.meta.dirname, "../..");
  const schema = JSON.parse(fs.readFileSync(path.join(repo, "src/core/contracts/agent-reuse/agent-reuse-decision.v1.schema.json"), "utf8"));
  const validate = value => validateJsonSchema(value, schema, "$", { contractKind: "agent-execution" });
  const result = pure(request(), observation()); assert.deepEqual(validate(result), []);
  const unavailable = observation(); unavailable.executors = [];
  assert.deepEqual(validate(pure(request(), unavailable)), []);
  const review = reviewRequest(), alternate = observation(review);
  alternate.executors[0].agent_id = "author"; alternate.executors.push(executor("2"));
  assert.deepEqual(validate(pure(review, alternate)), []);
  for (const invalid of [{ ...result, write_authorization: true }, { ...result, decision: "launch" },
    { ...result, native_qualification: "PASS" }, { ...result, observation_sha256: "invalid" }]) assert(validate(invalid).length > 0);
  const nested = copy(schema); delete nested.$schema; delete nested.$id; delete nested.title;
  for (const name of ["plan", "execute"]) {
    const publicSchema = JSON.parse(fs.readFileSync(path.join(repo, `src/core/contracts/cli-output/runtime-coordinator-dispatch-${name}.v1.schema.json`), "utf8"));
    assert.deepEqual(publicSchema.properties.execution_assignment, nested);
  }
});
await check("roster health and explicit adapter selection cannot be overridden by reuse", async () => {
  const r = request(), provider = authority(async () => observation(r));
  for (const rest of [{ roster: { agents: { codex: { enabled: false } } } }, { adapterHealth: { codex: { health_status: "unavailable" } } },
    { requestedAgent: "other-adapter" }]) assert.equal((await service(r, provider, rest)).decision, "wait");
});
await check("an eligible current execution wins over a higher scoring specialist adapter", async () => {
  const r = request(), specialistProfile = buildAgentProfile({ id: "codex-auditor", label: "Specialist",
    defaultRole: "auditor", roles: ["auditor"] });
  const specialist = { getProfile: () => specialistProfile, canHandleRole: () => true };
  const result = await service(r, authority(async () => observation(r)), { adapters: [specialist, adapter] });
  assert.equal(result.decision, "reuse"); assert.equal(result.adapter_id, "codex"); assert.equal(result.execution_id, "execution-1");
});
await check("verdict rechecks contributions and never substitutes another reviewer", async () => {
  const r = reviewRequest(), provider = authority(async () => observation(r));
  assert.equal((await service(r, provider, { phase: "verdict", expectedExecutionId: "execution-1" })).decision, "reuse");
  provider.observe = async () => { const o = observation(r); o.executors[0].contributions.push({ scope_id: r.scope_id,
    revision: "revision-1", artifact_sha256: H, activity_id: "reviewer-fix", role: "auditor" }); o.executors.push(executor("2")); return o; };
  assert.equal((await service(r, provider, { phase: "verdict", expectedExecutionId: "execution-1" })).reason_code, "VERDICT_EXECUTOR_INELIGIBLE");
});
await check("bounded authority timeout aborts and refuses without a fallback", async () => {
  let signal; const r = request(), provider = authority(async args => { signal = args.signal; return new Promise(() => {}); });
  const result = await service(r, provider, { timeoutMs: 5 }); assert.equal(result.reason_code, "ASSIGNMENT_OBSERVATION_TIMEOUT"); assert(signal.aborted);
});

// Real planner and executor consumers, isolated local fixture only. No native
// client, DB/network service, installed plugin or authored historical code.
const repo = path.resolve(import.meta.dirname, "../.."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-reuse-"));
try {
  const source = path.join(repo, "tests/fixtures/perf-handoff/ready"), target = path.join(temp, "project");
  const tracked = createTrackedFixtureFilter(source, repo);
  fs.cpSync(source, target, { recursive: true, filter: tracked }); prepareActivationFixture(target, repo);
  const baseline = await computeCoordinatorDispatchPlan({ targetRoot: target });
  const r = { ...request(), scope_id: baseline.dispatch_scope.scope_id, mode: baseline.context.mode,
    role: baseline.coordinator_recommendation.role, action: baseline.coordinator_recommendation.action };
  const provider = authority(async ({ request: actual }) => {
    const o = observation(actual); o.observed_at = new Date(Date.now() - 1).toISOString(); o.expires_at = new Date(Date.now() + 5000).toISOString();
    o.executors[0].role = actual.role; o.executors[0].action = actual.action; return o;
  });
  await check("legacy planner remains structurally equivalent without opt-in apart from diagnostic timestamp", async () => {
    const withoutTimestamp = value => JSON.parse(JSON.stringify(value, (key, v) => key === "ts" ? undefined : v));
    assert(!Object.hasOwn(baseline, "execution_assignment"));
    assert.deepEqual(withoutTimestamp(await computeCoordinatorDispatchPlan({ targetRoot: target })), withoutTimestamp(baseline));
  });
  await check("real sequential planner retains execution identity separately from adapter", async () => {
    const result = await computeCoordinatorDispatchPlan({ targetRoot: target, assignmentRequest: r, assignmentAuthority: provider });
    assert.equal(result.execution_assignment.decision, "reuse"); assert.equal(result.selected_agent.id, "codex"); assert.equal(result.execution_assignment.execution_id, "execution-1");
    const schema = JSON.parse(fs.readFileSync(path.join(repo, "src/core/contracts/cli-output/runtime-coordinator-dispatch-plan.v1.schema.json"), "utf8"));
    assert.deepEqual(validateJsonSchema(result, schema), []);
  });
  await check("real plan and execute refuse absent authority before any command or local write", async () => {
    const before = snapshot(target);
    const result = await executeCoordinatorDispatch({ targetRoot: target, execute: true, assignmentRequest: r });
    assert.equal(result.execution_assignment.decision, "wait"); assert.equal(result.execution_status, "gated"); assert.equal(result.executed_steps.length, 0);
    assert.deepEqual(snapshot(target), before);
  });
  await check("real planner stops rather than launching a recommended separate executor", async () => {
    const separate = authority(async args => { const o = await provider.observe(args);
      o.executors[0].permissions.push("write:product"); const next = executor("2"); next.role = args.request.role; next.action = args.request.action;
      o.executors.push(next); return o; });
    const result = await computeCoordinatorDispatchPlan({ targetRoot: target, assignmentRequest: r, assignmentAuthority: separate });
    assert.equal(result.execution_assignment.decision, "separate"); assert.equal(result.dispatch_status, "gated"); assert.equal(result.steps.length, 0);
  });
  await check("authority disappears between preview and execution; first refusal and partial proof survive", async () => {
    const guarded = { ...provider, observe: async args => { if (args.phase === "before_step") throw Error("fixture loss"); return provider.observe(args); } };
    const result = await executeCoordinatorDispatch({ targetRoot: target, execute: true, assignmentRequest: r, assignmentAuthority: guarded });
    assert.equal(result.execution_status, "gated"); assert.equal(result.executed_steps.length, 0);
    assert.equal(result.assignment_checks[0].decision, "reuse"); assert.equal(result.assignment_checks[1].decision, "wait");
    const event = buildCoordinationHistoryEvent(result); assert.deepEqual(event.assignment_checks, result.assignment_checks);
  });
  // Each dispatch scenario owns a fresh corpus: stopped coordination history
  // from one case must not trigger the real escalation gate in another case.
  async function withCommandFixture(run) {
    const target = fs.mkdtempSync(path.join(temp, "dispatch-"));
    fs.cpSync(source, target, { recursive: true, filter: tracked }); prepareActivationFixture(target, repo);
    const key = Symbol.for("aidn.fixture.reuse.commands"); const previous = globalThis[key]; globalThis[key] = [];
    try {
      const modulePath = path.join(target, "fixture-adapter.mjs");
      fs.writeFileSync(modulePath, `export default ({id}) => ({getProfile:()=>({id,label:id,default_role:'coordinator',supported_roles:['coordinator','executor','auditor','repair']}),canHandleRole:()=>true,runCommand:args=>{if(args.envOverrides?.AIDN_AGENT_ENV_PROBE!=='1')globalThis[Symbol.for('aidn.fixture.reuse.commands')].push(args);return{status:0,stdout:'{}',stderr:''};}});`);
      fs.writeFileSync(path.join(target, "docs/audit/AGENT-ROSTER.md"), "default_agent_selection: auto\n## fixture-reader\nenabled: yes\nroles: coordinator, executor, auditor, repair\nadapter_module: fixture-adapter.mjs\n");
      const base = await computeCoordinatorDispatchPlan({ targetRoot: target });
      const activeRequest = { ...r, scope_id: base.dispatch_scope.scope_id, mode: base.context.mode,
        role: base.coordinator_recommendation.role, action: base.coordinator_recommendation.action };
      const phases = [];
      const composed = authority(async args => { phases.push(args.phase); const o = await provider.observe(args);
        o.executors[0].adapter_id = "fixture-reader"; return o; });
      const dispatch = assignmentAuthority => executeCoordinatorDispatch({ targetRoot: target, execute: true,
        agent: "fixture-reader", assignmentRequest: activeRequest, assignmentAuthority });
      const schema = JSON.parse(fs.readFileSync(path.join(repo, "src/core/contracts/cli-output/runtime-coordinator-dispatch-execute.v1.schema.json"), "utf8"));
      const history = () => fs.readFileSync(path.join(target, ".aidn/runtime/context/coordination-history.ndjson"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
      await run({ key, phases, composed, dispatch, schema, history, base });
    } finally { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; }
  }
  await check("real execute rechecks each step and retains immutable initial and step evidence with one observed identity", () =>
    withCommandFixture(async ({ key, phases, composed, dispatch, schema, history }) => {
      const result = await dispatch(composed);
      assert.equal(result.execution_status, "executed"); assert(result.executed_steps.length > 0);
      assert.equal(globalThis[key].length, result.executed_steps.length);
      assert.equal(phases.filter(p => p === "before_step").length, result.executed_steps.length);
      assert(result.assignment_checks.every(d => d.decision === "reuse" && d.execution_id === "execution-1"));
      assert.equal(result.assignment_checks.length, result.executed_steps.length + 1);
      assert.deepEqual(history().at(-1).assignment_checks, result.assignment_checks);
      assert.deepEqual(validateJsonSchema(result, schema), []);
    }));
  for (const field of ["session_id", "agent_id", "lineage_id", "authority_id"]) {
    await check(`${field} substitution before a command stops and preserves expected and observed identities`, () =>
    withCommandFixture(async ({ key, composed, dispatch, schema }) => {
        const changed = authority(async args => { const o = await composed.observe(args);
          if (args.phase === "before_step") {
            if (field === "authority_id") o.authority_id = "foreign-authority";
            else o.executors[0][field] = "foreign-identity";
          }
          return o;
        });
        const stopped = await dispatch(changed);
        assert.equal(stopped.execution_status, "gated"); assert.equal(globalThis[key].length, 0);
        assert.equal(stopped.execution_assignment.reason_code, "EXECUTION_BINDING_CHANGED");
        assert.notEqual(stopped.assignment_checks[0][field], stopped.assignment_checks[1][field]);
        assert(stopped.assignment_checks[1].observation_sha256);
        assert.deepEqual(validateJsonSchema(stopped, schema), []);
    }));
  }
  await check("authority loss after one successful step stops the remainder and retains partial execution", () =>
    withCommandFixture(async ({ key, composed, dispatch, schema, history, base }) => {
        assert(base.steps.length > 1, "fixture must exercise multiple steps");
        let checks = 0;
        const interrupted = authority(async args => { if (args.phase === "before_step" && ++checks === 2) throw Error("fixture unavailable");
          return composed.observe(args); });
        const stopped = await dispatch(interrupted);
        assert.equal(stopped.execution_status, "gated"); assert.equal(globalThis[key].length, 1);
        assert.equal(stopped.executed_steps.length, 1); assert.equal(stopped.assignment_checks.length, 3);
        assert.equal(stopped.assignment_checks.at(-1).reason_code, "ASSIGNMENT_OBSERVATION_UNAVAILABLE");
        assert.deepEqual(validateJsonSchema(stopped, schema), []);
        assert.deepEqual(history().at(-1).assignment_checks, stopped.assignment_checks);
    }));
} finally {
  const cleanup = removePathWithRetry(temp);
  if (!cleanup.ok) throw cleanup.error;
}
console.log(JSON.stringify({ status: "PASS", cases, native_trials: 0, model_calls: 0, network_calls: 0, installed_activation: false }, null, 2));
