# Agent Selection Summary

Purpose: short readable digest of the adapters currently installed and how `auto` routing will resolve by default.

This file is projected from:

- `docs/audit/AGENT-ROSTER.md`
- installed adapters in `.aidn/runtime/agents/`
- built-in adapter registry

Refresh with:

- `aidn runtime project-agent-selection-summary --target . --json`

Suggested use:

- read after changing `AGENT-ROSTER.md`
- read after installing a new external adapter
- use as a quick human summary before deeper debugging with `list-agent-adapters` or `coordinator-select-agent`
