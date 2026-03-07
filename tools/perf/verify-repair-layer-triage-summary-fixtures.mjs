#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-repair-layer-triage-summary-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function run(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  return execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-repair-triage-summary-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);

    const triageFile = path.join(target, ".aidn/runtime/index/repair-layer-triage.json");
    const summaryFile = path.join(target, ".aidn/runtime/index/repair-layer-triage-summary.md");
    const triage = runJson("tools/runtime/repair-layer-triage.mjs", [
      "--target",
      target,
      "--index-file",
      ".aidn/runtime/index/workflow-index.sqlite",
      "--backend",
      "sqlite",
      "--json",
    ]);
    fs.mkdirSync(path.dirname(triageFile), { recursive: true });
    fs.writeFileSync(triageFile, `${JSON.stringify(triage, null, 2)}\n`, "utf8");

    run("tools/perf/render-repair-layer-triage-summary.mjs", [
      "--triage-file",
      triageFile,
      "--out",
      summaryFile,
    ]);

    const markdown = fs.readFileSync(summaryFile, "utf8");
    const checks = {
      summary_written: fs.existsSync(summaryFile),
      contains_header: markdown.includes("## Repair Layer Triage"),
      contains_ambiguous_relation: markdown.includes("AMBIGUOUS_RELATION"),
      contains_query_command: markdown.includes("tools/runtime/repair-layer-query.mjs"),
      contains_resolve_command: markdown.includes("tools/runtime/repair-layer-resolve.mjs"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${sourceTarget}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
