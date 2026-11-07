import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import requestSchema from '../../core/contracts/workflow-definition/github-pr-open-request.v1.schema.json' with { type: 'json' };
import planSchema from '../../core/contracts/workflow-definition/github-pr-open-plan.v1.schema.json' with { type: 'json' };
import linkSchema from '../../core/contracts/workflow-definition/github-pr-link.v1.schema.json' with { type: 'json' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const valid = (x, schema) => !checkShadowJson(x) && !validateJsonSchema(x, schema, '$', { contractKind: 'workflow-definition' }).length;
const oid = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
// Fixed REST calls via an authenticated, host-pinned gh executable. A run seam
// doubles only the transport in offline tests, never business admission.
// https://cli.github.com/manual/gh_api
export function createGithubPullRequestOpen({ executable, executableSha256, workingDirectory, repository, environment = process.env,
  hostContextSha256 = null }, { run = spawnSync, now = Date.now } = {}) {
  if (!path.isAbsolute(executable ?? '') || !path.isAbsolute(workingDirectory ?? '') || !/^[a-f0-9]{64}$/.test(executableSha256 ?? '')
    || !repository || Object.keys(repository).sort().join(',') !== 'name,node_id,owner'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(repository.owner ?? '')
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name ?? '') || ['.', '..'].includes(repository.name)
    || typeof repository.node_id !== 'string' || !/^[A-Za-z0-9_=-]{1,256}$/.test(repository.node_id)
    || hostContextSha256 !== null && !/^[a-f0-9]{64}$/.test(hostContextSha256)
    || typeof run !== 'function' || typeof now !== 'function') fail('GITHUB_PR_OPEN_HOST_CONFIGURATION_INVALID');
  const binary = fs.realpathSync(executable), cwd = fs.realpathSync(workingDirectory), repo = structuredClone(repository);
  const env = { ...environment, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_DEBUG: '', GH_FORCE_TTY: '', GH_PAGER: '' };
  const prefix = 'repos/' + repo.owner + '/' + repo.name;
  const context = shadowHash({ executable_sha256: executableSha256, binary, cwd, repository: repo, profile: 'github.com-rest-pr-open.v1',
    ...(hostContextSha256 === null ? {} : { host_context_sha256: hostContextSha256 }) });
  function pinned() {
    if (fs.realpathSync(executable) !== binary || fs.realpathSync(workingDirectory) !== cwd || !fs.statSync(binary).isFile()
      || !fs.statSync(cwd).isDirectory() || sha(fs.readFileSync(binary)) !== executableSha256) fail('GITHUB_PR_OPEN_HOST_PIN_CHANGED');
  }
  pinned();
  function budget() { const at = now(); if (!Number.isSafeInteger(at) || at < 0) fail('GITHUB_PR_OPEN_CLOCK_INVALID'); return { at, mono: performance.now(), calls: 0 }; }
  function call(state, method, endpoint, body = null) {
    pinned(); const elapsed = Math.max(now() - state.at, performance.now() - state.mono), timeout = Math.floor(60000 - elapsed);
    if (!Number.isFinite(elapsed) || elapsed < 0 || timeout <= 0 || ++state.calls > 24) fail('GITHUB_PR_OPEN_LIMIT');
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
    if (body !== null) args.push('--input', '-');
    let response;
    try { response = run(binary, args, { cwd, env, input: body === null ? undefined : JSON.stringify(body), encoding: 'utf8', shell: false, windowsHide: true, timeout, maxBuffer: 2097152, stdio: 'pipe' }); }
    catch { fail('GITHUB_PR_OPEN_TRANSPORT_UNAVAILABLE'); }
    if (response?.status !== 0 || response.signal || response.error || typeof response.stdout !== 'string' || Buffer.byteLength(response.stdout) > 2097152) fail('GITHUB_PR_OPEN_TRANSPORT_UNAVAILABLE');
    let value; try { value = JSON.parse(response.stdout); } catch { fail('GITHUB_PR_OPEN_TRANSPORT_UNAVAILABLE'); }
    pinned(); return value;
  }
  function branch(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(value) || value.includes('..') || value.endsWith('/')
      || value.endsWith('.') || value.split('/').some(x => !x || x.endsWith('.lock') || x.startsWith('.'))) fail('GITHUB_PR_OPEN_BRANCH_INVALID');
    return value;
  }
  function assertRequest(request) {
    if (!valid(request, requestSchema)) fail('GITHUB_PR_OPEN_REQUEST_INVALID');
    branch(request.head_branch); branch(request.base_branch);
    if (request.head_branch === request.base_branch) fail('GITHUB_PR_OPEN_REQUEST_INVALID');
  }
  function remoteRef(state, name) {
    const result = call(state, 'GET', prefix + '/git/ref/heads/' + encodeURIComponent(name));
    if (result?.ref !== 'refs/heads/' + name || result.object?.type !== 'commit' || !oid(result.object?.sha)) fail('GITHUB_PR_OPEN_REMOTE_REF_INVALID');
    return result.object.sha;
  }
  function normalized(raw, request, baseOid) {
    if (!raw || raw.head?.repo?.node_id !== repo.node_id || raw.base?.repo?.node_id !== repo.node_id || raw.head.ref !== request.head_branch
      || raw.base.ref !== request.base_branch || raw.head.sha !== request.head_oid || raw.base.sha !== baseOid
      || typeof raw.title !== 'string' || raw.body !== null && typeof raw.body !== 'string' || raw.merged_at !== null && typeof raw.merged_at !== 'string'
      || Buffer.byteLength(raw.title) > 1024 || Buffer.byteLength(raw.body ?? '') > 65536) fail('GITHUB_PR_OPEN_SOURCE_CHANGED');
    const state = raw.merged_at !== null ? 'MERGED' : raw.state === 'open' ? 'OPEN' : raw.state === 'closed' ? 'CLOSED' : null;
    const value = { contract_version: 'github-pr-link.v1', repository_id: repo.node_id, node_id: raw.node_id, number: raw.number,
      head_branch: raw.head.ref, base_branch: raw.base.ref, head_oid: raw.head.sha, base_oid: raw.base.sha,
      state, draft: raw.draft, url: raw.html_url, title_sha256: sha(raw.title), body_sha256: sha(raw.body ?? '') };
    if (!valid(value, linkSchema) || value.url !== 'https://github.com/' + repo.owner + '/' + repo.name + '/pull/' + value.number
      || state === 'MERGED' && raw.state !== 'closed' || raw.merged_at !== null && !Number.isFinite(Date.parse(raw.merged_at))) fail('GITHUB_PR_OPEN_RESPONSE_INVALID');
    return value;
  }
  function observe(request, state) {
    assertRequest(request);
    const identity = call(state, 'GET', prefix);
    if (identity?.node_id !== repo.node_id || identity.full_name !== repo.owner + '/' + repo.name) fail('GITHUB_PR_OPEN_REPOSITORY_CHANGED');
    const head = remoteRef(state, request.head_branch), base = remoteRef(state, request.base_branch);
    if (head !== request.head_oid) fail('GITHUB_PR_OPEN_REMOTE_HEAD_CHANGED');
    if (head === base) fail('GITHUB_PR_OPEN_NO_CHANGES');
    const ids = new Set(), matches = []; let complete = false;
    for (let page = 1; page <= 5; page++) {
      const rows = call(state, 'GET', prefix + '/pulls?state=all&head=' + encodeURIComponent(repo.owner + ':' + request.head_branch)
        + '&base=' + encodeURIComponent(request.base_branch) + '&per_page=100&page=' + page);
      if (!Array.isArray(rows) || rows.length > 100) fail('GITHUB_PR_OPEN_LIST_INVALID');
      for (const raw of rows) { const row = normalized(raw, request, base); if (ids.has(row.node_id)) fail('GITHUB_PR_OPEN_LIST_INVALID'); ids.add(row.node_id); matches.push(row); }
      if (rows.length < 100) { complete = true; break; }
    }
    if (!complete) fail('GITHUB_PR_OPEN_LIST_INCOMPLETE');
    // Branches may change during pagination; neither an old head nor an old
    // base grants permission to create/recover a different PR.
    if (remoteRef(state, request.head_branch) !== head || remoteRef(state, request.base_branch) !== base) fail('GITHUB_PR_OPEN_SOURCE_CHANGED');
    if (matches.length > 1) fail('GITHUB_PR_OPEN_AMBIGUOUS');
    if (matches[0]?.state === 'CLOSED') fail('GITHUB_PR_OPEN_CLOSED_WITHOUT_MERGE');
    if (matches[0]?.state === 'MERGED') fail('GITHUB_PR_OPEN_ALREADY_MERGED');
    if (matches[0]?.draft) fail('GITHUB_PR_OPEN_DRAFT_REQUIRES_DECISION');
    return { repository: repo, head_oid: head, base_oid: base, existing: matches[0] ?? null };
  }
  function prepare(request, operationId, state = budget()) {
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('GITHUB_PR_OPEN_OPERATION_INVALID');
    const observed = observe(request, state), plan = { contract_version: 'github-pr-open-plan.v1', operation_id: operationId,
      transport_context_sha256: context, request: structuredClone(request), observed };
    if (!valid(plan, planSchema)) fail('GITHUB_PR_OPEN_PLAN_INVALID');
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  async function apply(prepared, { write = false, expectPlan, assertAuthorized } = {}) {
    let attempted = false;
    try {
      const plan = prepared?.plan;
      if (!prepared?.can_apply || !valid(plan, planSchema) || write !== true || typeof assertAuthorized !== 'function'
        || shadowHash(plan) !== expectPlan || prepared.plan_sha256 !== expectPlan || plan.transport_context_sha256 !== context) fail('GITHUB_PR_OPEN_EXPLICIT_EFFECT_REQUIRED');
      const state = budget();
      if (prepare(plan.request, plan.operation_id, state).plan_sha256 !== expectPlan) fail('GITHUB_PR_OPEN_PREVIEW_CHANGED');
      await assertAuthorized();
      if (prepare(plan.request, plan.operation_id, state).plan_sha256 !== expectPlan) fail('GITHUB_PR_OPEN_PREVIEW_CHANGED');
      if (plan.observed.existing) { await assertAuthorized(); return { effect_status: 'no_effect', action: 'recovered', pull_request: plan.observed.existing }; }
      // GitHub creation has no expected-head CAS. Recheck after the mutation;
      // any timeout/race/partial error remains unknown, never a retry permit.
      // https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
      attempted = true;
      const raw = call(state, 'POST', prefix + '/pulls', { title: plan.request.title, body: plan.request.body,
        head: plan.request.head_branch, base: plan.request.base_branch, draft: false, maintainer_can_modify: false });
      const created = normalized(raw, plan.request, plan.observed.base_oid);
      if (created.state !== 'OPEN' || created.draft || created.title_sha256 !== sha(plan.request.title) || created.body_sha256 !== sha(plan.request.body)) fail('GITHUB_PR_OPEN_UNCONFIRMED');
      const after = observe(plan.request, state);
      if (!after.existing || shadowHash(after.existing) !== shadowHash(created)) fail('GITHUB_PR_OPEN_UNCONFIRMED');
      await assertAuthorized();
      return { effect_status: 'confirmed', action: 'created', pull_request: created };
    } catch (cause) {
      const code = attempted ? 'GITHUB_PR_OPEN_RECONCILIATION_REQUIRED' : cause.code ?? 'GITHUB_PR_OPEN_UNAVAILABLE';
      throw Object.assign(Error(code), { code, effect_status: attempted ? 'unknown' : 'no_effect' });
    }
  }
  return Object.freeze({ prepare: (request, operationId) => prepare(request, operationId), apply });
}
