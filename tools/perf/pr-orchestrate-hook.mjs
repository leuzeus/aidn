#!/usr/bin/env node
import path from "node:path";
import { runPrOrchestrateAdmitUseCase } from "../../src/application/runtime/pr-orchestrate-admit-use-case.mjs";

function parseArgs(argv) {
  const envStateMode = String(process.env.AIDN_STATE_MODE ?? "").trim().toLowerCase();
  const args = {
    target: ".",
    mode: "UNKNOWN",
    stateMode: envStateMode || "files",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
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
    throw new Error("Missing value for --target");
  }
  if (!["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"].includes(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
  if (!["files", "dual", "db-only"].includes(args.stateMode)) {
    throw new Error("Invalid AIDN_STATE_MODE. Expected files|dual|db-only");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/pr-orchestrate-hook.mjs --target . --mode COMMITTING --json");
  console.log("  AIDN_STATE_MODE=db-only node tools/perf/pr-orchestrate-hook.mjs --target . --mode COMMITTING --strict --json");
}

function buildSummary(result) {
  return {
    result: result.result,
    reason_code: result.reason_code ?? null,
    action: result.action,
    admitted: result.admission?.ok === true,
    pr_status: result.admission?.pr_status ?? "unknown",
    pr_review_status: result.admission?.pr_review_status ?? "unknown",
    post_merge_sync_status: result.admission?.post_merge_sync_status ?? "unknown",
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const admission = runPrOrchestrateAdmitUseCase({
      targetRoot,
      mode: args.mode,
    });

    const result = {
      ts: new Date().toISOString(),
      ok: admission.ok === true,
      phase: "pr-orchestrate",
      skill: "pr-orchestrate",
      target_root: targetRoot,
      mode: args.mode,
      state_mode: args.stateMode,
      strict: args.strict,
      action: admission.action,
      result: admission.result,
      reason_code: admission.reason_code,
      branch: admission.branch,
      branch_kind: admission.branch_kind,
      admission,
      summary: null,
    };
    result.summary = buildSummary(result);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    console.log(`Result: ${result.result}`);
    console.log(`Action: ${result.action}`);
    console.log(`Branch: ${result.branch}`);
    console.log(`Branch kind: ${result.branch_kind}`);
    if (admission.recommended_next_action) {
      console.log(`Next action: ${admission.recommended_next_action}`);
    }
    if (Array.isArray(admission.suggested_commands) && admission.suggested_commands.length > 0) {
      console.log("Suggested commands:");
      for (const command of admission.suggested_commands) {
        console.log(`- ${command}`);
      }
    }
    process.exit(0);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
