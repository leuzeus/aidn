import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSessionDeliveryPostimages } from '../../src/application/runtime/session-delivery-postimages.mjs';
import { sessionClosePaths } from '../../src/core/workflow/standard-session-close-render.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),names=sessionClosePaths('sessions/S001.md');
const plan={session_path:'sessions/S001.md',documents:names.map(path=>({path,sha256:a,metadata_sha256:a}))};
const output={contract_version:'standard-session-close-hook-output.v2',operation_ref:'session_close_finalize',outcome:'completed',effect_status:'confirmed',facts:{session_close_completed:true},
  observations:{committed:names,postimages:names.map(path=>({path,sha256:b,metadata_sha256:c}))},evidence_refs:[{ref:'aidn:session-close/fixture',sha256:a},...names.map(path=>({ref:'docs/audit/'+path,sha256:b}))]};
const artifacts={read:()=>({sha256:b}),metadataHash:()=>c};let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('new receipt uses supported schema vocabulary and validates',()=>{
  const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-session-close-hook-output.v2.schema.json',import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);assertStandardOperationOutput(output);
});
check('post-write metadata succeeds despite a different preimage',()=>assert.deepEqual(readSessionDeliveryPostimages({artifacts,plan,output}),output.observations.postimages));
check('current metadata-only drift refuses',()=>assert.throws(()=>readSessionDeliveryPostimages({artifacts:{...artifacts,metadataHash:()=>a},plan,output}),{code:'STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED'}));
check('current content-only drift refuses',()=>assert.throws(()=>readSessionDeliveryPostimages({artifacts:{...artifacts,read:()=>({sha256:a})},plan,output}),{code:'STANDARD_SESSION_DELIVERY_POSTIMAGE_CHANGED'}));
for(const [name,change]of[
  ['missing postimages',o=>delete o.observations.postimages],
  ['duplicate path',o=>o.observations.postimages[1]=o.observations.postimages[0]],
  ['reordered paths',o=>o.observations.postimages.reverse()],
  ['different content evidence',o=>o.observations.postimages[0].sha256=a],
  ['foreign committed path',o=>o.observations.committed=['other.md',...names.slice(1)]],
])check(name+' refuses',()=>{const changed=structuredClone(output);change(changed);assert.throws(()=>readSessionDeliveryPostimages({artifacts,plan,output:changed}));});
check('legacy DB result remains readable but cannot supply missing metadata',()=>{
  const legacy=structuredClone(output);legacy.contract_version='standard-session-close-hook-output.v1';delete legacy.observations.postimages;
  assertStandardOperationOutput(legacy);assert.throws(()=>readSessionDeliveryPostimages({artifacts,plan,output:legacy}),{code:'STANDARD_SESSION_DELIVERY_METADATA_PROOF_REQUIRED'});
});
check('legacy FILES result retains its null metadata meaning',()=>{
  const legacy=structuredClone(output);legacy.contract_version='standard-session-close-hook-output.v1';delete legacy.observations.postimages;
  const filesPlan={...plan,documents:plan.documents.map(row=>({...row,metadata_sha256:null}))};
  assert.deepEqual(readSessionDeliveryPostimages({artifacts:{...artifacts,metadataHash:()=>null},plan:filesPlan,output:legacy}),names.map(path=>({path,sha256:b,metadata_sha256:null})));
});
console.log(JSON.stringify({status:'PASS',checks,proof:'controlled-postimage-reader',actual_cas:'NOT_RUN_HERE',native_calls:0}));
