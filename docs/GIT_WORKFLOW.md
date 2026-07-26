# Git Workflow

## Branch Roles

- `main` is the production branch. Only reviewed `release/*` pull requests merge into it.
- `dev` is the integration branch. Feature, fix, chore, documentation, and Codex work branches merge into it.
- `feature/*`, `fix/*`, `chore/*`, `docs/*`, and `codex/*` are short-lived branches created from current `dev`.
- `release/*` branches are cut from a reviewed `dev`, contain only release preparation, and target `main`.

The executable branch policy is `tools/verify/verify-branch-policy.mjs`.

## Required Flows

### Product change

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feature/<topic>
```

Open the pull request from the feature branch to `dev`.

### Release preparation

```bash
git switch dev
git pull --ff-only origin dev
git switch -c release/<version>
```

Align `VERSION`, `package.json`, current stable documentation, and release notes on the release branch. Open the pull request from `release/<version>` to `main`. A release PR verifies but never tags or publishes.

After the release PR merges, resynchronize `dev` from `main` through a reviewed integration operation appropriate to the repository protections.

## Branch Rules

1. Feature-family branches target `dev`, never `main`.
2. Only `release/*` branches target `main`.
3. `main` and `dev` are protected integration surfaces; implementation does not occur directly on either branch.
4. A release branch must not contain unrelated feature work.
5. Publication is an automated consequence of a successful release PR merge to `main`; a manually pushed version tag is not a release trigger.

## Release Version Provenance

`VERSION` is the primary release version source. It remains aligned with `package.json` and current stable install references.

Release provenance is built from the exact clean commit:

- CI checks out `GITHUB_SHA` with full Git history.
- `tools/build-release.mjs` reads only the tracked tree at that commit.
- The package allowlist in `package.json#files` defines the zip topology.
- The manifest records commit, tree, deterministic input inventory, version fingerprints, checksum, and artifact bytes.
- Two isolated builds must be byte-for-byte reproducible.
- Package topology and sensitivity checks reject fixtures, historical plans/backlogs, pilot-derived material, workflow files, and release outputs.

## Automatic Publication

The release workflow has two mutually exclusive paths:

1. A pull request from `release/*` to `main` runs `npm run verify:release` and does not publish.
2. A push to `main` publishes only when GitHub associates `GITHUB_SHA` with exactly one merged `release/*` pull request targeting `main`.

The publish job refuses:

- a non-`main` ref;
- a checkout or `origin/main` that differs from `GITHUB_SHA`;
- a dirty checkout;
- a missing or ambiguous merged release PR;
- version drift or non-reproducible output;
- package topology or sensitivity drift;
- an existing tag or GitHub Release.

After the checks pass, automation builds from `GITHUB_SHA`, creates an annotated `v<VERSION>` tag, pushes it, and creates the GitHub Release with the zip, checksums, and manifest. It never runs `npm publish`.

## Local Verification

Run the smallest affected family during implementation:

```bash
npm run verify:contracts
npm run verify:governance
npm run verify:runtime
npm run verify:codex
npm run verify:release
```

At a clean commit boundary:

```bash
npm run verify:all
```

The machine-readable obligations and their `PASS|FAIL|SKIP` outcomes are cataloged in `package/catalogs/gates.v1.json`.
