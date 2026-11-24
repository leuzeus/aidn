import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertRetainedSessionIntegrationBoundary, assertRetainedSessionIntegrationEntry, assertRetainedSessionIntegrationProof, retainedSessionIntegrationContinuation } from '../../src/core/workflow/standard-retained-session-integration.mjs';
import { selectStandardEntry } from '../../src/core/workflow/standard-workflow-entry-selection.mjs';
import { assertStandardOperationOutput, assertStandardOperationInput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardOperationProvider } from '../../src/application/runtime/standard-operation-provider.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessOperationInput } from '../../src/core/workflow/process-input-resolution.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const digest='a'.repeat(64), decisionId='op_'+'1'.repeat(40), entryId='op_'+'2'.repeat(40);
const entry={kind:'retained_session_integration',decision_operation_id:decisionId,original_configuration:{path:'origin.json',sha256:digest}};
const proof={original_instance_id:'original',original_instance_sha256:digest,original_configuration_sha256:digest,journals_sha256:digest,
  session_id:'S001',decision_material_sha256:digest,delivery_proof_sha256:digest,cycle_material_sha256:digest,canonical_sha256:digest,decision_operation_id:decisionId};
const parameters={entry_point:entry,session:{session_id:'S001'},cycle:{cycle_id:'C001'}};
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
await check('closed entry names the retained decision and binds its complete source without a new Human choice',()=>{
  assertRetainedSessionIntegrationEntry(entry);assertRetainedSessionIntegrationProof(proof);
  const output=selectStandardEntry(parameters,null,retainedSessionIntegrationContinuation(proof));assertStandardOperationOutput(output);
  assert.equal(output.facts.retained_session_integration_requested,true);assert.equal(output.facts.session_close_completed,undefined);
  assert.throws(()=>assertRetainedSessionIntegrationEntry({...entry,choice:'close'}));
  assertStandardOperationInput('session_branch_integrate',{});
  assertStandardOperationInput('session_branch_integrate',{contract_version:'standard-session-branch-integrate-input.v1',decision_operation_id:decisionId});
  assert.throws(()=>assertStandardOperationInput('session_branch_integrate',{decision_operation_id:proof.decision_operation_id}));
  assert.throws(()=>selectStandardEntry(parameters,null,{...retainedSessionIntegrationContinuation(proof),decision_operation_id:entryId}));
});
for(const field of ['decision_material_sha256','delivery_proof_sha256','cycle_material_sha256','canonical_sha256','journals_sha256'])
  await check('missing '+field+' refuses the proof',()=>{const p=structuredClone(proof);delete p[field];assert.throws(()=>assertRetainedSessionIntegrationProof(p));});
