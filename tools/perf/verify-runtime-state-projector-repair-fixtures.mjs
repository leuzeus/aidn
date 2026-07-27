#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const DECISION_FINDING = Object.freeze({
  severity: "warning",
  finding_type: "AMBIGUOUS_RELATION",
  entity_id: "S102",
  message: "Session has multiple candidate cycles: C101, C102.",
});
const DECISION_PRIMARY_REASON = "warning: AMBIGUOUS_RELATION: S102: Session has multiple candidate cycles: C101, C102.";
const REPAIR_PAYLOAD_FINDING = Object.freeze({
  severity: "error",
  finding_type: "UNRESOLVED_PARENT_SESSION",
  entity_id: "S101",
  message: "Session references parent session S100 but no session artifact was indexed.",
});
const REPAIR_PAYLOAD_PRIMARY_REASON = "error: UNRESOLVED_PARENT_SESSION: S101: Session references parent session S100 but no session artifact was indexed.";
const FOREIGN_SCOPE_FINDING = Object.freeze({
  severity: "error",
  finding_type: "FOREIGN_SCOPE_SESSION",
  entity_id: "S999",
  message: "Finding belongs to another requested skill or target scope.",
});

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-state-projector-repair-fixtures.mjs");
}

function runJson(script, args) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function seedHydratedContext(targetRoot, payload) {
  const hydratedFile = path.join(targetRoot, ".aidn", "runtime", "context", "hydrated-context.json");
  writeJson(hydratedFile, payload);
  return hydratedFile;
}

function seedCodexContext(targetRoot, payload) {
  const contextFile = path.join(targetRoot, ".aidn", "runtime", "context", "codex-context.json");
  writeJson(contextFile, payload);
  return contextFile;
}

function verifyScenario(tempRoot, name, payload, expectations, options = {}) {
  const repo = path.join(tempRoot, name);
  fs.cpSync(path.resolve(process.cwd(), "tests/fixtures/repo-installed-core"), repo, { recursive: true });
  seedHydratedContext(repo, payload);
  seedCodexContext(repo, options.contextPayload ?? {
    schema_version: 1,
    target_root: "repo",
    updated_at: "2026-03-09T00:00:00Z",
    latest: {},
  });
  const outFile = path.join(repo, "docs", "audit", "RUNTIME-STATE.md");
  const result = runJson("tools/runtime/project-runtime-state.mjs", [
    "--target",
    repo,
    "--json",
    "--write",
  ]);
  const markdown = fs.readFileSync(outFile, "utf8");
  assert(markdown.includes(`repair_layer_status: ${expectations.status}`), `${name}: status missing`);
  assert(markdown.includes(`repair_layer_advice: ${expectations.advice}`), `${name}: advice missing`);
  assert(markdown.includes(`repair_primary_reason: ${expectations.primaryReason}`), `${name}: primary reason missing`);
  assert(markdown.includes(`repair_routing_hint: ${expectations.routingHint}`), `${name}: routing hint missing`);
  assert(markdown.includes(`repair_routing_reason: ${expectations.routingReason}`), `${name}: routing reason missing`);
  if (expectations.findingLine) {
    assert(markdown.includes(expectations.findingLine), `${name}: finding line missing`);
  }
  if (expectations.noFindingLine) {
    assert(!markdown.includes(expectations.noFindingLine), `${name}: unexpected finding line present`);
  }
  for (const absentText of expectations.absentText ?? []) {
    assert(!markdown.includes(absentText), `${name}: unexpected text present: ${absentText}`);
  }
  assert(result?.digest?.repair_layer_status === expectations.status, `${name}: digest status mismatch`);
  assert(result?.digest?.repair_layer_advice === expectations.advice, `${name}: digest advice mismatch`);
  assert(result?.digest?.repair_primary_reason === expectations.primaryReason, `${name}: digest primary reason mismatch`);
  assert(result?.digest?.repair_routing_hint === expectations.routingHint, `${name}: digest routing hint mismatch`);
  if (expectations.blockingFindingsLength != null) {
    assert(result?.digest?.blocking_findings?.length === expectations.blockingFindingsLength, `${name}: blocking findings length mismatch`);
  }
  if (expectations.blockingLine) {
    assert(markdown.includes(expectations.blockingLine), `${name}: blocking line missing`);
  }
  if (expectations.topFindingLine) {
    assert(
      result?.digest?.blocking_findings?.[0] === expectations.topFindingLine,
      `${name}: digest top finding mismatch`,
    );
  }
  return {
    result,
    markdown,
  };
}

