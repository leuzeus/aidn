import { createHash } from 'node:crypto';
import { listCriticalMarkdownContracts } from '../../lib/workflow/markdown-contract-registry-lib.mjs';

export const ARTIFACT_QUERY_EXTRACTOR = 'artifact-query-extractor.v1';
export const ACTIVE_STATE_PROFILE = 'active-state.v1';
const types = ['current_state', 'runtime_state', 'session', 'cycle_status'];
const profile = {
  id: ACTIVE_STATE_PROFILE, purpose: 'Consult active facts, never admission or authority replacement',
  mandatory: ['current_state.active_session', 'current_state.active_cycle', 'current_state.branch_kind',
    'current_state.mode', 'current_state.dor_state', 'current_state.blocking_findings',
    'runtime_state.current_state_freshness', 'runtime_state.repair_layer_status', 'runtime_state.blocking_findings'],
  conditional: { session: ['session.session_branch', 'session.primary_focus_cycle', 'session.mode'],
    cycle_status: ['cycle_status.state', 'cycle_status.branch_name', 'cycle_status.dor_state', 'cycle_status.blockers'] },
  optional: ['runtime_state.prioritized_artifacts'],
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function artifactQueryManifest(contracts = listCriticalMarkdownContracts()) {
  const artifacts = types.map(type => {
    const matches = contracts.filter(c => c.artifact_type === type);
    if (matches.length !== 1) throw new Error('ARTIFACT_QUERY_CATALOG_CONTRACT');
    const c = matches[0], ids = new Set();
    for (const f of c.consultation_fields ?? []) {
      if (ids.has(f.id) || f.id !== `${type}.${f.source_key}` || !f.meaning
        || !['scalar','list','list_or_scalar'].includes(f.type)
        || !['structured-field.v1','session-mode.v1'].includes(f.extractor)
        || (c.field_types[f.source_key] && c.field_types[f.source_key] !== f.type)
        || f.requires_sections.some(s => !c.required_sections.includes(s))) throw new Error('ARTIFACT_QUERY_CATALOG_FIELD');
      ids.add(f.id);
    }
    return { artifact_type: type, contract_version: c.contract_version,
      legacy_variants: c.legacy_variants.map(v => v.id).concat('implicit_current_contract'),
      fields: c.consultation_fields, sections: c.required_sections.map(key => ({ id: `${type}.section.${key}`, key })) };
  });
  const all = new Set(artifacts.flatMap(c => c.fields.map(f => f.id)));
  for (const id of [...profile.mandatory, ...Object.values(profile.conditional).flat(), ...profile.optional]) {
    if (!all.has(id)) throw new Error('ARTIFACT_QUERY_CATALOG_PROFILE_REFERENCE');
  }
  const manifest = { manifest_version: 'artifact-query-manifest.v1', extractor_version: ARTIFACT_QUERY_EXTRACTOR,
    artifacts, profiles: [structuredClone(profile)] };
  return { ...manifest, revision: digest(manifest) };
}
