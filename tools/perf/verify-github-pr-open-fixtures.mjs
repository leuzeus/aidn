import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGithubPullRequestOpen } from '../../src/adapters/git-provider/github-pull-request-open.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
const sha = x => createHash('sha256').update(x).digest('hex'), parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'aidn-github-open-'));
const head = 'a'.repeat(40), base = 'b'.repeat(40), operationId = 'op_' + '1'.repeat(40);
const request = { contract_version: 'github-pr-open-request.v1', head_branch: 'S001-example', base_branch: 'dev', head_oid: head, title: 'Session S001', body: 'Bound fixture description' };
const config = { executable: process.execPath, executableSha256: sha(fs.readFileSync(process.execPath)), workingDirectory: root,
  repository: { owner: 'fixture', name: 'repository', node_id: 'R_fixture' }, environment: { GH_HOST: 'foreign.invalid', GH_DEBUG: 'api', GH_TOKEN: 'fixture-not-a-token' } };
function fixture({ before = null, response = null, afterCreate = null, clock = Date.now } = {}) {
  const state = { head, base, pulls: [], posts: 0, calls: 0 }, calls = [];
  const raw = (extra = {}) => ({ node_id: 'PR_fixture', number: 7, head: { ref: request.head_branch, sha: state.head, repo: { node_id: 'R_fixture' } },
    base: { ref: request.base_branch, sha: state.base, repo: { node_id: 'R_fixture' } }, title: request.title, body: request.body,
    state: 'open', merged_at: null, draft: false, html_url: 'https://github.com/fixture/repository/pull/7', ...extra });
  const adapter = createGithubPullRequestOpen(config, { now: clock, run(binary, args, options) {
    assert.equal(binary, fs.realpathSync(process.execPath)); assert.equal(options.cwd, root); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.equal(options.env.GH_HOST, 'github.com'); assert.equal(options.env.GH_DEBUG, ''); assert.equal(options.env.GH_PROMPT_DISABLED, '1');
    assert.ok(options.timeout > 0 && options.timeout <= 60000);
    const method = args[4], endpoint = args[5], body = options.input ? JSON.parse(options.input) : null;
    calls.push({ method, endpoint, body }); state.calls++; before?.({ state, method, endpoint, raw });
    if (response) return response({ state, method, endpoint, raw });
    let data;
    if (method === 'GET' && endpoint === 'repos/fixture/repository') data = { node_id: 'R_fixture', full_name: 'fixture/repository' };
    else if (method === 'GET' && endpoint.includes('/git/ref/heads/')) {
      const name = decodeURIComponent(endpoint.split('/git/ref/heads/')[1]);
      data = { ref: 'refs/heads/' + name, object: { type: 'commit', sha: name === request.head_branch ? state.head : state.base } };
    } else if (method === 'GET' && endpoint.includes('/pulls?')) {
      const page = Number(new URL('https://fixture.invalid/' + endpoint).searchParams.get('page')); data = state.pulls.slice((page - 1) * 100, page * 100);
    } else if (method === 'POST' && endpoint === 'repos/fixture/repository/pulls') {
      assert.deepEqual(body, { title: request.title, body: request.body, head: request.head_branch, base: request.base_branch, draft: false, maintainer_can_modify: false });
      state.posts++; data = raw(); state.pulls.push(data); afterCreate?.({ state, data });
    } else assert.fail('Unexpected provider call');
    return { status: 0, stdout: JSON.stringify(data), stderr: '' };
  } });
  return { adapter, state, calls, raw };
}
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
try {
  await test('private request, plan and link schemas are closed and use supported vocabulary', () => {
    for (const name of ['github-pr-open-request.v1', 'github-pr-open-plan.v1', 'github-pr-link.v1']) {
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + name + '.schema.json', import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
  });
  await test('preview reads authenticated transport repository/ref/list data without mutation', () => {
    const f = fixture(), p = f.adapter.prepare(request, operationId); assert.equal(p.can_apply, true); assert.equal(p.plan.observed.existing, null);
    assert.equal(p.plan.observed.base_oid, base); assert.equal(f.state.posts, 0); assert.equal(f.calls.length, 6);
  });
  await test('exact-plan permission is required before POST and a denied grant has no effect', async () => {
    const f = fixture(), p = f.adapter.prepare(request, operationId);
    for (const options of [{ write: false, expectPlan: p.plan_sha256, assertAuthorized() {} }, { write: true, expectPlan: '0'.repeat(64), assertAuthorized() {} },
      { write: true, expectPlan: p.plan_sha256, assertAuthorized() { throw Error('denied'); } }]) {
      await assert.rejects(f.adapter.apply(p, options), x => x.effect_status === 'no_effect'); assert.equal(f.state.posts, 0);
    }
  });
  await test('creation posts once and confirms the exact PR from a fresh complete remote observation', async () => {
    const f = fixture(), p = f.adapter.prepare(request, operationId); let grants = 0;
    const result = await f.adapter.apply(p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() { grants++; } });
    assert.equal(result.effect_status, 'confirmed'); assert.equal(result.action, 'created'); assert.equal(result.pull_request.node_id, 'PR_fixture');
    assert.equal(result.pull_request.head_oid, head); assert.equal(f.state.posts, 1); assert.ok(grants >= 2); assert.equal(f.calls.at(-1).method, 'GET');
  });
  await test('recovery of an exact existing open PR does not create or edit another PR', async () => {
    const f = fixture(); f.state.pulls.push(f.raw()); const p = f.adapter.prepare(request, operationId);
    const result = await f.adapter.apply(p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() {} });
    assert.equal(result.action, 'recovered'); assert.equal(result.effect_status, 'no_effect'); assert.equal(f.state.posts, 0);
  });
  await test('changed head/base or an appearing PR invalidates the exact plan before POST', async () => {
    for (const mutate of [f => f.state.head = 'c'.repeat(40), f => f.state.base = 'c'.repeat(40), f => f.state.pulls.push(f.raw())]) {
      const f = fixture(), p = f.adapter.prepare(request, operationId); mutate(f);
      await assert.rejects(f.adapter.apply(p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() {} }), x => x.effect_status === 'no_effect'); assert.equal(f.state.posts, 0);
    }
  });
  await test('closed, merged and draft PRs retain distinct diagnostic outcomes without create', () => {
    for (const [change, code] of [[{ state: 'closed' }, 'GITHUB_PR_OPEN_CLOSED_WITHOUT_MERGE'], [{ state: 'closed', merged_at: '2026-11-03T00:00:00Z' }, 'GITHUB_PR_OPEN_ALREADY_MERGED'], [{ draft: true }, 'GITHUB_PR_OPEN_DRAFT_REQUIRES_DECISION']]) {
      const f = fixture(); f.state.pulls.push(f.raw(change)); assert.throws(() => f.adapter.prepare(request, operationId), { code }); assert.equal(f.state.posts, 0);
    }
  });
  await test('equal remote head and base are refused without fabricating a creatable PR', () => {
    const f = fixture(); f.state.base = head; assert.throws(() => f.adapter.prepare(request, operationId), { code: 'GITHUB_PR_OPEN_NO_CHANGES' }); assert.equal(f.state.posts, 0);
  });
  await test('foreign repository/head/branch and ambiguous identities cannot be recovered', () => {
    for (const change of [{ head: { ref: request.head_branch, sha: head, repo: { node_id: 'R_foreign' } } },
      { head: { ref: 'S999-wrong', sha: head, repo: { node_id: 'R_fixture' } } }, { html_url: 'https://foreign.invalid/pull/7' }]) {
      const f = fixture(); f.state.pulls.push(f.raw(change)); assert.throws(() => f.adapter.prepare(request, operationId)); assert.equal(f.state.posts, 0);
    }
    const f = fixture(); f.state.pulls.push(f.raw(), f.raw({ node_id: 'PR_other', number: 8, html_url: 'https://github.com/fixture/repository/pull/8' }));
    assert.throws(() => f.adapter.prepare(request, operationId), { code: 'GITHUB_PR_OPEN_AMBIGUOUS' });
  });
  await test('partial or unsuccessful transport is unavailable rather than an empty PR list', () => {
    for (const response of [{ status: 1, stdout: '', stderr: 'secret must not escape' }, { status: 0, stdout: '{' }, { status: 0, stdout: '[]' }]) {
      const f = fixture({ response: () => response }); assert.throws(() => f.adapter.prepare(request, operationId), error => !error.message.includes('secret'));
    }
  });
  await test('pagination is complete and duplicate or truncated pages cannot become a unique PR', () => {
    const f = fixture(); f.state.pulls = Array.from({ length: 500 }, (_, index) => f.raw({ node_id: 'PR_' + index, number: index + 1,
      html_url: 'https://github.com/fixture/repository/pull/' + (index + 1) }));
    assert.throws(() => f.adapter.prepare(request, operationId), { code: 'GITHUB_PR_OPEN_LIST_INCOMPLETE' }); assert.equal(f.state.posts, 0);
    const duplicate = fixture(); duplicate.state.pulls.push(duplicate.raw(), duplicate.raw());
    assert.throws(() => duplicate.adapter.prepare(request, operationId), { code: 'GITHUB_PR_OPEN_LIST_INVALID' });
  });
  await test('lost permission after create is unknown with no retry or fabricated no_effect', async () => {
    let permitted = true; const f = fixture({ afterCreate() { permitted = false; } }), p = f.adapter.prepare(request, operationId);
    await assert.rejects(f.adapter.apply(p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() { if (!permitted) throw Error('denied'); } }),
      { code: 'GITHUB_PR_OPEN_RECONCILIATION_REQUIRED', effect_status: 'unknown' }); assert.equal(f.state.posts, 1);
  });
  await test('head race or malformed creation response remains unknown after attempted effect', async () => {
    for (const change of [({ state }) => state.head = 'c'.repeat(40), ({ data }) => data.node_id = null, () => { throw Error('transport timeout after effect'); }]) {
      const f = fixture({ afterCreate: change }), p = f.adapter.prepare(request, operationId);
      await assert.rejects(f.adapter.apply(p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() {} }), { effect_status: 'unknown' }); assert.equal(f.state.posts, 1);
    }
  });
  await test('authored request cannot select commands, endpoints or self-authorize', () => {
    const f = fixture(); for (const extra of [{ authorized: true }, { endpoint: '/other' }, { executable: 'other' }]) assert.throws(() => f.adapter.prepare({ ...request, ...extra }, operationId), { code: 'GITHUB_PR_OPEN_REQUEST_INVALID' });
    assert.equal(f.state.calls, 0);
    assert.throws(() => f.adapter.prepare({ ...request, head_branch: '../escape' }, operationId)); assert.equal(f.state.calls, 0);
  });
  await test('host binary pin and total request deadline are checked before any effect', () => {
    assert.throws(() => createGithubPullRequestOpen({ ...config, executableSha256: '0'.repeat(64) }), { code: 'GITHUB_PR_OPEN_HOST_PIN_CHANGED' });
    let time = 1793664000000; const f = fixture({ clock: () => time, before() { time += 60001; } });
    assert.throws(() => f.adapter.prepare(request, operationId), { code: 'GITHUB_PR_OPEN_LIMIT' }); assert.equal(f.state.posts, 0);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, transport: 'DOUBLED_GH_REST', business_adapter: 'ACTUAL', real_github: 'NOT_RUN', standard_host: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally { assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('aidn-github-open-')); fs.rmSync(root, { recursive: true, force: true }); console.log(JSON.stringify({ cleanup_completed: true })); }
