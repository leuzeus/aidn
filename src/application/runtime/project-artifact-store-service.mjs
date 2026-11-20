import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MessageChannel, receiveMessageOnPort, SHARE_ENV, Worker } from 'node:worker_threads';
import { createArtifactStore } from '../../adapters/runtime/artifact-store.mjs';
import { resolveEffectiveRuntimePersistence, resolveRuntimeSqliteFile } from './runtime-persistence-service.mjs';
import { POSTGRES_ARTIFACT_READ_BATCH_LIMIT, validateArtifactPath } from '../../adapters/runtime/postgres-artifact-command-lib.mjs';
import { assertProjectArtifactStore } from '../../core/ports/project-artifact-store-port.mjs';

const workerModule = new URL('./project-artifact-store-worker.mjs', import.meta.url);
const workerOutputBytes = 32 * 1024 * 1024;
const readActions = new Set(['get', 'get-many', 'list']);
let postgresReadWorker;

function runPostgresRead(input, timeout) {
  const started = performance.now();
  if (!postgresReadWorker) {
    try {
      const worker = new Worker(workerModule, { env: SHARE_ENV, execArgv: [], stdout: true, stderr: true });
      const clear = () => { if (postgresReadWorker === worker) postgresReadWorker = undefined; };
      worker.once('error', clear);
      worker.once('exit', clear);
      // Reading the worker's stdio would keep the caller's event loop alive.
      // The response travels through the per-request port.
      worker.unref();
      postgresReadWorker = worker;
    } catch { return { status: null }; }
  }
  const worker = postgresReadWorker;
  const { port1, port2 } = new MessageChannel();
  const ready = new Int32Array(new SharedArrayBuffer(4));
  try {
    worker.postMessage({ input, reply: port2, ready, maxBytes: workerOutputBytes }, [port2]);
    const remaining = timeout - (performance.now() - started);
    if (remaining > 0 && Atomics.wait(ready, 0, 0, remaining) !== 'timed-out') {
      const { message } = receiveMessageOnPort(port1) ?? {};
      if (message && performance.now() - started < timeout) return message;
    }
  } catch { /* a broken transport has no result */ }
  finally { port1.close(); port2.close(); }
  postgresReadWorker = undefined;
  void worker.terminate().catch(() => {});
  return { status: null };
}

// Each worker request opens a current transaction against the configured
// backend. Explicit launch environments and mutations use the child process.
export function createProjectArtifactStore(options = {}) {
  const targetRoot = path.resolve(options.targetRoot ?? '.');
  const resolution = resolveEffectiveRuntimePersistence({ ...options, targetRoot });
  if (resolution.backend === 'sqlite') return assertProjectArtifactStore({ backend: 'sqlite', ...createArtifactStore({ ...options,
    sqliteFile: resolveRuntimeSqliteFile({ ...options, targetRoot }) }) });
  if (resolution.backend !== 'postgres') throw new Error('ARTIFACT_BACKEND_UNSUPPORTED');
  const call = (action, input) => {
    if (options.readOnly && ['upsert', 'compare-and-swap', 'compare-and-delete', 'replace'].includes(action)) throw new Error('Artifact store is read-only');
    const remaining = options.deadlineMs === undefined ? 60000 : Math.min(60000, options.deadlineMs - Date.now());
    if (!Number.isSafeInteger(remaining) || remaining <= 0) throw new Error('ARTIFACT_DEADLINE_EXCEEDED');
    const request = JSON.stringify({ targetRoot, action, options: input });
    const useReader = readActions.has(action) && options.workerRunner == null
      && (options.env == null || options.env === process.env) && !process.env.NODE_OPTIONS;
    const child = useReader ? runPostgresRead(request, remaining)
      : (options.workerRunner ?? spawnSync)(process.execPath, [fileURLToPath(workerModule)], {
        input: request, encoding: 'utf8', shell: false, windowsHide: true, timeout: remaining,
        maxBuffer: workerOutputBytes, env: options.env ?? process.env,
      });
    if (action === 'get-many' && child.error?.code === 'ENOBUFS') throw new Error('ARTIFACT_POSTGRES_WORKER_OUTPUT_LIMIT');
    let response;
    try { response = JSON.parse(child.stdout); } catch { throw new Error('ARTIFACT_POSTGRES_WORKER_UNAVAILABLE'); }
    if (child.status !== 0 || !response.ok) throw new Error(/^ARTIFACT_[A-Z_]+$/.test(response.code ?? '') ? response.code : 'ARTIFACT_POSTGRES_COMMAND_FAILED');
    return response.result;
  };
  function readBatch(paths) {
    if (paths.length === 1) return [call('get', { path: paths[0], auditRoot: options.auditRoot })];
    try {
      const rows = call('get-many', { paths, auditRoot: options.auditRoot });
      if (!Array.isArray(rows) || rows.length !== paths.length
          || paths.some((name, index) => rows[index] !== null && rows[index]?.path !== name))
        throw new Error('ARTIFACT_READ_BATCH_INVALID');
      return rows;
    } catch (cause) {
      // Preserve the per-artifact worker limit for histories with large journals.
      if (cause.message !== 'ARTIFACT_POSTGRES_WORKER_OUTPUT_LIMIT') throw cause;
      const middle = Math.floor(paths.length / 2);
      return [...readBatch(paths.slice(0, middle)), ...readBatch(paths.slice(middle))];
    }
  }
  return assertProjectArtifactStore({
    backend: 'postgres', sqlite_file: '', read_only: options.readOnly === true,
    upsertArtifact: artifact => call('upsert', { artifact, auditRoot: options.auditRoot }),
    compareAndSwapArtifact: request => call('compare-and-swap', { ...request, auditRoot: options.auditRoot }),
    compareAndDeleteArtifact: request => call('compare-and-delete', { ...request, auditRoot: options.auditRoot }),
    replaceArtifact: request => call('replace', { ...request, auditRoot: options.auditRoot }),
    getArtifact: artifactPath => call('get', { path: artifactPath, auditRoot: options.auditRoot }),
    getArtifacts(paths) {
      const names = paths.map(name => validateArtifactPath(name, options.auditRoot));
      const rows = [];
      for (let start = 0; start < names.length; start += POSTGRES_ARTIFACT_READ_BATCH_LIMIT)
        rows.push(...readBatch(names.slice(start, start + POSTGRES_ARTIFACT_READ_BATCH_LIMIT)));
      return rows;
    },
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
