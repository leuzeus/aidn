import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertAgentExecutionContract,
  fingerprintAgentExecutionPlan,
  fingerprintAgentExecutionValue,
  fingerprintTaskContract,
  listAgentExecutionContractKinds,
  normalizeAgentExecutionPlan,
  taskValidationIds,
  validateAgentExecutionBindings,
  validateAgentExecutionContract,
  validateAgentRunValidationBindings,
} from "../../src/core/agents/agent-execution-contracts.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import { assertAgentAdapter } from "../../src/core/ports/agent-adapter-port.mjs";
import { buildAgentProfile } from "../../src/core/agents/agent-role-model.mjs";
import { runAgentTaskExecutorConformanceChecks } from "./agent-task-executor-conformance.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url), "utf8"));
const schemaRoot = new URL("../../src/core/contracts/agent-execution/", import.meta.url);
const kinds = ["acceptance", "attempt", "availability", "delegation", "descriptor", "event", "integration-applied", "integration-prepared", "plan", "request", "result", "run", "run-validation", "supervisor", "task"];
const checks = [];
const copy = (value) => structuredClone(value);
const profile = { contractKind: "agent-execution" };
async function check(name, body) {
  try {
    await body();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", detail: String(error.message).slice(0, 1800) });
  }
}
function expectIssue(checked, code) {
  assert.equal(checked.ok, false, `Expected rejection ${code}`);
  assert.ok(checked.issues.some((entry) => entry.code === code), `Expected ${code}; got ${JSON.stringify(checked.issues)}`);
  assert.ok(checked.issues.every((entry) => typeof entry.path === "string"));
}
async function rejectContract(name, kind, mutate, code) {
  await check(name, () => {
    const value = copy(fixture[kind]);
    if (kind === "plan") delete value.plan_sha256;
    mutate(value);
    const before = JSON.stringify(value);
    expectIssue(validateAgentExecutionContract(kind, value), code);
    assert.equal(JSON.stringify(value), before, "A refusing validator must not mutate input");
  });
}
async function rejectBindings(name, mutate, code) {
  await check(name, () => {
    const bundle = copy(fixture);
    mutate(bundle);
    const before = JSON.stringify(bundle);
    expectIssue(validateAgentExecutionBindings(bundle), code);
    assert.equal(JSON.stringify(bundle), before);
  });
}

function withPreexistingNativeProfile() {
  const bundle = copy(fixture);
  bundle.plan.execution.native_profile = { mode: "preexisting", policy_sha256: "a".repeat(64) };
  bundle.plan.plan_sha256 = fingerprintAgentExecutionPlan(bundle.plan);
  for (const kind of ["run", "task", "attempt", "delegation", "request", "event", "result", "acceptance"]) {
    bundle[kind].plan_sha256 = bundle.plan.plan_sha256;
  }
  for (const event of bundle.events) event.plan_sha256 = bundle.plan.plan_sha256;
  bundle.request.execution = copy(bundle.plan.execution);
  bundle.request.delegation_sha256 = fingerprintAgentExecutionValue(bundle.delegation);
  bundle.result.request_sha256 = fingerprintAgentExecutionValue(bundle.request);
  bundle.acceptance.result_sha256 = fingerprintAgentExecutionValue(bundle.result);
  return bundle;
}

