import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

export async function verifyStandardPreviewValidity(pass) {
  const temporary = fs.realpathSync(os.tmpdir());
  for (const mode of ["files", "dual", "db-only"]) {
    const owned = [];
    try {
      const root = createStandardWorkflowFixture(mode, owned);
      const privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-preview-validity-"));
      owned.push(privateRoot);
      const keyFile = path.join(privateRoot, "host.key");
      fs.writeFileSync(keyFile, randomBytes(32));
      const binding = standardWorkflowOperationBindings().find(row => row.id === "session_initialize");
      const model = { contract_version: "agentic-process-model.v2", model_id: "preview-validity-fixture", revision: 1,
        participants: [{ id: "project" }], roles: [], policies: [], entry: "initialize",
        operation_pins: { session_initialize: shadowHash(binding) },
        nodes: [{ id: "initialize", kind: "operation", participant_ref: "project", binding_ref: "session_initialize" }] };
      let now = Date.now(), allowed = true, authorizationCalls = 0, replaceOnCommit = false, replacementCalls = 0;
      const runtime = createStandardWorkflowOperationHost({ targetRoot: root, model,
        readSigningKey: () => fs.readFileSync(keyFile), now: () => now,
        authorize: async request => {
          authorizationCalls++;
          const principal = replaceOnCommit && ++replacementCalls > 1 ? "b" : "a";
          return { authorized: allowed, authority_id: "fixture_operator", principal_sha256: principal.repeat(64), grant_sha256: request.preview_sha256 };
        } });
      const initial = runtime.initialize({ instanceId: "preview-validity" });
      runtime.initialize({ instanceId: "preview-validity", write: true, expectedResultSha256: initial.record.instance_sha256 });
      const preview = await runtime.preview({ instanceId: "preview-validity", expectedSha256: initial.record.instance_sha256,
        occurrenceId: "root", input: { session_id: "S001", session_branch: "S001-preview-validity", objective: "Stage only with current authority and context" } });
      now = preview.prepared_at_ms + 86400000;
      const stage = () => runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
      const current = "CURRENT-STATE.md", original = artifacts.read(current).content;
      const writeCurrent = content => artifacts.withLocalEffectOwner(shadowHash({ fixture: "preview-validity", content }), async () => {
        const observed = artifacts.read(current);
        artifacts.compareAndSwapPreservingMetadata({ path: current, before_sha256: observed.sha256,
          before_metadata_sha256: artifacts.metadataHash(current), after: content, after_sha256: artifactContentHash(content) });
        artifacts.project([current]);
        return { effect_status: "confirmed" };
      });
      await writeCurrent(original + "\n<!-- changed source -->\n");
      await assert.rejects(stage, { code: "STANDARD_HOST_PRECONDITIONS_CHANGED" });
      await writeCurrent(original);
      assert.equal(runtime.inspect("preview-validity").record.instance_sha256, initial.record.instance_sha256);
      assert.equal(authorizationCalls, 0);
      pass(mode + ": elapsed signed preview refuses changed current context before staging");

      allowed = false;
      await assert.rejects(stage, { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
      assert.equal(runtime.inspect("preview-validity").record.instance_sha256, initial.record.instance_sha256);
      assert.equal(authorizationCalls, 1);
      pass(mode + ": elapsed signed preview requests current authorization and refuses revocation");

      allowed = true;
      replaceOnCommit = true;
      await assert.rejects(stage, { code: "PROCESS_OPERATION_AUTHORITY_UNAVAILABLE" });
      assert.equal(runtime.inspect("preview-validity").record.instance_sha256, initial.record.instance_sha256);
      assert.equal(authorizationCalls, 3);
      pass(mode + ": authorization replaced during staging refuses canonical intent acceptance");

      replaceOnCommit = false;
      const staged = await stage(), journal = runtime.readJournal(staged.operation_id);
      assert.equal(authorizationCalls, 5);
      assert.equal(journal.phase, "staged");
      assert.deepEqual(journal.preview, preview);
      assert.equal(journal.grant.grant_sha256, shadowHash(preview));
      assert.notEqual(staged.record.instance_sha256, initial.record.instance_sha256);
      assert.equal(journal.owner, null);
      assert.deepEqual(journal.results, []);
      pass(mode + ": signed preview stages after one day with valid current authority and unchanged subject");

      await assert.rejects(stage, { code: "STANDARD_HOST_PRECONDITIONS_CHANGED" });
      assert.equal(authorizationCalls, 5);
      assert.deepEqual(runtime.readJournal(staged.operation_id), journal);
      pass(mode + ": changed process prefix refuses a second staging and preserves the first journal");
    } finally {
      for (const root of owned) {
        const physical = fs.realpathSync(root);
        if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
        fs.rmSync(physical, { recursive: true, force: true });
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let checks = 0;
  await verifyStandardPreviewValidity(name => { checks++; console.log("PASS " + name); });
  console.log(JSON.stringify({ status: "PASS", checks, clock: "injected", stores: "files-and-SQLite",
    authority: "controlled-current-capability", native_model_calls: 0, business_dispatch: "NOT_RUN", installed_archive: "NOT_RUN" }));
}
