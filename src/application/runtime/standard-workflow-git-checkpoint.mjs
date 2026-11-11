import path from "node:path";
import schema from "../../core/contracts/workflow-definition/standard-session-git-checkpoint-plan.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { assertWorkflowGitCheckpointPort } from "../../core/ports/workflow-git-checkpoint-port.mjs";
import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { readAgentRunFile, agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-session-git-checkpoint-output.v1", operation_ref: "session_git_checkpoint", outcome, effect_status, observations, facts, evidence_refs });

export function createStandardWorkflowGitCheckpoint({ targetRoot, readContext, readCurrent, now = Date.now }, { gitPort } = {}) {
  if (typeof readContext !== "function" || typeof readCurrent !== "function") fail("STANDARD_GIT_CONTEXT_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const git = assertWorkflowGitCheckpointPort(gitPort ?? createLocalWorkflowGitCheckpoint({ targetRoot: artifacts.root }));
  async function prepare(instance, input, operationId, preparedAt, acquired = false) {
    assertStandardOperationInput("session_git_checkpoint", input);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_GIT_OPERATION_ID_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const source = await readContext(instance, input), context = source.context_plan;
    if (context?.contract_version !== "standard-cycle-context-plan.v2" || source.context_output?.facts.cycle_context_refreshed !== true
      || source.context_output.effect_status !== "confirmed" || source.start_output?.facts.session_started !== true || source.start_output.effect_status !== "confirmed")
      fail("STANDARD_GIT_ACCEPTED_CONTEXT_REQUIRED");
    const sessionId = context.input.session_id, sessionPath = `sessions/${sessionId}.md`;
    if (context.session_path !== sessionPath) fail("STANDARD_GIT_SESSION_SCOPE_CHANGED");
    const runtimeRefs = source.context_output.evidence_refs.filter(row => row.ref === "docs/audit/RUNTIME-STATE.md");
    if (runtimeRefs.length !== 1) fail("STANDARD_GIT_RUNTIME_EVIDENCE_REQUIRED");
    const expected = [["CURRENT-STATE.md", context.current_sha256], ["RUNTIME-STATE.md", runtimeRefs[0].sha256], [sessionPath, context.session_sha256]];
    const documents = expected.map(([name, sha256]) => {
      const row = artifacts.read(name, { required: true }); if (row.sha256 !== sha256) fail("STANDARD_GIT_CONTEXT_POSTIMAGE_CHANGED");
      return { path: name, sha256, metadata_sha256: artifacts.metadataHash(name) };
    });
    const fields = analyzeStructuredArtifact(artifacts.read("CURRENT-STATE.md", { required: true }).content).key_values;
    const session = parseSessionMetadata(artifacts.read(sessionPath, { required: true }).content), observed = git.inspect();
    if (fields.active_session !== sessionId || fields.active_cycle !== "none" || !["COMMITTING", "EXPLORING"].includes(fields.mode) || session.mode !== fields.mode || context.mode !== fields.mode
      || session.session_branch !== observed.branch || context.scope.branch !== observed.branch || context.scope.head !== observed.head)
      return { can_apply: false, reason_code: "STANDARD_GIT_SESSION_CONTEXT_REQUIRED" };
    const admitted = await runStartSessionAdmitUseCase({ targetRoot: artifacts.root, mode: fields.mode });
    const prewrite = await preWriteAdmit({ targetRoot: artifacts.root, skill: "start-session" });
    if (admitted.result !== "ok" || admitted.action !== "resume_current_session" || !prewrite.ok)
      return { can_apply: false, reason_code: "STANDARD_GIT_SESSION_ADMISSION_BLOCKED" };
    if (!observed.index_clean || observed.lock_present || observed.changes.some(row => !documents.some(doc => "docs/audit/" + doc.path === row.path)))
      return { can_apply: false, reason_code: "STANDARD_GIT_FOREIGN_CHANGES" };
    const files = observed.changes.map(row => {
      const doc = documents.find(doc => "docs/audit/" + doc.path === row.path);
      const physical = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, row.path)), { json: false, maxBytes: 1048576 });
      if (physical.sha256 !== doc.sha256) fail("STANDARD_GIT_PROJECTION_CHANGED");
      return { path: row.path, sha256: doc.sha256 };
    });
    const plan = { contract_version: "standard-session-git-checkpoint-plan.v1", operation_ref: "session_git_checkpoint", input, operation_id: operationId,
      prepared_at_ms: preparedAt, session_id: sessionId, state_mode: artifacts.describe().state_mode, source_sha256: shadowHash(source), documents,
      git: { operation_kind: "metadata-objects-ref-index.v1", observed, files } };
    if (validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_GIT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      if (write !== true || !prepared?.can_apply || typeof assertAuthorized !== "function" || prepared.plan_sha256 !== expectPlan
        || shadowHash(plan) !== expectPlan || validateJsonSchema(plan, schema, "$", { contractKind: "workflow-definition" }).length) {
        const cause = Object.assign(new Error("STANDARD_GIT_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_GIT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" }); throw cause;
      }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
            fail("STANDARD_GIT_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        try {
          const result = await git.commit({ ...plan.git, operation_id: plan.operation_id, prepared_at_ms: plan.prepared_at_ms, plan_sha256: expectPlan }, { assertAuthorized });
          for (const row of plan.documents) if (artifacts.read(row.path).sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256)
            fail("STANDARD_GIT_METADATA_CHANGED");
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_GIT_INSTANCE_CHANGED");
          await assertAuthorized();
          return emit("completed", result.effect_status, { context_operation_id: plan.input.context_operation_id, session_id: plan.session_id, git: result,
            committed_paths: plan.git.files.map(row => row.path) }, { session_git_ready_for_cycle: true, session_git_checkpoint_created: result.status === "confirmed" },
            [{ ref: "git:governed-session/" + plan.operation_id, sha256: shadowHash(result) }]);
        } catch (cause) {
          const noEffect = cause.effect_status === "no_effect";
          return emit(noEffect ? "blocked" : "reconciliation_required", noEffect ? "no_effect" : "unknown", { reason_code: cause.code ?? "STANDARD_GIT_EFFECT_UNCONFIRMED" });
        }
      });
    },
  });
}
