import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createProjectAgenticProcessExecution } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { createStandardWorkflowMixedHost } from "../../src/application/runtime/standard-workflow-mixed-composition.mjs";
import { createNativeAllocationWorkerAuthority } from "../../src/application/runtime/native-allocation-worker-authority.mjs";
import { agenticProcessImplementationPins } from "../../src/application/runtime/agentic-process-implementation-pins.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { transport } from "./agentic-native-rpc-fixture-lib.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";

// These are controlled producer fixtures. They exercise the fixed host and
// retain its real operation journals; they are not genuine model judgement.
export function configureCyclePreworkFixture(f, objective) {
  const model = f.model, root = model.nodes.find(node => node.id === model.entry);
  const activity = model.nodes.find(node => node.id === "analyze" && node.kind === "activity");
  assert.ok(activity); assert.equal(root.kind, "sequence"); assert.ok(root.children.includes(activity.id));
  root.children.splice(root.children.indexOf(activity.id), 0, "prework_cycle_admit", "prework_cycle_initialize");
  for (const [id, binding_ref] of [["prework_cycle_admit", "cycle_admit"], ["prework_cycle_initialize", "cycle_initialize"]])
    model.nodes.push({ id, kind: "operation", participant_ref: activity.participant_ref, binding_ref });
  model.nodes.find(node => node.id === "plan_evaluate").binding_ref = "cycle_prework_evaluate";
  if (model.data_bindings.contract_version === "process-data-bindings.v1") model.data_bindings.contract_version = "process-data-bindings.v2";
  model.data_bindings.inputs.push({ node_id: "prework_cycle_admit", fields: {} }, { node_id: "prework_cycle_initialize", fields: {
    session_id: { source: "parameter", key: "session", path: ["session_id"] },
    ...Object.fromEntries(Object.entries({ cycle_id: "C001", cycle_type: "feature", title: "planning", objective })
      .map(([key, value]) => [key, { source: "literal", value }])),
    continuity_rule: { source: "operation_output", node_id: "prework_cycle_admit", path: ["observations", "lifecycle", "continuity_rule"] },
    base_branch: { source: "operation_output", node_id: "prework_cycle_admit", path: ["observations", "lifecycle", "continuity_base_branch"] },
  } });
  if (!model.data_bindings.inputs.some(row => row.node_id === activity.id)) model.data_bindings.inputs.push({ node_id: activity.id, fields: {} });
  model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(binding => model.nodes.some(node => node.binding_ref === binding.id))
    .map(binding => [binding.id, shadowHash(binding)]));
  f.configuration.activity_outputs.analyze = "standard-cycle-prework-report.v1";
  const bytes = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, bytes); f.configuration.model.sha256 = artifactContentHash(bytes);
}

export function preworkPlanningContext(observed) {
  assert.equal(observed.context.contract_version, "standard-cycle-prework-context.v1");
  return { context: observed.context.planning_context, context_sha256: observed.context.planning_context_sha256, evidence_refs: observed.evidence_refs };
}
export function preworkPlanningReport(observed, proposal) {
  const subject = observed.context.subject, evidence = observed.evidence_refs.filter(row => row.ref === "audit:SPEC.md");
  assert.equal(evidence.length, 1);
  const judgement = rule => ({ verdict: "passed", rationale: "Controlled fixture judgement against the supplied current source",
    rule_refs: [rule], evidence_refs: structuredClone(evidence), findings: [], questions: [] });
  return { contract_version: "standard-cycle-prework-report.v1", kind: subject.kind === "fresh_cycle" ? "propose_plan" : "audit_canonical_plan",
    context_sha256: observed.context_sha256, subject_sha256: shadowHash(subject), origin_operation_id: subject.origin_operation_id,
    proposal: subject.kind === "fresh_cycle" ? proposal : null, audits: { intent: judgement("SPEC-R03"), architecture: judgement("SPEC-R04") } };
}

