import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initGitRepo, removePathWithRetry } from './test-git-fixture-lib.mjs';
import { prepareActivationFixture } from './test-activation-fixture-lib.mjs';
import { runStartSessionAdmitUseCase } from '../../src/application/runtime/start-session-admit-use-case.mjs';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const current = active => `# Current State\nmode: THINKING\nbranch_kind: source\nactive_session: ${active}\nactive_cycle: none\n`;
const session = (pr = 'merged', sync = 'done') => `# Session S101\nstate: CLOSED\nmode: COMMITTING\nsession_branch: S101-example\nbranch_kind: session\nparent_session: none\nintegration_target_cycles:\n- C101\n- C102\nprimary_focus_cycle: none\nattached_cycles:\n- C101\n- C102\npr_status: ${pr}\npost_merge_sync_status: ${sync}\n## WORK MODE\n[x] COMMITTING\n### Session close gate satisfied?\n- [x] Yes\n`;
const artifact = (name, content, id) => ({ path: name, content, content_format: 'utf8', sha256: sha(content), artifact_id: id });
function snapshot(pr, sync) {
  const artifacts = [artifact('CURRENT-STATE.md', current('none'), 1), artifact('sessions/S101.md', session(pr, sync), 2),
    artifact('cycles/C101-example/status.md', 'state: DONE\nbranch_name: feature/C101-example\nsession_owner: S101\nusage_matrix_scope: shared\nusage_matrix_state: VERIFIED\n', 3)];
  return { exists: true, payload: { artifacts,
    sessions: [{ session_id: 'S101', state: 'COMMITTING', branch_name: 'S101-example', branch_kind: 'session', integration_target_cycle: 'C101' }],
    cycles: [{ cycle_id: 'C101', session_id: 'S101', state: 'DONE', branch_name: 'feature/C101-example' }],
  }, runtimeHeads: { current_state: { head_key: 'current_state', artifact_path: 'CURRENT-STATE.md', artifact_id: 1, artifact_sha256: artifacts[0].sha256 } } };
}
function inventory(root) {
  const entries = [];
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file); else entries.push([path.relative(root, file), sha(fs.readFileSync(file))]);
  } }
  walk(root); return entries.sort(([a], [b]) => a.localeCompare(b));
}
export async function verifyCanonicalStartSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-start-canonical-'));
  const runs = [];
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const config = (mode, backend) => write('.aidn/config.json', JSON.stringify({ version: 1, workflow: { sourceBranch: 'main' }, runtime: { stateMode: mode, persistence: { backend, connectionRef: 'env:AIDN_TEST_UNAVAILABLE' } } }));
  const run = async (id, callback) => { try { await callback(); runs.push({ id, pass: true }); } catch (error) { error.message = `${id}: ${error.message}`; throw error; } };
  try {
    config('files', 'sqlite');
    write('docs/audit/CURRENT-STATE.md', current('S101'));
    write('docs/audit/sessions/S101.md', session('open', 'required'));
    write('docs/audit/sessions/S999-stale.md', session('open', 'required').replaceAll('S101', 'S999'));
    write('docs/audit/cycles/C999-stale/status.md', 'state: OPEN\nbranch_name: feature/C999-stale\nsession_owner: S999\n');
    initGitRepo(root, { sourceBranch: 'main' });
    for (const mode of ['db-only', 'dual', 'files']) {
      for (const [variant, pr, sync, expected] of [
        ['closed', 'merged', 'done', 'create_session_allowed'],
        ['pr_open', 'open', 'required', 'resume_current_session'],
        ['sync_required', 'merged', 'required', 'blocked_session_base_gate'],
        ['pr_unknown', 'unknown', 'done', 'blocked_session_base_gate'],
      ]) await run(`canonical_${mode}_${variant}`, async () => {
        config(mode, 'postgres'); const before = inventory(root); const data = snapshot(pr, sync); let reads = 0;
        const result = await runStartSessionAdmitUseCase({ targetRoot: root, mode: 'THINKING', runtimeSnapshotReaderFactory: () => ({
          describeBackend: () => ({ backend_kind: 'postgres' }), readCanonicalSnapshot: async () => { reads++; return data; },
        }) });
        assert.equal(result.action, expected); assert.equal(result.active_session, 'none'); assert.equal(result.active_cycle, 'none');
        assert.equal(result.open_cycles.length, 0); assert.equal(reads, 1); assert.deepEqual(inventory(root), before);
        if (pr === 'open') assert.deepEqual(result.mapped_session.integration_target_cycles, ['C101', 'C102']);
      });
    }
    for (const mode of ['db-only', 'dual', 'files']) await run(`canonical_${mode}_unavailable_refuses_local`, async () => {
      config(mode, 'postgres'); const before = inventory(root);
      const result = await runStartSessionAdmitUseCase({ targetRoot: root, runtimeSnapshotReaderFactory: () => ({
        describeBackend: () => ({ backend_kind: 'postgres' }), readCanonicalSnapshot: async () => ({ exists: false, payload: null }),
      }) });
      assert.equal(result.result, 'stop'); assert.equal(result.reason_code, 'START_SESSION_CANONICAL_RUNTIME_INVALID');
      assert.deepEqual(inventory(root), before);
    });
    for (const [name, alter, code] of [
      ['invalid_head', data => { data.runtimeHeads.current_state.artifact_sha256 = 'invalid'; }, /RUNTIME_HEAD_ARTIFACT_IDENTITY_MISMATCH/],
      ['duplicate_session', data => { data.payload.artifacts.push(artifact('sessions/S101-duplicate.md', session(), 4)); }, /RUNTIME_CONTINUITY_ARTIFACT_AMBIGUOUS/],
      ['missing_head_artifact', data => { data.payload.artifacts.shift(); }, /RUNTIME_HEAD_ARTIFACT_MISSING_OR_AMBIGUOUS/],
      ['wrong_session_identity', data => { data.payload.artifacts[1].session_id = 'S999'; }, /RUNTIME_CONTINUITY_ARTIFACT_IDENTITY_MISMATCH/],
      ['wrong_session_source', data => { data.payload.sessions[0].source_artifact_path = 'sessions/S101-other.md'; }, /RUNTIME_CONTINUITY_ARTIFACT_IDENTITY_MISMATCH/],
      ['wrong_session_branch', data => { data.payload.sessions[0].branch_name = 'S101-other'; }, /RUNTIME_CONTINUITY_ARTIFACT_IDENTITY_MISMATCH/],
    ]) await run(name, async () => {
      config('db-only', 'postgres'); const data = snapshot(); alter(data); const before = inventory(root);
      await assert.rejects(runStartSessionAdmitUseCase({ targetRoot: root, runtimeSnapshotReaderFactory: () => ({
        describeBackend: () => ({ backend_kind: 'postgres' }), readCanonicalSnapshot: async () => data,
      }) }), code); assert.deepEqual(inventory(root), before);
    });
    await run('files_keeps_checkout_authority', async () => {
      config('files', 'sqlite'); const before = inventory(root);
      const result = await runStartSessionAdmitUseCase({ targetRoot: root, runtimeSnapshotReaderFactory: () => { throw Error('must not load DB'); } });
      assert.notEqual(result.action, 'create_session_allowed'); assert.equal(result.active_session, 'S101'); assert.deepEqual(inventory(root), before);
    });
    for (const mode of ['db-only', 'dual']) await run(`sqlite_${mode}_canonical_precedence`, async () => {
      config(mode, 'sqlite'); const store = createArtifactStore({ sqliteFile: path.join(root, '.aidn/runtime/index/workflow-index.sqlite') });
      try { for (const row of snapshot().payload.artifacts) store.upsertArtifact({ ...row, kind: row.path.startsWith('sessions/') ? 'session' : 'other', family: 'normative' }); } finally { store.close(); }
      const before = inventory(root); const result = await runStartSessionAdmitUseCase({ targetRoot: root, mode: 'THINKING' });
      assert.equal(result.action, 'create_session_allowed'); assert.equal(result.active_session, 'none'); assert.deepEqual(inventory(root), before);
    });
    prepareActivationFixture(root);
    for (const mode of ['db-only', 'dual']) await run(`sqlite_${mode}_wrapper_preserves_canonical_store`, async () => {
      config(mode, 'sqlite');
      const indexPath = path.join(root, '.aidn/runtime/index/workflow-index.sqlite');
      const beforeDb = sha(fs.readFileSync(indexPath));
      const beforeDocs = inventory(path.join(root, 'docs'));
      const execution = spawnSync(process.execPath, [path.resolve('tools/codex/run-json-hook.mjs'),
        '--skill', 'start-session', '--target', root, '--mode', 'THINKING', '--strict', '--json'],
      { encoding: 'utf8', windowsHide: true, timeout: 60000,
        env: { ...process.env, AIDN_STATE_MODE: mode, AIDN_INDEX_STORE_MODE: '' } });
      assert.equal(execution.error, undefined, execution.error?.message);
      const result = JSON.parse(execution.stdout);
      assert.equal(result.action, 'create_session_allowed', execution.stderr);
      assert.equal(result.db_sync.enabled, false, 'admission must not auto-import Markdown');
      assert.equal(sha(fs.readFileSync(indexPath)), beforeDb, 'hook changed canonical database');
      assert.deepEqual(inventory(path.join(root, 'docs')), beforeDocs, 'hook changed visible projections');
    });
    return runs;
  } finally { const cleanup = removePathWithRetry(root); assert(cleanup.ok && !fs.existsSync(root), 'canonical fixture cleanup'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const result of await verifyCanonicalStartSession()) console.log(`PASS ${result.id}`);
}