await check("registry has exactly one positive case per internal schema", () => {
  assert.deepEqual(listAgentExecutionContractKinds().sort(), kinds);
  assert.deepEqual(readdirSync(schemaRoot).filter((name) => name.endsWith(".schema.json")).sort(), kinds.map((kind) => `${kind}.v1.schema.json`).sort());
});
for (const kind of kinds) {
  const schema = JSON.parse(readFileSync(new URL(`${kind}.v1.schema.json`, schemaRoot), "utf8"));
  await check(`${kind}: positive schema and semantic contract`, () => {
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", profile), []);
    assert.deepEqual(validateJsonSchema(fixture[kind], schema, "$", profile), []);
    assert.deepEqual(validateAgentExecutionContract(kind, fixture[kind]), { ok: true, issues: [] });
    assert.equal(assertAgentExecutionContract(kind, fixture[kind]), fixture[kind]);
  });
  await check(`${kind}: every mandatory field is enforced`, () => {
    for (const field of schema.required) {
      const value = copy(fixture[kind]);
      delete value[field];
      expectIssue(validateAgentExecutionContract(kind, value), "SCHEMA_INVALID");
    }
  });
  await rejectContract(`${kind}: unknown fields rejected`, kind, (v) => { v.unrecognized_authority = true; }, "SCHEMA_INVALID");
}
await check("complete independently authored model chain binds without mutation", () => {
  const before = JSON.stringify(fixture);
  assert.deepEqual(validateAgentExecutionBindings(fixture), { ok: true, issues: [] });
  assert.equal(JSON.stringify(fixture), before);
  assert.notEqual(fixture.plan.canonical.plan_sha256, fixture.plan.plan_sha256);
});
await check("legacy execution configuration remains valid without a native profile", () => {
  assert.equal(Object.hasOwn(fixture.plan.execution, "native_profile"), false);
  assert.equal(Object.hasOwn(fixture.request.execution, "native_profile"), false);
  const normalized = normalizeAgentExecutionPlan(fixture.plan);
  assert.equal(Object.hasOwn(normalized.execution, "native_profile"), false);
  assert.equal(normalized.plan_sha256, fixture.expected.plan_sha256);
  assert.equal(validateAgentExecutionBindings(fixture).ok, true);
});
await check("explicit preexisting native profile binds a complete plan and request", () => {
  const bundle = withPreexistingNativeProfile();
  const before = JSON.stringify(bundle);
  assert.deepEqual(validateAgentExecutionBindings(bundle), { ok: true, issues: [] });
  assert.equal(JSON.stringify(bundle), before);
  assert.notEqual(bundle.plan.plan_sha256, fixture.expected.plan_sha256);
  assert.notEqual(fingerprintAgentExecutionValue(bundle.request), fixture.expected.request_sha256);
  const normalized = normalizeAgentExecutionPlan(bundle.plan);
  assert.deepEqual(normalized.execution.native_profile, bundle.request.execution.native_profile);
  assert.equal(Object.isFrozen(normalized.execution.native_profile), true);
});
await check("native profile policy digest changes invalidate the frozen plan", () => {
  const bundle = withPreexistingNativeProfile();
  const originalHash = bundle.plan.plan_sha256;
  bundle.plan.execution.native_profile.policy_sha256 = "b".repeat(64);
  expectIssue(validateAgentExecutionContract("plan", bundle.plan), "PLAN_FINGERPRINT_MISMATCH");
  assert.notEqual(fingerprintAgentExecutionPlan(bundle.plan), originalHash);
});
await check("a foreign native profile policy cannot replace the request configuration", () => {
  const bundle = withPreexistingNativeProfile();
  bundle.request.execution.native_profile.policy_sha256 = "b".repeat(64);
  bundle.result.request_sha256 = fingerprintAgentExecutionValue(bundle.request);
  bundle.acceptance.result_sha256 = fingerprintAgentExecutionValue(bundle.result);
  expectIssue(validateAgentExecutionBindings(bundle), "EXECUTION_CONFIG_MISMATCH");
});
await check("a native profile cannot be silently removed from the request", () => {
  const bundle = withPreexistingNativeProfile();
  delete bundle.request.execution.native_profile;
  bundle.result.request_sha256 = fingerprintAgentExecutionValue(bundle.request);
  bundle.acceptance.result_sha256 = fingerprintAgentExecutionValue(bundle.result);
  expectIssue(validateAgentExecutionBindings(bundle), "EXECUTION_CONFIG_MISMATCH");
});
await rejectBindings("a native profile cannot be silently added to a legacy request", (bundle) => {
  bundle.request.execution.native_profile = { mode: "preexisting", policy_sha256: "a".repeat(64) };
}, "EXECUTION_CONFIG_MISMATCH");
for (const [name, nativeProfile] of [
  ["missing mode", { policy_sha256: "a".repeat(64) }],
  ["missing policy digest", { mode: "preexisting" }],
  ["unrecognized mode", { mode: "automatic", policy_sha256: "a".repeat(64) }],
  ["short policy digest", { mode: "preexisting", policy_sha256: "a".repeat(63) }],
  ["non-hex policy digest", { mode: "preexisting", policy_sha256: "g".repeat(64) }],
  ["profile path", { mode: "preexisting", policy_sha256: "a".repeat(64), path: "/private/profile" }],
  ["authentication data", { mode: "preexisting", policy_sha256: "a".repeat(64), token: "fixture-not-a-secret" }],
  ["null", null],
  ["array", []],
]) {
  for (const kind of ["plan", "request"]) {
    await rejectContract(`${kind} refuses native profile ${name}`, kind, (value) => { value.execution.native_profile = copy(nativeProfile); }, "SCHEMA_INVALID");
  }
}
await check("fixed canonical JSON and SHA-256 vectors", () => {
  assert.equal(createHash("sha256").update(fixture.expected.canonical_plan_json, "utf8").digest("hex"), fixture.expected.plan_sha256);
  assert.equal(fingerprintAgentExecutionPlan(fixture.plan), fixture.expected.plan_sha256);
  assert.equal(fingerprintTaskContract(fixture.plan.tasks[0]), fixture.expected.task_contract_sha256);
  assert.equal(fingerprintAgentExecutionValue(fixture.delegation), fixture.expected.delegation_sha256);
  assert.equal(fingerprintAgentExecutionValue(fixture.request), fixture.expected.request_sha256);
  assert.equal(fingerprintAgentExecutionValue(fixture.result), fixture.expected.result_sha256);
});
await check("canonical key order is stable and array order is material", () => {
  function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
    return value;
  }
  assert.equal(fingerprintAgentExecutionPlan(reverseKeys(fixture.plan)), fixture.expected.plan_sha256);
  const changed = copy(fixture.plan);
  delete changed.plan_sha256;
  changed.tasks.reverse();
  assert.notEqual(fingerprintAgentExecutionPlan(changed), fixture.expected.plan_sha256);
});
await check("default concurrency yields a detached deeply frozen normalized plan", () => {
  const source = copy(fixture.plan);
  delete source.limits.concurrency;
  delete source.plan_sha256;
  const before = JSON.stringify(source);
  const normalized = normalizeAgentExecutionPlan(source);
  assert.equal(normalized.limits.concurrency, 1);
  assert.equal(normalized.plan_sha256, fixture.expected.plan_sha256);
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(normalized.tasks, source.tasks);
  function frozen(value) {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(frozen);
  }
  frozen(normalized);
  assert.throws(() => { normalized.tasks[0].objective = "changed"; }, TypeError);
});
for (const [name, mutate] of [
  ["canonical task", (v) => { v.canonical.task_selector += " amended"; }],
  ["canonical content", (v) => { v.canonical.plan_sha256 = "f".repeat(64); }],
  ["planning revision", (v) => { v.canonical.planning_revision += 1; }],
  ["activation", (v) => { v.canonical.activation.revision += 1; }],
  ["base SHA", (v) => { v.base.sha = "3".repeat(40); }],
  ["scope", (v) => { v.canonical.scope.push({ path: "src/extra.mjs", operations: ["add"] }); }],
  ["model", (v) => { v.execution.model = "another-explicit-model"; }],
  ["effort", (v) => { v.execution.effort = "high"; }],
  ["engine", (v) => { v.execution.engine.sha256 = "f".repeat(64); }],
  ["duration", (v) => { v.limits.max_duration_ms += 1; }],
  ["concurrency", (v) => { v.limits.concurrency = 2; }],
  ["acceptance", (v) => { v.tasks[0].acceptance_criteria.push("Additional criterion"); }],
  ["validation", (v) => { v.validations[0].argv.push("--test-reporter=spec"); }],
  ["audit", (v) => { v.audit.criteria.push("Review all deletions"); }],
]) {
  await check(`fingerprint invalidates changed ${name}`, () => {
    const changed = copy(fixture.plan);
    mutate(changed);
    expectIssue(validateAgentExecutionContract("plan", changed), "PLAN_FINGERPRINT_MISMATCH");
    assert.notEqual(fingerprintAgentExecutionPlan(changed), fixture.expected.plan_sha256);
  });
}

