import { assertHumanModeDecision, assertModeQuestion, assertRecoveryQuestion, assertHumanRecoveryDecision, decisionInboxId } from "../../core/workflow/process-decision-inbox.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const choices = ["THINKING", "EXPLORING", "COMMITTING", "refused", "deferred", "cancelled"];
export function createStandardHumanDecisions({ inbox, signer, source, projectionRequired }) {
  const recovery = record => record.intent.binding_ref === "drift_recovery_decision";
  const question = record => recovery(record) ? assertRecoveryQuestion({ contract_version: "standard-drift-recovery-question.v1", operation_id: record.operation_id,
    instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
    session_id: record.preview.prepared.plan.session_id, review: structuredClone(record.preview.prepared.plan),
    choices: [...record.preview.prepared.plan.options.map(row => row.choice), "refused", "deferred", "cancelled"] })
    : assertModeQuestion({ contract_version: "standard-mode-question.v1", operation_id: record.operation_id, instance_id: record.intent.instance_id,
    scope_id: record.intent.scope_id, occurrence_id: record.intent.occurrence_id, intent_sha256: shadowHash(record.intent),
    session_id: record.preview.input.session_id, choices: [...choices] });
  function read(id) {
    const value = inbox.read(id); if (!value.record) fail("PROCESS_DECISION_SOURCE_NOT_FOUND");
    signer.verify(value.record); return value;
  }
  function write(body, before) {
    const record = signer.seal(body), result = inbox.compareAndSwap(record, before);
    if (result.projection === "pending") inbox.materialize(record.inbox_id, { write: true });
    return record;
  }
  async function bounded(method, input, signal) {
    if (typeof source?.[method] !== "function") fail("PROCESS_HUMAN_AUTHORITY_UNAVAILABLE");
    const stop = new AbortController(); let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(Object.assign(new Error("PROCESS_HUMAN_AUTHORITY_TIMEOUT"), { code: "PROCESS_HUMAN_AUTHORITY_TIMEOUT" })); }, 5000); });
    try {
      const value = await Promise.race([Promise.resolve().then(() => source[method]({ ...structuredClone(input), signal: signal ?? stop.signal })), timeout]);
      if (value !== null && checkShadowJson(value)) fail("PROCESS_HUMAN_AUTHORITY_INVALID");
      return structuredClone(value);
    } finally { clearTimeout(timer); stop.abort(); }
  }
  async function verify(claim, sourceRef, request, signal) {
    if (request.contract_version === "standard-drift-recovery-question.v1") assertHumanRecoveryDecision(claim); else assertHumanModeDecision(claim);
    if (claim.question_sha256 !== shadowHash(request)) fail("PROCESS_HUMAN_QUESTION_CHANGED");
    if (!request.choices.includes(claim.choice)) fail("PROCESS_HUMAN_CHOICE_NOT_OFFERED");
    const proof = await bounded("verify", { source: claim, sourceRef, question: request }, signal);
    if (proof?.outcome !== "verified" || proof.authority_id !== claim.authority_id || proof.source_sha256 !== shadowHash(claim)) fail("PROCESS_HUMAN_NOT_AUTHENTICATED");
  }
  function captured(record) {
    const result = record.results.at(-1), observation = result?.output?.observations;
    if (!observation?.inbox_id) fail("PROCESS_HUMAN_CAPTURE_MISSING");
    const retained = read(observation.inbox_id).record;
    if (retained.operation_id !== record.operation_id || retained.source.question_sha256 !== shadowHash(question(record))
      || observation.source_ref !== retained.source_ref || observation.source_sha256 !== shadowHash(retained.source) || observation.choice !== retained.source.choice
      || retained.phase === "receipted" && retained.receipt_sha256 !== shadowHash(result.receipt)) fail("PROCESS_HUMAN_CAPTURE_CHANGED");
    return retained;
  }
  return Object.freeze({ question, captured,
    readSource(ref) {
      const match = /^aidn:decision-source\/(decision_[a-f0-9]{40})$/.exec(ref);
      if (!match) fail("PROCESS_HUMAN_SOURCE_REF_INVALID");
      return structuredClone(read(match[1]).record.source);
    },
    async reserve(record, sourceRef) {
      if (typeof sourceRef !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(sourceRef)) fail("PROCESS_HUMAN_SOURCE_REF_INVALID");
      const request = question(record), claim = await bounded("read", { sourceRef, question: request });
      if (claim === null) return null;
      await verify(claim, sourceRef, request);
      const id = decisionInboxId(claim), before = inbox.read(id);
      if (before.record) {
        signer.verify(before.record);
        if (before.record.operation_id !== record.operation_id || shadowHash(before.record.source) !== shadowHash(claim)) fail("PROCESS_HUMAN_SOURCE_ALREADY_USED");
        if (projectionRequired) inbox.materialize(id, { write: true });
        return before.record;
      }
      return write({ contract_version: recovery(record) ? "process-decision-inbox.v2" : "process-decision-inbox.v1", inbox_id: id, operation_id: record.operation_id, source_ref: sourceRef,
        source: claim, phase: "reserved", receipt_sha256: null }, null);
    },
    acknowledge(id, receipt) {
      const before = read(id), record = before.record;
      if (record.phase === "receipted") {
        if (record.receipt_sha256 !== shadowHash(receipt)) fail("PROCESS_HUMAN_CAPTURE_CHANGED");
        if (projectionRequired) inbox.materialize(id, { write: true });
        return;
      }
      const { authentication, key_id, ...body } = record;
      write({ ...body, phase: "receipted", receipt_sha256: shadowHash(receipt) }, before.content_sha256);
    },
    async verifyCaptured(record, signal) {
      const value = captured(record); await verify(value.source, value.source_ref, question(record), signal);
    },
    output(record, capture) {
      const choice = capture.source.choice, isRecovery = recovery(record);
      const accepted = (isRecovery ? record.preview.prepared.plan.options.map(row => row.choice) : ["THINKING", "EXPLORING", "COMMITTING"]).includes(choice);
      const outcome = accepted ? "completed" : choice === "refused" ? "rejected" : choice;
      return { contract_version: isRecovery ? "standard-drift-recovery-output.v1" : "standard-operation-output.v2",
        operation_ref: isRecovery ? "drift_recovery_decision" : "mode_decision", outcome, effect_status: "no_effect",
        observations: { inbox_id: capture.inbox_id, source_ref: capture.source_ref, source_sha256: shadowHash(capture.source), choice },
        facts: !accepted ? {} : isRecovery ? { drift_recovery_chosen: true, drift_recovery_requirements_delta: choice === "requirements_delta",
          drift_recovery_new_cycle: choice === "new_cycle", drift_recovery_rollback: choice === "rollback", drift_recovery_required: true, drift_check_completed: false }
          : { mode_thinking: choice === "THINKING", mode_exploring: choice === "EXPLORING", mode_committing: choice === "COMMITTING" },
        evidence_refs: [{ ref: `aidn:decision-source/${capture.inbox_id}`, sha256: shadowHash(capture.source) }, ...capture.source.evidence_refs] };
    },
  });
}
