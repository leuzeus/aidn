#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readAgentRunFile } from "../../src/application/runtime/agent-run-configuration-service.mjs";
import { createProjectWorkflowConsole } from "../../src/application/runtime/workflow-console-composition.mjs";
import { workflowConsoleEnvelope, workflowConsoleCode } from "../../src/application/runtime/workflow-console-service.mjs";

export function parseWorkflowConsoleArguments(command, argv) {
  if (!["workflow-inspect", "workflow-action", "workflow-dashboard"].includes(command)) throw new Error("WORKFLOW_CONSOLE_COMMAND_INVALID");
  const args = { command, target: ".", json: argv.includes("--json"), help: argv.includes("--help") || argv.includes("-h"),
    write: false, execute: false, syncRelay: false, dryRun: false, serve: false, expectPlan: null };
  if (args.help) return args;
  const values = new Map([["--target", "target"], ["--instance", "instanceId"], ["--workflow", "workflowId"], ["--configuration", "configuration"],
    ["--run", "run"], ["--request", "request"], ["--expect-plan", "expectPlan"]]);
  const flags = new Map([["--json", "json"], ["--write", "write"], ["--execute", "execute"], ["--sync-relay", "syncRelay"], ["--dry-run", "dryRun"], ["--serve", "serve"]]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]; if (seen.has(token)) throw new Error("WORKFLOW_CONSOLE_DUPLICATE_ARGUMENT"); seen.add(token);
    if (flags.has(token)) args[flags.get(token)] = true;
    else if (values.has(token)) {
      const value = argv[++i]; if (!value?.trim() || value.startsWith("--")) throw new Error("WORKFLOW_CONSOLE_ARGUMENT_VALUE_REQUIRED");
      args[values.get(token)] = value;
    } else throw new Error("WORKFLOW_CONSOLE_UNKNOWN_ARGUMENT");
  }
  if (args.write && args.execute || args.dryRun && (args.write || args.execute || args.serve || args.syncRelay)
    || command !== "workflow-action" && (args.write || args.execute || args.syncRelay || args.request || args.expectPlan)
    || command !== "workflow-inspect" && (args.instanceId || args.workflowId || args.configuration || args.run)
    || command !== "workflow-dashboard" && args.serve) throw new Error("WORKFLOW_CONSOLE_EFFECT_CONFLICT");
  return args;
}
export async function runWorkflowConsoleCli(command, argv, { createService = createProjectWorkflowConsole, startDashboard = null } = {}) {
  const name = command.replace("workflow-", "");
  // Preserve the logical effect on parser refusals, with the same help and
  // dry-run precedence as the public policy. Refusal never implies an effect.
  const effect = argv.includes("--help") || argv.includes("-h") ? "read-only" : argv.includes("--dry-run") ? "preview"
    : name === "action" && argv.includes("--write") ? "mutating"
    : name === "action" && argv.includes("--execute") || name === "dashboard" && argv.includes("--serve") ? "executor"
    : name === "inspect" ? "read-only" : "preview";
  let args;
  try {
    args = parseWorkflowConsoleArguments(command, argv);
    if (args.help) return { ...workflowConsoleEnvelope(name), usage: `aidn runtime ${command} --target <root> [--json]` +
      (name === "inspect" ? " [--instance <id>] [--workflow <id>] [--configuration <file> --run <id>]" : name === "action" ? " --request <file> [--write|--execute --expect-plan <sha256> [--sync-relay]]" : " [--serve]") };
    if (name === "dashboard") {
      if (!args.serve) return { ...workflowConsoleEnvelope(name, "preview"), listening: false, url: null, token: null };
      const start = startDashboard ?? (await import("../../src/adapters/workflow-console/dashboard-server.mjs")).startWorkflowDashboard;
      const server = await start({ targetRoot: args.target });
      const stop = () => { server.close(); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      return { ...workflowConsoleEnvelope(name, "executor"), dry_run: false, listening: true, url: server.url, token: server.token };
    }
    const service = createService({ targetRoot: args.target });
    if (name === "inspect") return { ...await service.inspect({ instanceId: args.instanceId, workflowId: args.workflowId, configuration: args.configuration, run: args.run }), effect_class: effect };
    if (!args.request) throw new Error("WORKFLOW_CONSOLE_REQUEST_REQUIRED");
    return service.action(readAgentRunFile(path.resolve(args.request)).value, args);
  } catch (cause) {
    return { ...workflowConsoleEnvelope(name, effect), errors: [workflowConsoleCode(cause)],
      ...(name === "inspect" ? { view: null } : name === "action" ? { action_sha256: null, action: null, can_apply: false, result: null } : { listening: false, url: null, token: null }) };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...argv] = process.argv.slice(2), result = await runWorkflowConsoleCli(command, argv);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.errors.length ? 1 : 0;
}
