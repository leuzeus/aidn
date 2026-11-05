import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import bindingSchema from "../contracts/workflow-definition/process-data-bindings.v1.schema.json" with { type: "json" };
import resolutionSchema from "../contracts/workflow-definition/process-resolved-input.v1.schema.json" with { type: "json" };
import bindingSchemaV2 from "../contracts/workflow-definition/process-data-bindings.v2.schema.json" with { type: "json" };
import bindingSchemaV3 from "../contracts/workflow-definition/process-data-bindings.v3.schema.json" with { type: "json" };
import resolutionSchemaV2 from "../contracts/workflow-definition/process-resolved-input.v2.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const reserved = key => ["__proto__", "prototype", "constructor"].includes(key);
const key = value => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) && !reserved(value);
const exact = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function assertProcessDataBindings(value, nodes) {
  const activities = ["process-data-bindings.v2", "process-data-bindings.v3"].includes(value?.contract_version);
  const schema = value?.contract_version === "process-data-bindings.v3" ? bindingSchemaV3 : activities ? bindingSchemaV2 : bindingSchema;
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_DATA_BINDINGS_INVALID");
  if (!value.parameter_keys.every(key) || new Set(value.parameter_keys).size !== value.parameter_keys.length) fail("PROCESS_PARAMETERS_INVALID");
  const table = new Map(nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of nodes) for (const child of node.children ?? (node.child ? [node.child] : node.branches?.map(row => row.node_id) ?? [])) parents.set(child, node.id);
  const ancestry = id => { const result = []; for (let depth = 0; id !== undefined; depth++) {
    if (depth > 16) fail("PROCESS_INPUT_SCOPE_INVALID"); result.unshift(id); id = parents.get(id);
  } return result; };
  function ordered(source, target) {
    const left = ancestry(source), right = ancestry(target), scope = path => path.filter(id => ["loop", "multi_instance", "call"].includes(table.get(id).kind));
    if (!scope(left).every((id, index) => scope(right)[index] === id)) fail("PROCESS_INPUT_SOURCE_SCOPE_INVALID");
    let index = 0; while (left[index] === right[index] && index < Math.min(left.length, right.length)) index++;
    const common = table.get(left[index - 1]);
    if (common?.kind !== "sequence" || common.children.indexOf(left[index]) >= common.children.indexOf(right[index])
      || left.slice(index, -1).some(id => ["xor", "or", "event"].includes(table.get(id).kind))) fail("PROCESS_INPUT_SOURCE_NOT_ORDERED");
  }
  if (new Set(value.inputs.map(row => row.node_id)).size !== value.inputs.length
    || nodes.filter(node => node.kind === "operation").some(node => !value.inputs.some(row => row.node_id === node.id))) fail("PROCESS_INPUT_BINDINGS_INCOMPLETE");
  for (const row of value.inputs) {
    if (!["operation", ...(activities ? ["activity"] : [])].includes(table.get(row.node_id)?.kind)) fail("PROCESS_INPUT_BINDING_TARGET_INVALID");
    for (const [field, expr] of Object.entries(row.fields)) {
      if (!key(field)) fail("PROCESS_INPUT_FIELD_INVALID");
      const keys = expr.source === "literal" ? ["source", "value"] : expr.source === "parameter" ? ["source", "key", "path"]
        : ["operation_input", "operation_output"].includes(expr.source) ? ["source", "node_id", "path"] : ["source", "node_id"];
      if (!exact(expr, keys) || expr.path?.some(part => !/^(?:[A-Za-z][A-Za-z0-9_-]{0,63}|0|[1-9][0-9]{0,3})$/.test(part) || reserved(part))) fail("PROCESS_INPUT_EXPRESSION_INVALID");
      if (expr.source === "literal") { if (Buffer.byteLength(JSON.stringify(expr.value)) > 8192) fail("PROCESS_INPUT_VALUE_LIMIT"); }
      else if (expr.source === "parameter") { if (!value.parameter_keys.includes(expr.key)) fail("PROCESS_INPUT_PARAMETER_UNKNOWN"); }
      else {
        const source = table.get(expr.node_id);
        if (!source || expr.node_id === row.node_id || expr.source === "item" && source.kind !== "multi_instance"
          || expr.source.startsWith("operation_") && source.kind !== "operation"
          || expr.source === "occurrence_id" && !["operation", "activity"].includes(source.kind)) fail("PROCESS_INPUT_SOURCE_INVALID");
        if (expr.source === "item") { if (!ancestry(row.node_id).includes(source.id)) fail("PROCESS_INPUT_ITEM_SCOPE_INVALID"); }
        else ordered(source.id, row.node_id);
      }
    }
  }
  return value;
}
export function assertProcessParameters(model, parameters) {
  if (model.data_bindings === undefined) { if (parameters !== undefined) fail("PROCESS_PARAMETERS_UNDECLARED"); return; }
  if (checkShadowJson(parameters) || !parameters || typeof parameters !== "object" || Array.isArray(parameters)
    || !exact(parameters, model.data_bindings.parameter_keys) || Buffer.byteLength(JSON.stringify(parameters)) > 65536) fail("PROCESS_PARAMETERS_INVALID");
  return parameters;
}
export const processParameterOptions = instance => Object.hasOwn(instance, "initial_parameters") ? { parameters: instance.initial_parameters } : {};
export function assertResolvedProcessInput(value, { instance, occurrenceId } = {}) {
  if (checkShadowJson(value) || validateJsonSchema(value, value?.contract_version === "process-resolved-input.v2" ? resolutionSchemaV2 : resolutionSchema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(value)) > 131072 || value.sources.length !== Object.keys(value.input).length
    || new Set(value.sources.map(row => row.field)).size !== value.sources.length
    || value.sources.some(row => !Object.hasOwn(value.input, row.field))) fail("PROCESS_RESOLVED_INPUT_INVALID");
  if (instance && (value.contract_version !== (["process-data-bindings.v2", "process-data-bindings.v3"].includes(instance.model.data_bindings.contract_version) ? "process-resolved-input.v2" : "process-resolved-input.v1")
    || value.instance_sha256 !== instance.instance_sha256 || value.bindings_sha256 !== shadowHash(instance.model.data_bindings)
    || value.occurrence_id !== occurrenceId)) fail("PROCESS_RESOLVED_INPUT_CHANGED");
  return value;
}
