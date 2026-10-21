# Handoff and ordered closure

Apply COMMON.md. Receive a relay through the actual `runtime handoff-admit` with
the configured canonical backend and current default selectors. Fetch the packet
and referenced artifacts as a complete batch; inspect source, scope, revision and
shared dispatch. Coordinator/executor ownership, leases and acceptance remain
distinct. A packet is advisory and does not replace mandatory restatement.

Before closing, the model explicitly chooses an outcome for every open cycle:
integrate, report, non-retain or cancel according to the ordinary procedure.
Resolve REQ/TEST/GAP/CR evidence, branch ownership and next entry point. Do not
infer a closure decision from a passing application test or coordinator hint.

Once those choices are authorized, group known deterministic closure commands in
one sequential invocation. Preserve the ordinary order: fresh cycle admission,
authorized cycle transition, required focus/runtime update, actual cycle-close
strict hook including nested checks, fresh session admission, authorized session
transition, actual close-session strict hook including nested checks. Every
canonical write retains its own CAS/admission/fence. Inspect each result before
the next command. Do not close the session before the required cycle result.

Return the complete decision/refusal trace and verified retained references.
Never delete raw history when presenting transitions. A failed or incomplete
closure stays open with a concrete next action; no automatic merge or publication
follows from this procedure.
