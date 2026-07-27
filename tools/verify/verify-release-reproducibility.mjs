#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runBuild(outputRoot) {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "tools", "build-release.mjs"),
    "--source-ref",
    "HEAD",
    "--output-root",
    outputRoot,
    "--require-clean",
    "--json",
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`release build failed\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function npmPackFiles() {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const command = fs.existsSync(npmCli) ? process.execPath : "npm";
  const prefix = fs.existsSync(npmCli) ? [npmCli] : [];
  const result = spawnSync(command, [...prefix, "pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout)[0].files.map((item) => item.path).sort();
}

function main() {
  const started = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-release-repro-"));
  try {
    const first = runBuild(path.join(tempRoot, "first"));
    const second = runBuild(path.join(tempRoot, "second"));
    const firstManifest = JSON.parse(fs.readFileSync(first.manifest, "utf8"));
    const secondManifest = JSON.parse(fs.readFileSync(second.manifest, "utf8"));
    const issues = [];
    if (sha256(first.zip) !== sha256(second.zip)) issues.push("release zip is not reproducible");
    if (fs.readFileSync(first.checksums, "utf8") !== fs.readFileSync(second.checksums, "utf8")) {
      issues.push("release checksums are not reproducible");
    }
    if (JSON.stringify(firstManifest) !== JSON.stringify(secondManifest)) {
      issues.push("release manifest is not reproducible");
    }
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    if (firstManifest.git_commit !== head) issues.push("manifest commit does not match HEAD");
    if (firstManifest.source?.tracked_tree_only !== true) issues.push("manifest does not assert tracked-tree-only inputs");
    if (firstManifest.source?.clean_checkout_required !== true) issues.push("manifest does not assert clean checkout");
    if (firstManifest.build?.deterministic !== true) issues.push("manifest does not assert deterministic build");
    const inputs = [...(firstManifest.build?.inputs ?? [])].sort();
    const npmFiles = npmPackFiles();
    if (JSON.stringify(inputs) !== JSON.stringify(npmFiles)) {
      issues.push("release input topology differs from npm pack allowlist");
    }
    const forbidden = inputs.filter((entry) => (
      entry.startsWith("tests/")
      || entry.startsWith(".github/")
      || /(?:^|\/)(?:PLAN|BACKLOG)_/i.test(entry)
      || /pilot/i.test(entry)
      || entry.startsWith("release/")
    ));
    if (forbidden.length > 0) issues.push(`sensitive or non-package inputs present: ${forbidden.join(", ")}`);
    for (const required of [
      "VERSION",
      "package.json",
      "bin/aidn.mjs",
      "packs/core/manifest.yaml",
      "scaffold/codex_agents/aidn-reviewer.toml",
      "scaffold/codex_hooks/hooks.json",
      "package/catalogs/surfaces.v1.json",
      "package/catalogs/gates.v1.json",
    ]) {
      if (!inputs.includes(required)) issues.push(`required package topology entry missing: ${required}`);
    }
    const output = {
      ok: issues.length === 0,
      status: issues.length === 0 ? "PASS" : "FAIL",
      source_commit: head,
      input_files: inputs.length,
      zip_sha256: sha256(first.zip),
      duration_ms: Date.now() - started,
      issues,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.ok) process.exitCode = 1;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
