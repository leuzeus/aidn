import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { buildBaselinePromotionRequest } from "../../core/workflow/standard-baseline-promotion-decision.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
// These capabilities belong to the fixed host. readAcceptedOperation must
// verify signed journal/receipt provenance, accepted current-instance membership,
// and the latest occurrence for the requested binding. Process JSON cannot
// select or implement one of these readers.
export function createStandardBaselinePromotionAuthority({ targetRoot, readAcceptedOperation, readTerminalRecord, human }) {
  if ([readAcceptedOperation, readTerminalRecord, human?.question, human?.captured].some(value => typeof value !== "function")) fail("STANDARD_PROMOTION_SOURCE_AUTHORITY_REQUIRED");
  async function readClosure(instance, input) {
    const closed = await readAcceptedOperation(instance, input.closure_operation_id, "cycle_close_finalize"), plan = closed.record.preview.prepared.plan;
    const recorded = await readTerminalRecord(instance, plan.input);
    const selected = await readAcceptedOperation(instance, recorded.plan.input.decision_operation_id, "cycle_closure_decision"), question = human.question(selected.record);
    const observed = closed.output.observations, eventPath = ".aidn/runtime/perf/workflow-events.ndjson";
    if (closed.record.operation_id !== input.closure_operation_id || plan.operation_id !== input.closure_operation_id
      || closed.output.operation_ref !== "cycle_close_finalize" || closed.output.outcome !== "completed"
      || recorded.record_operation_id !== plan.input.closure_operation_id || question.review.cycle_id !== plan.scope.cycle_id
      || closed.output.effect_status !== "confirmed" || closed.output.facts.cycle_close_completed !== true || closed.output.facts.cycle_retained !== true
      || observed.target_state !== "DONE" || plan.scope.target_state !== "DONE" || observed.event_file !== eventPath) fail("STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED");
    const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(targetRoot, eventPath)), { json: false, maxBytes: 4194304 }).value, offset = observed.event_offset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length || offset && bytes[offset - 1] !== 10 || bytes.at(-1) !== 10) fail("STANDARD_PROMOTION_CLOSURE_EVIDENCE_CHANGED");
    const end = bytes.indexOf(10, offset); if (end < 0) fail("STANDARD_PROMOTION_CLOSURE_EVIDENCE_CHANGED");
    let event; try { event = JSON.parse(bytes.subarray(offset, end).toString("utf8")); } catch { fail("STANDARD_PROMOTION_CLOSURE_EVIDENCE_CHANGED"); }
    if (shadowHash(event) !== shadowHash(observed.event) || event.event !== "checkpoint_summary"
      || event.run_id !== "process_close_" + closed.record.operation_id.slice(3)) fail("STANDARD_PROMOTION_CLOSURE_EVIDENCE_CHANGED");
    return { operation_id: closed.record.operation_id, instance_id: instance.instance_id, scope_id: instance.scope_id,
      session_id: question.session_id, cycle_id: plan.scope.cycle_id, cycle_path: recorded.plan.cycle_path,
      product_sha256: question.review.product_sha256, output: structuredClone(closed.output) };
  }
  return Object.freeze({ readClosure,
    async readRequest(instance, input) {
      const selected = await readAcceptedOperation(instance, input.decision_operation_id, "baseline_promotion_decision");
      const question = human.question(selected.record), decision = human.captured(selected.record).source;
      const request = buildBaselinePromotionRequest(question, decision), closure = await readClosure(instance, { closure_operation_id: request.closure_operation_id });
      if (question.review.closure_output_sha256 !== shadowHash(closure.output)) fail("STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED");
      return { request, closure };
    },
  });
}
