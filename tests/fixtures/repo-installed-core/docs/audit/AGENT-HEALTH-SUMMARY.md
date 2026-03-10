# Agent Health Summary

Purpose:

- summarize whether each configured adapter is truly usable in the current environment
- expose the effective roles and actions available through the roster
- surface degraded or unavailable adapters before dispatch time

## Summary

updated_at: template
roster_found: yes
default_requested_agent: auto
pass: yes
issue_count: 0
warning_count: 0

## Adapter Health

- codex: health=ready, enabled=yes, source=built-in
  reason: adapter is enabled and loadable
  roles: coordinator, executor, auditor, repair
  coordinator: reanchor, relay, close, coordinate
  executor: implement, relay
  auditor: audit, analyze, relay
  repair: repair, relay

## Notes

- `ready` means the adapter is enabled and loadable with a roster-compatible role set
- `disabled` means the adapter is configured but intentionally excluded by the roster
- `degraded` means the adapter loads but the roster config is inconsistent
- `unavailable` means the adapter cannot be loaded in the current environment
