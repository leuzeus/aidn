# Agent Adapters

Purpose: define the minimum contract for external agent adapters used by multi-agent dispatch.

This file is operational guidance for installed repositories.
It does not replace `AGENTS.md`, `WORKFLOW.md`, or `SPEC.md`.

## When To Read This

Read this file when:

- configuring `docs/audit/AGENT-ROSTER.md`
- validating `docs/audit/AGENT-ROSTER.md` with `aidn runtime verify-agent-roster --target . --json`
- registering an external adapter through `adapter_module`
- debugging why a selected adapter was rejected or ignored
- diagnosing one relay with `aidn runtime coordinator-select-agent`
- inspecting available adapters through `aidn runtime list-agent-adapters`
- checking which adapters are actually ready with `docs/audit/AGENT-HEALTH-SUMMARY.md`

## Minimal Contract

An external adapter module must export either:

- a default factory
- or a named factory referenced by `adapter_export`

The factory receives:

- `id`
- `config`
- `settings`
- `targetRoot`
- `modulePath`

It must return an object with:

- `getProfile()`
- `canHandleRole({ role, action })`
- `runCommand({ command, commandArgs, commandLine, envOverrides })`

It may also return:

- `checkEnvironment({ targetRoot, probeCommand, probeArgs })`

## Required Profile Shape

`getProfile()` must return:

- `id`
- `label`
- `default_role`
- `supported_roles`
- `capabilities_by_role`

Expected role values:

- `coordinator`
- `executor`
- `auditor`
- `repair`

## Behavioral Expectations

An adapter must:

- be deterministic for the same `role + action`
- reject unsupported role/action pairs through `canHandleRole()`
- return command execution results compatible with Node `spawnSync`
- preserve stdout/stderr so coordination traces stay meaningful
- expose `checkEnvironment()` when the default `runCommand(process.execPath --version)` probe would not be representative

An adapter must not:

- bypass workflow gates
- mutate workflow artifacts on its own
- hide command failures

## Roster Registration

The adapter is declared in `docs/audit/AGENT-ROSTER.md`:

```md
## external-example-auditor
enabled: no
priority: 120
roles: auditor
adapter_module: .aidn/runtime/agents/example-external-auditor.mjs
adapter_export: createExampleExternalAuditorAdapter
notes: installed example of an external auditor adapter
```

Field meaning:

- `enabled`: whether selection may consider this adapter
- `priority`: added to selection score
- `roles`: visible roles exposed through the roster
- `adapter_module`: repo-relative or absolute module path
- `adapter_export`: factory name, default `default`

Unknown extra keys are passed to `settings`.

## Installed Example

The core pack installs one disabled example:

- `.aidn/runtime/agents/example-external-auditor.mjs`

This example is meant to show:

- module shape
- exported factory shape
- profile structure
- Windows-compatible `runCommand()` behavior

## Safe Rollout Pattern

1. keep the adapter disabled
2. verify the module path exists after install
3. enable it in `AGENT-ROSTER.md`
4. prefer it only for one role first
5. run coordination verification before broader use

## Debug Checklist

If an adapter is not selected:

1. check `AGENT-ROSTER.md`
2. run `aidn runtime list-agent-adapters --target . --json`
3. run `aidn runtime coordinator-select-agent --target . --role <role> --action <action> --json`
4. check the module path
5. check the exported factory name
6. check `supported_roles`
7. check `canHandleRole()` for the requested `role + action`
8. check selection priority against other adapters

If dispatch fails after selection:

1. inspect `docs/audit/COORDINATION-LOG.md`
2. inspect `.aidn/runtime/context/coordination-history.ndjson`
3. confirm `runCommand()` handles the platform shell correctly
4. if needed, add or fix `checkEnvironment()` so readiness reflects real adapter availability

If you only need the projected human summary:

- read `docs/audit/AGENT-HEALTH-SUMMARY.md` for readiness and capability health
- read `docs/audit/AGENT-SELECTION-SUMMARY.md`
- refresh it with `aidn runtime project-agent-selection-summary --target . --json`
- or let `npx aidn codex hydrate-context --target . --skill <skill> --json` refresh it automatically when the artifact already exists
