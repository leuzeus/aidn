# Upgrade Guide

## Upgrade to 0.7.0

This baseline makes AIDN's governed architecture and release path executable end to end:

- machine-readable catalogs cover CLI surfaces, effects, public JSON contracts, governed concepts, gate obligations, and workflows.
- the public Codex `context-store` subcommand is removed; use `aidn codex hydrate-context` for context bundles or `aidn codex workflow-step` for the batched admission/hydration path.
- Node.js 22.13 or newer is required by the package and installer compatibility policy.
- `--json` is format-only; writes require explicit `--write`, `--apply`, `--execute`, or the documented equivalent, and atomic replacements preserve the previous state on failure.
- public machine-readable commands emit one complete JSON document on `stdout`, while bounded diagnostics remain on `stderr`.
- installed Codex integration includes project skills, bounded custom agents, a trusted-project session hook, real installed-client discovery, and preserved failure/cleanup diagnostics.
- `files`, `dual`, and `db-only` remain distinct modes; PostgreSQL persistence is optional, SQLite remains available for local compatibility and migration, and shared coordination is explicit opt-in.
- protected-branch CI and the release workflow verify from locked dependencies; a merged `release/*` PR is published from exact `main` `GITHUB_SHA` with an annotated tag, checksums, and provenance assets, never with `npm publish`.
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
   - `package.json`
   - `package-lock.json`
   - `README.md`
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
   - `npm run perf:verify-project-config`
   - `npm run perf:verify-shared-coordination-runtime-cli`
   - `npm run perf:verify-runtime-backend-adoption`

## Client repository steps

1. Install or upgrade the package to the matching product tag:

```bash
npm install --save-dev github:leuzeus/aidn#v0.7.0
```

2. Run the recommended upgrade orchestrator:

```bash
npx aidn bootstrap --target <client-repo> --mode upgrade --profile default
```

Use profile `full` when the client repo intentionally carries all optional integration layers:

```bash
npx aidn bootstrap --target <client-repo> --mode upgrade --profile full
```

Use profile `postgres` only when PostgreSQL runtime persistence is explicitly configured:

```bash
npx aidn bootstrap --target <client-repo> --mode upgrade --profile postgres --runtime-persistence-connection-ref env:AIDN_PG_URL
```

Advanced lower-level pack reinstall remains available:

```bash
npx aidn install --target <client-repo> --pack core
npx aidn install --target <client-repo> --pack github-integration
npx aidn install --target <client-repo> --pack github-integration --verify
```

3. Refresh or migrate the durable project adapter when needed:

```bash
npx aidn project config --target <client-repo> --wizard --write
npx aidn project config --target <client-repo> --migrate-adapter --version 0.7.0 --write --json
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
