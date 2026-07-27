#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function parseArgs(argv) {
  const args = {};
  const valueOptions = new Set([
    "--event-name",
    "--base-ref",
    "--head-ref",
    "--expected-sha",
    "--contains-ref",
    "--sync-source-ref",
    "--version",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log(
        "Usage: node tools/verify/verify-branch-policy.mjs "
        + "[--event-name NAME] [--base-ref BRANCH] [--head-ref BRANCH] "
        + "[--expected-sha SHA] [--contains-ref REMOTE_REF] "
        + "[--sync-source-ref REMOTE_REF] [--version VERSION]",
      );
      process.exit(0);
    }
    if (!valueOptions.has(token)) {
      throw new Error(`Unknown argument: ${token}`);
    }
    const value = String(argv[index + 1] ?? "").trim();
    if (!value) {
      throw new Error(`Missing value for ${token}`);
    }
    args[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
}

function resolveRemoteRef(refName) {
  const normalized = String(refName ?? "").trim();
  const candidate = normalized.startsWith("refs/remotes/")
    ? normalized
    : (normalized.includes("/") ? `refs/remotes/${normalized}` : "");
  if (!candidate) {
    return null;
  }
  const remoteMatch = candidate.match(/^refs\/remotes\/([^/]+)\/(.+)$/);
  if (!remoteMatch) {
    return null;
  }
  const [, remote, branch] = remoteMatch;
  try {
    git(["remote", "get-url", remote]);
    return {
      ref: candidate,
      remote,
      branch,
      sha: git(["rev-parse", "--verify", `${candidate}^{commit}`]),
    };
  } catch {
    return null;
  }
}

function verifyRemoteSource({
  refName,
  actualSha,
  exact,
  label,
  provenance,
}) {
  const issues = [];
  provenance.branch_source_ref = refName;
  const source = resolveRemoteRef(refName);
  if (!source) {
    issues.push(`${label} must resolve through a configured remote: ${refName}`);
    return issues;
  }
  provenance.branch_source_ref = source.ref;
  provenance.branch_source_sha = source.sha;
  provenance.branch_source_exact = source.sha === actualSha;
  try {
    git(["merge-base", "--is-ancestor", source.sha, actualSha]);
    provenance.branch_source_ancestor = true;
  } catch {
    provenance.branch_source_ancestor = false;
  }
  if (exact && !provenance.branch_source_exact) {
    issues.push(`${label} HEAD ${actualSha} must equal ${source.ref} ${source.sha}`);
  } else if (!exact && !provenance.branch_source_ancestor) {
    issues.push(`${label} HEAD ${actualSha} must contain ${source.ref} ${source.sha}`);
  }
  return issues;
}

function readRepositoryVersion() {
  return fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
}

function parseStableVersion(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function verifyHotfixPatchVersion({
  sourceRef,
  version,
  provenance,
}) {
  const issues = [];
  let sourceVersion = "";
  try {
    sourceVersion = git(["show", `${sourceRef}:VERSION`]);
  } catch {
    issues.push(`hotfix source ${sourceRef} must expose a readable VERSION`);
    return issues;
  }
  provenance.hotfix_source_version = sourceVersion;
  const source = parseStableVersion(sourceVersion);
  const candidate = parseStableVersion(version);
  provenance.hotfix_patch_increment = Boolean(
    source
    && candidate
    && candidate.major === source.major
    && candidate.minor === source.minor
    && candidate.patch === source.patch + 1,
  );
  if (!provenance.hotfix_patch_increment) {
    issues.push(
      `hotfix VERSION ${version} must increment exactly one patch from `
      + `${sourceRef} VERSION ${sourceVersion}`,
    );
  }
  return issues;
}

export function evaluateBranchShape({
  eventName,
  base,
  head,
  ref = "",
  version = "",
}) {
  const issues = [];
  if (eventName === "pull_request") {
    if (base === "dev") {
      if (!head
        || ["main", "dev"].includes(head)
        || head.startsWith("release/")
        || head.startsWith("hotfix/")) {
        issues.push(
          "feature integration and main-to-dev synchronization PRs must target dev "
          + `from a non-release, non-hotfix branch; got ${head || "detached"}`,
        );
      }
      if (head?.startsWith("sync/")) {
        const expectedSync = version ? `sync/main-to-dev-v${version}` : "";
        if (!version) {
          issues.push("synchronization PR validation requires the repository VERSION");
        } else if (head !== expectedSync) {
          issues.push(
            "synchronization PRs must use the exact source version and target dev; "
            + `expected ${expectedSync}, got ${head}`,
          );
        }
      }
    } else if (base === "main") {
      const allowed = version
        ? new Set([`release/v${version}`, `hotfix/v${version}`])
        : new Set();
      if (!version) {
        issues.push("release or hotfix PR validation requires the repository VERSION");
      } else if (!allowed.has(head)) {
        issues.push(
          "only the version-matched release/vX.Y.Z or hotfix/vX.Y.Z PR may target main; "
          + `expected ${[...allowed].join(" or ")}, got ${head || "detached"}`,
        );
      }
    } else {
      issues.push(`unsupported PR base ${base || "missing"}; expected dev or main`);
    }
  } else if (eventName === "push" && ref === "refs/heads/main") {
    if (head !== "main") {
      issues.push(`main publication certification must prove origin/main; got ${head || "detached"}`);
    }
  } else if (!head) {
    issues.push("local branch policy requires a branch name or explicit detached-HEAD provenance");
  } else if (["main", "dev"].includes(head)) {
    issues.push(`local implementation must not run directly on protected branch ${head}`);
  }
  return issues;
}

export function verifyBranchPolicy({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const args = parseArgs(argv);
  const actualSha = git(["rev-parse", "HEAD"]);
  const localBranch = git(["branch", "--show-current"]);
  const explicitHead = firstNonEmpty(args.headRef, env.AIDN_BRANCH_POLICY_HEAD_REF);
  const explicitBase = firstNonEmpty(args.baseRef, env.AIDN_BRANCH_POLICY_BASE_REF);
  const expectedSha = firstNonEmpty(args.expectedSha, env.AIDN_BRANCH_POLICY_EXPECTED_SHA);
  const containsRef = firstNonEmpty(args.containsRef, env.AIDN_BRANCH_POLICY_CONTAINS_REF);
  const syncSourceRef = firstNonEmpty(
    args.syncSourceRef,
    env.AIDN_BRANCH_POLICY_SYNC_SOURCE_REF,
    "origin/main",
  );
  const version = firstNonEmpty(
    args.version,
    env.AIDN_BRANCH_POLICY_VERSION,
    readRepositoryVersion(),
  );
  const eventName = firstNonEmpty(
    args.eventName,
    env.AIDN_BRANCH_POLICY_EVENT_NAME,
    env.GITHUB_EVENT_NAME,
    "local",
  );
  const githubHead = firstNonEmpty(env.GITHUB_HEAD_REF);
  const githubBase = firstNonEmpty(env.GITHUB_BASE_REF);
  const githubRef = firstNonEmpty(env.GITHUB_REF);
  const detached = !localBranch;
  const provenanceIssues = [];
  const provenance = {
    detached,
    actual_sha: actualSha,
    expected_sha: expectedSha || null,
    explicit_head_ref: explicitHead || null,
    explicit_base_ref: explicitBase || null,
    contains_ref: containsRef || null,
    resolved_head_ref: null,
    resolved_head_sha: null,
    remote_ref_exact: false,
    containment_proved: false,
    sync_source_ref: null,
    sync_source_sha: null,
    sync_source_exact: false,
    branch_source_ref: null,
    branch_source_sha: null,
    branch_source_exact: false,
    branch_source_ancestor: false,
    hotfix_source_version: null,
    hotfix_patch_increment: false,
  };

  if (expectedSha && expectedSha !== actualSha) {
    provenanceIssues.push(`expected SHA ${expectedSha} does not match HEAD ${actualSha}`);
  }

  let head = githubHead || explicitHead || localBranch;
  let base = githubBase || explicitBase;
  if (detached) {
    if (!expectedSha) {
      provenanceIssues.push("detached HEAD certification requires --expected-sha or AIDN_BRANCH_POLICY_EXPECTED_SHA");
    }
    if (!containsRef) {
      provenanceIssues.push(
        "detached HEAD certification requires --contains-ref or "
        + "AIDN_BRANCH_POLICY_CONTAINS_REF naming a configured remote-tracking ref",
      );
    } else {
      const resolved = resolveRemoteRef(containsRef);
      if (!resolved || !resolved.ref.startsWith("refs/remotes/")) {
        provenanceIssues.push(
          `detached containment ref must resolve through a configured remote: ${containsRef}`,
        );
      } else {
        provenance.resolved_head_ref = resolved.ref;
        provenance.resolved_head_sha = resolved.sha;
        provenance.remote_ref_exact = resolved.sha === actualSha;
        if (!provenance.remote_ref_exact) {
          provenanceIssues.push(
            `remote ref ${resolved.ref} resolves to ${resolved.sha}, not exact HEAD ${actualSha}`,
          );
        }
        try {
          git(["merge-base", "--is-ancestor", actualSha, resolved.ref]);
          provenance.containment_proved = true;
          head = resolved.branch;
          if (explicitHead && explicitHead !== resolved.branch) {
            provenanceIssues.push(
              `explicit head ${explicitHead} does not match remote containment branch ${resolved.branch}`,
            );
          }
        } catch {
          provenanceIssues.push(`detached HEAD ${actualSha} is not contained by ${resolved.ref}`);
        }
      }
    }
    if (!provenance.containment_proved) {
      provenanceIssues.push("detached HEAD remote containment was not proved");
    }
    if (!provenance.remote_ref_exact) {
      provenanceIssues.push("detached HEAD remote ref equality was not proved");
    }
    const isMainPush = eventName === "push" && githubRef === "refs/heads/main";
    if (!base && !isMainPush) {
      provenanceIssues.push("detached HEAD certification requires an explicit base ref");
    }
  }

  const effectiveEventName = base ? "pull_request" : eventName;
  const branchSourceIssues = [];
  if (effectiveEventName === "pull_request") {
    if (base === "dev" && head?.startsWith("sync/")) {
      branchSourceIssues.push(...verifyRemoteSource({
        refName: syncSourceRef,
        actualSha,
        exact: true,
        label: "main-to-dev synchronization",
        provenance,
      }));
      provenance.sync_source_ref = provenance.branch_source_ref;
      provenance.sync_source_sha = provenance.branch_source_sha;
      provenance.sync_source_exact = provenance.branch_source_exact;
    } else if (base === "dev") {
      branchSourceIssues.push(...verifyRemoteSource({
        refName: "origin/dev",
        actualSha,
        exact: false,
        label: "development branch",
        provenance,
      }));
    } else if (base === "main" && head?.startsWith("release/")) {
      branchSourceIssues.push(...verifyRemoteSource({
        refName: "origin/dev",
        actualSha,
        exact: false,
        label: "release branch",
        provenance,
      }));
    } else if (base === "main" && head?.startsWith("hotfix/")) {
      branchSourceIssues.push(...verifyRemoteSource({
        refName: "origin/main",
        actualSha,
        exact: false,
        label: "hotfix branch",
        provenance,
      }));
      if (provenance.branch_source_ref) {
        branchSourceIssues.push(...verifyHotfixPatchVersion({
          sourceRef: provenance.branch_source_ref,
          version,
          provenance,
        }));
      }
    }
  }
  const issues = [
    ...provenanceIssues,
    ...evaluateBranchShape({
      eventName: effectiveEventName,
      base,
      head,
      ref: githubRef,
      version,
    }),
    ...branchSourceIssues,
  ];
  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "PASS" : "FAIL",
    event_name: effectiveEventName,
    base_branch: base || null,
    head_branch: head || null,
    provenance,
    policy: {
      production: "main",
      integration: "dev",
      feature_target: "dev",
      feature_source: "origin/dev",
      release_target: "main",
      release_source: "origin/dev",
      hotfix_target: "main",
      hotfix_source: "origin/main",
      sync_target: "dev",
      sync_source: syncSourceRef,
      version,
    },
    issues,
  };
}

function main() {
  const output = verifyBranchPolicy();
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
