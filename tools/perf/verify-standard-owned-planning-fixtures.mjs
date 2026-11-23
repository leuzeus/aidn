import assert from "node:assert/strict";
import fs from "node:fs";
import { createPreworkAuthorityFixture } from "./standard-cycle-prework-authority-fixture-lib.mjs";
import { cyclePlanProposal } from "./cycle-planning-fixture-lib.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { isOwnedCyclePlanningScaffold, assertOwnedCyclePlanningSelection } from "../../src/core/workflow/standard-owned-cycle-planning.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";

const op = digit => "op_" + digit.repeat(40), H = "a".repeat(64), checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log("PASS " + name); };
export function ownedPlanningAuthorityFixture() {
  const f = createPreworkAuthorityFixture(cyclePlanProposal), p = f.planning;
  p.branch = "feature/C001-prework";
  const status = `state: OPEN\nsession_owner: S001\nbranch_name: ${p.branch}\nscope_frozen: false\ndor_state: NOT_READY\ndor_override_reason: none\nusage_matrix_state: NOT_DEFINED\n`;
  const contents = new Map([["SPEC.md", "Exact fixture SPEC"], ["CURRENT-STATE.md", "Fixture current"], ["sessions/S001.md", "Fixture session"],
    [`${p.cycle_path}/status.md`, status], [`${p.cycle_path}/brief.md`, "Fixture objective"]]);
  for (const name of ["plan", "audit-spec", "traceability"]) {
    const content = fs.readFileSync(new URL(`../../scaffold/docs_audit/cycles/TEMPLATE_${name}.md`, import.meta.url), "utf8");
    f.templateRows.push({ path: `cycles/TEMPLATE_${name}.md`, content, sha256: artifactContentHash(content), metadata_sha256: H });
    contents.set(`${p.cycle_path}/${name}.md`, content.replaceAll("CXXX", p.cycle_id).replaceAll("[type]", p.cycle_type));
  }
  p.documents = [...contents].map(([name, content]) => ({ ref: "audit:" + name, content, sha256: artifactContentHash(content) }));
  f.rows.splice(0, f.rows.length, ...p.documents.map(({ ref, content, sha256 }) => ({ path: ref.slice(6), content, sha256, metadata_sha256: H })));
  f.evidenceRefs.splice(0, f.evidenceRefs.length, ...p.documents.map(({ ref, sha256 }) => ({ ref, sha256 })));
  const canonical = f.rows.filter(row => row.path !== "SPEC.md").map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
  const entry = { contract_version: "standard-cycle-entry-output.v1", operation_ref: "cycle_entry_admit", outcome: "completed", effect_status: "no_effect",
    facts: { cycle_entry_creation_allowed: false, cycle_entry_resume_allowed: true, cycle_entry_choice_required: false },
    observations: { action: "resume_cycle", reason_code: null, scope_sha256: shadowHash({ scope_sha256: f.state.scope, head: f.state.head }), inventory_sha256: H,
      implementation_authorized: false, selected_cycle: { cycle_id: p.cycle_id, cycle_path: p.cycle_path, branch: p.branch, state: "OPEN", dor_state: "NOT_READY", scope_frozen: "false" }, canonical },
    evidence_refs: canonical.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256 })) };
  f.records.clear(); f.instance.events.length = 0;
  f.retain(op("0"), "cycle_entry_admit", entry, { contract_version: "standard-cycle-entry-input.v1", session_id: p.session_id, cycle_id: null });
  f.choose = async () => {
    const value = await f.authority.selectOwnedPlanning(f.instance, { entry_operation_id: op("0") });
    f.retain(op("1"), "cycle_owned_planning_select", value, { entry_operation_id: op("0") }); return value;
  };
  return f;
}

