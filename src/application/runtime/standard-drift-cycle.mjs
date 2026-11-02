import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readAgentRunFile, agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { recoveryRuntimeBoundary, recoveryCycleBoundary } from "./standard-drift-recovery.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-drift-cycle-plan.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const refresh = "drift_recovery_context_refresh", checkpoint = "drift_recovery_checkpoint_observe", initialize = "drift_recovery_cycle_initialize";
// Trusted composition supplies authenticated journal readers and existing
// application ports. Authored JSON cannot select an adapter or effect guard.
export function createStandardDriftCycle({ targetRoot, operations, readSource, observeContext, readCurrent, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  function git(args, raw = false) {
    if (Object.keys(process.env).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key))) fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
    return execFileSync("git", ["--literal-pathspecs", "-C", artifacts.root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      ...args], { encoding: raw ? undefined : "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1048576,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  }
  function changedFiles() {
    const entries = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
    if (entries.length > 128) fail("STANDARD_RECOVERY_CHECKPOINT_LIMIT");
    return entries.map(entry => {
      if (!/^( M|M |A |AM|MM|\?\?)/.test(entry.slice(0, 2))) fail("STANDARD_RECOVERY_CHECKPOINT_STATE_UNSUPPORTED");
      const file = entry.slice(3), physical = agentRunPhysicalPath(path.resolve(artifacts.root, file));
      if (path.relative(artifacts.root, physical).startsWith("..") || path.isAbsolute(path.relative(artifacts.root, physical))) fail("STANDARD_RECOVERY_CHECKPOINT_PATH_INVALID");
      return { path: file, sha256: readAgentRunFile(physical, { json: false, maxBytes: 1048576 }).sha256 };
    });
  }
  function stableContext(context) {
    const { git: ignoredGit, head, documents, ...body } = context;
    return shadowHash({ ...body, documents: documents.map(({ ref, sha256 }) => ({ ref, sha256 })) });
  }
  function verifyCheckpoint(selected, observed) {
    const state = selected.transition.state, context = observed.context;
    if (!state || stableContext(context) !== state.snapshot_sha256 || context.git.other_changes.count !== 0) fail("STANDARD_RECOVERY_CHECKPOINT_SOURCE_STALE");
    if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) return false;
    if (context.head !== state.head) {
      try { git(["merge-base", "--is-ancestor", state.head, context.head]); } catch { fail("STANDARD_RECOVERY_CHECKPOINT_HISTORY_INVALID"); }
      const count = Number(git(["rev-list", "--count", `${state.head}..${context.head}`]).trim());
      if (!Number.isSafeInteger(count) || count < 1 || count > 32) fail("STANDARD_RECOVERY_CHECKPOINT_HISTORY_INVALID");
      const changed = git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", state.head, context.head, "--"]).split("\0").filter(Boolean);
      if (changed.some(file => !state.files.some(row => row.path === file))) fail("STANDARD_RECOVERY_CHECKPOINT_SCOPE_CHANGED");
    }
    for (const file of state.files) {
      if (readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, file.path)), { json: false, maxBytes: 1048576 }).sha256 !== file.sha256
        || artifactContentHash(git(["show", `${context.head}:${file.path}`], true)) !== file.sha256) fail("STANDARD_RECOVERY_CHECKPOINT_CONTENT_CHANGED");
    }
    return true;
  }
  const boundary = (operation, context, inner, references) => operation === refresh
    ? recoveryRuntimeBoundary({ root: artifacts.root, context })
    : recoveryCycleBoundary({ root: artifacts.root, context, plan: inner.plan, originalReferences: references, artifacts });
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_RECOVERY_CYCLE_PLAN_INVALID");
    assertStandardOperationInput(plan.operation_ref, plan.input); return plan;
  }
  async function source(instance, operation, input) {
    const selected = await readSource(instance, operation, input), observed = await observeContext();
    if (observed.context_sha256 !== selected.transition.after_context_sha256 || selected.review.session_id !== observed.context.session_id)
      fail("STANDARD_RECOVERY_CYCLE_SOURCE_STALE");
    return { selected, observed };
  }
  async function prepare(instance, operation, input) {
    assertStandardOperationInput(operation, input);
    if (operation === checkpoint) {
      const selected = await readSource(instance, operation, input), observed = await observeContext();
      if (!verifyCheckpoint(selected, observed)) return { can_apply: false, reason_code: "STANDARD_RECOVERY_GIT_CHECKPOINT_REQUIRED" };
      const plan = assertPlan({ contract_version: "standard-drift-cycle-plan.v1", operation_ref: operation, input, prepared_at_ms: now(),
        source_sha256: shadowHash(selected), context_sha256: observed.context_sha256, boundary_sha256: selected.transition.state.snapshot_sha256,
        inner: {}, original_references: observed.context.documents.map(({ ref, sha256 }) => ({ ref, sha256 })) });
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    }
    const { selected, observed } = await source(instance, operation, input);
    let inner;
    if (operation === refresh) { changedFiles(); inner = await operations.prepareCycleContext({ session_id: selected.review.session_id }); }
    else {
      const admission = await operations.admitCycle();
      if (admission.outcome !== "completed") return { can_apply: false, admission };
      const lifecycle = admission.observations.lifecycle;
      inner = await operations.prepareCycle({ session_id: selected.review.session_id, cycle_id: input.cycle_id, cycle_type: input.cycle_type,
        title: input.title, objective: selected.report.current_objective, continuity_rule: lifecycle.continuity_rule, base_branch: lifecycle.continuity_base_branch });
    }
    if (!inner.can_apply) return { can_apply: false, admission: inner };
    const original_references = observed.context.documents.map(({ ref, sha256 }) => ({ ref, sha256 }));
    const plan = assertPlan({ contract_version: "standard-drift-cycle-plan.v1", operation_ref: operation, input, prepared_at_ms: now(),
      source_sha256: shadowHash(selected), context_sha256: observed.context_sha256, inner, original_references,
      boundary_sha256: boundary(operation, observed.context, inner, original_references) });
    if ((await observeContext()).context_sha256 !== observed.context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare,
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan); const age = now() - plan.prepared_at_ms;
        if (write !== true || !prepared.can_apply || shadowHash(plan) !== expectPlan || prepared.plan_sha256 !== expectPlan
          || typeof assertAuthorized !== "function" || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_RECOVERY_CYCLE_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      const operation = plan.operation_ref;
      if (operation === checkpoint) {
        const selected = await readSource(instance, operation, plan.input), observed = await observeContext();
        if (shadowHash(selected) !== plan.source_sha256 || observed.context_sha256 !== plan.context_sha256 || !verifyCheckpoint(selected, observed)
          || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_RECOVERY_CHECKPOINT_SOURCE_STALE");
        return { contract_version: "standard-drift-cycle-output.v1", operation_ref: operation, outcome: "completed", effect_status: "no_effect",
          facts: { drift_recovery_checkpoint_verified: true, drift_recovery_required: true, drift_check_completed: false },
          observations: { source_operation_id: plan.input.context_operation_id, recovery_execution: "pending",
            causal_transition: { source_sha256: plan.source_sha256, before_context_sha256: selected.transition.after_context_sha256,
              after_context_sha256: observed.context_sha256, before_head: selected.transition.state.head, after_head: observed.context.head } }, evidence_refs: [] };
      }
      const effectGuard = {
        async before() {
          const { selected, observed } = await source(instance, operation, plan.input);
          if (shadowHash(selected) !== plan.source_sha256 || observed.context_sha256 !== plan.context_sha256
            || boundary(operation, observed.context, plan.inner, plan.original_references) !== plan.boundary_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_STALE");
          await assertAuthorized();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_RECOVERY_CYCLE_SOURCE_STALE");
        },
        async after() {
          const after = await observeContext(), context = after.context;
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
            || boundary(operation, context, plan.inner, plan.original_references) !== plan.boundary_sha256) fail("STANDARD_RECOVERY_CYCLE_POSTCONDITION_FAILED");
          if (operation === initialize && (context.cycle_id !== plan.inner.plan.input.cycle_id || context.cycle_state !== "OPEN"
            || context.original_objective !== plan.inner.plan.input.objective || context.branch !== plan.inner.plan.branch_name
            || context.head !== plan.inner.plan.scope.head || context.session_id !== plan.inner.plan.input.session_id)) fail("STANDARD_RECOVERY_CYCLE_POSTCONDITION_FAILED");
          return { source_sha256: plan.source_sha256, before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256,
            boundary_sha256: plan.boundary_sha256, ...(operation === refresh ? { state: { snapshot_sha256: stableContext(context), head: context.head, files: changedFiles() } } : {}) };
        },
      };
      const result = await (operation === refresh ? operations.refreshCycleContext : operations.initializeCycle)(plan.inner,
        { write: true, expectPlan: plan.inner.plan_sha256, effectGuard });
      return { contract_version: "standard-drift-cycle-output.v1", operation_ref: operation, outcome: result.outcome, effect_status: result.effect_status,
        facts: result.outcome === "completed" ? { [operation === refresh ? "drift_recovery_context_refreshed" : "drift_recovery_cycle_initialized"]: true,
          drift_recovery_required: true, drift_check_completed: false, ...(operation === initialize ? { cycle_dor_ready: false } : {}) } : {},
        observations: { source_operation_id: operation === refresh ? plan.input.recovery_operation_id : plan.input.checkpoint_operation_id,
          recovery_execution: "pending", application_operation: result.operation_ref, ...result.observations,
          ...(result.observations.guarded_transition ? { causal_transition: result.observations.guarded_transition } : {}) }, evidence_refs: result.evidence_refs };
    },
  });
}
