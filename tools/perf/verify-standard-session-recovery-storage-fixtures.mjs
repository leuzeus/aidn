import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shadowHash as H } from "../../src/core/workflow/shadow-json.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createLocalArtifactResourceFence } from "../../src/application/runtime/local-artifact-resource-fence.mjs";
import { inspectInterruptedReopenLock, retireInterruptedReopenLock } from "../../src/application/runtime/local-artifact-owner-retirement.mjs";
import { exactFileIdentity, resolveFileStatDevice } from "../../src/lib/fs/exact-file-identity.mjs";
import { createSessionCloseRecoveryStore } from "../../src/adapters/runtime/standard-session-close-recovery-store.mjs";
import { createSessionRecoveryWriter } from "../../src/application/runtime/standard-session-recovery-writer.mjs";
import { sessionRecoveryOwnsFence } from "../../src/core/workflow/standard-session-close-recovery.mjs";

import { createLocalHandoffProcessDiscovery } from "../../src/adapters/runtime/local-handoff-process-discovery.mjs";
const hash = "a".repeat(64), id = "op_" + "b".repeat(40), self = fileURLToPath(import.meta.url);
const child = process.argv.includes("--producer") || process.argv.includes("--recover");
if (child) {
  const file = process.argv.at(-1), config = JSON.parse(fs.readFileSync(file));
  const options = { targetRoot: config.root, stateMode: config.mode }, fence = createLocalArtifactResourceFence(options);
  const lockPath = path.join(config.root, ".aidn/runtime/standard-workflow/effects.lock");
  if (process.argv.includes("--producer")) {
    const resource = fence.acquire();
    const owner = { contract_version: "process-local-effect-owner.v1", token: "fixture", pid: process.pid, scope_sha256: hash, plan_sha256: hash, created_at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(lockPath), { recursive: true }); fs.writeFileSync(lockPath, JSON.stringify(owner), { flag: "wx" });
    const physical_identity = exactFileIdentity(resolveFileStatDevice(lockPath, fs.lstatSync(lockPath, { bigint: true }), () => { throw Error("CHANGED"); }));
    fs.writeFileSync(file + ".origin.json", JSON.stringify({ lease: { owner, physical_identity, resource_fence: resource.record },
      intention: { owner, lock_path: ".aidn/runtime/standard-workflow/effects.lock" } }));
  } else {
    const origin = JSON.parse(fs.readFileSync(file + ".origin.json"));
    const store = createSessionCloseRecoveryStore(options), signer = createOperationJournalSigner(() => Buffer.alloc(32, 8));
    const request = { contract_version: "standard-session-close-recovery.v1", target_root: config.root, instance_id: "fixture", operation_id: id,
      original_configuration: { path: file, sha256: hash } };
    const writer = createSessionRecoveryWriter({ request, signer, store, fence, implementationSha256: hash, assertImplementation() {},
      observe: async recovery => {
        const current = fence.read(), owned = recovery && sessionRecoveryOwnsFence(recovery, current.record);
        assert(owned || H(current.record) === H(origin.lease.resource_fence));
        const lock = inspectInterruptedReopenLock(config.root, id, origin.intention, origin.lease, { allowRetired: Boolean(owned) });
        const observation = createLocalHandoffProcessDiscovery({ targetRoot: config.root, controlRoot: config.root,
          nativeExecutable: config.nativeMarker, ownerIdentities: [origin.lease.resource_fence.process_identity] }).observe();
        assert(observation.stable && observation.samples.every(row => !row.processes.length && !row.unavailable.length),
          'fixture process observation not empty: ' + JSON.stringify(observation));
        return { instance: { instance_id: "fixture", instance_sha256: hash, scope_id: hash, model_sha256: hash }, record: { operation_id: id },
          capsule: {}, native: null, records: [], execution: {}, historical: { proof: {} }, physical: { events_sha256: hash, run_file_sha256: hash, documents: [] }, context: { authority_sha256: hash, context_sha256: hash },
          processes: [observation],
          owner: { ...origin, fence: current, lock }, assertStable() {} };
      }, retire: ({ observed, dispositionLease, assertPermit }) => retireInterruptedReopenLock({ targetRoot: config.root, operationId: id,
        intention: origin.intention, originalLease: origin.lease, fence, dispositionLease, expectedLockSha256: observed.owner.lock.sha256, assertPermit, write: true }),
      boundary: async point => { if (point === config.crash) process.exit(73); },
    });
    const preview = await writer.preview();
    const result = await writer.execute({ expectPlan: preview.action_sha256 });
    assert.equal(result.status, "reconciled_checkpoint_only");
  }
} else {
  const owned = [], temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-session-recovery-"));
  // There is no Native actor in this fixture. Give discovery its own inert image
  // marker instead of treating every unrelated transient node.exe as that actor.
  // Target/control markers and actual retained owner identities remain observed.
  const nativeMarker = path.join(temporary, 'fixture-native.exe'); fs.writeFileSync(nativeMarker, 'fixture image marker');
  const mode = process.argv.find(arg => arg.startsWith("--mode="))?.slice(7) ?? "db-only";
  const run = args => { try { execFileSync(process.execPath, [self, ...args], { encoding: "utf8", windowsHide: true, timeout: 120000, stdio: "pipe" }); return 0; }
    catch (error) { if (error.status === 73) return 73; throw error; } };
  try {
    for (const crash of ["intent", "fence_acquired", "lock_retired", "fence_released"]) {
      const root = createStandardWorkflowFixture(mode, owned), config = { root, mode, crash, nativeMarker }, file = path.join(temporary, crash + ".json");
      fs.writeFileSync(file, JSON.stringify(config)); assert.equal(run(["--producer", file]), 0);
      const origin = JSON.parse(fs.readFileSync(file + ".origin.json"));
      assert.equal(run(["--recover", file]), 73);
      const store = createSessionCloseRecoveryStore({ targetRoot: root, stateMode: mode });
      const interrupted = store.read(id).record; assert.equal(interrupted.phase, "pending");
      fs.writeFileSync(file, JSON.stringify({ ...config, crash: null })); assert.equal(run(["--recover", file]), 0);
      const completed = store.read(id), fence = createLocalArtifactResourceFence({ targetRoot: root, stateMode: mode });
      assert.equal(completed.record.phase, "completed"); assert.equal(fence.read().record.state, "released");
      assert.deepEqual(completed.record.attempts.slice(0, interrupted.attempts.length), interrupted.attempts);
      const archive = inspectInterruptedReopenLock(root, id, origin.intention, origin.lease, { allowRetired: true }); assert(archive.retired);
      const before = { record: completed.content_sha256, archive: H(archive.identity), fence: fence.read().content_sha256 };
      assert.equal(run(["--recover", file]), 0);
      assert.deepEqual({ record: store.read(id).content_sha256, archive: H(inspectInterruptedReopenLock(root, id, origin.intention, origin.lease, { allowRetired: true }).identity), fence: fence.read().content_sha256 }, before);
      console.log("PASS real process restart at " + crash + " (" + mode + ")");
    }
    console.log(JSON.stringify({ status: "PASS", checks: 4, mode, proof_class: "real-process-storage-and-lock-fixture", session_closure: "SKIP", native: "SKIP" }));
  } finally {
    for (const root of [...owned, temporary]) {
      assert(path.dirname(root) === fs.realpathSync(os.tmpdir()) && /^aidn-(standard-ports|session-recovery)-/.test(path.basename(root)));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}
