import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardCanonicalPlanAdoption } from "../../src/application/runtime/standard-canonical-plan-adoption.mjs";
import { readStandardCyclePlanContext } from "../../src/application/runtime/standard-cycle-plan-context.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { renderStandardCyclePlan } from "../../src/core/workflow/standard-cycle-planning.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

// Canonical planning here is an explicit fixture preimage written through real
// ports/CAS. It is not evidence that a prior Native planner or task ran.
export async function verifyCanonicalPlanAdoption(check, { mixedFixture, cyclePlanProposal, selectedMode }) {
  for (const mode of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) await check(`cycle plan adoption ${mode}: actual canonical source, guarded observation and signed cold acceptance`, async () => {
    const f = mixedFixture(mode, { planning: true }), root = f.configuration.target_root;
    const operations = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
    const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
    const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await operations[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
    const objective = "Preserve the existing canonical product plan";
    await apply(await operations.prepareSession({ session_id: "S001", session_branch: "S001-adoption", objective }), "initializeSession");
    await apply(await operations.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode"); checkpoint("fixture adoption mode");
    await apply(await operations.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture adoption context");
    await apply(await operations.prepareCycle({ session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "adoption", objective,
      continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-adoption" }), "initializeCycle");
    const cyclePath = "cycles/C001-feature-adoption", proposal = cyclePlanProposal({ context_sha256: "a".repeat(64), context: {
      session_id: "S001", cycle_id: "C001", cycle_type: "feature", original_objective: objective, mode: "COMMITTING", allowed_product_files: ["product/app.mjs"] },
      evidence_refs: [{ ref: "audit:SPEC.md", sha256: artifacts.read("SPEC.md", { required: true }).sha256 }] });
    const write = async (name, content) => {
      const before = artifacts.read(name, { required: true }), change = { path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after: content, after_sha256: artifactContentHash(content) };
      await artifacts.withLocalEffectOwner(shadowHash(change), () => { artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([name]); return { effect_status: "confirmed" }; });
    };
    const rendered = renderStandardCyclePlan(proposal, cyclePath, { "brief.md": artifacts.read(cyclePath + "/brief.md", { required: true }).content });
    for (const [name, content] of Object.entries(rendered)) await write(name, content);
    await operations.reload(); checkpoint("fixture canonical planning preimage");
    const binding = standardWorkflowOperationBindings().find(row => row.id === "cycle_plan_adopt");
    assert.deepEqual(binding.allowed_modes, ["COMMITTING"]); assert.equal(binding.effect_class, "read-only");
    for (const input of [{ write: true }, { producer: "native" }, { approved: true }]) assert.throws(() => assertStandardOperationInput("cycle_plan_adopt", input), { code: "STANDARD_OPERATION_INPUT_INVALID" });
    for (const key of Object.keys(f.model)) delete f.model[key];
    Object.assign(f.model, { contract_version: "agentic-process-model.v2", model_id: "canonical-adoption-fixture", revision: 1,
      participants: [{ id: "delivery" }], roles: [], policies: [], entry: "adopt", nodes: [{ id: "adopt", kind: "operation", participant_ref: "delivery", binding_ref: binding.id }],
      operation_pins: { [binding.id]: shadowHash(binding) }, data_bindings: { contract_version: "process-data-bindings.v4", parameter_keys: [], inputs: [{ node_id: "adopt", fields: {} }] } });
    const bytes = JSON.stringify(f.model); fs.writeFileSync(f.configuration.model.path, bytes); f.configuration.model.sha256 = artifactContentHash(bytes);
    f.configuration.activity_outputs = {}; f.configuration.instructions = {};
    const initial = f.open().initialize({ write: false }); f.open().initialize({ write: true, expectedResultSha256: initial.record.instance_sha256 });
    const instance = f.open().inspect().record;
    const observeContext = () => readStandardCyclePlanContext({ targetRoot: root, productRoot: f.configuration.product_root, productFiles: f.configuration.product_files,
      productSha256: f.open().previewNative().product_sha256, deniedRoots: [...(f.configuration.native.protected_roots ?? []), f.configuration.control_root, f.configuration.review_root, f.configuration.native.home] });
    const ports = { artifacts, scope: operations.observeScope, observeContext, admitEntry: input => operations.admitCycleEntry(input), readCurrent: () => f.open().inspect().record };
    const observeBusiness = () => {
      const names = artifacts.inventory().paths.filter(name => !name.startsWith("workflows/"));
      return { canonical: artifacts.readMany(names, { required: names, includeMetadata: true }), head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), status: git("status", "--porcelain"), product: fs.readFileSync(path.join(f.configuration.product_root, "app.mjs"), "utf8") };
    };
    const before = observeBusiness(), adopted = await createStandardCanonicalPlanAdoption(ports)(instance, {});
    assert.equal(adopted.outcome, "completed", adopted.observations.reason_code); assert.equal(adopted.facts.canonical_cycle_plan_available, true); assert.equal(adopted.effect_status, "no_effect");
    assert.equal(adopted.observations.implementation_authorized, false); assert.equal(adopted.observations.readiness, "not_evaluated"); assert.deepEqual(observeBusiness(), before);
    for (const forged of [{ ...adopted, facts: { canonical_cycle_plan_available: false } }, { ...adopted, observations: { ...adopted.observations, implementation_authorized: true } }, { ...adopted, observations: { ...adopted.observations, source_kind: "native" } }])
      assert.throws(() => assertStandardOperationOutput(forged), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
    const deny = await createStandardCanonicalPlanAdoption({ ...ports, admitEntry: async input => ({ ...await operations.admitCycleEntry(input), facts: {} }) })(instance, {});
    assert.equal(deny.outcome, "blocked"); assert.deepEqual(deny.facts, {});
    const foreignProposal = structuredClone(proposal); foreignProposal.tasks[0].paths[0].path = "product/foreign.mjs";
    const foreignPlan = renderStandardCyclePlan(foreignProposal, cyclePath, { "brief.md": artifacts.read(cyclePath + "/brief.md").content })[cyclePath + "/plan.md"];
    await write(cyclePath + "/plan.md", foreignPlan);
    const foreignBefore = observeBusiness();
    const foreign = await createStandardCanonicalPlanAdoption(ports)(instance, {});
    assert.equal(foreign.observations.reason_code, "STANDARD_CANONICAL_PLAN_PRODUCT_SCOPE_REQUIRED"); assert.deepEqual(foreign.facts, {});
    assert.deepEqual(observeBusiness(), foreignBefore);
    await write(cyclePath + "/plan.md", rendered[cyclePath + "/plan.md"]);
    // The fixture's deliberate CAS writes may update this row's metadata even
    // when its original content is restored. Keep every other byte/pin exact,
    // then compare each subsequent read-only operation to this new preimage.
    const restored = observeBusiness(), planName = cyclePath + "/plan.md";
    assert.deepEqual(restored, { ...before, canonical: before.canonical.map(row => row.path === planName
      ? { ...row, metadata_sha256: restored.canonical.find(item => item.path === planName).metadata_sha256 } : row) });
    await artifacts.withLocalEffectOwner("b".repeat(64), async () => {
      const held = await createStandardCanonicalPlanAdoption(ports)(instance, {}); assert.equal(held.observations.reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      return held;
    });
    let changed = false;
    await assert.rejects(createStandardCanonicalPlanAdoption({ ...ports, observeContext: async () => { const value = await observeContext(); changed = true; return value; },
      readCurrent: () => changed ? { instance_sha256: "f".repeat(64) } : f.open().inspect().record })(instance, {}), { code: "STANDARD_CANONICAL_PLAN_PROCESS_CHANGED" });
    assert.deepEqual(observeBusiness(), restored);
    const skips = [];
    if (mode !== "files") {
      const name = cyclePath + "/plan.md", store = createProjectArtifactStore({ targetRoot: root }), original = store.getArtifact(name); store.close(); let count = 0;
      try {
        const raced = await createStandardCanonicalPlanAdoption({ ...ports, observeContext: async () => {
          const value = await observeContext(); if (++count === 2) { const writer = createProjectArtifactStore({ targetRoot: root }); try { writer.upsertArtifact({ ...original, classification_reason: "fixture-canonical-adoption-metadata-change" }); } finally { writer.close(); } } return value;
        } })(instance, {});
        assert.equal(raced.observations.reason_code, "STANDARD_CANONICAL_PLAN_SOURCE_CHANGED"); assert.deepEqual(raced.facts, {});
      } finally { const writer = createProjectArtifactStore({ targetRoot: root }); try { writer.upsertArtifact(original); } finally { writer.close(); } }
    } else skips.push("metadata-only SQL writer is not applicable to FILES metadata-null rows");
    assert.deepEqual(observeBusiness(), restored);
    const state = f.open().inspect(), preview = await f.open().prepareOperation({ expectedSha256: state.record.instance_sha256, occurrenceId: state.cursor.ready[0], input: {} });
    assert.equal(preview.prepared.outcome, "completed", preview.prepared.observations.reason_code);
    const staged = await f.open().stageOperation(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
    const dispatched = await f.open().dispatchOperation(staged.operation_id, { write: true }); assert.equal(dispatched.receipt.outcome, "completed");
    const request = path.join(f.base, "canonical-adoption-cold.json"); fs.writeFileSync(request, JSON.stringify({ configuration: f.configuration, key_hex: f.key.toString("hex"),
      fixture_grant: { authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }, operation_id: staged.operation_id, expected_before_sha256: f.open().inspect().record.instance_sha256 }));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./standard-canonical-plan-adoption-cold-fixture.mjs", import.meta.url)), request], { encoding: "utf8", windowsHide: true, maxBuffer: 1048576 });
    fs.writeFileSync(path.join(f.base, "canonical-adoption-cold.stdout.log"), child.stdout ?? ""); fs.writeFileSync(path.join(f.base, "canonical-adoption-cold.stderr.log"), child.stderr ?? "");
    assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-8192)); const cold = JSON.parse(child.stdout); assert.equal(cold.new_native_allocations, 0);
    const final = f.reopen().inspect(); assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.instance_sha256, cold.instance_sha256);
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256); assert.equal(f.t.sessions.length, 0); assert.deepEqual(observeBusiness(), restored);
    console.log(JSON.stringify({ canonical_plan_adoption_proof: true, mode, native_responses: 0, actual_entry_and_context_ports: true, signed_dispatch_cold_acceptance: true,
      metadata_writer: mode === "files" ? "NOT_APPLICABLE" : "ACTUAL_SQLITE", changed_process: "INJECTED_COUNTEREXAMPLE", phase_preimage: "FIXTURE_SETUP", readiness: "NOT_RUN", productive_resume: "NOT_RUN", skips }));
  });
}
