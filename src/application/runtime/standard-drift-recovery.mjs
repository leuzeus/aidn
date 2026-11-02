import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "./project-artifact-store-service.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { assertRecoveryPlan } from "../../core/workflow/process-decision-inbox.mjs";
import { artifactContentHash, artifactMetadataHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const controls = ["parking-lot.md", "CURRENT-STATE.md"];
const chunks = text => text.match(/[\s\S]{1,8192}/g) ?? [""];
// Only this fixed writer may discount its two consented documents. No authored
// input chooses excluded paths. Their exact canonical post-images are checked.
export function recoveryBoundary(options) { return documentBoundary(options, controls); }
export function recoveryRuntimeBoundary(options) { return documentBoundary(options, ["RUNTIME-STATE.md"]); }
export function recoveryCycleBoundary({ plan, originalReferences, artifacts, ...options }) {
  const { cycle_id, cycle_state, original_objective, context_use, completion, branch, ...body } = options.context;
  const context = { ...body, documents: originalReferences.map(row => {
    const observed = artifacts.read(row.ref.slice(6), { required: true });
    return { ref: row.ref, sha256: observed.sha256, content: observed.content };
  }) };
  return documentBoundary({ ...options, context }, plan.changes.map(row => row.path), true);
}
export function changeRequestBoundary(options) {
  const cycle = options.context.cycle_id;
  if (!/^C[0-9]{3,6}$/.test(cycle ?? "")) fail("STANDARD_CHANGE_REQUEST_OWNER_REQUIRED");
  const matches = options.context.documents.filter(row => new RegExp(`^audit:cycles/${cycle}-[A-Za-z0-9._-]+/change-requests\\.md$`).test(row.ref));
  if (matches.length !== 1) fail("STANDARD_CHANGE_REQUEST_OWNER_REQUIRED");
  return documentBoundary(options, [matches[0].ref.slice(6), "CURRENT-STATE.md"]);
}
function documentBoundary({ root, context, environment = process.env }, controls, branchTransition = false) {
  if (Object.keys(environment).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key))) fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
  const git = args => {
    try { return execFileSync("git", ["--literal-pathspecs", "-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-c", "submodule.recurse=false", ...args], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 262144,
        env: { ...environment, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] }); } catch { fail("STANDARD_RECOVERY_GIT_UNAVAILABLE"); }
  };
  const normalize = name => process.platform === "win32" ? name.toLowerCase() : name;
  const own = new Set(controls.map(name => normalize("docs/audit/" + name)));
  const isOwn = name => own.has(normalize(name));
  const entries = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0"), outside = [];
  for (let i = 0; i < entries.length; i++) {
    const value = entries[i]; if (!value) continue;
    const previous = /[RC]/.test(value.slice(0, 2)) ? entries[++i] : null;
    if (!isOwn(value.slice(3)) || previous && !isOwn(previous)) outside.push({ value, previous });
  }
  const names = git(["diff", "--name-only", "-z", "--no-renames", "HEAD", "--"]).split("\0").filter(name => name && !isOwn(name));
  if (names.length > 512) fail("STANDARD_RECOVERY_GIT_LIMIT");
  const outsideDiff = names.length ? git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--", ...names]) : "";
  const ownIndex = git(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--", ...controls.map(name => "docs/audit/" + name)]);
  const { git: ignoredGit, documents, ...body } = context;
  return shadowHash({ body, documents: documents.filter(row => !controls.includes(row.ref.slice(6))),
    git: { branch: branchTransition ? null : git(["branch", "--show-current"]).trim(), head: git(["rev-parse", "HEAD"]).trim(),
      outside_status_sha256: shadowHash(outside), outside_diff_sha256: artifactContentHash(outsideDiff), own_index_sha256: artifactContentHash(ownIndex) } });
}
export function createStandardDriftRecovery({ targetRoot, readEvaluation, observeContext, readCurrent, now = Date.now, environment = process.env }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
  const open = readOnly => createProjectArtifactStore({ targetRoot: artifacts.root, readOnly, existingOnly: true, env: environment });
  function projectionFiles() {
    const selected = artifacts.describe();
    if (!selected.database || selected.state_mode === "db-only") return [];
    return controls.map(name => {
      const file = agentRunPhysicalPath(path.join(artifacts.root, "docs/audit", name), { missing: true });
      if (fs.existsSync(file)) readAgentRunFile(file, { json: false, maxBytes: 1048576 });
      return file;
    });
  }
  function metadata() {
    if (!artifacts.describe().database) return controls.map(() => null);
    const store = open(true);
    try { return controls.map(name => { const row = store.getArtifact(name); return row ? artifactMetadataHash(row) : null; }); } finally { store.close(); }
  }
  function commit(change, after) {
    if (!artifacts.describe().database) { artifacts.compareAndSwap({ ...change, after }); return null; }
    const store = open(false);
    try {
      const previous = store.getArtifact(change.path);
      if ((previous ? artifactMetadataHash(previous) : null) !== change.before_metadata_sha256) fail("STANDARD_RECOVERY_METADATA_CHANGED");
      const artifact = { ...(previous ?? { path: change.path, kind: "other", family: "support", subtype: "parking_lot", gate_relevance: 0,
        classification_reason: "standard_recovery_findings", session_id: null, cycle_id: null, source_mode: "explicit", entity_confidence: 1, legacy_origin: null }),
        content_format: "utf8", content: after, sha256: undefined, size_bytes: undefined, mtime_ns: undefined, updated_at: new Date(now()).toISOString(),
        canonical_format: "markdown-canonical-v1", canonical_json: undefined };
      artifact.canonical = buildCanonicalFromMarkdown(after, { relativePath: change.path, kind: artifact.kind });
      const afterMetadata = artifactMetadataHash(artifact);
      store.compareAndSwapArtifact({ artifact, expectedSha256: change.before_sha256,
        ...(change.before_metadata_sha256 === null ? {} : { expectedMetadataSha256: change.before_metadata_sha256 }) });
      return afterMetadata;
    } finally { store.close(); }
  }
  async function prepare(instance, input, operationId, at) {
    projectionFiles();
    const verified = await readEvaluation(instance, input), report = verified.output.observations.report;
    if (verified.output.facts.drift_present !== true || verified.output.facts.drift_context_complete !== true) fail("STANDARD_RECOVERY_COMPLETE_DIAGNOSIS_REQUIRED");
    const parking = artifacts.read(controls[0]), current = artifacts.read(controls[1], { required: true });
    const actions = choice => ["Record the confirmed findings and the selected recovery in their owning artifacts.",
      choice === "requirements_delta" ? "Review and execute an explicit requirements/change-request delta." : choice === "new_cycle" ? "Select and create an admitted cycle for the changed scope." : "Review exact paths and execute an explicitly authorized scope rollback.",
      "Run a fresh drift diagnosis after the recovery effects.", "Complete the R05 checkpoint only after a complete clean re-evaluation."];
    const choices = verified.context.cycle_id && ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(verified.context.cycle_state) ? ["requirements_delta", "new_cycle", "rollback"] : ["new_cycle", "rollback"];
    const options = choices.map(choice => ({ choice, actions: actions(choice) }));
    const body = { review_operation_id: operationId, evaluation_operation_id: input.evaluation_operation_id,
      evaluation_sha256: verified.evaluation_sha256, report, options, recovery_execution: "pending" };
    const append = (parking.content === null ? "# Parking Lot — confirmed findings\n" : "") + `\n\n## DRIFT-${operationId}\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
    const afterParking = (parking.content ?? "") + append;
    const pattern = /(^## Next Actions[^\r\n]*\r?\n)[\s\S]*?(?=^## |$(?![\s\S]))/gm;
    if ([...current.content.matchAll(pattern)].length !== 1) fail("STANDARD_RECOVERY_CURRENT_STATE_INVALID");
    let afterCurrent = current.content.replace(pattern, (_all, title) => title + `\n1. Resolve the selected recovery recorded by ${operationId} in parking-lot.md.\n2. Re-evaluate drift before resuming governed work or completing R05.\n\n`);
    if ((afterCurrent.match(/^updated_at:.*$/gm) ?? []).length !== 1) fail("STANDARD_RECOVERY_CURRENT_STATE_INVALID");
    afterCurrent = afterCurrent.replace(/^updated_at:.*$/m, "updated_at: " + new Date(at).toISOString());
    const beforeMetadata = metadata();
    const plan = assertRecoveryPlan({ contract_version: "standard-drift-recovery-plan.v1", review_operation_id: operationId,
      evaluation_operation_id: input.evaluation_operation_id, evaluation_sha256: verified.evaluation_sha256, context_sha256: verified.context_sha256,
      prepared_at_ms: at, session_id: verified.context.session_id, cycle_id: verified.context.cycle_id, options,
      boundary_sha256: recoveryBoundary({ root: artifacts.root, context: verified.context, environment }),
      changes: [parking, current].map((row, i) => ({ path: row.path, before_sha256: row.sha256, edit_kind: i === 0 ? "append" : "replace",
        before_metadata_sha256: beforeMetadata[i],
        text_chunks: chunks(i === 0 ? append : afterCurrent), after_sha256: artifactContentHash([afterParking, afterCurrent][i]) })) });
    if ((await observeContext()).context_sha256 !== verified.context_sha256) fail("STANDARD_RECOVERY_REVIEW_STALE");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input, operationId) => prepare(instance, input, operationId, now()),
    async assertFresh(instance, plan) {
      assertRecoveryPlan(plan);
      const fresh = await prepare(instance, { evaluation_operation_id: plan.evaluation_operation_id }, plan.review_operation_id, plan.prepared_at_ms);
      if (fresh.plan_sha256 !== shadowHash(plan)) fail("STANDARD_RECOVERY_REVIEW_STALE");
    },
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const { review, choice, decision_operation_id, prepared_at_ms } = prepared ?? {}, age = now() - prepared_at_ms;
      if (write !== true || typeof assertAuthorized !== "function" || !prepared.can_apply || prepared.plan_sha256 !== expectPlan
        || shadowHash({ review, choice, decision_operation_id, prepared_at_ms }) !== expectPlan || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_RECOVERY_EXPLICIT_EFFECT_REQUIRED");
      assertRecoveryPlan(review); if (!review.options.some(row => row.choice === choice)) fail("STANDARD_RECOVERY_CHOICE_REQUIRED");
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        let before;
        try {
          const fresh = await prepare(instance, { evaluation_operation_id: review.evaluation_operation_id }, review.review_operation_id, review.prepared_at_ms);
          if (fresh.plan_sha256 !== shadowHash(review)) fail("STANDARD_RECOVERY_REVIEW_STALE");
          await assertAuthorized(); if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_RECOVERY_PROCESS_CHANGED");
          const observed = await observeContext();
          if (observed.context_sha256 !== review.context_sha256) fail("STANDARD_RECOVERY_REVIEW_STALE");
          before = recoveryBoundary({ root: artifacts.root, context: observed.context, environment });
          if (before !== review.boundary_sha256 || now() - prepared_at_ms > 300000) fail("STANDARD_RECOVERY_REVIEW_STALE");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = [], afterMetadata = [];
        try {
          for (const change of review.changes) {
            const row = artifacts.read(change.path), after = (change.edit_kind === "append" ? row.content ?? "" : "") + change.text_chunks.join("");
            if (artifactContentHash(after) !== change.after_sha256) fail("STANDARD_RECOVERY_POSTIMAGE_CHANGED");
            afterMetadata.push(commit(change, after)); committed.push(change.path);
          }
          artifacts.project(committed);
          for (const [i, file] of projectionFiles().entries()) if (readAgentRunFile(file, { json: false, maxBytes: 1048576 }).sha256 !== review.changes[i].after_sha256) fail("STANDARD_RECOVERY_PROJECTION_UNCONFIRMED");
          const after = await observeContext();
          if (review.changes.some(row => artifacts.read(row.path).sha256 !== row.after_sha256)
            || shadowHash(metadata()) !== shadowHash(afterMetadata)
            || recoveryBoundary({ root: artifacts.root, context: after.context, environment }) !== before
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_RECOVERY_CONTEXT_CHANGED");
          return { contract_version: "standard-drift-recovery-output.v1", operation_ref: "drift_recovery_record", outcome: "completed", effect_status: "confirmed",
            facts: { drift_recovery_recorded: true, drift_recovery_required: true, drift_check_completed: false },
            observations: { decision_operation_id, choice, recovery_execution: "pending", committed,
              causal_transition: { before_context_sha256: review.context_sha256, after_context_sha256: after.context_sha256,
                boundary_sha256: before, changes: review.changes.map(({ path, before_sha256, after_sha256, before_metadata_sha256 }, i) => ({ path, before_sha256, after_sha256,
                  before_metadata_sha256, after_metadata_sha256: afterMetadata[i] })) } },
            evidence_refs: review.changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 })) };
        } catch (cause) {
          return { contract_version: "standard-drift-recovery-output.v1", operation_ref: "drift_recovery_record", outcome: "reconciliation_required", effect_status: "unknown", facts: {},
            observations: { committed, reason_code: cause.code ?? "STANDARD_RECOVERY_UNCONFIRMED" }, evidence_refs: [] };
        }
      });
    },
  });
}
