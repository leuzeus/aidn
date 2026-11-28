import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../adapters/runtime/local-workflow-git-checkpoint.mjs';
import { createLocalGitAdapter } from '../../adapters/runtime/local-git-adapter.mjs';
import { createLocalProcessAdapter } from '../../adapters/runtime/local-process-adapter.mjs';
import { createCodexAgentAdapter } from '../../adapters/codex/codex-agent-adapter.mjs';
import { createHookContextStoreAdapter } from '../../adapters/codex/hook-context-store-adapter.mjs';
import { runJsonHookUseCase } from '../codex/run-json-hook-use-case.mjs';
import { runHydrateContextUseCase } from '../codex/hydrate-context-use-case.mjs';
import { runSyncDbFirstSelectiveUseCase } from './sync-db-first-selective-use-case.mjs';
import { projectRuntimeState } from '../../../tools/runtime/project-runtime-state.mjs';
import { admitHandoff } from '../../../tools/runtime/handoff-admit.mjs';
import { buildRuntimeStateMarkdown } from './runtime-state-projector-use-case.mjs';
import { preWriteAdmit } from '../../../tools/runtime/pre-write-admit.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { parseStructuredMarkdownMap } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { parseSessionMetadata } from '../../lib/workflow/session-context-lib.mjs';
import { assertModeWorkDecisionOutput } from '../../core/workflow/standard-mode-work-continuation.mjs';
import { assertHandoffOperationOutput } from '../../core/workflow/standard-handoff-operation.mjs';
import { assertHandoffResourceOperationOutput } from '../../core/workflow/standard-handoff-resource-operation.mjs';
import { assertHandoffPreparationInput, assertHandoffPreparationPlan, assertHandoffPreparation,
  assertHandoffPreparationOutput, handoffPreparationPaths } from '../../core/workflow/standard-handoff-preparation.mjs';
import { artifactContentHash as hashText } from '../../core/workflow/artifact-compare-swap.mjs';
import { shadowHash as H, freezeShadow } from '../../core/workflow/shadow-json.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
const payloadHash = value => hashText(JSON.stringify(value));
const blocked = reason_code => ({ can_apply: false, reason_code });
const contracts = { handoff_summary_prepare: 'standard-handoff-summary-output.v1', handoff_prepare: 'standard-handoff-prepare-output.v1', handoff_admit: 'standard-handoff-admission-output.v1' };
const facts = { handoff_summary_prepare: 'handoff_summary_prepared', handoff_prepare: 'handoff_preparation_completed', handoff_admit: 'handoff_packet_admitted' };
const emit = (operation, outcome, effect_status, observations, evidence_refs = []) => freezeShadow(assertHandoffPreparationOutput({
  contract_version: contracts[operation], operation_ref: operation, outcome, effect_status, observations,
  facts: outcome === 'completed' ? { [facts[operation]]: true } : {}, evidence_refs }));