// Test-model wiring only. The actual host still authenticates the current
// canonical origin, selector, Native result and evaluation before readiness.
export function captureCyclePreworkActorFixture(f) {
  const activity = f.model.nodes.find(node => node.id === "analyze" && node.kind === "activity");
  assert.ok(activity);
  const role = f.model.roles.find(row => row.id === activity.role_ref), policy = f.model.policies.find(row => row.id === activity.policy_ref);
  assert.ok(role && policy); assert.deepEqual(policy.allowed_permissions, ["read:product"]);
  return structuredClone({ activity, role, policy });
}
export function configureCanonicalPreworkFixture(f, { actor, beforeNodeId }) {
  const model = f.model, sequence = model.nodes.find(node => node.id === model.entry);
  assert.equal(sequence.kind, "sequence");
  const index = sequence.children.indexOf(beforeNodeId); assert.ok(index >= 0);
  const ids = ["prework_select", "initial_audit", "prework_evaluate"];
  for (const id of ids) assert.ok(!model.nodes.some(node => node.id === id));
  for (const [field, value] of [["roles", actor.role], ["policies", actor.policy]]) {
    const old = model[field].find(row => row.id === value.id);
    if (old) assert.deepEqual(old, value); else model[field].push(structuredClone(value));
  }
  sequence.children.splice(index, 0, ...ids);
  model.nodes.push({ id: ids[0], kind: "operation", participant_ref: actor.activity.participant_ref, binding_ref: "cycle_prework_select" },
    { ...structuredClone(actor.activity), id: ids[1] },
    { id: ids[2], kind: "operation", participant_ref: actor.activity.participant_ref, binding_ref: "cycle_prework_evaluate" });
  model.data_bindings.contract_version = "process-data-bindings.v4";
  model.data_bindings.inputs.push({ node_id: ids[0], fields: {} },
    { node_id: ids[1], fields: { selection_operation_id: { source: "operation_id", node_id: ids[0] } } },
    { node_id: ids[2], fields: { report_occurrence_id: { source: "occurrence_id", node_id: ids[1] } } });
  model.operation_pins = Object.fromEntries(standardWorkflowOperationBindings().filter(binding => model.nodes.some(node => node.binding_ref === binding.id))
    .map(binding => [binding.id, shadowHash(binding)]));
  f.configuration.activity_outputs[ids[1]] = "standard-cycle-prework-report.v1";
  f.configuration.instructions[ids[1]] = "Assess the admitted canonical plan and its current intent/architecture without generating replacement planning or writing files.";
  const bytes = JSON.stringify(model); fs.writeFileSync(f.configuration.model.path, bytes); f.configuration.model.sha256 = artifactContentHash(bytes);
}

export async function executeCanonicalPreworkFixture(f, authorization) {
  const before = f.t.sessions.length, selected = await f.open().step({ write: true });
  const selection = f.open().readOperation(selected.operation_id);
  assert.equal(selection.intent.binding_ref, "cycle_prework_select");
  assert.equal(selection.results.at(-1).output.facts.cycle_prework_required, true);
  assert.equal(selection.results.at(-1).output.observations.subject.kind, "canonical_plan");
  const native = await f.open().step({ write: true, authorization });
  assert.equal(native.kind, "native"); assert.equal(native.journal_phase, "closed", JSON.stringify(native));
  const evaluated = await f.open().step({ write: true }), evaluation = f.open().readOperation(evaluated.operation_id), output = evaluation.results.at(-1).output;
  assert.equal(evaluation.intent.binding_ref, "cycle_prework_evaluate");
  assert.equal(output.facts.cycle_prework_passed, true); assert.equal(output.facts.cycle_plan_record_required, false);
  assert.equal(output.observations.selection_operation_id, selected.operation_id);
  assert.equal(output.observations.report.kind, "audit_canonical_plan"); assert.equal(output.observations.report.proposal, null);
  assert.equal(f.t.sessions.length, before + 1); assert.ok(f.t.sessions.every(row => row.closed));
  assert.ok(f.open().inspectAllocations().allocations.every(row => row.phase === "closed"));
  return { selection_operation_id: selected.operation_id, evaluation_operation_id: evaluated.operation_id, output };
}

