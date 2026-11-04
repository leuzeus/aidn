import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLocalWorkflowGitCheckpoint } from '../../src/adapters/runtime/local-workflow-git-checkpoint.mjs';
import { createLocalWorkflowBranchIntegration } from '../../src/adapters/runtime/local-workflow-branch-integration.mjs';

// Separate disposable repositories; no historic case, plan or effect is changed.
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-git-binding-'));
const root = path.join(base, 'project'), first = path.join(base, 'first.git'), other = path.join(base, 'other');
const git = (at, ...args) => execFileSync('git', ['-C', at, '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), ...args],
  { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const scope = { source_branch: 'dev', target_branch: 'dev' };
try {
  fs.mkdirSync(root); git(root, 'init', '-b', 'dev', '--separate-git-dir=' + first);
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgSign', 'false'); git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'sample.txt'), 'Scoped content\n'); git(root, 'add', 'sample.txt'); git(root, 'commit', '-m', 'test: scoped binding');
  const checkpoint = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: 'cycle-terminal', approvedPaths: ['sample.txt'] });
  const branch = createLocalWorkflowBranchIntegration({ targetRoot: root });
  const before = checkpoint.inspect(), branchBefore = branch.inspect(scope);
  assert.equal(before.index_sha256, hash(path.join(first, 'index')));
  assert.equal(branchBefore.index_sha256, before.index_sha256);
  console.log('PASS retained checkpoint and branch ports observe the original physical binding');

  execFileSync('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), 'clone', '--no-hardlinks', root, other],
    { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  git(other, 'config', 'user.name', 'Fixture'); git(other, 'config', 'user.email', 'fixture@example.invalid');
  git(other, 'config', 'commit.gpgSign', 'false'); git(other, 'config', 'core.worktree', root);
  git(other, 'update-index', '--index-version', '4');
  const second = path.join(other, '.git');
  assert.notEqual(hash(path.join(first, 'index')), hash(path.join(second, 'index')));
  const descriptor = fs.openSync(path.join(root, '.git'), 'r+');
  try { fs.ftruncateSync(descriptor, 0); fs.writeSync(descriptor, 'gitdir: ' + second.replaceAll('\\', '/') + '\n'); }
  finally { fs.closeSync(descriptor); }
  assert.equal(git(root, 'rev-parse', 'HEAD'), before.head); assert.equal(git(root, 'status', '--porcelain'), '');
  for (let i = 0; i < 2; i++) {
    assert.throws(() => checkpoint.inspect(), { code: 'WORKFLOW_GIT_REPOSITORY_BINDING_CHANGED' });
    assert.throws(() => branch.inspect(scope), { code: 'WORKFLOW_BRANCH_REPOSITORY_BINDING_CHANGED' });
  }
  console.log('PASS same-content gitfile redirection refuses without adopting the new gitdir or index');
  const fresh = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: 'cycle-terminal', approvedPaths: ['sample.txt'] }).inspect();
  assert.equal(fresh.head, before.head); assert.equal(fresh.index_sha256, hash(path.join(second, 'index')));
  assert.notEqual(fresh.index_sha256, before.index_sha256);
  console.log('PASS an explicitly new port observes the distinct index; old ports remain refused');
  console.log(JSON.stringify({ status: 'PASS', checks: 3, roots: [base], model_calls: 0,
    scope: 'offline physical Git binding only; production dispatcher, full workflow and installed package NOT_RUN' }));
} finally { console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: [base] })); }
