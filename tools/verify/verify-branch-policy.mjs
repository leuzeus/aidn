#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log(
        "Usage: node tools/verify/verify-branch-policy.mjs "
        + "[--event-name NAME] [--base-ref BRANCH] [--head-ref BRANCH] "
        + "[--expected-sha SHA] [--contains-ref REMOTE_REF]",
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

function resolveRefSha(refName) {
  const candidates = refName.startsWith("refs/")
    ? [refName]
    : [
      `refs/heads/${refName}`,
      `refs/remotes/${refName}`,
      `refs/remotes/origin/${refName}`,
      refName,
    ];
  for (const candidate of candidates) {
    try {
      return {
        ref: candidate,
        sha: git(["rev-parse", "--verify", `${candidate}^{commit}`]),
      };
    } catch {
      // Try the next unambiguous ref spelling.
    }
  }
  return null;
}

export function evaluateBranchShape({ eventName, base, head }) {
  const issues = [];
  if (eventName === "pull_request") {
    if (base === "dev") {
      if (!head || ["main", "dev"].includes(head) || head.startsWith("release/")) {
        issues.push(`feature integration PRs must target dev from a non-release branch; got ${head || "detached"}`);
      }
    } else if (base === "main") {
      if (!head.startsWith("release/")) {
        issues.push(`only release/* PRs may target main; got ${head || "detached"}`);
      }
    } else {
      issues.push(`unsupported PR base ${base || "missing"}; expected dev or main`);
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
  const explicitHead = args.headRef
    ?? env.AIDN_BRANCH_POLICY_HEAD_REF
    ?? "";
  const explicitBase = args.baseRef
    ?? env.AIDN_BRANCH_POLICY_BASE_REF
    ?? "";
  const expectedSha = args.expectedSha
    ?? env.AIDN_BRANCH_POLICY_EXPECTED_SHA
    ?? "";
  const containsRef = args.containsRef
    ?? env.AIDN_BRANCH_POLICY_CONTAINS_REF
    ?? "";
  const eventName = args.eventName
    ?? env.AIDN_BRANCH_POLICY_EVENT_NAME
    ?? env.GITHUB_EVENT_NAME
    ?? "local";
  const githubHead = env.GITHUB_HEAD_REF ?? "";
  const githubBase = env.GITHUB_BASE_REF ?? "";
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
    containment_proved: false,
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
    if (explicitHead) {
      const resolved = resolveRefSha(explicitHead);
      if (!resolved) {
        provenanceIssues.push(`explicit head ref cannot be resolved: ${explicitHead}`);
      } else {
        provenance.resolved_head_ref = resolved.ref;
        provenance.resolved_head_sha = resolved.sha;
        if (resolved.sha !== actualSha) {
          provenanceIssues.push(`explicit head ref ${explicitHead} does not resolve to detached HEAD`);
        }
      }
    } else if (containsRef) {
      const resolved = resolveRefSha(containsRef);
      if (!resolved || !resolved.ref.startsWith("refs/remotes/")) {
        provenanceIssues.push(`detached containment ref must resolve to a remote ref: ${containsRef}`);
      } else {
        provenance.resolved_head_ref = resolved.ref;
        provenance.resolved_head_sha = resolved.sha;
        try {
          git(["merge-base", "--is-ancestor", actualSha, resolved.ref]);
          provenance.containment_proved = true;
          head = resolved.ref
            .replace(/^refs\/remotes\/origin\//, "")
            .replace(/^refs\/remotes\/[^/]+\//, "");
        } catch {
          provenanceIssues.push(`detached HEAD ${actualSha} is not contained by ${resolved.ref}`);
        }
      }
    } else {
      provenanceIssues.push("detached HEAD certification requires an explicit head ref or remote containment ref");
    }
    if (!base) {
      provenanceIssues.push("detached HEAD certification requires an explicit base ref");
    }
  }

  const effectiveEventName = base ? "pull_request" : eventName;
  const issues = [
    ...provenanceIssues,
    ...evaluateBranchShape({
      eventName: effectiveEventName,
      base,
      head,
    }),
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
      release_target: "main",
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
