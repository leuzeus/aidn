import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { resolveStandardWorkflowConfiguration } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { createStandardWorkflowMixedHost } from '../../src/application/runtime/standard-workflow-mixed-composition.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardHandoffPublication } from '../../src/application/runtime/standard-handoff-publication.mjs';
import { createCanonicalHandoffProjection } from '../../src/application/runtime/canonical-handoff-projection.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from '../../src/core/agents/codex-startup-arguments.mjs';
import { assertHandoffPublicationPlan, assertHandoffPublicationOutput } from '../../src/core/workflow/standard-handoff-publication.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { preWriteAdmit } from '../runtime/pre-write-admit.mjs';
const mode = process.argv[2] ?? 'dual'; assert(["dual","db-only"].includes(mode)); assert.equal(process.argv.length,3);
const owned = [], root = createFreshStandardWorkflowFixture(mode, owned, { absentOptionalDocuments: ['HANDOFF-PACKET.md'] });
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'aidn-handoff-publication-')); owned.push(base);
const sha=b=>createHash('sha256').update(b).digest('hex'), pin=p=>({path:p,sha256:sha(fs.readFileSync(p))});
fs.mkdirSync(path.join(root,'product'));
for(const n of ['control','review','home','authority'])fs.mkdirSync(path.join(base,n));
fs.writeFileSync(path.join(root,'product/app.mjs'),'export const value = 1;\n');fs.writeFileSync(path.join(base,'criteria.md'),'Retain the canonical handoff packet without starting Native.\n');
const request={contract_version:'standard-workflow-execution.v1',execution:{instance_id:'handoff-publication-case',target_root:root,product_root:path.join(root,'product'),product_files:['app.mjs'],
 control_root:path.join(base,'control'),review_root:path.join(base,'review'),criteria:pin(path.join(base,'criteria.md')),authorities:{project:pin(path.join(root,'AGENTS.md'))},instructions:{},controller:{},
 native:{executable:process.execPath,sha256:pin(process.execPath).sha256,home:path.join(base,'home'),tool_roots:[],protected_roots:[path.join(base,'authority')],hook_hashes:{work:['sha256:'+'a'.repeat(64),'sha256:'+'b'.repeat(64)],review:[]},model:'fixture-no-native',effort:'medium',
 startup:{mcp_server_ids:[],plugin_ids:[],app_ids:[],environment_override_names:[],environment_names:[...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],log_dir:path.join(base,'control'),sqlite_home:path.join(base,'control')}}},
 parameters:{session:{session_id:'S001',session_branch:'S001-handoff',objective:'Canonical packet fixture'},cycle:{cycle_id:'C001',cycle_type:'FEATURE',title:'Unused cycle',objective:'No cycle allocation'}}};
const resolved=resolveStandardWorkflowConfiguration(request), configuration=resolved.configuration, environment={...process.env,AIDN_STANDARD_HOST_HOME:path.join(base,'authority')};
const authority=createStandardHostAuthority({configuration,environment},{useProvider:false});
authority.ensureKey(); // Explicit owned fixture setup before Mixed construction.
let clock=Date.now(),sourceAllowed=true,allowed=true,permissionChecks=0; const sourceExpiry=clock+3600000;
const source={async read({request:q}){return{contract_version:'standard-handoff-resource-observation.v1',authority_id:'fixture_handoff_discoverer',request_sha256:H(q),observed_at_ms:clock,evidence_class:'fixture',
 evidence_refs:[{ref:'fixture:controlled-independent-discovery',sha256:H(q)}],domains:['deterministic','native','human','control','process','git','provider'].map(domain=>({domain,complete:true,active_resources:0,state:'closed',evidence_refs:[{ref:'fixture:controlled-domain-'+domain,sha256:H({q,domain})}]}))};},
 async verify({request:q,observation}){return{outcome:'verified',authority_id:observation.authority_id,request_sha256:H(q),observation_sha256:H(observation),evidence_class:'fixture'};},
 assertCurrent(){if(!sourceAllowed)throw Object.assign(Error('FIXTURE_SOURCE_REVOKED'),{code:'FIXTURE_SOURCE_REVOKED'});if(clock>=sourceExpiry)throw Object.assign(Error('FIXTURE_ORIGINAL_ISSUER_EXPIRED'),{code:'FIXTURE_ORIGINAL_ISSUER_EXPIRED'});}};
