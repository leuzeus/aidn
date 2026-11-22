import assert from "node:assert/strict";
import fs from "node:fs";
import { loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { createWorkflowPropertyCatalog } from "../../src/application/workflow/workflow-property-catalog.mjs";

const { model, catalog } = loadStandardWorkflowAssets();
const readSchema = id => JSON.parse(fs.readFileSync(new URL(
  "../../src/core/contracts/workflow-definition/" + id + ".schema.json", import.meta.url)));
const standard = createWorkflowPropertyCatalog({ operations: catalog.bindings.map(row => row.binding),
  roles: model.roles, policies: model.policies, readSchema });
const sample = standard.operations.find(op => op.inputs.some(input => input.editable));
assert.ok(sample);
assert.ok(sample.outputs.every(field => !field.editable));
assert.deepEqual(standard.roles, model.roles);
assert.ok(standard.activity_types.includes("operation"));
const binding = { ...sample.binding, id: "verify_sample", input_contract: "sample.v1" };
const fixture = createWorkflowPropertyCatalog({ operations: [binding], readSchema: id => id === "sample.v1" ?
  { type: "object", required: ["sample_size"], properties: { sample_size: { type: "integer", minimum: 1 } } } : readSchema(id) });
assert.deepEqual(fixture.operations[0].inputs, [{ name: "sample_size", required: true, editable: true,
  schema: { type: "integer", minimum: 1 } }]);
assert.equal(fixture.operations[0].provenance.editable, false);
assert.throws(() => createWorkflowPropertyCatalog({ operations: [binding, { ...binding, effect_class: "preview" }],
  readSchema: () => ({ properties: {} }) }), /CONFLICT/);
console.log("PASS STANDARD and custom property catalogs, generated inputs, output and provenance visibility");
