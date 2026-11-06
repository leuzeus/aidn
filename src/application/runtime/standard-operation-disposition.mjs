import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createWorkflowRecordStore } from "../../adapters/runtime/workflow-record-store.mjs";
import { createProcessDispatchRecordStore } from "../../adapters/runtime/process-dispatch-record-store.mjs";
import { observeLocalProcess } from "../../adapters/runtime/local-process-identity.mjs";
import { assertProcessDispatchRecord } from "../../core/workflow/process-dispatch-record.mjs";
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { withStandardDispatchContext } from "./standard-dispatch-context.mjs";
import { LOCAL_ARTIFACT_FENCE_PATH } from "./local-artifact-resource-fence.mjs";
import planSchema from "../../core/contracts/workflow-definition/process-operation-disposition-plan.v1.schema.json" with { type: "json" };
import recordSchema from "../../core/contracts/workflow-definition/process-operation-disposition.v1.schema.json" with { type: "json" };
import requestSchema from "../../core/contracts/workflow-definition/process-disposition-authorization-request.v1.schema.json" with { type: "json" };
import grantSchema from "../../core/contracts/workflow-definition/process-disposition-authorization-grant.v1.schema.json" with { type: "json" };
import controlSchema from "../../core/contracts/workflow-definition/process-operation-control-intent.v1.schema.json" with { type: "json" };
import fenceSchema from "../../core/contracts/workflow-definition/local-artifact-resource-fence.v1.schema.json" with { type: "json" };
import { assertProcessReconciliationInventory } from "../../core/workflow/process-reconciliation-inventory.mjs";

const fail = code => { throw Object.assign(Error(code), { code }); };
const bodyOf = ({ authentication, key_id, ...body }) => body;
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const assertRecord = value => {
  if (!valid(value, recordSchema) || !valid(value.plan, planSchema) || value.operation_id !== value.plan.operation_id
    || value.receipt.operation_id !== value.operation_id || value.plan.output_sha256 !== value.receipt.output_sha256)
    fail("PROCESS_DISPOSITION_RECORD_INVALID");
  return value;
};
const dispositionPath = id => {
  if (!/^op_[a-f0-9]{40}$/.test(id)) fail("PROCESS_DISPOSITION_ID_INVALID");
  return `workflows/operation-dispositions/${id}.json`;
};
const controlPath = id => dispositionPath(id).replace("operation-dispositions/", "operation-control-intents/");
function inventoryMaterial(retained, id) {
  const { observed_at_ms, authentication, key_id, ...material } = retained;
  material.resources = material.resources.filter(row => !["artifact:" + dispositionPath(id), "artifact:" + controlPath(id), "artifact:" + LOCAL_ARTIFACT_FENCE_PATH].includes(row.ref));
  return material;
}

// These are implementation-owned resource profiles, not declarations accepted
// from JSON. Extend them only with a real adapter and its closure qualification.
const readOnlyProfiles = new Set(["context_reload", "session_admit", "session_close_admit"]);
const artifactProfiles = new Set(["session_close_record"]);

