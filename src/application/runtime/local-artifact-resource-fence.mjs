import { randomUUID } from "node:crypto";
import { createWorkflowRecordStore } from "../../adapters/runtime/workflow-record-store.mjs";
import { observeLocalProcess, observeLocalProcessOwner } from "../../adapters/runtime/local-process-identity.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import schema from "../../core/contracts/workflow-definition/local-artifact-resource-fence.v1.schema.json" with { type: "json" };

// Losing an already-held fence may follow a real write. Only the acquiring
// caller, before its callback, may classify an acquisition refusal as no-effect.
const fail = code => { throw Object.assign(Error(code), { code }); };
export const LOCAL_ARTIFACT_FENCE_PATH = "workflows/resource-fences/local-artifacts.json";
export function createLocalArtifactResourceFence({ targetRoot, stateMode }) {
  const rootSha = shadowHash(targetRoot);
  const validate = row => {
    if (checkShadowJson(row) || validateJsonSchema(row, schema, "$", { contractKind: "workflow-definition" }).length
      || row.physical_root_sha256 !== rootSha) fail("STANDARD_RESOURCE_FENCE_INVALID");
    return row;
  };
  const store = createWorkflowRecordStore({ targetRoot, stateMode, descriptor: { pathForId: () => LOCAL_ARTIFACT_FENCE_PATH,
    validate, idOf: () => "local_artifacts", hashOf: shadowHash, kind: "process_operation_journal" } });
  let self;
  const read = () => store.read("local_artifacts");
  const save = (row, expected) => {
    const result = store.compareAndSwap(row, expected);
    if (result.projection === "pending") store.materialize("local_artifacts", { write: true });
    return read();
  };
  const assert = lease => {
    const current = read();
    if (current.content_sha256 !== lease.content_sha256 || current.record?.state !== "held"
      || current.record.token !== lease.record.token) fail("STANDARD_RESOURCE_FENCE_CHANGED");
  };
  return Object.freeze({ read,
    acquire(options = {}) {
      const before = read();
      if (Object.hasOwn(options, "expectedSha256") && options.expectedSha256 !== before.content_sha256) fail("STANDARD_RESOURCE_FENCE_CHANGED");
      if (before.record?.state === "held") {
        // The application must first authenticate this exact retained disposition
        // lease. This narrow CAS transfer closes no business/Native/H resource.
        if (!options.dispositionLease || shadowHash(options.dispositionLease) !== shadowHash(before.record)
          || observeLocalProcessOwner(before.record.process_identity) !== "terminated") fail("STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED");
      }
      self ??= observeLocalProcess(process.pid);
      if (!self) fail("PROCESS_IDENTITY_UNAVAILABLE");
      const after = save({ contract_version: "local-artifact-resource-fence.v1", revision: (before.record?.revision ?? 0) + 1,
        physical_root_sha256: rootSha, state: "held", token: randomUUID(), process_identity: self }, before.content_sha256);
      return { ...after, previous_sha256: before.content_sha256 };
    }, assert,
    release(lease) {
      assert(lease);
      return save({ ...lease.record, revision: lease.record.revision + 1, state: "released" }, lease.content_sha256);
    },
  });
}
