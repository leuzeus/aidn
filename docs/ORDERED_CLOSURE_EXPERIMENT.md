# Ordered closure experiment

The internal `createOrderedClosureSequence` composition in
`src/application/codex/ordered-closure-sequence.mjs` executes an explicitly
chosen terminal outcome through the existing canonical CLI. It is an opt-in
research-host capability, with no new public CLI command, default skill adoption,
installation change, shared store or database schema.

## Request and effect

The caller supplies `stage` (`cycle` or `session`), canonical `cycle_id` and
`session_id`, explicit `outcome` (`DONE` or `CLOSED`) and one to three mutations.
Each mutation contains only an audit-relative `path`, an observed complete-source
`expected_sha256`, and exact `replacements` with `old` and `new` strings. Unknown
fields, foreign entities, traversal, duplicate paths and oversized input refuse.
Cycle mutations start with its `status.md`, then `CURRENT-STATE.md`, followed by
an optional snapshot. Session mutations start with its session artifact and may
update the snapshot and current state. This first composition covers the ordinary
retained terminal outcome; alternative outcomes retain their existing procedure.

`run(request)` is a pure preview: it performs no scope reads, CLI calls or writes.
It grants no authorization. Actual execution requires `run(request, {write:true})`
and a separately authorized host. Boolean write intent does not follow from JSON
formatting, a preview, model claims or a previous admission.

## Actual sequence

1. Fresh strict admission for the selected stage and exact selected entities.
2. Each requested mutation through the existing `db-first-artifact --replace`
   writer, retaining its atomic CAS, reservation fence and canonical backend.
3. For cycle closure, generate the runtime digest through the official projector
   and persist that exact generated source. No model reconstructs its bytes.
4. The actual final strict hook with `--fail-on-repair-block` and
   `--no-auto-skip-gate`, including verified retained nested control evidence.

The session segment requires a positive actual cycle segment in the same host
instance. It obtains its own fresh admission. The caller can prepare session
reporting from the now-known cycle result; future hook success is never assumed.
Required exit artifacts, branch/drift checks and explicit cycle-resolution choices
must already be prepared through the ordinary procedure. The executor does not
choose an outcome, write product files, merge, publish or skip a control.

## Host boundary and failure

The injected `execute(argv)` port must invoke the actual CLI serially and return
its complete unprojected canonical `data`, fixed `target_root`, `executed`, exit,
signal and timeout fields. Final hooks additionally require `hook_evidence` from
verification of the actual retained raw and complete diagnostic receipts. A
caller-supplied boolean is not native qualification of this port. Compact model
responses can omit these bodies only after the host retains and verifies them.

`readBinding()` must freshly resolve target, configured canonical backend, state
mode, stop state, and a stable `revision` for checkout/rules/activation identity.
The identity binding must exclude the executor's intended runtime mutations.
It is checked before every command. The original absolute `deadline` is retained.
Neither binding nor admission is reused as permission for a later write; existing
writers still enforce current per-write revision and reservation conditions.

The initial composition supports canonical SQLite in `dual`/`db-only` and
configured PostgreSQL. Files-mode execution refuses before its first command;
the existing files procedure remains available. Unavailable or ambiguous canonical
authority refuses without fallback. This limitation does not change global
PostgreSQL optionality or the behavior of existing commands.

An actual refusal, malformed result, scope change, deadline or nested-hook failure
stops dependent work and disables replay in this host instance. Completed writes
remain reported; no whole-sequence transaction or rollback is promised. Unknown
write outcomes use `written:null`, require inspection and never authorize retry.
The returned observation is derived diagnostics, not a new canonical concept.

## Evidence

`node tools/perf/verify-ordered-closure-fixtures.mjs` checks the state machine with
injected host responses. The existing Codex integration gate includes it.
These fixtures do not qualify installed CLI execution, live PostgreSQL, native
hook discovery, model readability, token savings or default adoption. Each of
those claims requires separate evidence on the unchanged ordinary controls.
