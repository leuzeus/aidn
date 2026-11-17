import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStandardWorkflowExecution, loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { readAgenticProductSnapshot } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../src/adapters/runtime/local-workflow-git-checkpoint.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
import { createGithubPrOpenTransportFixture } from './github-pr-open-fixture-lib.mjs';
import { createComposedGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createStandardReviewEventFixture } from './standard-pr-review-event-fixture-lib.mjs';
import { closureHumanSource } from './cycle-closure-fixture-lib.mjs';
import { attachComposedR09Provider } from './standard-composed-r09-provider-fixture-lib.mjs';
import { resolveStandardWorkflowConfiguration, runStandardWorkflowEntry } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { observeLocalProcess } from '../../src/adapters/runtime/local-process-identity.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertStandardPrCorrectionCheckpointPlan } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

// Public fixture key and controlled authorities only. The common host, signed
// journal, actual Git commit/ref/index port and kernel producer identity are real.
const key = () => Buffer.alloc(32, 91);
export const commonGitFixtureGrant = () => ({ authorized: true, authority_id: 'fixture_operator',
  principal_sha256: 'a'.repeat(64), grant_sha256: 'b'.repeat(64) });

export function openCommonCheckpointFixtureHost(f, { authorize = null, dispatchCheckpoint } = {}) {
  const configuration = f.configuration;
  if (f.r09Request) assert.deepEqual(resolveStandardWorkflowConfiguration(f.r09Request).configuration, configuration);
  const r09 = f.r09Request ? attachComposedR09Provider({ configuration, remoteRoot: f.sessionPushRemoteRoot, initialize: false }) : null;
  const fixtureKey = r09?.authority.readKey ?? key;
  const options = { configuration, readSigningKey: fixtureKey,
    authorize: authorize ?? (r09 ? input => r09.authority.authorizeOperation(input, input.preview_sha256) : commonGitFixtureGrant),
    ...(r09 ? { environment: r09.environment } : {}),
    humanSource: r09?.authority.humanSource ?? closureHumanSource(f.human_source_file), validationProfile: f.validationProfile,
    sessionPushPort: f.sessionPushRemoteRoot ? createLocalWorkflowSessionPush({ targetRoot: configuration.target_root, remoteRoot: f.sessionPushRemoteRoot }) : null,
    sessionPullRequestPort: f.sessionPushRemoteRoot ? createGithubPrOpenTransportFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: configuration.control_root }).port : null,
    sessionReviewPort: r09?.provider.sessionReviewPort ?? (f.sessionPushRemoteRoot ? createComposedGithubReviewFixture({ remoteRoot: f.sessionPushRemoteRoot, controlRoot: configuration.control_root }) : null),
    sessionReviewEventPort: r09?.provider.sessionReviewEventPort ?? (f.sessionPushRemoteRoot ? createStandardReviewEventFixture(configuration.control_root) : null) };
  const host = createStandardWorkflowExecution(options);
  let operationActor = null;
  if (dispatchCheckpoint) {
    // The mixed host does not expose this test adapter. Attach it to its real
    // operation port, with the same published model, authority, ports, key and
    // canonical instance. No dispatch record or business result is synthesized.
    const assets = loadStandardWorkflowAssets();
    const productSnapshot = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files);
    const processAuthority = createStandardProcessAuthority({ configuration, model: assets.model,
      modelSource: assets.source, readSigningKey: fixtureKey, humanSource: options.humanSource,
      ...(r09 ? { environment: r09.environment } : {}),
      readProductSnapshot: productSnapshot, readProductSha256: () => H(productSnapshot()) });
    operationActor = createStandardWorkflowOperationHost({ ...options, targetRoot: configuration.target_root,
      model: assets.model, modelSource: assets.source, processAuthority,
      reconciliationConfiguration: configuration }, { dispatchCheckpoint });
  }
  return { host, operationActor, artifacts: createStandardWorkflowArtifacts({ targetRoot: configuration.target_root }),
    signer: createOperationJournalSigner(fixtureKey), publicFixture: r09 };
}

