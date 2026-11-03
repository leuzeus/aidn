// A trusted application supplies the fixed metadata scope. Port discovery is pure.
export function assertWorkflowGitCheckpointPort(port) {
  if (!port || ["inspect", "commit", "inspectCommit"].some(name => typeof port[name] !== "function"))
    throw new TypeError("WorkflowGitCheckpoint requires inspect, commit and inspectCommit");
  return port;
}
