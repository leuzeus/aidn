# Git Workflow

## Branch Roles

- `main`
  - stable branch
  - release base
  - only clean, reviewable pull requests should merge here

- `dev`
  - integration branch
  - may accumulate several workstreams
  - useful for assembling, testing, and validating larger batches
  - should not be assumed to be a small review unit

- `feature/*`, `fix/*`, `chore/*`, `docs/*`, `release/*`
  - short-lived branches
  - created from `main`
  - one clear intent per branch
  - one clean pull request per branch

## Core Rules

1. Any pull request meant for clean review starts from `main`.
2. `dev` is for integration, not for automatically producing narrow PRs.
3. If a change already exists on `dev` but needs a clean PR:
   - create a new branch from `main`
   - cherry-pick the relevant commit(s)
   - open the PR from that branch
4. Resync `dev` from `main` regularly after merges.
5. Do not let `dev` drift for too long without resync.
6. Avoid mixed-scope commits on short-lived PR branches.

## Recommended Flows

### Standard Change

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/<topic>
```

Then:
- implement the change
- commit
- push
- open a PR to `main`

### Integration / Exploration

```bash
git switch dev
git pull --ff-only origin dev
```

Use `dev` to:
- assemble multiple changes
- test broader interactions
- work on larger in-progress batches

If one subset must become a clean PR:

```bash
git switch main
git pull --ff-only origin main
git switch -c chore/<topic>
git cherry-pick <commit-or-range>
```

Then:
- push
- open the PR to `main`

### After Merge to `main`

Resync `dev`:

```bash
git switch dev
git fetch origin
git merge --ff-only origin/main
```

## Release Version Provenance

Release versioning has one explicit source value: `VERSION`.

Before tagging or assembling a release:

1. `VERSION` and `package.json` `version` must match exactly.
2. README stable install examples must point to `github:leuzeus/aidn#v<VERSION>`.
3. `tools/build-release.mjs` must produce `release/dist/aidn-workflow-<VERSION>.zip`.
4. `release/checksums.txt` must reference the zip for the same `VERSION`.
5. `release/manifest.json` must record package name, version, git commit, generation time, artifact path, artifact bytes, and artifact SHA-256.
6. `dev` may carry in-flight integration work, but release tags and stable consumer instructions should be cut from the reviewed release baseline.

## Release Checklist

Before shipping or publishing a release artifact, verify:

1. the release workflow runs `perf:verify-release-version`, `build-release`, `perf:verify-release-artifacts`, and `perf:verify-pack-topology`
2. `package.json` does not introduce new published paths that leak internal docs or local-only pilot corpus material
3. `docs/` entries included in the package are intentionally published and user-facing
4. `release/dist/`, `release/checksums.txt`, and `release/manifest.json` are treated as generated release outputs, not source inputs
5. any new published path is justified in the release review before it becomes part of the package surface

Run:

```bash
npm run perf:verify-release-version
npm run build-release
npm run perf:verify-release-artifacts
```

These gates prevent silent drift between branch policy, package metadata, user-facing install docs, release artifact names, checksums, and release manifest provenance.

## When To Reset `dev`

Do not recreate `dev` routinely.

Consider resetting or recreating it only if:
- it has become too noisy to be useful
- it has drifted too far from `main`
- work can no longer be isolated cleanly

In normal operation, keep `dev` and give it a clear role as the integration branch.

## Naming Examples

- `feature/runtime-repair-triage`
- `fix/render-workflow-version-noop`
- `chore/release-0.4.0-diagrams`
- `docs/git-workflow`

## Decision Rule

- If the goal is integration and accumulation: use `dev`
- If the goal is a clean reviewable PR: branch from `main`
