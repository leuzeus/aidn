import { createAgenticProcess, advanceAndInspectAgenticProcess, inspectAgenticProcess } from "./agentic-process.mjs";
import { exactKeys, processFail as fail } from "./agentic-process-model.mjs";
import { checkShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";
import schema from "../contracts/workflow-definition/agentic-process-simulation.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";

const TRACE_BYTES = 4 * 1024 * 1024;

// Internal pull iterator over the existing synthetic trace-row contract. It
// retains one bounded snapshot; consumers must discard rows for bounded memory.
// No host ports, executor, clock, persistence or write authority are supplied.
export function* iterateAgenticProcessSimulation(input) {
  if (checkShadowJson(input) || !exactKeys(input, ["instanceId", "model", "policyPins", "scopeId", "events"], ["facts", "parameters"])
    || !Array.isArray(input.events) || input.events.length > 512) fail("PROCESS_SIMULATION_INPUT_INVALID");
  const scenario = freezeShadow(structuredClone(input));
  const { events, ...initial } = scenario;
  let instance = createAgenticProcess(initial);
  const synthetic = { contract_version: "agentic-process-simulation.v1", evidence_kind: "synthetic",
    write_authorization: false, model_sha256: instance.model_sha256, scenario_sha256: shadowHash(scenario) };
  const snapshot = (step, eventId, cursor = inspectAgenticProcess(instance)) => {
    const row = { step, event_id: eventId, instance_sha256: instance.instance_sha256, cursor };
    if (Buffer.byteLength(JSON.stringify(row), "utf8") > TRACE_BYTES) fail("PROCESS_SIMULATION_TRACE_LIMIT");
    if (validateJsonSchema({ ...synthetic, trace: [row] }, schema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_SIMULATION_INVALID");
    return freezeShadow(row);
  };
  yield snapshot(0, null);
  for (const [index, event] of events.entries()) {
    const advanced = advanceAndInspectAgenticProcess(instance, event);
    instance = advanced.instance;
    // Consume the final validated cursor on our owned immutable scenario before
    // yielding; the next event always performs its own complete validations.
    yield snapshot(index + 1, event.event_id, advanced.cursor);
  }
}

// The aggregate v1 API keeps its original 4 MiB total limit and JSON shape.
// Streaming rows and aggregate traces use exactly the execution reducer.
export function simulateAgenticProcess(input) {
  const trace = []; let traceBytes = 0;
  for (const row of iterateAgenticProcessSimulation(input)) {
    traceBytes += Buffer.byteLength(JSON.stringify(row), "utf8");
    if (traceBytes > TRACE_BYTES) fail("PROCESS_SIMULATION_TRACE_LIMIT");
    trace.push(row);
  }
  const simulation = { contract_version: "agentic-process-simulation.v1", evidence_kind: "synthetic",
    write_authorization: false, model_sha256: shadowHash(input.model), scenario_sha256: shadowHash(input), trace };
  if (validateJsonSchema(simulation, schema, "$", { contractKind: "workflow-definition" }).length) fail("PROCESS_SIMULATION_INVALID");
  return freezeShadow(simulation);
}
