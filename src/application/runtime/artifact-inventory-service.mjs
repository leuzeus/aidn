import fs from 'node:fs';
import path from 'node:path';
import { artifactContentHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { readAidnProjectConfig, resolveConfigStateMode, resolveConfigRuntimePersistence } from '../../lib/config/aidn-config-lib.mjs';
import { readRuntimeSnapshot } from './runtime-snapshot-service.mjs';

// Explicit allowlist: classifications and revisions are useful for discovery;
// document bodies and derived canonical representations never enter this view.
export async function discoverProjectArtifacts({ targetRoot, limit = 10000, snapshotReader = readRuntimeSnapshot } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('ARTIFACT_INVENTORY_LIMIT_INVALID');
  const config = readAidnProjectConfig(targetRoot).data;
  const mode = resolveConfigStateMode(config) ?? 'files';
  const persistence = resolveConfigRuntimePersistence(config);
  let backend = 'files', rows = [];
  if (persistence?.backend === 'postgres' || mode !== 'files') {
    const snapshot = await snapshotReader({ targetRoot, backend: persistence?.backend ?? 'sqlite',
      indexFile: path.resolve(targetRoot, '.aidn/runtime/index/workflow-index.sqlite'),
      connectionRef: persistence?.connectionRef ?? '', configData: config });
    backend = snapshot.backend;
    rows = snapshot.payload.artifacts;
    if (!Array.isArray(rows)) throw new Error('ARTIFACT_INVENTORY_UNAVAILABLE');
  } else {
    const root = path.resolve(targetRoot, 'docs/audit');
    for (let component = root; ; component = path.dirname(component)) {
      if (fs.lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('ARTIFACT_INVENTORY_SYMLINK');
      if (component === path.parse(component).root) break;
    }
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('ARTIFACT_INVENTORY_SYMLINK');
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) {
          const bytes = fs.readFileSync(absolute);
          rows.push({ path: path.relative(root, absolute).replaceAll('\\', '/'),
            sha256: artifactContentHash(bytes), size_bytes: bytes.length });
        }
      }
    }
    if (!fs.existsSync(root)) throw new Error('ARTIFACT_INVENTORY_UNAVAILABLE');
    visit(root);
  }
  const names = new Set();
  const artifacts = rows.map(row => {
    if (typeof row.path !== 'string' || !row.path || /^[A-Za-z]:|^[/\\]/.test(row.path)
      || row.path.includes('\\') || row.path.split('/').some(p => !p || p === '.' || p === '..')
      || names.has(row.path.toLowerCase())) throw new Error('ARTIFACT_INVENTORY_REFERENCE_AMBIGUOUS');
    names.add(row.path.toLowerCase());
    if (!/^[a-f0-9]{64}$/.test(row.sha256 ?? '')) throw new Error('ARTIFACT_INVENTORY_REVISION_UNAVAILABLE');
    if (backend !== 'files' && row.content_format === 'utf8' && typeof row.content === 'string'
      && artifactContentHash(row.content) !== row.sha256) throw new Error('ARTIFACT_INVENTORY_REVISION_INCONSISTENT');
    return { path: row.path, sha256: row.sha256, size_bytes: row.size_bytes ?? null,
      kind: row.kind ?? null, family: row.family ?? null, subtype: row.subtype ?? null,
      session_id: row.session_id ?? null, cycle_id: row.cycle_id ?? null,
      updated_at: row.updated_at ?? null, source_backend: backend,
      read_method: backend === 'files' ? 'file' : 'artifact-fetch' };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { backend, view: 'agent-v1', artifacts: artifacts.slice(0, limit), inventory: {
    consultative_only: true, content_included: false, complete: artifacts.length <= limit,
    total_count: artifacts.length, limit, runtime_state_mode: mode,
    note: 'Presence and revisions at this observation only. Required reads, fresh admission and write controls remain mandatory.' } };
}
