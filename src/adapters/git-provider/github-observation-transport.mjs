import { spawn } from 'node:child_process';

const failure = code => Object.assign(Error(code), { code, effect_status: 'no_effect' });
// Both reader interfaces consume the same protocol. The synchronous historical
// interface stays synchronous; only the explicitly asynchronous host awaits I/O.
export function driveGithubObservation(protocol, run) {
  let step = protocol.next();
  while (!step.done) {
    try { step = protocol.next(run(...step.value)); }
    catch (cause) { step = protocol.throw(cause); }
  }
  return step.value;
}
export async function driveGithubObservationAsync(protocol, run, signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw failure('GITHUB_OBSERVATION_SIGNAL_INVALID');
  const check = () => { if (signal?.aborted) throw failure('GITHUB_OBSERVATION_ABORTED'); };
  check(); let step = protocol.next();
  while (!step.done) {
    // Throw transport errors into the common parser, retaining its historical
    // refusal codes. Cancellation itself is never consumed as a provider result.
    let result;
    try { result = await run(...step.value.slice(0, 2), { ...step.value[2], signal }); }
    catch (cause) { check(); step = protocol.throw(cause); continue; }
    check(); step = protocol.next(result);
  }
  check(); return step.value;
}

// Fixed readers supply argv/stdin and a pinned executable. No shell, model or
// background polling. Abort/timeout rejects only after the direct child's close
// event: an aborted response cannot race a successful observation. This is not
// the general native process-tree reconciliation/closure authority.
export function runGithubObservationCommand(executable, args, options) {
  return new Promise((resolve, reject) => {
    const { signal, timeout, maxBuffer, input, cwd, env } = options;
    if (signal?.aborted) { reject(failure('GITHUB_OBSERVATION_ABORTED')); return; }
    if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1) {
      reject(failure('GITHUB_OBSERVATION_TRANSPORT_INVALID')); return;
    }
    let child, reason, timer, stdout = [], bytes = 0;
    const stop = code => { reason ??= code; child?.kill('SIGKILL'); };
    const abort = () => stop('GITHUB_OBSERVATION_ABORTED');
    try { child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(failure('GITHUB_OBSERVATION_UNAVAILABLE')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => stop('GITHUB_OBSERVATION_TIMEOUT'), timeout);
    child.on('error', () => { reason ??= 'GITHUB_OBSERVATION_UNAVAILABLE'; });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBuffer) stop('GITHUB_OBSERVATION_BUFFER_LIMIT');
      else stdout.push(chunk);
    });
    // Drain but never expose provider stderr, credentials or response bodies in
    // errors. Count it against the same finite transport buffer budget.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxBuffer) stop('GITHUB_OBSERVATION_BUFFER_LIMIT'); });
    child.stdin.on('error', () => stop('GITHUB_OBSERVATION_UNAVAILABLE'));
    child.on('close', (status, terminationSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (reason) reject(failure(reason));
      else resolve({ status, signal: terminationSignal, stdout: Buffer.concat(stdout).toString('utf8') });
      stdout = [];
    });
    child.stdin.end(input);
  });
}
