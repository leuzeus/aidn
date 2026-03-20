#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SKILL_SPECS = [
  {
    name: "start-session",
    required: [
      "docs/audit/CURRENT-STATE.md",
      "Only create/update session file",
      "npx aidn runtime session-plan --target .",
      "active_backlog",
      "preferred_dispatch_source=shared_planning",
      "repair_primary_reason",
    ],
  },
  {
    name: "close-session",
    required: [
      "docs/audit/CURRENT-STATE.md",
      "active session / cycle summary after close decision",
      "next actions",
      "repair_primary_reason",
    ],
  },
  {
    name: "pr-orchestrate",
    required: [
      "docs/audit/CURRENT-STATE.md",
      "session_pr_status",
      "session_pr_review_status",
      "post_merge_sync_status",
      "repair_primary_reason",
    ],
  },
  {
    name: "cycle-create",
    required: [
      "Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.",
      "Update `docs/audit/CURRENT-STATE.md`:",
      "backlog_selected_execution_scope=new_cycle",
      "npx aidn runtime session-plan --target . --selected-execution-scope new_cycle --promote --json",
      "repair_primary_reason",
    ],
  },
  {
    name: "cycle-close",
    required: [
      "Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.",
      "Update `docs/audit/CURRENT-STATE.md` when present:",
      "repair_primary_reason",
    ],
  },
  {
    name: "convert-to-spike",
    required: [
      "Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.",
      "Update `docs/audit/CURRENT-STATE.md` when present:",
      "repair_primary_reason",
    ],
  },
  {
    name: "promote-baseline",
    required: [
      "Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.",
      "Update `docs/audit/CURRENT-STATE.md` when present:",
      "repair_primary_reason",
    ],
  },
  {
    name: "branch-cycle-audit",
    required: [
      "keep `docs/audit/CURRENT-STATE.md` consistent with the same decision.",
      "If snapshot is updated, also update `docs/audit/CURRENT-STATE.md` when present:",
      "repair_primary_reason",
    ],
  },
  {
    name: "drift-check",
    required: [
      "keep `docs/audit/CURRENT-STATE.md` aligned with the resulting next action.",
      "refresh `docs/audit/CURRENT-STATE.md` when present",
      "repair_primary_reason",
    ],
  },
  {
    name: "requirements-delta",
    required: [
      "keep `docs/audit/CURRENT-STATE.md` aligned at summary level.",
      "update `docs/audit/CURRENT-STATE.md` when present",
      "repair_primary_reason",
    ],
  },
  {
    name: "handoff-close",
    required: [
      "Keep `docs/audit/CURRENT-STATE.md` summary-only if updated.",
      "Update `docs/audit/CURRENT-STATE.md` when present:",
      "next agent goal",
      "npx aidn runtime session-plan --target .",
      "backlog_refs",
      "preferred_dispatch_source",
      "repair_primary_reason",
    ],
  },
];

function parseArgs(argv) {
  const args = {
    root: "scaffold/codex",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") {
      args.root = String(argv[i + 1] ?? "").trim();
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
  if (!args.root) {
    throw new Error("Missing value for --root");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-current-state-skill-coverage.mjs");
  console.log("  node tools/perf/verify-current-state-skill-coverage.mjs --root scaffold/codex --json");
  console.log("  node tools/perf/verify-current-state-skill-coverage.mjs --root tests/fixtures/repo-installed-core/.codex/skills --json");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function checkSkill(root, spec) {
  const file = path.resolve(process.cwd(), root, spec.name, "SKILL.md");
  if (!fs.existsSync(file)) {
    return {
      skill: spec.name,
      file,
      pass: false,
      missing_file: true,
      missing_patterns: spec.required,
    };
  }

  const text = readText(file);
  const missingPatterns = spec.required.filter((pattern) => !text.includes(pattern));

  return {
    skill: spec.name,
    file,
    pass: missingPatterns.length === 0,
    missing_file: false,
    missing_patterns: missingPatterns,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const checks = SKILL_SPECS.map((spec) => checkSkill(args.root, spec));
    const pass = checks.every((item) => item.pass === true);

    const output = {
      ts: new Date().toISOString(),
      root: path.resolve(process.cwd(), args.root),
      checks,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Root: ${output.root}`);
      for (const item of checks) {
        console.log(`${item.pass ? "PASS" : "FAIL"} ${item.skill} -> ${item.file}`);
        if (item.missing_patterns.length > 0) {
          console.log(`  Missing: ${item.missing_patterns.join(" | ")}`);
        }
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
