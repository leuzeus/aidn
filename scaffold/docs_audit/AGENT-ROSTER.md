# Agent Roster

Purpose: configure which installed agent adapters are available for multi-agent dispatch.

For the external adapter contract, read `docs/audit/AGENT-ADAPTERS.md`.
Validate this file with `aidn runtime verify-agent-roster --target . --json`.

Optional adapter registration fields per section:

- `adapter_module`: repo-relative or absolute module path to load an adapter from
- `adapter_export`: exported factory name to invoke from that module, default `default`

updated_at: template
default_agent_selection: auto

## codex
enabled: yes
priority: 10
roles: coordinator, executor, auditor, repair
notes: general-purpose fallback adapter

## codex-auditor
enabled: yes
priority: 40
roles: auditor
notes: preferred for audit and analysis relays

## codex-repair
enabled: yes
priority: 50
roles: repair
notes: preferred for repair relays

## local-shell-auditor
enabled: no
priority: 80
roles: auditor
notes: optional shell-backed auditor adapter for heterogeneous routing tests

## local-shell-repair
enabled: no
priority: 90
roles: repair
notes: optional shell-backed repair adapter for heterogeneous routing tests

## external-example-auditor
enabled: no
priority: 120
roles: auditor
adapter_module: .aidn/runtime/agents/example-external-auditor.mjs
adapter_export: createExampleExternalAuditorAdapter
notes: installed example of an external auditor adapter, disabled by default
