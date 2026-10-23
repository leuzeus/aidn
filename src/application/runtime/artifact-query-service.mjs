import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readAidnProjectConfig, validateAidnProjectConfig, resolveConfigStateMode, resolveConfigRuntimePersistence } from '../../lib/config/aidn-config-lib.mjs';
import { buildCanonicalFromMarkdown } from '../../lib/workflow/markdown-render-lib.mjs';
import { inspectStructuredField, analyzeStructuredArtifact } from '../../lib/workflow/structured-artifact-parser-lib.mjs';
import { resolveCriticalMarkdownContract } from '../../lib/workflow/markdown-contract-registry-lib.mjs';
import { completeMarkdownUnit } from '../codex/scoped-context-selection.mjs';
import { resolveRuntimeProjectContext } from './runtime-project-context-service.mjs';
import { readRuntimeSnapshot } from './runtime-snapshot-service.mjs';
import { artifactQueryManifest, ACTIVE_STATE_PROFILE, ARTIFACT_TASK_PROFILES } from './artifact-query-catalog.mjs';
import { resolveSkillId } from '../../core/skills/skill-policy.mjs';
import { runArtifactTaskQuery } from './artifact-task-query-service.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identityKeys = ['project_id','workspace_id','worktree_id','runtime_scope_id'];
const identity = value => Object.fromEntries(identityKeys.map(key => [key, value?.[key] ?? null]));
const validId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}\\d+$`).test(value);
const fail = code => { throw new Error(code); };
const safeRelative = name => typeof name === 'string' && name.length < 512 && !/[:\\\u0000]/.test(name)
  && !name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..');

export function validateArtifactQueryParams(params) {
  if (!object(params) || params.schema_version !== 1
    || Object.keys(params).some(k => !['schema_version','scope','expected_revision','target_bytes','include_optional','skills','task','artifact_paths','field_ids'].includes(k))
    || params.scope !== undefined && (!object(params.scope) || Object.keys(params.scope).length !== identityKeys.length
      || identityKeys.some(k => typeof params.scope[k] !== 'string' || !params.scope[k] || params.scope[k].length > 512))
    || params.expected_revision !== undefined && !/^[a-f0-9]{64}$/.test(params.expected_revision)
    || params.target_bytes !== undefined && (!Number.isInteger(params.target_bytes) || params.target_bytes < 256 || params.target_bytes > 65536)
    || params.include_optional !== undefined && typeof params.include_optional !== 'boolean'
    || params.skills !== undefined && (!Array.isArray(params.skills) || !params.skills.length || params.skills.length>16
      || params.skills.some(s=>!resolveSkillId(s)) || new Set(params.skills.map(resolveSkillId)).size!==params.skills.length)
    || params.task !== undefined && (!object(params.task) || Object.keys(params.task).some(k=>!['operation','paths'].includes(k))
      || params.task.operation !== undefined && (typeof params.task.operation!=='string'||!params.task.operation||params.task.operation.length>160)
      || params.task.paths !== undefined && (!Array.isArray(params.task.paths)||params.task.paths.length>128||params.task.paths.some(p=>!safeRelative(p))))
    || params.artifact_paths !== undefined && (!Array.isArray(params.artifact_paths)||!params.artifact_paths.length||params.artifact_paths.length>16
      || params.artifact_paths.some(p=>!safeRelative(p))||new Set(params.artifact_paths).size!==params.artifact_paths.length)
    || params.field_ids !== undefined && (!Array.isArray(params.field_ids)||!params.field_ids.length||params.field_ids.length>32
      || params.field_ids.some(id=>typeof id!=='string'||!/^[a-z_]+\.[a-z_]+$/.test(id))||new Set(params.field_ids).size!==params.field_ids.length)) fail('ARTIFACT_QUERY_PARAMS_INVALID');
  return structuredClone(params);
}

export function artifactQueryEnvelope(profile = ACTIVE_STATE_PROFILE) {
  return { contract_version: 'runtime-artifact-query.v1', kind: 'runtime-artifact-query', profile,
    status: 'blocked', effect_class: 'read-only', written: false, write_authorization: false,
    source_backend: null, scope: null, source_revision: null, catalog_revision: null,
    fields: [], sections: [], sources: [], errors: [], omissions: [], expansions: [], budget: null };
}

function fieldValue(source, field) {
  const normalized=analyzeStructuredArtifact(source.content,{classification:{kind:source.descriptor?.artifact_type??source.kind}}).normalized_text;
  let fence=null;
  const content=normalized.split('\n').filter(line=>{
    const mark=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(mark){if(!fence)fence={character:mark[1][0],length:mark[1].length};
      else if(mark[1][0]===fence.character&&mark[1].length>=fence.length&&!mark[2].trim())fence=null;return false;}
    return !fence;
  }).join('\n');
  if (field.extractor === 'session-mode.v1') {
    const modes = [...content.matchAll(/\[\s*[xX]\s*\]\s*(COMMITTING|EXPLORING|THINKING)\b/g)].map(m => m[1]);
    modes.push(...[...content.matchAll(/^##\s+WORK MODE\s*-\s*(COMMITTING|EXPLORING|THINKING)\b/gim)].map(m=>m[1].toUpperCase()));
    if (new Set(modes).size > 1) return { status: 'uninterpretable', value: null, reason: 'ambiguous_mode' };
    const checked=analyzeStructuredArtifact(content,{classification:{kind:'session'}}).derived_session_context?.mode;
    const projected=source.canonical?.derived_session_context?.mode;
    const value=projected===checked?projected:checked;
    return value ? { status: 'known', value } : { status: 'uninterpretable', value: null, reason: 'mode_unavailable' };
  }
  // Fenced examples are never evidence for a current structured field.
  const occurrences = [];
  for (const line of content.split(/\r?\n/)) {
    const match=line.match(/^\s*(?:[-*]\s+)?([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
    if(match && match[1].trim().toLowerCase().replace(/\s+/g,'_')===field.source_key) occurrences.push(match[2]);
  }
  if(occurrences.length>1)return {status:'uninterpretable',value:null,reason:'duplicate_field'};
  if(!occurrences.length)return {status:'absent',value:null,reason:'field_absent'};
  const details = inspectStructuredField(content, field.source_key);
  if (!details.present) return { status: 'absent', value: null, reason: 'field_absent' };
  if (field.type === 'scalar') {
    if (!details.scalar || details.style !== 'scalar' || /^(unknown|unavailable)$/i.test(details.scalar))
      return { status: 'uninterpretable', value: null, reason: 'scalar_unknown_or_invalid' };
    const projected=source.canonical?.derived_session_context?.[field.source_key]
      ?? source.canonical?.derived_runtime_context?.[field.source_key] ?? source.canonical?.key_values?.[field.source_key];
    return { status: 'known', value: projected===details.scalar ? projected : details.scalar };
  }
  const values = details.list_items;
  if (details.style === 'list' && Array.isArray(values)) {
    const rawValues=details.raw_block.split('\n').map(line=>line.trim().replace(/^[-*]\s+/,''));
    if (rawValues.some(v => /^(unknown|unavailable)$/i.test(v)) || rawValues.length > 1 && rawValues.some(v => /^(?:none|\(none\))$/i.test(v)))
      return { status: 'uninterpretable', value: null, reason: 'ambiguous_list' };
    if(values.length || rawValues.length===1 && /^(?:none|\(none\))$/i.test(rawValues[0])){
      const projected=source.canonical?.derived_session_context?.[field.source_key]??source.canonical?.derived_runtime_context?.[field.source_key];
      return { status: 'known', value:isDeepStrictEqual(projected,values)?projected:values };
    }
  }
  if (field.type === 'list_or_scalar' && details.style === 'scalar' && details.scalar && !/^(unknown|unavailable)$/i.test(details.scalar))
    return { status:'known', value:/^(?:none|\(none\))$/i.test(details.scalar)?[]:[details.scalar] };
  return { status: 'uninterpretable', value: null, reason: 'list_invalid' };
}

export function selectArtifactQuery({ payload, backend, scope, params = {schema_version:1}, profile = ACTIVE_STATE_PROFILE, deferBudget = false }) {
  const output = artifactQueryEnvelope(profile), manifest = artifactQueryManifest();
  const request = validateArtifactQueryParams(params);
  output.catalog_revision = manifest.revision; output.source_backend = backend; output.scope = identity(scope);
  const error = (code, ref = null) => output.errors.push({ code, ref });
  const policy=manifest.profiles.find(p=>p.id===profile);
  if(!policy){error('ARTIFACT_QUERY_PROFILE_UNSUPPORTED');return output;}
  if(identityKeys.some(k => typeof output.scope[k] !== 'string' || !output.scope[k])
    || request.scope && !isDeepStrictEqual(request.scope, output.scope)
    || backend !== 'files' && !isDeepStrictEqual(identity(payload?.project_context),output.scope)) {
    error('ARTIFACT_QUERY_SCOPE_MISMATCH'); return finalizeArtifactQueryBudget(output,request.target_bytes??16384);
  }
  if(!Array.isArray(payload?.artifacts)){error('ARTIFACT_QUERY_CANONICAL_UNAVAILABLE');return finalizeArtifactQueryBudget(output,request.target_bytes??16384);}
  const rows = payload.artifacts, selected = new Map();
  function source(type, predicate) {
    const matches=rows.filter(predicate);
    if(matches.length!==1){error(matches.length?'ARTIFACT_QUERY_SOURCE_AMBIGUOUS':'ARTIFACT_QUERY_SOURCE_ABSENT',type);return null;}
    const row=matches[0];
    if(!safeRelative(row.path) || row.content_format !== 'utf8' || typeof row.content !== 'string'
      || Buffer.byteLength(row.content)>1024*1024 || hash(row.content)!==row.sha256){error('ARTIFACT_QUERY_SOURCE_INTEGRITY',type);return null;}
    for(const key of identityKeys) if(row[key] && row[key]!==output.scope[key]){error('ARTIFACT_QUERY_SCOPE_MISMATCH',type);return null;}
    const contract=resolveCriticalMarkdownContract({relativePath:row.path,classification:{kind:type}});
    if(contract?.artifact_type!==type){error('ARTIFACT_QUERY_CONTRACT_MISMATCH',type);return null;}
    const fresh=buildCanonicalFromMarkdown(row.content,{relativePath:row.path,classification:{kind:type}});
    const supplied=row.canonical ?? row.canonical_json;
    const descriptor=manifest.artifacts.find(c=>c.artifact_type===type);
    if(fresh.contract_version!==descriptor.contract_version || fresh.legacy_shape_id && !descriptor.legacy_variants.includes(fresh.legacy_shape_id))
      {error('ARTIFACT_QUERY_CONTRACT_INCOMPATIBLE',type);return null;}
    if(fresh.contract_status==='non_conformant')error('ARTIFACT_QUERY_CONTRACT_NON_CONFORMANT',type);
    const verified=isDeepStrictEqual(supplied,fresh);
    const ref={id:type,path:row.path,sha256:row.sha256,contract_version:fresh.contract_version,
      contract_status:fresh.contract_status,legacy_shape_id:fresh.legacy_shape_id,
      extractor_version:manifest.extractor_version,extraction:verified?'verified-json':'rebuilt-in-memory'};
    output.sources.push(ref);selected.set(type,{...row,canonical:verified?supplied:fresh,descriptor});return selected.get(type);
  }
  source('current_state',r=>r.path==='CURRENT-STATE.md');
  source('runtime_state',r=>r.path==='RUNTIME-STATE.md');
  function append(id, optional=false) {
    const type=id.slice(0,id.indexOf('.')), row=selected.get(type), field=row?.descriptor.fields.find(f=>f.id===id);
    if(!field){output.fields.push({id,status:'absent',value:null,source_ref:null,optional,reason:'source_unavailable'});return null;}
    const result=fieldValue(row,field);
    output.fields.push({id,...result,source_ref:type,optional});
    for(const key of field.requires_sections) appendSection(type,key,row);
    return result;
  }
  function appendSection(type,key,row) {
      const sectionId=`${type}.section.${key}`;
      if(output.sections.some(s=>s.id===sectionId))return;
      const section=row.canonical.structured_sections.filter(s=>s.key===key);
      if(section.length!==1){error('ARTIFACT_QUERY_SECTION_UNAVAILABLE',sectionId);return;}
      const unit=completeMarkdownUnit(row.content,`${'#'.repeat(section[0].level)} ${section[0].text}`);
      if(!unit){error('ARTIFACT_QUERY_SECTION_UNAVAILABLE',sectionId);return;}
      output.sections.push({id:sectionId,source_ref:type,...unit,sha256:hash(unit.content)});
  }
  for(const id of policy.mandatory)append(id);
  function known(id){const f=output.fields.find(f=>f.id===id);return f?.status==='known'?f.value:null;}
  for(const [field,type,prefix,predicate]of [
    ['current_state.active_session','session','S',(r,id)=>new RegExp(`^sessions/${id}(?:[-_.][^/]*)?\\.md$`).test(r.path)],
    ['current_state.active_cycle','cycle_status','C',(r,id)=>new RegExp(`^cycles/${id}(?:[-_][^/]+)?/status\\.md$`).test(r.path)]]) {
    const id=known(field);if(id==='none')continue;
    if(!validId(id,prefix)){error('ARTIFACT_QUERY_ACTIVE_REFERENCE_INVALID',field);continue;}
    source(type,r=>predicate(r,id));for(const f of policy.conditional[type])append(f);
    const row=selected.get(type);if(row){const declared=inspectStructuredField(row.content,type==='session'?'session_id':'cycle_id');
      if(declared.present && declared.scalar!==id)error('ARTIFACT_QUERY_ACTIVE_REFERENCE_CONFLICT',type);
      if(row[type==='session'?'session_id':'cycle_id'] && row[type==='session'?'session_id':'cycle_id']!==id)error('ARTIFACT_QUERY_ACTIVE_REFERENCE_CONFLICT',type);}
  }
  const sessionBranch=known('session.session_branch'), currentSessionBranch=selected.get('current_state')&&fieldValue(selected.get('current_state'),{source_key:'session_branch',type:'scalar',extractor:'structured-field.v1'});
  if(sessionBranch && currentSessionBranch?.status==='known' && sessionBranch!==currentSessionBranch.value)error('ARTIFACT_QUERY_STATE_CONFLICT','session_branch');
  const cycleBranch=known('cycle_status.branch_name'), currentCycleBranch=selected.get('current_state')&&fieldValue(selected.get('current_state'),{source_key:'cycle_branch',type:'scalar',extractor:'structured-field.v1'});
  if(cycleBranch && currentCycleBranch?.status==='known' && cycleBranch!==currentCycleBranch.value)error('ARTIFACT_QUERY_STATE_CONFLICT','cycle_branch');
  if(known('session.mode') && known('current_state.mode') && known('session.mode')!==known('current_state.mode'))error('ARTIFACT_QUERY_STATE_CONFLICT','mode');
  if(known('cycle_status.dor_state') && known('current_state.dor_state') && known('cycle_status.dor_state')!==known('current_state.dor_state'))error('ARTIFACT_QUERY_STATE_CONFLICT','dor_state');
  for(const [type,sections]of Object.entries(policy.sections??{}))if(selected.has(type))for(const key of sections)appendSection(type,key,selected.get(type));
  for(const id of request.field_ids??[]) {
    const type=id.split('.')[0];
    if(!manifest.artifacts.some(c=>c.fields.some(f=>f.id===id)) || !selected.has(type))error('ARTIFACT_QUERY_FIELD_UNAVAILABLE',id);
    else if(!output.fields.some(f=>f.id===id))append(id);
  }
  if(request.include_optional!==false)for(const id of policy.optional)append(id,true);
  else output.omissions.push(...policy.optional.map(id=>({id,reason:'optional_not_requested'})));
  output.source_revision=hash({scope:output.scope,backend,profile,catalog:manifest.revision,sources:output.sources});
  if(request.expected_revision && request.expected_revision!==output.source_revision)error('ARTIFACT_QUERY_REVISION_CHANGED');
  output.status=output.errors.length?'blocked':output.fields.some(f=>!f.optional && f.status!=='known')?'incomplete':'ok';
  return deferBudget ? output : finalizeArtifactQueryBudget(output,request.target_bytes??16384);
}

export function finalizeArtifactQueryBudget(output, target) {
  output.budget={target_bytes:target,hard_limit_bytes:65536,total_bytes:0,minimum_required_bytes:null,within_target:false};
  function measure(){for(let i=0;i<20;i++){const n=Buffer.byteLength(JSON.stringify(output));if(output.budget.total_bytes===n)return n;output.budget.total_bytes=n;}fail('ARTIFACT_QUERY_BUDGET_UNSTABLE');}
  if(measure()>target){const omitted=output.fields.filter(f=>f.optional);output.fields=output.fields.filter(f=>!f.optional);
    output.omissions.push(...omitted.map(f=>({id:f.id,reason:'optional_budget'})));
    if(output.authorities){const optional=output.authorities.filter(u=>u.selection_reasons.every(r=>r==='optional_consultation'));
      output.authorities=output.authorities.filter(u=>!optional.includes(u));output.omissions.push(...optional.map(u=>({id:u.unit_id,reason:'optional_budget'})));}}
  if(measure()>target){output.budget.minimum_required_bytes=measure();output.status='blocked';
    output.errors.push({code:'ARTIFACT_QUERY_BUDGET_INSUFFICIENT',ref:null});
    output.expansions=[...output.sources.map(s=>({path:s.path,sha256:s.sha256})),...(output.authorities??[]).map(u=>({path:u.path,sha256:u.sha256}))];
    output.fields=[];output.sections=[];if(output.authorities)output.authorities=[];}
  if(output.status==='blocked'&&output.preparation)output.preparation.ready=false;
  output.budget.within_target=measure()<=target;measure();return output;
}

function physicalPath(targetRoot, relative) {
  if(!safeRelative(relative))fail('ARTIFACT_QUERY_PATH_INVALID');
  const absolute=path.resolve(targetRoot,relative);
  for(let p=absolute;;p=path.dirname(p)){if(fs.lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink())fail('ARTIFACT_QUERY_SYMLINK');if(p===path.parse(p).root)break;}
  return absolute;
}
function readPhysical(targetRoot, relative, limit=1024*1024) {
  const absolute=physicalPath(targetRoot,relative);
  if(!fs.existsSync(absolute))return null;
  const before=fs.statSync(absolute);if(!before.isFile()||before.size>limit)fail('ARTIFACT_QUERY_INPUT_LIMIT');
  const bytes=fs.readFileSync(absolute),after=fs.statSync(absolute);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length>limit)fail('ARTIFACT_QUERY_SOURCE_CHANGED');
  return {relative,bytes,fingerprint:hash(bytes)};
}

export function readArtifactQueryParams(targetRoot, relative) {
  const read=readPhysical(targetRoot,relative,16384);if(!read)fail('ARTIFACT_QUERY_PARAMS_UNAVAILABLE');
  try{return validateArtifactQueryParams(JSON.parse(read.bytes.toString('utf8')));}catch{fail('ARTIFACT_QUERY_PARAMS_INVALID');}
}

export async function queryProjectArtifacts(options) {
  const profile=options.profile??ACTIVE_STATE_PROFILE;
  const request=validateArtifactQueryParams(options.params);
  if(ARTIFACT_TASK_PROFILES.includes(profile))return runArtifactTaskQuery({options:{...options,params:request},readSources:readArtifactQuerySources,select:selectArtifactQuery,finalize:finalizeArtifactQueryBudget});
  if(profile!==ACTIVE_STATE_PROFILE)fail('ARTIFACT_QUERY_PROFILE_UNSUPPORTED');
  if(['skills','task','artifact_paths','field_ids'].some(k=>Object.hasOwn(request,k)))fail('ARTIFACT_QUERY_PROFILE_PARAMS_CONFLICT');
  const observation=await readArtifactQuerySources({...options,params:request});
  return selectArtifactQuery({...observation,params:request,profile});
}

async function readArtifactQuerySources({targetRoot,params,profile=ACTIVE_STATE_PROFILE,snapshotReader=options=>readRuntimeSnapshot(options),afterRead=null,extraPaths=[]}) {
  const request=validateArtifactQueryParams(params); // Capture before any await.
  if(!artifactQueryManifest().profiles.some(p=>p.id===profile))fail('ARTIFACT_QUERY_PROFILE_UNSUPPORTED');
  const configObservation=readPhysical(targetRoot,'.aidn/config.json');
  let config;
  try{config=validateAidnProjectConfig(readAidnProjectConfig(targetRoot).data);}catch{fail('ARTIFACT_QUERY_CONFIG_INVALID');}
  const persistence=resolveConfigRuntimePersistence(config);
  const scope=resolveRuntimeProjectContext({targetRoot});
  const database=persistence?.backend==='postgres'||(resolveConfigStateMode(config)??'files')!=='files';
  let backend='files',payload,observed=[],directories=[];
  if(database){if(persistence?.backend!=='postgres')physicalPath(targetRoot,'.aidn/runtime/index/workflow-index.sqlite');
    const snapshot=await snapshotReader({targetRoot,backend:persistence?.backend??'sqlite',
    indexFile:path.resolve(targetRoot,'.aidn/runtime/index/workflow-index.sqlite'),connectionRef:persistence?.connectionRef??'',configData:config});
    if(snapshot.backend!==(persistence?.backend??'sqlite'))fail('ARTIFACT_QUERY_CANONICAL_UNAVAILABLE');
    backend=snapshot.backend;payload=structuredClone(snapshot.payload);
    // Historical local SQLite snapshots bind their owner through index_meta's
    // target_root, not a persisted project_context envelope. Never apply this
    // compatibility binding to PostgreSQL or to a copied foreign database.
    if(backend==='sqlite' && !payload?.project_context){
      if(typeof payload?.target_root!=='string'||path.resolve(payload.target_root)!==path.resolve(targetRoot))fail('ARTIFACT_QUERY_SCOPE_MISMATCH');
      payload.project_context=scope;
    }
  }else{
    const audit='docs/audit', rows=[];
    const take=relative=>{const read=readPhysical(targetRoot,`${audit}/${relative}`);if(!read)return null;observed.push(read);
      const row={path:relative,content:read.bytes.toString('utf8'),content_format:'utf8',sha256:read.fingerprint};rows.push(row);return row;};
    const current=take('CURRENT-STATE.md');take('RUNTIME-STATE.md');
    if(current)for(const [key,prefix,dir,status]of [['active_session','S','sessions',false],['active_cycle','C','cycles',true]]){
      const id=inspectStructuredField(current.content,key).scalar;if(!validId(id,prefix))continue;
      const folder=path.join(targetRoot,audit,dir);
      if(fs.lstatSync(folder,{throwIfNoEntry:false})?.isSymbolicLink())fail('ARTIFACT_QUERY_SYMLINK');
      const names=fs.existsSync(folder)?fs.readdirSync(folder).sort():null;
      directories.push({folder,names});if(!names)continue;
      for(const name of names)if(new RegExp(status?`^${id}(?:[-_].+)?$`:`^${id}(?:[-_.].*)?\\.md$`).test(name))take(`${dir}/${name}${status?'/status.md':''}`);
    }
    for(const name of extraPaths)if(!rows.some(r=>r.path===name))take(name);
    payload={project_context:scope,artifacts:rows};
  }
  if(afterRead)await afterRead();
  for(const d of directories){if(fs.lstatSync(d.folder,{throwIfNoEntry:false})?.isSymbolicLink()
    || !isDeepStrictEqual(fs.existsSync(d.folder)?fs.readdirSync(d.folder).sort():null,d.names))fail('ARTIFACT_QUERY_SOURCE_CHANGED');}
  for(const read of [...observed,...(configObservation?[configObservation]:[])]){
    if(readPhysical(targetRoot,read.relative)?.fingerprint!==read.fingerprint)fail('ARTIFACT_QUERY_SOURCE_CHANGED');
  }
  if(!configObservation && readPhysical(targetRoot,'.aidn/config.json'))fail('ARTIFACT_QUERY_SOURCE_CHANGED');
  if(!isDeepStrictEqual(identity(resolveRuntimeProjectContext({targetRoot})),identity(scope)))fail('ARTIFACT_QUERY_SCOPE_CHANGED');
  return {payload,backend,scope,stateMode:resolveConfigStateMode(config)??'files'};
}
