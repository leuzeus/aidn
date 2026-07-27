# Git Workflow

## Branch Roles

- `main` is the production branch. Only reviewed, version-matched
  `release/vX.Y.Z` or `hotfix/vX.Y.Z` pull requests merge into it.
- `dev` is the integration branch. Feature, fix, chore, documentation, and Codex work branches merge into it.
- `feature/*`, `fix/*`, `chore/*`, `docs/*`, and `codex/*` are short-lived branches created from current `dev`.
- `release/vX.Y.Z` branches are cut from a reviewed `dev`, contain only release preparation, and target `main`.
- `hotfix/vX.Y.Z` branches are cut from current `main`, contain one urgent patch
  release, increment the patch version, and target `main`.
- `sync/main-to-dev-vX.Y.Z` branches are exact, unmodified pointers to current
  `main` and target only `dev`.

The executable branch policy is `tools/verify/verify-branch-policy.mjs`.

For a normal branch checkout, the policy derives the head from the configured
remote before comparing it with the announced base. For an immutable detached
certification, both proofs are mandatory: the exact expected commit SHA and
containment by an explicitly announced remote-tracking ref from a configured
remote. A local branch or local ref alone is never accepted as detached
provenance.

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
git switch -c release/v<version>
```

Align `VERSION`, `package.json`, current stable documentation, and release notes
on the release branch. Open the pull request from `release/v<version>` to
`main`. A release PR verifies but never tags or publishes.

### Production hotfix

```bash
git switch main
git pull --ff-only origin main
git switch -c hotfix/v<patch-version>
```

The branch name must equal `hotfix/v${VERSION}` after the patch version is
prepared. A hotfix PR runs the same full release verification as a normal
release and publishes the patch release automatically after merge. It never
publishes to npm.

### Production resynchronization

After any release or hotfix publication, create
`sync/main-to-dev-v<version>` at the exact current `origin/main` commit. Do not
add a commit or modify its tree. Open that branch only toward `dev`; the branch
policy proves byte-for-byte SHA equality with `origin/main`.

## Branch Rules

1. Feature-family branches target `dev`, never `main`.
2. Only the exact version-matched `release/vX.Y.Z` or `hotfix/vX.Y.Z` branch targets `main`.
3. `main` and `dev` are protected integration surfaces; implementation does not occur directly on either branch.
4. A release branch must not contain unrelated feature work.
5. A release branch must contain current `origin/dev`; a hotfix branch must
   contain current `origin/main`.
6. A `sync/main-to-dev-vX.Y.Z` branch targets only `dev` and must equal current
   `origin/main`; divergent or differently named synchronization branches fail.
7. Publication is an automated consequence of a successful release or hotfix
   PR merge to `main`; a manually pushed version tag is not a release trigger.
8. GitHub auto-merge may be armed only for the reviewed SHA and completes only
   after all required checks succeed.

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

1. A pull request from exact `release/v${VERSION}` or
   `hotfix/v${VERSION}` to `main` runs `npm run verify:release` and does not
   publish.
2. A push to `main` publishes only when GitHub associates `GITHUB_SHA` with
   exactly one merged PR targeting `main`, and its source is exactly
   `release/v${VERSION}` or `hotfix/v${VERSION}`.

`verify:release` executes the complete obligation set for the announced release
or main context. This includes the release family plus required contract,
effects, governance, documentation, Codex/runtime, security, topology, and
cleanliness gates. The workflow must not replace this aggregate with a partial
list that merely has a release-oriented job name.

The publish job refuses:

- a non-`main` ref;
- a checkout or `origin/main` that differs from `GITHUB_SHA`;
- a dirty checkout;
- a missing or ambiguous merged publication PR;
- a source branch that is not the exact version-matched release or hotfix branch;
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
