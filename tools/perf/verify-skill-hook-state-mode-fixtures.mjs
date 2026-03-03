#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SKILL_CASES = [
  { skill: "context-reload", mode: "THINKING", expectsStore: false },
  { skill: "branch-cycle-audit", mode: "COMMITTING", expectsStore: false },
  { skill: "drift-check", mode: "COMMITTING", expectsStore: false },
  { skill: "start-session", mode: "COMMITTING", expectsStore: true },
  { skill: "close-session", mode: "COMMITTING", expectsStore: true },
  { skill: "cycle-create", mode: "COMMITTING", expectsStore: true },
  { skill: "cycle-close", mode: "COMMITTING", expectsStore: true },
  { skill: "promote-baseline", mode: "COMMITTING", expectsStore: true },
  { skill: "requirements-delta", mode: "COMMITTING", expectsStore: true },
  { skill: "convert-to-spike", mode: "EXPLORING", expectsStore: true },
];

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--tmp-root") {
      args.tmpRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.tmpRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-skill-hook-state-mode-fixtures.mjs");
  console.log("  node tools/perf/verify-skill-hook-state-mode-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-skill-hook-state-mode-fixtures.mjs --tmp-root tests/fixtures --keep-tmp");
}

function copyFixtureToTmp(source, tmpRoot) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const destination = path.resolve(tmpRoot, `tmp-skill-hook-state-mode-${stamp}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function expectedStoreForStateMode(stateMode) {
  if (stateMode === "dual") {
    return "dual-sqlite";
  }
  if (stateMode === "db-only") {
    return "sqlite";
  }
  return "file";
}

function readStateMode(payload) {
  if (payload && typeof payload === "object") {
    if (typeof payload.state_mode === "string") {
      return payload.state_mode;
    }
    if (payload.checkpoint && typeof payload.checkpoint.state_mode === "string") {
      return payload.checkpoint.state_mode;
    }
  }
  return null;
}

function readIndexStore(payload) {
  if (payload && typeof payload === "object") {
    if (payload.index && typeof payload.index.store === "string") {
      return payload.index.store;
    }
    if (payload.checkpoint && payload.checkpoint.index && typeof payload.checkpoint.index.store === "string") {
      return payload.checkpoint.index.store;
    }
  }
  return null;
}

function runSkillCase(targetRoot, stateMode, skillCase) {
  const out = runJson("tools/perf/skill-hook.mjs", [
    "--skill",
    skillCase.skill,
    "--target",
    targetRoot,
    "--mode",
    skillCase.mode,
    "--json",
  ], {
    AIDN_STATE_MODE: stateMode,
    AIDN_INDEX_STORE_MODE: "",
  });
  const effectiveStateMode = readStateMode(out?.payload);
  const effectiveStore = readIndexStore(out?.payload);
  const expectedStore = expectedStoreForStateMode(stateMode);
  const checks = {
    hook_ok: out?.ok === true,
    state_mode_applied: effectiveStateMode === stateMode,
    store_mode_applied: skillCase.expectsStore ? effectiveStore === expectedStore : true,
  };
  return {
    state_mode: stateMode,
    skill: skillCase.skill,
    mode: skillCase.mode,
    checks,
    sample: {
      effective_state_mode: effectiveStateMode,
      effective_store: effectiveStore,
      expected_store: skillCase.expectsStore ? expectedStore : null,
      tool: out?.tool ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function main() {
  let tmpTarget = null;
  let keepTmp = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const sourceTarget = path.resolve(process.cwd(), args.target);
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    tmpTarget = copyFixtureToTmp(sourceTarget, tmpRoot);

    const runs = [];
    for (const stateMode of ["dual", "db-only"]) {
      for (const skillCase of SKILL_CASES) {
        runs.push(runSkillCase(tmpTarget, stateMode, skillCase));
      }
    }

    const pass = runs.every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: tmpTarget,
      summary: {
        runs_total: runs.length,
        pass_count: runs.filter((run) => run.pass).length,
        fail_count: runs.filter((run) => !run.pass).length,
      },
      runs,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${output.source_target}`);
      console.log(`Working copy: ${output.target_root}`);
      const dualRuns = runs.filter((run) => run.state_mode === "dual");
      const dbOnlyRuns = runs.filter((run) => run.state_mode === "db-only");
      const dualPass = dualRuns.every((run) => run.pass);
      const dbOnlyPass = dbOnlyRuns.every((run) => run.pass);
      console.log(`Skill hooks dual mode: ${dualPass ? "PASS" : "FAIL"}`);
      console.log(`Skill hooks db-only mode: ${dbOnlyPass ? "PASS" : "FAIL"}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!keepTmp) {
      fs.rmSync(tmpTarget, { recursive: true, force: true });
      tmpTarget = null;
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    if (tmpTarget != null && !keepTmp) {
      fs.rmSync(tmpTarget, { recursive: true, force: true });
    }
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
