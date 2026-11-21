#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardCycleEntryAdmission } from "../../src/application/runtime/standard-cycle-entry-admission.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../src/core/workflow/standard-operation-contracts.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

export async function verifyStandardExistingCycleEntry({ selectedMode } = {}) {
  const owned = [], temporary = fs.realpathSync(os.tmpdir()), H = "a".repeat(64); let checks = 0, success = false;
  const pass = name => { checks++; console.log("PASS " + name); };
  if (selectedMode && !["files", "dual", "db-only"].includes(selectedMode)) throw Error("FIXTURE_MODE_INVALID");
  try {
    for (const persistence of selectedMode ? [selectedMode] : ["files", "dual", "db-only"]) {
      const targetRoot = createFreshStandardWorkflowFixture(persistence, owned), ops = createStandardWorkflowOperations({ targetRoot }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
      const git = (...args) => execFileSync("git", ["-C", targetRoot, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], { encoding: "utf8", windowsHide: true }).trim();
      const checkpoint = message => { git("add", "."); git("commit", "--allow-empty", "-m", message); };
      const observe = () => {
        const names = artifacts.inventory().paths.filter(name => !name.startsWith("workflows/") && !name.startsWith("history/"));
        return { canonical: artifacts.readMany(names, { required: names, includeMetadata: true }),
          head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), status: git("status", "--porcelain") };
      };
      const apply = async (prepared, method) => { assert.equal(prepared.can_apply, true); assert.equal((await ops[method](prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed"); };
      const write = change => artifacts.withLocalEffectOwner(shadowHash(change), () => {
        artifacts.compareAndSwapPreservingMetadata(change); artifacts.project([change.path]); return { effect_status: "confirmed" };
      });
      const replace = (name, change) => {
        const before = artifacts.read(name, { required: true }), after = change(before.content);
        return write({ path: name, before_sha256: before.sha256, before_metadata_sha256: artifacts.metadataHash(name), after, after_sha256: shadowText(after) });
      };
      const field = (name, key, value) => replace(name, text => {
        const pattern = new RegExp("^([ \\t]*-?[ \\t]*)" + key + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+-[^\\r\\n]*)*", "gm");
        assert.equal([...text.matchAll(pattern)].length, 1, key); return text.replace(pattern, (_all, prefix) => prefix + key + ": " + value);
      });
      const entry = { contract_version: "standard-cycle-entry-input.v1", session_id: "S001", cycle_id: null };
      for (const invalid of [{}, { ...entry, cycle_id: "../C001" }, { ...entry, decision: "resume" }]) assert.throws(() => assertStandardOperationInput("cycle_entry_admit", invalid), { code: "STANDARD_OPERATION_INPUT_INVALID" });
      await apply(await ops.prepareSession({ session_id: "S001", session_branch: "S001-existing-cycle", objective: "Preserve canonical cycle progress at entry" }), "initializeSession");
      assert.equal((await ops.admitCycleEntry(entry)).outcome, "blocked");
      await apply(await ops.prepareMode({ session_id: "S001", mode: "COMMITTING" }), "applyMode");
      const dirtyBefore = observe(), preparation = await ops.observeCycleEntry(entry);
      assert.equal(preparation.observations.action, "prepare_creation");
      assert.equal(preparation.observations.creation_authorized, false); assert.equal(preparation.observations.implementation_authorized, false);
      assert.deepEqual(preparation.facts, { cycle_entry_fresh_context: true, cycle_entry_owned_context: false, cycle_entry_choice_required: false });
      assert.equal((await ops.admitCycleEntry(entry)).outcome, "blocked", "observation never waives the actual creation admission");
      assert.deepEqual(observe(), dirtyBefore);
      for (const forged of [{ ...preparation, facts: { ...preparation.facts, cycle_entry_creation_allowed: true } },
        { ...preparation, observations: { ...preparation.observations, creation_authorized: true } }])
        assert.throws(() => assertStandardOperationOutput(forged), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
      pass(`${persistence}: dirty fresh context is observed without authorizing or weakening creation`);
      checkpoint("fixture admitted mode");
      const beforeContextRefresh = observe(), originalAdmission = await ops.admitCycle(), entryAdmission = await ops.admitCycleEntry(entry);
      assert.equal(entryAdmission.facts.cycle_entry_creation_allowed === true, originalAdmission.facts.cycle_creation_allowed === true);
      assert.deepEqual(observe(), beforeContextRefresh);
      await apply(await ops.prepareCycleContext({ session_id: "S001" }), "refreshCycleContext"); checkpoint("fixture cycle context");
      const freshBefore = observe(), fresh = await ops.admitCycleEntry(entry);
      assert.equal(fresh.observations.action, "create_cycle"); assert.equal(fresh.facts.cycle_entry_creation_allowed, true); assert.deepEqual(observe(), freshBefore);
      const deniedCreation = createStandardCycleEntryAdmission({ artifacts, scope: ops.observeScope, admitCreation: async () => {
        const actual = await ops.admitCycle(); return { ...actual, outcome: "blocked", facts: {} };
      } });
      const denied = await deniedCreation(entry); assert.equal(denied.outcome, "blocked"); assert.deepEqual(denied.facts, {}); assert.deepEqual(observe(), freshBefore);
      const creation = { session_id: "S001", cycle_id: "C001", cycle_type: "feature", title: "existing-entry", objective: "Preserve canonical cycle progress at entry", continuity_rule: "R2_SESSION_BASE_WITH_IMPORT", base_branch: "S001-existing-cycle" };
      await apply(await ops.prepareCycle(creation), "initializeCycle"); checkpoint("fixture existing canonical cycle");
      const cyclePath = "cycles/C001-feature-existing-entry", selected = { ...entry, cycle_id: "C001" }, before = observe(), admitted = await ops.admitCycleEntry(selected);
      const observedEntry = await ops.observeCycleEntry(selected);
      assert.equal(observedEntry.observations.action, "owned_cycle"); assert.equal(observedEntry.observations.creation_authorized, false);
      assert.deepEqual(observedEntry.observations.selected_cycle, admitted.observations.selected_cycle);
      assert.equal(admitted.observations.action, "resume_cycle"); assert.equal(admitted.facts.cycle_entry_resume_allowed, true);
      assert.equal(admitted.observations.selected_cycle.state, "OPEN"); assert.equal(admitted.observations.selected_cycle.dor_state, "NOT_READY");
      assert.equal(admitted.observations.implementation_authorized, false); assert.equal(admitted.observations.canonical.length, 7);
      assert.equal((await ops.admitCycleEntry(entry)).observations.action, "resume_cycle");
      assert.equal((await ops.prepareCycle(creation)).can_apply, false, "existing-cycle admission never weakens create-only continuity");
      const unknown = await ops.admitCycleEntry({ ...entry, cycle_id: "C999" }); assert.equal(unknown.outcome, "blocked"); assert.deepEqual(unknown.facts, {});
      for (const forged of [{ ...admitted, facts: { ...admitted.facts, cycle_entry_creation_allowed: true } }, { ...admitted, observations: { ...admitted.observations, implementation_authorized: true } }])
        assert.throws(() => assertStandardOperationOutput(forged), { code: "STANDARD_OPERATION_OUTPUT_INVALID" });
      assert.deepEqual(observe(), before); pass(`${persistence}: current canonical cycle entry, creation remains separate, source/metadata and Git unchanged`);

      // These phase/progress preimages are fixture setup, not proof that the
      // productive readiness, task or verification operations ran.
      const originalPlan = artifacts.read(cyclePath + "/plan.md").content;
      await replace(cyclePath + "/plan.md", text => text + "\n- [x] Existing completed task; preserve this exact canonical progress.\n");
      for (const phase of ["IMPLEMENTING", "VERIFYING"]) {
        await field(cyclePath + "/status.md", "state", phase); await field(cyclePath + "/status.md", "dor_state", "READY"); await field(cyclePath + "/status.md", "scope_frozen", "true");
        await field("CURRENT-STATE.md", "dor_state", "READY"); await field("CURRENT-STATE.md", "first_plan_step", "Continue the existing declared task");
        const phaseBefore = observe(), result = await ops.admitCycleEntry(selected);
        assert.equal(result.observations.action, "resume_cycle"); assert.equal(result.observations.selected_cycle.state, phase);
        assert.equal(result.observations.implementation_authorized, false); assert.deepEqual(observe(), phaseBefore);
      }
      await field(cyclePath + "/status.md", "state", "OPEN"); await field(cyclePath + "/status.md", "dor_state", "NOT_READY"); await field(cyclePath + "/status.md", "scope_frozen", "false");
      await field("CURRENT-STATE.md", "dor_state", "NOT_READY"); await replace(cyclePath + "/plan.md", () => originalPlan);
      const session = "sessions/S001.md", originalSession = artifacts.read(session).content;
      await field(session, "reported_from_previous_session", "C002"); await field(session, "carry_over_pending", "yes");
      const pendingBefore = observe(), pending = await ops.admitCycleEntry(selected);
      assert.equal(pending.observations.action, "choose_cycle"); assert.equal(pending.facts.cycle_entry_resume_allowed, false); assert.equal(pending.facts.cycle_entry_creation_allowed, false);
      assert.equal(pending.facts.cycle_entry_choice_required, true);
      const pendingObservation = await ops.observeCycleEntry(selected);
      assert.equal(pendingObservation.observations.action, "choose_cycle"); assert.equal(pendingObservation.facts.cycle_entry_fresh_context, false);
      assert.equal(pendingObservation.facts.cycle_entry_owned_context, false); assert.deepEqual(observe(), pendingBefore);
      await replace(session, () => originalSession);
      const status = artifacts.read(cyclePath + "/status.md").content, competingPath = "cycles/C002-feature-competing/status.md", competing = status.replaceAll("C001", "C002").replaceAll("existing-entry", "competing");
      await write({ path: competingPath, before_sha256: null, before_metadata_sha256: null, after: competing, after_sha256: shadowText(competing) });
      const competingBefore = observe(), choice = await ops.admitCycleEntry(selected);
      assert.equal(choice.observations.reason_code, "STANDARD_CYCLE_ENTRY_CHOICE_REQUIRED"); assert.equal(choice.facts.cycle_entry_resume_allowed, false); assert.deepEqual(observe(), competingBefore);
      await field(competingPath, "state", "DONE");
      await field(cyclePath + "/status.md", "session_owner", "S999"); const wrongOwner = await ops.admitCycleEntry(selected);
      assert.equal(wrongOwner.outcome, "blocked"); assert.deepEqual(wrongOwner.facts, {}); await field(cyclePath + "/status.md", "session_owner", "S001");
      const owner = await artifacts.withLocalEffectOwner(H, () => ops.admitCycleEntry(selected)); assert.equal(owner.observations.reason_code, "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED");
      pass(`${persistence}: supplied cycle ID does not decide carryover, competing cycles, another owner or a held effect`);

      // A changed final observation is injected after the real runtime awaits.
      // This refusal component does not prove a real concurrent writer race.
      let observations = 0;
      const raced = createStandardCycleEntryAdmission({ artifacts: { ...artifacts, observeTopology() {
        observations++; return artifacts.observeTopology();
      }, readMany(names, options) {
        const observed = artifacts.readMany(names, options);
        return observations === 2 ? observed.map(row => row.path === cyclePath + "/plan.md"
          ? { ...row, content: row.content + "\nChanged fixture observation.\n", sha256: shadowText(row.content + "\nChanged fixture observation.\n") } : row)
          : observed;
      } }, scope: ops.observeScope, admitCreation: ops.admitCycle });
      const stale = await raced(selected); assert.equal(stale.observations.reason_code, "STANDARD_CYCLE_ENTRY_CONTEXT_CHANGED"); assert.deepEqual(stale.facts, {});
      pass(`${persistence}: injected changed final observation refuses without a retained or time-based permission`);

      const history = Array.from({ length: 32 }, (_, index) => ({ path: `history/retained-${String(index).padStart(3, "0")}.md`,
        content: "# Retained neutral fixture notes\n\n" + "x".repeat(524288) }));
      const beforeHistory = await ops.admitCycleEntry(selected);
      for (const row of history) await write({ path: row.path, before_sha256: null, before_metadata_sha256: null,
        after: row.content, after_sha256: shadowText(row.content) });
      checkpoint("fixture independent retained history");
      const historyNames = history.map(row => row.path), historyPins = () => artifacts.readMany(historyNames, { required: historyNames, includeMetadata: true })
        .map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
      const retainedBefore = historyPins(), entryBefore = observe(), afterHistory = await ops.admitCycleEntry(selected);
      assert.equal(afterHistory.observations.action, "resume_cycle");
      assert.deepEqual(afterHistory.observations.canonical, beforeHistory.observations.canonical);
      assert.deepEqual(afterHistory.observations.selected_cycle, beforeHistory.observations.selected_cycle);
      assert.deepEqual(observe(), entryBefore); assert.deepEqual(historyPins(), retainedBefore);
      assert.throws(() => artifacts.observeInventory(), { code: "STANDARD_ARTIFACT_INVENTORY_TRUNCATED" });
      pass(`${persistence}: unrelated retained history exceeds full inventory bound without changing cycle admission or that bound`);

      for (const bindingId of ["cycle_entry_admit", "cycle_entry_observe"]) {
        const binding = standardWorkflowOperationBindings().find(row => row.id === bindingId), key = randomBytes(32);
        assert.deepEqual(binding.allowed_modes, ["COMMITTING"]);
        const model = { contract_version: "agentic-process-model.v2", model_id: "existing-cycle-entry-port-fixture", revision: 1, participants: [{ id: "project" }], roles: [], policies: [], entry: "entry",
          nodes: [{ id: "entry", kind: "operation", participant_ref: "project", binding_ref: binding.id }], operation_pins: { [binding.id]: shadowHash(binding) },
          data_bindings: { contract_version: "process-data-bindings.v2", parameter_keys: [], inputs: [{ node_id: "entry", fields: Object.fromEntries(Object.entries(selected).map(([name, value]) => [name, { source: "literal", value }])) }] } };
        const open = () => createStandardWorkflowOperationHost({ targetRoot, model, readSigningKey: () => key,
          authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }) });
        const hostBefore = observe(); let host = open(); const initial = host.initialize({ instanceId: "existing-cycle-port-" + bindingId });
        host.initialize({ instanceId: "existing-cycle-port-" + bindingId, write: true, expectedResultSha256: initial.record.instance_sha256 });
        const state = host.inspect("existing-cycle-port-" + bindingId), preview = await host.preview({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: state.cursor.ready[0] });
        const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        assert.equal((await host.dispatch(staged.operation_id, { write: true })).receipt.outcome, "completed");
        host = open(); const result = await host.accept(staged.operation_id, { write: true }); assert.equal(result.cursor.status, "COMPLETED");
        const simulation = simulateAgenticProcess({ instanceId: result.record.instance_id, model, policyPins: result.record.policy_pins, scopeId: result.record.scope_id, events: result.record.events });
        assert.equal(simulation.trace.at(-1).instance_sha256, result.record.instance_sha256); assert.equal(shadowHash(observe()), shadowHash(hostBefore));
        assert.deepEqual(historyPins(), retainedBefore);
      }
      pass(`${persistence}: both actual signed entry dispatches, cold acceptance and exact SIM preserve canonical progress`);
    }
    success = true; console.log(JSON.stringify({ status: "PASS", checks, proof_class: "source-canonical-entry-component", phase_and_progress_setup: "SYNTHETIC", common_operation_host: "ACTUAL", published_standard_routing: "NOT_CONNECTED", legacy_plan_adoption: "NOT_RUN", implementation_resume: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" })); return checks;
  } finally {
    if (success) for (const root of owned) { const real = fs.realpathSync(root); if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID"); fs.rmSync(real, { recursive: true, force: true }); }
    else console.error(JSON.stringify({ retained_failed_fixture_roots: owned }));
  }
}
import { artifactContentHash as shadowText } from "../../src/core/workflow/artifact-compare-swap.mjs";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyStandardExistingCycleEntry({ selectedMode: process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) });
