// Historical hook observations are diagnostic cache entries, never admission receipts.
const HASH_RE = /^[a-f0-9]{64}$/;

export function evaluateContextObservation(entry, current) {
  const observation = entry?.provenance;
  const rejected = (reuse_status, ...reuse_reasons) => ({
    reusable: false, reuse_status, reuse_reasons,
  });
  if (observation?.kind !== "hook-command-observation.v1"
      || !HASH_RE.test(String(observation?.before?.fingerprint ?? ""))
      || !HASH_RE.test(String(observation?.after?.fingerprint ?? ""))) {
    return rejected("unknown", "missing_command_provenance");
  }
  if (observation.before.fingerprint !== observation.after.fingerprint) {
    return rejected("stale", "context_changed_during_command");
  }
  if (current?.status !== "captured") return rejected("unknown", "current_context_unavailable");
  if (observation.after.fingerprint !== current.fingerprint) {
    return rejected("stale", "context_changed_since_command");
  }
  if (current.state_mode !== "files") {
    return rejected("unknown", "canonical_runtime_revision_unavailable");
  }
  if (observation.command_status !== 0 || observation.command_signal != null
      || observation.command_error === true || entry.command_status !== 0 || entry.ok !== true) {
    return rejected("failed", "command_did_not_report_success");
  }
  // A current observation is still not a product validation receipt or permission.
  return {
    reusable: true, reuse_status: "current", reuse_reasons: [],
  };
}
