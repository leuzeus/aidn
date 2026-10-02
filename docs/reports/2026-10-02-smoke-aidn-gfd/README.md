# Native GPT-6.1 smoke comparison, 2026-10-02

This is non-normative experimental evidence from two new synthetic room-reservation API projects. It does not change AIDN policy or qualify a release.

[French comparison report](report.md) · [Measured results and evidence hashes](results.json)

The full report is tracked as Markdown. The PDF and project archive are retained locally, outside this repository.

Both development arms used native Codex GPT-6.1-Sol with medium effort. The AIDN package was built from the latest remote dev observed before the first arm: `89a709b9ccc3a1effb91356c654cb9fc3b5e4650` (0.12.0). Its canonical runtime used PostgreSQL 17.6, without SQLite fallback. Both applications used Node and SQLite. Project hooks were reviewed by the human and trusted through native supported controls.

| Observed measure | With AIDN | Without AIDN |
| --- | ---: | ---: |
| Development time | 36 min 04 s | 19 min 51 s |
| Frozen external criteria, Node 22.13.0 | 21 / 21 | 21 / 21 |
| Native development-thread tokens | 8,017,595 | 1,696,874 |
| New input plus output tokens | 312,763 | 140,522 |
| Cached fraction of input | 96.78% | 93.53% |
| Final own tests rerun on Node 22.13.0 | 8 passing | 15 passing |
| Shared post-hoc NUL-title roundtrip | FAIL on read/cancel | PASS |

The same 40-minute maximum was available to each arm, split into realization, business change, and a fresh-conversation recovery. Each phase finished when its requested work completed; the faster baseline was not padded to 30 minutes. Phases 1 and 2 shared a thread; phase 3 used a new thread. Token totals use the last cumulative snapshot per distinct thread, preserving cache and reasoning as subsets. They are not a subscription bill. Automatic-review model costs were not isolated, and complete preparation/first-use costs are unavailable.

The frozen behavioral oracle remained unchanged in scoring. Its launcher was corrected to use the public start command instead of assuming an implementation filename; the old version and six passing harness checks are retained locally. The extra NUL-title check was triggered by a defect discovered and fixed by the baseline within its budget, applied to both final products, and reported separately from the frozen score. Neither product was repaired by the experimenter after development.

The qualitative review used anonymized application exports, but the reviewer also conducted the experiment: this was not an independent double-blind review. The 95/100 and 97.5/100 descriptive scores include subjective judgments; the confirmed text defect is stronger evidence than that small numerical difference.

GFD adoption was effective only in the package source and remained absent in the installed client. Actual AIDN admissions, a native edit block, PostgreSQL state, cycles and handoff transitions were observed. The two-arm comparison cannot isolate GFD's causal contribution or its token cost. Governance traceability did not establish improved application correctness on this task.

The local task retains full JSON-RPC traces, cumulative snapshots, both project Git histories, unchanged hook hashes and approval readback, phase-1 database fixtures, evaluations, test outputs and code-review exports. The results file binds the principal evidence through SHA-256 hashes. Runtime/authentication files and private database dumps are not part of this record.

One pair, fixed A-then-B order, shared cache and one observer limit generalization. The AIDN recovery phase used Node 24 and declared that deviation; both final external evaluations and own-suite reruns used the same pinned Node 22.13.0. No power-loss, sustained-load or full GFD-conformance claim is made.

No ADR update is required: this record reports an experiment and changes no accepted architecture decision.
