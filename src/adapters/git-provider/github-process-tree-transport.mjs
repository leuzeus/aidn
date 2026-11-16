import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { readAgentRunFile, agentRunPhysicalPath } from '../../application/runtime/agent-run-configuration-service.mjs';
import { createWindowsProcessTreeController } from '../agents/process-tree/windows-process-tree-controller.mjs';
import { observeLocalProcess } from '../runtime/local-process-identity.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';

const moduleFile = fileURLToPath(import.meta.url);
const helperSource = fileURLToPath(new URL('../agents/process-tree/windows-job-helper.cs', import.meta.url));
const error = (code, resumed = false) => Object.assign(Error(code), { code, effect_status: resumed ? 'unknown' : 'no_effect' });
const physicalKey = value => path.resolve(value).toLowerCase();

// A fixed host transport, never selected by request JSON. It closes the owned
// command tree; neither a successful command nor this observer grants effects
// or establishes all-provider/all-workflow resource closure.
export function createGithubProcessTreeTransport({ executable, helper, cwd, profileSha256, scopeRoot = null }) {
  const implementation = readAgentRunFile(moduleFile, { json: false, maxBytes: 131072 }).sha256;
  const home = agentRunPhysicalPath(cwd, { directory: true });
  const physicalScope = scopeRoot === null ? null : agentRunPhysicalPath(scopeRoot, { directory: true });
  const binary = Object.freeze({ ...executable }), pins = Object.freeze({ ...helper });
  const observer = observeLocalProcess(process.pid);
  if (!observer || !/^[a-f0-9]{64}$/.test(profileSha256 ?? '')
    || [binary.sha256, pins.sha256, pins.source_sha256].some(value => !/^[a-f0-9]{64}$/.test(value ?? '')))
    throw error('GITHUB_OBSERVATION_TREE_CONFIGURATION_INVALID');
  const controller = createWindowsProcessTreeController({ helperPath: pins.path, helperSha256: pins.sha256,
    helperSourceSha256: pins.source_sha256, candidateSha256: implementation, helperScopeRoot: physicalScope });
  const scope = H({ profile: profileSha256, cwd: home, scope_root: physicalScope, executable: binary, helper: pins, implementation, observer });
  const active = new Map(), recent = [];
  let revision = 0, closed = 0, notStarted = 0, unconfirmed = 0, closedDigest = H([]);
  function assertPins() {
    try {
      for (const [file, sha256, maxBytes] of [[moduleFile, implementation, 131072], [pins.path, pins.sha256, 67108864],
        [helperSource, pins.source_sha256, 1048576], [binary.path, binary.sha256, 134217728]])
        readAgentRunFile(file, { json: false, sha256, maxBytes });
      // This closure executes in its original process: its creation identity
      // cannot be reused while that process is still executing. Mutable files
      // and source permission retain their fresh checks.
      if (process.pid !== observer.pid || process.platform !== observer.platform || os.hostname() !== observer.host
        || agentRunPhysicalPath(home, { directory: true }) !== home
        || physicalScope !== null && agentRunPhysicalPath(physicalScope, { directory: true }) !== physicalScope)
        throw error('GITHUB_OBSERVATION_TREE_BINDING_CHANGED');
    } catch { throw error('GITHUB_OBSERVATION_TREE_BINDING_CHANGED'); }
  }
  function observeResources() {
    assertPins();
    return freezeShadow({ contract_version: 'github-command-process-snapshot.v1', scope_sha256: scope,
      observer_identity: observer, revision, active_commands: [...active.values()].map(value => structuredClone(value)),
      confirmed_closed_commands: closed, not_started_commands: notStarted, unconfirmed_commands: unconfirmed,
      confirmed_history_sha256: closedDigest, recent_closures: structuredClone(recent),
      coverage_basis: 'commands_started_by_this_fixed_transport', snapshot_only: true,
      complete_resource_closure: false, permits_effects: false, permits_handoff: false, written: false });
  }
  async function run(command, args, options) {
    const started = performance.now(), { signal, timeout, maxBuffer, input, env, beforeResume } = options ?? {};
    if (signal?.aborted) throw error('GITHUB_OBSERVATION_ABORTED');
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 86400000
      || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || maxBuffer > 1073741824
      || !Array.isArray(args) || args.some(value => typeof value !== 'string' || value.includes('\0'))
      || typeof command !== 'string' || physicalKey(command) !== physicalKey(binary.path)
      || typeof options?.cwd !== 'string' || physicalKey(options.cwd) !== physicalKey(home)
      || beforeResume !== undefined && typeof beforeResume !== 'function'
      || signal !== undefined && !(signal instanceof AbortSignal)
      || input !== undefined && !(typeof input === 'string' || Buffer.isBuffer(input))
      || Buffer.byteLength(input ?? '') > 262144)
      throw error('GITHUB_OBSERVATION_TRANSPORT_INVALID');
    assertPins();
    const id = 'github.' + randomUUID(), deadline = new AbortController();
    // This is the caller's original per-command budget, including preparation.
    // The controller's timeoutSignal can only shorten its finite request.
    const remaining = () => Math.floor(timeout - (performance.now() - started));
    const timer = setTimeout(() => deadline.abort(), Math.max(1, remaining()));
    let resumed = false, mayHaveResumed = false, invoked = false, proof = null, firstError = null, output = [], outputBytes = 0;
    const check = () => {
      if (signal?.aborted) throw error('GITHUB_OBSERVATION_ABORTED', resumed);
      if (deadline.signal.aborted || remaining() <= 0) throw error('GITHUB_OBSERVATION_TIMEOUT', resumed);
      assertPins();
    };
    revision++;
    active.set(id, { command_id: id, command_sha256: H({ executable: binary, args,
      input_sha256: createHash('sha256').update(input ?? '').digest('hex') }),
      phase: 'preparing', pid: null, job_name: null });
    try {
      check();
      invoked = true;
      proof = await controller.run({ runnerId: id, executable: binary.path, executableSha256: binary.sha256,
        args, cwd: home, env, stdin: input ?? '', maxDurationMs: Math.max(1, remaining()), maxOutputBytes: maxBuffer,
        maxPendingBytes: Math.min(16777216, Math.max(16384, maxBuffer)), stopTimeoutMs: 5000 },
      { signal, timeoutSignal: deadline.signal, async onEvent(event) {
        const row = active.get(id);
        if (event.type === 'prepared') {
          Object.assign(row, { phase: 'prepared', pid: event.pid, job_name: event.job_name });
          try { check(); await beforeResume?.(remaining()); check(); mayHaveResumed = true; }
          catch (cause) {
            firstError = error(/^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '') ? cause.code : 'GITHUB_OBSERVATION_PERMISSION_CHANGED');
            throw firstError;
          }
        } else if (event.type === 'resumed') { resumed = true; mayHaveResumed = true; row.phase = 'resumed'; }
        else if (event.type === 'stdout') {
          outputBytes += event.bytes.length;
          if (outputBytes > maxBuffer) { firstError = error('GITHUB_OBSERVATION_BUFFER_LIMIT', resumed); throw firstError; }
          output.push(event.bytes);
        }
        // The controller drains and bounds stderr, without retaining its data here.
      } });
      if (proof.termination_state === 'confirmed' && proof.termination_proof?.active_processes === 0) {
        closed++;
        const closure = { command_id: id, outcome: proof.outcome, reason_code: proof.reason_code,
          termination_proof: proof.termination_proof, hashes: proof.hashes };
        closedDigest = H({ previous: closedDigest, closure }); recent.push(closure);
        if (recent.length > 32) recent.shift();
      } else if (proof.termination_state === 'not_started') notStarted++;
      else unconfirmed++;
      if (firstError) throw firstError;
      if (signal?.aborted || proof.outcome === 'cancelled') throw error('GITHUB_OBSERVATION_ABORTED', resumed);
      if (deadline.signal.aborted || proof.outcome === 'timed_out') throw error('GITHUB_OBSERVATION_TIMEOUT', resumed);
      if (/OUTPUT|BUFFER/.test(proof.reason_code)) throw error('GITHUB_OBSERVATION_BUFFER_LIMIT', resumed);
      if (proof.termination_state === 'not_started') throw error('GITHUB_OBSERVATION_TREE_CONTROL_UNAVAILABLE');
      if (proof.termination_state !== 'confirmed' || proof.termination_proof?.active_processes !== 0)
        throw error('GITHUB_OBSERVATION_TREE_CLOSURE_UNCONFIRMED', resumed);
      if (!resumed || !Number.isSafeInteger(proof.exit_code)) throw error('GITHUB_OBSERVATION_UNAVAILABLE', resumed);
      assertPins();
      return { status: proof.exit_code, signal: proof.signal, stdout: Buffer.concat(output).toString('utf8') };
    } catch (cause) {
      if (!proof) { if (invoked) unconfirmed++; else notStarted++; }
      if (/^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? '')) throw error(cause.code, mayHaveResumed);
      throw error('GITHUB_OBSERVATION_TREE_CLOSURE_UNCONFIRMED', mayHaveResumed);
    } finally { clearTimeout(timer); active.delete(id); revision++; output = []; }
  }
  return Object.freeze({ run, observeResources, assertCurrent(snapshot) {
    if (H(snapshot) !== H(observeResources())) throw error('GITHUB_OBSERVATION_TREE_SNAPSHOT_CHANGED');
  } });
}
