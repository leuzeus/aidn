#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-hydrate-context-runtime-state-fixtures.mjs");
}

function runJson(script, scriptArgs, options = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  let tempRoot = "";
  try {
    const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/repo-installed-core");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-hydrate-runtime-state-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });

    const hydrated = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "context-reload",
      "--json",
    ]);

    const runtimeStateFile = String(hydrated?.runtime_state?.output_file ?? "");
    assert(runtimeStateFile.length > 0, "runtime_state.output_file missing");
    assert(fs.existsSync(runtimeStateFile), "runtime_state output file not written");
    assert(String(hydrated?.runtime_state?.digest?.runtime_state_mode ?? "").length > 0, "runtime_state digest missing mode");
    assert(String(hydrated?.runtime_state?.digest?.current_state_freshness ?? "").length > 0, "runtime_state digest missing freshness");
    assert(String(hydrated?.runtime_state?.mode ?? "") === "auto", "runtime_state should auto-project in dual/db-only fixture");

    const markdown = fs.readFileSync(runtimeStateFile, "utf8");
    assert(markdown.includes("# Runtime State Digest"), "runtime state markdown header missing");
    assert(markdown.includes("current_state_freshness:"), "runtime state markdown freshness missing");
    assert(!markdown.includes("docs/audit/cycles/none-*/status.md"), "runtime state markdown leaked none cycle path");
    assert(!markdown.includes("docs/audit/sessions/none*.md"), "runtime state markdown leaked none session path");

    const noProject = runJson("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "context-reload",
      "--no-project-runtime-state",
      "--json",
    ]);
    assert(!("runtime_state" in noProject), "runtime_state should be absent when --no-project-runtime-state is set");

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
