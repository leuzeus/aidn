import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { assertStandardCyclePlan } from "../../core/workflow/standard-cycle-planning.mjs";
import { CYCLE_PREWORK_CONTRACT, CYCLE_PREWORK_CONTEXT_MAX_BYTES, assertStandardCyclePreworkSelection, assertStandardCyclePreworkEvaluation,
  observeStandardCyclePrework, assertStandardCyclePreworkWitness } from "../../core/workflow/standard-cycle-prework.mjs";
import { evaluateStandardCyclePlan } from "./standard-cycle-plan-context.mjs";
import { ownedCanonicalResumeEntry, assertOwnedCanonicalResumeInput } from "../../core/workflow/standard-owned-cycle-resume.mjs";
import { ownedCyclePlanningSelectOperation, ownedPlanningScaffoldNames, isOwnedCyclePlanningScaffold,
  assertOwnedCyclePlanningSelection } from "../../core/workflow/standard-owned-cycle-planning.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const freshBindings = ["cycle_initialize", "spike_cycle_initialize", "session_pr_correction_cycle_initialize"];
const canonicalBindings = ["cycle_plan_adopt", "cycle_owned_resume_admit", "cycle_canonical_resume_admit"];
const origins = [...freshBindings, ...canonicalBindings, ownedCyclePlanningSelectOperation];

