# Upgrade Guide

## Upgrade to 0.5.1

This baseline consolidates the current product/runtime surface:

- generated workflow adapter outputs driven by `.aidn/project/workflow.adapter.json`
- `aidn project config` as the durable adapter management entrypoint
- bounded coordinator/orchestration runtime commands
- shared coordination PostgreSQL visibility/admin commands
- runtime persistence adoption and migration support for `sqlite | postgres`
- Mermaid and BPMN documentation aligned with the current baseline

Recent workflow resilience updates also add:

- `docs/audit/WORKFLOW-KERNEL.md`
- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/REANCHOR_PROMPT.md`
- `docs/audit/ARTIFACT_MANIFEST.md`
- explicit pre-write guidance in `AGENTS.md`

## Product repository steps

1. Update workflow sources in this repository (`docs/SPEC.md`, `scaffold/`, manifests).
2. Align product version signals so live docs and manifests match `VERSION`:
   - `package/manifests/workflow.manifest.yaml`
   - `packs/core/manifest.yaml`
   - `packs/runtime-local/manifest.yaml`
   - `packs/codex-integration/manifest.yaml`
   - `packs/github-integration/manifest.yaml`
   - `packs/extended/manifest.yaml`
3. Regenerate and verify fixtures:
   - `node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core`
   - `node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core --verify`
4. Re-run current verification coverage:
   - `npm run perf:verify-context-resilience`
   - `npm run perf:verify-project-config-fixtures`
   - `npm run perf:verify-shared-coordination-runtime-cli`
   - `npm run perf:verify-runtime-backend-adoption`

## Client repository steps

1. Install or upgrade the package to the matching product tag:

```bash
npm install --save-dev github:leuzeus/aidn#v0.5.1
```

2. Reinstall the desired pack from the workflow product repo:

```bash
npx aidn install --target <client-repo> --pack core
```

If the client repo uses the optional GitHub automation layer:

```bash
npx aidn install --target <client-repo> --pack github-integration
npx aidn install --target <client-repo> --pack github-integration --verify
```

3. Refresh or migrate the durable project adapter when needed:

```bash
npx aidn project config --target <client-repo> --wizard
npx aidn project config --target <client-repo> --migrate-adapter --version 0.5.1 --json
```

4. Verify installation and current runtime/admin surfaces:

```bash
npx aidn install --target <client-repo> --pack core --verify
npx aidn runtime shared-coordination-status --target <client-repo> --json
npx aidn runtime persistence-adopt --target <client-repo> --backend postgres --dry-run --json
```

5. Review local adapter updates:
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

6. If an existing `AGENTS.md` must be updated, run with explicit merge:

```bash
npx aidn install --target <client-repo> --pack core --force-agents-merge
```
