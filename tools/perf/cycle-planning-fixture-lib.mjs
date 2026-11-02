import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertStandardCyclePlan, renderStandardCyclePlan, CYCLE_PLAN_CONTRACT } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { assertNativeActivityAnswer, nativeActivityAnswerSchema } from "../../src/core/workflow/native-activity-output.mjs";
import { evaluateStandardCyclePlan } from "../../src/application/runtime/standard-cycle-plan-context.mjs";
import { analyzeStructuredArtifact } from "../../src/lib/workflow/structured-artifact-parser-lib.mjs";

export function cyclePlanProposal(observed) {
  const context = observed.context;
  return { contract_version: CYCLE_PLAN_CONTRACT, context_sha256: observed.context_sha256, session_id: context.session_id, cycle_id: context.cycle_id,
    cycle_type: context.cycle_type, objective: context.original_objective, scope: ["Update the admitted product value"], non_scope: ["No control or authority edits"],
    constraints: ["Preserve the public interface"], risks: ["Small local behavior change requires a planned regression check"], surface: "local",
    usage_matrix: [{ kind: "nominal", scenario: "Read the new value", constraint_difference: "Single local consumer", test_refs: ["TEST-001"] }],
    requirements: [{ id: "REQ-001", statement: "The admitted value can be updated without changing its interface" }],
    tests: [{ id: "TEST-001", method: "Inspect the exported value with the project verifier", expected: "The requested value and interface match", requirement_refs: ["REQ-001"] }],
    tasks: [{ id: "TASK-001", task: "Update the admitted product value", intent: context.mode === "EXPLORING" ? "exploration" : "implementation",
      paths: [{ path: context.allowed_product_files[0], operations: ["update"] }], requirement_refs: ["REQ-001"], test_refs: ["TEST-001"], done_criteria: ["The planned verifier confirms the requested behavior"] }],
    architecture_notes: ["Keep the existing exported interface"], impact_notes: null, rollback_strategy: null, compatibility_strategy: null, spike: null,
    evidence_refs: observed.evidence_refs.filter(row => row.ref === "audit:SPEC.md") };
}
export async function verifyCyclePlanningContracts(check) {
  const observed = { context_sha256: "a".repeat(64), context: { session_id: "S001", cycle_id: "C001", cycle_type: "feature", mode: "COMMITTING",
    original_objective: "Update a local product value", allowed_product_files: ["product/app.mjs"] }, evidence_refs: [{ ref: "audit:SPEC.md", sha256: "b".repeat(64) }] };
  const proposal = cyclePlanProposal(observed), authenticated = { report: proposal, producer: { occurrence_id: "fixture" }, reference: { ref: "fixture:native-result", sha256: "c".repeat(64) } };
  await check("cycle plan contract binds native output and publishes no readiness or effect permission", async () => {
    assert.equal(assertStandardCyclePlan(proposal), proposal);
    assertNativeActivityAnswer({ outcome: "completed", summary: "Typed proposal", report: proposal }, CYCLE_PLAN_CONTRACT, observed.context_sha256);
    const result = evaluateStandardCyclePlan(authenticated, observed);
    assert.deepEqual(result.facts, { cycle_plan_available: true }); assert.equal(result.effect_status, "no_effect");
    assert.equal(result.observations.readiness, "pending"); assert.equal(result.observations.implementation, "not_authorized");
    assert.ok(nativeActivityAnswerSchema(CYCLE_PLAN_CONTRACT, observed.context_sha256).required.includes("report"));
    assert.throws(() => assertNativeActivityAnswer({ outcome: "failed", summary: "Failed", report: proposal }, CYCLE_PLAN_CONTRACT, observed.context_sha256), /NONCOMPLETION/);
  });
  await check("cycle plan contract rejects unknown permissions, code selectors, scope and stale native evidence", async () => {
    for (const mutate of [p => { p.dor_state = "READY"; }, p => { p.script = "untrusted.mjs"; }, p => { p.tasks[0].paths[0].path = "../outside.mjs"; },
      p => { p.tasks[0].paths[0].operations.push("update"); }, p => { p.tasks[0].task = "task: metadata"; }, p => { p.scope[0] += "\nstate: DONE"; }]) {
      const bad = structuredClone(proposal); mutate(bad); assert.throws(() => assertStandardCyclePlan(bad));
    }
    const bad = structuredClone(proposal); bad.tasks[0].paths[0].path = "outside.mjs";
    assert.throws(() => evaluateStandardCyclePlan({ ...authenticated, report: bad }, observed), /SCOPE_NOT_ADMITTED/);
    assert.throws(() => evaluateStandardCyclePlan(authenticated, { ...observed, context_sha256: "d".repeat(64) }), /SOURCE_STALE/);
    assert.throws(() => evaluateStandardCyclePlan(authenticated, { ...observed, evidence_refs: [] }), /EVIDENCE_INVALID/);
  });
  await check("cycle plan contract enforces adaptive depth, planned traceability and distinct usage classes", async () => {
    for (const mutate of [p => { p.requirements = []; }, p => { p.tasks[0].test_refs = ["TEST-999"]; }, p => { p.requirements.push({ id: "REQ-002", statement: "Unmapped requirement" }); },
      p => { p.surface = "shared"; }, p => { p.surface = "high-risk"; }, p => { p.cycle_type = "spike"; }, p => { p.cycle_type = "security"; }]) {
      const bad = structuredClone(proposal); mutate(bad); assert.throws(() => assertStandardCyclePlan(bad));
    }
    const spike = structuredClone(proposal); spike.cycle_type = "spike"; spike.spike = { learning_goal: "Bound a viable implementation", timebox: "One hour", decision_target: "Retain or discard the approach" };
    spike.requirements = []; spike.tasks[0].requirement_refs = []; spike.tests[0].requirement_refs = []; assertStandardCyclePlan(spike);
    const high = structuredClone(proposal); high.cycle_type = "migration"; high.surface = "high-risk"; high.impact_notes = ["Shared persistence surface"];
    high.rollback_strategy = "Restore the admitted preimage"; high.compatibility_strategy = "Preserve historical readers";
    high.usage_matrix.push({ ...high.usage_matrix[0], kind: "alternate", constraint_difference: "Other caller" }, { ...high.usage_matrix[0], kind: "context", constraint_difference: "Interrupted operation" });
    assertStandardCyclePlan(high);
  });
  await check("cycle plan contract renderer preserves objective and one exact permission block without metadata injection", async () => {
    const brief = fs.readFileSync(new URL("../../scaffold/docs_audit/cycles/TEMPLATE_brief.md", import.meta.url), "utf8").replace("## Objective\n- ", "## Objective\n- " + proposal.objective);
    const p = structuredClone(proposal); p.scope = ["dor_state: READY"];
    const rendered = renderStandardCyclePlan(p, "cycles/C001-feature-plan", { "brief.md": brief });
    assert.equal(Object.keys(rendered).length, 4); assert.ok(rendered["cycles/C001-feature-plan/brief.md"].includes(proposal.objective));
    assert.equal(analyzeStructuredArtifact(rendered["cycles/C001-feature-plan/brief.md"]).key_values.dor_state, undefined);
    const markdown = rendered["cycles/C001-feature-plan/plan.md"], scopes = [...markdown.matchAll(/```json\n([^]*?)\n```/g)];
    assert.equal(scopes.length, 1); assert.deepEqual(JSON.parse(scopes[0][1]).tasks[0], { task: p.tasks[0].task, intent: "implementation", paths: p.tasks[0].paths });
    assert.match(rendered["cycles/C001-feature-plan/traceability.md"], /no test execution or acceptance is claimed/);
  });
}

