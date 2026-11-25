import { createStandardPostMergeFastForward } from '../../src/application/runtime/standard-session-pr-post-merge-fast-forward.mjs';
import { assertRetainedPostMergeDecisionBoundary, assertRetainedPostMergeDecisionEntry, assertRetainedPostMergeDecisionProof, retainedPostMergeDecisionContinuation } from '../../src/core/workflow/standard-retained-post-merge-decision.mjs';
import { postMergeDecisionQuestion, postMergeDecisionOutput } from '../../src/core/workflow/standard-pr-post-merge-decision.mjs';
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
import { processFrameNode, processModelIdentity } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { assertRetainedMergeCaptureBoundary, assertRetainedMergeCaptureEntry, assertRetainedMergeCaptureProof, retainedMergeCaptureContinuation, retainedMergeCaptureSelection } from '../../src/core/workflow/standard-retained-merge-capture.mjs';
import { controlReservationId, controlInboxId, controlDelivery } from '../../src/core/workflow/process-control-inbox.mjs';
import { externalMergeQuestion } from '../../src/core/workflow/standard-pr-external-merge.mjs';
import { assertRetainedPostMergeBoundary, assertRetainedPostMergeEntry, assertRetainedPostMergeProof, retainedPostMergeContinuation } from '../../src/core/workflow/standard-retained-post-merge.mjs';
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
 instance=enter(entryResult.instance,[entryResult.record]);
 const selected=accept(instance,'session_pr_retained_merge_select',6,retainedMergeCaptureSelection(false));
 instance=enter(selected.instance,[entryResult.record,selected.record]);
 const cursor=inspectAgenticProcess(instance),wait=cursor.occurrences.find(row=>row.node_id==='session_pr_review_wait');assert(wait);
 assert.equal(instance.events.filter(row=>row.kind==='operation_intent').length,2);assert.equal(instance.events.some(row=>row.kind==='assign'),false);
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
function capturedBoundary() {
 // Frozen predecessor shape: one root entry, then the review wait. This is not
 // a migration of a live model or its receipts.
 const historical=structuredClone(model),target=historical.call_targets.find(t=>t.model_id==='aidn-standard-retained-external-merge');
 historical.call_targets=historical.call_targets.filter(t=>!['aidn-standard-pr-captured-merge-completion','aidn-standard-retained-post-merge','aidn-standard-recorded-post-merge'].includes(t.model_id));
 const added=new Set(['retained_pr_merge_entry','retained_pr_merge_select','retained_pr_merge_kind','retained_pr_captured_completion', 'retained_pr_post_merge', 'retained_pr_recorded_post_merge']);
 target.model.entry='retained_external_merge';target.model.nodes=target.model.nodes.filter(n=>!added.has(n.id));
 delete target.model.operation_pins.session_pr_retained_merge_select;
 target.model.data_bindings.inputs=target.model.data_bindings.inputs.filter(n=>!added.has(n.node_id));
 Object.assign(target,processModelIdentity(target.model));
 historical.nodes.find(n=>n.id==='retained_external_merge').target=processModelIdentity(target.model);
 let instance=createAgenticProcess({instanceId:'capture-owner',scopeId:'fixture',model:historical,policyPins:agenticPolicyPins(historical),parameters});
 const accepted=accept(instance,'workflow_entry_select',0,selectStandardEntry(parameters,null,retainedExternalMergeContinuation(proof)));
 const records=[accepted.record];instance=enter(accepted.instance,records);instance=enter(instance,records);
 const wait=inspectAgenticProcess(instance).occurrences.find(row=>row.node_id==='session_pr_review_wait');
 const req={...request,instance_id:instance.instance_id,instance_sha256:instance.instance_sha256,model_sha256:instance.model_sha256,
  instance_revision:instance.revision,occurrence_id:wait.occurrence_id};
 const source=externalMergeControlClaim(req,payload),signer=createOperationJournalSigner(()=>Buffer.alloc(32,7));
 const capture=signer.seal({contract_version:'process-control-inbox.v3',inbox_id:controlInboxId(source),source_ref:'aidn:external-merge',request:req,
  source,payload,delivery:controlDelivery(req,source),phase:'reserved',delivered_instance_sha256:null});
 const reservation=signer.seal({contract_version:'process-control-reservation.v1',inbox_id:controlReservationId(req),source_ref:capture.source_ref,
  request:req,capture_id:capture.inbox_id,selection_sha256:source.subject_sha256});
 return structuredClone({instance,records,capture,reservation,entry:{kind:'retained_external_merge_capture',
  original_configuration:entry.original_configuration,capture_id:capture.inbox_id},now:Date.parse(payload.provider.observed_until)+300000});
}
await test('expired reserved capture has one immutable settled entry and matching reservation',()=>{
 const f=capturedBoundary(),before=H(f);assertRetainedMergeCaptureBoundary(f);assert.equal(H(f),before);
});
for(const[name,change]of Object.entries({live:f=>f.now--,wrongCapture:f=>f.entry.capture_id='control_'+'f'.repeat(40),
 delivered:f=>{f.capture.phase='delivered';f.capture.delivered_instance_sha256=digest;},
 reservation:f=>f.reservation.selection_sha256='f'.repeat(64),foreignReservation:f=>f.reservation.request.instance_id='foreign',
 wrongRevision:f=>f.instance.revision++,changedInstance:f=>f.instance.instance_sha256='f'.repeat(64),
 unknown:f=>f.records[0].results[0].output.effect_status='unknown',unaccepted:f=>f.instance.events.splice(1,1),
 extraOperation:f=>f.records.push(f.records[0]),control:f=>f.instance.events.push({kind:'control'}),
 foreignEntry:f=>f.records[0].intent.scope_id='foreign',wrongEntry:f=>f.instance.initial_parameters.entry_point.kind='session',
 unsettled:f=>f.records[0].phase='dispatching',wrongSource:f=>f.capture.payload.source_sha256='f'.repeat(64)}))
 await test('capture recovery refuses '+name,()=>{const f=capturedBoundary();change(f);assert.throws(()=>assertRetainedMergeCaptureBoundary(f));});
