#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    file: "tests/fixtures/repo-installed-core/docs/audit/WORKFLOW.md",
    versionFile: "VERSION",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--version-file") {
      args.versionFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.file || !args.versionFile) {
    throw new Error("Missing required argument values");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-workflow-version.mjs");
  console.log("  node tools/perf/render-workflow-version.mjs --file tests/fixtures/repo-installed-core/docs/audit/WORKFLOW.md --version-file VERSION");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const filePath = path.resolve(process.cwd(), args.file);
    const versionPath = path.resolve(process.cwd(), args.versionFile);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Workflow file not found: ${filePath}`);
    }
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Version file not found: ${versionPath}`);
    }

    const version = String(fs.readFileSync(versionPath, "utf8")).trim();
    if (!version) {
      throw new Error(`Version file is empty: ${versionPath}`);
    }

    const source = String(fs.readFileSync(filePath, "utf8"));
    const next = source.replace(/^(\s*workflow_version:\s*).+$/im, `$1${version}`);
    if (next === source) {
      throw new Error(`workflow_version field not found in: ${filePath}`);
    }

    fs.writeFileSync(filePath, next, "utf8");
    console.log(`Rendered workflow_version=${version} in ${filePath}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
