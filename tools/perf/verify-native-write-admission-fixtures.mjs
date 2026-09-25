#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-write-admission-"));
const repo = path.resolve(import.meta.dirname, "../..");
const assertions = [];
const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, text); };
const request = (command) => ({cwd:root, tool_name:"apply_patch", tool_input:{command}});
const add = (name) => `*** Begin Patch\n*** Add File: ${name}\n+marker\n*** End Patch`;
const admit = (patch) => preWriteAdmit({targetRoot:root, nativeRequest:request(patch)});
const state = (mode) => write("docs/audit/CURRENT-STATE.md", `updated_at: 2026-09-24T00:00:00Z\nmode: ${mode}\nbranch_kind: cycle\nactive_session: S101\nactive_cycle: C101\ncycle_branch: feature/C101-alpha\nsession_branch: S101-alpha\ndor_state: READY\nfirst_plan_step: implement alpha\n`);
try {
  write("README.md", "# Disposable admission fixture\n");
  initGitRepo(root, {sourceBranch:"main", workingBranch:"feature/C101-alpha"});
  prepareActivationFixture(root, repo);
  write("docs/audit/snapshots/context-snapshot.md", "# Snapshot\n");
  state("THINKING");
  assert.equal((await preWriteAdmit({targetRoot:root})).ok, true);
  assert.equal((await admit(add("src/example.mjs"))).ok, false, "generic admission must not authorize a product patch in THINKING");
  assert.equal((await admit(add("docs/audit/notes/investigation.md"))).ok, true, "planning remains available without implementation prerequisites");
  assertions.push("generic-admission-is-not-patch-authorization; thinking-note-allowed");
  state("COMMITTING");
  write("docs/audit/sessions/S101-alpha.md", "# Session S101\n");
  write("docs/audit/cycles/C101-feature-alpha/status.md", "state: IMPLEMENTING\nbranch_name: feature/C101-alpha\ndor_state: READY\nsession_owner: S101\nscope_frozen: true\n");
  write("docs/audit/cycles/C101-feature-alpha/plan.md", '# Plan\n## Tasks\n1. implement alpha\n\n## Native write scope\n```json\n'+JSON.stringify({version:1,tasks:[{task:"implement alpha",intent:"implementation",paths:[{path:"src/example.mjs",operations:["add","update","delete"]}]}]})+'\n```\n');
  const allowed = await admit(add("src/example.mjs"));
  assert.equal(allowed.ok, true, JSON.stringify(allowed.write_decision));
  assert.equal((await admit(add("src/other.mjs"))).ok, false);
  assert.equal((await admit(add("docs/SPEC.md"))).ok, false, "normative docs are not planning notes");
  assert.equal((await admit(add("AGENTS.md"))).ok, false, "installed authorities require maintenance");
  assert.equal((await admit(add("src/example.mjs").replace("*** End Patch", "*** Add File: src/other.mjs\n+other\n*** End Patch"))).ok, false);
  assert.equal((await admit("garbage")).ok, false);
  assert.equal((await admit(add("../escape.txt"))).ok, false);
  assert.equal((await admit(add(".git/config"))).ok, false);
  assertions.push("scope-normative-authority-mixed-invalid-escape");
  const currentFile = path.join(root, "docs/audit/CURRENT-STATE.md");
  const statusFile = path.join(root, "docs/audit/cycles/C101-feature-alpha/status.md");
  const planFile = path.join(root, "docs/audit/cycles/C101-feature-alpha/plan.md");
  const current = fs.readFileSync(currentFile, "utf8"), status = fs.readFileSync(statusFile, "utf8"), plan = fs.readFileSync(planFile, "utf8");
  const denied = async (patch, code) => {
    const result = await admit(patch);
    assert.equal(result.ok, false);
    if (code) assert(result.write_decision.reasons.some((reason) => reason.code === code), JSON.stringify(result.write_decision.reasons));
    return result;
  };
  for (const [from, to, code] of [["IMPLEMENTING", "OPEN", "PHASE_EXCLUDES_IMPLEMENTATION"], ["READY", "NOT_READY", "DOR_REQUIRED"], ["S101", "S999", "CYCLE_SESSION_MISMATCH"]]) {
    fs.writeFileSync(statusFile, status.replace(from, to));
    await denied(add("src/example.mjs"), code);
  }
  fs.writeFileSync(statusFile, status);
  fs.writeFileSync(currentFile, current.replace("active_session: S101", "active_session: none"));
  await denied(add("src/example.mjs"), "ACTIVE_SESSION_REQUIRED");
  fs.writeFileSync(currentFile, current.replace("first_plan_step: implement alpha", "first_plan_step: unauthorized task"));
  await denied(add("src/example.mjs"), "CANONICAL_TASK_REQUIRED");
  fs.writeFileSync(currentFile, current);
  const updatePlan = "*** Begin Patch\n*** Update File: docs/audit/cycles/C101-feature-alpha/plan.md\n@@\n-# Plan\n+# Altered\n*** End Patch";
  await denied(updatePlan, "FROZEN_PLAN_REQUIRES_SCOPE_TRANSITION");
  fs.writeFileSync(statusFile, status.replace("IMPLEMENTING", "OPEN").replace("scope_frozen: true", "scope_frozen: false"));
  state("THINKING");
  assert.equal((await admit(updatePlan)).ok, true, "planning can repair its plan before scope freeze");
  fs.writeFileSync(currentFile, current); fs.writeFileSync(statusFile, status);
  fs.writeFileSync(currentFile, current.replace("READY", "NOT_READY"));
  fs.writeFileSync(statusFile, status.replace("READY", "NOT_READY") + "dor_override_reason: bounded corrective investigation\n");
  assert.equal((await admit(add("src/example.mjs"))).ok, true, "canonical rationale is the SPEC DoR exemption");
  fs.writeFileSync(statusFile, status.replace("READY", "NOT_READY") + "dor_override_reason: unknown\n");
  await denied(add("src/example.mjs"), "DOR_REQUIRED");
  fs.writeFileSync(currentFile, current.replace("COMMITTING", "EXPLORING").replace("READY", "NOT_READY"));
  fs.writeFileSync(statusFile, status.replace("READY", "NOT_READY"));
  await denied(add("src/example.mjs"), "MODE_EXCLUDES_IMPLEMENTATION");
  fs.writeFileSync(planFile, plan.replace('"implementation"', '"exploration"'));
  assert.equal((await admit(add("src/example.mjs"))).ok, true, "exploration exemption requires canonical per-task intent and paths");
  fs.writeFileSync(planFile, plan); fs.writeFileSync(currentFile, current); fs.writeFileSync(statusFile, status);
  assertions.push("phase-session-dor-task-freeze-proven-exemptions");
  write("src/example.mjs", "original\n");
  const update = "*** Begin Patch\n*** Update File: src/example.mjs\n@@\n-original\n+changed\n*** End Patch";
  const first = await admit(update);
  assert.equal(first.ok, true);
  write("src/example.mjs", "new content\n");
  const second = await admit(update);
  assert.notEqual(first.write_decision.observation.paths_sha256, second.write_decision.observation.paths_sha256, "content observation is fresh, semantic patch application remains the tool's job");
  assert.equal((await admit("*** Begin Patch\n*** Delete File: src/example.mjs\n*** End Patch")).ok, true);
  await denied(update.replace("@@", "*** Move to: src/other.mjs\n@@"), "PATH_OR_OPERATION_OUTSIDE_TASK");
  fs.writeFileSync(planFile, plan.replace('["add","update","delete"]', '["add","update","delete","move"]')
    .replace('"paths":[', '"paths":[{"path":"src/other.mjs","operations":["move-destination"]},'));
  assert.equal((await admit(update.replace("@@", "*** Move to: src/other.mjs\n@@"))).ok, true);
  fs.writeFileSync(planFile, plan);
  execFileSync("git", ["-C",root,"switch","-c","feature/other"], {stdio:"pipe"});
  await denied(update, "CYCLE_BRANCH_MISMATCH");
  execFileSync("git", ["-C",root,"switch","feature/C101-alpha"], {stdio:"pipe"});
  assert.equal((await admit(update)).ok, true);
  for (const bad of ["*** Begin Patch\n*** Update File: src/example.mjs\n*** End Patch", add("src/a.txt:stream"), add("src/NUL.txt"), add("src/file. "), add("src/example.mjs"), update.replace("@@", "unclassified"), add("docs/audit/notes/a.md").replace("*** End Patch", "*** Add File: docs/audit/notes/a.md\n+x\n*** End Patch")]) await denied(bad);
  write("nested/.git/HEAD", "ref: refs/heads/main\n");
  await denied(add("nested/inside.txt"), "NESTED_REPOSITORY");
  fs.linkSync(path.join(root,"src/example.mjs"), path.join(root,"linked.mjs"));
  await denied(update, "LINK_PATH_UNSUPPORTED");
  fs.unlinkSync(path.join(root,"linked.mjs"));
  fs.symlinkSync(path.join(root,"src"),path.join(root,"alias"),process.platform === "win32" ? "junction" : "dir");
  await denied(add("alias/redirected.mjs"), "LINK_PATH_UNSUPPORTED");
  fs.unlinkSync(path.join(root,"alias"));
  assert.equal((await preWriteAdmit({targetRoot:root,nativeRequest:{...request(add("src/outside-task.mjs")),intent:"repair",ok:true}})).ok,false,"model repair/PASS declarations grant no exemption");
  assertions.push("fresh-content-branch-repeated-move-delete-malformed-nested-hardlink");
  // A deterministic tree oracle, separate from admission's own result.
  const snapshot = () => {
    const files = [];
    const walk = (dir) => { for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
      if (item.name === ".git") continue;
      const file = path.join(dir,item.name);
      if (item.isDirectory()) walk(file);
      else files.push([path.relative(root,file),createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
    }}; walk(root); return JSON.stringify(files.sort());
  };
  const before = snapshot();
  for (let n = 0; n < 3; n++) await admit(update);
  assert.equal(snapshot(), before, "admission must not mutate files, receipts or runtime");
  assertions.push("read-only-independent-tree-oracle");
  const schema = JSON.parse(fs.readFileSync(path.join(repo,"src/core/contracts/cli-output/runtime-pre-write-admit.v1.schema.json"),"utf8"));
  const cli = (input, env = {}) => {
    const child = spawnSync(process.execPath,[path.join(repo,"bin/aidn.mjs"),"runtime","pre-write-admit","--target",root,"--native-request-stdin","--json"],
      {input:JSON.stringify(input),encoding:"utf8",windowsHide:true,timeout:15000,env:{...process.env,...env}});
    assert.equal(child.status,0,child.stderr);
    const output = JSON.parse(child.stdout.trim());
    assert.deepEqual(validateJsonSchema(output,schema),[]);
    return output;
  };
  const cliAllowed = cli(request(update));
  assert.equal(cliAllowed.ok,true);
  const invalidContract = structuredClone(cliAllowed); delete invalidContract.write_decision.observation.payload_sha256;
  assert(validateJsonSchema(invalidContract,schema).length > 0);
  assert.equal(cli(null).ok,false);
  assert.equal(snapshot(),before,"stdin CLI remains read-only");
  assertions.push("real-cli-specific-contract-invalid-input-and-negative-schema");
  for (const mode of ["dual","db-only"]) {
    write("docs/audit/RUNTIME-STATE.md",`runtime_state_mode: ${mode}\nrepair_layer_status: ok\ncurrent_state_freshness: fresh\n`);
    const env = {...process.env,AIDN_STATE_MODE:mode,AIDN_INDEX_STORE_MODE:"sqlite"};
    const synced = spawnSync(process.execPath,[path.join(repo,"tools/perf/index-sync.mjs"),"--target",root,"--store","sqlite","--with-content","--json"],{env,encoding:"utf8",timeout:30000,windowsHide:true});
    assert.equal(synced.status,0,synced.stderr);
    const canonical = cli(request(update),env);
    assert.equal(canonical.ok,true,JSON.stringify(canonical.blocking_reasons));
    assert.equal(canonical.context.plan_artifact_source,"sqlite");
    fs.writeFileSync(planFile,plan.replace('"src/example.mjs"','"src/unrelated.mjs"'));
    assert.equal(cli(request(update),env).ok,true,"visible stale plan cannot change DB scope authority");
    fs.writeFileSync(planFile,plan);
  }
  assertions.push("dual-db-only-canonical-plan-over-visible-projection");
  console.log(JSON.stringify({ok:true, proof_class:"fixture", assertions}, null, 2));
} finally { removePathWithRetry(root); }
