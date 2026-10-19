# Context control plane execution

Source: [AIDN Analyse de la gestion du contexte](https://chatgpt.com/space/page_d40dfeba099c8191ac5a5c142da2bfc8), comparison dated 2026-10-17.
Started 2026-10-18 on the existing working-memory implementation. Delivery lane:
ASSURED. The runtime backend owns truth; working context remains disposable,
derived, local and advisory. Fresh admission is always independent.

## Ordered work

| Order | Priority | Work | Completion evidence |
| --- | --- | --- | --- |
| 1 | P1 | Consolidate explicit files-mode memory, bounded typed claims and resume | CLI fixtures, contracts, effects, policy and packaging gates |
| 2 | P1 | Bind DB-backed memory to fresh coherent canonical observations | SQLite and PostgreSQL adapter fixtures, concurrent-change and unavailable refusals; separate live DB smoke |
| 3 | P1 | Record per-window context metrics with unknown native values preserved | Closed metrics contract, measured attribution and telemetry validation fixtures |
| 4 | P1 | Establish a small continuity corpus and targeted-selection usage evidence | Repeated resume, stale state, evidence retrieval, injection boundaries and decision retention; separate native comparison |
| 5 | P2 | Derive pressure only from reliable native telemetry | Unknown fallback, capacity/reserve and inconsistent telemetry checks |
| 6 | P2 | Return useful differential context | Revision-bound projection, scope and dependency preservation fixtures |
| 7 | P2 | Link large observations to summaries and exact evidence | Bounded local evidence and exact retrieval checks |
| 8 | P2 | Bind per-agent capsules to execution handoffs when requested | Typed identity/scope checks; no transcript concatenation or implicit shared relay |
| 9 | P2 | Prepare capability-gated checkpoint/rollover/restore lifecycle | Version/client evidence, checkpoint-before-rollover and safe fallback; native hooks separately qualified |
| 10 | P3 | Qualify provider/model autonomy profiles | Default harness mode, explicit qualification and conservative downgrade |
| 11 | P3 research | Experiment with editable live context | Opt-in isolated harness, immutable prefix, snapshots, atomic edits, validation and rollback; no native capability inference |

## Evidence boundaries

Source, scaffold, fixture, installed-client and native observations are distinct.
Deterministic tests cannot establish model quality, native token savings, client
hook execution or PostgreSQL isolation. Efficiency comparisons require successful
tasks and intact invariants before token/cost ranking. No native client rollout
or publication follows automatically from package-source implementation.

## Execution record

- Baseline: explicit working-memory suite PASS, 17 assertions and cleanup PASS.
- Baseline native hooks/model-window comparison: SKIP, not executed.
- Implementation and subsequent validation are recorded below as they complete.
- P1 source/fixture checkpoint: 24 working-memory scenarios and four metrics
  scenarios PASS through `codex-agent-working-memory`; cleanup PASS. Contracts,
  effects, governance and docs families PASS. Runtime persistence parity and
  scoped-selection fixtures PASS. Native hook/model/token comparison and live
  PostgreSQL isolation remain unexecuted, separate from those results.

### Current implementation and qualification

| Priority | Work | Source/fixture outcome | Remaining qualification |
| --- | --- | --- | --- |
| P1 | Typed memory, facts/questions/blockers/dead ends/tests, exact evidence and resume | Implemented; 27 memory scenarios PASS; native model resume and exact retrieval observed | General model quality remains unestablished by the small native corpus |
| P1 | Canonical DB binding | Real SQLite plus PostgreSQL adapter fixtures PASS; live PostgreSQL CLI capture/resume and concurrent canonical-change rejection PASS in dual/db-only; own scopes and temporary files cleaned | Broader external-pilot qualification remains separate |
| P1 | Context metrics | Five metrics scenarios and native collector refusal cases PASS; real native window usage persisted and resumed | Per-part attribution, monetary cost and comparable general efficiency benefit unknown |
| P1 | Reference continuity corpus | Native nine-answer corpus, integrated hooks, three consecutive ledger windows and real scoped/delta consumption PASS | Larger independent ContextBench and cross-provider comparison remain separate |
| P2 | Pressure | Implemented consultative thresholds/reserve and expiry; unknown when client telemetry is absent/stale | Host hard-limit enforcement is not established by these tests |
| P2 | Useful delta | Authority/dependency preservation fixtures and native consumption of both forms PASS; paired synthetic usage recorded | No general efficiency or monetary-cost claim from two observations |
| P2 | Large observations and per-agent handoff | Exact raw proof plus bounded summaries; result identity linkage and explicit unauthenticated execution status tested | No automatic interception of every tool or shared transcript relay |
| P2 | Checkpoint/rollover/restore | Native startup/PreCompact/PostCompact/compact/resume hooks, integrated new-context trials and negative trust/admission controls PASS | No automatic distribution or persistent user-profile trust qualification |
| P3 | Provider/model autonomy | Exact identity/expiry policy and a dedicated local native qualification PASS: all nine cases over three continuations, with no fixture promotion | Record is candidate-specific research; Codex/OpenAI alias and other providers remain unqualified; no global registry installation |
| P3 research | Editable native context / full CLM | Guarded local input pruning with exact native token IDs, protected evidence, real freshness, rollback and fresh-process restoration PASS | Bounded synthetic research; unrestricted CLM, live Codex transcript editing and production rollout remain unqualified |

### Observed checks and corrective work

- PASS: selected memory gate (27 memory + five metrics + seven lifecycle cases),
  contracts, effects, governance, docs and security families; canonical persistence
  parity, governance CLI, context store concurrency/provenance, state-mode parity
  including config freshness and canonical gating, package topology and version.
- PASS: live PostgreSQL smoke on disposable scopes, real CLI in dual/db-only,
  canonical-only change invalidation, secret-free capsule output and verified cleanup.
  This is separate from PR admission and from native Codex execution.
- PASS: scoped-selection/delta fixture, 112 checks including real CLI delta,
  public contract, full-response budget and unchanged checkout inputs; cleanup PASS.
- A first state-mode gate exposed a Windows config-reader defect: a regular
  `.aidn` parent was misread as optional absence after `ENOENT`. The reader now
  inspects existing ancestors and preserves an `ENOTDIR` refusal. Native and
  injected regression checks and the complete selected state-mode gate pass.
- The first db-only live fixture correctly refused an inconsistent files-mode
  digest. Fixture setup now explicitly prepares the selected canonical mode;
  the admission rule was preserved and the live cases pass.
- Read-only local client inventory observed CLI 0.125.0, desktop
  0.163.0-alpha.10.2 and IDE 0.162.0-alpha.17.2. Their current inventory status is
  unverified and native qualification was not executed. Presence is not proof
  of supported or approved compaction hooks.
- At the first source checkpoint, native compaction/new-context, native
  model/token/cost comparison and full CLM were unexecuted. The native follow-up
  below supersedes those availability observations only where directly tested.
  Clean-commit release reproducibility and publication remain unexecuted.
  The source tree contains the pre-existing uncommitted implementation plus this
  work. No release or whole-plan completion is asserted.

### Initial native follow-up and P3 research

- PASS: actual `new_context` calls through the desktop runtime, with retained
  events proving completed checkpoint before dispatch, acknowledgement, fresh
  read-only resume, exact raw retrieval and accepted continuation.
- PASS: nine retained-answer assertions in a harness reference and two native
  rollover runs; a separate model-owned TODO trial preserved notes and decisions
  through three windows in the same test thread. This is a small synthetic
  corpus, not broad model quality or production ContextBench qualification.
- PASS: native window ID/number and last-response context usage collected;
  17,764 tokens / effective capacity 475,000 were stored and resumed as
  client-reported telemetry. Lifetime usage is never substituted for window
  pressure. Component attribution and monetary cost remain unknown.
- PASS: classical native compaction followed by idle and a successful turn.
  The first attempt's early continuation failed with `ActiveTurnNotSteerable`;
  the driver now waits for idle. Original failed evidence is preserved.
- UNAVAILABLE: temporary PreCompact/PostCompact/SessionStart hook entry. The
  final probe discovered enabled/untrusted hooks but recorded no immediate
  entry receipts. Invocation-only execution of reviewed sources did not supply
  native hook proof. No persistent trust was written, and no rules were weakened.
  This initial availability observation is superseded by the corrected probe below.
- PASS at fixture scope: editable-input research protects the prefix, applies
  a host transformation gate, checks full input tokens/source/preimage and
  retains atomic snapshots/audit/rollback. The tokenizer is synthetic. This
  does not edit a native transcript or qualify native full CLM.
- UNAVAILABLE: exact immutable model revision, verified native tokenizer and
  supported native transcript-editing port. No capability registry entry is
  created; production autonomy remains in harness fallback.
- Original user configuration/authentication stayed byte-identical; temporary
  authentication copies were removed. No release, commit or publication was
  performed. See [the native record](qualification/CONTEXT_CONTROL_PLANE.md).
- Final integration checks: the required memory gate PASS (27 memory, five
  metrics, nine lifecycle/evidence cases and eight editable-input cases at that
  run); the subsequent narrow provider/profile preflight change and all ten
  lifecycle/evidence plus eight editable-input cases PASS directly. Docs,
  governance and package-topology gates PASS with checkout cleanup. The final
  native compaction probe reports PARTIAL and exits 2 because hook evidence is
  unavailable; classical compaction and continuation remain PASS.

### Native hook cause correction and remaining qualification

- The exact installed runtime tag was inspected at upstream commit
  `4ebc485ca321243727539187169425fcf972f2c4`. Standalone app-server does not
  forward the TUI process flag to threads; the official exec client sends a
  typed per-thread hook-intent override. The qualifier now does the same only
  for explicit reviewed-test intent. It writes no trust decision.
- A second qualifier defect consumed late compact-turn completion as if it
  completed the following turn. Exact native turn-ID waits and an explicit
  compact-turn completion fence prevent early shutdown.
- PASS: integrated startup, PreCompact capture, PostCompact fresh read and
  SessionStart(compact) around actual model-triggered new-context operations;
  three successive real window installations retain TODO, decisions, next step
  and exact evidence. Fresh-process resume also dispatches SessionStart(resume).
- PASS: ordinary-untrusted native control has no hook entry; native core-admission
  denial stops before history replacement, retains the latest capsule and never
  dispatches PostCompact. Hooks remain untrusted in persistent inventory after
  the invocation-local experiment. Malformed input/binding failures emit stops.
- PASS: native model consumption of complete scoped consultation and the
  authority-preserving delta through the real read-only CLI. Exact answers pass
  in both trials and all consultation files remain unchanged. Observed cumulative
  input usage: 58,571 versus 46,101 tokens, with 50,606 versus 5,405 response bytes.
  These paired synthetic observations are not a general model-quality or cost
  benefit claim.
- P3 admission remains conservative: the native model alias exposes no immutable
  revision; `comp_hash` means compaction compatibility. No verified native
  tokenizer or supported live-transcript edit port is available in the tested
  protocol. A local generative candidate was inspected without inference: its
  weights are about 17.7 GB, it was not resident, and host free RAM was about
  1.6 GiB. No heavy load was admitted, no memory was reclaimed, no model identity
  was fabricated and no fallback criteria were lowered.
- The previous failed/partial artifacts are preserved. The
  [qualification record](qualification/CONTEXT_CONTROL_PLANE.md) distinguishes
  the corrected native lifecycle from the remaining P3 external dependencies.
- Final current-source checks PASS: required working-memory gate (27 memory,
  five metrics, 14 lifecycle/evidence and eight editable-input scenarios),
  docs, governance and package topology. Gates did not mutate the checkout.
  The final native compaction requalification PASS includes ordinary-untrusted
  refusal, admission-denial preservation and fresh-process resume; credentials
  were removed and original configuration/authentication stayed unchanged.

### Resource-compatible P3 native research qualification

- Resource inventory was refreshed rather than reusing the earlier 1.6 GiB
  snapshot. Available host RAM was about 16.5 GiB at admission. A dedicated
  CPU host and a 2.5 GB quantized local candidate replaced the unavailable
  editable Codex transcript path; no 17.7 GB model was loaded.
- Runtime source/release and model revisions were reviewed and pinned. Native
  tokenization and generation share the same SHA-256-verified GGUF. Complete
  rendered input is submitted as exact token IDs, with 4,096 total tokens and
  a 1,024-token output reserve. Hidden templates and context shifting are absent.
- The first 3B candidate failed exact native answers and received no profile.
  Raw evidence also exposed an incomplete output and idle HTTP connections
  around synchronous checkpoints. Output cardinality is now bounded without
  encoding the expected answers; readiness and inference connections are
  explicitly closed, with no automatic retry of a model turn.
- A host freshness review replaced an in-memory revision variable with actual
  read-only AIDN resume before and after native tokenization. Real checkout
  changes before an edit and during tokenization both refuse the transaction.
  A source-hardening change invalidated an earlier three-round run at its final
  host-hash fence, so it emitted no qualification.
- PASS on the final unchanged host: Qwen3-4B-Q4_K_M, three native continuations,
  nine exact answers on every round, model-proposed pruning, exact critical
  evidence preservation, rollback/audit and restoration in a newly started
  process. Native full-input counts were 1,050, 445 and 445; these are small
  synthetic observations, not a general efficiency or model-quality result.
- PASS: suspended Windows Job assignment, one process, 4 GiB committed-memory
  limit, 4 GiB available physical-memory reserve and owned-process cleanup.
  Observed peak committed Job memory was about 2.60 GiB. Mapped model pages are
  separate; an earlier read-only observation with the same weights measured
  about 4.6 GiB resident memory. Native negative resource
  controls refused an over-limit allocation and unavailable reserve, and proved
  parent-EOF termination. No unrelated process or model service was changed.
- A candidate-specific native record, valid for 24 hours, now permits the
  dedicated local input port only. It binds host/configuration/runtime hashes,
  exact model/tokenizer revision and the native evidence. No write permission,
  Codex native events or `new_context` capability crosses this boundary.
  The [qualification record](qualification/CONTEXT_CONTROL_PLANE.md) describes
  what passed and the remaining production/generalization limits.
