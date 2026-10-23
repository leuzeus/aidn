import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listCriticalMarkdownContracts } from '../../src/lib/workflow/markdown-contract-registry-lib.mjs';
import { buildCanonicalFromMarkdown } from '../../src/lib/workflow/markdown-render-lib.mjs';
import { artifactQueryManifest } from '../../src/application/runtime/artifact-query-catalog.mjs';
import { selectArtifactQuery, queryProjectArtifacts, validateArtifactQueryParams } from '../../src/application/runtime/artifact-query-service.mjs';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import { prepareActivationFixture } from './test-activation-fixture-lib.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const corpus=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/artifact-query/corpus.json'),'utf8'));
const schema=JSON.parse(fs.readFileSync(path.join(root,'src/core/contracts/cli-output/runtime-artifact-query.v1.schema.json'),'utf8'));
const compatibility=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/artifact-query/compatibility.v1.json'),'utf8'));
export function artifactQueryFixturePayload(scope) {
  const current='# Current State\n## Summary\ncontract_version: critical-markdown-v1\nupdated_at: 2026-10-22T00:00:00Z\nruntime_state_mode: files\nrepair_layer_status: clean\n## Active Context\nactive_session: S101\nactive_cycle: C101\nsession_branch: session/example\ncycle_branch: feature/example\nbranch_kind: cycle\nmode: COMMITTING\ndor_state: READY\n## Blocking Findings\nblocking_findings:\n- none\n';
  const runtime='# Runtime\n## Summary\ncontract_version: critical-markdown-v1\nupdated_at: 2026-10-22T00:00:00Z\nruntime_state_mode: files\nrepair_layer_status: clean\nrepair_primary_reason: none\nrepair_routing_hint: continue\n## Current State Freshness\ncurrent_state_freshness: ok\n## Blocking Findings\nblocking_findings:\n- none\n## Prioritized Reads\nprioritized_artifacts:\n- CURRENT-STATE.md\n';
  const session='# Session\nstate: OPEN\n## WORK MODE (required)\n[ ] THINKING\n[ ] EXPLORING\n[x] COMMITTING\n### Session Branch Continuity (required)\ncontract_version: critical-markdown-v1\nsession_branch: session/example\nparent_session: none\n### Branch Context (required for COMMITTING)\nbranch_kind: cycle\nintegration_target_cycles:\n- C101\nprimary_focus_cycle: C101\nattached_cycles:\n- C101\n### Session Cycle Tracking (required for COMMITTING)\ncarry_over_pending: false\n## Session Close Report (required)\nNo closure decision has been made.\n';
  const cycle='# Cycle\ncontract_version: critical-markdown-v1\ncycle_id: C101\nstate: IMPLEMENTING\nbranch_name: feature/example\ndor_state: READY\nblockers:\n- none\n\n## History\n'+ 'Historical state is not a current decision.\n'.repeat(700);
  const rows=[['CURRENT-STATE.md','current_state',current],['RUNTIME-STATE.md','runtime_state',runtime],['sessions/S101-example.md','session',session],['cycles/C101-example/status.md','cycle_status',cycle]];
  return {project_context:scope,artifacts:rows.map(([name,kind,content])=>({path:name,kind,content,content_format:'utf8',sha256:hash(content),canonical:buildCanonicalFromMarkdown(content,{relativePath:name,classification:{kind}})}))};
}

