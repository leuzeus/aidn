import { assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardCycleCloseRecord } from "../../src/application/runtime/standard-cycle-close-record.mjs";
import { readStandardCycleCloseContext } from "../../src/application/runtime/standard-cycle-close-context.mjs";
import { cycleClosureChoices } from "../../src/core/workflow/standard-cycle-closure-decision.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import outputSchema from "../../src/core/contracts/workflow-definition/standard-cycle-close-output.v1.schema.json" with { type: "json" };
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
const selected = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
if (!["files", "dual", "db-only", "partial", "projection", "stale", "slow-authority", "expired"].includes(selected)) throw Error("CLOSE_RECORD_FIXTURE_MODE_INVALID");
const mode = selected === "partial" ? "db-only" : selected === "projection" ? "dual" : ["stale", "slow-authority", "expired"].includes(selected) ? "files" : selected;
const choice = process.argv.find(value => value.startsWith("--choice="))?.slice(9) ?? "retain";
if (!["retain", "no_go", "drop"].includes(choice)) throw Error("CLOSE_RECORD_FIXTURE_CHOICE_INVALID");
const targetState = { retain: "DONE", no_go: "NO_GO", drop: "DROPPED" }[choice];
const owned = [], temp = fs.realpathSync(os.tmpdir()), H = "a".repeat(64), op = "op_" + "a".repeat(40);
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
try {
  const root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  const operations = createStandardWorkflowOperations({ targetRoot: root });
  let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-closure", objective: "Qualify the bounded terminal metadata writer" });
  assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  prepared = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture session");
  prepared = await operations.prepareCycleContext({ session_id: "S001" });
  assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture context refresh");
  const admission = await operations.admitCycle(); assert.equal(admission.outcome, "completed");
  prepared = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "record", objective: "Qualify the bounded terminal metadata writer",
    continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-closure" });
  assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
  assert.equal((await operations.initializeCycle(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  const cycle = "cycles/C001-feature-record", productRoot = path.join(root, "product"); fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, "app.mjs"), "export const value = 3;\n");
  // Explicit fixture precondition, not proof that the whole implementation,
  // human channel or final audit ran through the process engine.
  await artifacts.withLocalEffectOwner(H, async () => {
    const status = artifacts.read(cycle + "/status.md"), current = artifacts.read("CURRENT-STATE.md"), trace = artifacts.read(cycle + "/traceability.md");
    let value = status.content;
    for (const [key, text] of Object.entries({ state: "VERIFYING", dor_state: "READY", scope_frozen: "true", usage_matrix_state: "DECLARED" })) value = value.replace(new RegExp("^" + key + ":[^\\r\\n]*", "m"), key + ": " + text);
    const changes = [[status, value], [current, current.content.replace(/^dor_state:[^\r\n]*/m, "dor_state: READY")],
      [trace, "# Fixture traceability\n\n## Status\n- Verification evidence fixture precondition.\n"]];
    for (const [row, after] of changes) artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after });
    artifacts.project(changes.map(([row]) => row.path)); return { effect_status: "confirmed" };
  });
  prepared = await operations.prepareCycleContext({ session_id: "S001" });
  assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
  git("add", "."); git("commit", "--allow-empty", "-m", "fixture verification precondition");
  const productSha = () => artifactContentHash(fs.readFileSync(path.join(productRoot, "app.mjs")));
  const originalProduct = productSha(), observeContext = () => readStandardCycleCloseContext({ targetRoot: root, productRoot, productFiles: ["app.mjs"], productSha256: productSha() });
  const initial = await observeContext(); assert.equal(initial.context.cycle_state, "VERIFYING");
  const evidence = [{ ref: "fixture:verified-check", sha256: H }], assessment = { status: "supported", rationale: "Explicit typed fixture audit authority", evidence_refs: evidence };
  const report = { contract_version: "standard-cycle-audit-report.v1", context_sha256: H, cycle_id: "C001", requirements: [{ requirement_ref: "REQ-001", ...assessment }],
    usages: [{ usage_index: 1, ...assessment }], document_reviews: [{ ref: "audit:SPEC.md", sha256: H, ...assessment, status: "reviewed" }], findings: [], recommendation: "request_closure_review", evidence_refs: evidence };
  const review = { session_id: "S001", cycle_id: "C001", audit_operation_id: op, audit_output_sha256: H, report_sha256: shadowHash(report), context_sha256: H,
    product_sha256: originalProduct, scope_sha256: H, work_complete: true, findings: [], pending: { requirements: [], usages: [], documents: [], tests: [], blocking_findings: [], risk_findings_requiring_human_decision: [] } };
  if (choice !== "retain") { report.requirements[0].status = "unsatisfied"; review.work_complete = false; review.pending.requirements = ["REQ-001"]; review.report_sha256 = shadowHash(report); }
  const question = { contract_version: "standard-cycle-closure-question.v1", operation_id: op, instance_id: "fixture", scope_id: "fixture", occurrence_id: "root/decide", intent_sha256: H,
    session_id: "S001", review, choices: cycleClosureChoices(review) };
  const decision = { contract_version: "human-cycle-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "fixture:terminal:001",
    question_sha256: shadowHash(question), subject_sha256: shadowHash(review), choice, rationale: "Explicit fixture disposition; actual human authentication is outside this component proof",
    risk_acceptances: [], evidence_refs: [{ ref: "fixture:operator", sha256: H }] };
  const instance = { instance_id: "fixture", instance_sha256: H }, input = { decision_operation_id: op };
  let fixtureTime = Date.now(); const authorityReads = [];
  const writer = createStandardCycleCloseRecord({ targetRoot: root, now: ["slow-authority", "expired"].includes(selected) ? () => fixtureTime : Date.now, readDecision: async () => {
    authorityReads.push("decision"); if (selected === "slow-authority") fixtureTime += 100000;
    return { question, decision, report };
  }, observeContext, readCurrent: () => instance });
  const frozenPlan = artifacts.read(cycle + "/plan.md"), before = initial.context_sha256;
  const preview = await writer.prepare(instance, input);
  if (!preview.can_apply) { const admission = await preWriteAdmit({ targetRoot: root, skill: "cycle-close" });
    assert.fail(JSON.stringify({ reason_code: preview.reason_code, blocking_reasons: admission.blocking_reasons, warnings: admission.warnings, runtime: { repair: admission.context.repair_layer_status, freshness: admission.context.current_state_freshness } })); }
  assert.equal((await observeContext()).context_sha256, before); assert.equal(preview.plan.changes.length, 6); assert.equal(artifacts.ownerPending(), false);
  await assert.rejects(writer.apply(instance, preview, { expectPlan: preview.plan_sha256 }), { code: "STANDARD_CYCLE_CLOSE_EXPLICIT_EFFECT_REQUIRED" });
  await assert.rejects(writer.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: async () => { throw Object.assign(Error("fixture denied"), { code: "FIXTURE_GRANT_DENIED" }); } }), { code: "FIXTURE_GRANT_DENIED" });
  assert.equal((await observeContext()).context_sha256, before); assert.equal(artifacts.ownerPending(), false); pass("preview and denied/missing effect intent leave canonical verification state unchanged");
  if (selected === "partial") {
    const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: root }));
    try { db.exec(`CREATE TRIGGER fixture_abort_terminal_trace BEFORE INSERT ON artifacts WHEN NEW.path='${cycle}/traceability.md' BEGIN SELECT RAISE(ABORT,'fixture partial closure'); END`); }
    finally { db.close(); }
  }
  const write = fs.writeFileSync; let result;
  try {
    if (selected === "projection") fs.writeFileSync = (file, ...args) => {
      if (typeof file === "string" && path.resolve(file) === path.resolve(root, "docs/audit", cycle, "status.md")) return;
      return write(file, ...args);
    };
    const apply = () => writer.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: async () => {
      if (selected === "stale") fs.writeFileSync(path.join(productRoot, "app.mjs"), "export const value = 4;\n");
      authorityReads.push("grant"); if (selected === "expired") fixtureTime += 300001;
    } });
    if (["stale", "expired"].includes(selected)) {
      await assert.rejects(apply(), { code: selected === "expired" ? "STANDARD_PLAN_EXPIRED" : "STANDARD_CYCLE_CLOSE_SOURCE_STALE" }); assert.match(artifacts.read(cycle + "/status.md").content, /^state: VERIFYING$/m);
      assert.equal(artifacts.ownerPending(), false); pass(selected === "expired" ? "expired preview refuses before the first canonical write under the unchanged deadline" : "fresh authorization cannot conceal an external product change before the first canonical write");
    } else result = await apply();
  } finally { fs.writeFileSync = write; }
  if (result) {
    assertStandardOperationOutput(result);
    assert.deepEqual(validateJsonSchemaDefinition(outputSchema, "#", { contractKind: "workflow-definition" }), []);
    assert.deepEqual(validateJsonSchema(result, outputSchema, "$", { contractKind: "workflow-definition" }), []);
    const falseSuccess = structuredClone(result); falseSuccess.facts.cycle_close_completed = true;
    assert.ok(validateJsonSchema(falseSuccess, outputSchema, "$", { contractKind: "workflow-definition" }).length);
    if (["partial", "projection"].includes(selected)) {
      assert.equal(result.outcome, "reconciliation_required", JSON.stringify(result)); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {});
      assert.equal(result.observations.committed.length, selected === "partial" ? 1 : 6); assert.equal(artifacts.ownerPending(), true);
      assert.equal((await writer.prepare(instance, input)).reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED"); pass("partial canonical writes and lost required projection retain owner, uncertainty and empty success facts");
    } else {
      assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.effect_status, "confirmed");
      assert.deepEqual(result.facts, { cycle_terminal_recorded: true, cycle_retained: choice === "retain", cycle_close_completed: false });
      assert.equal(result.observations.skill_completion, "pending"); assert.equal(result.observations.closure_hook, "pending"); assert.equal(result.observations.committed.length, 6);
      assert.equal((await observeContext()).context.context_use, "cycle_completion"); assert.equal(artifacts.ownerPending(), false);
      assert.match(artifacts.read("CURRENT-STATE.md").content, /^active_cycle: none$/m); assert.match(artifacts.read(cycle + "/status.md").content, new RegExp("^state: " + targetState + "$", "m"));
      if (choice !== "retain") { assert.match(artifacts.read(cycle + "/status.md").content, /^usage_matrix_state: PARTIAL$/m); assert.ok(artifacts.read(cycle + "/traceability.md").content.includes("REQ-001")); }
      if (selected === "slow-authority") {
        assert.ok(authorityReads.lastIndexOf("decision") > authorityReads.lastIndexOf("grant"));
        assert.ok(fixtureTime - preview.plan.prepared_at_ms <= 300000);
        pass("slow trusted authority remains fresh after the grant without redundant pre-grant verification or a larger deadline");
      }
      if (mode === "db-only") assert.equal(fs.existsSync(path.join(root, "docs/audit", cycle, "status.md")), false);
      assert.equal(artifacts.read(cycle + "/plan.md").sha256, frozenPlan.sha256); pass("six actual canonical writes establish terminal metadata while retaining pending hook and frozen plan");
      const after = (await observeContext()).context_sha256;
      await assert.rejects(writer.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: async () => {} }), cause => ["STANDARD_PREVIEW_CHANGED", "STANDARD_CYCLE_CLOSE_SOURCE_STALE"].includes(cause.code) && cause.effect_status === "no_effect");
      assert.equal((await observeContext()).context_sha256, after); assert.equal(artifacts.ownerPending(), false); pass("a repeated raw apply cannot repeat confirmed metadata effects");
    }
  }
  console.log(JSON.stringify({ status: "PASS", checks, mode: selected, choice, proof: "canonical-close-record-component", decision_and_audit_authority: "fixture", full_process_host: "NOT_RUN", final_hook: "NOT_IMPLEMENTED", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  for (const folder of owned) { const resolved = fs.realpathSync(folder); assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith("aidn-standard-fresh-")); fs.rmSync(resolved, { recursive: true, force: true }); }
}
