#!/usr/bin/env node
import fs from "node:fs";
import { assertAgentLocalPath } from "../../src/core/agents/agent-local-path-policy.mjs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { withEphemeralPostgres } from "../perf/agent-execution-postgres-test-lib.mjs";
import { assertAgentNativeRefreshReview, assertAgentNativeQualificationRefreshContinuity, readAgentNativeRefreshLineage } from "./refresh-agent-native-candidate.mjs";
import { nativeQualificationHomeIdentity } from "./prepare-agent-native-qualification.mjs";
import { fingerprintAgentExecutionValue } from "../../src/core/agents/agent-execution-contracts.mjs";
import { fingerprintCodexNativeProfilePolicy, codexNativeProfilePreservationEvidence } from "../../src/adapters/agents/codex-native-profile-policy.mjs";
import { hash, json, fail, requireProof, physical, inventory, compareInventory, writeEvidence, loadCandidate, runNativeQualificationCase, nativeQualificationBudgets } from "./agent-native-qualification-driver.mjs";
import { readCodexNativeProfileSharedEffects } from "./agent-native-profile-observation.mjs";

const SOURCE=path.resolve(import.meta.dirname,"../..");
const read=file=>JSON.parse(fs.readFileSync(physical(file,"file"),"utf8"));
const identity=value=>process.platform==="win32"?path.resolve(value).toLowerCase():path.resolve(value);
function outside(parent,child) {const rel=path.relative(parent,child);return rel===".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);}

export { assertAgentNativeQualificationRefreshContinuity };

// Case execution and profile-file observations do not prove that the host's
// existing native client still works. Confirmation must come from that client
// after this immutable terminal result, not from a local exit-code substitute.
export function nativeQualificationHostConfirmationState(checks) {
  const expected = ["acquire", "cancel", "timeout", "port"];
  requireProof(Array.isArray(checks) && checks.length === expected.length
    && checks.every((check,index) => check.mode === expected[index] && check.status === "PASS"
      && check.native_process_cleanup === "CONFIRMED"), "QUALIFICATION_NATIVE_CASES_INCOMPLETE");
  return { ok:false, status:"awaiting_host_confirmation", native_cases_status:"PASS",
    qualification:"UNAVAILABLE", host_confirmation:"REQUIRED", reason:"HOST_CONFIRMATION_REQUIRED" };
}

const exactKeys=(value,keys)=>value && typeof value==="object" && !Array.isArray(value)
  && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));

// Pure review check, shared by preview and write. The consent binds the local
// effect policy; it never establishes native readiness or observation by itself.
export function assertNativeQualificationProfileReview({manifest,review,policy}={}) {
  const selected=manifest?.native_profile;
  const mode=selected?.mode ?? "isolated";
  requireProof(["isolated","preexisting"].includes(mode),"QUALIFICATION_NATIVE_PROFILE_MODE_INVALID");
  if(mode==="isolated") {
    requireProof((selected===undefined || exactKeys(selected,["mode"])) && policy===undefined && review?.native_profile===undefined,"QUALIFICATION_NATIVE_PROFILE_SELECTION_MISMATCH");
    return null;
  }
  requireProof(exactKeys(selected,["mode","home_identity_sha256"]) && policy!==undefined,"QUALIFICATION_NATIVE_PROFILE_POLICY_REQUIRED");
  const policySha256=fingerprintCodexNativeProfilePolicy(policy);
  requireProof(policy.home.physical_path===manifest.codex_home && policy.home.identity_sha256===selected.home_identity_sha256
    && policy.client_sha256===manifest.codex?.sha256,"QUALIFICATION_NATIVE_PROFILE_BINDING_INVALID");
  const approved=review?.native_profile;
  requireProof(exactKeys(approved,["mode","policy_sha256","consent"]) && approved.mode==="preexisting"
    && approved.policy_sha256===policySha256,"QUALIFICATION_NATIVE_PROFILE_REVIEW_REQUIRED");
  const consent=approved.consent, managed=policy.contract_version==="codex-native-profile-policy.v2";
  requireProof(exactKeys(consent,["approved","shared_effects_sha256","state_root",...(managed?["sandbox_maintenance"]:[])]) && consent.approved===true
    && consent.shared_effects_sha256===policy.effects.shared_effects_sha256
    && consent.state_root===policy.effects.state_root && (!managed || consent.sandbox_maintenance==="codex-managed"
      && policy.effects.shared_effects_sha256===fingerprintAgentExecutionValue(readCodexNativeProfileSharedEffects(undefined,policy.contract_version))),"QUALIFICATION_NATIVE_PROFILE_EFFECT_CONSENT_REQUIRED");
  return {policy_sha256:policySha256,consent:structuredClone(consent)};
}

