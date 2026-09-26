import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readActivation, createActivationGitEnvironment } from "../install/project-activation-service.mjs";
import { inventoryRuntime, checkedHostPath } from "../install/global-runtime-store.mjs";
import { fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const fail = code => { throw new Error(code); };
const read = file => JSON.parse(fs.readFileSync(checkedHostPath(file), "utf8"));

// Candidate inventory is captured from the exact installed tarball, outside all
// writable worker roots. This factory performs no installation or authorization.
export function createAgentWorktreeInspector({ candidate } = {}) {
  if (!candidate || !path.isAbsolute(candidate.packageRoot ?? "") || !path.isAbsolute(candidate.archivePath ?? "")
      || !/^[a-f0-9]{64}$/.test(candidate.sha256 ?? "") || !candidate.inventory || typeof candidate.version !== "string") throw new TypeError("AGENT_CANDIDATE_REQUIRED");
  const expected = structuredClone(candidate);
  return async function inspectWorktree({ attempt, request }, { signal } = {}) {
    const live = () => { if (signal?.aborted) fail("DELEGATED_ADMISSION_CANCELLED"); };
    live();
    const state = readActivation({ targetRoot: attempt.worktree.cwd });
    if (state.state !== "active" || !state.active || !state.authorization || !state.receipt || !state.identity.git_dir) fail("DELEGATED_ACTIVATION_REQUIRED");
    live();
    const root = state.identity.target_root, receipt = state.receipt;
    if (!samePath(root, attempt.worktree.cwd) || !samePath(receipt.package.root, expected.packageRoot)
        || receipt.package.version !== expected.version) fail("DELEGATED_CANDIDATE_BINDING_CHANGED");
    const relativeEngine = path.relative(root, expected.packageRoot), relativeArchive = path.relative(root, expected.archivePath);
    for (const relative of [relativeEngine, relativeArchive]) {
      if (!relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) fail("DELEGATED_CANDIDATE_INSIDE_WORKER");
    }
    if (hash(fs.readFileSync(checkedHostPath(expected.archivePath))) !== expected.sha256
        || fs.readFileSync(checkedHostPath(path.join(expected.packageRoot, "VERSION")), "utf8").trim() !== expected.version
        || fingerprintAgentExecutionValue(inventoryRuntime(expected.packageRoot)) !== fingerprintAgentExecutionValue(expected.inventory)) fail("DELEGATED_CANDIDATE_CHANGED");
    live();
    const transaction = read(path.join(root, `.aidn/install/transactions/${receipt.last_transaction}.json`));
    // readActivation has already verified this transaction's seal and completion.
    if (transaction.installation_context?.args?.persistencePolicy !== "verify-only") fail("DELEGATED_PERSISTENCE_POLICY_REQUIRED");
    const marker = read(path.join(root, ".codex/aidn-agent-attempt.json"));
    if (marker.protocol_version !== 1 || marker.attempt_id !== attempt.attempt_id
        || marker.request_sha256 !== fingerprintAgentExecutionValue(request)) fail("DELEGATED_MARKER_CHANGED");
    const git = spawnSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      env: createActivationGitEnvironment(), encoding: "utf8", windowsHide: true, timeout: 1500, maxBuffer: 65536,
    });
    live();
    const branch = spawnSync("git", ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], {
      env: createActivationGitEnvironment(), encoding: "utf8", windowsHide: true, timeout: 1500, maxBuffer: 65536,
    });
    if (git.error || git.status !== 0 || git.signal || branch.error || branch.status !== 0 || branch.signal) fail("DELEGATED_GIT_OBSERVATION_FAILED");
    live();
    return { physical_root: root, worktree_id: state.identity.root_id, branch: branch.stdout.trim(), head: git.stdout.trim(),
      active: true, activation: { authority_id: state.authorization.authority_id, revision: state.authorization.revision },
      engine: { version: expected.version, sha256: expected.sha256 }, receipt_valid: true, persistence_policy: "verify-only" };
  };
}