// Capabilities come only from the fixed process authority. Neither authored
// process data nor a Native report can supply a reader, principal or grant.
export function createStandardCyclePreworkAuthority({ active, readCurrent, readAccepted, observeContext,
  observeScope, artifacts, readProductSha256, readActivityInput, readNativeActivity }) {
  if ([active, readCurrent, readAccepted, observeContext, observeScope, readProductSha256, readActivityInput, readNativeActivity]
    .some(port => typeof port !== "function")) fail("STANDARD_PREWORK_PORTS_REQUIRED");
  function current(instance, { assertOwner = null, nativePreparation = false } = {}) {
    // The fixed active port authenticates an actual reserved Native allocation
    // before read-only preparation. Its existing wrapper already owns the
    // common resource; ordinary business observations still require no owner.
    active(instance, { nativePreparation });
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_PREWORK_PROCESS_CHANGED");
    if (assertOwner !== null && typeof assertOwner !== "function") fail("STANDARD_PREWORK_OWNER_CAPABILITY_REQUIRED");
    if (assertOwner) assertOwner();
    else if (!nativePreparation && artifacts.ownerPending()) fail("STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
  }
  function origin(instance) {
    const intent = instance.events.filter(row => row.kind === "operation_intent" && origins.includes(row.intent.binding_ref)).at(-1)?.intent;
    if (!intent) fail("STANDARD_PREWORK_ACCEPTED_ORIGIN_REQUIRED");
    const accepted = readAccepted(instance, intent.operation_id, intent.binding_ref), output = accepted.output;
    if (output.outcome !== "completed") fail("STANDARD_PREWORK_ACCEPTED_ORIGIN_REQUIRED");
    return { ...accepted, binding: intent.binding_ref };
  }
  async function selectOwnedPlanning(instance, input, options = {}) {
    assertOwnedCanonicalResumeInput(input); current(instance, options);
    const source = readAccepted(instance, input.entry_operation_id, "cycle_entry_admit"),
      entry = { entry_operation_id: input.entry_operation_id, entry_sha256: shadowHash(source.record), input: source.record.preview.input, output: source.output };
    const { selected, entry: requested, observed: admitted } = ownedCanonicalResumeEntry(entry, input);
    const scope = observeScope(), binding = artifacts.describe(), observed = await observeContext();
    current(instance, options);
    const context = observed.context, { metadata_pins, ...planningContext } = context;
    if (context.mode !== "COMMITTING" || context.session_id !== requested.session_id || context.cycle_id !== selected.cycle_id
      || context.cycle_path !== selected.cycle_path || context.branch !== selected.branch || context.cycle_state !== selected.state
      || admitted.scope_sha256 !== shadowHash(scope) || context.product_sha256 !== readProductSha256())
      fail("STANDARD_OWNED_PLANNING_CONTEXT_CHANGED");
    const names = context.documents.map(row => {
      if (!row.ref.startsWith("audit:")) fail("STANDARD_OWNED_PLANNING_CONTEXT_CHANGED");
      return row.ref.slice(6);
    });
    const rows = artifacts.readMany(names, { required: names, includeMetadata: true }), pin = ({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 });
    if (!Array.isArray(metadata_pins) || metadata_pins.length !== rows.length
      || rows.some((row, index) => row.path !== names[index] || row.sha256 !== context.documents[index].sha256
        || metadata_pins[index].ref !== context.documents[index].ref || metadata_pins[index].sha256 !== row.metadata_sha256)
      || admitted.canonical.some(row => !rows.some(actual => actual.path === row.path && actual.sha256 === row.sha256 && actual.metadata_sha256 === row.metadata_sha256)))
      fail("STANDARD_OWNED_PLANNING_CONTEXT_CHANGED");
    const templateNames = context.cycle_state === "OPEN" ? ownedPlanningScaffoldNames.map(name => `cycles/TEMPLATE_${name}.md`) : [];
    const templates = artifacts.readMany(templateNames, { required: templateNames, includeMetadata: true });
    const required = isOwnedCyclePlanningScaffold(context, templates), canonical = rows.map(pin);
    const output = assertOwnedCyclePlanningSelection({ contract_version: "standard-owned-cycle-planning-selection-output.v1",
      operation_ref: ownedCyclePlanningSelectOperation, outcome: "completed", effect_status: "no_effect",
      facts: { owned_cycle_planning_required: required }, observations: {
        entry_operation_id: input.entry_operation_id, entry_sha256: entry.entry_sha256, scope_sha256: shadowHash(scope),
        session_id: context.session_id, cycle_id: context.cycle_id, cycle_path: context.cycle_path, cycle_state: context.cycle_state,
        planning_context_sha256: shadowHash(planningContext), canonical_sha256: shadowHash(canonical), canonical,
        templates: templates.map(pin), head: context.head, product_sha256: context.product_sha256,
        planning_required: required, implementation_authorized: false },
      evidence_refs: [...canonical, ...templates].map(row => ({ ref: "audit:" + row.path, sha256: row.sha256 })) });
    const after = await observeContext(); current(instance, options);
    if (after.context_sha256 !== observed.context_sha256 || shadowHash(scope) !== shadowHash(observeScope())
      || shadowHash(binding) !== shadowHash(artifacts.describe()) || context.product_sha256 !== readProductSha256()
      || entry.entry_sha256 !== shadowHash(readAccepted(instance, input.entry_operation_id, "cycle_entry_admit").record)
      || shadowHash(templates.map(pin)) !== shadowHash(artifacts.readMany(templateNames, { required: templateNames, includeMetadata: true }).map(pin)))
      fail("STANDARD_OWNED_PLANNING_CONTEXT_CHANGED");
    return output;
  }
  async function observe(instance, options = {}) {
    current(instance, options);
    const selectedBinding = artifacts.describe(), scope = observeScope(), source = origin(instance);
    const observed = await observeContext();
    current(instance, options);
    const context = observed.context, names = context.documents.map(row => {
      if (!row.ref.startsWith("audit:")) fail("STANDARD_PREWORK_CONTEXT_REQUIRED");
      return row.ref.slice(6);
    });
    const rows = artifacts.readMany(names, { required: names, includeMetadata: true });
    if (rows.some((row, index) => row.path !== names[index] || row.sha256 !== context.documents[index].sha256)
      || shadowHash(selectedBinding) !== shadowHash(artifacts.describe()) || shadowHash(scope) !== shadowHash(observeScope())
      || context.product_sha256 !== readProductSha256() || shadowHash(source) !== shadowHash(origin(instance)))
      fail("STANDARD_PREWORK_SOURCE_CHANGED");
    const { metadata_pins, ...planningContext } = context;
    if (!Array.isArray(metadata_pins) || metadata_pins.length !== rows.length
      || rows.some((row, index) => metadata_pins[index].ref !== context.documents[index].ref || metadata_pins[index].sha256 !== row.metadata_sha256))
      fail("STANDARD_PREWORK_SOURCE_CHANGED");
    let proposal = null, complete = false;
    const canonical = canonicalBindings.includes(source.binding), details = source.output.observations;
    if (canonical) {
      proposal = assertStandardCyclePlan(details.proposal);
      const completed = details.imported_completed_task_ids;
      if (source.output.effect_status !== "no_effect" || !Array.isArray(completed) || context.mode !== "COMMITTING"
        || (source.binding === "cycle_plan_adopt" ? source.output.facts.canonical_cycle_plan_available !== true
          : source.output.facts.canonical_cycle_resume_available !== true)
        || proposal.session_id !== context.session_id || proposal.cycle_id !== context.cycle_id || details.cycle_path !== context.cycle_path
        || details.context_sha256 !== observed.context_sha256
        || !["OPEN", "IMPLEMENTING", "VERIFYING"].includes(context.cycle_state)
        || completed.length > proposal.tasks.length || completed.some((id, index) => id !== proposal.tasks[index].id)
        || proposal.tasks.some(task => task.intent !== "implementation" || task.paths.some(row => !context.allowed_product_files.includes(row.path))))
        fail("STANDARD_PREWORK_CANONICAL_SOURCE_REQUIRED");
      complete = completed.length === proposal.tasks.length;
      if (!complete && source.binding !== "cycle_plan_adopt" && details.work_intent !== "continue_implementation")
        fail("STANDARD_CANONICAL_RESUME_INTEGRATION_ONLY");
    } else if (source.binding === ownedCyclePlanningSelectOperation) {
      assertOwnedCyclePlanningSelection(source.output);
      const currentSelection = await selectOwnedPlanning(instance, source.record.preview.input, options);
      current(instance, options);
      if (source.output.facts.owned_cycle_planning_required !== true || source.output.effect_status !== "no_effect"
        || shadowHash(currentSelection) !== shadowHash(source.output) || context.cycle_state !== "OPEN"
        || source.output.observations.planning_context_sha256 !== shadowHash(planningContext)
        || source.output.observations.canonical_sha256 !== shadowHash(rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }))))
        fail("STANDARD_OWNED_PLANNING_SOURCE_CHANGED");
    } else {
      const plan = source.record.preview.prepared?.plan;
      const inner = source.binding === "cycle_initialize" ? plan : plan?.inner?.plan;
      const fact = source.binding === "cycle_initialize" ? "cycle_initialized"
        : source.binding === "spike_cycle_initialize" ? "spike_cycle_initialized" : "session_pr_correction_cycle_initialized";
      if (source.output.effect_status !== "confirmed" || source.output.facts[fact] !== true || !inner
        || inner.input.session_id !== context.session_id || inner.input.cycle_id !== context.cycle_id
        || inner.cycle_path !== context.cycle_path || context.cycle_state !== "OPEN")
        fail("STANDARD_PREWORK_FRESH_ORIGIN_REQUIRED");
    }
    const subject = { contract_version: "standard-cycle-prework-subject.v1", kind: canonical ? "canonical_plan" : "fresh_cycle",
      origin_operation_id: source.record.operation_id, origin_sha256: shadowHash(source.output), scope_sha256: shadowHash(scope),
      canonical_sha256: shadowHash(rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }))),
      product_sha256: context.product_sha256, head: context.head, session_id: context.session_id, cycle_id: context.cycle_id,
      cycle_path: context.cycle_path, rule_refs: Array.from({ length: 11 }, (_, index) => "SPEC-R" + String(index + 1).padStart(2, "0")),
      proposal_sha256: proposal ? shadowHash(proposal) : null };
    const selection = assertStandardCyclePreworkSelection({ contract_version: "standard-cycle-prework-selection-output.v1",
      operation_ref: "cycle_prework_select", outcome: "completed", effect_status: "no_effect", facts: { cycle_prework_required: !complete },
      observations: { subject, planning_context_sha256: shadowHash(planningContext), canonical_binding_sha256: shadowHash(selectedBinding),
        origin_binding_ref: source.binding, canonical_proposal: proposal, canonical_complete: complete }, evidence_refs: observed.evidence_refs });
    current(instance, options);
    return { selection, planningContext, evidenceRefs: observed.evidence_refs };
  }
  async function prepare(instance, input = {}, options = {}) {
    if (checkShadowJson(input) || Object.keys(input).some(key => key !== "selection_operation_id")) fail("STANDARD_PREWORK_INPUT_INVALID");
    const observed = await observe(instance, options), source = observed.selection.observations;
    if (source.canonical_complete) fail("STANDARD_PREWORK_COMPLETE_CANONICAL_NO_ASSESSMENT_REQUIRED");
    let selected = null;
    if (Object.hasOwn(input, "selection_operation_id")) {
      selected = readAccepted(instance, input.selection_operation_id, "cycle_prework_select");
      assertStandardCyclePreworkSelection(selected.output);
      if (shadowHash(selected.output) !== shadowHash(observed.selection)) fail("STANDARD_PREWORK_SELECTION_CHANGED");
    } else if (source.subject.kind !== "fresh_cycle") fail("STANDARD_PREWORK_SELECTION_REQUIRED");
    const context = { contract_version: "standard-cycle-prework-context.v1", subject: source.subject,
      planning_context_sha256: source.planning_context_sha256, planning_context: observed.planningContext,
      canonical_proposal: source.canonical_proposal, canonical_binding_sha256: source.canonical_binding_sha256,
      selection_operation_id: selected?.record.operation_id ?? null, selection_sha256: selected ? shadowHash(selected.output) : null };
    if (Buffer.byteLength(JSON.stringify(context)) > CYCLE_PREWORK_CONTEXT_MAX_BYTES) fail("STANDARD_PREWORK_CONTEXT_TOO_LARGE");
    current(instance, options);
    return { context, context_sha256: shadowHash(context), evidence_refs: observed.evidenceRefs };
  }
  async function prepareActivity(instance, occurrenceId) {
    return prepare(instance, readActivityInput(instance, occurrenceId), { nativePreparation: true });
  }
  async function evaluate(instance, input, options = {}) {
    const retained = readNativeActivity(instance, input.report_occurrence_id, CYCLE_PREWORK_CONTRACT);
    const expected = await prepare(instance, retained.input, options), context = expected.context;
    if (retained.context.context_sha256 !== expected.context_sha256 || shadowHash(retained.context.context) !== expected.context_sha256
      || retained.authenticated.report.context_sha256 !== expected.context_sha256)
      fail("STANDARD_PREWORK_NATIVE_CONTEXT_CHANGED");
    const report = retained.authenticated.report, proposal = context.subject.kind === "fresh_cycle" ? report.proposal : context.canonical_proposal;
    const checked = observeStandardCyclePrework({ subject: context.subject, report, contextSha256: expected.context_sha256,
      proposalContextSha256: context.planning_context_sha256, evidenceRefs: expected.evidence_refs,
      canonicalProposal: context.subject.kind === "canonical_plan" ? proposal : null });
    if (context.subject.kind === "fresh_cycle") evaluateStandardCyclePlan({ ...retained.authenticated, report: proposal },
      { context: context.planning_context, context_sha256: context.planning_context_sha256, evidence_refs: expected.evidence_refs });
    const outcome = checked.outcome === "passed" ? "completed" : checked.outcome === "needs_information" ? "deferred" : "failed";
    current(instance, options);
    return assertStandardCyclePreworkEvaluation({ contract_version: "standard-cycle-prework-evaluation-output.v1",
      operation_ref: "cycle_prework_evaluate", outcome, effect_status: "no_effect",
      facts: outcome === "completed" ? { cycle_plan_available: true, cycle_plan_record_required: context.subject.kind === "fresh_cycle", cycle_prework_passed: true } : {},
      observations: { proposal, subject: context.subject, report, context_sha256: expected.context_sha256,
        planning_context_sha256: context.planning_context_sha256, context_evidence_refs: expected.evidence_refs,
        producer: retained.authenticated.producer, selection_operation_id: context.selection_operation_id, selection_sha256: context.selection_sha256,
        cycle_path: context.subject.cycle_path, readiness: "pending", implementation: "not_authorized" },
      evidence_refs: [retained.authenticated.reference, retained.reference] });
  }
  function accepted(instance, id, options = {}) {
    const evaluated = readAccepted(instance, id, "cycle_prework_evaluate", options), output = assertStandardCyclePreworkEvaluation(evaluated.output), source = output.observations;
    const native = readNativeActivity(instance, evaluated.record.preview.input.report_occurrence_id, CYCLE_PREWORK_CONTRACT, options);
    const context = native.context.context, origin = readAccepted(instance, source.subject.origin_operation_id,
      instance.events.find(row => row.kind === "operation_intent" && row.intent.operation_id === source.subject.origin_operation_id)?.intent.binding_ref, options);
    if (output.outcome !== "completed" || shadowHash(native.authenticated.report) !== shadowHash(source.report)
      || shadowHash(native.authenticated.producer) !== shadowHash(source.producer)
      || native.context.context_sha256 !== source.context_sha256 || shadowHash(context) !== source.context_sha256
      || shadowHash(context.subject) !== shadowHash(source.subject) || shadowHash(origin.output) !== source.subject.origin_sha256
      || context.planning_context_sha256 !== source.planning_context_sha256 || shadowHash(context.planning_context) !== source.planning_context_sha256
      || shadowHash(native.context.evidence_refs) !== shadowHash(source.context_evidence_refs)
      || source.selection_operation_id !== context.selection_operation_id || source.selection_sha256 !== context.selection_sha256
      || shadowHash(output.evidence_refs) !== shadowHash([native.authenticated.reference, native.reference]))
      fail("STANDARD_PREWORK_ACCEPTED_NATIVE_REQUIRED");
    if (source.selection_operation_id !== null) {
      const selection = readAccepted(instance, source.selection_operation_id, "cycle_prework_select", options);
      if (shadowHash(selection.output) !== source.selection_sha256 || native.input.selection_operation_id !== source.selection_operation_id)
        fail("STANDARD_PREWORK_ACCEPTED_NATIVE_REQUIRED");
    } else if (source.subject.kind !== "fresh_cycle" || Object.keys(native.input).length) fail("STANDARD_PREWORK_ACCEPTED_NATIVE_REQUIRED");
    return { ...evaluated, context: context.planning_context, context_sha256: source.planning_context_sha256,
      evaluation_sha256: shadowHash(output) };
  }
  async function readEvaluation(instance, input, options = {}) {
    const retained = accepted(instance, input.evaluation_operation_id, options);
    const fresh = await evaluate(instance, retained.record.preview.input, options);
    if (shadowHash(fresh) !== shadowHash(retained.output)) fail("STANDARD_PREWORK_EVALUATION_CHANGED");
    return retained;
  }
  function witnessFrom(evaluated) {
    const source = evaluated.output.observations;
    return assertStandardCyclePreworkWitness({ contract_version: "standard-cycle-prework-witness.v1",
      evaluation_operation_id: evaluated.record.operation_id, evaluation_sha256: shadowHash(evaluated.output), subject_sha256: shadowHash(source.subject),
      report_sha256: shadowHash(source.report), origin_operation_id: source.subject.origin_operation_id, proposal_sha256: shadowHash(source.proposal) });
  }
  function witness(instance, id, options = {}) { return witnessFrom(accepted(instance, id, options)); }
  function assertWitness(instance, value, options = {}) {
    assertStandardCyclePreworkWitness(value);
    const evaluated = accepted(instance, value.evaluation_operation_id, options);
    if (shadowHash(witnessFrom(evaluated)) !== shadowHash(value)) fail("STANDARD_PREWORK_WITNESS_CHANGED");
    return evaluated;
  }
  async function canonicalWitness(instance, originId, options = {}) {
    const id = instance.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_prework_evaluate").at(-1)?.intent.operation_id;
    if (!id) fail("STANDARD_PREWORK_WITNESS_REQUIRED");
    const retained = accepted(instance, id, options), source = retained.output.observations;
    if (source.subject.kind !== "canonical_plan" || source.subject.origin_operation_id !== originId) fail("STANDARD_PREWORK_WITNESS_REQUIRED");
    const fresh = await evaluate(instance, retained.record.preview.input, options);
    if (shadowHash(fresh) !== shadowHash(retained.output)) fail("STANDARD_PREWORK_EVALUATION_CHANGED");
    return witnessFrom(retained);
  }
  return Object.freeze({ selectOwnedPlanning, select: async instance => (await observe(instance)).selection, prepareActivity, evaluate, accepted, readEvaluation, witness, assertWitness, canonicalWitness });
}