// Never observe an older successful request while the current metadata process
// has indeterminate termination. The worker's cleanup status is independent.
export async function finalizeNativeQualificationProfile({verify,preparation,signal}={}) {
  if(preparation?.process_cleanup==="UNCONFIRMED") return {ok:false,status:"UNCONFIRMED",
    reason:"QUALIFICATION_NATIVE_PROFILE_PREPARATION_TERMINATION_UNCONFIRMED",native_profile_preparation:preparation};
  requireProof(typeof verify?.finalize==="function","QUALIFICATION_NATIVE_PROFILE_OBSERVER_REQUIRED");
  return verify.finalize({signal});
}

// A later non-started scenario cannot erase the death proofs of earlier
// workers. Missing or contradictory observations remain unconfirmed.
export function summarizeNativeProcessCleanup({launchRequests,processesStarted,checks,failedCase}={}) {
  if(!Number.isSafeInteger(launchRequests) || !Number.isSafeInteger(processesStarted)
    || launchRequests<0 || processesStarted<0 || processesStarted>launchRequests || !Array.isArray(checks)) return "UNCONFIRMED";
  const states=[...checks.map(check=>check?.native_process_cleanup),...(failedCase?[failedCase.native_process_cleanup]:[])];
  if(states.some(state=>!["CONFIRMED","NOT_STARTED"].includes(state))) return "UNCONFIRMED";
  const confirmed=states.filter(state=>state==="CONFIRMED").length;
  if(!launchRequests) return confirmed?"UNCONFIRMED":"NOT_STARTED";
  if(states.length<launchRequests || confirmed<processesStarted) return "UNCONFIRMED";
  return confirmed?"CONFIRMED":"NOT_STARTED";
}

