import {assertHandoffBeforeEffectPlan,assertHandoffBeforeEffectDisposition} from '../../src/core/workflow/process-operation-disposition.mjs';
import {createStandardHandoffBeforeEffectObservation} from '../../src/application/runtime/standard-handoff-continuation.mjs';
import { assertHandoffContinuationPlan, assertHandoffContinuationDisposition, assertUnreturnedHandoffContinuationPlan, assertUnreturnedHandoffContinuationDisposition, assertIncidentContinuationPlan } from "../../src/core/workflow/process-operation-disposition.mjs";
import { createAgenticProcess, advanceAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import {createStandardHandoffContinuation} from "../../src/application/runtime/standard-handoff-continuation.mjs";
import {handoffPublicationInterruptedPrefix} from "../../src/core/workflow/standard-handoff-operation.mjs";
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { decodeHandoffPacketPlan, assertHandoffOperationOutput, handoffOperationResult } from "../../src/core/workflow/standard-handoff-operation.mjs";
import { shadowHash as H } from "../../src/core/workflow/shadow-json.mjs";
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observeLocalProcessOwner } from "../../src/adapters/runtime/local-process-identity.mjs";
import { inspectInterruptedReopenLock, retireInterruptedReopenLock } from "../../src/application/runtime/local-artifact-owner-retirement.mjs";
import { withStandardDispatchContext } from "../../src/application/runtime/standard-dispatch-context.mjs";
if (process.argv[2] === '--worker') {
  const configFile=process.argv[3], c=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const phase=point=>fs.appendFileSync(configFile+'.phases.jsonl',JSON.stringify({point,pid:process.pid,at_ms:Date.now()})+'\n');phase('worker_entered');
  const source={async read({request:q}){return{contract_version:'standard-handoff-resource-observation.v1',authority_id:'fixture_handoff_discovery',request_sha256:H(q),observed_at_ms:c.clock,evidence_class:'fixture',evidence_refs:[{ref:'fixture:controlled-source',sha256:H(q)}],domains:['deterministic','native','human','control','process','git','provider'].map(domain=>({domain,complete:true,active_resources:0,state:'closed',evidence_refs:[{ref:'fixture:'+domain,sha256:H({q,domain})}]}))};},async verify({request:q,observation:o}){return{outcome:'verified',authority_id:o.authority_id,request_sha256:H(q),observation_sha256:H(o),evidence_class:'fixture'};},assertCurrent(){}};
  process.on('message',()=>{});
  const workerDisposition={async authorize({request}){return{contract_version:'process-disposition-authorization-grant.v2',authority_id:'fixture_current_disposition',authorized:true,request_sha256:H(request),principal_sha256:H('controlled current operator'),grant_sha256:H({request,permission:'new-exact-disposition'}),observed_at_ms:c.clock,evidence_refs:[{ref:'fixture:new-exact-disposition',sha256:H(request)}]};},async verify({request,grant}){return{outcome:'verified',authority_id:grant.authority_id,request_sha256:H(request),grant_sha256:H(grant)};},assertCurrent({request,grant}){assert.equal(grant.request_sha256,H(request));}};
  const host=createStandardWorkflowOperationHost({targetRoot:c.root,model:c.model,now:()=>c.clock,readSigningKey:()=>Buffer.from(c.key,'hex'),authorize:value=>({authorized:true,authority_id:'fixture_operator',principal_sha256:H('controlled operator'),grant_sha256:H({preview:value.preview_sha256,scope:value.scope_id})}),reconciliationConfiguration:{instance_id:c.id,target_root:c.root,control_root:c.control},dispositionSource:workerDisposition,handoffResourceSource:source,handoffNativeHistory:()=>({instance_id:c.id,scope_id:null,model_sha256:null,journal_id:null,journal_sha256:null,retained_history_status:'not_allocated',entries:[],permits_effects:false,complete_resource_closure:false})},{dispatchCheckpoint:async point=>{phase(point);if(c.plan&&point===c.boundary){const a=createStandardWorkflowArtifacts({targetRoot:c.root});const identity=point==='disposition_control_reserved'?JSON.parse(a.read('workflows/operation-control-intents/'+c.operation_id+'.json',{required:true}).content).attempts.at(-1).resource_fence.record.process_identity:a.resourceFence().read().record.process_identity;assert.equal(identity.pid,process.pid);process.send({status:'controller_boundary',boundary:point,identity});await new Promise(()=>{});}},handoffPublicationBoundary:point=>{phase(point);if(point===c.publisher_boundary){if(c.unreturned){const a=createStandardWorkflowArtifacts({targetRoot:c.root}),record=host.readJournal(c.operation_id),capsule=JSON.parse(a.read('workflows/dispatch-records/'+c.operation_id+'.json',{required:true}).content);assert.equal(record.phase,'dispatching');assert.deepEqual(record.results,[]);assert.equal(capsule.phase,'running');assert.equal(capsule.output,null);const marker=configFile+'.before-cas.json';fs.writeFileSync(marker+'.tmp',JSON.stringify({status:'before_cas_before_first_result',identity:capsule.process_identity})+'\n',{flag:'wx'});fs.renameSync(marker+'.tmp',marker);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}throw Object.assign(Error('FIXTURE_LOST_AFTER_PACKET_CAS'),{code:'FIXTURE_LOST_AFTER_PACKET_CAS'});}}});
  phase('host_opened');
  const result=c.receipt_id?await host.accept(c.operation_id,{write:true,receiptId:c.receipt_id}):c.plan?await host.applyOperationDisposition(c.plan,{write:true,expectedPlanSha256:H(c.plan)}):await host.dispatch(c.operation_id,{write:true}),record=host.readJournal(c.operation_id);
  assert.equal(result.status,'receipted');assert.equal(record.results[0].output.effect_status,'unknown');
  const a=createStandardWorkflowArtifacts({targetRoot:c.root}),capsule=JSON.parse(a.read('workflows/dispatch-records/'+c.operation_id+'.json',{required:true}).content);
  fs.writeFileSync(configFile+'.returned.json',JSON.stringify({result,identity:capsule.process_identity})+'\n',{flag:'wx'});
  process.on('message',()=>{}); // Keep the IPC handle referenced until the parent terminates this actual owner.
  process.send({status:'unknown_returned',identity:capsule.process_identity});
  await new Promise(()=>{});
} else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){ console.log(JSON.stringify(await verifyStandardHandoffBeforeEffectDisposition(process.argv[2]))); }
export async function verifyStandardHandoffBeforeEffectDisposition(mode){
assert(["dual","db-only"].includes(mode));
const owned=[],root=createFreshStandardWorkflowFixture(mode,owned,{absentOptionalDocuments:['HANDOFF-PACKET.md']}),artifacts=createStandardWorkflowArtifacts({targetRoot:root}),key=Buffer.alloc(32,149),signer=createOperationJournalSigner(()=>key);
const control=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'aidn-handoff-operation-control-'));owned.push(control);
let clock=Date.now(),allowed=true,sourceAllowed=true,sourceReads=0;const sourceExpiry=clock+3600000;
const binding=standardWorkflowOperationBindings().find(row=>row.id==='handoff_packet_publish');assert(binding);
const model={contract_version:'agentic-process-model.v2',model_id:'handoff-common-operation-component',revision:1,participants:[{id:'project'}],roles:[],policies:[],entry:'publish',operation_pins:{handoff_packet_publish:H(binding)},nodes:[{id:'publish',kind:'operation',participant_ref:'project',binding_ref:'handoff_packet_publish'}]};
const seed=artifacts.read('CURRENT-STATE.md',{required:true}),thinking=seed.content.replace(/^mode:.*$/mi,'mode: THINKING');assert.notEqual(thinking,seed.content);
await artifacts.withLocalEffectOwner(H({fixture:'explicit-thinking-setup'}),()=>{artifacts.compareAndSwapPreservingMetadata({path:'CURRENT-STATE.md',before_sha256:seed.sha256,before_metadata_sha256:artifacts.metadataHash('CURRENT-STATE.md'),after:thinking});artifacts.project(['CURRENT-STATE.md']);return{effect_status:'confirmed'};});
const source={async read({request:q}){sourceReads++;return{contract_version:'standard-handoff-resource-observation.v1',authority_id:'fixture_handoff_discovery',request_sha256:H(q),observed_at_ms:clock,evidence_class:'fixture',evidence_refs:[{ref:'fixture:controlled-source',sha256:H(q)}],domains:['deterministic','native','human','control','process','git','provider'].map(domain=>({domain,complete:true,active_resources:0,state:'closed',evidence_refs:[{ref:'fixture:'+domain,sha256:H({q,domain})}]}))};},async verify({request:q,observation:o}){return{outcome:'verified',authority_id:o.authority_id,request_sha256:H(q),observation_sha256:H(o),evidence_class:'fixture'};},assertCurrent(){if(!sourceAllowed||clock>=sourceExpiry)throw Object.assign(Error('FIXTURE_RESOURCE_SOURCE_NOT_CURRENT'),{code:'FIXTURE_RESOURCE_SOURCE_NOT_CURRENT'});}};
const grantFor=input=>{if(!allowed)throw Object.assign(Error('FIXTURE_CURRENT_GRANT_REQUIRED'),{code:'FIXTURE_CURRENT_GRANT_REQUIRED'});return{authorized:true,authority_id:'fixture_operator',principal_sha256:H('controlled operator'),grant_sha256:H({preview:input.preview_sha256,scope:input.scope_id})};};
const dispositionRequests=[];let dispositionAllowed=true;
const dispositionSource={
 async authorize({request}){if(!dispositionAllowed)throw Object.assign(Error('FIXTURE_CURRENT_DISPOSITION_REQUIRED'),{code:'FIXTURE_CURRENT_DISPOSITION_REQUIRED'});dispositionRequests.push(structuredClone(request));return{contract_version:'process-disposition-authorization-grant.v2',authority_id:'fixture_current_disposition',authorized:true,request_sha256:H(request),principal_sha256:H('controlled current operator'),grant_sha256:H({request,permission:'new-exact-disposition'}),observed_at_ms:clock,evidence_refs:[{ref:'fixture:new-exact-disposition',sha256:H(request)}]};},
 async verify({request,grant}){this.assertCurrent({request,grant});return{outcome:'verified',authority_id:grant.authority_id,request_sha256:H(request),grant_sha256:H(grant)};},
 assertCurrent({request,grant}){if(!dispositionAllowed||grant.request_sha256!==H(request))throw Object.assign(Error('FIXTURE_CURRENT_DISPOSITION_REQUIRED'),{code:'FIXTURE_CURRENT_DISPOSITION_REQUIRED'});}
};
function compose(id,{boundary,onDispatch,asyncGrant=false}={}){const configuration={instance_id:id,target_root:root,control_root:control};let host;const checkpoint=async(...args)=>{if(args[0]==="dispatch_reserved"){const live=host.observeResourceActivity();assert(live.current_dispatch_id);assert(live.active_dispatches.some(row=>row.dispatch_id===live.current_dispatch_id&&row.instance_id===id));await Promise.resolve();assert.equal(host.observeResourceActivity().current_dispatch_id,live.current_dispatch_id);}return onDispatch?.(...args);};host=createStandardWorkflowOperationHost({targetRoot:root,model,now:()=>clock,readSigningKey:()=>key,authorize:asyncGrant?async value=>grantFor(value):grantFor,reconciliationConfiguration:configuration,dispositionSource,handoffResourceSource:source,handoffNativeHistory:()=>({instance_id:id,scope_id:null,model_sha256:null,journal_id:null,journal_sha256:null,retained_history_status:'not_allocated',entries:[],permits_effects:false,complete_resource_closure:false})},{handoffPublicationBoundary:boundary,dispatchCheckpoint:checkpoint});return host;}
const input={contract_version:'standard-handoff-publication-input.v1',next_agent_role:'coordinator',next_agent_action:'reanchor',next_agent_goal:'Resume from the retained canonical checkpoint.',handoff_note:'Keep original UNKNOWN and current resource obligations.',from_agent_role:'coordinator',from_agent_action:'relay'};
function tree(){const rows={};const walk=(at,base,label)=>{for(const e of fs.readdirSync(at,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(at,e.name),r=label+':'+path.relative(base,p);if(e.isSymbolicLink())rows[r]='LINK:'+fs.readlinkSync(p);else if(e.isDirectory()){rows[r+path.sep]='DIRECTORY';walk(p,base,label);}else rows[r]=H(fs.readFileSync(p).toString('base64'));}};walk(root,root,'project');walk(control,control,'control');return rows;}
let checks=0;async function readonly(name,run){const before=tree(),value=await run();assert.deepEqual(tree(),before,name);checks++;console.log('PASS '+name);return value;}
async function prepare(id,options={}){const host=compose(id,options),initial=host.initialize({instanceId:id});host.initialize({instanceId:id,write:true,expectedResultSha256:initial.record.instance_sha256});const current=host.inspect(id),frame=current.cursor.occurrences.find(row=>row.status==='READY');assert(frame);const preview=await readonly('canonical common preview is read-only for '+id,()=>host.preview({instanceId:id,expectedSha256:current.record.instance_sha256,occurrenceId:frame.occurrence_id,input:{...input,next_agent_goal:input.next_agent_goal+' '+id}}));assert.equal(preview.prepared.can_apply,true);return{host,id,preview,inner:decodeHandoffPacketPlan(preview.prepared.plan)};}
async function dispatch(c){const staged=await c.host.stage(c.preview,{write:true,expectedPreviewSha256:H(c.preview)});assert.equal(c.host.observeResourceActivity().active_dispatches.length,0);const pending=c.host.dispatch(staged.operation_id,{write:true});assert.equal(c.host.observeResourceActivity().current_dispatch_id,null);assert(c.host.observeResourceActivity().active_dispatches.some(row=>row.operation_id===staged.operation_id&&row.binding_ref==='handoff_packet_publish'));const result=await pending;assert.equal(c.host.observeResourceActivity().active_dispatches.length,0);assert.equal(result.status,'receipted');const record=c.host.readJournal(staged.operation_id);signer.verify(record);signer.verify(record.preview);assert.equal(record.results.length,1);assertHandoffOperationOutput(record.results[0].output);return{...c,operation_id:staged.operation_id,result,record,output:record.results[0].output};}



const prepared=await prepare('before-cas-unreturned-characterization');
const packetBefore=artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true});
const staged=await prepared.host.stage(prepared.preview,{write:true,expectedPreviewSha256:H(prepared.preview)});
const config={root,control,model,clock,key:key.toString('hex'),id:prepared.id,operation_id:staged.operation_id,unreturned:true,publisher_boundary:'before_packet_cas'};
const configFile=path.join(control,'before-cas-worker.json');fs.writeFileSync(configFile,JSON.stringify(config)+'\n',{flag:'wx'});
const child=fork(fileURLToPath(import.meta.url),['--worker',configFile],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let stderr='',message,exit,timerExpired=false,record,capsule,retainedCapsule,livePlan,deadPlan;
child.stdout.resume();child.stderr.on('data',b=>{stderr+=b;if(stderr.length>16384)child.kill();});
const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
const timer=setTimeout(()=>{timerExpired=true;child.kill();},120000);
try{
 message=await new Promise((resolve,reject)=>{const marker=configFile+'.before-cas.json';let interval;const finish=(error,value)=>{clearInterval(interval);error?reject(error):resolve(value);};interval=setInterval(()=>{try{if(fs.existsSync(marker))finish(null,JSON.parse(fs.readFileSync(marker,'utf8')));}catch(error){finish(error);}},25);child.once('error',error=>finish(error));child.once('close',()=>finish(Error('ORIGINAL_PRODUCER_CLOSED_BEFORE_PRE_CAS_BOUNDARY:'+stderr.slice(-2048))));});
 assert.equal(message.status,'before_cas_before_first_result');assert.equal(observeLocalProcessOwner(message.identity),'active');
 record=prepared.host.readJournal(staged.operation_id);signer.verify(record);signer.verify(record.preview);
 capsule=JSON.parse(artifacts.read('workflows/dispatch-records/'+staged.operation_id+'.json',{required:true}).content);signer.verify(capsule);
 assert.equal(record.phase,'dispatching');assert.deepEqual(record.results,[]);assert.equal(capsule.phase,'running');assert.equal(capsule.output,null);assert.equal(capsule.output_sha256,null);assert.equal(capsule.context_after_sha256,null);
 assert.equal(capsule.local_owner_intentions.length,1);assert.equal(capsule.leases.length,1);assert.equal(capsule.leases[0].status,'held');
 assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),packetBefore);assert.equal(artifacts.ownerPending(),true);
 retainedCapsule=artifacts.readMany(['workflows/dispatch-records/'+staged.operation_id+'.json'],{includeMetadata:true});
 const liveState=prepared.host.inspect(prepared.id).record;
 livePlan=await readonly('live pre-CAS producer disposition preparation preserves all bytes',()=>prepared.host.prepareOperationDisposition(staged.operation_id,{expectedSha256:liveState.instance_sha256}));
 assert.equal(livePlan.contract_version,'process-operation-disposition-plan.v1');assert.equal(livePlan.assessment,'unknown');
 const liveRefusal=await readonly('live pre-CAS application stays UNKNOWN with no grant',()=>prepared.host.applyOperationDisposition(livePlan,{write:true,expectedPlanSha256:H(livePlan)}));
 assert.equal(liveRefusal.status,'reconciliation_required');assert.equal(liveRefusal.written,false);assert.equal(dispositionRequests.length,0);
 child.kill();exit=await ended;assert.equal(observeLocalProcessOwner(message.identity),'terminated');
 assert.equal(timerExpired,false);


 const state=prepared.host.inspect(prepared.id).record;
 const plan=await readonly('before-effect v5 preparation has no grant or write',()=>prepared.host.prepareOperationDisposition(staged.operation_id,{expectedSha256:state.instance_sha256}));
 assertHandoffBeforeEffectPlan(plan);assert.equal(plan.contract_version,'process-operation-disposition-plan.v5');
 assert.equal(plan.assessment,'known_before_effect_handoff_publication');assert.equal(plan.output_sha256,null);
 assert.equal(plan.continuation.original_receipt_sha256,null);assert.deepEqual(plan.continuation.owned_paths,[]);
 for(const field of ["original_output","owned_path","expected_success"]){const forged=structuredClone(plan);if(field==="original_output")forged.output_sha256=H("invented old result");else if(field==="owned_path")forged.continuation.owned_paths=["HANDOFF-PACKET.md"];else {forged.continuation.expected_output=handoffOperationResult(record.preview.prepared,{status:"packet_written",packet_sha256:prepared.inner.after_sha256,packet_metadata_sha256:H("invented metadata"),evidence_refs:[{ref:"docs/audit/HANDOFF-PACKET.md",sha256:prepared.inner.after_sha256}]});forged.continuation.expected_output_sha256=H(forged.continuation.expected_output);}assert.throws(()=>assertHandoffBeforeEffectPlan(forged),{code:"PROCESS_DISPOSITION_PLAN_INVALID"});}
 const applied=await prepared.host.applyOperationDisposition(plan,{write:true,expectedPlanSha256:H(plan)});
 assert.equal(applied.status,'receipted');assert.equal(applied.receipt.outcome,'blocked');assert.equal(applied.receipt.effect_status,'no_effect');
 const first=prepared.host.readJournal(staged.operation_id);assert.equal(first.results.length,1);
 assert.equal(first.results[0].receipt.receipt_id,'receipt_'+staged.operation_id.slice(3));
 assert.deepEqual(first.preview,record.preview);assert.deepEqual(first.intent,record.intent);assert.deepEqual(first.grant,record.grant);assert.deepEqual(first.owner,record.owner);
 assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),packetBefore);
 assert.deepEqual(artifacts.readMany(['workflows/dispatch-records/'+staged.operation_id+'.json'],{includeMetadata:true}),retainedCapsule);
 const accepted=await prepared.host.accept(staged.operation_id,{write:true,receiptId:applied.receipt.receipt_id});
 assert.equal(accepted.written,true);assert.equal(artifacts.ownerPending(),false);
 const afterConfirmation=prepared.host.inspect(prepared.id);
 assert(afterConfirmation.cursor.occurrences.some(f=>f.operation?.receipt?.outcome==='blocked'));
 assert(!afterConfirmation.record.events.some(e=>e.kind==='operation_result'&&e.receipt.operation_id===staged.operation_id&&e.receipt.effect_status==='confirmed'));
 let freshCAS=0;const freshHost=compose(prepared.id,{boundary:point=>{if(point==='after_packet_cas')freshCAS++;}});
 const occurrence=afterConfirmation.cursor.occurrences.find(f=>f.operation?.intent?.operation_id===staged.operation_id);
 const freshPreview=await freshHost.preview({instanceId:prepared.id,expectedSha256:afterConfirmation.record.instance_sha256,
  occurrenceId:occurrence.occurrence_id,input});
 assert.equal(freshPreview.prepared.can_apply,true);
 allowed=false;
 await readonly('fresh intention requires a new current operation grant',()=>assert.rejects(freshHost.stage(freshPreview,{write:true,expectedPreviewSha256:H(freshPreview)}),{code:'FIXTURE_CURRENT_GRANT_REQUIRED'}));
 allowed=true;
 const fresh=await freshHost.stage(freshPreview,{write:true,expectedPreviewSha256:H(freshPreview)});
 assert.notEqual(fresh.operation_id,staged.operation_id);
 const published=await freshHost.dispatch(fresh.operation_id,{write:true});
 assert.equal(published.receipt.outcome,'completed');assert.equal(published.receipt.effect_status,'confirmed');assert.equal(freshCAS,1);
 await freshHost.accept(fresh.operation_id,{write:true});
 assert.deepEqual(freshHost.readJournal(staged.operation_id),first);
 assert.deepEqual(artifacts.readMany(['workflows/dispatch-records/'+staged.operation_id+'.json'],{includeMetadata:true}),retainedCapsule);
 const final=freshHost.inspect(prepared.id).record;
 const replayInput={instanceId:final.instance_id,model,policyPins:final.policy_pins,scopeId:final.scope_id,facts:final.initial_facts};
 let replay=createAgenticProcess(replayInput);for(const event of final.events)replay=advanceAgenticProcess(replay,event);
 assert.equal(replay.instance_sha256,final.instance_sha256);
 assert.equal(simulateAgenticProcess({...replayInput,events:final.events}).trace.at(-1).instance_sha256,final.instance_sha256);
 assert.equal(artifacts.ownerPending(),false);
 const phases=fs.readFileSync(configFile+'.phases.jsonl','utf8').trim().split('\n').map(JSON.parse);assert(phases.some(row=>row.point==='before_packet_cas'));assert(!phases.some(row=>row.point==='after_packet_cas'));
 const result={status:'PASS_BEFORE_EFFECT_DISPOSITION_AND_FRESH_INTENT_COMPONENT',mode,root,control,operation_id:staged.operation_id,fresh_operation_id:fresh.operation_id,actual_boundary:'before_packet_cas',actual_producer_identity:message.identity,actual_producer_terminated:true,original_worker_bound_ms:120000,timer_expired:false,original_capsule_phase:capsule.phase,original_returned_results:0,current_confirmation_receipts:1,current_confirmation_outcome:'blocked',current_confirmation_effect_status:'no_effect',original_capsule_bytes_and_metadata_preserved:true,old_business_CAS_replayed:false,fresh_business_CAS_count:freshCAS,fresh_current_grant_required:true,same_ir_replay_simulation_equal:true,Native_clients:0,model_calls:0,full_published_IR:'NOT_RUN_BY_COMPONENT',full_A6:'NOT_ACHIEVED',complete_standard_workflow:false};
 fs.writeFileSync(path.join(control,'characterization.json'),JSON.stringify({...result,live_plan:livePlan,disposition_plan:plan,current_confirmation:applied.receipt,original_record:record,original_capsule:capsule,packet_before:packetBefore,capsule_snapshot:retainedCapsule},null,2)+'\n',{flag:'wx'});
 return result;
} finally {
 clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();exit??=await ended;
 fs.writeFileSync(configFile+'.exit.json',JSON.stringify({identity:message?.identity??null,exit,stderr,timer_expired:timerExpired,original_worker_bound_ms:120000})+'\n',{flag:'wx'});
}

}
