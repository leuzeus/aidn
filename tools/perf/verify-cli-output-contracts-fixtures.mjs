#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    json: false,
    keepTmp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
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
  console.log("  node tools/perf/verify-cli-output-contracts-fixtures.mjs --json");
  console.log("  node tools/perf/verify-cli-output-contracts-fixtures.mjs --target tests/fixtures/repo-installed-core");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_DIR = path.join(REPO_ROOT, "src", "core", "contracts", "cli-output");
const AIDN_BIN = path.join(REPO_ROOT, "bin", "aidn.mjs");

const CONTRACT_CASES = [
  {
    name: "runtime-project-runtime-state",
    schema: "runtime-project-runtime-state.v1.schema.json",
    args: ["runtime", "project-runtime-state", "--dry-run", "--json"],
    noMutationPaths: ["docs/audit/RUNTIME-STATE.md"],
  },
  {
    name: "runtime-project-handoff-packet",
    schema: "runtime-project-handoff-packet.v1.schema.json",
    args: ["runtime", "project-handoff-packet", "--dry-run", "--json"],
    noMutationPaths: ["docs/audit/HANDOFF-PACKET.md"],
  },
  {
    name: "runtime-pre-write-admit",
    schema: "runtime-pre-write-admit.v1.schema.json",
    args: ["runtime", "pre-write-admit", "--skill", "cycle-create", "--json"],
  },
  {
    name: "runtime-db-status",
    schema: "runtime-db-status.v1.schema.json",
    args: ["runtime", "db-status", "--json"],
  },
  {
    name: "runtime-db-migrate",
    schema: "runtime-db-migrate.v1.schema.json",
    args: ["runtime", "db-migrate", "--json"],
  },
  {
    name: "runtime-db-backup",
    schema: "runtime-db-backup.v1.schema.json",
    args: ["runtime", "db-backup", "--json"],
  },
  {
    name: "runtime-persistence-adopt",
    schema: "runtime-persistence-adopt.v1.schema.json",
    args: ["runtime", "persistence-adopt", "--backend", "postgres", "--dry-run", "--json"],
  },
  {
    name: "runtime-persistence-source-diagnose",
    schema: "runtime-persistence-source-diagnose.v1.schema.json",
    args: ["runtime", "persistence-source-diagnose", "--json"],
  },
  {
    name: "runtime-shared-coordination-status",
    schema: "runtime-shared-coordination-status.v1.schema.json",
    args: ["runtime", "shared-coordination-status", "--json"],
  },
  {
    name: "runtime-shared-coordination-migrate",
    schema: "runtime-shared-coordination-migrate.v1.schema.json",
    args: ["runtime", "shared-coordination-migrate", "--dry-run", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-shared-coordination-projects",
    schema: "runtime-shared-coordination-projects.v1.schema.json",
    args: ["runtime", "shared-coordination-projects", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-shared-coordination-backup",
    schema: "runtime-shared-coordination-backup.v1.schema.json",
    args: ["runtime", "shared-coordination-backup", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-shared-coordination-restore",
    schema: "runtime-shared-coordination-restore.v1.schema.json",
    args: ["runtime", "shared-coordination-restore", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-shared-coordination-doctor",
    schema: "runtime-shared-coordination-doctor.v1.schema.json",
    args: ["runtime", "shared-coordination-doctor", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-governance-diagnostics",
    schema: "runtime-governance-diagnostics.v1.schema.json",
    args: ["runtime", "governance-diagnostics", "--json"],
  },
  {
    name: "runtime-list-agent-adapters",
    schema: "runtime-list-agent-adapters.v1.schema.json",
    args: ["runtime", "list-agent-adapters", "--json"],
  },
  {
    name: "runtime-verify-agent-roster",
    schema: "runtime-verify-agent-roster.v1.schema.json",
    args: ["runtime", "verify-agent-roster", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-project-agent-health-summary",
    schema: "runtime-project-agent-health-summary.v1.schema.json",
    args: ["runtime", "project-agent-health-summary", "--json"],
  },
  {
    name: "runtime-project-agent-selection-summary",
    schema: "runtime-project-agent-selection-summary.v1.schema.json",
    args: ["runtime", "project-agent-selection-summary", "--json"],
  },
  {
    name: "runtime-coordinator-select-agent",
    schema: "runtime-coordinator-select-agent.v1.schema.json",
    args: ["runtime", "coordinator-select-agent", "--role", "auditor", "--action", "audit", "--json"],
  },
  {
    name: "runtime-coordinator-next-action",
    schema: "runtime-coordinator-next-action.v1.schema.json",
    args: ["runtime", "coordinator-next-action", "--json"],
  },
  {
    name: "runtime-coordinator-dispatch-plan",
    schema: "runtime-coordinator-dispatch-plan.v1.schema.json",
    args: ["runtime", "coordinator-dispatch-plan", "--json"],
  },
  {
    name: "runtime-coordinator-dispatch-execute",
    schema: "runtime-coordinator-dispatch-execute.v1.schema.json",
    args: ["runtime", "coordinator-dispatch-execute", "--json"],
  },
  {
    name: "runtime-coordinator-orchestrate",
    schema: "runtime-coordinator-orchestrate.v1.schema.json",
    args: ["runtime", "coordinator-orchestrate", "--max-iterations", "1", "--json"],
  },
  {
    name: "runtime-coordinator-resume",
    schema: "runtime-coordinator-resume.v1.schema.json",
    args: ["runtime", "coordinator-resume", "--json"],
  },
  {
    name: "runtime-coordinator-suggest-arbitration",
    schema: "runtime-coordinator-suggest-arbitration.v1.schema.json",
    args: ["runtime", "coordinator-suggest-arbitration", "--json"],
  },
  {
    name: "runtime-coordinator-record-arbitration",
    schema: "runtime-coordinator-record-arbitration.v1.schema.json",
    args: ["runtime", "coordinator-record-arbitration", "--decision", "continue", "--note", "validated by user", "--json"],
  },
  {
    name: "runtime-handoff-admit",
    schema: "runtime-handoff-admit.v1.schema.json",
    args: ["runtime", "handoff-admit", "--json"],
    allowNonZero: true,
  },
  {
    name: "project-config-list",
    schema: "project-config-list.v1.schema.json",
    args: ["project", "config", "--list", "--json"],
  },
  {
    name: "codex-hydrate-context",
    schema: "codex-hydrate-context.v1.schema.json",
    args: ["codex", "hydrate-context", "--skill", "context-reload", "--json"],
  },
];

function copyFixture(sourceRoot) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
  const tmpRoot = path.join(REPO_ROOT, "tests", "fixtures", `tmp-cli-output-contracts-${stamp}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.cpSync(sourceRoot, tmpRoot, {
    recursive: true,
    filter(source) {
      const normalized = source.replace(/\\/g, "/");
      return !normalized.includes("/.git/");
    },
  });
  return tmpRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileDigest(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotPaths(root, relativePaths = []) {
  return Object.fromEntries(relativePaths.map((relativePath) => {
    const absolutePath = path.resolve(root, relativePath);
    return [relativePath, fileDigest(absolutePath)];
  }));
}

function comparePathSnapshot(root, beforeSnapshot = {}) {
  const issues = [];
  for (const [relativePath, beforeDigest] of Object.entries(beforeSnapshot)) {
    const afterDigest = fileDigest(path.resolve(root, relativePath));
    if (beforeDigest !== afterDigest) {
      issues.push(`${relativePath}: changed during dry-run contract verification`);
    }
  }
  return issues;
}

function normalizeTypes(typeSpec) {
  if (Array.isArray(typeSpec)) {
    return typeSpec;
  }
  if (typeof typeSpec === "string" && typeSpec.trim()) {
    return [typeSpec.trim()];
  }
  return [];
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeMatches(value, allowedTypes) {
  if (allowedTypes.length === 0) {
    return true;
  }
  const actual = valueType(value);
  if (actual === "number" && allowedTypes.includes("integer") && Number.isInteger(value)) {
    return true;
  }
  return allowedTypes.includes(actual);
}

function validateAgainstSchema(payload, schema, location = "$") {
  const issues = [];
  const allowedTypes = normalizeTypes(schema.type);
  if (!typeMatches(payload, allowedTypes)) {
    issues.push(`${location}: expected ${allowedTypes.join("|")}, got ${valueType(payload)}`);
    return issues;
  }
  if (schema.type === "object" || allowedTypes.includes("object")) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const fieldName of required) {
      if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) {
        issues.push(`${location}.${fieldName}: missing required field`);
      }
    }
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) {
        continue;
      }
      issues.push(...validateAgainstSchema(payload[fieldName], fieldSchema, `${location}.${fieldName}`));
    }
  }
  return issues;
}

function extractJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    throw new Error("stdout is empty");
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("stdout does not contain a JSON object");
  }
}

function runCase(tmpRoot, testCase) {
  const schemaPath = path.join(CONTRACT_DIR, testCase.schema);
  const schema = readJson(schemaPath);
  const beforeSnapshot = snapshotPaths(tmpRoot, testCase.noMutationPaths ?? []);
  const result = spawnSync(process.execPath, [
    AIDN_BIN,
    ...testCase.args,
    "--target",
    tmpRoot,
  ], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  });
  const exitOk = result.status === 0 || testCase.allowNonZero === true;
  if (!exitOk) {
    return {
      name: testCase.name,
      ok: false,
      status: "command-failed",
      exit_code: result.status,
      stderr: String(result.stderr ?? "").trim(),
      issues: [`command exited with ${result.status}`],
    };
  }
  let payload = null;
  try {
    payload = extractJson(result.stdout);
  } catch (error) {
    return {
      name: testCase.name,
      ok: false,
      status: "json-parse-failed",
      exit_code: result.status,
      stderr: String(result.stderr ?? "").trim(),
      issues: [error.message],
    };
  }
  const issues = [
    ...validateAgainstSchema(payload, schema),
    ...comparePathSnapshot(tmpRoot, beforeSnapshot),
  ];
  return {
    name: testCase.name,
    ok: issues.length === 0,
    status: issues.length === 0 ? "pass" : "schema-failed",
    schema: testCase.schema,
    command: schema["x-aidn-command"],
    exit_code: result.status,
    issues,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(REPO_ROOT, args.target);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Target fixture not found: ${sourceRoot}`);
  }
  const tmpRoot = copyFixture(sourceRoot);
  const results = [];
  try {
    for (const testCase of CONTRACT_CASES) {
      results.push(runCase(tmpRoot, testCase));
    }
  } finally {
    if (!args.keepTmp) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
  const output = {
    ok: results.every((item) => item.ok),
    target_root: sourceRoot,
    tmp_root: args.keepTmp ? tmpRoot : "removed",
    checked_contracts: results.length,
    results,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`CLI output contracts: ${output.ok ? "PASS" : "FAIL"}`);
    for (const result of results) {
      console.log(`- ${result.name}: ${result.status}`);
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }
  }
  if (!output.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  printUsage();
  process.exit(1);
}
