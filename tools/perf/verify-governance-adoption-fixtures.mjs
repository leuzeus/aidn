#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateGovernanceAdoption, isGovernanceAdoptionEffective } from "../../src/core/governance/adoption-policy.mjs";
import { createDefaultWorkflowAdapterConfig, normalizeWorkflowAdapterConfig, readWorkflowAdapterConfig, writeWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { redactDiagnostic } from "../verify/git-worktree-state-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const sourceFile = path.join(repoRoot, "package/governance/gfd-adoption.v1.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function verifyGovernanceAdoptionFixtures() {
  const checks = [];
  let stage = "source-declaration";
  let tempRoot;
  let cleanup;
  const output = { status: "FAIL", checks, native_client_qualification: "UNAVAILABLE" };
  const check = (name, observed, expected = true) => {
    const pass = JSON.stringify(observed) === JSON.stringify(expected);
    checks.push({ name, expected, observed, pass });
    assert(pass, name);
  };
  function cli(targetRoot, args, expectedStatus = 0, env = {}) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "tools/project/config.mjs"), "--target", targetRoot, ...args, "--json"], {
      cwd: repoRoot, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    if (result.status !== expectedStatus) {
      const error = new Error("project config fixture child failed");
      error.diagnostic = { exit_code: result.status, signal: result.signal, error_code: result.error?.code ?? null,
        stdout_tail: redactDiagnostic(result.stdout ?? "").slice(-2000), stderr_tail: redactDiagnostic(result.stderr ?? "").slice(-2000) };
      throw error;
    }
    return expectedStatus === 0 ? JSON.parse(result.stdout) : result;
  }
  try {
    const sourceBytes = fs.readFileSync(sourceFile);
    const source = JSON.parse(sourceBytes);
    output.source_declaration_sha256 = hash(sourceBytes);
    check("source_declaration_valid", validateGovernanceAdoption(source, { expectedScope: "package-source" }).ok);
    check("source_declaration_effective", isGovernanceAdoptionEffective(source, { asOf: "2026-10-02", expectedScope: "package-source" }));
    check("all_method_sections_explicit", source.sections.map((section) => section.id).sort(),
      [...Array.from({ length: 15 }, (_, index) => String(index + 1)), "7.1"].sort());
    check("source_authorities_resolve", source.authorities.every((authority) => fs.existsSync(path.join(repoRoot, authority.reference))));
    check("source_controls_resolve", source.sections.every((section) => section.controls.every((reference) => fs.existsSync(path.join(repoRoot, reference)))));
    check("source_rows_have_responsibility", source.sections.every((section) => section.responsibility.length > 0));

    stage = "client-normalization";
    const client = structuredClone(source);
    client.scope = "installed-project";
    client.adoptionId = "synthetic-project-gfd";
    client.acceptance.decisionRef = "docs/audit/decisions/gfd-adoption.md";
    client.authorities = [{ id: "project-spec", reference: "docs/audit/SPEC.md", role: "specification", scope: "synthetic installed project",
      owner: "project_owner", status: "effective", effectiveFrom: "2026-10-02" }];
    client.sections = [{ id: "5", disposition: "adapted", rationale: "Synthetic client binds its own canonical specification; no source inheritance.",
      authorities: ["project-spec"], controls: [], responsibility: "project_owner verifies actual client obligations." }];
    client.extensions = { localPolicy: { retained: ["synthetic constraint", { value: 7 }], unicode: "donnée" } };
    check("legacy_default_has_no_adoption", !Object.hasOwn(createDefaultWorkflowAdapterConfig(), "governanceAdoption"));
    check("source_not_inherited_from_defaults", !Object.hasOwn(normalizeWorkflowAdapterConfig({}, { governanceAdoption: client }), "governanceAdoption"));
    check("normalization_preserves_client_record", normalizeWorkflowAdapterConfig({ governanceAdoption: client }).governanceAdoption, client);
    const proposed = { ...structuredClone(client), status: "proposed", acceptance: null };
    check("proposed_record_preserved", normalizeWorkflowAdapterConfig({ governanceAdoption: proposed }).governanceAdoption, proposed);
    check("detection_does_not_accept_proposal", isGovernanceAdoptionEffective(proposed, { asOf: "2026-10-02" }), false);
    check("future_acceptance_not_effective", isGovernanceAdoptionEffective({ ...client, acceptance: { ...client.acceptance, effectiveFrom: "2026-11-01" } }, { asOf: "2026-10-02" }), false);
    check("date_required_for_effective_claim", isGovernanceAdoptionEffective(client), false);
    const withdrawal = { ...structuredClone(client), revision: 2, status: "revoked",
      history: [{ adoptionId: client.adoptionId, revision: 1, reference: "git:preserved-synthetic-record", sha256: hash(JSON.stringify(client)) }],
      changeDecision: { authority: "project_owner", reference: "docs/audit/decisions/withdraw-gfd.md", recordedAt: "2026-10-02" } };
    check("withdrawal_history_preserved", normalizeWorkflowAdapterConfig({ governanceAdoption: withdrawal }).governanceAdoption, withdrawal);
    check("revoked_adoption_not_effective", isGovernanceAdoptionEffective(withdrawal, { asOf: "2026-10-02" }), false);
    const invalid = [
      { ...client, schemaVersion: 2 }, { ...client, status: undefined }, { ...client, acceptance: null },
      { ...client, owner: "" }, { ...client, method: { ...client.method, commit: "main" } },
      { ...client, recordedAt: "2026-02-30" }, { ...client, extra: "must not be silently lost" },
      { ...client, sections: [{ ...client.sections[0], authorities: ["unknown"] }] },
      { ...client, sections: [{ ...client.sections[0], authorities: "project-spec" }] },
      { ...client, authorities: [{ ...client.authorities[0], status: "proposed" }] },
      { ...client, revision: 2, history: [] }, { ...client, status: "superseded" }, source,
    ];
    for (const [index, record] of invalid.entries()) {
      check(`invalid_${index}_refused_before_normalization`, (() => {
        try { normalizeWorkflowAdapterConfig({ governanceAdoption: record }); return false; } catch { return true; }
      })());
    }

    stage = "preview-write-list";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-adoption-"));
    const adapterSource = path.join(tempRoot, "adapter-source.json");
    fs.writeFileSync(adapterSource, JSON.stringify({ projectName: "synthetic adoption client", governanceAdoption: client }));
    for (const stateMode of ["files", "dual", "db-only"]) {
      const target = path.join(tempRoot, stateMode);
      fs.mkdirSync(target);
      const env = { AIDN_STATE_MODE: stateMode };
      const preview = cli(target, ["--adapter-file", adapterSource], 0, env);
      check(`${stateMode}_preview_retains_record`, preview.config.governanceAdoption, client);
      check(`${stateMode}_preview_does_not_write`, !fs.existsSync(path.join(target, ".aidn")) && preview.written === false);
      check(`${stateMode}_preview_public_contract`, validateJsonSchema(preview, JSON.parse(fs.readFileSync(path.join(repoRoot, "src/core/contracts/cli-output/project-config-preview.v1.schema.json")))).length === 0);
      const written = cli(target, ["--adapter-file", adapterSource, "--write"], 0, env);
      check(`${stateMode}_explicit_write_retains_record`, written.written && readWorkflowAdapterConfig(target).data.governanceAdoption, client);
      const before = fs.readFileSync(readWorkflowAdapterConfig(target).path);
      const listed = cli(target, ["--list"], 0, env);
      check(`${stateMode}_list_retains_record`, listed.config.governanceAdoption, client);
      check(`${stateMode}_list_public_contract`, validateJsonSchema(listed, JSON.parse(fs.readFileSync(path.join(repoRoot, "src/core/contracts/cli-output/project-config-list.v1.schema.json")))).length === 0);
      check(`${stateMode}_list_is_non_mutating`, hash(fs.readFileSync(listed.path)), hash(before));
      try { writeWorkflowAdapterConfig(target, { governanceAdoption: invalid[0] }); } catch { /* expected */ }
      check(`${stateMode}_invalid_write_preserves_previous_bytes`, hash(fs.readFileSync(listed.path)), hash(before));
    }

    stage = "migration-preservation";
    const target = path.join(tempRoot, "migration");
    fs.cpSync(path.join(repoRoot, "tests/fixtures/repo-installed-core"), target, { recursive: true });
    const initialAdapter = readWorkflowAdapterConfig(target);
    writeWorkflowAdapterConfig(target, { ...initialAdapter.data, governanceAdoption: client });
    const beforeMigration = fs.readFileSync(initialAdapter.path);
    const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
    const migrationPreview = cli(target, ["--migrate-adapter", "--version", version]);
    check("migration_preview_retains_adoption", migrationPreview.extracted_config.governanceAdoption, client);
    check("migration_preview_preserves_adapter_bytes", hash(fs.readFileSync(initialAdapter.path)), hash(beforeMigration));
    cli(target, ["--migrate-adapter", "--version", version, "--write"]);
    check("migration_write_preserves_adoption", readWorkflowAdapterConfig(target).data.governanceAdoption, client);
    check("source_declaration_unchanged", hash(fs.readFileSync(sourceFile)), output.source_declaration_sha256);
    output.status = "PASS";
  } catch (error) {
    output.failure = { stage, message: error.message, ...(error.diagnostic ? { child: error.diagnostic } : {}) };
  } finally {
    if (tempRoot) cleanup = removePathWithRetry(tempRoot);
    output.cleanup = { temporary_root_removed: tempRoot ? Boolean(cleanup?.ok && !fs.existsSync(tempRoot)) : true };
    if (!output.cleanup.temporary_root_removed) output.status = "FAIL";
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = verifyGovernanceAdoptionFixtures();
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== "PASS") process.exitCode = 1;
}
