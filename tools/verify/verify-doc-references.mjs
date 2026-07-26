#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HISTORICAL_DOC_NAME = /^(?:PLAN|BACKLOG|TEMPLATE)_/;

function posix(value) {
  return String(value).replaceAll("\\", "/");
}

function trackedMarkdownFiles(repoRoot) {
  const result = spawnSync("git", ["ls-files", "*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function classifyMarkdown(relativePath) {
  const normalized = posix(relativePath);
  if (normalized.startsWith("tests/fixtures/") || normalized.startsWith("scaffold/")) {
    return "derived-corpus";
  }
  if (normalized.startsWith("docs/")
    && HISTORICAL_DOC_NAME.test(path.posix.basename(normalized))) {
    return "historical";
  }
  return "active";
}

function normalizeLinkTarget(rawTarget) {
  let target = String(rawTarget ?? "").trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  if (!target || target.startsWith("#") || /^(?:https?:|mailto:|data:)/i.test(target)) {
    return "";
  }
  target = target.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function markdownLinkTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    targets.push(match[1]);
  }
  for (const match of text.matchAll(/^\s*\[[^\]]+]:\s*(\S+)/gm)) {
    targets.push(match[1]);
  }
  return targets;
}

function npmRunReferences(text) {
  return [...text.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_*-]+)/g)]
    .map((match) => match[1])
    .filter((name) => !name.includes("*"));
}

export function validateDocReferences({
  repoRoot,
  markdownFiles,
  packageScripts,
}) {
  const issues = [];
  const classifications = {
    active: 0,
    historical: 0,
    "derived-corpus": 0,
  };
  let localLinks = 0;
  let npmScripts = 0;
  for (const relativePath of markdownFiles) {
    const classification = classifyMarkdown(relativePath);
    classifications[classification] += 1;
    if (classification !== "active") {
      continue;
    }
    const absolutePath = path.resolve(repoRoot, relativePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const rawTarget of markdownLinkTargets(text)) {
      const target = normalizeLinkTarget(rawTarget);
      if (!target) {
        continue;
      }
      localLinks += 1;
      const resolved = path.resolve(path.dirname(absolutePath), target);
      if (!fs.existsSync(resolved)) {
        issues.push({
          code: "DOC_LOCAL_LINK_MISSING",
          document: posix(relativePath),
          reference: target,
        });
      }
    }
    for (const script of npmRunReferences(text)) {
      npmScripts += 1;
      if (!Object.prototype.hasOwnProperty.call(packageScripts, script)) {
        issues.push({
          code: "DOC_NPM_SCRIPT_MISSING",
          document: posix(relativePath),
          reference: script,
        });
      }
    }
  }
  return {
    classifications,
    local_links_checked: localLinks,
    npm_scripts_checked: npmScripts,
    issues,
  };
}

function runNegativeProbes() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-doc-reference-probes-"));
  try {
    fs.writeFileSync(path.join(tempRoot, "probe.md"), [
      "# Probe",
      "",
      "[missing](./does-not-exist.md)",
      "",
      "`npm run perf:missing-script`",
      "",
    ].join("\n"), "utf8");
    const result = validateDocReferences({
      repoRoot: tempRoot,
      markdownFiles: ["probe.md"],
      packageScripts: {},
    });
    const codes = new Set(result.issues.map((issue) => issue.code));
    return {
      ok: codes.has("DOC_LOCAL_LINK_MISSING") && codes.has("DOC_NPM_SCRIPT_MISSING"),
      broken_link_rejected: codes.has("DOC_LOCAL_LINK_MISSING"),
      missing_npm_script_rejected: codes.has("DOC_NPM_SCRIPT_MISSING"),
    };
  } finally {
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok) {
      throw cleanup.error;
    }
  }
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const verification = validateDocReferences({
    repoRoot: REPO_ROOT,
    markdownFiles: trackedMarkdownFiles(REPO_ROOT),
    packageScripts: packageJson.scripts ?? {},
  });
  const negativeProbes = runNegativeProbes();
  const issues = [
    ...verification.issues,
    ...(!negativeProbes.ok ? [{
      code: "DOC_NEGATIVE_PROBE_FAILED",
      document: "synthetic",
      reference: "link-or-script",
    }] : []),
  ];
  const output = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "PASS" : "FAIL",
    ...verification,
    negative_probes: negativeProbes,
    issues,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exitCode = 1;
  }
}

main();
