import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openCommonGitCheckpointPrefix, observeCommonCheckpointGit } from './standard-git-checkpoint-crash-producer-fixture.mjs';
import { verifyCommonGitCheckpointBoundaryWiring } from './standard-git-checkpoint-boundary-wiring-fixture-lib.mjs';
import { observeLocalProcessOwner } from '../../src/adapters/runtime/local-process-identity.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { iterateAgenticProcessSimulation } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const cut = process.argv.find(arg => arg.startsWith('--cut='))?.slice(6) ?? 'effect_returned';
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'files';
const workerBoundMs = Number(process.argv.find(arg => arg.startsWith('--checkpoint-worker-bound-ms='))?.split('=')[1] ?? 120000);
assert(['effect_returned', 'receipted', 'accepted'].includes(cut), 'GIT_RECOVERY_CUT_INVALID');
assert(['files', 'dual'].includes(mode), 'GIT_RECOVERY_MODE_INVALID');
assert([120000, 300000].includes(workerBoundMs), 'GIT_CHECKPOINT_WORKER_BOUND_INVALID');
const wiring = await verifyCommonGitCheckpointBoundaryWiring();
console.error(JSON.stringify(wiring));
if (process.argv.includes('--wiring-only')) { console.log(JSON.stringify(wiring)); process.exit(0); }

// Each cut gets a fresh actual common-host prefix. Native, human and provider
// transports are identified doubles; the Git commit/ref/index port is real.
// There is no invented aggregate deadline. The producer below retains the
// selected dedicated checkpoint-worker bound, without renewing Native limits.
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-actual-git-recovery-'));
console.error(JSON.stringify({ actual_git_recovery_arena: base, mode, cut, retained: true }));
const prefixArgs = ['tools/perf/verify-agentic-process-execution-fixtures.mjs',
  '--standard-composed-mode=' + mode, '--standard-composed-stop=session_pr_correction_decide',
  '--standard-composed-scenario=correction', '--standard-composed-checkpoint-recovery-prefix', '--retain-always'];
const prefix = spawnSync(process.execPath, prefixArgs, {
  cwd: process.cwd(), encoding: 'utf8', windowsHide: true, maxBuffer: 1048576,
});
fs.writeFileSync(path.join(base, 'prefix.stdout.log'), prefix.stdout ?? '', { flag: 'wx' });
fs.writeFileSync(path.join(base, 'prefix.stderr.log'), prefix.stderr ?? '', { flag: 'wx' });
fs.writeFileSync(path.join(base, 'prefix.exit.json'), JSON.stringify({ args: prefixArgs,
  status: prefix.status, signal: prefix.signal, error_code: prefix.error?.code ?? null }) + '\n', { flag: 'wx' });
