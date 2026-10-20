# Context efficiency benchmarks, 2026-10-20

These reports preserve three distinct local attempts associated with PR #148.
They describe pre-release candidates based on 0.13.3, not the published 0.13.3
package and not a native qualification of a later versioned release archive.
The original reports are retained verbatim. Their historical statements such
as "No merge or release" describe the time of execution.

| Attempt | Outcome | AIDN seconds | Baseline seconds | AIDN cumulative input | Baseline cumulative input |
| --- | --- | ---: | ---: | ---: | ---: |
| [034](2026-10-20-034.md) | Complete independent pair | 1716.232 | 601.546 | 11,713,232 | 1,027,465 |
| [035](2026-10-20-035.md) | Incomplete AIDN workflow; retained failure | 707.112 | 441.469 | 4,535,091 | 664,983 |
| [036](2026-10-20-036.md) | Complete independent pair | 1691.904 | 405.902 | 13,533,955 | 646,833 |

Each arm had an independent 45-minute ceiling, including coordination and
closure, with early completion allowed. MXC used the same model and reasoning
profile within each pair, without model or canonical-context prewarming.
Application storage was SQLite for both arms; AIDN governance used PostgreSQL.
No arm was reused between attempts. Preparation and independent evaluation
were outside the arm clock. The incomplete 035 result is not a completed
comparison and its application success does not qualify continuation or closure.

The final candidate source was
`2c56b17378606e0945b490a7e338378167b88248`; its local archive SHA256 was
`ce415e60668a70c4483294188a6a9605c8aae1b052ebd2eea26e559db65d5e77`.
Attempt 034 used the earlier source and archive identified in its report.
Raw receipts and transcripts remain local; these repository reports contain
the bounded publication record rather than credentials or personal paths.

Compact inventories reduced the same fixture's output from 53,463 to 7,093
bytes. Canonical deltas reduced PostgreSQL worker exchanges from two to one
inside the existing locked transaction. Across separate 034 and 036 runs,
median delta CLI time changed from 6.041 to 4.936 seconds. These component
observations do not establish a causal end-to-end saving: 036 AIDN cumulative
input was higher than 034, and both completed pairs used more time and tokens
with AIDN than with their own baseline. Cached input and reasoning output are
subsets, not additional token sums; these counts are not monetary charges.

Fixture tests, real CLI tests against PostgreSQL, and native MXC workflow
execution are separate evidence layers. Attempt 036 proved development,
handoff, native continuation, tests, cycle closure, session closure and owned
process shutdown. **Actual native `new_context` calls were zero in both arms.**
Scheduled conversations do not prove that call. Advisory performance warnings
remain warnings, and historical refusals remain failures.

These unblinded individual pairs support descriptive observations only, with
no statistical, causal or financial saving claim. Source-controlled reports
are release documentation; they remain outside the installable package allowlist.
