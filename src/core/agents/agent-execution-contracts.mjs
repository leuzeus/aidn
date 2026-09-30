import { createHash } from "node:crypto";
import { isExcludedAgentPath } from "./agent-local-path-policy.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import descriptor from "../contracts/agent-execution/descriptor.v1.schema.json" with { type: "json" };
import availability from "../contracts/agent-execution/availability.v1.schema.json" with { type: "json" };
import plan from "../contracts/agent-execution/plan.v1.schema.json" with { type: "json" };
import cooperativePlan from "../contracts/agent-execution/plan.v2.schema.json" with { type: "json" };
import networkUnassuredPlan from "../contracts/agent-execution/plan.v3.schema.json" with { type: "json" };
import run from "../contracts/agent-execution/run.v1.schema.json" with { type: "json" };
import task from "../contracts/agent-execution/task.v1.schema.json" with { type: "json" };
import attempt from "../contracts/agent-execution/attempt.v1.schema.json" with { type: "json" };
import delegation from "../contracts/agent-execution/delegation.v1.schema.json" with { type: "json" };
import request from "../contracts/agent-execution/request.v1.schema.json" with { type: "json" };
import event from "../contracts/agent-execution/event.v1.schema.json" with { type: "json" };
import result from "../contracts/agent-execution/result.v1.schema.json" with { type: "json" };
import acceptance from "../contracts/agent-execution/acceptance.v1.schema.json" with { type: "json" };
import supervisor from "../contracts/agent-execution/supervisor.v1.schema.json" with { type: "json" };
import integrationIntent from "../contracts/agent-execution/integration-intent.v1.schema.json" with { type: "json" };
import integrationPrepared from "../contracts/agent-execution/integration-prepared.v1.schema.json" with { type: "json" };
import integrationApplied from "../contracts/agent-execution/integration-applied.v1.schema.json" with { type: "json" };
import runValidation from "../contracts/agent-execution/run-validation.v1.schema.json" with { type: "json" };

// Model only. These functions observe neither Git, configuration, leases nor files.
// Validating an ownership reference never proves that its lease exists or is live.
const SCHEMAS = freeze({ descriptor, availability, plan, run, task, attempt, delegation, request, event, result, acceptance,
  supervisor, "integration-intent": integrationIntent, "integration-prepared": integrationPrepared, "integration-applied": integrationApplied, "run-validation": runValidation });
const PLAN_SCHEMAS = freeze({ "agent-execution-plan.v1": plan, "agent-execution-plan.v2": cooperativePlan,
  "agent-execution-plan.v3": networkUnassuredPlan });