export function openCommonGitCheckpointPrefix(packet, options = {}) {
  assert.equal(packet.contract_version, 'fixture-standard-git-checkpoint-prefix.v1');
  assert.equal(packet.proof_class, 'offline-fixture-only');
  assert.equal(H(packet.authorization), packet.original_authorization_sha256);
  const bound = openCommonCheckpointFixtureHost(packet.fixture, options), { host, signer } = bound;
  const state = host.inspect().record;
  assert.equal(state.model_sha256, packet.model_sha256);
  assert.equal(state.scope_id, packet.scope_id);
  assert.equal(H(state.events.slice(0, packet.event_prefix_count)), packet.event_prefix_sha256);
  assert.equal(H(host.inspectAllocations()), packet.native_allocations_sha256);
  signer.verify(packet.checkpoint_preview);
  assert.equal(H(packet.checkpoint_preview), packet.checkpoint_preview_sha256);
  for (const row of packet.retained_operations) {
    const record = host.readOperation(row.operation_id); signer.verify(record); signer.verify(record.preview);
    assert.equal(H(record), row.record_sha256);
  }
  return bound;
}

export function observeCommonCheckpointGit(root, record, { commitWitness = true } = {}) {
  const prepared = record.preview.prepared, plan = assertStandardPrCorrectionCheckpointPlan(prepared.plan);
  assert.equal(record.intent.binding_ref, 'session_pr_correction_checkpoint');
  assert.equal(plan.operation_id, record.operation_id);
  assert.equal(H(plan), prepared.plan_sha256);
  assert(plan.git.files.length > 0);
  const port = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: 'cycle-terminal',
    approvedPaths: plan.git.files.map(row => row.path) });
  return { view: port.inspect(), proof: commitWitness ? port.inspectCommit({ ...plan.git, operation_id: plan.operation_id,
    prepared_at_ms: plan.prepared_at_ms, plan_sha256: prepared.plan_sha256 }) : null };
}

async function runProducer(prefixFile, cut, deadlineMs) {
  assert(['dispatch_reserved', 'effect_returned', 'receipted', 'accepted'].includes(cut));
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs > Date.now(), 'GIT_CHECKPOINT_WORKER_BOUND_EXPIRED');
  // Independent of the observing parent's synchronous inventory work. The
  // absolute deadline is supplied once at fork and is never renewed.
  setTimeout(() => process.exit(124), deadlineMs - Date.now()).unref();
  assert.equal(typeof process.send, 'function', 'OWNED_CHECKPOINT_CHILD_IPC_REQUIRED');
  const packet = JSON.parse(fs.readFileSync(prefixFile, 'utf8'));
  const phaseFile = path.join(packet.fixture.configuration.control_root, 'git-checkpoint-producer-' + cut + '-' + process.pid + '.jsonl');
  const phase = (point, extra = {}) => fs.appendFileSync(phaseFile, JSON.stringify({ point, pid: process.pid, at_ms: Date.now(), ...extra }) + '\n');
  phase('worker_entered'); process.on('message', () => {});
  let bound, priorPublicActionFile = null;
  const pause = async operationId => {
    const record = bound.host.readOperation(operationId); bound.signer.verify(record); bound.signer.verify(record.preview);
    const capsule = JSON.parse(bound.artifacts.read('workflows/dispatch-records/' + operationId + '.json', { required: true }).content);
    bound.signer.verify(capsule); assert.equal(capsule.process_identity.pid, process.pid);
    const observed = observeCommonCheckpointGit(packet.fixture.configuration.target_root, record,
      { commitWitness: cut !== 'dispatch_reserved' });
    if (cut === 'dispatch_reserved') {
      assert.equal(capsule.phase, 'reserved'); assert.deepEqual(record.results, []);
      assert.equal(observed.view.head, record.preview.prepared.plan.git.observed.head);
    } else {
      assert.equal(observed.proof.status, 'confirmed'); assert.equal(observed.view.head, observed.proof.commit_sha);
      assert.equal(observed.view.index_clean, true); assert.equal(observed.view.lock_present, false);
      if (cut === 'effect_returned') {
        assert.equal(capsule.phase, 'running'); assert.equal(capsule.output, null); assert.equal(capsule.output_sha256, null);
        assert.deepEqual(record.results, []);
      } else {
        assert.equal(capsule.phase, 'returned'); assert.equal(record.results.length, 1);
        assert.equal(record.results[0].receipt.effect_status, 'confirmed');
      }
    }
    const accepted = bound.host.inspect().record.events.some(event => event.kind === 'operation_result' && event.receipt.operation_id === operationId);
    assert.equal(accepted, cut === 'accepted');
    assert.equal(H(bound.host.inspectAllocations()), packet.native_allocations_sha256);
    phase('requested_boundary_observed', { cut, operation_id: operationId });
    process.send({ status: 'actual_git_checkpoint_boundary', cut, operation_id: operationId,
      identity: capsule.process_identity, capsule_sha256: H(capsule), journal_sha256: H(record),
      git: observed, phase_file: phaseFile, accepted, prior_public_action_file: priorPublicActionFile,
      genuine_Native_clients: 0, genuine_model_calls: 0 });
    await new Promise(() => {});
  };
  bound = openCommonGitCheckpointPrefix(packet, { dispatchCheckpoint: async (point, operationId) => {
    phase(point, { operation_id: operationId });
    if (point === cut && ['dispatch_reserved', 'effect_returned'].includes(cut)) await pause(operationId);
  } });
  assert.equal(bound.host.inspect().record.instance_sha256, packet.instance_sha256);
  assert(bound.operationActor, 'ACTUAL_CHECKPOINT_OPERATION_PORT_REQUIRED');
  const staged = await bound.operationActor.stage(packet.checkpoint_preview,
    { write: true, expectedPreviewSha256: packet.checkpoint_preview_sha256 });
  const result = await bound.operationActor.dispatch(staged.operation_id, { write: true });
  assert.equal(result.status, 'receipted'); assert.equal(result.receipt.effect_status, 'confirmed');
  if (cut === 'receipted') await pause(staged.operation_id);
  if (cut === 'accepted') {
    if (bound.publicFixture) {
      const inventoryBefore = H(bound.artifacts.observeInventory());
      const prepared = await runStandardWorkflowEntry({ request: packet.fixture.r09Request,
        environment: bound.publicFixture.environment }, { providerTransport: bound.publicFixture.providerTransport });
      assert.equal(prepared.written, false); assert.equal(prepared.preview.kind, 'dispatch');
      assert.equal(prepared.preview.payload.operation_id, staged.operation_id);
      assert.equal(H(bound.artifacts.observeInventory()), inventoryBefore);
      priorPublicActionFile = path.join(packet.fixture.configuration.control_root,
        'git-checkpoint-preacceptance-action-' + process.pid + '.json');
      fs.writeFileSync(priorPublicActionFile, JSON.stringify(prepared.preview) + '\n', { flag: 'wx' });
    }
    await bound.host.acceptOperation(staged.operation_id, { write: true });
    await pause(staged.operation_id);
  }
  throw Error('GIT_CHECKPOINT_REQUESTED_BOUNDARY_NOT_REACHED');
}

