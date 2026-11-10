import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readAgentRunFile, agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { assertOperationJournal, operationJournalId } from "../../core/workflow/process-operation-journal.mjs";
import { assertProcessOperationIntent, assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { assertDecisionInbox } from "../../core/workflow/process-decision-inbox.mjs";
import { assertControlInbox } from "../../core/workflow/process-control-inbox.mjs";
import { assertNativeAllocationJournal } from "../../core/workflow/native-allocation-journal.mjs";
import { assertAgenticProcessInstance, agenticProcessPrefixSha256, inspectAgenticProcess } from "../../core/workflow/agentic-process.mjs";
import { processFrameModel } from "../../core/workflow/process-call-model.mjs";
import { assertProcessReconciliationInventory, RECONCILIATION_DISCOVERY_DOMAINS } from "../../core/workflow/process-reconciliation-inventory.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import ownerSchema from "../../core/contracts/workflow-definition/process-local-effect-owner.v1.schema.json" with { type: "json" };
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { exactFileIdentity } from "../../lib/fs/exact-file-identity.mjs";
import { assertProcessDispatchRecord, dispatchRecordPath } from "../../core/workflow/process-dispatch-record.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const prefixFor = (instance, intent) => agenticProcessPrefixSha256(instance, intent.instance_revision - 1);

// Only trusted host capabilities supply these readers. Authored JSON cannot
// select a discoverer, verifier or effect observer. This port has no writer.
export function createStandardReconciliationInventory({ targetRoot, signer, readInstance, readAuthority, readContext, readSubject,
  configuration = null, modelSource = null, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  function observe(instance) {
    assertAgenticProcessInstance(instance);
    const observed = artifacts.observeInventory(), resources = [], operations = [], records = new Map(), prefixes = new Map(), dispatches = [];
    const accounting = { native_known: true, responses_observed_minimum: 0, storage_debit_bytes_minimum: 0,
      unresolved_native_allocations: 0, operation_attempts: 0, unknown_operations: 0 };
    const add = (ref, kind, sha256, details) => {
      if (resources.length >= 10000) fail("PROCESS_RECONCILIATION_INVENTORY_TRUNCATED");
      resources.push({ ref, kind, sha256, disposition: "unresolved", details });
    };
    for (const row of observed.rows) {
      add("artifact:" + row.path, "artifact", row.sha256, { metadata_sha256: row.metadata_sha256, source: observed.source });
      // Unknown record namespaces are retained as artifacts, never treated as
      // an understood or closed resource. The external-discovery gaps stay open.
      if (!/^workflows\/(operation-records|decision-inbox|control-inbox|native-allocations|dispatch-records)\//.test(row.path)) continue;
      const record = JSON.parse(row.content);
      if (row.path.startsWith("workflows/dispatch-records/")) {
        assertProcessDispatchRecord(record);
        if (row.path !== dispatchRecordPath(record.operation_id)) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        if (record.instance_id === instance.instance_id) { signer.verify(record); dispatches.push(record); }
      } else if (row.path.startsWith("workflows/operation-records/")) {
        assertOperationJournal(record);
        if (row.path !== `workflows/operation-records/${record.operation_id}.json`) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        if (record.intent.instance_id !== instance.instance_id) continue;
        signer.verify(record); signer.verify(record.preview); assertProcessOperationBinding(record.preview.binding);
        const intent = record.intent;
        if (intent.instance_revision > instance.revision) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        if (!prefixes.has(intent.instance_revision)) {
          const prefix = { ...instance, instance_sha256: prefixFor(instance, intent), revision: intent.instance_revision,
            events: instance.events.slice(0, intent.instance_revision - 1) };
          prefixes.set(intent.instance_revision, { instance: prefix, cursor: inspectAgenticProcess(prefix) });
        }
        const prefix = prefixes.get(intent.instance_revision), frame = prefix.cursor.occurrences.find(row => row.occurrence_id === intent.occurrence_id);
        const bindingModel = frame && processFrameModel(instance.model, frame);
        const bindingNode = bindingModel?.nodes.find(row => row.id === frame.node_id);
        if (!bindingNode || bindingNode.kind !== "operation" || !(frame.status === "READY" || frame.status === "WAITING"
          && ["blocked", "deferred"].includes(frame.operation?.receipt?.outcome))) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        assertProcessOperationIntent(intent, { instance, node: bindingNode, occurrenceId: intent.occurrence_id,
          model: bindingModel, revision: intent.instance_revision, expectedInstanceSha256: prefix.instance.instance_sha256 });
        if (record.operation_id !== operationJournalId({ instance_sha256: intent.instance_sha256 }, intent.occurrence_id)
          || record.preview.binding.id !== intent.binding_ref || shadowHash(record.preview.binding) !== intent.binding_sha256
          || shadowHash(record.preview.input) !== intent.input_sha256
          || shadowHash({ snapshot: record.preview.snapshot, prepared: record.preview.prepared }) !== intent.preconditions_sha256
          || (record.grant === null ? null : shadowHash(record.grant)) !== intent.authorization_sha256
          || ["instance_id", "instance_sha256", "scope_id", "model_sha256", "occurrence_id"].some(key => record.preview[key] !== intent[key]))
          fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        records.set(record.operation_id, record);
        const unknown = record.phase === "dispatching" || record.results.at(-1)?.receipt.effect_status === "unknown";
        accounting.operation_attempts += record.owner === null ? 0 : 1;
        accounting.unknown_operations += unknown ? 1 : 0;
        operations.push({ operation_id: record.operation_id, record_sha256: shadowHash(record), revision: record.revision,
          phase: record.phase, intent_sha256: shadowHash(intent), prefix_sha256: intent.instance_sha256,
          binding_sha256: intent.binding_sha256, grant_sha256: intent.authorization_sha256,
          owner: record.owner, effect_status: record.results.at(-1)?.receipt.effect_status ?? (record.phase === "staged" ? "not_dispatched" : "unknown"),
          results: record.results.map(row => ({ receipt_id: row.receipt.receipt_id, receipt_sha256: shadowHash(row.receipt),
            output_sha256: shadowHash(row.output), outcome: row.receipt.outcome, effect_status: row.receipt.effect_status })) });
        add("operation:" + record.operation_id, "operation", shadowHash(record), { owner: record.owner, unknown });
      } else if (row.path.startsWith("workflows/native-allocations/")) {
        assertNativeAllocationJournal(record);
        if (row.path !== `workflows/native-allocations/${record.journal_id}.json`) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        if (record.instance_id !== instance.instance_id) continue;
        signer.verify(record);
        if (record.scope_id !== instance.scope_id || record.model_sha256 !== instance.model_sha256) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        // Retain every authorization/cap/deadline by exact immutable record
        // hashes. No epoch history is counted twice or reset by observation.
        add("native:" + record.journal_id, "native_journal", shadowHash(record), { revision: record.revision,
          origin_sha256: record.origin_journal ? shadowHash(record.origin_journal) : null,
          initial_authorization_sha256: record.initial_authorization ? shadowHash(record.initial_authorization) : null,
          epochs: (record.epochs ?? []).map(row => ({ request_sha256: shadowHash(row.request), grant_sha256: shadowHash(row.grant) })) });
        for (const entry of record.allocations) {
          const known = entry.phase === "closed" && entry.consumption !== null;
          if (!known) { accounting.native_known = false; accounting.unresolved_native_allocations++; }
          accounting.responses_observed_minimum += entry.consumption?.responses_observed ?? 0;
          accounting.storage_debit_bytes_minimum += entry.consumption?.storage_debit_bytes ?? 0;
          add(`native:${record.journal_id}/${entry.generation}`, "native_allocation", shadowHash(entry), {
            generation: entry.generation, phase: entry.phase, owner_id: entry.owner_id, limits: entry.limits,
            authorization_sha256: entry.authorization_sha256, configuration_sha256: entry.configuration_sha256,
            consumption: entry.consumption, checkpoint: entry.checkpoint, closure_ref: entry.closure_ref,
            tree_closed: entry.tree_closed, accounting_known: known });
        }
      } else {
        const decision = row.path.startsWith("workflows/decision-inbox/");
        (decision ? assertDecisionInbox : assertControlInbox)(record);
        if (row.path !== `workflows/${decision ? "decision" : "control"}-inbox/${record.inbox_id}.json`)
          fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        // Decision source contracts bind the operation via the exact question;
        // link through the canonical operation records after the full scan.
        records.set(row.path, { record, decision });
      }
    }
    for (const dispatch of dispatches) {
      const operation = records.get(dispatch.operation_id);
      if (!operation || dispatch.scope_id !== operation.intent.scope_id || dispatch.model_sha256 !== operation.intent.model_sha256
        || dispatch.intent_sha256 !== shadowHash(operation.intent) || dispatch.preview_sha256 !== shadowHash(operation.preview)
        || dispatch.operation_owner_sha256 !== shadowHash(operation.owner)
        || dispatch.physical_root_sha256 !== shadowHash(artifacts.root)) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
      add("dispatch:" + dispatch.operation_id, "local_evidence", shadowHash(dispatch), {
        phase: dispatch.phase, process_identity: dispatch.process_identity, output_sha256: dispatch.output_sha256,
        leases: dispatch.leases, original_return_retained: dispatch.phase === "returned", complete_resource_closure: false });
      for (const intention of dispatch.local_owner_intentions ?? []) {
        if (intention.owner.scope_sha256 !== shadowHash({ physical_root: artifacts.root })) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
        add(`local-owner-intention:${dispatch.operation_id}/${intention.owner.token}`, "local_evidence", shadowHash(intention), {
          intention, matching_lease: dispatch.leases.find(row => shadowHash(row.owner) === shadowHash(intention.owner)) ?? null,
          allocation_observed: false, complete_resource_closure: false });
      }
    }
    for (const [id, entry] of records) {
      if (!id.startsWith("workflows/")) continue;
      const { record, decision } = entry;
      if (decision ? !records.has(record.operation_id) : record.request.instance_id !== instance.instance_id) continue;
      signer.verify(record);
      if (!decision && (record.request.scope_id !== instance.scope_id || record.request.model_sha256 !== instance.model_sha256))
        fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
      add((decision ? "decision:" : "control:") + record.inbox_id, decision ? "human_capture" : "control_capture", shadowHash(record), {
        phase: record.phase, source_ref: record.source_ref, source_sha256: shadowHash(record.source),
        operation_id: decision ? record.operation_id : null, request_sha256: decision ? null : shadowHash(record.request) });
    }
    // Every accepted intent/result/control must have an authenticated retained
    // resource, including receipts preceding a later UNKNOWN/result.
    for (const event of instance.events) {
      if (event.kind === "operation_intent" && shadowHash(records.get(event.intent.operation_id)?.intent) !== shadowHash(event.intent)
        || event.kind === "operation_result" && !records.get(event.receipt.operation_id)?.results.some(row => shadowHash(row.receipt) === shadowHash(event.receipt))
        || event.kind === "control" && !resources.some(row => row.ref === "control:" + event.delivery.delivery_id))
        fail("PROCESS_RECONCILIATION_HISTORY_UNAVAILABLE");
    }
    const physical = (directory, label, ownerFile = false) => {
      const root = agentRunPhysicalPath(directory, { missing: true }); let entries = 0, total = 0;
      const walk = (at, depth) => {
        if (depth > 32) fail("PROCESS_RECONCILIATION_INVENTORY_TRUNCATED");
        for (const name of fs.readdirSync(at).sort()) {
          if (++entries > 10000) fail("PROCESS_RECONCILIATION_INVENTORY_TRUNCATED");
          const file = agentRunPhysicalPath(path.join(at, name)), stat = fs.lstatSync(file, { bigint: true });
          if (stat.isDirectory()) { walk(file, depth + 1); continue; }
          const identity = exactFileIdentity(stat);
          if (!stat.isFile() || identity.nlink !== 1 || identity.size > 16777216 || (total += identity.size) > 33554432)
            fail("PROCESS_RECONCILIATION_RESOURCE_UNSUPPORTED");
          let bytes; const fd = fs.openSync(file, "r");
          try {
            if (shadowHash(exactFileIdentity(fs.fstatSync(fd, { bigint: true }))) !== shadowHash(identity)) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
            bytes = fs.readFileSync(fd);
            if (bytes.length !== identity.size || shadowHash(exactFileIdentity(fs.fstatSync(fd, { bigint: true }))) !== shadowHash(identity)
              || shadowHash(exactFileIdentity(fs.lstatSync(file, { bigint: true }))) !== shadowHash(identity)) fail("PROCESS_RECONCILIATION_RESOURCE_CHANGED");
          } finally { fs.closeSync(fd); }
          const relative = path.relative(root, file).replaceAll("\\", "/");
          let owner = null;
          if (ownerFile && relative === "effects.lock") {
            owner = JSON.parse(bytes);
            if (validateJsonSchema(owner, ownerSchema, "$", { contractKind: "workflow-definition" }).length
              || owner.scope_sha256 !== shadowHash({ physical_root: artifacts.root })) fail("STANDARD_EFFECT_OWNER_INVALID");
          }
          add(label + ":" + relative, owner ? "local_effect_owner" : "local_evidence", hash(bytes), {
            bytes: bytes.length, owner, physical_identity: identity, physical_identity_sha256: shadowHash(identity) });
        }
      };
      if (fs.existsSync(root)) walk(root, 0);
    };
    physical(path.join(artifacts.root, ".aidn/runtime/standard-workflow"), "local", true);
    if (configuration) {
      // This enumerates observed owned output namespaces, including unreferenced
      // evidence. It makes no claim about unjournaled provider/native sessions.
      const control = agentRunPhysicalPath(configuration.control_root);
      for (const name of fs.readdirSync(control).sort()) {
        if (name === instance.instance_id || name.startsWith(instance.instance_id + ".g")) physical(path.join(control, name), "execution:" + name);
      }
    }
    operations.sort((a, b) => a.operation_id.localeCompare(b.operation_id, "en"));
    resources.sort((a, b) => a.ref.localeCompare(b.ref, "en"));
    return { resources, operations, accounting, runtime_binding_sha256: observed.binding_sha256 };
  }
  function capture(instanceId, expectedSha256, requireExpected) {
      const subject = () => readSubject ? readSubject(instanceId) : { instance: readInstance(instanceId), authority: readAuthority(), context: readContext() };
      const { instance: before, authority, context } = subject(); assertAgenticProcessInstance(before);
      if (requireExpected && expectedSha256 !== before.instance_sha256) fail("PROCESS_REVISION_CONFLICT");
      const first = observe(before), second = observe(before), after = subject();
      if (shadowHash(first) !== shadowHash(second) || after.instance.instance_sha256 !== before.instance_sha256
        || shadowHash(after.authority) !== shadowHash(authority) || shadowHash(after.context) !== shadowHash(context))
        fail("PROCESS_RECONCILIATION_OBSERVATION_CHANGED");
      const inventory = assertProcessReconciliationInventory(signer.seal({ contract_version: "process-reconciliation-inventory.v1",
        instance_id: before.instance_id, instance_sha256: before.instance_sha256, instance_revision: before.revision,
        scope_id: before.scope_id, model_sha256: before.model_sha256, policy_sha256: shadowHash(before.policy_pins),
        model_source_sha256: modelSource === null ? null : shadowHash(modelSource),
        configuration_sha256: configuration === null ? null : shadowHash(configuration), physical_root_sha256: shadowHash(artifacts.root),
        authority_sha256: shadowHash(authority), context_sha256: shadowHash(context), observed_at_ms: now(),
        ...first, discovery: RECONCILIATION_DISCOVERY_DOMAINS.map(domain => ({ domain, status: "independent_observation_required" })),
        complete_resource_closure: false, permits_effects: false, written: false }));
      return { instance: before, inventory };
  }
  return Object.freeze({
    prepare(instanceId, { expectedSha256 } = {}) { return capture(instanceId, expectedSha256, true).inventory; },
    // Return the instance authenticated twice by this very capture, rather than
    // make callers perform another full authority read just to name its prefix.
    // This internal compound observation has no cross-call state or permission.
    observeSubject(instanceId) { return capture(instanceId, null, false); },
  });
}
