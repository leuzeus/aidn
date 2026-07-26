#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AIDN_BIN = path.join(REPO_ROOT, "bin", "aidn.mjs");
const SQLITE_RELATIVE = ".aidn/runtime/index/workflow-index.sqlite";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function digestFile(filePath) {
  return fs.existsSync(filePath)
    ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
    : null;
}

function snapshotTree(root) {
  if (!fs.existsSync(root)) {
    return {};
  }
  const out = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else {
        out[path.relative(root, absolute).replaceAll("\\", "/")] = digestFile(absolute);
      }
    }
  }
  visit(root);
  return out;
}

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [AIDN_BIN, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  assert(result.status === expectStatus, [
    `command exit mismatch: expected ${expectStatus}, got ${String(result.status)}`,
    String(result.stderr || result.stdout).trim(),
  ].filter(Boolean).join("\n"));
  return result;
}

function parseJson(result) {
  return JSON.parse(String(result.stdout ?? "").trim());
}

function verifyPreview(command, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  const before = snapshotTree(targetRoot);
  const payload = parseJson(run([
    "runtime",
    command,
    "--target",
    targetRoot,
    "--json",
  ]));
  const after = snapshotTree(targetRoot);
  assert(JSON.stringify(after) === JSON.stringify(before), `${command} preview changed the target tree`);
  assert(payload.effect_class === "preview", `${command} preview effect_class mismatch`);
  assert(payload.write_requested === false, `${command} preview reported write intent`);
  assert(payload.migration?.preview_only === true, `${command} preview plan missing`);
  assert(payload.migration?.applied_ids?.length === 0, `${command} preview applied migrations`);
  assert(payload.status?.pending_ids?.length === 6, `${command} preview should plan six migrations`);
  return {
    command,
    unchanged: true,
    pending_migrations: payload.status.pending_ids.length,
  };
}

function verifyWrite(command, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  const payload = parseJson(run([
    "runtime",
    command,
    "--target",
    targetRoot,
    "--write",
    "--json",
  ]));
  const sqliteFile = path.join(targetRoot, SQLITE_RELATIVE);
  assert(fs.existsSync(sqliteFile), `${command} --write did not create the SQLite database`);
  assert(fs.statSync(sqliteFile).size > 0, `${command} --write created an empty SQLite database`);
  assert(payload.effect_class === "mutating", `${command} --write effect_class mismatch`);
  assert(payload.write_requested === true, `${command} --write intent missing`);
  assert(payload.migration?.applied_ids?.length === 6, `${command} --write should apply six migrations`);
  assert(payload.status?.pending_ids?.length === 0, `${command} --write left pending migrations`);
  return {
    command,
    sqlite_bytes: fs.statSync(sqliteFile).size,
    applied_migrations: payload.migration.applied_ids.length,
  };
}

function verifyFailureAtomicity(targetRoot) {
  const sqliteFile = path.join(targetRoot, SQLITE_RELATIVE);
  const before = digestFile(sqliteFile);
  const missingSchema = path.join(targetRoot, "missing-schema.sql");
  const failed = run([
    "runtime",
    "db-migrate",
    "--target",
    targetRoot,
    "--schema-file",
    missingSchema,
    "--write",
    "--json",
  ], { expectStatus: 1 });
  assert(String(failed.stderr).includes("Schema file not found"), "failure probe did not reach schema validation");
  assert(digestFile(sqliteFile) === before, "failed migration changed the existing SQLite database");

  const emptyTarget = path.join(path.dirname(targetRoot), "failure-empty");
  fs.mkdirSync(emptyTarget, { recursive: true });
  const emptyBefore = snapshotTree(emptyTarget);
  run([
    "runtime",
    "db-migrate",
    "--target",
    emptyTarget,
    "--schema-file",
    path.join(emptyTarget, "missing-schema.sql"),
    "--write",
    "--json",
  ], { expectStatus: 1 });
  assert(
    JSON.stringify(snapshotTree(emptyTarget)) === JSON.stringify(emptyBefore),
    "failed fresh migration created target artifacts",
  );
  return {
    existing_database_preserved: true,
    fresh_target_preserved: true,
  };
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-migrate-write-boundary-"));
  try {
    const previews = [
      verifyPreview("db-migrate", path.join(tempRoot, "preview-db")),
      verifyPreview("persistence-migrate", path.join(tempRoot, "preview-alias")),
    ];
    const writes = [
      verifyWrite("db-migrate", path.join(tempRoot, "write-db")),
      verifyWrite("persistence-migrate", path.join(tempRoot, "write-alias")),
    ];
    const failureAtomicity = verifyFailureAtomicity(path.join(tempRoot, "write-db"));
    console.log(JSON.stringify({
      ok: true,
      status: "PASS",
      preview: previews,
      write: writes,
      failure_atomicity: failureAtomicity,
      temp_root: "removed",
    }, null, 2));
  } finally {
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok) {
      throw cleanup.error;
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
