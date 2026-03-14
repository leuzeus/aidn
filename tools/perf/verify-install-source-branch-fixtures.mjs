#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    sourceBranch: "trunk",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--source-branch") {
      args.sourceBranch = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.sourceBranch) {
    throw new Error("Missing value for --source-branch");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-install-source-branch-fixtures.mjs");
  console.log("  node tools/perf/verify-install-source-branch-fixtures.mjs --source-branch trunk --json");
}

function makeCodexStub(tmpRoot) {
  const binDir = path.resolve(tmpRoot, ".tmp-codex-bin");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, "codex.cmd"),
      [
        "@echo off",
        "if \"%1\"==\"login\" if \"%2\"==\"status\" (",
        "  echo Logged in",
        "  exit /b 0",
        ")",
        "if \"%1\"==\"exec\" (",
        "  exit /b 0",
        ")",
        "exit /b 0",
        "",
      ].join("\r\n"),
      "utf8",
    );
  } else {
    const stub = path.join(binDir, "codex");
    fs.writeFileSync(
      stub,
      [
        "#!/usr/bin/env sh",
        "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then",
        "  echo \"Logged in\"",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"exec\" ]; then",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(stub, 0o755);
  }
  return binDir;
}

function writeAdapterFile(tmpRoot) {
  const filePath = path.join(tmpRoot, "workflow.adapter.json");
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    projectName: path.basename(tmpRoot),
    constraints: {
      runtime: "",
      architecture: "",
      delivery: "",
      additional: [],
    },
    runtimePolicy: {
      preferredStateMode: "dual",
      defaultIndexStore: "dual-sqlite",
    },
  }, null, 2)}\n`, "utf8");
  return filePath;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  let tempRoot = "";
  let codexStubBin = "";
  let adapterFile = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-install-source-branch-"));
    spawnSync("git", ["init", "--initial-branch=main"], {
      cwd: tempRoot,
      stdio: "ignore",
    });
    codexStubBin = makeCodexStub(tempRoot);
    adapterFile = writeAdapterFile(tempRoot);
    const separator = process.platform === "win32" ? ";" : ":";
    const result = spawnSync(process.execPath, [
      path.resolve(repoRoot, "tools", "install.mjs"),
      "--target",
      tempRoot,
      "--pack",
      "core",
      "--adapter-file",
      adapterFile,
      "--source-branch",
      args.sourceBranch,
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
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
    if ((result.status ?? 1) !== 0) {
      throw new Error(String(result.stderr ?? result.stdout ?? "").trim() || "install failed");
    }

    fs.writeFileSync(path.join(tempRoot, "docs", "audit", "WORKFLOW.md"), [
      "# Project Workflow Adapter (Stub)",
      "",
      "workflow_version: 0.0.0",
      `source_branch: wrong-branch`,
      "",
      "## Branch & Cycle Policy",
      "",
      "- Source branch: `wrong-branch`)",
      "",
    ].join("\n"), "utf8");

    const preserveResult = spawnSync(process.execPath, [
      path.resolve(repoRoot, "tools", "install.mjs"),
      "--target",
      tempRoot,
      "--pack",
      "core",
      "--adapter-file",
      adapterFile,
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
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
    if ((preserveResult.status ?? 1) !== 0) {
      throw new Error(String(preserveResult.stderr ?? preserveResult.stdout ?? "").trim() || "preserve install failed");
    }

    const workflowText = fs.readFileSync(path.join(tempRoot, "docs", "audit", "WORKFLOW.md"), "utf8");
    const baselineCurrentText = fs.readFileSync(path.join(tempRoot, "docs", "audit", "baseline", "current.md"), "utf8");
    const baselineHistoryText = fs.readFileSync(path.join(tempRoot, "docs", "audit", "baseline", "history.md"), "utf8");
    const configText = fs.readFileSync(path.join(tempRoot, ".aidn", "config.json"), "utf8");
    const config = JSON.parse(configText);

    assert(workflowText.includes(`source_branch: ${args.sourceBranch}`), "WORKFLOW.md should include explicit source_branch metadata");
    assert(workflowText.includes(`Source branch: \`${args.sourceBranch}\``), "WORKFLOW.md should include explicit source branch policy");
    assert(baselineCurrentText.includes(`source_branch: ${args.sourceBranch}`), "baseline/current.md should include explicit source_branch");
    assert(baselineHistoryText.includes(`source_branch: ${args.sourceBranch}`), "baseline/history.md should include explicit source_branch");
    assert(String(config?.workflow?.sourceBranch ?? "") === args.sourceBranch, ".aidn/config.json should persist explicit sourceBranch and win on reinstall");

    const output = {
      ts: new Date().toISOString(),
      source_branch: args.sourceBranch,
      target_root: tempRoot,
      pass: true,
    };
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Source branch: ${args.sourceBranch}`);
      console.log("Result: PASS");
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (codexStubBin && fs.existsSync(codexStubBin)) {
      fs.rmSync(codexStubBin, { recursive: true, force: true });
    }
    if (adapterFile && fs.existsSync(adapterFile)) {
      fs.rmSync(adapterFile, { force: true });
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
