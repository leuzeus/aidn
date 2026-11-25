import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertRetainedSessionPrOpenBoundary, assertRetainedSessionPrOpenEntry, assertRetainedSessionPrOpenProof, retainedSessionPrOpenContinuation } from '../../src/core/workflow/standard-retained-session-pr-open.mjs';
import { selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
const digest='a'.repeat(64),openId='op_'+'b'.repeat(40),entryId='op_'+'c'.repeat(40);
const entry={kind:'retained_session_pr_open',original_configuration:{path:'/protected/original.json',sha256:digest},open_operation_id:openId};
const proof={original_instance_id:'original',original_instance_sha256:digest,original_configuration_sha256:digest,lineage_sha256:digest,
  provider_sha256:digest,decision_material_sha256:digest,session_id:'S001',open_operation_id:openId};
const parameters={session:{session_id:'S001'},cycle:{cycle_id:'C001'},entry_point:entry};let checks=0;
const test=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
await test('closed continuation supplies no new approval or physical completion fact',()=>{
  assertRetainedSessionPrOpenEntry(entry);assertRetainedSessionPrOpenProof(proof);
  const output=selectStandardEntry(parameters,null,retainedSessionPrOpenContinuation(proof));assertStandardOperationOutput(output);
  assert.equal(output.facts.retained_session_pr_open_requested,true);assert.equal(output.facts.session_pr_open_confirmed,undefined);
  assert.throws(()=>assertRetainedSessionPrOpenEntry({...entry,approved:true}));
  assert.throws(()=>selectStandardEntry(parameters,null,{...retainedSessionPrOpenContinuation(proof),open_operation_id:entryId}));
});
for(const field of ['lineage_sha256','provider_sha256','decision_material_sha256'])await test('missing '+field+' refuses',()=>{
  const changed=structuredClone(proof);delete changed[field];assert.throws(()=>assertRetainedSessionPrOpenProof(changed));
});
await test('provider rechecks process identity after the historical admission',async()=>{
  const record={instance_id:'current',instance_sha256:digest,initial_parameters:parameters};let revision=digest,change=false;
  const provider=createStandardOperationProvider({current:()=>({record:{...record,instance_sha256:revision}}),reviewEffects:new Map(),
    retainedSessionPrOpenEntry:async()=>{if(change)revision='b'.repeat(64);return retainedSessionPrOpenContinuation(proof);},fail:code=>{throw Object.assign(Error(code),{code});}});
  const select=provider.operations.find(row=>row.binding.id==='workflow_entry_select');
  assert.equal((await select.prepare({state:{record}})).facts.retained_session_pr_open_requested,true);
  change=true;await assert.rejects(select.prepare({state:{record}}),{code:'STANDARD_ENTRY_PROCESS_CHANGED'});
});
await test('record provider selects its fixed source; authored IDs cannot select history',async()=>{
  assertStandardOperationInput('session_pr_record',{});assertStandardOperationInput('session_pr_record',{contract_version:'standard-session-pr-record-input.v1',open_operation_id:openId});
  let calls=0;const provider=createStandardOperationProvider({reviewEffects:new Map(),prepareSessionPrRecord:async()=>{calls++;return {can_apply:false};},fail:code=>{throw Object.assign(Error(code),{code});}});
  const operation=provider.operations.find(row=>row.binding.id==='session_pr_record');
  await assert.rejects(operation.prepare({state:{record:{}},input:{contract_version:'standard-session-pr-record-input.v1',open_operation_id:openId}}),{code:'STANDARD_OPERATION_INPUT_INVALID'});
  assert.equal(calls,0);assert.deepEqual(await operation.prepare({state:{record:{}},input:{}}),{can_apply:false});assert.equal(calls,1);
});
await test('published reducer enters the PR writer without reintegration, push, open, Human or Native',()=>{
  const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url)));
  const binding=standardWorkflowOperationBindings().find(row=>row.id==='workflow_entry_select');
  let instance=createAgenticProcess({instanceId:'pr-open-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters});
  const occurrence=inspectAgenticProcess(instance).ready[0],intent={contract_version:'process-operation-intent.v1',operation_id:entryId,
    binding_ref:binding.id,binding_sha256:H(binding),input_sha256:H({}),preconditions_sha256:digest,authorization_sha256:null,
    authority_id:'fixture',scope_id:instance.scope_id,instance_id:instance.instance_id,instance_sha256:instance.instance_sha256,
    model_sha256:instance.model_sha256,occurrence_id:occurrence,instance_revision:instance.revision};
  instance=advanceAgenticProcess(instance,{event_id:'entry',kind:'operation_intent',occurrence_id:occurrence,intent});
  const output=selectStandardEntry(parameters,null,retainedSessionPrOpenContinuation(proof));
  instance=advanceAgenticProcess(instance,{event_id:'accepted',kind:'operation_result',occurrence_id:occurrence,
    receipt:{contract_version:'process-operation-receipt.v1',receipt_id:'fixture-receipt',operation_id:entryId,intent_sha256:H(intent),authority_id:'fixture',
      outcome:'completed',effect_status:'no_effect',output_sha256:H(output),facts:output.facts,evidence_refs:[{ref:'fixture:entry',sha256:H(output)}]}});
  const cursor=inspectAgenticProcess(instance),frame=cursor.occurrences.find(row=>row.occurrence_id===cursor.ready[0]);
  assert.equal(processFrameNode(model,frame).binding_ref,'session_pr_record');assert.deepEqual(resolveProcessOperationInput({instance,occurrenceId:frame.occurrence_id}).input,{});
  assert.equal(instance.events.length,2);assert(model.nodes.length<=288);
});
function fixture(){
 const instance={instance_id:'original',scope_id:'scope',model_sha256:digest,initial_parameters:{entry_point:{kind:'retained_session_integration'}},events:[]};
 const records=['workflow_entry_select','session_branch_integrate','session_pr_admit','session_push','session_pr_open'].map((binding,index)=>{
   const id=index===4?openId:'op_'+String(index+4).repeat(40),intent={operation_id:id,binding_ref:binding,instance_id:instance.instance_id,scope_id:instance.scope_id,model_sha256:digest};
   const output={outcome:'completed',effect_status:[0,2].includes(index)?'no_effect':'confirmed'},receipt={operation_id:id,outcome:'completed',effect_status:output.effect_status,output_sha256:H(output)};
   const record={operation_id:id,intent,phase:'receipted',results:[{output,receipt}]};instance.events.push({kind:'operation_intent',intent:structuredClone(intent)},{kind:'operation_result',receipt:structuredClone(receipt)});return record;
 });return{instance,records,entry:structuredClone(entry)};
}
await test('only the settled five-operation prefix is admissible',()=>assert.equal(assertRetainedSessionPrOpenBoundary(fixture()).operation_id,openId));
for(const[name,change]of Object.entries({extra:x=>x.records.push(x.records[0]),missing:x=>x.records.pop(),unaccepted:x=>x.instance.events.pop(),
 unknown:x=>x.records[4].results[0].output.effect_status='unknown',failed:x=>x.records[4].results[0].output.outcome='blocked',
 foreign:x=>x.records[2].intent.instance_id='foreign',scope:x=>x.records[2].intent.scope_id='other',order:x=>x.records.reverse(),
 retry:x=>x.records[4].results.push(x.records[4].results[0]),dispatching:x=>x.records[4].phase='dispatching',
 wrongEntry:x=>x.instance.initial_parameters.entry_point.kind='session',otherPr:x=>x.entry.open_operation_id=entryId
}))await test(name+' prefix refuses',()=>{const f=fixture();change(f);assert.throws(()=>assertRetainedSessionPrOpenBoundary(f));});
await test('new contracts remain closed and supported',()=>{
 for(const name of ['standard-retained-session-pr-open-entry.v1','standard-retained-session-pr-open-proof.v1','standard-workflow-entry-selection-output.v12','standard-session-pr-record-input.v2']){
  const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);
 }
});
console.log(JSON.stringify({status:'PASS',checks,historical_reader:'NOT_RUN',actual_pr_record:'NOT_RUN',native_calls:0,p0:false}));
