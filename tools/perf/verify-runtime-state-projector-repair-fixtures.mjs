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

function seedCodexContext(targetRoot, payload) {
  const contextFile = path.join(targetRoot, ".aidn", "runtime", "context", "codex-context.json");
  writeJson(contextFile, payload);
  return contextFile;
}

function verifyScenario(tempRoot, name, payload, expectations, options = {}) {
  const repo = path.join(tempRoot, name);
  fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/repo-installed-core"), repo, { recursive: true });
  seedHydratedContext(repo, payload);
  seedCodexContext(repo, options.contextPayload ?? {
    schema_version: 1,
    target_root: "repo",
    updated_at: "2026-03-09T00:00:00Z",
    latest: {},
  });
  const outFile = path.join(repo, "docs", "audit", "RUNTIME-STATE.md");
  const result = runJson("tools/runtime/project-runtime-state.mjs", [
    "--target",
    repo,
    "--json",
  ]);
  const markdown = fs.readFileSync(outFile, "utf8");
  assert(markdown.includes(`repair_layer_status: ${expectations.status}`), `${name}: status missing`);
  assert(markdown.includes(`repair_layer_advice: ${expectations.advice}`), `${name}: advice missing`);
  assert(markdown.includes(`repair_primary_reason: ${expectations.primaryReason}`), `${name}: primary reason missing`);
  assert(markdown.includes(`repair_routing_hint: ${expectations.routingHint}`), `${name}: routing hint missing`);
  assert(markdown.includes(`repair_routing_reason: ${expectations.routingReason}`), `${name}: routing reason missing`);
  if (expectations.findingLine) {
    assert(markdown.includes(expectations.findingLine), `${name}: finding line missing`);
  }
  if (expectations.noFindingLine) {
    assert(!markdown.includes(expectations.noFindingLine), `${name}: unexpected finding line present`);
  }
  assert(result?.digest?.repair_layer_status === expectations.status, `${name}: digest status mismatch`);
  assert(result?.digest?.repair_layer_advice === expectations.advice, `${name}: digest advice mismatch`);
  assert(result?.digest?.repair_primary_reason === expectations.primaryReason, `${name}: digest primary reason mismatch`);
  assert(result?.digest?.repair_routing_hint === expectations.routingHint, `${name}: digest routing hint mismatch`);
  if (expectations.blockingFindingsLength != null) {
    assert(result?.digest?.blocking_findings?.length === expectations.blockingFindingsLength, `${name}: blocking findings length mismatch`);
  }
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
      primaryReason: "warning: branch_cycle_mismatch: C101: Active branch and cycle mapping disagree",
      routingHint: "audit-first",
      routingReason: "Review open repair findings, starting with branch_cycle_mismatch.",
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
      primaryReason: "error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
      routingHint: "repair",
      routingReason: "blocking repair findings require repair-first routing before any implementation handoff",
      findingLine: "- error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
      blockingLine: "- error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
    });

    verifyScenario(tempRoot, "clean", {
      ts: "2026-03-09T02:10:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [],
      repair_layer: {
        status: "clean",
        advice: "Repair layer is clean.",
        blocking: false,
        top_findings: [
          {
            severity: "info",
            finding_type: "SESSION_METADATA_NORMALIZATION_RECOMMENDED",
            entity_id: "S068",
            message: "Session uses comma-separated legacy integration_target_cycle; prefer integration_target_cycles for explicit multi-cycle topology.",
          },
        ],
      },
      artifacts: [],
    }, {
      status: "clean",
      advice: "Repair layer is clean.",
      primaryReason: "repair layer reports no blocking findings for the current relay",
      routingHint: "execution-or-audit",
      routingReason: "repair layer reports no blocking findings for the current relay",
      noFindingLine: "- info: SESSION_METADATA_NORMALIZATION_RECOMMENDED: S068: Session uses comma-separated legacy integration_target_cycle; prefer integration_target_cycles for explicit multi-cycle topology.",
      blockingFindingsLength: 0,
    });

    verifyScenario(tempRoot, "prefer-fresher-codex-context", {
      ts: "2026-03-09T02:00:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [
        {
          ts: "2026-03-09T02:00:00Z",
          repair_layer_status: "warn",
          repair_layer_advice: "Review open repair findings, starting with UNTRACKED_CYCLE_STATUS_REFERENCE.",
          repair_layer_top_findings: [
            {
              severity: "warning",
              finding_type: "UNTRACKED_CYCLE_STATUS_REFERENCE",
              entity_id: "snapshots/context-snapshot.md",
              message: "Artifact references cycle C089 but the index is stale.",
            },
          ],
        },
      ],
      repair_layer: {
        status: "warn",
        advice: "Review open repair findings, starting with UNTRACKED_CYCLE_STATUS_REFERENCE.",
        blocking: false,
        top_findings: [
          {
            severity: "warning",
            finding_type: "UNTRACKED_CYCLE_STATUS_REFERENCE",
            entity_id: "snapshots/context-snapshot.md",
            message: "Artifact references cycle C089 but the index is stale.",
          },
        ],
      },
      artifacts: [],
    }, {
      status: "clean",
      advice: "Repair layer is clean.",
      primaryReason: "repair layer reports no blocking findings for the current relay",
      routingHint: "execution-or-audit",
      routingReason: "repair layer reports no blocking findings for the current relay",
      noFindingLine: "- warning: UNTRACKED_CYCLE_STATUS_REFERENCE: snapshots/context-snapshot.md: Artifact references cycle C089 but the index is stale.",
      blockingFindingsLength: 0,
    }, {
      contextPayload: {
        schema_version: 1,
        target_root: "repo",
        updated_at: "2026-03-09T02:20:00Z",
        latest: {
          "start-session": {
            ts: "2026-03-09T02:20:00Z",
            repair_layer_status: "clean",
            repair_layer_advice: "Repair layer is clean.",
            repair_layer_top_findings: [],
          },
        },
      },
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
