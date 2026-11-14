// This private port changes physical Git/product state only. Canonical adoption,
// phase admission and the current effect grant belong to its application host.
export function assertWorkflowCycleActivationPort(port) {
  if (!port || ["inspect", "activate", "inspectActivation"].some(name => typeof port[name] !== "function"))
    throw new TypeError("WorkflowCycleActivation requires inspect, activate and inspectActivation");
  return port;
}
