import { artifactContentHash as hash } from "./artifact-compare-swap.mjs";

export function applyArtifactReplacements(current, replacements, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "") || !Array.isArray(replacements)
      || replacements.length < 1 || replacements.length > 32
      || Buffer.byteLength(JSON.stringify(replacements)) > 128 * 1024) throw new Error("ARTIFACT_REPLACEMENTS_INVALID");
  if (!current || current.content_format !== "utf8" || typeof current.content !== "string") throw new Error("ARTIFACT_REPLACEMENTS_SOURCE_REQUIRED");
  if (hash(current.content) !== expectedSha256) throw new Error("ARTIFACT_REVISION_CONFLICT");
  let content = current.content;
  for (const replacement of replacements) {
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)
        || Object.keys(replacement).sort().join(",") !== "new,old"
        || typeof replacement.old !== "string" || !replacement.old.length
        || typeof replacement.new !== "string") throw new Error("ARTIFACT_REPLACEMENTS_INVALID");
    const at = content.indexOf(replacement.old);
    // Overlapping repeated matches are also ambiguous.
    if (at < 0 || content.indexOf(replacement.old, at + 1) !== -1) throw new Error("ARTIFACT_REPLACEMENT_NOT_UNIQUE");
    content = content.slice(0, at) + replacement.new + content.slice(at + replacement.old.length);
  }
  return content;
}