await test('capture recovery routes directly to distinct Human subject without replaying provider event',()=>{
 const f=capturedBoundary(),p={...proof,capture_id:f.capture.inbox_id,capture_sha256:H(f.capture),reservation_sha256:H(f.reservation)};
 assertRetainedMergeCaptureEntry(f.entry);assertRetainedMergeCaptureProof(p);
 const params={...parameters,entry_point:f.entry};
 let instance=createAgenticProcess({instanceId:'capture-successor',scopeId:'fixture',model,policyPins:agenticPolicyPins(model),parameters:params});
 const accepted=accept(instance,'workflow_entry_select',0,selectStandardEntry(params,null,retainedMergeCaptureContinuation(p)));
 assertStandardOperationOutput(accepted.record.results[0].output);
 instance=enter(accepted.instance,[accepted.record]);
 const selected=accept(instance,'session_pr_retained_merge_select',6,retainedMergeCaptureSelection(true));
 instance=enter(selected.instance,[accepted.record,selected.record]);
 const cursor=inspectAgenticProcess(instance),frame=cursor.occurrences.find(row=>row.occurrence_id===cursor.ready[0]);
 assert.equal(frame.node_id,'pr_pretriage_external_disposition');
 assert.equal(instance.events.some(row=>row.kind==='control'||row.kind==='assign'),false);
 assert.equal(instance.events.filter(row=>row.kind==='operation_intent').length,2);
 const update={record:{operation_id:updateId,intent:{},results:[{}],preview:{prepared:{plan:{prepared_at_ms:17}}}},output:{observations:{pull_request:{base_oid:payload.pre_merge_base_oid}}}};
 const capture=structuredClone(f.capture);capture.payload.source_sha256=H({intent:update.record.intent,result:update.record.results[0]});
 capture.source=externalMergeControlClaim(capture.request,capture.payload);
 const source=createPretriageMergeSource({readRetainedCapture:()=>({capture,update,entry:{record:accepted.record}})});
 const input={contract_version:'standard-pr-external-merge-disposition-input.v3',entry_operation_id:accepted.record.operation_id};
 const current=source.readPretriage(instance,input,frame.occurrence_id);
 assert.equal(current.subject.capture_state,'reserved');assert.equal(current.subject.delivery_id,undefined);
 const record={operation_id:'op_'+'d'.repeat(40),intent:{instance_id:instance.instance_id,scope_id:instance.scope_id,occurrence_id:frame.occurrence_id},
  preview:{input,prepared:{prepared_at_ms:1000,expires_at_ms:301000,subject:current.subject}}};
 const question=externalMergeQuestion(record);assert.equal(question.contract_version,'standard-pr-external-merge-disposition-question.v3');
 assert.equal(question.subject.entry_receipt_sha256,H(accepted.record.results[0].receipt));
 assert.throws(()=>source.readPretriage(instance,{...input,entry_operation_id:updateId},frame.occurrence_id));
 const forged=structuredClone(record);forged.preview.prepared.subject.capture_state='delivered';assert.throws(()=>externalMergeQuestion(forged));
});
await test('capture recovery closed schemas reject invented authorization',()=>{
 const f=capturedBoundary();assert.throws(()=>assertRetainedMergeCaptureEntry({...f.entry,approved:true}));
 for(const name of ['standard-retained-merge-capture-entry.v1','standard-retained-merge-capture-proof.v1','standard-workflow-entry-selection-output.v14',
  'standard-retained-merge-capture-selection.v1','standard-pr-external-merge-disposition-input.v3','standard-pr-external-merge-disposition-question.v3']){
  const s=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(s,'#',{contractKind:'workflow-definition'}),[]);
 }
});
function postMergeBoundary() {
 const f=capturedBoundary(),p={...proof,capture_id:f.capture.inbox_id,capture_sha256:H(f.capture),reservation_sha256:H(f.reservation)};
 let instance=createAgenticProcess({instanceId:'post-owner',scopeId:'fixture',model,policyPins:agenticPolicyPins(model),parameters:{...parameters,entry_point:f.entry}});
 const records=[];
 const take=(binding,output,input={})=>{const next=accept(instance,binding,records.length,output);instance=next.instance;next.record.preview.input=input;records.push(next.record);};
 take('workflow_entry_select',selectStandardEntry({...parameters,entry_point:f.entry},null,retainedMergeCaptureContinuation(p)));
 instance=enter(instance,records);
 take('session_pr_retained_merge_select',retainedMergeCaptureSelection(true));
 instance=enter(instance,records);
 const output=(observations={},facts={},effect_status='no_effect')=>({outcome:'completed',effect_status,observations,facts});
 take('session_pr_external_merge_disposition',output({choice:'acknowledge_external_merge_for_r09',severity:'L1_LOW'}));
 take('session_pr_merge_basis',output({merge_operation_id:records[2].operation_id},{session_pr_incident_tracking_required:false}));
 take('session_pr_post_merge_fetch',output({}, {}, 'confirmed'),{merge_operation_id:records[2].operation_id});
 take('session_pr_post_merge_measure',output({}, {session_pr_post_merge_diverged:true}),{fetch_operation_id:records[4].operation_id});
 return structuredClone({instance,records,entry:{kind:'retained_post_merge',original_configuration:entry.original_configuration,fetch_operation_id:records[4].operation_id}});
}
await test('settled R09 prefix preserves accepted disposition and one physical fetch',()=>{
 const f=postMergeBoundary(),before=H(f);assertRetainedPostMergeBoundary(f);assert.equal(H(f),before);
});
for(const[name,change]of Object.entries({unknown:f=>f.records[4].results[0].output.effect_status='unknown',
 unaccepted:f=>f.instance.events.splice(f.instance.events.findIndex(r=>r.kind==='operation_result'&&r.receipt.operation_id===f.records[4].operation_id),1),
 extra:f=>f.records.push(f.records[0]),retry:f=>f.records[4].results.push(f.records[4].results[0]),
 foreign:f=>f.records[2].intent.instance_id='foreign',fetch:f=>f.entry.fetch_operation_id=updateId,
 noDecision:f=>f.records[2].results[0].output.observations.choice='refused',majorIncident:f=>f.records[2].results[0].output.observations.severity='L2_MEDIUM',
 reordered:f=>f.records.reverse(),dispatching:f=>f.records[4].phase='dispatching',wrongSource:f=>f.instance.initial_parameters.entry_point.kind='session'}))
 await test('R09 prefix refuses '+name,()=>{const f=postMergeBoundary();change(f);assert.throws(()=>assertRetainedPostMergeBoundary(f));});
