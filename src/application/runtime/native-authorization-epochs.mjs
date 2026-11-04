import { randomUUID } from "node:crypto";
import { assertNativeAuthorization, assertNativeEpochRequest, assertNativeEpochGrant, nativeAllocationTotals, nativeInitialScope } from "../../core/workflow/native-authorization-epoch.mjs";
import { inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { shadowHash, freezeShadow } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// The embedding supplies an authenticated approval/closure source out of band.
// Neither authored JSON nor the host MAC establishes a human or OS observation.
export function createNativeAuthorizationEpochs({ configuration, signer, read, write, checkpoint, authenticatedCurrent, initialCurrent, journalId, preview, source, processAuthority, materialize }) {
  const configSha = shadowHash(configuration);
  function snapshot(original) {
    const before = read(), journal = before.record;
    if ((journal?.allocations.length ?? 0) >= 32 || (journal?.epochs?.length ?? 0) >= 31) fail("NATIVE_EPOCH_HISTORY_REQUIRED");
    const allocations = journal?.allocations ?? [], consumed = nativeAllocationTotals(allocations);
    if (!consumed.known) fail("NATIVE_EPOCH_RESOURCE_RECONCILIATION_REQUIRED");
    const initial = journal?.initial_authorization ?? assertNativeAuthorization(structuredClone(original));
    if (original && shadowHash(original) !== shadowHash(initial)) fail("NATIVE_EPOCH_ORIGINAL_AUTHORIZATION_CHANGED");
    if (initial.configuration_sha256 !== configSha || journal?.contract_version === "native-allocation-journal.v1"
      && shadowHash(initial) !== allocations[0].authorization_sha256) fail("NATIVE_EPOCH_ORIGINAL_AUTHORIZATION_CHANGED");
    if (!journal && Date.now() < Math.min(initial.global_deadline_ms, initial.workflow_deadline_ms)) fail("NATIVE_EPOCH_INITIAL_AUTHORIZATION_NOT_EXPIRED");
    const resources = new Map();
    for (const entry of allocations) {
      const evidence = checkpoint(entry);
      if (!evidence.state.parent_closed) fail("NATIVE_EPOCH_RESOURCE_RECONCILIATION_REQUIRED");
      const allocation = { kind: "allocation", generation: entry.generation, owner_id: entry.owner_id,
        closure_sha256: entry.closure_ref.sha256, checkpoint_sha256: entry.checkpoint.sha256 };
      resources.set(shadowHash(allocation), allocation);
      for (const row of evidence.state.resources) {
        const resource = { kind: "native_session", ...Object.fromEntries(["execution_id", "agent_id", "lineage_id", "session_id", "adapter_id"].map(key => [key, row.executor[key]])) };
        resources.set(shadowHash(resource), resource);
      }
    }
    const current = allocations.length ? authenticatedCurrent(true) : initialCurrent(), cursor = inspectAgenticProcess(current), actual = preview();
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status)) fail("NATIVE_EPOCH_TERMINAL_INSTANCE");
    if (!allocations.length) { const resource = nativeInitialScope({ instance_id: configuration.instance_id, scope_id: actual.scope_id, configuration_sha256: configSha }); resources.set(shadowHash(resource), resource); }
    return { before, body: { instance_id: configuration.instance_id, scope_id: actual.scope_id, model_sha256: actual.model_sha256,
      configuration_sha256: configSha, instance_sha256: current.instance_sha256, product_sha256: actual.product_sha256,
      journal_sha256: shadowHash(journal), allocations_sha256: shadowHash(allocations),
      previous_epoch_sha256: journal?.epochs?.length ? shadowHash(journal.epochs.at(-1)) : null,
      epoch: (journal?.epochs?.length ?? 0) + 2, next_generation: allocations.length + 1,
      initial_authorization: initial, consumption: consumed, resources: [...resources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, resource]) => resource) } };
  }
  function prepare({ originalAuthorization } = {}) {
    const { body } = snapshot(originalAuthorization), now = Date.now();
    return freezeShadow(signer.seal({ contract_version: body.next_generation === 1 ? "native-authorization-epoch-request.v2" : "native-authorization-epoch-request.v1", request_id: randomUUID(),
      ...body, issued_at_ms: now, expires_at_ms: now + 300000 }));
  }
  function current(request) {
    signer.verify(request); assertNativeEpochRequest(request);
    const now = Date.now();
    if (now < request.issued_at_ms || now >= request.expires_at_ms) fail("NATIVE_EPOCH_REQUEST_EXPIRED");
    const { body, before } = snapshot(request.initial_authorization);
    if (Object.keys(body).some(key => shadowHash(body[key]) !== shadowHash(request[key]))) fail("NATIVE_EPOCH_CONTEXT_CHANGED");
    return before;
  }
  async function activate(supplied, { write: explicit = false, sourceRef } = {}) {
    if (typeof explicit !== "boolean") fail("NATIVE_EPOCH_EXPLICIT_WRITE_REQUIRED");
    const request = freezeShadow(structuredClone(supplied));
    signer.verify(request); assertNativeEpochRequest(request);
    // A repeated activation observes the retained grant; it does not recapture
    // approval, reset counters, reobserve a provider or allocate a worker.
    const observed = read().record;
    const retained = observed?.epochs?.find(row => shadowHash(row.request) === shadowHash(request));
    if (retained) {
      if (explicit) materialize();
      const latest = observed.allocations.at(-1), grant = retained.grant.authorization;
      const authorizationStatus = retained !== observed.epochs.at(-1) ? "superseded"
        : Date.now() >= Math.min(grant.global_deadline_ms, grant.workflow_deadline_ms) ? "expired"
          : latest && latest.phase !== "closed" ? "resources_unresolved" : "active";
      return { status: "retained", authorization_status: authorizationStatus, epoch: retained.epoch, retained: true,
        written: false, native_started: false, journal_phase: latest?.phase ?? "absent" };
    }
    current(request);
    if (!explicit) return { status: "preview", written: false, native_started: false, request };
    if (!source || typeof source.read !== "function" || typeof source.verify !== "function") fail("NATIVE_EPOCH_AUTHENTICATED_SOURCE_REQUIRED");
    if (typeof sourceRef !== "string" || !sourceRef || sourceRef.length > 256) fail("NATIVE_EPOCH_SOURCE_REFERENCE_REQUIRED");
    const commit = async () => {
      let committing = false;
      try {
        current(request);
        const value = await source.read({ request, sourceRef });
        if (value === null) return { status: "WAITING", written: false, native_started: false, journal_phase: request.next_generation === 1 ? "absent" : "closed" };
        const grant = freezeShadow(structuredClone(value)); assertNativeEpochGrant(grant, request);
        const verified = await source.verify({ request, grant, sourceRef });
        if (verified?.outcome !== "verified" || verified.authority_id !== grant.authority_id || verified.grant_sha256 !== shadowHash(grant)
          || verified.evidence_class !== grant.closure.evidence_class) fail("NATIVE_EPOCH_SOURCE_NOT_AUTHENTICATED");
        const now = Date.now();
        if (grant.closure.observed_at_ms > now || now - grant.closure.observed_at_ms > 60000
          || grant.authorization.global_deadline_ms <= now + 30000 || grant.authorization.workflow_deadline_ms <= now + 30000) fail("NATIVE_EPOCH_FRESH_CLOSURE_REQUIRED");
        const before = current(request), journal = before.record;
        if (journal?.epochs?.some(row => row.grant.authority_id === grant.authority_id && row.grant.source_event_id === grant.source_event_id)) fail("NATIVE_EPOCH_SOURCE_REUSED");
        const { authentication, key_id, ...body } = journal ?? { journal_id: journalId, instance_id: configuration.instance_id,
          scope_id: request.scope_id, model_sha256: request.model_sha256, revision: 0, allocations: [] };
        const epoch = { epoch: request.epoch, start_generation: request.next_generation, request, grant };
        // CAS is the only activation point. All old allocations and grants are
        // retained verbatim; a competing reservation invalidates this prefix.
        committing = true;
        write({ ...body, contract_version: !journal || journal.contract_version === "native-allocation-journal.v3" ? "native-allocation-journal.v3" : "native-allocation-journal.v2", revision: body.revision + 1,
          initial_authorization: request.initial_authorization, origin_journal: Object.hasOwn(body, "origin_journal") ? body.origin_journal : journal,
          epochs: [...(body.epochs ?? []), epoch] }, before.content_sha256);
        return { status: "authorized", epoch: epoch.epoch, retained: false, written: true, native_started: false, journal_phase: request.next_generation === 1 ? "absent" : "closed" };
      } catch (error) { if (!committing) error.effect_status = "no_effect"; throw error; }
    };
    return processAuthority ? processAuthority.withNativeOwner({ instance_id: configuration.instance_id, epoch_request_sha256: shadowHash(request) }, commit) : commit();
  }
  return Object.freeze({ prepare, activate });
}
