#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK_START = "<!-- CODEX-AUDIT-WORKFLOW START -->";
const BLOCK_END = "<!-- CODEX-AUDIT-WORKFLOW END -->";

function parseArgs(argv) {
  const args = {
    target: ".",
    pack: "",
    dryRun: false,
    verifyOnly: false,
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
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.pack) {
    throw new Error("Missing required argument: --pack");
  }

  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/install.mjs --target ../repo --pack core");
  console.log("  node tools/install.mjs --target . --pack core --dry-run");
  console.log("  node tools/install.mjs --target . --pack core --verify");
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

function copyRecursive(sourcePath, targetPath, dryRun) {
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
      );
    }
    return;
  }

  ensureDir(path.dirname(targetPath), dryRun);
  if (!dryRun) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function ensureWorkflowBlock(templateText) {
  if (templateText.includes(BLOCK_START) && templateText.includes(BLOCK_END)) {
    return templateText;
  }
  const eol = detectEol(templateText);
  return `${BLOCK_START}${eol}${templateText.trimEnd()}${eol}${BLOCK_END}${eol}`;
}

function mergeBlock(templatePath, targetPath, dryRun) {
  const templateText = ensureWorkflowBlock(readUtf8(templatePath));
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
    const spacer = normalizedCurrent.endsWith("\n") || normalizedCurrent.length === 0 ? "" : "\n";
    nextNormalized = `${normalizedCurrent}${spacer}${normalizedTemplate}`;
  }

  const nextContent = nextNormalized.replace(/\n/g, eol || templateEol);
  if (nextContent === current) {
    return { changed: false };
  }

  writeUtf8(targetPath, nextContent, dryRun);
  return { changed: true };
}

function mergeAppendUnique(templatePath, targetPath, dryRun) {
  const templateText = readUtf8(templatePath);
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    const version = readUtf8(path.join(repoRoot, "VERSION")).trim();
    const manifestPath = path.join(repoRoot, "packs", args.pack, "manifest.yaml");

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Pack manifest not found: ${manifestPath}`);
    }

    const manifest = parseYaml(readUtf8(manifestPath));
    const summary = { copied: 0, merged: 0, skipped: 0 };

    console.log(`Product version: ${version}`);
    console.log(`Pack: ${args.pack}`);
    console.log(`Target: ${targetRoot}`);
    if (args.dryRun) {
      console.log("Mode: dry-run");
    } else if (args.verifyOnly) {
      console.log("Mode: verify");
    } else {
      console.log("Mode: install");
    }

    if (!args.verifyOnly) {
      const copyOps = manifest.install?.copy ?? [];
      const mergeOps = manifest.install?.merge ?? [];

      for (const op of copyOps) {
        const sourcePath = path.resolve(repoRoot, op.from);
        const targetPath = path.resolve(targetRoot, op.to);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Copy source does not exist: ${op.from}`);
        }
        console.log(`${args.dryRun ? "[dry-run] " : ""}copy ${op.from} -> ${op.to}`);
        copyRecursive(sourcePath, targetPath, args.dryRun);
        summary.copied += 1;
      }

      for (const op of mergeOps) {
        const sourcePath = path.resolve(repoRoot, op.from);
        const targetPath = path.resolve(targetRoot, op.to);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Merge source does not exist: ${op.from}`);
        }

        let result;
        if (op.strategy === "block") {
          result = mergeBlock(sourcePath, targetPath, args.dryRun);
        } else if (op.strategy === "append_unique") {
          result = mergeAppendUnique(sourcePath, targetPath, args.dryRun);
        } else {
          throw new Error(`Unsupported merge strategy: ${op.strategy}`);
        }

        if (result.changed) {
          console.log(`${args.dryRun ? "[dry-run] " : ""}merge ${op.from} -> ${op.to} (${op.strategy})`);
          summary.merged += 1;
        } else {
          console.log(`skip merge ${op.from} -> ${op.to} (${op.strategy}, no changes)`);
          summary.skipped += 1;
        }
      }
    }

    const verifyEntries = manifest.verify?.must_exist ?? [];
    const verification = verifyPaths(targetRoot, verifyEntries);
    if (!verification.ok) {
      for (const missing of verification.missing) {
        console.error(`missing: ${missing}`);
      }
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
