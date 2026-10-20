import { createHash } from "node:crypto";
import { completeMarkdownUnit } from "../codex/scoped-context-selection.mjs";

const hash = text => createHash("sha256").update(text, "utf8").digest("hex");

// Explicit consultation only: no implicit discovery, truncation or read cache.
export function parseArtifactPaths(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 16 * 1024) throw new Error('ARTIFACT_PATHS_INVALID');
  let paths;
  try { paths = JSON.parse(value); } catch { throw new Error('ARTIFACT_PATHS_INVALID'); }
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 32
      || paths.some(p => typeof p !== 'string' || !p.trim() || p !== p.trim() || p.includes('\0'))) throw new Error('ARTIFACT_PATHS_INVALID');
  const normalized = paths.map(p => p.replace(/\\/g, '/').replace(/^docs\/audit\//i, ''));
  if (new Set(normalized).size !== paths.length) throw new Error('ARTIFACT_PATHS_DUPLICATE');
  return paths;
}

// A display projection only. Canonical content and all admission decisions stay
// in their existing services; no excerpt becomes write or workflow authority.
export function artifactAgentView(artifact, { includeContent = false, heading = "" } = {}) {
  if (!artifact) return { artifact: null };
  const { content, canonical, canonical_json, ...metadata } = artifact;
  const result = { artifact: { ...metadata, has_content: typeof content === "string" } };
  if (heading) {
    if (typeof content !== "string" || ![undefined, "utf8"].includes(artifact.content_format)) throw new Error("ARTIFACT_CONTEXT_TEXT_REQUIRED");
    const unit = completeMarkdownUnit(content, heading);
    if (!unit) throw new Error("ARTIFACT_CONTEXT_HEADING_MISSING_OR_AMBIGUOUS");
    result.context_excerpt = { ...unit, heading, source_sha256: hash(content),
      excerpt_sha256: hash(unit.content), consultative_only: true };
  } else if (includeContent) result.artifact.content = content ?? null;
  return result;
}

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
