import assert from "node:assert/strict";
import { createStandardCyclePreworkAuthority } from "../../src/application/runtime/standard-cycle-prework-authority.mjs";
import { assertStandardCyclePreworkSelection, assertStandardCyclePreworkEvaluation } from "../../src/core/workflow/standard-cycle-prework.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const H = "a".repeat(64), op = digit => "op_" + digit.repeat(40);
const clone = value => structuredClone(value);
const failure = error => /^(?:STANDARD_PREWORK|STANDARD_CANONICAL_RESUME|STANDARD_EFFECT_OWNER|FIXTURE_)/.test(error.code ?? "");
function fixture(proposalFor, { canonical = false, complete = false, integrationOnly = false } = {}) {
  const state = { allowed: true, owner: false, nativeReservation: true, instanceSha: H, product: "b".repeat(64), head: "c".repeat(40),
    backend: "files", scope: "d".repeat(64), afterObserve: null, nativeReads: 0 };
  const instance = { instance_id: "prework-fixture", instance_sha256: H, events: [] };
  const planning = { contract_version: "standard-cycle-plan-context.v1", session_id: "S001", cycle_id: "C001", cycle_type: "feature",
    cycle_path: "cycles/C001-feature-prework", mode: "COMMITTING", context_use: "active_cycle", cycle_state: "OPEN",
    original_objective: "Audit the exact admitted source", product_sha256: state.product, head: state.head,
    allowed_product_files: ["product/app.mjs"], documents: ["SPEC.md", "cycles/C001-feature-prework/status.md"].map(path =>
      ({ ref: "audit:" + path, content: "Fixture source " + path, sha256: shadowHash("Fixture source " + path) })) };
  const rows = planning.documents.map(row => ({ path: row.ref.slice(6), sha256: row.sha256, metadata_sha256: H }));
  const evidenceRefs = planning.documents.map(({ ref, sha256 }) => ({ ref, sha256 }));
  const proposal = proposalFor({ context: planning, context_sha256: shadowHash(planning), evidence_refs: evidenceRefs });
  const observed = () => {
    const context = { ...clone(planning), metadata_pins: rows.map(row => ({ ref: "audit:" + row.path, sha256: row.metadata_sha256 })) };
    return { context, context_sha256: shadowHash(context), evidence_refs: clone(evidenceRefs) };
  };
  const originBinding = canonical ? "cycle_owned_resume_admit" : "cycle_initialize";
  const originOutput = canonical ? { outcome: "completed", effect_status: "no_effect", facts: { canonical_cycle_resume_available: true },
    observations: { proposal, imported_completed_task_ids: complete ? proposal.tasks.map(row => row.id) : [], cycle_path: planning.cycle_path,
      context_sha256: observed().context_sha256, work_intent: integrationOnly ? "integration_only" : "continue_implementation" } }
    : { outcome: "completed", effect_status: "confirmed", facts: { cycle_initialized: true }, observations: {} };
  const records = new Map(), originRecord = { operation_id: op("1"), intent: { binding_ref: originBinding },
    preview: { prepared: { plan: { input: { session_id: "S001", cycle_id: "C001" }, cycle_path: planning.cycle_path } } } };
  records.set(op("1"), { record: originRecord, output: originOutput });
  instance.events.push({ kind: "operation_intent", intent: { binding_ref: originBinding, operation_id: op("1") } });
  let activityInput = {}, native = null;
  const authority = createStandardCyclePreworkAuthority({
    active(_instance, { nativePreparation = false } = {}) {
      if (!state.allowed) throw Object.assign(Error("FIXTURE_AUTH_REVOKED"), { code: "FIXTURE_AUTH_REVOKED" });
      if (nativePreparation && !state.nativeReservation) throw Object.assign(Error("FIXTURE_NATIVE_RESERVATION_REQUIRED"), { code: "FIXTURE_NATIVE_RESERVATION_REQUIRED" });
    },
    readCurrent: () => ({ instance_sha256: state.instanceSha }), readProductSha256: () => state.product,
    observeScope: () => ({ scope_sha256: state.scope, head: state.head }),
    artifacts: { ownerPending: () => state.owner, describe: () => ({ backend: state.backend }),
      readMany: names => names.map(name => clone(rows.find(row => row.path === name))) },
    readAccepted(_instance, id, binding) {
      const value = records.get(id);
      if (!value || value.record.intent.binding_ref !== binding) throw Object.assign(Error("FIXTURE_ACCEPTED_SOURCE_REQUIRED"), { code: "FIXTURE_ACCEPTED_SOURCE_REQUIRED" });
      return clone(value);
    },
    async observeContext() { const value = observed(); await Promise.resolve(); state.afterObserve?.(); return value; },
    readActivityInput: () => clone(activityInput),
    readNativeActivity(_instance, _occurrence, contract) {
      assert.equal(contract, "standard-cycle-prework-report.v1"); state.nativeReads++;
      if (!native) throw Object.assign(Error("FIXTURE_NATIVE_REQUIRED"), { code: "FIXTURE_NATIVE_REQUIRED" });
      return clone(native);
    },
  });
  function retain(id, binding, output, input = {}) {
    records.set(id, { record: { operation_id: id, intent: { binding_ref: binding }, preview: { input } }, output: clone(output) });
    instance.events.push({ kind: "operation_intent", intent: { operation_id: id, binding_ref: binding } });
  }
  async function select() {
    const output = await authority.select(instance); retain(op("2"), "cycle_prework_select", output);
    activityInput = { selection_operation_id: op("2") }; return output;
  }
  async function capture() {
    const prepared = await authority.prepareActivity(instance, "root/plan"), context = prepared.context;
    const plan = proposalFor({ context: context.planning_context, context_sha256: context.planning_context_sha256, evidence_refs: prepared.evidence_refs });
    const judgement = rule => ({ verdict: "passed", rationale: "Controlled fixture judgement against current supplied source", rule_refs: [rule],
      evidence_refs: clone(evidenceRefs.filter(row => row.ref === "audit:SPEC.md")), findings: [], questions: [] });
    const report = { contract_version: "standard-cycle-prework-report.v1", kind: canonical ? "audit_canonical_plan" : "propose_plan",
      context_sha256: prepared.context_sha256, subject_sha256: shadowHash(context.subject), origin_operation_id: op("1"),
      proposal: canonical ? null : plan, audits: { intent: judgement("SPEC-R03"), architecture: judgement("SPEC-R04") } };
    native = { input: clone(activityInput), context: { occurrence_id: "root/plan", ...clone(prepared) },
      reference: { ref: "execution/fixture/activity-context.json", sha256: shadowHash(prepared) },
      authenticated: { report, producer: { instance_id: instance.instance_id, model_sha256: H, occurrence_id: "root/plan", result_id: "fixture-native" },
        reference: { ref: "execution/fixture/native-result.json", sha256: shadowHash(report) } } };
    return prepared;
  }
  return { authority, instance, state, rows, records, planning, proposal, observed, select, capture, retain,
    native: () => native, input: () => clone(activityInput) };
}

