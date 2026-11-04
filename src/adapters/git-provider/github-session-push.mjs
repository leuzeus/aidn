import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import preparationSchema from '../../core/contracts/workflow-definition/github-push-preparation.v1.schema.json' with { type: 'json' };
import { agentRunPhysicalPath } from '../../application/runtime/agent-run-configuration-service.mjs';
import { createLocalWorkflowBranchIntegration } from '../runtime/local-workflow-branch-integration.mjs';
import { shadowHash, checkShadowJson } from '../../core/workflow/shadow-json.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const oid = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value ?? '');
// Fixed authenticated HTTPS transport. Host pins the binaries, repository and
// actor; authored IR supplies no URL, credential, helper, command or endpoint.
// Only remote transports are replaceable for offline qualification. Local Git
// inspection, ancestry and ref/index/worktree guards use actual Git.
export function createGithubSessionPush({ targetRoot, gitExecutable, gitSha256, githubExecutable, githubSha256, repository, actor,
  environment = process.env }, { runGithub = spawnSync, runRemoteGit = spawnSync, now = Date.now } = {}) {
  const pattern = /^[a-f0-9]{64}$/;
  if (![gitExecutable, githubExecutable].every(name => path.isAbsolute(name ?? '')) || !pattern.test(gitSha256 ?? '') || !pattern.test(githubSha256 ?? '')
    || !repository || Object.keys(repository).sort().join(',') !== 'name,node_id,owner' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(repository.owner ?? '')
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name ?? '') || ['.', '..'].includes(repository.name) || !/^[A-Za-z0-9_=-]{1,256}$/.test(repository.node_id ?? '')
    || !actor || Object.keys(actor).sort().join(',') !== 'login,node_id' || !/^[A-Za-z0-9_=-]{1,256}$/.test(actor.node_id ?? '')
    || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(actor.login ?? '') || ![runGithub, runRemoteGit, now].every(fn => typeof fn === 'function')
    || Object.keys(environment).some(name => /^GIT_/i.test(name))) fail('GITHUB_PUSH_HOST_CONFIGURATION_INVALID');
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const gitBinary = fs.realpathSync(gitExecutable), githubBinary = fs.realpathSync(githubExecutable), repo = structuredClone(repository), owner = structuredClone(actor);
  const transportCwd = path.dirname(gitBinary), temporary = agentRunPhysicalPath(os.tmpdir(), { directory: true });
  const remoteUrl = 'https://github.com/' + repo.owner + '/' + repo.name + '.git', prefix = 'repos/' + repo.owner + '/' + repo.name;
  const context = shadowHash({ profile: 'github-https-git.v1', root, gitBinary, gitSha256, githubBinary, githubSha256, repository: repo, actor: owner, remoteUrl });
  const localEnv = { ...environment, PATH: path.dirname(gitBinary) + path.delimiter + (environment.PATH ?? ''),
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  // The reused local inspector rejects caller-supplied Git scope variables.
  const inspectionEnv = { ...environment, PATH: localEnv.PATH };
  const fixed = ['--literal-pathspecs', '-C', root, '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
    '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
    '-c', 'http.sslVerify=true', '-c', 'http.followRedirects=false', '-c', 'http.proxy=', '-c', 'credential.helper=', '-c', 'core.askPass=',
    '-c', 'push.gpgSign=false', '-c', 'http.extraHeader='];
  function pinned() {
    if (fs.realpathSync(gitExecutable) !== gitBinary || fs.realpathSync(githubExecutable) !== githubBinary
      || !fs.statSync(gitBinary).isFile() || !fs.statSync(githubBinary).isFile() || hash(fs.readFileSync(gitBinary)) !== gitSha256
      || hash(fs.readFileSync(githubBinary)) !== githubSha256) fail('GITHUB_PUSH_HOST_PIN_CHANGED');
  }
  function budget() { const at = now(); if (!Number.isSafeInteger(at) || at < 0) fail('GITHUB_PUSH_CLOCK_INVALID'); return { at, mono: performance.now(), calls: 0 }; }
  function invoke(binary, args, state, env, remote = false, statuses = [0]) {
    pinned(); const elapsed = Math.max(now() - state.at, performance.now() - state.mono), timeout = Math.min(30000, Math.floor(60000 - elapsed));
    if (!Number.isFinite(elapsed) || elapsed < 0 || timeout <= 0 || ++state.calls > 24) fail('GITHUB_PUSH_LIMIT');
    let result;
    try { result = (binary === githubBinary ? runGithub : remote ? runRemoteGit : spawnSync)(binary, args,
      { cwd: remote ? transportCwd : root, env, encoding: 'utf8', shell: false, windowsHide: true, timeout, maxBuffer: 1048576, stdio: 'pipe' }); }
    catch { fail('GITHUB_PUSH_TRANSPORT_UNAVAILABLE'); }
    if (!statuses.includes(result?.status) || result.signal || result.error || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 1048576)
      fail('GITHUB_PUSH_TRANSPORT_UNAVAILABLE');
    pinned(); return result;
  }
  function local(args, state, statuses = [0]) { return invoke(gitBinary, [...fixed, ...args], state, localEnv, false, statuses); }
  const transportArgs = (args, gitDir = null) => [fixed[0], ...fixed.slice(3), ...(gitDir ? ['--git-dir=' + gitDir] : []), ...args];
  function preparationPath(observed) {
    return path.join(temporary, 'aidn-github-push-transport-' + shadowHash({ context, branch: observed.branch, head: observed.head }));
  }
  function prepareTransport(observed, state) {
    const directory = preparationPath(observed);
    try { fs.mkdirSync(directory); } catch (cause) {
      if (cause.code === 'EEXIST') throw Object.assign(Error('GITHUB_PUSH_PREPARATION_RECONCILIATION_REQUIRED'), { code: 'GITHUB_PUSH_PREPARATION_RECONCILIATION_REQUIRED', effect_status: 'unknown' });
      fail('GITHUB_PUSH_PREPARATION_UNAVAILABLE');
    }
    try {
      const objects = agentRunPhysicalPath(local(['rev-parse', '--path-format=absolute', '--git-path', 'objects'], state).stdout.trim(), { directory: true });
      if (/[\r\n]/.test(objects)) fail('GITHUB_PUSH_OBJECT_DIRECTORY_INVALID');
      invoke(gitBinary, ['-C', transportCwd, 'init', '--bare', '--template=', directory], state, localEnv);
      const info = agentRunPhysicalPath(path.join(directory, 'objects/info'), { directory: true });
      fs.writeFileSync(path.join(info, 'alternates'), objects.replaceAll('\\', '/') + '\n', { flag: 'wx' });
      const manifest = { contract_version: 'github-push-preparation.v1',
        remote_identity_sha256: context, observed_sha256: shadowHash(observed), ref: observed.ref, head: observed.head, pid: process.pid,
        prepared_at_ms: now(), objects };
      if (validateJsonSchema(manifest, preparationSchema, '$', { contractKind: 'workflow-definition' }).length) fail('GITHUB_PUSH_PREPARATION_INVALID');
      fs.writeFileSync(path.join(directory, 'aidn-preparation.json'), JSON.stringify(manifest), { flag: 'wx' });
      return directory;
    } catch (cause) {
      // Preparation was not exposed to a transport yet. Remove only our exact
      // checked directory; inability to prove cleanup remains unknown.
      cleanupTransport(directory); throw cause;
    }
  }
  function cleanupTransport(directory) {
    try {
      const real = agentRunPhysicalPath(directory, { directory: true });
      if (real !== directory || path.dirname(real) !== temporary || !/^aidn-github-push-transport-[a-f0-9]{64}$/.test(path.basename(real))) throw Error('preparation changed');
      fs.rmSync(real, { recursive: true, force: false });
    } catch { throw Object.assign(Error('GITHUB_PUSH_PREPARATION_RECONCILIATION_REQUIRED'), { code: 'GITHUB_PUSH_PREPARATION_RECONCILIATION_REQUIRED', effect_status: 'unknown' }); }
  }
  function api(endpoint, state, env) {
    const result = invoke(githubBinary, ['api', '--hostname', 'github.com', '--method', 'GET', endpoint, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'], state, env);
    try { return JSON.parse(result.stdout); } catch { fail('GITHUB_PUSH_PROVIDER_RESPONSE_INVALID'); }
  }
  function credential(state) {
    // Tokens are used only in child environments, never args, plans, receipts,
    // files or diagnostics. No credential helper/repository code is executed.
    const env = { ...environment, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_DEBUG: '', GH_FORCE_TTY: '', GH_PAGER: '' };
    const token = invoke(githubBinary, ['auth', 'token', '--hostname', 'github.com'], state, env).stdout.trim();
    if (!/^[\x21-\x7e]{10,4096}$/.test(token)) fail('GITHUB_PUSH_CREDENTIAL_UNAVAILABLE');
    const authenticated = { ...env, GH_TOKEN: token }, identity = api('user', state, authenticated), project = api(prefix, state, authenticated);
    if (identity?.node_id !== owner.node_id || identity.login !== owner.login || project?.node_id !== repo.node_id
      || project.full_name !== repo.owner + '/' + repo.name || project.permissions?.push !== true) fail('GITHUB_PUSH_IDENTITY_CHANGED');
    return { github: authenticated, git: { ...localEnv, AIDN_GITHUB_AUTH_HEADER: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64') } };
  }
  function configuration(state) {
    // Scope-specific HTTP/credential settings or URL rewrites could override
    // the displayed destination/authentication. Refuse them before network I/O.
    // Query without our HTTP/credential overrides; the fixed args themselves
    // would otherwise make every configured checkout fail the check.
    const raw = invoke(gitBinary, ['--literal-pathspecs', '-C', root, 'config', '--null', '--get-regexp', '^(url[.]|http[.]|credential[.]|remote[.].*[.](receivepack|uploadpack|proxy|pushoption)$)'], state, localEnv, false, [0, 1]);
    if (raw.status !== 1 || raw.stdout) fail('GITHUB_PUSH_TRANSPORT_CONFIGURATION_UNSUPPORTED');
  }
  function ref(branch, state) {
    if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(branch)) fail('GITHUB_PUSH_BRANCH_INVALID');
    const target = 'refs/heads/' + branch; local(['check-ref-format', target], state); return target;
  }
  function remoteHead(branch, state, credentials) {
    const target = ref(branch, state);
    const result = invoke(gitBinary, transportArgs(['--config-env=http.extraHeader=AIDN_GITHUB_AUTH_HEADER', 'ls-remote', '--refs', '--', remoteUrl, target]), state, credentials.git, true).stdout.trim();
    if (!result) return null;
    const rows = result.split(/\r?\n/), [head, name] = rows[0].split('\t');
    if (rows.length !== 1 || !oid(head) || name !== target) fail('GITHUB_PUSH_REMOTE_REF_INVALID');
    const observed = api(prefix + '/git/ref/heads/' + encodeURIComponent(branch), state, credentials.github);
    if (observed?.ref !== target || observed.object?.type !== 'commit' || observed.object.sha !== head) fail('GITHUB_PUSH_REMOTE_REF_CHANGED');
    return head;
  }
  function inspectLocal(branch, state) {
    for (const name of ['HEAD.lock', 'packed-refs.lock', 'config.lock'])
      if (fs.existsSync(agentRunPhysicalPath(path.resolve(root, local(['rev-parse', '--git-path', name], state).stdout.trim()), { missing: true })))
        fail('GITHUB_PUSH_LOCAL_CONTEXT_BLOCKED');
    return createLocalWorkflowBranchIntegration({ targetRoot: root, environment: inspectionEnv }).inspect({ source_branch: branch, target_branch: branch });
  }
  function inspectInternal(branch, assertLocal = null) {
    const state = budget(); configuration(state);
    const localView = assertLocal ? inspectLocal(branch, state) : createLocalWorkflowBranchIntegration({ targetRoot: root, environment: inspectionEnv }).inspect({ source_branch: branch, target_branch: branch });
    if ((!assertLocal && !localView.clean) || localView.current_ref !== ref(branch, state) || localView.head !== localView.source_head || localView.source_symbolic
      || localView.target_symbolic || localView.lock_present || localView.source_lock_present) fail('GITHUB_PUSH_LOCAL_CONTEXT_BLOCKED');
    if (assertLocal) assertLocal(structuredClone(localView));
    const credentials = credential(state), head = remoteHead(branch, state, credentials);
    if (head !== null && head !== localView.head) {
      local(['cat-file', '-e', head + '^{commit}'], state);
      if (local(['merge-base', '--is-ancestor', head, localView.head], state, [0, 1]).status !== 0) fail('GITHUB_PUSH_REMOTE_DIVERGED');
    }
    if (assertLocal) {
      const after = inspectLocal(branch, state); assertLocal(structuredClone(after));
      if (shadowHash(after) !== shadowHash(localView)) fail('GITHUB_PUSH_LOCAL_CONTEXT_CHANGED');
    }
    return { profile: 'github-https-git.v1', remote_identity_sha256: context, branch, ref: ref(branch, state), head: localView.head,
      remote_head: head, local_sha256: shadowHash(localView) };
  }
  const inspect = branch => inspectInternal(branch);
  function observeOwned(branch, { assertLocal } = {}) {
    if (typeof assertLocal !== 'function') fail('GITHUB_PUSH_OWNED_OBSERVATION_REQUIRED');
    return inspectInternal(branch, assertLocal);
  }
  function observeRemote(branch, { assertLocal } = {}) {
    if (typeof assertLocal !== 'function') fail('GITHUB_PUSH_OWNED_OBSERVATION_REQUIRED');
    const state = budget(); configuration(state); const target = ref(branch, state);
    assertLocal(); const credentials = credential(state), head = remoteHead(branch, state, credentials); assertLocal();
    return { profile: 'github-https-git.v1', remote_identity_sha256: context, branch, ref: target, remote_head: head };
  }
  pinned();
  // Read-only network commands must also be outside any checkout. Git push
  // receives a dedicated host-owned bare configuration only after a grant.
  const outside = spawnSync(gitBinary, ['-C', transportCwd, 'rev-parse', '--absolute-git-dir'], { env: localEnv, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000, stdio: 'pipe' });
  if (outside.status !== 128 || outside.error || outside.signal) fail('GITHUB_PUSH_TRANSPORT_CWD_REQUIRED');
  return Object.freeze({ inspect, observeOwned, observeRemote,
    async push(observed, { write = false, assertAuthorized } = {}) {
      let attempted = false, confirmed = false, preparation = null;
      try {
        if (write !== true || typeof assertAuthorized !== 'function' || checkShadowJson(observed)) fail('GITHUB_PUSH_EXPLICIT_WRITE_REQUIRED');
        if (fs.existsSync(preparationPath(observed))) throw Object.assign(Error('GITHUB_PUSH_PREPARATION_RECONCILIATION_REQUIRED'), { code: 'GITHUB_PUSH_PREPARATION_RECONCILIATION_REQUIRED', effect_status: 'unknown' });
        if (shadowHash(inspect(observed.branch)) !== shadowHash(observed)) fail('GITHUB_PUSH_PREVIEW_CHANGED');
        await assertAuthorized();
        if (shadowHash(inspect(observed.branch)) !== shadowHash(observed)) fail('GITHUB_PUSH_PREVIEW_CHANGED');
        if (observed.remote_head === observed.head) return { ...observed, changed: false, effect_status: 'no_effect' };
        const state = budget(); configuration(state); const credentials = credential(state);
        if (remoteHead(observed.branch, state, credentials) !== observed.remote_head) fail('GITHUB_PUSH_PREVIEW_CHANGED');
        await assertAuthorized(); pinned();
        preparation = prepareTransport(observed, state);
        await assertAuthorized();
        attempted = true;
        invoke(gitBinary, transportArgs(['--config-env=http.extraHeader=AIDN_GITHUB_AUTH_HEADER', 'push', '--no-verify', '--porcelain',
          '--force-with-lease=' + observed.ref + ':' + (observed.remote_head ?? ''), '--', remoteUrl, observed.head + ':' + observed.ref], preparation), state, credentials.git, true);
        await assertAuthorized();
        const current = inspect(observed.branch);
        if (current.head !== observed.head || current.remote_head !== observed.head || current.local_sha256 !== observed.local_sha256
          || current.remote_identity_sha256 !== observed.remote_identity_sha256) throw Error('GITHUB_PUSH_POSTCONDITION_UNCONFIRMED');
        await assertAuthorized(); confirmed = true; return { ...current, changed: true, effect_status: 'confirmed' };
      } catch (cause) {
        const uncertain = attempted || cause.effect_status === 'unknown', code = uncertain ? 'GITHUB_PUSH_RECONCILIATION_REQUIRED' : cause.code ?? 'GITHUB_PUSH_UNAVAILABLE';
        throw Object.assign(Error(code), { code, effect_status: uncertain ? 'unknown' : 'no_effect' });
      } finally {
        // An attempted but unconfirmed push retains its deterministic prepared
        // repository for observation. The same head cannot bypass that record.
        if (preparation && (!attempted || confirmed)) cleanupTransport(preparation);
      }
    },
  });
}
