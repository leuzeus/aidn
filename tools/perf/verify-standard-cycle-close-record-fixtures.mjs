import { verifyCycleCloseRenewalBoundary } from "./cycle-close-renewal-fixture-lib.mjs";
import { createStandardCycleTerminalCheckpoint } from "../../src/application/runtime/standard-cycle-terminal-checkpoint.mjs";
import { createStandardCycleCloseHook } from "../../src/application/runtime/standard-cycle-close-hook.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { completeDriftCheckFixture } from "./test-activation-fixture-lib.mjs";
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
const agedPlan = process.argv.includes("--aged-plan");
if (!["files", "dual", "db-only", "partial", "projection", "stale", "slow-authority", "expired"].includes(selected)) throw Error("CLOSE_RECORD_FIXTURE_MODE_INVALID");
const mode = selected === "partial" ? "db-only" : selected === "projection" ? "dual" : ["stale", "slow-authority", "expired"].includes(selected) ? "files" : selected;
const choice = process.argv.find(value => value.startsWith("--choice="))?.slice(9) ?? "retain";
if (!["retain", "no_go", "drop"].includes(choice)) throw Error("CLOSE_RECORD_FIXTURE_CHOICE_INVALID");
const finalFault = process.argv.find(value => value.startsWith("--final-hook-fault="))?.slice("--final-hook-fault=".length);
if (finalFault && !["event", "suffix", "projection", "grant_after"].includes(finalFault)) throw Error("CLOSE_HOOK_FIXTURE_FAULT_INVALID");
const terminalCheckpoint = process.argv.includes("--terminal-checkpoint");
const agedCheckpoint = process.argv.includes("--aged-checkpoint");
if (agedCheckpoint && !terminalCheckpoint) throw Error("CLOSE_AGED_CHECKPOINT_ARGUMENT_INVALID");
if (terminalCheckpoint && (!process.argv.includes("--final-hook") || !["files", "dual", "db-only"].includes(selected)))
  throw Error("TERMINAL_CHECKPOINT_FIXTURE_REQUIRES_PHYSICAL_FINAL_HOOK_CASE");
