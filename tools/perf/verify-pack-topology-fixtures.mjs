#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function main() {
  const repoRoot = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(path.resolve(repoRoot, "tests", "fixtures"), "tmp-pack-topology-"));
  try {
    const workflowManifest = readYamlText(repoRoot, "package/manifests/workflow.manifest.yaml");
    const runtimeLocalManifest = readYamlText(repoRoot, "packs/runtime-local/manifest.yaml");
    const codexIntegrationManifest = readYamlText(repoRoot, "packs/codex-integration/manifest.yaml");
    const extendedManifest = readYamlText(repoRoot, "packs/extended/manifest.yaml");
    const sourceTarget = path.resolve(repoRoot, "tests/fixtures/repo-installed-core");
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, targetRoot, { recursive: true });
    const codexStubBin = makeCodexStub(tempRoot);

    const runtimeLocalDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "runtime-local");
    const codexIntegrationDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "codex-integration");
    const extendedDry = runInstallDry(repoRoot, targetRoot, codexStubBin, "extended");

    assert(/packs:\s*\r?\n\s*-\s*core/i.test(workflowManifest) || /packs:\s*\n\s*-\s*core/i.test(workflowManifest), "workflow manifest should default to core only");
    assert(/depends_on:\s*\[core]/i.test(runtimeLocalManifest), "runtime-local should depend on core");
    assert(/scaffold\/runtime_agents\//i.test(runtimeLocalManifest), "runtime-local should install runtime agents");
    assert(/depends_on:\s*\[core]/i.test(codexIntegrationManifest), "codex-integration should depend on core");
    assert(/scaffold\/codex\/skills\.yaml/i.test(codexIntegrationManifest), "codex-integration should install skills.yaml");
    assert(/scaffold\/codex\//i.test(codexIntegrationManifest), "codex-integration should install local skills");
    assert(/depends_on:/i.test(extendedManifest) && /runtime-local/i.test(extendedManifest) && /codex-integration/i.test(extendedManifest), "extended should aggregate runtime-local and codex-integration");

    assert(runtimeLocalDry.status === 0, `runtime-local dry-run failed\nstdout:\n${runtimeLocalDry.stdout}\nstderr:\n${runtimeLocalDry.stderr}`);
    assert(codexIntegrationDry.status === 0, `codex-integration dry-run failed\nstdout:\n${codexIntegrationDry.stdout}\nstderr:\n${codexIntegrationDry.stderr}`);
    assert(extendedDry.status === 0, `extended dry-run failed\nstdout:\n${extendedDry.stdout}\nstderr:\n${extendedDry.stderr}`);
    assert(runtimeLocalDry.stdout.includes("Packs: core, runtime-local"), "runtime-local dry-run should resolve core dependency");
    assert(codexIntegrationDry.stdout.includes("Packs: core, codex-integration"), "codex-integration dry-run should resolve core dependency");
    assert(extendedDry.stdout.includes("Packs: core, runtime-local, codex-integration, extended"), "extended dry-run should resolve the full composite order");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
