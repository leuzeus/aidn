#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeJsonIfChanged } from "../../src/lib/index/io-lib.mjs";

const ACTION_LIBRARY = {
  "context-reload": [
    {
      id: "reload-cache-hit",
      title: "Increase reload cache hit-rate",
      effort: 2,
      recommendation: "Persist and reuse digest snapshots aggressively when branch/scope did not change.",
      acceptance_criteria: "Reload fallback rate decreases while L1 decisions remain equivalent.",
    },
    {
      id: "reload-fallback-noise",
      title: "Reduce reload fallback noise",
      effort: 3,
      recommendation: "Classify recoverable cache inconsistencies before forcing full reload.",
      acceptance_criteria: "MISSING_CACHE/CORRUPT_CACHE fallback bursts are reduced without quality regressions.",
    },
  ],
  "branch-cycle-audit": [
    {
      id: "audit-skip-unchanged-branch",
      title: "Skip branch audit on stable mapping",
      effort: 2,
      recommendation: "Short-circuit branch-cycle-audit when branch, mapping digest, and tracked files are unchanged.",
      acceptance_criteria: "Audit invocations per session decrease with no increase in mapping drift.",
    },
  ],
  "drift-check": [
    {
      id: "drift-check-signal-gating",
      title: "Tighten conditional drift-check triggers",
      effort: 3,
      recommendation: "Run drift-check only when L2 signals indicate objective or structural uncertainty.",
      acceptance_criteria: "Drift-check runtime drops while detected drift defects stay stable.",
    },
  ],
  "start-session": [
    {
      id: "session-start-write-on-change",
      title: "Reduce session-start write volume",
      effort: 2,
      recommendation: "Apply write-on-change for session metadata and checkpoint outputs.",
      acceptance_criteria: "Session-start bytes_written and file rewrites decrease.",
    },
  ],
  "close-session": [
    {
      id: "session-close-selective-checkpoint",
      title: "Use selective checkpoint on close",
      effort: 2,
      recommendation: "Avoid full checkpoint chain on close when no new control signal is present.",
      acceptance_criteria: "Close-session control duration decreases with unchanged gate outcomes.",
    },
  ],
};

function parseArgs(argv) {
  const args = {
    reportFile: ".aidn/runtime/perf/constraint-report.json",
    thresholdsFile: "",
    out: ".aidn/runtime/perf/constraint-actions.json",
    topSkills: 5,
    maxActions: 8,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report-file") {
      args.reportFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--thresholds-file") {
      args.thresholdsFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--out") {
      args.out = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--top-skills") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--top-skills must be an integer");
      }
      args.topSkills = Number(raw);
    } else if (token === "--max-actions") {
      const raw = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d+$/.test(raw)) {
        throw new Error("--max-actions must be an integer");
      }
      args.maxActions = Number(raw);
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.reportFile) {
    throw new Error("Missing value for --report-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/report-constraint-actions.mjs");
  console.log("  node tools/perf/report-constraint-actions.mjs --report-file .aidn/runtime/perf/constraint-report.json --out .aidn/runtime/perf/constraint-actions.json");
  console.log("  node tools/perf/report-constraint-actions.mjs --thresholds-file .aidn/runtime/perf/constraint-thresholds.json --json");
}

