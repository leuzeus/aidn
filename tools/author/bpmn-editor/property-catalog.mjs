import fs from "node:fs";
import { createWorkflowPropertyCatalog } from "../../../src/application/workflow/workflow-property-catalog.mjs";
import { processModels } from "../../../src/core/workflow/process-call-model.mjs";
import evaluations from "../../../package/catalogs/workflow-evaluations.v1.json" with { type: "json" };
import standardProfile from "../../../package/catalogs/standard-role-profile.v1.json" with { type: "json" };

export function standardPropertyCatalog(assets) {
  const schemas = new Map();
  function readSchema(id) {
    if (!schemas.has(id)) schemas.set(id, JSON.parse(fs.readFileSync(new URL(
      "../../../src/core/contracts/workflow-definition/" + id + ".schema.json", import.meta.url))));
    return schemas.get(id);
  }
  const definitions = assets.catalog.bindings.map(row => row.binding);
  return createWorkflowPropertyCatalog({ operations: definitions, roles: assets.model.roles,
    policies: assets.model.policies, roleProfiles: [standardProfile], evaluations, readSchema,
    facts: processModels(assets.model).flatMap(model => model.nodes.flatMap(node =>
      (node.branches ?? []).map(branch => branch.condition).filter(Boolean))) });
}
