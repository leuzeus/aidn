import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readAidnProjectConfig, normalizeStateMode, normalizeRuntimePersistenceBackend,
  defaultIndexStoreFromStateMode, writeAidnProjectConfig } from '../../lib/config/aidn-config-lib.mjs';
import { createArtifactStore } from '../../adapters/runtime/artifact-store.mjs';
import { createRuntimeArtifactStore, createRuntimePersistenceAdmin, resolveRuntimeSqliteFile } from './runtime-persistence-service.mjs';
import { buildStrictDbOnlyPolicy } from '../install/project-config-service.mjs';
import { agentRunPhysicalPath } from './agent-run-configuration-service.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';
import { projectArtifactMetadata } from '../../adapters/runtime/artifact-projector-adapter.mjs';
import { getDatabaseSync } from '../../lib/sqlite/workflow-db-schema-lib.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function digestFile(file) {
  const fd = fs.openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  try { let count; while ((count = fs.readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
const maxRows = 10000, maxBytes = 64 * 1024 * 1024;
const rawMode = config => String(config.runtime?.stateMode ?? config.profile ?? 'files').trim().toLowerCase();
const decode = row => Buffer.from(row.content, row.content_format === 'base64' ? 'base64' : 'utf8');
const pins = rows => rows.map(row => ({ path: row.path, sha256: row.sha256 }));
const links = row => Object.fromEntries(['kind', 'family', 'subtype', 'session_id', 'cycle_id'].map(key => [key, row[key] || null]));

function fileSource(root, auditRoot) {
  const directory = agentRunPhysicalPath(path.resolve(root, auditRoot), { directory: true });
  const relativeRoot = path.relative(root, directory);
  if (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) fail('AIDN_MODE_MIGRATION_ROOT_INVALID');
  const rows = [], names = new Set(); let bytes = 0;
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) fail('AIDN_MODE_MIGRATION_SYMLINK');
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || /\.(?:lock|tmp)$/.test(entry.name)) fail('AIDN_MODE_MIGRATION_SOURCE_UNSETTLED');
      const relative = path.relative(directory, file).replaceAll('\\', '/'), content = fs.readFileSync(file);
      if (names.has(relative.toLowerCase())) fail('AIDN_MODE_MIGRATION_IDENTITY_AMBIGUOUS');
      names.add(relative.toLowerCase()); bytes += content.length;
      if (rows.length >= maxRows || bytes > maxBytes) fail('AIDN_MODE_MIGRATION_SOURCE_LIMIT');
      const text = content.toString('utf8'), utf8 = content.equals(Buffer.from(text));
      if (!utf8) fail('AIDN_MODE_MIGRATION_UTF8_REQUIRED');
      if (relative.startsWith('workflows/') && relative.endsWith('.json')) { try { JSON.parse(text); } catch { fail('AIDN_MODE_MIGRATION_HISTORY_INVALID'); } }
      rows.push({ path: relative, ...projectArtifactMetadata(relative, content),
        content_format: 'utf8', content: text, sha256: digest(content) });
    }
  }
  walk(directory); return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function verifyBusiness(rows) {
  const sessions = new Map(), cycles = new Map();
  for (const row of rows) {
    const id = /^sessions\/(S\d+)(?:[-_.][^/]*)?\.md$/.exec(row.path)?.[1]; if (!id) continue;
    if (sessions.has(id)) fail('AIDN_MODE_MIGRATION_SESSION_AMBIGUOUS');
    sessions.set(id, analyzeStructuredArtifact(decode(row).toString('utf8'), { classification: { kind: 'session' } }));
  }
  for (const row of rows) {
    const id = /^cycles\/(C\d+)[^/]*\/status\.md$/.exec(row.path)?.[1]; if (!id) continue;
    if (cycles.has(id)) fail('AIDN_MODE_MIGRATION_CYCLE_AMBIGUOUS');
    const value = analyzeStructuredArtifact(decode(row).toString('utf8'), { classification: { kind: 'cycle_status', subtype: 'status' } });
    const owner = value.key_values.session_owner;
    if (!/^S\d+$/.test(owner ?? '') || !sessions.has(owner)
      || !sessions.get(owner).derived_session_context.attached_cycles.includes(id)) fail('AIDN_MODE_MIGRATION_CYCLE_OWNER_INVALID');
    cycles.set(id, owner);
  }
  const current = rows.find(row => row.path === 'CURRENT-STATE.md');
  if (current) {
    const values = analyzeStructuredArtifact(decode(current).toString('utf8')).key_values;
    if (values.active_session && values.active_session !== 'none' && !sessions.has(values.active_session)) fail('AIDN_MODE_MIGRATION_SESSION_MISSING');
    if (values.active_cycle && values.active_cycle !== 'none' && cycles.get(values.active_cycle) !== values.active_session) fail('AIDN_MODE_MIGRATION_FOCUS_INVALID');
  }
  return { sessions: sessions.size, cycles: cycles.size, history_records: rows.filter(row => row.path.startsWith('workflows/')).length };
}

