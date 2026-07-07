#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCodexAgentAdapter } from "../../src/adapters/codex/codex-agent-adapter.mjs";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runJsonHookUseCase } from "../../src/application/codex/run-json-hook-use-case.mjs";
import { getAidnProjectConfigCacheStats } from "../../src/lib/config/aidn-config-lib.mjs";
import { runWorkflowStep } from "../codex/workflow-step.mjs";

const CONTRACT_VERSION = "runtime-local-daemon.v1";
const TOOL_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ENDPOINT_FILE = ".aidn/runtime/daemon/endpoint.json";

function parseArgs(argv) {
  const args = {
    start: false,
    serve: false,
    status: false,
    stop: false,
    target: ".",
    host: "127.0.0.1",
    hostExplicit: false,
    port: 48173,
    portExplicit: false,
    endpointFile: DEFAULT_ENDPOINT_FILE,
    readyFile: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--start") {
      args.start = true;
    } else if (token === "--serve") {
      args.serve = true;
    } else if (token === "--status") {
      args.status = true;
    } else if (token === "--stop") {
      args.stop = true;
    } else if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--host") {
      args.host = String(argv[i + 1] ?? "").trim();
      args.hostExplicit = true;
      i += 1;
    } else if (token === "--port") {
      args.port = Number(argv[i + 1] ?? 48173);
      args.portExplicit = true;
      i += 1;
    } else if (token === "--endpoint-file") {
      args.endpointFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--ready-file") {
      args.readyFile = String(argv[i + 1] ?? "").trim();
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
  if (!args.host) {
    throw new Error("Missing value for --host");
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    throw new Error("Invalid --port. Expected 0..65535.");
  }
  const selectedActions = [args.start, args.serve, args.status, args.stop].filter(Boolean).length;
  if (selectedActions > 1) {
    throw new Error("Choose only one of --start, --serve, --status, or --stop.");
  }
  if (!args.serve && !args.status && !args.start && !args.stop) {
    args.status = true;
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.endpointFile) {
    throw new Error("Missing value for --endpoint-file");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime local-daemon --start --target . --json");
  console.log("  npx aidn runtime local-daemon --status --target . --json");
  console.log("  npx aidn runtime local-daemon --stop --target . --json");
  console.log("  npx aidn runtime local-daemon --serve --host 127.0.0.1 --port 48173 --json");
  console.log("  node tools/runtime/local-daemon.mjs --serve --port 0 --ready-file .aidn/runtime/daemon-ready.json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function resolveEndpointFile(targetRoot, endpointFile) {
  return resolveTargetPath(targetRoot, endpointFile || DEFAULT_ENDPOINT_FILE);
}

function readEndpointFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const host = String(payload?.daemon?.host ?? payload?.host ?? "").trim();
    const port = Number(payload?.daemon?.port ?? payload?.port ?? 0);
    if (!host || !Number.isInteger(port) || port < 1) {
      return null;
    }
    return {
      ...payload,
      host,
      port,
      pid: Number(payload?.daemon?.pid ?? payload?.pid ?? 0) || null,
    };
  } catch {
    return null;
  }
}

function healthPayload(server = null, meta = {}) {
  const address = server?.address?.() ?? null;
  return {
    ts: new Date().toISOString(),
    ok: true,
    contract_version: CONTRACT_VERSION,
    command: "aidn runtime local-daemon --json",
    effect_class: "executor",
    daemon: {
      status: "ready",
      pid: process.pid,
      uptime_ms: Math.round(process.uptime() * 1000),
      host: typeof address === "object" && address ? address.address : null,
      port: typeof address === "object" && address ? address.port : null,
      endpoint_file: meta.endpointFile ?? null,
      target_root: meta.targetRoot ?? null,
      capabilities: ["health", "codex.workflow-step", "codex.run-json-hook"],
    },
    caches: {
      aidn_project_config: getAidnProjectConfigCacheStats(),
    },
  };
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 1048576) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`invalid JSON request body: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function handleExecute(request) {
  const body = await readRequestJson(request);
  const operation = String(body?.operation ?? "").trim();
  if (!["codex.workflow-step", "codex.run-json-hook"].includes(operation)) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        contract_version: CONTRACT_VERSION,
        message: `unsupported daemon operation: ${operation || "none"}`,
      },
    };
  }
  const args = body?.args && typeof body.args === "object" ? body.args : {};
  const targetRoot = path.resolve(String(body?.targetRoot ?? args.target ?? "."));
  if (operation === "codex.run-json-hook") {
    const payload = runJsonHookUseCase({
      args: {
        ...args,
        target: targetRoot,
        useDaemon: false,
      },
      targetRoot,
      agentAdapter: createCodexAgentAdapter(),
      hookContextStore: createHookContextStoreAdapter(),
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        contract_version: CONTRACT_VERSION,
        operation,
        payload,
      },
    };
  }
  const payload = await runWorkflowStep({
    args: {
      ...args,
      target: targetRoot,
      useDaemon: false,
    },
    targetRoot,
  });
  return {
    statusCode: 200,
    payload: {
      ok: true,
      contract_version: CONTRACT_VERSION,
      operation,
      payload,
    },
  };
}

function createDaemonServer() {
  let server;
  server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        writeJson(response, 200, healthPayload(server));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/execute") {
        const result = await handleExecute(request);
        writeJson(response, result.statusCode, result.payload);
        return;
      }
      if (request.method === "POST" && request.url === "/shutdown") {
        writeJson(response, 200, {
          ok: true,
          contract_version: CONTRACT_VERSION,
          daemon: {
            status: "stopping",
            pid: process.pid,
          },
        });
        setTimeout(() => {
          server.close(() => process.exit(0));
        }, 25);
        return;
      }
      writeJson(response, 404, {
        ok: false,
        contract_version: CONTRACT_VERSION,
        message: "not found",
      });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        contract_version: CONTRACT_VERSION,
        message: String(error.message ?? error),
      });
    }
  });
  return server;
}

function writeReadyFile(filePath, payload) {
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function requestJson({ host, port, method = "GET", requestPath = "/health", timeoutMs = 1500 }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host,
      port,
      method,
      path: requestPath,
      timeout: timeoutMs,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(new Error(`daemon status returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("daemon request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function endpointForArgs(args, targetRoot) {
  const endpointFile = resolveEndpointFile(targetRoot, args.endpointFile);
  const endpoint = readEndpointFile(endpointFile);
  if (endpoint && !args.portExplicit && !args.hostExplicit) {
    return {
      host: endpoint.host,
      port: endpoint.port,
      endpointFile,
      endpoint,
    };
  }
  return {
    host: args.host,
    port: args.port,
    endpointFile,
    endpoint,
  };
}