// This internal, local qualification is never an automatic gate or a public
// agent-run command. Preview performs filesystem reads only. --write explicitly
// permits four bounded native model calls and a disposable PostgreSQL cluster.
// Existing native project/hook trust and authentication must already exist.
export async function qualifyAgentNativeWorker({manifest:manifestFile,helperManifest,pgBin,model,effort,reviewProof,nativeProfilePolicy:policyFile,outputRoot,write=false}={}) {
  requireProof(typeof write==="boolean","QUALIFICATION_EXPLICIT_WRITE_BOOLEAN_REQUIRED");
  for(const value of [manifestFile,helperManifest,reviewProof,pgBin,outputRoot,policyFile]) assertAgentLocalPath(value);
  manifestFile=physical(manifestFile,"file"); helperManifest=physical(helperManifest,"file"); reviewProof=physical(reviewProof,"file"); pgBin=physical(pgBin,"directory"); outputRoot=physical(outputRoot);
  const manifest=read(manifestFile), helper=read(helperManifest), review=read(reviewProof);
  const nativeProfilePolicy=policyFile===undefined?undefined:read(policyFile);
  const profileReview=assertNativeQualificationProfileReview({manifest,review,policy:nativeProfilePolicy});
  if(profileReview) {
    requireProof(fingerprintAgentExecutionValue(nativeQualificationHomeIdentity(manifest.codex_home))===manifest.native_profile.home_identity_sha256,"QUALIFICATION_NATIVE_PROFILE_HOME_CHANGED");
    requireProof(fingerprintAgentExecutionValue(readCodexNativeProfileSharedEffects(manifest.codex_home,nativeProfilePolicy.contract_version))===nativeProfilePolicy.effects.shared_effects_sha256,"QUALIFICATION_NATIVE_PROFILE_EFFECTS_CHANGED");
    physical(nativeProfilePolicy.effects.state_root);
    for(const protectedRoot of [SOURCE,manifest.codex_home,manifest.candidate.packageRoot,...manifest.roots.map(root=>root.root)]) {
      requireProof(outside(protectedRoot,nativeProfilePolicy.effects.state_root) && outside(nativeProfilePolicy.effects.state_root,protectedRoot),"QUALIFICATION_NATIVE_PROFILE_EFFECT_ROOT_OVERLAP");
    }
    requireProof(outside(nativeProfilePolicy.effects.state_root,outputRoot) && outside(outputRoot,nativeProfilePolicy.effects.state_root),"QUALIFICATION_NATIVE_PROFILE_EVIDENCE_ROOT_OVERLAP");
  }
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
  if(manifest.refresh) readAgentNativeRefreshLineage(manifestFile,review.native_trust.path,outputRoot);
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
  const identityRecord={preparation_id:manifest.preparation_id,manifest_sha256:hash(fs.readFileSync(manifestFile)),candidate_sha256:manifest.candidate.sha256,codex_sha256:manifest.codex.sha256,helper_sha256:helper.helper_sha256,review_sha256:hash(fs.readFileSync(reviewProof)),native_trust_sha256:review.native_trust.sha256,model,effort,platform:process.platform,architecture:process.arch,
    ...(profileReview?{native_profile:{mode:"preexisting",policy_sha256:profileReview.policy_sha256,home_identity_sha256:manifest.native_profile.home_identity_sha256,consent_sha256:fingerprintAgentExecutionValue(profileReview.consent)}}:{})};
  const result={ok:true,status:write?"running":"preview",written:write,...identityRecord,output_root:outputRoot,native_launch_requests:0,native_processes_started:0,checks:[],qualification:"NOT_RUN",native_process_cleanup:"NOT_STARTED",integration:"NOT_RUN",cleanup:"NOT_STARTED",
    ...(profileReview?{native_profile_observation:{status:"NOT_RUN"},native_profile_preparation:{status:"NOT_RUN",...nativeQualificationBudgets({preexisting:true})}}:{}),
    effects:["Create one ephemeral PostgreSQL cluster with four distinct scenario databases","Acquire native proof using reviewed candidate controller and arguments","Verify allowed, forbidden, mixed and stale native apply_patch requests","Observe a native hook descendant before cancellation and timeout","Use the full AgentTaskExecutor port only after initial native proofs pass","Preserve logs, per-attempt markers and authorized file changes; remove only owned PostgreSQL cluster",
      ...(profileReview?["Prepare native metadata for each exact attempt within 60 seconds including fresh canonical admission; this budget precedes and does not extend the worker execution deadline","Allow native SQLite backfill to copy historical titles, first messages and previews into the reviewed local attempt-state directory; preserve failed state without automatic retry, SQLite disabling or metadata alteration","Observe the explicitly selected existing native profile before create, before resume and after workers; AIDN calls no setup, makes no trust change or credential copy","Allow only the native profile effects bound by the reviewed current shared-effects digest and state root"]:[])]};
  if(!write) return result;
  fs.mkdirSync(outputRoot);
  writeEvidence(outputRoot,"owner.json",{qualification_id:manifest.preparation_id,created_at:new Date().toISOString(),pid:process.pid});
  writeEvidence(outputRoot,"inputs.json",identityRecord);
  // Preparation's inventory omits .git entries. Resolve each linked pointer
  // against its original manifest identity, then preserve these observed bytes.
  // This additional observation never replaces the original file baseline.
  writeEvidence(outputRoot,"git-pointers-before.json",gitPointers);
  let clusterRoot=null, primaryError=null, verifyNativeProfile=null, profileFinalized=false;
  async function finalizeProfile() {
    if(!verifyNativeProfile || profileFinalized) return;
    profileFinalized=true;
    try {
      const observation=await finalizeNativeQualificationProfile({verify:verifyNativeProfile,preparation:result.native_profile_preparation,signal:AbortSignal.timeout(15000)});
      if(observation?.reason==="QUALIFICATION_NATIVE_PROFILE_PREPARATION_TERMINATION_UNCONFIRMED") {
        result.native_profile_observation=observation;
        writeEvidence(outputRoot,"native-profile-final-not-run.json",observation);
        return;
      }
      requireProof(observation?.ok===true && observation.preservation==="PASS"
        && Object.entries(codexNativeProfilePreservationEvidence(nativeProfilePolicy)).every(([key,value])=>observation[key]===value)
        && (nativeProfilePolicy.contract_version==="codex-native-profile-policy.v2" ? !Object.hasOwn(observation,"provisioning_performed")
          : !Object.hasOwn(observation,"sandbox_maintenance") && !Object.hasOwn(observation,"protected_resources_preserved")),"QUALIFICATION_NATIVE_PROFILE_FINAL_OBSERVATION_REQUIRED");
      result.native_profile_observation=observation;
      writeEvidence(outputRoot,"native-profile-final.json",observation);
    } catch(error) {
      result.native_profile_observation={ok:false,status:"UNCONFIRMED",reason:error.code ?? "QUALIFICATION_NATIVE_PROFILE_FINAL_OBSERVATION_FAILED"};
      writeEvidence(outputRoot,"native-profile-final-failure.json",result.native_profile_observation);
      throw error;
    }
  }
  try {
    const modules=await loadCandidate(manifest.candidate,{nativeProfile:Boolean(profileReview)});
    requireProof(modules.fingerprintAgentExecutionValue(modules.inventoryRuntime(manifest.candidate.packageRoot,{beforeObserve:assertAgentLocalPath}))===modules.fingerprintAgentExecutionValue(manifest.candidate.inventory),"QUALIFICATION_INSTALLED_CANDIDATE_CHANGED");
    if(profileReview) {
      requireProof(modules.fingerprintCodexNativeProfilePolicy(nativeProfilePolicy)===profileReview.policy_sha256,"QUALIFICATION_CANDIDATE_PROFILE_POLICY_MISMATCH");
      const {createCodexNativeProfileVerifier}=await import("./agent-native-profile-observation.mjs");
      verifyNativeProfile=createCodexNativeProfileVerifier({manifest,policy:nativeProfilePolicy,outputRoot,consent:profileReview.consent});
      requireProof(typeof verifyNativeProfile==="function" && typeof verifyNativeProfile.finalize==="function","QUALIFICATION_NATIVE_PROFILE_OBSERVER_REQUIRED");
      requireProof(typeof verifyNativeProfile.bootstrap==="function","QUALIFICATION_NATIVE_PROFILE_BOOTSTRAP_REQUIRED");
    }
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
          // Every worker has the same fixed ceiling. Timeout qualification arms
          // its shorter deadline only after observing this attempt's live hook.
          const duration=150000;
          const prior=mode==="port" ? {...identityRecord,passed:result.checks.length===3 && result.checks.every(c=>c.status==="PASS")} : null;
          const check=await runNativeQualificationCase({name:mode,mode,manifest,helper,modules,connectionString:url.toString(),outputRoot,expected,model,effort,nativeProfilePolicy,verifyNativeProfile,maxDurationMs:duration,qualification:prior,onLaunch:()=>result.native_launch_requests++,onStarted:()=>result.native_processes_started++});
          result.checks.push(check);writeEvidence(outputRoot,`case-${mode}.json`,check);
          if(profileReview) result.native_profile_preparation={...check.native_profile_preparation,completed_attempts:result.checks.length};
          process.stderr.write(JSON.stringify({qualification_case:mode,state:"passed",native_process_cleanup:check.native_process_cleanup,at:new Date().toISOString()})+"\n");
        }
        requireProof(modules.fingerprintAgentExecutionValue(modules.inventoryRuntime(manifest.candidate.packageRoot,{beforeObserve:assertAgentLocalPath}))===modules.fingerprintAgentExecutionValue(manifest.candidate.inventory) && hash(fs.readFileSync(manifest.candidate.archivePath))===manifest.candidate.sha256,"QUALIFICATION_FINAL_CANDIDATE_CHANGED");
        requireProof(hash(fs.readFileSync(manifest.codex.binary_path))===manifest.codex.sha256 && hash(fs.readFileSync(helper.helper_path))===helper.helper_sha256,"QUALIFICATION_FINAL_EXECUTABLE_CHANGED");
      } finally {await admin.end();}
    },{binDir:pgBin});
    requireProof(clusterRoot && !fs.existsSync(clusterRoot),"QUALIFICATION_POSTGRES_CLEANUP_UNCONFIRMED");
    await finalizeProfile();
    result.cleanup="POSTGRES_REMOVED_EVIDENCE_PRESERVED";result.native_process_cleanup="CONFIRMED";
    Object.assign(result,nativeQualificationHostConfirmationState(result.checks));
    writeEvidence(outputRoot,"qualification.json",result);
    writeEvidence(outputRoot,"host-confirmation-request.json",{
      contract_version:"agent-native-host-confirmation-request.v1",qualification_id:manifest.preparation_id,
      result:{path:path.join(outputRoot,"qualification.json"),sha256:hash(fs.readFileSync(path.join(outputRoot,"qualification.json")))},
      candidate_sha256:manifest.candidate.sha256,client_sha256:manifest.codex.sha256,
      host:manifest.host,issued_at:new Date().toISOString(),challenge:randomUUID(),
      required_evidence:"A read-only command through the existing principal native Codex client, with its ordinary sandbox and no escalation, setup or bypass, must emit this exact challenge and exit zero. Preserve the actual native tool event reference and hash, client/surface/build, sandbox mode and observation time. Independent review must bind it to this terminal result. A self-declared JSON or local child exit code is insufficient.",
      evidence_limit:"Confirm observed file preservation and continued principal sandbox operation; do not claim unchanged global Windows accounts, ACLs or firewall state.",
    });
  } catch(error) {
    if(profileReview && error.nativeQualification?.native_profile_preparation) result.native_profile_preparation={...error.nativeQualification.native_profile_preparation,completed_attempts:result.checks.length};
    try {await finalizeProfile();} catch(profileError) {error.profileObservationError=profileError.code ?? "QUALIFICATION_NATIVE_PROFILE_FINAL_OBSERVATION_FAILED";}
    primaryError=error;result.ok=false;result.status="failed";result.qualification=error.code==="QUALIFICATION_CLIENT_REFUSAL_UNAVAILABLE"?"UNAVAILABLE":"FAIL";result.reason=error.code ?? error.message;result.details=error.details;
    result.failed_case=error.nativeQualification ?? null;
    result.native_process_cleanup=summarizeNativeProcessCleanup({launchRequests:result.native_launch_requests,processesStarted:result.native_processes_started,checks:result.checks,failedCase:error.nativeQualification});
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
      const key={"--manifest":"manifest","--helper-manifest":"helperManifest","--pg-bin":"pgBin","--model":"model","--effort":"effort","--review-proof":"reviewProof","--native-profile-policy":"nativeProfilePolicy","--output-root":"outputRoot"}[input[i]];
      requireProof(key && !options[key] && input[i+1] && !input[i+1].startsWith("--"),"QUALIFICATION_ARGUMENTS_INVALID");options[key]=input[++i];
    }
    const result=await qualifyAgentNativeWorker(options);
    console.log(json(result).trimEnd());
    if(!result.ok) process.exitCode=1;
  } catch(error) {console.log(json(error.qualification ?? {ok:false,status:"failed",written:false,reason:error.code ?? error.message,details:error.details}).trimEnd());process.exitCode=1;}
}
