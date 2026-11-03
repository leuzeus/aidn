import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGithubPullRequestOpen } from '../../src/adapters/git-provider/github-pull-request-open.mjs';
// Offline transport only. Ref queries read an actual local bare Git remote;
// POST/list responses use a durable fake provider store outside the project.
// It cannot authenticate a real GitHub service or human identity.
export function createGithubPrOpenTransportFixture({ remoteRoot, controlRoot, afterPost = null }) {
  const file = path.join(controlRoot, 'pr-open-provider-fixture.json');
  const repository = { owner: 'fixture', name: 'repository', node_id: 'R_fixture' };
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { posts: 0, pulls: [] };
  function ref(name) { return execFileSync('git', ['--git-dir=' + remoteRoot, 'rev-parse', '--verify', 'refs/heads/' + name], { encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 10000 }).trim(); }
  const port = createGithubPullRequestOpen({ executable: process.execPath, executableSha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
    workingDirectory: controlRoot, repository, environment: { GH_TOKEN: 'fixture-not-a-token' } }, { run(_binary, args, options) {
    const method = args[4], endpoint = args[5]; let value;
    try {
      if (method === 'GET' && endpoint === 'repos/fixture/repository') value = { node_id: repository.node_id, full_name: 'fixture/repository' };
      else if (method === 'GET' && endpoint.includes('/git/ref/heads/')) {
        const name = decodeURIComponent(endpoint.split('/git/ref/heads/')[1]); value = { ref: 'refs/heads/' + name, object: { type: 'commit', sha: ref(name) } };
      } else if (method === 'GET' && endpoint.includes('/pulls?')) {
        const query = new URL('https://fixture.invalid/' + endpoint).searchParams, page = Number(query.get('page'));
        const rows = read().pulls.filter(row => 'fixture:' + row.head.ref === query.get('head') && row.base.ref === query.get('base'));
        value = rows.slice((page - 1) * 100, page * 100).map(row => ({ ...row, base: { ...row.base, sha: ref(row.base.ref) }, head: { ...row.head, sha: ref(row.head.ref) } }));
      } else if (method === 'POST' && endpoint === 'repos/fixture/repository/pulls') {
        const request = JSON.parse(options.input), state = read(), number = state.posts + 1;
        if (state.pulls.some(row => row.head.ref === request.head && row.base.ref === request.base)) throw Error('duplicate PR');
        value = { node_id: 'PR_fixture_' + number, number, state: 'open', merged_at: null, draft: request.draft,
          head: { ref: request.head, sha: ref(request.head), repo: { node_id: repository.node_id } }, base: { ref: request.base, sha: ref(request.base), repo: { node_id: repository.node_id } },
          html_url: 'https://github.com/fixture/repository/pull/' + number, title: request.title, body: request.body };
        fs.writeFileSync(file, JSON.stringify({ posts: number, pulls: [...state.pulls, value] })); afterPost?.();
      } else throw Error('unsupported fixture provider call');
      return { status: 0, stdout: JSON.stringify(value), stderr: '' };
    } catch { return { status: 1, stdout: '', stderr: 'fixture provider unavailable' }; }
  } });
  return Object.freeze({ port, read });
}
