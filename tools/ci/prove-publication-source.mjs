#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function defaultGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function classifyPublicationSource({ pullRequests, version, githubSha }) {
  if (!Array.isArray(pullRequests)) {
    throw new Error("associated pull-request response must be an array");
  }
  const normalizedVersion = String(version ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(normalizedVersion)) {
    throw new Error(`repository VERSION is invalid: ${normalizedVersion || "missing"}`);
  }
  const normalizedGithubSha = String(githubSha ?? "");
  if (!/^[0-9a-f]{40}$/u.test(normalizedGithubSha)) {
    throw new Error(
      `publication classification requires an exact 40-character GITHUB_SHA; `
      + `got ${normalizedGithubSha || "missing"}`,
    );
  }
  const mergedMainPullRequests = pullRequests.filter(
    (pullRequest) => pullRequest?.base?.ref === "main" && pullRequest?.merged_at != null,
  );
  if (mergedMainPullRequests.length !== 1) {
    throw new Error(
      `expected exactly one merged pull request targeting main; got ${mergedMainPullRequests.length}`,
    );
  }
  const publicationPullRequest = mergedMainPullRequests[0];
  const mergeCommitSha = String(publicationPullRequest?.merge_commit_sha ?? "");
  if (mergeCommitSha !== normalizedGithubSha) {
    throw new Error(
      `merged publication pull request SHA mismatch: `
      + `merge_commit_sha=${mergeCommitSha || "missing"}, GITHUB_SHA=${normalizedGithubSha}`,
    );
  }
  const branch = String(publicationPullRequest?.head?.ref ?? "");
  const expected = {
    release: `release/v${normalizedVersion}`,
    hotfix: `hotfix/v${normalizedVersion}`,
  };
  const kind = Object.entries(expected).find(([, candidate]) => candidate === branch)?.[0];
  if (!kind) {
    throw new Error(
      `expected ${expected.release} or ${expected.hotfix}; got ${branch || "missing"}`,
    );
  }
  return {
    kind,
    branch,
    version: normalizedVersion,
    merge_commit_sha: mergeCommitSha,
  };
}

export async function provePublicationSource({
  env = process.env,
  runGit = defaultGit,
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  appendFile = (filePath, content) => fs.appendFileSync(filePath, content, "utf8"),
  request = globalThis.fetch,
} = {}) {
  const ref = String(env.GITHUB_REF ?? "");
  const sha = String(env.GITHUB_SHA ?? "");
  const repository = String(env.GITHUB_REPOSITORY ?? "");
  const token = String(env.GH_TOKEN ?? "");
  const outputPath = String(env.GITHUB_OUTPUT ?? "");
  const apiUrl = String(env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/u, "");
  if (ref !== "refs/heads/main") {
    throw new Error(`publication requires refs/heads/main; got ${ref || "missing"}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(sha)) {
    throw new Error(`publication requires an exact 40-character GITHUB_SHA; got ${sha || "missing"}`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error(`GITHUB_REPOSITORY is invalid: ${repository || "missing"}`);
  }
  if (!token || !outputPath || typeof request !== "function") {
    throw new Error("publication proof requires GH_TOKEN, GITHUB_OUTPUT, and an HTTP client");
  }

  runGit(["fetch", "--no-tags", "origin", "main"]);
  const headSha = runGit(["rev-parse", "HEAD"]);
  const mainSha = runGit(["rev-parse", "origin/main"]);
  if (headSha !== sha || mainSha !== sha) {
    throw new Error(`publication SHA mismatch: HEAD=${headSha}, origin/main=${mainSha}, event=${sha}`);
  }
  const version = String(readFile("VERSION")).trim();
  const response = await request(
    `${apiUrl}/repos/${repository}/commits/${sha}/pulls?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response?.ok) {
    throw new Error(`associated pull-request request failed with HTTP ${response?.status ?? "unknown"}`);
  }
  const classified = classifyPublicationSource({
    pullRequests: await response.json(),
    version,
    githubSha: sha,
  });
  const dirty = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty) {
    throw new Error("publication checkout must be clean");
  }
  appendFile(outputPath, `kind=${classified.kind}\nbranch=${classified.branch}\n`);
  return {
    ...classified,
    sha,
    pull_request_count: 1,
  };
}

async function main() {
  const result = await provePublicationSource();
  console.log(JSON.stringify({ ok: true, status: "PASS", ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
