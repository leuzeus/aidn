import path from 'node:path';
import { createProcessControlInboxStore } from '../../adapters/runtime/process-control-inbox-store.mjs';
import { createStandardHostAuthority, readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { controlReservationId } from '../../core/workflow/process-control-inbox.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { assertExternalProof } from '../../core/workflow/standard-pr-external-merge.mjs';
import { assertRetainedExternalMergeEntry, assertRetainedExternalMergeProof, assertRetainedExternalMergeBoundary } from '../../core/workflow/standard-retained-external-merge.mjs';
import { retainedSessionPrOpenContinuation } from '../../core/workflow/standard-retained-session-pr-open.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { readRetainedPrHistory } from './standard-retained-pr-history.mjs';
import { createRetainedSessionPrOpenSource } from './standard-retained-session-pr-open-source.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardSessionPrRecordAuthority } from './standard-session-pr-record-authority.mjs';
import { createStandardSessionPrSuccessorAuthority } from './standard-session-pr-successor-authority.mjs';
import { createStandardSessionPrReviewAuthority } from './standard-session-pr-review-authority.mjs';
import { observeStandardPrMerge } from './standard-session-pr-merge-observe.mjs';
const require = (ok, code = 'STANDARD_RETAINED_EXTERNAL_MERGE_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };

export function createRetainedExternalMergeSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  function provider(owner) {
    const ref = readStandardHostInstance({ targetRoot: owner.target_root, instanceId: owner.instance_id, environment });
    const manifest = readAgentRunFile(path.join(ref.home, ref.identity + '.github.json'));
    const profile = readAgentRunFile(path.join(ref.home, ref.identity + '.github', 'config.yml'), { json: false, optional: true });
    require(manifest.value.instance_id === owner.instance_id && manifest.value.target_root === owner.target_root);
    return { manifest, profile_sha256: profile?.sha256 ?? null };
  }
  function capture(entry) {
    assertRetainedExternalMergeEntry(entry);
    const history = readRetainedPrHistory({ configuration, environment, originalConfiguration: entry.original_configuration });
    const owner = history.owners.values().next().value, { execution, instance, records } = owner;
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_EXTERNAL_MERGE_BINDING_CHANGED');
    const boundary = assertRetainedExternalMergeBoundary({ instance, records, entry });
    require(owner.native === null, 'STANDARD_RETAINED_EXTERNAL_MERGE_NATIVE_BOUNDARY_CHANGED');
    const reservation = controlReservationId({ ...instance, occurrence_id: boundary.wait.occurrence_id });
    require(!createProcessControlInboxStore(options).read(reservation).record, 'STANDARD_RETAINED_EXTERNAL_MERGE_CONTROL_UNSETTLED');
    const inherited = createRetainedSessionPrOpenSource({ configuration: execution, environment, createAuthority }).readRecorded(instance.initial_parameters.entry_point);
    require(H(records[0].results[0].output.observations.continuation) === H(retainedSessionPrOpenContinuation(inherited.proof)));
    const previous = provider(execution), current = provider(configuration);
    require(H({ ...previous.manifest.value, instance_id: configuration.instance_id }) === H(current.manifest.value)
      && previous.profile_sha256 === current.profile_sha256, 'STANDARD_RETAINED_EXTERNAL_MERGE_PROVIDER_CHANGED');
    const update = history.accepted(entry.update_operation_id, 'session_pr_update_push');
    const observation = history.accepted(records[4].operation_id, 'session_pr_review_content_observe');
    require(observation.record.preview.input.update_operation_id === entry.update_operation_id
      && observation.output.observations.update_operation_id === entry.update_operation_id);
    const proof = assertRetainedExternalMergeProof({ original_instance_id: instance.instance_id, original_instance_sha256: H(instance),
      original_configuration_sha256: H(execution), lineage_sha256: history.lineage_sha256,
      provider_sha256: H({ previous: previous.manifest.sha256, current: current.manifest.sha256, profile: current.profile_sha256 }),
      inherited_proof_sha256: H(inherited.proof), session_id: inherited.proof.session_id, update_operation_id: entry.update_operation_id });
    const allowed = new Set([...records.map(row => row.operation_id), ...inherited.history.records.keys()]);
    const lookup = (id, binding) => { require(allowed.has(id)); return history.accepted(id, binding); };
    return { proof, owner, update, observation, inherited, lookup };
  }
  async function inspect(entry, { signal } = {}) {
    require(!signal?.aborted && !artifacts.ownerPending(), 'STANDARD_RETAINED_EXTERNAL_MERGE_OWNER_UNSETTLED');
    const before = capture(entry), host = createStandardHostAuthority({ configuration, environment });
    const previousHost = createStandardHostAuthority({ configuration: before.owner.execution, environment });
    require(host.githubProvider, 'STANDARD_RETAINED_EXTERNAL_MERGE_PROVIDER_REQUIRED');
    const accepted = (_instance, id, binding) => before.lookup(id, binding);
    const historyAuthority = createStandardSessionPrRecordAuthority({ targetRoot: artifacts.root, readAcceptedOperation: accepted,
      pullRequestPort: host.githubProvider.sessionPullRequestPort });
    const successor = createStandardSessionPrSuccessorAuthority({ targetRoot: artifacts.root, readAcceptedOperation: accepted, historyAuthority });
    const reviewer = createStandardSessionPrReviewAuthority({ readAcceptedOperation: accepted, readCheckpoint: successor.readCheckpoint,
      inspectPush: (branch, options) => previousHost.githubProvider.sessionPushPort.inspect(branch, options) });
    await reviewer.readConfirmedHead(before.owner.instance, { update_operation_id: entry.update_operation_id }, { signal });
    const pullRequest = before.update.output.observations.pull_request;
    const observed = await observeStandardPrMerge({ reviewPort: host.githubProvider.sessionReviewPort, pullRequest,
      notBefore: before.update.record.preview.prepared.plan.prepared_at_ms, now: Date.now, signal });
    assertExternalProof({ provider: observed, pre_merge_base_oid: pullRequest.base_oid });
    await reviewer.readConfirmedHead(before.owner.instance, { update_operation_id: entry.update_operation_id }, { signal });
    successor.readCheckpoint(before.owner.instance, before.update.record.preview.prepared.plan.input);
    require(!signal?.aborted && !artifacts.ownerPending() && H(capture(entry).proof) === H(before.proof));
    return before;
  }
  return Object.freeze({ inspect, readRecorded: capture });
}
