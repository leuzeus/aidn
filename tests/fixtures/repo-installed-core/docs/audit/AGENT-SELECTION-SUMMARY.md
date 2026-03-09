# Agent Selection Summary

## Summary

updated_at: 2026-03-09T16:54:17.331Z
roster_found: yes
default_requested_agent: auto
registered_adapter_count: 1
adapter_count: 6
roster_verification: pass
roster_issue_count: 0

## Roster Verification

- status: pass

## Installed Adapters

- codex: source=built-in, enabled=yes, health=ready, priority=10, roles=coordinator, executor, auditor, repair
- codex-auditor: source=built-in, enabled=yes, health=ready, priority=40, roles=auditor
- codex-repair: source=built-in, enabled=yes, health=ready, priority=50, roles=repair
- external-example-auditor: source=registered, enabled=no, health=disabled, priority=120, roles=auditor
- local-shell-auditor: source=built-in, enabled=no, health=disabled, priority=80, roles=auditor
- local-shell-repair: source=built-in, enabled=no, health=disabled, priority=90, roles=repair

## Auto Selection Preview

- coordinator + reanchor: codex (selected)
- coordinator + relay: codex (selected)
- coordinator + close: codex (selected)
- coordinator + coordinate: codex (selected)
- executor + implement: codex (selected)
- executor + relay: codex (selected)
- auditor + audit: codex-auditor (selected)
- auditor + analyze: codex-auditor (selected)
- auditor + relay: codex-auditor (selected)
- repair + repair: codex-repair (selected)
- repair + relay: codex-repair (selected)

## Notes

- Use `aidn runtime list-agent-adapters --target . --json` for the full machine-readable view.
- Use `aidn runtime coordinator-select-agent --target . --role <role> --action <action> --json` to diagnose one relay.

