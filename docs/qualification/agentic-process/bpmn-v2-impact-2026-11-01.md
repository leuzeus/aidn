# BPMN v2 impact benchmark — 2026-11-01

A later [controlled four-case comparison](bpmn-v2-controlled-2026-11-01.md)
diagnoses the nine-response difference and measures the corrected protocol.
The observations and costs below remain the original one-pair record.

The bounded installed-candidate benchmark completed two native workflows with identical IR and activity-input hashes, exact canonical-journal simulation replay, an unchanged product and a 28-case independent oracle. Each workflow accepted ten activity results using one reused author thread and a separate independent reviewer. Two earlier infrastructure failures and one valid independent product rejection remain terminal and are accounted for separately. The corpus was corrected before the retained pair.

The native comparison is **direct IR versus compiled XML on the same candidate runtime**. It is not an old-release/candidate native comparison. The frozen baseline comparison is restricted to the deterministic CPU reducer.

## Method and reproducibility

- Runtime source bytes match commit `44d7072299a61165dab529ee8a7a70ec046a8c80`; candidate archive SHA-256 `045d4ce6e82d53e80fbc5d2e8b73d3fd971265699ee168381c8ddb48e0c39daa`. The archive preceded the final documentation commit and is a private candidate, not a public release qualification.
- Node v24.13.1, win32/x64, OS 10.0.26300; 20 logical CPUs, AMD Ryzen 9 5950X 16-Core Processor. Shared Windows load and provider/cache state were not controlled.
- Native executable is pinned by SHA-256 `3097c909fb6d5cd63510d44aceb1d42df9f6e85722a3e447e477def1ecf60e16`; model `gpt-6.1-sol`, effort `high`, provider fallback disabled.
- The tracked extended-delivery XML exercises an exclusive message race, two post-test loop iterations, two logically parallel items with nested calls, a follow-up call and independent review. A pinned host scenario sends one correlated message and changes one Boolean fact after two accepted results. These signals are synthetic host inputs; activity execution and usage counters are native.
- All retained cases use fresh byte-identical copies of a fixed integer-cent ledger and its tests under one officially installed and activated client. The workload instructs the author to verify without edits; hashes prove unchanged bytes. It does not benchmark creating a new application. Review snapshots have a separate readable root. No ACL denial is removed or weakened.
- Order was reduced from IR → XML → XML → IR to IR → XML before the retained cohort, to preserve the original deadline after diagnosis and repairs. The second counterbalanced pair is NOT_RUN; n=1 per arm. Model SHA-256 `ec5c8945d666aafb4786d361d9eea434f2cb652ca9ed749531f420082378af26`. All ten occurrence/artifact/criteria/developer/instruction digest tuples match across both cases. Parallel control does not create one agent per item.
- Native wall time is the complete owned run, including startup, hooks, canonical operations and process cleanup. XML/IR preparation is measured separately. Provider-only inference time is **NOT_MEASURED**; the cumulative clock since lot authorization is not used as per-case latency.
- Usage is the latest cumulative native snapshot per thread, summed once across the two distinct threads. Cached input is a subset of input; reasoning is a subset of output. Counters are not a billing statement. Coordinator chat and preparation model usage are outside these worker counters.

## CPU results

The baseline is `6757c979631130c753b053860a267837f1a949bc`. Fifty counterbalanced replay pairs use the same ten-result, 22-event, 23-occurrence journal; final baseline/candidate cursors match. Five hundred alternating preparation pairs compare IR parsing with XML compilation. This stage makes zero provider calls.

| Operation | Samples | Median (ms) | p95 (ms) |
|---|---:|---:|---:|
| IR JSON parse | 500 | 0.03 | 0.04 |
| XML compile | 500 | 4.97 | 6.25 |
| Baseline reducer replay | 50 | 64.48 | 79.2 |
| Candidate reducer replay | 50 | 63.91 | 74.59 |

XML adds about 4.95 ms of preparation at these sizes (4424 XML bytes, 2730 IR bytes). The reducer remains around 64 ms in both versions; no causal speedup is established on this shared host.

## Native results

| Case | Model preparation (ms) | Owned wall time (s) | Input | Cached subset | Output | Reasoning subset | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| ir-a1-r4 | 0.17 | 456.68 | 423,350 | 380,928 | 1,930 | 256 | 425,280 |
| xml-b1 | 26.18 | 529.05 | 612,717 | 547,200 | 2,117 | 208 | 614,834 |

