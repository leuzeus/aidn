import path from 'node:path';
import { createProcessDecisionInboxStore } from '../../adapters/runtime/process-decision-inbox-store.mjs';
import { createStandardHostAuthority, readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createLocalWorkflowBranchIntegration } from '../../adapters/runtime/local-workflow-branch-integration.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { assertRetainedSessionPrOpenEntry, assertRetainedSessionPrOpenProof, assertRetainedSessionPrOpenBoundary } from '../../core/workflow/standard-retained-session-pr-open.mjs';
import { retainedSessionIntegrationContinuation } from '../../core/workflow/standard-retained-session-integration.mjs';
import { readAgentRunFile } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardHumanDecisions } from './standard-workflow-human-decisions.mjs';
import { createRetainedSessionIntegrationSource } from './standard-retained-session-integration-source.mjs';
import { createStandardSessionPrRecordAuthority } from './standard-session-pr-record-authority.mjs';
import { readRetainedPrHistory } from './standard-retained-pr-history.mjs';
import { readAgenticProductSnapshot } from './agentic-process-execution-composition.mjs';

const require = (ok, code = 'STANDARD_RETAINED_SESSION_PR_OPEN_SOURCE_CHANGED') => { if (!ok) throw Object.assign(Error(code), { code }); };
// One settled integration/push/open prefix. Initial admission proves live
// canonical/Git/provider state and the full historical source. Later reads
// authenticate immutable lineage; the ordinary PR writer and successors own
// canonical freshness and physical/provider observations at their own fences.
export function createRetainedSessionPrOpenSource({ configuration, environment, createAuthority }) {
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
    assertRetainedSessionPrOpenEntry(entry);
    const history = readRetainedPrHistory({ configuration, environment, originalConfiguration: entry.original_configuration });
    const owner = history.owners.values().next().value, { execution, instance, records } = owner;
    require(H(execution.criteria) === H(configuration.criteria) && H(execution.authorities) === H(configuration.authorities)
      && H(execution.controller) === H(configuration.controller)
      && ['executable', 'sha256', 'home', 'model', 'effort'].every(key => execution.native[key] === configuration.native[key]), 'STANDARD_RETAINED_SESSION_PR_OPEN_BINDING_CHANGED');
    assertRetainedSessionPrOpenBoundary({ instance, records, entry });
    require(owner.native === null, 'STANDARD_RETAINED_SESSION_PR_OPEN_NATIVE_BOUNDARY_CHANGED');
    const open = history.accepted(entry.open_operation_id, 'session_pr_open');
    const push = history.accepted(open.record.preview.input.push_operation_id, 'session_push');
    const admit = history.accepted(push.record.preview.input.admission_operation_id, 'session_pr_admit');
    const integration = history.accepted(admit.record.preview.input.integration_operation_id, 'session_branch_integrate');
    require([open, push, admit, integration].every(row => row.record.intent.instance_id === instance.instance_id));
    const review = integration.record.preview.prepared.plan.review;
    const delivery = history.accepted(review.delivery_operation_id, 'session_delivery_checkpoint');
    const finalizer = history.accepted(delivery.record.preview.prepared.plan.input.finalization_operation_id, 'session_close_finalize');
    const closed = history.accepted(review.closure_operation_id, 'cycle_close_finalize');
    const decision = history.records.get(integration.record.preview.prepared.plan.input.decision_operation_id);
    require(decision?.record.intent.binding_ref === 'session_branch_integration_decision');
    const human = createStandardHumanDecisions({ inbox: createProcessDecisionInboxStore(options), signer: decision.signer, source: decision.host.humanSource, projectionRequired: false });
    const captured = human.captured(decision.record), question = human.question(decision.record);
    require(captured.phase === 'receipted' && captured.source.choice === 'integrate-to-session'
      && H(human.output(decision.record, captured)) === H(decision.output));
    const verified = decision.host.humanSource.verify({ source: captured.source, sourceRef: captured.source_ref, question, historical: true });
    require(verified?.outcome === 'verified' && verified.source_sha256 === H(captured.source));
    const previous = provider(execution), current = provider(configuration);
    require(H({ ...previous.manifest.value, instance_id: configuration.instance_id }) === H(current.manifest.value)
      && previous.profile_sha256 === current.profile_sha256, 'STANDARD_RETAINED_SESSION_PR_OPEN_PROVIDER_CHANGED');
    const proof = assertRetainedSessionPrOpenProof({ original_instance_id: instance.instance_id, original_instance_sha256: H(instance),
      original_configuration_sha256: H(execution), lineage_sha256: history.lineage_sha256,
      provider_sha256: H({ previous: previous.manifest.sha256, current: current.manifest.sha256, profile: current.profile_sha256 }),
      decision_material_sha256: H({ captured, question }),
      session_id: review.session_id, open_operation_id: entry.open_operation_id });
    const selected = new Map([open, push, admit, integration, delivery, finalizer, closed].map(row => [row.record.operation_id, row]));
    require(selected.size === 7);
    return { proof, owner, open, integration, review, history,
      lookup(id, binding) { const row = selected.get(id); require(row?.record.intent.binding_ref === binding); return row; } };
  }
  async function inspect(entry, { signal, readValidation } = {}) {
    require(!signal?.aborted && !artifacts.ownerPending(), 'STANDARD_RETAINED_SESSION_PR_OPEN_OWNER_UNSETTLED');
    const before = capture(entry), { owner } = before;
    const product = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files);
    const authority = createAuthority({ configuration: owner.execution, model: owner.instance.model, modelSource: owner.records[0].preview.snapshot.model_source,
      readSigningKey: owner.host.readKey, humanSource: owner.host.humanSource, readProductSnapshot: product, readProductSha256: () => H(product()), environment });
    require(authority.inspectDiagnostic(owner.instance).journal === null);
    const source = await createRetainedSessionIntegrationSource({ configuration: owner.execution, environment, createAuthority })
      .readRecorded(owner.instance.initial_parameters.entry_point, { signal, readValidation });
    require(H(owner.records[0].results[0].output.observations.continuation) === H(retainedSessionIntegrationContinuation(source.proof))
      && H(before.review) === H(source.plan.review)
      && before.integration.record.preview.prepared.plan.decision_source_sha256 === H(source.decision));
    const host = createStandardHostAuthority({ configuration, environment });
    require(host.githubProvider, 'STANDARD_RETAINED_SESSION_PR_OPEN_PROVIDER_REQUIRED');
    const recordAuthority = createStandardSessionPrRecordAuthority({ targetRoot: artifacts.root,
      readAcceptedOperation: (_instance, id, binding) => before.lookup(id, binding), pullRequestPort: host.githubProvider.sessionPullRequestPort });
    const canonical = await recordAuthority.readSource(owner.instance, { open_operation_id: entry.open_operation_id });
    for (const row of canonical.documents) require(artifacts.read(row.path, { required: true }).sha256 === row.sha256
      && artifacts.metadataHash(row.path) === row.metadata_sha256, 'STANDARD_RETAINED_SESSION_PR_OPEN_POSTIMAGE_CHANGED');
    const plan = before.integration.record.preview.prepared.plan;
    require(createLocalWorkflowBranchIntegration({ targetRoot: artifacts.root }).inspectIntegration({ operation_id: plan.operation_id,
      plan_sha256: H(plan), observed: plan.review.git }).status === 'confirmed', 'STANDARD_RETAINED_SESSION_PR_OPEN_GIT_CHANGED');
    require(!signal?.aborted && !artifacts.ownerPending() && H(capture(entry).proof) === H(before.proof));
    return before;
  }
  return Object.freeze({ inspect, readRecorded: capture });
}
