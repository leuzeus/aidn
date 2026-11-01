import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from "./agentic-process.mjs";
import { exactKeys, processFail as fail } from "./agentic-process-model.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import schema from "../contracts/workflow-definition/agentic-process-simulation.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";

// An offline event scenario uses exactly the execution reducer. It has no host
// ports, clock, executor, persistence or authority. Synthetic assignment/result
// records test bindings and flow; they cannot authenticate a real resource.
export function simulateAgenticProcess(input) {
  if (checkShadowJson(input) || !exactKeys(input, ["instanceId", "model", "policyPins", "scopeId", "events"], ["facts"])
    || !Array.isArray(input.events) || input.events.length > 512) fail("PROCESS_SIMULATION_INPUT_INVALID");
  const { events, ...initial } = input;
  let instance = createAgenticProcess(initial);
  let traceBytes = 0;
  const snapshot = (step, eventId) => {
    const row = { step, event_id: eventId, instance_sha256: instance.instance_sha256, cursor: inspectAgenticProcess(instance) };
    traceBytes += Buffer.byteLength(JSON.stringify(row), "utf8");
    if (traceBytes > 4 * 1024 * 1024) fail("PROCESS_SIMULATION_TRACE_LIMIT");
    return row;
  };
  const trace = [snapshot(0, null)];
  for (const [index, event] of events.entries()) {
    instance = advanceAgenticProcess(instance, event);
    trace.push(snapshot(index + 1, event.event_id));
  }
  const simulation = { contract_version: "agentic-process-simulation.v1", evidence_kind: "synthetic",
    write_authorization: false, model_sha256: instance.model_sha256, scenario_sha256: shadowHash(input), trace };
  if (validateJsonSchema(simulation, schema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_SIMULATION_INVALID");
  return freezeShadow(simulation);
}
