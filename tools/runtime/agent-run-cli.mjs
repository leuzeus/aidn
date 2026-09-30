#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { agentRunEffect, agentRunFailure, parseAgentRunArguments } from "../../src/application/runtime/agent-run-lifecycle-service.mjs";

export async function runAgentRunCli(command, argv) {
  const fallback = { command, json: argv.includes("--json"), execute: argv.includes("--execute"),
    write: argv.includes("--write"), help: argv.includes("--help") || argv.includes("-h") };
  let args;
  try {
    args = parseAgentRunArguments(command, argv);
    if (args.help) {
      return { help: true, usage: "aidn runtime " + command + " --configuration <file> "
        + (command === "agent-run" ? "--plan <file>" : "--run <id>")
        + (command === "agent-run-status" ? "" : command === "agent-run-cleanup" ? " [--write --expect-plan <sha256> --sync-relay]" : " [--execute --expect-plan <sha256> --sync-relay]")
        + " [--target <root>] [--json]", effect_class: "read-only" };
    }
    const { createPublicAgentRunLifecycle } = await import("../../src/application/runtime/agent-run-public-composition.mjs");
    const lifecycle = createPublicAgentRunLifecycle();
    const stop = new AbortController();
    const cancel = () => stop.abort();
    process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
    try { return await lifecycle.invoke(args, { signal: stop.signal }); }
    finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
  } catch (cause) { return agentRunFailure(args ?? fallback, cause); }
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const result = await runAgentRunCli(command, argv);
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else if (result.help) process.stdout.write(result.usage + "\n");
  else {
    process.stdout.write(result.command + ": " + (result.errors.length ? result.errors.join(", ") : result.status?.execution_status ?? "preview") + "\n");
    if (result.action_sha256) process.stdout.write("Action SHA-256: " + result.action_sha256 + "\n");
    if (result.action?.preconditions.blockers.length) process.stdout.write("Blocked: " + result.action.preconditions.blockers.join(", ") + "\n");
  }
  process.exitCode = result.errors?.length ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
