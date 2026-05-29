export const OBSERVABILITY_SURFACE_INVENTORY_VERSION = "1.0.0";

export const OBSERVABILITY_SURFACE_SCRIPTS = Object.freeze([
  {
    script: "render-constraint-lot-plan-summary.mjs",
    category: "render",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-lot-plan-summary-use-case",
    public_alias: "perf:constraint-lot-summary",
  },
  {
    script: "render-constraint-summary.mjs",
    category: "render",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-summary-use-case",
    public_alias: "perf:constraint-summary",
  },
  {
    script: "render-constraint-trend-summary.mjs",
    category: "render",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-trend-summary-use-case",
    public_alias: "perf:constraint-trend-summary",
  },
  {
    script: "render-index-canonical-check-summary.mjs",
    category: "render",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-canonical-check-summary-use-case",
    public_alias: "perf:index-canonical-summary",
  },
  {
    script: "render-index-summary.mjs",
    category: "render",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-summary-use-case",
    public_alias: "perf:index-summary",
  },
  {
    script: "render-index-sync-report-summary.mjs",
    category: "render",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-sync-report-summary-use-case",
    public_alias: "perf:index-sync-trend-summary",
  },
  {
    script: "render-index-sync-summary.mjs",
    category: "render",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-sync-summary-use-case",
    public_alias: "perf:index-sync-summary",
  },
  {
    script: "render-repair-layer-triage-summary.mjs",
    category: "render",
    domain: "repair-layer",
    separation_state: "wrapper-extracted",
    target_use_case: "repair-layer-triage-summary-use-case",
    public_alias: "perf:repair-layer-triage-summary",
  },
  {
    script: "render-summary.mjs",
    category: "render",
    domain: "campaign",
    separation_state: "wrapper-extracted",
    target_use_case: "campaign-summary-use-case",
    public_alias: null,
  },
  {
    script: "render-workflow-version.mjs",
    category: "render",
    domain: "workflow",
    separation_state: "wrapper-extracted",
    target_use_case: "workflow-version-render-use-case",
    public_alias: null,
  },
  {
    script: "report-constraint-actions.mjs",
    category: "report",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-actions-report-use-case",
    public_alias: "perf:constraint-actions",
  },
  {
    script: "report-constraint-lot-plan.mjs",
    category: "report",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-lot-plan-report-use-case",
    public_alias: "perf:constraint-lot-plan",
  },
  {
    script: "report-constraint-trend.mjs",
    category: "report",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-trend-report-use-case",
    public_alias: "perf:constraint-trend",
  },
  {
    script: "report-constraints.mjs",
    category: "report",
    domain: "constraint",
    separation_state: "wrapper-extracted",
    target_use_case: "constraint-report-use-case",
    public_alias: "perf:constraint-report",
  },
  {
    script: "report-fallbacks.mjs",
    category: "report",
    domain: "fallback",
    separation_state: "wrapper-extracted",
    target_use_case: "fallback-report-use-case",
    public_alias: "perf:fallback-report",
  },
  {
    script: "report-index-regression-kpi.mjs",
    category: "report",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-regression-kpi-report-use-case",
    public_alias: "perf:index-regression-kpi",
  },
  {
    script: "report-index-sync.mjs",
    category: "report",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-sync-report-use-case",
    public_alias: "perf:index-sync-report",
  },
  {
    script: "report-index.mjs",
    category: "report",
    domain: "index",
    separation_state: "wrapper-extracted",
    target_use_case: "index-report-use-case",
    public_alias: "perf:index-report",
  },
  {
    script: "report-kpi.mjs",
    category: "report",
    domain: "campaign",
    separation_state: "wrapper-extracted",
    target_use_case: "campaign-kpi-report-use-case",
    public_alias: "perf:report",
  },
]);

export const OBSERVABILITY_SEPARATION_STATES = Object.freeze({
  "wrapper-extracted": "CLI reads/writes files and delegates core rendering or report construction to src/application.",
  "legacy-wrapper-with-inline-builder": "CLI still owns a local builder and should be extracted behind a use case.",
  "legacy-cli-orchestrator": "CLI still mixes report assembly with filesystem/runtime orchestration and needs a boundary pass.",
});

export function listObservabilitySurfaceScripts() {
  return OBSERVABILITY_SURFACE_SCRIPTS.map((entry) => ({ ...entry }));
}

export function summarizeObservabilitySurface(entries = OBSERVABILITY_SURFACE_SCRIPTS) {
  const summary = {
    version: OBSERVABILITY_SURFACE_INVENTORY_VERSION,
    total: entries.length,
    by_category: {},
    by_domain: {},
    by_separation_state: {},
    extracted_count: 0,
    remaining_legacy_count: 0,
  };
  for (const entry of entries) {
    summary.by_category[entry.category] = (summary.by_category[entry.category] ?? 0) + 1;
    summary.by_domain[entry.domain] = (summary.by_domain[entry.domain] ?? 0) + 1;
    summary.by_separation_state[entry.separation_state] = (summary.by_separation_state[entry.separation_state] ?? 0) + 1;
    if (entry.separation_state === "wrapper-extracted") {
      summary.extracted_count += 1;
    } else {
      summary.remaining_legacy_count += 1;
    }
  }
  return summary;
}
