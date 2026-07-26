#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

const eventName = process.env.GITHUB_EVENT_NAME ?? "local";
const base = process.env.GITHUB_BASE_REF ?? "";
const head = process.env.GITHUB_HEAD_REF || git(["branch", "--show-current"]);
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
  issues.push("local branch policy cannot validate a detached HEAD");
} else if (["main", "dev"].includes(head)) {
  issues.push(`local implementation must not run directly on protected branch ${head}`);
}

const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "PASS" : "FAIL",
  event_name: eventName,
  base_branch: base || null,
  head_branch: head || null,
  policy: {
    production: "main",
    integration: "dev",
    feature_target: "dev",
    release_target: "main",
  },
  issues,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