await check("owned planning uses an entry-only read-only COMMITTING contract", () => {
  const binding = standardWorkflowOperationBindings().find(row => row.id === "cycle_owned_planning_select");
  assert.equal(binding.effect_class, "read-only"); assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
  assertStandardOperationInput(binding.id, { entry_operation_id: op("0") });
  assert.throws(() => assertStandardOperationInput(binding.id, { entry_operation_id: op("0"), authorized: true }));
  const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-owned-cycle-planning-selection-output.v1.schema.json", import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
});
await check("owned untouched scaffold selects a fresh plan without creating a session or cycle", async () => {
  const f = ownedPlanningAuthorityFixture(), before = JSON.stringify(f.rows), chosen = await f.choose();
  assertOwnedCyclePlanningSelection(chosen); assertStandardOperationOutput(chosen);
  assert.equal(chosen.facts.owned_cycle_planning_required, true); assert.equal(chosen.effect_status, "no_effect");
  await f.select(); const prepared = await f.capture();
  assert.equal(prepared.context.subject.kind, "fresh_cycle"); assert.equal(prepared.context.subject.origin_operation_id, op("1"));
  const evaluated = await f.authority.evaluate(f.instance, { report_occurrence_id: "root/plan" });
  assert.deepEqual(evaluated.facts, { cycle_plan_available: true, cycle_plan_record_required: true, cycle_prework_passed: true });
  assert.equal(JSON.stringify(f.rows), before);
});
await check("a partial plan or audit never falls back to replacement planning", () => {
  for (const name of ["plan", "audit-spec", "traceability"]) {
    const f = ownedPlanningAuthorityFixture(), material = f.planning.documents.find(row => row.ref.endsWith("/" + name + ".md"));
    material.content += "\nUser content retained.\n"; material.sha256 = artifactContentHash(material.content);
    assert.equal(isOwnedCyclePlanningScaffold(f.planning, f.templateRows), false);
  }
});
await check("an implemented, frozen or ready cycle cannot select a fresh plan", () => {
  for (const field of ["phase", "scope_frozen", "dor_state", "session_owner", "branch_name"]) {
    const f = ownedPlanningAuthorityFixture();
    if (field === "phase") f.planning.cycle_state = "IMPLEMENTING";
    else { const row = f.planning.documents.find(row => row.ref.endsWith("/status.md"));
      row.content = row.content.replace(new RegExp(field + ": [^\\n]+"), field + ": changed"); row.sha256 = artifactContentHash(row.content); }
    assert.equal(isOwnedCyclePlanningScaffold(f.planning, f.templateRows), false);
  }
});
await check("an integration-only choice cannot acquire fresh planning through an untouched scaffold", () => {
  const f = ownedPlanningAuthorityFixture(), row = f.planning.documents.find(row => row.ref.endsWith("/status.md"));
  const choice = { decision_operation_id: op("3"), decision_source_sha256: H, choice_record_operation_id: op("4"),
    selected_cycle_id: "C001", branch_activation: "pending", implementation_authorized: false, action: "integrate_now",
    rationale: "Retain integration-only intent", previous_session_owner: "S000", session_owner: "S001",
    previous_state: "OPEN", state: "OPEN", cycle_close_completed: "NOT_CLAIMED", integration_completed: false };
  row.content += `\n## Process cycle choice ${op("4")}\n\n\`\`\`json\n${JSON.stringify(choice)}\n\`\`\`\n`;
  row.sha256 = artifactContentHash(row.content);
  assert.equal(isOwnedCyclePlanningScaffold(f.planning, f.templateRows), false);
});
await check("entry identity, owner, backend, metadata, product and process drift refuse selection", async () => {
  for (const field of ["entry", "owner", "backend", "metadata", "product", "process"]) {
    const f = ownedPlanningAuthorityFixture();
    f.state.afterObserve = () => {
      if (field === "entry") f.records.get(op("0")).record.changed = true;
      if (field === "owner") f.state.owner = true;
      if (field === "backend") f.state.backend = "postgres";
      if (field === "metadata") f.rows[0].metadata_sha256 = "f".repeat(64);
      if (field === "product") f.state.product = "f".repeat(64);
      if (field === "process") f.state.instanceSha = "f".repeat(64);
    };
    await assert.rejects(f.choose(), /(?:CHANGED|RECONCILIATION_REQUIRED)/);
  }
});
await check("source changes after selection refuse Native preparation", async () => {
  const f = ownedPlanningAuthorityFixture(); await f.choose(); await f.select();
  f.templateRows[0].content += "\nChanged template\n"; f.templateRows[0].sha256 = artifactContentHash(f.templateRows[0].content);
  await assert.rejects(f.capture(), /STANDARD_OWNED_PLANNING_SOURCE_CHANGED/);
});
console.log(JSON.stringify({status:"PASS",checks:checks.length,scope:"OWNED_UNPLANNED_AUTHORITY_PORT_FIXTURES",native_model:"NOT_RUN",host_effects:"NOT_RUN",p0:false}));
