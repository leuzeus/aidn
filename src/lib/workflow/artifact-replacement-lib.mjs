import { applyArtifactReplacements } from '../../core/workflow/artifact-replacements.mjs';
import { assertArtifactCompareSwap, artifactMetadataHash } from '../../core/workflow/artifact-compare-swap.mjs';
import { buildCanonicalFromMarkdown } from './markdown-render-lib.mjs';

// Called only after the adapter has acquired its existing write lock/fence.
// The locked preimage supplies ownership/classification: no caller can restore
// metadata from an earlier observation, and no detached read crosses a commit.
export function prepareLockedArtifactReplacement(current, request) {
  const content = applyArtifactReplacements(current, request.replacements, request.expectedSha256);
  const artifact = { ...current, content, sha256: undefined, size_bytes: undefined,
    updated_at: undefined, mtime_ns: undefined,
    canonical_format: current.path.toLowerCase().endsWith('.md') ? 'markdown-canonical-v1' : null,
    canonical: current.path.toLowerCase().endsWith('.md')
      ? buildCanonicalFromMarkdown(content, { relativePath: current.path, kind: current.kind }) : null };
  assertArtifactCompareSwap({ artifact, expectedSha256: request.expectedSha256,
    expectedMetadataSha256: request.expectedMetadataSha256 ?? artifactMetadataHash(current) }, current);
  return artifact;
}
