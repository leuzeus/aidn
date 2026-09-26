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

// Handoff corpora model routing state, not a complete installed workflow. Tests
// that execute branch gating supply documents, aligned intent and drift evidence.
export function prepareWorkflowDocumentsFixture(targetRoot) {
  for (const relative of ["docs/audit/baseline/current.md", "docs/audit/WORKFLOW.md", "docs/audit/SPEC.md"]) {
    const file = path.join(targetRoot, relative);
    if (fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# Temporary workflow artifact\n");
  }
  const session = path.join(targetRoot, "docs/audit/sessions/S101-alpha.md");
  if (fs.existsSync(session)) fs.appendFileSync(session, "\nsession_objective: finalize alpha feature\n");
  const events = path.join(targetRoot, ".aidn/runtime/perf/workflow-events.ndjson");
  fs.mkdirSync(path.dirname(events), { recursive: true });
  // Explicit synthetic drift evidence belongs only to these temporary fixtures.
  fs.appendFileSync(events, JSON.stringify({ ts: new Date().toISOString(), skill: "drift-check", result: "ok" }) + "\n");
}
