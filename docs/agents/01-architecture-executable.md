# 01 Architecture Executable

## Purpose

AIDN is governed by executable architecture.

Architecture intent must stay aligned with the behavior that the code, CLI, policies, contracts, fixtures, docs, ADRs, and CI gates actually enforce.

## Alignment Rule

No public surface drift.

If a public behavior changes, the documentation and executable checks must change with it.

## Surfaces To Keep Aligned

- code
- CLI
- policies
- JSON contracts
- fixtures
- docs
- ADR
- CI gates

## Public Surface Checklist

When a change touches a public surface, check all of the following:

- `README.md`
- `docs/CLI_SURFACE_INVENTORY.md`
- `src/core/cli/effect-policy.mjs`
- the relevant runtime script or adapter
- the relevant schema under `src/core/contracts/cli-output/`
- the relevant fixtures
- the relevant gates
- the relevant ADR

## Practical Rule

If the docs say one thing and the executable behavior says another, the architecture is drifting.

In that case, update the executable behavior, the docs, or the policy together instead of accepting the mismatch.
