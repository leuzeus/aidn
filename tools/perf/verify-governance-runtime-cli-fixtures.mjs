#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(args) {
  const stdout = execFileSync(process.execPath, [path.resolve(process.cwd(), "bin/aidn.mjs"), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

function runNodeJson(script, args = []) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

function main() {
  try {
    const targetRoot = "tests/fixtures/repo-installed-core";
    const runtimeDiagnostics = runJson(["runtime", "governance-diagnostics", "--target", targetRoot, "--json"]);
    const perfDiagnostics = runNodeJson(path.resolve(process.cwd(), "tools/perf/verify-governance-completeness.mjs"), ["--json"]);

    assert(runtimeDiagnostics.governed_concepts === perfDiagnostics.governed_concepts, "runtime governance diagnostics should match governed concept count");
    assert(runtimeDiagnostics.summary.complete === perfDiagnostics.summary.complete, "runtime governance diagnostics should match completeness summary");
    assert(runtimeDiagnostics.operations?.local_first === true, "runtime governance diagnostics should expose local-first operations");
    assert(typeof runtimeDiagnostics.workspace?.project_id === "string" && runtimeDiagnostics.workspace.project_id.length > 0, "runtime governance diagnostics should expose target workspace identity");
    assert(typeof runtimeDiagnostics.workspace?.workspace_id === "string" && runtimeDiagnostics.workspace.workspace_id.length > 0, "runtime governance diagnostics should expose workspace id");
    assert(Array.isArray(runtimeDiagnostics.concepts) && runtimeDiagnostics.concepts.length >= 1, "runtime governance diagnostics should expose concept details");
    assert(Array.isArray(runtimeDiagnostics.coverage_exceptions) && runtimeDiagnostics.coverage_exceptions.length >= 1, "runtime governance diagnostics should expose residual coverage exceptions");
    assert(Array.isArray(runtimeDiagnostics.runtime_surfaces) && runtimeDiagnostics.runtime_surfaces.length >= 1, "runtime governance diagnostics should expose runtime surface details");
    assert(typeof runtimeDiagnostics.runtime_surface_summary?.covered === "number", "runtime governance diagnostics should expose runtime surface summary");
    assert(typeof runtimeDiagnostics.operations?.runtime_surface_coverage_status === "string", "runtime governance diagnostics should expose runtime surface coverage status");
    assert(typeof runtimeDiagnostics.operations?.projection_freshness_status === "string", "runtime governance diagnostics should expose projection freshness status");
    assert(typeof runtimeDiagnostics.operations?.no_write_coverage_status === "string", "runtime governance diagnostics should expose no-write coverage status");
    assert(runtimeDiagnostics.operations?.residual_concept_coverage_status === "documented", "runtime governance diagnostics should expose residual concept coverage status");
    assert(runtimeDiagnostics.runtime_surfaces.some((item) => item.id === "runtime-governance-diagnostics"), "runtime governance diagnostics should include its own public surface");
    assert(Array.isArray(runtimeDiagnostics.observed_artifacts) && runtimeDiagnostics.observed_artifacts.length >= 1, "runtime governance diagnostics should expose observed artifacts");
    assert(runtimeDiagnostics.observed_artifact_summary?.complete === 6, "runtime governance diagnostics should report complete observed artifacts for the tracked fixture");
    assert(runtimeDiagnostics.observed_artifact_summary?.partial === 0, "runtime governance diagnostics should not keep partial observed artifacts for the tracked fixture");
    assert(typeof runtimeDiagnostics.operations?.observed_artifact_coverage_status === "string", "runtime governance diagnostics should expose observed artifact coverage status");
    assert(runtimeDiagnostics.operations?.observed_artifact_coverage_status === "covered", "runtime governance diagnostics should expose covered observed artifact status");
    assert(runtimeDiagnostics.observed_artifacts.some((item) => item.id === "coordination_summary"), "runtime governance diagnostics should include coordination summary artifact");
    assert(runtimeDiagnostics.observed_artifacts.some((item) => item.id === "coordination_log"), "runtime governance diagnostics should include coordination log artifact");
    assert(runtimeDiagnostics.observed_artifacts.some((item) => item.id === "user_arbitration"), "runtime governance diagnostics should include user arbitration artifact");
    assert(runtimeDiagnostics.observed_artifacts.some((item) => item.id === "handoff_packet"), "runtime governance diagnostics should include handoff packet artifact");
    assert(runtimeDiagnostics.registry?.observed_artifacts_included === true, "runtime governance diagnostics should include observed artifact inspection");
    assert(perfDiagnostics.registry?.observed_artifacts_included === false, "perf completeness should stay registry-only");
    assert(Array.isArray(runtimeDiagnostics.issues), "runtime governance diagnostics should expose issues");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
