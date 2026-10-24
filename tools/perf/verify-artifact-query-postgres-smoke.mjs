import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withEphemeralPostgres } from './agent-execution-postgres-test-lib.mjs';
import { resolvePostgresTestRuntime } from '../ci/resolve-postgres-test-runtime.mjs';
import { artifactQueryFixturePayload } from './verify-artifact-query-fixtures.mjs';
import { createPostgresRuntimeArtifactStore } from '../../src/adapters/runtime/postgres-runtime-artifact-store.mjs';
import { getPostgresRuntimeRelationalSchemaFile } from '../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs';
import { queryProjectArtifacts } from '../../src/application/runtime/artifact-query-service.mjs';
import { readRuntimeSnapshot } from '../../src/application/runtime/runtime-snapshot-service.mjs';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';

// Manual, real DB evidence in a private owned cluster. No client service/config.
const binDir=resolvePostgresTestRuntime().bin_dir;
const {Client}=await import('pg');let checks=0;
await withEphemeralPostgres(async({connectionString})=>{
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'aidn-query-pg-client-'));
  const previous=process.env.AIDN_QUERY_PRIVATE_PG;
  const client=new Client({connectionString});
  try{
    process.env.AIDN_QUERY_PRIVATE_PG=connectionString;
    fs.mkdirSync(path.join(target,'.aidn'));fs.writeFileSync(path.join(target,'.aidn/config.json'),JSON.stringify({runtime:{stateMode:'db-only',persistence:{backend:'postgres',connectionRef:'env:AIDN_QUERY_PRIVATE_PG'}}}));
    await client.connect();await client.query(fs.readFileSync(getPostgresRuntimeRelationalSchemaFile(),'utf8'));
    await client.query("INSERT INTO aidn_runtime.schema_migrations(schema_name,schema_version) VALUES('aidn_runtime',3) ON CONFLICT DO NOTHING");
    const scope=resolveRuntimeProjectContext({targetRoot:target}),payload=artifactQueryFixturePayload(scope);
    for(const row of payload.artifacts){row.mtime_ns='1';row.size_bytes=Buffer.byteLength(row.content);row.updated_at='2026-10-22T00:00:00Z';row.family='normative';}
    const store=createPostgresRuntimeArtifactStore({targetRoot:target,connectionString});
    await store.writeIndexProjection({payload:{...payload,schema_version:1,target_root:target,audit_root:'docs/audit',
      structure_profile:{kind:'modern',recommended_required_artifacts:[],notes:[]},cycles:[],sessions:[]}});
    const before=JSON.stringify((await client.query('SELECT to_jsonb(a) AS row FROM aidn_runtime.artifacts a ORDER BY path')).rows);
    const result=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1}});
    assert.equal(result.status,'ok',JSON.stringify(result.errors));assert.equal(result.source_backend,'postgres');checks++;
    assert.equal(JSON.stringify((await client.query('SELECT to_jsonb(a) AS row FROM aidn_runtime.artifacts a ORDER BY path')).rows),before);checks++;
    let changed=false;const queries=[];
    const coherent=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1},snapshotReader:options=>readRuntimeSnapshot({...options,
      clientFactory:()=>{const connection=new Client({connectionString});return {connect:()=>connection.connect(),end:()=>connection.end(),
        async query(sql,args){queries.push(String(sql));const rows=await connection.query(sql,args);
          if(!changed && String(sql).includes('FROM aidn_runtime.index_meta')){
            changed=true;await store.executeArtifactCommand('replace',{path:'cycles/C101-example/status.md',
              replacements:[{old:'state: IMPLEMENTING',new:'state: VERIFYING'}],expectedSha256:payload.artifacts[3].sha256});
          }return rows;}};}})});
    assert(changed);assert.equal(coherent.status,'ok',JSON.stringify(coherent.errors));
    assert.equal(coherent.fields.find(f=>f.id==='cycle_status.state').value,'IMPLEMENTING');
    assert(queries.some(q=>q.includes('REPEATABLE READ READ ONLY')));assert(!queries.some(q=>/^\s*(INSERT|UPDATE|CREATE|DELETE)/i.test(q)));checks++;
    const fresh=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1}});
    assert.equal(fresh.status,'ok');assert.equal(fresh.fields.find(f=>f.id==='cycle_status.state').value,'VERIFYING');checks++;
    const refused=await queryProjectArtifacts({targetRoot:target,params:{schema_version:1,expected_revision:result.source_revision}});
    assert.equal(refused.status,'blocked');assert(refused.errors.some(e=>e.code==='ARTIFACT_QUERY_REVISION_CHANGED'));checks++;
  }finally{
    await client.end();if(previous===undefined)delete process.env.AIDN_QUERY_PRIVATE_PG;else process.env.AIDN_QUERY_PRIVATE_PG=previous;
    const absolute=path.resolve(target);assert.equal(path.dirname(absolute),path.resolve(os.tmpdir()));fs.rmSync(absolute,{recursive:true,force:true});
  }
},{binDir});
console.log(JSON.stringify({status:'PASS',checks,postgres:'REAL_PRIVATE_CLUSTER',concurrent_snapshot:true,cleanup:'PASS',native:'NOT_EXECUTED'}));
