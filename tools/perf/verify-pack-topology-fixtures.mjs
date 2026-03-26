#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readYamlText(repoRoot, relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

function makeCodexStub(tmpRoot) {
  const binDir = path.resolve(tmpRoot, ".tmp-codex-bin");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "codex.cmd"), [
      "@echo off",
      "if \"%1\"==\"login\" if \"%2\"==\"status\" (",
      "  echo Logged in",
      "  exit /b 0",
      ")",
      "exit /b 0",
      "",
    ].join("\r\n"), "utf8");
  } else {
    const filePath = path.join(binDir, "codex");
    fs.writeFileSync(filePath, [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then",
      "  echo \"Logged in\"",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(filePath, 0o755);
  }
  return binDir;
}

function runInstallDry(repoRoot, targetRoot, codexStubBin, pack) {
  const separator = process.platform === "win32" ? ";" : ":";
  const result = spawnSync(process.execPath, [
    path.resolve(repoRoot, "tools", "install.mjs"),
    "--target",
    targetRoot,
    "--pack",
    pack,
    "--dry-run",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${codexStubBin}${separator}${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function runInstall(repoRoot, targetRoot, codexStubBin, pack, extraArgs = []) {
  const separator = process.platform === "win32" ? ";" : ":";
  const result = spawnSync(process.execPath, [
    path.resolve(repoRoot, "tools", "install.mjs"),
    "--target",
    targetRoot,
    "--pack",
    pack,
    ...extraArgs,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${codexStubBin}${separator}${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function main() {
  const repoRoot = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(path.resolve(repoRoot, "tests", "fixtures"), "tmp-pack-topology-"));
  try {
    const workflowManifest = readYamlText(repoRoot, "package/manifests/workflow.manifest.yaml");
    const runtimeLocalManifest = readYamlText(repoRoot, "packs/runtime-local/manifest.yaml");
    const codexIntegrationManifest = readYamlText(repoRoot, "packs/codex-integration/manifest.yaml");
    const githubIntegrationManifest = readYamlText(repoRoot, "packs/github-integration/manifest.yaml");
    const extendedManifest = readYamlText(repoRoot, "packs/extended/manifest.yaml");
    const sourceTarget = path.resolve(repoRoot, "tests/fixtures/repo-installed-core");
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, targetRoot, { recursive: true });
    const runtimeLocalTarget = path.join(tempRoot, "runtime-local-refresh");
    const codexTarget = path.join(tempRoot, "codex-refresh");
    const githubTarget = path.join(tempRoot, "github-refresh");
    const extendedTarget = path.join(tempRoot, "extended-refresh");
    fs.cpSync(sourceTarget, runtimeLocalTarget, { recursive: true });
    fs.cpSync(sourceTarget, codexTarget, { recursive: true });
    fs.cpSync(sourceTarget, githubTarget, { recursive: true });
    fs.cpSync(sourceTarget, extendedTarget, { recursive: true });
    const codexStubBin = makeCodexStub(tempRoot);

    const runtimeLocalDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "runtime-local");
    const codexIntegrationDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "codex-integration");
    const githubIntegrationDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "github-integration");
    const extendedDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "extended");

    fs.rmSync(path.join(runtimeLocalTarget, ".aidn", "runtime", "agents"), { recursive: true, force: true });
    const runtimeLocalInstall = runInstall(repoRoot, runtimeLocalTarget, codexStubBin, "runtime-local", ["--skip-artifact-import", "--no-codex-migrate-custom"]);
    const runtimeLocalVerify = runInstall(repoRoot, runtimeLocalTarget, codexStubBin, "runtime-local", ["--verify"]);

    fs.rmSync(path.join(codexTarget, ".codex", "skills"), { recursive: true, force: true });
    fs.rmSync(path.join(codexTarget, ".codex", "skills.yaml"), { force: true });
    const codexInstall = runInstall(repoRoot, codexTarget, codexStubBin, "codex-integration", ["--skip-artifact-import", "--no-codex-migrate-custom"]);
    const codexVerify = runInstall(repoRoot, codexTarget, codexStubBin, "codex-integration", ["--verify"]);

    fs.rmSync(path.join(githubTarget, ".github"), { recursive: true, force: true });
    const githubInstall = runInstall(repoRoot, githubTarget, codexStubBin, "github-integration", ["--skip-artifact-import", "--no-codex-migrate-custom"]);
    const githubVerify = runInstall(repoRoot, githubTarget, codexStubBin, "github-integration", ["--verify"]);

    fs.rmSync(path.join(extendedTarget, ".aidn", "runtime", "agents"), { recursive: true, force: true });
    fs.rmSync(path.join(extendedTarget, ".codex", "skills"), { recursive: true, force: true });
    fs.rmSync(path.join(extendedTarget, ".codex", "skills.yaml"), { force: true });
    fs.rmSync(path.join(extendedTarget, ".github"), { recursive: true, force: true });
    const extendedInstall = runInstall(repoRoot, extendedTarget, codexStubBin, "extended", ["--skip-artifact-import", "--no-codex-migrate-custom"]);
    const extendedVerify = runInstall(repoRoot, extendedTarget, codexStubBin, "extended", ["--verify"]);

    assert(/packs:\s*\r?\n\s*-\s*core/i.test(workflowManifest) || /packs:\s*\n\s*-\s*core/i.test(workflowManifest), "workflow manifest should default to core only");
    assert(/depends_on:\s*\[core]/i.test(runtimeLocalManifest), "runtime-local should depend on core");
    assert(/scaffold\/runtime_agents\//i.test(runtimeLocalManifest), "runtime-local should install runtime agents");
    assert(/depends_on:\s*\[core]/i.test(codexIntegrationManifest), "codex-integration should depend on core");
    assert(/scaffold\/codex\/skills\.yaml/i.test(codexIntegrationManifest), "codex-integration should install skills.yaml");
    assert(/scaffold\/codex\//i.test(codexIntegrationManifest), "codex-integration should install local skills");
    assert(/depends_on:\s*\[core]/i.test(githubIntegrationManifest), "github-integration should depend on core");
    assert(/scaffold\/root\/\.github\//i.test(githubIntegrationManifest), "github-integration should install repository automation");
    assert(/depends_on:/i.test(extendedManifest) && /runtime-local/i.test(extendedManifest) && /codex-integration/i.test(extendedManifest) && /github-integration/i.test(extendedManifest), "extended should aggregate runtime-local, codex-integration, and github-integration");

    assert(runtimeLocalDry.status === 0, `runtime-local dry-run failed\nstdout:\n${runtimeLocalDry.stdout}\nstderr:\n${runtimeLocalDry.stderr}`);
    assert(codexIntegrationDry.status === 0, `codex-integration dry-run failed\nstdout:\n${codexIntegrationDry.stdout}\nstderr:\n${codexIntegrationDry.stderr}`);
    assert(githubIntegrationDry.status === 0, `github-integration dry-run failed\nstdout:\n${githubIntegrationDry.stdout}\nstderr:\n${githubIntegrationDry.stderr}`);
    assert(extendedDry.status === 0, `extended dry-run failed\nstdout:\n${extendedDry.stdout}\nstderr:\n${extendedDry.stderr}`);
    assert(runtimeLocalDry.stdout.includes("Packs: core, runtime-local"), "runtime-local dry-run should resolve core dependency");
    assert(codexIntegrationDry.stdout.includes("Packs: core, codex-integration"), "codex-integration dry-run should resolve core dependency");
    assert(githubIntegrationDry.stdout.includes("Packs: core, github-integration"), "github-integration dry-run should resolve core dependency");
    assert(extendedDry.stdout.includes("Packs: core, runtime-local, codex-integration, github-integration, extended"), "extended dry-run should resolve the full composite order");
    assert(runtimeLocalInstall.status === 0, `runtime-local refresh failed\nstdout:\n${runtimeLocalInstall.stdout}\nstderr:\n${runtimeLocalInstall.stderr}`);
    assert(runtimeLocalVerify.status === 0, `runtime-local verify failed\nstdout:\n${runtimeLocalVerify.stdout}\nstderr:\n${runtimeLocalVerify.stderr}`);
    assert(fs.existsSync(path.join(runtimeLocalTarget, ".aidn", "runtime", "agents", "example-external-auditor.mjs")), "runtime-local should restore runtime agent examples");
    assert(codexInstall.status === 0, `codex-integration refresh failed\nstdout:\n${codexInstall.stdout}\nstderr:\n${codexInstall.stderr}`);
    assert(codexVerify.status === 0, `codex-integration verify failed\nstdout:\n${codexVerify.stdout}\nstderr:\n${codexVerify.stderr}`);
    assert(fs.existsSync(path.join(codexTarget, ".codex", "skills", "start-session", "SKILL.md")), "codex-integration should restore local skills");
    assert(fs.existsSync(path.join(codexTarget, ".codex", "skills.yaml")), "codex-integration should restore skills.yaml");
    assert(githubInstall.status === 0, `github-integration refresh failed\nstdout:\n${githubInstall.stdout}\nstderr:\n${githubInstall.stderr}`);
    assert(githubVerify.status === 0, `github-integration verify failed\nstdout:\n${githubVerify.stdout}\nstderr:\n${githubVerify.stderr}`);
    assert(fs.existsSync(path.join(githubTarget, ".github", "workflows", "branch-prune.yml")), "github-integration should restore branch pruning automation");
    assert(extendedInstall.status === 0, `extended refresh failed\nstdout:\n${extendedInstall.stdout}\nstderr:\n${extendedInstall.stderr}`);
    assert(extendedVerify.status === 0, `extended verify failed\nstdout:\n${extendedVerify.stdout}\nstderr:\n${extendedVerify.stderr}`);
    assert(fs.existsSync(path.join(extendedTarget, ".aidn", "runtime", "agents", "example-external-auditor.mjs")), "extended should restore runtime agent examples");
    assert(fs.existsSync(path.join(extendedTarget, ".codex", "skills", "start-session", "SKILL.md")), "extended should restore local skills");
    assert(fs.existsSync(path.join(extendedTarget, ".codex", "skills.yaml")), "extended should restore skills.yaml");
    assert(fs.existsSync(path.join(extendedTarget, ".github", "workflows", "branch-prune.yml")), "extended should restore branch pruning automation");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    removePathWithRetry(tempRoot);
  }
}

main();