// Runtime scope keys are a separate namespace: retain historical internal IDs,
// and accept the exact bounded composite produced by the runtime resolver.
const RUNTIME_SCOPE = new RegExp(plan.properties.canonical.properties.runtime_scope_id.pattern);
const CANONICAL_RUNTIME_SCOPE = /^runtime:project=([A-Za-z0-9][A-Za-z0-9._:-]{0,127}):workspace=([A-Za-z0-9][A-Za-z0-9._:-]{0,127}):profile=([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/;
export function isAgentExecutionRuntimeScopeId(value) {
  return typeof value === "string" && value.length <= 512 && RUNTIME_SCOPE.test(value);
}
const TASK_FIELDS = ["task_id", "objective", "scope", "depends_on", "acceptance_criteria", "max_duration_ms"];
const DEVICE = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const issue = (code, path = "$", detail) => ({ code, path, ...(detail ? { detail } : {}) });
const report = (issues) => ({ ok: issues.length === 0, issues });
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const key = (value) => value.toLowerCase();

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Restrict to bounded JSON data, including rejecting getters and non-finite values.
function jsonIssues(value) {
  const issues = [], seen = new Set();
  let count = 0;
  function visit(item, location, depth) {
    if (++count > 100000 || depth > 32) { issues.push(issue("JSON_LIMIT", location)); return; }
    if (item === null || typeof item === "boolean" || typeof item === "string") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || (!Array.isArray(item)
      && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
      issues.push(issue("INVALID_JSON", location)); return;
    }
    if (seen.has(item)) { issues.push(issue("INVALID_JSON", location)); return; }
    if (Object.getOwnPropertySymbols(item).length) { issues.push(issue("INVALID_JSON", location)); return; }
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const [name, property] of Object.entries(descriptors)) {
      if (Array.isArray(item) && name === "length") continue;
      if (!("value" in property) || !property.enumerable
        || (Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(name))) {
        issues.push(issue("INVALID_JSON", `${location}.${name}`)); continue;
      }
      visit(property.value, `${location}.${name}`, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) issues.push(issue("INVALID_JSON", location));
    seen.delete(item);
  }
  visit(value, "$", 0);
  return issues;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function fingerprintAgentExecutionValue(value) {
  const issues = jsonIssues(value);
  if (issues.length) throw contractError(issues[0]);
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function planContent(value) {
  const { plan_sha256: ignored, ...content } = value;
  return { ...content, limits: { ...value.limits, concurrency: value.limits.concurrency ?? 1 } };
}

export function fingerprintAgentExecutionPlan(value) {
  const checked = validateContract("plan", value, false);
  if (!checked.ok) throw contractError(checked.issues[0]);
  return fingerprintAgentExecutionValue(planContent(value));
}

export function fingerprintTaskContract(value) {
  const problems = jsonIssues(value);
  if (problems.length) throw contractError(problems[0]);
  const content = Object.fromEntries(TASK_FIELDS.map((field) => [field, value[field]]));
  if (Object.hasOwn(value, "validation_ids")) content.validation_ids = value.validation_ids;
  return fingerprintAgentExecutionValue(content);
}

// Omission retains the original v1 behavior. An explicit selection is frozen in
// both the task and plan fingerprints; final run validation still uses all IDs.
export function taskValidationIds(plan, task) {
  return [...(task.validation_ids ?? plan.validations.map(item => item.validation_id))];
}

export function normalizeAgentExecutionPlan(value) {
  assertAgentExecutionContract("plan", value);
  const normalized = structuredClone(planContent(value));
  normalized.plan_sha256 = fingerprintAgentExecutionValue(normalized);
  return freeze(normalized);
}

function contractError(problem) {
  const error = new TypeError(`${problem.code}: ${problem.path}${problem.detail ? `: ${problem.detail}` : ""}`);
  error.code = problem.code;
  return error;
}

export function assertAgentExecutionContract(kind, value) {
  const checked = validateAgentExecutionContract(kind, value);
  if (!checked.ok) throw contractError(checked.issues[0]);
  return value;
}

export function listAgentExecutionContractKinds() { return Object.keys(SCHEMAS); }

export function isExactExecutionPath(value) {
  if (typeof value !== "string" || !value || isExcludedAgentPath(value) || value !== value.normalize("NFC")
    || /[\\\x00-\x1f\x7f:<>"|?*~]/.test(value)) return false;
  return value.split("/").every((part) => part && part !== "." && part !== ".."
    && !/[. ]$/.test(part) && !DEVICE.test(part));
}

export function isAbsoluteExecutionCwd(value) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    const relative = value.slice(3).replaceAll("\\", "/");
    return isExactExecutionPath(relative);
  }
  return value.startsWith("/") && !value.startsWith("//") && isExactExecutionPath(value.slice(1));
}

function validBranch(value) {
  return typeof value === "string" && !/[\x00-\x20\x7f~^:?*\[\\]/.test(value)
    && !value.includes("..") && !value.includes("@{") && value !== "@"
    && !value.endsWith(".") && value.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}

function protectedPath(value, planRef) {
  const lower = key(value);
  if (planRef && lower === key(planRef)) return true;
  if (/(^|\/)agents(?:\.override)?\.md$/.test(lower)
    || /(^|\/)(?:\.git|\.aidn|\.codex|\.agents)(?:\/|$)/.test(lower)) return true;
  return lower.startsWith("docs/audit/")
    && !/^docs\/audit\/notes\/[^/]+\.md$/.test(lower)
    && lower !== "docs/audit/parking-lot.md";
}

function scopeIssues(scope, location, canonicalScope, planRef) {
  const issues = [], paths = new Set(), ops = new Set();
  for (const [index, entry] of scope.entries()) {
    const current = `${location}[${index}]`;
    if (!isExactExecutionPath(entry.path)) issues.push(issue("INVALID_SCOPE_PATH", current));
    if (protectedPath(entry.path, planRef)) issues.push(issue("PROTECTED_SCOPE_PATH", current));
    if (paths.has(key(entry.path))) issues.push(issue("DUPLICATE_SCOPE_PATH", current));
    paths.add(key(entry.path));
    if (new Set(entry.operations).size !== entry.operations.length) issues.push(issue("DUPLICATE_OPERATION", current));
    entry.operations.forEach((op) => ops.add(op));
    if (canonicalScope && !canonicalScope.some((allowed) => allowed.path === entry.path
      && entry.operations.every((op) => allowed.operations.includes(op)))) issues.push(issue("SCOPE_NOT_SUBSET", current));
  }
  if (ops.has("move") !== ops.has("move-destination") || scope.some((entry) =>
    (entry.operations.includes("move") && !scope.some((other) =>
      other.operations.includes("move-destination") && key(entry.path) !== key(other.path)))
    || (entry.operations.includes("move-destination") && !scope.some((other) =>
      other.operations.includes("move") && key(entry.path) !== key(other.path))))) {
    issues.push(issue("MOVE_REQUIRES_BOTH_PATHS", location));
  }
  return issues;
}

function planIssues(value, checkFingerprint) {
  const issues = scopeIssues(value.canonical.scope, "$.canonical.scope", null, value.canonical.plan_ref);
  if (!isExactExecutionPath(value.canonical.plan_ref)) issues.push(issue("INVALID_PLAN_REF", "$.canonical.plan_ref"));
  if (!validBranch(value.base.branch)) issues.push(issue("INVALID_BRANCH", "$.base.branch"));
  const tasks = new Map(value.tasks.map((item) => [item.task_id, item]));
  if (tasks.size !== value.tasks.length) issues.push(issue("DUPLICATE_TASK", "$.tasks"));
  const validations = value.validations.map((item) => item.validation_id);
  if (new Set(validations).size !== validations.length) issues.push(issue("DUPLICATE_VALIDATION", "$.validations"));
  for (const item of value.tasks) {
    const location = `$.tasks.${item.task_id}`;
    issues.push(...scopeIssues(item.scope, `${location}.scope`, value.canonical.scope, value.canonical.plan_ref));
    if (item.max_duration_ms > value.limits.max_duration_ms) issues.push(issue("TASK_DURATION_EXCEEDS_RUN", location));
    if (new Set(item.depends_on).size !== item.depends_on.length) issues.push(issue("DUPLICATE_DEPENDENCY", location));
    if (item.depends_on.some((dep) => !tasks.has(dep))) issues.push(issue("UNKNOWN_DEPENDENCY", location));
    if (item.validation_ids) {
      if (new Set(item.validation_ids).size !== item.validation_ids.length) issues.push(issue("DUPLICATE_TASK_VALIDATION", location));
      if (item.validation_ids.some(id => !validations.includes(id))) issues.push(issue("UNKNOWN_TASK_VALIDATION", location));
    }
  }
  const visiting = new Set(), visited = new Set(), ancestors = new Map();
  function walk(id) {
    if (visiting.has(id)) { issues.push(issue("DEPENDENCY_CYCLE", `$.tasks.${id}`)); return new Set(); }
    if (visited.has(id)) return ancestors.get(id);
    visiting.add(id);
    const parents = new Set();
    for (const dep of tasks.get(id).depends_on) {
      if (!tasks.has(dep)) continue;
      parents.add(dep);
      for (const ancestor of walk(dep)) parents.add(ancestor);
    }
    visiting.delete(id); visited.add(id); ancestors.set(id, parents);
    return parents;
  }
  for (const id of tasks.keys()) walk(id);
  const entries = [...tasks.values()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const left = entries[i], right = entries[j];
      if (ancestors.get(left.task_id).has(right.task_id) || ancestors.get(right.task_id).has(left.task_id)) continue;
      if (left.scope.some((a) => right.scope.some((b) => key(a.path) === key(b.path)
        || key(a.path).startsWith(`${key(b.path)}/`) || key(b.path).startsWith(`${key(a.path)}/`)))) {
        issues.push(issue("UNORDERED_SCOPE_OVERLAP", `$.tasks.${right.task_id}`));
      }
    }
  }
  if (value.verification) {
    const controls = new Set();
    for (const file of value.verification.control_files) {
      if (!isExactExecutionPath(file.path)) issues.push(issue("INVALID_VERIFICATION_PATH", "$.verification.control_files"));
      if (controls.has(key(file.path))) issues.push(issue("DUPLICATE_VERIFICATION_PATH", "$.verification.control_files"));
      controls.add(key(file.path));
      if (value.tasks.some(task => task.scope.some(entry => key(entry.path) === key(file.path)
          || key(entry.path).startsWith(key(file.path) + "/") || key(file.path).startsWith(key(entry.path) + "/")))) {
        issues.push(issue("VERIFICATION_CONTROL_DELEGATED", "$.verification.control_files"));
      }
    }
    if (value.verification.limits.max_duration_ms > value.limits.max_duration_ms) issues.push(issue("VERIFICATION_DURATION_EXCEEDS_RUN", "$.verification.limits"));
  }
  if (checkFingerprint && value.plan_sha256 && fingerprintAgentExecutionValue(planContent(value)) !== value.plan_sha256) {
    issues.push(issue("PLAN_FINGERPRINT_MISMATCH", "$.plan_sha256"));
  }
  return issues;
}

export function validateAgentExecutionContract(kind, value) {
  return validateContract(kind, value, true);
}

function validateContract(kind, value, checkFingerprint) {
  if (!Object.hasOwn(SCHEMAS, kind)) return report([issue("UNKNOWN_CONTRACT", "$", String(kind))]);
  const inputIssues = jsonIssues(value);
  if (inputIssues.length) return report(inputIssues);
  // Dispatch only after pure JSON inspection: selecting a version must never
  // invoke a getter. Unknown versions still fail the historical closed schema;
  // neither normalization nor validation converts an existing plan to another version.
  const schema = kind === "plan" && typeof value?.contract_version === "string" && Object.hasOwn(PLAN_SCHEMAS, value.contract_version)
    ? PLAN_SCHEMAS[value.contract_version] : SCHEMAS[kind];
  const structural = validateJsonSchema(value, schema, "$", { contractKind: "agent-execution" });
  if (structural.length) return report(structural.map((detail) => issue("SCHEMA_INVALID", "$", detail)));
  const issues = [];
  if (["descriptor", "availability"].includes(kind) && value.executor_id === "codex") issues.push(issue("LEGACY_EXECUTOR_ID", "$.executor_id"));
  if (value.execution?.executor_id === "codex") issues.push(issue("LEGACY_EXECUTOR_ID", "$.execution.executor_id"));
  if (["plan", "run"].includes(kind)) {
    const scope = CANONICAL_RUNTIME_SCOPE.exec(value.canonical.runtime_scope_id);
    if (scope && (scope[1] !== value.canonical.project_id || scope[2] !== value.canonical.workspace_id)) {
      issues.push(issue("RUNTIME_SCOPE_IDENTITY_MISMATCH", "$.canonical.runtime_scope_id"));
    }
  }
  if (kind === "plan") issues.push(...planIssues(value, checkFingerprint));
  if (kind === "run") {
    if (new Set(value.task_ids).size !== value.task_ids.length) issues.push(issue("DUPLICATE_TASK", "$.task_ids"));
    issues.push(...scopeIssues(value.canonical.scope, "$.canonical.scope", null, value.canonical.plan_ref));
    if (!isExactExecutionPath(value.canonical.plan_ref)) issues.push(issue("INVALID_PLAN_REF", "$.canonical.plan_ref"));
  }
  if (["task", "delegation"].includes(kind)) issues.push(...scopeIssues(value.scope, "$.scope"));
  if (kind === "task") {
    if (fingerprintTaskContract(value) !== value.task_contract_sha256) issues.push(issue("TASK_FINGERPRINT_MISMATCH", "$.task_contract_sha256"));
    if (new Set(value.depends_on).size !== value.depends_on.length || value.depends_on.includes(value.task_id)) issues.push(issue("INVALID_TASK_DEPENDENCY", "$.depends_on"));
    if (value.validation_ids && new Set(value.validation_ids).size !== value.validation_ids.length) issues.push(issue("DUPLICATE_TASK_VALIDATION", "$.validation_ids"));
  }
  if (["attempt", "delegation"].includes(kind)) {
    if (!isAbsoluteExecutionCwd(value.worktree.cwd)) issues.push(issue("ABSOLUTE_CWD_REQUIRED", "$.worktree.cwd"));
    if (!validBranch(value.worktree.branch) || !value.worktree.branch.startsWith("codex/")) issues.push(issue("INVALID_WORKER_BRANCH", "$.worktree.branch"));
  }
  if (kind === "request" && !isAbsoluteExecutionCwd(value.cwd)) issues.push(issue("ABSOLUTE_CWD_REQUIRED", "$.cwd"));
  for (const [i, proof] of (value.evidence ?? []).entries()) {
    if (!isExactExecutionPath(proof.ref)) issues.push(issue("INVALID_EVIDENCE_REF", `$.evidence[${i}].ref`));
  }
  if (kind === "result") {
    if ((value.termination_state === "unknown") !== (value.outcome === "indeterminate")) issues.push(issue("INDETERMINATE_TERMINATION_REQUIRED", "$.termination_state"));
    if (value.outcome === "completed" && (value.termination_state !== "confirmed" || value.process.exit_code !== 0 || value.process.signal !== null)) issues.push(issue("INVALID_COMPLETED_RESULT", "$.process"));
    if (value.termination_state === "not_started" && (value.process.exit_code !== null || value.process.signal !== null)) issues.push(issue("PROCESS_NOT_STARTED", "$.process"));
  }
  if (kind === "acceptance") {
    const { validation, integration, cleanup } = value;
    const ids = validation.checks.map((check) => check.validation_id);
    if (new Set(ids).size !== ids.length) issues.push(issue("DUPLICATE_VALIDATION", "$.validation.checks"));
    if (validation.tested_sha !== null && validation.tested_sha !== value.candidate_sha) issues.push(issue("VALIDATION_SHA_MISMATCH", "$.validation.tested_sha"));
    if (validation.checks.some((check) => check.tested_sha !== value.candidate_sha)) issues.push(issue("VALIDATION_SHA_MISMATCH", "$.validation.checks"));
    if (validation.status === "passed" && (!validation.checks.length || validation.tested_sha !== value.candidate_sha || validation.checks.some((check) => check.status !== "passed"))) issues.push(issue("INVALID_PASSED_VALIDATION", "$.validation"));
    if (value.decision === "accepted" && validation.status !== "passed") issues.push(issue("ACCEPTANCE_REQUIRES_VALIDATION", "$.decision"));
    if (integration.status === "integrated" && (value.decision !== "accepted" || integration.source_sha !== value.candidate_sha || integration.integrated_sha === null)) issues.push(issue("INVALID_INTEGRATION_PROOF", "$.integration"));
    if (integration.status !== "integrated" && integration.integrated_sha !== null) issues.push(issue("INVALID_INTEGRATION_PROOF", "$.integration"));
    if (cleanup.status === "verified" && !cleanup.evidence.length) issues.push(issue("CLEANUP_EVIDENCE_REQUIRED", "$.cleanup"));
    for (const proof of [...validation.checks.map((check) => check.evidence), ...cleanup.evidence]) {
      if (!isExactExecutionPath(proof.ref)) issues.push(issue("INVALID_EVIDENCE_REF", "$.validation"));
    }
  }
  if (["integration-intent", "integration-prepared"].includes(kind)) {
    if (kind === "integration-intent") {
      if (!isAbsoluteExecutionCwd(value.workspace.cwd)) issues.push(issue("ABSOLUTE_CWD_REQUIRED", "$.workspace.cwd"));
      if (!Number.isFinite(Date.parse(value.commit_identity.timestamp))) issues.push(issue("INVALID_COMMIT_TIMESTAMP", "$.commit_identity.timestamp"));
    }
    if (!value.ref.startsWith("refs/heads/codex/") || !validBranch(value.ref.slice("refs/heads/".length))) issues.push(issue("INVALID_INTEGRATION_REF", "$.ref"));
    if (new Set([value.source_sha.length, value.parent_sha.length, ...(value.result_sha ? [value.result_sha.length] : [])]).size !== 1) issues.push(issue("GIT_OBJECT_FORMAT_MISMATCH", "$"));
    if (kind === "integration-prepared" && value.result_sha === value.parent_sha) issues.push(issue("INTEGRATION_RESULT_REQUIRES_COMMIT", "$.result_sha"));
  }
  if (kind === "run-validation") {
    const ids = value.checks.map(check => check.validation_id);
    if (new Set(ids).size !== ids.length) issues.push(issue("DUPLICATE_VALIDATION", "$.checks"));
    if (value.audit.tested_sha !== value.integrated_sha || value.checks.some(check => check.tested_sha !== value.integrated_sha)) issues.push(issue("VALIDATION_SHA_MISMATCH", "$"));
    const indices = value.audit.checks.map(check => check.criterion_index).sort((a,b) => a-b);
    if (indices.some((index, position) => index !== position)) issues.push(issue("AUDIT_CRITERIA_INVALID", "$.audit.checks"));
    if (value.outcome === "passed" && [...value.checks, ...value.audit.checks].some(check => check.status !== "passed")) issues.push(issue("INVALID_PASSED_VALIDATION", "$"));
    for (const check of [...value.checks, ...value.audit.checks]) {
      if (!isExactExecutionPath(check.evidence.ref)) issues.push(issue("INVALID_EVIDENCE_REF", "$"));
    }
  }
  return report(issues);
}

// Pure binding only: callers must independently observe the canonical store
// and the Git reference. A caller-supplied SHA is not a Git observation.
export function validateAgentRunValidationBindings(value) {
  const inputIssues = jsonIssues(value);
  if (inputIssues.length) return report(inputIssues);
  if (!value || typeof value !== "object" || Array.isArray(value)) return report([issue("BINDING_CONTEXT_REQUIRED")]);
  const { plan, run, validation, integratedSha, integrationSequence } = value;
  const issues = [];
  for (const [kind, value] of [["plan",plan],["run",run],["run-validation",validation]]) {
    issues.push(...validateAgentExecutionContract(kind, value).issues);
  }
  if (issues.length) return report(issues);
  if (run.plan_id !== plan.plan_id || run.plan_sha256 !== fingerprintAgentExecutionPlan(plan)
      || !equal(run.canonical, plan.canonical) || !equal(run.task_ids, plan.tasks.map(task => task.task_id))) issues.push(issue("RUN_CONTEXT_MISMATCH", "$.run"));
  if (validation.run_id !== run.run_id || validation.plan_sha256 !== run.plan_sha256) issues.push(issue("RUN_BINDING_MISMATCH", "$.validation"));
  if (validation.integrated_sha !== integratedSha || validation.integration_sequence !== integrationSequence) issues.push(issue("INTEGRATION_BINDING_MISMATCH", "$.validation"));
  if (!equal(validation.checks.map(check => check.validation_id).sort(), plan.validations.map(check => check.validation_id).sort())) issues.push(issue("VALIDATION_SET_MISMATCH", "$.validation.checks"));
  if (validation.audit.checks.length !== plan.audit.criteria.length) issues.push(issue("AUDIT_SET_MISMATCH", "$.validation.audit"));
  return report(issues);
}

// A complete model bundle is required: isolated shape checks do not prove binding.
export function validateAgentExecutionBindings(bundle) {
  const inputIssues = jsonIssues(bundle);
  if (inputIssues.length) return report(inputIssues);
  const required = ["plan", "run", "task", "attempt", "delegation", "request"];
  if (!bundle || required.some((kind) => !Object.hasOwn(bundle, kind))) return report([issue("BINDING_CONTEXT_REQUIRED")]);
  const issues = [];
  for (const kind of [...required, "result", "acceptance"]) {
    if (!Object.hasOwn(bundle, kind)) continue;
    issues.push(...validateAgentExecutionContract(kind, bundle[kind]).issues.map((item) => ({ ...item, path: `$.${kind}${item.path.slice(1)}` })));
  }
  if (issues.length) return report(issues);
  const { plan, run, task, attempt, delegation, request, result, acceptance } = bundle;
  const planHash = fingerprintAgentExecutionPlan(plan);
  const plannedTask = plan.tasks.find((entry) => entry.task_id === task.task_id);
  const mismatch = (ok, code, path) => { if (!ok) issues.push(issue(code, path)); };
  mismatch(run.plan_id === plan.plan_id && equal(run.canonical, plan.canonical), "RUN_CONTEXT_MISMATCH", "$.run");
  mismatch(equal(run.task_ids, plan.tasks.map((item) => item.task_id)), "RUN_TASKS_MISMATCH", "$.run.task_ids");
  if (!plannedTask) return report([...issues, issue("TASK_NOT_IN_PLAN", "$.task.task_id")]);
  mismatch(TASK_FIELDS.every((field) => equal(task[field], plannedTask[field])), "TASK_CONTRACT_MISMATCH", "$.task");
  mismatch(Object.hasOwn(task, "validation_ids") === Object.hasOwn(plannedTask, "validation_ids")
    && equal(task.validation_ids ?? null, plannedTask.validation_ids ?? null), "TASK_CONTRACT_MISMATCH", "$.task.validation_ids");
  for (const [kind, value] of Object.entries({ run, task, attempt, delegation, request, ...(result ? { result } : {}), ...(acceptance ? { acceptance } : {}) })) {
    mismatch(value.plan_sha256 === planHash, "PLAN_BINDING_MISMATCH", `$.${kind}.plan_sha256`);
    mismatch(value.run_id === run.run_id, "RUN_BINDING_MISMATCH", `$.${kind}.run_id`);
    if (kind === "run") continue;
    mismatch(value.task_id === task.task_id, "TASK_BINDING_MISMATCH", `$.${kind}.task_id`);
    mismatch(value.task_contract_sha256 === task.task_contract_sha256, "TASK_BINDING_MISMATCH", `$.${kind}.task_contract_sha256`);
    if (kind === "task") continue;
    mismatch(value.attempt_id === attempt.attempt_id, "ATTEMPT_BINDING_MISMATCH", `$.${kind}.attempt_id`);
    mismatch(value.input_sha === attempt.input_sha, "INPUT_SHA_MISMATCH", `$.${kind}.input_sha`);
  }
  mismatch(equal(delegation.worktree, attempt.worktree) && request.cwd === attempt.worktree.cwd, "WORKTREE_BINDING_MISMATCH", "$.delegation.worktree");
  mismatch(equal(delegation.activation, attempt.activation) && equal(attempt.activation, plan.canonical.activation), "ACTIVATION_BINDING_MISMATCH", "$.attempt.activation");
  mismatch(equal(delegation.ownership, attempt.ownership) && equal(request.ownership, attempt.ownership)
    && (!result || equal(result.ownership, attempt.ownership))
    && attempt.ownership.planning_revision === plan.canonical.planning_revision, "OWNERSHIP_BINDING_MISMATCH", "$.delegation.ownership");
  mismatch(equal(delegation.scope, task.scope), "DELEGATION_SCOPE_MISMATCH", "$.delegation.scope");
  mismatch(request.delegation_id === delegation.delegation_id, "DELEGATION_BINDING_MISMATCH", "$.request.delegation_id");
  mismatch(request.delegation_sha256 === fingerprintAgentExecutionValue(delegation), "DELEGATION_BINDING_MISMATCH", "$.request.delegation_sha256");
  mismatch(equal(request.execution, plan.execution) && request.limits.max_duration_ms === task.max_duration_ms, "EXECUTION_CONFIG_MISMATCH", "$.request.execution");
  if (!plannedTask.depends_on.length) mismatch(attempt.input_sha === plan.base.sha, "INPUT_SHA_MISMATCH", "$.attempt.input_sha");
  if (result) {
    mismatch(result.request_sha256 === fingerprintAgentExecutionValue(request), "REQUEST_BINDING_MISMATCH", "$.result.request_sha256");
    mismatch(result.delegation_id === delegation.delegation_id, "DELEGATION_BINDING_MISMATCH", "$.result.delegation_id");
    const expected = result.outcome === "indeterminate" ? "recovery_required" : result.outcome;
    mismatch(attempt.lifecycle_status === expected, "ATTEMPT_RESULT_STATUS_MISMATCH", "$.attempt.lifecycle_status");
  }
  if (acceptance) {
    mismatch(Boolean(result) && fingerprintAgentExecutionValue(result) === acceptance.result_sha256, "RESULT_BINDING_MISMATCH", "$.acceptance.result_sha256");
    if (acceptance.decision === "accepted") {
      mismatch(result?.outcome === "completed" && result?.termination_state === "confirmed", "ACCEPTANCE_REQUIRES_COMPLETION", "$.acceptance.decision");
      const checks = acceptance.validation.checks.map((check) => check.validation_id).sort();
      mismatch(equal(checks, taskValidationIds(plan, task).sort()), "VALIDATION_SET_MISMATCH", "$.acceptance.validation.checks");
    }
  }
  if (bundle.events !== undefined) {
    if (!Array.isArray(bundle.events) || bundle.events.length > 10000) return report([...issues, issue("INVALID_EVENT_STREAM", "$.events")]);
    const ids = new Set();
    bundle.events.forEach((entry, index) => {
      const checked = validateAgentExecutionContract("event", entry);
      issues.push(...checked.issues);
      if (!checked.ok) return;
      mismatch(["run_id", "task_id", "attempt_id", "plan_sha256"].every((field) => entry[field] === attempt[field]), "EVENT_BINDING_MISMATCH", `$.events[${index}]`);
      mismatch(entry.sequence === index + 1 && !ids.has(entry.event_id), "EVENT_SEQUENCE_MISMATCH", `$.events[${index}]`);
      ids.add(entry.event_id);
    });
  }
  return report(issues);
}

// This binds intent to immutable model data; the store separately fences live authority.
export function validateAgentIntegrationIntentBindings(value) {
  const invalid = jsonIssues(value);
  if (invalid.length) return report(invalid);
  if (!value || typeof value !== "object" || Array.isArray(value)) return report([issue("BINDING_CONTEXT_REQUIRED")]);
  const { plan, run, intent, acceptance, integrationHead } = value;
  const issues = [];
  for (const [kind, data] of [["plan", plan], ["run", run], ["integration-intent", intent], ["acceptance", acceptance]]) {
    issues.push(...validateAgentExecutionContract(kind, data).issues);
  }
  if (issues.length) return report(issues);
  if (run.plan_id !== plan.plan_id || run.plan_sha256 !== fingerprintAgentExecutionPlan(plan)
      || !equal(run.canonical, plan.canonical) || !equal(run.task_ids, plan.tasks.map(task => task.task_id))) issues.push(issue("RUN_CONTEXT_MISMATCH", "$.run"));
  if (intent.run_id !== run.run_id || intent.plan_sha256 !== run.plan_sha256
      || acceptance.run_id !== run.run_id || acceptance.plan_sha256 !== run.plan_sha256) issues.push(issue("RUN_BINDING_MISMATCH", "$.intent"));
  const plannedTask = plan.tasks.find(task => task.task_id === intent.task_id);
  if (plannedTask && acceptance.task_contract_sha256 !== fingerprintTaskContract(plannedTask)) issues.push(issue("TASK_BINDING_MISMATCH", "$.acceptance.task_contract_sha256"));
  if (plannedTask && !equal(acceptance.validation.checks.map(check => check.validation_id).sort(), taskValidationIds(plan, plannedTask).sort())) issues.push(issue("VALIDATION_SET_MISMATCH", "$.acceptance.validation.checks"));
  if (!plannedTask || intent.task_id !== acceptance.task_id
      || intent.attempt_id !== acceptance.attempt_id) issues.push(issue("ATTEMPT_BINDING_MISMATCH", "$.intent"));
  if (acceptance.decision !== "accepted" || intent.acceptance_sha256 !== fingerprintAgentExecutionValue(acceptance)
      || intent.source_sha !== acceptance.candidate_sha) issues.push(issue("ACCEPTANCE_BINDING_MISMATCH", "$.intent"));
  if (!integrationHead || intent.repository_identity_sha256 !== integrationHead.repository_identity_sha256
      || intent.ref !== integrationHead.ref || intent.parent_sha !== integrationHead.sha
      || intent.sequence !== integrationHead.sequence + 1) issues.push(issue("INTEGRATION_BINDING_MISMATCH", "$.intent"));
  return report(issues);
}
