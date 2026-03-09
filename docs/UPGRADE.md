# Upgrade Guide

## Upgrade to 0.2.0

This release introduces stronger workflow governance artifacts:
- canonical rule index in `SPEC` (`SPEC-R01..SPEC-R11`),
- continuity and session-close resolution model,
- explicit rule/state boundary support files,
- extended templates for cycle/session state tracking.

Recent workflow resilience updates also add:

- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/REANCHOR_PROMPT.md`
- `docs/audit/ARTIFACT_MANIFEST.md`
- explicit pre-write guidance in `AGENTS.md`

## Product repository steps

1. Update workflow sources in this repository (`docs/SPEC.md`, `template/`, manifests).
2. Bump versions in:
   - `package/manifests/workflow.manifest.yaml`
   - `packs/core/manifest.yaml`
   - `packs/extended/manifest.yaml`
3. Regenerate and verify fixtures:
   - `node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core`
   - `node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core --verify`
4. Re-run workflow resilience verification:
   - `npm run perf:verify-context-resilience`

## Client repository steps

1. Reinstall core pack from the workflow product repo:

```bash
node tools/install.mjs --target <client-repo> --pack core
```

2. Verify installation:

```bash
node tools/install.mjs --target <client-repo> --pack core --verify
```

3. Review local adapter updates:
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/WORKFLOW.md`
- `docs/audit/WORKFLOW_SUMMARY.md`
- `docs/audit/REANCHOR_PROMPT.md`
- `docs/audit/ARTIFACT_MANIFEST.md`
- `docs/audit/CONTINUITY_GATE.md`
- `docs/audit/RULE_STATE_BOUNDARY.md`

Recommended post-upgrade reload path:

1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
5. `docs/audit/WORKFLOW.md`
6. `docs/audit/SPEC.md` if canonical rule details are needed

4. If an existing `AGENTS.md` must be updated, run with explicit merge:

```bash
node tools/install.mjs --target <client-repo> --pack core --force-agents-merge
```
