import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { assertRetainedExternalMergeEntry, assertRetainedExternalMergeProof, assertRetainedExternalMergeBoundary, retainedExternalMergeContinuation } from '../../src/core/workflow/standard-retained-external-merge.mjs';
import { selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardControlInbox } from '../../src/application/runtime/standard-workflow-control-inbox.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { createPretriageMergeSource } from '../../src/application/runtime/standard-session-pr-pretriage-merge.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { externalMergeControlClaim, externalMergeMaterial } from '../../src/core/workflow/standard-pr-external-merge.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url)));
const digest='a'.repeat(64),updateId='op_'+'b'.repeat(40);
const entry={kind:'retained_external_merge',original_configuration:{path:'/protected/original.json',sha256:digest},update_operation_id:updateId};
const proof={original_instance_id:'original',original_instance_sha256:digest,original_configuration_sha256:digest,lineage_sha256:digest,
 provider_sha256:digest,inherited_proof_sha256:digest,session_id:'S001',update_operation_id:updateId};
const parameters={session:{session_id:'S001'},cycle:{cycle_id:'C001'},entry_point:entry};let checks=0;
const test=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
function accept(instance,binding,index,output){
 const occurrence=inspectAgenticProcess(instance).ready[0],b=standardWorkflowOperationBindings().find(row=>row.id===binding);
 const intent={contract_version:'process-operation-intent.v1',operation_id:index===3?updateId:'op_'+String(index+1).repeat(40),binding_ref:binding,
  binding_sha256:H(b),input_sha256:H({}),preconditions_sha256:digest,authorization_sha256:null,authority_id:'fixture',scope_id:instance.scope_id,
  instance_id:instance.instance_id,instance_sha256:instance.instance_sha256,model_sha256:instance.model_sha256,occurrence_id:occurrence,instance_revision:instance.revision};
 instance=advanceAgenticProcess(instance,{event_id:'intent-'+index,kind:'operation_intent',occurrence_id:occurrence,intent});
 const receipt={contract_version:'process-operation-receipt.v1',receipt_id:'receipt-'+index,operation_id:intent.operation_id,intent_sha256:H(intent),authority_id:'fixture',
  outcome:'completed',effect_status:output.effect_status,output_sha256:H(output),facts:output.facts??{},evidence_refs:[{ref:'fixture:output',sha256:H(output)}]};
 instance=advanceAgenticProcess(instance,{event_id:'result-'+index,kind:'operation_result',occurrence_id:occurrence,receipt});
 return{instance,record:{operation_id:intent.operation_id,intent,phase:'receipted',preview:{input:{}},results:[{output,receipt}]}};
}
function enter(instance,records){
 const cursor=inspectAgenticProcess(instance),frame=cursor.occurrences.find(row=>row.wait_reason==='call_entry');assert(frame);
 return advanceAgenticProcess(instance,{event_id:'call-'+instance.events.length,kind:'call_enter',occurrence_id:frame.occurrence_id,
  ...resolveProcessCallData({instance,cursor,occurrenceId:frame.occurrence_id,readOperation:id=>records.find(row=>row.operation_id===id)})});
}
function boundary(){
 const names=['workflow_entry_select','session_pr_record','session_pr_checkpoint','session_pr_update_push','session_pr_review_content_observe'];
 const target=model.call_targets.find(row=>row.model_id==='aidn-standard-pr-review-capture');
 const fixture={contract_version:'agentic-process-model.v2',model_id:'retained-merge-fixture',revision:1,participants:[{id:'project'}],roles:[],policies:[],entry:'root',
  nodes:[{id:'root',kind:'sequence',participant_ref:'project',children:[...names,'session_pr_review_capture']},
   ...names.map(id=>({id,kind:'operation',participant_ref:'project',binding_ref:id})),{id:'session_pr_review_capture',kind:'call',participant_ref:'project',target:{model_id:target.model_id,revision:target.revision,model_sha256:target.model_sha256}}],
  operation_pins:Object.fromEntries(standardWorkflowOperationBindings().filter(b=>names.includes(b.id)).map(b=>[b.id,H(b)])),call_targets:[target],
  data_bindings:{contract_version:'process-data-bindings.v4',parameter_keys:['entry_point'],inputs:[...names,'session_pr_review_capture'].map(node_id=>({node_id,fields:{}}))}};
 let instance=createAgenticProcess({instanceId:'original',scopeId:'fixture',model:fixture,policyPins:{},parameters:{entry_point:{kind:'retained_session_pr_open'}}});
 const records=[];
 for(const[index,name]of names.entries()){const next=accept(instance,name,index,{outcome:'completed',effect_status:index===1?'confirmed':'no_effect',facts:{}});instance=next.instance;records.push(next.record);}
 instance=enter(instance,records);return structuredClone({instance,records,entry});
}
await test('explicit entry provides routing only, with no review or merge authorization',()=>{
 assertRetainedExternalMergeEntry(entry);assertRetainedExternalMergeProof(proof);
 const output=selectStandardEntry(parameters,null,retainedExternalMergeContinuation(proof));assertStandardOperationOutput(output);
 assert.equal(output.facts.retained_external_merge_requested,true);assert.equal(output.facts.session_pr_merge_confirmed,undefined);
 assert.throws(()=>assertRetainedExternalMergeEntry({...entry,approved:true}));
 for(const field of ['lineage_sha256','provider_sha256','inherited_proof_sha256']){const p={...proof};delete p[field];assert.throws(()=>assertRetainedExternalMergeProof(p));}
});
await test('entry rechecks process CAS across source observation',async()=>{
 const record={instance_id:'current',instance_sha256:digest,initial_parameters:parameters};let revision=digest;
 const provider=createStandardOperationProvider({current:()=>({record:{...record,instance_sha256:revision}}),reviewEffects:new Map(),
  processAuthority:{retainedExternalMergeEntry:async()=>{revision='b'.repeat(64);return retainedExternalMergeContinuation(proof);}},fail:code=>{throw Object.assign(Error(code),{code});}});
 await assert.rejects(provider.operations.find(row=>row.binding.id==='workflow_entry_select').prepare({state:{record}}),{code:'STANDARD_ENTRY_PROCESS_CHANGED'});
});
await test('only settled review-wait prefix is admitted',()=>assert.equal(assertRetainedExternalMergeBoundary(boundary()).update.operation_id,updateId));
for(const[name,change]of Object.entries({extra:x=>x.records.push(x.records[0]),missing:x=>x.records.pop(),unaccepted:x=>x.instance.events.splice(-2,1),
 unknown:x=>x.records[3].results[0].output.effect_status='unknown',failed:x=>x.records[3].results[0].output.outcome='blocked',
 foreign:x=>x.records[2].intent.instance_id='foreign',scope:x=>x.records[2].intent.scope_id='other',order:x=>x.records.reverse(),
 retry:x=>x.records[3].results.push(x.records[3].results[0]),dispatching:x=>x.records[3].phase='dispatching',
 wrongEntry:x=>x.instance.initial_parameters.entry_point.kind='session',otherDelivery:x=>x.entry.update_operation_id='op_'+'c'.repeat(40),
 control:x=>x.instance.events.push({kind:'control'})}))await test(name+' prefix refuses',()=>{const f=boundary();change(f);assert.throws(()=>assertRetainedExternalMergeBoundary(f));});