for (const [name, mutate, code] of [
  ["duplicate task", (v) => { v.tasks.push(copy(v.tasks[0])); }, "DUPLICATE_TASK"],
  ["unknown predecessor", (v) => { v.tasks[0].depends_on = ["missing"]; }, "UNKNOWN_DEPENDENCY"],
  ["duplicate predecessor", (v) => { v.tasks[2].depends_on.push("alpha"); }, "DUPLICATE_DEPENDENCY"],
  ["self dependency", (v) => { v.tasks[0].depends_on = ["alpha"]; }, "DEPENDENCY_CYCLE"],
  ["indirect cycle", (v) => { v.tasks[0].depends_on = ["join"]; }, "DEPENDENCY_CYCLE"],
  ["task exceeds run duration", (v) => { v.tasks[0].max_duration_ms = v.limits.max_duration_ms + 1; }, "TASK_DURATION_EXCEEDS_RUN"],
  ["unlisted file", (v) => { v.tasks[0].scope[0].path = "src/unlisted.mjs"; }, "SCOPE_NOT_SUBSET"],
  ["unlisted operation", (v) => { v.tasks[0].scope[0].operations = ["delete"]; }, "SCOPE_NOT_SUBSET"],
  ["unordered writes overlap", (v) => { v.tasks[1].scope = copy(v.tasks[0].scope); }, "UNORDERED_SCOPE_OVERLAP"],
  ["unordered file and descendant collide", (v) => { const nested = { path: "src/alpha.mjs/child.mjs", operations: ["add"] }; v.canonical.scope.push(copy(nested)); v.tasks[1].scope = [nested]; }, "UNORDERED_SCOPE_OVERLAP"],
  ["duplicate canonical path", (v) => { v.canonical.scope.push(copy(v.canonical.scope[0])); }, "DUPLICATE_SCOPE_PATH"],
  ["Windows case alias", (v) => { v.canonical.scope.push({ path: "SRC/ALPHA.MJS", operations: ["update"] }); }, "DUPLICATE_SCOPE_PATH"],
  ["duplicate operation", (v) => { v.canonical.scope[0].operations.push("update"); }, "DUPLICATE_OPERATION"],
  ["move lacks destination", (v) => { v.canonical.scope[0].operations = ["move"]; }, "MOVE_REQUIRES_BOTH_PATHS"],
  ["move lacks source", (v) => { v.canonical.scope[0].operations = ["move-destination"]; }, "MOVE_REQUIRES_BOTH_PATHS"],
  ["duplicate validation ID", (v) => { v.validations.push(copy(v.validations[0])); }, "DUPLICATE_VALIDATION"],
  ["legacy executor identity", (v) => { v.execution.executor_id = "codex"; }, "LEGACY_EXECUTOR_ID"],
  ["zero duration", (v) => { v.limits.max_duration_ms = 0; }, "SCHEMA_INVALID"],
  ["unsafe integer duration", (v) => { v.limits.max_duration_ms = Number.MAX_SAFE_INTEGER + 1; }, "SCHEMA_INVALID"],
  ["zero concurrency", (v) => { v.limits.concurrency = 0; }, "SCHEMA_INVALID"],
  ["over V1 concurrency", (v) => { v.limits.concurrency = 5; }, "SCHEMA_INVALID"],
  ["non-PostgreSQL authority", (v) => { v.authority_backend = "files"; }, "SCHEMA_INVALID"],
  ["missing model", (v) => { delete v.execution.model; }, "SCHEMA_INVALID"],
  ["unsafe sandbox", (v) => { v.execution.sandbox = "danger-full-access"; }, "SCHEMA_INVALID"],
  ["invalid base branch", (v) => { v.base.branch = "dev..topic"; }, "INVALID_BRANCH"],
]) await rejectContract(`plan refuses ${name}`, "plan", mutate, code);

