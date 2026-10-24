import { createHash } from 'node:crypto';

const serialize = value => JSON.stringify(value);
const bytes = value => Buffer.byteLength(serialize(value));
const digest = value => createHash('sha256').update(serialize(value)).digest('hex');

// Invocation-local presentation only. A reference always resolves inside this
// JSON response, never to a cache, receipt or reusable admission.
export function shareWorkflowProjection(output) {
  for (const [table, field, ref, rows] of [
    ['decision_sets', 'decisions', 'decisions_ref', output.contexts],
    ['context_sources', 'source', 'source_ref', [...output.artifacts, ...(output.artifact_metadata ?? [])]],
  ]) {
    const groups = new Map();
    for (const row of rows) {
      if (!row[field]) continue;
      const key = serialize(row[field]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const entries = [];
    for (const matching of groups.values()) {
      const value = matching[0][field], id = digest(value), entry = { id, [field]: value };
      // Count table/entry/reference overhead too; unique or small values stay
      // inline. Equality includes every field, revision, scope and array order.
      if (matching.length < 2 || matching.length * bytes({ [field]: value })
          <= bytes(entry) + matching.length * bytes({ [ref]: id }) + table.length + 8) continue;
      entries.push(entry);
      for (const row of matching) { delete row[field]; row[ref] = id; }
    }
    if (entries.length) output[table] = entries;
  }
  return output;
}

export function pruneWorkflowProjectionSources(output) {
  if (!output.context_sources) return;
  const live = new Set([...output.artifacts, ...(output.artifact_metadata ?? [])].map(row => row.source_ref));
  output.context_sources = output.context_sources.filter(row => live.has(row.id));
  if (!output.context_sources.length) delete output.context_sources;
}

// Retained deltas are untrusted input. Expand before the ordinary provenance,
// scope and body checks; malformed, ambiguous or dangling references refuse.
export function expandWorkflowProjection(input) {
  const output = structuredClone(input);
  if (output.contract_version !== 'codex-workflow-step-agent-compact.v2') return output;
  for (const [table, field, ref, rows] of [
    ['decision_sets', 'decisions', 'decisions_ref', output.contexts],
    ['context_sources', 'source', 'source_ref', [...output.artifacts, ...(output.artifact_metadata ?? [])]],
  ]) {
    if (!Array.isArray(rows) || output[table] !== undefined && (!Array.isArray(output[table]) || output[table].length > 256))
      throw new Error('WORKFLOW_PROJECTION_INVALID_TABLE');
    const entries = new Map(), live = new Set();
    for (const row of output[table] ?? []) {
      if (!row || Object.keys(row).length !== 2 || !row[field] || typeof row[field] !== 'object' || Array.isArray(row[field])
          || row.id !== digest(row[field]) || entries.has(row.id)) throw new Error('WORKFLOW_PROJECTION_INVALID_BINDING');
      entries.set(row.id, row[field]);
    }
    for (const row of rows) {
      if (Object.hasOwn(row, field) === Object.hasOwn(row, ref)) throw new Error('WORKFLOW_PROJECTION_AMBIGUOUS_REFERENCE');
      if (Object.hasOwn(row, ref)) {
        if (!entries.has(row[ref])) throw new Error('WORKFLOW_PROJECTION_DANGLING_REFERENCE');
        row[field] = structuredClone(entries.get(row[ref])); live.add(row[ref]); delete row[ref];
      }
    }
    if (live.size !== entries.size) throw new Error('WORKFLOW_PROJECTION_UNUSED_BINDING');
    delete output[table];
  }
  return output;
}