async function runEntryController(prefixFile, actionFile, resultFile, deadlineMs) {
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs > Date.now(), 'GIT_CHECKPOINT_WORKER_BOUND_EXPIRED');
  assert.equal(typeof process.send, 'function', 'OWNED_CHECKPOINT_CHILD_IPC_REQUIRED');
  const timer = setTimeout(() => process.exit(124), deadlineMs - Date.now());
  try {
    const packet = JSON.parse(fs.readFileSync(prefixFile, 'utf8'));
    assert(packet.fixture.r09Request, 'RETAINED_PUBLIC_HOST_CONFIGURATION_REQUIRED');
    const action = JSON.parse(fs.readFileSync(actionFile, 'utf8'));
    assert.equal(action.kind, 'dispatch');
    const bound = openCommonCheckpointFixtureHost(packet.fixture);
    assert(bound.publicFixture, 'RETAINED_PUBLIC_HOST_CONFIGURATION_REQUIRED');
    const identity = observeLocalProcess(process.pid);
    const go = new Promise(resolve => process.once('message', message => {
      assert.equal(message.kind, 'apply_prepared_checkpoint_action'); resolve();
    }));
    process.send({ status: 'public_checkpoint_controller_ready', identity });
    await go;
    const startedAtMs = Date.now(); let outcome;
    try {
      const applied = await runStandardWorkflowEntry({ request: packet.fixture.r09Request,
        environment: bound.publicFixture.environment, preparedAction: action, execute: true, expectPlan: H(action) },
      { providerTransport: bound.publicFixture.providerTransport });
      outcome = { status: 'fulfilled', applied };
    } catch (error) {
      outcome = { status: 'rejected', error: { code: error.code ?? null, message: String(error.message).slice(0, 4096) } };
      process.exitCode = 2;
    }
    fs.writeFileSync(resultFile, JSON.stringify({ ...outcome, identity, started_at_ms: startedAtMs,
      ended_at_ms: Date.now(), actual_public_service: true, provider_transport: 'IDENTIFIED_FIXTURE',
      genuine_Native_clients: 0, genuine_model_calls: 0, full_standard: false }) + '\n', { flag: 'wx' });
    process.disconnect();
  } finally { clearTimeout(timer); }
}

if (process.argv[2] === '--worker') await runProducer(process.argv[3], process.argv[4], Number(process.argv[5]));
if (process.argv[2] === '--entry-controller') await runEntryController(process.argv[3], process.argv[4], process.argv[5], Number(process.argv[6]));
