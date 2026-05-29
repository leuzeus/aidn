#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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
  console.log("  npm run build-release");
  console.log("  node tools/perf/verify-release-artifacts.mjs");
  console.log("  node tools/perf/verify-release-artifacts.mjs --json");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function getGitCommit(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function verify() {
  const version = readText("VERSION").trim();
  const packageJson = readJson("package.json");
  const zipName = `aidn-workflow-${version}.zip`;
  const zipRelativePath = `release/dist/${zipName}`;
  const zipPath = path.join(REPO_ROOT, zipRelativePath);
  const checksumsPath = path.join(REPO_ROOT, "release", "checksums.txt");
  const manifestPath = path.join(REPO_ROOT, "release", "manifest.json");
  const issues = [];

  if (!fs.existsSync(zipPath)) {
    issues.push(`missing release artifact: ${zipRelativePath}`);
  }
  if (!fs.existsSync(checksumsPath)) {
    issues.push("missing release/checksums.txt");
  }
  if (!fs.existsSync(manifestPath)) {
    issues.push("missing release/manifest.json");
  }

  const zipHash = fs.existsSync(zipPath) ? sha256File(zipPath) : "";
  const zipBytes = fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0;
  const checksumText = fs.existsSync(checksumsPath) ? fs.readFileSync(checksumsPath, "utf8").trim() : "";
  const expectedChecksumLine = zipHash ? `${zipHash}  ${zipRelativePath}` : "";
  if (!checksumText && fs.existsSync(checksumsPath)) {
    issues.push("release/checksums.txt is empty");
  } else if (checksumText && checksumText !== expectedChecksumLine) {
    issues.push("release/checksums.txt does not match the current release zip");
  }

  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    manifest = readJson("release/manifest.json");
    if (manifest.schema_version !== 1) {
      issues.push(`manifest schema_version must be 1, got ${manifest.schema_version}`);
    }
    if (manifest.package_name !== packageJson.name) {
      issues.push(`manifest package_name ${manifest.package_name} does not match package.json ${packageJson.name}`);
    }
    if (manifest.version !== version) {
      issues.push(`manifest version ${manifest.version} does not match VERSION ${version}`);
    }
    if (!manifest.git_commit) {
      issues.push("manifest git_commit is missing");
    } else if (manifest.git_commit !== getGitCommit(REPO_ROOT)) {
      issues.push(`manifest git_commit ${manifest.git_commit} does not match HEAD ${getGitCommit(REPO_ROOT)}`);
    }
    if (!manifest.generated_at || Number.isNaN(Date.parse(manifest.generated_at))) {
      issues.push("manifest generated_at must be an ISO timestamp");
    }
    if (!manifest.source || manifest.source.version_file !== "VERSION" || manifest.source.package_file !== "package.json") {
      issues.push("manifest source block must declare VERSION and package.json provenance");
    } else {
      const versionPath = path.join(REPO_ROOT, "VERSION");
      const packagePath = path.join(REPO_ROOT, "package.json");
      if (manifest.source.version_file_sha256 !== sha256File(versionPath)) {
        issues.push("manifest source.version_file_sha256 does not match VERSION");
      }
      if (manifest.source.package_file_sha256 !== sha256File(packagePath)) {
        issues.push("manifest source.package_file_sha256 does not match package.json");
      }
    }
    if (!manifest.build || manifest.build.tool !== "tools/build-release.mjs") {
      issues.push("manifest build block must declare tools/build-release.mjs provenance");
    } else {
      if (!Number.isInteger(manifest.build.input_files) || manifest.build.input_files < 0) {
        issues.push("manifest build.input_files must be a non-negative integer");
      }
      if (!Number.isInteger(manifest.build.input_bytes) || manifest.build.input_bytes < 0) {
        issues.push("manifest build.input_bytes must be a non-negative integer");
      }
    }
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : null;
    if (!artifacts) {
      issues.push("manifest artifacts must be an array");
    } else if (artifacts.length !== 1) {
      issues.push(`manifest artifacts must contain exactly one entry, got ${artifacts.length}`);
    }
    const artifact = artifacts ? artifacts.find((item) => item.path === zipRelativePath) : null;
    if (!artifact) {
      issues.push(`manifest is missing artifact ${zipRelativePath}`);
    } else {
      if (artifact.name !== zipName) {
        issues.push(`manifest artifact name ${artifact.name} does not match ${zipName}`);
      }
      if (artifact.sha256 !== zipHash) {
        issues.push("manifest artifact sha256 does not match release zip");
      }
      if (artifact.bytes !== zipBytes) {
        issues.push("manifest artifact bytes does not match release zip");
      }
    }
  }

  return {
    ok: issues.length === 0,
    version,
    package_name: packageJson.name,
    artifact: {
      path: zipRelativePath,
      exists: fs.existsSync(zipPath),
      sha256: zipHash,
      bytes: zipBytes,
    },
    checksums_line: checksumText,
    manifest,
    issues,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = verify();
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Release artifacts: ${output.ok ? "PASS" : "FAIL"}`);
    console.log(`- version=${output.version}`);
    console.log(`- artifact=${output.artifact.path}`);
    console.log(`- artifact_exists=${output.artifact.exists}`);
    console.log(`- bytes=${output.artifact.bytes}`);
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