const terminalGrantFault = process.argv.includes("--terminal-checkpoint-fault=grant_after_git");
if (terminalGrantFault && !terminalCheckpoint) throw Error("TERMINAL_FAULT_REQUIRES_CHECKPOINT");
const expectedTerminalGrantFault = Symbol("expected terminal grant fault");
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
  let fixtureTime = Date.now() - (agedPlan ? 86400000 : 0); const authorityReads = [];
  const writer = createStandardCycleCloseRecord({ targetRoot: root, now: agedPlan || ["slow-authority", "expired"].includes(selected) ? () => fixtureTime : Date.now, readDecision: async () => {
    authorityReads.push("decision"); if (selected === "slow-authority") fixtureTime += 100000;
    return { question, decision, report };
  }, observeContext, readCurrent: () => instance });
  const frozenPlan = artifacts.read(cycle + "/plan.md"), before = initial.context_sha256;
  const preview = await writer.prepare(instance, input);
  if (!preview.can_apply) { const admission = await preWriteAdmit({ targetRoot: root, skill: "cycle-close" });
    assert.fail(JSON.stringify({ reason_code: preview.reason_code, blocking_reasons: admission.blocking_reasons, warnings: admission.warnings, runtime: { repair: admission.context.repair_layer_status, freshness: admission.context.current_state_freshness } })); }
  if (agedPlan) { fixtureTime = Date.now(); assert.ok(fixtureTime - preview.plan.prepared_at_ms >= 86400000); }
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
      authorityReads.push("grant"); if (selected === "expired") fixtureTime += 86400000;
    } });
    if (selected === "stale") {
      await assert.rejects(apply(), { code: "STANDARD_CYCLE_CLOSE_SOURCE_STALE" }); assert.match(artifacts.read(cycle + "/status.md").content, /^state: VERIFYING$/m);
      assert.equal(artifacts.ownerPending(), false); pass("fresh authorization cannot conceal an external product change before the first canonical write");
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
        pass("slow trusted authority is observed after the grant without a separate plan-age deadline");
      }
      if (agedPlan || selected === "expired") {
        assert.ok(fixtureTime - preview.plan.prepared_at_ms >= 86400000);
        pass("day-old cycle close plan remains valid with unchanged current decision, context and authorization");
      }
      if (mode === "db-only") assert.equal(fs.existsSync(path.join(root, "docs/audit", cycle, "status.md")), false);
      assert.equal(artifacts.read(cycle + "/plan.md").sha256, frozenPlan.sha256); pass("six actual canonical writes establish terminal metadata while retaining pending hook and frozen plan");
      const after = (await observeContext()).context_sha256;
      await assert.rejects(writer.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized: async () => {} }), cause => ["STANDARD_PREVIEW_CHANGED", "STANDARD_CYCLE_CLOSE_SOURCE_STALE"].includes(cause.code) && cause.effect_status === "no_effect");
      assert.equal((await observeContext()).context_sha256, after); assert.equal(artifacts.ownerPending(), false); pass("a repeated raw apply cannot repeat confirmed metadata effects");
      if (process.argv.includes('--final-hook')) {
        const hook = createStandardCycleCloseHook({ targetRoot: root, readRecorded: async () => ({ record_operation_id: op, plan: preview.plan, output: result }), observeContext, readCurrent: () => instance });
        const hookInput = { closure_operation_id: op }, hookId = 'op_' + 'b'.repeat(40);
        let hookPlan = await hook.prepare(instance, hookInput, hookId);
        if (!hookPlan.can_apply || terminalCheckpoint) {
          if (!hookPlan.can_apply) assert.equal(hookPlan.reason_code, 'STANDARD_CYCLE_CLOSE_HOOK_GATE_REQUIRED');
          // Explicit fixture precondition via the actual R05 hook. This is not
          // automatic acknowledgment or the full process model's diagnostic.
          // Explicit real Git checkpoint, verified against the immutable recorded postimages.
          if (terminalCheckpoint) {
            let checkpointClock = agedCheckpoint ? Date.now() - 86400000 : null;
            const checkpoint = createStandardCycleTerminalCheckpoint({ targetRoot: root,
              readRecorded: async () => ({ record_operation_id: op, plan: preview.plan, output: result }), observeContext, readCurrent: () => instance, now: () => checkpointClock ?? Date.now() });
            const checkpointPlan = await checkpoint.prepare(instance, hookInput, "op_" + "c".repeat(40));
            if (!checkpointPlan.can_apply) {
              const admission = await preWriteAdmit({ targetRoot: root, skill: "cycle-close" });
              assert.fail(JSON.stringify({ checkpoint: checkpointPlan, prewrite: { ok: admission.ok, admission_status: admission.admission_status,
                blocking_reasons: admission.blocking_reasons, warnings: admission.warnings } }));
            }
            const beforeHead = git("rev-parse", "HEAD"), beforeCheckpointContext = (await observeContext()).context_sha256;
            if (agedCheckpoint) { checkpointClock = null; assert.ok(Date.now() - checkpointPlan.plan.prepared_at_ms >= 86400000); }
            const malformed = structuredClone(checkpointPlan); malformed.plan.prepared_at_ms = Number.MAX_SAFE_INTEGER + 1;
            malformed.plan_sha256 = shadowHash(malformed.plan); let malformedGrantCalls = 0;
            await assert.rejects(checkpoint.apply(instance, malformed, { write: true, expectPlan: malformed.plan_sha256,
              assertAuthorized() { malformedGrantCalls++; } }), { code: "STANDARD_TERMINAL_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
            assert.equal(malformedGrantCalls, 0); assert.equal(artifacts.ownerPending(), false);
            pass("unsafe terminal checkpoint timestamp refuses before owner grant or Git mutation");
            await assert.rejects(checkpoint.apply(instance, checkpointPlan, { expectPlan: checkpointPlan.plan_sha256 }), { code: "STANDARD_TERMINAL_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
            await assert.rejects(checkpoint.apply(instance, checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256,
              assertAuthorized: () => { throw Object.assign(Error("denied"), { code: "FIXTURE_GRANT_DENIED" }); } }), { code: "FIXTURE_GRANT_DENIED", effect_status: "no_effect" });
            assert.equal(git("rev-parse", "HEAD"), beforeHead); assert.equal((await observeContext()).context_sha256, beforeCheckpointContext);
            assert.equal(artifacts.ownerPending(), false); pass("terminal checkpoint preview and denied intent preserve the reviewed state and Git");
            let terminalGrantCalls = 0;
            const checkpointResult = await checkpoint.apply(instance, checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256, assertAuthorized() {
              if (terminalGrantFault && ++terminalGrantCalls === 5)
                throw Object.assign(Error("permission gate returned without an effect of its own"), { code: "FIXTURE_POST_GIT_GRANT_LOST", effect_status: "no_effect" });
            } });
            if (terminalGrantFault) {
              assert.equal(checkpointResult.outcome, "reconciliation_required"); assert.equal(checkpointResult.effect_status, "unknown"); assert.deepEqual(checkpointResult.facts, {});
              assert.equal(checkpointResult.observations.reason_code, "FIXTURE_POST_GIT_GRANT_LOST");
              assert.notEqual(git("rev-parse", "HEAD"), beforeHead); assert.equal(git("status", "--porcelain"), "");
              assert.equal(artifacts.ownerPending(), true);
              pass("lost grant after a confirmed Git commit preserves unknown and ownership despite a no-effect permission error");
              throw expectedTerminalGrantFault;
            }
            assert.equal(checkpointResult.outcome, "completed", JSON.stringify(checkpointResult));
            if (agedCheckpoint) pass("day-old terminal cycle checkpoint applies with current recorded source, admission, Git and grant");
            assert.equal(checkpointResult.facts.cycle_terminal_checkpoint_completed, true); assert.equal(checkpointResult.facts.cycle_close_completed, false);
            assert.equal(checkpointResult.observations.reload.cache_written, true); assert.equal(git("status", "--porcelain"), "");
            const count = git("rev-list", "--count", "HEAD");
            if (checkpointResult.facts.cycle_terminal_commit_created)
              await assert.rejects(checkpoint.apply(instance, checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256, assertAuthorized() {} }), { code: "STANDARD_TERMINAL_CHECKPOINT_PREVIEW_CHANGED", effect_status: "no_effect" });
            const reopened = createStandardCycleTerminalCheckpoint({ targetRoot: root,
              readRecorded: async () => ({ record_operation_id: op, plan: preview.plan, output: result }), observeContext, readCurrent: () => instance });
            const observedPlan = await reopened.prepare(instance, hookInput, "op_" + "d".repeat(40));
            assert.equal(observedPlan.can_apply, true);
            const observedResult = await reopened.apply(instance, observedPlan, { write: true, expectPlan: observedPlan.plan_sha256, assertAuthorized() {} });
            assert.equal(observedResult.outcome, "completed"); assert.equal(observedResult.facts.cycle_terminal_commit_created, false);
            assert.equal(git("rev-list", "--count", "HEAD"), count); assert.equal(artifacts.ownerPending(), false);
            pass("real terminal Git checkpoint and completion reload preserve canonical postimages and cannot repeat a confirmed commit");
          } else {
            git('add', '.'); git('commit', '--allow-empty', '-m', 'fixture approved terminal metadata checkpoint');
            const reload = await runReloadCheckUseCase({ targetRoot: root, completionCycleId: 'C001', args: {
              cache: '.aidn/runtime/cache/reload-state.json', stateMode: mode, stateModeExplicit: true,
              indexFile: '.aidn/runtime/index/workflow-index.sqlite', indexBackend: 'auto', writeCache: true,
            } });
            assert.notEqual(reload.decision, 'stop');
          }
          completeDriftCheckFixture(root);
          hookPlan = await hook.prepare(instance, hookInput, hookId);
        }
        assert.equal(hookPlan.can_apply, true, JSON.stringify(hookPlan));
        if (selected === "files" && !finalFault && process.argv.includes("--late-objective-expiry")) {
          const renewalProof = await verifyCycleCloseRenewalBoundary({ targetRoot: root, instance, input: hookInput, operationId: hookId, prepared: hookPlan,
            readRecorded: async () => ({ record_operation_id: op, plan: preview.plan, output: result }), observeContext });
          checks += renewalProof.checks; console.log(JSON.stringify(renewalProof));
        }
        const eventFile = path.join(root, '.aidn/runtime/perf/workflow-events.ndjson'), beforeHook = fs.readFileSync(eventFile);
        await assert.rejects(hook.apply(instance, hookPlan, { write: true, expectPlan: hookPlan.plan_sha256, assertAuthorized: () => { throw Object.assign(Error('fixture denied'), { code: 'FIXTURE_GRANT_DENIED' }); } }), { code: 'FIXTURE_GRANT_DENIED' });
        assert.deepEqual(fs.readFileSync(eventFile), beforeHook); assert.equal(artifacts.ownerPending(), false);
        if (process.argv.includes("--delayed-hook-fences")) {
          let readsBeforeEffect = 0, grantChecks = 0;
          const lateRefusal = Object.assign(Error("fixture grant lost after locked preparation"), { code: "FIXTURE_GRANT_LOST_AFTER_PREPARE" });
          const fenced = createStandardCycleCloseHook({ targetRoot: root,
            readRecorded: async () => {
              assert.equal(grantChecks, 1);
              readsBeforeEffect++;
              return { record_operation_id: op, plan: preview.plan, output: result };
            },
            observeContext, readCurrent: () => instance });
          await assert.rejects(fenced.apply(instance, hookPlan, { write: true, expectPlan: hookPlan.plan_sha256,
            assertAuthorized: () => { if (++grantChecks === 2) throw lateRefusal; } }),
          { code: "FIXTURE_GRANT_LOST_AFTER_PREPARE", effect_status: "no_effect" });
          assert.equal(grantChecks, 2);
          assert.equal(readsBeforeEffect, 1);
          assert.deepEqual(fs.readFileSync(eventFile), beforeHook);
          assert.equal(artifacts.ownerPending(), false);
          pass("one authenticated locked preparation precedes the independent final grant check");
          for (const fault of ["revoked", "expired"]) {
            let clock = Date.now(), lost = false;
            const probe = createStandardCycleCloseHook({ targetRoot: root, readRecorded: async () => ({ record_operation_id: op, plan: preview.plan, output: result }),
              observeContext, readCurrent: () => instance, now: () => clock,
              readObjectiveCompletion: async () => { await new Promise(resolve => setImmediate(resolve)); lost = true;
                if (fault === "expired") clock = hookPlan.plan.prepared_at_ms + 300001; return null; } });
            await assert.rejects(probe.apply(instance, hookPlan, { write: true, expectPlan: hookPlan.plan_sha256,
              assertAuthorized: () => { if (lost && fault === "revoked") throw Error("fixture delayed grant revoked"); } }),
              error => error.effect_status === "no_effect" && (fault === "revoked" ? /delayed grant revoked/.test(error.message) : error.code === "STANDARD_CYCLE_CLOSE_HOOK_SOURCE_CHANGED"));
            assert.deepEqual(fs.readFileSync(eventFile), beforeHook); assert.equal(artifacts.ownerPending(), false);
            pass(`closure ${fault} during awaited evidence read refuses before checkpoint effects`);
          }
        }
        if (finalFault === 'suffix') {
          assert.notEqual(mode, 'files'); const db = new (getDatabaseSync())(resolveRuntimeSqliteFile({ targetRoot: root }));
          try { db.exec(`CREATE TRIGGER fixture_abort_close_completion BEFORE INSERT ON artifacts WHEN NEW.path='${cycle}/status.md' AND CAST(NEW.content AS TEXT) LIKE '%"cycle_close_completed": true%' BEGIN SELECT RAISE(ABORT,'fixture completion suffix'); END`); }
          finally { db.close(); }
        }
        let finalized, grants = 0; const open = fs.openSync, write = fs.writeFileSync;
        try {
          if (finalFault === 'event') fs.openSync = (file, ...args) => {
            if (typeof file === 'string' && path.resolve(file) === path.resolve(eventFile) && fs.statSync(file).size > beforeHook.length) throw Object.assign(Error('fixture event confirmation lost'), { code: 'FIXTURE_CLOSE_EVENT_LOST' });
            return open(file, ...args);
          };
          if (finalFault === 'projection') { assert.equal(mode, 'dual'); fs.writeFileSync = (file, ...args) => {
            if (typeof file === 'string' && path.resolve(file) === path.resolve(root, 'docs/audit/CURRENT-STATE.md')) return;
            return write(file, ...args);
          }; }
          finalized = await hook.apply(instance, hookPlan, { write: true, expectPlan: hookPlan.plan_sha256, assertAuthorized: () => {
            grants++; if (finalFault === 'grant_after' && fs.statSync(eventFile).size > beforeHook.length) throw Object.assign(Error('fixture authorization revoked after checkpoint'), { code: 'FIXTURE_GRANT_REVOKED_AFTER_HOOK' });
          } });
        } finally { fs.openSync = open; fs.writeFileSync = write; }
        const afterHook = fs.readFileSync(eventFile); assert.notDeepEqual(afterHook, beforeHook);
        if (finalFault) {
          assert.equal(finalized.outcome, 'reconciliation_required', JSON.stringify(finalized)); assert.equal(finalized.effect_status, 'unknown'); assert.deepEqual(finalized.facts, {});
          assert.ok(finalized.observations.hook.payload.checkpoint); assert.equal(artifacts.ownerPending(), true);
          assert.equal(finalized.observations.committed.length, finalFault === 'projection' ? 3 : 0);
          await assert.rejects(hook.apply(instance, hookPlan, { write: true, expectPlan: hookPlan.plan_sha256, assertAuthorized: () => {} }), { code: 'STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED' });
          assert.deepEqual(fs.readFileSync(eventFile), afterHook);
          pass('lost hook or completion confirmation retains unknown effects and prohibits a repeated checkpoint');
        } else {
          assert.equal(finalized.outcome, 'completed', JSON.stringify(finalized)); assert.equal(finalized.effect_status, 'confirmed');
          assert.deepEqual(finalized.facts, { cycle_close_completed: true, cycle_retained: choice === 'retain' }); assert.equal(finalized.observations.committed.length, 3);
          assert.ok(finalized.observations.hook.payload.checkpoint); assert.equal(finalized.observations.event.event, 'checkpoint_summary');
          assert.ok(!artifacts.read('CURRENT-STATE.md').content.includes('Finalize the cycle-close hook'));
          assert.match(artifacts.read('snapshots/context-snapshot.md').content, /cycle-close checkpoint completed/);
          assert.equal(artifacts.read(cycle + '/plan.md').sha256, frozenPlan.sha256); assert.equal(artifacts.ownerPending(), false);
          await assert.rejects(hook.apply(instance, hookPlan, { write: true, expectPlan: hookPlan.plan_sha256, assertAuthorized: () => {} }));
          assert.deepEqual(fs.readFileSync(eventFile), afterHook); assert.equal(artifacts.ownerPending(), false);
          pass('actual correlated cycle-close checkpoint and confirmed three-document completion do not repeat the hook');
        }
      }

    }
  }
  console.log(JSON.stringify({ status: "PASS", checks, mode: selected, choice, final_hook_fault: finalFault ?? null, proof: "canonical-close-record-component", decision_and_audit_authority: "fixture", full_process_host: "NOT_RUN", final_hook: process.argv.includes("--final-hook") ? "actual-fixed-hook-component" : "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
 } catch (cause) {
  if (cause !== expectedTerminalGrantFault) throw cause;
  console.log(JSON.stringify({ status: "PASS", checks, mode, choice, proof: "terminal-post-git-authorization-fault", effect_status: "unknown", owner_retained: true,
    final_hook: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN", full_process_host: "NOT_RUN" }));
} finally {
  for (const folder of owned) { if (process.argv.includes("--retain-always")) { console.log(JSON.stringify({ retained_fixture: folder })); continue; } const resolved = fs.realpathSync(folder); assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith("aidn-standard-fresh-")); fs.rmSync(resolved, { recursive: true, force: true }); }
}
