#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowStartupHost } from "../../src/application/runtime/standard-workflow-startup-composition.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";

export async function verifyStandardExistingSessionEntry({ selectedMode: selected } = {}) {
const owned = [], temporary = fs.realpathSync(os.tmpdir()), H = "a".repeat(64);
if (selected && !["files", "dual", "db-only"].includes(selected)) throw Error("FIXTURE_MODE_INVALID");
let checks = 0, success = false;
const pass = name => { checks++; console.log("PASS " + name); };
try {
  for (const persistence of selected ? [selected] : ["files", "dual", "db-only"]) {
    for (const mode of ["THINKING", "EXPLORING", "COMMITTING"]) {
      const root = createFreshStandardWorkflowFixture(persistence, owned), ops = createStandardWorkflowOperations({ targetRoot: root });
      const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
      const input = { session_id: "S001", session_branch: "S001-existing-entry", objective: "Preserve the existing canonical session and its selected mode" };
      const entry = { contract_version: "standard-session-entry-input.v1", ...input };
      const names = ["CURRENT-STATE.md", "sessions/S001.md"];
      const observe = () => ({ rows: artifacts.readMany(names, { includeMetadata: true }),
        branch: execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8", windowsHide: true }).trim(),
        head: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim() });
      await assert.rejects(ops.admitSessionEntry({}), { code: "STANDARD_OPERATION_INPUT_INVALID" });
      const freshBefore = observe();
      assert.equal((await ops.admitSession()).contract_version, "standard-operation-output.v1");
      const fresh = await ops.admitSessionEntry(entry);
      assert.equal(fresh.outcome, "completed"); assert.equal(fresh.effect_status, "no_effect");
      assert.equal(fresh.facts.session_creation_allowed, true); assert.equal(fresh.facts.session_mode_pending, true);
      assert.deepEqual(observe(), freshBefore);
      const prepared = await ops.prepareSession(input); assert.equal(prepared.can_apply, true);
      assert.equal((await ops.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
      const unknownBefore = observe(), unknown = await ops.admitSessionEntry(entry);
      assert.equal(unknown.outcome, "completed"); assert.equal(unknown.facts.session_resume_allowed, true);
      assert.equal(unknown.facts.session_mode_pending, true); assert.equal(unknown.observations.session.mode, "UNKNOWN");
      assert.deepEqual(observe(), unknownBefore);
      const modePlan = await ops.prepareMode({ session_id: input.session_id, mode }); assert.equal(modePlan.can_apply, true);
      assert.equal((await ops.applyMode(modePlan, { write: true, expectPlan: modePlan.plan_sha256 })).outcome, "completed");
      const before = observe(), result = await ops.admitSessionEntry(entry);
      assert.equal(result.outcome, "completed"); assert.equal(result.effect_status, "no_effect");
      assert.equal(result.facts.session_creation_allowed, false); assert.equal(result.facts.session_resume_allowed, true);
      assert.equal(result.facts.session_mode_pending, false); assert.equal(result.facts["mode_" + mode.toLowerCase()], true);
      assert.equal(result.facts.cycle_work_requested, mode === "COMMITTING");
      assert.equal(result.observations.session.mode, mode); assert.equal(result.evidence_refs.length, 2);
      assert.deepEqual(result.observations.session.canonical, before.rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 })));
      assert.equal((await ops.prepareSession(input)).can_apply, false, "creation remains create-only");
      assert.equal((await ops.prepareMode({ session_id: input.session_id, mode })).can_apply, false, "no implicit mode renewal");
      for (const changed of [{ objective: "A different objective" }, { session_branch: "S001-other" }]) {
        const denied = await ops.admitSessionEntry({ ...entry, ...changed });
        assert.equal(denied.outcome, "blocked"); assert.equal(denied.effect_status, "no_effect"); assert.deepEqual(denied.facts, {});
        assert.equal(denied.observations.reason_code, "STANDARD_SESSION_ENTRY_IDENTITY_CHANGED");
      }
      assert.deepEqual(observe(), before);
      pass(`${persistence}/${mode}: fresh, UNKNOWN and canonical-mode admission; exact identity; no canonical write`);
      if (mode !== "THINKING") continue;
      const key = randomBytes(32); let humanReads = 0;
      const open = () => createStandardWorkflowStartupHost({ targetRoot: root, readSigningKey: () => key,
        authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H }),
        humanSource: { read() { humanReads++; throw Error("EXISTING_MODE_MUST_NOT_REQUEST_HUMAN_RENEWAL"); }, verify() { throw Error("UNEXPECTED_HUMAN_SOURCE"); } } });
      let host = open(), initial = host.initialize({ instanceId: "existing-session-entry", parameters: { session: input } });
      host.initialize({ instanceId: "existing-session-entry", parameters: { session: input }, write: true, expectedResultSha256: initial.record.instance_sha256 });
      const executed = [];
      while (host.inspect("existing-session-entry").cursor.status !== "COMPLETED") {
        const state = host.inspect("existing-session-entry"), frame = state.cursor.occurrences.find(frame => frame.status === "READY");
        assert.ok(frame); assert.ok(executed.length < 4);
        const preview = await host.preview({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
        assert.ok(["context_reload", "session_entry_admit", "session_start_finalize"].includes(preview.binding.id));
        if (preview.binding.id === "session_start_finalize") assert.deepEqual(observe(), before);
        const staged = await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        const returned = await host.dispatch(staged.operation_id, { write: true });
        assert.equal(returned.receipt?.outcome, "completed", JSON.stringify(returned));
        await host.accept(staged.operation_id, { write: true }); executed.push(preview.binding.id); host = open();
      }
      assert.deepEqual(executed, ["context_reload", "session_entry_admit", "session_start_finalize"]); assert.equal(humanReads, 0);
      const final = host.inspect("existing-session-entry"), simulation = simulateAgenticProcess({ instanceId: final.record.instance_id,
        model: final.record.model, parameters: final.record.initial_parameters, policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
      assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
      assert.deepEqual(observe(), before);
      pass(`${persistence}: published startup attaches existing THINKING session, executes real startup hook and exact SIM; no H/model task`);
    }
  }
  success = true; console.log(JSON.stringify({ status: "PASS", checks, proof_class: "source-installed-fixture", genuine_native: "NOT_RUN", full_standard_workflow: "NOT_CLAIMED" }));
  return checks;
} finally {
  if (success) for (const root of owned) { const real = fs.realpathSync(root); if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID"); fs.rmSync(real, { recursive: true, force: true }); }
  else console.error(JSON.stringify({ retained_failed_fixture_roots: owned }));
}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await verifyStandardExistingSessionEntry({ selectedMode: process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) });
