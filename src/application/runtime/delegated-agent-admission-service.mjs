import fs from "node:fs";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseNativePatch, resolveNativeAdmissionPath } from "./native-write-admission-service.mjs";
import { fingerprintAgentExecutionValue, isExactExecutionPath, validateAgentExecutionBindings } from "../../core/agents/agent-execution-contracts.mjs";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const same = (left,right) => fingerprintAgentExecutionValue(left) === fingerprintAgentExecutionValue(right);
const identity = value => process.platform === "win32" ? value.toLowerCase() : value;
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw new Error(code); };
const exactKeys = (value,keys) => value && !Array.isArray(value) && typeof value === "object"
  && Object.keys(value).sort().join(",") === keys.slice().sort().join(",");
function safeCode(error) {
  return /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code ?? error?.message ?? "") ? (error.code ?? error.message) : "DELEGATED_ADMISSION_UNAVAILABLE";
}
function protectedPath(value,planRef) {
  const lower=value.toLowerCase();
  return lower===planRef.toLowerCase() || /(^|\/)(?:\.git|\.aidn|\.codex|\.agents)(?:\/|$)/.test(lower)
    || /(^|\/)agents(?:\.override)?\.md$/.test(lower)
    || lower.startsWith("docs/audit/") && !/^docs\/audit\/notes\/[^/]+\.md$/.test(lower) && lower!=="docs/audit/parking-lot.md";
}

