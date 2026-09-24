import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// Audit-only harness: no LLM, no Codex trust/config changes, no product code edits.
const repo = path.resolve(import.meta.dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-codex-spike-'));
const target = path.join(temp, 'projet espace é');
const subdir = path.join(target, 'sous dossier');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result[path.relative(root, file).replaceAll('\\', '/')] = digest(fs.readFileSync(file));
    }
  }
  visit(root);
  return result;
}
const changed = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]).sort();
const scrub = value => String(value).split(temp).join('<TEMP>').split(target).join('<CLIENT>').split(repo).join('<SOURCE>');
function run(command, args, {cwd = repo, input = undefined, shell = false} = {}) {
  const before = snapshot(target);
  const started = performance.now();
  const r = spawnSync(command, args, {cwd, input, shell, encoding:'utf8', windowsHide:true, timeout:60000, maxBuffer:8*1024*1024});
  let parsed = null;
  try { parsed = JSON.parse(r.stdout.trim()); } catch {}
  return {
    result: {
      exit: r.status, signal: r.signal, error: r.error?.code ?? null,
      elapsed_ms: Math.round((performance.now()-started)*100)/100,
      stdout_bytes: Buffer.byteLength(r.stdout ?? ''), stderr_bytes: Buffer.byteLength(r.stderr ?? ''),
      stderr_tail: scrub((r.stderr ?? '').slice(-1000)),
      valid_json: parsed !== null, changed_paths: changed(before, snapshot(target)),
      ok: parsed?.ok ?? null, admission_status: parsed?.admission_status ?? null,
      blocked_skill_count: parsed?.summary?.blocked_skill_count ?? null,
      missing: parsed?.aidnDiagnostics?.missing ?? null,
      blocking_reasons: parsed?.blocking_reasons ?? null,
      summary: parsed?.summary ?? null
    }, parsed
  };
}
const report = {
  schema:'audit-spike.v1', timestamp:new Date().toISOString(),
  source_sha:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim(),
  platform:process.platform, node:process.version, evidence_kind:'source-and-temporary-fixture',
  llm_calls:0, native_codex_hook_runtime_tested:false, trust_modified:false,
  questions:[
    'Does the distributed hook launch from a nested Windows path with spaces and accents without writing?',
    'Do missing assets and malformed input have distinct hook results?',
    'Does admission denial imply nonzero exit without --strict?',
    'Does workflow-step write a hidden bundle even when admission is denied?',
    'What local baseline latency and output byte counts are observable without an LLM?'
  ], cases:[], source_files:{}, cleanup:false
};
try {
  fs.cpSync(path.join(repo,'tests/fixtures/repo-installed-core'),target,{recursive:true,filter:p=>!p.split(path.sep).includes('.git')});
  fs.mkdirSync(subdir,{recursive:true});
  const gitInit=spawnSync('git',['init','--quiet'],{cwd:target,encoding:'utf8'});
  if(gitInit.status!==0) throw new Error('temporary git init failed');
  fs.mkdirSync(path.join(target,'.codex','hooks'),{recursive:true});
  fs.copyFileSync(path.join(repo,'scaffold/codex_hooks/scripts/aidn-session-start.mjs'),path.join(target,'.codex/hooks/aidn-session-start.mjs'));
  for(const rel of ['scaffold/codex_hooks/hooks.json','scaffold/codex_hooks/scripts/aidn-session-start.mjs','tools/runtime/pre-write-admit.mjs','tools/codex/workflow-step.mjs','src/application/codex/hydrate-context-use-case.mjs']) report.source_files[rel]=digest(fs.readFileSync(path.join(repo,rel)));
  const hook=path.join(target,'.codex/hooks/aidn-session-start.mjs');
  const input=JSON.stringify({hook_event_name:'SessionStart',cwd:subdir,source:'startup'});
  const config=JSON.parse(fs.readFileSync(path.join(repo,'scaffold/codex_hooks/hooks.json'),'utf8'));
  const command=process.platform==='win32'?config.hooks.SessionStart[0].hooks[0].commandWindows:config.hooks.SessionStart[0].hooks[0].command;
  const asciiRoot=path.join(temp,'plain space');
  fs.mkdirSync(path.join(asciiRoot,'.codex/hooks'),{recursive:true});
  fs.copyFileSync(hook,path.join(asciiRoot,'.codex/hooks/aidn-session-start.mjs'));
  spawnSync('git',['init','--quiet'],{cwd:asciiRoot,encoding:'utf8'});
  report.cases.push({id:'distributed-hook-ascii-control',...run(command,[],{cwd:asciiRoot,input:JSON.stringify({cwd:asciiRoot}),shell:true}).result,expectation:'control: launcher should work without accented path; assets intentionally incomplete'});
  const launch=run(command,[],{cwd:subdir,input,shell:true});
  report.cases.push({id:'distributed-hook-command-nested-path',...launch.result,expectation:'exit 0, JSON, no writes'});
  for(let i=0;i<3;i++) report.cases.push({id:`direct-hook-${i+1}`,...run(process.execPath,[hook],{cwd:subdir,input}).result});
  const agentsFile=path.join(target,'AGENTS.md');
  const agentsBytes=fs.readFileSync(agentsFile); fs.unlinkSync(agentsFile);
  report.cases.push({id:'hook-missing-AGENTS',...run(process.execPath,[hook],{cwd:subdir,input}).result,expectation:'diagnostic only; exit remains zero'});
  fs.writeFileSync(agentsFile,agentsBytes);
  report.cases.push({id:'hook-malformed-json',...run(process.execPath,[hook],{cwd:subdir,input:'{'}).result,expectation:'exit 1; not a native Codex failure-mode test'});
  const bin=path.join(repo,'bin/aidn.mjs');
  for(let i=0;i<3;i++) report.cases.push({id:`admission-${i+1}`,...run(process.execPath,[bin,'runtime','pre-write-admit','--target',target,'--skill','requirements-delta','--json']).result});
  report.cases.push({id:'admission-strict',...run(process.execPath,[bin,'runtime','pre-write-admit','--target',target,'--skill','requirements-delta','--strict','--json']).result});
  for(let i=0;i<3;i++) report.cases.push({id:`workflow-step-${i+1}`,...run(process.execPath,[bin,'codex','workflow-step','--target',target,'--skills','context-reload,requirements-delta','--mode','COMMITTING','--json']).result});
  report.cases.push({id:'workflow-step-strict',...run(process.execPath,[bin,'codex','workflow-step','--target',target,'--skills','context-reload,requirements-delta','--mode','COMMITTING','--strict','--json']).result});
  const bundle=path.join(target,'.aidn/runtime/context/hydrated-context.json');
  report.context_bytes={AGENTS:fs.statSync(agentsFile).size,skill_context_reload:fs.statSync(path.join(target,'.agents/skills/context-reload/SKILL.md')).size,hidden_bundle:fs.existsSync(bundle)?fs.statSync(bundle).size:null};
  report.measurement_limits='Three sequential samples, no percentile estimate; bytes are not tokens. Each recorded run launches one top-level process; internal Git/Node descendants not instrumented. LLM tool-call counts and actual Codex startup/resume latency unmeasured.';
} catch(error) {
  report.harness_error=scrub(error.stack ?? error);
} finally {
  const resolved=fs.realpathSync(temp);
  const prefix=path.join(fs.realpathSync(os.tmpdir()),'aidn-codex-spike-');
  if(!resolved.startsWith(prefix)) throw new Error('cleanup path escaped temporary prefix');
  fs.rmSync(resolved,{recursive:true,force:true});
  report.cleanup=!fs.existsSync(resolved);
}
console.log(JSON.stringify(report,null,2));
if(report.harness_error || !report.cleanup) process.exitCode=1;
