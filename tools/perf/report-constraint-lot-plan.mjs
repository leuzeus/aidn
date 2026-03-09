#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

const BATCH_ORDER = ["quick-win", "foundational", "deep-change"];
const BATCH_CODE = {
  "quick-win": "QW",
  foundational: "FD",
  "deep-change": "DC",
};

function parseArgs(argv) {
  const args = {
    actionsFile: ".aidn/runtime/perf/constraint-actions.json",
    trendFile: "",
    out: ".aidn/runtime/perf/constraint-lot-plan.json",
    maxLotSize: 3,
    lotPrefix: "L4",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--actions-file") {
      args.actionsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--trend-file") {
      args.trendFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--max-lot-size") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-lot-size must be an integer");
      }
      args.maxLotSize = Number(raw);
    } else if (token === "--lot-prefix") {
      args.lotPrefix = argv[i + 1] ?? "";
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
  if (!args.actionsFile) {
    throw new Error("Missing value for --actions-file");
  }
  if (!args.out) {
    throw new Error("Missing value for --out");
  }
  if (!args.lotPrefix) {
    throw new Error("Missing value for --lot-prefix");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-constraint-lot-plan.mjs");
  console.log("  node tools/perf/report-constraint-lot-plan.mjs --actions-file .aidn/runtime/perf/constraint-actions.json --out .aidn/runtime/perf/constraint-lot-plan.json");
  console.log("  node tools/perf/report-constraint-lot-plan.mjs --trend-file .aidn/runtime/perf/constraint-trend.json --max-lot-size 3 --json");
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

function readJsonOptional(filePath) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch {
    return null;
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function priorityBand(avgPriority) {
  if (avgPriority >= 20) {
    return "high";
  }
  if (avgPriority >= 8) {
    return "medium";
  }
  return "low";
}

function mostFrequent(values) {
  const map = new Map();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      continue;
    }
    map.set(normalized, (map.get(normalized) ?? 0) + 1);
  }
  const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0] ?? null;
}

function buildLots(actions, maxLotSize, lotPrefix) {
  const byBatch = new Map();
  for (const batch of BATCH_ORDER) {
    byBatch.set(batch, []);
  }
  for (const action of actions) {
    const batch = String(action?.batch ?? "").trim();
    if (!byBatch.has(batch)) {
      byBatch.set(batch, []);
    }
    byBatch.get(batch).push(action);
  }

  for (const bucket of byBatch.values()) {
    bucket.sort((left, right) => Number(right?.priority_score ?? 0) - Number(left?.priority_score ?? 0));
  }

  const lots = [];
  for (const batch of BATCH_ORDER) {
    const items = byBatch.get(batch) ?? [];
    const groups = chunk(items, Math.max(1, maxLotSize));
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const lotId = `${lotPrefix}-${BATCH_CODE[batch] ?? "OT"}-${String(i + 1).padStart(2, "0")}`;
      const avgPriority = group.length > 0
        ? group.reduce((sum, action) => sum + Number(action?.priority_score ?? 0), 0) / group.length
        : 0;
      const focusSkill = mostFrequent(group.map((action) => action?.skill));
      const exitCriteria = Array.from(new Set(group
        .map((action) => String(action?.acceptance_criteria ?? "").trim())
        .filter((line) => line.length > 0)));
      lots.push({
        lot_id: lotId,
        sequence: lots.length + 1,
        batch,
        status: "planned",
        priority_band: priorityBand(avgPriority),
        avg_priority_score: Number(avgPriority.toFixed(2)),
        focus_skill: focusSkill,
        actions: group.map((action) => ({
          action_id: action.action_id,
          skill: action.skill,
          title: action.title,
          status: "pending",
          priority_score: action.priority_score,
          impact_score: action.impact_score,
          effort: action.effort,
          recommendation: action.recommendation,
          acceptance_criteria: action.acceptance_criteria,
        })),
        exit_criteria: exitCriteria,
      });
    }
  }
  return lots;
}

function summarizePlan(lots, trend) {
  const statusCount = new Map([
    ["planned", 0],
    ["in_progress", 0],
    ["completed", 0],
    ["blocked", 0],
  ]);
  let actionsTotal = 0;
  let actionsDone = 0;
  for (const lot of lots) {
    const status = String(lot?.status ?? "planned");
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    const actions = Array.isArray(lot?.actions) ? lot.actions : [];
    actionsTotal += actions.length;
    actionsDone += actions.filter((action) => String(action?.status ?? "pending") === "done").length;
  }
  const nextLot = lots.find((lot) => String(lot?.status ?? "planned") === "planned")
    ?? lots.find((lot) => String(lot?.status ?? "planned") === "in_progress")
    ?? null;

  return {
    lots_total: lots.length,
    lots_planned: statusCount.get("planned") ?? 0,
    lots_in_progress: statusCount.get("in_progress") ?? 0,
    lots_completed: statusCount.get("completed") ?? 0,
    lots_blocked: statusCount.get("blocked") ?? 0,
    actions_total: actionsTotal,
    actions_done: actionsDone,
    actions_pending: Math.max(0, actionsTotal - actionsDone),
    next_lot_id: nextLot?.lot_id ?? null,
    active_constraint_skill: trend?.summary?.dominant_constraint_skill ?? null,
    active_constraint_stability_rate: trend?.summary?.constraint_stability_rate ?? null,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const actions = readJson(args.actionsFile, "Constraint actions");
    const trend = readJsonOptional(args.trendFile);
    const actionList = Array.isArray(actions?.data?.actions) ? actions.data.actions : [];
    const lots = buildLots(actionList, args.maxLotSize, args.lotPrefix);
    const payload = {
      ts: new Date().toISOString(),
      source_actions_file: actions.absolute,
      source_trend_file: trend?.absolute ?? null,
      config: {
        max_lot_size: args.maxLotSize,
        lot_prefix: args.lotPrefix,
      },
      summary: summarizePlan(lots, trend?.data ?? null),
      lots,
    };
    const outWrite = writeJsonIfChanged(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Lots generated: ${payload.summary.lots_total}`);
    console.log(`Actions total: ${payload.summary.actions_total}`);
    console.log(`Next lot: ${payload.summary.next_lot_id ?? "n/a"}`);
    console.log(`Output file: ${payload.output_file} (${payload.output_written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
