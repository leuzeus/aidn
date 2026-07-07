#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createCodexAgentAdapter } from "../../src/adapters/codex/codex-agent-adapter.mjs";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runJsonHookUseCase } from "../../src/application/codex/run-json-hook-use-case.mjs";
import {
  loadSqliteIndexPayloadSafe,
  resolveAuditArtifactText,
  resolveDbBackedMode,
} from "../runtime/db-first-runtime-view-lib.mjs";

const DEFAULT_DAEMON_ENDPOINT_FILE = ".aidn/runtime/daemon/endpoint.json";

function splitArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx < 0) {
    return { options: argv, command: [] };
  }
  return {
    options: argv.slice(0, idx),
    command: argv.slice(idx + 1),
  };
}

function parseArgs(argv) {
  const { options, command } = splitArgs(argv);
  const args = {
    skill: "",
    mode: "",
    target: ".",
    stateMode: "",
    strict: false,
    noAutoSkipGate: false,
    failOnRepairBlock: false,
    failOnError: false,
    forceJson: true,
    contextFile: ".aidn/runtime/context/codex-context.json",
    rawDir: ".aidn/runtime/context/raw",
    maxEntries: 50,
    json: false,
    verbose: false,
    includeRaw: false,
    dbSync: null,
    dbSyncExplicit: false,
    useDaemon: false,
    daemonHost: "127.0.0.1",
    daemonPort: 0,
    daemonEndpointFile: DEFAULT_DAEMON_ENDPOINT_FILE,
    daemonTimeoutMs: 30000,
    command,
  };

  for (let i = 0; i < options.length; i += 1) {
    const token = options[i];
    if (token === "--skill") {
      args.skill = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(options[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--target") {
      args.target = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(options[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--no-auto-skip-gate") {
      args.noAutoSkipGate = true;
    } else if (token === "--fail-on-repair-block") {
      args.failOnRepairBlock = true;
    } else if (token === "--fail-on-error") {
      args.failOnError = true;
    } else if (token === "--no-force-json") {
      args.forceJson = false;
    } else if (token === "--context-file") {
      args.contextFile = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--raw-dir") {
      args.rawDir = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--max-entries") {
      args.maxEntries = Number(options[i + 1] ?? 50);
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--verbose") {
      args.verbose = true;
    } else if (token === "--include-raw") {
      args.includeRaw = true;
    } else if (token === "--db-sync") {
      args.dbSync = true;
      args.dbSyncExplicit = true;
    } else if (token === "--no-db-sync") {
      args.dbSync = false;
      args.dbSyncExplicit = true;
    } else if (token === "--use-daemon") {
      args.useDaemon = true;
    } else if (token === "--daemon-host") {
      args.daemonHost = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--daemon-port") {
      args.daemonPort = Number(options[i + 1] ?? 0);
      i += 1;
    } else if (token === "--daemon-endpoint-file") {
      args.daemonEndpointFile = String(options[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--daemon-timeout-ms") {
      args.daemonTimeoutMs = Number(options[i + 1] ?? 30000);
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.skill) {
    throw new Error("Missing value for --skill");
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!Number.isFinite(args.maxEntries) || args.maxEntries < 1) {
    throw new Error("Invalid --max-entries. Expected a positive integer.");
  }
  if (args.useDaemon && !args.daemonEndpointFile && (!args.daemonHost || !Number.isInteger(args.daemonPort) || args.daemonPort < 1)) {
    throw new Error("Invalid daemon endpoint. Expected --daemon-endpoint-file or --daemon-host plus --daemon-port when --use-daemon is supplied.");
  }
  if (!Number.isFinite(args.daemonTimeoutMs) || args.daemonTimeoutMs < 100) {
    throw new Error("Invalid --daemon-timeout-ms. Expected at least 100.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . --json");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . -- npx aidn perf skill-hook --skill context-reload --target . --mode THINKING --json");
  console.log("  npx aidn codex run-json-hook --skill branch-cycle-audit --mode COMMITTING --target . --strict --fail-on-error");
  console.log("  npx aidn codex run-json-hook --skill cycle-create --mode COMMITTING --target . --db-sync --json");
  console.log("  npx aidn codex run-json-hook --skill close-session --mode COMMITTING --target . --no-auto-skip-gate --json");
  console.log("  npx aidn codex run-json-hook --skill close-session --mode COMMITTING --target . --fail-on-repair-block");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . --json --verbose");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . --json --include-raw");
  console.log("  npx aidn codex run-json-hook --skill context-reload --mode THINKING --target . --json --use-daemon");
}

function resolveRuntimeStateHint(targetRoot, requestedStateMode = "") {
  const { dbBackedMode } = resolveDbBackedMode(targetRoot, requestedStateMode || "files");
  const sqliteFallback = dbBackedMode ? loadSqliteIndexPayloadSafe(targetRoot, { includePayload: false }) : {
    exists: false,
    sqliteFile: "",
    payload: null,
    runtimeHeads: {},
    warning: "",
  };
  return resolveAuditArtifactText({
    targetRoot,
    candidatePath: "docs/audit/RUNTIME-STATE.md",
    dbBacked: dbBackedMode,
    sqlitePayload: sqliteFallback.payload,
    sqliteRuntimeHeads: sqliteFallback.runtimeHeads,
  });
}

function printRuntimeDigestHint(targetRoot, repairLayerStatus, requestedStateMode = "") {
  const status = String(repairLayerStatus ?? "").trim().toLowerCase();
  if (!["warn", "block"].includes(status)) {
    return;
  }
  const runtimeStateResolution = resolveRuntimeStateHint(targetRoot, requestedStateMode);
  if (!runtimeStateResolution.exists) {
    return;
  }
  console.log("Runtime digest: docs/audit/RUNTIME-STATE.md");
}

function printCurrentStateStaleHint(targetRoot, requestedStateMode = "") {
  const runtimeStateResolution = resolveRuntimeStateHint(targetRoot, requestedStateMode);
  if (!runtimeStateResolution.exists) {
    return;
  }
  const text = runtimeStateResolution.text;
  if (!text.includes("current_state_freshness: stale")) {
    return;
  }
  console.log("Current state stale: docs/audit/CURRENT-STATE.md");
}

function resolveDaemonEndpointFile(targetRoot, endpointFile) {
  if (!endpointFile) {
    return "";
  }
  if (path.isAbsolute(endpointFile)) {
    return path.resolve(endpointFile);
  }
  return path.resolve(targetRoot, endpointFile);
}

function readDaemonEndpoint(targetRoot, endpointFile) {
  const filePath = resolveDaemonEndpointFile(targetRoot, endpointFile);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const host = String(payload?.daemon?.host ?? payload?.host ?? "").trim();
  const port = Number(payload?.daemon?.port ?? payload?.port ?? 0);
  if (!host || !Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid daemon endpoint file: ${filePath}`);
  }
  return {
    host,
    port,
    endpoint_file: filePath,
  };
}

function resolveDaemonEndpoint(args, targetRoot) {
  if (Number.isInteger(args.daemonPort) && args.daemonPort > 0) {
    return {
      host: args.daemonHost,
      port: args.daemonPort,
      endpoint_file: null,
    };
  }
  const endpoint = readDaemonEndpoint(targetRoot, args.daemonEndpointFile);
  if (!endpoint) {
    throw new Error(`daemon endpoint file not found: ${resolveDaemonEndpointFile(targetRoot, args.daemonEndpointFile)}`);
  }
  return endpoint;
}

function requestDaemonRunJsonHook({ args, targetRoot }) {
  return new Promise((resolve, reject) => {
    let endpoint;
    try {
      endpoint = resolveDaemonEndpoint(args, targetRoot);
    } catch (error) {
      reject(error);
      return;
    }
    const body = JSON.stringify({
      operation: "codex.run-json-hook",
      targetRoot,
      args: {
        ...args,
        target: targetRoot,
        useDaemon: false,
      },
    });
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      method: "POST",
      path: "/v1/execute",
      agent: false,
      headers: {
        "connection": "close",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(responseBody || "{}");
        } catch (error) {
          reject(new Error(`daemon returned invalid JSON: ${error.message}`));
          return;
        }
        if ((response.statusCode ?? 500) >= 400 || parsed.ok === false) {
          reject(new Error(parsed.message || `daemon request failed with status ${response.statusCode}`));
          return;
        }
        const payload = parsed.payload ?? parsed;
        payload.__daemon_endpoint = endpoint;
        resolve(payload);
      });
    });
    request.setTimeout(args.daemonTimeoutMs, () => {
      request.destroy(new Error("daemon request timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function runLocalJsonHook(args, targetRoot) {
  const agentAdapter = createCodexAgentAdapter();
  const hookContextStore = createHookContextStoreAdapter();
  return runJsonHookUseCase({
    args,
    targetRoot,
    agentAdapter,
    hookContextStore,
  });
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    let output;
    if (args.useDaemon) {
      try {
        output = await requestDaemonRunJsonHook({ args, targetRoot });
        const endpoint = output.__daemon_endpoint ?? null;
        delete output.__daemon_endpoint;
        output.daemon = {
          used: true,
          endpoint: endpoint ? `${endpoint.host}:${endpoint.port}` : `${args.daemonHost}:${args.daemonPort}`,
          endpoint_file: endpoint?.endpoint_file ?? null,
          fallback: false,
        };
      } catch (error) {
        output = await runLocalJsonHook(args, targetRoot);
        output.daemon = {
          used: false,
          endpoint: args.daemonPort > 0 ? `${args.daemonHost}:${args.daemonPort}` : null,
          endpoint_file: resolveDaemonEndpointFile(targetRoot, args.daemonEndpointFile),
          fallback: true,
          reason: String(error.message ?? error),
        };
      }
    } else {
      output = await runLocalJsonHook(args, targetRoot);
      output.daemon = {
        used: false,
        fallback: false,
        reason: "not_requested",
      };
    }

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      const status = output.ok ? "OK" : "WARN";
      const decision = output.decision ?? output.action ?? output.result ?? "n/a";
      const repairStatus = String(output.repair_layer_status ?? "").trim().toLowerCase();
      const shouldPrintRepairDetails = Number(output.repair_layer_open_count ?? 0) > 0
        || repairStatus === "warn"
        || repairStatus === "block";
      console.log(`Hook context ${status}: skill=${output.skill} mode=${output.mode} state=${output.state_mode} decision=${decision}`);
      if (shouldPrintRepairDetails) {
        console.log(`Repair findings: ${output.repair_layer_open_count} open${output.repair_layer_blocking ? " (blocking)" : ""}`);
        if (output.repair_layer_status) {
          console.log(`Repair status: ${output.repair_layer_status}`);
        }
        if (output.repair_layer_advice) {
          console.log(`Repair advice: ${output.repair_layer_advice}`);
        }
        printRuntimeDigestHint(targetRoot, output.repair_layer_status, args.stateMode);
        printCurrentStateStaleHint(targetRoot, args.stateMode);
      }
      console.log(`Context file: ${output.context_file}`);
    }

    const dbSyncFailed = output.db_sync?.enabled === true && output.db_sync?.error != null;
    const shouldFail = (!output.ok && (args.failOnError || output.strict === true))
      || (dbSyncFailed && output.strict === true)
      || (args.failOnRepairBlock && String(output.repair_layer_status ?? "") === "block");
    if (shouldFail) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
