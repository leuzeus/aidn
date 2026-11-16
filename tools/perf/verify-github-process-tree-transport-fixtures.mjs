import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGithubProcessTreeTransport } from '../../src/adapters/git-provider/github-process-tree-transport.mjs';
import { createStandardGithubProviderHost } from '../../src/adapters/runtime/standard-github-provider-host.mjs';
import { readAgentRunFile } from '../../src/application/runtime/agent-run-configuration-service.mjs';
import { createWindowsProcessTreeController } from '../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs';
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
    const alternateCwd = path.join(owned, 'alternate-cwd'); fs.mkdirSync(alternateCwd);
    const multi = make({ scopeRoot: markerRoot, additionalWorkingDirectories: [alternateCwd] });
    const cwdArgs = ['-e', 'process.stdout.write(process.cwd())']; let originalCwdSha, alternateCwdSha;
    const firstCwd = await multi.run(process.execPath, cwdArgs, options({ beforeResume() { originalCwdSha = multi.observeResources().active_commands[0].command_sha256; } }));
    const otherCwd = await multi.run(process.execPath, cwdArgs, options({ cwd: alternateCwd, beforeResume() { alternateCwdSha = multi.observeResources().active_commands[0].command_sha256; } }));
    check('constructor-fixed directories select the actual worker cwd', path.resolve(firstCwd.stdout).toLowerCase() === path.resolve(owned).toLowerCase()
      && path.resolve(otherCwd.stdout).toLowerCase() === path.resolve(alternateCwd).toLowerCase());
    const multiClosed = multi.observeResources();
    check('selected cwd is bound to command identity and both jobs close', originalCwdSha !== alternateCwdSha
      && multiClosed.confirmed_closed_commands === 2 && multiClosed.active_commands.length === 0
      && multiClosed.recent_closures.every(row => row.termination_proof.active_processes === 0));
    await assert.rejects(multi.run(process.execPath, cwdArgs, options({ cwd: markerRoot })), { code: 'GITHUB_OBSERVATION_TRANSPORT_INVALID' });
    check('a scope marker grants no working-directory permission or allocation', JSON.stringify(multi.observeResources()) === JSON.stringify(multiClosed));
    const revokedCwd = path.join(owned, 'revoked-cwd'); fs.mkdirSync(revokedCwd);
    const revocable = make({ additionalWorkingDirectories: [revokedCwd] }), notExecuted = path.join(owned, 'revoked-cwd-must-not-run');
    await assert.rejects(revocable.run(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1],"bad")', notExecuted], options({ beforeResume() {
      assert.equal(path.dirname(fs.realpathSync(revokedCwd)), fs.realpathSync(owned)); fs.rmdirSync(revokedCwd);
    } })), { code: 'GITHUB_OBSERVATION_TREE_BINDING_CHANGED', effect_status: 'no_effect' });
    fs.mkdirSync(revokedCwd);
    check('fixed-directory revocation after assignment refuses before the effect and closes the job', !fs.existsSync(notExecuted)
      && revocable.observeResources().confirmed_closed_commands === 1);
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
    const fakeAlias = path.join(owned, 'fake-github-hardlink.exe'); fs.linkSync(fakeGh, fakeAlias);
    const fakeBytes = fs.readFileSync(fakeGh), fakeSha = sha(fakeBytes);
    assert.throws(() => readAgentRunFile(fakeGh, { json: false }), { code: 'AGENT_RUN_FILE_INVALID' });
    const controllerPins = { helperPath: manifest.helper_path, helperSha256: manifest.helper_sha256,
      helperSourceSha256: manifest.source_sha256, candidateSha256: fakeSha };
    const strictBinary = await createWindowsProcessTreeController(controllerPins).checkAvailability({ cwd: owned, executable: fakeGh, executableSha256: fakeSha });
    check('default protected file and Native controller policies still refuse hardlinked files', strictBinary.available === false && strictBinary.reason_code === 'PROCESS_EXECUTABLE_BINDING_INVALID');
    const linked = make({ executable: { path: fakeGh, sha256: fakeSha } });
    const linkedResult = await linked.run(fakeGh, ['auth'], options());
    const linkedClosed = linked.observeResources();
    check('provider opt-in runs the actual pinned hardlinked executable and closes its Job', linkedResult.status === 0 && linkedResult.stdout === 'fixture-token-0123456789'
      && linkedClosed.confirmed_closed_commands === 1 && linkedClosed.recent_closures[0].termination_proof.active_processes === 0);
    try {
      fs.appendFileSync(fakeAlias, 'changed through alias');
      await assert.rejects(linked.run(fakeGh, ['auth'], options()), { code: 'GITHUB_OBSERVATION_TREE_BINDING_CHANGED', effect_status: 'no_effect' });
    } finally { fs.writeFileSync(fakeAlias, fakeBytes); }
    linked.assertCurrent(linkedClosed);
    checks.push('a binary change through its hardlink alias refuses before allocation');
    const helperAlias = path.join(owned, 'helper-hardlink.exe'); fs.linkSync(manifest.helper_path, helperAlias);
    try {
      const helperRefused = await createWindowsProcessTreeController({ ...controllerPins, allowExecutableHardLinks: true }).checkAvailability({ cwd: owned });
      check('executable opt-in never permits a hardlinked controller helper', !helperRefused.available && helperRefused.reason_code === 'PROCESS_HELPER_BINDING_INVALID');
    } finally { fs.unlinkSync(helperAlias); }

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
      && providerBefore.coverage.default_async_ports.join(',') === 'read,reply,resolution,merge,open,push,post_merge_git'
      && providerBefore.git_snapshot.confirmed_closed_commands === 0
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
    await verifyDefaultPushAndFetch(check);
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