await test('published R09 continuation starts with fresh measurement and no repeated fetch or question',()=>{
 const f=postMergeBoundary(),p={...proof,opening_operation_id:'op_'+'c'.repeat(40),opening_receipt_sha256:digest,
  disposition_operation_id:f.records[2].operation_id,decision_material_sha256:digest,fetch_operation_id:f.entry.fetch_operation_id,fetch_receipt_sha256:digest};
 assertRetainedPostMergeEntry(f.entry);assertRetainedPostMergeProof(p);
 const params={...parameters,entry_point:f.entry};
 let instance=createAgenticProcess({instanceId:'r09-successor',scopeId:'fixture',model,policyPins:agenticPolicyPins(model),parameters:params});
 const first=accept(instance,'workflow_entry_select',0,selectStandardEntry(params,null,retainedPostMergeContinuation(p)));
 assertStandardOperationOutput(first.record.results[0].output);
 instance=enter(first.instance,[first.record]);
 const selection=accept(instance,'session_pr_retained_merge_select',1,retainedMergeCaptureSelection(false,f.entry.fetch_operation_id));
 assertStandardOperationOutput(selection.record.results[0].output);
 instance=enter(selection.instance,[first.record,selection.record]);
 const cursor=inspectAgenticProcess(instance),frame=cursor.occurrences.find(r=>r.occurrence_id===cursor.ready[0]);
 assert.equal(frame.node_id,'pr_post_merge_measure');
 assert.equal(instance.events.filter(r=>r.kind==='operation_intent').length,2);
 assert.equal(instance.events.some(r=>r.kind==='control'||r.kind==='assign'),false);
 assert.throws(()=>assertRetainedPostMergeEntry({...f.entry,approved:true}));
 for(const key of ['opening_receipt_sha256','decision_material_sha256','fetch_receipt_sha256']){const changed={...p};delete changed[key];assert.throws(()=>assertRetainedPostMergeProof(changed));}
 for(const name of ['standard-retained-post-merge-entry.v1','standard-retained-post-merge-proof.v1','standard-workflow-entry-selection-output.v15','standard-retained-merge-capture-selection.v2']){
  const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);
 }
});

