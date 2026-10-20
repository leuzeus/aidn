import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { admitHandoff } from '../runtime/handoff-admit.mjs';
import { loadSharedStateSnapshot } from '../../src/application/runtime/shared-state-backend-service.mjs';
import { createRuntimeArtifactStore } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { createRuntimePersistenceFakePgClientFactory } from './runtime-persistence-fake-pg-lib.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function inventory(root) {
  const rows = [];
  function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file); else rows.push([path.relative(root, file), sha(fs.readFileSync(file))]);
  } }
  walk(root); return rows.sort(([a], [b]) => a.localeCompare(b));
}
export async function verifyCanonicalHandoffAdmission() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-handoff-canonical-'));
  const runs = [];
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const configure = (mode, backend = 'postgres') => write('.aidn/config.json', JSON.stringify({ version: 1,
    runtime: { stateMode: mode, persistence: { backend, connectionRef: 'env:AIDN_HANDOFF_FIXTURE_PG' } } }));
  const command = (script, args) => {
    const run = spawnSync(process.execPath, [script, '--target', root, ...args], { encoding: 'utf8', windowsHide: true,
      env: { ...process.env, AIDN_STATE_MODE: 'files', AIDN_RUNTIME_PERSISTENCE_BACKEND: '' }, timeout: 60000 });
    assert.equal(run.status, 0, run.stderr || run.stdout); return JSON.parse(run.stdout);
  };
  const check = async (id, fn) => { await fn(); runs.push({ id, pass: true }); };
  try {
    fs.cpSync(path.resolve('tests/fixtures/perf-handoff/ready'), root, { recursive: true });
    command('tools/runtime/project-handoff-packet.mjs', ['--write', '--json']);
    const packetFile = path.join(root, 'docs/audit/HANDOFF-PACKET.md');
    fs.writeFileSync(packetFile, fs.readFileSync(packetFile, 'utf8').replace('runtime_state_mode: files', 'runtime_state_mode: db-only'));
    command('tools/perf/index-sync.mjs', ['--store', 'sqlite', '--with-content', '--json']);
    const payload = loadSharedStateSnapshot({ targetRoot: root }).payload;
    for (const name of ['CURRENT-STATE.md', 'HANDOFF-PACKET.md']) assert(payload.artifacts.some(a => a.path === name), JSON.stringify(payload.artifacts.map(a => a.path)));
    const fake = createRuntimePersistenceFakePgClientFactory();
    const options = { connectionString: 'postgres://fixture/handoff', clientFactory: fake.factory };
    const store = createRuntimeArtifactStore({ targetRoot: root, backend: 'postgres', ...options });
    await store.writeIndexProjection({ payload });
    const admit = () => admitHandoff({ targetRoot: root, sharedStateOptions: options });
    const original = inventory(path.join(root, 'docs'));
    // All three visible heads and the dependent cycle projection deliberately disagree.
    for (const name of ['CURRENT-STATE.md', 'RUNTIME-STATE.md', 'HANDOFF-PACKET.md'])
      write(`docs/audit/${name}`, '# Bootstrap\nmode: unknown\nactive_cycle: C999\n');
    write('docs/audit/cycles/C101-feature-alpha/status.md', 'state: UNKNOWN\nlast_updated: 2099-01-01T00:00:00Z\n');
    const stale = inventory(path.join(root, 'docs'));
    for (const mode of ['db-only', 'dual', 'files']) await check(`postgres_${mode}_ignores_stale_visible_projections`, async () => {
      const data = structuredClone(payload);
      for (const row of data.artifacts.filter(a => ['HANDOFF-PACKET.md', 'RUNTIME-STATE.md'].includes(a.path))) {
        row.content = row.content.replace(/runtime_state_mode: \S+/, `runtime_state_mode: ${mode}`); row.sha256 = sha(row.content);
      }
      await store.writeIndexProjection({ payload: data });
      configure(mode); const before = inventory(root); const result = await admit();
      assert.equal(result.admitted, true, JSON.stringify(result.issues));
      for (const key of ['packet_source', 'current_state_source', 'runtime_state_source']) assert.equal(result[key], 'postgres');
      assert.equal(result.consistency.source, 'postgres');
      assert.deepEqual(inventory(root), before);
    });
    configure('db-only'); await store.writeIndexProjection({ payload });
    await check('invalid_canonical_head_refuses_visible_bootstrap', async () => {
      const head = [...fake.state.runtimeHeads.values()].find(row => row.head_key === 'current_state');
      assert(head); const originalPayload = head.payload_json;
      head.payload_json = { head_key: 'current_state', artifact_path: 'CURRENT-STATE.md', artifact_sha256: 'invalid' };
      const before = inventory(root);
      await assert.rejects(admit(), /RUNTIME_HEAD_ARTIFACT_IDENTITY_MISMATCH/);
      assert.deepEqual(inventory(root), before); head.payload_json = originalPayload;
    });
    await check('postgres_unavailable_never_reads_valid_sqlite_or_visible_files', async () => {
      configure('db-only'); const before = inventory(root);
      await assert.rejects(admitHandoff({ targetRoot: root, sharedStateOptions: { ...options,
        clientFactory: () => { throw Error('fixture PostgreSQL unavailable'); } } }), /canonical runtime backend is unavailable/);
      assert.deepEqual(inventory(root), before);
    });
    // Ambiguity must fail even though a bootstrap file exists at the default path.
    for (const [id, mutate] of [
      ['duplicate_current_state', data => { data.artifacts.push({ ...data.artifacts.find(a => a.path === 'CURRENT-STATE.md'), path: 'docs/audit/CURRENT-STATE.md' }); }],
      ['duplicate_cycle_status', data => { data.artifacts.push({ ...data.artifacts.find(a => /cycles\/C101.*\/status.md$/.test(a.path)), path: 'cycles/C101-other/status.md' }); }],
      ['missing_current_state', data => { data.artifacts = data.artifacts.filter(a => a.path !== 'CURRENT-STATE.md'); }],
    ]) await check(id, async () => {
      const changed = structuredClone(payload); mutate(changed); await store.writeIndexProjection({ payload: changed });
      if (id === 'duplicate_current_state') fake.state.runtimeHeads.clear();
      const before = inventory(root); await assert.rejects(admit(), /AMBIGUOUS|Missing file|canonical runtime/, id);
      assert.deepEqual(inventory(root), before);
    });
    await store.writeIndexProjection({ payload });
    await check('canonical_cycle_freshness_still_blocks', async () => {
      const changed = structuredClone(payload); const cycle = changed.artifacts.find(a => /cycles\/C101.*\/status.md$/.test(a.path));
      cycle.content += '\nlast_updated: 2099-01-01T00:00:00Z\n'; cycle.sha256 = sha(cycle.content);
      await store.writeIndexProjection({ payload: changed }); const before = inventory(root);
      const result = await admit(); assert.equal(result.admitted, false);
      assert(result.issues.includes('live current-state consistency failed'));
      assert.deepEqual(inventory(root), before);
    });
    await store.writeIndexProjection({ payload });
    await check('canonical_required_artifact_cannot_be_satisfied_by_stale_projection', async () => {
      const changed = structuredClone(payload);
      const packet = changed.artifacts.find(a => a.path === 'HANDOFF-PACKET.md');
      packet.content = packet.content.replace('prioritized_artifacts:', 'prioritized_artifacts:\n- docs/audit/only-visible.md'); packet.sha256 = sha(packet.content);
      write('docs/audit/only-visible.md', 'stale visible evidence'); await store.writeIndexProjection({ payload: changed });
      const before = inventory(root); const result = await admit();
      assert.equal(result.admitted, false); assert(result.issues.some(x => x.includes('only-visible.md')));
      assert.deepEqual(inventory(root), before);
      fs.unlinkSync(path.join(root, 'docs/audit/only-visible.md'));
    });
    for (const mode of ['db-only', 'dual']) await check(`sqlite_${mode}_canonical_fallback_remains_available`, async () => {
      configure(mode, 'sqlite');
      if (mode === 'dual') {
        // Dual retains visible-file precedence. Its stale projection must still reject.
        const result = await admitHandoff({ targetRoot: root }); assert.equal(result.admitted, false);
        assert.equal(result.current_state_source, 'file');
      } else {
        const result = await admitHandoff({ targetRoot: root }); assert.equal(result.admitted, true);
        assert.equal(result.current_state_source, 'sqlite');
      }
      assert.deepEqual(inventory(path.join(root, 'docs')), stale);
    });
    await check('files_mode_preserves_visible_authority_without_database', async () => {
      configure('files', 'sqlite'); const before = inventory(root);
      const result = await admitHandoff({ targetRoot: root }); assert.equal(result.admitted, false);
      assert.equal(result.current_state_source, 'file'); assert.deepEqual(inventory(root), before);
    });
    assert.notDeepEqual(original, stale);
    return runs;
  } finally { const cleanup = removePathWithRetry(root); assert(cleanup.ok && !fs.existsSync(root), 'canonical handoff fixture cleanup'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const run of await verifyCanonicalHandoffAdmission()) console.log(`PASS ${run.id}`);
}
