import schema from "../contracts/workflow-definition/standard-owned-cycle-planning-selection-output.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { ownedCanonicalResumeIntent } from "./standard-owned-cycle-resume.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
export const ownedCyclePlanningSelectOperation = "cycle_owned_planning_select";
export const ownedPlanningScaffoldNames = Object.freeze(["plan", "audit-spec", "traceability"]);

// Only an untouched scaffold can select fresh planning. An incomplete or
// malformed existing plan remains on canonical admission's explicit refusal
// path; a failed parser is never permission to replace prior planning.
export function isOwnedCyclePlanningScaffold(context, templates) {
  if (context.mode !== "COMMITTING" || context.cycle_state !== "OPEN") return false;
  const status = context.documents.find(row => row.ref === `audit:${context.cycle_path}/status.md`);
  if (!status || artifactContentHash(status.content) !== status.sha256) fail("STANDARD_OWNED_PLANNING_CONTEXT_CHANGED");
  const fields = analyzeStructuredArtifact(status.content).key_values;
  if (fields.state !== "OPEN" || fields.session_owner !== context.session_id || fields.branch_name !== context.branch
    || fields.scope_frozen !== "false" || fields.dor_state !== "NOT_READY" || fields.dor_override_reason !== "none"
    || fields.usage_matrix_state !== "NOT_DEFINED") return false;
  if (ownedCanonicalResumeIntent(status.content, context).work_intent !== "continue_implementation") return false;
  return ownedPlanningScaffoldNames.every(name => {
    const template = templates.find(row => row.path === `cycles/TEMPLATE_${name}.md`),
      material = context.documents.find(row => row.ref === `audit:${context.cycle_path}/${name}.md`);
    if (!template || !material || artifactContentHash(template.content) !== template.sha256
      || artifactContentHash(material.content) !== material.sha256) fail("STANDARD_OWNED_PLANNING_TEMPLATE_REQUIRED");
    return material.content === template.content.replaceAll("CXXX", context.cycle_id).replaceAll("[type]", context.cycle_type);
  });
}

export function assertOwnedCyclePlanningSelection(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_OWNED_PLANNING_OUTPUT_INVALID");
  if (value.outcome !== "completed") return value;
  const source = value.observations;
  if (value.facts.owned_cycle_planning_required !== source.planning_required
    || source.planning_required && (source.cycle_state !== "OPEN" || source.templates.length !== ownedPlanningScaffoldNames.length)
    || shadowHash(source.canonical) !== source.canonical_sha256
    || new Set([...source.canonical, ...source.templates].map(row => row.path)).size !== source.canonical.length + source.templates.length
    || shadowHash(value.evidence_refs) !== shadowHash([...source.canonical, ...source.templates].map(row => ({ ref: "audit:" + row.path, sha256: row.sha256 }))))
    fail("STANDARD_OWNED_PLANNING_OUTPUT_INVALID");
  return value;
}
