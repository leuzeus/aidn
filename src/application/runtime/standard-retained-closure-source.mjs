import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertRetainedClosureEntry, assertRetainedClosureProof } from '../../core/workflow/standard-retained-closure.mjs';
import { observeStandardCycleAudit } from '../../core/workflow/standard-cycle-audit.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createRetainedAuditSource } from './standard-retained-audit-source.mjs';
import { createStandardCycleClosureReview } from './standard-cycle-closure-review.mjs';

const require = (condition, code = 'STANDARD_RETAINED_CLOSURE_SOURCE_CHANGED') => {
  if (!condition) throw Object.assign(Error(code), { code });
};
// A recorded decision is observed under its original question. No second inbox
// claim, signature, receipt adoption or mutation of the original instance occurs.
export function createRetainedClosureSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options), inbox = createProcessDecisionInboxStore(options);
  function capture(entry) {
    assertRetainedClosureEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_CLOSURE_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_CLOSURE_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters?.entry_point?.kind === 'retained_audit', 'STANDARD_RETAINED_CLOSURE_ORIGIN_UNSUPPORTED');
    const intents = instance.events.filter(row => row.kind === 'operation_intent');
    require(intents.length > 0 && intents.length <= 16 && intents.at(-1).intent.operation_id === entry.decision_operation_id, 'STANDARD_RETAINED_CLOSURE_BOUNDARY_CHANGED');
    const records = intents.map(row => journals.read(row.intent.operation_id).record), record = records.at(-1);
    require(record?.intent.binding_ref === 'cycle_closure_decision' && record.results.length === 1
      && record.results[0].receipt.outcome === 'completed' && record.results[0].receipt.effect_status === 'no_effect', 'STANDARD_RETAINED_CLOSURE_DECISION_REQUIRED');
    for (const row of records) {
      require(row?.phase === 'receipted' && row.results.length === 1 && row.results[0].receipt.effect_status === 'no_effect', 'STANDARD_RETAINED_CLOSURE_EFFECT_UNSETTLED');
      const accepted = instance.events.some(event => event.kind === 'operation_result' && H(event.receipt) === H(row.results[0].receipt));
      require(row.operation_id === record.operation_id ? !accepted : accepted && row.results[0].receipt.outcome === 'completed', 'STANDARD_RETAINED_CLOSURE_BOUNDARY_CHANGED');
    }
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false }), signer = createOperationJournalSigner(host.readKey);
    const human = createStandardHumanDecisions({ inbox, signer, source: host.humanSource, projectionRequired: false });
    for (const row of records) {
      signer.verify(row); signer.verify(row.preview);
      require(row.preview.snapshot.native.configuration_sha256 === H(execution), 'STANDARD_RETAINED_CLOSURE_CONFIGURATION_CHANGED');
    }
    const captured = human.captured(record);
    require(captured.phase === 'receipted' && captured.source.choice === 'retain', 'STANDARD_RETAINED_CLOSURE_DECISION_REQUIRED');
    require(H(human.output(record, captured)) === H(record.results[0].output));
    return { instance, execution, record, records, host, human, captured,
      pins: { instance: instance.instance_sha256, execution: H(execution), journals: records.map(row => H(row)), inbox: H(captured) } };
  }
  return Object.freeze({ async inspect(entry, { readValidation, signal, assertCurrentOwner = null } = {}) {
    require(typeof readValidation === 'function', 'STANDARD_RETAINED_CLOSURE_VALIDATION_REQUIRED');
    const checkOwner = () => {
      require(!signal?.aborted, 'STANDARD_RETAINED_CLOSURE_CANCELLED');
      if (assertCurrentOwner !== null) require(typeof assertCurrentOwner === 'function' && assertCurrentOwner() === undefined, 'STANDARD_RETAINED_CLOSURE_OWNER_UNSETTLED');
      else require(!artifacts.ownerPending(), 'STANDARD_RETAINED_CLOSURE_OWNER_UNSETTLED');
    };
    checkOwner();
    const before = capture(entry), { instance, execution, record, host, human, captured } = before;
    const product = () => readAgenticProductSnapshot(execution.product_root, execution.product_files), initialProduct = H(product());
    const authority = createAuthority({ configuration: execution, model: instance.model, modelSource: record.preview.snapshot.model_source,
      readSigningKey: host.readKey, humanSource: host.humanSource, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
    const diagnostic = authority.inspectDiagnostic(instance);
    require(!diagnostic.journal?.allocations.length, 'STANDARD_RETAINED_CLOSURE_ORIGIN_UNSUPPORTED');
    await human.verifyCaptured(record, signal, { historical: true, acknowledged: true });
    const audit = before.records.find(row => row.operation_id === record.preview.prepared.plan.audit_operation_id);
    require(audit?.intent.binding_ref === 'cycle_audit_evaluate', 'STANDARD_RETAINED_CLOSURE_AUDIT_REQUIRED');
    const retained = await createRetainedAuditSource({ configuration: execution, environment, createAuthority }).inspect(instance.initial_parameters.entry_point, { assertCurrentOwner });
    const validation = await readValidation(retained.bridge.source), machine = retained.native.context.validation;
    require(validation.plan.product_sha256 === machine.product_sha256 && validation.plan.profile_sha256 === machine.profile_sha256
      && validation.manifest.status === machine.status && H(validation.checks) === H(machine.checks) && H(validation.evidence_refs) === H(machine.evidence_refs),
    'STANDARD_RETAINED_CLOSURE_VALIDATION_CHANGED');
    const material = authority.observeCycleAuditContext(retained.bridge, machine), native = retained.native;
    const output = observeStandardCycleAudit({ report: native.authenticated.report, context: native.context, contextSha256: H(native.context),
      producer: native.authenticated.producer, evidenceRefs: [...native.evidence_refs, ...validation.evidence_refs] });
    require(H(output) === H(audit.results[0].output), 'STANDARD_RETAINED_CLOSURE_AUDIT_CHANGED');
    const review = createStandardCycleClosureReview({ readAudit: async () => ({ native, current: { material }, record: audit, output }) });
    await review.assertFresh(instance, record.preview.prepared.plan);
    const question = human.question(record), decision = captured.source;
    checkOwner(); require(H(capture(entry).pins) === H(before.pins) && H(product()) === initialProduct);
    const proof = assertRetainedClosureProof({ original_instance_id: instance.instance_id, original_instance_sha256: instance.instance_sha256,
      original_configuration_sha256: H(execution), decision_operation_id: record.operation_id, decision_journal_sha256: H(record),
      question_sha256: H(question), source_sha256: H(decision), inbox_sha256: H(captured), audit_operation_id: audit.operation_id,
      audit_journal_sha256: H(audit), retained_audit_proof_sha256: H(retained.proof), context: retained.proof.context,
      product_sha256: initialProduct, report_sha256: H(native.authenticated.report), choice: decision.choice });
    return { proof, question, decision, report: native.authenticated.report, native, source: retained.bridge.source };
  } });
}
