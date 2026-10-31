import { resolveEffectiveRuntimePersistence } from "./runtime-persistence-service.mjs";
import { createCodexHostEnvironment, CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../core/agents/codex-startup-arguments.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { processFail as fail } from "../../core/workflow/agentic-process-model.mjs";
import { readActivation } from "../install/project-activation-service.mjs";

function selection(targetRoot, env) {
  const selected = resolveEffectiveRuntimePersistence({ targetRoot, env });
  const activation = readActivation({ targetRoot });
  if (!activation.active || activation.state !== "active") fail("PROCESS_EXECUTION_PERSISTENCE_AUTHORITY_UNAVAILABLE");
  const globalRuntime = activation.receipt?.global_runtime ?? null;
  const reference = selected.backend === "postgres" ? selected.connectionRef : null;
  return { selected, globalRuntime, reference, binding: { backend: selected.backend, source: selected.source,
    connection_ref: reference, hook_runtime: globalRuntime } };
}

// Backend authority is the existing resolver, not a second launcher setting.
// This description never resolves or serializes a credential value.
export function agenticProcessPersistence({ targetRoot, env = process.env }) {
  const { selected, reference, binding } = selection(targetRoot, env);
  if (!["sqlite", "postgres"].includes(selected.backend)) fail("PROCESS_EXECUTION_PERSISTENCE_UNSUPPORTED");
  if (selected.backend === "postgres" && !/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(reference ?? "")) fail("PROCESS_EXECUTION_PERSISTENCE_REFERENCE_REQUIRED");
  return { backend: selected.backend, binding_sha256: shadowHash(binding) };
}

// Canonical credentials belong to trusted runtime/admission hosts, not model
// shells or the independent review. Private environment transport only; never
// argv, configuration/stdin, retained evidence or model context.
export function createAgenticProcessWorkerEnvironment({ targetRoot, expectedBinding, env = process.env }) {
  const { selected, globalRuntime, binding } = selection(targetRoot, env);
  if (shadowHash(binding) !== expectedBinding) fail("PROCESS_EXECUTION_PERSISTENCE_CHANGED");
  const worker = createCodexHostEnvironment(env);
  if (globalRuntime) worker.AIDN_HOME = globalRuntime.home; // verified install receipt, not an unrelated environment home
  for (const key of ["AIDN_RUNTIME_PERSISTENCE_BACKEND", "AIDN_RUNTIME_PERSISTENCE_CONNECTION_REF"])
    if (typeof env[key] === "string") worker[key] = env[key];
  if (selected.backend === "postgres") {
    const key = selected.connectionRef.slice(4);
    const forbidden = new Set([...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker, "NODE_OPTIONS", "NODE_PATH",
      "AIDN_HOME", "AIDN_RUNTIME_PERSISTENCE_BACKEND", "AIDN_RUNTIME_PERSISTENCE_CONNECTION_REF"].map(name => name.toUpperCase()));
    if (forbidden.has(key.toUpperCase())) fail("PROCESS_EXECUTION_PERSISTENCE_ENVIRONMENT_UNSAFE");
    if (typeof env[key] !== "string" || !env[key].trim() || env[key].includes("\0")) fail("PROCESS_EXECUTION_PERSISTENCE_CONNECTION_UNAVAILABLE");
    for (const [name, value] of Object.entries(env)) {
      if ((/^PG[A-Z0-9_]+$/.test(name) || ["USER", "USERNAME"].includes(name)) && typeof value === "string") {
        if (value.includes("\0")) fail("PROCESS_EXECUTION_PERSISTENCE_ENVIRONMENT_UNSAFE");
        worker[name] = value;
      }
    }
    worker[key] = env[key];
  }
  return Object.freeze(worker);
}
