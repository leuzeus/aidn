import { normalizeArtifact, mapArtifactRow } from './artifact-store.mjs';
import { buildRuntimeHeadRows } from '../../application/runtime/runtime-relational-projection-service.mjs';
import { analyzeStructuredArtifact, extractStructuredField } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION } from '../../application/runtime/postgres-runtime-persistence-contract-service.mjs';

// All identifiers below are internal constants; values always use parameters.
async function upsert(client, table, row, keys) {
  const columns = Object.keys(row);
  await client.query(`INSERT INTO aidn_runtime.${table} (${columns.join(',')})
    VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})
    ON CONFLICT (${keys.join(',')}) DO UPDATE SET
    ${columns.filter(c => !keys.includes(c)).map(c => `${c}=EXCLUDED.${c}`).join(',')}`,
  columns.map(c => row[c]));
}

function mapped(row) {
  return mapArtifactRow(row && { ...row, canonical_json: row.canonical_json == null
    ? null : JSON.stringify(row.canonical_json) });
}

export function validateArtifactPath(value, auditRoot = 'docs/audit') {
  const name = String(value ?? '').replace(/\\/g, '/');
  const prefix = String(auditRoot).replace(/\\/g, '/').replace(/\/$/, '');
  if (!name || /^[A-Za-z]:|^\//.test(name) || name.includes(':')
      || name.split('/').some(part => !part || part === '.' || part === '..')
      || name.toLowerCase().startsWith(prefix.toLowerCase() + '/')) {
    throw new Error('ARTIFACT_PATH_MUST_BE_AUDIT_RELATIVE');
  }
  return name;
}

// Uses an existing schema and scope only. No adoption, DDL or projection rebuild.
export async function executePostgresArtifactCommand(client, scopes, action, options = {}) {
  const writing = action === 'upsert';
  if (!['upsert', 'get', 'list'].includes(action)) throw new Error('ARTIFACT_COMMAND_UNSUPPORTED');
  const artifactPath = action === 'list' ? null
    : validateArtifactPath(action === 'upsert' ? options.artifact?.path : options.path, options.auditRoot);
  await client.query(writing ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const schema = await client.query('SELECT MAX(schema_version) AS version FROM aidn_runtime.schema_migrations WHERE schema_name=$1', ['aidn_runtime']);
    if (Number(schema.rows[0]?.version) !== POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION) {
      throw new Error('ARTIFACT_SCHEMA_MIGRATION_REQUIRED');
    }
    // Also serializes against the older bulk writer, which does not take an
    // advisory lock. This bounded transaction never modifies another scope.
    if (writing) await client.query('LOCK TABLE aidn_runtime.artifacts IN SHARE ROW EXCLUSIVE MODE');
    const found = await client.query('SELECT DISTINCT scope_key FROM aidn_runtime.index_meta WHERE scope_key = ANY($1::text[])', [scopes]);
    const present = new Set(found.rows.map(row => row.scope_key));
    if (!present.size || present.size !== found.rows.length || [...present].some(key => !scopes.includes(key))) {
      throw new Error('ARTIFACT_CANONICAL_SCOPE_MISSING_OR_AMBIGUOUS');
    }
    // The adapter supplies resolved runtime identity before its legacy path,
    // just as loadSnapshot does. Coexistence is not competing authority: once
    // canonical metadata exists, no artifact-level fallback or legacy write.
    const scope = scopes.find(key => present.has(key));
    let result;
    if (action === 'list') {
      const limit = Math.max(1, Math.min(10000, Math.floor(Number(options.limit) || 50)));
      result = (await client.query('SELECT * FROM aidn_runtime.v_materializable_artifacts WHERE scope_key=$1 ORDER BY updated_at DESC, path LIMIT $2', [scope, limit])).rows.map(mapped);
    } else if (action === 'get') {
      result = mapped((await client.query('SELECT * FROM aidn_runtime.v_materializable_artifacts WHERE scope_key=$1 AND path=$2', [scope, artifactPath])).rows[0]);
    } else {
      const artifact = normalizeArtifact({ ...options.artifact, path: artifactPath });
      const sessionId = artifactPath.match(/^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/i)?.[1]?.toUpperCase();
      const cycleId = artifactPath.match(/^cycles\/(C\d+)[^/]*\/status\.md$/i)?.[1]?.toUpperCase();
      if ((sessionId && artifact.session_id && artifact.session_id !== sessionId)
          || (cycleId && artifact.cycle_id && artifact.cycle_id !== cycleId)) throw new Error('ARTIFACT_IDENTITY_CONFLICT');
      if (sessionId) artifact.session_id = sessionId;
      if (cycleId) artifact.cycle_id = cycleId;
      const existing = await client.query('SELECT artifact_id FROM aidn_runtime.artifacts WHERE scope_key=$1 AND path=$2', [scope, artifactPath]);
      const id = existing.rows[0]?.artifact_id ?? (await client.query('SELECT COALESCE(MAX(artifact_id),0)+1 AS id FROM aidn_runtime.artifacts WHERE scope_key=$1', [scope])).rows[0].id;
      const row = { scope_key: scope, artifact_id: id, ...artifact };
      await upsert(client, 'artifacts', row, ['scope_key', 'path']);
      await upsert(client, 'artifact_blobs', Object.fromEntries([
        'scope_key', 'artifact_id', 'content_format', 'content', 'canonical_format', 'canonical_json', 'sha256', 'size_bytes', 'updated_at',
      ].map(key => [key, row[key]])), ['scope_key', 'artifact_id']);
      for (const head of buildRuntimeHeadRows([{ ...row, canonical_json: options.artifact.canonical }], { scopeKey: scope })) {
        const previous = await client.query('SELECT artifact_path FROM aidn_runtime.runtime_heads WHERE scope_key=$1 AND head_key=$2', [scope, head.head_key]);
        if (previous.rows[0] && previous.rows[0].artifact_path !== artifactPath) throw new Error('ARTIFACT_HEAD_PATH_CONFLICT');
        await upsert(client, 'runtime_heads', head, ['scope_key', 'head_key']);
      }
      const field = name => extractStructuredField(artifact.content ?? '', name) || null;
      if (cycleId && artifact.content_format === 'utf8') {
        await upsert(client, 'cycles', { scope_key: scope, cycle_id: cycleId,
          session_id: field('session_owner'), state: (field('state') || 'UNKNOWN').toUpperCase(),
          ...Object.fromEntries(['outcome', 'branch_name', 'dor_state', 'continuity_rule', 'continuity_base_branch',
            'continuity_latest_cycle_branch', 'continuity_decision_by'].map(key => [key, field(key)])),
          updated_at: artifact.updated_at }, ['scope_key', 'cycle_id']);
      }
      if (sessionId && artifact.content_format === 'utf8') {
        const context = analyzeStructuredArtifact(artifact.content, { classification: { kind: 'session' } }).derived_session_context;
        await upsert(client, 'sessions', { scope_key: scope, session_id: sessionId,
          branch_name: context.session_branch || field('branch'), state: context.mode, owner: sessionId,
          ...Object.fromEntries(['parent_session', 'branch_kind', 'cycle_branch', 'intermediate_branch',
            'integration_target_cycle', 'carry_over_pending', 'started_at', 'ended_at'].map(key => [key, field(key)])),
          integration_target_cycle: context.primary_focus_cycle || context.integration_target_cycle,
          source_artifact_path: artifactPath, source_confidence: 1, source_mode: 'explicit', updated_at: artifact.updated_at,
        }, ['scope_key', 'session_id']);
      }
      result = mapArtifactRow(artifact);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
