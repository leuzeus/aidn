import { sessionClosePaths } from '../../core/workflow/standard-session-close-render.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';

const require = ok => { if (!ok) throw Object.assign(Error('STANDARD_SESSION_DELIVERY_METADATA_ADMISSION_REFUSED'), { code: 'STANDARD_SESSION_DELIVERY_METADATA_ADMISSION_REFUSED' }); };
// A new canonical observation, never a claim about missing historical metadata.
// Only the existing default normative profile is admitted by this bounded path.
export function admitSessionDeliveryMetadata({ rows, plan, output }) {
  const names = sessionClosePaths(plan.session_path);
  require(output.contract_version === 'standard-session-close-hook-output.v1' && output.outcome === 'completed'
    && output.effect_status === 'confirmed' && output.facts.session_close_completed === true
    && H(output.observations.committed) === H(names) && H(plan.documents.map(row => row.path)) === H(names)
    && Array.isArray(rows) && H(rows.map(row => row?.path)) === H(names));
  return rows.map(row => {
    const session = row.path === plan.session_path, current = row.path === 'CURRENT-STATE.md';
    require(row.kind === (session ? 'session' : current ? 'other' : 'snapshot') && row.family === 'normative'
      && (row.subtype ?? null) === (session ? null : current ? 'current_state' : 'context_snapshot')
      && (row.session_id ?? null) === (session ? plan.session_id : null) && (row.cycle_id ?? null) === null
      && row.source_mode === 'explicit' && row.entity_confidence === 1 && (row.legacy_origin ?? null) === null
      && (row.classification_reason ?? null) === null && row.gate_relevance === (session || current ? 0 : 1)
      && Number.isFinite(Date.parse(row.updated_at)) && row.content_format === 'utf8'
      && typeof row.content === 'string' && artifactContentHash(row.content) === row.sha256);
    const refs = output.evidence_refs.filter(ref => ref.ref === 'docs/audit/' + row.path);
    require(refs.length === 1 && refs[0].sha256 === row.sha256);
    return { path: row.path, sha256: row.sha256, metadata_sha256: artifactMetadataHash(row) };
  });
}
