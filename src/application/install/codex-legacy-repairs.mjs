import fs from "node:fs";
import { createHash } from "node:crypto";

const ledger = JSON.parse(fs.readFileSync(new URL("./codex-legacy-fingerprints.v1.json", import.meta.url), "utf8"));
const normalizedHash = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** Pure classification; returned replacementText is internal plan data, never an instruction to write. */
export function classifyHistoricalCodexSkill({ relativePath, text } = {}) {
  const definition = ledger.repairs?.find((item) => item.asset === relativePath || item.legacy_assets?.includes(relativePath));
  if (!definition || text === null || text === undefined) {
    return { action: "not_applicable", code: "NO_HISTORICAL_CODEX_SKILL_REPAIR", replacementText: null, provenance: null };
  }
  if (typeof text !== "string") throw new TypeError("Historical skill content must be a string");
  const currentHash = normalizedHash(text);
  const hashes = { historical_hash: definition.historical_hash, repaired_hash: definition.repaired_hash, current_hash: currentHash };
  const provenance = Object.fromEntries(["id", "hash_policy", "source_tag", "source_commit", "source_path", "source_blob", "fix_commit", "fix_blob"]
    .map((key) => [key, definition[key]]));
  if (currentHash === definition.repaired_hash) {
    return { action: "none", code: "HISTORICAL_CODEX_SKILL_ALREADY_REPAIRED", ...hashes, replacementText: null, provenance };
  }
  if (currentHash !== definition.historical_hash) {
    return { action: "conflict", code: "UNKNOWN_OR_CUSTOMIZED_CODEX_SKILL", ...hashes, replacementText: null, provenance: null };
  }
  // Full-content identification happens before this narrow edit. Keep all input
  // bytes represented by the string, including CRLF and the Markdown body.
  const before = `description: ${definition.description}`;
  const after = `description: "${definition.description}"`;
  const replacementText = text.replace(before, after);
  if (definition.kind !== "quote-yaml-description" || replacementText === text
      || normalizedHash(replacementText) !== definition.repaired_hash) {
    return { action: "conflict", code: "INVALID_HISTORICAL_CODEX_SKILL_REPAIR", ...hashes, replacementText: null, provenance: null };
  }
  return { action: "repair", code: "KNOWN_HISTORICAL_CODEX_SKILL_REPAIR", ...hashes, replacementText, provenance };
}
