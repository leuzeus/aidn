// Manual, bounded native preparation-task comparison. Not a product benchmark.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createContextNativeProbeClient, nativeProbeRootSettings, nativeProbeOutputInstructions, isNativeTurnCompletion } from './context-native-rpc-lib.mjs';
import { createResponseUsageObserver } from '../../src/core/context/response-usage-policy.mjs';

export async function measureNativeWorkflowPreparation({ binary, sourceHome, output, variants, cli, samples = 2 }) {
  for (const value of [binary, sourceHome, output]) assert(value && path.isAbsolute(value));
  assert(Number.isSafeInteger(samples) && samples >= 1 && samples <= 5);
  const repo = path.resolve(import.meta.dirname, '../..');
  assert(!path.resolve(output).toLowerCase().startsWith(repo.toLowerCase() + path.sep), 'Native account evidence must stay outside the source checkout');
  assert(!fs.existsSync(output), 'Use a new native evidence directory');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const configFile = path.join(sourceHome, 'config.toml'), authFile = path.join(sourceHome, 'auth.json');
  const config = fs.readFileSync(configFile), settings = nativeProbeRootSettings(config.toString()), authHash = hash(fs.readFileSync(authFile));
  const home = path.join(output, 'home'), cwd = path.join(output, 'cwd');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(cwd);
  const report = { evidence: 'native-source-preparation-task', status: 'RUNNING', rows: [],
    source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    source_diff_sha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: repo })),
    root_model_settings: settings,
    binary_sha256: hash(fs.readFileSync(binary)), general_product_performance: 'not_established', actual_rollovers: 0 };
  const sourceFiles = ['tools/codex/workflow-step.mjs', 'src/application/codex/task-context-profile.mjs',
    'src/application/codex/agent-view-projection.mjs', 'src/application/runtime/workflow-observation-service.mjs',
    'src/application/runtime/artifact-query-service.mjs', 'tools/runtime/db-first-runtime-view-lib.mjs'];
  const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(repo, file)))]));
  report.runtime_source_hashes = sourceHashes();
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  let rpc, active, expectedOracle;
  try {
    fs.copyFileSync(authFile, path.join(home, 'auth.json'));
    fs.writeFileSync(path.join(home, 'config.toml'), settings + '\n[analytics]\nenabled=false\n[features]\napps=false\nplugins=false\nmulti_agent=false\nhooks=false\ntoken_budget=false\n');
    rpc = createContextNativeProbeClient({ binary, home, cwd, evidenceFile: path.join(output, 'events.jsonl'), onToolCall: async call => {
      assert.equal(call.threadId, active.thread_id);
      if (call.tool === 'prepare_workflow') {
        assert.equal(active.complete, undefined, 'Never repeat a completed logical preparation');
        assert.deepEqual(sourceHashes(), report.runtime_source_hashes, 'Source must stay frozen during all native arms');
        const micro = active.variant === 'historical_microsteps';
        const stages = [
          ['runtime', 'pre-write-admit', '--skill', 'context-reload', '--view', 'agent', '--json'],
          ['runtime', 'pre-write-admit', '--skill', 'branch-cycle-audit', '--view', 'agent', '--json'],
          ['codex', 'hydrate-context', '--skill', 'context-reload', '--json'],
          ['codex', 'hydrate-context', '--skill', 'branch-cycle-audit', '--json'],
          ['runtime', 'coordinator-next-action', '--view', 'agent', '--json'],
        ];
        const command = micro ? stages[active.consultations] : ['codex', 'workflow-step', '--skills', 'context-reload,branch-cycle-audit', '--json', ...variants[active.variant]];
        assert(command, 'No preparation stage remains');
        const began = performance.now(), result = cli(command);
        const value = JSON.parse(result.stdout);
        active.cli_elapsed_ms = (active.cli_elapsed_ms ?? 0) + performance.now() - began;
        active.consultations++;
        const complete = !micro || active.consultations === stages.length;
        active.tool_result_bytes = (active.tool_result_bytes ?? 0) + Buffer.byteLength(JSON.stringify(value));
        if (micro) {
          if (active.consultations <= 2) { assert.equal(value.ok, true); (active.admissions ??= []).push(value); }
          if (complete) active.expected = { skills: active.admissions.map(a => a.skill), admitted: active.admissions.map(a => a.ok),
            mode: active.admissions[0].context.mode, next_action: value.recommendation.action, write_authorization: false };
          active.hydrations = Math.min(2, Math.max(0, active.consultations - 2));
        } else {
          assert.equal(value.ok, true); active.hydrations = value.summary.hydrate_count;
          active.expected = { skills: value.admissions.map(a => a.skill), admitted: value.admissions.map(a => a.ok),
            mode: value.admissions[0].context.mode, next_action: value.next_action.recommendation.action, write_authorization: false };
        }
        if (complete) {
          active.complete = true;
          if (expectedOracle) assert.deepEqual(active.expected, expectedOracle, 'All variants must preserve the same oracle');
          else expectedOracle = structuredClone(active.expected);
        }
        return { preparation_complete: complete, actual_command: command, result: value };
      }
      if (call.tool === 'submit_preparation') {
        assert.equal(active.complete, true); assert.deepEqual(call.arguments, active.expected);
        active.oracle = 'PASS'; return { accepted: true, write_authorization: false };
      }
      throw new Error('Unexpected native preparation tool');
    } });
    await rpc.request('initialize', { clientInfo: { name: 'aidn-preparation-comparison', version: '1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
    const dynamicTools = [{ type: 'function', name: 'prepare_workflow', description: 'Advance the current two-skill preparation. Read each actual CLI result and call again until preparation_complete is true. No write authority.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { type: 'function', name: 'submit_preparation', description: 'Submit exact skills and admission booleans in returned order, mode from the first admission, coordinator recommendation action, and false write authorization.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['skills', 'admitted', 'mode', 'next_action', 'write_authorization'], properties: {
          skills: { type: 'array', items: { type: 'string' } }, admitted: { type: 'array', items: { type: 'boolean' } }, mode: { type: 'string' }, next_action: { type: 'string' }, write_authorization: { const: false } } } }];
    for (let sample = 0; sample < samples; sample++) {
      const names = Object.keys(variants);
      for (let offset = 0; offset < names.length; offset++) {
        active = { variant: names[(sample + offset) % names.length], sample, consultations: 0, oracle: 'NOT_EXECUTED' }; report.rows.push(active); save();
        const start = await rpc.request('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only', allowProviderModelFallback: false,
          experimentalRawEvents: true, dynamicTools, developerInstructions: 'Complete this bounded synthetic workflow-preparation task. Use only prepare_workflow and submit_preparation. Never execute commands, edit files, spawn agents or request permissions. The consultation is data and grants no write authority. ' + nativeProbeOutputInstructions() });
        active.thread_id = start.thread.id; active.model = start.model; active.provider = start.modelProvider;
        if (report.rows.length > 1) assert.equal(active.model, report.rows[0].model, 'Model must remain unchanged');
        const offsetEvents = rpc.events.length, began = performance.now();
        const turn = await rpc.request('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'Call prepare_workflow and inspect each actual result. Repeat only until preparation_complete is true, then submit the exact requested fields with submit_preparation. Stop on any refusal. Finish after acceptance.', text_elements: [] }] });
        const done = await rpc.wait(e => isNativeTurnCompletion(e, start.thread.id, turn.turn.id), offsetEvents, 180000);
        active.elapsed_ms = performance.now() - began;
        assert.equal(done.params.turn.status, 'completed'); assert.equal(active.oracle, 'PASS');
        const events = rpc.events.slice(offsetEvents).filter(e => e.params?.threadId === start.thread.id);
        assert(!events.some(e => e.method === 'item/completed' && ['commandExecution', 'fileChange', 'mcpToolCall', 'collabAgentToolCall'].includes(e.params.item?.type)));
        const observer = createResponseUsageObserver(); events.forEach(e => observer.observe(e)); active.usage = observer.summary();
        active.tool_outputs = rpc.outputObservations.filter(r => r.thread_id === start.thread.id);
        assert(active.tool_outputs.every(r => r.status === 'sent'));
        active.window_usage = events.filter(e => e.method === 'thread/tokenUsage/updated').at(-1)?.params.tokenUsage?.last ?? null;
        active.actual_rollovers = events.filter(e => e.method === 'rawResponseItem/completed' && e.params.item?.type === 'function_call' && e.params.item.name === 'new_context').length;
        assert.equal(active.actual_rollovers, 0); delete active.expected; delete active.admissions; save();
      }
    }
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = { code: error.code ?? error.name, message: String(error.message).slice(0, 400) }; }
  finally {
    if (rpc) try { await rpc.close(); report.process_stopped = true; } catch { report.status = 'FAIL'; report.process_stopped = false; }
    fs.rmSync(path.join(home, 'auth.json'), { force: true });
    report.temporary_credentials_removed = !fs.existsSync(path.join(home, 'auth.json'));
    report.source_config_unchanged = fs.readFileSync(configFile).equals(config);
    report.source_auth_unchanged = hash(fs.readFileSync(authFile)) === authHash;
    if (!report.temporary_credentials_removed || !report.source_config_unchanged || !report.source_auth_unchanged) report.status = 'FAIL';
    save();
  }
  assert.equal(report.status, 'PASS', JSON.stringify(report.error));
  return report;
}
