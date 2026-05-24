#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const EXPECTED_SHARED_CANDIDATES = [
  ".aidn/project/shared-runtime.locator.json as an opt-in locator only",
  "explicit `sqlite-file` shared projection root",
  "PostgreSQL shared coordination tables:",
  "workspace_registry",
  "worktree_registry",
  "planning_states",
  "handoff_relays",
  "coordination_records",
];

const REQUIRED_NON_SHARE_LIST = [
  "docs/audit/*",
  "AGENTS.md",
  ".codex/*",
  ".aidn/config.json",
  ".aidn/runtime/index/workflow-index.sqlite",
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

function extractSharedCandidateLines(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Explicit Shared-Candidate List");
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
    const sharedCandidateLines = extractSharedCandidateLines(matrixText).map(normalizeSurfaceLine);
    const expectedSharedCandidates = EXPECTED_SHARED_CANDIDATES.map(normalizeSurfaceLine);

    const missingRequiredShared = expectedSharedCandidates.filter((entry) => !sharedCandidateLines.includes(entry));
    const unexpectedShared = sharedCandidateLines.filter((entry) => !expectedSharedCandidates.includes(entry));
    const missingNonShare = REQUIRED_NON_SHARE_LIST.filter((entry) => !matrixText.includes(entry));
    const missingBoundaryReminder = !matrixText.includes("Any future shared surface must update this matrix, ADR-0007, CLI status output contracts and fixture coverage before it is treated as stable.");
    const missingPortContractReminder = !matrixText.includes("Shared coordination access is expected to pass through the port contract described in `docs/ADR/ADR-0008-shared-coordination-ports.md` before any new shared behavior is considered stable.");
    const adrMentionsOptIn = /opt-in/i.test(adrText) && /local-first/i.test(adrText);
    const adrMentionsNoDocsAuditSharing = /docs\/audit/i.test(adrText) || /checkout-bound/i.test(adrText);
    const adr8MentionsPorts = /shared coordination ports/i.test(adr8Text) && /src\/core\/ports/i.test(adr8Text);
    const adr8MentionsLocalFirst = /local-first/i.test(adr8Text) && /shared runtime/i.test(adr8Text);

    const checks = {
      matrix_has_expected_shared_candidates: missingRequiredShared.length === 0 && unexpectedShared.length === 0,
      matrix_has_required_non_share_list: missingNonShare.length === 0,
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
