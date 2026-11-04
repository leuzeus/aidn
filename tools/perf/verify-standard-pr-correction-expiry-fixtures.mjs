import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCorrectionRealPortFixture, bindCorrectionRealPorts, acceptFixtureReopen,
  correctionFixtureSigner as signer, fixtureOp } from './standard-pr-correction-real-port-fixture-lib.mjs';

const here = fileURLToPath(import.meta.url), owned = [];
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'files';
assert.ok(['files', 'dual', 'db-only'].includes(mode));
const child = process.argv.find(arg => arg.startsWith('--child='));
if (child) {
  const data = signer.verify(JSON.parse(fs.readFileSync(child.slice(8), 'utf8'))), f = bindCorrectionRealPorts(data.fixture);
  const result = data.action === 'reopen' ? await f.port.prepare(f.instance, f.input)
    : await f.checkpoint.prepare(f.instance, data.input, fixtureOp(6));
  console.log(JSON.stringify(result)); process.exit(0);
}
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const hash = data => createHash('sha256').update(data).digest('hex');
function bytes(root) {
  const rows = [];
  function walk(directory) {
    const info = fs.lstatSync(directory); assert.equal(info.isSymbolicLink(), false);
    rows.push({ path: path.relative(root, directory), directory: true });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name); assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) walk(file);
      else { assert.equal(entry.isFile(), true); const value = fs.readFileSync(file); rows.push({ path: path.relative(root, file), size: value.length, sha256: hash(value) }); }
    }
  }
  walk(root); return rows;
}
const evidenceDirectory = f => {
  const dir = path.join(f.root, '.aidn/runtime/standard-workflow/correction-expiry'); fs.mkdirSync(dir, { recursive: true }); return dir;
};
function save(f, name, value) {
  const file = path.join(evidenceDirectory(f), name + '.json');
  fs.writeFileSync(file, JSON.stringify(signer.seal(value), null, 2) + '\n', { flag: 'wx' }); return file;
}
function cold(f, action, input) {
  const file = save(f, 'cold-' + action, { fixture: f.saved, action, input: input ?? null });
  const before = bytes(f.root), remoteBefore = bytes(f.remoteRoot);
  const result = JSON.parse(execFileSync(process.execPath, [here, '--child=' + file],
    { encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 180000, maxBuffer: 1048576 }));
  assert.deepEqual(bytes(f.root), before); assert.deepEqual(bytes(f.remoteRoot), remoteBefore); return result;
}
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + mode + ': ' + name); };
try {
  const f = await createCorrectionRealPortFixture(mode, owned, (root, branch) => {
    const remote = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-correction-remote-')); owned.push(remote);
    git(remote, 'init', '--bare'); git(root, '-c', 'core.hooksPath=NUL', '-c', 'protocol.file.allow=always', 'push', remote, branch + ':refs/heads/' + branch);
    return remote;
  });
  let clock = Date.now(); const bound = bindCorrectionRealPorts(f.saved, { now: () => clock });
  for (const action of ['reopen', 'checkpoint']) {
    const input = action === 'reopen' ? f.input : f.checkpointInput;
    const prepare = () => action === 'reopen' ? bound.port.prepare(f.instance, input)
      : bound.checkpoint.prepare(f.instance, input, fixtureOp(6));
    const apply = (p, options) => (action === 'reopen' ? bound.port : bound.checkpoint).apply(f.instance, p, options);
    const explicitCode = action === 'reopen' ? 'STANDARD_PR_CORRECTION_EXPLICIT_WRITE_REQUIRED' : 'STANDARD_PR_CORRECTION_CHECKPOINT_EXPLICIT_EFFECT_REQUIRED';
    for (const [name, fault, expected] of [
      ['expired valid plan', o => o, 'STANDARD_PLAN_EXPIRED'],
      ['missing write', o => ({ ...o, write: false }), explicitCode],
      ['nonboolean write', o => ({ ...o, write: 'true' }), explicitCode],
      ['wrong expected digest', o => ({ ...o, expectPlan: 'a'.repeat(64) }), explicitCode],
      ['missing authorization callback', o => ({ ...o, assertAuthorized: undefined }), explicitCode],
    ]) {
      // Prepare each immutable original in the past using an injected adapter
      // clock, then observe real present time. Never edit a plan timestamp,
      // authorization deadline or allocation counter.
      clock = Date.now() - 300001; const prepared = await prepare(); assert.equal(prepared.can_apply, true);
      save(f, action + '-' + name.replaceAll(' ', '-'), { prepared, proof: 'direct-application-before-owner', native: 'NOT_RUN' });
      const before = bytes(f.root), remoteBefore = bytes(f.remoteRoot), original = structuredClone(prepared); let authorizations = 0;
      clock = Date.now();
      await assert.rejects(apply(prepared, fault({ write: true, expectPlan: prepared.plan_sha256, assertAuthorized() { authorizations++; } })),
        error => error.code === expected && error.effect_status === 'no_effect');
      assert.equal(authorizations, 0); assert.equal(f.artifacts.ownerPending(), false);
      assert.deepEqual(prepared, original); assert.deepEqual(bytes(f.root), before); assert.deepEqual(bytes(f.remoteRoot), remoteBefore);
      pass(action + ' ' + name + ' refuses before owner/callback and preserves every physical file/directory');
    }
    const current = cold(f, action, input); assert.equal(current.can_apply, true);
    assert.ok(Date.now() - current.plan.prepared_at_ms < 300000);
    assert.deepEqual(current.plan.input, input); pass(action + ' cold fresh preparation preserves the same subject');
    if (action === 'reopen') {
      clock = Date.now(); const duringProvider = await prepare(), before = bytes(f.root), remoteBefore = bytes(f.remoteRoot);
      bound.state.beforeReview = () => { if (!bound.state.readingSource) clock = duringProvider.plan.prepared_at_ms + 300001; };
      const expired = await apply(duringProvider, { write: true, expectPlan: duringProvider.plan_sha256, assertAuthorized() {} });
      assert.equal(expired.outcome, 'blocked'); assert.equal(expired.effect_status, 'no_effect');
      assert.equal(expired.observations.reason_code, 'STANDARD_PLAN_EXPIRED'); assert.equal(f.artifacts.ownerPending(), false);
      assert.deepEqual(bytes(f.root), before); assert.deepEqual(bytes(f.remoteRoot), remoteBefore);
      save(f, 'expired-during-provider', { prepared: duringProvider, output: expired });
      pass('reopen expires during provider observation before first CAS and releases its owner without business writes');
      bound.state.beforeReview = null; clock = Date.now(); const fresh = await prepare();
      const output = await apply(fresh, { write: true, expectPlan: fresh.plan_sha256, assertAuthorized() {} });
      assert.equal(output.outcome, 'completed'); assert.equal(output.effect_status, 'confirmed');
      f.checkpointInput = acceptFixtureReopen(f, fresh, output);
      save(f, 'accepted-reopen', { prepared: fresh, output, fixture: f.saved });
    }
  }
  console.log(JSON.stringify({ status: 'PASS', checks, mode, roots: owned,
    proof: 'real-application-pre-owner-expiry-guards-and-cold-same-subject-preparation',
    canonical: mode === 'files' ? 'files' : 'SQLite', source: 'authenticated-synthetic-key127', provider: 'fixture',
    dispatcher_reprepare: 'NOT_RUN', accepted_expired_receipt: 'NOT_RUN', fresh_grant: 'NOT_RUN',
    model_calls: 0, native: 'NOT_RUN', genuine_human: 'NOT_RUN', postgres: 'NOT_RUN', installed_archive: 'NOT_RUN',
    full_standard_workflow: false }));
} finally {
  // Retention is deliberate for every terminal outcome, including FAIL.
  console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned }));
}