function recordedDecisionBoundary() {
 const base=postMergeBoundary(),p={...proof,opening_operation_id:'op_'+'c'.repeat(40),opening_receipt_sha256:digest,
  disposition_operation_id:base.records[2].operation_id,decision_material_sha256:digest,fetch_operation_id:base.entry.fetch_operation_id,fetch_receipt_sha256:digest};
 const params={...parameters,entry_point:base.entry};
 let instance=createAgenticProcess({instanceId:'recorded-owner',scopeId:'fixture',model,policyPins:agenticPolicyPins(model),parameters:params});
 const records=[];const take=(binding,output)=>{const next=accept(instance,binding,records.length,output);instance=next.instance;records.push(next.record);};
 take('workflow_entry_select',selectStandardEntry(params,null,retainedPostMergeContinuation(p)));instance=enter(instance,records);
 take('session_pr_retained_merge_select',retainedMergeCaptureSelection(false,base.entry.fetch_operation_id));instance=enter(instance,records);
 take('session_pr_post_merge_measure',{outcome:'completed',effect_status:'no_effect',facts:{session_pr_post_merge_diverged:true}});
 const staged=accept(instance,'session_pr_post_merge_decision',3,{outcome:'completed',effect_status:'no_effect',facts:{session_pr_post_merge_fast_forward:true}}),record=staged.record;
 instance=advanceAgenticProcess(instance,{event_id:'intent-3',kind:'operation_intent',occurrence_id:record.intent.occurrence_id,intent:record.intent});
 record.preview={input:{measurement_operation_id:records[2].operation_id,allow_fast_forward:true},prepared:{prepared_at_ms:1,expires_at_ms:300001,fast_forward_offered:true,subject:{
  project_scope_sha256:digest,session_id:'S001',opening_operation_id:p.opening_operation_id,measurement_operation_id:records[2].operation_id,measurement_receipt_sha256:H(records[2].results[0].receipt),merge_operation_id:p.disposition_operation_id,merge_receipt_sha256:digest,
  repository_id:'R_fixture',pull_request_id:'PR_fixture',pull_request_number:1,head_oid:'1'.repeat(40),head_ref:'session',alignment:{source_ref:'refs/heads/dev',local_head:'2'.repeat(40),remote_head:'3'.repeat(40),fetched_head:'3'.repeat(40),merge_oid:'3'.repeat(40),proof_ref:'refs/aidn/post-merge/'+'a'.repeat(32),ahead:0,behind:2,fetch_operation_id:base.entry.fetch_operation_id,fetch_receipt_sha256:digest}}}};
 const q=postMergeDecisionQuestion(record),claim={contract_version:'human-pr-post-merge-decision.v1',source_kind:'human',authority_id:'fixture',source_event_id:'fixture-answer',question_sha256:H(q),subject_sha256:H(q.subject),choice:'fast_forward',rationale:'Advance exactly these tips',evidence_refs:[{ref:'fixture:chat',sha256:digest}]};
 const capture={source:claim,inbox_id:'decision_'+'d'.repeat(40),source_ref:'fixture-answer'};
 const output=postMergeDecisionOutput(q,capture,true);record.results[0].output=output;record.results[0].receipt.output_sha256=H(output);record.decision_claim_sha256=H({source_ref:capture.source_ref,source:claim});records.push(record);
 return structuredClone({instance,records,proof:p,entry:{kind:'retained_post_merge_decision',original_configuration:entry.original_configuration,decision_operation_id:record.operation_id}});
}
await test('recorded R09 choice admits an immutable unaccepted no-effect receipt',()=>{
 const f=recordedDecisionBoundary(),before=H(f);assertRetainedPostMergeDecisionEntry(f.entry);assertRetainedPostMergeDecisionBoundary(f);assert.equal(H(f),before);
});
for(const[name,change]of Object.entries({unknown:f=>f.records.at(-1).results[0].receipt.effect_status='unknown',
 missingReceipt:f=>f.records.at(-1).results=[],dispatching:f=>f.records.at(-1).phase='dispatching',extra:f=>f.records.push(f.records.at(-1)),
 foreign:f=>f.records.at(-1).intent.instance_id='foreign',wrongDecision:f=>f.entry.decision_operation_id='op_'+'f'.repeat(40),
 noClaim:f=>delete f.records.at(-1).decision_claim_sha256,changedOutput:f=>f.records.at(-1).results[0].output.observations.choice='refused',
 changedMeasurement:f=>f.records.at(-1).preview.input.measurement_operation_id=updateId,unacceptedPrefix:f=>f.instance.events.splice(f.instance.events.findIndex(e=>e.kind==='operation_result'),1)}))
 await test('recorded R09 boundary refuses '+name,()=>{const f=recordedDecisionBoundary();change(f);assert.throws(()=>assertRetainedPostMergeDecisionBoundary(f));});