for (const path of ["../outside.txt", "/absolute.txt", "src/./a.mjs", "src/../a.mjs", "src//a.mjs", "src/", "src\\a.mjs", "C:/a.mjs", "src/*.mjs", "src/a?.mjs", "src/a.mjs:stream", "src/a.mjs.", "src/a.mjs ", "src/CON.txt", "src/AUX", "src/COM1.txt", "src/LPT9.txt", "src/COM¹.txt", "src/LPT².txt", "src/PROGRA~1/a.mjs", "src/e\u0301.mjs", "src/line\nfeed.mjs"]) {
  await rejectContract(`exact path refuses ${JSON.stringify(path)}`, "plan", (v) => { v.canonical.scope[0].path = path; }, "INVALID_SCOPE_PATH");
}
for (const path of ["AGENTS.md", "nested/AGENTS.override.md", ".git/config", "nested/.git/config", ".aidn/config.json", ".codex/config.toml", ".agents/skills/policy.md", "docs/audit/sessions/S001.md", ".aidn/planning/session-plan.md"]) {
  await rejectContract(`scope protects ${path}`, "plan", (v) => { v.canonical.scope[0].path = path; }, "PROTECTED_SCOPE_PATH");
}
for (const path of ["docs/audit/notes/note.md", "docs/audit/parking-lot.md"]) {
  await rejectContract(`no implicit scope exemption for ${path}`, "plan", (v) => { v.tasks[0].scope[0].path = path; }, "SCOPE_NOT_SUBSET");
}
await check("ordered overlap is allowed, including transitive predecessors", () => {
  const value = copy(fixture.plan);
  delete value.plan_sha256;
  value.tasks[1].depends_on = ["alpha"];
  value.tasks[1].scope = copy(value.tasks[0].scope);
  value.tasks[2].depends_on = ["beta"];
  value.tasks[2].scope = copy(value.tasks[0].scope);
  assert.equal(validateAgentExecutionContract("plan", value).ok, true);
});
await check("move has explicit distinct source and destination rights", () => {
  const value = copy(fixture.plan);
  delete value.plan_sha256;
  const scope = [{ path: "src/before.mjs", operations: ["move"] }, { path: "src/after.mjs", operations: ["move-destination"] }];
  value.canonical.scope.push(...copy(scope));
  value.tasks[0].scope = scope;
  assert.equal(validateAgentExecutionContract("plan", value).ok, true);
});
await rejectContract("move roles on one path do not describe two endpoints", "plan", (v) => { v.canonical.scope[0].operations = ["move", "move-destination"]; }, "MOVE_REQUIRES_BOTH_PATHS");
for (const loneRole of ["move", "move-destination"]) {
  await rejectContract(`move pairing is checked for every ${loneRole} endpoint`, "plan", (v) => {
    v.canonical.scope.push({ path: "src/move-a.mjs", operations: ["move", "move-destination"] }, { path: "src/move-b.mjs", operations: [loneRole] });
  }, "MOVE_REQUIRES_BOTH_PATHS");
}
for (const cwd of ["relative/path", "C:relative", "C:\\fixture\\..\\sibling", "//server/share", "C:\\fixture\\NUL", "/tmp/../other"]) {
  await rejectContract(`cwd refuses ${JSON.stringify(cwd)}`, "request", (v) => { v.cwd = cwd; }, "ABSOLUTE_CWD_REQUIRED");
}
await check("absolute POSIX cwd and Windows cwd with spaces and accents", () => {
  const value = copy(fixture.request);
  value.cwd = "/tmp/fixture espace été/alpha";
  assert.equal(validateAgentExecutionContract("request", value).ok, true);
  assert.equal(validateAgentExecutionContract("request", fixture.request).ok, true);
});
await rejectContract("worker cannot select dev branch", "attempt", (v) => { v.worktree.branch = "dev"; }, "INVALID_WORKER_BRANCH");
await rejectContract("descriptor cannot reuse legacy codex ID", "descriptor", (v) => { v.executor_id = "codex"; }, "LEGACY_EXECUTOR_ID");
await rejectContract("event output is bounded", "event", (v) => { v.message = "x".repeat(4097); }, "SCHEMA_INVALID");
await rejectContract("unknown descendants force indeterminate result", "result", (v) => { v.termination_state = "unknown"; }, "INDETERMINATE_TERMINATION_REQUIRED");
await rejectContract("completion requires zero exit code", "result", (v) => { v.process.exit_code = 1; }, "INVALID_COMPLETED_RESULT");
await rejectContract("completion cannot retain a terminating signal", "result", (v) => { v.process.signal = "SIGTERM"; }, "INVALID_COMPLETED_RESULT");
await rejectContract("not-started process cannot have observed exit", "result", (v) => { v.outcome = "failed"; v.termination_state = "not_started"; }, "PROCESS_NOT_STARTED");
await rejectContract("worker result cannot claim acceptance", "result", (v) => { v.decision = "accepted"; }, "SCHEMA_INVALID");
await rejectContract("local evidence cannot escape its evidence root", "result", (v) => { v.evidence[0].ref = "../other/transcript.jsonl"; }, "INVALID_EVIDENCE_REF");
await rejectContract("exit zero cannot replace validation", "acceptance", (v) => { v.validation = { status: "not_run", tested_sha: null, checks: [] }; }, "ACCEPTANCE_REQUIRES_VALIDATION");
await rejectContract("validation proof must match candidate SHA", "acceptance", (v) => { v.validation.tested_sha = "3".repeat(40); }, "VALIDATION_SHA_MISMATCH");
await rejectContract("each validation check matches candidate SHA", "acceptance", (v) => { v.validation.checks[0].tested_sha = "3".repeat(40); }, "VALIDATION_SHA_MISMATCH");
await rejectContract("passed validation requires checks", "acceptance", (v) => { v.validation.checks = []; }, "INVALID_PASSED_VALIDATION");
await rejectContract("passed validation cannot hide failed check", "acceptance", (v) => { v.validation.checks[0].status = "failed"; }, "INVALID_PASSED_VALIDATION");
await rejectContract("integration requires resulting SHA", "acceptance", (v) => { v.integration.status = "integrated"; }, "INVALID_INTEGRATION_PROOF");
await rejectContract("pending integration cannot claim integrated SHA", "acceptance", (v) => { v.integration.integrated_sha = "3".repeat(40); }, "INVALID_INTEGRATION_PROOF");
await rejectContract("verified cleanup requires independent proof", "acceptance", (v) => { v.cleanup.status = "verified"; }, "CLEANUP_EVIDENCE_REQUIRED");

