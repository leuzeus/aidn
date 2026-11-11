import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardSessionClosureContext } from "../../src/application/runtime/standard-session-closure-context.mjs";
import { createStandardSessionCloseRecord } from "../../src/application/runtime/standard-session-close-record.mjs";
import { createStandardSessionCloseCheckpoint } from "../../src/application/runtime/standard-session-close-checkpoint.mjs";
import { createStandardSessionCloseHook } from "../../src/application/runtime/standard-session-close-hook.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";
import { runReloadCheckUseCase } from "../../src/application/runtime/reload-check-use-case.mjs";
import { runSkillHookUseCase } from "../../src/application/runtime/skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { sessionClosureChoices } from "../../src/core/workflow/standard-session-closure-decision.mjs";
import { createStandardSessionDeliveryCheckpoint } from "../../src/application/runtime/standard-session-delivery-checkpoint.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) ?? "files";
const agedCheckpoint = process.argv.includes("--aged-checkpoint"), agedDelivery = process.argv.includes("--aged-delivery");
if (agedCheckpoint && !process.argv.includes("--checkpoint") || agedDelivery && !process.argv.includes("--delivery-checkpoint")) throw Error("FIXTURE_AGED_CHECKPOINT_ARGUMENT_INVALID");
if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_MODE_INVALID");
const finalFault = process.argv.find(arg => arg.startsWith("--final-hook-fault="))?.slice("--final-hook-fault=".length);
const policyFault = process.argv.includes("--constraint-policy-fault");
const delivery = process.argv.includes("--delivery-checkpoint"), deliveryFault = process.argv.includes("--delivery-grant-after-git");
if (delivery && (!process.argv.includes("--final-hook") || finalFault || policyFault) || deliveryFault && (!delivery || mode === "db-only")) throw Error("FIXTURE_DELIVERY_ARGUMENT_INVALID");
if (finalFault && (!process.argv.includes("--final-hook") || !["grant_after_hook", "suffix", "constraints"].includes(finalFault)
  || ["suffix", "constraints"].includes(finalFault) && mode === "files") || policyFault && (!process.argv.includes("--final-hook") || mode === "files")) throw Error("FIXTURE_FINAL_FAULT_INVALID");
