const REQUIRED_METHODS = [
  "runCommand",
];

export function assertAgentAdapter(candidate, label = "AgentAdapter") {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`${label} must be an object`);
  }
  for (const methodName of REQUIRED_METHODS) {
    if (typeof candidate[methodName] !== "function") {
      throw new Error(`${label} is missing required method: ${methodName}()`);
    }
  }
  return candidate;
}
