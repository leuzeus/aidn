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
  console.log("  node tools/perf/verify-repair-layer-autofix-fixtures.mjs");
}

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
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-repair-autofix-"));
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

    const indexFile = path.join(target, ".aidn/runtime/index/workflow-index.sqlite");
    const indexFileArg = path.relative(process.cwd(), indexFile);
    const triageBefore = runJson("tools/runtime/repair-layer-triage.mjs", [
      "--target",
      target,
      "--index-file",
      indexFileArg,
      "--backend",
      "sqlite",
      "--json",
    ]);
    const autofix = runJson("tools/runtime/repair-layer-autofix.mjs", [
      "--target",
      target,
      "--index-file",
      indexFileArg,
      "--index-backend",
      "sqlite",
      "--apply",
      "--json",
    ]);
    const triageAfter = runJson("tools/runtime/repair-layer-triage.mjs", [
      "--target",
      target,
      "--index-file",
      indexFileArg,
      "--backend",
      "sqlite",
      "--json",
    ]);

    const ambiguousBefore = Array.isArray(triageBefore?.items)
      ? triageBefore.items.find((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION")
      : null;

    const checks = {
      triage_before_has_open_finding: Number(triageBefore?.summary?.open_findings_count ?? 0) >= 1,
      triage_before_has_autofix_step: Array.isArray(ambiguousBefore?.next_steps)
        && ambiguousBefore.next_steps.some((step) => String(step?.kind ?? "") === "autofix_safe_only"),
      autofix_applied: String(autofix?.action ?? "") === "applied",
      autofix_created_decision: Number(autofix?.summary?.decisions_count ?? 0) >= 1,
      autofix_reduces_open_findings: Number(autofix?.summary?.open_findings_after ?? -1) < Number(autofix?.summary?.open_findings_before ?? -1),
      triage_after_is_clean: Number(triageAfter?.summary?.open_findings_count ?? -1) === 0,
    };

    const carryTarget = path.join(tempRoot, "repo-carry");
    fs.cpSync(sourceTarget, carryTarget, { recursive: true });
    fs.rmSync(path.join(carryTarget, ".aidn"), { recursive: true, force: true });
    const carrySessionFile = path.join(carryTarget, "docs", "audit", "sessions", "S102-ambiguous.md");
    const carrySessionContent = fs.readFileSync(carrySessionFile, "utf8")
      .replace("- integration_target_cycle: `C102`", "- integration_target_cycle: `none`");
    fs.writeFileSync(carrySessionFile, carrySessionContent, "utf8");

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      carryTarget,
      "--store",
      "sqlite",
      "--json",
    ]);
    const carryIndexFile = path.join(carryTarget, ".aidn/runtime/index/workflow-index.sqlite");
    const carryIndexFileArg = path.relative(process.cwd(), carryIndexFile);
    const carryAutofix = runJson("tools/runtime/repair-layer-autofix.mjs", [
      "--target",
      carryTarget,
      "--index-file",
      carryIndexFileArg,
      "--index-backend",
      "sqlite",
      "--apply",
      "--json",
    ]);

    checks.carry_over_autofix_applied = String(carryAutofix?.action ?? "") === "applied";
    checks.carry_over_anchor_reason = Array.isArray(carryAutofix?.suggestions)
      && carryAutofix.suggestions.some((row) => String(row?.anchor_reason ?? "") === "parent_carry_over_cycle");
    checks.carry_over_autofix_reduces_open_findings = Number(carryAutofix?.summary?.open_findings_after ?? -1) < Number(carryAutofix?.summary?.open_findings_before ?? -1);
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        triage_before: triageBefore?.summary ?? null,
        autofix: autofix?.summary ?? null,
        triage_after: triageAfter?.summary ?? null,
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
