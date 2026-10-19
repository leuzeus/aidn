#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPostgresRuntimeArtifactStore } from '../../src/adapters/runtime/postgres-runtime-artifact-store.mjs';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';
import { cleanAndVerifyScopes, RUNTIME_TABLES_IN_DELETE_ORDER } from './verify-postgres-runtime-persistence-live-smoke.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const BEGIN_READ = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const connectionString = String(process.env.AIDN_RUNTIME_PG_SMOKE_URL ?? '').trim();
const checks = [];
const scopes = [];
let targetRoot = '';
let Client;

function check(name, pass) { checks.push({ name, pass: Boolean(pass) }); }
function redact(message) {
  return String(message ?? '').replaceAll(connectionString || '\0', '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-postgres-url]');
}
function checkoutSnapshot() {
  return JSON.stringify(fs.readdirSync(targetRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(targetRoot, file), fs.readFileSync(file).toString('base64')];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
function context(name) {
  const result = resolveRuntimeProjectContext({ targetRoot: path.join(targetRoot, name),
    projectId: `snapshot-fixture-${path.basename(targetRoot)}-${name}`, workspaceId: 'snapshot-fixture' });
  scopes.push(result.runtime_scope_id, result.legacy_scope_key);
  return result;
}
function store(projectContext, clientFactory = null) {
  return createPostgresRuntimeArtifactStore({ targetRoot: projectContext.target_root_ref,
    connectionString, runtimeProjectContext: projectContext, clientFactory });
}
function artifact(version) {
  const content = `mode: THINKING\nfixture_version: ${version}\n`;
  return { path: 'CURRENT-STATE.md', kind: 'other', subtype: 'current_state', content_format: 'utf8',
    content, sha256: crypto.createHash('sha256').update(content).digest('hex'), size_bytes: Buffer.byteLength(content),
    mtime_ns: '0', updated_at: '2026-04-05T12:00:00.000Z' };
}
async function seed(projectContext, version) {
  await store(projectContext).writeIndexProjection({ payload: { schema_version: 2,
    generated_at: '2026-04-05T12:00:00.000Z', artifacts: [artifact(version)], summary: { artifacts_count: 1 } } });
}
async function databaseSnapshot(scopeKeys) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const rows = [];
    for (const table of RUNTIME_TABLES_IN_DELETE_ORDER) {
      if ((await client.query('SELECT to_regclass($1) AS relation', [`aidn_runtime.${table}`])).rows[0]?.relation == null) continue;
      // Table identifiers are from the tracked constant; scopes stay parameters.
      rows.push([table, (await client.query(`SELECT to_jsonb(t) AS row FROM aidn_runtime.${table} t
        WHERE scope_key = ANY($1::text[]) ORDER BY to_jsonb(t)::text`, [scopeKeys])).rows]);
    }
    return JSON.stringify(rows);
  } finally { await client.end(); }
}
function instrument({ barrier = null, failTable = '', failRollback = false, failEnd = false, injectWrite = false } = {}) {
  const evidence = { queries: [], original_error: null, error_code: null, ended: false,
    isolation: null, read_only: null, barrier_reached: false, content_rows: {} };
  const factory = () => {
    const client = new Client({ connectionString });
    return {
      connect: () => client.connect(),
      async end() {
        await client.end();
        evidence.ended = true;
        if (failEnd) throw new Error('injected snapshot client closure failure');
      },
      async query(text, values = []) {
        const sql = String(text).trim();
        evidence.queries.push({ sql, scope: values[0] ?? null });
        if (sql === 'ROLLBACK' && failRollback) throw new Error('injected snapshot rollback failure');
        try {
          if (failTable && sql.includes(`FROM aidn_runtime.${failTable}`)) {
            // A genuine PostgreSQL schema error; no shared table is dropped/altered.
            return await client.query('SELECT * FROM aidn_runtime.__snapshot_fixture_missing_relation');
          }
          const result = await client.query(text, values);
          for (const table of ['artifacts', 'artifact_blobs']) {
            if (sql.includes(`FROM aidn_runtime.${table}`)) evidence.content_rows[table] = result.rows;
          }
          if (sql === BEGIN_READ) {
            evidence.isolation = (await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation;
            evidence.read_only = (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
            if (injectWrite) await client.query('DELETE FROM aidn_runtime.index_meta WHERE scope_key=$1', [scopes[0]]);
          }
          if (barrier && !evidence.barrier_reached && sql.includes('FROM aidn_runtime.runtime_heads')) {
            evidence.barrier_reached = true;
            await barrier();
          }
          return result;
        } catch (error) {
          evidence.original_error ??= error.message;
          evidence.error_code ??= error.code ?? null;
          throw error;
        }
      },
    };
  };
  return { factory, evidence };
}
function coherent(snapshot, version) {
  const expected = artifact(version);
  const selected = snapshot.payload?.artifacts?.find(row => row.path === expected.path);
  return snapshot.exists && !snapshot.warning && selected?.content === expected.content
    && selected.sha256 === expected.sha256 && snapshot.runtimeHeads.current_state?.artifact_sha256 === expected.sha256;
}
function coherentRows(evidence, version) {
  const expected = artifact(version);
  return ['artifacts', 'artifact_blobs'].every(table => evidence.content_rows[table]?.length === 1
    && evidence.content_rows[table][0].content === expected.content
    && evidence.content_rows[table][0].sha256 === expected.sha256);
}
function committedRead(evidence) {
  const sql = evidence.queries.map(query => query.sql);
  return sql[0] === BEGIN_READ && sql.at(-1) === 'COMMIT'
    && sql.filter(text => text === BEGIN_READ).length === 1 && !sql.includes('ROLLBACK')
    && evidence.isolation === 'repeatable read' && evidence.read_only === 'on'
    && sql.every(text => /^(SELECT\b|BEGIN\b|COMMIT$)/.test(text)) && evidence.ended;
}

let output;
let cleanup;
try {
  if (!connectionString) {
    output = { status: 'UNAVAILABLE', pass: false, skipped: false,
      reason: 'AIDN_RUNTIME_PG_SMOKE_URL is required for this manual live PostgreSQL smoke' };
  } else {
    ({ Client } = await import('pg'));
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-pg-snapshot-'));
    fs.writeFileSync(path.join(targetRoot, 'readonly-marker'), 'must remain unchanged\n');
    const canonical = context('canonical');
    const legacy = { ...canonical, runtime_scope_id: canonical.legacy_scope_key,
      scope_key: canonical.legacy_scope_key, is_legacy_scope: true };
    await seed(canonical, 'A');
    await seed(legacy, 'LEGACY');
    const filesBefore = checkoutSnapshot();
    const before = await databaseSnapshot(scopes);
    const plain = instrument();
    const observed = await store(canonical, plain.factory).loadSnapshot();
    check('plain canonical snapshot is entirely A', coherent(observed, 'A'));
    check('canonical metadata prevents querying the coexisting legacy scope',
      !plain.evidence.queries.some(query => query.scope === canonical.legacy_scope_key));
    check('successful full read commits one real repeatable-read read-only transaction', committedRead(plain.evidence));
    check('full canonical snapshot uses 17 scoped SELECTs without a redundant head reread',
      plain.evidence.queries.filter(query => /^SELECT\b/.test(query.sql)).length === 17);
    check('plain reader does not mutate any owned database row', before === await databaseSnapshot(scopes));

    const concurrent = instrument({ barrier: async () => {
      // This existing selective writer performs no bootstrap/DDL and commits B
      // while the reader is paused immediately after observing head A.
      await store(canonical).executeArtifactCommand('upsert', { artifact: artifact('B') });
    } });
    const frozen = await store(canonical, concurrent.factory).loadSnapshot();
    const fresh = instrument();
    const after = await store(canonical, fresh.factory).loadSnapshot();
    check('deterministic writer barrier actually committed while reader was active', concurrent.evidence.barrier_reached);
    check('reader head/artifact/blob remain entirely A across the concurrent B commit', coherent(frozen, 'A') && coherentRows(concurrent.evidence, 'A'));
    check('next fresh snapshot sees head/artifact/blob entirely B', coherent(after, 'B') && coherentRows(fresh.evidence, 'B'));
    check('concurrent reader and next reader each commit read-only transactions', committedRead(concurrent.evidence) && committedRead(fresh.evidence));

    const legacyOnly = context('legacy-only');
    await seed({ ...legacyOnly, runtime_scope_id: legacyOnly.legacy_scope_key,
      scope_key: legacyOnly.legacy_scope_key, is_legacy_scope: true }, 'L');
    const legacyProbe = instrument();
    const legacyObserved = await store(legacyOnly, legacyProbe.factory).loadSnapshot();
    check('absent canonical metadata retains existing legacy-only scope authority', coherent(legacyObserved, 'L')
      && legacyObserved.scope_key === legacyOnly.legacy_scope_key && legacyObserved.legacy_scope_used);
    check('both ordered scope candidates share one read-only transaction', committedRead(legacyProbe.evidence)
      && legacyProbe.evidence.queries.filter(query => query.sql.includes('FROM aidn_runtime.index_meta'))
        .map(query => query.scope).join('|') === [legacyOnly.runtime_scope_id, legacyOnly.legacy_scope_key].join('|'));

    const beforeFailures = await databaseSnapshot(scopes);
    for (const [name, options] of [
      ['missing first schema table', { failTable: 'index_meta' }],
      ['missing middle schema table', { failTable: 'artifacts' }],
      ['rollback failure', { failTable: 'artifacts', failRollback: true }],
      ['client closure failure', { failTable: 'artifacts', failEnd: true }],
    ]) {
      const failure = instrument(options);
      const failed = await store(canonical, failure.factory).loadSnapshot();
      const sql = failure.evidence.queries.map(query => query.sql);
      check(`${name}: failed closed with original 42P01, no partial payload or heads`,
        failed.exists === false && failed.payload === null && Object.keys(failed.runtimeHeads).length === 0
        && failure.evidence.error_code === '42P01' && failed.warning === failure.evidence.original_error
        && !failed.warning.includes('25P02') && failure.evidence.ended);
      check(`${name}: no SELECT or candidate fallback after abort, only one rollback`,
        sql[0] === BEGIN_READ && sql.at(-1) === 'ROLLBACK' && !sql.includes('COMMIT')
        && sql.filter(text => text === 'ROLLBACK').length === 1
        && sql.findIndex(text => text.includes(`FROM aidn_runtime.${options.failTable}`)) === sql.length - 2);
    }
    const readonly = instrument({ injectWrite: true });
    const refusedWrite = await store(canonical, readonly.factory).loadSnapshot();
    check('PostgreSQL itself rejects an injected write in the reader transaction', readonly.evidence.error_code === '25006'
      && refusedWrite.exists === false && refusedWrite.warning === readonly.evidence.original_error);
    check('all failure and read-only refusal paths preserve every owned database row', beforeFailures === await databaseSnapshot(scopes));
    check('all snapshot readers preserve the temporary checkout bytes', filesBefore === checkoutSnapshot());
    output = { status: checks.every(item => item.pass) ? 'PASS' : 'FAIL', pass: checks.every(item => item.pass),
      skipped: false, checks, check_count: checks.length, proof_class: 'manual-live-postgresql-snapshot',
      evidence: { reader_version: coherent(frozen, 'A') ? 'A' : 'mixed', next_reader_version: coherent(after, 'B') ? 'B' : 'unexpected' } };
  }
} catch (error) {
  output = { status: 'FAIL', pass: false, skipped: false, checks, error: redact(error.message) };
} finally {
  if (scopes.length) {
    try { cleanup = await cleanAndVerifyScopes(connectionString, scopes); }
    catch (error) { cleanup = { ok: false, error: redact(error.message) }; }
  }
  if (targetRoot) {
    const removed = removePathWithRetry(targetRoot);
    cleanup = { ...cleanup, temp_removed: removed.ok && !fs.existsSync(targetRoot) };
  }
}
if (cleanup) {
  output.cleanup = cleanup;
  output.pass &&= cleanup.ok && cleanup.temp_removed;
  if (!output.pass) output.status = 'FAIL';
}
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.pass ? 0 : 1;
