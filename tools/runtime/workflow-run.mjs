#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runProjectWorkflow, workflowRunEnvelope } from "../../src/application/runtime/workflow-run-service.mjs";

export async function runWorkflowRunCli(argv, { run = runProjectWorkflow } = {}) {
  const effect = argv.includes("--help") || argv.includes("-h") ? "read-only" : argv.includes("--dry-run") ? "preview" : argv.includes("--execute") ? "executor" : "preview";
  const output = workflowRunEnvelope(effect);
  if (effect === "read-only") return { ...output, usage: "aidn runtime workflow-run --target <root> [--engine agentic|legacy] --configuration <file> [--authorization <file>] [--json] [--execute --expect-plan <sha256>] [--plan <legacy-plan> --sync-relay]" };
  try {
    const args = { targetRoot: "." }, seen = new Set();
    const values = { "--target": "targetRoot", "--engine": "engine", "--configuration": "configuration", "--authorization": "authorization", "--expect-plan": "expectPlan", "--plan": "plan" };
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i];
      if (seen.has(token)) throw new Error("WORKFLOW_RUN_DUPLICATE_ARGUMENT");
      seen.add(token);
      if (Object.hasOwn(values, token)) {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error("WORKFLOW_RUN_ARGUMENT_VALUE_REQUIRED");
        args[values[token]] = value;
      } else if (token === "--execute") args.execute = true;
      else if (token === "--sync-relay") args.syncRelay = true;
      else if (!["--json", "--dry-run"].includes(token)) throw new Error("WORKFLOW_RUN_UNKNOWN_ARGUMENT");
    }
    if (seen.has("--dry-run") && (args.execute || args.syncRelay)) throw new Error("WORKFLOW_RUN_EFFECT_CONFLICT");
    return await run(args);
  } catch (cause) { return { ...output, errors: [/^[A-Z][A-Z0-9_]{0,100}$/.test(cause.message) ? cause.message : "WORKFLOW_RUN_UNAVAILABLE"] }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await runWorkflowRunCli(process.argv.slice(2));
  console.log(JSON.stringify(output));
  if (output.errors.length) process.exitCode = 1;
}
