import fs from "node:fs";
import path from "node:path";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCycleSlug(slug) {
  const normalized = normalizeScalar(slug);
  const match = normalized.match(/^(C\d+)-([a-z0-9]+)(?:-.+)?$/i);
  if (!match) {
    throw new Error(`Invalid cycle slug: ${slug}`);
  }
  return {
    slug: normalized,
    cycleId: String(match[1]).toUpperCase(),
    cycleType: String(match[2]).toLowerCase(),
    shortLabel: `${String(match[1]).toUpperCase()}-${String(match[2]).toLowerCase()}`,
    displayLabel: `${String(match[1]).toUpperCase()} ${String(match[2]).toLowerCase()}`,
  };
}

function parseRenameSpec(spec) {
  const normalized = normalizeScalar(spec);
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    throw new Error(`Invalid --rename mapping: ${spec}`);
  }
  const oldSlug = normalized.slice(0, separatorIndex).trim();
  const newSlug = normalized.slice(separatorIndex + 1).trim();
  const oldParts = parseCycleSlug(oldSlug);
  const newParts = parseCycleSlug(newSlug);
  return {
    old_slug: oldParts.slug,
    new_slug: newParts.slug,
    old_cycle_id: oldParts.cycleId,
    new_cycle_id: newParts.cycleId,
    old_short_label: oldParts.shortLabel,
    new_short_label: newParts.shortLabel,
    old_display_label: oldParts.displayLabel,
    new_display_label: newParts.displayLabel,
  };
}

function isProbablyBinary(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return false;
  }
  return buffer.includes(0);
}

function* walkFiles(rootDir, options = {}) {
  const skipNames = new Set(options.skipNames ?? [".git", "node_modules"]);
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (skipNames.has(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        yield absolute;
      }
    }
  }
}

function pushSample(list, value, limit = 200) {
  if (!Array.isArray(list) || list.length >= limit) {
    return;
  }
  list.push(value);
}

function buildGlobalReplacements(mapping) {
  return [
    [mapping.old_slug, mapping.new_slug],
    [mapping.old_short_label, mapping.new_short_label],
    [mapping.old_display_label, mapping.new_display_label],
  ];
}

function applyStructuredReplacements(text, replacements) {
  let next = text;
  for (const [from, to] of replacements) {
    if (!from || from === to) {
      continue;
    }
    next = next.split(from).join(to);
  }
  return next;
}

function applyCycleLocalIdentityRewrite(text, mapping) {
  if (!mapping.old_cycle_id || mapping.old_cycle_id === mapping.new_cycle_id) {
    return text;
  }
  return text.replace(
    new RegExp(`\\b${escapeRegex(mapping.old_cycle_id)}\\b`, "g"),
    mapping.new_cycle_id,
  );
}

export function normalizeRuntimeCycleIdentitySource({
  targetRoot = ".",
  renameSpecs = [],
  write = true,
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const auditRoot = path.join(absoluteTargetRoot, "docs", "audit");
  const cyclesRoot = path.join(absoluteTargetRoot, "docs", "audit", "cycles");
  if (!fs.existsSync(auditRoot) || !fs.statSync(auditRoot).isDirectory()) {
    throw new Error(`Audit root not found: ${auditRoot}`);
  }
  if (!fs.existsSync(cyclesRoot)) {
    throw new Error(`Cycle root not found: ${cyclesRoot}`);
  }
  if (!Array.isArray(renameSpecs) || renameSpecs.length === 0) {
    throw new Error("At least one --rename mapping is required");
  }

  const mappings = renameSpecs.map(parseRenameSpec);
  const seenOld = new Set();
  const seenNew = new Set();
  for (const mapping of mappings) {
    if (seenOld.has(mapping.old_slug)) {
      throw new Error(`Duplicate source mapping: ${mapping.old_slug}`);
    }
    if (seenNew.has(mapping.new_slug)) {
      throw new Error(`Duplicate target mapping: ${mapping.new_slug}`);
    }
    seenOld.add(mapping.old_slug);
    seenNew.add(mapping.new_slug);
    const oldDir = path.join(cyclesRoot, mapping.old_slug);
    const newDir = path.join(cyclesRoot, mapping.new_slug);
    if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
      throw new Error(`Source cycle directory not found: ${oldDir}`);
    }
    if (fs.existsSync(newDir)) {
      throw new Error(`Target cycle directory already exists: ${newDir}`);
    }
  }

  const updatedFiles = [];
  const skippedBinaryFiles = [];
  let filesScanned = 0;
  let filesUpdated = 0;
  let skippedBinaryFilesCount = 0;
  for (const filePath of walkFiles(auditRoot)) {
    filesScanned += 1;
    const buffer = fs.readFileSync(filePath);
    if (isProbablyBinary(buffer)) {
      skippedBinaryFilesCount += 1;
      pushSample(skippedBinaryFiles, normalizePath(path.relative(absoluteTargetRoot, filePath)));
      continue;
    }
    const original = buffer.toString("utf8");
    let next = original;
    const normalizedFilePath = normalizePath(filePath);
    for (const mapping of mappings) {
      next = applyStructuredReplacements(next, buildGlobalReplacements(mapping));
      const cycleLocalPrefix = normalizePath(path.join(cyclesRoot, mapping.old_slug)) + "/";
      if (normalizedFilePath.startsWith(cycleLocalPrefix)) {
        next = applyCycleLocalIdentityRewrite(next, mapping);
      }
    }
    if (next === original) {
      continue;
    }
    const relativePath = normalizePath(path.relative(absoluteTargetRoot, filePath));
    filesUpdated += 1;
    pushSample(updatedFiles, relativePath);
    if (write) {
      fs.writeFileSync(filePath, next, "utf8");
    }
  }

  const renamedDirectories = [];
  for (const mapping of mappings) {
    const fromDir = path.join(cyclesRoot, mapping.old_slug);
    const toDir = path.join(cyclesRoot, mapping.new_slug);
    renamedDirectories.push({
      from: normalizePath(path.relative(absoluteTargetRoot, fromDir)),
      to: normalizePath(path.relative(absoluteTargetRoot, toDir)),
    });
    if (write) {
      fs.renameSync(fromDir, toDir);
    }
  }

  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    write_requested: Boolean(write),
    mappings,
    files_scanned: filesScanned,
    files_updated: filesUpdated,
    updated_files: updatedFiles,
    updated_files_truncated: filesUpdated > updatedFiles.length,
    directories_renamed: renamedDirectories.length,
    renamed_directories: renamedDirectories,
    skipped_binary_files: skippedBinaryFiles,
    skipped_binary_files_count: skippedBinaryFilesCount,
    skipped_binary_files_truncated: skippedBinaryFilesCount > skippedBinaryFiles.length,
  };
}
