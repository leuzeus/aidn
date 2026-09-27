// Disposable fixture processes are not a qualified native execution boundary.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createLocalAgentGitIntegration } from "../../src/adapters/runtime/local-agent-git-integration.mjs";
import { createLocalAgentVerification } from "../../src/adapters/runtime/local-agent-verification.mjs";
import { fingerprintAgentExecutionValue as fingerprint, normalizeAgentExecutionPlan } from "../../src/core/agents/agent-execution-contracts.mjs";

export const digest = content => createHash("sha256").update(content).digest("hex");
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
export const signed = (payload, key) => ({ payload, signature: sign(null, Buffer.from(canonical(payload)), key).toString("base64") });
const chain = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agent-execution/contracts/complete-chain.json", import.meta.url)));
const executableHash = digest(fs.readFileSync(process.execPath));
const DEFAULT_SCRIPT = `import fs from 'node:fs';const status=fs.readFileSync('subject.txt','utf8')==='new'?'passed':'failed';console.log(JSON.stringify({contract_version:'agent-verification-check.v1',validation_id:'contents',status}));`;

export async function createVerificationFixture({ script = DEFAULT_SCRIPT, candidateScript = null, auditCheck = "exact-snapshot", auditChecks = null, maxDuration = 30000, outputLimit = 32768,
  runId = "run.verification", attemptId = "attempt.verification" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-verification-")), token = randomUUID();
  fs.writeFileSync(path.join(root, "owner"), token, { flag: "wx" });
  const repositoryRoot = path.join(root, "repository"), resourcesRoot = path.join(root, "resources"), tempRoot = path.join(resourcesRoot, "scratch");
  fs.mkdirSync(repositoryRoot);
  const children = new Map(), completed = new Map(); let calls = 0, inspections = 0;
  function cleanup() {
    if (children.size) throw new Error("FIXTURE_CHILDREN_REMAIN");
    const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("aidn-verification-") || fs.readFileSync(path.join(root, "owner"), "utf8") !== token) throw new Error("FIXTURE_CLEANUP_REFUSED");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  try {
  function gitCommand(args, { input, env = {} } = {}) {
    const result = spawnSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", windowsHide: true, timeout: 10000, input,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_AUTHOR_NAME: "AIDN fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "AIDN fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", ...env } });
    if (result.status !== 0) throw new Error(`FIXTURE_GIT_FAILED:${String(result.stderr).slice(0, 300)}`); return result.stdout.trim();
  }
  gitCommand(["init", "--initial-branch=dev"]);
  fs.writeFileSync(path.join(repositoryRoot, "subject.txt"), "old"); fs.writeFileSync(path.join(repositoryRoot, "check.mjs"), script);
  gitCommand(["add", "subject.txt", "check.mjs"]); gitCommand(["commit", "-m", "verification fixture base"]);
  const baseSha = gitCommand(["rev-parse", "HEAD"]), index = path.join(root, "candidate.index"), env = { GIT_INDEX_FILE: index };
  const blob = gitCommand(["hash-object", "-w", "--stdin"], { input: "new" });
  gitCommand(["read-tree", baseSha], { env }); gitCommand(["update-index", "--add", "--cacheinfo", `100644,${blob},subject.txt`], { env });
  if (candidateScript !== null) {
    const changed = gitCommand(["hash-object", "-w", "--stdin"], { input: candidateScript });
    gitCommand(["update-index", "--add", "--cacheinfo", `100644,${changed},check.mjs`], { env });
  }
  const tree = gitCommand(["write-tree"], { env }), candidateSha = gitCommand(["commit-tree", tree, "-p", baseSha], { input: "fixture candidate\n" });
  const git = createLocalAgentGitIntegration({ repositoryRoot, resourcesRoot, integrationRef: "refs/heads/codex/verification-fixture",
    verifyTermination: async () => ({ confirmed: false }) });
  await git.initializeIntegration({ baseSha });
  fs.mkdirSync(tempRoot);
  const inspect = git.inspectVerificationSnapshot;
  const observedGit = { ...git, inspectVerificationSnapshot: async input => { inspections++; return inspect(input); } };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pin = digest(publicKey.export({ format: "der", type: "spki" }));
  const environment = Object.fromEntries(Object.entries({ SystemRoot: process.env.SystemRoot, TEMP: tempRoot, TMP: tempRoot }).filter(([, value]) => value));
  const selectedAuditChecks = auditChecks ?? [auditCheck];
  const criteria = selectedAuditChecks.map((id, index) => index === 0 ? "Snapshot conforms to the exact candidate" : `Canonical fixture criterion ${index}: ${id}`);
  const auditPolicy = { contract_version: "agent-verification-audit-policy.v1", criteria: selectedAuditChecks.map((id, index) => (
    { criterion_index: index, criterion_sha256: digest(Buffer.from(criteria[index])), check_id: id, parameters: {} })) };
  const rawPlan = structuredClone(chain.plan); delete rawPlan.plan_sha256;
  rawPlan.base.sha = baseSha; rawPlan.canonical.scope = [{ path: "subject.txt", operations: ["update"] }];
  rawPlan.tasks = [{ task_id: "task.fixture", objective: "Change fixture subject", scope: rawPlan.canonical.scope,
    depends_on: [], acceptance_criteria: ["Subject is new"], max_duration_ms: 60000 }];
  rawPlan.validations = [{ validation_id: "contents", argv: ["node", "check.mjs"] }]; rawPlan.audit = { read_only: true, criteria };
  rawPlan.verification = { runner: { id: "node", executable_sha256: executableHash }, environment_sha256: fingerprint(environment),
    control_files: [{ path: "check.mjs", sha256: digest(Buffer.from(script)), git_mode: "100644" }],
    audit_policy_sha256: fingerprint(auditPolicy), proof_authority_sha256: pin,
    limits: { max_duration_ms: maxDuration, max_output_bytes: outputLimit } };
  const plan = normalizeAgentExecutionPlan(rawPlan);
  const run = { ...structuredClone(chain.run), run_id: runId, plan_sha256: plan.plan_sha256 }, task = plan.tasks[0];
  const attempt = { ...structuredClone(chain.attempt), run_id: runId, task_id: task.task_id, attempt_id: attemptId, input_sha: baseSha };
  const result = { ...structuredClone(chain.result), run_id: runId, task_id: task.task_id, attempt_id: attemptId };
  const qualificationContent = Buffer.from("Fixture Node processes only; OS confinement is not qualified.\n");
  fs.writeFileSync(path.join(resourcesRoot, "fixture-qualification.txt"), qualificationContent, { flag: "wx" });
  const qualification = signed({ contract_version: "agent-verification-boundary.v1", boundary_id: "fixture-node", platform: process.platform,
    evidence_class: "fixture", policy_sha256: fingerprint(plan.verification), executable_sha256: executableHash,
    engine_sha256: plan.execution.engine.sha256,
    environment_sha256: plan.verification.environment_sha256, snapshot_read_only: true, supervisor_resources_inaccessible: true,
    descendant_termination: true, network_disabled: true, evidence: [{ ref: "fixture-qualification.txt", sha256: digest(qualificationContent), bytes: qualificationContent.length }] }, privateKey);
  const boundary = {
    getDescriptor: () => ({ boundary_id: "fixture-node", qualification }),
    async run(request, { signal }) {
      calls++;
      const child = spawn(request.executable, request.argv, { cwd: request.cwd, env: request.environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [], stderr = []; let size = 0, retained = 0;
      const finished = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, receivedSignal) => { children.delete(request.invocation_id); const result = { invocation_id: request.invocation_id,
          request_sha256: request.request_sha256, boundary_id: "fixture-node", termination_state: "confirmed", exit_code: code,
          signal: receivedSignal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }; completed.set(request.invocation_id, result); resolve(result); });
      });
      children.set(request.invocation_id, { child, finished });
      const collect = target => chunk => { size += chunk.length; const take = Math.min(chunk.length, request.max_output_bytes + 1 - retained);
        if (take > 0) { target.push(chunk.subarray(0, take)); retained += take; } if (size > request.max_output_bytes) child.kill(); };
      child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
      const abort = () => child.kill(); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      try { return await finished; } finally { signal.removeEventListener("abort", abort); }
    },
    async requestStop({ invocationId }) { const active = children.get(invocationId); if (!active) return completed.get(invocationId) ?? { termination_state: "unknown" }; active.child.kill(); return active.finished; },
  };
  const canonicalRun = { run, server_now: new Date().toISOString(), integration_head: { sha: candidateSha, sequence: 1 },
    acceptances: [{ acceptance: { task_id: task.task_id, decision: "accepted" } }],
    integrations: [{ prepared: { task_id: task.task_id }, applied: {} }], integration_intents: [], attempts: [{ attempt, result: { outcome: "completed", termination_state: "confirmed" } }] };
  const configuration = { resourcesRoot, scratchRoot: tempRoot, runId, git: observedGit, runner: { id: "node", executable: process.execPath }, environment, auditPolicy,
    publicKey, privateKey, boundary, evidenceClass: "fixture", readRun: async () => ({ ...structuredClone(canonicalRun), server_now: new Date().toISOString() }) };
  const taskInput = { plan, runId, task, validationIds: ["contents"], candidateSha, resultSha256: fingerprint(result),
    binding: { attempt_id: attemptId, input_sha: baseSha, cwd: repositoryRoot } };
  const runInput = { plan, runId, integratedSha: candidateSha, integrationSequence: 1 };
  function verificationInput(document, phase) {
    return { phase, plan, run, ...(phase === "task" ? { task, attempt, result } : {}), document, subject_sha256: fingerprint(document),
      expected: { tested_sha: candidateSha, validation_ids: ["contents"], ...(phase === "run" ? { audit_criteria: plan.audit.criteria } : {}) } };
  }
  return { root, repositoryRoot, resourcesRoot, plan, rawPlan, run, result, candidateSha, baseSha, publicKey, privateKey, pin, boundary, configuration,
    taskInput, runInput, canonicalRun, gitCommand, cleanup, verificationInput, create: (overrides = {}) => createLocalAgentVerification({ ...configuration, ...overrides }),
    get calls() { return calls; }, get inspections() { return inspections; } };
  } catch (cause) { cleanup(); throw cause; }
}
