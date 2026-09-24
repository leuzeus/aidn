#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readPackageTarball } from "../lib/release-package-tar.mjs";

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
  const tarballName = `aidn-workflow-${version}.tgz`;
  const zipRelativePath = `release/dist/${zipName}`;
  const tarballRelativePath = `release/dist/${tarballName}`;
  const zipPath = path.join(REPO_ROOT, zipRelativePath);
  const tarballPath = path.join(REPO_ROOT, tarballRelativePath);
  const checksumsPath = path.join(REPO_ROOT, "release", "checksums.txt");
  const manifestPath = path.join(REPO_ROOT, "release", "manifest.json");
  const issues = [];

  if (!fs.existsSync(zipPath)) {
    issues.push(`missing release artifact: ${zipRelativePath}`);
  }
  if (!fs.existsSync(tarballPath)) {
    issues.push(`missing release artifact: ${tarballRelativePath}`);
  }
  if (!fs.existsSync(checksumsPath)) {
    issues.push("missing release/checksums.txt");
  }
  if (!fs.existsSync(manifestPath)) {
    issues.push("missing release/manifest.json");
  }

  const zipHash = fs.existsSync(zipPath) ? sha256File(zipPath) : "";
  const zipBytes = fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0;
  const tarballHash = fs.existsSync(tarballPath) ? sha256File(tarballPath) : "";
  const tarballBytes = fs.existsSync(tarballPath) ? fs.statSync(tarballPath).size : 0;
  const checksumText = fs.existsSync(checksumsPath) ? fs.readFileSync(checksumsPath, "utf8").trim() : "";
  const expectedChecksumLines = zipHash && tarballHash
    ? `${zipHash}  ${zipRelativePath}\n${tarballHash}  ${tarballRelativePath}` : "";
  if (!checksumText && fs.existsSync(checksumsPath)) {
    issues.push("release/checksums.txt is empty");
  } else if (checksumText && checksumText !== expectedChecksumLines) {
    issues.push("release/checksums.txt does not match the current release artifacts");
  }

  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    manifest = readJson("release/manifest.json");
    if (manifest.schema_version !== 2) {
      issues.push(`manifest schema_version must be 2, got ${manifest.schema_version}`);
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
    if (!manifest.git_tree) {
      issues.push("manifest git_tree is missing");
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
      if (manifest.source.tracked_tree_only !== true) {
        issues.push("manifest source.tracked_tree_only must be true");
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
      if (manifest.build.deterministic !== true) {
        issues.push("manifest build.deterministic must be true");
      }
      if (!Array.isArray(manifest.build.inputs) || manifest.build.inputs.length !== manifest.build.input_files) {
        issues.push("manifest build.inputs must enumerate every input file");
      }
    }
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : null;
    if (!artifacts) {
      issues.push("manifest artifacts must be an array");
    } else if (artifacts.length !== 2) {
      issues.push(`manifest artifacts must contain exactly two entries, got ${artifacts.length}`);
    }
    for (const expected of [
      { name: zipName, path: zipRelativePath, sha256: zipHash, bytes: zipBytes },
      { name: tarballName, path: tarballRelativePath, sha256: tarballHash, bytes: tarballBytes },
    ]) {
      const artifact = artifacts?.find((item) => item.path === expected.path);
      if (!artifact) {
        issues.push(`manifest is missing artifact ${expected.path}`);
      } else if (artifact.name !== expected.name || artifact.sha256 !== expected.sha256
        || artifact.bytes !== expected.bytes) {
        issues.push(`manifest artifact does not match ${expected.path}`);
      }
    }
    if (fs.existsSync(tarballPath) && Array.isArray(manifest.build?.inputs)) {
      try {
        const entries = readPackageTarball(fs.readFileSync(tarballPath));
        const expectedPaths = manifest.build.inputs;
        if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify([...expectedPaths].sort())) {
          issues.push("npm tarball paths differ from the package allowlist");
        }
        for (const [entryPath, content] of entries) {
          const sourcePath = path.join(REPO_ROOT, entryPath);
          if (!fs.existsSync(sourcePath) || !content.equals(fs.readFileSync(sourcePath))) {
            issues.push(`npm tarball content differs from source: ${entryPath}`);
          }
        }
      } catch (error) {
        issues.push(`invalid npm tarball: ${error.message}`);
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
    tarball: {
      path: tarballRelativePath,
      exists: fs.existsSync(tarballPath),
      sha256: tarballHash,
      bytes: tarballBytes,
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
    console.log(`- tarball=${output.tarball.path}`);
    console.log(`- tarball_exists=${output.tarball.exists}`);
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
