# ADR-0010 - Adaptive Repository Governance

## Status

Accepted

## Date

2026-08-01

## Amendment

2026-08-01: executable admission now owns pull-request gate selection and the
final rollup. Branch protection on `dev` and `main` requires exactly
`Governance Admission`; the temporary compatibility check names used during the
live migration have been removed.

## Context

AIDN already governs 45 verification gates through
`package/catalogs/gates.v1.json`. Forty-two are required in delivery contexts.
Before this decision, pull-request workflows selected those required gates 107
times because broad aggregate verification and specialized workflows overlapped.
The controls remained useful, but their duplicated execution increased context
load, CI latency, and false-block risk without adding distinct evidence.

AIDN is a personal, agent-driven project. The same person may hold the project
owner, technical owner, evidence operator, and release authority roles. The
governance model therefore needs strong executable invariants without assuming
a fictitious multi-person approval structure.

## Decision

The existing gate catalog remains the single executable authority. It gains a
versioned adaptive-routing policy rather than being shadowed by another source
of truth.

The internal, read-only resolver
`tools/verify/resolve-governance-route.mjs` emits one complete
`governance-route.v1` document on standard output. It derives its route from
the `base...head` Git diff, target and source branches, path policy, and the
surface catalog. It records exact provenance, changed paths, reasons,
escalations, selected families and gates, deferred evidence, and final state.
It is not part of the public `aidn` CLI or its JSON contracts.

Delivery lanes are ordered and upward-only:

- `EXPLORE` is local or draft-only. It cannot claim merge or delivery readiness.
- `FAST` is limited to recognized historical or non-normative documentation and
  selects only cleanliness, documentation, and security families.
- `STANDARD` is the default for a pull request to `dev`. It selects transverse
  invariants and the families implicated by the changed paths.
- `ASSURED` applies to `main`, public surfaces, authority, contracts, effects,
  persistence, migrations, shared coordination, security, permissions, CI,
  release, and other critical paths. It selects all 42 required obligations.
- `EMERGENCY` is an overlay for an exact `hotfix/vX.Y.Z` pull request to `main`.
  It retains `ASSURED` gates, permits only non-blocking observability evidence to
  be deferred, expires when the pull request closes, rolls back by revert or
  patch, and is regularized through `main` to `dev` synchronization.

An explicit lane request may increase assurance but never reduce it. A path
missing from route policy cannot obtain `FAST`; it uses conservative `STANDARD`
families. Missing diff or provenance evidence fails closed to `ASSURED`. The
surface catalog may only raise risk, never lower it.

The change is activated in two steps:

1. advisory classification publishes the route while existing workflows and
   branch protections remain intact;
2. a single admission workflow executes each selected family once and exposes
   the final `Governance Admission` rollup.

For `ASSURED`, every required obligation executes exactly once on the pull
request. Publication from a push to `main` keeps its own complete verification
before tagging or creating a GitHub Release; that repetition at the publication
boundary is intentional.

The package-source repository does not adopt complete installed-client
dogfooding in its root. `scaffold/*` remains source, `tests/fixtures/*` remains
test corpus, and any ignored root `.aidn/` state remains non-canonical local
debt outside this reform.

## Consequences

Positive:

- risk and evidence depth become explicit and reproducible;
- `FAST` and targeted `STANDARD` changes avoid unrelated gate families;
- `ASSURED` retains the complete obligation set;
- duplicate gate execution becomes an executable policy failure;
- route artifacts make CI decisions inspectable without changing the public CLI.

Negative:

- path policy and workflow policy must evolve together;
- conservative fallback can make an unclassified path nearly as expensive as
  `ASSURED` until it is deliberately classified;
- live protection migration requires staged coordination so the old and new
  checks overlap before the old contexts are removed.

## Rejected Alternatives

- A second routing catalog was rejected because it would create competing
  authorities.
- Using surface-catalog absence as low-risk evidence was rejected because the
  catalog is not an exhaustive path classifier.
- Skipping invariants during emergency work was rejected because urgency does
  not reduce product risk.
- Adding mandatory approvals or a fictitious `CODEOWNERS` file was rejected for
  the current personal project context.

## Rollback

Before protection activation, abandon or revert the governance branch. After
activation, restore the previous workflows and required contexts from the prior
commit. No product data, runtime schema, or persistence migration is involved.

## Verification

- route fixtures A through F and adversarial downgrade/fallback cases;
- gate-catalog mutation probes;
- workflow syntax and semantic policy checks;
- branch-policy fixtures;
- documentation-reference checks;
- clean `verify:all -- --context dev` at commit boundaries.
