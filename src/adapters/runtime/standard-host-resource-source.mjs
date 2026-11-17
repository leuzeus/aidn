import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createLocalHandoffProcessDiscovery } from './local-handoff-process-discovery.mjs';
import { observeLocalProcess } from './local-process-identity.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from '../../application/runtime/agent-run-configuration-service.mjs';
import { agenticProcessImplementationPins } from '../../application/runtime/agentic-process-implementation-pins.mjs';
import { createStandardWorkflowArtifacts } from '../../application/runtime/standard-workflow-artifacts.mjs';
import { createOperationJournalSigner } from '../../core/workflow/process-operation-journal.mjs';
import { assertProcessReconciliationInventory, RECONCILIATION_DISCOVERY_DOMAINS } from '../../core/workflow/process-reconciliation-inventory.mjs';
import { assertHandoffResourceRequest, assertHandoffResourceObservation } from '../../core/workflow/standard-handoff-resources.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';
import { handoffPublicationOperation } from '../../core/workflow/standard-handoff-operation.mjs';
import { handoffResourceOperation } from '../../core/workflow/standard-handoff-resource-operation.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const active = signal => { if (signal?.aborted) fail('STANDARD_RESOURCE_SOURCE_ABORTED'); };
const physical = value => agentRunPhysicalPath(value, { directory: true });
const optional = file => readAgentRunFile(file, { json: false, maxBytes: 262144, optional: true });
const expectedPorts = ['read', 'reply', 'resolution', 'merge', 'open', 'push', 'post_merge_git'];
const consoleQuery = String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$inputOwner=[Console]::In.ReadToEnd() | ConvertFrom-Json
if($inputOwner.pid -lt 1 -or $inputOwner.creation -notmatch '^[0-9]{18}$'){throw 'OBSERVER_CONSOLE_INPUT_INVALID'}
$assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('AidnObserverConsole'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
$module=$assembly.DefineDynamicModule('Native')
$builder=$module.DefineType('AidnObserverConsoleQuery',[Reflection.TypeAttributes]'Public, Abstract, Sealed')
$method=$builder.DefinePInvokeMethod('NtQueryInformationProcess','ntdll.dll',[Reflection.MethodAttributes]'Public, Static, PinvokeImpl',[Reflection.CallingConventions]::Standard,[int],[Type[]]@([IntPtr],[int],[UIntPtr].MakeByRefType(),[uint32],[uint32].MakeByRefType()),[Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::Auto)
$method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
$nativeType=$builder.CreateType()
$ownerProcess=[Diagnostics.Process]::GetProcessById([int]$inputOwner.pid)
try {
 $before=$ownerProcess.StartTime.ToUniversalTime().Ticks.ToString()
 if($before -ne $inputOwner.creation){throw 'OBSERVER_CONSOLE_IDENTITY_CHANGED'}
 $nativeArguments=[object[]]@($ownerProcess.Handle,[int]49,[UIntPtr]::Zero,[uint32][IntPtr]::Size,[uint32]0)
 $status=[int]$nativeType.GetMethod('NtQueryInformationProcess').Invoke($null,$nativeArguments)
 if($status -lt 0 -or [uint32]$nativeArguments[4] -ne [IntPtr]::Size){throw 'OBSERVER_CONSOLE_UNAVAILABLE'}
 $raw=[uint64]$nativeArguments[2].ToUInt64()
 $consolePid=$raw-($raw%4)
 if($consolePid -gt 4294967295){throw 'OBSERVER_CONSOLE_UNAVAILABLE'}
 $consoleCreation=$null
 if($consolePid -ne 0){
  $consoleProcess=[Diagnostics.Process]::GetProcessById([int]$consolePid)
  try{$consoleCreation=$consoleProcess.StartTime.ToUniversalTime().Ticks.ToString()}finally{$consoleProcess.Dispose()}
 }
 $ownerProcess.Refresh()
 if($ownerProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $before){throw 'OBSERVER_CONSOLE_IDENTITY_CHANGED'}
 [Console]::WriteLine(([pscustomobject]@{version=1;observer_pid=[int]$inputOwner.pid;observer_creation=$before;console_pid=[long]$consolePid;console_creation=$consoleCreation;query_pid=$PID} | ConvertTo-Json -Compress))
}finally{$ownerProcess.Dispose()}
`;

// A fixed read-only actor, not a journal-MAC closure claim. Actual OS/physical
// observations and fixed source/transport capabilities authenticate each read.
// Authored actions supply neither readers, discovery scope nor an authority.
export function createStandardHostResourceSource({ configuration, home, identity, readKey, readTrust,
  observeSources, provider, defaultTransports, readInventory, readNativeHistory, observeNativeActivity, observeOperationActivity }) {
  if ([readKey, readTrust, observeSources, readInventory, readNativeHistory, observeNativeActivity, observeOperationActivity].some(fn => typeof fn !== 'function'))
    fail('STANDARD_RESOURCE_SOURCE_CAPABILITY_REQUIRED');
  const config = freezeShadow(structuredClone(configuration)), root = physical(config.target_root), control = physical(config.control_root);
  const protectedHome = physical(home), profile = path.join(protectedHome, identity + '.github.json');

  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let self = null, retained = null, diagnostics = null, discoveryReaders = null, discoveryOwnerSha = null;
  const evidence = (name, value) => ({ ref: 'standard:resource-source:' + name, sha256: H(value) });
  function permission() {
    if (agenticProcessImplementationPins().sha256 !== config.implementation_sha256)
      fail('STANDARD_RESOURCE_SOURCE_IMPLEMENTATION_CHANGED');
    if (physical(config.target_root) !== root || physical(config.control_root) !== control || physical(home) !== protectedHome)
      fail('STANDARD_RESOURCE_SOURCE_PHYSICAL_SCOPE_CHANGED');
    return { trust: readTrust(), profile_sha256: optional(profile)?.sha256 ?? null };
  }
  function gitObservation() {
    const pointer = path.join(root, '.git'), stat = fs.lstatSync(pointer);
    let gitDir;
    if (stat.isDirectory()) gitDir = physical(pointer);
    else {
      const read = optional(pointer), match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(read?.value.toString('utf8') ?? '');
      if (!match) fail('STANDARD_RESOURCE_SOURCE_GIT_SCOPE_INVALID');
      gitDir = physical(path.resolve(root, match[1]));
    }
    const common = optional(path.join(gitDir, 'commondir'));
    const commonDir = common ? physical(path.resolve(gitDir, common.value.toString('utf8').trim())) : gitDir;
    const locks = [], visited = new Set();
    let entries = 0;
    function scan(directory, recursive = false) {
      if (!fs.existsSync(directory)) return;
      directory = physical(directory);
      if (visited.has(directory)) return; visited.add(directory);
      for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entries > 10000) fail('STANDARD_RESOURCE_SOURCE_GIT_SCOPE_TRUNCATED');
        const file = path.join(directory, item.name);
        if (item.isSymbolicLink()) fail('STANDARD_RESOURCE_SOURCE_GIT_SCOPE_INVALID');
        if (item.isFile() && (item.name.endsWith('.lock') || item.name === 'gc.pid')) locks.push(H(file));
        if (recursive && item.isDirectory()) scan(file, true);
      }
    }
    for (const directory of new Set([gitDir, commonDir])) {
      scan(directory); scan(path.join(directory, 'refs'), true);
      scan(path.join(directory, 'objects', 'pack')); scan(path.join(directory, 'objects', 'info'), true);
    }
    // Unconfirmed bare preparations are retained DATA. Their presence is not
    // active-process evidence and never causes cleanup or automatic retry.
    const preparations = [];
    for (const name of fs.readdirSync(os.tmpdir()).filter(name => /^aidn-github-push-transport-[a-f0-9]{64}$/.test(name)).sort()) {
      const directory = path.join(os.tmpdir(), name), file = path.join(directory, 'aidn-preparation.json');
      if (!fs.existsSync(file)) continue;
      const manifest = optional(file);
      let value; try { value = JSON.parse(manifest.value); } catch { fail('STANDARD_RESOURCE_SOURCE_GIT_PREPARATION_INVALID'); }
      if (typeof value.objects !== 'string' || path.resolve(value.objects).toLowerCase() !== path.join(commonDir, 'objects').toLowerCase()) continue;
      if (physical(directory) !== directory) fail('STANDARD_RESOURCE_SOURCE_GIT_PREPARATION_INVALID');
      preparations.push({ ref: H(directory), sha256: manifest.sha256 }); scan(directory); scan(path.join(directory, 'refs'), true);
    }
    return { git_dir_sha256: H(gitDir), common_dir_sha256: H(commonDir), locks: locks.sort(), preparations };
  }
  function sources() {
    const value = observeSources();
    if (value?.protocol !== 'standard-host-signed-files-sync.v1' || ['human', 'control', 'native-renewal'].some(kind =>
      !Number.isSafeInteger(value[kind]?.active) || value[kind].active < 0 || !Number.isSafeInteger(value[kind].revision)))
      fail('STANDARD_RESOURCE_SOURCE_ACTOR_COVERAGE_INVALID');
    return value;
  }
  const actorMaterial = value => ({ protocol: value.protocol, active: Object.fromEntries(['human', 'control', 'native-renewal'].map(kind => [kind, value[kind].active])) });
  function liveActivity(scopeId) {
    const native = observeNativeActivity(), operations = observeOperationActivity();
    if (native?.protocol !== 'standard-native-resource-activity.v1' || operations?.protocol !== 'standard-operation-resource-activity.v1'
      || [native.active_runs, native.human_verification_ports].some(value => !Number.isSafeInteger(value) || value < 0)
      || !(operations.current_dispatch_id === null || /^[a-f0-9-]{36}$/.test(operations.current_dispatch_id ?? ''))
      || !Array.isArray(operations.active_dispatches)
      || [native, operations].some(value => value.snapshot_only !== true || value.complete_resource_closure !== false || value.permits_effects !== false || value.permits_handoff !== false || value.written !== false)
      || operations.active_dispatches.some(row => !/^[a-f0-9-]{36}$/.test(row.dispatch_id ?? '') || typeof row.instance_id !== 'string' || typeof row.scope_id !== 'string'
        || !/^op_[a-f0-9]{40}$/.test(row.operation_id) || typeof row.binding_ref !== 'string' || typeof row.executor_kind !== 'string'))
      fail('STANDARD_RESOURCE_SOURCE_RUNTIME_COVERAGE_INVALID');
    const work = operations.active_dispatches.filter(row => row.dispatch_id !== operations.current_dispatch_id
      || row.instance_id !== config.instance_id || row.scope_id !== scopeId
      || ![handoffPublicationOperation, handoffResourceOperation].includes(row.binding_ref));
    return { native, operations, deterministic: work.filter(row => row.executor_kind !== 'human').length,
      human: work.filter(row => row.executor_kind === 'human').length };
  }
  function native() {
    const value = readNativeHistory();
    if (value?.instance_id !== config.instance_id || value.permits_effects !== false || value.complete_resource_closure !== false
      || !Array.isArray(value.entries) || !['not_allocated', 'verified_closed_history'].includes(value.retained_history_status)
      || value.retained_history_status === 'not_allocated' && (value.journal_sha256 !== null || value.entries.length)
      || value.entries.some(row => !['ordinary_closed', 'reconciled_no_assignment', 'reconciled_post_assignment'].includes(row.status)))
      fail('STANDARD_RESOURCE_SOURCE_NATIVE_HISTORY_UNRESOLVED');
    return value;
  }
  function observerConsole() {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    let value;
    try { value = JSON.parse(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', consoleQuery], {
      input: JSON.stringify({ pid: self.pid, creation: self.creation }), encoding: 'utf8', windowsHide: true, shell: false,
      maxBuffer: 4096, stdio: ['pipe', 'pipe', 'pipe'] })); } catch { fail('STANDARD_RESOURCE_SOURCE_CONSOLE_UNAVAILABLE'); }
    if (value.version !== 1 || value.observer_pid !== self.pid || value.observer_creation !== self.creation
      || !Number.isSafeInteger(value.query_pid) || value.query_pid === self.pid || !Number.isSafeInteger(value.console_pid)
      || value.console_pid < 0 || value.console_pid > 4294967295
      || (value.console_pid === 0 ? value.console_creation !== null : !/^[0-9]{18}$/.test(value.console_creation)))
      fail('STANDARD_RESOURCE_SOURCE_CONSOLE_IDENTITY_CHANGED');
    return { basis: 'kernel_bound_observer_console', observer_identity: self,
      console_pid: value.console_pid, console_creation: value.console_creation };
  }
  function processes(owners, signal) {
    if (discoveryOwnerSha !== H(owners)) {
      discoveryReaders = [
        createLocalHandoffProcessDiscovery({ targetRoot: root, controlRoot: control, nativeExecutable: config.native.executable, ownerIdentities: owners }),
        createLocalHandoffProcessDiscovery({ targetRoot: protectedHome, controlRoot: protectedHome, nativeExecutable: config.native.executable }),
      ];
      discoveryOwnerSha = H(owners);
    }
    return discoveryReaders.map(reader => reader.observe({ signal }));
  }
  function sample(owners, signal, scopeId) {
    active(signal);
    const policy = permission(), actor = sources(), runtime = liveActivity(scopeId), history = native(), git = gitObservation();
    const transport = provider?.observeAsyncTransportResources() ?? null;
    const console = observerConsole(), discovery = processes(owners, signal); active(signal);
    if (H(permission()) !== H(policy) || H(actorMaterial(sources())) !== H(actorMaterial(actor)) || H(native()) !== H(history) || H(gitObservation()) !== H(git))
      fail('STANDARD_RESOURCE_SOURCE_OBSERVATION_CHANGED');
    const workProcesses = row => row.processes.filter(process => process.pid !== console.console_pid || process.creation !== console.console_creation);
    const processCount = discovery.reduce((sum, observation) => sum + Math.max(...observation.samples.map(row => workProcesses(row).length + row.unavailable.length)), 0);
    const processComplete = discovery.every(row => row.stable && row.samples.every(sample => sample.unavailable.length === 0));
    const portClosed = snapshot => snapshot && snapshot.active_commands.length === 0 && snapshot.unconfirmed_commands === 0;
    const providerComplete = defaultTransports && (provider === null ? policy.profile_sha256 === null
      : transport && expectedPorts.every(port => transport.coverage.default_async_ports.includes(port))
        && transport.coverage.synchronous_ports_observed === false && transport.coverage.injected_transports_observed === false);
    const providerActive = transport ? transport.snapshot.active_commands.length + transport.snapshot.unconfirmed_commands
      + (transport.git_snapshot?.active_commands.length ?? 0) + (transport.git_snapshot?.unconfirmed_commands ?? 0) : 0;
    const facts = {
      deterministic: { complete: processComplete, active: processCount + runtime.deterministic, evidence: { runtime: runtime.operations, discovery, console, owners_sha256: H(owners) } },
      native: { complete: processComplete, active: processCount + runtime.native.active_runs + runtime.native.human_verification_ports + actor['native-renewal'].active, evidence: { history, runtime: runtime.native, discovery, console } },
      human: { complete: processComplete, active: processCount + runtime.human + runtime.native.human_verification_ports + actor.human.active, evidence: { actor: actor.human, runtime, policy, discovery, console } },
      control: { complete: processComplete, active: processCount + actor.control.active, evidence: { actor: actor.control, policy, discovery, console } },
      process: { complete: processComplete, active: processCount, evidence: { discovery, console } },
      git: { complete: processComplete, active: processCount + git.locks.length, evidence: { git, discovery, console } },
      provider: { complete: !!providerComplete && (!transport || portClosed(transport.snapshot) && portClosed(transport.git_snapshot)),
        active: processCount + providerActive, evidence: { profile: policy.profile_sha256, transport: transport
          ? { snapshot: transport.snapshot, git_snapshot: transport.git_snapshot, coverage: transport.coverage } : null, discovery, console } },
    };
    return { policy, actor, history, git, transport, discovery, facts };
  }
  function current(input) {
    active(input.signal);
    const saved = retained;
    if (!saved || input.sourceRef !== saved.sourceRef || H(input.request) !== saved.request_sha256 || H(input.observation) !== saved.observation_sha256)
      fail('STANDARD_RESOURCE_SOURCE_CAPTURE_REQUIRED');
    active(saved.signal);
    if (H(permission()) !== H(saved.value.policy)) fail('STANDARD_RESOURCE_SOURCE_PERMISSION_CHANGED');
    // Current source permission and physical resources stay independent from
    // the canonical owner: the publisher may now hold its own effect fence.
    const now = sample(saved.owners, saved.signal, saved.scope_id);
    if (H(now.policy) !== H(saved.value.policy) || H(actorMaterial(now.actor)) !== H(actorMaterial(saved.value.actor))
      || H(now.history) !== H(saved.value.history) || H(now.git) !== H(saved.value.git)
      || RECONCILIATION_DISCOVERY_DOMAINS.some(domain => !now.facts[domain].complete || now.facts[domain].active !== 0))
      fail('STANDARD_RESOURCE_SOURCE_NOT_CURRENT');
    saved.value.transport?.assertCurrent();
    if (H(permission()) !== H(saved.value.policy)) fail('STANDARD_RESOURCE_SOURCE_PERMISSION_CHANGED');
  }
  return Object.freeze({
    async read({ request, sourceRef, signal }) {
      retained = null; active(signal); assertHandoffResourceRequest(request);
      const signer = createOperationJournalSigner(readKey); signer.verify(request);
      if (request.instance_id !== config.instance_id || request.configuration_sha256 !== H(config) || request.physical_root_sha256 !== H(root)
        || !['standard-handoff', 'standard-handoff-post-release'].includes(sourceRef))
        fail('STANDARD_RESOURCE_SOURCE_REQUEST_SCOPE_CHANGED');
      if (process.platform !== 'win32' || !config.controller) return null;
      if (artifacts.ownerPending()) { diagnostics = freezeShadow({ deterministic: { complete: false, active_resources: 1 } }); return null; }
      self ??= observeLocalProcess(process.pid);
      if (!self) fail('STANDARD_RESOURCE_SOURCE_OBSERVER_UNAVAILABLE');
      const inventory = readInventory(); assertProcessReconciliationInventory(inventory); signer.verify(inventory);
      if (inventory.instance_id !== request.instance_id || inventory.scope_id !== request.scope_id || inventory.model_sha256 !== request.model_sha256
        || inventory.configuration_sha256 !== request.configuration_sha256 || !inventory.accounting.native_known)
        fail('STANDARD_RESOURCE_SOURCE_INVENTORY_SCOPE_CHANGED');
      const owners = [...new Map([self, ...inventory.resources.map(row => row.details?.process_identity).filter(Boolean)]
        .map(row => [H(row), structuredClone(row)])).values()];
      const value = sample(owners, signal, request.scope_id);
      if (value.history.retained_history_status === 'verified_closed_history' && (value.history.scope_id !== request.scope_id || value.history.model_sha256 !== request.model_sha256))
        fail('STANDARD_RESOURCE_SOURCE_NATIVE_SCOPE_CHANGED');
      diagnostics = freezeShadow(Object.fromEntries(RECONCILIATION_DISCOVERY_DOMAINS.map(domain => [domain,
        { complete: value.facts[domain].complete, active_resources: value.facts[domain].active }])));
      if (H(value.history) !== request.native_history_sha256 || RECONCILIATION_DISCOVERY_DOMAINS.some(domain => !value.facts[domain].complete || value.facts[domain].active !== 0))
        return null;
      const domains = RECONCILIATION_DISCOVERY_DOMAINS.map(domain => ({ domain, complete: value.facts[domain].complete,
        active_resources: value.facts[domain].active, state: 'closed', evidence_refs: [evidence(domain, value.facts[domain].evidence)] }));
      const observation = freezeShadow(assertHandoffResourceObservation({ contract_version: 'standard-handoff-resource-observation.v1',
        authority_id: 'standard_resource_observer', request_sha256: H(request), observed_at_ms: Date.now(), evidence_class: 'native',
        domains, evidence_refs: [evidence('policy', value.policy), ...domains.map(row => row.evidence_refs[0])] }, request));
      retained = { sourceRef, request_sha256: H(request), observation_sha256: H(observation), scope_id: request.scope_id, owners, signal, value };
      return observation;
    },
    async verify(input) {
      current(input);
      return { outcome: 'verified', authority_id: input.observation.authority_id, request_sha256: H(input.request),
        observation_sha256: H(input.observation), evidence_class: input.observation.evidence_class };
    },
    assertCurrent: current,
    inspectLastObservation: () => diagnostics,
  });
}
