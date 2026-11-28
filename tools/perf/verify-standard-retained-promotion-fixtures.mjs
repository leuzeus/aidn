import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertRetainedPromotionEntry, assertRetainedPromotionProof, retainedPromotionContinuation } from '../../src/core/workflow/standard-retained-promotion.mjs';
import { selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
const sha='a'.repeat(64),op=c=>'op_'+c.repeat(40),read=name=>JSON.parse(fs.readFileSync(new URL('../../'+name,import.meta.url)));
const schema=read('src/core/contracts/workflow-definition/standard-retained-promotion-proof.v1.schema.json');
const proof=Object.fromEntries(schema.required.map(n=>[n,n.endsWith('_operation_id')?op('a'):sha]));
Object.assign(proof,{original_instance_id:'original',session_id:'S001',cycle_id:'C001',cycle_path:'cycles/C001-feature-fixture',record_operation_id:op('b')});
const entry={kind:'retained_promotion',failed_finalization_operation_id:proof.failed_finalization_operation_id,original_configuration:{path:'neutral-origin.json',sha256:sha}};
const parameters={entry_point:entry,session:{session_id:'S001'},cycle:{cycle_id:'C001'}};
let checks=0;const test=(name,run)=>{run();checks++;console.log('PASS '+name);};
test('recorded promotion entry preserves provenance without inventing a decision or effect',()=>{
  assertRetainedPromotionEntry(entry);assertRetainedPromotionProof(proof);
  const output=selectStandardEntry(parameters,null,retainedPromotionContinuation(proof));assertStandardOperationOutput(output);
  assert.equal(output.facts.retained_promotion_requested,true);assert.equal(output.facts.baseline_promotion_completed,undefined);
  assert.equal(output.facts.baseline_promotion_requested,undefined);assert.equal(output.effect_status,'no_effect');
});
for(const field of ['question_sha256','native_journal_sha256','checkpoint_operation_id','evaluation_output_sha256','failed_finalization_operation_id'])
  test('missing '+field+' refuses',()=>{const value=structuredClone(proof);delete value[field];assert.throws(()=>assertRetainedPromotionProof(value));});
test('foreign cycle and caller permission refuse',()=>{
  assert.throws(()=>assertRetainedPromotionProof({...proof,cycle_path:'cycles/C002-other'}));
  assert.throws(()=>assertRetainedPromotionEntry({...entry,authorized:true}));
  assert.throws(()=>selectStandardEntry(parameters,null,{...retainedPromotionContinuation(proof),failed_finalization_operation_id:op('c')}));
});
test('actual reducer skips recorded promotion and Native work and reaches preclose through the new call',()=>{
  const model=read('package/catalogs/process-models/aidn-standard.v1.json'),bindings=standardWorkflowOperationBindings(),journals=new Map(),visited=[];
  let state=createAgenticProcess({instanceId:'promotion-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters}),serial=0,entryId;
  const emit=e=>{state=advanceAgenticProcess(state,{event_id:'event-'+ ++serial,...e});};
  for(let i=0;i<12;i++){
    const cursor=inspectAgenticProcess(state),call=cursor.occurrences.find(r=>r.status==='WAITING'&&['call_entry','call_return'].includes(r.wait_reason));
    if(call){const entering=call.wait_reason==='call_entry',data=resolveProcessCallData({instance:state,cursor,occurrenceId:call.occurrence_id,returning:!entering,readOperation:id=>journals.get(id)});emit({kind:entering?'call_enter':'call_return',occurrence_id:call.occurrence_id,...data});continue;}
    const frame=cursor.occurrences.find(r=>r.status==='READY');assert(frame);const node=processFrameNode(model,frame);assert.equal(node.kind,'operation');
    const input=resolveProcessOperationInput({instance:state,occurrenceId:frame.occurrence_id,readOperation:id=>journals.get(id)}).input;
    if(node.binding_ref==='session_preclose_checkpoint'){assert.equal(input.closure_operation_id,op('c'));break;}
    visited.push(node.binding_ref);let output;
    if(node.binding_ref==='workflow_entry_select') output=selectStandardEntry(parameters,null,retainedPromotionContinuation(proof));
    else if(node.binding_ref==='cycle_close_completed_select') output={facts:{},observations:{closure_operation_id:op('c'),terminal_checkpoint_operation_id:op('d'),receipt_sha256:sha,output_sha256:sha}};
    else if(node.binding_ref==='drift_check_finalize'){assert.equal(input.evaluation_operation_id,entryId);output={facts:{drift_check_completed:true},observations:{}};}
    else {assert.equal(node.binding_ref,'baseline_promotion_finalize');assert.equal(input.record_operation_id,proof.record_operation_id);output={facts:{baseline_promotion_completed:true},observations:{}};}
    const id=op(String(visited.length)),binding=bindings.find(b=>b.id===node.binding_ref);
    if(node.binding_ref==='workflow_entry_select')entryId=id;
    const intent={contract_version:'process-operation-intent.v1',operation_id:id,binding_ref:binding.id,binding_sha256:H(binding),input_sha256:H(input),preconditions_sha256:sha,authorization_sha256:null,
      authority_id:'fixture',scope_id:state.scope_id,instance_id:state.instance_id,instance_sha256:state.instance_sha256,model_sha256:state.model_sha256,occurrence_id:frame.occurrence_id,instance_revision:state.revision};
    emit({kind:'operation_intent',occurrence_id:frame.occurrence_id,intent});
    const receipt={contract_version:'process-operation-receipt.v1',receipt_id:'receipt-'+serial,operation_id:id,intent_sha256:H(intent),authority_id:'fixture',outcome:'completed',effect_status:'no_effect',output_sha256:H(output),facts:output.facts,evidence_refs:[{ref:'fixture:routing',sha256:H(output)}]};
    journals.set(id,{operation_id:id,phase:'receipted',intent,preview:{input},results:[{receipt,output}]});emit({kind:'operation_result',occurrence_id:frame.occurrence_id,receipt});
  }
  assert.deepEqual(visited,['workflow_entry_select','cycle_close_completed_select','drift_check_finalize','baseline_promotion_finalize']);
  const cursor=inspectAgenticProcess(state);assert.equal(processFrameNode(model,cursor.occurrences.find(r=>r.status==='READY')).binding_ref,'session_preclose_checkpoint');
  assert(model.nodes.length<=288);
});
test('closed new contracts use supported vocabulary and keep original v6 separately readable',()=>{
  for(const name of ['standard-retained-promotion-entry.v1','standard-retained-promotion-proof.v1','standard-workflow-entry-selection-output.v7','standard-baseline-promotion-hook-plan.v2'])
    assert.deepEqual(validateJsonSchemaDefinition(read('src/core/contracts/workflow-definition/'+name+'.schema.json'),'#',{contractKind:'workflow-definition'}),[]);
  assert.equal(read('src/core/contracts/workflow-definition/standard-workflow-entry-selection-output.v6.schema.json')['x-aidn-contract-version'],'standard-workflow-entry-selection-output.v6');
});
// The original session/checkpoint origin is explicit and cannot masquerade as
// the v1 finalization-only origin with an already accepted Native evaluation.
const proofV2Schema=read('src/core/contracts/workflow-definition/standard-retained-promotion-proof.v2.schema.json');
const proofV2=Object.fromEntries(proofV2Schema.required.map(key=>[key,key.endsWith('_operation_id')?op('a'):sha]));
Object.assign(proofV2,{version:2,original_instance_id:'original-session',session_id:'S001',cycle_id:'C001',cycle_path:'cycles/C001-feature-fixture',record_operation_id:op('b'),native_dispatch_id:'native_dispatch_'+'a'.repeat(40),native_generation:6,new_native_required:true,accounting_reconciled:false});
const entryV2={kind:'retained_promotion',version:2,original_configuration:entry.original_configuration,original_instance_sha256:sha,checkpoint_operation_id:proofV2.checkpoint_operation_id,native_dispatch_id:proofV2.native_dispatch_id,native_generation:6,native_owner_disposition_sha256:sha,native_assessment:{path:'neutral-assessment.json',sha256:sha}};
const parametersV2={entry_point:entryV2,session:{session_id:'S001'},cycle:{cycle_id:'C001'}};
test('checkpointed promotion selects a new R05 without granting execution or reconciling old accounting',()=>{
 assertRetainedPromotionEntry(entryV2);assertRetainedPromotionProof(proofV2);
 const output=selectStandardEntry(parametersV2,null,retainedPromotionContinuation(proofV2));assertStandardOperationOutput(output);
 assert.equal(output.facts.retained_promotion_refresh_required,true);assert.equal(output.facts.mode_committing,true);
 assert.equal(output.facts.baseline_promotion_requested,undefined);assert.equal(output.effect_status,'no_effect');
 for(const value of [false,undefined]) {const changed=structuredClone(output);changed.facts.retained_promotion_refresh_required=value;if(value===undefined)delete changed.facts.retained_promotion_refresh_required;assert.throws(()=>assertStandardOperationOutput(changed));}
});
for(const field of ['native_assessment','native_generation','native_owner_disposition_sha256','original_instance_sha256','checkpoint_operation_id'])
 test('checkpointed entry requires '+field,()=>{const changed=structuredClone(entryV2);delete changed[field];assert.throws(()=>assertRetainedPromotionEntry(changed));});
for(const [field,value] of [['accounting_reconciled',true],['new_native_required',false],['native_generation',0],['cycle_path','cycles/C002-other'],['evaluation_operation_id',op('d')]])
 test('checkpointed proof refuses unsupported '+field,()=>assert.throws(()=>assertRetainedPromotionProof({...proofV2,[field]:value})));
test('checkpoint and dispatch identities cannot be swapped in entry routing',()=>{
 for(const change of [{checkpoint_operation_id:op('f')},{native_dispatch_id:'native_dispatch_'+'b'.repeat(40)},{version:1}])
  assert.throws(()=>selectStandardEntry(parametersV2,null,{...retainedPromotionContinuation(proofV2),...change}));
 assert.throws(()=>assertRetainedPromotionEntry({...entryV2,failed_finalization_operation_id:op('d')}));
});
test('actual reducer reaches only the fresh read-only R05 after two deterministic selections',()=>{
 const model=read('package/catalogs/process-models/aidn-standard.v1.json'),bindings=standardWorkflowOperationBindings(),journals=new Map(),visited=[];
 let state=createAgenticProcess({instanceId:'checkpointed-promotion-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters:parametersV2}),serial=0;
 for(let i=0;i<8;i++){
  const cursor=inspectAgenticProcess(state),frame=cursor.occurrences.find(row=>row.status==='READY');assert(frame);
  const node=processFrameNode(model,frame);
  if(node.kind==='activity'){
   assert.equal(node.id,'retained_promotion_drift_report');assert.equal(node.role_ref,'drift_auditor');assert.equal(node.policy_ref,'drift');
   assert.deepEqual(model.policies.find(row=>row.id==='drift').allowed_permissions,['read:product']);
   const evaluation=model.data_bindings.inputs.find(row=>row.node_id==='retained_promotion_drift_evaluate');
   assert.deepEqual(evaluation.fields.report_occurrence_id,{source:'occurrence_id',node_id:node.id});break;
  }
  assert.equal(node.kind,'operation');visited.push(node.binding_ref);
  const input=resolveProcessOperationInput({instance:state,occurrenceId:frame.occurrence_id,readOperation:id=>journals.get(id)}).input;
  let output;if(node.binding_ref==='workflow_entry_select')output=selectStandardEntry(parametersV2,null,retainedPromotionContinuation(proofV2));
  else {assert.equal(node.binding_ref,'cycle_close_completed_select');output={facts:{},observations:{closure_operation_id:op('c'),terminal_checkpoint_operation_id:op('d'),receipt_sha256:sha,output_sha256:sha}};}
  const id=op(String(visited.length)),binding=bindings.find(b=>b.id===node.binding_ref),intent={contract_version:'process-operation-intent.v1',operation_id:id,binding_ref:binding.id,binding_sha256:H(binding),input_sha256:H(input),preconditions_sha256:sha,authorization_sha256:null,authority_id:'fixture',scope_id:state.scope_id,instance_id:state.instance_id,instance_sha256:state.instance_sha256,model_sha256:state.model_sha256,occurrence_id:frame.occurrence_id,instance_revision:state.revision};
  state=advanceAgenticProcess(state,{event_id:'event-'+ ++serial,kind:'operation_intent',occurrence_id:frame.occurrence_id,intent});
  const receipt={contract_version:'process-operation-receipt.v1',receipt_id:'receipt-'+serial,operation_id:id,intent_sha256:H(intent),authority_id:'fixture',outcome:'completed',effect_status:'no_effect',output_sha256:H(output),facts:output.facts,evidence_refs:[{ref:'fixture:routing',sha256:H(output)}]};
  journals.set(id,{operation_id:id,phase:'receipted',intent,preview:{input},results:[{receipt,output}]});state=advanceAgenticProcess(state,{event_id:'event-'+ ++serial,kind:'operation_result',occurrence_id:frame.occurrence_id,receipt});
 }
 assert.deepEqual(visited,['workflow_entry_select','cycle_close_completed_select']);assert.equal(state.events.length,4);
 assert.equal(processFrameNode(model,inspectAgenticProcess(state).occurrences.find(row=>row.status==='READY')).id,'retained_promotion_drift_report');
});
test('checkpointed and historical catalogue/entry versions retain closed independent contracts',()=>{
 for(const name of ['standard-retained-promotion-entry.v2','standard-retained-promotion-proof.v2','standard-workflow-entry-selection-output.v18','standard-workflow-catalog.v8'])
  assert.deepEqual(validateJsonSchemaDefinition(read('src/core/contracts/workflow-definition/'+name+'.schema.json'),'#',{contractKind:'workflow-definition'}),[]);
 assert.equal(read('src/core/contracts/workflow-definition/standard-workflow-catalog.v7.schema.json').properties.bindings.maxItems,256);
});
console.log(JSON.stringify({status:'PASS',checks,proof:'closed-contracts-and-actual-reducer-with-synthetic-receipts',human:'NOT_RUN',native:'NOT_RUN',business_effects:0,public_entry:'NOT_RUN'}));
