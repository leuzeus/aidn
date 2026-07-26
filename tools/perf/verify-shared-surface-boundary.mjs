#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  NON_SHARED_PROJECT_SURFACES,
  SHARED_COORDINATION_METHOD_TABLE,
  SHARED_COORDINATION_TABLES,
} from "../../src/core/ports/shared-coordination-store-port.mjs";
import { listSourceOfTruthPolicies } from "../../src/core/source-of-truth/source-of-truth-policy.mjs";

const EXPECTED_SHARED_CANDIDATES = [
  ".aidn/project/shared-runtime.locator.json as an opt-in locator only",
  "explicit `sqlite-file` shared projection root",
  "PostgreSQL shared coordination tables:",
  ...SHARED_COORDINATION_TABLES,
];

function normalizeSurfaceLine(value) {
  return String(value ?? "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-shared-surface-boundary.mjs");
  console.log("  node tools/perf/verify-shared-surface-boundary.mjs --json");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractSectionBulletLines(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      out.push(match[1].trim());
    }
  }
  return out;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const matrixPath = path.join(repoRoot, "docs", "RUNTIME_SURFACE_SCOPE_MATRIX.md");
    const adrPath = path.join(repoRoot, "docs", "ADR", "ADR-0007-local-first-federation-boundary.md");
    const adr8Path = path.join(repoRoot, "docs", "ADR", "ADR-0008-shared-coordination-ports.md");
    const matrixText = readText(matrixPath);
    const adrText = readText(adrPath);
    const adr8Text = readText(adr8Path);
    const agentPolicyText = readText(path.join(repoRoot, "docs", "agents", "05-local-first-shared-runtime.md"));
    const sharedCandidateLines = extractSectionBulletLines(
      matrixText,
      "Explicit Shared-Candidate List",
    ).map(normalizeSurfaceLine);
    const nonShareLines = extractSectionBulletLines(
      matrixText,
      "Explicit Non-Share List",
    ).map(normalizeSurfaceLine);
    const expectedSharedCandidates = EXPECTED_SHARED_CANDIDATES.map(normalizeSurfaceLine);
    const expectedNonShare = NON_SHARED_PROJECT_SURFACES.map(normalizeSurfaceLine);

    const missingRequiredShared = expectedSharedCandidates.filter((entry) => !sharedCandidateLines.includes(entry));
    const unexpectedShared = sharedCandidateLines.filter((entry) => !expectedSharedCandidates.includes(entry));
    const missingNonShare = expectedNonShare.filter((entry) => !nonShareLines.includes(entry));
    const unexpectedNonShare = nonShareLines.filter((entry) => !expectedNonShare.includes(entry));
    const missingBoundaryReminder = !matrixText.includes("Any future shared surface must update this matrix, ADR-0007, CLI status output contracts and fixture coverage before it is treated as stable.");
    const missingPortContractReminder = !matrixText.includes("Shared coordination access is expected to pass through the port contract described in `docs/ADR/ADR-0008-shared-coordination-ports.md` before any new shared behavior is considered stable.");
    const adrMentionsOptIn = /opt-in/i.test(adrText) && /local-first/i.test(adrText);
    const adrMentionsNoDocsAuditSharing = /docs\/audit/i.test(adrText) || /checkout-bound/i.test(adrText);
    const adr8MentionsPorts = /shared coordination ports/i.test(adr8Text) && /src\/core\/ports/i.test(adr8Text);
    const adr8MentionsLocalFirst = /local-first/i.test(adr8Text) && /shared runtime/i.test(adr8Text);
    const docsWithBoundaries = [
      ["matrix", matrixText],
      ["agent-policy", agentPolicyText],
      ["ADR-0007", adrText],
      ["ADR-0008", adr8Text],
    ];
    const missingDocumentedBoundaries = docsWithBoundaries.flatMap(([name, text]) => (
      NON_SHARED_PROJECT_SURFACES
        .filter((surface) => !text.includes(surface))
        .map((surface) => `${name}:${surface}`)
    ));
    const methodTables = Object.values(SHARED_COORDINATION_METHOD_TABLE);
    const missingPortTables = SHARED_COORDINATION_TABLES.filter(
      (table) => !methodTables.includes(table),
    );
    const unexpectedPortTables = methodTables.filter(
      (table) => !SHARED_COORDINATION_TABLES.includes(table),
    );
    const sourcePolicies = listSourceOfTruthPolicies();
    const sourcePolicyIssues = [];
    for (const policy of sourcePolicies) {
      const sharedRuntime = String(policy.shared_runtime ?? "");
      if (["repair_findings", "incident"].includes(policy.concept)
        && sharedRuntime !== "not_shared") {
        sourcePolicyIssues.push(`${policy.concept}: must remain not_shared`);
      }
      if (sharedRuntime !== "not_shared"
        && !SHARED_COORDINATION_TABLES.some((table) => sharedRuntime.includes(table))) {
        sourcePolicyIssues.push(
          `${policy.concept}: shared_runtime does not map to a port table: ${sharedRuntime}`,
        );
      }
    }
    const conservativeBoundaryStated = docsWithBoundaries.every(
      ([, text]) => text.includes("repair_findings")
        && text.includes("incident")
        && /not shared|not_shared/.test(text),
    );

    const checks = {
      matrix_has_expected_shared_candidates: missingRequiredShared.length === 0 && unexpectedShared.length === 0,
      matrix_has_required_non_share_list: missingNonShare.length === 0 && unexpectedNonShare.length === 0,
      all_boundary_documents_match_non_share_port: missingDocumentedBoundaries.length === 0,
      shared_port_tables_are_closed: missingPortTables.length === 0 && unexpectedPortTables.length === 0,
      source_of_truth_shared_policies_map_to_port: sourcePolicyIssues.length === 0,
      repair_and_incident_are_explicitly_not_shared: conservativeBoundaryStated,
      matrix_has_boundary_reminder: !missingBoundaryReminder,
      matrix_has_port_contract_reminder: !missingPortContractReminder,
      adr_mentions_local_first_opt_in: adrMentionsOptIn,
      adr_mentions_checkout_bound_but_not_share: adrMentionsNoDocsAuditSharing,
      adr8_mentions_shared_ports: adr8MentionsPorts,
      adr8_mentions_local_first_runtime_boundary: adr8MentionsLocalFirst,
    };

    const issues = [];
    if (missingRequiredShared.length > 0) {
      issues.push(`missing shared-candidate entries: ${missingRequiredShared.join(", ")}`);
    }
    if (unexpectedShared.length > 0) {
      issues.push(`unexpected shared-candidate entries: ${unexpectedShared.join(", ")}`);
    }
    if (missingNonShare.length > 0) {
      issues.push(`missing non-share list entries: ${missingNonShare.join(", ")}`);
    }
    if (unexpectedNonShare.length > 0) {
      issues.push(`unexpected non-share list entries: ${unexpectedNonShare.join(", ")}`);
    }
    if (missingDocumentedBoundaries.length > 0) {
      issues.push(`boundary docs missing port-defined non-share entries: ${missingDocumentedBoundaries.join(", ")}`);
    }
    if (missingPortTables.length > 0 || unexpectedPortTables.length > 0) {
      issues.push(
        `shared port/table closure mismatch: missing=${missingPortTables.join(",")} `
        + `unexpected=${unexpectedPortTables.join(",")}`,
      );
    }
    issues.push(...sourcePolicyIssues);
    if (!conservativeBoundaryStated) {
      issues.push("repair_findings and incident must be explicitly not shared in every boundary document");
    }
    if (missingBoundaryReminder) {
      issues.push("missing future shared-surface reminder in matrix");
    }
    if (missingPortContractReminder) {
      issues.push("missing ADR-0008 port-contract reminder in matrix");
    }
    if (!adrMentionsOptIn) {
      issues.push("ADR-0007 does not clearly mention local-first opt-in boundary");
    }
    if (!adrMentionsNoDocsAuditSharing) {
      issues.push("ADR-0007 does not mention checkout-bound or docs/audit boundary language");
    }
    if (!adr8MentionsPorts) {
      issues.push("ADR-0008 does not clearly mention shared coordination ports and src/core/ports");
    }
    if (!adr8MentionsLocalFirst) {
      issues.push("ADR-0008 does not clearly mention the local-first shared runtime boundary");
    }

    const output = {
      ok: issues.length === 0,
      checks,
      matrix_path: matrixPath,
      adr_path: adrPath,
      adr8_path: adr8Path,
      shared_candidate_lines: sharedCandidateLines,
      non_share_lines: nonShareLines,
      shared_port_tables: SHARED_COORDINATION_TABLES,
      issues,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Shared surface boundary: ${output.ok ? "PASS" : "FAIL"}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      for (const issue of issues) {
        console.log(`- ${issue}`);
      }
    }

    if (!output.ok) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
