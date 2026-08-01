#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  parseGitNameStatusZ,
  resolveGovernanceRoute,
  validateGovernanceRoutePolicy,
} from "./governance-route-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function loadCatalog() {
  return JSON.parse(fs.readFileSync(
    path.join(repoRoot, "package", "catalogs", "gates.v1.json"),
    "utf8",
  ));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function route(catalog, paths, overrides = {}) {
  return resolveGovernanceRoute({
    catalog,
    surfaceCatalog: { entries: [] },
    changes: paths,
    baseBranch: "dev",
    headBranch: "codex/route-fixture",
    baseRef: "base-fixture",
    headRef: "head-fixture",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    mergeBaseSha: "a".repeat(40),
    diffResolved: true,
    projectVersion: "0.7.2",
    ...overrides,
  });
}

export function runGovernanceRouteFixtureSuite(catalog = loadCatalog()) {
  const fixtureRoutes = {
    A: route(catalog, ["docs/PLAN_ARCHIVED_DECISION.md"]),
    B: route(catalog, ["src/application/query/internal-query.mjs"]),
    C: route(catalog, ["scaffold/codex/internal-template.md"]),
    D: route(catalog, ["src/core/cli/effect-policy.mjs"]),
    E: route(catalog, ["src/infrastructure/persistence/migrations/001.sql"]),
    F: route(catalog, ["VERSION"], {
      baseBranch: "main",
      headBranch: "hotfix/v0.7.2",
    }),
  };
  const expectedFixtureChecks = {
    A_historical_fast: fixtureRoutes.A.lane === "FAST"
      && fixtureRoutes.A.gate_selection.families.every(
        (family) => ["cleanliness", "docs", "security"].includes(family),
      )
      && !fixtureRoutes.A.gate_selection.families.includes("runtime")
      && !fixtureRoutes.A.gate_selection.families.includes("release"),
    B_internal_bug_standard_runtime_only: fixtureRoutes.B.lane === "STANDARD"
      && fixtureRoutes.B.gate_selection.families.includes("runtime")
      && !fixtureRoutes.B.gate_selection.families.includes("release"),
    C_internal_codex_standard: fixtureRoutes.C.lane === "STANDARD"
      && fixtureRoutes.C.gate_selection.families.includes("codex")
      && !fixtureRoutes.C.gate_selection.families.includes("runtime"),
    D_public_cli_assured: fixtureRoutes.D.lane === "ASSURED",
    E_persistence_assured: fixtureRoutes.E.lane === "ASSURED",
    F_hotfix_assured_emergency: fixtureRoutes.F.lane === "ASSURED"
      && fixtureRoutes.F.emergency_overlay.active === true,
  };

  const unknown = route(catalog, ["misc/new-surface.xyz"]);
  const rename = route(catalog, [{
    status: "R100",
    path: "src/application/query/renamed.mjs",
    previous_path: "docs/PLAN_RENAMED.md",
  }]);
  const deleted = route(catalog, [{ status: "D", path: "docs/PLAN_REMOVED.md" }]);
  const unresolved = route(catalog, [], {
    diffResolved: false,
    baseSha: null,
    headSha: null,
    mergeBaseSha: null,
  });
  const mixed = route(catalog, [
    "docs/PLAN_ARCHIVED_DECISION.md",
    "src/application/query/internal-query.mjs",
  ]);
  const downgrade = route(catalog, ["src/core/cli/effect-policy.mjs"], {
    requestedLane: "FAST",
  });
  const directDev = route(catalog, ["src/application/query/internal-query.mjs"], {
    headBranch: "dev",
  });
  const draft = route(catalog, ["src/core/cli/effect-policy.mjs"], { draft: true });
  const escalation = route(catalog, ["src/application/query/internal-query.mjs"], {
    requestedLane: "ASSURED",
  });
  const publicCatalogEscalation = resolveGovernanceRoute({
    catalog,
    surfaceCatalog: {
      entries: [{
        id: "fixture:public",
        status: "active",
        visibility: "public",
        source: "scaffold/public-fixture.md",
        implementation: "scaffold/public-fixture.md",
        docs: "docs/PUBLIC_FIXTURE.md",
        proof: {},
      }],
    },
    changes: ["scaffold/public-fixture.md"],
    baseBranch: "dev",
    headBranch: "codex/public-fixture",
    diffResolved: true,
  });
  const parsedChanges = parseGitNameStatusZ(
    "R100\0docs/PLAN_OLD.md\0src/application/query/new.mjs\0D\0docs/PLAN_GONE.md\0",
  );
  const assuredRequired = fixtureRoutes.D.gate_selection.required;
  const adverseChecks = {
    unknown_path_standard_conservative: unknown.lane === "STANDARD"
      && JSON.stringify(unknown.gate_selection.families)
        === JSON.stringify(catalog.required_families.filter((family) => family !== "release")),
    rename_preserves_old_and_new_risk: rename.lane === "STANDARD"
      && rename.path_classification.some((item) => item.historical)
      && rename.gate_selection.families.includes("runtime"),
    delete_classified: deleted.lane === "FAST" && deleted.changed_paths[0].status === "D",
    unresolved_diff_fails_closed: unresolved.lane === "ASSURED"
      && unresolved.final_state === "DEGRADED_ASSURED",
    mixed_paths_take_maximum_lane: mixed.lane === "STANDARD"
      && mixed.gate_selection.families.includes("docs")
      && mixed.gate_selection.families.includes("runtime"),
    requested_downgrade_rejected: downgrade.lane === "ASSURED"
      && downgrade.ok === false
      && downgrade.issues.includes("REQUESTED_LANE_DOWNGRADE_REJECTED"),
    direct_dev_rejected: directDev.ok === false
      && directDev.issues.includes("DIRECT_PROTECTED_BRANCH"),
    draft_is_explore_only: draft.lane === "EXPLORE"
      && draft.delivery_lane === "ASSURED"
      && draft.gate_selection.all.length === 0,
    explicit_escalation_only_increases: escalation.lane === "ASSURED"
      && escalation.ok === true,
    surface_catalog_only_escalates: publicCatalogEscalation.lane === "ASSURED",
    rename_delete_parser: parsedChanges.length === 2
      && parsedChanges[0].previous_path === "docs/PLAN_OLD.md"
      && parsedChanges[1].status === "D",
    assured_has_exact_required_obligations: assuredRequired.length === 42,
    no_gate_selected_twice: new Set(fixtureRoutes.D.gate_selection.all.map((gate) => gate.id)).size
      === fixtureRoutes.D.gate_selection.all.length,
    emergency_never_reduces_assurance: fixtureRoutes.F.gate_selection.required.length === 42
      && fixtureRoutes.F.deferred_evidence.includes("observability:perf-kpi"),
  };

  const weakenedFast = structuredClone(catalog);
  weakenedFast.governance_route_policy.fast_families = ["docs"];
  const weakenedEmergency = structuredClone(catalog);
  weakenedEmergency.governance_route_policy.emergency.gate_lane = "STANDARD";
  const missingAssuredPatterns = structuredClone(catalog);
  missingAssuredPatterns.governance_route_policy.assured_patterns = [];
  const mutationChecks = {
    reduced_fast_invariants_rejected: validateGovernanceRoutePolicy(weakenedFast).length > 0,
    weakened_emergency_rejected: validateGovernanceRoutePolicy(weakenedEmergency).length > 0,
    missing_assured_patterns_rejected: validateGovernanceRoutePolicy(missingAssuredPatterns).length > 0,
  };
  const checks = {
    ...expectedFixtureChecks,
    ...adverseChecks,
    ...mutationChecks,
  };
  for (const [name, passed] of Object.entries(checks)) {
    assert(passed, `governance route fixture failed: ${name}`);
  }
  return {
    ok: true,
    status: "PASS",
    contract: catalog.governance_route_policy.contract,
    fixtures: Object.fromEntries(Object.entries(fixtureRoutes).map(([name, value]) => [name, {
      lane: value.lane,
      emergency: value.emergency_overlay.active,
      families: value.gate_selection.families,
      required_gates: value.gate_selection.required.length,
    }])),
    adversarial: adverseChecks,
    mutation_probes: mutationChecks,
  };
}

function main() {
  try {
    console.log(JSON.stringify(runGovernanceRouteFixtureSuite(), null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      status: "FAIL",
      error: String(error?.message ?? error),
    }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
