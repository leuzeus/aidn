import path from "node:path";
import { extractPlaceholders } from "./custom-file-policy.mjs";
import { readUtf8, renderTemplateVariables } from "./template-io.mjs";

function normalizeFragmentContent(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

export function renderGeneratedDocFragment({
  repoRoot,
  fragmentRelative,
  templateVars = {},
}) {
  const fragmentPath = path.resolve(repoRoot, fragmentRelative);
  const rendered = renderTemplateVariables(readUtf8(fragmentPath), templateVars);
  const unresolved = extractPlaceholders(rendered);
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved placeholders in generated fragment (${fragmentRelative}): ${unresolved.join(", ")}`,
    );
  }
  return normalizeFragmentContent(rendered);
}
