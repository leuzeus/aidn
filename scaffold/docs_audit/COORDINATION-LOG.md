# Coordination Log

Purpose:

- record coordinator dispatch decisions and executions
- keep a short trace of multi-agent routing over time
- preserve a human-readable coordination trail without redefining workflow rules

Rule/State boundary:

- this file is a coordination state log
- canonical workflow rules remain in `SPEC.md`
- execution contract remains in `AGENTS.md`

## Entries

Append one section per explicit coordinator dispatch execution.

Recommended fields:

- timestamp
- selected agent
- recommended role/action
- dispatch status
- execution status
- entrypoint
- key notes
- executed step summary

## Notes

- `coordinator-dispatch-plan` stays read-only and should not mutate this file
- `coordinator-dispatch-execute --execute` may append to this log
- `dry-run` should describe the planned log entry without writing it
- structured runtime history may also be appended under `.aidn/runtime/context/coordination-history.ndjson`
- refresh `COORDINATION-SUMMARY.md` after each executed dispatch
