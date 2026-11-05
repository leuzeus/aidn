import path from "node:path";
import { randomUUID } from "node:crypto";
import { createProjectAgenticProcessExecution } from "./agentic-process-execution-composition.mjs";
import { runOwnedAgenticProcess } from "./agentic-process-owned-run.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { createNativeAllocationJournalStore } from "../../adapters/runtime/native-allocation-journal-store.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { nativeJournalId, assertNativeCheckpointEvidence } from "../../core/workflow/native-allocation-journal.mjs";
import { createAgenticProcess, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { processParameterOptions } from "../../core/workflow/process-data-contracts.mjs";
import { agenticPolicyPins } from "../../core/workflow/agentic-process-model.mjs";
import { assertAgenticProcessStart } from "../../core/workflow/agentic-process-start.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createProcessControlInboxStore } from "../../adapters/runtime/process-control-inbox-store.mjs";
import { readNativeAllocationCheckpoint, readNativeAllocationHistory, verifyNativeResultEvidence, nativeAllocationOutputId, assertNativeAllocationProjection } from "./native-allocation-evidence.mjs";
import { createNativeAllocationControls, readNativeControlContext } from "./native-allocation-controls.mjs";
import { createNativeAuthorizationEpochs } from "./native-authorization-epochs.mjs";
import { effectiveNativeEpochAuthorization } from "../../core/workflow/native-authorization-epoch.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const limitKeys = ["configuration_sha256", "authorized_at_ms", "global_deadline_ms", "workflow_deadline_ms", "max_turn_ms", "max_responses", "max_bytes"];
const limitsOf = auth => Object.fromEntries(limitKeys.map(key => [key, auth[key]]));
const json = file => { const data = readAgentRunFile(file, { json: false, maxBytes: 262144 }); return { value: JSON.parse(data.value.toString("utf8")), sha256: data.sha256 }; };
// The controller and RPC seams belong to the trusted embedding, never authored
// configuration. The observer only denies launches or retains actual observations;
// it cannot replace the worker's assignment/result or termination verdicts.
export function createJournaledNativeAllocation({ configuration, readSigningKey, environment = process.env, controlSource, processAuthority, nativeAuthorizationSource }, { controllerFactory } = {}) {
  if (checkShadowJson(configuration)) fail("NATIVE_ALLOCATION_CONFIGURATION_INVALID");
  const config = structuredClone(configuration), configurationSha = shadowHash(config);
  const executor = createProjectAgenticProcessExecution(config, { environment, processAuthority }), preview = executor.preview();
  const model = json(config.model.path).value;
  if (model.contract_version !== "agentic-process-model.v2") fail("NATIVE_ALLOCATION_PROFILE_UNSUPPORTED");
  const initial = readWorkflowProjectAuthority({ targetRoot: config.target_root }), signer = createOperationJournalSigner(readSigningKey);
  const options = { targetRoot: config.target_root, stateMode: initial.stateMode, env: environment };
  const store = createNativeAllocationJournalStore(options), instances = createAgenticProcessStore(options);
  const controlRecords = createProcessControlInboxStore(options);
  const journalId = nativeJournalId({ instance_id: config.instance_id, scope_id: preview.scope_id });
  const projectionRequired = initial.stateMode === "dual" || initial.stateMode === "files" && preview.persistence.backend === "postgres";
  function observe() {
    const current = executor.preview();
    if (current.scope_id !== preview.scope_id || current.model_sha256 !== preview.model_sha256) fail("NATIVE_ALLOCATION_AUTHORITY_CHANGED");
    const value = store.read(journalId);
    if (value.record) {
      signer.verify(value.record);
      if (value.record.origin_journal) signer.verify(value.record.origin_journal);
      if (value.record.instance_id !== config.instance_id || value.record.scope_id !== current.scope_id || value.record.model_sha256 !== current.model_sha256) fail("NATIVE_ALLOCATION_SCOPE_CHANGED");
    }
    return { value, current };
  }
  const read = () => observe().value;
  function write(body, before) {
    const record = signer.seal(body); store.compareAndSwap(record, before);
    if (projectionRequired) store.materialize(journalId, { write: true });
    return record;
  }
  function checkpoint(entry) {
    return readNativeAllocationCheckpoint(entry, config, { scopeId: preview.scope_id, modelSha256: preview.model_sha256 });
  }
  function authenticatedCurrent(checkContext = false) {
    const journal = read().record, entry = journal?.allocations.at(-1), current = instances.read(config.instance_id).record;
    if (processAuthority && current) {
      processAuthority.authenticate(current, { productSha256: executor.preview().product_sha256, checkControlContext: checkContext, forNative: checkContext });
      return current;
    }
    if (!entry || !current) fail("NATIVE_ALLOCATION_CHECKPOINT_UNAVAILABLE");
    readNativeAllocationHistory({ journal, entry, current, configuration: config, signer, controls: controlRecords,
      ...(checkContext ? { controlContext: () => readNativeControlContext(config, executor.preview().product_sha256) } : {}) });
    return current;
  }
  function initialCurrent() {
    const current = instances.read(config.instance_id).record, actual = executor.preview();
    const creation = { instanceId: config.instance_id, model, scopeId: actual.scope_id, policyPins: agenticPolicyPins(model), facts: {}, ...processParameterOptions(current ?? {}) };
    const result = current ?? createAgenticProcess(creation);
    if (processAuthority) processAuthority.authenticate(result, { productSha256: actual.product_sha256, checkControlContext: true, forNative: true });
    else assertAgenticProcessStart(current, creation);
    return result;
  }
  const controls = createNativeAllocationControls({ configuration: config, signer, options, projectionRequired, source: controlSource, store: instances,
    readCurrent: authenticatedCurrent, readAuthority: () => ({ scope_id: executor.preview().scope_id, model_sha256: preview.model_sha256, policy_pins: agenticPolicyPins(model) }),
    preview: () => executor.preview() });
  function totals(record) {
    const entries = record?.allocations ?? [];
    if (entries.some(entry => entry.phase !== "closed" || !entry.consumption)) return { known: false, responses: null, bytes: null };
    return { known: true, responses: entries.reduce((sum, entry) => sum + entry.consumption.responses_observed, 0),
      bytes: entries.reduce((sum, entry) => sum + entry.consumption.storage_debit_bytes, 0) };
  }
  const epochs = createNativeAuthorizationEpochs({ configuration: config, signer, read, write, checkpoint, authenticatedCurrent, initialCurrent, journalId,
    preview: () => executor.preview(), source: nativeAuthorizationSource, processAuthority,
    materialize: () => { if (projectionRequired) store.materialize(journalId, { write: true }); } });
  return Object.freeze({
    // Journal and description belong to the same fresh executor observation.
    // Later calls still re-read activation, pins, product and signed journal.
    preview() { const { value, current } = observe(); return { ...current, journal_id: journalId, journal_sha256: value.record ? shadowHash(value.record) : null,
      generation: value.record?.allocations.length ?? 0, phase: value.record?.allocations.at(-1)?.phase ?? "absent", consumption: totals(value.record), native_started: false, written: false }; },
    inspect() { const value = read(); return value.record ? structuredClone(value.record) : null; },
    prepareControl: controls.prepare, captureControl: controls.capture, deliverControl: controls.deliver, readControl: controls.read,
    prepareAuthorizationEpoch: epochs.prepare, activateAuthorizationEpoch: epochs.activate,
    readCheckpoint(generation) {
      const record = read().record, entry = record?.allocations.find(row => row.generation === generation);
      if (!entry) fail("NATIVE_ALLOCATION_GENERATION_UNAVAILABLE");
      return structuredClone(checkpoint(entry));
    },
    async run({ execute = false, authorization, signal, resume = false } = {}) {
      if (typeof resume !== "boolean") fail("NATIVE_ALLOCATION_RESUME_INTENT_REQUIRED");
      if (!execute) return this.preview();
      const before = read(), previous = before.record?.allocations.at(-1), consumed = totals(before.record);
      if (previous && previous.phase !== "closed") fail(previous.phase === "failed" ? "NATIVE_ALLOCATION_TERMINAL_FAILURE" : "NATIVE_ALLOCATION_RECONCILIATION_REQUIRED");
      let resumeSha = null;
      if (processAuthority) {
        const record = instances.read(config.instance_id).record;
        if (record) {
          authenticatedCurrent(true); const cursor = inspectAgenticProcess(record);
          if (cursor.ready.some(id => model.nodes.find(node => node.id === cursor.occurrences.find(frame => frame.occurrence_id === id)?.node_id)?.kind === "operation"))
            return { status: "WAITING_FOR_OPERATION", written: false, native_started: false, retry: false };
          if (!cursor.ready.length || ["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status)) return { status: cursor.status, written: false, native_started: false, retry: false };
          await processAuthority.admitReadyDriftDiagnosis(record);
        }
      }
      if (resume) {
        if (!previous) fail("NATIVE_ALLOCATION_RESUME_HISTORY_REQUIRED");
        const current = authenticatedCurrent(true), cursor = inspectAgenticProcess(current); resumeSha = current.instance_sha256;
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(cursor.status) || !cursor.ready.length) return { contract_version: "journaled-native-allocation-result.v1",
          status: cursor.status, journal_id: journalId, journal_phase: previous.phase, generation: previous.generation, written: false, native_started: false, retry: false };
      }
      if (!consumed.known) fail("NATIVE_ALLOCATION_CONSUMPTION_UNKNOWN");
      if (before.record?.allocations.length >= 32) fail("NATIVE_ALLOCATION_GENERATION_LIMIT");
      let auth = structuredClone(authorization);
      if (checkShadowJson(auth) || auth?.approved !== true || auth.model_allowed !== true || auth.configuration_sha256 !== configurationSha) fail("PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED");
      if (before.record?.epochs) auth = effectiveNativeEpochAuthorization(before.record, auth);
      else if (previous) {
        const ceiling = before.record.allocations[0].limits;
        if (["max_responses", "max_bytes", "max_turn_ms", "global_deadline_ms", "workflow_deadline_ms"].some(key => auth[key] > ceiling[key])) fail("NATIVE_ALLOCATION_LIMIT_INCREASE_UNAUTHORIZED");
        auth.max_responses -= consumed.responses; auth.max_bytes -= consumed.bytes;
      }
      if (!Number.isSafeInteger(auth.max_responses) || auth.max_responses < 1 || !Number.isSafeInteger(auth.max_bytes) || auth.max_bytes < 1048576) fail("NATIVE_ALLOCATION_BUDGET_EXHAUSTED");
      let claim = null, observed = null;
      const observer = {
        beforeLaunch({ preview: actual }) {
          const now = read();
          if (now.content_sha256 !== before.content_sha256 || actual.scope_id !== preview.scope_id || actual.model_sha256 !== preview.model_sha256) fail("NATIVE_ALLOCATION_REVISION_CHANGED");
          const canonical = instances.read(config.instance_id).record;
          const creation = { instanceId: config.instance_id, model, scopeId: actual.scope_id, policyPins: agenticPolicyPins(model), facts: {}, ...processParameterOptions(canonical ?? {}) };
          if (processAuthority) {
            if (canonical) authenticatedCurrent(true);
            assertNativeAllocationProjection(canonical, config, projectionRequired);
          } else if (resume) {
            if (authenticatedCurrent(true).instance_sha256 !== resumeSha || canonical?.instance_sha256 !== resumeSha) fail("NATIVE_ALLOCATION_HISTORY_CHANGED");
            assertNativeAllocationProjection(canonical, config, projectionRequired);
          } else assertAgenticProcessStart(canonical, creation);
          const entry = { generation: (now.record?.allocations.length ?? 0) + 1, owner_id: randomUUID(), configuration_sha256: configurationSha,
            authorization_sha256: shadowHash(auth), initial_instance_sha256: canonical?.instance_sha256 ?? createAgenticProcess(creation).instance_sha256,
            limits: limitsOf(auth), phase: "reserved", owned_result_sha256: null, tree_proof_sha256: null, tree_closed: false, owned_status: null,
            first_failure: null, checkpoint: null, closure_ref: null, consumption: null };
          const body = { contract_version: now.record?.contract_version ?? "native-allocation-journal.v1", journal_id: journalId, instance_id: config.instance_id, scope_id: actual.scope_id,
            ...(now.record?.epochs ? { initial_authorization: now.record.initial_authorization, origin_journal: now.record.origin_journal, epochs: now.record.epochs } : {}),
            model_sha256: actual.model_sha256, revision: (now.record?.revision ?? 0) + 1, allocations: [...(now.record?.allocations ?? []), entry] };
          write(body, now.content_sha256); claim = entry;
          return { generation: entry.generation, owner_id: entry.owner_id, output_id: nativeAllocationOutputId(config.instance_id, entry.generation) };
        },
        workerInput(allocation) {
          const current = read().record; signer.verify(current);
          if (current.allocations.at(-1).owner_id !== allocation.owner_id) fail("NATIVE_ALLOCATION_OWNER_CHANGED");
          return { contract_version: processAuthority ? "native-allocation-worker.v2" : "native-allocation-worker.v1", journal_id: journalId, generation: allocation.generation,
            owner_id: allocation.owner_id, key_base64: readSigningKey().toString("base64"), ...(processAuthority ? { model_source: processAuthority.modelSource } : {}) };
        },
        afterClosure({ allocation, result }) {
          observed = structuredClone(result);
          const now = read(), last = now.record?.allocations.at(-1);
          if (!last || last.phase !== "reserved" || last.generation !== allocation?.generation || last.owner_id !== allocation.owner_id) fail("NATIVE_ALLOCATION_OWNER_CHANGED");
          const entry = { ...last, owned_result_sha256: shadowHash(result), tree_proof_sha256: shadowHash(result.process_tree),
            tree_closed: result.process_tree?.termination_state === "confirmed" && result.process_tree?.termination_proof?.active_processes === 0,
            owned_status: result.status, first_failure: result.first_failure ?? null };
          entry.phase = !entry.tree_closed ? "unresolved" : result.status === "FAILED" || entry.first_failure ? "failed" : "closed";
          try {
            const outputId = nativeAllocationOutputId(config.instance_id, entry.generation);
            const closurePath = path.join(config.control_root, `${outputId}-CLOSURE.json`), closure = json(closurePath);
            if (shadowHash(closure.value) !== shadowHash(result)) fail("NATIVE_ALLOCATION_CLOSURE_CHANGED");
            entry.closure_ref = { path: closurePath, sha256: closure.sha256 };
            const worker = result.worker_result, ref = worker?.native_checkpoint;
            const match = ref && new RegExp("^execution/" + outputId + "/([0-9]{5}-native-host-state\\.json)$").exec(ref.ref);
            if (!match) fail("NATIVE_ALLOCATION_CHECKPOINT_UNAVAILABLE");
            const file = path.join(config.control_root, outputId, match[1]), data = json(file);
            if (data.sha256 !== ref.sha256) fail("NATIVE_ALLOCATION_EVIDENCE_CHANGED");
            assertNativeCheckpointEvidence(data.value, { instanceId: config.instance_id, scopeId: preview.scope_id, modelSha256: preview.model_sha256,
              authorizationSha256: last.authorization_sha256, limits: last.limits });
            verifyNativeResultEvidence(data.value.state, config, entry.generation);
            const current = instances.read(config.instance_id).record;
            if (!current || current.instance_sha256 !== data.value.state.instance.instance_sha256 || worker.instance_sha256 !== current.instance_sha256
              || worker.responses_observed !== data.value.responses_observed) fail("NATIVE_ALLOCATION_CANONICAL_CHANGED");
            entry.checkpoint = { path: file, sha256: data.sha256, state_sha256: shadowHash(data.value.state), instance_sha256: current.instance_sha256 };
            const workerFooter = readAgentRunFile(path.join(config.control_root, outputId, "RESULT.json"), { json: false, maxBytes: 131072 });
            if (!Number.isSafeInteger(worker.storage_budget_debit_bytes) || worker.storage_budget_debit_bytes < 0) fail("NATIVE_ALLOCATION_CONSUMPTION_UNKNOWN");
            entry.consumption = { responses_observed: data.value.responses_observed, response_sha256: data.value.response_sha256,
              storage_debit_bytes: worker.storage_budget_debit_bytes + workerFooter.value.length + readAgentRunFile(closurePath, { json: false, maxBytes: 131072 }).value.length,
              native_usage_sha256: data.value.state.native_usage === null ? null : shadowHash(data.value.state.native_usage) };
            if (entry.phase === "closed" && (!data.value.state.parent_closed || !worker.native_parent_closure?.closed)) fail("NATIVE_ALLOCATION_PARENT_UNCONFIRMED");
            if (worker.status === "COMPLETED" && inspectAgenticProcess(current).status !== "COMPLETED") fail("NATIVE_ALLOCATION_CANONICAL_CHANGED");
          } catch (error) { if (entry.phase === "closed") entry.phase = "unresolved"; entry.first_failure ??= error.code ?? "NATIVE_ALLOCATION_OBSERVATION_UNCONFIRMED"; }
          const { authentication, key_id, ...body } = now.record;
          write({ ...body, revision: body.revision + 1, allocations: [...body.allocations.slice(0, -1), entry] }, now.content_sha256);
        },
      };
      const executeAllocation = async () => { try {
        const result = await runOwnedAgenticProcess({ configuration: config, authorization: auth, execute: true, signal },
          { environment, allocationObserver: observer, processAuthority, ...(controllerFactory ? { controllerFactory } : {}) });
        const record = read().record;
        const last = record?.allocations.at(-1), phase = last?.phase ?? "absent";
        return { contract_version: "journaled-native-allocation-result.v1", owned_result: result, journal_id: journalId,
          generation: claim?.generation ?? null, journal_phase: phase, journal_sha256: record ? shadowHash(record) : null,
          status: phase === "closed" ? result.status : phase === "failed" ? "FAILED" : "WAITING_FOR_RECONCILIATION",
          first_failure: last?.first_failure ?? result.first_failure, retry: false };
      } catch (error) {
        if (!claim) { if (processAuthority) error.effect_status = "no_effect"; throw error; }
        return { contract_version: "journaled-native-allocation-result.v1", owned_result: observed, journal_id: journalId, generation: claim.generation,
          journal_phase: "reconciliation_required", status: "WAITING_FOR_RECONCILIATION", first_failure: error.code ?? "NATIVE_ALLOCATION_UNCONFIRMED", retry: false };
      } };
      return processAuthority ? processAuthority.withNativeOwner({ instance_id: config.instance_id, authorization_sha256: shadowHash(auth) }, executeAllocation) : executeAllocation();
    },
  });
}
