import assert from "node:assert/strict";
import { createOperationProviderRegistry } from "../../src/application/workflow/operation-provider-registry.mjs";
import { createStandardOperationProvider } from "../../src/application/runtime/standard-operation-provider.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const observation = { facts: { observed: true }, evidence_refs: [] };
const calls = [];
const provider = createStandardOperationProvider({ reviewEffects: new Map(), operations: {
  reload(input) { calls.push(input); return observation; },
} });
const registry = createOperationProviderRegistry([provider]);
const bindings = standardWorkflowOperationBindings();
assert.equal(registry.descriptors.length, bindings.length);
assert.ok(registry.descriptors.every(row => row.provider_id === "aidn-standard" && row.provider_revision === 2));
for (const binding of bindings) {
  const installed = registry.resolve(binding.id, shadowHash(binding));
  assert.deepEqual(installed.binding, binding);
  const observer = ["context_reload", "session_entry_admit"].includes(binding.id);
  assert.deepEqual(installed.reliability, { idempotent: observer, wait_deadline: observer });
  assert.equal(registry.descriptors.find(row => row.operation_id === binding.id).implementation_sha256, binding.implementation_sha256);
}
const binding = bindings.find(row => row.id === "context_reload");
const operation = registry.resolve(binding.id, shadowHash(binding));
const input = {};
assert.equal(await operation.prepare({ input }), null);
assert.deepEqual(await operation.dispatch({ record: { preview: { input } } }), observation);
assert.deepEqual(calls, [input]);
assert.throws(() => registry.resolve("other", shadowHash(binding)), /BINDING_CHANGED/);
assert.throws(() => registry.resolve(binding.id, shadowHash({ ...binding, implementation_sha256: "0".repeat(64) })), /BINDING_CHANGED/);
assert.throws(() => createOperationProviderRegistry([provider, provider]), /PROVIDER_INVALID/);
console.log("PASS all installed bindings, exact-pin dispatch, provider collisions and implementation substitution");
