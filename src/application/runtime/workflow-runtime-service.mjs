import path from "node:path";

export function runWorkflowCheckpoint({
  processAdapter,
  runtimeDir,
  targetRoot,
  mode,
  runId,
  indexOptions = {},
}) {
  const checkpointScript = path.join(runtimeDir, "checkpoint.mjs");
  const cmd = [
    "--target",
    targetRoot,
    "--mode",
    mode,
  ];
  if (runId) {
    cmd.push("--run-id", runId);
  }
  if (indexOptions.store) {
    cmd.push("--index-store", indexOptions.store);
  }
  if (indexOptions.output) {
    cmd.push("--index-output", indexOptions.output);
  }
  if (indexOptions.sqlOutput) {
    cmd.push("--index-sql-output", indexOptions.sqlOutput);
  }
  if (indexOptions.sqliteOutput) {
    cmd.push("--index-sqlite-output", indexOptions.sqliteOutput);
  }
  if (indexOptions.schemaFile) {
    cmd.push("--index-schema-file", indexOptions.schemaFile);
  }
  if (indexOptions.includeSchema === false) {
    cmd.push("--index-no-schema");
  }
  if (indexOptions.kpiFile) {
    cmd.push("--index-kpi-file", indexOptions.kpiFile);
  }
  if (indexOptions.syncCheck === true) {
    cmd.push("--index-sync-check");
  }
  if (indexOptions.syncCheckStrict === true) {
    cmd.push("--index-sync-check-strict");
  }
  if (indexOptions.syncCheckOut) {
    cmd.push("--index-sync-check-out", indexOptions.syncCheckOut);
  }
  if (indexOptions.skipGateEvaluate === true) {
    cmd.push("--skip-gate-evaluate");
  }
  cmd.push("--json");

  return processAdapter.runJsonNodeScript(checkpointScript, cmd);
}

export function runWorkflowConstraintLoop({
  processAdapter,
  runtimeDir,
  targetRoot,
  options = {},
}) {
  const loopScript = path.join(runtimeDir, "constraint-loop.mjs");
  const cmd = [
    "--target",
    targetRoot,
  ];
  if (options.eventFile) {
    cmd.push("--event-file", options.eventFile);
  }
  if (options.strict === true) {
    cmd.push("--strict");
  }
  cmd.push("--json");

  return processAdapter.runJsonNodeScript(loopScript, cmd);
}