await test('published recorded choice starts with fast-forward, then the existing R09 suffix',()=>{
 const f=recordedDecisionBoundary(),q=postMergeDecisionQuestion(f.records.at(-1)),p={...f.proof,recorded_decision_operation_id:f.entry.decision_operation_id,recorded_decision_receipt_sha256:H(f.records.at(-1).results[0].receipt),recorded_question_sha256:H(q),recorded_decision_material_sha256:digest};
 assertRetainedPostMergeDecisionProof(p);const params={...parameters,entry_point:f.entry};
 let instance=createAgenticProcess({instanceId:'recorded-successor',scopeId:'fixture',model,policyPins:agenticPolicyPins(model),parameters:params});
 const first=accept(instance,'workflow_entry_select',0,selectStandardEntry(params,null,retainedPostMergeDecisionContinuation(p)));assertStandardOperationOutput(first.record.results[0].output);instance=enter(first.instance,[first.record]);
 const next=accept(instance,'session_pr_retained_merge_select',1,retainedMergeCaptureSelection(false,p.fetch_operation_id,p.recorded_decision_operation_id));assertStandardOperationOutput(next.record.results[0].output);instance=enter(next.instance,[first.record,next.record]);
 const cursor=inspectAgenticProcess(instance);assert.equal(cursor.occurrences.find(r=>r.occurrence_id===cursor.ready[0]).node_id,'recorded_post_merge_fast_forward');
 assert.equal(instance.events.some(e=>e.kind==='assign'||e.kind==='control'),false);
 for(const name of ['standard-retained-post-merge-decision-entry.v1','standard-retained-post-merge-decision-proof.v1','standard-workflow-entry-selection-output.v16','standard-retained-merge-capture-selection.v3']){const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);}
 assert.throws(()=>assertRetainedPostMergeDecisionEntry({...f.entry,renew_expiry:true}));
});


