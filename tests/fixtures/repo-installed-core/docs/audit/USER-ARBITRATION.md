# User Arbitration Log

Purpose:

- record explicit user decisions that unblock coordinator escalations
- preserve a human-readable trace of why automatic relay was resumed or redirected
- avoid silent override of coordinator safeguards

Rule/State boundary:

- this file is a state log
- canonical workflow rules remain in `SPEC.md`
- agent execution rules remain in `AGENTS.md`

## Entries

Append one section per explicit arbitration outcome.

Recommended fields:

- timestamp
- decision
- note
- optional goal override
- resulting next relay expectation

## Notes

- record arbitration before resuming automatic multi-agent dispatch after `dispatch_status=escalated`
- keep the machine-readable companion event in `.aidn/runtime/context/coordination-history.ndjson`
- refresh `COORDINATION-SUMMARY.md` after recording arbitration
