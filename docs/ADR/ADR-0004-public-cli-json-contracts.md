# ADR-0004 - Public CLI JSON Contracts

## Status

Proposed

## Date

2026-05-18

## Context

Many `aidn` commands expose `--json` and are useful as local automation APIs. Their output shapes have historically been defined by implementation objects rather than explicit contracts.

This creates integration risk for agents, scripts, tests and future local dashboards.

## Decision

AIDN will maintain versioned JSON Schemas for public CLI outputs under:

```text
src/core/contracts/cli-output/
```

Each schema will:

- use the naming pattern `<group>-<subcommand>.v<major>.schema.json`
- expose `x-aidn-command`
- expose `x-aidn-contract-version`
- define required top-level fields
- leave nested objects extensible until golden fixtures are added

Initial v1 schemas cover:

- `aidn runtime project-runtime-state --json`
- `aidn runtime project-handoff-packet --json`
- `aidn runtime pre-write-admit --json`
- `aidn runtime db-status --json`
- `aidn runtime coordinator-next-action --json`
- `aidn runtime coordinator-dispatch-plan --json`
- `aidn runtime coordinator-orchestrate --json`
- `aidn runtime handoff-admit --json`
- `aidn project config --list --json`
- `aidn codex hydrate-context --json`

## Options Compared

| Option | Result |
|---|---|
| Continue ad hoc output | Fast, but fragile for automation. |
| Document examples only | Helpful, but not enforceable. |
| Strict schemas immediately | Strong, but risks overfitting unstable nested payloads. |
| Shallow v1 schemas, then golden tests | Stable top-level contract with low migration risk. |

## Criteria

- compatibility with current outputs
- enforceability in fixtures
- low maintenance cost
- ability to tighten contracts progressively

## Consequences

Positive:

- integrations get stable anchors
- future breaking changes can be versioned
- CLI output drift can be tested

Negative:

- schemas add maintenance overhead
- v1 is intentionally shallow and does not replace golden tests

## Risks

- schemas may become stale without a verifier
- consumers may over-interpret extensible nested objects

## Follow-Up

- add `perf:verify-cli-output-contracts`
- add golden fixtures for the v1 commands
- decide whether output payloads should embed `schema_version` in a later major contract