function canonicalDecisionPayload({ decisionTs, repairPayloadTs }) {
  return {
    ts: repairPayloadTs,
    target_root: "repo",
    state_mode: "db-only",
    context_file: ".aidn/runtime/context/codex-context.json",
    requested_skill: "close-session",
    decisions: {
      "close-session": {
        ts: decisionTs,
        repair_layer_status: "warn",
        repair_layer_advice: "Review the canonical close-session decision.",
        repair_primary_reason: DECISION_PRIMARY_REASON,
        repair_layer_top_findings: [DECISION_FINDING],
      },
      "start-session": {
        ts: "2099-01-01T00:00:00Z",
        target: "foreign-repo",
        repair_layer_status: "block",
        repair_layer_advice: "Ignore the foreign session decision.",
        repair_primary_reason: "error: FOREIGN_SCOPE_SESSION: S999: Finding belongs to another requested skill or target scope.",
        repair_layer_top_findings: [FOREIGN_SCOPE_FINDING],
        repair_layer_blocking: true,
      },
    },
    recent_history: [
      {
        ts: "2099-01-01T00:00:01Z",
        skill: "start-session",
        target: "foreign-repo",
        repair_layer_status: "block",
        repair_layer_advice: "Ignore the foreign history entry.",
        repair_layer_top_findings: [FOREIGN_SCOPE_FINDING],
        repair_layer_blocking: true,
      },
    ],
    repair_layer: {
      ts: repairPayloadTs,
      status: "block",
      advice: "Resolve the newer repair-layer payload.",
      blocking: true,
      top_findings: [REPAIR_PAYLOAD_FINDING],
    },
    artifacts: [],
  };
}

function canonicalExpectations() {
  return {
    status: "warn",
    advice: "Review the canonical close-session decision.",
    primaryReason: DECISION_PRIMARY_REASON,
    routingHint: "audit-first",
    routingReason: "Review the canonical close-session decision.",
    findingLine: `- ${DECISION_PRIMARY_REASON}`,
    topFindingLine: DECISION_PRIMARY_REASON,
    absentText: [
      REPAIR_PAYLOAD_PRIMARY_REASON,
      "FOREIGN_SCOPE_SESSION",
    ],
  };
}

function verifyCanonicalDecisionSelection(tempRoot) {
  const timestampCases = [
    {
      name: "canonical-decision-repair-payload-newer",
      decisionTs: "2026-03-09T02:00:00Z",
      repairPayloadTs: "2026-03-09T02:10:00Z",
    },
    {
      name: "canonical-decision-repair-payload-older",
      decisionTs: "2026-03-09T02:10:00Z",
      repairPayloadTs: "2026-03-09T02:00:00Z",
    },
    {
      name: "canonical-decision-equal-timestamps",
      decisionTs: "2026-03-09T02:05:00Z",
      repairPayloadTs: "2026-03-09T02:05:00Z",
    },
  ];
  for (const testCase of timestampCases) {
    verifyScenario(
      tempRoot,
      testCase.name,
      canonicalDecisionPayload(testCase),
      canonicalExpectations(),
    );
  }
}

function verifyFallbackWithoutCanonicalDecision(tempRoot) {
  verifyScenario(tempRoot, "request-scoped-history-fallback", {
    ts: "2026-03-09T03:10:00Z",
    target_root: "repo",
    state_mode: "db-only",
    context_file: ".aidn/runtime/context/codex-context.json",
    requested_skill: "close-session",
    decisions: {
      "close-session": {
        repair_layer_status: "unknown",
        repair_layer_advice: "unknown",
        repair_primary_reason: "unknown",
        repair_layer_top_findings: [],
      },
      "start-session": {
        ts: "2099-01-01T00:00:00Z",
        repair_layer_status: "block",
        repair_layer_advice: "Ignore another requested skill.",
        repair_layer_top_findings: [FOREIGN_SCOPE_FINDING],
        repair_layer_blocking: true,
      },
    },
    recent_history: [
      {
        ts: "2026-03-09T03:00:00Z",
        skill: "close-session",
        target: "repo",
        repair_layer_status: "warn",
        repair_layer_advice: "Review the canonical close-session decision.",
        repair_primary_reason: DECISION_PRIMARY_REASON,
        repair_layer_top_findings: [DECISION_FINDING],
      },
      {
        ts: "2099-01-01T00:00:01Z",
        skill: "close-session",
        target: "foreign-repo",
        repair_layer_status: "block",
        repair_layer_advice: "Ignore another target scope.",
        repair_layer_top_findings: [FOREIGN_SCOPE_FINDING],
        repair_layer_blocking: true,
      },
    ],
    repair_layer: null,
    artifacts: [],
  }, canonicalExpectations(), {
    contextPayload: {
      schema_version: 1,
      target_root: "foreign-repo",
      updated_at: "2099-01-01T00:00:02Z",
      latest: {
        "close-session": {
          ts: "2099-01-01T00:00:02Z",
          skill: "close-session",
          target: "foreign-repo",
          repair_layer_status: "block",
          repair_layer_advice: "Ignore the fallback context from another scope.",
          repair_layer_top_findings: [FOREIGN_SCOPE_FINDING],
          repair_layer_blocking: true,
        },
      },
    },
  });
}

