#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const BLOCK_START = "<!-- CODEX-AUDIT-WORKFLOW START -->";
const BLOCK_END = "<!-- CODEX-AUDIT-WORKFLOW END -->";

function parseArgs(argv) {
  const args = {
    target: ".",
    pack: "",
    dryRun: false,
    verifyOnly: false,
    assist: false,
    strict: false,
    skipAgents: false,
    forceAgentsMerge: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--pack") {
      args.pack = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--verify") {
      args.verifyOnly = true;
    } else if (token === "--assist") {
      args.assist = true;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--skip-agents") {
      args.skipAgents = true;
    } else if (token === "--force-agents-merge") {
      args.forceAgentsMerge = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/install.mjs --target ../repo");
  console.log("  node tools/install.mjs --target ../repo --pack core");
  console.log("  node tools/install.mjs --target . --pack core --dry-run");
  console.log("  node tools/install.mjs --target . --pack core --verify");
  console.log("  node tools/install.mjs --target ../repo --pack core --assist");
  console.log("  node tools/install.mjs --target ../repo --pack core --strict");
  console.log("  node tools/install.mjs --target ../repo --pack core --skip-agents");
  console.log("  node tools/install.mjs --target ../repo --pack core --force-agents-merge");
}

function stripComments(line) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) {
      quoted = !quoted;
    }
    if (ch === "#" && !quoted) {
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i);
      }
    }
    escaped = false;
  }
  return line;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYaml(content) {
  const root = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const stack = [{ indent: -1, kind: "object", container: root }];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const rawLine = stripComments(lines[lineNo]).replace(/\s+$/, "");
    if (!rawLine.trim()) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trimStart();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    let frame = stack[stack.length - 1];
    if (frame.kind === "pending") {
      if (line.startsWith("- ")) {
        frame.kind = "array";
        frame.container = [];
      } else {
        frame.kind = "object";
        frame.container = {};
      }
      frame.parent[frame.key] = frame.container;
    }

    if (line.startsWith("- ")) {
      if (frame.kind !== "array") {
        throw new Error(`Invalid YAML list placement at line ${lineNo + 1}`);
      }
      const itemRaw = line.slice(2).trim();
      if (!itemRaw) {
        const obj = {};
        frame.container.push(obj);
        stack.push({ indent, kind: "object", container: obj });
        continue;
      }
      if (itemRaw.includes(":")) {
        const sep = itemRaw.indexOf(":");
        const key = itemRaw.slice(0, sep).trim();
        const valueRaw = itemRaw.slice(sep + 1).trim();
        const obj = {};
        frame.container.push(obj);
        if (valueRaw) {
          obj[key] = parseScalar(valueRaw);
        } else {
          obj[key] = {};
        }
        stack.push({ indent, kind: "object", container: obj });
        if (!valueRaw) {
          stack.push({
            indent: indent + 1,
            kind: "pending",
            container: null,
            parent: obj,
            key,
          });
        }
        continue;
      }
      frame.container.push(parseScalar(itemRaw));
      continue;
    }

    if (frame.kind !== "object") {
      throw new Error(`Invalid YAML key placement at line ${lineNo + 1}`);
    }

    const sep = line.indexOf(":");
    if (sep < 0) {
      throw new Error(`Invalid YAML syntax at line ${lineNo + 1}`);
    }

    const key = line.slice(0, sep).trim();
    const valueRaw = line.slice(sep + 1).trim();
    if (valueRaw) {
      frame.container[key] = parseScalar(valueRaw);
      continue;
    }

    stack.push({
      indent,
      kind: "pending",
      container: null,
      parent: frame.container,
      key,
    });
  }

  return root;
}

function readYamlFile(filePath) {
  return parseYaml(readUtf8(filePath));
}

function normalizeOsLabel(platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "mac";
  }
  return "linux";
}

