import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { win32 as path } from "node:path";
import { projectManagedSetupLegacyScope as project } from "../../src/core/agents/codex-managed-setup-legacy-scope.mjs";
import { getManagedSandboxOperationPolicy } from "../../src/core/agents/codex-managed-sandbox-operation-policy.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
import { buildManagedSetupArguments } from "../../src/adapters/agents/codex-managed-setup-transport.mjs";
const H="a".repeat(64), checks=[], copy=structuredClone;
const rawHash=value=>createHash("sha256").update(value).digest("hex");
async function check(name,fn){try{await fn();checks.push({name,status:"PASS"});}catch(error){checks.push({name,status:"FAIL",detail:String(error.stack).slice(0,1300)});}}
function fixture(){
  const profile="C:\\Users\\fixture", home=path.join(profile,".codex"), cwd="D:\\fixture\\work";
  const startup={state_root:"D:\\fixture\\state",mcp_server_ids:[],plugin_ids:[],app_ids:[],environment_override_names:[]};
  const environment={SYSTEMROOT:"C:\\Windows",WINDIR:"C:\\Windows",COMSPEC:"C:\\Windows\\system32\\cmd.exe",PATH:"C:\\Windows\\system32",PATHEXT:".EXE",
    USERPROFILE:profile,LOCALAPPDATA:path.join(profile,"AppData","Local"),APPDATA:path.join(profile,"AppData","Roaming"),PROGRAMDATA:"C:\\ProgramData",
    CODEX_HOME:home,TEMP:startup.state_root,TMP:startup.state_root};
  const settings={}, args=buildManagedSetupArguments(startup);
  for(let i=0;i<args.length-3;i+=2){
    assert.equal(args[i],"-c");const setting=args[i+1], split=setting.indexOf("="), keys=setting.slice(0,split).split("."), literal=setting.slice(split+1);
    const value=JSON.parse(literal.startsWith("{")?literal.replaceAll("=",":").replaceAll("{enabled:false}",'{"enabled":false}'):literal);
    let target=settings;for(const key of keys.slice(0,-1)) target=target[key]??={};target[keys.at(-1)]=value;
  }
  const configuration={metadata:{configs:[{config:settings,origins:{},layers:[{name:{type:"sessionFlags"},version:"fixture",config:copy(settings)}]}],
    requirements:{requirements:null},hooks:{},readiness:{},process:{}},startup,cwd,profile_root:home,candidate_root:"D:\\fixture\\candidate",
    client_sha256:getManagedSandboxOperationPolicy().client_sha256,source_files:[]};
  const facts={contract_version:"aidn-managed-setup-legacy-facts.v1",observed_at:"2026-01-01T00:00:00.000Z",observer_context_sha256:H,paths:[],listings:[],prior_deny_read_content:null};
  const f={configuration,environment,facts,at:"2026-01-01T00:00:00.100Z"};
  for(const target of [cwd,home,configuration.candidate_root,profile,startup.state_root,settings.log_dir,settings.sqlite_home,path.join(home,".sandbox-bin"),
    "C:\\Windows","C:\\Program Files","C:\\Program Files (x86)","C:\\ProgramData",path.join(profile,"AppData"),path.join(profile,".cache"),
    path.join(environment.LOCALAPPDATA,"OpenAI","Codex"),path.join(profile,".cache","codex-runtimes")]) present(f,target);
  for(const target of [".git",".agents",".codex"].map(n=>path.join(cwd,n)).concat([path.join(profile,".ssh","config"),priorPath(f)]))absent(f,target);
  const note=path.join(profile,"notes.txt");present(f,note,"file");
  facts.listings.push({path:profile,complete:true,entries:[home,path.join(profile,"AppData"),path.join(profile,".cache"),note,path.join(profile,".ssh")]});
  const rt=runtimeRoot(f), folder=path.join(rt,"v1"), file=path.join(folder,"node.exe");present(f,rt);present(f,folder);present(f,file,"file");
  facts.listings.push({path:rt,complete:true,entries:[folder]},{path:folder,complete:true,entries:[file]});return f;
}
function present(f,target,object_type="directory"){const r={path:target,state:"present",object_type,physical_path:target,volume_id:"0000000000000001",file_id:(f.facts.paths.reduce((max,row)=>row.file_id===null?max:Math.max(max,Number.parseInt(row.file_id,16)),0)+1).toString(16).padStart(32,"0"),link_count:object_type==="file"?1:null,ancestors_non_reparse:true,reparse:false,content_sha256:null};f.facts.paths.push(r);return r;}
function absent(f,target){f.facts.paths.push({path:target,state:"absent",object_type:null,physical_path:null,volume_id:null,file_id:null,link_count:null,ancestors_non_reparse:true,reparse:null,content_sha256:null});}
const runtimeRoot=f=>path.join(f.environment.LOCALAPPDATA,"OpenAI","Codex","runtimes");
const priorPath=f=>path.join(f.configuration.profile_root,".sandbox","deny_read_acl_state.json");
const row=(f,p)=>f.facts.paths.find(r=>r.path===p), listing=(f,p)=>f.facts.listings.find(r=>r.path===p);
function runtimeChildren(f,count){const p=runtimeRoot(f);f.facts.paths=f.facts.paths.filter(r=>!r.path.startsWith(p+"\\"));f.facts.listings=f.facts.listings.filter(r=>!r.path.startsWith(p+"\\"));
  const list=listing(f,p);list.entries=[];for(let n=0;n<count;n++){const child=path.join(p,"f"+n);present(f,child,"file");list.entries.push(child);}}
