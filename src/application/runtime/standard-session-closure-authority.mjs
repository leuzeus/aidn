import fs from "node:fs";
import path from "node:path";
import { agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readStandardSessionClosureContext } from "./standard-session-closure-context.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const eventFile = ".aidn/runtime/perf/workflow-events.ndjson";
// Dependencies are host capabilities. The IR supplies accepted operation IDs,
// never a path, event offset, implementation or claimed R05 verdict.
export function createStandardSessionClosureAuthority({ targetRoot, readAcceptedOperation, readEvaluation }) {
  if (typeof readAcceptedOperation !== "function" || typeof readEvaluation !== "function") fail("STANDARD_SESSION_CLOSURE_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  return Object.freeze({
    async readSource(instance, input) {
      const accepted = (id, binding) => readAcceptedOperation(instance, id, binding, "STANDARD_SESSION_CLOSURE_ACCEPTED_SOURCE_REQUIRED");
      const admission = accepted(input.admission_operation_id, "session_close_admit");
      const evaluation = accepted(input.drift_evaluation_operation_id, "drift_report_evaluate");
      const finalization = accepted(input.drift_finalization_operation_id, "drift_check_finalize");
      const plan = finalization.record.preview.prepared?.plan, output = finalization.output, observed = output.observations;
      const fresh = await readEvaluation(instance, { evaluation_operation_id: input.drift_evaluation_operation_id });
      if (shadowHash(fresh.output) !== shadowHash(evaluation.output) || plan?.input.evaluation_operation_id !== input.drift_evaluation_operation_id
        || plan.evaluation_sha256 !== shadowHash(evaluation.output) || plan.context_sha256 !== fresh.context_sha256
        || output.effect_status !== "confirmed" || output.facts.drift_check_completed !== true
        || observed.evaluation_operation_id !== input.drift_evaluation_operation_id
        || observed.report_path !== `workflows/drift-reports/${finalization.record.operation_id}.md`
        || plan.report?.path !== observed.report_path || plan.report.after_sha256 !== observed.report_sha256
        || artifacts.read(observed.report_path, { required: true }).sha256 !== observed.report_sha256)
        fail("STANDARD_SESSION_CLOSURE_DRIFT_PROOF_CHANGED");
      const event = observed.observed_event;
      if (observed.event_file !== eventFile || !Number.isSafeInteger(observed.event_offset) || observed.event_offset < 0
        || event?.event !== "drift_check_completed" || event.run_id !== "process_drift_" + finalization.record.operation_id
        || event.skill !== "drift-check" || event.result !== "ok" || event.mode !== "COMMITTING" || event.branch !== plan.branch
        || event.ts !== observed.hook?.payload?.ts || observed.hook?.ok !== true || observed.hook.payload?.ok !== true)
        fail("STANDARD_SESSION_CLOSURE_DRIFT_PROOF_CHANGED");
      const file = agentRunPhysicalPath(path.join(artifacts.root, eventFile)), descriptor = fs.openSync(file, "r");
      try {
        const offset = observed.event_offset, size = fs.fstatSync(descriptor).size - offset;
        if (size <= 0) fail("STANDARD_SESSION_CLOSURE_DRIFT_PROOF_CHANGED");
        if (offset) { const prior = Buffer.alloc(1); if (fs.readSync(descriptor, prior, 0, 1, offset - 1) !== 1 || prior[0] !== 10) fail("STANDARD_SESSION_CLOSURE_DRIFT_PROOF_CHANGED"); }
        const bytes = Buffer.alloc(Math.min(size, 65536)), read = fs.readSync(descriptor, bytes, 0, bytes.length, offset), end = bytes.subarray(0, read).indexOf(10);
        if (end < 0 || shadowHash(JSON.parse(bytes.subarray(0, end).toString("utf8"))) !== shadowHash(event)) fail("STANDARD_SESSION_CLOSURE_DRIFT_PROOF_CHANGED");
      } finally { fs.closeSync(descriptor); }
      const current = await readStandardSessionClosureContext({ targetRoot, sessionId: admission.record.preview.input.session_id });
      if (current.blocked || current.branch !== plan.branch || current.head !== plan.head
        || current.scope_sha256 !== admission.output.observations.scope_sha256) fail("STANDARD_SESSION_CLOSURE_CONTEXT_CHANGED");
      return { admission: { operation_id: admission.record.operation_id, session_id: current.session_id, output: admission.output },
        evaluation: { operation_id: evaluation.record.operation_id, output: evaluation.output },
        finalization: { operation_id: finalization.record.operation_id, output }, current };
    },
  });
}
