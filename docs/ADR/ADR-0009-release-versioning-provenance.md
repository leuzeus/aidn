# ADR-0009 - Release Versioning Provenance

## Status

Accepted

## Date

2026-05-24

## Context

AIDN ships as a package source repository with local release artifacts, manifests and checksums. The release surface is already validated by `build-release`, `npm pack --dry-run` and topology checks, but the source of version truth and the provenance of published artifacts still need an explicit architectural home.

Without a clear release provenance ADR, it is too easy for `VERSION`, `package.json`, the release manifest and the published package surface to drift apart.

## Decision

AIDN will treat release versioning and provenance as a governed contract.

Rules:

- `VERSION` is the primary version source for the repository release line
- `package.json` must stay aligned with `VERSION`
- `tools/build-release.mjs` produces release artifacts from the checked-in source state
- `release/manifest.json` and `release/checksums.txt` are the release provenance outputs
- the manifest records source fingerprints for `VERSION` and `package.json` so the source of truth can be verified from the build output itself
- the manifest records the git commit used for the build so provenance can be verified against the current source tree
- `npm pack --dry-run` remains part of the publish-surface guard
- internal docs, pilot-specific details and non-published fixtures must not leak into the package payload

Release provenance should answer:

- what version is being released
- which source files were included
- which checks ran before publish
- which checksum set matches the artifact payload
- which git commit produced the manifest

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
- ensure release manifests and checksums stay in the same atomic publish flow
- keep source fingerprints in the manifest in sync with the checked-in files
- update the release workflow when the publish surface changes
