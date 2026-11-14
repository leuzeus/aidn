import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowGitCheckpoint } from "../../src/application/runtime/standard-workflow-git-checkpoint.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../src/adapters/runtime/local-workflow-git-checkpoint.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";

// Accepted start/context provenance is supplied through a controlled reader.
// A current source-installed client supplies managed private-path policy.
// Bootstrap, admission, artifact/owner ports, finite Git and actual commit
// postimages use that real disposable project.
export async function verifyStandardSessionGitPlanValidity(pass, { caseSelector = null } = {}) {
  const temporary = fs.realpathSync(os.tmpdir()), H = "a".repeat(64), id = "op_" + "a".repeat(40);
  const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
    { encoding: "utf8", windowsHide: true, stdio: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  const cases = [["files", "valid"], ["dual", "valid"], ["db-only", "valid"], ["files", "revoked"],
    ["files", "accepted-source"], ["files", "head"], ["dual", "metadata"], ["files", "ack-loss"]];
  const selected = cases.filter(row => caseSelector === null || row.join(":") === caseSelector);
  assert.ok(selected.length > 0, "unknown session Git fixture selector");
  for (const [mode, fault] of selected) {
    const owned = []; let success = false;
    try {
      const root = createFreshStandardWorkflowFixture(mode, owned), operations = createStandardWorkflowOperations({ targetRoot: root });
      const product = path.join(root, "app.mjs"); fs.writeFileSync(product, "export const value = 1;\n");
      git(root, "add", "."); git(root, "commit", "-m", "fixture product precondition");
      let prepared = await operations.prepareSession({ session_id: "S001", session_branch: "S001-git-validity", objective: "Checkpoint only the accepted session metadata" });
      assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
      prepared = await operations.prepareMode({ session_id: "S001", mode: "EXPLORING" });
      assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, "completed");
      const context = await operations.prepareCycleContext({ session_id: "S001" });
      const output = await operations.refreshCycleContext(context, { write: true, expectPlan: context.plan_sha256 });
      assert.equal(output.effect_status, "confirmed");
      let changed = false, clock = Date.now() - 86400000;
      const instance = { instance_id: "git-validity", instance_sha256: H };
      const source = { context_plan: context.plan, context_output: output,
        start_output: { effect_status: "confirmed", facts: { session_started: true } } };
      const actualGit = createLocalWorkflowGitCheckpoint({ targetRoot: root });
      const port = fault === "ack-loss" ? { ...actualGit, async commit(...args) {
        await actualGit.commit(...args);
        throw Object.assign(Error("FIXTURE_GIT_ACK_LOST"), { code: "FIXTURE_GIT_ACK_LOST" });
      } } : actualGit;
      const checkpoint = createStandardWorkflowGitCheckpoint({ targetRoot: root, now: () => clock ?? Date.now(),
        readCurrent: () => instance, readContext: () => changed ? { ...source, fixture_observation: "changed accepted source" } : source }, { gitPort: port });
      const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), index = path.join(root, ".git/index");
      const beforePreview = { head: git(root, "rev-parse", "HEAD"), index: artifactContentHash(fs.readFileSync(index)) };
      prepared = await checkpoint.prepare(instance, { context_operation_id: id }, id);
      assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
      assert.equal(git(root, "rev-parse", "HEAD"), beforePreview.head); assert.equal(artifactContentHash(fs.readFileSync(index)), beforePreview.index);
      clock = null; assert.ok(Date.now() - prepared.plan.prepared_at_ms >= 86400000);
      if (fault === "accepted-source") changed = true;
      if (fault === "head") git(root, "commit", "--allow-empty", "-m", "fixture independent HEAD advance");
      if (fault === "metadata") await artifacts.withLocalEffectOwner(shadowHash({ fixture: fault }), async () => {
        const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
        try { const row = store.getArtifact("CURRENT-STATE.md"); store.upsertArtifact({ ...row, classification_reason: "fixture independently changed metadata" }); }
        finally { store.close(); }
        return { effect_status: "confirmed" };
      });
      const documents = () => prepared.plan.documents.map(row => ({ artifact: artifacts.read(row.path), metadata_sha256: artifacts.metadataHash(row.path) }));
      const before = documents(), head = git(root, "rev-parse", "HEAD"), indexHash = artifactContentHash(fs.readFileSync(index)), productHash = artifactContentHash(fs.readFileSync(product));
      let authorizations = 0;
      const applying = checkpoint.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256,
        assertAuthorized: async () => { authorizations++; if (fault === "revoked") throw Object.assign(Error("AUTHORIZATION_REVOKED"), { code: "AUTHORIZATION_REVOKED" }); } });
      if (["revoked", "accepted-source", "head", "metadata"].includes(fault)) {
        await assert.rejects(applying, { code: fault === "revoked" ? "AUTHORIZATION_REVOKED" : "STANDARD_GIT_PREVIEW_CHANGED", effect_status: "no_effect" });
        assert.equal(git(root, "rev-parse", "HEAD"), head); assert.equal(artifactContentHash(fs.readFileSync(index)), indexHash);
        assert.equal(artifacts.ownerPending(), false);
      } else {
        const result = await applying;
        assert.equal(result.effect_status, fault === "ack-loss" ? "unknown" : mode === "db-only" ? "no_effect" : "confirmed", JSON.stringify(result));
        assert.equal(result.outcome, fault === "ack-loss" ? "reconciliation_required" : "completed");
        if (fault === "ack-loss") { assert.deepEqual(result.facts, {}); assert.equal(result.observations.reason_code, "FIXTURE_GIT_ACK_LOST"); }
        else assert.equal(result.facts.session_git_ready_for_cycle, true);
        const afterHead = git(root, "rev-parse", "HEAD");
        if (mode === "db-only") assert.equal(afterHead, head);
        else {
          assert.notEqual(afterHead, head); assert.equal(git(root, "show", "-s", "--format=%P", afterHead), head);
          const paths = git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", afterHead).split(/\r?\n/).sort();
          assert.deepEqual(paths, prepared.plan.git.files.map(row => row.path).sort());
        }
        assert.equal(artifacts.ownerPending(), fault === "ack-loss");
      }
      assert.ok(authorizations > 0); assert.deepEqual(documents(), before); assert.equal(artifactContentHash(fs.readFileSync(product)), productHash);
      success = true; pass(`${mode}: day-old session Git plan ${fault} with actual finite Git port`);
    } finally {
      if (success) for (const directory of owned) {
        const real = fs.realpathSync(directory);
        if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
        fs.rmSync(real, { recursive: true, force: true });
      }
      else console.error(JSON.stringify({ retained_fixture_roots: owned, scope: "session-git-plan-validity" }));
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let checks = 0;
  const caseSelector = process.argv.find(value => value.startsWith("--case="))?.slice(7) ?? null;
  await verifyStandardSessionGitPlanValidity(name => { checks++; console.log("PASS " + name); }, { caseSelector });
  console.log(JSON.stringify({ status: "PASS", checks, scope: "session-Git-checkpoint-after-one-day", clock: "injected", accepted_start_provenance: "controlled",
    canonical_ports: "actual files and SQLite", git_port: "actual; confirmation-loss double", native_model_calls: 0, installed_archive: "NOT_RUN" }));
}
