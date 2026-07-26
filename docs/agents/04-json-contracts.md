# 04 JSON Contracts

## Purpose

Every stable public JSON output must have an explicit contract under `src/core/contracts/cli-output/`.

Contracts keep the public CLI surface predictable for agents, scripts, and tests.

## Contract Rules

- every stable public JSON output needs a versioned schema
- v1 schemas should stay shallow and additive
- do not break v1 without a new versioned schema
- create v2 if the shape must change in a breaking way
- update fixtures and gates whenever a contract changes

## Recommended Top-Level Fields

Use the relevant subset of these fields when they apply:

- `contract_version`
- `command`
- `effect_class`
- `dry_run`
- `written`
- `write_targets`
- `source_of_truth`
- `source_mode`
- `lifecycle_status`
- `runtime_state_mode`
- `shared_coordination_sync`
- `errors`
- `warnings`

Some current v1 payloads also use `issues` and `operations` instead of `errors`.
Do not rename those fields in place without a version bump and fixture update.

## Practical Rules

- keep the schema file as the versioned contract
- keep `x-aidn-command` and `x-aidn-contract-version` aligned with the command name
- when preview and explicit-write variants share one additive payload, keep the preview in `x-aidn-command` and enumerate both exact forms in `x-aidn-commands`
- do not encode local paths or secrets as schema constants
- keep nested objects extensible until the fixtures and gates are ready to tighten them

The executable contract verifier validates every schema keyword used by this
registry, recursively. The supported validation vocabulary is `type`,
`required`, `properties`, `const`, `enum`, `items`, and
`additionalProperties`; schema annotations remain descriptive. Adding another
validation keyword requires implementing it in the deterministic validator and
adding a rejecting fixture before that keyword can appear in a public schema.

Contract coverage is closed in both directions:

- every active public contract has exactly one isolated executable case
- every executable case resolves to exactly one active schema
- each case validates an output produced by the real command
- negative fixtures prove that each supported validation keyword rejects an
  invalid payload
- redaction checks remain separate from structural schema validation

## Change Rule

If the payload shape changes, update the schema, the fixture coverage, and the relevant gate in the same change set.
