#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeJsonIfChanged } from "./io-lib.mjs";

const LOT_STATUS = new Set(["planned", "in_progress", "completed", "blocked"]);
const ACTION_STATUS = new Set(["pending", "in_progress", "done", "blocked"]);

function parseArgs(argv) {
  const args = {
    planFile: ".aidn/runtime/perf/constraint-lot-plan.json",
    lotId: "",
    lotStatus: "",
    actionUpdates: [],
    note: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--plan-file") {
      args.planFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--lot-id") {
      args.lotId = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--lot-status") {
      args.lotStatus = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--action-update") {
      args.actionUpdates.push(argv[i + 1] ?? "");
      i += 1;
    } else if (token === "--note") {
      args.note = argv[i + 1] ?? "";
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
  if (!args.planFile) {
    throw new Error("Missing value for --plan-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/update-constraint-lot-plan.mjs --plan-file .aidn/runtime/perf/constraint-lot-plan.json --lot-id L4-QW-01 --lot-status in_progress");
  console.log("  node tools/perf/update-constraint-lot-plan.mjs --action-update context-reload:reload-cache-hit:done --json");
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

function parseActionUpdate(raw) {
  const token = String(raw ?? "").trim();
  const parts = token.split(":");
  if (parts.length < 3) {
    throw new Error(`Invalid --action-update: ${token}. Expected <skill:action-id:status>`);
  }
  const status = parts.pop();
  const actionId = parts.join(":");
  if (!ACTION_STATUS.has(status)) {
    throw new Error(`Invalid action status in --action-update: ${status}`);
  }
  return { actionId, status };
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

  const existing = plan?.summary ?? {};
  plan.summary = {
    ...existing,
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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = readJson(args.planFile, "Constraint lot plan");
    const lots = Array.isArray(plan?.data?.lots) ? plan.data.lots : [];

    const updates = [];
    if (args.lotId || args.lotStatus) {
      if (!args.lotId || !args.lotStatus) {
        throw new Error("Use --lot-id and --lot-status together");
      }
      if (!LOT_STATUS.has(args.lotStatus)) {
        throw new Error(`Invalid --lot-status: ${args.lotStatus}`);
      }
      const lot = lots.find((entry) => String(entry?.lot_id ?? "") === args.lotId);
      if (!lot) {
        throw new Error(`Lot not found: ${args.lotId}`);
      }
      lot.status = args.lotStatus;
      if (args.note) {
        lot.note = args.note;
      }
      updates.push({ type: "lot", lot_id: args.lotId, status: args.lotStatus });
    }

    for (const rawUpdate of args.actionUpdates) {
      const parsed = parseActionUpdate(rawUpdate);
      let matched = false;
      for (const lot of lots) {
        const actions = Array.isArray(lot?.actions) ? lot.actions : [];
        const action = actions.find((entry) => String(entry?.action_id ?? "") === parsed.actionId);
        if (action) {
          action.status = parsed.status;
          if (args.note) {
            action.note = args.note;
          }
          updates.push({ type: "action", lot_id: lot.lot_id, action_id: parsed.actionId, status: parsed.status });
          matched = true;
          break;
        }
      }
      if (!matched) {
        throw new Error(`Action not found in plan: ${parsed.actionId}`);
      }
    }

    const inProgressLots = lots.filter((lot) => String(lot?.status ?? "planned") === "in_progress");
    if (inProgressLots.length > 1) {
      throw new Error(`Invalid plan: multiple in_progress lots (${inProgressLots.map((lot) => lot.lot_id).join(", ")})`);
    }

    plan.data.ts = new Date().toISOString();
    recomputeSummary(plan.data);
    const outWrite = writeJsonIfChanged(args.planFile, plan.data);

    const payload = {
      ts: new Date().toISOString(),
      plan_file: outWrite.path,
      output_written: outWrite.written,
      updates,
      summary: plan.data.summary,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Plan updated: ${payload.plan_file} (${payload.output_written ? "written" : "unchanged"})`);
    console.log(`Updates applied: ${updates.length}`);
    console.log(`Next lot: ${payload.summary?.next_lot_id ?? "n/a"}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
