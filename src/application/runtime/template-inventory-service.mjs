import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readAidnProjectConfig, resolveConfigStateMode, resolveConfigRuntimePersistence } from '../../lib/config/aidn-config-lib.mjs';
import { readRuntimeSnapshot } from './runtime-snapshot-service.mjs';

const digest = content => crypto.createHash('sha256').update(content).digest('hex');

// Distribution determines which standard assets exist, never the project's
// canonical content. No filename aliases or harness-owned role table.
export function distributedTemplates(distributionRoot = path.resolve(import.meta.dirname, '../../../scaffold/docs_audit')) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('TEMPLATE_DISTRIBUTION_SYMLINK');
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/^TEMPLATE_.+\.md$/.test(entry.name)) {
        const content = fs.readFileSync(absolute, 'utf8');
        entries.push({ path: path.relative(distributionRoot, absolute).replaceAll('\\', '/'),
          distribution_sha256: digest(content), title: content.match(/^#\s+(.+)$/m)?.[1] ?? entry.name });
      }
    }
  }
  visit(distributionRoot);
  if (!entries.length) throw new Error('TEMPLATE_DISTRIBUTION_EMPTY');
  if (new Set(entries.map(asset => asset.path.toLowerCase())).size !== entries.length) throw new Error('TEMPLATE_REFERENCE_AMBIGUOUS');
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function discoverProjectTemplates({ targetRoot, auditRoot = 'docs/audit', distributionRoot, env = process.env, snapshotReader = readRuntimeSnapshot } = {}) {
  const config = readAidnProjectConfig(targetRoot).data;
  const persistence = resolveConfigRuntimePersistence(config);
  const mode = resolveConfigStateMode(config) ?? 'files';
  const distributed = distributedTemplates(distributionRoot);
  const useDatabase = persistence?.backend === 'postgres' || mode !== 'files';
  let rows = null, backend = 'files';
  if (useDatabase) {
    const snapshot = await snapshotReader({ targetRoot, backend: persistence?.backend ?? 'sqlite',
      indexFile: path.resolve(targetRoot, '.aidn/runtime/index/workflow-index.sqlite'),
      connectionRef: persistence?.connectionRef ?? '', configData: config, env });
    rows = snapshot.payload.artifacts;
    if (!Array.isArray(rows)) throw new Error('TEMPLATE_CANONICAL_INVENTORY_UNAVAILABLE');
    backend = snapshot.backend;
  }
  const artifacts = distributed.map(asset => {
    let content, sha256;
    if (rows) {
      const matches = rows.filter(row => row.path === asset.path);
      if (matches.length > 1) throw new Error(`TEMPLATE_REFERENCE_AMBIGUOUS: ${asset.path}`);
      if (!matches.length || typeof matches[0].content !== 'string' || matches[0].content_format !== 'utf8') throw new Error(`TEMPLATE_REQUIRED_UNAVAILABLE: ${asset.path}`);
      content = matches[0].content; sha256 = matches[0].sha256;
      if (sha256 !== digest(content)) throw new Error(`TEMPLATE_CONTENT_INCONSISTENT: ${asset.path}`);
    } else {
      const absoluteRoot = path.resolve(targetRoot, auditRoot);
      const absolute = path.resolve(absoluteRoot, asset.path);
      for (let component = absolute; ; component = path.dirname(component)) {
        if (fs.lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('TEMPLATE_REFERENCE_SYMLINK');
        if (component === path.parse(component).root) break;
      }
      if (!fs.existsSync(absolute)) throw new Error(`TEMPLATE_REQUIRED_UNAVAILABLE: ${asset.path}`);
      content = fs.readFileSync(absolute, 'utf8'); sha256 = digest(content);
    }
    return { ...asset, sha256, title: content.match(/^#\s+(.+)$/m)?.[1] ?? asset.title,
      source_backend: backend, read_method: backend === 'files' ? 'file' : 'artifact-fetch',
      projection_path: path.posix.join(auditRoot.replaceAll('\\', '/'), asset.path) };
  });
  return { backend, artifacts, template_inventory: { consultative_only: true,
    distribution: 'package:scaffold/docs_audit', runtime_state_mode: mode,
    complete: true, content_included: false,
    note: 'Exact references observed now. Read required complete templates from the selected authority; admission and freshness must be checked independently.' } };
}