const host=createStandardWorkflowMixedHost({configuration,now:()=>clock,modelSource:resolved.modelSource,readSigningKey:()=>authority.readKey(),environment,authorize:async()=>{throw Error('UNEXPECTED_HOST_EFFECT');},handoffResourceSource:source,nativeAuthorizationSource:authority.nativeAuthorizationSource});
const initial=host.initialize({parameters:request.parameters});host.initialize({parameters:request.parameters,write:true,expectedResultSha256:initial.record.instance_sha256});
const artifacts=createStandardWorkflowArtifacts({targetRoot:root}), signer=createOperationJournalSigner(()=>authority.readKey());
const resources={prepare:host.prepareHandoffResourceRequest,observeForPublication:host.observeHandoffResourcesForPublication};
const authorization={async verify({plan,plan_sha256}){assert.equal(H(plan),plan_sha256);permissionChecks++;if(!allowed)throw Object.assign(Error('FIXTURE_CURRENT_GRANT_REQUIRED'),{code:'FIXTURE_CURRENT_GRANT_REQUIRED'});},
 assertCurrent(){if(!allowed)throw Object.assign(Error('FIXTURE_CURRENT_GRANT_REQUIRED'),{code:'FIXTURE_CURRENT_GRANT_REQUIRED'});}};