export async function verifyArtifactQueryFixtures() {
  let checks=0;const check=(name,fn)=>{try{fn();checks++;}catch(error){error.message=`${name}: ${error.message}`;throw error;}};
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'aidn-artifact-query-'));
  const scope=resolveRuntimeProjectContext({targetRoot:target});
  const base=artifactQueryFixturePayload(scope), contractList=listCriticalMarkdownContracts();
  const initialPayload=structuredClone(base);
  initialPayload.artifacts=initialPayload.artifacts.slice(0,2).map(row=>{
    const content=fs.readFileSync(path.join(root,'scaffold/docs_audit',row.path),'utf8')
      .replaceAll('{{PREFERRED_STATE_MODE}}','files').replaceAll('{{PROJECT_NAME}}','fixture');
    return {...row,content,sha256:hash(content),canonical:buildCanonicalFromMarkdown(content,{relativePath:row.path,classification:{kind:row.kind}})};
  });
  const revise=(payload,n,fn)=>{const r=payload.artifacts[n];r.content=fn(r.content);r.sha256=hash(r.content);};
  try{
    check('installed initial sources conform while unknown bootstrap facts remain incomplete',()=>{
      const result=selectArtifactQuery({payload:initialPayload,backend:'files',scope});
      assert.equal(result.status,'incomplete',JSON.stringify(result.errors));
      assert(result.sources.every(source=>source.contract_status==='conformant'));
      for(const id of ['current_state.mode','current_state.branch_kind','current_state.dor_state'])
        assert.equal(result.fields.find(field=>field.id===id)?.status,'uninterpretable');
      assert.equal(result.write_authorization,false);
      const malformed=structuredClone(initialPayload);
      revise(malformed,0,text=>text.replace(/^## Blocking Findings\r?\n/m,''));
      assert(selectArtifactQuery({payload:malformed,backend:'files',scope}).errors.some(error=>error.code==='ARTIFACT_QUERY_CONTRACT_NON_CONFORMANT'));
    });
    for(const test of corpus.cases){
      const payload=structuredClone(base),params={schema_version:1};
      switch(test.mutation){
        case 'absent-mode':revise(payload,0,s=>s.replace('mode: COMMITTING\n',''));break;
        case 'unknown-mode':revise(payload,0,s=>s.replace('mode: COMMITTING','mode: unknown'));break;
        case 'duplicate-mode':revise(payload,0,s=>s+'\nmode: THINKING\n');break;
        case 'unknown-version':revise(payload,0,s=>s.replace('critical-markdown-v1','critical-markdown-v999'));break;
        case 'legacy-cycle':revise(payload,3,s=>s.replace('contract_version: critical-markdown-v1\n',''));break;
        case 'missing-cycle':payload.artifacts.pop();break;
        case 'foreign-scope':params.scope={...scope,project_id:'foreign'};params.scope=Object.fromEntries(['project_id','workspace_id','worktree_id','runtime_scope_id'].map(k=>[k,params.scope[k]]));break;
        case 'branch-conflict':revise(payload,3,s=>s.replace('feature/example','feature/foreign'));break;
        case 'mode-conflict':revise(payload,2,s=>s.replace('[x] COMMITTING','[ ] COMMITTING').replace('[ ] THINKING','[x] THINKING'));break;
        case 'hash-corrupt':payload.artifacts[3].sha256='0'.repeat(64);break;
        case 'json-stale':payload.artifacts[3].canonical.key_values.state='DONE';break;
        case 'budget-insufficient':params.target_bytes=256;break;
        case 'revision-invalid':params.expected_revision='0'.repeat(64);break;
        case 'inactive':revise(payload,0,s=>s.replace('active_session: S101','active_session: none').replace('active_cycle: C101','active_cycle: none'));break;
        case 'ambiguous-cycle':payload.artifacts.push({...payload.artifacts[3],path:'cycles/C101-other/status.md'});break;
        case 'contradictory-blockers':revise(payload,3,s=>s.replace('blockers:\n- none','blockers:\n- none\n- GAP-1 unresolved'));break;
      }
      const before=JSON.stringify(payload),result=selectArtifactQuery({payload,backend:'files',scope,params});
      check(`corpus ${test.id}`,()=>{
        assert.equal(result.status,test.status,JSON.stringify(result.errors));
        if(test.error)assert(result.errors.some(e=>e.code===test.error),JSON.stringify(result.errors));
        const field=result.fields.find(f=>f.id===test.field);
        if('value'in test)assert.deepEqual(field?.value,test.value);
        if(test.field_status)assert.equal(field?.status,test.field_status);
        assert.equal(JSON.stringify(payload),before);assert.equal(result.write_authorization,false);
        assert.equal(validateJsonSchema(result,schema).length,0);
        if(result.budget)assert.equal(result.budget.total_bytes,Buffer.byteLength(JSON.stringify(result)));
      });
    }
    check('manifest derives fields and rejects deleted consumers',()=>{
      const manifest=artifactQueryManifest();assert.equal(manifest.artifacts.length,4);
      const p=manifest.profiles[0],used=new Set([...p.mandatory,...Object.values(p.conditional).flat(),...p.optional]);
      assert.deepEqual({manifest_version:manifest.manifest_version,extractor_version:manifest.extractor_version,profile:p,
        consumed:manifest.artifacts.map(c=>({artifact_type:c.artifact_type,contract_version:c.contract_version,fields:c.fields.filter(f=>used.has(f.id))}))},compatibility,
      'Consumed semantic meaning, types, extractors and dependencies need an explicit versioned compatibility decision');
      const changed=structuredClone(contractList);changed.find(c=>c.artifact_type==='current_state').consultation_fields=[];
      assert.throws(()=>artifactQueryManifest(changed),/PROFILE_REFERENCE/);
    });
    for(const mutation of ['type','section','duplicate','extractor'])check(`catalog evolution ${mutation}`,()=>{
      const changed=structuredClone(contractList),c=changed.find(c=>c.artifact_type==='current_state');
      if(mutation==='type')c.field_types.mode='list';
      if(mutation==='section')c.consultation_fields[0].requires_sections=['undeclared'];
      if(mutation==='duplicate')c.consultation_fields.push(c.consultation_fields[0]);
      if(mutation==='extractor')c.consultation_fields[0].extractor='unknown';
      assert.throws(()=>artifactQueryManifest(changed),/CATALOG_FIELD/);
    });
    for(const params of [{},{schema_version:2},{schema_version:1,sql:'select *'},{schema_version:1,target_bytes:0},{schema_version:1,include_optional:1},{schema_version:1,scope:{project_id:'foreign'}}])
      check('invalid bounded parameters',()=>assert.throws(()=>validateArtifactQueryParams(params),/PARAMS_INVALID/));
    const selected=selectArtifactQuery({payload:base,backend:'files',scope});
    for(const marker of ['(none','none)','none','(none)'])check(`balanced empty-list sentinel ${marker}`,()=>{
      const payload=structuredClone(base);revise(payload,3,s=>s.replace('blockers:\n- none',`blockers: ${marker}`));
      const result=selectArtifactQuery({payload,backend:'files',scope});
      const actual=result.fields.find(f=>f.id==='cycle_status.blockers');
      assert.deepEqual(actual.value,['none','(none)'].includes(marker)?[]:[marker]);
    });
    check('fenced examples cannot supply a missing required field',()=>{
      const payload=structuredClone(base);revise(payload,0,s=>s.replace('mode: COMMITTING\n','')+'\n```text\nmode: COMMITTING\n```\n');
      const result=selectArtifactQuery({payload,backend:'files',scope});assert.notEqual(result.status,'ok');assert.equal(result.fields.find(f=>f.id==='current_state.mode').status,'absent');
    });
    check('exact complete dependent section includes final exception',()=>{
      const payload=structuredClone(base);revise(payload,2,s=>s.replace('[x] COMMITTING','[x] COMMITTING\n#### Exception\nDo not skip the final control.'));
      const result=selectArtifactQuery({payload,backend:'files',scope});assert.equal(result.status,'ok');
      assert(result.sections[0].content.includes('Do not skip the final control.'));
      assert.equal(result.sections[0].sha256,hash(result.sections[0].content));
    });
    const expanded=selectArtifactQuery({payload:base,backend:'files',scope,params:{schema_version:1,include_optional:false}});
    check('optional field is omitted before refusing a sufficient mandatory budget',()=>{
      const payload=structuredClone(base);revise(payload,1,s=>s.replace('- CURRENT-STATE.md','- '+ 'Large optional reference '.repeat(900)));
      const result=selectArtifactQuery({payload,backend:'files',scope});assert.equal(result.status,'ok');
      assert(result.omissions.some(x=>x.reason==='optional_budget'));assert(result.budget.within_target);
    });
    check('optional exclusion is explicit and stable revision can be rebound',()=>{
      assert(expanded.omissions.length);assert(!expanded.fields.some(f=>f.optional));
      assert.equal(selectArtifactQuery({payload:base,backend:'files',scope,params:{schema_version:1,expected_revision:selected.source_revision}}).status,'ok');
    });
    for(const row of base.artifacts){const dest=path.join(target,'docs/audit',row.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,row.content);}
    fs.mkdirSync(path.join(target,'.aidn'));fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'files'}}));
    const fingerprint=()=>hash(JSON.stringify(base.artifacts.map(row=>fs.readFileSync(path.join(target,'docs/audit',row.path),'utf8'))));
    const before=fingerprint(),files=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1}});
    check('real files consultation is read-only and equals pure selection',()=>{assert.equal(files.status,'ok');assert.deepEqual(files.fields,selected.fields);assert.equal(fingerprint(),before);});
    for(const invalid of [{runtime:{stateMode:'files',persistence:{backend:'postgres-typo'}}},{runtime:{stateMode:'invalid'}},{version:999}]){
      fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify(invalid));
      await assert.rejects(queryProjectArtifacts({targetRoot:target,params:{schema_version:1},snapshotReader:async()=>{throw Error('SHOULD_NOT_READ_BACKEND');}}),/ARTIFACT_QUERY_CONFIG_INVALID/);checks++;
    }
    fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'files'}}));
    await assert.rejects(queryProjectArtifacts({targetRoot:target,params:{schema_version:1},afterRead:()=>fs.appendFileSync(path.join(target,'docs/audit/CURRENT-STATE.md'),'\nConcurrent update\n')}),/SOURCE_CHANGED/);checks++;
    fs.writeFileSync(path.join(target,'docs/audit/CURRENT-STATE.md'),base.artifacts[0].content);
    await assert.rejects(queryProjectArtifacts({targetRoot:target,params:{schema_version:1},afterRead:()=>{
      fs.mkdirSync(path.join(target,'docs/audit/cycles/C101-duplicate'));fs.writeFileSync(path.join(target,'docs/audit/cycles/C101-duplicate/status.md'),base.artifacts[3].content);
    }}),/SOURCE_CHANGED/);checks++;
    fs.unlinkSync(path.join(target,'docs/audit/cycles/C101-duplicate/status.md'));fs.rmdirSync(path.join(target,'docs/audit/cycles/C101-duplicate'));
    fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'dual',persistence:{backend:'sqlite'}}}));
    const seed=spawnSync(process.execPath,[path.join(root,'tools/perf/index-sync.mjs'),'--target',target,'--store','dual-sqlite','--with-content','--json'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});
    assert.equal(seed.status,0,seed.stderr);
    const databaseFile=path.join(target,'.aidn/runtime/index/workflow-index.sqlite'),databaseBefore=hash(fs.readFileSync(databaseFile));
    const sqlite=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1}});
    check('real dual SQLite query matches files and leaves DB bytes unchanged',()=>{
      assert.equal(sqlite.status,'ok',JSON.stringify(sqlite.errors));assert.deepEqual(sqlite.fields,files.fields);assert.equal(hash(fs.readFileSync(databaseFile)),databaseBefore);
    });
    fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'db-only',persistence:{backend:'sqlite'}}}));
    fs.writeFileSync(path.join(target,'docs/audit/CURRENT-STATE.md'),'# Stale visible shadow\nactive_cycle: C999\n');
    const dbOnly=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1}});
    check('db-only SQLite ignores stale Markdown shadow',()=>{assert.equal(dbOnly.status,'ok');assert.equal(dbOnly.fields.find(f=>f.id==='current_state.active_cycle').value,'C101');});
    await assert.rejects(queryProjectArtifacts({targetRoot:target,params:{schema_version:1},snapshotReader:async()=>({backend:'sqlite',payload:{...base,project_context:null,target_root:path.join(target,'foreign')}})}),/SCOPE_MISMATCH/);checks++;
    fs.writeFileSync(path.join(target,'docs/audit/CURRENT-STATE.md'),base.artifacts[0].content);
    fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'db-only',persistence:{backend:'postgres',connectionRef:'env:AIDN_QUERY_TEST_UNAVAILABLE'}}}));
    let snapshots=0;
    const pg=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1},snapshotReader:async options=>{snapshots++;assert.equal(options.backend,'postgres');return {backend:'postgres',payload:base};}});
    check('one injected canonical PG observation; visible files are not authority',()=>{assert.equal(snapshots,1);assert.equal(pg.status,'ok');assert.equal(pg.source_backend,'postgres');});
    const mutable={schema_version:1};const captured=await queryProjectArtifacts({targetRoot:target,params:mutable,snapshotReader:async()=>{mutable.target_bytes=256;return {backend:'postgres',payload:base};}});
    check('caller mutation during await cannot change query intent',()=>assert.equal(captured.status,'ok'));
    await assert.rejects(queryProjectArtifacts({targetRoot:target,params:{schema_version:1},snapshotReader:async()=>{throw new Error('backend unavailable');}}),/backend unavailable/);checks++;
    prepareActivationFixture(target,root);
    fs.writeFileSync(path.join(target,'query.json'),'{"schema_version":1}');
    const cli=args=>spawnSync(process.execPath,[path.join(root,'bin/aidn.mjs'),'runtime','artifact-query','--target',target,...args],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
    check('CLI unavailable PG returns typed JSON with no fallback or credentials',()=>{
      const failed=cli(['--profile','active-state.v1','--params-file','query.json','--json']);assert.equal(failed.status,2);
      const value=JSON.parse(failed.stdout);assert.equal(value.status,'blocked');assert.equal(value.errors[0].code,'ARTIFACT_QUERY_CANONICAL_UNAVAILABLE');
      assert(!failed.stdout.includes('postgres://'));assert(!failed.stdout.includes('Historical state'));
    });
    fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'files'}}));
    prepareActivationFixture(target,root);
    check('real activated CLI returns factual query contract',()=>{
      const value=cli(['--profile','active-state.v1','--params-file','query.json','--json']);
      assert.equal(value.status,0,value.stderr+value.stdout);assert.equal(validateJsonSchema(JSON.parse(value.stdout),schema).length,0);
    });
    for(const flags of [['--write'],['--manifest','--profile','active-state.v1'],['--profile','arbitrary'],['--profile','active-state.v1','--params-file','../foreign.json']])
      check('CLI refuses unsupported effects/selectors/paths',()=>{const result=cli([...flags,'--json']);assert.notEqual(result.status,0);assert.equal(JSON.parse(result.stdout).status,'blocked');});
    const bytes={full_artifacts:Buffer.byteLength(JSON.stringify(base.artifacts)),selected_json:Buffer.byteLength(JSON.stringify(selected))};
    check('fixture reduction with complete sources retained',()=>assert(bytes.selected_json<bytes.full_artifacts));
    return {status:'PASS',checks,corpus_cases:corpus.cases.length,files:true,sqlite:'REAL_DUAL_AND_DB_ONLY',cli:true,postgres:'INJECTED_SNAPSHOT_ONLY',native:'NOT_EXECUTED',bytes};
  }finally{
    const absolute=path.resolve(target);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(absolute,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await verifyArtifactQueryFixtures()));
