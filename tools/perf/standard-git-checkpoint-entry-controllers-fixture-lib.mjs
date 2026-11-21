import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { observeLocalProcessOwner } from '../../src/adapters/runtime/local-process-identity.mjs';

// Two real fixture processes, with the production entry service and identified
// provider transport. The surrounding case's Windows Job confines descendants.
// A direct PID observation below establishes no business-resource closure.
export async function runPublicCheckpointEntryControllers({ producerFile, prefixFile, actionFile, evidenceRoot, boundMs }) {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const workers = [1, 2].map(index => {
    const started = Date.now(), deadline = started + boundMs;
    const resultFile = path.join(evidenceRoot, 'public-controller-' + index + '.result.json');
    const child = fork(producerFile, ['--entry-controller', prefixFile, actionFile, resultFile, String(deadline)],
      { windowsHide: true, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const worker = { index, child, resultFile, started, deadline, identity: null, stdout: '', stderr: '', oversized: false };
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
      worker[stream] += bytes;
      if (Buffer.byteLength(worker[stream]) > 16384) { worker.oversized = true; child.kill(); }
    });
    worker.closed = new Promise(resolve => child.once('close', (code, signal) => {
      worker.exit = { code, signal }; worker.closedAt = Date.now(); resolve(worker.exit);
    }));
    worker.ready = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('message', message => {
        if (message.status !== 'public_checkpoint_controller_ready') return reject(Error('PUBLIC_CONTROLLER_MESSAGE_INVALID'));
        worker.identity = message.identity; resolve(message);
      });
      child.once('close', () => { if (!worker.identity) reject(Error('PUBLIC_CONTROLLER_CLOSED_BEFORE_READY')); });
    });
    worker.timer = setTimeout(() => child.kill(), Math.max(0, deadline - Date.now()));
    return worker;
  });
  try {
    await Promise.all(workers.map(worker => worker.ready));
    assert.notEqual(workers[0].identity.pid, workers[1].identity.pid);
    for (const worker of workers) {
      assert.equal(observeLocalProcessOwner(worker.identity), 'active');
      assert(Date.now() < worker.deadline, 'PUBLIC_CONTROLLER_ORIGINAL_BOUND_EXPIRED');
    }
    for (const worker of workers) worker.child.send({ kind: 'apply_prepared_checkpoint_action' });
    await Promise.all(workers.map(worker => worker.closed));
  } finally {
    for (const worker of workers) {
      clearTimeout(worker.timer);
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill();
    }
    await Promise.all(workers.map(worker => worker.closed));
    for (const worker of workers) {
      for (const stream of ['stdout', 'stderr']) fs.writeFileSync(path.join(evidenceRoot,
        'public-controller-' + worker.index + '.' + stream + '.log'), worker[stream], { flag: 'wx' });
      fs.writeFileSync(path.join(evidenceRoot, 'public-controller-' + worker.index + '.exit.json'),
        JSON.stringify({ identity: worker.identity, exit: worker.exit, started_at_ms: worker.started,
          deadline_ms: worker.deadline, closed_at_ms: worker.closedAt, original_worker_bound_ms: boundMs,
          bound_expired: worker.closedAt >= worker.deadline, oversized: worker.oversized,
          stdout_sha256: sha(worker.stdout), stderr_sha256: sha(worker.stderr),
          business_resource_closure: 'NOT_PROVEN_BY_PID' }) + '\n', { flag: 'wx' });
    }
  }
  const results = workers.map(worker => {
    assert(!worker.oversized); assert(worker.closedAt < worker.deadline, 'PUBLIC_CONTROLLER_ORIGINAL_BOUND_EXPIRED');
    assert([0, 2].includes(worker.exit.code), JSON.stringify(worker.exit) + ':' + worker.stderr.slice(-2048));
    assert.equal(observeLocalProcessOwner(worker.identity), 'terminated');
    const result = JSON.parse(fs.readFileSync(worker.resultFile, 'utf8'));
    assert.deepEqual(result.identity, worker.identity);
    assert.equal(worker.exit.code, result.status === 'fulfilled' ? 0 : 2);
    return { ...result, exit: worker.exit, result_file: worker.resultFile, kernel_termination_observed: true };
  });
  assert(Math.max(...results.map(row => row.started_at_ms)) < Math.min(...results.map(row => row.ended_at_ms)),
    'PUBLIC_CONTROLLERS_MUST_OVERLAP');
  return results;
}
