#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const TOOL_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TOOL_FILE), "..", "..");
const AIDN_BIN = path.join(REPO_ROOT, "bin", "aidn.mjs");

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
  console.log("  node tools/perf/verify-codex-workflow-step-fixtures.mjs --json");
}

function copyFixture(sourceRoot, tempRoot) {
  const targetRoot = path.join(tempRoot, "repo");
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter(source) {
      return !source.replace(/\\/g, "/").includes("/.git/");
    },
  });
  return targetRoot;
}

function digestFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runWorkflowStep(targetRoot) {
  const stdout = execFileSync(process.execPath, [
    AIDN_BIN,
    "codex",
    "workflow-step",
    "--target",
    targetRoot,
    "--skills",
    "context-reload,requirements-delta",
    "--mode",
    "COMMITTING",
    "--json",
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceRoot = path.resolve(REPO_ROOT, args.target);
    if (!fs.existsSync(sourceRoot)) {
      throw new Error(`Target fixture not found: ${sourceRoot}`);
    }
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-workflow-step-"));
    const targetRoot = copyFixture(sourceRoot, tempRoot);
    const runtimeStateFile = path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md");
    const handoffPacketFile = path.join(targetRoot, "docs", "audit", "HANDOFF-PACKET.md");
    const runtimeBefore = digestFile(runtimeStateFile);
    const handoffBefore = digestFile(handoffPacketFile);
    const output = runWorkflowStep(targetRoot);
    const runtimeAfter = digestFile(runtimeStateFile);
    const handoffAfter = digestFile(handoffPacketFile);

    const checks = {
      command_returns_contract: output.contract_version === "codex-workflow-step.v1",
      skills_preserved: Array.isArray(output.skills)
        && output.skills.join(",") === "context-reload,requirements-delta",
      admission_per_skill: output.steps?.some((step) => step.id === "pre-write-admit:context-reload")
        && output.steps?.some((step) => step.id === "pre-write-admit:requirements-delta"),
      hydration_per_skill: output.steps?.some((step) => step.id === "hydrate-context:context-reload")
        && output.steps?.some((step) => step.id === "hydrate-context:requirements-delta"),
      next_action_present: output.steps?.some((step) => step.id === "coordinator-next-action")
        && output.next_action?.recommendation != null,
      hidden_context_written: fs.existsSync(path.join(targetRoot, ".aidn", "runtime", "context", "hydrated-context.json")),
      visible_runtime_state_unchanged: runtimeBefore === runtimeAfter,
      visible_handoff_packet_unchanged: handoffBefore === handoffAfter,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const result = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      pass,
      checks,
      sample: {
        ok: output.ok,
        summary: output.summary,
        steps: Array.isArray(output.steps) ? output.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          status: step.status,
        })) : [],
      },
    };
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`verify-codex-workflow-step: ${pass ? "PASS" : "FAIL"}`);
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
