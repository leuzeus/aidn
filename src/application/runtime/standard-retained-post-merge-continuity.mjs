import { readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { retainedPostMergeContinuation } from '../../core/workflow/standard-retained-post-merge.mjs';
import { assertPostMergeCompleteInput, assertPostMergeCompleteOutput, postMergeCompleteOperation } from '../../core/workflow/standard-pr-post-merge-complete.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createRetainedPostMergeSource } from './standard-retained-post-merge-source.mjs';
import { latestIntent, postMergeCompletionSource, postMergeProjectScope } from './standard-session-pr-post-merge-completion.mjs';
const require = ok => { if (!ok) throw Object.assign(Error('STANDARD_PR_POST_MERGE_COMPLETION_PROOF_REQUIRED'), { code: 'STANDARD_PR_POST_MERGE_COMPLETION_PROOF_REQUIRED' }); };

// Bounded discovery in the selected canonical backend, never a filesystem
// fallback for PostgreSQL. A locator is not authority: every candidate and
// predecessor is authenticated independently, and two completions are ambiguous.
export function readRetainedPostMergeContinuity({ targetRoot, sessionId, sourceBranch, opening, artifacts, instances, journal,
  environment, acceptedOperation }) {
  const names = artifacts.inventory().paths.filter(name => name.startsWith('workflows/process-instances/'));
  require(names.length <= 1024);
  const matches = [];
  for (const name of names) {
    const match = /^workflows\/process-instances\/([a-z][a-z0-9_-]{0,95})\.json$/.exec(name);
    require(match);
    const instance = instances.read(match[1]).record;
    require(instance);
    if (instance.initial_parameters?.entry_point?.kind !== 'retained_post_merge'
      || instance.initial_parameters.session?.session_id !== sessionId) continue;
    const intent = latestIntent(instance, postMergeCompleteOperation);
    if (!intent || !instance.events.some(row => row.kind === 'operation_result'
      && row.receipt.operation_id === intent.operation_id && row.receipt.outcome === 'completed')) continue;
    const host = readStandardHostInstance({ targetRoot, instanceId: instance.instance_id, environment });
    const signer = createOperationJournalSigner(host.readKey);
    const read = id => { const record = journal.read(id).record; require(record); signer.verify(record); signer.verify(record.preview); return record; };
    const entryIntent = latestIntent(instance, 'workflow_entry_select');
    require(entryIntent && instance.events.filter(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select').length === 1);
    const entry = acceptedOperation(read, instance, entryIntent.operation_id, 'workflow_entry_select');
    require(entry.output.observations.entry_point === 'retained_post_merge');
    const ref = instance.initial_parameters.entry_point.original_configuration;
    const original = readAgentRunFile(ref.path, { sha256: ref.sha256 }).value;
    require(original.target_root === targetRoot);
    // Only reconstruct the immutable reader's shared bindings. This object is
    // never executed and cannot replace the successor's configuration or grants.
    const configuration = { ...original, instance_id: instance.instance_id };
    const retained = createRetainedPostMergeSource({ configuration, environment }).readRecorded(instance.initial_parameters.entry_point);
    require(H(entry.output.observations.continuation) === H(retainedPostMergeContinuation(retained.proof))
      && H(retained.opening.record) === H(opening));
    const { record, output } = acceptedOperation(read, instance, intent.operation_id, postMergeCompleteOperation);
    require(record.preview.binding.effect_class === 'mutating' && record.grant?.authorized === true
      && record.intent.authorization_sha256 === H(record.grant));
    const end = instance.events.findIndex(row => row.kind === 'operation_intent' && row.intent.operation_id === intent.operation_id);
    const prefix = { ...instance, events: instance.events.slice(0, end) };
    const readAccepted = (state, id, binding) => {
      require(latestIntent(state, binding)?.operation_id === id);
      return acceptedOperation(read, state, id, binding);
    };
    const { plan, git } = postMergeCompletionSource({ instance: prefix, input: assertPostMergeCompleteInput(record.preview.input),
      readAccepted, artifacts, readRetainedOpening: () => retained.opening,
      readAlignmentSource: (_state, input) => retained.alignmentSource(input), assertRetainedOrder: retained.assertOrder,
      scopeSha: () => postMergeProjectScope(targetRoot, environment) });
    assertPostMergeCompleteOutput(output);
    require(plan.session_id === sessionId && plan.opening_operation_id === opening.operation_id
      && (sourceBranch === undefined || plan.source_ref === 'refs/heads/' + sourceBranch)
      && record.preview.prepared?.can_apply === true && H(plan) === H(record.preview.prepared.plan)
      && H(plan) === record.preview.prepared.plan_sha256 && output.observations.plan_sha256 === H(plan)
      && output.evidence_refs[0].ref === 'aidn:post-merge-completion/' + plan.opening_operation_id);
    retained.reviewPort.postMergeFetch.verifyCompletedSource(git, { expectPlan: git.plan_sha256, alignedHead: plan.aligned_head });
    const providerHost = readStandardHostInstance({ targetRoot, instanceId: retained.owner.instance.instance_id, environment });
    matches.push({ plan, git, host: { home: providerHost.home, identity: providerHost.identity },
      instanceId: retained.owner.instance.instance_id, completionInstanceId: instance.instance_id, targetRoot });
  }
  require(matches.length === 1);
  return matches[0];
}