for (const [name, mutate, code] of [
  ["missing context", (v) => { delete v.run; }, "BINDING_CONTEXT_REQUIRED"],
  ["foreign run", (v) => { v.request.run_id = "run.foreign"; }, "RUN_BINDING_MISMATCH"],
  ["foreign task", (v) => { v.request.task_id = "beta"; }, "TASK_BINDING_MISMATCH"],
  ["foreign attempt", (v) => { v.result.attempt_id = "attempt.alpha.previous"; }, "ATTEMPT_BINDING_MISMATCH"],
  ["old plan fingerprint", (v) => { v.result.plan_sha256 = "f".repeat(64); }, "PLAN_BINDING_MISMATCH"],
  ["old input SHA", (v) => { v.result.input_sha = "3".repeat(40); }, "INPUT_SHA_MISMATCH"],
  ["canonical context changed", (v) => { v.run.canonical.planning_revision += 1; }, "RUN_CONTEXT_MISMATCH"],
  ["run task set changed", (v) => { v.run.task_ids.pop(); }, "RUN_TASKS_MISMATCH"],
  ["wrong worktree", (v) => { v.request.cwd = "C:\\fixture espace été\\other"; }, "WORKTREE_BINDING_MISMATCH"],
  ["joint worker branch change invalidates the issued delegation", (v) => { v.attempt.worktree.branch = "codex/other-worker"; v.delegation.worktree.branch = "codex/other-worker"; }, "DELEGATION_BINDING_MISMATCH"],
  ["joint worktree identity change invalidates the issued delegation", (v) => { v.attempt.worktree.worktree_id = "worktree.other"; v.delegation.worktree.worktree_id = "worktree.other"; }, "DELEGATION_BINDING_MISMATCH"],
  ["copied activation", (v) => { v.delegation.activation.authority_id = "authority.other"; }, "ACTIVATION_BINDING_MISMATCH"],
  ["old generation", (v) => { v.delegation.ownership.generation -= 1; }, "OWNERSHIP_BINDING_MISMATCH"],
  ["new ownership cannot admit an earlier result", (v) => { v.attempt.ownership.generation += 1; v.delegation.ownership.generation += 1; }, "OWNERSHIP_BINDING_MISMATCH"],
  ["different lease", (v) => { v.delegation.ownership.lease_id = "lease.other"; }, "OWNERSHIP_BINDING_MISMATCH"],
  ["different owner", (v) => { v.delegation.ownership.owner_id = "owner.other"; }, "OWNERSHIP_BINDING_MISMATCH"],
  ["planning revision changed", (v) => { v.attempt.ownership.planning_revision += 1; v.delegation.ownership.planning_revision += 1; }, "OWNERSHIP_BINDING_MISMATCH"],
  ["scope widened", (v) => { v.delegation.scope.push({ path: "src/other.mjs", operations: ["add"] }); }, "DELEGATION_SCOPE_MISMATCH"],
  ["wrong delegation", (v) => { v.request.delegation_id = "delegation.other"; }, "DELEGATION_BINDING_MISMATCH"],
  ["silent model fallback", (v) => { v.request.execution.model = "fallback-model"; }, "EXECUTION_CONFIG_MISMATCH"],
  ["silent duration increase", (v) => { v.request.limits.max_duration_ms += 1; }, "EXECUTION_CONFIG_MISMATCH"],
  ["result digest mismatch", (v) => { v.acceptance.result_sha256 = "f".repeat(64); }, "RESULT_BINDING_MISMATCH"],
  ["result came from a different request", (v) => { v.result.request_sha256 = "f".repeat(64); }, "REQUEST_BINDING_MISMATCH"],
  ["result came from a different delegation", (v) => { v.result.delegation_id = "delegation.other"; }, "DELEGATION_BINDING_MISMATCH"],
  ["acceptance without result", (v) => { delete v.result; }, "RESULT_BINDING_MISMATCH"],
  ["different validation set", (v) => { v.acceptance.validation.checks[0].validation_id = "unplanned-check"; }, "VALIDATION_SET_MISMATCH"],
  ["attempt still running", (v) => { v.attempt.lifecycle_status = "running"; }, "ATTEMPT_RESULT_STATUS_MISMATCH"],
  ["foreign event", (v) => { v.events[0].attempt_id = "attempt.other"; }, "EVENT_BINDING_MISMATCH"],
  ["event sequence gap", (v) => { v.events[0].sequence = 2; }, "EVENT_SEQUENCE_MISMATCH"],
  ["duplicate event identity", (v) => { v.events.push({ ...copy(v.events[0]), sequence: 2 }); }, "EVENT_SEQUENCE_MISMATCH"],
  ["invalid event stream", (v) => { v.events = {}; }, "INVALID_EVENT_STREAM"],
]) await rejectBindings(`bindings refuse ${name}`, mutate, code);
await rejectBindings("indeterminate execution cannot be accepted", (v) => {
  v.result.outcome = "indeterminate";
  v.result.termination_state = "unknown";
  v.attempt.lifecycle_status = "recovery_required";
  v.acceptance.result_sha256 = fingerprintAgentExecutionValue(v.result);
}, "ACCEPTANCE_REQUIRES_COMPLETION");
await check("status axes remain separate after worker completion", () => {
  assert.equal(fixture.result.outcome, "completed");
  assert.equal(fixture.acceptance.validation.status, "passed");
  assert.equal(fixture.acceptance.integration.status, "pending");
  assert.equal(fixture.acceptance.cleanup.status, "pending");
  assert.equal(validateAgentExecutionBindings(fixture).ok, true);
});
await check("unknown contracts and assertion errors have precise codes", () => {
  expectIssue(validateAgentExecutionContract("not-a-contract", {}), "UNKNOWN_CONTRACT");
  assert.throws(() => assertAgentExecutionContract("request", {}), (error) => error instanceof TypeError && error.code === "SCHEMA_INVALID");
});
await check("non-JSON inputs cannot invoke getters or hide non-finite values", () => {
  let reads = 0;
  const accessor = { get plan_id() { reads += 1; return "side-effect"; } };
  const cyclic = {}; cyclic.self = cyclic;
  const sparse = new Array(2);
  for (const value of [accessor, cyclic, sparse, { number: NaN }, { number: Infinity }, { value: undefined }, { callback() {} }, new Date(), { [Symbol("authority")]: 1 }]) {
    expectIssue(validateAgentExecutionContract("plan", value), "INVALID_JSON");
  }
  assert.equal(reads, 0);
});
await check("validator profiles retain default CLI namespace and strict keywords", () => {
  const internal = JSON.parse(readFileSync(new URL("plan.v1.schema.json", schemaRoot), "utf8"));
  assert.ok(validateJsonSchemaDefinition(internal).some((issue) => issue.includes("CLI-output contract URI")));
  const cli = { $schema: "http://json-schema.org/draft-07/schema#", $id: "aidn://contracts/cli-output/fixture.v1.schema.json", type: "object", required: ["ok"], properties: { ok: { const: true } }, additionalProperties: false };
  assert.deepEqual(validateJsonSchema({ ok: true }, cli), []);
  assert.ok(validateJsonSchema({ ok: false }, cli).length > 0);
  assert.ok(validateJsonSchemaDefinition(cli, "#", profile).length > 0);
  for (const [schema, options] of [[internal, profile], [cli, {}]]) {
    schema.properties.extra = { type: "array", uniqueItems: true };
    assert.ok(validateJsonSchemaDefinition(schema, "#", options).some((issue) => issue.includes("unsupported schema keyword")));
  }
});
await check("legacy AgentAdapter remains synchronous with its historical shape", () => {
  const legacy = {
    getProfile() { return buildAgentProfile({ id: "fixture-legacy" }); },
    canHandleRole() { return true; },
    runCommand() { return { status: 0, stdout: "legacy", stderr: "" }; },
  };
  assert.equal(assertAgentAdapter(legacy), legacy);
  assert.deepEqual(legacy.runCommand(), { status: 0, stdout: "legacy", stderr: "" });
  assert.equal(typeof legacy.runCommand().then, "undefined");
  assert.equal(Object.hasOwn(legacy, "runTask"), false);
});
await check("executor conformance checks", async () => {
  const results = await runAgentTaskExecutorConformanceChecks();
  assert.equal(results.length, 11);
  assert.ok(results.every((entry) => entry.status === "PASS"));
  checks.push(...results.map((entry) => ({ ...entry, name: `executor: ${entry.name}` })));
});
await check("import, discovery and validation have no state reads, process, network or write effects", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("agent-execution-purity-probe.mjs", import.meta.url))], { encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, String(result.stderr).slice(-1800));
  assert.deepEqual(JSON.parse(result.stdout), { status: "PASS", effects: [], probes: 0, tasks: 0 });
});

