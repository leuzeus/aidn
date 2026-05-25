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
- do not encode local paths or secrets as schema constants
- keep nested objects extensible until the fixtures and gates are ready to tighten them

## Change Rule

If the payload shape changes, update the schema, the fixture coverage, and the relevant gate in the same change set.
