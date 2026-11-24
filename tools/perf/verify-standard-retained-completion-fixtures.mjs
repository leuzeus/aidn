import assert from 'node:assert/strict';
import './verify-standard-retained-objective-fixtures.mjs';
import './verify-standard-retained-promotion-fixtures.mjs';
import fs from 'node:fs';
import { assertRetainedCompletionEntry, assertRetainedCompletionProof, retainedCompletionContinuation } from '../../src/core/workflow/standard-retained-completion.mjs';
import { standardEntryPoint, selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
const sha='a'.repeat(64),op=n=>'op_'+n.repeat(40),closureId=op('1'),checkpointId=op('2');
const entry={kind:'retained_completion',closure_operation_id:closureId,original_configuration:{path:'neutral-origin.json',sha256:sha}};
const proof={original_instance_id:'original',original_instance_sha256:sha,original_configuration_sha256:sha,journals_sha256:sha,native_journal_sha256:sha,
  closure_operation_id:closureId,closure_output_sha256:sha,terminal_operation_id:op('3'),checkpoint_operation_id:checkpointId,question_sha256:sha,
  retained_closure_proof_sha256:sha,session_id:'S001',cycle_id:'C001',cycle_path:'cycles/C001-feature-fixture',product_sha256:sha};
const parameters={entry_point:entry,session:{session_id:'S001'},cycle:{cycle_id:'C001'}};
let checks=0;const test=async(name,run)=>{await run();checks++;console.log('PASS '+name);};
await test('completed entry has closed historical provenance and grants no promotion',()=>{
  assertRetainedCompletionEntry(entry);assertRetainedCompletionProof(proof);assert.equal(standardEntryPoint(parameters),'retained_completion');
  const out=selectStandardEntry(parameters,null,retainedCompletionContinuation(proof));assertStandardOperationOutput(out);
  assert.equal(out.facts.retained_completion_requested,true);assert.equal(out.facts.baseline_promotion_requested,undefined);
  assert.equal(out.facts.cycle_close_completed,undefined);assert.equal(out.observations.admission,null);
});
for(const [name,change]of [['missing original question',p=>delete p.question_sha256],['missing Native provenance',p=>delete p.native_journal_sha256],
  ['foreign cycle path',p=>p.cycle_path='../elsewhere'],['caller permission',p=>p.authorized=true]])
  await test(name+' refuses',()=>{const next=structuredClone(proof);change(next);assert.throws(()=>assertRetainedCompletionProof(next));});
await test('an entry cannot add a Human answer or select a different completed closure',()=>{
  assert.throws(()=>assertRetainedCompletionEntry({...entry,choice:'promote'}));
  assert.throws(()=>selectStandardEntry(parameters,null,{...retainedCompletionContinuation(proof),closure_operation_id:checkpointId}));
  assert.throws(()=>selectStandardEntry(parameters,{outcome:'completed'},retainedCompletionContinuation(proof)));
});
await test('provider uses the completion reader without pretending the DONE cycle is resumable work',async()=>{
  const record={instance_id:'current',instance_sha256:sha,initial_parameters:parameters};let current=sha,calls=0;
  const provider=createStandardOperationProvider({current:()=>({record:{...record,instance_sha256:current}}),operations:{admitCycleEntry:()=>{throw Error('UNEXPECTED_WORK_RESUME');}},
    retainedCompletionEntry:async()=>{calls++;return retainedCompletionContinuation(proof);},reviewEffects:new Map(),processAuthority:{},fail:code=>{throw Object.assign(Error(code),{code});}});
  const selected=provider.operations.find(row=>row.binding.id==='workflow_entry_select');
  assert.equal((await selected.prepare({state:{record}})).facts.retained_completion_requested,true);assert.equal(calls,1);
  current='b'.repeat(64);await assert.rejects(selected.prepare({state:{record}}),{code:'STANDARD_ENTRY_PROCESS_CHANGED'});
});
await test('published route reaches promotion after two readers without repeating closure or Native',()=>{
  const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url))),bindings=standardWorkflowOperationBindings(),records=new Map();
  let state=createAgenticProcess({instanceId:'completion-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters});
  function ready(){const cursor=inspectAgenticProcess(state),id=cursor.ready[0];return {id,node:processFrameNode(model,cursor.occurrences.find(row=>row.occurrence_id===id))};}
  let serial=0;
  function accept(expected,output){const row=ready();assert.equal(row.node.binding_ref,expected);const binding=bindings.find(b=>b.id===expected),id=op(String(++serial+3));
    const intent={contract_version:'process-operation-intent.v1',operation_id:id,binding_ref:expected,binding_sha256:H(binding),input_sha256:H({}),preconditions_sha256:sha,authorization_sha256:null,
      authority_id:'fixture',scope_id:state.scope_id,instance_id:state.instance_id,instance_sha256:state.instance_sha256,model_sha256:state.model_sha256,occurrence_id:row.id,instance_revision:state.revision};
    state=advanceAgenticProcess(state,{event_id:'intent'+serial,kind:'operation_intent',occurrence_id:row.id,intent});
    const receipt={contract_version:'process-operation-receipt.v1',receipt_id:'receipt'+serial,operation_id:id,intent_sha256:H(intent),authority_id:'fixture',outcome:'completed',effect_status:'no_effect',output_sha256:H(output),facts:output.facts,evidence_refs:[{ref:'fixture:reader',sha256:H(output)}]};
    state=advanceAgenticProcess(state,{event_id:'result'+serial,kind:'operation_result',occurrence_id:row.id,receipt});records.set(id,{phase:'receipted',intent,preview:{input:{}},results:[{receipt,output}]});
  }
  accept('workflow_entry_select',selectStandardEntry(parameters,null,retainedCompletionContinuation(proof)));
  const selected={contract_version:'standard-cycle-close-selection-output.v2',operation_ref:'cycle_close_completed_select',outcome:'completed',effect_status:'no_effect',facts:{},evidence_refs:[],
    observations:{closure_operation_id:closureId,terminal_checkpoint_operation_id:checkpointId,receipt_sha256:sha,output_sha256:sha}};assertStandardOperationOutput(selected);accept('cycle_close_completed_select',selected);
  const next=ready();assert.equal(next.node.binding_ref,'baseline_promotion_decision');
  assert.equal(resolveProcessOperationInput({instance:state,occurrenceId:next.id,readOperation:id=>records.get(id)}).input.closure_operation_id,closureId);
  assert.equal(state.events.length,4);assert(model.nodes.length<=288);
});
await test('new schemas retain the closed supported vocabulary',()=>{
  for(const name of ['standard-retained-completion-entry.v1','standard-retained-completion-proof.v1','standard-workflow-entry-selection-output.v6','standard-cycle-close-selection-output.v2'])
    assert.deepEqual(validateJsonSchemaDefinition(JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url))),'#',{contractKind:'workflow-definition'}),[]);
});
console.log(JSON.stringify({status:'PASS',checks,proof:'completed-cycle-entry-and-published-routing',original_source:'NOT_RUN',public_entry:'NOT_RUN',native_calls:0,p0:false}));
