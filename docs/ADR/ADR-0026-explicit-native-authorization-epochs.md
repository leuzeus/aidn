# ADR-0026 - Explicit native authorization epochs

## Status

Implemented in source as an internal allocation/host capability. Offline
fixtures exercise signed journals, real canonical stores and the common IR
with doubled approval, native transport and process control. Genuine human,
provider and all-resource termination qualification remains required. This
decision does not complete the standard workflow plan.

## Decision

Keep `native-allocation-journal.v1` and its original ceilings unchanged. A
separate explicit activation can create `native-allocation-journal.v2` only
after every prior allocation is closed with known accounting and authenticated
checkpoints. V2 retains the complete signed original v1 journal, the original
authorization, every allocation, and an ordered history of requests and grants.
Reading a v1 record never activates or converts it. Process models, instances,
events, results and native checkpoint formats retain their existing versions.

`prepareAuthorizationEpoch` is read-only. Its signed, five-minute request binds
a fresh nonce, the exact journal, current instance/product, model, scope,
configuration, cumulative response/storage debits and complete retained resource
inventory. The inventory covers each allocation owner/closure/checkpoint and
every distinct native session identity across those checkpoints.

`activateAuthorizationEpoch` requires explicit write intent and a host-composed
source outside authored configuration. That source independently authenticates
fresh explicit approval and closure of **all** resources, including discovery of
resources outside the retained inventory. It must verify actual native/provider
session and process-tree termination, rather than treating a PID absence, a
signed JSON assertion or an `approved` boolean as proof. Its returned grant and
closure bind the complete request and inventory; every listed resource has a
closed observation and evidence reference, and the source confirms zero active
resources. The host requires a closure no older than one minute, verifies the
source result, reobserves the exact current prefix after asynchronous calls,
and activates through canonical CAS. The mixed host serializes activation with
its existing local effect owner. No default source fabricates approval or
closure. Fixture evidence remains explicitly marked `fixture`.

The new grant declares its own bounded deadline and **cumulative** response and
storage ceilings. Each worker receives those ceilings minus every prior debit,
including earlier epochs. Original authorization, counters and deadlines are
never reset or extended in place. An unused epoch may expire and be superseded
at the same next allocation generation; it remains readable, with unchanged
accounting. Repeated observation returns its actual active, expired, superseded
or resource-unresolved status and the current allocation phase.

The existing worker admission authenticates the v2 reservation and checkpoint;
the mixed host still selects deterministic/native work from the common reducer.
Activation allocates no native resource and does not add a routing engine or
turn deterministic operations and waits into model calls. Failed or unresolved
allocations remain blocked. Resource closure is not evidence that an old effect
was absent. New authority never retries uncertain or confirmed business effects,
changes an accepted result, bypasses cycle admission/DoR/IMPLEMENTING or supplies
Git, provider or merge permission. Such reconciliation remains separate.

Epochs are retained parts of the governed `native_allocation_journal` concept,
using existing artifact CAS, projections and configured persistence. There is
no new SQL table, shared synchronization or implicit db-only export. PostgreSQL
remains optional; configured PostgreSQL never falls back to files or SQLite.
The direct implementation pin includes every new module and contract.

## Limits and validation

The focused `--native-epoch-mode=files|dual|db-only` execution fixtures cover
actual allocation/worker ports, retained original history, current-state refusal,
incomplete/foreign closure, missing/unverified/reused consent, exact grant and
cumulative accounting, unused epoch expiry, cold reads and exact IR simulation.
The FILES variant also exercises the mixed host across deterministic work,
an external wait and resumed native work. Native/provider/approval identities
and process-tree control in these checks are doubles.

Activation before any initial native allocation is not supported by this API;
an expired unused initial authorization requires a separate explicitly supported
entry route. Native generation count remains bounded to 32. Failed/unknown
allocation reconciliation, retained uncertain effect owners, admitted correction
cycles and genuine native/human/provider/installed-archive acceptance remain
separate requirements. Reverting new selection must retain both journal readers
and every existing epoch; it must not restore an older authority pointer.
