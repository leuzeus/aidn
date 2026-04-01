#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
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
  if (!args.target) {
    throw new Error("Missing --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-handoff-packet-fixtures.mjs");
  console.log("  node tools/perf/verify-handoff-packet-fixtures.mjs --target tests/fixtures/repo-installed-core --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, args, env = {}) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
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
    const repoRoot = process.cwd();
    const target = path.resolve(repoRoot, args.target);
    const script = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const outFile = path.join(target, "docs", "audit", "HANDOFF-PACKET.md");

    const result = spawnSync(process.execPath, [
      script,
      "--target",
      target,
      "--json",
    ], {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if ((result.status ?? 1) !== 0) {
      throw new Error(`project-handoff-packet failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`);
    }

    const payload = JSON.parse(String(result.stdout ?? "{}"));
    const text = fs.readFileSync(outFile, "utf8");

    assert(String(payload.workspace?.workspace_id ?? "").length > 0, "expected workspace_id in handoff output envelope");
    assert(String(payload.workspace?.worktree_id ?? "").length > 0, "expected worktree_id in handoff output envelope");
    assert(String(payload.packet.workspace_id ?? "").length > 0, "expected workspace_id in handoff packet");
    assert(String(payload.packet.worktree_id ?? "").length > 0, "expected worktree_id in handoff packet");
    assert(payload.packet.shared_runtime_mode === "local-only", "expected local-only runtime mode in handoff packet");
    assert(payload.packet.shared_runtime_validation_status === "clear", "expected clear shared runtime validation in handoff packet");
    assert(payload.packet.shared_runtime_locator_ref === "none", "expected no locator ref in default handoff packet");
    assert(payload.packet.shared_backend_kind === "none", "expected no shared backend kind in handoff packet");
    assert(payload.packet.handoff_status === "refresh_required", "expected refresh_required handoff status for idle fixture");
    assert(payload.packet.handoff_from_agent_role === "coordinator", "expected default handoff source role");
    assert(payload.packet.handoff_from_agent_action === "relay", "expected default handoff source action");
    assert(payload.packet.recommended_next_agent_role === "coordinator", "expected coordinator next agent role");
    assert(payload.packet.recommended_next_agent_action === "reanchor", "expected reanchor next agent action");
    assert(payload.packet.scope_type === "session", "expected session scope for idle fixture");
    assert(payload.packet.scope_id === "none", "expected none scope_id for idle fixture");
    assert(payload.packet.target_branch === "none", "expected none target_branch for idle fixture");
    assert(payload.packet.transition_policy_status === "unknown_mode", "expected unknown_mode transition policy for idle fixture");
    assert(payload.packet.preferred_dispatch_source === "workflow", "expected workflow dispatch source for idle fixture");
    assert(payload.packet.shared_planning_candidate_ready === "no", "expected no shared planning candidate for idle fixture");
    assert(payload.packet.shared_planning_candidate_aligned === "no", "expected non-aligned shared planning candidate for idle fixture");
    assert(payload.packet.shared_planning_freshness === "not_applicable", "expected no shared planning freshness for idle fixture");
    assert(payload.packet.shared_planning_gate_status === "not_applicable", "expected no shared planning gate for idle fixture");
    assert(payload.packet.repair_primary_reason === "unknown", "expected unknown repair primary reason for idle fixture");
    assert(String(payload.packet.next_agent_goal ?? "").length > 0, "expected explicit next_agent_goal");
    assert(payload.packet.prioritized_artifacts.includes("docs/audit/CURRENT-STATE.md"), "missing CURRENT-STATE priority");
    assert(text.includes("handoff_status: refresh_required"), "packet file missing refresh_required");
    assert(text.includes("workspace_id:"), "packet file missing workspace_id");
    assert(text.includes("worktree_id:"), "packet file missing worktree_id");
    assert(text.includes("shared_runtime_mode: local-only"), "packet file missing local-only runtime mode");
    assert(text.includes("shared_runtime_validation_status: clear"), "packet file missing shared runtime validation status");
    assert(text.includes("shared_runtime_locator_ref: none"), "packet file missing locator ref");
    assert(text.includes("shared_backend_kind: none"), "packet file missing shared backend kind");
    assert(text.includes("handoff_from_agent_role: coordinator"), "packet file missing source role");
    assert(text.includes("handoff_from_agent_action: relay"), "packet file missing source action");
    assert(text.includes("recommended_next_agent_role: coordinator"), "packet file missing coordinator role");
    assert(text.includes("recommended_next_agent_action: reanchor"), "packet file missing reanchor action");
    assert(text.includes("scope_type: session"), "packet file missing session scope");
    assert(text.includes("scope_id: none"), "packet file missing scope id");
    assert(text.includes("transition_policy_status: unknown_mode"), "packet file missing transition policy status");
    assert(text.includes("preferred_dispatch_source: workflow"), "packet file missing dispatch source");
    assert(text.includes("shared_planning_candidate_ready: no"), "packet file missing shared planning candidate flag");
    assert(text.includes("shared_planning_freshness: not_applicable"), "packet file missing shared planning freshness");
    assert(text.includes("shared_planning_gate_status: not_applicable"), "packet file missing shared planning gate");
    assert(text.includes("repair_primary_reason: unknown"), "packet file missing repair primary reason");
    assert(text.includes("next_agent_goal:"), "packet file missing next_agent_goal");
    assert(text.includes("`docs/audit/WORKFLOW-KERNEL.md`"), "packet file missing workflow kernel");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-handoff-packet-"));
    const filelessRepo = path.join(tempRoot, "db-only-fileless");
    fs.cpSync(path.resolve(repoRoot, "tests/fixtures/perf-handoff/ready"), filelessRepo, { recursive: true });
    runJson("tools/perf/index-sync.mjs", [
      "--target", filelessRepo,
      "--store", "sqlite",
      "--with-content",
      "--json",
    ], {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    });
    fs.rmSync(path.join(filelessRepo, "docs", "audit", "CURRENT-STATE.md"), { force: true });
    fs.rmSync(path.join(filelessRepo, "docs", "audit", "RUNTIME-STATE.md"), { force: true });
    fs.rmSync(path.join(filelessRepo, "docs", "audit", "sessions", "S101-alpha.md"), { force: true });
    fs.rmSync(path.join(filelessRepo, "docs", "audit", "cycles", "C101-feature-alpha", "status.md"), { force: true });
    const filelessResult = spawnSync(process.execPath, [
      script,
      "--target",
      filelessRepo,
      "--json",
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AIDN_STATE_MODE: "db-only",
        AIDN_INDEX_STORE_MODE: "sqlite",
      },
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if ((filelessResult.status ?? 1) !== 0) {
      throw new Error(`project-handoff-packet db-only fileless failed: ${String(filelessResult.stderr ?? filelessResult.stdout ?? "").trim()}`);
    }
    const filelessPayload = JSON.parse(String(filelessResult.stdout ?? "{}"));
    const filelessText = fs.readFileSync(path.join(filelessRepo, "docs", "audit", "HANDOFF-PACKET.md"), "utf8");
    assert(String(filelessPayload.packet.workspace_id ?? "").length > 0, "db-only fileless handoff should expose workspace_id");
    assert(String(filelessPayload.packet.worktree_id ?? "").length > 0, "db-only fileless handoff should expose worktree_id");
    assert(filelessPayload.packet.shared_runtime_mode === "local-only", "db-only fileless handoff should stay local-only by default");
    assert(filelessPayload.packet.handoff_status === "ready", "db-only fileless handoff should stay ready");
    assert(filelessPayload.packet.recommended_next_agent_role === "executor", "db-only fileless handoff should route to executor");
    assert(filelessPayload.packet.recommended_next_agent_action === "implement", "db-only fileless handoff should route to implement");
    assert(filelessPayload.packet.scope_type === "cycle", "db-only fileless handoff should preserve cycle scope");
    assert(filelessPayload.packet.scope_id === "C101", "db-only fileless handoff should preserve active cycle");
    assert(filelessPayload.packet.current_state_source === "sqlite", "db-only fileless handoff should load CURRENT-STATE from SQLite");
    assert(filelessPayload.packet.runtime_state_source === "sqlite", "db-only fileless handoff should load RUNTIME-STATE from SQLite");
    assert(filelessPayload.packet.session_file === "docs/audit/sessions/S101-alpha.md", "db-only fileless handoff should recover the session artifact path");
    assert(filelessPayload.packet.cycle_status_file === "docs/audit/cycles/C101-feature-alpha/status.md", "db-only fileless handoff should recover the cycle status path");
    assert(filelessText.includes("handoff_status: ready"), "db-only fileless handoff markdown should record ready status");
    assert(filelessText.includes("workspace_id:"), "db-only fileless handoff markdown should record workspace_id");
    const output = {
      ts: new Date().toISOString(),
      target,
      output_file: outFile,
      packet: payload.packet,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${target}`);
      console.log("Result: PASS");
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
