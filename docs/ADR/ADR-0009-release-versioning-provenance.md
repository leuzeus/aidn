# ADR-0009 - Release Versioning Provenance

## Status

Accepted

## Date

2026-05-24

## Amendment

2026-07-27: publication-source governance now treats normal releases and
production hotfixes as explicit, version-matched publication classes.
Main-to-dev synchronization is a distinct non-publication class and may never
target `main`.

2026-09-23: product version authority and installed configuration schema are
separate; successful installation records a receipt-bound product version.

2026-09-23: a deterministic npm tarball joins the ZIP in the release manifest
and checksums so installed clients can pin a published package rather than a
source worktree.

## Context

AIDN ships as a package source repository with local release artifacts, manifests and checksums. The release surface is already validated by `build-release`, `npm pack --dry-run` and topology checks, but the source of version truth and the provenance of published artifacts still need an explicit architectural home.

Without a clear release provenance ADR, it is too easy for `VERSION`, `package.json`, the release manifest and the published package surface to drift apart.

## Decision

AIDN will treat release versioning and provenance as a governed contract.

Rules:

- `VERSION` in the source or executing package is the sole product version authority
- `package.json`, both package-lock root versions, and workflow/pack manifest
  versions are derived copies and must stay aligned with `VERSION`
- `tools/build-release.mjs` produces the ZIP and installable npm `.tgz` only from the same exact tracked Git tree and package allowlist at the selected commit
- `release/manifest.json` and `release/checksums.txt` are the release provenance outputs
- the manifest records source fingerprints for `VERSION` and `package.json` so the source of truth can be verified from the build output itself
- the manifest records the git commit used for the build so provenance can be verified against the current source tree
- `npm pack --dry-run` remains part of the publish-surface guard
- internal docs, pilot-specific details and non-published fixtures must not leak into the package payload
- release and hotfix pull requests verify without publishing
- `release/vX.Y.Z` must contain current `origin/dev`
- `hotfix/vX.Y.Z` must contain current `origin/main`, preserve its major and
  minor version numbers, increment its patch number by exactly one, and follow
  the same verification and publication contract
- `sync/main-to-dev-vX.Y.Z` must equal current `origin/main` and target only
  `dev`; its version suffix must equal `VERSION` at that exact source commit and
  it never publishes
- publication occurs only on a push to `main` associated with exactly one
  merged PR whose `merge_commit_sha` equals `GITHUB_SHA` and whose source is
  exactly `release/v${VERSION}` or `hotfix/v${VERSION}`
- workflow-critical remote fetch and publication-source proof run through
  canonical one-command Node helpers in blocking steps whose exact `if` and
  `continue-on-error` metadata is governed; their behavior is tested with
  injected Git and GitHub responses, and retained text or dormant shell blocks
  are not evidence
- the publish job creates an annotated tag and GitHub Release only after clean-commit, reproducibility, topology, sensitivity, checksum, and provenance checks
- an existing tag or release is a hard failure
- the release workflow never runs `npm publish`

Installed configuration versioning follows the same authority boundary:

ADR-0013 adds an explicit global installation binding for migrated clients.
Their historical installation marker remains distinct from the active host
generation; ordinary global updates must not rewrite project version markers.
The global public rollout is still in progress and is not release-qualified.

- root `.aidn/config.json.version` remains configuration schema `1`, independent
  of product SemVer; legacy configurations without it remain valid;
- optional `install.aidnVersion` denotes the last complete successful requested
  installation from the executing package's `VERSION`, bound to the existing
  local installation receipt; config generation alone must not stamp it;
- preview, diagnosis, failure and interruption do not establish successful
  installation; successful completion or resume finalizes the marker, and full
  installation rollback restores its prior value;
- absent legacy markers mean unknown, never an inferred product version;
- package version, last recorded installation and current asset drift are
  separate diagnostic observations; neither the marker nor a matching receipt
  proves native trust, workflow readiness or transitive package integrity.

Release provenance should answer:

- what version is being released
- which source files were included
- which checks ran before publish
- which checksum set matches the artifact payload
- which git commit produced the manifest
- which Git tree and deterministic package input inventory produced the artifact

## Options Compared

| Option | Result |
|---|---|
| Git tag only | Simple, but not enough for local release reproducibility. |
| `VERSION` only | Clear, but insufficient without artifact provenance. |
| Manifest plus checksums only | Good audit trail, but no single source of version truth. |
| Combined `VERSION` plus manifest/checksum contract | Reproducible, auditable and aligned with the current release checks. |

## Criteria

- release version is easy to verify locally
- published package contents stay intentional
- provenance artifacts remain reproducible from the source tree
- release checks are cheap enough to run often

## Consequences

Positive:

- support and auditability improve
- version drift is easier to detect
- publish-surface regressions are more visible

Negative:

- release steps become slightly more formal
- provenance artifacts need to be kept in sync with release tooling

## Risks

- if `VERSION` and `package.json` diverge, release trust erodes quickly
- provenance files can become stale if release tooling changes without fixture coverage

## Follow-Up

- keep `perf:verify-release-version` and `perf:verify-pack-topology` in the release path
- keep `perf:verify-release-reproducibility` and `perf:verify-release-workflow-policy` in the release path
- keep branch-policy fixtures for release, hotfix, exact main-to-dev sync, and
  rejected provenance mutations
- keep the canonical CI helper calls exact and preserve their fail-closed
  behavioral probes
- ensure release manifests and checksums stay in the same atomic publish flow
- keep source fingerprints in the manifest in sync with the checked-in files
- update the release workflow when the publish surface changes
