#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from './test-git-fixture-lib.mjs';
import { prepareActivationFixture, prepareWorkflowDocumentsFixture, completeDriftCheckFixture } from './test-activation-fixture-lib.mjs';
import { detectGatingSignals } from '../../src/core/gating/gating-signal-policy.mjs';

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
const statusPath = 'docs/audit/cycles/C101-migration-alpha/status.md';
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
  fs.renameSync(path.join(root, 'docs/audit/cycles/C101-feature-alpha'), path.join(root, 'docs/audit/cycles/C101-migration-alpha'));
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
const drift = (root, mode = 'COMMITTING') => run(root, 'tools/codex/run-json-hook.mjs', ['--skill', 'drift-check', '--mode', mode, '--strict']);
const eventPath = root => path.join(root, '.aidn/runtime/perf/workflow-events.ndjson');
const events = root => fs.readFileSync(eventPath(root), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const completed = root => events(root).filter(event => event.event === 'drift_check_completed').length;
function hashes(root) {
  const result = {};
  const visit = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git') continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) visit(file);
    else result[path.relative(root, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } };
  visit(root); return result;
}
try {
  for (const file of ['src/database/client.mjs', 'src/auth/login.ts', 'migrations/001.sql',
    'docs/audit/cycles/C101-migration-alpha/schema.sql', 'docs/audit/cycles/C101-migration-alpha/other.md']) {
    assert.equal(detectGatingSignals({ changedFiles: [file], reloadReasonCodes: [] }).cross_domain_touch, true, file);
  }
  assert.equal(detectGatingSignals({ changedFiles: [statusPath], reloadReasonCodes: [] }).cross_domain_touch, false);
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
    const proofCount = completed(root);
    assert.equal(drift(root).result.ok, false);
    assert.equal(completed(root), proofCount, 'refused closure must not complete drift');
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
    const proofCount = completed(root);
    assert.equal(drift(root).result.ok, false);
    assert.equal(completed(root), proofCount);
    console.log(`PASS ${kind}: refusal propagated through hook and Codex wrapper`);
  }
  for (const mode of ['files', 'dual', 'db-only']) {
    const root = fixture(mode);
    put(root, statusPath, status('DONE'));
    fs.appendFileSync(path.join(root, 'docs/audit/sessions/S101-alpha.md'), '\nClosure reviewed.\n');
    fs.appendFileSync(path.join(root, 'docs/audit/snapshots/context-snapshot.md'), '\nCycle C101 closed.\n');
    if (mode !== 'files') sync(root);
    const history = events(root).map(event => JSON.stringify({ ...event, ts: new Date(Date.now() - 46 * 60000).toISOString() })).join('\n') + '\n';
    fs.writeFileSync(eventPath(root), history); // age only this owned fixture's proof
    const proofCount = completed(root);
    const warning = close(root).result;
    assert.equal(warning.ok, false);
    assert.equal(warning.result, 'warn');
    assert.equal(warning.action, 'run_conditional_drift_check');
    const beforePreview = hashes(root);
    const preview = run(root, 'tools/perf/gating-evaluate.mjs', ['--mode', 'COMMITTING', '--complete-drift-check', '--no-emit-event']).result;
    assert.equal(preview.result, 'warn');
    assert.equal(preview.levels.level2.changed_files_count, 3);
    assert(!preview.levels.level1.reason_codes.includes('MAPPING_MISSING'));
    assert.deepEqual(hashes(root), beforePreview, 'preview must not write a cache, event or project file');
    assert.equal(drift(root, 'THINKING').result.ok, false);
    assert.equal(completed(root), proofCount);
    assert.equal(drift(root).result.ok, true);
    assert.equal(completed(root), proofCount + 1);
    assert.equal(close(root).result.ok, true);
    assert.equal(run(root, 'tools/perf/reload-check.mjs').result.decision, 'stop');
    assert.equal(run(root, 'tools/perf/gating-evaluate.mjs', ['--mode', 'COMMITTING', '--no-emit-event']).result.result, 'stop');
    assert(fs.readFileSync(eventPath(root), 'utf8').startsWith(history));
    // Terminal ownership must not discard objective drift or sensitive changes.
    fs.appendFileSync(path.join(root, 'docs/audit/sessions/S101-alpha.md'), '\nsession_objective: replace the unrelated payment system\n');
    if (mode !== 'files') sync(root);
    assert.equal(drift(root).result.result, 'warn');
    assert.equal(completed(root), proofCount + 1);
    console.log(`PASS ${mode}: closure warning -> read-only preview -> explicit drift proof -> closure; ordinary work and unresolved objective still refused`);
  }
} finally {
  for (const root of roots) {
    assert(path.dirname(root) === os.tmpdir(), 'cleanup must remain within owned temporary roots');
    const cleaned = removePathWithRetry(root); assert(cleaned.ok, cleaned.error?.message);
  }
  console.log('PASS cleanup: only owned temporary clients removed');
}
