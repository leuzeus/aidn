import assert from 'node:assert/strict';
import { retainObjectiveAlignment, assertRetainedObjectiveAlignment } from '../../src/core/workflow/standard-drift-retained-objective.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
const hash='a'.repeat(64), op='op_'+'a'.repeat(40), next='op_'+'b'.repeat(40);
const disposition={contract_version:'standard-drift-objective-disposition.v1',decision_operation_id:op,evaluation_operation_id:op,evaluation_sha256:hash,context_sha256:hash,review_sha256:hash,question_sha256:hash,source_sha256:hash,receipt_sha256:hash,inbox_id:'decision_'+'a'.repeat(40),authority_id:'fixture_human',source_event_id:'fixture_answer',session_objective:'Verify membership',cycle_objective:'Test endpoints',rationale:'Objectives aligned',prepared_at_ms:100};
const source={disposition,completion:{operation_id:op,receipt_sha256:hash,plan_sha256:hash,output_sha256:hash,alignment_sha256:H(disposition),report_sha256:hash,event_sha256:hash,event_offset:0},scope:{instance_id:'fixture_origin',scope_id:hash,configuration_sha256:hash,session_id:'S001',cycle_id:'C001',product_sha256:hash,branch:'fixture',head:'a'.repeat(40)}};
function fixture(){const context={mode:'COMMITTING',session_id:'S001',cycle_id:'C001',cycle_state:'DONE',product_sha256:hash,branch:'fixture',head:'a'.repeat(40),original_objective:'Test endpoints',documents:[{ref:'audit:sessions/S001.md',content:'# Session\nstate: OPEN\nsession_objective: Verify membership\nattached_cycles: C001\n'},{ref:'audit:cycles/C001-feature/status.md',content:'# Cycle\nstate: DONE\nsession_owner: S001\n'}]};
 const value={context,output:{facts:{drift_present:false,drift_recovery_required:false,drift_context_complete:true},observations:{report:{original_objective:'Test endpoints',current_objective:'Test endpoints',drift_level:'none',objective_changed:false}}}};return seal(value);}
function seal(value){value.context_sha256=H(value.context);value.output.observations.report.context_sha256=value.context_sha256;value.evaluation_sha256=H(value.output);return value;}
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const before=H(source),current=fixture(),result=retainObjectiveAlignment(source,{evaluation_operation_id:next},current);
assert.equal(result.contract_version,'standard-drift-objective-disposition.v2');assert.equal(result.evaluation_operation_id,next);assert.deepEqual(result.source.disposition,disposition);assert.equal(result.prepared_at_ms,100);assert.equal(H(source),before);assert.equal(result.source.disposition.evaluation_operation_id,op);
pass('retained alignment names the new evaluation and preserves the original decision bytes');
for(const [name,change] of [
 ['foreign session',v=>v.context.session_id='S002'],['foreign cycle',v=>v.context.cycle_id='C002'],
 ['changed HEAD',v=>v.context.head='b'.repeat(40)],['changed branch',v=>v.context.branch='different'],['changed product',v=>v.context.product_sha256='b'.repeat(64)],
 ['changed cycle objective',v=>v.context.original_objective='Other purpose'],['changed session objective',v=>v.context.documents[0].content=v.context.documents[0].content.replace('Verify membership','Other purpose')],
 ['foreign owner',v=>v.context.documents[1].content=v.context.documents[1].content.replace('S001','S002')],
 ['detached cycle',v=>v.context.documents[0].content=v.context.documents[0].content.replace('attached_cycles: C001','attached_cycles: C002')],
 ['closed session',v=>v.context.documents[0].content=v.context.documents[0].content.replace('OPEN','CLOSED')],
 ['active cycle',v=>v.context.cycle_state='VERIFYING'],['different mode',v=>v.context.mode='EXPLORING'],
 ['fresh drift',v=>v.output.facts.drift_present=true],['incomplete diagnosis',v=>v.output.facts.drift_context_complete=false],
 ['changed report objective',v=>v.output.observations.report.current_objective='Other purpose']]){
 const value=fixture();change(value);seal(value);assert.throws(()=>retainObjectiveAlignment(source,{evaluation_operation_id:next},value),/STANDARD_RETAINED_OBJECTIVE_/);pass('refuses '+name);
}
const tampered=fixture();tampered.context_sha256='b'.repeat(64);assert.throws(()=>retainObjectiveAlignment(source,{evaluation_operation_id:next},tampered),/EVALUATION_CHANGED/);pass('refuses substituted evaluation bytes');
const altered=structuredClone(source);altered.completion.alignment_sha256='b'.repeat(64);assert.throws(()=>retainObjectiveAlignment(altered,{evaluation_operation_id:next},fixture()),/COMPLETION_CHANGED/);pass('refuses an unlinked physical completion');
assert.throws(()=>assertRetainedObjectiveAlignment({...result,permission:true}),/INVALID/);pass('closed projection contains no added permission');
console.log(JSON.stringify({status:'PASS',checks,proof:'pure_scope_projection_with_fixture_authority',human:'NOT_RUN',native:'NOT_RUN',business_effects:0}));
