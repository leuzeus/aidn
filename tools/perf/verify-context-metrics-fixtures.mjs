#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildContextMetrics, validateContextTelemetry, evaluateContextPressure } from "../../src/core/context/context-metrics-policy.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import schema from "../../src/core/contracts/context/context-metrics.v1.schema.json" with { type: "json" };

const now = Date.now();
const telemetry = { contract_version: "context-telemetry.v1", window_id: "window-1", model: "fixture", provider: "fixture",
  client: "fixture", client_version: "1", observed_at: new Date(now).toISOString(), used_tokens: 100,
  capacity_tokens: 1000, reserved_tokens: 50, parts: { working_memory_tokens: 50 }, counts: { retrieval_count: 2 } };
const input = { memory: { agent_id: "agent-1", evidence_refs: [{ ref: "proof", bytes: 4096, sha256: "a".repeat(64) }] },
  checkpoint: { run_id: "checkpoint-1", ts: new Date(now).toISOString() }, canonical: { backend: "files", revision: null },
  observedRevision: { fingerprint: "b".repeat(64) } };
let checks = 0;
function check(name, action) { action(); checks += 1; console.log(`PASS ${name}`); }
try {
  check("unknown tokens remain null while bytes are measured", () => {
    const value = buildContextMetrics(input);
    assert.deepEqual(validateJsonSchema(value, schema, "$", { contractKind: "context" }), []);
    assert.equal(value.tokens.input_tokens, null); assert.equal(value.tokens.remaining_tokens, null);
    assert.equal(value.bytes.working_memory, Buffer.byteLength(JSON.stringify(input.memory)));
    assert.equal(value.bytes.referenced_evidence, 4096); assert.equal(value.counts.retrieval_count, null);
  });
  check("reported attribution does not invent missing categories or counts", () => {
    const value = buildContextMetrics({ ...input, telemetry });
    assert.deepEqual(validateJsonSchema(value, schema, "$", { contractKind: "context" }), []);
    assert.equal(value.tokens.working_memory_tokens, 50); assert.equal(value.tokens.pinned_tokens, null);
    assert.equal(value.tokens.remaining_tokens, 900); assert.equal(value.counts.retrieval_count, 2);
    assert.equal(value.count_scope, "observation-delta"); assert.equal(value.admission_evidence, false);
  });
  check("malformed, stale, future and inconsistent measurements refuse", () => {
    for (const altered of [null, { ...telemetry, used_tokens: -1 }, { ...telemetry, capacity_tokens: 0 },
      { ...telemetry, used_tokens: 1001 }, { ...telemetry, reserved_tokens: 1001 },
      { ...telemetry, parts: { pinned_tokens: 99, working_memory_tokens: 99 } },
      { ...telemetry, observed_at: new Date(now - 300001).toISOString() },
      { ...telemetry, observed_at: new Date(now + 5001).toISOString() },
      { ...telemetry, permissions: ["write"] }, { ...telemetry, used_tokens: 1.5 }]) {
      assert.throws(() => validateContextTelemetry(altered, now), /CONTEXT_TELEMETRY_/);
    }
  });
  check("closed metrics schema rejects fabricated authority", () => {
    const value = { ...buildContextMetrics(input), admission_evidence: true, write_authorization: true };
    assert.ok(validateJsonSchema(value, schema, "$", { contractKind: "context" }).length);
  });
  check("pressure uses recent client usage and never inferred byte/token ratios", () => {
    assert.equal(evaluateContextPressure(null, now).pressure, "unknown");
    assert.equal(evaluateContextPressure(telemetry, now).pressure, "normal");
    assert.equal(evaluateContextPressure({ ...telemetry, used_tokens: 750 }, now).pressure, "elevated");
    assert.equal(evaluateContextPressure({ ...telemetry, used_tokens: 900 }, now).pressure, "urgent");
    assert.equal(evaluateContextPressure({ ...telemetry, used_tokens: 800, reserved_tokens: 200 }, now).pressure, "urgent");
    assert.equal(evaluateContextPressure(telemetry, now + 300001).pressure, "unknown");
    assert.equal(evaluateContextPressure({ ...telemetry, used_tokens: 1001 }, now).pressure, "unknown");
    assert.equal(evaluateContextPressure(telemetry, now).write_authorization, false);
  });
  console.log(`context-metrics: PASS (${checks} scenarios; native telemetry integration UNAVAILABLE)`);
} catch (error) { console.error(`context-metrics: FAIL ${error.message}`); process.exitCode = 1; }
