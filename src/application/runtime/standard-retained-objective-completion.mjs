import path from 'node:path';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createStandardObjectiveDisposition } from './standard-drift-objective-disposition.mjs';
import { createStandardObjectiveCompletion } from './standard-drift-objective-completion.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { nativeEvidenceFile } from './native-allocation-evidence.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';

const require = (condition, code = 'STANDARD_RETAINED_OBJECTIVE_SOURCE_CHANGED') => {
  if (!condition) throw Object.assign(Error(code), { code });
};

// source is the fixed retained-completion reader's authenticated result. No
// operation parameter supplies this capability, its configuration or readers.
export async function readRetainedObjectiveCompletion({ source, configuration, environment }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), instance = source.instance;
  const finalizer = source.records.findLast(row => row.intent.binding_ref === 'drift_check_finalize');
  const plan = finalizer?.preview?.prepared?.plan;
  if (['standard-drift-finalize-plan.v1', 'standard-drift-finalize-plan.v2'].includes(plan?.contract_version)) return null;
  require(plan?.contract_version === 'standard-drift-finalize-plan.v3');
  const host = createStandardHostAuthority({ configuration, environment }, { useProvider: false });
  const signer = createOperationJournalSigner(host.readKey);
  const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer, source: host.humanSource, projectionRequired: false });
  const records = new Map(source.records.map(row => [row.operation_id, row]));
  const readOperation = id => { const record = records.get(id); require(record); signer.verify(record); signer.verify(record.preview); return record; };
  const evaluated = readOperation(plan.input.evaluation_operation_id), output = evaluated.results[0].output;
  const occurrence = evaluated.preview.input.report_occurrence_id;
  const native = instance.events.find(row => row.kind === 'result' && row.occurrence_id === occurrence);
  const refs = native?.result.evidence_refs.filter(row => row.ref.endsWith('-activity-context.json')) ?? [];
  require(refs.length === 1 && Number.isSafeInteger(source.native_allocation_count) && source.native_allocation_count > 0);
  const file = readAgentRunFile(nativeEvidenceFile(configuration, refs[0], source.native_allocation_count), { sha256: refs[0].sha256, maxBytes: 1048576 });
  const context = file.value.context;
  require(file.value.occurrence_id === occurrence && shadowHash(context) === plan.context_sha256
    && shadowHash(output) === plan.evaluation_sha256 && context.session_id === source.proof.session_id
    && context.cycle_id === source.proof.cycle_id && context.product_sha256 === source.proof.product_sha256);
  const verified = { output, context, context_sha256: plan.context_sha256, evaluation_sha256: plan.evaluation_sha256 };
  const disposition = createStandardObjectiveDisposition({ human, readOperation,
    assertFresh: () => { throw Error('STANDARD_RETAINED_OBJECTIVE_HISTORICAL_REVIEW_REQUIRED'); } });
  const readDisposition = (actual, input, value) => disposition.readHistorical(actual, input, value, plan.objective_alignment.decision_operation_id);
  const completion = createStandardObjectiveCompletion({ readOperation, readEvaluation: async () => verified,
    readDisposition, readHistoricalDisposition: readDisposition, readCurrent: id => instances.read(id).record,
    readReport: name => artifacts.read(name, { required: true }), readEvent: ({ file, offset }) => {
      require(file === '.aidn/runtime/perf/workflow-events.ndjson' && Number.isSafeInteger(offset) && offset >= 0);
      const bytes = readAgentRunFile(agentRunPhysicalPath(path.join(artifacts.root, file)), { json: false, maxBytes: 4194304 }).value;
      const end = bytes.indexOf(10, offset);
      require((offset === 0 || bytes[offset - 1] === 10) && end >= offset && end - offset < 65536);
      return bytes.subarray(offset, end + 1);
    } });
  const retained = await completion.read(instance), anchor = await completion.review(instance);
  require(shadowHash(retained) === shadowHash(plan.objective_alignment)
    && instances.read(instance.instance_id).record.instance_sha256 === instance.instance_sha256);
  return { disposition: retained, completion: anchor, scope: {
    instance_id: instance.instance_id, scope_id: instance.scope_id, configuration_sha256: source.proof.original_configuration_sha256,
    session_id: context.session_id, cycle_id: context.cycle_id, product_sha256: source.proof.product_sha256,
    branch: context.branch, head: context.head } };
}