// One current read-only actor for the owned-source entry fixture. Controller/RPC
// are identified doubles; origin, Native context, journals and DoR use real ports.
export function createOwnedPreworkNativeFixture({ targetRoot, base, model, signingKey }) {
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const dirs = { product: path.join(targetRoot, "product"), control: path.join(base, "control"), review: path.join(base, "review"), home: path.join(base, "native") };
  for (const name of ["control", "review", "home"]) fs.mkdirSync(dirs[name], { recursive: true });
  const pin = (name, bytes) => { const file = path.join(base, name); fs.writeFileSync(file, bytes, { flag: "wx" }); return { path: file, sha256: hash(bytes) }; };
  const configuration = { contract_version: "agentic-process-execution.v1", instance_id: "choice-record", target_root: targetRoot,
    implementation_sha256: agenticProcessImplementationPins().sha256, product_root: dirs.product, control_root: dirs.control, review_root: dirs.review, product_files: ["app.mjs"],
    model: pin("native-prework-model.json", JSON.stringify(model)), criteria: pin("native-prework-criteria.md", "Assess current canonical intent and architecture read-only; preserve planning and product bytes."),
    authorities: { project: { path: path.join(targetRoot, "AGENTS.md"), sha256: hash(fs.readFileSync(path.join(targetRoot, "AGENTS.md"))) } },
    skills: { architecture: pin("native-prework-architecture.md", "Assess architecture from the supplied current sources."), tests: pin("native-prework-tests.md", "Assess explicit criteria without claiming work or executing checks.") },
    instructions: {}, activity_outputs: {},
    native: { executable: process.execPath, sha256: hash(fs.readFileSync(process.execPath)), home: dirs.home, tool_roots: [],
      hook_hashes: { work: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-model", effort: "medium",
      startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker], log_dir: dirs.control, sqlite_home: dirs.control } } };
  const worker = fileURLToPath(new URL("../../src/adapters/agents/agentic-process-worker.mjs", import.meta.url));
  configuration.controller = { node_sha256: hash(fs.readFileSync(process.execPath)), worker_sha256: hash(fs.readFileSync(worker)), helper_path: "fixture", helper_sha256: "a".repeat(64), helper_source_sha256: "b".repeat(64) };
  const f = { configuration, dirs, base, model, key: signingKey };
  const actor = captureCyclePreworkActorFixture({ model: JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url))) });
  actor.activity.participant_ref = model.participants[0].id;
  actor.role.skills = ["cycle-create"];
  configuration.skills["cycle-create"] = pin("native-prework-cycle-create.md", fs.readFileSync(new URL("../../scaffold/codex/aidn-cycle-create/SKILL.md", import.meta.url)));
  const t = transport(f, { readOnlyAnswer: true, answer({ params }) { const observed = JSON.parse(params.input[0].text.split("\n").at(-1));
    assert.equal(observed.context.subject.kind, "canonical_plan");
    return { outcome: "completed", summary: "Controlled current initial audit of owned canonical DATA", report: preworkPlanningReport(observed, null) }; } });
  const controllerFactory = () => ({ async checkAvailability() { return { available: true }; }, async run(request, { onEvent }) {
    f.launches = (f.launches ?? 0) + 1; const sent = JSON.parse(request.stdin); let native;
    const allocationAuthority = createNativeAllocationWorkerAuthority({ configuration, authorization: sent.authorization, admission: sent.allocation, readProductSha256: () => native.preview().product_sha256 });
    native = createProjectAgenticProcessExecution(configuration, { rpcFactory: t.rpcFactory, allocationAuthority, processAuthority: allocationAuthority.processAuthority });
    const result = await native.run({ execute: true, authorization: sent.authorization });
    await onEvent({ type: "stdout", bytes: Buffer.from(JSON.stringify(result)) });
    return { outcome: "completed", termination_state: "confirmed", termination_proof: { active_processes: 0 } };
  } });
  const open = () => createStandardWorkflowMixedHost({ configuration, readSigningKey: () => signingKey,
    authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "a".repeat(64) }) }, { controllerFactory });
  return Object.assign(f, { actor, t, open, reopen: open, authorize() { const at = Date.now();
    return { approved: true, model_allowed: true, authorized_at_ms: at, global_deadline_ms: at + 1860000, workflow_deadline_ms: at + 1860000,
      max_turn_ms: 60000, max_responses: 6, max_bytes: 10 * 1024 * 1024, configuration_sha256: shadowHash(configuration) }; } });
}
