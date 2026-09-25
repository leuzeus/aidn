import assert from 'node:assert/strict';
import { Client } from 'pg';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';
import { RUNTIME_TABLES_IN_DELETE_ORDER, cleanAndVerifyScopes } from '../perf/verify-postgres-runtime-persistence-live-smoke.mjs';

// Only the explicitly configured test database and fresh synthetic scopes are
// eligible. No live client configuration or connection is loaded by this probe.
export async function globalPostgresEvidence(target) {
  const connectionString = process.env.AIDN_RUNTIME_PG_SMOKE_URL;
  if (!connectionString) throw new Error('GLOBAL_POSTGRES_QUALIFICATION_UNAVAILABLE');
  for (const name of ['AIDN_PROJECT_ID', 'AIDN_PROJECT_ROOT', 'AIDN_WORKSPACE_ID', 'AIDN_SHARED_RUNTIME_ROOT']) {
    if (process.env[name]) throw new Error('GLOBAL_POSTGRES_QUALIFICATION_IDENTITY_OVERRIDE');
  }
  const scope = resolveRuntimeProjectContext({ targetRoot: target }).runtime_scope_id;
  const scopes = [target, scope];
  async function snapshot() {
    const client = new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 30000 });
    try {
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rows = {};
      for (const table of RUNTIME_TABLES_IN_DELETE_ORDER) {
        const exists = (await client.query('SELECT to_regclass($1) AS relation', [`aidn_runtime.${table}`])).rows[0].relation;
        if (!exists) throw new Error('GLOBAL_POSTGRES_TEST_SCHEMA_NOT_READY');
        rows[table] = (await client.query(`SELECT to_jsonb(t)::text AS value FROM aidn_runtime.${table} t WHERE scope_key = ANY($1::text[]) ORDER BY 1`, [scopes])).rows.map(row => row.value);
      }
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      if (/^GLOBAL_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('GLOBAL_POSTGRES_QUALIFICATION_QUERY_FAILED');
    } finally { await client.end(); }
  }
  const before = await snapshot();
  assert(Object.values(before).every(rows => rows.length === 0), 'synthetic scope must be unused before preparation');
  let reference;
  return {
    async capture() {
      assert.equal(resolveRuntimeProjectContext({ targetRoot: target }).runtime_scope_id, scope);
      reference = await snapshot();
      assert(Object.values(reference).some(rows => rows.length > 0), 'preparation must create actual test workflow data');
    },
    async verify() { assert(reference); assert.deepEqual(await snapshot(), reference, 'global migration/update/rollback must preserve every canonical row'); },
    async cleanup() {
      try {
        const result = await cleanAndVerifyScopes(connectionString, scopes);
        assert.equal(result.ok, true);
      } catch { throw new Error('GLOBAL_POSTGRES_QUALIFICATION_CLEANUP_FAILED'); }
    },
  };
}
