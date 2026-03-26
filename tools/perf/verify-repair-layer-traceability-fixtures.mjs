#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
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
  console.log("  node tools/perf/verify-repair-layer-traceability-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runGit(target, args) {
  execFileSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function rewriteSnapshot(snapshotFile) {
  writeUtf8(snapshotFile, [
    "# Context Snapshot",
    "",
    "- active_session: S201",
    "- active_cycles: C901 C902",
    "- referenced_cycles: C901, C902",
    "",
  ].join("\n"));
}

function writeCycleStatus(filePath, cycleId) {
  writeUtf8(filePath, [
    `# ${cycleId} Status`,
    "",
    "state: IN_PROGRESS",
    "outcome: pending",
    "branch_name: feature/test-traceability",
    "session_owner: S201",
    "",
  ].join("\n"));
}

function stripRepairLayerMeta(indexFile) {
  const payload = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  delete payload.repair_layer_meta;
  fs.writeFileSync(indexFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-repair-traceability-"));
    const target = copyFixtureToTmp(sourceTarget, tempRoot, "repo");
    initGitRepo(target);

    const snapshotFile = path.join(target, "docs", "audit", "snapshots", "context-snapshot.md");
    rewriteSnapshot(snapshotFile);
    runGit(target, ["add", "docs/audit/snapshots/context-snapshot.md"]);
    runGit(target, ["commit", "-m", "snapshot fixture"]);

    const indexFile = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "file",
      "--output",
      indexFile,
      "--json",
    ]);

    const untrackedStatus = path.join(target, "docs", "audit", "cycles", "C901-local-only", "status.md");
    const trackedStatus = path.join(target, "docs", "audit", "cycles", "C902-tracked-late", "status.md");
    writeCycleStatus(untrackedStatus, "C901");
    writeCycleStatus(trackedStatus, "C902");
    runGit(target, ["add", "docs/audit/cycles/C902-tracked-late/status.md"]);
    runGit(target, ["commit", "-m", "tracked late cycle"]);

    stripRepairLayerMeta(indexFile);

    runJson("tools/runtime/repair-layer.mjs", [
      "--target",
      target,
      "--index-file",
      indexFile,
      "--index-backend",
      "json",
      "--apply",
      "--json",
    ]);

    const triage = runJson("tools/runtime/repair-layer-triage.mjs", [
      "--target",
      target,
      "--index-file",
      indexFile,
      "--backend",
      "json",
      "--json",
    ]);

    const items = Array.isArray(triage?.items) ? triage.items : [];
    const untracked = items.find((row) => String(row?.referenced_cycle_id ?? "") === "C901");
    const trackedNotIndexed = items.find((row) => String(row?.referenced_cycle_id ?? "") === "C902");

    const checks = {
      untracked_item_present: untracked != null,
      untracked_type_correct: String(untracked?.finding_type ?? "") === "UNTRACKED_CYCLE_STATUS_REFERENCE",
      untracked_resolution_correct: String(untracked?.reference_resolution_state ?? "") === "present_local_untracked",
      untracked_path_present: String(untracked?.local_artifact_path ?? "") === "cycles/C901-local-only/status.md",
      tracked_item_present: trackedNotIndexed != null,
      tracked_type_correct: String(trackedNotIndexed?.finding_type ?? "") === "UNINDEXED_CYCLE_STATUS_REFERENCE",
      tracked_resolution_correct: String(trackedNotIndexed?.reference_resolution_state ?? "") === "tracked_not_indexed",
      tracked_git_state_correct: String(trackedNotIndexed?.git_tracking ?? "") === "tracked",
      tracked_refresh_step_present: Array.isArray(trackedNotIndexed?.next_steps)
        && trackedNotIndexed.next_steps.some((step) => String(step?.kind ?? "") === "refresh_index"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      index_file: indexFile,
      checks,
      samples: {
        untracked: untracked ?? null,
        tracked_not_indexed: trackedNotIndexed ?? null,
        summary: triage?.summary ?? null,
      },
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
      removePathWithRetry(tempRoot);
    }
  }
}

main();
