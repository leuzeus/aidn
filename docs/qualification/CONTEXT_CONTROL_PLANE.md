# Context control plane: native qualification record

Date: 2026-10-18. Package source: 0.12.0, candidate based on
`b59bf5a5b638b1d95a2f97a3420b569ed4f043a5`. Implementation is committed as
`8ef5b4c` (derived memory/consultation) and `0cbcaae` (native research hosts).
The original synthetic native evidence and the later real-project pilot below
remain distinct from release admission and installed-client rollout.

## Observed results

| Surface | Result | Evidence and limit |
| --- | --- | --- |
| Explicit checkpoint and stale source refusal | PASS | Real AIDN CLI and fresh admission in a disposable activated client |
| Native model/client | Observed | `openai`, `gpt-6.1-sol`, desktop app-server `0.163.0-alpha.10.2`; exact model revision unavailable |
| Harness reference | PASS | Nine exact retained-answer assertions, real resume/retrieval tools |
| Model-triggered window change | PASS | Two independent runs: completed checkpoint, real `new_context`, acknowledgement, fresh capsule, raw evidence retrieval and accepted nine-answer submission |
| Model-owned TODO experiment | PASS | Model edited bounded disposable TODO notes; the old capsule refused reuse until a fresh checkpoint |
| Repeated continuation | PASS | Three real windows in the same native test thread; each retained TODO, decision, next step and exact raw key; nine-answer submissions accepted after each window |
| Native telemetry stored in capsule | PASS | Actual window ID, window number 3, 17,764 last-response context tokens and effective capacity 475,000; `token_source: client-reported` on capture and resume |
| Classical compaction and continuation | PASS | Native compact item followed by idle status, then a successful new turn |
| Native temporary compaction hooks | PASS, reviewed test scope | Startup, PreCompact capture, PostCompact fresh read and SessionStart(compact) observed after correcting per-thread intent forwarding and exact turn completion waits |
| Integrated hooks and `new_context` | PASS | Four reference profiles, including three successive windows in the same bounded-ledger test; automatic-trigger hooks observed around real window replacements |
| Untrusted-hook negative control | PASS | Ordinary native thread without the reviewed-test override dispatched no hooks; hooks remained untrusted afterward |
| Admission-denial negative control | PASS | Refused PreCompact preserved the latest memory pointer and installed history; PostCompact did not run |
| Native process resume | PASS | A newly started runtime dispatched SessionStart(resume) with a fresh capsule |
| Scoped consultation and delta consumed by model | PASS | Real read-only hydration CLI, exact rule/dependency/revision answers accepted for both forms; consultation checkout unchanged |
| Persistent hook trust | SKIP | No trust decision was written or user working profile changed |
| Exact-revision autonomy registry | PASS, local research; UNAVAILABLE for the observed OpenAI alias | Dedicated local host has an exact GGUF/model/tokenizer identity and a candidate-specific expiring record; no global registry installation |
| Editable-input research primitive | PASS, fixture scope | Eight adversarial scenarios, synthetic tokenizer, immutable prefix, edit gate, snapshots/audit, budget, freshness and rollback; no native transcript edit |
| Native local input editing | PASS, bounded research | Three native continuations with model-proposed pruning, exact input tokens, actual AIDN freshness, protected evidence, rollback and fresh-process restoration |
| Native full CLM across clients | UNAVAILABLE | The local input experiment does not qualify unrestricted transformations, a live Codex transcript-editing port or other model/provider identities |

The nine assertions cover governance retention, active cycle, exact artifact key,
important log error, stale refusal, next step, agent label, instruction/data
boundary and retained decision. They form a small continuity corpus. They do
not establish broad ContextBench difficulty, authenticated agent execution,
cross-provider quality or sustained production safety. The native runtime was
read-only; ordinary AIDN admissions remained independent.

The separate paired consultation trial returned 50,606 complete JSON bytes for
the full form and 5,405 for the delta. The native client reported respectively
58,571 and 46,101 cumulative input tokens across each trial's model responses,
with accepted exact answers in both cases. These are two synthetic observations,
not a general efficiency result or per-part token attribution. No byte-to-token
conversion or dollar-cost estimate is used. A native last-response measurement
is not lifetime spending.

## Evidence retention and attempt interpretation

Private native JSONL, reports, temporary clients and script hashes are retained
in local-only output directories outside the source checkout. Authentication
copies were removed, original config/auth hashes were unchanged, and owned
native processes stopped. Raw native metadata is not copied into tracked docs.

The first combined compaction attempt submitted the next turn when the compact
item had completed but the compact turn was still active; the server returned
`ActiveTurnNotSteerable`. This is an orchestration failure. The driver now waits
for the native idle notification. Subsequent classical compaction/continuation
passed. The earlier report is retained, not rewritten.