The observed XML/IR difference is +15.85% for owned wall time and +44.57% for total tokens. Native responses also differ: 22 for IR and 31 for XML; this is a response count, not a tool-call count. With one case per arm, uncontrolled provider/cache state and differing native exchanges, these are descriptive measurements. The measured XML run is slower and consumes more tokens; the pair does not establish that compilation caused the difference. Compilation produces identical activity inputs and makes no provider call itself.

Every completed case has ten result events, both host signals applied, two distinct native thread counters, exact replay, PASS 28/28 oracle, unchanged product bytes and confirmed process-tree closure. SQLite is real in this installed files-mode client; live PostgreSQL is not exercised.

## Retained failures and corrections

1. `ir-a1` stopped before review publication with the old generic process error. A separate zero-model reproduction of control-volume staging renamed onto the product volume returned EXDEV. The runtime now creates an exclusive temporary sibling of the product file, verifies bytes before/after same-volume atomic rename, cleans failed staging, and returns bounded filesystem-code/path-hash diagnostics. A real cross-volume probe and subsequent native publication receipt validate the correction.
2. `ir-a1-r2` published successfully, then the independent reviewer reported **NOT_RUN**, with CreateProcessWithLogonW error 267. It supplied no product verdict. ACL inspection found an inherited sandbox read denial on the benchmark directory. A zero-model sandbox probe reproduced 267 there; a separate review root allowed snapshot reads while denying original reads and snapshot/original writes. A second zero-model probe found that a subsequent author could not read the prior product after review; a fresh product root passed. The harness therefore uses fresh byte-identical product copies and separate review roots. Existing ACLs remain intact. Reusing the same product root after native Windows review is not qualified by this benchmark. Neither failed instance is reclassified as successful.
3. `ir-a1-r3` completed native review but was authentically rejected: the corpus used safe-integer-only operands despite criteria accepting nonnegative integer operands and requiring overflow to raise RangeError. Its original 20-case oracle had passed. Eight additional oracle cases expose the mismatch (old product 21/28); the corrected corpus accepts integer operands, validates sparse/missing items, and passes 28/28. Original inputs/product/oracle are preserved; the rejected instance stays rejected. Both retained arms use the corrected frozen corpus and criteria references.

| Failed case | Wall time (s) | Native total tokens | Product/oracle | Tree closure |
|---|---:|---:|---|---|
| ir-a1 | 381.66 | 355,166 | unchanged / initial oracle 20/20 | confirmed |
| ir-a1-r2 | 453.56 | 385,480 | unchanged / initial oracle 20/20 | confirmed |
| ir-a1-r3 | 484.31 | 422,509 | unchanged / initial oracle 20/20 | confirmed |

Retained successful cases consumed **1,040,114 native tokens**. The three failed attempts consumed **1,163,155 more**. All five attempts total **2,203,269 native tokens** and 2,305.24 seconds of summed owned-run time. The original global deadline was preserved; retries used new instance IDs after concrete diagnosis and correction, with explicit protocol addenda.

## Validation and limits

PASS: compiler 14 checks, core/service 38 checks, production composition 48 checks (100 offline checks, no model calls); real cross-volume publication probe; sandbox boundary and fresh-workspace probes; two complete native cases and independent 28/28 oracle per case. Additional PASS: CLI output contracts, source-of-truth policy, metadata policy, Markdown contract, documentation references and tracked sensitivity. All six preserve the complete non-ignored tracked/untracked checkout snapshot.

The first global CLI-contract invocation was interrupted by this benchmark launcher's 180-second ceiling (ETIMEDOUT, no completed assertion verdict). The retry used the repository runner's 900-second default and passed. Both attempts are retained; these offline checks make zero model calls.

NOT_RUN: general BPMN interoperability, graphical editor import, arbitrary graphs, live PostgreSQL concurrency, durable timers, external message broker and public release qualification. The fixture suites' NOT_RUN native labels still describe those offline suites, not this separate bounded benchmark. No broad performance improvement is claimed.

The accompanying [curated measurements](bpmn-v2-impact-2026-11-01.json) retain numerical results, neutral identifiers and evidence hashes. Raw traces, native identities, client paths, control configurations, failed attempts and archives remain in the local-only benchmark corpus `bpmn-v2-impact-20261101-001`.
