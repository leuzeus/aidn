# ADR-0005 - Read/Write CLI Semantics

## Status

Accepted

## Date

2026-05-18

## Context

Some AIDN commands that are useful for inspection also project or refresh Markdown digests. For example, runtime state and handoff packet commands can write artifacts while returning JSON.

This is powerful for installed workflows, but risky for automation that expects `--json` to mean read-only.

## Decision

AIDN will classify CLI commands by effect:

- `read-only`: reads and prints, no target mutation
- `preview`: computes a plan or diagnostic without applying it
- `projector`: writes or refreshes derived artifacts
- `mutating`: changes canonical state, runtime state, docs or backend data
- `executor`: runs command or agent sequences

Rules:

- `--json` controls output format, not write permission
- `--dry-run` or preview commands must not mutate target state
- `--write`, `--apply`, or `--execute` must mark high-impact mutation or execution
- historical projector commands must either keep their behavior documented or gain an explicit non-mutating read path

## Options Compared

| Option | Result |
|---|---|
| Treat all `--json` as read-only immediately | Clean, but likely breaking for existing projector commands. |
| Keep current behavior undocumented | Compatible, but surprising and unsafe for automation. |
| Add explicit effect classes and migrate projectors | Balanced transition with visible risk. |

## Criteria

- avoid surprising fixture and project mutations
- keep installed workflow ergonomics
- maintain backward compatibility during transition
- make automation behavior predictable

## Consequences

Positive:

- safer command composition
- clearer documentation and tests
- easier contract verification

Negative:

- transitional behavior may require dual modes or deprecation notes
- some existing examples may need updates

## Risks

- changing projector defaults too quickly could break existing workflows
- leaving projectors unchanged too long keeps automation risk

## Follow-Up

- normalize `project-runtime-state` and `project-handoff-packet`
- add non-mutation fixture tests
- document command effect classes in CLI docs
