import { STANDARD_DRIFT_FRESHNESS_MINUTES } from "../../core/gating/gating-signal-policy.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-drift-finalize-plan.v3.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
const eventFile = ".aidn/runtime/perf/workflow-events.ndjson";

// Read-only admission primitive. The owning host supplies signed operation,
// canonical report and physical event readers; model/CLI JSON supplies none.
// This is deliberately distinct from consuming an accepted opinion: a closure
// also needs an accepted, still-current, physically witnessed completion.
export function createStandardObjectiveCompletion({ readOperation, readEvaluation, readDisposition,
  readCurrent, readReport, readEvent, readHistoricalDisposition = null, readRenewedDisposition = null, now = Date.now }) {
  if ([readOperation, readEvaluation, readDisposition, readCurrent, readReport, readEvent].some(value => typeof value !== "function"))
    fail("STANDARD_OBJECTIVE_COMPLETION_AUTHORITY_REQUIRED");
  async function inspect(instance, historical = false, evaluationOperationId = null) {
      const id = instance.events.filter(event => event.kind === "operation_intent"
        && event.intent.binding_ref === "drift_check_finalize").at(-1)?.intent.operation_id;
      if (!id && evaluationOperationId !== null) fail("STANDARD_OBJECTIVE_COMPLETION_REQUIRED");
      if (!id) return null;
      const record = readOperation(id), retainedSha256 = shadowHash(record), plan = record.preview?.prepared?.plan;
      if (evaluationOperationId !== null && plan?.input?.evaluation_operation_id !== evaluationOperationId)
        fail("STANDARD_OBJECTIVE_COMPLETION_SUBJECT_CHANGED");
      // Historical finalizers do not imply a retained alignment opinion. Never
      // search backwards past the latest finalizer to reuse an older v3 result.
      const nominal = ["standard-drift-finalize-plan.v1", "standard-drift-finalize-plan.v2"].includes(plan?.contract_version);
      if (nominal && evaluationOperationId === null) return null;
      if (!nominal && validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length)
        fail("STANDARD_OBJECTIVE_COMPLETION_PLAN_INVALID");
      const result = record.results.at(-1), receipt = result?.receipt, output = assertStandardOperationOutput(result?.output);
      if (record.operation_id !== id || plan.operation_id !== id || record.intent.binding_ref !== "drift_check_finalize"
        || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || receipt?.operation_id !== id || receipt.outcome !== "completed"
        || receipt.output_sha256 !== shadowHash(output) || output.operation_ref !== "drift_check_finalize"
        || output.outcome !== "completed" || output.effect_status !== "confirmed" || output.facts.drift_check_completed !== true
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt)))
        fail("STANDARD_OBJECTIVE_COMPLETION_NOT_ACCEPTED");
      if (nominal) {
        if (output.observations.evaluation_operation_id !== evaluationOperationId
          || shadowHash(record.preview.input) !== shadowHash(plan.input)) fail("STANDARD_OBJECTIVE_COMPLETION_SUBJECT_CHANGED");
        return null;
      }
      const observed = output.observations, alignment = plan.objective_alignment;
      if (plan.input.evaluation_operation_id !== alignment.evaluation_operation_id
        || plan.evaluation_sha256 !== alignment.evaluation_sha256 || plan.context_sha256 !== alignment.context_sha256
        || shadowHash(record.preview.input) !== shadowHash(plan.input)
        || observed.evaluation_operation_id !== plan.input.evaluation_operation_id || observed.report_path !== plan.report.path
        || observed.report_sha256 !== plan.report.after_sha256 || observed.event_file !== eventFile)
        fail("STANDARD_OBJECTIVE_COMPLETION_SUBJECT_CHANGED");
      const current = await readEvaluation(instance, plan.input);
      if (current.context_sha256 !== plan.context_sha256 || current.evaluation_sha256 !== plan.evaluation_sha256
        || current.context.branch !== plan.branch || current.context.head !== plan.head)
        fail("STANDARD_OBJECTIVE_COMPLETION_CONTEXT_CHANGED");
      const disposition = await (historical
        ? (typeof readHistoricalDisposition === "function" ? readHistoricalDisposition(instance, plan.input, current, alignment.decision_operation_id) : fail("STANDARD_OBJECTIVE_COMPLETION_HISTORICAL_AUTHORITY_REQUIRED"))
        : readDisposition(instance, plan.input, current));
      if (shadowHash(disposition) !== shadowHash(alignment)) fail("STANDARD_OBJECTIVE_COMPLETION_DISPOSITION_CHANGED");
      // Both physical readers are synchronous capabilities. After the last
      // awaited authentication, recheck their exact bytes and the process CAS
      // without an intervening await. No multi-store atomic snapshot is claimed.
      const witnesses = () => {
      const report = readReport(plan.report.path);
      if (report?.sha256 !== plan.report.after_sha256 || report.content !== plan.report.after
        || artifactContentHash(report.content) !== plan.report.after_sha256)
        fail("STANDARD_OBJECTIVE_COMPLETION_REPORT_CHANGED");
      const offset = observed.event_offset;
      if (!Number.isSafeInteger(offset) || offset < 0) fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
      // The trusted port returns the original bounded physical line at this
      // exact offset. A caller-provided parsed event is insufficient evidence.
      const bytes = readEvent({ file: eventFile, offset });
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 65536 || bytes.at(-1) !== 10
        || bytes.subarray(0, -1).includes(10)) fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
      let event;
      try { event = JSON.parse(bytes.toString("utf8")); } catch { fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED"); }
      if (shadowHash(event) !== shadowHash(observed.observed_event) || event.run_id !== "process_drift_" + id
        || event.event !== "drift_check_completed" || event.skill !== "drift-check" || event.result !== "ok"
        || event.branch !== plan.branch || event.mode !== plan.mode || event.objective_alignment_sha256 !== shadowHash(alignment)
        || shadowHash(observed.hook?.payload?.objective_alignment) !== shadowHash(alignment)
        || observed.hook?.payload?.ts !== event.ts || observed.hook?.payload?.ok !== true
        || !output.evidence_refs.some(row => row.ref === "aidn:drift-event/" + id && row.sha256 === shadowHash(event)))
        fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
        const eventTime = Date.parse(event.ts);
        if (!Number.isSafeInteger(eventTime)) fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
        return { eventTime, report_sha256: report.sha256, event_sha256: shadowHash(event), event_offset: offset };
      };
      const physical = witnesses();
      const age = now() - alignment.prepared_at_ms;
      if (!historical && (!Number.isSafeInteger(age) || age < 0 || age > 300000)) fail("STANDARD_OBJECTIVE_COMPLETION_EXPIRED");
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
        fail("STANDARD_OBJECTIVE_COMPLETION_PROCESS_CHANGED");
      const { eventTime, ...anchorWitnesses } = physical;
      const anchor = { operation_id: id, receipt_sha256: shadowHash(receipt), plan_sha256: shadowHash(plan),
        output_sha256: shadowHash(output), alignment_sha256: shadowHash(alignment), ...anchorWitnesses };
      const alignmentAllowed = () => {
        const eventAge = now() - eventTime;
        if (!Number.isSafeInteger(eventAge) || eventAge < 0) fail("STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED");
        return eventAge <= STANDARD_DRIFT_FRESHNESS_MINUTES * 60000;
      };
      return { disposition: structuredClone(disposition), anchor, current, input: plan.input, alignmentAllowed, assertWitnesses() {
        if (shadowHash(witnesses()) !== shadowHash(physical) || shadowHash(readOperation(id)) !== retainedSha256)
          fail("STANDARD_OBJECTIVE_COMPLETION_LINK_CHANGED");
        if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_OBJECTIVE_COMPLETION_PROCESS_CHANGED");
      } };
  }
  return Object.freeze({
    async review(instance) {
      const proof = await inspect(instance, true);
      if (!proof) fail("STANDARD_OBJECTIVE_COMPLETION_REQUIRED");
      return structuredClone(proof.anchor);
    },
    async renewalSubject(instance) {
      const proof = await inspect(instance, true);
      if (!proof) fail("STANDARD_OBJECTIVE_COMPLETION_REQUIRED");
      proof.assertWitnesses();
      return { anchor: structuredClone(proof.anchor), alignment_allowed: proof.alignmentAllowed() };
    },
    async read(instance, { evaluationOperationId = null } = {}) {
      const renewal = instance.events.findLast(event => event.kind === "operation_intent" && event.intent.binding_ref === "drift_completion_decision");
      const finalization = instance.events.findLast(event => event.kind === "operation_intent" && event.intent.binding_ref === "drift_check_finalize");
      const renew = renewal && instance.events.indexOf(renewal) > instance.events.indexOf(finalization);
      const proof = await inspect(instance, Boolean(renew), evaluationOperationId);
      if (!proof) return null;
      if (!renew) {
        if (!proof.alignmentAllowed()) fail("STANDARD_OBJECTIVE_COMPLETION_EXPIRED");
        return proof.disposition;
      }
      if (typeof readRenewedDisposition !== "function") fail("STANDARD_OBJECTIVE_COMPLETION_RENEWAL_AUTHORITY_REQUIRED");
      const disposition = await readRenewedDisposition(instance, proof.input, proof.current, proof.anchor);
      if (!disposition) fail("STANDARD_OBJECTIVE_COMPLETION_RENEWAL_REQUIRED");
      // Renewed permission never rewrites the accepted completion. Reobserve
      // physical witnesses and process CAS after the current H authentication.
      proof.assertWitnesses();
      if (!proof.alignmentAllowed()) fail("STANDARD_OBJECTIVE_COMPLETION_EXPIRED");
      const age = now() - disposition.prepared_at_ms;
      if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_OBJECTIVE_COMPLETION_EXPIRED");
      return structuredClone(disposition);
    },
  });
}
