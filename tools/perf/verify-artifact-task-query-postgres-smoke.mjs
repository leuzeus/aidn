import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {withEphemeralPostgres} from './agent-execution-postgres-test-lib.mjs';
import {resolvePostgresTestRuntime} from '../ci/resolve-postgres-test-runtime.mjs';
import {artifactQueryFixturePayload} from './verify-artifact-query-fixtures.mjs';
import {prepareActivationFixture} from './test-activation-fixture-lib.mjs';
import {writeWorkflowAdapterConfig} from '../../src/lib/config/workflow-adapter-config-lib.mjs';
import {resolveRuntimeProjectContext} from '../../src/application/runtime/runtime-project-context-service.mjs';
import {createPostgresRuntimeArtifactStore} from '../../src/adapters/runtime/postgres-runtime-artifact-store.mjs';
import {getPostgresRuntimeRelationalSchemaFile} from '../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs';
import {queryProjectArtifacts} from '../../src/application/runtime/artifact-query-service.mjs';
import {readRuntimeSnapshot} from '../../src/application/runtime/runtime-snapshot-service.mjs';
import {validateJsonSchema} from '../../src/core/contracts/json-schema-validator.mjs';

const repo=path.resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const schema=JSON.parse(fs.readFileSync(repo+'/src/core/contracts/cli-output/runtime-artifact-query.v1.schema.json'));
const {Client}=await import('pg');let checks=0;
await withEphemeralPostgres(async({connectionString})=>{
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'aidn-task-query-pg-')),previous=process.env.AIDN_TASK_QUERY_PRIVATE_PG;
  const client=new Client({connectionString});
  try {
    process.env.AIDN_TASK_QUERY_PRIVATE_PG=connectionString;
    fs.mkdirSync(target+'/.aidn');fs.writeFileSync(target+'/.aidn/config.json',JSON.stringify({runtime:{stateMode:'db-only',persistence:{backend:'postgres',connectionRef:'env:AIDN_TASK_QUERY_PRIVATE_PG'}}}));
    for(const args of [['init','-b','fixture/task-query'],['config','user.name','fixture'],['config','user.email','fixture@example.invalid'],['commit','--allow-empty','-m','fixture']]){
      const r=spawnSync('git',['-C',target,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
    }
    prepareActivationFixture(target,repo);
    const scope=resolveRuntimeProjectContext({targetRoot:target}),payload=artifactQueryFixturePayload(scope);
    const text='## Rules\nRetain every governance check.\n### Exception\nNever certify consulted evidence as acceptance.\n';
    payload.artifacts.push({path:'QUERY-RULES.md',kind:'normative',content:text,content_format:'utf8',sha256:hash(text)});
    const adoption=JSON.parse(fs.readFileSync(repo+'/package/governance/gfd-adoption.v1.json'));
    adoption.scope='installed-project';adoption.adoptionId='synthetic-private-query';
    adoption.authorities=[{id:'fixture-rules',reference:'QUERY-RULES.md',role:'fixture authority',scope:'fixture project',owner:'project_owner',status:'effective',effectiveFrom:'2026-10-02'}];
    adoption.sections=[{id:'fixture-query',disposition:'adapted',rationale:'Explicit synthetic policy',responsibility:'project_owner',authorities:['fixture-rules'],controls:[]}];
    adoption.extensions={...adoption.extensions,contextUnits:[{id:'rules',path:'QUERY-RULES.md',heading:'## Rules',sourceSha256:hash(text),authority:'fixture-rules',status:'effective',scope:{project_id:scope.project_id,workspace_id:'*',worktree_id:'*'},requires:[]}],
      taskContextPolicies:{schemaVersion:1,mandatory:['rules'],skills:{'context-reload':{mandatory:[],optional:[],rules:[]},'close-session':{mandatory:[],optional:[],rules:[]}}}};
    writeWorkflowAdapterConfig(target,{governanceAdoption:adoption});
    await client.connect();await client.query(fs.readFileSync(getPostgresRuntimeRelationalSchemaFile(),'utf8'));
    await client.query("INSERT INTO aidn_runtime.schema_migrations(schema_name,schema_version) VALUES('aidn_runtime',3) ON CONFLICT DO NOTHING");
    for(const r of payload.artifacts)Object.assign(r,{mtime_ns:'1',size_bytes:Buffer.byteLength(r.content),updated_at:'2026-10-22T00:00:00Z',family:'normative'});
    const store=createPostgresRuntimeArtifactStore({targetRoot:target,connectionString});
    await store.writeIndexProjection({payload:{...payload,schema_version:1,target_root:target,audit_root:'docs/audit',structure_profile:{kind:'modern',recommended_required_artifacts:[],notes:[]},cycles:[],sessions:[]}});
    const rows=async()=>JSON.stringify((await client.query('SELECT to_jsonb(a) AS row FROM aidn_runtime.artifacts a ORDER BY path')).rows);
    const before=await rows();
    for(const profile of ['admission-diagnostic.v1','modification-preparation.v1','verification-closure.v1']) {
      const params={schema_version:1,target_bytes:65536,skills:[profile==='verification-closure.v1'?'close-session':'context-reload'],
        ...(profile==='modification-preparation.v1'?{task:{operation:'replace'},artifact_paths:['CURRENT-STATE.md'],field_ids:['current_state.mode']}: {})};
      let canonicalTransactions=0;
      const q=await queryProjectArtifacts({targetRoot:target,profile,params,snapshotReader:options=>readRuntimeSnapshot({...options,
        clientFactory:()=>{const c=new Client({connectionString});return {connect:()=>c.connect(),end:()=>c.end(),query(sql,args){
          if(String(sql).includes('REPEATABLE READ READ ONLY'))canonicalTransactions++;return c.query(sql,args);
        }};}})});
      assert.equal(q.status,'ok',JSON.stringify(q.errors));assert.equal(q.source_backend,'postgres');assert.deepEqual(validateJsonSchema(q,schema),[]);
      assert.equal(q.admissions.length,1);assert.equal(q.observation.fence_status,'unchanged');assert.equal(q.authorities[0].content_excerpt,text);
      assert.equal(q.write_authorization,false);assert.equal(q.observation.distinct_reads,3);
      assert.equal(canonicalTransactions,2,'one shared canonical transaction, then its fresh publication fence');checks++;
    }
    assert.equal(await rows(),before);checks++;
    await assert.rejects(queryProjectArtifacts({targetRoot:target,profile:'admission-diagnostic.v1',params:{schema_version:1,target_bytes:65536,skills:['context-reload']},
      afterRead:()=>store.executeArtifactCommand('replace',{path:'cycles/C101-example/status.md',replacements:[{old:'state: IMPLEMENTING',new:'state: VERIFYING'}],expectedSha256:payload.artifacts[3].sha256})}),/WORKFLOW_OBSERVATION_INVALIDATED/);checks++;
  } finally {await client.end();if(previous===undefined)delete process.env.AIDN_TASK_QUERY_PRIVATE_PG;else process.env.AIDN_TASK_QUERY_PRIVATE_PG=previous;
    const p=path.resolve(target);assert.equal(path.dirname(p),path.resolve(os.tmpdir()));fs.rmSync(p,{recursive:true,force:true});}
},{binDir:resolvePostgresTestRuntime().bin_dir});
console.log(JSON.stringify({status:'PASS',checks,postgres:'REAL_PRIVATE_CLUSTER',shared_observation:true,concurrent_change_refused:true,cleanup:'PASS',native:'NOT_EXECUTED'}));
