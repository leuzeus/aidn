import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertRetainedSessionClosureEntry, assertRetainedSessionClosureProof, retainedSessionClosureContinuation } from '../../src/core/workflow/standard-retained-session-closure.mjs';
import { selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import './verify-accepted-session-closure-boundary-fixtures.mjs';

const digest='a'.repeat(64), decisionId='op_'+'1'.repeat(40), entryId='op_'+'2'.repeat(40);
const entry={kind:'retained_session_closure',decision_operation_id:decisionId,original_configuration:{path:'origin.json',sha256:digest},start_configuration:{path:'start.json',sha256:digest}};
const proof={original_instance_id:'original',original_instance_sha256:digest,original_configuration_sha256:digest,journals_sha256:digest,
  decision_operation_id:decisionId,decision_material_sha256:digest,native_journal_sha256:digest,start_instance_sha256:digest,
  start_configuration_sha256:digest,start_journals_sha256:digest,start_native_journal_sha256:digest,start_operation_id:'op_'+'3'.repeat(40),session_id:'S001'};
const parameters={entry_point:entry,session:{session_id:'S001'},cycle:{cycle_id:'C001'}};
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
await check('closed entry refers to an old response and start proof without supplying a new Human choice',()=>{
  assertRetainedSessionClosureEntry(entry);assertRetainedSessionClosureProof(proof);
  const output=selectStandardEntry(parameters,null,retainedSessionClosureContinuation(proof));assertStandardOperationOutput(output);
  assert.equal(output.facts.retained_session_closure_requested,true);assert.equal(output.facts.session_close_completed,undefined);
  assert.throws(()=>assertRetainedSessionClosureEntry({...entry,choice:'close'}));
  assert.throws(()=>selectStandardEntry(parameters,null,{...retainedSessionClosureContinuation(proof),decision_operation_id:entryId}));
});
await check('accepted routing-wait entry pins its old instance and retains explicit non-closure of the historical Native journal',()=>{
  const acceptedEntry={...entry,version:2,boundary:'accepted_close_route_wait',original_instance_sha256:digest};
  const acceptedProof={...proof,version:2,boundary:acceptedEntry.boundary,post_decision_events_sha256:digest,
    start_retirement_proof_sha256:digest,start_native_closure_claimed:false};
  assertRetainedSessionClosureEntry(acceptedEntry);assertRetainedSessionClosureProof(acceptedProof);
  const selected=selectStandardEntry({...parameters,entry_point:acceptedEntry},null,retainedSessionClosureContinuation(acceptedProof));
  assert.equal(selected.facts.session_closure_requested,true);assert.equal(selected.facts.session_close_completed,undefined);
  assert.throws(()=>selectStandardEntry({...parameters,entry_point:acceptedEntry},null,retainedSessionClosureContinuation({...acceptedProof,original_instance_sha256:'b'.repeat(64)})));
  assert.throws(()=>assertRetainedSessionClosureProof({...acceptedProof,start_native_closure_claimed:true}));
  const missing=structuredClone(acceptedProof);delete missing.start_retirement_proof_sha256;assert.throws(()=>assertRetainedSessionClosureProof(missing));
  const legacy=structuredClone(acceptedProof);delete legacy.version;assert.throws(()=>assertRetainedSessionClosureProof(legacy));
});
for(const field of ['decision_material_sha256','native_journal_sha256','start_configuration_sha256','start_journals_sha256','start_native_journal_sha256'])
  await check('missing '+field+' refuses the proof',()=>{const p=structuredClone(proof);delete p[field];assert.throws(()=>assertRetainedSessionClosureProof(p));});
await check('provider waits for its authority and refuses process changes across that await',async()=>{
  const record={instance_id:'current',instance_sha256:digest,initial_parameters:parameters};let revision=digest,change=false,called=0;
  const provider=createStandardOperationProvider({current:()=>({record:{...record,instance_sha256:revision}}),reviewEffects:new Map(),
    processAuthority:{retainedSessionClosureEntry:async()=>{called++;if(change)revision='b'.repeat(64);return retainedSessionClosureContinuation(proof);}},
    fail:code=>{throw Object.assign(Error(code),{code});}});
  const select=provider.operations.find(row=>row.binding.id==='workflow_entry_select');
  assert.equal((await select.prepare({state:{record}})).facts.session_closure_requested,true);assert.equal(called,1);
  change=true;await assert.rejects(select.prepare({state:{record}}),{code:'STANDARD_ENTRY_PROCESS_CHANGED'});
});
await check('published reducer reaches the close writer without a new Human question or Native occurrence',()=>{
  const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url)));
  const binding=standardWorkflowOperationBindings().find(row=>row.id==='workflow_entry_select');
  let instance=createAgenticProcess({instanceId:'session-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters});
  const occurrence=inspectAgenticProcess(instance).ready[0],intent={contract_version:'process-operation-intent.v1',operation_id:entryId,
    binding_ref:binding.id,binding_sha256:H(binding),input_sha256:H({}),preconditions_sha256:digest,authorization_sha256:null,
    authority_id:'fixture',scope_id:instance.scope_id,instance_id:instance.instance_id,instance_sha256:instance.instance_sha256,
    model_sha256:instance.model_sha256,occurrence_id:occurrence,instance_revision:instance.revision};
  instance=advanceAgenticProcess(instance,{event_id:'entry',kind:'operation_intent',occurrence_id:occurrence,intent});
  const output=selectStandardEntry(parameters,null,retainedSessionClosureContinuation(proof));
  instance=advanceAgenticProcess(instance,{event_id:'accepted',kind:'operation_result',occurrence_id:occurrence,
    receipt:{contract_version:'process-operation-receipt.v1',receipt_id:'fixture-receipt',operation_id:entryId,intent_sha256:H(intent),authority_id:'fixture',
      outcome:'completed',effect_status:'no_effect',output_sha256:H(output),facts:output.facts,evidence_refs:[{ref:'fixture:entry',sha256:H(output)}]}});
  let calls=0;
  for (;;) {
    const waiting=inspectAgenticProcess(instance).occurrences.find(row=>row.wait_reason==='call_entry');if(!waiting)break;
    assert(calls<3);const data=resolveProcessCallData({instance,cursor:inspectAgenticProcess(instance),occurrenceId:waiting.occurrence_id,returning:false,readOperation:()=>{throw Error('unexpected source');}});
    instance=advanceAgenticProcess(instance,{event_id:'prepare-call-'+(++calls),kind:'call_enter',occurrence_id:waiting.occurrence_id,...data});
  }
  const cursor=inspectAgenticProcess(instance),frame=cursor.occurrences.find(row=>row.occurrence_id===cursor.ready[0]);
  assert.equal(cursor.occurrences.some(row=>row.wait_reason==='routing_fact'),false,'entry routing must stay outside the empty-fact call scope');
  assert.equal(processFrameNode(model,frame).binding_ref,'session_close_record');
  assert.deepEqual(resolveProcessOperationInput({instance,occurrenceId:frame.occurrence_id}).input,{});
  assert.equal(instance.events.length,2+calls);assert(model.nodes.length<=288);
});
await check('delivery routing belongs to the root and called preparation contains no inherited routing fact',()=>{
  const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url)));
  const route=model.nodes.find(row=>row.id==='session_integration_preparation_route');
  assert.deepEqual(route.branches.map(row=>row.condition),['retained_session_integration_requested','retained_session_delivery_requested','retained_session_checkpoint_requested',null]);
  for(const id of ['aidn-standard-delivery-preparation','aidn-standard-checkpoint-delivery-preparation']){
    const target=model.call_targets.find(row=>row.model_id===id).model;
    assert(target.nodes.every(row=>['sequence','operation','call'].includes(row.kind)));
    assert.deepEqual(target.call_interface,{parameters:{},returns:{}});
  }
  const shared=model.call_targets.find(row=>row.model_id==='aidn-standard-session-close-preparation');
  const corrective=model.nodes.find(row=>row.id==='correction_session_close_record');
  assert.equal(corrective.kind,'call');assert.equal(corrective.target.model_sha256,shared.model_sha256);
  assert.deepEqual(shared.model.nodes.find(row=>row.id===shared.model.entry).children,['session_close_record','session_close_checkpoint','session_close_finalize']);
});
await check('all new contracts use supported closed schema vocabulary',()=>{
  for(const name of ['standard-retained-session-closure-entry.v1','standard-retained-session-closure-proof.v1','standard-retained-session-closure-entry.v2','standard-retained-session-closure-proof.v2','standard-workflow-entry-selection-output.v8','standard-session-close-input.v2']){
    const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);
  }
});
console.log(JSON.stringify({status:'PASS',checks,scope:'contracts-provider-and-published-reducer',historical_reader:'NOT_RUN',actual_close:'NOT_RUN',native_calls:0,p0:false}));