await test('published route waits for actual provider event without delivery or Native replay',()=>{
 let instance=createAgenticProcess({instanceId:'successor',scopeId:'fixture',model,policyPins:agenticPolicyPins(model),parameters});
 const entryResult=accept(instance,'workflow_entry_select',0,selectStandardEntry(parameters,null,retainedExternalMergeContinuation(proof)));
 instance=enter(entryResult.instance,[entryResult.record]);instance=enter(instance,[entryResult.record]);
 const cursor=inspectAgenticProcess(instance),wait=cursor.occurrences.find(row=>row.node_id==='session_pr_review_wait');assert(wait);
 assert.equal(instance.events.filter(row=>row.kind==='operation_intent').length,1);assert.equal(instance.events.some(row=>row.kind==='assign'),false);
 const fakeUpdate={record:{operation_id:updateId,preview:{prepared:{plan:{prepared_at_ms:17}}},intent:{},results:[{}]},output:{facts:{session_pr_head_confirmed:true},effect_status:'no_effect',observations:{pull_request:{state:'OPEN',draft:false}}}};
 const source=createPretriageMergeSource({readAcceptedUpdate:(_state,id)=>{assert.equal(id,updateId);return fakeUpdate;},readRetainedDelivery:()=>fakeUpdate});
 assert.equal(source.readPretriageDelivery({record:instance,cursor},wait).notBefore,17);
 assert.equal(processFrameNode(model,wait).kind,'event');
});
await test('closed entry and output schemas validate',()=>{
 for(const name of ['standard-retained-external-merge-entry.v1','standard-retained-external-merge-proof.v1','standard-workflow-entry-selection-output.v13']){
  const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);
 }
});
const request={contract_version:'process-control-request.v1',scope_id:'fixture',instance_id:'capture',instance_sha256:digest,model_sha256:digest,instance_revision:1,
 occurrence_id:'root',correlation_id:'fixture:root',event_keys:['review_snapshot','external_merge_observed'],context_sha256:digest,branch:'S001-fixture',head:'1'.repeat(40)};