for (const kind of ['ordinary_expired','recorded_revoked','recorded_valid']) await test('fast-forward source fence '+kind,async()=>{
 const f=recordedDecisionBoundary(),record=f.records.at(-1),selected={record,output:record.results[0].output},question=postMergeDecisionQuestion(record),a=question.subject.alignment;
 let gitPreparations=0,verifications=0;const error=code=>Object.assign(Error(code),{code});
 const service=createStandardPostMergeFastForward({
  readAccepted:()=>selected,readCurrent:()=>f.instance,
  ...(kind.startsWith('recorded_')?{readRetainedDecision:()=>({...selected,verify:async()=>{verifications++;if(kind==='recorded_revoked')throw error('RECORDED_SOURCE_REVOKED');}})}:{}),
  postMerge:{alignmentSource:()=>({receiptSha:a.fetch_receipt_sha256,fetch:{...a,merge_operation_id:question.subject.merge_operation_id,merge_receipt_sha256:question.subject.merge_receipt_sha256}})},
  decision:{assertAge(){throw error('ORDINARY_QUESTION_EXPIRED');}},
  reviewPort:{postMergeFetch:{async prepareFastForward(){gitPreparations++;throw error('CHECKED_GIT_PLAN_REACHED');},applyFastForward(){throw Error('unexpected write');},recoverFastForward(){throw Error('unexpected recovery');}}}
 });
 await assert.rejects(service.prepare(f.instance,{decision_operation_id:record.operation_id},'op_'+'e'.repeat(40)),{code:kind==='ordinary_expired'?'ORDINARY_QUESTION_EXPIRED':kind==='recorded_revoked'?'RECORDED_SOURCE_REVOKED':'CHECKED_GIT_PLAN_REACHED'});
 assert.equal(gitPreparations,kind==='recorded_valid'?1:0);assert.equal(verifications,kind.startsWith('recorded_')?1:0);
});

console.log(JSON.stringify({status:'PASS',checks,historical_live_source:'NOT_RUN',native_calls:0,p0:false}));
