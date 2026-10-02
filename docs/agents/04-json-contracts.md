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
- machine-readable commands must emit exactly one complete JSON document on
  `stdout`; surrounding whitespace is allowed, but prefixes, suffixes, logs,
  and substring extraction are forbidden
- diagnostics belong on `stderr` and are validated separately from the JSON
  document

The executable contract verifier validates every schema keyword used by this
registry, recursively. The supported validation vocabulary is `type`,
`required`, `properties`, `const`, `enum`, `items`, `additionalProperties`,
`minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `format`, `minItems`,
`maxItems`, `minProperties`, `maxProperties`, `oneOf`, `anyOf`, and `allOf`;
the supported formats are `date-time`, `uri`, and `email`. Schema annotations
remain descriptive. Adding another validation keyword requires implementing it
in the deterministic validator and
adding a rejecting fixture before that keyword can appear in a public schema.

Contract coverage is closed in both directions:

- every active public contract has exactly one isolated executable case
- every executable case resolves to exactly one active schema
- each case validates an output produced by the real command
- each case parses the complete trimmed `stdout` with `JSON.parse`, without a
  recovery fallback
- negative fixtures prove that each supported validation keyword rejects an
  invalid payload
- redaction checks remain separate from structural schema validation

## Change Rule

If the payload shape changes, update the schema, the fixture coverage, and the relevant gate in the same change set.

## Internal Shadow Workflow Definition

ADR-0015 proposes `workflow-definition.v1` under
`src/core/contracts/workflow-definition/`, using the explicit
`workflow-definition` validator profile and contract URI namespace. It has no
public CLI entry, dispatcher or runtime consumer. Descriptors and parity
expectations in `tests/fixtures/workflow-shadow/` are reference data. The
`contracts-workflow-shadow` gate checks schema, links, graph shape and existing
helper behavior; it does not establish executable workflow availability.

## Internal Agent Execution Contracts

ADR-0014 defines internal schemas under `src/core/contracts/agent-execution/`.
They use the explicit `agent-execution` validator profile and
`aidn://contracts/agent-execution/` identifiers. The default `cli-output` profile
and public command registry remain unchanged. Internal schemas are not CLI
commands and must not acquire fake `x-aidn-command` entries or public output cases.
Both profiles reject unsupported validation keywords. Positive and adversarial
payloads, semantic checks and executor doubles are covered by the dedicated
`runtime-agent-execution-contracts` gate.

The eighteen schemas cover sixteen kinds: descriptor, availability, plan, run, delegated task,
attempt, delegation, request, event, result, acceptance, supervisor, prepared
and applied integration, the pre-Git integration intent, and final run validation. Their pure validity does not
prove a working executor, live lease, Git reference or native admission. Task
validation selection is optional for v1 compatibility; final run validation
always covers the complete plan and audit on the exact integrated SHA.
An optional frozen verification configuration preserves historical v1 fingerprints.
It pins the executable, environment, exact regular control files, audit policy,
verification limits and SHA-256 of an explicitly selected Ed25519 public key in
SPKI DER form. Delegated operations cannot touch control files. An integration
intent binds the accepted source, expected parent, workspace, commit identity and
original creator before Git preparation. The prepared record retains its actual
producer and references the intent hash. These are model bindings, not live leases.
Contract validity and runtime availability remain separate evidence.

Plan v2 adds the required `assurance_profile: codex-cooperative.v1`. Plan v1
keeps its original closed shape and fingerprint; normalization does not promote
it to v2. The selected profile participates in the plan hash. Run, task and
attempt contracts retain their existing version and bind to that hash. The
cooperative validation configuration/qualification are v3 and explicitly state
`read_isolation: not_guaranteed`; strict and cooperative evidence cannot mix.
Public preview preconditions expose these limitations without claiming native
availability. The PostgreSQL JSONB plan retains the exact version and profile.

Plan v3 separately selects `codex-cooperative.v2` and boundary configuration and
qualification v4. These declare `read_isolation: not_guaranteed` and
`network_isolation: not_guaranteed`; qualification requires `network_disabled:
false`. Earlier versions still require network denial. The preview exposes the
new limitation in its action hash. Native write, process and exact-SHA proofs
remain required; network diagnostics are separate from v4 qualification.

Internal plan/run runtime scope keys accept the bounded canonical form
`runtime:project=<project_id>:workspace=<workspace_id>:profile=<profile>` produced
by the runtime context resolver, separately from historical internal IDs. The
embedded project/workspace must match the canonical reference. No other ID
syntax or existing plan fingerprint changes. The public supervisor requires
exact equality with the resolved runtime scope before reading its canonical
digest; a legacy short ID is not an alias for that context. PostgreSQL reads,
reservations and ordinary canonical writers use that same key and reservation
fence, without schema migration or implicit context adoption.

## Activation Refusals

Activation refusals use `activation-refusal.v1`, registered as an alternative for
the same command rather than changing its logical effect class. Required
`written: false` and `refused: true` report the observed refusal. Diagnostic and
pre-write admission contracts include compact activation, while native trust,
secret recovery pre-images and backend credentials are never part of that shape.
