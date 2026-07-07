#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { getAidnProjectConfigCacheStats } from "../../src/lib/config/aidn-config-lib.mjs";
import { runWorkflowStep } from "../codex/workflow-step.mjs";

const CONTRACT_VERSION = "runtime-local-daemon.v1";

function parseArgs(argv) {
  const args = {
    serve: false,
    status: false,
    host: "127.0.0.1",
    port: 48173,
    readyFile: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--serve") {
      args.serve = true;
    } else if (token === "--status") {
      args.status = true;
    } else if (token === "--host") {
      args.host = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--port") {
      args.port = Number(argv[i + 1] ?? 48173);
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
  if (!args.serve && !args.status) {
    args.status = true;
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime local-daemon --status --json");
  console.log("  npx aidn runtime local-daemon --serve --host 127.0.0.1 --port 48173 --json");
  console.log("  node tools/runtime/local-daemon.mjs --serve --port 0 --ready-file .aidn/runtime/daemon-ready.json");
}

function healthPayload(server = null) {
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
      capabilities: ["health", "codex.workflow-step"],
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
  if (operation !== "codex.workflow-step") {
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

function requestStatus({ host, port }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host,
      port,
      method: "GET",
      path: "/health",
      timeout: 1500,
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
    request.on("timeout", () => request.destroy(new Error("daemon status timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.serve) {
    const server = createDaemonServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(args.port, args.host, resolve);
    });
    const payload = healthPayload(server);
    writeReadyFile(args.readyFile, payload);
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }

  try {
    const payload = await requestStatus(args);
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    const payload = {
      ts: new Date().toISOString(),
      ok: false,
      contract_version: CONTRACT_VERSION,
      command: "aidn runtime local-daemon --status --json",
      effect_class: "read-only",
      daemon: {
        status: "unavailable",
        host: args.host,
        port: args.port,
      },
      message: String(error.message ?? error),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}

await main();