const payload={update_operation_id:updateId,source_sha256:digest,pre_merge_base_oid:'2'.repeat(40),provider:{contract_version:'github-pr-merge-observation.v1',
 repository:{node_id:'R_fixture',owner:'fixture',name:'repo'},observed_from:'2026-11-01T00:00:00Z',observed_until:'2026-11-01T00:00:01Z',
 pull_request:{node_id:'PR_fixture',number:1,head_repository_id:'R_fixture',head_ref:request.branch,head_oid:request.head,base_ref:'dev',observed_base_tip_oid:'3'.repeat(40),
  state:'MERGED',is_draft:false,merged:true,merged_at:'2026-11-01T00:00:00Z',merge_oid:'3'.repeat(40),merge_parent_oids:['2'.repeat(40),request.head]}}};
const claim=externalMergeControlClaim(request,payload),selection=H(externalMergeMaterial(payload));
await test('merge read and verification exceeding five seconds retain one verified capture',async()=>{
 const records=new Map(),signer=createOperationJournalSigner(()=>Buffer.alloc(32,7));let reads=0,verifications=0;
 const store={read:id=>({record:records.get(id)??null,content_sha256:null}),compareAndSwap:record=>records.set(record.inbox_id,record)};
 const inbox=createStandardControlInbox({store,signer,projectionRequired:false,source:{
  async readMerge({signal}){reads++;await delay(5100,null,{signal});return{source:claim,payload};},
  async verifyMerge({signal}){verifications++;await delay(5100,null,{signal});return{outcome:'verified',authority_id:claim.authority_id,source_sha256:H(claim)};}}});
 const capture=await inbox.reserveMerge(request,'aidn:external-merge',{expectedSubjectSha256:selection});
 assert.equal(capture.contract_version,'process-control-inbox.v3');assert.equal(reads,1);assert.equal(verifications,1);assert.equal(records.size,2);
});
for(const method of ['readMerge','verifyMerge'])await test(method+' deadline and cancellation leave no capture',async()=>{
 const originalTimer=globalThis.setTimeout;let observedSignal,writes=0,deadline;
 globalThis.setTimeout=(fn,ms,...args)=>{deadline=ms;return originalTimer(fn,0,...args);};
 const source={readMerge:async()=>({source:claim,payload}),verifyMerge:async()=>({outcome:'verified',authority_id:claim.authority_id,source_sha256:H(claim)}),
  [method]:({signal})=>{observedSignal=signal;return new Promise(()=>{});}};
 const inbox=createStandardControlInbox({source,signer:{},projectionRequired:false,store:{read:()=>({record:null}),compareAndSwap:()=>writes++}});
 try{await assert.rejects(inbox.reserveMerge(request,'aidn:external-merge',{expectedSubjectSha256:selection}),{code:'PROCESS_CONTROL_AUTHORITY_TIMEOUT'});
  assert.equal(deadline,60000);assert.equal(observedSignal.aborted,true);assert.equal(writes,0);
 }finally{globalThis.setTimeout=originalTimer;}
 const stop=new AbortController(),pending=inbox.reserveMerge(request,'aidn:external-merge',{expectedSubjectSha256:selection,signal:stop.signal});
 stop.abort();await assert.rejects(pending,{code:'PROCESS_CONTROL_AUTHORITY_ABORTED'});assert.equal(writes,0);
});
console.log(JSON.stringify({status:'PASS',checks,historical_live_source:'NOT_RUN',native_calls:0,p0:false}));
