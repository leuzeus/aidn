import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGithubProcessTreeTransport } from '../../src/adapters/git-provider/github-process-tree-transport.mjs';
import { createStandardGithubProviderHost } from '../../src/adapters/runtime/standard-github-provider-host.mjs';
import { observeLocalProcessOwner } from '../../src/adapters/runtime/local-process-identity.mjs';
import { verificationWindowsController } from '../verify/owned-verification-process-lib.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-github-tree-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], check = (name, condition) => { assert(condition, name); checks.push(name); };
const source = new URL('../../src/adapters/agents/process-tree/windows-job-helper.cs', import.meta.url);
const manifest = process.platform === 'win32' ? verificationWindowsController(owned).manifest : (() => {
  const file = path.join(owned, 'unqualified-helper.bin'); fs.writeFileSync(file, 'not an executable');
  return { helper_path: file, helper_sha256: sha(fs.readFileSync(file)), source_sha256: sha(fs.readFileSync(source)) };
})();
const make = changes => createGithubProcessTreeTransport({ executable: { path: process.execPath, sha256: sha(fs.readFileSync(process.execPath)) },
  helper: { path: manifest.helper_path, sha256: manifest.helper_sha256, source_sha256: manifest.source_sha256 },
  cwd: owned, profileSha256: sha('fixture protected provider profile'), ...changes });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/iu.test(key)));
