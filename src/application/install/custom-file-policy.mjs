import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { readUtf8 } from "./template-io.mjs";
import { resolveConfigSourceBranch } from "../../lib/config/aidn-config-lib.mjs";

export const CUSTOMIZABLE_TARGET_PATTERNS = [
  "docs/audit/glossary.md",
  "docs/audit/parking-lot.md",
  "docs/audit/baseline/current.md",
  "docs/audit/baseline/history.md",
  "docs/audit/snapshots/context-snapshot.md",
];

export function normalizeRelativePath(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function wildcardToRegex(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

const CUSTOMIZABLE_TARGET_REGEX = CUSTOMIZABLE_TARGET_PATTERNS.map((pattern) =>
  wildcardToRegex(normalizeRelativePath(pattern)),
);

export function isCustomizableProjectFile(relativeTargetPath) {
  const normalized = normalizeRelativePath(relativeTargetPath);
  return CUSTOMIZABLE_TARGET_REGEX.some((regex) => regex.test(normalized));
}

export function extractPlaceholders(content) {
  const matches = String(content).matchAll(/\{\{([A-Z0-9_]+)\}\}/g);
  const out = new Set();
  for (const match of matches) {
    out.add(String(match[1]));
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function sanitizeExtractedValue(value) {
  const text = String(value ?? "").trim().replace(/^`+|`+$/g, "");
  if (!text || /\{\{[A-Z0-9_]+\}\}/.test(text)) {
    return "";
  }
  return text;
}

function resolveDefaultGitBranch(targetRoot) {
  const remoteHead = spawnSync("git", ["-C", targetRoot, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const remoteHeadText = sanitizeExtractedValue(remoteHead.stdout).replace(/^origin\//, "");
  if (remoteHeadText) {
    return remoteHeadText;
  }

  const currentBranch = spawnSync("git", ["-C", targetRoot, "branch", "--show-current"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const currentBranchText = sanitizeExtractedValue(currentBranch.stdout);
  if (currentBranchText) {
    return currentBranchText;
  }

  return "main";
}

function readKeyValuePlaceholders(text) {
  const out = {};
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const key = String(match[1]).trim().toUpperCase();
    const value = sanitizeExtractedValue(match[2]);
    if (!value) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function readWorkflowSpecificPlaceholders(text) {
  const out = {};
  const patterns = [
    { key: "RUNTIME_CONSTRAINTS", re: /Runtime\/platform constraints:\s*`([^`]+)`/i },
    { key: "ARCH_CONSTRAINTS", re: /Architecture constraints:\s*`([^`]+)`/i },
    { key: "DEPENDENCY_CONSTRAINTS", re: /Dependency\/data constraints:\s*`([^`]+)`/i },
    { key: "DELIVERY_CONSTRAINTS", re: /Delivery constraints .*?:\s*`([^`]+)`/i },
    { key: "GENERATED_ARTIFACT_CONSTRAINTS", re: /Generated artifact constraints:\s*`([^`]+)`/i },
    { key: "TEST_REGRESSION_CONSTRAINTS", re: /Testing\/regression constraints:\s*`([^`]+)`/i },
    { key: "DOR_POLICY", re: /DoR policy:\s*`([^`]+)`/i },
    { key: "SNAPSHOT_TRIGGER", re: /Snapshot update trigger:\s*`([^`]+)`/i },
    { key: "SNAPSHOT_OWNER", re: /Snapshot owner:\s*`([^`]+)`/i },
    { key: "SNAPSHOT_FRESHNESS_RULE", re: /Freshness rule before commit\/review:\s*`([^`]+)`/i },
    { key: "PARKING_LOT_RULE", re: /Parking lot rule .*?:\s*`([^`]+)`/i },
  ];
  for (const item of patterns) {
    const match = String(text).match(item.re);
    if (!match) {
      continue;
    }
    const value = sanitizeExtractedValue(match[1]);
    if (value) {
      out[item.key] = value;
    }
  }
  return out;
}

export function collectPlaceholderValuesFromText(text) {
  return {
    ...readKeyValuePlaceholders(text),
    ...readWorkflowSpecificPlaceholders(text),
  };
}

export function normalizePreservedMetadata(targetRelative, text, templateVars) {
  let next = String(text);
  const version = sanitizeExtractedValue(templateVars?.VERSION);
  const sourceBranch = sanitizeExtractedValue(templateVars?.SOURCE_BRANCH);
  if (!version) {
    if (!sourceBranch) {
      return { text: next, changed: false };
    }
  }

  const normalizedTarget = normalizeRelativePath(targetRelative).toLowerCase();
  if (normalizedTarget === "docs/audit/workflow.md") {
    if (version) {
      next = next.replace(/^(\s*workflow_version:\s*).+$/im, `$1${version}`);
    }
    if (sourceBranch) {
      next = next.replace(/^(\s*source_branch:\s*).+$/im, `$1${sourceBranch}`);
      next = next.replace(/^\s*-\s*Source branch:.*$/im, `- Source branch: \`${sourceBranch}\``);
    }
  }

  if (normalizedTarget === "docs/audit/baseline/current.md" && sourceBranch) {
    next = next.replace(/^(\s*source_branch:\s*).+$/im, `$1${sourceBranch}`);
  }

  if (normalizedTarget === "docs/audit/baseline/history.md" && sourceBranch) {
    next = next.replace(/^(\s*-\s*source_branch:\s*).+$/gim, `$1${sourceBranch}`);
  }

  if (normalizedTarget === ".codex/skills.yaml") {
    if (version) {
      next = next.replace(/^(\s*ref:\s*["']?)v[^"'\s]+(["']?\s*)$/im, `$1v${version}$2`);
      next = next.replace(/(https:\/\/github\.com\/leuzeus\/aidn\/tree\/)v[^/]+(\/scaffold\/codex\/)/gi, `$1v${version}$2`);
    }
  }

  return { text: next, changed: next !== text };
}

export function collectExistingPlaceholderValues(targetRoot) {
  const out = {};
  const candidates = [
    path.join(targetRoot, "docs", "audit", "WORKFLOW.md"),
    path.join(targetRoot, "docs", "audit", "baseline", "current.md"),
    path.join(targetRoot, ".codex", "skills.yaml"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const text = readUtf8(filePath);
    Object.assign(out, collectPlaceholderValuesFromText(text));
    if (filePath.toLowerCase().endsWith(path.join("docs", "audit", "workflow.md").toLowerCase())) {
      Object.assign(out, readWorkflowSpecificPlaceholders(text));
    }
    if (filePath.toLowerCase().endsWith(path.join(".codex", "skills.yaml").toLowerCase())) {
      const versionMatch = text.match(/ref:\s*"v([^"]+)"/i);
      if (versionMatch && sanitizeExtractedValue(versionMatch[1])) {
        out.VERSION = sanitizeExtractedValue(versionMatch[1]);
      }
    }
  }

  return out;
}

export async function resolveInstallSourceBranch({
  explicitSourceBranch,
  configData,
  targetRoot,
  dryRun,
  summary,
}) {
  const cliValue = sanitizeExtractedValue(explicitSourceBranch);
  if (cliValue) {
    return {
      value: cliValue,
      source: "cli",
    };
  }

  const configValue = sanitizeExtractedValue(resolveConfigSourceBranch(configData));
  if (configValue) {
    return {
      value: configValue,
      source: "config",
    };
  }

  const defaultValue = resolveDefaultGitBranch(targetRoot);
  const canAsk = input.isTTY && !dryRun;
  if (canAsk) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(`Project source branch [${defaultValue}]: `);
      if (summary) {
        summary.placeholderPrompted += 1;
      }
      return {
        value: sanitizeExtractedValue(answer) || defaultValue,
        source: "prompt",
      };
    } finally {
      rl.close();
    }
  }

  if (summary) {
    summary.placeholderAutoFilled += 1;
  }
  return {
    value: defaultValue,
    source: "auto-default",
  };
}

export function suggestPlaceholderValue(name, targetRoot, templateVars) {
  if (name === "PROJECT_NAME") {
    return path.basename(targetRoot);
  }
  if (name === "SOURCE_BRANCH") {
    return sanitizeExtractedValue(templateVars?.SOURCE_BRANCH) || resolveDefaultGitBranch(targetRoot);
  }
  if (name === "VERSION") {
    return sanitizeExtractedValue(templateVars.VERSION) || "0.0.0";
  }
  if (name === "PREFERRED_STATE_MODE") {
    return sanitizeExtractedValue(templateVars.PREFERRED_STATE_MODE) || "dual";
  }
  if (name === "DEFAULT_INDEX_STORE") {
    return sanitizeExtractedValue(templateVars.DEFAULT_INDEX_STORE) || "dual-sqlite";
  }
  if (name === "ADDITIONAL_CONSTRAINTS") {
    return sanitizeExtractedValue(templateVars.ADDITIONAL_CONSTRAINTS) || "none";
  }
  if (name === "ADDITIONAL_CONSTRAINT_BLOCK") {
    return sanitizeExtractedValue(templateVars.ADDITIONAL_CONSTRAINT_BLOCK) || "- Additional local constraints: `none`";
  }
  if (name === "CI_CAPACITY_BLOCK") {
    return sanitizeExtractedValue(templateVars.CI_CAPACITY_BLOCK) || "- Project-specific CI/review capacity policy: `none`";
  }
  return "TO_DEFINE";
}

export async function resolveMissingPlaceholdersForCopyOp({
  sourcePath,
  targetPath,
  skipSources,
  templateVars,
  targetRoot,
  dryRun,
  summary,
  shouldRenderTemplate,
}) {
  const missing = new Set();

  function visit(sourceItem, targetItem) {
    const absoluteSource = path.resolve(sourceItem);
    if (skipSources && skipSources.has(absoluteSource)) {
      return;
    }
    const stat = fs.statSync(sourceItem);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(sourceItem, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        visit(path.join(sourceItem, entry.name), path.join(targetItem, entry.name));
      }
      return;
    }

    if (!shouldRenderTemplate(sourceItem)) {
      return;
    }
    if (fs.existsSync(targetItem)) {
      return;
    }
    const placeholders = extractPlaceholders(readUtf8(sourceItem));
    for (const placeholder of placeholders) {
      if (!Object.prototype.hasOwnProperty.call(templateVars, placeholder)) {
        missing.add(placeholder);
      }
    }
  }

  visit(sourcePath, targetPath);
  if (missing.size === 0) {
    return;
  }

  const ordered = Array.from(missing).sort((a, b) => a.localeCompare(b));
  const canAsk = input.isTTY && !dryRun;
  let rl = null;
  if (canAsk) {
    rl = readline.createInterface({ input, output });
  }

  try {
    for (const placeholder of ordered) {
      const defaultValue = suggestPlaceholderValue(placeholder, targetRoot, templateVars);
      let resolved = defaultValue;
      if (canAsk) {
        const answer = await rl.question(`Value for {{${placeholder}}} [${defaultValue}]: `);
        resolved = answer.trim() || defaultValue;
        summary.placeholderPrompted += 1;
      } else {
        summary.placeholderAutoFilled += 1;
      }
      templateVars[placeholder] = resolved;
      console.log(`${dryRun ? "[dry-run] " : ""}placeholder {{${placeholder}}} -> ${resolved}`);
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

export function getWorkflowPlaceholders(targetRoot) {
  const workflowPath = path.resolve(targetRoot, "docs/audit/WORKFLOW.md");
  if (!fs.existsSync(workflowPath)) {
    return [];
  }
  const content = readUtf8(workflowPath);
  return extractPlaceholders(content).map((name) => `{{${name}}}`);
}
