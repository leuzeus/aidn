import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath, dryRun) {
  if (dryRun) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

export function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function splitLinesNormalized(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeUtf8(filePath, content, dryRun) {
  if (dryRun) {
    return;
  }
  ensureDir(path.dirname(filePath), dryRun);
  fs.writeFileSync(filePath, content, "utf8");
}

export function renderTemplateVariables(content, templateVars) {
  if (!templateVars) {
    return content;
  }
  let rendered = content;
  for (const [key, value] of Object.entries(templateVars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, String(value));
  }
  return rendered;
}