// Actual fixed host and local Git; only the compiled provider/network endpoints are doubled.
async function verifyDefaultPushAndFetch(check) {
  const H=b=>createHash('sha256').update(b).digest('hex');
  const owned=fs.mkdtempSync(path.join(os.tmpdir(),'aidn-push-fetch-host-')),nonce=randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(owned,'owner.json'),JSON.stringify({nonce,scope:'controlled-push-fetch-host',pid:process.pid}));
  const home=path.join(owned,'host'),project=path.join(owned,'project');fs.mkdirSync(home);fs.mkdirSync(project);
  const identity=H('controlled fixed push and fetch host'),configDir=path.join(home,identity+'.github');fs.mkdirSync(configDir);
  const {manifest}=verificationWindowsController(owned);
  const realGit=fs.realpathSync.native(execFileSync(path.join(process.env.SystemRoot,'System32/where.exe'),['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]),realGitSha=H(fs.readFileSync(realGit));
  const environment=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(SystemRoot|WINDIR)$/i.test(k)));
  const local=args=>execFileSync(realGit,['-C',project,...args],{encoding:'utf8',windowsHide:true,env:{...environment,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL'}});
  local(['-c','init.templateDir=','init','--initial-branch=S001-host']);local(['remote','add','origin','https://github.com/fixture/neutral.git']);
  fs.writeFileSync(path.join(project,'fixture.txt'),'controlled actual local Git\n');local(['add','fixture.txt']);local(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);const head=local(['rev-parse','HEAD']).trim();
  const gh=path.join(owned,'fake-github.exe'),git=path.join(owned,'fixture-git.exe');
  const ghCode="using System;using System.IO;\nclass FakeGithub {\n static int Main(string[] a) {\n  string home=Environment.GetEnvironmentVariable(\"HOME\"), f=Path.Combine(home,\"gh-count\");\n  File.WriteAllText(f,((File.Exists(f)?Int32.Parse(File.ReadAllText(f)):0)+1).ToString());\n  if(a.Length>0&&a[0]==\"auth\"){Console.Write(\"fixture-token-0123456789\");return 0;}\n  string e=a.Length>5?a[5]:\"\";\n  if(e==\"user\"){Console.Write(\"{\\\"node_id\\\":\\\"USER_fixture\\\",\\\"login\\\":\\\"fixture-actor\\\"}\");return 0;}\n  if(e==\"repos/fixture/neutral\"){Console.Write(\"{\\\"node_id\\\":\\\"REPO_fixture\\\",\\\"full_name\\\":\\\"fixture/neutral\\\",\\\"permissions\\\":{\\\"push\\\":true}}\");return 0;}\n  if(e==\"repos/fixture/neutral/git/ref/heads/S001-host\"){\n   Console.Write(\"{\\\"ref\\\":\\\"refs/heads/S001-host\\\",\\\"object\\\":{\\\"type\\\":\\\"commit\\\",\\\"sha\\\":\\\"\"+File.ReadAllText(Path.Combine(home,\"remote-tip\"))+\"\\\"}}\");return 0;\n  }return 2;\n }\n}",gitCode=("using System;using System.IO;using System.Text;using System.Diagnostics;using System.Threading.Tasks;\nclass FixtureGit {\n static string Quote(string argument) {\n  var output=new StringBuilder(\"\\\"\");int slash=0;\n  foreach(char c in argument) {\n   if(c=='\\\\'){slash++;continue;}\n   if(c=='\"'){output.Append('\\\\',slash*2+1);output.Append('\"');}\n   else{output.Append('\\\\',slash);output.Append(c);}slash=0;\n  }output.Append('\\\\',slash*2);return output.Append('\"').ToString();\n }\n static int Main(string[] a) {\n  int network=-1;for(int i=0;i<a.Length;i++)if(a[i]==\"ls-remote\"||a[i]==\"push\"||a[i]==\"fetch\")network=i;\n  if(network>=0) {\n   if(Array.IndexOf(a,\"https://github.com/fixture/neutral.git\")<0)return 97;\n   string home=Environment.GetEnvironmentVariable(\"HOME\"), count=Path.Combine(home,\"git-count\"), tip=Path.Combine(home,\"remote-tip\"), current=File.Exists(tip)?File.ReadAllText(tip):\"\";\n   File.WriteAllText(count,((File.Exists(count)?Int32.Parse(File.ReadAllText(count)):0)+1).ToString());string last=a[a.Length-1];\n   if(a[network]==\"ls-remote\"){if(current!=\"\")Console.Write(current+\"\\t\"+last+\"\\n\");return 0;}\n   if(a[network]==\"push\") {\n    if(Array.IndexOf(a,\"--force-with-lease=refs/heads/S001-host:\"+current)<0||last.IndexOf(\":refs/heads/S001-host\")<0)return 96;\n    File.WriteAllText(tip,last.Substring(0,last.IndexOf(\":\")));string pushes=Path.Combine(home,\"push-count\");\n    File.WriteAllText(pushes,((File.Exists(pushes)?Int32.Parse(File.ReadAllText(pushes)):0)+1).ToString());return 0;\n   }\n   if(a[network]==\"fetch\"){return last==current?0:95;}return 94;\n  }\n  var args=new StringBuilder();foreach(string arg in a)args.Append(Quote(arg)).Append(\" \");\n  var start=new ProcessStartInfo(__REAL_GIT__,args.ToString()){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};\n  using(var child=Process.Start(start)) {\n   var stdout=child.StandardOutput.ReadToEndAsync();var stderr=child.StandardError.ReadToEndAsync();\n   child.StandardInput.Write(Console.In.ReadToEnd());child.StandardInput.Close();child.WaitForExit();\n   Console.Out.Write(stdout.Result);Console.Error.Write(stderr.Result);return child.ExitCode;\n  }\n }\n}").replace('__REAL_GIT__',JSON.stringify(realGit));
  const compiler=path.join(process.env.WINDIR??'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  for(const [name,code,exe] of [['gh',ghCode,gh],['git',gitCode,git]]){const file=path.join(owned,name+'.cs');fs.writeFileSync(file,code);execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/out:'+exe,file],{windowsHide:true});}
  fs.writeFileSync(path.join(home,identity+'.github.json'),JSON.stringify({contract_version:'standard-host-github.v1',target_root:project,instance_id:'case',repository:{host:'github.com',owner:'fixture',name:'neutral',node_id:'REPO_fixture'},actor:{login:'fixture-actor',node_id:'USER_fixture'},git:{path:git,sha256:H(fs.readFileSync(git))},gh:{path:gh,sha256:H(fs.readFileSync(gh))}}));
  const provider=createStandardGithubProviderHost({configuration:{target_root:project,instance_id:'case',controller:{helper_path:manifest.helper_path,helper_sha256:manifest.helper_sha256,helper_source_sha256:manifest.source_sha256}},home,identity,environment});
  await provider.verifyIdentity();let grants=0;const authorize=async()=>{grants++;};
  const observed=await provider.sessionPushPort.inspect('S001-host');const pushed=await provider.sessionPushPort.push(observed,{write:true,assertAuthorized:authorize});assert.equal(pushed.effect_status,'confirmed');assert.equal(fs.readFileSync(path.join(home,'remote-tip'),'utf8'),head);assert.equal(Number(fs.readFileSync(path.join(home,'push-count'),'utf8')),1);
  const beforeFetch=provider.observeAsyncTransportResources();
  const fetch=await provider.sessionReviewPort.postMergeFetch.prepare({providerRepository:{owner:'fixture',name:'neutral',node_id:'REPO_fixture'},sourceBranch:'S001-host',mergeOid:head,operationId:'op_'+'4'.repeat(40)});assert.equal(fetch.can_apply,true);
  await provider.sessionReviewPort.postMergeFetch.apply(fetch,{write:true,expectPlan:fetch.plan_sha256,assertAuthorized:authorize});assert.equal(local(['rev-parse',fetch.plan.proof_ref]).trim(),head);
  const final=provider.observeAsyncTransportResources();final.assertCurrent();
  const count=name=>Number(fs.readFileSync(path.join(home,name),'utf8'));
  const proof={owned,gh_calls:count('gh-count'),git_network_calls:count('git-count'),pushes:count('push-count'),grants,gh_observed_closed:final.snapshot.confirmed_closed_commands,git_observed_closed:final.git_snapshot?.confirmed_closed_commands??null,active_GH:final.snapshot.active_commands.length,active_Git:final.git_snapshot?.active_commands.length??null,unconfirmed_GH:final.snapshot.unconfirmed_commands,unconfirmed_Git:final.git_snapshot?.unconfirmed_commands??null,coverage:final.coverage,local_proof_ref:fetch.plan.proof_ref,local_proof_head:head,existing_object_fetch_only:true,real_git_sha256:realGitSha,actual_GitHub_requests:0,actual_Native:0};
  fs.writeFileSync(path.join(owned,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(proof));
  check('default host push and post-merge GH calls all have observed closed trees',proof.gh_observed_closed===proof.gh_calls && proof.gh_calls===31);
  check('default remote Git push and existing-object fetch have observed closed trees',proof.git_observed_closed===proof.git_network_calls && proof.git_network_calls===10);
  assert.equal(proof.active_GH,0);assert.equal(proof.active_Git,0);assert.equal(proof.unconfirmed_GH,0);assert.equal(proof.unconfirmed_Git,0);assert(grants>=7);assert(final.snapshot.recent_closures.every(r=>r.termination_proof.active_processes===0));assert(final.git_snapshot.recent_closures.every(r=>r.termination_proof.active_processes===0));assert.throws(()=>beforeFetch.assertCurrent(),{code:'GITHUB_OBSERVATION_TREE_SNAPSHOT_CHANGED'});assert.equal(H(fs.readFileSync(realGit)),realGitSha);assert.equal(local(['status','--porcelain']),'');
  check('default push updates its controlled remote exactly once and fetch writes the actual local proof ref', proof.pushes===1 && proof.local_proof_head===head);
  check('both default provider observers settle with no active or unconfirmed trees', proof.active_GH===0 && proof.active_Git===0 && proof.unconfirmed_GH===0 && proof.unconfirmed_Git===0);
  const cancelled=new AbortController();cancelled.abort();const unchanged=provider.observeAsyncTransportResources();
  await assert.rejects(provider.sessionPushPort.inspect('S001-host',{signal:cancelled.signal}),{code:'GITHUB_OBSERVATION_ABORTED'});unchanged.assertCurrent();
  check('default push inspection forwards cancellation before any command allocation',count('gh-count')===proof.gh_calls && count('git-count')===proof.git_network_calls);
  const denied=await provider.sessionReviewPort.postMergeFetch.prepare({providerRepository:{owner:'fixture',name:'neutral',node_id:'REPO_fixture'},sourceBranch:'S001-host',mergeOid:head,operationId:'op_'+'5'.repeat(40)});
  let deniedAfterAssignment=false;
  await assert.rejects(provider.sessionReviewPort.postMergeFetch.apply(denied,{write:true,expectPlan:denied.plan_sha256,async assertAuthorized(){
   const current=provider.observeAsyncTransportResources();
   if(current.git_snapshot.active_commands.length){deniedAfterAssignment=true;throw Object.assign(Error('revoked'),{code:'FIXTURE_PERMISSION_REVOKED'});}
  }}),{code:'WORKFLOW_POST_MERGE_FETCH_RECONCILIATION_REQUIRED',effect_status:'unknown'});
  const deniedFinal=provider.observeAsyncTransportResources();deniedFinal.assertCurrent();
  check('post-merge authorization is rechecked on the assigned remote Git tree before fetch resumes',deniedAfterAssignment && count('git-count')===proof.git_network_calls+2 && local(['for-each-ref','--format=%(refname)',denied.plan.proof_ref]).trim()==='');
  check('a refused suspended fetch retains UNKNOWN business status with its actual Job closed',deniedFinal.git_snapshot.confirmed_closed_commands===proof.git_observed_closed+3 && deniedFinal.git_snapshot.active_commands.length===0 && deniedFinal.git_snapshot.unconfirmed_commands===0 && deniedFinal.git_snapshot.recent_closures.every(r=>r.termination_proof.active_processes===0));
  assert.equal(fs.realpathSync(owned),owned);assert.equal(path.dirname(owned),fs.realpathSync(os.tmpdir()));assert(path.basename(owned).startsWith('aidn-push-fetch-host-'));assert.equal(JSON.parse(fs.readFileSync(path.join(owned,'owner.json'),'utf8')).nonce,nonce);assert.equal(removePathWithRetry(owned).ok,true);console.log(JSON.stringify({owned_root:owned,removed:true}));

}
