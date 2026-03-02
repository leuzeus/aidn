#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isJsonEquivalent, writeJsonIfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    minCoverageMarkdown: 0.8,
    minCanonicalArtifacts: 1,
    minMarkdownArtifacts: 1,
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
    } else if (token === "--min-coverage-markdown") {
      args.minCoverageMarkdown = Number(argv[i + 1] ?? "0.8");
      i += 1;
    } else if (token === "--min-canonical-artifacts") {
      args.minCanonicalArtifacts = Number(argv[i + 1] ?? "1");
      i += 1;
    } else if (token === "--min-markdown-artifacts") {
      args.minMarkdownArtifacts = Number(argv[i + 1] ?? "1");
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
  console.log("  node tools/perf/check-index-canonical-coverage.mjs --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite --min-coverage-markdown 0.8");
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
    const query = runIndexQuery(args);
    const row = Array.isArray(query?.rows) && query.rows.length > 0 ? query.rows[0] : null;
    if (!row) {
      throw new Error("canonical-coverage query returned no rows");
    }

    const checks = evaluateChecks(row, args);
    const summary = summarizeChecks(checks, args.strict);
    const payload = {
      ts: new Date().toISOString(),
      strict: args.strict,
      index_file: query.source_index ?? null,
      backend: query.backend ?? args.backend,
      query: query.query ?? "canonical-coverage",
      coverage: row,
      thresholds: {
        min_coverage_markdown: args.minCoverageMarkdown,
        min_canonical_artifacts: args.minCanonicalArtifacts,
        min_markdown_artifacts: args.minMarkdownArtifacts,
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
