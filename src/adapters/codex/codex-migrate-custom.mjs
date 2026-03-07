import path from "node:path";
import { spawnSync } from "node:child_process";

export function buildCodexMigrationPrompt(relativeTargetPath, sourceRendered) {
  const ext = path.extname(relativeTargetPath).toLowerCase();
  const fence = ext === ".md" ? "markdown" : (ext === ".yaml" || ext === ".yml" ? "yaml" : "");
  return [
    "Migrate one customized workflow file in-place.",
    `Target file: ${relativeTargetPath}`,
    "Instructions:",
    "- Keep project-specific customizations and local decisions.",
    "- Integrate missing structure or guardrails from the provided updated template when relevant.",
    "- The updated template already contains resolved metadata placeholders; preserve equivalent local values.",
    "- Force installed metadata version values from the template (for example workflow_version and skills ref/tag URLs).",
    "- Do not re-introduce unresolved placeholders.",
    "- Preserve valid syntax and readability.",
    "- Edit only the target file and save it.",
    "",
    "Updated template content:",
    `\`\`\`${fence}`,
    sourceRendered,
    "```",
  ].join("\n");
}

export function migrateCustomFileWithCodex(targetRoot, candidate, dryRun) {
  if (dryRun) {
    return { attempted: false, migrated: false, reason: "dry-run" };
  }
  if (!candidate.sourceRendered) {
    return { attempted: false, migrated: false, reason: "non-text-template" };
  }

  const prompt = buildCodexMigrationPrompt(candidate.targetRelative, candidate.sourceRendered);
  let result;
  if (process.platform === "win32") {
    const escapedTarget = String(targetRoot).replace(/"/g, '\\"');
    result = spawnSync(`codex exec --full-auto -C "${escapedTarget}" -`, {
      input: prompt,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
    });
  } else {
    result = spawnSync("codex", [
      "exec",
      "--full-auto",
      "-C",
      targetRoot,
      "-",
    ], {
      input: prompt,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  if (result.error) {
    return { attempted: true, migrated: false, reason: `error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    return {
      attempted: true,
      migrated: false,
      reason: stderr ? `exit ${result.status}: ${stderr}` : `exit ${result.status}`,
    };
  }

  return { attempted: true, migrated: true, reason: "ok" };
}