function selectedValidationBundle(selection) {
  const bundle = copy(fixture);
  bundle.plan.validations.push({ validation_id: "future-integration", argv: ["node", "--test", "tests/future.test.mjs"] });
  if (selection) {
    bundle.plan.tasks[0].validation_ids = [...selection];
    bundle.task.validation_ids = [...selection];
  }
  delete bundle.plan.plan_sha256;
  bundle.plan.plan_sha256 = fingerprintAgentExecutionPlan(bundle.plan);
  const taskHash = fingerprintTaskContract(bundle.plan.tasks[0]);
  for (const kind of ["run", "task", "attempt", "delegation", "request", "result", "acceptance"]) {
    bundle[kind].plan_sha256 = bundle.plan.plan_sha256;
    if (kind !== "run") bundle[kind].task_contract_sha256 = taskHash;
  }
  for (const event of bundle.events) event.plan_sha256 = bundle.plan.plan_sha256;
  bundle.request.delegation_sha256 = fingerprintAgentExecutionValue(bundle.delegation);
  bundle.result.request_sha256 = fingerprintAgentExecutionValue(bundle.request);
  bundle.acceptance.result_sha256 = fingerprintAgentExecutionValue(bundle.result);
  return bundle;
}
await check("explicit task validation avoids a future dependent validation", () => {
  const bundle = selectedValidationBundle(["unit"]);
  const before = JSON.stringify(bundle);
  assert.deepEqual(validateAgentExecutionBindings(bundle), { ok: true, issues: [] });
  assert.equal(JSON.stringify(bundle), before);
  const ids = taskValidationIds(bundle.plan, bundle.task); ids.push("local-only");
  assert.deepEqual(bundle.task.validation_ids, ["unit"]);
});
await check("omitted selection retains all historical plan validations", () => {
  const bundle = selectedValidationBundle();
  expectIssue(validateAgentExecutionBindings(bundle), "VALIDATION_SET_MISMATCH");
  assert.deepEqual(taskValidationIds(bundle.plan, bundle.task), ["unit", "future-integration"]);
});
await check("selection changes both frozen plan and task fingerprints", () => {
  const explicit = selectedValidationBundle(["unit"]), omitted = selectedValidationBundle();
  assert.notEqual(explicit.plan.plan_sha256, omitted.plan.plan_sha256);
  assert.notEqual(explicit.task.task_contract_sha256, omitted.task.task_contract_sha256);
});
await check("task cannot replace its planned validation selection", () => {
  const bundle = selectedValidationBundle(["unit"]);
  delete bundle.task.validation_ids;
  bundle.task.task_contract_sha256 = fingerprintTaskContract(bundle.task);
  expectIssue(validateAgentExecutionBindings(bundle), "TASK_CONTRACT_MISMATCH");
});
await rejectContract("unknown task validation is refused", "plan", value => { value.tasks[0].validation_ids = ["missing"]; }, "UNKNOWN_TASK_VALIDATION");
await rejectContract("duplicate task validation is refused", "plan", value => { value.tasks[0].validation_ids = ["unit", "unit"]; }, "DUPLICATE_TASK_VALIDATION");
await rejectContract("empty task selection cannot avoid validation", "plan", value => { value.tasks[0].validation_ids = []; }, "SCHEMA_INVALID");

