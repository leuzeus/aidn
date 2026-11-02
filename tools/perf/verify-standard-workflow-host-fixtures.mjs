#!/usr/bin/env node
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
import { createProcessOperationJournalStore } from "../../src/adapters/runtime/process-operation-journal-store.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { inspectAgenticProcess, createAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";

const H = "a".repeat(64), grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H };
const input = { session_id: "S001", session_branch: "S001-standard", objective: "Execute actual bootstrap ports through the common IR" };
const here = fileURLToPath(import.meta.url), temporary = fs.realpathSync(os.tmpdir()), owned = [];
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
function model() {
  const op = (id, binding_ref) => ({ id, kind: "operation", participant_ref: "project", binding_ref });
  return { contract_version: "agentic-process-model.v2", model_id: "bootstrap-port-fixture", revision: 1, participants: [{ id: "project" }], roles: [], policies: [],
    operation_pins: Object.fromEntries(standardWorkflowOperationBindings().map(binding => [binding.id, shadowHash(binding)])), entry: "bootstrap",
    nodes: [{ id: "bootstrap", kind: "sequence", participant_ref: "project", children: ["reload", "admit", "initialize", "operator_wait"] },
      op("reload", "context_reload"), op("admit", "session_admit"), op("initialize", "session_initialize"),
      { id: "operator_wait", kind: "event", participant_ref: "project", branches: [
        { flow_id: "refresh_context", node_id: "context_again", event_key: "refresh_context" },
        { flow_id: "refresh_admission", node_id: "admission_again", event_key: "refresh_admission" }] },
      op("context_again", "context_reload"), op("admission_again", "session_admit")] };
}
function host(root, keyFile, authorize = async () => grant, selectedModel = model()) {
  return createStandardWorkflowOperationHost({ targetRoot: root, model: selectedModel, readSigningKey: () => fs.readFileSync(keyFile), authorize });
}
if (process.argv[2] === "--accept") {
  const [, , , root, keyFile, id] = process.argv;
  const result = await host(root, keyFile).accept(id, { write: true });
  process.stdout.write(JSON.stringify({ instance_sha256: result.record.instance_sha256, revision: result.record.revision }) + "\n");
} else {
  let checks = 0;
  const pass = name => { checks++; process.stdout.write(`PASS ${name}\n`); };
  try {
    for (const mode of ["files", "dual", "db-only"]) {
      const root = createStandardWorkflowFixture(mode, owned), privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-key-")); owned.push(privateRoot);
      const keyFile = path.join(privateRoot, "host.key"); fs.writeFileSync(keyFile, randomBytes(32));
      let runtime = host(root, keyFile);
      assert.throws(() => runtime.initialize({ instanceId: "bootstrap", facts: { approved: true } }), { code: "STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED" });
      const initial = runtime.initialize({ instanceId: "bootstrap" });
      runtime.initialize({ instanceId: "bootstrap", write: true, expectedResultSha256: initial.record.instance_sha256 });
      for (const nodeId of ["reload", "admit", "initialize"]) {
        const before = runtime.inspect("bootstrap"), occurrence = before.cursor.occurrences.find(row => row.node_id === nodeId && row.status === "READY");
        assert.ok(occurrence);
        const preview = await runtime.preview({ instanceId: "bootstrap", expectedSha256: before.record.instance_sha256, occurrenceId: occurrence.occurrence_id,
          input: nodeId === "initialize" ? input : {} });
        assert.equal(runtime.inspect("bootstrap").record.instance_sha256, before.record.instance_sha256);
        await assert.rejects(runtime.stage(preview), { code: "STANDARD_HOST_EXPLICIT_WRITE_REQUIRED" });
        const forged = structuredClone(preview); forged.prepared_at_ms++;
        await assert.rejects(runtime.stage(forged, { write: true, expectedPreviewSha256: shadowHash(forged) }), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
        if (nodeId === "initialize") {
          const denied = host(root, keyFile, async () => ({ ...grant, authorized: false }));
          await assert.rejects(denied.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
          assert.equal(git(root, "branch", "--show-current"), "dev");
        }
        const staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id;
        assert.equal(runtime.readJournal(id).phase, "staged");
        runtime = host(root, keyFile);
        await assert.rejects(runtime.dispatch(id), { code: "STANDARD_HOST_EXPLICIT_WRITE_REQUIRED" });
        const competitors = await Promise.allSettled([runtime.dispatch(id, { write: true }), host(root, keyFile).dispatch(id, { write: true })]);
        const receipts = competitors.filter(row => row.status === "fulfilled" && row.value.status === "receipted");
        assert.equal(receipts.length, 1, JSON.stringify(competitors));
        assert.equal(receipts[0].value.receipt.outcome, "completed", JSON.stringify(receipts[0].value));
        const evidence = receipts[0].value.receipt.evidence_refs[0];
        assert.equal(shadowHash(runtime.readOutput(evidence.ref)), evidence.sha256);
        if (nodeId === "initialize") {
          const hash = runtime.inspect("bootstrap").record.instance_sha256;
          await assert.rejects(host(root, keyFile, async () => ({ ...grant, authorized: false })).accept(id, { write: true }), { code: "PROCESS_OPERATION_AUTHORITY_UNAVAILABLE" });
          assert.equal(runtime.inspect("bootstrap").record.instance_sha256, hash);
        }
        const journalBefore = shadowHash(runtime.readJournal(id)), business = createStandardWorkflowArtifacts({ targetRoot: root });
        const stateBefore = business.read("CURRENT-STATE.md").sha256, sessionBefore = business.read("sessions/S001.md").sha256, branchBefore = git(root, "branch", "--show-current");
        const child = JSON.parse(execFileSync(process.execPath, [here, "--accept", root, keyFile, id], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
        runtime = host(root, keyFile);
        assert.equal(runtime.inspect("bootstrap").record.instance_sha256, child.instance_sha256);
        assert.equal(shadowHash(runtime.readJournal(id)), journalBefore);
        assert.equal(business.read("CURRENT-STATE.md").sha256, stateBefore); assert.equal(business.read("sessions/S001.md").sha256, sessionBefore);
        assert.equal(git(root, "branch", "--show-current"), branchBefore);
        assert.equal((await runtime.dispatch(id, { write: true })).status, "retained_result");
        assert.equal((await runtime.accept(id, { write: true })).record.instance_sha256, child.instance_sha256);
        pass(`${mode}: ${nodeId}, authentic receipt, single dispatch and acceptance in a new Node process`);
      }
      const final = runtime.inspect("bootstrap"); assert.equal(final.cursor.status, "WAITING");
      assert.ok(final.cursor.occurrences.some(row => row.node_id === "operator_wait" && row.wait_reason === "event"));
      const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, policyPins: final.record.policy_pins,
        scopeId: final.record.scope_id, events: final.record.events });
      assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256);
      assert.deepEqual(simulation.trace.at(-1).cursor, inspectAgenticProcess(final.record));
      assert.equal(git(root, "branch", "--show-current"), input.session_branch);
      pass(`${mode}: durable event wait and exact replay/simulation with the execution reducer`);

      const processStore = createAgenticProcessStore({ targetRoot: root, stateMode: mode }), canonical = processStore.read("bootstrap");
      let fake = createAgenticProcess({ instanceId: "bootstrap", model: final.record.model, policyPins: final.record.policy_pins, scopeId: final.record.scope_id });
      for (const [index, original] of final.record.events.entries()) {
        const event = structuredClone(original);
        if (index === final.record.events.length - 1) event.receipt.facts = { session_initialized: false };
        fake = advanceAgenticProcess(fake, event);
      }
      processStore.compareAndSwap(fake, canonical.content_sha256);
      assert.throws(() => host(root, keyFile).inspect("bootstrap"), { code: "STANDARD_HOST_RESULT_HISTORY_NOT_AUTHENTICATED" });
      processStore.compareAndSwap(canonical.record, processStore.read("bootstrap").content_sha256);
      pass(`${mode}: a structurally valid, self-hashed process history cannot replace an authenticated result`);

      const event = final.record.events.find(row => row.kind === "operation_intent"), id = event.intent.operation_id;
      const journal = createProcessOperationJournalStore({ targetRoot: root, stateMode: mode }), old = journal.read(id), forged = structuredClone(old.record);
      const { authentication, ...body } = forged; forged.authentication = shadowHash(body);
      journal.compareAndSwap(forged, old.content_sha256);
      assert.throws(() => runtime.readJournal(id), { code: "PROCESS_JOURNAL_NOT_AUTHENTICATED" });
      pass(`${mode}: a self-hashed canonical journal cannot forge the host authentication`);

    }
    // A stopped-state fixture, not proof of OS process-tree death. Its canonical
    // intent is real; its claimed state is authored using the fixture host key.
    const root = createStandardWorkflowFixture("files", owned), privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-key-")); owned.push(privateRoot);
    const keyFile = path.join(privateRoot, "host.key"); fs.writeFileSync(keyFile, randomBytes(32));
    const runtime = host(root, keyFile), initial = runtime.initialize({ instanceId: "stopped" });
    runtime.initialize({ instanceId: "stopped", write: true, expectedResultSha256: initial.record.instance_sha256 });
    const frame = runtime.inspect("stopped").cursor.occurrences.find(row => row.status === "READY");
    const preview = await runtime.preview({ instanceId: "stopped", expectedSha256: initial.record.instance_sha256, occurrenceId: frame.occurrence_id });
    const staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
    const journal = createProcessOperationJournalStore({ targetRoot: root, stateMode: "files" }), original = journal.read(staged.operation_id);
    const { authentication, key_id, ...body } = original.record;
    const signed = createOperationJournalSigner(() => fs.readFileSync(keyFile));
    journal.compareAndSwap(signed.seal({ ...body, phase: "dispatching", revision: 2, owner: { generation: "00000000-0000-0000-0000-000000000001", pid: 1 } }), original.content_sha256);
    assert.equal((await host(root, keyFile).dispatch(staged.operation_id, { write: true })).status, "reconciliation_required");
    pass("stopped dispatch state refuses automatic replay or PID takeover");
    const partialRoot = createStandardWorkflowFixture("dual", owned), one = model();
    one.entry = "initialize"; one.nodes = one.nodes.filter(node => node.id === "initialize");
    one.operation_pins = { session_initialize: one.operation_pins.session_initialize };
    let partial = host(partialRoot, keyFile, async () => grant, one);
    const seed = partial.initialize({ instanceId: "partial" });
    partial.initialize({ instanceId: "partial", write: true, expectedResultSha256: seed.record.instance_sha256 });
    const pendingFrame = partial.inspect("partial").cursor.occurrences.find(row => row.status === "READY");
    const candidate = await partial.preview({ instanceId: "partial", expectedSha256: seed.record.instance_sha256, occurrenceId: pendingFrame.occurrence_id, input });
    const pending = await partial.stage(candidate, { write: true, expectedPreviewSha256: shadowHash(candidate) });
    const DatabaseSync = getDatabaseSync(), database = new DatabaseSync(resolveRuntimeSqliteFile({ targetRoot: partialRoot }));
    try { database.exec("CREATE TRIGGER fixture_abort_state BEFORE INSERT ON artifacts WHEN NEW.path = 'CURRENT-STATE.md' BEGIN SELECT RAISE(ABORT, 'fixture state failure'); END"); }
    finally { database.close(); }
    const unknown = await partial.dispatch(pending.operation_id, { write: true });
    assert.equal(unknown.receipt.outcome, "reconciliation_required"); assert.deepEqual(unknown.receipt.facts, {});
    partial = host(partialRoot, keyFile, async () => grant, one);
    const accepted = await partial.accept(pending.operation_id, { write: true }); assert.equal(accepted.cursor.status, "WAITING");
    assert.equal((await partial.dispatch(pending.operation_id, { write: true })).receipt.outcome, "reconciliation_required");
    await assert.rejects(partial.preview({ instanceId: "partial", expectedSha256: accepted.record.instance_sha256,
      occurrenceId: pendingFrame.occurrence_id, input }), { code: "PROCESS_OPERATION_ORDER_INVALID" });
    assert.equal(git(partialRoot, "branch", "--show-current"), input.session_branch);
    assert.equal(createStandardWorkflowArtifacts({ targetRoot: partialRoot }).ownerPending(), true);
    pass("real partial SQLite effects retain an authenticated unknown result and prohibit fresh dispatch after reopen");
    process.stdout.write(JSON.stringify({ status: "PASS", checks, proof: "offline-real-business-ports-common-reducer-and-new-node-hosts", authorization: "fixture-capability", native: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: "NOT_YET_DELIVERED" }) + "\n");
  } finally {
    for (const root of owned) {
      const physical = fs.realpathSync(root);
      if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-")) throw new Error("FIXTURE_CLEANUP_SCOPE_INVALID");
      fs.rmSync(physical, { recursive: true, force: true });
    }
  }
}
