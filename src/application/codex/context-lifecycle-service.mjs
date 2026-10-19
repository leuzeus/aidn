import { resolveContextCapabilities } from "../../core/context/context-capability-policy.mjs";

// Host composition binds these ports to the ordinary checkpoint and read-only
// resume use cases. No native hook is installed or inferred by this candidate.
export function createContextLifecycleService({ identity, qualifications = [], checkpoint, resume, newContext,
  now = Date.now } = {}) {
  const pinnedIdentity = structuredClone(identity);
  const pinnedQualifications = structuredClone(qualifications);
  const capabilities = () => resolveContextCapabilities(pinnedIdentity, pinnedQualifications, now());
  let rolloverState = "idle";
  const blocked = reason => ({ status: "unavailable", reason, capabilities: capabilities(), write_authorization: false });
  async function capture(intent) {
    if (intent?.write !== true || typeof checkpoint !== "function") return blocked("explicit_checkpoint_write_required");
    const result = await checkpoint(intent);
    if (result?.ok !== true || result.working_memory?.status !== "captured"
        || result.working_memory?.requires_fresh_admission !== true) return blocked("checkpoint_not_captured");
    return { status: "checkpointed", checkpoint: result.working_memory, write_authorization: false };
  }
  return {
    get capabilities() { return capabilities(); },
    async handleEvent(event, intent = {}) {
      if (!capabilities().native_events.includes(event)) return blocked("native_event_unqualified");
      if (event === "PreCompact") return await capture(intent);
      if (!["PostCompact", "SessionStart", "SubagentStop"].includes(event) || typeof resume !== "function")
        return blocked("resume_port_unavailable");
      const result = await resume(); // No write/relay intent crosses the read port.
      if (result?.status !== "current" || result.requires_fresh_admission !== true) return blocked("fresh_capsule_unavailable");
      if (event === "SubagentStop" && !result.capsule?.execution_handoff) return blocked("typed_execution_handoff_unavailable");
      return { status: event === "SubagentStop" ? "handoff_prepared" : "resumed", resume: result, write_authorization: false };
    },
    async requestRollover(intent = {}) {
      if (!capabilities().can_request_new_context || typeof newContext !== "function") return blocked("new_context_unqualified");
      if (rolloverState !== "idle") return blocked("rollover_requires_reconciliation");
      rolloverState = "checkpointing";
      let captured;
      try { captured = await capture(intent); } catch (error) { rolloverState = "idle"; throw error; }
      if (captured.status !== "checkpointed") { rolloverState = "idle"; return captured; }
      if (!capabilities().can_request_new_context) { rolloverState = "idle"; return blocked("qualification_changed_before_dispatch"); }
      // After dispatch starts, a lost acknowledgement is indeterminate. Never
      // issue a second window request automatically from the same service.
      rolloverState = "requested";
      await newContext({ checkpoint: captured.checkpoint });
      return { status: "rollover_requested", checkpoint: captured.checkpoint,
        requires_fresh_admission: true, write_authorization: false };
    },
  };
}
