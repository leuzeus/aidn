#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

function parseArgs(argv) {
  const args = {
    planFile: ".aidn/runtime/perf/constraint-lot-plan.json",
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--plan-file") {
      args.planFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.planFile) {
    throw new Error("Missing value for --plan-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/advance-constraint-lot-plan.mjs --plan-file .aidn/runtime/perf/constraint-lot-plan.json");
  console.log("  node tools/perf/advance-constraint-lot-plan.mjs --dry-run --json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function recomputeSummary(plan) {
  const lots = Array.isArray(plan?.lots) ? plan.lots : [];
  let lotsPlanned = 0;
  let lotsInProgress = 0;
  let lotsCompleted = 0;
  let lotsBlocked = 0;
  let actionsTotal = 0;
  let actionsDone = 0;
  for (const lot of lots) {
    const status = String(lot?.status ?? "planned");
    if (status === "planned") {
      lotsPlanned += 1;
    } else if (status === "in_progress") {
      lotsInProgress += 1;
    } else if (status === "completed") {
      lotsCompleted += 1;
    } else if (status === "blocked") {
      lotsBlocked += 1;
    }
    const actions = Array.isArray(lot?.actions) ? lot.actions : [];
    actionsTotal += actions.length;
    actionsDone += actions.filter((action) => String(action?.status ?? "pending") === "done").length;
  }
  const nextLot = lots.find((lot) => String(lot?.status ?? "planned") === "planned")
    ?? lots.find((lot) => String(lot?.status ?? "planned") === "in_progress")
    ?? null;
  const previous = plan?.summary ?? {};
  plan.summary = {
    ...previous,
    lots_total: lots.length,
    lots_planned: lotsPlanned,
    lots_in_progress: lotsInProgress,
    lots_completed: lotsCompleted,
    lots_blocked: lotsBlocked,
    actions_total: actionsTotal,
    actions_done: actionsDone,
    actions_pending: Math.max(0, actionsTotal - actionsDone),
    next_lot_id: nextLot?.lot_id ?? null,
  };
}

function allActionsDone(lot) {
  const actions = Array.isArray(lot?.actions) ? lot.actions : [];
  if (actions.length === 0) {
    return true;
  }
  return actions.every((action) => String(action?.status ?? "pending") === "done");
}

function advance(plan) {
  const lots = Array.isArray(plan?.lots) ? plan.lots : [];
  const transitions = [];

  const inProgressLots = lots.filter((lot) => String(lot?.status ?? "planned") === "in_progress");
  if (inProgressLots.length > 1) {
    throw new Error(`Invalid plan: multiple in_progress lots (${inProgressLots.map((lot) => lot.lot_id).join(", ")})`);
  }

  if (inProgressLots.length === 0) {
    const next = lots.find((lot) => String(lot?.status ?? "planned") === "planned");
    if (next) {
      next.status = "in_progress";
      transitions.push({
        type: "lot_started",
        lot_id: next.lot_id,
      });
    }
    return transitions;
  }

  const current = inProgressLots[0];
  if (allActionsDone(current)) {
    current.status = "completed";
    transitions.push({
      type: "lot_completed",
      lot_id: current.lot_id,
    });
    const next = lots.find((lot) => String(lot?.status ?? "planned") === "planned");
    if (next) {
      next.status = "in_progress";
      transitions.push({
        type: "lot_started",
        lot_id: next.lot_id,
      });
    }
  }

  return transitions;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = readJson(args.planFile, "Constraint lot plan");
    const transitions = advance(plan.data);
    plan.data.ts = new Date().toISOString();
    recomputeSummary(plan.data);

    let outWrite = { path: plan.absolute, written: false };
    if (!args.dryRun) {
      outWrite = writeJsonIfChanged(args.planFile, plan.data);
    }

    const payload = {
      ts: new Date().toISOString(),
      plan_file: outWrite.path,
      output_written: outWrite.written,
      dry_run: args.dryRun,
      transitions,
      summary: plan.data.summary,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Plan file: ${payload.plan_file}`);
    console.log(`Dry run: ${payload.dry_run ? "yes" : "no"}`);
    console.log(`Transitions: ${payload.transitions.length}`);
    console.log(`Next lot: ${payload.summary?.next_lot_id ?? "n/a"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
