#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function main() {
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

    assert(payload.packet.handoff_status === "refresh_required", "expected refresh_required handoff status for idle fixture");
    assert(payload.packet.handoff_from_agent_role === "coordinator", "expected default handoff source role");
    assert(payload.packet.handoff_from_agent_action === "relay", "expected default handoff source action");
    assert(payload.packet.recommended_next_agent_role === "coordinator", "expected coordinator next agent role");
    assert(payload.packet.recommended_next_agent_action === "reanchor", "expected reanchor next agent action");
    assert(payload.packet.transition_policy_status === "unknown_mode", "expected unknown_mode transition policy for idle fixture");
    assert(String(payload.packet.next_agent_goal ?? "").length > 0, "expected explicit next_agent_goal");
    assert(payload.packet.prioritized_artifacts.includes("docs/audit/CURRENT-STATE.md"), "missing CURRENT-STATE priority");
    assert(text.includes("handoff_status: refresh_required"), "packet file missing refresh_required");
    assert(text.includes("handoff_from_agent_role: coordinator"), "packet file missing source role");
    assert(text.includes("handoff_from_agent_action: relay"), "packet file missing source action");
    assert(text.includes("recommended_next_agent_role: coordinator"), "packet file missing coordinator role");
    assert(text.includes("recommended_next_agent_action: reanchor"), "packet file missing reanchor action");
    assert(text.includes("transition_policy_status: unknown_mode"), "packet file missing transition policy status");
    assert(text.includes("next_agent_goal:"), "packet file missing next_agent_goal");
    assert(text.includes("`docs/audit/WORKFLOW-KERNEL.md`"), "packet file missing workflow kernel");

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
  }
}

main();
