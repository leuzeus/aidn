import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
import { admitSessionDeliveryMetadata } from '../../src/application/runtime/session-delivery-metadata-admission.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { sessionClosePaths } from '../../src/core/workflow/standard-session-close-render.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertRetainedSessionDeliveryEntry, assertRetainedSessionDeliveryProof, retainedSessionDeliveryContinuation } from '../../src/core/workflow/standard-retained-session-delivery.mjs';
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
const entry={kind:'retained_session_delivery',finalization_operation_id:decisionId,original_configuration:{path:'origin.json',sha256:digest}};
const proof={original_instance_id:'original',original_instance_sha256:digest,original_configuration_sha256:digest,journals_sha256:digest,
  native_journal_sha256:digest,session_id:'S001',finalizer_sha256:digest,checkpoint_proof_sha256:digest,postimages_sha256:digest,
  finalization_operation_id:decisionId,metadata_basis:'fresh_canonical_observation'};
const parameters={entry_point:entry,session:{session_id:'S001'},cycle:{cycle_id:'C001'}};
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
await check('closed entry refers to a confirmed finalizer and new metadata observation without supplying a new Human choice',()=>{
  assertRetainedSessionDeliveryEntry(entry);assertRetainedSessionDeliveryProof(proof);
  const output=selectStandardEntry(parameters,null,retainedSessionDeliveryContinuation(proof));assertStandardOperationOutput(output);
  assert.equal(output.facts.retained_session_delivery_requested,true);assert.equal(output.facts.session_close_completed,undefined);
  assert.throws(()=>assertRetainedSessionDeliveryEntry({...entry,choice:'close'}));
  assertStandardOperationInput('session_delivery_checkpoint',{});
  assert.throws(()=>assertStandardOperationInput('session_delivery_checkpoint',{finalization_operation_id:proof.finalization_operation_id}));
  assert.throws(()=>selectStandardEntry(parameters,null,{...retainedSessionDeliveryContinuation(proof),finalization_operation_id:entryId}));
});
for(const field of ['finalizer_sha256','checkpoint_proof_sha256','native_journal_sha256','postimages_sha256','metadata_basis'])
  await check('missing '+field+' refuses the proof',()=>{const p=structuredClone(proof);delete p[field];assert.throws(()=>assertRetainedSessionDeliveryProof(p));});
