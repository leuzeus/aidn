import assert from "node:assert/strict";
import { recoveryCycleQuestion } from "../../src/core/workflow/standard-drift-recovery-cycle-selection.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createStandardHumanDecisions } from "../../src/application/runtime/standard-workflow-human-decisions.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { assertDecisionInbox } from "../../src/core/workflow/process-decision-inbox.mjs";

// Production question/human components and signer, in-memory fixture source
// and inbox. No host allocation, genuine human source or Native proof.
export async function verifyRecoveryCycleSelectionBoundaries(pass) {
  const subject = { contract_version: "standard-drift-recovery-cycle-subject.v1", checkpoint_operation_id: "op_" + "1".repeat(40),
    source_sha256: "2".repeat(64), context_sha256: "3".repeat(64), head: "4".repeat(40), session_id: "S001",
    objective: "Exact retained recovery objective", inventory_sha256: "5".repeat(64), minimum_cycle_number: 2 };
  const original = { operation_id: "op_" + "6".repeat(40), intent: { occurrence_id: "fixture-only-retained-occurrence" }, preview: { prepared: { subject } } };
  const before = shadowHash(original), current = recoveryCycleQuestion(original);
  assert.equal(current.contract_version, "standard-drift-recovery-cycle-question.v2"); assert.equal(Object.hasOwn(current, "expires_at_ms"), false);
  // Snapshots captured with the original v1 producer, before the v2 reader.
  const legacy = [
    [1, "02e61a7f553d534d13fc63d17878c96105f2c7b60b6dd28850818bce4bf50be3"],
    [86400001, "9b586c7ec6e387fbcc6ee04e56f2d535cf415bfdf903179801fab23f531249bd"],
    [9007199254740991, "bf355765bbae77c96b51756c684635c474146caa5b3451c97b87694a18aaceae"],
  ];
  for (const [expiry, digest] of legacy) {
    const record = structuredClone(original); record.preview.prepared.expires_at_ms = expiry;
    const bytes = JSON.stringify(record), question = recoveryCycleQuestion(record);
    assert.equal(question.contract_version, "standard-drift-recovery-cycle-question.v1"); assert.equal(question.expires_at_ms, expiry);
    assert.equal(shadowHash(question), digest); assert.equal(JSON.stringify(record), bytes);
  }
  assert.equal(shadowHash(original), before);
  const invalid = structuredClone(original); invalid.preview.prepared.expires_at_ms = -1;
  assert.throws(() => recoveryCycleQuestion(invalid), { code: "STANDARD_RECOVERY_CYCLE_QUESTION_INVALID" });
  pass("recovery cycle questions omit internal expiry and preserve original v1 question snapshots");

  function fixture(old) {
    const signer = createOperationJournalSigner(() => Buffer.alloc(32, 31)), records = new Map(), sources = new Map();
    const flags = { live: true, wrongAuthority: false };
    const inbox = {
      read(id) { const record = records.get(id); return { record: record ? structuredClone(record) : null, content_sha256: record ? shadowHash(record) : null }; },
      compareAndSwap(record, expected) { assertDecisionInbox(record); const retained = records.get(record.inbox_id);
        assert.equal(expected, retained ? shadowHash(retained) : null); records.set(record.inbox_id, structuredClone(record)); return { projection: "not_requested" }; },
      materialize() { throw Error("FIXTURE_PROJECTION_NOT_REQUESTED"); },
    };
    const human = createStandardHumanDecisions({ inbox, signer, projectionRequired: false, source: {
      read: ({ sourceRef }) => sources.get(sourceRef) ?? null,
      verify: ({ sourceRef, source }) => flags.live && shadowHash(sources.get(sourceRef) ?? null) === shadowHash(source)
        ? { outcome: "verified", authority_id: flags.wrongAuthority ? "wrong_fixture_authority" : source.authority_id, source_sha256: shadowHash(source) }
        : { outcome: "unverified" },
    } });
    const record = structuredClone(original); record.intent.binding_ref = "drift_recovery_cycle_decision"; record.results = [];
    if (old) record.preview.prepared.expires_at_ms = 1;
    const question = human.question(record), claim = { contract_version: "human-drift-recovery-cycle-decision.v1", source_kind: "human", authority_id: "fixture_operator",
      source_event_id: "fixture-selection-" + (old ? "legacy" : "current"), subject_sha256: shadowHash(question.subject), question_sha256: shadowHash(question),
      choice: "select_cycle", selected_cycle: { cycle_id: "C002", cycle_type: "spike", title: "admitted-recovery" }, rationale: "Exact fixture selection",
      evidence_refs: [{ ref: "fixture:cycle-selection", sha256: "7".repeat(64) }] };
    return { human, record, question, claim, records, sources, flags };
  }
  for (const old of [false, true]) {
    const f = fixture(old), originalQuestion = shadowHash(f.question);
    for (const [name, change] of [
      ["question", value => { value.question_sha256 = "8".repeat(64); }],
      ["subject", value => { value.subject_sha256 = "8".repeat(64); }],
      ["cycle", value => { value.selected_cycle.cycle_id = "C001"; }],
    ]) {
      const changed = structuredClone(f.claim); change(changed); f.sources.set(name, changed);
      await assert.rejects(f.human.reserve(f.record, name), { code: "STANDARD_RECOVERY_CYCLE_SELECTION_CHANGED" });
      assert.equal(f.records.size, 0);
    }
    f.sources.set("accepted", f.claim); f.flags.wrongAuthority = true;
    await assert.rejects(f.human.reserve(f.record, "accepted"), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
    assert.equal(f.records.size, 0); f.flags.wrongAuthority = false;
    const capture = await f.human.reserve(f.record, "accepted");
    assert.equal(capture.contract_version, "process-decision-inbox.v17"); assert.equal(capture.phase, "reserved");
    const output = f.human.output(f.record, capture); assert.equal(output.outcome, "completed"); assert.equal(output.effect_status, "no_effect");
    const receipt = { fixture_receipt: true, outcome: "completed", effect_status: "no_effect" };
    f.record.results.push({ output, receipt }); f.human.acknowledge(capture.inbox_id, receipt);
    assert.equal(f.human.captured(f.record).phase, "receipted");
    await f.human.verifyCaptured(f.record, undefined, { acknowledged: true });
    assert.equal(shadowHash(f.human.question(f.record)), originalQuestion);
    const retained = shadowHash(f.records.get(capture.inbox_id)); f.flags.live = false;
    await assert.rejects(f.human.verifyCaptured(f.record, undefined, { acknowledged: true }), { code: "PROCESS_HUMAN_NOT_AUTHENTICATED" });
    assert.equal(shadowHash(f.records.get(capture.inbox_id)), retained); assert.equal(shadowHash(f.human.question(f.record)), originalQuestion);
    pass(`recovery cycle ${old ? "legacy v1" : "current v2"}: exact H routing, inbox17 and current source checks retain original question`);
  }
}
