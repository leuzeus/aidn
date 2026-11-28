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
  const host=createStandardWorkflowOperationHost({targetRoot:c.root,model:c.model,now:()=>c.clock,readSigningKey:()=>Buffer.from(c.key,'hex'),authorize:value=>({authorized:true,authority_id:'fixture_operator',principal_sha256:H('controlled operator'),grant_sha256:H({preview:value.preview_sha256,scope:value.scope_id})}),reconciliationConfiguration:{instance_id:c.id,target_root:c.root,control_root:c.control},handoffResourceSource:source,handoffNativeHistory:()=>({instance_id:c.id,scope_id:null,model_sha256:null,journal_id:null,journal_sha256:null,retained_history_status:'not_allocated',entries:[],permits_effects:false,complete_resource_closure:false})},{dispatchCheckpoint:async point=>{phase(point);},handoffPublicationBoundary:point=>{phase(point);if(point==='after_packet_cas')throw Object.assign(Error('FIXTURE_LOST_AFTER_PACKET_CAS'),{code:'FIXTURE_LOST_AFTER_PACKET_CAS'});}});
  phase('host_opened');
  const result=await host.dispatch(c.operation_id,{write:true}),record=host.readJournal(c.operation_id);
  assert.equal(result.status,'receipted');assert.equal(record.results[0].output.effect_status,'unknown');
  const a=createStandardWorkflowArtifacts({targetRoot:c.root}),capsule=JSON.parse(a.read('workflows/dispatch-records/'+c.operation_id+'.json',{required:true}).content);
  fs.writeFileSync(configFile+'.returned.json',JSON.stringify({result,identity:capsule.process_identity})+'\n',{flag:'wx'});
  process.on('message',()=>{}); // Keep the IPC handle referenced until the parent terminates this actual owner.
  process.send({status:'unknown_returned',identity:capsule.process_identity});
  await new Promise(()=>{});
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyStandardHandoffContinuation(process.argv[2])));
}
export async function verifyStandardHandoffContinuation(mode) {
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
function compose(id,{boundary,onDispatch,asyncGrant=false}={}){const configuration={instance_id:id,target_root:root,control_root:control};let host;const checkpoint=async(...args)=>{if(args[0]==="dispatch_reserved"){const live=host.observeResourceActivity();assert(live.current_dispatch_id);assert(live.active_dispatches.some(row=>row.dispatch_id===live.current_dispatch_id&&row.instance_id===id));await Promise.resolve();assert.equal(host.observeResourceActivity().current_dispatch_id,live.current_dispatch_id);}return onDispatch?.(...args);};host=createStandardWorkflowOperationHost({targetRoot:root,model,now:()=>clock,readSigningKey:()=>key,authorize:asyncGrant?async value=>grantFor(value):grantFor,reconciliationConfiguration:configuration,handoffResourceSource:source,handoffNativeHistory:()=>({instance_id:id,scope_id:null,model_sha256:null,journal_id:null,journal_sha256:null,retained_history_status:'not_allocated',entries:[],permits_effects:false,complete_resource_closure:false})},{handoffPublicationBoundary:boundary,dispatchCheckpoint:checkpoint});return host;}
const input={contract_version:'standard-handoff-publication-input.v1',next_agent_role:'coordinator',next_agent_action:'reanchor',next_agent_goal:'Resume from the retained canonical checkpoint.',handoff_note:'Keep original UNKNOWN and current resource obligations.',from_agent_role:'coordinator',from_agent_action:'relay'};
function tree(){const rows={};const walk=(at,base,label)=>{for(const e of fs.readdirSync(at,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(at,e.name),r=label+':'+path.relative(base,p);if(e.isSymbolicLink())rows[r]='LINK:'+fs.readlinkSync(p);else if(e.isDirectory()){rows[r+path.sep]='DIRECTORY';walk(p,base,label);}else rows[r]=H(fs.readFileSync(p).toString('base64'));}};walk(root,root,'project');walk(control,control,'control');return rows;}
let checks=0;async function readonly(name,run){const before=tree(),value=await run();assert.deepEqual(tree(),before,name);checks++;console.log('PASS '+name);return value;}
async function prepare(id,options={}){const host=compose(id,options),initial=host.initialize({instanceId:id});host.initialize({instanceId:id,write:true,expectedResultSha256:initial.record.instance_sha256});const current=host.inspect(id),frame=current.cursor.occurrences.find(row=>row.status==='READY');assert(frame);const preview=await readonly('canonical common preview is read-only for '+id,()=>host.preview({instanceId:id,expectedSha256:current.record.instance_sha256,occurrenceId:frame.occurrence_id,input:{...input,next_agent_goal:input.next_agent_goal+' '+id}}));assert.equal(preview.prepared.can_apply,true);return{host,id,preview,inner:decodeHandoffPacketPlan(preview.prepared.plan)};}
async function dispatch(c){const staged=await c.host.stage(c.preview,{write:true,expectedPreviewSha256:H(c.preview)});assert.equal(c.host.observeResourceActivity().active_dispatches.length,0);const pending=c.host.dispatch(staged.operation_id,{write:true});assert.equal(c.host.observeResourceActivity().current_dispatch_id,null);assert(c.host.observeResourceActivity().active_dispatches.some(row=>row.operation_id===staged.operation_id&&row.binding_ref==='handoff_packet_publish'));const result=await pending;assert.equal(c.host.observeResourceActivity().active_dispatches.length,0);assert.equal(result.status,'receipted');const record=c.host.readJournal(staged.operation_id);signer.verify(record);signer.verify(record.preview);assert.equal(record.results.length,1);assertHandoffOperationOutput(record.results[0].output);return{...c,operation_id:staged.operation_id,result,record,output:record.results[0].output};}


const prepared=await prepare('projection-continuation-physical');
const staged=await prepared.host.stage(prepared.preview,{write:true,expectedPreviewSha256:H(prepared.preview)});
const config={root,control,model,clock,key:key.toString('hex'),id:prepared.id,operation_id:staged.operation_id};
const configFile=path.join(control,'physical-worker.json');fs.writeFileSync(configFile,JSON.stringify(config)+'\n',{flag:'wx'});
const child=fork(fileURLToPath(import.meta.url),['--worker',configFile],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let stderr='',message,exit,timerExpired=false;child.stdout.resume();child.stderr.on('data',b=>{stderr+=b;if(stderr.length>16384)child.kill();});
const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
const timer=setTimeout(()=>{timerExpired=true;child.kill();},120000);
let record,capsule,originalLock;
try {
 message=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',m=>m.status==='unknown_returned'?resolve(m):reject(Error(JSON.stringify(m))));child.once('close',()=>reject(Error('WORKER_CLOSED_BEFORE_UNKNOWN:'+stderr.slice(-2048))));});
 record=prepared.host.readJournal(staged.operation_id);signer.verify(record);signer.verify(record.preview);
 capsule=JSON.parse(artifacts.read('workflows/dispatch-records/'+staged.operation_id+'.json',{required:true}).content);signer.verify(capsule);
 assert.equal(capsule.phase,'returned');assert.equal(capsule.output_sha256,H(record.results[0].output));
 assert.equal(capsule.leases.length,1);assert.equal(capsule.local_owner_intentions.length,1);
 assert.equal(observeLocalProcessOwner(message.identity),'active');
 const fence=artifacts.resourceFence(), before=tree(), current=fence.read();
 assert.throws(()=>fence.acquire({expectedSha256:current.content_sha256,dispositionLease:capsule.leases[0].resource_fence}),{code:'STANDARD_RESOURCE_FENCE_RECONCILIATION_REQUIRED'});
 assert.deepEqual(tree(),before);
 console.log('PASS real live original producer prevents exact-fence transfer without writes');
 child.kill();exit=await ended;assert.equal(observeLocalProcessOwner(message.identity),'terminated');
} finally {
 clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();exit??=await ended;
 fs.writeFileSync(configFile+'.exit.json',JSON.stringify({identity:message?.identity??null,exit,stderr,timer_expired:timerExpired,original_worker_bound_ms:120000,actual_process_termination:true})+'\n',{flag:'wx'});
}
assert.equal(timerExpired,false);
const journalSha=H(record),original=structuredClone(record.results[0]),instance=prepared.host.inspect(prepared.id).record;
const continuation=createStandardHandoffContinuation({targetRoot:root,readSigningKey:()=>key,readCurrent:id=>prepared.host.inspect(id).record,readClaimed:id=>prepared.host.readJournal(id)});
let permit=true,permitCalls=0;const currentPermit=()=>{permitCalls++;if(!permit)throw Object.assign(Error('FIXTURE_CONTINUATION_PERMISSION_REVOKED'),{code:'FIXTURE_CONTINUATION_PERMISSION_REVOKED',effect_status:'no_effect'});};
const cap=continuation.prepare(instance,record);cap.assertCurrent();
await readonly('cancelled preparation reads no signing key and a retained cancelled capture cannot write',async()=>{
 let keyReads=0;const checked=createStandardHandoffContinuation({targetRoot:root,readSigningKey:()=>{keyReads++;return key;},readCurrent:id=>prepared.host.inspect(id).record,readClaimed:id=>prepared.host.readJournal(id)});
 const cancelled=new AbortController();cancelled.abort();assert.throws(()=>checked.prepare(instance,record,{signal:cancelled.signal}),{code:'STANDARD_HANDOFF_CONTINUATION_ABORTED'});assert.equal(keyReads,0);
 const stop=new AbortController(),captured=checked.prepare(instance,record,{signal:stop.signal});stop.abort();assert.throws(()=>captured.assertCurrent(),{code:'STANDARD_HANDOFF_CONTINUATION_ABORTED'});
 await assert.rejects(captured.complete({write:true,assertAuthorizedCurrent(){throw Error('CANCELLED_PERMISSION_MUST_NOT_RUN');}}),{code:'STANDARD_HANDOFF_CONTINUATION_ABORTED'});
});
const wrong=structuredClone(record);wrong.results[0].receipt.output_sha256=H('substituted output');assert.throws(()=>handoffPublicationInterruptedPrefix(instance,wrong),{code:'STANDARD_HANDOFF_CONTINUATION_SUBJECT_REQUIRED'});

const originalLease=capsule.leases[0],intention=capsule.local_owner_intentions[0],fence=artifacts.resourceFence();
originalLock=inspectInterruptedReopenLock(root,staged.operation_id,intention,originalLease);
assert.equal(originalLock.retired,false);
const observedBefore=fence.read(),proposed=fence.prepareAcquire({expectedSha256:observedBefore.content_sha256});
const intent=signer.seal({profile:'fixture-only-projection-controller',operation_id:staged.operation_id,original_receipt_sha256:H(original.receipt),dispatch_sha256:H(capsule),lock_sha256:originalLock.sha256,state_sha256:cap.data.state_sha256,proposed_fence:proposed});
const intentFile=path.join(control,'fixture-continuation-intent.json');fs.writeFileSync(intentFile,JSON.stringify(intent)+'\n',{flag:'wx'});signer.verify(JSON.parse(fs.readFileSync(intentFile,'utf8')));
const lease=fence.acquire({prepared:proposed,expectedSha256:observedBefore.content_sha256,dispositionLease:originalLease.resource_fence});
const assertOwned=()=>{currentPermit();fence.assert(lease);assert.equal(observeLocalProcessOwner(message.identity),'terminated');assert.equal(H(prepared.host.readJournal(staged.operation_id)),journalSha);assert.equal(H(JSON.parse(fs.readFileSync(intentFile,'utf8'))),H(intent));};
const retired=retireInterruptedReopenLock({targetRoot:root,operationId:staged.operation_id,intention,originalLease,fence,dispositionLease:lease,expectedLockSha256:originalLock.sha256,assertPermit:assertOwned,write:true});assert.equal(retired.retired,true);
assert.equal(artifacts.localOwnerPending(),false);assert.equal(artifacts.ownerPending(),true);cap.assertCurrent();
console.log('PASS terminated exact original owner is renamed to its retained witness under a separate held fence');
const borrowed=plan=>Object.freeze({artifactContinuation:Object.freeze({operation_id:staged.operation_id,plan_sha256:plan,lease,assertCurrent:assertOwned})});
const beforeDenial=tree();permit=false;
await assert.rejects(withStandardDispatchContext(borrowed(cap.data.packet_plan_sha256),()=>cap.complete({write:true,assertAuthorizedCurrent:currentPermit})),{code:'FIXTURE_CONTINUATION_PERMISSION_REVOKED'});
assert.deepEqual(tree(),beforeDenial);permit=true;
await assert.rejects(withStandardDispatchContext(borrowed(H('substituted plan')),()=>cap.complete({write:true,assertAuthorizedCurrent:currentPermit})),{code:'STANDARD_HANDOFF_CONTINUATION_OWNER_REQUIRED'});
assert.deepEqual(tree(),beforeDenial);console.log('PASS current denial and foreign plan refuse before projection');
const canonicalBefore=artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),beforeProjection=tree();
const interrupted=createStandardHandoffContinuation({targetRoot:root,readSigningKey:()=>key,readCurrent:id=>prepared.host.inspect(id).record,readClaimed:id=>prepared.host.readJournal(id)},{boundary:point=>{if(point==='after_handoff_projection')throw Object.assign(Error('FIXTURE_PROJECTION_ACK_LOST'),{code:'FIXTURE_PROJECTION_ACK_LOST',effect_status:'no_effect'});}}).prepare(instance,record);
await assert.rejects(withStandardDispatchContext(borrowed(cap.data.packet_plan_sha256),()=>interrupted.complete({write:true,assertAuthorizedCurrent:currentPermit})),e=>e.code==='FIXTURE_PROJECTION_ACK_LOST'&&(mode!=='dual'||e.effect_status==='unknown'));
assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),canonicalBefore);
assert.equal(H(prepared.host.readJournal(staged.operation_id)),journalSha);
if(mode==='dual'){assert.notDeepEqual(tree(),beforeProjection);assert.equal(H(fs.readFileSync(path.join(root,'docs/audit/HANDOFF-PACKET.md'),'utf8')),H(prepared.inner.content));}
else assert.deepEqual(tree(),beforeProjection);
fence.assert(lease);assert.equal(artifacts.ownerPending(),true);
console.log('PASS lost projection acknowledgement preserves UNKNOWN and the controller lease without rewriting canonical bytes');
const fresh=continuation.prepare(instance,record);assert.equal(fresh.data.state.projection_status,mode==='db-only'?'not_requested':'current');
const afterProjection=tree();const completed=await withStandardDispatchContext(borrowed(cap.data.packet_plan_sha256),()=>fresh.complete({write:true,assertAuthorizedCurrent:currentPermit}));
assert.equal(completed.canonical_written,false);assert.equal(completed.projected,false);assert.equal(completed.effect_status,'confirmed');assert.equal(completed.effect_knowledge,'known_prefix');
assert.equal(H(completed.output),fresh.data.expected_output_sha256);assert.deepEqual(tree(),afterProjection);
assert.deepEqual(artifacts.readMany(['HANDOFF-PACKET.md'],{includeMetadata:true}),canonicalBefore);assert.deepEqual(prepared.host.readJournal(staged.operation_id).results,[original]);
fence.assert(lease);assert.equal(artifacts.ownerPending(),true);fence.release(lease);assert.equal(artifacts.ownerPending(),false);
assert.equal(inspectInterruptedReopenLock(root,staged.operation_id,intention,originalLease,{allowRetired:true}).retired,true);
console.log('PASS fresh confirmation writes no second projection and only its owning controller releases the new lease');
const accepted=await prepared.host.accept(staged.operation_id,{write:true});assert.equal(accepted.written,true);
assert.deepEqual(prepared.host.readJournal(staged.operation_id).results,[original]);
assert.throws(()=>fresh.assertCurrent(),{code:'STANDARD_HANDOFF_CONTINUATION_SUBJECT_CHANGED'});
const afterAcceptance=continuation.prepare(prepared.host.inspect(prepared.id).record,prepared.host.readJournal(staged.operation_id));afterAcceptance.assertCurrent();
assert.equal(afterAcceptance.data.original_receipt_sha256,H(original.receipt));assert.equal(artifacts.ownerPending(),false);
console.log('PASS accepted UNKNOWN keeps its original result and only its exact interrupted intent prefix is reconstructed');

return { status:'PASS_PHYSICAL_UNKNOWN_HANDOFF_PROJECTION_CONTINUATION_COMPONENT',mode,root,control,original_unknown_preserved:true,original_producer:message.identity,actual_process_termination:true,retirement_witness_preserved:true,original_worker_bound_ms:120000,canonical_CAS_replayed:false,Native_clients:0,model_calls:0,provider_calls:0,permission:'CONTROLLED_FIXTURE_CAPABILITY',controller:'FIXTURE_ONLY_NOT_PRODUCT_DISPOSITION',public_disposition_and_cold_adoption:'NOT_IMPLEMENTED',complete_standard_workflow:false };
}
