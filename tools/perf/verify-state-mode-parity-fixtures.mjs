#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--tmp-root") {
      args.tmpRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.tmpRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-state-mode-parity-fixtures.mjs");
  console.log("  node tools/perf/verify-state-mode-parity-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-state-mode-parity-fixtures.mjs --tmp-root tests/fixtures");
  console.log("  node tools/perf/verify-state-mode-parity-fixtures.mjs --keep-tmp");
}

function runJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stableArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...values].map((value) => String(value)).sort((a, b) => a.localeCompare(b));
}

function sameArray(left, right) {
  const a = stableArray(left);
  const b = stableArray(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function copyFixtureToTmp(source, tmpRoot) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `tmp-state-mode-parity-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

function runMode(targetRoot, mode, indexSqlitePath) {
  const cachePath = resolveTargetPath(targetRoot, `.aidn/runtime/cache/reload-state-${mode}.json`);
  const eventPath = resolveTargetPath(targetRoot, `.aidn/runtime/perf/workflow-events-${mode}.ndjson`);
  const reloadArgs = [
    "--target",
    targetRoot,
    "--cache",
    cachePath,
    "--state-mode",
    mode,
  ];
  if (mode !== "files") {
    reloadArgs.push(
      "--index-file",
      indexSqlitePath,
      "--index-backend",
      "sqlite",
    );
  }
  const reload = runJson("tools/perf/reload-check.mjs", [
    ...reloadArgs,
    "--write-cache",
    "--json",
  ]);
  const gate = runJson("tools/perf/gating-evaluate.mjs", [
    "--target",
    targetRoot,
    "--cache",
    cachePath,
    "--event-file",
    eventPath,
    "--mode",
    "COMMITTING",
    "--state-mode",
    mode,
    "--index-file",
    indexSqlitePath,
    "--index-backend",
    "sqlite",
    "--json",
  ]);
  return { reload, gate };
}

function main() {
  let tmpTarget = null;
  let keepTmp = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const sourceTarget = path.resolve(process.cwd(), args.target);
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    tmpTarget = copyFixtureToTmp(sourceTarget, tmpRoot);

    const indexJsonPath = resolveTargetPath(tmpTarget, ".aidn/runtime/index/workflow-index.json");
    const indexSqlitePath = resolveTargetPath(tmpTarget, ".aidn/runtime/index/workflow-index.sqlite");

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      tmpTarget,
      "--store",
      "dual-sqlite",
      "--with-content",
      "--output",
      indexJsonPath,
      "--sqlite-output",
      indexSqlitePath,
    ]);

    const filesMode = runMode(tmpTarget, "files", indexSqlitePath);
    const dualMode = runMode(tmpTarget, "dual", indexSqlitePath);
    const dbOnlyMode = runMode(tmpTarget, "db-only", indexSqlitePath);

    const checks = {
      reload_decision_dual_db_only: dualMode.reload.decision === dbOnlyMode.reload.decision,
      reload_reason_codes_dual_db_only: sameArray(dualMode.reload.reason_codes, dbOnlyMode.reload.reason_codes),
      reload_mapping_dual_db_only: dualMode.reload.mapping?.kind === dbOnlyMode.reload.mapping?.kind
        && dualMode.reload.mapping?.status === dbOnlyMode.reload.mapping?.status,
      reload_digest_dual_db_only: String(dualMode.reload.reload_digest ?? "") === String(dbOnlyMode.reload.reload_digest ?? ""),
      gate_action_dual_db_only: dualMode.gate.action === dbOnlyMode.gate.action,
      gate_result_dual_db_only: dualMode.gate.result === dbOnlyMode.gate.result,
      gate_reason_code_dual_db_only: String(dualMode.gate.reason_code ?? "") === String(dbOnlyMode.gate.reason_code ?? ""),
      gate_signals_dual_db_only: sameArray(
        dualMode.gate?.levels?.level2?.active_signals,
        dbOnlyMode.gate?.levels?.level2?.active_signals,
      ),
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: tmpTarget,
      checks,
      pass,
      samples: {
        files: {
          reload: {
            decision: filesMode.reload.decision,
            reason_codes: stableArray(filesMode.reload.reason_codes),
          },
          gate: {
            action: filesMode.gate.action,
            result: filesMode.gate.result,
            reason_code: filesMode.gate.reason_code ?? null,
          },
        },
        dual: {
          reload: {
            decision: dualMode.reload.decision,
            reason_codes: stableArray(dualMode.reload.reason_codes),
          },
          gate: {
            action: dualMode.gate.action,
            result: dualMode.gate.result,
            reason_code: dualMode.gate.reason_code ?? null,
          },
        },
        db_only: {
          reload: {
            decision: dbOnlyMode.reload.decision,
            reason_codes: stableArray(dbOnlyMode.reload.reason_codes),
          },
          gate: {
            action: dbOnlyMode.gate.action,
            result: dbOnlyMode.gate.result,
            reason_code: dbOnlyMode.gate.reason_code ?? null,
          },
        },
      },
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.source_target}`);
      console.log(`Working copy: ${output.target_root}`);
      console.log(`Reload parity dual/db-only: ${checks.reload_decision_dual_db_only && checks.reload_reason_codes_dual_db_only && checks.reload_mapping_dual_db_only && checks.reload_digest_dual_db_only ? "PASS" : "FAIL"}`);
      console.log(`Gate parity dual/db-only: ${checks.gate_action_dual_db_only && checks.gate_result_dual_db_only && checks.gate_reason_code_dual_db_only && checks.gate_signals_dual_db_only ? "PASS" : "FAIL"}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!keepTmp) {
      fs.rmSync(tmpTarget, { recursive: true, force: true });
      tmpTarget = null;
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    if (tmpTarget != null && !keepTmp) {
      fs.rmSync(tmpTarget, { recursive: true, force: true });
    }
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
