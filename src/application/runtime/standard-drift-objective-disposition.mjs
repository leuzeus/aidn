import { assertObjectiveReview } from "../../core/workflow/standard-drift-objective-review.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/standard-drift-objective-disposition.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(Error(code), { code }); };
// All capabilities come from the owning host. A retained JSON opinion, or its
// MAC alone, cannot authenticate a human or authorize a finalization effect.
export function createStandardObjectiveDisposition({ readOperation, human, assertFresh }) {
  if (typeof readOperation !== "function" || typeof human?.verifyCaptured !== "function" || typeof assertFresh !== "function")
    fail("STANDARD_OBJECTIVE_DISPOSITION_AUTHORITY_REQUIRED");
  async function read(instance, { evaluation_operation_id }, verified, { historicalId = null, previousCompletion = null } = {}) {
      const latest = binding => instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === binding).at(-1)?.intent.operation_id;
      const binding = previousCompletion ? "drift_completion_decision" : "drift_recovery_decision";
      const id = historicalId ?? latest(binding);
      if (!id) return null;
      const record = readOperation(id), review = record.preview?.prepared?.plan;
      if (!["standard-drift-recovery-plan.v2", "standard-drift-recovery-plan.v3"].includes(review?.contract_version)) return null;
      if ((review.contract_version === "standard-drift-recovery-plan.v3") !== Boolean(previousCompletion)
        || previousCompletion && shadowHash(review.previous_completion) !== shadowHash(previousCompletion)) fail("STANDARD_OBJECTIVE_COMPLETION_LINK_CHANGED");
      assertObjectiveReview(review);
      const output = record.results.at(-1)?.output, receipt = record.results.at(-1)?.receipt;
      if (record.operation_id !== id || record.intent.binding_ref !== binding
        || record.intent.instance_id !== instance.instance_id || record.intent.scope_id !== instance.scope_id
        || record.phase !== "receipted" || receipt?.outcome !== "completed" || output?.effect_status !== "no_effect"
        || receipt.output_sha256 !== shadowHash(output)
        || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt)))
        fail("STANDARD_OBJECTIVE_DISPOSITION_NOT_ACCEPTED");
      if (latest("drift_report_evaluate") !== evaluation_operation_id || review.evaluation_operation_id !== evaluation_operation_id
        || (binding === "drift_recovery_decision" ? record.preview.input?.evaluation_operation_id !== evaluation_operation_id : Object.keys(record.preview.input ?? {}).length !== 0)
        || review.evaluation_sha256 !== verified.evaluation_sha256 || review.context_sha256 !== verified.context_sha256
        || shadowHash(review.report) !== shadowHash(verified.output.observations.report)) fail("STANDARD_OBJECTIVE_DISPOSITION_SUBJECT_CHANGED");
      const capture = human.captured(record), question = human.question(record);
      if (capture.phase !== "receipted" || capture.source.contract_version !== "human-drift-recovery-decision.v2"
        || capture.source.question_sha256 !== shadowHash(question) || capture.source.subject_sha256 !== shadowHash(review)
        || shadowHash(human.output(record, capture)) !== shadowHash(output)) fail("STANDARD_OBJECTIVE_DISPOSITION_CAPTURE_CHANGED");
      // The historical reader receives an authenticated evaluation from the
      // completion reader. Bind the retained opinion to it without rebuilding
      // the old question against a present gate. A current opinion or renewal
      // still rebuilds its own review and checks its own live authority.
      if (historicalId === null) await assertFresh(instance, review, previousCompletion, verified);
      // Authenticate the accepted primary/history fact or the current linked
      // permission after awaited context reads. Their host capability chooses
      // the authentication mode; elapsed preparation time is not permission.
      await human.verifyCaptured(record, undefined, { historical: Boolean(historicalId) || !previousCompletion });
      if (capture.source.choice !== "confirm_alignment") fail("STANDARD_OBJECTIVE_ALIGNMENT_NOT_CONFIRMED");
      const disposition = {
        contract_version: "standard-drift-objective-disposition.v1",
        decision_operation_id: id, evaluation_operation_id, evaluation_sha256: verified.evaluation_sha256,
        context_sha256: verified.context_sha256, review_sha256: shadowHash(review), question_sha256: shadowHash(question),
        source_sha256: shadowHash(capture.source), receipt_sha256: shadowHash(receipt), inbox_id: capture.inbox_id,
        authority_id: capture.source.authority_id, source_event_id: capture.source.source_event_id,
        session_objective: review.session_objective, cycle_objective: review.cycle_objective,
        rationale: capture.source.rationale, prepared_at_ms: review.prepared_at_ms,
      };
      if (validateJsonSchema(disposition, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_OBJECTIVE_DISPOSITION_INVALID");
      return disposition;
  }
  return Object.freeze({
    read: (instance, input, verified) => read(instance, input, verified),
    // Private owning-host capabilities. No model/CLI JSON selects historical
    // verification. This authenticates an old fact, never current permission.
    readHistorical: (instance, input, verified, id) => read(instance, input, verified, { historicalId: id }),
    readRenewed: (instance, input, verified, anchor) => read(instance, input, verified, { previousCompletion: anchor }),
  });
}
