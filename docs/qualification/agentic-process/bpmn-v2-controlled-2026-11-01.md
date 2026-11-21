# Controlled BPMN native comparison — 2026-11-01

The retained comparison has four native executions in counterbalanced IR/XML/XML/IR order, two cases per arm. Functional status: **PASS**. Workload-control compliance: **PASS**. The same agentic IR, product, criteria and ten activity-input digest tuples are checked across all four cases. Each result is independently assigned/authenticated; two native threads separate author and reviewer. Every run must retain exact simulation replay, unchanged product bytes, oracle 28/28 and a closed Windows Job Object with zero active processes.

This follows the [earlier one-pair benchmark](bpmn-v2-impact-2026-11-01.md). It separates diagnosis of that pair, correction of the verification protocol, and the new IR/XML comparison. Historical before/after values use different verification strategies and are not a general product speedup estimate.

## Why the earlier pair had 31 rather than 22 responses

| Earlier case | Author native responses | Review native responses | Author code-mode tool cells | Time inside author tool cells (s) | Author input tokens | Review input tokens |
|---|---:|---:|---:|---:|---:|---:|
| ir-a1-r4 | 19 | 3 | 10 | 61.23 | 373,210 | 50,140 |
| xml-b1 | 28 | 3 | 19 | 111.73 | 562,424 | 50,293 |

Each of the nine author activities had exactly one extra tool cell and provider response in the XML case. Review had three responses in both cases. The additional cells account for 50.5 seconds of tool-host time, within the earlier 72.37-second owned-run difference. Almost all additional input tokens occur in the author: 189,214, versus 153 in review. Repeated cumulative snapshots are not summed.

The old wire evidence retained hashes rather than tool arguments. Copied native SQLite logs identify calls and durations, not command bodies. Consequently the exact split between reads, tests, lookups and polling cannot be reconstructed. Nine summaries in each author context reported repeating the same immutable verification. This repetition raises both arms' cost; it does not by itself explain the nine-response difference. The observed difference is tool-call granularity. Compilation happened before native startup and produced identical IR and activity inputs.

## Corrections and controls

- The benchmark uses one batched PowerShell command to read both product files and execute the tests in the initial author activity. The eight later compatible activities reuse that observed evidence only while the trusted host verifies unchanged product and criteria. Summaries must distinguish reuse from newly executed tests. A concrete inconsistency may still trigger investigation or failure.
- Review receives a fresh snapshot and performs its own batched inspection/test. No author verdict or transcript supplies its result; rejection remains protected. No activity is removed and no success is forced.
- The fixed protocol avoids redundant searches for authority files already supplied in developer instructions and requests a sufficiently long normal command yield. Real yields must wait on their returned live handle rather than restart the command.
- Native completed-tool observations retain bounded kind/name/status/exit/duration fields, hashes and byte counts, plus a literal polling marker. Raw command text, arguments, outputs and reasoning are not copied. Activity receipts count distinct native responses. These observations never authorize a result.
- Native-visible case and workspace labels are neutral and equal in length; the input arm is retained only in host metadata. Four fresh product/snapshot roots avoid persisted Windows denials; existing ACLs remain unchanged. Model, effort, role/policy/authority/skill content, product, criteria, host signals, permissions and implementation are pinned. There is no cache purge or concurrent synthetic/gate workload during the cohort.
- Deviations are retained and disclosed rather than silently discarded or rerolled. Provider/cache state and unrelated Windows load are still uncontrolled. With two cases per arm, results remain descriptive.

The normal BPMN path now selects v2 by default and targets the structured agentic engine used for both execution and simulation. Explicit v1 keeps its pinned output/hash compatibility. This verifies the real XML → agentic IR → owned engine connection, not just a profile label. Historical sequential records keep their versioned reader; the ordinary legacy workflow-step/console interfaces are not silently converted into agentic models. No default engine selection authorizes native calls or writes.

