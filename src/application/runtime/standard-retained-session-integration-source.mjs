import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createLocalWorkflowBranchIntegration } from '../../adapters/runtime/local-workflow-branch-integration.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { assertRetainedSessionIntegrationEntry, assertRetainedSessionIntegrationProof, assertRetainedSessionIntegrationBoundary } from '../../core/workflow/standard-retained-session-integration.mjs';
import { retainedSessionDeliveryContinuation } from '../../core/workflow/standard-retained-session-delivery.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createRetainedSessionDeliverySource } from './standard-retained-session-delivery-source.mjs';
import { readRetainedSessionCycleHistory } from './standard-retained-session-cycle-history.mjs';
import { createStandardSessionBranchIntegrationAuthority } from './standard-session-branch-integration-authority.mjs';

const require = (ok, code = 'STANDARD_RETAINED_SESSION_INTEGRATION_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
// One acknowledged but unaccepted decision, before any integration dispatch.
// Read original authorities as history; never execute their bindings or import
// their receipt into the successor. Current Git and canonical bytes still govern.
export function createRetainedSessionIntegrationSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options), inbox = createProcessDecisionInboxStore(options);
  function capture(entry) {
    assertRetainedSessionIntegrationEntry(entry);
    const execution = readAgentRunFile(entry.original_configuration.path, { sha256: entry.original_configuration.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && execution.target_root === configuration.target_root
      && execution.product_root === configuration.product_root && H(execution.product_files) === H(configuration.product_files));
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_SESSION_INTEGRATION_BINDING_CHANGED');
    const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
    require([entry.original_configuration.path, execution.control_root, execution.review_root].every(file => roots.some(root => {
      const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })), 'STANDARD_RETAINED_SESSION_INTEGRATION_EVIDENCE_UNPROTECTED');
    const instance = instances.read(execution.instance_id).record;
    require(instance?.initial_parameters?.entry_point?.kind === 'retained_session_delivery');
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false }), signer = createOperationJournalSigner(host.readKey);
    const intents = instance.events.filter(row => row.kind === 'operation_intent'), records = intents.map(row => journals.read(row.intent.operation_id).record);
    for (const row of records) { signer.verify(row); signer.verify(row.preview); }
    assertRetainedSessionIntegrationBoundary({ instance, execution, records, entry });
    const decision = records.at(-1);
    const human = createStandardHumanDecisions({ inbox, signer, source: host.humanSource, projectionRequired: false });
    const captured = human.captured(decision), question = human.question(decision);
    require(captured.phase === 'receipted' && captured.source.choice === 'integrate-to-session'
      && H(human.output(decision, captured)) === H(decision.results[0].output), 'STANDARD_RETAINED_SESSION_INTEGRATION_DECISION_REQUIRED');
    return { execution, instance, records, decision, human, captured, question, host,
      pins: { configuration: H(execution), instance: H(instance), records: H(records), captured: H(captured) } };
  }
  async function read(entry, { signal, readValidation } = {}, fresh = false) {
    require(!signal?.aborted, 'STANDARD_RETAINED_SESSION_INTEGRATION_CANCELLED');
    if (fresh) require(!artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_INTEGRATION_OWNER_UNSETTLED');
    const before = capture(entry), product = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files), productSha = H(product());
    const authority = createAuthority({ configuration: before.execution, model: before.instance.model, modelSource: before.records[0].preview.snapshot.model_source,
      readSigningKey: before.host.readKey, humanSource: before.host.humanSource, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
    require(authority.inspectDiagnostic(before.instance).journal === null, 'STANDARD_RETAINED_SESSION_INTEGRATION_NATIVE_BOUNDARY_CHANGED');
    await before.human.verifyCaptured(before.decision, signal, { historical: true, acknowledged: true });
    const delivery = await createRetainedSessionDeliverySource({ configuration: before.execution, environment, createAuthority })
      .readRecorded(before.instance.initial_parameters.entry_point, { signal });
    require(H(before.records[0].results[0].output.observations.continuation) === H(retainedSessionDeliveryContinuation(delivery.proof)));
    const history = await readRetainedSessionCycleHistory({ configuration: before.execution, environment, createAuthority, source: delivery, readValidation });
    const selected = before.records[2].results[0].output.observations;
    require(selected.closure_operation_id === history.closed.record.operation_id && selected.receipt_sha256 === H(history.closed.record.results[0].receipt)
      && selected.output_sha256 === H(history.closed.output));
    const accepted = (instance, id, binding) => {
      require(instance.instance_sha256 === before.instance.instance_sha256);
      const record = before.records.find(row => row.operation_id === id);
      require(record && record !== before.decision && record.intent.binding_ref === binding);
      return { record, output: record.results[0].output };
    };
    const closePlan = delivery.finalizer.record.preview.prepared.plan;
    const final = { finalization_operation_id: delivery.proof.finalization_operation_id, session_id: closePlan.session_id, session_path: closePlan.session_path,
      branch: closePlan.branch, parent_head: closePlan.head, material_sha256: H({ finalization: delivery.finalizer.output,
        checkpoint: delivery.checkpoint.checkpoint.output, metadata_admission: delivery.proof }), postimages: delivery.postimages };
    const reader = createStandardSessionBranchIntegrationAuthority({ targetRoot: artifacts.root, readAcceptedOperation: accepted,
      readDeliverySource: async () => final, readRetainedCycle: async () => history });
    const plan = before.decision.preview.prepared.plan, canonical = await reader.readSource(before.instance, plan.input);
    const { git, ...originalCanonical } = plan.review;
    require(plan.input.delivery_operation_id === before.records[1].operation_id && H(canonical) === H(originalCanonical), 'STANDARD_RETAINED_SESSION_INTEGRATION_SUBJECT_CHANGED');
    if (fresh) {
      require(H(createLocalWorkflowBranchIntegration({ targetRoot: artifacts.root }).inspect(canonical)) === H(git), 'STANDARD_RETAINED_SESSION_INTEGRATION_GIT_CHANGED');
      require(!artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_INTEGRATION_OWNER_UNSETTLED');
    }
    const proof = assertRetainedSessionIntegrationProof({ original_instance_id: before.instance.instance_id, original_instance_sha256: before.instance.instance_sha256,
      original_configuration_sha256: H(before.execution), journals_sha256: H(before.records), decision_operation_id: before.decision.operation_id,
      decision_material_sha256: H({ question: before.question, decision: before.captured.source }), delivery_proof_sha256: H(delivery.proof),
      cycle_material_sha256: history.material_sha256, canonical_sha256: H(canonical), session_id: canonical.session_id });
    const finalDelivery = await createRetainedSessionDeliverySource({ configuration: before.execution, environment, createAuthority })
      .readRecorded(before.instance.initial_parameters.entry_point, { signal });
    require(H(finalDelivery.proof) === H(delivery.proof));
    require(!signal?.aborted && H(capture(entry).pins) === H(before.pins) && H(product()) === productSha
      && authority.inspectDiagnostic(before.instance).journal === null && H(await reader.readSource(before.instance, plan.input)) === H(canonical));
    return { proof, canonical, plan, decision: before.captured.source, question: before.question, record: before.decision,
      instance: before.instance, records: before.records };
  }
  return Object.freeze({ inspect: (entry, options) => read(entry, options, true), readRecorded: (entry, options) => read(entry, options) });
}
