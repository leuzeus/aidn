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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-artifact-store-cli-"));
    const repoRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/repo-installed-core"), repoRoot, { recursive: true });
    const sqliteFile = path.join(repoRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const sourceFile = path.join(repoRoot, "docs", "audit", "snapshots", "context-snapshot.md");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "# Context Snapshot\n\nhello\n", "utf8");

    const list = runJson(["runtime", "artifact-store", "list", "--sqlite-file", sqliteFile, "--json"]);
    assert(list.action === "list", "artifact-store list should expose action");
    assert(list.artifact_store_diagnostic?.scope === "runtime-artifact-store-list", "artifact-store list should expose diagnostic scope");

    const upsert = runJson([
      "runtime",
      "artifact-store",
      "upsert",
      "--sqlite-file",
      sqliteFile,
      "--path",
      "snapshots/context-snapshot.md",
      "--kind",
      "snapshot",
      "--family",
      "normative",
      "--content-file",
      sourceFile,
      "--json",
    ]);
    assert(upsert.action === "upsert", "artifact-store upsert should expose action");
    assert(upsert.artifact_store_diagnostic?.scope === "runtime-artifact-store-upsert", "artifact-store upsert should expose diagnostic scope");

    const get = runJson([
      "runtime",
      "artifact-store",
      "get",
      "--sqlite-file",
      sqliteFile,
      "--path",
      "snapshots/context-snapshot.md",
      "--json",
    ]);
    assert(get.action === "get", "artifact-store get should expose action");
    assert(get.artifact?.path === "snapshots/context-snapshot.md", "artifact-store get should load the stored artifact");
    assert(get.artifact_store_diagnostic?.scope === "runtime-artifact-store-get", "artifact-store get should expose diagnostic scope");

    const materialize = runJson([
      "runtime",
      "artifact-store",
      "materialize",
      "--sqlite-file",
      sqliteFile,
      "--audit-root",
      "docs/audit",
      "--only-path",
      "snapshots/context-snapshot.md",
      "--dry-run",
      "--json",
    ]);
    assert(materialize.action === "materialize", "artifact-store materialize should expose action");
    assert(materialize.artifact_store_diagnostic?.scope === "runtime-artifact-store-materialize", "artifact-store materialize should expose diagnostic scope");
    assert(materialize.artifact_store_diagnostic?.dry_run === true, "artifact-store materialize should expose dry-run diagnostic");

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