const options = extra => ({ cwd: owned, env: environment, timeout: 20000, maxBuffer: 262144, ...extra });
let passed = false, activeRun = null;
try {
  const transport = make(), initial = transport.observeResources();
  check('fixed observer starts with no command allocation', initial.active_commands.length === 0 && initial.confirmed_closed_commands === 0);
  check('current process observation grants no global permission', initial.snapshot_only && !initial.complete_resource_closure
    && !initial.permits_effects && !initial.permits_handoff && !initial.written);
  transport.assertCurrent(initial);
  await assert.rejects(transport.run(process.execPath, ['-e', ''], options({ timeout: 0 })), { code: 'GITHUB_OBSERVATION_TRANSPORT_INVALID' });
  await assert.rejects(transport.run(process.execPath, ['-e', ''], options({ maxBuffer: 0 })), { code: 'GITHUB_OBSERVATION_TRANSPORT_INVALID' });
  await assert.rejects(transport.run(process.execPath, ['-e', ''], options({ beforeResume: true })), { code: 'GITHUB_OBSERVATION_TRANSPORT_INVALID' });
  checks.push('invalid budget and callback are refused before allocation');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(transport.run(process.execPath, ['-e', ''], options({ signal: cancelled.signal })), { code: 'GITHUB_OBSERVATION_ABORTED' });
  check('an already aborted request does not consume an allocation', JSON.stringify(transport.observeResources()) === JSON.stringify(initial));
  if (process.platform !== 'win32') {
    await assert.rejects(transport.run(process.execPath, ['-e', ''], options()), { code: 'GITHUB_OBSERVATION_TREE_CONTROL_UNAVAILABLE', effect_status: 'no_effect' });
    const unsupported = transport.observeResources();
    check('unqualified platform does not fall back to an unconfined command', unsupported.not_started_commands === 1
      && unsupported.active_commands.length === 0 && unsupported.unconfirmed_commands === 0);
  } else {
    const simple = await transport.run(process.execPath, ['-e', "process.stderr.write('PRIVATE_PROVIDER_TOKEN_f84d');process.stdout.write('ok');"], options());
    check('actual confined command preserves the historical transport result', simple.status === 0 && simple.signal === null && simple.stdout === 'ok');
    const afterSimple = transport.observeResources();
    check('actual command returned only after confirmed Job closure', afterSimple.confirmed_closed_commands === 1 && afterSimple.active_commands.length === 0
      && afterSimple.recent_closures[0].termination_proof.active_processes === 0);
    check('private process evidence contains neither argv nor credentials', !JSON.stringify(afterSimple).includes('PRIVATE_PROVIDER_TOKEN_f84d'));
    assert.throws(() => transport.assertCurrent(initial), { code: 'GITHUB_OBSERVATION_TREE_SNAPSHOT_CHANGED' });
    transport.assertCurrent(afterSimple); checks.push('currentness detects a completed command between observations');
    const leaf = path.join(owned, 'leaf.mjs'), parent = path.join(owned, 'parent.mjs'), ready = path.join(owned, 'ready.json');
    const identityUrl = new URL('../../src/adapters/runtime/local-process-identity.mjs', import.meta.url).href;
    fs.writeFileSync(leaf, "import fs from 'node:fs';import {observeLocalProcess} from " + JSON.stringify(identityUrl)
      + ";const identity=observeLocalProcess(process.pid);fs.writeFileSync(process.argv[2],JSON.stringify(identity));console.log(JSON.stringify(identity));setInterval(()=>{},1000);\n");
    fs.writeFileSync(parent, "import {spawn} from 'node:child_process';const leaf=spawn(process.execPath,[process.argv[2],process.argv[3]],"
      + "{windowsHide:true,stdio:['ignore','pipe','ignore']});leaf.once('error',()=>process.exit(1));leaf.stdout.once('data',b=>{process.stdout.write(b);process.exit(0);});\n");
    const tree = await transport.run(process.execPath, [parent, leaf, ready], options());
    const identity = JSON.parse(tree.stdout);
    check('normal direct-parent exit closes its still-running descendant', tree.status === 0 && observeLocalProcessOwner(identity) === 'terminated');
    fs.unlinkSync(ready);
    const abort = new AbortController();
    activeRun = transport.run(process.execPath, [leaf, ready], options({ signal: abort.signal }));
    const terminal = activeRun.then(value => ({ value }), cause => ({ cause }));
    const readyEvent = new Promise((resolve, reject) => {
      let settled = false;
      const finish = cause => { if (settled) return; settled = true; watcher.close(); cause ? reject(cause) : resolve(); };
      const inspect = () => { try { JSON.parse(fs.readFileSync(ready)); finish(); } catch {} };
      const watcher = fs.watch(owned, inspect); watcher.once('error', finish);
      terminal.then(() => finish(Error('OWNED_COMMAND_CLOSED_BEFORE_READY'))); inspect();
    });
    const busy = transport.observeResources();
    check('live command is observed independently of an operation journal', busy.active_commands.length === 1);
    await readyEvent; const abortedIdentity = JSON.parse(fs.readFileSync(ready)); abort.abort();
    const aborted = await terminal; activeRun = null;
    assert.equal(aborted.cause?.code, 'GITHUB_OBSERVATION_ABORTED'); assert.equal(aborted.cause.effect_status, 'unknown');
    check('cancellation returns after its original identity is terminated', observeLocalProcessOwner(abortedIdentity) === 'terminated');
    fs.unlinkSync(ready);
    const denied = path.join(owned, 'must-not-execute');
    await assert.rejects(transport.run(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1],"bad")', denied],
      options({ beforeResume() { throw Object.assign(Error('revoked'), { code: 'FIXTURE_PROVIDER_PERMISSION_REVOKED' }); } })),
    { code: 'FIXTURE_PROVIDER_PERMISSION_REVOKED', effect_status: 'no_effect' });
    check('revocation after Job assignment prevents the actual command effect', !fs.existsSync(denied));
    let releasePermission, permissionEntered = false;
    const permission = new Promise(resolve => { releasePermission = resolve; });
    await assert.rejects(transport.run(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1],"bad")', denied],
      options({ timeout: 4000, beforeResume() { permissionEntered = true; return permission; } })), { code: 'GITHUB_OBSERVATION_TIMEOUT', effect_status: 'no_effect' });
    releasePermission(); await new Promise(resolve => setImmediate(resolve));
    check('caller deadline includes a pending permission callback and prevents late resume', permissionEntered && !fs.existsSync(denied));
    await assert.rejects(transport.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'],
      options({ maxBuffer: 64 })), { code: 'GITHUB_OBSERVATION_BUFFER_LIMIT' });
    checks.push('combined output budget closes the owned tree');
    const nonzero = await transport.run(process.execPath, ['-e', 'process.exit(7)'], options());
    check('a closed nonzero child preserves its actual exit status', nonzero.status === 7);
    const final = transport.observeResources();
    check('all allocated real command trees have confirmed closure', final.active_commands.length === 0 && final.unconfirmed_commands === 0
      && final.confirmed_closed_commands === 7 && final.recent_closures.every(row => row.termination_proof.active_processes === 0));
    // Marker discovery must work with executable, helper, argv and cwd outside
    // the configured root; no active-map row is supplied to the OS observer.
    const markerRoot = path.join(owned, 'provider-discovery-root'); fs.mkdirSync(markerRoot);
    const marked = make({ scopeRoot: markerRoot });
    const observerFile = path.join(owned, 'independent-provider-observer.mjs');
    const discoveryUrl = new URL('../../src/adapters/runtime/local-handoff-process-discovery.mjs', import.meta.url).href;
    fs.writeFileSync(observerFile, "import fs from 'node:fs';import {createLocalHandoffProcessDiscovery} from " + JSON.stringify(discoveryUrl)
      + ";const input=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(createLocalHandoffProcessDiscovery(input).observe()));\n");
    let independentObservation = null, liveCommand = null;
    const markedResult = await marked.run(process.execPath, ['-e', 'process.stdout.write("scoped")'], options({ beforeResume(remaining) {
      liveCommand = marked.observeResources().active_commands[0];
      independentObservation = JSON.parse(execFileSync(process.execPath, [observerFile], { cwd: owned, env: environment,
        input: JSON.stringify({ targetRoot: markerRoot, controlRoot: markerRoot, nativeExecutable: process.execPath }),
        encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: remaining }));
    } }));
    check('independent OS discovery finds the marked helper and its suspended command outside argv and cwd scope',
      liveCommand?.pid && independentObservation?.observer_identity.pid !== process.pid && independentObservation?.samples.every(sample => {
        const command = sample.processes.find(row => row.pid === liveCommand.pid);
        const helper = sample.processes.find(row => row.pid === command?.parent_pid);
        return command?.scope_match === 'descendant' && helper?.scope_match === 'marker';
      }));
    check('independent discovery exposes hashes and grants no closure or permission',
      !JSON.stringify(independentObservation).includes(markerRoot) && independentObservation.snapshot_only
      && !independentObservation.complete_resource_closure && !independentObservation.permits_effects && !independentObservation.permits_handoff);
    const markedClosed = marked.observeResources();
    check('the discovered command retains its original budget and closes its Job', markedResult.status === 0 && markedResult.stdout === 'scoped'
      && markedClosed.confirmed_closed_commands === 1 && markedClosed.active_commands.length === 0
      && markedClosed.recent_closures[0].termination_proof.active_processes === 0);
    const home = path.join(owned, 'host'), project = path.join(owned, 'project'), identityKey = sha('fixture host identity');
    fs.mkdirSync(home); fs.mkdirSync(project);
    const configDir = path.join(home, identityKey + '.github'); fs.mkdirSync(configDir);
    const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const fakeSource = path.join(owned, 'fake-github.cs'), fakeGh = path.join(owned, 'fake-github.exe');
    fs.writeFileSync(fakeSource, 'using System;class FakeGithub{static int Main(string[] args){'
      + 'if(args.Length>0&&args[0]=="auth"){Console.Write("fixture-token-0123456789");return 0;}'
      + 'string endpoint=args.Length>0?args[args.Length-1]:"";'
      + 'if(endpoint=="user"){Console.Write("{\\"node_id\\":\\"USER_fixture\\",\\"login\\":\\"fixture-actor\\"}");return 0;}'
      + 'if(endpoint=="repos/fixture/neutral"){Console.Write("{\\"node_id\\":\\"REPO_fixture\\",\\"full_name\\":\\"fixture/neutral\\"}");return 0;}'
      + 'return 2;}}\n');
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/out:' + fakeGh, fakeSource], { cwd: owned, windowsHide: true });
    const gitPath = fs.realpathSync.native(execFileSync(path.join(process.env.SystemRoot, 'System32/where.exe'), ['git.exe'],
      { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]);
    const git = args => execFileSync(gitPath, ['-C', project, ...args], { windowsHide: true, encoding: 'utf8',
      env: { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL' } });
    git(['-c', 'init.templateDir=', 'init', '--initial-branch=work']);
    git(['remote', 'add', 'origin', 'https://github.com/fixture/neutral.git']);
    fs.writeFileSync(path.join(home, identityKey + '.github.json'), JSON.stringify({ contract_version: 'standard-host-github.v1',
      target_root: project, instance_id: 'case', repository: { host: 'github.com', owner: 'fixture', name: 'neutral', node_id: 'REPO_fixture' },
      actor: { login: 'fixture-actor', node_id: 'USER_fixture' }, git: { path: gitPath, sha256: sha(fs.readFileSync(gitPath)) },
      gh: { path: fakeGh, sha256: sha(fs.readFileSync(fakeGh)) } }));
    const provider = createStandardGithubProviderHost({ configuration: { target_root: project, instance_id: 'case',
      controller: { helper_path: manifest.helper_path, helper_sha256: manifest.helper_sha256, helper_source_sha256: manifest.source_sha256 } },
    home, identity: identityKey, environment });
    const providerBefore = provider.observeAsyncTransportResources();
    check('normal protected host selects the confined asynchronous defaults', providerBefore.snapshot.active_commands.length === 0
      && providerBefore.coverage.default_async_ports.join(',') === 'read,reply,resolution,merge,open'
      && providerBefore.coverage.synchronous_ports_observed === false && providerBefore.coverage.injected_transports_observed === false);
    await provider.verifyIdentity();
    const providerAfter = provider.observeAsyncTransportResources(); providerAfter.assertCurrent();
    check('ordinary provider authentication traverses three actual confined commands', providerAfter.snapshot.confirmed_closed_commands === 3
      && providerAfter.snapshot.unconfirmed_commands === 0 && providerAfter.snapshot.active_commands.length === 0
      && providerAfter.snapshot.recent_closures.every(row => row.termination_proof.active_processes === 0));
    assert.throws(() => providerBefore.assertCurrent(), { code: 'GITHUB_OBSERVATION_TREE_SNAPSHOT_CHANGED' });
    checks.push('protected host resource capability detects intervening command activity');
    fs.writeFileSync(path.join(configDir, 'hosts.yml'), 'fixture credential source changed\n');
    assert.throws(() => providerAfter.assertCurrent(), { code: 'STANDARD_GITHUB_HOST_CREDENTIAL_CHANGED' });
    checks.push('protected host resource capability rechecks current source permission');
  }
  passed = true;
  console.log(JSON.stringify({ github_process_tree_transport: 'PASS', checks, platform: process.platform,
    actual_windows_process_trees: process.platform === 'win32' ? 'PASS' : 'NOT_RUN',
    actual_github: 'NOT_RUN', actual_native_clients: 0, complete_resource_closure: 'NOT_PROVEN',
    complete_standard_workflow: false }));
} catch (cause) {
  console.error(JSON.stringify({ github_process_tree_transport_failure: true, retained_root: owned })); throw cause;
} finally {
  if (activeRun) await activeRun.catch(() => {});
  if (passed) {
    const real = fs.realpathSync(owned); assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()));
    assert(path.basename(real).startsWith('aidn-github-tree-')); assert.equal(removePathWithRetry(real).ok, true);
    console.log(JSON.stringify({ cleanup: { owned_root: real, removed: true } }));
  }
}
