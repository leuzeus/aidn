import { registerHooks } from "node:module";

// Synthetic retained-legacy receipt constructor for recovery-reader tests.
// This doubles only the first initializer result. It is not evidence that the
// current initializer expires, nor an execution of an older product version.
const key = "aidn-synthetic-legacy-expiry-roots", roots = new Set();
globalThis[Symbol.for(key)] = roots;
const actual = new URL("../../src/application/runtime/standard-workflow-operations.mjs", import.meta.url).href;
const target = new URL("../../src/application/runtime/standard-workflow-operation-host.mjs?synthetic-legacy-expiry-fixture", import.meta.url).href;
const replacement = `import { createStandardWorkflowOperations as actual } from ${JSON.stringify(actual)};
export { standardWorkflowOperationBindings } from ${JSON.stringify(actual)};
export function createStandardWorkflowOperations(options) {
  const operations = actual(options);
  return Object.freeze({ ...operations, async initializeSession(prepared, intent) {
    if (globalThis[Symbol.for(${JSON.stringify(key)})].delete(options.targetRoot))
      throw Object.assign(new Error('STANDARD_PLAN_EXPIRED'), {code:'STANDARD_PLAN_EXPIRED',effect_status:'no_effect'});
    return operations.initializeSession(prepared, intent);
  }});
}`;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === target && specifier === "./standard-workflow-operations.mjs")
    return { url: "data:text/javascript," + encodeURIComponent(replacement), shortCircuit: true };
  return next(specifier, context);
} });
let createHost;
try { ({ createStandardWorkflowOperationHost: createHost } = await import(target)); }
finally { hook.deregister(); }
export function createSyntheticLegacyExpiryFixtureHost(options) {
  roots.add(options.targetRoot);
  return createHost(options);
}