function verifyLatestTimestampMutant(tempRoot) {
  const sourcePath = path.resolve(
    process.cwd(),
    "src/application/runtime/runtime-state-projector-use-case.mjs",
  );
  const metadataPath = path.resolve(
    process.cwd(),
    "src/application/runtime/governed-runtime-artifact-metadata-lib.mjs",
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const canonicalNeedle = [
    "  if (requestedDecision && repairCandidateHasMeaningfulSignal(requestedDecision)) {",
    "    return requestedDecision;",
    "  }",
    "",
  ].join("\n");
  assert(
    source.split(canonicalNeedle).length - 1 === 1,
    "canonical decision selection guard missing or ambiguous",
  );
  const fallbackNeedle = [
    "  return latestRepairCandidate([",
    "    normalizeRepairCandidate(repairLayer, {",
  ].join("\n");
  assert(
    source.split(fallbackNeedle).length - 1 === 1,
    "repair fallback selection guard missing or ambiguous",
  );
  const mutatedSource = source
    .replace(canonicalNeedle, "")
    .replace(
      fallbackNeedle,
      [
        "  return latestRepairCandidate([",
        "    requestedDecision,",
        "    normalizeRepairCandidate(repairLayer, {",
      ].join("\n"),
    )
    .replace(
      'from "./governed-runtime-artifact-metadata-lib.mjs";',
      `from "${pathToFileURL(metadataPath).href}";`,
    );
  assert(mutatedSource !== source, "latest-by-timestamp mutant did not change the source");

  const mutantPath = path.join(tempRoot, "runtime-state-projector-latest-mutant.mjs");
  fs.writeFileSync(mutantPath, mutatedSource, "utf8");
  const probePayload = canonicalDecisionPayload({
    decisionTs: "2026-03-09T02:00:00Z",
    repairPayloadTs: "2026-03-09T02:10:00Z",
  });
  const probe = [
    `import { deriveRuntimeStateRepairSummary } from ${JSON.stringify(pathToFileURL(mutantPath).href)};`,
    `const payload = ${JSON.stringify(probePayload)};`,
    "process.stdout.write(JSON.stringify(deriveRuntimeStateRepairSummary(payload, null)));",
  ].join("\n");
  const mutantSummary = JSON.parse(execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", probe],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ));
  const mutantPassedCanonicalContract = mutantSummary?.primaryReason === DECISION_PRIMARY_REASON
    && mutantSummary?.findings?.[0]?.finding_type === DECISION_FINDING.finding_type;
  assert(
    mutantPassedCanonicalContract === false
      && mutantSummary?.findings?.[0]?.finding_type === REPAIR_PAYLOAD_FINDING.finding_type,
    "latest-by-timestamp mutant was not rejected by canonical decision fixtures",
  );
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-state-repair-"));
    verifyScenario(tempRoot, "warn", {
      ts: "2026-03-09T02:00:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [],
      repair_layer: {
        status: "warn",
        advice: "Review open repair findings, starting with branch_cycle_mismatch.",
        blocking: false,
        top_findings: [
          {
            severity: "warning",
            finding_type: "branch_cycle_mismatch",
            entity_id: "C101",
            message: "Active branch and cycle mapping disagree",
          },
        ],
      },
      artifacts: [
        { path: "cycles/C101-feature-alpha/status.md" },
      ],
    }, {
      status: "warn",
      advice: "Review open repair findings, starting with branch_cycle_mismatch.",
      primaryReason: "warning: branch_cycle_mismatch: C101: Active branch and cycle mapping disagree",
      routingHint: "audit-first",
      routingReason: "Review open repair findings, starting with branch_cycle_mismatch.",
      findingLine: "- warning: branch_cycle_mismatch: C101: Active branch and cycle mapping disagree",
    });

    verifyScenario(tempRoot, "block", {
      ts: "2026-03-09T02:05:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [],
      repair_layer: {
        status: "block",
        advice: "Resolve blocking repair findings before continuing db-backed execution.",
        blocking: true,
        top_findings: [
          {
            severity: "error",
            finding_type: "orphan_cycle_status",
            entity_id: "C202",
            message: "Cycle status has no reachable session continuity",
          },
        ],
      },
      artifacts: [
        { path: "cycles/C202-bugfix-bridge/status.md" },
      ],
    }, {
      status: "block",
      advice: "Resolve blocking repair findings before continuing db-backed execution.",
      primaryReason: "error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
      routingHint: "repair",
      routingReason: "blocking repair findings require repair-first routing before any implementation handoff",
      findingLine: "- error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
      blockingLine: "- error: orphan_cycle_status: C202: Cycle status has no reachable session continuity",
    });

    verifyScenario(tempRoot, "clean", {
      ts: "2026-03-09T02:10:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [],
      repair_layer: {
        status: "clean",
        advice: "Repair layer is clean.",
        blocking: false,
        top_findings: [
          {
            severity: "info",
            finding_type: "SESSION_METADATA_NORMALIZATION_RECOMMENDED",
            entity_id: "S068",
            message: "Session uses comma-separated legacy integration_target_cycle; prefer integration_target_cycles for explicit multi-cycle topology.",
          },
        ],
      },
      artifacts: [],
    }, {
      status: "clean",
      advice: "Repair layer is clean.",
      primaryReason: "repair layer reports no blocking findings for the current relay",
      routingHint: "execution-or-audit",
      routingReason: "repair layer reports no blocking findings for the current relay",
      noFindingLine: "- info: SESSION_METADATA_NORMALIZATION_RECOMMENDED: S068: Session uses comma-separated legacy integration_target_cycle; prefer integration_target_cycles for explicit multi-cycle topology.",
      blockingFindingsLength: 0,
    });

    verifyScenario(tempRoot, "prefer-fresher-codex-context", {
      ts: "2026-03-09T02:00:00Z",
      target_root: "repo",
      state_mode: "db-only",
      context_file: ".aidn/runtime/context/codex-context.json",
      decisions: {},
      recent_history: [
        {
          ts: "2026-03-09T02:00:00Z",
          repair_layer_status: "warn",
          repair_layer_advice: "Review open repair findings, starting with UNTRACKED_CYCLE_STATUS_REFERENCE.",
          repair_layer_top_findings: [
            {
              severity: "warning",
              finding_type: "UNTRACKED_CYCLE_STATUS_REFERENCE",
              entity_id: "snapshots/context-snapshot.md",
              message: "Artifact references cycle C089 but the index is stale.",
            },
          ],
        },
      ],
      repair_layer: {
        status: "warn",
        advice: "Review open repair findings, starting with UNTRACKED_CYCLE_STATUS_REFERENCE.",
        blocking: false,
        top_findings: [
          {
            severity: "warning",
            finding_type: "UNTRACKED_CYCLE_STATUS_REFERENCE",
            entity_id: "snapshots/context-snapshot.md",
            message: "Artifact references cycle C089 but the index is stale.",
          },
        ],
      },
      artifacts: [],
    }, {
      status: "clean",
      advice: "Repair layer is clean.",
      primaryReason: "repair layer reports no blocking findings for the current relay",
      routingHint: "execution-or-audit",
      routingReason: "repair layer reports no blocking findings for the current relay",
      noFindingLine: "- warning: UNTRACKED_CYCLE_STATUS_REFERENCE: snapshots/context-snapshot.md: Artifact references cycle C089 but the index is stale.",
      blockingFindingsLength: 0,
    }, {
      contextPayload: {
        schema_version: 1,
        target_root: "repo",
        updated_at: "2026-03-09T02:20:00Z",
        latest: {
          "start-session": {
            ts: "2026-03-09T02:20:00Z",
            repair_layer_status: "clean",
            repair_layer_advice: "Repair layer is clean.",
            repair_layer_top_findings: [],
          },
        },
      },
    });

    verifyCanonicalDecisionSelection(tempRoot);
    verifyFallbackWithoutCanonicalDecision(tempRoot);
    verifyLatestTimestampMutant(tempRoot);

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
