import { createHash } from "node:crypto";
import catalogSchema from "../contracts/workflow-definition/standard-workflow-startup-catalog.v1.schema.json" with { type: "json" };
import cycleCatalogSchema from "../contracts/workflow-definition/standard-cycle-create-catalog.v1.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/standard-workflow-model-source.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { assertAgenticProcessModel } from "./agentic-process-model.mjs";
import { assertProcessOperationBinding } from "./process-operation-contracts.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const standardAssetHash = bytes => createHash("sha256").update(bytes).digest("hex");
export function assertStandardWorkflowStartupCatalog(catalog, model) {
  if (catalog?.contract_version !== "standard-workflow-startup-catalog.v1") fail("STANDARD_STARTUP_CATALOG_INVALID");
  return assertStandardWorkflowComponentCatalog(catalog, model);
}
export function assertStandardWorkflowComponentCatalog(catalog, model) {
  const schema = catalog?.contract_version === "standard-workflow-startup-catalog.v1" ? catalogSchema
    : catalog?.contract_version === "standard-cycle-create-catalog.v1" ? cycleCatalogSchema : null;
  if (!schema || checkShadowJson(catalog) || validateJsonSchema(catalog, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_STARTUP_CATALOG_INVALID");
  assertAgenticProcessModel(model);
  if (model.contract_version !== "agentic-process-model.v2" || catalog.model.sha256 !== shadowHash(model)
    || catalog.model.model_id !== model.model_id || catalog.model.revision !== model.revision || catalog.revision !== model.revision) fail("STANDARD_STARTUP_MODEL_CHANGED");
  const operations = model.nodes.filter(node => node.kind === "operation"), ids = catalog.bindings.map(row => row.node_id);
  if (operations.length !== ids.length || new Set(ids).size !== ids.length
    || new Set(catalog.scope.entry_conditions).size !== 2 || new Set(catalog.scope.remaining_activities).size !== catalog.scope.remaining_activities.length) fail("STANDARD_STARTUP_COVERAGE_INVALID");
  for (const row of catalog.bindings) {
    assertProcessOperationBinding(row.binding);
    const node = operations.find(node => node.id === row.node_id);
    if (!node || node.binding_ref !== row.binding.id || model.operation_pins[node.binding_ref] !== shadowHash(row.binding)
      || row.skill_source.path !== `scaffold/codex/aidn-${row.binding.skill_id}/SKILL.md`) fail("STANDARD_STARTUP_BINDING_CHANGED");
  }
  return catalog;
}
function authorities({ catalog, specification, skills }) {
  if (standardAssetHash(specification) !== catalog.specification.sha256) fail("STANDARD_STARTUP_SPECIFICATION_CHANGED");
  for (const row of catalog.bindings) {
    const skill = skills[row.skill_source.path];
    if (!skill || standardAssetHash(skill) !== row.skill_source.sha256) fail("STANDARD_STARTUP_SKILL_CHANGED");
    if (row.binding.rule_refs.some(rule => !String(specification).includes("`" + rule + "`"))) fail("STANDARD_STARTUP_RULE_MISSING");
  }
}
export function verifyStandardWorkflowStartupAssets(input) {
  assertStandardWorkflowStartupCatalog(input.catalog, input.model);
  return verifyStandardWorkflowComponentAssets(input);
}
export function verifyStandardWorkflowComponentAssets(input) {
  const { catalog, model, bindings } = input;
  assertStandardWorkflowComponentCatalog(catalog, model); authorities(input);
  const actual = new Map(bindings.map(binding => [binding.id, assertProcessOperationBinding(binding)]));
  for (const row of catalog.bindings) if (!actual.has(row.binding.id) || shadowHash(actual.get(row.binding.id)) !== shadowHash(row.binding)) fail("STANDARD_STARTUP_IMPLEMENTATION_CHANGED");
  return createStandardWorkflowModelSource(catalog, model);
}
export function createStandardWorkflowModelSource(catalog, model) {
  assertStandardWorkflowComponentCatalog(catalog, model);
  return freezeShadow({ contract_version: "standard-workflow-model-source.v1", catalog_sha256: shadowHash(catalog), model_sha256: shadowHash(model), catalog: structuredClone(catalog) });
}
export function assertStandardWorkflowModelSource(source, model) {
  if (checkShadowJson(source) || validateJsonSchema(source, sourceSchema, "$", { contractKind: "workflow-definition" }).length
    || source.catalog_sha256 !== shadowHash(source.catalog) || source.model_sha256 !== shadowHash(model)) fail("STANDARD_MODEL_SOURCE_INVALID");
  assertStandardWorkflowComponentCatalog(source.catalog, model); return source;
}

// Source-authoring helper only. Runtime loading never repairs or refreshes pins.
// Only implementation hashes may be refreshed; changed rules, skills, executor
// kinds or contracts require an explicit reviewed source edit first.
export function refreshStandardWorkflowStartupBindings(input) {
  assertStandardWorkflowStartupCatalog(input.catalog, input.model);
  return refreshStandardWorkflowComponentBindings(input);
}
export function refreshStandardWorkflowComponentBindings(input) {
  const { catalog, model, bindings } = input;
  assertStandardWorkflowComponentCatalog(catalog, model); authorities(input);
  const nextCatalog = structuredClone(catalog), nextModel = structuredClone(model), changed = [];
  for (const row of nextCatalog.bindings) {
    const actual = bindings.find(binding => binding.id === row.binding.id);
    if (!actual) fail("STANDARD_STARTUP_BINDING_REVIEW_REQUIRED");
    assertProcessOperationBinding(actual);
    const semantic = value => { const { implementation_sha256, ...body } = value; return body; };
    if (shadowHash(semantic(actual)) !== shadowHash(semantic(row.binding))) fail("STANDARD_STARTUP_BINDING_REVIEW_REQUIRED");
    if (shadowHash(actual) !== shadowHash(row.binding)) { changed.push(actual.id); row.binding = structuredClone(actual); nextModel.operation_pins[actual.id] = shadowHash(actual); }
  }
  if (changed.length) {
    nextModel.revision++; nextCatalog.revision = nextModel.revision; nextCatalog.model.revision = nextModel.revision; nextCatalog.model.sha256 = shadowHash(nextModel);
  }
  verifyStandardWorkflowComponentAssets({ ...input, catalog: nextCatalog, model: nextModel });
  return { changed, catalog: nextCatalog, model: nextModel };
}
