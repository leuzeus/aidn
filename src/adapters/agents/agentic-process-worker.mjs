import { createProjectAgenticProcessExecution } from "../../application/runtime/agentic-process-execution-composition.mjs";

// Fixed worker entry, static bounded input from the owned process controller.
// No module path, inline authority, shell command or secret travels in this pipe.
let input = Buffer.alloc(0);
let specification = null;
try {
  for await (const part of process.stdin) {
    if (input.length + part.length > 262144) throw Error("PROCESS_WORKER_INPUT_LIMIT");
    input = Buffer.concat([input, part]);
  }
  specification = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
  const { configuration, authorization, persistenceBinding } = specification;
  const execution = createProjectAgenticProcessExecution(configuration);
  const result = await execution.run({ execute: true, authorization, persistenceBinding });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  // No raw error/body/configuration is written to stderr.
  const candidate = error?.code ?? error?.message;
  const code = /^(PROCESS_|ARTIFACT_|WORKFLOW_INSTANCE_)[A-Z_]+$/.test(candidate ?? "") ? candidate : "PROCESS_WORKER_FAILED";
  process.stderr.write(code + "\n");
  process.stdout.write(JSON.stringify({ contract_version: "agentic-process-execution-result.v1", status: "FAILED", first_failure: code,
    global_deadline_ms: Number.isSafeInteger(specification?.authorization?.global_deadline_ms) ? specification.authorization.global_deadline_ms : null,
    responses_observed: null, consumption: "UNKNOWN_AFTER_UNHANDLED_WORKER_ERROR", native_parent_closure: null,
    process_tree_closure: "OUTER_CONTROLLER_REQUIRED", retry: false }) + "\n");
  process.exitCode = 1;
}
