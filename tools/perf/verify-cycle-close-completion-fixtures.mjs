#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from './test-git-fixture-lib.mjs';
import { prepareActivationFixture, prepareWorkflowDocumentsFixture, completeDriftCheckFixture } from './test-activation-fixture-lib.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
const roots = [];
function run(root, script, args = []) {
  const child = spawnSync(process.execPath, [path.join(repo, script), '--target', root, ...args, '--json'],
    { encoding: 'utf8', windowsHide: true, timeout: 90000,
      env: { ...process.env, AIDN_STATE_MODE: '', AIDN_INDEX_STORE_MODE: '' } });
  assert.equal(child.error, undefined, child.error?.message);
  assert.notEqual(child.status, null, child.stderr);
  const result = JSON.parse(child.stdout);
  return { result, status: child.status };
}
const put = (root, relative, text) => {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const statusPath = 'docs/audit/cycles/C101-feature-alpha/status.md';
function status(state, usage = 'VERIFIED', branch = 'feature/C101-alpha') {
  return `state: ${state}\nbranch_name: ${branch}\nsession_owner: S101\ncurrent goal: finalize alpha feature\ndor_state: READY\nusage_matrix_scope: shared\nusage_matrix_state: ${usage}\nusage_matrix_rationale: none\n`;
}
function sync(root) {
  const result = run(root, 'tools/perf/index-sync.mjs', ['--store', 'sqlite']);
  assert.equal(result.status, 0);
}
function fixture(mode = 'files') {
  const root = copyFixtureToTmp(path.join(repo, 'tests/fixtures/perf-current-state/active'), os.tmpdir(), 'aidn-close-completion');
  roots.push(root);
  prepareWorkflowDocumentsFixture(root);
  put(root, statusPath, status('VERIFYING'));
  put(root, '.aidn/config.json', JSON.stringify({ runtime: { stateMode: mode } }));
  initGitRepo(root, { sourceBranch: 'dev', workingBranch: 'feature/C101-alpha' });
  prepareActivationFixture(root);
  fs.appendFileSync(path.join(root, '.git/info/exclude'), '\n/.aidn/runtime/\n');
  execFileSync('git', ['-C', root, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', root, 'commit', '--amend', '--no-edit'], { stdio: 'pipe' });
  if (mode !== 'files') sync(root);
  completeDriftCheckFixture(root);
  return root;
}
const close = root => run(root, 'tools/codex/run-json-hook.mjs', ['--skill', 'cycle-close', '--mode', 'COMMITTING', '--strict', '--fail-on-repair-block']);
try {
  for (const mode of ['files', 'dual', 'db-only']) for (const finalState of ['DONE', 'NO_GO', 'DROPPED']) {
    const root = fixture(mode);
    put(root, statusPath, status(finalState));
    const current = path.join(root, 'docs/audit/CURRENT-STATE.md');
    fs.writeFileSync(current, fs.readFileSync(current, 'utf8').replace('active_cycle: C101', 'active_cycle: none'));
    if (mode !== 'files') sync(root);
    const generic = run(root, 'tools/perf/reload-check.mjs').result;
    assert.equal(generic.decision, 'stop');
    assert(generic.reason_codes.includes('MAPPING_MISSING'));
    assert.equal(generic.active_cycles_count, 0);
    const before = fs.readFileSync(path.join(root, statusPath));
    const closure = close(root);
    assert.equal(closure.result.ok, true, JSON.stringify(closure.result));
    assert.equal(closure.result.result, 'ok');
    assert.equal(closure.result.action, 'cycle_close_allowed');
    assert.deepEqual(fs.readFileSync(path.join(root, statusPath)), before);
    assert.equal(run(root, 'tools/perf/reload-check.mjs').result.decision, 'stop', 'closure must not authorize ordinary work');
    console.log(`PASS ${mode} ${finalState}: strict closure, no active cycle, ordinary mapping still refused`);
  }
  for (const mode of ['files', 'db-only']) {
    const root = fixture(mode);
    put(root, statusPath, status('DONE', 'PARTIAL'));
    if (mode !== 'files') {
      sync(root);
      put(root, statusPath, status('DONE', 'VERIFIED')); // misleading projection
    }
    const incomplete = close(root).result;
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.result, 'stop');
    assert.equal(incomplete.reason_code ?? incomplete.normalized?.reason_code, 'CYCLE_CLOSE_USAGE_MATRIX_INCOMPLETE');
    console.log(`PASS ${mode}: incomplete canonical usage matrix refuses`);
  }
  for (const kind of ['missing', 'ambiguous', 'checkpoint']) {
    const root = fixture();
    put(root, statusPath, status('DONE', 'VERIFIED', kind === 'missing' ? 'feature/C999-other' : 'feature/C101-alpha'));
    if (kind === 'ambiguous') put(root, 'docs/audit/cycles/C102-other/status.md', status('OPEN'));
    if (kind === 'checkpoint') fs.unlinkSync(path.join(root, 'docs/audit/SPEC.md'));
    const hook = run(root, 'tools/perf/cycle-close-hook.mjs', ['--mode', 'COMMITTING']);
    assert.equal(hook.status, 1);
    assert.equal(hook.result.ok, false);
    assert.equal(hook.result.result, 'stop');
    assert.equal(hook.result.summary.result, 'stop');
    assert(hook.result.reason_code);
    if (kind === 'checkpoint') {
      assert.equal(hook.result.admission.ok, true);
      assert.equal(hook.result.checkpoint.ok, false);
      assert(hook.result.blocking_reasons.includes('REQUIRED_ARTIFACT_MISSING'));
    }
    const wrapped = close(root).result;
    assert.equal(wrapped.ok, false);
    assert.equal(wrapped.result, 'stop');
    assert.equal(wrapped.action, hook.result.action);
    assert.equal(wrapped.reason_code ?? wrapped.normalized?.reason_code, hook.result.reason_code);
    console.log(`PASS ${kind}: refusal propagated through hook and Codex wrapper`);
  }
  {
    const root = fixture();
    put(root, statusPath, status('DONE'));
    fs.unlinkSync(path.join(root, '.aidn/runtime/perf/workflow-events.ndjson'));
    const warning = close(root).result;
    assert.equal(warning.ok, false);
    assert.equal(warning.result, 'warn');
    assert.equal(warning.action, 'run_conditional_drift_check');
    console.log('PASS checkpoint warning remains visible and is not closure success');
  }
} finally {
  for (const root of roots) {
    assert(path.dirname(root) === os.tmpdir(), 'cleanup must remain within owned temporary roots');
    const cleaned = removePathWithRetry(root); assert(cleaned.ok, cleaned.error?.message);
  }
  console.log('PASS cleanup: only owned temporary clients removed');
}
