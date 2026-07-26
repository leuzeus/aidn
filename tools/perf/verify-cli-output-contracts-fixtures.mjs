#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  listSupportedSchemaKeywords,
  validateJsonSchema,
  validateJsonSchemaDefinition,
} from "../../src/core/contracts/json-schema-validator.mjs";
import { listDispatchableCommandDescriptors } from "../../src/core/cli/command-registry.mjs";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

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
    name: "bootstrap",
    schema: "bootstrap.v1.schema.json",
    args: ["bootstrap", "--profile", "minimal", "--json"],
    env(tmpRoot) {
      const binDir = path.join(tmpRoot, ".contract-prerequisite-bin");
      fs.mkdirSync(binDir, { recursive: true });
      if (process.platform === "win32") {
        fs.writeFileSync(path.join(binDir, "codex.cmd"), [
          "@echo off",
          "if \"%1\"==\"login\" if \"%2\"==\"status\" echo Logged in",
          "exit /b 0",
          "",
        ].join("\r\n"), "utf8");
      } else {
        const commandPath = path.join(binDir, "codex");
        fs.writeFileSync(commandPath, "#!/usr/bin/env sh\necho \"Logged in\"\n", "utf8");
        fs.chmodSync(commandPath, 0o755);
      }
      return {
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      };
    },
  },
  {
    name: "bootstrap-preview",
    schema: "bootstrap-preview.v1.schema.json",
    args: ["bootstrap", "--profile", "minimal", "--dry-run", "--json"],
  },
  {
    name: "runtime-project-runtime-state",
    schema: "runtime-project-runtime-state.v1.schema.json",
    args: ["runtime", "project-runtime-state", "--json"],
    noMutationPaths: ["docs/audit/RUNTIME-STATE.md"],
  },
  {
    name: "runtime-project-handoff-packet",
    schema: "runtime-project-handoff-packet.v1.schema.json",
    args: ["runtime", "project-handoff-packet", "--json"],
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
    name: "runtime-db-only-readiness",
    schema: "runtime-db-only-readiness.v1.schema.json",
    args: ["runtime", "db-only-readiness", "--json"],
  },
  {
    name: "runtime-persistence-status",
    schema: "runtime-persistence-status.v1.schema.json",
    args: ["runtime", "persistence-status", "--json"],
  },
  {
    name: "runtime-db-migrate",
    schema: "runtime-db-migrate.v1.schema.json",
    args: ["runtime", "db-migrate", "--json"],
  },
  {
    name: "runtime-persistence-migrate",
    schema: "runtime-persistence-migrate.v1.schema.json",
    args: ["runtime", "persistence-migrate", "--json"],
  },
  {
    name: "runtime-db-backup",
    schema: "runtime-db-backup.v1.schema.json",
    args: ["runtime", "db-backup", "--json"],
  },
  {
    name: "runtime-persistence-backup",
    schema: "runtime-persistence-backup.v1.schema.json",
    args: ["runtime", "persistence-backup", "--json"],
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
    name: "runtime-persistence-source-normalize",
    schema: "runtime-persistence-source-normalize.v1.schema.json",
    args: [
      "runtime",
      "persistence-source-normalize",
      "--rename",
      "C004-spike-root-structure-investigation=C020-spike-root-structure-investigation",
      "--dry-run",
      "--json",
    ],
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
    name: "runtime-shared-runtime-reanchor",
    schema: "runtime-shared-runtime-reanchor.v1.schema.json",
    args: ["runtime", "shared-runtime-reanchor", "--json"],
    allowNonZero: true,
  },
  {
    name: "runtime-state-reanchor",
    schema: "runtime-state-reanchor.v1.schema.json",
    args: ["runtime", "state-reanchor", "--json"],
    noMutationPaths: [
      "docs/audit/CURRENT-STATE.md",
      "docs/audit/RUNTIME-STATE.md",
      "docs/audit/HANDOFF-PACKET.md",
    ],
  },
  {
    name: "runtime-shared-coordination-bootstrap",
    schema: "runtime-shared-coordination-bootstrap.v1.schema.json",
    args: ["runtime", "shared-coordination-bootstrap", "--json"],
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
    name: "runtime-project-integration-risk",
    schema: "runtime-project-integration-risk.v1.schema.json",
    args: ["runtime", "project-integration-risk", "--json"],
  },
  {
    name: "runtime-project-multi-agent-status",
    schema: "runtime-project-multi-agent-status.v1.schema.json",
    args: ["runtime", "project-multi-agent-status", "--json"],
  },
  {
    name: "runtime-project-coordination-summary",
    schema: "runtime-project-coordination-summary.v1.schema.json",
    args: ["runtime", "project-coordination-summary", "--json"],
  },
  {
    name: "runtime-sync-db-first",
    schema: "runtime-sync-db-first.v1.schema.json",
    args: ["runtime", "sync-db-first", "--json"],
  },
  {
    name: "runtime-sync-db-first-selective",
    schema: "runtime-sync-db-first-selective.v1.schema.json",
    args: ["runtime", "sync-db-first-selective", "--json"],
  },
  {
    name: "runtime-mode-migrate",
    schema: "runtime-mode-migrate.v1.schema.json",
    args: ["runtime", "mode-migrate", "--to", "dual", "--json"],
    noMutationPaths: [
      ".aidn/config.json",
      ".aidn/runtime/index/workflow-index.json",
      ".aidn/runtime/index/workflow-index.sqlite",
      ".aidn/runtime/index/repair-layer-report.json",
      ".aidn/runtime/index/repair-layer-triage.json",
      ".aidn/runtime/index/repair-layer-triage-summary.md",
    ],
  },
  {
    name: "runtime-session-plan",
    schema: "runtime-session-plan.v1.schema.json",
    args: ["runtime", "session-plan", "--session-id", "S401", "--item", "define session backlog", "--json"],
  },
  {
    name: "runtime-db-first-artifact",
    schema: "runtime-db-first-artifact.v1.schema.json",
    args: [
      "runtime",
      "db-first-artifact",
      "--path",
      "snapshots/context-snapshot.md",
      "--source-file",
      "docs/audit/snapshots/context-snapshot.md",
      "--kind",
      "snapshot",
      "--family",
      "normative",
      "--json",
    ],
  },
  {
    name: "runtime-artifact-store-list",
    schema: "runtime-artifact-store-list.v1.schema.json",
    args: ["runtime", "artifact-store", "list", "--json"],
  },
  {
    name: "runtime-artifact-store-upsert",
    schema: "runtime-artifact-store-upsert.v1.schema.json",
    args: [
      "runtime",
      "artifact-store",
      "upsert",
      "--path",
      "snapshots/context-snapshot.md",
      "--kind",
      "snapshot",
      "--family",
      "normative",
      "--content-file",
      "docs/audit/snapshots/context-snapshot.md",
      "--json",
    ],
  },
  {
    name: "runtime-artifact-store-get",
    schema: "runtime-artifact-store-get.v1.schema.json",
    args: ["runtime", "artifact-store", "get", "--path", "snapshots/context-snapshot.md", "--json"],
  },
  {
    name: "runtime-artifact-fetch",
    schema: "runtime-artifact-fetch.v1.schema.json",
    args: ["runtime", "artifact-fetch", "--path", "snapshots/context-snapshot.md", "--json"],
  },
  {
    name: "runtime-artifact-store-materialize",
    schema: "runtime-artifact-store-materialize.v1.schema.json",
    args: ["runtime", "artifact-store", "materialize", "--audit-root", "docs/audit", "--only-path", "snapshots/context-snapshot.md", "--dry-run", "--json"],
  },
  {
    name: "runtime-visible-artifacts-cleanup",
    schema: "runtime-visible-artifacts-cleanup.v1.schema.json",
    args: ["runtime", "visible-artifacts-cleanup", "--json"],
  },
  {
    name: "runtime-visible-artifacts-restore",
    schema: "runtime-visible-artifacts-restore.v1.schema.json",
    args(tmpRoot) {
      const backupRoot = path.join(tmpRoot, ".tmp-visible-artifacts-restore-backup");
      fs.rmSync(backupRoot, { recursive: true, force: true });
      fs.mkdirSync(path.join(backupRoot, "quarantine"), { recursive: true });
      for (const relative of ["docs/audit", ".codex"]) {
        const source = path.join(tmpRoot, relative);
        if (fs.existsSync(source)) {
          fs.cpSync(source, path.join(backupRoot, "quarantine", relative), { recursive: true, force: true });
        }
      }
      return ["runtime", "visible-artifacts-restore", "--from", backupRoot, "--json"];
    },
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
    name: "runtime-coordinator-loop",
    schema: "runtime-coordinator-loop.v1.schema.json",
    args: ["runtime", "coordinator-loop", "--json"],
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
    name: "project-config-preview",
    schema: "project-config-preview.v1.schema.json",
    args: ["project", "config", "--init-defaults", "--project-name", "preview-project", "--json"],
    noMutationPaths: [".aidn/project/workflow.adapter.json"],
  },
  {
    name: "project-config-write",
    schema: "project-config-write.v1.schema.json",
    args: ["project", "config", "--init-defaults", "--project-name", "write-project", "--write", "--json"],
  },
  {
    name: "codex-hydrate-context",
    schema: "codex-hydrate-context.v1.schema.json",
    args: ["codex", "hydrate-context", "--skill", "context-reload", "--json"],
  },
  {
    name: "codex-workflow-step",
    schema: "codex-workflow-step.v1.schema.json",
    args: ["codex", "workflow-step", "--skills", "context-reload", "--mode", "THINKING", "--json"],
  },
];

