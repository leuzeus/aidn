import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardModeWorkContext } from "../../src/application/runtime/standard-mode-work-context.mjs";
import { evaluateStandardModeWork } from "../../src/core/workflow/standard-mode-work.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const args = process.argv.slice(2), stateMode = args[0]?.slice(7);
if (args.length !== 1 || !args[0].startsWith("--mode=") || !["files", "dual", "db-only"].includes(stateMode)) throw Error("FIXTURE_ARGUMENT_INVALID");
const owned = [], git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
let checks = 0;
// Preserve all fresh projects, including failures. No cleanup or copying live state.
try {
  for (const mode of ["THINKING", "EXPLORING"]) {
    const root = createStandardWorkflowFixture(stateMode, owned), ops = createStandardWorkflowOperations({ targetRoot: root });
    const productRoot = path.join(root, "mode-product"), file = path.join(productRoot, "subject.txt");
    fs.mkdirSync(productRoot); fs.writeFileSync(file, "Observed subject\n"); git(root, "add", "."); git(root, "commit", "-m", "fixture: observed mode subject");
    const prepared = await ops.prepareSession({ session_id: "S001", session_branch: "S001-mode-analysis", objective: "Explain the observed subject" });
    assert.equal(prepared.can_apply, true);
    assert.equal((await ops.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
    const selected = await ops.prepareMode({ session_id: "S001", mode }); assert.equal(selected.can_apply, true);
    assert.equal((await ops.applyMode(selected, { write: true, expectPlan: selected.plan_sha256 })).outcome, "completed");
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    const observe = () => readStandardModeWorkContext({ targetRoot: root, productRoot, productFiles: ["subject.txt"], productSha256: shadowHash(fs.readFileSync(file, "utf8")) });
    const before = { git: git(root, "status", "--porcelain"), head: git(root, "rev-parse", "HEAD"), current: artifacts.read("CURRENT-STATE.md"), session: artifacts.read("sessions/S001.md") };
    const original = observe(); assert.equal(original.context.mode, mode); assert.equal(original.context.session_id, "S001");
    assert.equal(original.context.objective, "Explain the observed subject");
    assert.equal(original.context_sha256, observe().context_sha256);
    assert.deepEqual({ git: git(root, "status", "--porcelain"), head: git(root, "rev-parse", "HEAD"), current: artifacts.read("CURRENT-STATE.md"), session: artifacts.read("sessions/S001.md") }, before);
    console.log(`PASS ${stateMode}/${mode}: actual canonical backend and Git context read without business writes`); checks++;
    const report = { contract_version: "standard-mode-work-report.v1", context_sha256: original.context_sha256, mode, objective: original.context.objective,
      disposition: mode === "THINKING" ? "thinking_complete" : "nonretained", findings: ["The observed subject is available for analysis"], rationale: "Fixture report only", evidence_refs: [original.evidence_refs[0]] };
    const authenticated = { report, reference: { ref: "fixture/native-report", sha256: shadowHash(report) }, producer: { proof_class: "double" } };
    assert.equal(evaluateStandardModeWork(authenticated, original).outcome, "completed");
    fs.writeFileSync(file, "Changed subject\n");
    assert.throws(() => evaluateStandardModeWork(authenticated, observe()), { code: "STANDARD_MODE_WORK_CONTEXT_CHANGED" });
    console.log(`PASS ${stateMode}/${mode}: changed real product/Git evidence rejects the earlier typed report`); checks++;
    const current = artifacts.read("CURRENT-STATE.md");
    await artifacts.withLocalEffectOwner(shadowHash({ fixture: "mode-substitution", mode, stateMode }), async () => {
      artifacts.compareAndSwap({ path: current.path, before_sha256: current.sha256, after: current.content.replace(/mode:\s*(THINKING|EXPLORING)/, "mode: COMMITTING") });
      return { effect_status: "confirmed" };
    });
    assert.throws(observe, { code: "STANDARD_MODE_WORK_MODE_REQUIRED" });
    console.log(`PASS ${stateMode}/${mode}: canonical mode substitution refuses; no branch or cycle guessed`); checks++;
  }
  console.log(JSON.stringify({ status: "PASS", checks, state_mode: stateMode, retained_projects: owned, application_ports: "canonical-artifact-and-Git", human: "fixture-explicit-mode-application", native: "NOT_RUN", mixed_execution: "NOT_RUN", installed_archive: "NOT_RUN", complete_standard_workflow: false }));
} finally { console.log(JSON.stringify({ retained_projects: owned, cleanup: "NOT_REQUESTED" })); }
