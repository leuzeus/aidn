import http from "node:http";
import fs from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createProjectWorkflowConsole } from "../../application/runtime/workflow-console-composition.mjs";
import { workflowConsoleCode } from "../../application/runtime/workflow-console-service.mjs";

// Explicit foreground server. No discovery, persisted credentials, SQL access,
// browser launch, telemetry, CORS grant or network-facing bind.
export async function startWorkflowDashboard({ targetRoot, createService = createProjectWorkflowConsole }) {
  const service = createService({ targetRoot }), token = randomBytes(32).toString("hex");
  const assets = new Map([["/", ["text/html; charset=utf-8", "dashboard.html"]], ["/dashboard.js", ["text/javascript; charset=utf-8", "dashboard.js"]], ["/dashboard.css", ["text/css; charset=utf-8", "dashboard.css"]]]);
  let origin, active = false;
  const server = http.createServer(async (request, response) => {
    const send = (code, value, type = "application/json") => {
      response.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      response.end(type === "application/json" ? JSON.stringify(value) : value);
    };
    try {
      if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin) return send(403, { errors: ["WORKFLOW_DASHBOARD_ORIGIN_REFUSED"] });
      if (request.method === "GET" && assets.has(request.url)) {
        const [type, file] = assets.get(request.url); return send(200, fs.readFileSync(new URL(file, import.meta.url)), type);
      }
      const supplied = request.headers.authorization ?? "", expected = "Bearer " + token;
      if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return send(403, { errors: ["WORKFLOW_DASHBOARD_AUTH_REQUIRED"] });
      if (request.method !== "POST" || request.headers.origin !== origin || request.headers["content-type"] !== "application/json") return send(405, { errors: ["WORKFLOW_DASHBOARD_REQUEST_REFUSED"] });
      if (!["/api/inspect", "/api/action"].includes(request.url)) return send(404, { errors: ["WORKFLOW_DASHBOARD_ROUTE_UNKNOWN"] });
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) return send(413, { errors: ["WORKFLOW_DASHBOARD_REQUEST_LIMIT"] }); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) return send(400, { errors: ["WORKFLOW_DASHBOARD_REQUEST_INVALID"] });
      if (request.url === "/api/inspect") {
        if (Object.keys(body).some(key => !["instanceId", "workflowId", "configuration", "run"].includes(key))) return send(400, { errors: ["WORKFLOW_DASHBOARD_REQUEST_INVALID"] });
        return send(200, await service.inspect(body));
      }
      if (Object.keys(body).some(key => !["request", "write", "execute", "syncRelay", "expectPlan"].includes(key))) return send(400, { errors: ["WORKFLOW_DASHBOARD_REQUEST_INVALID"] });
      if (active) return send(409, { errors: ["WORKFLOW_DASHBOARD_ACTION_BUSY"] });
      active = true;
      try { const { request: action, ...intent } = body; return send(200, await service.action(action, intent)); }
      finally { active = false; }
    } catch (cause) { send(400, { errors: [workflowConsoleCode(cause)] }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, token, close: () => { server.close(); server.closeIdleConnections(); } };
}
