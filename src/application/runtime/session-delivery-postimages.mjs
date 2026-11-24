import { sessionClosePaths } from '../../core/workflow/standard-session-close-render.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';

const require = (ok, code = 'STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED') => {
  if (!ok) throw Object.assign(Error(code), { code });
};
// The caller authenticates the accepted finalizer. Its preimages cannot stand
// in for the metadata hashes produced by the completion CAS.
export function readSessionDeliveryPostimages({ artifacts, plan, output }) {
  const names = sessionClosePaths(plan.session_path), current = output.contract_version === 'standard-session-close-hook-output.v2';
  require(['standard-session-close-hook-output.v1', 'standard-session-close-hook-output.v2'].includes(output.contract_version)
    && output.outcome === 'completed' && output.effect_status === 'confirmed' && output.facts.session_close_completed === true
    && H(output.observations.committed) === H(names) && H(plan.documents.map(row => row.path)) === H(names));
  const postimages = output.observations.postimages;
  if (current) require(Array.isArray(postimages) && H(postimages.map(row => row.path)) === H(names));
  return names.map((name, i) => {
    const refs = output.evidence_refs.filter(row => row.ref === 'docs/audit/' + name), prior = plan.documents.find(row => row.path === name);
    require(refs.length === 1 && prior && artifacts.read(name, { required: true }).sha256 === refs[0].sha256);
    if (!current) require(prior.metadata_sha256 === null && artifacts.metadataHash(name) === null,
      'STANDARD_SESSION_DELIVERY_METADATA_PROOF_REQUIRED');
    const metadata = current ? postimages[i].metadata_sha256 : null;
    require(!current || postimages[i].sha256 === refs[0].sha256);
    require((metadata === null || /^[a-f0-9]{64}$/.test(metadata ?? '')) && artifacts.metadataHash(name) === metadata);
    return { path: name, sha256: refs[0].sha256, metadata_sha256: metadata };
  });
}