function prior(f,text){f.facts.paths=f.facts.paths.filter(r=>r.path!==priorPath(f));present(f,priorPath(f),"file").content_sha256=rawHash(text);f.facts.prior_deny_read_content=text;}
function rejects(mutate,code){const f=fixture();mutate(f);assert.throws(()=>project(f),e=>e.code==="MANAGED_LEGACY_SCOPE_"+code);}
await check("Full scope is derived, hashed and never authorizes execution",()=>{
  const f=fixture(),r=project(f),p=r.preimage;assert.equal(r.status,"RESOLVED_FOR_REVIEW");assert.equal(r.authority,"STRUCTURAL_NOT_AUTHENTICATED");
  assert.equal(r.authorization,"NOT_AUTHORIZED");assert.equal(r.execution_available,false);assert.equal(r.native_qualified,false);assert.equal(r.qualification,"NOT_RUN");
  assert.equal(r.complete_effect_coverage,false);assert.equal(r.initial_provisioning,"CONDITIONAL_NOT_ASSESSED");assert.equal(p.phase,"Full");assert.equal(p.runtime,"Legacy");assert.equal(p.refresh_only,true);
  assert.deepEqual(p.write_roots,[f.configuration.cwd]);for(const key of ["deny_read_paths","prior_deny_read_paths","deny_write_paths"])assert.deepEqual(p[key],[]);
  assert.deepEqual(p.network,{allow_local_binding:false,proxy_ports:[]});assert.equal(r.permission_profile_sha256,hash(p));assert(Object.isFrozen(r)&&Object.isFrozen(p.read_roots));
});
await check("home files and directories plus helper/platform reads exclude USERPROFILE and write cwd",()=>{
  const f=fixture(),roots=project(f).preimage.read_roots;for(const p of [path.join(f.environment.USERPROFILE,"notes.txt"),f.configuration.profile_root,"C:\\Windows",path.join(f.configuration.profile_root,".sandbox-bin")])assert(roots.includes(p));
  assert(!roots.includes(f.environment.USERPROFILE));assert(!roots.includes(f.configuration.cwd));assert(!roots.some(p=>p.includes("\\.ssh")));
});
await check("all twelve home exclusions are filtered before child observation",()=>{
  const f=fixture(),l=listing(f,f.environment.USERPROFILE);for(const n of [".tsh",".brev",".gnupg",".aws",".azure",".kube",".docker",".config",".npm",".pki",".terraform.d"])l.entries.push(path.join(f.environment.USERPROFILE,n.toUpperCase()));
  assert.equal(project(f).preimage.read_roots.length,project(fixture()).preimage.read_roots.length);
});
await check("runtime closure contains every descendant plus two shallow ACL roots",()=>{const f=fixture(),r=project(f).preimage.runtime_paths;assert.equal(r.length,5);assert(r.includes(path.join(runtimeRoot(f),"v1","node.exe")));assert(r.includes(path.join(f.environment.USERPROFILE,".cache","codex-runtimes")));});
await check("observed runtime subtree absence is distinct from incomplete traversal",()=>{const f=fixture(),rt=runtimeRoot(f);f.facts.paths=f.facts.paths.filter(r=>r.path!==rt&&!r.path.startsWith(rt+"\\"));f.facts.listings=f.facts.listings.filter(r=>r.path!==rt&&!r.path.startsWith(rt+"\\"));absent(f,rt);assert.equal(project(f).preimage.runtime_paths.length,2);});
await check("properly typed empty prior state binds its exact bytes",()=>{const f=fixture();prior(f,'{ "principals": {} }\n');assert.deepEqual(project(f).preimage.prior_deny_read_paths,[]);});
await check("4096 runtime descendants fit 2MiB and produce 4099 selectors",()=>{const f=fixture();runtimeChildren(f,4096);assert(Buffer.byteLength(JSON.stringify(f))<2097152);const r=project(f);assert.equal(r.preimage.runtime_paths.length,4099);assert(Buffer.byteLength(JSON.stringify(r))<2097152);});
await check("4097 immediate descendants fail without truncation",()=>rejects(f=>runtimeChildren(f,4097),"LISTING_INCOMPLETE"));
await check("4097 descendants across directories fail cumulative traversal bound",()=>{const f=fixture();runtimeChildren(f,4095);const rt=runtimeRoot(f),branch=path.join(rt,"extra"),leaf=path.join(branch,"leaf");listing(f,rt).entries.push(branch);present(f,branch);present(f,leaf,"file");f.facts.listings.push({path:branch,complete:true,entries:[leaf]});assert.throws(()=>project(f),{code:"MANAGED_LEGACY_SCOPE_RUNTIME_LIMIT"});});
await check("input is immutable, output preimage changes with physical identity",()=>{const f=fixture(),before=copy(f),a=project(f);assert.deepEqual(f,before);row(f,f.configuration.cwd).file_id="f".repeat(32);assert.notEqual(a.permission_profile_sha256,project(f).permission_profile_sha256);});
for(const type of ["file","directory"])await check("refuses duplicate physical "+type+" identity",()=>rejects(f=>{const rows=f.facts.paths.filter(r=>r.object_type===type);rows[1].volume_id=rows[0].volume_id;rows[1].file_id=rows[0].file_id;},"PHYSICAL_IDENTITY_DUPLICATE"));
await check("refuses physical identity shared by file and directory",()=>rejects(f=>{const a=f.facts.paths.find(r=>r.object_type==="file"),b=f.facts.paths.find(r=>r.object_type==="directory");a.volume_id=b.volume_id;a.file_id=b.file_id;},"PHYSICAL_IDENTITY_DUPLICATE"));
await check("same file identifier on a distinct volume remains a distinct object",()=>{const f=fixture(),rows=f.facts.paths.filter(r=>r.object_type==="file");rows[1].file_id=rows[0].file_id;rows[1].volume_id="0000000000000002";assert.equal(project(f).status,"RESOLVED_FOR_REVIEW");});
for(const link_count of [2,null,0,"1",true])await check("refuses file link count "+JSON.stringify(link_count),()=>rejects(f=>{f.facts.paths.find(r=>r.object_type==="file").link_count=link_count;},"LINK_COUNT_UNSUPPORTED"));
await check("refuses unobserved file link count",()=>rejects(f=>{delete f.facts.paths.find(r=>r.object_type==="file").link_count;},"PATH_FACT_INVALID"));
await check("refuses link count on directory",()=>rejects(f=>{f.facts.paths.find(r=>r.object_type==="directory").link_count=1;},"LINK_COUNT_UNSUPPORTED"));
await check("refuses link count on absence",()=>rejects(f=>{f.facts.paths.find(r=>r.state==="absent").link_count=1;},"ABSENCE_INVALID"));
for(const [field,value] of [["volume_id","1"],["volume_id","00000001"],["volume_id","A".repeat(16)],["file_id","001"],["file_id","A".repeat(32)],["file_id","0x"+"0".repeat(32)]])await check("refuses noncanonical "+field+" "+value,()=>rejects(f=>{f.facts.paths[0][field]=value;},"PATH_FACT_INVALID"));
await check("observer digest changes invalidate the preimage",()=>{const f=fixture(),a=project(f);f.facts.observer_context_sha256="b".repeat(64);assert.notEqual(a.permission_profile_sha256,project(f).permission_profile_sha256);});
await check("listing order preserves derived sets while retaining original evidence",()=>{const f=fixture(),a=project(f);listing(f,f.environment.USERPROFILE).entries.reverse();const b=project(f);assert.deepEqual(a.preimage.read_roots,b.preimage.read_roots);assert.notEqual(a.preimage.facts_sha256,b.preimage.facts_sha256);});
for(const [name,mutate,code] of [
  ["caller roots",f=>{f.read_roots=[];},"INPUT_INVALID"],["facts version",f=>{f.facts.contract_version="other";},"FACTS_INVALID"],
  ["observer missing",f=>{delete f.facts.observer_context_sha256;},"FACTS_INVALID"],["future",f=>{f.facts.observed_at="2026-01-01T00:00:01.000Z";},"FACTS_STALE"],
  ["stale",f=>{f.at="2026-01-01T00:05:00.001Z";},"FACTS_STALE"],["timestamp",f=>{f.at="2026-01-01T00:00:00Z";},"TIME_INVALID"],
  ["proxy",f=>{f.environment.HTTP_PROXY="http://localhost:8080";},"ENVIRONMENT_INVALID"],["binding",f=>{f.environment.CODEX_NETWORK_ALLOW_LOCAL_BINDING="1";},"ENVIRONMENT_INVALID"],
  ["registered core",f=>{f.environment.CODEX_WINDOWS_REGISTERED_CORE="1";},"ENVIRONMENT_INVALID"],["empty appdata",f=>{f.environment.LOCALAPPDATA="";},"ENVIRONMENT_INVALID"],
  ["home mismatch",f=>{f.environment.CODEX_HOME="C:\\foreign";},"ENVIRONMENT_BINDING"],["temp mismatch",f=>{f.environment.TEMP="D:\\foreign";},"ENVIRONMENT_BINDING"],
  ["opaque network",f=>{f.configuration.metadata.configs[0].config.network={};},"NETWORK_UNSUPPORTED"],
  ["cwd under home",f=>{f.configuration.cwd=path.join(f.environment.USERPROFILE,"work");},"CWD_SUBSET_UNSUPPORTED"],
  ["path missing",f=>{f.facts.paths.shift();},"PATH_UNOBSERVED"],["case alias duplicate",f=>{f.facts.paths.push({...f.facts.paths[0],path:f.facts.paths[0].path.toUpperCase()});},"PATH_FACT_DUPLICATE"],
  ["unknown absence",f=>{row(f,path.join(f.configuration.cwd,".git")).state="unknown";},"PATH_FACT_INVALID"],
  ["absence with identity",f=>{row(f,path.join(f.configuration.cwd,".git")).file_id="1";},"ABSENCE_INVALID"],
  ["reparse",f=>{f.facts.paths[0].reparse=true;},"PATH_FACT_INVALID"],["ancestors unknown",f=>{f.facts.paths[0].ancestors_non_reparse=false;},"ANCESTORS_UNVERIFIED"],
  ["physical alias",f=>{f.facts.paths[0].physical_path="D:\\other";},"PATH_FACT_INVALID"],["missing volume",f=>{f.facts.paths[0].volume_id=null;},"PATH_FACT_INVALID"],
  ["extra path authority",f=>{f.facts.paths[0].trusted=true;},"PATH_FACT_INVALID"],["partial listing",f=>{f.facts.listings[0].complete=false;},"LISTING_INCOMPLETE"],
  ["duplicate listing",f=>{f.facts.listings.push(copy(f.facts.listings[0]));},"LISTING_INVALID"],
  ["non immediate entry",f=>{listing(f,f.environment.USERPROFILE).entries.push(path.join(f.environment.USERPROFILE,"a","b"));},"LISTING_INVALID"],
  ["unused path",f=>{present(f,"D:\\unused");},"UNUSED_FACTS"],["missing runtime listing",f=>{f.facts.listings=f.facts.listings.filter(r=>r.path!==runtimeRoot(f));},"LISTING_UNOBSERVED"],
  ["prior bytes absent",f=>{f.facts.prior_deny_read_content='{"principals":{}}';},"PRIOR_STATE_MISMATCH"],
  ["prior hash",f=>{prior(f,'{"principals":{}}');row(f,priorPath(f)).content_sha256=H;},"PRIOR_STATE_MISMATCH"],
  ["prior empty object",f=>{prior(f,"{}");},"PRIOR_STATE_UNSUPPORTED"],["prior nonempty SID",f=>{prior(f,'{"principals":{"S-1-5-1":[]}}');},"PRIOR_STATE_UNSUPPORTED"],
  ["prior duplicate field",f=>{prior(f,'{"principals":{"S-1-5-1":["C:\\\\x"]},"principals":{}}');},"PRIOR_STATE_UNSUPPORTED"],
  ["prior invalid JSON",f=>{prior(f,"{");},"PRIOR_STATE_INVALID"]
])await check("refuses "+name,()=>rejects(mutate,code));
for(const name of [".git",".agents",".codex"])await check("refuses existing cwd "+name,()=>rejects(f=>{const p=path.join(f.configuration.cwd,name);f.facts.paths=f.facts.paths.filter(r=>r.path!==p);present(f,p);},"CWD_METADATA_UNSUPPORTED"));
await check("refuses SSH config without reading Include or keys",()=>rejects(f=>{const p=path.join(f.environment.USERPROFILE,".ssh","config");f.facts.paths=f.facts.paths.filter(r=>r.path!==p);present(f,p,"file");},"SSH_CONFIG_UNSUPPORTED"));
for(const p of ["C:\\a\\..\\b","\\\\server\\share\\x","C:\\a:stream","C:\\a\\NUL","C:\\a\\trail."])await check("rejects path syntax "+p,()=>rejects(f=>{f.facts.paths[0].path=p;},"PATH_INVALID"));
await check("recalculates configuration rather than trusting caller status",()=>{const f=fixture();f.configuration.metadata.requirements.requirements={};assert.throws(()=>project(f),{code:"MANAGED_CONFIGURATION_REQUIREMENTS_UNSUPPORTED"});});
await check("accessors do not run",()=>{const f=fixture();let calls=0;Object.defineProperty(f.facts.paths[0],"path",{enumerable:true,get(){calls++;return"D:\\x";}});assert.throws(()=>project(f),{code:"MANAGED_LEGACY_SCOPE_JSON_INVALID"});assert.equal(calls,0);});
await check("UTF8 document bound precedes processing",()=>{const f=fixture();f.facts.extra="é".repeat(1100000);assert.throws(()=>project(f),{code:"MANAGED_LEGACY_SCOPE_JSON_LIMIT"});});
await check("import and projection have no I/O, process, network or implicit clock",async()=>{
  const source=new URL("../../src/core/agents/codex-managed-setup-legacy-scope.mjs",import.meta.url);
  const code=fs.readFileSync(source,"utf8").replace(/from "(\.\/[^"]+)"/gu,(_,relative)=>"from "+JSON.stringify(new URL(relative,source).href));
  const f=fixture(),expected=project(f),saved=[];const block=(target,key)=>{saved.push([target,key,target[key]]);target[key]=()=>{throw new Error("UNEXPECTED_EFFECT_"+key);};};
  try{for(const key of ["readFileSync","writeFileSync","openSync","mkdirSync","statSync","readdirSync","rmSync"])block(fs,key);
    for(const key of ["readFile","writeFile","open","mkdir","stat","readdir","rm"])block(fs.promises,key);
    for(const key of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"])block(childProcess,key);
    for(const target of [http,https])for(const key of ["get","request"])block(target,key);
    for(const key of ["connect","createConnection"])block(net,key);block(Date,"now");block(process,"cwd");syncBuiltinESMExports();
    const m=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));assert.deepEqual(m.projectManagedSetupLegacyScope(f),expected);
  }finally{for(const [target,key,value]of saved.reverse())target[key]=value;syncBuiltinESMExports();}
});
const failed=checks.filter(r=>r.status==="FAIL");
console.log(JSON.stringify({status:failed.length?"FAIL":"PASS",checks,pass:checks.length-failed.length,fail:failed.length,skip:0,native:"NOT_RUN",system_effects:"NOT_RUN",cleanup:{status:"PASS",created_resources:0}},null,2));
process.exitCode=failed.length?1:0;

