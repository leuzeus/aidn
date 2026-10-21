#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { buildContextMetrics, validateContextTelemetry, evaluateContextPressure } from "../../src/core/context/context-metrics-policy.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import schema from "../../src/core/contracts/context/context-metrics.v1.schema.json" with { type: "json" };
import { createResponseUsageObserver } from "../../src/core/context/response-usage-policy.mjs";

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
  const response = (id, usage, threadId = "fixture-thread") => ({ method: "rawResponse/completed", params: { threadId, responseId: id, usage } });
  const counters = { inputTokens: 100, cachedInputTokens: 75, outputTokens: 10, reasoningOutputTokens: 3 };
  check("response usage counts native response records once and preserves subsets", () => {
    const observer = createResponseUsageObserver();
    observer.observe({ method: "thread/tokenUsage/updated", params: { tokenUsage: { total: { inputTokens: 999999 } } } });
    observer.observe(response("r1", counters)); observer.observe(response("r1", counters));
    observer.observe(response("r1", counters, "other-thread"));
    const result = observer.summary();
    assert.equal(result.model_responses, 2); assert.equal(result.duplicate_observations, 1);
    assert.deepEqual(result.tokens, { input_tokens: 200, cached_input_tokens: 150, output_tokens: 20, reasoning_output_tokens: 6, uncached_input_tokens: 50 });
    assert.equal(result.admission_evidence, false); assert.equal(result.window_pressure, "not_evaluated");
  });
  check("unknown response counters never become zero or a window estimate", () => {
    const observer = createResponseUsageObserver();
    assert.equal(observer.summary().tokens.input_tokens, null);
    observer.observe(response("r1", counters)); observer.observe(response("r2", { inputTokens: 20 }));
    const result = observer.summary();
    assert.equal(result.tokens.input_tokens, 120); assert.equal(result.tokens.cached_input_tokens, null);
    assert.equal(result.tokens.uncached_input_tokens, null); assert.equal(result.complete_counters, false);
  });
  check("response telemetry rejects malformed counters, conflicting duplicates and overflow", () => {
    for (const usage of [{ ...counters, inputTokens: -1 }, { ...counters, outputTokens: 0.5 },
      { ...counters, cachedInputTokens: 101 }, { ...counters, reasoningOutputTokens: 11 },
      { ...counters, inputTokens: Number.MAX_SAFE_INTEGER + 1 }]) {
      assert.throws(() => createResponseUsageObserver().observe(response("r", usage)), /RESPONSE_USAGE_/);
    }
    const observer = createResponseUsageObserver(); observer.observe(response("r1", counters));
    assert.throws(() => observer.observe(response("r1", { ...counters, inputTokens: 101 })), /DUPLICATE_CONFLICT/);
    assert.throws(() => observer.observe(response("", counters)), /IDENTITY_REQUIRED/);
    const huge = createResponseUsageObserver();
    huge.observe(response("a", { inputTokens: Number.MAX_SAFE_INTEGER }));
    huge.observe(response("b", { inputTokens: 1 }));
    assert.throws(() => huge.summary(), /SUM_OVERFLOW/);
  });
  check("real response-summary utility reads complete logs without writes and rejects invalid input", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-response-usage-"));
    const tool = path.resolve(import.meta.dirname, "summarize-response-usage.mjs");
    const execute = args => spawnSync(process.execPath, [tool, ...args], { encoding: "utf8", windowsHide: true });
    try {
      const file = path.join(root, "events.jsonl"), bad = path.join(root, "invalid.jsonl");
      const text = JSON.stringify(response("r1", counters)) + "\r\n";
      fs.writeFileSync(file, text); fs.writeFileSync(bad, "not-json\n");
      const result = execute(["--events", file, "--events", file]);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.model_responses, 1); assert.equal(output.duplicate_observations, 1);
      assert.equal(output.sources[0].bytes, Buffer.byteLength(text));
      assert.equal(output.sources[0].sha256, output.sources[1].sha256);
      assert.equal(fs.readFileSync(file, "utf8"), text);
      for (const args of [["--events", bad], ["--events", file, "--write"], ["--events", path.join(root, "missing")]]) {
        const refused = execute(args); assert.notEqual(refused.status, 0); assert.equal(refused.stdout, "");
      }
      assert.deepEqual(fs.readdirSync(root).sort(), ["events.jsonl", "invalid.jsonl"]);
    } finally { removePathWithRetry(root); }
  });
  console.log(`context-metrics: PASS (${checks} scenarios; native telemetry integration UNAVAILABLE)`);
} catch (error) { console.error(`context-metrics: FAIL ${error.message}`); process.exitCode = 1; }
