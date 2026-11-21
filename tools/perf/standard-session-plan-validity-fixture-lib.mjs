import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";

export async function verifyStandardSessionPlanValidity(pass, { modes = ["files", "dual", "db-only"] } = {}) {
  const temporary = fs.realpathSync(os.tmpdir());
  const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
    { encoding: "utf8", windowsHide: true, stdio: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  for (const mode of modes) {
    assert.ok(["files", "dual", "db-only"].includes(mode));
    for (const scenario of ["valid", "revoked", "context", "head", "destination-branch"]) {
      const owned = []; let success = false;
      try {
        const root = createStandardWorkflowFixture(mode, owned), key = randomBytes(32);
        const binding = standardWorkflowOperationBindings().find(row => row.id === "session_initialize");
        const model = { contract_version: "agentic-process-model.v2", model_id: "session-plan-validity-fixture", revision: 1,
          participants: [{ id: "project" }], roles: [], policies: [], entry: "initialize",
          operation_pins: { session_initialize: shadowHash(binding) },
          nodes: [{ id: "initialize", kind: "operation", participant_ref: "project", binding_ref: "session_initialize" }] };
        let clock = Date.now() - 86400000, allowed = true, grants = 0;
        const runtime = createStandardWorkflowOperationHost({ targetRoot: root, model, readSigningKey: () => key, now: () => clock,
          authorize: async request => { grants++; return { authorized: allowed, authority_id: "fixture_operator",
            principal_sha256: "a".repeat(64), grant_sha256: request.preview_sha256 }; } });
        const initial = runtime.initialize({ instanceId: "session-validity" });
        runtime.initialize({ instanceId: "session-validity", write: true, expectedResultSha256: initial.record.instance_sha256 });
        const input = { session_id: "S001", session_branch: "S001-validity", objective: "Initialize only with current authority and source" };
        const preview = await runtime.preview({ instanceId: "session-validity", expectedSha256: initial.record.instance_sha256, occurrenceId: "root", input });
        const staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        clock = Date.now(); assert.ok(clock - preview.prepared.plan.prepared_at_ms >= 86400000);
        const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
        if (scenario === "revoked") allowed = false;
        if (scenario === "context") await artifacts.withLocalEffectOwner(shadowHash({ fixture: scenario }), async () => {
          const row = artifacts.read("CURRENT-STATE.md"), after = row.content + "\n<!-- independent source change -->\n";
          artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256,
            before_metadata_sha256: artifacts.metadataHash(row.path), after, after_sha256: artifactContentHash(after) });
          artifacts.project([row.path]); return { effect_status: "confirmed" };
        });
        if (scenario === "head") git(root, "commit", "--allow-empty", "-m", "fixture independently advanced HEAD");
        if (scenario === "destination-branch") git(root, "branch", input.session_branch);
        const business = () => preview.prepared.plan.changes.map(row => ({ artifact: artifacts.read(row.path), metadata_sha256: artifacts.metadataHash(row.path) }));
        const before = business(), head = git(root, "rev-parse", "HEAD"), branch = git(root, "branch", "--show-current");
        const journal = runtime.readJournal(staged.operation_id), beforeGrants = grants;
        const dispatch = () => runtime.dispatch(staged.operation_id, { write: true });
        if (["revoked", "context", "head"].includes(scenario)) {
          await assert.rejects(dispatch, { code: scenario === "revoked" ? "STANDARD_HOST_AUTHORIZATION_REQUIRED" : "STANDARD_HOST_PRECONDITIONS_CHANGED" });
          assert.deepEqual(runtime.readJournal(staged.operation_id), journal);
          assert.deepEqual(business(), before); assert.equal(git(root, "rev-parse", "HEAD"), head); assert.equal(git(root, "branch", "--show-current"), branch);
        } else if (scenario === "destination-branch") {
          const result = await dispatch(), output = runtime.readJournal(staged.operation_id).results.at(-1).output;
          assert.equal(result.receipt.outcome, "blocked"); assert.equal(result.receipt.effect_status, "no_effect");
          assert.equal(output.observations.reason_code, "STANDARD_SESSION_BRANCH_ALREADY_EXISTS");
          assert.deepEqual(business(), before); assert.equal(git(root, "rev-parse", "HEAD"), head); assert.equal(git(root, "branch", "--show-current"), branch);
        } else {
          const result = await dispatch(); assert.equal(result.receipt.outcome, "completed", JSON.stringify(result));
          assert.equal(result.receipt.effect_status, "confirmed");
          const output = runtime.readJournal(staged.operation_id).results.at(-1).output;
          assert.equal(output.facts.session_initialized, true); assert.equal(output.facts.session_mode_pending, true);
          for (const change of preview.prepared.plan.changes) assert.equal(artifacts.read(change.path).sha256, change.after_sha256);
          assert.equal(git(root, "branch", "--show-current"), input.session_branch); assert.equal(git(root, "rev-parse", "HEAD"), head);
          const accepted = await runtime.accept(staged.operation_id, { write: true }); assert.equal(accepted.cursor.status, "COMPLETED");
          const retained = runtime.readJournal(staged.operation_id), after = business(), authorized = grants;
          assert.equal((await dispatch()).status, "retained_result");
          assert.deepEqual(runtime.readJournal(staged.operation_id), retained); assert.deepEqual(business(), after); assert.equal(grants, authorized);
        }
        assert.ok(grants > beforeGrants); assert.equal(artifacts.ownerPending(), false);
        success = true; pass(`${mode}: day-old session plan ${scenario} through ordinary host dispatch`);
      } finally {
        if (success) for (const directory of owned) {
          const real = fs.realpathSync(directory);
          if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
          fs.rmSync(real, { recursive: true, force: true });
        }
        else console.error(JSON.stringify({ retained_fixture_roots: owned, scope: "current-session-plan-validity" }));
      }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7);
  let checks = 0;
  await verifyStandardSessionPlanValidity(name => { checks++; console.log("PASS " + name); }, mode ? { modes: [mode] } : {});
  console.log(JSON.stringify({ status: "PASS", checks, scope: "current-session-initialization-after-one-day", clock: "injected",
    business_ports: "actual", state_modes: mode ? [mode] : ["files", "dual", "db-only"], native_model_calls: 0, installed_archive: "NOT_RUN" }));
}