await rejectContract("integration cannot advance an integration branch outside codex", "integration-prepared", value => { value.ref = "refs/heads/dev"; }, "INVALID_INTEGRATION_REF");
await rejectContract("integration rejects malformed refs", "integration-prepared", value => { value.ref = "refs/heads/codex/../dev"; }, "INVALID_INTEGRATION_REF");
await rejectContract("integration cannot mix Git object formats", "integration-prepared", value => { value.result_sha = "3".repeat(64); }, "GIT_OBJECT_FORMAT_MISMATCH");
await rejectContract("integration result must be a distinct commit", "integration-prepared", value => { value.result_sha = value.parent_sha; }, "INTEGRATION_RESULT_REQUIRES_COMMIT");
await rejectContract("integration evidence cannot traverse", "integration-applied", value => { value.evidence[0].ref = "../outside.json"; }, "INVALID_EVIDENCE_REF");
await rejectContract("final validations must target the integrated SHA", "run-validation", value => { value.checks[0].tested_sha = "9".repeat(40); }, "VALIDATION_SHA_MISMATCH");
await rejectContract("final audit must target the integrated SHA", "run-validation", value => { value.audit.tested_sha = "9".repeat(40); }, "VALIDATION_SHA_MISMATCH");
await rejectContract("final audit cannot skip a criterion index", "run-validation", value => { value.audit.checks[0].criterion_index = 1; }, "AUDIT_CRITERIA_INVALID");
await rejectContract("final audit cannot hide unavailability behind passed", "run-validation", value => { value.audit.checks[0].status = "unavailable"; }, "INVALID_PASSED_VALIDATION");
await rejectContract("final checks cannot hide failure behind passed", "run-validation", value => { value.checks[0].status = "failed"; }, "INVALID_PASSED_VALIDATION");
await check("final validation is bound to full plan and exact integration", () => {
  const args={plan:fixture.plan,run:fixture.run,validation:fixture["run-validation"],integratedSha:"6".repeat(40),integrationSequence:3};
  const before=JSON.stringify(args);
  assert.deepEqual(validateAgentRunValidationBindings(args),{ok:true,issues:[]});
  assert.equal(JSON.stringify(args),before);
  expectIssue(validateAgentRunValidationBindings({...args,integratedSha:"9".repeat(40)}),"INTEGRATION_BINDING_MISMATCH");
  expectIssue(validateAgentRunValidationBindings({...args,integrationSequence:4}),"INTEGRATION_BINDING_MISMATCH");
});
await check("task subset cannot omit final run validations or audit criteria", () => {
  const bundle=selectedValidationBundle(["unit"]),validation=copy(fixture["run-validation"]);
  validation.plan_sha256=bundle.plan.plan_sha256;
  expectIssue(validateAgentRunValidationBindings({plan:bundle.plan,run:bundle.run,validation,integratedSha:validation.integrated_sha,integrationSequence:3}),"VALIDATION_SET_MISMATCH");
  const plan=copy(fixture.plan);delete plan.plan_sha256;plan.audit.criteria.push("Another criterion");plan.plan_sha256=fingerprintAgentExecutionPlan(plan);
  const run={...fixture.run,plan_sha256:plan.plan_sha256};validation.plan_sha256=plan.plan_sha256;
  expectIssue(validateAgentRunValidationBindings({plan,run,validation,integratedSha:validation.integrated_sha,integrationSequence:3}),"AUDIT_SET_MISMATCH");
});
await check("final binding rejects non-JSON inputs without invoking accessors", () => {
  let reads=0;
  expectIssue(validateAgentRunValidationBindings({get plan(){reads++;return fixture.plan;}}),"INVALID_JSON");
  expectIssue(validateAgentRunValidationBindings(null),"BINDING_CONTEXT_REQUIRED");
  assert.equal(reads,0);
});

const failed = checks.filter((entry) => entry.status === "FAIL");
console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", checks, summary: { passed: checks.length - failed.length, failed: failed.length, skipped: 0 }, evidence_scope: "Pure model contracts and in-memory executor protocol only; no PostgreSQL, Codex, native isolation or real parallelism qualification." }, null, 2));
if (failed.length) process.exitCode = 1;
