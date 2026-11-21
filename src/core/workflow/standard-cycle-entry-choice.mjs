import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import subjectSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-subject.v1.schema.json" with { type: "json" };
import questionSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-question.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/human-cycle-entry-choice.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-choice-output.v1.schema.json" with { type: "json" };

export const cycleEntryChoiceOperation = "cycle_entry_choice_decision";
export const cycleEntryChoiceQuestionVersion = "standard-cycle-entry-choice-question.v1";
const active = new Set(["OPEN", "IMPLEMENTING", "VERIFYING"]);
const stops = ["refused", "deferred", "cancelled"];
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value)
  && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const unique = values => new Set(values).size === values.length;
const sameSet = (left, right) => unique(left) && unique(right)
  && shadowHash([...left].sort()) === shadowHash([...right].sort());
const validSelection = value => unique(value.carryover_decisions.map(row => row.cycle_id))
  && value.carryover_decisions.every(row => row.rationale.trim() && (row.action === "drop") === (row.outcome !== null));

export function assertCycleEntryChoiceSubject(value) {
  if (!valid(value, subjectSchema) || Buffer.byteLength(JSON.stringify(value)) > 65536
    || !unique(value.candidate_cycles.map(row => row.cycle_id))
    || !unique(value.candidate_cycles.map(row => row.path))
    || !unique(value.canonical.map(row => row.path))
    || !unique(value.reported_cycles) || !unique(value.missing_reported_cycles)
    || value.session_path.slice("sessions/".length).split(/[-_.]/)[0] !== value.session_id
    || !sameSet(value.canonical.map(row => row.path), ["CURRENT-STATE.md", value.session_path])
    || value.candidate_cycles.some(row => !row.path.startsWith("cycles/" + row.cycle_id + "-"))
    || !sameSet(value.missing_reported_cycles, value.reported_cycles.filter(id => !value.candidate_cycles.some(row => row.cycle_id === id))))
    fail("STANDARD_CYCLE_ENTRY_CHOICE_SUBJECT_INVALID");
  return value;
}

export function cycleEntryChoiceOptions(subject) {
  assertCycleEntryChoiceSubject(subject);
  const candidates = subject.candidate_cycles.filter(row => active.has(row.state) && row.branch_head !== null
    && (row.session_owner === subject.session_id || subject.reported_cycles.includes(row.cycle_id)));
  const reportedKnownAndActive = !subject.missing_reported_cycles.length && subject.reported_cycles.every(id =>
    subject.candidate_cycles.some(row => row.cycle_id === id && active.has(row.state)));
  return [...(candidates.length && reportedKnownAndActive ? ["select_cycle"] : []), ...stops];
}

export function assertCycleEntryChoiceQuestion(value) {
  if (!valid(value, questionSchema) || Buffer.byteLength(JSON.stringify(value)) > 98304)
    fail("STANDARD_CYCLE_ENTRY_CHOICE_QUESTION_INVALID");
  assertCycleEntryChoiceSubject(value.subject);
  if (shadowHash(value.choices) !== shadowHash(cycleEntryChoiceOptions(value.subject)))
    fail("STANDARD_CYCLE_ENTRY_CHOICE_QUESTION_INVALID");
  return value;
}

export function cycleEntryChoiceQuestion(record) {
  return assertCycleEntryChoiceQuestion({ contract_version: cycleEntryChoiceQuestionVersion,
    operation_id: record.operation_id, intent_sha256: shadowHash(record.intent),
    subject: structuredClone(record.preview.prepared.subject),
    choices: cycleEntryChoiceOptions(record.preview.prepared.subject) });
}

export function assertHumanCycleEntryChoice(value, question) {
  if (!valid(value, sourceSchema) || !value.rationale.trim()
    || !unique(value.evidence_refs.map(row => row.ref))
    || (value.choice === "select_cycle") !== (value.selection !== null)
    || value.selection && !validSelection(value.selection))
    fail("STANDARD_CYCLE_ENTRY_CHOICE_SOURCE_INVALID");
  if (question) {
    assertCycleEntryChoiceQuestion(question);
    if (value.question_sha256 !== shadowHash(question) || value.subject_sha256 !== shadowHash(question.subject))
      fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!question.choices.includes(value.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
    if (value.selection) {
      const subject = question.subject, selection = value.selection;
      if (!subject.candidate_cycles.some(row => row.cycle_id === selection.cycle_id && active.has(row.state) && row.branch_head !== null
          && (row.session_owner === subject.session_id || subject.reported_cycles.includes(row.cycle_id)))
        || !sameSet(selection.carryover_decisions.map(row => row.cycle_id), subject.reported_cycles)
        || selection.carryover_decisions.some(row => row.cycle_id === selection.cycle_id
          && !["integrate_now", "import_now"].includes(row.action)))
        fail("STANDARD_CYCLE_ENTRY_CHOICE_SELECTION_CHANGED");
    }
  }
  return value;
}

export function assertCycleEntryChoiceOutput(value) {
  if (!valid(value, outputSchema)) fail("STANDARD_CYCLE_ENTRY_CHOICE_OUTPUT_INVALID");
  const choice = value.observations.choice, accepted = choice === "select_cycle";
  const outcome = accepted ? "completed" : choice === "refused" ? "rejected" : choice;
  if (value.outcome !== outcome || accepted !== (value.observations.selection !== null)
    || value.observations.selection && !validSelection(value.observations.selection)
    || shadowHash(value.facts) !== shadowHash(accepted ? { cycle_entry_selection_requested: true } : {}))
    fail("STANDARD_CYCLE_ENTRY_CHOICE_OUTPUT_INVALID");
  return value;
}

// Authentication and durable capture belong to the existing human source host.
// This result records intent only; Git, canonical writes and admission remain separate.
export function cycleEntryChoiceOutput(question, capture) {
  const source = assertHumanCycleEntryChoice(capture.source, question), sourceSha = shadowHash(source);
  return assertCycleEntryChoiceOutput({ contract_version: "standard-cycle-entry-choice-output.v1",
    operation_ref: cycleEntryChoiceOperation,
    outcome: source.choice === "select_cycle" ? "completed" : source.choice === "refused" ? "rejected" : source.choice,
    effect_status: "no_effect", facts: source.choice === "select_cycle" ? { cycle_entry_selection_requested: true } : {},
    observations: { inbox_id: capture.inbox_id, source_ref: capture.source_ref, source_sha256: sourceSha,
      subject_sha256: shadowHash(question.subject), choice: source.choice,
      selection: structuredClone(source.selection), implementation_authorized: false },
    evidence_refs: [{ ref: "aidn:decision-source/" + capture.inbox_id, sha256: sourceSha }, ...source.evidence_refs] });
}