const owned = [], temporary = fs.realpathSync(os.tmpdir()), H = "a".repeat(64), id = n => "op_" + String(n).repeat(40);
let checks = 0, completed = false;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  for (const kind of ["input", "plan", "output"]) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-session-close-${kind}.v1.schema.json`, import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
  } pass("record contracts use supported closed schema vocabulary");
  const root = createFreshStandardWorkflowFixture(mode, owned), operations = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  if (policyFault || finalFault === "constraints") {
    if (policyFault) { const file = path.join(root, ".gitignore"); fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^\.aidn\/runtime\/perf\/constraint-summary\.md\r?\n/m, "")); }
    else { const file = path.join(root, "docs/performance/CONSTRAINT_TARGETS.json"); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ version: 1, rules: [{ id: "FIXTURE_REQUIRED_RUNS", key: "summary.runs_analyzed", op: ">=", value: 999, severity: "error" }] })); }
    for (const args of [["add", "--", policyFault ? ".gitignore" : "docs/performance/CONSTRAINT_TARGETS.json"], ["commit", "-m", "test: prepare explicit closure fault"]])
      execFileSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
  }
  let plan = await operations.prepareSession({ session_id: "S001", session_branch: "S001-close-record", objective: "Prepare closure without announcing completion" });
  assert.equal((await operations.initializeSession(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  plan = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
  assert.equal((await operations.applyMode(plan, { write: true, expectPlan: plan.plan_sha256 })).outcome, "completed");
  let started = null;
  if (process.argv.includes("--final-hook")) {
    // Explicit fixture setup through real hooks; this is not a native-report
    // authenticated R05 chain. The composed-model proof supplies that separately.
    await runReloadCheckUseCase({ targetRoot: root, args: { cache: ".aidn/runtime/cache/reload-state.json", stateMode: mode, stateModeExplicit: true,
      indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: true } });
    const drift = runSkillHookUseCase({ args: { skill: "drift-check", mode: "COMMITTING", strict: true, runId: "fixture_session_start_drift" },
      perfDir: fileURLToPath(new URL("../../tools/perf/", import.meta.url)), targetRoot: root, processAdapter: createLocalProcessAdapter() });
    assert.equal(drift.ok, true, JSON.stringify(drift));
    plan = await operations.prepareStart({ session_id: "S001" });
    started = await operations.finalizeStart(plan, { write: true, expectPlan: plan.plan_sha256 });
    assert.equal(started.outcome, "completed", JSON.stringify(started)); pass("actual start hook produces the physical run later consumed by closure");
  }
  const context = await readStandardSessionClosureContext({ targetRoot: root, sessionId: "S001" }); assert.equal(context.blocked, undefined);
  const { admission_allowed, context_sha256, ...base } = context;
  const review = { ...base, context_sha256, admission_operation_id: id(1), admission_output_sha256: H, drift_evaluation_operation_id: id(2), drift_evaluation_output_sha256: H,
    drift_finalization_operation_id: id(3), drift_finalization_output_sha256: H };
  const question = { contract_version: "standard-session-closure-question.v1", operation_id: id(4), instance_id: "record_fixture", scope_id: "fixture_scope", occurrence_id: "close:0",
    intent_sha256: H, session_id: "S001", review, choices: sessionClosureChoices(review) };
  const decision = { contract_version: "human-session-closure-decision.v1", source_kind: "human", authority_id: "fixture_operator", source_event_id: "record:close:1",
    question_sha256: shadowHash(question), subject_sha256: shadowHash(review), choice: "close", rationale: "Explicit fixture request", evidence_refs: [{ ref: "fixture:operator-close", sha256: H }],
    session_report: { summary: "state: CLOSED", open_loops: ["Retain the next decision"], blockers: [], next_entry_point: "Review the actual final hook" } };
  const instance = { instance_id: "record_fixture", instance_sha256: H }; let material = { question, decision };
  const agedPlan = process.argv.includes("--aged-plan"); let preparationClock = agedPlan ? Date.now() - 86400000 : null;
  const record = createStandardSessionCloseRecord({ targetRoot: root, now: () => preparationClock ?? Date.now(), readCurrent: () => instance, readDecision: async () => {
    const current = await readStandardSessionClosureContext({ targetRoot: root, sessionId: "S001" });
    if (current.context_sha256 !== context_sha256) throw Error("FIXTURE_REVIEW_STALE"); return structuredClone(material);
  } });
  const input = { decision_operation_id: id(4) }, before = context.documents.map(row => [row.ref, artifacts.read(row.ref.slice(6)).sha256]);
  const prepared = await record.prepare(instance, input); assert.equal(prepared.can_apply, true);
  if (agedPlan) { preparationClock = null; assert.ok(Date.now() - prepared.plan.prepared_at_ms >= 86400000); }
  assert.deepEqual(context.documents.map(row => [row.ref, artifacts.read(row.ref.slice(6)).sha256]), before); pass("actual record preview preserves canonical documents");
  await assert.rejects(() => record.apply(instance, prepared, { expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} }));
  assert.equal(artifacts.ownerPending(), false); pass("implicit write refused before ownership or mutation");
  await assert.rejects(() => record.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => { throw Error("FIXTURE_AUTHORITY_DENIED"); } }));
  assert.equal(artifacts.ownerPending(), false); pass("denied external authority leaves no effect owner");
  const tampered = structuredClone(prepared); tampered.plan.changes[0].text_chunks[0] += "changed";
  await assert.rejects(() => record.apply(instance, tampered, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} })); pass("changed deterministic postimage refused");
  const result = await record.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} });
  assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.equal(result.effect_status, "confirmed");
  assert.deepEqual(result.facts, { session_close_report_recorded: true, session_close_completed: false }); assert.equal(artifacts.ownerPending(), false);
  if (agedPlan) pass("day-old session report plan applies with current decision, scope and canonical preimages");
  assert.match(artifacts.read("sessions/S001.md").content, /^state: OPEN$/m); assert.match(artifacts.read("CURRENT-STATE.md").content, /^active_session: S001$/m);
  assert.match(artifacts.read("sessions/S001.md").content, /^session_closure_status: checkpoint_pending$/m);
  assert.match(artifacts.read("sessions/S001.md").content, /- "state: CLOSED"/);
  assert.doesNotMatch(artifacts.read("sessions/S001.md").content, /- \[x\] Yes/); pass("actual canonical CAS records report while keeping OPEN, owner and final hook pending");
  for (const row of result.observations.postimages) { assert.equal(artifacts.read(row.path).sha256, row.sha256); assert.equal(artifacts.metadataHash(row.path), row.metadata_sha256); }
  pass("finite three-document postimages and canonical metadata are verified");
  await assert.rejects(() => record.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: async () => {} }));
  assert.equal(artifacts.ownerPending(), false); pass("stale request cannot repeat the report effect");
  if (process.argv.includes("--checkpoint")) {
    const postimages = result.observations.postimages, git = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: postimages.map(row => "docs/audit/" + row.path) });
    const beforeGit = git.inspect(), checkpointSource = { record_operation_id: id(5), session_id: "S001", material_sha256: shadowHash({ prepared, result }),
      branch: beforeGit.branch, parent_head: beforeGit.head, completion_cycle_id: null, postimages };
    let checkpointClock = agedCheckpoint ? Date.now() - 86400000 : null;
    const checkpoint = createStandardSessionCloseCheckpoint({ targetRoot: root, readSource: () => structuredClone(checkpointSource), readCurrent: () => instance, now: () => checkpointClock ?? Date.now() });
    const cpInput = { record_operation_id: id(5) }, foreign = path.join(root, "foreign-close.txt");
    fs.writeFileSync(foreign, "Foreign change must never be captured.\n");
    await assert.rejects(() => checkpoint.prepare(instance, cpInput, id(6))); fs.unlinkSync(foreign);
    assert.equal(git.inspect().head, beforeGit.head); pass("finite checkpoint refuses foreign worktree change before Git mutation");
    const cp = await checkpoint.prepare(instance, cpInput, id(6)); assert.equal(cp.can_apply, true, JSON.stringify(cp));
    if (agedCheckpoint) { checkpointClock = null; assert.ok(Date.now() - cp.plan.prepared_at_ms >= 86400000); }
    await assert.rejects(() => checkpoint.apply(instance, cp, { expectPlan: cp.plan_sha256, assertAuthorized: async () => {} }));
    assert.equal(git.inspect().head, beforeGit.head); pass("checkpoint requires explicit write and retained plan");
    const fault = process.argv.includes("--checkpoint-fault=grant_after_git");
    const cpResult = await checkpoint.apply(instance, cp, { write: true, expectPlan: cp.plan_sha256, assertAuthorized: async () => {
      if (fault && git.inspect().head !== beforeGit.head) throw Error("FIXTURE_GRANT_LOST_AFTER_GIT");
    } });
    if (cp.plan.git.files.length) assert.notEqual(git.inspect().head, beforeGit.head);
    else assert.equal(git.inspect().head, beforeGit.head);
    assert.equal(git.inspect().changes.length, 0);
    if (fault) {
      assert.equal(cpResult.outcome, "reconciliation_required"); assert.equal(cpResult.effect_status, "unknown"); assert.deepEqual(cpResult.facts, {}); assert.equal(artifacts.ownerPending(), true);
      const retainedHead = git.inspect().head;
      assert.equal((await checkpoint.prepare(instance, cpInput, id(7))).can_apply, false); assert.equal(git.inspect().head, retainedHead);
      pass("lost permission after actual Git retains unknown effect and owner without repeating checkpoint");
    } else {
      assert.equal(cpResult.outcome, "completed", JSON.stringify(cpResult)); assert.equal(cpResult.facts.session_close_completed, false);
      assert.equal(cpResult.observations.reload.head_commit, git.inspect().head); assert.equal(artifacts.ownerPending(), false);
      assert.match(artifacts.read("sessions/S001.md").content, /^state: OPEN$/m);
      pass("actual finite Git commit and reload confirm checkpoint while session completion remains pending");
      if (agedCheckpoint) pass("day-old session close checkpoint applies with current postimages, Git and live grant");
      if (process.argv.includes("--final-hook")) {
        const selected = { record_operation_id: id(5), checkpoint_operation_id: id(6), session_id: "S001", session_path: "sessions/S001.md", mode: "COMMITTING",
          branch: beforeGit.branch, start_output: started, checkpoint_output: cpResult };
        const finalizer = createStandardSessionCloseHook({ targetRoot: root, readSource: () => structuredClone(selected), readCurrent: () => instance });
        const finalInput = { record_operation_id: id(5), checkpoint_operation_id: id(6) }, finalPlan = await finalizer.prepare(instance, finalInput, id(8));
        if (policyFault) {
          assert.equal(finalPlan.can_apply, false); assert.equal(finalPlan.reason_code, "STANDARD_SESSION_CLOSE_CONSTRAINT_PROJECTION_POLICY_REQUIRED");
          assert.equal(fs.existsSync(path.join(root, ".aidn/runtime/perf/current-run-id.txt")), true); assert.equal(artifacts.ownerPending(), false);
          pass("missing telemetry ignore policy refuses before final hook or run consumption");
        } else {
        assert.equal(finalPlan.can_apply, true, JSON.stringify(finalPlan));
        const runFile = path.join(root, ".aidn/runtime/perf/current-run-id.txt"), runBytes = fs.readFileSync(runFile);
        fs.writeFileSync(runFile, "foreign_run\n"); await assert.rejects(() => finalizer.prepare(instance, finalInput, id(8))); fs.writeFileSync(runFile, runBytes);
        pass("changed start run refuses without invoking the final hook");
        await assert.rejects(() => finalizer.apply(instance, finalPlan, { expectPlan: finalPlan.plan_sha256, assertAuthorized: async () => {} }));
        assert.equal(fs.existsSync(path.join(root, ".aidn/runtime/perf/current-run-id.txt")), true); pass("implicit final hook cannot consume the start run");
        const final = await finalizer.apply(instance, finalPlan, { write: true, expectPlan: finalPlan.plan_sha256, assertAuthorized: async () => {
          if (!fs.existsSync(runFile)) {
            if (finalFault === "grant_after_hook") throw Error("FIXTURE_AUTHORITY_LOST_AFTER_CLOSE_HOOK");
            if (finalFault === "suffix") { const DatabaseSync = getDatabaseSync(), db = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root }));
              try { db.exec("CREATE TRIGGER IF NOT EXISTS fixture_abort_session_completion BEFORE UPDATE ON artifacts WHEN NEW.path='CURRENT-STATE.md' AND CAST(NEW.content AS TEXT) LIKE '%session_closure_status: completed%' BEGIN SELECT RAISE(ABORT,'fixture session completion suffix'); END"); } finally { db.close(); } }
          }
        } });
        if (finalFault) {
          assert.equal(final.outcome, "reconciliation_required", JSON.stringify(final)); assert.equal(final.effect_status, "unknown"); assert.deepEqual(final.facts, {});
          assert.equal(fs.existsSync(runFile), false); assert.equal(artifacts.ownerPending(), true);
          const rows = fs.readFileSync(path.join(root, ".aidn/runtime/perf/workflow-events.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line));
          assert.equal(rows.filter(row => row.event === "hook_session_close" && row.run_id === finalPlan.plan.run_id).length, 1);
          assert.equal((await finalizer.prepare(instance, finalInput, id(9))).can_apply, false);
          pass("actual " + finalFault + " failure after run consumption retains unknown owner and empty facts without repeating hook");
        } else {
        assert.equal(final.outcome, "completed", JSON.stringify(final)); assert.equal(final.facts.session_close_completed, true);
        assert.equal(final.observations.run_id, started.observations.hook.payload.workflow_hook.run_id);
        assert.equal(fs.existsSync(path.join(root, ".aidn/runtime/perf/current-run-id.txt")), false); assert.equal(artifacts.ownerPending(), false);
        assert.match(artifacts.read("sessions/S001.md").content, /^state: CLOSED$/m); assert.match(artifacts.read("sessions/S001.md").content, /- \[x\] Yes/);
        assert.match(artifacts.read("CURRENT-STATE.md").content, /^active_session: S001$/m);
        pass("actual final hook consumes authenticated-start run before canonical CLOSED and checked gate are recorded");
        await assert.rejects(() => finalizer.apply(instance, finalPlan, { write: true, expectPlan: finalPlan.plan_sha256, assertAuthorized: async () => {} }));
        assert.equal(artifacts.ownerPending(), false); pass("consumed start run prevents repeating the final hook");
        if (delivery) {
          for (const kind of ["input", "plan", "output"]) {
            const schema = JSON.parse(fs.readFileSync(new URL(`../../src/core/contracts/workflow-definition/standard-session-delivery-checkpoint-${kind}.v1.schema.json`, import.meta.url)));
            assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
          }
          const names = finalPlan.plan.documents.map(row => row.path), parent = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
          const eventFile = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson"), eventBytes = fs.readFileSync(eventFile);
          const cacheFile = path.join(root, ".aidn/runtime/cache/reload-state.json"), cacheBytes = fs.readFileSync(cacheFile);
          const source = { finalization_operation_id: id(9), session_id: "S001", session_path: "sessions/S001.md", branch: finalPlan.plan.branch, parent_head: parent,
            material_sha256: shadowHash(final), postimages: names.map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) })) };
          let deliveryClock = agedDelivery ? Date.now() - 86400000 : null;
          const port = createStandardSessionDeliveryCheckpoint({ targetRoot: root, readSource: async () => structuredClone(source), readCurrent: () => instance, now: () => deliveryClock ?? Date.now() });
          const deliveryId = "op_" + "d".repeat(40), input = { finalization_operation_id: id(9) }, preview = await port.prepare(instance, input, deliveryId);
          assert.equal(preview.can_apply, true); assert.equal(preview.plan.git.files.length, mode === "db-only" ? 0 : 3);
          if (agedDelivery) { deliveryClock = null; assert.ok(Date.now() - preview.plan.prepared_at_ms >= 86400000); }
          await assert.rejects(port.apply(instance, preview, { expectPlan: preview.plan_sha256, assertAuthorized() {} }), { effect_status: "no_effect" });
          pass("delivery schemas and preview require the three final canonical postimages and explicit intent");
          const foreign = path.join(root, "delivery-foreign.txt"); fs.writeFileSync(foreign, "foreign\n");
          await assert.rejects(port.prepare(instance, input, deliveryId), { code: "STANDARD_SESSION_DELIVERY_FOREIGN_CHANGE" }); fs.unlinkSync(foreign);
          pass("delivery scope rejects foreign work without including or resetting it");
          const result = await port.apply(instance, preview, { write: true, expectPlan: preview.plan_sha256, assertAuthorized() {
            const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
            if (deliveryFault && head !== parent) throw Object.assign(Error("FIXTURE_DELIVERY_GRANT_LOST"), { code: "FIXTURE_DELIVERY_GRANT_LOST" });
          } });
          if (deliveryFault) {
            assert.equal(result.outcome, "reconciliation_required"); assert.equal(result.effect_status, "unknown"); assert.deepEqual(result.facts, {});
            assert.equal(artifacts.ownerPending(), true); pass("delivery grant loss after real Git retains unknown owner and empty facts");
          } else {
            assert.equal(result.outcome, "completed", JSON.stringify(result)); assert.deepEqual(result.facts, { session_delivery_checkpoint_completed: true });
            assert.equal(result.effect_status, mode === "db-only" ? "no_effect" : "confirmed"); assert.equal(artifacts.ownerPending(), false);
            assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", windowsHide: true }).trim(), "");
            if (mode === "db-only") assert.equal(result.observations.git.head, parent);
            else assert.equal(result.observations.git.parent_sha, parent);
            pass("delivery checkpoints actual final closure writes while DB-only preserves HEAD");
            if (agedDelivery) pass("day-old session delivery plan applies with current finalization, canonical postimages and Git");
          }
          assert.deepEqual(fs.readFileSync(eventFile), eventBytes); assert.deepEqual(fs.readFileSync(cacheFile), cacheBytes);
          for (const row of source.postimages) { assert.equal(artifacts.read(row.path).sha256, row.sha256); assert.equal(artifacts.metadataHash(row.path), row.metadata_sha256); }
          assert.match(artifacts.read("sessions/S001.md").content, /^state: CLOSED$/m);
          pass("delivery preserves CLOSED data, event history and cache without repeating hook or claiming refresh");
        }
        }
        }
      }
    }
  }
  completed = true; console.log(JSON.stringify({ status: "PASS", checks, mode, ports: "actual-artifact-CAS", decision_authority: "injected-fixture", R05_chain: "NOT_RUN_HERE", session_closed: process.argv.includes("--final-hook") && !finalFault && !policyFault, final_fault: finalFault ?? null, delivery_checkpoint: delivery, delivery_fault: deliveryFault, native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally { for (const root of owned.reverse()) { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temporary);
  if (!completed && process.argv.includes("--retain-on-failure")) console.error(JSON.stringify({ retained_fixture: resolved })); else fs.rmSync(resolved, { recursive: true, force: true }); } }
