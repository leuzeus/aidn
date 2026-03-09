#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-state-projector-repair-fixtures.mjs");
}

function runJson(script, args) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function seedHydratedContext(targetRoot, payload) {
  const hydratedFile = path.join(targetRoot, ".aidn", "runtime", "context", "hydrated-context.json");
  writeJson(hydratedFile, payload);
  return hydratedFile;
}

function verifyScenario(tempRoot, name, payload, expectations) {
  const repo = path.join(tempRoot, name);
  fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/repo-installed-core"), repo, { recursive: true });
  seedHydratedContext(repo, payload);
  const outFile = path.join(repo, "docs", "audit", "RUNTIME-STATE.md");
  const result = runJson("tools/runtime/project-runtime-state.mjs", [
    "--target",
    repo,
    "--json",
  ]);
  const markdown = fs.readFileSync(outFile, "utf8");
  assert(markdown.includes(`repair_layer_status: ${expectations.status}`), `${name}: status missing`);
  assert(markdown.includes(`repair_layer_advice: ${expectations.advice}`), `${name}: advice missing`);
  assert(markdown.includes(expectations.findingLine), `${name}: finding line missing`);
  assert(result?.digest?.repair_layer_status === expectations.status, `${name}: digest status mismatch`);
  assert(result?.digest?.repair_layer_advice === expectations.advice, `${name}: digest advice mismatch`);
  if (expectations.blockingLine) {
    assert(markdown.includes(expectations.blockingLine), `${name}: blocking line missing`);
  }
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-state-repair-"));
    verifyScenario(tempRoot, "warn", {
      ts: "2026-03-09T02:00:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [],
      repair_layer: {
        status: "warn",
        advice: "Review open repair findings, starting with branch_cycle_mismatch.",
        blocking: false,
        top_findings: [
          {
            severity: "warning",
            finding_type: "branch_cycle_mismatch",
            entity_id: "C101",
            message: "Active branch and cycle mapping disagree",
          },
        ],
      },
      artifacts: [
        { path: "cycles/C101-feature-alpha/status.md" },
      ],
    }, {
      status: "warn",
      advice: "Review open repair findings, starting with branch_cycle_mismatch.",
      findingLine: "- warning: branch_cycle_mismatch: C101: Active branch and cycle mapping disagree",
    });

    verifyScenario(tempRoot, "block", {
      ts: "2026-03-09T02:05:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [],
      repair_layer: {
        status: "block",
        advice: "Resolve blocking repair findings before continuing db-backed execution.",
        blocking: true,
        top_findings: [
          {
            severity: "error",
            finding_type: "orphan_cycle_status",
            entity_id: "C202",
            message: "Cycle status has no reachable session continuity",
          },
        ],
      },
      artifacts: [
        { path: "cycles/C202-bugfix-bridge/status.md" },
      ],
    }, {
      status: "block",
      advice: "Resolve blocking repair findings before continuing db-backed execution.",
      findingLine: "- error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
      blockingLine: "- error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
    });

    console.log("PASS");
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
