function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildIndexRegressionKpiRun(report) {
  const ts = String(report?.ts ?? new Date().toISOString());
  const projection = report?.summary?.projection ?? {};
  const rows = report?.summary?.rows ?? {};
  const canonicalCoverage = toNumberOrZero(projection.canonical_coverage_ratio);
  const canonicalCoverageMarkdown = toNumberOrZero(projection.canonical_coverage_ratio_markdown);
  const artifactsWithCanonical = toNumberOrZero(projection.artifacts_with_canonical);
  const artifactsWithCanonicalMarkdown = toNumberOrZero(projection.artifacts_markdown_with_canonical);
  const artifactsTotal = toNumberOrZero(rows.artifacts);
  const artifactsMarkdown = toNumberOrZero(projection.artifacts_markdown);
  const artifactsWithoutCanonical = Math.max(0, artifactsTotal - artifactsWithCanonical);
  const artifactsWithoutCanonicalMarkdown = Math.max(0, artifactsMarkdown - artifactsWithCanonicalMarkdown);
  const runId = `index-${ts}`;

  return {
    run_id: runId,
    started_at: ts,
    ended_at: ts,
    canonical_coverage_ratio: canonicalCoverage,
    canonical_coverage_ratio_markdown: canonicalCoverageMarkdown,
    canonical_gap_all: Number((1 - canonicalCoverage).toFixed(6)),
    canonical_gap_markdown: Number((1 - canonicalCoverageMarkdown).toFixed(6)),
    artifacts_total: artifactsTotal,
    artifacts_markdown: artifactsMarkdown,
    artifacts_with_canonical: artifactsWithCanonical,
    artifacts_markdown_with_canonical: artifactsWithCanonicalMarkdown,
    artifacts_without_canonical: artifactsWithoutCanonical,
    artifacts_without_canonical_markdown: artifactsWithoutCanonicalMarkdown,
  };
}
