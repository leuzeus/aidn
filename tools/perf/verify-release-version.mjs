#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-release-version.mjs");
  console.log("  node tools/perf/verify-release-version.mjs --json");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function findReadmeVersionRefs(readme) {
  const refs = [];
  const patterns = [
    {
      kind: "stable-install-ref",
      regex: /github:leuzeus\/aidn#v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/g,
    },
    {
      kind: "tagged-install-note",
      regex: /#v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/g,
    },
    {
      kind: "remote-ref-example",
      regex: /`v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)`/g,
    },
  ];
  for (const pattern of patterns) {
    for (const match of readme.matchAll(pattern.regex)) {
      refs.push({
        kind: pattern.kind,
        value: match[1],
        token: match[0],
      });
    }
  }
  return refs;
}

function verify() {
  const version = readText("VERSION").trim();
  const packageJson = readJson("package.json");
  const readme = readText("README.md");
  const gitWorkflow = readText(path.join("docs", "GIT_WORKFLOW.md"));
  const readmeRefs = findReadmeVersionRefs(readme);
  const expectedZipName = `aidn-workflow-${version}.zip`;
  const issues = [];

  if (!SEMVER_RE.test(version)) {
    issues.push(`VERSION is not semver-like: ${version}`);
  }
  if (packageJson.version !== version) {
    issues.push(`package.json version ${packageJson.version} does not match VERSION ${version}`);
  }
  if (!readmeRefs.some((ref) => ref.value === version)) {
    issues.push(`README.md does not mention the current stable tag v${version}`);
  }
  for (const ref of readmeRefs) {
    if (ref.value !== version) {
      issues.push(`README.md has stale ${ref.kind} ${ref.token}; expected v${version}`);
    }
  }
  if (!gitWorkflow.includes("Release Version Provenance")) {
    issues.push("docs/GIT_WORKFLOW.md is missing the Release Version Provenance section");
  }

  return {
    ok: issues.length === 0,
    version,
    package_name: packageJson.name,
    package_version: packageJson.version,
    expected_tag: `v${version}`,
    expected_zip: path.join("release", "dist", expectedZipName).split(path.sep).join("/"),
    readme_refs: readmeRefs,
    issues,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = verify();
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Release version policy: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- version=${output.version}`);
    console.log(`- package_version=${output.package_version}`);
    console.log(`- expected_tag=${output.expected_tag}`);
    console.log(`- expected_zip=${output.expected_zip}`);
    for (const issue of output.issues) {
      console.log(`  - ${issue}`);
    }
  }
  if (!output.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  printUsage();
  process.exit(1);
}
