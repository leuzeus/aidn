import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { observeStandardDriftGate } from "./standard-drift-finalization.mjs";
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const output = (operation_ref, outcome, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-drift-route-output.v1", operation_ref, outcome, effect_status: "no_effect", observations, facts, evidence_refs });

// These facts select authored control flow only. They supply neither an
// alignment opinion, R05 completion, recovery permission nor a Native grant.
export function createStandardDriftRoute({ targetRoot, readEvaluation, authenticate, readOperation, readCompletion, readCurrentCompletion }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  return Object.freeze({
    async completion(instance) {
      authenticate(instance);
      const id = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "drift_check_finalize").at(-1)?.intent.operation_id;
      // This entry runs before diagnosis as well as after an accepted completion.
      // Only the primary closure's own finalizer can skip its diagnostic. Earlier
      // checkpoint finalizers are history, not a completion of this checkpoint.
      const intent = instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id)?.intent;
      const renewal = instance.events.findLast(event => event.kind === "operation_intent" && event.intent.binding_ref === "drift_completion_decision");
      const requested = renewal && instance.events.indexOf(renewal) > instance.events.indexOf(instance.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id));
      let diagnose = !id;
      if (id && instance.model) {
        // The signed intent identifies an occurrence, whose node is derived by
        // the same reducer. Do not infer node identity from an occurrence suffix.
        const frames = inspectAgenticProcess(instance).occurrences;
        diagnose = frames.find(frame => frame.occurrence_id === intent.occurrence_id)?.node_id !== "closure_drift_finalize";
      }
      if (requested) {
        const record = readOperation(renewal.intent.operation_id), result = record.results.at(-1);
        if (record.phase !== "receipted" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result?.receipt)))
          fail("STANDARD_OBJECTIVE_DISPOSITION_NOT_ACCEPTED");
        diagnose ||= result.output.observations.choice === "request_diagnosis";
      }
      if (diagnose) return output("drift_completion_select", "completed", { reason_code: "STANDARD_DRIFT_DIAGNOSIS_REQUIRED" },
        { drift_completion_review_required: false, drift_completion_reviewed: false, drift_diagnosis_requested: true });
      const record = readOperation(id), result = record.results.at(-1);
      if (record.phase !== "receipted" || result?.receipt.outcome !== "completed" || result.output.effect_status !== "confirmed"
        || result.output.facts.drift_check_completed !== true || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(result.receipt)))
        fail("STANDARD_OBJECTIVE_COMPLETION_NOT_ACCEPTED");
      let review = false, anchor = null;
      if (record.preview.prepared.plan.contract_version === "standard-drift-finalize-plan.v3") {
        try { if (!await readCurrentCompletion(instance)) fail("STANDARD_OBJECTIVE_COMPLETION_REQUIRED"); }
        catch (cause) {
          // Only expiry selects a fresh H review. Invalid/revoked sources,
          // changed subjects, reports, receipts or events remain refusals.
          if (!["STANDARD_OBJECTIVE_DISPOSITION_EXPIRED", "STANDARD_OBJECTIVE_COMPLETION_EXPIRED"].includes(cause.code)) throw cause;
          anchor = await readCompletion(instance); review = true;
        }
      }
      authenticate(instance);
      return output("drift_completion_select", "completed", { reason_code: review ? "STANDARD_OBJECTIVE_COMPLETION_REVIEW" : "STANDARD_DRIFT_NOMINAL", previous_completion: anchor },
        { drift_completion_review_required: review, drift_completion_reviewed: !review, drift_diagnosis_requested: false });
    },
    async select(instance, input) {
      authenticate(instance);
      const observed = await readEvaluation(instance, input), facts = observed.output.facts;
      const gate = await observeStandardDriftGate(artifacts, observed.context.mode ?? "COMMITTING");
      const fresh = await readEvaluation(instance, input);
      if (observed.context_sha256 !== fresh.context_sha256 || observed.evaluation_sha256 !== fresh.evaluation_sha256)
        fail("STANDARD_DRIFT_ROUTE_SOURCE_CHANGED");
      authenticate(instance);
      const signals = gate.levels.level2.active_signals.filter(value => value !== "time_since_last_drift_check");
      const blocked = facts.drift_context_complete !== true || gate.levels.level1.decision === "stop" || gate.levels.level3.required === true;
      const recovery = !blocked && facts.drift_present === true && facts.drift_recovery_required === true;
      const clean = !blocked && facts.drift_present === false && facts.drift_recovery_required === false;
      const objective = clean && shadowHash(signals) === shadowHash(["objective_delta"]);
      const nominal = clean && signals.length === 0;
      if (!recovery && !objective && !nominal) return output("drift_followup_select", "blocked", {
        reason_code: "STANDARD_DRIFT_ROUTE_BLOCKED", gate, evaluation_operation_id: input.evaluation_operation_id });
      return output("drift_followup_select", "completed", {
        reason_code: recovery ? "STANDARD_DRIFT_CONFIRMED_RECOVERY" : objective ? "STANDARD_DRIFT_OBJECTIVE_REVIEW" : "STANDARD_DRIFT_NOMINAL",
        evaluation_operation_id: input.evaluation_operation_id, context_sha256: fresh.context_sha256, evaluation_sha256: fresh.evaluation_sha256, gate,
      }, { drift_route_ready: nominal, drift_followup_review_required: recovery || objective,
        drift_diagnosis_requested: false, drift_recovery_chosen: false, drift_check_completed: false }, fresh.output.evidence_refs);
    },
  });
}