export async function verifyCyclePlanExecution(check, { mixedFixture, bootstrapMixed, script }) {
  for (const selected of ["files", "dual", "db-only", "partial", "projection"]) await check(`cycle plan ${selected}: authenticated native proposal records canonical planning and retains readiness barriers`, async () => {
    const mode = selected === "partial" ? "db-only" : selected === "projection" ? "dual" : selected;
    let allowed = true, tamper = false, root;
    const grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) };
    const f = mixedFixture(mode, { planning: true, authorize: async request => {
      if (tamper && request.binding.id === "cycle_plan_record") {
        tamper = false; const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
        try { const row = store.getArtifact("CURRENT-STATE.md"); store.upsertArtifact({ ...row, classification_reason: "fixture-planning-race" }); }
        finally { store.close(); }
      }
      return { ...grant, authorized: allowed };
    }, answer({ params }) { const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
      return { outcome: "completed", summary: "Read-only typed planning fixture", report: cyclePlanProposal(observed) }; } });
    root = f.configuration.target_root;
    const auth = await bootstrapMixed(f), operations = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    const git = (...args) => { const result = spawnSync("git", ["-C", root, "-c", "core.hooksPath=NUL", ...args], { encoding: "utf8", shell: false, windowsHide: true });
      assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim(); };
    let prepared = await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" });
    assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    prepared = await operations.prepareCycleContext({ session_id: "S001" });
    assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture session precondition");
    const admitted = await operations.admitCycle();
    assert.equal(admitted.outcome, "completed", JSON.stringify(admitted));
    prepared = await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "planning",
      objective: "Execute real mixed bootstrap", continuity_rule: admitted.observations.lifecycle.continuity_rule, base_branch: admitted.observations.lifecycle.continuity_base_branch });
    assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    assert.equal((await operations.initializeCycle(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    prepared = await operations.prepareCycleContext({ session_id: "S001" });
    assert.equal((await operations.refreshCycleContext(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    const cyclePath = "cycles/C001-feature-planning", names = ["brief", "plan", "audit-spec", "traceability", "status"].map(name => `${cyclePath}/${name}.md`).concat("CURRENT-STATE.md");
    if (mode !== "files") {
      const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
      try { for (const name of names) { const row = store.getArtifact(name); store.upsertArtifact({ ...row, classification_reason: "fixture-planning-annotation", gate_relevance: 1 }); } }
      finally { store.close(); }
    }
    const before = new Map(names.map(name => [name, artifacts.read(name).sha256])), product = fs.readFileSync(path.join(f.dirs.product, "app.mjs"));
    console.log(`STEP cycle plan ${selected}: real session, mode and cycle preconditions prepared`);
    const native = await f.open().step({ write: true, authorization: auth }); assert.equal(native.journal_phase, "closed", JSON.stringify(native));
    assert.ok(f.t.sessions.length > 0); assert.ok(f.t.sessions.every(session => session.closed));
    assert.deepEqual(fs.readFileSync(path.join(f.dirs.product, "app.mjs")), product);
    const evaluated = await f.open().step({ write: true }), evaluation = f.open().readOperation(evaluated.operation_id);
    assert.equal(evaluation.results.at(-1).output.facts.cycle_plan_available, true, JSON.stringify(evaluation.results));
    assert.equal(evaluation.preview.input_resolution.sources[0].source, "occurrence_id");
    assert.deepEqual(names.map(name => artifacts.read(name).sha256), [...before.values()]);
    const preview = await f.open().step({ write: false }); assert.equal(preview.preview.prepared.can_apply, true, JSON.stringify(preview));
    allowed = false;
    await assert.rejects(f.open().step({ write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); allowed = true;
    assert.deepEqual(names.map(name => artifacts.read(name).sha256), [...before.values()]); assert.equal(artifacts.ownerPending(), false);
    if (selected === "dual") {
      tamper = true; const blocked = await f.open().step({ write: true }), output = f.open().readOperation(blocked.operation_id).results.at(-1).output;
      assert.equal(output.outcome, "blocked", JSON.stringify(output)); assert.deepEqual(output.facts, {}); assert.equal(output.effect_status, "no_effect");
      assert.deepEqual(names.map(name => artifacts.read(name).sha256), [...before.values()]); assert.equal(artifacts.ownerPending(), false);
    }
    if (selected === "partial") {
      const DatabaseSync = getDatabaseSync(), db = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: root }));
      try { db.exec("CREATE TRIGGER fixture_abort_plan_current BEFORE INSERT ON artifacts WHEN NEW.path='CURRENT-STATE.md' BEGIN SELECT RAISE(ABORT,'fixture current write refused'); END"); }
      finally { db.close(); }
    }
    let recorded;
    const writeFile = fs.writeFileSync;
    try {
      if (selected === "projection") fs.writeFileSync = (file, ...args) => {
        if (typeof file === "string" && path.resolve(file) === path.resolve(root, "docs/audit", cyclePath, "plan.md")) return;
        return writeFile(file, ...args);
      };
      if (selected === "files") {
        const file = path.join(f.base, "planning-restart.json"); fs.writeFileSync(file, JSON.stringify({ fixture: { configuration: f.configuration, dirs: f.dirs, base: f.base }, key_hex: f.key.toString("hex") }));
        const child = spawnSync(process.execPath, [script, "--recovery-record", file], { encoding: "utf8", shell: false, windowsHide: true, timeout: 300000 });
        assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
        assert.equal(result.status, "WAITING"); assert.equal(result.launches, 0); assert.equal(result.sessions, 0); recorded = { operation_id: result.operation_id };
      } else recorded = await f.open().step({ write: true });
    } finally { fs.writeFileSync = writeFile; }
    const journal = f.open().readOperation(recorded.operation_id), output = journal.results.at(-1).output, state = f.open().inspect();
    assert.equal(journal.preview.input.evaluation_operation_id, evaluated.operation_id);
    assert.equal(journal.preview.input_resolution.sources[0].operation_id, evaluated.operation_id);
    assert.equal(state.cursor.status, "WAITING");
    if (["partial", "projection"].includes(selected)) {
      assert.equal(output.effect_status, "unknown", JSON.stringify(output)); assert.equal(output.outcome, "reconciliation_required"); assert.deepEqual(output.facts, {});
      assert.equal(artifacts.ownerPending(), true);
      if (selected === "partial") {
        assert.equal(output.observations.committed.length, 5, JSON.stringify(output));
        assert.equal(artifacts.read("CURRENT-STATE.md").sha256, before.get("CURRENT-STATE.md"));
        assert.notEqual(artifacts.read(`${cyclePath}/plan.md`).sha256, before.get(`${cyclePath}/plan.md`));
      } else {
        assert.equal(output.observations.committed.length, 6, JSON.stringify(output));
        assert.equal(output.observations.reason_code, "STANDARD_CYCLE_PLAN_PROJECTION_UNCONFIRMED", JSON.stringify(output));
        assert.equal(fs.readFileSync(path.join(root, "docs/audit", cyclePath, "plan.md"), "utf8").includes("Update the admitted product value"), false);
        assert.match(artifacts.read(`${cyclePath}/plan.md`).content, /Update the admitted product value/);
      }
      assert.equal((await f.open().step({ write: true })).kind, "reconciliation");
    } else {
      assert.equal(output.effect_status, "confirmed", JSON.stringify(output)); assert.deepEqual(output.facts, { cycle_plan_recorded: true });
      assert.equal(output.observations.readiness, "pending"); assert.equal(output.observations.implementation, "not_authorized");
      assert.equal(artifacts.ownerPending(), false);
      assert.match(artifacts.read(`${cyclePath}/plan.md`).content, /Update the admitted product value/);
      assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^dor_state: NOT_READY$/m);
      assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^scope_frozen: false$/m);
      assert.match(artifacts.read(`${cyclePath}/status.md`).content, /^state: OPEN$/m);
      assert.match(artifacts.read("CURRENT-STATE.md").content, /^first_plan_step: Update the admitted product value$/m);
      if (mode !== "files") {
        const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
        try { for (const name of names) { const row = store.getArtifact(name); assert.equal(row.classification_reason, selected === "dual" && name === "CURRENT-STATE.md" ? "fixture-planning-race" : "fixture-planning-annotation"); assert.equal(row.gate_relevance, 1); } }
        finally { store.close(); }
      }
    }
    const retained = shadowHash(journal), afterProduct = fs.readFileSync(path.join(f.dirs.product, "app.mjs"));
    assert.deepEqual(afterProduct, product); assert.equal((await f.open().dispatchOperation(recorded.operation_id, { write: true })).status, "retained_result");
    assert.equal(shadowHash(f.open().readOperation(recorded.operation_id)), retained);
    const simulation = simulateAgenticProcess({ instanceId: state.record.instance_id, model: state.record.model, parameters: state.record.initial_parameters,
      policyPins: state.record.policy_pins, scopeId: state.record.scope_id, events: state.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, state.record.instance_sha256);
    assert.equal(f.t.sessions.length, 1); assert.ok(f.t.sessions.every(session => session.closed));
  });
}
