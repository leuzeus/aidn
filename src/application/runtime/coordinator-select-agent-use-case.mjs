function normalizeRequestedAgent(value) {
  return String(value ?? "auto").trim().toLowerCase() || "auto";
}

export function buildCoordinatorAgentCandidateEntry(entry, roster, adapterHealth) {
  const rosterEntry = roster?.agents?.[entry.profile.id] ?? null;
  const health = adapterHealth?.[entry.profile.id] ?? null;
  return {
    id: entry.profile.id,
    label: entry.profile.label,
    score: entry.score,
    default_role: entry.profile.default_role,
    supported_roles: entry.profile.supported_roles,
    roster_enabled: rosterEntry?.enabled ?? true,
    roster_priority: Number.parseInt(String(rosterEntry?.priority ?? 0), 10) || 0,
    roster_roles: Array.isArray(rosterEntry?.roles) ? rosterEntry.roles : [],
    adapter_module: rosterEntry?.adapter_module ?? "",
    health_status: health?.health_status ?? "unknown",
    health_reason: health?.health_reason ?? "health not evaluated",
  };
}

export function buildCoordinatorSelectAgentResult({
  absoluteTargetRoot,
  effectiveStateMode,
  dbBackedMode,
  requestedAgent,
  normalizedRole,
  normalizedAction,
  roster,
  rosterVerification,
  selection,
  ranking,
  adapterHealth,
}) {
  return {
    target_root: absoluteTargetRoot,
    state_mode: effectiveStateMode,
    db_backed_mode: dbBackedMode,
    requested_agent: normalizeRequestedAgent(requestedAgent),
    role: normalizedRole,
    action: normalizedAction,
    roster: {
      found: roster.found,
      file_path: roster.file_path,
      default_requested_agent: roster.default_requested_agent,
    },
    roster_verification: {
      pass: rosterVerification.pass,
      issue_count: rosterVerification.issues.length,
      warning_count: rosterVerification.warnings.length,
    },
    selection: {
      status: selection.status,
      selected_agent: selection.selected_profile?.id ?? "unsupported",
      reason: selection.reason,
    },
    candidates: ranking.map((entry) => buildCoordinatorAgentCandidateEntry(entry, roster, adapterHealth)),
  };
}