await check('provider waits for its authority and refuses process changes across that await',async()=>{
  const record={instance_id:'current',instance_sha256:digest,initial_parameters:parameters};let revision=digest,change=false,called=0;
  const provider=createStandardOperationProvider({current:()=>({record:{...record,instance_sha256:revision}}),reviewEffects:new Map(),
    processAuthority:{retainedSessionDeliveryEntry:async()=>{called++;if(change)revision='b'.repeat(64);return retainedSessionDeliveryContinuation(proof);}},
    fail:code=>{throw Object.assign(Error(code),{code});}});
  const select=provider.operations.find(row=>row.binding.id==='workflow_entry_select');
  assert.equal((await select.prepare({state:{record}})).facts.session_closure_requested,true);assert.equal(called,1);
  change=true;await assert.rejects(select.prepare({state:{record}}),{code:'STANDARD_ENTRY_PROCESS_CHANGED'});
});
await check('published reducer reaches the delivery checkpoint without a new Human question or Native occurrence',()=>{
  const model=JSON.parse(fs.readFileSync(new URL('../../package/catalogs/process-models/aidn-standard.v1.json',import.meta.url)));
  const binding=standardWorkflowOperationBindings().find(row=>row.id==='workflow_entry_select');
  let instance=createAgenticProcess({instanceId:'session-fixture',model,policyPins:agenticPolicyPins(model),scopeId:'fixture',parameters});
  const occurrence=inspectAgenticProcess(instance).ready[0],intent={contract_version:'process-operation-intent.v1',operation_id:entryId,
    binding_ref:binding.id,binding_sha256:H(binding),input_sha256:H({}),preconditions_sha256:digest,authorization_sha256:null,
    authority_id:'fixture',scope_id:instance.scope_id,instance_id:instance.instance_id,instance_sha256:instance.instance_sha256,
    model_sha256:instance.model_sha256,occurrence_id:occurrence,instance_revision:instance.revision};
  instance=advanceAgenticProcess(instance,{event_id:'entry',kind:'operation_intent',occurrence_id:occurrence,intent});
  const output=selectStandardEntry(parameters,null,retainedSessionDeliveryContinuation(proof));
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
  assert.equal(processFrameNode(model,frame).binding_ref,'session_delivery_checkpoint');
  assert.deepEqual(resolveProcessOperationInput({instance,occurrenceId:frame.occurrence_id}).input,{});
  assert.equal(instance.events.length,2+calls);assert(model.nodes.length<=288);
});
await check('all new contracts use supported closed schema vocabulary',()=>{
  for(const name of ['standard-retained-session-delivery-entry.v1','standard-retained-session-delivery-proof.v1','standard-workflow-entry-selection-output.v10','standard-session-delivery-checkpoint-input.v2']){
    const schema=JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/'+name+'.schema.json',import.meta.url)));
    assert.deepEqual(validateJsonSchemaDefinition(schema,'#',{contractKind:'workflow-definition'}),[]);
  }
});
const plan={session_path:'sessions/S001.md',session_id:'S001',documents:sessionClosePaths('sessions/S001.md').map(path=>({path}))};
const rows=plan.documents.map(({path})=>{const session=path===plan.session_path,current=path==='CURRENT-STATE.md';return {path,content:'closed fixture',content_format:'utf8',sha256:artifactContentHash('closed fixture'),kind:session?'session':current?'other':'snapshot',family:'normative',subtype:session?null:current?'current_state':'context_snapshot',session_id:session?'S001':null,cycle_id:null,source_mode:'explicit',entity_confidence:1,legacy_origin:null,classification_reason:null,gate_relevance:session||current?0:1,updated_at:'2026-01-01T00:00:00.000Z'};});
const closed={contract_version:'standard-session-close-hook-output.v1',outcome:'completed',effect_status:'confirmed',facts:{session_close_completed:true},observations:{committed:plan.documents.map(r=>r.path)},evidence_refs:rows.map(r=>({ref:'docs/audit/'+r.path,sha256:r.sha256}))};
await check('legacy metadata admission captures a new immutable digest without changing the historical receipt',()=>{
 const before=H(closed),result=admitSessionDeliveryMetadata({rows,plan,output:closed});assert.equal(H(closed),before);
 assert.deepEqual(result,rows.map(r=>({path:r.path,sha256:r.sha256,metadata_sha256:artifactMetadataHash(r)})));
 const newer=structuredClone(rows);newer[0].updated_at='2026-01-02T00:00:00.000Z';
 assert.notEqual(H(admitSessionDeliveryMetadata({rows:newer,plan,output:closed})),H(result));
});
for(const [name,mutate] of Object.entries({owner:r=>r[0].session_id='S999',cycle:r=>r[0].cycle_id='C999',family:r=>r[0].family='operational',kind:r=>r[0].kind='other',subtype:r=>r[0].subtype='foreign',source:r=>r[0].source_mode='imported',confidence:r=>r[0].entity_confidence=0,legacy:r=>r[0].legacy_origin='foreign',classification:r=>r[0].classification_reason='foreign',gate:r=>r.find(x=>x.kind==='snapshot').gate_relevance=0,content:r=>r[0].content='foreign',hash:r=>r[0].sha256=digest,date:r=>r[0].updated_at='invalid',order:r=>r.reverse(),missing:r=>r.pop()}))
 await check('canonical '+name+' mismatch refuses fresh admission',()=>{const changed=structuredClone(rows);mutate(changed);assert.throws(()=>admitSessionDeliveryMetadata({rows:changed,plan,output:closed}),{code:'STANDARD_SESSION_DELIVERY_METADATA_ADMISSION_REFUSED'});});
console.log(JSON.stringify({status:'PASS' ,checks,scope:'contracts-provider-and-published-reducer',historical_reader:'NOT_RUN',actual_close:'NOT_RUN',native_calls:0,p0:false}));
