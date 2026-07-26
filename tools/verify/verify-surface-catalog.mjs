#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildSurfaceCatalog,
  INFORMATION_CLASSES,
  PROOF_CLASSES,
  SURFACE_CATALOG_PATH,
  SURFACE_STATUSES,
} from "../governance/surface-catalog-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const requiredFields = [
  "owner",
  "source",
  "entrypoint",
  "implementation",
  "effects",
  "consumer",
  "docs",
  "proof",
  "replacement",
  "migration",
];

function exists(relativePath) {
  return Boolean(relativePath) && fs.existsSync(path.resolve(repoRoot, relativePath));
}

function commandReferenceIssues(catalog) {
  const issues = [];
  const commands = new Set(
    catalog.entries
      .filter((entry) => entry.kind === "command" && entry.status === "active")
      .map((entry) => entry.entrypoint),
  );
  const knownTopCommands = new Set([...commands].map((command) => command.split(" ").slice(0, 2).join(" ")));
  const groupedTopCommands = new Set(["aidn perf", "aidn codex", "aidn runtime", "aidn project"]);
  for (const relativeDoc of catalog.public_docs) {
    const text = fs.readFileSync(path.join(repoRoot, relativeDoc), "utf8");
    for (const match of text.matchAll(/(?:npx\s+)?aidn\s+([a-z0-9-]+)(?:\s+([a-z0-9-]+))?/g)) {
      const top = `aidn ${match[1]}`;
      if (!knownTopCommands.has(top)) {
        continue;
      }
      const family = groupedTopCommands.has(top) && match[2] && !match[2].startsWith("-")
        ? `${top} ${match[2]}`
        : top;
      if (![...commands].some((command) => command === family || command.startsWith(`${family} `))) {
        issues.push(`${relativeDoc}: public command reference has no active target: ${family}`);
      }
    }
  }
  return issues;
}

function main() {
  const catalogPath = path.join(repoRoot, SURFACE_CATALOG_PATH);
  const issues = [];
  if (!fs.existsSync(catalogPath)) {
    issues.push(`missing catalog: ${SURFACE_CATALOG_PATH}`);
  }
  const actual = fs.existsSync(catalogPath)
    ? JSON.parse(fs.readFileSync(catalogPath, "utf8"))
    : { entries: [], public_docs: [] };
  const expected = buildSurfaceCatalog(repoRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`catalog drift: run node tools/governance/generate-surface-catalog.mjs --write`);
  }
  const seen = new Set();
  for (const entry of actual.entries ?? []) {
    if (seen.has(entry.id)) {
      issues.push(`${entry.id}: duplicate id`);
    }
    seen.add(entry.id);
    if (!SURFACE_STATUSES.includes(entry.status)) {
      issues.push(`${entry.id}: invalid status ${entry.status}`);
    }
    if (!INFORMATION_CLASSES.includes(entry.information_class)) {
      issues.push(`${entry.id}: invalid information_class ${entry.information_class}`);
    }
    for (const field of requiredFields) {
      if (!(field in entry)) {
        issues.push(`${entry.id}: missing ${field}`);
      }
    }
    if (!PROOF_CLASSES.includes(entry.proof?.class)) {
      issues.push(`${entry.id}: invalid proof class ${entry.proof?.class}`);
    }
    if (!exists(entry.docs)) {
      issues.push(`${entry.id}: docs target missing: ${entry.docs}`);
    }
    if (!exists(entry.proof?.target) || !exists(entry.proof?.gate)) {
      issues.push(`${entry.id}: proof target or gate missing`);
    }
    if (entry.status === "active" && !exists(entry.implementation)) {
      issues.push(`${entry.id}: active implementation missing: ${entry.implementation}`);
    }
    if (["deprecated", "replaced", "removed"].includes(entry.status)
      && (!entry.replacement || !entry.migration)) {
      issues.push(`${entry.id}: non-active surface requires replacement and migration`);
    }
  }
  issues.push(...commandReferenceIssues(actual));
  const byKind = {};
  for (const entry of actual.entries ?? []) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  const result = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "PASS" : "FAIL",
    catalog: SURFACE_CATALOG_PATH,
    entries: actual.entries?.length ?? 0,
    by_kind: byKind,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main();
