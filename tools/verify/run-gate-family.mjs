#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findCodexLauncher } from "./codex-discovery-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "package", "catalogs", "gates.v1.json"), "utf8"));
const requested = process.argv[2] ?? "";
const json = process.argv.includes("--json");
const contextIndex = process.argv.indexOf("--context");
const explicitContext = contextIndex >= 0 ? String(process.argv[contextIndex + 1] ?? "") : "";
const gateIndex = process.argv.indexOf("--gate");
const explicitGate = gateIndex >= 0 ? String(process.argv[gateIndex + 1] ?? "") : "";

if (!requested || ![...catalog.required_families, "all", "obligations"].includes(requested)) {
  console.error(`Usage: node tools/verify/run-gate-family.mjs <${[...catalog.required_families, "all", "obligations"].join("|")}> [--json] [--context dev|main|release]`);
  process.exit(1);
}
if (gateIndex >= 0 && !explicitGate) {
  console.error("Missing value for --gate");
  process.exit(1);
}
if (explicitContext && !["dev", "main", "release"].includes(explicitContext)) {
  console.error(`Invalid gate context: ${explicitContext}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCommand = fs.existsSync(npmCli) ? process.execPath : "npm";
const npmPrefix = fs.existsSync(npmCli) ? [npmCli] : [];
const results = [];
const executed = new Map();

function git(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
}

function inferContext() {
  if (explicitContext) {
    return explicitContext;
  }
  if (["dev", "main", "release"].includes(process.env.AIDN_GATE_CONTEXT)) {
    return process.env.AIDN_GATE_CONTEXT;
  }
  if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main") {
    return "main";
  }
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    return process.env.GITHUB_BASE_REF === "main" ? "release" : "dev";
  }
  const branchResult = git(["branch", "--show-current"]);
  const branch = branchResult.status === 0 ? String(branchResult.stdout).trim() : "";
  return branch.startsWith("release/") ? "release" : "dev";
}

function evaluateCondition(condition) {
  if (condition === "always") {
    return { met: true, reason: "always" };
  }
  if (condition === "git-repository") {
    const result = git(["rev-parse", "--is-inside-work-tree"]);
    return {
      met: result.status === 0 && String(result.stdout).trim() === "true",
      reason: "Git repository is required",
    };
  }
  if (condition === "git-clean-commit" || condition === "git-clean-worktree") {
    const head = git(["rev-parse", "--verify", "HEAD"]);
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    return {
      met: head.status === 0 && status.status === 0 && String(status.stdout).trim() === "",
      reason: "a clean Git commit is required",
    };
  }
  if (condition === "codex-cli-available") {
    return {
      met: Boolean(findCodexLauncher(process.env)),
      reason: "real Codex CLI is unavailable",
    };
  }
  if (condition === "postgres-smoke-url-available") {
    return {
      met: Boolean(String(process.env.AIDN_PG_SMOKE_URL ?? "").trim()),
      reason: "optional PostgreSQL live smoke URL is unavailable",
    };
  }
  return {
    met: false,
    reason: `unknown condition: ${condition}`,
  };
}

function diagnosticTail(value) {
  const postgresUrl = String(process.env.AIDN_PG_SMOKE_URL ?? "").trim();
  const redacted = postgresUrl
    ? String(value ?? "").replaceAll(postgresUrl, "[redacted]")
    : String(value ?? "");
  return redacted.slice(-8000);
}

const context = inferContext();
const selected = catalog.gates.filter(
  (gate) => (requested === "all"
      || requested === "obligations"
      || gate.family === requested)
    && (!explicitGate || gate.id === explicitGate),
);
if (explicitGate && selected.length !== 1) {
  console.error(`Unknown gate for ${requested}: ${explicitGate}`);
  process.exit(1);
}
for (const gate of selected) {
  const started = Date.now();
  const obligation = gate.obligation?.[context] ?? "required";
  if (obligation === "skip") {
    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status: "SKIP",
      obligation,
      condition: gate.condition,
      duration_ms: 0,
      reason: `catalog obligation is skip for ${context}`,
    });
    continue;
  }
  const condition = evaluateCondition(gate.condition);
  if (!condition.met) {
    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status: "SKIP",
      obligation,
      condition: gate.condition,
      duration_ms: 0,
      reason: condition.reason,
    });
    continue;
  }
  if (!packageJson.scripts?.[gate.script]) {
    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status: "FAIL",
      obligation,
      condition: gate.condition,
      duration_ms: 0,
      reason: "script is not available",
    });
    continue;
  }
  if (executed.has(gate.script)) {
    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status: executed.get(gate.script),
      obligation,
      condition: gate.condition,
      duration_ms: 0,
      reason: "deduplicated",
    });
    continue;
  }
  const result = spawnSync(npmCommand, [...npmPrefix, "run", gate.script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AIDN_GATE_CONTEXT: context,
    },
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 30 * 1024 * 1024,
    shell: false,
  });
  if (!json) {
    process.stdout.write(String(result.stdout ?? ""));
    process.stderr.write(String(result.stderr ?? ""));
  }
  const status = result.status === 0 ? "PASS" : "FAIL";
  executed.set(gate.script, status);
  results.push({
    id: gate.id,
    family: gate.family,
    script: gate.script,
    status,
    obligation,
    condition: gate.condition,
    duration_ms: Date.now() - started,
    exit_code: result.status,
    ...(status === "FAIL" ? {
      error: result.error?.message ?? null,
      signal: result.signal ?? null,
      stdout_tail: diagnosticTail(result.stdout),
      stderr_tail: diagnosticTail(result.stderr),
    } : {}),
  });
}

const counts = Object.fromEntries(catalog.outcomes.map((status) => [
  status,
  results.filter((item) => item.status === status).length,
]));
const output = {
  ok: counts.FAIL === 0
    && results.every((item) => item.status !== "SKIP" || item.obligation !== "required"),
  requested,
  context,
  outcomes: catalog.outcomes,
  counts,
  results,
};
if (json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`Gate family ${requested}: ${output.ok ? "PASS" : "FAIL"}`);
  for (const item of results) {
    console.log(`- ${item.id}: ${item.status} obligation=${item.obligation} (${item.duration_ms} ms)`);
  }
}
if (!output.ok) {
  process.exitCode = 1;
}
