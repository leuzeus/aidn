import {createHash} from 'node:crypto';
import {preWriteAdmit} from '../../../tools/runtime/pre-write-admit.mjs';
import {resolveSkillId} from '../../core/skills/skill-policy.mjs';
import {readWorkflowAdapterConfig} from '../../lib/config/workflow-adapter-config-lib.mjs';
import {buildTaskContextRequest} from '../codex/task-context-profile.mjs';
import {selectScopedContext} from '../codex/scoped-context-selection.mjs';
import {observeWorkflowRead, withWorkflowObservation, workflowObservationActive} from './workflow-observation-service.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw new Error(code);};
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
const closureSkills=['cycle-close','close-session','handoff-close','promote-baseline','pr-orchestrate'];

// Run-local composition only. Caller-held JSON cannot inject an admission:
// existingAdmissions is used solely inside the already active workflow scope.
export async function runArtifactTaskQuery({options,readSources,select,finalize}) {
  const {targetRoot,params,profile,existingAdmissions}=options;
  if(!params.skills?.length)fail('ARTIFACT_QUERY_SKILLS_REQUIRED');
  const skills=params.skills.map(resolveSkillId);
  if(profile==='verification-closure.v1'&&skills.some(s=>!closureSkills.includes(s)))fail('ARTIFACT_QUERY_CLOSURE_SKILL_REQUIRED');
  if(profile==='modification-preparation.v1') {
    if(!params.artifact_paths?.length||!params.field_ids?.length||!params.task?.operation)fail('ARTIFACT_QUERY_PREPARATION_PARAMS_REQUIRED');
  }else if(params.artifact_paths||params.field_ids)fail('ARTIFACT_QUERY_PROFILE_PARAMS_CONFLICT');
  const alreadyGrouped=workflowObservationActive(targetRoot);
  if(existingAdmissions&&!alreadyGrouped)fail('ARTIFACT_QUERY_ADMISSION_SCOPE_REQUIRED');
  async function compute() {
    const adoption=await observeWorkflowRead({targetRoot,key:'artifact-query-client-policy',
      load:()=>{try{return readWorkflowAdapterConfig(targetRoot).data.governanceAdoption??null;}catch{fail('ARTIFACT_QUERY_CLIENT_POLICY_INVALID');}}});
    const extraPaths=[...new Set((adoption?.extensions?.contextUnits??[]).map(u=>u.path))];
    if(extraPaths.length>128)fail('ARTIFACT_QUERY_AUTHORITY_LIMIT');
    const observation=await readSources({...options,extraPaths});
    const result=select({...observation,params:{...params,expected_revision:undefined},profile,deferBudget:true});
    if(result.status==='blocked')return result;
    const admissions={};
    for(const skill of skills) {
      const keys=Object.keys(existingAdmissions??{}).filter(k=>resolveSkillId(k)===skill);
      if(existingAdmissions&&keys.length!==1)fail('ARTIFACT_QUERY_ADMISSION_BINDING');
      admissions[skill]=existingAdmissions?existingAdmissions[keys[0]]:await preWriteAdmit({targetRoot,skill});
      if(admissions[skill].skill!==skill)fail('ARTIFACT_QUERY_ADMISSION_BINDING');
      if(admissions[skill].activation?.active && (admissions[skill].source_of_truth?.state_mode!==observation.stateMode
        || observation.backend!=='files'&&admissions[skill].shared_state_backend?.projection_backend_kind!==observation.backend))
        fail('ARTIFACT_QUERY_ADMISSION_CANONICAL_MISMATCH');
    }
    result.admissions=skills.map(skill=>({skill,...pick(admissions[skill],['ok','admission_status','admission_kind','checks','blocking_reasons','warnings','blocking_findings']),
      repairs:structuredClone(admissions[skill].source_of_truth?.repair_actions??[]),
      write_authorization:false,next_action:admissions[skill].ok?'fresh-specific-admission-before-write':'repair-and-reconsult'}));
    const scope=pick(observation.scope,['project_id','workspace_id','worktree_id','runtime_scope_id']);
    const fact=id=>result.fields.find(f=>f.id===id&&f.status==='known')?.value;
    for(const [key,id]of [['session_id','current_state.active_session'],['cycle_id','current_state.active_cycle']])
      if(fact(id)&&fact(id)!=='none')scope[key]=fact(id);
    const selection=buildTaskContextRequest({adoption,scope,admissions,skills,task:params.task??{},asOf:new Date().toISOString().slice(0,10)});
    result.authorities=[];
    if(selection.mode!=='scoped') {
      result.errors.push({code:'ARTIFACT_QUERY_ACCEPTED_POLICY_REQUIRED',ref:selection.reason});
    }else {
      if(params.include_optional===false)selection.request.optional=[];
      if(options.onSelection)options.onSelection(structuredClone(selection.request));
      const selected=selectScopedContext({...observation,request:selection.request,adoption});
      result.authorities=selected.units.map(u=>pick(u,['unit_id','path','heading','authority','scope','sha256','unit_sha256','selection_reasons','content_excerpt','start_line','end_line']));
      result.authority_selection={status:selected.status,policy_revision:selection.policy_revision,source_revision:selected.source_revision,
        errors:selected.errors,omissions:selected.omissions,expansions:selected.expansions,write_authorization:false};
      if(selected.status!=='complete')result.errors.push({code:'ARTIFACT_QUERY_AUTHORITY_UNAVAILABLE',ref:null});
      result.omissions.push(...selected.omissions.map(o=>({id:o.unit_id,reason:o.reason})));
    }
    if(profile==='modification-preparation.v1') {
      const preimages=[];
      for(const path of params.artifact_paths) {
        const source=result.sources.find(s=>s.path===path),rows=observation.payload.artifacts.filter(r=>r.path===path);
        const fields=params.field_ids.filter(id=>id.split('.')[0]===source?.id);
        if(!source||rows.length!==1||!fields.length)result.errors.push({code:'ARTIFACT_QUERY_PREIMAGE_UNAVAILABLE',ref:path});
        else preimages.push({path,sha256:source.sha256,contract_version:source.contract_version,content_bytes:Buffer.byteLength(rows[0].content),field_ids:fields});
      }
      if(params.field_ids.some(id=>!preimages.some(p=>p.field_ids.includes(id))))result.errors.push({code:'ARTIFACT_QUERY_FIELD_TARGET_MISMATCH',ref:null});
      result.preparation={operation:params.task.operation,preimages,write_authorization:false,
        preconditions:['fresh-specific-admission','complete-canonical-preimage','compare-and-swap','execution-fence'],
        next_action:'prepare-fresh-controlled-write',ready:!result.errors.length&&result.admissions.every(a=>a.ok)&&result.status==='ok'};
    }
    if(profile==='verification-closure.v1')result.verification={evaluated_by:'pre-write-admit',completion_authorized:false,
      evidence_status:'consulted-not-certified',next_action:'run-existing-closure-checks-and-fresh-write-admission',
      open_points:result.admissions.flatMap(a=>[...(a.blocking_reasons??[]),...(a.warnings??[])])};
    result.source_revision=hash({facts:result.source_revision,skills,task:params.task??null,admissions:result.admissions,
      authorities:result.authority_selection??null,preparation:result.preparation??null,verification:result.verification??null});
    if(params.expected_revision&&params.expected_revision!==result.source_revision)result.errors.push({code:'ARTIFACT_QUERY_REVISION_CHANGED',ref:null});
    if(result.errors.length){result.status='blocked';if(result.preparation)result.preparation.ready=false;}
    return result;
  }
  const result=alreadyGrouped?await compute():await withWorkflowObservation({targetRoot,contextFile:'.aidn/runtime/context/codex-context.json'},compute)
    .then(observed=>({...observed.value,observation:observed.observation}));
  return finalize(result,params.target_bytes??16384);
}
