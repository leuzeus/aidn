#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer-session/workflow-index.sqlite",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-repair-layer-hydration-fixtures.mjs");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(process.cwd(), args.target);
    const sqliteFile = resolveTargetPath(target, args.sqliteFile);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
      "--json",
    ]);

    const strict = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--json",
    ]);

    const relaxed = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFile,
      "--backend",
      "sqlite",
      "--allow-ambiguous-links",
      "--relation-threshold",
      "attached_cycle=0.35",
      "--json",
    ]);

    const strictArtifacts = Array.isArray(strict.artifacts) ? strict.artifacts : [];
    const relaxedArtifacts = Array.isArray(relaxed.artifacts) ? relaxed.artifacts : [];
    const strictS102 = strictArtifacts.find((artifact) => String(artifact?.session_id ?? "") === "S102") ?? null;
    const strictS101 = strictArtifacts.find((artifact) => String(artifact?.session_id ?? "") === "S101") ?? null;
    const strictRepair = strict.repair_layer?.relation_evaluation ?? {};
    const relaxedRepair = relaxed.repair_layer?.relation_evaluation ?? {};

    const checks = {
      strict_rejects_ambiguous: Number(strictRepair.rejected_by_reason?.ambiguous_disabled ?? 0) > 0,
      strict_has_no_accepted_ambiguous_sample: !Array.isArray(strictRepair.accepted_samples)
        || !strictRepair.accepted_samples.some((sample) => String(sample?.session_id ?? "") === "S102" && String(sample?.source_mode ?? "") === "ambiguous"),
      strict_s102_selected_via_explicit_continuity: Array.isArray(strictS102?.selection_reasons)
        && strictS102.selection_reasons.includes("related_session"),
      strict_s101_has_continuity_reason: Array.isArray(strictS101?.selection_reasons)
        && strictS101.selection_reasons.includes("continuity_session"),
      relaxed_accepts_attached_cycle: Number(relaxedRepair.accepted_by_type?.attached_cycle ?? 0) > Number(strictRepair.accepted_by_type?.attached_cycle ?? 0),
      relaxed_selects_s102: relaxedArtifacts.some((artifact) => String(artifact?.session_id ?? "") === "S102"),
      relaxed_has_accepted_ambiguous_sample: Array.isArray(relaxedRepair.accepted_samples)
        && relaxedRepair.accepted_samples.some((sample) => String(sample?.session_id ?? "") === "S102" && String(sample?.source_mode ?? "") === "ambiguous"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      checks,
      strict: {
        artifact_paths: strictArtifacts.map((artifact) => artifact.path),
        repair_layer: strictRepair,
      },
      relaxed: {
        artifact_paths: relaxedArtifacts.map((artifact) => artifact.path),
        repair_layer: relaxedRepair,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${target}`);
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
  }
}

main();
