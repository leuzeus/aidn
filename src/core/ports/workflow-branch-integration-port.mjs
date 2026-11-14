// Port discovery is pure. Only the trusted application derives source/target
// branches and supplies an explicit write grant for a frozen integration plan.
export function assertWorkflowBranchIntegrationPort(port) {
  if (!port || ["inspect", "integrate", "inspectIntegration"].some(name => typeof port[name] !== "function"))
    throw new TypeError("WorkflowBranchIntegration requires inspect, integrate and inspectIntegration");
  return port;
}