The latest published engine reference was checked against GitHub release [v0.19.1](https://github.com/leuzeus/aidn/releases/tag/v0.19.1), published 2026-11-01. Its reducer source is byte-identical to this candidate (SHA-256 cb62e240fbe52916f83921e0a7707468bbba17692bd1366cc4f364fbe573d94e). The [StockFlow evidence](../benchmarks/2026-11-01-stockflow/README.md) already evaluates this agentic engine on application work; it is separate from the present XML/IR experiment. The candidate extends that engine with compilation, control inputs, publication repair and exchange evidence. It retains this branch's source package/dependency lock and does not qualify the complete public v0.19.1 archive. Explicit XML v1 compatibility also uses the same agentic reducer; it is not selection of the legacy sequential engine.

Runtime source: `4501cbd3f26e654529557080feaa0b94e9f5520f`. Implementation SHA-256: `63d9b364163565c781ab972e6ad2ef4a8ec1482bea25eaa824c76113e27a2da1`. Private installed-candidate archive: `361c413cce44434e946206431055c3d72f09b841f6d2e60606e65914632e530e`. Model: `gpt-6.1-sol`, effort `high`, provider fallback disabled. Native executable and trusted hooks remain pinned in the local preflight; their unchanged human approval was observed before model execution.

## Controlled native results

| Case | Arm | Model preparation (ms) | Owned time (s) | Native responses | Input | Cached subset | Output | Total |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| run-01 | IR | 0.19 | 381.5 | 12 | 208,106 | 171,008 | 1,125 | 209,231 |
| run-02 | XML | 23.31 | 388.24 | 12 | 208,514 | 178,688 | 1,180 | 209,694 |
| run-03 | XML | 24.91 | 384.89 | 12 | 209,159 | 172,032 | 1,255 | 210,414 |
| run-04 | IR | 0.22 | 381.36 | 12 | 208,529 | 178,304 | 1,101 | 209,630 |

| Arm | Cases | Mean owned time (s) | Mean native responses | Mean total tokens |
|---|---:|---:|---:|---:|
| IR | 2 | 381.43 | 12 | 209,430.5 |
| XML | 2 | 386.56 | 12 | 210,054 |

Observed XML/IR mean differences: **+1.34% owned time**, **+0.30% total native tokens**. Pairwise results and all ten activity exchange counts are retained in the JSON. Equivalent response/tool counts and identical authored inputs remove the earlier uncontrolled tool-granularity difference. These samples cannot isolate provider latency from unrelated variation or establish a general speedup.

Control checks:

| Case | Commands confined to initial author/review | No tools on eight reuse activities | Explicit reuse summaries | Responses by activity |
|---|---|---|---|---|
| run-01 | PASS | PASS | PASS | 2, 1, 1, 1, 1, 1, 1, 1, 1, 2 |
| run-02 | PASS | PASS | PASS | 2, 1, 1, 1, 1, 1, 1, 1, 1, 2 |
| run-03 | PASS | PASS | PASS | 2, 1, 1, 1, 1, 1, 1, 1, 1, 2 |
| run-04 | PASS | PASS | PASS | 2, 1, 1, 1, 1, 1, 1, 1, 1, 2 |

Owned time includes startup, hooks, governance/canonical operations and cleanup; model preparation is separate. Provider-only inference time is NOT_MEASURED. Native usage sums the latest cumulative counter once per thread. Cached input is a subset of input; reasoning is a subset of output. Worker counters exclude this coordinator chat and are not a billing statement. The cohort consumed **838,969 native tokens** in **1,535.99 seconds** of summed owned-run time. Setup/diagnosis/metadata/offline checks make zero worker model calls. The earlier lot remains closed and its five-attempt costs stay separately reported.

## Avoidable historical verification costs

| Arm | Earlier native responses (n=1) | Controlled mean responses (n=2) | Earlier total tokens | Controlled mean total tokens | Token change |
|---|---:|---:|---:|---:|---:|
| IR | 22 | 12 | 425,280 | 209,430.5 | -50.75% |
| XML | 31 | 12 | 614,834 | 210,054 | -65.84% |

These reductions describe elimination of redundant verification and tool round trips in this immutable corpus. They do not measure a faster compiler or a general application-development gain; historical cache/provider state and sample sizes differ. All ten logical activity results and the independent review remain.

## Local CPU impact and validation

CPU sampling runs after the native cohort, using the default v2 compiler and the earlier frozen baseline reducer (6757c97). The same ten-result, 22-event journal is replayed in 50 counterbalanced pairs; IR parse/XML compile use 500 alternating preparation pairs. This stage has zero provider calls.

| Operation | Median (ms) | p95 (ms) |
|---|---:|---:|
| parse_ir_ms | 0.02 | 0.03 |
| compile_xml_ms | 4.8 | 5.7 |
| baseline_replay_ms | 58.79 | 68.43 |
| candidate_replay_ms | 59.46 | 69.22 |

Default XML compilation produces the same pinned agentic IR and introduces no provider call. Baseline/candidate replay cursor equality is PASS. The local preparation cost and the native stochastic workload are reported separately.

PASS offline: compiler 14, core/service 38, production composition 49 — 101 checks. A newly added tool event in the storage-race double initially preceded its known-usage notification; the double's ordering was corrected and the suite passed without weakening runtime refusal. Additional PASS: source-of-truth policy, metadata policy, Markdown contract, documentation references and tracked sensitivity; all five preserve the complete non-ignored checkout snapshot. Native bounded tests do not qualify general BPMN interchange, graphical editing, live PostgreSQL concurrency, same-product-root reuse after Windows review, fresh application generation or a public release.

The [curated numerical evidence](bpmn-v2-controlled-2026-11-01.json) contains neutral case IDs and evidence hashes. Raw native identities, command/output hashes, private client/control paths, protocol, inputs, archives and logs remain in the local-only corpus `bpmn-v2-controlled-20261101-002`.
