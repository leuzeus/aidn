import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from '../../adapters/runtime/artifact-store.mjs';
import { resolveEffectiveRuntimePersistence, resolveRuntimeSqliteFile } from './runtime-persistence-service.mjs';
import { validateArtifactPath } from '../../adapters/runtime/postgres-artifact-command-lib.mjs';
import { assertProjectArtifactStore } from '../../core/ports/project-artifact-store-port.mjs';

// Keep synchronous workflow callers synchronous; the isolated PG worker resolves
// credentials from the inherited environment, never from command arguments.
export function createProjectArtifactStore(options = {}) {
  const targetRoot = path.resolve(options.targetRoot ?? '.');
  const resolution = resolveEffectiveRuntimePersistence({ ...options, targetRoot });
  if (resolution.backend === 'sqlite') return assertProjectArtifactStore({ backend: 'sqlite', ...createArtifactStore({ ...options,
    sqliteFile: resolveRuntimeSqliteFile({ ...options, targetRoot }) }) });
  if (resolution.backend !== 'postgres') throw new Error('ARTIFACT_BACKEND_UNSUPPORTED');
  const call = (action, input) => {
    if (options.readOnly && action === 'upsert') throw new Error('Artifact store is read-only');
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./project-artifact-store-worker.mjs', import.meta.url))], {
      input: JSON.stringify({ targetRoot, action, options: input }),
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000,
      maxBuffer: 32 * 1024 * 1024, env: options.env ?? process.env,
    });
    let response;
    try { response = JSON.parse(child.stdout); } catch { throw new Error('ARTIFACT_POSTGRES_WORKER_UNAVAILABLE'); }
    if (child.status !== 0 || !response.ok) throw new Error(response.code || 'ARTIFACT_POSTGRES_COMMAND_FAILED');
    return response.result;
  };
  return assertProjectArtifactStore({
    backend: 'postgres', sqlite_file: '', read_only: options.readOnly === true,
    upsertArtifact: artifact => call('upsert', { artifact, auditRoot: options.auditRoot }),
    getArtifact: artifactPath => call('get', { path: artifactPath, auditRoot: options.auditRoot }),
    listArtifacts: limit => call('list', { limit }),
    materializeArtifacts(materialize = {}) {
      const dryRun = materialize.dryRun === true;
      if (options.readOnly && !dryRun) throw new Error('Artifact store is read-only');
      const auditRoot = path.resolve(targetRoot, materialize.auditRoot ?? 'docs/audit');
      const relativeRoot = path.relative(targetRoot, auditRoot);
      if (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) throw new Error('ARTIFACT_MATERIALIZE_ROOT_UNSAFE');
      const rows = materialize.onlyPaths?.length
        ? materialize.onlyPaths.map(name => call('get', { path: name, auditRoot: materialize.auditRoot })).filter(Boolean)
        : call('list', { limit: materialize.limit ?? 500 });
      const result = { target_root: targetRoot, audit_root: auditRoot, dry_run: dryRun,
        selected_count: rows.length, exported: 0, unchanged: 0, missing_content: 0,
        skipped_unsafe_path: 0, bytes_written: 0 };
      const writes = [];
      for (const artifact of rows) {
        const name = validateArtifactPath(artifact.path, materialize.auditRoot);
        const destination = path.join(auditRoot, name);
        // Reject redirected existing components before creating any projection.
        let component = destination;
        while (component !== targetRoot) {
          if (fs.lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('ARTIFACT_MATERIALIZE_SYMLINK');
          component = path.dirname(component);
        }
        if (typeof artifact.content !== 'string' || !['utf8', 'base64'].includes(artifact.content_format)) { result.missing_content++; continue; }
        const bytes = Buffer.from(artifact.content, artifact.content_format);
        if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) { result.unchanged++; continue; }
        writes.push({ destination, bytes }); result.exported++; result.bytes_written += bytes.length;
      }
      if (!dryRun) for (const { destination, bytes } of writes) {
        fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
      }
      return result;
    },
    close() {},
  });
}
