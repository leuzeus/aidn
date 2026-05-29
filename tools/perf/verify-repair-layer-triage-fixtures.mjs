#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

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
  console.log("  node tools/perf/verify-repair-layer-triage-fixtures.mjs");
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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-repair-triage-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    const sqliteFileArg = path.relative(process.cwd(), path.join(target, ".aidn/runtime/index/workflow-index.sqlite"));

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);

    const triage = runJson("tools/runtime/repair-layer-triage.mjs", [
      "--target",
      target,
      "--index-file",
      sqliteFileArg,
      "--backend",
      "sqlite",
      "--json",
    ]);

    const ambiguous = Array.isArray(triage?.items)
      ? triage.items.find((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION")
      : null;

    const checks = {
      open_findings_present: Number(triage?.summary?.open_findings_count ?? 0) >= 1,
      actionable_items_present: Number(triage?.summary?.actionable_count ?? 0) >= 1,
      ambiguous_item_present: ambiguous != null,
      ambiguous_query_present: Array.isArray(ambiguous?.next_steps)
        && ambiguous.next_steps.some((step) => String(step?.kind ?? "") === "query"),
      ambiguous_resolve_present: Array.isArray(ambiguous?.next_steps)
        && ambiguous.next_steps.some((step) => String(step?.kind ?? "") === "resolve"),
      ambiguous_accept_command_present: Array.isArray(ambiguous?.next_steps)
        && ambiguous.next_steps.some((step) =>
          Array.isArray(step?.commands) && step.commands.some((cmd) => String(cmd?.accept ?? "").includes("--decision accepted"))
        ),
      ambiguous_autofix_present: Array.isArray(ambiguous?.next_steps)
        && ambiguous.next_steps.some((step) => String(step?.kind ?? "") === "autofix_safe_only"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        summary: triage?.summary ?? null,
        ambiguous: ambiguous ?? null,
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
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
