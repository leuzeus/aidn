import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  detectEol,
  readUtf8,
  renderTemplateVariables,
  splitLinesNormalized,
  writeUtf8,
} from "./template-io.mjs";

const BLOCK_START = "<!-- CODEX-AUDIT-WORKFLOW START -->";
const BLOCK_END = "<!-- CODEX-AUDIT-WORKFLOW END -->";

function ensureWorkflowBlock(templateText) {
  if (templateText.includes(BLOCK_START) && templateText.includes(BLOCK_END)) {
    return templateText;
  }
  const eol = detectEol(templateText);
  return `${BLOCK_START}${eol}${templateText.trimEnd()}${eol}${BLOCK_END}${eol}`;
}

function insertManagedBlockNearTop(currentNormalized, managedBlockNormalized) {
  const managedBlock = managedBlockNormalized.endsWith("\n")
    ? managedBlockNormalized
    : `${managedBlockNormalized}\n`;
  if (!currentNormalized) {
    return managedBlock;
  }

  const lines = currentNormalized.split("\n");
  let insertAt = 0;
  if (lines[0].startsWith("# ")) {
    insertAt = 1;
    while (insertAt < lines.length && lines[insertAt].trim() === "") {
      insertAt += 1;
    }
  }

  const before = lines.slice(0, insertAt).join("\n");
  const after = lines.slice(insertAt).join("\n");

  if (!before) {
    return `${managedBlock}${after}`;
  }
  if (!after) {
    return `${before}\n\n${managedBlock}`;
  }
  return `${before}\n\n${managedBlock}\n${after}`;
}

function detectBlockMergeRisk(targetPath, currentNormalized) {
  const reasons = [];
  const lowerPath = targetPath.toLowerCase();
  const lower = currentNormalized.toLowerCase();
  if (lowerPath.endsWith("agents.md")) {
    const nonEmptyCount = currentNormalized.split("\n").filter((line) => line.trim().length > 0).length;
    if (nonEmptyCount > 40) {
      reasons.push("target AGENTS.md already contains substantial content");
    }
    if (
      lower.includes("required skills")
      || lower.includes("execution contract")
      || lower.includes("source of truth")
    ) {
      reasons.push("existing policy sections may overlap managed block");
    }
  }
  return reasons;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAgentsPath(targetPath) {
  return path.basename(targetPath).toLowerCase() === "agents.md";
}

export function shouldSkipAgentsMerge(targetPath, args) {
  if (!isAgentsPath(targetPath)) {
    return { skip: false, reason: "" };
  }
  if (args.forceAgentsMerge) {
    return { skip: false, reason: "" };
  }
  if (args.skipAgents) {
    return { skip: true, reason: "explicit --skip-agents" };
  }
  if (fs.existsSync(targetPath)) {
    if (args.assist) {
      return {
        skip: true,
        reason: "assist mode preserves existing AGENTS.md to avoid instruction interference",
      };
    }
    return {
      skip: true,
      reason: "existing AGENTS.md preserved by default (use --force-agents-merge to update managed block)",
    };
  }
  return { skip: false, reason: "" };
}

async function confirmAssist(prompt) {
  if (!input.isTTY) {
    throw new Error(
      "Assist confirmation requires an interactive terminal (TTY). Use --dry-run to preview or rerun without --assist.",
    );
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${prompt} [y/N]: `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function mergeBlock(templatePath, targetPath, dryRun, options) {
  const rawTemplateText = readUtf8(templatePath);
  const renderedTemplateText = renderTemplateVariables(rawTemplateText, options.templateVars ?? null);
  if (rawTemplateText.includes("{{VERSION}}") && renderedTemplateText.includes("{{VERSION}}")) {
    throw new Error(`Unresolved {{VERSION}} placeholder in merge template: ${templatePath}`);
  }
  const templateText = ensureWorkflowBlock(renderedTemplateText);
  const templateEol = detectEol(templateText);
  const targetExists = fs.existsSync(targetPath);

  if (!targetExists) {
    writeUtf8(targetPath, templateText, dryRun);
    return { changed: true };
  }

  const current = readUtf8(targetPath);
  const eol = detectEol(current);
  const normalizedTemplate = templateText.replace(/\r\n/g, "\n");
  const normalizedCurrent = current.replace(/\r\n/g, "\n");
  const blockPattern = new RegExp(
    `${escapeRegex(BLOCK_START)}[\\s\\S]*?${escapeRegex(BLOCK_END)}`,
  );
  let nextNormalized = normalizedCurrent;

  if (normalizedCurrent.includes(BLOCK_START) && normalizedCurrent.includes(BLOCK_END)) {
    nextNormalized = normalizedCurrent.replace(
      blockPattern,
      normalizedTemplate.trimEnd(),
    );
  } else {
    const risks = detectBlockMergeRisk(targetPath, normalizedCurrent);
    if (risks.length > 0) {
      const riskMessage = `potential merge conflict in ${targetPath}: ${risks.join("; ")}`;
      if (options.strict) {
        throw new Error(`Strict mode blocked install (${riskMessage})`);
      }
      console.warn(`WARNING: ${riskMessage}`);
      if (options.assist) {
        if (dryRun) {
          console.warn("[dry-run] assist mode: confirmation will be requested on non-dry execution");
        } else {
          const approved = await confirmAssist(
            `Apply managed AGENTS.md block insertion near top for ${targetPath}?`,
          );
          if (!approved) {
            return { changed: false, skippedByAssist: true };
          }
        }
      }
    }
    nextNormalized = insertManagedBlockNearTop(
      normalizedCurrent,
      normalizedTemplate.trimEnd(),
    );
  }

  const nextContent = nextNormalized.replace(/\n/g, eol || templateEol);
  if (nextContent === current) {
    return { changed: false };
  }

  writeUtf8(targetPath, nextContent, dryRun);
  return { changed: true, skippedByAssist: false };
}

export function mergeAppendUnique(templatePath, targetPath, dryRun, templateVars = null) {
  const rawTemplateText = readUtf8(templatePath);
  const templateText = renderTemplateVariables(rawTemplateText, templateVars);
  if (rawTemplateText.includes("{{VERSION}}") && templateText.includes("{{VERSION}}")) {
    throw new Error(`Unresolved {{VERSION}} placeholder in append_unique template: ${templatePath}`);
  }
  const templateLines = splitLinesNormalized(templateText).filter((line) => line.length > 0);
  const targetExists = fs.existsSync(targetPath);

  if (!targetExists) {
    const eol = detectEol(templateText);
    const content = templateLines.length ? `${templateLines.join(eol)}${eol}` : "";
    writeUtf8(targetPath, content, dryRun);
    return { changed: templateLines.length > 0 };
  }

  const current = readUtf8(targetPath);
  const eol = detectEol(current);
  const hadFinalNewline = current.endsWith("\n");
  const currentLines = splitLinesNormalized(current);
  const existing = new Set(currentLines);
  const additions = templateLines.filter((line) => !existing.has(line));

  if (additions.length === 0) {
    return { changed: false };
  }

  const baseLines = currentLines;
  if (baseLines.length > 0 && baseLines[baseLines.length - 1] === "") {
    baseLines.pop();
  }
  const mergedLines = baseLines.concat(additions);
  let output = mergedLines.join(eol);
  if (hadFinalNewline || additions.length > 0) {
    output += eol;
  }

  writeUtf8(targetPath, output, dryRun);
  return { changed: true };
}