function prepareBaseFixture(sourceRoot, tempRoot) {
  const baseRoot = path.join(tempRoot, "base");
  fs.cpSync(sourceRoot, baseRoot, {
    recursive: true,
    filter(source) {
      const normalized = source.replace(/\\/g, "/");
      return !normalized.includes("/.git/");
    },
  });
  initGitRepo(baseRoot, {
    sourceBranch: "dev",
    workingBranch: "feature/C101-contracts",
  });
  const seed = spawnSync(process.execPath, [
    path.join(REPO_ROOT, "tools", "perf", "index-sync.mjs"),
    "--target",
    baseRoot,
    "--store",
    "dual-sqlite",
    "--with-content",
    "--json",
  ], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (seed.status !== 0) {
    throw new Error(`Unable to seed isolated contract fixture: ${String(seed.stderr || seed.stdout).trim()}`);
  }
  return baseRoot;
}

function copyCaseFixture(baseRoot, tempRoot, testCase, index) {
  const safeName = String(testCase.name ?? `case-${index}`)
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const caseRoot = path.join(tempRoot, `${String(index).padStart(2, "0")}-${safeName}`);
  fs.cpSync(baseRoot, caseRoot, { recursive: true });
  return caseRoot;
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
  const caseArgs = typeof testCase.args === "function" ? testCase.args(tmpRoot) : testCase.args;
  const caseEnv = typeof testCase.env === "function" ? testCase.env(tmpRoot) : (testCase.env ?? {});
  const beforeSnapshot = snapshotPaths(tmpRoot, testCase.noMutationPaths ?? []);
  const result = spawnSync(process.execPath, [
    AIDN_BIN,
    ...caseArgs,
    "--target",
    tmpRoot,
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...caseEnv,
    },
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  const processCompleted = Number.isInteger(result.status);
  const exitOk = processCompleted && (result.status === 0 || testCase.allowNonZero === true);
  if (!exitOk) {
    const processError = result.error instanceof Error ? result.error.message : "";
    const signal = String(result.signal ?? "").trim();
    return {
      name: testCase.name,
      ok: false,
      status: "command-failed",
      exit_code: result.status,
      signal: signal || null,
      stdout: String(result.stdout ?? "").trim(),
      stderr: String(result.stderr ?? "").trim(),
      issues: [
        processError || `command did not complete with an integer exit code (status=${String(result.status)})`,
        ...(signal ? [`command terminated by signal ${signal}`] : []),
      ],
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
    ...validateJsonSchema(payload, schema),
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

function schemaFiles() {
  return fs.readdirSync(CONTRACT_DIR)
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
}

function verifyContractClosure() {
  const schemas = schemaFiles();
  const cases = CONTRACT_CASES.map((item) => item.schema).sort();
  const registryContracts = [...new Set(
    listDispatchableCommandDescriptors()
      .filter((item) => item.visibility === "public")
      .flatMap((item) => item.json_contracts),
  )].sort();
  const issues = [];
  const duplicateCases = cases.filter((name, index) => cases.indexOf(name) !== index);
  for (const name of [...new Set(duplicateCases)]) {
    issues.push(`${name}: schema has more than one executable contract case`);
  }
  for (const schema of schemas) {
    if (!cases.includes(schema)) {
      issues.push(`${schema}: active public contract has no executable case`);
    }
    const definition = readJson(path.join(CONTRACT_DIR, schema));
    issues.push(...validateJsonSchemaDefinition(definition)
      .map((issue) => `${schema}: ${issue}`));
    const expectedId = `aidn://contracts/cli-output/${schema.replace(/\.schema\.json$/, "")}`;
    if (definition.$id !== expectedId) {
      issues.push(`${schema}: $id mismatch (${String(definition.$id)} != ${expectedId})`);
    }
  }
  for (const schema of cases) {
    if (!schemas.includes(schema)) {
      issues.push(`${schema}: executable case is orphaned from the contract directory`);
    }
  }
  for (const schema of schemas) {
    if (!registryContracts.includes(schema)) {
      issues.push(`${schema}: active schema is absent from the dispatch registry`);
    }
  }
  for (const schema of registryContracts) {
    if (!schemas.includes(schema)) {
      issues.push(`${schema}: registry contract is absent from the contract directory`);
    }
  }
  return {
    schemas: schemas.length,
    cases: cases.length,
    registry_contracts: registryContracts.length,
    executable_outputs: cases.length,
    issues,
  };
}

function runMetaSchemaMutationFixtures() {
  const valid = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "aidn://contracts/cli-output/meta-probe.v1",
    title: "meta probe",
    type: "object",
    required: ["value"],
    properties: {
      value: { type: "string", enum: ["safe"] },
      records: { type: "array", items: { type: "integer" } },
    },
    additionalProperties: false,
    "x-aidn-command": "aidn meta-probe --json",
    "x-aidn-contract-version": "cli-output-v1",
  };
  const mutations = [
    ["type-number", { ...valid, type: 42 }],
    ["type-invalid-array", { ...valid, type: ["object", "object"] }],
    ["required-string", { ...valid, required: "value" }],
    ["required-duplicate", { ...valid, required: ["value", "value"] }],
    ["properties-array", { ...valid, properties: [] }],
    ["enum-string", { ...valid, properties: { value: { enum: "safe" } } }],
    ["enum-empty", { ...valid, properties: { value: { enum: [] } } }],
    ["items-array", { ...valid, properties: { records: { type: "array", items: [] } } }],
    ["additional-properties-string", { ...valid, additionalProperties: "false" }],
    ["minimum-string", { ...valid, minimum: "0" }],
    ["min-length-negative", { ...valid, minLength: -1 }],
    ["pattern-invalid", { ...valid, pattern: "[" }],
    ["format-unsupported", { ...valid, format: "secret" }],
    ["one-of-object", { ...valid, oneOf: {} }],
    ["unknown-keyword", { ...valid, ignoredKeyword: true }],
    ["nested-invalid", {
      ...valid,
      properties: { value: { type: 42 } },
    }],
    ["schema-missing", { ...valid, $schema: undefined }],
    ["schema-draft", { ...valid, $schema: "https://json-schema.org/draft/2020-12/schema" }],
    ["id-missing", { ...valid, $id: undefined }],
    ["id-shape", { ...valid, $id: "https://example.invalid/schema" }],
    ["commands-shape", {
      ...valid,
      "x-aidn-command": undefined,
      "x-aidn-commands": "aidn meta-probe --json",
    }],
  ];
  const results = mutations.map(([name, schema]) => {
    const cleaned = Object.fromEntries(
      Object.entries(schema).filter(([, value]) => value !== undefined),
    );
    const issues = validateJsonSchemaDefinition(cleaned);
    return { name, rejected: issues.length > 0, issue_count: issues.length };
  });
  const schemas = schemaFiles();
  const forward = schemas.map((name) => validateJsonSchemaDefinition(
    readJson(path.join(CONTRACT_DIR, name)),
  ).length);
  const reverse = [...schemas].reverse().map((name) => validateJsonSchemaDefinition(
    readJson(path.join(CONTRACT_DIR, name)),
  ).length).reverse();
  return {
    ok: validateJsonSchemaDefinition(valid).length === 0
      && results.every((item) => item.rejected)
      && JSON.stringify(forward) === JSON.stringify(reverse),
    results,
    reverse_order_deterministic: JSON.stringify(forward) === JSON.stringify(reverse),
  };
}

function runValidatorNegativeFixtures() {
  const combinedSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "aidn://contracts/cli-output/combined-negative-probe.v1",
    type: "object",
    required: ["contract_version", "records", "redaction"],
    properties: {
      contract_version: { const: "v1" },
      records: {
        type: "array",
        items: {
          type: "object",
          required: ["kind"],
          properties: {
            kind: { type: "string", enum: ["safe"] },
          },
          additionalProperties: false,
        },
      },
      redaction: {
        type: "object",
        required: ["connection_string"],
        properties: {
          connection_string: { type: "string", enum: ["", "[redacted]"] },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
  const validPayload = {
    contract_version: "v1",
    records: [{ kind: "safe" }],
    redaction: { connection_string: "[redacted]" },
  };
  const fixtures = [
    ["type", { ...validPayload, records: "not-an-array" }],
    ["required", { records: [], redaction: validPayload.redaction }],
    ["properties", { ...validPayload, records: [{ kind: 17 }] }],
    ["const", { ...validPayload, contract_version: "v2" }],
    ["enum", { ...validPayload, records: [{ kind: "unsafe" }] }],
    ["items", { ...validPayload, records: [17] }],
    ["additionalProperties", { ...validPayload, unexpected: true }],
    ["redaction", {
      ...validPayload,
      redaction: { connection_string: "postgres://secret@example.invalid/db" },
    }],
    ["combined", {
      contract_version: "v2",
      records: [{ kind: "unsafe", leaked: true }],
      redaction: { connection_string: "postgres://secret@example.invalid/db" },
      unexpected: true,
    }],
  ];
  const results = fixtures.map(([name, payload]) => {
    const issues = validateJsonSchema(payload, combinedSchema);
    return {
      name,
      rejected: issues.length > 0,
      issue_count: issues.length,
    };
  });
  return {
    ok: validateJsonSchema(validPayload, combinedSchema).length === 0
      && results.every((item) => item.rejected),
    results,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(REPO_ROOT, args.target);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Target fixture not found: ${sourceRoot}`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-cli-output-contracts-"));
  let baseRoot = "";
  const results = [];
  const closure = verifyContractClosure();
  const validatorNegativeFixtures = runValidatorNegativeFixtures();
  const metaSchemaMutationFixtures = runMetaSchemaMutationFixtures();
  try {
    baseRoot = prepareBaseFixture(sourceRoot, tempRoot);
    for (const [index, testCase] of CONTRACT_CASES.entries()) {
      const caseRoot = copyCaseFixture(baseRoot, tempRoot, testCase, index);
      results.push(runCase(caseRoot, testCase));
    }
  } finally {
    if (!args.keepTmp) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
  const output = {
    ok: results.every((item) => item.ok)
      && closure.issues.length === 0
      && validatorNegativeFixtures.ok
      && metaSchemaMutationFixtures.ok,
    target_root: sourceRoot,
    fixture_setup: "isolated Git repository with a derived dual-sqlite projection per contract case; bootstrap uses only a local prerequisite command stub and is not installed-client proof",
    tmp_root: args.keepTmp ? tempRoot : "removed",
    checked_contracts: results.length,
    contract_closure: closure,
    validator: {
      supported_keywords: listSupportedSchemaKeywords(),
      negative_fixtures: validatorNegativeFixtures,
      meta_schema_mutations: metaSchemaMutationFixtures,
    },
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
  if (error && error.stack) {
    console.error(error.stack);
  }
  printUsage();
  process.exit(1);
}
