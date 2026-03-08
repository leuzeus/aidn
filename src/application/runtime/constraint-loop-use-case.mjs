import { writeJsonIfChanged } from "../../lib/index/io-lib.mjs";
import {
  runWorkflowRuntimeJsonScript,
  runWorkflowRuntimeScript,
} from "./workflow-runtime-service.mjs";
import { resolveRuntimeTargetPath } from "./runtime-path-service.mjs";

export function runConstraintLoopUseCase({
  args,
  targetRoot,
  runtimeDir,
  processAdapter,
}) {
  const started = Date.now();
  const eventFile = resolveRuntimeTargetPath(targetRoot, args.eventFile);
  const reportFile = resolveRuntimeTargetPath(targetRoot, args.reportFile);
  const thresholdsFile = resolveRuntimeTargetPath(targetRoot, args.thresholdsFile);
  const actionsFile = resolveRuntimeTargetPath(targetRoot, args.actionsFile);
  const historyFile = resolveRuntimeTargetPath(targetRoot, args.historyFile);
  const trendFile = resolveRuntimeTargetPath(targetRoot, args.trendFile);
  const trendThresholdsFile = resolveRuntimeTargetPath(targetRoot, args.trendThresholdsFile);
  const trendSummaryFile = resolveRuntimeTargetPath(targetRoot, args.trendSummaryFile);
  const lotPlanFile = resolveRuntimeTargetPath(targetRoot, args.lotPlanFile);
  const lotAdvanceFile = resolveRuntimeTargetPath(targetRoot, args.lotAdvanceFile);
  const lotSummaryFile = resolveRuntimeTargetPath(targetRoot, args.lotSummaryFile);
  const summaryFile = resolveRuntimeTargetPath(targetRoot, args.summaryFile);

  const report = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "report-constraints.mjs",
    args: [
      "--file",
      eventFile,
      "--run-prefix",
      args.runPrefix,
      "--out",
      reportFile,
      "--json",
    ],
  });
  const thresholds = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "check-thresholds-defaults.mjs",
    args: [
      "--preset",
      "constraint",
      "--target",
      targetRoot,
      "--kpi-file",
      reportFile,
      "--out",
      thresholdsFile,
      ...(args.strict ? ["--strict"] : []),
      "--json",
    ],
  });
  const actions = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "report-constraint-actions.mjs",
    args: [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--out",
      actionsFile,
      "--json",
    ],
  });
  runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "sync-constraint-history.mjs",
    args: [
      "--report-file",
      reportFile,
      "--actions-file",
      actionsFile,
      "--history-file",
      historyFile,
      "--max-runs",
      String(args.maxRuns),
      "--json",
    ],
  });
  const trend = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "report-constraint-trend.mjs",
    args: [
      "--history-file",
      historyFile,
      "--out",
      trendFile,
      "--json",
    ],
  });
  const trendThresholds = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "check-thresholds-defaults.mjs",
    args: [
      "--preset",
      "constraint-trend",
      "--target",
      targetRoot,
      "--kpi-file",
      trendFile,
      "--out",
      trendThresholdsFile,
      ...(args.strict ? ["--strict"] : []),
      "--json",
    ],
  });
  const lotPlan = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "report-constraint-lot-plan.mjs",
    args: [
      "--actions-file",
      actionsFile,
      "--trend-file",
      trendFile,
      "--out",
      lotPlanFile,
      "--max-lot-size",
      String(args.maxLotSize),
      "--lot-prefix",
      args.lotPrefix,
      "--json",
    ],
  });
  const lotAdvance = runWorkflowRuntimeJsonScript({
    processAdapter,
    runtimeDir,
    scriptName: "advance-constraint-lot-plan.mjs",
    args: [
      "--plan-file",
      lotPlanFile,
      "--json",
    ],
  });
  const lotAdvanceWrite = writeJsonIfChanged(lotAdvanceFile, lotAdvance);

  runWorkflowRuntimeScript({
    processAdapter,
    runtimeDir,
    scriptName: "render-constraint-trend-summary.mjs",
    args: [
      "--report-file",
      trendFile,
      "--thresholds-file",
      trendThresholdsFile,
      "--out",
      trendSummaryFile,
    ],
  });
  runWorkflowRuntimeScript({
    processAdapter,
    runtimeDir,
    scriptName: "render-constraint-lot-plan-summary.mjs",
    args: [
      "--plan-file",
      lotPlanFile,
      "--advance-file",
      lotAdvanceFile,
      "--out",
      lotSummaryFile,
    ],
  });
  runWorkflowRuntimeScript({
    processAdapter,
    runtimeDir,
    scriptName: "render-constraint-summary.mjs",
    args: [
      "--report-file",
      reportFile,
      "--thresholds-file",
      thresholdsFile,
      "--actions-file",
      actionsFile,
      "--out",
      summaryFile,
    ],
  });

  return {
    ts: new Date().toISOString(),
    target_root: targetRoot,
    strict: args.strict,
    event_file: eventFile,
    run_prefix: args.runPrefix,
    artifacts: {
      report_file: reportFile,
      thresholds_file: thresholdsFile,
      actions_file: actionsFile,
      history_file: historyFile,
      trend_file: trendFile,
      trend_thresholds_file: trendThresholdsFile,
      trend_summary_file: trendSummaryFile,
      lot_plan_file: lotPlanFile,
      lot_advance_file: lotAdvanceWrite.path,
      lot_advance_written: lotAdvanceWrite.written,
      lot_summary_file: lotSummaryFile,
      summary_file: summaryFile,
    },
    summary: {
      constraint_status: thresholds?.summary?.overall_status ?? null,
      trend_status: trendThresholds?.summary?.overall_status ?? null,
      active_constraint_skill: report?.summary?.active_constraint?.skill ?? null,
      actions_generated: actions?.summary?.generated_actions ?? null,
      lots_total: lotPlan?.summary?.lots_total ?? null,
      next_lot_id: lotPlan?.summary?.next_lot_id ?? null,
    },
    duration_ms: Date.now() - started,
  };
}
