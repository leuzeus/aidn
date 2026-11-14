import fs from "node:fs";
import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "./project-artifact-store-service.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { runRequirementsDeltaAdmitUseCase } from "./requirements-delta-admit-use-case.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { artifactContentHash, artifactMetadataHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { changeRequestBoundary } from "./standard-drift-recovery.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-drift-change-request-plan.v1.schema.json" with { type: "json" };
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// No authored paths, edits, accepted requirements or impact overrides. A CR
// records the accepted diagnosis for review; it does not approve a scope delta.
export function createStandardDriftChangeRequest({ targetRoot, readRecovery, observeContext, readCurrent, now = Date.now, environment = process.env }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
  const open = readOnly => createProjectArtifactStore({ targetRoot: artifacts.root, readOnly, existingOnly: true, env: environment });
  function metadata(names) {
    if (!artifacts.describe().database) return names.map(() => null);
    const store = open(true);
    try { return names.map(name => { const row = store.getArtifact(name); return row ? artifactMetadataHash(row) : null; }); } finally { store.close(); }
  }
  function projections(names) {
    const selected = artifacts.describe();
    if (!selected.database || selected.state_mode === "db-only") return [];
    return names.map(name => {
      const file = agentRunPhysicalPath(path.join(artifacts.root, "docs/audit", name), { missing: true });
      if (fs.existsSync(file)) readAgentRunFile(file, { json: false, maxBytes: 1048576 });
      return file;
    });
  }
  function commit(change, after) {
    if (!artifacts.describe().database) { artifacts.compareAndSwap({ ...change, after }); return null; }
    const store = open(false);
    try {
      const previous = store.getArtifact(change.path);
      if (!previous || artifactMetadataHash(previous) !== change.before_metadata_sha256) fail("STANDARD_CHANGE_REQUEST_METADATA_CHANGED");
      const artifact = { ...previous, content_format: "utf8", content: after, sha256: undefined, size_bytes: undefined, mtime_ns: undefined,
        updated_at: new Date(now()).toISOString(), canonical_format: "markdown-canonical-v1", canonical_json: undefined };
      artifact.canonical = buildCanonicalFromMarkdown(after, { relativePath: change.path, kind: artifact.kind });
      const afterMetadata = artifactMetadataHash(artifact);
      store.compareAndSwapArtifact({ artifact, expectedSha256: change.before_sha256, expectedMetadataSha256: change.before_metadata_sha256 });
      return afterMetadata;
    } finally { store.close(); }
  }
  function assertPlan(plan) {
    if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_CHANGE_REQUEST_PLAN_INVALID");
    return plan;
  }
  async function prepare(instance, input, at) {
    const recovered = await readRecovery(instance, input), observed = await observeContext(), context = observed.context;
    if (recovered.choice !== "requirements_delta" || !recovered.review.cycle_id || context.cycle_id !== recovered.review.cycle_id
      || context.session_id !== recovered.review.session_id || !["OPEN", "IMPLEMENTING", "VERIFYING"].includes(context.cycle_state)
      || observed.context_sha256 !== recovered.transition.after_context_sha256) fail("STANDARD_CHANGE_REQUEST_RECOVERY_STALE");
    const admission = await preWriteAdmit({ targetRoot: artifacts.root, skill: "drift-check" });
    const session = artifacts.sessions().find(row => row.session_id === context.session_id);
    const ownership = await runRequirementsDeltaAdmitUseCase({ targetRoot: artifacts.root, mode: "COMMITTING" });
    if (!session || parseSessionMetadata(session.content).mode !== "COMMITTING" || !admission.ok || admission.activation?.active !== true || ownership.action !== "proceed_requirements_delta"
      || ownership.mapped_cycle?.cycle_id !== context.cycle_id || ownership.mapped_cycle?.session_owner !== context.session_id
      || ownership.active_session !== context.session_id || ownership.active_cycle !== context.cycle_id) fail("STANDARD_CHANGE_REQUEST_ADMISSION_BLOCKED");
    const owner = artifacts.cycles().find(row => row.cycle_id === context.cycle_id);
    if (!owner) fail("STANDARD_CHANGE_REQUEST_OWNER_REQUIRED");
    const names = [owner.path.replace(/status\.md$/, "change-requests.md"), "CURRENT-STATE.md"], rows = names.map(name => artifacts.read(name, { required: true }));
    projections(names);
    const ids = [...rows[0].content.matchAll(/^## CR-([0-9]{3,6})\s*$/gm)].map(match => Number(match[1]));
    if (new Set(ids).size !== ids.length || ids.some(id => id <= 0)) fail("STANDARD_CHANGE_REQUEST_IDS_INVALID");
    const number = Math.max(0, ...ids) + 1;
    if (number > 999999) fail("STANDARD_CHANGE_REQUEST_IDS_EXHAUSTED");
    const cr = "CR-" + String(number).padStart(3, "0"), report = recovered.report, impact = report.split_recommendation.impact;
    if (!["low", "medium", "high"].includes(impact)) fail("STANDARD_CHANGE_REQUEST_IMPACT_REQUIRED");
    const body = { recovery_record_operation_id: input.recovery_record_operation_id, decision_operation_id: recovered.review.review_operation_id,
      evaluation_operation_id: recovered.review.evaluation_operation_id, evaluation_sha256: recovered.review.evaluation_sha256, report };
    const append = `\n\n## ${cr}\n- Change: Review the authenticated drift diagnostic below.\n- Reason: Confirmed deviation from the cycle goal or baseline.\n- Impact: ${impact}\n- Affected REQ: pending explicit mapping\n- Affected files/modules: see authenticated diagnostic evidence\n- Decision: pending\n- Notes: ${["medium", "high"].includes(impact) ? "Open an admitted new cycle before accepting the changed scope." : "Review the requirements delta before accepting the changed scope."}\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
    const pattern = /(^## Next Actions[^\r\n]*\r?\n)[\s\S]*?(?=^## |$(?![\s\S]))/gm;
    if ([...rows[1].content.matchAll(pattern)].length !== 1 || (rows[1].content.match(/^updated_at:.*$/gm) ?? []).length !== 1) fail("STANDARD_CHANGE_REQUEST_CURRENT_INVALID");
    const current = rows[1].content.replace(pattern, (_all, title) => title + `\n1. Review ${context.cycle_id}/${cr}; ${impact === "low" ? "prepare the explicit requirements mapping" : "open an admitted cycle for the changed scope"}.\n2. Re-evaluate drift before completing R05.\n\n`)
      .replace(/^updated_at:.*$/m, "updated_at: " + new Date(at).toISOString());
    const metas = metadata(names), plan = assertPlan({ contract_version: "standard-drift-change-request-plan.v1", input, prepared_at_ms: at,
      source_sha256: shadowHash(recovered), context_sha256: observed.context_sha256, boundary_sha256: changeRequestBoundary({ root: artifacts.root, context, environment }),
      session_id: context.session_id, cycle_id: context.cycle_id, change_request_id: cr, impact,
      changes: rows.map((row, i) => ({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: metas[i], edit_kind: i === 0 ? "append" : "replace",
        text_chunks: (i === 0 ? append : current).match(/[\s\S]{1,8192}/g), after_sha256: artifactContentHash(i === 0 ? row.content + append : current) })) });
    if ((await observeContext()).context_sha256 !== observed.context_sha256) fail("STANDARD_CHANGE_REQUEST_RECOVERY_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      let plan;
      try {
        plan = assertPlan(prepared?.plan);
        if (write !== true || !prepared.can_apply || typeof assertAuthorized !== "function" || shadowHash(plan) !== expectPlan || prepared.plan_sha256 !== expectPlan)
          fail("STANDARD_CHANGE_REQUEST_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms);
          if (fresh.plan_sha256 !== expectPlan) fail("STANDARD_CHANGE_REQUEST_PREVIEW_CHANGED");
          await assertAuthorized();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256
            || (await observeContext()).context_sha256 !== plan.context_sha256) fail("STANDARD_CHANGE_REQUEST_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], afterMetadata = [];
        try {
          for (const change of plan.changes) {
            const after = (change.edit_kind === "append" ? artifacts.read(change.path).content : "") + change.text_chunks.join("");
            if (artifactContentHash(after) !== change.after_sha256) fail("STANDARD_CHANGE_REQUEST_POSTIMAGE_CHANGED");
            afterMetadata.push(commit(change, after)); committed.push(change.path);
          }
          artifacts.project(committed);
          for (const [i, file] of projections(committed).entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== plan.changes[i].after_sha256) fail("STANDARD_CHANGE_REQUEST_PROJECTION_UNCONFIRMED");
          const after = await observeContext();
          if (plan.changes.some(change => artifacts.read(change.path).sha256 !== change.after_sha256) || shadowHash(metadata(committed)) !== shadowHash(afterMetadata)
            || changeRequestBoundary({ root: artifacts.root, context: after.context, environment }) !== plan.boundary_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_CHANGE_REQUEST_CONTEXT_CHANGED");
          return { contract_version: "standard-drift-change-request-output.v1", operation_ref: "drift_change_request_record", outcome: "completed", effect_status: "confirmed",
            facts: { drift_change_request_recorded: true, drift_recovery_required: true, drift_check_completed: false },
            observations: { change_request_id: plan.change_request_id, cycle_id: plan.cycle_id, impact: plan.impact, decision: "pending", recovery_execution: "pending",
              new_cycle_required: plan.impact !== "low", recovery_record_operation_id: plan.input.recovery_record_operation_id, committed,
              causal_transition: { before_context_sha256: plan.context_sha256, after_context_sha256: after.context_sha256, boundary_sha256: plan.boundary_sha256,
                changes: plan.changes.map(({ path, before_sha256, after_sha256, before_metadata_sha256 }, i) => ({ path, before_sha256, after_sha256, before_metadata_sha256, after_metadata_sha256: afterMetadata[i] })) } },
            evidence_refs: plan.changes.map(change => ({ ref: "docs/audit/" + change.path, sha256: change.after_sha256 })) };
        } catch (cause) { return { contract_version: "standard-drift-change-request-output.v1", operation_ref: "drift_change_request_record", outcome: "reconciliation_required", effect_status: "unknown", facts: {}, observations: { committed, reason_code: cause.code ?? "STANDARD_CHANGE_REQUEST_UNCONFIRMED" }, evidence_refs: [] }; }
      });
    },
  });
}
