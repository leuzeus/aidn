import path from 'node:path';
import { readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { retainedPostMergeContinuation } from '../../core/workflow/standard-retained-post-merge.mjs';
import { assertRetainedPostMergeDecisionBoundary, assertRetainedPostMergeDecisionProof } from '../../core/workflow/standard-retained-post-merge-decision.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { readRetainedPrHistory } from './standard-retained-pr-history.mjs';
import { createRetainedPostMergeSource } from './standard-retained-post-merge-source.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { postMergeProjectScope } from './standard-session-pr-post-merge-completion.mjs';
const require = ok => { if (!ok) throw Object.assign(Error('STANDARD_RETAINED_POST_MERGE_DECISION_SOURCE_CHANGED'), { code: 'STANDARD_RETAINED_POST_MERGE_DECISION_SOURCE_CHANGED' }); };

export function createRetainedPostMergeDecisionSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const inbox = createProcessDecisionInboxStore({ targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment });
  function provider(execution) {
    const host = readStandardHostInstance({ targetRoot: execution.target_root, instanceId: execution.instance_id, environment });
    return { manifest: readAgentRunFile(path.join(host.home, host.identity + '.github.json')),
      profile: readAgentRunFile(path.join(host.home, host.identity + '.github', 'config.yml'), { json: false, optional: true })?.sha256 ?? null };
  }
  function capture(entry) {
    const history = readRetainedPrHistory({ configuration, environment, originalConfiguration: entry.original_configuration });
    const owner = history.owners.values().next().value, { execution, instance, records } = owner;
    const { decision, question } = assertRetainedPostMergeDecisionBoundary({ instance, records, entry });
    require(owner.native === null && H(execution.criteria) === H(configuration.criteria)
      && H(execution.authorities) === H(configuration.authorities) && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(k => execution.native[k] === configuration.native[k]));
    const inherited = createRetainedPostMergeSource({ configuration: execution, environment, createAuthority }).readRecorded(instance.initial_parameters.entry_point);
    require(H(records[0].results[0].output.observations.continuation) === H(retainedPostMergeContinuation(inherited.proof)));
    const beforeProvider = provider(execution), currentProvider = provider(configuration);
    require(H({ ...beforeProvider.manifest.value, instance_id: configuration.instance_id }) === H(currentProvider.manifest.value)
      && beforeProvider.profile === currentProvider.profile);
    const human = createStandardHumanDecisions({ inbox, signer: owner.signer, source: owner.host.humanSource, projectionRequired: false });
    const material = human.captured(decision), subject = question.subject, alignment = subject.alignment;
    require(material.phase === 'receipted' && H(human.output(decision, material)) === H(decision.results[0].output)
      && subject.project_scope_sha256 === postMergeProjectScope(artifacts.root, environment)
      && subject.opening_operation_id === inherited.proof.opening_operation_id
      && subject.session_id === inherited.proof.session_id && subject.merge_operation_id === inherited.proof.disposition_operation_id
      && subject.merge_receipt_sha256 === H(inherited.disposition.results[0].receipt)
      && alignment.fetch_operation_id === inherited.proof.fetch_operation_id && alignment.fetch_receipt_sha256 === inherited.fetch.receiptSha
      && subject.repository_id === inherited.fetch.merge.provider.repository.node_id
      && subject.pull_request_id === inherited.fetch.merge.provider.pull_request.node_id
      && subject.pull_request_number === inherited.fetch.merge.provider.pull_request.number
      && subject.head_ref === inherited.fetch.merge.provider.pull_request.head_ref
      && subject.head_oid === inherited.fetch.merge.provider.pull_request.head_oid
      && alignment.source_ref === 'refs/heads/' + inherited.fetch.merge.provider.pull_request.base_ref);
    const proof = assertRetainedPostMergeDecisionProof({ ...inherited.proof,
      original_instance_id: instance.instance_id, original_instance_sha256: H(instance), original_configuration_sha256: H(execution),
      lineage_sha256: history.lineage_sha256, inherited_proof_sha256: H(inherited.proof),
      provider_sha256: H({ previous: beforeProvider.manifest.sha256, current: currentProvider.manifest.sha256, profile: currentProvider.profile }),
      recorded_decision_operation_id: decision.operation_id, recorded_decision_receipt_sha256: H(decision.results[0].receipt),
      recorded_question_sha256: H(question), recorded_decision_material_sha256: H(material) });
    const result = { ...inherited, proof, decisionOwner: owner, recordedDecision: { record: decision, output: decision.results[0].output }, question };
    result.verifyRecordedDecision = async (signal, options) => verify(entry, result, signal, options);
    return result;
  }
  async function verify(entry, expected, signal, { alignment: checkAlignment = true } = {}) {
    require(!signal?.aborted && !artifacts.ownerPending());
    const before = capture(entry); require(H(before.proof) === H(expected.proof));
    const owner = before.decisionOwner, human = createStandardHumanDecisions({ inbox, signer: owner.signer, source: owner.host.humanSource, projectionRequired: false });
    await human.verifyCaptured(before.recordedDecision.record, signal, { historical: true, acknowledged: true });
    await before.human.verifyCaptured(before.disposition, signal, { historical: true, acknowledged: true });
    if (checkAlignment) {
      const observed = await before.reviewPort.postMergeFetch.observeAlignment(before.fetch.git, { expectPlan: before.fetch.git.plan_sha256, signal });
      const alignment = { ...observed, fetch_operation_id: before.proof.fetch_operation_id, fetch_receipt_sha256: before.fetch.receiptSha };
      require(H(alignment) === H(before.question.subject.alignment));
    }
    require(!signal?.aborted && !artifacts.ownerPending() && H(capture(entry).proof) === H(before.proof));
    return before;
  }
  return Object.freeze({ readRecorded: capture, async inspect(entry, { signal } = {}) {
    const before = capture(entry); require(Date.now() >= before.question.expires_at_ms);
    return verify(entry, before, signal);
  } });
}
