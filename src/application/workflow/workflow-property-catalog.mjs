import { agenticProcessCapabilities } from "../../core/workflow/agentic-process-model.mjs";
import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { freezeShadow, shadowHash } from "../../core/workflow/shadow-json.mjs";

function describeFields(schema, editable) {
  if (!schema || typeof schema !== "object") throw Error("WORKFLOW_PROPERTY_SCHEMA_MISSING");
  return Object.entries(schema.properties ?? {}).map(([name, field]) => ({
    name, schema: structuredClone(field), required: schema.required?.includes(name) ?? false,
    editable: editable && !Object.hasOwn(field, "const")
  }));
}

export function createWorkflowPropertyCatalog({ operations, roles = [], policies = [], evaluations = [],
  roleProfiles = [], facts = [], readSchema }) {
  const byRef = new Map();
  const factKeys = new Set(facts);
  for (const binding of operations) {
    assertProcessOperationBinding(binding);
    const ref = binding.id + "@" + binding.revision;
    if (byRef.has(ref)) {
      if (shadowHash(byRef.get(ref).binding) !== shadowHash(binding)) throw Error("WORKFLOW_PROPERTY_BINDING_CONFLICT");
      continue;
    }
    const output = readSchema(binding.output_contract);
    for (const key of Object.keys(output?.properties?.facts?.properties ?? {})) factKeys.add(key);
    byRef.set(ref, { ref, binding: structuredClone(binding), inputs: describeFields(readSchema(binding.input_contract), true),
      outputs: describeFields(output, false), provenance: { editable: false, implementation_sha256: binding.implementation_sha256,
        binding_sha256: shadowHash(binding), executor_kind: binding.executor_kind, effect_class: binding.effect_class } });
  }
  for (const definition of evaluations) for (const key of definition.fact_keys ?? []) factKeys.add(key);
  return freezeShadow({ operations: [...byRef.values()], roles: structuredClone(roles), policies: structuredClone(policies),
    role_profiles: structuredClone(roleProfiles), evaluators: structuredClone(evaluations), facts: [...factKeys].sort(),
    activity_types: agenticProcessCapabilities().constructs.filter(row => row.executable).map(row => row.kind) });
}
