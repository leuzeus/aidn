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
console.log(JSON.stringify({status:'PASS',checks,proof:'closed-contracts-and-actual-reducer-with-synthetic-receipts',human:'NOT_RUN',native:'NOT_RUN',business_effects:0,public_entry:'NOT_RUN'}));