assert.equal(prefix.status, 0, 'ACTUAL_COMMON_PREFIX_FAILED:' + (prefix.stderr ?? '').slice(-4096));
const reports = prefix.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
const retained = reports.findLast(row => row.standard_checkpoint_recovery_prefix === true);
assert(retained, 'ACTUAL_COMMON_GIT_PREFIX_REPORT_REQUIRED');
const packet = JSON.parse(fs.readFileSync(retained.file, 'utf8'));
assert.equal(H(packet.authorization), retained.original_authorization_sha256);
assert.equal(packet.checkpoint_dispatched, false);
const producer = fileURLToPath(new URL('./standard-git-checkpoint-crash-producer-fixture.mjs', import.meta.url));
const producerStartedAtMs = Date.now(), producerDeadlineMs = producerStartedAtMs + workerBoundMs;
const child = fork(producer, ['--worker', retained.file, cut, String(producerDeadlineMs)], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let stderr = '', message, exit, timerExpired = false;
child.stdout.resume();
child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 16384) child.kill(); });
const ended = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
const timer = setTimeout(() => { timerExpired = true; child.kill(); }, Math.max(0, producerDeadlineMs - Date.now()));
let bound, original, capsuleBefore, stateBefore;
try {
  message = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', value => value.status === 'actual_git_checkpoint_boundary' && value.cut === cut
      ? resolve(value) : reject(Error('GIT_PRODUCER_UNEXPECTED_MESSAGE')));
    child.once('close', () => reject(Error('GIT_PRODUCER_CLOSED_BEFORE_BOUNDARY:' + stderr.slice(-4096))));
  });
  assert.equal(observeLocalProcessOwner(message.identity), 'active');
  bound = openCommonGitCheckpointPrefix(packet);
  original = bound.host.readOperation(message.operation_id);
  bound.signer.verify(original);
  assert.equal(H(original), message.journal_sha256);
  capsuleBefore = bound.artifacts.readMany(['workflows/dispatch-records/' + message.operation_id + '.json'], { includeMetadata: true });
  stateBefore = bound.host.inspect();
  if (cut === 'effect_returned') {
    const inventory = H(bound.artifacts.observeInventory());
    const live = await bound.host.prepareOperationDisposition(message.operation_id,
      { expectedSha256: stateBefore.record.instance_sha256 });
    assert.equal(live.assessment, 'unknown', 'LIVE_ORIGINAL_MUST_NOT_BECOME_A_CONFIRMED_RETURN');
    assert.equal(H(bound.artifacts.observeInventory()), inventory);
  }
  assert(Date.now() < producerDeadlineMs, 'GIT_CHECKPOINT_WORKER_BOUND_EXPIRED');
  assert.equal(observeLocalProcessOwner(message.identity), 'active');
  child.kill(); exit = await ended;
  assert.equal(observeLocalProcessOwner(message.identity), 'terminated');
} finally {
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  exit ??= await ended;
  timerExpired ||= Date.now() >= producerDeadlineMs;
  fs.writeFileSync(path.join(base, 'producer.exit.json'), JSON.stringify({ identity: message?.identity ?? null,
    exit, stderr, original_worker_bound_ms: workerBoundMs, started_at_ms: producerStartedAtMs,
    deadline_ms: producerDeadlineMs, closed_at_ms: Date.now(), timer_expired: timerExpired }) + '\n', { flag: 'wx' });
}
assert.equal(timerExpired, false);
const id = message.operation_id, root = packet.fixture.configuration.target_root;
const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args],
  { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
const head = git('rev-parse', 'HEAD'), count = git('rev-list', '--count', 'HEAD');
const observed = observeCommonCheckpointGit(root, original);
assert.equal(observed.proof.status, 'confirmed');
assert.equal(observed.proof.commit_sha, head);
assert.equal(observed.proof.parent_sha, original.preview.prepared.plan.git.observed.head);
assert.equal(observed.view.index_clean, true); assert.equal(observed.view.lock_present, false);
assert.equal(observed.view.changes.length, 0);
const recoveryProbe = { cut, operation_id: id, producer_identity: message.identity,
  producer_kernel_state: observeLocalProcessOwner(message.identity), actual_git: observed,
  original_journal_sha256: H(original), original_results: original.results.length,
  owner_pending: bound.artifacts.ownerPending(), original_authorization_sha256: H(packet.authorization),
  native_allocations_sha256: H(bound.host.inspectAllocations()), full_standard_workflow: false,
  genuine_Native_clients: 0, genuine_model_calls: 0, human_provider_authorities: 'FIXTURE' };
fs.writeFileSync(path.join(base, 'after-death-observation.json'), JSON.stringify(recoveryProbe) + '\n', { flag: 'wx' });
let result;
if (cut === 'effect_returned') {
  assert.equal(original.phase, 'dispatching'); assert.deepEqual(original.results, []);
  await assert.rejects(bound.host.reconcileCorrectionCheckpoint(id), { code: 'STANDARD_HOST_EXPLICIT_WRITE_REQUIRED' });
  const denied = openCommonGitCheckpointPrefix(packet, { authorize() {
    throw Object.assign(Error('FIXTURE_GIT_CURRENT_GRANT_REQUIRED'), { code: 'FIXTURE_GIT_CURRENT_GRANT_REQUIRED' });
  } });
  const inventory = H(bound.artifacts.observeInventory());
  await assert.rejects(denied.host.reconcileCorrectionCheckpoint(id, { write: true }),
    { code: 'FIXTURE_GIT_CURRENT_GRANT_REQUIRED' });
  assert.equal(H(bound.artifacts.observeInventory()), inventory);
  const contender = openCommonGitCheckpointPrefix(packet);
  const competitors = await Promise.allSettled([
    bound.host.reconcileCorrectionCheckpoint(id, { write: true }),
    contender.host.reconcileCorrectionCheckpoint(id, { write: true }),
  ]);
  fs.writeFileSync(path.join(base, 'competing-recovery.json'), JSON.stringify(competitors.map(row =>
    row.status === 'fulfilled' ? { status: row.status, value: row.value }
      : { status: row.status, code: row.reason.code ?? null, message: row.reason.message })) + '\n', { flag: 'wx' });
  assert.equal(competitors.filter(row => row.status === 'fulfilled' && row.value.status === 'receipted').length, 1);
  for (const row of competitors.filter(row => row.status === 'rejected')) assert([
    'PROCESS_JOURNAL_OWNER_CHANGED', 'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_REQUIRED',
    'STANDARD_PR_CORRECTION_CHECKPOINT_DISPATCH_CHANGED',
  ].includes(row.reason.code), row.reason.code);
  result = competitors.find(row => row.status === 'fulfilled' && row.value.status === 'receipted').value;
  const recovered = bound.host.readOperation(id);
  for (const field of ['preview', 'intent', 'grant', 'owner']) assert.deepEqual(recovered[field], original[field]);
  assert.equal(recovered.results.length, 1); assert.equal(recovered.revision, original.revision + 1);
  assert.equal(recovered.results[0].output.observations.reconciliation, 'observed-existing-commit');
  assert.equal(recovered.results[0].output.observations.dispatch_sha256, H(original));
  assert.equal(result.receipt.effect_status, 'confirmed'); assert.equal(result.receipt.outcome, 'completed');
  assert.equal(bound.host.inspect().record.instance_sha256, stateBefore.record.instance_sha256);
  assert.equal((await bound.host.reconcileCorrectionCheckpoint(id, { write: true })).status, 'retained_result');
  assert.deepEqual(bound.host.readOperation(id), recovered);
} else {
  assert.equal(original.results.length, 1); result = { receipt: original.results[0].receipt };
  assert.equal(result.receipt.outcome, 'completed'); assert.equal(result.receipt.effect_status, 'confirmed');
}
const accepted = await bound.host.acceptOperation(id, { write: true });
if (cut === 'accepted') assert.equal(accepted.record.instance_sha256, stateBefore.record.instance_sha256);
const stable = bound.host.inspect().record;
assert.equal((await bound.host.acceptOperation(id, { write: true })).record.instance_sha256, stable.instance_sha256);
assert.equal(stable.events.filter(event => event.kind === 'operation_result' && event.receipt.operation_id === id).length, 1);
assert.deepEqual(bound.artifacts.readMany(['workflows/dispatch-records/' + id + '.json'], { includeMetadata: true }), capsuleBefore);
assert.equal(H(bound.host.inspectAllocations()), packet.native_allocations_sha256);
assert.equal(H(packet.authorization), packet.original_authorization_sha256);
assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('rev-list', '--count', 'HEAD'), count);
assert.deepEqual(observeCommonCheckpointGit(root, original), observed);
const initial = { instanceId: stable.instance_id, model: stable.model, policyPins: stable.policy_pins,
  scopeId: stable.scope_id, facts: stable.initial_facts, parameters: stable.initial_parameters };
