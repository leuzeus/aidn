import { createHash } from "node:crypto";

export const artifactContentHash = content => createHash("sha256").update(content, "utf8").digest("hex");

// Compare bytes, not caller-supplied metadata. Null means create only.
export function assertArtifactCompareSwap({ artifact, expectedSha256 }, current) {
  if (typeof artifact?.content !== "string" || artifact.content_format && artifact.content_format !== "utf8"
    || expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")
    || artifact.sha256 !== undefined && artifact.sha256 !== artifactContentHash(artifact.content)) {
    throw new Error("ARTIFACT_COMPARE_SWAP_INVALID");
  }
  if (current && (current.content_format !== "utf8" || typeof current.content !== "string")) throw new Error("ARTIFACT_COMPARE_SWAP_INVALID");
  if ((current ? artifactContentHash(current.content) : null) !== expectedSha256) throw new Error("ARTIFACT_REVISION_CONFLICT");
}
