# CLI Output Contracts

This directory defines the first stable contract registry for JSON emitted by public `aidn` commands.

The contracts are intentionally shallow in v1:

- they stabilize command identity and required top-level fields
- nested objects remain extensible with `additionalProperties: true`
- payloads do not yet need to embed `schema_version`; the schema file is the versioned contract
- future versions may tighten nested structures after golden fixtures are in place

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

Initial v1 commands:

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
