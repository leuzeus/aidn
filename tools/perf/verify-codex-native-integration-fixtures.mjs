#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {discoverRepoSkills} from "../verify/codex-discovery-lib.mjs";
import {inspectCodexCapabilities, codexVersionCapabilities} from "../../src/application/codex/codex-capabilities-service.mjs";
import {validateRuntimeCompatibility} from "../../src/application/install/compatibility-policy.mjs";
import {initGitRepo, removePathWithRetry} from "./test-git-fixture-lib.mjs";
import {prepareActivationFixture} from "./test-activation-fixture-lib.mjs";
import {planAuthorization, applyAuthorization, readActivation} from "../../src/application/install/project-activation-service.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const started = performance.now();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(),"aidn-native-integration-"));
const assertions = [];
const timings = [];
let failure = null;
let cleanup;
const hash = (file)=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
function seal(value) { const {integrity_sha256,...content}=value;return {...content,integrity_sha256:createHash("sha256").update(stable(content)).digest("hex")}; }
const record = (name)=>assertions.push({name,status:"PASS"});
function snapshot(root) {
  const entries=[];
  function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(item.name === ".git")continue;
    const absolute=path.join(dir,item.name);const relative=path.relative(root,absolute);
    if(item.isDirectory()){entries.push(relative+"/");visit(absolute);}else entries.push(relative+":"+hash(absolute));
  }}visit(root);return JSON.stringify(entries);
}
// Explicit copies avoid a Windows Node fs.cpSync Unicode destination regression.
function copyFixture(source, destination) {
  fs.mkdirSync(destination, {recursive:true});
  for (const entry of fs.readdirSync(source,{withFileTypes:true})) {
    const from=path.join(source,entry.name), to=path.join(destination,entry.name);
    if (entry.isDirectory()) copyFixture(from,to);
    else if (entry.isFile()) fs.copyFileSync(from,to);
    else throw new Error("fixture entry must be a regular file or directory");
  }
}
function receipt(client,packageRoot=repoRoot){
  const file=path.join(client,".aidn/install/receipt.json"), installed=JSON.parse(fs.readFileSync(file,"utf8"));
  fs.writeFileSync(file,JSON.stringify(seal({...installed,package:{
    root:packageRoot,version:fs.readFileSync(path.join(packageRoot,"VERSION"),"utf8").trim(),entry:"bin/aidn.mjs",
    entry_sha256:hash(path.join(packageRoot,"bin/aidn.mjs")),version_sha256:hash(path.join(packageRoot,"VERSION")),
  }})));
}
function runHook(client,event,payload={},cwd=client){
  const started = performance.now();
  const script=event === "SessionStart" ? "aidn-session-start.mjs" : "aidn-pre-tool-use.mjs";
  const child=spawnSync(process.execPath,[path.join(client,".codex/hooks",script)],{
    cwd,encoding:"utf8",shell:false,windowsHide:true,timeout:15000,input:JSON.stringify({cwd,hook_event_name:event,...payload}),maxBuffer:1024*1024,
  });
  assert.equal(child.status,0,"hook process should return a parseable decision");
  assert.equal(child.error,undefined,"hook process must finish within timeout");
  timings.push({ event, source: payload.source ?? null, tool: payload.tool_name ?? null, duration_ms: Math.round(performance.now() - started), stdout_bytes: Buffer.byteLength(child.stdout) });
  return JSON.parse(child.stdout.trim());
}
const patch={tool_name:"apply_patch",tool_input:{command:"*** Begin Patch\n*** Add File: example.txt\n+fixture\n*** End Patch"}};
try {
  const client=path.join(tempRoot,"client espace \u00e9");
  copyFixture(path.join(repoRoot,"tests/fixtures/perf-handoff/ready"),client);
  initGitRepo(client,{sourceBranch:"main",workingBranch:"feature/C101-alpha"});
  prepareActivationFixture(client,repoRoot);
  assert.equal(readActivation({targetRoot:client}).state,"active","real installation prepares and authorizes this client");
  const subfolder=path.join(client,"src/sous dossier");fs.mkdirSync(subfolder,{recursive:true});
  const runtime = await import(pathToFileURL(path.join(client,".codex/hooks/aidn-hook-runtime.mjs")));
  const admission=runtime.readAdmission(client);
  assert.equal(admission.ok,true,"ready canonical fixture must admit generic write");
  const before=snapshot(client);
  for(const source of ["startup","resume","compact"]){
    const result=runHook(client,"SessionStart",{source},subfolder);
    assert.deepEqual(Object.keys(result),["hookSpecificOutput"],"SessionStart output must contain only native-supported root fields");
    assert.equal(result.hookSpecificOutput.hookEventName,"SessionStart");
    assert.match(result.hookSpecificOutput.additionalContext,/AIDN canonical admission \(read-only\):/);
    assert.match(result.hookSpecificOutput.additionalContext,/"admission":"admitted"/);
    assert(!result.hookSpecificOutput.additionalContext.includes("Missing installed assets:"));
    assert(result.hookSpecificOutput.additionalContext.length<3200);
  }
  const allowed=runHook(client,"PreToolUse",patch,subfolder);
  assert.equal(allowed.hookSpecificOutput.permissionDecision,undefined);
  assert.match(allowed.hookSpecificOutput.additionalContext,/generic admission rechecked/);
  assert.equal(snapshot(client),before,"native wrappers must not write project state or hydrate caches");
  record("canonical-resume-and-admission-read-only-unicode-subfolder");
  const config=JSON.parse(fs.readFileSync(path.join(client,".codex/hooks.json"),"utf8"));
  assert.deepEqual(Object.keys(config), ["hooks"], "distributed native hooks root must use only supported fields");
  const matcher=new RegExp(config.hooks.PreToolUse[0].matcher);
  for(const name of ["apply_patch","Edit","Write"])assert(matcher.test(name));
  for(const name of ["Bash","exec_command","write_stdin","mcp__aidn__admit"])assert.equal(matcher.test(name),false);
  assert.deepEqual(runHook(client,"PreToolUse",{tool_name:"Bash",tool_input:{command:"git status"}}),{});
  record("verified-patch-aliases-only-no-shell-interception-claim");
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const command = process.platform === "win32" ? config.hooks.SessionStart[0].hooks[0].commandWindows : config.hooks.SessionStart[0].hooks[0].command;
  const shellArgs = process.platform === "win32" ? ["-NoProfile","-NonInteractive","-Command",command] : ["-c",command];
  const launched=spawnSync(shell,shellArgs,{cwd:subfolder,encoding:"utf8",input:JSON.stringify({cwd:subfolder,source:"resume"}),timeout:15000,windowsHide:true});
  assert.equal(launched.status,0,"distributed shell command must launch from Unicode subfolder");
  const launchedOutput=JSON.parse(launched.stdout.trim());
  assert.deepEqual(Object.keys(launchedOutput),["hookSpecificOutput"]);
  assert.match(launchedOutput.hookSpecificOutput.additionalContext,/AIDN canonical admission \(read-only\):/);
  record("distributed-command-launch-current-platform");
  const current=path.join(client,"docs/audit/CURRENT-STATE.md");
  fs.writeFileSync(current,fs.readFileSync(current,"utf8").replace(/^mode:.*$/m,"mode: unknown"));
  const blocked=runHook(client,"PreToolUse",patch);
  assert.equal(blocked.hookSpecificOutput.permissionDecision,"deny");
  assert.match(blocked.hookSpecificOutput.permissionDecisionReason,/mode is unknown/);
  assert.equal(runtime.readAdmission(client).ok,false);
  record("fresh-core-denial-after-context-change-no-cached-admission");
  assert.equal(runHook(client,"PreToolUse",{...patch,cwd:tempRoot}).hookSpecificOutput.permissionDecision,"deny");
  fs.mkdirSync(path.join(subfolder,".git"));
  assert.equal(runHook(client,"PreToolUse",patch,subfolder).hookSpecificOutput.permissionDecision,"deny");
  fs.rmdirSync(path.join(subfolder,".git"));
  record("project-and-nested-worktree-isolation");
  for(const result of [{status:1},{status:null,error:new Error("timeout")},{status:null,signal:"SIGTERM"},{status:0,stdout:"not json"},
    ...[
      {ok:true,admission_status:"admitted",target_root:tempRoot},
      {ok:true,admission_status:"admitted",target_root:client},
      {ok:true,admission_status:"admitted",target_root:client,activation:{state:"degraded",active:false}},
      {ok:true,admission_status:"admitted",target_root:client,activation:{state:"unprepared",active:true}},
    ].map(value=>({status:0,stdout:JSON.stringify(value)}))]){
    assert.throws(()=>runtime.readAdmission(client,{commandRunner:()=>result}),/admission_/);
  }
  record("adapter-runtime-error-timeout-signal-invalid-output-rejected");
  const receiptFile=path.join(client,".aidn/install/receipt.json");
  const bound=fs.readFileSync(receiptFile,"utf8");
  const changed=JSON.parse(bound);changed.package.entry_sha256="0".repeat(64);fs.writeFileSync(receiptFile,JSON.stringify(seal(changed)));
  assert.match(runHook(client,"PreToolUse",patch).hookSpecificOutput.permissionDecisionReason,/runtime_binding_changed/);
  fs.writeFileSync(receiptFile,JSON.stringify({schema_version:1,package:JSON.parse(bound).package}));
  assert.throws(()=>runtime.resolveBoundRuntime(client),/runtime_record_integrity_invalid/);
  assert.match(runHook(client,"PreToolUse",patch).hookSpecificOutput.permissionDecisionReason,/runtime_record_integrity_invalid/);
  fs.rmSync(receiptFile);
  assert.deepEqual(runHook(client,"PreToolUse",patch),{});
  assert.deepEqual(runHook(client,"SessionStart"),{});
  assert.equal(runtime.readAdmission(client).activation.state,"unprepared");
  fs.writeFileSync(receiptFile,bound);
  record("invalid-receipt-or-stale-binding-denies-covered-edit-unprepared-stays-neutral");
  const authorityFile=readActivation({targetRoot:client}).identity.authority_path;
  const authorityBytes=fs.readFileSync(authorityFile);
  fs.unlinkSync(authorityFile);
  assert.equal(readActivation({targetRoot:client}).state,"degraded");
  assert.equal(runHook(client,"PreToolUse",patch).hookSpecificOutput.permissionDecision,"deny");
  fs.writeFileSync(authorityFile,authorityBytes);
  record("migrated-receipt-without-authority-never-reactivates-as-legacy");
  const failingPackage=path.join(tempRoot,"runtime-fixture");
  fs.mkdirSync(path.join(failingPackage,"bin"),{recursive:true});
  fs.writeFileSync(path.join(failingPackage,"VERSION"),"0.0.0-fixture");
  for (const scenario of ["exception","timeout"]) {
    fs.writeFileSync(path.join(failingPackage,"bin/aidn.mjs"),scenario === "exception"
      ? "throw new Error('fixture runtime exception');" : "setTimeout(()=>{},30000);");
    receipt(client,failingPackage);
    const failed=runHook(client,"PreToolUse",patch);
    assert.equal(failed.hookSpecificOutput.permissionDecision,"deny");
    assert.match(failed.hookSpecificOutput.permissionDecisionReason,/admission_runtime_unavailable/);
  }
  fs.writeFileSync(receiptFile,bound);
  record("running-wrapper-translates-child-exception-and-timeout-to-explicit-deny");
  const linked=path.join(tempRoot,"linked worktree");
  const linkedResult=spawnSync("git",["-C",client,"worktree","add","--detach",linked,"HEAD"],{encoding:"utf8",windowsHide:true,timeout:10000});
  assert.equal(linkedResult.status,0,linkedResult.stderr);
  copyFixture(path.join(repoRoot,"scaffold/codex_hooks/scripts"),path.join(linked,".codex/hooks"));
  assert.equal(runtime.readAdmission(linked).activation.state,"unprepared");
  assert.deepEqual(runHook(linked,"PreToolUse",patch),{});
  fs.mkdirSync(path.join(linked,".aidn/install"),{recursive:true});
  fs.writeFileSync(path.join(linked,".aidn/install/receipt.json"),bound);
  assert.throws(()=>runtime.resolveBoundRuntime(linked),/runtime_receipt_invalid/);
  record("linked-worktree-needs-local-preparation-and-rejects-copied-receipt");
  applyAuthorization(planAuthorization({targetRoot:client,action:"revoke"}));
  fs.writeFileSync(receiptFile,"{invalid receipt and inaccessible runtime");
  assert.deepEqual(runHook(client,"PreToolUse",patch),{});
  assert.deepEqual(runHook(client,"PreToolUse",{tool_name:"Edit",tool_input:{}}),{});
  assert.deepEqual(runHook(client,"SessionStart"),{});
  assert.equal(runtime.readAdmission(client,{commandRunner:()=>{throw new Error("revoked project must not launch runtime");}}).activation.state,"revoked");
  const beforeRevoked=snapshot(linked), previousGit=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^GIT_/i.test(key)));
  try {
    process.env.GIT_DIR=path.join(tempRoot,"invalid-git-dir"); process.env.GIT_WORK_TREE=tempRoot;
    process.env.GIT_COMMON_DIR=path.join(tempRoot,"invalid-common-dir");process.env.GIT_CONFIG_COUNT="1";
    process.env.GIT_CONFIG_KEY_0="core.worktree";process.env.GIT_CONFIG_VALUE_0=tempRoot;
    assert.equal(runtime.readAdmission(linked,{commandRunner:()=>{throw new Error("revoked linked worktree must not launch runtime");}}).activation.state,"revoked");
    assert.deepEqual(runHook(linked,"SessionStart"),{}); assert.deepEqual(runHook(linked,"PreToolUse",patch),{});
  } finally { for(const key of Object.keys(process.env).filter(key=>/^GIT_/i.test(key)))delete process.env[key];Object.assign(process.env,previousGit); }
  assert.equal(snapshot(linked),beforeRevoked);
  fs.writeFileSync(receiptFile,bound);
  record("canonical-revocation-is-neutral-before-invalid-receipt-or-runtime-access");
  const absent=path.join(tempRoot,"absent");
  copyFixture(path.join(repoRoot,"scaffold/codex_hooks/scripts"),path.join(absent,".codex/hooks"));
  const absentBefore=snapshot(absent);
  assert.deepEqual(runHook(absent,"SessionStart"),{});
  assert.deepEqual(runHook(absent,"PreToolUse",patch),{});
  assert.equal(snapshot(absent),absentBefore);
  record("orphan-hooks-without-activation-or-receipt-are-neutral-and-read-only");
  const host=path.join(tempRoot,"host");
  const bin=path.join(host,"local/OpenAI/Codex/bin/fixture/codex.exe");fs.mkdirSync(path.dirname(bin),{recursive:true});fs.writeFileSync(bin,"fixture executable");
  const desktop=path.join(host,"programs/WindowsApps/OpenAI.Codex_fixture/app/ChatGPT.exe");fs.mkdirSync(path.dirname(desktop),{recursive:true});fs.writeFileSync(desktop,"fixture app");
  const versionCalls=[];
  const capabilities=inspectCodexCapabilities({targetRoot:client,platform:"win32",env:{PATH:"",LOCALAPPDATA:path.join(host,"local"),ProgramFiles:path.join(host,"programs")},
    commandRunner:(command,args)=>{versionCalls.push({command,args});return {status:0,stdout:"codex-cli 0.155.0-alpha.9.2\n"};}});
  assert.equal(capabilities.clients[0].detected,false);
  assert.equal(capabilities.clients.find((item)=>item.kind==="desktop").app_detected,true);
  assert.equal(capabilities.states.approved,"unknown");assert.equal(capabilities.states.operational,"unverified");
  assert(versionCalls.every((call)=>JSON.stringify(call.args)==='["--version"]'));
  assert.equal(codexVersionCapabilities("0.146.0-alpha.9.2").mcp_hooks,"unsupported");
  assert.equal(codexVersionCapabilities("99.0.0").command_hooks,"unknown");
  record("diagnostic-desktop-without-path-cli-version-scoping-no-trust-inference");
  const oldPath=process.env.PATH;process.env.PATH="";
  try{assert.equal(validateRuntimeCompatibility({codexOnline:true},{requireCodex:false}).codexAuthChecked,false);}
  finally{process.env.PATH=oldPath;}
  record("local-install-does-not-require-codex-cli-or-login");
  const discoveryClient=path.join(tempRoot,"discovery");fs.mkdirSync(path.join(discoveryClient,".agents/skills/expected"),{recursive:true});
  fs.writeFileSync(path.join(discoveryClient,".agents/skills/expected/SKILL.md"),"---\nname: expected\ndescription: fixture\n---\n");
  const fake=path.join(tempRoot,"fixture-discovery.mjs");
  fs.writeFileSync(fake,[
    "import readline from 'node:readline';import path from 'node:path';",
    "const lines=readline.createInterface({input:process.stdin});lines.on('line',line=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));",
    "if(m.method==='skills/list'){const cwd=m.params.cwds[0];const mode=process.env.AIDN_FIXTURE_MODE;",
    "const skills=mode==='empty'?[]:[{name:mode==='missing'?'other':'expected',scope:'repo',enabled:mode!=='disabled',path:path.join(cwd,'.agents/skills/expected/SKILL.md')}];",
    "console.log(JSON.stringify({id:m.id,result:{data:mode==='no-cwd'?[]:[{cwd,skills,errors:[]}]}}));}});",
  ].join("\n"));
  for(const mode of ["empty","missing","disabled","no-cwd","complete"]){
    const result=await discoverRepoSkills({cwd:discoveryClient,codexHome:path.join(tempRoot,"discovery-home-"+mode),
      env:{...process.env,AIDN_CODEX_JS:fake,AIDN_FIXTURE_MODE:mode},timeoutMs:5000});
    assert.equal(result.status,mode === "complete" ? "PASS" : "FAIL",mode+" skill list");
  }
  record("discovery-rejects-empty-incomplete-disabled-or-missing-cwd-fixture-responses");
} catch(error) { failure={message:String(error.message).slice(0,1600)}; }
finally {
  const resolved=path.resolve(tempRoot);
  if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error("cleanup outside temporary root");
  cleanup=removePathWithRetry(resolved);
}
const output={status:!failure&&cleanup.ok?"PASS":"FAIL",proof_class:"fixture",duration_ms:Math.round(performance.now()-started),assertions,failure,
  cleanup:{ok:cleanup.ok,attempts:cleanup.attempts},native_client_qualification:"SKIP: no trust approval or Codex tool execution",
  native_failure_modes:"SKIP: disabled hook, native timeout/error continuation require client qualification; adapter deny is fixture-proven",
  other_platform:"SKIP: only the current host launcher was executed",llm_calls:0,timings,
  measurement_unit:"wall-clock milliseconds and stdout bytes; not tokens"};
console.log(JSON.stringify(output,null,2));
if(output.status!=="PASS")process.exitCode=1;
