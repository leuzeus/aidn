#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeUtf8IfChanged } from "./io-lib.mjs";

function parseArgs(argv) {
  const args = {
    planFile: ".aidn/runtime/perf/constraint-lot-plan.json",
    advanceFile: "",
    out: ".aidn/runtime/perf/constraint-lot-plan-summary.md",
    topLots: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--plan-file") {
      args.planFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--advance-file") {
      args.advanceFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--top-lots") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--top-lots must be an integer");
      }
      args.topLots = Number(raw);
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.planFile || !args.out) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/render-constraint-lot-plan-summary.mjs");
  console.log("  node tools/perf/render-constraint-lot-plan-summary.mjs --plan-file .aidn/runtime/perf/constraint-lot-plan.json --out .aidn/runtime/perf/constraint-lot-plan-summary.md");
  console.log("  node tools/perf/render-constraint-lot-plan-summary.mjs --advance-file .aidn/runtime/perf/constraint-lot-advance.json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function readJsonOptional(filePath, label) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message}`);
  }
}

function buildMarkdown(plan, advance, topLots) {
  const summary = plan?.summary ?? {};
  const lots = Array.isArray(plan?.lots) ? plan.lots.slice(0, topLots) : [];
  const nextLotId = String(summary?.next_lot_id ?? "").trim();
  const nextLot = Array.isArray(plan?.lots)
    ? plan.lots.find((lot) => String(lot?.lot_id ?? "") === nextLotId)
    : null;

  const lines = [];
  lines.push("## Constraint Lot Plan");
  lines.push("");
  lines.push(`- Lots total: ${summary?.lots_total ?? 0}`);
  lines.push(`- Lots planned/in_progress/completed/blocked: ${summary?.lots_planned ?? 0}/${summary?.lots_in_progress ?? 0}/${summary?.lots_completed ?? 0}/${summary?.lots_blocked ?? 0}`);
  lines.push(`- Actions done/total: ${summary?.actions_done ?? 0}/${summary?.actions_total ?? 0}`);
  lines.push(`- Next lot: ${summary?.next_lot_id ?? "n/a"}`);
  lines.push("");

  if (lots.length > 0) {
    lines.push("### Lots");
    lines.push("");
    lines.push("| lot_id | status | batch | actions | avg_priority | focus_skill |");
    lines.push("|---|---|---|---:|---:|---|");
    for (const lot of lots) {
      const actions = Array.isArray(lot?.actions) ? lot.actions : [];
      lines.push(`| ${lot?.lot_id ?? "n/a"} | ${lot?.status ?? "n/a"} | ${lot?.batch ?? "n/a"} | ${actions.length} | ${lot?.avg_priority_score ?? "n/a"} | ${lot?.focus_skill ?? "n/a"} |`);
    }
    lines.push("");
  }

  if (nextLot != null) {
    const actions = Array.isArray(nextLot?.actions) ? nextLot.actions : [];
    lines.push("### Next Lot Actions");
    lines.push("");
    lines.push(`- Lot: ${nextLot.lot_id} (${nextLot.batch}, ${nextLot.priority_band})`);
    lines.push("");
    lines.push("| action_id | status | priority | impact | effort |");
    lines.push("|---|---|---:|---:|---:|");
    for (const action of actions) {
      lines.push(`| ${action?.action_id ?? "n/a"} | ${action?.status ?? "n/a"} | ${action?.priority_score ?? "n/a"} | ${action?.impact_score ?? "n/a"} | ${action?.effort ?? "n/a"} |`);
    }
    lines.push("");
  }

  const transitions = Array.isArray(advance?.transitions) ? advance.transitions : [];
  if (transitions.length > 0) {
    lines.push("### Latest Transitions");
    lines.push("");
    lines.push("| type | lot_id |");
    lines.push("|---|---|");
    for (const transition of transitions) {
      lines.push(`| ${transition?.type ?? "n/a"} | ${transition?.lot_id ?? "n/a"} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = readJson(args.planFile, "Constraint lot plan");
    const advance = readJsonOptional(args.advanceFile, "Constraint lot advance");
    const markdown = buildMarkdown(plan, advance, args.topLots);
    const outWrite = writeUtf8IfChanged(args.out, markdown);
    console.log(`Constraint lot plan summary written: ${outWrite.path} (${outWrite.written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