let replay = createAgenticProcess(initial);
for (const event of stable.events) replay = advanceAgenticProcess(replay, event);
assert.deepEqual(replay, stable); assert.deepEqual(inspectAgenticProcess(replay), accepted.cursor);
let last, rows = 0;
for (const row of iterateAgenticProcessSimulation({ ...initial, events: stable.events })) { last = row; rows++; }
assert.equal(rows, stable.events.length + 1); assert.equal(last.instance_sha256, stable.instance_sha256);
assert.deepEqual(last.cursor, accepted.cursor);
console.log(JSON.stringify({ status: 'PASS_ACTUAL_COMMON_GIT_CRASH_RECOVERY_COMPONENT', mode, cut, base, root,
  retained_prefix: retained.file, operation_id: id, original_results: original.results.length,
  kernel_termination_observed: true, original_worker_bound_ms: workerBoundMs, timer_expired: false,
  new_confirmation_after_unreturned_effect: cut === 'effect_returned',
  competing_observers_single_append: cut === 'effect_returned', git_commit_repeated: false,
  original_capsule_bytes_and_metadata_preserved: true, separate_acceptance: true, replay_sim_equal: true,
  native_limits_unchanged: true, new_native_allocations: 0,
  genuine_Native_clients: 0, genuine_model_calls: 0, human_provider_authorities: 'FIXTURE',
  actual_public_entry: 'NOT_RUN', installed_archive: 'NOT_RUN', full_standard_workflow: false }));