export async function verifyStandardCyclePreworkAuthorityFixtures(proposalFor) {
  const names = [], test = async (name, fn) => { await fn(); names.push(name); console.log("PASS " + name); };
  await test("prework port fixture: actual-origin data is selected and fresh planning is bound across the asynchronous observation", async () => {
    const f = fixture(proposalFor), before = clone(f.rows), selected = await f.select(), prepared = await f.capture();
    assert.equal(selected.facts.cycle_prework_required, true); assert.equal(selected.observations.subject.origin_operation_id, op("1"));
    assert.equal(prepared.context.selection_operation_id, op("2"));
    assert.notEqual(prepared.context_sha256, prepared.context.planning_context_sha256);
    const evaluated = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" });
    assert.deepEqual(evaluated.facts, { cycle_plan_available: true, cycle_plan_record_required: true, cycle_prework_passed: true });
    f.retain(op("3"), "cycle_prework_evaluate", evaluated, { report_occurrence_id: "root/plan" });
    const read = await f.authority.readEvaluation(f.instance, { evaluation_operation_id: op("3") });
    assert.equal(read.context_sha256, prepared.context.planning_context_sha256);
    assert.deepEqual(f.rows, before); assert.equal(evaluated.effect_status, "no_effect");
  });
  await test("prework port fixture: compatible fresh preparation may use its accepted initialization without a routing selector", async () => {
    const f = fixture(proposalFor), prepared = await f.capture();
    assert.equal(prepared.context.selection_operation_id, null); assert.equal(prepared.context.subject.kind, "fresh_cycle");
    assert.equal((await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" })).outcome, "completed");
  });
  await test("prework port fixture: canonical assessment preserves the proposal and cannot record a replacement", async () => {
    const f = fixture(proposalFor, { canonical: true }), before = JSON.stringify(f.proposal);
    await assert.rejects(f.authority.prepareActivity(f.instance, "root/plan"), /SELECTION_REQUIRED/);
    await f.select(); await f.capture();
    const result = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" });
    assert.equal(result.facts.cycle_plan_record_required, false); assert.equal(result.observations.report.proposal, null);
    assert.equal(JSON.stringify(f.proposal), before);
    f.retain(op("3"), "cycle_prework_evaluate", result, { report_occurrence_id: "root/plan" });
    assert.equal((await f.authority.canonicalWitness(f.instance, op("1"))).evaluation_operation_id, op("3"));
  });
  await test("prework port fixture: complete canonical DATA selects no actor and unfinished integration-only stops before an actor", async () => {
    const complete = fixture(proposalFor, { canonical: true, complete: true });
    assert.equal((await complete.select()).facts.cycle_prework_required, false);
    await assert.rejects(complete.authority.prepareActivity(complete.instance, "root/plan"), /NO_ASSESSMENT_REQUIRED/);
    assert.equal(complete.state.nativeReads, 0);
    const integration = fixture(proposalFor, { canonical: true, integrationOnly: true });
    await assert.rejects(integration.select(), /INTEGRATION_ONLY/); assert.equal(integration.state.nativeReads, 0);
  });
  await test("prework port fixture: changed permission, process, owner, product, scope, backend, content or metadata after await refuses", async () => {
    for (const mutate of [f => { f.state.allowed = false; }, f => { f.state.instanceSha = "f".repeat(64); },
      f => { f.state.owner = true; }, f => { f.state.product = "e".repeat(64); }, f => { f.state.scope = "e".repeat(64); },
      f => { f.state.backend = "other"; }, f => { f.rows[0].sha256 = "e".repeat(64); }, f => { f.rows[0].metadata_sha256 = "e".repeat(64); }]) {
      const f = fixture(proposalFor); f.state.afterObserve = () => mutate(f);
      await assert.rejects(f.select(), failure); assert.equal(f.state.nativeReads, 0);
    }
  });
  await test("prework port fixture: reserved Native preparation grants no business observation and a missing or revoked reservation refuses", async () => {
    const f = fixture(proposalFor); f.state.owner = true;
    const prepared = await f.capture(); assert.equal(prepared.context.subject.kind, "fresh_cycle");
    await assert.rejects(f.authority.select(f.instance), /RECONCILIATION_REQUIRED/);
    await assert.rejects(f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" }), /RECONCILIATION_REQUIRED/);
    f.state.owner = false; f.state.nativeReservation = false;
    await assert.rejects(f.authority.prepareActivity(f.instance, "root/plan", { nativePreparation: true, assertOwner: () => {} }), /RESERVATION_REQUIRED/);
    f.state.nativeReservation = true; f.state.afterObserve = () => { f.state.nativeReservation = false; };
    await assert.rejects(f.authority.prepareActivity(f.instance, "root/plan"), /RESERVATION_REQUIRED/);
  });
  await test("prework port fixture: only the fixed owner's existing capability permits reobservation under its own effect lock", async () => {
    const f = fixture(proposalFor); await f.capture(); f.state.owner = true; f.state.ownerPlan = "expected"; let checked = 0;
    const assertOwner = () => { checked++; if (!f.state.owner || f.state.ownerPlan !== "expected")
      throw Object.assign(Error("FIXTURE_OWN_OWNER_REQUIRED"), { code: "FIXTURE_OWN_OWNER_REQUIRED" }); };
    await assert.rejects(f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" }), /RECONCILIATION_REQUIRED/);
    const result = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" }, { assertOwner });
    assert.equal(result.outcome, "completed"); assert.ok(checked >= 2);
    f.state.nativeReservation = false;
    await assert.rejects(f.authority.prepareActivity(f.instance, "root/plan", { assertOwner }), /RESERVATION_REQUIRED/);
    f.state.nativeReservation = true;
    await assert.rejects(f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" }, { assertOwner: true }), /OWNER_CAPABILITY_REQUIRED/);
    for (const lose of [() => { f.state.owner = false; }, () => { f.state.ownerPlan = "foreign"; }]) {
      f.state.owner = true; f.state.ownerPlan = "expected"; f.state.afterObserve = lose;
      await assert.rejects(f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" }, { assertOwner }), /FIXTURE_OWN_OWNER_REQUIRED/);
    }
  });
  await test("prework port fixture: missing or foreign initialized origin cannot be inferred from the canonical headings", async () => {
    const absent = fixture(proposalFor); absent.instance.events = [];
    await assert.rejects(absent.capture(), /ACCEPTED_ORIGIN_REQUIRED/);
    const foreign = fixture(proposalFor); foreign.records.get(op("1")).record.preview.prepared.plan.input.cycle_id = "C002";
    await assert.rejects(foreign.capture(), /FRESH_ORIGIN_REQUIRED/);
  });
  await test("prework port fixture: changed selection or Native context refuses the report", async () => {
    const selected = fixture(proposalFor); await selected.select(); selected.records.get(op("2")).output.observations.subject.head = "e".repeat(40);
    await assert.rejects(selected.capture(), /SELECTION_CHANGED/);
    const f = fixture(proposalFor); await f.capture(); f.native().context.context.subject.product_sha256 = "e".repeat(64);
    await assert.rejects(f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" }), /NATIVE_CONTEXT_CHANGED/);
  });
  await test("prework port fixture: failed and information-needed reports retain empty positive facts", async () => {
    for (const verdict of ["failed", "needs_information"]) {
      const f = fixture(proposalFor); await f.capture(); const audit = f.native().authenticated.report.audits.intent; audit.verdict = verdict;
      if (verdict === "failed") audit.findings = [{ id: "FIND-001", severity: "blocking", summary: "Fixture source violates its declared intent",
        rule_refs: ["SPEC-R03"], evidence_refs: clone(audit.evidence_refs) }];
      else audit.questions = ["Which admitted intent applies?"];
      const result = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" });
      assert.equal(result.outcome, verdict === "failed" ? "failed" : "deferred"); assert.deepEqual(result.facts, {});
    }
  });
  await test("prework port fixture: witness binds accepted evaluation, report and Native source without turning historical DATA into a grant", async () => {
    const f = fixture(proposalFor); await f.select(); await f.capture();
    const result = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" });
    f.retain(op("3"), "cycle_prework_evaluate", result, { report_occurrence_id: "root/plan" });
    const witness = f.authority.witness(f.instance, op("3"));
    assert.equal(f.authority.assertWitness(f.instance, witness).output.outcome, "completed");
    assert.throws(() => f.authority.assertWitness(f.instance, { ...witness, evaluation_sha256: H }), /WITNESS_CHANGED/);
    f.native().authenticated.report.audits.intent.rationale = "Changed captured source";
    assert.throws(() => f.authority.assertWitness(f.instance, witness), /ACCEPTED_NATIVE_REQUIRED/);
    assert.throws(() => f.authority.assertWitness(f.instance, null), /WITNESS_REQUIRED/);
  });
  await test("prework port fixture: selection and evaluation envelopes reject foreign permissions and contradictory successful facts", async () => {
    const f = fixture(proposalFor), selected = await f.select(); await f.capture();
    assert.throws(() => assertStandardCyclePreworkSelection({ ...selected, approved: true }), failure);
    assert.throws(() => assertStandardCyclePreworkSelection({ ...selected, observations: { ...selected.observations, origin_binding_ref: "cycle_owned_resume_admit" } }), failure);
    const evaluated = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" });
    assert.throws(() => assertStandardCyclePreworkEvaluation({ ...evaluated, facts: {} }), failure);
    assert.throws(() => assertStandardCyclePreworkEvaluation({ ...evaluated, implementation_authorized: true }), failure);
  });
  return names;
}
