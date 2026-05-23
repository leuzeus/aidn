# User Arbitration Log

Purpose:

- record explicit user decisions that unblock coordinator escalations
- preserve a human-readable trace of why automatic relay was resumed or redirected
- avoid silent override of coordinator safeguards

Rule/State boundary:

- this file is a state log
- canonical workflow rules remain in `SPEC.md`
- agent execution rules remain in `AGENTS.md`

## Summary

contract_version: critical-markdown-v1
updated_at: 2026-03-10T08:35:00.000Z
source_of_truth: .aidn/runtime/context/*
source_mode: explicit
lifecycle_status: refreshed
owner: git-9447929f5071671f
steward: aidn-runtime

## Entries

Append one section per explicit arbitration outcome.

Recommended fields:

- timestamp
- decision
- note
- optional goal override
- optional integration strategy override
- resulting next relay expectation

## Notes

- record arbitration before resuming automatic multi-agent dispatch after `dispatch_status=escalated`
- keep the machine-readable companion event in `.aidn/runtime/context/coordination-history.ndjson`
- refresh `COORDINATION-SUMMARY.md` after recording arbitration
