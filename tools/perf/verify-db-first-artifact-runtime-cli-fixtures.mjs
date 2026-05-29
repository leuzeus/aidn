#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(args) {
  const stdout = execFileSync(process.execPath, [path.resolve(process.cwd(), "bin/aidn.mjs"), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-first-artifact-cli-"));
    const repoRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/repo-installed-core"), repoRoot, { recursive: true });
    const sourceFile = path.join(repoRoot, "docs", "audit", "snapshots", "context-snapshot.md");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "# Context Snapshot\n\nhello\n", "utf8");

    const result = runJson([
      "runtime",
      "db-first-artifact",
      "--target",
      repoRoot,
      "--path",
      "snapshots/context-snapshot.md",
      "--source-file",
      sourceFile,
      "--kind",
      "snapshot",
      "--family",
      "normative",
      "--json",
    ]);

    assert(result.ok === true, "db-first-artifact should succeed");
    assert(result.db_first_artifact_diagnostic?.scope === "runtime-db-first-artifact", "db-first-artifact should expose diagnostic scope");
    assert(result.db_first_artifact_diagnostic?.artifact_path === "snapshots/context-snapshot.md", "db-first-artifact should expose artifact path diagnostic");
    assert(typeof result.db_first_artifact_diagnostic?.recommended_action === "string", "db-first-artifact should expose recommended action diagnostic");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
