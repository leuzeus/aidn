import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {artifactQueryFixturePayload} from './verify-artifact-query-fixtures.mjs';
import {prepareActivationFixture,isActivationFixtureSource} from './test-activation-fixture-lib.mjs';
import {createTrackedFixtureFilter} from './test-git-fixture-lib.mjs';
import {resolveRuntimeProjectContext} from '../../src/application/runtime/runtime-project-context-service.mjs';
import {queryProjectArtifacts} from '../../src/application/runtime/artifact-query-service.mjs';
import {artifactQueryManifest} from '../../src/application/runtime/artifact-query-catalog.mjs';
import {writeWorkflowAdapterConfig} from '../../src/lib/config/workflow-adapter-config-lib.mjs';
import {preWriteAdmit} from '../runtime/pre-write-admit.mjs';
import {withWorkflowObservation} from '../../src/application/runtime/workflow-observation-service.mjs';
import {validateJsonSchema} from '../../src/core/contracts/json-schema-validator.mjs';
import {projectWorkflowAgentView} from '../../src/application/codex/agent-view-projection.mjs';
import {shareWorkflowProjection,expandWorkflowProjection} from '../../src/application/codex/workflow-shared-projection.mjs';
import {finalizeWorkflowContextBudget} from '../../src/application/codex/task-context-profile.mjs';

const repo=path.resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const schema=JSON.parse(fs.readFileSync(repo+'/src/core/contracts/cli-output/runtime-artifact-query.v1.schema.json'));
const sharedSchema=JSON.parse(fs.readFileSync(repo+'/src/core/contracts/cli-output/codex-workflow-step-agent-compact.v2.schema.json'));