// This factory has no inferred installation, candidate, or activation authority.
// inspectWorktree is a supervisor dependency; workers cannot submit observations.
export function createDelegatedAgentAdmissionService({ store, binding, inspectWorktree } = {}) {
  if (typeof store?.admitDelegatedRequest !== "function" || typeof inspectWorktree !== "function"
    || !exactKeys(binding,["attemptId","ownership","requestSha256","delegationSha256"])
    || !ID.test(binding.attemptId ?? "") || !HASH.test(binding.requestSha256 ?? "") || !HASH.test(binding.delegationSha256 ?? "")) {
    throw new TypeError("DELEGATED_ADMISSION_CONFIGURATION_REQUIRED");
  }
  fingerprintAgentExecutionValue(binding);
  const expected=structuredClone(binding);
  function decision(outcome,reasonCode,admissionHash=null,operations=[],observation=null) {
    return { protocol_version:1, ok:outcome==="allow", outcome, reason_code:reasonCode, attempt_id:expected.attemptId,
      request_sha256:expected.requestSha256, admission_sha256:admissionHash, operations, observation };
  }
  async function observed(context,signal) {
    assertAgentLocalPath(context.attempt?.worktree?.cwd);
    assertAgentLocalPath(context.request?.cwd);
    if (signal?.aborted) fail("DELEGATED_ADMISSION_CANCELLED");
    const actual=await inspectWorktree(structuredClone(context),{signal});
    if (signal?.aborted) fail("DELEGATED_ADMISSION_CANCELLED");
    const {attempt,request}=context;
    if (!actual || actual.active!==true || actual.receipt_valid!==true || actual.persistence_policy!=="verify-only") fail("DELEGATED_PREPARATION_REQUIRED");
    if (!same(actual.activation,attempt.activation) || !same(actual.engine,request.execution.engine)) fail("DELEGATED_ACTIVATION_OR_ENGINE_CHANGED");
    if (actual.worktree_id!==attempt.worktree.worktree_id || actual.branch!==attempt.worktree.branch || actual.head!==attempt.input_sha) fail("DELEGATED_GIT_IDENTITY_CHANGED");
    if (typeof actual.physical_root!=="string" || !path.isAbsolute(actual.physical_root)
      || identity(actual.physical_root)!==identity(attempt.worktree.cwd)) fail("DELEGATED_WORKTREE_CHANGED");
    const physical=fs.realpathSync.native(actual.physical_root);
    if (identity(physical)!==identity(actual.physical_root) || !fs.statSync(physical).isDirectory()) fail("DELEGATED_PHYSICAL_ROOT_CHANGED");
    return { physical_root:physical, worktree_id:actual.worktree_id, branch:actual.branch, head:actual.head,
      activation:actual.activation, engine:actual.engine, receipt_valid:true, persistence_policy:"verify-only",active:true };
  }
  async function evaluate(packet,{signal,preflight=false}={}) {
    let admissionHash=null, nativeRequest=null;
    try {
      if (signal?.aborted) fail("DELEGATED_ADMISSION_CANCELLED");
      if (!preflight) {
        if (!exactKeys(packet,["protocol_version","attempt_id","request_sha256","native_request"]) || packet.protocol_version!==1
          || packet.attempt_id!==expected.attemptId || packet.request_sha256!==expected.requestSha256) fail("DELEGATED_REQUEST_BINDING_INVALID");
        const native=packet.native_request;
        if (!exactKeys(native,["cwd","tool_name","tool_input"]) || !exactKeys(native.tool_input,["command"])) fail("DELEGATED_NATIVE_REQUEST_INVALID");
        admissionHash=fingerprintAgentExecutionValue(native);
        nativeRequest=structuredClone(native);
      }
      return await store.admitDelegatedRequest({...expected,evaluate:async (context,{signal:storeSignal}={})=>{
        try {
        const signals=[signal,storeSignal].filter(Boolean);
        const admissionSignal=signals.length?AbortSignal.any(signals):undefined;
        if (!validateAgentExecutionBindings(context).ok) fail("DELEGATED_STORED_BINDING_INVALID");
        if (context.attempt.attempt_id!==expected.attemptId || !same(context.attempt.ownership,expected.ownership)
          || fingerprintAgentExecutionValue(context.request)!==expected.requestSha256
          || fingerprintAgentExecutionValue(context.delegation)!==expected.delegationSha256) fail("DELEGATED_STORED_BINDING_INVALID");
        const first=await observed(context,admissionSignal), operations=[], snapshots=[];
        if (!preflight) {
          const native=nativeRequest;
          if (identity(native.cwd)!==identity(first.physical_root)) fail("DELEGATED_CWD_CHANGED");
          const cwd=resolveNativeAdmissionPath(first.physical_root,first.physical_root,native.cwd,{directory:true}).absolute;
          const parsed=parseNativePatch(native), seen=new Set();
          for (const item of parsed) {
            for (const [input,operation] of [[item.path,item.operation],...(item.destination?[[item.destination,"move-destination"]]:[])]) {
              const resolved=resolveNativeAdmissionPath(first.physical_root,cwd,input);
              if (!isExactExecutionPath(resolved.path) || protectedPath(resolved.path,context.plan.canonical.plan_ref)) fail("DELEGATED_CONTROL_PATH_REFUSED");
              if (seen.has(identity(resolved.path))) fail("DELEGATED_DUPLICATE_PATCH_PATH");
              seen.add(identity(resolved.path));
              // Every operation participates, including notes and parking-lot.
              if (!context.delegation.scope.some(entry=>identity(entry.path)===identity(resolved.path) && entry.operations.includes(operation))) fail("DELEGATED_SCOPE_REFUSED");
              const stat=fs.statSync(resolved.absolute,{throwIfNoEntry:false});
              if (["update","delete","move"].includes(operation) && !stat) fail("PATCH_SOURCE_MISSING");
              if (["add","move-destination"].includes(operation) && stat) fail("PATCH_DESTINATION_EXISTS");
              if (stat && stat.size>64*1024*1024) fail("PATH_OBSERVATION_TOO_LARGE");
              operations.push({path:resolved.path,operation});
              snapshots.push([resolved.path,stat?hash(fs.readFileSync(resolved.absolute)):null]);
            }
          }
        }
        const last=await observed(context,admissionSignal);
        if (!same(first,last)) fail("DELEGATED_OBSERVATION_CHANGED");
        if (admissionSignal?.aborted) fail("DELEGATED_ADMISSION_CANCELLED");
        return decision("allow",preflight?"DELEGATED_PREFLIGHT_VERIFIED":"DELEGATED_PATCH_ADMITTED",admissionHash,operations,
          {plan_sha256:context.plan.plan_sha256,delegation_sha256:expected.delegationSha256,paths_sha256:hash(JSON.stringify(snapshots))});
        } catch (error) { return decision("deny",safeCode(error),admissionHash); }
      }});
    } catch (error) { return decision("deny",safeCode(error),admissionHash); }
  }
  return Object.freeze({ admit:(packet,options)=>evaluate(packet,options), preflight:options=>evaluate(null,{...options,preflight:true}) });
}
