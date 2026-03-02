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
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs --tmp-root tests/fixtures");
  console.log("  node tools/perf/verify-db-only-hooks-fixtures.mjs --keep-tmp");
}

function copyFixtureToTmp(source, tmpRoot) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `tmp-db-only-hooks-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
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

function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed line
    }
  }
  return out;
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

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    const start = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-start",
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--json",
    ], env);

    const close = runJson("tools/perf/workflow-hook.mjs", [
      "--phase",
      "session-close",
      "--target",
      tmpTarget,
      "--mode",
      "COMMITTING",
      "--index-store",
      "sqlite",
      "--json",
    ], env);

    const sqlitePath = path.resolve(tmpTarget, ".aidn/runtime/index/workflow-index.sqlite");
    const eventsPath = path.resolve(tmpTarget, ".aidn/runtime/perf/workflow-events.ndjson");
    const events = readNdjson(eventsPath);

    const runId = String(start?.run_id ?? "");
    const runEvents = events.filter((event) => String(event?.run_id ?? "") === runId);
    const hasStartEvent = runEvents.some((event) => String(event?.event ?? "") === "hook_session_start");
    const hasCloseEvent = runEvents.some((event) => String(event?.event ?? "") === "hook_session_close");

    const checks = {
      start_ok: String(start?.result ?? "") === "ok",
      close_ok: String(close?.result ?? "") === "ok",
      run_id_stable: runId.length > 0 && runId === String(close?.run_id ?? ""),
      sqlite_exists: fs.existsSync(sqlitePath),
      checkpoint_start_state_mode_db_only: String(start?.checkpoint?.state_mode ?? "") === "db-only",
      checkpoint_close_state_mode_db_only: String(close?.checkpoint?.state_mode ?? "") === "db-only",
      checkpoint_close_gate_action_set: String(close?.checkpoint?.gate?.action ?? "").length > 0,
      events_file_exists: fs.existsSync(eventsPath),
      events_has_start: hasStartEvent,
      events_has_close: hasCloseEvent,
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: tmpTarget,
      checks,
      samples: {
        run_id: runId,
        start_gate_action: start?.checkpoint?.gate?.action ?? null,
        close_gate_action: close?.checkpoint?.gate?.action ?? null,
        close_gate_result: close?.checkpoint?.gate?.result ?? null,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.source_target}`);
      console.log(`Working copy: ${output.target_root}`);
      console.log(`Start hook: ${checks.start_ok ? "PASS" : "FAIL"}`);
      console.log(`Close hook: ${checks.close_ok ? "PASS" : "FAIL"}`);
      console.log(`Run id stable: ${checks.run_id_stable ? "yes" : "no"}`);
      console.log(`SQLite exists: ${checks.sqlite_exists ? "yes" : "no"}`);
      console.log(`Events start/close: ${checks.events_has_start && checks.events_has_close ? "yes" : "no"}`);
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
