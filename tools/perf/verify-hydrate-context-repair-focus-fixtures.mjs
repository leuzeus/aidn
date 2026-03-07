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
  console.log("  node tools/perf/verify-hydrate-context-repair-focus-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-hydrate-repair-focus-"));
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

    const hydrated = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--index-file",
      ".aidn/runtime/index/workflow-index.sqlite",
      "--backend",
      "sqlite",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });

    const artifacts = Array.isArray(hydrated?.artifacts) ? hydrated.artifacts : [];
    const repairFindingArtifacts = artifacts.filter((artifact) =>
      Array.isArray(artifact?.selection_reasons)
      && artifact.selection_reasons.includes("repair_finding_artifact")
    );
    const repairFindingSession = artifacts.find((artifact) =>
      Array.isArray(artifact?.selection_reasons)
      && artifact.selection_reasons.includes("repair_finding_session")
    ) ?? null;

    const checks = {
      repair_layer_focus_present: Array.isArray(hydrated?.repair_layer?.finding_focus?.artifact_paths)
        && hydrated.repair_layer.finding_focus.artifact_paths.length >= 1,
      repair_layer_focus_session_present: Array.isArray(hydrated?.repair_layer?.finding_focus?.session_ids)
        && hydrated.repair_layer.finding_focus.session_ids.includes("S102"),
      repair_finding_artifact_selected: repairFindingArtifacts.some((artifact) =>
        String(artifact?.path ?? "") === "sessions/S102-ambiguous.md"
      ),
      repair_finding_session_selected: repairFindingSession != null,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        finding_focus: hydrated?.repair_layer?.finding_focus ?? null,
        repair_finding_artifacts: repairFindingArtifacts.slice(0, 3),
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
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
