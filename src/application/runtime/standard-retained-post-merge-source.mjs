import path from 'node:path';
import { createStandardHostAuthority, readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { retainedMergeCaptureContinuation } from '../../core/workflow/standard-retained-merge-capture.mjs';
import { assertRetainedPostMergeEntry, assertRetainedPostMergeProof, assertRetainedPostMergeBoundary } from '../../core/workflow/standard-retained-post-merge.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { readRetainedPrHistory } from './standard-retained-pr-history.mjs';
import { createRetainedMergeCaptureSource } from './standard-retained-merge-capture-source.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createPretriageMergeSource } from './standard-session-pr-pretriage-merge.mjs';
import { createStandardSessionPrPostMergeFetch } from './standard-session-pr-post-merge-fetch.mjs';
import { postMergeSessionSource, assertPostMergeSessionLink, readPrOpeningLocator } from './standard-session-pr-post-merge-completion.mjs';
const require = (ok, code = 'STANDARD_RETAINED_POST_MERGE_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };

export function createRetainedPostMergeSource({ configuration, environment, createAuthority }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const options = { targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment };
  const inbox = createProcessDecisionInboxStore(options);
  function provider(owner) {
    const ref = readStandardHostInstance({ targetRoot: owner.target_root, instanceId: owner.instance_id, environment });
    const manifest = readAgentRunFile(path.join(ref.home, ref.identity + '.github.json'));
    const profile = readAgentRunFile(path.join(ref.home, ref.identity + '.github', 'config.yml'), { json: false, optional: true });
    require(manifest.value.instance_id === owner.instance_id && manifest.value.target_root === owner.target_root);
    return { manifest, profile_sha256: profile?.sha256 ?? null };
  }
  function capture(entry) {
    assertRetainedPostMergeEntry(entry);
    const history = readRetainedPrHistory({ configuration, environment, originalConfiguration: entry.original_configuration });
    const owner = history.owners.values().next().value, { execution, instance, records } = owner;
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]),
      'STANDARD_RETAINED_POST_MERGE_BINDING_CHANGED');
    require(owner.native === null, 'STANDARD_RETAINED_POST_MERGE_NATIVE_BOUNDARY_CHANGED');
    const boundary = assertRetainedPostMergeBoundary({ instance, records, entry });
    for (const record of records) history.accepted(record.operation_id, record.intent.binding_ref);
    const inherited = createRetainedMergeCaptureSource({ configuration: execution, environment, createAuthority })
      .readRecorded(instance.initial_parameters.entry_point);
    const selected = history.accepted(records[0].operation_id, 'workflow_entry_select');
    require(H(selected.output.observations.continuation) === H(retainedMergeCaptureContinuation(inherited.proof)));
    const human = createStandardHumanDecisions({ inbox, signer: owner.signer, source: owner.host.humanSource, projectionRequired: false });
    const captured = human.captured(boundary.disposition);
    require(captured.phase === 'receipted' && H(human.output(boundary.disposition, captured)) === H(boundary.disposition.results[0].output),
      'STANDARD_RETAINED_POST_MERGE_DECISION_CHANGED');
    const marker = readPrOpeningLocator(artifacts.read('sessions/' + inherited.proof.session_id + '.md', { required: true }).content);
    require(marker, 'STANDARD_RETAINED_POST_MERGE_OPENING_REQUIRED');
    const opening = inherited.lookup(marker.open_operation_id, 'session_pr_open');
    const previous = provider(execution), current = provider(configuration);
    require(H({ ...previous.manifest.value, instance_id: configuration.instance_id }) === H(current.manifest.value)
      && previous.profile_sha256 === current.profile_sha256, 'STANDARD_RETAINED_POST_MERGE_PROVIDER_CHANGED');
    const accepted = (_state, id, binding) => history.accepted(id, binding);
    const { readPretriage } = createPretriageMergeSource({ readAcceptedUpdate: accepted,
      readRetainedCapture: () => ({ ...inherited, entry: selected }) });
    const host = createStandardHostAuthority({ configuration: execution, environment });
    require(host.githubProvider, 'STANDARD_RETAINED_POST_MERGE_PROVIDER_REQUIRED');
    const reviewPort = host.githubProvider.sessionReviewPort;
    const postMerge = createStandardSessionPrPostMergeFetch({ readAccepted: accepted, readPretriage, reviewPort });
    const fetch = postMerge.alignmentSource(instance, { fetch_operation_id: entry.fetch_operation_id });
    const session = postMergeSessionSource({ instance, readAccepted: accepted, artifacts, readRetainedOpening: () => opening });
    assertPostMergeSessionLink(session, fetch.merge, boundary.measurement.results[0].output.observations.alignment);
    const proof = assertRetainedPostMergeProof({ original_instance_id: instance.instance_id, original_instance_sha256: H(instance),
      original_configuration_sha256: H(execution), lineage_sha256: history.lineage_sha256,
      provider_sha256: H({ previous: previous.manifest.sha256, current: current.manifest.sha256, profile: current.profile_sha256 }),
      inherited_proof_sha256: H(inherited.proof), session_id: session.sessionId, update_operation_id: inherited.update.record.operation_id,
      opening_operation_id: opening.record.operation_id, opening_receipt_sha256: H(opening.record.results[0].receipt),
      disposition_operation_id: boundary.disposition.operation_id, decision_material_sha256: H(captured),
      fetch_operation_id: entry.fetch_operation_id, fetch_receipt_sha256: fetch.receiptSha });
    function assertOrder(state, ids) {
      const [open, merge, fetched, aligned] = ids;
      const entryIntent = state.events.find(row => row.kind === 'operation_intent' && row.intent.binding_ref === 'workflow_entry_select');
      const entryResult = state.events.findIndex(row => row.kind === 'operation_result' && row.receipt.operation_id === entryIntent?.intent.operation_id);
      const alignmentIntent = state.events.findIndex(row => row.kind === 'operation_intent' && row.intent.operation_id === aligned);
      require(open === proof.opening_operation_id && merge === proof.disposition_operation_id && fetched === proof.fetch_operation_id
        && entryResult >= 0 && alignmentIntent > entryResult, 'STANDARD_RETAINED_POST_MERGE_ORDER_CHANGED');
      return true;
    }
    return { proof, owner, opening, fetch, inherited, human, disposition: boundary.disposition, reviewPort, assertOrder,
      // The owner is the original immutable instance, never a fabricated prefix.
      alignmentSource: input => {
        require(input.fetch_operation_id === entry.fetch_operation_id);
        return fetch;
      } };
  }
  async function inspect(entry, { signal } = {}) {
    require(!signal?.aborted && !artifacts.ownerPending(), 'STANDARD_RETAINED_POST_MERGE_OWNER_UNSETTLED');
    const before = capture(entry);
    await before.human.verifyCaptured(before.disposition, signal, { historical: true, acknowledged: true });
    const { git, fetch } = before.fetch;
    const measured = await before.reviewPort.postMergeFetch.observeAlignment(git, { expectPlan: git.plan_sha256, signal });
    require(['source_ref', 'merge_oid', 'fetched_head', 'proof_ref'].every(key => measured[key] === fetch[key])
      && measured.remote_head === fetch.fetched_head && measured.local_head === fetch.local_head,
      'STANDARD_RETAINED_POST_MERGE_POSTIMAGE_CHANGED');
    require(!signal?.aborted && !artifacts.ownerPending() && H(capture(entry).proof) === H(before.proof));
    return before;
  }
  return Object.freeze({ inspect, readRecorded: capture });
}
