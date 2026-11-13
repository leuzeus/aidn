import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
import { assertCycleEntrySelectedInput } from "./standard-cycle-entry-selected-source.mjs";
import planSchema from "../contracts/workflow-definition/standard-cycle-entry-selected-checkpoint-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../contracts/workflow-definition/standard-cycle-entry-selected-checkpoint-output.v1.schema.json" with { type: "json" };

export const cycleEntrySelectedCheckpointOperation = "cycle_entry_selected_checkpoint";
const fail = code => { throw Object.assign(Error(code), { code }); };
const unique = rows => new Set(rows).size === rows.length;
const canonical = name => typeof name === "string" && name.length <= 2048
  && /^docs\/audit\/(?!workflows(?:\/|$))/i.test(name) && !/[\\\u0000-\u001f]/.test(name)
  && !name.split("/").some(part => !part || part === "." || part === ".." || /^(?:[.]git|[.]aidn|[.]codex|[.]agents)$/i.test(part));

export function assertSelectedContextCheckpointPlan(plan) {
  if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
    || !Number.isSafeInteger(plan.prepared_at_ms) || Buffer.byteLength(JSON.stringify(plan)) > 1048576)
    fail("STANDARD_SELECTED_CHECKPOINT_PLAN_INVALID");
  assertCycleEntrySelectedInput(plan.input);
  const context = plan.context, selected = context.selected_cycle, view = plan.git.observed,
    physical = new Map(plan.physical_canonical.map(row => [row.path, row.content])), overlay = new Set(plan.overlay_paths);
  if (context.activation_operation_id !== plan.input.activation_operation_id || context.source_sha256 !== plan.source_sha256
    || shadowHash(context) !== plan.context_sha256 || selected.branch !== view.branch || selected.head !== view.head
    || view.ref !== "refs/heads/" + selected.branch || !view.index_clean || view.lock_present
    || !unique(context.canonical.map(row => row.path)) || !unique(plan.physical_canonical.map(row => row.path))
    || !unique(plan.overlay_paths) || !plan.overlay_paths.every(canonical)
    || plan.overlay_paths.some(name => !physical.has(name)) || !unique(plan.git.files.map(row => row.path))
    || shadowHash(plan.git.files.map(row => row.path).sort()) !== shadowHash(view.changes.map(row => row.path).sort())
    || plan.git.files.some(row => !canonical(row.path) || !overlay.has(row.path)
      || row.sha256 !== (physical.get(row.path)?.sha256 ?? null)))
    fail("STANDARD_SELECTED_CHECKPOINT_PLAN_INVALID");
  return plan;
}

export function assertSelectedContextCheckpointOutput(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, outputSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("STANDARD_SELECTED_CHECKPOINT_OUTPUT_INVALID");
  if (value.outcome === "completed") {
    const observation = value.observations, git = observation.git, created = git.status === "confirmed";
    if (value.effect_status !== (created ? "confirmed" : "no_effect")
      || value.facts.cycle_entry_selected_checkpoint_created !== created
      || !unique(observation.committed_paths) || !observation.committed_paths.every(canonical)
      || created !== (observation.committed_paths.length > 0)
      || observation.selected_branch_head !== (created ? git.commit_sha : git.head))
      fail("STANDARD_SELECTED_CHECKPOINT_OUTPUT_INVALID");
  }
  return value;
}
