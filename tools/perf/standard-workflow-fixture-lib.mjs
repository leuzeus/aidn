import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareActivationFixture, isActivationFixtureSource } from "./test-activation-fixture-lib.mjs";
import { buildCanonicalFromMarkdown } from "../../src/lib/workflow/markdown-render-lib.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { runArtifactImport } from "../../src/application/install/artifact-import-service.mjs";
import { resolveRuntimeSqliteFile } from "../../src/application/runtime/runtime-persistence-service.mjs";


const repo = fileURLToPath(new URL("../../", import.meta.url));
const temporary = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
export function createStandardWorkflowFixture(mode = "files", owned = []) {
  const root = fs.mkdtempSync(path.join(temporary, "aidn-standard-ports-")); owned.push(root);
  const source = path.join(repo, "tests/fixtures/repo-installed-core");
  // Derive a temporary fixture only from tracked corpus bytes. A developer's
  // ignored SQLite index must not change what a clean checkout tests.
  const prefix = "tests/fixtures/repo-installed-core/";
  const tracked = new Set(git(repo, "ls-files", "-z", "--", prefix).split("\0").filter(Boolean).map(name => name.slice(prefix.length)));
  const directories = new Set([""]);
  for (const name of tracked) { let parent = path.posix.dirname(name); while (parent !== ".") { directories.add(parent); parent = path.posix.dirname(parent); } }
  fs.cpSync(source, root, { recursive: true, filter: name => {
    const relative = path.relative(source, name).replaceAll("\\", "/");
    return (tracked.has(relative) || directories.has(relative)) && isActivationFixtureSource(source, name);
  } });
  // Current source template, real installed activation assets, fixture business
  // state. This is scaffold/fixture qualification, not archive qualification.
  fs.copyFileSync(path.join(repo, "scaffold/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md"), path.join(root, "docs/audit/sessions/TEMPLATE_SESSION_SXXX.md"));
  const configPath = path.join(root, ".aidn/config.json"), config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.runtime.stateMode = mode; fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const adapterPath = path.join(root, ".aidn/project/workflow.adapter.json"), adapter = JSON.parse(fs.readFileSync(adapterPath, "utf8"));
  adapter.runtimePolicy.preferredStateMode = mode; fs.writeFileSync(adapterPath, JSON.stringify(adapter, null, 2));
  const runtimeFile = path.join(root, "docs/audit/RUNTIME-STATE.md");
  fs.writeFileSync(runtimeFile, fs.readFileSync(runtimeFile, "utf8").replace(/^runtime_state_mode:.*$/m, `runtime_state_mode: ${mode}`));
  if (mode !== "files") {
    // Explicit fixture construction, not a runtime fallback or conversion of
    // historical instances. The real index projector creates the temporary
    // canonical store from the copied Markdown before DB-first reads begin.
    const seeded = JSON.parse(execFileSync(process.execPath, [path.join(repo, "tools/perf/index-sync.mjs"), "--target", root, "--store", "sqlite", "--with-content", "--json"],
      { cwd: repo, env: { ...process.env, AIDN_STATE_MODE: "", AIDN_INDEX_STORE_MODE: "" }, encoding: "utf8", stdio: "pipe", timeout: 180000, windowsHide: true, maxBuffer: 8388608 }));
    assert.equal(seeded.dry_run, false); assert.ok(seeded.summary.artifacts_count > 0);
    const store = createProjectArtifactStore({ targetRoot: root, existingOnly: true });
    try {
      for (const [relative, kind, family] of [["sessions/TEMPLATE_SESSION_SXXX.md", "template", "normative"], ["RUNTIME-STATE.md", "runtime_state", "derived"]]) {
        const content = fs.readFileSync(path.join(root, "docs/audit", relative), "utf8");
        store.upsertArtifact({ path: relative, kind, family, content_format: "utf8", content, canonical_format: "markdown-canonical-v1",
          canonical: buildCanonicalFromMarkdown(content, { relativePath: relative, classification: { kind, family } }) });
      }
    }
    finally { store.close(); }
  }
  git(root, "init", "-b", "dev"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  prepareActivationFixture(root, repo); git(root, "add", "."); git(root, "commit", "-m", "fixture");
  assert.ok(createStandardWorkflowArtifacts({ targetRoot: root }).read("sessions/TEMPLATE_SESSION_SXXX.md", { required: true }).content.includes("session_objective:"), "current template must be canonical in the fixture");
  return root;
}

// Coherent empty project, installed by the actual source installer. Only Codex
// discovery/login is stubbed: no native executor or model is invoked here.
// This is source-install qualification, not an exact-archive qualification.
export function createFreshStandardWorkflowFixture(mode = "db-only", owned = [], { absentOptionalDocuments = [] } = {}) {
  if (!["files", "dual", "db-only"].includes(mode)) throw Error("FIXTURE_STATE_MODE_INVALID");
  if (!Array.isArray(absentOptionalDocuments) || absentOptionalDocuments.some(name => !["baseline/history.md", "index.md"].includes(name))
    || new Set(absentOptionalDocuments).size !== absentOptionalDocuments.length) throw Error("FIXTURE_OPTIONAL_DOCUMENT_INVALID");
  const root = fs.mkdtempSync(path.join(temporary, "aidn-standard-fresh-")); owned.push(root);
  git(root, "init", "-b", "dev"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "-c", "core.hooksPath=NUL", "commit", "--allow-empty", "-m", "fixture seed");
  const bin = path.join(root, ".fixture-bin"); fs.mkdirSync(bin);
  if (process.platform === "win32") fs.writeFileSync(path.join(bin, "codex.cmd"), '@echo off\r\nif "%1"=="login" if "%2"=="status" echo Logged in\r\nexit /b 0\r\n');
  else { const file = path.join(bin, "codex"); fs.writeFileSync(file, '#!/usr/bin/env sh\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in"; fi\nexit 0\n'); fs.chmodSync(file, 0o755); }
  const store = { files: "file", dual: "dual-sqlite", "db-only": "sqlite" }[mode];
  execFileSync(process.execPath, [path.join(repo, "tools/install.mjs"), "--target", root, "--pack", "core", "--init-defaults", "--project-name", "component-fixture",
    "--source-branch", "dev", "--artifact-import-store", store, "--runtime-persistence-backend", "sqlite", "--no-codex-migrate-custom",
    ...(absentOptionalDocuments.length ? ["--skip-artifact-import"] : [])],
    { cwd: repo, env: { ...process.env, PATH: bin + path.delimiter + (process.env.PATH ?? "") }, encoding: "utf8", stdio: "pipe", timeout: 180000, windowsHide: true, maxBuffer: 8388608 });
  if (absentOptionalDocuments.length) {
    // Build the new corpus before its FIRST canonical import and fixture commit.
    // No referenced artifact, runtime head or historical record is deleted.
    assert.ok(fs.realpathSync(root).startsWith(temporary + path.sep));
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
    if (mode !== "files" && fs.existsSync(resolveRuntimeSqliteFile({ targetRoot: root })))
      for (const name of absentOptionalDocuments) assert.equal(artifacts.read(name).sha256, null);
    for (const name of absentOptionalDocuments) {
      const file = path.join(root, "docs/audit", name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    const config = JSON.parse(fs.readFileSync(path.join(root, ".aidn/config.json"), "utf8"));
    const imported = runArtifactImport(repo, root, false, { artifactImportStore: store }, config);
    assert.equal(imported.ok, true, JSON.stringify(imported));
    for (const name of absentOptionalDocuments) assert.equal(artifacts.read(name).sha256, null);
  }
  prepareActivationFixture(root, repo);
  git(root, "add", "."); git(root, "-c", "core.hooksPath=NUL", "commit", "-m", "installed fixture");
  assert.equal(createStandardWorkflowArtifacts({ targetRoot: root }).describe().state_mode, mode);
  assert.equal(createStandardWorkflowArtifacts({ targetRoot: root }).describe().backend, "sqlite");
  return root;
}
