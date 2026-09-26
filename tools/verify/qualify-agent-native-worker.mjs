#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { withEphemeralPostgres } from "../perf/agent-execution-postgres-test-lib.mjs";
import { assertAgentNativeRefreshReview } from "./refresh-agent-native-candidate.mjs";
import { hash, json, fail, requireProof, physical, inventory, compareInventory, writeEvidence, loadCandidate, runNativeQualificationCase } from "./agent-native-qualification-driver.mjs";

const SOURCE=path.resolve(import.meta.dirname,"../..");
const read=file=>JSON.parse(fs.readFileSync(physical(file,"file"),"utf8"));
const identity=value=>process.platform==="win32"?path.resolve(value).toLowerCase():path.resolve(value);
function outside(parent,child) {const rel=path.relative(parent,child);return rel===".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);}

// Pure continuity validation shared with fixtures. Receipt hashes and their
// installation plan IDs may change; native identities and reviewed hooks may not.
export function assertAgentNativeQualificationRefreshContinuity({manifest,trust,previousManifest,previousTrust}) {
  assertAgentNativeRefreshReview(manifest,trust);
  assertAgentNativeRefreshReview(previousManifest,previousTrust);
  requireProof(identity(manifest.codex_home)===identity(previousManifest.codex_home)
    && isDeepStrictEqual(manifest.codex,previousManifest.codex)
    && manifest.host.platform===previousManifest.host.platform && manifest.host.architecture===previousManifest.host.architecture,
  "QUALIFICATION_REFRESH_NATIVE_RUNTIME_CHANGED");
  for(const root of manifest.roots) {
    const before=previousManifest.roots.find(row=>row.role===root.role);
    requireProof(before && identity(root.root)===identity(before.root)
      && ["worktree_id","branch","head"].every(key=>root[key]===before[key])
      && isDeepStrictEqual(root.identity,before.identity) && isDeepStrictEqual(root.activation,before.activation)
      && isDeepStrictEqual(root.hooks,before.hooks)
      && isDeepStrictEqual({...root.installation,plan_id:null},{...before.installation,plan_id:null})
      && root.receipt.root_id===before.receipt.root_id && identity(root.receipt.path)===identity(before.receipt.path)
      && root.attempt_marker_present===false && before.attempt_marker_present===false,
    "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED");
  }
  for(const surface of trust.hooks.data) {
    const previous=previousTrust.hooks.data.find(row=>identity(row.cwd)===identity(surface.cwd));
    requireProof(previous,"QUALIFICATION_REFRESH_NATIVE_ROOT_CHANGED");
    for(const hook of surface.hooks) {
      const before=previous.hooks.find(row=>row.eventName===hook.eventName);
      requireProof(before && identity(before.sourcePath)===identity(hook.sourcePath) && before.currentHash===hook.currentHash,
        "QUALIFICATION_REFRESH_NATIVE_DEFINITION_CHANGED");
    }
  }
  return true;
}

// This internal, local qualification is never an automatic gate or a public
// agent-run command. Preview performs filesystem reads only. --write explicitly
// permits four bounded native model calls and a disposable PostgreSQL cluster.
// Existing native project/hook trust and authentication must already exist.
export async function qualifyAgentNativeWorker({manifest:manifestFile,helperManifest,pgBin,model,effort,reviewProof,outputRoot,write=false}={}) {
  requireProof(typeof write==="boolean","QUALIFICATION_EXPLICIT_WRITE_BOOLEAN_REQUIRED");
  manifestFile=physical(manifestFile,"file"); helperManifest=physical(helperManifest,"file"); reviewProof=physical(reviewProof,"file"); pgBin=physical(pgBin,"directory"); outputRoot=physical(outputRoot);
  const manifest=read(manifestFile), helper=read(helperManifest), review=read(reviewProof);
  requireProof(manifest.ok===true && manifest.status==="prepared" && manifest.written===true && manifest.native_execution==="NOT_RUN","QUALIFICATION_PREPARATION_REQUIRED");
  requireProof(process.platform==="win32" && process.arch==="x64" && manifest.host?.platform===process.platform && manifest.host?.architecture===process.arch,"QUALIFICATION_OS_UNAVAILABLE");
  requireProof(typeof model==="string" && model.length>0 && typeof effort==="string" && effort.length>0,"QUALIFICATION_EXPLICIT_MODEL_REQUIRED");
  requireProof(!fs.existsSync(outputRoot) && fs.statSync(path.dirname(outputRoot)).isDirectory(),"QUALIFICATION_OUTPUT_MUST_BE_NEW");
  requireProof(outside(SOURCE,outputRoot) && manifest.roots.every(r=>outside(r.root,outputRoot)) && outside(manifest.codex_home,outputRoot) && outside(manifest.candidate.packageRoot,outputRoot),"QUALIFICATION_OUTPUT_INSIDE_PROTECTED_ROOT");
  requireProof(review.approved===true && review.preparation_id===manifest.preparation_id && review.manifest_sha256===hash(fs.readFileSync(manifestFile)) && review.candidate_sha256===manifest.candidate.sha256 && review.codex_sha256===manifest.codex.sha256 && review.helper_sha256===helper.helper_sha256 && review.model===model && review.effort===effort,"QUALIFICATION_REVIEW_BINDING_INVALID");
  requireProof(review.native_trust?.sha256===hash(fs.readFileSync(physical(review.native_trust?.path,"file"))),"QUALIFICATION_TRUST_PROOF_CHANGED");
  const trust=read(review.native_trust.path);
  assertAgentNativeRefreshReview(manifest,trust);
  requireProof(trust.candidate_sha256===manifest.candidate.sha256 && trust.codex_sha256===manifest.codex.sha256 && identity(trust.codex_home)===identity(manifest.codex_home) && trust.process_closed===true,"QUALIFICATION_TRUST_BINDING_INVALID");
  if(manifest.refresh) {
    const previousManifestPath=physical(manifest.refresh.prior_manifest,"file");
    const previousTrustPath=physical(manifest.refresh.trust_evidence?.path,"file");
    requireProof(hash(fs.readFileSync(previousManifestPath))===manifest.refresh.prior_manifest_sha256 && hash(fs.readFileSync(previousTrustPath))===manifest.refresh.trust_evidence.sha256,"QUALIFICATION_PRIOR_TRUST_EVIDENCE_CHANGED");
    const previousManifest=read(previousManifestPath),previousTrust=read(previousTrustPath);
    assertAgentNativeQualificationRefreshContinuity({manifest,trust,previousManifest,previousTrust});
  }
  const selectedModel=trust.models?.data?.find(row=>row.id===model || row.model===model);
  requireProof(selectedModel && selectedModel.supportedReasoningEfforts?.some(row=>row.reasoningEffort===effort),"QUALIFICATION_MODEL_UNAVAILABLE");
  requireProof(manifest.roots.length===3 && ["coordinator","worker-a","worker-b"].every(role=>manifest.roots.filter(r=>r.role===role).length===1),"QUALIFICATION_ROOTS_INVALID");
  for(const root of manifest.roots) {
    physical(root.root,"directory");
    requireProof(root.activation?.state==="active" && root.installation?.persistence_policy==="verify-only","QUALIFICATION_ACTIVATION_REQUIRED");
    requireProof(root.attempt_marker_present===false && !fs.existsSync(path.join(root.root,".codex/aidn-agent-attempt.json")),"QUALIFICATION_EXISTING_ATTEMPT_REQUIRES_RECONCILIATION");
    requireProof(root.receipt.sha256===hash(fs.readFileSync(physical(root.receipt.path,"file"))),"QUALIFICATION_RECEIPT_CHANGED");
    requireProof(root.hooks.config.sha256===hash(fs.readFileSync(physical(root.hooks.config.path,"file"))),"QUALIFICATION_HOOK_CONFIGURATION_CHANGED");
    for(const handler of root.hooks.handlers) requireProof(hash(fs.readFileSync(physical(path.join(root.root,handler.path),"file")))===handler.sha256,"QUALIFICATION_HOOK_HANDLER_CHANGED");
    if(root.role==="coordinator") continue;
    const native=trust.hooks?.data?.find(row=>identity(row.cwd)===identity(root.root));
    requireProof(native && native.errors?.length===0 && native.warnings?.length===0,"QUALIFICATION_NATIVE_TRUST_MISSING");
    const coordinator=manifest.roots.find(row=>row.role==="coordinator");
    for(const eventName of ["preToolUse","sessionStart"]) {
      const hook=native.hooks?.filter(row=>row.eventName===eventName);
      requireProof(hook?.length===1 && hook[0].enabled===true && hook[0].trustStatus==="trusted" && hook[0].handlerType==="command" && identity(hook[0].sourcePath)===identity(coordinator.hooks.config.path),"QUALIFICATION_NATIVE_HOOK_NOT_TRUSTED");
      const configured=JSON.parse(coordinator.hooks.definition).hooks[eventName==="preToolUse"?"PreToolUse":"SessionStart"][0].hooks[0];
      requireProof(hook[0].command===(configured.commandWindows ?? configured.command),"QUALIFICATION_NATIVE_HOOK_COMMAND_CHANGED");
    }
  }
  physical(manifest.codex_home,"directory");
  requireProof(hash(fs.readFileSync(physical(manifest.codex.binary_path,"file")))===manifest.codex.sha256,"QUALIFICATION_CODEX_CHANGED");
  requireProof(hash(fs.readFileSync(physical(manifest.candidate.archivePath,"file")))===manifest.candidate.sha256,"QUALIFICATION_ARCHIVE_CHANGED");
  physical(manifest.candidate.packageRoot,"directory");
  requireProof(helper.contract_version==="agent-process-helper-build.v1" && helper.platform==="win32" && helper.architecture==="x64" && hash(fs.readFileSync(physical(helper.helper_path,"file")))===helper.helper_sha256,"QUALIFICATION_HELPER_CHANGED");
  requireProof(hash(fs.readFileSync(path.join(manifest.candidate.packageRoot,"src/adapters/agents/process-tree/windows-job-helper.cs")))===helper.source_sha256,"QUALIFICATION_HELPER_SOURCE_CHANGED");
  for(const binary of ["initdb.exe","pg_ctl.exe","postgres.exe"]) physical(path.join(pgBin,binary),"file");
  const baselineFile=path.join(manifest.output_root,"baseline.local.json"), baseline=read(baselineFile);
  requireProof(hash(fs.readFileSync(baselineFile))===manifest.baseline_sha256,"QUALIFICATION_BASELINE_CHANGED");
  // Never refresh this baseline after opening the native client. Any mutation
  // of project state during review is a failure, even if trust itself is valid.
  requireProof(baseline.roots.length===manifest.roots.length,"QUALIFICATION_BASELINE_ROOTS_INVALID");
  const gitPointers=[];
  for(const entry of baseline.roots) {
    const root=manifest.roots.find(r=>r.role===entry.role);
    requireProof(root && identity(entry.root)===identity(root.root) && identity(entry.git_dir)===identity(root.identity.git_dir),"QUALIFICATION_BASELINE_BINDING_INVALID");
    compareInventory(inventory(entry.root,true),entry.files,entry.role);
    requireProof(!Object.hasOwn(entry.files,".codex/aidn-agent-attempt.json"),"QUALIFICATION_BASELINE_CONTAINS_ATTEMPT");
    compareInventory(inventory(entry.git_dir),entry.git_files,`${entry.role}:git`);
    const marker=physical(path.join(entry.root,".git"));
    if(fs.statSync(marker).isFile()) {
      const bytes=fs.readFileSync(marker), match=/^gitdir: ([^\r\n]+)\r?\n?$/.exec(bytes.toString("utf8"));
      requireProof(match && identity(path.resolve(entry.root,match[1]))===identity(entry.git_dir),"QUALIFICATION_GIT_POINTER_BINDING_INVALID");
      gitPointers.push({role:entry.role,path:marker,sha256:hash(bytes),git_dir:entry.git_dir});
      if(manifest.refresh?.git_markers) {
        const refreshed=manifest.refresh.git_markers.find(row=>row.role===entry.role);
        requireProof(refreshed?.marker?.kind==="file" && refreshed.marker.sha256===hash(bytes) && refreshed.marker.bytes===bytes.length,"QUALIFICATION_REFRESH_GIT_POINTER_CHANGED");
      }
    } else requireProof(identity(marker)===identity(entry.git_dir),"QUALIFICATION_GIT_DIRECTORY_BINDING_INVALID");
  }
  compareInventory(inventory(baseline.common_git_dir),baseline.common_git_files,"common-git");
  const identityRecord={preparation_id:manifest.preparation_id,manifest_sha256:hash(fs.readFileSync(manifestFile)),candidate_sha256:manifest.candidate.sha256,codex_sha256:manifest.codex.sha256,helper_sha256:helper.helper_sha256,review_sha256:hash(fs.readFileSync(reviewProof)),native_trust_sha256:review.native_trust.sha256,model,effort,platform:process.platform,architecture:process.arch};
  const result={ok:true,status:write?"running":"preview",written:write,...identityRecord,output_root:outputRoot,native_launch_requests:0,native_processes_started:0,checks:[],qualification:"NOT_RUN",native_process_cleanup:"NOT_STARTED",integration:"NOT_RUN",cleanup:"NOT_STARTED",
    effects:["Create one ephemeral PostgreSQL cluster with four distinct scenario databases","Acquire native proof using reviewed candidate controller and arguments","Verify allowed, forbidden, mixed and stale native apply_patch requests","Observe a native hook descendant before cancellation and timeout","Use the full AgentTaskExecutor port only after initial native proofs pass","Preserve logs, per-attempt markers and authorized file changes; remove only owned PostgreSQL cluster"]};
  if(!write) return result;
  fs.mkdirSync(outputRoot);
  writeEvidence(outputRoot,"owner.json",{qualification_id:manifest.preparation_id,created_at:new Date().toISOString(),pid:process.pid});
  writeEvidence(outputRoot,"inputs.json",identityRecord);
  // Preparation's inventory omits .git entries. Resolve each linked pointer
  // against its original manifest identity, then preserve these observed bytes.
  // This additional observation never replaces the original file baseline.
  writeEvidence(outputRoot,"git-pointers-before.json",gitPointers);
  let clusterRoot=null, primaryError=null;
  try {
    const modules=await loadCandidate(manifest.candidate);
    requireProof(modules.fingerprintAgentExecutionValue(modules.inventoryRuntime(manifest.candidate.packageRoot))===modules.fingerprintAgentExecutionValue(manifest.candidate.inventory),"QUALIFICATION_INSTALLED_CANDIDATE_CHANGED");
    const expected=structuredClone(baseline);
    for(const pointer of gitPointers) expected.roots.find(r=>r.role===pointer.role).git_pointer_sha256=pointer.sha256;
    await withEphemeralPostgres(async({connectionString,root,version})=>{
      clusterRoot=root;result.postgres={version,authority:"ephemeral",databases:[]};
      const admin=new pg.Client({connectionString});await admin.connect();
      try {
        for(const mode of ["acquire","cancel","timeout","port"]) {
          process.stderr.write(JSON.stringify({qualification_case:mode,state:"starting",at:new Date().toISOString()})+"\n");
          const dbName=`qualification_${mode}`;
          // Closed static names only; database passwords remain private and
          // never enter the worker environment or the result/evidence document.
          await admin.query(`CREATE DATABASE ${dbName}`);
          const url=new URL(connectionString);url.pathname="/"+dbName;
          result.postgres.databases.push(dbName);
          let duration=150000;
          if(mode==="timeout") duration=Math.min(150000,Math.max(5000,Math.round(result.checks.find(c=>c.mode==="cancel").hook_latency_ms+3000)));
          const prior=mode==="port" ? {...identityRecord,passed:result.checks.length===3 && result.checks.every(c=>c.status==="PASS")} : null;
          const check=await runNativeQualificationCase({name:mode,mode,manifest,helper,modules,connectionString:url.toString(),outputRoot,expected,model,effort,maxDurationMs:duration,qualification:prior,onLaunch:()=>result.native_launch_requests++,onStarted:()=>result.native_processes_started++});
          result.checks.push(check);writeEvidence(outputRoot,`case-${mode}.json`,check);
          process.stderr.write(JSON.stringify({qualification_case:mode,state:"passed",native_process_cleanup:check.native_process_cleanup,at:new Date().toISOString()})+"\n");
        }
        requireProof(modules.fingerprintAgentExecutionValue(modules.inventoryRuntime(manifest.candidate.packageRoot))===modules.fingerprintAgentExecutionValue(manifest.candidate.inventory) && hash(fs.readFileSync(manifest.candidate.archivePath))===manifest.candidate.sha256,"QUALIFICATION_FINAL_CANDIDATE_CHANGED");
        requireProof(hash(fs.readFileSync(manifest.codex.binary_path))===manifest.codex.sha256 && hash(fs.readFileSync(helper.helper_path))===helper.helper_sha256,"QUALIFICATION_FINAL_EXECUTABLE_CHANGED");
      } finally {await admin.end();}
    },{binDir:pgBin});
    requireProof(clusterRoot && !fs.existsSync(clusterRoot),"QUALIFICATION_POSTGRES_CLEANUP_UNCONFIRMED");
    result.cleanup="POSTGRES_REMOVED_EVIDENCE_PRESERVED";result.native_process_cleanup="CONFIRMED";result.status="passed";result.qualification="PASS";
    writeEvidence(outputRoot,"qualification.json",result);
  } catch(error) {
    primaryError=error;result.ok=false;result.status="failed";result.qualification=error.code==="QUALIFICATION_CLIENT_REFUSAL_UNAVAILABLE"?"UNAVAILABLE":"FAIL";result.reason=error.code ?? error.message;result.details=error.details;
    result.failed_case=error.nativeQualification ?? null;
    result.native_process_cleanup=error.nativeQualification?.native_process_cleanup ?? (!result.native_launch_requests?"NOT_STARTED":result.checks.length===result.native_launch_requests && result.checks.every(c=>c.native_process_cleanup==="CONFIRMED")?"CONFIRMED":"UNCONFIRMED");
    result.cleanup=clusterRoot && !fs.existsSync(clusterRoot)?"POSTGRES_REMOVED_EVIDENCE_PRESERVED":"POSTGRES_UNCONFIRMED_EVIDENCE_PRESERVED";
    writeEvidence(outputRoot,"qualification-failure.json",result);
  }
  if(primaryError) throw Object.assign(primaryError,{qualification:result});
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options={},input=process.argv.slice(2);
    for(let i=0;i<input.length;i++) {
      if(input[i]==="--write") {requireProof(!options.write,"QUALIFICATION_DUPLICATE_OPTION");options.write=true;continue;}
      if(input[i]==="--json") continue;
      const key={"--manifest":"manifest","--helper-manifest":"helperManifest","--pg-bin":"pgBin","--model":"model","--effort":"effort","--review-proof":"reviewProof","--output-root":"outputRoot"}[input[i]];
      requireProof(key && !options[key] && input[i+1] && !input[i+1].startsWith("--"),"QUALIFICATION_ARGUMENTS_INVALID");options[key]=input[++i];
    }
    console.log(json(await qualifyAgentNativeWorker(options)).trimEnd());
  } catch(error) {console.log(json(error.qualification ?? {ok:false,status:"failed",written:false,reason:error.code ?? error.message,details:error.details}).trimEnd());process.exitCode=1;}
}
