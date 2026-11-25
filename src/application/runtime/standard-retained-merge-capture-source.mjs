import path from 'node:path';
import { createProcessControlInboxStore } from '../../adapters/runtime/process-control-inbox-store.mjs';
import { createStandardHostAuthority, readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { controlReservationId } from '../../core/workflow/process-control-inbox.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { externalMergeMaterial } from '../../core/workflow/standard-pr-external-merge.mjs';
import { retainedExternalMergeContinuation } from '../../core/workflow/standard-retained-external-merge.mjs';
import { assertRetainedMergeCaptureEntry, assertRetainedMergeCaptureProof, assertRetainedMergeCaptureBoundary } from '../../core/workflow/standard-retained-merge-capture.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { readRetainedPrHistory } from './standard-retained-pr-history.mjs';
import { createRetainedExternalMergeSource } from './standard-retained-external-merge-source.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { observeStandardPrMerge } from './standard-session-pr-merge-observe.mjs';
const require = (ok, code = 'STANDARD_RETAINED_MERGE_CAPTURE_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };

export function createRetainedMergeCaptureSource({ configuration, environment, createAuthority, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: configuration.target_root, env: environment });
  const controls = createProcessControlInboxStore({ targetRoot: artifacts.root, stateMode: artifacts.describe().state_mode, env: environment });
  function provider(owner) {
    const ref = readStandardHostInstance({ targetRoot: owner.target_root, instanceId: owner.instance_id, environment });
    const manifest = readAgentRunFile(path.join(ref.home, ref.identity + '.github.json'));
    const profile = readAgentRunFile(path.join(ref.home, ref.identity + '.github', 'config.yml'), { json: false, optional: true });
    require(manifest.value.instance_id === owner.instance_id && manifest.value.target_root === owner.target_root);
    return { manifest, profile_sha256: profile?.sha256 ?? null };
  }
  function capture(entry) {
    assertRetainedMergeCaptureEntry(entry);
    const history = readRetainedPrHistory({ configuration, environment, originalConfiguration: entry.original_configuration });
    const owner = history.owners.values().next().value, { execution, instance, records } = owner;
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_MERGE_CAPTURE_BINDING_CHANGED');
    require(owner.native === null, 'STANDARD_RETAINED_MERGE_CAPTURE_NATIVE_BOUNDARY_CHANGED');
    const captured = controls.read(entry.capture_id).record;
    require(captured, 'STANDARD_RETAINED_MERGE_CAPTURE_REQUIRED'); owner.signer.verify(captured);
    const reservation = controls.read(controlReservationId(captured.request)).record;
    require(reservation, 'STANDARD_RETAINED_MERGE_CAPTURE_REQUIRED'); owner.signer.verify(reservation);
    assertRetainedMergeCaptureBoundary({ instance, records, capture: captured, reservation, entry, now: now() });
    const inheritedSource = createRetainedExternalMergeSource({ configuration: execution, environment, createAuthority });
    const inherited = inheritedSource.readRecorded(instance.initial_parameters.entry_point);
    require(H(records[0].results[0].output.observations.continuation) === H(retainedExternalMergeContinuation(inherited.proof))
      && captured.payload.update_operation_id === inherited.update.record.operation_id
      && captured.payload.source_sha256 === H({ intent: inherited.update.record.intent, result: inherited.update.record.results.at(-1) })
      && captured.payload.pre_merge_base_oid === inherited.update.output.observations.pull_request.base_oid);
    const previous = provider(execution), current = provider(configuration);
    require(H({ ...previous.manifest.value, instance_id: configuration.instance_id }) === H(current.manifest.value)
      && previous.profile_sha256 === current.profile_sha256, 'STANDARD_RETAINED_MERGE_CAPTURE_PROVIDER_CHANGED');
    const proof = assertRetainedMergeCaptureProof({ original_instance_id: instance.instance_id, original_instance_sha256: H(instance),
      original_configuration_sha256: H(execution), lineage_sha256: history.lineage_sha256,
      provider_sha256: H({ previous: previous.manifest.sha256, current: current.manifest.sha256, profile: current.profile_sha256 }),
      inherited_proof_sha256: H(inherited.proof), session_id: inherited.proof.session_id, update_operation_id: inherited.update.record.operation_id,
      capture_id: captured.inbox_id, capture_sha256: H(captured), reservation_sha256: H(reservation) });
    return { proof, owner, capture: captured, reservation, inherited, inheritedSource, update: inherited.update, lookup: inherited.lookup };
  }
  async function inspect(entry, { signal } = {}) {
    require(!signal?.aborted && !artifacts.ownerPending(), 'STANDARD_RETAINED_MERGE_CAPTURE_OWNER_UNSETTLED');
    const before = capture(entry);
    await before.inheritedSource.inspect(before.owner.instance.initial_parameters.entry_point, { signal });
    const host = createStandardHostAuthority({ configuration, environment });
    require(host.githubProvider, 'STANDARD_RETAINED_MERGE_CAPTURE_PROVIDER_REQUIRED');
    const observed = await observeStandardPrMerge({ reviewPort: host.githubProvider.sessionReviewPort,
      pullRequest: before.update.output.observations.pull_request, notBefore: before.update.record.preview.prepared.plan.prepared_at_ms, now, signal });
    require(H(externalMergeMaterial({ ...before.capture.payload, provider: observed })) === H(externalMergeMaterial(before.capture.payload)),
      'STANDARD_RETAINED_MERGE_CAPTURE_POSTIMAGE_CHANGED');
    await before.inheritedSource.inspect(before.owner.instance.initial_parameters.entry_point, { signal });
    require(!signal?.aborted && !artifacts.ownerPending() && H(capture(entry).proof) === H(before.proof));
    return before;
  }
  return Object.freeze({ inspect, readRecorded: capture });
}
