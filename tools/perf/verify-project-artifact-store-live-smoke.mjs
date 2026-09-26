#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPostgresRuntimeArtifactStore } from '../../src/adapters/runtime/postgres-runtime-artifact-store.mjs';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { runDbFirstArtifactUseCase } from '../../src/application/runtime/db-first-artifact-use-case.mjs';
import { prepareActivationFixture } from './test-activation-fixture-lib.mjs';

const connectionString = process.env.AIDN_RUNTIME_PG_SMOKE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!connectionString) { console.log('UNAVAILABLE: AIDN_RUNTIME_PG_SMOKE_URL is required'); process.exitCode = 1; }
else {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-artifact-command-'));
  const scopes = [];
  const tables = ['runtime_heads', 'artifact_blobs', 'migration_findings', 'migration_runs', 'repair_decisions',
    'session_links', 'session_cycle_links', 'cycle_links', 'artifact_links', 'run_metrics', 'artifact_tags',
    'tags', 'file_map', 'artifacts', 'sessions', 'cycles', 'index_meta', 'runtime_scope_registry'];
  const snapshot = async scope => {
    const result = {};
    for (const table of tables) result[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM aidn_runtime.${table} t WHERE scope_key=$1 ORDER BY to_jsonb(t)::text`, [scope])).rows;
    return result;
  };
  try {
    await client.connect();
    const projects = [];
    for (const name of ['projet été', 'other']) {
      const targetRoot = path.join(root, name); fs.mkdirSync(path.join(targetRoot, '.aidn'), { recursive: true });
      execFileSync('git', ['init', '--initial-branch=dev', targetRoot], { stdio: 'pipe', windowsHide: true });
      execFileSync('git', ['-C', targetRoot, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'], { stdio: 'pipe', windowsHide: true });
      fs.writeFileSync(path.join(targetRoot, '.aidn/config.json'), JSON.stringify({ runtime: { stateMode: 'db-only',
        persistence: { backend: 'postgres', connectionRef: 'env:AIDN_RUNTIME_PG_SMOKE_URL', localProjectionPolicy: 'none' } } }));
      const context = resolveRuntimeProjectContext({ targetRoot }); scopes.push(context.runtime_scope_id);
      const store = createPostgresRuntimeArtifactStore({ targetRoot, connectionString });
      await store.writeIndexProjection({ payload: { schema_version: 1, target_root: targetRoot, audit_root: 'docs/audit',
        structure_profile: { kind: 'modern', recommended_required_artifacts: ['notes/preserved.md'], notes: [] },
        artifacts: [{ path: 'notes/preserved.md', kind: 'note', content_format: 'utf8', content: 'preserve me', sha256: 'baseline', mtime_ns: '1', updated_at: '2026-01-01T00:00:00Z' }], cycles: [], sessions: [] } });
      projects.push({ targetRoot, store });
    }
    const before = await snapshot(scopes[0]); const other = await snapshot(scopes[1]);
    const { targetRoot, store } = projects[0];
    const upsert = (artifact) => store.executeArtifactCommand('upsert', { artifact });
    await Promise.all([upsert({ path: 'notes/one.md', content: 'one' }), upsert({ path: 'notes/two.md', content: 'two' })]);
    const result = runDbFirstArtifactUseCase({ target: targetRoot, path: 'sessions/S001-test.md', kind: 'session',
      content: '## WORK MODE - THINKING\nsession_branch: codex/test\n', materialize: 'false' });
    assert.equal(result.ok, true); assert.equal(result.materialized, false);
    const facade = createProjectArtifactStore({ targetRoot, readOnly: true });
    assert.match(facade.getArtifact('sessions/S001-test.md').content, /THINKING/);
    assert.throws(() => facade.upsertArtifact({ path: 'notes/refused.md' }), /read-only/);
    const ids = (await client.query('SELECT artifact_id FROM aidn_runtime.artifacts WHERE scope_key=$1', [scopes[0]])).rows.map(r => r.artifact_id);
    assert.equal(new Set(ids).size, ids.length);
    const canonical = await store.loadSnapshot();
    assert.equal(canonical.payload.sessions.find(r => r.session_id === 'S001').state, 'THINKING');
    const beforeFailure = await snapshot(scopes[0]);
    await assert.rejects(upsert({ path: 'cycles/C001-test/status.md', content: 'state: OPEN', mtime_ns: 'not-an-integer' }));
    assert.deepEqual(await snapshot(scopes[0]), beforeFailure);
    await assert.rejects(upsert({ path: 'docs/audit/RUNTIME-STATE.md', content: 'duplicate' }), /ARTIFACT_PATH/);
    const after = await snapshot(scopes[0]);
    assert.deepEqual(after.artifacts.filter(r => r.row.path === 'notes/preserved.md'), before.artifacts);
    for (const table of tables.filter(t => !['artifacts', 'artifact_blobs', 'sessions'].includes(t))) assert.deepEqual(after[table], before[table], table);
    assert.deepEqual(await snapshot(scopes[1]), other);
    assert.equal(fs.existsSync(path.join(targetRoot, '.aidn/runtime/index/workflow-index.sqlite')), false);
    await upsert({ path: 'CURRENT-STATE.md', content: 'mode: THINKING' });
    const beforeLateFailure = await snapshot(scopes[0]);
    await assert.rejects(upsert({ path: 'notes/CURRENT-STATE.md', content: 'must roll back artifact and blob' }), /ARTIFACT_HEAD_PATH_CONFLICT/);
    assert.deepEqual(await snapshot(scopes[0]), beforeLateFailure);
    const beforeRead = await snapshot(scopes[0]);
    const projection = facade.materializeArtifacts({ onlyPaths: ['sessions/S001-test.md'], dryRun: true });
    assert.equal(projection.exported, 1); assert(!fs.existsSync(path.join(targetRoot, 'docs/audit')));
    assert.deepEqual(await snapshot(scopes[0]), beforeRead);
    const bootstrap = spawnSync(process.execPath, [path.join(repoRoot, 'bin/aidn.mjs'), 'bootstrap', '--target', targetRoot,
      '--profile', 'db-only', '--persistence-policy', 'verify-only', '--no-codex-migrate-custom', '--source-branch', 'dev', '--json'],
    { encoding: 'utf8', timeout: 60000, windowsHide: true });
    const bootstrapResult = JSON.parse(bootstrap.stdout);
    assert.equal(bootstrapResult.ok, true, JSON.stringify(bootstrapResult.errors));
    assert.deepEqual(await snapshot(scopes[0]), beforeRead, 'verify-only bootstrap changed canonical data');
    console.log('PASS live PostgreSQL: actual source bootstrap verify-only preserves all rows');
    const cli = (...args) => {
      const child = spawnSync(process.execPath, [path.join(repoRoot, 'bin/aidn.mjs'), 'runtime', ...args, '--target', targetRoot, '--json'],
        { encoding: 'utf8', timeout: 60000, windowsHide: true });
      assert.equal(child.status, 0, child.stderr.slice(-800));
      return JSON.parse(child.stdout);
    };
    const written = cli('db-first-artifact', '--path', 'cycles/C001-test/status.md', '--kind', 'cycle',
      '--content', 'state: OPEN\nsession_owner: S001\nbranch_name: cycle/C001-test\ndor_state: READY\n', '--no-materialize');
    assert.equal(written.backend, 'postgres'); assert.equal(written.materialized, false);
    const read = cli('artifact-store', 'get', '--path', 'cycles/C001-test/status.md');
    assert.equal(read.backend, 'postgres'); assert.equal(read.sqlite_file, '');
    assert.equal(read.artifact.cycle_id, 'C001');
    const beforeCheckpoint = await snapshot(scopes[0]);
    const listed = cli('artifact-store', 'list', '--limit', '20');
    assert(listed.artifacts.some(row => row.path === 'cycles/C001-test/status.md'));
    const checkpoint = spawnSync(process.execPath, [path.join(repoRoot, 'tools/perf/checkpoint.mjs'), '--target', targetRoot,
      '--mode', 'THINKING', '--skip-gate-evaluate', '--json'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.equal(checkpoint.status, 0, 'checkpoint failed: ' + checkpoint.stderr.slice(-800));
    const checkpointResult = JSON.parse(checkpoint.stdout);
    assert.equal(checkpointResult.index.skip_reason, 'postgres_canonical_backend');
    assert.deepEqual(await snapshot(scopes[0]), beforeCheckpoint, 'checkpoint changed canonical data');
    console.log('PASS live PostgreSQL: actual checkpoint skips canonical reimport and preserves all rows');
    execFileSync('git', ['-C', targetRoot, 'checkout', '-b', 'S001-initial'], { stdio: 'pipe', windowsHide: true });
    prepareActivationFixture(targetRoot, repoRoot);
    const initialCurrent = 'mode: THINKING\nactive_session: S001\nactive_cycle: none\ncycle_branch: none\nbranch_kind: session\nsession_branch: S001-initial\nupdated_at: 2026-09-25\n';
    await upsert({ path: 'CURRENT-STATE.md', content: initialCurrent });
    await upsert({ path: 'sessions/S001-test.md', content: '## WORK MODE - THINKING\nsession_branch: S001-initial\ncycle_branch: none\nprimary_focus_cycle: none\n' });
    await upsert({ path: 'RUNTIME-STATE.md', content: 'runtime_state_mode: db-only\nrepair_layer_status: clean\nrepair_routing_hint: continue\ncurrent_state_freshness: unknown\n' });
    fs.mkdirSync(path.join(targetRoot, 'docs/audit/sessions'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'docs/audit/CURRENT-STATE.md'), 'mode: unknown\nactive_cycle: C999\nupdated_at: invalid\n');
    fs.writeFileSync(path.join(targetRoot, 'docs/audit/sessions/S001-test.md'), 'session_branch: wrong\nsession_objective: verify canonical workflow preservation\n');
    fs.appendFileSync(path.join(targetRoot, '.git/info/exclude'), '\n/.aidn/runtime/\n');
    execFileSync('git', ['-C', targetRoot, 'add', '.'], { stdio: 'pipe', windowsHide: true });
    execFileSync('git', ['-C', targetRoot, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'initial session'], { stdio: 'pipe', windowsHide: true });
    const initialSnapshot = await snapshot(scopes[0]);
    const admitted = cli('pre-write-admit', '--skill', 'cycle-create', '--strict');
    assert.equal(admitted.ok, true); assert.equal(admitted.context.current_state_source, 'postgres');
    assert.equal(admitted.context.current_state_freshness, 'unknown');
    assert.equal(admitted.checks.cycle_create_initial_state_verified.pass, true);
    assert.equal(admitted.context.repair_layer_status, 'clean');
    const projected = cli('project-runtime-state');
    assert.equal(projected.digest.repair_layer_status, 'clean', 'fresh canonical empty findings must establish clean without cached hooks');
    assert.equal(projected.digest.current_state_source, 'postgres');
    assert.equal(projected.digest.session_artifact_source, 'postgres');
    assert.equal(projected.consistency.source, 'postgres');
    assert.equal(projected.written, false);
    const cacheFile = path.join(targetRoot, '.aidn/runtime/context/hydrated-context.json');
    const savedCache = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile) : null;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ ts: '2099-01-01', repair_layer: { status: 'block', blocking: true } }));
      assert.equal(cli('project-runtime-state').digest.repair_layer_status, 'clean', 'stale cache must not override live empty findings');
      fs.writeFileSync(cacheFile, JSON.stringify({ ts: '2099-01-01', repair_layer: { status: 'clean', top_findings: [] } }));
      for (const [severity, expected] of [['warning', 'warn'], ['error', 'block']]) {
        await client.query(`INSERT INTO aidn_runtime.migration_findings
          (scope_key,finding_id,migration_run_id,severity,finding_type,message,created_at)
          VALUES ($1,-9001,'projection-probe',$2,'PROJECTION_PROBE','Canonical finding must win',now())`, [scopes[0], severity]);
        const withFinding = await snapshot(scopes[0]);
        const observed = cli('project-runtime-state');
        assert.equal(observed.digest.repair_layer_status, expected, 'cached success must not hide canonical findings');
        assert(observed.digest.blocking_findings.some(item => item.includes('PROJECTION_PROBE')));
        assert.deepEqual(await snapshot(scopes[0]), withFinding, 'projection modified canonical findings');
        await client.query('DELETE FROM aidn_runtime.migration_findings WHERE scope_key=$1 AND finding_id=-9001', [scopes[0]]);
      }
    } finally {
      await client.query('DELETE FROM aidn_runtime.migration_findings WHERE scope_key=$1 AND finding_id=-9001', [scopes[0]]);
      if (savedCache) fs.writeFileSync(cacheFile, savedCache); else fs.rmSync(cacheFile);
    }
    console.log('PASS live PostgreSQL: runtime repair projection reads current clean/warn/block findings, ignores misleading caches, preserves all rows');
    assert.deepEqual(await snapshot(scopes[0]), initialSnapshot, 'initial admission/projection changed canonical data');
    assert.deepEqual(await snapshot(scopes[1]), other, 'initial admission affected another scope');
    const runScript = (script, args = []) => spawnSync(process.execPath,
      [path.join(repoRoot, script), '--target', targetRoot, ...args, '--json'],
      { encoding: 'utf8', timeout: 60000, windowsHide: true });
    const reload = runScript('tools/perf/reload-check.mjs');
    assert.equal(reload.status, 0, 'reload: ' + reload.stderr.slice(-800));
    assert.equal(JSON.parse(reload.stdout).index_backend, 'postgres');
    const eventsPath = path.join(targetRoot, '.aidn/runtime/perf/workflow-events.ndjson');
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    const normalEvents = ['MISSING_CACHE', 'HEAD_CHANGED', 'BRANCH_CHANGED', 'HEAD_CHANGED'].map(reason =>
      JSON.stringify({ ts: new Date().toISOString(), branch: 'S001-initial', skill: 'reload-check', result: 'fallback', reason_code: reason })).join('\n') + '\n';
    fs.writeFileSync(eventsPath, normalEvents);
    const normalHook = runScript('tools/perf/branch-cycle-audit-hook.mjs', ['--mode', 'THINKING', '--no-emit-event']);
    const normal = JSON.parse(normalHook.stdout);
    assert.equal(normalHook.status, 0, 'normal branch hook: ' + JSON.stringify({ admission: normal.admission?.reason_code, gating: normal.gating?.levels }));
    assert.equal(normal.admission.ok, true);
    assert.notEqual(normal.result, 'stop', JSON.stringify(normal.gating));
    assert.equal(normal.gating.levels.level3.fallback_recent_count, 0);
    assert.equal(normal.result, normal.gating.result);
    assert.equal(fs.readFileSync(eventsPath, 'utf8'), normalEvents);
    const beforeDrift = JSON.parse(runScript('tools/perf/branch-cycle-audit-hook.mjs', ['--mode', 'COMMITTING', '--no-emit-event']).stdout);
    assert.deepEqual(beforeDrift.levels.level2.active_signals, ['time_since_last_drift_check']);
    const driftRun = runScript('tools/codex/run-json-hook.mjs', ['--skill', 'drift-check', '--mode', 'COMMITTING', '--strict']);
    assert.equal(driftRun.status, 0, 'real drift skill must complete: ' + driftRun.stderr.slice(-500));
    assert.equal(JSON.parse(driftRun.stdout).ok, true);
    const afterDrift = JSON.parse(runScript('tools/perf/branch-cycle-audit-hook.mjs', ['--mode', 'COMMITTING', '--no-emit-event']).stdout);
    assert.equal(afterDrift.result, 'ok');
    const reviewedEvents = fs.readFileSync(eventsPath, 'utf8');
    assert(reviewedEvents.startsWith(normalEvents), 'drift check must preserve existing history');
    assert.equal(reviewedEvents.trim().split('\n').map(JSON.parse).filter(row => row.event === 'drift_check_completed').length, 1);
    assert.deepEqual(await snapshot(scopes[0]), initialSnapshot, 'drift completion changed canonical data');
    console.log('PASS live PostgreSQL: required drift -> real skill completion -> branch admission; existing journal and canonical rows preserved');
    const anomalies = Array.from({ length: 3 }, () => JSON.stringify({ ts: new Date().toISOString(),
      branch: 'S001-initial', skill: 'reload-check', result: 'fallback', reason_codes: ['HEAD_CHANGED', 'CORRUPT_CACHE'] })).join('\n') + '\n';
    fs.appendFileSync(eventsPath, anomalies);
    const stoppedHook = runScript('tools/perf/branch-cycle-audit-hook.mjs', ['--mode', 'THINKING', '--no-emit-event']);
    const stopped = JSON.parse(stoppedHook.stdout);
    assert.equal(stoppedHook.status, 1);
    assert.equal(stopped.ok, false);
    assert.equal(stopped.result, 'stop');
    assert.equal(stopped.reason_code, 'L3_REPEATED_FALLBACK');
    assert.equal(stopped.summary.result, 'stop');
    assert.equal(stopped.gating.result, 'stop');
    assert.equal(fs.readFileSync(eventsPath, 'utf8'), reviewedEvents + anomalies);
    const wrappedHook = runScript('tools/codex/run-json-hook.mjs', ['--skill', 'branch-cycle-audit', '--mode', 'THINKING', '--strict']);
    const wrapped = JSON.parse(wrappedHook.stdout);
    assert.equal(wrapped.ok, false);
    assert.equal(wrapped.result, 'stop');
    assert.equal(wrapped.reason_code, 'L3_REPEATED_FALLBACK');
    assert.equal(wrapped.command_status, 1);
    const configPath = path.join(targetRoot, '.aidn/config.json');
    const originalConfig = fs.readFileSync(configPath);
    try {
      const unavailableConfig = JSON.parse(originalConfig);
      unavailableConfig.runtime.persistence.connectionRef = 'env:AIDN_TEST_ABSENT_CONNECTION_0104';
      fs.writeFileSync(configPath, JSON.stringify(unavailableConfig));
      const unavailable = runScript('tools/perf/branch-cycle-audit-hook.mjs', ['--mode', 'THINKING', '--no-emit-event']);
      assert.equal(unavailable.status, 1);
      assert.equal(JSON.parse(unavailable.stdout).reason_code, 'BRANCH_AUDIT_CANONICAL_RUNTIME_INVALID');
      const unavailableReload = runScript('tools/perf/reload-check.mjs');
      assert.notEqual(unavailableReload.status, 0, 'unavailable PostgreSQL must not use local projections');
      const unavailableProjection = runScript('tools/runtime/project-runtime-state.mjs');
      assert.equal(unavailableProjection.status, 1, 'unavailable canonical repair source must refuse');
      assert.match(unavailableProjection.stderr, /canonical runtime backend is unavailable/);
    } finally { fs.writeFileSync(configPath, originalConfig); }
    assert.deepEqual(await snapshot(scopes[0]), initialSnapshot, 'standard branch audit changed canonical data');
    assert.deepEqual(await snapshot(scopes[1]), other, 'standard branch audit changed another scope');
    // Exercise the supported preview -> explicit projection -> selective canonical
    // write path, including subsequent admission, without direct status invention.
    const digestFile = path.join(root, 'reviewed-runtime-digest.md');
    const beforeDigest = await snapshot(scopes[0]);
    const digestWrite = cli('project-runtime-state', '--out', digestFile, '--write');
    assert.equal(digestWrite.digest.repair_layer_status, 'clean');
    assert.equal(digestWrite.written, true);
    assert.deepEqual(await snapshot(scopes[0]), beforeDigest, 'projection write changed canonical rows implicitly');
    cli('db-first-artifact', '--path', 'RUNTIME-STATE.md', '--content-file', digestFile, '--no-materialize');
    const persistedDigest = cli('artifact-store', 'get', '--path', 'RUNTIME-STATE.md');
    assert.match(persistedDigest.artifact.content, /repair_layer_status: clean/);
    assert.equal(cli('pre-write-admit', '--skill', 'cycle-create', '--strict').ok, true);
    const afterDigest = await snapshot(scopes[0]);
    const runtimeIds = beforeDigest.artifacts.filter(item => item.row.path === 'RUNTIME-STATE.md').map(item => item.row.artifact_id);
    for (const table of tables) {
      const unrelated = rows => rows.filter(item => table === 'artifacts' || table === 'artifact_blobs'
        ? !runtimeIds.includes(item.row.artifact_id)
        : table === 'runtime_heads' ? !runtimeIds.includes(item.row.artifact_id) : true);
      assert.deepEqual(unrelated(afterDigest[table]), unrelated(beforeDigest[table]), `digest write changed unrelated ${table}`);
    }
    assert.deepEqual(await snapshot(scopes[1]), other, 'digest write changed another scope');
    console.log('PASS live PostgreSQL: explicit projection and db-first-artifact persist measured digest; subsequent admission succeeds; unrelated rows and other scope unchanged');
    console.log('PASS live PostgreSQL: auto reload and standard branch hook; normal reloads do not stop; genuine fallback stop survives hook and Codex wrapper; canonical data unchanged');
    assert.equal(fs.existsSync(path.join(targetRoot, '.aidn/runtime/index/workflow-index.sqlite')), false);
    console.log('PASS live PostgreSQL: first-cycle admission and runtime projector read canonical rows despite misleading files; freshness remains unknown; no data mutation');
    console.log('PASS live PostgreSQL: selective writes, parallel IDs, session visibility, read-only facade, rollback, path aliases, unrelated rows and second scope preserved, no SQLite');
  } catch (error) {
    console.error('FAIL live PostgreSQL artifact commands:', String(error.message).replaceAll(connectionString, '[redacted]')); process.exitCode = 1;
  } finally {
    try {
      for (const table of tables) await client.query(`DELETE FROM aidn_runtime.${table} WHERE scope_key=ANY($1::text[])`, [scopes]);
      for (const scope of scopes) for (const rows of Object.values(await snapshot(scope))) assert.equal(rows.length, 0);
      console.log('PASS live PostgreSQL: owned test scopes cleaned');
    } catch { console.error('FAIL: test scope cleanup'); process.exitCode = 1; }
    await client.end();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true });
  }
}
