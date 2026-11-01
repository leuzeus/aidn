// Engine selection applies to every new workflow, independently of its authoring
// format. Persisted contracts select their own historical reader.
export const DEFAULT_WORKFLOW_ENGINE = "agentic";
export const WORKFLOW_ENGINES = Object.freeze(["agentic", "legacy"]);
export function resolveWorkflowEngine({ engine, config } = {}) {
  const selected = engine ?? config?.runtime?.workflowEngine ?? DEFAULT_WORKFLOW_ENGINE;
  if (!WORKFLOW_ENGINES.includes(selected)) throw Object.assign(new Error("WORKFLOW_ENGINE_INVALID"), { code: "WORKFLOW_ENGINE_INVALID" });
  return selected;
}
