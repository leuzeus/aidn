import { randomUUID } from "node:crypto";
import { assertCodexNativeProfileBootstrap } from "./codex-native-profile-observation-service.mjs";
const fail=(code,details)=>{throw Object.assign(new Error(code),{code,details});};
const requireProof=(condition,code,details)=>{if(!condition)fail(code,details);};
export const NATIVE_PROFILE_PREPARATION_MAX_MS=60000;

export async function verifyCodexNativeProfile({modules,policy,runtime,request,verify,phase,signal,timeoutMs=10000}={}) {
  if(policy===undefined) {
    requireProof(request?.execution?.native_profile===undefined,"QUALIFICATION_NATIVE_PROFILE_POLICY_REQUIRED");
    return;
  }
  requireProof(typeof verify==="function" && typeof modules?.assertCodexNativeProfileBinding==="function"
    && typeof modules?.assertCodexNativeProfileVerification==="function","QUALIFICATION_NATIVE_PROFILE_OBSERVER_REQUIRED");
  requireProof(["before_create","before_resume"].includes(phase),"QUALIFICATION_NATIVE_PROFILE_PHASE_INVALID");
  requireProof(Number.isSafeInteger(timeoutMs) && timeoutMs>0 && timeoutMs<=10000,"QUALIFICATION_NATIVE_PROFILE_BUDGET_INVALID");
  modules.assertCodexNativeProfileBinding(policy,request,runtime);
  const challenge=randomUUID(), stop=new AbortController(), deadline=performance.now()+timeoutMs;
  let timer, rejectAbort;
  const cancelled=new Promise((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{stop.abort();rejectAbort(Object.assign(new Error("QUALIFICATION_NATIVE_PROFILE_CANCELLED"),{code:"QUALIFICATION_NATIVE_PROFILE_CANCELLED"}));};
  if(signal?.aborted) abort();else signal?.addEventListener("abort",abort,{once:true});
  timer=setTimeout(()=>{stop.abort();rejectAbort(Object.assign(new Error("QUALIFICATION_NATIVE_PROFILE_TIMEOUT"),{code:"QUALIFICATION_NATIVE_PROFILE_TIMEOUT"}));},timeoutMs);
  try {
    const decision=await Promise.race([cancelled,Promise.resolve().then(()=>{
      requireProof(!stop.signal.aborted,"QUALIFICATION_NATIVE_PROFILE_CANCELLED");
      return verify(structuredClone(request),{signal:stop.signal,phase,challenge,policy:structuredClone(policy)});
    })]);
    requireProof(performance.now()<deadline,"QUALIFICATION_NATIVE_PROFILE_TIMEOUT");
    requireProof(!stop.signal.aborted && !signal?.aborted,"QUALIFICATION_NATIVE_PROFILE_CANCELLED");
    modules.assertCodexNativeProfileVerification(decision,{policy,request,phase,challenge});
  } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);stop.abort();}
}
// Native state initialization can backfill historical SQLite metadata. It is a
// separate, explicitly budgeted preparation, never a reusable admission decision.
// Fresh canonical preflight consumes the same deadline; no retry resets it.
export async function bootstrapCodexNativeProfile({modules,policy,runtime,request,verify,admitLaunch,signal,timeoutMs=NATIVE_PROFILE_PREPARATION_MAX_MS,rootCount=2}={}) {
  if(policy===undefined) {
    requireProof(request?.execution?.native_profile===undefined,"QUALIFICATION_NATIVE_PROFILE_POLICY_REQUIRED");
    return null;
  }
  requireProof(typeof verify?.bootstrap==="function" && typeof modules?.assertCodexNativeProfileBinding==="function","QUALIFICATION_NATIVE_PROFILE_BOOTSTRAP_REQUIRED");
  requireProof(typeof admitLaunch==="function","QUALIFICATION_NATIVE_PROFILE_PREFLIGHT_REQUIRED");
  requireProof(Number.isSafeInteger(timeoutMs) && timeoutMs>0 && timeoutMs<=NATIVE_PROFILE_PREPARATION_MAX_MS,"QUALIFICATION_NATIVE_PROFILE_PREPARATION_BUDGET_INVALID");
  modules.assertCodexNativeProfileBinding(policy,request,runtime);
  const stop=new AbortController(), deadline=performance.now()+timeoutMs;
  let timer,rejectAbort,bootstrapStarted=false,observation=null,proofAccepted=false;
  const cancelled=new Promise((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{stop.abort();rejectAbort(Object.assign(new Error("QUALIFICATION_NATIVE_PROFILE_PREPARATION_CANCELLED"),{code:"QUALIFICATION_NATIVE_PROFILE_PREPARATION_CANCELLED"}));};
  const checkDeadline=()=>{
    requireProof(performance.now()<deadline,"QUALIFICATION_NATIVE_PROFILE_PREPARATION_TIMEOUT");
    requireProof(!stop.signal.aborted && !signal?.aborted,"QUALIFICATION_NATIVE_PROFILE_PREPARATION_CANCELLED");
  };
  if(signal?.aborted) abort();else signal?.addEventListener("abort",abort,{once:true});
  timer=setTimeout(()=>{stop.abort();rejectAbort(Object.assign(new Error("QUALIFICATION_NATIVE_PROFILE_PREPARATION_TIMEOUT"),{code:"QUALIFICATION_NATIVE_PROFILE_PREPARATION_TIMEOUT"}));},timeoutMs);
  try {
    observation=await Promise.race([cancelled,Promise.resolve().then(()=>{
      checkDeadline();
      bootstrapStarted=true;
      return verify.bootstrap(structuredClone(request),{signal:stop.signal,timeoutMs});
    })]);
    checkDeadline();
    assertCodexNativeProfileBootstrap(observation,{policy,request,rootCount});
    proofAccepted=true;
    requireProof(observation.budget_ms<=timeoutMs,"QUALIFICATION_NATIVE_PROFILE_PREPARATION_BUDGET_INVALID");
    const admission=await Promise.race([cancelled,Promise.resolve().then(()=>admitLaunch({signal:stop.signal}))]);
    checkDeadline();
    requireProof(admission?.ok===true,"QUALIFICATION_POST_BOOTSTRAP_PREFLIGHT_REFUSED",{reason:admission?.reason_code});
    return {observation,admission};
  } catch(error) {
    // A race can settle before the observer acknowledges its stop request.
    // Worker NOT_STARTED says nothing about this distinct metadata process.
    const processProof=proofAccepted?observation.process:error.process ?? null;
    const cleanup=!bootstrapStarted?"NOT_STARTED":processProof?.closed===true && processProof?.pid_absent===true?"CONFIRMED":"UNCONFIRMED";
    error.nativeProfilePreparation={status:"FAILED",process_cleanup:cleanup,process:processProof,reason:error.code ?? "QUALIFICATION_NATIVE_PROFILE_PREPARATION_FAILED"};
    throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);stop.abort();}
}
