import { randomUUID } from "node:crypto";
import { createStandardWorkflowOperations, standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { agenticProcessPersistence } from "./agentic-process-persistence.mjs";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../../adapters/runtime/process-operation-journal-store.mjs";
import { createProcessDecisionInboxStore } from "../../adapters/runtime/process-decision-inbox-store.mjs";
import { createStandardHumanDecisions } from "./standard-workflow-human-decisions.mjs";
import { assertAgenticProcessModel, agenticPolicyPins, processId } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, freezeShadow } from "../../core/workflow/shadow-json.mjs";
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from "../../core/workflow/process-operation-journal.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import previewSchema from "../../core/contracts/workflow-definition/standard-operation-preview.v1.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const receiptId = id => "receipt_" + id.slice(3);
// Fixed local business adapters plus the common reducer/store. This host owns
// neither model routing nor human decisions. Signing/authorization capabilities
// must come from a trusted outer host, never authored JSON or a model tool.
export function createStandardWorkflowOperationHost({ targetRoot, model: suppliedModel, readSigningKey, authorize, humanSource, now = Date.now }) {
  const model = freezeShadow(structuredClone(suppliedModel)); assertAgenticProcessModel(model);
  if (model.contract_version !== "agentic-process-model.v2" || typeof authorize !== "function") fail("STANDARD_HOST_CONFIGURATION_INVALID");
  const operations = createStandardWorkflowOperations({ targetRoot, now }), artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const bindings = new Map(standardWorkflowOperationBindings().map(value => [value.id, value]));
  for (const node of model.nodes.filter(node => node.kind === "operation"))
    if (!bindings.has(node.binding_ref) || model.operation_pins[node.binding_ref] !== shadowHash(bindings.get(node.binding_ref))) fail("STANDARD_HOST_BINDING_CHANGED");
  const signer = createOperationJournalSigner(readSigningKey), generation = randomUUID(), initial = readWorkflowProjectAuthority({ targetRoot });
  const options = { targetRoot, stateMode: initial.stateMode }, store = createAgenticProcessStore(options), journal = createProcessOperationJournalStore(options);
  const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: humanSource,
    projectionRequired: initial.stateMode === "dual" || initial.stateMode === "files" && agenticProcessPersistence({ targetRoot }).backend === "postgres" });
  function readAuthority() {
    const project = readWorkflowProjectAuthority({ targetRoot }), persistence = agenticProcessPersistence({ targetRoot });
    if (project.stateMode !== initial.stateMode) fail("STANDARD_HOST_STATE_MODE_CHANGED");
    return { scope_id: shadowHash({ project: project.scope, persistence: persistence.binding_sha256,
      operation_host: { version: 1, state_mode: project.stateMode, key_id: signer.keyId } }), model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) };
  }
  function scope(instance) {
    const authority = readAuthority();
    if (instance.scope_id !== authority.scope_id || instance.model_sha256 !== authority.model_sha256
      || shadowHash(instance.policy_pins) !== shadowHash(authority.policy_pins)) fail("STANDARD_HOST_AUTHORITY_CHANGED");
  }
  function snapshot() {
    return { context: operations.observeScope(), documents: ["CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", "baseline/current.md", "snapshots/context-snapshot.md"]
      .map(path => { const row = artifacts.read(path, { required: true }); return { path, sha256: row.sha256 }; }) };
  }
  function validatePreview(preview) {
    if (validateJsonSchema(preview, previewSchema, "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_HOST_PREVIEW_INVALID");
    signer.verify(preview); assertProcessOperationBinding(preview.binding); assertStandardOperationInput(preview.binding.id, preview.input);
    if (shadowHash(bindings.get(preview.binding.id)) !== shadowHash(preview.binding)) fail("STANDARD_HOST_BINDING_CHANGED");
    return preview;
  }
  function retained(id) {
    const value = journal.read(id);
    if (!value.record) fail("PROCESS_JOURNAL_NOT_FOUND");
    signer.verify(value.record); validatePreview(value.record.preview);
    if (value.record.intent.binding_ref === "mode_decision" && value.record.results.length) human.captured(value.record);
    return value;
  }
  function persist(body, expected) {
    const record = signer.seal(body), result = journal.compareAndSwap(record, expected);
    if (result.projection === "pending") {
      try { journal.materialize(record.operation_id, { write: true }); }
      catch { fail("PROCESS_JOURNAL_PROJECTION_RECONCILIATION_REQUIRED"); }
    }
    return record;
  }
  async function grantFor(preview, signal) {
    if (["read-only", "preview"].includes(preview.binding.effect_class)) return null;
    const controller = new AbortController(); let timer;
    const pending = Promise.resolve().then(() => authorize({ binding: structuredClone(preview.binding), input: structuredClone(preview.input),
      preview_sha256: shadowHash(preview), prepared: structuredClone(preview.prepared), scope_id: preview.scope_id, signal: signal ?? controller.signal }));
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("STANDARD_HOST_AUTHORIZATION_TIMEOUT"), { code: "STANDARD_HOST_AUTHORIZATION_TIMEOUT" })); }, 5000); });
    let grant;
    try { grant = await Promise.race([pending, timeout]); } finally { clearTimeout(timer); controller.abort(); }
    if (!grant || Object.keys(grant).sort().join(",") !== "authority_id,authorized,grant_sha256,principal_sha256" || grant.authorized !== true
      || !processId(grant.authority_id) || ![grant.principal_sha256, grant.grant_sha256].every(value => /^[a-f0-9]{64}$/.test(value))) fail("STANDARD_HOST_AUTHORIZATION_REQUIRED");
    return grant;
  }
  async function verifyGrant(record, signal) {
    if (shadowHash(await grantFor(record.preview, signal)) !== shadowHash(record.grant)) fail("STANDARD_HOST_AUTHORIZATION_CHANGED");
  }
  let service;
  const authority = {
    prepare({ instance, occurrence }) {
      const record = retained(operationJournalId(instance, occurrence.occurrence_id)).record;
      if (record.phase !== "staged" || record.intent.instance_sha256 !== instance.instance_sha256) fail("PROCESS_OPERATION_INTENT_BINDING_CHANGED");
      return { binding: record.preview.binding, intent: record.intent };
    },
    async verifyIntent({ intent, binding, instance, signal }) {
      scope(instance); const record = retained(intent.operation_id).record; await verifyGrant(record, signal);
      if (shadowHash(intent) !== shadowHash(record.intent) || shadowHash(binding) !== shadowHash(record.preview.binding)) fail("PROCESS_OPERATION_INTENT_NOT_AUTHENTICATED");
      return { outcome: "verified", authority_id: intent.authority_id, intent_sha256: shadowHash(intent), binding_sha256: shadowHash(binding) };
    },
    readReceipt({ receipt_id, intent }) {
      const record = retained(intent.operation_id).record, result = record.results.at(-1);
      if (record.phase !== "receipted" || result?.receipt.receipt_id !== receipt_id || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RECEIPT_UNAVAILABLE");
      return result.receipt;
    },
    async verifyReceipt({ receipt, intent, instance, signal }) {
      scope(instance); const record = retained(intent.operation_id).record; await verifyGrant(record, signal);
      if (record.intent.binding_ref === "mode_decision") await human.verifyCaptured(record, signal);
      if (shadowHash(record.results.at(-1)?.receipt) !== shadowHash(receipt) || shadowHash(record.intent) !== shadowHash(intent)) fail("PROCESS_OPERATION_RESULT_NOT_AUTHENTICATED");
      return { outcome: "verified", authority_id: receipt.authority_id, receipt_sha256: shadowHash(receipt), intent_sha256: shadowHash(intent) };
    },
  };
  service = createAgenticProcessService({ store, readAuthority, operationAuthority: authority, authorityTimeoutMs: 5000 });
  const current = id => {
    const value = service.inspect(id); scope(value.record);
    if (Object.keys(value.record.initial_facts).length) fail("STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED");
    // Replay proves structure, not origin. Reopening a host must authenticate
    // every earlier operation result against its durable host journal as well.
    const seen = new Map();
    for (const event of value.record.events) {
      if (["facts", "message", "control", "assign", "result"].includes(event.kind)) fail("STANDARD_HOST_HISTORY_AUTHORITY_REQUIRED");
      const id = event.kind === "operation_intent" ? event.intent.operation_id : event.kind === "operation_result" ? event.receipt.operation_id : null;
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, retained(id).record);
      const record = seen.get(id);
      if (event.kind === "operation_intent" && shadowHash(event.intent) !== shadowHash(record.intent)
        || event.kind === "operation_result" && !record.results.some(result => shadowHash(result.receipt) === shadowHash(event.receipt))) fail("STANDARD_HOST_RESULT_HISTORY_NOT_AUTHENTICATED");
    }
    return value;
  };
  function requireWrite(write, expected, actual) { if (write !== true || expected !== actual) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED"); }
  function decisionInput(instance, input) {
    const latest = instance.events.filter(event => event.kind === "operation_intent" && event.intent.binding_ref === "mode_decision").at(-1);
    if (!latest || latest.intent.operation_id !== input.decision_operation_id) fail("STANDARD_MODE_DECISION_REQUIRED");
    const record = retained(input.decision_operation_id).record, receipt = record.results.at(-1)?.receipt;
    if (receipt?.outcome !== "completed" || !instance.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt))) fail("STANDARD_MODE_DECISION_NOT_ACCEPTED");
    const source = human.captured(record).source;
    if (!["THINKING", "EXPLORING", "COMMITTING"].includes(source.choice)) fail("STANDARD_MODE_DECISION_REQUIRED");
    if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_MODE_DECISION_STALE");
    return { session_id: record.preview.input.session_id, mode: source.choice };
  }
  function resultReceipt(record, output) {
    assertStandardOperationOutput(output);
    return { contract_version: "process-operation-receipt.v1", receipt_id: receiptId(record.operation_id), operation_id: record.operation_id,
      intent_sha256: shadowHash(record.intent), authority_id: record.intent.authority_id, outcome: output.outcome, effect_status: output.effect_status,
      output_sha256: shadowHash(output), facts: output.facts,
      // Physical proof filenames belong to the authenticated output document.
      // The reducer receipt carries its bounded logical reference, not a second
      // copy constrained by the receipt URI grammar.
      evidence_refs: [{ ref: operationOutputRef(record.operation_id), sha256: shadowHash(output) }] };
  }
  async function commitIntent(id, { write = false } = {}) {
    if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
    const record = retained(id).record, state = current(record.intent.instance_id);
    const existing = state.record.events.find(event => event.kind === "operation_intent" && event.intent.operation_id === id);
    if (existing) {
      if (shadowHash(existing.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_INTENT_CHANGED");
      return state;
    }
    if (record.phase !== "staged" || state.record.instance_sha256 !== record.intent.instance_sha256
      || shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
    return service.prepareOperation({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256,
      occurrenceId: record.intent.occurrence_id, eventId: "intent_" + id.slice(3), write: true });
  }
  return Object.freeze({
    initialize(input) {
      if (input.facts && Object.keys(input.facts).length) fail("STANDARD_HOST_AUTHENTICATED_FACTS_REQUIRED");
      return service.initialize({ ...input, model, facts: {} });
    },
    inspect: id => current(id),
    async preview({ instanceId, expectedSha256, occurrenceId, input = {} }) {
      const state = current(instanceId);
      if (state.record.instance_sha256 !== expectedSha256) fail("PROCESS_REVISION_CONFLICT");
      const occurrence = state.cursor.occurrences.find(row => row.occurrence_id === occurrenceId);
      const node = occurrence && model.nodes.find(row => row.id === occurrence.node_id), binding = bindings.get(node?.binding_ref);
      if (!binding || !(occurrence.status === "READY" || occurrence.status === "WAITING" && ["blocked", "deferred"].includes(occurrence.operation?.receipt?.outcome))) fail("PROCESS_OPERATION_ORDER_INVALID");
      assertStandardOperationInput(binding.id, input);
      const prepared = binding.id === "session_initialize" ? await operations.prepareSession(input)
        : binding.id === "session_mode_apply" ? await operations.prepareMode(decisionInput(state.record, input))
        : binding.id === "session_start_finalize" ? await operations.prepareStart(input) : null;
      return signer.seal({ contract_version: "standard-operation-preview.v1", instance_id: instanceId, instance_sha256: expectedSha256,
        scope_id: state.record.scope_id, model_sha256: state.record.model_sha256, occurrence_id: occurrenceId, binding,
        input: binding.id === "session_initialize" ? prepared?.plan?.input ?? input : input, prepared, snapshot: snapshot(), prepared_at_ms: now() });
    },
    async stage(preview, { write = false, expectedPreviewSha256 } = {}) {
      preview = structuredClone(preview);
      validatePreview(preview); requireWrite(write, expectedPreviewSha256, shadowHash(preview));
      const state = current(preview.instance_id), age = now() - preview.prepared_at_ms;
      if (!Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_HOST_PREVIEW_EXPIRED");
      if (state.record.instance_sha256 !== preview.instance_sha256 || shadowHash(snapshot()) !== shadowHash(preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      const grant = await grantFor(preview), id = operationJournalId(state.record, preview.occurrence_id);
      const intent = { contract_version: "process-operation-intent.v1", operation_id: id, binding_ref: preview.binding.id, binding_sha256: shadowHash(preview.binding),
        input_sha256: shadowHash(preview.input), preconditions_sha256: shadowHash({ snapshot: preview.snapshot, prepared: preview.prepared }),
        authorization_sha256: grant === null ? null : shadowHash(grant), authority_id: "standard_operation_host", scope_id: preview.scope_id,
        instance_id: preview.instance_id, instance_sha256: preview.instance_sha256, model_sha256: preview.model_sha256,
        occurrence_id: preview.occurrence_id, instance_revision: state.record.revision };
      const previous = journal.read(id);
      if (previous.record) {
        signer.verify(previous.record);
        if (shadowHash(previous.record.preview) !== shadowHash(preview) || shadowHash(previous.record.intent) !== shadowHash(intent)) fail("PROCESS_JOURNAL_ALREADY_STAGED");
      } else persist({ contract_version: "process-operation-journal.v1", operation_id: id, revision: 1, phase: "staged", preview,
        intent, grant, owner: null, results: [] }, null);
      const result = await commitIntent(id, { write: true });
      return { ...result, operation_id: id };
    },
    commitIntent,
    async dispatch(id, { write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      if (record.phase === "receipted") return { status: "retained_result", receipt: record.results.at(-1).receipt };
      if (record.phase !== "staged") return { status: "reconciliation_required", operation_id: id };
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      if (frame?.status !== "WAITING" || !frame.operation || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_CANONICAL_INTENT_REQUIRED");
      if (record.preview.binding.executor_kind === "human") return { status: "waiting_for_human", question: human.question(record) };
      await verifyGrant(record);
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      const { authentication, key_id, ...body } = record;
      const claimed = persist({ ...body, phase: "dispatching", revision: record.revision + 1, owner: { generation, pid: process.pid } }, before.content_sha256);
      let output;
      try {
        if (current(record.intent.instance_id).record.instance_sha256 !== state.record.instance_sha256)
          throw Object.assign(new Error("STANDARD_HOST_PROCESS_CHANGED"), { code: "STANDARD_HOST_PROCESS_CHANGED", effect_status: "no_effect" });
        if (record.intent.binding_ref === "context_reload") output = await operations.reload(record.preview.input);
        else if (record.intent.binding_ref === "session_admit") output = await operations.admitSession(record.preview.input);
        else if (!record.preview.prepared?.can_apply) output = { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: "blocked", effect_status: "no_effect", facts: {}, observations: record.preview.prepared ?? {}, evidence_refs: [] };
        else if (record.intent.binding_ref === "session_initialize") output = await operations.initializeSession(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        else if (record.intent.binding_ref === "session_mode_apply") {
          if (shadowHash(decisionInput(state.record, record.preview.input)) !== shadowHash(record.preview.prepared.plan.input)) fail("STANDARD_MODE_DECISION_CHANGED");
          output = await operations.applyMode(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        } else output = await operations.finalizeStart(record.preview.prepared, { write: true, expectPlan: record.preview.prepared.plan_sha256 });
        if (record.preview.binding.effect_class === "read-only" && shadowHash(snapshot()) !== shadowHash(record.preview.snapshot))
          throw Object.assign(new Error("STANDARD_HOST_PRECONDITIONS_CHANGED"), { effect_status: "no_effect" });
      } catch (cause) {
        const noEffect = record.preview.binding.effect_class === "read-only" || cause.effect_status === "no_effect" || cause.code === "STANDARD_PLAN_EXPIRED";
        output = { contract_version: record.preview.binding.output_contract, operation_ref: record.intent.binding_ref,
          outcome: noEffect ? "blocked" : "reconciliation_required", effect_status: noEffect ? "no_effect" : "unknown", facts: {},
          observations: { reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? "") ? cause.code : "STANDARD_HOST_DISPATCH_UNCONFIRMED" }, evidence_refs: [] };
      }
      const receipt = resultReceipt(record, output);
      const retainedClaim = retained(id);
      if (shadowHash(retainedClaim.record) !== shadowHash(claimed)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const { authentication: oldMac, key_id: oldKey, ...claimedBody } = claimed;
      persist({ ...claimedBody, phase: "receipted", revision: claimed.revision + 1, results: [{ output, receipt }] }, retainedClaim.content_sha256);
      return { status: "receipted", receipt };
    },
    async receiveDecision(id, { sourceRef, write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const before = retained(id), record = before.record, state = current(record.intent.instance_id);
      if (record.preview.binding.executor_kind !== "human" || record.intent.binding_ref !== "mode_decision") fail("PROCESS_HUMAN_OPERATION_REQUIRED");
      if (record.phase === "receipted") {
        const capture = human.captured(record);
        if (capture.source_ref !== sourceRef) fail("PROCESS_HUMAN_DECISION_ALREADY_CAPTURED");
        human.acknowledge(capture.inbox_id, record.results.at(-1).receipt);
        return { status: "retained_result", receipt: record.results.at(-1).receipt };
      }
      const frame = state.cursor.occurrences.find(row => row.occurrence_id === record.intent.occurrence_id);
      if (frame?.status !== "WAITING" || !frame.operation || frame.operation.receipt || shadowHash(frame.operation.intent) !== shadowHash(record.intent)) fail("STANDARD_HOST_CANONICAL_INTENT_REQUIRED");
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      const capture = await human.reserve(record, sourceRef);
      if (!capture) return { status: "waiting_for_human", question: human.question(record) };
      if (shadowHash(snapshot()) !== shadowHash(record.preview.snapshot)) fail("STANDARD_HOST_PRECONDITIONS_CHANGED");
      const { authentication, key_id, ...body } = record;
      const claimed = record.phase === "staged" ? persist({ ...body, phase: "dispatching", revision: record.revision + 1, owner: { generation, pid: process.pid } }, before.content_sha256) : record;
      const output = human.output(claimed, capture), receipt = resultReceipt(claimed, output), latest = retained(id);
      if (shadowHash(latest.record) !== shadowHash(claimed)) fail("PROCESS_JOURNAL_OWNER_CHANGED");
      const { authentication: oldMac, key_id: oldKey, ...claimedBody } = claimed;
      persist({ ...claimedBody, phase: "receipted", revision: claimed.revision + 1, results: [{ output, receipt }] }, latest.content_sha256);
      human.acknowledge(capture.inbox_id, receipt);
      return { status: "receipted", receipt };
    },
    async accept(id, { write = false } = {}) {
      if (write !== true) fail("STANDARD_HOST_EXPLICIT_WRITE_REQUIRED");
      const record = retained(id).record, state = current(record.intent.instance_id);
      const receipt = record.results.at(-1)?.receipt;
      if (!receipt) fail("PROCESS_OPERATION_RECEIPT_UNAVAILABLE");
      return service.acceptOperation({ instanceId: state.record.instance_id, expectedSha256: state.record.instance_sha256, occurrenceId: record.intent.occurrence_id,
        eventId: "result_" + id.slice(3), receiptId: receipt.receipt_id, write: true });
    },
    readJournal: id => structuredClone(retained(id).record),
    readDecisionSource: ref => human.readSource(ref),
    readOutput(ref) {
      const match = /^aidn:operation-output\/(op_[a-f0-9]{40})\/(0|[1-9][0-9]?)$/.exec(ref);
      if (!match || Number(match[2]) >= 32) fail("PROCESS_JOURNAL_OUTPUT_REF_INVALID");
      const result = retained(match[1]).record.results[Number(match[2])];
      if (!result) fail("PROCESS_JOURNAL_OUTPUT_UNAVAILABLE");
      return structuredClone(result.output);
    },
  });
}
