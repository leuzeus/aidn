import { createHash } from "node:crypto";
import catalogSchema from "../contracts/workflow-definition/standard-workflow-startup-catalog.v1.schema.json" with { type: "json" };
import cycleCatalogSchema from "../contracts/workflow-definition/standard-cycle-create-catalog.v1.schema.json" with { type: "json" };
import standardCatalogSchema from "../contracts/workflow-definition/standard-workflow-catalog.v1.schema.json" with { type: "json" };
import standardCatalogSchemaV2 from "../contracts/workflow-definition/standard-workflow-catalog.v2.schema.json" with { type: "json" };
import standardCatalogSchemaV3 from "../contracts/workflow-definition/standard-workflow-catalog.v3.schema.json" with { type: "json" };
import startupCatalogSchemaV2 from "../contracts/workflow-definition/standard-workflow-startup-catalog.v2.schema.json" with { type: "json" };
import standardCatalogSchemaV4 from "../contracts/workflow-definition/standard-workflow-catalog.v4.schema.json" with { type: "json" };
import sourceSchema from "../contracts/workflow-definition/standard-workflow-model-source.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { assertAgenticProcessModel } from "./agentic-process-model.mjs";
import { processModelIdentity, processModels } from "./process-call-model.mjs";
import { assertProcessOperationBinding } from "./process-operation-contracts.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const catalogSchemas = new Map([
  ["standard-workflow-startup-catalog.v1", catalogSchema],
  ["standard-cycle-create-catalog.v1", cycleCatalogSchema],
  ["standard-workflow-catalog.v1", standardCatalogSchema],
  ["standard-workflow-catalog.v2", standardCatalogSchemaV2],
  ["standard-workflow-catalog.v3", standardCatalogSchemaV3],
  ["standard-workflow-startup-catalog.v2", startupCatalogSchemaV2],
  ["standard-workflow-catalog.v4", standardCatalogSchemaV4],
]);
const composedCatalog = catalog => Object.hasOwn(catalog, "activities");
export const standardAssetHash = bytes => createHash("sha256").update(bytes).digest("hex");
export function assertStandardWorkflowStartupCatalog(catalog, model) {
  if (!["standard-workflow-startup-catalog.v1", "standard-workflow-startup-catalog.v2"].includes(catalog?.contract_version)) fail("STANDARD_STARTUP_CATALOG_INVALID");
  return assertStandardWorkflowComponentCatalog(catalog, model);
}
export function assertStandardWorkflowComponentCatalog(catalog, model) {
  const schema = catalogSchemas.get(catalog?.contract_version);
  if (!schema || checkShadowJson(catalog) || validateJsonSchema(catalog, schema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_STARTUP_CATALOG_INVALID");
  assertAgenticProcessModel(model);
  const rootIdentity = processModelIdentity(model);
  if (model.contract_version !== "agentic-process-model.v2" || catalog.model.sha256 !== rootIdentity.model_sha256
    || catalog.model.model_id !== model.model_id || catalog.model.revision !== model.revision || catalog.revision !== model.revision) fail("STANDARD_STARTUP_MODEL_CHANGED");
  const [, ...targets] = processModels(model);
  if (targets.some(target => target.nodes.some(node => node.kind === "activity"))) fail("STANDARD_EMBEDDED_ACTIVITY_UNSUPPORTED");
  const embeddedCatalog = [standardCatalogSchemaV3, standardCatalogSchemaV4].includes(schema);
  if (embeddedCatalog) for (const target of targets) {
    const events = target.nodes.filter(node => node.kind === "event");
    if (!events.length) continue;
    const [wait] = events;
    if (target.model_id !== "aidn-standard-pr-review-capture" || events.length !== 1 || target.entry !== wait.id
      || wait.id !== "session_pr_review_wait" || wait.branches.map(row => row.event_key).join(",") !== "review_snapshot,checks_snapshot,external_merge_observed"
      || target.nodes.some(node => node !== wait && (node.kind !== "sequence" || node.children.length)))
      fail("STANDARD_EMBEDDED_EVENT_UNSUPPORTED");
  }
  const operations = component => new Map(component.nodes.filter(node => node.kind === "operation").map(node => [node.id, node]));
  const rootOperations = operations(model);
  const targetOperations = new Map(targets.map(target => {
    const identity = processModelIdentity(target);
    return [identity.model_sha256, { identity, operations: operations(target), pins: target.operation_pins }];
  }));
  const targetCount = [...targetOperations.values()].reduce((count, target) => count + target.operations.size, 0);
  const ids = catalog.bindings.map(row => `${row.model_ref?.model_sha256 ?? rootIdentity.model_sha256}:${row.node_id}`);
  if ((targetCount && !embeddedCatalog) || rootOperations.size + targetCount !== ids.length || new Set(ids).size !== ids.length
    || new Set(catalog.scope.entry_conditions).size !== 2 || new Set(catalog.scope.remaining_activities).size !== catalog.scope.remaining_activities.length) fail("STANDARD_STARTUP_COVERAGE_INVALID");
  for (const row of catalog.bindings) {
    assertProcessOperationBinding(row.binding);
    const target = row.model_ref && targetOperations.get(row.model_ref.model_sha256);
    if (row.model_ref && (!target || target.identity.model_id !== row.model_ref.model_id
      || target.identity.revision !== row.model_ref.revision)) fail("STANDARD_STARTUP_TARGET_CHANGED");
    const node = (target?.operations ?? rootOperations).get(row.node_id);
    const pins = target?.pins ?? model.operation_pins;
    if (!node || node.binding_ref !== row.binding.id || pins[node.binding_ref] !== shadowHash(row.binding)
      || row.skill_source.path !== `scaffold/codex/aidn-${row.binding.skill_id}/SKILL.md`) fail("STANDARD_STARTUP_BINDING_CHANGED");
  }
  if (composedCatalog(catalog)) {
    const activities = model.nodes.filter(node => node.kind === "activity");
    if (activities.length !== catalog.activities.length || new Set(catalog.activities.map(row => row.node_id)).size !== activities.length)
      fail("STANDARD_ACTIVITY_COVERAGE_INVALID");
    for (const row of catalog.activities) {
      const activity = activities.find(node => node.id === row.node_id), role = model.roles.find(role => role.id === activity?.role_ref);
      const skills = row.skill_sources.map(source => source.path);
      if (!role || new Set(row.rule_refs).size !== row.rule_refs.length || new Set(skills).size !== skills.length
        || skills.length !== role.skills.length || role.skills.some(id => !skills.includes(`scaffold/codex/aidn-${id}/SKILL.md`)))
        fail("STANDARD_ACTIVITY_BINDING_INVALID");
    }
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
  for (const row of catalog.activities ?? []) {
    if (row.rule_refs.some(rule => !String(specification).includes("`" + rule + "`"))) fail("STANDARD_ACTIVITY_RULE_MISSING");
    for (const source of row.skill_sources) if (!skills[source.path] || standardAssetHash(skills[source.path]) !== source.sha256)
      fail("STANDARD_ACTIVITY_SKILL_CHANGED");
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

export function assertStandardWorkflowActivityOutputs(source, model, outputs) {
  assertStandardWorkflowModelSource(source, model);
  if (!composedCatalog(source.catalog)) return;
  const expected = Object.fromEntries(source.catalog.activities.map(row => [row.node_id, row.output_contract]));
  if (checkShadowJson(outputs) || shadowHash(outputs) !== shadowHash(expected)) fail("STANDARD_ACTIVITY_OUTPUT_CONTRACT_CHANGED");
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
    if (shadowHash(actual) !== shadowHash(row.binding)) {
      if (row.model_ref) fail("STANDARD_EMBEDDED_PIN_REAUTHOR_REQUIRED");
      changed.push(actual.id); row.binding = structuredClone(actual); nextModel.operation_pins[actual.id] = shadowHash(actual);
    }
  }
  if (changed.length) {
    nextModel.revision++; nextCatalog.revision = nextModel.revision; nextCatalog.model.revision = nextModel.revision; nextCatalog.model.sha256 = shadowHash(nextModel);
  }
  verifyStandardWorkflowComponentAssets({ ...input, catalog: nextCatalog, model: nextModel });
  return { changed, catalog: nextCatalog, model: nextModel };
}
