#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInstallUseCase } from "../../src/application/install/install-use-case.mjs";
import { readRuntimeSnapshot } from "../../src/application/runtime/runtime-snapshot-service.mjs";
import { readAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";
import { createRuntimePersistenceFakePgClientFactory } from "./runtime-persistence-fake-pg-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    const cmdPath = path.join(binDir, "codex");
    fs.writeFileSync(cmdPath, [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then",
      "  echo \"Logged in\"",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(cmdPath, 0o755);
  }
  return binDir;
}

async function main() {
  let tempRoot = "";
  let originalPath = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-install-runtime-adoption-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(path.resolve(process.cwd(), "tests", "fixtures", "repo-installed-core"), targetRoot, { recursive: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "config.json"), { force: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "runtime"), { recursive: true, force: true });

    const fake = createRuntimePersistenceFakePgClientFactory();
    const codexStubBin = makeCodexStub(tempRoot);
    originalPath = String(process.env.PATH ?? "");
    process.env.PATH = `${codexStubBin}${process.platform === "win32" ? ";" : ":"}${originalPath}`;
    process.env.AIDN_PG_URL = "postgres://aidn:test@localhost:5432/aidn";

    await runInstallUseCase({
      repoRoot: process.cwd(),
      targetRoot,
      args: {
        target: targetRoot,
        pack: "core",
        sourceBranch: "",
        adapterFile: "",
        dryRun: false,
        verifyOnly: false,
        skipArtifactImport: false,
        artifactImportStore: "",
        runtimePersistenceBackend: "postgres",
        runtimePersistenceConnectionRef: "env:AIDN_PG_URL",
        runtimePersistenceLocalProjectionPolicy: "keep-local-sqlite",
        assist: false,
        strict: false,
        skipAgents: false,
        forceAgentsMerge: false,
        codexMigrateCustom: false,
      },
      runtimeBackendAdoptionOptions: {
        connectionString: process.env.AIDN_PG_URL,
        clientFactory: fake.factory,
      },
    });

    const config = readAidnProjectConfig(targetRoot);
    const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const compatSnapshot = await readRuntimeSnapshot({
      indexFile: sqliteFile,
      backend: "postgres",
      targetRoot,
      connectionString: process.env.AIDN_PG_URL,
      clientFactory: fake.factory,
    });

    assert(config.exists === true, "install should write .aidn/config.json");
    assert(String(config.data?.runtime?.persistence?.backend ?? "") === "postgres", "config should persist postgres as canonical runtime backend");
    assert(String(config.data?.runtime?.persistence?.connectionRef ?? "") === "env:AIDN_PG_URL", "config should persist the runtime connection ref");
    assert(fs.existsSync(sqliteFile), "install should preserve the local sqlite projection");
    assert(compatSnapshot.backend === "postgres" && compatSnapshot.payload?.summary?.artifacts_count > 0, "postgres runtime should keep a readable local sqlite compatibility snapshot");
    assert(fake.state.relationalRows.index_meta.some((row) => row.key === "payload_schema_version"), "install should transfer canonical runtime metadata to postgres");
    assert(fake.state.relationalRows.artifacts.length > 0, "install should transfer canonical runtime artifacts to postgres");
    assert(fake.state.adoptionEvents.length === 1, "install should record one runtime adoption event");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (originalPath) {
      process.env.PATH = originalPath;
    }
    delete process.env.AIDN_PG_URL;
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

await main();