await check('provider waits for its authority and refuses process changes across that await',async()=>{
  const record={instance_id:'current',instance_sha256:digest,initial_parameters:parameters};let revision=digest,change=false,called=0;
  const provider=createStandardOperationProvider({current:()=>({record:{...record,instance_sha256:revision}}),reviewEffects:new Map(),
    retainedSessionIntegrationEntry:async()=>{called++;if(change)revision='b'.repeat(64);return retainedSessionIntegrationContinuation(proof);},
    fail:code=>{throw Object.assign(Error(code),{code});}});
  const select=provider.operations.find(row=>row.binding.id==='workflow_entry_select');
  assert.equal((await select.prepare({state:{record}})).facts.session_closure_requested,true);assert.equal(called,1);
  change=true;await assert.rejects(select.prepare({state:{record}}),{code:'STANDARD_ENTRY_PROCESS_CHANGED'});
});
await check('current integration provider rejects caller-selected historical IDs and delegates empty input to the fixed host',async()=>{
 let calls=0;const provider=createStandardOperationProvider({reviewEffects:new Map(),prepareSessionBranchIntegration:async()=>{calls++;return {can_apply:false};},fail:code=>{throw Object.assign(Error(code),{code});}});
 const effect=provider.operations.find(row=>row.binding.id==='session_branch_integrate');
 await assert.rejects(effect.prepare({state:{record:{}},input:{contract_version:'standard-session-branch-integrate-input.v1',decision_operation_id:decisionId},occurrenceId:'fixture'}),{code:'STANDARD_OPERATION_INPUT_INVALID'});
 assert.equal(calls,0);
 assert.deepEqual(await effect.prepare({state:{record:{instance_sha256:digest}},input:{},occurrenceId:'fixture'}),{can_apply:false});assert.equal(calls,1);
});
await check('published reducer reaches integration without a new Human question or Native occurrence',()=>{
  const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url)));
  const binding=standardWorkflowOperationBindings().find(row=>row.id==='workflow_entry_select');
  let instance=createAgenticProcess({instanceId:'session-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters});
  const occurrence=inspectAgenticProcess(instance).ready[0],intent={contract_version:'process-operation-intent.v1',operation_id:entryId,
    binding_ref:binding.id,binding_sha256:H(binding),input_sha256:H({}),preconditions_sha256:digest,authorization_sha256:null,
    authority_id:'fixture',scope_id:instance.scope_id,instance_id:instance.instance_id,instance_sha256:instance.instance_sha256,
    model_sha256:instance.model_sha256,occurrence_id:occurrence,instance_revision:instance.revision};
  instance=advanceAgenticProcess(instance,{event_id:'entry',kind:'operation_intent',occurrence_id:occurrence,intent});
  const output=selectStandardEntry(parameters,null,retainedSessionIntegrationContinuation(proof));
  instance=advanceAgenticProcess(instance,{event_id:'accepted',kind:'operation_result',occurrence_id:occurrence,
    receipt:{contract_version:'process-operation-receipt.v1',receipt_id:'fixture-receipt',operation_id:entryId,intent_sha256:H(intent),authority_id:'fixture',
      outcome:'completed',effect_status:'no_effect',output_sha256:H(output),facts:output.facts,evidence_refs:[{ref:'fixture:entry',sha256:H(output)}]}});
  const cursor=inspectAgenticProcess(instance),frame=cursor.occurrences.find(row=>row.occurrence_id===cursor.ready[0]);
  assert.equal(processFrameNode(model,frame).binding_ref,'session_branch_integrate');
  assert.deepEqual(resolveProcessOperationInput({instance,occurrenceId:frame.occurrence_id}).input,{});
  assert.equal(instance.events.length,2);assert(model.nodes.length<=288);
});
await check('all new contracts use supported closed schema vocabulary',()=>{
  for(const name of ['standard-retained-session-integration-entry.v1','standard-retained-session-integration-proof.v1','standard-workflow-entry-selection-output.v11','standard-session-branch-integrate-input.v2']){
    const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);
  }
});
function boundaryFixture() {
  const execution={instance_id:'original'},instance={instance_id:'original',scope_id:'scope',model_sha256:digest,events:[]};
  const records=['workflow_entry_select','session_delivery_checkpoint','cycle_close_completed_select','session_branch_integration_decision'].map((binding,i)=>{
    const id=i===3?decisionId:'op_'+String(i+4).repeat(40),intent={operation_id:id,binding_ref:binding,instance_id:'original',scope_id:'scope',model_sha256:digest};
    const output={outcome:'completed',effect_status:'no_effect'},receipt={operation_id:id,outcome:'completed',effect_status:'no_effect',output_sha256:H(output)};
    const row={operation_id:id,intent,phase:'receipted',results:[{output,receipt}],preview:{snapshot:{native:{configuration_sha256:H(execution)}}}};
    instance.events.push({kind:'operation_intent',intent:structuredClone(intent)});if(i<3)instance.events.push({kind:'operation_result',receipt:structuredClone(receipt)});return row;
  });return {execution,instance,records,entry};
}
await check('pure historical boundary accepts only the settled prefix and one unaccepted Human receipt',()=>{
 const f=boundaryFixture();assert.equal(assertRetainedSessionIntegrationBoundary(f).operation_id,decisionId);
});
for(const [name,change] of Object.entries({
 accepted:f=>f.instance.events.push({kind:'operation_result',receipt:f.records[3].results[0].receipt}),
 extra:f=>f.records.push(f.records[0]),unknown:f=>f.records[3].results[0].output.effect_status='unknown',
 foreign:f=>f.records[2].intent.instance_id='foreign',scope:f=>f.records[2].intent.scope_id='foreign',
 model:f=>f.records[1].intent.model_sha256='b'.repeat(64),config:f=>f.records[0].preview.snapshot.native.configuration_sha256='b'.repeat(64),
 unacceptedPrefix:f=>f.instance.events.splice(1,1),reordered:f=>f.records.reverse(),
 output:f=>f.records[1].results[0].output.extra='forged',multiple:f=>f.records[3].results.push(f.records[3].results[0]),
 missing:f=>f.records[3].results=[],foreignDecision:f=>f.entry={...entry,decision_operation_id:entryId}
}))await check('historical '+name+' boundary refuses before continuation',()=>{const f=boundaryFixture();change(f);assert.throws(()=>assertRetainedSessionIntegrationBoundary(f));});
console.log(JSON.stringify({status:'PASS',checks,scope:'contracts-provider-and-published-reducer',historical_reader:'NOT_RUN',actual_integration:'NOT_RUN',native_calls:0,p0:false}));