Targeted `audit-session-progress` and `audit-project-governance` diagnostics
separated entry, action completion and product verdict. Initial probes logged
only completed actions, so their empty log could not establish absence of hook
entry. Later probes added entry receipts and the Windows launcher. The remaining
failure was traced to the qualifier, using the exact runtime tag
`rust-v0.163.0-alpha.10.2`, commit
`4ebc485ca321243727539187169425fcf972f2c4`:

1. The standalone app-server entry does not forward the TUI's process-level hook
   flag. The official exec client passes `bypass_hook_trust` through the typed
   `thread/start`/`thread/resume` config override. The qualifier now forwards
   only its explicit reviewed-test intent through that same native port.
2. Idle and compact-item completion can precede the compact turn's completion
   notification. A thread-only wait could consume that late notification as the
   continuation's result, then shut down before its SessionStart(compact).
   All waits now bind the exact returned turn ID; compaction also waits for its
   own completion before dispatching continuation.

Source references: [official exec forwarding](https://github.com/openai/codex/blob/4ebc485ca321243727539187169425fcf972f2c4/codex-rs/exec/src/lib.rs#L1495),
[typed native override](https://github.com/openai/codex/blob/4ebc485ca321243727539187169425fcf972f2c4/codex-rs/app-server/src/config_manager.rs#L460),
and [standalone app-server dispatch](https://github.com/openai/codex/blob/4ebc485ca321243727539187169425fcf972f2c4/codex-rs/cli/src/main.rs#L1237).
The [official hook guide](https://learn.chatgpt.com/docs/hooks) describes the
reviewed one-invocation mode. No persistent trust, managed policy, sandbox or
admission was relaxed. `CODEX_CI` remained unchanged during the successful trial.

Malformed/oversized input and unavailable binding now produce a parseable stop
response. Native ordinary-untrusted and admission-denial controls separately
prove that successful dispatch did not remove either protection. The final
integrated run passed, including fresh-process resume. Earlier failed/partial
reports are preserved; a separate CLI command refused by native policy remains
non-evidence for hook behavior. Historical aggregate-report limitations are not
rewritten into a product failure.

## Dedicated local P3 result

The later resource inventory observed about 16.5 GiB available RAM. An explicitly
reviewed CPU-only llama.cpp build `b11721`, upstream commit
`ff5a23376725e5a889fa0bfb987b7541dc304da0`, runs a pinned official
Qwen3-4B-Q4_K_M GGUF (about 2.5 GB). Its model/tokenizer container SHA-256 is
`7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.
The [official model card](https://huggingface.co/Qwen/Qwen3-4B) documents the
non-thinking template; the host renders its reviewed suffix explicitly.
The [pinned native server protocol](https://github.com/ggml-org/llama.cpp/blob/ff5a23376725e5a889fa0bfb987b7541dc304da0/tools/server/README.md)
provides tokenization and explicit token-ID completion. No remote model code,
global installation, user authentication or shared Ollama runner is used.

| Final local check | Observed result |
| --- | --- |
| Exact nine-answer continuity | PASS in each of three native rounds |
| Complete input tokens | 1,050 before pruning; 445 in both subsequent rounds |
| Output tokens | 422 per round, below the 1,024-token reserve |
| Actual changed input | Model output is applied through the edit gate; the following native input has that exact document hash |
| Critical data / prefix | Preserved; attempted deletion or prefix replacement refused |
| Real freshness | Actual read-only AIDN resume before and after tokenization; checkout change before an edit or during native counting refused |
| Native hard token limit | Both edit and inference dispatch refused oversized complete input |
| Rollback / continuation | Exact preimage restored with audit retained; subsequent native continuation PASS |
| Fresh process | Second runner restored the exact input and passed the third nine-answer submission |
| Resource confinement | Suspended assignment to Windows Job before execution, one process, 4 GiB committed-memory cap and separate 4 GiB physical reserve |
| Observed peak Job commitment | 2,792,218,624 bytes; mapped model pages are a distinct measurement |
| Cleanup / integrity | Both processes stopped; temporary API keys removed from retained specifications; host, runtime and model hashes unchanged |

Separate native resource controls proved an allocation exceeding a 64 MiB test
Job is refused, parent EOF terminates the owned process, and insufficient host
reserve prevents launch. A separate read-only observation during an earlier
attempt with the same weights measured about 4.6 GiB resident memory; this is
not the final candidate's peak or its committed Job-memory measurement.

The 3B candidate's exact-answer failures, an exhausted output reserve, HTTP
transport failures and a later host-hash invalidation remain retained. They do
not qualify that candidate. The transport now avoids idle pooled connections
for both readiness and inference, and retains raw exchanges before parsing.
The output schema bounds entry count but never encodes expected answers.
The final run repeated all native cases after real freshness binding and passed
without modifying its host during execution.

Only after final cleanup and hash verification did the host emit its 24-hour
research qualification. The existing nine-case, native-proof, invariant,
continuation, exact-identity, unique-record and expiry requirements still apply.
The dedicated local port additionally requires exact native input/tokenizer,
protected evidence and rollback proof. It grants no writes, Codex hooks or
`new_context`. It demonstrates bounded input pruning with a small synthetic
corpus, not arbitrary history rewriting or general model quality.

Integration checks PASS: the required working-memory gate (existing memory,
metrics, lifecycle and editable-input cases plus five local-port fixture groups),
three governance gates, two security gates, three documentation gates and package
topology. Gates left the checkout unchanged; `git diff --check` also passed.
The final route remains ASSURED. Manual native model and resource evidence is
separate from these PR gate results and from release admission.

## Real-project P3 pilot

The explicit external-pilot path qualified continuity of an actual application
diagnostic in an existing activated PostgreSQL/db-only project. It reused its
real branch and canonical state, with fresh context/session admissions in
THINKING mode. Four actual source/test files were hash-bound alongside a bounded
diagnostic record. Only unique ignored evidence, cache, events and per-agent
capsules were written; no source, configuration, activation or DB import occurred.

The unchanged application tests failed independently before the experiment.
A separately retained in-memory timing probe preserved their assertions and
showed asynchronous cleanup completing after an additional event-loop turn.
The task was to retain that diagnostic, original failures, cited proof and next
step across pruning and restart. Diagnostic continuity is not application-test
acceptance, a shipped application fix or broad model quality.

| Pilot check | Final observation |
| --- | --- |
| Nine exact retained answers | PASS in all three native continuations |
| Full native input tokens | 1,095, then 490 and 490 after model-proposed pruning |
| Output tokens | 439 each; 1,024-token reserve unchanged |
| Protected rules / critical evidence | Exact preservation; prefix replacement and critical deletion refused |
| Source freshness | Actual checkpoint/resume; changed owned evidence before edit and during native tokenization refused |
| Rollback and restart | Exact preimage/audit retained; third continuation in newly started runner PASS |
| Hard limits and preimages | Oversized complete edit and inference refused; stale preimage and partial edit refused |
| Pilot preservation | Source hashes, HEAD, branch, staged/unstaged/nonignored state, preexisting runtime files and fresh canonical revision unchanged |
| Resource controls | Same suspended Windows Job, one process, 4 GiB committed cap and separate physical reserve; both processes stopped |
| Peak committed Job memory | 2,791,051,264 and 2,564,231,168 bytes for the two processes |
| Host/runtime/model integrity | PASS before execution and after cleanup |

The first pilot attempt stopped before inference: the negative control correctly
returned `invalid_evidence`, while the qualifier expected the synthetic checkout
control's `stale` status. The expectation now matches the evidence control and
also requires a null capsule. No refusal criterion or model-answer verifier was
weakened. That failed report and its preserved project-state proof remain intact.

The final native evidence SHA-256 is
`45368c732755637d182dbc04d7fdefa2a75b3634a71e0f2760f380cc3311f268`.
Its local host identity includes the reviewed pilot-manifest hash; the earlier
synthetic qualification is not reused. The emitted record expires at
`2026-10-20T00:50:44.682Z` and enables only this dedicated local input port.
It grants no writes, native Codex events, `new_context` or global registration.
Raw reports, logs, model exchanges, pilot identifiers and code remain local-only.
Two required fixture groups additionally cover pilot admission-input/source
binding and preservation detection; their results are not the native pilot proof.

## Completion boundary

Final source verification after the hook corrections: the required
`codex-agent-working-memory` gate PASS, including 27 memory, five metrics,
14 lifecycle/evidence and eight editable-input scenarios. Docs (three gates),
governance (three gates) and package topology PASS, with no checkout mutation
from the gates. The final current-source native compaction trial also PASS,
including both negative controls and fresh-process resume. Its temporary
credentials were removed, original config/auth remained byte-identical and
owned native processes stopped. These results supplement the retained integrated
three-window and paired scoped/delta native trials.

P1/P2 source work and the native checkpoint/new-window/restore reference path
are implemented and exercised. P3 has a conservative capability policy, a
native bounded-ledger experiment and a guarded editable-input prototype.
The native lifecycle blocker is resolved for the reviewed isolated Windows
app-server tests. Automatic distribution into a user's working profile remains
outside this test. Live Codex transcript editing and automatic Codex model
autonomy remain unavailable at the stated boundaries: the observed alias has no immutable
revision, and `comp_hash` denotes compaction-compatible configurations rather
than model identity. The tested protocol exposes compaction, not a supported
live-transcript editing port. The earlier 17.7 GB local alternative was not
loaded. The later admitted small local host resolves model identity, tokenizer
and input-editing dependencies for the bounded P3 research path above. Its local
qualification does not install a global registry entry or qualify other clients,
providers, production rollout, unrestricted CLM or a release. No whole-plan
production-completion claim follows from the bounded synthetic and pilot research.
