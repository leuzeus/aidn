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
import { decodeHandoffPacketPlan, assertHandoffOperationOutput } from "../../src/core/workflow/standard-handoff-operation.mjs";
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
  const host=createStandardWorkflowOperationHost({targetRoot:c.root,model:c.model,now:()=>c.clock,readSigningKey:()=>Buffer.from(c.key,'hex'),authorize:value=>({authorized:true,authority_id:'fixture_operator',principal_sha256:H('controlled operator'),grant_sha256:H({preview:value.preview_sha256,scope:value.scope_id})}),reconciliationConfiguration:{instance_id:c.id,target_root:c.root,control_root:c.control},dispositionSource:workerDisposition,handoffResourceSource:source,handoffNativeHistory:()=>({instance_id:c.id,scope_id:null,model_sha256:null,journal_id:null,journal_sha256:null,retained_history_status:'not_allocated',entries:[],permits_effects:false,complete_resource_closure:false})},{dispatchCheckpoint:async point=>{phase(point);if(c.plan&&point===c.boundary){const a=createStandardWorkflowArtifacts({targetRoot:c.root});const identity=point==='disposition_control_reserved'?JSON.parse(a.read('workflows/operation-control-intents/'+c.operation_id+'.json',{required:true}).content).attempts.at(-1).resource_fence.record.process_identity:a.resourceFence().read().record.process_identity;assert.equal(identity.pid,process.pid);process.send({status:'controller_boundary',boundary:point,identity});await new Promise(()=>{});}},handoffPublicationBoundary:point=>{phase(point);if(point==='after_packet_cas'){if(c.unreturned){const a=createStandardWorkflowArtifacts({targetRoot:c.root}),record=host.readJournal(c.operation_id),capsule=JSON.parse(a.read('workflows/dispatch-records/'+c.operation_id+'.json',{required:true}).content);assert.equal(record.phase,'dispatching');assert.deepEqual(record.results,[]);assert.equal(capsule.phase,'running');assert.equal(capsule.output,null);const marker=configFile+'.packet-cas.json';fs.writeFileSync(marker+'.tmp',JSON.stringify({status:'packet_cas_before_first_result',identity:capsule.process_identity})+'\n',{flag:'wx'});fs.renameSync(marker+'.tmp',marker);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}throw Object.assign(Error('FIXTURE_LOST_AFTER_PACKET_CAS'),{code:'FIXTURE_LOST_AFTER_PACKET_CAS'});}}});
  phase('host_opened');
  const result=c.receipt_id?await host.accept(c.operation_id,{write:true,receiptId:c.receipt_id}):c.plan?await host.applyOperationDisposition(c.plan,{write:true,expectedPlanSha256:H(c.plan)}):await host.dispatch(c.operation_id,{write:true}),record=host.readJournal(c.operation_id);
  assert.equal(result.status,'receipted');assert.equal(record.results[0].output.effect_status,'unknown');
  const a=createStandardWorkflowArtifacts({targetRoot:c.root}),capsule=JSON.parse(a.read('workflows/dispatch-records/'+c.operation_id+'.json',{required:true}).content);
  fs.writeFileSync(configFile+'.returned.json',JSON.stringify({result,identity:capsule.process_identity})+'\n',{flag:'wx'});
  process.on('message',()=>{}); // Keep the IPC handle referenced until the parent terminates this actual owner.
  process.send({status:'unknown_returned',identity:capsule.process_identity});
  await new Promise(()=>{});
} else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.log(JSON.stringify(await verifyStandardHandoffDisposition(process.argv[2],{only:process.argv.find(a=>a.startsWith('--case='))?.slice(7)??null,unreturned:process.argv.includes('--unreturned')})));
}
export async function verifyStandardHandoffDisposition(mode,{only=null,unreturned=false}={}){
 const cases=['nominal','disposition_recorded','permission_revoked','cancelled',...(mode==='dual'?['projection_ack_lost']:[]),'disposition_control_reserved','disposition_fence_acquired','handoff_continuation_owner_retired','handoff_continuation_projected','disposition_receipted','disposition_acceptance_committed'];if(only!==null&&!cases.includes(only))throw Error('FIXTURE_CASE_INVALID');
 const results=[];for(const name of cases)if(only===null||only===name)results.push(await runCase(mode,name,{unreturned}));
 return {status:unreturned?'PASS_UNRETURNED_HANDOFF_DISPOSITION_COMPONENT':'PASS_PUBLIC_HANDOFF_DISPOSITION_COMPONENT',original_result_count:unreturned?0:1,mode,cases:results.map(r=>r.scenario??'nominal'),results,Native_clients:0,model_calls:0,complete_standard_workflow:false};
}
async function runCase(mode,scenario,{unreturned=false}={}){
const assertPlan=unreturned?assertUnreturnedHandoffContinuationPlan:assertHandoffContinuationPlan;
const assertAudit=unreturned?assertUnreturnedHandoffContinuationDisposition:assertHandoffContinuationDisposition;
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


const refusalSignal=new AbortController();
const prepared=await prepare('projection-continuation-physical-bounded',{boundary:point=>{
 if(point==='before_handoff_projection'){if(scenario==='permission_revoked')dispositionAllowed=false;else if(scenario==='cancelled')refusalSignal.abort();}
 if(point==='after_handoff_projection'&&scenario==='projection_ack_lost')throw Object.assign(Error('FIXTURE_PUBLIC_PROJECTION_ACK_LOST'),{code:'FIXTURE_PUBLIC_PROJECTION_ACK_LOST',effect_status:'no_effect'});
}});
const staged=await prepared.host.stage(prepared.preview,{write:true,expectedPreviewSha256:H(prepared.preview)});
const config={root,control,model,clock,key:key.toString('hex'),id:prepared.id,operation_id:staged.operation_id,unreturned};
const configFile=path.join(control,'physical-worker.json');fs.writeFileSync(configFile,JSON.stringify(config)+'\n',{flag:'wx'});
const child=fork(fileURLToPath(import.meta.url),['--worker',configFile],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let stderr='',message,exit,timerExpired=false;child.stdout.resume();child.stderr.on('data',b=>{stderr+=b;if(stderr.length>16384)child.kill();});
const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
const timer=setTimeout(()=>{timerExpired=true;child.kill();},120000);
let record,capsule,originalLock;
try {
 message=unreturned?await new Promise((resolve,reject)=>{const marker=configFile+'.packet-cas.json';let interval;const done=(error,value)=>{clearInterval(interval);error?reject(error):resolve(value);};interval=setInterval(()=>{try{if(fs.existsSync(marker))done(null,JSON.parse(fs.readFileSync(marker,'utf8')));}catch(error){done(error);}},25);child.once('error',error=>done(error));child.once('close',()=>done(Error('WORKER_CLOSED_BEFORE_PACKET_CAS:'+stderr.slice(-2048))));}):await new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',m=>m.status==='unknown_returned'?resolve(m):reject(Error(JSON.stringify(m))));child.once('close',()=>reject(Error('WORKER_CLOSED_BEFORE_UNKNOWN:'+stderr.slice(-2048))));});
 record=prepared.host.readJournal(staged.operation_id);signer.verify(record);signer.verify(record.preview);
 capsule=JSON.parse(artifacts.read('workflows/dispatch-records/'+staged.operation_id+'.json',{required:true}).content);signer.verify(capsule);
 assert.equal(capsule.phase,unreturned?'running':'returned');assert.equal(capsule.output_sha256,unreturned?null:H(record.results[0].output));if(unreturned){assert.equal(capsule.output,null);assert.equal(capsule.context_after_sha256,null);assert.equal(record.phase,'dispatching');assert.deepEqual(record.results,[]);}
 assert.equal(capsule.leases.length,1);assert.equal(capsule.local_owner_intentions.length,1);
 assert.equal(observeLocalProcessOwner(message.identity),'active');
 const fence=artifacts.resourceFence(), before=tree(), current=fence.read();
 assert.throws(()=>fence.acquire({expectedSha256:current.content_sha256,dispositionLease:capsule.leases[0].resource_fence}),{code:'STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED'});
 assert.deepEqual(tree(),before);
 console.log('PASS real live original producer prevents exact-fence transfer without writes');
 if(unreturned){const liveState=prepared.host.inspect(prepared.id).record,livePlan=await readonly('live unreturned publisher prepares no v4 transfer',()=>prepared.host.prepareOperationDisposition(staged.operation_id,{expectedSha256:liveState.instance_sha256}));assert.equal(livePlan.contract_version,'process-operation-disposition-plan.v1');assert.equal(livePlan.assessment,'unknown');const refused=await readonly('live unreturned publisher application remains UNKNOWN without a grant',()=>prepared.host.applyOperationDisposition(livePlan,{write:true,expectedPlanSha256:H(livePlan)}));assert.equal(refused.status,'reconciliation_required');assert.equal(refused.written,false);assert.equal(dispositionRequests.length,0);}
 child.kill();exit=await ended;assert.equal(observeLocalProcessOwner(message.identity),'terminated');
} finally {
 clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();exit??=await ended;
 fs.writeFileSync(configFile+'.exit.json',JSON.stringify({identity:message?.identity??null,exit,stderr,timer_expired:timerExpired,original_worker_bound_ms:120000,actual_process_termination:true})+'\n',{flag:'wx'});
}
assert.equal(timerExpired,false);
const opid=staged.operation_id,original=unreturned?null:structuredClone(record.results[0]),originalResults=unreturned?[]:[original],originalCount=originalResults.length,capsuleSha=H(capsule);
const packetBefore=artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true});
if(!unreturned){const originalAccepted=await prepared.host.accept(opid,{write:true});assert.equal(originalAccepted.written,true);}
assert.deepEqual(prepared.host.readJournal(opid).results,originalResults);assert.equal(artifacts.ownerPending(),true);
const current=prepared.host.inspect(prepared.id).record,readOnly=tree();
const plan=await prepared.host.prepareOperationDisposition(opid,{expectedSha256:current.instance_sha256});
assert.deepEqual(tree(),readOnly);assert.equal(dispositionRequests.length,0);
assert.equal(plan.contract_version,unreturned?'process-operation-disposition-plan.v4':'process-operation-disposition-plan.v3');assert.equal(plan.assessment,'known_partial_handoff_publication');
assert.deepEqual(plan.continuation.owned_paths,['HANDOFF-PACKET.md']);assert.equal(plan.continuation.original_receipt_sha256,unreturned?null:H(original.receipt));if(unreturned)assert.equal(plan.output_sha256,null);
console.log('PASS actual public preparation selects its closed one-packet profile without grants or writes');
assertPlan(plan);const wrongPath=structuredClone(plan);wrongPath.continuation.owned_paths=['CURRENT-STATE.md'];assert.throws(()=>assertPlan(wrongPath),{code:'PROCESS_DISPOSITION_PLAN_INVALID'});
const relabel=structuredClone(plan);relabel.continuation.expected_output_sha256=relabel.output_sha256;assert.throws(()=>assertPlan(relabel),{code:'PROCESS_DISPOSITION_PLAN_INVALID'});assert.throws(()=>assertIncidentContinuationPlan(plan),{code:'PROCESS_DISPOSITION_PLAN_INVALID'});
if(unreturned){for(const field of ['output_sha256','original_receipt_sha256']){const invented=structuredClone(plan);if(field==='output_sha256')invented[field]=H('invented original output');else invented.continuation[field]=H('invented original receipt');assert.throws(()=>assertPlan(invented),{code:'PROCESS_DISPOSITION_PLAN_INVALID'});}assert.throws(()=>assertHandoffContinuationPlan(plan),{code:'PROCESS_DISPOSITION_PLAN_INVALID'});}
console.log('PASS closed handoff profile refuses foreign paths, relabelled or invented original results and the incident reader');

