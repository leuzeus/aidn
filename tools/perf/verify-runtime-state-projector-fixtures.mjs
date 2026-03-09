#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-state-projector-fixtures.mjs");
}

function runJson(script, args) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const fixture = "tests/fixtures/repo-installed-core";
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-state-"));
    const outFile = path.join(tempRoot, "RUNTIME-STATE.md");

    const result = runJson("tools/runtime/project-runtime-state.mjs", [
      "--target", fixture,
      "--out", outFile,
      "--json",
    ]);

    const markdown = fs.readFileSync(outFile, "utf8");
    assert(result?.digest?.runtime_state_mode, "digest.runtime_state_mode missing");
    assert(result?.digest?.repair_layer_status, "digest.repair_layer_status missing");
    assert(result?.digest?.current_state_freshness, "digest.current_state_freshness missing");
    assert(Array.isArray(result?.digest?.prioritized_artifacts), "digest.prioritized_artifacts missing");
    assert(result.digest.prioritized_artifacts.includes("docs/audit/CURRENT-STATE.md"), "digest missing CURRENT-STATE.md");
    assert(!markdown.includes("docs/audit/cycles/none-*/status.md"), "digest leaked none cycle path");
    assert(!markdown.includes("docs/audit/sessions/none*.md"), "digest leaked none session path");
    assert(markdown.includes("current_state_freshness: unknown"), "expected unknown freshness for empty installed fixture");
    const textOut = execFileSync(process.execPath, [
      "tools/runtime/project-runtime-state.mjs",
      "--target", fixture,
      "--out", outFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert(textOut.includes("Runtime state digest:"), "text mode missing digest line");
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
