# Workflow Context Resilience Changelog

Date: 2026-03-09
Scope: post-install workflow resilience for context loss, durable-write gating, and runtime re-anchor.

## Added

- `docs/audit/WORKFLOW-KERNEL.md` as the shortest workflow re-anchor entry point.
- `docs/audit/CURRENT-STATE.md` as a consolidated summary of active session, cycle, branch kind, DoR, decisions, hypotheses, gaps, and next actions.
- `docs/audit/REANCHOR_PROMPT.md` as a standard re-anchor protocol before durable writes.
- `docs/audit/ARTIFACT_MANIFEST.md` to make artifact lookup explicit.
- `docs/audit/RUNTIME-STATE.md` as a runtime digest for `dual` and `db-only` environments.
- `aidn runtime project-runtime-state` CLI entry point.
- verification suites for re-anchor coverage, current-state consistency, runtime-state projection, runtime hints, and install/import propagation.

## Changed

- `AGENTS.md` now enforces a mandatory pre-write gate and treats `apply_patch` as a durable write in recent Codex Windows flows.
- `WORKFLOW_SUMMARY.md`, `WORKFLOW.md`, `index.md`, and Codex guidance now start from `CURRENT-STATE.md` and `WORKFLOW-KERNEL.md` before deeper workflow reads.
- mutating Codex skills now keep `CURRENT-STATE.md` aligned and prefer `RUNTIME-STATE.md` as the short runtime digest after hydration.
- `hydrate-context` can project `RUNTIME-STATE.md`, and does so automatically in `dual`/`db-only` when the digest already exists.
- runtime hook text outputs now point agents to `docs/audit/RUNTIME-STATE.md` and to `docs/audit/CURRENT-STATE.md` when the current state is stale.
- installed-core fixture and install/import checks were updated to propagate and verify the new artifacts.

## Validated

- `npm run perf:verify-context-resilience`
- positive and negative `CURRENT-STATE.md` fixture coverage
- runtime projector exact `warn|block` rendering
- hydrate-context runtime digest projection
- runtime text hints for stale current-state and repair warnings

## Notes

- This is a progressive hardening of the existing aid'n workflow, not a rewrite.
- The target structure remains the post-install repository layout.
