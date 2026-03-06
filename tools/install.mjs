#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigStateMode,
  stateModeFromIndexStore,
  writeAidnProjectConfig,
} from "./aidn-config-lib.mjs";

const BLOCK_START = "<!-- CODEX-AUDIT-WORKFLOW START -->";
const BLOCK_END = "<!-- CODEX-AUDIT-WORKFLOW END -->";
const CUSTOMIZABLE_TARGET_PATTERNS = [
  "docs/audit/WORKFLOW.md",
  "docs/audit/index.md",
  "docs/audit/glossary.md",
  "docs/audit/parking-lot.md",
  "docs/audit/baseline/current.md",
  "docs/audit/baseline/history.md",
  "docs/audit/snapshots/context-snapshot.md",
];
const EXECUTION_MODES = new Set(["auto", "ask", "safe", "full"]);
const CODEX_SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const CODEX_APPROVAL_POLICIES = new Set(["untrusted", "on-failure", "on-request", "never"]);

function normalizeRelativePath(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function wildcardToRegex(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

const CUSTOMIZABLE_TARGET_REGEX = CUSTOMIZABLE_TARGET_PATTERNS.map((pattern) =>
  wildcardToRegex(normalizeRelativePath(pattern)),
);

function isCustomizableProjectFile(relativeTargetPath) {
  const normalized = normalizeRelativePath(relativeTargetPath);
  return CUSTOMIZABLE_TARGET_REGEX.some((regex) => regex.test(normalized));
}

function parseArgs(argv) {
  const args = {
    target: ".",
    pack: "",
    dryRun: false,
    verifyOnly: false,
    skipArtifactImport: false,
    artifactImportStore: "",
    assist: false,
    strict: false,
    skipAgents: false,
    forceAgentsMerge: false,
    codexMigrateCustom: true,
    codexMigrateCustomSource: "default",
    executionMode: "auto",
    codexSandbox: "",
    codexApproval: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--pack") {
      args.pack = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--verify") {
      args.verifyOnly = true;
    } else if (token === "--skip-artifact-import") {
      args.skipArtifactImport = true;
    } else if (token === "--artifact-import-store") {
      args.artifactImportStore = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--assist") {
      args.assist = true;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--skip-agents") {
      args.skipAgents = true;
    } else if (token === "--force-agents-merge") {
      args.forceAgentsMerge = true;
    } else if (token === "--codex-migrate-custom") {
      args.codexMigrateCustom = true;
      args.codexMigrateCustomSource = "cli";
    } else if (token === "--no-codex-migrate-custom") {
      args.codexMigrateCustom = false;
      args.codexMigrateCustomSource = "cli";
    } else if (token === "--execution-mode") {
      args.executionMode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--codex-sandbox") {
      args.codexSandbox = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--codex-approval") {
      args.codexApproval = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }
  if (args.artifactImportStore && !normalizeIndexStoreMode(args.artifactImportStore)) {
    throw new Error("Invalid --artifact-import-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }
  if (!EXECUTION_MODES.has(args.executionMode)) {
    throw new Error("Invalid --execution-mode. Expected auto|ask|safe|full");
  }
  if (args.codexSandbox && !CODEX_SANDBOX_MODES.has(args.codexSandbox)) {
    throw new Error("Invalid --codex-sandbox. Expected read-only|workspace-write|danger-full-access");
  }
  if (args.codexApproval && !CODEX_APPROVAL_POLICIES.has(args.codexApproval)) {
    throw new Error("Invalid --codex-approval. Expected untrusted|on-failure|on-request|never");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/install.mjs --target ../repo");
  console.log("  node tools/install.mjs --target ../repo --pack core");
  console.log("  node tools/install.mjs --target . --pack core --dry-run");
  console.log("  node tools/install.mjs --target . --pack core --verify");
  console.log("  node tools/install.mjs --target . --pack core --skip-artifact-import");
  console.log("  node tools/install.mjs --target . --pack core --artifact-import-store dual-sqlite");
  console.log("  node tools/install.mjs --target ../repo --pack core --assist");
  console.log("  node tools/install.mjs --target ../repo --pack core --strict");
  console.log("  node tools/install.mjs --target ../repo --pack core --skip-agents");
  console.log("  node tools/install.mjs --target ../repo --pack core --force-agents-merge");
  console.log("  node tools/install.mjs --target ../repo --pack core --codex-migrate-custom");
  console.log("  node tools/install.mjs --target ../repo --pack core --no-codex-migrate-custom");
  console.log("  node tools/install.mjs --target ../repo --pack core --execution-mode ask");
  console.log("  node tools/install.mjs --target ../repo --pack core --codex-sandbox workspace-write --codex-approval on-request");
}

function resolveAutoExecutionMode(runtime) {
  if (process.env.CODEX_THREAD_ID) {
    return { mode: "safe", reason: "nested_codex_environment" };
  }
  if (!runtime.codexInstalled) {
    return { mode: "safe", reason: "codex_not_installed" };
  }
  if (!runtime.codexAuthenticated) {
    return { mode: "safe", reason: "codex_not_authenticated" };
  }
  return { mode: "full", reason: "codex_ready" };
}

async function promptExecutionMode(defaultMode) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("");
    console.log("Select install execution mode:");
    console.log("  safe: disable Codex custom-file migration (recommended in restricted/read-only environments)");
    console.log("  full: enable Codex custom-file migration for preserved customized files");
    const answer = String(await rl.question(`Execution mode [${defaultMode}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultMode;
    }
    if (answer === "safe" || answer === "full") {
      return answer;
    }
    console.warn(`Invalid execution mode '${answer}', using '${defaultMode}'.`);
    return defaultMode;
  } finally {
    rl.close();
  }
}

async function resolveCodexMigrationExecution(args, runtime) {
  if (args.codexMigrateCustomSource === "cli") {
    return {
      mode: args.codexMigrateCustom ? "full" : "safe",
      source: "flag",
      reason: args.codexMigrateCustom ? "explicit_enable" : "explicit_disable",
      codexMigrateCustom: args.codexMigrateCustom,
    };
  }

  const auto = resolveAutoExecutionMode(runtime);
  if (args.executionMode === "auto") {
    return {
      mode: auto.mode,
      source: "auto",
      reason: auto.reason,
      codexMigrateCustom: auto.mode === "full",
    };
  }
  if (args.executionMode === "safe" || args.executionMode === "full") {
    return {
      mode: args.executionMode,
      source: "execution-mode",
      reason: "explicit_mode",
      codexMigrateCustom: args.executionMode === "full",
    };
  }
  if (args.executionMode === "ask") {
    if (args.dryRun || args.verifyOnly) {
      return {
        mode: auto.mode,
        source: "ask-fallback",
        reason: "prompt_skipped_non_install_mode",
        codexMigrateCustom: auto.mode === "full",
      };
    }
    if (!input.isTTY) {
      return {
        mode: auto.mode,
        source: "ask-fallback",
        reason: "prompt_skipped_non_tty",
        codexMigrateCustom: auto.mode === "full",
      };
    }
    const selectedMode = await promptExecutionMode(auto.mode);
    return {
      mode: selectedMode,
      source: "prompt",
      reason: "user_selected",
      codexMigrateCustom: selectedMode === "full",
    };
  }

  return {
    mode: auto.mode,
    source: "auto",
    reason: auto.reason,
    codexMigrateCustom: auto.mode === "full",
  };
}

function resolveArtifactImportDefaults(args, configData = {}) {
  const explicitStore = normalizeIndexStoreMode(args?.artifactImportStore);
  if (explicitStore) {
    return {
      store: explicitStore,
      withContent: explicitStore === "sqlite" || explicitStore === "dual-sqlite" || explicitStore === "all",
      stateMode: stateModeFromIndexStore(explicitStore),
      source: "cli",
    };
  }

  const envStore = normalizeIndexStoreMode(process.env.AIDN_INDEX_STORE_MODE);
  if (envStore) {
    return {
      store: envStore,
      withContent: envStore === "sqlite" || envStore === "dual-sqlite" || envStore === "all",
      stateMode: stateModeFromIndexStore(envStore),
      source: "env-index-store",
    };
  }

  const envStateMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envStateMode) {
    const store = defaultIndexStoreFromStateMode(envStateMode);
    return {
      store,
      withContent: store === "sqlite" || store === "dual-sqlite" || store === "all",
      stateMode: envStateMode,
      source: "env-state-mode",
    };
  }

  const configStore = resolveConfigIndexStore(configData);
  if (configStore) {
    return {
      store: configStore,
      withContent: configStore === "sqlite" || configStore === "dual-sqlite" || configStore === "all",
      stateMode: stateModeFromIndexStore(configStore),
      source: "config-index-store",
    };
  }

  const configStateMode = resolveConfigStateMode(configData);
  if (configStateMode) {
    const store = defaultIndexStoreFromStateMode(configStateMode);
    return {
      store,
      withContent: store === "sqlite" || store === "dual-sqlite" || store === "all",
      stateMode: configStateMode,
      source: "config-state-mode",
    };
  }

  return {
    store: "dual-sqlite",
    withContent: true,
    stateMode: "dual",
    source: "default",
  };
}

function runArtifactImport(repoRoot, targetRoot, dryRun, args, configData = {}) {
  const defaults = resolveArtifactImportDefaults(args, configData);
  const auditRoot = path.resolve(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    return {
      attempted: false,
      skipped: true,
      reason: "docs/audit not found",
      defaults,
    };
  }
  const scriptPath = path.join(repoRoot, "tools", "perf", "index-sync.mjs");
  if (!fs.existsSync(scriptPath)) {
    return {
      attempted: false,
      skipped: true,
      reason: "tools/perf/index-sync.mjs not found",
      defaults,
    };
  }
  const cmd = [
    scriptPath,
    "--target",
    targetRoot,
    "--store",
    defaults.store,
    "--json",
  ];
  if (defaults.withContent) {
    cmd.push("--with-content");
  }

  if (dryRun) {
    return {
      attempted: false,
      skipped: true,
      dryRun: true,
      reason: `dry-run (would run index-sync store=${defaults.store}, state_mode=${defaults.stateMode}, source=${defaults.source})`,
    };
  }

  const result = spawnSync(process.execPath, cmd, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `process error: ${result.error.message}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }
  if (result.status !== 0) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `exit ${result.status}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? "{}"));
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `invalid JSON output from index-sync: ${error.message}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  return {
    attempted: true,
    skipped: false,
    ok: true,
    payload,
    defaults,
  };
}

function expectedArtifactImportFilesForStore(store) {
  const base = ".aidn/runtime/index";
  if (store === "file") {
    return [`${base}/workflow-index.json`];
  }
  if (store === "sql") {
    return [`${base}/workflow-index.sql`];
  }
  if (store === "dual") {
    return [`${base}/workflow-index.json`, `${base}/workflow-index.sql`];
  }
  if (store === "sqlite") {
    return [`${base}/workflow-index.sqlite`];
  }
  if (store === "dual-sqlite") {
    return [`${base}/workflow-index.json`, `${base}/workflow-index.sqlite`];
  }
  if (store === "all") {
    return [
      `${base}/workflow-index.json`,
      `${base}/workflow-index.sql`,
      `${base}/workflow-index.sqlite`,
    ];
  }
  return [];
}

function verifyArtifactImportOutputs(targetRoot, args, configData = {}) {
  if (args.dryRun) {
    return {
      checked: false,
      skipped: true,
      reason: "dry-run",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  if (args.skipArtifactImport) {
    return {
      checked: false,
      skipped: true,
      reason: "explicit --skip-artifact-import",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  const auditRoot = path.resolve(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    return {
      checked: false,
      skipped: true,
      reason: "docs/audit not found",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  const defaults = resolveArtifactImportDefaults(args, configData);
  const expected = expectedArtifactImportFilesForStore(defaults.store);
  const missing = expected.filter((relativePath) => !fs.existsSync(path.resolve(targetRoot, relativePath)));
  return {
    checked: true,
    skipped: false,
    ok: missing.length === 0,
    defaults,
    expected_files: expected,
    missing_files: missing,
  };
}

function buildNextAidnProjectConfig(existingData, defaults, args) {
  const base = (existingData && typeof existingData === "object" && !Array.isArray(existingData))
    ? JSON.parse(JSON.stringify(existingData))
    : {};

  if (typeof base.version !== "number") {
    base.version = 1;
  }
  if (!base.install || typeof base.install !== "object" || Array.isArray(base.install)) {
    base.install = {};
  }
  if (!base.runtime || typeof base.runtime !== "object" || Array.isArray(base.runtime)) {
    base.runtime = {};
  }

  const explicitStore = normalizeIndexStoreMode(args?.artifactImportStore);
  if (explicitStore) {
    base.install.artifactImportStore = explicitStore;
    base.runtime.stateMode = stateModeFromIndexStore(explicitStore);
  } else {
    if (!normalizeIndexStoreMode(base.install.artifactImportStore)) {
      base.install.artifactImportStore = defaults.store;
    }
    if (!normalizeStateMode(base.runtime.stateMode)) {
      base.runtime.stateMode = defaults.stateMode;
    }
  }

  if (!normalizeStateMode(base.profile)) {
    base.profile = base.runtime.stateMode;
  }

  return base;
}

function stripComments(line) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) {
      quoted = !quoted;
    }
    if (ch === "#" && !quoted) {
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i);
      }
    }
    escaped = false;
  }
  return line;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYaml(content) {
  const root = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const stack = [{ indent: -1, kind: "object", container: root }];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const rawLine = stripComments(lines[lineNo]).replace(/\s+$/, "");
    if (!rawLine.trim()) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trimStart();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    let frame = stack[stack.length - 1];
    if (frame.kind === "pending") {
      if (line.startsWith("- ")) {
        frame.kind = "array";
        frame.container = [];
      } else {
        frame.kind = "object";
        frame.container = {};
      }
      frame.parent[frame.key] = frame.container;
    }

    if (line.startsWith("- ")) {
      if (frame.kind !== "array") {
        throw new Error(`Invalid YAML list placement at line ${lineNo + 1}`);
      }
      const itemRaw = line.slice(2).trim();
      if (!itemRaw) {
        const obj = {};
        frame.container.push(obj);
        stack.push({ indent, kind: "object", container: obj });
        continue;
      }
      if (itemRaw.includes(":")) {
        const sep = itemRaw.indexOf(":");
        const key = itemRaw.slice(0, sep).trim();
        const valueRaw = itemRaw.slice(sep + 1).trim();
        const obj = {};
        frame.container.push(obj);
        if (valueRaw) {
          obj[key] = parseScalar(valueRaw);
        } else {
          obj[key] = {};
        }
        stack.push({ indent, kind: "object", container: obj });
        if (!valueRaw) {
          stack.push({
            indent: indent + 1,
            kind: "pending",
            container: null,
            parent: obj,
            key,
          });
        }
        continue;
      }
      frame.container.push(parseScalar(itemRaw));
      continue;
    }

    if (frame.kind !== "object") {
      throw new Error(`Invalid YAML key placement at line ${lineNo + 1}`);
    }

    const sep = line.indexOf(":");
    if (sep < 0) {
      throw new Error(`Invalid YAML syntax at line ${lineNo + 1}`);
    }

    const key = line.slice(0, sep).trim();
    const valueRaw = line.slice(sep + 1).trim();
    if (valueRaw) {
      frame.container[key] = parseScalar(valueRaw);
      continue;
    }

    stack.push({
      indent,
      kind: "pending",
      container: null,
      parent: frame.container,
      key,
    });
  }

  return root;
}

function readYamlFile(filePath) {
  return parseYaml(readUtf8(filePath));
}

function normalizeOsLabel(platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "mac";
  }
  return "linux";
}

function commandExists(commandName) {
  const pathValue = process.env.PATH ?? "";
  if (!pathValue) {
    return false;
  }

  const dirs = pathValue.split(path.delimiter).filter((entry) => entry && entry.trim().length > 0);
  const isWindows = process.platform === "win32";
  const extensions = isWindows
    ? Array.from(
      new Set(
        ((process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM;.PS1")
          .split(";")
          .map((ext) => ext.trim().toLowerCase())
          .filter((ext) => ext.length > 0))
          .concat([".ps1"]),
      ),
    )
    : [""];

  for (const dir of dirs) {
    if (isWindows) {
      for (const ext of extensions) {
        const candidate = path.join(dir, `${commandName}${ext}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return true;
        }
      }
      const plainCandidate = path.join(dir, commandName);
      if (fs.existsSync(plainCandidate) && fs.statSync(plainCandidate).isFile()) {
        return true;
      }
    } else {
      const candidate = path.join(dir, commandName);
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) {
        continue;
      }
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // continue scanning
      }
    }
  }

  return false;
}

function checkCodexAuthentication() {
  if (!commandExists("codex")) {
    return {
      checked: false,
      authenticated: false,
      reason: "codex command not found",
      output: "",
      status: null,
    };
  }

  const result = spawnSync("codex login status", {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 1024 * 1024,
    shell: true,
  });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim();
  const lower = output.toLowerCase();
  const loggedIn = lower.includes("logged in") && !lower.includes("not logged in");
  const authenticated = result.status === 0 && loggedIn;

  return {
    checked: true,
    authenticated,
    reason: authenticated ? "ok" : "codex login status did not confirm authentication",
    output,
    status: result.status,
  };
}

function asStringArray(value, label) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label} must contain non-empty strings`);
    }
    out.push(item.trim());
  }
  return out;
}

function asNumber(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  throw new Error(`${label} must be an integer`);
}

function asBoolean(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function intersectOrdered(primary, secondary) {
  const secondarySet = new Set(secondary);
  return primary.filter((item) => secondarySet.has(item));
}

function resolveCompatibility(workflowManifest, compatMatrix) {
  const workflowCompat = workflowManifest?.compatibility ?? null;
  const nodeMinWorkflow = asNumber(workflowCompat?.node_min, "workflow.compatibility.node_min");
  const nodeMinMatrix = asNumber(compatMatrix?.node_min, "compat.matrix.node_min");
  const codexWorkflow = asBoolean(workflowCompat?.codex_online, "workflow.compatibility.codex_online");
  const codexMatrix = asBoolean(compatMatrix?.codex_online, "compat.matrix.codex_online");
  const osWorkflow = asStringArray(workflowCompat?.os, "workflow.compatibility.os");
  const osMatrix = asStringArray(compatMatrix?.os, "compat.matrix.os");

  if (nodeMinWorkflow != null && nodeMinMatrix != null && nodeMinWorkflow !== nodeMinMatrix) {
    throw new Error(
      `Compatibility conflict: node_min differs (${nodeMinWorkflow} vs ${nodeMinMatrix})`,
    );
  }
  if (codexWorkflow != null && codexMatrix != null && codexWorkflow !== codexMatrix) {
    throw new Error(
      `Compatibility conflict: codex_online differs (${codexWorkflow} vs ${codexMatrix})`,
    );
  }

  let osEffective = null;
  if (osWorkflow && osMatrix) {
    osEffective = intersectOrdered(osWorkflow, osMatrix);
    if (osEffective.length === 0) {
      throw new Error(
        `Compatibility conflict: no overlapping OS between workflow (${osWorkflow.join(", ")}) and matrix (${osMatrix.join(", ")})`,
      );
    }
  } else {
    osEffective = osWorkflow ?? osMatrix;
  }

  const nodeMin = nodeMinWorkflow ?? nodeMinMatrix;
  const codexOnline = codexWorkflow ?? codexMatrix;
  if (nodeMin == null && osEffective == null && codexOnline == null) {
    return null;
  }

  return {
    nodeMin,
    os: osEffective,
    codexOnline,
  };
}

function validateRuntimeCompatibility(compatibility) {
  const codexAuth = checkCodexAuthentication();
  const runtime = {
    node: process.versions.node,
    os: normalizeOsLabel(process.platform),
    codexInstalled: commandExists("codex"),
    codexAuthenticated: codexAuth.authenticated,
    codexAuthChecked: codexAuth.checked,
    codexAuthReason: codexAuth.reason,
  };

  if (!compatibility) {
    return runtime;
  }

  if (compatibility.nodeMin != null) {
    const currentMajor = Number(runtime.node.split(".")[0]);
    if (currentMajor < compatibility.nodeMin) {
      throw new Error(
        `Node ${currentMajor} is not supported (requires >= ${compatibility.nodeMin})`,
      );
    }
  }

  if (compatibility.os && compatibility.os.length > 0) {
    if (!compatibility.os.includes(runtime.os)) {
      throw new Error(
        `OS ${runtime.os} is not supported by compatibility matrix (${compatibility.os.join(", ")})`,
      );
    }
  }

  if (compatibility.codexOnline === true && !runtime.codexInstalled) {
    throw new Error(
      "codex_online=true requires Codex CLI to be installed and available in PATH (command: codex)",
    );
  }
  if (compatibility.codexOnline === true && !runtime.codexAuthenticated) {
    throw new Error(
      "codex_online=true requires an authenticated Codex session. Run: codex login",
    );
  }

  return runtime;
}

function formatCompatibility(compatibility) {
  if (!compatibility) {
    return "none";
  }
  const parts = [];
  if (compatibility.nodeMin != null) {
    parts.push(`node>=${compatibility.nodeMin}`);
  }
  if (compatibility.os && compatibility.os.length > 0) {
    parts.push(`os=[${compatibility.os.join(", ")}]`);
  }
  if (compatibility.codexOnline != null) {
    parts.push(`codex_online=${compatibility.codexOnline}`);
  }
  return parts.join(", ");
}

function loadPackManifest(repoRoot, packName) {
  const manifestPath = path.join(repoRoot, "packs", packName, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Pack manifest not found: ${manifestPath}`);
  }
  return { manifestPath, manifest: readYamlFile(manifestPath) };
}

function resolvePackOrder(repoRoot, requestedPacks) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const packCache = new Map();

  function visit(packName) {
    if (visited.has(packName)) {
      return;
    }
    if (visiting.has(packName)) {
      throw new Error(`Pack dependency cycle detected at: ${packName}`);
    }

    visiting.add(packName);
    let packInfo = packCache.get(packName);
    if (!packInfo) {
      packInfo = loadPackManifest(repoRoot, packName);
      packCache.set(packName, packInfo);
    }

    const dependsOn = packInfo.manifest.depends_on ?? [];
    if (!Array.isArray(dependsOn)) {
      throw new Error(`depends_on must be an array in pack ${packName}`);
    }
    for (const dep of dependsOn) {
      if (typeof dep !== "string" || !dep.trim()) {
        throw new Error(`Invalid depends_on entry in pack ${packName}`);
      }
      visit(dep.trim());
    }

    visiting.delete(packName);
    visited.add(packName);
    ordered.push(packName);
  }

  for (const pack of requestedPacks) {
    if (typeof pack !== "string" || !pack.trim()) {
      throw new Error("Requested pack list contains invalid entries");
    }
    visit(pack.trim());
  }

  return { ordered, packCache };
}

function ensureDir(dirPath, dryRun) {
  if (dryRun) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLinesNormalized(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, content, dryRun) {
  if (dryRun) {
    return;
  }
  fs.writeFileSync(filePath, content, "utf8");
}

function renderTemplateVariables(content, templateVars) {
  if (!templateVars) {
    return content;
  }
  let rendered = content;
  for (const [key, value] of Object.entries(templateVars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, String(value));
  }
  return rendered;
}

function extractPlaceholders(content) {
  const matches = String(content).matchAll(/\{\{([A-Z0-9_]+)\}\}/g);
  const out = new Set();
  for (const match of matches) {
    out.add(String(match[1]));
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function sanitizeExtractedValue(value) {
  const text = String(value ?? "").trim().replace(/^`+|`+$/g, "");
  if (!text || /\{\{[A-Z0-9_]+\}\}/.test(text)) {
    return "";
  }
  return text;
}

function readKeyValuePlaceholders(text) {
  const out = {};
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const key = String(match[1]).trim().toUpperCase();
    const value = sanitizeExtractedValue(match[2]);
    if (!value) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function readWorkflowSpecificPlaceholders(text) {
  const out = {};
  const patterns = [
    { key: "RUNTIME_CONSTRAINTS", re: /Runtime\/platform constraints:\s*`([^`]+)`/i },
    { key: "ARCH_CONSTRAINTS", re: /Architecture constraints:\s*`([^`]+)`/i },
    { key: "DEPENDENCY_CONSTRAINTS", re: /Dependency\/data constraints:\s*`([^`]+)`/i },
    { key: "DELIVERY_CONSTRAINTS", re: /Delivery constraints .*?:\s*`([^`]+)`/i },
    { key: "GENERATED_ARTIFACT_CONSTRAINTS", re: /Generated artifact constraints:\s*`([^`]+)`/i },
    { key: "TEST_REGRESSION_CONSTRAINTS", re: /Testing\/regression constraints:\s*`([^`]+)`/i },
    { key: "DOR_POLICY", re: /DoR policy:\s*`([^`]+)`/i },
    { key: "SNAPSHOT_TRIGGER", re: /Snapshot update trigger:\s*`([^`]+)`/i },
    { key: "SNAPSHOT_OWNER", re: /Snapshot owner:\s*`([^`]+)`/i },
    { key: "SNAPSHOT_FRESHNESS_RULE", re: /Freshness rule before commit\/review:\s*`([^`]+)`/i },
    { key: "PARKING_LOT_RULE", re: /Parking lot rule .*?:\s*`([^`]+)`/i },
  ];
  for (const item of patterns) {
    const match = String(text).match(item.re);
    if (!match) {
      continue;
    }
    const value = sanitizeExtractedValue(match[1]);
    if (value) {
      out[item.key] = value;
    }
  }
  return out;
}

function collectPlaceholderValuesFromText(text) {
  return {
    ...readKeyValuePlaceholders(text),
    ...readWorkflowSpecificPlaceholders(text),
  };
}

function normalizePreservedMetadata(targetRelative, text, templateVars) {
  let next = String(text);
  const version = sanitizeExtractedValue(templateVars?.VERSION);
  if (!version) {
    return { text: next, changed: false };
  }

  const normalizedTarget = normalizeRelativePath(targetRelative).toLowerCase();
  if (normalizedTarget === "docs/audit/workflow.md") {
    next = next.replace(/^(\s*workflow_version:\s*).+$/im, `$1${version}`);
  }

  if (normalizedTarget === ".codex/skills.yaml") {
    next = next.replace(/^(\s*ref:\s*["']?)v[^"'\s]+(["']?\s*)$/im, `$1v${version}$2`);
    next = next.replace(/(https:\/\/github\.com\/leuzeus\/aidn\/tree\/)v[^/]+(\/template\/codex\/)/gi, `$1v${version}$2`);
  }

  return { text: next, changed: next !== text };
}

function collectExistingPlaceholderValues(targetRoot) {
  const out = {};
  const candidates = [
    path.join(targetRoot, "docs", "audit", "WORKFLOW.md"),
    path.join(targetRoot, "docs", "audit", "baseline", "current.md"),
    path.join(targetRoot, ".codex", "skills.yaml"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const text = readUtf8(filePath);
    Object.assign(out, collectPlaceholderValuesFromText(text));
    if (filePath.toLowerCase().endsWith(path.join("docs", "audit", "workflow.md").toLowerCase())) {
      Object.assign(out, readWorkflowSpecificPlaceholders(text));
    }
    if (filePath.toLowerCase().endsWith(path.join(".codex", "skills.yaml").toLowerCase())) {
      const versionMatch = text.match(/ref:\s*"v([^"]+)"/i);
      if (versionMatch && sanitizeExtractedValue(versionMatch[1])) {
        out.VERSION = sanitizeExtractedValue(versionMatch[1]);
      }
    }
  }

  return out;
}

function suggestPlaceholderValue(name, targetRoot, templateVars) {
  if (name === "PROJECT_NAME") {
    return path.basename(targetRoot);
  }
  if (name === "SOURCE_BRANCH") {
    const result = spawnSync("git", ["-C", targetRoot, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const branch = sanitizeExtractedValue(result.stdout);
    return branch || "main";
  }
  if (name === "VERSION") {
    return sanitizeExtractedValue(templateVars.VERSION) || "0.0.0";
  }
  return "TO_DEFINE";
}

async function resolveMissingPlaceholdersForCopyOp({
  sourcePath,
  targetPath,
  skipSources,
  templateVars,
  targetRoot,
  dryRun,
  summary,
}) {
  const missing = new Set();

  function visit(sourceItem, targetItem) {
    const absoluteSource = path.resolve(sourceItem);
    if (skipSources && skipSources.has(absoluteSource)) {
      return;
    }
    const stat = fs.statSync(sourceItem);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(sourceItem, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        visit(path.join(sourceItem, entry.name), path.join(targetItem, entry.name));
      }
      return;
    }

    if (!shouldRenderTemplate(sourceItem)) {
      return;
    }
    if (fs.existsSync(targetItem)) {
      return;
    }
    const placeholders = extractPlaceholders(readUtf8(sourceItem));
    for (const placeholder of placeholders) {
      if (!Object.prototype.hasOwnProperty.call(templateVars, placeholder) || !String(templateVars[placeholder]).trim()) {
        missing.add(placeholder);
      }
    }
  }

  visit(sourcePath, targetPath);
  if (missing.size === 0) {
    return;
  }

  const ordered = Array.from(missing).sort((a, b) => a.localeCompare(b));
  const canAsk = input.isTTY && !dryRun;
  let rl = null;
  if (canAsk) {
    rl = readline.createInterface({ input, output });
  }

  try {
    for (const placeholder of ordered) {
      const defaultValue = suggestPlaceholderValue(placeholder, targetRoot, templateVars);
      let resolved = defaultValue;
      if (canAsk) {
        const answer = await rl.question(`Value for {{${placeholder}}} [${defaultValue}]: `);
        resolved = answer.trim() || defaultValue;
        summary.placeholderPrompted += 1;
      } else {
        summary.placeholderAutoFilled += 1;
      }
      templateVars[placeholder] = resolved;
      console.log(`${dryRun ? "[dry-run] " : ""}placeholder {{${placeholder}}} -> ${resolved}`);
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

function shouldRenderTemplate(sourcePath) {
  const base = path.basename(sourcePath).toLowerCase();
  const ext = path.extname(sourcePath).toLowerCase();
  if (base === ".gitignore") {
    return true;
  }
  return [".md", ".yaml", ".yml", ".txt", ".json"].includes(ext);
}

function copyFile(sourcePath, targetPath, dryRun, templateVars = null, options = null) {
  const targetRoot = options?.targetRoot ? path.resolve(options.targetRoot) : null;
  const targetRelative = targetRoot
    ? normalizeRelativePath(path.relative(targetRoot, targetPath))
    : "";
  const isCustomizable = targetRelative && isCustomizableProjectFile(targetRelative);
  const targetExists = fs.existsSync(targetPath);

  if (targetExists && options?.preserveCustomizableFiles === true && isCustomizable) {
    let sourceRendered = null;
    let differsFromTemplate = true;
    if (shouldRenderTemplate(sourcePath)) {
      const sourceText = readUtf8(sourcePath);
      const targetText = readUtf8(targetPath);
      const effectiveVars = { ...(templateVars ?? {}) };

      sourceRendered = renderTemplateVariables(sourceText, effectiveVars);
      let unresolved = extractPlaceholders(sourceRendered);
      if (unresolved.length > 0) {
        const inferred = collectPlaceholderValuesFromText(targetText);
        for (const [key, value] of Object.entries(inferred)) {
          if (!effectiveVars[key] || !String(effectiveVars[key]).trim()) {
            effectiveVars[key] = value;
          }
        }
        for (const placeholder of unresolved) {
          if (!effectiveVars[placeholder] || !String(effectiveVars[placeholder]).trim()) {
            effectiveVars[placeholder] = suggestPlaceholderValue(placeholder, targetRoot ?? process.cwd(), effectiveVars);
          }
        }
        sourceRendered = renderTemplateVariables(sourceText, effectiveVars);
        unresolved = extractPlaceholders(sourceRendered);
      }
      if (templateVars) {
        for (const [key, value] of Object.entries(effectiveVars)) {
          if (!templateVars[key] || !String(templateVars[key]).trim()) {
            templateVars[key] = value;
          }
        }
      }
      if (unresolved.length > 0) {
        throw new Error(
          `Unresolved placeholders in preserved-file template render (${sourcePath}): ${unresolved.join(", ")}`,
        );
      }

      let targetRendered = renderTemplateVariables(targetText, effectiveVars);
      const normalizedMeta = normalizePreservedMetadata(targetRelative, targetRendered, effectiveVars);
      targetRendered = normalizedMeta.text;
      const targetRenderChanged = targetRendered !== targetText;
      if (targetRenderChanged) {
        if (!dryRun) {
          writeUtf8(targetPath, targetRendered, dryRun);
        }
        if (typeof options.onPreservedPlaceholderApplied === "function") {
          options.onPreservedPlaceholderApplied({
            targetRelative,
            targetPath,
            placeholdersBefore: extractPlaceholders(targetText),
            placeholdersAfter: extractPlaceholders(targetRendered),
          });
        }
      }

      differsFromTemplate = targetRendered !== sourceRendered;
    }
    if (typeof options.onPreservedCustomFile === "function") {
      options.onPreservedCustomFile({
        targetRelative,
        sourcePath,
        targetPath,
        sourceRendered,
        differsFromTemplate,
      });
    }
    return;
  }

  ensureDir(path.dirname(targetPath), dryRun);
  if (shouldRenderTemplate(sourcePath)) {
    const content = readUtf8(sourcePath);
    const rendered = renderTemplateVariables(content, templateVars);
    const unresolved = extractPlaceholders(rendered);
    if (unresolved.length > 0) {
      throw new Error(
        `Unresolved placeholders in copied file (${sourcePath} -> ${targetPath}): ${unresolved.join(", ")}`,
      );
    }
    if (dryRun) {
      return;
    }
    writeUtf8(targetPath, rendered, dryRun);
    return;
  }
  if (dryRun) {
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
}

function copyRecursive(sourcePath, targetPath, dryRun, skipSources = null, templateVars = null, options = null) {
  const absoluteSource = path.resolve(sourcePath);
  if (skipSources && skipSources.has(absoluteSource)) {
    return;
  }

  const sourceStat = fs.statSync(sourcePath);
  if (sourceStat.isDirectory()) {
    ensureDir(targetPath, dryRun);
    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      copyRecursive(
        path.join(sourcePath, entry.name),
        path.join(targetPath, entry.name),
        dryRun,
        skipSources,
        templateVars,
        options,
      );
    }
    return;
  }

  copyFile(sourcePath, targetPath, dryRun, templateVars, options);
}

function buildCodexMigrationPrompt(relativeTargetPath, sourceRendered) {
  const ext = path.extname(relativeTargetPath).toLowerCase();
  const fence = ext === ".md" ? "markdown" : (ext === ".yaml" || ext === ".yml" ? "yaml" : "");
  return [
    "Migrate one customized workflow file in-place.",
    `Target file: ${relativeTargetPath}`,
    "Instructions:",
    "- Keep project-specific customizations and local decisions.",
    "- Integrate missing structure or guardrails from the provided updated template when relevant.",
    "- The updated template already contains resolved metadata placeholders; preserve equivalent local values.",
    "- Force installed metadata version values from the template (for example workflow_version and skills ref/tag URLs).",
    "- Do not re-introduce unresolved placeholders.",
    "- Preserve valid syntax and readability.",
    "- Edit only the target file and save it.",
    "",
    "Updated template content:",
    `\`\`\`${fence}`,
    sourceRendered,
    "```",
  ].join("\n");
}

function shellEscapeWindowsArg(value) {
  const raw = String(value ?? "");
  if (raw.length === 0) {
    return '""';
  }
  if (!/[ \t"]/u.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '\\"')}"`;
}

function buildCodexExecArgs(targetRoot, codexExecOptions = {}) {
  const args = [];
  if (codexExecOptions.sandbox) {
    args.push("--sandbox", codexExecOptions.sandbox);
  }
  if (codexExecOptions.approval) {
    args.push("--ask-for-approval", codexExecOptions.approval);
  }
  args.push("exec");
  if (!codexExecOptions.sandbox && !codexExecOptions.approval) {
    args.push("--full-auto");
  }
  args.push("-C", targetRoot, "-");
  return args;
}

function migrateCustomFileWithCodex(targetRoot, candidate, dryRun, codexExecOptions = {}) {
  if (dryRun) {
    return { attempted: false, migrated: false, reason: "dry-run" };
  }
  if (!candidate.sourceRendered) {
    return { attempted: false, migrated: false, reason: "non-text-template" };
  }

  const prompt = buildCodexMigrationPrompt(candidate.targetRelative, candidate.sourceRendered);
  const codexArgs = buildCodexExecArgs(targetRoot, codexExecOptions);
  let result;
  if (process.platform === "win32") {
    const commandLine = ["codex", ...codexArgs].map((item) => shellEscapeWindowsArg(item)).join(" ");
    result = spawnSync(commandLine, {
      input: prompt,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
    });
  } else {
    result = spawnSync("codex", codexArgs, {
      input: prompt,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  if (result.error) {
    return { attempted: true, migrated: false, reason: `error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    return {
      attempted: true,
      migrated: false,
      reason: stderr ? `exit ${result.status}: ${stderr}` : `exit ${result.status}`,
    };
  }

  return { attempted: true, migrated: true, reason: "ok" };
}

function ensureWorkflowBlock(templateText) {
  if (templateText.includes(BLOCK_START) && templateText.includes(BLOCK_END)) {
    return templateText;
  }
  const eol = detectEol(templateText);
  return `${BLOCK_START}${eol}${templateText.trimEnd()}${eol}${BLOCK_END}${eol}`;
}

function insertManagedBlockNearTop(currentNormalized, managedBlockNormalized) {
  const managedBlock = managedBlockNormalized.endsWith("\n")
    ? managedBlockNormalized
    : `${managedBlockNormalized}\n`;
  if (!currentNormalized) {
    return managedBlock;
  }

  const lines = currentNormalized.split("\n");
  let insertAt = 0;
  if (lines[0].startsWith("# ")) {
    insertAt = 1;
    while (insertAt < lines.length && lines[insertAt].trim() === "") {
      insertAt += 1;
    }
  }

  const before = lines.slice(0, insertAt).join("\n");
  const after = lines.slice(insertAt).join("\n");

  if (!before) {
    return `${managedBlock}${after}`;
  }
  if (!after) {
    return `${before}\n\n${managedBlock}`;
  }
  return `${before}\n\n${managedBlock}\n${after}`;
}

function detectBlockMergeRisk(targetPath, currentNormalized) {
  const reasons = [];
  const lowerPath = targetPath.toLowerCase();
  const lower = currentNormalized.toLowerCase();
  if (lowerPath.endsWith("agents.md")) {
    const nonEmptyCount = currentNormalized.split("\n").filter((line) => line.trim().length > 0).length;
    if (nonEmptyCount > 40) {
      reasons.push("target AGENTS.md already contains substantial content");
    }
    if (
      lower.includes("required skills")
      || lower.includes("execution contract")
      || lower.includes("source of truth")
    ) {
      reasons.push("existing policy sections may overlap managed block");
    }
  }
  return reasons;
}

function isAgentsPath(targetPath) {
  return path.basename(targetPath).toLowerCase() === "agents.md";
}

function shouldSkipAgentsMerge(targetPath, args) {
  if (!isAgentsPath(targetPath)) {
    return { skip: false, reason: "" };
  }
  if (args.forceAgentsMerge) {
    return { skip: false, reason: "" };
  }
  if (args.skipAgents) {
    return { skip: true, reason: "explicit --skip-agents" };
  }
  if (fs.existsSync(targetPath)) {
    if (args.assist) {
      return {
        skip: true,
        reason: "assist mode preserves existing AGENTS.md to avoid instruction interference",
      };
    }
    return {
      skip: true,
      reason: "existing AGENTS.md preserved by default (use --force-agents-merge to update managed block)",
    };
  }
  return { skip: false, reason: "" };
}

async function confirmAssist(prompt) {
  if (!input.isTTY) {
    throw new Error(
      "Assist confirmation requires an interactive terminal (TTY). Use --dry-run to preview or rerun without --assist.",
    );
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${prompt} [y/N]: `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function mergeBlock(templatePath, targetPath, dryRun, options) {
  const rawTemplateText = readUtf8(templatePath);
  const renderedTemplateText = renderTemplateVariables(rawTemplateText, options.templateVars ?? null);
  if (rawTemplateText.includes("{{VERSION}}") && renderedTemplateText.includes("{{VERSION}}")) {
    throw new Error(`Unresolved {{VERSION}} placeholder in merge template: ${templatePath}`);
  }
  const templateText = ensureWorkflowBlock(renderedTemplateText);
  const templateEol = detectEol(templateText);
  const targetExists = fs.existsSync(targetPath);

  if (!targetExists) {
    writeUtf8(targetPath, templateText, dryRun);
    return { changed: true };
  }

  const current = readUtf8(targetPath);
  const eol = detectEol(current);
  const normalizedTemplate = templateText.replace(/\r\n/g, "\n");
  const normalizedCurrent = current.replace(/\r\n/g, "\n");
  const blockPattern = new RegExp(
    `${escapeRegex(BLOCK_START)}[\\s\\S]*?${escapeRegex(BLOCK_END)}`,
  );
  let nextNormalized = normalizedCurrent;

  if (normalizedCurrent.includes(BLOCK_START) && normalizedCurrent.includes(BLOCK_END)) {
    nextNormalized = normalizedCurrent.replace(
      blockPattern,
      normalizedTemplate.trimEnd(),
    );
  } else {
    const risks = detectBlockMergeRisk(targetPath, normalizedCurrent);
    if (risks.length > 0) {
      const riskMessage = `potential merge conflict in ${targetPath}: ${risks.join("; ")}`;
      if (options.strict) {
        throw new Error(`Strict mode blocked install (${riskMessage})`);
      }
      console.warn(`WARNING: ${riskMessage}`);
      if (options.assist) {
        if (dryRun) {
          console.warn("[dry-run] assist mode: confirmation will be requested on non-dry execution");
        } else {
          const approved = await confirmAssist(
            `Apply managed AGENTS.md block insertion near top for ${targetPath}?`,
          );
          if (!approved) {
            return { changed: false, skippedByAssist: true };
          }
        }
      }
    }
    nextNormalized = insertManagedBlockNearTop(
      normalizedCurrent,
      normalizedTemplate.trimEnd(),
    );
  }

  const nextContent = nextNormalized.replace(/\n/g, eol || templateEol);
  if (nextContent === current) {
    return { changed: false };
  }

  writeUtf8(targetPath, nextContent, dryRun);
  return { changed: true, skippedByAssist: false };
}

function mergeAppendUnique(templatePath, targetPath, dryRun, templateVars = null) {
  const rawTemplateText = readUtf8(templatePath);
  const templateText = renderTemplateVariables(rawTemplateText, templateVars);
  if (rawTemplateText.includes("{{VERSION}}") && templateText.includes("{{VERSION}}")) {
    throw new Error(`Unresolved {{VERSION}} placeholder in append_unique template: ${templatePath}`);
  }
  const templateLines = splitLinesNormalized(templateText).filter((line) => line.length > 0);
  const targetExists = fs.existsSync(targetPath);

  if (!targetExists) {
    const eol = detectEol(templateText);
    const content = templateLines.length ? `${templateLines.join(eol)}${eol}` : "";
    writeUtf8(targetPath, content, dryRun);
    return { changed: templateLines.length > 0 };
  }

  const current = readUtf8(targetPath);
  const eol = detectEol(current);
  const hadFinalNewline = current.endsWith("\n");
  const currentLines = splitLinesNormalized(current);
  const existing = new Set(currentLines);
  const additions = templateLines.filter((line) => !existing.has(line));

  if (additions.length === 0) {
    return { changed: false };
  }

  const baseLines = currentLines;
  if (baseLines.length > 0 && baseLines[baseLines.length - 1] === "") {
    baseLines.pop();
  }
  const mergedLines = baseLines.concat(additions);
  let output = mergedLines.join(eol);
  if (hadFinalNewline || additions.length > 0) {
    output += eol;
  }

  writeUtf8(targetPath, output, dryRun);
  return { changed: true };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifyPaths(targetRoot, pathsToCheck) {
  const missing = [];
  for (const relativePath of pathsToCheck) {
    const absolute = path.resolve(targetRoot, relativePath);
    if (!fs.existsSync(absolute)) {
      missing.push(relativePath);
    }
  }
  return { ok: missing.length === 0, missing };
}

function getWorkflowPlaceholders(targetRoot) {
  const workflowPath = path.resolve(targetRoot, "docs/audit/WORKFLOW.md");
  if (!fs.existsSync(workflowPath)) {
    return [];
  }
  const content = readUtf8(workflowPath);
  return extractPlaceholders(content).map((name) => `{{${name}}}`);
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    const configRead = readAidnProjectConfig(targetRoot);
    let currentAidnConfigData = configRead.data ?? {};
    let aidnConfigExists = configRead.exists === true;
    const version = readUtf8(path.join(repoRoot, "VERSION")).trim();
    const inferredTemplateVars = collectExistingPlaceholderValues(targetRoot);
    const templateVars = {
      ...inferredTemplateVars,
      VERSION: version,
    };
    const workflowManifestPath = path.join(
      repoRoot,
      "package",
      "manifests",
      "workflow.manifest.yaml",
    );
    const compatMatrixPath = path.join(
      repoRoot,
      "package",
      "manifests",
      "compat.matrix.yaml",
    );
    if (!fs.existsSync(workflowManifestPath)) {
      throw new Error(`Missing required workflow manifest: ${workflowManifestPath}`);
    }
    if (!fs.existsSync(compatMatrixPath)) {
      throw new Error(`Missing required compatibility matrix: ${compatMatrixPath}`);
    }
    const workflowManifest = readYamlFile(workflowManifestPath);
    const compatMatrix = readYamlFile(compatMatrixPath);
    const compatibility = resolveCompatibility(workflowManifest, compatMatrix);
    const runtime = validateRuntimeCompatibility(compatibility);
    const execution = await resolveCodexMigrationExecution(args, runtime);
    args.codexMigrateCustom = execution.codexMigrateCustom;

    const workflowPacks = workflowManifest?.packs ?? [];
    if (workflowManifest && !Array.isArray(workflowPacks)) {
      throw new Error("workflow.manifest packs must be an array");
    }
    const requestedPacks = args.pack ? [args.pack] : workflowPacks;
    if (!requestedPacks || requestedPacks.length === 0) {
      throw new Error("No pack selected. Use --pack or define packs in workflow manifest.");
    }

    const { ordered: selectedPacks, packCache } = resolvePackOrder(
      repoRoot,
      requestedPacks,
    );
    const summary = {
      copied: 0,
      merged: 0,
      skipped: 0,
      preservedCustom: 0,
      preservedPlaceholdersApplied: 0,
      migratedCustom: 0,
      migrationFailed: 0,
      placeholderPrompted: 0,
      placeholderAutoFilled: 0,
      artifactImportAttempted: 0,
      artifactImportSucceeded: 0,
      artifactImportSkipped: 0,
      artifactImportVerified: 0,
      artifactImportVerifyFail: 0,
      artifactImportVerifySkipped: 0,
      configCreated: 0,
      configUpdated: 0,
      configSkipped: 0,
    };
    const preservedCustomCandidates = [];

    console.log(`Product version: ${version}`);
    console.log(`Packs: ${selectedPacks.join(", ")}`);
    console.log(`Target: ${targetRoot}`);
    console.log(`Compatibility policy: ${formatCompatibility(compatibility)}`);
    console.log(
      `Prereq check: OK (node ${runtime.node}, os ${runtime.os}, codex ${runtime.codexInstalled ? "installed" : "missing"}, auth ${runtime.codexAuthenticated ? "ok" : "missing"})`,
    );
    console.log(
      `Custom-file policy: preserve=${CUSTOMIZABLE_TARGET_PATTERNS.length} patterns, codex_migrate=${args.codexMigrateCustom ? "enabled" : "disabled"}`,
    );
    if (args.codexMigrateCustom) {
      const sandboxLabel = args.codexSandbox || "default(full-auto)";
      const approvalLabel = args.codexApproval || "default(full-auto)";
      console.log(`Codex exec policy: sandbox=${sandboxLabel}, approval=${approvalLabel}`);
    }
    console.log(
      `Execution mode: ${execution.mode} (source=${execution.source}, reason=${execution.reason})`,
    );
    if (Object.keys(inferredTemplateVars).length > 0) {
      console.log(`Placeholder inference: loaded ${Object.keys(inferredTemplateVars).length} values from existing project files`);
    }
    if (args.dryRun) {
      console.log("Mode: dry-run");
    } else if (args.verifyOnly) {
      console.log("Mode: verify");
    } else {
      console.log("Mode: install");
    }

    if (!args.verifyOnly) {
      for (const packName of selectedPacks) {
        const packInfo = packCache.get(packName);
        const manifest = packInfo.manifest;
        const copyOps = manifest.install?.copy ?? [];
        const mergeOps = manifest.install?.merge ?? [];
        const explicitFileSources = new Set();

        for (const op of copyOps) {
          const sourcePath = path.resolve(repoRoot, op.from);
          if (!fs.existsSync(sourcePath)) {
            continue;
          }
          if (fs.statSync(sourcePath).isFile()) {
            explicitFileSources.add(path.resolve(sourcePath));
          }
        }

        for (const op of copyOps) {
          const sourcePath = path.resolve(repoRoot, op.from);
          const targetPath = path.resolve(targetRoot, op.to);
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Copy source does not exist: ${op.from}`);
          }

          const sourceStat = fs.statSync(sourcePath);
          await resolveMissingPlaceholdersForCopyOp({
            sourcePath,
            targetPath,
            skipSources: sourceStat.isDirectory() ? explicitFileSources : null,
            templateVars,
            targetRoot,
            dryRun: args.dryRun,
            summary,
          });

          console.log(
            `${args.dryRun ? "[dry-run] " : ""}copy ${op.from} -> ${op.to} (pack ${packName})`,
          );
          const copyPolicy = {
            targetRoot,
            preserveCustomizableFiles: true,
            onPreservedPlaceholderApplied(info) {
              summary.preservedPlaceholdersApplied += 1;
              console.log(
                `${args.dryRun ? "[dry-run] " : ""}apply placeholders in preserved file: ${info.targetRelative}`,
              );
            },
            onPreservedCustomFile(candidate) {
              if (!candidate.differsFromTemplate) {
                return;
              }
              preservedCustomCandidates.push(candidate);
            },
          };
          if (sourceStat.isDirectory()) {
            copyRecursive(
              sourcePath,
              targetPath,
              args.dryRun,
              explicitFileSources,
              templateVars,
              copyPolicy,
            );
          } else {
            copyRecursive(sourcePath, targetPath, args.dryRun, null, templateVars, copyPolicy);
          }
          summary.copied += 1;
        }

        for (const op of mergeOps) {
          const sourcePath = path.resolve(repoRoot, op.from);
          const targetPath = path.resolve(targetRoot, op.to);
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Merge source does not exist: ${op.from}`);
          }
          const agentsPolicy = shouldSkipAgentsMerge(targetPath, args);
          if (agentsPolicy.skip) {
            console.log(
              `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, ${agentsPolicy.reason})`,
            );
            summary.skipped += 1;
            continue;
          }

          let result;
          if (op.strategy === "block") {
            result = await mergeBlock(sourcePath, targetPath, args.dryRun, {
              assist: args.assist,
              strict: args.strict,
              templateVars,
            });
          } else if (op.strategy === "append_unique") {
            result = mergeAppendUnique(sourcePath, targetPath, args.dryRun, templateVars);
          } else {
            throw new Error(`Unsupported merge strategy: ${op.strategy}`);
          }

          if (result.skippedByAssist) {
            console.log(
              `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, not approved in assist mode)`,
            );
            summary.skipped += 1;
          } else if (result.changed) {
            console.log(
              `${args.dryRun ? "[dry-run] " : ""}merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName})`,
            );
            summary.merged += 1;
          } else {
            console.log(
              `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, no changes)`,
            );
            summary.skipped += 1;
          }
        }
      }

      const uniqueCandidates = Array.from(
        new Map(preservedCustomCandidates.map((item) => [item.targetRelative.toLowerCase(), item])).values(),
      );
      summary.preservedCustom = uniqueCandidates.length;

      if (uniqueCandidates.length > 0) {
        console.log("");
        console.log("Preserved customized files (not overwritten):");
        for (const item of uniqueCandidates) {
          console.log(`- ${item.targetRelative}`);
        }
      }

      if (uniqueCandidates.length > 0 && args.codexMigrateCustom) {
        if (!runtime.codexInstalled) {
          console.warn("");
          console.warn("Codex migration skipped: codex command not found. Preserved files were left unchanged.");
        } else if (!runtime.codexAuthenticated) {
          console.warn("");
          console.warn("Codex migration skipped: codex is not authenticated. Run `codex login` then retry.");
        } else {
          for (const item of uniqueCandidates) {
            console.log(
              `${args.dryRun ? "[dry-run] " : ""}migrate custom file via codex: ${item.targetRelative}`,
            );
            const migration = migrateCustomFileWithCodex(targetRoot, item, args.dryRun, {
              sandbox: args.codexSandbox || null,
              approval: args.codexApproval || null,
            });
            if (migration.migrated) {
              summary.migratedCustom += 1;
            } else if (migration.attempted) {
              summary.migrationFailed += 1;
              console.warn(`migration failed: ${item.targetRelative} (${migration.reason})`);
            } else {
              console.warn(`migration skipped: ${item.targetRelative} (${migration.reason})`);
            }
          }
        }
      } else if (uniqueCandidates.length > 0) {
        console.log("");
        console.log("Codex migration disabled: preserved customized files were left unchanged.");
      }

      let resolvedImportDefaults = resolveArtifactImportDefaults(args, currentAidnConfigData);
      if (args.skipArtifactImport) {
        summary.artifactImportSkipped += 1;
        console.log("artifact import skipped: explicit --skip-artifact-import");
      } else {
        const artifactImport = runArtifactImport(repoRoot, targetRoot, args.dryRun, args, currentAidnConfigData);
        resolvedImportDefaults = artifactImport.defaults ?? resolvedImportDefaults;
        if (artifactImport.skipped) {
          summary.artifactImportSkipped += 1;
          const prefix = args.dryRun ? "[dry-run] " : "";
          console.log(`${prefix}artifact import skipped: ${artifactImport.reason}`);
        } else if (artifactImport.ok) {
          summary.artifactImportAttempted += 1;
          summary.artifactImportSucceeded += 1;
          const payload = artifactImport.payload ?? {};
          const defaults = artifactImport.defaults ?? {};
          const outputs = Array.isArray(payload.outputs)
            ? payload.outputs.map((row) => `${row.kind}:${path.relative(targetRoot, row.path ?? "")}`).join(", ")
            : "";
          console.log(
            `artifact import: OK (store=${payload.store ?? "n/a"}, state_mode=${payload.state_mode ?? "n/a"}, source=${defaults.source ?? "n/a"}, artifacts=${payload.summary?.artifacts_count ?? "n/a"}${outputs ? `, outputs=${outputs}` : ""})`,
          );
          const importVerification = verifyArtifactImportOutputs(targetRoot, args, currentAidnConfigData);
          if (importVerification.checked) {
            if (importVerification.ok) {
              summary.artifactImportVerified += 1;
            } else {
              summary.artifactImportVerifyFail += 1;
              throw new Error(
                `Artifact import verification failed for store=${importVerification.defaults?.store ?? "unknown"}: missing ${importVerification.missing_files.join(", ")}`,
              );
            }
          } else {
            summary.artifactImportVerifySkipped += 1;
          }
        } else {
          summary.artifactImportAttempted += 1;
          const stderr = String(artifactImport.stderr ?? "").trim();
          const stdout = String(artifactImport.stdout ?? "").trim();
          const details = stderr || stdout || artifactImport.reason || "unknown error";
          throw new Error(`Artifact import failed: ${details}`);
        }
      }

      const nextAidnConfigData = buildNextAidnProjectConfig(
        currentAidnConfigData,
        resolvedImportDefaults,
        args,
      );
      const currentConfigJson = JSON.stringify(currentAidnConfigData);
      const nextConfigJson = JSON.stringify(nextAidnConfigData);
      if (currentConfigJson !== nextConfigJson) {
        if (args.dryRun) {
          console.log(
            `[dry-run] ${aidnConfigExists ? "update" : "create"} .aidn/config.json (profile=${nextAidnConfigData.profile}, runtime.stateMode=${nextAidnConfigData.runtime?.stateMode}, install.artifactImportStore=${nextAidnConfigData.install?.artifactImportStore})`,
          );
        } else {
          const configFilePath = writeAidnProjectConfig(targetRoot, nextAidnConfigData);
          console.log(
            `${aidnConfigExists ? "update" : "create"} .aidn/config.json -> ${configFilePath}`,
          );
        }
        if (aidnConfigExists) {
          summary.configUpdated += 1;
        } else {
          summary.configCreated += 1;
        }
        aidnConfigExists = true;
        currentAidnConfigData = nextAidnConfigData;
      } else {
        summary.configSkipped += 1;
      }
    }

    const verifyEntriesSet = new Set();
    for (const packName of selectedPacks) {
      const manifest = packCache.get(packName).manifest;
      const verifyEntries = manifest.verify?.must_exist ?? [];
      for (const entry of verifyEntries) {
        verifyEntriesSet.add(entry);
      }
    }
    const verifyEntries = Array.from(verifyEntriesSet);
    const verification = verifyPaths(targetRoot, verifyEntries);
    const artifactImportVerification = verifyArtifactImportOutputs(targetRoot, args, currentAidnConfigData);
    const workflowPlaceholders = getWorkflowPlaceholders(targetRoot);
    if (!verification.ok) {
      for (const missing of verification.missing) {
        console.error(`missing: ${missing}`);
      }
    }
    if (artifactImportVerification.checked && !artifactImportVerification.ok) {
      for (const missing of artifactImportVerification.missing_files) {
        console.error(`missing import artifact: ${missing}`);
      }
    }
    if (workflowPlaceholders.length > 0) {
      console.warn("");
      console.warn(
        `WARNING: docs/audit/WORKFLOW.md still has placeholders: ${workflowPlaceholders.join(", ")}`,
      );
      console.warn(
        'Customize the project stub. See docs/INSTALL.md sections "Spec vs Project Stub (Why both exist)" and "Step 4 - Customize docs/audit/WORKFLOW.md (Project Stub)".',
      );
    }

    console.log("");
    console.log(`copied: ${summary.copied}`);
    console.log(`merged: ${summary.merged}`);
    console.log(`skipped: ${summary.skipped}`);
    console.log(`preserved_custom: ${summary.preservedCustom}`);
    console.log(`preserved_placeholders_applied: ${summary.preservedPlaceholdersApplied}`);
    console.log(`migrated_custom: ${summary.migratedCustom}`);
    console.log(`migration_failed: ${summary.migrationFailed}`);
    console.log(`placeholder_prompted: ${summary.placeholderPrompted}`);
    console.log(`placeholder_autofilled: ${summary.placeholderAutoFilled}`);
    console.log(`artifact_import_attempted: ${summary.artifactImportAttempted}`);
    console.log(`artifact_import_succeeded: ${summary.artifactImportSucceeded}`);
    console.log(`artifact_import_skipped: ${summary.artifactImportSkipped}`);
    console.log(`artifact_import_verify_ok: ${summary.artifactImportVerified}`);
    console.log(`artifact_import_verify_fail: ${summary.artifactImportVerifyFail}`);
    console.log(`artifact_import_verify_skipped: ${summary.artifactImportVerifySkipped}`);
    console.log(`config_created: ${summary.configCreated}`);
    console.log(`config_updated: ${summary.configUpdated}`);
    console.log(`config_skipped: ${summary.configSkipped}`);
    if (artifactImportVerification.checked) {
      console.log(
        `artifact_import_verify: ${artifactImportVerification.ok ? "OK" : "FAIL"} (store=${artifactImportVerification.defaults?.store ?? "n/a"}, source=${artifactImportVerification.defaults?.source ?? "n/a"})`,
      );
    } else {
      console.log(
        `artifact_import_verify: SKIP (${artifactImportVerification.reason ?? "not checked"})`,
      );
    }
    console.log(`verified: ${verification.ok ? "OK" : "FAIL"}`);

    if ((artifactImportVerification.checked && !artifactImportVerification.ok) && (args.verifyOnly || !args.dryRun)) {
      process.exit(1);
    }
    if (!verification.ok && (args.verifyOnly || !args.dryRun)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
