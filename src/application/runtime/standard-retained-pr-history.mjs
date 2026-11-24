import path from 'node:path';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createNativeAllocationJournalStore } from '../../adapters/runtime/native-allocation-journal-store.mjs';
import { createSessionCloseRecoveryStore } from '../../adapters/runtime/standard-session-close-recovery-store.mjs';
import { createStandardHostAuthority } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { nativeJournalId } from '../../core/workflow/native-allocation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';

const require = (ok, code = 'STANDARD_RETAINED_PR_HISTORY_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
// Immutable history only. Initial admission separately authenticates the full
// close/integration source and current postimages. Subsequent PR writers own
// their new postimages; they cannot reinterpret old document hashes as current.
export function readRetainedPrHistory({ configuration, environment, originalConfiguration }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
  const natives = createNativeAllocationJournalStore(options), recoveries = createSessionCloseRecoveryStore(options);
  const roots = [configuration.control_root, configuration.review_root, configuration.native.home, ...configuration.native.protected_roots];
  const protectedFile = file => roots.some(root => { const relative = path.relative(root, file);
    return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); });
  const lineage = [], records = new Map(), owners = new Map();
  let ref = originalConfiguration;
  while (ref) {
    require(lineage.length < 32 && protectedFile(ref.path), 'STANDARD_RETAINED_PR_HISTORY_PROTECTION_REQUIRED');
    const execution = readAgentRunFile(ref.path, { sha256: ref.sha256 }).value;
    require(execution.instance_id !== configuration.instance_id && !owners.has(execution.instance_id)
      && execution.target_root === configuration.target_root && execution.product_root === configuration.product_root
      && H(execution.product_files) === H(configuration.product_files), 'STANDARD_RETAINED_PR_HISTORY_SCOPE_CHANGED');
    const instance = instances.read(execution.instance_id).record;
    require(instance && instance.instance_id === execution.instance_id);
    const host = createStandardHostAuthority({ configuration: execution, environment }, { useProvider: false });
    const signer = createOperationJournalSigner(host.readKey);
    const intents = instance.events.filter(row => row.kind === 'operation_intent');
    require(intents.length <= 512);
    const rows = intents.map(row => journals.read(row.intent.operation_id).record);
    for (const [index, record] of rows.entries()) {
      signer.verify(record); signer.verify(record.preview);
      require(!records.has(record.operation_id) && H(record.intent) === H(intents[index].intent)
        && record.intent.instance_id === instance.instance_id && record.intent.scope_id === instance.scope_id
        && record.intent.model_sha256 === instance.model_sha256
        && record.preview.snapshot.native.configuration_sha256 === H(execution));
      records.set(record.operation_id, { record, output: record.results.at(-1)?.output, instance, execution, host, signer });
    }
    const point = instance.initial_parameters?.entry_point;
    const recovery = point?.kind === 'retained_session_checkpoint' ? recoveries.read(point.recovery_operation_id).record : null;
    const native = natives.read(nativeJournalId(instance)).record;
    lineage.push({ configuration_ref: ref, configuration_sha256: H(execution), instance_id: instance.instance_id,
      instance_sha256: H(instance), journals_sha256: H(rows), native_sha256: H(native), recovery_sha256: H(recovery) });
    owners.set(instance.instance_id, { execution, instance, records: rows, host, signer, native });
    ref = point?.original_configuration ?? null;
  }
  require(lineage.length > 0);
  function accepted(id, binding) {
    const selected = records.get(id), record = selected?.record, result = record?.results.at(-1);
    require(record?.intent.binding_ref === binding && record.phase === 'receipted' && record.results.length === 1
      && result.receipt.outcome === 'completed' && result.output.outcome === 'completed'
      && ['confirmed', 'no_effect'].includes(result.output.effect_status) && result.receipt.effect_status === result.output.effect_status
      && result.receipt.output_sha256 === H(result.output)
      && selected.instance.events.some(row => row.kind === 'operation_result' && H(row.receipt) === H(result.receipt)));
    return { record, output: result.output };
  }
  return { lineage, lineage_sha256: H(lineage), records, owners, accepted };
}
