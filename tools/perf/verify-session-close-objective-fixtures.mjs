import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionCloseObjectiveCompletion } from '../../src/application/runtime/session-close-objective-completion.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { artifactContentHash } from '../../src/core/workflow/artifact-compare-swap.mjs';

const temp = fs.realpathSync(os.tmpdir()), root = fs.realpathSync(fs.mkdtempSync(path.join(temp,'aidn-session-objective-')));
const hash='a'.repeat(64), id=c=>'op_'+c.repeat(40), report='# Retained fixture R05\n';let checks=0;
const eventFile=path.join(root,'.aidn/runtime/perf/workflow-events.ndjson');fs.mkdirSync(path.dirname(eventFile),{recursive:true});
try {
  for(const retained of [false,true]) {
    let alignment={contract_version:'standard-drift-objective-disposition.v1',decision_operation_id:id('c'),evaluation_operation_id:id('b'),
      evaluation_sha256:hash,context_sha256:hash,review_sha256:hash,question_sha256:hash,source_sha256:hash,receipt_sha256:hash,
      inbox_id:'decision_'+'d'.repeat(40),authority_id:'fixture',source_event_id:'fixture:alignment',session_objective:'Implement a bounded feature',
      cycle_objective:'Verify its selected cases',rationale:'Fixture scope agreement',prepared_at_ms:100};
    if(retained)alignment={contract_version:'standard-drift-objective-disposition.v2',decision_operation_id:id('c'),evaluation_operation_id:id('b'),
      evaluation_sha256:hash,context_sha256:hash,session_id:'S001',cycle_id:'C001',session_objective:alignment.session_objective,cycle_objective:alignment.cycle_objective,prepared_at_ms:100,
      source:{disposition:alignment,completion:{operation_id:id('a'),receipt_sha256:hash,plan_sha256:hash,output_sha256:hash,alignment_sha256:H(alignment),report_sha256:hash,event_sha256:hash,event_offset:0},
        scope:{instance_id:'original',scope_id:hash,configuration_sha256:hash,session_id:'S001',cycle_id:'C001',product_sha256:hash,branch:'fixture',head:'a'.repeat(40)}}};
    const plan={contract_version:retained?'standard-drift-finalize-plan.v4':'standard-drift-finalize-plan.v3',operation_id:id('a'),input:{evaluation_operation_id:id('b')},prepared_at_ms:100,
      context_sha256:hash,evaluation_sha256:hash,branch:'fixture',head:'a'.repeat(40),mode:'COMMITTING',objective_alignment:alignment,
      report:{path:'workflows/drift-reports/'+id('a')+'.md',before_sha256:null,after:report,after_sha256:artifactContentHash(report)},
      gate_constraints:{level1:{decision:'incremental'},level3:{required:false},other_signals:['objective_delta']}};
    const event={event:'drift_check_completed',result:'ok',mode:'COMMITTING',branch:'fixture',run_id:'process_drift_'+id('a'),objective_alignment_sha256:H(alignment)};
    const eventBytes=Buffer.from(JSON.stringify(event)+'\n');fs.writeFileSync(eventFile,eventBytes);
    const output={outcome:'completed',effect_status:'confirmed',facts:{drift_check_completed:true},observations:{hook:{payload:{objective_alignment:alignment}},
      report_path:plan.report.path,report_sha256:plan.report.after_sha256,event_file:'.aidn/runtime/perf/workflow-events.ndjson',event_offset:0,observed_event:event}};
    const finalization={record:{operation_id:id('a'),intent:{binding_ref:'drift_check_finalize'},preview:{prepared:{plan}}},output};
    const recorded={question:{review:{session_id:'S001',drift_finalization_operation_id:id('a'),drift_finalization_output_sha256:H(output),drift_evaluation_operation_id:id('b'),drift_evaluation_output_sha256:hash,branch:'fixture',head:'a'.repeat(40),
      documents:[{ref:'audit:sessions/S001.md',sha256:'b'.repeat(64),metadata_sha256:'c'.repeat(64)},{ref:'audit:baseline/current.md',sha256:'f'.repeat(64),metadata_sha256:hash}]}},
      plan:{changes:[{path:'sessions/S001.md',before_sha256:'b'.repeat(64),before_metadata_sha256:'c'.repeat(64),after_sha256:'d'.repeat(64)}]},
      recorded:{output:{observations:{postimages:[{path:'sessions/S001.md',sha256:'d'.repeat(64),metadata_sha256:'e'.repeat(64)}]}}}};
    const docs=new Map([['sessions/S001.md',{sha256:'d'.repeat(64),metadata:'e'.repeat(64)}],['baseline/current.md',{sha256:'f'.repeat(64),metadata:hash}],
      [plan.report.path,{sha256:plan.report.after_sha256,metadata:hash}]]);
    const artifacts={root,read:name=>docs.get(name),metadataHash:name=>docs.get(name).metadata};
    const read=()=>readSessionCloseObjectiveCompletion({artifacts,recorded,finalization});
    assert.deepEqual(read(),alignment);checks++;
    for(const [mutate,restore] of [
      [()=>recorded.question.review.drift_finalization_output_sha256=hash,()=>recorded.question.review.drift_finalization_output_sha256=H(output)],
      [()=>docs.get('sessions/S001.md').metadata=hash,()=>docs.get('sessions/S001.md').metadata='e'.repeat(64)],
      [()=>docs.get('baseline/current.md').sha256=hash,()=>docs.get('baseline/current.md').sha256='f'.repeat(64)],
      [()=>recorded.plan.changes[0].before_sha256=hash,()=>recorded.plan.changes[0].before_sha256='b'.repeat(64)],
      [()=>docs.get(plan.report.path).sha256=hash,()=>docs.get(plan.report.path).sha256=plan.report.after_sha256],
      [()=>fs.writeFileSync(eventFile,JSON.stringify({...event,result:'warn'})+'\n'),()=>fs.writeFileSync(eventFile,eventBytes)]
    ]) {mutate();assert.throws(read,{code:'STANDARD_SESSION_CLOSE_OBJECTIVE_PROOF_CHANGED'});restore();checks++;}
    assert.deepEqual(read(),alignment);assert.deepEqual(fs.readFileSync(eventFile),eventBytes);
  }
  console.log(JSON.stringify({status:'PASS',checks,proof:'accepted-source-capabilities-are-fixture-inputs; exact physical R05 bytes and causal metadata checked',native:'NOT_RUN'}));
} finally {assert.equal(path.dirname(fs.realpathSync(root)),temp);fs.rmSync(root,{recursive:true,force:true});}