async function startDaemon(args, targetRoot) {
  const endpointFile = resolveEndpointFile(targetRoot, args.endpointFile);
  const existing = readEndpointFile(endpointFile);
  if (existing) {
    try {
      const status = await requestJson({
        host: existing.host,
        port: existing.port,
        requestPath: "/health",
        timeoutMs: 750,
      });
      if (status?.ok === true) {
        return {
          ...status,
          command: "aidn runtime local-daemon --start --json",
          started: false,
          reused_existing: true,
          endpoint_file: endpointFile,
        };
      }
    } catch {
      // Stale endpoint; starting a fresh daemon below will overwrite it.
    }
  }

  fs.mkdirSync(path.dirname(endpointFile), { recursive: true });
  const child = spawn(process.execPath, [
    TOOL_FILE,
    "--serve",
    "--target",
    targetRoot,
    "--host",
    args.host,
    "--port",
    String(args.port),
    "--ready-file",
    endpointFile,
    "--endpoint-file",
    endpointFile,
  ], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const started = Date.now();
  while (Date.now() - started < 10000) {
    const endpoint = readEndpointFile(endpointFile);
    if (endpoint) {
      try {
        const status = await requestJson({
          host: endpoint.host,
          port: endpoint.port,
          requestPath: "/health",
          timeoutMs: 750,
        });
        if (status?.ok === true) {
          return {
            ...status,
            command: "aidn runtime local-daemon --start --json",
            started: true,
            reused_existing: false,
            endpoint_file: endpointFile,
          };
        }
      } catch {
        // Retry until the daemon is ready or the startup timeout expires.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`daemon did not become ready: ${endpointFile}`);
}

async function stopDaemon(args, targetRoot) {
  const endpoint = endpointForArgs(args, targetRoot);
  const unavailablePayload = {
    ts: new Date().toISOString(),
    ok: false,
    contract_version: CONTRACT_VERSION,
    command: "aidn runtime local-daemon --stop --json",
    effect_class: "executor",
    endpoint_file: endpoint.endpointFile,
    daemon: {
      status: "unavailable",
      host: endpoint.host,
      port: endpoint.port,
    },
  };
  if (!endpoint.endpoint && !args.portExplicit) {
    return {
      ...unavailablePayload,
      message: "daemon endpoint file not found",
    };
  }
  try {
    const payload = await requestJson({
      host: endpoint.host,
      port: endpoint.port,
      method: "POST",
      requestPath: "/shutdown",
      timeoutMs: 1500,
    });
    try {
      fs.rmSync(endpoint.endpointFile, { force: true });
    } catch {
      // Endpoint cleanup is best-effort; status will still report the daemon shutdown response.
    }
    return {
      ...payload,
      command: "aidn runtime local-daemon --stop --json",
      endpoint_file: endpoint.endpointFile,
      stopped: true,
    };
  } catch (error) {
    return {
      ...unavailablePayload,
      message: String(error.message ?? error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = path.resolve(process.cwd(), args.target);
  if (args.start) {
    const payload = await startDaemon(args, targetRoot);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (args.serve) {
    const server = createDaemonServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(args.port, args.host, resolve);
    });
    const endpointFile = resolveEndpointFile(targetRoot, args.readyFile || args.endpointFile);
    const payload = healthPayload(server, {
      endpointFile,
      targetRoot,
    });
    writeReadyFile(args.readyFile, payload);
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }
  if (args.stop) {
    const payload = await stopDaemon(args, targetRoot);
    console.log(JSON.stringify(payload, null, 2));
    if (payload.ok === false) {
      process.exit(1);
    }
    return;
  }

  try {
    const endpoint = endpointForArgs(args, targetRoot);
    const payload = await requestJson({
      host: endpoint.host,
      port: endpoint.port,
      requestPath: "/health",
      timeoutMs: 1500,
    });
    console.log(JSON.stringify({
      ...payload,
      endpoint_file: endpoint.endpointFile,
    }, null, 2));
  } catch (error) {
    const endpoint = endpointForArgs(args, targetRoot);
    const payload = {
      ts: new Date().toISOString(),
      ok: false,
      contract_version: CONTRACT_VERSION,
      command: "aidn runtime local-daemon --status --json",
      effect_class: "read-only",
      endpoint_file: endpoint.endpointFile,
      daemon: {
        status: "unavailable",
        host: endpoint.host,
        port: endpoint.port,
      },
      message: String(error.message ?? error),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}

await main();
