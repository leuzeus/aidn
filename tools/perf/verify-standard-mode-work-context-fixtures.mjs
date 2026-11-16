import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStandardWorkflowFixture, createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { readStandardModeWorkContext } from "../../src/application/runtime/standard-mode-work-context.mjs";
import { evaluateStandardModeWork } from "../../src/core/workflow/standard-mode-work.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
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
    const packet = artifacts.read('HANDOFF-PACKET.md', { required: true }), packetMeta = artifacts.metadataHash(packet.path);
    const packetText = packet.content + String.fromCharCode(10) + '<!-- canonical handoff material changed -->';
    await artifacts.withLocalEffectOwner(shadowHash({ fixture: 'canonical-handoff-material', mode, stateMode }), async () => {
      artifacts.compareAndSwapPreservingMetadata({ path: packet.path, before_sha256: packet.sha256, before_metadata_sha256: packetMeta, after: packetText });
      return { effect_status: 'confirmed' };
    });
    const updatedPacket = observe(), suppliedPacket = updatedPacket.context.documents.find(row => row.ref === 'docs/audit/HANDOFF-PACKET.md');
    assert.equal(suppliedPacket.content, packetText); assert.equal(suppliedPacket.sha256, artifacts.read(packet.path).sha256);
    assert.notEqual(updatedPacket.context_sha256, original.context_sha256);
    assert.throws(() => evaluateStandardModeWork(authenticated, updatedPacket), { code: 'STANDARD_MODE_WORK_CONTEXT_CHANGED' });
    if (stateMode !== 'files') {
      assert.equal(updatedPacket.context.git.diff_sha256, original.context.git.diff_sha256);
      assert.equal(updatedPacket.context.git.status_sha256, original.context.git.status_sha256);
      assert.equal(fs.readFileSync(path.join(root, 'docs/audit/HANDOFF-PACKET.md'), 'utf8'), packet.content);
      await artifacts.withLocalEffectOwner(shadowHash({ fixture: 'handoff-metadata-only', mode, stateMode }), async () => {
        const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
        try { const row = store.getArtifact(packet.path); store.upsertArtifact({ ...row, classification_reason: 'fixture canonical handoff metadata changed' }); }
        finally { store.close(); }
        return { effect_status: 'confirmed' };
      });
      const changedMetadata = observe();
      assert.equal(changedMetadata.context.documents.find(row => row.ref === 'docs/audit/HANDOFF-PACKET.md').sha256, suppliedPacket.sha256);
      assert.notEqual(changedMetadata.context_sha256, updatedPacket.context_sha256);
      const priorReport = { ...report, context_sha256: updatedPacket.context_sha256 };
      const prior = { ...authenticated, report: priorReport, reference: { ...authenticated.reference, sha256: shadowHash(priorReport) } };
      assert.equal(evaluateStandardModeWork(prior, updatedPacket).outcome, "completed");
      assert.throws(() => evaluateStandardModeWork(prior, changedMetadata), { code: 'STANDARD_MODE_WORK_CONTEXT_CHANGED' });
    }
    console.log('PASS ' + stateMode + '/' + mode + ': canonical packet content and metadata bind context without relying on a visible Git diff'); checks++;
    const productContext = observe(), productReport = { ...report, context_sha256: productContext.context_sha256 };
    const authenticatedProduct = { ...authenticated, report: productReport, reference: { ...authenticated.reference, sha256: shadowHash(productReport) } };
    assert.equal(evaluateStandardModeWork(authenticatedProduct, productContext).outcome, "completed");
    fs.writeFileSync(file, "Changed subject\n");
    assert.throws(() => evaluateStandardModeWork(authenticatedProduct, observe()), { code: "STANDARD_MODE_WORK_CONTEXT_CHANGED" });
    console.log(`PASS ${stateMode}/${mode}: changed real product/Git evidence rejects the earlier typed report`); checks++;
    const current = artifacts.read("CURRENT-STATE.md");
    await artifacts.withLocalEffectOwner(shadowHash({ fixture: "mode-substitution", mode, stateMode }), async () => {
      artifacts.compareAndSwap({ path: current.path, before_sha256: current.sha256, after: current.content.replace(/mode:\s*(THINKING|EXPLORING)/, "mode: COMMITTING") });
      return { effect_status: "confirmed" };
    });
    assert.throws(observe, { code: "STANDARD_MODE_WORK_MODE_REQUIRED" });
    console.log(`PASS ${stateMode}/${mode}: canonical mode substitution refuses; no branch or cycle guessed`); checks++;
  }
  {
    const root = createFreshStandardWorkflowFixture(stateMode, owned, { absentOptionalDocuments: ['HANDOFF-PACKET.md'] });
    const operations = createStandardWorkflowOperations({ targetRoot: root }), productRoot = path.join(root, 'optional-product');
    fs.mkdirSync(productRoot); fs.writeFileSync(path.join(productRoot, 'subject.txt'), 'optional handoff case');
    const start = await operations.prepareSession({ session_id: 'S001', session_branch: 'S001-no-packet', objective: 'Analyze without a first handoff packet' });
    assert.equal((await operations.initializeSession(start, { write: true, expectPlan: start.plan_sha256 })).outcome, 'completed');
    const mode = await operations.prepareMode({ session_id: 'S001', mode: 'THINKING' });
    assert.equal((await operations.applyMode(mode, { write: true, expectPlan: mode.plan_sha256 })).outcome, 'completed');
    const observed = readStandardModeWorkContext({ targetRoot: root, productRoot, productFiles: ['subject.txt'], productSha256: shadowHash('optional handoff case') });
    const packet = observed.context.documents.find(row => row.ref === 'docs/audit/HANDOFF-PACKET.md');
    assert(packet); assert.equal(packet.sha256, null); assert.equal(packet.content, null);
    assert(observed.evidence_refs.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
    console.log('PASS ' + stateMode + ': missing optional packet is bound explicitly and emits no invalid evidence reference'); checks++;
  }
  console.log(JSON.stringify({ status: "PASS", checks, state_mode: stateMode, retained_projects: owned, application_ports: "canonical-artifact-and-Git", human: "fixture-explicit-mode-application", native: "NOT_RUN", mixed_execution: "NOT_RUN", installed_archive: "NOT_RUN", complete_standard_workflow: false }));
} finally { console.log(JSON.stringify({ retained_projects: owned, cleanup: "NOT_REQUESTED" })); }
