import assert from "node:assert/strict";
import { createStandardSessionModeOperations } from "../../src/application/runtime/standard-session-mode-operations.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// This fixture stops at a controlled ownership boundary. It never calls the
// owner callback, reads a project or allocates a resource. Actual old-plan
// business effects are qualified separately through the source-installed host.
export async function verifyStandardPreparedTimestampShapes() {
  const H = "a".repeat(64), now = Date.now(), boundary = Object.assign(Error("controlled owner boundary"), { code: "FIXTURE_OWNER_BOUNDARY" });
  const scope = { project: {}, persistence: {}, branch: "S001-fixture", head: "a".repeat(40) };
  let checks = 0;
  for (const operation of ["session_mode_apply", "session_start_finalize"]) for (const [label, at, valid] of [
    ["current", now, true], ["day-old", now - 86400000, true], ["epoch-zero", 0, true],
    ["missing", undefined, false], ["null", null, false], ["string", "123", false], ["fraction", 1.5, false],
    ["negative", -1, false], ["NaN", NaN, false], ["positive-infinity", Infinity, false], ["negative-infinity", -Infinity, false],
    ["unsafe-integer", Number.MAX_SAFE_INTEGER + 1, false],
  ]) {
    let entered = 0;
    const port = createStandardSessionModeOperations({ artifacts: { root: "controlled-fixture-only", withLocalEffectOwner() { entered++; throw boundary; } }, now: () => now });
    const plan = operation === "session_start_finalize" ? {
      contract_version: "standard-session-start-plan.v1", operation_ref: operation, input: { session_id: "S001" }, prepared_at_ms: at,
      scope, mode: "THINKING", session_sha256: H, current_sha256: H,
      effects: ["checkpoint", "runtime_index", "constraint_loop_if_required", "context_telemetry"],
    } : { contract_version: "standard-session-mode-plan.v1", operation_ref: operation, input: { session_id: "S001", mode: "THINKING" }, prepared_at_ms: at, scope,
      changes: ["sessions/S001.md", "CURRENT-STATE.md"].map(path => ({ path, before_sha256: H, after: "fixture postimage\n", after_sha256: artifactContentHash("fixture postimage\n") })) };
    if (label === "missing") delete plan.prepared_at_ms;
    const digest = shadowHash(plan), prepared = { can_apply: true, plan, plan_sha256: digest };
    const apply = () => port[operation === "session_mode_apply" ? "applyMode" : "finalizeStart"](prepared, { write: true, expectPlan: digest });
    await assert.rejects(apply(), valid ? error => error === boundary : { code: "STANDARD_EXPLICIT_EFFECT_REQUIRED" });
    assert.equal(entered, valid ? 1 : 0);
    console.log(`PASS timestamp ${operation}: ${label} ${valid ? "reaches controlled owner boundary" : "refuses before ownership"}`); checks++;
  }
  return { status: "PASS", checks, scope: "private timestamp validation and controlled pre-owner boundary", actual_owner_allocations: 0, actual_effects: 0 };
}
