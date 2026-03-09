#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    fixturesRoot: "tests/fixtures/perf-handoff",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixtures-root") {
      args.fixturesRoot = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-handoff-admit-fixtures.mjs");
  console.log("  node tools/perf/verify-handoff-admit-fixtures.mjs --fixtures-root tests/fixtures/perf-handoff --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNode(script, args, repoRoot, expectStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (${path.basename(script)}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const fixturesRoot = path.resolve(repoRoot, args.fixturesRoot);
    const projectScript = path.resolve(repoRoot, "tools", "runtime", "project-handoff-packet.mjs");
    const admitScript = path.resolve(repoRoot, "tools", "runtime", "handoff-admit.mjs");

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-handoff-admit-"));
    const readyTarget = path.join(tempRoot, "ready");
    const blockedTarget = path.join(tempRoot, "blocked");
    const tamperedTarget = path.join(tempRoot, "tampered");
    const transitionRejectedTarget = path.join(tempRoot, "transition-rejected");
    fs.cpSync(path.join(fixturesRoot, "ready"), readyTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "blocked"), blockedTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "ready"), tamperedTarget, { recursive: true });
    fs.cpSync(path.join(fixturesRoot, "ready"), transitionRejectedTarget, { recursive: true });

    const readyPacket = runNode(projectScript, [
      "--target",
      readyTarget,
      "--next-agent-goal",
      "implement alpha feature validation",
      "--json",
    ], repoRoot, 0);
    const readyAdmit = runNode(admitScript, [
      "--target",
      readyTarget,
      "--json",
    ], repoRoot, 0);

    const blockedPacket = runNode(projectScript, [
      "--target",
      blockedTarget,
      "--json",
    ], repoRoot, 0);
    const warnTarget = path.join(tempRoot, "warn");
    fs.cpSync(path.join(fixturesRoot, "warn"), warnTarget, { recursive: true });
    const warnPacket = runNode(projectScript, [
      "--target",
      warnTarget,
      "--json",
    ], repoRoot, 0);
    const warnAdmit = runNode(admitScript, [
      "--target",
      warnTarget,
      "--json",
    ], repoRoot, 0);
    const blockedAdmit = runNode(admitScript, [
      "--target",
      blockedTarget,
      "--json",
    ], repoRoot, 1);

    const tamperedPacketPath = path.join(tamperedTarget, "docs", "audit", "HANDOFF-PACKET.md");
    runNode(projectScript, [
      "--target",
      tamperedTarget,
      "--next-agent-goal",
      "implement alpha feature validation",
      "--json",
    ], repoRoot, 0);
    const tamperedText = fs.readFileSync(tamperedPacketPath, "utf8").replace("active_cycle: C101", "active_cycle: C999");
    fs.writeFileSync(tamperedPacketPath, tamperedText, "utf8");
    const tamperedAdmit = runNode(admitScript, [
      "--target",
      tamperedTarget,
      "--json",
    ], repoRoot, 1);
    const transitionRejectedPacket = runNode(projectScript, [
      "--target",
      transitionRejectedTarget,
      "--from-agent-role",
      "repair",
      "--from-agent-action",
      "repair",
      "--json",
    ], repoRoot, 0);
    const transitionRejectedAdmit = runNode(admitScript, [
      "--target",
      transitionRejectedTarget,
      "--json",
    ], repoRoot, 1);

    assert(readyPacket.packet.next_agent_goal === "implement alpha feature validation", "ready packet goal mismatch");
    assert(readyAdmit.admitted === true, "ready handoff should be admitted");
    assert(readyAdmit.admission_status === "admitted", "ready handoff should be admitted");
    assert(readyAdmit.recommended_next_agent_role === "executor", "ready handoff should route to executor");
    assert(readyAdmit.recommended_action === "implement", "ready handoff should route to implement action");

    assert(warnPacket.packet.handoff_status === "ready", "warn packet should stay ready");
    assert(warnPacket.packet.recommended_next_agent_role === "auditor", "warn packet should route to auditor");
    assert(warnPacket.packet.recommended_next_agent_action === "audit", "warn packet should route to audit action");
    assert(String(warnPacket.packet.repair_routing_hint ?? "") === "audit-first", "warn packet should expose audit-first routing");
    assert(warnAdmit.admitted === true, "warn handoff should be admitted");
    assert(warnAdmit.admission_status === "admitted", "warn handoff should be admitted");
    assert(warnAdmit.recommended_next_agent_role === "auditor", "warn handoff should route to auditor");
    assert(warnAdmit.recommended_action === "audit", "warn handoff should route to audit action");

    assert(blockedPacket.packet.handoff_status === "blocked", "blocked packet should be blocked");
    assert(blockedAdmit.admitted === false, "blocked handoff should be rejected");
    assert(blockedAdmit.admission_status === "blocked", "blocked handoff should report blocked");
    assert(blockedAdmit.recommended_next_agent_role === "repair", "blocked handoff should route to repair");
    assert(blockedAdmit.recommended_action === "repair", "blocked handoff should route to repair action");

    assert(tamperedAdmit.admitted === false, "tampered handoff should be rejected");
    assert(tamperedAdmit.admission_status === "rejected", "tampered handoff should report rejected");
    assert(tamperedAdmit.recommended_next_agent_role === "coordinator", "tampered handoff should fall back to coordinator");
    assert(tamperedAdmit.recommended_action === "reanchor", "tampered handoff should fall back to reanchor");
    assert(tamperedAdmit.issues.some((item) => String(item).includes("active_cycle mismatch")), "tampered handoff should expose active_cycle mismatch");

    assert(transitionRejectedPacket.packet.handoff_from_agent_role === "repair", "transition-rejected packet should keep source role");
    assert(transitionRejectedPacket.packet.handoff_from_agent_action === "repair", "transition-rejected packet should keep source action");
    assert(transitionRejectedPacket.packet.transition_policy_status === "transition_not_allowed", "transition-rejected packet should record transition_not_allowed");
    assert(transitionRejectedAdmit.admitted === false, "transition-rejected handoff should be rejected");
    assert(transitionRejectedAdmit.admission_status === "rejected", "transition-rejected handoff should report rejected");
    assert(transitionRejectedAdmit.recommended_next_agent_role === "coordinator", "transition-rejected handoff should fall back to coordinator");
    assert(transitionRejectedAdmit.recommended_action === "reanchor", "transition-rejected handoff should fall back to reanchor");
    assert(transitionRejectedAdmit.issues.some((item) => String(item).includes("transition policy rejected handoff")), "transition-rejected handoff should expose transition rejection");

    const output = {
      ts: new Date().toISOString(),
      fixtures_root: fixturesRoot,
      ready: readyAdmit,
      warn: warnAdmit,
      blocked: blockedAdmit,
      tampered: tamperedAdmit,
      transition_rejected: transitionRejectedAdmit,
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Fixtures root: ${fixturesRoot}`);
      console.log("Result: PASS");
    }
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
