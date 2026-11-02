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


const repo = fileURLToPath(new URL("../../", import.meta.url));
const temporary = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
export function createStandardWorkflowFixture(mode = "files", owned = []) {
  const root = fs.mkdtempSync(path.join(temporary, "aidn-standard-ports-")); owned.push(root);
  const source = path.join(repo, "tests/fixtures/repo-installed-core");
  fs.cpSync(source, root, { recursive: true, filter: name => isActivationFixtureSource(source, name) });
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
