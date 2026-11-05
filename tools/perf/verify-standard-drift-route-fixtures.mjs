import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createStandardDriftRoute } from "../../src/application/runtime/standard-drift-route.mjs";
const id = "op_" + "a".repeat(40), receipt = { operation_id: id, outcome: "completed" };
const instance = { instance_id: "fixture", events: [{ kind: "operation_intent", intent: { binding_ref: "drift_check_finalize", operation_id: id } }, { kind: "operation_result", receipt }] };
let checks = 0;
for (const scenario of ["nominal", "fresh", "expired-disposition", "expired-completion", "revoked", "wrong-subject", "wrong-report", "wrong-event", "wrong-receipt", "unknown", "unaccepted"]) {
  const record = { phase: "receipted", preview: { prepared: { plan: { contract_version: scenario === "nominal" ? "standard-drift-finalize-plan.v2" : "standard-drift-finalize-plan.v3" } } },
    results: [{ receipt, output: { effect_status: "confirmed", facts: { drift_check_completed: true } } }] };
  let current = 0, historical = 0;
  const codes = { "expired-disposition": "STANDARD_OBJECTIVE_DISPOSITION_EXPIRED", "expired-completion": "STANDARD_OBJECTIVE_COMPLETION_EXPIRED",
    revoked: "PROCESS_HUMAN_NOT_AUTHENTICATED", "wrong-subject": "STANDARD_OBJECTIVE_COMPLETION_SUBJECT_CHANGED", "wrong-report": "STANDARD_OBJECTIVE_COMPLETION_REPORT_CHANGED",
    "wrong-event": "STANDARD_OBJECTIVE_COMPLETION_EVENT_CHANGED", "wrong-receipt": "STANDARD_OBJECTIVE_COMPLETION_NOT_ACCEPTED" };
  const code = codes[scenario], anchor = { exact_fixture_anchor: true };
  const route = createStandardDriftRoute({ targetRoot: fileURLToPath(new URL("../../", import.meta.url)), authenticate: selected => assert.equal(selected.instance_id, instance.instance_id),
    readOperation: selected => { assert.equal(selected, id); return record; },
    readCurrentCompletion: async () => { current++; if (code) throw Object.assign(Error(code), { code }); return { fresh_fixture_permission: true }; },
    readCompletion: async () => { historical++; return anchor; } });
  if (scenario === "unknown") record.results[0].output.effect_status = "unknown";
  const selected = scenario === "unaccepted" ? { ...instance, events: instance.events.slice(0, 1) } : instance;
  if (["nominal", "fresh", "expired-disposition", "expired-completion"].includes(scenario)) {
    const result = await route.completion(selected), expired = scenario.startsWith("expired");
    assert.deepEqual(result.facts, { drift_completion_review_required: expired, drift_completion_reviewed: !expired });
    assert.equal(current, scenario === "nominal" ? 0 : 1); assert.equal(historical, expired ? 1 : 0);
    assert.deepEqual(result.observations.previous_completion, expired ? anchor : null);
  } else {
    if (scenario === "unaccepted") await assert.rejects(route.completion(selected));
    else await assert.rejects(route.completion(selected), new RegExp(code ?? "NOT_ACCEPTED"));
    assert.equal(historical, 0);
  }
  checks++; console.log("PASS completion selector " + scenario + ": only expiry requests a linked H review");
}
console.log(JSON.stringify({ status: "PASS", checks, scope: "synthetic-authenticated-completion-selector", full_standard: false, application_ports: "NOT_RUN" }));
