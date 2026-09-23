import fs from "node:fs";
import path from "node:path";
import { executeCodexAssets } from "../../src/application/install/codex-assets-service.mjs";

// Keep historical corpora untouched. Only the temporary client's runtime data
// is copied; its integration assets and authorization are installed afresh.
export function isActivationFixtureSource(sourceRoot, source, { freshContext = false, freshCoordination = false } = {}) {
  const relative = path.relative(sourceRoot, source).replaceAll("\\", "/");
  return ![".git", ".agents", ".codex", ".aidn/codex", ".aidn/install", "AGENTS.md",
    ...(freshContext ? [".aidn/runtime/context"] : []),
    ...(freshCoordination ? [".aidn/runtime/context/coordination-history.ndjson", ".aidn/runtime/context/raw"] : [])]
    .some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`));
}

// Test clients use the real installer and authority; no production bypass flag.
export function prepareActivationFixture(targetRoot, repoRoot = path.resolve(import.meta.dirname, "../..")) {
  const result = executeCodexAssets({ targetRoot, repoRoot, dryRun: false });
  if (!result.ok) throw new Error(`Activation fixture installation failed: ${result.errors.join("; ")}`);
  return result;
}

// Coordinator integration fixtures exercise their real `npx aidn` command from
// an installed client. Bind only that local npm bin to the source under test;
// keep npm offline and all of its writable cache inside the owned temp client.
export function prepareNpmActivationFixture(targetRoot, repoRoot = path.resolve(import.meta.dirname, "../..")) {
  const binDirectory = path.join(targetRoot, "node_modules", ".bin");
  fs.mkdirSync(binDirectory, { recursive: true });
  const aidnBin = path.join(repoRoot, "bin", "aidn.mjs");
  const quote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
  fs.writeFileSync(path.join(binDirectory, "aidn"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(aidnBin)} "$@"\n`, { mode: 0o755 });
  if (process.platform === "win32") fs.writeFileSync(path.join(binDirectory, "aidn.cmd"), `@echo off\r\n"${process.execPath}" "${aidnBin}" %*\r\n`);
  const gitDirectory = path.join(targetRoot, ".git");
  if (fs.existsSync(gitDirectory) && fs.statSync(gitDirectory).isDirectory()) {
    const exclude = path.join(gitDirectory, "info", "exclude");
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, "\n/node_modules/\n");
  }
  return fixtureNpmEnvironment(targetRoot);
}

export function fixtureNpmEnvironment(targetRoot) {
  return { npm_config_cache: path.join(targetRoot, "node_modules", ".cache", "npm"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
}
