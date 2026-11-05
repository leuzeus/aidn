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
  readCurrent, readReport, readEvent, now = Date.now }) {
  if ([readOperation, readEvaluation, readDisposition, readCurrent, readReport, readEvent].some(value => typeof value !== "function"))
    fail("STANDARD_OBJECTIVE_COMPLETION_AUTHORITY_REQUIRED");
  return Object.freeze({
    async read(instance) {
      const id = instance.events.filter(event => event.kind === "operation_intent"
        && event.intent.binding_ref === "drift_check_finalize").at(-1)?.intent.operation_id;
      if (!id) return null;
      const record = readOperation(id), plan = record.preview?.prepared?.plan;
      // Historical finalizers do not imply a retained alignment opinion. Never
      // search backwards past the latest finalizer to reuse an older v3 result.
      if (["standard-drift-finalize-plan.v1", "standard-drift-finalize-plan.v2"].includes(plan?.contract_version)) return null;
      if (validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length)
        fail("STANDARD_OBJECTIVE_COMPLETION_PLAN_INVALID");
      const result = record.results.at(-1), receipt = result?.receipt, output = assertStandardOperationOutput(result?.output);
      if (record.operation_id !== id || plan.operation_id !== id || record.intent.binding_ref !== "drift_check_finalize"
        || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || receipt?.operation_id !== id || receipt.outcome !== "completed"
        || receipt.output_sha256 !== shadowHash(output) || output.operation_ref !== "drift_check_finalize"
        || output.outcome !== "completed" || output.effect_status !== "confirmed" || output.facts.drift_check_completed !== true
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt)))
        fail("STANDARD_OBJECTIVE_COMPLETION_NOT_ACCEPTED");
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
      const disposition = await readDisposition(instance, plan.input, current);
      if (shadowHash(disposition) !== shadowHash(alignment)) fail("STANDARD_OBJECTIVE_COMPLETION_DISPOSITION_CHANGED");
      // Both physical readers are synchronous capabilities. After the last
      // awaited authentication, recheck their exact bytes and the process CAS
      // without an intervening await. No multi-store atomic snapshot is claimed.
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
      const age = now() - alignment.prepared_at_ms;
      if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_OBJECTIVE_COMPLETION_EXPIRED");
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
        fail("STANDARD_OBJECTIVE_COMPLETION_PROCESS_CHANGED");
      return structuredClone(disposition);
    },
  });
}
