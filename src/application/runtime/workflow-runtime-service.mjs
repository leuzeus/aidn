import path from "node:path";

export function runWorkflowRuntimeScript({
  processAdapter,
  runtimeDir,
  scriptName,
  args = [],
}) {
  return processAdapter.runNodeScript(path.join(runtimeDir, scriptName), args);
}

export function runWorkflowRuntimeJsonScript({
  processAdapter,
  runtimeDir,
  scriptName,
  args = [],
}) {
  return processAdapter.runJsonNodeScript(path.join(runtimeDir, scriptName), args);
}

export function runWorkflowCheckpoint({
  processAdapter,
  runtimeDir,
  targetRoot,
  mode,
  runId,
  indexOptions = {},
}) {
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

  return runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "checkpoint.mjs",
    args: cmd,
  });
}

export function runWorkflowReloadCheck({
  processAdapter,
  runtimeDir,
  targetRoot,
  cachePath,
  stateMode,
  indexFile,
  indexBackend,
  writeCache = false,
}) {
  const args = [
    "--target",
    targetRoot,
    "--cache",
    cachePath,
    "--state-mode",
    stateMode,
  ];
  if (writeCache) {
    args.push("--write-cache");
  }
  if (indexFile) {
    args.push("--index-file", indexFile);
  }
  if (indexBackend) {
    args.push("--index-backend", indexBackend);
  }
  args.push("--json");
  return runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "reload-check.mjs",
    args,
  });
}

export function runWorkflowIndexSync({
  processAdapter,
  runtimeDir,
  targetRoot,
  store,
  output,
  sqlOutput,
  sqliteOutput,
  schemaFile,
  includeSchema = true,
  kpiFile,
}) {
  const args = [
    "--target",
    targetRoot,
    "--store",
    store,
    "--output",
    output,
  ];
  if (sqlOutput) {
    args.push("--sql-output", sqlOutput);
  }
  if (sqliteOutput) {
    args.push("--sqlite-output", sqliteOutput);
  }
  if (schemaFile) {
    args.push("--schema-file", schemaFile);
    if (includeSchema === false) {
      args.push("--no-schema");
    }
  }
  if (kpiFile) {
    args.push("--kpi-file", kpiFile);
  }
  args.push("--json");
  return runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "index-sync.mjs",
    args,
  });
}

export function runWorkflowIndexSyncCheck({
  processAdapter,
  runtimeDir,
  targetRoot,
  indexFile,
  indexBackend,
}) {
  return runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "index-sync-check.mjs",
    args: [
      "--target",
      targetRoot,
      "--index-file",
      indexFile,
      "--index-backend",
      indexBackend,
      "--json",
    ],
  });
}

export function runWorkflowConstraintLoop({
  processAdapter,
  runtimeDir,
  targetRoot,
  options = {},
}) {
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

  return runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "constraint-loop.mjs",
    args: cmd,
  });
}
