import { checkShadowJson } from "./shadow-json.mjs";
import { exactKeys, processId, processFail as fail } from "./agentic-process-model.mjs";
import schema from "../contracts/workflow-definition/agentic-process-control-scenario.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";

// Explicit trusted-host test inputs. These are never assignments, verdicts,
// timers or executable adapters selected by a model.
export function assertAgenticControlScenario(scenario) {
  const facts = value => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length <= 128 && Object.entries(value).every(([key, value]) => processId(key) && typeof value === "boolean");
  if (checkShadowJson(scenario) || validateJsonSchema(scenario, schema, "$", { contractKind: "workflow-definition" }).length || !exactKeys(scenario, ["contract_version", "initial_facts", "events"])
    || scenario.contract_version !== "agentic-process-control-scenario.v1" || !facts(scenario.initial_facts)
    || !Array.isArray(scenario.events) || scenario.events.length > 64) fail("PROCESS_CONTROL_SCENARIO_INVALID");
  const ids = new Set(); let previous = 0;
  for (const step of scenario.events) {
    if (!exactKeys(step, ["after_results", "event"]) || !Number.isSafeInteger(step.after_results)
      || step.after_results < previous || step.after_results > 120) fail("PROCESS_CONTROL_SCENARIO_INVALID");
    previous = step.after_results;
    const event = step.event;
    if (!event || !processId(event.event_id) || ids.has(event.event_id)) fail("PROCESS_CONTROL_SCENARIO_INVALID");
    ids.add(event.event_id);
    const base = ["event_id", "kind"];
    if (event.kind === "facts") {
      if (!exactKeys(event, [...base, "facts"]) || !facts(event.facts)) fail("PROCESS_CONTROL_SCENARIO_INVALID");
    } else if (event.kind === "message") {
      if (!exactKeys(event, [...base, "occurrence_id", "correlation_id", "event_key"]) || !processId(event.event_key)
        || !["occurrence_id", "correlation_id"].every(key => typeof event[key] === "string" && event[key].length >= 1 && event[key].length <= 512)) fail("PROCESS_CONTROL_SCENARIO_INVALID");
    } else if (event.kind !== "cancel" || !exactKeys(event, base)) fail("PROCESS_CONTROL_SCENARIO_INVALID");
  }
  return scenario;
}