async function openStore(options, readOnly) {
  if (options.backend === 'sqlite') return createArtifactStore({ sqliteFile: options.sqliteFile, readOnly });
  const store = createRuntimeArtifactStore({ ...options, readOnly });
  return { listArtifactPaths: limit => store.executeArtifactCommand('list-paths', { limit }),
    getArtifacts: paths => store.executeArtifactCommand('get-many', { paths }),
    compareAndSwapArtifact: request => store.executeArtifactCommand('compare-and-swap', request),
    initializeEmptyScope: () => store.writeIndexProjection({ payload: { target_root: options.targetRoot, audit_root: 'docs/audit',
      artifacts: [], sessions: [], cycles: [] }, requireEmptyTarget: true, sourceBackend: 'legacy-files' }), close: () => store.close?.() };
}

async function inventory(store) {
  const names = await store.listArtifactPaths(maxRows);
  if (names.length >= maxRows) fail('AIDN_MODE_MIGRATION_INVENTORY_LIMIT');
  const paths = names.map(row => typeof row === 'string' ? row : row.path), rows = []; let bytes = 0;
  for (let offset = 0; offset < paths.length; offset += 8) {
    const selected = paths.slice(offset, offset + 8), batch = await store.getArtifacts(selected);
    if (batch.length !== selected.length) fail('AIDN_MODE_MIGRATION_INVENTORY_INVALID');
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      if (!row || row.path !== selected[i] || typeof row.content !== 'string' || !['utf8', 'base64'].includes(row.content_format)
        || digest(decode(row)) !== row.sha256) fail('AIDN_MODE_MIGRATION_CONTENT_INVALID');
      bytes += decode(row).length; if (bytes > maxBytes) fail('AIDN_MODE_MIGRATION_SOURCE_LIMIT'); rows.push(row);
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function preserveLegacyIndex(root, sqliteFile, expectedRows) {
  agentRunPhysicalPath(sqliteFile);
  const Database = getDatabaseSync(), db = new Database(sqliteFile);
  try {
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint.busy) fail('AIDN_MODE_MIGRATION_INDEX_BUSY');
    db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  } finally { db.close(); }
  if (['-wal', '-shm'].some(suffix => fs.existsSync(sqliteFile + suffix))) fail('AIDN_MODE_MIGRATION_INDEX_BUSY');
  const observer = createArtifactStore({ sqliteFile, readOnly: true });
  try {
    if (H(observer.listArtifacts(maxRows).map(row => ({ path: row.path, sha256: row.sha256 })).sort((a,b) => a.path.localeCompare(b.path))) !== H(pins(expectedRows))) fail('AIDN_MODE_MIGRATION_TARGET_CHANGED');
  } finally { observer.close(); }
  const hash = digestFile(sqliteFile);
  const backup = path.join(path.dirname(sqliteFile), `workflow-index.legacy-files-${hash}.sqlite`);
  const relative = path.relative(root, backup);
  if (relative.startsWith('..') || path.isAbsolute(relative) || fs.existsSync(backup)) fail('AIDN_MODE_MIGRATION_BACKUP_CONFLICT');
  fs.renameSync(sqliteFile, backup);
  if (digestFile(backup) !== hash) fail('AIDN_MODE_MIGRATION_BACKUP_CHANGED');
  return { path: relative.replaceAll('\\', '/'), sha256: hash, source_authority: 'legacy-index-cache' };
}

// Sole active reader of legacy FILES authority. Configuration is published last.
// Partial copies are harmless to source authority and matched on an explicit
// retry. No record is repaired, re-signed, removed or granted replay permission.
export async function migrateStateMode({ targetRoot, from = '', to, backend = '', connectionRef = '',
  auditRoot = 'docs/audit', indexFile, write = false, env = process.env }, { onBoundary = async () => {} } = {}) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true }), config = readAidnProjectConfig(root);
  const sourceMode = rawMode(config.data), targetMode = normalizeStateMode(to);
  if (!['files', 'dual', 'db-only'].includes(sourceMode) || !targetMode) fail('AIDN_MODE_MIGRATION_MODE_INVALID');
  if (from && String(from).toLowerCase() !== sourceMode) fail('AIDN_MODE_MIGRATION_SOURCE_MODE_CHANGED');
  const originalBackend = config.data.runtime?.persistence?.backend ?? 'sqlite';
  const sourceIsFiles = sourceMode === 'files' && originalBackend !== 'postgres';
  const targetBackend = normalizeRuntimePersistenceBackend(backend || originalBackend);
  if (!targetBackend) fail('AIDN_MODE_MIGRATION_BACKEND_INVALID');
  if (!sourceIsFiles && (targetBackend !== originalBackend || connectionRef && connectionRef !== config.data.runtime?.persistence?.connectionRef)) fail('AIDN_MODE_MIGRATION_USE_PERSISTENCE_ADOPT');
  const next = structuredClone(config.data); next.version ??= 1; next.profile = targetMode;
  next.install = { ...next.install, artifactImportStore: defaultIndexStoreFromStateMode(targetMode) };
  next.runtime = { ...next.runtime, stateMode: targetMode, indexStoreMode: defaultIndexStoreFromStateMode(targetMode),
    persistence: { ...next.runtime?.persistence, backend: targetBackend } };
  if (connectionRef) next.runtime.persistence.connectionRef = connectionRef;
  if (targetBackend === 'postgres' && !/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(next.runtime.persistence.connectionRef ?? '')) fail('AIDN_MODE_MIGRATION_CONNECTION_REFERENCE_REQUIRED');
  next.runtime.persistence.localProjectionPolicy = targetBackend === 'postgres' ? 'none' : 'keep-local-sqlite';
  if (targetMode === 'db-only') next.runtime.dbOnly = buildStrictDbOnlyPolicy(next.runtime.dbOnly, { canonicalBackend: targetBackend });
  const sqliteFile = resolveRuntimeSqliteFile({ targetRoot: root });
  if (indexFile && path.resolve(root, indexFile) !== sqliteFile) fail('AIDN_MODE_MIGRATION_CANONICAL_SQLITE_PATH_REQUIRED');
  const options = { targetRoot: root, backend: targetBackend, connectionRef: next.runtime.persistence.connectionRef,
    configData: next, sqliteFile, env: { ...env, AIDN_STATE_MODE: targetMode } };
  const admin = createRuntimePersistenceAdmin(options), status = await admin.inspectSchema();
  if (status.ok === false) fail('AIDN_MODE_MIGRATION_DATABASE_UNAVAILABLE');
  const hasScope = targetBackend !== 'postgres' || status.canonical_payload_rows > 0 || status.legacy_alias_payload_rows > 0;
  if (sourceIsFiles && !hasScope && status.legacy_snapshot_rows > 0) fail('AIDN_MODE_MIGRATION_TARGET_CONFLICT');
  const read = await openStore(options, true);
  let before; try { before = status.exists && hasScope ? await inventory(read) : []; } finally { await read.close(); }
  if (!sourceIsFiles && (!status.exists || !hasScope)) fail('AIDN_MODE_MIGRATION_CANONICAL_STORE_REQUIRED');
  const source = sourceIsFiles ? fileSource(root, auditRoot) : before, business = verifyBusiness(source);
  const targetRows = new Map(before.map(row => [row.path, row]));
  const conflict = sourceIsFiles && before.some(row => !source.some(source => source.path === row.path && source.sha256 === row.sha256 && H(links(source)) === H(links(row))));
  const rebuildIndex = conflict && targetBackend === 'sqlite';
  if (conflict && !rebuildIndex) fail('AIDN_MODE_MIGRATION_TARGET_CONFLICT');
  const rawBefore = fs.existsSync(config.path) ? fs.readFileSync(config.path) : null;
  const output = { ts: new Date().toISOString(), ok: true, target_root: root, from_mode: sourceMode, to_mode: targetMode,
    strict: true, preview: !write, write_requested: write, schema_status_before: status, schema_status_after: status,
    schema_migration_result: null, steps: [{ step: 'verify_source', ok: true },
      ...(sourceIsFiles ? [{ step: 'copy_verified_artifacts', ok: true, preview: !write }] : []), { step: 'update_project_config', ok: true, preview: !write }],
    sync_result: null, export_result: null, repair_layer_result: null, repair_layer_autofix_result: null, repair_layer_triage_result: null,
    config_update: { config_file: config.path, runtime: next.runtime, applied: false, write_required: true },
    verification: { ...business, artifacts: source.length, content_sha256: H(pins(source)), history_bytes_preserved: true,
      source_authority: sourceIsFiles ? 'legacy-files' : originalBackend, no_record_conversion: true },
    legacy_index: { rebuild_required: rebuildIndex, backup: null, source_rows: before.length },
    mode_migrate_diagnostic: { scope: 'runtime-mode-migrate', from_mode: sourceMode, to_mode: targetMode,
      step_count: sourceIsFiles ? 3 : 2, schema_pending_after_count: status.pending_ids?.length ?? 0,
      repair_layer_status: 'not-run', export_status: 'not-run', summary: 'Verified state authority migration; configuration is published last.',
      recommended_action: write ? 'Continue through ordinary workflow admission; signatures and bindings stay unchanged.' : 'Review verification, then apply with --write.' } };
  if (!write) return output;
  if (fs.existsSync(path.join(root, '.aidn/install/pending.json'))) fail('AIDN_MODE_MIGRATION_INSTALLATION_ACTIVE');
  const lock = agentRunPhysicalPath(path.join(root, '.aidn/runtime/standard-workflow/effects.lock'), { missing: true });
  fs.mkdirSync(path.dirname(lock), { recursive: true }); let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (cause) { if (cause.code === 'EEXIST') fail('AIDN_MODE_MIGRATION_OWNER_UNSETTLED'); throw cause; }
  let written = false, outcomeUnknown = false;
  try {
    fs.writeFileSync(fd, JSON.stringify({ contract_version: 'state-mode-migration-owner.v1', pid: process.pid, nonce: randomUUID() })); fs.fsyncSync(fd);
    await onBoundary('before_copy');
    if (sourceIsFiles && H(pins(fileSource(root, auditRoot))) !== H(pins(source))) fail('AIDN_MODE_MIGRATION_SOURCE_CHANGED');
    if (rebuildIndex) {
      outcomeUnknown = true; output.legacy_index.backup = preserveLegacyIndex(root, sqliteFile, before); outcomeUnknown = false; written = true;
      targetRows.clear();
    }
    if (rebuildIndex || !status.exists || status.pending_ids?.length) { outcomeUnknown = true; output.schema_migration_result = await admin.migrateSchema(); outcomeUnknown = false; written = true; }
    output.schema_status_after = await admin.inspectSchema();
    if (output.schema_status_after.ok === false || output.schema_status_after.pending_ids?.length) fail('AIDN_MODE_MIGRATION_SCHEMA_NOT_READY');
    const store = await openStore(options, false);
    try {
      if (sourceIsFiles && !hasScope) { outcomeUnknown = true; await store.initializeEmptyScope(); outcomeUnknown = false; written = true; }
      if (sourceIsFiles) for (const row of source) if (!targetRows.has(row.path)) {
        outcomeUnknown = true; await store.compareAndSwapArtifact({ artifact: row, expectedSha256: null }); outcomeUnknown = false; written = true;
        await onBoundary('artifact_copied', row.path);
      }
      const after = await inventory(store);
      if (H(pins(after)) !== H(pins(source)) || !sourceIsFiles && H(after) !== H(before)) fail('AIDN_MODE_MIGRATION_POSTIMAGE_CHANGED');
      if (sourceIsFiles && after.some((row, i) => H(links(row)) !== H(links(source[i])))) fail('AIDN_MODE_MIGRATION_LINKAGE_CHANGED');
      verifyBusiness(after); await onBoundary('before_config');
      if (sourceIsFiles && H(pins(fileSource(root, auditRoot))) !== H(pins(source))) fail('AIDN_MODE_MIGRATION_SOURCE_CHANGED');
      if (rawBefore === null ? fs.existsSync(config.path) : !fs.readFileSync(config.path).equals(rawBefore)) fail('AIDN_MODE_MIGRATION_CONFIG_CHANGED');
      outcomeUnknown = true; writeAidnProjectConfig(root, next); outcomeUnknown = false; written = true; output.config_update.applied = true; output.config_update.write_required = false;
    } finally { await store.close(); }
    return output;
  } catch (cause) { cause.migration_written = written; cause.migration_outcome_unknown = outcomeUnknown; throw cause; }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