function readJson(filePath, label) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  try {
    return { absolute, data: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function severityFromImpact(impactScore) {
  if (impactScore >= 70) {
    return "high";
  }
  if (impactScore >= 45) {
    return "medium";
  }
  return "low";
}

function batchFromImpactEffort(impactScore, effort) {
  if (impactScore >= 45 && effort <= 2) {
    return "quick-win";
  }
  if (effort <= 3) {
    return "foundational";
  }
  return "deep-change";
}

function actionTemplatesForSkill(skill) {
  const templates = ACTION_LIBRARY[skill];
  if (Array.isArray(templates) && templates.length > 0) {
    return templates;
  }
  return [
    {
      id: "generic-control-reduction",
      title: "Reduce control overhead for skill",
      effort: 3,
      recommendation: "Optimize repeated checks and parse-heavy operations for this skill.",
      acceptance_criteria: "Skill control duration and p90 decrease while gate outcomes stay equivalent.",
    },
  ];
}

function scoreSkill(skill) {
  const share = Number(skill?.control_share_of_control ?? 0);
  const fallbackEvents = Number(skill?.fallback_events ?? 0);
  const stopEvents = Number(skill?.stop_events ?? 0);
  const gates = Number(skill?.gates_triggered_total ?? 0);
  const base = share * 100;
  const boosts = (fallbackEvents * 8) + (stopEvents * 10) + Math.min(10, gates * 1.5);
  return clamp(Math.round(base + boosts), 0, 100);
}

function buildActions(report, thresholds, topSkills, maxActions) {
  const skills = Array.isArray(report?.skills) ? report.skills : [];
  const selectedSkills = skills
    .filter((skill) => Number(skill?.control_duration_ms ?? 0) > 0)
    .slice(0, topSkills);

  const actions = [];
  for (const skill of selectedSkills) {
    const impactScore = scoreSkill(skill);
    const templates = actionTemplatesForSkill(String(skill?.skill ?? "unknown"));
    for (const template of templates) {
      const effort = clamp(Number(template.effort ?? 3), 1, 5);
      const priority = Number((impactScore / effort).toFixed(2));
      actions.push({
        action_id: `${skill.skill}:${template.id}`,
        skill: skill.skill,
        title: template.title,
        batch: batchFromImpactEffort(impactScore, effort),
        severity: severityFromImpact(impactScore),
        effort,
        impact_score: impactScore,
        priority_score: priority,
        rationale: {
          control_share_of_control: skill.control_share_of_control ?? 0,
          fallback_events: skill.fallback_events ?? 0,
          stop_events: skill.stop_events ?? 0,
          gates_triggered_total: skill.gates_triggered_total ?? 0,
          p90_duration_ms: skill.p90_duration_ms ?? null,
        },
        recommendation: template.recommendation,
        acceptance_criteria: template.acceptance_criteria,
      });
    }
  }

  actions.sort((left, right) => {
    if (right.priority_score !== left.priority_score) {
      return right.priority_score - left.priority_score;
    }
    return String(left.action_id).localeCompare(String(right.action_id));
  });

  const top = actions.slice(0, maxActions);
  const thresholdStatus = String(thresholds?.summary?.overall_status ?? "not-generated");
  const blockingChecks = Array.isArray(thresholds?.checks)
    ? thresholds.checks.filter((check) => check?.status === "fail" && (check?.severity === "error" || thresholds?.strict === true)).length
    : 0;

  return {
    summary: {
      generated_actions: top.length,
      source_skills: selectedSkills.length,
      threshold_status: thresholdStatus,
      threshold_blocking_checks: blockingChecks,
      quick_wins: top.filter((action) => action.batch === "quick-win").length,
      foundational: top.filter((action) => action.batch === "foundational").length,
      deep_change: top.filter((action) => action.batch === "deep-change").length,
      active_constraint_skill: report?.summary?.active_constraint?.skill ?? null,
    },
    actions: top,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = readJson(args.reportFile, "Constraint report");
    const thresholds = readJsonOptional(args.thresholdsFile);
    const built = buildActions(report.data, thresholds?.data ?? null, args.topSkills, args.maxActions);

    const payload = {
      ts: new Date().toISOString(),
      source_report_file: report.absolute,
      source_thresholds_file: thresholds?.absolute ?? null,
      summary: built.summary,
      actions: built.actions,
    };

    const outWrite = writeJsonIfChanged(args.out, payload);
    payload.output_file = outWrite.path;
    payload.output_written = outWrite.written;

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Constraint report: ${payload.source_report_file}`);
    console.log(`Actions generated: ${payload.summary.generated_actions}`);
    console.log(`Quick wins: ${payload.summary.quick_wins}`);
    console.log(`Foundational: ${payload.summary.foundational}`);
    console.log(`Deep change: ${payload.summary.deep_change}`);
    if (payload.actions.length > 0) {
      console.log(`Top action: ${payload.actions[0].action_id} (priority=${payload.actions[0].priority_score})`);
    }
    console.log(`Output file: ${payload.output_file} (${payload.output_written ? "written" : "unchanged"})`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