function commandExists(commandName) {
  const pathValue = process.env.PATH ?? "";
  if (!pathValue) {
    return false;
  }

  const dirs = pathValue.split(path.delimiter).filter((entry) => entry && entry.trim().length > 0);
  const isWindows = process.platform === "win32";
  const extensions = isWindows
    ? Array.from(
      new Set(
        ((process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM;.PS1")
          .split(";")
          .map((ext) => ext.trim().toLowerCase())
          .filter((ext) => ext.length > 0))
          .concat([".ps1"]),
      ),
    )
    : [""];

  for (const dir of dirs) {
    if (isWindows) {
      for (const ext of extensions) {
        const candidate = path.join(dir, `${commandName}${ext}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return true;
        }
      }
      const plainCandidate = path.join(dir, commandName);
      if (fs.existsSync(plainCandidate) && fs.statSync(plainCandidate).isFile()) {
        return true;
      }
    } else {
      const candidate = path.join(dir, commandName);
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) {
        continue;
      }
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // continue scanning
      }
    }
  }

  return false;
}

function asStringArray(value, label) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label} must contain non-empty strings`);
    }
    out.push(item.trim());
  }
  return out;
}

function asNumber(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  throw new Error(`${label} must be an integer`);
}

function asBoolean(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function intersectOrdered(primary, secondary) {
  const secondarySet = new Set(secondary);
  return primary.filter((item) => secondarySet.has(item));
}

function resolveCompatibility(workflowManifest, compatMatrix) {
  const workflowCompat = workflowManifest?.compatibility ?? null;
  const nodeMinWorkflow = asNumber(workflowCompat?.node_min, "workflow.compatibility.node_min");
  const nodeMinMatrix = asNumber(compatMatrix?.node_min, "compat.matrix.node_min");
  const codexWorkflow = asBoolean(workflowCompat?.codex_online, "workflow.compatibility.codex_online");
  const codexMatrix = asBoolean(compatMatrix?.codex_online, "compat.matrix.codex_online");
  const osWorkflow = asStringArray(workflowCompat?.os, "workflow.compatibility.os");
  const osMatrix = asStringArray(compatMatrix?.os, "compat.matrix.os");

  if (nodeMinWorkflow != null && nodeMinMatrix != null && nodeMinWorkflow !== nodeMinMatrix) {
    throw new Error(
      `Compatibility conflict: node_min differs (${nodeMinWorkflow} vs ${nodeMinMatrix})`,
    );
  }
  if (codexWorkflow != null && codexMatrix != null && codexWorkflow !== codexMatrix) {
    throw new Error(
      `Compatibility conflict: codex_online differs (${codexWorkflow} vs ${codexMatrix})`,
    );
  }

  let osEffective = null;
  if (osWorkflow && osMatrix) {
    osEffective = intersectOrdered(osWorkflow, osMatrix);
    if (osEffective.length === 0) {
      throw new Error(
        `Compatibility conflict: no overlapping OS between workflow (${osWorkflow.join(", ")}) and matrix (${osMatrix.join(", ")})`,
      );
    }
  } else {
    osEffective = osWorkflow ?? osMatrix;
  }

  const nodeMin = nodeMinWorkflow ?? nodeMinMatrix;
  const codexOnline = codexWorkflow ?? codexMatrix;
  if (nodeMin == null && osEffective == null && codexOnline == null) {
    return null;
  }

  return {
    nodeMin,
    os: osEffective,
    codexOnline,
  };
}

function validateRuntimeCompatibility(compatibility) {
  const runtime = {
    node: process.versions.node,
    os: normalizeOsLabel(process.platform),
    codexInstalled: commandExists("codex"),
  };

  if (!compatibility) {
    return runtime;
  }

  if (compatibility.nodeMin != null) {
    const currentMajor = Number(runtime.node.split(".")[0]);
    if (currentMajor < compatibility.nodeMin) {
      throw new Error(
        `Node ${currentMajor} is not supported (requires >= ${compatibility.nodeMin})`,
      );
    }
  }

  if (compatibility.os && compatibility.os.length > 0) {
    if (!compatibility.os.includes(runtime.os)) {
      throw new Error(
        `OS ${runtime.os} is not supported by compatibility matrix (${compatibility.os.join(", ")})`,
      );
    }
  }

  if (compatibility.codexOnline === true && !runtime.codexInstalled) {
    throw new Error(
      "codex_online=true requires Codex CLI to be installed and available in PATH (command: codex)",
    );
  }

  return runtime;
}

function formatCompatibility(compatibility) {
  if (!compatibility) {
    return "none";
  }
  const parts = [];
  if (compatibility.nodeMin != null) {
    parts.push(`node>=${compatibility.nodeMin}`);
  }
  if (compatibility.os && compatibility.os.length > 0) {
    parts.push(`os=[${compatibility.os.join(", ")}]`);
  }
  if (compatibility.codexOnline != null) {
    parts.push(`codex_online=${compatibility.codexOnline}`);
  }
  return parts.join(", ");
}

function loadPackManifest(repoRoot, packName) {
  const manifestPath = path.join(repoRoot, "packs", packName, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Pack manifest not found: ${manifestPath}`);
  }
  return { manifestPath, manifest: readYamlFile(manifestPath) };
}

function resolvePackOrder(repoRoot, requestedPacks) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const packCache = new Map();

  function visit(packName) {
    if (visited.has(packName)) {
      return;
    }
    if (visiting.has(packName)) {
      throw new Error(`Pack dependency cycle detected at: ${packName}`);
    }

    visiting.add(packName);
    let packInfo = packCache.get(packName);
    if (!packInfo) {
      packInfo = loadPackManifest(repoRoot, packName);
      packCache.set(packName, packInfo);
    }

    const dependsOn = packInfo.manifest.depends_on ?? [];
    if (!Array.isArray(dependsOn)) {
      throw new Error(`depends_on must be an array in pack ${packName}`);
    }
    for (const dep of dependsOn) {
      if (typeof dep !== "string" || !dep.trim()) {
        throw new Error(`Invalid depends_on entry in pack ${packName}`);
      }
      visit(dep.trim());
    }

    visiting.delete(packName);
    visited.add(packName);
    ordered.push(packName);
  }

  for (const pack of requestedPacks) {
    if (typeof pack !== "string" || !pack.trim()) {
      throw new Error("Requested pack list contains invalid entries");
    }
    visit(pack.trim());
  }

  return { ordered, packCache };
}

function ensureDir(dirPath, dryRun) {
  if (dryRun) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLinesNormalized(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, content, dryRun) {
  if (dryRun) {
    return;
  }
  fs.writeFileSync(filePath, content, "utf8");
}

function renderTemplateVariables(content, templateVars) {
  if (!templateVars) {
    return content;
  }
  let rendered = content;
  for (const [key, value] of Object.entries(templateVars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, String(value));
  }
  return rendered;
}

function shouldRenderTemplate(sourcePath) {
  const base = path.basename(sourcePath).toLowerCase();
  const ext = path.extname(sourcePath).toLowerCase();
  if (base === ".gitignore") {
    return true;
  }
  return [".md", ".yaml", ".yml", ".txt", ".json"].includes(ext);
}

function copyFile(sourcePath, targetPath, dryRun, templateVars = null) {
  ensureDir(path.dirname(targetPath), dryRun);
  if (dryRun) {
    return;
  }
  if (shouldRenderTemplate(sourcePath)) {
    const content = readUtf8(sourcePath);
    const rendered = renderTemplateVariables(content, templateVars);
    if (content.includes("{{VERSION}}") && rendered.includes("{{VERSION}}")) {
      throw new Error(`Unresolved {{VERSION}} placeholder in copied file: ${sourcePath}`);
    }
    writeUtf8(targetPath, rendered, dryRun);
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
}

function copyRecursive(sourcePath, targetPath, dryRun, skipSources = null, templateVars = null) {
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
      );
    }
    return;
  }

  copyFile(sourcePath, targetPath, dryRun, templateVars);
}

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

function isAgentsPath(targetPath) {
  return path.basename(targetPath).toLowerCase() === "agents.md";
}

function shouldSkipAgentsMerge(targetPath, args) {
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

async function mergeBlock(templatePath, targetPath, dryRun, options) {
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

function mergeAppendUnique(templatePath, targetPath, dryRun, templateVars = null) {
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifyPaths(targetRoot, pathsToCheck) {
  const missing = [];
  for (const relativePath of pathsToCheck) {
    const absolute = path.resolve(targetRoot, relativePath);
    if (!fs.existsSync(absolute)) {
      missing.push(relativePath);
    }
  }
  return { ok: missing.length === 0, missing };
}

function getWorkflowPlaceholders(targetRoot) {
  const workflowPath = path.resolve(targetRoot, "docs/audit/WORKFLOW.md");
  if (!fs.existsSync(workflowPath)) {
    return [];
  }
  const content = readUtf8(workflowPath);
  const placeholders = [];
  if (content.includes("{{PROJECT_NAME}}")) {
    placeholders.push("{{PROJECT_NAME}}");
  }
  if (content.includes("{{SOURCE_BRANCH}}")) {
    placeholders.push("{{SOURCE_BRANCH}}");
  }
  return placeholders;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    const version = readUtf8(path.join(repoRoot, "VERSION")).trim();
    const templateVars = {
      VERSION: version,
    };
    const workflowManifestPath = path.join(
      repoRoot,
      "package",
      "manifests",
      "workflow.manifest.yaml",
    );
    const compatMatrixPath = path.join(
      repoRoot,
      "package",
      "manifests",
      "compat.matrix.yaml",
    );
    if (!fs.existsSync(workflowManifestPath)) {
      throw new Error(`Missing required workflow manifest: ${workflowManifestPath}`);
    }
    if (!fs.existsSync(compatMatrixPath)) {
      throw new Error(`Missing required compatibility matrix: ${compatMatrixPath}`);
    }
    const workflowManifest = readYamlFile(workflowManifestPath);
    const compatMatrix = readYamlFile(compatMatrixPath);
    const compatibility = resolveCompatibility(workflowManifest, compatMatrix);
    const runtime = validateRuntimeCompatibility(compatibility);

    const workflowPacks = workflowManifest?.packs ?? [];
    if (workflowManifest && !Array.isArray(workflowPacks)) {
      throw new Error("workflow.manifest packs must be an array");
    }
    const requestedPacks = args.pack ? [args.pack] : workflowPacks;
    if (!requestedPacks || requestedPacks.length === 0) {
      throw new Error("No pack selected. Use --pack or define packs in workflow manifest.");
    }

    const { ordered: selectedPacks, packCache } = resolvePackOrder(
      repoRoot,
      requestedPacks,
    );
    const summary = { copied: 0, merged: 0, skipped: 0 };

    console.log(`Product version: ${version}`);
    console.log(`Packs: ${selectedPacks.join(", ")}`);
    console.log(`Target: ${targetRoot}`);
    console.log(`Compatibility policy: ${formatCompatibility(compatibility)}`);
    console.log(
      `Prereq check: OK (node ${runtime.node}, os ${runtime.os}, codex ${runtime.codexInstalled ? "installed" : "missing"})`,
    );
    if (args.dryRun) {
      console.log("Mode: dry-run");
    } else if (args.verifyOnly) {
      console.log("Mode: verify");
    } else {
      console.log("Mode: install");
    }

    if (!args.verifyOnly) {
      for (const packName of selectedPacks) {
        const packInfo = packCache.get(packName);
        const manifest = packInfo.manifest;
        const copyOps = manifest.install?.copy ?? [];
        const mergeOps = manifest.install?.merge ?? [];
        const explicitFileSources = new Set();

        for (const op of copyOps) {
          const sourcePath = path.resolve(repoRoot, op.from);
          if (!fs.existsSync(sourcePath)) {
            continue;
          }
          if (fs.statSync(sourcePath).isFile()) {
            explicitFileSources.add(path.resolve(sourcePath));
          }
        }

        for (const op of copyOps) {
          const sourcePath = path.resolve(repoRoot, op.from);
          const targetPath = path.resolve(targetRoot, op.to);
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Copy source does not exist: ${op.from}`);
          }
          console.log(
            `${args.dryRun ? "[dry-run] " : ""}copy ${op.from} -> ${op.to} (pack ${packName})`,
          );
          const sourceStat = fs.statSync(sourcePath);
          if (sourceStat.isDirectory()) {
            copyRecursive(sourcePath, targetPath, args.dryRun, explicitFileSources, templateVars);
          } else {
            copyRecursive(sourcePath, targetPath, args.dryRun, null, templateVars);
          }
          summary.copied += 1;
        }

        for (const op of mergeOps) {
          const sourcePath = path.resolve(repoRoot, op.from);
          const targetPath = path.resolve(targetRoot, op.to);
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Merge source does not exist: ${op.from}`);
          }
          const agentsPolicy = shouldSkipAgentsMerge(targetPath, args);
          if (agentsPolicy.skip) {
            console.log(
              `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, ${agentsPolicy.reason})`,
            );
            summary.skipped += 1;
            continue;
          }

          let result;
          if (op.strategy === "block") {
            result = await mergeBlock(sourcePath, targetPath, args.dryRun, {
              assist: args.assist,
              strict: args.strict,
              templateVars,
            });
          } else if (op.strategy === "append_unique") {
            result = mergeAppendUnique(sourcePath, targetPath, args.dryRun, templateVars);
          } else {
            throw new Error(`Unsupported merge strategy: ${op.strategy}`);
          }

          if (result.skippedByAssist) {
            console.log(
              `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, not approved in assist mode)`,
            );
            summary.skipped += 1;
          } else if (result.changed) {
            console.log(
              `${args.dryRun ? "[dry-run] " : ""}merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName})`,
            );
            summary.merged += 1;
          } else {
            console.log(
              `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, no changes)`,
            );
            summary.skipped += 1;
          }
        }
      }
    }

    const verifyEntriesSet = new Set();
    for (const packName of selectedPacks) {
      const manifest = packCache.get(packName).manifest;
      const verifyEntries = manifest.verify?.must_exist ?? [];
      for (const entry of verifyEntries) {
        verifyEntriesSet.add(entry);
      }
    }
    const verifyEntries = Array.from(verifyEntriesSet);
    const verification = verifyPaths(targetRoot, verifyEntries);
    const workflowPlaceholders = getWorkflowPlaceholders(targetRoot);
    if (!verification.ok) {
      for (const missing of verification.missing) {
        console.error(`missing: ${missing}`);
      }
    }
    if (workflowPlaceholders.length > 0) {
      console.warn("");
      console.warn(
        `WARNING: docs/audit/WORKFLOW.md still has placeholders: ${workflowPlaceholders.join(", ")}`,
      );
      console.warn(
        'Customize the project stub. See docs/INSTALL.md sections "Spec vs Project Stub (Why both exist)" and "Step 3 - Customize docs/audit/WORKFLOW.md (Project Stub)".',
      );
    }

    console.log("");
    console.log(`copied: ${summary.copied}`);
    console.log(`merged: ${summary.merged}`);
    console.log(`skipped: ${summary.skipped}`);
    console.log(`verified: ${verification.ok ? "OK" : "FAIL"}`);

    if (!verification.ok && (args.verifyOnly || !args.dryRun)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
