import { createHash } from "node:crypto";

export const artifactContentHash = content => createHash("sha256").update(content, "utf8").digest("hex");

// Metadata is outside the content hash. Patch writers must bind both to avoid
// restoring stale ownership/classification after an intervening metadata write.
export const artifactMetadataHash = artifact => artifactContentHash(JSON.stringify(Object.fromEntries([
  'kind', 'family', 'subtype', 'gate_relevance', 'classification_reason', 'session_id', 'cycle_id',
  'source_mode', 'entity_confidence', 'legacy_origin', 'updated_at',
].map(key => [key, artifact?.[key] ?? null]))));

export const isWorkflowRecordArtifactPath = value => typeof value === "string"
  && /^workflows\/(instances|process-instances|operation-records|decision-inbox|control-inbox|native-allocations|native-dispatches|native-owner-dispositions|native-allocation-reconciliations|definitions)\/[a-z][a-z0-9_-]{0,95}\.json$/.test(value);

// Bulk projections may reproduce a checkpoint, never replace it with a stale
// visible copy. Only the dedicated CAS writer advances these canonical records.
export function assertWorkflowRecordProjection(existing, incoming, { allowMissing = false } = {}) {
  const candidates = new Map((incoming ?? []).map(row => [row.path, row]));
  for (const row of existing.filter(row => isWorkflowRecordArtifactPath(row.path))) {
    const candidate = candidates.get(row.path);
    if (!candidate && allowMissing) continue;
    if (!candidate || row.content_format !== "utf8" || typeof row.content !== "string"
      || candidate.content_format !== "utf8" || candidate.content !== row.content) throw new Error("ARTIFACT_WORKFLOW_PROJECTION_CONFLICT");
  }
}

// Compare bytes, not caller-supplied metadata. Null means create only.
export function assertArtifactCompareSwap({ artifact, expectedSha256, expectedMetadataSha256 }, current) {
  if (typeof artifact?.content !== "string" || artifact.content_format && artifact.content_format !== "utf8"
    || expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")
    || artifact.sha256 !== undefined && artifact.sha256 !== artifactContentHash(artifact.content)) {
    throw new Error("ARTIFACT_COMPARE_SWAP_INVALID");
  }
  if (current && (current.content_format !== "utf8" || typeof current.content !== "string")) throw new Error("ARTIFACT_COMPARE_SWAP_INVALID");
  if ((current ? artifactContentHash(current.content) : null) !== expectedSha256) throw new Error("ARTIFACT_REVISION_CONFLICT");
  if (expectedMetadataSha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(expectedMetadataSha256)) throw new Error("ARTIFACT_COMPARE_SWAP_INVALID");
    if (!current || artifactMetadataHash(current) !== expectedMetadataSha256) throw new Error("ARTIFACT_REVISION_CONFLICT");
  }
}

// A private persistence primitive, not permission to discard a governed record.
// Both revision pins and explicit intent are mandatory. Workflow evidence and
// artifacts with derived session/cycle state require dedicated lifecycle ports.
export function assertArtifactCompareDeleteRequest(request) {
  const name = request?.path;
  if (request?.write !== true || typeof name !== 'string' || !name
      || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/.test(request.expectedSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(request.expectedMetadataSha256 ?? '')) {
    throw new Error('ARTIFACT_COMPARE_DELETE_INVALID');
  }
}

export function assertArtifactCompareDelete(request, current) {
  assertArtifactCompareDeleteRequest(request);
  const name = request.path;
  if (/^(workflows|sessions|cycles)\//i.test(name)
      || ['session', 'cycle'].includes(current?.kind)) throw new Error('ARTIFACT_DELETE_PROTECTED');
  if (!current || current.path !== name) throw new Error('ARTIFACT_REVISION_CONFLICT');
  assertArtifactCompareSwap({ artifact: { content: current.content, content_format: current.content_format },
    expectedSha256: request.expectedSha256, expectedMetadataSha256: request.expectedMetadataSha256 }, current);
}
