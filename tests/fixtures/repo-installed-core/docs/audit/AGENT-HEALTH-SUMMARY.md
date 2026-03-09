# Agent Health Summary

Purpose:

- summarize whether each configured adapter is truly usable in the current environment
- expose the effective roles and actions available through the roster
- surface degraded or unavailable adapters before dispatch time

## Summary

updated_at: 2026-03-09T16:54:17.046Z
roster_found: yes
default_requested_agent: auto
pass: yes
issue_count: 0
warning_count: 0

## Adapter Health

- codex: health=ready, enabled=yes, source=built-in
  reason: adapter is enabled and loadable
  environment: ready
  environment_reason: adapter executed the default environment probe successfully
  roles: coordinator, executor, auditor, repair
  coordinator: reanchor, relay, close, coordinate
  executor: implement, relay
  auditor: audit, analyze, relay
  repair: repair, relay
- codex-auditor: health=ready, enabled=yes, source=built-in
  reason: adapter is enabled and loadable
  environment: ready
  environment_reason: adapter executed the default environment probe successfully
  roles: auditor
  auditor: audit, analyze, relay
- codex-repair: health=ready, enabled=yes, source=built-in
  reason: adapter is enabled and loadable
  environment: ready
  environment_reason: adapter executed the default environment probe successfully
  roles: repair
  repair: repair, relay
- external-example-auditor: health=disabled, enabled=no, source=registered
  reason: adapter is disabled by roster
  environment: unknown
  environment_reason: environment probe skipped because the adapter is disabled by roster
  roles: auditor
  auditor: audit, analyze, relay
- local-shell-auditor: health=disabled, enabled=no, source=built-in
  reason: adapter is disabled by roster
  environment: unknown
  environment_reason: environment probe skipped because the adapter is disabled by roster
  roles: auditor
  auditor: audit, analyze, relay
- local-shell-repair: health=disabled, enabled=no, source=built-in
  reason: adapter is disabled by roster
  environment: unknown
  environment_reason: environment probe skipped because the adapter is disabled by roster
  roles: repair
  repair: repair, relay

## Notes

- `ready` means the adapter is enabled and loadable with a roster-compatible role set
- `disabled` means the adapter is configured but intentionally excluded by the roster
- `degraded` means the adapter loads but the roster config is inconsistent
- `unavailable` means the adapter cannot be loaded or cannot pass the environment probe in the current environment
- `environment` distinguishes loadable adapters from adapters that are actually runnable now