const compose=boundary=>createStandardHandoffPublication({targetRoot:root,readCurrent:()=>host.inspectDiagnostic().record,resources,resourceSourceRef:'fixture-handoff',signer,authorization,now:()=>clock},boundary?{boundary}:{});
const port=compose(), input={contract_version:'standard-handoff-publication-input.v1',next_agent_role:'coordinator',next_agent_action:'reanchor',next_agent_goal:'Resume from the exact canonical checkpoint.',handoff_note:'Retain original uncertainties.',from_agent_role:'coordinator',from_agent_action:'relay'};
function tree(){const rows={};for(let i=0;i<owned.length;i++){const walk=at=>{for(const e of fs.readdirSync(at,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(at,e.name),k=i+':'+path.relative(owned[i],p);if(e.isSymbolicLink())rows[k]='LINK:'+fs.readlinkSync(p);else if(e.isDirectory()){rows[k+path.sep]='DIRECTORY';walk(p);}else rows[k]=sha(fs.readFileSync(p));}};walk(owned[i]);}return rows;}
let checks=0;async function readonly(name,run){const before=tree();const result=await run();assert.deepEqual(tree(),before,name);checks++;console.log('PASS '+name);return result;}
const blocked=await readonly('unknown canonical mode blocks publication without mutation',()=>port.prepare(input));
assert.equal(blocked.can_apply,false);assert.equal(blocked.status,'BLOCKED');
// Explicit upstream fixture state, not a Human decision or published workflow
// proof. Establish the already-required known mode before testing this port.
const seed=artifacts.read('CURRENT-STATE.md',{required:true}), thinking=seed.content.replace(/^mode:.*$/mi,'mode: THINKING');assert.notEqual(thinking,seed.content);
await artifacts.withLocalEffectOwner(H({fixture:'explicit-thinking-precondition'}),()=>{
 artifacts.compareAndSwapPreservingMetadata({path:'CURRENT-STATE.md',before_sha256:seed.sha256,before_metadata_sha256:artifacts.metadataHash('CURRENT-STATE.md'),after:thinking});
 artifacts.project(['CURRENT-STATE.md']);assert.equal(artifacts.read('CURRENT-STATE.md').sha256,sha(Buffer.from(thinking)));return{effect_status:'confirmed'};
});
const prepared=await readonly('canonical preparation reads all sources without an owner or mutation',()=>port.prepare(input));
if(!prepared.can_apply){const a=await preWriteAdmit({targetRoot:root,skill:'handoff-close'});console.error(JSON.stringify({fixture_precondition:prepared,admission_status:a.admission_status,activation_active:a.activation?.active,blocking_reasons:a.blocking_reasons,context:a.context}));throw Error('FIXTURE_HANDOFF_PUBLICATION_NOT_ADMITTED');}
assertHandoffPublicationPlan(prepared.plan);assert.equal(prepared.plan.before_sha256,null);assert.equal(prepared.plan.projection.packet.recommended_next_agent_role,input.next_agent_role);
assert.equal(prepared.plan.projection.packet.recommended_next_agent_action,input.next_agent_action);assert.equal(prepared.plan.projection.packet.next_agent_goal,input.next_agent_goal);
await readonly('closed data refuses approval, foreign target and altered content',async()=>{
 await assert.rejects(port.prepare({...input,approved:true}),{code:'STANDARD_HANDOFF_PUBLICATION_INVALID'});
 for(const mutate of [p=>{p.path='SPEC.md';},p=>{p.content+='forged';},p=>{p.input.next_agent_action='implement';}]){const p=structuredClone(prepared.plan);mutate(p);assert.throws(()=>assertHandoffPublicationPlan(p));}
});
allowed=false;await readonly('revoked current write grant refuses before ownership',()=>assert.rejects(port.apply(prepared,{write:true,expectPlan:prepared.plan_sha256}),error=>error.code==='FIXTURE_CURRENT_GRANT_REQUIRED'&&error.effect_status==='no_effect'));allowed=true;
sourceAllowed=false;await readonly('revoked independent resource source refuses before ownership',()=>assert.rejects(port.apply(prepared,{write:true,expectPlan:prepared.plan_sha256}),{code:'FIXTURE_SOURCE_REVOKED'}));sourceAllowed=true;
const oldClock=clock;clock=sourceExpiry+1;await readonly('original issuer expiry remains effective without renewing the grant',()=>assert.rejects(port.apply(prepared,{write:true,expectPlan:prepared.plan_sha256}),{code:'FIXTURE_ORIGINAL_ISSUER_EXPIRED'}));clock=oldClock+600001;
if(mode!=='files'){const visible=path.join(root,'docs/audit/CURRENT-STATE.md'),old=fs.readFileSync(visible);fs.writeFileSync(visible,'# stale visible copy\nactive_session: S999\n');
 await readonly('canonical packet projection ignores a stale visible database copy',async()=>{const p=await createCanonicalHandoffProjection({targetRoot:root,readCurrent:()=>host.inspectDiagnostic().record}).prepare(input,prepared.plan.prepared_at_ms);assert.equal(p.projection.packet.active_session,prepared.plan.projection.packet.active_session);assert.equal(p.projection.packet.current_state_source,'sqlite');});fs.writeFileSync(visible,old);}
const nativeBefore=host.inspectAllocations(), result=await port.apply(prepared,{write:true,expectPlan:prepared.plan_sha256});assertHandoffPublicationOutput(result);
assert.equal(result.status,'packet_written');assert.equal(result.written,true);assert.equal(result.complete_resource_closure,false);assert.equal(result.permits_handoff,false);assert.equal(artifacts.ownerPending(),false);
assert.equal(artifacts.read('HANDOFF-PACKET.md').sha256,prepared.plan.after_sha256);assert.equal(artifacts.metadataHash('HANDOFF-PACKET.md'),result.packet_metadata_sha256);assert.deepEqual(host.inspectAllocations(),nativeBefore);
if(mode==='dual')assert.equal(fs.readFileSync(path.join(root,'docs/audit/HANDOFF-PACKET.md'),'utf8'),prepared.plan.content);
if(mode==='db-only')assert.equal(fs.existsSync(path.join(root,'docs/audit/HANDOFF-PACKET.md')),false);
if(mode!=='files'){const store=createProjectArtifactStore({targetRoot:root,readOnly:true,existingOnly:true});try{assert.equal(store.getArtifact('HANDOFF-PACKET.md').subtype,'handoff_packet');}finally{store.close();}}
checks++;console.log('PASS old unchanged preparation writes actual canonical packet and releases its exact owner');
await readonly('duplicate old plan refuses without replaying confirmed publication',()=>assert.rejects(port.apply(prepared,{write:true,expectPlan:prepared.plan_sha256}),error=>/^STANDARD_HANDOFF_/.test(error.code)));
const closeRequest=host.prepareHandoffResourceRequest(), closed=await host.inspectHandoffResources(closeRequest,{sourceRef:'fixture-handoff'});assert.equal(closed.complete_resource_closure,true);assert.equal(closed.permits_handoff,false);checks++;console.log('PASS fresh resource read is possible only after publisher owner release');
// The artifact owner's callback is asynchronous. A source permission revoked
// at its last pre-CAS boundary must still stop the packet effect and release it.
const deniedPreparation = await port.prepare({...input,next_agent_goal:'Verify current source permission at the actual CAS boundary.'});assert.equal(deniedPreparation.can_apply,true);
const packetBeforeDenied = artifacts.read('HANDOFF-PACKET.md').sha256, metadataBeforeDenied = artifacts.metadataHash('HANDOFF-PACKET.md');
const deniedPublisher = compose(point=>{if(point==='before_packet_cas')sourceAllowed=false;});
await assert.rejects(deniedPublisher.apply(deniedPreparation,{write:true,expectPlan:deniedPreparation.plan_sha256}),error=>error.code==='FIXTURE_SOURCE_REVOKED'&&error.effect_status==='no_effect');
sourceAllowed=true;assert.equal(artifacts.read('HANDOFF-PACKET.md').sha256,packetBeforeDenied);assert.equal(artifacts.metadataHash('HANDOFF-PACKET.md'),metadataBeforeDenied);
assert.equal(artifacts.ownerPending(),false);assert.deepEqual(host.inspectAllocations(),nativeBefore);checks++;console.log('PASS source revoked at actual pre-CAS boundary preserves packet and releases unused owner');
const interrupted=compose(point=>{if(point==='after_packet_cas')throw Object.assign(Error('FIXTURE_PACKET_RETURN_LOST'),{code:'FIXTURE_PACKET_RETURN_LOST'});});
const next=await interrupted.prepare({...input,next_agent_goal:'Inspect the deliberately interrupted second publication.'});assert.equal(next.can_apply,true);
const unknown=await interrupted.apply(next,{write:true,expectPlan:next.plan_sha256});assert.equal(unknown.status,'reconciliation_required');assert.equal(unknown.effect_status,'unknown');assert.equal(artifacts.read('HANDOFF-PACKET.md').sha256,next.plan.after_sha256);assert.equal(artifacts.ownerPending(),true);
await readonly('unknown post-CAS publication retains owner and blocks another handoff',()=>assert.rejects(port.prepare(input),{code:'STANDARD_HANDOFF_RESOURCE_OWNER_UNRESOLVED'}));
assert.deepEqual(host.inspectAllocations(),nativeBefore);checks++;console.log('PASS post-CAS uncertainty retains the original owner and Native accounting');
console.log(JSON.stringify({status:'PASS',checks,mode,root,base,scope:'CANONICAL_PACKET_PUBLICATION_COMPONENT',actual_canonical_CAS_metadata_projection_and_owner:true,actual_mixed_resource_and_context_reads:true,source_and_permission:'CONTROLLED_FIXTURE_CAPABILITIES',permission_checks:permissionChecks,Native_calls:0,common_operation_receipt_and_IR_handoff_entry:'NOT_IMPLEMENTED',post_release_resource_source:'CONTROLLED_FIXTURE',full_handoff:'NOT_PROVEN',genuine_Native_Human_installed_full_STANDARD:'NOT_RUN'}));
