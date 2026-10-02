#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { redactDiagnostic } from "../verify/git-worktree-state-lib.mjs";

const value = (flag, fallback) => { const index = process.argv.indexOf(flag); return index < 0 ? fallback : path.resolve(process.argv[index + 1] ?? ""); };
for (let index = 2; index < process.argv.length; index += 2) {
  if (!["--package-root", "--baseline-package-root"].includes(process.argv[index]) || !process.argv[index + 1]
    || process.argv[index + 1].startsWith("--")) throw new Error("Unsupported or incomplete verifier arguments");
}
const packageRoot = value("--package-root", path.resolve(import.meta.dirname, "../.."));
const baselineRoot = value("--baseline-package-root", packageRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-client-adoption-install-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = { status: "FAIL", proof_class: "fixture", checks: [], modes: [], native_qualification: "UNAVAILABLE", package: {} };
let stage = "prepare";
const check = (name, observed) => { output.checks.push({ name, pass: Boolean(observed) }); assert(observed, name); };
function snapshot(root) {
  const entries = [];
  const visit = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name), relative = path.relative(root, file);
    if (entry.isDirectory()) { entries.push([relative, "directory"]); visit(file); }
    else entries.push([relative, entry.isSymbolicLink() ? fs.readlinkSync(file) : hash(fs.readFileSync(file))]);
  }}; visit(root); return hash(JSON.stringify(entries.sort()));
}
function cli(root, target, args, env) {
  const child = spawnSync(process.execPath, [path.join(root, "bin/aidn.mjs"), ...args, "--target", target, "--json"], {
    cwd: target, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  if (child.status !== 0) throw Object.assign(new Error("candidate CLI failed"), { diagnostic: {
    exit_code: child.status, signal: child.signal, error_code: child.error?.code ?? null,
    stdout_tail: redactDiagnostic(child.stdout ?? "").slice(-1500), stderr_tail: redactDiagnostic(child.stderr ?? "").slice(-1500) } });
  return JSON.parse(child.stdout);
}
try {
  output.package = { version: fs.readFileSync(path.join(packageRoot, "VERSION"), "utf8").trim(), entry_sha256: hash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"))) };
  const candidate = await import(pathToFileURL(path.join(packageRoot, "src/application/install/installation-service.mjs")));
  const baseline = await import(pathToFileURL(path.join(baselineRoot, "src/application/install/installation-service.mjs")));
  const declaration = JSON.parse(fs.readFileSync(path.join(packageRoot, "package/governance/gfd-adoption.v1.json")));
  const client = { ...structuredClone(declaration), adoptionId: "synthetic-client-adoption", scope: "installed-project",
    authorities: [{ id: "client-spec", reference: "docs/audit/SPEC.md", role: "specification", scope: "Synthetic client only",
      owner: "project_owner", status: "effective", effectiveFrom: "2026-10-02" }],
    sections: [{ id: "5", disposition: "adapted", rationale: "Client's own policy remains canonical", responsibility: "project_owner reviews external conflicts",
      authorities: ["client-spec"], controls: [] }],
    extensions: { clientPolicy: { unicode: "donnée 😀", obligations: ["retain external contract", { independentAuthority: true }] } } };
  client.acceptance.decisionRef = "docs/audit/decisions/client-adoption.md";
  const prior = structuredClone(client);
  client.revision = 2; client.history = [{ adoptionId: client.adoptionId, revision: 1, reference: ".aidn/project/adoption-history/revision-1.json", sha256: hash(JSON.stringify(prior)) }];
  for (const mode of ["files", "dual", "db-only"]) {
    stage = mode;
    const target = path.join(temp, mode); fs.mkdirSync(path.join(target, ".aidn/project"), { recursive: true });
    const adapterFile = path.join(target, ".aidn/project/workflow.adapter.json");
    fs.writeFileSync(adapterFile, JSON.stringify({ version: 1, projectName: "synthetic client", preferredStateMode: mode,
      defaultIndexStore: mode === "files" ? "file" : "sqlite", governanceAdoption: client,
      legacyPreserved: { importedSections: ["## Local Fast Path Override\n\nExternal policy conflict requires owner arbitration."] } }));
    fs.writeFileSync(path.join(target, ".aidn/config.json"), JSON.stringify({ version: 1, runtime: { stateMode: mode, indexStoreMode: mode === "files" ? "file" : "sqlite" } }));
    fs.mkdirSync(path.join(target, ".aidn/project/adoption-history"));
    fs.writeFileSync(path.join(target, client.history[0].reference), JSON.stringify(prior));
    fs.writeFileSync(path.join(target, "AGENTS.md"), "# Client instructions\n\nKeep this independent client authority outside the AIDN block.\n");
    let adapterBefore = fs.readFileSync(adapterFile);
    const historyBefore = fs.readFileSync(path.join(target, client.history[0].reference));
    const args = { pack: "core", sourceBranch: "dev", skipArtifactImport: true, codexMigrateCustom: false };
    const plan = (service, root, action = "install") => service.planInstallation({ repoRoot: root, targetRoot: target, args, action });
    const apply = async (service, root, action = "install") => {
      const preview = await plan(service, root, action); assert(preview.ok, preview.errors.join("; "));
      const applied = await service.executeInstallation({ repoRoot: root, targetRoot: target, args, action, dryRun: false, expectedPlanId: preview.plan_id });
      assert(applied.ok, applied.errors.join("; ")); return applied;
    };
    const before = snapshot(target), preview = await plan(baseline, baselineRoot);
    check(`${mode}_new_install_preview_read_only`, preview.ok && snapshot(target) === before);
    check(`${mode}_adoption_alone_does_not_activate`, !fs.existsSync(path.join(target, ".aidn/install/authorization.json")));
    await apply(baseline, baselineRoot);
    check(`${mode}_new_install_preserves_exact_adapter`, fs.readFileSync(adapterFile).equals(adapterBefore));
    check(`${mode}_new_install_preserves_client_extension`, fs.readFileSync(path.join(target, "docs/audit/WORKFLOW.md"), "utf8").includes("External policy conflict requires owner arbitration"));
    // A legitimate owner-maintained adapter update requires new derived docs.
    // This makes rollback exercise a real generation rather than a no-op repeat.
    const updatedAdapter = JSON.parse(adapterBefore); updatedAdapter.projectName = "updated synthetic client";
    fs.writeFileSync(adapterFile, JSON.stringify(updatedAdapter)); adapterBefore = fs.readFileSync(adapterFile);
    const workflowBeforeUpgrade = fs.readFileSync(path.join(target, "docs/audit/WORKFLOW.md"));
    const beforeUpgrade = snapshot(target), upgradePreview = await plan(candidate, packageRoot);
    check(`${mode}_candidate_upgrade_preview_read_only`, upgradePreview.ok && snapshot(target) === beforeUpgrade);
    const owned = path.join(target, ".codex/hooks/aidn-hook-runtime.mjs"), ownedBefore = fs.readFileSync(owned);
    fs.appendFileSync(owned, "\n// Synthetic divergent managed file\n");
    const divergent = snapshot(target), conflict = await plan(candidate, packageRoot);
    check(`${mode}_divergent_managed_file_conflict`, !conflict.ok && conflict.errors.some((error) => error.includes("MODIFIED_MANAGED_ASSET")) && snapshot(target) === divergent);
    fs.writeFileSync(owned, ownedBefore);
    await apply(candidate, packageRoot);
    check(`${mode}_candidate_renders_updated_generation`, fs.readFileSync(path.join(target, "docs/audit/WORKFLOW.md"), "utf8").includes("project_name: updated synthetic client"));
    check(`${mode}_upgrade_preserves_adoption_extensions_history`, fs.readFileSync(adapterFile).equals(adapterBefore)
      && fs.readFileSync(path.join(target, client.history[0].reference)).equals(historyBefore));
    check(`${mode}_upgrade_preserves_outside_block_authority`, fs.readFileSync(path.join(target, "AGENTS.md"), "utf8").startsWith("# Client instructions\n\nKeep this independent client authority"));
    const env = { AIDN_STATE_MODE: mode, AIDN_INDEX_STORE_MODE: mode === "files" ? "file" : "sqlite" };
    const beforeDiagnostic = snapshot(target), diagnostic = cli(packageRoot, target, ["runtime", "governance-diagnostics"], env);
    check(`${mode}_candidate_cli_separates_client_source`, diagnostic.governance_adoption.client.adoption_id === client.adoptionId && diagnostic.governance_adoption.source_inheritance === false);
    check(`${mode}_candidate_diagnostic_read_only`, snapshot(target) === beforeDiagnostic);
    const beforeRepeat = snapshot(target); await apply(candidate, packageRoot);
    check(`${mode}_candidate_reinstall_idempotent`, snapshot(target) === beforeRepeat);
    const beforeRollbackPreview = snapshot(target), rollbackPreview = await plan(candidate, packageRoot, "rollback");
    check(`${mode}_rollback_preview_read_only`, rollbackPreview.ok && snapshot(target) === beforeRollbackPreview);
    await apply(candidate, packageRoot, "rollback");
    check(`${mode}_rollback_restores_exact_owned_generation`, fs.readFileSync(path.join(target, "docs/audit/WORKFLOW.md")).equals(workflowBeforeUpgrade));
    check(`${mode}_rollback_keeps_client_adoption_and_history`, fs.readFileSync(adapterFile).equals(adapterBefore)
      && fs.readFileSync(path.join(target, client.history[0].reference)).equals(historyBefore));
    check(`${mode}_rollback_keeps_outside_block_authority`, fs.readFileSync(path.join(target, "AGENTS.md"), "utf8").startsWith("# Client instructions"));
    output.modes.push({ mode, install: "PASS", upgrade: baselineRoot === packageRoot ? "same-package reinstall PASS" : "same-version candidate update PASS",
      rollback: "PASS", adoption_sha256: hash(adapterBefore), history_sha256: hash(historyBefore) });
  }
  output.status = "PASS";
} catch (error) { output.failure = { stage, message: redactDiagnostic(error.message), ...(error.diagnostic ? { child: error.diagnostic } : {}) }; }
finally { const cleanup = removePathWithRetry(temp); output.cleanup = { ok: cleanup.ok }; if (!cleanup.ok) output.status = "FAIL"; }
console.log(JSON.stringify(output, null, 2));
if (output.status !== "PASS") process.exitCode = 1;
