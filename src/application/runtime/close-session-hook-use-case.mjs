import path from 'node:path';
import { runCloseSessionAdmitUseCase } from './close-session-admit-use-case.mjs';
import { runCheckpointUseCase } from './checkpoint-use-case.mjs';
import { runWorkflowHookUseCase } from './workflow-hook-use-case.mjs';

export function defaultSessionCloseHookArguments(runtimeDir, stateMode) {
  return { target: '.', mode: 'COMMITTING', strict: true, noAutoSkipGate: true, json: true,
    eventFile: '.aidn/runtime/perf/workflow-events.ndjson', runIdFile: '.aidn/runtime/perf/current-run-id.txt',
    cache: '.aidn/runtime/cache/reload-state.json', emitSummaryEvent: true, skipIndexOnIncremental: true,
    skipGateEvaluate: false, autoSkipGateOnNoSignal: false, indexStore: '', indexStoreExplicit: false, stateMode,
    indexOutput: '.aidn/runtime/index/workflow-index.json', indexSqlOutput: '.aidn/runtime/index/workflow-index.sql',
    indexSqliteOutput: '.aidn/runtime/index/workflow-index.sqlite', indexSchemaFile: path.join(runtimeDir, 'sql/schema.sql'),
    indexIncludeSchema: true, indexKpiFile: '', indexSyncCheck: true, indexSyncCheckStrict: true,
    indexSyncCheckOut: '.aidn/runtime/index/index-sync-check.json', constraintLoopMode: 'auto', constraintLoopStrict: false };
}

// Called by the fixed host with a trusted completion reader. The public CLI
// has no flag for an alignment opinion or a claimed successful checkpoint.
export async function runCloseSessionHookUseCase({ args, runtimeDir, targetRoot, readObjectiveCompletion = null, assertEffectAuthorized = null }) {
  const admission = await runCloseSessionAdmitUseCase({ targetRoot, mode: args.mode });
  const completionCycleId = admission.ok === true && ['DONE', 'NO_GO', 'DROPPED'].includes(admission.mapped_cycle?.state)
    && admission.mapped_cycle?.session_owner === admission.mapped_session?.session_id ? admission.mapped_cycle.cycle_id : null;
  const completedCheckpoint = admission.ok === true && completionCycleId
    ? await runCheckpointUseCase({ args: { ...args, autoSkipGateOnNoSignal: !args.noAutoSkipGate }, runtimeDir, targetRoot,
      completionCycleId, readObjectiveCompletion, assertEffectAuthorized }) : null;
  if (completedCheckpoint && (completedCheckpoint.ok !== true || completedCheckpoint.gate?.result !== 'ok' || completedCheckpoint.summary?.result !== 'ok'))
    throw Object.assign(Error('STANDARD_SESSION_CLOSE_CHECKPOINT_GATE_REQUIRED'), { code: 'STANDARD_SESSION_CLOSE_CHECKPOINT_GATE_REQUIRED' });
  if (assertEffectAuthorized !== null) await assertEffectAuthorized();
  const workflowHook = admission.action === 'close_session_allowed'
    ? runWorkflowHookUseCase({ args: { ...args, phase: 'session-close', target: targetRoot,
      autoSkipGateOnNoSignal: !args.noAutoSkipGate }, runtimeDir, targetRoot, completedCheckpoint }) : null;
  return { ts: new Date().toISOString(), ok: admission.ok === true && (workflowHook ? workflowHook.ok === true : true),
    phase: 'session-close', skill: 'close-session', target_root: targetRoot, mode: args.mode,
    state_mode: workflowHook?.state_mode ?? admission.state_mode, strict: workflowHook?.strict ?? args.strict,
    action: admission.action, result: workflowHook?.result ?? admission.result, reason_code: workflowHook?.reason_code ?? admission.reason_code,
    branch: admission.branch, branch_kind: admission.branch_kind, admission, checkpoint: workflowHook?.checkpoint ?? null,
    checkpoint_error: workflowHook?.checkpoint_error ?? null, constraint_loop_required: workflowHook?.constraint_loop_required ?? false,
    constraint_loop_strict: workflowHook?.constraint_loop_strict ?? false, constraint_loop: workflowHook?.constraint_loop ?? null,
    constraint_loop_error: workflowHook?.constraint_loop_error ?? null, workflow_hook: workflowHook };
}
