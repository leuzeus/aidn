# CLI Output Contracts

This directory defines the first stable contract registry for JSON emitted by public `aidn` commands.

The contracts are intentionally shallow in v1:

- they stabilize command identity and required top-level fields
- nested objects remain extensible with `additionalProperties: true`
- payloads do not yet need to embed `schema_version`; the schema file is the versioned contract
- future versions may tighten nested structures after golden fixtures are in place

Command effect classes are governed separately in `src/core/cli/effect-policy.mjs`.
That policy records whether a public command is `read-only`, `preview`, `projector`, `mutating`, or `executor`, and provides the safe arguments used by the no-implicit-write fixture gate.

For a current public/internal inventory of the CLI surface, see `docs/CLI_SURFACE_INVENTORY.md`.

Naming convention:

- `<group>-<subcommand>.v<major>.schema.json`
- one schema per public command output shape
- use `x-aidn-command` for the canonical CLI command
- use `x-aidn-contract-version` for the external contract version

Compatibility policy:

- removing a required field requires a new major schema
- adding optional fields is allowed in the same major schema
- legacy fields should stay accepted until the related migration ticket explicitly removes them
- local machine paths and secrets must never be encoded as schema constants
- `runtime-governance-diagnostics` may add optional coverage tables for residual concepts, but those tables must remain descriptive and must not reclassify excluded concepts as governed runtime state

Initial v1 commands:

- `aidn bootstrap --json`
- `aidn bootstrap --dry-run --json`
- `aidn runtime project-runtime-state --json`
- `aidn runtime project-handoff-packet --json`
- `aidn runtime pre-write-admit --json`
- `aidn runtime db-status --json`
- `aidn runtime db-only-readiness --json`
- `aidn runtime persistence-status --json`
- `aidn runtime db-migrate --json`
- `aidn runtime persistence-migrate --json`
- `aidn runtime db-backup --json`
- `aidn runtime persistence-backup --json`
- `aidn runtime persistence-adopt --json`
- `aidn runtime persistence-source-diagnose --json`
- `aidn runtime persistence-source-normalize --json`
- `aidn runtime shared-coordination-migrate --json`
- `aidn runtime shared-coordination-status --json`
- `aidn runtime shared-coordination-projects --json`
- `aidn runtime shared-runtime-reanchor --json`
- `aidn runtime shared-coordination-bootstrap --json`
- `aidn runtime shared-coordination-backup --json`
- `aidn runtime shared-coordination-restore --json`
- `aidn runtime shared-coordination-doctor --json`
- `aidn runtime governance-diagnostics --json`
- `aidn runtime list-agent-adapters --json`
- `aidn runtime verify-agent-roster --json`
- `aidn runtime project-agent-health-summary --json`
- `aidn runtime project-agent-selection-summary --json`
- `aidn runtime project-integration-risk --json`
- `aidn runtime project-multi-agent-status --json`
- `aidn runtime project-coordination-summary --json`
- `aidn runtime sync-db-first --json`
- `aidn runtime sync-db-first-selective --json`
- `aidn runtime mode-migrate --json`
- `aidn runtime session-plan --json`
- `aidn runtime db-first-artifact --json`
- `aidn runtime artifact-store list --json`
- `aidn runtime artifact-store get --json`
- `aidn runtime artifact-store upsert --json`
- `aidn runtime artifact-store materialize --json`
- `aidn runtime coordinator-select-agent --json`
- `aidn runtime coordinator-next-action --json`
- `aidn runtime coordinator-loop --json`
- `aidn runtime coordinator-dispatch-plan --json`
- `aidn runtime coordinator-dispatch-execute --json`
- `aidn runtime coordinator-orchestrate --json`
- `aidn runtime coordinator-resume --json`
- `aidn runtime coordinator-suggest-arbitration --json`
- `aidn runtime coordinator-record-arbitration --json`
- `aidn runtime handoff-admit --json`
- `aidn project config --list --json`
- `aidn codex hydrate-context --json`
- `aidn codex workflow-step --json`