function scalar(text, key, value) {
  const expression = new RegExp('^' + key + ':[^\\r\\n]*', 'gm');
  if ((text.match(expression) ?? []).length !== 1) fail('STANDARD_HANDOFF_CURRENT_FIELD_INVALID');
  return text.replace(expression, key + ': ' + value);
}
function summarize(text, input, at) {
  text = scalar(text, 'updated_at', new Date(at).toISOString());
  const expression = /(^## Next Actions[^\r\n]*\r?\n)([\s\S]*?)(?=^## |$(?![\s\S]))/m;
  if (!expression.test(text)) fail('STANDARD_HANDOFF_CURRENT_SECTION_INVALID');
  const goal = input.next_agent_goal.replace(/\s+/gu, ' ').trim();
  return text.replace(expression, (_all, header, body) => header + '\n- Relay intent: ' + input.next_agent_role + '/' + input.next_agent_action
    + ' — ' + goal + ' (details: docs/audit/HANDOFF-PACKET.md).\n'
    + body.split(/\r?\n/).filter(line => !line.startsWith('- Relay intent: ')).join('\n').replace(/^\n+/, '') + '\n');
}
// Fixed package capabilities. JSON inputs select accepted operation identities;
// they supply neither an executor nor an import/repair permission.
export function createStandardHandoffPreparation({ targetRoot, readAccepted, readCurrent, readDecisionContext, observeScope, now = Date.now }) {
  if ([readAccepted, readCurrent, readDecisionContext, observeScope].some(value => typeof value !== 'function')) fail('STANDARD_HANDOFF_PREPARATION_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const git = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: 'session-metadata-snapshot' });
  const physical = relative => agentRunPhysicalPath(path.join(root, relative), { missing: true });
  const active = signal => { if (signal?.aborted) fail('STANDARD_HANDOFF_PREPARATION_ABORTED'); };
  const rows = id => artifacts.readMany(handoffPreparationPaths(id), { required: handoffPreparationPaths(id), includeMetadata: true });
  const pins = rows => rows.map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
  function projected(documents) {
    if (artifacts.describe().state_mode === 'db-only') return;
    for (const row of documents) if (readAgentRunFile(physical('docs/audit/' + row.path), { json: false, maxBytes: 1048576 }).sha256 !== row.sha256)
      fail('STANDARD_HANDOFF_PREPARATION_PROJECTION_CHANGED');
  }
  function identity(documents, id) {
    const current = parseStructuredMarkdownMap(documents[0].content), session = parseSessionMetadata(documents[2].content);
    if (current.active_session !== id || current.active_cycle !== 'none' || !['THINKING', 'EXPLORING'].includes(current.mode)
      || session.mode !== current.mode || session.session_branch !== current.session_branch) fail('STANDARD_HANDOFF_PREPARATION_SESSION_CHANGED');
    return current;
  }
  function decision(instance, input) {
    const accepted = readAccepted(instance, input.decision_operation_id, 'mode_work_continue_decision'), output = assertModeWorkDecisionOutput(accepted.output);
    const prepared = accepted.record.preview.prepared;
    if (output.contract_version !== 'standard-mode-work-decision-output.v2' || output.outcome !== 'completed'
      || output.facts.mode_work_handoff_requested !== true || output.observations.choice !== 'handoff'
      || prepared.current_context.session_id !== input.session_id || prepared.review.session_id !== input.session_id)
      fail('STANDARD_HANDOFF_EXPLICIT_DECISION_REQUIRED');
    return { operation_id: accepted.record.operation_id, output };
  }
  async function prepareSummary(instance, input, operationId, at, acquired = false) {
    assertHandoffPreparationInput('handoff_summary_prepare', input); active();
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('STANDARD_HANDOFF_PREPARATION_OPERATION_REQUIRED');
    if (!acquired && artifacts.ownerPending()) return blocked('STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED');
    const source = decision(instance, input), decisionContext = await readDecisionContext(instance, input.decision_operation_id);
    if (H(decisionContext) !== source.output.observations.current_context_sha256) fail("STANDARD_HANDOFF_DECISION_CONTEXT_CHANGED");
    const documents = rows(input.session_id), state = identity(documents, input.session_id), scope = observeScope(), view = git.inspect();
    if (!['none', '(none)', ''].includes(String(state.active_backlog ?? 'none').toLowerCase())) return blocked('STANDARD_HANDOFF_SHARED_PLANNING_REFRESH_REQUIRED');
    if (state.session_branch !== view.branch || scope.branch !== view.branch || scope.head !== view.head) fail('STANDARD_HANDOFF_PREPARATION_SCOPE_CHANGED');
    if (!view.index_clean || view.lock_present || view.changes.some(row => !documents.some(doc => 'docs/audit/' + doc.path === row.path)))
      return blocked('STANDARD_HANDOFF_PREPARATION_FOREIGN_CHANGES');
    projected(documents);
    const admission = await preWriteAdmit({ targetRoot: root, skill: 'handoff-close' });
    if (admission.ok !== true || !['admitted', 'admitted_with_warnings'].includes(admission.admission_status)) return blocked('STANDARD_HANDOFF_PREPARATION_NOT_ADMITTED');
    const after = summarize(documents[0].content, source.output.observations.handoff, at);
    if (H(await readDecisionContext(instance, input.decision_operation_id)) !== source.output.observations.current_context_sha256
      || H(pins(rows(input.session_id))) !== H(pins(documents)) || H(observeScope()) !== H(scope)) fail('STANDARD_HANDOFF_PREPARATION_CONTEXT_CHANGED');
    const plan = assertHandoffPreparationPlan({ contract_version: 'standard-handoff-summary-plan.v1', operation_ref: 'handoff_summary_prepare', input,
      operation_id: operationId, prepared_at_ms: at, source_sha256: H(source), scope_sha256: H(scope), branch: view.branch, head: view.head,
      mode: state.mode, state_mode: artifacts.describe().state_mode, documents: pins(documents), after_chunks: after.match(/[\s\S]{1,8192}/g), after_sha256: hashText(after) });
    return assertHandoffPreparation({ can_apply: true, plan, plan_sha256: H(plan) });
  }
  function checkpointSource(instance, input) {
    const summary = readAccepted(instance, input.summary_operation_id, 'handoff_summary_prepare'); assertHandoffPreparationOutput(summary.output);
    if (summary.output.facts.handoff_summary_prepared !== true || summary.output.effect_status !== 'confirmed') fail('STANDARD_HANDOFF_SUMMARY_REQUIRED');
    const plan = assertHandoffPreparationPlan(summary.record.preview.prepared.plan), checkpoint = readAccepted(instance, input.git_operation_id, 'handoff_git_checkpoint');
    if (checkpoint.record.preview.input.summary_operation_id !== input.summary_operation_id || checkpoint.output.outcome !== 'completed'
      || checkpoint.output.facts.handoff_git_checkpoint_completed !== true || !['confirmed', 'no_effect'].includes(checkpoint.output.effect_status)) fail('STANDARD_HANDOFF_GIT_CHECKPOINT_REQUIRED');
    const id = plan.input.session_id, documents = rows(id), state = identity(documents, id), view = git.inspect(), scope = observeScope();
    if (H(pins(documents)) !== H(summary.output.observations.documents) || state.mode !== plan.mode) fail('STANDARD_HANDOFF_SUMMARY_CHANGED');
    const expectedHead = checkpoint.output.observations.git.commit_sha ?? checkpoint.output.observations.git.head;
    if (view.head !== expectedHead || view.branch !== plan.branch || !view.index_clean || view.lock_present || view.changes.length) fail('STANDARD_HANDOFF_GIT_CHECKPOINT_CHANGED');
    projected(documents);
    return { id, documents, state, scope, view, material: { summary_operation_id: summary.record.operation_id, summary_output: summary.output,
      git_operation_id: checkpoint.record.operation_id, git_output: checkpoint.output } };
  }
  const diagnostic = id => '.aidn/runtime/context/handoff/' + id;
  async function prepareCheckpoint(instance, input, operationId, at, acquired = false) {
    assertHandoffPreparationInput('handoff_prepare', input);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? '')) fail('STANDARD_HANDOFF_PREPARATION_OPERATION_REQUIRED');
    if (!acquired && artifacts.ownerPending()) return blocked('STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED');
    if (fs.existsSync(physical(diagnostic(operationId)))) return blocked('STANDARD_HANDOFF_DIAGNOSTIC_RECONCILIATION_REQUIRED');
    const source = checkpointSource(instance, input), admission = await preWriteAdmit({ targetRoot: root, skill: 'handoff-close' });
    if (!admission.ok) return blocked('STANDARD_HANDOFF_PREPARATION_NOT_ADMITTED');
    if (H(checkpointSource(instance, input).material) !== H(source.material) || H(observeScope()) !== H(source.scope)) fail('STANDARD_HANDOFF_PREPARATION_CONTEXT_CHANGED');
    const plan = assertHandoffPreparationPlan({ contract_version: 'standard-handoff-prepare-plan.v1', operation_ref: 'handoff_prepare', input,
      operation_id: operationId, prepared_at_ms: at, source_sha256: H(source.material), scope_sha256: H(source.scope), session_id: source.id,
      branch: source.view.branch, head: source.view.head, mode: source.state.mode, state_mode: artifacts.describe().state_mode, documents: pins(source.documents) });
    return assertHandoffPreparation({ can_apply: true, plan, plan_sha256: H(plan) });
  }
  function explicit(prepared, operation, write, expectPlan) {
    assertHandoffPreparation(prepared);
    if (prepared.can_apply === false) return false;
    if (write !== true || prepared.plan.operation_ref !== operation || prepared.plan_sha256 !== expectPlan) fail('STANDARD_HANDOFF_PREPARATION_EXPLICIT_EFFECT_REQUIRED');
    return true;
  }
  function current(instance, plan) {
    if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || H(observeScope()) !== plan.scope_sha256
      || H(pins(rows(plan.session_id ?? plan.input.session_id))) !== H(plan.documents)) fail('STANDARD_HANDOFF_PREPARATION_CONTEXT_CHANGED');
    artifacts.assertLocalEffectOwner(H(plan));
  }
  return Object.freeze({
    prepareSummary: (instance, input, id) => prepareSummary(instance, input, id, now()),
    prepareCheckpoint: (instance, input, id) => prepareCheckpoint(instance, input, id, now()),
    async applySummary(instance, prepared, { write = false, expectPlan, assertAuthorized, assertCurrent, signal } = {}) {
      const operation = 'handoff_summary_prepare';
      if (!explicit(prepared, operation, write, expectPlan)) return emit(operation, 'blocked', 'no_effect', { reason_code: prepared.reason_code });
      if ([assertAuthorized, assertCurrent].some(v => typeof v !== 'function')) fail('STANDARD_HANDOFF_PREPARATION_CAPABILITY_REQUIRED');
      const plan = prepared.plan;
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try { active(signal); await assertAuthorized(); const fresh = await prepareSummary(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail('STANDARD_HANDOFF_PREPARATION_PLAN_CHANGED');
          await assertAuthorized(); active(signal); assertCurrent(); current(instance, plan);
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        try {
          active(signal); assertCurrent(); current(instance, plan);
          const changed = artifacts.compareAndSwapPreservingMetadata({ path: 'CURRENT-STATE.md', before_sha256: plan.documents[0].sha256,
            before_metadata_sha256: plan.documents[0].metadata_sha256, after: plan.after_chunks.join("") });
          artifacts.project(['CURRENT-STATE.md']);
          const observed = rows(plan.input.session_id); projected(observed);
          if (observed[0].sha256 !== plan.after_sha256 || observed[0].metadata_sha256 !== changed.metadata_sha256
            || H(pins(observed).slice(1)) !== H(plan.documents.slice(1))) fail('STANDARD_HANDOFF_SUMMARY_POSTCONDITION_FAILED');
          await assertAuthorized(); active(signal); assertCurrent();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || H(observeScope()) !== plan.scope_sha256
            || H(pins(rows(plan.input.session_id))) !== H(pins(observed))) fail('STANDARD_HANDOFF_PREPARATION_PROCESS_CHANGED');
          return emit(operation, 'completed', 'confirmed', { decision_operation_id: plan.input.decision_operation_id, session_id: plan.input.session_id,
            mode: plan.mode, documents: pins(observed) }, observed.map(row => ({ ref: 'docs/audit/' + row.path, sha256: row.sha256 })));
        } catch (cause) { return emit(operation, 'reconciliation_required', 'unknown', { reason_code: cause.code ?? 'STANDARD_HANDOFF_SUMMARY_UNCONFIRMED' }); }
      });
    },
    async applyCheckpoint(instance, prepared, { write = false, expectPlan, assertAuthorized, assertCurrent, signal } = {}) {
      const operation = 'handoff_prepare';
      if (!explicit(prepared, operation, write, expectPlan)) return emit(operation, 'blocked', 'no_effect', { reason_code: prepared.reason_code });
      if ([assertAuthorized, assertCurrent].some(v => typeof v !== 'function')) fail('STANDARD_HANDOFF_PREPARATION_CAPABILITY_REQUIRED');
      const plan = prepared.plan, id = plan.operation_id, base = diagnostic(id), contextFile = base + '/codex-context.json', hydratedFile = base + '/hydrated-context.json';
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try { active(signal); await assertAuthorized(); const fresh = await prepareCheckpoint(instance, plan.input, id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail('STANDARD_HANDOFF_PREPARATION_PLAN_CHANGED');
          await assertAuthorized(); active(signal); assertCurrent(); current(instance, plan);
        } catch (cause) { cause.effect_status = 'no_effect'; throw cause; }
        const observed = { summary_operation_id: plan.input.summary_operation_id, git_operation_id: plan.input.git_operation_id,
          session_id: plan.session_id, completed_stages: [], skipped_stages: [] };
        const evidence = [];
        const guard = async () => { await assertAuthorized(); active(signal); assertCurrent(); current(instance, plan); projected(rows(plan.session_id)); };
        try {
          {
            const hookContextStore = createHookContextStoreAdapter();
            const hook = await runJsonHookUseCase({ targetRoot: root, hookContextStore, agentAdapter: createCodexAgentAdapter(),
              args: { skill: 'handoff-close', mode: plan.mode, target: root, stateMode: plan.state_mode, strict: true, noAutoSkipGate: true,
                failOnRepairBlock: true, failOnError: true, forceJson: true, contextFile, rawDir: base + '/raw', maxEntries: 50,
                verbose: false, includeRaw: true, view: 'full', write: false, dbSync: false, dbSyncExplicit: true,
                command: [process.execPath, fileURLToPath(new URL('../../../tools/perf/handoff-close-hook.mjs', import.meta.url)),
                  '--target', root, '--mode', plan.mode, '--run-id', 'handoff_' + id.slice(3), '--no-auto-skip-gate', '--json'] } });
            observed.hook_sha256 = payloadHash(hook); observed.completed_stages.push('hook'); await guard();
            const actualCheckpoint = hook.normalized?.raw?.checkpoint;
            if (actualCheckpoint?.ok !== true || actualCheckpoint.run_id !== 'handoff_' + id.slice(3) || actualCheckpoint.gate?.skipped !== false || actualCheckpoint.gate.result !== 'ok'
              || hook.ok !== true || hook.normalized?.result !== 'ok' || hook.normalized.repair_layer_blocking === true
              || hook.provenance?.command_status !== 0 || hook.provenance.command_signal !== null || hook.provenance.command_error === true)
              fail('STANDARD_HANDOFF_CHECKPOINT_NOT_COMPLETED');
            const rawFile = agentRunPhysicalPath(hook.raw_payload_ref ?? hook.raw_file), rawRef = path.relative(root, rawFile).replaceAll('\\', '/');
            if (!rawRef.startsWith(base + '/raw/')) fail('STANDARD_HANDOFF_DIAGNOSTIC_SCOPE_CHANGED');
            evidence.push({ ref: rawRef, sha256: readAgentRunFile(rawFile, { json: false, maxBytes: 2097152 }).sha256 });
            const hydrated = await runHydrateContextUseCase({ targetRoot: root, hookContextStore, args: { target: root, contextFile, out: hydratedFile,
              skill: 'handoff-close', historyLimit: 20, includeArtifacts: true, indexFile: '.aidn/runtime/index/workflow-index.sqlite', backend: 'auto',
              maxArtifactBytes: 4096, maxArtifacts: 24, bundleTargetBytes: 262144, bundleHardLimitBytes: 1048576,
              minRelationConfidence: 0.65, relationThresholds: {}, allowAmbiguousLinks: false, includeCompatLocalIndex: false } });
            observed.hydrated_sha256 = readAgentRunFile(physical(hydratedFile), { json: false, maxBytes: 2097152 }).sha256;
            observed.completed_stages.push('hydration'); await guard();
            if (hydrated.decisions?.['handoff-close']?.repair_layer_blocking === true) fail('STANDARD_HANDOFF_REPAIR_BLOCKED');
            const sync = await runSyncDbFirstSelectiveUseCase({ targetRoot: root, gitAdapter: createLocalGitAdapter(), processAdapter: createLocalProcessAdapter(), importIntent: false,
              repairLayerTriageSummaryScript: fileURLToPath(new URL('../../../tools/perf/render-repair-layer-triage-summary.mjs', import.meta.url)),
              args: { stateMode: plan.state_mode, strict: true, forceInFiles: false, auditRoot: 'docs/audit', sqliteFile: '.aidn/runtime/index/workflow-index.sqlite',
                fallbackFull: false, repairLayerReportFile: base + '/repair-report.json', repairLayerTriageFile: base + '/repair-triage.json', repairLayerTriageSummaryFile: base + '/repair-triage.md' } });
            observed.sync_sha256 = payloadHash(sync); observed.completed_stages.push('sync'); await guard();
            if (sync.ok !== true || sync.fallback_full_used === true || sync.summary?.failed_count || sync.summary?.synced_count
              || Number(sync.repair_layer_result?.summary?.severity_counts?.error ?? 0) > 0) fail('STANDARD_HANDOFF_SYNC_UNCONFIRMED');
            for (const ref of [contextFile, hydratedFile, base + '/repair-report.json', base + '/repair-triage.json', base + '/repair-triage.md'])
              if (fs.existsSync(physical(ref))) evidence.push({ ref, sha256: readAgentRunFile(physical(ref), { json: false, maxBytes: 2097152 }).sha256 });
          }
          await guard();
          const computed = await projectRuntimeState({ targetRoot: root, contextFile,
            hydratedFile, write: false, dryRun: true });
          await guard();
          if (computed.consistency?.pass === false || computed.digest.repair_layer_status === 'block') fail('STANDARD_HANDOFF_RUNTIME_BLOCKED');
          const selected = rows(plan.session_id), runtime = buildRuntimeStateMarkdown(computed.digest);
          let currentText = scalar(selected[0].content, 'repair_layer_status', computed.digest.repair_layer_status);
          currentText = scalar(currentText, 'repair_primary_reason', String(computed.digest.repair_primary_reason ?? 'unknown').replace(/\s+/gu, ' ').trim());
          const changes = [{ row: selected[0], after: currentText }, { row: selected[1], after: runtime }], metadata = new Map();
          for (const { row, after } of changes) {
            active(signal); assertCurrent(); artifacts.assertLocalEffectOwner(expectPlan);
            if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || H(observeScope()) !== plan.scope_sha256) fail('STANDARD_HANDOFF_PREPARATION_CONTEXT_CHANGED');
            const committed = after === row.content ? { metadata_sha256: row.metadata_sha256 }
              : artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: row.metadata_sha256, after });
            metadata.set(row.path, committed.metadata_sha256); observed.completed_stages.push(row.path === 'CURRENT-STATE.md' ? 'current' : 'runtime');
          }
          artifacts.project(changes.map(change => change.row.path));
          const resultRows = rows(plan.session_id); projected(resultRows);
          for (const { row, after } of changes) {
            const actual = resultRows.find(value => value.path === row.path);
            if (actual.sha256 !== hashText(after) || actual.metadata_sha256 !== metadata.get(row.path)) fail('STANDARD_HANDOFF_RUNTIME_POSTCONDITION_FAILED');
          }
          if (H(pins(resultRows).slice(2)) !== H(plan.documents.slice(2))) fail('STANDARD_HANDOFF_PREPARATION_CONTEXT_CHANGED');
          await assertAuthorized(); active(signal); assertCurrent();
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || H(observeScope()) !== plan.scope_sha256
            || H(pins(rows(plan.session_id))) !== H(pins(resultRows))) fail('STANDARD_HANDOFF_PREPARATION_PROCESS_CHANGED');
          observed.documents = pins(resultRows);
          return emit(operation, 'completed', 'confirmed', observed, [...evidence, ...resultRows.map(row => ({ ref: 'docs/audit/' + row.path, sha256: row.sha256 }))]);
        } catch (cause) { return emit(operation, 'reconciliation_required', 'unknown', { ...observed, reason_code: /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code ?? '') ? cause.code : 'STANDARD_HANDOFF_PREPARATION_UNCONFIRMED' }); }
      });
    },
    async inspectAdmission(instance, input) {
      assertHandoffPreparationInput('handoff_admit', input);
      const publication = readAccepted(instance, input.publication_operation_id, 'handoff_packet_publish'), resource = readAccepted(instance, input.resource_operation_id, 'handoff_resources_observe');
      assertHandoffOperationOutput(publication.output); assertHandoffResourceOperationOutput(resource.output);
      if (publication.output.outcome !== 'completed' || resource.output.observations.publication_operation_id !== input.publication_operation_id
        || resource.output.observations.publication_output_sha256 !== H(publication.output)) fail('STANDARD_HANDOFF_ADMISSION_SOURCE_REQUIRED');
      const before = artifacts.readMany(['HANDOFF-PACKET.md'], { required: ['HANDOFF-PACKET.md'], includeMetadata: true })[0], p = publication.output.observations;
      if (before.sha256 !== p.packet_sha256 || before.metadata_sha256 !== p.packet_metadata_sha256) fail('STANDARD_HANDOFF_ADMISSION_PACKET_CHANGED');
      const currentState = parseStructuredMarkdownMap(artifacts.read('CURRENT-STATE.md', { required: true }).content);
      const subject = [...rows(currentState.active_session), before]; projected(subject);
      const scope = observeScope(), result = await admitHandoff({ targetRoot: root });
      const after = artifacts.readMany(['HANDOFF-PACKET.md'], { required: ['HANDOFF-PACKET.md'], includeMetadata: true })[0];
      const afterSubject = [...rows(currentState.active_session), after]; projected(afterSubject);
      if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || H(pins(subject)) !== H(pins(afterSubject)) || H(observeScope()) !== H(scope)) fail('STANDARD_HANDOFF_ADMISSION_CONTEXT_CHANGED');
      const observations = { ...input, packet_sha256: before.sha256, packet_metadata_sha256: before.metadata_sha256, admitted: result.admitted === true,
        admission_status: result.admission_status, payload_sha256: payloadHash(result), issues: result.issues, warnings: result.warnings, permits_handoff: false, permits_effects: false };
      return result.admitted === true && ['admitted', 'admitted_with_warnings'].includes(result.admission_status)
        ? emit('handoff_admit', 'completed', 'no_effect', observations, [{ ref: 'docs/audit/HANDOFF-PACKET.md', sha256: before.sha256 }])
        : emit('handoff_admit', 'blocked', 'no_effect', { ...observations, reason_code: 'STANDARD_HANDOFF_PACKET_NOT_ADMITTED' });
    },
  });
}
