#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-digest-hints-fixtures.mjs");
}

function runText(script, scriptArgs, env = {}, expectStatus = 0) {
  const file = path.resolve(process.cwd(), script);
  const result = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed: ${process.execPath} ${file} ${scriptArgs.join(" ")}`);
  }
  return `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`;
}

function runNoJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeAdapterFile(tempRoot) {
  const filePath = path.join(tempRoot, "workflow.adapter.json");
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    projectName: "repo",
    constraints: {
      runtime: "",
      architecture: "",
      delivery: "",
      additional: [],
    },
    runtimePolicy: {
      preferredStateMode: "dual",
      defaultIndexStore: "dual-sqlite",
    },
  }, null, 2)}\n`, "utf8");
  return filePath;
}

function setStaleCurrentState(target) {
  const file = path.join(target, "docs", "audit", "CURRENT-STATE.md");
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/updated_at:\s*.*/u, "updated_at: 2026-01-01T00:00:00Z");
  fs.writeFileSync(file, text, "utf8");
}

function setStaleRuntimeDigest(target) {
  const file = path.join(target, "docs", "audit", "RUNTIME-STATE.md");
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/current_state_freshness:\s*.*/u, "current_state_freshness: stale");
  text = text.replace(/current_state_freshness_basis:\s*.*/u, "current_state_freshness_basis: CURRENT-STATE.md is older than active cycle timestamps");
  fs.writeFileSync(file, text, "utf8");
}

function main() {
  let tempRoot = "";
  let adapterFile = "";
  try {
    const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/perf-structure/session-rich");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-digest-hints-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    adapterFile = writeAdapterFile(tempRoot);

    runNoJson("tools/install.mjs", [
      "--target",
      target,
      "--pack",
      "core",
      "--adapter-file",
      adapterFile,
      "--force-agents-merge",
    ]);

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    setStaleCurrentState(target);
    runText("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "close-session",
      "--json",
    ], env);
    setStaleRuntimeDigest(target);
    runText("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], env);
    fs.rmSync(path.join(target, "docs", "audit", "RUNTIME-STATE.md"), { force: true });

    const skillHookOut = runText("tools/perf/skill-hook.mjs", [
      "--skill",
      "close-session",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--no-auto-skip-gate",
    ], env);
    assert(skillHookOut.includes("Skill hook: WARN (close-session -> close-session-hook.mjs)"), "skill-hook missing warning summary");

    const runJsonHookOut = runText("tools/codex/run-json-hook.mjs", [
      "--skill",
      "close-session",
      "--mode",
      "COMMITTING",
      "--target",
      target,
      "--state-mode",
      "db-only",
      "--no-auto-skip-gate",
    ], env, 1);
    assert(runJsonHookOut.includes("Repair status: "), "run-json-hook missing repair status");
    assert(runJsonHookOut.includes("Runtime digest: docs/audit/RUNTIME-STATE.md"), "run-json-hook missing runtime digest hint");
    assert(runJsonHookOut.includes("Current state stale: docs/audit/CURRENT-STATE.md"), "run-json-hook missing stale current-state hint");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (adapterFile && fs.existsSync(adapterFile)) {
      fs.rmSync(adapterFile, { force: true });
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
