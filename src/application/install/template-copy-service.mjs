import fs from "node:fs";
import path from "node:path";
import {
  collectPlaceholderValuesFromText,
  extractPlaceholders,
  isCustomizableProjectFile,
  normalizePreservedMetadata,
  normalizeRelativePath,
  suggestPlaceholderValue,
} from "./custom-file-policy.mjs";
import {
  ensureDir,
  readUtf8,
  renderTemplateVariables,
  writeUtf8,
} from "./template-io.mjs";

export function shouldRenderTemplate(sourcePath) {
  const base = path.basename(sourcePath).toLowerCase();
  const ext = path.extname(sourcePath).toLowerCase();
  if (base === ".gitignore") {
    return true;
  }
  return [".md", ".yaml", ".yml", ".txt", ".json"].includes(ext);
}

export function copyFile(sourcePath, targetPath, dryRun, templateVars = null, options = null) {
  const targetRoot = options?.targetRoot ? path.resolve(options.targetRoot) : null;
  const targetRelative = targetRoot
    ? normalizeRelativePath(path.relative(targetRoot, targetPath))
    : "";
  const isCustomizable = targetRelative && isCustomizableProjectFile(targetRelative);
  const targetExists = fs.existsSync(targetPath);

  if (targetExists && options?.preserveCustomizableFiles === true && isCustomizable) {
    let sourceRendered = null;
    let differsFromTemplate = true;
    if (shouldRenderTemplate(sourcePath)) {
      const sourceText = readUtf8(sourcePath);
      const targetText = readUtf8(targetPath);
      const effectiveVars = { ...(templateVars ?? {}) };

      sourceRendered = renderTemplateVariables(sourceText, effectiveVars);
      let unresolved = extractPlaceholders(sourceRendered);
      if (unresolved.length > 0) {
        const inferred = collectPlaceholderValuesFromText(targetText);
        for (const [key, value] of Object.entries(inferred)) {
          if (!effectiveVars[key] || !String(effectiveVars[key]).trim()) {
            effectiveVars[key] = value;
          }
        }
        for (const placeholder of unresolved) {
          if (!effectiveVars[placeholder] || !String(effectiveVars[placeholder]).trim()) {
            effectiveVars[placeholder] = suggestPlaceholderValue(placeholder, targetRoot ?? process.cwd(), effectiveVars);
          }
        }
        sourceRendered = renderTemplateVariables(sourceText, effectiveVars);
        unresolved = extractPlaceholders(sourceRendered);
      }
      if (templateVars) {
        for (const [key, value] of Object.entries(effectiveVars)) {
          if (!templateVars[key] || !String(templateVars[key]).trim()) {
            templateVars[key] = value;
          }
        }
      }
      if (unresolved.length > 0) {
        throw new Error(
          `Unresolved placeholders in preserved-file template render (${sourcePath}): ${unresolved.join(", ")}`,
        );
      }

      let targetRendered = renderTemplateVariables(targetText, effectiveVars);
      const normalizedMeta = normalizePreservedMetadata(targetRelative, targetRendered, effectiveVars);
      targetRendered = normalizedMeta.text;
      const targetRenderChanged = targetRendered !== targetText;
      if (targetRenderChanged) {
        if (!dryRun) {
          writeUtf8(targetPath, targetRendered, dryRun);
        }
        if (typeof options.onPreservedPlaceholderApplied === "function") {
          options.onPreservedPlaceholderApplied({
            targetRelative,
            targetPath,
            placeholdersBefore: extractPlaceholders(targetText),
            placeholdersAfter: extractPlaceholders(targetRendered),
          });
        }
      }

      differsFromTemplate = targetRendered !== sourceRendered;
    }
    if (typeof options.onPreservedCustomFile === "function") {
      options.onPreservedCustomFile({
        targetRelative,
        sourcePath,
        targetPath,
        sourceRendered,
        differsFromTemplate,
      });
    }
    return;
  }

  ensureDir(path.dirname(targetPath), dryRun);
  if (shouldRenderTemplate(sourcePath)) {
    const content = readUtf8(sourcePath);
    const rendered = renderTemplateVariables(content, templateVars);
    const unresolved = extractPlaceholders(rendered);
    if (unresolved.length > 0) {
      throw new Error(
        `Unresolved placeholders in copied file (${sourcePath} -> ${targetPath}): ${unresolved.join(", ")}`,
      );
    }
    if (dryRun) {
      return;
    }
    writeUtf8(targetPath, rendered, dryRun);
    return;
  }
  if (dryRun) {
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
}

export function copyRecursive(sourcePath, targetPath, dryRun, skipSources = null, templateVars = null, options = null) {
  const absoluteSource = path.resolve(sourcePath);
  if (skipSources && skipSources.has(absoluteSource)) {
    return;
  }

  const sourceStat = fs.statSync(sourcePath);
  if (sourceStat.isDirectory()) {
    ensureDir(targetPath, dryRun);
    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      copyRecursive(
        path.join(sourcePath, entry.name),
        path.join(targetPath, entry.name),
        dryRun,
        skipSources,
        templateVars,
        options,
      );
    }
    return;
  }

  copyFile(sourcePath, targetPath, dryRun, templateVars, options);
}