function verifySharedProjection() {
  const source={target_root:'fixture',source_revision:'a'.repeat(64),source_backend:'postgres',runtime_scope_id:'runtime:project=fixture:workspace=fixture:profile=default',project_id:'fixture',workspace_id:'fixture',state_mode:'db-only'};
  const decisions=Object.fromEntries(['audit','create','drift','handoff','session'].map(action=>[action,{ok:true,decision:'full',action,result:'ok',
    reason_codes:['BRANCH_CHANGED','ARTIFACTS_CHANGED','DIGEST_MISS'],repair_layer_open_count:0,repair_layer_blocking:false,
    repair_layer_status:'clean',repair_layer_advice:'Repair layer is clean.',repair_primary_reason:'Repair layer is clean.',repair_layer_top_findings:[]}]));
  const artifacts=['kernel','workflow','summary','baseline'].map(unit_id=>({path:unit_id+'.md',unit_id,sha256:'b'.repeat(64),selection_reasons:['mandatory_policy'],
    content_excerpt:'Complete authority, including final exceptions.\n',canonical:{schema_version:1,title:unit_id}}));
  const hydration={...source,artifacts,decisions,recent_history:[]};
  const payload={ts:'fixture',ok:true,effect_class:'read-only',target_root:'fixture',mode:'COMMITTING',skills:['context-reload','start-session'],workspace:{},
    summary:{skill_count:2,admission_count:2,blocked_skill_count:0,hydrate_count:1},admissions:{},hydrations:{'context-reload':hydration,'start-session':hydration},
    next_action:{target_root:'fixture',current_state_file:'current',runtime_state_file:'runtime',packet_file:'packet',packet_resolution:{},handoff:null,
      preferred_dispatch_source:'workflow',recommendation:{role:'executor',action:'implement',goal:'fixture',source:'workflow',reason:'admitted',stop_required:false},
      scope:{scope_type:'cycle',scope_id:'C001',target_branch:'fixture'},context:{},next_action_diagnostic:{}},
    selection_policy:{mode:'scoped',reason:'accepted_task_policy',write_authorization:false}};
  const initial=projectWorkflowAgentView(payload,null,'compact.v1');
  artifacts[0].content_excerpt+='x'.repeat(66000-Buffer.byteLength(JSON.stringify(initial)));
  const full=projectWorkflowAgentView(payload,null,'compact.v1'),shared=projectWorkflowAgentView(payload,null,'compact.v2');
  assert.deepEqual(validateJsonSchema(shared,sharedSchema),[]);
  const expanded=expandWorkflowProjection(shared),normal=structuredClone(full);
  for(const key of ['contract_version','command','projection_profile'])expanded[key]=normal[key];
  assert.deepEqual(expanded,normal,'all decision fields, source identities and authority bodies reconstruct exactly');
  assert.equal(shared.decision_sets.length,1);assert.equal(shared.context_sources.length,1);
  assert(!Object.hasOwn(shared.contexts[0],'decisions'));
  const bounded=finalizeWorkflowContextBudget(structuredClone(shared),{targetBytes:65536,hardLimitBytes:65536});
  const refused=finalizeWorkflowContextBudget(structuredClone(full),{targetBytes:65536,hardLimitBytes:65536});
  assert.equal(refused.bundle_budget.status,'blocked');assert(refused.bundle_budget.minimum_required_bytes>65536);
  assert.equal(bounded.bundle_budget.status,'within-target');assert.equal(bounded.ok,true);assert.equal(bounded.artifacts.length,4);
  assert.deepEqual(bounded.artifacts.map(a=>a.artifact),full.artifacts.map(a=>a.artifact));
  assert.equal(bounded.bundle_budget.total_bytes,Buffer.byteLength(JSON.stringify(bounded)));assert(bounded.bundle_budget.total_bytes<=65536);
  for(const mutate of [
    v=>delete v.decision_sets,
    v=>v.decision_sets[0].decisions.audit.ok=false,
    v=>v.contexts[0].decisions={},
    v=>v.context_sources.push(v.context_sources[0]),
    v=>v.artifacts[0].source_ref='0'.repeat(64),
  ]){const bad=structuredClone(shared);mutate(bad);assert.throws(()=>expandWorkflowProjection(bad),/WORKFLOW_PROJECTION_/);}
  const different=structuredClone(full);different.contexts[1].decisions.audit.ok=false;different.artifacts[0].source={...different.artifacts[0].source,source_revision:'c'.repeat(64)};
  shareWorkflowProjection(different);assert(!different.decision_sets,'different decisions never merge');assert(Object.hasOwn(different.artifacts[0],'source'),'different revisions remain inline');
  const tiny=finalizeWorkflowContextBudget(structuredClone(shared),{targetBytes:256,hardLimitBytes:65536});
  assert.equal(tiny.bundle_budget.status,'blocked');assert.equal(tiny.artifacts.length,0);assert(!tiny.context_sources);expandWorkflowProjection(tiny);
  return {before_minimum:refused.bundle_budget.minimum_required_bytes,after_bytes:bounded.bundle_budget.total_bytes,limit:65536};
}
export async function verifyArtifactTaskQueries() {
  const previous=process.env.AIDN_TASK_QUERY_UNAVAILABLE;delete process.env.AIDN_TASK_QUERY_UNAVAILABLE;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidn-task-query-')),target=root+'/client',checks=[];
  const run=(exe,args)=>{const r=spawnSync(exe,args,{cwd:repo,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});assert(!r.error,r.error?.message);return r;};
  const cli=args=>{const r=run(process.execPath,[repo+'/bin/aidn.mjs',args[0],args[1],'--target',target,...args.slice(2)]);return {...r,value:JSON.parse(r.stdout)};};
  const profile='admission-diagnostic.v1',params={schema_version:1,skills:['context-reload'],target_bytes:65536};
  const query=(id=profile,p=params,extra={})=>queryProjectArtifacts({targetRoot:target,profile:id,params:p,...extra});
  const fingerprint=()=>{
    const values=[];function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.git')continue;const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else values.push([path.relative(target,p),hash(fs.readFileSync(p))]);}}
    visit(target);return hash(JSON.stringify(values));
  };
  try {
    const sharedMeasurement=verifySharedProjection();checks.push('compact.v2: lossless decision/source references fit an overflowing mandatory response without increasing its limit: '+JSON.stringify(sharedMeasurement));
    const fixture=repo+'/tests/fixtures/repo-installed-core',tracked=createTrackedFixtureFilter(fixture,repo);
    fs.cpSync(fixture,target,{recursive:true,filter:p=>tracked(p)&&isActivationFixtureSource(fixture,p,{freshContext:true})});
    for(const args of [['init','-b','feature/example'],['config','user.name','fixture'],['config','user.email','fixture@example.invalid']])assert.equal(run('git',['-C',target,...args]).status,0);
    const scope=resolveRuntimeProjectContext({targetRoot:target});
    const payload=artifactQueryFixturePayload(scope);
    payload.artifacts[2].content+='\n### Final closure exception\nDo not certify missing or expired proof.\n';
    for(const row of payload.artifacts){const p=target+'/docs/audit/'+row.path;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,row.content);}
    const config={version:1,runtime:{stateMode:'files',indexStoreMode:'dual-sqlite'},workflow:{sourceBranch:'dev'}};
    fs.writeFileSync(target+'/.aidn/config.json',JSON.stringify(config));
    fs.rmSync(target+'/docs/audit/HANDOFF-PACKET.md',{force:true});
    const docs={'QUERY-RULES.md':'## Admission\nUse fresh canonical admission and retain every refusal.\n### Exception\nAn expired proof never authorizes closure.\n## Closure\nREQ, TEST, GAP and CR must be reconciled by the existing closure checks.\n',
      'QUERY-EVIDENCE.md':'## Evidence\nA consulted receipt is not a certified acceptance.\n### Last exception\nMissing proof requires the existing verification procedure.\n'};
    for(const [p,content]of Object.entries(docs))fs.writeFileSync(target+'/docs/audit/'+p,content);
    const adoption=JSON.parse(fs.readFileSync(repo+'/package/governance/gfd-adoption.v1.json'));
    adoption.scope='installed-project';adoption.adoptionId='synthetic-artifact-query';
    adoption.authorities=Object.keys(docs).map((reference,i)=>({id:'query-'+i,reference,role:'fixture authority',scope:'fixture project',owner:'project_owner',status:'effective',effectiveFrom:'2026-10-02'}));
    adoption.sections=[{id:'fixture-query',disposition:'adapted',rationale:'Explicit synthetic query policy',responsibility:'project_owner',authorities:adoption.authorities.map(a=>a.id),controls:[]}];
    const unit=(id,file,heading,requires=[])=>({id,path:file,heading,sourceSha256:hash(docs[file]),authority:adoption.authorities.find(a=>a.reference===file).id,
      status:'effective',scope:{project_id:scope.project_id,workspace_id:'*',worktree_id:'*'},requires});
    adoption.extensions={...adoption.extensions,contextUnits:[unit('rules','QUERY-RULES.md','## Admission',[{id:'evidence',reason:'Admission retains its evidence boundary'}]),
      unit('evidence','QUERY-EVIDENCE.md','## Evidence'),unit('closure','QUERY-RULES.md','## Closure')],
      taskContextPolicies:{schemaVersion:1,mandatory:['rules'],skills:Object.fromEntries(['context-reload','requirements-delta','close-session','cycle-close'].map(s=>[s,{mandatory:s.includes('close')?['closure']:[],optional:[],rules:[]}]))}};
    writeWorkflowAdapterConfig(target,{governanceAdoption:adoption});
    assert.equal(run('git',['-C',target,'add','.']).status,0);assert.equal(run('git',['-C',target,'commit','-m','fixture']).status,0);
    prepareActivationFixture(target,repo);
    const manifest=artifactQueryManifest();
    assert.deepEqual(manifest.profiles.map(p=>p.id),['active-state.v1','active-state.v2',profile,'modification-preparation.v1','verification-closure.v1']);
    const compatibility=JSON.parse(fs.readFileSync(repo+'/tests/fixtures/artifact-query/task-compatibility.v1.json'));
    const consumers=manifest.profiles.filter(p=>p.requires_client_task_policy),ids=new Set(consumers.flatMap(p=>[...p.mandatory,...Object.values(p.conditional).flat(),...p.optional]));
    assert.deepEqual({profiles:consumers,consumed:manifest.artifacts.map(c=>({artifact_type:c.artifact_type,contract_version:c.contract_version,fields:c.fields.filter(f=>ids.has(f.id)),sections:c.sections}))},compatibility);
    checks.push('three versioned consumers pin semantic fields and complete closure sections');
    for(const mode of ['files','dual','db-only']) {
      fs.writeFileSync(target+'/.aidn/config.json',JSON.stringify({...config,runtime:{...config.runtime,stateMode:mode}}));
      for(const name of ['CURRENT-STATE.md','RUNTIME-STATE.md']){
        const file=target+'/docs/audit/'+name;fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/^runtime_state_mode:.*$/m,'runtime_state_mode: '+mode));
      }
      const indexed=cli(['perf','index','--store','sqlite','--with-content','--json']);assert.equal(indexed.status,0,indexed.stderr);
      const before=fingerprint(),q=await query(),full=(await withWorkflowObservation({targetRoot:target,contextFile:'.aidn/runtime/context/codex-context.json'},()=>preWriteAdmit({targetRoot:target,skill:'context-reload'}))).value;
      assert.equal(q.status,'ok',JSON.stringify(q.errors));assert.equal(q.source_backend,mode==='files'?'files':'sqlite');
      assert.deepEqual(validateJsonSchema(q,schema),[]);assert.deepEqual(q.admissions[0].checks,full.checks);
      assert.equal(q.admissions[0].ok,full.ok);assert.deepEqual(q.admissions[0].blocking_reasons,full.blocking_reasons);
      assert.deepEqual(q.authorities.map(u=>u.unit_id),['evidence','rules']);assert(q.authorities[1].content_excerpt.includes('expired proof'));
      assert.equal(q.write_authorization,false);assert.equal(q.budget.total_bytes,Buffer.byteLength(JSON.stringify(q)));assert.equal(before,fingerprint());
      const prep=await query('modification-preparation.v1',{...params,task:{operation:'replace',paths:['docs/audit/CURRENT-STATE.md']},artifact_paths:['CURRENT-STATE.md'],field_ids:['current_state.mode']});
      assert.equal(prep.status,'ok',JSON.stringify(prep.errors));assert.deepEqual(validateJsonSchema(prep,schema),[]);
      assert.equal(prep.preparation.preimages[0].sha256,hash(fs.readFileSync(target+'/docs/audit/CURRENT-STATE.md')));assert.equal(prep.preparation.write_authorization,false);
      assert(!JSON.stringify(prep.preparation).includes(payload.artifacts[0].content));
      const closure=await query('verification-closure.v1',{...params,skills:['close-session']});
      assert.equal(closure.status,'ok',JSON.stringify(closure.errors));assert.equal(closure.verification.completion_authorized,false);
      assert(closure.sections.some(s=>s.id==='session.section.session_close_report_required'&&s.content.includes('No closure decision')));
      assert(closure.sections.some(s=>s.id==='session.section.session_close_report_required'&&s.content.includes('Do not certify missing or expired proof.')));
      assert(closure.authorities.some(u=>u.unit_id==='closure'));assert.deepEqual(validateJsonSchema(closure,schema),[]);
      assert.equal(before,fingerprint());checks.push(`${mode}: all profiles preserve full checks, exact preimage references, complete dependencies, no writes`);
      fs.writeFileSync(target+'/query.json',JSON.stringify(params));
      const actual=cli(['runtime','artifact-query','--profile',profile,'--params-file','query.json','--json']);
      assert.equal(actual.status,0,JSON.stringify(actual.value));assert.deepEqual(validateJsonSchema(actual.value,schema),[]);
      const workflow=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes','65536','--json']);
      assert.equal(workflow.status,0,workflow.stderr+JSON.stringify(workflow.value));assert.equal(workflow.value.ok,true,JSON.stringify(workflow.value));
      const w=workflow.value;assert.equal(w.summary.admission_count,1);assert.equal(w.summary.hydrate_count,1);
      assert.equal(w.artifact_consultation.admissions.length,1);assert.equal(w.artifact_consultation.status,'ok');
      assert(w.artifact_consultation.authorities.every(u=>u.workflow_artifact_ref&&!Object.hasOwn(u,'content_excerpt')));
      for(const u of w.artifact_consultation.authorities)assert(w.artifacts.some(a=>a.id===u.workflow_artifact_ref&&a.artifact.sha256===u.sha256));
      assert.equal(w.bundle_budget.total_bytes,Buffer.byteLength(JSON.stringify(w)));assert.equal(w.observation.fence_status,'unchanged');
      assert.deepEqual(validateJsonSchema(w.artifact_consultation,schema),[]);
      checks.push(`${mode}: real query CLI and grouped workflow share checked admissions and deduplicate authority bodies`);
      const sharedBefore=fingerprint();
      const compact=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--projection-profile','compact.v2','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes','65536','--json']).value;
      assert.equal(compact.ok,true,JSON.stringify(compact));assert.deepEqual(validateJsonSchema(compact,sharedSchema),[]);
      const expanded=expandWorkflowProjection(compact);
      assert.deepEqual(expanded.admissions,w.admissions);assert.deepEqual(expanded.artifact_consultation.admissions,w.artifact_consultation.admissions);
      assert.deepEqual(expanded.artifacts.map(a=>a.artifact),w.artifacts.map(a=>a.artifact));
      assert.equal(compact.observation.fence_status,'unchanged');assert.equal(compact.bundle_budget.total_bytes,Buffer.byteLength(JSON.stringify(compact)));
      assert.equal(sharedBefore,fingerprint());checks.push(`${mode}: compact.v2 real CLI retains checks, complete authorities, budget and read-only fence`);
      if(mode==='files') {
        const deltaArgs=['codex','workflow-step','--skills','context-reload','--view','agent','--projection-profile','compact.v2','--grouped',
          '--context-profile','token-efficiency.v1','--artifact-query-profile',profile,'--bundle-target-bytes','65536','--json'];
        const baseline=cli(deltaArgs).value;assert.equal(baseline.ok,true);assert(baseline.context_sources?.length);
        fs.writeFileSync(target+'/shared-baseline.json',JSON.stringify(baseline));
        const delta=cli([...deltaArgs,'--context-baseline-file','shared-baseline.json']).value;
        assert.equal(delta.ok,true,JSON.stringify(delta));assert.equal(delta.context_delta.mode,'differential');
        baseline.artifacts[0].source_ref='0'.repeat(64);fs.writeFileSync(target+'/shared-baseline.json',JSON.stringify(baseline));
        const reanchored=cli([...deltaArgs,'--context-baseline-file','shared-baseline.json']).value;
        assert.equal(reanchored.ok,true);assert.equal(reanchored.context_delta.mode,'full');
        checks.push('compact.v2 retained metadata/source bindings support checked delta and invalid references force fresh full selection');
        fs.writeFileSync(target+'/narrow-query.json',JSON.stringify({schema_version:1,target_bytes:256}));
        const narrow=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--grouped','--artifact-query-profile',profile,'--artifact-query-params-file','narrow-query.json','--bundle-target-bytes','65536','--json']).value;
        assert.equal(narrow.artifact_consultation.budget.target_bytes,256,'the workflow must not widen a narrower requested query budget');
        assert.equal(narrow.artifact_consultation.status,'blocked');assert.equal(narrow.ok,false);assert.equal(narrow.summary.hydrate_count,0);
        assert.equal(narrow.artifact_consultation.errors.filter(e=>e.code==='ARTIFACT_QUERY_BUDGET_INSUFFICIENT').length,1);
        assert(narrow.artifact_consultation.expansions.length>narrow.artifact_consultation.sources.length,'refusal must retain authority expansion references');
        checks.push('a narrower query-file budget remains binding before and after workflow projection');
        const limit=Math.floor((actual.value.budget.total_bytes+w.bundle_budget.total_bytes)/2);
        assert(limit>actual.value.budget.total_bytes&&limit<w.bundle_budget.total_bytes);
        const bounded=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes',String(limit),'--json']).value;
        assert.equal(bounded.bundle_budget.status,'blocked');assert.equal(bounded.artifact_consultation.status,'blocked');
        assert.deepEqual(bounded.artifact_consultation.authorities,[]);assert(bounded.artifact_consultation.expansions.length);
        assert.equal(bounded.bundle_budget.total_bytes,Buffer.byteLength(JSON.stringify(bounded)));
        checks.push('final workflow budget refuses even when the query alone fits; no dangling authority references');
        const index=target+'/.aidn/runtime/index/workflow-index.sqlite';fs.renameSync(index,index+'.held');
        try {
          const missingIndex=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes','65536','--json']).value;
          assert.equal(missingIndex.ok,false);assert.equal(missingIndex.context_selection.status,'blocked');
          assert.equal(missingIndex.bundle_budget.status,'blocked');
        }finally{fs.renameSync(index+'.held',index);}
        checks.push('missing indexed authority selection cannot become a successful workflow consultation');
      }
    }
    const small=await query(profile,{...params,target_bytes:256});assert.equal(small.status,'blocked');assert(small.errors.some(e=>e.code==='ARTIFACT_QUERY_BUDGET_INSUFFICIENT'));assert.equal(small.authorities.length,0);
    const stale=await query(profile,{...params,expected_revision:'0'.repeat(64)});assert.equal(stale.status,'blocked');
    assert(stale.errors.some(e=>e.code==='ARTIFACT_QUERY_REVISION_CHANGED'));
    const unchanged=await query();assert.equal((await query(profile,{...params,expected_revision:unchanged.source_revision})).status,'ok');
    const scopeKeys=['project_id','workspace_id','worktree_id','runtime_scope_id'];
    const foreignScope=await query(profile,{...params,scope:Object.fromEntries(scopeKeys.map(k=>[k,k==='project_id'?'foreign':scope[k]]))});
    assert.equal(foreignScope.status,'blocked');assert.equal(foreignScope.authorities,undefined);assert.equal(foreignScope.admissions,undefined);
    await assert.rejects(query('modification-preparation.v1'),/PREPARATION_PARAMS_REQUIRED/);
    await assert.rejects(query('verification-closure.v1',{...params,skills:['context-reload']}),/CLOSURE_SKILL_REQUIRED/);
    await assert.rejects(query(profile,{...params,skills:['unknown-skill']}),/PARAMS_INVALID/);
    fs.writeFileSync(target+'/invalid-query.json',JSON.stringify({...params,skills:['unknown-skill']}));
    const invalid=cli(['runtime','artifact-query','--profile',profile,'--params-file','invalid-query.json','--json']);
    assert.equal(invalid.status,2);assert.equal(invalid.value.profile,profile);assert(invalid.value.errors.some(e=>e.code==='ARTIFACT_QUERY_PARAMS_INVALID'));
    checks.push('unknown skills, wrong closure tasks, insufficient budget and stale revision refuse explicitly');
    fs.writeFileSync(target+'/.aidn/config.json',JSON.stringify(config));
    const previousMode=process.env.AIDN_STATE_MODE;
    try{process.env.AIDN_STATE_MODE='db-only';await assert.rejects(query(),/ARTIFACT_QUERY_ADMISSION_CANONICAL_MISMATCH/);}
    finally{if(previousMode===undefined)delete process.env.AIDN_STATE_MODE;else process.env.AIDN_STATE_MODE=previousMode;}
    checks.push('an environment override cannot mix a file observation with canonical database admissions');
    for(const name of ['CURRENT-STATE.md','RUNTIME-STATE.md']){
      const file=target+'/docs/audit/'+name;fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/^runtime_state_mode:.*$/m,'runtime_state_mode: files'));
    }
    const currentFile=target+'/docs/audit/CURRENT-STATE.md',currentBytes=fs.readFileSync(currentFile);
    fs.writeFileSync(currentFile,currentBytes.toString().replace('active_cycle: C101','active_cycle: none'));
    assert.equal(cli(['perf','index','--store','sqlite','--with-content','--json']).status,0);
    const mixed=cli(['codex','workflow-step','--skills','context-reload,requirements-delta','--view','agent','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes','65536','--json']).value;
    assert.equal(mixed.ok,false);assert.equal(mixed.admissions.find(a=>a.skill==='requirements-delta').ok,false);
    assert.deepEqual(mixed.contexts.map(c=>c.skill),['context-reload']);assert.equal(mixed.summary.hydrate_count,1);
    assert.equal(mixed.artifact_consultation.admissions.find(a=>a.skill==='requirements-delta').ok,false);
    fs.writeFileSync(currentFile,currentBytes);
    const runtimeFile=target+'/docs/audit/RUNTIME-STATE.md',runtimeBytes=fs.readFileSync(runtimeFile);
    fs.writeFileSync(runtimeFile,runtimeBytes.toString().replace(/^repair_routing_hint:.*$/m,'repair_routing_hint: block'));
    assert.equal(cli(['perf','index','--store','sqlite','--with-content','--json']).status,0);
    const stopped=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes','65536','--json']).value;
    assert.equal(stopped.next_action.recommendation.stop_required,true);assert.equal(stopped.summary.hydrate_count,0);
    assert.equal(stopped.summary.artifact_query_count,0);assert(stopped.artifact_consultation.errors.some(e=>e.code==='ARTIFACT_QUERY_GLOBAL_STOP'));
    fs.writeFileSync(runtimeFile,runtimeBytes);assert.equal(cli(['perf','index','--store','sqlite','--with-content','--json']).status,0);
    const tooSmall=cli(['codex','workflow-step','--skills','context-reload','--view','agent','--grouped','--artifact-query-profile',profile,'--bundle-target-bytes','256','--json']).value;
    assert.equal(tooSmall.ok,false);assert.equal(tooSmall.bundle_budget.status,'blocked');assert.equal(tooSmall.artifact_consultation.status,'blocked');
    assert.equal(tooSmall.bundle_budget.total_bytes,Buffer.byteLength(JSON.stringify(tooSmall)));
    checks.push('blocked skills retain diagnostics without hydration; independent skills continue; global stop and final workflow budget refuse');
    const foreign=structuredClone(adoption);foreign.extensions.contextUnits[0].scope.project_id='foreign';writeWorkflowAdapterConfig(target,{governanceAdoption:foreign});
    const refused=await query();assert.equal(refused.status,'blocked');assert(refused.authority_selection.errors.some(e=>e.reason==='project_scope_mismatch'));
    const unaccepted=structuredClone(adoption);unaccepted.status='proposed';unaccepted.acceptance=null;
    writeWorkflowAdapterConfig(target,{governanceAdoption:unaccepted});const noPolicy=await query();assert.equal(noPolicy.status,'blocked');assert(noPolicy.errors.some(e=>e.code==='ARTIFACT_QUERY_ACCEPTED_POLICY_REQUIRED'));
    writeWorkflowAdapterConfig(target,{governanceAdoption:adoption});
    const proof=target+'/docs/audit/QUERY-EVIDENCE.md',original=fs.readFileSync(proof);
    fs.unlinkSync(proof);const missing=await query();assert.equal(missing.status,'blocked');assert(missing.authority_selection.errors.some(e=>e.reason==='mandatory_unavailable'));fs.writeFileSync(proof,original);
    fs.writeFileSync(proof,'## Evidence\nExpired or changed proof.\n');
    fs.writeFileSync(target+'/.aidn/config.json',JSON.stringify(config));
    const changed=await query();assert.equal(changed.status,'blocked');assert(changed.authority_selection.errors.some(e=>e.reason==='source_revision_mismatch'));
    fs.writeFileSync(proof,original);
    await assert.rejects(query(profile,params,{afterRead:()=>fs.appendFileSync(proof,'Concurrent change\n')}),/(ARTIFACT_QUERY_SOURCE_CHANGED|WORKFLOW_OBSERVATION_INVALIDATED)/);fs.writeFileSync(proof,original);
    checks.push('foreign scope, unaccepted policy, changed proof and concurrent modification refuse without weakening checks');
    fs.writeFileSync(target+'/.aidn/config.json',JSON.stringify({runtime:{stateMode:'db-only',persistence:{backend:'postgres',connectionRef:'env:AIDN_TASK_QUERY_UNAVAILABLE'}}}));
    await assert.rejects(query());checks.push('configured unavailable PostgreSQL never falls back to local files or SQLite');
    return {status:'PASS',checks:checks.length,details:checks,files:true,sqlite:'REAL_DUAL_AND_DB_ONLY',postgres:'UNAVAILABLE_NEGATIVE_ONLY',native:'NOT_EXECUTED'};
  } finally {if(previous===undefined)delete process.env.AIDN_TASK_QUERY_UNAVAILABLE;else process.env.AIDN_TASK_QUERY_UNAVAILABLE=previous;
    const p=path.resolve(root);assert.equal(path.dirname(p),path.resolve(os.tmpdir()));fs.rmSync(p,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await verifyArtifactTaskQueries()));
