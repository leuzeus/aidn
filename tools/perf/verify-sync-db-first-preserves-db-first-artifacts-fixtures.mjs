#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/repo-installed-core");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-sync-preserve-db-first-"));
    const workingCopy = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, workingCopy, { recursive: true });
    fs.rmSync(path.join(workingCopy, ".aidn"), { recursive: true, force: true });

    const firstSync = runJson("tools/runtime/sync-db-first.mjs", [
      "--target",
      workingCopy,
      "--state-mode",
      "db-only",
      "--store",
      "sqlite",
      "--json",
    ]);
    const sqliteFile = String(
      firstSync?.payload?.outputs?.find?.((row) => String(row?.backend ?? "").toLowerCase() === "sqlite")?.path
      ?? path.resolve(workingCopy, ".aidn/runtime/index/workflow-index.sqlite"),
    );

    const backlogMarkdown = [
      "# Session Backlog",
      "",
      "session_id: S401",
      "planning_status: promoted",
      "backlog_next_step: validate-db-preservation",
      "",
      "- item: preserve db-only backlog during sync",
      "",
    ].join("\n");
    const backlogSource = path.join(tempRoot, "BL-S401-db-only-preservation.md");
    fs.writeFileSync(backlogSource, backlogMarkdown, "utf8");

    const dbFirstWrite = runJson("tools/runtime/db-first-artifact.mjs", [
      "--target",
      workingCopy,
      "--state-mode",
      "db-only",
      "--sqlite-file",
      sqliteFile,
      "--path",
      "backlog/BL-S401-db-only-preservation.md",
      "--kind",
      "other",
      "--family",
      "support",
      "--content-file",
      backlogSource,
      "--no-materialize",
      "--json",
    ]);

    const backlogOnDisk = path.join(workingCopy, "docs", "audit", "backlog", "BL-S401-db-only-preservation.md");
    const storeBefore = createArtifactStore({ sqliteFile });
    const artifactBefore = storeBefore.getArtifact("backlog/BL-S401-db-only-preservation.md");
    const rebuildableBefore = storeBefore.getArtifact("SPEC.md");
    storeBefore.close();

    const rebuildablePath = path.join(workingCopy, "docs", "audit", "SPEC.md");
    fs.rmSync(rebuildablePath, { force: true });

    const secondSync = runJson("tools/runtime/sync-db-first.mjs", [
      "--target",
      workingCopy,
      "--state-mode",
      "db-only",
      "--store",
      "sqlite",
      "--json",
    ]);

    const storeAfter = createArtifactStore({ sqliteFile });
    const artifactAfter = storeAfter.getArtifact("backlog/BL-S401-db-only-preservation.md");
    const rebuildableAfter = storeAfter.getArtifact("SPEC.md");
    storeAfter.close();

    const checks = {
      first_sync_ok: firstSync.ok === true,
      db_first_write_ok: String(dbFirstWrite?.artifact?.path ?? "") === "backlog/BL-S401-db-only-preservation.md",
      backlog_not_materialized_in_db_only: fs.existsSync(backlogOnDisk) === false,
      artifact_present_before_full_sync: Boolean(artifactBefore),
      rebuildable_artifact_present_before_full_sync: Boolean(rebuildableBefore),
      second_sync_ok: secondSync.ok === true,
      artifact_preserved_after_full_sync: Boolean(artifactAfter),
      artifact_content_preserved_after_full_sync: String(artifactAfter?.content ?? "").includes("preserve db-only backlog during sync"),
      rebuildable_deleted_file_removed_from_db: rebuildableAfter == null,
    };
    const pass = Object.values(checks).every((value) => value === true);

    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      working_copy: workingCopy,
      checks,
      samples: {
        sqlite_file: sqliteFile,
        artifact_before: artifactBefore,
        artifact_after: artifactAfter,
        rebuildable_before: rebuildableBefore,
        rebuildable_after: rebuildableAfter,
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