await assert.rejects(prepared.host.applyOperationDisposition(plan,{write:false,expectedPlanSha256:H(plan)}),{code:'STANDARD_HOST_EXPLICIT_WRITE_REQUIRED'});assert.deepEqual(tree(),readOnly);
dispositionAllowed=false;await assert.rejects(prepared.host.applyOperationDisposition(plan,{write:true,expectedPlanSha256:H(plan)}),{code:'FIXTURE_CURRENT_DISPOSITION_REQUIRED'});assert.deepEqual(tree(),readOnly);dispositionAllowed=true;
console.log('PASS explicit-write refusal and current consent denial precede any controller mutation');
if(['permission_revoked','cancelled'].includes(scenario)){
 const canonicalBefore=artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true});
 const projectionPath=path.join(root,'docs/audit/HANDOFF-PACKET.md'),beforeProjection=fs.existsSync(projectionPath)?fs.readFileSync(projectionPath):null;
 await assert.rejects(prepared.host.applyOperationDisposition(plan,{write:true,expectedPlanSha256:H(plan),signal:refusalSignal.signal}),error=>scenario==='permission_revoked'?error.code==='FIXTURE_CURRENT_DISPOSITION_REQUIRED':['STANDARD_HANDOFF_CONTINUATION_ABORTED','PROCESS_DISPOSITION_ABORTED'].includes(error.code));
 assert.deepEqual(prepared.host.readJournal(opid).results,originalResults);assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),canonicalBefore);
 assert.deepEqual(fs.existsSync(projectionPath)?fs.readFileSync(projectionPath):null,beforeProjection);
 const controls=JSON.parse(artifacts.read('workflows/operation-control-intents/'+opid+'.json',{required:true}).content);signer.verify(controls);
 const proposedControlFence=controls.attempts.at(-1).resource_fence.record,currentFence=artifacts.resourceFence().read().record;
 assert.equal(currentFence.token,proposedControlFence.token);assert.equal(currentFence.process_identity.pid,process.pid);assert.equal(currentFence.state,'released');
 assert.equal(fs.existsSync(path.join(root,'.aidn/runtime/standard-workflow/retired-'+opid+'.lock')),true);assert.equal(artifacts.ownerPending(),false);
 if(unreturned){assert.equal(prepared.host.readJournal(opid).phase,'dispatching');assert.deepEqual(prepared.host.readJournal(opid).results,[]);}else assert(prepared.host.inspect(prepared.id).cursor.occurrences.some(f=>f.operation?.intent.operation_id===opid&&f.status==='WAITING'));
 console.log('PASS '+scenario+' closes its own proved no-effect control and preserves original dispatch history');
 return{status:'PASS_CURRENT_CONTROL_REFUSAL_CLEANUP_COMPONENT',scenario,mode,root,control,original_unknown_preserved:!unreturned,original_unreturned_dispatch_preserved:unreturned,original_result_count:originalCount,new_controller_lease_closed:true,canonical_CAS_replayed:false,projection_attempted:false,Native_clients:0,model_calls:0,complete_standard_workflow:false};
}
if(scenario==='projection_ack_lost'){
 const result=await prepared.host.applyOperationDisposition(plan,{write:true,expectedPlanSha256:H(plan)});
 assert.equal(result.status,'receipted');assert.equal(result.receipt.outcome,'reconciliation_required');assert.equal(result.receipt.effect_status,'unknown');
 const now=prepared.host.readJournal(opid);assert.equal(now.results.length,originalCount+1);assert.deepEqual(now.results.slice(0,originalCount),originalResults);assert.deepEqual(now.results[originalCount].output.facts,{});
 const audit=JSON.parse(artifacts.read('workflows/operation-dispositions/'+opid+'.json',{required:true}).content);signer.verify(audit);assertAudit(audit);assert.equal(audit.effect_knowledge,'unknown');
 assert.equal(artifacts.resourceFence().read().record.state,'held');assert.equal(artifacts.ownerPending(),true);
 assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),packetBefore);assert(fs.existsSync(path.join(root,'docs/audit/HANDOFF-PACKET.md')));
 console.log('PASS loss after actual DUAL projection retains a new UNKNOWN and its owner even with a nested no-effect tag');
 return{status:'PASS_UNKNOWN_PROJECTION_OWNER_RETAINED_COMPONENT',scenario,mode,root,control,original_unknown_preserved:!unreturned,original_unreturned_dispatch_preserved:unreturned,original_result_count:originalCount,new_unknown_preserved:true,new_controller_lease_held:true,canonical_CAS_replayed:false,Native_clients:0,model_calls:0,complete_standard_workflow:false};
}
let adoptionPlan=plan,resumedHost=prepared.host,applied,adopted;
if(scenario!=='nominal'){
const accepting=scenario==='disposition_acceptance_committed';
const initial=accepting?await prepared.host.applyOperationDisposition(plan,{write:true,expectedPlanSha256:H(plan)}):null;
const controllerConfig=path.join(control,'controller-interruption.json');fs.writeFileSync(controllerConfig,JSON.stringify({...config,plan,boundary:scenario,...(accepting?{receipt_id:initial.receipt.receipt_id}:{})})+'\n',{flag:'wx'});
const controller=fork(fileURLToPath(import.meta.url),['--worker',controllerConfig],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let controllerStderr='',controllerMessage,controllerExit,controllerTimedOut=false;controller.stdout.resume();controller.stderr.on('data',b=>{controllerStderr+=b;if(controllerStderr.length>16384)controller.kill();});
const controllerEnded=new Promise(resolve=>controller.once('close',(code,signal)=>resolve({code,signal}))),controllerTimer=setTimeout(()=>{controllerTimedOut=true;controller.kill();},120000);
try{controllerMessage=await new Promise((resolve,reject)=>{controller.once('error',reject);controller.once('message',m=>m.status==='controller_boundary'&&m.boundary===scenario?resolve(m):reject(Error(JSON.stringify(m))));controller.once('close',()=>reject(Error('CONTROLLER_CLOSED_BEFORE_BOUNDARY:'+controllerStderr.slice(-2048))));});assert.equal(observeLocalProcessOwner(controllerMessage.identity),'active');
if(scenario==='disposition_fence_acquired'){
 const retainedFence=artifacts.resourceFence().read(),retainedInstance=prepared.host.inspect(prepared.id).record,retainedJournal=prepared.host.readJournal(opid);
 const retainedCapsule=artifacts.read('workflows/dispatch-records/'+opid+'.json',{required:true}),retainedPacket=artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true});
 const contender=compose(prepared.id,{boundary:point=>{if(['before_packet_cas','before_handoff_projection'].includes(point))throw Error('LIVE_CONTENDER_MUST_NOT_ENTER_BUSINESS');}});
 const candidate=await readonly('active controller permits only read-only contender preparation',()=>contender.prepareOperationDisposition(opid,{expectedSha256:retainedInstance.instance_sha256}));
 await assert.rejects(contender.applyOperationDisposition(candidate,{write:true,expectedPlanSha256:H(candidate)}),{code:'STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED'});
 assert.equal(observeLocalProcessOwner(controllerMessage.identity),'active');assert.deepEqual(artifacts.resourceFence().read(),retainedFence);
 assert.deepEqual(prepared.host.inspect(prepared.id).record,retainedInstance);assert.deepEqual(prepared.host.readJournal(opid),retainedJournal);
 assert.deepEqual(artifacts.read('workflows/dispatch-records/'+opid+'.json',{required:true}),retainedCapsule);assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),retainedPacket);
 const competingControls=JSON.parse(artifacts.read('workflows/operation-control-intents/'+opid+'.json',{required:true}).content);signer.verify(competingControls);assert.equal(competingControls.attempts.length,2);
 assert.equal(artifacts.ownerPending(),true);console.log('PASS actual live controller retains its exact fence while a distinct current-grant contender is refused before business');
}
controller.kill();controllerExit=await controllerEnded;assert.equal(observeLocalProcessOwner(controllerMessage.identity),'terminated');}
finally{clearTimeout(controllerTimer);if(controller.exitCode===null&&controller.signalCode===null)controller.kill();controllerExit??=await controllerEnded;fs.writeFileSync(controllerConfig+'.exit.json',JSON.stringify({boundary:scenario,identity:controllerMessage?.identity??null,exit:controllerExit,stderr:controllerStderr,original_worker_bound_ms:120000,timer_expired:controllerTimedOut})+'\n',{flag:'wx'});}
assert.equal(controllerTimedOut,false);
const receipted=['disposition_receipted','disposition_acceptance_committed'].includes(scenario),capturedExpected=receipted||scenario==='disposition_recorded';
const retained=prepared.host.readJournal(opid);assert.deepEqual(retained.results.slice(0,originalCount),originalResults);assert.equal(retained.results.length,originalCount+(receipted?1:0));
const auditPath='workflows/operation-dispositions/'+opid+'.json',audit=artifacts.read(auditPath),captured=audit.content?JSON.parse(audit.content):null;
assert.equal(Boolean(captured),capturedExpected);if(captured){signer.verify(captured);signer.verify(captured.plan);assert.equal(captured.results.length,1);assert.equal(captured.output.outcome,'completed');}assert.equal(artifacts.ownerPending(),true);
const projectionPath=path.join(root,'docs/audit/HANDOFF-PACKET.md'),projectionIdentity=fs.existsSync(projectionPath)?fs.statSync(projectionPath,{bigint:true}):null;
let businessCalls=0;resumedHost=compose(prepared.id,{boundary:point=>{if(point==='before_packet_cas')throw Error('CANONICAL_CAS_MUST_NOT_REPLAY');if(point==='before_handoff_projection'){businessCalls++;if(capturedExpected)throw Error('CAPTURED_BUSINESS_MUST_NOT_RERUN');}}});
const freshState=resumedHost.inspect(prepared.id).record;
if(accepting){
 const cleanupPreview=resumedHost.prepareAcceptedOperationControl(prepared.id,{expectedSha256:freshState.instance_sha256});assert.equal(cleanupPreview.operation_id,opid);
 const retired=await resumedHost.accept(opid,{write:true,receiptId:initial.receipt.receipt_id});assert.equal(retired.written,true);assert.equal(resumedHost.inspect(prepared.id).record.instance_sha256,freshState.instance_sha256);applied=initial;
}else{
 adoptionPlan=await resumedHost.prepareOperationDisposition(opid,{expectedSha256:freshState.instance_sha256});if(!receipted)assert.notEqual(H(adoptionPlan),H(plan));
 applied=await resumedHost.applyOperationDisposition(adoptionPlan,{write:true,expectedPlanSha256:H(adoptionPlan)});
 if(captured)assert.equal(H(applied.receipt),H(captured.receipt));
}
assert.equal(businessCalls,capturedExpected?0:1);
adopted=JSON.parse(artifacts.read(auditPath,{required:true}).content);signer.verify(adopted);assert.equal(adopted.results.length,1);
if(scenario==='disposition_recorded'){assert.equal(adopted.attempts.length,1);assert.equal(H(adopted.results),H(captured.results));}
const shouldKeepProjection=mode!=='dual'||['handoff_continuation_projected','disposition_recorded','disposition_receipted','disposition_acceptance_committed'].includes(scenario);
if(mode!=='db-only'&&shouldKeepProjection){assert(projectionIdentity);const after=fs.statSync(projectionPath,{bigint:true});assert.equal(after.ino,projectionIdentity.ino);assert.equal(after.mtimeNs,projectionIdentity.mtimeNs);}if(mode==='db-only')assert.equal(fs.existsSync(projectionPath),false);
console.log('PASS actual controller termination at '+scenario+' resumes with fresh control and no repeated confirmed effect');

}else{
 applied=await prepared.host.applyOperationDisposition(plan,{write:true,expectedPlanSha256:H(plan)});
 adopted=JSON.parse(artifacts.read('workflows/operation-dispositions/'+opid+'.json',{required:true}).content);
}
assert(['receipted','retained_result'].includes(applied.status));assert.equal(applied.receipt.outcome,'completed');assert.equal(applied.receipt.effect_status,'confirmed');
const recovered=prepared.host.readJournal(opid);assert.equal(recovered.results.length,originalCount+1);assert.deepEqual(recovered.results.slice(0,originalCount),originalResults);
if(original)assert.notEqual(H(recovered.results[originalCount].receipt),H(original.receipt));assert.equal(H(recovered.results[originalCount].output),plan.continuation.expected_output_sha256);assert.equal(recovered.results[originalCount].receipt.receipt_id,'receipt_'+opid.slice(3)+(originalCount?'_'+originalCount:''));
assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),packetBefore);
assert.equal(H(JSON.parse(artifacts.read('workflows/dispatch-records/'+opid+'.json',{required:true}).content)),capsuleSha);
if(scenario!=='disposition_receipted')assert.equal(artifacts.ownerPending(),false);assert.equal(fs.existsSync(path.join(root,'.aidn/runtime/standard-workflow/retired-'+opid+'.lock')),true);
if(mode==='db-only')assert.equal(fs.existsSync(path.join(root,'docs/audit/HANDOFF-PACKET.md')),false);
console.log('PASS public apply retires exact old owner and appends a distinct confirmation without packet CAS replay');
if(scenario!=='disposition_acceptance_committed'){const accepted=await resumedHost.accept(opid,{write:true,receiptId:applied.receipt.receipt_id});assert.equal(accepted.written,true);}
const final=prepared.host.inspect(prepared.id);if(original)assert(final.record.events.some(e=>e.kind==='operation_result'&&H(e.receipt)===H(original.receipt)));else assert.equal(final.record.events.filter(e=>e.kind==='operation_result'&&e.receipt.operation_id===opid).length,1);assert(final.record.events.some(e=>e.kind==='operation_result'&&H(e.receipt)===H(applied.receipt)));
assert.equal(artifacts.ownerPending(),false);assert.equal(dispositionRequests.filter(r=>r.action==='operation_disposition').length,scenario==='disposition_receipted'?0:scenario==='disposition_fence_acquired'?2:1);assert.equal(dispositionRequests.filter(r=>r.action==='operation_disposition_accept').length,1);
const stable=tree();dispositionAllowed=false;const duplicate=await resumedHost.applyOperationDisposition(adoptionPlan,{write:true,expectedPlanSha256:H(adoptionPlan)});assert.equal(duplicate.status,'retained_result');assert.deepEqual(duplicate.receipt,applied.receipt);assert.deepEqual(tree(),stable);
console.log('PASS common acceptance preserves original dispatch history and duplicate apply returns retained receipt without another grant/effect');
assertAudit(adopted);const forgedAudit=structuredClone(adopted);forgedAudit.results[0].receipt.output_sha256=H('foreign output');assert.throws(()=>assertAudit(forgedAudit),{code:'PROCESS_DISPOSITION_RECORD_INVALID'});
const replayInput={instanceId:final.record.instance_id,model,policyPins:final.record.policy_pins,scopeId:final.record.scope_id,facts:final.record.initial_facts};let replay=createAgenticProcess(replayInput);for(const event of final.record.events)replay=advanceAgenticProcess(replay,event);assert.equal(replay.instance_sha256,final.record.instance_sha256);
const simulation=simulateAgenticProcess({...replayInput,events:final.record.events});assert.equal(simulation.trace.at(-1).instance_sha256,final.record.instance_sha256);
console.log('PASS recovered execution, replay and SIM use the same IR and reducer; substituted audit output refuses');

return {status:'PASS_PUBLIC_HANDOFF_DISPOSITION_COMPONENT',mode,root,control,original_unknown_preserved:!unreturned,original_unreturned_dispatch_preserved:unreturned,original_result_count:originalCount,follow_on_receipts:1,canonical_CAS_replayed:false,actual_original_producer_termination:true,permission_source:'CONTROLLED_FIXTURE_CURRENT_OPERATOR',Native_clients:0,model_calls:0,genuine_normal_entry:'NOT_RUN',scenario,live_contender_refusal:scenario==='disposition_fence_acquired',cold_controller_kill_boundaries:scenario==='nominal'?[]:[scenario],captured_receipt_adopted_exactly_once:scenario==='disposition_recorded',complete_standard_workflow:false};
}