export function createStandardOperationDisposition({ targetRoot, stateMode, signer, artifacts, readOperation,
  readInstance, readAuthority, readContext, observeBoundary, inventory, dispositionSource, appendResult, makeReceipt, onBoundary = async () => {}, now = Date.now }) {
  const dispatches = createProcessDispatchRecordStore({ targetRoot, stateMode });
  const acceptance = new AsyncLocalStorage();
  const dispositions = createWorkflowRecordStore({ targetRoot, stateMode, descriptor: { pathForId: dispositionPath,
    validate: assertRecord, idOf: row => row.operation_id, hashOf: shadowHash, kind: "process_operation_journal" } });
  const controls = createWorkflowRecordStore({ targetRoot, stateMode, descriptor: { pathForId: controlPath,
    validate(row) { if (!valid(row, controlSchema)) fail("PROCESS_CONTROL_INTENT_INVALID"); return row; },
    idOf: row => row.operation_id, hashOf: shadowHash, kind: "process_operation_journal" } });
  let processIdentity;
  const runtime = () => shadowHash(artifacts.describe());
  function write(store, body, expected) {
    const row = signer.seal(body), committed = store.compareAndSwap(row, expected);
    if (committed.projection === "pending") store.materialize(row.operation_id, { write: true });
    return row;
  }
  function readDispatch(id, record) {
    const observed = dispatches.read(id), row = observed.record;
    if (!row) return observed;
    signer.verify(row); assertProcessDispatchRecord(row);
    if (row.operation_id !== record.operation_id || row.intent_sha256 !== shadowHash(record.intent)
      || row.preview_sha256 !== shadowHash(record.preview) || row.scope_id !== record.intent.scope_id
      || row.operation_owner_sha256 !== shadowHash(record.owner)
      || row.instance_id !== record.intent.instance_id || row.model_sha256 !== record.intent.model_sha256
      || row.physical_root_sha256 !== shadowHash(artifacts.root) || row.runtime_sha256 !== runtime())
      fail("PROCESS_DISPOSITION_SUBJECT_CHANGED");
    return observed;
  }
  function saveDispatch(before, update) {
    return write(dispatches, { ...bodyOf(before.record), ...update, revision: before.record.revision + 1 }, before.content_sha256);
  }
  function readControls(id) {
    const before = controls.read(id);
    if (!before.record) return before;
    signer.verify(before.record);
    for (const attempt of before.record.attempts) {
      signer.verify(attempt.plan); signer.verify(attempt.inventory);
      assertProcessReconciliationInventory(attempt.inventory);
      if (!valid(attempt.plan, planSchema) || attempt.plan.operation_id !== id
        || attempt.plan.physical_root_sha256 !== shadowHash(artifacts.root)
        || attempt.plan.runtime_sha256 !== runtime()
        || attempt.inventory.instance_id !== attempt.plan.instance_id
        || attempt.inventory.instance_sha256 !== attempt.instance_sha256
        || attempt.inventory.scope_id !== attempt.plan.scope_id || attempt.inventory.model_sha256 !== attempt.plan.model_sha256
        || attempt.inventory.physical_root_sha256 !== attempt.plan.physical_root_sha256
        || !valid(attempt.resource_fence.record, fenceSchema) || attempt.resource_fence.record.state !== "held"
        || attempt.resource_fence.record.physical_root_sha256 !== attempt.plan.physical_root_sha256)
        fail("PROCESS_CONTROL_INTENT_SUBJECT_CHANGED");
      if (attempt.action === "disposition" && (!attempt.grant || !valid(attempt.grant.request, requestSchema)
        || !valid(attempt.grant.grant, grantSchema) || attempt.grant.request.plan_sha256 !== shadowHash(attempt.plan)
        || shadowHash(attempt.grant.request.plan) !== shadowHash(attempt.plan)
        || attempt.grant.request.action !== "operation_disposition"
        || attempt.grant.grant.request_sha256 !== shadowHash(attempt.grant.request)
        || attempt.grant.verification?.outcome !== "verified"
        || attempt.grant.verification.request_sha256 !== shadowHash(attempt.grant.request)
        || attempt.grant.verification.grant_sha256 !== shadowHash(attempt.grant.grant)
        || attempt.grant.verification.authority_id !== attempt.grant.grant.authority_id
        || attempt.instance_sha256 !== attempt.plan.instance_sha256
        || attempt.journal_sha256 !== attempt.plan.journal_sha256
        || shadowHash(inventoryMaterial(attempt.inventory, id)) !== attempt.plan.inventory_sha256
        || attempt.resource_fence.previous_sha256 !== attempt.plan.fence_sha256)) fail("PROCESS_CONTROL_INTENT_SUBJECT_CHANGED");
      if (attempt.action === "acceptance" && (attempt.grant !== null || !attempt.receipt_sha256 || !attempt.audit_sha256))
        fail("PROCESS_CONTROL_INTENT_SUBJECT_CHANGED");
    }
    return before;
  }
  function reserveControl(before, attempt) {
    if ((before.record?.attempts.length ?? 0) >= 32) fail("PROCESS_DISPOSITION_ADMISSION_LIMIT");
    const row = { contract_version: "process-operation-control-intent.v1", operation_id: attempt.plan.operation_id,
      revision: (before.record?.revision ?? 0) + 1, attempts: [...(before.record?.attempts ?? []), attempt] };
    // Refuse before acquiring a resource if retained proof exceeds the existing
    // bounded record reader. Never discard an earlier attempt to make room.
    if (Buffer.byteLength(JSON.stringify(row)) > 900000) fail("PROCESS_CONTROL_INTENT_STORAGE_BOUND");
    return write(controls, row, before.content_sha256);
  }
  function assessment(record, capsule) {
    if (!capsule || capsule.phase !== "returned" || capsule.leases.some(row => row.status !== "released")) return "unknown";
    const observed = observeBoundary ? observeBoundary() : { authority: readAuthority(), context: readContext() };
    if (capsule.authority_sha256 !== shadowHash(observed.authority) || capsule.context_after_sha256 !== shadowHash(observed.context) || artifacts.localOwnerPending()) return "unknown";
    const output = capsule.output, id = record.intent.binding_ref;
    assertStandardOperationOutput(output);
    if (output.operation_ref !== id || output.contract_version !== record.preview.binding.output_contract) fail("PROCESS_DISPOSITION_SUBJECT_CHANGED");
    if (readOnlyProfiles.has(id) && record.preview.binding.effect_class === "read-only" && capsule.leases.length === 0
      && output.effect_status === "no_effect") return "no_effect_original";
    if (!artifactProfiles.has(id)) return "unknown";
    if (output.effect_status === "no_effect" && capsule.leases.every(row => row.status === "released")) return "no_effect_original";
    if (output.effect_status !== "confirmed" || output.outcome !== "completed" || capsule.leases.length !== 1) return "unknown";
    const changes = record.preview.prepared?.plan?.changes, images = output.observations?.postimages;
    if (!Array.isArray(changes) || !changes.length || !Array.isArray(images) || images.length !== changes.length
      || shadowHash(changes.map(row => row.path)) !== shadowHash(images.map(row => row.path))) return "unknown";
    for (const [i, image] of images.entries()) {
      if (image.sha256 !== changes[i].after_sha256 || artifacts.read(image.path, { required: true }).sha256 !== image.sha256
        || artifacts.metadataHash(image.path) !== image.metadata_sha256) return "unknown";
      if (artifacts.describe().state_mode !== "db-only"
        && readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, "docs/audit", image.path)), { json: false, maxBytes: 1048576 }).sha256 !== image.sha256)
        return "unknown";
    }
    // Projection gaps are retained. This observer never materializes a projection.
    // Its bytes are part of the inventory fence, but only the original port can
    // declare its successful required projection in the captured original output.
    return "confirmed_original";
  }
  function observation(id) {
    const operation = readOperation(id).record, capsule = readDispatch(id, operation).record;
    const { instance, inventory: retained } = inventory.observeSubject(operation.intent.instance_id);
    if (retained.operations.find(row => row.operation_id === id)?.record_sha256 !== shadowHash(operation))
      fail("PROCESS_DISPOSITION_OBSERVATION_CHANGED");
    // This operation's audit attempts are retained and authenticated separately.
    // Exclude only their own artifact from the pre-append business-resource fence,
    // so a crash before the journal CAS can resume without rewriting an old plan.
    const material = inventoryMaterial(retained, id);
    return { operation, instance, capsule, inventory_sha256: shadowHash(material), assessment: assessment(operation, capsule),
      authority_sha256: shadowHash(readAuthority()), runtime_sha256: runtime(), physical_root_sha256: shadowHash(artifacts.root),
      fence_sha256: artifacts.resourceFence().read().content_sha256, inventory_record: retained };
  }
  function subject(observed) {
    const { operation, instance, capsule } = observed;
    return { operation_id: operation.operation_id, instance_id: instance.instance_id, instance_sha256: instance.instance_sha256,
      instance_revision: instance.revision, scope_id: instance.scope_id, model_sha256: instance.model_sha256,
      authority_sha256: observed.authority_sha256, runtime_sha256: observed.runtime_sha256, physical_root_sha256: observed.physical_root_sha256,
      journal_sha256: shadowHash(operation), dispatch_sha256: capsule ? shadowHash(capsule) : null,
      inventory_sha256: observed.inventory_sha256, assessment: observed.assessment,
      fence_sha256: observed.fence_sha256,
      output_sha256: observed.assessment === "unknown" ? null : capsule.output_sha256 };
  }
  async function invokeSource(method, request, signal) {
    if (typeof dispositionSource?.[method] !== "function") fail("PROCESS_DISPOSITION_AUTHORITY_UNAVAILABLE");
    if (signal?.aborted) fail("PROCESS_DISPOSITION_ABORTED");
    const stop = new AbortController(), combined = signal ? AbortSignal.any([stop.signal, signal]) : stop.signal;
    let timer, abort;
    const cancelled = new Promise((_, reject) => { abort = () => reject(Object.assign(Error("PROCESS_DISPOSITION_ABORTED"), { code: "PROCESS_DISPOSITION_ABORTED" })); combined.addEventListener("abort", abort, { once: true }); });
    const expired = new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(Error("PROCESS_DISPOSITION_AUTHORIZATION_TIMEOUT"), { code: "PROCESS_DISPOSITION_AUTHORIZATION_TIMEOUT" })); stop.abort(); }, 5000); });
    let result;
    try { result = await Promise.race([Promise.resolve().then(() => dispositionSource[method]({ ...structuredClone(request), signal: combined })), cancelled, expired]); }
    finally { clearTimeout(timer); combined.removeEventListener("abort", abort); stop.abort(); }
    return result;
  }
  function freshGrant(grant, request) {
    const age = now() - grant?.observed_at_ms;
    if (!grant || !valid(grant, grantSchema)
      || grant.authorized !== true || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(grant.authority_id ?? "")
      || ![grant.grant_sha256, grant.principal_sha256].every(value => /^[a-f0-9]{64}$/.test(value ?? ""))
      || grant.request_sha256 !== shadowHash(request) || !Number.isSafeInteger(age) || age < 0 || age > 60000
      || !Number.isSafeInteger(grant.expires_at_ms) || grant.expires_at_ms <= now() || grant.expires_at_ms > grant.observed_at_ms + 60000
      || !Array.isArray(grant.evidence_refs) || !grant.evidence_refs.length || grant.evidence_refs.length > 32
      || grant.evidence_refs.some(row => Object.keys(row).sort().join(",") !== "ref,sha256" || typeof row.ref !== "string" || !row.ref || row.ref.length > 256 || !/^[a-f0-9]{64}$/.test(row.sha256 ?? ""))) fail("PROCESS_DISPOSITION_AUTHORIZATION_REQUIRED");
  }
  function currentConsent(plan, captured, signal) {
    if (signal?.aborted) fail("PROCESS_DISPOSITION_ABORTED");
    freshGrant(captured.grant, captured.request);
    const age = now() - plan.prepared_at_ms;
    if (!Number.isSafeInteger(age) || age < 0 || age > 60000) fail("PROCESS_DISPOSITION_PLAN_EXPIRED");
  }
  async function currentGrant(subject, signal) {
    const request = { contract_version: "process-disposition-authorization-request.v1", ...subject, nonce: randomUUID(), requested_at_ms: now() };
    if (!valid(request, requestSchema)) fail("PROCESS_DISPOSITION_AUTHORIZATION_REQUEST_INVALID");
    const grant = await invokeSource("authorize", { request }, signal);
    freshGrant(grant, request);
    const proof = await verifyGrant({ request, grant }, signal);
    return { request, grant, verification: proof };
  }
  async function verifyGrant({ request, grant }, signal) {
    freshGrant(grant, request);
    const proof = await invokeSource("verify", { request, grant }, signal);
    freshGrant(grant, request);
    if (proof?.outcome !== "verified" || proof.authority_id !== grant.authority_id || proof.grant_sha256 !== shadowHash(grant)
      || proof.request_sha256 !== shadowHash(request)) fail("PROCESS_DISPOSITION_AUTHORIZATION_NOT_AUTHENTICATED");
    return proof;
  }
  return Object.freeze({
    async run(record, effect) {
      if (dispatches.read(record.operation_id).record) fail("PROCESS_DISPATCH_ALREADY_DECLARED");
      processIdentity ??= observeLocalProcess(process.pid);
      if (!processIdentity) fail("PROCESS_IDENTITY_UNAVAILABLE");
      const boundary = observeBoundary ? observeBoundary() : { authority: readAuthority(), context: readContext() };
      write(dispatches, { contract_version: "process-dispatch-record.v1", operation_id: record.operation_id, revision: 1, phase: "reserved",
        instance_id: record.intent.instance_id, scope_id: record.intent.scope_id, model_sha256: record.intent.model_sha256,
        intent_sha256: shadowHash(record.intent), preview_sha256: shadowHash(record.preview), authority_sha256: shadowHash(boundary.authority),
        operation_owner_sha256: shadowHash(record.owner),
        runtime_sha256: runtime(), physical_root_sha256: shadowHash(artifacts.root), process_identity: processIdentity,
        context_before_sha256: shadowHash(boundary.context), context_after_sha256: null, leases: [], output: null, output_sha256: null }, null);
      await onBoundary("dispatch_reserved", record.operation_id);
      saveDispatch(readDispatch(record.operation_id, record), { phase: "running" });
      const capability = Object.freeze({
        declareLocalOwner(owner, physical_identity, resource_fence) {
          const before = readDispatch(record.operation_id, record);
          if (before.record.phase !== "running" || owner.pid !== processIdentity.pid || artifactProfiles.has(record.intent.binding_ref) && owner.plan_sha256 !== record.preview.prepared?.plan_sha256
            || owner.scope_sha256 !== shadowHash({ physical_root: artifacts.root }) || before.record.leases.some(row => row.owner.token === owner.token))
            fail("PROCESS_DISPATCH_OWNER_CHANGED");
          saveDispatch(before, { leases: [...before.record.leases, { owner, physical_identity, resource_fence, status: "held" }] });
        },
        releaseLocalOwner(owner) {
          const before = readDispatch(record.operation_id, record), index = before.record.leases.findIndex(row => shadowHash(row.owner) === shadowHash(owner));
          if (index < 0 || before.record.leases[index].status !== "held") fail("PROCESS_DISPATCH_OWNER_CHANGED");
          const leases = structuredClone(before.record.leases); leases[index].status = "released";
          saveDispatch(before, { leases });
        },
      });
      const output = await withStandardDispatchContext(capability, effect);
      assertStandardOperationOutput(output);
      const contextAfter = shadowHash(readContext());
      await onBoundary("effect_returned", record.operation_id);
      if (shadowHash(readContext()) !== contextAfter) fail("PROCESS_DISPATCH_CONTEXT_CHANGED");
      saveDispatch(readDispatch(record.operation_id, record), { phase: "returned", output, output_sha256: shadowHash(output), context_after_sha256: contextAfter });
      await onBoundary("dispatch_returned", record.operation_id);
      if (shadowHash(readContext()) !== contextAfter) fail("PROCESS_DISPATCH_CONTEXT_CHANGED");
      return output;
    },
    prepare(id, { expectedSha256 } = {}) {
      const observed = observation(id);
      if (observed.instance.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
      return signer.seal({ contract_version: "process-operation-disposition-plan.v1", ...subject(observed), prepared_at_ms: now(), nonce: randomUUID() });
    },
    async apply(plan, { write: explicit = false, expectedPlanSha256, signal } = {}) {
      plan = structuredClone(plan);
      if (!valid(plan, planSchema)) fail("PROCESS_DISPOSITION_PLAN_INVALID");
      signer.verify(plan);
      if (explicit !== true || expectedPlanSha256 !== shadowHash(plan)) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const previous = dispositions.read(plan.operation_id);
      if (previous.record) {
        signer.verify(previous.record); signer.verify(previous.record.plan);
        const record = readOperation(plan.operation_id).record;
        if (record.results.some(row => shadowHash(row.receipt) === shadowHash(previous.record.receipt))) {
          if (shadowHash(previous.record.plan) !== shadowHash(plan) && !previous.record.attempts.some(row => shadowHash(row.plan) === shadowHash(plan))) fail("PROCESS_DISPOSITION_ALREADY_RECORDED");
          return { status: "retained_result", receipt: previous.record.receipt, written: false };
        }
      }
      const fresh = lease => {
        const age = now() - plan.prepared_at_ms;
        if (signal?.aborted || !Number.isSafeInteger(age) || age < 0 || age > 60000) fail("PROCESS_DISPOSITION_PLAN_EXPIRED");
        const observed = observation(plan.operation_id);
        if (lease) { artifacts.resourceFence().assert(lease); observed.fence_sha256 = lease.previous_sha256; }
        if (shadowHash(subject(observed)) !== shadowHash(Object.fromEntries(Object.entries(plan).filter(([key]) => !["contract_version", "prepared_at_ms", "nonce", "key_id", "authentication"].includes(key)))))
          fail("PROCESS_DISPOSITION_OBSERVATION_CHANGED");
        return observed;
      };
      let observed = fresh();
      if (observed.assessment === "unknown") return { status: "reconciliation_required", effect_status: "unknown", written: false };
      const record = observed.operation;
      const original = record.results.find(row => row.receipt.output_sha256 === observed.capsule.output_sha256);
      if (!(record.phase === "dispatching" || record.phase === "receipted" && (record.results.at(-1).receipt.effect_status === "unknown" || original)))
        fail("PROCESS_DISPOSITION_UNCERTAIN_OPERATION_REQUIRED");
      const grant = await currentGrant({ action: "operation_disposition", plan_sha256: shadowHash(plan), plan }, signal);
      const control = readControls(plan.operation_id), fence = artifacts.resourceFence();
      const ownedLease = [...(previous.record ? [previous.record.resource_fence, ...previous.record.attempts.map(row => row.resource_fence)] : []),
        ...(control.record?.attempts.map(row => row.resource_fence.record) ?? [])]
        .find(row => shadowHash(row) === shadowHash(artifacts.resourceFence().read().record));
      const prepared = fence.prepareAcquire({ expectedSha256: plan.fence_sha256 });
      currentConsent(plan, grant, signal);
      reserveControl(control, { action: "disposition", plan, grant, inventory: observed.inventory_record,
        instance_sha256: observed.instance.instance_sha256, journal_sha256: shadowHash(record),
        receipt_sha256: original ? shadowHash(original.receipt) : null, audit_sha256: previous.record ? shadowHash(previous.record) : null,
        resource_fence: prepared });
      await onBoundary("disposition_control_reserved", record.operation_id);
      // A reservation authenticates ownership, never continuing permission.
      // No expired/cancelled/revoked consent may acquire its proposed lease.
      await verifyGrant(grant, signal);
      currentConsent(plan, grant, signal);
      const lease = fence.acquire({ prepared, expectedSha256: plan.fence_sha256, ...(ownedLease ? { dispositionLease: ownedLease } : {}) });
      try {
      await onBoundary("disposition_fence_acquired", record.operation_id);
      // No retained source verdict survives the awaited critical checkpoint.
      // Verify the same consent again, then reobserve the subject synchronously.
      const auditGrant = { ...grant, verification: await verifyGrant(grant, signal) };
      // All asynchronous authority calls finish before this exact fence CAS.
      // Reobserve the entire subject under the acquired fence before audit or
      // result writes. A second full scan immediately before this synchronous
      // acquisition adds no protected observation; retain no cross-call cache.
      observed = fresh(lease);
      freshGrant(grant.grant, grant.request);
      const receipt = original?.receipt ?? makeReceipt(observed.operation, observed.capsule.output);
      if (previous.record && (shadowHash(previous.record.receipt) !== shadowHash(receipt) || previous.record.attempts.length >= 32)) fail("PROCESS_DISPOSITION_SUBJECT_CHANGED");
      const audit = previous.record
        ? { ...bodyOf(previous.record), revision: previous.record.revision + 1, attempts: [...previous.record.attempts, { plan, grant: auditGrant, resource_fence: lease.record }] }
        : { contract_version: "process-operation-disposition.v1", operation_id: plan.operation_id, revision: 1, plan, grant: auditGrant, receipt, resource_fence: lease.record, attempts: [], admissions: [], acceptance_reservations: [] };
      write(dispositions, audit, previous.content_sha256);
      await onBoundary("disposition_recorded", record.operation_id);
      await verifyGrant(grant, signal);
      observed = fresh(lease);
      freshGrant(grant.grant, grant.request);
      if (!original && shadowHash(appendResult(observed.operation, observed.capsule.output)) !== shadowHash(receipt)) fail("PROCESS_DISPOSITION_RECEIPT_CHANGED");
      await onBoundary("disposition_receipted", record.operation_id);
      return { status: "receipted", receipt, written: true };
      } finally { artifacts.resourceFence().release(lease); }
    },
    async withReceiptAcceptance(id, action) {
      const before = dispositions.read(id);
      if (!before.record) return action();
      signer.verify(before.record); signer.verify(before.record.plan);
      const currentFence = artifacts.resourceFence().read();
      const control = readControls(id);
      const known = [before.record.resource_fence, ...before.record.attempts.map(row => row.resource_fence),
        ...before.record.acceptance_reservations.map(row => row.resource_fence),
        ...(control.record?.attempts.map(row => row.resource_fence.record) ?? [])].find(row => shadowHash(row) === shadowHash(currentFence.record));
      const { instance, inventory: retained } = inventory.observeSubject(before.record.plan.instance_id);
      const prepared = artifacts.resourceFence().prepareAcquire({ expectedSha256: currentFence.content_sha256 });
      reserveControl(control, { action: "acceptance", plan: before.record.plan, grant: null, inventory: retained,
        instance_sha256: instance.instance_sha256, journal_sha256: shadowHash(readOperation(id).record),
        receipt_sha256: shadowHash(before.record.receipt), audit_sha256: shadowHash(before.record), resource_fence: prepared });
      const lease = artifacts.resourceFence().acquire({ prepared, expectedSha256: currentFence.content_sha256, ...(known ? { dispositionLease: known } : {}) });
      try {
        if (before.record.acceptance_reservations.length >= 32) fail("PROCESS_DISPOSITION_ADMISSION_LIMIT");
        write(dispositions, { ...bodyOf(before.record), revision: before.record.revision + 1,
          acceptance_reservations: [...before.record.acceptance_reservations, { instance_sha256: readInstance(before.record.plan.instance_id).instance_sha256,
            resource_fence: lease.record }] }, before.content_sha256);
        return await acceptance.run(lease, action);
      } finally { artifacts.resourceFence().release(lease); }
    },
    async verifyReceipt(record, receipt, signal) {
      const before = dispositions.read(record.operation_id);
      if (!before.record) return false;
      signer.verify(before.record); signer.verify(before.record.plan);
      if (shadowHash(before.record.receipt) !== shadowHash(receipt)) return false;
      const instance = readInstance(record.intent.instance_id), capsule = readDispatch(record.operation_id, record).record;
      if (assessment(record, capsule) === "unknown" || before.record.plan.output_sha256 !== receipt.output_sha256)
        fail("PROCESS_DISPOSITION_OBSERVATION_CHANGED");
      const grant = await currentGrant({ action: "operation_disposition_accept", disposition_sha256: shadowHash(before.record),
        receipt_sha256: shadowHash(receipt), instance_sha256: instance.instance_sha256, scope_id: instance.scope_id }, signal);
      const lease = acceptance.getStore();
      if (!lease) fail("PROCESS_DISPOSITION_ACCEPTANCE_FENCE_REQUIRED");
      artifacts.resourceFence().assert(lease);
      freshGrant(grant.grant, grant.request);
      if (readInstance(instance.instance_id).instance_sha256 !== instance.instance_sha256
        || shadowHash(readOperation(record.operation_id).record) !== shadowHash(record)
        || shadowHash(readDispatch(record.operation_id, record).record) !== shadowHash(capsule)
        || assessment(record, capsule) === "unknown") fail("PROCESS_DISPOSITION_OBSERVATION_CHANGED");
      if (before.record.admissions.length >= 32) fail("PROCESS_DISPOSITION_ADMISSION_LIMIT");
      write(dispositions, { ...bodyOf(before.record), revision: before.record.revision + 1, admissions: [...before.record.admissions,
        { instance_sha256: instance.instance_sha256, receipt_sha256: shadowHash(receipt), grant }] }, before.content_sha256);
      return true;
    },
  });
}
