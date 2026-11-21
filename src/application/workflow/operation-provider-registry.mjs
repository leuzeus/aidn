import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { freezeShadow, shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };

// Only host composition supplies executable handlers. Published models address
// a binding by logical identity and the digest of its complete definition.
export function createOperationProviderRegistry(providers) {
  const byPin = new Map();
  const descriptions = [];
  const providersSeen = new Set();
  for (const provider of providers) {
    const identity = provider.id + "@" + provider.revision;
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(provider.id) ||
        !Number.isSafeInteger(provider.revision) || provider.revision < 1 ||
        providersSeen.has(identity) || !Array.isArray(provider.operations))
      fail("PROCESS_OPERATION_PROVIDER_INVALID");
    providersSeen.add(identity);
    for (const operation of provider.operations) {
      const binding = freezeShadow(structuredClone(assertProcessOperationBinding(operation.binding)));
      const pin = shadowHash(binding);
      const key = binding.id + ":" + pin;
      if (byPin.has(key) || typeof operation.prepare !== "function" || typeof operation.dispatch !== "function")
        fail("PROCESS_OPERATION_PROVIDER_INVALID");
      byPin.set(key, Object.freeze({ binding, prepare: operation.prepare, dispatch: operation.dispatch }));
      descriptions.push({ provider_id: provider.id, provider_revision: provider.revision, operation_id: binding.id,
        operation_revision: binding.revision, binding_sha256: pin, implementation_sha256: binding.implementation_sha256 });
    }
  }
  const descriptors = freezeShadow(descriptions);
  return Object.freeze({
    descriptors,
    resolve(id, bindingSha256) {
      const operation = byPin.get(id + ":" + bindingSha256);
      if (!operation) fail("STANDARD_HOST_BINDING_CHANGED");
      return operation;
    },
  });
}
