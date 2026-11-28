import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from '../../application/runtime/agent-run-configuration-service.mjs';
import { STANDARD_ARTIFACT_INVENTORY_MAX_BYTES } from '../../application/runtime/standard-workflow-artifacts.mjs';
import { analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';

const fail = code => { throw Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const href = file => file.replaceAll(path.sep, '/');
function label(ref) {
  const file = ref.slice('audit:'.length), cycle = /^cycles\/(C\d+)-/.exec(file)?.[1];
  const names = { 'plan.md': 'Plan de réalisation', 'traceability.md': 'Exigences et tests',
    'audit-spec.md': 'Audit du résultat', 'status.md': 'État du cycle', 'decisions.md': 'Décisions du cycle' };
  if (cycle) return (names[path.posix.basename(file)] ?? file) + ' — ' + cycle;
  return ({ 'baseline/current.md': 'Référence actuelle', 'baseline/history.md': 'Historique des références',
    'snapshots/context-snapshot.md': 'Instantané de contexte', 'CURRENT-STATE.md': 'État courant',
    'SPEC.md': 'Spécification', 'WORKFLOW.md': 'Règles du projet', 'index.md': 'Index du projet' })[file]
    ?? (/^sessions\//.test(file) ? 'Fiche de la session' : file);
}

// Derived, immutable review copies. This capability is invoked only by the
// delivery tool; question/session reads do not materialize files. The configured
// canonical artifact port remains the authority, including in db-only mode.
export function createOperatorReviewDocuments({ home, artifacts, readEvaluation }) {
  function write(file, bytes) {
    agentRunPhysicalPath(file, { missing: true });
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    agentRunPhysicalPath(path.dirname(file), { directory: true });
    const existing = readAgentRunFile(file, { json: false, optional: true, maxBytes: STANDARD_ARTIFACT_INVENTORY_MAX_BYTES });
    if (existing) {
      if (!existing.value.equals(bytes)) fail('OPERATOR_REVIEW_COPY_CHANGED');
    } else fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  }
  return async function materialize(offer) {
    const q = offer.question, review = q.review ?? q.subject, rows = review?.documents;
    if (!Array.isArray(rows) || !rows.length) return offer;
    const questionSha = shadowHash(q), refs = new Map();
    const add = row => {
      if (!row?.ref?.startsWith('audit:') || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')) fail('OPERATOR_REVIEW_REFERENCE_INVALID');
      const relative = row.ref.slice(6);
      if (!relative.endsWith('.md')) fail('OPERATOR_REVIEW_REFERENCE_INVALID');
      if (refs.has(row.ref) && refs.get(row.ref).sha256 !== row.sha256) fail('OPERATOR_REVIEW_SOURCE_CHANGED');
      if (!refs.has(row.ref)) refs.set(row.ref, row);
    };
    rows.forEach(add);
    if (review.drift_evaluation_operation_id) {
      const output = await readEvaluation(q);
      if (shadowHash(output) !== review.drift_evaluation_output_sha256) fail('OPERATOR_REVIEW_SOURCE_CHANGED');
      for (const row of output.observations.report.evidence_refs) if (row.ref.startsWith('audit:')) add(row);
    }
    // Read and validate the complete corpus before publishing any copy.
    let total = 0;
    const rowsToRead = [...refs.values()], names = rowsToRead.map(row => row.ref.slice(6));
    const snapshot = artifacts.readMany(names, { required: names, includeMetadata: true });
    const documents = rowsToRead.map((row, index) => {
      const relative = row.ref.slice(6), actual = snapshot[index];
      const bytes = Buffer.from(actual.content, 'utf8'); total += bytes.length;
      if (actual.path !== relative || hash(bytes) !== row.sha256 || row.metadata_sha256 && actual.metadata_sha256 !== row.metadata_sha256)
        fail('OPERATOR_REVIEW_SOURCE_CHANGED');
      if (total > STANDARD_ARTIFACT_INVENTORY_MAX_BYTES) fail('OPERATOR_REVIEW_SIZE_LIMIT');
      return { ref: row.ref, relative, sha256: row.sha256, bytes };
    });
    const physicalHome = agentRunPhysicalPath(home, { directory: true });
    const root = path.join(physicalHome, 'operator-reviews', questionSha);
    const preparedBefore = readAgentRunFile(path.join(root, 'manifest.json'), { optional: true,
      maxBytes: STANDARD_ARTIFACT_INVENTORY_MAX_BYTES });
    for (const row of documents) write(path.join(root, 'documents', row.relative), row.bytes);
    const links = documents.map(row => ({ ref: row.ref, label: label(row.ref),
      path: href(path.join(root, 'documents', row.relative)), sha256: row.sha256 }));
    const session = documents.find(row => row.relative === review.session_path);
    const objective = session ? analyzeStructuredArtifact(session.bytes.toString('utf8'),
      { classification: { kind: 'session' } }).key_values.session_objective : null;
    const cycles = documents.filter(row => /^cycles\/C\d+-[^/]+\/status.md$/.test(row.relative)).map(row => {
      const data = analyzeStructuredArtifact(row.bytes.toString('utf8')).key_values;
      return { id: /^cycles\/(C\d+)-/.exec(row.relative)[1], state: data.state, owner: data.session_owner };
    });
    const lines = ['# Pièces de la décision', '',
      'Ces copies correspondent à la question préparée. Les empreintes ont été vérifiées dans le backend canonique.', '',
      ...links.map(row => '- [' + row.label.replaceAll('[', '\\[').replaceAll(']', '\\]') + '](<' + row.path + '>)'), ''];
    write(path.join(root, 'LIRE-MOI.md'), Buffer.from(lines.join('\n')));
    write(path.join(root, 'manifest.json'), Buffer.from(JSON.stringify({ question_sha256: questionSha,
      documents: links }, null, 2) + '\n'));
    // Reobserve before exposing links, without changing the canonical question.
    if (shadowHash(artifacts.readMany(names, { required: names, includeMetadata: true })) !== shadowHash(snapshot))
      fail('OPERATOR_REVIEW_SOURCE_CHANGED');
    return { ...offer, review_documents: links, review_index: href(path.join(root, 'LIRE-MOI.md')),
      review_documents_prepared: !preparedBefore,
      review_context: { session_objective: objective ?? null, cycles } };
  };
}
