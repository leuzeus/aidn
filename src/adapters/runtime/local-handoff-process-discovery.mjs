import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentRunPhysicalPath, readAgentRunFile } from '../../application/runtime/agent-run-configuration-service.mjs';
import { observeLocalProcess } from './local-process-identity.mjs';
import { assertHandoffProcessObservation } from '../../core/workflow/handoff-process-observation.mjs';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
const script = fileURLToPath(new URL('./local-handoff-process-discovery.ps1', import.meta.url));
const active = signal => { if (signal?.aborted) fail('HANDOFF_PROCESS_OBSERVATION_ABORTED'); };
const sampleMaterial = row => ({ processes: row.processes, unavailable: row.unavailable });
function marker(command, root) {
  const text = command, endCharacters = '/"\' ,;)]}';
  let offset = text.indexOf(root);
  while (offset >= 0) {
    const end = offset + root.length;
    if (end === text.length || endCharacters.includes(text[end]) || /\s/u.test(text[end])) return true;
    offset = text.indexOf(root, offset + 1);
  }
  return false;
}
function linuxSample(roots, nativeName) {
  const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const rows = [];
  for (const name of fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name))) {
    const pid = Number(name), prefix = '/proc/' + name + '/';
    try {
      const stat = fs.readFileSync(prefix + 'stat', 'utf8'), split = stat.lastIndexOf(')'), fields = stat.slice(split + 2).split(' ');
      if (fields[0] === 'Z') continue;
      let command = null, image = null;
      try { command = fs.readFileSync(prefix + 'cmdline', 'utf8').replaceAll('\0', ' '); } catch (cause) { if (cause.code === 'ENOENT') continue; }
      try { image = fs.readlinkSync(prefix + 'exe'); } catch {}
      const second = fs.readFileSync(prefix + 'stat', 'utf8'), secondFields = second.slice(second.lastIndexOf(')') + 2).split(' ');
      rows.push({ pid, parent_pid: Number(fields[1]), start: fields[19], creation: boot + ':' + fields[19],
        name: stat.slice(stat.indexOf('(') + 1, split), command, image, identity_changed: secondFields[19] !== fields[19] });
    } catch (cause) { if (!['ENOENT', 'ESRCH'].includes(cause.code)) fail('HANDOFF_PROCESS_DISCOVERY_UNAVAILABLE'); }
  }
  const byId = new Map(rows.map(row => [row.pid, row])), scoped = new Map(), unavailable = [], processes = [];
  for (const row of rows) if (row.command) {
    const root = roots.find(root => marker(row.command, root.path));
    if (root) scoped.set(row.pid, { root: root.sha256, basis: 'marker' });
  }
  let added;
  do {
    added = false;
    for (const row of rows) if (!scoped.has(row.pid) && scoped.has(row.parent_pid)) {
      const parent = byId.get(row.parent_pid);
      if (parent && BigInt(row.start) >= BigInt(parent.start)) { scoped.set(row.pid, { root: scoped.get(parent.pid).root, basis: 'descendant' }); added = true; }
    }
  } while (added);
  for (const row of rows) if (row.pid !== process.pid && scoped.has(row.pid)) {
    const match = scoped.get(row.pid);
    if (row.identity_changed) unavailable.push({ pid: row.pid, reason_code: 'SCOPED_PROCESS_IDENTITY_UNAVAILABLE', scope_root_sha256: match.root });
    else processes.push({ pid: row.pid, creation: row.creation, parent_pid: row.parent_pid,
      command_line_sha256: row.command === null ? null : artifactContentHash(row.command),
      image_path_sha256: row.image === null ? null : artifactContentHash(row.image),
      scope_root_sha256: match.root, scope_match: match.basis });
  } else if (row.pid !== process.pid && row.name === nativeName.slice(0, 15) && !row.command)
    unavailable.push({ pid: row.pid, reason_code: 'NATIVE_COMMAND_LINE_UNAVAILABLE', scope_root_sha256: null });
  return { captured_at_ms: Date.now(), scanned_processes: rows.length,
    processes: processes.sort((a, b) => a.pid - b.pid), unavailable: unavailable.sort((a, b) => a.pid - b.pid) };
}
// Current OS facts for configured path markers and their descendants. This
// primitive observes no provider state, grants nothing and never asserts
// complete resource closure. Native launches carry control-root log/SQLite
// arguments; opaque or unmarked executions need separate source coverage.
export function createLocalHandoffProcessDiscovery({ targetRoot, controlRoot, nativeExecutable }) {
  const physicalTarget = agentRunPhysicalPath(targetRoot, { directory: true });
  const physicalControl = agentRunPhysicalPath(controlRoot, { directory: true });
  const executable = agentRunPhysicalPath(nativeExecutable);
  const observer = observeLocalProcess(process.pid);
  if (!observer || !fs.statSync(executable).isFile()) fail('HANDOFF_PROCESS_DISCOVERY_UNAVAILABLE');
  const roots = [...new Set([physicalTarget, physicalControl])].sort((a, b) => b.length - a.length)
    .map(root => ({ path: root, sha256: artifactContentHash(root) }));
  const scope = H({ target_root: physicalTarget, control_root: physicalControl, native_executable: executable, observer_identity: observer });
  return Object.freeze({
    observe({ signal } = {}) {
      active(signal);
      let samples, implementation;
      if (process.platform === 'win32') {
        const queryId = randomUUID(), before = readAgentRunFile(script, { json: false, maxBytes: 131072 });
        const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
        let response;
        try {
          response = JSON.parse(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', before.value.toString('utf8')], {
            input: JSON.stringify({ version: 1, query_id: queryId, roots, native_name: path.basename(executable), observer_pid: process.pid }),
            encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim());
        } catch { fail('HANDOFF_PROCESS_DISCOVERY_UNAVAILABLE'); }
        if (response.version !== 1 || response.query_id !== queryId || response.observer_creation !== observer.creation
          || !Number.isSafeInteger(response.query_pid) || response.query_pid === process.pid
          || readAgentRunFile(script, { json: false, maxBytes: 131072 }).sha256 !== before.sha256)
          fail('HANDOFF_PROCESS_DISCOVERY_CHANGED');
        implementation = before.sha256; samples = response.samples;
        if (samples.some(sample => [...sample.processes, ...sample.unavailable].some(row => row.pid === response.query_pid)))
          fail('HANDOFF_PROCESS_DISCOVERY_CHANGED');
      } else if (process.platform === 'linux') {
        implementation = readAgentRunFile(fileURLToPath(import.meta.url), { json: false, maxBytes: 131072 }).sha256;
        samples = [linuxSample(roots, path.basename(executable)), linuxSample(roots, path.basename(executable))];
        if (readAgentRunFile(fileURLToPath(import.meta.url), { json: false, maxBytes: 131072 }).sha256 !== implementation) fail('HANDOFF_PROCESS_DISCOVERY_CHANGED');
      } else fail('HANDOFF_PROCESS_DISCOVERY_UNAVAILABLE');
      active(signal);
      if (H(observeLocalProcess(process.pid)) !== H(observer)) fail('HANDOFF_PROCESS_DISCOVERY_CHANGED');
      return freezeShadow(assertHandoffProcessObservation({ contract_version: 'handoff-process-observation.v1',
        coverage_basis: 'configured_path_markers_and_descendants', scope_sha256: scope,
        scope_root_sha256: roots.map(root => root.sha256), observer_identity: observer, query_implementation_sha256: implementation,
        samples, stable: H(sampleMaterial(samples[0])) === H(sampleMaterial(samples[1])), snapshot_only: true,
        complete_resource_closure: false, permits_handoff: false, permits_effects: false, written: false }));
    },
  });
}
