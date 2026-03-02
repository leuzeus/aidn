#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isJsonEquivalent, writeJsonIfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    targets: "docs/performance/INDEX_TARGETS.json",
    minCoverageMarkdown: 0.8,
    minCanonicalArtifacts: 1,
    minMarkdownArtifacts: 1,
    minCoverageMarkdownExplicit: false,
    minCanonicalArtifactsExplicit: false,
    minMarkdownArtifactsExplicit: false,
    out: ".aidn/runtime/index/index-canonical-check.json",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--targets") {
      args.targets = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--min-coverage-markdown") {
      args.minCoverageMarkdown = Number(argv[i + 1] ?? "0.8");
      args.minCoverageMarkdownExplicit = true;
      i += 1;
    } else if (token === "--min-canonical-artifacts") {
      args.minCanonicalArtifacts = Number(argv[i + 1] ?? "1");
      args.minCanonicalArtifactsExplicit = true;
      i += 1;
    } else if (token === "--min-markdown-artifacts") {
      args.minMarkdownArtifacts = Number(argv[i + 1] ?? "1");
      args.minMarkdownArtifactsExplicit = true;
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!args.targets) {
    throw new Error("Missing value for --targets");
  }
  if (!["auto", "json", "sqlite"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite");
  }
  if (!Number.isFinite(args.minCoverageMarkdown) || args.minCoverageMarkdown < 0 || args.minCoverageMarkdown > 1) {
    throw new Error("Invalid --min-coverage-markdown. Expected number in [0,1].");
  }
  if (!Number.isFinite(args.minCanonicalArtifacts) || args.minCanonicalArtifacts < 0) {
    throw new Error("Invalid --min-canonical-artifacts. Expected number >= 0.");
  }
  if (!Number.isFinite(args.minMarkdownArtifacts) || args.minMarkdownArtifacts < 0) {
    throw new Error("Invalid --min-markdown-artifacts. Expected number >= 0.");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/check-index-canonical-coverage.mjs");
  console.log("  node tools/perf/check-index-canonical-coverage.mjs --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --targets docs/performance/INDEX_TARGETS.json");
  console.log("  node tools/perf/check-index-canonical-coverage.mjs --min-coverage-markdown 0.8 --min-canonical-artifacts 1 --min-markdown-artifacts 1");
  console.log("  node tools/perf/check-index-canonical-coverage.mjs --strict");
}

function runIndexQuery(args) {
  const script = path.resolve(process.cwd(), "tools/perf/index-query.mjs");
  const stdout = execFileSync(process.execPath, [
    script,
    "--index-file",
    args.indexFile,
    "--backend",
    args.backend,
    "--query",
    "canonical-coverage",
    "--json",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function readTargets(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Targets file not found: ${absolute}`);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Targets file invalid JSON: ${error.message}`);
  }
  const rules = Array.isArray(payload?.rules) ? payload.rules : [];
  const byId = new Map();
  for (const rule of rules) {
    const id = String(rule?.id ?? "").trim();
    if (!id) {
      continue;
    }
    byId.set(id, rule);
  }
  return { absolute, byId };
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveThresholds(args, targetsById) {
  const out = {
    minCoverageMarkdown: args.minCoverageMarkdown,
    minCanonicalArtifacts: args.minCanonicalArtifacts,
    minMarkdownArtifacts: args.minMarkdownArtifacts,
  };

  if (!args.minCoverageMarkdownExplicit) {
    const rule = targetsById.get("INDEX_CANONICAL_COVERAGE_MIN");
    const value = toNumberOrNull(rule?.value);
    if (value != null) {
      out.minCoverageMarkdown = value;
    }
  }
  if (!args.minCanonicalArtifactsExplicit) {
    const rule = targetsById.get("INDEX_CANONICAL_ARTIFACTS_MIN");
    const value = toNumberOrNull(rule?.value);
    if (value != null) {
      out.minCanonicalArtifacts = value;
    }
  }
  if (!args.minMarkdownArtifactsExplicit) {
    const rule = targetsById.get("INDEX_ARTIFACTS_MIN");
    const value = toNumberOrNull(rule?.value);
    if (value != null) {
      out.minMarkdownArtifacts = value;
    }
  }

  return out;
}

function evaluateChecks(row, args) {
  const checks = [];
  const coverageMarkdown = Number(row?.canonical_coverage_ratio_markdown ?? 0);
  const canonicalArtifacts = Number(row?.artifacts_with_canonical ?? 0);
  const markdownArtifacts = Number(row?.artifacts_markdown ?? 0);

  checks.push({
    id: "INDEX_CANONICAL_MARKDOWN_COVERAGE_MIN",
    status: coverageMarkdown >= args.minCoverageMarkdown ? "pass" : "fail",
    severity: "warn",
    actual: coverageMarkdown,
    op: ">=",
    expected: args.minCoverageMarkdown,
  });
  checks.push({
    id: "INDEX_CANONICAL_ARTIFACTS_MIN",
    status: canonicalArtifacts >= args.minCanonicalArtifacts ? "pass" : "fail",
    severity: "warn",
    actual: canonicalArtifacts,
    op: ">=",
    expected: args.minCanonicalArtifacts,
  });
  checks.push({
    id: "INDEX_MARKDOWN_ARTIFACTS_MIN",
    status: markdownArtifacts >= args.minMarkdownArtifacts ? "pass" : "fail",
    severity: "warn",
    actual: markdownArtifacts,
    op: ">=",
    expected: args.minMarkdownArtifacts,
  });
  return checks;
}

function summarizeChecks(checks, strict) {
  let pass = 0;
  let fail = 0;
  let blocking = 0;
  for (const check of checks) {
    if (check.status === "pass") {
      pass += 1;
      continue;
    }
    fail += 1;
    if (strict || check.severity === "error") {
      blocking += 1;
    }
  }
  return {
    overall_status: blocking > 0 ? "fail" : (fail > 0 ? "warn" : "pass"),
    pass,
    fail,
    blocking,
  };
}

function writeJson(filePath, payload) {
  return writeJsonIfChanged(filePath, payload, {
    isEquivalent(previousContent) {
      return isJsonEquivalent(previousContent, payload, ["ts"]);
    },
  });
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targets = readTargets(args.targets);
    const resolvedThresholds = resolveThresholds(args, targets.byId);
    const query = runIndexQuery(args);
    const row = Array.isArray(query?.rows) && query.rows.length > 0 ? query.rows[0] : null;
    if (!row) {
      throw new Error("canonical-coverage query returned no rows");
    }

    const checks = evaluateChecks(row, {
      ...args,
      minCoverageMarkdown: resolvedThresholds.minCoverageMarkdown,
      minCanonicalArtifacts: resolvedThresholds.minCanonicalArtifacts,
      minMarkdownArtifacts: resolvedThresholds.minMarkdownArtifacts,
    });
    const summary = summarizeChecks(checks, args.strict);
    const payload = {
      ts: new Date().toISOString(),
      strict: args.strict,
      index_file: query.source_index ?? null,
      backend: query.backend ?? args.backend,
      targets_file: targets.absolute,
      query: query.query ?? "canonical-coverage",
      coverage: row,
      thresholds: {
        min_coverage_markdown: resolvedThresholds.minCoverageMarkdown,
        min_canonical_artifacts: resolvedThresholds.minCanonicalArtifacts,
        min_markdown_artifacts: resolvedThresholds.minMarkdownArtifacts,
      },
      summary,
      checks,
    };
    const outWrite = writeJson(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Index canonical check: ${payload.summary.overall_status.toUpperCase()}`);
      console.log(`Coverage markdown: ${row.canonical_coverage_ratio_markdown}`);
      console.log(`Artifacts with canonical: ${row.artifacts_with_canonical}`);
      console.log(`Markdown artifacts: ${row.artifacts_markdown}`);
      console.log(`Report file: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
    }

    if (summary.blocking > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
